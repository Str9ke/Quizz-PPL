// === helpers.js === Utility functions ===

// Filet anti-bfcache : quand le navigateur restaure une page depuis son cache
// mémoire (retour arrière/geste "précédent"), il rejoue l'état FIGÉ tel qu'il était AU
// MOMENT DU DÉPART — aucun script ne se réexécute, donc `currentResponses`/les compteurs
// affichés (Progression globale, cartes de catégorie…) restent bloqués sur les valeurs
// d'AVANT la réponse qu'on vient de donner sur une autre page, même si l'écriture Firestore
// a parfaitement réussi et est confirmée côté serveur. C'était la cause du symptôme "ça
// passe à 84 puis en revenant à l'accueil ça remet 83" : rien n'était perdu côté données,
// seul l'AFFICHAGE restauré était périmé. `event.persisted` est vrai précisément dans ce
// cas ; un rechargement forcé refait tourner initIndex()/displayHomeProgressBar() avec des
// données fraîchement relues sur le serveur.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});

/**
 * _clearRegenerableLocalStorage() – Libère de la place dans localStorage en supprimant
 * UNIQUEMENT des caches régénérables (jamais un dossier Navlog ni un travail en cours) :
 * cartes météo capturées, PDF OPMET, cache d'espaces aériens. localStorage a un quota strict
 * (~5-10 Mo, bien plus petit que le Cache Storage du Service Worker) et le module Navlog y
 * stocke des images/PDF en base64 — sur un navigateur PC utilisé longtemps pour préparer des
 * vols, ce quota peut se remplir au point de faire échouer une écriture qui n'a rien à voir
 * (ex. démarrer un quiz), avec une QuotaExceededError. Utilisé en dernier recours avant de
 * réessayer une écriture bloquée pour cette raison.
 */
function _clearRegenerableLocalStorage() {
  const keysToClear = [
    'navlog_map_temsi', 'navlog_map_temsiEuroc', 'navlog_map_wintem', 'navlog_map_fronts',
    'navlog_opmet_pdf', 'navlog_extra_images',
    'navlogAirspacesWideCache_v1', 'navlogAirspacesCache_v1'
  ];
  keysToClear.forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
}

/**
 * _clearSecondaryLocalStorage() – DEUXIÈME palier de libération, tenté uniquement si le premier
 * (caches régénérables du Briefing) n'a pas suffi. Constaté en pratique : « Stockage local plein :
 * impossible de démarrer le quiz » alors que le Briefing était déjà vide — il n'y avait donc plus
 * rien à libérer et le message demandait l'impossible.
 *
 * localStorage est plafonné à ~5 Mo par origine (indépendamment des ~10 Go d'IndexedDB affichés
 * dans Configuration, qui ne le concernent pas). Deux postes le saturent :
 *
 *  1. `responsesBackup_<uid>` — un instantané COMPLET de toutes les réponses, réécrit à CHAQUE
 *     réponse (voir _backupResponsesLocally). Sur un compte à plusieurs milliers de questions il
 *     pèse à lui seul plusieurs centaines de Ko. C'est un doublon : le miroir IndexedDB
 *     (_mirrorSaveResponses) conserve le même instantané, et c'est LUI que la récupération lit en
 *     premier (voir _loadMergedResponses). Le supprimer ne perd donc aucune donnée.
 *
 *  2. `dailyAnswered_*` / `dailyCountRatchet_*` / `dailyMastered_*` — une clé PAR JOUR, écrite
 *     depuis toujours et jamais nettoyée. Au-delà de quelques mois, elles ne servent plus à rien :
 *     les maps `dailyHistoryBackup` / `dailyMasteredBackup` (et Firestore) contiennent déjà le même
 *     historique sous forme compacte. On ne touche qu'aux clés de plus de 90 jours, pour laisser
 *     intacte la fenêtre réellement consultée (graphiques 60 jours, séries en cours).
 */
function _clearSecondaryLocalStorage() {
  const cutoffMs = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const toRemove = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith('responsesBackup_')) { toRemove.push(k); continue; }
      const m = k.match(/^(?:dailyAnswered|dailyCountRatchet|dailyMastered)_(\d{4}-\d{2}-\d{2})$/);
      if (m) {
        const t = Date.parse(m[1]);
        if (isFinite(t) && t < cutoffMs) toRemove.push(k);
      }
    }
  } catch (e) { /* énumération impossible : on fait avec ce qu'on a */ }
  // Suppression APRÈS l'énumération : retirer des clés pendant qu'on parcourt par index
  // décale les suivantes et en sauterait une sur deux.
  toRemove.forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
  if (toRemove.length) console.warn('[localStorage] 2e palier : ' + toRemove.length + ' clé(s) libérée(s)');
  return toRemove.length;
}

/**
 * _setLocalStorageWithCleanup(key, value) – Écrit dans localStorage ; si le quota est dépassé,
 * libère les caches régénérables (voir _clearRegenerableLocalStorage) puis réessaie une fois.
 * Renvoie true si l'écriture a fini par réussir, false sinon (l'appelant doit alors informer
 * l'utilisateur au lieu de continuer comme si la sauvegarde avait fonctionné).
 */
function _setLocalStorageWithCleanup(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    const isQuotaError = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
    if (!isQuotaError) { console.error('[localStorage] échec d\'écriture:', e); return false; }
    console.warn('[localStorage] quota dépassé, nettoyage des caches régénérables...');
    _clearRegenerableLocalStorage();
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e2) {
      // Le Briefing était peut-être déjà vide : rien n'a alors été libéré au 1er palier. On tente
      // le 2e (doublon du miroir + compteurs journaliers périmés) avant d'abandonner et
      // d'afficher à l'utilisateur un message qui, sinon, lui demanderait l'impossible.
      console.warn('[localStorage] toujours plein, passage au 2e palier de nettoyage...');
      const freed = (typeof _clearSecondaryLocalStorage === 'function') ? _clearSecondaryLocalStorage() : 0;
      if (!freed) { console.error('[localStorage] plus rien à libérer:', e2); return false; }
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (e3) {
        console.error('[localStorage] toujours plein après le 2e palier:', e3);
        return false;
      }
    }
  }
}

/**
 * _ensurePersistence() – Attend que enablePersistence() soit prêt.
 * Sur Android lent, enablePersistence() peut prendre 1-2s à initialiser IndexedDB.
 * Sans cette attente, les opérations Firestore utilisent un cache in-memory
 * qui est perdu au changement de page → données offline perdues.
 */
let _persistenceAwaited = false;
async function _ensurePersistence() {
  if (_persistenceAwaited) return;
  if (window._persistenceReady) {
    // enablePersistence() résout toujours via .then()/.catch() (voir index.html etc.), mais un
    // timeout de secours évite que ce point d'attente unique, réutilisé par toutes les lectures
    // Firestore de la page, ne bloque tout indéfiniment si IndexedDB est dans un état bloqué
    // (ex. plusieurs onglets, connexion fantôme d'un onglet précédent).
    try {
      await Promise.race([
        window._persistenceReady,
        new Promise(resolve => setTimeout(resolve, 5000))
      ]);
    } catch (e) { /* already handled */ }
  }
  _persistenceAwaited = true;
}

/**
 * getDocWithTimeout() – Lit un document Firestore avec fallback rapide hors-ligne.
 * Si hors-ligne (navigator.onLine === false) → lecture directe du cache Firestore.
 * Si en ligne → lecture réseau avec timeout de 4s, puis fallback cache.
 * @param {firebase.firestore.DocumentReference} docRef
 * @param {number} timeoutMs – Délai max avant fallback cache (défaut 2000ms)
 * @returns {Promise<firebase.firestore.DocumentSnapshot>}
 */
function _raceTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label || 'timeout')), ms))
  ]);
}

async function getDocWithTimeout(docRef, timeoutMs = 2000) {
  // S'assurer que la persistance Firestore est initialisée
  await _ensurePersistence();
  // Hors-ligne → lecture cache immédiate (pas de timeout réseau). Le lecture cache elle-même
  // est bornée par un timeout : une IndexedDB bloquée/en mauvais état (ex. plusieurs onglets
  // ouverts, connexion IndexedDB fantôme d'un onglet précédent) ne doit jamais bloquer
  // indéfiniment un bouton — mieux vaut renvoyer un snapshot vide que de rester figé.
  if (!_netOnline()) {
    // Le délai appliqué ici NE DOIT PAS être celui du réseau. Une lecture cache est purement
    // locale : la seule raison de la borner est une IndexedDB réellement bloquée. Avec le
    // délai réseau (2 s par défaut), un shard volumineux — jusqu'à 2000 réponses, ~1 Mio à
    // désérialiser sur un téléphone Android — dépassait régulièrement le délai et était
    // ABANDONNÉ : la progression paraissait vide (« 0 vue » sur 4742 questions chargées) alors
    // que les données étaient bien présentes en local, juste un peu lentes à sortir. On laisse
    // donc un budget large, et surtout on RÉESSAIE avant d'abandonner.
    const cacheBudget = Math.max(timeoutMs || 0, 15000);
    try {
      return await _raceTimeout(docRef.get({ source: 'cache' }), cacheBudget, 'cache timeout');
    } catch (e) {
      console.warn('[getDocWithTimeout] 1re lecture cache lente/bloquée, nouvel essai sans limite:', e.message);
      try {
        // 2e essai SANS aucune limite de temps : mieux vaut une seconde d'attente de plus
        // qu'une séance de révision vidée de sa progression.
        return await docRef.get({ source: 'cache' });
      } catch (e2) {
        console.warn('[getDocWithTimeout] cache miss/bloqué offline:', e2.message);
        return { exists: false, data: () => ({}) };
      }
    }
  }
  // En ligne → forcer lecture SERVEUR pour données cross-device fraîches
  try {
    return await _raceTimeout(docRef.get({ source: 'server' }), timeoutMs, 'Firestore timeout');
  } catch (e) {
    console.warn('[getDocWithTimeout] réseau lent/indisponible, fallback cache:', e.message);
    try {
      return await _raceTimeout(docRef.get({ source: 'cache' }), timeoutMs, 'cache timeout');
    } catch (e2) {
      return { exists: false, data: () => ({}) };
    }
  }
}

