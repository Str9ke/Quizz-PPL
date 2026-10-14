// ============================================================
// remote-assets.js — D'où viennent les données MÉTÉO de la page Briefing
// ============================================================
//
// navlog.html référence les fichiers météo par des chemins RELATIFS (`opmet.html`,
// `skeyes_radar_ppi_00.gif`, `temsi_france_manifest.json`…), plus de 130 fois. Plutôt que
// réécrire chaque appel — fastidieux et condamné à se désynchroniser au premier ajout de
// carte —, ce fichier intercepte les requêtes au moment où elles partent (attributs src des
// éléments, fetch, XMLHttpRequest) et choisit la bonne source :
//
// 1. Données FRAÎCHES (14/10/2026) : juste après une récupération, le workflow rapide pousse les
//    nouveaux fichiers dans le dépôt bien avant que le site GitHub Pages soit redéployé (~40 s
//    plus tard). La page les lit alors directement sur raw.githubusercontent.com, à l'adresse
//    du commit exact (immuable, donc jamais de cache périmé) — voir setFreshDataBase(), appelé
//    par navlog.html. Dès que le site déployé a rattrapé ces données, navlog.html appelle
//    clearFreshDataBase() et tout revient à la normale.
//    raw.githubusercontent.com sert les images avec leur vrai type et autorise CORS, mais
//    sert le HTML en texte brut : les pages OPMET/NOTAM/avis du jour sont donc téléchargées
//    puis affichées dans leur <iframe> via une URL blob: (même origine que la page, si bien
//    que la recherche NOTAM, le surlignage de la route et l'ajustement de hauteur marchent).
//
// 2. Application Android (Capacitor) : les données météo ne sont pas embarquées dans l'APK
//    (voir tools/build_www.py) — un METAR figé à la compilation serait pire que pas de METAR.
//    Hors données fraîches, elles sont lues sur le site en ligne (REMOTE_BASE).
//
// 3. Site web, sans données fraîches : rien n'est réécrit, les chemins relatifs sont corrects.

