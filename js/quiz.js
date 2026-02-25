// === quiz.js === Quiz display, validation, immediate correction ===

/**
 * _speakCorrectAnswer() – Lit la bonne réponse via Web Speech Synthesis (TTS)
 * Uniquement si l'option TTS est activée (localStorage ttsEnabled)
 */
var _ttsTimeoutId = null;
function _speakCorrectAnswer(answerText) {
  if (localStorage.getItem('ttsEnabled') !== '1') return;
  if (!('speechSynthesis' in window)) return;
  // Toggle: if currently speaking, stop
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    if (_ttsTimeoutId) { clearTimeout(_ttsTimeoutId); _ttsTimeoutId = null; }
    return;
  }
  // Annuler toute lecture en cours + clear pending timeout
  speechSynthesis.cancel();
  if (_ttsTimeoutId) { clearTimeout(_ttsTimeoutId); _ttsTimeoutId = null; }
  // Petit délai après cancel pour contourner un bug Chrome
  // où speak() est ignoré juste après cancel()
  _ttsTimeoutId = setTimeout(() => {
    _ttsTimeoutId = null;
    const utterance = new SpeechSynthesisUtterance(answerText);
    utterance.lang = 'fr-FR';
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    // Utiliser la voix préférée si elle est définie, sinon la première voix FR
    const voices = speechSynthesis.getVoices();
    const preferredName = localStorage.getItem('ttsPreferredVoiceName') || '';
    let voice = null;
    if (preferredName) {
      voice = voices.find(v => v.name === preferredName);
    }
    if (!voice) {
      voice = voices.find(v => v.lang.startsWith('fr'));
    }
    if (voice) utterance.voice = voice;
    speechSynthesis.speak(utterance);
  }, 100);
}
// Pré-charger les voix (Chrome les charge de manière asynchrone)
if ('speechSynthesis' in window) {
  speechSynthesis.getVoices();
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  }
}

/**
 * _resolveTtsText(q) – Pour les questions à propositions numérotées,
 * résout les références numériques (ex: "1, 2 et 3") en texte réel des propositions.
 * Exemple : si la question contient "1 - l'angle d'incidence\n2 - la forme du profil"
 * et la bonne réponse est "1 et 2", le TTS lira "l'angle d'incidence et la forme du profil".
 */
function _resolveTtsText(q) {
  const correctChoice = (q.choix[q.bonne_reponse] || '').trim();
  if (!correctChoice) return correctChoice;

  // Nettoyer le point final
  const cleaned = correctChoice.replace(/\.?\s*$/, '');

  // Vérifier si le choix ne contient que des numéros séparés par virgules/et
  // Ex: "1, 2 et 3" ou "2 et 4" ou "3" ou "1, 2, 3 et 4"
  if (!/^\d+(\s*,\s*\d+)*(\s+et\s+\d+)?$/.test(cleaned)) return correctChoice;

  // Extraire les numéros référencés
  const numbers = cleaned.match(/\d+/g);
  if (!numbers) return correctChoice;

  // Extraire les propositions numérotées du texte de la question
  // Format attendu : "N - texte" sur des lignes séparées
  const propositions = {};
  const lines = q.question.split('\n');
  lines.forEach(line => {
    const m = line.trim().match(/^(\d+)\s*[-–—]\s*(.+)/);
    if (m) propositions[m[1]] = m[2].trim().replace(/\.?\s*$/, '');
  });

  if (Object.keys(propositions).length === 0) return correctChoice;

  // Résoudre chaque numéro vers le texte de sa proposition
  const resolved = numbers.map(n => propositions[n] || n);

  // Vérifier qu'au moins un numéro a été résolu en texte
  if (resolved.every((r, i) => r === numbers[i])) return correctChoice;

  // Composer le texte TTS naturel
  if (resolved.length === 1) return resolved[0];
  if (resolved.length === 2) return resolved[0] + ' et ' + resolved[1];
  return resolved.slice(0, -1).join(', ') + ' et ' + resolved[resolved.length - 1];
}

/**
 * _logWrongAnswer() – Enregistre une question ratée dans le journal quotidien (pour la page Ratés)
 * Stocke la question complète + timestamp + réponse sélectionnée
 * Double stockage : localStorage (instantané) + Firestore (sync cross-device)
 */