/**
 * normalizeResponses() – Normalize raw Firestore responses into { status, marked }
 * IMPORTANT : un statut absent (r.status undefined) DOIT rester undefined, pas être
 * défauté à 'ratée' — sinon une question "réinitialisée" via _resetCategoryField()
 * (qui supprime précisément status/srInterval/nextReview pour la faire redevenir
 * "non vue") réapparaît comme "ratée" partout où normalizeResponses() est utilisé
 * (accueil, compteurs de mode, calcul des révisions dues), alors que stats.js — qui lit
 * data.responses brut sans normalizeResponses() — l'affiche correctement en "non vue".
 * C'était la cause des incohérences de compteurs "Accueil vs Stats" observées après reset.
 */
function normalizeResponses(raw) {
  const out = {};
  Object.entries(raw||{}).forEach(([key, r]) => {
    const isMarked = (r.status === 'marquée') || (r.marked === true);
    const status = r.status === 'marquée'
      ? (r.previousStatus || 'ratée')
      : r.status;
    out[key] = { ...r, status, marked: isMarked };
  });
  return out;
}

/**
 * _effectiveStatus(r) – Statut "effectif" d'une réponse pour tous les compteurs de
 * progression (barre globale, par catégorie, menu Mode) : une question suspendue
 * ("🚫 Ne plus revoir") compte TOUJOURS comme réussie — l'utilisateur a décidé de ne
 * plus la revoir, elle est donc considérée maîtrisée, quel que soit son dernier statut
 * réel avant suspension (même si elle avait été ratée, ou même jamais répondue).
 * Sinon, renvoie le statut réel ('réussie'/'ratée'/undefined). À utiliser PARTOUT où on
 * calcule réussie/ratée/non-vue pour rester cohérent entre l'accueil, les stats et le quiz.
 */
function _effectiveStatus(r) {
  if (!r) return undefined;
  if (r.suspended) return 'réussie';
  return r.status;
}

/**
 * _isUnseen(r) – Une réponse est "non vue" si elle n'existe pas OU si son statut
 * effectif (voir _effectiveStatus) est absent (ex: après un reset ciblé qui supprime le
 * statut tout en conservant marqué/important/historique). À utiliser partout où une
 * question est classée "nouvelle/non vue" pour rester cohérent avec stats.js et éviter
 * qu'une question réinitialisée soit comptée comme "déjà vue" sans statut valide.
 */
function _isUnseen(r) {
  return !r || _effectiveStatus(r) === undefined;
}

/**
 * _isAggregateCategory(normalizedSel) – Vrai si la catégorie normalisée sélectionnée est
 * une catégorie "agrégée" (TOUTES/EASA ALL/GLIGLI ALL/GLIGLI HARD ALL/GLIGLI EASY ALL/
 * AUTRES) — dans ce cas, `questions[]` contient déjà le bon mélange de sous-catégories
 * (chargé par chargerQuestions()/loadAllQuestions()) et ne doit pas être re-filtré par
 * `q.categorie === normalizedSel`. Centralisé ici : ce test était dupliqué à l'identique
 * dans 3 endroits (categories.js + 2x quiz.js), un risque de désynchronisation si une
 * nouvelle catégorie agrégée est ajoutée un jour sans mettre à jour les 3 copies.
 */
function _isAggregateCategory(normalizedSel) {
  return normalizedSel === "TOUTES" || normalizedSel === "EASA ALL" || normalizedSel === "GLIGLI ALL" ||
    normalizedSel === "GLIGLI HARD ALL" || normalizedSel === "GLIGLI EASY ALL" || normalizedSel === "AUTRES";
}

/**
 * EASA_SUBJECTS – Les 9 matières officielles de l'examen théorique PPL(A) (syllabus EASA
 * Part-FCL), chacune évaluée et notée SÉPARÉMENT à l'examen réel (contrairement à une
 * simple moyenne globale, chaque matière doit individuellement atteindre le seuil de
 * réussite). Utilisé à la fois par epreuve.html (examen blanc) et par le tableau de bord
 * "Suis-je prêt ?" de stats.html — définie UNE SEULE FOIS ici pour que les deux restent
 * cohérents. Chaque matière liste les valeurs de catégorie (telles qu'utilisées ailleurs
 * dans l'app) dont les questions relèvent de cette matière.
 *
 * IMPORTANT : le nombre de questions et le seuil de réussite exacts de l'examen réel
 * (BCAA/EASA) peuvent varier et n'ont pas pu être vérifiés de façon certaine ici — les
 * valeurs par défaut proposées dans epreuve.html sont indicatives et modifiables, PAS une
 * garantie de correspondance exacte avec l'examen officiel en vigueur. Les 9 noms de
 * matières eux-mêmes suivent le syllabus EASA Part-FCL standard (stable, documenté).
 */
const EASA_SUBJECTS = [
  { name: 'Air Law (Réglementation)', categories: ['EASA REGLEMENTATION', 'GLIGLI REGLEMENTATION HARD', 'GLIGLI REGLEMENTATION EASY', 'RÉGLEMENTATION'] },
  { name: 'Aircraft General Knowledge (Connaissance avion)', categories: ['EASA CONNAISSANCE DE L\'AVION', 'GLIGLI CONNAISSANCES GENERALES AERONEF HARD', 'GLIGLI CONNAISSANCES GENERALES AERONEF EASY', 'CONNAISSANCE DE L\'AVION', 'INSTRUMENTATION', 'MOTORISATION'] },
  { name: 'Flight Performance & Planning (Performances et préparation du vol)', categories: ['EASA PERFORMANCE ET PLANIFICATION', 'GLIGLI PERFORMANCES PREPARATION VOL HARD', 'GLIGLI PERFORMANCES PREPARATION VOL EASY', 'MASSE ET CENTRAGE'] },
  { name: 'Human Performance & Limitations (Performances humaines)', categories: ['EASA PERFORMANCES HUMAINES', 'GLIGLI PERFORMANCE HUMAINE HARD', 'GLIGLI PERFORMANCE HUMAINE EASY'] },
  { name: 'Meteorology (Météorologie)', categories: ['EASA METEOROLOGIE', 'GLIGLI METEOROLOGIE HARD', 'GLIGLI METEOROLOGIE EASY'] },
  { name: 'Navigation', categories: ['EASA NAVIGATION', 'GLIGLI NAVIGATION HARD', 'GLIGLI NAVIGATION EASY'] },
  { name: 'Operational Procedures (Procédures opérationnelles)', categories: ['EASA PROCEDURES', 'GLIGLI PROCEDURES OPERATIONNELLES HARD', 'GLIGLI PROCEDURES OPERATIONNELLES EASY', 'PROCÉDURES OPÉRATIONNELLES'] },
  { name: 'Principles of Flight (Principes du vol)', categories: ['EASA AERODYNAMIQUE', 'GLIGLI PRINCIPES DU VOL HARD', 'GLIGLI PRINCIPES DU VOL EASY', 'AERODYNAMIQUE PRINCIPES DU VOL'] },
  { name: 'Communications', categories: ['PROCÉDURE RADIO', 'GLIGLI COMMUNICATIONS HARD', 'GLIGLI COMMUNICATIONS EASY'] }
];

// Replace curly apostrophes etc. with straight apostrophes for consistency
function fixQuotes(str) {
  return str
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"');
}

// Helper to normalize category names for mode counting
function getModeCategory(cat) {
  if (!cat) return "TOUTES";
  return getNormalizedCategory(cat);
}

// Retourne la clé de stockage pour une question donnée
function getKeyFor(q) {
  return `question_${getModeCategory(q.categorie)}_${q.id}`;
}

// Placeholder to avoid errors
function updateMarkedCount() {
}

/**
 * ===== Correction manuelle de la bonne réponse (correctOverride) =====
 * Si la banque de questions contient une erreur, l'utilisateur peut lui-même corriger quelle
 * proposition est la bonne réponse. Stocké par TEXTE (pas par index, car l'ordre des
 * propositions est remélangé à chaque affichage du quiz) dans le même document Firestore que
 * les réponses (`quizProgress/{uid}.responses[key].correctOverride`), donc personnel à
 * l'utilisateur et sans impact sur la banque de questions elle-même ni sur les autres joueurs.
 */

/**
 * _applyStoredCorrectOverride(q, resp) – Si une correction a été enregistrée pour cette
 * question, réécrit q.bonne_reponse en conséquence (mutation en place). À appeler juste avant
 * toute logique qui compare une réponse à q.bonne_reponse (affichage vert/rouge, calcul du
 * score, planification de répétition espacée), pour que la correction personnelle s'applique
 * partout où la question réapparaît, y compris dans une session/quiz future.
 */
function _applyStoredCorrectOverride(q, resp) {
  const ov = resp && resp.correctOverride;
  if (!ov || !Array.isArray(q.choix)) return;
  const idx = q.choix.indexOf(ov);
  if (idx >= 0) q.bonne_reponse = idx;
}

/**
 * _saveCorrectOverride(q, choiceText) – Enregistre la correction et met à jour q.bonne_reponse
 * immédiatement (pour un re-surlignage instantané sans recharger la page).
 */
async function _saveCorrectOverride(q, choiceText) {
  const uid = (typeof auth !== 'undefined' && auth.currentUser?.uid) || localStorage.getItem('cachedUid');
  if (!uid) { alert('Vous devez être connecté pour corriger une réponse.'); return false; }
  const key = getKeyFor(q);
  try {
    await _saveResponsesSharded(uid, { [key]: { correctOverride: choiceText } });
  } catch (e) {
    console.warn('[correctOverride] échec de sauvegarde:', e);
    try { await _saveResponsesSharded(uid, { [key]: { correctOverride: choiceText } }); }
    catch (e2) { console.error('[correctOverride] retry échoué:', e2); }
  }
  if (typeof currentResponses !== 'undefined' && currentResponses) {
    currentResponses[key] = { ...(currentResponses[key] || {}), correctOverride: choiceText };
  }
  const idx = q.choix.indexOf(choiceText);
  if (idx >= 0) q.bonne_reponse = idx;
  return true;
}

