// ============================================================
// statusbar.js — Ne pas dessiner sous la barre de statut d'Android
// ============================================================
//
// LE PROBLÈME (constaté par capture d'écran) : sur Android, l'appli dessine son contenu en
// « bord à bord », y compris SOUS la barre de statut du système (horloge, icônes réseau,
// batterie, widgets comme TAIEX). Le résultat : le bouton ☰, le résumé de score et le bandeau
// de progression se retrouvaient mélangés avec l'heure et les icônes système, illisibles.
//
// LA CAUSE : Android impose le mode « edge-to-edge » depuis Android 15 (targetSdk 35, celui de
// ce projet) — l'application ne peut plus demander à revenir à l'ancien comportement où le
// système réservait automatiquement la zone de la barre de statut. C'est désormais à l'appli de
// laisser cette place elle-même.
//
// LA SOLUTION, à deux niveaux :
//   1. Le greffon @capacitor/status-bar demande au système de ne PLUS superposer la WebView à
//      la barre de statut (setOverlaysWebView({overlay:false})) : Android redimensionne alors
//      la zone d'affichage tout seul, sans qu'aucun CSS n'ait à s'en soucier.
//   2. En complément — utile si ce greffon manque sur une version plus ancienne de l'appli, ou
//      simplement en renfort — une marge CSS basée sur env(safe-area-inset-top) est appliquée
//      aux éléments qui s'ancrent en haut de l'écran. Elle ne fait rien de mal si l'insertion
//      du greffon a déjà réglé le problème (l'insertion vaut alors 0).

(function () {
  'use strict';

  function plugin() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar) || null; }
    catch (e) { return null; }
  }

  function isNativeApp() {
    try {
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
        return window.Capacitor.isNativePlatform();
      }
      return !!(window.Capacitor && window.Capacitor.isNative);
    } catch (e) { return false; }
  }

  const p = plugin();
  if (isNativeApp() && p) {
    try {
      // overlay:false = la WebView ne dessine plus sous la barre de statut ; Android réserve
      // lui-même la place, exactement comme pour n'importe quelle appli native.
      p.setOverlaysWebView({ overlay: false }).catch(() => {});
      // Couleur de fond du thème sombre par défaut, avec des icônes système CLAIRES pour
      // rester lisibles dessus (`style: 'DARK'` dans ce greffon désigne un habillage de barre
      // sombre, donc des icônes claires — pas la couleur du texte).
      p.setBackgroundColor({ color: '#121218' }).catch(() => {});
      p.setStyle({ style: 'DARK' }).catch(() => {});
    } catch (e) {
      console.warn('[statusbar] réglage impossible:', e.message);
    }
  }
})();
