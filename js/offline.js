// ============================================================
// offline.js — Gestion hors-ligne avec IndexedDB + sync Firestore
// ============================================================

// ---- IndexedDB Setup ----
const OFFLINE_DB_NAME = 'quizPPL_offline';
const OFFLINE_DB_VERSION = 1;
const STORE_PENDING = 'pendingWrites';  // Écritures en attente de sync

let offlineDB = null;

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    if (offlineDB) return resolve(offlineDB);
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      // Store pour les écritures en attente
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        db.createObjectStore(STORE_PENDING, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (e) => {
      offlineDB = e.target.result;
      resolve(offlineDB);
    };
    request.onerror = (e) => {
      console.error('[offline] Erreur IndexedDB:', e);
      reject(e);
    };
  });
}

// ---- Ajouter une écriture en attente ----
async function addPendingWrite(operation) {
  const idb = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_PENDING, 'readwrite');
    const store = tx.objectStore(STORE_PENDING);
    operation.createdAt = Date.now();
    store.add(operation);
    tx.oncomplete = () => {
      updateOfflineBadge();
      resolve();
    };
    tx.onerror = (e) => reject(e);
  });
}

// ---- Récupérer toutes les écritures en attente ----
async function getPendingWrites() {
  const idb = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_PENDING, 'readonly');
    const store = tx.objectStore(STORE_PENDING);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e);
  });
}

// ---- Supprimer une écriture après sync réussie ----
async function removePendingWrite(id) {
  const idb = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_PENDING, 'readwrite');
    const store = tx.objectStore(STORE_PENDING);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

// ---- Compter les écritures en attente ----
async function countPendingWrites() {
  const idb = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(STORE_PENDING, 'readonly');
    const store = tx.objectStore(STORE_PENDING);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(0);
  });
}

// ============================================================
// Wrapper Firestore avec fallback offline
// ============================================================

/**
 * Sauvegarde les réponses dans Firestore, ou en local si offline.
 * @param {string} uid
 * @param {Object} responsesToSave - Les nouvelles réponses à merger
 * @returns {Object} merged responses (local or from Firestore)
 */
async function saveResponsesWithOfflineFallback(uid, responsesToSave) {
  // S'assurer que la persistance Firestore est initialisée
  await _ensurePersistence();
  // D'abord, essayer de récupérer les réponses existantes (locales au pire)
  let existing = {};
  try {
    const doc = await getDocWithTimeout(db.collection('quizProgress').doc(uid));
    if (doc.exists) existing = doc.data().responses || {};
  } catch (e) {
    console.warn('[offline] Impossible de lire Firestore, utilisation du cache local');
    existing = currentResponses || {};
  }

  // Merger les réponses
  const merged = { ...existing };
  Object.keys(responsesToSave).forEach(key => {
    if (merged[key]) {
      merged[key] = { ...merged[key], ...responsesToSave[key] };
    } else {
      merged[key] = responsesToSave[key];
    }
  });

  // Sauvegarder via Firestore (fonctionne aussi offline grâce à enablePersistence)
  try {
    await db.collection('quizProgress').doc(uid).set(
      { responses: merged, lastUpdated: firebase.firestore.Timestamp.now() },
      { merge: true }
    );
    // Lire depuis le cache local (inclut les écritures en attente)
    const fresh = await db.collection('quizProgress').doc(uid).get({ source: 'cache' });
    return normalizeResponses(fresh.exists ? fresh.data().responses : merged);
  } catch (e) {
    console.warn('[offline] Firestore set échoué, fallback IndexedDB:', e.message);
    // Stocker en IndexedDB pour sync ultérieure (cas rare: SDK non init)
    const serializableResponses = {};
    Object.entries(responsesToSave).forEach(([k, v]) => {
      serializableResponses[k] = { ...v };
      if (v.timestamp && typeof v.timestamp !== 'number' && !v.timestamp.seconds) {
        serializableResponses[k].timestamp = { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 };
      }
    });
    await addPendingWrite({ type: 'saveResponses', uid, data: serializableResponses });
    currentResponses = normalizeResponses(merged);
    return currentResponses;
  }
}

/**
 * Sauvegarde un toggle (marquer/important) avec fallback offline
 */
async function saveToggleWithOfflineFallback(uid, key, payload) {
  await _ensurePersistence();
  try {
    await db.collection('quizProgress').doc(uid).set(payload, { merge: true });
  } catch (e) {
    console.warn('[offline] Toggle sauvegardé IndexedDB:', key);
    await addPendingWrite({ type: 'saveToggle', uid, key, data: payload });
  }
}