/**
 * _correctOverrideBtnHtml(key, text) – HTML du bouton ✏️ à insérer dans une .question-actions-row.
 * `text` optionnel permet aux pages au style plus verbeux (ex. historique.html) de garder leur
 * convention "Marquer"/"Important" plutôt que des boutons purement en icône.
 */
/**
 * _jsArg(v) – Échappe une valeur destinée à devenir un ARGUMENT LITTÉRAL entre apostrophes
 * dans un attribut onclick="..." construit par concaténation de chaînes.
 *
 * BUG corrigé : les clés de question valent `question_<CATÉGORIE>_<id>`, et deux catégories
 * contiennent une véritable apostrophe ASCII — « CONNAISSANCE DE L'AVION » et « EASA
 * CONNAISSANCE DE L'AVION » (voir getNormalizedCategory, js/categories.js). Injectée telle
 * quelle, cette apostrophe FERMAIT prématurément la chaîne JavaScript de l'attribut :
 *     onclick="fn('question_EASA CONNAISSANCE DE L'AVION_12', this)"
 *                                                 ↑ fin de chaîne ici → SyntaxError
 * Le navigateur n'exécutait alors rien du tout au clic — silencieusement, sans message.
 * Toutes les actions des cartes de Recherche/Échecs/Historique (marquer, important, note,
 * modifier/supprimer/publier une note) étaient donc inertes sur ces deux catégories, alors
 * qu'elles fonctionnaient partout ailleurs. Le bouton ✏️ y échappait, lui, parce qu'il passe
 * par un data-attribut (_correctOverrideBtnHtml ci-dessous) au lieu d'un onclick interpolé.
 *
 * Échappe d'abord pour JavaScript (\ puis '), ensuite pour l'attribut HTML (& avant " pour ne
 * pas ré-échapper les entités qu'on vient d'introduire). L'analyseur HTML décode l'attribut
 * AVANT que JavaScript ne le lise : les deux couches s'appliquent donc bien dans cet ordre.
 */
function _jsArg(v) {
  return String(v)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _correctOverrideBtnHtml(key, text) {
  const label = text ? ('✏️ ' + text) : '✏️';
  const cls = text ? 'correct-override-btn' : 'correct-override-btn qa-icon-btn';
  return `<button type="button" class="${cls}" data-key="${key}" title="Corriger la bonne réponse">${label}</button>`;
}

/**
 * _wireCorrectOverrideButtons(container, getQuestionByKey) – Écouteur délégué unique (posé une
 * seule fois par container) qui gère le cycle complet du bouton ✏️ : au clic, bascule un mode
 * où le PROCHAIN clic sur une proposition de cette question devient la nouvelle bonne réponse
 * (sauvegardée puis surlignée en vert). Réutilisable partout où une question est affichée avec
 * ses propositions dans une structure `.question-block > .answer-list > (une div par choix,
 * dans l'ordre de q.choix, contenant un <span>)` — quiz.html (correction), search.html,
 * echecs.html, historique.html.
 * En phase de capture (3e argument `true`) pour intercepter le clic AVANT le listener TTS déjà
 * posé sur chaque .answer-list (qui lirait sinon la réponse à voix haute à chaque correction).
 * @param {HTMLElement} container
 * @param {(key: string) => Object|null|undefined} getQuestionByKey
 */
function _wireCorrectOverrideButtons(container, getQuestionByKey) {
  if (!container || container._correctOverrideWired) return;
  container._correctOverrideWired = true;
  container.addEventListener('click', function(e) {
    const btn = e.target.closest('.correct-override-btn');
    if (btn) {
      e.stopPropagation();
      e.preventDefault();
      const block = btn.closest('.question-block');
      const al = block ? block.querySelector('.answer-list') : null;
      if (!al) return;
      const active = al.classList.toggle('correct-override-active');
      btn.classList.toggle('active', active);
      btn.title = active ? 'Annuler la correction' : 'Corriger la bonne réponse';
      let hint = block.querySelector('.correct-override-hint');
      if (active) {
        if (!hint) {
          hint = document.createElement('div');
          hint.className = 'correct-override-hint';
          hint.textContent = '👉 Clique sur la proposition qui est en réalité la bonne réponse.';
          al.insertAdjacentElement('afterend', hint);
        }
        hint.style.display = '';
      } else if (hint) {
        hint.style.display = 'none';
      }
      return;
    }

    const answerList = e.target.closest('.answer-list');
    if (!answerList || !answerList.classList.contains('correct-override-active')) return;
    const block = answerList.closest('.question-block');
    const abtn = block ? block.querySelector('.correct-override-btn') : null;
    const key = abtn ? abtn.getAttribute('data-key') : null;
    const q = key ? getQuestionByKey(key) : null;
    if (!q) return;
    const children = Array.from(answerList.children);
    const choiceEl = children.find(el => el === e.target || el.contains(e.target));
    if (!choiceEl) return;
    e.stopPropagation();
    e.preventDefault();
    const idx = children.indexOf(choiceEl);
    const choiceText = q.choix[idx];
    _saveCorrectOverride(q, choiceText).then(ok => {
      if (!ok) return;
      answerList.classList.remove('correct-override-active');
      if (abtn) { abtn.classList.remove('active'); abtn.title = 'Corriger la bonne réponse'; }
      const hint = block.querySelector('.correct-override-hint');
      if (hint) hint.style.display = 'none';
      children.forEach((el, i) => {
        const span = el.querySelector('span');
        const isCorrect = i === q.bonne_reponse;
        if (span) span.className = isCorrect ? 'correct' : '';
        el.style.background = isCorrect ? 'rgba(76,175,80,0.12)' : '';
      });
    });
  }, true);
}

/**
 * ensureDailyStatsBarVisible() – Crée/affiche la barre quotidienne avec streak, objectif et progression
 */
function ensureDailyStatsBarVisible() {
  let statsBar = document.getElementById('dailyStatsBar');
  const needsContent = !statsBar || !statsBar.querySelector('#streakDisplay');
  if (!statsBar) {
    statsBar = document.createElement('div');
    statsBar.id = 'dailyStatsBar';
    const anchor = document.querySelector('h1');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(statsBar, anchor.nextSibling);
    } else {
      document.body.prepend(statsBar);
    }
  }
  if (needsContent) {
    statsBar.style.cssText = 'display:block;background:var(--bg-question, #1e1e2e);border:1px solid rgba(255,255,255,0.1);color:white;padding:0.6rem 1rem;border-radius:10px;margin:0.5rem auto;max-width:600px;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
    statsBar.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span id="streakDisplay" style="font-size:0.85rem;font-weight:600;">🔥 0 jour</span>
        <span style="font-size:0.85rem;color:var(--text-secondary)">
          <span id="answeredTodayCount" style="font-size:1.3rem;font-weight:bold;color:white;">…</span>
          <span id="dailyGoalLabel" style="font-size:0.8rem;color:var(--text-secondary);"> / —</span>
        </span>
      </div>
      <div id="dailyProgressBarOuter" style="height:10px;background:rgba(255,255,255,0.08);border-radius:5px;overflow:hidden;position:relative;">
        <div id="dailyProgressBarInner" style="height:100%;width:0%;border-radius:5px;transition:width 0.6s ease, background 0.6s ease;background:#8b0000;"></div>
      </div>
    `;
  }
  statsBar.style.display = 'block';
}

/**
 * _getDailyHistoryMerged() – Fusionne dailyHistory depuis localStorage (backup + clés individuelles)
 * Retourne un objet { "YYYY-MM-DD": count } en dates locales.
 */
function _getDailyHistoryMerged() {
  const merged = {};
  // Source 1: backup persistant
  try {
    const backup = JSON.parse(localStorage.getItem('dailyHistoryBackup') || '{}');
    for (const [k, v] of Object.entries(backup)) {
      merged[k] = Math.max(merged[k] || 0, v);
    }
  } catch (e) { /* ignore */ }
  // Source 2: clés individuelles dailyAnswered_* / dailyCountRatchet_* (60 derniers jours)
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const localKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const utcKey = localKey; // en France, le décalage ne change pas la date pour la plupart des heures
    const lsVal = Math.max(
      parseInt(localStorage.getItem('dailyAnswered_' + utcKey)) || 0,
      parseInt(localStorage.getItem('dailyCountRatchet_' + utcKey)) || 0
    );
    if (lsVal > 0) merged[localKey] = Math.max(merged[localKey] || 0, lsVal);
  }
  return merged;
}

/**
 * _getDailyMasteredMerged() – Retourne le compteur de questions nouvellement réussies par jour
 * (non-vue/ratée → réussie). Utilisé pour l'estimation "jours restants" (progression réelle).
 * Format identique à _getDailyHistoryMerged() : { "YYYY-MM-DD": count }
 */
function _getDailyMasteredMerged() {
  const merged = {};
  // Source 1: backup persistant
  try {
    const backup = JSON.parse(localStorage.getItem('dailyMasteredBackup') || '{}');
    for (const [k, v] of Object.entries(backup)) {
      merged[k] = Math.max(merged[k] || 0, v);
    }
  } catch (e) { /* ignore */ }
  // Source 2: clés individuelles dailyMastered_* (60 derniers jours)
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const localKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const lsVal = parseInt(localStorage.getItem('dailyMastered_' + localKey)) || 0;
    if (lsVal > 0) merged[localKey] = Math.max(merged[localKey] || 0, lsVal);
  }
  return merged;
}

/**
 * _computeStreak() – Calcule la série de jours consécutifs d'activité
 * Si aujourd'hui a de l'activité, inclut aujourd'hui. Sinon, part d'hier.
 */
function _computeStreak(dailyHistory) {
  const today = new Date();
  const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  let streak = 0;
  // Si aujourd'hui a de l'activité, commencer à compter depuis aujourd'hui
  const startOffset = (dailyHistory[todayKey] || 0) > 0 ? 0 : 1;
  for (let i = startOffset; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if ((dailyHistory[key] || 0) > 0) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * _computeDailyGoal() – Calcule l'objectif quotidien = moyenne des 7 derniers jours complets
 * (hors aujourd'hui). Minimum 10 questions.
 */
function _computeDailyGoal(dailyHistory) {
  const saved = parseInt(localStorage.getItem('dailyGoalOverride'));
  if (saved > 0) return saved;
  const today = new Date();
  let total = 0;
  let activeDays = 0;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const count = dailyHistory[key] || 0;
    total += count;
    if (count > 0) activeDays++;
  }
  if (activeDays === 0) return 20; // défaut si aucune activité récente
  // Moyenne exacte (pas d'arrondi à la dizaine), minimum 10
  return Math.max(10, Math.round(total / 7));
}

/**
 * updateDailyStatsBar() – Met à jour streak, objectif, compteur et barre de progression
 * @param {number} [answeredToday] - Si fourni, force cette valeur. Sinon calcule depuis localStorage.
 * @param {object} [externalDailyHist] - dailyHistory Firestore à fusionner (optionnel)
 */
function updateDailyStatsBar(answeredToday, externalDailyHist) {
  ensureDailyStatsBarVisible();
  const merged = _getDailyHistoryMerged();
  // Fusionner avec Firestore si fourni
  if (externalDailyHist) {
    for (const [k, v] of Object.entries(externalDailyHist)) {
      merged[k] = Math.max(merged[k] || 0, v);
    }
  }
  // Déterminer le compteur d'aujourd'hui
  const today = new Date();
  const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  if (answeredToday === undefined || answeredToday === null) {
    answeredToday = merged[todayKey] || 0;
  }
  // S'assurer que merged contient bien la valeur la plus haute pour aujourd'hui
  merged[todayKey] = Math.max(merged[todayKey] || 0, answeredToday);

  const streak = _computeStreak(merged);
  const goal = _computeDailyGoal(merged);
  const pct = Math.min(answeredToday / goal, 1);

  // Gradient: dark red (0%) → orange (50%) → green (100%)
  const r = Math.round(139 + (255 - 139) * Math.min(pct * 2, 1) - Math.max(0, (pct - 0.5) * 2) * 255);
  const g = Math.round(0 + Math.min(pct * 2, 1) * 165 + Math.max(0, (pct - 0.5) * 2) * (175 - 165));
  const b = Math.round(0);
  // Simpler: interpolate #8b0000 → #ff8c00 → #2ecc40
  let barColor;
  if (pct <= 0.5) {
    const t = pct * 2; // 0..1
    barColor = `rgb(${Math.round(139 + (255 - 139) * t)}, ${Math.round(0 + 140 * t)}, 0)`;
  } else {
    const t = (pct - 0.5) * 2; // 0..1
    barColor = `rgb(${Math.round(255 - (255 - 46) * t)}, ${Math.round(140 + (204 - 140) * t)}, ${Math.round(0 + 64 * t)})`;
  }

  // Streak text
  const streakEl = document.getElementById('streakDisplay');
  if (streakEl) {
    if (streak === 0) {
      streakEl.textContent = '🔥 Commence ta série !';
      streakEl.style.color = 'var(--text-secondary)';
    } else {
      streakEl.textContent = `🔥 ${streak} jour${streak > 1 ? 's' : ''} d'affilée`;
      streakEl.style.color = streak >= 7 ? '#ff6b35' : streak >= 3 ? '#ffa500' : '#ccc';
    }
  }
  // Count
  const countEl = document.getElementById('answeredTodayCount');
  if (countEl) countEl.textContent = answeredToday;
  // Goal label
  const goalEl = document.getElementById('dailyGoalLabel');
  if (goalEl) goalEl.textContent = ` / ${goal}`;
  // Progress bar
  const barInner = document.getElementById('dailyProgressBarInner');
  if (barInner) {
    const widthPct = Math.min(pct * 100, 100);
    barInner.style.width = widthPct + '%';
    barInner.style.background = barColor;
    // Si objectif atteint, petit éclat visuel
    if (pct >= 1) {
      barInner.style.boxShadow = '0 0 8px rgba(46, 204, 64, 0.6)';
    } else {
      barInner.style.boxShadow = 'none';
    }
  }
}

