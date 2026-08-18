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

// ============================================================
// Répartition de `responses` sur plusieurs documents ("shards")
// ============================================================
//
// CONTEXTE : le champ `responses` du document quizProgress/{uid} contenait TOUTES les
// réponses de l'utilisateur dans une seule map, sur un document plafonné par Firestore à
// 1 Mio — un utilisateur avec plusieurs milliers de questions répondues finissait par heurter
// ce plafond, bloquant TOUTE nouvelle sauvegarde (même sur une seule question) jusqu'à un
// compactage manuel. Le compactage (voir _compactQuizProgress, js/stats.js) repousse le mur
// mais ne l'élimine pas : au-delà d'un certain nombre de questions réellement répondues, plus
// aucune donnée "gratuite" à retirer n'existe.
//
// SOLUTION : `responses` est désormais réparti sur des documents séparés
// quizProgress/{uid}/responseShards/{0,1,2,...}, chacun plafonné à SHARD_CAPACITY entrées —
// largement sous la limite Firestore même avec des entrées "lourdes" (notes, correctOverride).
// Un nouveau shard est créé automatiquement dès que le précédent est plein : AUCUNE limite
// globale au nombre de questions répondues, quel que soit le rythme d'utilisation.
//
// Le document principal quizProgress/{uid} garde tous ses AUTRES champs inchangés (notes,
// dailyHistory, quizSessionCount...) — seul `responses` est déplacé, remplacé par un simple
// compteur `responseShardCount` (taille négligeable, ne grossit jamais).
//
// MIGRATION automatique et unique (_migrateResponsesToShards, appelée par
// _loadMergedResponses ci-dessous à chaque chargement de page) : déplace le `responses`
// encore inline (ancien format) vers des shards, PUIS le retire du document principal —
// jamais l'inverse, pour ne jamais risquer de perdre des données en cours de route (même
// philosophie que _migrateStatusLogToSubcollection ci-dessous, déjà en place depuis plus
// longtemps pour l'historique détaillé).

const RESPONSE_SHARD_CAPACITY = 2000;

/* ============================================================
   File d'attente des réponses données HORS-LIGNE
   ============================================================
   Firestore rejoue normalement seul ses écritures en attente au retour du réseau. Encore
   faut-il que sa persistance soit réellement active : quand enablePersistence() échoue (cas
   fréquent et SILENCIEUX — plusieurs onglets, WebView récalcitrante), la file ne survit pas
   au rechargement de la page et les réponses données hors-ligne disparaissent purement et
   simplement. Symptôme vécu : une session entière répondue en vol, puis les MÊMES questions
   reproposées à la reconnexion, comme si rien n'avait été fait.

   On tient donc notre propre liste de clés en attente, dans localStorage (quelques dizaines
   d'octets par clé, sans commune mesure avec les réponses elles-mêmes, qui vivent dans le
   miroir IndexedDB). À la reconnexion, ces clés sont réécrites depuis le miroir — la source
   locale qui, elle, a survécu. */
const PENDING_SYNC_KEY = 'pendingSyncKeys_';

/* _kindsOf(entry) – De quoi cette modification est-elle faite ?
   Sert au récapitulatif de Configuration : « 12 réponses, 3 fréquences, 1 note » est autrement
   plus parlant que « 16 éléments en attente » quand on veut savoir ce qui a réellement été fait
   hors-ligne, et ce qui partira à la reconnexion. */
function _kindsOf(entry) {
  const kinds = [];
  if (!entry || typeof entry !== 'object') return kinds;
  if ('status' in entry) kinds.push('reponse');
  if ('srInterval' in entry || 'nextReview' in entry) kinds.push('frequence');
  if ('note' in entry) kinds.push('note');
  if ('marked' in entry) kinds.push('marquee');
  if ('important' in entry) kinds.push('importante');
  if ('correctOverride' in entry) kinds.push('correction');
  return kinds;
}

/* La file est une MAP clé -> natures, et non plus une simple liste : le format ancien (tableau)
   est relu sans broncher pour ne rien perdre d'une session déjà en attente au moment de la
   mise à jour. */
function _markPendingSync(uid, key, entry) {
  if (!uid || !key) return;
  try {
    const k = PENDING_SYNC_KEY + uid;
    const map = _getPendingSyncMap(uid);
    const prev = map[key] || [];
    const next = new Set(prev.concat(_kindsOf(entry)));
    map[key] = [...next];
    localStorage.setItem(k, JSON.stringify(map));
  } catch (e) { console.warn('[sync] impossible de noter la clé en attente:', e.message); }
}

function _getPendingSyncMap(uid) {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_SYNC_KEY + uid) || '{}');
    if (Array.isArray(raw)) {
      // Ancien format : liste de clés sans nature connue.
      const map = {};
      raw.forEach(k => { map[k] = []; });
      return map;
    }
    return raw && typeof raw === 'object' ? raw : {};
  } catch (e) { return {}; }
}

function _getPendingSync(uid) {
  return Object.keys(_getPendingSyncMap(uid));
}

