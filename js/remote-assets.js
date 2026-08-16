// ============================================================
// remote-assets.js — Redirige les données MÉTÉO vers le site en ligne dans l'APK Android
// ============================================================
//
// CONTEXTE : l'application Android (Capacitor) embarque les pages, les questions et les images
// à l'intérieur de l'APK — c'est ce qui la rend utilisable en vol sans dépendre d'un cache.
// Les données météo, elles, en sont volontairement EXCLUES (voir tools/build_www.py) : elles
// sont régénérées toutes les ~3 h par GitHub Actions, et les figer dans l'APK reviendrait à
// livrer un METAR périmé dès la compilation — pire que pas de METAR du tout.
//
// PROBLÈME que ce fichier résout : navlog.html référence ces fichiers par 132 chemins RELATIFS
// (`opmet.html`, `skeyes_radar_ppi_00.gif`, `temsi_france_manifest.json`…). Dans le navigateur
// ils pointent vers le site ; dans l'APK ils pointent vers l'intérieur du paquet, où ces
// fichiers n'existent pas — toute la section briefing (METAR, NOTAM, TEMSI, radar) serait donc
// cassée.
//
// APPROCHE : plutôt que réécrire 132 appels un par un — fastidieux, et surtout condamné à se
// désynchroniser au premier ajout de carte —, on intercepte les requêtes au moment où elles
// partent. Un seul endroit à maintenir, et les éléments créés dynamiquement (carrousels de
// cartes construits en JS) sont couverts au même titre que ceux écrits dans le HTML.
//
// Hors APK ce fichier ne fait STRICTEMENT RIEN : sur le site web les chemins relatifs sont déjà
// corrects, et une redirection y serait au mieux inutile, au pire une source de requêtes
// cross-origin inutiles.

(function () {
  'use strict';

  var REMOTE_BASE = 'https://str9ke.github.io/Quizz-PPL/';

  /* Fichiers régénérés côté serveur, donc jamais embarqués dans l'APK. Le test porte sur le
     NOM DE FICHIER seul : c'est la même liste que les exclusions de tools/build_www.py, et
     garder les deux alignées est la seule chose à surveiller en ajoutant un type de carte. */
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

  window.APP_IS_NATIVE = isNativeApp();

  // Sur le web : point d'entrée neutre, pour que le code appelant puisse s'en servir sans se
  // soucier de la plateforme.
  if (!window.APP_IS_NATIVE) {
    window.remoteUrl = function (u) { return u; };
    return;
  }

  /**
   * remap(url) – Renvoie l'URL distante si `url` désigne un fichier météo servi par le site,
   * sinon null (aucune réécriture). Ne touche JAMAIS à une URL déjà absolue vers un autre
   * domaine : Firestore, les proxies CORS et les API météo doivent continuer à partir tels quels.
   */
  function remap(url) {
    if (!url) return null;
    var abs;
    try {
      abs = new URL(url, document.baseURI);
    } catch (e) {
      return null;
    }
    // Seules les requêtes vers l'intérieur de l'APK sont concernées.
    if (abs.origin !== window.location.origin) return null;
    var file = abs.pathname.split('/').pop();
    if (!REMOTE_PATTERN.test(file)) return null;
    return REMOTE_BASE + file + abs.search + abs.hash;
  }

  window.remoteUrl = function (u) { return remap(u) || u; };

  // ---- 1. Éléments du DOM (iframe, img, embed, object) ----
  var ATTR_BY_TAG = { IFRAME: 'src', IMG: 'src', EMBED: 'src', SOURCE: 'src', OBJECT: 'data' };

  function fixElement(el) {
    if (!el || !el.tagName) return;
    var attr = ATTR_BY_TAG[el.tagName];
    if (!attr) return;
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
     part donc vers l'intérieur de l'APK et échoue (~34 sur navlog.html), puis la réécriture
     déclenche le chargement correct depuis le site. L'état final est juste — vérifié : aucun
     élément météo ne reste sur une URL locale — et cette requête perdue ne coûte rien, le
     serveur local de Capacitor répondant instantanément sans toucher au réseau. Les supprimer
     supposerait de réécrire les 132 références dans navlog.html, soit précisément la
     duplication que ce fichier existe pour éviter. */
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
    // Les carrousels de cartes sont construits très tôt : on tente aussi une passe immédiate,
    // sans attendre DOMContentLoaded, sur ce qui est déjà analysé.
    scan(document.documentElement);
  } else {
    startObserver();
  }

  // ---- 2. fetch() ----
  // Utilisé pour les manifestes (temsi_france_manifest.json, skeyes_images.json…).
  // GitHub Pages renvoie `Access-Control-Allow-Origin: *`, ces lectures cross-origin passent donc.
  if (typeof window.fetch === 'function') {
    var nativeFetch = window.fetch.bind(window);
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

  console.log('[remote-assets] Application Android : données météo servies depuis ' + REMOTE_BASE);
})();