(function () {
  'use strict';

  var REMOTE_BASE = 'https://str9ke.github.io/Quizz-PPL/';
  var RAW_PREFIX = 'https://raw.githubusercontent.com/Str9ke/Quizz-PPL/';
  var FRESH_KEY = 'briefingFreshData';
  var FRESH_MAX_AGE = 12 * 3600 * 1000;

  /* Fichiers régénérés côté serveur. Le test porte sur le NOM DE FICHIER seul : c'est la même
     liste que les exclusions de tools/build_www.py, et garder les deux alignées est la seule
     chose à surveiller en ajoutant un type de carte. */
  var REMOTE_PATTERN = /^(opmet.*|notams_belgique\.html|daily_warnings.*|temsi_.*|wintem_.*|skeyes_.*)$/i;

  function isNativeApp() {
    try {
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
        return window.Capacitor.isNativePlatform();
      }
      return !!(window.Capacitor && window.Capacitor.isNative);
    } catch (e) {
      return false;
    }
  }

  var NATIVE = window.APP_IS_NATIVE = isNativeApp();

  function readFresh() {
    try {
      var f = JSON.parse(localStorage.getItem(FRESH_KEY) || 'null');
      if (f && f.base && f.ts && Date.now() - (f.savedAt || f.ts) < FRESH_MAX_AGE) return f;
    } catch (e) { /* stockage indisponible : pas de données fraîches */ }
    return null;
  }
  var fresh = readFresh();

  /* Source actuelle des données météo, ou null = chemins relatifs inchangés. */
  function dataBase() {
    if (fresh) return fresh.base;
    return NATIVE ? REMOTE_BASE : null;
  }

  window.setFreshDataBase = function (sha, ts) {
    fresh = { base: RAW_PREFIX + sha + '/', sha: sha, ts: ts, savedAt: Date.now() };
    try { localStorage.setItem(FRESH_KEY, JSON.stringify(fresh)); } catch (e) { /* tant pis : valable pour cette page */ }
  };
  window.clearFreshDataBase = function () {
    fresh = null;
    try { localStorage.removeItem(FRESH_KEY); } catch (e) { /* idem */ }
  };
  window.freshDataInfo = function () { return fresh; };
  /* URL d'un fichier sur le site déployé (relatif sur le web, site en ligne dans l'appli). */
  window.pagesDataUrl = function (file) { return (NATIVE ? REMOTE_BASE : '') + file; };

  /**
   * dataFile(url) – Nom du fichier météo désigné par `url` (relatif, site en ligne ou
   * raw.githubusercontent.com), sinon null. Ne touche JAMAIS aux autres URL absolues :
   * Firestore, proxies CORS et API météo doivent partir tels quels.
   */
  function dataFile(url) {
    if (!url) return null;
    var abs;
    try { abs = new URL(url, document.baseURI); } catch (e) { return null; }
    var href = abs.href;
    if (abs.origin !== window.location.origin &&
        href.indexOf(REMOTE_BASE) !== 0 && href.indexOf(RAW_PREFIX) !== 0) return null;
    var file = abs.pathname.split('/').pop();
    return REMOTE_PATTERN.test(file) ? { file: file, search: abs.search, hash: abs.hash } : null;
  }

  /* URL à utiliser pour `url`, ou null si rien à changer. */
  function remap(url) {
    var d = dataFile(url);
    if (!d) return null;
    var base = dataBase();
    if (!base) return null;
    // Commit précis = contenu immuable : inutile (et contre-productif) d'y ajouter ?t=…
    return fresh ? base + d.file : base + d.file + d.search + d.hash;
  }

  window.remoteUrl = function (u) { return remap(u) || u; };

  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  // ---- 1. Éléments du DOM (iframe, img, embed, object) ----
  var ATTR_BY_TAG = { IFRAME: 'src', IMG: 'src', EMBED: 'src', SOURCE: 'src', OBJECT: 'data' };

  /* Chemins relatifs à l'intérieur d'une page HTML fraîche (ex. l'image des avis du jour) :
     rendus absolus, puisque la page s'affiche depuis une URL blob:. */
  function absolutize(html, base) {
    return html.replace(/(\ssrc\s*=\s*)(["'])(?!https?:|data:|blob:|\/|#)([^"']+)\2/gi,
      function (m, pre, q, path) { return pre + q + base + path + q; });
  }

  function fixIframe(el) {
    var raw = el.getAttribute('src');
    if (!raw || raw === el._freshBlob || raw === el._freshFallback) return;
    var file;
    if (raw.indexOf('blob:') === 0) {
      // Rechargement d'une de nos pages blob (navlog fait src = src + '?t=…')
      if (!el.dataset.freshFile) return;
      file = el.dataset.freshFile;
    } else {
      var d = dataFile(raw);
      if (!d) return;
      file = d.file;
    }
    if (!fresh) {
      var base = dataBase();
      if (!base) {
        // Données fraîches abandonnées entre-temps : revenir à la copie du site
        if (raw.indexOf('blob:') === 0) el.setAttribute('src', file + '?t=' + Date.now());
        return;
      }
      var next = base + file;
      if (next !== raw) el.setAttribute('src', next);
      return;
    }
    el.dataset.freshFile = file;
    var tok = el._freshTok = (el._freshTok || 0) + 1;
    var srcBase = fresh.base;
    nativeFetch(srcBase + file, { cache: 'force-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (html) {
      if (tok !== el._freshTok) return;
      var url = URL.createObjectURL(new Blob([absolutize(html, srcBase)], { type: 'text/html;charset=utf-8' }));
      var old = el._freshBlob;
      el._freshBlob = url;
      el.setAttribute('src', url);
      if (old) setTimeout(function () { URL.revokeObjectURL(old); }, 5000);
    }).catch(function (e) {
      if (tok !== el._freshTok) return;
      console.warn('[remote-assets] ' + file + ' indisponible sur GitHub (' + e.message + '), repli sur le site');
      el._freshFallback = (NATIVE ? REMOTE_BASE : '') + file + '?t=' + Date.now();
      el.setAttribute('src', el._freshFallback);
    });
  }

  function fixElement(el) {
    if (!el || !el.tagName) return;
    var attr = ATTR_BY_TAG[el.tagName];
    if (!attr) return;
    if (el.tagName === 'IFRAME') { fixIframe(el); return; }
    var raw = el.getAttribute(attr);
    if (!raw) return;
    var next = remap(raw);
    // La comparaison évite une boucle infinie avec le MutationObserver ci-dessous : réécrire
    // un attribut déclenche une mutation, qui rappellerait cette fonction.
    if (next && next !== raw) el.setAttribute(attr, next);
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    fixElement(root);
    var sel = 'iframe[src],img[src],embed[src],source[src],object[data]';
    var found = root.querySelectorAll ? root.querySelectorAll(sel) : [];
    for (var i = 0; i < found.length; i++) fixElement(found[i]);
  }

  /* Note sur les images déjà présentes dans le HTML : l'analyseur du navigateur lance leur
     téléchargement AVANT qu'un observateur puisse réécrire l'attribut. Une première requête
     part donc vers l'ancienne source, puis la réécriture déclenche le bon chargement. L'état
     final est juste ; supprimer cette requête perdue supposerait de réécrire les 130
     références de navlog.html, soit précisément la duplication que ce fichier évite. */
  function startObserver() {
    scan(document.documentElement);
    if (typeof MutationObserver !== 'function') return;
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'attributes') { fixElement(r.target); continue; }
        for (var j = 0; j < r.addedNodes.length; j++) scan(r.addedNodes[j]);
      }
    }).observe(document.documentElement, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['src', 'data']
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
    // Les carrousels de cartes sont construits très tôt : on tente aussi une passe immédiate.
    scan(document.documentElement);
  } else {
    startObserver();
  }

  /* Réapplique la source courante à tout ce qui est affiché (appelé après setFreshDataBase /
     clearFreshDataBase, avant le rafraîchissement de l'affichage). */
  window.reapplyDataSources = function () { scan(document.documentElement); };

  // ---- 2. fetch() ----
  // Manifestes (temsi_france_manifest.json, skeyes_images.json…) et JSON des avis du jour.
  // GitHub Pages et raw.githubusercontent.com renvoient `Access-Control-Allow-Origin: *`.
  if (nativeFetch) {
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string') {
          var m = remap(input);
          if (m) return nativeFetch(m, init);
        } else if (input && input.url) {
          var m2 = remap(input.url);
          if (m2) return nativeFetch(new Request(m2, input), init);
        }
      } catch (e) { /* en cas de doute, laisser passer la requête d'origine */ }
      return nativeFetch(input, init);
    };
  }

  // ---- 3. XMLHttpRequest ----
  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype.open) {
    var nativeOpen = window.XMLHttpRequest.prototype.open;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      try {
        var m = remap(url);
        if (m) {
          var args = Array.prototype.slice.call(arguments);
          args[1] = m;
          return nativeOpen.apply(this, args);
        }
      } catch (e) { /* idem */ }
      return nativeOpen.apply(this, arguments);
    };
  }

  if (NATIVE) console.log('[remote-assets] Application Android : données météo servies depuis ' + (dataBase()));
  else if (fresh) console.log('[remote-assets] Données fraîches servies depuis ' + fresh.base);
})();
