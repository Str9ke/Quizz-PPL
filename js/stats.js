// === stats.js === Statistics, daily chart, session chart, persistence ===

async function displayDailyStats(forcedUid) {
  // PAS d'appel "instant" updateDailyStatsBar() ici :
  // les appelants (initIndex, initQuiz, initStats, quiz.html DOMContentLoaded)
  // font déjà un affichage instant avant d'appeler cette fonction.
  // Un appel ici écraserait la valeur Firestore correcte avec la valeur localStorage périmée
  // (cause du flash 142→137).

  // Assure-toi d'avoir un UID (utile si auth.currentUser n'est pas encore prêt)
  let uid = forcedUid || auth.currentUser?.uid || localStorage.getItem('cachedUid');
  if (!uid) {
    uid = await new Promise(resolve => {
      const unsub = auth.onAuthStateChanged(u => {
        unsub();
        resolve(u?.uid || null);
      });
    });
  }
  if (!uid) {
    console.warn('[displayDailyStats] no uid, abort');
    return;
  }
  try {
    // CROSS-BROWSER : forcer une lecture SERVEUR quand on est en ligne
    // pour récupérer les compteurs écrits par un autre navigateur.
    // Sans cela, la persistance Firestore retourne le cache local (périmé).
    let doc;
    if (navigator.onLine) {
      try {
        doc = await Promise.race([
          db.collection('quizProgress').doc(uid).get({ source: 'server' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('server timeout')), 6000))
        ]);
      } catch (e) {
        console.warn('[displayDailyStats] lecture serveur échouée, fallback cache:', e.message);
        doc = await getDocWithTimeout(db.collection('quizProgress').doc(uid));
      }
    } else {
      doc = await getDocWithTimeout(db.collection('quizProgress').doc(uid));
    }
    const data = doc.exists ? doc.data() : {};
    const rawFirestoreDH = { ...(data.dailyHistory || {}) };
    
    // Enrichir dailyHistory avec les timestamps des réponses (cross-browser : les responses
    // sont sync Firestore, donc fiables même sur un nouveau navigateur)
    let enrichedDH = { ...rawFirestoreDH };
    if (data.responses) {
      enrichedDH = enrichDailyHistoryFromResponses(enrichedDH, data.responses);
    }
    // Fusionner enrichedDH avec TOUT le localStorage (backup + clés individuelles)
    // pour TOUTES les dates, pas seulement aujourd'hui
    try {
      const dhBackup = JSON.parse(localStorage.getItem('dailyHistoryBackup') || '{}');
      for (const [k, v] of Object.entries(dhBackup)) {
        enrichedDH[k] = Math.max(enrichedDH[k] || 0, v);
      }
    } catch (e) { /* ignore */ }
    const _now = new Date();
    for (let i = 0; i < 60; i++) {
      const d = new Date(_now); d.setDate(d.getDate() - i);
      const localKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const lsVal = Math.max(
        parseInt(localStorage.getItem('dailyAnswered_' + localKey)) || 0,
        parseInt(localStorage.getItem('dailyCountRatchet_' + localKey)) || 0
      );
      if (lsVal > 0) enrichedDH[localKey] = Math.max(enrichedDH[localKey] || 0, lsVal);
    }
    
    // Seed le backup localStorage avec les données enrichies
    try {
      const dhBackup2 = JSON.parse(localStorage.getItem('dailyHistoryBackup') || '{}');
      let changed = false;
      for (const [k, v] of Object.entries(enrichedDH)) {
        if (v > (dhBackup2[k] || 0)) { dhBackup2[k] = v; changed = true; }
      }
      if (changed) localStorage.setItem('dailyHistoryBackup', JSON.stringify(dhBackup2));
    } catch (e) { /* ignore */ }
    
    // Compteur aujourd'hui : max de toutes les sources + ratchet
    const todayLocal = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0') + '-' + String(_now.getDate()).padStart(2, '0');
    const todayUtc = _now.toISOString().slice(0, 10);
    let answeredToday = enrichedDH[todayLocal] || 0;
    const todayRatchetKey = 'dailyCountRatchet_' + todayUtc;
    const previousMax = parseInt(localStorage.getItem(todayRatchetKey)) || 0;
    if (answeredToday < previousMax) {
      answeredToday = previousMax;
    } else {
      localStorage.setItem(todayRatchetKey, answeredToday);
    }
    // CROSS-BROWSER FIX : mettre aussi à jour dailyAnswered_ avec la valeur serveur
    // pour que le prochain quiz sur ce navigateur incrémente depuis la bonne base.
    // Sans cela, un PC avec dailyAnswered_=136 qui reçoit 196 du serveur
    // ajouterait +5 à 136 (=141) au lieu de +5 à 196 (=201).
    const todayAnsweredKey = 'dailyAnswered_' + todayUtc;
    const prevAnswered = parseInt(localStorage.getItem(todayAnsweredKey)) || 0;
    if (answeredToday > prevAnswered) {
      localStorage.setItem(todayAnsweredKey, answeredToday);
    }
    enrichedDH[todayLocal] = answeredToday;

    // SYNC CROSS-BROWSER : écrire uniquement les valeurs SUPÉRIEURES à Firestore
    // Maintenant que nous forçons source:'server' quand online, rawFirestoreDH reflète
    // les vraies valeurs serveur → on peut comparer et ne jamais écraser une valeur plus haute.
    const syncUpdate = {};
    for (const [dateKey, mergedVal] of Object.entries(enrichedDH)) {
      if (mergedVal > 0 && mergedVal > (rawFirestoreDH[dateKey] || 0)) {
        syncUpdate['dailyHistory.' + dateKey] = mergedVal;
      }
    }
    if (Object.keys(syncUpdate).length > 0) {
      try {
        await db.collection('quizProgress').doc(uid).set(syncUpdate, { merge: true });
        // waitForPendingWrites : attend que le SERVEUR accuse réception
        if (db.waitForPendingWrites) {
          await Promise.race([
            db.waitForPendingWrites(),
            new Promise(resolve => setTimeout(resolve, 5000))
          ]);
        }
        console.log('[displayDailyStats] sync OK:', Object.keys(syncUpdate).length, 'dates pushées au serveur');
      } catch (e) { console.warn('[displayDailyStats] write-back failed:', e); }
    }

    // Mettre à jour la barre avec les données enrichies
    updateDailyStatsBar(answeredToday, enrichedDH);
  } catch (error) {
    console.error('[displayDailyStats] Erreur:', error);
    // Même en erreur, la barre est déjà affichée depuis localStorage (appel INSTANT au début)
  }
}

/**
 * toggleAutoStart() – Active/désactive le démarrage automatique du quiz
 */