/**
 * _pendingSyncSummary(uid) – Ce qui attend d'être envoyé, par nature.
 * { total, reponse, frequence, note, marquee, importante, correction }
 */
function _pendingSyncSummary(uid) {
  uid = uid || localStorage.getItem('cachedUid');
  const map = _getPendingSyncMap(uid);
  const out = { total: 0, reponse: 0, frequence: 0, note: 0, marquee: 0, importante: 0, correction: 0, inconnu: 0 };
  Object.keys(map).forEach(key => {
    out.total++;
    const kinds = map[key] || [];
    if (!kinds.length) { out.inconnu++; return; }
    kinds.forEach(k => { if (k in out) out[k]++; });
  });
  return out;
}
window._pendingSyncSummary = _pendingSyncSummary;

function _clearPendingSync(uid, keys) {
  try {
    const k = PENDING_SYNC_KEY + uid;
    if (!keys) { localStorage.removeItem(k); return; }
    const map = _getPendingSyncMap(uid);
    keys.forEach(x => { delete map[x]; });
    if (Object.keys(map).length) localStorage.setItem(k, JSON.stringify(map));
    else localStorage.removeItem(k);
  } catch (e) { /* ignore */ }
}
window._getPendingSyncCount = function (uid) { return _getPendingSync(uid).length; };

/**
 * _flushPendingSync(uid) – Rejoue vers le serveur les réponses données hors-ligne.
 * Les valeurs sont relues dans le miroir local, seule copie garantie d'avoir survécu à une
 * fermeture de l'appli. Ne fait rien si le réseau n'est pas revenu.
 */
async function _flushPendingSync(uid) {
  uid = uid || localStorage.getItem('cachedUid');
  if (!uid || (typeof _netOnline === 'function' && !_netOnline())) return { flushed: 0 };
  const pending = _getPendingSync(uid);
  if (!pending.length) return { flushed: 0 };

  let source = (typeof currentResponses !== 'undefined' && currentResponses) ? currentResponses : null;
  if (!source && typeof _mirrorLoadResponses === 'function') {
    const m = await _mirrorLoadResponses(uid).catch(() => null);
    source = (m && m.responses) || null;
  }
  if (!source) return { flushed: 0 };

  const updates = {};
  pending.forEach(k => { if (source[k]) updates[k] = source[k]; });
  const keys = Object.keys(updates);
  if (!keys.length) { _clearPendingSync(uid); return { flushed: 0 }; }

  console.log('[sync] rejeu de', keys.length, 'réponse(s) données hors-ligne');
  try {
    await _saveResponsesSharded(uid, updates);
    _clearPendingSync(uid, keys);
    if (typeof _showSaveStatus === 'function') {
      _showSaveStatus(true, keys.length + ' réponse(s) hors-ligne synchronisée(s)');
    }
    return { flushed: keys.length };
  } catch (e) {
    // On GARDE les clés en attente : mieux vaut réessayer à la prochaine occasion que de
    // considérer comme envoyé ce qui ne l'est pas.
    console.warn('[sync] rejeu échoué, les clés restent en attente:', e.message);
    return { flushed: 0, error: e.message };
  }
}
window._flushPendingSync = _flushPendingSync;

// Rejeu automatique dès que le réseau revient, et une fois au démarrage si des réponses
// attendent depuis une session précédente.
if (typeof window !== 'undefined') {
  if (typeof appOnOnline === 'function') appOnOnline(() => _flushPendingSync());
  setTimeout(() => { _flushPendingSync().catch(() => {}); }, 6000);
}


/**
 * _migrateResponsesToShards(uid) – Migration unique et idempotente : si le document principal
 * contient encore un champ `responses` inline (ancien format), le répartit en shards puis le
 * retire du document principal — SEULEMENT après confirmation que l'écriture de tous les
 * shards a réussi. Sans effet (retour immédiat) une fois la migration terminée pour cet
 * utilisateur, ou si hors-ligne (on retentera au prochain chargement en ligne).
 *
 * PROTECTION CONTRE LES APPELS CONCURRENTS (_migrationInFlight) : sur un même chargement de
 * page, PLUSIEURS chemins de code peuvent appeler _loadMergedResponses() avant que la première
 * migration soit terminée — typiquement initQuiz() au chargement ET saveResponsesWithOfflineFallback()
 * si l'utilisateur répond très vite (avant que window._respKeyShard soit alimenté). Sans cette
 * protection, une DEUXIÈME migration démarrée en parallèle relit `responses` inline (l'instantané
 * pré-réponse) et l'écrit dans le shard APRÈS la réponse fraîche qui vient d'y être sauvegardée
 * séparément par _saveResponsesSharded() — écrasant silencieusement cette réponse fraîche avec
 * l'ancienne valeur (bug réel constaté : une réponse confirmée "enregistrée" disparaissait après
 * navigation). En mutualisant l'appel en cours, tout code qui a besoin des shards attend la MÊME
 * migration au lieu d'en démarrer une seconde qui pourrait se terminer après une écriture fraîche.
 */
