// === quiz.js === Quiz display, validation, immediate correction ===

/**
 * _isPracticeMode() – Vrai si le quiz en cours a été lancé en "mode entraînement libre"
 * (ex. depuis echecs.html avec une sélection manuelle de questions) : dans ce mode, aucune
 * réponse n'est persistée — pas de failCount/successCount, pas de planification de
 * répétition espacée, pas de file de ré-interrogation, pas de compteurs quotidiens. Le
 * quiz sert uniquement à s'entraîner sans toucher au suivi de progression.
 */
function _isPracticeMode() {
  return localStorage.getItem('quizPracticeMode') === '1';
}

/**
 * _scrollBelowStickyBanner() – Scroll fluide vers un élément en tenant compte de la hauteur
 * ACTUELLE de #resultContainer (position: sticky; top: 0 — hauteur variable selon le texte du
 * score). Un simple target.scrollIntoView() alignerait le haut de la cible sur le haut du
 * viewport, où la bannière collante vient justement se repositionner : la cible se
 * retrouverait cachée derrière elle au lieu d'apparaître juste en dessous.
 */
function _scrollBelowStickyBanner(target) {
  if (!target) return;
  const rc = document.getElementById('resultContainer');
  const bannerH = (rc && rc.style.display !== 'none') ? rc.offsetHeight : 0;
  const y = target.getBoundingClientRect().top + window.scrollY - bannerH - 12;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

/**
 * _speakCorrectAnswer() – Lit la bonne réponse via Web Speech Synthesis (TTS)
 * Uniquement si l'option TTS est activée (localStorage ttsEnabled), SAUF si `force` est vrai
 * (utilisé par le Mode Assistance de quiz.js, qui doit toujours lire la bonne réponse — y
 * compris si le toggle TTS global est coupé, et sans se faire couper par le mécanisme de
 * "toggle: reclique = stop" ci-dessous qui n'a de sens que pour un clic manuel de l'utilisateur).
 */
// Toute la synthèse vocale passe par window.appTts (js/tts.js), qui choisit le moteur adapté :
// Web Speech sur le site, moteur natif d'Android dans l'APK — où `speechSynthesis` existe
// parfois mais ne propose AUCUNE voix, rendant le Mode Assistance totalement muet.
function _speakCorrectAnswer(answerText, force) {
  if (!force && localStorage.getItem('ttsEnabled') !== '1') return;
  if (!window.appTts || !window.appTts.supported()) return;
  // Toggle : reclique pendant la lecture = on coupe (sauf en mode forcé — voir plus haut)
  if (!force && window.appTts.isSpeaking()) {
    window.appTts.stop();
    return;
  }
  window.appTts.speak(answerText, {
    volume: (parseInt(localStorage.getItem('ttsVolume')) || 100) / 100,
    voiceName: localStorage.getItem('ttsPreferredVoiceName') || ''
  });
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

  // Vérifier si le choix ne contient que des numéros séparés par virgules/tirets/et
  // Ex: "1, 2 et 3" ou "2 et 4" ou "3" ou "1, 2, 3 et 4" ou "1 - 3" ou "2 - 4"
  if (!/^\d+(\s*[,\-–—]\s*\d+)*(\s+et\s+\d+)?$/.test(cleaned)) return correctChoice;

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
 * _srStatsHtml() – Petit badge affiché sous chaque question répondue : combien de fois
 * ratée/réussie au total, et où elle en est dans le cycle de répétition espacée (prochaine
 * révision dans combien de jours, avec l'intervalle actuel). successCount est le compteur
 * dédié (voir _computeSrEntry) ; pour une question déjà répondue avant l'ajout de ce champ,
 * on retombe sur un décompte approximatif depuis statusLog (limité aux 100 dernières entrées).
 */
function _srStatsHtml(q) {
  const key = getKeyFor(q);
  const r = currentResponses[key];
  if (!r || r.status === undefined) return '';
  const fails = r.failCount || 0;
  const successes = (r.successCount !== undefined)
    ? r.successCount
    : ((r.statusLog || []).filter(e => e.status === 'réussie').length);
  let posText;
  if (r.nextReview !== undefined && r.nextReview !== null) {
    let reviewMs = r.nextReview;
    if (typeof reviewMs === 'object' && reviewMs.seconds) reviewMs = reviewMs.seconds * 1000;
    const days = Math.ceil((reviewMs - Date.now()) / (24 * 60 * 60 * 1000));
    posText = days <= 0 ? 'due maintenant' : `dans ${days} j (intervalle actuel : ${r.srInterval || 0} j)`;
  } else {
    posText = 'pas encore planifiée';
  }
  return `<div class="sr-stats-badge" style="font-size:.8em;color:var(--text-secondary);margin:4px 0 2px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,.04)">`
    + `❌ Ratée <strong>${fails}</strong> fois · ✅ Réussie <strong>${successes}</strong> fois · 🔁 Répétition espacée : ${posText}`
    + `</div>`;
}

/**
 * _buildExplicationHtml() – Construit le HTML d'affichage d'une explication
 */
function _buildExplicationHtml(q, includeNote) {
  if (includeNote === undefined) includeNote = true;
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
  // Note personnelle : afficher immédiatement si disponible en cache. Omis quand la carte est
  // dupliquée hors de son emplacement d'origine (récapitulatif des erreurs, voir plus bas) —
  // un id="noteDisplay_<key>" en double casserait document.getElementById.
  if (!includeNote) return html;
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
  const filterFlags = (typeof _getCheckedFilterFlags === 'function') ? _getCheckedFilterFlags() : [];

  if (selectedCategory === "TOUTES") {
    await loadAllQuestions();
  } else {
    await chargerQuestions(selectedCategory);
  }

  await filtrerQuestions(modeQuiz, nbQuestions, filterFlags);

  if (!currentQuestions.length) {
    // Piège classique du mode "objectif" (répétition espacée) : « Nouvelles questions/jour »
    // est un réglage LOCAL (localStorage, non synchronisé entre appareils/navigateurs — voir
    // getDailyNewTarget()). À 0 sur CET appareil, et sans révision due dans la catégorie
    // choisie, le total tombe silencieusement à 0 alors que le compte est bien réel ailleurs
    // (typiquement l'appli Android, où ce réglage local vaut encore 15 par défaut). Le message
    // générique laissait croire à un bug ; on pointe la cause réelle quand elle s'applique.
    if (!filterFlags.length && modeQuiz === 'objectif' && typeof getDailyNewTarget === 'function' && getDailyNewTarget() === 0) {
      alert(
        "Aucune question disponible : aucune révision n'est due dans cette catégorie pour l'instant, "
        + "et « Nouvelles questions/jour » est réglé sur 0 sur CET appareil/navigateur (c'est un réglage "
        + "local, pas synchronisé — un autre appareil peut avoir une valeur différente).\n\n"
        + "Augmente cette valeur dans la carte « Répétition espacée » de l'accueil, ou choisis "
        + "une catégorie où des révisions sont dues."
      );
    } else {
      alert(
        filterFlags.length
          ? "Aucune question ne correspond à ce mode combiné à ces filtres (marquées/importantes/notes) en ce moment."
          : "Aucune question disponible pour ce mode dans cette catégorie en ce moment."
      );
    }
    return;
  }

  // store parameters for quiz page
  localStorage.removeItem('quizPracticeMode');
  localStorage.setItem('quizCategory', selectedCategory);
  localStorage.setItem('quizMode', modeQuiz);
  localStorage.setItem('quizFilterFlags', JSON.stringify(filterFlags));
  localStorage.setItem('quizNbQuestions', nbQuestions);
  const _saved = (typeof _setLocalStorageWithCleanup === 'function')
    ? _setLocalStorageWithCleanup('currentQuestions', JSON.stringify(currentQuestions))
    : (() => { try { localStorage.setItem('currentQuestions', JSON.stringify(currentQuestions)); return true; } catch (e) { return false; } })();
  if (!_saved) {
    alert("Stockage local plein : impossible de démarrer le quiz.\n\nLibère de la place (par exemple sur la page Briefing : vide le PDF OPMET ou les cartes météo importées) puis réessaie.");
    return;
  }
  // Nouveau quiz : effacer les réponses/position en cours d'une session précédente
  localStorage.removeItem('currentQuizAnswers');
  localStorage.removeItem('currentQuizBatchPos');
  if (typeof _qtResetSessionTotal === 'function') _qtResetSessionTotal();

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
function toggleMarquerQuestion(questionIdx, button) {
  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
  if (!uid) {
    alert("Vous devez être connecté pour marquer ou supprimer une question.");
    return;
  }

  // Trouver la question par index dans le tableau (évite collision d'id entre catégories)
  const question = currentQuestions[questionIdx];
  if (!question) {
    console.error("Question introuvable dans la catégorie sélectionnée.");
    return;
  }

  const key = getKeyFor(question);
  // use local state to preserve status
  const prev = currentResponses[key] || {};
  const newMarked = !prev.marked;
  // bug corrigé : "status: prev.status || 'ratée'" écrivait 'ratée' dans Firestore même pour
  // une question jamais répondue (prev.status undefined). Firestore rejette un champ explicite
  // à `undefined` dans set()/update() — on omet donc le champ status quand il n'existe pas
  // encore, pour que le merge Firestore préserve l'état "non vue" au lieu de le convertir en
  // "ratée" (elle réapparaissait ensuite comme échouée partout, y compris comme due en SR).
  const entry = { marked: newMarked, important: prev.important === true };
  if (prev.status !== undefined) entry.status = prev.status;
  _saveResponsesSharded(uid, { [key]: entry })
    .then(() => {
      // update in-memory
      currentResponses[key] = { ...prev, status: prev.status, marked: newMarked };
      // update button icon/title/style
      button.textContent = newMarked ? "🗑️" : "🔖";
      button.title       = newMarked ? "Supprimer le marquage" : "Marquer cette question";
      button.className   = (newMarked ? "delete-button" : "mark-button") + " qa-icon-btn";
      // refresh counts and global marked counter
      updateModeCounts();
      updateMarkedCount();
    })
    .catch(async (err) => {
      console.warn('[offline] toggleMarquer fallback');
      try { await _saveResponsesSharded(uid, { [key]: entry }); } catch (e2) { console.error('[offline] toggleMarquer retry failed:', e2); }
      // update in-memory anyway
      currentResponses[key] = { ...prev, status: prev.status, marked: newMarked };
      button.textContent = newMarked ? "🗑️" : "🔖";
      button.title       = newMarked ? "Supprimer le marquage" : "Marquer cette question";
      button.className   = (newMarked ? "delete-button" : "mark-button") + " qa-icon-btn";
      updateModeCounts();
      updateMarkedCount();
    });
}

function toggleImportantQuestion(questionIdx, button) {
  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
  if (!uid) {
    alert("Vous devez être connecté pour marquer une question comme importante.");
    return;
  }

  const question = currentQuestions[questionIdx];
  if (!question) {
    console.error("Question introuvable dans la catégorie sélectionnée.");
    return;
  }

  const key = getKeyFor(question);
  const prev = currentResponses[key] || {};
  const newImportant = !prev.important;
  // bug corrigé : voir toggleMarquerQuestion() — ne pas défauter status à 'ratée' pour une
  // question jamais répondue, sinon elle est convertie en "ratée" en base au lieu de rester
  // "non vue".
  const entry = { marked: prev.marked === true, important: newImportant };
  if (prev.status !== undefined) entry.status = prev.status;

  _saveResponsesSharded(uid, { [key]: entry })
    .then(() => {
      currentResponses[key] = { ...prev, status: prev.status, marked: prev.marked, important: newImportant };
      button.textContent = newImportant ? "⭐" : "☆";
      button.title       = newImportant ? "Retirer Important" : "Marquer comme important";
      button.className   = (newImportant ? "delete-button" : "mark-button") + " qa-icon-btn";
      updateModeCounts();
      updateMarkedCount();
    })
    .catch(async (err) => {
      console.warn('[offline] toggleImportant fallback');
      try { await _saveResponsesSharded(uid, { [key]: entry }); } catch (e2) { console.error('[offline] toggleImportant retry failed:', e2); }
      currentResponses[key] = { ...prev, status: prev.status, marked: prev.marked, important: newImportant };
      button.textContent = newImportant ? "⭐" : "☆";
      button.title       = newImportant ? "Retirer Important" : "Marquer comme important";
      button.className   = (newImportant ? "delete-button" : "mark-button") + " qa-icon-btn";
      updateModeCounts();
      updateMarkedCount();
    });
}

/**
 * toggleSuspendQuestion() – Marque une question "à ne plus revoir" : elle sort de tous les
 * modes de sélection automatique (mixte, révisions, objectif, non vues, ratées, etc.),
 * sauf du mode dédié "🚫 Ne plus revoir" qui permet de la retrouver et de la réactiver.
 */
function toggleSuspendQuestion(questionIdx, button) {
  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
  if (!uid) {
    alert("Vous devez être connecté pour ne plus revoir une question.");
    return;
  }

  const question = currentQuestions[questionIdx];
  if (!question) {
    console.error("Question introuvable dans la catégorie sélectionnée.");
    return;
  }

  const key = getKeyFor(question);
  const prev = currentResponses[key] || {};
  const newSuspended = !prev.suspended;
  // bug corrigé : voir toggleMarquerQuestion() — ne pas défauter status à 'ratée' pour une
  // question jamais répondue, sinon elle est convertie en "ratée" en base au lieu de rester
  // "non vue" (elle compte désormais comme "réussie" via suspended, indépendamment du statut).
  const entry = { marked: prev.marked === true, important: prev.important === true, suspended: newSuspended };
  if (prev.status !== undefined) entry.status = prev.status;

  _saveResponsesSharded(uid, { [key]: entry })
    .then(() => {
      currentResponses[key] = { ...prev, status: prev.status, marked: prev.marked, important: prev.important, suspended: newSuspended };
      button.textContent = newSuspended ? "↩️" : "🚫";
      button.title       = newSuspended
        ? "Revoir à nouveau (réactiver cette question)"
        : "Ne plus revoir — cette question ne réapparaîtra plus dans les modes automatiques (mixte, révisions, objectif du jour, etc.)";
      button.className   = (newSuspended ? "unimportant-button" : "delete-button") + " qa-icon-btn";
      updateModeCounts();
    })
    .catch(async (err) => {
      console.warn('[offline] toggleSuspend fallback');
      try { await _saveResponsesSharded(uid, { [key]: entry }); } catch (e2) { console.error('[offline] toggleSuspend retry failed:', e2); }
      currentResponses[key] = { ...prev, status: prev.status, marked: prev.marked, important: prev.important, suspended: newSuspended };
      button.textContent = newSuspended ? "↩️" : "🚫";
      button.title       = newSuspended
        ? "Revoir à nouveau (réactiver cette question)"
        : "Ne plus revoir — cette question ne réapparaîtra plus dans les modes automatiques (mixte, révisions, objectif du jour, etc.)";
      button.className   = (newSuspended ? "unimportant-button" : "delete-button") + " qa-icon-btn";
      updateModeCounts();
    });
}

/**
 * adjustSrFrequency() – Ajuste manuellement la fréquence de répétition espacée d'une question,
 * indépendamment de la prochaine réponse donnée. "easier" repousse la prochaine révision plus
 * loin dans le temps (question jugée facile par l'utilisateur → on la montre moins souvent) ;
 * "harder" la rapproche (question jugée difficile → on la montre plus souvent). Ne modifie que
 * srInterval/nextReview — laisse status/failCount/successCount/etc. intacts pour ne pas fausser
 * les statistiques de réussite déjà calculées par _computeSrEntry().
 */
/**
 * _flashQaFeedback() – Bulle de confirmation flottante et temporaire au-dessus d'un bouton
 * icône de la barre d'actions. Utilisée à la place d'un changement de texte DANS le bouton
 * (qui casserait la taille fixe des boutons icône compacts — voir .qa-icon-btn).
 */
function _flashQaFeedback(button, text) {
  const bubble = document.createElement('div');
  bubble.className = 'qa-flash-toast';
  bubble.textContent = text;
  document.body.appendChild(bubble);
  const rect = button.getBoundingClientRect();
  bubble.style.left = Math.max(4, rect.left + rect.width / 2) + 'px';
  bubble.style.top = (rect.top - 8) + 'px';
  setTimeout(() => bubble.classList.add('qa-flash-toast-hide'), 1300);
  setTimeout(() => bubble.remove(), 1650);
}

function adjustSrFrequency(questionIdx, button, direction) {
  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
  if (!uid) {
    alert("Vous devez être connecté pour ajuster la fréquence de révision.");
    return;
  }
  const question = currentQuestions[questionIdx];
  if (!question) {
    console.error("Question introuvable dans la catégorie sélectionnée.");
    return;
  }
  // Même précaution que pour les réponses : tant que l'historique n'est pas chargé, `prev`
  // serait un objet vide et l'écriture ci-dessous remplacerait l'entrée réelle (statut,
  // failCount, successCount) par une entrée amputée ne contenant que la planification.
  if (!window._responsesReady) {
    _flashQaFeedback(button, '⏳ Chargement…');
    return;
  }
  const key = getKeyFor(question);
  const prev = currentResponses[key] || {};
  const prevInterval = prev.srInterval || 1;
  const newInterval = direction === 'easier'
    ? Math.min(365, Math.max(7, Math.round(prevInterval * 2)))
    : Math.max(1, Math.round(prevInterval / 3));
  const nextReviewMs = Date.now() + newInterval * 24 * 60 * 60 * 1000;
  const entry = { ...prev, srInterval: newInterval, nextReview: nextReviewMs };

  /* L'effet est appliqué et confirmé IMMÉDIATEMENT, avant toute écriture réseau.
     Auparavant la confirmation attendait la réponse du serveur : hors-ligne, cette écriture
     mettait une vingtaine de secondes à abandonner, si bien que le bouton semblait n'avoir
     strictement aucun effet — on recliquait, sans plus de résultat. La décision de l'utilisateur
     est locale et immédiate ; sa transmission au serveur est un détail d'intendance qui n'a
     aucune raison de le faire attendre. */
  currentResponses[key] = entry;
  const when = new Date(nextReviewMs);
  const dateLabel = when.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  _flashQaFeedback(button,
    (direction === 'easier' ? '✅ ' : '🔴 ') + 'Revoir dans ' + newInterval + ' j — le ' + dateLabel);
  updateModeCounts();

  // Le miroir local doit connaître l'ajustement : sans lui, un rechargement de page reconstruit
  // currentResponses depuis le miroir, l'ajustement disparaît, et la clé restée « en attente »
  // n'aurait plus aucune valeur à envoyer à la reconnexion.
  if (typeof _mirrorApplyDelta === 'function') {
    _mirrorApplyDelta(uid, { [key]: entry }).catch(() => {});
  }

  _saveResponsesSharded(uid, { [key]: entry })
    .then(res => {
      if (res && res.pending) {
        _flashQaFeedback(button, '📴 Enregistré — synchro à la reconnexion');
      }
    })
    .catch(async () => {
      console.warn('[offline] adjustSrFrequency : 2e tentative');
      try {
        await _saveResponsesSharded(uid, { [key]: entry });
      } catch (e2) {
        console.error('[offline] adjustSrFrequency échec définitif:', e2);
        // Noter la clé pour rejeu : l'ajustement ne doit pas rester coincé sur cet appareil.
        if (typeof _markPendingSync === 'function') _markPendingSync(uid, key, entry);
        _flashQaFeedback(button, '📴 Enregistré ici — synchro à la reconnexion');
      }
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
    const isSuspended = (currentResponses[key] && currentResponses[key].suspended === true);

    // Conteneur flex pour tous les boutons d'action
    const row = document.createElement('div');
    row.className = 'question-actions-row';

    const btn = document.createElement('button');
    btn.textContent = isMarked ? "🗑️" : "🔖";
    btn.title       = isMarked ? "Supprimer le marquage" : "Marquer cette question";
    btn.className   = (isMarked ? "delete-button" : "mark-button") + " qa-icon-btn";
    btn.onclick     = () => toggleMarquerQuestion(idx, btn);
    row.appendChild(btn);

    const btnImp = document.createElement('button');
    btnImp.textContent = isImportant ? "⭐" : "☆";
    btnImp.title       = isImportant ? "Retirer Important" : "Marquer comme important";
    btnImp.className   = (isImportant ? "delete-button" : "mark-button") + " qa-icon-btn";
    btnImp.onclick     = () => toggleImportantQuestion(idx, btnImp);
    row.appendChild(btnImp);

    // Bouton Ma note (dans la même ligne)
    const btnNote = document.createElement('button');
    btnNote.className = 'note-toggle-btn qa-icon-btn';
    btnNote.textContent = '📝';
    btnNote.title = 'Ma note personnelle';
    btnNote.onclick = () => _toggleNoteEditor(key, btnNote);
    row.appendChild(btnNote);

    // Bouton "Ne plus revoir" (suspend) : sort la question de toute sélection automatique
    const btnSuspend = document.createElement('button');
    btnSuspend.textContent = isSuspended ? "↩️" : "🚫";
    btnSuspend.className   = (isSuspended ? "unimportant-button" : "delete-button") + " qa-icon-btn";
    btnSuspend.title = isSuspended
      ? "Revoir à nouveau (réactiver cette question)"
      : "Ne plus revoir — cette question ne réapparaîtra plus dans les modes automatiques (mixte, révisions, objectif du jour, etc.)";
    btnSuspend.onclick = () => toggleSuspendQuestion(idx, btnSuspend);
    row.appendChild(btnSuspend);

    // Boutons de répétition espacée manuelle : ajuster la fréquence sans attendre la
    // prochaine réponse (utile pour signaler tout de suite "c'était facile" / "c'était dur").
    const btnEasier = document.createElement('button');
    btnEasier.textContent = "📉";
    btnEasier.className = "unimportant-button qa-icon-btn";
    btnEasier.title = "Moins souvent — repousser la prochaine révision de cette question (jugée facile)";
    btnEasier.onclick = () => adjustSrFrequency(idx, btnEasier, 'easier');
    row.appendChild(btnEasier);

    const btnHarder = document.createElement('button');
    btnHarder.textContent = "🔁";
    btnHarder.className = "delete-button qa-icon-btn";
    btnHarder.title = "Plus souvent — rapprocher la prochaine révision de cette question (jugée difficile)";
    btnHarder.onclick = () => adjustSrFrequency(idx, btnHarder, 'harder');
    row.appendChild(btnHarder);

    // Bouton ✏️ "Corriger la bonne réponse" — déjà posé par _buildCorrectionCardHtml() sur
    // l'écran de correction, mais cette fonction supprime toute .question-actions-row
    // existante avant de reconstruire la sienne : on doit donc le réinjecter ici pour ne pas
    // le faire disparaître.
    if (typeof _correctOverrideBtnHtml === 'function') {
      row.insertAdjacentHTML('beforeend', _correctOverrideBtnHtml(key));
    }

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

/**
 * _refreshCategoryInfoBarLive() – Recalcule et réaffiche IMMÉDIATEMENT la barre de progression
 * de catégorie (en haut du quiz) après chaque réponse, à partir de window._categoryFullList
 * (figée une fois par initQuiz()) et de currentResponses (mise à jour au clic). Avant ce
 * correctif, cette barre n'était calculée qu'une fois au chargement de la page — répondre à des
 * questions pendant la session ne la faisait jamais bouger, seul un retour à l'accueil (ou un
 * rechargement) la rafraîchissait.
 */
function _refreshCategoryInfoBarLive() {
  if (!window._categoryFullList || !window._categoryFullList.length) return;
  let nbRatees = 0, nbNonvues = 0;
  window._categoryFullList.forEach(q => {
    const r = currentResponses[getKeyFor(q)];
    if (_isUnseen(r)) nbNonvues++;
    else if (_effectiveStatus(r) === 'ratée') nbRatees++;
  });
  updateCategoryInfoBar(selectedCategory, nbRatees + nbNonvues, window._categoryFullList.length);
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
    let restoredFlags = [];
    try { restoredFlags = JSON.parse(localStorage.getItem('quizFilterFlags') || '[]'); } catch (e) { /* ignore */ }
    await filtrerQuestions(modeQuiz, nbQuestions, restoredFlags);
    if (typeof _setLocalStorageWithCleanup === 'function') {
      _setLocalStorageWithCleanup('currentQuestions', JSON.stringify(currentQuestions));
    } else {
      try { localStorage.setItem('currentQuestions', JSON.stringify(currentQuestions)); } catch (e) { /* best-effort */ }
    }
  }

  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');

  // Afficher le quiz IMMÉDIATEMENT sans attendre Firestore (qui peut bloquer 10-15s offline)
  afficherQuiz();

  // Afficher immédiatement le nom de la catégorie
  updateCategoryInfoBar(selectedCategory, null, null);

  // Charger les réponses en arrière-plan, puis mettre à jour les boutons marquer/important
  // (_loadMergedResponses lit le document principal ET tous ses shards — voir js/offline.js)
  _loadMergedResponses(uid).then(async (doc) => {
    const data = doc.exists ? doc.data() : {};
    // FUSION (et non remplacement) avec ce qui a pu être répondu entre l'affichage du quiz
    // ci-dessus et l'arrivée de ces données : un remplacement pur effaçait localement une
    // réponse tout juste donnée (le serveur avait été lu AVANT son écriture), et la question
    // réapparaissait ensuite comme jamais répondue.
    currentResponses = _mergeResponsesPreferringLocal(
      normalizeResponses(data.responses || {}),
      currentResponses || {}
    );
    _markResponsesReady();
    if (typeof _migrateStatusLogToSubcollection === 'function') {
      _migrateStatusLogToSubcollection(uid).catch(e => console.warn('[initQuiz] migration statusLog:', e));
    }
    _currentSessionCount = data.quizSessionCount || 0;
    // Sync daily stats from Firestore (cross-device)
    const _dailyHist = data.dailyHistory || {};
    if (Object.keys(_dailyHist).length) {
      try {
        const _n = new Date();
        const _tk = _n.getFullYear()+'-'+String(_n.getMonth()+1).padStart(2,'0')+'-'+String(_n.getDate()).padStart(2,'0');
        const _utk = _n.toISOString().slice(0,10);
        const _sv = _dailyHist[_tk] || 0;
        const _lr = parseInt(localStorage.getItem('dailyCountRatchet_'+_utk)) || 0;
        if (_sv > _lr) {
          localStorage.setItem('dailyCountRatchet_'+_utk, _sv);
          localStorage.setItem('dailyAnswered_'+_utk, _sv);
        }
        // Sync backup history
        const _dhb = JSON.parse(localStorage.getItem('dailyHistoryBackup') || '{}');
        let _dhc = false;
        for (const [k,v] of Object.entries(_dailyHist)) { if (v > (_dhb[k]||0)) { _dhb[k]=v; _dhc=true; } }
        if (_dhc) localStorage.setItem('dailyHistoryBackup', JSON.stringify(_dhb));
        updateDailyStatsBar(Math.max(_sv, _lr), _dailyHist);
      } catch(e) { /* ignore */ }
    }
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
      const isAggregate = _isAggregateCategory(normalizedSel);
      const fullList = isAggregate ? questions : questions.filter(q => q.categorie === normalizedSel);
      // Conservée pour _refreshCategoryInfoBarLive() : permet de recalculer la barre à chaque
      // réponse (voir plus bas) sans re-fetcher/filtrer la liste complète à chaque clic.
      window._categoryFullList = fullList;
      let nbRatees = 0, nbNonvues = 0;
      fullList.forEach(q => {
        const r = currentResponses[getKeyFor(q)];
        if (_isUnseen(r)) { nbNonvues++; }
        else if (_effectiveStatus(r) === 'ratée') { nbRatees++; }
      });
      updateCategoryInfoBar(selectedCategory, nbRatees + nbNonvues, fullList.length);
      currentQuestions = savedCurrent; // restaurer le quiz en cours
    } catch (e) {
      console.warn('[categoryInfo] Impossible de calculer les stats catégorie:', e.message);
    }
  }).catch(e => {
    console.warn('[offline] Impossible de charger les réponses:', e.message);
    currentResponses = currentResponses || {};
    // Même en échec, débloquer la file : mieux vaut enregistrer avec un historique incomplet
    // que de perdre purement et simplement les réponses de la session en cours.
    _markResponsesReady();
  });

  // Compteur quotidien en tâche de fond (non bloquant)
  displayDailyStats(uid).catch(e => console.warn('[initQuiz] displayDailyStats error:', e));
}

/**
 * afficherQuiz() – Affiche les questions du quiz sur quiz.html
 */
/**
 * _updateSessionProgress() – Suivi de la série EN COURS, réactualisé à chaque réponse.
 *
 * Affiche toujours l'avancement (répondues / total). Le SCORE, lui, n'apparaît qu'en correction
 * immédiate : en correction différée, l'utilisateur choisit délibérément de ne pas savoir s'il
 * a juste avant d'avoir tout validé — afficher un compteur de bonnes réponses reviendrait à lui
 * révéler, question après question, exactement ce qu'il a demandé à ne pas voir, et à lui
 * permettre de corriger ses réponses précédentes en conséquence.
 *
 * Tout est recalculé à partir de `currentQuizAnswers` (localStorage), qui est la source déjà
 * utilisée pour restaurer une série interrompue : le bandeau reste donc juste après un
 * rechargement de page, y compris hors-ligne, sans compteur parallèle à tenir à jour.
 */
function _updateSessionProgress() {
  const box = document.getElementById('sessionProgress');
  if (!box) return;

  const questions = (typeof currentQuestions !== 'undefined' && currentQuestions) ? currentQuestions : [];
  const total = questions.length;
  // Pas de série en cours, ou série déjà validée : le récapitulatif de résultat prend le relais.
  if (!total || window._quizValidated) { box.style.display = 'none'; return; }

  let answers = {};
  try { answers = JSON.parse(localStorage.getItem('currentQuizAnswers') || '{}'); } catch (e) { answers = {}; }

  let answered = 0, ok = 0, ko = 0;
  questions.forEach((q, i) => {
    const given = answers[i];
    if (given === undefined || given === null || given === '') return;
    answered++;
    const correct = (q.choix && q.choix[q.bonne_reponse]) || '';
    if (String(given).trim() === String(correct).trim()) ok++; else ko++;
  });

  const pct = total ? Math.round((answered / total) * 100) : 0;
  const fill = document.getElementById('sessionProgressFill');
  const countEl = document.getElementById('sessionProgressCount');
  const scoreEl = document.getElementById('sessionProgressScore');
  if (fill) fill.style.width = pct + '%';
  // « 20 / 25 » suivi du pourcentage d'avancement : les deux répondent à la même question sous
  // deux angles, l'un dénombrable d'un coup d'œil, l'autre immédiatement comparable d'une
  // session à l'autre quel que soit le nombre de questions.
  if (countEl) {
    countEl.innerHTML = `<b>${answered}</b> / ${total}`
      + `<span class="sp-pct">${pct} %</span>`
      + (answered >= total ? '<span class="sp-ready">prêt à valider</span>' : '');
  }
  if (scoreEl) {
    const immediate = localStorage.getItem('correctionImmediate') === '1';
    if (immediate && answered > 0) {
      const rate = Math.round((ok / answered) * 100);
      scoreEl.innerHTML = `<span class="sp-ok">✓ ${ok}</span> · <span class="sp-ko">✗ ${ko}</span> · ${rate} %`;
    } else if (!immediate && answered > 0) {
      scoreEl.textContent = (total - answered) + ' restante' + ((total - answered) > 1 ? 's' : '');
    } else {
      scoreEl.textContent = '';
    }
  }
  box.style.display = 'block';
}
window._updateSessionProgress = _updateSessionProgress;

function afficherQuiz() {
  // Reset validation state pour le nouveau quiz
  window._quizValidated = false;
  window._immediateAnswers = {};
  window._immediateSavedEntries = {};
  window._immediatePrevStatus = {};
  window._sessionPrevSnapshot = {};
  // Un nouveau lot de questions vient d'être (re)chargé : toute session de Mode Assistance
  // précédente n'a plus de sens (autres questions, autre ordre) — la fermer sans scroll.
  if (typeof _exitAssistMode === 'function') _exitAssistMode(true);

  const cont = document.getElementById('quizContainer');
  if (!cont) return;

  if (!currentQuestions.length) {
    cont.innerHTML = `<p style="color:red;">Aucune question chargée.<br>
      Retournez à l'accueil et cliquez sur «Démarrer le Quiz».</p>`;
    if (typeof _updateResetBtnVisibility === 'function') _updateResetBtnVisibility(true);
    if (typeof _updateAssistBtnVisibility === 'function') _updateAssistBtnVisibility(false);
    return;
  }
  if (typeof _updateAssistBtnVisibility === 'function') _updateAssistBtnVisibility(true);

  // Suivi du temps réel par question (voir helpers.js _qt*) : initialiser le tracker
  // idle-aware et figer MAINTENANT quelles questions sont "nouvelles" vs "déjà vues" —
  // une réponse en cours de session écrase currentResponses[key], donc ce snapshot doit
  // être pris avant toute réponse, pas au moment où l'utilisateur répond.
  if (typeof _qtInit === 'function') _qtInit();
  window._qtIsNewByIdx = currentQuestions.map(q =>
    (typeof _isUnseen === 'function') ? _isUnseen(currentResponses[getKeyFor(q)]) : true);
  window._qtLastTouchedIdx = null;
  if (typeof _qtResetElapsed === 'function') _qtResetElapsed();

  // Restaurer les réponses déjà cochées, pour qu'un changement de page / rechargement
  // pendant une session ne fasse pas tout perdre. Les réponses sont mémorisées par TEXTE
  // du choix (pas par index) car l'ordre des choix est re-mélangé à chaque appel de
  // afficherQuiz() — un index brut ne serait plus valide.
  let savedAnswers = {};
  try { savedAnswers = JSON.parse(localStorage.getItem('currentQuizAnswers') || '{}'); } catch (e) { savedAnswers = {}; }

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

    const savedText = savedAnswers[idx];
    const savedIdx = (savedText !== undefined) ? q.choix.indexOf(savedText) : -1;

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
               <input type="radio" name="qidx${idx}" value="${i}"${i === savedIdx ? ' checked' : ''}> <span>${c}</span>
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

  // Sauvegarder chaque réponse au fil de l'eau (survit à une navigation vers une autre
  // page puis un retour, ou un rechargement) — écouteur délégué posé une seule fois.
  if (!cont._answerSaveListenerAttached) {
    cont._answerSaveListenerAttached = true;
    cont.addEventListener('change', (e) => {
      const radio = e.target;
      if (!radio.matches || !radio.matches('input[type="radio"]')) return;
      const m = radio.name.match(/^qidx(\d+)$/);
      if (!m) return;
      const qIdx = parseInt(m[1]);
      const q2 = currentQuestions[qIdx];
      if (!q2) return;

      // Suivi du temps réel par question : le temps actif écoulé depuis la dernière
      // réponse cochée (ou le début de la session/du lot pour la 1ère réponse) correspond
      // au temps passé sur CETTE question — donc on l'enregistre ICI, au moment du clic,
      // puis on repart de zéro pour la suivante. Reconsidérer la réponse déjà cochée de la
      // MÊME question (changement d'avis) ne recompte rien de plus (chrono inchangé).
      if (window._qtLastTouchedIdx !== qIdx) {
        if (typeof _qtElapsedMs === 'function' && typeof _qtRecordSample === 'function') {
          const ms = _qtElapsedMs();
          const sec = ms / 1000;
          const isNew = window._qtIsNewByIdx ? window._qtIsNewByIdx[qIdx] : true;
          _qtRecordSample(sec, isNew);
          // Temps réel cumulé pour LA SESSION ENTIÈRE (affiché à la validation, voir
          // validerReponses()) — distinct de l'apprentissage EMA ci-dessus qui alimente
          // l'estimation "~X min" de l'accueil.
          if (typeof _qtAddSessionTime === 'function') _qtAddSessionTime(ms, qIdx);
        }
        window._qtLastTouchedIdx = qIdx;
        if (typeof _qtResetElapsed === 'function') _qtResetElapsed();
      }

      try {
        const saved = JSON.parse(localStorage.getItem('currentQuizAnswers') || '{}');
        saved[qIdx] = q2.choix[parseInt(radio.value)];
        localStorage.setItem('currentQuizAnswers', JSON.stringify(saved));
      } catch (e2) { /* localStorage plein, tant pis */ }
      // Le bandeau se relit depuis currentQuizAnswers : l'appeler APRÈS l'écriture ci-dessus.
      if (typeof _updateSessionProgress === 'function') _updateSessionProgress();

      // Mode normal (correction différée) : persister aussi la progression (statut +
      // planification SR) dès le clic — le mode immédiat le fait déjà dans
      // handleImmediateAnswer. Comme la réponse peut encore être CHANGÉE avant la
      // validation, on garde un instantané de l'état d'origine de la question et on
      // recalcule l'entrée depuis cet instantané à chaque changement (sinon changer
      // d'avis appliquerait deux fois la planification / le failCount).
      if (localStorage.getItem('correctionImmediate') !== '1' && !_isPracticeMode()) {
        try {
          const key2 = getKeyFor(q2);
          window._sessionPrevSnapshot = window._sessionPrevSnapshot || {};
          window._immediatePrevStatus = window._immediatePrevStatus || {};
          window._immediateSavedEntries = window._immediateSavedEntries || {};
          if (!(key2 in window._sessionPrevSnapshot)) {
            window._sessionPrevSnapshot[key2] = currentResponses[key2];
            window._immediatePrevStatus[key2] = currentResponses[key2]?.status;
          }
          const orig = window._sessionPrevSnapshot[key2];
          if (orig === undefined) delete currentResponses[key2];
          else currentResponses[key2] = orig;
          const entry2 = _computeSrEntry(q2, parseInt(radio.value));
          currentResponses[key2] = entry2;
          window._immediateSavedEntries[key2] = entry2;
          _persistImmediateEntry(key2, entry2);
          if (typeof _refreshCategoryInfoBarLive === 'function') _refreshCategoryInfoBarLive();
        } catch (e3) { console.warn('[SR au clic] échec:', e3); }
      }
    });
  }

  // Mode normal : relier les réponses restaurées (cochées avant une navigation/rechargement)
  // à leurs entrées déjà persistées au clic d'origine, pour que la validation ne recalcule
  // pas la planification SR une seconde fois (même principe que la restauration immédiate).
  if (localStorage.getItem('correctionImmediate') !== '1') {
    Object.keys(savedAnswers).forEach(idxStr => {
      const rIdx = parseInt(idxStr);
      const rq = currentQuestions[rIdx];
      if (!rq) return;
      const rKey = getKeyFor(rq);
      if (currentResponses[rKey] && currentResponses[rKey].status !== undefined) {
        window._immediateSavedEntries[rKey] = currentResponses[rKey];
      }
    });
  }

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

    currentQuestions.forEach((q, idx) => {
      const radios = document.querySelectorAll(`input[name="qidx${idx}"]`);
      radios.forEach(radio => {
        radio.addEventListener('change', () => handleImmediateAnswer(q, radio, idx));
      });
      // Ré-appliquer score/désactivation/coloration/explication pour les questions déjà
      // répondues avant une navigation ailleurs puis un retour sur le quiz.
      const checkedRadio = document.querySelector(`input[name="qidx${idx}"]:checked`);
      if (checkedRadio) handleImmediateAnswer(q, checkedRadio, idx, true);
    });
  }

  _setupQuizPagination();

  // Bouton ✏️ "Corriger la bonne réponse" — posé une seule fois, réutilisé aussi bien pour la
  // coloration immédiate (handleImmediateAnswer) que pour la correction en fin de quiz
  // (afficherCorrection), qui réutilisent toutes les deux ce même #quizContainer.
  if (typeof _wireCorrectOverrideButtons === 'function') {
    _wireCorrectOverrideButtons(cont, key => currentQuestions.find(qq => getKeyFor(qq) === key));
  }

  // État de départ : couvre aussi bien une série neuve qu'une série REPRISE après un
  // rechargement de page, puisque le compte est relu depuis currentQuizAnswers.
  _updateSessionProgress();
}

/**
 * _setupQuizPagination() – Toutes les questions étant affichées d'un coup, il n'y a plus de
 * lots à naviguer : rend juste "Valider" visible et masque "Nouvelles Questions" pendant la
 * session en cours.
 */
function _setupQuizPagination() {
  document.querySelectorAll('.quiz-pagination-bar').forEach(el => el.remove());
  _updateResetBtnVisibility(false);
  _updateQuizValidateVisibility(true);
}

/**
 * _updateQuizValidateVisibility() – Masque le bouton "Valider les Réponses" tant que
 * l'utilisateur n'a pas parcouru tous les lots (voir _setupQuizPagination pour le pourquoi).
 */
function _updateQuizValidateVisibility(show) {
  const btn = document.querySelector('.quiz-actions-bar .quiz-btn-validate');
  if (btn) btn.style.display = show ? '' : 'none';
}

/**
 * _updateResetBtnVisibility() – Affiche/masque "Nouvelles Questions". Masqué pendant une
 * session en cours (une seule action à la fois : Suivant, puis Valider), ré-affiché après
 * la validation ou quand aucune question n'est chargée.
 */
function _updateResetBtnVisibility(show) {
  const btn = document.getElementById('resetQuizBtn');
  if (btn) btn.style.display = show ? '' : 'none';
}

/**
 * _updateAssistBtnVisibility() – Affiche/masque le bouton d'entrée en Mode Assistance.
 * Visible dès qu'un quiz est chargé sur cette page (quel que soit le mode : répétition
 * espacée, révision, mixte...), masqué une fois la session validée (plus rien à répondre).
 */
function _updateAssistBtnVisibility(show) {
  const btn = document.getElementById('assistModeToggleBtn');
  if (btn) btn.style.display = show ? '' : 'none';
}

/**
 * _computeSrEntry() – Calcule l'entrée de réponse (statut + planification de répétition
 * espacée + historique) pour une question répondue, à partir de l'état ACTUEL de
 * currentResponses[key]. Source unique de vérité utilisée à la fois par validerReponses()
 * (mode normal) et handleImmediateAnswer() (mode correction immédiate, persistance au clic).
 * NE modifie PAS currentResponses — c'est à l'appelant de décider quand l'appliquer.
 */
function _computeSrEntry(q, selectedVal) {
    const key = getKeyFor(q);
    const hasExisting = !!currentResponses[key];
    const wasMarked = hasExisting ? (currentResponses[key].marked === true) : undefined;
    const wasImportant = hasExisting ? (currentResponses[key].important === true) : undefined;
    const prevFailCount = hasExisting ? (currentResponses[key].failCount || 0) : 0;
    const prevSuccessCount = hasExisting ? (currentResponses[key].successCount || 0) : 0;
    const status = selectedVal === q.bonne_reponse ? 'réussie' : 'ratée';

    // Répétition espacée : calculer le prochain intervalle
    const prevInterval = hasExisting ? (currentResponses[key].srInterval || 0) : 0;
    let newInterval;
    if (status === 'réussie') {
      // Bonne réponse : augmenter l'intervalle. Le plafond dépend de la fiabilité de la
      // question : une question jamais ratée peut monter jusqu'à 365j (on arrête de vous
      // la ressasher une fois qu'elle est clairement acquise), une question ratée 1-2 fois
      // plafonne à 120j, au-delà elle reste plus surveillée (60j). Le multiplicateur de
      // croissance est aussi réduit pour les questions historiquement difficiles.
      // Une toute première bonne réponse saute directement à 3j (pas 1j) : revoir une
      // question réussie dès le lendemain n'apporte rien, elle est déjà fraîche en mémoire.
      if (prevInterval <= 0) newInterval = 3;
      else if (prevInterval === 1) newInterval = 3;
      else {
        const growthFactor = Math.max(1.3, 2.5 / (1 + prevFailCount * 0.25));
        const cap = prevFailCount === 0 ? 365 : (prevFailCount <= 2 ? 120 : 60);
        newInterval = Math.min(Math.round(prevInterval * growthFactor), cap);
      }
    } else {
      // Mauvaise réponse : "lapse doux" pour les questions qui avaient déjà un peu de vécu
      // (intervalle >= 3j) — on retombe à 30% de l'intervalle précédent plutôt qu'un reset
      // brutal à 1 jour, pour éviter qu'une question presque maîtrisée qui trébuche une fois
      // ne revienne aussi souvent qu'une question jamais vue. Une question tout juste
      // découverte (intervalle 0 ou 1) repart bien à 1 jour.
      newInterval = (prevInterval >= 3) ? Math.max(1, Math.round(prevInterval * 0.3)) : 1;
    }
    const nextReviewMs = Date.now() + newInterval * 24 * 60 * 60 * 1000;

    // NOTE : ni `category` ni `questionId` ne sont stockés ici — les deux sont 100% redondants
    // avec la CLÉ de l'entrée (getKeyFor(q) = "question_" + catégorie normalisée + "_" + id) et
    // n'étaient lus nulle part ailleurs dans l'app (write-only, vérifié). Sur un compte avec
    // des milliers de questions répondues, ces deux champs (dont `category`, une chaîne de
    // ~15-45 caractères) pesaient un poids mort non négligeable dans le document Firestore
    // quizProgress/{uid}, plafonné à 1 Mio — voir _stripRedundantFields() (js/stats.js) pour
    // le nettoyage rétroactif des entrées déjà existantes.
    const entry = {
        status,
        failCount: status === 'ratée' ? prevFailCount + 1 : prevFailCount,
        successCount: status === 'réussie' ? prevSuccessCount + 1 : prevSuccessCount,
        srInterval: newInterval,
        nextReview: nextReviewMs,
        timestamp: firebase.firestore.Timestamp.now()
    };
    // Historique des réponses (log par jour, utilisé par historique.html) : PAS stocké
    // inline sur l'entrée — routé séparément vers la sous-collection quizProgress/{uid}/
    // history/{key} (voir saveResponsesWithOfflineFallback() dans js/offline.js), qui a sa
    // PROPRE limite Firestore de 1 Mio par document. Avant cette architecture, un historique
    // cumulé (jusqu'à 100 entrées/question) dans le document principal unique finissait par
    // dépasser cette limite sur des milliers de questions répondues, ce qui faisait échouer
    // TOUTE écriture (même sur d'autres questions) sans aucun indice visible avant l'ajout
    // du message d'erreur explicite. _pendingLogEntry est un marqueur transitoire : il n'est
    // jamais persisté tel quel dans responses.<key>, offline.js l'extrait avant d'écrire.
    entry._pendingLogEntry = { status, ts: Date.now() };
    // Ne pas écraser marked/important si les réponses Firestore n'ont pas encore chargé
    if (wasMarked !== undefined) entry.marked = wasMarked;
    if (wasImportant !== undefined) entry.important = wasImportant;
    // Mode marquées : planifier la ré-interrogation à session+3
    if (status === 'ratée' && wasMarked) {
      entry.retryAfterSession = (_currentSessionCount || 0) + 3;
    }
    return entry;
}

/**
 * _persistImmediateEntry() – Sauvegarde la réponse donnée (mode correction immédiate ou clic
 * en mode normal). AVANT ce mécanisme, rien n'était écrit dans Firestore tant que la session
 * complète n'était pas validée : abandonner une session de 37 questions après en avoir répondu
 * 22 perdait les 22 réponses — statut et planification de révision inclus — et les mêmes
 * questions revenaient en "révisions dues" à la session suivante.
 *
 * Écriture lancée IMMÉDIATEMENT au clic (pas de debounce) : un debounce (même court, ex. 800ms)
 * fait courir un vrai risque de perte — si l'utilisateur quitte la page dans cet intervalle
 * (retour, changement d'onglet), le setTimeout en attente est détruit avant de s'être jamais
 * déclenché, et la réponse n'atteint donc jamais db.collection(...).update(), pas même la file
 * d'attente locale de persistance Firestore (IndexedDB) — c'est arrivé en pratique même avec un
 * flush sur 'visibilitychange'/'pagehide' en filet de sécurité, la chaîne de promesses vers
 * l'écriture n'ayant pas forcément le temps de s'exécuter avant que le navigateur ne coupe le
 * contexte JS de la page en cours de navigation. Lancer l'écriture dès le clic lui donne le
 * maximum de temps possible pour aboutir avant que l'utilisateur ne parte (ce qui suppose un
 * nouveau geste de sa part, donc un délai physique d'au moins quelques centaines de ms).
 */
/* ============================================================================
   Réponses données AVANT que l'historique ne soit chargé
   ----------------------------------------------------------------------------
   initQuiz() affiche volontairement le quiz sans attendre Firestore (qui peut bloquer
   plus de 10 s sur un réseau lent), puis charge currentResponses en arrière-plan. Toute
   réponse donnée dans cet intervalle était calculée sur un historique VIDE :
   _computeSrEntry() voyait prevInterval = 0, donc « première réussite → revoir dans 3 j »,
   et remettait failCount/successCount à zéro — une question planifiée à 60 jours retombait
   à 3, en perdant tout son historique. La réponse était ensuite écrasée localement par le
   remplacement de currentResponses (le serveur ayant été lu avant l'écriture).

   Le cas se produit surtout à la reprise d'une session le lendemain : le filet anti-bfcache
   (helpers.js) recharge la page quand le téléphone est déverrouillé, et l'utilisateur
   enchaîne aussitôt les réponses — donc en plein dans cette fenêtre, question après question.

   Désormais l'affichage et la coloration restent immédiats, mais le CALCUL de la
   planification et son écriture sont mis en file d'attente jusqu'à ce que l'historique
   réel soit disponible. */
window._responsesReady = false;
window._pendingAnswers = [];

function _markResponsesReady() {
  if (window._responsesReady) return;
  window._responsesReady = true;
  const queued = window._pendingAnswers || [];
  window._pendingAnswers = [];
  if (queued.length) {
    console.log('[SR] Historique chargé — traitement de ' + queued.length + ' réponse(s) en attente');
  }
  queued.forEach(({ q, selectedVal, isCorrect }) => _recordAnswerNow(q, selectedVal, isCorrect));
}

/* _mergeResponsesPreferringLocal() – Fusionne les réponses du serveur avec celles déjà
   présentes en mémoire, en conservant l'entrée locale quand le serveur ne la connaît pas
   ou quand elle est authentiquement plus récente (même règle de comparaison que la fusion
   des shards dans js/offline.js). */
function _mergeResponsesPreferringLocal(serverResponses, localResponses) {
  const _ms = t => (t && (t.seconds !== undefined ? t.seconds * 1000 : t)) || 0;
  const merged = { ...(serverResponses || {}) };
  Object.keys(localResponses || {}).forEach(k => {
    const local = localResponses[k];
    if (!local) return;
    const server = merged[k];
    if (server === undefined || _ms(local) > _ms(server)) merged[k] = local;
  });
  return merged;
}

/* _recordAnswerNow() – Calcule la planification SR d'une réponse et la persiste. Appelé
   directement quand l'historique est déjà chargé, sinon depuis la file d'attente. */
function _recordAnswerNow(q, selectedVal, isCorrect) {
  const key = getKeyFor(q);
  if (!window._immediateSavedEntries) window._immediateSavedEntries = {};
  if (!window._immediatePrevStatus) window._immediatePrevStatus = {};
  if (!window._immediateOrigSnapshot) window._immediateOrigSnapshot = {};
  if (!(key in window._immediatePrevStatus)) {
    window._immediatePrevStatus[key] = currentResponses[key]?.status;
  }
  // Changer d'avis : l'utilisateur peut recliquer une autre réponse après avoir déjà répondu
  // (voir handleImmediateAnswer, qui ne désactive plus les radios). Il faut alors recalculer
  // depuis l'état d'AVANT la toute première réponse donnée à cette question dans cette page —
  // jamais depuis l'entrée intermédiaire qu'on vient nous-mêmes d'écrire au clic précédent,
  // sinon un simple correctif de clic compterait comme une 2e révision distincte (planification
  // et failCount doublés). Même principe déjà utilisé en mode correction différée, ligne ~1040.
  if (!(key in window._immediateOrigSnapshot)) {
    window._immediateOrigSnapshot[key] = currentResponses[key];
  }
  const orig = window._immediateOrigSnapshot[key];
  if (orig === undefined) delete currentResponses[key]; else currentResponses[key] = orig;
  const entry = _computeSrEntry(q, selectedVal);
  window._immediateSavedEntries[key] = entry;
  currentResponses[key] = entry;
  if (!isCorrect) _logWrongAnswer(q, selectedVal);
  _persistImmediateEntry(key, entry);
  if (typeof _refreshCategoryInfoBarLive === 'function') _refreshCategoryInfoBarLive();
}

let _immPersistPending = {};
function _persistImmediateEntry(key, entry) {
  _immPersistPending[key] = entry;
  _flushImmPersist();
}

/**
 * _showSaveStatus() – Petit indicateur visuel discret, en bas de l'écran, confirmant (ou pas)
 * que la réponse a bien été écrite sur le serveur. AVANT ce fix, saveResponsesWithOfflineFallback
 * avalait silencieusement toute erreur d'écriture (voir js/offline.js) — la réponse semblait
 * "prise en compte" côté UI (couleur verte/rouge appliquée localement) sans AUCUN indice que
 * l'écriture réelle avait échoué, jusqu'à ce que la question réapparaisse "à revoir" des jours
 * plus tard sans explication possible. Utile aussi pour diagnostiquer un vrai souci réseau/règles
 * Firestore côté utilisateur, puisqu'un message d'erreur concret s'affiche directement.
 */
function _showSaveStatus(ok, msg) {
  let el = document.getElementById('srSaveStatus');
  if (!el) {
    el = document.createElement('div');
    el.id = 'srSaveStatus';
    el.style.cssText = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:10000;'
      + 'padding:7px 16px;border-radius:20px;font-size:.82em;font-weight:600;color:#fff;'
      + 'box-shadow:0 2px 10px rgba(0,0,0,.35);transition:opacity .25s;pointer-events:none;'
      + 'max-width:92vw;text-align:center;opacity:0';
    document.body.appendChild(el);
  }
  el.style.background = ok ? 'rgba(46,125,50,.95)' : 'rgba(198,40,40,.95)';
  el.textContent = ok ? '✅ Réponse enregistrée' : ('❌ Échec de sauvegarde : ' + (msg || 'erreur inconnue'));
  el.style.opacity = '1';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.style.opacity = '0'; }, ok ? 1300 : 7000);
}

/** _flushImmPersist() – Envoie toutes les entrées en attente à Firestore sans attendre. */
function _flushImmPersist() {
  const batch = _immPersistPending;
  _immPersistPending = {};
  if (Object.keys(batch).length === 0) return;
  const uid = (typeof auth !== 'undefined' && auth.currentUser?.uid) || localStorage.getItem('cachedUid');
  if (!uid || typeof saveResponsesWithOfflineFallback !== 'function') {
    _showSaveStatus(false, uid ? 'fonction de sauvegarde indisponible' : 'utilisateur non identifié');
    return;
  }
  saveResponsesWithOfflineFallback(uid, batch)
    .then(() => _showSaveStatus(true))
    .catch(e => {
      console.warn('[SR incrémental] échec sauvegarde:', e);
      _showSaveStatus(false, e && e.message ? e.message : String(e));
    });
}
// Filet de sécurité : si un appel venait à être remis en file d'attente sans flush immédiat
// (ex. futur appelant groupé), s'assurer que rien ne reste bloqué à la fermeture de la page.
/* Page quittée alors que des réponses attendent encore l'historique : les traiter quand même
   (avec l'historique dont on dispose) plutôt que de les perdre. Une planification raccourcie
   se rattrape à la réponse suivante ; une réponse jamais écrite, non. */
function _flushBeforeLeaving() {
  if (!window._responsesReady && (window._pendingAnswers || []).length) {
    console.warn('[SR] Page quittée avec des réponses en attente — enregistrement immédiat');
    _markResponsesReady();
  }
  _flushImmPersist();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') _flushBeforeLeaving();
});
window.addEventListener('pagehide', _flushBeforeLeaving);

/**
 * handleImmediateAnswer() – Gère la correction immédiate d'une question
 * @param {boolean} isRestore - true quand on ré-affiche une réponse déjà donnée avant une
 *   navigation/rechargement (pas une vraie nouvelle réponse) : dans ce cas on ne relit pas
 *   la bonne réponse à voix haute, on ne la remet pas dans la file de ré-interrogation, et
 *   on ne déclenche pas la validation automatique de fin de quiz.
 */
function handleImmediateAnswer(q, selectedRadio, idx, isRestore) {
  // Le score en direct n'existe que dans ce mode : le tenir à jour ici aussi, et pas seulement
  // dans le gestionnaire du mode différé.
  setTimeout(function () {
    if (typeof _updateSessionProgress === 'function') _updateSessionProgress();
  }, 0);
  if (typeof _applyStoredCorrectOverride === 'function') {
    _applyStoredCorrectOverride(q, currentResponses[getKeyFor(q)]);
  }
  const selectedVal = parseInt(selectedRadio.value);
  const isCorrect = selectedVal === q.bonne_reponse;

  // Sauvegarder la réponse en mémoire (pour validerReponses) — indexé par position dans le tableau
  if (!window._immediateAnswers) window._immediateAnswers = {};
  // Changer d'avis : cette question a-t-elle DÉJÀ une réponse enregistrée par ce même
  // gestionnaire (pas une restauration) ? Si oui, ne pas recompter "répondue" une 2e fois, et
  // n'ajuster le score juste/faux que si le résultat a réellement changé — sinon corriger une
  // réponse gonflerait ou dégonflerait le score à tort.
  const _hadPrevAnswer = !isRestore && window._immediateAnswers[idx] !== undefined;
  const _prevWasCorrect = _hadPrevAnswer && window._immediateAnswers[idx] === q.bonne_reponse;
  window._immediateAnswers[idx] = selectedVal;

  // Persistance immédiate de la réponse (statut + planification SR) : calculée et écrite
  // MAINTENANT, pas à la validation de fin de session — abandonner en cours de route ne
  // perd plus les réponses déjà données. validerReponses() réutilisera ces entrées telles
  // quelles (via _immediateSavedEntries) au lieu de recalculer la planification une 2e fois.
  if (!window._immediateSavedEntries) window._immediateSavedEntries = {};
  if (!window._immediatePrevStatus) window._immediatePrevStatus = {};
  const _pKey = getKeyFor(q);
  if (isRestore) {
    // Réponse restaurée après un rechargement : elle a déjà été persistée au moment du
    // clic d'origine — relier l'entrée existante pour éviter tout double comptage.
    if (currentResponses[_pKey] && currentResponses[_pKey].status !== undefined) {
      window._immediateSavedEntries[_pKey] = currentResponses[_pKey];
    }
  } else if (_isPracticeMode()) {
    // Mode entraînement libre : ne rien persister (voir _isPracticeMode)
  } else if (!window._responsesReady) {
    // Historique pas encore chargé : mettre en attente plutôt que de planifier à partir
    // d'un historique vide (voir le commentaire de _markResponsesReady).
    window._pendingAnswers.push({ q, selectedVal, isCorrect });
  } else {
    _recordAnswerNow(q, selectedVal, isCorrect);
  }

  // Mettre à jour le score (idempotent en cas de changement de réponse — voir plus haut)
  if (!_hadPrevAnswer) {
    window._immediateScore.answered++;
    if (isCorrect) window._immediateScore.correct++;
  } else if (_prevWasCorrect !== isCorrect) {
    window._immediateScore.correct += isCorrect ? 1 : -1;
  }

  const scoreVal = document.getElementById('immScoreVal');
  const scoreAnswered = document.getElementById('immScoreAnswered');
  if (scoreVal) scoreVal.textContent = window._immediateScore.correct;
  if (scoreAnswered) scoreAnswered.textContent = window._immediateScore.answered;

  // Colorer sans désactiver : l'utilisateur doit pouvoir encore changer de réponse en
  // recliquant un autre choix (voir _recordAnswerNow, qui recalcule alors depuis l'état
  // d'avant cette question plutôt que depuis la réponse intermédiaire qu'on vient
  // d'enregistrer, pour ne pas compter deux révisions). On réinitialise donc la coloration
  // de TOUS les choix avant de réappliquer celle du choix actuel, plutôt que de l'empiler.
  const allRadios = document.querySelectorAll(`input[name="qidx${idx}"]`);
  allRadios.forEach(r => {
    const label = r.closest('label');
    if (!label) return;
    label.style.background = '';
    label.style.borderLeft = '';
    label.style.paddingLeft = '';
    label.style.borderRadius = '';
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

  // TTS : lire la bonne réponse à voix haute si mauvaise réponse (pas lors d'une restauration)
  if (!isCorrect && !isRestore) {
    const correctText = _resolveTtsText(q);
    // En Mode Assistance, la lecture doit être garantie (indépendante du toggle TTS global
    // et jamais interrompue par le "toggle: reclique = stop" — voir _speakCorrectAnswer).
    _speakCorrectAnswer(correctText, window._assistModeActive === true);
    // Ajouter la question à la file de ré-interrogation (2 quiz plus tard) — pas en mode entraînement libre
    if (!_isPracticeMode()) _queueForReask(q);
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
    // Historique ratée/réussie + position dans la répétition espacée — reconstruit à chaque
    // réponse (pas seulement la première) : un changement de réponse modifie ces chiffres
    // (voir _recordAnswerNow), le badge affiché doit rester exact plutôt que figé sur le
    // tout premier clic.
    const oldStatsBadge = questionBlock.querySelector('.sr-stats-badge');
    if (oldStatsBadge) oldStatsBadge.remove();
    const statsDiv = document.createElement('div');
    statsDiv.innerHTML = _srStatsHtml(q);
    if (statsDiv.firstChild) questionBlock.appendChild(statsDiv.firstChild);
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
      btn.className = 'note-toggle-btn qa-icon-btn';
      btn.textContent = '📝';
      btn.title = 'Ma note personnelle';
      btn.onclick = () => _toggleNoteEditor(key2, btn);
      row.appendChild(btn);
      // Charger et afficher la note existante
      if (_notesCache && _notesCache[key2]) {
        _renderNoteDisplay(key2, _notesCache[key2]);
      }
      if (typeof _correctOverrideBtnHtml === 'function' && !row.querySelector('.correct-override-btn')) {
        row.insertAdjacentHTML('beforeend', _correctOverrideBtnHtml(key2));
      }
    }
  }

  // Si toutes les questions sont répondues, afficher un résumé (pas lors d'une restauration :
  // si le quiz était déjà complet avant de partir, il a déjà été validé et sauvegardé)
  if (!isRestore && window._immediateScore.answered === window._immediateScore.total) {
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

// ============================================================
// Mode Assistance — vue "une question à la fois", lue à voix haute, avec avancement
// automatique au clic. Pensé pour un usage mobile mains libres : gros boutons tactiles,
// lecture TTS systématique (indépendante du toggle TTS global — voir _speakCorrectAnswer).
//
// Principe : ce mode ne recrée PAS de logique de correction/persistance à part — il pilote
// le radio réel correspondant dans le #quizContainer normal (resté en mémoire, juste masqué
// visuellement) et appelle handleImmediateAnswer() dessus, pour rester rigoureusement
// synchronisé avec la vue normale (coloration, explication, planification SR, historique) —
// qu'on retrouve intacte en sortant du mode, à l'endroit où on travaillait.
// ============================================================
window._assistModeActive = false;
window._assistCurrentIdx = -1;

/** _assistIsAnswered(idx) – Vrai si la question à cet index a déjà une réponse cette session
 * (répondue via le Mode Assistance, via la vue normale, ou restaurée après un rechargement). */
function _assistIsAnswered(idx) {
  if (window._immediateAnswers && window._immediateAnswers[idx] !== undefined) return true;
  return !!document.querySelector(`input[name="qidx${idx}"]:checked`);
}

/** _assistNextUnansweredIdx(fromIdx) – Première question sans réponse après fromIdx, dans
 * l'ordre d'apparition de currentQuestions (même ordre que la page quiz normale). -1 si fini. */
function _assistNextUnansweredIdx(fromIdx) {
  for (let i = fromIdx + 1; i < currentQuestions.length; i++) {
    if (!_assistIsAnswered(i)) return i;
  }
  return -1;
}

/** _assistSpeak(text) – Lecture TTS inconditionnelle (ignore le toggle ttsEnabled global :
 * la lecture est le principe même du Mode Assistance, pas une option qu'on pourrait couper
 * par mégarde en pleine session). Respecte volume/voix préférée comme le reste de l'app. */
function _assistSpeak(text) {
  if (!window.appTts || !window.appTts.supported()) return;
  window.appTts.speak(text, {
    volume: (parseInt(localStorage.getItem('ttsVolume')) || 100) / 100,
    voiceName: localStorage.getItem('ttsPreferredVoiceName') || ''
  });
}

/** _assistBuildSpeechText(q) – Compose "question + toutes les propositions" à lire d'un
 * coup à l'arrivée sur une question (les choix sont déjà dans l'ordre mélangé de cette
 * session — voir le Fisher-Yates dans afficherQuiz() — donc lus dans le même ordre que
 * ce qui est affiché). */
function _assistBuildSpeechText(q) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const parts = [q.question];
  q.choix.forEach((c, i) => parts.push(`Proposition ${letters[i] || (i + 1)} : ${c}`));
  return parts.join('. ');
}

/** _assistReplay() – Relit la question courante depuis le début, à la demande (bouton 🔁 en
 * coin de la carte). Seul moyen de rejouer/relancer la lecture en Mode Assistance : il n'y a
 * pas de pause ni de curseur sur speechSynthesis, donc une fois la lecture démarrée ou finie,
 * rien d'autre ne permettait de la réentendre. Si la question a déjà une réponse, reconstitue
 * aussi l'annonce du résultat (correct / bonne réponse), pour rejouer exactement ce qui a été
 * lu au clic — pas seulement l'énoncé initial. */
function _assistReplay() {
  const idx = window._assistCurrentIdx;
  const q = currentQuestions && currentQuestions[idx];
  if (!q) return;
  let text = _assistBuildSpeechText(q);
  if (_assistIsAnswered(idx)) {
    const checked = document.querySelector(`input[name="qidx${idx}"]:checked`);
    const chosenIdx = checked ? parseInt(checked.value, 10) : -1;
    text += (chosenIdx === q.bonne_reponse)
      ? '. Bonne réponse.'
      : '. Réponse incorrecte. La bonne réponse était : ' + q.choix[q.bonne_reponse];
  }
  _assistSpeak(text);
}

/** _toggleAssistMode() – Bouton unique d'entrée/sortie, cliquable à la volée à tout moment
 * tant qu'un quiz est chargé sur cette page. */
function _toggleAssistMode() {
  if (window._assistModeActive) _exitAssistMode();
  else _enterAssistMode();
}

/** _enterAssistMode() – Bascule vers la vue une-question-à-la-fois, positionnée sur la
 * première question sans réponse (= "la question à laquelle il faut répondre dans la
 * progression"), dans l'ordre d'apparition de la page quiz normale. */
function _enterAssistMode() {
  if (!currentQuestions || !currentQuestions.length) return;
  const startIdx = _assistNextUnansweredIdx(-1);
  if (startIdx === -1) {
    alert('Toutes les questions de ce quiz ont déjà une réponse.');
    return;
  }
  window._assistModeActive = true;
  window._assistCurrentIdx = startIdx;

  const quizCont = document.getElementById('quizContainer');
  const actionsBar = document.querySelector('.quiz-actions-bar');
  if (quizCont) quizCont.style.display = 'none';
  if (actionsBar) actionsBar.style.display = 'none';

  const btn = document.getElementById('assistModeToggleBtn');
  if (btn) btn.textContent = '✕ Quitter le mode assistance';

  _assistRenderCurrent();
}

/** _exitAssistMode(skipScroll) – Repasse à la vue normale (questions + réponses déjà
 * inchangées, puisque le Mode Assistance a répondu via les VRAIS radios). Sans skipScroll,
 * atterrit sur la question en cours de travail ("là où on en était"). skipScroll est utilisé
 * uniquement quand la dernière question du lot vient d'être répondue : validerReponses() va
 * gérer son propre scroll (vers le récapitulatif d'erreurs), inutile de le concurrencer. */
function _exitAssistMode(skipScroll) {
  const wasActive = window._assistModeActive;
  window._assistModeActive = false;
  clearTimeout(window._assistAdvanceTimer);
  if (window.appTts) window.appTts.stop();

  const quizCont = document.getElementById('quizContainer');
  const actionsBar = document.querySelector('.quiz-actions-bar');
  const assistCont = document.getElementById('assistModeContainer');
  if (quizCont) quizCont.style.display = '';
  if (actionsBar) actionsBar.style.display = '';
  if (assistCont) { assistCont.style.display = 'none'; assistCont.innerHTML = ''; }

  const btn = document.getElementById('assistModeToggleBtn');
  if (btn) btn.textContent = '🎧 Mode Assistance';

  if (!skipScroll && wasActive) {
    const idx = window._assistCurrentIdx;
    const block = (idx >= 0) ? document.querySelectorAll('.question-block')[idx] : null;
    if (block && typeof _scrollBelowStickyBanner === 'function') _scrollBelowStickyBanner(block);
  }
}

/** _assistRenderCurrent() – Affiche la question courante (une seule à l'écran) et lance sa
 * lecture TTS automatique. */
function _assistRenderCurrent() {
  const idx = window._assistCurrentIdx;
  const cont = document.getElementById('assistModeContainer');
  if (!cont || idx < 0 || idx >= currentQuestions.length) return;
  const q = currentQuestions[idx];
  const answeredCount = currentQuestions.reduce((n, _, i) => n + (_assistIsAnswered(i) ? 1 : 0), 0);
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];

  cont.style.display = 'block';
  cont.innerHTML = `
    <div class="assist-mode-card">
      <button type="button" class="assist-mode-replay-btn" onclick="_assistReplay()" title="Relire la question (et la réponse si déjà répondu)">🔁</button>
      <div class="assist-mode-progress">Question ${idx + 1} / ${currentQuestions.length} — ${answeredCount} répondue(s)</div>
      <div class="assist-mode-question">${q.question}</div>
      ${ q.image
        ? `<div class="question-image"><img src="${q.image}" alt="illustration" onerror="this.style.display='none';"></div>`
        : '' }
      <div class="assist-mode-choices">
        ${q.choix.map((c, i) => `
          <button type="button" class="assist-mode-choice-btn" data-choice-idx="${i}" onclick="_assistAnswer(${i})">
            <span class="assist-mode-choice-letter">${letters[i] || (i + 1)}</span>
            <span class="assist-mode-choice-text">${c}</span>
          </button>
        `).join('')}
      </div>
      <div class="assist-mode-sr-row">
        <button type="button" class="assist-mode-sr-btn assist-mode-sr-less"
                onclick="adjustSrFrequency(${idx}, this, 'easier')"
                title="Moins souvent — repousser la prochaine révision de cette question (jugée facile)">
          📉 <span>Moins souvent</span>
        </button>
        <button type="button" class="assist-mode-sr-btn assist-mode-sr-more"
                onclick="adjustSrFrequency(${idx}, this, 'harder')"
                title="Plus souvent — rapprocher la prochaine révision de cette question (jugée difficile)">
          📈 <span>Plus souvent</span>
        </button>
      </div>
      <div class="assist-mode-feedback" id="assistModeFeedback"></div>
    </div>
  `;

  // Amener le début de la question pile sous la bannière collante : sans ça, la position de
  // scroll restait celle de la question précédente (le conteneur est juste réécrit en place,
  // rien ne déclenche de scroll par défaut), donc une nouvelle question plus courte laissait
  // la page trop bas et il fallait redescendre à la main pour la voir en entier.
  const card = cont.querySelector('.assist-mode-card');
  if (card && typeof _scrollBelowStickyBanner === 'function') _scrollBelowStickyBanner(card);

  _assistSpeak(_assistBuildSpeechText(q));
}

/** _assistAnswer(choiceIdx) – Traite le clic sur une proposition en Mode Assistance. Pilote
 * le VRAI radio de la vue normale (checked + handleImmediateAnswer) pour rester à 100%
 * synchronisé avec elle (persistance, planification SR, historique, coloration au retour).
 * Cas particulier : si c'est la dernière question sans réponse du lot, sort du Mode
 * Assistance AVANT de répondre — sinon le scroll automatique de validerReponses() (déclenché
 * en cascade par handleImmediateAnswer) s'appliquerait à un conteneur encore masqué. */
function _assistAnswer(choiceIdx) {
  const idx = window._assistCurrentIdx;
  const q = currentQuestions[idx];
  if (!q || _assistIsAnswered(idx)) return; // déjà répondu (double-clic) → ignorer

  const isLastOfBatch = !currentQuestions.some((_, i) => i !== idx && !_assistIsAnswered(i));

  if (isLastOfBatch) {
    _exitAssistMode(true);
    const realRadio = document.querySelector(`input[name="qidx${idx}"][value="${choiceIdx}"]`);
    if (realRadio) {
      realRadio.checked = true;
      if (!window._immediateScore) window._immediateScore = { correct: 0, answered: 0, total: currentQuestions.length };
      handleImmediateAnswer(q, realRadio, idx);
    }
    return;
  }

  const isCorrect = choiceIdx === q.bonne_reponse;
  const cont = document.getElementById('assistModeContainer');
  if (cont) {
    cont.querySelectorAll('.assist-mode-choice-btn').forEach(b => {
      b.disabled = true;
      const bIdx = parseInt(b.dataset.choiceIdx, 10);
      if (bIdx === q.bonne_reponse) b.classList.add('assist-correct');
      else if (bIdx === choiceIdx) b.classList.add('assist-wrong');
    });
    const fb = document.getElementById('assistModeFeedback');
    if (fb) {
      fb.innerHTML = (isCorrect
        ? '✅ Correct'
        : ('❌ Faux — la bonne réponse était : ' + q.choix[q.bonne_reponse]))
        + ' <button type="button" class="assist-mode-skip-btn" onclick="_assistSkipToNext()">Suivant ▶</button>';
    }
  }

  const realRadio = document.querySelector(`input[name="qidx${idx}"][value="${choiceIdx}"]`);
  if (realRadio) {
    realRadio.checked = true;
    if (!window._immediateScore) window._immediateScore = { correct: 0, answered: 0, total: currentQuestions.length };
    handleImmediateAnswer(q, realRadio, idx);
  }

  const delay = isCorrect ? 1200 : 4000;
  clearTimeout(window._assistAdvanceTimer);
  window._assistAdvanceTimer = setTimeout(() => _assistSkipToNext(), delay);
}

/** _assistSkipToNext() – Avance immédiatement vers la question suivante sans réponse
 * (utilisé par le délai automatique ET par le bouton "Suivant ▶" pour ceux qui ne veulent
 * pas attendre la fin de la lecture TTS de la bonne réponse). */
function _assistSkipToNext() {
  clearTimeout(window._assistAdvanceTimer);
  if (!window._assistModeActive) return;
  const idx = window._assistCurrentIdx;
  const next = _assistNextUnansweredIdx(idx);
  if (next === -1) { _exitAssistMode(true); return; } // filet de sécurité
  window._assistCurrentIdx = next;
  _assistRenderCurrent();
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
    // La série est close : le bandeau de suivi s'efface au profit du récapitulatif de résultat,
    // qui occupe la même place en haut de page.
    if (typeof _updateSessionProgress === 'function') _updateSessionProgress();
    // Quiz soumis : effacer les réponses/position en cours de session mémorisées, ET le jeu
    // de questions lui-même — sinon revenir sur quiz.html via le bouton "Quiz" (au lieu de
    // cliquer "Nouvelles Questions") re-servait le MÊME lot déjà corrigé comme un questionnaire
    // vierge (réponses effacées, mais questions identiques), au lieu de reprendre la session en
    // cours ou d'en proposer une nouvelle : ça donnait l'impression que la progression venait
    // d'être perdue alors qu'elle était bien enregistrée.
    localStorage.removeItem('currentQuizAnswers');
    localStorage.removeItem('currentQuizBatchPos');
    localStorage.removeItem('currentQuestions');

    let correctCount = 0;
    const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
    if (!uid) return;

    // En mode correction immédiate, utiliser les réponses stockées en mémoire
    const isImmediate = localStorage.getItem('correctionImmediate') === '1';
    const immediateAnswers = window._immediateAnswers || {};

    let responsesToSave = {};
    let answeredCount = 0;
    currentQuestions.forEach((q, idx) => {
        let selectedVal = null;
        if (isImmediate && immediateAnswers[idx] !== undefined) {
            selectedVal = immediateAnswers[idx];
        } else {
            const sel = document.querySelector(`input[name="qidx${idx}"]:checked`);
            selectedVal = sel ? parseInt(sel.value) : null;
        }
        // Question jamais répondue → on ne touche à RIEN : pas d'entrée, pas de statut
        // "ratée" infligé, pas de failCount, pas de planification SR. Avant ce correctif,
        // valider une session incomplète marquait toutes les questions non répondues comme
        // ratées : la progression s'effondrait ("0 restantes" alors que jamais vues), le
        // failCount montait à tort, et elles revenaient en "révisions dues" le lendemain.
        if (selectedVal === null) return;
        answeredCount++;
        const key = getKeyFor(q);

        // Mode entraînement libre : ne rien persister ni logger, juste compter le score
        // affiché à l'écran (voir _isPracticeMode).
        if (_isPracticeMode()) {
          if (selectedVal === q.bonne_reponse) correctCount++;
          return;
        }

        // L'entrée SR a déjà été calculée ET sauvegardée au moment du clic (mode immédiat :
        // handleImmediateAnswer ; mode normal : écouteur 'change' de afficherQuiz). La
        // réutiliser telle quelle — la recalculer ici doublerait l'incrément d'intervalle SR
        // (currentResponses[key] contient déjà la nouvelle entrée) et dupliquerait le statusLog.
        if (window._immediateSavedEntries && window._immediateSavedEntries[key]) {
            const savedEntry = window._immediateSavedEntries[key];
            responsesToSave[key] = savedEntry;
            if (savedEntry.status === 'réussie') correctCount++;
            // En mode immédiat, le log des ratées et la file de ré-interrogation ont déjà
            // été gérés au moment du clic ; en mode normal ils se font ici, à la validation
            // (la réponse pouvait encore changer avant).
            if (!isImmediate && savedEntry.status === 'ratée') {
                _logWrongAnswer(q, selectedVal);
                _queueForReask(q);
            }
            return;
        }

        const entry = _computeSrEntry(q, selectedVal);
        responsesToSave[key] = entry;
        if (entry.status === 'réussie') correctCount++;
        // Logger la question ratée pour la page "Ratés du jour"
        if (entry.status === 'ratée') {
          _logWrongAnswer(q, selectedVal);
        }
        // Mode non-immédiat : ajouter les questions ratées à la file de ré-interrogation
        if (entry.status === 'ratée' && !isImmediate) {
          _queueForReask(q);
        }
    });

    // Compter les questions nouvellement maîtrisées
    // (passées de non-réussie / non-vue → réussie pour la première fois)
    // Quand la réponse a été persistée au clic (les deux modes), currentResponses a déjà
    // été mis à jour : l'ancien statut est mémorisé dans window._immediatePrevStatus.
    let _newlyMastered = 0;
    currentQuestions.forEach(q => {
        const key = getKeyFor(q);
        const oldStatus = (window._immediatePrevStatus && key in window._immediatePrevStatus)
            ? window._immediatePrevStatus[key]
            : currentResponses[key]?.status;
        const newStatus = responsesToSave[key]?.status;
        if (newStatus === 'réussie' && oldStatus !== 'réussie') _newlyMastered++;
    });

    afficherCorrection();
    // Session terminée → ré-afficher "Nouvelles Questions" (masqué pendant la session)
    if (typeof _updateResetBtnVisibility === 'function') _updateResetBtnVisibility(true);
    const skippedCount = currentQuestions.length - answeredCount;

    // Temps réel de travail pour l'ENSEMBLE du questionnaire : on ajoute d'abord le segment
    // encore en cours (temps de relecture depuis la dernière réponse jusqu'au clic sur
    // "Valider"), sinon il ne serait jamais comptabilisé nulle part.
    if (typeof _qtFlushFinalSegment === 'function') _qtFlushFinalSegment();
    let timingHtml = '';
    if (typeof _qtGetSessionTotal === 'function') {
        const { ms, count } = _qtGetSessionTotal();
        if (ms > 0 && count > 0) {
            const avgMs = ms / count;
            timingHtml = `<br><small style="color:var(--text-secondary)">⏱️ Temps réel : ${_qtFormatDuration(ms)} pour ${count} question${count > 1 ? 's' : ''} (~${_qtFormatDuration(avgMs)}/question)</small>`;
        }
    }

    const rc = document.getElementById('resultContainer');
    if (rc) {
        rc.style.display = "block";
        const scorePct = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;
        rc.innerHTML = `
            Vous avez <strong>${correctCount}</strong> bonnes réponses
            sur <strong>${answeredCount}</strong> répondue${answeredCount > 1 ? 's' : ''}
            ${answeredCount > 0 ? `(<strong>${scorePct}%</strong>)` : ''}.
            ${skippedCount > 0 ? `<br><small style="color:var(--text-secondary)">(${skippedCount} question${skippedCount > 1 ? 's' : ''} non répondue${skippedCount > 1 ? 's' : ''} — non comptée${skippedCount > 1 ? 's' : ''}, ${skippedCount > 1 ? 'elles restent' : 'elle reste'} à voir)</small>` : ''}
            ${timingHtml}
        `;
        // Aller directement aux erreurs de la session (récapitulatif construit par
        // afficherCorrection ci-dessus) plutôt que de rester sur la bannière de score : le
        // bandeau reste de toute façon visible en permanence (position: sticky), inutile donc
        // de forcer un retour en haut de page qui oblige à rescroller tout le questionnaire
        // pour retrouver ses erreurs.
        const errorRecap = document.getElementById('quizErrorRecap');
        if (errorRecap) {
          _scrollBelowStickyBanner(errorRecap);
        } else {
          rc.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // Mode entraînement libre : le score est affiché ci-dessus, mais rien n'est écrit nulle
    // part (Firestore, compteurs quotidiens, session, SR) — voir _isPracticeMode.
    if (_isPracticeMode()) return;

    // Rien n'a été répondu → rien à enregistrer (ne pas polluer l'historique de sessions
    // ni les compteurs quotidiens avec une session vide)
    if (answeredCount === 0) return;

    // Incrémenter le compteur quotidien direct dans localStorage
    // (fiable même si Firestore n'est pas prêt offline)
    // Ne PAS incrémenter en mode révisions espacées
    if (modeQuiz !== 'revisions') {
      try {
        const _now = new Date();
        const dayKeyUtc = 'dailyAnswered_' + _now.toISOString().slice(0, 10);
        const prev = parseInt(localStorage.getItem(dayKeyUtc)) || 0;
        const newTotal = prev + correctCount;
        localStorage.setItem(dayKeyUtc, newTotal);
        // Ratchet
        const ratchetKeyUtc = 'dailyCountRatchet_' + _now.toISOString().slice(0, 10);
        const prevRatchet = parseInt(localStorage.getItem(ratchetKeyUtc)) || 0;
        const display = Math.max(newTotal, prevRatchet);
        localStorage.setItem(ratchetKeyUtc, display);
        // Backup persistant en date LOCALE (même format que Firestore/chart)
        const localDateKey = _now.getFullYear() + '-' + String(_now.getMonth() + 1).padStart(2, '0') + '-' + String(_now.getDate()).padStart(2, '0');
        const dhBackup = JSON.parse(localStorage.getItem('dailyHistoryBackup') || '{}');
        dhBackup[localDateKey] = (dhBackup[localDateKey] || 0) + correctCount;
        localStorage.setItem('dailyHistoryBackup', JSON.stringify(dhBackup));
        // Compteur de questions nouvellement réussies (pour estimation jours restants)
        if (_newlyMastered > 0) {
          const masteredKey = 'dailyMastered_' + localDateKey;
          const prevMast = parseInt(localStorage.getItem(masteredKey)) || 0;
          localStorage.setItem(masteredKey, prevMast + _newlyMastered);
          const dmBackup = JSON.parse(localStorage.getItem('dailyMasteredBackup') || '{}');
          dmBackup[localDateKey] = (dmBackup[localDateKey] || 0) + _newlyMastered;
          localStorage.setItem('dailyMasteredBackup', JSON.stringify(dmBackup));
          // Sync cross-device : écrire vers Firestore
          const _mUid = (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.uid) || localStorage.getItem('cachedUid');
          if (_mUid && typeof saveDailyMastered === 'function') saveDailyMastered(_mUid).catch(() => {});
        }
        // Mise à jour visuelle DIRECTE de la barre (streak, objectif, progression)
        // Inclure le dailyHistoryBackup pour un streak cross-device correct
        const _dhForStreak = JSON.parse(localStorage.getItem('dailyHistoryBackup') || '{}');
        _dhForStreak[localDateKey] = Math.max(_dhForStreak[localDateKey] || 0, display);
        updateDailyStatsBar(display, _dhForStreak);
      } catch (e) { /* localStorage plein — rare */ }
    }

    // Sauvegarder la session en localStorage IMMÉDIATEMENT
    // (avant toute opération Firestore qui peut bloquer 10-15s offline)
    const sessionDate = new Date().toISOString();
    if (typeof _saveSessionToLocalBackup === 'function') {
      _saveSessionToLocalBackup(correctCount, answeredCount, selectedCategory, sessionDate);
    }

    try {
        // Incrémenter le compteur de sessions (pour marquées +3 session retry)
        _currentSessionCount++;

        // Sauvegarde avec fallback offline
        currentResponses = await saveResponsesWithOfflineFallback(uid, responsesToSave);

        // Attendre que le SERVEUR accuse réception avant de continuer (pas juste la file
        // d'attente locale) : sans ça, revenir à l'accueil juste après valider re-déclenche
        // une lecture forcée source:'server' (voir initIndex()) qui peut arriver AVANT que
        // cette écriture n'ait fini son aller-retour réseau — l'accueil affiche alors encore
        // l'ANCIEN nextReview et les questions qu'on vient de réviser réapparaissent aussitôt
        // comme "dues", même après une session entièrement validée (pas juste abandonnée).
        if (db.waitForPendingWrites) {
          try {
            await Promise.race([
              db.waitForPendingWrites(),
              new Promise(resolve => setTimeout(resolve, 6000))
            ]);
          } catch (e) { /* hors-ligne ou déjà à jour — pas bloquant */ }
        }

        // Sauvegarder le compteur de sessions dans Firestore
        try {
          await db.collection('quizProgress').doc(uid).update({
            quizSessionCount: _currentSessionCount
          });
        } catch (e) {
          if (e.code === 'not-found') {
            await db.collection('quizProgress').doc(uid).set(
              { quizSessionCount: _currentSessionCount },
              { merge: true }
            );
          }
        }

        // Sauvegarder le compteur quotidien (sauf mode révisions espacées)
        if (modeQuiz !== 'revisions') {
          await saveDailyCountOffline(uid);
          /* Push silencieux via REST API aussi (contourne bugs SDK mobile) */
          try {
            const _apiKey = (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) || 'AIzaSyD8hy_cTHQZybJ5RFAzgh7DLIh15Jhwkyw';
            const _fsBase = 'https://firestore.googleapis.com/v1/projects/quizaviation-b79ff/databases/(default)/documents/quizProgress/';
            const _now2 = new Date();
            const _tk = _now2.getFullYear()+'-'+String(_now2.getMonth()+1).padStart(2,'0')+'-'+String(_now2.getDate()).padStart(2,'0');
            const _utcK = _now2.toISOString().slice(0,10);
            const _cnt = Math.max(parseInt(localStorage.getItem('dailyCountRatchet_'+_utcK))||0, parseInt(localStorage.getItem('dailyAnswered_'+_utcK))||0);
            if(_cnt > 0){
              try {
                const _idTok = await auth.currentUser.getIdToken();
                const _pBody = {fields:{dailyHistory:{mapValue:{fields:{}}}}};
                _pBody.fields.dailyHistory.mapValue.fields[_tk] = {integerValue: String(_cnt)};
                // Le segment de date (2026-08-07) n'est PAS un identifiant de chemin valide
                // pour l'API REST (chiffre en tête + tirets) : sans les accents graves autour,
                // Firestore renvoie 400 Bad Request et rejette la requête (constaté en console).
                const _pUrl = _fsBase+encodeURIComponent(uid)+'?updateMask.fieldPaths='+encodeURIComponent('dailyHistory.`'+_tk+'`');
                fetch(_pUrl,{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+_idTok},body:JSON.stringify(_pBody)}).catch(()=>{});
              } catch(_te){ /* ignore token errors */ }
            }
          } catch(_e){ /* ignore */ }
        }
        // Sauvegarder le résultat de la session (avec la même date pour déduplication)
        await saveSessionResultOffline(uid, correctCount, answeredCount, selectedCategory, sessionDate);
    } catch (e) {
        console.error("Erreur sauvegarde validerReponses:", e);
        // AVANT : cette erreur était juste logguée en console — la session semblait validée
        // avec succès (le message "Terminé !" restait affiché tel quel) alors que rien
        // n'avait réellement atteint le serveur, et les questions revenaient "à revoir" à la
        // session suivante sans que l'utilisateur ait le moindre indice de ce qui s'est passé.
        const rcErr = document.getElementById('resultContainer');
        if (rcErr) {
          const warnDiv = document.createElement('div');
          warnDiv.style.cssText = 'margin-top:8px;padding:8px 12px;border-radius:6px;background:rgba(198,40,40,.15);border:1px solid rgba(198,40,40,.4);color:#ffb4b4;font-size:.85em;font-weight:600';
          warnDiv.textContent = '⚠️ Échec de l\'enregistrement (' + (e && e.message ? e.message : 'erreur inconnue') + ') — tes réponses n\'ont PAS été sauvegardées sur le serveur. Réessaie avec une meilleure connexion avant de quitter la page.';
          rcErr.appendChild(warnDiv);
        }
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
      const isAgg = _isAggregateCategory(normalizedSel);
      const fullL = isAgg ? questions : questions.filter(q => q.categorie === normalizedSel);
      let nR = 0, nNV = 0;
      fullL.forEach(q => { const r = currentResponses[getKeyFor(q)]; if (_isUnseen(r)) nNV++; else if (_effectiveStatus(r) === 'ratée') nR++; });
      updateCategoryInfoBar(selectedCategory, nR + nNV, fullL.length);
      currentQuestions = savedCQ;
    } catch (e) { /* ignore */ }
    // mettre à jour le compteur de questions répondues aujourd'hui
    await displayDailyStats(uid);
}

/**
 * afficherCorrection() – Affiche la correction sur quiz.html
 */
/**
 * _buildCorrectionCardHtml() – Construit la carte HTML d'une question corrigée (réponses
 * surlignées + explication). Extrait d'afficherCorrection() pour être réutilisé à la fois
 * dans la liste ordonnée normale et dans le récapitulatif des erreurs (voir plus bas) —
 * évite de dupliquer la logique de surlignage vert/rouge à deux endroits.
 */
function _buildCorrectionCardHtml(q, idx, checkedVal, anchorId, includeNote) {
  const _key = getKeyFor(q);
  if (typeof _applyStoredCorrectOverride === 'function') {
    _applyStoredCorrectOverride(q, currentResponses[_key]);
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

  return `
    <div class="question-block"${anchorId ? ` id="${anchorId}"` : ''}>
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
      ${_srStatsHtml(q)}
      ${_buildExplicationHtml(q, includeNote)}
      <div class="question-actions-row">
        ${typeof _correctOverrideBtnHtml === 'function' ? _correctOverrideBtnHtml(_key) : ''}
      </div>
    </div>
  `;
}

function afficherCorrection() {
  const cont = document.getElementById('quizContainer');
  if (!cont) return;
  // Quiz validé : plus rien à répondre — masquer le Mode Assistance (et en sortir si besoin,
  // sans le scroll-vers-la-question-en-cours qui n'a plus de sens ici).
  if (typeof _exitAssistMode === 'function') _exitAssistMode(true);
  if (typeof _updateAssistBtnVisibility === 'function') _updateAssistBtnVisibility(false);

  let html = "";
  const isImmediate = localStorage.getItem('correctionImmediate') === '1';
  const immediateAnswers = window._immediateAnswers || {};
  const wrongItems = []; // {q, idx, checkedVal} — pour le récapitulatif des erreurs en bas de page

  currentQuestions.forEach((q, idx) => {
    let checkedVal = null;
    if (isImmediate && immediateAnswers[idx] !== undefined) {
      checkedVal = immediateAnswers[idx];
    } else {
      const checkedInput = document.querySelector(`input[name="qidx${idx}"]:checked`);
      checkedVal = checkedInput ? parseInt(checkedInput.value) : null;
    }

    if (checkedVal !== null && checkedVal !== q.bonne_reponse) {
      wrongItems.push({ q, idx, checkedVal });
    }

    html += _buildCorrectionCardHtml(q, idx, checkedVal, 'qcorr-' + idx);
  });

  // Récapitulatif des erreurs : toutes les questions ratées de cette session regroupées en
  // bas de page (avec renvoi vers leur position dans la liste ci-dessus), pour ne pas avoir
  // à chercher ses erreurs au milieu de toutes les questions.
  if (wrongItems.length) {
    html += `
      <div class="question-block quiz-error-recap-header" id="quizErrorRecap">
        <div class="question-title" style="color:#e57373;">
          🔴 Récapitulatif des erreurs (${wrongItems.length})
        </div>
      </div>
    `;
    wrongItems.forEach(item => {
      html += `<div class="quiz-error-recap-item" style="border-left:4px solid #dc3545;">
        ${_buildCorrectionCardHtml(item.q, item.idx, item.checkedVal, null, false)}
        <div style="text-align:right;margin:-6px 8px 10px;">
          <a href="#qcorr-${item.idx}" onclick="event.preventDefault();_scrollBelowStickyBanner(document.getElementById('qcorr-${item.idx}'));" style="font-size:.82em;color:var(--link-color,#8ab4f8);text-decoration:none;">↑ Voir dans la liste (Q${item.idx + 1})</a>
        </div>
      </div>`;
    });
  }

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
    /* Tableaux (ex. collés depuis Excel/Word/une page web) */
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup',
    /* KaTeX elements */ 'math', 'semantics', 'annotation', 'mrow', 'mi', 'mo', 'mn', 'mfrac', 'msub',
    'msup', 'msubsup', 'msqrt', 'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd', 'mtext',
    'mspace', 'mpadded', 'menclose', 'mglyph', 'svg', 'line', 'path']);
  const allowedAttrs = new Set(['href', 'target', 'style', 'class', 'aria-hidden', 'xmlns', 'width', 'height',
    'viewbox', 'd', 'x1', 'y1', 'x2', 'y2', 'colspan', 'rowspan', 'align', 'valign', 'border']);

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
