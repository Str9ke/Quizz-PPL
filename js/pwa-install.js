/**
 * ============================================================================
 * Installation de l'application (PWA) — bouton explicite plutôt que de compter
 * uniquement sur la bannière automatique du navigateur (souvent manquée ou
 * jamais proposée si elle a été ignorée une fois).
 * ----------------------------------------------------------------------------
 * - Android/Chrome : capture l'événement `beforeinstallprompt`, affiche un
 *   petit bouton flottant "📲 Installer l'app" tant qu'il n'a pas été utilisé
 *   ni fermé. Un clic déclenche l'invite native d'installation.
 * - iOS/Safari : `beforeinstallprompt` n'existe pas sur cette plateforme — un
 *   petit rappel textuel explique la marche à suivre manuelle (Partager →
 *   Sur l'écran d'accueil) à la place, pour ne pas laisser ces utilisateurs
 *   sans aucune indication que l'app est installable.
 * - Ne s'affiche jamais si l'app tourne déjà en mode installé (standalone),
 *   et se souvient d'une fermeture manuelle pendant 14 jours pour ne pas
 *   revenir harceler quelqu'un qui a déjà dit non.
 * ============================================================================
 */
(function () {
  var DISMISS_KEY = 'pwaInstallDismissedAt';
  var DISMISS_DAYS = 14;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
      || window.navigator.standalone === true; // Safari iOS
  }
  function isDismissedRecently() {
    var ts = parseInt(localStorage.getItem(DISMISS_KEY), 10);
    if (!ts) return false;
    return (Date.now() - ts) < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  }
  function remember() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) { /* ignore */ }
  }
  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }
  function isSafari() {
    return /safari/i.test(navigator.userAgent) && !/chrome|crios|fxios/i.test(navigator.userAgent);
  }

  function buildBanner(text, actionLabel, onAction) {
    var el = document.createElement('div');
    el.className = 'pwa-install-banner';
    el.innerHTML =
      '<span class="pwa-install-text">' + text + '</span>'
      + (actionLabel ? '<button type="button" class="pwa-install-action">' + actionLabel + '</button>' : '')
      + '<button type="button" class="pwa-install-close" aria-label="Fermer">✕</button>';
    document.body.appendChild(el);
    if (actionLabel) {
      el.querySelector('.pwa-install-action').addEventListener('click', function () {
        onAction(function () { el.remove(); });
      });
    }
    el.querySelector('.pwa-install-close').addEventListener('click', function () {
      remember();
      el.remove();
    });
    return el;
  }

  if (isStandalone() || isDismissedRecently()) return;

  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    buildBanner('📲 Installer Quiz PPL sur cet appareil pour l’ouvrir comme une vraie appli, même hors-ligne.', 'Installer', function (close) {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () {
        deferredPrompt = null;
        close();
      });
    });
  });

  window.addEventListener('appinstalled', function () {
    document.querySelectorAll('.pwa-install-banner').forEach(function (el) { el.remove(); });
  });

  // Pas de beforeinstallprompt sur iOS/Safari : la seule voie d'installation est manuelle.
  if (isIos() && isSafari()) {
    buildBanner('📲 Sur iPhone/iPad : appuie sur Partager, puis « Sur l’écran d’accueil » pour installer l’app.', null, null);
  }
})();
