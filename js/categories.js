// === categories.js === Category normalization, question loading, filtering ===

// Cache mémoire pour éviter de re-fetcher les mêmes fichiers JSON
const _jsonCache = new Map();

// Mapping fichier JSON GLIGLI → nom de catégorie normalisé (pour résolution des refs épreuve)
const _fileToCategory = {
  'gligli_communications_hard.json': 'GLIGLI COMMUNICATIONS HARD',
  'gligli_communications_easy.json': 'GLIGLI COMMUNICATIONS EASY',
  'gligli_connaissances_generales_aeronef_hard.json': 'GLIGLI CONNAISSANCES GENERALES AERONEF HARD',
  'gligli_connaissances_generales_aeronef_easy.json': 'GLIGLI CONNAISSANCES GENERALES AERONEF EASY',
  'gligli_meteorologie_hard.json': 'GLIGLI METEOROLOGIE HARD',
  'gligli_meteorologie_easy.json': 'GLIGLI METEOROLOGIE EASY',
  'gligli_navigation_hard.json': 'GLIGLI NAVIGATION HARD',
  'gligli_navigation_easy.json': 'GLIGLI NAVIGATION EASY',
  'gligli_performance_humaine_hard.json': 'GLIGLI PERFORMANCE HUMAINE HARD',
  'gligli_performance_humaine_easy.json': 'GLIGLI PERFORMANCE HUMAINE EASY',
  'gligli_performances_preparation_vol_hard.json': 'GLIGLI PERFORMANCES PREPARATION VOL HARD',
  'gligli_performances_preparation_vol_easy.json': 'GLIGLI PERFORMANCES PREPARATION VOL EASY',
  'gligli_principes_du_vol_hard.json': 'GLIGLI PRINCIPES DU VOL HARD',
  'gligli_principes_du_vol_easy.json': 'GLIGLI PRINCIPES DU VOL EASY',
  'gligli_procedures_operationnelles_hard.json': 'GLIGLI PROCEDURES OPERATIONNELLES HARD',
  'gligli_procedures_operationnelles_easy.json': 'GLIGLI PROCEDURES OPERATIONNELLES EASY',
  'gligli_reglementation_hard.json': 'GLIGLI REGLEMENTATION HARD',
  'gligli_reglementation_easy.json': 'GLIGLI REGLEMENTATION EASY',
};

// Catégories dont les questions ont été analysées une à une et annotées d'un champ "difficulte"
// ("facile"/"moyen"/"difficile", calibré selon le réel processus de résolution — voir
// gligli_navigation_easy.json / gligli_navigation_hard.json / section_easa_navigation.json).
// Seules ces catégories affichent le petit menu de filtre par difficulté sur l'accueil.
const NAV_DIFFICULTY_CATEGORIES = ['GLIGLI NAVIGATION EASY', 'GLIGLI NAVIGATION HARD', 'EASA NAVIGATION'];

// Catégories dont les questions ont été comparées une à une à leur(s) référence(s) GLIGLI
// EASY/HARD pour détecter les doublons (question testant le même fait sous une autre forme) —
// champ "originalite" ("originale"/"doublon") ajouté à chaque question du fichier JSON de la
// catégorie. RÉGLEMENTATION (banque à part, non-GLIGLI/EASA) est comparée à GLIGLI RÉGLEMENTATION
// EASY/HARD + EASA RÉGLEMENTATION ; chaque catégorie EASA est comparée à son couple GLIGLI
// EASY/HARD thématiquement équivalent. Seules ces catégories affichent le menu de filtre par
// originalité (🆕 Original / 🔁 Déjà traité) sur l'accueil.
const ORIGINALITY_CATEGORIES = [
  'RÉGLEMENTATION',
  'EASA PROCEDURES',
  'EASA AERODYNAMIQUE',
  'EASA NAVIGATION',
  "EASA CONNAISSANCE DE L'AVION",
  'EASA METEOROLOGIE',
  'EASA PERFORMANCE ET PLANIFICATION',
  'EASA REGLEMENTATION',
  'EASA PERFORMANCES HUMAINES',
  // Autres catégories "classiques" (banques à part, non-GLIGLI/EASA), comparées à leur(s)
  // référence(s) GLIGLI EASY/HARD (+ EASA quand une catégorie EASA équivalente existe) :
  'PROCÉDURE RADIO',
  'PROCÉDURES OPÉRATIONNELLES',
  "CONNAISSANCE DE L'AVION",
  'INSTRUMENTATION',
  'MASSE ET CENTRAGE',
  'MOTORISATION',
  'AERODYNAMIQUE PRINCIPES DU VOL'
];

/**
 * resolveEpreuveQuestions(data, epreuveCategoryName) – Résout les questions d'un fichier épreuve.
 * Les entrées avec ref_file/ref_index sont résolues depuis _jsonCache avec leur catégorie d'origine.
 * Les questions uniques (sans ref) gardent la catégorie épreuve.
 */
function resolveEpreuveQuestions(data, epreuveCategoryName) {
  const resolved = [];
  let uniqueIdx = 0;
  for (const entry of data) {
    if (entry.ref_file != null && entry.ref_index != null) {
      const sourceData = _jsonCache.get(entry.ref_file);
      if (sourceData && sourceData[entry.ref_index]) {
        const srcQ = sourceData[entry.ref_index];
        const srcCategory = _fileToCategory[entry.ref_file] || epreuveCategoryName;
        resolved.push({
          ...srcQ,
          id: entry.ref_index + 1,
          categorie: srcCategory,
          image: srcQ.image || srcQ.image_url || srcQ.imageUrl || null
        });
      } else {
        console.warn('[resolveEpreuve] Ref introuvable:', entry.ref_file, entry.ref_index);
      }
    } else {
      // Question unique à cette épreuve
      uniqueIdx++;
      resolved.push({
        ...entry,
        id: uniqueIdx,
        categorie: epreuveCategoryName,
        image: entry.image || entry.image_url || entry.imageUrl || null
      });
    }
  }
  return resolved;
}

/**
 * _deduplicateQuestions(questionsArray) – Déduplique par getKeyFor ET par texte de question, garde la première occurrence.
 */
function _deduplicateQuestions(questionsArray) {
  const seenKeys = new Set();
  const seenText = new Set();
  return questionsArray.filter(q => {
    const key = getKeyFor(q);
    const normText = (q.question || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (seenKeys.has(key) || seenText.has(normText)) return false;
    seenKeys.add(key);
    seenText.add(normText);
    return true;
  });
}

/**
 * _loadQuestionFileResilient(fileName) – Charge une banque de questions en épuisant TOUTES les
 * sources possibles avant de renoncer, dans cet ordre :
 *   1. fetch normal (passe par le Service Worker : cache-first pour ces fichiers) ;
 *   2. lecture DIRECTE de l'API Cache du navigateur, toutes générations de cache confondues —
 *      indispensable quand le Service Worker n'a pas (encore) la main sur la page, a été mis à
 *      jour, ou vient d'être remplacé : le contenu est bien là, seul l'intermédiaire manquait ;
 *   3. échec explicite (tableau vide) — mais SANS jamais être mémorisé comme un succès.
 * Un tableau vide est toujours traité comme un échec : une banque de questions n'est jamais
 * légitimement vide, donc mieux vaut essayer la source suivante que servir un quiz sans
 * questions, comme c'est arrivé en vol (réseau qui ment + cache fraîchement effacé).
 */
async function _loadQuestionFileResilient(fileName) {
  // 1) Chemin normal
  try {
    const res = await (typeof _raceTimeout === 'function'
      ? _raceTimeout(fetch(fileName), 10000, 'fetch timeout: ' + fileName)
      : fetch(fileName));
    if (res && res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) return data;
      console.warn('[questions] Réponse vide pour', fileName, '— tentative depuis le cache local');
    } else {
      console.warn('[questions] Réponse', res && res.status, 'pour', fileName, '— tentative depuis le cache local');
    }
  } catch (e) {
    console.warn('[questions] fetch impossible pour', fileName, '(' + e.message + ') — tentative depuis le cache local');
  }

  // 2) Cache du navigateur, en direct (toutes générations)
  try {
    if (typeof caches !== 'undefined') {
      const cached = await caches.match(fileName, { ignoreSearch: true });
      if (cached && cached.ok) {
        const data = await cached.json();
        if (Array.isArray(data) && data.length) {
          console.log('[questions] ' + fileName + ' récupéré depuis le cache local ✅');
          return data;
        }
      }
    }
  } catch (e) {
    console.warn('[questions] Lecture directe du cache impossible pour', fileName, e.message);
  }

  console.error('[questions] ÉCHEC TOTAL du chargement de', fileName);
  return [];
}

/**
 * prefetchAllJsonFiles() – Charge tous les fichiers JSON en parallèle.
 * Stocke les résultats dans _jsonCache pour que chargerQuestions() soit instantané.
 */
