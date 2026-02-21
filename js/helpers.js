// === helpers.js === Utility functions ===

/**
 * getDocWithTimeout() – Lit un document Firestore avec fallback rapide hors-ligne.
 * Si hors-ligne (navigator.onLine === false) → lecture directe du cache Firestore.
 * Si en ligne → lecture réseau avec timeout de 4s, puis fallback cache.
 * @param {firebase.firestore.DocumentReference} docRef
 * @param {number} timeoutMs – Délai max avant fallback cache (défaut 2000ms)
 * @returns {Promise<firebase.firestore.DocumentSnapshot>}
 */
async function getDocWithTimeout(docRef, timeoutMs = 2000) {
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
  console.log("updateMarkedCount called");
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
  console.log('[dailyStatsBar] visible=', !!statsBar);
}

/**
 * toggleAutoStart() – Active/désactive le démarrage automatique du quiz
 */
function toggleAutoStart() {
  const checkbox = document.getElementById('autoStartCheckbox');
  if (checkbox) {
    const isChecked = checkbox.checked;
    localStorage.setItem('autoStartQuiz', isChecked ? 'true' : 'false');
    console.log('autoStartQuiz:', isChecked);
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

/**
 * voirStats() – Redirige vers la page des statistiques
 */
function voirStats() {
  window.location = 'stats.html';
}