function _logWrongAnswer(q, selectedVal) {
  const now = new Date();
  const todayKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const key = getKeyFor(q);
  const ts = Date.now();
  const item = {
    key: key,
    ts: ts,
    selected: selectedVal,
    q: {
      id: q.id,
      question: q.question,
      choix: q.choix,
      bonne_reponse: q.bonne_reponse,
      categorie: q.categorie,
      image: q.image || null,
      explication: q.explication || null,
      explication_images: q.explication_images || null
    }
  };

  // 1) localStorage (instantané, même offline)
  try {
    let data = JSON.parse(localStorage.getItem('wrongToday') || '{}');
    if (data.date !== todayKey) data = { date: todayKey, items: [] };
    // Déduplique si même question dans la même minute
    const recentDuplicate = data.items.find(it => it.key === key && (ts - it.ts) < 60000);
    if (recentDuplicate) return;
    data.items.push(item);
    localStorage.setItem('wrongToday', JSON.stringify(data));
  } catch (e) { /* localStorage plein */ }

  // 2) Firestore (sync cross-device, fonctionne offline grâce à la persistence)
  try {
    const uid = (auth.currentUser && auth.currentUser.uid) || localStorage.getItem('cachedUid');
    if (!uid) return;
    const docRef = db.collection('quizProgress').doc(uid).collection('wrongToday').doc(todayKey);
    // arrayUnion ajoute l'item au tableau sans écraser les existants
    docRef.set({
      date: todayKey,
      items: firebase.firestore.FieldValue.arrayUnion(item)
    }, { merge: true }).catch(function(e) { console.warn('[wrongToday] Firestore write error:', e); });
  } catch (e) { /* Firestore non disponible */ }
}

/**
 * _queueForReask() – Ajoute une question ratée dans la file de ré-interrogation
 * La question sera reposée au 2ème quiz généré après celui-ci
 */
function _queueForReask(q) {
  try {
    const queue = JSON.parse(localStorage.getItem('reaskQueue') || '[]');
    const key = getKeyFor(q);
    // Éviter les doublons
    if (queue.some(item => item.key === key)) return;
    // countdown=2 : sera décrémenté à chaque génération de quiz, injectée quand =0
    queue.push({ key, question: q, countdown: 2 });
    localStorage.setItem('reaskQueue', JSON.stringify(queue));
  } catch (e) { /* localStorage plein */ }
}

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
  // Note personnelle : afficher immédiatement si disponible en cache
  const key = getKeyFor(q);
  html += `<div class="personal-note-display" id="noteDisplay_${key}">`;
  if (_notesCache && _notesCache[key] && (_notesCache[key].text || _notesCache[key].image)) {
    const note = _notesCache[key];
    html += '<div class="personal-note-block">';
    html += '<div class="personal-note-header">';
    html += '<strong>📌 Ma note personnelle :</strong>';
    html += '<span class="personal-note-actions">';
    html += `<button class="note-edit-btn" onclick="_editNote('${key}')" title="Modifier">✏️</button>`;
    html += `<button class="note-delete-btn" onclick="_deleteNote('${key}')" title="Supprimer">❌</button>`;
    html += '</span></div>';
    if (note.text) {
      html += _renderNoteText(note.text);
    }
    if (note.image) {
      html += `<br><img src="${note.image}" alt="Note illustration" loading="lazy" />`;
    }
    html += '</div>';
  }
  html += '</div>';
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

  // Décrémenter le compteur de la file de ré-interrogation (reaskQueue)
  try {
    const queue = JSON.parse(localStorage.getItem('reaskQueue') || '[]');
    if (queue.length) {
      queue.forEach(item => { if (item.countdown > 0) item.countdown--; });
      localStorage.setItem('reaskQueue', JSON.stringify(queue));
    }
  } catch (e) { /* ignore */ }

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
 * updateCategoryInfoBar() – Affiche le nom de la catégorie, le ratio réussies/total et une barre de progression
 */
