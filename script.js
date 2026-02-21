// Reset le quiz avec les mêmes paramètres (catégorie, mode, nbQuestions, sous-catégorie)
function resetQuiz() {
  // On relance le quiz avec les mêmes paramètres stockés
  // (catégorie, mode, nbQuestions, sous-catégorie si applicable)
  // Les paramètres sont déjà dans localStorage
  // On refiltre et recharge les questions
  const cat = localStorage.getItem('quizCategory') || "TOUTES";
  const mode = localStorage.getItem('quizMode') || "toutes";
  const nb = parseInt(localStorage.getItem('quizNbQuestions')) || 10;
  // Si une sous-catégorie existe, la conserver
  const sousCat = localStorage.getItem('quizSousCategorie');

  // Nettoyer les réponses précédentes du quiz en cours
  localStorage.removeItem('currentQuestions');
  // Optionnel: nettoyer les réponses utilisateur pour ce quiz
  // (laisser la progression générale intacte)

  // Recharger les questions et relancer le quiz
  (async () => {
    let catNorm = getNormalizedCategory(cat);
    if (catNorm === "TOUTES") {
      await loadAllQuestions();
    } else {
      await chargerQuestions(catNorm);
    }
    await filtrerQuestions(mode, nb);
    localStorage.setItem('currentQuestions', JSON.stringify(currentQuestions));
    // Si sous-catégorie, la remettre
    if (sousCat) localStorage.setItem('quizSousCategorie', sousCat);
    // Recharger la page pour afficher le nouveau quiz
    window.location.reload();
  })();
}
// script.js

// Récupérer les variables globales depuis window
const auth = window.auth;
const db = window.db;

// Vérification de l'initialisation de Firebase Auth et Firestore
if (typeof auth === 'undefined' || !auth) {
  console.error("Firebase Auth n'est pas initialisé. Vérifiez la configuration Firebase.");
  alert("Erreur : Firebase Auth n'est pas initialisé.");
  throw new Error("Firebase Auth n'est pas initialisé.");
}

if (typeof db === 'undefined' || !db) {
  console.error("Firestore n'est pas initialisé. Vérifiez la configuration Firebase.");
  alert("Erreur : Firestore n'est pas initialisé.");
}

// Tableaux globaux pour toutes les questions et pour le quiz en cours
let questions = [];
let currentQuestions = [];
let currentResponses = {};
let quizInitTriggered = false; // évite un double init sur quiz.html

const APP_BUILD_TAG = '2024-02-15-quiz-counter-v4';

function showBuildTag(targetId = 'buildInfo') {
  let el = document.getElementById(targetId);
  if (!el) {
    el = document.createElement('div');
    el.id = targetId;
    el.style.cssText = 'text-align:center;font-size:12px;margin:4px;color:#555;';
    const anchor = document.querySelector('h1');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(el, anchor.nextSibling);
    } else {
      document.body.prepend(el);
    }
  }
  el.textContent = `Build: ${APP_BUILD_TAG}`;
  console.log('[buildTag]', APP_BUILD_TAG);
}

// Variables de configuration initiale
let selectedCategory = "PROCÉDURE RADIO"; // Par défaut
let modeQuiz = "toutes";
let nbQuestions = 10;

// Variables pour compter les questions par catégorie
let countRadio = 0;
let countOp = 0;
let countRegl = 0;
let countConv = 0;
let countInstr = 0;
let countMasse = 0;
let countMotor = 0;
let countEasa = 0;
let countAer = 0;      // compteur pour AERODYNAMIQUE PRINCIPES DU VOL
let countEasaAero = 0; // compteur pour EASA AERODYNAMIQUE
let countEasaConnaissance = 0;
let countEasaMeteorologie = 0;
let countEasaPerformance = 0;
let countEasaReglementation = 0;
let countEasaNavigation = 0; // ← compteur pour EASA NAVIGATION
let countEasaPerfHumaines = 0; // ← compteur pour EASA PERFORMANCES HUMAINES
let countEasaAll = 0; // agrégat toutes EASA
let countGligliComm = 0;
let countGligliConnaissance = 0;
let countGligliEpreuveCommune = 0;
let countGligliEpreuveSpecifique = 0;
let countGligliMeteo = 0;
let countGligliNavigation = 0;
let countGligliPerfHumaine = 0;
let countGligliPerfPrepVol = 0;
let countGligliPrincipesVol = 0;
let countGligliProcedures = 0;
let countGligliReglementation = 0;
let countGligliCommEasy = 0;
let countGligliConnaissanceEasy = 0;
let countGligliEpreuveCommuneEasy = 0;
let countGligliEpreuveSpecifiqueEasy = 0;
let countGligliMeteoEasy = 0;
let countGligliNavigationEasy = 0;
let countGligliPerfHumaineEasy = 0;
let countGligliPerfPrepVolEasy = 0;
let countGligliPrincipesVolEasy = 0;
let countGligliProceduresEasy = 0;
let countGligliReglementationEasy = 0;
let countGligliAll = 0; // agrégat toutes GLIGLI
let countAutresAll = 0; // agrégat hors EASA / GLIGLI
let totalGlobal = 0;

/**
 * Helper: normalize raw Firestore responses into { status, marked }
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

/**
 * displayDailyStats() – Affiche le nombre de questions répondues aujourd'hui
 */