async function prefetchAllJsonFiles() {
  const files = [
    'questions_procedure_radio.json',
    'questions_procedure_operationnelles.json',
    'questions_reglementation.json',
    'questions_connaissance_avion.json',
    'questions_instrumentation.json',
    'questions_masse_et_centrage.json',
    'questions_motorisation.json',
    'questions_aerodynamique.json',
    'section_easa_procedures_new.json',
    'section_easa_aerodynamique.json',
    'section_easa_navigation.json',
    'section_easa_connaissance_avion.json',
    'section_easa_meteorologie.json',
    'section_easa_performance_planification.json',
    'section_easa_reglementation.json',
    'section_easa_perf_humaines.json',
    'gligli_communications_hard.json',
    'gligli_communications_easy.json',
    'gligli_connaissances_generales_aeronef_hard.json',
    'gligli_connaissances_generales_aeronef_easy.json',
    'gligli_epreuve_commune_hard.json',
    'gligli_epreuve_commune_easy.json',
    'gligli_epreuve_specifique_hard.json',
    'gligli_epreuve_specifique_easy.json',
    'gligli_meteorologie_hard.json',
    'gligli_meteorologie_easy.json',
    'gligli_navigation_hard.json',
    'gligli_navigation_easy.json',
    'gligli_performance_humaine_hard.json',
    'gligli_performance_humaine_easy.json',
    'gligli_performances_preparation_vol_hard.json',
    'gligli_performances_preparation_vol_easy.json',
    'gligli_principes_du_vol_hard.json',
    'gligli_principes_du_vol_easy.json',
    'gligli_procedures_operationnelles_hard.json',
    'gligli_procedures_operationnelles_easy.json',
    'gligli_reglementation_hard.json',
    'gligli_reglementation_easy.json'
  ];
  const t0 = performance.now();
  // Timeout par fichier : Promise.allSettled attend que TOUTES les promesses se règlent (résolue
  // OU rejetée) — un seul fetch qui reste bloqué sans jamais résoudre ni rejeter bloquerait donc
  // l'ensemble du préchargement indéfiniment, malgré allSettled. _raceTimeout() garantit que
  // chaque fetch rejette au bout de 10s au pire, laissant les autres fichiers déjà chargés utiles.
  // _loadQuestionFileResilient() : en cas de fetch en échec ou de réponse vide, il relit le
  // fichier DIRECTEMENT depuis l'API Cache du navigateur avant de renoncer — c'est ce qui
  // permet au préchargement d'aboutir même hors-ligne avec un Service Worker fraîchement
  // remplacé (le contenu est en cache, seul l'intermédiaire manquait).
  const results = await Promise.allSettled(files.map(f => _loadQuestionFileResilient(f)));
  results.forEach((r, i) => {
    // Ne JAMAIS mémoriser une banque vide : un fetch "réussi" mais vide (réponse de repli du
    // Service Worker hors-ligne, fichier tronqué, 404 renvoyant []) empoisonnait _jsonCache
    // pour toute la session — chargerQuestions() servait alors 0 question sans erreur, et le
    // seul remède était de tuer complètement l'appli. Une banque de questions n'est jamais
    // légitimement vide : un tableau vide est un échec, pas un résultat.
    if (r.status === 'fulfilled' && Array.isArray(r.value) && r.value.length) {
      _jsonCache.set(files[i], r.value);
    }
  });
  console.log(`[prefetch] ${_jsonCache.size}/${files.length} JSON chargés`);
}

function getNormalizedCategory(cat) {
  if (!cat) return "TOUTES";
  cat = fixQuotes(cat).replace(/_/g,' ').trim().toLowerCase();
  const catAscii = cat.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const isGligli = catAscii.includes("gligli");
  const mentionsEasy = catAscii.includes("easy");
  const mentionsHard = catAscii.includes("hard") || (isGligli && !mentionsEasy);

  // GLIGLI agrégées et spécifiques
  if (catAscii.includes("easa") && catAscii.includes("all")) return "EASA ALL";
  if (isGligli && catAscii.includes("all") && catAscii.includes("hard")) return "GLIGLI HARD ALL";
  if (isGligli && catAscii.includes("all") && catAscii.includes("easy")) return "GLIGLI EASY ALL";
  if (isGligli && catAscii.includes("all")) return "GLIGLI ALL";
  if (catAscii.includes("autres")) return "AUTRES";

  if (isGligli && mentionsEasy) {
    if (catAscii.includes("communications")) return "GLIGLI COMMUNICATIONS EASY";
    if (catAscii.includes("connaissance") && catAscii.includes("aeronef")) return "GLIGLI CONNAISSANCES GENERALES AERONEF EASY";
    if (catAscii.includes("epreuve") && catAscii.includes("commune")) return "GLIGLI EPREUVE COMMUNE EASY";
    if (catAscii.includes("epreuve") && catAscii.includes("specifique")) return "GLIGLI EPREUVE SPECIFIQUE EASY";
    if (catAscii.includes("meteorologie")) return "GLIGLI METEOROLOGIE EASY";
    if (catAscii.includes("navigation")) return "GLIGLI NAVIGATION EASY";
    if (catAscii.includes("performance") && catAscii.includes("humaine")) return "GLIGLI PERFORMANCE HUMAINE EASY";
    if (catAscii.includes("performances") && catAscii.includes("preparation")) return "GLIGLI PERFORMANCES PREPARATION VOL EASY";
    if (catAscii.includes("principes") && catAscii.includes("vol")) return "GLIGLI PRINCIPES DU VOL EASY";
    if (catAscii.includes("procedure") && catAscii.includes("operationnelle")) return "GLIGLI PROCEDURES OPERATIONNELLES EASY";
    if (catAscii.includes("reglementation")) return "GLIGLI REGLEMENTATION EASY";
  }

  if (isGligli && mentionsHard) {
    if (catAscii.includes("communications")) return "GLIGLI COMMUNICATIONS HARD";
    if (catAscii.includes("connaissance") && catAscii.includes("aeronef")) return "GLIGLI CONNAISSANCES GENERALES AERONEF HARD";
    if (catAscii.includes("epreuve") && catAscii.includes("commune")) return "GLIGLI EPREUVE COMMUNE HARD";
    if (catAscii.includes("epreuve") && catAscii.includes("specifique")) return "GLIGLI EPREUVE SPECIFIQUE HARD";
    if (catAscii.includes("meteorologie")) return "GLIGLI METEOROLOGIE HARD";
    if (catAscii.includes("navigation")) return "GLIGLI NAVIGATION HARD";
    if (catAscii.includes("performance") && catAscii.includes("humaine")) return "GLIGLI PERFORMANCE HUMAINE HARD";
    if (catAscii.includes("performances") && catAscii.includes("preparation")) return "GLIGLI PERFORMANCES PREPARATION VOL HARD";
    if (catAscii.includes("principes") && catAscii.includes("vol")) return "GLIGLI PRINCIPES DU VOL HARD";
    if (catAscii.includes("procedure") && catAscii.includes("operationnelle")) return "GLIGLI PROCEDURES OPERATIONNELLES HARD";
    if (catAscii.includes("reglementation")) return "GLIGLI REGLEMENTATION HARD";
  }

  // EASA explicite
  if (catAscii.includes("easa")) {
    if (catAscii.includes("aerodynamique")) return "EASA AERODYNAMIQUE";
    if (catAscii.includes("navigation")) return "EASA NAVIGATION";
    if (catAscii.includes("connaissance") && catAscii.includes("avion")) return "EASA CONNAISSANCE DE L'AVION";
    if (catAscii.includes("meteorologie")) return "EASA METEOROLOGIE";
    if (catAscii.includes("performance") && catAscii.includes("planification")) return "EASA PERFORMANCE ET PLANIFICATION";
    if (catAscii.includes("reglementation")) return "EASA REGLEMENTATION";
    if (catAscii.includes("performances") && catAscii.includes("humaines")) return "EASA PERFORMANCES HUMAINES";
    if (catAscii.includes("procedures")) return "EASA PROCEDURES";
  }

  // Catégories classiques
  if (catAscii.includes("aerodynamique")) return "AERODYNAMIQUE PRINCIPES DU VOL";
  if (catAscii.includes("procedure") && catAscii.includes("radio")) return "PROCÉDURE RADIO";
  if (catAscii.includes("procedures") && catAscii.includes("operationnelles")) return "PROCÉDURES OPÉRATIONNELLES";
  if (catAscii.includes("reglementation")) return "RÉGLEMENTATION";
  if (catAscii.includes("connaissance") && catAscii.includes("avion")) return "CONNAISSANCE DE L'AVION";
  if (catAscii.includes("instrumentation")) return "INSTRUMENTATION";
  if (catAscii.includes("masse") && catAscii.includes("centrage")) return "MASSE ET CENTRAGE";
  if (catAscii.includes("motorisation")) return "MOTORISATION";

  return cat.toUpperCase();
}

