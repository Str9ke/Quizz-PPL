// === quiz.js === Quiz display, validation, immediate correction ===

/**
 * _buildExplicationHtml() – Construit le HTML d'affichage d'une explication
 */
function _buildExplicationHtml(q) {
  let html = '';
  const hasExplication = q.explication || (q.explication_images && q.explication_images.length);
  if (hasExplication) {
    html += '<div class="explication-block">';
    html += '<strong>\uD83D\uDCA1 Explication :</strong><br>';
    if (q.explication) {
      const escaped = q.explication
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
      html += escaped;
    }
    if (q.explication_images && q.explication_images.length) {
      q.explication_images.forEach(imgPath => {
        html += `<br><img src="${imgPath}" alt="Explication illustration" loading="lazy">`;
      });
    }
    html += '</div>';
  }
  // Placeholder pour la note personnelle (rempli dynamiquement)
  const key = getKeyFor(q);
  html += `<div class="personal-note-display" id="noteDisplay_${key}"></div>`;
  return html;
}

async function demarrerQuiz() {
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

  // Nettoyer les recently answered quand on démarre un nouveau quiz depuis l'accueil
  localStorage.removeItem('recentlyAnsweredKeys');

  // Sauvegarder le mode correction immédiate
  const corrImm = document.getElementById('correctionImmediateCheckbox');
  localStorage.setItem('correctionImmediate', corrImm && corrImm.checked ? '1' : '0');

  window.location = 'quiz.html';
}

/**
 * toggleMarquerQuestion() – Marque ou supprime une question marquée
 */
function toggleMarquerQuestion(questionId, button) {
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
  const questionBlocks = document.querySelectorAll('.question-block');
  questionBlocks.forEach((block, idx) => {
    // remove existing action buttons row to avoid duplicates
    block.querySelectorAll('.question-actions-row').forEach(row => row.remove());
    block.querySelectorAll('.mark-button, .delete-button, .important-button, .unimportant-button, .note-toggle-btn').forEach(btn => btn.remove());
    const q   = currentQuestions[idx];
    if (!q) return;
    const key = getKeyFor(q);
    const isMarked = (currentResponses[key] && currentResponses[key].marked === true);
    const isImportant = (currentResponses[key] && currentResponses[key].important === true);

    // Conteneur flex pour tous les boutons d'action
    const row = document.createElement('div');
    row.className = 'question-actions-row';

    const btn = document.createElement('button');
    btn.textContent = isMarked ? "Supprimer" : "Marquer";
    btn.className   = isMarked ? "delete-button" : "mark-button";
    btn.onclick     = () => toggleMarquerQuestion(q.id, btn);
    row.appendChild(btn);

    const btnImp = document.createElement('button');
    btnImp.textContent = isImportant ? "Retirer Important" : "Important";
    btnImp.className   = isImportant ? "delete-button" : "mark-button";
    btnImp.onclick     = () => toggleImportantQuestion(q.id, btnImp);
    row.appendChild(btnImp);

    // Bouton Ma note (dans la même ligne)
    const btnNote = document.createElement('button');
    btnNote.className = 'note-toggle-btn';
    btnNote.textContent = '📝 Ma note';
    btnNote.onclick = () => _toggleNoteEditor(key, btnNote);
    row.appendChild(btnNote);

    block.appendChild(row);
  });
}

/**
 * updateCategoryInfoBar() – Affiche le nom de la catégorie et le nombre de ratées+non vues / total
 */
function updateCategoryInfoBar(categoryName, remaining, total) {
  const bar = document.getElementById('categoryInfoBar');
  if (!bar) return;
  bar.style.display = 'block';

  const nameEl = document.getElementById('categoryName');
  const progressEl = document.getElementById('categoryProgress');

  if (nameEl) nameEl.textContent = categoryName || '';
  if (progressEl) {
    if (remaining !== null && total !== null) {
      progressEl.textContent = `Restant (ratées + non vues) : ${remaining} / ${total}`;
    } else {
      progressEl.textContent = 'Chargement…';
    }
  }
}

