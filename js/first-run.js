// ============================================================
// first-run.js — Ce qui doit être vrai dès la première ouverture
// ============================================================
//
// Une application fraîchement installée démarre vide : aucune image, et des réglages par défaut
// qui ne sont pas forcément ceux qu'on veut. Attendre que l'utilisateur découvre les bons
// boutons dans Configuration, c'est en pratique lui garantir de partir en vol sans les images.
//
// Deux choses sont donc faites UNE SEULE FOIS, à la première ouverture :
//   1. la correction immédiate est activée ;
//   2. le téléchargement des images est lancé en tâche de fond.
//
// « Une seule fois » est essentiel : ces réglages ne sont posés que s'ils n'ont JAMAIS été
// touchés. Les réappliquer à chaque démarrage reviendrait à annuler en silence un choix
// contraire de l'utilisateur — le pire défaut qu'un réglage par défaut puisse avoir.

(function () {
  'use strict';

  var DONE_KEY = 'firstRunDoneAt';
  var IMAGES_KEY = 'firstRunImagesRequestedAt';

  function isNativeApp() {
    try {
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
        return window.Capacitor.isNativePlatform();
      }
      return !!(window.Capacitor && window.Capacitor.isNative);
    } catch (e) { return false; }
  }

  // ---- 1. Réglages par défaut ----
  function applyDefaults() {
    if (localStorage.getItem(DONE_KEY)) return;
    // getItem renvoie null tant que l'utilisateur n'a jamais touché au réglage ; '0' signifie
    // qu'il l'a explicitement désactivé, et doit être respecté.
    if (localStorage.getItem('correctionImmediate') === null) {
      localStorage.setItem('correctionImmediate', '1');
      console.log('[first-run] Correction immédiate activée par défaut');
    }
    localStorage.setItem(DONE_KEY, String(Date.now()));
  }

  // ---- 2. Images ----
  /* Les planches de référence (~6 Mo) sont déjà récupérées seules par le Service Worker. Ici on
     enchaîne sur les images des questions (~74 Mo), ce qui est une tout autre affaire :
     déclencher ça sur des données mobiles sans prévenir peut coûter cher. On attend donc le
     Wi-Fi. Sur le web, où le type de connexion n'est pas connu de façon fiable, on s'abstient
     et le bouton de Configuration reste la voie normale. */
  function shouldPrefetchImages() {
    if (localStorage.getItem(IMAGES_KEY)) return false;
    if (typeof appIsOnline === 'function' && !appIsOnline()) return false;
    if (!isNativeApp()) return false;
    var type = (typeof appConnectionType === 'function') ? appConnectionType() : 'unknown';
    return type === 'wifi';
  }

  function prefetchImages() {
    if (!shouldPrefetchImages()) return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function (reg) {
      var target = navigator.serviceWorker.controller || (reg && reg.active);
      if (!target) return;
      localStorage.setItem(IMAGES_KEY, String(Date.now()));
      // Sans MessageChannel en retour : le téléchargement dure plusieurs minutes et n'a rien à
      // rapporter ici. Configuration affiche l'avancement réel quand on veut le consulter.
      target.postMessage({ type: 'downloadImages', which: 'all' });
      console.log('[first-run] Téléchargement des images lancé en tâche de fond (Wi-Fi)');
    }).catch(function () { /* pas de Service Worker : rien à lancer */ });
  }

  applyDefaults();

  // Laisser l'appli démarrer avant de saturer le réseau : les questions et la progression
  // priment largement sur des images dont on n'aura besoin qu'en vol.
  setTimeout(prefetchImages, 8000);

  // Si le premier lancement se fait en 4G, la tentative est simplement reportée au moment où
  // le Wi-Fi revient, plutôt qu'abandonnée.
  if (typeof appOnOnline === 'function') {
    appOnOnline(function () { setTimeout(prefetchImages, 3000); });
  }

  window._firstRunPrefetchImages = prefetchImages;
})();