/**
 * Sauvegarde dailyCount avec fallback offline
 */
async function saveDailyCountOffline(uid) {
  try {
    await saveDailyCount(uid);
  } catch (e) {
    console.warn('[offline] dailyCount sauvegardé IndexedDB');
    const today = new Date();
    const utcKey = today.toISOString().slice(0, 10);
    const absoluteCount = Math.max(
      parseInt(localStorage.getItem('dailyCountRatchet_' + utcKey)) || 0,
      parseInt(localStorage.getItem('dailyAnswered_' + utcKey)) || 0
    );
    await addPendingWrite({
      type: 'saveDailyCount',
      uid,
      absoluteCount,
      date: utcKey
    });
  }
}

/**
 * Sauvegarde sessionResult avec fallback offline
 */
async function saveSessionResultOffline(uid, correct, total, category, sessionDate) {
  // Utiliser la date passée en paramètre (ou en générer une si non fournie)
  // La date est générée dans validerReponses() et partagée avec _saveSessionToLocalBackup
  // pour que la déduplication fonctionne correctement
  if (!sessionDate) sessionDate = new Date().toISOString();

  // Sauvegarder en localStorage comme backup (si pas déjà fait par validerReponses)
  if (typeof _saveSessionToLocalBackup === 'function') {
    _saveSessionToLocalBackup(correct, total, category, sessionDate);
  }
  try {
    await saveSessionResult(uid, correct, total, category, sessionDate);
  } catch (e) {
    console.warn('[offline] sessionResult sauvegardé IndexedDB');
    await addPendingWrite({
      type: 'saveSessionResult',
      uid,
      correct,
      total,
      category,
      date: sessionDate
    });
  }
}

// ============================================================
// Synchronisation — rejouer les écritures en attente
// ============================================================

let isSyncing = false;

async function syncPendingWrites() {
  if (isSyncing) return;
  if (!navigator.onLine) return;
  
  // Vérifier la vraie connectivité avant de tenter la sync
  const reallyOnline = await _checkRealConnectivity();
  if (!reallyOnline) {
    return;
  }
  
  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
  if (!uid) return;
  
  // D'abord, flusher les écritures Firestore en attente (enablePersistence buffer)
  try {
    if (typeof db.waitForPendingWrites === 'function') {
      await db.waitForPendingWrites();
    }
  } catch (e) {
    console.warn('[offline] waitForPendingWrites échoué:', e.message);
  }

  // Synchroniser explicitement les sessions localStorage vers Firestore
  // C'est le mécanisme fiable de sync cross-device pour les sessions
  await _syncLocalSessionsToFirestore(uid);
  
  const pending = await getPendingWrites();
  if (pending.length === 0) {
    return;
  }
  
  isSyncing = true;
  showSyncNotification(`Synchronisation de ${pending.length} éléments...`);
  
  let synced = 0;
  let failed = 0;
  
  for (const op of pending) {
    try {
      switch (op.type) {
        case 'saveResponses': {
          // Récupérer les réponses actuelles de Firestore
          const doc = await db.collection('quizProgress').doc(op.uid).get();
          const existing = doc.exists ? doc.data().responses || {} : {};
          // Merger avec les réponses offline
          const merged = { ...existing };
          Object.keys(op.data).forEach(key => {
            if (merged[key]) {
              // Garder le timestamp le plus récent
              const existingTs = merged[key].timestamp?.seconds || 0;
              const offlineTs = op.data[key].timestamp?.seconds || 0;
              if (offlineTs >= existingTs) {
                merged[key] = { ...merged[key], ...op.data[key] };
              }
            } else {
              merged[key] = op.data[key];
            }
          });
          await db.collection('quizProgress').doc(op.uid).set(
            { responses: merged, lastUpdated: firebase.firestore.Timestamp.now() },
            { merge: true }
          );
          break;
        }
        case 'saveToggle': {
          await db.collection('quizProgress').doc(op.uid).set(op.data, { merge: true });
          break;
        }
        case 'saveDailyCount': {
          // Écrire la valeur absolue stockée (ou recalculer depuis localStorage)
          const today = new Date();
          const dateKey = op.date || today.toISOString().slice(0, 10);
          const localKey = dateKey; // même format
          const absVal = op.absoluteCount || Math.max(
            parseInt(localStorage.getItem('dailyCountRatchet_' + dateKey)) || 0,
            parseInt(localStorage.getItem('dailyAnswered_' + dateKey)) || 0,
            op.count || 0
          );
          if (absVal > 0) {
            const dkLocal = dateKey.length === 10 ? dateKey : today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
            const upd = {};
            upd['dailyHistory.' + dkLocal] = absVal;
            await db.collection('quizProgress').doc(op.uid).set(upd, { merge: true });
          }
          break;
        }
        case 'saveSessionResult': {
          await saveSessionResult(op.uid, op.correct, op.total, op.category, op.date);
          break;
        }
        default:
          console.warn('[offline] Type d\'opération inconnu:', op.type);
      }
      await removePendingWrite(op.id);
      synced++;
    } catch (e) {
      console.error('[offline] Échec sync pour op', op.id, ':', e.message);
      failed++;
    }
  }
  
  isSyncing = false;
  updateOfflineBadge();
  
  const msg = failed === 0
    ? `Synchronisation terminée ! ${synced} élément(s) envoyé(s).`
    : `Sync partielle : ${synced} OK, ${failed} en erreur.`;
  showSyncNotification(msg);
  
  // Recharger les réponses fraîches depuis Firestore
  if (synced > 0 && uid) {
    try {
      const fresh = await db.collection('quizProgress').doc(uid).get();
      if (fresh.exists) {
        currentResponses = normalizeResponses(fresh.data().responses);
        if (typeof updateModeCounts === 'function') updateModeCounts();
        // Nettoyer le backup localStorage des sessions déjà dans Firestore
        const freshSessions = fresh.data().sessionHistory || [];
        if (typeof _cleanLocalSessionBackup === 'function') _cleanLocalSessionBackup(freshSessions);
        // Limiter l'historique à 200 sessions si nécessaire
        if (typeof _trimSessionHistory === 'function' && freshSessions.length > 200) {
          _trimSessionHistory(uid).catch(e => console.warn('[sync] trim error:', e.message));
        }
      }
    } catch (e) { /* ignore */ }
    
    // Si on est sur la page stats.html, rafraîchir l'affichage
    if (window.location.pathname.endsWith('stats.html') && typeof initStats === 'function') {
      try { await initStats(); } catch (e) { /* ignore */ }
    }
  }
}

