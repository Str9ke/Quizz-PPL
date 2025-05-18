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
let totalGlobal = 0;

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
  await chargerQuestions("CONNAISSANCE DE L’AVION");
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
  
  totalGlobal = countRadio + countOp + countRegl + countConv +
                countInstr + countMasse + countMotor +
                countEasa + countEasaAero + countEasaNavigation +
                countEasaConnaissance + countEasaMeteorologie +
                countEasaPerformance + countEasaReglementation;
  
  updateCategorySelect();

  // Par défaut, on sélectionne "TOUTES"
  const catSelect = document.getElementById("categorie");
  catSelect.value = "TOUTES";
  selectedCategory = "TOUTES";
  
  // Charger toutes les questions
  await loadAllQuestions();
  
  updateModeCounts();

  const p = document.getElementById('totalGlobalInfo');
  p.textContent = `Total de questions (toutes catégories) : ${totalGlobal}`;

  document.getElementById('btnStart').disabled = false;

  // Mettre à jour le compteur de catégories
  const categories = [
    "PROCÉDURE RADIO",
    "PROCÉDURES OPÉRATIONNELLES",
    "RÉGLEMENTATION",
    "CONNAISSANCE DE L’AVION",
    "INSTRUMENTATION",
    "MASSE ET CENTRAGE",
    "MOTORISATION",
    "EASA PROCEDURES",
    "EASA AERODYNAMIQUE"   // ← inclure ici
  ];
  const categoryCount = categories.length;
  document.getElementById('categoryCount').textContent = categoryCount;

  // Charger et afficher le nombre de procédures EASA
  fetch('g:\\Questionnaires\\save\\Final\\1\\Quizz-PPL\\section_easa_procedures_new.json')
    .then(resp => resp.json())
    .then(data => {
      const countEasa = data.length;
      categories.find(cat => cat.name === "EASA PROCEDURES").count = countEasa;
      updateCategoryDropdown(); // same function used for other categories
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
    "CONNAISSANCE DE L’AVION",
    "INSTRUMENTATION",
    "MASSE ET CENTRAGE",
    "MOTORISATION",
    "EASA PROCEDURES",
    "EASA AERODYNAMIQUE",
    "EASA NAVIGATION",
    "EASA CONNAISSANCE DE L'AVION",
    "EASA METEOROLOGIE",
    "EASA PERFORMANCE ET PLANIFICATION",
    "EASA REGLEMENTATION"
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
    { value: "CONNAISSANCE DE L’AVION", display: "CONNAISSANCE DE L’AVION", count: countConv },
    { value: "INSTRUMENTATION", display: "INSTRUMENTATION", count: countInstr },
    { value: "MASSE ET CENTRAGE", display: "MASSE ET CENTRAGE", count: countMasse },
    { value: "MOTORISATION", display: "MOTORISATION", count: countMotor },
    { value: "EASA PROCEDURES", display: "EASA PROCEDURES", count: countEasa },
    { value: "EASA AERODYNAMIQUE", display: "EASA AERODYNAMIQUE", count: countEasaAero },
    { value: "EASA NAVIGATION", display: "EASA NAVIGATION", count: countEasaNavigation },
    { value: "EASA CONNAISSANCE DE L'AVION", display: "EASA CONNAISSANCE DE L'AVION", count: countEasaConnaissance },
    { value: "EASA METEOROLOGIE", display: "EASA METEOROLOGIE", count: countEasaMeteorologie },
    { value: "EASA PERFORMANCE ET PLANIFICATION", display: "EASA PERFORMANCE ET PLANIFICATION", count: countEasaPerformance },
    { value: "EASA REGLEMENTATION", display: "EASA REGLEMENTATION", count: countEasaReglementation }
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
  // Unify curly quotes, underscores, casing, etc.
  cat = fixQuotes(cat)
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase();

  // Force these four EASA subcat strings to match JSON data
  if (cat.includes("meteorologie")) return "EASA METEOROLOGIE";
  if (cat.includes("connaissance avion")) return "EASA CONNAISSANCE DE L'AVION";
  if (cat.includes("performance planification")) return "EASA PERFORMANCE ET PLANIFICATION";
  if (cat.includes("reglementation")) return "EASA REGLEMENTATION";
  
  return cat.toUpperCase();
}

// Add an explicit mapping for the four problematic EASA sub‑categories.
const easaMapping = {
  "section_easa_connaissance_avion": "EASA CONNAISSANCE DE L'AVION",
  "section_easa_meteorologie": "EASA METEOROLOGIE",
  "section_easa_performance_planification": "EASA PERFORMANCE ET PLANIFICATION",
  "section_easa_reglementation": "EASA REGLEMENTATION"
};

// For questions stored in Firestore we assume their 'categorie' is already in uppercase.
function getFirestoreCategory(cat) {
  return cat ? cat.trim().toUpperCase() : "";
}

// Return the normalized string for the selected category as used in Firestore keys.
function getNormalizedSelectedCategory(selected) {
  if (!selected || selected === "TOUTES") return "TOUTES";
  // If the selected category is one of the four, use mapping.
  if (selected.startsWith("section_easa_")) {
    return easaMapping[selected] || selected.toUpperCase();
  }
  return selected.toUpperCase();
}

/**
 * updateModeCounts() – Met à jour le menu "mode" en fonction des statistiques locales et Firebase
 */
async function updateModeCounts() {
  console.log(">>> updateModeCounts()");
  const normalizedSel = getNormalizedSelectedCategory(selectedCategory);
  const currentArray = (normalizedSel === "TOUTES")
    ? questions
    : questions.filter(q => q.categorie === normalizedSel);

  const total = currentArray.length;
  let nbReussies = 0, nbRatees = 0, nbMarquees = 0, nbNonvues = 0;
  const uid = auth.currentUser?.uid;
  if (!uid) {
    console.error("Utilisateur non authentifié");
    return;
  }
  try {
    const doc = await db.collection("quizProgress").doc(uid).get();
    const respData = doc.exists ? doc.data().responses : {};
    currentArray.forEach(q => {
      const key = getKeyFor(q);
      const r = respData[key];
      if      (r?.status === "réussie") nbReussies++;
      else if (r?.status === "ratée")   nbRatees++;
      else if (r?.status === "marquée") nbMarquees++;
      else                              nbNonvues++;
    });
    const nbRateesNonvues = nbRatees + nbNonvues;
    document.getElementById("mode").innerHTML = `
      <option value="ratees_nonvues">Ratées+Non vues (${nbRateesNonvues})</option>
      <option value="toutes">Toutes (${total})</option>
      <option value="ratees">Ratées (${nbRatees})</option>
      <option value="nonvues">Non vues (${nbNonvues})</option>
      <option value="reussies">Réussies (${nbReussies})</option>
      <option value="marquees">Marquées (${nbMarquees})</option>
    `;
  } catch (e) {
    console.error("Erreur updateModeCounts:", e);
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

  filtrerQuestions(modeQuiz, nbQuestions);
  localStorage.setItem('quizCategory', selectedCategory);
  localStorage.setItem('currentQuestions', JSON.stringify(currentQuestions));
  window.location = 'quiz.html';
}

/**
 * chargerQuestions() – Charge le fichier JSON correspondant à la catégorie
 */
async function chargerQuestions(cat) {
    console.log(">>> chargerQuestions() cat=", cat);
    // Normalize using our helper so that EASA sub‑categories match exactly
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
        case "CONNAISSANCE DE L’AVION":
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
        case "EASA METEOROLOGIE":
            fileName = "section_easa_meteorologie.json";
            break;
        case "EASA PERFORMANCE ET PLANIFICATION":
            fileName = "section_easa_performance_planification.json";
            break;
        case "EASA CONNAISSANCE DE L'AVION":
            fileName = "section_easa_connaissance_avion.json";
            break;
        case "EASA REGLEMENTATION":
            fileName = "section_easa_reglementation.json";
            break;
        case "TOUTES":
            return;
        default:
            console.warn("Catégorie inconnue:", cat);
            return;
    }
    try {
        const res = await fetch(fileName);
        if (!res.ok) {
            console.error("Erreur HTTP", res.status);
            questions = [];
            return;
        }
        questions = await res.json();
        // Réinitialiser les IDs pour commencer à 1
        questions.forEach((q, i) => q.id = i + 1);
        console.log("    questions chargées:", questions.length);
    } catch (error) {
        console.error("Erreur fetch pour", fileName, error);
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
    "section_easa_reglementation": "section_easa_reglementation.json"
};
// Lors du changement de la sélection, on charge le fichier adéquat
document.getElementById("categorie-select").addEventListener("change", (e) => {
    const selected = e.target.value;
    const filePath = categoryFiles[selected];
    if (filePath) {
        loadQuestions(filePath);
    }
});
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
function filtrerQuestions(mode, nb) {
  console.log('>>> filtrerQuestions(mode=' + mode + ', nb=' + nb + ')');
  if (!questions.length) {
    console.warn("    questions[] est vide");
    currentQuestions = [];
    return;
  }
  const shuffled = [...questions].sort(() => 0.5 - Math.random());

  if (mode === "toutes") {
    currentQuestions = shuffled.slice(0, nb);
  } else if (mode === "ratees") {
    const arr = shuffled.filter(q => {
      const key = `question_${q.categorie}_${q.id}`;
      return currentResponses[key]?.status === 'ratée';
    });
    currentQuestions = arr.slice(0, nb);
  } else if (mode === "nonvues") {
    const arr = shuffled.filter(q => {
      const key = `question_${q.categorie}_${q.id}`;
      return !currentResponses[key];
    });
    currentQuestions = arr.slice(0, nb);
  } else if (mode === "ratees_nonvues") {
    const arr = shuffled.filter(q => {
      const key = `question_${q.categorie}_${q.id}`;
      const status = currentResponses[key]?.status;
      return status === 'ratée' || !status;
    });
    currentQuestions = arr.slice(0, nb);
  } else if (mode === "marquees") {
    const arr = shuffled.filter(q => {
      const key = `question_${q.categorie}_${q.id}`;
      return currentResponses[key]?.status === 'marquée';
    });
    currentQuestions = arr.slice(0, nb);
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

  const key = `question_${question.categorie}_${questionId}`;
  const currentResponse = currentResponses[key] || {}; // Par défaut, vide
  const isMarked = currentResponse.status === 'marquée';

  if (isMarked) {
    // Supprimer la question marquée et restaurer son statut initial (réussie ou ratée)
    const restoredStatus = currentResponse.previousStatus || 'ratée'; // Par défaut, "ratée" si aucune valeur initiale
    db.collection('quizProgress').doc(uid).set(
      {
        responses: {
          [key]: { category: question.categorie, questionId, status: restoredStatus }
        }
      },
      { merge: true }
    )
      .then(() => {
        console.log("Question supprimée des marquées :", key);
        button.textContent = "Marquer";
        button.className = "mark-button";
        currentResponses[key] = { category: question.categorie, questionId, status: restoredStatus };
        updateModeCounts();
      })
      .catch(error => console.error("Erreur lors de la suppression de la question marquée :", error));
  } else {
    // Marquer la question tout en sauvegardant son statut initial
    const previousStatus = currentResponse.status || 'ratée'; // Si aucune réponse, considérer comme "ratée"
    db.collection('quizProgress').doc(uid).set(
      {
        responses: {
          [key]: { category: question.categorie, questionId, previousStatus, status: 'marquée' }
        }
      },
      { merge: true }
    )
      .then(() => {
        console.log("Question marquée :", key);
        button.textContent = "Supprimer";
        button.className = "delete-button";
        currentResponses[key] = { category: question.categorie, questionId, previousStatus, status: 'marquée' };
        updateModeCounts();
      })
      .catch(error => console.error("Erreur lors du marquage de la question :", error));
  }
}

/**
 * afficherBoutonsMarquer() – Affiche les boutons "Marquer/Supprimer" pour chaque question après validation
 */
function afficherBoutonsMarquer() {
  console.log(">>> afficherBoutonsMarquer()");
  const questionBlocks = document.querySelectorAll('.question-block');
  questionBlocks.forEach((block, idx) => {
    const questionId = currentQuestions[idx].id;
    const key = `question_${selectedCategory}_${questionId}`;
    const isMarked = currentResponses[key]?.status === 'marquée';

    const markButton = document.createElement('button');
    markButton.textContent = isMarked ? "Supprimer" : "Marquer";
    markButton.className = isMarked ? "delete-button" : "mark-button";
    markButton.onclick = () => toggleMarquerQuestion(questionId, markButton);
    block.appendChild(markButton);
  });
}

/**
 * initQuiz() – Chargement initial sur quiz.html
 */
async function initQuiz() {
  console.log(">>> initQuiz()");
  const stored = localStorage.getItem('currentQuestions');
  if (stored) {
    currentQuestions = JSON.parse(stored);
    afficherQuiz();
  } else {
    selectedCategory = localStorage.getItem('quizCategory') || "TOUTES";
    if (selectedCategory === "TOUTES") {
      await loadAllQuestions();
    } else {
      await chargerQuestions(selectedCategory);
    }
    afficherQuiz();
  }
}

/**
 * afficherQuiz() – Affiche les questions du quiz sur quiz.html
 */
function afficherQuiz() {
  console.log(">>> afficherQuiz()");
  currentQuestions = JSON.parse(localStorage.getItem('currentQuestions')) || [];
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
  if (!uid) {
    alert("Vous devez être connecté pour sauvegarder votre progression.");
    console.error("Utilisateur non authentifié, impossible de sauvegarder la progression");
    return;
  }

  const responsesToSave = {};

  currentQuestions.forEach(q => {
    const sel = document.querySelector(`input[name="q${q.id}"]:checked`);
    const key = getKeyFor(q);
    const responseData = {
      category: q.categorie,
      questionId: q.id,
      status: sel && parseInt(sel.value) === q.bonne_reponse ? 'réussie' : 'ratée'
    };

    // Si aucune réponse n'est sélectionnée, considérer comme "ratée"
    if (!sel) {
      responseData.status = 'ratée';
    }

    responsesToSave[key] = responseData;

    if (responseData.status === 'réussie') {
      correctCount++;
    }
  });

  afficherCorrection();

  const rc = document.getElementById('resultContainer');
  if (rc) {
    rc.style.display = "block";
    rc.innerHTML = `
      Vous avez <strong>${correctCount}</strong> bonnes réponses 
      sur <strong>${currentQuestions.length}</strong>.
    `;
    // Faire défiler la page vers le haut et ajuster pour Firefox et smartphones
    rc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Sauvegarder les réponses dans Firestore
  try {
    await db.collection('quizProgress').doc(uid).set(
      {
        responses: responsesToSave,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    console.log("Réponses sauvegardées dans Firestore :", responsesToSave);
  } catch (error) {
    console.error("Erreur lors de la sauvegarde des réponses dans Firestore :", error);
  }

  // Désactiver le bouton "Valider les réponses"
  const validateButton = document.querySelector('button[onclick="validerReponses()"]');
  if (validateButton) {
    validateButton.disabled = true;
    validateButton.classList.add('disabled-button');
  }

  // Afficher les boutons "Marquer" après validation
  afficherBoutonsMarquer();
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
      "CONNAISSANCE DE L’AVION",
      "INSTRUMENTATION",
      "MASSE ET CENTRAGE",
      "MOTORISATION",
      "EASA PROCEDURES",
      "EASA AERODYNAMIQUE"   // ← inclure ici
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
async function afficherStats() {
    console.log(">>> afficherStats()");
    const uid = auth.currentUser?.uid;
    if (!uid) {
        console.error("Utilisateur non authentifié");
        return;
    }
    try {
        // Récupérer les réponses Firestore
        const doc = await db.collection("quizProgress").doc(uid).get();
        const responses = doc.exists ? doc.data().responses : {};
        // Définir la liste des catégories EASA pour lesquelles on veut des stats précises
        const easaCategories = [
            "EASA AERODYNAMIQUE",
            "EASA NAVIGATION",
            "EASA CONNAISSANCE DE L'AVION",
            "EASA METEOROLOGIE",
            "EASA PERFORMANCE ET PLANIFICATION",
            "EASA REGLEMENTATION"
        ];
        // Initialiser les compteurs pour chacune
        let easaStats = {};
        easaCategories.forEach(cat => {
            easaStats[cat] = { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 };
        });
        // Parcourir les réponses et incrémenter les compteurs pour les catégories EASA
        for (let key in responses) {
            const res = responses[key];
            const cat = res.categorie ? res.categorie.trim().toUpperCase() : "";
            if (easaStats.hasOwnProperty(cat)) {
                if (res.status === "réussie") easaStats[cat].reussie++;
                else if (res.status === "ratée") easaStats[cat].ratee++;
                else if (res.status === "marquée") easaStats[cat].marquee++;
                else easaStats[cat].nonvue++;
            }
        }
        // Construire l'affichage HTML pour les EASA
        const cont = document.getElementById('statsContainer');
        let html = "";
        easaCategories.forEach(cat => {
            const stats = easaStats[cat];
            const total = stats.reussie + stats.ratee + stats.nonvue + stats.marquee;
            const perc = total ? Math.round((stats.reussie * 100) / total) : 0;
            html += `
                <h2>Catégorie : ${cat}</h2>
                <p>Total : ${total} questions</p>
                <p>✅ Réussies : ${stats.reussie}</p>
                <p>❌ Ratées : ${stats.ratee}</p>
                <p>👀 Non vues : ${stats.nonvue}</p>
                <p>📌 Marquées : ${stats.marquee}</p>
                <div class="progressbar"><div class="progress" style="height: 10px; background-color: yellow; width:${perc}%;"></div></div>
                <hr>
            `;
        });
        // ...existing code for les autres catégories si nécessaire...
        cont.innerHTML = html;
    } catch (e) {
        console.error("Erreur afficherStats:", e);
    }
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
    currentQuestionIndex: 0, // À ajuster selon la logique de reprise
    responses: {},
    stats: {}
  };

  currentQuestions.forEach(q => {
    const sel = document.querySelector(`input[name="q${q.id}"]:checked`);
    if (sel) {
      progressData.responses[q.id] = parseInt(sel.value);
    }
  });

  // Calculer les statistiques complètes
  progressData.stats = computeProgress();

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

  if (typeof auth === 'undefined' || !auth) {
    console.error("Firebase Auth n'est pas initialisé. Vérifiez la configuration Firebase.");
    alert("Erreur : Firebase Auth n'est pas initialisé.");
    return;
  }

  if (!auth.currentUser) {
    alert("Vous devez être connecté pour réinitialiser vos statistiques.");
    console.error("Utilisateur non authentifié, impossible de réinitialiser les statistiques");
    return;
  }

  const uid = auth.currentUser.uid;

  // Supprimer les données locales
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("question_")) toRemove.push(k);
  }
  toRemove.forEach(k => localStorage.removeItem(k));
  console.log("Statistiques locales réinitialisées.");

  // Supprimer les données dans Firestore
  try {
    await db.collection('quizProgress').doc(uid).delete();
    console.log("Statistiques supprimées dans Firestore !");
    alert("Les statistiques ont été réinitialisées !");
    window.location.reload();
  } catch (error) {
    console.error("Erreur lors de la suppression des statistiques dans Firestore :", error);
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
  { name: "CONNAISSANCE DE L’AVION", count: 0 },
  { name: "INSTRUMENTATION", count: 0 },
  { name: "MASSE ET CENTRAGE", count: 0 },
  { name: "MOTORISATION", count: 0 },
  { name: "EASA PROCEDURES", count: 0 },
  { name: "EASA AERODYNAMIQUE", count: 0 },
  { name: "EASA NAVIGATION", count: 0 }
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
        <option value="ratees_nonvues">Ratées+Non vues (${nbRateesNonvues})</option>
        <option value="toutes">Toutes (${total})</option>
        <option value="ratees">Ratées (${nbRatees})</option>
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
    }
    return fixed.toUpperCase();
}

// Force getKeyFor() to use getModeCategory so that keys match
function getKeyFor(q) {
    return `question_${getModeCategory(q.categorie)}_${q.id}`;
}
