// script.js

// Tableau global pour stocker toutes les questions de la catégorie chargée
let questions = [];
let currentQuestions = [];

let selectedCategory = "PROCÉDURE RADIO"; // Catégorie par défaut
let modeQuiz = "toutes";
let nbQuestions = 10;

// Pour stocker les compteurs par catégorie
const counts = {};

/**
 * initIndex() - s'exécute sur index.html pour charger toutes les catégories et mettre à jour le menu.
 */
async function initIndex() {
  console.log(">>> initIndex()");

  // Charger toutes les catégories pour obtenir les compteurs
  await chargerQuestions("PROCÉDURE RADIO");
  counts["PROCÉDURE RADIO"] = questions.length;

  await chargerQuestions("PROCÉDURES OPÉRATIONNELLES");
  counts["PROCÉDURES OPÉRATIONNELLES"] = questions.length;

  await chargerQuestions("RÉGLEMENTATION");
  counts["RÉGLEMENTATION"] = questions.length;

  await chargerQuestions("CONNAISSANCE DE L’AVION");
  counts["CONNAISSANCE DE L’AVION"] = questions.length;

  await chargerQuestions("INSTRUMENTATION");
  counts["INSTRUMENTATION"] = questions.length;

  await chargerQuestions("MASSE ET CENTRAGE");
  counts["MASSE ET CENTRAGE"] = questions.length;

  await chargerQuestions("MOTORISATION");
  counts["MOTORISATION"] = questions.length;

  // Mettre à jour le sélecteur de catégorie avec le nombre de questions
  const catSelect = document.getElementById('categorie');
  catSelect.innerHTML = `
    <option value="PROCÉDURE RADIO">PROCÉDURE RADIO (${counts["PROCÉDURE RADIO"]})</option>
    <option value="PROCÉDURES OPÉRATIONNELLES">PROCÉDURES OPÉRATIONNELLES (${counts["PROCÉDURES OPÉRATIONNELLES"]})</option>
    <option value="RÉGLEMENTATION">RÉGLEMENTATION (${counts["RÉGLEMENTATION"]})</option>
    <option value="CONNAISSANCE DE L’AVION">CONNAISSANCE DE L’AVION (${counts["CONNAISSANCE DE L’AVION"]})</option>
    <option value="INSTRUMENTATION">INSTRUMENTATION (${counts["INSTRUMENTATION"]})</option>
    <option value="MASSE ET CENTRAGE">MASSE ET CENTRAGE (${counts["MASSE ET CENTRAGE"]})</option>
    <option value="MOTORISATION">MOTORISATION (${counts["MOTORISATION"]})</option>
  `;

  // Lorsque l'utilisateur change de catégorie, recharge les questions et met à jour le mode.
  catSelect.addEventListener('change', async function() {
    selectedCategory = this.value;
    await chargerQuestions(selectedCategory);
    updateModeCounts();
  });

  // Charger la catégorie par défaut
  selectedCategory = "PROCÉDURE RADIO";
  await chargerQuestions(selectedCategory);
  updateModeCounts();

  // Calcul du total global de questions
  const totalGlobal = counts["PROCÉDURE RADIO"] + counts["PROCÉDURES OPÉRATIONNELLES"] +
                      counts["RÉGLEMENTATION"] + counts["CONNAISSANCE DE L’AVION"] +
                      counts["INSTRUMENTATION"] + counts["MASSE ET CENTRAGE"] +
                      counts["MOTORISATION"];
  const p = document.getElementById('totalGlobalInfo');
  p.textContent = `Total de questions (toutes catégories) : ${totalGlobal}`;

  // Activer le bouton de démarrage
  document.getElementById('btnStart').disabled = false;
}

/**
 * updateModeCounts() - met à jour le select "mode" avec le nombre total, ratées, non vues, etc.
 */