/**
 * _syncLocalSessionsToFirestore() – Pousse toutes les sessions du backup
 * localStorage vers Firestore via arrayUnion (sync explicite cross-device).
 * arrayUnion déduplique automatiquement les entrées identiques.
 */
async function _syncLocalSessionsToFirestore(uid) {
  if (!uid) return;
  const localSessions = typeof _getLocalSessionBackup === 'function'
    ? _getLocalSessionBackup() : [];
  if (!localSessions.length) {
    return;
  }
  const docRef = db.collection('quizProgress').doc(uid);
  let pushed = 0;
  // Pousser par lots de 10 (pour éviter des écritures trop grosses)
  const batchSize = 10;
  for (let i = 0; i < localSessions.length; i += batchSize) {
    const batch = localSessions.slice(i, i + batchSize);
    try {
      // arrayUnion avec plusieurs entrées à la fois
      await docRef.set(
        {
          sessionHistory: firebase.firestore.FieldValue.arrayUnion(...batch),
          lastUpdated: firebase.firestore.Timestamp.now()
        },
        { merge: true }
      );
      pushed += batch.length;
    } catch (e) {
    }
  }
  console.log('[sync]', pushed, '/', localSessions.length, 'sessions pushées vers Firestore');
  // Relire le document pour avoir la version complète du serveur
  try {
    const fresh = await docRef.get({ source: 'server' });
    if (fresh.exists) {
      const serverSessions = fresh.data().sessionHistory || [];
      // Nettoyer le localStorage : retirer les sessions déjà sur le serveur
      if (typeof _cleanLocalSessionBackup === 'function') {
        _cleanLocalSessionBackup(serverSessions);
      }
    }
  } catch (e) {
    console.warn('[sync] Impossible de relire le doc après push:', e.message);
  }
}

// ============================================================
// UI — Indicateur online/offline + badge
// ============================================================

function createOfflineIndicator() {
  // Barre de statut en haut de page
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
    // navigator.onLine dit false → on est sûrement offline
    _showOfflineBar(bar);
    return;
  }
  
  // navigator.onLine dit true → vérifier avec un vrai fetch (peut mentir sur mobile)
  bar.style.background = '#78909c';
  bar.style.color = 'white';
  bar.textContent = '⏳ Vérification...';
  bar.style.display = 'block';
  
  _checkRealConnectivity().then(isOnline => {
    if (isOnline) {
      bar.style.background = '#4caf50';
      bar.style.color = 'white';
      bar.textContent = '✓ En ligne';
      bar.style.display = 'block';
      // Cacher après 3 secondes si en ligne
      setTimeout(() => {
        bar.style.display = 'none';
      }, 3000);
      // Lancer la sync (IndexedDB pending writes)
      syncPendingWrites();
      // Flusher les écritures Firestore en attente + rafraîchir stats si besoin
      _flushFirestoreAndRefreshStats();
    } else {
      _showOfflineBar(bar);
    }
    updateOfflineBadge();
  });
}

