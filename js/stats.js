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
      if (r.status === 'réussie') reussie++;
      else if (r.status === 'ratée') ratee++;
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
  // Moyenne sur 7 jours complets (hors aujourd'hui) — même fenêtre que l'objectif et le chart
  const remaining = ratee + nonvue;
  let daysRemainingHtml = '';
  if (remaining > 0) {
    const today = new Date();
    let total7 = 0;
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      total7 += mergedDH[key] || 0;
    }
    const avg7 = total7 / 7;
    if (avg7 > 0) {
      const daysLeft = Math.ceil(remaining / avg7);
      daysRemainingHtml = `<span title="Basé sur la moyenne de ${Math.round(avg7)} questions/jour sur 7 jours complets (hors aujourd'hui)">📆 ~${daysLeft} jour${daysLeft > 1 ? 's' : ''} restant${daysLeft > 1 ? 's' : ''}</span>`;
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
    // Fallback (offline ou transaction échouée) : écrire la valeur locale directement
    const update = {};
    update['dailyHistory.' + dateKey] = absoluteCount;
    await docRef.set(update, { merge: true });
  } catch (e) {
    console.error('[saveDailyCount] error:', e);
    throw e; // Propager pour que saveDailyCountOffline tombe dans le fallback IndexedDB
  }
}

/**
 * saveSessionResult() – Sauvegarde le résultat d'une session de quiz dans Firestore
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
function computeStatsForFirestore(categoryQuestions, responses) {
  let reussie = 0, ratee = 0, nonvue = 0, marquee = 0, importante = 0;
  categoryQuestions.forEach(q => {
    const key = getKeyFor(q);
    const r = responses[key] || {};
    // compter toujours réussite/échec/non-vu
    if (r.status === 'réussie')      reussie++;
    else if (r.status === 'ratée')    ratee++;
    else                               nonvue++;
    // marquée / importante en supplément
    if (r.marked)                     marquee++;
    if (r.important)                  importante++;
  });
  return { reussie, ratee, nonvue, marquee, importante };
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
          const emptyStats = { reussie: 0, ratee: 0, nonvue: 0, marquee: 0, importante: 0 };
          catStats.push({ label: cat.label, value: cat.value, stats: emptyStats, globalContrib: emptyStats });
        }
      }
      groupsData.push({ name: group.name, categories: catStats });
    }

    afficherStats(groupsData);

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
      // Vérifier les clés UTC (toISOString) — couvrir aussi le décalage horaire potentiel
      const utcKey1 = localKey; // Même date si pas de décalage minuit
      const lsVal = Math.max(
        parseInt(localStorage.getItem('dailyAnswered_' + utcKey1)) || 0,
        parseInt(localStorage.getItem('dailyCountRatchet_' + utcKey1)) || 0
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
function afficherStats(groupsData) {
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

  // Totaux globaux (utiliser globalContrib pour éviter le double-comptage des refs épreuve)
  let gRe = 0, gRa = 0, gNv = 0, gMa = 0, gIm = 0;
  groupsData.forEach(g => g.categories.forEach(c => {
    const s = c.globalContrib || c.stats;
    gRe += s.reussie;
    gRa += s.ratee;
    gNv += s.nonvue;
    gMa += s.marquee;
    gIm += s.importante || 0;
  }));
  const gTotal = gRe + gRa + gNv;
  const gPerc = gTotal ? (gRe * 100 / gTotal).toFixed(2) : '0.00';

  // Calculer les jours restants (même logique que la page d'accueil)
  const gRemaining = gRa + gNv;
  let gDaysHtml = '';
  if (gRemaining > 0) {
    const mergedDH = _getDailyHistoryMerged();
    const _now = new Date();
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
      gDaysHtml = `<div style="margin-top:6px;font-size:0.85em;color:#667eea;font-weight:600">📆 ~${dL} jour${dL > 1 ? 's' : ''} restant${dL > 1 ? 's' : ''} <span style="font-weight:400;color:var(--text-secondary)">(moy ${Math.round(a7)}/j)</span></div>`;
    }
  }

  // Carte globale
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
      ${gDaysHtml}
    </div>
  `;

  // Compteur unique pour les IDs de graphiques
  let catChartIdx = 0;

  // Chaque groupe
  groupsData.forEach(group => {
    let grRe = 0, grRa = 0, grNv = 0, grMa = 0, grIm = 0;
    group.categories.forEach(c => {
      const s = c.globalContrib || c.stats;
      grRe += s.reussie;
      grRa += s.ratee;
      grNv += s.nonvue;
      grMa += s.marquee;
      grIm += s.importante || 0;
    });
    const grTotal = grRe + grRa + grNv;
    const grPerc = grTotal ? Math.round((grRe * 100) / grTotal) : 0;

    html += `<div class="stats-group">`;
    html += `<div class="stats-group-header">
      <span class="stats-group-name">${group.name}</span>
      <span class="stats-group-summary">${grRe}/${grTotal} · ${grPerc}%</span>
    </div>`;
    html += `<div class="progressbar" style="height:8px;margin:4px 0 8px">
      <div class="progress" style="height:8px;width:${grPerc}%;background:${percColor(grPerc)}"></div>
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
      catChartIdx++;

      html += `<div class="stats-cat-row" data-cat-value="${cat.value || ''}" data-chart-id="${chartId}" onclick="_toggleCatChart(this)" style="cursor:pointer;" title="Cliquer pour voir les sessions">
        <span class="stats-cat-name">${cat.label}</span>
        <span class="stats-cat-bar"><div class="progressbar-mini"><div class="progress-mini" style="width:${perc}%;background:${percColor(perc)}"></div></div></span>
        <span class="stats-cat-perc" style="color:${percColor(perc)}">${perc}%</span>
        <span class="stats-cat-nums">✅${s.reussie} ❌${s.ratee} 👀${s.nonvue}${markersStr}</span>
        <button class="stats-cat-reset-btn" onclick="event.stopPropagation();_resetCategoryStats('${catVal}','${cat.label}')" title="Réinitialiser ${cat.label}">🔄</button>
      </div>`;
      html += `<div class="stats-cat-chart-container" id="${chartId}" style="display:none;"></div>`;
    });

    html += `</div>`;
  });

  cont.innerHTML = html;
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

  const avgPct = Math.round(sessions.reduce((s, x) => s + x.percent, 0) / sessions.length);
  const last5 = sessions.slice(-5);
  const avgLast5 = last5.length ? Math.round(last5.reduce((s, x) => s + x.percent, 0) / last5.length) : 0;
  const maxBarH = 60;

  let html = `
    <div style="padding:6px 8px 2px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;font-size:0.78em;color:var(--text-secondary)">
      <span>${sessions.length} session${sessions.length > 1 ? 's' : ''}</span>
      <span>moy: <b>${avgPct}%</b> · 5 dern.: <b>${avgLast5}%</b></span>
    </div>
    <div class="daily-chart-scroll" style="margin:0 4px 6px">
      <div class="daily-chart" style="height:${maxBarH + 40}px;min-width:${Math.max(sessions.length * 14, 200)}px">
  `;

  sessions.forEach((s, idx) => {
    const pct = s.percent || 0;
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

/**
 * _resetCategoryStats() – Réinitialise les statistiques d'une seule catégorie
 */
