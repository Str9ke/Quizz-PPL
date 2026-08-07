// ============================================================
// offline.js — Gestion hors-ligne avec Firestore native persistence
// ============================================================

// ============================================================
// Wrapper Firestore sans IndexedDB manuel
// ============================================================

/**
 * _stripUndefinedFields() – Retire récursivement les clés dont la valeur est `undefined`.
 * Firestore REFUSE toute écriture contenant un champ `undefined` (erreur synchrone côté
 * client, ex: "Unsupported field value: undefined") — un seul champ oublié (ex: q.id ou
 * q.categorie absent sur une question mal formée) suffit à faire échouer TOUTE l'écriture
 * de saveResponsesWithOfflineFallback(), qui avalait cette erreur silencieusement (voir plus
 * bas) : la réponse semblait "prise en compte" côté UI mais n'était jamais réellement écrite
 * sur le serveur, et donc réapparaissait comme "à revoir" indéfiniment.
 */
function _stripUndefinedFields(obj) {
  if (obj === null || typeof obj !== 'object' || obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(_stripUndefinedFields);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = (v !== null && typeof v === 'object') ? _stripUndefinedFields(v) : v;
  }
  return out;
}

/**
 * Sauvegarde les réponses dans Firestore.
 * Firestore gère automatiquement la persistence hors-ligne et la synchronisation.
 * @param {string} uid
 * @param {Object} responsesToSave - Les nouvelles réponses à merger
 * @returns {Object} merged responses (local or from Firestore)
 * @throws en cas d'échec réel de l'écriture — voir _flushImmPersist()/validerReponses() qui
 *   utilisent ce signal pour prévenir l'utilisateur au lieu de le laisser croire, à tort,
 *   que sa réponse a bien été enregistrée.
 */