function getNormalizedSelectedCategory(selected) {
  if (!selected || selected==="TOUTES") return "TOUTES";
  const s=selected.replace(/_/g,' ').trim().toLowerCase();
  const sAscii = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const isGligli = sAscii.includes("gligli");
  const mentionsEasy = sAscii.includes("easy");
  const mentionsHard = sAscii.includes("hard") || (isGligli && !mentionsEasy);

  if (sAscii.includes("easa") && sAscii.includes("all")) return "EASA ALL";
  if (isGligli && sAscii.includes("all") && sAscii.includes("hard")) return "GLIGLI HARD ALL";
  if (isGligli && sAscii.includes("all") && sAscii.includes("easy")) return "GLIGLI EASY ALL";
  if (isGligli && sAscii.includes("all")) return "GLIGLI ALL";
  if (sAscii.includes("autres")) return "AUTRES";

  if (isGligli && mentionsEasy) {
    if (sAscii.includes("communications")) return "GLIGLI COMMUNICATIONS EASY";
    if (sAscii.includes("connaissance") && sAscii.includes("aeronef")) return "GLIGLI CONNAISSANCES GENERALES AERONEF EASY";
    if (sAscii.includes("epreuve") && sAscii.includes("commune")) return "GLIGLI EPREUVE COMMUNE EASY";
    if (sAscii.includes("epreuve") && sAscii.includes("specifique")) return "GLIGLI EPREUVE SPECIFIQUE EASY";
    if (sAscii.includes("meteorologie")) return "GLIGLI METEOROLOGIE EASY";
    if (sAscii.includes("navigation")) return "GLIGLI NAVIGATION EASY";
    if (sAscii.includes("performance") && sAscii.includes("humaine")) return "GLIGLI PERFORMANCE HUMAINE EASY";
    if (sAscii.includes("performances") && sAscii.includes("preparation")) return "GLIGLI PERFORMANCES PREPARATION VOL EASY";
    if (sAscii.includes("principes") && sAscii.includes("vol")) return "GLIGLI PRINCIPES DU VOL EASY";
    if (sAscii.includes("procedure") && sAscii.includes("operationnelle")) return "GLIGLI PROCEDURES OPERATIONNELLES EASY";
    if (sAscii.includes("reglementation")) return "GLIGLI REGLEMENTATION EASY";
  }

  if (isGligli && mentionsHard) {
    if (sAscii.includes("communications")) return "GLIGLI COMMUNICATIONS HARD";
    if (sAscii.includes("connaissance") && sAscii.includes("aeronef")) return "GLIGLI CONNAISSANCES GENERALES AERONEF HARD";
    if (sAscii.includes("epreuve") && sAscii.includes("commune")) return "GLIGLI EPREUVE COMMUNE HARD";
    if (sAscii.includes("epreuve") && sAscii.includes("specifique")) return "GLIGLI EPREUVE SPECIFIQUE HARD";
    if (sAscii.includes("meteorologie")) return "GLIGLI METEOROLOGIE HARD";
    if (sAscii.includes("navigation")) return "GLIGLI NAVIGATION HARD";
    if (sAscii.includes("performance") && sAscii.includes("humaine")) return "GLIGLI PERFORMANCE HUMAINE HARD";
    if (sAscii.includes("performances") && sAscii.includes("preparation")) return "GLIGLI PERFORMANCES PREPARATION VOL HARD";
    if (sAscii.includes("principes") && sAscii.includes("vol")) return "GLIGLI PRINCIPES DU VOL HARD";
    if (sAscii.includes("procedure") && sAscii.includes("operationnelle")) return "GLIGLI PROCEDURES OPERATIONNELLES HARD";
    if (sAscii.includes("reglementation")) return "GLIGLI REGLEMENTATION HARD";
  }

  if (sAscii.includes("easa")) {
    if (sAscii.includes("aerodynamique")) return "EASA AERODYNAMIQUE";
    if (sAscii.includes("navigation")) return "EASA NAVIGATION";
    if (sAscii.includes("connaissance") && sAscii.includes("avion")) return "EASA CONNAISSANCE DE L'AVION";
    if (sAscii.includes("meteorologie")) return "EASA METEOROLOGIE";
    if (sAscii.includes("performance") && sAscii.includes("planification")) return "EASA PERFORMANCE ET PLANIFICATION";
    if (sAscii.includes("reglementation")) return "EASA REGLEMENTATION";
    if (sAscii.includes("performances") && sAscii.includes("humaines")) return "EASA PERFORMANCES HUMAINES";
    if (sAscii.includes("procedures")) return "EASA PROCEDURES";
  }

  if (sAscii.includes("aerodynamique")) return "AERODYNAMIQUE PRINCIPES DU VOL";
  if (sAscii.includes("procedure") && sAscii.includes("radio")) return "PROCÉDURE RADIO";
  if (sAscii.includes("procedures") && sAscii.includes("operationnelles")) return "PROCÉDURES OPÉRATIONNELLES";
  if (sAscii.includes("reglementation")) return "RÉGLEMENTATION";
  if (sAscii.includes("connaissance") && sAscii.includes("avion")) return "CONNAISSANCE DE L'AVION";
  if (sAscii.includes("instrumentation")) return "INSTRUMENTATION";
  if (sAscii.includes("masse") && sAscii.includes("centrage")) return "MASSE ET CENTRAGE";
  if (sAscii.includes("motorisation")) return "MOTORISATION";

  return selected.toUpperCase();
}

/**
 * updateModeCounts() – Met à jour le menu "mode" en fonction des statistiques locales et Firebase
 */
