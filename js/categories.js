// === categories.js === Category normalization, question loading, filtering ===

// Cache mémoire pour éviter de re-fetcher les mêmes fichiers JSON
const _jsonCache = new Map();

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
  const results = await Promise.allSettled(
    files.map(f => fetch(f).then(r => r.ok ? r.json() : []))
  );
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      _jsonCache.set(files[i], Array.isArray(r.value) ? r.value : []);
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
async function updateModeCounts() {
    const normalizedSel = getNormalizedSelectedCategory(selectedCategory);
    // For aggregate categories (EASA ALL, GLIGLI ALL, AUTRES, TOUTES), use all loaded questions
    // because chargerQuestions already loaded the right set with correct individual categories
    const isAggregate = normalizedSel === "TOUTES" || normalizedSel === "EASA ALL" || normalizedSel === "GLIGLI ALL" || normalizedSel === "AUTRES";
    const list = isAggregate
      ? questions
      : questions.filter(q => q.categorie === normalizedSel);

    let total=0, nbReussies=0, nbRatees=0, nbNonvues=0, nbMarquees=0, nbImportantes=0, nbDifficiles=0;
    list.forEach(q => {
      const r = currentResponses[getKeyFor(q)];
      total++;
      if (!r) {
        nbNonvues++;
      } else {
        if (r.status==="réussie") nbReussies++;
        if (r.status==="ratée")   nbRatees++;
        if (r.marked)             nbMarquees++;
        if (r.important)          nbImportantes++;
        if ((r.failCount || 0) >= 2) nbDifficiles++;
      }
    });

    const modeSelect = document.getElementById("mode");
    if (modeSelect) {
      modeSelect.innerHTML = `
        <option value="toutes">Toutes (${total})</option>
        <option value="ratees">Ratées (${nbRatees})</option>
        <option value="ratees_nonvues">Ratées+Non vues (${nbRatees+nbNonvues})</option>
        <option value="nonvues">Non vues (${nbNonvues})</option>
        <option value="difficiles">⚠️ Difficiles (${nbDifficiles})</option>
        <option value="reussies">Réussies (${nbReussies})</option>
        <option value="marquees">Marquées (${nbMarquees})</option>
        <option value="importantes">Importantes (${nbImportantes})</option>
      `;
    }
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
            questions = all;
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
            questions = all;
          } catch (err) {
            console.error("Erreur de chargement GLIGLI ALL", err);
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
            questions = all;
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
          const res = await fetch(fileName);
          data = res.ok ? await res.json() : [];
          if (Array.isArray(data)) _jsonCache.set(fileName, data);
        }
        const normalizedCat = norm;
        questions = Array.isArray(data) ? data.map((q, i) => ({
          ...q,
          id: i + 1,
          categorie: normalizedCat,
          image: q.image || q.image_url || q.imageUrl || null
        })) : [];
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
  questions = allQuestions;
}


function updateCategorySelect() {
  const catSelect = document.getElementById("categorie");
  catSelect.innerHTML = "";

  const optionToutes = document.createElement("option");
  optionToutes.value = "TOUTES";
  optionToutes.textContent = `TOUTES LES QUESTIONS (${totalGlobal})`;
  catSelect.appendChild(optionToutes);

  // Use friendly display names for EASA categories
  const categories = [
    // Mettre les trois catégories agrégées juste après "Toutes"
    { value: "GLIGLI ALL", display: "GLIGLI - TOUTES", count: countGligliAll },
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
}

/**
 * categoryChanged() – Charge les questions selon la catégorie sélectionnée
 */
async function categoryChanged() {
  const selected = document.getElementById("categorie").value;
  // Mémoriser le mode actuellement sélectionné AVANT la mise à jour
  const modeSelect = document.getElementById('mode');
  const previousMode = modeSelect ? modeSelect.value : 'ratees_nonvues';

  if (selected === "TOUTES") {
    await loadAllQuestions();
  } else {
    await chargerQuestions(selected);
  }
  await updateModeCounts();

  // Restaurer le mode précédent (updateModeCounts recrée les options)
  if (modeSelect) modeSelect.value = previousMode;

  document.getElementById("totalGlobalInfo").textContent =
    "Total questions disponibles: " + questions.length;
}


async function filtrerQuestions(mode, nb) {
  if (!questions.length) {
    console.warn("    questions[] est vide");
    currentQuestions = [];
    return;
  }

  // fetch and normalize up-to-date responses
  const uid = auth.currentUser?.uid || localStorage.getItem('cachedUid');
  let responses = {};
  if (uid) {
    const doc = await getDocWithTimeout(db.collection('quizProgress').doc(uid));
    responses = normalizeResponses(doc.exists ? doc.data().responses : {});
  }

  const shuffled = [...questions].sort(() => 0.5 - Math.random());
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
      .filter(q => !responses[getKeyFor(q)])
      .slice(0, nb);
  }
  else if (mode === "ratees_nonvues") {
    currentQuestions = shuffled
      .filter(q => {
         const s = responses[getKeyFor(q)]?.status;
         return s === 'ratée' || !s;
      })
      .slice(0, nb);
  }
  else if (mode === "difficiles") {
    currentQuestions = shuffled
      .filter(q => (responses[getKeyFor(q)]?.failCount || 0) >= 2)
      .slice(0, nb);
  }
  else if (mode === "importantes") {
    const allImportantes = shuffled.filter(q => responses[getKeyFor(q)]?.important);
    currentQuestions = _excludeRecentlyAnswered(allImportantes, nb);
  }
  else if (mode === "marquees") {
    const allMarquees = shuffled.filter(q => responses[getKeyFor(q)]?.marked);
    currentQuestions = _excludeRecentlyAnswered(allMarquees, nb);
  }
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