/** Flush Firestore pending writes et rafraîchit stats.html si on y est */
async function _flushFirestoreAndRefreshStats() {
  try {
    if (typeof db !== 'undefined' && typeof db.waitForPendingWrites === 'function') {
      await db.waitForPendingWrites();
    }
  } catch (e) { /* ignore */ }
  // Rafraîchir stats.html si on y est
  if (window.location.pathname.endsWith('stats.html') && typeof initStats === 'function') {
    try { await initStats(); } catch (e) { /* ignore */ }
  }
}

function _showOfflineBar(bar) {
  bar.style.background = '#e53935';
  bar.style.color = 'white';
  bar.textContent = '✈ Hors ligne';
  bar.style.display = 'block';
  updateOfflineBadge();
}

async function _checkRealConnectivity() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    // Utiliser une URL googleapis.com qui est exclue du cache SW
    // (le SW laisse passer toutes les requêtes vers googleapis.com)
    await fetch('https://firestore.googleapis.com/', {
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: ctrl.signal
    });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

async function updateOfflineBadge() {
  const count = await countPendingWrites();
  let badge = document.getElementById('offlinePendingBadge');
  
  if (count === 0) {
    if (badge) badge.style.display = 'none';
    return;
  }
  
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'offlinePendingBadge';
    badge.style.cssText = `
      position: fixed; bottom: 16px; right: 16px; z-index: 10001;
      background: #ff5722; color: white; padding: 8px 16px;
      border-radius: 24px; font-size: 13px; font-weight: bold;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3); cursor: pointer;
    `;
    badge.onclick = () => {
      if (navigator.onLine) {
        syncPendingWrites();
      } else {
        alert('Vous êtes hors-ligne. La synchronisation se fera automatiquement quand la connexion sera rétablie.');
      }
    };
    document.body.appendChild(badge);
  }
  
  badge.textContent = `${count} réponse(s) en attente de sync`;
  badge.style.display = 'block';
}

function showSyncNotification(message) {
  let notif = document.getElementById('syncNotification');
  if (!notif) {
    notif = document.createElement('div');
    notif.id = 'syncNotification';
    notif.style.cssText = `
      position: fixed; bottom: 60px; right: 16px; z-index: 10001;
      background: #333; color: white; padding: 12px 20px;
      border-radius: 8px; font-size: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      transition: opacity 0.5s ease;
    `;
    document.body.appendChild(notif);
  }
  notif.textContent = message;
  notif.style.opacity = '1';
  notif.style.display = 'block';
  
  setTimeout(() => {
    notif.style.opacity = '0';
    setTimeout(() => { notif.style.display = 'none'; }, 500);
  }, 4000);
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
    const reg = await navigator.serviceWorker.register('sw.js');
    console.log('[SW] Service Worker enregistré, scope:', reg.scope);
    
    // Écouter les mises à jour
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'activated') {
          console.log('[SW] Nouvelle version du cache installée');
        }
      });
    });

    // Recharger la page quand un nouveau SW prend le contrôle
    // (garantit que les JSON mis à jour sont servis depuis le nouveau cache)
    let _swRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (_swRefreshing) return;
      _swRefreshing = true;
      console.log('[SW] Nouveau SW actif — rechargement pour mettre à jour les données');
      window.location.reload();
    });
  } catch (e) {
    console.error('[SW] Erreur d\'enregistrement:', e);
  }
}

// ============================================================
// Init — Écouter les changements de connectivité
// ============================================================

function initOffline() {
  // Ouvrir IndexedDB
  openOfflineDB();
  
  // Enregistrer le Service Worker
  registerServiceWorker();
  
  // Créer l'indicateur de statut
  createOfflineIndicator();
  
  // Écouter les événements online/offline
  window.addEventListener('online', () => {
    console.log('[offline] Connexion rétablie !');
    updateOnlineStatus();
  });
  
  window.addEventListener('offline', () => {
    console.log('[offline] Connexion perdue');
    updateOnlineStatus();
  });
  
  // Vérifier s'il y a des écritures en attente au démarrage
  if (navigator.onLine) {
    setTimeout(syncPendingWrites, 2000);
  }
  
  console.log('[offline] Module hors-ligne initialisé');
}

// Lancer l'init dès que le DOM est prêt
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOffline);
} else {
  initOffline();
}