let _migrationInFlight = {};
async function _migrateResponsesToShards(uid) {
  if (!uid || !_netOnline()) return { migrated: false };
  if (_migrationInFlight[uid]) return _migrationInFlight[uid];
  const promise = (async () => {
    try {
      const mainRef = db.collection('quizProgress').doc(uid);
      const doc = await mainRef.get({ source: 'server' }).catch(() => mainRef.get());
      if (!doc.exists) return { migrated: false };
      const data = doc.data();
      const inline = data.responses;
      if (!inline || !Object.keys(inline).length) return { migrated: false };

      // Chunking déterministe (clés triées) : un retry après échec partiel reproduit exactement
      // le même découpage tant que le champ `responses` inline n'a pas encore été retiré — donc
      // aucun risque de doublon/incohérence entre deux tentatives.
      const keys = Object.keys(inline).sort();
      const shardCount = Math.max(1, Math.ceil(keys.length / RESPONSE_SHARD_CAPACITY));

      for (let i = 0; i < shardCount; i++) {
        const chunkKeys = keys.slice(i * RESPONSE_SHARD_CAPACITY, (i + 1) * RESPONSE_SHARD_CAPACITY);
        // Objet IMBRIQUÉ ({responses: {...}}) avec merge:true : un merge profond ne remplace que
        // les clés fournies et préserve celles qu'une écriture concurrente aurait posées entre
        // la lecture ci-dessus et cette écriture. Surtout, PAS de chemin pointé
        // ('responses.<clé>') : set() n'interprète pas les points comme des séparateurs de
        // chemin, la clé deviendrait un nom de champ littéral à la racine et n'atterrirait
        // jamais dans la map `responses` (voir _saveResponsesSharded pour le détail complet).
        const shardPayload = {};
        chunkKeys.forEach(k => { shardPayload[k] = _stripUndefinedFields(inline[k]); });
        await mainRef.collection('responseShards').doc(String(i)).set({ responses: shardPayload }, { merge: true });
      }

      // Seulement après succès confirmé de TOUS les shards ci-dessus : retirer `responses` du
      // document principal et enregistrer le nombre de shards créés.
      //
      // Le compteur ne doit JAMAIS être RABAISSÉ ici. Si un champ `responses` inline réapparaît
      // un jour sur le document principal (ancien code, restauration, écriture d'un autre
      // chemin) alors que des shards existent déjà, cette migration se relance et ne voit que
      // les quelques clés inline : écrire brutalement `responseShardCount = shardCount` ferait
      // retomber le compteur (ex. 2 → 1) et RENDRAIT INVISIBLES tous les shards au-delà —
      // exactement le scénario qui a fait disparaître des centaines de réponses pourtant
      // intactes côté serveur. On garde donc le maximum entre l'existant et le calculé.
      const declaredBefore = data.responseShardCount || 0;
      await mainRef.update({
        responses: firebase.firestore.FieldValue.delete(),
        responseShardCount: Math.max(declaredBefore, shardCount)
      });
      console.log(`[offline] Migration responses → ${shardCount} shard(s) (${keys.length} question(s)) réussie.`);
      return { migrated: true, shardCount };
    } catch (e) {
      console.warn('[offline] Migration responses → shards : échec, on réessaiera au prochain chargement de page.', e);
      return { migrated: false, error: e };
    } finally {
      delete _migrationInFlight[uid];
    }
  })();
  _migrationInFlight[uid] = promise;
  return promise;
}

/**
 * _loadMergedResponses(uid, timeoutMs) – Point d'entrée UNIQUE pour lire les réponses d'un
 * utilisateur : déclenche la migration si besoin, lit le document principal ET tous ses
 * shards, puis renvoie un objet imitant un DocumentSnapshot Firestore ({exists, data()}) où
 * `data().responses` contient la fusion complète — tous les appelants existants qui font déjà
 * `const data = doc.data(); ... data.responses ...` continuent de fonctionner sans autre
 * changement. Alimente aussi window._respKeyShard (quelle entrée vit dans quel shard) et
 * window._respShardCount, utilisés par _saveResponsesSharded() pour router les écritures.
 */
