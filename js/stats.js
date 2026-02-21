// === stats.js === Statistics, daily chart, session chart, persistence ===

async function displayDailyStats(forcedUid) {
  ensureDailyStatsBarVisible();

  // INSTANT : afficher le compteur localStorage AVANT toute opération Firestore
  try {
    const todayDateInstant = new Date().toISOString().slice(0, 10);
    const lsInstant = parseInt(localStorage.getItem('dailyAnswered_' + todayDateInstant)) || 0;
    const ratchetInstant = parseInt(localStorage.getItem('dailyCountRatchet_' + todayDateInstant)) || 0;
    const instantCount = Math.max(lsInstant, ratchetInstant);
    if (instantCount > 0) {
      const countElemInstant = document.getElementById('answeredTodayCount');
      if (countElemInstant) countElemInstant.textContent = instantCount;
    }
  } catch (e) { /* ignore */ }

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
  console.log('[displayDailyStats] uid=', uid);
  
  try {
    const doc = await getDocWithTimeout(db.collection('quizProgress').doc(uid));
    const responses = doc.exists ? doc.data().responses || {} : {};
    
    // DEBUG : Afficher toutes les réponses brutes pour comprendre la structure
    const sampleResponses = Object.entries(responses).slice(0, 3).map(([k, v]) => {
      let ts = null;
      if (v.timestamp?.seconds !== undefined) {
        ts = v.timestamp.seconds * 1000;
      } else if (typeof v.timestamp === 'number') {
        ts = v.timestamp;
      } else if (v.lastUpdated?.seconds !== undefined) {
        ts = v.lastUpdated.seconds * 1000;
      } else if (typeof v.lastUpdated === 'number') {
        ts = v.lastUpdated;
      }
      return {
        key: k,
        hasTimestamp: !!v.timestamp,
        hasLastUpdated: !!v.lastUpdated,
        extractedTimestamp: ts,
        extractedDate: ts ? new Date(ts).toISOString() : 'N/A',
        fullResponse: v
      };
    });
    console.log('[displayDailyStats-RAW-RESPONSES]', {
      totalResponses: Object.keys(responses).length,
      sampleResponses: sampleResponses
    });
    
    // Aujourd'hui à minuit (heure locale)
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStartMs = todayStart.getTime();
    
    console.log('[displayDailyStats-TIME-DEBUG]', {
      now: now.toISOString(),
      todayStart: todayStart.toISOString(),
      todayStartMs: todayStartMs
    });
    
    // Compter les réponses d'aujourd'hui
    let answeredToday = 0;
    const oldResponses = [];
    const noTimestampResponses = []; // DEBUG - réponses sans timestamp
    Object.entries(responses).forEach(([key, response]) => {
      // Les réponses peuvent avoir un timestamp (Firestore FieldValue)
      let respTime = null;
      
      if (response.timestamp) {
        // Si c'est un timestamp Firestore (a .seconds et .nanoseconds)
        if (response.timestamp.seconds !== undefined) {
          respTime = response.timestamp.seconds * 1000;
        } else if (typeof response.timestamp === 'number') {
          respTime = response.timestamp;
        }
      } else if (response.lastUpdated) {
        if (response.lastUpdated.seconds !== undefined) {
          respTime = response.lastUpdated.seconds * 1000;
        } else if (typeof response.lastUpdated === 'number') {
          respTime = response.lastUpdated;
        }
      }
      
      // Si on a un timestamp et qu'il est >= à aujourd'hui minuit
      if (respTime && respTime >= todayStartMs) {
        answeredToday++;
        console.log('[displayDailyStats-MATCH]', key, 'respTime:', new Date(respTime).toISOString());
      } else if (respTime) {
        // DEBUG : Montrer quelques réponses qui NE correspondent PAS
        if (oldResponses.length < 5) {
          oldResponses.push({
            key: key,
            respTime: respTime,
            respDate: new Date(respTime).toISOString(),
            daysOld: Math.round((todayStartMs - respTime) / (1000 * 60 * 60 * 24))
          });
        }
      } else {
        // Pas de timestamp du tout
        if (noTimestampResponses.length < 5) {
          noTimestampResponses.push({
            key: key,
            response: response,
            hasTimestamp: !!response.timestamp,
            hasLastUpdated: !!response.lastUpdated
          });
        }
      }
    });
    
    if (oldResponses.length > 0) {
      console.log('[displayDailyStats-OLD-RESPONSES]', 'Exemples de réponses plus anciennes:', oldResponses);
    }
    if (noTimestampResponses.length > 0) {
      console.log('[displayDailyStats-NO-TIMESTAMP]', 'Réponses SANS timestamp:', noTimestampResponses);
    }
    
    // Lire aussi le compteur direct localStorage (fiable offline même si Firestore pas prêt)
    const todayDate = new Date().toISOString().slice(0, 10);
    const lsDirectCount = parseInt(localStorage.getItem('dailyAnswered_' + todayDate)) || 0;
    answeredToday = Math.max(answeredToday, lsDirectCount);

    // Afficher le compteur (ne jamais diminuer dans la même journée → ratchet)
    const todayKey = 'dailyCountRatchet_' + todayDate;
    const previousMax = parseInt(localStorage.getItem(todayKey)) || 0;
    if (answeredToday < previousMax) {
      console.log('[displayDailyStats] Ratchet: affiché', previousMax, 'au lieu de', answeredToday);
      answeredToday = previousMax;
    } else {
      localStorage.setItem(todayKey, answeredToday);
    }
    const statsBar = document.getElementById('dailyStatsBar');
    const countElem = document.getElementById('answeredTodayCount');
    if (statsBar && countElem) {
      countElem.textContent = answeredToday;
      statsBar.style.display = 'block';
      console.log('[displayDailyStats] Questions répondues aujourd\'hui:', answeredToday);
    } else {
      console.warn('[displayDailyStats] Éléments HTML statsBar ou countElem non trouvés');
    }
  } catch (error) {
    console.error('[displayDailyStats] Erreur:', error);
    // Même en cas d'erreur Firestore, afficher le compteur localStorage
    try {
      const todayDate = new Date().toISOString().slice(0, 10);
      const lsCount = parseInt(localStorage.getItem('dailyAnswered_' + todayDate)) || 0;
      const ratchetCount = parseInt(localStorage.getItem('dailyCountRatchet_' + todayDate)) || 0;
      const best = Math.max(lsCount, ratchetCount);
      if (best > 0) {
        const statsBar = document.getElementById('dailyStatsBar');
        const countElem = document.getElementById('answeredTodayCount');
        if (statsBar && countElem) {
          countElem.textContent = best;
          statsBar.style.display = 'block';
        }
      }
    } catch (e2) { /* ignore */ }
  }
}