async function updateModeCounts(filterFlags) {
    // Par défaut (aucun argument passé), lire les cases marquées/importantes/avec notes
    // actuellement cochées, pour que l'aperçu (menu Mode, "Objectif du jour") reste toujours
    // cohérent avec ce que filtrerQuestions() livrera réellement au lancement du quiz.
    if (filterFlags === undefined) {
      filterFlags = (typeof _getCheckedFilterFlags === 'function') ? _getCheckedFilterFlags() : [];
    }
    const normalizedSel = getNormalizedSelectedCategory(selectedCategory);
    // For aggregate categories (EASA ALL, GLIGLI ALL, AUTRES, TOUTES), use all loaded questions
    // because chargerQuestions already loaded the right set with correct individual categories
    const isAggregate = _isAggregateCategory(normalizedSel);
    // Épreuve categories also contain mixed-category questions (refs resolved from thematic files)
    const isEpreuve = normalizedSel.includes('EPREUVE');
    let list = (isAggregate || isEpreuve)
      ? questions
      : questions.filter(q => q.categorie === normalizedSel);

    const notesMap = (typeof _notesCache === 'object' && _notesCache) ? _notesCache : {};

    // Compteurs "bruts" par critère (indépendants les uns des autres, PAS croisés avec les
    // cases cochées) pour afficher "(N · vues/restantes)" à côté de chaque case de filtre.
    if (typeof _updateFilterCheckboxCounts === 'function') {
      let rawMarquees = 0, rawImportantes = 0, rawAvecNotes = 0, rawAucune = 0, rawAvecExpl = 0, rawPlusRatees = 0;
      let vMarquees = 0, vImportantes = 0, vAvecNotes = 0, vAucune = 0, vAvecExpl = 0;
      let rawDiffFacile = 0, rawDiffMoyen = 0, rawDiffDifficile = 0;
      let vDiffFacile = 0, vDiffMoyen = 0, vDiffDifficile = 0;
      let rawOrigOriginale = 0, rawOrigDoublon = 0;
      let vOrigOriginale = 0, vOrigDoublon = 0;
      list.forEach(q => {
        const key = getKeyFor(q);
        const r = currentResponses[key];
        if (r && r.suspended) return;
        const eff = r ? _effectiveStatus(r) : undefined;
        const seen = eff === 'réussie' || eff === 'ratée';
        const isMarquee = !!(r && r.marked);
        const isImportante = !!(r && r.important);
        const hasNote = !!notesMap[key];
        if (isMarquee)    { rawMarquees++;    if (seen) vMarquees++; }
        if (isImportante) { rawImportantes++; if (seen) vImportantes++; }
        if (hasNote)       { rawAvecNotes++;   if (seen) vAvecNotes++; }
        if (!isMarquee && !isImportante && !hasNote) { rawAucune++; if (seen) vAucune++; }
        if (_hasOfficialExplication(q)) { rawAvecExpl++; if (seen) vAvecExpl++; }
        if ((r && r.failCount || 0) >= 1) rawPlusRatees++;
        if (q.difficulte === 'facile')    { rawDiffFacile++;    if (seen) vDiffFacile++; }
        if (q.difficulte === 'moyen')     { rawDiffMoyen++;     if (seen) vDiffMoyen++; }
        if (q.difficulte === 'difficile') { rawDiffDifficile++; if (seen) vDiffDifficile++; }
        if (q.originalite === 'originale') { rawOrigOriginale++; if (seen) vOrigOriginale++; }
        if (q.originalite === 'doublon')   { rawOrigDoublon++;   if (seen) vOrigDoublon++; }
      });
      _updateFilterCheckboxCounts({
        marquees: { total: rawMarquees, vues: vMarquees },
        importantes: { total: rawImportantes, vues: vImportantes },
        avecnotes: { total: rawAvecNotes, vues: vAvecNotes },
        aucune: { total: rawAucune, vues: vAucune },
        avecexplication: { total: rawAvecExpl, vues: vAvecExpl },
        plusratees: rawPlusRatees,
        diff_facile: { total: rawDiffFacile, vues: vDiffFacile },
        diff_moyen: { total: rawDiffMoyen, vues: vDiffMoyen },
        diff_difficile: { total: rawDiffDifficile, vues: vDiffDifficile },
        orig_originale: { total: rawOrigOriginale, vues: vOrigOriginale },
        orig_doublon: { total: rawOrigDoublon, vues: vOrigDoublon }
      });
    }

    // Cases marquées/importantes/avec notes/aucune/avec commentaire officiel cochées : les
    // compteurs (et donc l'aperçu "Objectif du jour"/menu Mode) doivent porter sur CE
    // sous-ensemble, sinon l'aperçu promet un nombre de questions qui ne correspond pas à ce
    // que filtrerQuestions() livrera. 'plusratees' n'est PAS un critère d'appartenance (voir
    // _MEMBERSHIP_FILTER_FLAGS) : il ne doit pas participer à ce filtre, seulement à l'ordre.
    const membershipFlags = Array.isArray(filterFlags) ? filterFlags.filter(f => _MEMBERSHIP_FILTER_FLAGS.includes(f)) : [];
    if (membershipFlags.length) {
      list = list.filter(q => {
        const key = getKeyFor(q);
        const r = currentResponses[key];
        if (membershipFlags.includes('marquees') && r?.marked) return true;
        if (membershipFlags.includes('importantes') && r?.important) return true;
        if (membershipFlags.includes('avecnotes') && !!notesMap[key]) return true;
        if (membershipFlags.includes('avecexplication') && _hasOfficialExplication(q)) return true;
        if (membershipFlags.includes('aucune') && !(r?.marked) && !(r?.important) && !notesMap[key]) return true;
        if (membershipFlags.includes('diff_facile') && q.difficulte === 'facile') return true;
        if (membershipFlags.includes('diff_moyen') && q.difficulte === 'moyen') return true;
        if (membershipFlags.includes('diff_difficile') && q.difficulte === 'difficile') return true;
        if (membershipFlags.includes('orig_originale') && q.originalite === 'originale') return true;
        if (membershipFlags.includes('orig_doublon') && q.originalite === 'doublon') return true;
        return false;
      });
    }

    let total=0, nbReussies=0, nbRatees=0, nbNonvues=0, nbMarquees=0, nbImportantes=0, nbDifficiles=0, nbRevisions=0, nbAvecNotes=0, nbSuspendues=0;
    // Compter les questions uniques (propres à l'épreuve, pas des références thématiques)
    const nbUniques = isEpreuve ? questions.filter(q => q.categorie === normalizedSel).length : 0;
    const now = Date.now();
    list.forEach(q => {
      const key = getKeyFor(q);
      const r = currentResponses[key];
      if (notesMap[key]) nbAvecNotes++;
      // Une question suspendue ("🚫 Ne plus revoir") compte OBLIGATOIREMENT comme réussie
      // dans la progression globale et par catégorie (l'utilisateur a décidé qu'elle est
      // maîtrisée) — voir _effectiveStatus(). Elle reste comptabilisée à part (nbSuspendues)
      // pour le mode dédié "Ne plus revoir", et n'est jamais due pour une révision espacée.
      if (r && r.suspended) nbSuspendues++;
      total++;
      if (_isUnseen(r)) {
        nbNonvues++;
      }
      if (r) {
        const eff = _effectiveStatus(r);
        if (eff==="réussie") nbReussies++;
        if (eff==="ratée")   nbRatees++;
        if (r.marked)             nbMarquees++;
        if (r.important)          nbImportantes++;
        if ((r.failCount || 0) >= 2) nbDifficiles++;
        // Révisions du jour : question éligible SR et due (jamais une question suspendue,
        // désormais toujours "réussie" et donc hors du cycle de révision)
        if (!r.suspended && _isEligibleForSR(r) && _isDueForReview(r, now)) nbRevisions++;
      }
    });

    // Exposer les compteurs globalement (mode par défaut, badge accueil, bouton "Objectif du jour")
    nbRevisionsToday = nbRevisions;
    nbNonvuesToday = nbNonvues;
    nbSuspenduesTotal = nbSuspendues;

    // Ne jamais promettre plus de "nouvelles" que de questions réellement non vues :
    // sinon l'aperçu ment et "Objectif du jour"/"Mixte" peuvent démarrer un quiz vide.
    const dailyNewTargetRaw = (typeof getDailyNewTarget === 'function') ? getDailyNewTarget() : 15;
    const dailyNewTarget = Math.min(dailyNewTargetRaw, nbNonvues);
    const objectifTotal = nbRevisions + dailyNewTarget;

    const modeSelect = document.getElementById("mode");
    if (modeSelect) {
      modeSelect.innerHTML = `
        <option value="objectif">🚀 Répétition espacée (${nbRevisions} dues + ${dailyNewTarget} nouvelles)</option>
        <option value="mixte">🔀 Mixte : nouvelles + révisions dues (${Math.min(total, nbNonvues + nbRevisions)})</option>
        <option value="revisions">📅 Révisions du jour (${nbRevisions})</option>
        <option value="toutes">Toutes (${total})</option>
        ${isEpreuve ? `<option value="uniques">🔹 Uniques épreuve (${nbUniques})</option>` : ''}
        <option value="ratees">Ratées (${nbRatees})</option>
        <option value="ratees_nonvues">Ratées+Non vues (${nbRatees+nbNonvues})</option>
        <option value="nonvues">Non vues (${nbNonvues})</option>
        <option value="difficiles">⚠️ Difficiles (${nbDifficiles})</option>
        <option value="reussies">Réussies (${nbReussies})</option>
        <option value="marquees">Marquées (${nbMarquees})</option>
        <option value="importantes">Importantes (${nbImportantes})</option>
        <option value="avecnotes">📝 Avec notes (${nbAvecNotes})</option>
        <option value="suspendues">🚫 Ne plus revoir (${nbSuspendues})</option>
      `;
    }
    if (typeof _updateObjectifSummary === 'function') _updateObjectifSummary(nbRevisions, dailyNewTarget, objectifTotal);
}

