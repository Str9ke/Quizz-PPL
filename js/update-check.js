// ============================================================
// update-check.js — « Suis-je à jour ? »
// ============================================================
//
// POURQUOI : l'application Android ne se met JAMAIS à jour toute seule (distribuée hors Play
// Store). Rien n'indiquait donc qu'une version plus récente existait — on pouvait embarquer
// avec un APK de plusieurs semaines sans le savoir, correctifs hors-ligne compris. Sur le web
// le Service Worker se met à jour seul, mais uniquement à l'ouverture EN LIGNE, et là non plus
// rien ne le disait.
//
// COMMENT : le site publie version.json, qui contient la version de l'appli. Cette version est
// celle du Service Worker (CACHE_NAME, ex. « quiz-ppl-v123 ») et NON le dernier commit : les
// données météo sont régénérées toutes les ~3 h par GitHub Actions, et se fier au commit
// aurait signalé une « mise à jour disponible » plusieurs fois par jour sans qu'une seule
// ligne de l'application n'ait changé — le genre d'alerte qu'on apprend en deux jours à
// ignorer, y compris le jour où elle compte vraiment.
//
// La version EMBARQUÉE est injectée dans config.js au moment du build (voir les workflows).

(function () {
  'use strict';

  var REMOTE_BASE = 'https://str9ke.github.io/Quizz-PPL/';
  var CHECK_INTERVAL_MS = 6 * 3600 * 1000; // au plus une vérification par 6 h
  var LAST_CHECK_KEY = 'updateCheckLastAt';
  var LAST_SEEN_KEY = 'updateCheckLatestVersion';

  function installedVersion() {
    try {
      return (window.APP_BUILD && window.APP_BUILD.version) || null;
    } catch (e) {
      return null;
    }
  }

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

  /**
   * fetchLatestVersion() – Promise<string|null>. Toujours lu sur le réseau, jamais depuis un
   * cache : un fichier de version servi depuis le cache répondrait forcément « tu es à jour »,
   * ce qui est exactement la question qu'on ne peut pas se poser à soi-même.
   */
  function fetchLatestVersion() {
    if (!navigator.onLine) return Promise.resolve(null);
    var url = REMOTE_BASE + 'version.json?t=' + Date.now();
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return (j && j.appVersion) || null; })
      .catch(function () { return null; });
  }

  /** compare() – Promise<{ installed, latest, upToDate, known }> */
  function compare(force) {
    var installed = installedVersion();
    var last = parseInt(localStorage.getItem(LAST_CHECK_KEY) || '0', 10);
    var cached = localStorage.getItem(LAST_SEEN_KEY) || null;
    var fresh = (Date.now() - last) < CHECK_INTERVAL_MS;

    // Hors d'une vérification forcée, on se contente du dernier résultat connu tant qu'il est
    // récent : inutile d'aller sur le réseau à chaque ouverture de page.
    if (!force && fresh && cached) {
      return Promise.resolve(_result(installed, cached));
    }
    return fetchLatestVersion().then(function (latest) {
      if (latest) {
        localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
        localStorage.setItem(LAST_SEEN_KEY, latest);
      }
      return _result(installed, latest || cached);
    });
  }

  function _result(installed, latest) {
    return {
      installed: installed,
      latest: latest,
      // `known` distingue « à jour » d'« impossible à vérifier » (hors-ligne, version.json
      // absent) : afficher un rassurant « à jour » sans avoir rien vérifié serait pire que
      // de ne rien afficher.
      known: !!(installed && latest),
      upToDate: !!(installed && latest && installed === latest),
      native: isNativeApp()
    };
  }

  window.appUpdate = {
    check: compare,
    installedVersion: installedVersion,
    isNativeApp: isNativeApp,
    releaseUrl: 'https://github.com/Str9ke/Quizz-PPL/releases/tag/android-latest'
  };
})();