function displayHomeProgressBar(responses, dailyHistory) {
  const cont = document.getElementById('progressionContainer');
  if (!cont) return;

  let reussie = 0, ratee = 0, nonvue = 0, marquee = 0, importante = 0;
  questions.forEach(q => {
    const key = getKeyFor(q);
    const r = responses[key];
    if (!r) { nonvue++; }
    else {
      // Une question suspendue ("Ne plus revoir") compte obligatoirement comme réussie
      // dans la progression — voir _effectiveStatus() dans helpers.js.
      const eff = (typeof _effectiveStatus === 'function') ? _effectiveStatus(r) : r.status;
      if (eff === 'réussie') reussie++;
      else if (eff === 'ratée') ratee++;
      else nonvue++;
      if (r.marked) marquee++;
      if (r.important) importante++;
    }
  });
  const total = reussie + ratee + nonvue;
  const perc = total ? (reussie * 100 / total).toFixed(2) : '0.00';
  function percColor(p) {
    if (p >= 80) return '#4caf50';
    if (p >= 50) return '#ff9800';
    return '#f44336';
  }

  // Fusionner dailyHistory avec localStorage backup (même source que l'objectif/chart)
  const mergedDH = { ...(dailyHistory || {}) };
  try {
    const dhBackup = JSON.parse(localStorage.getItem('dailyHistoryBackup') || '{}');
    for (const [k, v] of Object.entries(dhBackup)) {
      mergedDH[k] = Math.max(mergedDH[k] || 0, v);
    }
  } catch (e) { /* ignore */ }
  // Ajouter les clés individuelles localStorage (60 jours)
  const _now = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(_now);
    d.setDate(d.getDate() - i);
    const lk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const lsVal = Math.max(
      parseInt(localStorage.getItem('dailyAnswered_' + lk)) || 0,
      parseInt(localStorage.getItem('dailyCountRatchet_' + lk)) || 0
    );
    if (lsVal > 0) mergedDH[lk] = Math.max(mergedDH[lk] || 0, lsVal);
  }

  // Calculer l'estimation des jours restants
  // Basé sur les questions NOUVELLEMENT RÉUSSIES par jour (moy. 7j)
  const remaining = ratee + nonvue;
  let daysRemainingHtml = '';
  if (remaining > 0) {
    const today = new Date();
    // Utiliser le compteur de questions maîtrisées (non-vue/ratée → réussie)
    const masteredDH = (typeof _getDailyMasteredMerged === 'function') ? _getDailyMasteredMerged() : {};
    let totalMast7 = 0;
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      totalMast7 += masteredDH[key] || 0;
    }
    const avgMast7 = totalMast7 / 7;
    if (avgMast7 > 0) {
      const daysLeft = Math.ceil(remaining / avgMast7);
      daysRemainingHtml = `<span title="Basé sur ${Math.round(avgMast7)} nouvelles questions réussies/jour (moy. 7j)">📆 ~${daysLeft} jour${daysLeft > 1 ? 's' : ''} restant${daysLeft > 1 ? 's' : ''}</span>`;
    } else {
      // Fallback: enrichir mergedDH avec _getDailyHistoryMerged() pour maximaliser les données
      const fullLocalDH = (typeof _getDailyHistoryMerged === 'function') ? _getDailyHistoryMerged() : {};
      for (const [k, v] of Object.entries(fullLocalDH)) {
        mergedDH[k] = Math.max(mergedDH[k] || 0, v);
      }
      // Essayer 7 jours (hors aujourd'hui), puis 30 jours en fallback
      const windows = [7, 30];
      for (const win of windows) {
        let totalW = 0, activeDays = 0;
        for (let i = 1; i <= win; i++) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          const val = mergedDH[key] || 0;
          totalW += val;
          if (val > 0) activeDays++;
        }
        // Diviser par le nombre de jours actifs (non-zéro) pour une moyenne réaliste
        const activeDivisor = activeDays > 0 ? activeDays : win;
        const avgW = totalW / activeDivisor;
        if (avgW > 0) {
          const daysLeft = Math.ceil(remaining / avgW);
          const label = win === 7 ? 'moy. 7j' : 'moy. 30j';
          daysRemainingHtml = `<span title="Basé sur la moyenne de ${Math.round(avgW)} réponses/jour (${label} — estimation provisoire)">📆 ~${daysLeft} jour${daysLeft > 1 ? 's' : ''} restant${daysLeft > 1 ? 's' : ''}</span>`;
          break;
        }
      }
    }
  }

  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <strong>Progression globale</strong>
      <span style="font-size:1.4em;font-weight:bold;color:${percColor(perc)}">${perc}%</span>
    </div>
    <div class="progressbar" style="height:14px;margin:4px 0">
      <div class="progress" style="height:14px;width:${perc}%;background:${percColor(perc)}"></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:0.85em;color:var(--text-secondary);margin-top:4px">
      <span>${total} questions</span>
      <span>✅ ${reussie}</span>
      <span>❌ ${ratee}</span>
      <span>👀 ${nonvue} restante${nonvue > 1 ? 's' : ''}</span>
      <span>📌 ${marquee}</span>
      <span>⭐ ${importante}</span>
    </div>
    ${daysRemainingHtml ? `<div style="margin-top:6px;font-size:0.9em;color:#667eea;font-weight:600">${daysRemainingHtml}</div>` : ''}
  `;
}

/** saveDailyCount — Sauvegarde le compteur quotidien (valeur absolue depuis localStorage)
 *  Utilise une transaction Firestore pour garantir max(local, serveur) et ne jamais
 *  écraser le compteur d'un autre navigateur avec une valeur plus basse.
 */
async function saveDailyCount(uid) {
  try {
    const today = new Date();
    const dateKey = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    const utcKey = today.toISOString().slice(0, 10);
    
    // Lire la valeur absolue depuis localStorage (source de vérité locale)
    const absoluteCount = Math.max(
      parseInt(localStorage.getItem('dailyCountRatchet_' + utcKey)) || 0,
      parseInt(localStorage.getItem('dailyAnswered_' + utcKey)) || 0
    );
    if (absoluteCount <= 0) return;
    
    const docRef = db.collection('quizProgress').doc(uid);
    
    // Transaction atomique : lire la valeur SERVEUR et écrire max(local, serveur)
    // → empêche Firefox d'écraser 198 (Chrome) avec 172 (Firefox)
    if (navigator.onLine) {
      try {
        await db.runTransaction(async (transaction) => {
          const doc = await transaction.get(docRef);
          const serverVal = doc.exists ? ((doc.data().dailyHistory || {})[dateKey] || 0) : 0;
          const newVal = Math.max(absoluteCount, serverVal);
          const update = {};
          update['dailyHistory.' + dateKey] = newVal;
          transaction.set(docRef, update, { merge: true });
          // Mettre à jour le ratchet local si le serveur avait plus
          if (serverVal > absoluteCount) {
            localStorage.setItem('dailyCountRatchet_' + utcKey, serverVal);
          }
        });
        return; // Transaction réussie
      } catch (txErr) {
        console.warn('[saveDailyCount] transaction échouée, fallback direct:', txErr.message);
      }
    }
    // Fallback (offline ou transaction échouée) : lire le serveur et écrire max(local, serveur)
    let fallbackVal = absoluteCount;
    try {
      const currentDoc = await docRef.get();
      if (currentDoc.exists) {
        const currentServerVal = (currentDoc.data().dailyHistory || {})[dateKey] || 0;
        fallbackVal = Math.max(absoluteCount, currentServerVal);
        if (currentServerVal > absoluteCount) {
          localStorage.setItem('dailyCountRatchet_' + utcKey, currentServerVal);
          localStorage.setItem('dailyAnswered_' + utcKey, currentServerVal);
        }
      }
    } catch (readErr) { /* use absoluteCount as-is */ }
    const update = {};
    update['dailyHistory.' + dateKey] = fallbackVal;
    await docRef.set(update, { merge: true });
  } catch (e) {
    console.error('[saveDailyCount] error:', e);
    throw e; // Propager pour que saveDailyCountOffline tombe dans le fallback IndexedDB
  }
}

/**
 * saveDailyMastered — Sauvegarde le compteur de questions nouvellement maîtrisées
 * dans Firestore (champ dailyMastered) pour sync cross-device.
 * Utilise max(local, serveur) pour ne jamais écraser une valeur plus haute.
 */
async function saveDailyMastered(uid) {
  if (!navigator.onLine) return;
  try {
    const dmBackup = JSON.parse(localStorage.getItem('dailyMasteredBackup') || '{}');
    if (!Object.keys(dmBackup).length) return;
    const docRef = db.collection('quizProgress').doc(uid);
    await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(docRef);
      const serverDM = doc.exists ? (doc.data().dailyMastered || {}) : {};
      const update = {};
      let changed = false;
      for (const [k, v] of Object.entries(dmBackup)) {
        const best = Math.max(v, serverDM[k] || 0);
        if (best > (serverDM[k] || 0)) { update['dailyMastered.' + k] = best; changed = true; }
      }
      if (!changed) return;
      transaction.set(docRef, update, { merge: true });
    });
  } catch (e) { console.warn('[saveDailyMastered] error:', e); }
}
window.saveDailyMastered = saveDailyMastered;

/**
 * Utilise arrayUnion pour un ajout atomique sans read-modify-write.
 * Cela garantit que les sessions ajoutées sur différents appareils ne s'écrasent pas.
 */
async function saveSessionResult(uid, correct, total, category, sessionDate) {
  // S'assurer que la persistance Firestore est initialisée
  // (sinon le write va dans le cache in-memory et se perd au rechargement)
  await _ensurePersistence();
  try {
    const docRef = db.collection('quizProgress').doc(uid);
    const entry = {
      date: sessionDate || new Date().toISOString(),
      correct,
      total,
      category,
      percent: total > 0 ? Math.round(100 * correct / total) : 0
    };
    // arrayUnion = ajout atomique côté serveur, pas de lecture préalable nécessaire
    // → fonctionne correctement même si plusieurs appareils ajoutent des sessions
    await docRef.set(
      {
        sessionHistory: firebase.firestore.FieldValue.arrayUnion(entry),
        lastUpdated: firebase.firestore.Timestamp.now()
      },
      { merge: true }
    );
    console.log('[saveSessionResult] session saved via arrayUnion:', correct + '/' + total);
  } catch (e) {
    console.error('[saveSessionResult] error:', e);
    throw e; // Propager pour que saveSessionResultOffline tombe dans le fallback IndexedDB
  }
}

/**
 * _trimSessionHistory() – Limite l'historique à 200 sessions max.
 * À appeler uniquement en ligne (après sync), car c'est un read-modify-write.
 */
async function _trimSessionHistory(uid) {
  try {
    const docRef = db.collection('quizProgress').doc(uid);
    const doc = await docRef.get();
    if (!doc.exists) return;
    const history = doc.data().sessionHistory || [];
    if (history.length <= 200) return;
    // Trier par date et garder les 200 dernières
    history.sort((a, b) => new Date(a.date) - new Date(b.date));
    const trimmed = history.slice(-200);
    await docRef.set({ sessionHistory: trimmed }, { merge: true });
    console.log('[_trimSessionHistory] trimmed from', history.length, 'to', trimmed.length);
  } catch (e) {
    console.warn('[_trimSessionHistory] error:', e.message);
  }
}

/**
 * getDailyHistory() – Récupère l'historique quotidien depuis Firestore
 * Retourne un objet { "YYYY-MM-DD": count, ... }
 */
async function getDailyHistory(uid) {
  try {
    const doc = await getDocWithTimeout(db.collection('quizProgress').doc(uid));
    return (doc.exists && doc.data().dailyHistory) ? doc.data().dailyHistory : {};
  } catch (e) {
    console.error('[getDailyHistory] error:', e);
    return {};
  }
}

/**
 * enrichDailyHistoryFromResponses() – Reconstruit l'historique quotidien à partir des timestamps
 * des réponses pour les dates où dailyHistory n'a PAS de données (bootstrap initial).
 * Note : les timestamps sont écrasés à chaque nouvelle tentative, donc cette méthode
 * sous-estime les jours anciens. Mais c'est mieux que des barres vides.
 * Pour les dates récentes (couvertes par saveDailyCount), on garde la valeur incrémentale.
 */
function enrichDailyHistoryFromResponses(dailyHistory, responses) {
  if (!responses || typeof responses !== 'object') return { ...dailyHistory };
  const enriched = { ...dailyHistory };
  // Compter les réponses par date locale
  const countsByDate = {};
  for (const r of Object.values(responses)) {
    let ts = null;
    if (r.timestamp?.seconds !== undefined) ts = r.timestamp.seconds * 1000;
    else if (typeof r.timestamp === 'number') ts = r.timestamp;
    else if (r.lastUpdated?.seconds !== undefined) ts = r.lastUpdated.seconds * 1000;
    else if (typeof r.lastUpdated === 'number') ts = r.lastUpdated;
    if (!ts) continue;
    const d = new Date(ts);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    countsByDate[key] = (countsByDate[key] || 0) + 1;
  }
  // Prendre le max entre la valeur existante et le comptage des réponses
  // (les réponses sont sync Firestore → même données cross-browser)
  for (const [dateKey, count] of Object.entries(countsByDate)) {
    enriched[dateKey] = Math.max(enriched[dateKey] || 0, count);
  }
  return enriched;
}

/** computeStatsForFirestore() — Calcule les stats pour une catégorie à partir des réponses Firestore */
function computeStatsForFirestore(categoryQuestions, responses, notesMap) {
  // Normaliser (legacy status==='marquée', etc.) comme le fait l'accueil/le quiz — cette
  // fonction lisait auparavant les données brutes, un chemin distinct de normalizeResponses()
  // qui pouvait diverger sur d'anciennes données pas encore migrées vers le format actuel.
  const normResponses = (typeof normalizeResponses === 'function') ? normalizeResponses(responses) : responses;
  const notes = notesMap || (typeof _notesCache === 'object' && _notesCache) || {};
  let reussie = 0, ratee = 0, nonvue = 0, marquee = 0, importante = 0, marqueeVue = 0, importanteVue = 0;
  let flagged = 0, flaggedVue = 0;
  categoryQuestions.forEach(q => {
    const key = getKeyFor(q);
    const r = normResponses[key] || {};
    // Une question suspendue ("Ne plus revoir") compte obligatoirement comme réussie
    // dans les stats — voir _effectiveStatus() dans helpers.js.
    const eff = (typeof _effectiveStatus === 'function') ? _effectiveStatus(r) : r.status;
    const seen = eff === 'réussie' || eff === 'ratée';
    // compter toujours réussite/échec/non-vu
    if (eff === 'réussie')      reussie++;
    else if (eff === 'ratée')    ratee++;
    else                               nonvue++;
    // marquée / importante en supplément
    if (r.marked)    { marquee++;    if (seen) marqueeVue++; }
    if (r.important) { importante++; if (seen) importanteVue++; }
    // marquée OU importante OU notée ("caractérisée") — sert au reset ciblé (garder progression à 0)
    if (r.marked || r.important || !!notes[key]) {
      flagged++;
      if (seen) flaggedVue++;
    }
  });
  return { reussie, ratee, nonvue, marquee, importante, marqueeVue, importanteVue, flagged, flaggedVue };
}

/**
 * initStats() – Chargement initial sur stats.html pour afficher les statistiques
 * Organise les catégories en groupes pour un affichage compact.
 */
async function initStats() {

  // INSTANT : afficher les sessions et la barre quotidienne depuis localStorage
  // AVANT toute opération Firestore (qui peut prendre 10-15s offline sur Android)
  try {
    const localBackupInstant = _getLocalSessionBackup();
    if (localBackupInstant.length) afficherSessionChart(localBackupInstant);
  } catch (e) { /* ignore */ }
  try {
    updateDailyStatsBar(); // streak, objectif, compteur, barre — tout depuis localStorage
  } catch (e) { /* ignore */ }

  if (typeof auth === 'undefined' || !auth) {
    console.error("Firebase Auth n'est pas initialisé.");
    alert("Erreur : Firebase Auth n'est pas initialisé.");
    return;
  }

  if (!auth.currentUser && !localStorage.getItem('cachedUid')) {
    console.error("Utilisateur non authentifié");
    window.location = 'index.html';
    return;
  }

  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');

  try {
    // Pré-charger tous les JSON en parallèle (depuis le cache SW = quasi-instantané)
    await prefetchAllJsonFiles();

    // CROSS-BROWSER FIX : forcer une lecture SERVEUR quand on est en ligne
    // Sans cela, enablePersistence retourne le cache local (périmé si un autre
    // appareil a écrit de nouvelles données, ex: Android 196 vs PC cache 136).
    let doc;
    if (navigator.onLine) {
      try {
        doc = await Promise.race([
          db.collection('quizProgress').doc(uid).get({ source: 'server' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('initStats server timeout')), 6000))
        ]);
        console.log('[initStats] Firestore lu depuis le SERVEUR');
      } catch (e) {
        console.warn('[initStats] lecture serveur échouée, fallback cache:', e.message);
        doc = await getDocWithTimeout(db.collection('quizProgress').doc(uid));
      }
    } else {
      doc = await getDocWithTimeout(db.collection('quizProgress').doc(uid));
    }
    const data = doc.exists ? doc.data() : { responses: {} };
    // Garder une copie des valeurs serveur brutes pour la comparaison lors du write-back
    const rawServerDailyHistory = { ...(data.dailyHistory || {}) };

    // Groupes de catégories (sans doublons d'agrégats)
    const groups = [
      {
        name: "CLASSIQUES",
        categories: [
          { label: "Procédure Radio", value: "PROCÉDURE RADIO" },
          { label: "Procédures Op.", value: "PROCÉDURES OPÉRATIONNELLES" },
          { label: "Réglementation", value: "RÉGLEMENTATION" },
          { label: "Connaissance Avion", value: "CONNAISSANCE DE L'AVION" },
          { label: "Instrumentation", value: "INSTRUMENTATION" },
          { label: "Masse & Centrage", value: "MASSE ET CENTRAGE" },
          { label: "Motorisation", value: "MOTORISATION" },
          { label: "Aérodynamique", value: "AERODYNAMIQUE PRINCIPES DU VOL" }
        ]
      },
      {
        name: "EASA",
        categories: [
          { label: "Procédures", value: "EASA PROCEDURES" },
          { label: "Aérodynamique", value: "EASA AERODYNAMIQUE" },
          { label: "Navigation", value: "EASA NAVIGATION" },
          { label: "Connaissance Avion", value: "EASA CONNAISSANCE DE L'AVION" },
          { label: "Météorologie", value: "EASA METEOROLOGIE" },
          { label: "Perf. & Planif.", value: "EASA PERFORMANCE ET PLANIFICATION" },
          { label: "Réglementation", value: "EASA REGLEMENTATION" },
          { label: "Perf. Humaines", value: "EASA PERFORMANCES HUMAINES" }
        ]
      },
      {
        name: "GLIGLI HARD",
        categories: [
          { label: "Communications", value: "GLIGLI COMMUNICATIONS HARD" },
          { label: "Conn. Gén. Aéronef", value: "GLIGLI CONNAISSANCES GENERALES AERONEF HARD" },
          { label: "Épreuve Commune", value: "GLIGLI EPREUVE COMMUNE HARD" },
          { label: "Épreuve Spécifique", value: "GLIGLI EPREUVE SPECIFIQUE HARD" },
          { label: "Météorologie", value: "GLIGLI METEOROLOGIE HARD" },
          { label: "Navigation", value: "GLIGLI NAVIGATION HARD" },
          { label: "Perf. Humaine", value: "GLIGLI PERFORMANCE HUMAINE HARD" },
          { label: "Perf. & Prép. Vol", value: "GLIGLI PERFORMANCES PREPARATION VOL HARD" },
          { label: "Principes du Vol", value: "GLIGLI PRINCIPES DU VOL HARD" },
          { label: "Proc. Op.", value: "GLIGLI PROCEDURES OPERATIONNELLES HARD" },
          { label: "Réglementation", value: "GLIGLI REGLEMENTATION HARD" }
        ]
      },
      {
        name: "GLIGLI EASY",
        categories: [
          { label: "Communications", value: "GLIGLI COMMUNICATIONS EASY" },
          { label: "Conn. Gén. Aéronef", value: "GLIGLI CONNAISSANCES GENERALES AERONEF EASY" },
          { label: "Épreuve Commune", value: "GLIGLI EPREUVE COMMUNE EASY" },
          { label: "Épreuve Spécifique", value: "GLIGLI EPREUVE SPECIFIQUE EASY" },
          { label: "Météorologie", value: "GLIGLI METEOROLOGIE EASY" },
          { label: "Navigation", value: "GLIGLI NAVIGATION EASY" },
          { label: "Perf. Humaine", value: "GLIGLI PERFORMANCE HUMAINE EASY" },
          { label: "Perf. & Prép. Vol", value: "GLIGLI PERFORMANCES PREPARATION VOL EASY" },
          { label: "Principes du Vol", value: "GLIGLI PRINCIPES DU VOL EASY" },
          { label: "Proc. Op.", value: "GLIGLI PROCEDURES OPERATIONNELLES EASY" },
          { label: "Réglementation", value: "GLIGLI REGLEMENTATION EASY" }
        ]
      }
    ];

    // Charger les stats pour chaque catégorie individuelle
    const groupsData = [];
    for (const group of groups) {
      const catStats = [];
      for (const cat of group.categories) {
        try {
          await chargerQuestions(cat.value);
          const catQuestions = [...questions];
          const isEpreuve = cat.value.includes('EPREUVE');
          const fullStats = computeStatsForFirestore(catQuestions, data.responses);
          // Pour les totaux groupe/global : ne compter que les questions uniques des épreuves
          // (les refs sont déjà comptées dans leurs catégories thématiques)
          const globalContrib = isEpreuve
            ? computeStatsForFirestore(catQuestions.filter(q => q.categorie === cat.value), data.responses)
            : fullStats;
          catStats.push({ label: cat.label, value: cat.value, stats: fullStats, globalContrib });
        } catch (err) {
          console.error("Stat error for", cat.value, err);
          const emptyStats = { reussie: 0, ratee: 0, nonvue: 0, marquee: 0, importante: 0, marqueeVue: 0, importanteVue: 0, flagged: 0, flaggedVue: 0 };
          catStats.push({ label: cat.label, value: cat.value, stats: emptyStats, globalContrib: emptyStats });
        }
      }
      groupsData.push({ name: group.name, categories: catStats });
    }

    // Compute global stats from deduplicated question set (same as home page)
    await loadAllQuestions();
    const globalStats = computeStatsForFirestore(questions, data.responses);

    afficherStats(groupsData, globalStats);

    // Estimation du temps pour tout maîtriser : garder les réponses/notes déjà chargées
    // (évite un 2e appel Firestore) et construire la carte de sélection en bas de page.
    window._masteryResponses = data.responses || {};
    window._masteryNotes = data.notes || {};
    if (typeof _renderMasteryEstimator === 'function') _renderMasteryEstimator(groups);
    // Restreint le "Programme des prochains jours" aux questions réellement chargées — voir
    // le commentaire de _computeSrForecast() (sinon des réponses orphelines d'anciennes
    // questions supprimées/renommées gonflaient artificiellement le compteur "Aujourd'hui"
    // par rapport à l'Accueil, qui lui ne compte que les questions du bank actuel).
    const validSrKeys = new Set(questions.map(q => getKeyFor(q)));
    if (typeof _renderSrForecast === 'function') _renderSrForecast(data.responses || {}, validSrKeys);
    if (typeof _renderReadinessDashboard === 'function') _renderReadinessDashboard(groupsData);

    // Utiliser l'historique quotidien déjà chargé dans data (évite un 2e appel Firestore qui peut timeout)
    const dailyHistory = data.dailyHistory || {};
    const _today = new Date();
    // Fusionner avec le backup localStorage (filet de sécurité si Firestore a perdu des incréments)
    const dhBackup = JSON.parse(localStorage.getItem('dailyHistoryBackup') || '{}');
    for (const [dateKey, count] of Object.entries(dhBackup)) {
      dailyHistory[dateKey] = Math.max(dailyHistory[dateKey] || 0, count);
    }
    // Récupérer aussi les anciennes clés dailyAnswered_*/dailyCountRatchet_* de localStorage
    // (elles utilisent des dates UTC, les convertir en dates locales pour le graphique)
    for (let i = 0; i < 60; i++) {
      const d = new Date(_today);
      d.setDate(d.getDate() - i);
      const localKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      // bug corrigé : le code prétendait convertir UTC->local mais réutilisait en fait
      // localKey tel quel (utcKey1 = localKey), donc pour l'heure suivant minuit local
      // (ex: 00h30 en France = 23h30 UTC la veille), la vraie clé UTC utilisée à l'écriture
      // n'était jamais vérifiée et cette activité legacy passait silencieusement à la trappe.
      const utcKey = d.toISOString().slice(0, 10);
      const lsVal = Math.max(
        parseInt(localStorage.getItem('dailyAnswered_' + localKey)) || 0,
        parseInt(localStorage.getItem('dailyCountRatchet_' + localKey)) || 0,
        parseInt(localStorage.getItem('dailyAnswered_' + utcKey)) || 0,
        parseInt(localStorage.getItem('dailyCountRatchet_' + utcKey)) || 0
      );
      if (lsVal > 0) {
        dailyHistory[localKey] = Math.max(dailyHistory[localKey] || 0, lsVal);
      }
    }
    // Pour aujourd'hui : réconcilier aussi avec les compteurs UTC de localStorage
    const todayKeyLocal = _today.getFullYear() + '-' + String(_today.getMonth() + 1).padStart(2, '0') + '-' + String(_today.getDate()).padStart(2, '0');
    const todayKeyUtc = _today.toISOString().slice(0, 10);
    const lsDailyCount = parseInt(localStorage.getItem('dailyAnswered_' + todayKeyUtc)) || 0;
    const ratchetCount = parseInt(localStorage.getItem('dailyCountRatchet_' + todayKeyUtc)) || 0;
    dailyHistory[todayKeyLocal] = Math.max(dailyHistory[todayKeyLocal] || 0, lsDailyCount, ratchetCount);
    // Enrichir avec les timestamps des réponses (comble les jours sans données incrémentales)
    const enrichedHistory = enrichDailyHistoryFromResponses(dailyHistory, data.responses);
    // Recopier dans dailyHistory pour que le backup capture aussi les données enrichies
    for (const [k, v] of Object.entries(enrichedHistory)) {
      dailyHistory[k] = Math.max(dailyHistory[k] || 0, v);
    }
    // Sauvegarder le dailyHistory fusionné dans localStorage pour les futures visites
    // (agit comme seed : si Firestore fonctionne maintenant, on capture les données existantes)
    try {
      const existingBackup = JSON.parse(localStorage.getItem('dailyHistoryBackup') || '{}');
      let changed = false;
      for (const [k, v] of Object.entries(dailyHistory)) {
        if (v > (existingBackup[k] || 0)) { existingBackup[k] = v; changed = true; }
      }
      if (changed) localStorage.setItem('dailyHistoryBackup', JSON.stringify(existingBackup));
    } catch (e) { /* ignore */ }
    afficherDailyChart(dailyHistory);

    // Mettre à jour la barre quotidienne avec les données enrichies
    // (la barre initiale était depuis localStorage, maintenant on a les données Firestore)
    const todayEnrichedCount = dailyHistory[todayKeyLocal] || 0;
    updateDailyStatsBar(todayEnrichedCount, dailyHistory);

    // SYNC CROSS-BROWSER : utiliser une transaction pour garantir max(local, serveur)
    // et ne JAMAIS écraser une valeur plus élevée provenant d'un autre appareil.
    // Avant, on écrivait TOUTES les valeurs locales → un PC avec 136 en cache
    // écrasait le 196 de l'Android sur le serveur.
    if (navigator.onLine) {
      try {
        const docRef = db.collection('quizProgress').doc(uid);
        await db.runTransaction(async (transaction) => {
          const freshDoc = await transaction.get(docRef);
          const serverDH = freshDoc.exists ? (freshDoc.data().dailyHistory || {}) : {};
          const update = {};
          let hasUpdates = false;
          // Écrire seulement les valeurs locales SUPÉRIEURES au serveur
          for (const [dateKey, localVal] of Object.entries(dailyHistory)) {
            const serverVal = serverDH[dateKey] || 0;
            if (localVal > serverVal) {
              update['dailyHistory.' + dateKey] = localVal;
              hasUpdates = true;
            }
            // Si le serveur a une valeur plus haute (autre appareil), mettre à jour localement
            if (serverVal > localVal) {
              dailyHistory[dateKey] = serverVal;
            }
          }
          // Vérifier aussi les dates présentes sur le serveur mais pas en local
          for (const [dateKey, serverVal] of Object.entries(serverDH)) {
            if (serverVal > (dailyHistory[dateKey] || 0)) {
              dailyHistory[dateKey] = serverVal;
            }
          }
          if (hasUpdates) {
            transaction.set(docRef, update, { merge: true });
          }
        });
        // Après la transaction : mettre à jour localStorage avec les valeurs réconciliées
        try {
          const reconciledBackup = JSON.parse(localStorage.getItem('dailyHistoryBackup') || '{}');
          let changed2 = false;
          for (const [k, v] of Object.entries(dailyHistory)) {
            if (v > (reconciledBackup[k] || 0)) { reconciledBackup[k] = v; changed2 = true; }
          }
          if (changed2) localStorage.setItem('dailyHistoryBackup', JSON.stringify(reconciledBackup));
        } catch (e) { /* ignore */ }
        // Mettre à jour les clés ratchet/dailyAnswered pour aujourd'hui
        const freshTodayVal = dailyHistory[todayKeyLocal] || 0;
        const currentRatchet = parseInt(localStorage.getItem('dailyCountRatchet_' + todayKeyUtc)) || 0;
        if (freshTodayVal > currentRatchet) {
          localStorage.setItem('dailyCountRatchet_' + todayKeyUtc, freshTodayVal);
          localStorage.setItem('dailyAnswered_' + todayKeyUtc, freshTodayVal);
        }
        // Re-render le chart et la barre avec les données réconciliées
        afficherDailyChart(dailyHistory);
        const reconciledToday = dailyHistory[todayKeyLocal] || 0;
        updateDailyStatsBar(reconciledToday, dailyHistory);
        console.log('[initStats] sync transactionnelle OK, today=' + reconciledToday);
      } catch (e) {
        console.warn('[initStats] sync transactionnelle échouée:', e.message);
        // Fallback : écrire seulement les valeurs SUPÉRIEURES aux valeurs serveur brutes
        const syncUpdate2 = {};
        for (const [dateKey, mergedVal] of Object.entries(dailyHistory)) {
          if (mergedVal > 0 && mergedVal > (rawServerDailyHistory[dateKey] || 0)) {
            syncUpdate2['dailyHistory.' + dateKey] = mergedVal;
          }
        }
        if (Object.keys(syncUpdate2).length > 0) {
          try {
            await db.collection('quizProgress').doc(uid).set(syncUpdate2, { merge: true });
          } catch (e2) { console.warn('[initStats] fallback write-back failed:', e2); }
        }
      }
    }

    // Afficher l'historique des sessions (fusionner Firestore + backup localStorage)
    const firestoreHistory = data.sessionHistory || [];
    const localBackup = _getLocalSessionBackup();
    const sessionHistory = _mergeSessionHistories(firestoreHistory, localBackup);
    // Trier par date (arrayUnion ne garantit pas l'ordre)
    sessionHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
    // Stocker globalement pour les graphiques par catégorie
    window._sessionHistoryCache = sessionHistory;
    afficherSessionChart(sessionHistory);
    _renderSessionCategoryDiagnostic(sessionHistory);
  } catch (error) {
    console.error("Erreur stats:", error);
    afficherStats([]);
    // Même en cas d'erreur Firestore, afficher les sessions offline depuis localStorage
    const localBackup = _getLocalSessionBackup();
    if (localBackup.length) afficherSessionChart(localBackup);
  }
}

// ---- Backup localStorage pour les sessions offline ----

/** Sauvegarde une session en localStorage (backup pour l'affichage offline) */
function _saveSessionToLocalBackup(correct, total, category, sessionDate) {
  try {
    const backup = JSON.parse(localStorage.getItem('offlineSessionBackup') || '[]');
    const date = sessionDate || new Date().toISOString();
    // Dédupliquer : ne pas ajouter si une session avec la même date existe déjà
    if (backup.some(s => s.date === date)) return;
    backup.push({
      date,
      correct,
      total,
      category,
      percent: total > 0 ? Math.round(100 * correct / total) : 0
    });
    // Garder les 60 dernières max
    if (backup.length > 60) backup.splice(0, backup.length - 60);
    localStorage.setItem('offlineSessionBackup', JSON.stringify(backup));
  } catch (e) {
    console.warn('[_saveSessionToLocalBackup] erreur:', e.message);
  }
}

/** Lit le backup localStorage des sessions */
function _getLocalSessionBackup() {
  try {
    return JSON.parse(localStorage.getItem('offlineSessionBackup') || '[]');
  } catch { return []; }
}

/** Fusionne les sessions Firestore et localStorage (déduplique par date) */
function _mergeSessionHistories(firestoreSessions, localSessions) {
  if (!localSessions.length) return firestoreSessions;
  if (!firestoreSessions.length) return localSessions;
  // Créer un Set des dates Firestore pour dédupliquer
  const firestoreDates = new Set(firestoreSessions.map(s => s.date));
  const merged = [...firestoreSessions];
  for (const ls of localSessions) {
    if (!firestoreDates.has(ls.date)) {
      merged.push(ls);
    }
  }
  // Trier par date
  merged.sort((a, b) => new Date(a.date) - new Date(b.date));
  return merged.slice(-200);
}

/** Nettoie le backup localStorage (sessions qui sont déjà dans Firestore) */
function _cleanLocalSessionBackup(firestoreSessions) {
  try {
    const backup = _getLocalSessionBackup();
    if (!backup.length) return;
    const firestoreDates = new Set(firestoreSessions.map(s => s.date));
    const remaining = backup.filter(s => !firestoreDates.has(s.date));
    if (remaining.length !== backup.length) {
      localStorage.setItem('offlineSessionBackup', JSON.stringify(remaining));
    }
  } catch (e) { /* ignore */ }
}

/** afficherStats — Affiche les statistiques par groupe */
function afficherStats(groupsData, globalStats) {
  const cont = document.getElementById('statsContainer');
  if (!cont) return;

  if (!Array.isArray(groupsData) || groupsData.length === 0) {
    cont.innerHTML = '<p>Aucune statistique disponible.</p>';
    return;
  }

  // Couleur selon le pourcentage
  function percColor(p) {
    if (p >= 80) return '#4caf50';
    if (p >= 50) return '#ff9800';
    return '#f44336';
  }

  // Totaux globaux from deduplicated question set
  const gRe = globalStats.reussie;
  const gRa = globalStats.ratee;
  const gNv = globalStats.nonvue;
  const gMa = globalStats.marquee;
  const gIm = globalStats.importante || 0;
  const gTotal = gRe + gRa + gNv;
  const gPerc = gTotal ? (gRe * 100 / gTotal).toFixed(2) : '0.00';

  // Calculer les jours restants (basé sur les questions NOUVELLEMENT RÉUSSIES/jour, moy. 7j)
  const gRemaining = gRa + gNv;
  let gDaysHtml = '';
  if (gRemaining > 0) {
    const masteredDH = (typeof _getDailyMasteredMerged === 'function') ? _getDailyMasteredMerged() : {};
    const _now = new Date();
    let tMast7 = 0;
    for (let i = 1; i <= 7; i++) {
      const d = new Date(_now);
      d.setDate(d.getDate() - i);
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      tMast7 += masteredDH[k] || 0;
    }
    const aMast7 = tMast7 / 7;
    if (aMast7 > 0) {
      const dL = Math.ceil(gRemaining / aMast7);
      gDaysHtml = `<div style="margin-top:6px;font-size:0.85em;color:#667eea;font-weight:600">📆 ~${dL} jour${dL > 1 ? 's' : ''} restant${dL > 1 ? 's' : ''} <span style="font-weight:400;color:var(--text-secondary)">(moy ${Math.round(aMast7)} réussies/j)</span></div>`;
    } else {
      // Fallback: utiliser l'ancien compteur si pas de données mastered
      const mergedDH = _getDailyHistoryMerged();
      let t7 = 0;
      for (let i = 1; i <= 7; i++) {
        const d = new Date(_now);
        d.setDate(d.getDate() - i);
        const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        t7 += mergedDH[k] || 0;
      }
      const a7 = t7 / 7;
      if (a7 > 0) {
        const dL = Math.ceil(gRemaining / a7);
        gDaysHtml = `<div style="margin-top:6px;font-size:0.85em;color:#667eea;font-weight:600">📆 ~${dL} jour${dL > 1 ? 's' : ''} restant${dL > 1 ? 's' : ''} <span style="font-weight:400;color:var(--text-secondary)">(moy ${Math.round(a7)} rép./j — estimation provisoire)</span></div>`;
      }
    }
  }

  // Carte globale
  const gMaV = globalStats.marqueeVue || 0;
  const gImV = globalStats.importanteVue || 0;
  const gMaPerc = gMa ? (gMaV * 100 / gMa).toFixed(1) : '0.0';
  const gImPerc = gIm ? (gImV * 100 / gIm).toFixed(1) : '0.0';
  let html = `
    <div class="stats-global-card">
      <div class="stats-global-row">
        <span class="stats-global-title">GLOBAL</span>
        <span class="stats-global-perc" style="color:${percColor(gPerc)}">${gPerc}%</span>
      </div>
      <div class="progressbar" style="height:14px;margin:6px 0">
        <div class="progress" style="height:14px;width:${gPerc}%;background:${percColor(gPerc)}"></div>
      </div>
      <div class="stats-global-details">
        <span>${gTotal} questions</span>
        <span>✅ ${gRe}</span>
        <span>❌ ${gRa}</span>
        <span>👀 ${gNv}</span>
        <span>📌 ${gMa}</span>
        <span>⭐ ${gIm}</span>
      </div>
      <div style="margin-top:8px">
        <div style="display:flex;align-items:center;gap:6px;font-size:0.82em;margin-bottom:3px">
          <span>📌 Marquées</span>
          <div class="progressbar" style="flex:1;height:8px;margin:0"><div class="progress" style="height:8px;width:${gMaPerc}%;background:#667eea"></div></div>
          <span style="min-width:60px;text-align:right">${gMaV}/${gMa} (${gMaPerc}%)</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;font-size:0.82em">
          <span>⭐ Importantes</span>
          <div class="progressbar" style="flex:1;height:8px;margin:0"><div class="progress" style="height:8px;width:${gImPerc}%;background:#f59e0b"></div></div>
          <span style="min-width:60px;text-align:right">${gImV}/${gIm} (${gImPerc}%)</span>
        </div>
      </div>
      ${gDaysHtml}
    </div>
  `;

  // Compteur unique pour les IDs de graphiques
  let catChartIdx = 0;

  // Chaque groupe
  groupsData.forEach(group => {
    let grRe = 0, grRa = 0, grNv = 0, grMa = 0, grIm = 0, grMaV = 0, grImV = 0, grFl = 0, grFlV = 0;
    group.categories.forEach(c => {
      const s = c.globalContrib || c.stats;
      grRe += s.reussie;
      grRa += s.ratee;
      grNv += s.nonvue;
      grMa += s.marquee;
      grIm += s.importante || 0;
      grMaV += s.marqueeVue || 0;
      grImV += s.importanteVue || 0;
      grFl += s.flagged || 0;
      grFlV += s.flaggedVue || 0;
    });
    const grTotal = grRe + grRa + grNv;
    const grPerc = grTotal ? Math.round((grRe * 100) / grTotal) : 0;
    const grMaPerc = grMa ? (grMaV * 100 / grMa).toFixed(1) : '0.0';
    const grImPerc = grIm ? (grImV * 100 / grIm).toFixed(1) : '0.0';
    const grName = (group.name || '').replace(/'/g, "\\'");

    html += `<div class="stats-group">`;
    html += `<div class="stats-group-header">
      <span class="stats-group-name">${group.name}</span>
      <span class="stats-group-summary">${grRe}/${grTotal} · ${grPerc}%</span>
    </div>`;
    html += `<div class="progressbar" style="height:8px;margin:4px 0 8px">
      <div class="progress" style="height:8px;width:${grPerc}%;background:${percColor(grPerc)}"></div>
    </div>`;
    html += `<div style="display:flex;flex-wrap:wrap;gap:4px 12px;font-size:0.78em;margin-bottom:6px;align-items:center">
      <div style="display:flex;align-items:center;gap:4px;flex:1;min-width:180px">
        <span>📌 ${grMaV}/${grMa}</span>
        <div class="progressbar" style="flex:1;height:6px;margin:0"><div class="progress" style="height:6px;width:${grMaPerc}%;background:#667eea"></div></div>
        <span>${grMaPerc}%</span>
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex:1;min-width:180px">
        <span>⭐ ${grImV}/${grIm}</span>
        <div class="progressbar" style="flex:1;height:6px;margin:0"><div class="progress" style="height:6px;width:${grImPerc}%;background:#f59e0b"></div></div>
        <span>${grImPerc}%</span>
      </div>
      <button class="stats-cat-reset-btn" onclick="_resetGroupStats('${grName}')" title="Réinitialiser la progression ${group.name}" style="font-size:0.95em">🔄 Reset</button>
      <button class="stats-cat-reset-btn" onclick="_resetGroupFlaggedStats('${grName}')" title="Remettre à zéro uniquement les questions 📌⭐📝 déjà vues de ${group.name} (garde le marquage)" style="font-size:0.95em">🎯 Reset 📌⭐📝 (${grFlV}/${grFl} vues)</button>
    </div>`;

    // Lignes par catégorie
    group.categories.forEach(cat => {
      const s = cat.stats;
      const total = s.reussie + s.ratee + s.nonvue;
      const perc = total ? Math.round((s.reussie * 100) / total) : 0;
      const markers = [];
      if (s.marquee) markers.push(`📌${s.marquee}`);
      if (s.importante) markers.push(`⭐${s.importante}`);
      const markersStr = markers.length ? ` <span class="stats-cat-marks">${markers.join(' ')}</span>` : '';
      const chartId = 'catChart_' + catChartIdx;
      const catVal = (cat.value || '').replace(/'/g, "\\'");
      const catLabelEsc = (cat.label || '').replace(/'/g, "\\'");
      const menuId = 'catResetMenu_' + catChartIdx;
      catChartIdx++;

      html += `<div class="stats-cat-row" data-cat-value="${cat.value || ''}" data-chart-id="${chartId}" onclick="_toggleCatChart(this)" style="cursor:pointer;" title="Cliquer pour voir les sessions">
        <span class="stats-cat-name">${cat.label}</span>
        <span class="stats-cat-bar"><div class="progressbar-mini"><div class="progress-mini" style="width:${perc}%;background:${percColor(perc)}"></div></div></span>
        <span class="stats-cat-perc" style="color:${percColor(perc)}">${perc}%</span>
        <span class="stats-cat-nums">✅${s.reussie} ❌${s.ratee} 👀${s.nonvue}${markersStr}</span>
        <span class="stats-cat-reset-wrap">
          <button class="stats-cat-reset-btn" onclick="event.stopPropagation();_toggleCatResetMenu('${menuId}')" title="Réinitialiser ${cat.label}">🔄</button>
          <div class="stats-cat-reset-menu" id="${menuId}" style="display:none;" onclick="event.stopPropagation()">
            <button onclick="_resetCategoryStats('${catVal}','${catLabelEsc}')">👀 Vues</button>
            <button onclick="_resetCategoryField('${catVal}','${catLabelEsc}','reussie')">✅ Réussies</button>
            <button onclick="_resetCategoryField('${catVal}','${catLabelEsc}','ratee')">❌ Ratées</button>
            <button onclick="_resetCategoryField('${catVal}','${catLabelEsc}','marquee')">📌 Marquées</button>
            <button onclick="_resetCategoryField('${catVal}','${catLabelEsc}','importante')">⭐ Importantes</button>
            <button onclick="_resetCategoryFlaggedField('${catVal}','${catLabelEsc}')" title="Remet à zéro uniquement les 📌⭐📝 déjà vues (garde le marquage)">🎯 📌⭐📝 (${s.flaggedVue || 0}/${s.flagged || 0} vues)</button>
          </div>
        </span>
      </div>`;
      html += `<div class="stats-cat-chart-container" id="${chartId}" style="display:none;"></div>`;
    });

    html += `</div>`;
  });

  // ====================================================================
  // SECTION SYMBOLES — progression basée sur localStorage (symbolesResponses)
  // ====================================================================
  html += _buildSymbolesStatsHtml(catChartIdx);

  cont.innerHTML = html;

  // Rendre les graphiques des sessions symboles interactifs
  _attachSymbolesChartListeners();
}

/**
 * _toggleCatChart() – Toggle le graphique des sessions pour une catégorie
 */
function _toggleCatChart(rowEl) {
  const chartId = rowEl.getAttribute('data-chart-id');
  const catValue = rowEl.getAttribute('data-cat-value');
  const chartDiv = document.getElementById(chartId);
  if (!chartDiv) return;

  if (chartDiv.style.display !== 'none') {
    chartDiv.style.display = 'none';
    rowEl.classList.remove('stats-cat-row-expanded');
    return;
  }

  // Fermer les autres graphiques ouverts
  document.querySelectorAll('.stats-cat-chart-container').forEach(el => { el.style.display = 'none'; });
  document.querySelectorAll('.stats-cat-row-expanded').forEach(el => { el.classList.remove('stats-cat-row-expanded'); });

  rowEl.classList.add('stats-cat-row-expanded');
  chartDiv.style.display = 'block';
  _renderCatSessionChart(chartDiv, catValue);
}

/**
 * _renderCatSessionChart() – Affiche un mini graphique des sessions pour une catégorie
 */
function _renderCatSessionChart(container, catValue) {
  const allSessions = window._sessionHistoryCache || [];
  const sessions = allSessions.filter(s => s.category === catValue).slice(-60);

  if (!sessions.length) {
    container.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-secondary);font-size:0.85em;">Aucune session pour cette catégorie</div>';
    return;
  }

  const avgPct = Math.round(sessions.reduce((s, x) => s + Math.min(x.percent || 0, 100), 0) / sessions.length);
  const last5 = sessions.slice(-5);
  const avgLast5 = last5.length ? Math.round(last5.reduce((s, x) => s + Math.min(x.percent || 0, 100), 0) / last5.length) : 0;
  const maxBarH = 120;

  let html = `
    <div style="padding:6px 8px 2px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;font-size:0.78em;color:var(--text-secondary)">
      <span>${sessions.length} session${sessions.length > 1 ? 's' : ''}</span>
      <span>moy: <b>${avgPct}%</b> · 5 dern.: <b>${avgLast5}%</b></span>
    </div>
    <div class="daily-chart-scroll" style="margin:0 4px 6px">
      <div class="daily-chart" style="min-width:${Math.max(sessions.length * 14, 200)}px">
  `;

  sessions.forEach((s, idx) => {
    const pct = Math.min(s.percent || 0, 100);
    const h = Math.max(4, Math.round((pct / 100) * maxBarH));
    const color = pct >= 80 ? '#2ecc71' : pct >= 50 ? '#f39c12' : '#e74c3c';
    const d = new Date(s.date);
    const dayLabel = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
    const timeLabel = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const tooltip = `${dayLabel} ${timeLabel} - ${pct}% (${s.correct}/${s.total})`;

    html += `<div class="daily-bar-col" title="${tooltip}" style="cursor:default">
      <div class="daily-bar-count" style="font-size:0.65em">${pct}%</div>
      <div class="daily-bar" style="height:${h}px;background:${color}"></div>
      <div class="daily-bar-label" style="font-size:0.6em">${idx === sessions.length - 1 ? dayLabel : (idx % 5 === 0 ? dayLabel : '')}</div>
    </div>`;
  });

  html += `</div></div>`;
  container.innerHTML = html;
}

// ====================================================================
// SYMBOLES STATS — fonctions pour la section Symboles sur la page Stats
// ====================================================================

/**
 * Définition des groupes de symboles et du nombre total de symboles par groupe.
 * Doit rester synchronisé avec la base SYMBOLS de symboles.html.
 */
var _SYMBOLES_GROUPS = [
  { label: '🔤 Alphabet OTAN', total: 26 },
  { label: '🛫 Aérodrome', total: 49 },
  { label: '📡 Communication', total: 36 },
  { label: '🌦️ Météo', total: 172 },
  { label: '🧑‍✈️ Marshalling', total: 39 }
];
var _SYMBOLES_TOTAL = 322;

/**
 * Lit les réponses symboles depuis localStorage et calcule les stats par groupe.
 */
function _getSymbolesStats() {
  var responses = {};
  try { responses = JSON.parse(localStorage.getItem('symbolesResponses') || '{}'); } catch(e) {}

  var groupStats = {};
  _SYMBOLES_GROUPS.forEach(function(g) {
    groupStats[g.label] = { reussie: 0, ratee: 0, total: g.total, seen: new Set() };
  });

  for (var key in responses) {
    var r = responses[key];
    var grp = r.group;
    if (!groupStats[grp]) continue;
    groupStats[grp].seen.add(key);
    if (r.correct > 0 && r.correct > r.wrong) {
      groupStats[grp].reussie++;
    } else if (r.wrong > 0) {
      groupStats[grp].ratee++;
    }
  }

  // Convertir seen Set en nombre et calculer nonvue
  var result = {};
  for (var g in groupStats) {
    var gs = groupStats[g];
    var seenCount = gs.seen.size;
    result[g] = {
      reussie: gs.reussie,
      ratee: gs.ratee,
      nonvue: Math.max(0, gs.total - seenCount),
      total: gs.total
    };
  }
  return result;
}

/**
 * Construit le HTML de la section SYMBOLES pour afficherStats().
 */
function _buildSymbolesStatsHtml(catChartIdx) {
  var percColor = function(p) {
    if (p >= 80) return '#4caf50';
    if (p >= 50) return '#ff9800';
    return '#f44336';
  };

  var groupStats = _getSymbolesStats();

  // Totaux globaux symboles
  var sRe = 0, sRa = 0, sNv = 0;
  _SYMBOLES_GROUPS.forEach(function(g) {
    var s = groupStats[g.label] || { reussie: 0, ratee: 0, nonvue: g.total };
    sRe += s.reussie;
    sRa += s.ratee;
    sNv += s.nonvue;
  });
  var sTotal = sRe + sRa + sNv;
  var sPerc = sTotal ? Math.round((sRe * 100) / sTotal) : 0;

  var html = '';
  html += '<div class="stats-group">';
  html += '<div class="stats-group-header">';
  html += '  <span class="stats-group-name">🔣 SYMBOLES</span>';
  html += '  <span class="stats-group-summary">' + sRe + '/' + sTotal + ' · ' + sPerc + '%</span>';
  html += '</div>';
  html += '<div class="progressbar" style="height:8px;margin:4px 0 8px">';
  html += '  <div class="progress" style="height:8px;width:' + sPerc + '%;background:' + percColor(sPerc) + '"></div>';
  html += '</div>';

  // Historique global des sessions symboles (tableau de barres)
  html += '<div id="symbolesGlobalSessionChart" style="margin-bottom:12px;"></div>';

  // Barres par groupe
  _SYMBOLES_GROUPS.forEach(function(g) {
    var s = groupStats[g.label] || { reussie: 0, ratee: 0, nonvue: g.total, total: g.total };
    var total = s.reussie + s.ratee + s.nonvue;
    var perc = total ? Math.round((s.reussie * 100) / total) : 0;
    var chartId = 'symCatChart_' + catChartIdx;
    catChartIdx++;

    html += '<div class="stats-cat-row sym-stats-cat-row" data-sym-group="' + g.label + '" data-chart-id="' + chartId + '" style="cursor:pointer;" title="Cliquer pour voir les sessions">';
    html += '  <span class="stats-cat-name">' + g.label + '</span>';
    html += '  <span class="stats-cat-bar"><div class="progressbar-mini"><div class="progress-mini" style="width:' + perc + '%;background:' + percColor(perc) + '"></div></div></span>';
    html += '  <span class="stats-cat-perc" style="color:' + percColor(perc) + '">' + perc + '%</span>';
    html += '  <span class="stats-cat-nums">✅' + s.reussie + ' ❌' + s.ratee + ' 👀' + s.nonvue + '</span>';
    html += '</div>';
    html += '<div class="stats-cat-chart-container" id="' + chartId + '" style="display:none;"></div>';
  });

  html += '</div>';
  return html;
}

/**
 * Attache les écouteurs d'événements aux éléments de la section symboles
 * après que le HTML a été inséré dans le DOM.
 */
function _attachSymbolesChartListeners() {
  // Rendu du graphique global des sessions symboles
  var globalChart = document.getElementById('symbolesGlobalSessionChart');
  if (globalChart) {
    _renderSymbolesGlobalSessionChart(globalChart);
  }

  // Expandable per-group session charts
  document.querySelectorAll('.sym-stats-cat-row').forEach(function(row) {
    row.addEventListener('click', function() {
      var chartId = row.getAttribute('data-chart-id');
      var grpLabel = row.getAttribute('data-sym-group');
      var chartDiv = document.getElementById(chartId);
      if (!chartDiv) return;

      if (chartDiv.style.display !== 'none') {
        chartDiv.style.display = 'none';
        row.classList.remove('stats-cat-row-expanded');
        return;
      }

      // Fermer les autres graphiques symboles ouverts
      document.querySelectorAll('.sym-stats-cat-row').forEach(function(r) {
        var cid = r.getAttribute('data-chart-id');
        var cd = document.getElementById(cid);
        if (cd) cd.style.display = 'none';
        r.classList.remove('stats-cat-row-expanded');
      });

      row.classList.add('stats-cat-row-expanded');
      chartDiv.style.display = 'block';
      _renderSymbolesGroupSessionChart(chartDiv, grpLabel);
    });
  });
}

/**
 * Rendu du graphique global des sessions symboles (toutes catégories confondues).
 */
function _renderSymbolesGlobalSessionChart(container) {
  var sessions = [];
  try { sessions = JSON.parse(localStorage.getItem('symbolesSessionHistory') || '[]'); } catch(e) {}
  sessions = sessions.slice(-60);

  if (!sessions.length) {
    container.innerHTML = '<div style="padding:6px 8px;text-align:center;color:var(--text-secondary);font-size:0.82em;">Aucune session symboles enregistrée</div>';
    return;
  }

  var avgPct = Math.round(sessions.reduce(function(s, x) { return s + Math.min(x.percent || 0, 100); }, 0) / sessions.length);
  var last5 = sessions.slice(-5);
  var avgLast5 = last5.length ? Math.round(last5.reduce(function(s, x) { return s + Math.min(x.percent || 0, 100); }, 0) / last5.length) : 0;
  var maxBarH = 120;

  var html = '';
  html += '<div style="padding:6px 8px 2px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;font-size:0.78em;color:var(--text-secondary)">';
  html += '  <span><strong>Sessions symboles</strong> — ' + sessions.length + ' session' + (sessions.length > 1 ? 's' : '') + '</span>';
  html += '  <span>moy: <b>' + avgPct + '%</b> · 5 dern.: <b>' + avgLast5 + '%</b></span>';
  html += '</div>';
  html += '<div class="daily-chart-scroll" style="margin:0 4px 6px">';
  html += '  <div class="daily-chart" style="min-width:' + Math.max(sessions.length * 14, 200) + 'px">';

  sessions.forEach(function(s, idx) {
    var pct = Math.min(s.percent || 0, 100);
    var h = Math.max(4, Math.round((pct / 100) * maxBarH));
    var color = pct >= 80 ? '#2ecc71' : pct >= 50 ? '#f39c12' : '#e74c3c';
    var d = new Date(s.date);
    var dayLabel = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
    var timeLabel = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    var tooltip = dayLabel + ' ' + timeLabel + ' - ' + pct + '% (' + s.correct + '/' + s.total + ') ' + (s.category || '');

    html += '<div class="daily-bar-col" title="' + tooltip + '" style="cursor:default">';
    html += '  <div class="daily-bar-count" style="font-size:0.65em">' + pct + '%</div>';
    html += '  <div class="daily-bar" style="height:' + h + 'px;background:' + color + '"></div>';
    html += '  <div class="daily-bar-label" style="font-size:0.6em">' + (idx === sessions.length - 1 ? dayLabel : (idx % 5 === 0 ? dayLabel : '')) + '</div>';
    html += '</div>';
  });

  html += '</div></div>';
  container.innerHTML = html;
}

/**
 * Rendu du graphique des sessions pour un groupe symboles spécifique.
 */
function _renderSymbolesGroupSessionChart(container, grpLabel) {
  var key = 'symbolesSessions_' + grpLabel;
  var sessions = [];
  try { sessions = JSON.parse(localStorage.getItem(key) || '[]'); } catch(e) {}
  sessions = sessions.slice(-60);

  if (!sessions.length) {
    container.innerHTML = '<div style="padding:10px;text-align:center;color:var(--text-secondary);font-size:0.85em;">Aucune session pour ce groupe</div>';
    return;
  }

  var avgPct = Math.round(sessions.reduce(function(s, x) { return s + Math.min(x.percent || 0, 100); }, 0) / sessions.length);
  var last5 = sessions.slice(-5);
  var avgLast5 = last5.length ? Math.round(last5.reduce(function(s, x) { return s + Math.min(x.percent || 0, 100); }, 0) / last5.length) : 0;
  var maxBarH = 120;

  var html = '';
  html += '<div style="padding:6px 8px 2px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;font-size:0.78em;color:var(--text-secondary)">';
  html += '  <span>' + sessions.length + ' session' + (sessions.length > 1 ? 's' : '') + '</span>';
  html += '  <span>moy: <b>' + avgPct + '%</b> · 5 dern.: <b>' + avgLast5 + '%</b></span>';
  html += '</div>';
  html += '<div class="daily-chart-scroll" style="margin:0 4px 6px">';
  html += '  <div class="daily-chart" style="min-width:' + Math.max(sessions.length * 14, 200) + 'px">';

  sessions.forEach(function(s, idx) {
    var pct = Math.min(s.percent || 0, 100);
    var h = Math.max(4, Math.round((pct / 100) * maxBarH));
    var color = pct >= 80 ? '#2ecc71' : pct >= 50 ? '#f39c12' : '#e74c3c';
    var d = new Date(s.date);
    var dayLabel = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
    var timeLabel = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    var tooltip = dayLabel + ' ' + timeLabel + ' - ' + pct + '% (' + s.correct + '/' + s.total + ')';

    html += '<div class="daily-bar-col" title="' + tooltip + '" style="cursor:default">';
    html += '  <div class="daily-bar-count" style="font-size:0.65em">' + pct + '%</div>';
    html += '  <div class="daily-bar" style="height:' + h + 'px;background:' + color + '"></div>';
    html += '  <div class="daily-bar-label" style="font-size:0.6em">' + (idx === sessions.length - 1 ? dayLabel : (idx % 5 === 0 ? dayLabel : '')) + '</div>';
    html += '</div>';
  });

  html += '</div></div>';
  container.innerHTML = html;
}

/**
 * _fetchQuizProgressResponses() – Charge le champ `responses` de quizProgress/{uid} de façon fiable.
 * 1) Serveur (données les plus fraîches, cross-device) si en ligne, avec timeout généreux.
 * 2) Cache Firestore persistant local (fiable : déjà synchronisé lors d'une utilisation normale de l'app).
 * 3) En dernier recours seulement : `currentResponses` en mémoire (peut être incomplet/vide sur cette page).
 * Retourne null si aucune source n'a pu être lue, pour éviter un reset partiel silencieux sur des données vides.
 */
async function _fetchQuizProgressResponses(uid) {
  if (navigator.onLine) {
    try {
      const docSnap = await Promise.race([
        db.collection('quizProgress').doc(uid).get({ source: 'server' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))
      ]);
      return docSnap.exists ? (docSnap.data().responses || {}) : {};
    } catch (e) {
      console.warn('[resetHelpers] Lecture serveur échouée, fallback cache Firestore:', e.message);
    }
  }
  try {
    const docSnap = await db.collection('quizProgress').doc(uid).get({ source: 'cache' });
    return docSnap.exists ? (docSnap.data().responses || {}) : {};
  } catch (e) {
    console.warn('[resetHelpers] Lecture cache Firestore échouée:', e.message);
  }
  if (typeof currentResponses !== 'undefined' && currentResponses && Object.keys(currentResponses).length) {
    return currentResponses;
  }
  return null;
}

/**
 * _resetCategoryStats() – Réinitialise les statistiques d'une seule catégorie.
 * Remet les questions en "non vues" tout en conservant les marquages (📌/⭐) et l'historique détaillé.
 */
async function _resetCategoryStats(catValue, catLabel) {
  if (!confirm(
    `Réinitialiser les statistiques de « ${catLabel} » ?\n\n` +
    `• Les questions redeviendront "non vues" (réussies/ratées effacées)\n` +
    `• Les révisions espacées (date de prochaine révision) seront remises à zéro\n` +
    `• Les marquages 📌 et ⭐ seront conservés\n` +
    `• L'historique des réponses (statusLog) sera conservé\n` +
    `• Le compteur d'échecs (mémoire de difficulté) sera aussi conservé, pour que ces questions ` +
    `reviennent plus vite si elles étaient déjà difficiles pour vous`
  )) return;

  const uid = (auth.currentUser && auth.currentUser.uid) || localStorage.getItem('cachedUid');
  if (!uid) { alert('Vous devez être connecté.'); return; }

  try {
    // Charger les questions de cette catégorie pour obtenir leurs clés
    await chargerQuestions(catValue);
    const keys = questions.map(q => getKeyFor(q));

    if (!keys.length) { alert('Aucune question trouvée pour cette catégorie.'); return; }

    // Lire les réponses actuelles depuis Firestore (serveur, sinon cache local) pour savoir quelles clés toucher
    const existingResponses = await _fetchQuizProgressResponses(uid);
    if (existingResponses === null) {
      alert('Impossible de charger vos données (hors ligne et pas de cache local). Réessayez avec une meilleure connexion.');
      return;
    }

    // IMPORTANT : on utilise update() avec des chemins en notation pointée (ex: "responses.question_x.status")
    // pour supprimer PRÉCISÉMENT ces champs, sans toucher aux autres (marked/important/statusLog).
    // Un set(..., {merge:true}) avec un objet imbriqué ne supprime JAMAIS les champs absents de l'objet
    // fourni (il fusionne en profondeur) — c'est pour ça que status/failCount ne s'effaçaient jamais.
    //
    // failCount N'EST PAS effacé ici : c'est la mémoire de difficulté d'une question (voir le calcul
    // d'intervalle dans quiz.js, qui ralentit la croissance pour les questions historiquement ratées).
    // Un reset "remet les compteurs de planification à zéro" (status/srInterval/nextReview) mais ne doit
    // pas faire perdre le fait qu'une question vous a déjà donné du fil à retordre.
    const update = {};
    let changedCount = 0;
    keys.forEach(k => {
      const r = existingResponses[k];
      if (!r || r.status === undefined) return; // déjà "non vue", rien à faire
      update['responses.' + k + '.status'] = firebase.firestore.FieldValue.delete();
      update['responses.' + k + '.srInterval'] = firebase.firestore.FieldValue.delete();
      update['responses.' + k + '.nextReview'] = firebase.firestore.FieldValue.delete();
      changedCount++;
    });

    if (!changedCount) { alert(`Toutes les questions de « ${catLabel} » sont déjà "non vues".`); return; }

    await db.collection('quizProgress').doc(uid).update(update);

    // Mettre à jour currentResponses en mémoire si disponible (évite un reload complet optionnel)
    if (typeof currentResponses !== 'undefined' && currentResponses) {
      keys.forEach(k => {
        const r = currentResponses[k];
        if (!r) return;
        delete r.status;
        delete r.srInterval;
        delete r.nextReview;
      });
    }

    // Supprimer aussi du localStorage (les clés question_*)
    keys.forEach(k => { localStorage.removeItem(k); });

    alert(`Statistiques de « ${catLabel} » réinitialisées ! (${changedCount} question${changedCount > 1 ? 's' : ''}, marquages et difficulté conservés)`);
    window.location.reload();
  } catch (e) {
    console.error('[resetCategory] Erreur:', e);
    alert('Erreur lors de la réinitialisation : ' + e.message);
  }
}