async function chargerQuestions(cat) {
    const norm = getNormalizedCategory(cat);
    let fileName = "";
  const loadFile = async (fname) => {
    const res = await fetch(fname);
    const data = res.ok ? await res.json() : [];
    return Array.isArray(data) ? data : [];
  };
  const normalizeList = (list, categoryName) => list.map((q, i) => ({
    ...q,
    id: i + 1,
    categorie: categoryName,
    image: q.image || q.image_url || q.imageUrl || null
  }));

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
        case "AERODYNAMIQUE PRINCIPES DU VOL":
          fileName = "questions_aerodynamique.json";
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
        case "GLIGLI COMMUNICATIONS HARD":
          fileName = "gligli_communications_hard.json";
          break;
        case "GLIGLI CONNAISSANCES GENERALES AERONEF HARD":
          fileName = "gligli_connaissances_generales_aeronef_hard.json";
          break;
        case "GLIGLI EPREUVE COMMUNE HARD":
          fileName = "gligli_epreuve_commune_hard.json";
          break;
        case "GLIGLI EPREUVE SPECIFIQUE HARD":
          fileName = "gligli_epreuve_specifique_hard.json";
          break;
        case "GLIGLI METEOROLOGIE HARD":
          fileName = "gligli_meteorologie_hard.json";
          break;
        case "GLIGLI NAVIGATION HARD":
          fileName = "gligli_navigation_hard.json";
          break;
        case "GLIGLI PERFORMANCE HUMAINE HARD":
          fileName = "gligli_performance_humaine_hard.json";
          break;
        case "GLIGLI PERFORMANCES PREPARATION VOL HARD":
          fileName = "gligli_performances_preparation_vol_hard.json";
          break;
        case "GLIGLI PRINCIPES DU VOL HARD":
          fileName = "gligli_principes_du_vol_hard.json";
          break;
        case "GLIGLI PROCEDURES OPERATIONNELLES HARD":
          fileName = "gligli_procedures_operationnelles_hard.json";
          break;
        case "GLIGLI REGLEMENTATION HARD":
          fileName = "gligli_reglementation_hard.json";
          break;
        case "GLIGLI COMMUNICATIONS EASY":
          fileName = "gligli_communications_easy.json";
          break;
        case "GLIGLI CONNAISSANCES GENERALES AERONEF EASY":
          fileName = "gligli_connaissances_generales_aeronef_easy.json";
          break;
        case "GLIGLI EPREUVE COMMUNE EASY":
          fileName = "gligli_epreuve_commune_easy.json";
          break;
        case "GLIGLI EPREUVE SPECIFIQUE EASY":
          fileName = "gligli_epreuve_specifique_easy.json";
          break;
        case "GLIGLI METEOROLOGIE EASY":
          fileName = "gligli_meteorologie_easy.json";
          break;
        case "GLIGLI NAVIGATION EASY":
          fileName = "gligli_navigation_easy.json";
          break;
        case "GLIGLI PERFORMANCE HUMAINE EASY":
          fileName = "gligli_performance_humaine_easy.json";
          break;
        case "GLIGLI PERFORMANCES PREPARATION VOL EASY":
          fileName = "gligli_performances_preparation_vol_easy.json";
          break;
        case "GLIGLI PRINCIPES DU VOL EASY":
          fileName = "gligli_principes_du_vol_easy.json";
          break;
        case "GLIGLI PROCEDURES OPERATIONNELLES EASY":
          fileName = "gligli_procedures_operationnelles_easy.json";
          break;
        case "GLIGLI REGLEMENTATION EASY":
          fileName = "gligli_reglementation_easy.json";
          break;
        case "EASA ALL": {
          const easaCategories = [
            "EASA PROCEDURES",
            "EASA AERODYNAMIQUE",
            "EASA NAVIGATION",
            "EASA CONNAISSANCE DE L'AVION",
            "EASA METEOROLOGIE",
            "EASA PERFORMANCE ET PLANIFICATION",
            "EASA REGLEMENTATION",
            "EASA PERFORMANCES HUMAINES"
          ];
          try {
            const all = [];
            for (const subCat of easaCategories) {
              await chargerQuestions(subCat);
              all.push(...questions);
            }
            questions = _deduplicateQuestions(all);
          } catch (err) {
            console.error("Erreur de chargement EASA ALL", err);
            questions = [];
          }
          return;
        }
        case "GLIGLI ALL": {
          const gligliCategories = [
            "GLIGLI COMMUNICATIONS HARD",
            "GLIGLI COMMUNICATIONS EASY",
            "GLIGLI CONNAISSANCES GENERALES AERONEF HARD",
            "GLIGLI CONNAISSANCES GENERALES AERONEF EASY",
            "GLIGLI EPREUVE COMMUNE HARD",
            "GLIGLI EPREUVE COMMUNE EASY",
            "GLIGLI EPREUVE SPECIFIQUE HARD",
            "GLIGLI EPREUVE SPECIFIQUE EASY",
            "GLIGLI METEOROLOGIE HARD",
            "GLIGLI METEOROLOGIE EASY",
            "GLIGLI NAVIGATION HARD",
            "GLIGLI NAVIGATION EASY",
            "GLIGLI PERFORMANCE HUMAINE HARD",
            "GLIGLI PERFORMANCE HUMAINE EASY",
            "GLIGLI PERFORMANCES PREPARATION VOL HARD",
            "GLIGLI PERFORMANCES PREPARATION VOL EASY",
            "GLIGLI PRINCIPES DU VOL HARD",
            "GLIGLI PRINCIPES DU VOL EASY",
            "GLIGLI PROCEDURES OPERATIONNELLES HARD",
            "GLIGLI PROCEDURES OPERATIONNELLES EASY",
            "GLIGLI REGLEMENTATION HARD",
            "GLIGLI REGLEMENTATION EASY"
          ];
          try {
            const all = [];
            for (const subCat of gligliCategories) {
              await chargerQuestions(subCat);
              all.push(...questions);
            }
            questions = _deduplicateQuestions(all);
          } catch (err) {
            console.error("Erreur de chargement GLIGLI ALL", err);
            questions = [];
          }
          return;
        }
        case "GLIGLI HARD ALL": {
          const gligliHardCategories = [
            "GLIGLI COMMUNICATIONS HARD",
            "GLIGLI CONNAISSANCES GENERALES AERONEF HARD",
            "GLIGLI EPREUVE COMMUNE HARD",
            "GLIGLI EPREUVE SPECIFIQUE HARD",
            "GLIGLI METEOROLOGIE HARD",
            "GLIGLI NAVIGATION HARD",
            "GLIGLI PERFORMANCE HUMAINE HARD",
            "GLIGLI PERFORMANCES PREPARATION VOL HARD",
            "GLIGLI PRINCIPES DU VOL HARD",
            "GLIGLI PROCEDURES OPERATIONNELLES HARD",
            "GLIGLI REGLEMENTATION HARD"
          ];
          try {
            const all = [];
            for (const subCat of gligliHardCategories) {
              await chargerQuestions(subCat);
              all.push(...questions);
            }
            questions = _deduplicateQuestions(all);
          } catch (err) {
            console.error("Erreur de chargement GLIGLI HARD ALL", err);
            questions = [];
          }
          return;
        }
        case "GLIGLI EASY ALL": {
          const gligliEasyCategories = [
            "GLIGLI COMMUNICATIONS EASY",
            "GLIGLI CONNAISSANCES GENERALES AERONEF EASY",
            "GLIGLI EPREUVE COMMUNE EASY",
            "GLIGLI EPREUVE SPECIFIQUE EASY",
            "GLIGLI METEOROLOGIE EASY",
            "GLIGLI NAVIGATION EASY",
            "GLIGLI PERFORMANCE HUMAINE EASY",
            "GLIGLI PERFORMANCES PREPARATION VOL EASY",
            "GLIGLI PRINCIPES DU VOL EASY",
            "GLIGLI PROCEDURES OPERATIONNELLES EASY",
            "GLIGLI REGLEMENTATION EASY"
          ];
          try {
            const all = [];
            for (const subCat of gligliEasyCategories) {
              await chargerQuestions(subCat);
              all.push(...questions);
            }
            questions = _deduplicateQuestions(all);
          } catch (err) {
            console.error("Erreur de chargement GLIGLI EASY ALL", err);
            questions = [];
          }
          return;
        }
        case "AUTRES": {
          const autresCategories = [
            "PROCÉDURE RADIO",
            "PROCÉDURES OPÉRATIONNELLES",
            "RÉGLEMENTATION",
            "CONNAISSANCE DE L'AVION",
            "INSTRUMENTATION",
            "MASSE ET CENTRAGE",
            "MOTORISATION",
            "AERODYNAMIQUE PRINCIPES DU VOL"
          ];
          try {
            const all = [];
            for (const subCat of autresCategories) {
              await chargerQuestions(subCat);
              all.push(...questions);
            }
            questions = _deduplicateQuestions(all);
          } catch (err) {
            console.error("Erreur de chargement AUTRES", err);
            questions = [];
          }
          return;
        }
        case "TOUTES":
            return;
        default:
            console.warn("Catégorie inconnue:", cat);
            questions = [];
            return;
    }
    try {
        let data;
        if (_jsonCache.has(fileName)) {
          data = _jsonCache.get(fileName);
        } else {
          data = await _loadQuestionFileResilient(fileName);
          if (Array.isArray(data) && data.length) _jsonCache.set(fileName, data);
        }
        const normalizedCat = norm;
        const isEpreuve = norm.includes('EPREUVE');
        if (isEpreuve && Array.isArray(data)) {
          // Résoudre les références vers les catégories thématiques
          questions = resolveEpreuveQuestions(data, normalizedCat);
        } else {
          questions = Array.isArray(data) ? data.map((q, i) => ({
            ...q,
            id: i + 1,
            categorie: normalizedCat,
            image: q.image || q.image_url || q.imageUrl || null
          })) : [];
        }
      } catch (err) {
        console.error("Erreur de chargement pour", norm, err);
        questions = [];
    }
}

/** loadAllQuestions — Charge toutes les questions de toutes les catégories */
async function loadAllQuestions() {
  let allQuestions = [];
  const categories = [
    "AERODYNAMIQUE PRINCIPES DU VOL",
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
    "EASA PERFORMANCES HUMAINES", // Nouvelle catégorie
    "GLIGLI COMMUNICATIONS HARD",
    "GLIGLI CONNAISSANCES GENERALES AERONEF HARD",
    "GLIGLI EPREUVE COMMUNE HARD",
    "GLIGLI EPREUVE SPECIFIQUE HARD",
    "GLIGLI METEOROLOGIE HARD",
    "GLIGLI NAVIGATION HARD",
    "GLIGLI PERFORMANCE HUMAINE HARD",
    "GLIGLI PERFORMANCES PREPARATION VOL HARD",
    "GLIGLI PRINCIPES DU VOL HARD",
    "GLIGLI PROCEDURES OPERATIONNELLES HARD",
    "GLIGLI REGLEMENTATION HARD",
    "GLIGLI COMMUNICATIONS EASY",
    "GLIGLI CONNAISSANCES GENERALES AERONEF EASY",
    "GLIGLI EPREUVE COMMUNE EASY",
    "GLIGLI EPREUVE SPECIFIQUE EASY",
    "GLIGLI METEOROLOGIE EASY",
    "GLIGLI NAVIGATION EASY",
    "GLIGLI PERFORMANCE HUMAINE EASY",
    "GLIGLI PERFORMANCES PREPARATION VOL EASY",
    "GLIGLI PRINCIPES DU VOL EASY",
    "GLIGLI PROCEDURES OPERATIONNELLES EASY",
    "GLIGLI REGLEMENTATION EASY"
  ];
  for (const cat of categories) {
    await chargerQuestions(cat);
    allQuestions = allQuestions.concat(questions);
  }
  questions = _deduplicateQuestions(allQuestions);
}