async function initQuiz() {
  // redirect if not logged in (sauf si offline avec UID en cache)
  if (!auth.currentUser && !localStorage.getItem('cachedUid')) {
    window.location = 'index.html';
    return;
  }

  ensureDailyStatsBarVisible();

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

  // Afficher immédiatement le nom de la catégorie
  updateCategoryInfoBar(selectedCategory, null, null);

  // Charger les réponses en arrière-plan, puis mettre à jour les boutons marquer/important
  getDocWithTimeout(db.collection('quizProgress').doc(uid)).then(async (doc) => {
    const data = doc.exists ? doc.data() : {};
    currentResponses = normalizeResponses(data.responses || {});
    // Précharger les notes personnelles pour correction immédiate
    _notesCache = data.notes || {};
    try {
      const lsKey = 'personalNotes_' + uid;
      const lsNotes = JSON.parse(localStorage.getItem(lsKey) || '{}');
      Object.keys(lsNotes).forEach(k => { if (!_notesCache[k]) _notesCache[k] = lsNotes[k]; });
    } catch (e) { /* ignore */ }
    afficherBoutonsMarquer();
    updateMarkedCount();

    // Charger les questions complètes de la catégorie pour calculer ratées+non vues / total
    try {
      const savedCurrent = [...currentQuestions]; // sauvegarder le quiz en cours
      const catNorm = getNormalizedCategory(selectedCategory);
      if (catNorm === "TOUTES") {
        await loadAllQuestions();
      } else {
        await chargerQuestions(catNorm);
      }
      const normalizedSel = getNormalizedSelectedCategory(selectedCategory);
      const isAggregate = normalizedSel === "TOUTES" || normalizedSel === "EASA ALL" || normalizedSel === "GLIGLI ALL" || normalizedSel === "AUTRES";
      const fullList = isAggregate ? questions : questions.filter(q => q.categorie === normalizedSel);
      let nbRatees = 0, nbNonvues = 0;
      fullList.forEach(q => {
        const r = currentResponses[getKeyFor(q)];
        if (!r) { nbNonvues++; }
        else if (r.status === 'ratée') { nbRatees++; }
      });
      updateCategoryInfoBar(selectedCategory, nbRatees + nbNonvues, fullList.length);
      currentQuestions = savedCurrent; // restaurer le quiz en cours
    } catch (e) {
      console.warn('[categoryInfo] Impossible de calculer les stats catégorie:', e.message);
    }
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

  // Construire TOUT le HTML en une seule chaîne puis injecter une seule fois
  // (évite innerHTML += en boucle qui détruit/recrée le DOM à chaque itération,
  //  ce qui peut interrompre le chargement des images)
  let quizHtml = "";
  currentQuestions.forEach((q, idx) => {
    // Mélanger les choix pour ne pas toujours avoir les réponses au même endroit
    // Créer un tableau d'indices [0, 1, 2, 3], le mélanger (Fisher-Yates)
    const indices = q.choix.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    // Réordonner les choix et mettre à jour bonne_reponse
    const originalChoix = [...q.choix];
    const originalBonne = q.bonne_reponse;
    q.choix = indices.map(i => originalChoix[i]);
    q.bonne_reponse = indices.indexOf(originalBonne);

    quizHtml += `
      <div class="question-block">
        <div class="question-title">${idx+1}. ${q.question}</div>
        ${ q.image 
          ? `<div class="question-image">
               <img src="${q.image}" alt="Question ${q.id} illustration"
                    onerror="this.style.display='none'; console.warn('Image introuvable:', this.src);" />
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
  cont.innerHTML = quizHtml;

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

  // Afficher l'explication si disponible
  const questionBlock = selectedRadio.closest('.question-block');
  if (questionBlock) {
    if (q.explication || (q.explication_images && q.explication_images.length)) {
      // Vérifier qu'on n'a pas déjà ajouté l'explication
      if (!questionBlock.querySelector('.explication-block')) {
        const explDiv = document.createElement('div');
        explDiv.innerHTML = _buildExplicationHtml(q);
        // _buildExplicationHtml retourne explication-block + noteDisplay div
        while (explDiv.firstChild) {
          questionBlock.appendChild(explDiv.firstChild);
        }
      }
    } else {
      // Pas d'explication officielle mais ajouter le placeholder pour note
      const key = getKeyFor(q);
      if (!document.getElementById('noteDisplay_' + key)) {
        const nd = document.createElement('div');
        nd.className = 'personal-note-display';
        nd.id = 'noteDisplay_' + key;
        questionBlock.appendChild(nd);
      }
    }
    // Ajouter le bouton de note si pas déjà présent
    const key2 = getKeyFor(q);
    if (!questionBlock.querySelector('.note-toggle-btn')) {
      // Créer une row d'actions si elle n'existe pas
      let row = questionBlock.querySelector('.question-actions-row');
      if (!row) {
        row = document.createElement('div');
        row.className = 'question-actions-row';
        questionBlock.appendChild(row);
      }
      const btn = document.createElement('button');
      btn.className = 'note-toggle-btn';
      btn.textContent = '📝 Ma note';
      btn.onclick = () => _toggleNoteEditor(key2, btn);
      row.appendChild(btn);
      // Charger et afficher la note existante
      if (_notesCache && _notesCache[key2]) {
        _renderNoteDisplay(key2, _notesCache[key2]);
      }
    }
  }

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
    // Empêcher la double validation
    if (window._quizValidated) {
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
        const prevFailCount = hasExisting ? (currentResponses[key].failCount || 0) : 0;
        const status = selectedVal !== null
            ? (selectedVal === q.bonne_reponse ? 'réussie' : 'ratée')
            : 'ratée';

        // Répétition espacée : calculer le prochain intervalle
        const prevInterval = hasExisting ? (currentResponses[key].srInterval || 0) : 0;
        let newInterval;
        if (status === 'réussie') {
          // Bonne réponse : augmenter l'intervalle (1→3→7→15→30→60 jours)
          if (prevInterval <= 0) newInterval = 1;
          else if (prevInterval === 1) newInterval = 3;
          else newInterval = Math.min(Math.round(prevInterval * 2.5), 60);
        } else {
          // Mauvaise réponse : retour à 1 jour
          newInterval = 1;
        }
        const nextReviewMs = Date.now() + newInterval * 24 * 60 * 60 * 1000;

        const entry = {
            category: q.categorie,
            questionId: q.id,
            status,
            failCount: status === 'ratée' ? prevFailCount + 1 : prevFailCount,
            srInterval: newInterval,
            nextReview: nextReviewMs,
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
    // Ne PAS incrémenter en mode révisions espacées
    if (modeQuiz !== 'revisions') {
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
    }

    // Sauvegarder la session en localStorage IMMÉDIATEMENT
    // (avant toute opération Firestore qui peut bloquer 10-15s offline)
    const sessionDate = new Date().toISOString();
    if (typeof _saveSessionToLocalBackup === 'function') {
      _saveSessionToLocalBackup(correctCount, currentQuestions.length, selectedCategory, sessionDate);
    }

    try {
        // Sauvegarde avec fallback offline
        currentResponses = await saveResponsesWithOfflineFallback(uid, responsesToSave);

        // Sauvegarder le compteur quotidien (sauf mode révisions espacées)
        if (modeQuiz !== 'revisions') {
          await saveDailyCountOffline(uid, currentQuestions.length);
        }
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
               <img src="${q.image}" alt="Question ${q.id} illustration"
                    onerror="this.style.display='none'; console.warn('Image introuvable:', this.src);" />
             </div>`
          : "" }
        <div class="answer-list">
          ${ansHtml}
        </div>
        ${_buildExplicationHtml(q)}
      </div>
    `;
  });
  cont.innerHTML = html;

  // re-attach mark buttons on corrected view
  afficherBoutonsMarquer();
  updateMarkedCount();

  // Ajouter les boutons de note personnelle et charger les notes existantes
  _attachNoteButtons();
  _loadAndDisplayNotes();
}

// ============================================================
// Notes personnelles
// ============================================================

/** Cache mémoire des notes chargées */
let _notesCache = null;

/**
 * _attachNoteButtons() – S'assure que les placeholders de notes et boutons sont présents
 * (les boutons note sont désormais dans la question-actions-row via afficherBoutonsMarquer)
 */
function _attachNoteButtons() {
  // Les boutons note sont déjà ajoutés par afficherBoutonsMarquer() dans la row.
  // Ici on s'assure juste que le noteDisplay div existe pour chaque question.
  currentQuestions.forEach(q => {
    const key = getKeyFor(q);
    if (!document.getElementById('noteDisplay_' + key)) {
      // Trouver le question-block correspondant
      const blocks = document.querySelectorAll('.question-block');
      const idx = currentQuestions.indexOf(q);
      if (blocks[idx]) {
        const nd = document.createElement('div');
        nd.className = 'personal-note-display';
        nd.id = 'noteDisplay_' + key;
        // Insérer avant la row de boutons
        const row = blocks[idx].querySelector('.question-actions-row');
        if (row) blocks[idx].insertBefore(nd, row);
        else blocks[idx].appendChild(nd);
      }
    }
  });
}

/**
 * _toggleNoteEditor() – Affiche/masque l'éditeur de note
 */
function _toggleNoteEditor(key, btn) {
  const existingEditor = document.getElementById('noteEditor_' + key);
  if (existingEditor) {
    existingEditor.style.display = existingEditor.style.display === 'none' ? 'block' : 'none';
    return;
  }

  const editor = document.createElement('div');
  editor.id = 'noteEditor_' + key;
  editor.className = 'note-editor';

  // Pré-remplir avec la note existante
  const existing = _notesCache && _notesCache[key];
  const existingText = existing ? (existing.text || '') : '';

  editor.innerHTML = `
    <textarea class="note-textarea" id="noteText_${key}" placeholder="Écrire une note personnelle…" rows="1">${existingText}</textarea>
    <div class="note-actions">
      <label class="note-image-label">
        🖼️ Image
        <input type="file" accept="image/*" id="noteImage_${key}" style="display:none" />
      </label>
      <span class="note-image-name" id="noteImageName_${key}"></span>
      <button class="note-publish-btn" onclick="_publishNote('${key}')">Publier</button>
    </div>
    <div id="noteImagePreview_${key}" class="note-image-preview"></div>
  `;

  // Placer l'éditeur dans le question-block (pas dans la row de boutons)
  const block = btn.closest('.question-block');
  if (block) {
    block.appendChild(editor);
  } else {
    btn.parentElement.appendChild(editor);
  }

  // Auto-grow textarea
  const textarea = document.getElementById('noteText_' + key);
  textarea.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = this.scrollHeight + 'px';
  });
  // Trigger initial resize if pre-filled
  if (existingText) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  // Image file handler
  const fileInput = document.getElementById('noteImage_' + key);
  fileInput.addEventListener('change', function() {
    const file = this.files[0];
    const nameSpan = document.getElementById('noteImageName_' + key);
    const previewDiv = document.getElementById('noteImagePreview_' + key);
    if (file) {
      nameSpan.textContent = file.name;
      const reader = new FileReader();
      reader.onload = e => {
        previewDiv.innerHTML = `<img src="${e.target.result}" alt="Aperçu" />`;
      };
      reader.readAsDataURL(file);
    } else {
      nameSpan.textContent = '';
      previewDiv.innerHTML = '';
    }
  });
}

/**
 * _publishNote() – Sauvegarde la note dans Firestore
 */
async function _publishNote(key) {
  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
  if (!uid) { alert('Vous devez être connecté.'); return; }

  const textarea = document.getElementById('noteText_' + key);
  const fileInput = document.getElementById('noteImage_' + key);
  const text = textarea ? textarea.value.trim() : '';
  const file = fileInput && fileInput.files[0];

  if (!text && !file) { return; }

  let imageData = null;
  if (file) {
    // Convertir l'image en base64 (stockée dans Firestore, < 1MB)
    imageData = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  }
  // Conserver l'image existante si pas de nouvelle image uploadée
  const existingNote = _notesCache && _notesCache[key];
  if (!imageData && existingNote && existingNote.image) {
    imageData = existingNote.image;
  }

  const notePayload = {
    text: text,
    image: imageData,
    updatedAt: firebase.firestore.Timestamp.now()
  };

  // Sauvegarder
  try {
    await db.collection('quizProgress').doc(uid).set(
      { notes: { [key]: notePayload } },
      { merge: true }
    );
  } catch (e) {
    console.warn('[note] Firestore save failed, storing locally', e.message);
    // Fallback localStorage
    try {
      const lsKey = 'personalNotes_' + uid;
      const stored = JSON.parse(localStorage.getItem(lsKey) || '{}');
      stored[key] = notePayload;
      localStorage.setItem(lsKey, JSON.stringify(stored));
    } catch (e2) { /* ignore */ }
  }

  // Mettre à jour le cache
  if (!_notesCache) _notesCache = {};
  _notesCache[key] = notePayload;

  // Afficher la note
  _renderNoteDisplay(key, notePayload);

  // Masquer l'éditeur
  const editor = document.getElementById('noteEditor_' + key);
  if (editor) editor.style.display = 'none';
}

/**
 * _renderNoteDisplay() – Affiche une note personnelle dans la zone de display
 */
function _renderNoteDisplay(key, note) {
  const div = document.getElementById('noteDisplay_' + key);
  if (!div) return;

  if (!note || (!note.text && !note.image)) {
    div.innerHTML = '';
    return;
  }

  let html = '<div class="personal-note-block">';
  html += '<div class="personal-note-header">';
  html += '<strong>📌 Ma note personnelle :</strong>';
  html += '<span class="personal-note-actions">';
  html += `<button class="note-edit-btn" onclick="_editNote('${key}')" title="Modifier">✏️</button>`;
  html += `<button class="note-delete-btn" onclick="_deleteNote('${key}')" title="Supprimer">❌</button>`;
  html += '</span>';
  html += '</div>';
  if (note.text) {
    const escaped = note.text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    html += escaped;
  }
  if (note.image) {
    html += `<br><img src="${note.image}" alt="Note illustration" loading="lazy" />`;
  }
  html += '</div>';
  div.innerHTML = html;
}

/**
 * _editNote() – Ouvre l'éditeur de note pour modification
 */
function _editNote(key) {
  // Trouver le bouton note dans la row pour positionner l'éditeur
  const displayDiv = document.getElementById('noteDisplay_' + key);
  if (!displayDiv) return;
  const block = displayDiv.closest('.question-block');
  if (!block) return;
  const noteBtn = block.querySelector('.note-toggle-btn');
  if (noteBtn) {
    _toggleNoteEditor(key, noteBtn);
    // S'assurer que l'éditeur est visible
    const editor = document.getElementById('noteEditor_' + key);
    if (editor) editor.style.display = 'block';
  }
}

/**
 * _deleteNote() – Supprime une note après confirmation
 */
async function _deleteNote(key) {
  if (!confirm('Supprimer cette note personnelle ?')) return;

  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
  if (!uid) return;

  // Supprimer dans Firestore
  try {
    await db.collection('quizProgress').doc(uid).set(
      { notes: { [key]: firebase.firestore.FieldValue.delete() } },
      { merge: true }
    );
  } catch (e) {
    console.warn('[note] Firestore delete failed', e.message);
  }

  // Supprimer du localStorage
  try {
    const lsKey = 'personalNotes_' + uid;
    const stored = JSON.parse(localStorage.getItem(lsKey) || '{}');
    delete stored[key];
    localStorage.setItem(lsKey, JSON.stringify(stored));
  } catch (e) { /* ignore */ }

  // Supprimer du cache
  if (_notesCache) delete _notesCache[key];

  // Masquer l'affichage et l'éditeur
  const div = document.getElementById('noteDisplay_' + key);
  if (div) div.innerHTML = '';
  const editor = document.getElementById('noteEditor_' + key);
  if (editor) { editor.remove(); }
}

/**
 * _loadAndDisplayNotes() – Charge les notes depuis Firestore et les affiche
 */
async function _loadAndDisplayNotes() {
  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
  if (!uid) return;

  try {
    const doc = await getDocWithTimeout(db.collection('quizProgress').doc(uid));
    const data = doc.exists ? doc.data() : {};
    _notesCache = data.notes || {};

    // Compléter avec les notes localStorage (fallback offline)
    try {
      const lsKey = 'personalNotes_' + uid;
      const lsNotes = JSON.parse(localStorage.getItem(lsKey) || '{}');
      Object.keys(lsNotes).forEach(k => {
        if (!_notesCache[k]) _notesCache[k] = lsNotes[k];
      });
    } catch (e) { /* ignore */ }
  } catch (e) {
    console.warn('[notes] Impossible de charger les notes:', e.message);
    // Fallback localStorage
    try {
      const lsKey = 'personalNotes_' + uid;
      _notesCache = JSON.parse(localStorage.getItem(lsKey) || '{}');
    } catch (e2) { _notesCache = {}; }
  }

  // Afficher les notes existantes
  currentQuestions.forEach(q => {
    const key = getKeyFor(q);
    if (_notesCache[key]) {
      _renderNoteDisplay(key, _notesCache[key]);
    }
  });
}