async function saveResponsesWithOfflineFallback(uid, responsesToSave) {
  // S'assurer que la persistance Firestore est initialisée
  try {
    if (typeof _ensurePersistence === 'function') await _ensurePersistence();
  } catch (e) { console.warn('[offline] Persistence check failed', e); }

  // Charger le contexte existant soit du scope global, soit via un fetch optimiste
  let existing = {};
  if (typeof currentResponses !== 'undefined' && currentResponses) {
    existing = currentResponses;
  } else {
    // Si pas de currentResponses global, essayer de lire (cache ou serveur)
    try {
      const doc = await db.collection('quizProgress').doc(uid).get();
      if (doc.exists) existing = doc.data().responses || {};
    } catch (e) {
      console.warn('[offline] Erreur lecture avant save:', e);
    }
  }

  // Extraire les entrées d'historique en attente (_pendingLogEntry, posé par
  // _computeSrEntry()) AVANT le merge : elles ne doivent JAMAIS atterrir dans le
  // document principal quizProgress/{uid} (champ responses.<key>) mais dans la
  // sous-collection quizProgress/{uid}/history/{key}, qui a sa PROPRE limite de 1 Mio
  // par document — voir _migrateStatusLogToSubcollection() pour le contexte complet de
  // cette architecture (avant elle, un historique cumulé sur des milliers de questions
  // faisait dépasser la limite du document unique et bloquait TOUTE écriture future).
  const pendingLogEntries = [];
  const cleanedResponsesToSave = {};
  Object.keys(responsesToSave).forEach(key => {
    const incoming = { ...responsesToSave[key] };
    if (incoming._pendingLogEntry) {
      pendingLogEntries.push({ key, logEntry: incoming._pendingLogEntry });
      delete incoming._pendingLogEntry;
    }
    cleanedResponsesToSave[key] = incoming;
  });

  // Merger les réponses en mémoire
  const merged = { ...existing };
  Object.keys(cleanedResponsesToSave).forEach(key => {
    if (merged[key]) {
      merged[key] = { ...merged[key], ...cleanedResponsesToSave[key] };
    } else {
      merged[key] = cleanedResponsesToSave[key];
    }
  });

  // Sauvegarde locale de secours, INDÉPENDANTE de Firestore — capture cette réponse (et l'état
  // fusionné complet) dans localStorage AVANT même de tenter l'écriture Firestore ci-dessous :
  // si celle-ci échoue (ex. document au plafond de taille, coupure réseau), rien n'est perdu —
  // voir _restoreFromLocalBackup() (configuration.html) pour la reprise. Best-effort : une
  // erreur ici (quota localStorage plein) ne doit jamais empêcher la tentative Firestore.
  if (typeof _backupResponsesLocally === 'function') {
    try { _backupResponsesLocally(uid, merged); } catch (e) { console.warn('[offline] Backup local échoué:', e); }
  }

  // Sauvegarder via Firestore en utilisant des mises à jour PAR CLÉ INDIVIDUELLE
  // (responses.question_xxx = valeur) au lieu de remplacer tout le champ responses.
  // Cela évite d'écraser les données sauvegardées sur un autre appareil depuis le chargement
  // de la page (ex : téléphone sauvegarde nextReview → PC ne le voit pas encore → PC sauvegarde
  // et ne doit pas écraser le nextReview du téléphone).
  try {
    const mainRef = db.collection('quizProgress').doc(uid);
    const firestoreUpdate = { lastUpdated: firebase.firestore.Timestamp.now() };
    Object.keys(cleanedResponsesToSave).forEach(key => {
      firestoreUpdate['responses.' + key] = _stripUndefinedFields(merged[key]);
    });

    // writeHistoryEntries() : écrit chaque nouvelle entrée de log dans son propre document
    // de sous-collection via arrayUnion (idempotent — un retry ne duplique jamais l'entrée).
    const writeHistoryEntries = async () => {
      if (!pendingLogEntries.length) return;
      const histBatch = db.batch();
      pendingLogEntries.forEach(({ key, logEntry }) => {
        histBatch.set(
          mainRef.collection('history').doc(key),
          { log: firebase.firestore.FieldValue.arrayUnion(logEntry) },
          { merge: true }
        );
      });
      await histBatch.commit();
    };

    try {
      // update() ne fonctionne que si le doc existe — cas normal après la 1ère session.
      // Groupé dans un batch avec les écritures d'historique pour que les deux
      // n'aboutissent (ou n'échouent) qu'ensemble.
      const batch = db.batch();
      batch.update(mainRef, firestoreUpdate);
      pendingLogEntries.forEach(({ key, logEntry }) => {
        batch.set(
          mainRef.collection('history').doc(key),
          { log: firebase.firestore.FieldValue.arrayUnion(logEntry) },
          { merge: true }
        );
      });
      await batch.commit();
    } catch (e) {
      if (e.code === 'not-found') {
        // Premier enregistrement : créer le document avec set(), puis écrire l'historique
        await db.collection('quizProgress').doc(uid).set(
          { responses: _stripUndefinedFields(merged), lastUpdated: firebase.firestore.Timestamp.now() },
          { merge: true }
        );
        await writeHistoryEntries();
      } else {
        throw e;
      }
    }

    // Mettre à jour l'objet global si présent
    if (typeof currentResponses !== 'undefined') {
      currentResponses = normalizeResponses(merged);
    }
    return normalizeResponses(merged);
  } catch (e) {
    console.error('[offline] Firestore save failed permanently:', e);
    // Mettre à jour l'objet global LOCAL quand même (UI réactive), mais SIGNALER l'échec à
    // l'appelant en relançant l'erreur — avant ce fix, l'erreur était avalée ici et la
    // réponse semblait "enregistrée" pour l'utilisateur alors qu'elle n'avait jamais atteint
    // le serveur, réapparaissant comme "à revoir" à la session suivante sans aucune trace.
    if (typeof currentResponses !== 'undefined') {
      currentResponses = normalizeResponses(merged);
    }
    throw e;
  }
}