function ensureDailyStatsBarVisible() {
  let statsBar = document.getElementById('dailyStatsBar');
  if (!statsBar) {
    // recrée la barre si jamais absente du DOM
    statsBar = document.createElement('div');
    statsBar.id = 'dailyStatsBar';
    statsBar.style.cssText = 'display:block;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:1rem;border-radius:8px;margin:1rem auto;max-width:600px;text-align:center;box-shadow:0 4px 6px rgba(0,0,0,0.1);';
    statsBar.innerHTML = `
      <div style="font-size:0.9rem;opacity:0.9;">Aujourd'hui</div>
      <div style="font-size:2rem;font-weight:bold;margin:0.5rem 0;" id="answeredTodayCount">…</div>
      <div style="font-size:0.9rem;opacity:0.9;">question(s) répondue(s)</div>
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

async function displayDailyStats(forcedUid) {
  ensureDailyStatsBarVisible();

  // Assure-toi d'avoir un UID (utile si auth.currentUser n'est pas encore prêt)
  let uid = forcedUid || auth.currentUser?.uid;
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
    const doc = await db.collection('quizProgress').doc(uid).get();
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
    
    // Afficher le compteur
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
 * initIndex() – Chargement initial sur index.html
 */
async function initIndex() {
  console.log(">>> initIndex()");
  
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
  countGligliAll = countGligliComm + countGligliConnaissance + countGligliEpreuveCommune + countGligliEpreuveSpecifique + countGligliMeteo + countGligliNavigation + countGligliPerfHumaine + countGligliPerfPrepVol + countGligliPrincipesVol + countGligliProcedures + countGligliReglementation;
  countGligliAll += countGligliCommEasy + countGligliConnaissanceEasy + countGligliEpreuveCommuneEasy + countGligliEpreuveSpecifiqueEasy + countGligliMeteoEasy + countGligliNavigationEasy + countGligliPerfHumaineEasy + countGligliPerfPrepVolEasy + countGligliPrincipesVolEasy + countGligliProceduresEasy + countGligliReglementationEasy;

  // Catégories autres (hors EASA / GLIGLI)
  countAutresAll = countRadio + countOp + countRegl + countConv + countInstr + countMasse + countMotor + countAer;
  
  totalGlobal = countRadio + countOp + countRegl + countConv +
                countInstr + countMasse + countMotor + countAer +
                countEasa + countEasaAero + countEasaNavigation +
                countEasaConnaissance + countEasaMeteorologie +
                countEasaPerformance + countEasaReglementation +
                countEasaPerfHumaines +
                countGligliComm + countGligliConnaissance + countGligliEpreuveCommune +
                countGligliEpreuveSpecifique + countGligliMeteo + countGligliNavigation +
                countGligliPerfHumaine + countGligliPerfPrepVol + countGligliPrincipesVol +
                countGligliProcedures + countGligliReglementation +
                countGligliCommEasy + countGligliConnaissanceEasy + countGligliEpreuveCommuneEasy +
                countGligliEpreuveSpecifiqueEasy + countGligliMeteoEasy + countGligliNavigationEasy +
                countGligliPerfHumaineEasy + countGligliPerfPrepVolEasy + countGligliPrincipesVolEasy +
                countGligliProceduresEasy + countGligliReglementationEasy;
  
  updateCategorySelect();

  // Par défaut, on sélectionne "TOUTES"
  const catSelect = document.getElementById("categorie");
  catSelect.value = "TOUTES";
  selectedCategory = "TOUTES";
  
  // Charger toutes les questions
  await loadAllQuestions();
  
  // Load stored responses so marked flags are available
  const uid = auth.currentUser.uid;
  const docResp = await db.collection('quizProgress').doc(uid).get();
  currentResponses = normalizeResponses(docResp.exists ? docResp.data().responses : {});
  
  updateModeCounts();

  const p = document.getElementById('totalGlobalInfo');
  p.textContent = `Total de questions (toutes catégories) : ${totalGlobal}`;

  document.getElementById('btnStart').disabled = false;
  
  // Initialiser le checkbox de démarrage automatique
  initAutoStartCheckbox();

  // Mettre à jour le compteur de catégories
  const catCountElem = document.getElementById('categoryCount');
  if (catCountElem) {
    const categories = [
      "AERODYNAMIQUE PRINCIPES DU VOL","PROCÉDURE RADIO","PROCÉDURES OPÉRATIONNELLES","RÉGLEMENTATION",
      "CONNAISSANCE DE L'AVION","INSTRUMENTATION","MASSE ET CENTRAGE",
      "MOTORISATION","EASA PROCEDURES","EASA AERODYNAMIQUE"
    ];
    catCountElem.textContent = categories.length;
  }

  // Charger et afficher le nombre de procédures EASA
  fetch('section_easa_procedures_new.json')
    .then(resp => resp.json())
    .then(data => {
      const countEasa = data.length;
      categories.find(cat => cat.name === "EASA PROCEDURES").count = countEasa;
      updateCategorySelect(); // same function used for other categories
    })
    .catch(error => console.error("Erreur lors du chargement des procédures EASA :", error));
  
  // Afficher les statistiques du jour
  await displayDailyStats();
}

/**
 * loadAllQuestions() – Charge toutes les questions de toutes les catégories
 */
async function loadAllQuestions() {
  let allQuestions = [];
  const categories = [
    "AERODYNAMIQUE PRINCIPES DU VOL",
    "PROCÉDURE RADIO",
    "PROCÉDURES OPÉRATIONNELLES",
    "RÉGLEMENTATION",
    "CONNAISSANCE DE L'AVION",
    "INSTRUMENTATION",
    "MASSE ET CENTRAGE",
    "MOTORISATION",
    "EASA PROCEDURES",
    "EASA AERODYNAMIQUE",
    "EASA NAVIGATION",
    "EASA CONNAISSANCE DE L'AVION",
    "EASA METEOROLOGIE",
    "EASA PERFORMANCE ET PLANIFICATION",
    "EASA REGLEMENTATION",
    "EASA PERFORMANCES HUMAINES", // Nouvelle catégorie
    "GLIGLI COMMUNICATIONS HARD",
    "GLIGLI CONNAISSANCES GENERALES AERONEF HARD",
    "GLIGLI EPREUVE COMMUNE HARD",
    "GLIGLI EPREUVE SPECIFIQUE HARD",
    "GLIGLI METEOROLOGIE HARD",
    "GLIGLI NAVIGATION HARD",
    "GLIGLI PERFORMANCE HUMAINE HARD",
    "GLIGLI PERFORMANCES PREPARATION VOL HARD",
    "GLIGLI PRINCIPES DU VOL HARD",
    "GLIGLI PROCEDURES OPERATIONNELLES HARD",
    "GLIGLI REGLEMENTATION HARD",
    "GLIGLI COMMUNICATIONS EASY",
    "GLIGLI CONNAISSANCES GENERALES AERONEF EASY",
    "GLIGLI EPREUVE COMMUNE EASY",
    "GLIGLI EPREUVE SPECIFIQUE EASY",
    "GLIGLI METEOROLOGIE EASY",
    "GLIGLI NAVIGATION EASY",
    "GLIGLI PERFORMANCE HUMAINE EASY",
    "GLIGLI PERFORMANCES PREPARATION VOL EASY",
    "GLIGLI PRINCIPES DU VOL EASY",
    "GLIGLI PROCEDURES OPERATIONNELLES EASY",
    "GLIGLI REGLEMENTATION EASY"
  ];
  for (const cat of categories) {
    await chargerQuestions(cat);
    allQuestions = allQuestions.concat(questions);
  }
  questions = allQuestions;
}

/**
 * updateCategorySelect() – Met à jour le menu déroulant des catégories
 */
function updateCategorySelect() {
  const catSelect = document.getElementById("categorie");
  catSelect.innerHTML = "";

  const optionToutes = document.createElement("option");
  optionToutes.value = "TOUTES";
  optionToutes.textContent = `TOUTES LES QUESTIONS (${totalGlobal})`;
  catSelect.appendChild(optionToutes);

  // Use friendly display names for EASA categories
  const categories = [
    // Mettre les trois catégories agrégées juste après "Toutes"
    { value: "GLIGLI ALL", display: "GLIGLI - TOUTES", count: countGligliAll },
    { value: "AUTRES", display: "AUTRES (hors EASA/GLIGLI)", count: countAutresAll },
    { value: "EASA ALL", display: "EASA - TOUTES", count: countEasaAll },
    // Puis les autres catégories
    { value: "AERODYNAMIQUE PRINCIPES DU VOL", display: "AERODYNAMIQUE PRINCIPES DU VOL", count: countAer },
    { value: "PROCÉDURE RADIO", display: "PROCÉDURE RADIO", count: countRadio },
    { value: "PROCÉDURES OPÉRATIONNELLES", display: "PROCÉDURES OPÉRATIONNELLES", count: countOp },
    { value: "RÉGLEMENTATION", display: "RÉGLEMENTATION", count: countRegl },
    { value: "CONNAISSANCE DE L'AVION", display: "CONNAISSANCE DE L’AVION", count: countConv },
    { value: "INSTRUMENTATION", display: "INSTRUMENTATION", count: countInstr },
    { value: "MASSE ET CENTRAGE", display: "MASSE ET CENTRAGE", count: countMasse },
    { value: "MOTORISATION", display: "MOTORISATION", count: countMotor },
    { value: "EASA PROCEDURES", display: "EASA PROCEDURES", count: countEasa },
    { value: "EASA AERODYNAMIQUE", display: "EASA AERODYNAMIQUE", count: countEasaAero },
    { value: "EASA NAVIGATION", display: "EASA NAVIGATION", count: countEasaNavigation },
    { value: "EASA CONNAISSANCE DE L'AVION", display: "EASA CONNAISSANCE DE L'AVION", count: countEasaConnaissance },
    { value: "EASA METEOROLOGIE", display: "EASA METEOROLOGIE", count: countEasaMeteorologie },
    { value: "EASA PERFORMANCE ET PLANIFICATION", display: "EASA PERFORMANCE ET PLANIFICATION", count: countEasaPerformance },
    { value: "EASA REGLEMENTATION", display: "EASA REGLEMENTATION", count: countEasaReglementation },
    { value: "EASA PERFORMANCES HUMAINES", display: "EASA PERFORMANCES HUMAINES", count: countEasaPerfHumaines },
    { value: "GLIGLI COMMUNICATIONS HARD", display: "GLIGLI COMMUNICATIONS (HARD)", count: countGligliComm },
    { value: "GLIGLI COMMUNICATIONS EASY", display: "GLIGLI COMMUNICATIONS (EASY)", count: countGligliCommEasy },
    { value: "GLIGLI CONNAISSANCES GENERALES AERONEF HARD", display: "GLIGLI CONNAISSANCES GÉNÉRALES AÉRONEF (HARD)", count: countGligliConnaissance },
    { value: "GLIGLI CONNAISSANCES GENERALES AERONEF EASY", display: "GLIGLI CONNAISSANCES GÉNÉRALES AÉRONEF (EASY)", count: countGligliConnaissanceEasy },
    { value: "GLIGLI EPREUVE COMMUNE HARD", display: "GLIGLI ÉPREUVE COMMUNE (HARD)", count: countGligliEpreuveCommune },
    { value: "GLIGLI EPREUVE COMMUNE EASY", display: "GLIGLI ÉPREUVE COMMUNE (EASY)", count: countGligliEpreuveCommuneEasy },
    { value: "GLIGLI EPREUVE SPECIFIQUE HARD", display: "GLIGLI ÉPREUVE SPÉCIFIQUE (HARD)", count: countGligliEpreuveSpecifique },
    { value: "GLIGLI EPREUVE SPECIFIQUE EASY", display: "GLIGLI ÉPREUVE SPÉCIFIQUE (EASY)", count: countGligliEpreuveSpecifiqueEasy },
    { value: "GLIGLI METEOROLOGIE HARD", display: "GLIGLI MÉTÉOROLOGIE (HARD)", count: countGligliMeteo },
    { value: "GLIGLI METEOROLOGIE EASY", display: "GLIGLI MÉTÉOROLOGIE (EASY)", count: countGligliMeteoEasy },
    { value: "GLIGLI NAVIGATION HARD", display: "GLIGLI NAVIGATION (HARD)", count: countGligliNavigation },
    { value: "GLIGLI NAVIGATION EASY", display: "GLIGLI NAVIGATION (EASY)", count: countGligliNavigationEasy },
    { value: "GLIGLI PERFORMANCE HUMAINE HARD", display: "GLIGLI PERFORMANCE HUMAINE (HARD)", count: countGligliPerfHumaine },
    { value: "GLIGLI PERFORMANCE HUMAINE EASY", display: "GLIGLI PERFORMANCE HUMAINE (EASY)", count: countGligliPerfHumaineEasy },
    { value: "GLIGLI PERFORMANCES PREPARATION VOL HARD", display: "GLIGLI PERFORMANCES & PRÉP. VOL (HARD)", count: countGligliPerfPrepVol },
    { value: "GLIGLI PERFORMANCES PREPARATION VOL EASY", display: "GLIGLI PERFORMANCES & PRÉP. VOL (EASY)", count: countGligliPerfPrepVolEasy },
    { value: "GLIGLI PRINCIPES DU VOL HARD", display: "GLIGLI PRINCIPES DU VOL (HARD)", count: countGligliPrincipesVol },
    { value: "GLIGLI PRINCIPES DU VOL EASY", display: "GLIGLI PRINCIPES DU VOL (EASY)", count: countGligliPrincipesVolEasy },
    { value: "GLIGLI PROCEDURES OPERATIONNELLES HARD", display: "GLIGLI PROCÉDURES OPÉRATIONNELLES (HARD)", count: countGligliProcedures },
    { value: "GLIGLI PROCEDURES OPERATIONNELLES EASY", display: "GLIGLI PROCÉDURES OPÉRATIONNELLES (EASY)", count: countGligliProceduresEasy },
    { value: "GLIGLI REGLEMENTATION HARD", display: "GLIGLI RÉGLEMENTATION (HARD)", count: countGligliReglementation },
    { value: "GLIGLI REGLEMENTATION EASY", display: "GLIGLI RÉGLEMENTATION (EASY)", count: countGligliReglementationEasy }
  ];
  
  categories.forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat.value;
    opt.textContent = `${cat.display} (${cat.count})`;
    catSelect.appendChild(opt);
  });
}

/**
 * categoryChanged() – Charge les questions selon la catégorie sélectionnée
 */
async function categoryChanged() {
  const selected = document.getElementById("categorie").value;
  if (selected === "TOUTES") {
    await loadAllQuestions();
  } else {
    await chargerQuestions(selected);
  }
  updateModeCounts();
  document.getElementById("totalGlobalInfo").textContent =
    "Total questions disponibles: " + questions.length;
}

// Replace curly apostrophes etc. with straight apostrophes for consistency
function fixQuotes(str) {
  return str
    .replace(/[‘’]/g, "'")    // fix single quotes
    .replace(/[“”]/g, '"');   // fix double quotes if any
}

function getNormalizedCategory(cat) {
  if (!cat) return "TOUTES";
  cat = fixQuotes(cat).replace(/_/g,' ').trim().toLowerCase();
  const catAscii = cat.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const isGligli = catAscii.includes("gligli");
  const mentionsEasy = catAscii.includes("easy");
  const mentionsHard = catAscii.includes("hard") || (isGligli && !mentionsEasy);

  // GLIGLI agrégées et spécifiques
  if (catAscii.includes("easa") && catAscii.includes("all")) return "EASA ALL";
  if (isGligli && catAscii.includes("all")) return "GLIGLI ALL";
  if (catAscii.includes("autres")) return "AUTRES";

  if (isGligli && mentionsEasy) {
    if (catAscii.includes("communications")) return "GLIGLI COMMUNICATIONS EASY";
    if (catAscii.includes("connaissance") && catAscii.includes("aeronef")) return "GLIGLI CONNAISSANCES GENERALES AERONEF EASY";
    if (catAscii.includes("epreuve") && catAscii.includes("commune")) return "GLIGLI EPREUVE COMMUNE EASY";
    if (catAscii.includes("epreuve") && catAscii.includes("specifique")) return "GLIGLI EPREUVE SPECIFIQUE EASY";
    if (catAscii.includes("meteorologie")) return "GLIGLI METEOROLOGIE EASY";
    if (catAscii.includes("navigation")) return "GLIGLI NAVIGATION EASY";
    if (catAscii.includes("performance") && catAscii.includes("humaine")) return "GLIGLI PERFORMANCE HUMAINE EASY";
    if (catAscii.includes("performances") && catAscii.includes("preparation")) return "GLIGLI PERFORMANCES PREPARATION VOL EASY";
    if (catAscii.includes("principes") && catAscii.includes("vol")) return "GLIGLI PRINCIPES DU VOL EASY";
    if (catAscii.includes("procedure") && catAscii.includes("operationnelle")) return "GLIGLI PROCEDURES OPERATIONNELLES EASY";
    if (catAscii.includes("reglementation")) return "GLIGLI REGLEMENTATION EASY";
  }

  if (isGligli && mentionsHard) {
    if (catAscii.includes("communications")) return "GLIGLI COMMUNICATIONS HARD";
    if (catAscii.includes("connaissance") && catAscii.includes("aeronef")) return "GLIGLI CONNAISSANCES GENERALES AERONEF HARD";
    if (catAscii.includes("epreuve") && catAscii.includes("commune")) return "GLIGLI EPREUVE COMMUNE HARD";
    if (catAscii.includes("epreuve") && catAscii.includes("specifique")) return "GLIGLI EPREUVE SPECIFIQUE HARD";
    if (catAscii.includes("meteorologie")) return "GLIGLI METEOROLOGIE HARD";
    if (catAscii.includes("navigation")) return "GLIGLI NAVIGATION HARD";
    if (catAscii.includes("performance") && catAscii.includes("humaine")) return "GLIGLI PERFORMANCE HUMAINE HARD";
    if (catAscii.includes("performances") && catAscii.includes("preparation")) return "GLIGLI PERFORMANCES PREPARATION VOL HARD";
    if (catAscii.includes("principes") && catAscii.includes("vol")) return "GLIGLI PRINCIPES DU VOL HARD";
    if (catAscii.includes("procedure") && catAscii.includes("operationnelle")) return "GLIGLI PROCEDURES OPERATIONNELLES HARD";
    if (catAscii.includes("reglementation")) return "GLIGLI REGLEMENTATION HARD";
  }

  // EASA explicite
  if (catAscii.includes("easa")) {
    if (catAscii.includes("aerodynamique")) return "EASA AERODYNAMIQUE";
    if (catAscii.includes("navigation")) return "EASA NAVIGATION";
    if (catAscii.includes("connaissance") && catAscii.includes("avion")) return "EASA CONNAISSANCE DE L'AVION";
    if (catAscii.includes("meteorologie")) return "EASA METEOROLOGIE";
    if (catAscii.includes("performance") && catAscii.includes("planification")) return "EASA PERFORMANCE ET PLANIFICATION";
    if (catAscii.includes("reglementation")) return "EASA REGLEMENTATION";
    if (catAscii.includes("performances") && catAscii.includes("humaines")) return "EASA PERFORMANCES HUMAINES";
    if (catAscii.includes("procedures")) return "EASA PROCEDURES";
  }

  // Catégories classiques
  if (catAscii.includes("aerodynamique")) return "AERODYNAMIQUE PRINCIPES DU VOL";
  if (catAscii.includes("procedure") && catAscii.includes("radio")) return "PROCÉDURE RADIO";
  if (catAscii.includes("procedures") && catAscii.includes("operationnelles")) return "PROCÉDURES OPÉRATIONNELLES";
  if (catAscii.includes("reglementation")) return "RÉGLEMENTATION";
  if (catAscii.includes("connaissance") && catAscii.includes("avion")) return "CONNAISSANCE DE L'AVION";
  if (catAscii.includes("instrumentation")) return "INSTRUMENTATION";
  if (catAscii.includes("masse") && catAscii.includes("centrage")) return "MASSE ET CENTRAGE";
  if (catAscii.includes("motorisation")) return "MOTORISATION";

  return cat.toUpperCase();
}

function getNormalizedSelectedCategory(selected) {
  if (!selected || selected==="TOUTES") return "TOUTES";
  const s=selected.replace(/_/g,' ').trim().toLowerCase();
  const sAscii = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isGligli = sAscii.includes("gligli");
  const mentionsEasy = sAscii.includes("easy");
  const mentionsHard = sAscii.includes("hard") || (isGligli && !mentionsEasy);

  if (sAscii.includes("easa") && sAscii.includes("all")) return "EASA ALL";
  if (isGligli && sAscii.includes("all")) return "GLIGLI ALL";
  if (sAscii.includes("autres")) return "AUTRES";

  if (isGligli && mentionsEasy) {
    if (sAscii.includes("communications")) return "GLIGLI COMMUNICATIONS EASY";
    if (sAscii.includes("connaissance") && sAscii.includes("aeronef")) return "GLIGLI CONNAISSANCES GENERALES AERONEF EASY";
    if (sAscii.includes("epreuve") && sAscii.includes("commune")) return "GLIGLI EPREUVE COMMUNE EASY";
    if (sAscii.includes("epreuve") && sAscii.includes("specifique")) return "GLIGLI EPREUVE SPECIFIQUE EASY";
    if (sAscii.includes("meteorologie")) return "GLIGLI METEOROLOGIE EASY";
    if (sAscii.includes("navigation")) return "GLIGLI NAVIGATION EASY";
    if (sAscii.includes("performance") && sAscii.includes("humaine")) return "GLIGLI PERFORMANCE HUMAINE EASY";
    if (sAscii.includes("performances") && sAscii.includes("preparation")) return "GLIGLI PERFORMANCES PREPARATION VOL EASY";
    if (sAscii.includes("principes") && sAscii.includes("vol")) return "GLIGLI PRINCIPES DU VOL EASY";
    if (sAscii.includes("procedure") && sAscii.includes("operationnelle")) return "GLIGLI PROCEDURES OPERATIONNELLES EASY";
    if (sAscii.includes("reglementation")) return "GLIGLI REGLEMENTATION EASY";
  }

  if (isGligli && mentionsHard) {
    if (sAscii.includes("communications")) return "GLIGLI COMMUNICATIONS HARD";
    if (sAscii.includes("connaissance") && sAscii.includes("aeronef")) return "GLIGLI CONNAISSANCES GENERALES AERONEF HARD";
    if (sAscii.includes("epreuve") && sAscii.includes("commune")) return "GLIGLI EPREUVE COMMUNE HARD";
    if (sAscii.includes("epreuve") && sAscii.includes("specifique")) return "GLIGLI EPREUVE SPECIFIQUE HARD";
    if (sAscii.includes("meteorologie")) return "GLIGLI METEOROLOGIE HARD";
    if (sAscii.includes("navigation")) return "GLIGLI NAVIGATION HARD";
    if (sAscii.includes("performance") && sAscii.includes("humaine")) return "GLIGLI PERFORMANCE HUMAINE HARD";
    if (sAscii.includes("performances") && sAscii.includes("preparation")) return "GLIGLI PERFORMANCES PREPARATION VOL HARD";
    if (sAscii.includes("principes") && sAscii.includes("vol")) return "GLIGLI PRINCIPES DU VOL HARD";
    if (sAscii.includes("procedure") && sAscii.includes("operationnelle")) return "GLIGLI PROCEDURES OPERATIONNELLES HARD";
    if (sAscii.includes("reglementation")) return "GLIGLI REGLEMENTATION HARD";
  }

  if (sAscii.includes("easa")) {
    if (sAscii.includes("aerodynamique")) return "EASA AERODYNAMIQUE";
    if (sAscii.includes("navigation")) return "EASA NAVIGATION";
    if (sAscii.includes("connaissance") && sAscii.includes("avion")) return "EASA CONNAISSANCE DE L'AVION";
    if (sAscii.includes("meteorologie")) return "EASA METEOROLOGIE";
    if (sAscii.includes("performance") && sAscii.includes("planification")) return "EASA PERFORMANCE ET PLANIFICATION";
    if (sAscii.includes("reglementation")) return "EASA REGLEMENTATION";
    if (sAscii.includes("performances") && sAscii.includes("humaines")) return "EASA PERFORMANCES HUMAINES";
    if (sAscii.includes("procedures")) return "EASA PROCEDURES";
  }

  if (sAscii.includes("aerodynamique")) return "AERODYNAMIQUE PRINCIPES DU VOL";
  if (sAscii.includes("procedure") && sAscii.includes("radio")) return "PROCÉDURE RADIO";
  if (sAscii.includes("procedures") && sAscii.includes("operationnelles")) return "PROCÉDURES OPÉRATIONNELLES";
  if (sAscii.includes("reglementation")) return "RÉGLEMENTATION";
  if (sAscii.includes("connaissance") && sAscii.includes("avion")) return "CONNAISSANCE DE L'AVION";
  if (sAscii.includes("instrumentation")) return "INSTRUMENTATION";
  if (sAscii.includes("masse") && sAscii.includes("centrage")) return "MASSE ET CENTRAGE";
  if (sAscii.includes("motorisation")) return "MOTORISATION";

  return selected.toUpperCase();
}

/**
 * updateModeCounts() – Met à jour le menu "mode" en fonction des statistiques locales et Firebase
 */
async function updateModeCounts() {
    console.log(">>> updateModeCounts()");
    const normalizedSel = getNormalizedSelectedCategory(selectedCategory);
    // For aggregate categories (EASA ALL, GLIGLI ALL, AUTRES, TOUTES), use all loaded questions
    // because chargerQuestions already loaded the right set with correct individual categories
    const isAggregate = normalizedSel === "TOUTES" || normalizedSel === "EASA ALL" || normalizedSel === "GLIGLI ALL" || normalizedSel === "AUTRES";
    const list = isAggregate
      ? questions
      : questions.filter(q => q.categorie === normalizedSel);

    let total=0, nbReussies=0, nbRatees=0, nbNonvues=0, nbMarquees=0, nbImportantes=0;
    list.forEach(q => {
      const r = currentResponses[getKeyFor(q)];
      total++;
      if (!r) {
        nbNonvues++;
      } else {
        if (r.status==="réussie") nbReussies++;
        if (r.status==="ratée")   nbRatees++;
        if (r.marked)             nbMarquees++;
        if (r.important)          nbImportantes++;
      }
    });

    const modeSelect = document.getElementById("mode");
    if (modeSelect) {
      modeSelect.innerHTML = `
        <option value="toutes">Toutes (${total})</option>
        <option value="ratees">Ratées (${nbRatees})</option>
        <option value="ratees_nonvues">Ratées+Non vues (${nbRatees+nbNonvues})</option>
        <option value="nonvues">Non vues (${nbNonvues})</option>
        <option value="reussies">Réussies (${nbReussies})</option>
        <option value="marquees">Marquées (${nbMarquees})</option>
        <option value="importantes">Importantes (${nbImportantes})</option>
      `;
    }
}

/**
 * demarrerQuiz() – Prépare le quiz et redirige vers quiz.html
 */
async function demarrerQuiz() {
  console.log(">>> demarrerQuiz()");
  selectedCategory = document.getElementById('categorie').value;
  modeQuiz = document.getElementById('mode').value;
  nbQuestions = parseInt(document.getElementById('nbQuestions').value);

  if (selectedCategory === "TOUTES") {
    await loadAllQuestions();
  } else {
    await chargerQuestions(selectedCategory);
  }

  await filtrerQuestions(modeQuiz, nbQuestions);

  // store parameters for quiz page
  localStorage.setItem('quizCategory', selectedCategory);
  localStorage.setItem('quizMode', modeQuiz);
  localStorage.setItem('quizNbQuestions', nbQuestions);
  localStorage.setItem('currentQuestions', JSON.stringify(currentQuestions));

  window.location = 'quiz.html';
}

async function initQuiz() {
  console.log(">>> initQuiz()");
  
  ensureDailyStatsBarVisible();
  showBuildTag();

  // DEBUG détaillé
  console.log('[initQuiz-DEBUG] localStorage.getItem("currentQuestions"):', localStorage.getItem('currentQuestions'));
  console.log('[initQuiz-DEBUG] localStorage.getItem("quizCategory"):', localStorage.getItem('quizCategory'));
  console.log('[initQuiz-DEBUG] localStorage.getItem("quizMode"):', localStorage.getItem('quizMode'));
  console.log('[initQuiz-DEBUG] localStorage.getItem("quizNbQuestions"):', localStorage.getItem('quizNbQuestions'));
  
  // redirect if not logged in
  if (!auth.currentUser) {
    window.location = 'index.html';
    return;
  }

  // ← avoid ReferenceError
  const stored = localStorage.getItem('currentQuestions');
  console.log('[initQuiz-CHECK] stored existe?', !!stored);

  // guard quiz container
  const quizContainer = document.getElementById('quizContainer');
  if (!quizContainer) {
    console.error("quizContainer not found, aborting initQuiz");
    return;
  }

  // restore quiz parameters
  selectedCategory = localStorage.getItem('quizCategory') || "TOUTES";
  modeQuiz        = localStorage.getItem('quizMode')     || "toutes";
  nbQuestions     = parseInt(localStorage.getItem('quizNbQuestions')) || 10;

  if (stored) {
    console.log(">>> initQuiz() - RESTAURATION DES QUESTIONS STOCKÉES (length=" + JSON.parse(stored).length + ")");
    currentQuestions = JSON.parse(stored);
  } else {
    console.log(">>> initQuiz() - GÉNÉRATION DE NOUVELLES QUESTIONS");
    const catNorm = getNormalizedCategory(selectedCategory);
    if (catNorm === "TOUTES") {
      await loadAllQuestions();
    } else {
      await chargerQuestions(catNorm);
    }
    await filtrerQuestions(modeQuiz, nbQuestions);
    console.log('[initQuiz-GENERATED] Nouvelles questions générées (length=' + currentQuestions.length + ')');
    localStorage.setItem('currentQuestions', JSON.stringify(currentQuestions));
  }

  const uid = auth.currentUser.uid;
  const doc = await db.collection('quizProgress').doc(uid).get();
  currentResponses = normalizeResponses(doc.exists ? doc.data().responses : {});
  
  // Afficher les statistiques du jour
  await displayDailyStats(uid);
  
  afficherQuiz();
}

// Guard old unused listener
const oldSelect = document.getElementById("categorie-select");
if (oldSelect) {
  oldSelect.addEventListener("change", e => {
    const filePath = categoryFiles[e.target.value];
    if (filePath) loadQuestions(filePath);
  });
}

/**
 * chargerQuestions() – Charge le fichier JSON correspondant à la catégorie
 */
async function chargerQuestions(cat) {
    const norm = getNormalizedCategory(cat);
    let fileName = "";
  const loadFile = async (fname) => {
    const res = await fetch(fname);
    const data = res.ok ? await res.json() : [];
    return Array.isArray(data) ? data : [];
  };
  const normalizeList = (list, categoryName) => list.map((q, i) => ({
    ...q,
    id: i + 1,
    categorie: categoryName,
    image: q.image || q.image_url || q.imageUrl || null
  }));

    switch (norm) {
        case "PROCÉDURE RADIO":
            fileName = "questions_procedure_radio.json";
            break;
        case "PROCÉDURES OPÉRATIONNELLES":
            fileName = "questions_procedure_operationnelles.json";
            break;
        case "RÉGLEMENTATION":
            fileName = "questions_reglementation.json";
            break;
        case "CONNAISSANCE DE L'AVION":
            fileName = "questions_connaissance_avion.json";
            break;
        case "INSTRUMENTATION":
            fileName = "questions_instrumentation.json";
            break;
        case "MASSE ET CENTRAGE":
            fileName = "questions_masse_et_centrage.json";
            break;
        case "MOTORISATION":
            fileName = "questions_motorisation.json";
            break;
        case "AERODYNAMIQUE PRINCIPES DU VOL":
          fileName = "questions_aerodynamique.json";
          break;
        case "EASA PROCEDURES":
            fileName = "section_easa_procedures_new.json";
            break;
        case "EASA AERODYNAMIQUE":
            fileName = "section_easa_aerodynamique.json";
            break;
        case "EASA NAVIGATION":
            fileName = "section_easa_navigation.json";
            break;
        case "EASA CONNAISSANCE DE L'AVION":
            fileName = "section_easa_connaissance_avion.json";
            break;
        case "EASA METEOROLOGIE":
            fileName = "section_easa_meteorologie.json";
            break;
        case "EASA PERFORMANCE ET PLANIFICATION":
            fileName = "section_easa_performance_planification.json";
            break;
        case "EASA REGLEMENTATION":
            fileName = "section_easa_reglementation.json";
            break;
        case "EASA PERFORMANCES HUMAINES":
            fileName = "section_easa_perf_humaines.json";
            break;
        case "GLIGLI COMMUNICATIONS HARD":
          fileName = "gligli_communications_hard.json";
          break;
        case "GLIGLI CONNAISSANCES GENERALES AERONEF HARD":
          fileName = "gligli_connaissances_generales_aeronef_hard.json";
          break;
        case "GLIGLI EPREUVE COMMUNE HARD":
          fileName = "gligli_epreuve_commune_hard.json";
          break;
        case "GLIGLI EPREUVE SPECIFIQUE HARD":
          fileName = "gligli_epreuve_specifique_hard.json";
          break;
        case "GLIGLI METEOROLOGIE HARD":
          fileName = "gligli_meteorologie_hard.json";
          break;
        case "GLIGLI NAVIGATION HARD":
          fileName = "gligli_navigation_hard.json";
          break;
        case "GLIGLI PERFORMANCE HUMAINE HARD":
          fileName = "gligli_performance_humaine_hard.json";
          break;
        case "GLIGLI PERFORMANCES PREPARATION VOL HARD":
          fileName = "gligli_performances_preparation_vol_hard.json";
          break;
        case "GLIGLI PRINCIPES DU VOL HARD":
          fileName = "gligli_principes_du_vol_hard.json";
          break;
        case "GLIGLI PROCEDURES OPERATIONNELLES HARD":
          fileName = "gligli_procedures_operationnelles_hard.json";
          break;
        case "GLIGLI REGLEMENTATION HARD":
          fileName = "gligli_reglementation_hard.json";
          break;
        case "GLIGLI COMMUNICATIONS EASY":
          fileName = "gligli_communications_easy.json";
          break;
        case "GLIGLI CONNAISSANCES GENERALES AERONEF EASY":
          fileName = "gligli_connaissances_generales_aeronef_easy.json";
          break;
        case "GLIGLI EPREUVE COMMUNE EASY":
          fileName = "gligli_epreuve_commune_easy.json";
          break;
        case "GLIGLI EPREUVE SPECIFIQUE EASY":
          fileName = "gligli_epreuve_specifique_easy.json";
          break;
        case "GLIGLI METEOROLOGIE EASY":
          fileName = "gligli_meteorologie_easy.json";
          break;
        case "GLIGLI NAVIGATION EASY":
          fileName = "gligli_navigation_easy.json";
          break;
        case "GLIGLI PERFORMANCE HUMAINE EASY":
          fileName = "gligli_performance_humaine_easy.json";
          break;
        case "GLIGLI PERFORMANCES PREPARATION VOL EASY":
          fileName = "gligli_performances_preparation_vol_easy.json";
          break;
        case "GLIGLI PRINCIPES DU VOL EASY":
          fileName = "gligli_principes_du_vol_easy.json";
          break;
        case "GLIGLI PROCEDURES OPERATIONNELLES EASY":
          fileName = "gligli_procedures_operationnelles_easy.json";
          break;
        case "GLIGLI REGLEMENTATION EASY":
          fileName = "gligli_reglementation_easy.json";
          break;
        case "EASA ALL": {
          const easaCategories = [
            "EASA PROCEDURES",
            "EASA AERODYNAMIQUE",
            "EASA NAVIGATION",
            "EASA CONNAISSANCE DE L'AVION",
            "EASA METEOROLOGIE",
            "EASA PERFORMANCE ET PLANIFICATION",
            "EASA REGLEMENTATION",
            "EASA PERFORMANCES HUMAINES"
          ];
          try {
            const all = [];
            for (const subCat of easaCategories) {
              await chargerQuestions(subCat);
              all.push(...questions);
            }
            questions = all;
          } catch (err) {
            console.error("Erreur de chargement EASA ALL", err);
            questions = [];
          }
          return;
        }
        case "GLIGLI ALL": {
          const gligliCategories = [
            "GLIGLI COMMUNICATIONS HARD",
            "GLIGLI COMMUNICATIONS EASY",
            "GLIGLI CONNAISSANCES GENERALES AERONEF HARD",
            "GLIGLI CONNAISSANCES GENERALES AERONEF EASY",
            "GLIGLI EPREUVE COMMUNE HARD",
            "GLIGLI EPREUVE COMMUNE EASY",
            "GLIGLI EPREUVE SPECIFIQUE HARD",
            "GLIGLI EPREUVE SPECIFIQUE EASY",
            "GLIGLI METEOROLOGIE HARD",
            "GLIGLI METEOROLOGIE EASY",
            "GLIGLI NAVIGATION HARD",
            "GLIGLI NAVIGATION EASY",
            "GLIGLI PERFORMANCE HUMAINE HARD",
            "GLIGLI PERFORMANCE HUMAINE EASY",
            "GLIGLI PERFORMANCES PREPARATION VOL HARD",
            "GLIGLI PERFORMANCES PREPARATION VOL EASY",
            "GLIGLI PRINCIPES DU VOL HARD",
            "GLIGLI PRINCIPES DU VOL EASY",
            "GLIGLI PROCEDURES OPERATIONNELLES HARD",
            "GLIGLI PROCEDURES OPERATIONNELLES EASY",
            "GLIGLI REGLEMENTATION HARD",
            "GLIGLI REGLEMENTATION EASY"
          ];
          try {
            const all = [];
            for (const subCat of gligliCategories) {
              await chargerQuestions(subCat);
              all.push(...questions);
            }
            questions = all;
          } catch (err) {
            console.error("Erreur de chargement GLIGLI ALL", err);
            questions = [];
          }
          return;
        }
        case "AUTRES": {
          const autresCategories = [
            "PROCÉDURE RADIO",
            "PROCÉDURES OPÉRATIONNELLES",
            "RÉGLEMENTATION",
            "CONNAISSANCE DE L'AVION",
            "INSTRUMENTATION",
            "MASSE ET CENTRAGE",
            "MOTORISATION",
            "AERODYNAMIQUE PRINCIPES DU VOL"
          ];
          try {
            const all = [];
            for (const subCat of autresCategories) {
              await chargerQuestions(subCat);
              all.push(...questions);
            }
            questions = all;
          } catch (err) {
            console.error("Erreur de chargement AUTRES", err);
            questions = [];
          }
          return;
        }
        case "TOUTES":
            return;
        default:
            console.warn("Catégorie inconnue:", cat);
            questions = [];
            return;
    }
    try {
        const res = await fetch(fileName);
        const data = res.ok ? await res.json() : [];
        const normalizedCat = norm;
        questions = Array.isArray(data) ? data.map((q, i) => ({
          ...q,
          id: i + 1,
          categorie: normalizedCat,
          image: q.image || q.image_url || q.imageUrl || null
        })) : [];
      } catch (err) {
        console.error("Erreur de chargement pour", norm, err);
        questions = [];
    }
}

// Update file path mapping to use the JSON files at the server root
const categoryFiles = {
    "section_easa_aerodynamique": "section_easa_aerodynamique.json",
    "section_easa_connaissance_avion": "section_easa_connaissance_avion.json",
    "section_easa_meteorologie": "section_easa_meteorologie.json",
    "section_easa_navigation": "section_easa_navigation.json",
    "section_easa_performance_planification": "section_easa_performance_planification.json",
    "section_easa_reglementation": "section_easa_reglementation.json",
    "section_easa_perf_humaines": "section_easa_perf_humaines.json"
};
// Lors du changement de la sélection, on charge le fichier adéquat
const catSel = document.getElementById("categorie-select");
if (catSel) {
  catSel.addEventListener("change", e => {
    const selected = e.target.value;
    const filePath = categoryFiles[selected];
    if (filePath) {
        loadQuestions(filePath);
    }
  });
}
// Fonction loadQuestions modifiée pour réinitialiser le compteur si besoin
function loadQuestions(file) {
    // ...existing code pour charger le JSON...
    // Par exemple, une fois récupéré le JSON, vous pouvez réinitialiser/valider que chaque question a un id séquentiel :
    // questions.forEach((q, i) => q.id = i+1);
    // ...existing code...
}

/**
 * filtrerQuestions() – Filtre le tableau "questions" selon le mode et le nombre demandé
 */
async function filtrerQuestions(mode, nb) {
  console.log(`>>> filtrerQuestions(mode=${mode}, nb=${nb})`);
  if (!questions.length) {
    console.warn("    questions[] est vide");
    currentQuestions = [];
    return;
  }

  // fetch and normalize up-to-date responses
  const uid = auth.currentUser?.uid;
  let responses = {};
  if (uid) {
    const doc = await db.collection('quizProgress').doc(uid).get();
    responses = normalizeResponses(doc.exists ? doc.data().responses : {});
  }

  const shuffled = [...questions].sort(() => 0.5 - Math.random());
  if (mode === "toutes") {
    currentQuestions = shuffled.slice(0, nb);
  }
  else if (mode === "ratees") {
    currentQuestions = shuffled
      .filter(q => responses[getKeyFor(q)]?.status === 'ratée')
      .slice(0, nb);
  }
  else if (mode === "nonvues") {
    currentQuestions = shuffled
      .filter(q => !responses[getKeyFor(q)])
      .slice(0, nb);
  }
  else if (mode === "ratees_nonvues") {
    currentQuestions = shuffled
      .filter(q => {
         const s = responses[getKeyFor(q)]?.status;
         return s === 'ratée' || !s;
      })
      .slice(0, nb);
  }
  else if (mode === "importantes") {
    currentQuestions = shuffled
      .filter(q => responses[getKeyFor(q)]?.important)
      .slice(0, nb);
  }
  else if (mode === "marquees") {
    currentQuestions = shuffled
      .filter(q => responses[getKeyFor(q)]?.marked)
      .slice(0, nb);
  }

  console.log("    Nombre de questions filtrées:", currentQuestions.length);
}

/**
 * toggleMarquerQuestion() – Marque ou supprime une question marquée tout en conservant son statut initial
 */
function toggleMarquerQuestion(questionId, button) {
  console.log(">>> toggleMarquerQuestion(questionId=" + questionId + ")");
  const uid = auth.currentUser?.uid;
  if (!uid) {
    alert("Vous devez être connecté pour marquer ou supprimer une question.");
    return;
  }

  // Trouver la question dans la liste actuelle pour obtenir sa catégorie correcte
  const question = currentQuestions.find(q => q.id === questionId);
  if (!question) {
    console.error("Question introuvable dans la catégorie sélectionnée.");
    return;
  }

  const key = getKeyFor(question);
  // use local state to preserve status
  const prev = currentResponses[key] || {};
  const newMarked = !prev.marked;
  const payload = {
    responses: {
      [key]: {
        status: prev.status || 'ratée',
        marked: newMarked,
        important: prev.important === true
      }
    }
  };
  db.collection('quizProgress').doc(uid)
    .set(payload, { merge: true })
    .then(() => {
      // update in-memory
      currentResponses[key] = { ...prev, status: prev.status, marked: newMarked };
      // update button text/style
      button.textContent = newMarked ? "Supprimer" : "Marquer";
      button.className   = newMarked ? "delete-button" : "mark-button";
      // refresh counts and global marked counter
      updateModeCounts();
      updateMarkedCount();
    })
    .catch(console.error);
}

function toggleImportantQuestion(questionId, button) {
  console.log(">>> toggleImportantQuestion(questionId=" + questionId + ")");
  const uid = auth.currentUser?.uid;
  if (!uid) {
    alert("Vous devez être connecté pour marquer une question comme importante.");
    return;
  }

  const question = currentQuestions.find(q => q.id === questionId);
  if (!question) {
    console.error("Question introuvable dans la catégorie sélectionnée.");
    return;
  }

  const key = getKeyFor(question);
  const prev = currentResponses[key] || {};
  const newImportant = !prev.important;
  const payload = {
    responses: {
      [key]: {
        status: prev.status || 'ratée',
        marked: prev.marked === true,
        important: newImportant
      }
    }
  };

  db.collection('quizProgress').doc(uid)
    .set(payload, { merge: true })
    .then(() => {
      currentResponses[key] = { ...prev, status: prev.status, marked: prev.marked, important: newImportant };
      button.textContent = newImportant ? "Retirer Important" : "Important";
      button.className   = newImportant ? "unimportant-button" : "important-button";
      updateModeCounts();
      updateMarkedCount();
    })
    .catch(console.error);
}

/**
 * afficherBoutonsMarquer() – Affiche les boutons "Marquer/Supprimer" pour chaque question après validation
 */
function afficherBoutonsMarquer() {
  console.log(">>> afficherBoutonsMarquer()");
  const questionBlocks = document.querySelectorAll('.question-block');
  questionBlocks.forEach((block, idx) => {
    // remove existing action buttons to avoid duplicates
    block.querySelectorAll('.mark-button, .delete-button, .important-button, .unimportant-button').forEach(btn => btn.remove());
    const q   = currentQuestions[idx];
    const key = getKeyFor(q);
    const isMarked = (currentResponses[key] && currentResponses[key].marked === true);
    const isImportant = (currentResponses[key] && currentResponses[key].important === true);
    const btn = document.createElement('button');
    btn.textContent = isMarked ? "Supprimer" : "Marquer";
    btn.className   = isMarked ? "delete-button" : "mark-button";
    btn.onclick     = () => toggleMarquerQuestion(q.id, btn);
    block.appendChild(btn);

    const btnImp = document.createElement('button');
    btnImp.textContent = isImportant ? "Retirer Important" : "Important";
    btnImp.className   = isImportant ? "delete-button" : "mark-button";
    btnImp.style.marginLeft = '8px';
    btnImp.onclick     = () => toggleImportantQuestion(q.id, btnImp);
    block.appendChild(btnImp);
  });
}

/**
 * initQuiz() – Chargement initial sur quiz.html
 */
async function initQuiz() {
  console.log(">>> initQuiz()");
  // redirect if not logged in
  if (!auth.currentUser) {
    window.location = 'index.html';
    return;
  }

  ensureDailyStatsBarVisible();
  showBuildTag();

  // ← avoid ReferenceError
  const stored = localStorage.getItem('currentQuestions');

  // guard quiz container
  const quizContainer = document.getElementById('quizContainer');
  if (!quizContainer) {
    console.error("quizContainer not found, aborting initQuiz");
    return;
  }

  // restore quiz parameters
  selectedCategory = localStorage.getItem('quizCategory') || "TOUTES";
  modeQuiz        = localStorage.getItem('quizMode')     || "toutes";
  nbQuestions     = parseInt(localStorage.getItem('quizNbQuestions')) || 10;

  if (stored) {
    currentQuestions = JSON.parse(stored);
  } else {
    const catNorm = getNormalizedCategory(selectedCategory);
    if (catNorm === "TOUTES") {
      await loadAllQuestions();
    } else {
      await chargerQuestions(catNorm);
    }
    await filtrerQuestions(modeQuiz, nbQuestions);
    localStorage.setItem('currentQuestions', JSON.stringify(currentQuestions));
  }

  const uid = auth.currentUser.uid;
  const doc = await db.collection('quizProgress').doc(uid).get();
  currentResponses = normalizeResponses(doc.exists ? doc.data().responses : {});
  // Affiche le compteur quotidien sur la page du quiz
  await displayDailyStats(auth.currentUser?.uid);
  afficherQuiz();
}

/**
 * afficherQuiz() – Affiche les questions du quiz sur quiz.html
 */
function afficherQuiz() {
  console.log(">>> afficherQuiz()");
  console.log("    currentQuestions=", currentQuestions);

  const cont = document.getElementById('quizContainer');
  if (!cont) return;

  if (!currentQuestions.length) {
    cont.innerHTML = `<p style="color:red;">Aucune question chargée.<br>
      Retournez à l'accueil et cliquez sur «Démarrer le Quiz».</p>`;
    return;
  }

  cont.innerHTML = "";
  currentQuestions.forEach((q, idx) => {
    cont.innerHTML += `
      <div class="question-block">
        <div class="question-title">${idx+1}. ${q.question}</div>
        ${ q.image 
          ? `<div class="question-image">
               <img src="${q.image}" alt="Question ${q.id} illustration" />
             </div>`
          : "" }
        <div class="answer-list">
          ${q.choix.map((c, i) => 
            `<label style="display:block;margin-bottom:4px;">
               <input type="radio" name="q${q.id}" value="${i}"> <span>${c}</span>
             </label>`
          ).join('')}
        </div>
      </div>
    `;
  });

  // Mettre à jour le nombre total de questions
  const totalQuestions = questions.length;
  document.getElementById('totalQuestions').textContent = totalQuestions;

  // restore mark buttons on quiz display
  afficherBoutonsMarquer();
  updateMarkedCount();
}

