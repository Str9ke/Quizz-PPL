// === helpers.js === Utility functions ===

/**
 * _ensurePersistence() – Attend que enablePersistence() soit prêt.
 * Sur Android lent, enablePersistence() peut prendre 1-2s à initialiser IndexedDB.
 * Sans cette attente, les opérations Firestore utilisent un cache in-memory
 * qui est perdu au changement de page → données offline perdues.
 */
let _persistenceAwaited = false;
async function _ensurePersistence() {
  if (_persistenceAwaited) return;
  if (window._persistenceReady) {
    try { await window._persistenceReady; } catch (e) { /* already handled */ }
  }
  _persistenceAwaited = true;
}

/**
 * getDocWithTimeout() – Lit un document Firestore avec fallback rapide hors-ligne.
 * Si hors-ligne (navigator.onLine === false) → lecture directe du cache Firestore.
 * Si en ligne → lecture réseau avec timeout de 4s, puis fallback cache.
 * @param {firebase.firestore.DocumentReference} docRef
 * @param {number} timeoutMs – Délai max avant fallback cache (défaut 2000ms)
 * @returns {Promise<firebase.firestore.DocumentSnapshot>}
 */
async function getDocWithTimeout(docRef, timeoutMs = 2000) {
  // S'assurer que la persistance Firestore est initialisée
  await _ensurePersistence();
  // Hors-ligne → lecture cache immédiate (pas de timeout réseau)
  if (!navigator.onLine) {
    try {
      return await docRef.get({ source: 'cache' });
    } catch (e) {
      // Pas en cache du tout → retourner un snapshot vide
      console.warn('[getDocWithTimeout] cache miss offline:', e.message);
      return { exists: false, data: () => ({}) };
    }
  }
  // En ligne → essayer réseau, avec timeout court
  try {
    return await Promise.race([
      docRef.get(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Firestore timeout')), timeoutMs)
      )
    ]);
  } catch (e) {
    console.warn('[getDocWithTimeout] réseau lent/indisponible, fallback cache:', e.message);
    try {
      return await docRef.get({ source: 'cache' });
    } catch (e2) {
      return { exists: false, data: () => ({}) };
    }
  }
}

/**
 * normalizeResponses() – Normalize raw Firestore responses into { status, marked }
 */
function normalizeResponses(raw) {
  const out = {};
  Object.entries(raw||{}).forEach(([key, r]) => {
    const isMarked = (r.status === 'marquée') || (r.marked === true);
    const status = r.status === 'marquée'
      ? (r.previousStatus || 'ratée')
      : (r.status || 'ratée');
    out[key] = { ...r, status, marked: isMarked };
  });
  return out;
}

// Replace curly apostrophes etc. with straight apostrophes for consistency
function fixQuotes(str) {
  return str
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"');
}

// Helper to normalize category names for mode counting
function getModeCategory(cat) {
  if (!cat) return "TOUTES";
  return getNormalizedCategory(cat);
}

// Retourne la clé de stockage pour une question donnée
function getKeyFor(q) {
  return `question_${getModeCategory(q.categorie)}_${q.id}`;
}

// Placeholder to avoid errors
function updateMarkedCount() {
}

/**
 * ensureDailyStatsBarVisible() – S'assure que la barre de stats quotidiennes est visible
 */
function ensureDailyStatsBarVisible() {
  let statsBar = document.getElementById('dailyStatsBar');
  if (!statsBar) {
    statsBar = document.createElement('div');
    statsBar.id = 'dailyStatsBar';
    statsBar.style.cssText = 'display:block;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:0.4rem 1rem;border-radius:8px;margin:0.5rem auto;max-width:600px;text-align:center;box-shadow:0 4px 6px rgba(0,0,0,0.1);';
    statsBar.innerHTML = `
      <span style="font-size:1.4rem;font-weight:bold;" id="answeredTodayCount">…</span>
    `;
    const anchor = document.querySelector('h1');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(statsBar, anchor.nextSibling);
    } else {
      document.body.prepend(statsBar);
    }
    console.warn('[dailyStatsBar] recreated dynamically');
  }
  statsBar.style.display = 'block';
}

/**
 * toggleAutoStart() – Active/désactive le démarrage automatique du quiz
 */
function toggleAutoStart() {
  const checkbox = document.getElementById('autoStartCheckbox');
  if (checkbox) {
    const isChecked = checkbox.checked;
    localStorage.setItem('autoStartQuiz', isChecked ? 'true' : 'false');
  }
}

/**
 * initAutoStartCheckbox() – Initialise l'état du checkbox au chargement de la page d'accueil
 */
function initAutoStartCheckbox() {
  const checkbox = document.getElementById('autoStartCheckbox');
  if (checkbox) {
    const autoStart = localStorage.getItem('autoStartQuiz') === 'true';
    checkbox.checked = autoStart;
  }
}

// ============================================================
// Répétition espacée (Spaced Repetition) – helpers
// ============================================================

/**
 * _isEligibleForSR() – Une question est éligible à la répétition espacée si :
 * 1) Elle a déjà un nextReview programmé (= elle est dans le cycle SR), OU
 * 2) Elle est marquée, importante, ou difficile (failCount >= 2) → entre dans le cycle immédiatement
 * Les questions non vues (pas de réponse) ne sont jamais éligibles.
 */
function _isEligibleForSR(r) {
  if (!r) return false;
  // Déjà dans le cycle SR (a été répondue depuis l'activation du SR)
  if (r.nextReview !== undefined && r.nextReview !== null) return true;
  // Pas encore dans le cycle mais marquée/importante/difficile → y entre maintenant
  return r.marked === true || r.important === true || (r.failCount || 0) >= 2;
}

/**
 * _isDueForReview() – Vérifie si une question est due pour révision.
 * Si nextReview n'est pas défini mais que la question est éligible, elle est due immédiatement.
 */
function _isDueForReview(r, now) {
  if (!r) return false;
  // Pas encore de nextReview → question éligible jamais planifiée → due immédiatement
  if (r.nextReview === undefined || r.nextReview === null) return true;
  // nextReview peut être un timestamp Firestore ou un nombre
  let reviewMs = r.nextReview;
  if (typeof reviewMs === 'object' && reviewMs.seconds) {
    reviewMs = reviewMs.seconds * 1000;
  }
  return reviewMs <= now;
}

/**
 * voirStats() – Redirige vers la page des statistiques
 */
function voirStats() {
  window.location = 'stats.html';
}