/**
 * toggleAutoStart() – Active/désactive le démarrage automatique du quiz
 */
function toggleAutoStart() {
  const checkbox = document.getElementById('autoStartCheckbox');
  if (checkbox) {
    const isChecked = checkbox.checked;
    localStorage.setItem('autoStartQuiz', isChecked ? 'true' : 'false');
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

// ============================================================
// Répétition espacée (Spaced Repetition) – helpers
// ============================================================

/**
 * _isEligibleForSR() – Une question est éligible à la répétition espacée si :
 * 1) Elle a déjà un nextReview programmé (= elle est dans le cycle SR), OU
 * 2) Elle a déjà été RÉPONDUE (status présent) et est marquée, importante, ou difficile
 *    (failCount >= 2) → entre dans le cycle immédiatement.
 * Les questions jamais répondues ne sont JAMAIS éligibles — même marquées/importantes.
 * Sans cette condition sur status, une question marquée dont la planification vient
 * d'être réinitialisée (reset de catégorie : status/srInterval/nextReview supprimés,
 * marked/important conservés) comptait comme "révision due" immédiatement et pour
 * toujours, gonflant artificiellement le compteur "N dues" de l'Objectif du jour avec
 * des questions qui ne sont pas de vraies révisions planifiées.
 */
function _isEligibleForSR(r) {
  if (!r) return false;
  // Déjà dans le cycle SR (a été répondue depuis l'activation du SR)
  if (r.nextReview !== undefined && r.nextReview !== null) return true;
  // Répondue par le passé (pré-SR) et marquée/importante/difficile → entre dans le cycle
  return r.status !== undefined
    && (r.marked === true || r.important === true || (r.failCount || 0) >= 2);
}

/**
 * _isDueForReview() – Vérifie si une question est due pour révision.
 * Si nextReview n'est pas défini mais que la question est éligible, elle est due immédiatement.
 *
 * Comparaison par JOUR CIVIL, pas par horodatage exact : _computeSrEntry() calcule
 * nextReview = Date.now() + N jours, ce qui conserve l'heure exacte de la dernière réponse
 * (ex: étudié hier soir à 20h → nextReview = aujourd'hui 20h). Une comparaison stricte
 * (nextReview <= now) laissait ces questions invisibles toute la journée jusqu'à ce que
 * l'heure exacte repasse, alors que la carte "Programme des prochains jours" de stats.js
 * (_computeSrForecast) les comptait déjà comme dues du jour — d'où un écart spectaculaire
 * entre l'Accueil ("3 dues") et Stats ("2422 dues") pour les mêmes données. Convention
 * standard des outils de répétition espacée (Anki etc.) : une carte devient disponible dès
 * le début du jour prévu, pas seulement après l'heure exacte de sa dernière révision.
 */
function _isDueForReview(r, now) {
  if (!r) return false;
  // Pas encore de nextReview → question éligible jamais planifiée → due immédiatement
  if (r.nextReview === undefined || r.nextReview === null) return true;
  // nextReview peut être un timestamp Firestore ou un nombre
  let reviewMs = r.nextReview;
  if (typeof reviewMs === 'object' && reviewMs.seconds) {
    reviewMs = reviewMs.seconds * 1000;
  }
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  return reviewMs <= endOfToday.getTime();
}

/**
 * _srFamily(q) / _srFamilyRank(q) – Classe une question dans l'une des 3 "familles" de
 * banques (GLIGLI / EASA / classique). Le champ "categorie" BRUT du JSON source (ex:
 * "NAVIGATION" dans gligli_navigation_easy.json, "EASA_NAVIGATION" dans
 * section_easa_navigation.json) ne permet PAS de distinguer les familles par un simple préfixe :
 * GLIGLI et les banques classiques partagent parfois la même valeur brute (ex: "RÉGLEMENTATION"
 * existe à la fois dans questions_reglementation.json et gligli_reglementation_easy.json), et les
 * fichiers EASA n'utilisent pas tous le même séparateur ("EASA_..." vs "EASA ..."). On passe donc
 * par getNormalizedCategory() (js/categories.js), qui détecte "gligli"/"easa" n'importe où dans la
 * chaîne (insensible à la casse et aux accents) et renvoie systématiquement un identifiant agrégé
 * préfixé "GLIGLI "/"EASA " pour ces deux familles — un simple startsWith() sur q.categorie brut
 * classait à tort la quasi-totalité des questions GLIGLI et EASA en "classique". Utilisé pour
 * l'ordre de présentation en session de révision (GLIGLI d'abord, EASA ensuite, classiques en
 * dernier), pour la répartition par famille du programme des prochains jours (js/stats.js), et
 * pour le post-it de couleur affiché à côté du numéro de question.
 */
function _srFamily(q) {
  const raw = (q && q.categorie) || '';
  const cat = (typeof getNormalizedCategory === 'function') ? getNormalizedCategory(raw) : raw;
  if (cat.startsWith('GLIGLI ')) return 'gligli';
  if (cat.startsWith('EASA ')) return 'easa';
  return 'classique';
}
function _srFamilyRank(q) {
  const fam = _srFamily(q);
  return fam === 'gligli' ? 0 : (fam === 'easa' ? 1 : 2);
}

/**
 * FAM_COLORS – Couleurs des 3 familles de banques (GLIGLI / EASA / classique), déjà utilisées
 * pour les segments colorés du "Programme des prochains jours" (js/stats.js). Centralisées ici
 * pour être réutilisables ailleurs (ex: le post-it de couleur à côté du numéro de question).
 */
const FAM_COLORS = { gligli: '#f59e0b', easa: '#667eea', classique: '#10b981' };
const FAM_LABELS = { gligli: 'GLIGLI', easa: 'EASA', classique: 'Classique' };

/**
 * _familyBadgeHtml(q) – Petit post-it coloré indiquant la famille de banque (GLIGLI / EASA /
 * classique) d'une question, à afficher juste à côté de son numéro pendant le quiz — mêmes
 * couleurs que les barres de progression des stats, pour reconnaître la provenance d'un coup
 * d'œil sans avoir à lire la catégorie complète.
 */
function _familyBadgeHtml(q) {
  const fam = _srFamily(q);
  const color = FAM_COLORS[fam];
  const label = FAM_LABELS[fam];
  return `<span class="family-badge" title="${label}" aria-label="${label}" style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${color};margin-right:6px;vertical-align:middle;"></span>`;
}

/**
 * _updateRevisionsBadge() – Affiche/masque le badge "Révisions du jour" sur l'accueil.
 * Rend visible le nombre de questions dues pour répétition espacée (nbRevisionsToday, calculé
 * par updateModeCounts()), pour que le système de révision espacée ne passe plus inaperçu.
 */
function _updateRevisionsBadge() {
  const badge = document.getElementById('revisionsBadge');
  if (!badge) return;
  const n = (typeof nbRevisionsToday === 'number') ? nbRevisionsToday : 0;
  if (n > 0) {
    badge.textContent = `📅 ${n} révision${n > 1 ? 's' : ''} due${n > 1 ? 's' : ''} aujourd'hui — incluses dans "Objectif du jour"`;
    badge.style.display = 'block';
  } else {
    badge.style.display = 'none';
  }
}

/**
 * getDailyNewTarget() – Objectif de nouvelles questions/jour, en honorant la valeur 0.
 * ATTENTION : ne PAS remplacer par `parseInt(...) || 15` — 0 est une valeur valide
 * ("aucune nouvelle question, uniquement les révisions") mais 0 est falsy en JS, donc
 * `0 || 15` donnerait 15 et rendrait le réglage 0 silencieusement impossible.
 * Le défaut 15 ne s'applique que si la valeur est absente ou invalide.
 */
function getDailyNewTarget() {
  const raw = localStorage.getItem('dailyNewTarget');
  const v = parseInt(raw);
  return (Number.isFinite(v) && v >= 0) ? v : 15;
}

/**
 * _saveDailyNewTarget() – Sauvegarde l'objectif de nouvelles questions/jour (localStorage)
 * et rafraîchit le résumé + le compteur du mode "objectif".
 */
function _saveDailyNewTarget() {
  const input = document.getElementById('dailyNewTarget');
  if (!input) return;
  const v = Math.max(0, parseInt(input.value) || 0);
  input.value = v;
  localStorage.setItem('dailyNewTarget', v);
  if (typeof updateModeCounts === 'function') updateModeCounts();
}

/**
 * getMaxRevisionsPerDay() – Plafond volontaire sur le nombre de révisions dues incluses dans
 * une session "Objectif du jour" / "Révisions uniquement". Contrairement à getDailyNewTarget(),
 * l'absence de réglage (champ vide, ou 0) signifie "illimité" — TOUTES les révisions dues sont
 * incluses, sans plafond : c'est le comportement historique, qu'on ne change pas par défaut.
 * @returns {number|null} le plafond, ou null si illimité.
 */
function getMaxRevisionsPerDay() {
  const raw = localStorage.getItem('maxRevisionsPerDay');
  const v = parseInt(raw);
  return (Number.isFinite(v) && v > 0) ? v : null;
}

/**
 * _saveMaxRevisionsPerDay() – Sauvegarde le plafond de révisions/session (localStorage) et
 * rafraîchit le résumé + le compteur du mode "objectif". Un champ vidé ou à 0 supprime le
 * réglage (retour à "illimité") plutôt que de mémoriser un plafond de 0, qui viderait
 * silencieusement toute future session de révisions.
 */
function _saveMaxRevisionsPerDay() {
  const input = document.getElementById('maxRevisionsPerDay');
  if (!input) return;
  const raw = input.value.trim();
  const v = raw === '' ? 0 : Math.max(0, parseInt(raw) || 0);
  if (v > 0) {
    input.value = v;
    localStorage.setItem('maxRevisionsPerDay', v);
  } else {
    input.value = '';
    localStorage.removeItem('maxRevisionsPerDay');
  }
  if (typeof updateModeCounts === 'function') updateModeCounts();
}

/**
 * ===== Suivi du temps réel passé par question (_qt*) =====
 * Apprend, séparément pour les questions "nouvelles" et "révisions", le temps réel que
 * l'utilisateur passe par question — pour que l'estimation "~X min" reflète son vrai rythme
 * au lieu de constantes fixes. Exclut intelligemment :
 *  - le temps où l'onglet/la page est masqué (changement d'onglet, minimisation) via l'API
 *    Page Visibility ;
 *  - le temps d'inactivité prolongée SANS changement de visibilité (téléphone posé écran
 *    allumé, PC oublié au premier plan) : au-delà de QTIME_IDLE_MS sans interaction (clic,
 *    touche, défilement, tap), le temps écoulé depuis la DERNIÈRE interaction réelle n'est
 *    pas compté.
 * Stocké en localStorage (moyenne mobile exponentielle, adaptative), pas besoin de Firestore
 * pour une estimation purement indicative côté interface.
 */
const QTIME_STORAGE_KEY = 'qTimeStats';
const QTIME_IDLE_MS = 60000; // au-delà de 60s sans interaction, on considère l'utilisateur parti
const QTIME_MIN_SAMPLE_SEC = 1; // ignorer un échantillon < 1s (glitch/double clic)
const QTIME_MAX_SAMPLE_SEC = 180; // plafonner un échantillon à 3 min pour ne pas fausser la moyenne
const QTIME_EMA_ALPHA = 0.15; // poids du nouvel échantillon dans la moyenne mobile (adaptatif)
const QTIME_MIN_SAMPLES_TO_TRUST = 5; // sous ce seuil, on garde encore l'estimation par défaut

let _qtActiveAccumMs = 0;
let _qtSegStart = null; // null = en pause (onglet masqué ou utilisateur inactif)
let _qtLastActivity = 0;

function _qtResume() {
  const now = Date.now();
  if (_qtSegStart === null) _qtSegStart = now;
  _qtLastActivity = now;
}
function _qtPause() {
  if (_qtSegStart !== null) {
    _qtActiveAccumMs += Date.now() - _qtSegStart;
    _qtSegStart = null;
  }
}
function _qtCheckIdle() {
  if (_qtSegStart !== null && Date.now() - _qtLastActivity > QTIME_IDLE_MS) {
    // Inactif depuis trop longtemps : ne compter le temps actif que jusqu'à la dernière
    // interaction réelle (pas jusqu'à maintenant — l'utilisateur est probablement parti).
    _qtActiveAccumMs += _qtLastActivity - _qtSegStart;
    _qtSegStart = null;
  }
}
function _qtElapsedMs() {
  _qtCheckIdle();
  return _qtActiveAccumMs + (_qtSegStart !== null ? Date.now() - _qtSegStart : 0);
}
function _qtResetElapsed() {
  _qtCheckIdle();
  _qtActiveAccumMs = 0;
  if (_qtSegStart !== null) {
    // bug corrigé : _qtLastActivity devait aussi être resynchronisé ici, sinon il pouvait
    // rester "dans le passé" par rapport au nouveau _qtSegStart et faire calculer un temps
    // négatif dans _qtCheckIdle() (Date.now() - _qtLastActivity - _qtSegStart mal alignés).
    _qtSegStart = Date.now();
    _qtLastActivity = Date.now();
  }
}
function _qtInit() {
  if (window._qtInitialized) return;
  window._qtInitialized = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) _qtPause(); else _qtResume();
  });
  ['click', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
    document.addEventListener(evt, () => { if (!document.hidden) _qtResume(); }, { passive: true });
  });
  // mousemove à part et throttlé : une lecture silencieuse (pas de clic/scroll) avec la
  // souris posée sur l'écran ne doit pas être considérée comme "parti" avant QTIME_IDLE_MS —
  // sans ce signal, une lecture > 60s sans bouger la souris serait comptée comme inactive.
  let _qtLastMouseResume = 0;
  document.addEventListener('mousemove', () => {
    if (document.hidden) return;
    const now = Date.now();
    if (now - _qtLastMouseResume < 5000) return; // pas besoin de rafraîchir à chaque pixel
    _qtLastMouseResume = now;
    _qtResume();
  }, { passive: true });
  if (!document.hidden) _qtResume();
}
function _qtRecordSample(sec, isNew) {
  if (!isFinite(sec) || sec < QTIME_MIN_SAMPLE_SEC) return;
  const clamped = Math.min(sec, QTIME_MAX_SAMPLE_SEC);
  let data;
  try { data = JSON.parse(localStorage.getItem(QTIME_STORAGE_KEY) || '{}'); } catch (e) { data = {}; }
  const bucketKey = isNew ? 'new' : 'review';
  const bucket = data[bucketKey] || { avgSec: isNew ? 35 : 22, n: 0 };
  bucket.avgSec = bucket.n === 0 ? clamped : bucket.avgSec * (1 - QTIME_EMA_ALPHA) + clamped * QTIME_EMA_ALPHA;
  bucket.n = Math.min(bucket.n + 1, 9999);
  data[bucketKey] = bucket;
  try { localStorage.setItem(QTIME_STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* quota plein, tant pis */ }
}
function _qtGetEstimateSecPerQuestion() {
  let data;
  try { data = JSON.parse(localStorage.getItem(QTIME_STORAGE_KEY) || '{}'); } catch (e) { data = {}; }
  const nb = data.new, rb = data.review;
  return {
    secPerNew: (nb && nb.n >= QTIME_MIN_SAMPLES_TO_TRUST) ? nb.avgSec : 35,
    secPerReview: (rb && rb.n >= QTIME_MIN_SAMPLES_TO_TRUST) ? rb.avgSec : 22
  };
}

/**
 * _qtSessionTotalMs / _qtSessionCountedIdx (localStorage) — Temps actif RÉEL cumulé sur
 * l'ENSEMBLE du questionnaire en cours (pas juste la question actuelle comme _qtElapsedMs).
 * Persisté en localStorage (pas juste une variable mémoire) pour survivre à une navigation
 * vers une autre page puis un retour au quiz en cours — voir _refreshCategoryInfoBarLive() et
 * le même besoin pour currentQuizAnswers/currentQuizBatchPos. Affiché à la validation à côté
 * du score : "temps réel de travail" + moyenne par question.
 */
function _qtResetSessionTotal() {
  localStorage.setItem('qtSessionTotalMs', '0');
  localStorage.setItem('qtSessionCountedIdx', '[]');
}
function _qtAddSessionTime(ms, qIdx) {
  if (!isFinite(ms) || ms <= 0) return;
  let counted;
  try { counted = JSON.parse(localStorage.getItem('qtSessionCountedIdx') || '[]'); } catch (e) { counted = []; }
  // Une question déjà comptabilisée (ex: on re-coche la même question après un retour sur la
  // page, ce qui remet _qtLastTouchedIdx à null) ne doit pas ajouter une 2e fois son temps.
  if (counted.includes(qIdx)) return;
  counted.push(qIdx);
  try { localStorage.setItem('qtSessionCountedIdx', JSON.stringify(counted)); } catch (e) { /* ignore */ }
  const total = (parseFloat(localStorage.getItem('qtSessionTotalMs')) || 0) + ms;
  try { localStorage.setItem('qtSessionTotalMs', String(total)); } catch (e) { /* ignore */ }
  // Cumul par jour (graphique "Temps passé par jour") — placé APRÈS la déduplication par qIdx
  // ci-dessus, dont il hérite ainsi : recocher la même question ne recompte pas son temps.
  if (typeof _qtAddDailyTime === 'function') _qtAddDailyTime(ms);
}
/**
 * _qtFlushFinalSegment() – À appeler à la validation du quiz : ajoute au total le temps actif
 * écoulé depuis le dernier clic (temps de relecture avant de valider), qui n'a sinon jamais
 * l'occasion d'être comptabilisé puisqu'aucun clic sur une NOUVELLE question ne vient le clore.
 */
function _qtFlushFinalSegment() {
  if (typeof _qtElapsedMs !== 'function') return;
  const ms = _qtElapsedMs();
  if (!isFinite(ms) || ms <= 0) return;
  const total = (parseFloat(localStorage.getItem('qtSessionTotalMs')) || 0) + ms;
  try { localStorage.setItem('qtSessionTotalMs', String(total)); } catch (e) { /* ignore */ }
  if (typeof _qtAddDailyTime === 'function') _qtAddDailyTime(ms);
}
function _qtGetSessionTotal() {
  const ms = parseFloat(localStorage.getItem('qtSessionTotalMs')) || 0;
  let counted;
  try { counted = JSON.parse(localStorage.getItem('qtSessionCountedIdx') || '[]'); } catch (e) { counted = []; }
  return { ms, count: counted.length };
}

/**
 * ===== Temps réel passé PAR JOUR (_qt*DailyTime) =====
 * Jusqu'ici AUCUN temps par jour n'était conservé nulle part : `qTimeStats` ne retient qu'une
 * moyenne mobile (sec/question, sans la moindre date) et `qtSessionTotalMs` est remis à zéro à
 * chaque nouvelle série. Le temps passé les jours précédents était donc définitivement perdu.
 * On accumule désormais le temps actif réel dans une map { 'AAAA-MM-JJ': ms }.
 *
 * Alimentée au fil des réponses (via _qtAddSessionTime ci-dessus) et NON à la validation de la
 * série : une session abandonnée en cours de route compte donc quand même — même raisonnement
 * que la persistance immédiate des réponses, où attendre la validation faisait tout perdre.
 */
const QTIME_DAILY_KEY = 'dailyTimeMsBackup';

function _qtTodayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function _qtAddDailyTime(ms) {
  if (!isFinite(ms) || ms <= 0) return;
  // Même plafond que pour les échantillons de rythme : un segment aberrant (page laissée
  // ouverte, téléphone qui se réveille tard) ne doit pas gonfler la journée entière.
  const capped = Math.min(ms, QTIME_MAX_SAMPLE_SEC * 1000);
  try {
    const map = JSON.parse(localStorage.getItem(QTIME_DAILY_KEY) || '{}');
    const k = _qtTodayKey();
    map[k] = Math.round((map[k] || 0) + capped);
    localStorage.setItem(QTIME_DAILY_KEY, JSON.stringify(map));
  } catch (e) { /* quota plein, tant pis */ }
}
function _qtGetDailyTimeMap() {
  try { return JSON.parse(localStorage.getItem(QTIME_DAILY_KEY) || '{}'); } catch (e) { return {}; }
}
/**
 * _qtFormatDuration(ms) – "4 min 32 s" / "48 s" pour l'affichage du temps réel de session.
 */
function _qtFormatDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${sec} s`;
  return `${min} min ${String(sec).padStart(2, '0')} s`;
}

/**
 * _updateObjectifSummary() – Affiche le résumé "N dues + M nouvelles = X questions aujourd'hui"
 * sur la carte "Objectif du jour" de l'accueil, avec une estimation de temps.
 * Reflète la catégorie actuellement sélectionnée dans le menu "Catégorie".
 * @param {number} nbRevisionsTrue - nombre RÉEL de révisions dues, sans plafond.
 * @param {number} nbRevisions - nombre de révisions effectivement incluses (après plafond
 *   éventuel, voir getMaxRevisionsPerDay()) — c'est ce nombre qui sert au calcul du total et
 *   du temps estimé, puisque c'est ce qui sera vraiment inclus dans la session.
 */
/**
 * _progressionHealth() – La progression a-t-elle réellement été chargée ?
 *
 * Renvoie null quand tout va bien, sinon { level, msg }.
 *
 * RAISON D'ÊTRE : « 0 révision due » est affiché À L'IDENTIQUE dans deux situations qui n'ont
 * rien à voir — « tu as tout révisé, rien n'est dû aujourd'hui » et « je n'ai pas réussi à lire
 * ta progression ». Cette confusion a coûté une séance entière de révision en vol : l'appli
 * annonçait 0 question à réviser sur 4742 chargées, sans le moindre indice que les réponses
 * n'avaient tout simplement pas pu être lues. Un zéro silencieux est le pire des messages.
 */
function _progressionHealth() {
  const uid = (typeof auth !== 'undefined' && auth && auth.currentUser && auth.currentUser.uid)
    || localStorage.getItem('cachedUid');
  if (!uid) return null; // pas connecté : rien à charger, donc rien à signaler

  const count = (typeof currentResponses !== 'undefined' && currentResponses)
    ? Object.keys(currentResponses).length : 0;
  const offline = !_netOnline();

  if (count === 0) {
    // Aucune réponse EN MÉMOIRE alors qu'un compte est connecté. Sur un appareil qui n'a jamais
    // ouvert l'appli en ligne (typiquement l'application Android fraîchement installée, dont le
    // stockage est distinct de celui du navigateur), il n'existe localement aucune copie de la
    // progression — et aucune connexion pour aller la chercher.
    return offline
      ? { level: 'error', msg: "⚠️ <b>Ta progression n'a pas pu être lue sur cet appareil.</b><br>"
          + "Le « 0 révision due » ci-dessous ne veut donc PAS dire que tu es à jour : il veut dire "
          + "que l'appli ne sait pas où tu en es. Reconnecte-toi au réseau et rouvre cette page une "
          + "fois : ta progression sera récupérée puis conservée pour les prochaines sessions hors-ligne." }
      : { level: 'error', msg: "⚠️ <b>Ta progression n'a pas encore été chargée.</b><br>"
          + "Attends quelques secondes ou recharge la page — le « 0 révision due » ci-dessous n'est pas fiable tant que c'est affiché." };
  }

  if (window._respLoadIncomplete) {
    return { level: 'warn', msg: "⚠️ <b>Progression partiellement chargée</b> — une partie de tes réponses "
      + "n'a pas pu être lue. Les compteurs ci-dessous sont donc sous-estimés. Reconnecte-toi au réseau pour compléter." };
  }

  if (window._respRestoredFromMirror) {
    return { level: 'info', msg: "ℹ️ Progression restaurée depuis la copie locale de secours ("
      + window._respRestoredFromMirror + " réponses). Reconnecte-toi quand tu peux pour resynchroniser." };
  }

  return null;
}

/** _renderProgressionWarning() – Insère l'avertissement ci-dessus juste avant le résumé. */
function _renderProgressionWarning(container) {
  if (!container || !container.parentNode) return;
  let box = document.getElementById('progressionHealthWarning');
  const health = _progressionHealth();
  if (!health) { if (box) box.remove(); return; }
  if (!box) {
    box = document.createElement('div');
    box.id = 'progressionHealthWarning';
    container.parentNode.insertBefore(box, container);
  }
  const colors = {
    error: { bg: 'rgba(244,67,54,.18)', fg: '#ef5350' },
    warn:  { bg: 'rgba(255,167,38,.18)', fg: '#ffa726' },
    info:  { bg: 'rgba(76,175,80,.15)',  fg: '#66bb6a' }
  }[health.level];
  box.style.cssText = 'padding:10px 12px;border-radius:8px;font-size:.86em;line-height:1.45;margin:0 0 10px;'
    + 'background:' + colors.bg + ';color:' + colors.fg;
  box.innerHTML = health.msg;
}

function _updateObjectifSummary(nbRevisionsTrue, nbRevisions, dailyNewTarget, total) {
  const el = document.getElementById('objectifSummary');
  if (!el) return;
  _renderProgressionWarning(el);
  const { secPerNew, secPerReview } = _qtGetEstimateSecPerQuestion();
  const estMin = Math.round((nbRevisions * secPerReview + dailyNewTarget * secPerNew) / 60);
  const catSelect = document.getElementById('categorie');
  const catLabel = (catSelect && catSelect.selectedOptions && catSelect.selectedOptions[0])
    ? catSelect.selectedOptions[0].textContent
    : 'TOUTES';
  const isCapped = nbRevisions < nbRevisionsTrue;
  const revisionsHtml = isCapped
    ? `<b>${nbRevisions}</b> révision${nbRevisions > 1 ? 's' : ''} (sur <b>${nbRevisionsTrue}</b> dues — plafonné)`
    : `<b>${nbRevisions}</b> révision${nbRevisions > 1 ? 's' : ''} due${nbRevisions > 1 ? 's' : ''}`;
  // Questions "🚫 Ne plus revoir" (retirées de la rotation, typiquement parce que trop
  // faciles/déjà maîtrisées) : nbSuspenduesTotal est déjà recalculé par updateModeCounts()
  // sur ce même sous-ensemble (catégorie + filtres cochés) — juste l'afficher ici, il n'était
  // exposé nulle part dans l'interface jusqu'ici.
  const suspHtml = (typeof nbSuspenduesTotal === 'number' && nbSuspenduesTotal > 0)
    ? ` &nbsp;·&nbsp; 🚫 <b>${nbSuspenduesTotal}</b> retirée${nbSuspenduesTotal > 1 ? 's' : ''} (trop facile${nbSuspenduesTotal > 1 ? 's' : ''})`
    : '';
  el.innerHTML = `📚 <b>${catLabel}</b><br>`
    + `📅 ${revisionsHtml}`
    + ` + <b>${dailyNewTarget}</b> nouvelle${dailyNewTarget > 1 ? 's' : ''} = <b>${total}</b> question${total > 1 ? 's' : ''}`
    + ` &nbsp;(~${estMin} min estimées)`
    + suspHtml;

  // Garder le menu "Catégorie" de la carte Objectif synchronisé avec le menu principal
  // (utile si la catégorie a été changée depuis la carte "Configuration du Quiz")
  const objSelect = document.getElementById('objectifCategorie');
  if (objSelect && catSelect && objSelect.value !== catSelect.value) {
    objSelect.value = catSelect.value;
  }
}

/**
 * syncCategorieFromObjectif() – Le menu "Catégorie" de la carte "Objectif du jour" vient de
 * changer : répercute la sélection sur le menu principal (carte Configuration) et recharge
 * les questions/compteurs pour cette catégorie.
 */
function syncCategorieFromObjectif() {
  const objSelect = document.getElementById('objectifCategorie');
  const catSelect = document.getElementById('categorie');
  if (!objSelect || !catSelect) return;
  catSelect.value = objSelect.value;
  if (typeof categoryChanged === 'function') categoryChanged();
}

/**
 * Les cases marquées/importantes/avec notes existent en DEUX endroits de l'accueil (carte
 * "Configuration du Quiz" ET carte "Objectif du jour") mais représentent le MÊME filtre :
 * chaque paire est synchronisée en direct et partage la même clé localStorage (le 1er id de
 * chaque paire), pour que cocher l'une coche l'autre et que le choix soit mémorisé une seule fois.
 */
const _FILTER_CHECKBOX_PAIRS = [
  { flag: 'marquees',    ids: ['filterMarqueesCheckbox', 'objFilterMarqueesCheckbox'],    countIds: ['filterMarqueesCount', 'objFilterMarqueesCount'] },
  { flag: 'importantes', ids: ['filterImportantesCheckbox', 'objFilterImportantesCheckbox'], countIds: ['filterImportantesCount', 'objFilterImportantesCount'] },
  { flag: 'avecnotes',   ids: ['filterNotesCheckbox', 'objFilterNotesCheckbox'],          countIds: ['filterNotesCount', 'objFilterNotesCount'] },
  { flag: 'aucune',          ids: ['filterAucuneCheckbox', 'objFilterAucuneCheckbox'],                 countIds: ['filterAucuneCount', 'objFilterAucuneCount'] },
  { flag: 'avecexplication', ids: ['filterAvecExplicationCheckbox', 'objFilterAvecExplicationCheckbox'], countIds: ['filterAvecExplicationCount', 'objFilterAvecExplicationCount'] },
  { flag: 'plusratees',      ids: ['filterPlusRateesCheckbox', 'objFilterPlusRateesCheckbox'],          countIds: ['filterPlusRateesCount', 'objFilterPlusRateesCount'] },
  // Filtre par difficulté RÉELLE de la question (facile/moyen/difficile), analysée au contenu —
  // uniquement pertinent pour les catégories GLIGLI NAVIGATION EASY/HARD et EASA NAVIGATION (seules
  // à avoir été annotées), voir NAV_DIFFICULTY_CATEGORIES dans categories.js. Présent dans les deux
  // cartes ("Configuration du Quiz" ET "Objectif du jour"), comme les autres filtres.
  { flag: 'diff_facile',    ids: ['filterDiffFacileCheckbox', 'objFilterDiffFacileCheckbox'],       countIds: ['filterDiffFacileCount', 'objFilterDiffFacileCount'] },
  { flag: 'diff_moyen',     ids: ['filterDiffMoyenCheckbox', 'objFilterDiffMoyenCheckbox'],         countIds: ['filterDiffMoyenCount', 'objFilterDiffMoyenCount'] },
  { flag: 'diff_difficile', ids: ['filterDiffDifficileCheckbox', 'objFilterDiffDifficileCheckbox'], countIds: ['filterDiffDifficileCount', 'objFilterDiffDifficileCount'] },
  // Filtre par ORIGINALITÉ (question originale vs doublon d'une question déjà présente sous une
  // autre forme dans le(s) fichier(s) GLIGLI EASY/HARD de référence), analysé au contenu —
  // pertinent pour RÉGLEMENTATION et chaque catégorie EASA (seules annotées), voir
  // ORIGINALITY_CATEGORIES dans categories.js.
  { flag: 'orig_originale', ids: ['filterOrigOriginaleCheckbox', 'objFilterOrigOriginaleCheckbox'], countIds: ['filterOrigOriginaleCount', 'objFilterOrigOriginaleCount'] },
  { flag: 'orig_doublon',   ids: ['filterOrigDoublonCheckbox', 'objFilterOrigDoublonCheckbox'],     countIds: ['filterOrigDoublonCount', 'objFilterOrigDoublonCount'] }
];

/**
 * Flags qui filtrent l'ENSEMBLE des questions (au moins un critère coché parmi ceux-ci doit
 * matcher). 'plusratees' n'en fait PAS partie : c'est un critère de PRIORITÉ D'ORDRE (les plus
 * ratées en premier, en conservant la diversité des catégories), pas un critère d'appartenance —
 * s'il était traité comme les autres, le cocher seul viderait le résultat (aucune question ne
 * "correspond" à "plusratees" au sens membership du filtre OR).
 */
const _MEMBERSHIP_FILTER_FLAGS = ['marquees', 'importantes', 'avecnotes', 'aucune', 'avecexplication', 'diff_facile', 'diff_moyen', 'diff_difficile', 'orig_originale', 'orig_doublon'];

/**
 * _hasOfficialExplication(q) – Vrai si la question a un commentaire/explication OFFICIEL fourni
 * avec la question (texte et/ou images), à distinguer de la note personnelle de l'utilisateur
 * (_notesCache). Même prédicat que celui utilisé pour afficher le bouton "Voir l'explication"
 * en correction (js/quiz.js).
 */
function _hasOfficialExplication(q) {
  if (!q) return false;
  return !!(q.explication || (q.explication_images && q.explication_images.length));
}

/**
 * _updateFilterCheckboxCounts(counts) – Affiche, à côté de chaque case de filtre, le nombre de
 * questions concernées dans la catégorie actuellement sélectionnée (indépendamment des autres
 * cases cochées — chaque compteur reste "tel quel", pas croisé). Accepte soit un nombre simple,
 * soit {total, vues} pour afficher en plus la répartition déjà vues / restantes ("combien il en
 * reste" par rapport au critère coché).
 * @param {Object<string, number|{total:number, vues:number}>} counts
 */
function _updateFilterCheckboxCounts(counts) {
  if (!counts) return;
  _FILTER_CHECKBOX_PAIRS.forEach(({ flag, countIds }) => {
    const c = counts[flag];
    let text;
    if (c && typeof c === 'object') {
      const total = c.total || 0;
      const vues = c.vues || 0;
      const restantes = Math.max(0, total - vues);
      text = total ? ` (${total} · ${vues} vues, ${restantes} restantes)` : ' (0)';
    } else {
      text = ` (${c || 0})`;
    }
    countIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    });
  });
}

/**
 * _getCheckedFilterFlags() – Lit les cases marquées/importantes/avec notes cochées (dans
 * n'importe laquelle des deux cartes, elles sont synchronisées). Ces filtres s'appliquent EN
 * PLUS du mode choisi dans le menu "Mode" (y compris "Révisions du jour"/"Mixte"/"Objectif du
 * jour") : ils réduisent le résultat du mode à seulement les questions correspondant à au
 * moins un critère coché.
 */
function _getCheckedFilterFlags() {
  return _FILTER_CHECKBOX_PAIRS
    .filter(({ ids }) => ids.some(id => document.getElementById(id)?.checked))
    .map(({ flag }) => flag);
}

/**
 * _syncModeFilterState() – Conservé pour compat avec les appels existants (les cases ne
 * grisent plus le menu Mode depuis qu'elles filtrent EN PLUS de lui plutôt que de le remplacer).
 */
function _syncModeFilterState() { /* no-op */ }

/**
 * _onModeFilterCheckboxChange(sourceEl) – Appelé quand l'utilisateur coche/décoche une case
 * marquées/importantes/avec notes à la main (dans l'une ou l'autre carte) : répercute son choix
 * sur la case jumelle de l'autre carte, puis mémorise (localStorage) pour la prochaine visite.
 * NB: volontairement séparé de _restoreModeFilterCheckboxes() — les décochages programmatiques
 * (ex. _startObjectifDuJour) ne doivent PAS écraser la configuration mémorisée.
 */
function _onModeFilterCheckboxChange(sourceEl) {
  _FILTER_CHECKBOX_PAIRS.forEach(({ ids }) => {
    if (sourceEl && ids.includes(sourceEl.id)) {
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el && el !== sourceEl) el.checked = sourceEl.checked;
      });
    }
    const primaryId = ids[0];
    const anyChecked = ids.some(id => document.getElementById(id)?.checked);
    localStorage.setItem(primaryId, anyChecked ? '1' : '0');
  });
}

/**
 * _restoreModeFilterCheckboxes() – Restaure au chargement de la page les cases
 * marquées/importantes/avec notes (dans les deux cartes) telles qu'elles étaient lors de
 * la dernière visite.
 */
function _restoreModeFilterCheckboxes() {
  _FILTER_CHECKBOX_PAIRS.forEach(({ ids }) => {
    const checked = localStorage.getItem(ids[0]) === '1';
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = checked;
    });
  });
}

/**
 * _saveModeSelectValue() – Mémorise la valeur choisie à la main dans le menu "Mode"
 * (n'est PAS appelé lors d'une affectation programmatique comme dans _startObjectifDuJour,
 * puisque modeSelect.value = ... ne déclenche pas l'évènement "change").
 */
function _saveModeSelectValue() {
  const el = document.getElementById('mode');
  if (el) localStorage.setItem('lastModeSelectValue', el.value);
}

/**
 * _startObjectifDuJour() – Lance directement une session "Objectif du jour" (toutes les
 * révisions dues + l'objectif de nouvelles questions) pour la catégorie actuellement
 * sélectionnée dans le menu "Catégorie" (TOUTES par défaut), sans passer par la config manuelle.
 */
async function _startObjectifDuJour() {
  const btn = document.getElementById('objectifStartBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Préparation...'; }
  try {
    // Garde-fou : si un chargement (JSON, Firestore) reste bloqué plus de 20s malgré leurs
    // propres timeouts internes, ne jamais laisser le bouton figé indéfiniment — mieux vaut
    // échouer avec un message clair que de faire croire que l'appli est plantée.
    await _raceTimeout((async () => {
      // Les cases marquées/importantes/avec notes s'appliquent aussi à "Objectif du jour" :
      // updateModeCounts() (appelé ci-dessous sans argument) les lit automatiquement et scope
      // nbRevisionsToday/nbNonvuesToday sur ce sous-ensemble, donc le nb calculé plus bas promet
      // exactement ce que filtrerQuestions() (qui relit les mêmes cases) livrera.
      const catSelect = document.getElementById('categorie');
      const cat = catSelect ? catSelect.value : 'TOUTES';
      selectedCategory = cat;
      if (cat === 'TOUTES') {
        if (typeof loadAllQuestions === 'function') await loadAllQuestions();
      } else if (typeof chargerQuestions === 'function') {
        await chargerQuestions(cat);
      }
      if (typeof updateModeCounts === 'function') await updateModeCounts();

      // Ne jamais promettre plus de "nouvelles" qu'il n'en reste réellement de non vues
      // dans cette catégorie (sinon l'objectif affiché ment et le quiz démarre vide).
      const dailyNewTarget = Math.min(getDailyNewTarget(), typeof nbNonvuesToday === 'number' ? nbNonvuesToday : getDailyNewTarget());
      // nbRevisionsCappedToday (pas nbRevisionsToday) : respecte le plafond réglable "Max
      // révisions/session" — voir getMaxRevisionsPerDay(). Illimité par défaut (les deux
      // valeurs sont alors identiques).
      const nb = nbRevisionsCappedToday + dailyNewTarget;

      const modeSelect = document.getElementById('mode');
      if (modeSelect) modeSelect.value = 'objectif';
      const nbInput = document.getElementById('nbQuestions');
      if (nbInput) nbInput.value = nb;

      if (typeof demarrerQuiz === 'function') await demarrerQuiz();
    })(), 20000, 'Démarrage trop long');
  } catch (e) {
    console.error('[_startObjectifDuJour] échec:', e);
    alert("Le démarrage a pris trop de temps ou a échoué. Réessaie, et recharge la page si ça persiste.\n\n(" + (e && e.message ? e.message : e) + ")");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Lancer ma session du jour'; }
  }
}

/**
 * _startRevisionsOnly() – Lance directement une session de RÉVISIONS UNIQUEMENT (aucune
 * nouvelle question), toujours sur "TOUTES LES QUESTIONS" quelle que soit la catégorie
 * actuellement sélectionnée dans le menu — contrairement à _startObjectifDuJour() qui respecte
 * la catégorie choisie. Bouton dédié demandé à côté du titre "Répétition espacée" pour ne pas
 * avoir à changer la catégorie ni le menu "Mode" à la main juste pour réviser ce qui est dû.
 */
async function _startRevisionsOnly() {
  const btn = document.getElementById('revisionsOnlyBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Préparation...'; }
  try {
    // Garde-fou : voir _startObjectifDuJour() — ne jamais laisser ce bouton figé
    // indéfiniment si un chargement reste bloqué malgré ses propres timeouts internes.
    await _raceTimeout((async () => {
      selectedCategory = 'TOUTES';
      const catSelect = document.getElementById('categorie');
      if (catSelect) catSelect.value = 'TOUTES';
      if (typeof loadAllQuestions === 'function') await loadAllQuestions();
      // Les cases marquées/importantes/avec notes s'appliquent aussi ici : updateModeCounts()
      // (sans argument) les lit automatiquement, exactement comme pour "Objectif du jour".
      if (typeof updateModeCounts === 'function') await updateModeCounts();

      const modeSelect = document.getElementById('mode');
      if (modeSelect) modeSelect.value = 'revisions';
      const nbInput = document.getElementById('nbQuestions');
      // nbRevisionsCappedToday : respecte le plafond "Max révisions/session" (illimité par
      // défaut). Le mode "revisions" de filtrerQuestions() tronque déjà sur ce nb via .slice().
      if (nbInput) nbInput.value = nbRevisionsCappedToday;

      if (typeof demarrerQuiz === 'function') await demarrerQuiz();
    })(), 20000, 'Démarrage trop long');
  } catch (e) {
    console.error('[_startRevisionsOnly] échec:', e);
    alert("Le démarrage a pris trop de temps ou a échoué. Réessaie, et recharge la page si ça persiste.\n\n(" + (e && e.message ? e.message : e) + ")");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📅 Révisions uniquement'; }
  }
}

/**
 * renderActiveSessionBanner() – Affiche (ou masque) la bannière "séance en cours" sur l'Accueil,
 * à partir de window._activeSession chargée par initIndex() (js/init.js) depuis le document
 * Firestore quizProgress/{uid}/session/active — voir _activeSessionWrite dans js/quiz.js. Permet
 * de reprendre une session de répétition espacée démarrée sur un autre appareil (ou laissée en
 * plan sur celui-ci) exactement là où elle en était, ou de l'abandonner.
 */
function renderActiveSessionBanner() {
  const el = document.getElementById('activeSessionBanner');
  if (!el) return;
  const session = window._activeSession;
  if (!session) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const total = session.questions.length;
  const answered = Object.keys(session.answers || {}).length;
  el.style.display = 'block';
  el.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;">
      <div style="font-size:.9em;">
        🔄 <strong>Séance en cours</strong> (${session.category || 'quiz'}) sur cet appareil ou un autre : ${answered}/${total} question${total > 1 ? 's' : ''} répondue${answered > 1 ? 's' : ''}.
      </div>
      <div style="display:flex;gap:8px;">
        <button class="hist-filter-btn hist-filter-quiz" style="font-size:.88em;padding:6px 14px;" onclick="resumeActiveSession()">▶️ Reprendre</button>
        <button class="hist-filter-btn" style="font-size:.88em;padding:6px 14px;" onclick="abandonActiveSession()">🗑️ Abandonner</button>
      </div>
    </div>
  `;
}

