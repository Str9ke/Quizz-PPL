// === globals.js === Global state, Firebase refs, counters ===

// Reset le quiz avec les mêmes paramètres (catégorie, mode, nbQuestions, sous-catégorie)
function resetQuiz() {
  const cat = localStorage.getItem('quizCategory') || "TOUTES";
  const mode = localStorage.getItem('quizMode') || "toutes";
  const nb = parseInt(localStorage.getItem('quizNbQuestions')) || 10;
  const sousCat = localStorage.getItem('quizSousCategorie');

  // Sauvegarder les questions du quiz actuel comme "récemment posées"
  // pour éviter qu'elles retombent immédiatement en mode marquées/importantes
  try {
    const prev = localStorage.getItem('currentQuestions');
    if (prev) {
      const prevIds = JSON.parse(prev).map(q => getKeyFor(q));
      localStorage.setItem('recentlyAnsweredKeys', JSON.stringify(prevIds));
    }
  } catch (e) { /* ignore */ }

  localStorage.removeItem('currentQuestions');

  // Décrémenter le compteur de la file de ré-interrogation (reaskQueue)
  try {
    const queue = JSON.parse(localStorage.getItem('reaskQueue') || '[]');
    if (queue.length) {
      queue.forEach(item => { if (item.countdown > 0) item.countdown--; });
      localStorage.setItem('reaskQueue', JSON.stringify(queue));
    }
  } catch (e) { /* ignore */ }

  (async () => {
    try {
      let catNorm = getNormalizedCategory(cat);
      if (catNorm === "TOUTES") {
        await loadAllQuestions();
      } else {
        await chargerQuestions(catNorm);
      }
      await filtrerQuestions(mode, nb);
      localStorage.setItem('currentQuestions', JSON.stringify(currentQuestions));
      if (sousCat) localStorage.setItem('quizSousCategorie', sousCat);
      // Éviter un reload complet (lent offline) : ré-afficher le quiz directement
      if (typeof afficherQuiz === 'function') {
        // Masquer le résultat précédent
        const rc = document.getElementById('resultContainer');
        if (rc) { rc.style.display = 'none'; rc.innerHTML = ''; }
        afficherQuiz();
      } else {
        window.location.reload();
      }
    } catch (e) {
      console.error('[resetQuiz] error:', e);
      window.location.reload();
    }
  })();
}

// Récupérer les variables globales depuis window
const auth = window.auth;
const db = window.db;

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
let quizInitTriggered = false;

const APP_BUILD_TAG = '2024-02-15-quiz-counter-v4';

function showBuildTag(targetId = 'buildInfo') {
  let el = document.getElementById(targetId);
  if (!el) {
    el = document.createElement('div');
    el.id = targetId;
    el.style.cssText = 'text-align:center;font-size:12px;margin:4px;color:var(--text-secondary);';
    const anchor = document.querySelector('h1');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(el, anchor.nextSibling);
    } else {
      document.body.prepend(el);
    }
  }
  el.textContent = `Build: ${APP_BUILD_TAG}`;
}

// Variables de comptage par catégorie
let selectedCategory = "PROCÉDURE RADIO";
let modeQuiz = "toutes";
let nbQuestions = 10;

let countRadio = 0;
let countOp = 0;
let countRegl = 0;
let countConv = 0;
let countInstr = 0;
let countMasse = 0;
let countMotor = 0;
let countEasa = 0;
let countAer = 0;
let countEasaAero = 0;
let countEasaConnaissance = 0;
let countEasaMeteorologie = 0;
let countEasaPerformance = 0;
let countEasaReglementation = 0;
let countEasaNavigation = 0;
let countEasaPerfHumaines = 0;
let countEasaAll = 0;
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
let countGligliAll = 0;
let countAutresAll = 0;
let totalGlobal = 0;
