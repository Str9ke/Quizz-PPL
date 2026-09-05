// === syllabus.js === Page "Syllabus" : suivi du temps de lecture/étude (hors quiz) ===
//
// Même principe de synchronisation multi-appareils que le temps de quiz (voir js/helpers.js —
// _qtGetDisplayDailyTimeMap — et js/stats.js — saveDailyTime), dupliqué ici en parallèle plutôt
// que factorisé : le mécanisme quiz vient tout juste d'être corrigé et testé (bug du temps qui
// ne s'additionnait pas entre appareils), le retoucher pour le rendre générique aurait fait
// courir un risque de régression sans aucun bénéfice utilisateur direct.
//
// Stockage local (par appareil) :
//   syllabusTimeMsBackup — { 'AAAA-MM-JJ': ms } mesuré/saisi sur CET appareil (jamais mélangé au
//                           serveur, sert de base au calcul du delta à transmettre).
//   syllabusTimeMsPushed — part de syllabusTimeMsBackup déjà transmise par CET appareil.
//   syllabusTimeMsServer — dernier total serveur connu par jour (somme de tous les appareils),
//                           simple cache pour l'affichage.
//   syllabusTimerStart   — horodatage de démarrage si un chronomètre est en cours (absent sinon).
// Stockage serveur : quizProgress/{uid}.syllabusTimeMs = { 'AAAA-MM-JJ': ms } — champ de plus sur
// le document déjà couvert par la règle Firestore existante, pas de nouvelle règle nécessaire.

const SYLL_BACKUP_KEY = 'syllabusTimeMsBackup';
const SYLL_PUSHED_KEY = 'syllabusTimeMsPushed';
const SYLL_SERVER_KEY = 'syllabusTimeMsServer';
const SYLL_TIMER_KEY = 'syllabusTimerStart';
// Plafond de sécurité sur UNE session de chronomètre continue : un oubli d'arrêter (téléphone
// resté allumé toute la nuit) ne doit pas gonfler démesurément le total du jour.
const SYLL_MAX_SESSION_MS = 6 * 60 * 60 * 1000;

let _syllTimerInterval = null;

function _syllUid() {
  return (typeof auth !== 'undefined' && auth.currentUser?.uid) || localStorage.getItem('cachedUid');
}