/**
 * _toggleCatResetMenu() – Ouvre/ferme le menu de réinitialisation par caractéristique d'une catégorie.
 */
function _toggleCatResetMenu(menuId) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  document.querySelectorAll('.stats-cat-reset-menu').forEach(m => { m.style.display = 'none'; });
  if (!isOpen) menu.style.display = 'flex';
}
document.addEventListener('click', function() {
  document.querySelectorAll('.stats-cat-reset-menu').forEach(m => { m.style.display = 'none'; });
});

/**
 * _resetCategoryField() – Réinitialise UNE SEULE caractéristique (marquée / importante / réussie / ratée)
 * d'une catégorie, sans toucher aux autres. Contrairement à _resetCategoryStats(), qui remet
 * toute la progression "vue" à zéro, cette fonction ne touche que le champ demandé.
 */
async function _resetCategoryField(catValue, catLabel, field) {
  const cfg = {
    marquee:    { label: 'Marquées 📌',    msg: 'Le marquage 📌 sera retiré (le reste ne change pas).' },
    importante: { label: 'Importantes ⭐', msg: 'Le marquage ⭐ sera retiré (le reste ne change pas).' },
    reussie:    { label: 'Réussies ✅',    msg: 'Les questions réussies redeviendront "non vues" (les ratées, les marquages 📌⭐, l\'historique et la mémoire de difficulté sont conservés).' },
    ratee:      { label: 'Ratées ❌',      msg: 'Les questions ratées redeviendront "non vues" (les réussies, les marquages 📌⭐, l\'historique et la mémoire de difficulté sont conservés).' }
  }[field];
  if (!cfg) return;

  if (!confirm(`Réinitialiser « ${cfg.label} » pour « ${catLabel} » ?\n\n${cfg.msg}`)) return;

  const uid = (auth.currentUser && auth.currentUser.uid) || localStorage.getItem('cachedUid');
  if (!uid) { alert('Vous devez être connecté.'); return; }

  try {
    await chargerQuestions(catValue);
    const keys = questions.map(q => getKeyFor(q));
    if (!keys.length) { alert('Aucune question trouvée pour cette catégorie.'); return; }

    const existingResponses = await _fetchQuizProgressResponses(uid);
    if (existingResponses === null) {
      alert('Impossible de charger vos données (hors ligne et pas de cache local). Réessayez avec une meilleure connexion.');
      return;
    }

    // update['responses.<key>.<champ>'] = FieldValue.delete() : supprime PRÉCISÉMENT ce champ
    // via update() (notation pointée), sans toucher aux autres champs de l'entrée (contrairement
    // à un set(..., {merge:true}) avec un objet imbriqué, qui ne supprime jamais les champs absents).
    const update = {};
    const changedKeys = [];
    keys.forEach(k => {
      const r = existingResponses[k];
      if (!r) return;
      let touched = false;

      if (field === 'marquee' && r.marked) {
        update['responses.' + k + '.marked'] = firebase.firestore.FieldValue.delete();
        touched = true;
      } else if (field === 'importante' && r.important) {
        update['responses.' + k + '.important'] = firebase.firestore.FieldValue.delete();
        touched = true;
      } else if (field === 'reussie' && r.status === 'réussie') {
        // failCount (mémoire de difficulté) volontairement conservé, voir _resetCategoryStats()
        update['responses.' + k + '.status'] = firebase.firestore.FieldValue.delete();
        update['responses.' + k + '.srInterval'] = firebase.firestore.FieldValue.delete();
        update['responses.' + k + '.nextReview'] = firebase.firestore.FieldValue.delete();
        touched = true;
      } else if (field === 'ratee' && r.status === 'ratée') {
        update['responses.' + k + '.status'] = firebase.firestore.FieldValue.delete();
        update['responses.' + k + '.srInterval'] = firebase.firestore.FieldValue.delete();
        update['responses.' + k + '.nextReview'] = firebase.firestore.FieldValue.delete();
        touched = true;
      }

      if (touched) changedKeys.push(k);
    });

    if (!changedKeys.length) { alert(`Aucune question « ${cfg.label} » trouvée dans cette catégorie.`); return; }

    await db.collection('quizProgress').doc(uid).update(update);

    if (typeof currentResponses !== 'undefined' && currentResponses) {
      changedKeys.forEach(k => {
        const r = currentResponses[k];
        if (!r) return;
        if (field === 'marquee') delete r.marked;
        else if (field === 'importante') delete r.important;
        else { delete r.status; delete r.srInterval; delete r.nextReview; }
      });
    }

    keys.forEach(k => { localStorage.removeItem(k); });

    alert(`« ${cfg.label} » réinitialisé pour « ${catLabel} » ! (${changedKeys.length} question${changedKeys.length > 1 ? 's' : ''})`);
    window.location.reload();
  } catch (e) {
    console.error('[resetCategoryField] Erreur:', e);
    alert('Erreur lors de la réinitialisation : ' + e.message);
  }
}

