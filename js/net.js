// ============================================================
// net.js — Savoir si on est RÉELLEMENT connecté
// ============================================================
//
// LE PROBLÈME : dans l'application Android, la page est servie par un serveur local
// (https://localhost, fourni par Capacitor). `navigator.onLine` ne mesure que l'accès à CE
// serveur : il vaut donc `true` en permanence, mode avion compris. Tout le code qui s'y fiait
// se croyait en ligne alors qu'aucun réseau n'existait, avec des conséquences en cascade,
// toutes constatées en vol :
//
//   • LECTURE : les lectures Firestore partaient vers le serveur ({ source: 'server' }) et
//     n'échouaient qu'au bout du délai imparti, une par une — d'où les démarrages
//     interminables et le « chargement… » qui n'en finit pas.
//   • FILET DE SÉCURITÉ : le miroir local (js/localmirror.js) ne comble les trous que s'il se
//     sait hors-ligne. Se croyant en ligne, il ne comblait rien : la progression restait
//     invisible alors qu'elle était bien présente sur l'appareil.
//   • ÉCRITURE : chaque réponse était « vérifiée » auprès du serveur, vérification qui ne
//     pouvait pas aboutir, réessayée trois fois avec des pauses — puis déclarée en échec. Les
//     réponses données hors-ligne étaient perdues, et les mêmes questions revenaient à la
//     session suivante comme si de rien n'était.
//
// LA SOLUTION : demander l'état réseau au système Android (@capacitor/network) plutôt qu'au
// navigateur. Sur le web, `navigator.onLine` reste parfaitement valable — il y mesure bien la
// connexion réelle — donc rien ne change de ce côté.
//
// appIsOnline() est volontairement SYNCHRONE : tous les points d'appel le sont, et un test de
// connectivité qui rendrait une promesse obligerait à réécrire des dizaines d'endroits. L'état
// natif est donc tenu à jour en arrière-plan par un écouteur, et lu instantanément.

(function () {
  'use strict';

  // null = pas encore connu (le plugin n'a pas encore répondu) → on retombe sur navigator.onLine
  var _nativeOnline = null;
  var _nativeType = null;
  var _listeners = [];

  function plugin() {
    try {
      return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Network) || null;
    } catch (e) { return null; }
  }

  function isNative() {
    try {
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
        return window.Capacitor.isNativePlatform();
      }
      return !!(window.Capacitor && window.Capacitor.isNative);
    } catch (e) { return false; }
  }

  /**
   * appIsOnline() – Y a-t-il vraiment un réseau ?
   * Dans l'appli : l'état rapporté par Android. Ailleurs (ou tant qu'il n'est pas connu) :
   * navigator.onLine, qui est fiable sur le web.
   */
  function appIsOnline() {
    if (isNative() && _nativeOnline !== null) return _nativeOnline;
    return (typeof navigator === 'undefined') ? true : navigator.onLine !== false;
  }

  /**
   * appOnOnline(cb) – Rappelle `cb` au moment où le réseau REVIENT (jamais à la perte).
   * Sert à rejouer ce qui n'a pas pu être envoyé (voir la file d'attente dans js/offline.js) :
   * c'est le seul instant où l'on peut rattraper une écriture faite hors-ligne.
   */
  function appOnOnline(cb) {
    if (typeof cb === 'function') _listeners.push(cb);
  }

  function _fire() {
    _listeners.slice().forEach(function (cb) {
      try { cb(); } catch (e) { console.warn('[net] rappel de reconnexion échoué:', e.message); }
    });
  }

  function _setNative(connected) {
    var was = _nativeOnline;
    _nativeOnline = !!connected;
    if (was === false && _nativeOnline === true) {
      console.log('[net] Réseau rétabli');
      _fire();
    }
  }

  // --- Initialisation ---
  var p = plugin();
  if (isNative() && p) {
    try {
      p.getStatus()
        .then(function (s) { _nativeOnline = !!(s && s.connected); _nativeType = s && s.connectionType; })
        .catch(function (e) { console.warn('[net] état réseau initial indisponible:', e && e.message); });
      p.addListener('networkStatusChange', function (s) {
        _nativeType = s && s.connectionType;
        _setNative(s && s.connected);
      });
    } catch (e) {
      console.warn('[net] plugin réseau inutilisable, repli sur navigator.onLine:', e.message);
    }
  } else {
    // Web : les évènements du navigateur suffisent.
    try {
      window.addEventListener('online', function () { _fire(); });
    } catch (e) { /* ignore */ }
  }

  /**
   * appConnectionType() – 'wifi' | 'cellular' | 'none' | 'unknown'.
   * Sert à ne PAS déclencher un téléchargement de 74 Mo sur les données mobiles sans y avoir
   * été invité : la différence entre « pratique » et « facture surprise » tient à ce test.
   */
  function appConnectionType() {
    return _nativeType || 'unknown';
  }

  window.appIsOnline = appIsOnline;
  window.appConnectionType = appConnectionType;
  // Alias court utilisé dans les chemins critiques (offline.js, helpers.js…), où la question
  // « suis-je en ligne ? » revient à chaque lecture et à chaque écriture.
  window._netOnline = appIsOnline;
  window.appOnOnline = appOnOnline;
  window.appNetIsNative = function () { return isNative() && !!plugin(); };
})();