function _syllTodayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** _syllFormatHMS(ms) – Affichage vivant du chronomètre en cours, "01:23:45". */
function _syllFormatHMS(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function _syllAddDailyTime(ms, dayKey) {
  if (!isFinite(ms) || ms <= 0) return;
  const capped = Math.min(ms, SYLL_MAX_SESSION_MS);
  try {
    const map = JSON.parse(localStorage.getItem(SYLL_BACKUP_KEY) || '{}');
    const k = dayKey || _syllTodayKey();
    map[k] = Math.round((map[k] || 0) + capped);
    localStorage.setItem(SYLL_BACKUP_KEY, JSON.stringify(map));
  } catch (e) { /* quota plein, tant pis */ }
}

/** _syllGetDailyTimeMap() – Mesure BRUTE propre à cet appareil, sert de base au calcul du delta
 * à transmettre (voir _syllSave). Pour l'affichage, voir _syllGetDisplayDailyTimeMap(). */
function _syllGetDailyTimeMap() {
  try { return JSON.parse(localStorage.getItem(SYLL_BACKUP_KEY) || '{}'); } catch (e) { return {}; }
}

/** _syllGetDisplayDailyTimeMap() – Dernier total serveur connu (somme de tous les appareils) +
 * part encore purement locale de cet appareil pas encore transmise. */
function _syllGetDisplayDailyTimeMap() {
  let backup, pushed, server;
  try { backup = JSON.parse(localStorage.getItem(SYLL_BACKUP_KEY) || '{}'); } catch (e) { backup = {}; }
  try { pushed = JSON.parse(localStorage.getItem(SYLL_PUSHED_KEY) || '{}'); } catch (e) { pushed = {}; }
  try { server = JSON.parse(localStorage.getItem(SYLL_SERVER_KEY) || '{}'); } catch (e) { server = {}; }
  const combined = { ...server };
  for (const [k, v] of Object.entries(backup)) {
    const pending = Math.max(0, v - (pushed[k] || 0));
    if (pending > 0) combined[k] = (combined[k] || 0) + pending;
  }
  return combined;
}

/** _syllSave(uid) – Transmet au serveur, PAR INCRÉMENT, le temps ajouté par CET appareil depuis
 * la dernière transmission (même logique que saveDailyTime dans js/stats.js — voir son
 * commentaire pour le détail du raisonnement anti-double-comptage). Contrairement au temps de
 * quiz, aucune graine de migration n'est nécessaire ici : syllabusTimeMsPushed n'a jamais existé
 * sous un ancien schéma pour personne, une absence signifie simplement "rien encore transmis"
 * — le premier appel doit donc bien pousser tout ce qui a déjà été mesuré/saisi, pas l'ignorer. */
async function _syllSave(uid) {
  if (!uid || !navigator.onLine) return;
  try {
    const local = _syllGetDailyTimeMap();
    if (!Object.keys(local).length) return;

    let pushed;
    try { pushed = JSON.parse(localStorage.getItem(SYLL_PUSHED_KEY) || '{}') || {}; } catch (e) { pushed = {}; }

    const incrementObj = {};
    let any = false;
    for (const [k, v] of Object.entries(local)) {
      const delta = v - (pushed[k] || 0);
      if (delta > 0) { incrementObj[k] = firebase.firestore.FieldValue.increment(delta); any = true; }
    }
    if (!any) return;

    const docRef = db.collection('quizProgress').doc(uid);
    await docRef.set({ syllabusTimeMs: incrementObj }, { merge: true });
    for (const k of Object.keys(local)) pushed[k] = local[k];
    localStorage.setItem(SYLL_PUSHED_KEY, JSON.stringify(pushed));
  } catch (e) { console.warn('[syllabus] échec transmission:', e); }
}

function _syllMergeServer(serverMap) {
  if (!serverMap || typeof serverMap !== 'object') return;
  try {
    let cache;
    try { cache = JSON.parse(localStorage.getItem(SYLL_SERVER_KEY) || '{}'); } catch (e) { cache = {}; }
    let changed = false;
    for (const [k, v] of Object.entries(serverMap)) {
      const n = Number(v) || 0;
      if (n > (cache[k] || 0)) { cache[k] = n; changed = true; }
    }
    if (changed) localStorage.setItem(SYLL_SERVER_KEY, JSON.stringify(cache));
  } catch (e) { /* ignore */ }
}

// ============================================================
// Chronomètre
// ============================================================

function _syllIsRunning() {
  return !!localStorage.getItem(SYLL_TIMER_KEY);
}

function _syllElapsedMs() {
  const start = parseInt(localStorage.getItem(SYLL_TIMER_KEY), 10);
  if (!start) return 0;
  return Date.now() - start;
}

function _syllUpdateTimerUi() {
  const disp = document.getElementById('syllTimerDisplay');
  const warn = document.getElementById('syllTimerWarning');
  const elapsed = _syllElapsedMs();
  if (disp) disp.textContent = _syllFormatHMS(elapsed);
  if (warn) warn.style.display = elapsed > 3 * 60 * 60 * 1000 ? 'block' : 'none';
}

function _syllStartTicking() {
  clearInterval(_syllTimerInterval);
  _syllUpdateTimerUi();
  _syllTimerInterval = setInterval(_syllUpdateTimerUi, 1000);
}

window.syllToggleTimer = async function() {
  const btn = document.getElementById('syllTimerBtn');
  if (_syllIsRunning()) {
    // Arrêt : verser le temps écoulé dans le total du jour et transmettre tout de suite.
    const elapsed = _syllElapsedMs();
    localStorage.removeItem(SYLL_TIMER_KEY);
    clearInterval(_syllTimerInterval);
    _syllTimerInterval = null;
    _syllAddDailyTime(elapsed);
    if (btn) { btn.textContent = '▶️ Démarrer le chronomètre'; btn.classList.remove('syll-timer-running'); }
    _syllUpdateTimerUi();
    const warn = document.getElementById('syllTimerWarning');
    if (warn) warn.style.display = 'none';
    // Afficher AVANT d'attendre la transmission serveur : le temps local est déjà écrit
    // (_syllAddDailyTime ci-dessus), donc le graphique n'a aucune raison d'attendre un
    // aller-retour réseau pour refléter le changement — un réseau lent donnait l'impression
    // qu'il fallait recharger la page pour le voir apparaître.
    _syllRenderChart();
    await _syllSave(_syllUid());
  } else {
    localStorage.setItem(SYLL_TIMER_KEY, String(Date.now()));
    if (btn) { btn.textContent = '⏹️ Arrêter le chronomètre'; btn.classList.add('syll-timer-running'); }
    _syllStartTicking();
  }
};

/** _syllFlushBeforeLeaving() – Filet de sécurité : transmettre tout delta déjà versé (chrono
 * arrêté ou temps saisi manuellement) avant de quitter/mettre l'app en arrière-plan — pas le
 * chronomètre EN COURS lui-même, qui reste volontairement sous contrôle manuel de l'utilisateur
 * (bouton démarrer/arrêter, voir syllToggleTimer). */
function _syllFlushBeforeLeaving() {
  const uid = _syllUid();
  if (uid) _syllSave(uid).catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') _syllFlushBeforeLeaving();
});
window.addEventListener('pagehide', _syllFlushBeforeLeaving);