/**
 * _resetCategoryFlaggedField() – Remet à "non vue" (réussie ET ratée effacées) UNIQUEMENT les
 * questions marquées 📌, importantes ⭐ ou notées 📝 d'une catégorie — "remettre ses cartes à
 * zéro" pour recommencer une progression sur ce sous-ensemble sans perdre le marquage/la note
 * ni la mémoire de difficulté (failCount/successCount/statusLog conservés).
 */
async function _resetCategoryFlaggedField(catValue, catLabel) {
  if (!confirm(
    `Réinitialiser « ${catLabel} » — questions 📌 marquées, ⭐ importantes ou 📝 notées uniquement ?\n\n` +
    `• Ces questions redeviendront "non vues" (réussies/ratées effacées)\n` +
    `• Le marquage 📌⭐ et vos notes 📝 sont conservés\n` +
    `• La mémoire de difficulté (nb d'échecs) est conservée\n` +
    `• Les autres questions (ni marquées, ni importantes, ni notées) ne sont pas touchées`
  )) return;

  const uid = (auth.currentUser && auth.currentUser.uid) || localStorage.getItem('cachedUid');
  if (!uid) { alert('Vous devez être connecté.'); return; }

  try {
    await chargerQuestions(catValue);
    const keys = questions.map(q => getKeyFor(q));
    if (!keys.length) { alert('Aucune question trouvée pour cette catégorie.'); return; }

    const existingResponses = await _fetchQuizProgressResponses(uid);
    if (existingResponses === null) {
      alert('Impossible de charger vos données (hors ligne et pas de cache local). Réessayez avec une meilleure connexion.');
      return;
    }
    const notes = (typeof _notesCache === 'object' && _notesCache) ? _notesCache : {};

    const update = {};
    const changedKeys = [];
    keys.forEach(k => {
      const r = existingResponses[k];
      if (!r || r.status === undefined) return; // déjà "non vue"
      const flagged = !!r.marked || !!r.important || !!notes[k];
      if (!flagged) return;
      update['responses.' + k + '.status'] = firebase.firestore.FieldValue.delete();
      update['responses.' + k + '.srInterval'] = firebase.firestore.FieldValue.delete();
      update['responses.' + k + '.nextReview'] = firebase.firestore.FieldValue.delete();
      changedKeys.push(k);
    });

    if (!changedKeys.length) { alert(`Aucune question 📌⭐📝 déjà vue trouvée dans « ${catLabel} ».`); return; }

    await db.collection('quizProgress').doc(uid).update(update);

    if (typeof currentResponses !== 'undefined' && currentResponses) {
      changedKeys.forEach(k => {
        const r = currentResponses[k];
        if (!r) return;
        delete r.status; delete r.srInterval; delete r.nextReview;
      });
    }
    keys.forEach(k => { localStorage.removeItem(k); });

    alert(`« ${catLabel} » — 📌⭐📝 réinitialisées ! (${changedKeys.length} question${changedKeys.length > 1 ? 's' : ''}, marquages et notes conservés)`);
    window.location.reload();
  } catch (e) {
    console.error('[resetCategoryFlaggedField] Erreur:', e);
    alert('Erreur lors de la réinitialisation : ' + e.message);
  }
}