/**
 * loadQuestion() – Charge une question spécifique par son index
 */
function loadQuestion(index) {
  console.log(">>> loadQuestion(index=" + index + ")");
  const q = currentQuestions[index];
  if (!q) {
    console.error("Question introuvable à l'index " + index);
    return;
  }

  document.getElementById('questionText').textContent = q.question;
  const reponseContainer = document.getElementById('reponseContainer');
  reponseContainer.innerHTML = "";

  q.choix.forEach((choix, i) => {
    const label = document.createElement('label');
    label.style.display = "block";
    label.style.marginBottom = "4px";

    const input = document.createElement('input');
    input.type = "radio";
    input.name = "q" + q.id;
    input.value = i;

    const span = document.createElement('span');
    span.textContent = choix;

    label.appendChild(input);
    label.appendChild(span);
    reponseContainer.appendChild(label);
  });

  // Mettre à jour le numéro de la question actuelle
  document.getElementById('currentQuestionNumber').textContent = index + 1;
}

/**
 * validerReponses() – Traite les réponses de l'utilisateur, affiche la correction et sauvegarde la progression
 */
async function validerReponses() {
    console.log(">>> validerReponses()");
    let correctCount = 0;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    let responsesToSave = {};
    currentQuestions.forEach(q => {
        const sel = document.querySelector(`input[name="q${q.id}"]:checked`);
        const key = getKeyFor(q);
        const wasMarked = currentResponses[key]?.marked === true;
      const wasImportant = currentResponses[key]?.important === true;
        const status = sel 
            ? (parseInt(sel.value) === q.bonne_reponse ? 'réussie' : 'ratée') 
            : 'ratée';
        responsesToSave[key] = {
            category: q.categorie,
            questionId: q.id,
            status,
        marked: wasMarked,
        important: wasImportant,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };
        if (status === 'réussie') correctCount++;
    });

    afficherCorrection();
    const rc = document.getElementById('resultContainer');
    if (rc) {
        rc.style.display = "block";
        rc.innerHTML = `
            Vous avez <strong>${correctCount}</strong> bonnes réponses 
            sur <strong>${currentQuestions.length}</strong>.
        `;
        rc.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    try {
        // fetch all existing responses
        const doc = await db.collection('quizProgress').doc(uid).get();
        const existing = doc.exists ? doc.data().responses : {};
        // merge: preserve old marks/categories for keys not in currentQuestions
        const merged = {};

        Object.keys(responsesToSave).forEach(key => {
            if (existing[key]) {
                merged[key] = { ...existing[key], ...responsesToSave[key] };
            } else {
                merged[key] = responsesToSave[key];
            }
        });

        Object.keys(existing).forEach(key => {
            if (!merged[key]) merged[key] = existing[key];
        });

        await db.collection('quizProgress').doc(uid).set(
            { responses: merged, lastUpdated: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true }
        );
        // re-fetch & normalize
        const fresh = await db.collection('quizProgress').doc(uid).get();
        currentResponses = normalizeResponses(fresh.data().responses);
    } catch (e) {
        console.error("Erreur sauvegarde validerReponses:", e);
    }
    updateModeCounts();
    afficherBoutonsMarquer();
    // mettre à jour le compteur de marquées dans l’interface
    if (typeof updateMarkedCount === 'function') updateMarkedCount();
    // mettre à jour le compteur de questions répondues aujourd'hui
    await displayDailyStats(uid);
}

/**
 * computeStatsFor() – Calcule les statistiques (réussies, ratées, non vues, marquées) pour une catégorie
 */
function computeStatsFor(category, responses) {
  let reussie = 0, ratee = 0, nonvue = 0, marquee = 0;

  // Filtrer les questions par catégorie
  const categoryQuestions = questions.filter(q => q.categorie === category);

  categoryQuestions.forEach(q => {
    const key = `question_${q.categorie}_${q.id}`;
    const response = responses[key];
    if (!response) {
      nonvue++;
    } else if (response.status === 'réussie') {
      reussie++;
    } else if (response.status === 'ratée') {
      ratee++;
    } else if (response.status === 'marquée') {
      marquee++;
    }
  });

  return { reussie, ratee, nonvue, marquee };
}

/**
 * computeStatsForFirestore() – Calcule les stats pour une catégorie à partir des réponses Firestore
 */
function computeStatsForFirestore(categoryQuestions, responses) {
  let reussie = 0, ratee = 0, nonvue = 0, marquee = 0;
  categoryQuestions.forEach(q => {
    const key = getKeyFor(q);
    const r = responses[key] || {};
    // compter toujours réussite/échec/non-vu
    if (r.status === 'réussie')      reussie++;
    else if (r.status === 'ratée')    ratee++;
    else                               nonvue++;
    // marquée en supplément
    if (r.marked)                     marquee++;
  });
  return { reussie, ratee, nonvue, marquee };
}

/**
 * initStats() – Chargement initial sur stats.html pour afficher les statistiques
 */
async function initStats() {
  console.log(">>> initStats()");

  if (typeof auth === 'undefined' || !auth) {
    console.error("Firebase Auth n'est pas initialisé. Vérifiez la configuration Firebase.");
    alert("Erreur : Firebase Auth n'est pas initialisé.");
    return;
  }

  if (!auth.currentUser) {
    console.error("Utilisateur non authentifié, impossible de charger les statistiques");
    window.location = 'index.html';
    return;
  }

  console.log("Utilisateur authentifié :", auth.currentUser.uid);

  const uid = auth.currentUser.uid;

  try {
    const doc = await db.collection('quizProgress').doc(uid).get();
    const data = doc.exists ? doc.data() : { responses: {} };
    console.log("Données récupérées depuis Firestore :", data);

    // Pour chaque catégorie, charge les questions et calcule les stats à partir des réponses Firestore
    const categoriesList = [
      { label: "PROCÉDURE RADIO", value: "PROCÉDURE RADIO" },
      { label: "PROCÉDURES OPÉRATIONNELLES", value: "PROCÉDURES OPÉRATIONNELLES" },
      { label: "RÉGLEMENTATION", value: "RÉGLEMENTATION" },
      { label: "CONNAISSANCE DE L'AVION", value: "CONNAISSANCE DE L'AVION" },
      { label: "INSTRUMENTATION", value: "INSTRUMENTATION" },
      { label: "MASSE ET CENTRAGE", value: "MASSE ET CENTRAGE" },
      { label: "MOTORISATION", value: "MOTORISATION" },
      { label: "AERODYNAMIQUE PRINCIPES DU VOL", value: "AERODYNAMIQUE PRINCIPES DU VOL" },
      { label: "EASA PROCEDURES", value: "EASA PROCEDURES" },
      { label: "EASA AERODYNAMIQUE", value: "EASA AERODYNAMIQUE" },
      { label: "EASA NAVIGATION", value: "EASA NAVIGATION" },
      { label: "EASA CONNAISSANCE DE L'AVION", value: "EASA CONNAISSANCE DE L'AVION" },
      { label: "EASA METEOROLOGIE", value: "EASA METEOROLOGIE" },
      { label: "EASA PERFORMANCE ET PLANIFICATION", value: "EASA PERFORMANCE ET PLANIFICATION" },
      { label: "EASA REGLEMENTATION", value: "EASA REGLEMENTATION" },
      { label: "EASA PERFORMANCES HUMAINES", value: "EASA PERFORMANCES HUMAINES" },
      { label: "EASA - TOUTES", value: "EASA ALL" },
      { label: "GLIGLI COMMUNICATIONS (HARD)", value: "GLIGLI COMMUNICATIONS HARD" },
      { label: "GLIGLI CONNAISSANCES GÉNÉRALES AÉRONEF (HARD)", value: "GLIGLI CONNAISSANCES GENERALES AERONEF HARD" },
      { label: "GLIGLI ÉPREUVE COMMUNE (HARD)", value: "GLIGLI EPREUVE COMMUNE HARD" },
      { label: "GLIGLI ÉPREUVE SPÉCIFIQUE (HARD)", value: "GLIGLI EPREUVE SPECIFIQUE HARD" },
      { label: "GLIGLI MÉTÉOROLOGIE (HARD)", value: "GLIGLI METEOROLOGIE HARD" },
      { label: "GLIGLI NAVIGATION (HARD)", value: "GLIGLI NAVIGATION HARD" },
      { label: "GLIGLI PERFORMANCE HUMAINE (HARD)", value: "GLIGLI PERFORMANCE HUMAINE HARD" },
      { label: "GLIGLI PERFORMANCES & PRÉP. VOL (HARD)", value: "GLIGLI PERFORMANCES PREPARATION VOL HARD" },
      { label: "GLIGLI PRINCIPES DU VOL (HARD)", value: "GLIGLI PRINCIPES DU VOL HARD" },
      { label: "GLIGLI PROCÉDURES OPÉRATIONNELLES (HARD)", value: "GLIGLI PROCEDURES OPERATIONNELLES HARD" },
      { label: "GLIGLI RÉGLEMENTATION (HARD)", value: "GLIGLI REGLEMENTATION HARD" },
      { label: "GLIGLI COMMUNICATIONS (EASY)", value: "GLIGLI COMMUNICATIONS EASY" },
      { label: "GLIGLI CONNAISSANCES GÉNÉRALES AÉRONEF (EASY)", value: "GLIGLI CONNAISSANCES GENERALES AERONEF EASY" },
      { label: "GLIGLI ÉPREUVE COMMUNE (EASY)", value: "GLIGLI EPREUVE COMMUNE EASY" },
      { label: "GLIGLI ÉPREUVE SPÉCIFIQUE (EASY)", value: "GLIGLI EPREUVE SPECIFIQUE EASY" },
      { label: "GLIGLI MÉTÉOROLOGIE (EASY)", value: "GLIGLI METEOROLOGIE EASY" },
      { label: "GLIGLI NAVIGATION (EASY)", value: "GLIGLI NAVIGATION EASY" },
      { label: "GLIGLI PERFORMANCE HUMAINE (EASY)", value: "GLIGLI PERFORMANCE HUMAINE EASY" },
      { label: "GLIGLI PERFORMANCES & PRÉP. VOL (EASY)", value: "GLIGLI PERFORMANCES PREPARATION VOL EASY" },
      { label: "GLIGLI PRINCIPES DU VOL (EASY)", value: "GLIGLI PRINCIPES DU VOL EASY" },
      { label: "GLIGLI PROCÉDURES OPÉRATIONNELLES (EASY)", value: "GLIGLI PROCEDURES OPERATIONNELLES EASY" },
      { label: "GLIGLI RÉGLEMENTATION (EASY)", value: "GLIGLI REGLEMENTATION EASY" },
      { label: "GLIGLI - TOUTES", value: "GLIGLI ALL" },
      { label: "AUTRES (hors EASA/GLIGLI)", value: "AUTRES" }
    ];

    const statsArr = [];
    for (const cat of categoriesList) {
      try {
        await chargerQuestions(cat.value);
        const catQuestions = [...questions];
        statsArr.push({ label: cat.label, stats: computeStatsForFirestore(catQuestions, data.responses) });
      } catch (err) {
        console.error("Stat error for category", cat.value, err);
        statsArr.push({ label: cat.label, stats: { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 } });
      }
    }

    afficherStats(statsArr);
  } catch (error) {
    console.error("Erreur lors de la récupération des statistiques :", error);
    afficherStats([]);
  }
}

/**
 * afficherStats() – Affiche les statistiques sur stats.html, y compris les marquées
 */
function afficherStats(statsList) {
  console.log(">>> afficherStats()", statsList?.length || 0);
  const cont = document.getElementById('statsContainer');
  if (!cont) return;

  if (!Array.isArray(statsList) || statsList.length === 0) {
    cont.innerHTML = '<p>Aucune statistique disponible.</p>';
    return;
  }

  const totals = statsList.map(s => s.stats.reussie + s.stats.ratee + s.stats.nonvue + s.stats.marquee);
  const totalGlobal = totals.reduce((a,b)=>a+b,0);
  const reussiesGlobal = statsList.reduce((a,s)=>a + (s.stats.reussie||0),0);
  const marqueesGlobal = statsList.reduce((a,s)=>a + (s.stats.marquee||0),0);
  const percGlobal = totalGlobal ? Math.round((reussiesGlobal * 100) / totalGlobal) : 0;

  const sections = statsList.map((entry, idx) => {
    const t = totals[idx];
    const perc = t ? Math.round((entry.stats.reussie * 100) / t) : 0;
    return `
      <hr>
      <h2>Catégorie : ${entry.label}</h2>
      <p>Total : ${t} questions</p>
      <p>✅ Réussies : ${entry.stats.reussie}</p>
      <p>❌ Ratées : ${entry.stats.ratee}</p>
      <p>👀 Non vues : ${entry.stats.nonvue}</p>
      <p>📌 Marquées : ${entry.stats.marquee}</p>
      <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${perc}%;"></div></div>
    `;
  }).join('\n');

  cont.innerHTML = `
    ${sections}
    <hr>
    <h2>Global</h2>
    <p>Total cumulé : ${totalGlobal}</p>
    <p>Réussies cumulées : ${reussiesGlobal}</p>
    <p>📌 Marquées cumulées : ${marqueesGlobal}</p>
    <p>Pourcentage global : ${percGlobal}%</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>
  `;
}

/**
 * afficherCorrection() – Affiche la correction sur quiz.html
 */
function afficherCorrection() {
  console.log(">>> afficherCorrection()");
  const cont = document.getElementById('quizContainer');
  if (!cont) return;

  let html = "";
  currentQuestions.forEach((q, idx) => {
    const key = getKeyFor(q);
    const response = currentResponses[key];
    const checkedInput = document.querySelector(`input[name="q${q.id}"]:checked`);
    const checkedVal = checkedInput ? parseInt(checkedInput.value) : null;

    let ansHtml = "";
    q.choix.forEach((choixText, i) => {
      let styleCls = "";
      // Surligne la bonne réponse en vert
      if (i === q.bonne_reponse) {
        styleCls = "correct";
      }
      // Surligne la mauvaise réponse choisie en rouge
      if (checkedVal !== null && checkedVal === i && checkedVal !== q.bonne_reponse) {
        styleCls = "wrong";
      }
      ansHtml += `<div style="margin-bottom:4px;">
        <span class="${styleCls}">${choixText}</span>
      </div>`;
    });

    // Affiche "NON RÉPONDU" si aucune réponse sélectionnée
    const nonReponduHtml = checkedVal === null
      ? `<span style="color:red; font-weight:bold;">NON RÉPONDU</span>`
      : "";

    html += `
      <div class="question-block">
        <div class="question-title">
          ${idx + 1}. ${q.question}
          ${nonReponduHtml}
        </div>
        <div class="answer-list">
          ${ansHtml}
        </div>
      </div>
    `;
  });
  cont.innerHTML = html;

  // re-attach mark buttons on corrected view
  afficherBoutonsMarquer();
  updateMarkedCount();
}

/**
 * getKeyFor(q) – Retourne la clé de stockage pour une question donnée
 */
// Modify getKeyFor() to always use the normalized category so that Firestore keys match
function getKeyFor(q) {
  return `question_${getModeCategory(q.categorie)}_${q.id}`;
}

/**
 * synchroniserStatistiques() – Récupère les données de Firestore et met à jour localStorage
 */
async function synchroniserStatistiques() {
  console.log(">>> synchroniserStatistiques()");

  if (typeof auth === 'undefined' || !auth) {
    console.error("Firebase Auth n'est pas initialisé. Vérifiez la configuration Firebase.");
    alert("Erreur : Firebase Auth n'est pas initialisé.");
    return;
  }

  if (!auth.currentUser) {
    console.error("Utilisateur non authentifié, impossible de synchroniser les statistiques");
    alert("Vous devez être connecté pour synchroniser vos statistiques.");
    return;
  }

  const uid = auth.currentUser.uid;

  try {
    const doc = await db.collection('quizProgress').doc(uid).get();
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
 * sauvegarderProgression() – Enregistre la progression complète (réponses et stats) dans Firestore
 */
async function sauvegarderProgression() {
  console.log(">>> sauvegarderProgression()");

  if (typeof auth === 'undefined' || !auth) {
    console.error("Firebase Auth n'est pas initialisé. Vérifiez la configuration Firebase.");
    alert("Erreur : Firebase Auth n'est pas initialisé.");
    return;
  }

  if (!auth.currentUser) {
    alert("Vous devez être connecté pour sauvegarder votre progression.");
    console.error("Utilisateur non authentifié, impossible de sauvegarder la progression");
    return;
  }

  let progressData = {
    category: selectedCategory,
    currentQuestionIndex: 0 // À ajuster selon la logique de reprise
  };

  const uid = auth.currentUser.uid;
  console.log("Données à sauvegarder :", progressData);

  try {
    await db.collection('quizProgress').doc(uid).set({
      category: progressData.category,
      currentQuestionIndex: progressData.currentQuestionIndex,
      responses: progressData.responses,
      stats: progressData.stats,
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log("Progression complète sauvegardée dans Firestore !");
  } catch (error) {
    console.error("Erreur lors de la sauvegarde de la progression :", error);
    alert("Erreur lors de la sauvegarde de la progression : " + error.message);
  }
}

/**
 * resetStats() – Réinitialise les statistiques stockées dans le localStorage et Firestore
 */
async function resetStats() {
  console.log(">>> resetStats()");
  const uid = auth.currentUser?.uid;
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
      .set({ responses: {}, lastUpdated: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    console.log("Réponses effacées dans Firestore !");
    alert("Les statistiques ont été réinitialisées !");
    window.location.reload();
  } catch (error) {
    console.error("Erreur lors de la réinitialisation des statistiques :", error);
    alert("Erreur lors de la réinitialisation des statistiques : " + error.message);
  }
}

/**
 * voirStats() – Redirige vers la page des statistiques
 */
function voirStats() {
  window.location = 'stats.html';
}

/**
 * afficherProgression() – Récupère et affiche les données sauvegardées pour chaque question
 */
async function afficherProgression() {
  console.log(">>> afficherProgression()");

  if (typeof auth === 'undefined' || !auth) {
    console.error("Firebase Auth n'est pas initialisé. Vérifiez la configuration Firebase.");
    alert("Erreur : Firebase Auth n'est pas initialisé.");
    return;
  }

  if (!auth.currentUser) {
    alert("Vous devez être connecté pour voir votre progression.");
    console.error("Utilisateur non authentifié, impossible de récupérer la progression");
    return;
  }

  const uid = auth.currentUser.uid;

  try {
    const doc = await db.collection('quizProgress').doc(uid).get();
    if (doc.exists) {
      const data = doc.data();
      console.log("Progression récupérée :", data);

      // Afficher les données dans la console ou dans une section dédiée
      const cont = document.getElementById('progressionContainer');
      if (cont) {
        cont.innerHTML = `
          <h2>Progression sauvegardée</h2>
          <pre>${JSON.stringify(data, null, 2)}</pre>
        `;
      } else {
        alert("Progression récupérée. Consultez la console pour les détails.");
      }
    } else {
      console.log("Aucune progression trouvée pour cet utilisateur.");
      alert("Aucune progression trouvée.");
    }
  } catch (error) {
    console.error("Erreur lors de la récupération de la progression :", error);
    alert("Erreur lors de la récupération de la progression : " + error.message);
  }
}

// Réinitialiser les catégories et afficher les catégories et modes
const categories = [
  { name: "PROCÉDURE RADIO", count: 0 },
  { name: "PROCÉDURES OPÉRATIONNELLES", count: 0 },
  { name: "RÉGLEMENTATION", count: 0 },
  { name: "CONNAISSANCE DE L'AVION", count: 0 },
  { name: "INSTRUMENTATION", count: 0 },
  { name: "MASSE ET CENTRAGE", count: 0 },
  { name: "MOTORISATION", count: 0 },
  { name: "AERODYNAMIQUE PRINCIPES DU VOL", count: 0 },
  { name: "EASA PROCEDURES", count: 0 },
  { name: "EASA AERODYNAMIQUE", count: 0 },
  { name: "EASA NAVIGATION", count: 0 },
  { name: "EASA CONNAISSANCE DE L'AVION", count: 0 },
  { name: "EASA METEOROLOGIE", count: 0 },
  { name: "EASA PERFORMANCE ET PLANIFICATION", count: 0 },
  { name: "EASA REGLEMENTATION", count: 0 },
  { name: "EASA PERFORMANCES HUMAINES", count: 0 } // Nouvelle catégorie
];

function displayCategories() {
  const catSelect = document.getElementById("categorie");
  catSelect.innerHTML = "";

  const optionToutes = document.createElement("option");
  optionToutes.value = "TOUTES";
  optionToutes.textContent = `TOUTES LES QUESTIONS (${totalGlobal})`;
  catSelect.appendChild(optionToutes);

  categories.forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat.name;
    opt.textContent = `${cat.name} (${cat.count})`;
    catSelect.appendChild(opt);
  });
}

function displayMode() {
  let total = questions.length;
  let nbRatees = 0, nbNonvues = 0, nbMarquees = 0, nbImportantes = 0;

  const uid = auth.currentUser?.uid;
  if (!uid) {
    console.error("Utilisateur non authentifié, impossible de mettre à jour les modes.");
    return;
  }

  db.collection('quizProgress').doc(uid).get()
    .then(doc => {
      const responses = doc.exists ? doc.data().responses : {};

      questions.forEach(q => {
        const key = `question_${q.categorie}_${q.id}`;
        const response = responses[key];
        if (!response) {
          nbNonvues++;
        } else if (response.status === 'ratée') {
          nbRatees++;
        } else if (response.status === 'marquée') {
          nbMarquees++;
        }
        if (response?.important) {
          nbImportantes++;
        }
      });

      const nbRateesNonvues = nbRatees + nbNonvues;

      const modeSelect = document.getElementById('mode');
      modeSelect.innerHTML = `
        <option value="toutes">Toutes (${total})</option>
        <option value="ratees">Ratées (${nbRatees})</option>
        <option value="ratees_nonvues">Ratées+Non vues (${nbRateesNonvues})</option>
        <option value="nonvues">Non vues (${nbNonvues})</option>
        <option value="marquees">Marquées (${nbMarquees})</option>
        <option value="importantes">Importantes (${nbImportantes})</option>
      `;
    })
    .catch(error => console.error("Erreur lors de la mise à jour des modes :", error));
}

// NEW: Helper to normalize category names for mode counting
function getModeCategory(cat) {
    if (!cat) return "TOUTES";
    // Use the full normalization to get the correct canonical category name
    return getNormalizedCategory(cat);
}

// Force getKeyFor() to use getModeCategory so that keys match
function getKeyFor(q) {
    return `question_${getModeCategory(q.categorie)}_${q.id}`;
}

// Provide a simple placeholder to avoid errors
function updateMarkedCount() {
  // TODO: implement the logic if needed
  console.log("updateMarkedCount called");
}

// Sécurise l'init sur la page quiz en évitant les doublons et les problèmes de timing Auth
if (window.location.pathname.endsWith('quiz.html')) {
  auth.onAuthStateChanged(user => {
    if (user && !quizInitTriggered) {
      quizInitTriggered = true;
      initQuiz();
    }
  });
}
