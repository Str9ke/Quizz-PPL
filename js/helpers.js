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
 * ensureDailyStatsBarVisible() – Crée/affiche la barre quotidienne avec streak, objectif et progression
 */
function ensureDailyStatsBarVisible() {
  let statsBar = document.getElementById('dailyStatsBar');
  const needsContent = !statsBar || !statsBar.querySelector('#streakDisplay');
  if (!statsBar) {
    statsBar = document.createElement('div');
    statsBar.id = 'dailyStatsBar';
    const anchor = document.querySelector('h1');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(statsBar, anchor.nextSibling);
    } else {
      document.body.prepend(statsBar);
    }
  }
  if (needsContent) {
    statsBar.style.cssText = 'display:block;background:var(--bg-question, #1e1e2e);border:1px solid rgba(255,255,255,0.1);color:white;padding:0.6rem 1rem;border-radius:10px;margin:0.5rem auto;max-width:600px;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
    statsBar.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span id="streakDisplay" style="font-size:0.85rem;font-weight:600;">🔥 0 jour</span>
        <span style="font-size:0.85rem;color:var(--text-secondary)">
          <span id="answeredTodayCount" style="font-size:1.3rem;font-weight:bold;color:white;">…</span>
          <span id="dailyGoalLabel" style="font-size:0.8rem;color:var(--text-secondary);"> / —</span>
        </span>
      </div>
      <div id="dailyProgressBarOuter" style="height:10px;background:rgba(255,255,255,0.08);border-radius:5px;overflow:hidden;position:relative;">
        <div id="dailyProgressBarInner" style="height:100%;width:0%;border-radius:5px;transition:width 0.6s ease, background 0.6s ease;background:#8b0000;"></div>
      </div>
    `;
  }
  statsBar.style.display = 'block';
}

/**
 * _getDailyHistoryMerged() – Fusionne dailyHistory depuis localStorage (backup + clés individuelles)
 * Retourne un objet { "YYYY-MM-DD": count } en dates locales.
 */
function _getDailyHistoryMerged() {
  const merged = {};
  // Source 1: backup persistant
  try {
    const backup = JSON.parse(localStorage.getItem('dailyHistoryBackup') || '{}');
    for (const [k, v] of Object.entries(backup)) {
      merged[k] = Math.max(merged[k] || 0, v);
    }
  } catch (e) { /* ignore */ }
  // Source 2: clés individuelles dailyAnswered_* / dailyCountRatchet_* (60 derniers jours)
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const localKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const utcKey = localKey; // en France, le décalage ne change pas la date pour la plupart des heures
    const lsVal = Math.max(
      parseInt(localStorage.getItem('dailyAnswered_' + utcKey)) || 0,
      parseInt(localStorage.getItem('dailyCountRatchet_' + utcKey)) || 0
    );
    if (lsVal > 0) merged[localKey] = Math.max(merged[localKey] || 0, lsVal);
  }
  return merged;
}

/**
 * _getDailyMasteredMerged() – Retourne le compteur de questions nouvellement réussies par jour
 * (non-vue/ratée → réussie). Utilisé pour l'estimation "jours restants" (progression réelle).
 * Format identique à _getDailyHistoryMerged() : { "YYYY-MM-DD": count }
 */
function _getDailyMasteredMerged() {
  const merged = {};
  // Source 1: backup persistant
  try {
    const backup = JSON.parse(localStorage.getItem('dailyMasteredBackup') || '{}');
    for (const [k, v] of Object.entries(backup)) {
      merged[k] = Math.max(merged[k] || 0, v);
    }
  } catch (e) { /* ignore */ }
  // Source 2: clés individuelles dailyMastered_* (60 derniers jours)
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const localKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const lsVal = parseInt(localStorage.getItem('dailyMastered_' + localKey)) || 0;
    if (lsVal > 0) merged[localKey] = Math.max(merged[localKey] || 0, lsVal);
  }
  return merged;
}

/**
 * _computeStreak() – Calcule la série de jours consécutifs d'activité
 * Si aujourd'hui a de l'activité, inclut aujourd'hui. Sinon, part d'hier.
 */
function _computeStreak(dailyHistory) {
  const today = new Date();
  const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  let streak = 0;
  // Si aujourd'hui a de l'activité, commencer à compter depuis aujourd'hui
  const startOffset = (dailyHistory[todayKey] || 0) > 0 ? 0 : 1;
  for (let i = startOffset; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if ((dailyHistory[key] || 0) > 0) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * _computeDailyGoal() – Calcule l'objectif quotidien = moyenne des 7 derniers jours complets
 * (hors aujourd'hui). Minimum 10 questions.
 */
function _computeDailyGoal(dailyHistory) {
  const saved = parseInt(localStorage.getItem('dailyGoalOverride'));
  if (saved > 0) return saved;
  const today = new Date();
  let total = 0;
  let activeDays = 0;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const count = dailyHistory[key] || 0;
    total += count;
    if (count > 0) activeDays++;
  }
  if (activeDays === 0) return 20; // défaut si aucune activité récente
  // Moyenne exacte (pas d'arrondi à la dizaine), minimum 10
  return Math.max(10, Math.round(total / 7));
}

/**
 * updateDailyStatsBar() – Met à jour streak, objectif, compteur et barre de progression
 * @param {number} [answeredToday] - Si fourni, force cette valeur. Sinon calcule depuis localStorage.
 * @param {object} [externalDailyHist] - dailyHistory Firestore à fusionner (optionnel)
 */
function updateDailyStatsBar(answeredToday, externalDailyHist) {
  ensureDailyStatsBarVisible();
  const merged = _getDailyHistoryMerged();
  // Fusionner avec Firestore si fourni
  if (externalDailyHist) {
    for (const [k, v] of Object.entries(externalDailyHist)) {
      merged[k] = Math.max(merged[k] || 0, v);
    }
  }
  // Déterminer le compteur d'aujourd'hui
  const today = new Date();
  const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  if (answeredToday === undefined || answeredToday === null) {
    answeredToday = merged[todayKey] || 0;
  }
  // S'assurer que merged contient bien la valeur la plus haute pour aujourd'hui
  merged[todayKey] = Math.max(merged[todayKey] || 0, answeredToday);

  const streak = _computeStreak(merged);
  const goal = _computeDailyGoal(merged);
  const pct = Math.min(answeredToday / goal, 1);

  // Gradient: dark red (0%) → orange (50%) → green (100%)
  const r = Math.round(139 + (255 - 139) * Math.min(pct * 2, 1) - Math.max(0, (pct - 0.5) * 2) * 255);
  const g = Math.round(0 + Math.min(pct * 2, 1) * 165 + Math.max(0, (pct - 0.5) * 2) * (175 - 165));
  const b = Math.round(0);
  // Simpler: interpolate #8b0000 → #ff8c00 → #2ecc40
  let barColor;
  if (pct <= 0.5) {
    const t = pct * 2; // 0..1
    barColor = `rgb(${Math.round(139 + (255 - 139) * t)}, ${Math.round(0 + 140 * t)}, 0)`;
  } else {
    const t = (pct - 0.5) * 2; // 0..1
    barColor = `rgb(${Math.round(255 - (255 - 46) * t)}, ${Math.round(140 + (204 - 140) * t)}, ${Math.round(0 + 64 * t)})`;
  }

  // Streak text
  const streakEl = document.getElementById('streakDisplay');
  if (streakEl) {
    if (streak === 0) {
      streakEl.textContent = '🔥 Commence ta série !';
      streakEl.style.color = 'var(--text-secondary)';
    } else {
      streakEl.textContent = `🔥 ${streak} jour${streak > 1 ? 's' : ''} d'affilée`;
      streakEl.style.color = streak >= 7 ? '#ff6b35' : streak >= 3 ? '#ffa500' : '#ccc';
    }
  }
  // Count
  const countEl = document.getElementById('answeredTodayCount');
  if (countEl) countEl.textContent = answeredToday;
  // Goal label
  const goalEl = document.getElementById('dailyGoalLabel');
  if (goalEl) goalEl.textContent = ` / ${goal}`;
  // Progress bar
  const barInner = document.getElementById('dailyProgressBarInner');
  if (barInner) {
    const widthPct = Math.min(pct * 100, 100);
    barInner.style.width = widthPct + '%';
    barInner.style.background = barColor;
    // Si objectif atteint, petit éclat visuel
    if (pct >= 1) {
      barInner.style.boxShadow = '0 0 8px rgba(46, 204, 64, 0.6)';
    } else {
      barInner.style.boxShadow = 'none';
    }
  }
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
