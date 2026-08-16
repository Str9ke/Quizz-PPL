// ============================================================
// tts.js — Couche unique de synthèse vocale (Web Speech ↔ moteur natif Android)
// ============================================================
//
// POURQUOI : le Mode Assistance repose entièrement sur la lecture à voix haute — c'est son
// principe même, pas une option. Or dans la WebView Android de l'application, l'API Web Speech
// (`window.speechSynthesis`) est soit absente, soit présente mais SANS AUCUNE VOIX
// (`getVoices()` renvoie une liste vide). Résultat constaté dans l'APK : Mode Assistance
// totalement muet, et « TTS non supporté » affiché dans Configuration.
//
// Sur le web, `speechSynthesis` fonctionne parfaitement : il n'y a donc rien à remplacer, juste
// à choisir le bon moteur selon l'endroit où l'on tourne.
//
// Dans l'application, on passe par le moteur de synthèse vocale NATIF d'Android
// (@capacitor-community/text-to-speech), exposé à l'exécution sur `Capacitor.Plugins`. C'est
// le même moteur que celui utilisé par le système : les voix françaises installées sur le
// téléphone sont donc disponibles, sans dépendre de ce que la WebView veut bien exposer.
//
// Toutes les API sont ASYNCHRONES ici (le plugin natif renvoie des promesses) — les appelants
// n'ont pas à s'en soucier : ils appellent et n'attendent rien.

