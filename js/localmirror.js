// ============================================================
// localmirror.js — Miroir local des réponses, INDÉPENDANT de Firestore
// ============================================================
//
// POURQUOI CE FICHIER EXISTE (incident vécu, 4 h de révision perdues en vol) :
//
// Toute la progression hors-ligne reposait jusqu'ici sur UNE SEULE chose : le cache IndexedDB
// interne de Firestore (db.enablePersistence()). Or ce cache peut être totalement absent sans
// le moindre message :
//   • enablePersistence() échoue en 'failed-precondition' dès que le site est ouvert dans
//     PLUSIEURS onglets — cas courant — et Firestore retombe alors sur un cache EN MÉMOIRE,
//     perdu au premier changement de page ;
//   • une lecture de shard depuis IndexedDB peut dépasser le délai imparti sur un téléphone
//     Android (un shard = jusqu'à 2000 réponses, ~1 Mio à désérialiser).
// Dans les deux cas la lecture ne "plante" pas : elle renvoie simplement MOINS de réponses,
// voire zéro. L'appli affiche alors « 0 vue, 0 révision due » sur 4742 questions correctement
// chargées — exactement le symptôme constaté en vol : les questions étaient là, la progression
// avait disparu, et plus rien n'était révisable.
//
// Une sauvegarde de secours existait déjà (_backupResponsesLocally, js/offline.js) mais :
//   1. elle vit dans localStorage, plafonné à ~5 Mio et DÉJÀ rempli à ~3,2 Mio par les caches
//      météo/cartes de l'appli — l'écriture échouait donc silencieusement (quota) ;
//   2. elle n'était JAMAIS relue automatiquement : uniquement par un bouton « restaurer » qui
//      réécrit vers Firestore, et qui exige donc d'être EN LIGNE. Strictement inutile en vol.
//
// Ce module corrige les deux points : stockage en IndexedDB (pas de plafond de quelques Mio,
// même origine que le reste des données de l'appli) et relecture AUTOMATIQUE par
// _loadMergedResponses() dès que la lecture Firestore revient manifestement dégradée.
//
// Le miroir n'est JAMAIS considéré comme la source de vérité : il ne sert qu'à COMBLER les
// trous d'une lecture ratée (voir _mirrorFillGaps ci-dessous), jamais à écraser une donnée
// serveur lue correctement.

const MIRROR_DB_NAME = 'quizPplMirror';
const MIRROR_DB_VERSION = 1;
const MIRROR_STORE = 'responses';

let _mirrorDbPromise = null;

/**
 * _mirrorDb() – Ouvre (une seule fois) la base IndexedDB du miroir.
 * Renvoie null — jamais une exception — si IndexedDB est indisponible (navigation privée,
 * stockage bloqué…) : le miroir est un filet de sécurité, son absence ne doit jamais casser
 * un chemin de code appelant.
 */
function _mirrorDb() {
  if (_mirrorDbPromise) return _mirrorDbPromise;
  _mirrorDbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) { resolve(null); return; }
      const req = indexedDB.open(MIRROR_DB_NAME, MIRROR_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(MIRROR_STORE)) {
          db.createObjectStore(MIRROR_STORE, { keyPath: 'uid' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { console.warn('[mirror] Ouverture IndexedDB impossible:', req.error && req.error.message); resolve(null); };
      req.onblocked = () => { console.warn('[mirror] Ouverture IndexedDB bloquée'); resolve(null); };
    } catch (e) {
      console.warn('[mirror] IndexedDB indisponible:', e.message);
      resolve(null);
    }
  });
  return _mirrorDbPromise;
}

/**
 * _mirrorSaveResponses(uid, responses) – Écrit l'intégralité des réponses fusionnées dans le
 * miroir. À n'appeler QUE lorsque `responses` provient d'une lecture réputée COMPLÈTE : écraser
 * le miroir avec le résultat d'une lecture dégradée reviendrait à propager la perte de données
 * que ce module est précisément censé rattraper.
 */
async function _mirrorSaveResponses(uid, responses) {
  if (!uid || !responses) return false;
  const db = await _mirrorDb();
  if (!db) return false;
  const count = Object.keys(responses).length;
  if (!count) return false; // ne jamais remplacer un miroir garni par un objet vide
  return new Promise(resolve => {
    // window._mirrorAvailable — signale aux autres filets de sécurité que CE miroir fonctionne
    // réellement sur cet appareil. _backupResponsesLocally() (js/offline.js) s'en sert pour ne
    // PAS dupliquer inutilement le même instantané complet dans localStorage, plafonné à ~5 Mo
    // et qu'un compte à plusieurs milliers de questions saturait à lui seul.
    try {
      const tx = db.transaction(MIRROR_STORE, 'readwrite');
      tx.objectStore(MIRROR_STORE).put({ uid, responses, savedAt: Date.now(), count });
      tx.oncomplete = () => { window._mirrorAvailable = true; resolve(true); };
      tx.onerror = () => { window._mirrorAvailable = false; console.warn('[mirror] Écriture échouée:', tx.error && tx.error.message); resolve(false); };
      tx.onabort = () => { window._mirrorAvailable = false; console.warn('[mirror] Écriture annulée:', tx.error && tx.error.message); resolve(false); };
    } catch (e) {
      window._mirrorAvailable = false;
      console.warn('[mirror] Écriture impossible:', e.message);
      resolve(false);
    }
  });
}

/**
 * _mirrorLoadResponses(uid) – Relit le miroir. Renvoie { responses, savedAt, count } ou null.
 */