async function _resetCategoryStats(catValue, catLabel) {
  if (!confirm(`Réinitialiser toutes les statistiques de « ${catLabel} » ?\n\nCela supprimera vos réponses pour cette catégorie.`)) return;

  const uid = (auth.currentUser && auth.currentUser.uid) || localStorage.getItem('cachedUid');
  if (!uid) { alert('Vous devez être connecté.'); return; }

  try {
    // Charger les questions de cette catégorie pour obtenir leurs clés
    await chargerQuestions(catValue);
    const keys = questions.map(q => getKeyFor(q));

    if (!keys.length) { alert('Aucune question trouvée pour cette catégorie.'); return; }

    // Construire la mise à jour : supprimer chaque clé dans responses
    const update = { responses: {} };
    keys.forEach(k => { update.responses[k] = firebase.firestore.FieldValue.delete(); });

    await db.collection('quizProgress').doc(uid).set(update, { merge: true });

    // Supprimer aussi du localStorage
    keys.forEach(k => { localStorage.removeItem(k); });

    alert(`Statistiques de « ${catLabel} » réinitialisées !`);
    window.location.reload();
  } catch (e) {
    console.error('[resetCategory] Erreur:', e);
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
  const avgPct = Math.round(sessions.reduce((s, x) => s + x.percent, 0) / totalSessions);
  const last5 = sessions.slice(-5);
  const avgLast5 = last5.length ? Math.round(last5.reduce((s, x) => s + x.percent, 0) / last5.length) : 0;

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
    const pct = s.percent || 0;
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
          localStorage.setItem(key, data.responses[key]);
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

  try {
    // Remplacer le delete() par un set() à responses: {}
    await db.collection('quizProgress').doc(uid)
      .set({ responses: {}, lastUpdated: firebase.firestore.Timestamp.now() }, { merge: true });
    alert("Les statistiques ont été réinitialisées !");
    window.location.reload();
  } catch (error) {
    console.error("Erreur lors de la réinitialisation des statistiques :", error);
    alert("Erreur lors de la réinitialisation des statistiques : " + error.message);
  }
}