async function _loadMergedResponses(uid, timeoutMs) {
  if (!uid) return { exists: false, data: () => ({}) };
  if (typeof _migrateResponsesToShards === 'function') {
    await _migrateResponsesToShards(uid).catch(() => {});
  }

  const mainRef = db.collection('quizProgress').doc(uid);
  const doc = (typeof getDocWithTimeout === 'function')
    ? await getDocWithTimeout(mainRef, timeoutMs)
    : await mainRef.get();
  const primaryData = doc.exists ? doc.data() : {};
  const merged = { ...(primaryData.responses || {}) };
  const declaredShardCount = primaryData.responseShardCount || 0;

  // Les shards à lire sont déterminés en LISTANT réellement la sous-collection, jamais en se
  // fiant au seul compteur responseShardCount du document principal. Ce compteur peut se
  // retrouver en retard sur la réalité (constaté en pratique : compteur à 1 alors que le
  // serveur hébergeait bien 2 shards de 2000 et 1544 entrées) — et comme l'ancienne boucle
  // s'arrêtait à `i < responseShardCount`, le second shard n'était même pas DEMANDÉ : ses 1544
  // réponses, pourtant intactes côté serveur, restaient invisibles partout dans l'app, sans
  // aucune erreur puisqu'aucune lecture n'échouait. Lister la collection rend la lecture
  // insensible à un compteur faux, dans un sens comme dans l'autre.
  let shardIds = [];
  try {
    const listSnap = _netOnline()
      ? await mainRef.collection('responseShards').get({ source: 'server' })
      : await mainRef.collection('responseShards').get({ source: 'cache' });
    listSnap.forEach(d => shardIds.push(d.id));
  } catch (e) {
    console.warn('[offline] Listing des shards impossible, repli sur le compteur:', e.message);
    for (let i = 0; i < declaredShardCount; i++) shardIds.push(String(i));
  }
  // Filet supplémentaire : si le listing renvoie moins de shards que le compteur annoncé
  // (cache partiel), lire quand même ceux que le compteur promet.
  for (let i = 0; i < declaredShardCount; i++) {
    if (!shardIds.includes(String(i))) shardIds.push(String(i));
  }

  window._respKeyShard = {};
  window._respShardEntryCounts = {};
  window._respLoadIncomplete = false;
  // Remis à zéro à CHAQUE lecture : sans ça, un comblement depuis le miroir lors d'une lecture
  // dégradée laisserait l'avertissement « restauré depuis la copie de secours » affiché pour
  // toute la durée de la session, y compris après une lecture serveur parfaitement saine.
  window._respRestoredFromMirror = 0;
  const shardFetches = [];
  for (const shardId of shardIds) {
    // Index numérique : _saveResponsesSharded() fait de l'arithmétique dessus (shard actif,
    // création du suivant), un identifiant resté en chaîne y produirait "01" au lieu de 1.
    const i = Number(shardId);
    const shardRef = mainRef.collection('responseShards').doc(String(i));
    const applyShardDoc = (shardDoc) => {
      const shardResponses = (shardDoc.exists && shardDoc.data().responses) || {};
      const keys = Object.keys(shardResponses);
      window._respShardEntryCounts[i] = keys.length;
      // Les lectures des shards se terminent en parallèle, dans un ordre non déterministe
      // (timing réseau) : si une même clé existe par erreur dans PLUSIEURS shards (résidu
      // d'anciennes tentatives d'écriture parties de zéro pendant les pannes de permissions
      // constatées en pratique), un simple écrasement aurait pu laisser gagner le shard qui
      // finit de se lire EN DERNIER plutôt que la donnée réellement la plus récente — la
      // réponse fraîche semblait alors "disparaître" après une navigation. On ne remplace
      // donc une entrée déjà fusionnée que si celle-ci est authentiquement plus récente
      // (comparaison par timestamp) ; en cas de doute (timestamp manquant d'un côté), la clé
      // trouvée en premier est conservée par prudence plutôt que la plus récente à charger.
      keys.forEach(k => {
        const incoming = shardResponses[k];
        const existing = merged[k];
        if (existing !== undefined) {
          const existingMs = existing.timestamp && (existing.timestamp.seconds !== undefined ? existing.timestamp.seconds * 1000 : existing.timestamp);
          const incomingMs = incoming.timestamp && (incoming.timestamp.seconds !== undefined ? incoming.timestamp.seconds * 1000 : incoming.timestamp);
          if (!(incomingMs && existingMs && incomingMs > existingMs)) return;
        }
        merged[k] = incoming;
        window._respKeyShard[k] = i;
      });
    };
    // Un shard qui dépasse timeoutMs (réseau mobile lent/variable) était auparavant abandonné
    // en silence — le total affiché (Progression globale, cycle de répétition espacée…)
    // paraissait alors correct alors qu'il manquait des centaines de réponses pourtant bien
    // enregistrées côté serveur, sans aucun indice visible pour l'utilisateur. Avant d'abandonner :
    // un 2e essai, sans limite de temps arbitraire (juste la lecture réseau normale), qui laisse
    // sa chance à une connexion simplement lente plutôt qu'à une vraie panne. Seul un échec des
    // DEUX tentatives lève le drapeau _respLoadIncomplete, pour que les écrans qui affichent des
    // totaux puissent avertir plutôt que d'afficher silencieusement un chiffre tronqué.
    // Le 2e essai visait EXPLICITEMENT le serveur ({ source: 'server' }). Hors-ligne, cette
    // tentative de secours ne pouvait donc que rater instantanément : le shard était abandonné
    // et ses réponses disparaissaient de toute l'appli. Combiné au délai trop court appliqué
    // aux lectures cache (voir getDocWithTimeout, js/helpers.js), c'est ce qui a vidé la
    // progression en plein vol. La tentative de secours doit viser la MÊME source que celle
    // qui est réellement disponible : le cache quand on est hors-ligne, le serveur sinon.
    const retryOnce = () => (_netOnline()
      ? shardRef.get({ source: 'server' })
      : shardRef.get({ source: 'cache' }));
    shardFetches.push(
      ((typeof getDocWithTimeout === 'function') ? getDocWithTimeout(shardRef, timeoutMs) : shardRef.get())
        .then(applyShardDoc)
        .catch(e => {
          console.warn('[offline] Lecture shard ' + i + ' échouée (1re tentative), nouvel essai sans limite de temps:', e.message);
          return retryOnce()
            .then(applyShardDoc)
            .catch(e2 => {
              console.warn('[offline] Lecture shard ' + i + ' échouée (2e tentative) :', e2.message);
              window._respLoadIncomplete = true;
            });
        })
    );
  }
  await Promise.all(shardFetches);

  // Nombre de shards RÉEL = plus grand index rencontré + 1 (et non le compteur annoncé), pour
  // que _saveResponsesSharded() route ses écritures vers le vrai shard actif au lieu d'en
  // recréer un déjà existant et d'y écraser des entrées.
  const realShardCount = shardIds.length
    ? Math.max(...shardIds.map(Number).filter(n => !isNaN(n))) + 1
    : 0;
  window._respShardCount = realShardCount;

  // Auto-réparation du compteur du document principal quand il sous-estime la réalité : sans
  // ça, chaque nouveau chargement de page repartirait du même compteur faux et dépendrait à
  // nouveau du listing pour voir les shards oubliés.
  if (realShardCount > declaredShardCount && _netOnline()) {
    mainRef.set({ responseShardCount: realShardCount }, { merge: true })
      .then(() => console.log('[offline] responseShardCount réparé :', declaredShardCount, '→', realShardCount))
      .catch(e => console.warn('[offline] Réparation de responseShardCount échouée:', e.message));
  }

  // ---- Filet de sécurité local (voir js/localmirror.js) ----
  // Jusqu'ici, si les lectures ci-dessus revenaient vides ou tronquées (cache Firestore absent
  // parce que enablePersistence() avait échoué — plusieurs onglets ouverts —, ou shard trop
  // lent à sortir d'IndexedDB), l'appli se contentait de ce résultat dégradé et affichait une
  // progression vide, sans le moindre avertissement. Le miroir ne comble QUE les trous d'une
  // lecture démontrablement dégradée : quand la lecture serveur est saine, elle reste seule
  // maîtresse (sinon une réinitialisation volontaire serait aussitôt annulée).
  if (typeof _mirrorFillGaps === 'function') {
    try {
      await _mirrorFillGaps(uid, merged, { incomplete: window._respLoadIncomplete });
    } catch (e) { console.warn('[offline] Comblement depuis le miroir impossible:', e.message); }
  }

  // Le miroir n'est rafraîchi qu'à partir d'une lecture réputée COMPLÈTE — écrire le résultat
  // d'une lecture dégradée reviendrait à graver la perte de données dans le filet de sécurité.
  if (typeof _mirrorSaveResponses === 'function' && !window._respLoadIncomplete) {
    _mirrorSaveResponses(uid, merged).catch(() => {});
  }

  const exists = doc.exists || realShardCount > 0 || Object.keys(merged).length > 0;
  return { exists, data: () => ({ ...primaryData, responses: merged }), incomplete: window._respLoadIncomplete };
}

