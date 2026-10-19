// ============================================================
// auto-update.js — Mise à jour AUTOMATIQUE des trois applications
// ============================================================
//
// Chargé par js/apps.js sur toutes les pages des trois applications (Quiz PPL, Briefing VFR,
// Bibliothèque du pilote).
//
// SUR LE WEB / PWA : le service worker (sw.js) contient la version (CACHE_NAME). On lui demande
// de vérifier au démarrage puis toutes les 30 min (et au retour sur l'appli) ; une nouvelle
// version s'installe seule (skipWaiting dans sw.js) et la page se recharge d'elle-même — tout de
// suite si elle est en arrière-plan, après un court bandeau sinon.
//
// DANS L'APK ANDROID : le contenu est embarqué, seul un nouvel APK apporte la mise à jour. On lit
// la pré-release GitHub de l'application (android-latest / android-briefing / android-biblio) :
// son titre contient la version publiée (« Briefing VFR — quiz-ppl-v224 ») et elle n'existe
// qu'une fois l'APK réellement envoyé — contrairement à version.json, publié par le site parfois
// AVANT que l'APK ne soit prêt. Si elle est plus récente que la version installée :
//   - en Wi-Fi, l'APK est téléchargé tout seul en arrière-plan puis remis à l'installateur ;
//   - en données mobiles, un bandeau propose le téléchargement (≈ 100 Mo).
// Android impose de toujours confirmer l'installation (« Installer ») : c'est le seul geste
// demandé. L'APK téléchargé est gardé : si l'installation est remise à plus tard, il n'est pas
// retéléchargé au prochain démarrage.
(function () {
  'use strict';
  if (window.__autoUpdate) return;
  window.__autoUpdate = true;

  var API = 'https://api.github.com/repos/Str9ke/Quizz-PPL/releases/tags/';
  var NATIVE_EVERY_MS = 3 * 3600 * 1000;   // vérification de l'APK : au plus toutes les 3 h
  var WEB_EVERY_MS = 30 * 60 * 1000;       // service worker : toutes les 30 min
  var K_LAST = 'autoUpdLastCheck', K_FILE = 'autoUpdApk', K_LATER = 'autoUpdLater';

  function num(v) { var m = /v(\d+)\s*$/.exec(String(v || '')); return m ? +m[1] : 0; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function online() { return typeof window._netOnline === 'function' ? window._netOnline() : navigator.onLine !== false; }
  function isNative() { return typeof window.appIsNative === 'function' && window.appIsNative(); }
  function plugins() { try { return (window.Capacitor && window.Capacitor.Plugins) || {}; } catch (e) { return {}; } }

  /* ------------------------------------------------------------ bandeau */
  var bar = null;
  function banner(html, buttons) {
    if (!document.body) return;
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'autoUpdBar';
      bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom,0px));'
        + 'z-index:99999;max-width:min(92vw,460px);padding:10px 14px;border-radius:12px;background:#1e293b;color:#fff;'
        + 'font:600 14px/1.35 system-ui,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);display:flex;gap:10px;align-items:center;flex-wrap:wrap';
      document.body.appendChild(bar);
    }
    bar.innerHTML = '<span style="flex:1 1 200px">' + html + '</span>';
    (buttons || []).forEach(function (b) {
      var x = document.createElement('button');
      x.type = 'button'; x.textContent = b[0];
      x.style.cssText = 'border:0;border-radius:8px;padding:7px 12px;font-weight:700;cursor:pointer;'
        + (b[2] ? 'background:transparent;color:#cbd5e1' : 'background:#f59e0b;color:#111');
      x.onclick = b[1];
      bar.appendChild(x);
    });
  }
  function hide() { if (bar) { bar.remove(); bar = null; } }

  /* ------------------------------------------------------------ web : service worker */
  function web() {
    if (!('serviceWorker' in navigator)) return;
    var reloading = false, hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      // Premier contrôle d'une page jamais servie par le SW : rien à recharger.
      if (!hadController || reloading) { hadController = true; return; }
      reloading = true;
      if (document.hidden) { location.reload(); return; }
      banner('✨ Nouvelle version installée — rechargement…');
      setTimeout(function () { location.reload(); }, 2500);
    });
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      function check() { if (online()) reg.update().catch(function () { /* hors ligne */ }); }
      check();
      setInterval(function () { if (!document.hidden) check(); }, WEB_EVERY_MS);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
    }).catch(function () { /* ignore */ });
  }

  /* ------------------------------------------------------------ APK Android */
  function selfUpdate() {
    if (window.appSelfUpdate) return Promise.resolve(window.appSelfUpdate);
    return new Promise(function (ok) {
      var s = document.createElement('script');
      s.src = BASE + 'app-update.js';
      s.onload = function () { ok(window.appSelfUpdate || null); };
      s.onerror = function () { ok(null); };
      document.head.appendChild(s);
    });
  }

  function latestRelease() {
    var a = window.appInfo && window.appInfo();
    if (!a || !a.apk) return Promise.resolve(null);
    return fetch(API + a.apk.tag, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rel) {
        if (!rel) return null;
        var asset = (rel.assets || []).filter(function (x) { return x.name === a.apk.file && x.state === 'uploaded'; })[0];
        var version = (/(\S+-v\d+)\s*$/.exec(rel.name || '') || [])[1];
        return asset && version ? { version: version, size: asset.size, updated: asset.updated_at } : null;
      })
      .catch(function () { return null; });
  }

  function wifi() {
    var net = plugins().Network;
    if (!net || !net.getStatus) return Promise.resolve(true);   // inconnu : on suppose le Wi-Fi
    return net.getStatus().then(function (s) { return !s || s.connectionType !== 'cellular'; }).catch(function () { return true; });
  }

  function install(su, rel, file) {
    var p = plugins();
    banner('⬆ Mise à jour <b>' + rel.version.replace(/.*-/, '') + '</b> prête : confirme « Installer ».');
    return p.FileOpener.open({ filePath: file, contentType: 'application/vnd.android.package-archive' })
      .then(function () { setTimeout(hide, 4000); })
      .catch(function (e) {
        banner('⚠ Installation refusée. Autorise « Installer des applications inconnues » pour cette appli, puis réessaie.',
          [['Réessayer', function () { install(su, rel, file); }],
           su.canOpenAppSettings && su.canOpenAppSettings() ? ['Réglages', function () { su.openAppSettings(); }] : null,
           ['Plus tard', hide, 1]].filter(Boolean));
        console.warn('[auto-update]', e);
      });
  }

  function download(su, rel) {
    var p = plugins(), name = 'maj-' + rel.version + '.apk', listener = null;
    banner('⬇ Téléchargement de la mise à jour ' + rel.version.replace(/.*-/, '') + '…');
    return Promise.resolve()
      .then(function () {
        if (p.Filesystem.addListener) {
          listener = p.Filesystem.addListener('progress', function (ev) {
            if (ev && ev.contentLength) banner('⬇ Mise à jour ' + rel.version.replace(/.*-/, '') + ' : ' + Math.round(ev.bytes * 100 / ev.contentLength) + ' %');
          });
        }
        return p.Filesystem.downloadFile({ url: su.apkUrl, path: name, directory: 'CACHE', progress: true });
      })
      .then(function (res) {
        if (listener && listener.remove) listener.remove();
        var file = res && (res.path || res.uri);
        if (!file) throw new Error('fichier introuvable');
        lsSet(K_FILE, JSON.stringify({ version: rel.version, file: file, updated: rel.updated }));
        return install(su, rel, file);
      })
      .catch(function (e) {
        if (listener && listener.remove) listener.remove();
        banner('⚠ Téléchargement de la mise à jour interrompu.', [['Réessayer', function () { download(su, rel); }], ['Plus tard', hide, 1]]);
        console.warn('[auto-update]', e);
      });
  }

  function native(force) {
    var installed = window.APP_BUILD && window.APP_BUILD.version;
    if (!installed || !online()) return;
    var last = +(lsGet(K_LAST) || 0);
    if (!force && Date.now() - last < NATIVE_EVERY_MS) return;
    lsSet(K_LAST, String(Date.now()));
    selfUpdate().then(function (su) {
      if (!su || !su.canSelfUpdate()) return;
      return latestRelease().then(function (rel) {
        if (!rel || num(rel.version) <= num(installed)) return;
        var p = plugins();
        var kept = null; try { kept = JSON.parse(lsGet(K_FILE) || 'null'); } catch (e) { /* ignore */ }
        // APK déjà téléchargé pour cette version (installation remise à plus tard) : pas de 2e téléchargement.
        if (kept && kept.version === rel.version && kept.updated === rel.updated && p.Filesystem.stat) {
          return p.Filesystem.stat({ path: kept.file }).then(function () { return install(su, rel, kept.file); },
            function () { return download(su, rel); });
        }
        return wifi().then(function (w) {
          if (w) return download(su, rel);
          if (lsGet(K_LATER) === rel.version) return;
          banner('⬆ Mise à jour ' + rel.version.replace(/.*-/, '') + ' disponible (' + Math.round(rel.size / 1e6) + ' Mo). Tu es en données mobiles.',
            [['Télécharger', function () { download(su, rel); }], ['Plus tard', function () { lsSet(K_LATER, rel.version); hide(); }, 1]]);
        });
      });
    }).catch(function (e) { console.warn('[auto-update]', e); });
  }

  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/[^/]*$/, '') : 'js/';
  })();

  function start() {
    if (isNative()) {
      native(false);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) native(false); });
    } else {
      web();
    }
  }
  window.autoUpdateNow = function () { if (isNative()) native(true); else web(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else setTimeout(start, 0);
})();