function resumeActiveSession() {
  const session = window._activeSession;
  if (!session) return;
  const selected = session.questions;
  const saved = (typeof _setLocalStorageWithCleanup === 'function')
    ? _setLocalStorageWithCleanup('currentQuestions', JSON.stringify(selected))
    : (() => { try { localStorage.setItem('currentQuestions', JSON.stringify(selected)); return true; } catch (e) { return false; } })();
  if (!saved) {
    alert("Stockage local plein : impossible de reprendre.\n\nLibère de la place (par exemple sur la page Briefing : vide le PDF OPMET ou les cartes météo importées) puis réessaie.");
    return;
  }
  localStorage.setItem('quizCategory', session.category || 'TOUTES');
  localStorage.setItem('quizMode', session.mode || 'toutes');
  localStorage.setItem('quizNbQuestions', selected.length.toString());
  localStorage.setItem('correctionImmediate', session.correctionImmediate || '1');
  localStorage.removeItem('quizPracticeMode');
  if (session.freezeSrSchedule) localStorage.setItem('quizFreezeSrSchedule', '1'); else localStorage.removeItem('quizFreezeSrSchedule');
  if (session.difficultyDrill) localStorage.setItem('quizDifficultyDrill', '1'); else localStorage.removeItem('quizDifficultyDrill');
  // Réponses déjà données (sur cet appareil ou l'autre) : réutilisées telles quelles par
  // afficherQuiz() pour réafficher automatiquement l'état de la manche (voir js/quiz.js).
  try { localStorage.setItem('currentQuizAnswers', JSON.stringify(session.answers || {})); } catch (e) { /* tant pis */ }
  localStorage.removeItem('currentQuizBatchPos');
  localStorage.removeItem('recentlyAnsweredKeys');
  window.location = 'quiz.html';
}

function abandonActiveSession() {
  if (!window._activeSession) return;
  if (typeof _activeSessionDelete === 'function') _activeSessionDelete();
  window._activeSession = null;
  renderActiveSessionBanner();
}

/**
 * voirStats() – Redirige vers la page des statistiques
 */
function voirStats() {
  window.location = 'stats.html';
}