/**
 * _saveResponsesSharded(uid, updates) – Écrit `updates` ({clé: entrée, ...}) dans les shards
 * corrects : une entrée déjà connue (présente dans window._respKeyShard, alimenté par
 * _loadMergedResponses ci-dessus) retourne vers SON shard d'origine ; une entrée nouvelle
 * rejoint le shard "actif" (le dernier créé) tant qu'il a de la place, sinon un nouveau shard
 * est créé. Retourne { targetShards, newShardCreated } — utilisé par saveResponsesWithOfflineFallback
 * pour savoir s'il faut aussi mettre à jour responseShardCount sur le document principal.
 */
async function _saveResponsesSharded(uid, updates) {
  const keys = Object.keys(updates);
  if (!keys.length) return { targetShards: [], newShardCreated: false };

  // Filet de sécurité : si aucun chargement n'a eu lieu avant cette écriture sur cette page
  // (window._respKeyShard jamais initialisé), charger maintenant pour router correctement.
  if (!window._respKeyShard) {
    await _loadMergedResponses(uid).catch(() => {});
  }
  window._respKeyShard = window._respKeyShard || {};
  window._respShardEntryCounts = window._respShardEntryCounts || {};
  let shardCount = window._respShardCount || 0;
  let newShardCreated = false;

  // Shard "actif" pour les nouvelles entrées : le dernier existant, ou le tout premier (0) si
  // aucun shard n'existe encore pour cet utilisateur (tout premier enregistrement).
  let activeShard = Math.max(0, shardCount - 1);
  if (shardCount === 0) { shardCount = 1; newShardCreated = true; }
  let activeCount = window._respShardEntryCounts[activeShard] || 0;

  const byShard = {}; // { shardIdx: { key: entry, ... } }
  keys.forEach(key => {
    let target = window._respKeyShard[key];
    if (target === undefined) {
      // Nouvelle entrée : rejoint le shard actif, sauf s'il est plein → nouveau shard.
      if (activeCount >= RESPONSE_SHARD_CAPACITY) {
        activeShard += 1;
        shardCount = activeShard + 1;
        activeCount = 0;
        newShardCreated = true;
      }
      target = activeShard;
      activeCount += 1;
      window._respKeyShard[key] = target;
    }
    if (!byShard[target]) byShard[target] = {};
    // Fusion avec l'entrée COMPLÈTE déjà connue localement (currentResponses, tenu à jour dans
    // toute l'app) AVANT écriture : la cible Firestore ci-dessous est un CHEMIN POINTÉ
    // ('responses.<key>'), qui REMPLACE toute la valeur à ce chemin — contrairement à un objet
    // imbriqué {responses:{[key]:...}} avec set(merge:true), qui aurait fusionné en profondeur.
    // Sans cette fusion, un appelant passant une mise à jour PARTIELLE (ex. juste {marked:true},
    // comme le font les boutons 🔖⭐🚫✏️) effacerait silencieusement les autres champs de
    // l'entrée (status, srInterval, nextReview...) au lieu de les préserver.
    const existing = (typeof currentResponses !== 'undefined' && currentResponses && currentResponses[key]) || {};
    byShard[target][key] = _stripUndefinedFields({ ...existing, ...updates[key] });
  });
  window._respShardEntryCounts[activeShard] = activeCount;
  window._respShardCount = shardCount;

  const mainRef = db.collection('quizProgress').doc(uid);
  const targetShards = Object.keys(byShard).map(Number);
  console.log('[shard-write] tentative sur shard(s)', targetShards, 'clés:', keys);

  // CAUSE RACINE des réponses qui « ne se sauvegardaient pas » : cette écriture utilisait
  // set({'responses.<clé>': entrée}, {merge:true}). Or set() n'interprète PAS un point comme
  // un séparateur de chemin (seul update() le fait) : la clé entière devenait UN SEUL nom de
  // champ littéral « responses.question_X » posé à la racine du document, au lieu d'une entrée
  // dans la map `responses`. Rien n'atterrissait donc jamais dans `responses`, et
  // _loadMergedResponses() (qui lit data().responses) ne retrouvait pas la réponse.
  //
  // Le symptôme était trompeur : la vérification ci-dessous ne trouvait la clé que lorsqu'elle
  // existait DÉJÀ dans `responses` (question déjà répondue avant la migration en shards), d'où
  // des « 1/1 confirmée » rassurants sur le shard 0 alors que l'écriture réelle était bancale,
  // et des « 0/1 » systématiques dès qu'il s'agissait d'une question JAMAIS répondue — dont
  // toutes les nouvelles entrées, qui vont par construction dans le shard actif. C'est
  // exactement le « 1445 → 1446 → retour à 1445 » : seules les questions déjà connues
  // semblaient tenir, aucune nouveauté n'était réellement enregistrée.
  //
  // Objet IMBRIQUÉ ({responses: {clé: entrée}}) avec merge:true : fusion en profondeur, sans
  // aucune analyse de chemin — donc compatible avec les clés contenant espaces, accents ou
  // chiffres (« question_PROCÉDURE RADIO_205 ») — et les autres entrées du shard sont
  // préservées.
  const writeShard = shardIdx => {
    return mainRef.collection('responseShards').doc(String(shardIdx))
      .set({ responses: byShard[shardIdx] }, { merge: true })
      .then(() => console.log('[shard-write] set() résolu pour shard', shardIdx))
      .catch(e => { console.error('[shard-write] set() a rejeté pour shard', shardIdx, e); throw e; });
  };
  const verifyShard = async shardIdx => {
    const check = await mainRef.collection('responseShards').doc(String(shardIdx)).get({ source: 'server' });
    const responses = (check.exists && check.data().responses) || {};
    const writtenKeys = Object.keys(byShard[shardIdx]);
    const confirmed = writtenKeys.filter(k => responses[k] !== undefined);
    console.log('[shard-write] VÉRIFICATION shard', shardIdx, '—', confirmed.length + '/' + writtenKeys.length, 'clé(s) confirmée(s) sur le serveur:', confirmed);
    return confirmed.length === writtenKeys.length;
  };

  await Promise.all(targetShards.map(writeShard));

  /* HORS-LIGNE : ne surtout PAS tenter la vérification serveur ci-dessous.
     Firestore met l'écriture en file d'attente locale et la rejouera à la reconnexion — c'est
     le comportement voulu. Mais la vérification, elle, exige { source: 'server' } : hors-ligne
     elle ne peut QUE échouer, était réessayée trois fois avec des pauses (d'où les longues
     secondes d'attente après chaque réponse), puis levait une exception. L'appelant en
     concluait « sauvegarde échouée » alors que la donnée était bel et bien mise en file.
     La réponse est enregistrée localement (miroir + file Firestore) et confirmée au retour du
     réseau ; on note la clé comme « en attente » pour pouvoir l'afficher et la rejouer. */
  if (typeof _netOnline === 'function' && !_netOnline()) {
    // On note la NATURE de chaque modification en même temps que la clé (réponse, fréquence,
    // note…), pour que Configuration puisse annoncer précisément ce qui reste à envoyer.
    targetShards.forEach(shardIdx => {
      Object.keys(byShard[shardIdx]).forEach(k => _markPendingSync(uid, k, byShard[shardIdx][k]));
    });
    console.log('[shard-write] hors-ligne : écriture mise en file, vérification différée à la reconnexion');
    return { targetShards, newShardCreated, pending: true };
  }

  console.log('[shard-write] Promise.all terminé, vérification directe sur le serveur…');

  const unconfirmedShards = [];
  await Promise.all(targetShards.map(async shardIdx => {
    try {
      if (!(await verifyShard(shardIdx))) unconfirmedShards.push(shardIdx);
    } catch (e) {
      console.error('[shard-write] Échec de la vérification serveur pour shard', shardIdx, e);
      unconfirmedShards.push(shardIdx);
    }
  }));

  // Jusqu'à 2 nouvelles tentatives (écriture + revérification) pour chaque shard resté non
  // confirmé, avec un court délai pour laisser le temps à une connexion capricieuse de
  // rétablir un aller-retour réseau réel.
  for (let attempt = 1; attempt <= 2 && unconfirmedShards.length; attempt++) {
    console.warn('[shard-write] ⚠️ Non confirmé pour shard(s)', unconfirmedShards, '— nouvelle tentative', attempt + '/2');
    await new Promise(r => setTimeout(r, 1000 * attempt));
    const stillUnconfirmed = [];
    await Promise.all(unconfirmedShards.map(async shardIdx => {
      try {
        await writeShard(shardIdx);
        if (!(await verifyShard(shardIdx))) stillUnconfirmed.push(shardIdx);
      } catch (e) {
        console.error('[shard-write] Tentative', attempt, 'échouée pour shard', shardIdx, e);
        stillUnconfirmed.push(shardIdx);
      }
    }));
    unconfirmedShards.length = 0;
    unconfirmedShards.push(...stillUnconfirmed);
  }

  if (unconfirmedShards.length) {
    const unconfirmedKeys = unconfirmedShards.flatMap(shardIdx => Object.keys(byShard[shardIdx]));
    console.error('[shard-write] ❌ ÉCRITURE DÉFINITIVEMENT NON CONFIRMÉE après 3 tentatives pour', unconfirmedKeys);
    throw new Error('Sauvegarde non confirmée par le serveur pour : ' + unconfirmedKeys.join(', '));
  }

  if (newShardCreated) {
    await mainRef.set({ responseShardCount: shardCount }, { merge: true });
  }

  return { targetShards, newShardCreated };
}

