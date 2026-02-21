// ============================================================
// Service Worker — Quiz Aviation PPL — Mode Hors-Ligne
// Stratégie : Cache-First pour les assets statiques
//             Network-First pour les appels Firebase/Firestore
// ============================================================

const CACHE_NAME = 'quiz-ppl-v12';

// Déterminer le chemin de base dynamiquement (fonctionne sur GitHub Pages et Firebase)
const SW_PATH = self.location.pathname; // ex: /Quizz-PPL/sw.js
const BASE = SW_PATH.substring(0, SW_PATH.lastIndexOf('/') + 1); // ex: /Quizz-PPL/

// Fichiers critiques à pré-cacher lors de l'installation
const PRECACHE_URLS = [
  BASE,
  BASE + 'index.html',
  BASE + 'quiz.html',
  BASE + 'stats.html',
  BASE + 'style.css',
  BASE + 'config.js',
  BASE + 'js/globals.js',
  BASE + 'js/helpers.js',
  BASE + 'js/categories.js',
  BASE + 'js/stats.js',
  BASE + 'js/quiz.js',
  BASE + 'js/init.js',
  BASE + 'js/offline.js',
  BASE + 'manifest.json',
  // Firebase SDK (CDN) — on les cache aussi
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js',
  // Chart.js CDN (utilisé par stats)
  'https://cdn.jsdelivr.net/npm/chart.js',
  // Fichiers de questions JSON
  BASE + 'questions_procedure_radio.json',
  BASE + 'questions_procedure_operationnelles.json',
  BASE + 'questions_reglementation.json',
  BASE + 'questions_connaissance_avion.json',
  BASE + 'questions_instrumentation.json',
  BASE + 'questions_masse_et_centrage.json',
  BASE + 'questions_motorisation.json',
  BASE + 'questions_aerodynamique.json',
  BASE + 'section_easa_procedures_new.json',
  BASE + 'section_easa_aerodynamique.json',
  BASE + 'section_easa_connaissance_avion.json',
  BASE + 'section_easa_meteorologie.json',
  BASE + 'section_easa_navigation.json',
  BASE + 'section_easa_performance_planification.json',
  BASE + 'section_easa_reglementation.json',
  BASE + 'section_easa_perf_humaines.json',
  BASE + 'gligli_communications_hard.json',
  BASE + 'gligli_communications_easy.json',
  BASE + 'gligli_connaissances_generales_aeronef_hard.json',
  BASE + 'gligli_connaissances_generales_aeronef_easy.json',
  BASE + 'gligli_epreuve_commune_hard.json',
  BASE + 'gligli_epreuve_commune_easy.json',
  BASE + 'gligli_epreuve_specifique_hard.json',
  BASE + 'gligli_epreuve_specifique_easy.json',
  BASE + 'gligli_meteorologie_hard.json',
  BASE + 'gligli_meteorologie_easy.json',
  BASE + 'gligli_navigation_hard.json',
  BASE + 'gligli_navigation_easy.json',
  BASE + 'gligli_performance_humaine_hard.json',
  BASE + 'gligli_performance_humaine_easy.json',
  BASE + 'gligli_performances_preparation_vol_hard.json',
  BASE + 'gligli_performances_preparation_vol_easy.json',
  BASE + 'gligli_principes_du_vol_hard.json',
  BASE + 'gligli_principes_du_vol_easy.json',
  BASE + 'gligli_procedures_operationnelles_hard.json',
  BASE + 'gligli_procedures_operationnelles_easy.json',
  BASE + 'gligli_reglementation_hard.json',
  BASE + 'gligli_reglementation_easy.json'
];

// ---- INSTALLATION : pré-cache des fichiers critiques ----
self.addEventListener('install', event => {
  console.log('[SW] Installation — pré-cache des assets');
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Cacher chaque fichier individuellement pour ne pas bloquer si un seul échoue
      const results = await Promise.allSettled(
        PRECACHE_URLS.map(url => cache.add(url).catch(e => console.warn('[SW] Échec cache:', url, e.message)))
      );
      const ok = results.filter(r => r.status === 'fulfilled').length;
      console.log(`[SW] Pré-cache: ${ok}/${PRECACHE_URLS.length} fichiers`);
    }).then(() => {
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
  // ignoreSearch: true → les paramètres ?v=xxx n'empêchent pas le cache hit
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(cached => {
      if (cached) {
        // Retourner le cache immédiatement
        // Stale-while-revalidate (SEULEMENT si en ligne pour éviter
        // l'accumulation de fetch échoués qui peut tuer le SW sur Android)
        if (navigator.onLine) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 5000);
          fetch(event.request, { signal: ctrl.signal }).then(response => {
            clearTimeout(timer);
            if (response && response.ok) {
              const clone = response.clone();
              // Stocker sous l'URL sans query string pour cohérence
              const cleanUrl = new URL(event.request.url);
              cleanUrl.search = '';
              caches.open(CACHE_NAME).then(cache => cache.put(new Request(cleanUrl.toString()), clone));
            }
          }).catch(() => { clearTimeout(timer); });
        }
        return cached;
      }
      // Pas en cache → aller chercher sur le réseau
      return fetch(event.request).then(response => {
        // Mettre en cache pour la prochaine fois (images, etc.)
        if (response && response.ok) {
          const clone = response.clone();
          const cleanUrl = new URL(event.request.url);
          cleanUrl.search = '';
          caches.open(CACHE_NAME).then(cache => cache.put(new Request(cleanUrl.toString()), clone));
        }
        return response;
      }).catch(() => {
        // Tout a échoué — si c'est une navigation, retourner la page demandée ou index.html
        if (event.request.mode === 'navigate') {
          // D'abord essayer de retrouver la page exacte demandée (ex: quiz.html)
          return caches.match(event.request, { ignoreSearch: true }).then(page => {
            if (page) return page;
            return caches.match(BASE + 'index.html', { ignoreSearch: true });
          });
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    }).catch(() => {
      // Sécurité : si caches.match() lui-même échoue (pression mémoire Android, etc.)
      if (event.request.mode === 'navigate') {
        return caches.match(BASE + 'index.html', { ignoreSearch: true })
          .catch(() => new Response('<h1>Hors ligne</h1><p>Rechargez la page.</p>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
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