function updateCategorySelect() {
  const catSelect = document.getElementById("categorie");
  const prevValue = catSelect.value;
  catSelect.innerHTML = "";

  const optionToutes = document.createElement("option");
  optionToutes.value = "TOUTES";
  optionToutes.textContent = `TOUTES LES QUESTIONS (${totalGlobal})`;
  catSelect.appendChild(optionToutes);

  // Use friendly display names for EASA categories
  const categories = [
    // Mettre les trois catégories agrégées juste après "Toutes"
    { value: "GLIGLI ALL", display: "GLIGLI - TOUTES", count: countGligliAll },
    { value: "GLIGLI HARD ALL", display: "GLIGLI - TOUTES (HARD)", count: countGligliHardAll },
    { value: "GLIGLI EASY ALL", display: "GLIGLI - TOUTES (EASY)", count: countGligliEasyAll },
    { value: "AUTRES", display: "AUTRES (hors EASA/GLIGLI)", count: countAutresAll },
    { value: "EASA ALL", display: "EASA - TOUTES", count: countEasaAll },
    // Puis les autres catégories
    { value: "AERODYNAMIQUE PRINCIPES DU VOL", display: "AERODYNAMIQUE PRINCIPES DU VOL", count: countAer },
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
    { value: "EASA PERFORMANCES HUMAINES", display: "EASA PERFORMANCES HUMAINES", count: countEasaPerfHumaines },
    { value: "GLIGLI COMMUNICATIONS HARD", display: "GLIGLI COMMUNICATIONS (HARD)", count: countGligliComm },
    { value: "GLIGLI COMMUNICATIONS EASY", display: "GLIGLI COMMUNICATIONS (EASY)", count: countGligliCommEasy },
    { value: "GLIGLI CONNAISSANCES GENERALES AERONEF HARD", display: "GLIGLI CONNAISSANCES GÉNÉRALES AÉRONEF (HARD)", count: countGligliConnaissance },
    { value: "GLIGLI CONNAISSANCES GENERALES AERONEF EASY", display: "GLIGLI CONNAISSANCES GÉNÉRALES AÉRONEF (EASY)", count: countGligliConnaissanceEasy },
    { value: "GLIGLI EPREUVE COMMUNE HARD", display: "GLIGLI ÉPREUVE COMMUNE (HARD)", count: countGligliEpreuveCommune },
    { value: "GLIGLI EPREUVE COMMUNE EASY", display: "GLIGLI ÉPREUVE COMMUNE (EASY)", count: countGligliEpreuveCommuneEasy },
    { value: "GLIGLI EPREUVE SPECIFIQUE HARD", display: "GLIGLI ÉPREUVE SPÉCIFIQUE (HARD)", count: countGligliEpreuveSpecifique },
    { value: "GLIGLI EPREUVE SPECIFIQUE EASY", display: "GLIGLI ÉPREUVE SPÉCIFIQUE (EASY)", count: countGligliEpreuveSpecifiqueEasy },
    { value: "GLIGLI METEOROLOGIE HARD", display: "GLIGLI MÉTÉOROLOGIE (HARD)", count: countGligliMeteo },
    { value: "GLIGLI METEOROLOGIE EASY", display: "GLIGLI MÉTÉOROLOGIE (EASY)", count: countGligliMeteoEasy },
    { value: "GLIGLI NAVIGATION HARD", display: "GLIGLI NAVIGATION (HARD)", count: countGligliNavigation },
    { value: "GLIGLI NAVIGATION EASY", display: "GLIGLI NAVIGATION (EASY)", count: countGligliNavigationEasy },
    { value: "GLIGLI PERFORMANCE HUMAINE HARD", display: "GLIGLI PERFORMANCE HUMAINE (HARD)", count: countGligliPerfHumaine },
    { value: "GLIGLI PERFORMANCE HUMAINE EASY", display: "GLIGLI PERFORMANCE HUMAINE (EASY)", count: countGligliPerfHumaineEasy },
    { value: "GLIGLI PERFORMANCES PREPARATION VOL HARD", display: "GLIGLI PERFORMANCES & PRÉP. VOL (HARD)", count: countGligliPerfPrepVol },
    { value: "GLIGLI PERFORMANCES PREPARATION VOL EASY", display: "GLIGLI PERFORMANCES & PRÉP. VOL (EASY)", count: countGligliPerfPrepVolEasy },
    { value: "GLIGLI PRINCIPES DU VOL HARD", display: "GLIGLI PRINCIPES DU VOL (HARD)", count: countGligliPrincipesVol },
    { value: "GLIGLI PRINCIPES DU VOL EASY", display: "GLIGLI PRINCIPES DU VOL (EASY)", count: countGligliPrincipesVolEasy },
    { value: "GLIGLI PROCEDURES OPERATIONNELLES HARD", display: "GLIGLI PROCÉDURES OPÉRATIONNELLES (HARD)", count: countGligliProcedures },
    { value: "GLIGLI PROCEDURES OPERATIONNELLES EASY", display: "GLIGLI PROCÉDURES OPÉRATIONNELLES (EASY)", count: countGligliProceduresEasy },
    { value: "GLIGLI REGLEMENTATION HARD", display: "GLIGLI RÉGLEMENTATION (HARD)", count: countGligliReglementation },
    { value: "GLIGLI REGLEMENTATION EASY", display: "GLIGLI RÉGLEMENTATION (EASY)", count: countGligliReglementationEasy }
  ];
  
  categories.forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat.value;
    opt.textContent = `${cat.display} (${cat.count})`;
    catSelect.appendChild(opt);
  });

  // Restaurer la sélection précédente (le rebuild ci-dessus vide le select)
  if (prevValue) catSelect.value = prevValue;

  // Miroir dans le menu "Catégorie" de la carte "Objectif du jour"
  const objSelect = document.getElementById("objectifCategorie");
  if (objSelect) {
    objSelect.innerHTML = catSelect.innerHTML;
    objSelect.value = catSelect.value;
  }
}

/**
 * categoryChanged() – Charge les questions selon la catégorie sélectionnée
 *
 * BUG CORRIGÉ : cette fonction ne mettait JAMAIS à jour la variable globale
 * `selectedCategory` (elle ne touchait qu'une variable locale `selected`). Or
 * updateModeCounts() calcule `normalizedSel = getNormalizedSelectedCategory(selectedCategory)`
 * puis filtre `questions` par `q.categorie === normalizedSel` — donc après un premier
 * changement manuel de catégorie, `selectedCategory` restait bloqué sur la catégorie
 * précédente (ou celle restaurée par initIndex() au chargement de page) alors que `questions`
 * contenait déjà les questions de la NOUVELLE catégorie choisie : le filtre ne trouvait plus
 * aucune correspondance, `list` était vide, et toute la carte "Répétition espacée" (+ les
 * compteurs de filtres) retombait à 0 — alors que "Progression globale" (displayHomeProgressBar,
 * qui lit `questions` directement sans passer par `selectedCategory`) restait correcte. D'où
 * l'écart observé entre les deux cartes sur une même catégorie.
 *
 * Jeton de génération (_categoryChangeToken) : protection complémentaire — chargerQuestions()/
 * loadAllQuestions() modifient le tableau GLOBAL `questions`, partagé par updateModeCounts() et
 * displayHomeProgressBar(). Sans garde, changer deux fois rapidement de catégorie (avant que le
 * premier chargement ne soit fini) lance deux exécutions concurrentes de categoryChanged() ; la
 * plus ANCIENNE peut se terminer APRÈS la plus récente et écraser `questions`/les compteurs
 * avec les données de la mauvaise catégorie. Chaque appel prend un jeton ; si un appel plus
 * récent a démarré entre-temps, celui-ci abandonne silencieusement avant de toucher au DOM.
 */
let _categoryChangeToken = 0;
/**
 * _updateNavDifficultyMenuVisibility() – Affiche/masque le petit menu de filtre par difficulté
 * (facile/moyen/difficile) à côté du sélecteur "Catégorie", uniquement pour les 3 catégories dont
 * les questions ont été analysées une à une (voir NAV_DIFFICULTY_CATEGORIES). Décoche aussi les 3
 * cases quand le menu se masque, pour ne pas laisser un filtre actif invisible fausser une autre
 * catégorie (aucune question n'y a de champ "difficulte", le filtre y renverrait silencieusement 0).
 */
function _updateNavDifficultyMenuVisibility() {
  const els = ['navDifficultyFilterInline', 'objNavDifficultyFilterInline']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  if (!els.length) return;
  const normalizedSel = getNormalizedSelectedCategory(selectedCategory);
  const show = NAV_DIFFICULTY_CATEGORIES.includes(normalizedSel);
  els.forEach(el => { el.style.display = show ? 'flex' : 'none'; });
  if (!show) {
    ['filterDiffFacileCheckbox', 'filterDiffMoyenCheckbox', 'filterDiffDifficileCheckbox',
     'objFilterDiffFacileCheckbox', 'objFilterDiffMoyenCheckbox', 'objFilterDiffDifficileCheckbox'].forEach(id => {
      const cb = document.getElementById(id);
      if (cb && cb.checked) { cb.checked = false; _onModeFilterCheckboxChange(cb); }
    });
  }
}