/**
 * afficherDailyChart() – Affiche un graphique en barres de l'activité quotidienne (60 derniers jours)
 */
function afficherDailyChart(dailyHistory) {
  // Trouver ou créer le conteneur du graphique
  let chartCont = document.getElementById('dailyChartContainer');
  if (!chartCont) {
    // Insérer avant le statsContainer (tout en haut)
    const statsCont = document.getElementById('statsContainer');
    if (!statsCont) return;
    chartCont = document.createElement('div');
    chartCont.id = 'dailyChartContainer';
    chartCont.className = 'home-card';
    statsCont.parentNode.insertBefore(chartCont, statsCont);
  }

  // Générer les 60 derniers jours
  const days = [];
  const today = new Date();
  for (let i = 59; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    days.push({ key, date: d, count: dailyHistory[key] || 0 });
  }

  const maxCount = Math.max(...days.map(d => d.count), 1);
  const maxBarH = 120; // pixels max height

  // Totaux
  const total60 = days.reduce((s, d) => s + d.count, 0);
  // 7 derniers jours COMPLETS (hors aujourd'hui) — même fenêtre que l'objectif journalier
  const last7Complete = days.slice(-8, -1).reduce((s, d) => s + d.count, 0);
  const avg7 = last7Complete ? Math.round(last7Complete / 7) : 0;
  const todayCount = days[days.length - 1].count;

  let html = `
    <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap">
      <strong>Activité quotidienne</strong>
      <div style="font-size:0.8em;color:var(--text-secondary)">
        auj: <b>${todayCount}</b> · 60j: <b>${total60}</b> · moy/7j: <b>${avg7}/j</b>
      </div>
    </div>
    <div class="daily-chart-scroll">
      <div class="daily-chart">
  `;

  days.forEach((day, idx) => {
    const h = day.count ? Math.max(Math.round((day.count / maxCount) * maxBarH), 6) : 0;
    const isToday = idx === days.length - 1;
    const dd = day.date.getDate();
    const isFirstOfMonth = dd === 1;
    const monthNames = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
    
    // Tooltip label
    const dayLabel = String(day.date.getDate()).padStart(2, '0') + '/' +
      String(day.date.getMonth() + 1).padStart(2, '0');
    
    let bottomLabel = '';
    if (isToday) {
      bottomLabel = "Auj.";
    } else if (isFirstOfMonth) {
      bottomLabel = monthNames[day.date.getMonth()];
    } else if (idx % 7 === 0) {
      bottomLabel = dayLabel;
    }

    const barColor = isToday ? '#667eea' : (day.count > 0 ? '#4caf50' : '#e0e0e0');
    
    html += `<div class="daily-bar-col" title="${dayLabel}: ${day.count} questions">
      <div class="daily-bar-count">${day.count || ''}</div>
      <div class="daily-bar" style="height:${h}px;background:${barColor}"></div>
      <div class="daily-bar-label">${bottomLabel}</div>
    </div>`;
  });

  html += `</div></div>`;
  chartCont.innerHTML = html;
}

/**
 * afficherSessionChart() – Affiche un graphique en barres des 60 dernières sessions (% réussite)
 */
function afficherSessionChart(sessionHistory) {
  // Trouver ou créer le conteneur
  let chartCont = document.getElementById('sessionChartContainer');
  if (!chartCont) {
    const dailyCont = document.getElementById('dailyChartContainer');
    const statsCont = document.getElementById('statsContainer');
    const ref = dailyCont || statsCont;
    if (!ref) return;
    chartCont = document.createElement('div');
    chartCont.id = 'sessionChartContainer';
    chartCont.className = 'home-card';
    // Insérer après le dailyChart (ou avant statsContainer)
    if (dailyCont && dailyCont.nextSibling) {
      dailyCont.parentNode.insertBefore(chartCont, dailyCont.nextSibling);
    } else if (statsCont) {
      statsCont.parentNode.insertBefore(chartCont, statsCont);
    }
  }

  const sessions = (sessionHistory || []).slice(-60);
  if (!sessions.length) {
    chartCont.innerHTML = `
      <div style="margin-bottom:10px"><strong>Historique des sessions</strong></div>
      <p style="color:var(--text-secondary);text-align:center;">Aucune session enregistrée</p>`;
    return;
  }

  // Calculs globaux
  const totalSessions = sessions.length;
  const avgPct = Math.round(sessions.reduce((s, x) => s + Math.min(x.percent || 0, 100), 0) / totalSessions);
  const last5 = sessions.slice(-5);
  const avgLast5 = last5.length ? Math.round(last5.reduce((s, x) => s + Math.min(x.percent || 0, 100), 0) / last5.length) : 0;

  const maxBarH = 100; // pixels max height

  let html = `
    <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap">
      <strong>Historique des sessions</strong>
      <div style="font-size:0.8em;color:var(--text-secondary)">
        ${totalSessions} session${totalSessions > 1 ? 's' : ''} · moy: <b>${avgPct}%</b> · 5 dern.: <b>${avgLast5}%</b>
      </div>
    </div>
    <div class="daily-chart-scroll">
      <div class="daily-chart">
  `;

  sessions.forEach((s, idx) => {
    const pct = Math.min(s.percent || 0, 100);
    const h = Math.max(6, Math.round((pct / 100) * maxBarH));
    const color = pct >= 80 ? '#2ecc71' : pct >= 50 ? '#f39c12' : '#e74c3c';
    const isLast = idx === sessions.length - 1;
    const d = new Date(s.date);
    const dayLabel = String(d.getDate()).padStart(2, '0') + '/' +
      String(d.getMonth() + 1).padStart(2, '0');
    const timeLabel = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const tooltip = `${dayLabel} ${timeLabel} - ${pct}% (${s.correct}/${s.total}) ${s.category || ''}`;
    const clickInfo = `${dayLabel} à ${timeLabel}\\n${pct}% (${s.correct}/${s.total})\\n${s.category || 'Toutes catégories'}`;

    let bottomLabel = '';
    if (isLast) {
      bottomLabel = 'Dern.';
    } else if (idx % 10 === 0) {
      bottomLabel = dayLabel;
    }

    html += `<div class="daily-bar-col" title="${tooltip}" onclick="alert('${clickInfo}')" style="cursor:pointer">
      <div class="daily-bar-count">${pct}%</div>
      <div class="daily-bar" style="height:${h}px;background:${color}"></div>
      <div class="daily-bar-label">${bottomLabel}</div>
    </div>`;
  });

  html += `</div></div>`;
  chartCont.innerHTML = html;
}

/**
 * _renderSessionCategoryDiagnostic() – Panneau de diagnostic en lecture seule : liste,
 * pour chaque valeur de "category" réellement enregistrée dans sessionHistory, combien de
 * sessions y sont rattachées. Sert à répondre à une question récurrente : "j'ai fait des
 * sessions sur telle sous-catégorie, pourquoi son petit graphique dit 'Aucune session' ?" —
 * chaque session est enregistrée sous le nom EXACT de la catégorie sélectionnée au moment où
 * elle a été lancée (voir demarrerQuiz()/`selectedCategory`) ; si l'utilisateur lance surtout
 * via "TOUTES"/"Mixte"/un groupe agrégé, ses sessions s'accumulent sous CETTE étiquette, pas
 * sous chaque sous-catégorie individuellement — ce panneau rend ça visible sans DevTools.
 */
