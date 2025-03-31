// script.js

// Tableaux globaux pour toutes les questions et pour le quiz en cours
let questions = [];
let currentQuestions = [];

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
 * updateModeCounts() – Met à jour le menu "mode" en fonction des statistiques locales
 */
function updateModeCounts() {
  console.log('>>> updateModeCounts()');
  let total = questions.length;
  let nbRatees = 0, nbNonvues = 0;
  questions.forEach(q => {
    const st = localStorage.getItem(getKeyFor(q));
    if (!st) {
      nbNonvues++;
    } else if (st === 'ratée') {
      nbRatees++;
    }
  });
  const nbRateesNonvues = nbRatees + nbNonvues;

  const modeSelect = document.getElementById('mode');
  modeSelect.innerHTML = `
    <option value="toutes">Toutes (${total})</option>
    <option value="ratees">Ratées (${nbRatees})</option>
    <option value="nonvues">Non vues (${nbNonvues})</option>
    <option value="ratees_nonvues">Ratées+Non vues (${nbRateesNonvues})</option>
  `;
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
    const arr = shuffled.filter(q => localStorage.getItem(getKeyFor(q)) === 'ratée');
    currentQuestions = arr.slice(0, nb);
  } else if (mode === "nonvues") {
    const arr = shuffled.filter(q => !localStorage.getItem(getKeyFor(q)));
    currentQuestions = arr.slice(0, nb);
  } else if (mode === "ratees_nonvues") {
    const arr = shuffled.filter(q => {
      const st = localStorage.getItem(getKeyFor(q));
      return (st === 'ratée' || !st);
    });
    currentQuestions = arr.slice(0, nb);
  }
  console.log("    Nombre de questions filtrées:", currentQuestions.length);
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

  currentQuestions.forEach(q => {
    const sel = document.querySelector(`input[name="q${q.id}"]:checked`);
    const key = getKeyFor(q);
    if (sel && parseInt(sel.value) === q.bonne_reponse) {
      localStorage.setItem(key, 'réussie');
      correctCount++;
    } else {
      localStorage.setItem(key, 'ratée');
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
  }

  // Sauvegarder la progression complète dans Firestore
  await sauvegarderProgression();
}

/**
 * computeProgress() – Calcule la progression complète (statistiques) à partir de currentQuestions
 */
function computeProgress() {
  let total = currentQuestions.length;
  let countReussies = 0, countRatees = 0, countNonvues = 0;
  
  currentQuestions.forEach(q => {
    const st = localStorage.getItem(getKeyFor(q));
    if (!st) countNonvues++;
    else if (st === 'réussie') countReussies++;
    else if (st === 'ratée') countRatees++;
  });
  
  return {
    total,
    reussies: countReussies,
    ratees: countRatees,
    nonvues: countNonvues
  };
}

/**
 * sauvegarderProgression() – Enregistre la progression complète (réponses et stats) dans Firestore
 */
async function sauvegarderProgression() {
  let progressData = {
    category: selectedCategory,
    currentQuestionIndex: 0,  // Adaptez cette valeur selon la logique du quiz
    responses: {},
    stats: {}
  };

  currentQuestions.forEach(q => {
    const sel = document.querySelector(`input[name="q${q.id}"]:checked`);
    if (sel) {
      progressData.responses[q.id] = parseInt(sel.value);
    }
  });

  progressData.stats = computeProgress();

  if (!auth.currentUser) {
    console.error("Utilisateur non authentifié, impossible de sauvegarder la progression");
    return;
  }
  const uid = auth.currentUser.uid;
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
    const st = localStorage.getItem(getKeyFor(q));
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

    html += `
      <div class="question-block">
        <div class="question-title">
          ${idx+1}. ${q.question}
          <span style="color:#999;font-size:0.9em;">
            (${st ? st.toUpperCase() : 'NON REPONDU'})
          </span>
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
  return "question_" + q.categorie + "_" + q.id;
}

/**
 * initStats() – Chargé par stats.html pour afficher les statistiques
 */
async function initStats() {
  console.log(">>> initStats()");
  await chargerQuestions("PROCÉDURE RADIO");
  const arrRadio = [...questions];
  
  await chargerQuestions("PROCÉDURES OPÉRATIONNELLES");
  const arrOp = [...questions];
  
  await chargerQuestions("RÉGLEMENTATION");
  const arrRegl = [...questions];
  
  await chargerQuestions("CONNAISSANCE DE L’AVION");
  const arrConv = [...questions];
  
  await chargerQuestions("INSTRUMENTATION");
  const arrInstr = [...questions];
  
  await chargerQuestions("MASSE ET CENTRAGE");
  const arrMasse = [...questions];
  
  await chargerQuestions("MOTORISATION");
  const arrMotor = [...questions];

  afficherStats(arrRadio, arrOp, arrRegl, arrConv, arrInstr, arrMasse, arrMotor);
}

/**
 * afficherStats() – Affiche les statistiques sur stats.html
 */
function afficherStats(radioArr, opArr, reglArr, convArr, instrArr, masseArr, motorArr) {
  console.log(">>> afficherStats()");
  const cont = document.getElementById('statsContainer');
  if (!cont) return;

  const statsRadio = computeStatsFor(radioArr);
  const statsOp = computeStatsFor(opArr);
  const statsRegl = computeStatsFor(reglArr);
  const statsConv = computeStatsFor(convArr);
  const statsInstr = computeStatsFor(instrArr);
  const statsMasse = computeStatsFor(masseArr);
  const statsMotor = computeStatsFor(motorArr);

  const totalRadio = radioArr.length;
  const totalOp = opArr.length;
  const totalRegl = reglArr.length;
  const totalConv = convArr.length;
  const totalInstr = instrArr.length;
  const totalMasse = masseArr.length;
  const totalMotor = motorArr.length;

  const totalGlobal = totalRadio + totalOp + totalRegl + totalConv + totalInstr + totalMasse + totalMotor;
  const reussiesGlobal = statsRadio.reussie + statsOp.reussie + statsRegl.reussie + statsConv.reussie +
                         statsInstr.reussie + statsMasse.reussie + statsMotor.reussie;

  let percRadio = totalRadio ? Math.round((statsRadio.reussie * 100) / totalRadio) : 0;
  let percOp    = totalOp    ? Math.round((statsOp.reussie   * 100) / totalOp)    : 0;
  let percRegl  = totalRegl  ? Math.round((statsRegl.reussie * 100) / totalRegl) : 0;
  let percConv  = totalConv  ? Math.round((statsConv.reussie * 100) / totalConv) : 0;
  let percInstr = totalInstr ? Math.round((statsInstr.reussie * 100) / totalInstr) : 0;
  let percMasse = totalMasse ? Math.round((statsMasse.reussie * 100) / totalMasse) : 0;
  let percMotor = totalMotor ? Math.round((statsMotor.reussie * 100) / totalMotor) : 0;
  let percGlobal= totalGlobal? Math.round((reussiesGlobal * 100) / totalGlobal) : 0;

  cont.innerHTML = `
    <h2>Catégorie : PROCÉDURE RADIO</h2>
    <p>Total : ${totalRadio} questions</p>
    <p>✅ Réussies : ${statsRadio.reussie}</p>
    <p>❌ Ratées : ${statsRadio.ratée}</p>
    <p>👀 Non vues : ${statsRadio.nonvue}</p>
    <div class="progressbar"><div class="progress" style="width:${percRadio}%;"></div></div>

    <hr>
    <h2>Catégorie : PROCÉDURES OPÉRATIONNELLES</h2>
    <p>Total : ${totalOp} questions</p>
    <p>✅ Réussies : ${statsOp.reussie}</p>
    <p>❌ Ratées : ${statsOp.ratée}</p>
    <p>👀 Non vues : ${statsOp.nonvue}</p>
    <div class="progressbar"><div class="progress" style="width:${percOp}%;"></div></div>

    <hr>
    <h2>Catégorie : RÉGLEMENTATION</h2>
    <p>Total : ${totalRegl} questions</p>
    <p>✅ Réussies : ${statsRegl.reussie}</p>
    <p>❌ Ratées : ${statsRegl.ratée}</p>
    <p>👀 Non vues : ${statsRegl.nonvue}</p>
    <div class="progressbar"><div class="progress" style="width:${percRegl}%;"></div></div>

    <hr>
    <h2>Catégorie : CONNAISSANCE DE L’AVION</h2>
    <p>Total : ${totalConv} questions</p>
    <p>✅ Réussies : ${statsConv.reussie}</p>
    <p>❌ Ratées : ${statsConv.ratée}</p>
    <p>👀 Non vues : ${statsConv.nonvue}</p>
    <div class="progressbar"><div class="progress" style="width:${percConv}%;"></div></div>

    <hr>
    <h2>Catégorie : INSTRUMENTATION</h2>
    <p>Total : ${totalInstr} questions</p>
    <p>✅ Réussies : ${statsInstr.reussie}</p>
    <p>❌ Ratées : ${statsInstr.ratée}</p>
    <p>👀 Non vues : ${statsInstr.nonvue}</p>
    <div class="progressbar"><div class="progress" style="width:${percInstr}%;"></div></div>

    <hr>
    <h2>Catégorie : MASSE ET CENTRAGE</h2>
    <p>Total : ${totalMasse} questions</p>
    <p>✅ Réussies : ${statsMasse.reussie}</p>
    <p>❌ Ratées : ${statsMasse.ratée}</p>
    <p>👀 Non vues : ${statsMasse.nonvue}</p>
    <div class="progressbar"><div class="progress" style="width:${percMasse}%;"></div></div>

    <hr>
    <h2>Catégorie : MOTORISATION</h2>
    <p>Total : ${totalMotor} questions</p>
    <p>✅ Réussies : ${statsMotor.reussie}</p>
    <p>❌ Ratées : ${statsMotor.ratée}</p>
    <p>👀 Non vues : ${statsMotor.nonvue}</p>
    <div class="progressbar"><div class="progress" style="width:${percMotor}%;"></div></div>

    <hr>
    <h2>Global</h2>
    <p>Total cumulé : ${totalGlobal}</p>
    <p>Réussies cumulées : ${reussiesGlobal}</p>
    <p>Pourcentage global : ${percGlobal}%</p>
    <div class="progressbar"><div class="progress" style="width:${percGlobal}%;"></div></div>
  `;
}

/**
 * computeStatsFor() – Calcule les statistiques (réussies, ratées, non vues) pour un tableau de questions
 */
function computeStatsFor(arr) {
  let reussie = 0, ratee = 0, nonvue = 0;
  arr.forEach(q => {
    const st = localStorage.getItem(getKeyFor(q));
    if (!st) nonvue++;
    else if (st === 'réussie') reussie++;
    else if (st === 'ratée') ratee++;
  });
  return { reussie, ratée: ratee, nonvue };
}

/**
 * resetStats() – Réinitialise les statistiques stockées dans le localStorage
 */
function resetStats() {
  console.log(">>> resetStats()");
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("question_")) toRemove.push(k);
  }
  toRemove.forEach(k => localStorage.removeItem(k));
  alert("Les stats ont été réinitialisées !");
  window.location.reload();
}

/**
 * getKeyFor(q) – Retourne la clé de stockage pour une question donnée
 */
function getKeyFor(q) {
  return "question_" + q.categorie + "_" + q.id;
}

/**
 * voirStats() – Redirige vers la page des statistiques
 */
function voirStats() {
  window.location = 'stats.html';
}
