/**
 * ============================================================================
 * Lecteur du manuel de vol FAA (livre.html)
 * ----------------------------------------------------------------------------
 * - Texte intégral dans livre/<id>/book.json (précaché par le service worker : lecture hors ligne
 *   complète). Pages originales (figures) dans livre/<id>/img/, mises en cache à la lecture ou en
 *   bloc via « Télécharger hors ligne ».
 * - Annotations (surlignages en 4 couleurs, notes), pages lues, temps de lecture : état LOCAL
 *   (localStorage) + synchronisation Firestore  quizProgress/{uid}/book/{c1…cN, meta}; livres suivants : {id}_c1…, {id}_meta.
 *
 * Synchronisation — conçue pour que deux appareils (et le hors ligne) ne s'écrasent jamais :
 *   - tout est un dictionnaire clé → valeur horodatée, fusionné « le plus récent gagne » PAR
 *     CLÉ (rd = page lue, hl = surlignage, gn = note de surlignage, nt = note de page) ;
 *   - le temps passé est stocké PAR APPAREIL (pt.{appareil}.{page} = secondes cumulées) puis
 *     additionné à l'affichage : jamais de conflit, aucun incrément à rejouer ;
 *   - tout est idempotent : on peut renvoyer le même contenu autant de fois que nécessaire ;
 *   - les clés modifiées localement sont mémorisées (« dirty ») jusqu'à l'accusé de réception de
 *     Firestore : hors ligne, elles partent au retour du réseau, même après fermeture de l'appli.
 * ============================================================================
 */
