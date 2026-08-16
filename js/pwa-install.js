/**
 * ============================================================================
 * Installation de l'application (PWA).
 * ----------------------------------------------------------------------------
 * Deux points d'entrée pour la même mécanique :
 *  1. Un bandeau automatique, discret, qui apparaît de lui-même quand le
 *     navigateur signale que l'app est installable (Android/Chrome) — mais
 *     se souvient d'une fermeture manuelle pendant 14 jours pour ne pas
 *     harceler quelqu'un qui a déjà dit non.
 *  2. Un bouton PERMANENT dans Configuration (« Forcer l'installation »),
 *     qui ne dépend d'aucun cooldown — toujours disponible pour quelqu'un
 *     qui a fermé le bandeau puis change d'avis, ou qui préfère l'action
 *     volontaire à une bannière qui apparaît toute seule.
 *
 * IMPORTANT — ce qui est réellement "forçable" et ce qui ne l'est pas :
 * `beforeinstallprompt` (Android/Chrome) est un événement que SEUL le
 * navigateur décide de déclencher, une fois par chargement de page, une fois
 * ses propres critères d'installabilité vérifiés — aucune API web ne permet
 * de l'invoquer à la demande. Ce module capture systématiquement cet
 * événement dès qu'il arrive (qu'un bandeau soit affiché ou non) et le garde
 * en mémoire, pour que le bouton de Configuration puisse rejouer l'invite
 * native dès qu'elle est disponible. Sur iOS/Safari, cet événement n'existe
 * carrément pas : aucun bouton ne peut donc déclencher une installation
 * automatique — le bouton y affiche la marche à suivre manuelle à la place,
 * seule voie possible sur cette plateforme.
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

  // ---- État partagé, exposé pour le bouton permanent de configuration.html ----
  window._pwaDeferredPrompt = null;

  /** _pwaInstallState() – Constat de la situation actuelle, pour afficher le bon message/bouton :
   *  'standalone'  → déjà installée, rien à faire ;
   *  'ready'       → le navigateur a proposé l'installation, prête à être déclenchée ;
   *  'ios-manual'  → iOS/Safari : pas d'invite automatique possible, marche à suivre manuelle ;
   *  'pending'     → Android/Chrome mais l'événement n'est pas encore (ou pas) arrivé sur cette
   *                  page (peut prendre quelques secondes après le chargement, ou ne jamais
   *                  arriver si les critères du navigateur ne sont pas encore remplis). */
  window._pwaInstallState = function () {
    if (isStandalone()) return 'standalone';
    if (window._pwaDeferredPrompt) return 'ready';
    if (isIos() && isSafari()) return 'ios-manual';
    return 'pending';
  };

  /** _pwaTriggerInstall(callback) – Rejoue l'invite native si elle est disponible. callback
   *  reçoit ('accepted'|'dismissed'|'unavailable'). Ne fait qu'UN essai : une fois l'invite du
   *  navigateur consommée (acceptée ou refusée), elle ne peut pas être redéclenchée tant qu'un
   *  nouveau `beforeinstallprompt` n'arrive pas (nouveau chargement de page). */
  window._pwaTriggerInstall = function (callback) {
    var evt = window._pwaDeferredPrompt;
    if (!evt) { if (callback) callback('unavailable'); return; }
    window._pwaDeferredPrompt = null;
    evt.prompt();
    evt.userChoice
      .then(function (choice) { if (callback) callback(choice.outcome); })
      .catch(function () { if (callback) callback('unavailable'); });
  };

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

  if (isStandalone()) return;

  // Toujours écouter et mémoriser l'événement, MÊME si le bandeau automatique ne doit pas
  // s'afficher (fermé récemment) — sans ça, le bouton permanent de Configuration n'aurait
  // jamais rien à déclencher pour quelqu'un qui a fermé le bandeau une première fois.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window._pwaDeferredPrompt = e;
    window.dispatchEvent(new Event('pwa-install-ready'));
    if (isDismissedRecently()) return;
    buildBanner('📲 Installer Quiz PPL sur cet appareil pour l’ouvrir comme une vraie appli, même hors-ligne.', 'Installer', function (close) {
      window._pwaTriggerInstall(function () { close(); });
    });
  });

  window.addEventListener('appinstalled', function () {
    window._pwaDeferredPrompt = null;
    document.querySelectorAll('.pwa-install-banner').forEach(function (el) { el.remove(); });
    window.dispatchEvent(new Event('pwa-install-ready'));
  });

  // Pas de beforeinstallprompt sur iOS/Safari : la seule voie d'installation est manuelle.
  // Le bandeau auto respecte quand même le cooldown de fermeture (le bouton permanent de
  // configuration.html, lui, affichera toujours la marche à suivre sans cette limite).
  if (isIos() && isSafari() && !isDismissedRecently()) {
    buildBanner('📲 Sur iPhone/iPad : appuie sur Partager, puis « Sur l’écran d’accueil » pour installer l’app.', null, null);
  }
})();