async function _mirrorLoadResponses(uid) {
  if (!uid) return null;
  const db = await _mirrorDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(MIRROR_STORE, 'readonly');
      const req = tx.objectStore(MIRROR_STORE).get(uid);
      req.onsuccess = () => {
        const v = req.result;
        resolve(v && v.responses ? v : null);
      };
      req.onerror = () => { console.warn('[mirror] Lecture échouée:', req.error && req.error.message); resolve(null); };
    } catch (e) {
      console.warn('[mirror] Lecture impossible:', e.message);
      resolve(null);
    }
  });
}

/**
 * _mirrorClear(uid) – Vide le miroir pour cet utilisateur.
 * INDISPENSABLE après une réinitialisation volontaire de la progression : sans ça, le
 * comblement de trous ci-dessous ressusciterait les réponses que l'utilisateur vient
 * justement de supprimer.
 */
async function _mirrorClear(uid) {
  if (!uid) return;
  const db = await _mirrorDb();
  if (!db) return;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(MIRROR_STORE, 'readwrite');
      tx.objectStore(MIRROR_STORE).delete(uid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) { resolve(); }
  });
}

/**
 * _mirrorMergeEntry(existing, incoming) – Vrai si `incoming` doit remplacer `existing`.
 * Même règle de prudence que la fusion des shards dans _loadMergedResponses : on ne remplace
 * que si l'entrée entrante est DÉMONTRABLEMENT plus récente ; au moindre doute (timestamp
 * manquant d'un côté), on garde ce qui est déjà en place.
 */
function _mirrorIsNewer(incoming, existing) {
  const ms = v => {
    const t = v && v.timestamp;
    if (!t) return null;
    return (t.seconds !== undefined) ? t.seconds * 1000 : (typeof t === 'number' ? t : null);
  };
  const a = ms(incoming), b = ms(existing);
  return !!(a && b && a > b);
}

/**
 * _mirrorFillGaps(uid, merged, opts) – Cœur du filet de sécurité.
 *
 * Complète `merged` (résultat de la lecture Firestore) avec les entrées du miroir, MAIS
 * uniquement lorsque cette lecture est manifestement dégradée — sinon le serveur fait foi.
 * Sans cette condition, une suppression volontaire (réinitialisation d'une catégorie, d'un
 * champ…) correctement lue depuis le serveur serait immédiatement annulée par le miroir.
 *
 * Lecture considérée comme dégradée si :
 *   • _loadMergedResponses a levé son drapeau `incomplete` (un shard n'a pas pu être lu), OU
 *   • on est hors-ligne ET le miroir contient STRICTEMENT plus d'entrées que la lecture
 *     (hors-ligne, une lecture correcte doit retrouver au moins autant d'entrées que le
 *     miroir, qui n'est écrit qu'à partir de lectures complètes).
 *
 * Renvoie le nombre d'entrées effectivement restaurées.
 */
async function _mirrorFillGaps(uid, merged, opts) {
  opts = opts || {};
  if (!uid || !merged) return 0;
  const mirror = await _mirrorLoadResponses(uid);
  if (!mirror) return 0;

  const mergedCount = Object.keys(merged).length;
  const mirrorCount = Object.keys(mirror.responses).length;
  const offline = !(typeof appIsOnline === 'function' ? appIsOnline() : navigator.onLine !== false);
  const degraded = !!opts.incomplete || (offline && mirrorCount > mergedCount);

  if (!degraded) return 0;

  let restored = 0;
  Object.keys(mirror.responses).forEach(k => {
    const incoming = mirror.responses[k];
    const existing = merged[k];
    if (existing === undefined) { merged[k] = incoming; restored++; return; }
    if (_mirrorIsNewer(incoming, existing)) { merged[k] = incoming; restored++; }
  });

  if (restored) {
    console.warn('[mirror] Lecture Firestore dégradée (' + mergedCount + ' entrée(s) lue(s), ' +
      mirrorCount + ' dans le miroir) — ' + restored + ' entrée(s) restaurée(s) depuis le miroir local.');
    window._respRestoredFromMirror = restored;
  }
  return restored;
}

/**
 * _mirrorApplyDelta(uid, updates) – Met le miroir à jour au fil de l'eau après une réponse,
 * SANS relire tout Firestore. Appelé depuis saveResponsesWithOfflineFallback() pour que le
 * miroir reste frais même quand l'écriture serveur échoue (hors-ligne) : c'est précisément
 * dans ce cas qu'on aura besoin de lui au prochain démarrage.
 */
async function _mirrorApplyDelta(uid, updates) {
  if (!uid || !updates || !Object.keys(updates).length) return;
  const mirror = await _mirrorLoadResponses(uid);
  const base = (mirror && mirror.responses) || {};
  Object.keys(updates).forEach(k => {
    base[k] = base[k] ? { ...base[k], ...updates[k] } : updates[k];
  });
  await _mirrorSaveResponses(uid, base);
}

/**
 * _mirrorInfo(uid) – Métadonnées pour le diagnostic hors-ligne (configuration.html).
 */
async function _mirrorInfo(uid) {
  const m = await _mirrorLoadResponses(uid);
  if (!m) return null;
  return { count: m.count || Object.keys(m.responses || {}).length, savedAt: m.savedAt || null };
}

window._mirrorSaveResponses = _mirrorSaveResponses;
window._mirrorLoadResponses = _mirrorLoadResponses;
window._mirrorFillGaps = _mirrorFillGaps;
window._mirrorApplyDelta = _mirrorApplyDelta;
window._mirrorClear = _mirrorClear;
window._mirrorInfo = _mirrorInfo;
