/* metar-fr.js — traduction d'un METAR (ou SPECI) en français clair.
 *
 *   metarFr(raw) -> texte français sur plusieurs lignes (ou null si ce n'est pas un METAR)
 *   metarFrToggle(root, on) -> bascule tous les METAR d'une page entre codé et français
 *
 * Utilisé par navlog.html : page OPMET (iframe opmet.html, lignes .entry de la section METAR) et
 * liste « METAR AéroWeb » (.aw-txt). Un clic sur un METAR le bascule seul ; le bouton
 * « 🇫🇷 Français » bascule tout. Le texte codé reste la référence : la traduction n'invente rien,
 * un groupe non reconnu est recopié tel quel dans « Autres ».
 */
(function () {
  'use strict';

  var WX = { DZ: 'bruine', RA: 'pluie', SN: 'neige', SG: 'neige en grains', IC: 'cristaux de glace', PL: 'granules de glace',
    GR: 'grêle', GS: 'grésil', UP: 'précipitation inconnue', BR: 'brume', FG: 'brouillard', FU: 'fumée', VA: 'cendres volcaniques',
    DU: 'poussière', SA: 'sable', HZ: 'brume sèche', PO: 'tourbillons de poussière', SQ: 'grains', FC: 'trombe',
    SS: 'tempête de sable', DS: 'tempête de poussière' };
  var DESC = { MI: 'mince', BC: 'en bancs', PR: 'partiel', DR: 'chasse-basse', BL: 'chasse-haute', SH: 'averses de', TS: 'orage', FZ: 'se congelant' };
  var CLOUD = { FEW: 'peu (1-2/8)', SCT: 'épars (3-4/8)', BKN: 'fragmentés (5-7/8)', OVC: 'couvert (8/8)' };
  var COLOUR = { BLU: 'BLU — visibilité ≥ 8 km et plafond ≥ 2 500 ft', WHT: 'WHT — visibilité ≥ 5 km et plafond ≥ 1 500 ft',
    GRN: 'GRN — visibilité ≥ 3,7 km et plafond ≥ 700 ft', YLO1: 'YLO1 — visibilité ≥ 2,5 km et plafond ≥ 500 ft',
    YLO2: 'YLO2 — visibilité ≥ 1,6 km et plafond ≥ 300 ft', YLO: 'YLO — visibilité ≥ 1,6 km et plafond ≥ 300 ft',
    AMB: 'AMB — visibilité ≥ 800 m et plafond ≥ 200 ft', RED: 'RED — visibilité < 800 m ou plafond < 200 ft' };
  var DIRS = { N: 'nord', NE: 'nord-est', E: 'est', SE: 'sud-est', S: 'sud', SW: 'sud-ouest', W: 'ouest', NW: 'nord-ouest' };

  function n(x) { return String(parseInt(x, 10)); }
  function ft(h) { return (parseInt(h, 10) * 100).toLocaleString('fr-FR') + ' ft'; }
  function wind(m) {
    var dir = m[1], spd = parseInt(m[2], 10), g = m[4], u = m[5] === 'MPS' ? ' m/s' : ' kt';
    if (dir === '000' && spd === 0) return 'calme';
    var s = (dir === 'VRB' ? 'variable' : dir + '°') + ' ' + spd + u;
    if (g) s += ', rafales ' + parseInt(g, 10) + u;
    return s;
  }
  function weather(tok) {
    var m = /^(\+|-|VC)?(RE)?(MI|BC|PR|DR|BL|SH|TS|FZ)?((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)*)$/.exec(tok);
    if (!m || (!m[3] && !m[4])) return null;
    var ph = [], s = m[4] || '';
    for (var i = 0; i < s.length; i += 2) ph.push(WX[s.substr(i, 2)]);
    var txt = '';
    if (m[3] === 'TS') txt = 'orage' + (ph.length ? ' avec ' + ph.join(' et ') : '');
    else if (m[3] === 'SH') txt = 'averses de ' + (ph.join(' et ') || 'précipitations');
    else if (m[3]) txt = ph.join(' et ') + ' ' + DESC[m[3]];
    else txt = ph.join(' et ');
    if (m[1] === '-') txt += ' faible';
    if (m[1] === '+') txt += ' forte';
    if (m[1] === 'VC') txt += ' au voisinage';
    if (m[2]) txt = txt + ' (récent)';
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }

  function decodeGroups(toks, out) {
    var other = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i], m;
      if (!t || t === '=' ) continue;
      if ((m = /^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?(KT|MPS)$/.exec(t))) { out.push('Vent : ' + wind(m)); continue; }
      if ((m = /^(\d{3})V(\d{3})$/.exec(t))) { out.push('Direction variable entre ' + m[1] + '° et ' + m[2] + '°'); continue; }
      if (t === 'CAVOK') { out.push('CAVOK : visibilité ≥ 10 km, pas de nuage sous 5 000 ft, ni CB ni TCU, pas de temps significatif'); continue; }
      if ((m = /^(\d{4})(N|NE|E|SE|S|SW|W|NW)?$/.exec(t))) {
        var v = parseInt(m[1], 10);
        var vt = v >= 9999 ? '10 km ou plus' : (v >= 5000 ? (v / 1000).toLocaleString('fr-FR') + ' km' : v.toLocaleString('fr-FR') + ' m');
        out.push((m[2] ? 'Visibilité minimale vers le ' + DIRS[m[2]] : 'Visibilité') + ' : ' + vt);
        continue;
      }
      if ((m = /^R(\d{2}[LRC]?)\/([PM])?(\d{4})(V([PM])?(\d{4}))?([UDN])?$/.exec(t))) {
        var r = (m[2] === 'P' ? 'plus de ' : m[2] === 'M' ? 'moins de ' : '') + n(m[3]) + ' m' + (m[4] ? ' à ' + n(m[6]) + ' m' : '');
        out.push('Portée visuelle piste ' + m[1] + ' : ' + r + ({ U: ', en hausse', D: ', en baisse', N: ', stable' }[m[7]] || ''));
        continue;
      }
      if ((m = /^(FEW|SCT|BKN|OVC)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?$/.exec(t))) {
        out.push('Nuages : ' + CLOUD[m[1]] + (m[2] === '///' ? ' (hauteur inconnue)' : ' à ' + ft(m[2])) + (m[3] === 'CB' ? ' — cumulonimbus' : m[3] === 'TCU' ? ' — cumulus bourgeonnants' : ''));
        continue;
      }
      if (t === 'NSC') { out.push('Pas de nuage significatif'); continue; }
      if (t === 'NCD') { out.push('Aucun nuage détecté (station automatique)'); continue; }
      if (t === 'SKC' || t === 'CLR') { out.push('Ciel clair'); continue; }
      if ((m = /^VV(\d{3}|\/\/\/)$/.exec(t))) { out.push('Ciel invisible, visibilité verticale ' + (m[1] === '///' ? 'inconnue' : ft(m[1]))); continue; }
      if ((m = /^(M?\d{2})\/(M?\d{2})?$/.exec(t))) {
        var tt = function (x) { return x ? (x.charAt(0) === 'M' ? '-' + n(x.slice(1)) : n(x)) + ' °C' : '?'; };
        out.push('Température ' + tt(m[1]) + ', point de rosée ' + tt(m[2]));
        continue;
      }
      if ((m = /^Q(\d{4})$/.exec(t))) { out.push('QNH ' + n(m[1]) + ' hPa'); continue; }
      if ((m = /^A(\d{4})$/.exec(t))) { out.push('Calage ' + m[1].slice(0, 2) + ',' + m[1].slice(2) + ' inHg'); continue; }
      if (t === 'WS' && toks[i + 1]) {
        if (toks[i + 1] === 'ALL') { out.push('Cisaillement de vent sur toutes les pistes'); i += 2; continue; }
        var rw = /^R(\d{2}[LRC]?)$/.exec(toks[i + 1]);
        if (rw) { out.push('Cisaillement de vent sur la piste ' + rw[1]); i++; continue; }
      }
      if (t === 'NOSIG') { out.push('Pas de changement significatif prévu (NOSIG)'); continue; }
      if (t === 'TEMPO' || t === 'BECMG') {
        var rest = [], j = i + 1;
        while (j < toks.length && !/^(TEMPO|BECMG|RMK)$/.test(toks[j])) rest.push(toks[j++]);
        var sub = [];
        var when = rest.filter(function (x) { return /^(FM|TL|AT)\d{4}$/.test(x); }).map(function (x) {
          return { FM: 'à partir de ', TL: 'jusqu’à ', AT: 'à ' }[x.slice(0, 2)] + x.slice(2, 4) + ':' + x.slice(4) + ' UTC';
        });
        decodeGroups(rest.filter(function (x) { return !/^(FM|TL|AT)\d{4}$/.test(x); }), sub);
        out.push((t === 'TEMPO' ? 'Temporairement' : 'Devenant') + (when.length ? ' (' + when.join(', ') + ')' : '') + ' : ' + (sub.join(' ; ') || rest.join(' ')));
        i = j - 1;
        continue;
      }
      if (t === 'RMK') { out.push('Remarques : ' + toks.slice(i + 1).join(' ')); break; }
      var col = /^(BLACK)?(BLU|WHT|GRN|YLO1|YLO2|YLO|AMB|RED)\+?$/.exec(t);
      if (col) { out.push('Code couleur militaire ' + COLOUR[col[2]] + (col[1] ? ' — BLACK : piste inutilisable' : '')); continue; }
      var w = weather(t);
      if (w) { out.push('Temps : ' + w); continue; }
      if (/^\/+$/.test(t)) continue;                       // groupe manquant (station automatique)
      other.push(t);
    }
    if (other.length) out.push('Autres : ' + other.join(' '));
  }

  function metarFr(raw) {
    var s = String(raw || '').replace(/\s+/g, ' ').replace(/=\s*$/, '').trim();
    var toks = s.split(' ');
    var kind = 'METAR';
    if (/^(METAR|SPECI)$/.test(toks[0])) kind = toks.shift();
    if (toks[0] === 'COR') toks.shift();
    if (!/^[A-Z]{4}$/.test(toks[0] || '')) return null;
    var icao = toks.shift(), head = icao;
    var m = /^(\d{2})(\d{2})(\d{2})Z$/.exec(toks[0] || '');
    if (m) { head += ' — ' + (kind === 'SPECI' ? 'observation spéciale' : 'observation') + ' du ' + n(m[1]) + ' à ' + m[2] + ':' + m[3] + ' UTC'; toks.shift(); }
    else return null;
    if (toks[0] === 'NIL') return head + '\nPas d’observation (NIL)';
    var lines = [head];
    if (toks[0] === 'AUTO') { lines.push('Observation automatique (sans observateur)'); toks.shift(); }
    decodeGroups(toks, lines);
    return lines.join('\n');
  }

  /* ---------------- TAF ---------------- */
  function period(p) {   // 2518/2624 -> « du 25 à 18 h au 26 à 24 h UTC »
    var m = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(p);
    return m ? 'du ' + n(m[1]) + ' à ' + m[2] + ' h au ' + n(m[3]) + ' à ' + m[4] + ' h UTC' : p;
  }
  function tafFr(raw) {
    var s = String(raw || '').replace(/\s+/g, ' ').replace(/=\s*$/, '').trim();
    var toks = s.split(' ');
    if (toks[0] === 'TAF') toks.shift();
    var mod = '';
    while (/^(AMD|COR|CNL)$/.test(toks[0])) { mod += { AMD: ' (amendé)', COR: ' (corrigé)', CNL: ' (annulé)' }[toks.shift()]; }
    if (!/^[A-Z]{4}$/.test(toks[0] || '')) return null;
    var icao = toks.shift(), head = 'Prévision TAF ' + icao + mod, m;
    if ((m = /^(\d{2})(\d{2})(\d{2})Z$/.exec(toks[0] || ''))) { head += ', émise le ' + n(m[1]) + ' à ' + m[2] + ':' + m[3] + ' UTC'; toks.shift(); }
    if (/^\d{4}\/\d{4}$/.test(toks[0] || '')) head += ', valable ' + period(toks.shift());
    if (toks[0] === 'NIL') return head + '\nPas de prévision (NIL)';
    var lines = [head], seg = [], label = 'Situation de base';
    function flush() {
      if (!seg.length) return;
      var sub = [];
      decodeGroups(seg.filter(function (x) { return !/^TX|^TN/.test(x); }), sub);
      seg.filter(function (x) { return /^T[XN]M?\d{2}\/\d{4}Z$/.test(x); }).forEach(function (x) {
        var t = /^T([XN])(M?)(\d{2})\/(\d{2})(\d{2})Z$/.exec(x);
        sub.push('Température ' + (t[1] === 'X' ? 'maxi ' : 'mini ') + (t[2] ? '-' : '') + n(t[3]) + ' °C le ' + n(t[4]) + ' à ' + t[5] + ' h');
      });
      lines.push('▸ ' + label + ' : ' + (sub.join(' ; ') || seg.join(' ')));
      seg = [];
    }
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i], pm;
      if (/^PROB(30|40)$/.test(t) || t === 'TEMPO' || t === 'BECMG') {
        flush();
        var lab = '';
        if ((pm = /^PROB(\d{2})$/.exec(t))) { lab = 'Probabilité ' + pm[1] + ' %'; if (toks[i + 1] === 'TEMPO') { lab += ', temporairement'; i++; } }
        else lab = t === 'TEMPO' ? 'Temporairement' : 'Devenant';
        if (/^\d{4}\/\d{4}$/.test(toks[i + 1] || '')) lab += ' ' + period(toks[++i]);
        label = lab;
        continue;
      }
      if ((pm = /^FM(\d{2})(\d{2})(\d{2})$/.exec(t))) { flush(); label = 'À partir du ' + n(pm[1]) + ' à ' + pm[2] + ':' + pm[3] + ' UTC'; continue; }
      seg.push(t);
    }
    flush();
    return lines.join('\n');
  }

  /* ---------------- Textes en langage abrégé OACI (NOTAM, GAMET, SIGMET, AIRMET, MAA…) ----------------
     Traduction mot à mot des abréviations OACI et des mots anglais courants des NOTAM : le sens
     reste celui du texte officiel, affiché à côté (un clic revient au texte d'origine). */
  var PHRASES = [
    [/\bNOT AVBL\b|\bNOT AVAILABLE\b/g, 'non disponible'], [/\bDUE TO\b/g, 'en raison de'], [/\bOUT OF SERVICE\b/g, 'hors service'],
    [/\bSFC WIND\b/g, 'Vent de surface'], [/\bSFC VIS\b/g, 'Visibilité de surface'], [/\bSFC WSPD MAX\b/g, 'vent de surface maxi'],
    [/\bSIG CLD\b/g, 'Nuages significatifs'], [/\bMNM QNH\b/g, 'QNH minimum'], [/\bMT OBSC\b/g, 'Montagnes masquées'],
    [/\bWIND\/T\b/g, 'Vent / température'], [/\bAD WRNG\b/g, 'Avertissement d’aérodrome'], [/\bWX WRNG\b/g, 'Avertissement météo'],
    [/\bOR LESS\b/g, 'ou moins'], [/\bOR MORE\b/g, 'ou plus'], [/\bREF TO\b/g, 'voir'], [/\bIN FORCE\b/g, 'en vigueur'],
    [/\bDAY AND NIGHT\b/g, 'jour et nuit'], [/\bICAO MARKINGS?\b/g, 'balisage OACI'], [/\bTHE\b/g, 'le'],
    [/\bLINE\b/g, 'ligne'], [/\bFIR\b/g, 'FIR'], [/\bAIRMASS\b/g, 'masse d’air'], [/\bOFFSHORE\b/g, 'au large'],
    [/\bCOASTAL AREA\b/g, 'zone côtière'], [/\bMOBILE RIDGE\b/g, 'dorsale mobile'], [/\bMARITIME POLAR\b/g, 'polaire maritime']
  ];
  var WORDS = {
    ACFT: 'aéronef', ACT: 'actif', AD: 'aérodrome', ADJ: 'adjacent', ADZ: 'prévenir', AFIS: 'AFIS', AGL: 'sol', ALT: 'altitude',
    ALTN: 'dégagement', AMDT: 'amendement', AMSL: 'au-dessus de la mer', APCH: 'approche', APN: 'aire de trafic', APP: 'approche',
    APPROACH: 'approche', APR: 'avril', ARP: 'point de référence aérodrome', ARR: 'arrivée', ATC: 'contrôle', ATZ: 'ATZ', AUG: 'août',
    AVBL: 'disponible', AVGAS: 'AVGAS', BCST: 'diffusion', BLDG: 'bâtiment', BLW: 'sous', ABV: 'au-dessus de', BRG: 'relèvement',
    BTN: 'entre', CAT: 'catégorie', CB: 'cumulonimbus', CLD: 'Nuages', CLSD: 'fermé', CNL: 'annulé', COORD: 'coordonnées',
    CRANE: 'grue', CRANES: 'grues', CTC: 'contacter', CTN: 'attention', DEC: 'décembre', DEG: '°', DEP: 'départ', DLY: 'chaque jour',
    DIST: 'distance', DUE: 'dû', DUR: 'pendant', E: 'est', EMBD: 'noyés', EQPT: 'équipement', ERECTED: 'érigé', EST: 'estimé',
    EXC: 'sauf', EXER: 'exercice', FCST: 'prévu', FEB: 'février', FIXED: 'fixe', FLT: 'vol', FLW: 'suivant', FM: 'de', FREQ: 'fréquence',
    FRI: 'vendredi', FRQ: 'fréquents', FZLVL: 'Isotherme 0 °C', GLD: 'planeurs', GND: 'sol', H24: 'jour et nuit', HEL: 'hélicoptère',
    HGT: 'hauteur', HJ: 'du lever au coucher du soleil', HN: 'du coucher au lever du soleil', HO: 'selon besoins', HR: 'heures',
    ICE: 'givrage', INCREASED: 'augmentés', INFO: 'information', INSTALLED: 'installé', INSTL: 'installé', INTSF: 'en intensification',
    ISOL: 'isolés', JAN: 'janvier', JUL: 'juillet', JUN: 'juin', LGT: 'balisage lumineux', LIGHTED: 'balisé', LOC: 'localement',
    LVL: 'niveau', MAR: 'mars', MAX: 'maxi', MAY: 'mai', MKD: 'balisé', MIL: 'militaire', MIN: 'minutes', MINIMA: 'minima',
    MNM: 'minimum', MNT: 'surveiller', MOD: 'modéré(e)', MON: 'lundi', MOV: 'se déplaçant vers le', N: 'nord', NC: 'sans changement',
    NE: 'nord-est', NIGHT: 'nuit', NIL: 'néant', NML: 'normal', NOV: 'novembre', NW: 'nord-ouest', OBS: 'observé', OBSC: 'masqué',
    OBST: 'obstacle', OCNL: 'occasionnels', OCT: 'octobre', OPR: 'exploitation', OPS: 'opérations', OTLK: 'Tendance', OVER: 'au-dessus de',
    PAX: 'passagers', PERM: 'permanent', PJE: 'parachutage', PPR: 'autorisation préalable requise', PROC: 'procédure',
    PROHIBITED: 'interdit', PSN: 'position', PSYS: 'Situation générale', RAD: 'rayon', RADIUS: 'rayon', RDO: 'radio', REF: 'référence',
    RMK: 'remarque', RQRD: 'requis', RTE: 'route', RWY: 'piste', S: 'sud', SAT: 'samedi', SE: 'sud-est', SECN: 'Section', SEP: 'septembre',
    SEV: 'fort(e)', SFC: 'surface', SKED: 'horaire', STNR: 'stationnaire', SUN: 'dimanche', SUP: 'supplément AIP', SW: 'sud-ouest',
    TEMPO: 'temporaire', THU: 'jeudi', TIL: 'jusqu’à', TO: 'à', TOP: 'sommet', TRA: 'zone réglementée temporaire', TUE: 'mardi',
    TURB: 'Turbulence', TWR: 'tour', TWY: 'taxiway', U: 'hors service', UFN: 'jusqu’à nouvel avis', UNL: 'illimité', VAL: 'vallées',
    VIS: 'visibilité', W: 'ouest', WED: 'mercredi', WEF: 'à partir du', WI: 'dans', WIP: 'travaux en cours', WKN: 'en affaiblissement',
    WRNG: 'avertissement', WS: 'cisaillement', MTW: 'ondes orographiques', ALL: 'tous', AND: 'et', OR: 'ou', FOR: 'pour', OF: 'de',
    ICAO: 'OACI', AT: 'à', ON: 'sur', IN: 'dans', BY: 'par', WITH: 'avec', FROM: 'depuis', TWO: 'deux', VALID: 'valable', BECMG: 'devenant',
    HIGH: 'haut', LOW: 'bas', NEW: 'nouveau', WORK: 'travaux', WORKS: 'travaux', MEN: 'personnel', EQUIPMENT: 'équipement',
    WORKING: 'travaillant', VEHICLE: 'véhicule', MARKINGS: 'marquages', MARKING: 'marquage', LIGHTING: 'balisage lumineux',
    LIGHTS: 'feux', SERVICE: 'service', CLOSED: 'fermé', AVAILABLE: 'disponible', TAXIWAY: 'taxiway', RUNWAY: 'piste', APRON: 'aire de trafic',
    REQUIRED: 'requis', FUEL: 'carburant', FUELING: 'avitaillement', LARGE: 'gros', ACTIVITY: 'activité', AREA: 'zone', ZONE: 'zone',
    TEMPORARY: 'temporaire', RESTRICTED: 'réglementée', DANGER: 'dangereuse', OPERATIONAL: 'opérationnel', HOURS: 'heures',
    ADVECTION: 'Advection', STABILIZING: 'stabilisante', BUILDING: 'se renforçant', APPROACHING: 'approchant', WEST: 'ouest',
    EAST: 'est', NORTH: 'nord', SOUTH: 'sud', NORTHERN: 'du nord', SEA: 'mer', AS: 'alors que', IS: 'est', A: 'un', AN: 'un',
    TO_: 'à', DRONE: 'drone', UAS: 'drone', BALLOON: 'ballon', LASER: 'laser', AIRSHOW: 'meeting aérien', DISPLAY: 'démonstration',
    BIRD: 'oiseaux', BIRDS: 'oiseaux', MIGRATION: 'migration', AWY: 'route aérienne', CTR: 'CTR', TMA: 'TMA', NON: 'non',
    STANDARD: 'standard', BARRIERS: 'barrières', SPOT: 'emplacement', LEAD: 'guidage', RETROREFLECTIVE: 'rétroréfléchissant',
    PROFILE: 'profil', LOCATED: 'situé', FEET: 'pieds', METERS: 'mètres', CENTERLINE: 'axe', FOLLOW: 'suivre', MARSHALLING: 'placement'
  };
  var CLOUDS = { CU: 'cumulus', SC: 'stratocumulus', ST: 'stratus', AC: 'altocumulus', AS: 'altostratus', NS: 'nimbostratus', TCU: 'cumulus bourgeonnants' };
  function textFr(raw) {
    var t = String(raw || '');
    if (!/[A-Z]{2,}/.test(t)) return null;
    PHRASES.forEach(function (p) { t = t.replace(p[0], p[1]); });
    t = t.replace(/\b(\d{2})(\d{2})(\d{2})\/(\d{2})(\d{2})(\d{2})\b/g, function (_, a, b, c, d, e, f) { return 'du ' + n(a) + ' à ' + b + ':' + c + ' au ' + n(d) + ' à ' + e + ':' + f + ' UTC'; })
      .replace(/\bFL\s?(\d{3})\b/g, 'FL $1')
      .replace(/\b(\d{3}|\d{3}-\d{3})\/(\d{2,3}(?:-\d{2,3})?)KT\b/g, '$1° $2 kt')
      .replace(/\b(\d+)\s?FT\b/g, '$1 ft').replace(/\b(\d+)\s?KT\b/g, '$1 kt').replace(/\b(\d+)\s?KM\b/g, '$1 km')
      .replace(/\b(\d+)\s?M\b/g, '$1 m').replace(/\b(\d+)\s?NM\b/g, '$1 NM').replace(/\b(\d{3,4})\s?HPA\b/g, '$1 hPa')
      .replace(/\bPS(\d{2})\b/g, function (_, x) { return '+' + n(x) + ' °C'; }).replace(/\bMS(\d{2})\b/g, function (_, x) { return '-' + n(x) + ' °C'; })
      .replace(/\b(\d{3})\s?DEG\b/g, '$1°').replace(/\bRWY\s?(\d{2}[LRC]?)\b/g, 'piste $1').replace(/\bTWY\s?([A-Z]\d*)\b/g, 'taxiway $1')
      .replace(/\bU\/S\b/g, 'hors service').replace(/\+(\d+)\s?km\b/g, 'plus de $1 km');
    t = t.replace(/\b[A-Z][A-Z]+\b|\b[NSEW]\b/g, function (w) {
      if (CLOUDS[w]) return CLOUDS[w];
      if (/^(FEW|SCT|BKN|OVC)$/.test(w)) return { FEW: 'peu', SCT: 'épars', BKN: 'fragmentés', OVC: 'couvert' }[w];
      var wx = weather(w); if (wx && w.length <= 8 && !WORDS[w]) return wx.toLowerCase();
      return WORDS[w] !== undefined ? WORDS[w] : w;
    });
    return t;
  }

  /* Choix du traducteur selon le message */
  function aeroFr(raw) {
    var s = String(raw || '').trim();
    if (/^(METAR|SPECI)\b/.test(s) || /^[A-Z]{4} \d{6}Z /.test(s) && !/\d{4}\/\d{4}/.test(s.split(' ').slice(0, 4).join(' '))) return metarFr(s);
    if (/^TAF\b/.test(s) || /^[A-Z]{4} \d{6}Z \d{4}\/\d{4}/.test(s)) return tafFr(s);
    return textFr(s);
  }

  /* Bascule un élément entre codé et français ; garde l'original. */
  function toggleEl(el, on) {
    if (el._metarFr === undefined) {
      var raw = (el.innerText || el.textContent || '').trim();
      var fr = aeroFr(raw);
      el._metarFr = (fr && fr !== raw) ? fr : null;
      el._metarRaw = el.innerHTML;
    }
    if (!el._metarFr) return false;
    var want = (on === undefined) ? !el.classList.contains('metar-fr-on') : on;
    if (want) {
      var esc = el._metarFr.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
      var parts = esc.split('\n');
      el.innerHTML = /^(Prévision TAF|[A-Z]{4} —)/.test(parts[0]) ? '<b>' + parts[0] + '</b><br>' + parts.slice(1).join('<br>') : parts.join('<br>');
      el.classList.add('metar-fr-on');
    } else {
      el.innerHTML = el._metarRaw;
      el.classList.remove('metar-fr-on');
    }
    return true;
  }

  /* Messages traduisibles d'un document : OPMET (METAR, TAF, SIGMET, GAMET, AIRMET), AéroWeb,
     Pays-Bas, NOTAM (.frn-txt), et tout élément marqué « aero-tr ». */
  function metarEls(doc) {
    var out = [];
    doc.querySelectorAll('.section .entry:not(.entry-notprov), .gamet-block, .aw-txt, .frn-txt, .aero-tr').forEach(function (e) { out.push(e); });
    return out;
  }

  function wire(doc) {
    if (doc._metarFrWired) return;
    doc._metarFrWired = true;
    var st = doc.createElement('style');
    st.textContent = '.metar-fr-on{font-family:system-ui,-apple-system,"Segoe UI",sans-serif!important;line-height:1.5;white-space:normal!important}'
      + '.metar-fr-click{cursor:pointer}.metar-fr-click:hover{outline:1px dashed rgba(102,126,234,.6);outline-offset:2px}';
    (doc.head || doc.body).appendChild(st);
    doc.addEventListener('click', function (ev) {
      var el = ev.target.closest && ev.target.closest('.metar-fr-click');
      if (el && !ev.target.closest('a,button,summary')) { ev.stopPropagation(); toggleEl(el); }
    }, true);
  }

  window.metarFr = metarFr;
  window.tafFr = tafFr;
  window.aeroTextFr = textFr;
  window.aeroFr = aeroFr;
  window.metarFrToggle = function (doc, on) {
    if (!doc) return 0;
    wire(doc);
    var k = 0;
    metarEls(doc).forEach(function (e) {
      e.classList.add('metar-fr-click');
      if (!e.title) e.title = 'Cliquer pour traduire en français / revenir au texte codé';
      if (on !== null && on !== undefined && toggleEl(e, on)) k++;
    });
    return k;
  };
})();
