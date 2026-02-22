// === init.js === Page initialization ===

async function initIndex() {

  // INSTANT : afficher le compteur quotidien depuis localStorage
  // AVANT toute opération Firestore/prefetch (qui peut prendre 10-15s offline)
  try {
    ensureDailyStatsBarVisible();
    const todayInstant = new Date().toISOString().slice(0, 10);
    const lsInstant = parseInt(localStorage.getItem('dailyAnswered_' + todayInstant)) || 0;
    const ratchetInstant = parseInt(localStorage.getItem('dailyCountRatchet_' + todayInstant)) || 0;
    const instantCount = Math.max(lsInstant, ratchetInstant);
    if (instantCount > 0) {
      const countElemInstant = document.getElementById('answeredTodayCount');
      if (countElemInstant) countElemInstant.textContent = instantCount;
    }
  } catch (e) { /* ignore */ }
  
  // Pré-charger tous les fichiers JSON en parallèle (depuis le cache SW = quasi-instantané)
  await prefetchAllJsonFiles();

  // Chargement des catégories classiques
  await chargerQuestions("PROCÉDURE RADIO");
  countRadio = questions.length;
  await chargerQuestions("PROCÉDURES OPÉRATIONNELLES");
  countOp = questions.length;
  await chargerQuestions("RÉGLEMENTATION");
  countRegl = questions.length;
  await chargerQuestions("CONNAISSANCE DE L'AVION");
  countConv = questions.length;
  await chargerQuestions("INSTRUMENTATION");
  countInstr = questions.length;
  await chargerQuestions("MASSE ET CENTRAGE");
  countMasse = questions.length;
  await chargerQuestions("MOTORISATION");
  countMotor = questions.length;
  // Catégorie AERODYNAMIQUE PRINCIPES DU VOL (fichier questions_aerodynamique.json)
  await chargerQuestions("AERODYNAMIQUE PRINCIPES DU VOL");
  countAer = questions.length;
  // Pour les catégories EASA : utilisez les clés telles qu'elles figurent dans index.html
  await chargerQuestions("EASA PROCEDURES");
  countEasa = questions.length;
  // Ajouter EASA AERODYNAMIQUE : charger à partir du fichier section_easa_navigation.json
  await chargerQuestions("EASA AERODYNAMIQUE");
  countEasaAero = questions.length;
  await chargerQuestions("EASA NAVIGATION");
  countEasaNavigation = questions.length;
  await chargerQuestions("section_easa_connaissance_avion");
  countEasaConnaissance = questions.length;
  await chargerQuestions("section_easa_meteorologie");
  countEasaMeteorologie = questions.length;
  await chargerQuestions("section_easa_performance_planification");
  countEasaPerformance = questions.length;
  await chargerQuestions("section_easa_reglementation");
  countEasaReglementation = questions.length;
  // Nouvelle catégorie EASA PERFORMANCES HUMAINES
  await chargerQuestions("EASA PERFORMANCES HUMAINES");
  countEasaPerfHumaines = questions.length;
  countEasaAll = countEasa + countEasaAero + countEasaNavigation + countEasaConnaissance + countEasaMeteorologie + countEasaPerformance + countEasaReglementation + countEasaPerfHumaines;

  // Catégories GLIGLI HARD
  await chargerQuestions("GLIGLI COMMUNICATIONS HARD");
  countGligliComm = questions.length;
  await chargerQuestions("GLIGLI CONNAISSANCES GENERALES AERONEF HARD");
  countGligliConnaissance = questions.length;
  await chargerQuestions("GLIGLI EPREUVE COMMUNE HARD");
  countGligliEpreuveCommune = questions.length;
  await chargerQuestions("GLIGLI EPREUVE SPECIFIQUE HARD");
  countGligliEpreuveSpecifique = questions.length;
  await chargerQuestions("GLIGLI METEOROLOGIE HARD");
  countGligliMeteo = questions.length;
  await chargerQuestions("GLIGLI NAVIGATION HARD");
  countGligliNavigation = questions.length;
  await chargerQuestions("GLIGLI PERFORMANCE HUMAINE HARD");
  countGligliPerfHumaine = questions.length;
  await chargerQuestions("GLIGLI PERFORMANCES PREPARATION VOL HARD");
  countGligliPerfPrepVol = questions.length;
  await chargerQuestions("GLIGLI PRINCIPES DU VOL HARD");
  countGligliPrincipesVol = questions.length;
  await chargerQuestions("GLIGLI PROCEDURES OPERATIONNELLES HARD");
  countGligliProcedures = questions.length;
  await chargerQuestions("GLIGLI REGLEMENTATION HARD");
  countGligliReglementation = questions.length;
  // GLIGLI EASY
  await chargerQuestions("GLIGLI COMMUNICATIONS EASY");
  countGligliCommEasy = questions.length;
  await chargerQuestions("GLIGLI CONNAISSANCES GENERALES AERONEF EASY");
  countGligliConnaissanceEasy = questions.length;
  await chargerQuestions("GLIGLI EPREUVE COMMUNE EASY");
  countGligliEpreuveCommuneEasy = questions.length;
  await chargerQuestions("GLIGLI EPREUVE SPECIFIQUE EASY");
  countGligliEpreuveSpecifiqueEasy = questions.length;
  await chargerQuestions("GLIGLI METEOROLOGIE EASY");
  countGligliMeteoEasy = questions.length;
  await chargerQuestions("GLIGLI NAVIGATION EASY");
  countGligliNavigationEasy = questions.length;
  await chargerQuestions("GLIGLI PERFORMANCE HUMAINE EASY");
  countGligliPerfHumaineEasy = questions.length;
  await chargerQuestions("GLIGLI PERFORMANCES PREPARATION VOL EASY");
  countGligliPerfPrepVolEasy = questions.length;
  await chargerQuestions("GLIGLI PRINCIPES DU VOL EASY");
  countGligliPrincipesVolEasy = questions.length;
  await chargerQuestions("GLIGLI PROCEDURES OPERATIONNELLES EASY");
  countGligliProceduresEasy = questions.length;
  await chargerQuestions("GLIGLI REGLEMENTATION EASY");
  countGligliReglementationEasy = questions.length;
  // countGligliAll : charger GLIGLI ALL (dédupliqué) pour obtenir le vrai total unique
  await chargerQuestions("GLIGLI ALL");
  countGligliAll = questions.length;

  // Catégories autres (hors EASA / GLIGLI)
  countAutresAll = countRadio + countOp + countRegl + countConv + countInstr + countMasse + countMotor + countAer;
  
  totalGlobal = countAutresAll + countEasaAll + countGligliAll;
  
  updateCategorySelect();

  // Par défaut, on sélectionne "TOUTES"
  const catSelect = document.getElementById("categorie");
  catSelect.value = "TOUTES";
  selectedCategory = "TOUTES";
  
  // Charger toutes les questions
  await loadAllQuestions();
  
  // Load stored responses so marked flags are available
  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
  if (!uid) {
    console.error('[initIndex] Aucun UID disponible (ni Auth ni cache)');
    return;
  }
  let _dailyHist = {};
  try {
    const docResp = await getDocWithTimeout(db.collection('quizProgress').doc(uid));
    const docData = docResp.exists ? docResp.data() : {};
    currentResponses = normalizeResponses(docData.responses || {});
    // Charger le cache de notes pour le mode "Avec notes"
    _notesCache = docData.notes || {};
    _dailyHist = docData.dailyHistory || {};
  } catch (e) {
    console.warn('[offline] Impossible de charger les réponses Firestore, utilisation du cache local');
    currentResponses = currentResponses || {};
    // Essayer de charger les notes depuis localStorage
    try {
      const lsNotesKey = 'notes_' + uid;
      _notesCache = JSON.parse(localStorage.getItem(lsNotesKey) || '{}');
    } catch (e2) { _notesCache = {}; }
  }
  
  await updateModeCounts();

  // Sélectionner le mode "ratées+non vues" par défaut
  const modeSelect = document.getElementById('mode');
  if (modeSelect) modeSelect.value = 'ratees_nonvues';

  document.getElementById('btnStart').disabled = false;
  
  // Initialiser le checkbox de démarrage automatique
  initAutoStartCheckbox();

  // Restaurer l'état du checkbox correction immédiate
  const corrImm = document.getElementById('correctionImmediateCheckbox');
  if (corrImm) corrImm.checked = localStorage.getItem('correctionImmediate') === '1';

  // Afficher la barre de progression globale sur l'accueil
  displayHomeProgressBar(currentResponses, _dailyHist);

  // Afficher les statistiques du jour
  await displayDailyStats();
}

// Sécurise l'init sur la page quiz en évitant les doublons et les problèmes de timing Auth
if (window.location.pathname.endsWith('quiz.html')) {
  let authTimeout;
  auth.onAuthStateChanged(user => {
    clearTimeout(authTimeout);
    if (user && !quizInitTriggered) {
      localStorage.setItem('cachedUid', user.uid);
      quizInitTriggered = true;
      initQuiz();
    } else if (!user) {
      if (localStorage.getItem('cachedUid') && !quizInitTriggered) {
        // Auth null + UID en cache → démarrer le quiz (navigator.onLine peut mentir)
        console.log('[offline] quiz.html: Auth null, UID en cache, démarrage offline');
        quizInitTriggered = true;
        initQuiz();
      } else if (!localStorage.getItem('cachedUid')) {
        window.location = 'index.html';
      }
    }
  });
  // Sécurité : si auth ne fire pas dans les 3s et qu'on a un cachedUid, démarrer quand même
  authTimeout = setTimeout(() => {
    if (!quizInitTriggered && localStorage.getItem('cachedUid')) {
      console.log('[offline] quiz.html: Auth timeout, démarrage avec cachedUid');
      quizInitTriggered = true;
      initQuiz();
    }
  }, 3000);
}
