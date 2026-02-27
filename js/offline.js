// ============================================================
// offline.js — Gestion hors-ligne avec Firestore native persistence
// ============================================================

// ============================================================
// Wrapper Firestore sans IndexedDB manuel
// ============================================================

/**
 * Sauvegarde les réponses dans Firestore.
 * Firestore gère automatiquement la persistence hors-ligne et la synchronisation.
 * @param {string} uid
 * @param {Object} responsesToSave - Les nouvelles réponses à merger
 * @returns {Object} merged responses (local or from Firestore)
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

  // Merger les réponses en mémoire
  const merged = { ...existing };
  Object.keys(responsesToSave).forEach(key => {
    if (merged[key]) {
      merged[key] = { ...merged[key], ...responsesToSave[key] };
    } else {
      merged[key] = responsesToSave[key];
    }
  });

  // Sauvegarder via Firestore (l'écriture est mise en file d'attente si offline)
  try {
    // Note: set() retourne une promesse qui résout une fois l'écriture commise (ou persistée localement)
    await db.collection('quizProgress').doc(uid).set(
      { responses: merged, lastUpdated: firebase.firestore.Timestamp.now() },
      { merge: true }
    );
    
    // Mettre à jour l'objet global si présent
    if (typeof currentResponses !== 'undefined') {
      currentResponses = normalizeResponses(merged);
    }
    return normalizeResponses(merged);
  } catch (e) {
    console.error('[offline] Firestore save failed permanently:', e);
    // En cas d'erreur, on retourne quand même le merged local pour ne pas bloquer l'UI
    if (typeof currentResponses !== 'undefined') {
      currentResponses = normalizeResponses(merged);
    }
    return normalizeResponses(merged);
  }
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
// Init
// ============================================================

function initOffline() {
  registerServiceWorker();
  createOfflineIndicator();
  
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  
  console.log('[offline] Module simplifié initialisé (Firestore Persistence)');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOffline);
} else {
  initOffline();
}