/**
 * _migrateStatusLogToSubcollection() – Déplace le champ statusLog encore présent dans le
 * document principal quizProgress/{uid} (ancien format, avant l'introduction de la
 * sous-collection quizProgress/{uid}/history) vers un document dédié par question dans
 * cette sous-collection, PUIS retire statusLog du document principal.
 *
 * Conçue pour être appelée sans risque à chaque chargement de page (idempotente et
 * retry-safe) :
 *  - L'écriture vers la sous-collection utilise arrayUnion → la relancer plusieurs fois
 *    ne duplique jamais une entrée déjà migrée.
 *  - La suppression du statusLog inline dans le document principal n'est effectuée
 *    QU'APRÈS confirmation que l'écriture vers la sous-collection a réussi pour ce lot :
 *    en cas d'échec réseau à n'importe quelle étape, aucune donnée n'est perdue — au pire
 *    elle reste temporairement dupliquée (présente aux deux endroits) jusqu'au prochain
 *    passage, jamais absente des deux.
 *  - Une fois tous les statusLog inline migrés pour un utilisateur, les appels suivants
 *    ne trouvent plus rien à faire et ressortent immédiatement (aucune lecture/écriture
 *    Firestore superflue).
 */
async function _migrateStatusLogToSubcollection(uid) {
  if (!uid || typeof currentResponses === 'undefined' || !currentResponses) return;
  const keysToMigrate = Object.keys(currentResponses).filter(k => {
    const r = currentResponses[k];
    return r && Array.isArray(r.statusLog) && r.statusLog.length > 0;
  });
  if (!keysToMigrate.length) return;

  const mainRef = db.collection('quizProgress').doc(uid);
  const CHUNK = 400; // marge sous la limite de 500 opérations par batch Firestore
  for (let i = 0; i < keysToMigrate.length; i += CHUNK) {
    const chunk = keysToMigrate.slice(i, i + CHUNK);
    try {
      const histBatch = db.batch();
      chunk.forEach(k => {
        const log = currentResponses[k].statusLog;
        histBatch.set(
          mainRef.collection('history').doc(k),
          { log: firebase.firestore.FieldValue.arrayUnion(...log) },
          { merge: true }
        );
      });
      await histBatch.commit();

      // Uniquement après succès confirmé de l'écriture ci-dessus : retirer le statusLog
      // inline du document principal (via update() + FieldValue.delete(), en notation
      // pointée, pour ne toucher QUE ce champ et laisser le reste de chaque entrée intact).
      const mainUpdate = {};
      chunk.forEach(k => { mainUpdate['responses.' + k + '.statusLog'] = firebase.firestore.FieldValue.delete(); });
      await mainRef.update(mainUpdate);

      // Refléter localement pour éviter une re-tentative inutile dans la même session
      chunk.forEach(k => { if (currentResponses[k]) delete currentResponses[k].statusLog; });
    } catch (e) {
      console.warn('[offline] Migration statusLog → sous-collection : échec sur ce lot, on réessaiera au prochain chargement de page.', e);
      // Ne pas continuer les lots suivants sur une erreur réseau probable — inutile de
      // les faire tous échouer un par un ; le prochain chargement de page reprendra
      // exactement là où on s'est arrêté (les clés déjà migrées sont ignorées car leur
      // statusLog local a été supprimé ci-dessus).
      return;
    }
  }
}

/**
 * _deleteHistorySubcollection() – Supprime intégralement la sous-collection
 * quizProgress/{uid}/history. Firestore ne supprime PAS automatiquement les
 * sous-collections quand le document parent (ou un de ses champs) est effacé — il n'existe
 * pas d'API de suppression récursive côté client, il faut donc énumérer puis supprimer
 * chaque document explicitement. Utilisée par resetStats() (js/stats.js) pour que
 * "Réinitialiser les statistiques" efface bien TOUT l'historique, y compris celui migré
 * hors du document principal.
 */