function _renderSessionCategoryDiagnostic(sessionHistory) {
  let cont = document.getElementById('sessionCategoryDiagnosticContainer');
  if (!cont) {
    const sessionChartCont = document.getElementById('sessionChartContainer');
    const dailyCont = document.getElementById('dailyChartContainer');
    const statsCont = document.getElementById('statsContainer');
    const ref = sessionChartCont || dailyCont || statsCont;
    if (!ref) return;
    cont = document.createElement('div');
    cont.id = 'sessionCategoryDiagnosticContainer';
    cont.className = 'home-card';
    if (ref.nextSibling) ref.parentNode.insertBefore(cont, ref.nextSibling);
    else ref.parentNode.appendChild(cont);
  }

  const sessions = sessionHistory || [];
  if (!sessions.length) {
    cont.innerHTML = `<div style="margin-bottom:6px"><strong>🔍 Sessions par catégorie (diagnostic)</strong></div>
      <p style="color:var(--text-secondary);text-align:center;font-size:.85em">Aucune session enregistrée.</p>`;
    return;
  }

  const byCat = {};
  sessions.forEach(s => {
    const cat = s.category || '(sans catégorie)';
    if (!byCat[cat]) byCat[cat] = { count: 0, lastDate: null };
    byCat[cat].count++;
    const d = new Date(s.date);
    if (!byCat[cat].lastDate || d > byCat[cat].lastDate) byCat[cat].lastDate = d;
  });
  const rows = Object.entries(byCat).sort((a, b) => b[1].count - a[1].count);

  let html = `
    <div style="margin-bottom:6px"><strong>🔍 Sessions par catégorie (diagnostic)</strong></div>
    <p style="font-size:.78em;color:var(--text-secondary);margin:0 0 8px">
      Chaque session est enregistrée sous le nom de la catégorie sélectionnée au moment où tu l'as
      lancée. Si tu lances surtout via "TOUTES"/"Mixte"/un groupe entier, tes sessions s'accumulent
      sous cette étiquette-là — pas sous chaque sous-catégorie séparément, même si tu as bien
      répondu à des questions de cette sous-catégorie dans la session.
    </p>
    <div style="max-height:260px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:.82em">
        <thead>
          <tr style="border-bottom:1px solid rgba(255,255,255,.12);text-align:left">
            <th style="padding:4px 6px">Catégorie enregistrée</th>
            <th style="padding:4px 6px;text-align:right">Sessions</th>
            <th style="padding:4px 6px;text-align:right">Dernière</th>
          </tr>
        </thead>
        <tbody>
  `;
  rows.forEach(([cat, info]) => {
    const dl = info.lastDate;
    const dateLabel = dl ? (String(dl.getDate()).padStart(2, '0') + '/' + String(dl.getMonth() + 1).padStart(2, '0') + '/' + dl.getFullYear()) : '—';
    html += `<tr style="border-bottom:1px solid rgba(255,255,255,.05)">
      <td style="padding:4px 6px">${_escapeHtmlStats(cat)}</td>
      <td style="padding:4px 6px;text-align:right;font-weight:700">${info.count}</td>
      <td style="padding:4px 6px;text-align:right;color:var(--text-secondary)">${dateLabel}</td>
    </tr>`;
  });
  html += `</tbody></table></div>
    <p style="font-size:.78em;color:var(--text-secondary);margin:8px 0 0">${sessions.length} session(s) au total.</p>`;
  cont.innerHTML = html;
}

function _escapeHtmlStats(str) {
  if (!str) return '';
  return str.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** synchroniserStatistiques — Synchronise les stats avec Firestore */
async function synchroniserStatistiques() {

  if (typeof auth === 'undefined' || !auth) {
    console.error("Firebase Auth n'est pas initialisé. Vérifiez la configuration Firebase.");
    alert("Erreur : Firebase Auth n'est pas initialisé.");
    return;
  }

  if (!auth.currentUser && !localStorage.getItem('cachedUid')) {
    console.error("Utilisateur non authentifié, impossible de synchroniser les statistiques");
    alert("Vous devez être connecté pour synchroniser vos statistiques.");
    return;
  }

  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');

  try {
    const doc = await getDocWithTimeout(db.collection('quizProgress').doc(uid));
    if (doc.exists) {
      const data = doc.data();
      // Synchroniser les réponses dans localStorage
      if (data.responses) {
        Object.keys(data.responses).forEach(key => {
          localStorage.setItem(key, JSON.stringify(data.responses[key]));
        });
      }
    }
  } catch (error) {
    console.error("Erreur lors de la synchronisation des statistiques :", error);
    alert("Erreur lors de la synchronisation des statistiques : " + error.message);
  }
}

/**
 * resetStats() – Réinitialise les statistiques stockées dans le localStorage et Firestore
 */
async function resetStats() {
  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
  if (!uid) return;

  // Supprimer les données locales
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("question_")) toRemove.push(k);
  }
  toRemove.forEach(k => localStorage.removeItem(k));

  // Supprimer aussi les stats Symboles
  localStorage.removeItem('symbolesSessionHistory');
  localStorage.removeItem('symbolesResponses');
  _SYMBOLES_GROUPS.forEach(function(g) {
    localStorage.removeItem('symbolesSessions_' + g.label);
  });

  try {
    // update() + FieldValue.delete() supprime réellement le champ "responses" en entier.
    // ATTENTION : set({responses: {}}, {merge:true}) ne fonctionne PAS pour ça — merge:true fusionne
    // en profondeur, donc fournir un objet vide ne supprime aucune des clés déjà présentes côté serveur.
    try {
      await db.collection('quizProgress').doc(uid)
        .update({ responses: firebase.firestore.FieldValue.delete(), lastUpdated: firebase.firestore.Timestamp.now() });
    } catch (e) {
      if (e.code === 'not-found') {
        // Pas encore de document (nouvel utilisateur) : rien à effacer côté serveur
      } else {
        throw e;
      }
    }
    // L'historique des réponses (statusLog) vit désormais dans la sous-collection
    // quizProgress/{uid}/history, PAS dans le champ "responses" ci-dessus : la supprimer
    // séparément est nécessaire, sinon "Réinitialiser les statistiques" laisserait
    // l'historique complet des anciennes réponses derrière lui.
    if (typeof _deleteHistorySubcollection === 'function') {
      try { await _deleteHistorySubcollection(uid); } catch (e) { console.warn('[resetStats] suppression historique:', e); }
    }
    alert("Les statistiques ont été réinitialisées !");
    window.location.reload();
  } catch (error) {
    console.error("Erreur lors de la réinitialisation des statistiques :", error);
    alert("Erreur lors de la réinitialisation des statistiques : " + error.message);
  }
}

/** _getGroupCategories() – Retourne les catégories d'un groupe par nom */
function _getGroupCategories(groupName) {
  const map = {
    'CLASSIQUES': [
      'PROCÉDURE RADIO','PROCÉDURES OPÉRATIONNELLES','RÉGLEMENTATION',
      "CONNAISSANCE DE L'AVION",'INSTRUMENTATION','MASSE ET CENTRAGE',
      'MOTORISATION','AERODYNAMIQUE PRINCIPES DU VOL'
    ],
    'EASA': [
      'EASA PROCEDURES','EASA AERODYNAMIQUE','EASA NAVIGATION',
      "EASA CONNAISSANCE DE L'AVION",'EASA METEOROLOGIE',
      'EASA PERFORMANCE ET PLANIFICATION','EASA REGLEMENTATION',
      'EASA PERFORMANCES HUMAINES'
    ],
    'GLIGLI HARD': [
      'GLIGLI COMMUNICATIONS HARD','GLIGLI CONNAISSANCES GENERALES AERONEF HARD',
      'GLIGLI EPREUVE COMMUNE HARD','GLIGLI EPREUVE SPECIFIQUE HARD',
      'GLIGLI METEOROLOGIE HARD','GLIGLI NAVIGATION HARD',
      'GLIGLI PERFORMANCE HUMAINE HARD','GLIGLI PERFORMANCES PREPARATION VOL HARD',
      'GLIGLI PRINCIPES DU VOL HARD','GLIGLI PROCEDURES OPERATIONNELLES HARD',
      'GLIGLI REGLEMENTATION HARD'
    ],
    'GLIGLI EASY': [
      'GLIGLI COMMUNICATIONS EASY','GLIGLI CONNAISSANCES GENERALES AERONEF EASY',
      'GLIGLI EPREUVE COMMUNE EASY','GLIGLI EPREUVE SPECIFIQUE EASY',
      'GLIGLI METEOROLOGIE EASY','GLIGLI NAVIGATION EASY',
      'GLIGLI PERFORMANCE HUMAINE EASY','GLIGLI PERFORMANCES PREPARATION VOL EASY',
      'GLIGLI PRINCIPES DU VOL EASY','GLIGLI PROCEDURES OPERATIONNELLES EASY',
      'GLIGLI REGLEMENTATION EASY'
    ]
  };
  return map[groupName] || [];
}

/**
 * _resetGroupStats() – Réinitialise la progression d'un groupe entier.
 * Conserve les marquages 📌 et ⭐, efface le statut vu/réussi/raté.
 */
async function _resetGroupStats(groupName) {
  if (!confirm(
    `Réinitialiser la progression de « ${groupName} » ?\n\n` +
    `• Toutes les questions redeviendront "non vues"\n` +
    `• Les marquages 📌 et ⭐ ainsi que la mémoire de difficulté seront conservés`
  )) return;

  const uid = (auth.currentUser && auth.currentUser.uid) || localStorage.getItem('cachedUid');
  if (!uid) { alert('Vous devez être connecté.'); return; }

  const catValues = _getGroupCategories(groupName);
  if (!catValues.length) { alert('Groupe introuvable.'); return; }

  try {
    // Collecter toutes les clés de questions pour ce groupe
    let allKeys = [];
    for (const catVal of catValues) {
      await chargerQuestions(catVal);
      allKeys = allKeys.concat(questions.map(q => getKeyFor(q)));
    }
    if (!allKeys.length) { alert('Aucune question trouvée.'); return; }

    const existingResponses = await _fetchQuizProgressResponses(uid);
    if (existingResponses === null) {
      alert('Impossible de charger vos données (hors ligne et pas de cache local). Réessayez avec une meilleure connexion.');
      return;
    }

    const update = {};
    let changedCount = 0;
    allKeys.forEach(k => {
      const r = existingResponses[k];
      if (!r || r.status === undefined) return; // déjà "non vue"
      // failCount (mémoire de difficulté) volontairement conservé, voir _resetCategoryStats()
      update['responses.' + k + '.status'] = firebase.firestore.FieldValue.delete();
      update['responses.' + k + '.srInterval'] = firebase.firestore.FieldValue.delete();
      update['responses.' + k + '.nextReview'] = firebase.firestore.FieldValue.delete();
      changedCount++;
    });

    if (!changedCount) { alert(`Toutes les questions de « ${groupName} » sont déjà "non vues".`); return; }

    await db.collection('quizProgress').doc(uid).update(update);
    allKeys.forEach(k => localStorage.removeItem(k));
    alert(`Progression de « ${groupName} » réinitialisée ! (${changedCount} questions, marquages conservés)`);
    window.location.reload();
  } catch (e) {
    console.error('[resetGroup] Erreur:', e);
    alert('Erreur : ' + e.message);
  }
}

/**
 * _resetGroupFlaggedStats() – Comme _resetGroupStats(), mais restreint aux questions marquées
 * 📌, importantes ⭐ ou notées 📝 de TOUTES les sous-catégories du groupe (grande catégorie) —
 * "remettre ses cartes à zéro" sur tout un groupe (ex. GLIGLI HARD) sans perdre le marquage/note.
 */
async function _resetGroupFlaggedStats(groupName) {
  if (!confirm(
    `Réinitialiser « ${groupName} » — questions 📌 marquées, ⭐ importantes ou 📝 notées uniquement, dans TOUTES ses sous-catégories ?\n\n` +
    `• Ces questions redeviendront "non vues" (réussies/ratées effacées)\n` +
    `• Le marquage 📌⭐ et vos notes 📝 sont conservés\n` +
    `• La mémoire de difficulté (nb d'échecs) est conservée\n` +
    `• Les autres questions (ni marquées, ni importantes, ni notées) ne sont pas touchées`
  )) return;

  const uid = (auth.currentUser && auth.currentUser.uid) || localStorage.getItem('cachedUid');
  if (!uid) { alert('Vous devez être connecté.'); return; }

  const catValues = _getGroupCategories(groupName);
  if (!catValues.length) { alert('Groupe introuvable.'); return; }

  try {
    let allKeys = [];
    for (const catVal of catValues) {
      await chargerQuestions(catVal);
      allKeys = allKeys.concat(questions.map(q => getKeyFor(q)));
    }
    if (!allKeys.length) { alert('Aucune question trouvée.'); return; }

    const existingResponses = await _fetchQuizProgressResponses(uid);
    if (existingResponses === null) {
      alert('Impossible de charger vos données (hors ligne et pas de cache local). Réessayez avec une meilleure connexion.');
      return;
    }
    const notes = (typeof _notesCache === 'object' && _notesCache) ? _notesCache : {};

    const update = {};
    const changedKeys = [];
    allKeys.forEach(k => {
      const r = existingResponses[k];
      if (!r || r.status === undefined) return; // déjà "non vue"
      const flagged = !!r.marked || !!r.important || !!notes[k];
      if (!flagged) return;
      update['responses.' + k + '.status'] = firebase.firestore.FieldValue.delete();
      update['responses.' + k + '.srInterval'] = firebase.firestore.FieldValue.delete();
      update['responses.' + k + '.nextReview'] = firebase.firestore.FieldValue.delete();
      changedKeys.push(k);
    });

    if (!changedKeys.length) { alert(`Aucune question 📌⭐📝 déjà vue trouvée dans « ${groupName} ».`); return; }

    await db.collection('quizProgress').doc(uid).update(update);
    // Dédupliquer avant de purger le localStorage (une clé peut apparaître dans plusieurs sous-catégories/épreuves)
    [...new Set(changedKeys)].forEach(k => localStorage.removeItem(k));
    alert(`« ${groupName} » — 📌⭐📝 réinitialisées ! (${changedKeys.length} question${changedKeys.length > 1 ? 's' : ''}, marquages et notes conservés)`);
    window.location.reload();
  } catch (e) {
    console.error('[resetGroupFlagged] Erreur:', e);
    alert('Erreur : ' + e.message);
  }
}

/**
 * _readinessCategoryPool(catVal) – Classe une valeur de catégorie (telle qu'utilisée dans
 * EASA_SUBJECTS/categories.js) dans l'un des 4 "pools" de banque de questions : EASA, GLIGLI
 * (Hard), GLIGLI (Easy), ou AUTRES (catégories historiques/legacy, ni EASA ni GLIGLI — ex.
 * "RÉGLEMENTATION", "INSTRUMENTATION"). Utilisé par le filtre de banque du tableau de bord
 * "Suis-je prêt ?".
 */
function _readinessCategoryPool(catVal) {
  if (catVal.indexOf('EASA') === 0) return 'EASA';
  if (catVal.indexOf('GLIGLI') === 0 && /HARD$/.test(catVal)) return 'GLIGLI_HARD';
  if (catVal.indexOf('GLIGLI') === 0 && /EASY$/.test(catVal)) return 'GLIGLI_EASY';
  return 'AUTRES';
}

const READINESS_POOL_LABELS = {
  TOUTES: 'Toutes les questions',
  GLIGLI_HARD: 'GLIGLI Hard uniquement',
  GLIGLI_EASY: 'GLIGLI Easy uniquement',
  GLIGLI_BOTH: 'GLIGLI Hard + Easy',
  EASA: 'EASA uniquement'
};

/**
 * setReadinessPoolFilter(mode) – Change le pool de banque de questions utilisé par le tableau
 * de bord "Suis-je prêt ?" (bouton/select dans la carte), persisté pour la prochaine visite.
 */
function setReadinessPoolFilter(mode) {
  if (!READINESS_POOL_LABELS[mode]) return;
  localStorage.setItem('readinessPoolFilter', mode);
  if (window._readinessGroupsData) _renderReadinessDashboard(window._readinessGroupsData);
}
window.setReadinessPoolFilter = setReadinessPoolFilter;

/**
 * _renderReadinessDashboard(groupsData) – Carte "Suis-je prêt ?" : regroupe les stats déjà
 * calculées par catégorie (groupsData, voir initStats()) selon les 9 matières officielles de
 * l'examen théorique PPL(A) (EASA_SUBJECTS, définies une seule fois dans helpers.js). Utile
 * car à l'examen réel, CHAQUE matière doit individuellement atteindre le seuil de réussite —
 * une moyenne globale flatteuse peut cacher une matière précise en dessous du seuil.
 *
 * Un sélecteur permet de restreindre le calcul à un pool de banque de questions précis
 * (toutes / GLIGLI Hard / GLIGLI Easy / GLIGLI Hard+Easy / EASA uniquement) — utile car les
 * 3 banques (legacy, GLIGLI, EASA) n'ont pas le même niveau de difficulté ni la même
 * couverture du syllabus, et un pourcentage "toutes confondues" peut masquer une faiblesse
 * spécifique à la banque EASA (la plus proche de l'examen réel).
 */
