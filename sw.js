// ============================================================
// Service Worker — Quiz Aviation PPL — Mode Hors-Ligne
// Stratégie : Cache-First pour les assets statiques
//             Network-First pour les appels Firebase/Firestore
// ============================================================

const CACHE_NAME = 'quiz-ppl-v1';

// Fichiers critiques à pré-cacher lors de l'installation
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/quiz.html',
  '/stats.html',
  '/style.css',
  '/config.js',
  '/js/globals.js',
  '/js/helpers.js',
  '/js/categories.js',
  '/js/stats.js',
  '/js/quiz.js',
  '/js/init.js',
  '/js/offline.js',
  '/manifest.json',
  // Firebase SDK (CDN) — on les cache aussi
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js',
  // Chart.js CDN (utilisé par stats)
  'https://cdn.jsdelivr.net/npm/chart.js',
  // Fichiers de questions JSON
  '/questions_procedure_radio.json',
  '/questions_procedure_operationnelles.json',
  '/questions_reglementation.json',
  '/questions_connaissance_avion.json',
  '/questions_instrumentation.json',
  '/questions_masse_et_centrage.json',
  '/questions_motorisation.json',
  '/questions_aerodynamique.json',
  '/questions_easa_procedures_op.json',
  '/section_easa_procedures_new.json',
  '/section_easa_aerodynamique.json',
  '/section_easa_connaissance_avion.json',
  '/section_easa_meteorologie.json',
  '/section_easa_navigation.json',
  '/section_easa_performance_planification.json',
  '/section_easa_reglementation.json',
  '/section_easa_perf_humaines.json',
  '/gligli_communications_hard.json',
  '/gligli_communications_easy.json',
  '/gligli_connaissances_generales_aeronef_hard.json',
  '/gligli_connaissances_generales_aeronef_easy.json',
  '/gligli_epreuve_commune_hard.json',
  '/gligli_epreuve_commune_easy.json',
  '/gligli_epreuve_specifique_hard.json',
  '/gligli_epreuve_specifique_easy.json',
  '/gligli_meteorologie_hard.json',
  '/gligli_meteorologie_easy.json',
  '/gligli_navigation_hard.json',
  '/gligli_navigation_easy.json',
  '/gligli_performance_humaine_hard.json',
  '/gligli_performance_humaine_easy.json',
  '/gligli_performances_preparation_vol_hard.json',
  '/gligli_performances_preparation_vol_easy.json',
  '/gligli_principes_du_vol_hard.json',
  '/gligli_principes_du_vol_easy.json',
  '/gligli_procedures_operationnelles_hard.json',
  '/gligli_procedures_operationnelles_easy.json',
  '/gligli_reglementation_hard.json',
  '/gligli_reglementation_easy.json'
];

// ---- INSTALLATION : pré-cache des fichiers critiques ----
self.addEventListener('install', event => {
  console.log('[SW] Installation — pré-cache des assets');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => {
      // Force le SW à prendre le contrôle immédiatement
      return self.skipWaiting();
    })
  );
});

// ---- ACTIVATION : nettoyage des anciens caches ----
self.addEventListener('activate', event => {
  console.log('[SW] Activation — nettoyage anciens caches');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    }).then(() => {
      // Prend le contrôle de toutes les pages immédiatement
      return self.clients.claim();
    })
  );
});

// ---- FETCH : stratégie de cache ----
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // IGNORER les requêtes Firebase/Firestore — laisser passer en réseau direct
  // Firestore utilise firestore.googleapis.com, firebase, etc.
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebase') ||
      url.hostname.includes('identitytoolkit') ||
      url.hostname.includes('securetoken') ||
      url.hostname.includes('googleapis.com')) {
    return; // Ne pas intercepter — laisser le réseau gérer
  }

  // Pour toutes les autres requêtes : Cache-First, puis réseau en fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Retourner le cache immédiatement
        // Mais aussi mettre à jour le cache en arrière-plan (stale-while-revalidate)
        const fetchPromise = fetch(event.request).then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => {});
        return cached;
      }
      // Pas en cache → aller chercher sur le réseau
      return fetch(event.request).then(response => {
        // Mettre en cache pour la prochaine fois (images, etc.)
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Tout a échoué — si c'est une navigation, retourner la page d'accueil cachée
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

// ---- MESSAGE : forcer la mise à jour du cache ----
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  if (event.data === 'getCacheStatus') {
    caches.open(CACHE_NAME).then(cache => {
      cache.keys().then(keys => {
        event.ports[0].postMessage({ cached: keys.length });
      });
    });
  }
});