async function _deleteHistorySubcollection(uid) {
  if (!uid) return;
  const histCol = db.collection('quizProgress').doc(uid).collection('history');
  const snap = await histCol.get();
  if (snap.empty) return;
  const docs = snap.docs;
  const CHUNK = 450;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = db.batch();
    docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

// ============================================================
// Sauvegarde locale de secours (indépendante de Firestore)
// ============================================================

/**
 * _backupResponsesLocally(uid, responses) – Écrit un instantané complet de `responses` dans
 * localStorage, appelé à CHAQUE réponse (voir saveResponsesWithOfflineFallback, AVANT la
 * tentative d'écriture Firestore) : même si l'écriture Firestore échoue (document au plafond
 * de taille, coupure réseau non détectée, etc.), la réponse qu'on vient de donner n'est jamais
 * perdue — elle est déjà dans ce backup, exportable/restaurable depuis configuration.html à
 * tout moment via _restoreFromLocalBackup(). Écrase le backup précédent à chaque appel (un seul
 * instantané "le plus à jour possible", pas un historique de versions) : c'est volontairement
 * simple et robuste plutôt qu'un journal incrémental qui pourrait diverger silencieusement.
 */
function _backupResponsesLocally(uid, responses) {
  if (!uid || !responses) return;
  const payload = JSON.stringify({ responses, savedAt: Date.now() });
  const ok = (typeof _setLocalStorageWithCleanup === 'function')
    ? _setLocalStorageWithCleanup('responsesBackup_' + uid, payload)
    : (() => { try { localStorage.setItem('responsesBackup_' + uid, payload); return true; } catch (e) { return false; } })();
  if (!ok) console.warn('[offline] Backup local des réponses impossible (quota localStorage plein).');
}

/**
 * _getLocalBackupInfo(uid) – Métadonnées du backup local courant (nombre de questions, date),
 * sans le charger entièrement — utilisé par configuration.html pour afficher son état sans
 * attendre un JSON.parse() complet à chaque ouverture de la page.
 */
function _getLocalBackupInfo(uid) {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem('responsesBackup_' + uid);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { count: Object.keys(parsed.responses || {}).length, savedAt: parsed.savedAt || null };
  } catch (e) {
    return null;
  }
}

/**
 * _restoreFromLocalBackup(uid) – Réécrit intégralement Firestore (quizProgress/{uid}.responses)
 * à partir du backup local, PAR FUSION clé par clé (jamais un remplacement en bloc) pour ne
 * jamais écraser une réponse plus récente déjà sur le serveur (ex: donnée sur un autre appareil
 * après ce backup) avec une version locale plus ancienne — seules les clés absentes du serveur
 * OU dont le backup local est MOINS avancé que le serveur ne sont jamais réécrites ; en cas de
 * doute (comparaison impossible) la version serveur est conservée par prudence.
 */
async function _restoreFromLocalBackup(uid) {
  if (!uid) throw new Error('Utilisateur non identifié');
  const raw = localStorage.getItem('responsesBackup_' + uid);
  if (!raw) throw new Error('Aucun backup local trouvé sur cet appareil.');
  const { responses: backup } = JSON.parse(raw);
  if (!backup || !Object.keys(backup).length) throw new Error('Backup local vide.');

  const doc = await db.collection('quizProgress').doc(uid).get();
  const serverResponses = (doc.exists && doc.data().responses) || {};

  const toRestore = {};
  Object.keys(backup).forEach(key => {
    const b = backup[key], s = serverResponses[key];
    if (!s) { toRestore[key] = b; return; } // absente du serveur → restaurer
    // Comparaison par timestamp si les deux en ont un ; sinon on ne touche pas au serveur.
    const bMs = b.timestamp && (b.timestamp.seconds !== undefined ? b.timestamp.seconds * 1000 : b.timestamp);
    const sMs = s.timestamp && (s.timestamp.seconds !== undefined ? s.timestamp.seconds * 1000 : s.timestamp);
    if (bMs && sMs && bMs > sMs) toRestore[key] = b;
  });

  const keys = Object.keys(toRestore);
  if (!keys.length) return { restoredCount: 0 };

  const mainRef = db.collection('quizProgress').doc(uid);
  const CHUNK = 400;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    const update = {};
    chunk.forEach(k => { update['responses.' + k] = _stripUndefinedFields(toRestore[k]); });
    try {
      await mainRef.update(update);
    } catch (e) {
      if (e.code === 'not-found') {
        await mainRef.set({ responses: _stripUndefinedFields(toRestore) }, { merge: true });
        break;
      }
      throw e;
    }
  }
  if (typeof currentResponses !== 'undefined') {
    currentResponses = normalizeResponses({ ...serverResponses, ...toRestore });
  }
  return { restoredCount: keys.length };
}

/**
 * Sauvegarde un toggle (marquer/important)
 */