function _renderReadinessDashboard(groupsData) {
  const cont = document.getElementById('readinessDashboardContainer');
  if (!cont || typeof EASA_SUBJECTS === 'undefined') return;
  window._readinessGroupsData = groupsData;

  const poolMode = localStorage.getItem('readinessPoolFilter') || 'TOUTES';

  const catByValue = {};
  (groupsData || []).forEach(g => g.categories.forEach(c => { catByValue[c.value] = c; }));

  const PASS_THRESHOLD = 75; // seuil indicatif (généralement admis pour l'examen PPL EASA)
  const rows = EASA_SUBJECTS.map(subj => {
    const filteredCats = poolMode === 'TOUTES'
      ? subj.categories
      : subj.categories.filter(catVal => {
          const pool = _readinessCategoryPool(catVal);
          if (poolMode === 'GLIGLI_BOTH') return pool === 'GLIGLI_HARD' || pool === 'GLIGLI_EASY';
          return pool === poolMode;
        });

    if (!filteredCats.length) return { name: subj.name, na: true };

    let reussie = 0, ratee = 0, nonvue = 0, found = 0;
    filteredCats.forEach(catVal => {
      const c = catByValue[catVal];
      if (!c) return;
      found++;
      const s = c.globalContrib || c.stats;
      reussie += s.reussie; ratee += s.ratee; nonvue += s.nonvue;
    });
    const total = reussie + ratee + nonvue;
    const pct = total ? Math.round((reussie * 100) / total) : 0;
    return { name: subj.name, reussie, ratee, nonvue, total, pct, found };
  });
  // Matières les plus faibles en premier ; celles sans question dans le pool choisi (N/A) à la
  // fin, à part — ce ne sont pas "à risque", juste hors périmètre du filtre actuel.
  const rowsSorted = rows.filter(r => !r.na).sort((a, b) => a.pct - b.pct).concat(rows.filter(r => r.na));

  function readinessColor(pct) {
    if (pct >= PASS_THRESHOLD) return '#4caf50';
    if (pct >= 50) return '#ff9800';
    return '#f44336';
  }

  const rowsHtml = rowsSorted.map(r => r.na ? `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:.85em;border-bottom:1px solid rgba(255,255,255,.05);opacity:.55">
      <span style="flex:0 0 auto;font-size:1.1em">➖</span>
      <span style="flex:1;min-width:140px">${r.name}</span>
      <span style="flex:1;min-width:60px;font-style:italic">Aucune question dans ce pool</span>
      <span style="flex:0 0 46px;text-align:right">—</span>
      <span style="flex:0 0 60px;text-align:right">—</span>
    </div>` : `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:.85em;border-bottom:1px solid rgba(255,255,255,.05)">
      <span style="flex:0 0 auto;font-size:1.1em">${r.pct >= PASS_THRESHOLD ? '✅' : (r.pct >= 50 ? '⚠️' : '🔴')}</span>
      <span style="flex:1;min-width:140px">${r.name}</span>
      <div style="flex:1;min-width:60px;background:rgba(255,255,255,.06);border-radius:4px;height:12px;position:relative;overflow:hidden">
        <div style="height:100%;width:${r.pct}%;background:${readinessColor(r.pct)};border-radius:4px"></div>
      </div>
      <span style="flex:0 0 46px;text-align:right;font-weight:700;color:${readinessColor(r.pct)}">${r.pct}%</span>
      <span style="flex:0 0 60px;text-align:right;color:var(--text-secondary)">${r.reussie}/${r.total}</span>
    </div>`).join('');

  const scored = rows.filter(r => !r.na);
  const nbAtRisk = scored.filter(r => r.pct < PASS_THRESHOLD).length;
  const nbNa = rows.length - scored.length;

  const poolOptionsHtml = Object.keys(READINESS_POOL_LABELS).map(key =>
    `<option value="${key}"${key === poolMode ? ' selected' : ''}>${READINESS_POOL_LABELS[key]}</option>`
  ).join('');

  cont.innerHTML = `
    <div class="home-card" id="readinessDashboardCard">
      <div class="home-card-header">
        <span class="home-card-icon">🎯</span>
        <span class="home-card-title">Suis-je prêt ? (par matière officielle)</span>
      </div>
      <p style="font-size:.82em;color:var(--text-secondary);margin:0 0 8px">
        À l'examen réel, chaque matière est notée <strong>séparément</strong> — une bonne
        moyenne globale peut cacher une matière en dessous du seuil. Seuil indicatif :
        ${PASS_THRESHOLD}% (à ajuster mentalement selon le seuil exact en vigueur pour ton
        examen — non garanti ici).
      </p>
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:0 0 10px;font-size:.82em">
        <label for="readinessPoolSelect" style="color:var(--text-secondary);flex:0 0 auto">Banque de questions :</label>
        <select id="readinessPoolSelect" onchange="setReadinessPoolFilter(this.value)" style="flex:1 1 160px;min-width:160px;padding:4px 6px;border-radius:6px;background:var(--input-bg);color:var(--input-text);border:1px solid var(--input-border)">
          ${poolOptionsHtml}
        </select>
      </div>
      ${rowsHtml}
      <p style="font-size:.8em;margin:10px 0 0;${nbAtRisk ? 'color:#ff9800' : 'color:#4caf50'}">
        ${nbAtRisk ? `⚠️ ${nbAtRisk} matière${nbAtRisk > 1 ? 's' : ''} sous le seuil indicatif.` : '✅ Toutes les matières sont au-dessus du seuil indicatif.'}
        ${nbNa ? ` (${nbNa} matière${nbNa > 1 ? 's' : ''} sans question dans ce pool, non comptée${nbNa > 1 ? 's' : ''}.)` : ''}
      </p>
      <div style="text-align:center;margin-top:10px">
        <a href="epreuve.html" class="stats-btn" style="display:inline-block;text-decoration:none;background:#667eea;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-weight:600">📝 Passer un examen blanc</a>
      </div>
    </div>
  `;
}

/**
 * _computeSrForecast(responses, numDays, validKeys) – Répartit les révisions déjà planifiées
 * (nextReview) sur les `numDays` prochains jours civils (jour 0 = aujourd'hui, y compris
 * tout ce qui est déjà en retard). Une question éligible mais jamais planifiée (nextReview
 * absent) est due immédiatement, comme le fait déjà _isDueForReview() partout ailleurs dans
 * l'app — même règle réutilisée ici, pas de nouvelle logique inventée. Les réussites/échecs
 * passés sont déjà "digérés" dans ces dates par _computeSrEntry() (croissance/lapse) : pas
 * besoin de re-simuler un taux de réussite futur, la planification actuelle EST la meilleure
 * estimation compte tenu de l'historique réel de l'utilisateur.
 *
 * BUG corrigé : cette fonction comptait TOUTES les entrées du document Firestore `responses`,
 * y compris celles dont la clé ne correspond plus à AUCUNE question actuellement chargée
 * (restes d'anciennes questions supprimées/renommées/dédupliquées au fil des mises à jour du
 * question bank). L'Accueil (updateModeCounts(), categories.js), lui, ne compte que les
 * réponses rattachées à une question RÉELLEMENT présente dans la liste courante — d'où un
 * écart entre les deux pages (ex: 19 sur l'Accueil vs 46 sur Stats) alors que les deux lisent
 * pourtant les mêmes données Firestore. `validKeys`, quand fourni, restreint le décompte aux
 * mêmes clés que l'Accueil, pour que les deux pages affichent exactement le même nombre.
 */
function _computeSrForecast(responses, numDays, validKeys) {
  const normResponses = (typeof normalizeResponses === 'function') ? normalizeResponses(responses) : responses;
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  const buckets = [];
  for (let i = 0; i <= numDays; i++) buckets.push(0);
  let beyond = 0;
  let totalEligible = 0;

  Object.entries(normResponses || {}).forEach(([key, r]) => {
    if (!r || r.suspended) return;
    if (validKeys && !validKeys.has(key)) return;
    if (typeof _isEligibleForSR === 'function' && !_isEligibleForSR(r)) return;
    totalEligible++;
    const nr = (r.nextReview !== undefined && r.nextReview !== null) ? r.nextReview : now;
    let diffDays = Math.floor((nr - todayStartMs) / dayMs);
    if (diffDays < 0) diffDays = 0;
    if (diffDays <= numDays) buckets[diffDays]++;
    else beyond++;
  });

  return { buckets, beyond, totalEligible };
}

/**
 * _renderSrForecast(responses, validKeys) – Carte "Programme des prochains jours" sur
 * stats.html : pour aujourd'hui + les 13 jours suivants, combien de révisions espacées seront
 * dues (planification actuelle) et combien de nouvelles questions viendraient s'y ajouter au
 * rythme configuré (getDailyNewTarget), avec une estimation de temps basée sur le rythme
 * réel déjà mesuré (_qt*). `validKeys` (Set) restreint le décompte aux questions actuellement
 * chargées — voir _computeSrForecast().
 */
function _renderSrForecast(responses, validKeys) {
  const cont = document.getElementById('srForecastContainer');
  if (!cont) return;
  const NUM_DAYS = 14;
  const { buckets, beyond, totalEligible } = _computeSrForecast(responses, NUM_DAYS, validKeys);
  const dailyNewTarget = (typeof getDailyNewTarget === 'function') ? getDailyNewTarget() : 15;
  const { secPerNew, secPerReview } = (typeof _qtGetEstimateSecPerQuestion === 'function')
    ? _qtGetEstimateSecPerQuestion() : { secPerNew: 35, secPerReview: 22 };

  const dayNames = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  let rowsHtml = '';
  for (let i = 0; i <= NUM_DAYS; i++) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    const dueCount = buckets[i];
    const total = dueCount + dailyNewTarget;
    const estSec = dueCount * secPerReview + dailyNewTarget * secPerNew;
    const estMin = Math.round(estSec / 60);
    const dayLabel = i === 0 ? 'Aujourd\'hui' : (i === 1 ? 'Demain' : (dayNames[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1)));
    const barMax = Math.max(1, ...buckets);
    const barPct = Math.round((dueCount / barMax) * 100);
    rowsHtml += `
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:.85em;border-bottom:1px solid rgba(255,255,255,.05)">
        <span style="flex:0 0 90px;${i === 0 ? 'font-weight:700;color:#f59e0b' : ''}">${dayLabel}</span>
        <div style="flex:1;min-width:60px;background:rgba(255,255,255,.06);border-radius:4px;height:14px;position:relative;overflow:hidden">
          <div style="height:100%;width:${barPct}%;background:${i === 0 ? '#f59e0b' : '#667eea'};border-radius:4px"></div>
        </div>
        <span style="flex:0 0 70px;text-align:right">📅 ${dueCount}${i === 0 && dueCount > 0 ? ' (dont retard)' : ''}</span>
        <span style="flex:0 0 60px;text-align:right;color:var(--text-secondary)">+${dailyNewTarget} nv.</span>
        <span style="flex:0 0 50px;text-align:right;font-weight:700">${total}</span>
        <span style="flex:0 0 60px;text-align:right;color:var(--text-secondary)">~${estMin} min</span>
      </div>`;
  }

  cont.innerHTML = `
    <div class="home-card" id="srForecastCard">
      <div class="home-card-header">
        <span class="home-card-icon">📅</span>
        <span class="home-card-title">Programme des prochains jours (répétition espacée)</span>
      </div>
      <p style="font-size:.82em;color:var(--text-secondary);margin:0 0 8px">
        Révisions dues chaque jour selon ta planification actuelle (déjà influencée par ton
        historique de réussite/échec réel), plus ton objectif de nouvelles questions/jour
        (${dailyNewTarget}, modifiable sur l'accueil). Temps estimé à partir de ton rythme réel mesuré.
      </p>
      <div style="display:flex;gap:8px;font-size:.75em;color:var(--text-secondary);padding-bottom:4px;border-bottom:1px solid rgba(255,255,255,.1);margin-bottom:2px">
        <span style="flex:0 0 90px">Jour</span>
        <span style="flex:1;min-width:60px"></span>
        <span style="flex:0 0 70px;text-align:right">Révisions</span>
        <span style="flex:0 0 60px;text-align:right">Nouvelles</span>
        <span style="flex:0 0 50px;text-align:right">Total</span>
        <span style="flex:0 0 60px;text-align:right">Temps</span>
      </div>
      ${rowsHtml}
      ${beyond > 0 ? `<p style="font-size:.78em;color:var(--text-secondary);margin:8px 0 0">+ ${beyond} révision(s) planifiée(s) au-delà de ${NUM_DAYS} jours.</p>` : ''}
      <p style="font-size:.78em;color:var(--text-secondary);margin:4px 0 0">${totalEligible} question(s) au total dans le cycle de répétition espacée.</p>
    </div>
  `;
}

/**
 * _renderMasteryEstimator(groups) – Construit la carte "Estimation du temps pour tout
 * maîtriser" en bas de stats.html : sélection (toutes / un ou plusieurs des 4 grands blocs /
 * une ou plusieurs catégories précises, combinables), restriction optionnelle marquées/
 * importantes/notées, seuil de "réussites nécessaires" et rythme d'étude (min/jour).
 * `groups` est le même tableau {name, categories} déjà utilisé pour l'affichage des stats —
 * mêmes 4 grandes parties (CLASSIQUES / EASA / GLIGLI HARD / GLIGLI EASY).
 */
function _renderMasteryEstimator(groups) {
  const cont = document.getElementById('masteryEstimatorContainer');
  if (!cont) return;
  window._masteryGroupsDef = groups;

  let groupsHtml = '';
  groups.forEach((group, gi) => {
    groupsHtml += `<div style="margin-bottom:8px;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:8px 10px">`;
    groupsHtml += `<label class="home-checkbox-label" style="font-weight:700;margin:0">
      <input type="checkbox" id="mastGroup_${gi}" onchange="_onMastGroupChange(${gi})">
      <span>${group.name}</span>
    </label>`;
    groupsHtml += `<div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:6px;padding-left:6px;font-size:.82em">`;
    group.categories.forEach((cat, ci) => {
      groupsHtml += `<label class="home-checkbox-label" style="margin:0">
        <input type="checkbox" id="mastCat_${gi}_${ci}" data-group-idx="${gi}">
        <span>${cat.label}</span>
      </label>`;
    });
    groupsHtml += `</div></div>`;
  });

  cont.innerHTML = `
    <div class="home-card" id="masteryEstimatorCard">
      <div class="home-card-header">
        <span class="home-card-icon">🎯</span>
        <span class="home-card-title">Estimation du temps pour tout maîtriser</span>
      </div>
      <p style="font-size:.82em;color:var(--text-secondary);margin:0 0 10px">
        Sélectionne ce que tu veux maîtriser — tout, un ou plusieurs des 4 grands blocs, une ou
        plusieurs catégories précises (combinable) — et le nombre de bonnes réponses nécessaires
        par question pour la considérer acquise. L'estimation utilise ton rythme réel (temps par
        question mesuré) et ton taux de réussite actuel pour ce sous-ensemble.
      </p>
      <label class="home-checkbox-label" style="font-weight:700">
        <input type="checkbox" id="mastToutes" onchange="_onMastToutesChange()">
        <span>🌐 Toutes les catégories</span>
      </label>
      <div id="mastGroupsList" style="margin-top:8px">${groupsHtml}</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin:12px 0;font-size:.85em">
        <span style="width:100%;color:var(--text-secondary)">Restreindre en plus à (optionnel, cochables ensemble) :</span>
        <label class="home-checkbox-label" style="margin:0"><input type="checkbox" id="mastFlagMarquees"><span>🔖 Marquées</span></label>
        <label class="home-checkbox-label" style="margin:0"><input type="checkbox" id="mastFlagImportantes"><span>⭐ Importantes</span></label>
        <label class="home-checkbox-label" style="margin:0"><input type="checkbox" id="mastFlagNotes"><span>📝 Notées</span></label>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin-bottom:12px">
        <label style="font-size:.85em">✅ Réussites nécessaires / question&nbsp;:
          <input type="number" id="mastThreshold" class="home-input" style="width:60px" min="1" value="3">
        </label>
        <label style="font-size:.85em">🕐 Minutes d'étude / jour&nbsp;:
          <input type="number" id="mastMinPerDay" class="home-input" style="width:70px" min="1" value="20">
        </label>
      </div>
      <button class="stats-btn" onclick="_computeMasteryEstimate()" style="background:#667eea;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:600">
        📐 Calculer le temps nécessaire
      </button>
      <div id="masteryEstimateResult" style="margin-top:14px"></div>
    </div>
  `;
}

/** _onMastToutesChange() – "Toutes" grise/dégrise la liste groupes/catégories (mutuellement exclusif). */
function _onMastToutesChange() {
  const toutes = document.getElementById('mastToutes').checked;
  const list = document.getElementById('mastGroupsList');
  if (!list) return;
  list.style.opacity = toutes ? '0.4' : '1';
  list.style.pointerEvents = toutes ? 'none' : 'auto';
}

/** _onMastGroupChange(gi) – Cocher/décocher un grand bloc répercute l'état sur ses catégories. */
function _onMastGroupChange(gi) {
  const gEl = document.getElementById('mastGroup_' + gi);
  if (!gEl) return;
  document.querySelectorAll('input[data-group-idx="' + gi + '"]').forEach(cb => { cb.checked = gEl.checked; });
}

/**
 * _fmtMasteryDuration(sec) – "3 j 6 h" / "2 h 15 min" / "45 min" / "30 s" selon l'échelle —
 * distinct de _qtFormatDuration() (min/sec uniquement) car une estimation de maîtrise complète
 * peut facilement dépasser plusieurs dizaines d'heures, illisible en simples minutes.
 */
function _fmtMasteryDuration(sec) {
  sec = Math.round(sec);
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
  return `${seconds} s`;
}

