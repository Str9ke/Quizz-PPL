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
  // En ligne → forcer lecture SERVEUR pour données cross-device fraîches
  try {
    return await Promise.race([
      docRef.get({ source: 'server' }),
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
 * IMPORTANT : un statut absent (r.status undefined) DOIT rester undefined, pas être
 * défauté à 'ratée' — sinon une question "réinitialisée" via _resetCategoryField()
 * (qui supprime précisément status/srInterval/nextReview pour la faire redevenir
 * "non vue") réapparaît comme "ratée" partout où normalizeResponses() est utilisé
 * (accueil, compteurs de mode, calcul des révisions dues), alors que stats.js — qui lit
 * data.responses brut sans normalizeResponses() — l'affiche correctement en "non vue".
 * C'était la cause des incohérences de compteurs "Accueil vs Stats" observées après reset.
 */
function normalizeResponses(raw) {
  const out = {};
  Object.entries(raw||{}).forEach(([key, r]) => {
    const isMarked = (r.status === 'marquée') || (r.marked === true);
    const status = r.status === 'marquée'
      ? (r.previousStatus || 'ratée')
      : r.status;
    out[key] = { ...r, status, marked: isMarked };
  });
  return out;
}

/**
 * _effectiveStatus(r) – Statut "effectif" d'une réponse pour tous les compteurs de
 * progression (barre globale, par catégorie, menu Mode) : une question suspendue
 * ("🚫 Ne plus revoir") compte TOUJOURS comme réussie — l'utilisateur a décidé de ne
 * plus la revoir, elle est donc considérée maîtrisée, quel que soit son dernier statut
 * réel avant suspension (même si elle avait été ratée, ou même jamais répondue).
 * Sinon, renvoie le statut réel ('réussie'/'ratée'/undefined). À utiliser PARTOUT où on
 * calcule réussie/ratée/non-vue pour rester cohérent entre l'accueil, les stats et le quiz.
 */
function _effectiveStatus(r) {
  if (!r) return undefined;
  if (r.suspended) return 'réussie';
  return r.status;
}

/**
 * _isUnseen(r) – Une réponse est "non vue" si elle n'existe pas OU si son statut
 * effectif (voir _effectiveStatus) est absent (ex: après un reset ciblé qui supprime le
 * statut tout en conservant marqué/important/historique). À utiliser partout où une
 * question est classée "nouvelle/non vue" pour rester cohérent avec stats.js et éviter
 * qu'une question réinitialisée soit comptée comme "déjà vue" sans statut valide.
 */
function _isUnseen(r) {
  return !r || _effectiveStatus(r) === undefined;
}

/**
 * _isAggregateCategory(normalizedSel) – Vrai si la catégorie normalisée sélectionnée est
 * une catégorie "agrégée" (TOUTES/EASA ALL/GLIGLI ALL/GLIGLI HARD ALL/GLIGLI EASY ALL/
 * AUTRES) — dans ce cas, `questions[]` contient déjà le bon mélange de sous-catégories
 * (chargé par chargerQuestions()/loadAllQuestions()) et ne doit pas être re-filtré par
 * `q.categorie === normalizedSel`. Centralisé ici : ce test était dupliqué à l'identique
 * dans 3 endroits (categories.js + 2x quiz.js), un risque de désynchronisation si une
 * nouvelle catégorie agrégée est ajoutée un jour sans mettre à jour les 3 copies.
 */
function _isAggregateCategory(normalizedSel) {
  return normalizedSel === "TOUTES" || normalizedSel === "EASA ALL" || normalizedSel === "GLIGLI ALL" ||
    normalizedSel === "GLIGLI HARD ALL" || normalizedSel === "GLIGLI EASY ALL" || normalizedSel === "AUTRES";
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
 * 2) Elle a déjà été RÉPONDUE (status présent) et est marquée, importante, ou difficile
 *    (failCount >= 2) → entre dans le cycle immédiatement.
 * Les questions jamais répondues ne sont JAMAIS éligibles — même marquées/importantes.
 * Sans cette condition sur status, une question marquée dont la planification vient
 * d'être réinitialisée (reset de catégorie : status/srInterval/nextReview supprimés,
 * marked/important conservés) comptait comme "révision due" immédiatement et pour
 * toujours, gonflant artificiellement le compteur "N dues" de l'Objectif du jour avec
 * des questions qui ne sont pas de vraies révisions planifiées.
 */
function _isEligibleForSR(r) {
  if (!r) return false;
  // Déjà dans le cycle SR (a été répondue depuis l'activation du SR)
  if (r.nextReview !== undefined && r.nextReview !== null) return true;
  // Répondue par le passé (pré-SR) et marquée/importante/difficile → entre dans le cycle
  return r.status !== undefined
    && (r.marked === true || r.important === true || (r.failCount || 0) >= 2);
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
 * _updateRevisionsBadge() – Affiche/masque le badge "Révisions du jour" sur l'accueil.
 * Rend visible le nombre de questions dues pour répétition espacée (nbRevisionsToday, calculé
 * par updateModeCounts()), pour que le système de révision espacée ne passe plus inaperçu.
 */
function _updateRevisionsBadge() {
  const badge = document.getElementById('revisionsBadge');
  if (!badge) return;
  const n = (typeof nbRevisionsToday === 'number') ? nbRevisionsToday : 0;
  if (n > 0) {
    badge.textContent = `📅 ${n} révision${n > 1 ? 's' : ''} due${n > 1 ? 's' : ''} aujourd'hui — incluses dans "Objectif du jour"`;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

/**
 * getDailyNewTarget() – Objectif de nouvelles questions/jour, en honorant la valeur 0.
 * ATTENTION : ne PAS remplacer par `parseInt(...) || 15` — 0 est une valeur valide
 * ("aucune nouvelle question, uniquement les révisions") mais 0 est falsy en JS, donc
 * `0 || 15` donnerait 15 et rendrait le réglage 0 silencieusement impossible.
 * Le défaut 15 ne s'applique que si la valeur est absente ou invalide.
 */
function getDailyNewTarget() {
  const raw = localStorage.getItem('dailyNewTarget');
  const v = parseInt(raw);
  return (Number.isFinite(v) && v >= 0) ? v : 15;
}

/**
 * _saveDailyNewTarget() – Sauvegarde l'objectif de nouvelles questions/jour (localStorage)
 * et rafraîchit le résumé + le compteur du mode "objectif".
 */
function _saveDailyNewTarget() {
  const input = document.getElementById('dailyNewTarget');
  if (!input) return;
  const v = Math.max(0, parseInt(input.value) || 0);
  input.value = v;
  localStorage.setItem('dailyNewTarget', v);
  if (typeof updateModeCounts === 'function') updateModeCounts();
}

/**
 * _saveQuizBatchSize() – Sauvegarde le nombre de questions affichées à la fois pendant
 * le quiz (page par page, avec bouton "Suivant"). Réglable depuis l'écran d'accueil.
 */
function _saveQuizBatchSize() {
  const input = document.getElementById('quizBatchSize');
  if (!input) return;
  const v = Math.max(1, parseInt(input.value) || 5);
  input.value = v;
  localStorage.setItem('quizBatchSize', v);
}

/**
 * ===== Suivi du temps réel passé par question (_qt*) =====
 * Apprend, séparément pour les questions "nouvelles" et "révisions", le temps réel que
 * l'utilisateur passe par question — pour que l'estimation "~X min" reflète son vrai rythme
 * au lieu de constantes fixes. Exclut intelligemment :
 *  - le temps où l'onglet/la page est masqué (changement d'onglet, minimisation) via l'API
 *    Page Visibility ;
 *  - le temps d'inactivité prolongée SANS changement de visibilité (téléphone posé écran
 *    allumé, PC oublié au premier plan) : au-delà de QTIME_IDLE_MS sans interaction (clic,
 *    touche, défilement, tap), le temps écoulé depuis la DERNIÈRE interaction réelle n'est
 *    pas compté.
 * Stocké en localStorage (moyenne mobile exponentielle, adaptative), pas besoin de Firestore
 * pour une estimation purement indicative côté interface.
 */
const QTIME_STORAGE_KEY = 'qTimeStats';
const QTIME_IDLE_MS = 60000; // au-delà de 60s sans interaction, on considère l'utilisateur parti
const QTIME_MIN_SAMPLE_SEC = 1; // ignorer un échantillon < 1s (glitch/double clic)
const QTIME_MAX_SAMPLE_SEC = 180; // plafonner un échantillon à 3 min pour ne pas fausser la moyenne
const QTIME_EMA_ALPHA = 0.15; // poids du nouvel échantillon dans la moyenne mobile (adaptatif)
const QTIME_MIN_SAMPLES_TO_TRUST = 5; // sous ce seuil, on garde encore l'estimation par défaut

let _qtActiveAccumMs = 0;
let _qtSegStart = null; // null = en pause (onglet masqué ou utilisateur inactif)
let _qtLastActivity = 0;

function _qtResume() {
  const now = Date.now();
  if (_qtSegStart === null) _qtSegStart = now;
  _qtLastActivity = now;
}
function _qtPause() {
  if (_qtSegStart !== null) {
    _qtActiveAccumMs += Date.now() - _qtSegStart;
    _qtSegStart = null;
  }
}
function _qtCheckIdle() {
  if (_qtSegStart !== null && Date.now() - _qtLastActivity > QTIME_IDLE_MS) {
    // Inactif depuis trop longtemps : ne compter le temps actif que jusqu'à la dernière
    // interaction réelle (pas jusqu'à maintenant — l'utilisateur est probablement parti).
    _qtActiveAccumMs += _qtLastActivity - _qtSegStart;
    _qtSegStart = null;
  }
}
function _qtElapsedMs() {
  _qtCheckIdle();
  return _qtActiveAccumMs + (_qtSegStart !== null ? Date.now() - _qtSegStart : 0);
}
function _qtResetElapsed() {
  _qtCheckIdle();
  _qtActiveAccumMs = 0;
  if (_qtSegStart !== null) {
    // bug corrigé : _qtLastActivity devait aussi être resynchronisé ici, sinon il pouvait
    // rester "dans le passé" par rapport au nouveau _qtSegStart et faire calculer un temps
    // négatif dans _qtCheckIdle() (Date.now() - _qtLastActivity - _qtSegStart mal alignés).
    _qtSegStart = Date.now();
    _qtLastActivity = Date.now();
  }
}
function _qtInit() {
  if (window._qtInitialized) return;
  window._qtInitialized = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) _qtPause(); else _qtResume();
  });
  ['click', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
    document.addEventListener(evt, () => { if (!document.hidden) _qtResume(); }, { passive: true });
  });
  // mousemove à part et throttlé : une lecture silencieuse (pas de clic/scroll) avec la
  // souris posée sur l'écran ne doit pas être considérée comme "parti" avant QTIME_IDLE_MS —
  // sans ce signal, une lecture > 60s sans bouger la souris serait comptée comme inactive.
  let _qtLastMouseResume = 0;
  document.addEventListener('mousemove', () => {
    if (document.hidden) return;
    const now = Date.now();
    if (now - _qtLastMouseResume < 5000) return; // pas besoin de rafraîchir à chaque pixel
    _qtLastMouseResume = now;
    _qtResume();
  }, { passive: true });
  if (!document.hidden) _qtResume();
}
function _qtRecordSample(sec, isNew) {
  if (!isFinite(sec) || sec < QTIME_MIN_SAMPLE_SEC) return;
  const clamped = Math.min(sec, QTIME_MAX_SAMPLE_SEC);
  let data;
  try { data = JSON.parse(localStorage.getItem(QTIME_STORAGE_KEY) || '{}'); } catch (e) { data = {}; }
  const bucketKey = isNew ? 'new' : 'review';
  const bucket = data[bucketKey] || { avgSec: isNew ? 35 : 22, n: 0 };
  bucket.avgSec = bucket.n === 0 ? clamped : bucket.avgSec * (1 - QTIME_EMA_ALPHA) + clamped * QTIME_EMA_ALPHA;
  bucket.n = Math.min(bucket.n + 1, 9999);
  data[bucketKey] = bucket;
  try { localStorage.setItem(QTIME_STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* quota plein, tant pis */ }
}
function _qtGetEstimateSecPerQuestion() {
  let data;
  try { data = JSON.parse(localStorage.getItem(QTIME_STORAGE_KEY) || '{}'); } catch (e) { data = {}; }
  const nb = data.new, rb = data.review;
  return {
    secPerNew: (nb && nb.n >= QTIME_MIN_SAMPLES_TO_TRUST) ? nb.avgSec : 35,
    secPerReview: (rb && rb.n >= QTIME_MIN_SAMPLES_TO_TRUST) ? rb.avgSec : 22
  };
}

/**
 * _qtSessionTotalMs / _qtSessionCountedIdx (localStorage) — Temps actif RÉEL cumulé sur
 * l'ENSEMBLE du questionnaire en cours (pas juste la question actuelle comme _qtElapsedMs).
 * Persisté en localStorage (pas juste une variable mémoire) pour survivre à une navigation
 * vers une autre page puis un retour au quiz en cours — voir _refreshCategoryInfoBarLive() et
 * le même besoin pour currentQuizAnswers/currentQuizBatchPos. Affiché à la validation à côté
 * du score : "temps réel de travail" + moyenne par question.
 */
function _qtResetSessionTotal() {
  localStorage.setItem('qtSessionTotalMs', '0');
  localStorage.setItem('qtSessionCountedIdx', '[]');
}
function _qtAddSessionTime(ms, qIdx) {
  if (!isFinite(ms) || ms <= 0) return;
  let counted;
  try { counted = JSON.parse(localStorage.getItem('qtSessionCountedIdx') || '[]'); } catch (e) { counted = []; }
  // Une question déjà comptabilisée (ex: on re-coche la même question après un retour sur la
  // page, ce qui remet _qtLastTouchedIdx à null) ne doit pas ajouter une 2e fois son temps.
  if (counted.includes(qIdx)) return;
  counted.push(qIdx);
  try { localStorage.setItem('qtSessionCountedIdx', JSON.stringify(counted)); } catch (e) { /* ignore */ }
  const total = (parseFloat(localStorage.getItem('qtSessionTotalMs')) || 0) + ms;
  try { localStorage.setItem('qtSessionTotalMs', String(total)); } catch (e) { /* ignore */ }
}
/**
 * _qtFlushFinalSegment() – À appeler à la validation du quiz : ajoute au total le temps actif
 * écoulé depuis le dernier clic (temps de relecture avant de valider), qui n'a sinon jamais
 * l'occasion d'être comptabilisé puisqu'aucun clic sur une NOUVELLE question ne vient le clore.
 */
function _qtFlushFinalSegment() {
  if (typeof _qtElapsedMs !== 'function') return;
  const ms = _qtElapsedMs();
  if (!isFinite(ms) || ms <= 0) return;
  const total = (parseFloat(localStorage.getItem('qtSessionTotalMs')) || 0) + ms;
  try { localStorage.setItem('qtSessionTotalMs', String(total)); } catch (e) { /* ignore */ }
}
function _qtGetSessionTotal() {
  const ms = parseFloat(localStorage.getItem('qtSessionTotalMs')) || 0;
  let counted;
  try { counted = JSON.parse(localStorage.getItem('qtSessionCountedIdx') || '[]'); } catch (e) { counted = []; }
  return { ms, count: counted.length };
}
/**
 * _qtFormatDuration(ms) – "4 min 32 s" / "48 s" pour l'affichage du temps réel de session.
 */
function _qtFormatDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${sec} s`;
  return `${min} min ${String(sec).padStart(2, '0')} s`;
}

/**
 * _updateObjectifSummary() – Affiche le résumé "N dues + M nouvelles = X questions aujourd'hui"
 * sur la carte "Objectif du jour" de l'accueil, avec une estimation de temps.
 * Reflète la catégorie actuellement sélectionnée dans le menu "Catégorie".
 */
function _updateObjectifSummary(nbRevisions, dailyNewTarget, total) {
  const el = document.getElementById('objectifSummary');
  if (!el) return;
  const { secPerNew, secPerReview } = _qtGetEstimateSecPerQuestion();
  const estMin = Math.round((nbRevisions * secPerReview + dailyNewTarget * secPerNew) / 60);
  const catSelect = document.getElementById('categorie');
  const catLabel = (catSelect && catSelect.selectedOptions && catSelect.selectedOptions[0])
    ? catSelect.selectedOptions[0].textContent
    : 'TOUTES';
  el.innerHTML = `📚 <b>${catLabel}</b><br>`
    + `📅 <b>${nbRevisions}</b> révision${nbRevisions > 1 ? 's' : ''} due${nbRevisions > 1 ? 's' : ''}`
    + ` + <b>${dailyNewTarget}</b> nouvelle${dailyNewTarget > 1 ? 's' : ''} = <b>${total}</b> question${total > 1 ? 's' : ''}`
    + ` &nbsp;(~${estMin} min estimées)`;

  // Garder le menu "Catégorie" de la carte Objectif synchronisé avec le menu principal
  // (utile si la catégorie a été changée depuis la carte "Configuration du Quiz")
  const objSelect = document.getElementById('objectifCategorie');
  if (objSelect && catSelect && objSelect.value !== catSelect.value) {
    objSelect.value = catSelect.value;
  }
}

/**
 * syncCategorieFromObjectif() – Le menu "Catégorie" de la carte "Objectif du jour" vient de
 * changer : répercute la sélection sur le menu principal (carte Configuration) et recharge
 * les questions/compteurs pour cette catégorie.
 */
function syncCategorieFromObjectif() {
  const objSelect = document.getElementById('objectifCategorie');
  const catSelect = document.getElementById('categorie');
  if (!objSelect || !catSelect) return;
  catSelect.value = objSelect.value;
  if (typeof categoryChanged === 'function') categoryChanged();
}

/**
 * Les cases marquées/importantes/avec notes existent en DEUX endroits de l'accueil (carte
 * "Configuration du Quiz" ET carte "Objectif du jour") mais représentent le MÊME filtre :
 * chaque paire est synchronisée en direct et partage la même clé localStorage (le 1er id de
 * chaque paire), pour que cocher l'une coche l'autre et que le choix soit mémorisé une seule fois.
 */
const _FILTER_CHECKBOX_PAIRS = [
  { flag: 'marquees',    ids: ['filterMarqueesCheckbox', 'objFilterMarqueesCheckbox'],    countIds: ['filterMarqueesCount', 'objFilterMarqueesCount'] },
  { flag: 'importantes', ids: ['filterImportantesCheckbox', 'objFilterImportantesCheckbox'], countIds: ['filterImportantesCount', 'objFilterImportantesCount'] },
  { flag: 'avecnotes',   ids: ['filterNotesCheckbox', 'objFilterNotesCheckbox'],          countIds: ['filterNotesCount', 'objFilterNotesCount'] },
  { flag: 'aucune',          ids: ['filterAucuneCheckbox', 'objFilterAucuneCheckbox'],                 countIds: ['filterAucuneCount', 'objFilterAucuneCount'] },
  { flag: 'avecexplication', ids: ['filterAvecExplicationCheckbox', 'objFilterAvecExplicationCheckbox'], countIds: ['filterAvecExplicationCount', 'objFilterAvecExplicationCount'] },
  { flag: 'plusratees',      ids: ['filterPlusRateesCheckbox', 'objFilterPlusRateesCheckbox'],          countIds: ['filterPlusRateesCount', 'objFilterPlusRateesCount'] }
];

/**
 * Flags qui filtrent l'ENSEMBLE des questions (au moins un critère coché parmi ceux-ci doit
 * matcher). 'plusratees' n'en fait PAS partie : c'est un critère de PRIORITÉ D'ORDRE (les plus
 * ratées en premier, en conservant la diversité des catégories), pas un critère d'appartenance —
 * s'il était traité comme les autres, le cocher seul viderait le résultat (aucune question ne
 * "correspond" à "plusratees" au sens membership du filtre OR).
 */
const _MEMBERSHIP_FILTER_FLAGS = ['marquees', 'importantes', 'avecnotes', 'aucune', 'avecexplication'];

/**
 * _hasOfficialExplication(q) – Vrai si la question a un commentaire/explication OFFICIEL fourni
 * avec la question (texte et/ou images), à distinguer de la note personnelle de l'utilisateur
 * (_notesCache). Même prédicat que celui utilisé pour afficher le bouton "Voir l'explication"
 * en correction (js/quiz.js).
 */
function _hasOfficialExplication(q) {
  if (!q) return false;
  return !!(q.explication || (q.explication_images && q.explication_images.length));
}

/**
 * _updateFilterCheckboxCounts(counts) – Affiche, à côté de chaque case de filtre, le nombre de
 * questions concernées dans la catégorie actuellement sélectionnée (indépendamment des autres
 * cases cochées — chaque compteur reste "tel quel", pas croisé). Accepte soit un nombre simple,
 * soit {total, vues} pour afficher en plus la répartition déjà vues / restantes ("combien il en
 * reste" par rapport au critère coché).
 * @param {Object<string, number|{total:number, vues:number}>} counts
 */
function _updateFilterCheckboxCounts(counts) {
  if (!counts) return;
  _FILTER_CHECKBOX_PAIRS.forEach(({ flag, countIds }) => {
    const c = counts[flag];
    let text;
    if (c && typeof c === 'object') {
      const total = c.total || 0;
      const vues = c.vues || 0;
      const restantes = Math.max(0, total - vues);
      text = total ? ` (${total} · ${vues} vues, ${restantes} restantes)` : ' (0)';
    } else {
      text = ` (${c || 0})`;
    }
    countIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    });
  });
}

/**
 * _getCheckedFilterFlags() – Lit les cases marquées/importantes/avec notes cochées (dans
 * n'importe laquelle des deux cartes, elles sont synchronisées). Ces filtres s'appliquent EN
 * PLUS du mode choisi dans le menu "Mode" (y compris "Révisions du jour"/"Mixte"/"Objectif du
 * jour") : ils réduisent le résultat du mode à seulement les questions correspondant à au
 * moins un critère coché.
 */
function _getCheckedFilterFlags() {
  return _FILTER_CHECKBOX_PAIRS
    .filter(({ ids }) => ids.some(id => document.getElementById(id)?.checked))
    .map(({ flag }) => flag);
}

/**
 * _syncModeFilterState() – Conservé pour compat avec les appels existants (les cases ne
 * grisent plus le menu Mode depuis qu'elles filtrent EN PLUS de lui plutôt que de le remplacer).
 */
function _syncModeFilterState() { /* no-op */ }

/**
 * _onModeFilterCheckboxChange(sourceEl) – Appelé quand l'utilisateur coche/décoche une case
 * marquées/importantes/avec notes à la main (dans l'une ou l'autre carte) : répercute son choix
 * sur la case jumelle de l'autre carte, puis mémorise (localStorage) pour la prochaine visite.
 * NB: volontairement séparé de _restoreModeFilterCheckboxes() — les décochages programmatiques
 * (ex. _startObjectifDuJour) ne doivent PAS écraser la configuration mémorisée.
 */
function _onModeFilterCheckboxChange(sourceEl) {
  _FILTER_CHECKBOX_PAIRS.forEach(({ ids }) => {
    if (sourceEl && ids.includes(sourceEl.id)) {
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el && el !== sourceEl) el.checked = sourceEl.checked;
      });
    }
    const primaryId = ids[0];
    const anyChecked = ids.some(id => document.getElementById(id)?.checked);
    localStorage.setItem(primaryId, anyChecked ? '1' : '0');
  });
}

/**
 * _restoreModeFilterCheckboxes() – Restaure au chargement de la page les cases
 * marquées/importantes/avec notes (dans les deux cartes) telles qu'elles étaient lors de
 * la dernière visite.
 */
function _restoreModeFilterCheckboxes() {
  _FILTER_CHECKBOX_PAIRS.forEach(({ ids }) => {
    const checked = localStorage.getItem(ids[0]) === '1';
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = checked;
    });
  });
}

/**
 * _saveModeSelectValue() – Mémorise la valeur choisie à la main dans le menu "Mode"
 * (n'est PAS appelé lors d'une affectation programmatique comme dans _startObjectifDuJour,
 * puisque modeSelect.value = ... ne déclenche pas l'évènement "change").
 */
function _saveModeSelectValue() {
  const el = document.getElementById('mode');
  if (el) localStorage.setItem('lastModeSelectValue', el.value);
}

/**
 * _startObjectifDuJour() – Lance directement une session "Objectif du jour" (toutes les
 * révisions dues + l'objectif de nouvelles questions) pour la catégorie actuellement
 * sélectionnée dans le menu "Catégorie" (TOUTES par défaut), sans passer par la config manuelle.
 */
async function _startObjectifDuJour() {
  const btn = document.getElementById('objectifStartBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Préparation...'; }
  try {
    // Les cases marquées/importantes/avec notes s'appliquent aussi à "Objectif du jour" :
    // updateModeCounts() (appelé ci-dessous sans argument) les lit automatiquement et scope
    // nbRevisionsToday/nbNonvuesToday sur ce sous-ensemble, donc le nb calculé plus bas promet
    // exactement ce que filtrerQuestions() (qui relit les mêmes cases) livrera.
    const catSelect = document.getElementById('categorie');
    const cat = catSelect ? catSelect.value : 'TOUTES';
    selectedCategory = cat;
    if (cat === 'TOUTES') {
      if (typeof loadAllQuestions === 'function') await loadAllQuestions();
    } else if (typeof chargerQuestions === 'function') {
      await chargerQuestions(cat);
    }
    if (typeof updateModeCounts === 'function') await updateModeCounts();

    // Ne jamais promettre plus de "nouvelles" qu'il n'en reste réellement de non vues
    // dans cette catégorie (sinon l'objectif affiché ment et le quiz démarre vide).
    const dailyNewTarget = Math.min(getDailyNewTarget(), typeof nbNonvuesToday === 'number' ? nbNonvuesToday : getDailyNewTarget());
    const nb = nbRevisionsToday + dailyNewTarget;

    const modeSelect = document.getElementById('mode');
    if (modeSelect) modeSelect.value = 'objectif';
    const nbInput = document.getElementById('nbQuestions');
    if (nbInput) nbInput.value = nb;

    if (typeof demarrerQuiz === 'function') await demarrerQuiz();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Lancer ma session du jour'; }
  }
}

/**
 * voirStats() – Redirige vers la page des statistiques
 */
function voirStats() {
  window.location = 'stats.html';
}