async function saveToggleWithOfflineFallback(uid, key, payload) {
  try {
    await db.collection('quizProgress').doc(uid).set(payload, { merge: true });
  } catch (e) {
    console.error('[offline] Save toggle failed:', e);
  }
}

/**
 * Sauvegarde dailyCount
 */
async function saveDailyCountOffline(uid) {
  // Délégation directe, Firestore gère le offline
  if (typeof saveDailyCount === 'function') {
    try {
      await saveDailyCount(uid);
    } catch (e) {
      console.warn('[offline] saveDailyCount failed', e);
    }
  }
}

/**
 * Sauvegarde sessionResult
 */
async function saveSessionResultOffline(uid, correct, total, category, sessionDate) {
  // Délégation directe
  if (typeof saveSessionResult === 'function') {
    try {
      await saveSessionResult(uid, correct, total, category, sessionDate);
    } catch (e) {
      console.warn('[offline] saveSessionResult failed', e);
    }
  }
}


// ============================================================
// UI — Indicateur online/offline
// ============================================================

function createOfflineIndicator() {
  let bar = document.getElementById('offlineStatusBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'offlineStatusBar';
    bar.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 10000;
      padding: 4px 12px; text-align: center; font-size: 13px; font-weight: bold;
      transition: all 0.3s ease; display: none;
    `;
    document.body.prepend(bar);
  }
  updateOnlineStatus();
}

function updateOnlineStatus() {
  const bar = document.getElementById('offlineStatusBar');
  if (!bar) return;
  
  if (!navigator.onLine) {
    bar.style.background = '#e53935';
    bar.style.color = 'white';
    bar.textContent = '✈ Hors ligne';
    bar.style.display = 'block';
  } else {
    bar.style.background = '#4caf50';
    bar.style.color = 'white';
    bar.textContent = '✓ En ligne';
    bar.style.display = 'block';
    setTimeout(() => { bar.style.display = 'none'; }, 2000);
  }
}

// ============================================================
// Enregistrement du Service Worker
// ============================================================

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[SW] Service Workers non supportés');
    return;
  }
  
  try {
    // Si sw.js est à la racine, on l'enregistre à la racine
    // On suppose que sw.js est au même niveau que index.html
    const reg = await navigator.serviceWorker.register('sw.js');
    console.log('[SW] Service Worker enregistré:', reg.scope);
    
    // Update check
    try { await reg.update(); } catch (e) { /* ignore */ }
    
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.log('[SW] Nouvelle version détectée');
        }
      });
    });

    let _swRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (_swRefreshing) return;
      _swRefreshing = true;
      window.location.reload();
    });
  } catch (e) {
    console.error('[SW] Erreur enregistrement:', e);
  }
}

// ============================================================
// Stockage persistant — évite que Android/Chrome n'efface silencieusement le cache
// hors-ligne (Cache Storage du Service Worker + IndexedDB de Firestore) sous pression de
// stockage ou faute d'utilisation récente. SANS cet appel, le stockage est "best-effort" :
// le système peut le vider n'importe quand sans prévenir — le pire moment possible étant
// précisément entre le dernier chargement en ligne et un vol où l'appli s'avère alors vide.
// Le navigateur peut refuser silencieusement (retourne false) selon des heuristiques
// d'engagement (PWA installée + visites répétées augmentent les chances d'acceptation) —
// voir _cfgOfflineDiagnostic() dans configuration.html pour vérifier le résultat réel.
// ============================================================
async function _requestPersistentStorage() {
  if (!(navigator.storage && navigator.storage.persist)) return false;
  try {
    const already = await navigator.storage.persisted();
    if (already) return true;
    return await navigator.storage.persist();
  } catch (e) {
    console.warn('[offline] navigator.storage.persist() a échoué:', e);
    return false;
  }
}
window._requestPersistentStorage = _requestPersistentStorage;

// ============================================================
// Init
// ============================================================

function initOffline() {
  registerServiceWorker();
  createOfflineIndicator();
  _requestPersistentStorage();

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  console.log('[offline] Module simplifié initialisé (Firestore Persistence)');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOffline);
} else {
  initOffline();
}