function updateCategoryInfoBar(categoryName, remaining, total) {
  const bar = document.getElementById('categoryInfoBar');
  if (!bar) return;
  bar.style.display = 'block';

  const nameEl = document.getElementById('categoryName');
  const progressEl = document.getElementById('categoryProgress');

  if (nameEl) nameEl.textContent = categoryName || '';
  if (progressEl) {
    if (remaining !== null && total !== null && total > 0) {
      const reussies = total - remaining;
      const pct = Math.round(100 * reussies / total);
      // Couleur : rouge → orange → vert selon avancement
      let barColor;
      const t = pct / 100;
      if (t <= 0.5) {
        const s = t * 2;
        barColor = `rgb(${Math.round(220 - 30 * s)}, ${Math.round(50 + 130 * s)}, ${Math.round(50)})`;
      } else {
        const s = (t - 0.5) * 2;
        barColor = `rgb(${Math.round(190 - 144 * s)}, ${Math.round(180 + 24 * s)}, ${Math.round(50 + 14 * s)})`;
      }
      progressEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
          <span>✅ ${reussies} réussies / ${total}</span>
          <span style="font-weight:bold">${pct}%</span>
        </div>
        <div style="height:8px;background:rgba(255,255,255,0.15);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${pct}%;border-radius:4px;background:${barColor};transition:width 0.6s ease"></div>
        </div>
        <div style="margin-top:3px;font-size:0.78rem;opacity:0.8">📋 Restant : ${remaining} (ratées + non vues)</div>
      `;
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

  // Mettre à jour le nombre total de questions (si l'élément existe)
  const totalQuestions = questions.length;
  const totalQEl = document.getElementById('totalQuestions');
  if (totalQEl) totalQEl.textContent = totalQuestions;

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

  // TTS : lire la bonne réponse à voix haute si mauvaise réponse
  if (!isCorrect) {
    const correctText = _resolveTtsText(q);
    _speakCorrectAnswer(correctText);
    // Ajouter la question à la file de ré-interrogation (2 quiz plus tard)
    _queueForReask(q);
    // Permettre de re-lire la bonne réponse en cliquant n'importe où dans la zone réponses
    const answerList = selectedRadio.closest('.answer-list');
    if (answerList && !answerList._ttsReplayAttached) {
      answerList._ttsReplayAttached = true;
      answerList.style.cursor = 'pointer';
      answerList.addEventListener('click', (e) => {
        // Ne pas interférer avec les liens ou boutons
        if (e.target.closest('button') || e.target.closest('a')) return;
        _speakCorrectAnswer(correctText);
      });
    }
  }

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
        // Préserver et enrichir le statusLog (historique des réponses par jour)
        const existingLog = (currentResponses[key] && currentResponses[key].statusLog) ? [...currentResponses[key].statusLog] : [];
        existingLog.push({ status, ts: Date.now() });
        // Garder les 100 dernières entrées max
        if (existingLog.length > 100) existingLog.splice(0, existingLog.length - 100);
        entry.statusLog = existingLog;
        // Ne pas écraser marked/important si les réponses Firestore n'ont pas encore chargé
        if (wasMarked !== undefined) entry.marked = wasMarked;
        if (wasImportant !== undefined) entry.important = wasImportant;
        responsesToSave[key] = entry;
        if (status === 'réussie') correctCount++;
        // Logger la question ratée pour la page "Ratés du jour"
        if (status === 'ratée') {
          _logWrongAnswer(q, selectedVal);
        }
        // Mode non-immédiat : ajouter les questions ratées à la file de ré-interrogation
        if (status === 'ratée' && !isImmediate) {
          _queueForReask(q);
        }
    });

    // Compter les questions nouvellement maîtrisées
    // (passées de non-réussie / non-vue → réussie pour la première fois)
    let _newlyMastered = 0;
    currentQuestions.forEach(q => {
        const key = getKeyFor(q);
        const oldStatus = currentResponses[key]?.status;
        const newStatus = responsesToSave[key]?.status;
        if (newStatus === 'réussie' && oldStatus !== 'réussie') _newlyMastered++;
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
        const _now = new Date();
        const dayKeyUtc = 'dailyAnswered_' + _now.toISOString().slice(0, 10);
        const prev = parseInt(localStorage.getItem(dayKeyUtc)) || 0;
        const newTotal = prev + currentQuestions.length;
        localStorage.setItem(dayKeyUtc, newTotal);
        // Ratchet
        const ratchetKeyUtc = 'dailyCountRatchet_' + _now.toISOString().slice(0, 10);
        const prevRatchet = parseInt(localStorage.getItem(ratchetKeyUtc)) || 0;
        const display = Math.max(newTotal, prevRatchet);
        localStorage.setItem(ratchetKeyUtc, display);
        // Backup persistant en date LOCALE (même format que Firestore/chart)
        const localDateKey = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0') + '-' + String(_now.getDate()).padStart(2, '0');
        const dhBackup = JSON.parse(localStorage.getItem('dailyHistoryBackup') || '{}');
        dhBackup[localDateKey] = (dhBackup[localDateKey] || 0) + currentQuestions.length;
        localStorage.setItem('dailyHistoryBackup', JSON.stringify(dhBackup));
        // Compteur de questions nouvellement réussies (pour estimation jours restants)
        if (_newlyMastered > 0) {
          const masteredKey = 'dailyMastered_' + localDateKey;
          const prevMast = parseInt(localStorage.getItem(masteredKey)) || 0;
          localStorage.setItem(masteredKey, prevMast + _newlyMastered);
          const dmBackup = JSON.parse(localStorage.getItem('dailyMasteredBackup') || '{}');
          dmBackup[localDateKey] = (dmBackup[localDateKey] || 0) + _newlyMastered;
          localStorage.setItem('dailyMasteredBackup', JSON.stringify(dmBackup));
        }
        // Mise à jour visuelle DIRECTE de la barre (streak, objectif, progression)
        updateDailyStatsBar(display);
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
          await saveDailyCountOffline(uid);
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
    // mettre à jour la barre de progression catégorie après validation
    try {
      const savedCQ = [...currentQuestions];
      const catNorm = getNormalizedCategory(selectedCategory);
      if (catNorm === "TOUTES") { await loadAllQuestions(); } else { await chargerQuestions(catNorm); }
      const normalizedSel = getNormalizedSelectedCategory(selectedCategory);
      const isAgg = normalizedSel === "TOUTES" || normalizedSel === "EASA ALL" || normalizedSel === "GLIGLI ALL" || normalizedSel === "AUTRES";
      const fullL = isAgg ? questions : questions.filter(q => q.categorie === normalizedSel);
      let nR = 0, nNV = 0;
      fullL.forEach(q => { const r = currentResponses[getKeyFor(q)]; if (!r) nNV++; else if (r.status === 'ratée') nR++; });
      updateCategoryInfoBar(selectedCategory, nR + nNV, fullL.length);
      currentQuestions = savedCQ;
    } catch (e) { /* ignore */ }
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
 * _sanitizeNoteHtml() – Nettoie le HTML collé pour ne garder que le formatage sûr
 * Autorise : b, strong, i, em, u, br, p, div, ul, ol, li, span, a, h1-h6, sub, sup, blockquote, pre, code
 * Supprime : script, iframe, style, on*, etc.
 */
function _sanitizeNoteHtml(html) {
  if (!html) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const allowedTags = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'ul', 'ol', 'li',
    'span', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'sub', 'sup', 'blockquote', 'pre', 'code', 'hr',
    /* KaTeX elements */ 'math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'mfrac', 'msub',
    'msup', 'msubsup', 'msqrt', 'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'mtext',
    'mspace', 'mpadded', 'menclose', 'mglyph', 'svg', 'line', 'path']);
  const allowedAttrs = new Set(['href', 'target', 'style', 'class', 'aria-hidden', 'xmlns', 'width', 'height', 'viewbox', 'd', 'x1', 'y1', 'x2', 'y2']);

  function clean(node) {
    const children = Array.from(node.childNodes);
    children.forEach(child => {
      if (child.nodeType === 3) return; // text node OK
      if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase();
        if (!allowedTags.has(tag)) {
          // Replace with its children
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
        } else {
          // Remove dangerous attributes
          Array.from(child.attributes).forEach(attr => {
            if (attr.name.startsWith('on') || (!allowedAttrs.has(attr.name))) {
              child.removeAttribute(attr.name);
            }
          });
          // Force links to open in new tab
          if (tag === 'a') child.setAttribute('target', '_blank');
          clean(child);
        }
      } else {
        node.removeChild(child);
      }
    });
  }
  clean(doc.body);
  return doc.body.innerHTML;
}

/**
 * _renderKaTeX(text) – Process $$...$$ (display) and $...$ (inline) LaTeX in text.
 * Returns HTML with rendered math. Requires KaTeX loaded.
 */
function _renderKaTeX(html) {
  if (typeof katex === 'undefined') return html;
  // Display math: $$...$$
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, function(m, tex) {
    try { return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false }); }
    catch(e) { return m; }
  });
  // Inline math: $...$  (but not $$)
  html = html.replace(/\$([^\$\n]+?)\$/g, function(m, tex) {
    try { return katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false }); }
    catch(e) { return m; }
  });
  return html;
}

/**
 * _renderNoteText() – Rend le texte d'une note, compatible ancien format (plain text) et nouveau (HTML)
 * Now also supports KaTeX/LaTeX formulas via $...$ and $$...$$
 */
function _renderNoteText(text) {
  if (!text) return '';
  var rendered;
  // Détecte si le texte contient du HTML (balises)
  if (/<[a-z][\s\S]*>/i.test(text)) {
    rendered = _sanitizeNoteHtml(text);
  } else {
    // Ancien format plain text : échapper et convertir les retours à la ligne
    rendered = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  }
  // Process LaTeX/KaTeX
  return _renderKaTeX(rendered);
}

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
    <div class="note-textarea" contenteditable="true" id="noteText_${key}" data-placeholder="Écrire une note personnelle…">${existingText}</div>
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

  // Auto-grow contenteditable
  const noteDiv = document.getElementById('noteText_' + key);
  // No auto-grow needed for contenteditable, it grows naturally

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

  const noteEl = document.getElementById('noteText_' + key);
  const fileInput = document.getElementById('noteImage_' + key);
  const text = noteEl ? _sanitizeNoteHtml(noteEl.innerHTML).trim() : '';
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
    html += _renderNoteText(note.text);
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