// ============================================================
// Saisie manuelle
// ============================================================

window.syllAddManual = async function() {
  const dateInput = document.getElementById('syllManualDate');
  const hoursInput = document.getElementById('syllManualHours');
  const minInput = document.getElementById('syllManualMinutes');
  const dateVal = dateInput ? dateInput.value : '';
  const hours = parseInt(hoursInput && hoursInput.value) || 0;
  const minutes = parseInt(minInput && minInput.value) || 0;
  const ms = (hours * 60 + minutes) * 60000;
  if (!dateVal) { alert('Choisis une date.'); return; }
  if (ms <= 0) { alert('Indique une durée supérieure à 0.'); return; }

  _syllAddDailyTime(ms, dateVal);
  // Afficher AVANT d'attendre la transmission serveur — voir le commentaire équivalent dans
  // syllToggleTimer().
  if (hoursInput) hoursInput.value = 0;
  if (minInput) minInput.value = 0;
  _syllRenderChart();
  await _syllSave(_syllUid());
};

// ============================================================
// Graphique "Temps d'étude par jour"
// ============================================================

/** _syllRenderChart() – Même principe d'extension au-delà de 60 jours que le graphique "Temps
 * passé par jour" de Stats (voir afficherDailyChart dans js/stats.js) : fenêtre visible par
 * défaut = 60 derniers jours (scroll démarré sur le bord droit), étendue vers le passé jusqu'au
 * jour le plus ancien avec de l'activité si l'historique remonte plus loin. */
