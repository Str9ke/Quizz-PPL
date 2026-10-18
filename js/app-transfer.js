// ============================================================
// app-transfer.js — Transférer ses données locales d'une application à l'autre
// ============================================================
//
// POURQUOI : sur Android, chaque application a son propre stockage. Avant la séparation en trois
// applications, tout (briefing, quiz, livres) vivait dans la même ; les nouvelles applications
// Briefing VFR et Bibliothèque du pilote démarrent donc vides. Ce qui est déjà synchronisé par
// le compte (progression du quiz, dossiers de vol, notes, livres) revient tout seul à la
// connexion ; ce module rapatrie TOUT LE RESTE (route en cours, réglages, avions, cartes…).
//
// COMMENT : « Envoyer » copie le stockage local (localStorage) de cette application dans le
// compte (Firestore : quizProgress/{uid}/transfer/meta + p0, p1… — morceaux < 1 Mio) ;
// « Récupérer », dans l'autre application, recopie ces valeurs. Par défaut on ne remplace
// JAMAIS une valeur déjà présente sur l'appareil.

(function () {
  'use strict';

  var CHUNK = 400000;   // caractères par document (marge sous la limite de 1 Mio de Firestore)
  // Clés propres à cet appareil / cette application : ne pas les copier ailleurs.
  var SKIP = /^(firebase:|currentApp$|lastApp$|cachedUid$|updateCheck|briefingFreshData$|pwa|firstRun)/;

  function col(uid) { return window.db.collection('quizProgress').doc(uid).collection('transfer'); }
  function needUser() {
    var u = window.auth && window.auth.currentUser;
    if (!u) throw new Error('Connecte-toi d’abord à ton compte (même compte dans les deux applications).');
    return u.uid;
  }

  function snapshot() {
    var items = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!SKIP.test(k)) items[k] = localStorage.getItem(k);
    }
    return items;
  }

  /** send() → Promise<{count, size}> */
  function send() {
    var uid;
    try { uid = needUser(); } catch (e) { return Promise.reject(e); }
    var items = snapshot();
    var text = JSON.stringify(items);
    var parts = [];
    for (var i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));
    var c = col(uid);
    // Un document par morceau, puis la fiche « meta » en dernier : une lecture ne voit jamais un
    // envoi à moitié écrit (elle se fie au nombre de morceaux de la fiche).
    return Promise.all(parts.map(function (p, n) { return c.doc('p' + n).set({ data: p }); })).then(function () {
      return c.doc('meta').set({
        parts: parts.length, count: Object.keys(items).length, size: text.length,
        app: window.CURRENT_APP || 'ppl', at: new Date().toISOString()
      });
    }).then(function () { return { count: Object.keys(items).length, size: text.length }; });
  }

  /** info() → Promise<meta|null> */
  function info() {
    var uid;
    try { uid = needUser(); } catch (e) { return Promise.reject(e); }
    return col(uid).doc('meta').get({ source: 'server' }).then(function (d) { return d.exists ? d.data() : null; });
  }

  /** receive(overwrite) → Promise<{added, kept, failed}> */
  function receive(overwrite) {
    var uid;
    try { uid = needUser(); } catch (e) { return Promise.reject(e); }
    var c = col(uid);
    return c.doc('meta').get({ source: 'server' }).then(function (m) {
      if (!m.exists) throw new Error('Aucune donnée envoyée pour l’instant : fais d’abord « Envoyer » depuis l’autre application.');
      var meta = m.data(), reads = [];
      for (var n = 0; n < meta.parts; n++) reads.push(c.doc('p' + n).get({ source: 'server' }));
      return Promise.all(reads);
    }).then(function (docs) {
      var items = JSON.parse(docs.map(function (d) { return (d.data() || {}).data || ''; }).join(''));
      var r = { added: 0, kept: 0, failed: 0 };
      Object.keys(items).forEach(function (k) {
        if (SKIP.test(k)) return;
        if (!overwrite && localStorage.getItem(k) !== null) { r.kept++; return; }
        try { localStorage.setItem(k, items[k]); r.added++; } catch (e) { r.failed++; }   // quota plein : on continue
      });
      return r;
    });
  }

  window.appTransfer = { send: send, receive: receive, info: info };

  /* Interface prête à l'emploi : renderTransferCard(element) */
  window.renderTransferCard = function (el) {
    if (!el) return;
    var names = window.APPS || {};
    var here = (names[window.CURRENT_APP] || {}).name || 'cette application';
    el.innerHTML = '<p class="cfg-hint" style="margin:0 0 8px">Le Briefing, le Quiz et la Bibliothèque sont des applications séparées, '
      + 'chacune avec son propre stockage. Ce qui dépend du compte (progression, dossiers de vol, notes, livres) revient tout seul à la connexion. '
      + 'Pour tout le reste (route en cours, réglages, avions…) : <b>Envoyer</b> depuis l’ancienne application, puis <b>Récupérer</b> dans la nouvelle — avec le même compte.</p>'
      + '<div id="trInfo" style="font-size:.85em;margin-bottom:8px;color:var(--text-secondary)"></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      + '<button type="button" class="stats-btn" data-tr="send" style="padding:6px 14px;width:auto;margin:0">⬆️ Envoyer les données de ' + here + '</button>'
      + '<button type="button" class="stats-btn" data-tr="get" style="padding:6px 14px;width:auto;margin:0">⬇️ Récupérer ici</button>'
      + '<button type="button" class="stats-btn" data-tr="force" style="padding:6px 14px;width:auto;margin:0;background:var(--delete-bg)">⬇️ Récupérer en remplaçant</button></div>'
      + '<div id="trMsg" style="font-size:.85em;margin-top:8px"></div>';
    var msg = el.querySelector('#trMsg'), inf = el.querySelector('#trInfo');
    function showInfo() {
      info().then(function (m) {
        inf.textContent = m ? ('Dernier envoi : ' + new Date(m.at).toLocaleString('fr-BE') + ' depuis ' + ((names[m.app] || {}).name || m.app)
          + ' (' + m.count + ' éléments, ' + Math.round(m.size / 1024) + ' Ko).') : 'Aucun envoi enregistré dans ton compte.';
      }).catch(function (e) { inf.textContent = e.message; });
    }
    if (window.auth) window.auth.onAuthStateChanged(function (u) { if (u) showInfo(); else inf.textContent = 'Connecte-toi pour utiliser le transfert.'; });
    el.addEventListener('click', function (e) {
      var a = e.target.getAttribute('data-tr'); if (!a) return;
      msg.textContent = '⏳ …';
      var p = a === 'send' ? send().then(function (r) { return '✅ ' + r.count + ' éléments envoyés (' + Math.round(r.size / 1024) + ' Ko).'; })
        : receive(a === 'force').then(function (r) {
          return '✅ ' + r.added + ' éléments récupérés' + (r.kept ? ', ' + r.kept + ' déjà présents conservés' : '') + (r.failed ? ', ' + r.failed + ' trop volumineux ignorés' : '')
            + '. Recharge la page pour en profiter.';
        });
      if (a === 'force' && !confirm('Remplacer les données de cette application par celles envoyées ?')) { msg.textContent = ''; return; }
      p.then(function (t) { msg.textContent = t; showInfo(); }).catch(function (err) { msg.textContent = '❌ ' + (err.message || err); });
    });
  };
})();