/**
 * _updateOriginalityMenuVisibility() – Même principe que _updateNavDifficultyMenuVisibility()
 * mais pour le menu "🆕 Original / 🔁 Déjà traité", visible pour RÉGLEMENTATION et chaque
 * catégorie EASA (voir ORIGINALITY_CATEGORIES) — seules catégories dont les questions ont un
 * champ "originalite" (comparaison avec leur(s) référence(s) GLIGLI EASY/HARD).
 */
function _updateOriginalityMenuVisibility() {
  const els = ['reglOriginalityFilterInline', 'objReglOriginalityFilterInline']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  if (!els.length) return;
  const normalizedSel = getNormalizedSelectedCategory(selectedCategory);
  const show = ORIGINALITY_CATEGORIES.includes(normalizedSel);
  els.forEach(el => { el.style.display = show ? 'flex' : 'none'; });
  if (!show) {
    ['filterOrigOriginaleCheckbox', 'filterOrigDoublonCheckbox',
     'objFilterOrigOriginaleCheckbox', 'objFilterOrigDoublonCheckbox'].forEach(id => {
      const cb = document.getElementById(id);
      if (cb && cb.checked) { cb.checked = false; _onModeFilterCheckboxChange(cb); }
    });
  }
}

async function categoryChanged() {
  const myToken = ++_categoryChangeToken;
  const selected = document.getElementById("categorie").value;
  selectedCategory = selected;
  _updateNavDifficultyMenuVisibility();
  _updateOriginalityMenuVisibility();
  // Mémoriser le mode actuellement sélectionné AVANT la mise à jour
  const modeSelect = document.getElementById('mode');
  const previousMode = modeSelect ? modeSelect.value : 'mixte';

  if (selected === "TOUTES") {
    await loadAllQuestions();
  } else {
    await chargerQuestions(selected);
  }
  if (myToken !== _categoryChangeToken) return; // un changement plus récent a pris le relais

  await updateModeCounts();
  if (myToken !== _categoryChangeToken) return;

  // Restaurer le mode précédent (updateModeCounts recrée les options)
  if (modeSelect) modeSelect.value = previousMode;
  if (typeof _updateRevisionsBadge === 'function') _updateRevisionsBadge();

  // La carte "Progression globale" de l'accueil lit le tableau global `questions` (comme
  // updateModeCounts()) mais n'était rendue qu'UNE FOIS au chargement initial de la page —
  // changer de catégorie ne la rafraîchissait jamais, elle restait figée sur la 1ère catégorie
  // affichée.
  if (typeof displayHomeProgressBar === 'function' && typeof currentResponses !== 'undefined') {
    displayHomeProgressBar(currentResponses, window._lastDailyHist || {});
  }
}

/**
 * _orderByFailCountRoundRobin() – Réordonne une liste de questions pour prioriser celles avec
 * le plus d'échecs (failCount), SANS laisser une seule catégorie très difficile écraser les
 * autres : on trie d'abord chaque catégorie séparément par failCount décroissant, puis on
 * pioche un tour de rôle (round-robin) une question par catégorie à chaque tour. Résultat :
 * chaque catégorie représentée dans `pool` garde une chance d'apparaître tôt, tout en mettant
 * en avant, en son sein, ses questions les plus ratées.
 */
function _orderByFailCountRoundRobin(pool, responses) {
  const byCat = new Map();
  pool.forEach(q => {
    const cat = q.categorie || '_';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(q);
  });
  byCat.forEach(arr => arr.sort((a, b) => (responses[getKeyFor(b)]?.failCount || 0) - (responses[getKeyFor(a)]?.failCount || 0)));
  const groups = [...byCat.values()];
  const result = [];
  let i = 0;
  while (result.length < pool.length) {
    let addedAny = false;
    for (const arr of groups) {
      if (i < arr.length) { result.push(arr[i]); addedAny = true; }
    }
    if (!addedAny) break;
    i++;
  }
  return result;
}

/**
 * _dueQuestionsSorted() – Questions éligibles à la répétition espacée ET dues maintenant,
 * triées des plus en retard (nextReview le plus ancien) aux moins urgentes.
 */
function _dueQuestionsSorted(pool, responses) {
  const now = Date.now();
  const due = pool.filter(q => {
    const r = responses[getKeyFor(q)];
    return r && _isEligibleForSR(r) && _isDueForReview(r, now);
  });
  due.sort((a, b) => {
    const nrA = responses[getKeyFor(a)].nextReview || 0;
    const nrB = responses[getKeyFor(b)].nextReview || 0;
    return nrA - nrB; // plus petit nextReview = plus en retard
  });
  return due;
}

