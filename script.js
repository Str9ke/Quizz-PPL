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
let totalGlobal = 0;

/**
 * initIndex() – Chargement initial sur index.html
 */
async function initIndex() {
  console.log(">>> initIndex()");
  
  // Charger les questions pour chaque catégorie
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

  totalGlobal = countRadio + countOp + countRegl + countConv + countInstr + countMasse + countMotor;
  
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
    "MOTORISATION"
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

  const categories = [
    { name: "PROCÉDURE RADIO", count: countRadio },
    { name: "PROCÉDURES OPÉRATIONNELLES", count: countOp },
    { name: "RÉGLEMENTATION", count: countRegl },
    { name: "CONNAISSANCE DE L’AVION", count: countConv },
    { name: "INSTRUMENTATION", count: countInstr },
    { name: "MASSE ET CENTRAGE", count: countMasse },
    { name: "MOTORISATION", count: countMotor }
  ];

  categories.forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat.name;
    opt.textContent = `${cat.name} (${cat.count})`;
    catSelect.appendChild(opt);
  });
}

/**
 * categoryChanged() – Charge les questions selon la catégorie sélectionnée
 */
function categoryChanged() {
  const catSelect = document.getElementById("categorie");
  const selected = catSelect.value;
  
  if (selected === "TOUTES") {
    (async function() {
      await loadAllQuestions();
      updateModeCounts();
    })();
  } else {
    (async function() {
      await chargerQuestions(selected);
      updateModeCounts();
    })();
  }
}

/**
 * updateModeCounts() – Met à jour le menu "mode" en fonction des statistiques locales et Firebase
 */
async function updateModeCounts() {
  console.log('>>> updateModeCounts()');
  let total = questions.length;
  let nbRatees = 0, nbNonvues = 0, nbMarquees = 0;

  const uid = auth.currentUser?.uid;
  if (!uid) {
    console.error("Utilisateur non authentifié, impossible de mettre à jour les modes.");
    return;
  }

  try {
    const doc = await db.collection('quizProgress').doc(uid).get();
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
  } catch (error) {
    console.error("Erreur lors de la mise à jour des modes :", error);
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
  let fileName = "";
  if (cat === "PROCÉDURE RADIO") {
    fileName = "questions_procedure_radio.json"; 
  } else if (cat === "PROCÉDURES OPÉRATIONNELLES") {
    fileName = "questions_procedure_operationnelles.json";
  } else if (cat === "RÉGLEMENTATION") {
    fileName = "questions_reglementation.json";
  } else if (cat === "CONNAISSANCE DE L’AVION") {
    fileName = "questions_connaissance_avion.json";
  } else if (cat === "INSTRUMENTATION") {
    fileName = "questions_instrumentation.json";
  } else if (cat === "MASSE ET CENTRAGE") {
    fileName = "questions_masse_et_centrage.json";
  } else if (cat === "MOTORISATION") {
    fileName = "questions_motorisation.json";
  }
  
  try {
    const res = await fetch(fileName);
    if (!res.ok) {
      console.error("Erreur lors du chargement du fichier:", fileName, "status:", res.status);
      questions = [];
      return;
    }
    questions = await res.json();
    console.log("    questions chargées:", questions.length);
  } catch (error) {
    console.error("Erreur fetch pour", fileName, error);
    questions = [];
  }
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

    // Charger toutes les questions pour chaque catégorie
    await chargerQuestions("PROCÉDURE RADIO");
    const statsRadio = computeStatsFor("PROCÉDURE RADIO", data.responses);

    await chargerQuestions("PROCÉDURES OPÉRATIONNELLES");
    const statsOp = computeStatsFor("PROCÉDURES OPÉRATIONNELLES", data.responses);

    await chargerQuestions("RÉGLEMENTATION");
    const statsRegl = computeStatsFor("RÉGLEMENTATION", data.responses);

    await chargerQuestions("CONNAISSANCE DE L’AVION");
    const statsConv = computeStatsFor("CONNAISSANCE DE L’AVION", data.responses);

    await chargerQuestions("INSTRUMENTATION");
    const statsInstr = computeStatsFor("INSTRUMENTATION", data.responses);

    await chargerQuestions("MASSE ET CENTRAGE");
    const statsMasse = computeStatsFor("MASSE ET CENTRAGE", data.responses);

    await chargerQuestions("MOTORISATION");
    const statsMotor = computeStatsFor("MOTORISATION", data.responses);

    // Afficher les statistiques
    afficherStats(statsRadio, statsOp, statsRegl, statsConv, statsInstr, statsMasse, statsMotor);
  } catch (error) {
    console.error("Erreur lors de la récupération des statistiques :", error);
    afficherStats({ reussie: 0, ratee: 0, nonvue: 0, marquee: 0 }, { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 }, { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 }, { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 }, { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 }, { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 }, { reussie: 0, ratee: 0, nonvue: 0, marquee: 0 });
  }
}

/**
 * afficherStats() – Affiche les statistiques sur stats.html, y compris les marquées
 */
function afficherStats(statsRadio, statsOp, statsRegl, statsConv, statsInstr, statsMasse, statsMotor) {
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

  const totalGlobal = totalRadio + totalOp + totalRegl + totalConv + totalInstr + totalMasse + totalMotor;
  const reussiesGlobal = statsRadio.reussie + statsOp.reussie + statsRegl.reussie + statsConv.reussie +
                         statsInstr.reussie + statsMasse.reussie + statsMotor.reussie;
  const marqueesGlobal = statsRadio.marquee + statsOp.marquee + statsRegl.marquee + statsConv.marquee +
                         statsInstr.marquee + statsMasse.marquee + statsMotor.marquee;

  let percGlobal = totalGlobal ? Math.round((reussiesGlobal * 100) / totalGlobal) : 0;

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
    <h2>Catégorie : CONNAISSANCE DE L’AVION</h2>
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
    const checkedVal = document.querySelector(`input[name="q${q.id}"]:checked`)?.value;

    let ansHtml = "";
    q.choix.forEach((choixText, i) => {
      let styleCls = "";
      if (i === q.bonne_reponse) styleCls = "correct";
      else if (checkedVal && parseInt(checkedVal) === i) styleCls = "wrong";

      ansHtml += `<div style="margin-bottom:4px;">
        <span class="${styleCls}">${choixText}</span>
      </div>`;
    });

    const nonReponduHtml = !checkedVal
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
function getKeyFor(q) {
  return `question_${q.categorie}_${q.id}`;
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