/**
 * toggleAutoStart() – Active/désactive le démarrage automatique du quiz
 */

function displayHomeProgressBar(responses) {
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
  const perc = total ? Math.round((reussie * 100) / total) : 0;
  function percColor(p) {
    if (p >= 80) return '#4caf50';
    if (p >= 50) return '#ff9800';
    return '#f44336';
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
      <span>👀 ${nonvue}</span>
      <span>📌 ${marquee}</span>
      <span>⭐ ${importante}</span>
    </div>
  `;
}

/** saveDailyCount — Sauvegarde le compteur quotidien */
async function saveDailyCount(uid, answeredCount) {
  try {
    const today = new Date();
    const dateKey = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    
    const docRef = db.collection('quizProgress').doc(uid);
    const doc = await getDocWithTimeout(docRef);
    const existing = doc.exists && doc.data().dailyHistory ? doc.data().dailyHistory : {};
    existing[dateKey] = (existing[dateKey] || 0) + answeredCount;
    
    await docRef.set({ dailyHistory: existing }, { merge: true });
    console.log('[saveDailyCount]', dateKey, ':', existing[dateKey]);
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
 * enrichDailyHistoryFromResponses() – Complète les données dailyHistory
 * en scannant les timestamps des réponses Firestore.
 * Cela garantit que même si dailyHistory est vide (nouvellement ajouté),
 * les jours avec des réponses apparaissent dans le graphique.
 */
function enrichDailyHistoryFromResponses(dailyHistory, responses) {
  const countsFromTimestamps = {};
  
  Object.values(responses).forEach(r => {
    let respTime = null;
    if (r.timestamp) {
      if (r.timestamp.seconds !== undefined) respTime = r.timestamp.seconds * 1000;
      else if (typeof r.timestamp === 'number') respTime = r.timestamp;
    } else if (r.lastUpdated) {
      if (r.lastUpdated.seconds !== undefined) respTime = r.lastUpdated.seconds * 1000;
      else if (typeof r.lastUpdated === 'number') respTime = r.lastUpdated;
    }
    if (!respTime) return;
    
    const d = new Date(respTime);
    const key = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    countsFromTimestamps[key] = (countsFromTimestamps[key] || 0) + 1;
  });
  
  // Fusionner : prendre le max entre dailyHistory et les timestamps
  // (dailyHistory est incrémental et plus fiable quand il existe,
  //  mais pour les anciens jours sans dailyHistory on utilise les timestamps)
  const merged = { ...countsFromTimestamps };
  Object.entries(dailyHistory).forEach(([key, val]) => {
    merged[key] = Math.max(merged[key] || 0, val);
  });
  
  return merged;
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
  console.log(">>> initStats()");
  const t0 = performance.now();

  // INSTANT : afficher les sessions et le compteur quotidien depuis localStorage
  // AVANT toute opération Firestore (qui peut prendre 10-15s offline sur Android)
  try {
    const localBackupInstant = _getLocalSessionBackup();
    if (localBackupInstant.length) afficherSessionChart(localBackupInstant);
  } catch (e) { /* ignore */ }
  try {
    const todayInstant = new Date().toISOString().slice(0, 10);
    const lsInstant = parseInt(localStorage.getItem('dailyAnswered_' + todayInstant)) || 0;
    const ratchetInstant = parseInt(localStorage.getItem('dailyCountRatchet_' + todayInstant)) || 0;
    const instantCount = Math.max(lsInstant, ratchetInstant);
    if (instantCount > 0) {
      ensureDailyStatsBarVisible();
      const countElemInstant = document.getElementById('answeredTodayCount');
      if (countElemInstant) countElemInstant.textContent = instantCount;
    }
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
    console.log(`[initStats] prefetch done in ${Math.round(performance.now() - t0)}ms`);

    const doc = await getDocWithTimeout(db.collection('quizProgress').doc(uid));
    const data = doc.exists ? doc.data() : { responses: {} };

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
          catStats.push({ label: cat.label, stats: computeStatsForFirestore(catQuestions, data.responses) });
        } catch (err) {
          console.error("Stat error for", cat.value, err);
          catStats.push({ label: cat.label, stats: { reussie: 0, ratee: 0, nonvue: 0, marquee: 0, importante: 0 } });
        }
      }
      groupsData.push({ name: group.name, categories: catStats });
    }

    afficherStats(groupsData);

    // Charger l'historique quotidien et le compléter depuis les timestamps des réponses
    const dailyHistory = await getDailyHistory(uid);
    // Compléter/corriger dailyHistory avec les timestamps réels des réponses
    const enrichedHistory = enrichDailyHistoryFromResponses(dailyHistory, data.responses || {});
    afficherDailyChart(enrichedHistory);

    // Afficher l'historique des sessions (fusionner Firestore + backup localStorage)
    const firestoreHistory = data.sessionHistory || [];
    const localBackup = _getLocalSessionBackup();
    const sessionHistory = _mergeSessionHistories(firestoreHistory, localBackup);
    // Trier par date (arrayUnion ne garantit pas l'ordre)
    sessionHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
    afficherSessionChart(sessionHistory);
    console.log(`[initStats] terminé en ${Math.round(performance.now() - t0)}ms`);
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
    if (backup.some(s => s.date === date)) {
      console.log('[_saveSessionToLocalBackup] session déjà présente, ignorée');
      return;
    }
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
    console.log('[_saveSessionToLocalBackup] session ajoutée au backup localStorage');
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
      console.log(`[_cleanLocalSessionBackup] nettoyé: ${backup.length - remaining.length} sessions déjà dans Firestore`);
    }
  } catch (e) { /* ignore */ }
}

/** afficherStats — Affiche les statistiques par groupe */
function afficherStats(groupsData) {
  console.log(">>> afficherStats()", groupsData?.length || 0);
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

  // Totaux globaux (pas de doublons car pas d'agrégats)
  let gRe = 0, gRa = 0, gNv = 0, gMa = 0, gIm = 0;
  groupsData.forEach(g => g.categories.forEach(c => {
    gRe += c.stats.reussie;
    gRa += c.stats.ratee;
    gNv += c.stats.nonvue;
    gMa += c.stats.marquee;
    gIm += c.stats.importante || 0;
  }));
  const gTotal = gRe + gRa + gNv;
  const gPerc = gTotal ? Math.round((gRe * 100) / gTotal) : 0;

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
    </div>
  `;

  // Chaque groupe
  groupsData.forEach(group => {
    let grRe = 0, grRa = 0, grNv = 0, grMa = 0, grIm = 0;
    group.categories.forEach(c => {
      grRe += c.stats.reussie;
      grRa += c.stats.ratee;
      grNv += c.stats.nonvue;
      grMa += c.stats.marquee;
      grIm += c.stats.importante || 0;
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

      html += `<div class="stats-cat-row">
        <span class="stats-cat-name">${cat.label}</span>
        <span class="stats-cat-bar"><div class="progressbar-mini"><div class="progress-mini" style="width:${perc}%;background:${percColor(perc)}"></div></div></span>
        <span class="stats-cat-perc" style="color:${percColor(perc)}">${perc}%</span>
        <span class="stats-cat-nums">✅${s.reussie} ❌${s.ratee} 👀${s.nonvue}${markersStr}</span>
      </div>`;
    });

    html += `</div>`;
  });

  cont.innerHTML = html;
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
    chartCont.className = 'container';
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
  const last7 = days.slice(-7).reduce((s, d) => s + d.count, 0);
  const avg7 = last7 ? Math.round(last7 / 7) : 0;

  let html = `
    <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap">
      <strong>Activité quotidienne</strong>
      <div style="font-size:0.8em;color:var(--text-secondary)">
        7j: <b>${last7}</b> · 60j: <b>${total60}</b> · moy/7j: <b>${avg7}/j</b>
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
    chartCont.className = 'container';
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
  console.log(">>> synchroniserStatistiques()");

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
      console.log("Données récupérées depuis Firestore :", data);

      // Synchroniser les réponses dans localStorage
      if (data.responses) {
        Object.keys(data.responses).forEach(key => {
          localStorage.setItem(key, data.responses[key]);
        });
      }

      console.log("Statistiques synchronisées avec Firestore.");
    } else {
      console.log("Aucune donnée trouvée dans Firestore pour cet utilisateur.");
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
  console.log(">>> resetStats()");
  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
  if (!uid) return;

  // Supprimer les données locales
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("question_")) toRemove.push(k);
  }
  toRemove.forEach(k => localStorage.removeItem(k));
  console.log("Statistiques locales réinitialisées.");

  try {
    // Remplacer le delete() par un set() à responses: {}
    await db.collection('quizProgress').doc(uid)
      .set({ responses: {}, lastUpdated: firebase.firestore.Timestamp.now() }, { merge: true });
    console.log("Réponses effacées dans Firestore !");
    alert("Les statistiques ont été réinitialisées !");
    window.location.reload();
  } catch (error) {
    console.error("Erreur lors de la réinitialisation des statistiques :", error);
    alert("Erreur lors de la réinitialisation des statistiques : " + error.message);
  }
}


