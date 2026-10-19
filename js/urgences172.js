/* Fiches d'urgence — Reims/Cessna F 172 M (OO-FCE).
 *
 * Source : « Flight Manual Cessna 172 M OO-FCE » (aéro-club du Borinage), section 3 « Procédures d'urgence »
 * (p. 3.1 à 3.7), section 4 (fonctionnement irrégulier du moteur) et section 2 (limites d'emploi).
 *
 * Principe : chaque COMMANDE de l'avion a sa couleur (pastille à gauche) et l'ACTION est écrite en gros à droite.
 * Même couleur = même organe, d'une fiche à l'autre : on retrouve le geste sans lire.
 * Aide-mémoire : ne remplace pas le manuel de vol.
 *
 * Mise en page : pages de 138 × 210 mm (A5 moins 1 cm de large, pour tenir dans une pochette plastique). Toutes les tailles sont en cqw (1 % de la largeur de la
 * page) : la fiche garde exactement les mêmes proportions à l'écran (téléphone, ordinateur) et à l'impression.
 * Un autre avion (ex. Cessna 150 M) = mêmes pages avec d'autres vitesses : voir `AIRCRAFT`.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ couleurs par commande */
  var CTL = {
    gaz:      ['GAZ',        '#263238', '#fff'],
    melange:  ['MÉLANGE',    '#d32f2f', '#fff'],
    carb:     ['CARBURANT',  '#ef6c00', '#fff'],
    mag:      ['MAGNÉTOS',   '#1565c0', '#fff'],
    master:   ['MASTER',     '#7b1fa2', '#fff'],
    elec:     ['ÉLEC',       '#7b1fa2', '#fff'],
    volets:   ['VOLETS',     '#2e7d32', '#fff'],
    vit:      ['VITESSE',    '#00838f', '#fff'],
    pil:      ['PILOTAGE',   '#00838f', '#fff'],
    chauf:    ['CHAUFFAGE',  '#fdd835', '#111'],
    rcarb:    ['RÉCH. CARBU', '#fdd835', '#111'],
    frein:    ['FREINS',     '#6d4c41', '#fff'],
    radio:    ['RADIO',      '#d81b60', '#fff'],
    cab:      ['CABINE',     '#546e7a', '#fff'],
    si:       ['SI',         '#b0bec5', '#111']
  };
  var LEGEND = ['gaz', 'melange', 'carb', 'mag', 'master', 'volets', 'vit', 'chauf', 'frein', 'radio', 'cab'];

  /* ------------------------------------------------------------------ chiffres propres à l'avion */
  var AIRCRAFT = {
    id: 'f172m', name: 'F 172 M', reg: 'OO-FCE',
    // [kt, km/h] — manuel de vol F 172 M
    v: {
      planeRentres: '65 kt · 121 km/h', planeSortis: '60 kt · 111 km/h', planeVol: '70 kt · 129 km/h',
      feu: '100 kt · 185 km/h', profond: '60 kt · 111 km/h', forceMoteur: '60 kt · 111 km/h',
      forceSans: '60 kt · 111 km/h', forceSansR: '65 kt · 121 km/h', amerMoteur: '55 kt · 102 km/h',
      amerSansR: '65 kt · 121 km/h', amerSans10: '60 kt · 111 km/h', givrage: '65–74 kt · 121–137 km/h',
      spirale: '80 kt · 148 km/h'
    },
    cles: [['Vne', '159 kt', '295 km/h'], ['Vno', '128 kt', '237 km/h'], ['Vfe', '85 kt', '158 km/h'], ['Va', '97 kt', '180 km/h']],
    huile: 'Huile : T° max 118 °C · pression mini ralenti 25 psi (1,72 bar) · normal 60–90 psi'
  };
  var V = AIRCRAFT.v;

  /* type d'urgence : couleur du bandeau de chaque bloc */
  var CATS = {
    moteur:  ['MOTEUR',            '#1565c0'],
    feu:     ['INCENDIE',          '#c62828'],
    atterr:  ['ATTERRISSAGE',      '#2e7d32'],
    elec:    ['ÉLECTRIQUE',        '#6a1b9a'],
    moteur2: ['MOTEUR IRRÉGULIER', '#ef6c00'],
    givrage: ['GIVRAGE',           '#455a64'],
    vrille:  ['VRILLE',            '#5d4037']
  };

  /* ------------------------------------------------------------------ contenu : étapes [commande, action, détail?] */
  /* Une entrée de PAGES = UNE page imprimée : la mise en page est fixe (page 1 moteur, page 2 incendies…),
     elle ne dépend pas de l'écran. `k` = couleur du bandeau des blocs de la page (un bloc peut avoir son `k`).
     Une étape = [commande, action, détail] ; deux gestes courts qui se suivent peuvent partager une ligne :
     [commande, action, détail, commande2, action2, détail2] (ordre de lecture : gauche puis droite). */
  var PAGES = [
    { k: 'moteur', blocks: [
      { t: 'AU DÉCOLLAGE · sur la piste', steps: [
        ['gaz', 'RÉDUIT', '', 'frein', 'FREINER'], ['volets', 'RENTRÉS', '', 'melange', 'ÉTOUFFOIR'], ['mag', 'OFF', '', 'master', 'OFF']
      ] },
      { t: 'APRÈS LE DÉCOLLAGE', steps: [
        ['vit', V.planeRentres, 'volets rentrés  (' + V.planeSortis + ' sortis)'],
        ['melange', 'ÉTOUFFOIR', '', 'carb', 'OFF'], ['mag', 'OFF', '', 'volets', '40° SI BESOIN'], ['master', 'OFF']
      ], warn: 'Atterrir DROIT DEVANT. Éviter les grands changements de direction. JAMAIS de demi-tour vers l’aire d’envol.' },
      { t: 'EN VOL · tentative de redémarrage', steps: [
        ['vit', V.planeVol, 'plané'], ['carb', 'BOTH', '', 'melange', 'RICHE'], ['gaz', 'OUVERT 2,5 cm', '', 'mag', 'BOTH']
      ] },
      { t: 'PAS DE REDÉMARRAGE · atterrissage en campagne', steps: [
        ['melange', 'ÉTOUFFOIR', '', 'gaz', 'FERMÉ'], ['mag', 'OFF', '', 'carb', 'OFF'],
        ['master', 'ON', 'pour sortir les volets']
      ], note: 'Pleins volets recommandés sur terrain non aménagé.' }
    ] },

    { k: 'feu', blocks: [
      { t: 'AU SOL · feu dans la veine d’admission', steps: [
        ['mag', 'DÉMARREUR', 'enclenché · laisser tourner 15–30 s'], ['melange', 'ÉTOUFFOIR', '', 'gaz', 'PLEIN GAZ'], ['carb', 'OFF']
      ] },
      { t: 'EN VOL · moteur', steps: [
        ['chauf', 'FERMÉ', '', 'melange', 'ÉTOUFFOIR'], ['gaz', 'PLEIN AVANT', '', 'carb', 'OFF'], ['mag', 'OFF'],
        ['vit', V.feu, 'augmenter si le feu persiste'], ['volets', '40° SI BESOIN', '', 'master', 'OFF']
      ], warn: 'Ne PAS remettre le moteur en marche. Atterrissage de campagne.' },
      { t: 'CABINE', steps: [
        ['master', 'OFF', '', 'chauf', 'AÉRATEURS FERMÉS'], ['cab', 'EXTINCTEUR', 'si disponible']
      ] },
      { t: 'VOILURE', steps: [
        ['master', 'OFF', '', 'chauf', 'AÉRATEURS FERMÉS'], ['pil', 'GLISSADE', 'côté OPPOSÉ à l’aile en feu']
      ], note: 'Atterrir au plus tôt, volets RENTRÉS.' },
      { t: 'RÉSEAU ÉLECTRIQUE', steps: [
        ['master', 'OFF', '', 'elec', 'AUTRES OFF'], ['master', 'ON', '', 'elec', 'UN PAR UN']
      ], note: 'Remettre les interrupteurs un à un, court délai entre chaque, jusqu’à localiser le court-circuit.' }
    ] },

    { k: 'atterr', blocks: [
      { t: 'FORCÉ AVEC MOTEUR', steps: [
        ['vit', V.forceMoteur, 'volets 20° · chercher un terrain'], ['cab', 'CEINTURE', '', 'elec', 'TOUT OFF*'],
        ['volets', '40°', 'approche à ' + V.forceMoteur], ['master', 'OFF', '', 'cab', 'PORTES'],
        ['pil', 'QUEUE BASSE', '', 'mag', 'OFF'], ['carb', 'OFF', '', 'frein', 'FREINER FORT']
      ], note: '* sauf magnétos et master, jusqu’au dernier moment · portes déverrouillées.' },
      { t: 'FORCÉ SANS MOTEUR', steps: [
        ['melange', 'ÉTOUFFOIR', '', 'carb', 'OFF'], ['elec', 'TOUT OFF', 'sauf master'],
        ['vit', V.forceSans, 'volets sortis  (' + V.forceSansR + ' rentrés)'], ['volets', 'SELON BESOIN', '40° recommandé'],
        ['master', 'OFF', '', 'cab', 'PORTES'], ['pil', 'QUEUE BASSE', '', 'frein', 'FREINER FORT']
      ] },
      { t: 'AMERRISSAGE FORCÉ', steps: [
        ['cab', 'OBJETS LOURDS', 'attacher/jeter', 'radio', 'MAYDAY 121,5'],
        ['pil', 'CAP', 'face au vent si mer agitée · parallèle aux lames si forte houle et vent faible'],
        ['vit', V.amerMoteur, 'avec moteur · volets 20–40° · 300 ft/min'],
        ['vit', V.amerSansR, 'sans moteur · rentrés  (' + V.amerSans10 + ' volets 10°)'],
        ['cab', 'PORTES', '', 'pil', 'HORIZONTAL'], ['cab', 'ÉVACUER', 'ouvrir la fenêtre pour inonder la cabine'],
        ['cab', 'GILETS + CANOT', 'gonfler après évacuation']
      ], note: 'Protéger la tête à l’impact. L’avion ne flotte que quelques minutes.' },
      { t: 'PNEU ÉCLATÉ OU DÉGONFLÉ', steps: [
        ['volets', 'NORMAUX', '', 'pil', 'CABRER'], ['frein', 'FREIN OPPOSÉ', 'à fond dès le contact', 'mag', 'OFF']
      ], note: 'Garder l’aile haute côté pneu défectueux.' }
    ] },

    { k: 'elec', blocks: [
      { t: 'PANNE COMPLÈTE', steps: [
        ['master', 'OFF', '', 'pil', 'ATTERRIR VITE']
      ], note: 'Plus de turn coordinator, de jauges ni de volets.' },
      { t: 'ALTERNATEUR / RÉGULATEUR EN PANNE', steps: [
        ['elec', 'NON ESSENTIELS OFF'], ['elec', 'DISJONCTEUR ALT', 'attendre 2–3 min puis réenclencher · s’il saute : ne pas insister'],
        ['pil', 'ATTERRIR', 'dès que possible']
      ] },
      { t: 'AMPÈREMÈTRE / SURTENSION', steps: [
        ['si', 'TROP FAIBLE', 'batterie qui se décharge : ALT OFF, atterrir dès que possible'],
        ['si', 'SURTENSION', 'lampe allumée : MASTER OFF puis ON'], ['si', 'LAMPE REVIENT', 'interrompre le vol dès que possible']
      ], note: 'De nuit : remettre ALT sur ON au moment des volets ou des phares.' },
      { k: 'moteur2', t: 'GIVRAGE CARBURATEUR', steps: [
        ['gaz', 'PLEIN GAZ', '', 'rcarb', 'TIRÉ À FOND'], ['rcarb', 'COUPER', 'dès que le moteur est régulier, puis réajuster les gaz']
      ], note: 'En croisière : réchauffage au minimum nécessaire, mélange appauvri en conséquence.' },
      { k: 'moteur2', t: 'BOUGIES ENCRASSÉES / MAGNÉTO', steps: [
        ['mag', 'L puis R', 'test · perte nette sur une seule = bougies ou magnéto'], ['melange', 'APPAUVRIR', 'au réglage normal de croisière'],
        ['melange', 'RICHE', 'si pas mieux au bout de quelques minutes'], ['mag', 'BOTH', 'rallier l’aérodrome le plus proche']
      ] },
      { k: 'moteur2', t: 'BAISSE DE PRESSION D’HUILE', steps: [
        ['si', 'T° NORMALE', 'manomètre probablement HS : atterrir à l’aérodrome le plus proche'],
        ['si', 'T° EN HAUSSE', 'panne imminente : réduire le régime, choisir un terrain, bas régime à l’approche']
      ] }
    ] },

    { k: 'givrage', blocks: [
      { t: 'GIVRAGE EN VOL · vol interdit, traversée possible', steps: [
        ['chauf', 'PITOT ON', '', 'rcarb', 'ON'], ['pil', 'DEMI-TOUR / ALTITUDE', 'sortir de la zone givrante'],
        ['chauf', 'CABINE À FOND', 'dégivrage pare-brise'], ['gaz', 'OUVRIR', 'augmenter le régime'], ['volets', 'RENTRÉS', 'efficacité de la profondeur'],
        ['vit', V.givrage, 'selon l’épaisseur · virages larges · décrochage plus élevé']
      ], note: 'Ouvrir la glace gauche et racler le pare-brise. Atterrir à plat, au plus proche aéroport.' },
      { k: 'vrille', t: 'INVOLONTAIRE', steps: [
        ['gaz', 'RALENTI'], ['pil', 'AILERONS NEUTRES'], ['pil', 'PALONNIER', 'à fond, sens OPPOSÉ à la rotation'],
        ['pil', 'PROFONDEUR', 'à piquer, vivement, après ¼ de tour'], ['pil', 'PALONNIER NEUTRE', 'rotation arrêtée · ressource modérée']
      ] },
      { k: 'vrille', t: 'SPIRALE · mauvaise visibilité', steps: [
        ['gaz', 'FERMÉS', '', 'rcarb', 'ON'], ['pil', 'AILERONS + DIRECTION', 'aligner l’avion du turn coordinator'],
        ['vit', V.spirale, 'régler la profondeur · ne pas toucher au volant'], ['pil', 'SORTIE DES NUAGES', 'reprendre le vol normal']
      ] },
      { k: 'atterr', t: 'SANS COMMANDE DE PROFONDEUR', steps: [
        ['vit', V.profond, 'palier · volets 20°'], ['gaz', 'PUISSANCE', 'seule pour régler la descente'],
        ['pil', 'COMPENSATEUR', 'ne plus y toucher une fois réglé'],
        ['pil', 'ARRONDI', 'compensateur plein cabré + régime pour poser à plat'], ['gaz', 'COUPER', 'dès le contact']
      ], note: 'La réduction des gaz fait piquer : risque de toucher du nez.' }
    ] }
  ];

  /* ------------------------------------------------------------------ rendu */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function chip(k) { var c = CTL[k]; return '<span class="f1-chip" style="background:' + c[1] + ';color:' + c[2] + '">' + esc(c[0]) + '</span>'; }

  function block(b, gk) {
    var c = CATS[b.k || gk] || CATS.moteur;
    var h = '<section class="f1-block"><h3 style="background:' + c[1] + '"><b>' + esc(c[0]) + '</b> · ' + esc(b.t) + '</h3>';
    function half(c, a, d) { return chip(c) + '<span class="f1-act">' + esc(a) + (d ? '<small>' + esc(d) + '</small>' : '') + '</span>'; }
    b.steps.forEach(function (s) {
      h += '<div class="f1-row' + (s[3] ? ' f1-pair' : '') + '">' + half(s[0], s[1], s[2]) + (s[3] ? half(s[3], s[4], s[5]) : '') + '</div>';
    });
    if (b.warn) h += '<div class="f1-warn">⚠ ' + esc(b.warn) + '</div>';
    if (b.note) h += '<div class="f1-note">' + esc(b.note) + '</div>';
    return h + '</section>';
  }

  function legend() {
    return '<div class="f1-legend">' + LEGEND.map(chip).join('') + '</div>';
  }

  function keyFigures() {
    return '<div class="f1-keys">' + AIRCRAFT.cles.map(function (k) {
      return '<span><b>' + k[0] + '</b> ' + k[1] + '<i>' + k[2] + '</i></span>';
    }).join('') + '</div>';
  }

  function footer() {
    return '<footer>' + esc(AIRCRAFT.huile) + '<br>Source : manuel de vol REIMS/CESSNA F 172 M (' + esc(AIRCRAFT.reg) + '), sections 2, 3 et 4. Aide-mémoire : ne remplace pas le manuel de vol.</footer>';
  }

  /* Mise en page FIXE : une entrée de PAGES = une page (page 1 moteur, page 2 incendies…). Elle ne dépend pas
     de l'écran : les tailles sont en cqw, la page a les mêmes proportions partout (même onglet caché au chargement). */
  function layout(host) {
    PAGES.forEach(function (g, i) {
      var a = document.createElement('article'); a.className = 'f1-page';
      a.innerHTML = '<header><span>Urgences ' + esc(AIRCRAFT.name) + '</span><em>' + esc(AIRCRAFT.reg) + ' · ' + (i + 1) + '/' + PAGES.length + '</em></header>'
        + (i === 0 ? legend() + keyFigures() : '')
        + g.blocks.map(function (b) { return block(b, g.k); }).join('')
        + (i === PAGES.length - 1 ? footer() : '');
      host.appendChild(a);
    });
    return PAGES.length;
  }

  function render(root) {
    root.innerHTML = '<div class="f1-bar"><div><b>Fiches d’urgence ' + esc(AIRCRAFT.name) + '</b> · ' + esc(AIRCRAFT.reg) + '<br>'
      + '<small id="f1Count">138 × 210 mm · une couleur = une commande</small></div>'
      + '<span class="f1-btns"><a class="f1-print" href="fiche_urgence_172M_A5.pdf" target="_blank" rel="noopener">📄 PDF</a>'
      + '<button type="button" class="f1-print" id="f1Print">🖨 Imprimer</button></span></div><div class="f1-pages" id="f1Pages"></div>';
    var n = layout(document.getElementById('f1Pages'));
    document.getElementById('f1Count').textContent = '138 × 210 mm (A5 moins 1 cm) · ' + n + ' pages · une couleur = une commande';
    document.getElementById('f1Print').onclick = function () { document.body.classList.add('print-f172'); window.print(); };
    window.addEventListener('afterprint', function () { document.body.classList.remove('print-f172'); });
  }

  /* ------------------------------------------------------------------ styles */
  /* SCALE agrandit tout le contenu (toutes les tailles cqw) : à régler si une page déborde ou reste trop vide. */
  var SCALE = 1.02;
  var css = ''
    + '.f1-bar{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0 0 12px;font-size:.95em}'
    + '.f1-bar small{opacity:.7}'
    + '.f1-print{padding:9px 16px;border-radius:20px;border:0;background:linear-gradient(135deg,#ff6b6b,#ee5a24);color:#fff;font-weight:700;cursor:pointer;text-decoration:none;font-size:.85em;display:inline-block}.f1-btns{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}'
    + '.f1-pages{display:flex;flex-direction:column;align-items:center;gap:16px}'
    + '.f1-page{container-type:inline-size;width:min(100%,138mm);aspect-ratio:138/210;box-sizing:border-box;padding:3cqw 3.2cqw;background:#fff;color:#111;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.3);overflow:hidden;display:flex;flex-direction:column;gap:1cqw;font-family:Arial,Helvetica,sans-serif}'
    + '.f1-page header{display:flex;justify-content:space-between;align-items:baseline;margin:-3cqw -3.2cqw 0;padding:1.4cqw 3.2cqw;color:#fff;background:#263238}'
    + '.f1-page>*{flex-shrink:0}.f1-page header span{font-size:4.2cqw;font-weight:800;letter-spacing:.02em;text-transform:uppercase}'
    + '.f1-page header em{font-size:2.4cqw;font-style:normal;opacity:.9}'
    + '.f1-legend{display:flex;flex-wrap:wrap;gap:.7cqw}'
    + '.f1-legend .f1-chip{width:auto;flex:1 1 auto;padding:0 1.3cqw;font-size:2cqw}'
    + '.f1-keys{display:flex;gap:1cqw;justify-content:space-between;background:#eceff1;border-radius:1cqw;padding:.9cqw 1.3cqw;font-size:2.6cqw}'
    + '.f1-keys i{display:block;font-style:normal;font-size:2cqw;color:#455a64}'
    + '.f1-block{display:flex;flex-direction:column;gap:.4cqw;flex:0 0 auto}'
    + '.f1-block h3{margin:0;padding:.35cqw 1.2cqw;background:#263238;color:#fff;font-size:2.5cqw;letter-spacing:.03em;border-radius:.8cqw}'
    + '.f1-row{display:flex;align-items:center;gap:1.2cqw;counter-increment:s}'
    + '.f1-block{counter-reset:s}.f1-block+.f1-block{margin-top:auto}'
    + '.f1-row::before{content:counter(s);flex:0 0 3.2cqw;font-size:2.4cqw;font-weight:700;color:#78909c;text-align:right}'
    + '.f1-chip{flex:0 0 21.5cqw;box-sizing:border-box;text-align:center;font-size:2.6cqw;font-weight:800;letter-spacing:.02em;border-radius:.9cqw;line-height:3.9cqw;height:3.9cqw;white-space:nowrap}'
    + '.f1-act{flex:1 1 auto;min-width:0;font-size:3.4cqw;font-weight:800;line-height:1.05;display:flex;flex-wrap:wrap;align-items:baseline;column-gap:1.2cqw}'
    + '.f1-act small{font-size:2.3cqw;font-weight:500;color:#37474f;line-height:1.1}'
    + '.f1-pair .f1-act{flex:0 1 auto}.f1-pair .f1-chip{flex:0 0 20cqw}.f1-pair .f1-act+.f1-chip{margin-left:auto}'
    + '.f1-warn{background:#ffebee;border-left:1cqw solid #c62828;padding:.6cqw 1.3cqw;font-size:2.55cqw;font-weight:700;border-radius:.6cqw}'
    + '.f1-note{background:#fff8e1;border-left:1cqw solid #f9a825;padding:.5cqw 1.3cqw;font-size:2.3cqw;border-radius:.6cqw}'
    + '.f1-page footer{margin-top:auto;font-size:2cqw;color:#455a64;border-top:.2cqw solid #cfd8dc;padding-top:.8cqw}'
    /* impression : une page 138 × 210 mm par feuille (A5 moins 1 cm de large), couleurs conservées */
    + '@media print{@page{size:138mm 210mm;margin:0}'
    + 'body.print-f172>*:not(.f1-printroot){display:none!important}'
    + 'body.print-f172 .f1-printroot{display:block!important;margin:0!important;padding:0!important}'
    + 'body.print-f172 .f1-bar{display:none}body.print-f172 .urg-hero,body.print-f172 .urg-tabs{display:none!important}'
    + 'body.print-f172 .f1-pages{display:block}'
    + 'body.print-f172 .f1-page{width:138mm;height:210mm;border-radius:0;box-shadow:none;break-after:page;page-break-after:always;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    + '}';

  function init() {
    var root = document.getElementById('f172Root');
    if (!root) return;
    var st = document.createElement('style');
    st.textContent = css.replace(/(\d*\.?\d+)cqw/g, function (m, n) { return +(n * SCALE).toFixed(2) + 'cqw'; }); document.head.appendChild(st);
    var wrap = root.closest('.f1-printroot') || root; wrap.classList.add('f1-printroot');
    render(root);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.URG172 = { pages: PAGES, aircraft: AIRCRAFT };
})();