(function () {
  'use strict';

  function nativePlugin() {
    try {
      if (!window.Capacitor || !window.Capacitor.Plugins) return null;
      return window.Capacitor.Plugins.TextToSpeech || null;
    } catch (e) {
      return null;
    }
  }

  /* Détection autonome de la plateforme : ne PAS s'appuyer sur window.APP_IS_NATIVE, posé par
     js/remote-assets.js qui n'est chargé que sur navlog.html. Ce fichier-ci est chargé partout
     (quiz, configuration…) ; dépendre de cette variable aurait fait croire « web » sur toutes
     les autres pages, y compris quiz.html — donc laissé le Mode Assistance muet dans l'APK,
     précisément le défaut à corriger. */
  function isNative() {
    if (!nativePlugin()) return false;
    try {
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
        return window.Capacitor.isNativePlatform();
      }
      return !!(window.Capacitor && window.Capacitor.isNative);
    } catch (e) {
      return false;
    }
  }

  function webAvailable() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  // Suivi manuel de l'état « en train de parler » : le plugin natif expose bien isSpeaking(),
  // mais il est asynchrone, alors que les appelants (bouton 🔊 qui coupe la lecture si on
  // reclique) ont besoin d'une réponse immédiate.
  var _speaking = false;
  var _timeoutId = null;

  function stop() {
    _speaking = false;
    if (_timeoutId) { clearTimeout(_timeoutId); _timeoutId = null; }
    var p = nativePlugin();
    if (p && isNative()) {
      try { p.stop(); } catch (e) { /* rien à interrompre */ }
      return;
    }
    if (webAvailable()) {
      try { speechSynthesis.cancel(); } catch (e) { /* idem */ }
    }
  }

  /**
   * speak(text, opts) – opts : { volume 0..1, voiceName, rate, lang }
   * Ne renvoie rien d'utile : la lecture est un effet de bord, jamais une étape bloquante.
   */
  function speak(text, opts) {
    if (!text) return;
    opts = opts || {};
    var volume = (typeof opts.volume === 'number') ? opts.volume : 1;
    var rate = (typeof opts.rate === 'number') ? opts.rate : 0.95;
    var lang = opts.lang || 'fr-FR';
    var voiceName = opts.voiceName || '';

    stop();
    _speaking = true;

    var p = nativePlugin();
    if (p && isNative()) {
      var payload = {
        text: String(text),
        lang: lang,
        // Le plugin natif prend 1.0 comme vitesse normale, là où l'API Web utilise la même
        // échelle : les valeurs sont directement transposables.
        rate: rate,
        pitch: 1.0,
        volume: volume,
        // 'ambient' laisse la lecture cohabiter avec une autre source audio plutôt que de
        // l'interrompre — on révise souvent avec de la musique ou une radio en fond.
        category: 'ambient'
      };
      if (voiceName) {
        var idx = _nativeVoiceIndex(voiceName);
        if (idx >= 0) payload.voice = idx;
      }
      try {
        var r = p.speak(payload);
        if (r && typeof r.then === 'function') {
          r.then(function () { _speaking = false; })
           .catch(function (e) { _speaking = false; console.warn('[tts] Lecture native échouée:', e && e.message); });
        }
      } catch (e) {
        _speaking = false;
        console.warn('[tts] Lecture native impossible:', e.message);
      }
      return;
    }

    if (!webAvailable()) { _speaking = false; return; }

    // Court délai après cancel() : sans lui, Chrome ignore purement et simplement le speak()
    // qui suit immédiatement une annulation.
    _timeoutId = setTimeout(function () {
      _timeoutId = null;
      try {
        var utt = new SpeechSynthesisUtterance(String(text));
        utt.lang = lang;
        utt.rate = rate;
        utt.pitch = 1.0;
        utt.volume = volume;
        var voices = speechSynthesis.getVoices();
        var voice = voiceName ? voices.find(function (v) { return v.name === voiceName; }) : null;
        if (!voice) voice = voices.find(function (v) { return v.lang && v.lang.indexOf('fr') === 0; });
        if (voice) utt.voice = voice;
        utt.onend = function () { _speaking = false; };
        utt.onerror = function () { _speaking = false; };
        speechSynthesis.speak(utt);
      } catch (e) {
        _speaking = false;
        console.warn('[tts] Lecture web impossible:', e.message);
      }
    }, 100);
  }

  // Cache de la liste des voix natives : leur sélection se fait par INDICE dans le tableau
  // renvoyé par le plugin, il faut donc conserver ce tableau pour retrouver l'indice d'un nom.
  var _nativeVoices = [];

  function _nativeVoiceIndex(name) {
    for (var i = 0; i < _nativeVoices.length; i++) {
      if (_nativeVoices[i] && _nativeVoices[i].name === name) return i;
    }
    return -1;
  }

  /**
   * listVoices() – Promise<[{ name, lang, local }]>, format commun aux deux moteurs pour que
   * le sélecteur de Configuration n'ait pas à savoir lequel tourne.
   */
  function listVoices() {
    var p = nativePlugin();
    if (p && isNative()) {
      try {
        return p.getSupportedVoices().then(function (res) {
          _nativeVoices = (res && res.voices) || [];
          return _nativeVoices.map(function (v) {
            return { name: v.name || v.voiceURI || '', lang: v.lang || '', local: true };
          }).filter(function (v) { return v.name; });
        }).catch(function (e) {
          console.warn('[tts] Liste des voix natives indisponible:', e && e.message);
          return [];
        });
      } catch (e) {
        return Promise.resolve([]);
      }
    }
    if (!webAvailable()) return Promise.resolve([]);
    var voices = speechSynthesis.getVoices();
    if (!voices.length) {
      // Chrome charge les voix de façon asynchrone : au premier appel la liste est souvent
      // vide, et le seul signal fiable est l'évènement onvoiceschanged.
      return new Promise(function (resolve) {
        var done = false;
        var finish = function () {
          if (done) return;
          done = true;
          resolve(speechSynthesis.getVoices().map(_mapWebVoice));
        };
        try { speechSynthesis.onvoiceschanged = finish; } catch (e) { /* ignore */ }
        setTimeout(finish, 1500);
      });
    }
    return Promise.resolve(voices.map(_mapWebVoice));
  }

  function _mapWebVoice(v) {
    return { name: v.name, lang: v.lang || '', local: !!v.localService };
  }

  /** supported() – Y a-t-il un moteur capable de parler ici ? */
  function supported() {
    return isNative() || webAvailable();
  }

  window.appTts = {
    speak: speak,
    stop: stop,
    listVoices: listVoices,
    supported: supported,
    isNative: isNative,
    isSpeaking: function () { return _speaking; }
  };

  // Pré-chargement des voix web (Chrome les charge de façon asynchrone).
  if (!isNative() && webAvailable()) {
    try {
      speechSynthesis.getVoices();
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = function () { speechSynthesis.getVoices(); };
      }
    } catch (e) { /* ignore */ }
  }
})();
