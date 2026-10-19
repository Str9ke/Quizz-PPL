// ============================================================
// apps.js — Trois applications, un seul site
// ============================================================
//
// Le projet est découpé en TROIS applications distinctes, chacune avec son nom, son logo, son
// menu, son manifeste (PWA) et son APK Android :
//   - Quiz PPL               (ppl)      : quiz, révisions, examens blancs, statistiques…
//   - Briefing VFR           (briefing) : préparation du vol, météo, NOTAM, OPMET, avions, urgences
//   - Bibliothèque du pilote (biblio)   : lecteur des manuels FAA traduits (AFH, PHAK)
// Le code, la sauvegarde (Firebase) et le service worker restent communs : rien n'est dupliqué.
//
// Quelle application est-ce ?
//   - dans un APK : celle pour laquelle il a été construit (window.APP_BUILD.app, écrit dans
//     config.js par .github/workflows/build-android.yml) ;
//   - sur le web : celle à laquelle appartient la page (PAGE_APP) ; pour une page commune
//     (configuration…), le paramètre ?app=, sinon la dernière application ouverte.
//
// Ajouter une page à une application = l'ajouter à PAGE_APP (et à son menu dans js/sidebar.js).

(function () {
  'use strict';

  var REPO = 'https://github.com/Str9ke/Quizz-PPL';

  var APPS = {
    ppl: {
      id: 'ppl', name: 'Quiz PPL', short: 'Quiz PPL',
      tagline: 'Préparation à l’examen théorique PPL',
      home: 'index.html?accueil=1', manifest: 'manifest.json',
      color: '#667eea', logo: 'icons/ppl-192.png',
      // Garde l'identifiant de l'ancienne application unique : l'APK déjà installé se met à jour
      // par-dessus (progression du quiz conservée) et devient l'appli « Quiz PPL ».
      apk: { tag: 'android-latest', file: 'quiz-aviation-ppl.apk', appId: 'be.str9ke.quizzppl' }
    },
    briefing: {
      id: 'briefing', name: 'Briefing VFR', short: 'Briefing',
      tagline: 'Préparation du vol · météo · NOTAM · avions',
      home: 'briefing.html', manifest: 'manifest-briefing.json',
      color: '#0f9fb0', logo: 'icons/briefing-192.png',
      apk: { tag: 'android-briefing', file: 'briefing-vfr.apk', appId: 'be.str9ke.briefingvfr' }
    },
    biblio: {
      id: 'biblio', name: 'Bibliothèque du pilote', short: 'Biblio pilote',
      tagline: 'Les manuels FAA en français',
      home: 'bibliotheque.html', manifest: 'manifest-biblio.json',
      color: '#f59e0b', logo: 'icons/biblio-192.png',
      apk: { tag: 'android-biblio', file: 'bibliotheque-pilote.apk', appId: 'be.str9ke.bibliopilote' }
    }
  };
  var ORDER = ['briefing', 'ppl', 'biblio'];

  /* Pages propres à une application. Toute autre page appartient au Quiz PPL, sauf les pages
     communes (SHARED) qui prennent l'application d'où l'on vient. */
  var PAGE_APP = {
    'briefing.html': 'briefing', 'navlog.html': 'briefing', 'urgences.html': 'briefing',
    'bibliotheque.html': 'biblio', 'livre.html': 'biblio'
  };
  var SHARED = { 'configuration.html': 1, 'envoi-fichiers.html': 1 };

  function file() { return location.pathname.split('/').pop() || 'index.html'; }

  function nativeApp() {
    try { return (window.APP_BUILD && APPS[window.APP_BUILD.app]) ? window.APP_BUILD.app : null; }
    catch (e) { return null; }
  }
  function isNative() {
    try {
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') return window.Capacitor.isNativePlatform();
      return !!(window.Capacitor && window.Capacitor.isNative);
    } catch (e) { return false; }
  }

  function detect() {
    var n = nativeApp();
    if (n) return n;
    // APK construit avant la séparation (pas de champ `app`) : c'était l'appli « tout-en-un »,
    // devenue Quiz PPL.
    if (isNative()) return 'ppl';
    var f = file();
    if (PAGE_APP[f]) return PAGE_APP[f];
    if (SHARED[f]) {
      var q = /[?&]app=([a-z]+)/.exec(location.search);
      if (q && APPS[q[1]]) return q[1];
      try { var last = sessionStorage.getItem('currentApp') || localStorage.getItem('lastApp'); if (APPS[last]) return last; } catch (e) { /* ignore */ }
    }
    return 'ppl';
  }

  var CURRENT = detect();
  try { sessionStorage.setItem('currentApp', CURRENT); localStorage.setItem('lastApp', CURRENT); } catch (e) { /* ignore */ }

  /* Page commune : son manifeste (installation PWA) et sa couleur suivent l'application courante. */
  if (SHARED[file()]) {
    try {
      var link = document.querySelector('link[rel="manifest"]');
      if (link) link.setAttribute('href', APPS[CURRENT].manifest);
    } catch (e) { /* ignore */ }
  }

  function apkUrl(id) { var a = APPS[id || CURRENT].apk; return REPO + '/releases/download/' + a.tag + '/' + a.file; }
  function releaseUrl(id) { return REPO + '/releases/tag/' + APPS[id || CURRENT].apk.tag; }
  /* Lien vers une page d'une autre application : sur le web, simple lien ; dans un APK, la page
     n'est pas embarquée → on propose d'installer l'autre application. */
  function linkTo(id) { return isNative() && id !== CURRENT ? releaseUrl(id) : APPS[id].home; }

  window.APPS = APPS;
  window.APP_ORDER = ORDER;
  window.CURRENT_APP = CURRENT;
  window.appInfo = function (id) { return APPS[id || CURRENT]; };
  window.appApkUrl = apkUrl;
  window.appReleaseUrl = releaseUrl;
  window.appLinkTo = linkTo;
  window.appIsNative = isNative;
  /* Lien vers la configuration de l'application courante. */
  window.appConfigUrl = function () { return 'configuration.html?app=' + CURRENT; };

  /* Mise à jour automatique (site, PWA et APK) : voir js/auto-update.js, chargé sur toutes les pages. */
  try {
    var me = document.currentScript && document.currentScript.src;
    var s = document.createElement('script');
    s.src = (me ? me.replace(/[^/]*$/, '') : 'js/') + 'auto-update.js?v=20261019a';
    document.head.appendChild(s);
  } catch (e) { /* ignore */ }
})();