/**
 * _updateResponseFieldsSharded(uid, dottedUpdate) – Équivalent shardé de
 * `db.collection('quizProgress').doc(uid).update(dottedUpdate)` pour les mises à jour à
 * chemins pointés CIBLANT `responses` (ex: {'responses.question_x.status': FieldValue.delete()}) —
 * utilisé par les outils de réinitialisation partielle (js/stats.js : _resetCategoryStats,
 * _resetCategoryField, _resetCategoryFlaggedField, _resetGroupStats, _resetGroupFlaggedStats),
 * qui doivent supprimer PRÉCISÉMENT certains champs d'une entrée (status/srInterval/nextReview/
 * marked/important) sans toucher au reste — un set(..., {merge:true}) ne le permettrait pas
 * (il ne supprime jamais un champ absent de l'objet fourni).
 *
 * Route chaque chemin vers SON shard (via window._respKeyShard, alimenté par
 * _loadMergedResponses — l'appelant doit l'avoir chargé avant, ce qui est déjà le cas : ces
 * outils lisent toujours les réponses existantes avant de construire `dottedUpdate`).
 */
async function _updateResponseFieldsSharded(uid, dottedUpdate) {
  const paths = Object.keys(dottedUpdate);
  if (!paths.length) return;
  if (!window._respKeyShard) await _loadMergedResponses(uid).catch(() => {});
  window._respKeyShard = window._respKeyShard || {};

  const byShard = {}; // { shardIdx: { 'responses.key.field': value, ... } }
  const skipped = [];
  paths.forEach(path => {
    // path = "responses.<key>.<field>" — <key> peut lui-même contenir des points (aucun cas
    // réel ici, les clés sont générées par getKeyFor() sans point), donc un split simple suffit.
    const parts = path.split('.');
    const key = parts[1];
    const shardIdx = window._respKeyShard[key];
    if (shardIdx === undefined) { skipped.push(key); return; }
    if (!byShard[shardIdx]) byShard[shardIdx] = {};
    byShard[shardIdx][path] = dottedUpdate[path];
  });
  if (skipped.length) {
    console.warn('[offline] _updateResponseFieldsSharded : ' + skipped.length + ' clé(s) sans shard connu, ignorée(s):', skipped.slice(0, 5));
  }

  const mainRef = db.collection('quizProgress').doc(uid);
  await Promise.all(Object.keys(byShard).map(shardIdx =>
    mainRef.collection('responseShards').doc(String(shardIdx)).update(byShard[shardIdx])
  ));
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

  // Charger le contexte existant soit du scope global, soit via _loadMergedResponses (qui lit
  // le document principal ET tous ses shards — voir plus haut — et alimente au passage
  // window._respKeyShard nécessaire au routage correct de l'écriture ci-dessous).
  let existing = {};
  if (typeof currentResponses !== 'undefined' && currentResponses) {
    existing = currentResponses;
    if (!window._respKeyShard) await _loadMergedResponses(uid).catch(() => {});
  } else {
    try {
      const doc = await _loadMergedResponses(uid);
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
  // Miroir IndexedDB (js/localmirror.js) — mis à jour AVANT la tentative Firestore, exactement
  // comme le backup localStorage ci-dessus, mais sans son plafond de quelques Mio (déjà saturé
  // en pratique par les caches météo, ce qui faisait échouer le backup en silence). C'est ce
  // miroir que _loadMergedResponses() relira automatiquement au prochain démarrage si la
  // lecture Firestore revient dégradée — donc y compris quand l'écriture ci-dessous échoue
  // faute de réseau, cas où l'on aura justement le plus besoin de lui.
  if (typeof _mirrorApplyDelta === 'function') {
    _mirrorApplyDelta(uid, cleanedResponsesToSave).catch(e => console.warn('[offline] Miroir non mis à jour:', e.message));
  }

  // Sauvegarder chaque réponse dans SON shard (voir _saveResponsesSharded plus haut — router
  // par clé individuelle, jamais un remplacement en bloc, pour ne jamais écraser une donnée
  // sauvegardée sur un autre appareil depuis le chargement de cette page), en parallèle avec
  // lastUpdated sur le document principal et l'historique en attente — trois documents
  // indépendants, pas de dépendance d'ordre entre eux.
  try {
    const mainRef = db.collection('quizProgress').doc(uid);
    const toSave = {};
    Object.keys(cleanedResponsesToSave).forEach(key => { toSave[key] = merged[key]; });

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

    await Promise.all([
      _saveResponsesSharded(uid, toSave),
      mainRef.set({ lastUpdated: firebase.firestore.Timestamp.now() }, { merge: true }),
      writeHistoryEntries()
    ]);

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
      // inline (via update() + FieldValue.delete(), en notation pointée, pour ne toucher QUE
      // ce champ et laisser le reste de chaque entrée intact) — routé vers le bon shard via
      // _updateResponseFieldsSharded (voir plus haut), `responses.<key>.statusLog` ne vivant
      // plus forcément sur le document principal.
      const mainUpdate = {};
      chunk.forEach(k => { mainUpdate['responses.' + k + '.statusLog'] = firebase.firestore.FieldValue.delete(); });
      await _updateResponseFieldsSharded(uid, mainUpdate);

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

/**
 * _deleteAllResponseShards(uid) – Supprime intégralement la sous-collection
 * quizProgress/{uid}/responseShards (voir le préambule "Répartition de responses..." plus
 * haut). Utilisée par resetStats() (js/stats.js) pour que "Réinitialiser les statistiques"
 * efface bien TOUTES les réponses, quel que soit le nombre de shards créés au fil du temps.
 */
async function _deleteAllResponseShards(uid) {
  if (!uid) return;
  const shardsCol = db.collection('quizProgress').doc(uid).collection('responseShards');
  const snap = await shardsCol.get();
  if (!snap.empty) {
    const docs = snap.docs;
    const CHUNK = 450;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = db.batch();
      docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  }
  window._respKeyShard = {};
  window._respShardEntryCounts = {};
  window._respShardCount = 0;
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

  const doc = await _loadMergedResponses(uid);
  const serverResponses = doc.exists ? (doc.data().responses || {}) : {};

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

  await _saveResponsesSharded(uid, toRestore);

  if (typeof currentResponses !== 'undefined') {
    currentResponses = normalizeResponses({ ...serverResponses, ...toRestore });
  }
  return { restoredCount: keys.length };
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
    // top:0 + un padding-top qui réserve la barre de statut Android (env(safe-area-inset-top),
    // filet de sécurité derrière le réglage natif de js/statusbar.js — vaut 0 sur le web) :
    // ce bandeau est le plus haut de toute l'appli, c'est lui qui donnait le ton du mélange
    // avec l'horloge/les icônes système quand il restait affiché en permanence pendant un vol.
    bar.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 10000;
      padding: calc(4px + env(safe-area-inset-top, 0px)) 12px 4px; text-align: center;
      font-size: 13px; font-weight: bold; transition: all 0.3s ease; display: none;
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
