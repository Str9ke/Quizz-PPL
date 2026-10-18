// firebase-init.js — Initialisation Firebase des pages d'accueil des applications Briefing VFR et
// Bibliothèque du pilote (connexion, synchronisation). Même projet que le reste du site.
(function () {
  'use strict';
  var cfg = {
    apiKey: (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) || 'AIzaSyD8hy_cTHQZybJ5RFAzgh7DLIh15Jhwkyw',
    authDomain: 'quizaviation-b79ff.firebaseapp.com',
    projectId: 'quizaviation-b79ff',
    storageBucket: 'quizaviation-b79ff.firebasestorage.app',
    messagingSenderId: '200438765697',
    appId: '1:200438765697:web:3467cf30e905ed586e5580'
  };
  try {
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    window.auth = firebase.auth();
    window.db = firebase.firestore();
  } catch (e) { console.warn('[firebase-init] indisponible (hors ligne ?)', e); }
})();