function updateModeCounts() {
  console.log('>>> updateModeCounts()');
  let total = questions.length;
  let nbRatees = 0, nbNonvues = 0;
  questions.forEach(q => {
    const st = localStorage.getItem(getKeyFor(q));
    if (!st) nbNonvues++;
    else if (st === 'ratée') nbRatees++;
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
 * demarrerQuiz() - démarre le quiz sur quiz.html
 */
async function demarrerQuiz() {
  console.log(">>> demarrerQuiz()");
  selectedCategory = document.getElementById('categorie').value;
  modeQuiz = document.getElementById('mode').value;
  nbQuestions = parseInt(document.getElementById('nbQuestions').value);

  await chargerQuestions(selectedCategory);
  filtrerQuestions(modeQuiz, nbQuestions);
  localStorage.setItem('quizCategory', selectedCategory);
  localStorage.setItem('currentQuestions', JSON.stringify(currentQuestions));
  window.location = 'quiz.html';
}

/**
 * chargerQuestions(cat) - charge le JSON correspondant à la catégorie
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
    fileName = "questions_masse_centrage.json";
  } else if (cat === "MOTORISATION") {
    fileName = "questions_motorisation.json";
  }
  const res = await fetch(fileName);
  console.log("    fetch effectué, statut=", res.status);
  questions = await res.json();
  console.log("    questions chargées:", questions.length);
}

/**
 * filtrerQuestions(mode, nb) - filtre les questions selon le mode choisi et le nombre souhaité.
 */
function filtrerQuestions(mode, nb) {
  console.log(`>>> filtrerQuestions(mode=${mode}, nb=${nb})`);
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
 * initQuiz() - s'exécute sur quiz.html pour charger et afficher le quiz.
 */
function initQuiz() {
  console.log(">>> initQuiz()");
  selectedCategory = localStorage.getItem('quizCategory') || "PROCÉDURE RADIO";
  chargerQuestions(selectedCategory).then(() => {
    afficherQuiz();
  });
}

/**
 * afficherQuiz() - affiche les questions du quiz sur quiz.html.
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
          ${q.choix.map((c, i) => `
            <label style="display:block;margin-bottom:4px;">
              <input type="radio" name="q${q.id}" value="${i}"> ${c}
            </label>
          `).join('')}
        </div>
      </div>
    `;
  });
}

/**
 * validerReponses() - s'exécute lors du clic sur "Envoyer les réponses".
 */
function validerReponses() {
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
}

/**
 * afficherCorrection() - affiche la correction sur quiz.html.
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
      ansHtml += `<div style="margin-bottom:4px;"><span class="${styleCls}">${choixText}</span></div>`;
    });
    html += `
      <div class="question-block">
        <div class="question-title">
          ${idx+1}. ${q.question}
          <span style="color:#999;font-size:0.9em;">(${st ? st.toUpperCase() : 'NON REPONDU'})</span>
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
 * initStats() - s'exécute sur stats.html pour charger les statistiques de toutes les catégories.
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
 * afficherStats() - affiche les statistiques sur stats.html.
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
  const reussiesGlobal = statsRadio.reussie + statsOp.reussie + statsRegl.reussie +
                         statsConv.reussie + statsInstr.reussie + statsMasse.reussie + statsMotor.reussie;

  let percRadio = totalRadio ? Math.round((statsRadio.reussie * 100) / totalRadio) : 0;
  let percOp    = totalOp ? Math.round((statsOp.reussie * 100) / totalOp) : 0;
  let percRegl  = totalRegl ? Math.round((statsRegl.reussie * 100) / totalRegl) : 0;
  let percConv  = totalConv ? Math.round((statsConv.reussie * 100) / totalConv) : 0;
  let percInstr = totalInstr ? Math.round((statsInstr.reussie * 100) / totalInstr) : 0;
  let percMasse = totalMasse ? Math.round((statsMasse.reussie * 100) / totalMasse) : 0;
  let percMotor = totalMotor ? Math.round((statsMotor.reussie * 100) / totalMotor) : 0;
  let percGlobal = totalGlobal ? Math.round((reussiesGlobal * 100) / totalGlobal) : 0;

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
 * computeStatsFor(arr) - calcule les statistiques pour un tableau de questions
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
 * resetStats() - supprime toutes les clés "question_"
 */
function resetStats() {
  console.log(">>> resetStats()");
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i++){
    const k = localStorage.key(i);
    if (k && k.startsWith("question_")) toRemove.push(k);
  }
  toRemove.forEach(k => localStorage.removeItem(k));
  alert("Les stats ont été réinitialisées !");
  window.location.reload();
}

/**
 * getKeyFor(q) - génère une clé pour chaque question sous la forme "question_CATEGORIE_ID"
 */
function getKeyFor(q) {
  return "question_" + q.categorie + "_" + q.id;
}

/**
 * Divers
 */
function voirStats() {
  window.location = 'stats.html';
}