(function () {
  'use strict';

  var CACHE_IMG = 'quiz-ppl-assets-v1';        // même cache que sw.js (images de l'appli)
  var DEFAULT_SEC_PER_WORD = 0.25;             // 240 mots/min tant qu'on n'a pas mesuré le rythme
  var IDLE_MS = 60000;                         // pas d'interaction depuis 1 min → le temps ne compte plus
  /* Plusieurs livres : livre.html?b=afh (manuel de vol, défaut) ou ?b=phak (manuel du pilote).
     Données : livre/<id>/book.json ; images : livre/<id>/img/NNN.webp. Les documents Firestore
     du premier livre gardent leurs noms d'origine (c1…, meta) ; les autres sont préfixés. */
  var BOOK_ID = (new URLSearchParams(location.search).get('b') || 'afh').replace(/[^a-z0-9]/g, '') || 'afh';
  var DOCP = BOOK_ID === 'afh' ? '' : BOOK_ID + '_';
  var BASE = 'livre/' + BOOK_ID + '/';
  var REMOTE_BASE = 'https://str9ke.github.io/Quizz-PPL/';
  var REFCH = {}, CHMAP = {}, ORDER = [];
  var COLORS = { 1: 'Jaune', 2: 'Vert', 3: 'Rose', 4: 'Bleu' };

  var $root = document.getElementById('bk');
  var BOOK = null, PAGES = [], ALLWORDS = 0;
  var uid = null, S = null, dirty = {}, seq = 0, flushTimer = null, lastFlush = 0, inflight = 0;
  var unsub = null;
  var view = 'home', cur = null, lastAct = Date.now(), showOrig = !!jget('bk_orig', 1);
  var unitHtml = {}, annot = null, noteTarget = null, ticks = 0;

  var DEV = (function () {
    try {
      var d = localStorage.getItem('bkDevice');
      if (!d) { d = 'd' + Math.random().toString(36).slice(2, 8); localStorage.setItem('bkDevice', d); }
      return d;
    } catch (e) { return 'dx'; }
  })();

  /* ------------------------------------------------------------------ utilitaires */
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function pad3(n) { return String(n).padStart(3, '0'); }
  function chOf(ref) { return REFCH[ref] || parseInt(ref, 10) || 0; }
  function chap(n) { return CHMAP[n]; }
  function chLabel(c) { return c.label || ('Chapitre ' + c.n); }
  function now() { return Date.now(); }
  function newId() { return now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + ' s';
    var m = Math.round(sec / 60);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return h + ' h ' + (r < 10 ? '0' : '') + r;
  }
  function plain(html) {
    return String(html).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  }
  function jget(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage plein / indisponible */ } }

  /* ------------------------------------------------------------------ état local */
  function emptyState() { return { rd: {}, pt: {}, hl: {}, gn: {}, nt: {}, last: null }; }
  function lsKey(p) { return 'bk_' + DOCP + p + '_' + (uid || 'anon'); }
  function loadLocal() {
    S = jget(lsKey('state'), null) || emptyState();
    ['rd', 'pt', 'hl', 'gn', 'nt'].forEach(function (f) { if (!S[f]) S[f] = {}; });
    dirty = jget(lsKey('dirty'), {});
  }
  function saveLocal() { jset(lsKey('state'), S); jset(lsKey('dirty'), dirty); }

  function markDirty(ch, field, key) {
    dirty[ch] = dirty[ch] || {};
    dirty[ch][field] = dirty[ch][field] || {};
    dirty[ch][field][key] = ++seq;
    saveLocal();
    scheduleFlush(field === 'pt' ? 20000 : 1500);
    syncUI();
  }
  function markMeta() { dirty.meta = ++seq; saveLocal(); scheduleFlush(3000); }

  /* ------------------------------------------------------------------ lecture des données */
  function isRead(ref) { var r = S.rd[ref]; return !!(r && r[0] === 1); }
  function pageTime(ref) {
    var t = 0;
    for (var d in S.pt) { if (S.pt[d] && S.pt[d][ref]) t += S.pt[d][ref]; }
    return t;
  }
  function chapterStats(n) {
    var c = chap(n), read = 0, time = 0, wUnread = 0;
    c.pages.forEach(function (p) {
      time += pageTime(p.ref);
      if (isRead(p.ref)) read++; else wUnread += p.w;
    });
    return { read: read, total: c.pages.length, time: time, wUnread: wUnread };
  }
  /* Rythme personnel : temps réellement passé sur les pages lues ÷ mots de ces pages. */
  function pace() {
    var t = 0, w = 0, n = 0;
    PAGES.forEach(function (p) {
      if (!isRead(p.ref)) return;
      var pt = pageTime(p.ref);
      if (pt >= 8) { t += pt; w += p.w; n++; }
    });
    if (n >= 3 && w >= 600) return { spw: t / w, measured: true, pages: n };
    return { spw: DEFAULT_SEC_PER_WORD, measured: false, pages: n };
  }
  function globalStats() {
    var read = 0, time = 0, wUnread = 0;
    PAGES.forEach(function (p) {
      time += pageTime(p.ref);
      if (isRead(p.ref)) read++; else wUnread += p.w;
    });
    var pc = pace();
    return { read: read, total: PAGES.length, time: time, pace: pc, remaining: wUnread * pc.spw, totalEst: ALLWORDS * pc.spw };
  }

  /* ------------------------------------------------------------------ synchronisation */
  function docRef(id) { return db.collection('quizProgress').doc(uid).collection('book').doc(DOCP + id); }
  function dirtyCount() {
    var c = 0;
    Object.keys(dirty).forEach(function (k) {
      if (k === 'meta') { c++; return; }
      Object.keys(dirty[k]).forEach(function (f) { c += Object.keys(dirty[k][f]).length; });
    });
    return c;
  }
  function scheduleFlush(ms) {
    if (flushTimer) return;
    flushTimer = setTimeout(function () { flushTimer = null; flush(); }, ms);
  }
  function flush(force) {
    if (!uid || typeof db === 'undefined' || !dirtyCount()) { syncUI(); return; }
    if (!navigator.onLine) { syncUI(); return; }
    if (inflight > 0 && !force && now() - lastFlush < 30000) { syncUI(); return; }  // un envoi attend encore son accusé
    lastFlush = now();
    var sent = JSON.parse(JSON.stringify(dirty));
    Object.keys(sent).forEach(function (k) {
      var patch, ref;
      if (k === 'meta') {
        if (!S.last) return;
        patch = { last: S.last }; ref = docRef('meta');
      } else {
        var d = sent[k]; patch = {}; var any = false;
        ['rd', 'hl', 'gn', 'nt'].forEach(function (f) {
          if (!d[f]) return;
          patch[f] = {};
          Object.keys(d[f]).forEach(function (key) { if (S[f][key] !== undefined) { patch[f][key] = S[f][key]; any = true; } });
        });
        if (d.pt) {
          patch.pt = {}; patch.pt[DEV] = {};
          Object.keys(d.pt).forEach(function (r) { patch.pt[DEV][r] = (S.pt[DEV] || {})[r] || 0; any = true; });
        }
        if (!any) return;
        ref = docRef('c' + k);
      }
      inflight++;
      ref.set(patch, { merge: true }).then(function () {
        inflight = Math.max(0, inflight - 1);
        // accusé reçu : on n'oublie que ce qui n'a pas été modifié depuis l'envoi
        if (k === 'meta') { if (dirty.meta === sent.meta) delete dirty.meta; }
        else if (dirty[k]) {
          Object.keys(sent[k]).forEach(function (f) {
            Object.keys(sent[k][f]).forEach(function (key) {
              if (dirty[k][f] && dirty[k][f][key] === sent[k][f][key]) delete dirty[k][f][key];
            });
            if (dirty[k][f] && !Object.keys(dirty[k][f]).length) delete dirty[k][f];
          });
          if (!Object.keys(dirty[k]).length) delete dirty[k];
        }
        saveLocal(); syncUI();
      }).catch(function (e) {
        inflight = Math.max(0, inflight - 1);
        console.warn('[livre] synchronisation différée :', e && e.code);
        syncUI();
      });
    });
    syncUI();
  }

  function tsOf(f, v) { return f === 'hl' ? (v && v.ts) || 0 : (v && v[1]) || 0; }
  function mergeRemote(id, data) {
    if (!data) return;
    if (id === 'meta') {
      if (data.last && (!S.last || data.last.ts > S.last.ts)) S.last = data.last;
      return;
    }
    ['rd', 'hl', 'gn', 'nt'].forEach(function (f) {
      var r = data[f]; if (!r) return;
      Object.keys(r).forEach(function (key) {
        var l = S[f][key];
        if (!l || tsOf(f, r[key]) > tsOf(f, l)) S[f][key] = r[key];
      });
    });
    if (data.pt) {
      Object.keys(data.pt).forEach(function (dev) {
        if (dev === DEV) {
          S.pt[DEV] = S.pt[DEV] || {};
          Object.keys(data.pt[dev]).forEach(function (r) { S.pt[DEV][r] = Math.max(S.pt[DEV][r] || 0, data.pt[dev][r] || 0); });
        } else S.pt[dev] = data.pt[dev];
      });
    }
  }
  function startListener() {
    if (unsub) { try { unsub(); } catch (e) { /* ignore */ } unsub = null; }
    if (!uid || typeof db === 'undefined') return;
    try {
      unsub = db.collection('quizProgress').doc(uid).collection('book').onSnapshot(function (qs) {
        var changed = false;
        qs.docChanges().forEach(function (ch) {
          var id = ch.doc.id;                                    // c12, meta (livre 1) ou phak_c12, phak_meta…
          if (DOCP ? id.indexOf(DOCP) !== 0 : !/^(c\d+|meta)$/.test(id)) return;
          mergeRemote(id.slice(DOCP.length), ch.doc.data()); changed = true;
        });
        if (changed) { saveLocal(); onRemote(); }
        syncUI();
      }, function (err) { console.warn('[livre] écoute Firestore :', err && err.code); });
    } catch (e) { console.warn('[livre] écoute impossible', e); }
  }
  function syncUI() {
    var el = document.getElementById('bkSync'); if (!el) return;
    var n = dirtyCount(), txt, cls = '';
    if (!uid) txt = '👤 Non connecté — enregistré sur cet appareil';
    else if (n) { txt = navigator.onLine ? '⏳ Envoi en cours…' : '📴 Hors ligne — ' + n + ' modification' + (n > 1 ? 's' : '') + ' à envoyer'; cls = 'wait'; }
    else { txt = '☁️ Synchronisé'; cls = 'ok'; }
    el.textContent = txt; el.className = 'bk-sync ' + cls;
  }

  function setUid(u) {
    if (u === uid) return;
    var wasAnon = (uid === null);
    var anon = wasAnon ? S : null;
    uid = u;
    loadLocal();
    if (wasAnon && anon && u) {   // données prises hors compte : on les adopte et on les envoie
      ['rd', 'hl', 'gn', 'nt'].forEach(function (f) {
        Object.keys(anon[f]).forEach(function (key) {
          if (!S[f][key]) { S[f][key] = anon[f][key]; var ref = f === 'hl' ? anon[f][key].pg : (f === 'gn' ? anon[f][key][2] : key); if (ref) markDirty(chOf(ref), f, key); }
        });
      });
      Object.keys(anon.pt).forEach(function (dev) {
        if (dev !== DEV) return;
        S.pt[DEV] = S.pt[DEV] || {};
        Object.keys(anon.pt[dev]).forEach(function (r) { S.pt[DEV][r] = Math.max(S.pt[DEV][r] || 0, anon.pt[dev][r]); markDirty(chOf(r), 'pt', r); });
      });
    }
    startListener();
    if (BOOK) { if (view === 'home') renderHome(); else onRemote(); }
    flush();
  }
  function initAuth() {
    var cached = null;
    try { cached = localStorage.getItem('cachedUid'); } catch (e) { /* ignore */ }
    var decided = false;
    function decide(u) { if (decided && u === uid) return; decided = true; setUid(u); }
    if (cached) decide(cached);              // démarrage immédiat, même hors ligne
    if (typeof auth !== 'undefined' && auth) {
      auth.onAuthStateChanged(function (user) {
        if (user) { try { localStorage.setItem('cachedUid', user.uid); } catch (e) { /* ignore */ } decide(user.uid); }
        else if (!cached) decide(null);
      });
    }
    setTimeout(function () { if (!decided) decide(null); }, 4000);
  }

  /* ------------------------------------------------------------------ actions sur l'état */
  function setRead(ref, v) {
    var cur0 = isRead(ref);
    if (cur0 === v && S.rd[ref]) return;
    S.rd[ref] = [v ? 1 : 0, now()];
    markDirty(chOf(ref), 'rd', ref);
  }
  function addTime(ref, sec) {
    S.pt[DEV] = S.pt[DEV] || {};
    S.pt[DEV][ref] = (S.pt[DEV][ref] || 0) + sec;
    dirty[chOf(ref)] = dirty[chOf(ref)] || {};
    dirty[chOf(ref)].pt = dirty[chOf(ref)].pt || {};
    dirty[chOf(ref)].pt[ref] = ++seq;
    scheduleFlush(20000);
  }
  function setLast(ref) {
    if (S.last && S.last.ref === ref && now() - S.last.ts < 30000) return;
    S.last = { ref: ref, ts: now(), dev: DEV };
    markMeta();
  }

  /* ------------------------------------------------------------------ page d'accueil */
  function renderHome() {
    view = 'home'; cur = null; annotHide();
    var g = globalStats();
    var pct = g.total ? Math.round(100 * g.read / g.total) : 0;
    var last = S.last && findPage(S.last.ref);
    var h = '<div class="bk-cover-row"><img class="bk-cover" src="' + BASE + 'cover.webp" alt="" onerror="this.remove()"><div class="bk-grow">'
      + '<p class="bk-eyebrow">' + esc(BOOK.eyebrow || '') + '</p>'
      + '<div class="bk-top"><h1>' + esc(BOOK.title) + '</h1><span class="bk-sync" id="bkSync"></span></div></div></div>'
      + '<p class="bk-sub">Traduction page par page : termes clés surlignés, résumé de chaque page, fiche de chapitre, page originale à côté. Surligne et annote : tout est enregistré en ligne et retrouvé sur tous tes appareils.</p>'
      + (BOOK.pending && BOOK.pending.length ? '<div class="bk-card" style="margin-bottom:12px;border-color:#ffb74d"><b>🛠 Traduction en cours</b><p class="bk-note-small" style="margin:4px 0 0">Les chapitres suivants arrivent au fil des mises à jour : ' + esc(BOOK.pending.join(', ')) + '. Tu peux déjà lire les autres ; ta progression est conservée.</p></div>' : '')
      + '<div class="bk-card"><div class="bk-row"><b>Ma progression</b><span class="bk-grow"></span>'
      + (last ? '<button class="bk-btn primary" data-act="resume">▶ Reprendre — ' + esc(last.c.title) + ', p. ' + esc(last.p.ref) + '</button>'
              : '<button class="bk-btn primary" data-act="open" data-n="' + ORDER[0] + '" data-pi="0">▶ Commencer la lecture</button>') + '</div>'
      + '<div class="bk-bar big" style="margin-top:10px"><i style="width:' + pct + '%"></i></div>'
      + '<div class="bk-stats">'
      + stat(g.read + ' / ' + g.total, 'pages lues (' + pct + ' %)')
      + stat(fmtDur(g.time), 'temps de lecture passé')
      + stat(fmtDur(g.remaining), 'reste à lire, à ton rythme')
      + stat(fmtDur(g.totalEst), 'durée totale estimée du livre')
      + '</div><p class="bk-note-small">'
      + (g.pace.measured ? 'Ton rythme : ' + Math.round(60 / g.pace.spw) + ' mots/minute (mesuré sur ' + g.pace.pages + ' pages lues).'
                         : 'Estimation à 240 mots/minute pour l’instant ; elle s’ajustera à ton rythme dès quelques pages lues.')
      + ' Une page compte comme lue quand tu cliques sur « Suivante » (ou en la cochant).</p></div>'
      + '<div class="bk-row" style="margin-top:12px"><input class="bk-search" id="bkSearch" type="search" placeholder="Rechercher dans tout le livre…" style="flex:1;min-width:200px">'
      + '<button class="bk-btn" data-act="annots">📝 Mes annotations</button></div><div class="bk-results" id="bkResults"></div>'
      + '<div class="bk-card" style="margin-top:12px"><div class="bk-row"><div class="bk-grow"><b>Hors ligne</b><div class="bk-note-small" id="bkOffInfo" style="margin:2px 0 0">✅ Texte intégral disponible sans connexion.</div></div>'
      + '<button class="bk-btn" data-act="dlall" id="bkDl">⬇ Télécharger les pages originales</button></div></div>';
    (BOOK.groups || []).forEach(function (gr) {
      var cs = BOOK.chapters.filter(function (c) { return c.group === gr.name; });
      if (!cs.length) return;
      h += '<h2 class="bk-group">' + esc(gr.name) + '</h2><p class="bk-group-sub">' + esc(gr.sub) + '</p><div class="bk-grid">';
      cs.forEach(function (c) {
        var st = chapterStats(c.n), p = Math.round(100 * st.read / (st.total || 1)), rest = st.wUnread * g.pace.spw;
        h += '<button class="bk-card bk-ch" data-act="open" data-n="' + c.n + '" data-pi="' + firstUnread(c) + '">'
          + '<span class="num">' + esc(chLabel(c)) + ' · ' + st.total + ' p.</span><span class="t">' + esc(c.title) + '</span>'
          + '<div class="bk-bar"><i style="width:' + p + '%"></i></div>'
          + '<span class="m"><span>' + st.read + '/' + st.total + ' pages' + (st.time ? ' · ' + fmtDur(st.time) : '') + '</span><span>'
          + (st.read === st.total ? '✓ terminé' : 'reste ≈ ' + fmtDur(rest)) + '</span></span></button>';
      });
      h += '</div>';
    });
    h += '<p class="bk-note-small" style="margin-top:22px">' + (BOOK.footer || 'Traduction non officielle, faite pour étudier.') + '</p>';
    $root.innerHTML = h;
    syncUI(); offInfo();
    var inp = document.getElementById('bkSearch'), t;
    inp.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { search(inp.value); }, 200); });
  }
  function stat(b, s) { return '<div class="bk-stat"><b>' + esc(b) + '</b><span>' + esc(s) + '</span></div>'; }
  function findPage(ref) {
    for (var i = 0; i < PAGES.length; i++) if (PAGES[i].ref === ref) return { c: chap(PAGES[i].n), p: PAGES[i], pi: PAGES[i].pi };
    return null;
  }
  function firstUnread(c) {
    for (var i = 0; i < c.pages.length; i++) if (!isRead(c.pages[i].ref)) return i;
    return 0;
  }

  /* recherche plein texte */
  var INDEX = null;
  function search(q) {
    var out = document.getElementById('bkResults'); if (!out) return;
    q = q.trim().toLowerCase();
    if (q.length < 3) { out.innerHTML = ''; return; }
    if (!INDEX) {
      INDEX = [];
      BOOK.chapters.forEach(function (c) {
        c.pages.forEach(function (p, pi) {
          var t = p.blocks.map(function (b) { return plain(b.h || b.h3 || b.p || (b.ul || b.ol || []).join(' ') || b.fig || ''); }).join(' ¶ ');
          INDEX.push({ n: c.n, pi: pi, ref: p.ref, t: t, l: t.toLowerCase() });
        });
      });
    }
    var res = [];
    for (var i = 0; i < INDEX.length && res.length < 40; i++) {
      var k = INDEX[i].l.indexOf(q);
      if (k >= 0) res.push({ e: INDEX[i], k: k });
    }
    out.innerHTML = res.length ? res.map(function (r) {
      var t = r.e.t, a = Math.max(0, r.k - 50), b = Math.min(t.length, r.k + q.length + 70);
      var sn = esc(t.slice(a, r.k)) + '<mark>' + esc(t.slice(r.k, r.k + q.length)) + '</mark>' + esc(t.slice(r.k + q.length, b));
      return '<button class="bk-res" data-act="open" data-n="' + r.e.n + '" data-pi="' + r.e.pi + '"><small>' + esc(chap(r.e.n).title) + ' · p. ' + esc(r.e.ref) + '</small>'
        + (a > 0 ? '…' : '') + sn + (b < t.length ? '…' : '') + '</button>';
    }).join('') : '<p class="bk-note-small">Aucun résultat.</p>';
  }

  /* hors ligne : pages originales */
  function figUrl(f) { return BASE + 'fig/' + f; }      // figures découpées : embarquées dans l'APK, donc toujours en relatif
  function allFigs() {
    var out = [], seen = {};
    BOOK.chapters.forEach(function (c) { c.pages.forEach(function (p) { p.blocks.forEach(function (b) {
      (b.imgs || []).forEach(function (im) { if (!seen[im.f]) { seen[im.f] = 1; out.push(figUrl(im.f)); } });
    }); }); });
    return out;
  }
  function imgUrl(p) { return (window.APP_IS_NATIVE ? REMOTE_BASE : '') + BASE + 'img/' + pad3(p.pdf) + '.webp'; }
  function cachedImgCount() {
    if (!window.caches) return Promise.resolve(-1);
    return caches.open(CACHE_IMG).then(function (c) { return c.keys(); }).then(function (ks) {
      return ks.filter(function (r) { return r.url.indexOf('/' + BASE + 'img/') >= 0 || r.url.indexOf('/' + BASE + 'fig/') >= 0; }).length;
    }).catch(function () { return -1; });
  }
  function offInfo() {
    cachedImgCount().then(function (n) {
      var el = document.getElementById('bkOffInfo'), b = document.getElementById('bkDl');
      if (!el) return;
      var tot = PAGES.length + allFigs().length;
      if (n < 0) { el.textContent = '✅ Texte intégral disponible sans connexion. (Pages originales : stockage hors ligne indisponible sur ce navigateur.)'; if (b) b.hidden = true; return; }
      el.textContent = '✅ Texte intégral disponible sans connexion · pages originales et figures : ' + Math.min(n, tot) + ' / ' + tot + ' en mémoire' + (n >= tot ? ' — tout est prêt pour le vol.' : '.');
      if (b) { b.hidden = n >= tot; b.disabled = false; }
    });
  }
  function downloadAll() {
    var b = document.getElementById('bkDl'), el = document.getElementById('bkOffInfo');
    if (!window.caches) return;
    if (!navigator.onLine) { el.textContent = '📴 Connexion nécessaire pour télécharger les pages originales.'; return; }
    b.disabled = true;
    var urls = PAGES.map(imgUrl).concat(allFigs()), done = 0, fail = 0, i = 0;
    caches.open(CACHE_IMG).then(function (cache) {
      function next() {
        if (i >= urls.length) return Promise.resolve();
        var u = urls[i++], abs = new URL(u, location.href).href;
        return cache.match(abs).then(function (hit) {
          if (hit) return;
          return fetch(abs).then(function (r) { if (!r.ok) throw new Error(r.status); return cache.put(abs, r); });
        }).catch(function () { fail++; }).then(function () {
          done++;
          if (el && done % 5 === 0) el.textContent = '⬇ Téléchargement… ' + done + ' / ' + urls.length;
          return next();
        });
      }
      return Promise.all([next(), next(), next(), next()]);
    }).then(function () {
      if (el) el.textContent = fail ? '⚠️ ' + fail + ' page(s) n’ont pas pu être téléchargées — réessaie.' : '✅ Tout est téléchargé.';
      offInfo();
    });
  }

  /* ------------------------------------------------------------------ vue chapitre */
  function openChapter(n, pi, push) {
    var c = chap(n); if (!c) return renderHome();
    pi = Math.max(0, Math.min(c.pages.length - 1, pi || 0));
    view = 'chapter'; cur = { n: n, pi: pi, ref: c.pages[pi].ref };
    annotHide();
    var h = '<div class="bk-top"><button class="bk-btn" data-act="home">← Sommaire</button><span class="bk-sync" id="bkSync"></span></div>'
      + '<div class="bk-chhead"><p class="bk-eyebrow">' + esc(chLabel(c)) + '</p><h1>' + esc(c.title) + '</h1>'
      + '<p class="bk-sub">' + (c.intro || '') + '</p>'
      + '<div class="bk-bar big"><i id="bkChBar" style="width:0"></i></div><p class="bk-note-small" id="bkChInfo"></p></div>'
      + '<div class="bk-row"><label class="bk-btn" style="display:inline-flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="bkKey" ' + (jget('bk_key', 1) ? 'checked' : '') + '> Termes clés</label>'
      + '<button class="bk-btn" data-act="chsheet">Fiche du chapitre</button>'
      + '<button class="bk-btn" data-act="chread">✓ Tout marquer comme lu</button>'
      + '<button class="bk-btn" data-act="chunread">↺ Tout marquer non lu</button></div>'
      + '<nav class="bk-pills" id="bkPills" aria-label="Pages du chapitre"></nav>'
      + '<div class="bk-stage" id="bkStage"><article class="bk-page" id="bkPage"></article>'
      + '<aside class="bk-orig" id="bkOrig" hidden><div class="bk-row"><div class="bk-orig-cap bk-grow" id="bkOrigCap"></div><button class="bk-btn" data-act="zoom">🔍 Zoomer</button></div>'
      + '<img id="bkOrigImg" alt="Page originale en anglais" data-act="zoom"></aside></div>';
    $root.innerHTML = h;
    document.getElementById('bkKey').addEventListener('change', function (e) {
      document.getElementById('bkPage').classList.toggle('nokey', !e.target.checked); jset('bk_key', e.target.checked ? 1 : 0);
    });
    showPage(pi, push !== false);
  }

  function showPage(pi, push) {
    var c = chap(cur.n), p = c.pages[pi]; cur.pi = pi; cur.ref = p.ref; unitHtml = {};
    var art = document.getElementById('bkPage');
    art.classList.toggle('nokey', !document.getElementById('bkKey').checked);
    var body = '', bi = 0;
    p.blocks.forEach(function (b, i) {
      if (b.h) body += '<h2 data-u="b' + i + '">' + reg('b' + i, b.h) + '</h2>';
      else if (b.h3) body += '<h3 data-u="b' + i + '">' + reg('b' + i, b.h3) + '</h3>';
      else if (b.p) body += '<p data-u="b' + i + '">' + reg('b' + i, b.p) + '</p>';
      else if (b.ul || b.ol) {
        var tag = b.ul ? 'ul' : 'ol', items = b.ul || b.ol;
        body += '<' + tag + '>' + items.map(function (x, j) { return '<li data-u="b' + i + '.' + j + '">' + reg('b' + i + '.' + j, x) + '</li>'; }).join('') + '</' + tag + '>';
      } else if (b.imgs) {
        // figure découpée dans le livre : insérée telle quelle (texte de l'image non traduit), en grand
        body += '<figure class="bk-fig bk-figimg" style="display:block;padding:0;border:0;max-width:none;margin:20px 0">' + b.imgs.map(function (im) {
          return '<img src="' + figUrl(im.f) + '" width="' + im.w + '" height="' + im.h + '" style="display:block;width:100%;max-width:' + im.w + 'px;height:auto" loading="lazy" alt="' + esc(plain(b.fig) || 'Figure') + '" data-act="figzoom" data-src="' + figUrl(im.f) + '">';
        }).join('') + (b.fig ? '<figcaption>' + b.fig + '</figcaption>' : '') + '</figure>';
      } else if (b.same) body += '<div class="bk-fig bk-figsame"><span>' + b.fig + ' <em>(même figure que ci-dessus)</em></span></div>';
      else if (b.fig !== undefined) body += '<div class="bk-fig"><span>' + b.fig + '</span><button class="bk-btn" data-act="orig">Voir la figure</button></div>';
    });
    function reg(u, html) { unitHtml[u] = html; return html; }
    var note = S.nt[p.ref] ? S.nt[p.ref][0] : '';
    art.innerHTML = '<div class="bk-pagehead"><b>Page ' + esc(p.ref) + '</b><span>' + (pi + 1) + ' sur ' + c.pages.length + ' · PDF p. ' + p.pdf + '</span></div>' + body
      + '<div class="bk-foot" id="bkFoot"><button class="bk-btn primary" data-act="sum">Résumé de la page</button>'
      + '<button class="bk-btn' + (showOrig ? ' on' : '') + '" data-act="orig">Page originale</button>'
      + '<button class="bk-btn" data-act="toggleread" id="bkReadBtn"></button><span class="bk-grow"></span>'
      + '<button class="bk-btn" data-act="prev"' + (pi === 0 && cur.n === ORDER[0] ? ' disabled' : '') + '>← Précédente</button>'
      + '<button class="bk-btn" data-act="next"' + (pi === c.pages.length - 1 && cur.n === ORDER[ORDER.length - 1] ? ' disabled' : '') + '>Suivante →</button></div>'
      + '<textarea class="bk-pnote" id="bkPNote" placeholder="Ma note sur cette page…">' + esc(note) + '</textarea>';
    document.getElementById('bkPNote').addEventListener('input', function (e) {
      var v = e.target.value, ref = cur.ref;
      clearTimeout(e.target._t);
      e.target._t = setTimeout(function () { S.nt[ref] = [v, now()]; markDirty(chOf(ref), 'nt', ref); }, 600);
    });
    applyHighlights(); cur.sig = pageSig();
    renderPills(); updateReadBtn(); updateChapterHead(); updateOrig();
    setLast(p.ref);
    try { history[push ? 'pushState' : 'replaceState'](null, '', '#c' + cur.n + '/' + pi); } catch (e) { /* ignore */ }
    if (resumeY != null && resumeRef === p.ref) restoreScroll(resumeY);
    else { if (push !== 'keep') window.scrollTo(0, 0); savePos(); }
    resumeY = null; resumeRef = null;
  }

  /* ------------------------------------------------------------------ reprise à l'endroit exact */
  /* Page + position de défilement mémorisées PAR LIVRE sur cet appareil ; à la réouverture du
     livre on retombe exactement là où on s'était arrêté (la page lue-ou-non n'y est pour rien). */
  var POS_KEY = 'bk_pos_' + BOOK_ID, resumeY = null, resumeRef = null, posTimer = null;
  function savePos() {
    if (view !== 'chapter' || !cur) return;
    jset(POS_KEY, { ref: cur.ref, y: Math.round(window.scrollY || 0), ts: now() });
  }
  function restoreScroll(y) {
    // le contenu (figures, notes) peut finir de se mettre en page après coup : on réessaie
    var tries = 0;
    (function apply() {
      window.scrollTo(0, y);
      if (++tries < 6 && Math.abs((window.scrollY || 0) - y) > 4) setTimeout(apply, 150);
    })();
  }
  window.addEventListener('scroll', function () { clearTimeout(posTimer); posTimer = setTimeout(savePos, 350); }, { passive: true });

  function renderPills() {
    var c = chap(cur.n), el = document.getElementById('bkPills'); if (!el) return;
    el.innerHTML = c.pages.map(function (p, i) {
      return '<button class="bk-pill' + (isRead(p.ref) ? ' read' : '') + '" data-act="goto" data-pi="' + i + '"' + (i === cur.pi ? ' aria-current="page"' : '') + '>' + esc(p.ref) + '</button>';
    }).join('');
    var a = el.querySelector('[aria-current]'); if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  function updateReadBtn() {
    var b = document.getElementById('bkReadBtn'); if (!b || !cur) return;
    b.textContent = isRead(cur.ref) ? '✓ Page lue' : '○ Marquer comme lue';
    b.classList.toggle('on', isRead(cur.ref));
  }
  function updateChapterHead() {
    if (view !== 'chapter' || !cur) return;
    var st = chapterStats(cur.n), pc = pace().spw;
    var bar = document.getElementById('bkChBar'), info = document.getElementById('bkChInfo');
    if (bar) bar.style.width = Math.round(100 * st.read / st.total) + '%';
    if (info) info.textContent = st.read + ' / ' + st.total + ' pages lues · ' + fmtDur(st.time) + ' passées sur ce chapitre · '
      + (st.read === st.total ? 'chapitre terminé ✓' : 'reste ≈ ' + fmtDur(st.wUnread * pc));
  }
  function updateOrig() {
    var o = document.getElementById('bkOrig'); if (!o) return;
    var p = chap(cur.n).pages[cur.pi];
    o.hidden = !showOrig;
    document.querySelectorAll('.bk-foot [data-act=orig]').forEach(function (x) { x.classList.toggle('on', showOrig); });
    if (showOrig) {
      document.getElementById('bkOrigImg').src = imgUrl(p);
      document.getElementById('bkOrigCap').textContent = 'Page originale ' + p.ref + ' (anglais)';
    }
  }

  /* Visionneuse plein écran de la page originale : pincer / molette pour zoomer, glisser pour
     se déplacer, double toucher pour alterner 1× / 3×. */
  var zv = { open: false, x: 0, y: 0, k: 1, pts: {}, d0: 0, k0: 1, drag: null };
  function zvApply() {
    var img = document.getElementById('bkZImg'); if (!img) return;
    zv.k = Math.max(1, Math.min(8, zv.k));
    if (zv.k === 1) { zv.x = 0; zv.y = 0; }
    img.style.transform = 'translate(' + zv.x + 'px,' + zv.y + 'px) scale(' + zv.k + ')';
  }
  function zoomAt(cx, cy, nk) {
    var box = document.getElementById('bkZ').getBoundingClientRect();
    var px = cx - box.left - box.width / 2, py = cy - box.top - box.height / 2;
    nk = Math.max(1, Math.min(8, nk));
    zv.x = px - (px - zv.x) * nk / zv.k; zv.y = py - (py - zv.y) * nk / zv.k; zv.k = nk; zvApply();
  }
  function openZoom(src, cap) {
    var p = chap(cur.n).pages[cur.pi], z = document.getElementById('bkZ');
    document.getElementById('bkZImg').src = src || imgUrl(p);
    document.getElementById('bkZCap').textContent = (cap || 'Page ' + p.ref) + ' — pince ou molette pour zoomer, glisse pour te déplacer';
    zv.x = zv.y = 0; zv.k = 1; zvApply(); z.hidden = false; zv.open = true;
  }
  function closeZoom() { var z = document.getElementById('bkZ'); if (z) z.hidden = true; zv.open = false; }
  (function initZoom() {
    var z = document.getElementById('bkZ'), st = document.getElementById('bkZStage'), last = 0;
    document.getElementById('bkZClose').addEventListener('click', closeZoom);
    document.getElementById('bkZIn').addEventListener('click', function () { var r = st.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, zv.k * 1.6); });
    document.getElementById('bkZOut').addEventListener('click', function () { var r = st.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, zv.k / 1.6); });
    document.getElementById('bkZReset').addEventListener('click', function () { zv.k = 1; zvApply(); });
    st.addEventListener('wheel', function (e) { e.preventDefault(); zoomAt(e.clientX, e.clientY, zv.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2)); }, { passive: false });
    st.addEventListener('pointerdown', function (e) {
      st.setPointerCapture(e.pointerId); zv.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(zv.pts);
      if (ids.length === 2) { var a = zv.pts[ids[0]], b = zv.pts[ids[1]]; zv.d0 = Math.hypot(a.x - b.x, a.y - b.y); zv.k0 = zv.k; zv.drag = null; }
      else { zv.drag = { x: e.clientX, y: e.clientY, ox: zv.x, oy: zv.y }; if (now() - last < 320) { zoomAt(e.clientX, e.clientY, zv.k > 1.5 ? 1 : 3); zv.drag = null; } last = now(); }
    });
    st.addEventListener('pointermove', function (e) {
      if (!zv.pts[e.pointerId]) return; zv.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(zv.pts);
      if (ids.length === 2 && zv.d0) {
        var a = zv.pts[ids[0]], b = zv.pts[ids[1]];
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, zv.k0 * Math.hypot(a.x - b.x, a.y - b.y) / zv.d0);
      } else if (zv.drag && zv.k > 1) { zv.x = zv.drag.ox + e.clientX - zv.drag.x; zv.y = zv.drag.oy + e.clientY - zv.drag.y; zvApply(); }
    });
    function up(e) { delete zv.pts[e.pointerId]; zv.d0 = 0; if (!Object.keys(zv.pts).length) zv.drag = null; }
    st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && zv.open) closeZoom(); });
  })();
  function go(delta) {
    var n = cur.n, pi = cur.pi + delta;
    var oi = ORDER.indexOf(n);
    if (pi < 0) { if (oi <= 0) return; n = ORDER[oi - 1]; openChapter(n, chap(n).pages.length - 1, true); return; }
    if (delta > 0 && !isRead(cur.ref)) { setRead(cur.ref, true); if (typeof window._toast === 'function') window._toast('✓ Page ' + cur.ref + ' lue', 'success', 1200); }
    if (pi >= chap(n).pages.length) { if (oi >= ORDER.length - 1) return; openChapter(ORDER[oi + 1], 0, true); return; }
    showPage(pi, true);
  }

  /* ------------------------------------------------------------------ surlignages */
  /* Empreinte des surlignages / notes de la page affichée : détecte un changement venu d'ailleurs */
  function pageSig() {
    return JSON.stringify(pageHls(cur.ref).map(function (x) { return [x.id, x.h.c, x.h.ts]; }))
      + JSON.stringify(Object.keys(S.gn).map(function (k) { return S.gn[k][1]; }));
  }
  function pageHls(ref) {
    var out = [];
    for (var id in S.hl) { var h = S.hl[id]; if (h && h.pg === ref && !h.x) out.push({ id: id, h: h }); }
    return out.sort(function (a, b) { return a.h.ts - b.h.ts; });
  }
  function wrap(root, s, e, cls, g) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), pos = 0, n, list = [];
    while ((n = walker.nextNode())) {
      var len = n.nodeValue.length;
      if (pos + len > s && pos < e) list.push([n, Math.max(s - pos, 0), Math.min(e - pos, len)]);
      pos += len; if (pos >= e) break;
    }
    list.forEach(function (x) {
      var t = x[0];
      if (x[2] < t.nodeValue.length) t.splitText(x[2]);
      var mid = x[1] > 0 ? t.splitText(x[1]) : t;
      var sp = document.createElement('span'); sp.className = cls; sp.setAttribute('data-g', g);
      mid.parentNode.insertBefore(sp, mid); sp.appendChild(mid);
    });
  }
  function applyHighlights() {
    var art = document.getElementById('bkPage'); if (!art || !cur) return;
    cur.sig = pageSig();
    var by = {};
    pageHls(cur.ref).forEach(function (x) { (by[x.h.u] = by[x.h.u] || []).push(x.h); });
    art.querySelectorAll('[data-u]').forEach(function (el) {
      var u = el.getAttribute('data-u'); el.innerHTML = unitHtml[u];
      (by[u] || []).forEach(function (h) {
        var t = el.textContent, s = h.s, e = h.e;
        if (h.q && t.substr(s, h.q.length) !== h.q) {            // texte décalé : on ré-ancre par la citation
          var k = t.indexOf(h.q); if (k < 0) return; s = k; e = k + h.q.length;
        }
        var hasNote = S.gn[h.g] && S.gn[h.g][0];
        wrap(el, s, Math.min(e, t.length), 'uh c' + h.c + (hasNote ? ' has-note' : ''), h.g);
      });
    });
  }
  function offsetIn(el, node, off) {
    var r = document.createRange(); r.selectNodeContents(el); r.setEnd(node, off); return r.toString().length;
  }
  function selectionSegments() {
    var sel = window.getSelection(), art = document.getElementById('bkPage');
    if (!sel || !sel.rangeCount || sel.isCollapsed || !art) return null;
    var r = sel.getRangeAt(0);
    if (!art.contains(r.commonAncestorContainer)) return null;
    var segs = [];
    art.querySelectorAll('[data-u]').forEach(function (el) {
      if (!r.intersectsNode(el)) return;
      var len = el.textContent.length, s = 0, e = len;
      if (el.contains(r.startContainer)) s = offsetIn(el, r.startContainer, r.startOffset);
      if (el.contains(r.endContainer)) e = offsetIn(el, r.endContainer, r.endOffset);
      if (e - s < 1) return;
      segs.push({ u: el.getAttribute('data-u'), s: s, e: e, q: el.textContent.slice(s, Math.min(e, s + 300)) });
    });
    return segs.length ? segs : null;
  }
  function createHl(segs, c) {
    var g = newId(), ref = cur.ref, ts = now();
    segs.forEach(function (sg) {
      var id = g + '_' + sg.u;
      S.hl[id] = { pg: ref, u: sg.u, s: sg.s, e: sg.e, c: c, g: g, q: sg.q, ts: ts };
      markDirty(chOf(ref), 'hl', id);
    });
    return g;
  }
  function groupIds(g) { return Object.keys(S.hl).filter(function (id) { return S.hl[id].g === g && !S.hl[id].x; }); }
  function recolor(g, c) {
    groupIds(g).forEach(function (id) { var h = S.hl[id]; S.hl[id] = Object.assign({}, h, { c: c, ts: now() }); markDirty(chOf(h.pg), 'hl', id); });
  }
  function delGroup(g) {
    var pg = null;
    groupIds(g).forEach(function (id) {
      var h = S.hl[id]; pg = h.pg;
      S.hl[id] = { pg: h.pg, u: h.u, g: g, x: 1, ts: now() }; markDirty(chOf(h.pg), 'hl', id);
    });
    if (pg && S.gn[g] && S.gn[g][0]) { S.gn[g] = ['', now(), pg]; markDirty(chOf(pg), 'gn', g); }
  }

  /* barre d'annotation */
  var annotEl = document.getElementById('bkAnnot'), selTimer = null;
  function annotShow(a) {
    annot = a; annotEl.hidden = false;
    document.getElementById('bkAnnotLabel').textContent = a.mode === 'new' ? 'Surligner' : 'Surlignage';
    document.getElementById('bkAnnotDel').hidden = a.mode !== 'edit';
    var cc = a.mode === 'edit' ? (S.hl[groupIds(a.g)[0]] || {}).c : 0;
    annotEl.querySelectorAll('.bk-dot').forEach(function (d) { d.classList.toggle('sel', +d.getAttribute('data-c') === cc); });
  }
  function annotHide() { annot = null; if (annotEl) annotEl.hidden = true; }
  document.addEventListener('selectionchange', function () {
    clearTimeout(selTimer);
    selTimer = setTimeout(function () {
      if (view !== 'chapter') return;
      var segs = selectionSegments();
      if (segs) annotShow({ mode: 'new', segs: segs });
      else if (annot && annot.mode === 'new') annotHide();
    }, 250);
  });
  annotEl.addEventListener('mousedown', function (e) { e.preventDefault(); });   // garde la sélection
  annotEl.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !annot) return;
    if (b.id === 'bkAnnotClose') { var s = window.getSelection(); if (s) s.removeAllRanges(); return annotHide(); }
    var a = annot;
    if (b.classList.contains('bk-dot')) {
      var c = +b.getAttribute('data-c');
      if (a.mode === 'new') createHl(a.segs, c); else recolor(a.g, c);
      var sel = window.getSelection(); if (sel) sel.removeAllRanges();
      annotHide(); applyHighlights(); updateOverviewCounters();
    } else if (b.id === 'bkAnnotNote') {
      var g = a.g;
      if (a.mode === 'new') { g = createHl(a.segs, 1); var s2 = window.getSelection(); if (s2) s2.removeAllRanges(); applyHighlights(); }
      annotHide(); openNote(g);
    } else if (b.id === 'bkAnnotDel') {
      delGroup(a.g); annotHide(); applyHighlights();
    }
  });
  function updateOverviewCounters() { /* l'accueil se redessine à l'ouverture */ }

  /* fiches (résumé, chapitre, notes, annotations) */
  var ov = document.getElementById('bkOv');
  function sheet(kicker, title, html) {
    document.getElementById('bkSheetKicker').textContent = kicker;
    document.getElementById('bkSheetTitle').textContent = title;
    document.getElementById('bkSheetBody').innerHTML = html;
    ov.hidden = false;
  }
  function closeSheet() { ov.hidden = true; noteTarget = null; }
  function openNote(g) {
    noteTarget = g;
    var ids = groupIds(g), h = S.hl[ids[0]] || {}, q = ids.map(function (id) { return S.hl[id].q; }).join(' … ');
    sheet('Note · page ' + (h.pg || ''), 'Ma note', '<p class="bk-note-small" style="margin:0 0 8px">« ' + esc(q.slice(0, 240)) + (q.length > 240 ? '…' : '') + ' »</p>'
      + '<textarea id="bkNoteTxt" placeholder="Écris ta note…">' + esc((S.gn[g] || [''])[0]) + '</textarea>'
      + '<div class="bk-row" style="margin-top:10px"><button class="bk-btn primary" data-act="notesave">Enregistrer</button><button class="bk-btn" data-act="notedel">Effacer le surlignage</button></div>');
    var t = document.getElementById('bkNoteTxt'); if (t) t.focus();
  }
  function pageSheet() {
    var p = chap(cur.n).pages[cur.pi];
    sheet('Page ' + p.ref, 'Idées principales', '<ul>' + p.summary.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>'
      + '<h4>Vocabulaire</h4><dl>' + p.vocab.map(function (v) { return '<dt>' + v[0] + '</dt><dd>' + v[1] + '</dd>'; }).join('') + '</dl>');
  }
  function chapterSheet() {
    var c = chap(cur.n);
    sheet(chLabel(c), 'Fiche du chapitre', '<ul>' + c.sheet.points.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>'
      + '<h4>Chiffres à connaître</h4><table><tbody>' + c.sheet.nums.map(function (n) { return '<tr><td>' + n[0] + '</td><td>' + n[1] + '</td></tr>'; }).join('') + '</tbody></table>');
  }
  function annotsSheet() {
    var groups = {};
    Object.keys(S.hl).forEach(function (id) {
      var h = S.hl[id]; if (!h || h.x) return;
      var g = groups[h.g] = groups[h.g] || { g: h.g, pg: h.pg, c: h.c, ts: h.ts, q: [] };
      g.q.push(h.q);
    });
    Object.keys(S.nt).forEach(function (ref) {
      if (S.nt[ref][0]) groups['n:' + ref] = { page: true, pg: ref, ts: S.nt[ref][1], note: S.nt[ref][0] };
    });
    var list = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) {
      var A = findPage(a.pg), B = findPage(b.pg);
      return (A && B) ? (A.p.n - B.p.n || A.pi - B.pi || a.ts - b.ts) : 0;
    });
    var html = list.length ? list.map(function (x) {
      var f = findPage(x.pg); if (!f) return '';
      var note = x.page ? x.note : ((S.gn[x.g] || [''])[0]);
      return '<button class="bk-res" style="width:100%;margin-bottom:6px" data-act="open" data-n="' + f.p.n + '" data-pi="' + f.pi + '"><small>'
        + (x.page ? '📝 Note de page' : '<span class="uh c' + x.c + '" style="padding:0 6px">&nbsp;</span> ' + COLORS[x.c]) + ' · ' + esc(f.c.title) + ' · p. ' + esc(x.pg) + '</small>'
        + (x.page ? '' : esc(x.q.join(' … ').slice(0, 200))) + (note ? '<br><i>📝 ' + esc(note.slice(0, 200)) + '</i>' : '') + '</button>';
    }).join('') : '<p class="bk-note-small">Aucune annotation pour l’instant. Sélectionne un passage dans le texte pour le surligner.</p>';
    sheet('Tout le livre', 'Mes annotations', html);
  }

  /* ------------------------------------------------------------------ évènements */
  function onClick(e) {
    var uh = e.target.closest('.uh');
    if (uh && view === 'chapter') {
      var s = window.getSelection();
      if (!s || s.isCollapsed) { annotShow({ mode: 'edit', g: uh.getAttribute('data-g') }); return; }
    }
    if (annot && annot.mode === 'edit' && !uh) annotHide();
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'open') { closeSheet(); openChapter(+b.getAttribute('data-n'), +b.getAttribute('data-pi'), true); }
    else if (act === 'home') { history.pushState(null, '', location.pathname); renderHome(); window.scrollTo(0, 0); }
    else if (act === 'resume') { var f = findPage(S.last.ref); if (f) openChapter(f.p.n, f.pi, true); }
    else if (act === 'goto') showPage(+b.getAttribute('data-pi'), true);
    else if (act === 'prev') go(-1);
    else if (act === 'next') go(1);
    else if (act === 'sum') pageSheet();
    else if (act === 'chsheet') chapterSheet();
    else if (act === 'orig') { showOrig = !showOrig; jset('bk_orig', showOrig ? 1 : 0); updateOrig(); if (showOrig && b.closest('.bk-fig')) document.getElementById('bkOrig').scrollIntoView({ block: 'start' }); }
    else if (act === 'zoom') openZoom();
    else if (act === 'figzoom') openZoom(b.getAttribute('data-src'), b.getAttribute('alt'));
    else if (act === 'toggleread') { setRead(cur.ref, !isRead(cur.ref)); renderPills(); updateReadBtn(); updateChapterHead(); }
    else if (act === 'chread' || act === 'chunread') {
      chap(cur.n).pages.forEach(function (p) { setRead(p.ref, act === 'chread'); });
      renderPills(); updateReadBtn(); updateChapterHead();
    }
    else if (act === 'annots') annotsSheet();
    else if (act === 'dlall') downloadAll();
    else if (act === 'notesave') {
      var g = noteTarget, ids = groupIds(g), pg = (S.hl[ids[0]] || {}).pg;
      if (pg) { S.gn[g] = [document.getElementById('bkNoteTxt').value.trim(), now(), pg]; markDirty(chOf(pg), 'gn', g); }
      closeSheet(); applyHighlights();
    }
    else if (act === 'notedel') { var g2 = noteTarget; closeSheet(); delGroup(g2); applyHighlights(); }
  }
  $root.addEventListener('click', onClick);
  ov.addEventListener('click', onClick);   // les fiches (notes, annotations) sont hors de $root
  document.getElementById('bkClose').addEventListener('click', closeSheet);
  ov.addEventListener('click', function (e) { if (e.target === ov) closeSheet(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeSheet(); annotHide(); return; }
    if (view !== 'chapter' || !ov.hidden || e.target.matches('input,textarea')) return;
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  });
  ['scroll', 'pointerdown', 'keydown', 'touchstart', 'mousemove', 'wheel'].forEach(function (ev) {
    window.addEventListener(ev, function () { lastAct = now(); }, { passive: true });
  });
  function route() {
    var m = (location.hash || '').match(/^#c(\d+)\/(\d+)$/);
    if (!BOOK) return;
    var pos = jget(POS_KEY, null), f = pos && findPage(pos.ref);
    if (m && chap(+m[1])) {
      // même page que la dernière mémorisée → on rouvre aussi à la même hauteur
      if (firstRoute && f && f.p.n === +m[1] && f.pi === +m[2]) { resumeRef = pos.ref; resumeY = pos.y; }
      openChapter(+m[1], +m[2], false);
    } else if (firstRoute && f) {
      resumeRef = pos.ref; resumeY = pos.y;
      openChapter(f.p.n, f.pi, false);
    } else renderHome();
    firstRoute = false;
  }
  var firstRoute = true;
  window.addEventListener('popstate', route);

  /* ------------------------------------------------------------------ temps de lecture */
  setInterval(function () {
    if (view !== 'chapter' || !cur || document.hidden || !ov.hidden || now() - lastAct > IDLE_MS) return;
    addTime(cur.ref, 1); ticks++;
    // Une page n'est « lue » que lorsqu'on clique sur « Suivante » (voir go()) : regarder le bas
    // de la page pour en estimer la longueur ne la marque plus comme vue.
    if (ticks % 5 === 0) saveLocal();
    if (ticks % 10 === 0) updateChapterHead();
  }, 1000);
  function persistNow() { savePos(); saveLocal(); flush(true); }
  document.addEventListener('visibilitychange', function () { if (document.hidden) persistNow(); else flush(); });
  window.addEventListener('pagehide', persistNow);
  window.addEventListener('online', function () { flush(true); syncUI(); });
  window.addEventListener('offline', syncUI);
  setInterval(function () { if (dirtyCount()) flush(); }, 60000);

  /* mise à jour reçue d'un autre appareil */
  function onRemote() {
    if (!BOOK) return;
    if (view === 'home') { if (!document.activeElement || document.activeElement.id !== 'bkSearch') renderHome(); return; }
    if (view === 'chapter' && cur) {
      renderPills(); updateReadBtn(); updateChapterHead();
      var sig = pageSig();
      if (sig !== cur.sig && !selectionSegments() && !annot) { cur.sig = sig; applyHighlights(); }
    }
  }

  /* ------------------------------------------------------------------ démarrage */
  fetch(BASE + 'book.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (data) {
    BOOK = data;
    document.title = BOOK.title;
    BOOK.chapters.forEach(function (c) {
      CHMAP[c.n] = c; ORDER.push(c.n);
      c.pages.forEach(function (p, i) { PAGES.push({ n: c.n, pi: i, ref: p.ref, pdf: p.pdf, w: p.w }); ALLWORDS += p.w; REFCH[p.ref] = c.n; });
    });
    S = emptyState();
    initAuth();
    if (!uid && S) { loadLocal(); }      // en attendant l'identification : état local anonyme
    route();
  }).catch(function (e) {
    $root.innerHTML = '<p class="bk-loading">Impossible de charger le manuel (' + esc(e.message) + '). Ouvre cette page une fois avec une connexion pour l’enregistrer sur cet appareil.</p>';
  });
})();