function _syllRenderChart() {
  const cont = document.getElementById('syllChartContainer');
  if (!cont) return;
  const dailyMap = _syllGetDisplayDailyTimeMap();
  const today = new Date();

  const historyKeys = Object.keys(dailyMap).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && dailyMap[k] > 0);
  let totalDays = 60;
  if (historyKeys.length) {
    const oldestKey = historyKeys.reduce((a, b) => (a < b ? a : b));
    const oldestDate = new Date(oldestKey + 'T00:00:00');
    const spanDays = Math.round((today - oldestDate) / 86400000) + 1;
    if (spanDays > totalDays) totalDays = Math.min(spanDays, 3650);
  }

  const days = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    days.push({ key, date: d, ms: dailyMap[key] || 0 });
  }

  const maxMs = Math.max(...days.map(d => d.ms), 1);
  const maxBarH = 120;
  const last60 = days.slice(-60);
  const total60 = last60.reduce((s, d) => s + d.ms, 0);
  const totalAll = days.reduce((s, d) => s + d.ms, 0);
  const todayMs = days[days.length - 1].ms;
  const daysWithTime = last60.filter(d => d.ms > 0).length;
  const avgPerActiveDay = daysWithTime ? total60 / daysWithTime : 0;
  const fmt = (typeof _qtFormatDayDuration === 'function') ? _qtFormatDayDuration : (ms => Math.round(ms / 60000) + ' min');

  const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

  let html = `
    <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
      <strong>Temps d'étude par jour</strong>
      <div style="font-size:.8em;color:var(--text-secondary)">
        auj: <b>${fmt(todayMs)}</b> · 60j: <b>${fmt(total60)}</b> · moy/jour actif: <b>${fmt(avgPerActiveDay)}</b> · total : <b>${fmt(totalAll)}</b>
      </div>
    </div>
    <div class="daily-chart-scroll"><div class="daily-chart">
  `;

  days.forEach((day, idx) => {
    const h = day.ms ? Math.max(Math.round((day.ms / maxMs) * maxBarH), 6) : 0;
    const isToday = idx === days.length - 1;
    const dd = day.date.getDate();
    const isFirstOfMonth = dd === 1;
    const dayLabel = String(dd).padStart(2, '0') + '/' + String(day.date.getMonth() + 1).padStart(2, '0');
    let bottomLabel = '';
    if (isToday) bottomLabel = 'Auj.';
    else if (isFirstOfMonth) bottomLabel = monthNames[day.date.getMonth()];
    else if (idx % 7 === 0) bottomLabel = dayLabel;
    const barColor = isToday ? '#667eea' : (day.ms > 0 ? '#4caf50' : '#e0e0e0');

    html += `<div class="daily-bar-col" title="${dayLabel} : ${day.ms ? fmt(day.ms) : 'aucune activité'}">
      <div class="daily-bar-count">${day.ms ? fmt(day.ms).replace(/ /g, '') : ''}</div>
      <div class="daily-bar" style="height:${h}px;background:${barColor}"></div>
      <div class="daily-bar-label">${bottomLabel}</div>
    </div>`;
  });

  html += '</div></div>';
  cont.innerHTML = html;

  requestAnimationFrame(() => {
    const scroller = cont.querySelector('.daily-chart-scroll');
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  });
}

// ============================================================
// Initialisation
// ============================================================

window.initSyllabus = async function(uid) {
  // Reprendre l'affichage du chrono si déjà en cours (survit à un rechargement, voire à une
  // navigation vers une autre page puis un retour — le chronomètre reste ancré sur son
  // horodatage de départ, pas sur un minuteur qui s'arrêterait au rechargement).
  const btn = document.getElementById('syllTimerBtn');
  if (_syllIsRunning()) {
    if (btn) { btn.textContent = '⏹️ Arrêter le chronomètre'; btn.classList.add('syll-timer-running'); }
    _syllStartTicking();
  } else {
    _syllUpdateTimerUi();
  }

  const dateInput = document.getElementById('syllManualDate');
  if (dateInput) dateInput.value = _syllTodayKey();

  try {
    const doc = await db.collection('quizProgress').doc(uid).get();
    const data = doc.exists ? doc.data() : {};
    _syllMergeServer(data.syllabusTimeMs || {});
  } catch (e) {
    console.warn('[syllabus] chargement serveur échoué (repli sur les données locales):', e);
  }

  _syllRenderChart();
  // Transmettre tout delta local en attente (ex. temps ajouté hors-ligne la dernière fois).
  await _syllSave(uid);
};
