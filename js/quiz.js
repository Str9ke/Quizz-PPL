// === quiz.js === Quiz display, validation, immediate correction ===

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

  // Sauvegarder le mode correction immédiate
  const corrImm = document.getElementById('correctionImmediateCheckbox');
  localStorage.setItem('correctionImmediate', corrImm && corrImm.checked ? '1' : '0');

  window.location = 'quiz.html';
}

/**
 * toggleMarquerQuestion() – Marque ou supprime une question marquée
 */
function toggleMarquerQuestion(questionId, button) {
  console.log(">>> toggleMarquerQuestion(questionId=" + questionId + ")");
  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
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
    .catch(async (err) => {
      console.warn('[offline] toggleMarquer fallback');
      await saveToggleWithOfflineFallback(uid, key, payload);
      // update in-memory anyway
      currentResponses[key] = { ...prev, status: prev.status, marked: newMarked };
      button.textContent = newMarked ? "Supprimer" : "Marquer";
      button.className   = newMarked ? "delete-button" : "mark-button";
      updateModeCounts();
      updateMarkedCount();
    });
}

function toggleImportantQuestion(questionId, button) {
  console.log(">>> toggleImportantQuestion(questionId=" + questionId + ")");
  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
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
    .catch(async (err) => {
      console.warn('[offline] toggleImportant fallback');
      await saveToggleWithOfflineFallback(uid, key, payload);
      currentResponses[key] = { ...prev, status: prev.status, marked: prev.marked, important: newImportant };
      button.textContent = newImportant ? "Retirer Important" : "Important";
      button.className   = newImportant ? "unimportant-button" : "important-button";
      updateModeCounts();
      updateMarkedCount();
    });
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

async function initQuiz() {
  console.log(">>> initQuiz()");
  // redirect if not logged in (sauf si offline avec UID en cache)
  if (!auth.currentUser && !localStorage.getItem('cachedUid')) {
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
    // Questions déjà en mémoire → pas besoin de prefetch ni de chargerQuestions
    currentQuestions = JSON.parse(stored);
  } else {
    // Pas de questions en mémoire → charger depuis les JSON (prefetch d'abord)
    await prefetchAllJsonFiles();
    const catNorm = getNormalizedCategory(selectedCategory);
    if (catNorm === "TOUTES") {
      await loadAllQuestions();
    } else {
      await chargerQuestions(catNorm);
    }
    await filtrerQuestions(modeQuiz, nbQuestions);
    localStorage.setItem('currentQuestions', JSON.stringify(currentQuestions));
  }

  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');

  // Afficher le quiz IMMÉDIATEMENT sans attendre Firestore (qui peut bloquer 10-15s offline)
  afficherQuiz();

  // Charger les réponses en arrière-plan, puis mettre à jour les boutons marquer/important
  getDocWithTimeout(db.collection('quizProgress').doc(uid)).then(doc => {
    currentResponses = normalizeResponses(doc.exists ? doc.data().responses : {});
    afficherBoutonsMarquer();
    updateMarkedCount();
  }).catch(e => {
    console.warn('[offline] Impossible de charger les réponses:', e.message);
    currentResponses = currentResponses || {};
  });

  // Compteur quotidien en tâche de fond (non bloquant)
  displayDailyStats(uid).catch(e => console.warn('[initQuiz] displayDailyStats error:', e));
}

/**
 * afficherQuiz() – Affiche les questions du quiz sur quiz.html
 */
function afficherQuiz() {
  console.log(">>> afficherQuiz()");
  console.log("    currentQuestions=", currentQuestions);

  // Reset validation state pour le nouveau quiz
  window._quizValidated = false;
  window._immediateAnswers = {};

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

  // Mode correction immédiate : attacher les listeners
  const isImmediate = localStorage.getItem('correctionImmediate') === '1';
  if (isImmediate) {
    window._immediateScore = { correct: 0, answered: 0, total: currentQuestions.length };
    // Ajouter le compteur de score en temps réel
    const scoreDiv = document.createElement('div');
    scoreDiv.id = 'immediateScoreBar';
    scoreDiv.className = 'immediate-score-bar';
    scoreDiv.innerHTML = `Score : <span id="immScoreVal">0</span> / <span id="immScoreTotal">${currentQuestions.length}</span> — <span id="immScoreAnswered">0</span> répondue(s)`;
    cont.insertBefore(scoreDiv, cont.firstChild);

    currentQuestions.forEach(q => {
      const radios = document.querySelectorAll(`input[name="q${q.id}"]`);
      radios.forEach(radio => {
        radio.addEventListener('change', () => handleImmediateAnswer(q, radio));
      });
    });
  }
}

/**
 * handleImmediateAnswer() – Gère la correction immédiate d'une question
 */
function handleImmediateAnswer(q, selectedRadio) {
  const selectedVal = parseInt(selectedRadio.value);
  const isCorrect = selectedVal === q.bonne_reponse;

  // Sauvegarder la réponse en mémoire (pour validerReponses)
  if (!window._immediateAnswers) window._immediateAnswers = {};
  window._immediateAnswers[q.id] = selectedVal;

  // Mettre à jour le score
  window._immediateScore.answered++;
  if (isCorrect) window._immediateScore.correct++;

  const scoreVal = document.getElementById('immScoreVal');
  const scoreAnswered = document.getElementById('immScoreAnswered');
  if (scoreVal) scoreVal.textContent = window._immediateScore.correct;
  if (scoreAnswered) scoreAnswered.textContent = window._immediateScore.answered;

  // Désactiver tous les radios de cette question
  const allRadios = document.querySelectorAll(`input[name="q${q.id}"]`);
  allRadios.forEach(r => {
    r.disabled = true;
    const label = r.closest('label');
    if (!label) return;
    const val = parseInt(r.value);
    if (val === q.bonne_reponse) {
      label.style.background = 'var(--correct-bg, #d4edda)';
      label.style.borderLeft = '4px solid #28a745';
      label.style.paddingLeft = '8px';
      label.style.borderRadius = '4px';
    } else if (val === selectedVal && !isCorrect) {
      label.style.background = 'var(--wrong-bg, #f8d7da)';
      label.style.borderLeft = '4px solid #dc3545';
      label.style.paddingLeft = '8px';
      label.style.borderRadius = '4px';
    }
  });

  // Si toutes les questions sont répondues, afficher un résumé
  if (window._immediateScore.answered === window._immediateScore.total) {
    const pct = Math.round(100 * window._immediateScore.correct / window._immediateScore.total);
    const rc = document.getElementById('resultContainer');
    if (rc) {
      rc.style.display = 'block';
      rc.innerHTML = `Terminé ! <strong>${window._immediateScore.correct}</strong> / <strong>${window._immediateScore.total}</strong> (${pct}%)`;
      rc.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // Sauvegarder automatiquement les réponses
    validerReponses();
  }
}

/**
 * validerReponses() – Traite les réponses de l'utilisateur, affiche la correction et sauvegarde la progression
 */
async function validerReponses() {
    console.log(">>> validerReponses()");
    // Empêcher la double validation
    if (window._quizValidated) {
      console.log('[validerReponses] Déjà validé, ignoré');
      return;
    }
    window._quizValidated = true;

    let correctCount = 0;
    const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
    if (!uid) return;

    // En mode correction immédiate, utiliser les réponses stockées en mémoire
    const isImmediate = localStorage.getItem('correctionImmediate') === '1';
    const immediateAnswers = window._immediateAnswers || {};

    let responsesToSave = {};
    currentQuestions.forEach(q => {
        let selectedVal = null;
        if (isImmediate && immediateAnswers[q.id] !== undefined) {
            selectedVal = immediateAnswers[q.id];
        } else {
            const sel = document.querySelector(`input[name="q${q.id}"]:checked`);
            selectedVal = sel ? parseInt(sel.value) : null;
        }
        const key = getKeyFor(q);
        const hasExisting = !!currentResponses[key];
        const wasMarked = hasExisting ? (currentResponses[key].marked === true) : undefined;
        const wasImportant = hasExisting ? (currentResponses[key].important === true) : undefined;
        const status = selectedVal !== null
            ? (selectedVal === q.bonne_reponse ? 'réussie' : 'ratée')
            : 'ratée';
        const entry = {
            category: q.categorie,
            questionId: q.id,
            status,
            timestamp: firebase.firestore.Timestamp.now()
        };
        // Ne pas écraser marked/important si les réponses Firestore n'ont pas encore chargé
        if (wasMarked !== undefined) entry.marked = wasMarked;
        if (wasImportant !== undefined) entry.important = wasImportant;
        responsesToSave[key] = entry;
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

    // Incrémenter le compteur quotidien direct dans localStorage
    // (fiable même si Firestore n'est pas prêt offline)
    try {
      const dayKey = 'dailyAnswered_' + new Date().toISOString().slice(0, 10);
      const prev = parseInt(localStorage.getItem(dayKey)) || 0;
      const newTotal = prev + currentQuestions.length;
      localStorage.setItem(dayKey, newTotal);
      // Mise à jour DIRECTE du DOM (sans attendre Firestore)
      ensureDailyStatsBarVisible();
      const ratchetKey = 'dailyCountRatchet_' + new Date().toISOString().slice(0, 10);
      const prevRatchet = parseInt(localStorage.getItem(ratchetKey)) || 0;
      const display = Math.max(newTotal, prevRatchet);
      localStorage.setItem(ratchetKey, display);
      const countElem = document.getElementById('answeredTodayCount');
      if (countElem) countElem.textContent = display;
    } catch (e) { /* localStorage plein — rare */ }

    // Sauvegarder la session en localStorage IMMÉDIATEMENT
    // (avant toute opération Firestore qui peut bloquer 10-15s offline)
    const sessionDate = new Date().toISOString();
    if (typeof _saveSessionToLocalBackup === 'function') {
      _saveSessionToLocalBackup(correctCount, currentQuestions.length, selectedCategory, sessionDate);
    }

    try {
        // Sauvegarde avec fallback offline
        currentResponses = await saveResponsesWithOfflineFallback(uid, responsesToSave);

        // Sauvegarder le compteur quotidien
        await saveDailyCountOffline(uid, currentQuestions.length);
        // Sauvegarder le résultat de la session (avec la même date pour déduplication)
        await saveSessionResultOffline(uid, correctCount, currentQuestions.length, selectedCategory, sessionDate);
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
 * afficherCorrection() – Affiche la correction sur quiz.html
 */
function afficherCorrection() {
  console.log(">>> afficherCorrection()");
  const cont = document.getElementById('quizContainer');
  if (!cont) return;

  let html = "";
  const isImmediate = localStorage.getItem('correctionImmediate') === '1';
  const immediateAnswers = window._immediateAnswers || {};

  currentQuestions.forEach((q, idx) => {
    const key = getKeyFor(q);
    const response = currentResponses[key];
    let checkedVal = null;
    if (isImmediate && immediateAnswers[q.id] !== undefined) {
      checkedVal = immediateAnswers[q.id];
    } else {
      const checkedInput = document.querySelector(`input[name="q${q.id}"]:checked`);
      checkedVal = checkedInput ? parseInt(checkedInput.value) : null;
    }

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
        ${ q.image 
          ? `<div class="question-image">
               <img src="${q.image}" alt="Question ${q.id} illustration" />
             </div>`
          : "" }
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

