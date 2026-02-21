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
      console.log('[offline] Écriture mise en file d\'attente:', operation.type);
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

  // Tenter la sauvegarde Firestore
  try {
    if (!navigator.onLine) throw new Error('offline');
    
    // Remplacer serverTimestamp par un timestamp numérique pour le offline
    const cleanedResponses = {};
    Object.entries(merged).forEach(([k, v]) => {
      cleanedResponses[k] = { ...v };
      // Si c'est un serverTimestamp non résolu, le remplacer
      if (v.timestamp && typeof v.timestamp === 'object' && v.timestamp.hasOwnProperty('_methodName')) {
        cleanedResponses[k].timestamp = { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 };
      }
    });

    await db.collection('quizProgress').doc(uid).set(
      { responses: merged, lastUpdated: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    
    // Re-fetch & normalize
    const fresh = await db.collection('quizProgress').doc(uid).get();
    return normalizeResponses(fresh.data().responses);
  } catch (e) {
    console.warn('[offline] Sauvegarde Firestore échouée, stockage local', e.message);
    
    // Stocker en IndexedDB pour sync ultérieure
    // Convertir les timestamps pour sérialisation
    const serializableResponses = {};
    Object.entries(responsesToSave).forEach(([k, v]) => {
      serializableResponses[k] = { ...v };
      // Remplacer FieldValue.serverTimestamp() par un timestamp numérique
      if (v.timestamp && typeof v.timestamp !== 'number' && !v.timestamp.seconds) {
        serializableResponses[k].timestamp = { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 };
      }
    });

    await addPendingWrite({
      type: 'saveResponses',
      uid: uid,
      data: serializableResponses
    });
    
    // Mettre à jour localement quand même
    currentResponses = normalizeResponses(merged);
    return currentResponses;
  }
}

/**
 * Sauvegarde un toggle (marquer/important) avec fallback offline
 */
async function saveToggleWithOfflineFallback(uid, key, payload) {
  try {
    if (!navigator.onLine) throw new Error('offline');
    await db.collection('quizProgress').doc(uid).set(payload, { merge: true });
  } catch (e) {
    console.warn('[offline] Toggle sauvegardé localement:', key);
    await addPendingWrite({
      type: 'saveToggle',
      uid: uid,
      key: key,
      data: payload
    });
  }
}

/**
 * Sauvegarde dailyCount avec fallback offline
 */
async function saveDailyCountOffline(uid, count) {
  try {
    if (!navigator.onLine) throw new Error('offline');
    await saveDailyCount(uid, count);
  } catch (e) {
    console.warn('[offline] dailyCount sauvegardé localement');
    await addPendingWrite({
      type: 'saveDailyCount',
      uid: uid,
      count: count,
      date: new Date().toISOString().slice(0, 10)
    });
  }
}

/**
 * Sauvegarde sessionResult avec fallback offline
 */
async function saveSessionResultOffline(uid, correct, total, category) {
  try {
    if (!navigator.onLine) throw new Error('offline');
    await saveSessionResult(uid, correct, total, category);
  } catch (e) {
    console.warn('[offline] sessionResult sauvegardé localement');
    await addPendingWrite({
      type: 'saveSessionResult',
      uid: uid,
      correct: correct,
      total: total,
      category: category,
      date: new Date().toISOString()
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
  
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  
  const pending = await getPendingWrites();
  if (pending.length === 0) return;
  
  isSyncing = true;
  console.log(`[offline] Synchronisation de ${pending.length} écritures en attente...`);
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
            { responses: merged, lastUpdated: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
          break;
        }
        case 'saveToggle': {
          await db.collection('quizProgress').doc(op.uid).set(op.data, { merge: true });
          break;
        }
        case 'saveDailyCount': {
          await saveDailyCount(op.uid, op.count);
          break;
        }
        case 'saveSessionResult': {
          await saveSessionResult(op.uid, op.correct, op.total, op.category);
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
  console.log(`[offline] Sync terminée: ${synced} OK, ${failed} erreurs`);
  
  // Recharger les réponses fraîches depuis Firestore
  if (synced > 0 && uid) {
    try {
      const fresh = await db.collection('quizProgress').doc(uid).get();
      if (fresh.exists) {
        currentResponses = normalizeResponses(fresh.data().responses);
        if (typeof updateModeCounts === 'function') updateModeCounts();
      }
    } catch (e) { /* ignore */ }
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
  
  if (navigator.onLine) {
    bar.style.background = '#4caf50';
    bar.style.color = 'white';
    bar.textContent = '✓ En ligne';
    bar.style.display = 'block';
    // Cacher après 3 secondes si en ligne
    setTimeout(() => {
      if (navigator.onLine) bar.style.display = 'none';
    }, 3000);
    // Lancer la sync
    syncPendingWrites();
  } else {
    bar.style.background = '#ff9800';
    bar.style.color = 'white';
    bar.textContent = '✈ Mode hors-ligne — Les réponses sont sauvegardées localement';
    bar.style.display = 'block';
  }
  updateOfflineBadge();
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
