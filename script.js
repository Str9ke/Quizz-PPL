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
let countAer = 0;      // ← nouveau compteur pour EASA AERODYNAMIQUE
let countEasaAero = 0; // ← compteur pour EASA AERODYNAMIQUE
let countEasaConnaissance = 0;
let countEasaMeteorologie = 0;
let countEasaPerformance = 0;
let countEasaReglementation = 0;
let countEasaNavigation = 0; // ← compteur pour EASA NAVIGATION
let countEasaPerfHumaines = 0; // ← compteur pour EASA PERFORMANCES HUMAINES
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
  
  totalGlobal = countRadio + countOp + countRegl + countConv +
                countInstr + countMasse + countMotor +
                countEasa + countEasaAero + countEasaNavigation +
                countEasaConnaissance + countEasaMeteorologie +
                countEasaPerformance + countEasaReglementation +
                countEasaPerfHumaines;
  
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
      "PROCÉDURE RADIO","PROCÉDURES OPÉRATIONNELLES","RÉGLEMENTATION",
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
}

/**
 * loadAllQuestions() – Charge toutes les questions de toutes les catégories
 */
async function loadAllQuestions() {
  let allQuestions = [];
  const categories = [
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
    "EASA PERFORMANCES HUMAINES" // Nouvelle catégorie
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
    { value: "EASA PERFORMANCES HUMAINES", display: "EASA PERFORMANCES HUMAINES", count: countEasaPerfHumaines }
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

  // map section_easa_* keys
  if (cat.includes("procedures"))      return "EASA PROCEDURES";
  if (cat.includes("aerodynamique"))   return "EASA AERODYNAMIQUE";
  if (cat.includes("navigation"))      return "EASA NAVIGATION";
  if (cat.includes("connaissance avion"))   return "EASA CONNAISSANCE DE L'AVION";
  if (cat.includes("meteorologie"))    return "EASA METEOROLOGIE";
  if (cat.includes("performance planification")) return "EASA PERFORMANCE ET PLANIFICATION";
  if (cat.includes("reglementation"))  return "EASA REGLEMENTATION";
  if (cat.includes("performances humaines")) return "EASA PERFORMANCES HUMAINES";

  return cat.toUpperCase();
}

function getNormalizedSelectedCategory(selected) {
  if (!selected || selected==="TOUTES") return "TOUTES";
  const s=selected.replace(/_/g,' ').trim().toLowerCase();
  if (s.includes("procedures"))      return "EASA PROCEDURES";
  if (s.includes("aerodynamique"))   return "EASA AERODYNAMIQUE";
  if (s.includes("navigation"))      return "EASA NAVIGATION";
  if (s.includes("connaissance avion"))   return "EASA CONNAISSANCE DE L'AVION";
  if (s.includes("meteorologie"))    return "EASA METEOROLOGIE";
  if (s.includes("performance planification")) return "EASA PERFORMANCE ET PLANIFICATION";
  if (s.includes("reglementation"))  return "EASA REGLEMENTATION";
  if (s.includes("performances humaines")) return "EASA PERFORMANCES HUMAINES";
  return selected.toUpperCase();
}

/**
 * updateModeCounts() – Met à jour le menu "mode" en fonction des statistiques locales et Firebase
 */
async function updateModeCounts() {
    console.log(">>> updateModeCounts()");
    const normalizedSel = getNormalizedSelectedCategory(selectedCategory);
    const list = normalizedSel === "TOUTES"
      ? questions
      : questions.filter(q => q.categorie === normalizedSel);

    let total=0, nbReussies=0, nbRatees=0, nbNonvues=0, nbMarquees=0;
    list.forEach(q => {
      const r = currentResponses[getKeyFor(q)];
      total++;
      if (!r) {
        nbNonvues++;
      } else {
        if (r.status==="réussie") nbReussies++;
        if (r.status==="ratée")   nbRatees++;
        if (r.marked)             nbMarquees++;
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
  // redirect if not logged in
  if (!auth.currentUser) {
    window.location = 'index.html';
    return;
  }

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
    console.log(">>> initQuiz() - Restauration des questions stockées");
    currentQuestions = JSON.parse(stored);
  } else {
    console.log(">>> initQuiz() - Génération de nouvelles questions");
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
        case "TOUTES":
            return;
        default:
            console.warn("Catégorie inconnue:", cat);
            questions = [];
            return;
    }
    try {
        const res = await fetch(fileName);
        questions = res.ok ? await res.json() : [];
        questions.forEach((q, i) => q.id = i + 1);
    } catch {
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
  if (mode === "marquees") {
    currentQuestions = shuffled
      .filter(q => responses[getKeyFor(q)]?.marked)
      .slice(0, nb);
  }
  else if (mode === "toutes") {
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
        marked: newMarked
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

/**
 * afficherBoutonsMarquer() – Affiche les boutons "Marquer/Supprimer" pour chaque question après validation
 */
function afficherBoutonsMarquer() {
  console.log(">>> afficherBoutonsMarquer()");
  const questionBlocks = document.querySelectorAll('.question-block');
  questionBlocks.forEach((block, idx) => {
    // remove any existing mark-button to avoid duplicates
    const existingBtn = block.querySelector('.mark-button, .delete-button');
    if (existingBtn) existingBtn.remove();
    const q   = currentQuestions[idx];
    const key = getKeyFor(q);
    const isMarked = (currentResponses[key] && currentResponses[key].marked === true);
    const btn = document.createElement('button');
    btn.textContent = isMarked ? "Supprimer" : "Marquer";
    btn.className   = isMarked ? "delete-button" : "mark-button";
    btn.onclick     = () => toggleMarquerQuestion(q.id, btn);
    block.appendChild(btn);
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
        const status = sel 
            ? (parseInt(sel.value) === q.bonne_reponse ? 'réussie' : 'ratée') 
            : 'ratée';
        responsesToSave[key] = {
            category: q.categorie,
            questionId: q.id,
            status,
            marked: wasMarked
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
      "PROCÉDURE RADIO",
      "PROCÉDURES OPÉRATIONNELLES",
      "RÉGLEMENTATION",
      "CONNAISSANCE DE L'AVION",
      "INSTRUMENTATION",
      "MASSE ET CENTRAGE",
      "MOTORISATION",
      "EASA PROCEDURES",
      "EASA AERODYNAMIQUE",   // ← inclure ici
      "EASA NAVIGATION",
      "EASA CONNAISSANCE DE L'AVION",
      "EASA METEOROLOGIE",
      "EASA PERFORMANCE ET PLANIFICATION",
      "EASA REGLEMENTATION",
      "EASA PERFORMANCES HUMAINES" // Nouvelle catégorie
    ];

    const statsArr = [];
    for (const cat of categoriesList) {
      await chargerQuestions(cat);
      // Copie locale pour éviter l'écrasement
      const catQuestions = [...questions];
      statsArr.push(computeStatsForFirestore(catQuestions, data.responses));
    }

    // Affiche les stats pour toutes les catégories (spread)
    afficherStats(...statsArr);
  } catch (error) {
    console.error("Erreur lors de la récupération des statistiques :", error);
    afficherStats(
      { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 },
      { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 },
      { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 },
      { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 },
      { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 },
      { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 },
      { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 },
      { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 }
    );
  }
}

/**
 * afficherStats() – Affiche les statistiques sur stats.html, y compris les marquées
 */
function afficherStats(statsRadio, statsOp, statsRegl, statsConv, statsInstr, statsMasse, statsMotor, statsEasa) {
  console.log(">>> afficherStats()");
  const cont = document.getElementById('statsContainer');
  if (!cont) return;

  const totalRadio = statsRadio.reussie + statsRadio.ratee + statsRadio.nonvue + statsRadio.marquee;
  const totalOp = statsOp.reussie + statsOp.ratee + statsOp.nonvue + statsOp.marquee;
  const totalRegl = statsRegl.reussie + statsRegl.ratee + statsRegl.nonvue + statsRegl.marquee;
  const totalConv = statsConv.reussie + statsConv.ratee + statsConv.nonvue + statsConv.marquee;
  const totalInstr = statsInstr.reussie + statsInstr.ratee + statsInstr.nonvue + statsInstr.marquee;
  const totalMasse = statsMasse.reussie + statsMasse.ratee + statsMasse.nonvue + statsMasse.marquee;
  const totalMotor = statsMotor.reussie + statsMotor.ratee + statsMotor.nonvue + statsMotor.marquee;
  const totalEasa = statsEasa.reussie + statsEasa.ratee + statsEasa.nonvue + statsEasa.marquee;
  const totalAer = statsEasa.reussie + statsEasa.ratee + statsEasa.nonvue + statsEasa.marquee; // Utiliser les mêmes stats que EASA AERODYNAMIQUE pour l'instant

  const totalGlobal = totalRadio + totalOp + totalRegl + totalConv + totalInstr + totalMasse + totalMotor + totalEasa;
  const reussiesGlobal = statsRadio.reussie + statsOp.reussie + statsRegl.reussie + statsConv.reussie +
                         statsInstr.reussie + statsMasse.reussie + statsMotor.reussie + statsEasa.reussie;
  const marqueesGlobal = statsRadio.marquee + statsOp.marquee + statsRegl.marquee + statsConv.marquee +
                         statsInstr.marquee + statsMasse.marquee + statsMotor.marquee + statsEasa.marquee;

  let percGlobal = totalGlobal ? Math.round((reussiesGlobal * 100) / totalGlobal) : 0;

  // Ajoute la section EASA PROCEDURES
  cont.innerHTML = `
    <h2>Catégorie : PROCÉDURE RADIO</h2>
    <p>Total : ${totalRadio} questions</p>
    <p>✅ Réussies : ${statsRadio.reussie}</p>
    <p>❌ Ratées : ${statsRadio.ratee}</p>
    <p>👀 Non vues : ${statsRadio.nonvue}</p>
    <p>📌 Marquées : ${statsRadio.marquee}</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>

    <hr>
    <h2>Catégorie : PROCÉDURES OPÉRATIONNELLES</h2>
    <p>Total : ${totalOp} questions</p>
    <p>✅ Réussies : ${statsOp.reussie}</p>
    <p>❌ Ratées : ${statsOp.ratee}</p>
    <p>👀 Non vues : ${statsOp.nonvue}</p>
    <p>📌 Marquées : ${statsOp.marquee}</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>

    <hr>
    <h2>Catégorie : RÉGLEMENTATION</h2>
    <p>Total : ${totalRegl} questions</p>
    <p>✅ Réussies : ${statsRegl.reussie}</p>
    <p>❌ Ratées : ${statsRegl.ratee}</p>
    <p>👀 Non vues : ${statsRegl.nonvue}</p>
    <p>📌 Marquées : ${statsRegl.marquee}</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>

    <hr>
    <h2>Catégorie : CONNAISSANCE DE L'AVION</h2>
    <p>Total : ${totalConv} questions</p>
    <p>✅ Réussies : ${statsConv.reussie}</p>
    <p>❌ Ratées : ${statsConv.ratee}</p>
    <p>👀 Non vues : ${statsConv.nonvue}</p>
    <p>📌 Marquées : ${statsConv.marquee}</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>

    <hr>
    <h2>Catégorie : INSTRUMENTATION</h2>
    <p>Total : ${totalInstr} questions</p>
    <p>✅ Réussies : ${statsInstr.reussie}</p>
    <p>❌ Ratées : ${statsInstr.ratee}</p>
    <p>👀 Non vues : ${statsInstr.nonvue}</p>
    <p>📌 Marquées : ${statsInstr.marquee}</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>

    <hr>
    <h2>Catégorie : MASSE ET CENTRAGE</h2>
    <p>Total : ${totalMasse} questions</p>
    <p>✅ Réussies : ${statsMasse.reussie}</p>
    <p>❌ Ratées : ${statsMasse.ratee}</p>
    <p>👀 Non vues : ${statsMasse.nonvue}</p>
    <p>📌 Marquées : ${statsMasse.marquee}</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>

    <hr>
    <h2>Catégorie : MOTORISATION</h2>
    <p>Total : ${totalMotor} questions</p>
    <p>✅ Réussies : ${statsMotor.reussie}</p>
    <p>❌ Ratées : ${statsMotor.ratee}</p>
    <p>👀 Non vues : ${statsMotor.nonvue}</p>
    <p>📌 Marquées : ${statsMotor.marquee}</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>

    <hr>
    <h2>Catégorie : EASA PROCEDURES</h2>
    <p>Total : ${totalEasa} questions</p>
    <p>✅ Réussies : ${statsEasa.reussie}</p>
    <p>❌ Ratées : ${statsEasa.ratee}</p>
    <p>👀 Non vues : ${statsEasa.nonvue}</p>
    <p>📌 Marquées : ${statsEasa.marquee}</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>

    <hr>
    <h2>Catégorie : EASA AERODYNAMIQUE</h2>
    <p>Total : ${totalEasa} questions</p>
    <p>✅ Réussies : ${statsEasa.reussie}</p>
    <p>❌ Ratées : ${statsEasa.ratee}</p>
    <p>👀 Non vues : ${statsEasa.nonvue}</p>
    <p>📌 Marquées : ${statsEasa.marquee}</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>

    <hr>
    <h2>Catégorie : EASA NAVIGATION</h2>
    <p>Total : ${totalEasa} questions</p>
    <p>✅ Réussies : ${statsEasa.reussie}</p>
    <p>❌ Ratées : ${statsEasa.ratee}</p>
    <p>👀 Non vues : ${statsEasa.nonvue}</p>
    <p>📌 Marquées : ${statsEasa.marquee}</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>

    <hr>
    <h2>Catégorie : EASA CONNAISSANCE AVION</h2>
    <p>Total : ${totalEasa} questions</p>
    <p>✅ Réussies : ${statsEasa.reussie}</p>
    <p>❌ Ratées : ${statsEasa.ratee}</p>
    <p>👀 Non vues : ${statsEasa.nonvue}</p>
    <p>📌 Marquées : ${statsEasa.marquee}</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>

    <hr>
    <h2>Catégorie : EASA METEOROLOGIE</h2>
    <p>Total : ${totalEasa} questions</p>
    <p>✅ Réussies : ${statsEasa.reussie}</p>
    <p>❌ Ratées : ${statsEasa.ratee}</p>
    <p>👀 Non vues : ${statsEasa.nonvue}</p>
    <p>📌 Marquées : ${statsEasa.marquee}</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>

    <hr>
    <h2>Catégorie : EASA PERFORMANCE PLANIFICATION</h2>
    <p>Total : ${totalEasa} questions</p>
    <p>✅ Réussies : ${statsEasa.reussie}</p>
    <p>❌ Ratées : ${statsEasa.ratee}</p>
    <p>👀 Non vues : ${statsEasa.nonvue}</p>
    <p>📌 Marquées : ${statsEasa.marquee}</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>

    <hr>
    <h2>Catégorie : EASA REGLEMENTATION</h2>
    <p>Total : ${totalEasa} questions</p>
    <p>✅ Réussies : ${statsEasa.reussie}</p>
    <p>❌ Ratées : ${statsEasa.ratee}</p>
    <p>👀 Non vues : ${statsEasa.nonvue}</p>
    <p>📌 Marquées : ${statsEasa.marquee}</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>

    <hr>
    <h2>Catégorie : EASA PERFORMANCES HUMAINES</h2>
    <p>Total : ${totalEasa} questions</p>
    <p>✅ Réussies : ${statsEasa.reussie}</p>
    <p>❌ Ratées : ${statsEasa.ratee}</p>
    <p>👀 Non vues : ${statsEasa.nonvue}</p>
    <p>📌 Marquées : ${statsEasa.marquee}</p>
    <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${percGlobal}%;"></div></div>

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
  let nbRatees = 0, nbNonvues = 0, nbMarquees = 0;

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
      });

      const nbRateesNonvues = nbRatees + nbNonvues;

      const modeSelect = document.getElementById('mode');
      modeSelect.innerHTML = `
        <option value="toutes">Toutes (${total})</option>
        <option value="ratees">Ratées (${nbRatees})</option>
        <option value="ratees_nonvues">Ratées+Non vues (${nbRateesNonvues})</option>
        <option value="nonvues">Non vues (${nbNonvues})</option>
        <option value="marquees">Marquées (${nbMarquees})</option>
      `;
    })
    .catch(error => console.error("Erreur lors de la mise à jour des modes :", error));
}

// NEW: Helper to normalize category names for mode counting
function getModeCategory(cat) {
    if (!cat) return "TOUTES";
    const fixed = fixQuotes(cat).replace(/_/g, ' ').trim().toLowerCase();
    if (fixed.indexOf("meteorologie") !== -1) {
        return "EASA METEOROLOGIE";
    } else if (fixed.indexOf("connaissance avion") !== -1) {
        return "EASA CONNAISSANCE DE L'AVION";
    } else if (fixed.indexOf("performance planification") !== -1) {
        return "EASA PERFORMANCE ET PLANIFICATION";
    } else if (fixed.indexOf("reglementation") !== -1) {
        return "EASA REGLEMENTATION";
    } else if (fixed.indexOf("performances humaines") !== -1) {
        return "EASA PERFORMANCES HUMAINES";
    }
    return fixed.toUpperCase();
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