/**
 * _computeMasteryEstimate() – Calcule le temps de travail actif restant pour que TOUTES les
 * questions de la sélection atteignent "réussites >= seuil" (mastThreshold), en estimant le
 * nombre de tentatives nécessaires via le taux de réussite observé sur la sélection (une
 * question ratée régulièrement demandera statistiquement plus de tentatives pour accumuler le
 * même nombre de succès), et le temps par tentative via le rythme réel déjà mesuré (_qt*).
 */
async function _computeMasteryEstimate() {
  const resultEl = document.getElementById('masteryEstimateResult');
  if (!resultEl) return;
  resultEl.innerHTML = '<p style="color:var(--text-secondary)">⏳ Calcul en cours…</p>';

  const groups = window._masteryGroupsDef || [];
  const toutes = document.getElementById('mastToutes').checked;
  const threshold = Math.max(1, parseInt(document.getElementById('mastThreshold').value) || 3);
  const minPerDay = Math.max(1, parseInt(document.getElementById('mastMinPerDay').value) || 20);
  const flagMarquees = document.getElementById('mastFlagMarquees').checked;
  const flagImportantes = document.getElementById('mastFlagImportantes').checked;
  const flagNotes = document.getElementById('mastFlagNotes').checked;
  const anyFlag = flagMarquees || flagImportantes || flagNotes;

  let pool = [];
  const seenKeys = new Set();
  let selectionLabel = '';

  try {
    if (toutes) {
      await loadAllQuestions();
      questions.forEach(q => {
        const key = getKeyFor(q);
        if (!seenKeys.has(key)) { seenKeys.add(key); pool.push(q); }
      });
      selectionLabel = 'Toutes les catégories';
    } else {
      const checkedGroupNames = [];
      const catValuesToLoad = [];
      groups.forEach((g, gi) => {
        const gEl = document.getElementById('mastGroup_' + gi);
        if (gEl && gEl.checked) {
          checkedGroupNames.push(g.name);
          g.categories.forEach(c => catValuesToLoad.push(c.value));
        }
      });
      const checkedCatLabels = [];
      groups.forEach((g, gi) => {
        g.categories.forEach((c, ci) => {
          const cEl = document.getElementById('mastCat_' + gi + '_' + ci);
          if (cEl && cEl.checked && !catValuesToLoad.includes(c.value)) {
            catValuesToLoad.push(c.value);
            checkedCatLabels.push(c.label);
          }
        });
      });
      if (!catValuesToLoad.length) {
        resultEl.innerHTML = '<p style="color:#f87171">Sélectionne au moins une catégorie (ou coche "Toutes les catégories").</p>';
        return;
      }
      for (const catVal of catValuesToLoad) {
        await chargerQuestions(catVal);
        questions.forEach(q => {
          const key = getKeyFor(q);
          if (!seenKeys.has(key)) { seenKeys.add(key); pool.push(q); }
        });
      }
      const parts = [];
      if (checkedGroupNames.length) parts.push(checkedGroupNames.join(', '));
      if (checkedCatLabels.length) parts.push(checkedCatLabels.join(', '));
      selectionLabel = parts.join(' + ');
    }
  } catch (e) {
    resultEl.innerHTML = '<p style="color:#f87171">Erreur de chargement : ' + e.message + '</p>';
    return;
  }

  const responses = window._masteryResponses || {};
  const notes = window._masteryNotes || {};

  if (anyFlag) {
    pool = pool.filter(q => {
      const key = getKeyFor(q);
      const r = responses[key];
      if (flagMarquees && r && r.marked) return true;
      if (flagImportantes && r && r.important) return true;
      if (flagNotes && notes[key]) return true;
      return false;
    });
  }

  if (!pool.length) {
    resultEl.innerHTML = '<p style="color:var(--text-secondary)">Aucune question ne correspond à cette sélection.</p>';
    return;
  }

  // Taux de réussite observé sur LE POOL sélectionné : sert à la fois de repli pour les
  // questions jamais tentées et à estimer le nombre de tentatives nécessaires pour les autres.
  // Plafonné [35%, 95%] pour éviter une estimation absurde (temps infini ou nul) sur un
  // sous-ensemble avec très peu d'historique.
  let sumSuccess = 0, sumFail = 0;
  pool.forEach(q => {
    const r = responses[getKeyFor(q)];
    if (r) { sumSuccess += r.successCount || 0; sumFail += r.failCount || 0; }
  });
  const hasHistory = (sumSuccess + sumFail) > 0;
  const observedRate = hasHistory ? sumSuccess / (sumSuccess + sumFail) : 0.65;
  const effectiveRate = Math.min(0.95, Math.max(0.35, observedRate));

  const { secPerNew, secPerReview } = (typeof _qtGetEstimateSecPerQuestion === 'function')
    ? _qtGetEstimateSecPerQuestion() : { secPerNew: 35, secPerReview: 22 };

  let totalSeconds = 0, masteredCount = 0, remainingCount = 0;
  pool.forEach(q => {
    const key = getKeyFor(q);
    const r = responses[key];
    const successCount = (r && r.successCount) || 0;
    const failCount = (r && r.failCount) || 0;
    if (successCount >= threshold) { masteredCount++; return; }
    remainingCount++;
    const remainingSuccesses = threshold - successCount;
    // Espérance du nb de tentatives (succès+échecs) pour accumuler `remainingSuccesses`
    // succès de plus, à taux de réussite `effectiveRate` constant.
    const expectedAttempts = remainingSuccesses / effectiveRate;
    const neverAttempted = (successCount + failCount) === 0;
    const newPortion = neverAttempted ? Math.min(1, expectedAttempts) : 0;
    const reviewPortion = expectedAttempts - newPortion;
    totalSeconds += newPortion * secPerNew + reviewPortion * secPerReview;
  });

  const totalMinutes = totalSeconds / 60;
  const totalHours = totalMinutes / 60;
  const daysNeeded = Math.max(1, Math.ceil(totalMinutes / minPerDay));
  const flagsLabel = [flagMarquees && '🔖', flagImportantes && '⭐', flagNotes && '📝'].filter(Boolean).join('/');

  resultEl.innerHTML = `
    <div style="background:rgba(102,126,234,.08);border:1px solid rgba(102,126,234,.3);border-radius:10px;padding:12px 14px">
      <div style="font-size:.8em;color:var(--text-secondary);margin-bottom:6px">📚 Sélection : <strong>${selectionLabel}</strong>${anyFlag ? ' · restreint à ' + flagsLabel : ''} — seuil de maîtrise : <strong>${threshold}</strong> réussite${threshold > 1 ? 's' : ''}/question</div>
      <div style="font-size:1.3em;font-weight:800;margin-bottom:4px">⏱️ ${_fmtMasteryDuration(totalSeconds)}</div>
      <div style="font-size:.85em;color:var(--text-secondary);margin-bottom:8px">≈ ${Math.round(totalHours * 10) / 10} h de travail actif restant, à raison de ${minPerDay} min/jour → <strong>${daysNeeded}</strong> jour${daysNeeded > 1 ? 's' : ''}</div>
      <div style="font-size:.82em;display:flex;flex-wrap:wrap;gap:4px 16px">
        <span>✅ Déjà maîtrisées : <strong>${masteredCount}</strong> / ${pool.length}</span>
        <span>📋 Restantes : <strong>${remainingCount}</strong></span>
        <span>🎯 Taux de réussite utilisé : <strong>${Math.round(effectiveRate * 100)}%</strong>${hasHistory ? '' : ' (estimation par défaut, pas encore d\'historique sur cette sélection)'}</span>
      </div>
    </div>
  `;
}

/**
 * _exportProgress() – Exporte toute la progression Firestore en fichier JSON
 */
async function _exportProgress() {
  const uid = (auth.currentUser && auth.currentUser.uid) || localStorage.getItem('cachedUid');
  if (!uid) { alert('Vous devez être connecté.'); return; }

  try {
    let doc;
    if (navigator.onLine) {
      try {
        doc = await Promise.race([
          db.collection('quizProgress').doc(uid).get({ source: 'server' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))
        ]);
      } catch (e) {
        doc = await db.collection('quizProgress').doc(uid).get();
      }
    } else {
      doc = await db.collection('quizProgress').doc(uid).get();
    }

    const data = doc.exists ? doc.data() : {};
    const responses = data.responses || {};

    // Réintégrer l'historique (statusLog) depuis la sous-collection quizProgress/{uid}/history
    // dans l'export, pour que le fichier de sauvegarde reste un snapshot COMPLET et
    // autonome — l'historique ne vit plus inline dans le document principal (voir
    // _migrateStatusLogToSubcollection dans js/offline.js) mais doit quand même apparaître
    // dans une sauvegarde/export destinée à l'utilisateur.
    try {
      const histSnap = await db.collection('quizProgress').doc(uid).collection('history').get();
      histSnap.forEach(d => {
        const hData = d.data();
        if (hData && Array.isArray(hData.log) && hData.log.length) {
          if (!responses[d.id]) responses[d.id] = {};
          responses[d.id] = { ...responses[d.id], statusLog: hData.log };
        }
      });
    } catch (e) {
      console.warn('[exportProgress] chargement historique (sous-collection) échoué:', e);
    }

    // Include localStorage session data as well
    const backup = {
      version: 1,
      exportDate: new Date().toISOString(),
      uid: uid,
      responses: responses,
      dailyHistory: data.dailyHistory || {},
      sessionHistory: JSON.parse(localStorage.getItem('offlineSessionBackup') || '[]'),
      symbolesResponses: JSON.parse(localStorage.getItem('symbolesResponses') || '{}'),
      symbolesSessionHistory: JSON.parse(localStorage.getItem('symbolesSessionHistory') || '[]')
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quizz_ppl_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('[exportProgress]', e);
    alert('Erreur export : ' + e.message);
  }
}

/**
 * _compactQuizProgress() – Réduit la taille du document Firestore quizProgress/{uid} en
 * plafonnant statusLog à 15 entrées par question (au lieu de jusqu'à 100 auparavant).
 * Firestore refuse TOUTE écriture sur un document dépassant 1 Mio (1 048 576 octets), même une
 * mise à jour minime sur une seule question — avec des milliers de questions répondues,
 * statusLog (jusqu'à 100 entrées/question) peut à lui seul faire dépasser cette limite,
 * bloquant alors TOUTES les sauvegardes sans qu'aucune ne réussisse plus jamais, sur aucune
 * question, jusqu'à ce que le document soit dégonflé. Ne touche à AUCUNE statistique
 * (failCount/successCount/marked/important/srInterval/nextReview intacts) — uniquement à
 * l'historique détaillé au-delà des 15 réponses les plus récentes par question.
 */
async function _compactQuizProgress() {
  const uid = (auth.currentUser && auth.currentUser.uid) || localStorage.getItem('cachedUid');
  const statusEl = document.getElementById('compactStatus');
  const btn = document.getElementById('compactBtn');
  if (!uid) { alert('Vous devez être connecté.'); return; }
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = '⏳ Lecture de tes données…';

  try {
    let doc;
    try {
      doc = await Promise.race([
        db.collection('quizProgress').doc(uid).get({ source: 'server' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout serveur')), 8000))
      ]);
    } catch (e) {
      doc = await db.collection('quizProgress').doc(uid).get();
    }
    if (!doc.exists) { if (statusEl) statusEl.textContent = 'ℹ️ Aucune donnée à compacter.'; if (btn) btn.disabled = false; return; }

    const data = doc.data();
    const sizeBefore = new Blob([JSON.stringify(data)]).size;
    const SAFETY_LIMIT = 900 * 1024; // vise nettement sous la limite dure de 1 Mio, avec marge pour de futures réponses
    const responses = data.responses || {};

    // Compactage par paliers de plus en plus agressifs : on s'arrête dès que la taille estimée
    // repasse sous la marge de sécurité, pour perdre le MOINS d'historique détaillé possible.
    function trimTo(cap) {
      let trimmedCount = 0, entriesRemoved = 0;
      Object.keys(responses).forEach(key => {
        const r = responses[key];
        if (r && Array.isArray(r.statusLog) && r.statusLog.length > cap) {
          entriesRemoved += r.statusLog.length - cap;
          r.statusLog = cap > 0 ? r.statusLog.slice(-cap) : undefined;
          if (cap === 0) delete r.statusLog;
          trimmedCount++;
        }
      });
      return { trimmedCount, entriesRemoved };
    }

    let totalTrimmed = 0, totalEntriesRemoved = 0, currentSize = sizeBefore;
    for (const cap of [15, 5, 0]) {
      if (currentSize <= SAFETY_LIMIT) break;
      const { trimmedCount, entriesRemoved } = trimTo(cap);
      totalTrimmed += trimmedCount;
      totalEntriesRemoved += entriesRemoved;
      currentSize = new Blob([JSON.stringify(data)]).size;
      if (statusEl) statusEl.textContent = `⏳ Palier ${cap === 0 ? 'historique retiré' : 'plafond ' + cap} — taille actuelle : ~${Math.round(currentSize / 1024)} Ko…`;
    }

    if (!totalTrimmed) {
      const sizeKb = Math.round(sizeBefore / 1024);
      if (statusEl) statusEl.textContent = `ℹ️ Rien à compacter (document actuel : ~${sizeKb} Ko, déjà sous la limite historique). Si tes sauvegardes échouent quand même, envoie-moi le message d'erreur exact.`;
      if (btn) btn.disabled = false;
      return;
    }

    if (statusEl) statusEl.textContent = `⏳ Compactage de ${totalTrimmed} question(s) (${totalEntriesRemoved} entrée(s) d'historique en trop retirée(s))…`;

    // set() (pas update()) : on réécrit le document entier avec les statusLog déjà réduits,
    // pour que la taille du document lui-même redescende sous la limite — un update() partiel
    // sur une seule question n'aurait rien changé à la taille globale déjà trop grande.
    await db.collection('quizProgress').doc(uid).set(data);

    const sizeAfter = new Blob([JSON.stringify(data)]).size;
    if (statusEl) {
      statusEl.textContent = `✅ Compactage terminé : ${Math.round(sizeBefore / 1024)} Ko → ${Math.round(sizeAfter / 1024)} Ko `
        + `(${totalTrimmed} question(s) allégée(s), aucune statistique perdue — réussites/échecs/planification intacts). Tes sauvegardes devraient de nouveau fonctionner.`;
    }
    // Recharger currentResponses en mémoire pour que le reste de la page reflète le compactage
    if (typeof currentResponses !== 'undefined') currentResponses = normalizeResponses(responses);
  } catch (e) {
    console.error('[compactQuizProgress]', e);
    if (statusEl) statusEl.textContent = '❌ Échec du compactage : ' + e.message + ' (détail en console F12).';
  } finally {
    if (btn) btn.disabled = false;
  }
}
window._compactQuizProgress = _compactQuizProgress;

/**
 * _importProgress() – Importe la progression depuis un fichier JSON
 */
function _importProgress() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async function() {
    const file = input.files[0];
    if (!file) return;

    const uid = (auth.currentUser && auth.currentUser.uid) || localStorage.getItem('cachedUid');
    if (!uid) { alert('Vous devez être connecté.'); return; }

    try {
      const text = await file.text();
      let backup;
      try { backup = JSON.parse(text); } catch (e) { alert('Fichier JSON invalide.'); return; }

      if (!backup.responses || typeof backup.responses !== 'object') {
        alert('Fichier de sauvegarde invalide (pas de réponses trouvées).');
        return;
      }

      if (!confirm(
        `Importer la sauvegarde du ${backup.exportDate ? new Date(backup.exportDate).toLocaleDateString('fr-FR') : '?'} ?\n\n` +
        `• ${Object.keys(backup.responses).length} réponses seront restaurées\n` +
        `• Cela écrasera votre progression actuelle`
      )) return;

      // Write responses to Firestore
      const update = {
        responses: backup.responses,
        lastUpdated: firebase.firestore.Timestamp.now()
      };
      if (backup.dailyHistory) update.dailyHistory = backup.dailyHistory;
      await db.collection('quizProgress').doc(uid).set(update, { merge: true });

      // D'anciennes sauvegardes (exportées avant l'introduction de la sous-collection
      // d'historique) peuvent contenir un statusLog inline par question : le set() ci-dessus
      // vient de le réintroduire dans le document principal. Le ressortir immédiatement vers
      // quizProgress/{uid}/history via la même migration idempotente que celle exécutée au
      // chargement des pages, pour ne pas réintroduire le risque de dépassement de 1 Mio.
      if (typeof _migrateStatusLogToSubcollection === 'function') {
        try {
          currentResponses = normalizeResponses(backup.responses);
          await _migrateStatusLogToSubcollection(uid);
        } catch (e) { console.warn('[importProgress] migration statusLog:', e); }
      }

      // Restore localStorage data
      if (backup.sessionHistory) {
        localStorage.setItem('offlineSessionBackup', JSON.stringify(backup.sessionHistory));
      }
      if (backup.symbolesResponses) {
        localStorage.setItem('symbolesResponses', JSON.stringify(backup.symbolesResponses));
      }
      if (backup.symbolesSessionHistory) {
        localStorage.setItem('symbolesSessionHistory', JSON.stringify(backup.symbolesSessionHistory));
      }

      alert('Progression importée avec succès !');
      window.location.reload();
    } catch (e) {
      console.error('[importProgress]', e);
      alert('Erreur import : ' + e.message);
    }
  };
  input.click();
}


