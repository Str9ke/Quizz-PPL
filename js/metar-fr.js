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

  /* Bascule un élément entre codé et français ; garde l'original. */
  function toggleEl(el, on) {
    if (el._metarFr === undefined) {
      var raw = (el.textContent || '').trim();
      var fr = metarFr(raw);
      el._metarFr = fr || null;
      el._metarRaw = el.innerHTML;
    }
    if (!el._metarFr) return false;
    var want = (on === undefined) ? !el.classList.contains('metar-fr-on') : on;
    if (want) {
      var esc = el._metarFr.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
      var parts = esc.split('\n');
      el.innerHTML = '<b>' + parts[0] + '</b><br>' + parts.slice(1).join('<br>');
      el.classList.add('metar-fr-on');
    } else {
      el.innerHTML = el._metarRaw;
      el.classList.remove('metar-fr-on');
    }
    return true;
  }

  /* METAR d'un document : lignes .entry sous un en-tête « METAR » (opmet.html) ou .aw-txt
     précédées d'une étiquette METAR (liste AéroWeb). */
  function metarEls(doc) {
    var out = [];
    doc.querySelectorAll('.section').forEach(function (sec) {
      var h = sec.querySelector('.section-header');
      if (h && /^\W*METAR/i.test(h.textContent.trim())) sec.querySelectorAll('.entry').forEach(function (e) { out.push(e); });
    });
    doc.querySelectorAll('.aw-txt').forEach(function (e) {
      var lbl = e.previousElementSibling;
      if (lbl && /METAR|SPECI/i.test(lbl.textContent) || /^(METAR|SPECI) /.test(e.textContent.trim())) out.push(e);
    });
    return out;
  }

  function wire(doc) {
    if (doc._metarFrWired) return;
    doc._metarFrWired = true;
    var st = doc.createElement('style');
    st.textContent = '.metar-fr-on{font-family:system-ui,-apple-system,"Segoe UI",sans-serif!important;line-height:1.5;white-space:normal}'
      + '.metar-fr-click{cursor:pointer}.metar-fr-click:hover{outline:1px dashed rgba(102,126,234,.6);outline-offset:2px}';
    (doc.head || doc.body).appendChild(st);
    doc.addEventListener('click', function (ev) {
      var el = ev.target.closest && ev.target.closest('.metar-fr-click');
      if (el && !ev.target.closest('a,button')) toggleEl(el);
    });
  }

  window.metarFr = metarFr;
  window.metarFrToggle = function (doc, on) {
    if (!doc) return 0;
    wire(doc);
    var k = 0;
    metarEls(doc).forEach(function (e) { e.classList.add('metar-fr-click'); if (on !== null && toggleEl(e, on)) k++; });
    return k;
  };
})();