async function filtrerQuestions(mode, nb, filterFlags) {
  if (!questions.length) {
    console.warn("    questions[] est vide");
    currentQuestions = [];
    return;
  }

  // fetch and normalize up-to-date responses (_loadMergedResponses lit le document principal
  // ET tous les shards de `responses` — voir js/offline.js — indispensable ici : c'est LE
  // point d'entrée qui décide quelles questions sont dues/non vues/ratées pour la sélection.
  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
  let responses = {};
  if (uid) {
    const doc = await _loadMergedResponses(uid);
    const data = doc.exists ? doc.data() : {};
    responses = normalizeResponses(data.responses || {});
    _currentSessionCount = data.quizSessionCount || _currentSessionCount || 0;
  }

  const shuffledAll = [...questions].sort(() => 0.5 - Math.random());
  // "suspendues" (ne plus revoir) est le seul mode qui doit VOIR les questions suspendues —
  // partout ailleurs, elles sont exclues de la sélection automatique.
  if (mode === "suspendues") {
    currentQuestions = shuffledAll.filter(q => responses[getKeyFor(q)]?.suspended).slice(0, nb);
    return;
  }
  let shuffled = shuffledAll.filter(q => !responses[getKeyFor(q)]?.suspended);

  // FILTRES marquées/importantes/avec notes/aucune/avec commentaire officiel (cases à cocher) :
  // réduisent le VIVIER de départ à seulement les questions correspondant à au moins un critère
  // coché, AVANT que le mode ci-dessus (Révisions du jour/Mixte/Objectif du jour/etc.) ne fasse
  // sa sélection — sinon un mode qui plafonne son résultat (ex. Objectif du jour) pourrait piocher
  // des questions non cochées dans son lot initial puis les perdre en filtrant après coup,
  // livrant moins que promis. 'plusratees' n'est PAS un critère d'appartenance (voir
  // _MEMBERSHIP_FILTER_FLAGS dans helpers.js) : traité séparément plus bas, comme un ORDRE.
  const membershipFlagsFQ = Array.isArray(filterFlags) ? filterFlags.filter(f => _MEMBERSHIP_FILTER_FLAGS.includes(f)) : [];
  if (membershipFlagsFQ.length) {
    let notesMapFlt = null;
    if (membershipFlagsFQ.includes('avecnotes') || membershipFlagsFQ.includes('aucune')) {
      if (uid) {
        try {
          const docNF = await getDocWithTimeout(db.collection('quizProgress').doc(uid));
          notesMapFlt = docNF.exists ? (docNF.data().notes || {}) : {};
        } catch (e) {
          notesMapFlt = (typeof _notesCache === 'object' && _notesCache) ? _notesCache : {};
        }
      } else {
        notesMapFlt = {};
      }
    }
    shuffled = shuffled.filter(q => {
      const key = getKeyFor(q);
      const r = responses[key];
      if (membershipFlagsFQ.includes('marquees') && r?.marked) return true;
      if (membershipFlagsFQ.includes('importantes') && r?.important) return true;
      if (membershipFlagsFQ.includes('avecnotes') && notesMapFlt && !!notesMapFlt[key]) return true;
      if (membershipFlagsFQ.includes('avecexplication') && _hasOfficialExplication(q)) return true;
      if (membershipFlagsFQ.includes('aucune') && !(r?.marked) && !(r?.important) && !(notesMapFlt && notesMapFlt[key])) return true;
      if (membershipFlagsFQ.includes('diff_facile') && q.difficulte === 'facile') return true;
      if (membershipFlagsFQ.includes('diff_moyen') && q.difficulte === 'moyen') return true;
      if (membershipFlagsFQ.includes('diff_difficile') && q.difficulte === 'difficile') return true;
      if (membershipFlagsFQ.includes('orig_originale') && q.originalite === 'originale') return true;
      if (membershipFlagsFQ.includes('orig_doublon') && q.originalite === 'doublon') return true;
      return false;
    });
  }

  // "Plus ratées" : priorise les questions avec le plus d'échecs, EN CONSERVANT la
  // représentation de chaque catégorie (round-robin par catégorie plutôt qu'un tri global qui
  // ferait disparaître les catégories les moins difficiles derrière une seule très difficile).
  if (Array.isArray(filterFlags) && filterFlags.includes('plusratees')) {
    shuffled = _orderByFailCountRoundRobin(shuffled, responses);
  }

  if (mode === "toutes") {
    currentQuestions = shuffled.slice(0, nb);
  }
  else if (mode === "ratees") {
    currentQuestions = shuffled
      .filter(q => responses[getKeyFor(q)]?.status === 'ratée')
      .slice(0, nb);
  }
  else if (mode === "nonvues") {
    currentQuestions = shuffled
      .filter(q => _isUnseen(responses[getKeyFor(q)]))
      .slice(0, nb);
  }
  else if (mode === "ratees_nonvues") {
    currentQuestions = shuffled
      .filter(q => {
         const r = responses[getKeyFor(q)];
         return r?.status === 'ratée' || _isUnseen(r);
      })
      .slice(0, nb);
  }
  else if (mode === "revisions") {
    currentQuestions = _dueQuestionsSorted(shuffled, responses).slice(0, nb);
  }
  else if (mode === "mixte") {
    // Mélange nouvelles questions + révisions dues, façon Anki : les révisions dues sont
    // prioritaires (planification SR), mais on réserve toujours une part aux nouvelles questions
    // pour ne pas bloquer la progression si le retard de révisions est important.
    const dueSorted = _dueQuestionsSorted(shuffled, responses);
    const newPool = shuffled.filter(q => _isUnseen(responses[getKeyFor(q)]));
    const minNewSlots = Math.min(newPool.length, Math.max(1, Math.round(nb * 0.3)));
    const dueSlots = Math.max(0, Math.min(dueSorted.length, nb - minNewSlots));
    let mix = [...dueSorted.slice(0, dueSlots), ...newPool.slice(0, nb - dueSlots)];
    // Si pas assez de nouvelles pour compléter, puiser dans le reste des révisions dues
    if (mix.length < nb) {
      const usedKeys = new Set(mix.map(q => getKeyFor(q)));
      const extra = dueSorted.filter(q => !usedKeys.has(getKeyFor(q))).slice(0, nb - mix.length);
      mix = [...mix, ...extra];
    }
    // Mélanger l'ordre final pour ne pas grouper toutes les révisions en premier
    currentQuestions = mix.sort(() => 0.5 - Math.random());
  }
  else if (mode === "objectif") {
    // Session "Objectif du jour" (bouton un-clic) : TOUTES les révisions dues sont incluses
    // sans plafond (elles sont prioritaires, non négociables), complétées par un nombre fixe
    // de nouvelles questions. Contrairement à "mixte", on ne réserve pas un quota de nouvelles
    // au détriment des révisions : nb est calculé par l'appelant = dues + objectif de nouvelles.
    const dueSorted = _dueQuestionsSorted(shuffled, responses);
    const newPool = shuffled.filter(q => _isUnseen(responses[getKeyFor(q)]));
    const newTarget = Math.max(0, nb - dueSorted.length);
    const mix = [...dueSorted, ...newPool.slice(0, newTarget)];
    currentQuestions = mix.sort(() => 0.5 - Math.random());
  }
  else if (mode === "difficiles") {
    currentQuestions = shuffled
      .filter(q => (responses[getKeyFor(q)]?.failCount || 0) >= 2)
      .slice(0, nb);
  }
  else if (mode === "reussies") {
    currentQuestions = shuffled
      .filter(q => responses[getKeyFor(q)]?.status === 'réussie')
      .slice(0, nb);
  }
  else if (mode === "importantes") {
    const allImportantes = shuffled.filter(q => responses[getKeyFor(q)]?.important);
    currentQuestions = _excludeRecentlyAnswered(allImportantes, nb);
  }
  else if (mode === "marquees") {
    const allMarquees = shuffled.filter(q => responses[getKeyFor(q)]?.marked);
    // Priorité aux questions ratées dont le retryAfterSession est atteint
    const dueRetry = allMarquees.filter(q => {
      const r = responses[getKeyFor(q)];
      return r && r.retryAfterSession && r.retryAfterSession <= _currentSessionCount && r.status === 'ratée';
    });
    const rest = allMarquees.filter(q => {
      const r = responses[getKeyFor(q)];
      return !(r && r.retryAfterSession && r.retryAfterSession <= _currentSessionCount && r.status === 'ratée');
    });
    const ordered = [...dueRetry, ...rest];
    currentQuestions = _excludeRecentlyAnswered(ordered, nb);
  }
  else if (mode === "avecnotes") {
    // Charger les notes depuis Firestore
    let notesMap = {};
    if (uid) {
      try {
        const docN = await getDocWithTimeout(db.collection('quizProgress').doc(uid));
        notesMap = docN.exists ? (docN.data().notes || {}) : {};
      } catch (e) {
        notesMap = (typeof _notesCache === 'object' && _notesCache) ? _notesCache : {};
      }
    }
    currentQuestions = shuffled
      .filter(q => !!notesMap[getKeyFor(q)])
      .slice(0, nb);
  }
  else if (typeof mode === 'string' && mode.startsWith('combo:')) {
    // Combinaison cochable "marquées" / "importantes" / "avec notes" (union, pas exclusion)
    const flags = mode.slice(6).split(',').filter(Boolean);
    let notesMap = {};
    if (flags.includes('avecnotes') && uid) {
      try {
        const docN = await getDocWithTimeout(db.collection('quizProgress').doc(uid));
        notesMap = docN.exists ? (docN.data().notes || {}) : {};
      } catch (e) {
        notesMap = (typeof _notesCache === 'object' && _notesCache) ? _notesCache : {};
      }
    }
    const matches = shuffled.filter(q => {
      const r = responses[getKeyFor(q)];
      if (flags.includes('marquees') && r?.marked) return true;
      if (flags.includes('importantes') && r?.important) return true;
      if (flags.includes('avecnotes') && !!notesMap[getKeyFor(q)]) return true;
      return false;
    });
    // Même priorité que le mode "marquees" seul : questions ratées marquées dont le retry est dû
    let ordered = matches;
    if (flags.includes('marquees')) {
      const dueRetry = matches.filter(q => {
        const r = responses[getKeyFor(q)];
        return r && r.marked && r.retryAfterSession && r.retryAfterSession <= _currentSessionCount && r.status === 'ratée';
      });
      const dueRetryKeys = new Set(dueRetry.map(getKeyFor));
      const rest = matches.filter(q => !dueRetryKeys.has(getKeyFor(q)));
      ordered = [...dueRetry, ...rest];
    }
    currentQuestions = _excludeRecentlyAnswered(ordered, nb);
  }
  else if (mode === "uniques") {
    // Questions exclusives à cette épreuve (pas des références thématiques)
    const normalizedSel = getNormalizedSelectedCategory(selectedCategory);
    currentQuestions = shuffled
      .filter(q => q.categorie === normalizedSel)
      .slice(0, nb);
  }

  // INJECTION : questions de la file de ré-interrogation (countdown === 0)
  // Ces questions ratées 2 quiz avant sont injectées dans le quiz actuel
  // SAUF celles déjà réussies entre-temps.
  // Ce mécanisme est un renforcement à COURT TERME (à l'échelle de quelques quiz), complémentaire
  // du planning par répétition espacée nextReview/srInterval qui opère à LONG TERME (jours/semaines) —
  // comparable aux "learning steps" d'Anki avant qu'une carte n'entre dans le planning espacé.
  // On ne l'injecte pas en mode "revisions" pour garder une session de révision pure, focalisée
  // uniquement sur les questions réellement dues ce jour-là.
  try {
    if (mode !== 'revisions') {
      const queue = JSON.parse(localStorage.getItem('reaskQueue') || '[]');
      const ready = queue.filter(item => item.countdown <= 0);
      const remaining = queue.filter(item => item.countdown > 0);
      if (ready.length > 0) {
        // Filtrer : ne pas injecter si la question est maintenant réussie, ou suspendue
        const stillFailed = ready.filter(item => {
          const r = responses[item.key];
          return (!r || r.status !== 'réussie') && !(r && r.suspended);
        });
        const toInject = stillFailed.slice(0, 5);
        const currentKeys = new Set(currentQuestions.map(q => getKeyFor(q)));
        toInject.forEach(item => {
          if (!currentKeys.has(item.key) && item.question) {
            currentQuestions.push(item.question);
            currentKeys.add(item.key);
          }
        });
        // Retirer les questions réussies et injectées de la queue
        const leftover = stillFailed.slice(5);
        localStorage.setItem('reaskQueue', JSON.stringify([...remaining, ...leftover]));
      }
    }
  } catch (e) { /* ignore */ }
}

/**
 * _excludeRecentlyAnswered() – Exclut les questions récemment posées si possible,
 * sinon complète avec celles récemment posées pour atteindre nb.
 */
function _excludeRecentlyAnswered(pool, nb) {
  let recentKeys = [];
  try {
    const raw = localStorage.getItem('recentlyAnsweredKeys');
    if (raw) recentKeys = JSON.parse(raw);
  } catch (e) { /* ignore */ }

  if (!recentKeys.length) return pool.slice(0, nb);

  const recentSet = new Set(recentKeys);
  const fresh = pool.filter(q => !recentSet.has(getKeyFor(q)));
  const recent = pool.filter(q => recentSet.has(getKeyFor(q)));

  // Prendre d'abord les questions non récentes, puis compléter avec les récentes si besoin
  if (fresh.length >= nb) {
    return fresh.slice(0, nb);
  } else {
    return [...fresh, ...recent].slice(0, nb);
  }
}

/**
 * toggleMarquerQuestion() – Marque ou supprime une question marquée tout en conservant son statut initial
 */
