// ============================================================
// app-update.js — Mise à jour de l'application Android depuis l'application elle-même
// ============================================================
//
// POURQUOI : distribuée hors Play Store, l'appli ne se met jamais à jour toute seule. Jusqu'ici
// il fallait quitter l'appli, ouvrir une page GitHub, y retrouver le bon fichier parmi les
// pièces jointes, le télécharger puis l'ouvrir. Assez pénible pour être remis à plus tard —
// c'est-à-dire, en pratique, pour embarquer avec une version périmée.
//
// COMMENT : on télécharge l'APK directement (avec progression, parce qu'un bouton muet pendant
// 95 Mo est indistinguable d'un plantage), puis on le remet à l'installateur d'Android. Le
// système affiche alors sa propre confirmation d'installation : rien n'est installé dans le dos
// de l'utilisateur, et c'est très bien ainsi.
//
// La mise à jour s'installe PAR-DESSUS la version existante — la progression, le miroir local
// et les images téléchargées sont conservés. C'est ce que garantit la clé de signature fixe du
// dépôt (voir android-signing/README.md) ; sans elle Android exigerait une désinstallation
// préalable, qui effacerait justement tout cela.
//
// Hors application Android, ce module ne propose rien : sur le web la mise à jour se fait en
// rechargeant la page, et un APK n'y a aucun sens.

(function () {
  'use strict';

  var APK_URL = 'https://github.com/Str9ke/Quizz-PPL/releases/download/android-latest/quiz-aviation-ppl.apk';
  var APK_NAME = 'quiz-aviation-ppl.apk';

  function plugins() {
    try { return (window.Capacitor && window.Capacitor.Plugins) || null; }
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

  /**
   * canSelfUpdate() – Vrai seulement si TOUT ce qu'il faut est présent : on tourne bien dans
   * l'appli Android, et les deux greffons nécessaires (téléchargement, ouverture du fichier)
   * ont bien été embarqués au build. Un bouton qui promet une mise à jour puis échoue est pire
   * qu'un lien honnête vers la page de téléchargement — d'où ce test avant d'afficher quoi que
   * ce soit.
   */
  function canSelfUpdate() {
    var p = plugins();
    return !!(isNativeApp() && p && p.Filesystem && p.FileOpener);
  }

  /**
   * downloadAndInstall(onProgress) – Télécharge l'APK puis le confie à l'installateur Android.
   * onProgress reçoit { percent, receivedMb, totalMb } tant que le téléchargement dure.
   * Renvoie une promesse résolue une fois l'installateur ouvert ; rejetée avec un message
   * lisible en cas d'échec.
   */
  function downloadAndInstall(onProgress) {
    var p = plugins();
    if (!canSelfUpdate()) {
      return Promise.reject(new Error("Mise à jour intégrée indisponible sur cette version de l'application."));
    }
    if (!_netOnline()) {
      return Promise.reject(new Error('Tu es hors-ligne : connecte-toi au Wi-Fi pour télécharger la mise à jour.'));
    }

    var listener = null;
    var report = function (ev) {
      if (!onProgress || !ev) return;
      var total = ev.contentLength || 0;
      var got = ev.bytes || 0;
      onProgress({
        percent: total ? Math.round((got / total) * 100) : null,
        receivedMb: Math.round(got / 1e6),
        totalMb: total ? Math.round(total / 1e6) : null
      });
    };

    return Promise.resolve()
      .then(function () {
        if (p.Filesystem.addListener) {
          listener = p.Filesystem.addListener('progress', report);
        }
        // Cache : l'APK ne sert qu'une fois, et le système peut récupérer cet espace ensuite.
        // Pas besoin d'une permission de stockage externe pour y écrire.
        return p.Filesystem.downloadFile({
          url: APK_URL,
          path: APK_NAME,
          directory: 'CACHE',
          progress: true
        });
      })
      .then(function (res) {
        if (listener && listener.remove) { try { listener.remove(); } catch (e) { /* ignore */ } }
        var uri = res && (res.path || res.uri);
        if (!uri) throw new Error('Téléchargement terminé mais fichier introuvable.');
        // Remise à l'installateur du système : c'est Android qui demande confirmation et
        // installe, jamais l'appli elle-même.
        return p.FileOpener.open({
          filePath: uri,
          contentType: 'application/vnd.android.package-archive'
        });
      })
      .catch(function (e) {
        if (listener && listener.remove) { try { listener.remove(); } catch (e2) { /* ignore */ } }
        var msg = (e && e.message) || String(e);
        // Cas le plus fréquent en pratique : l'autorisation « installer des applications
        // inconnues » n'a pas encore été accordée à cette appli. Le message système est
        // souvent obscur, autant dire précisément quoi faire.
        if (/install|package|permission/i.test(msg)) {
          msg += "\n\nSi Android a refusé, autorise « Installer des applications inconnues » " +
                 "pour cette application dans les réglages du téléphone, puis réessaie.";
        }
        throw new Error(msg);
      });
  }

  /**
   * openAppSettings() – Ouvre la fiche système de l'application.
   *
   * C'est de là que se fait la DÉSINSTALLATION. Android interdit à une application de se
   * supprimer elle-même : au mieux elle peut amener l'utilisateur à l'écran système qui le
   * permet, et c'est exactement ce que fait ce bouton — il ne désinstalle rien de lui-même,
   * il conduit à l'endroit où la décision se prend. Cette même fiche sert aussi à accorder
   * l'autorisation « installer des applications inconnues » quand une mise à jour est refusée.
   */
  function openAppSettings() {
    var p = plugins();
    if (!isNativeApp() || !p || !p.NativeSettings) {
      return Promise.reject(new Error("Disponible uniquement dans l'application Android."));
    }
    return p.NativeSettings.openAndroid({ option: 'application_details' });
  }

  function canOpenAppSettings() {
    var p = plugins();
    return !!(isNativeApp() && p && p.NativeSettings);
  }

  window.appSelfUpdate = {
    canSelfUpdate: canSelfUpdate,
    isNativeApp: isNativeApp,
    downloadAndInstall: downloadAndInstall,
    openAppSettings: openAppSettings,
    canOpenAppSettings: canOpenAppSettings,
    apkUrl: APK_URL
  };
})();
