// ============================================================
// Service Worker — Quiz Aviation PPL — Mode Hors-Ligne
// Stratégie : Cache-First pour les assets statiques
//             Network-First pour les appels Firebase/Firestore
// ============================================================

const CACHE_NAME = 'quiz-ppl-v90a';

// Déterminer le chemin de base dynamiquement (fonctionne sur GitHub Pages et Firebase)
const SW_PATH = self.location.pathname; // ex: /Quizz-PPL/sw.js
const BASE = SW_PATH.substring(0, SW_PATH.lastIndexOf('/') + 1); // ex: /Quizz-PPL/

// Fichiers critiques à pré-cacher lors de l'installation
const PRECACHE_URLS = [
  BASE,
  BASE + 'index.html',
  BASE + 'quiz.html',
  BASE + 'stats.html',
  BASE + 'rates.html',
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
  BASE + 'symboles.html',
  BASE + 'plongee.html',
  BASE + 'historique.html',
  BASE + 'search.html',
  BASE + 'echecs.html',
  BASE + 'configuration.html',
  BASE + 'epreuve.html',
  BASE + 'navlog.html',
  BASE + 'radial.html',
  BASE + 'fiches.html',
  BASE + 'urgences.html',
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

/* precacheAll() — factorisé pour être réutilisable à l'installation ET à la demande (voir le
   message 'refreshPrecache' plus bas, déclenché par le diagnostic hors-ligne de
   configuration.html) : un fichier manquant lors d'une INSTALLATION précédente (réseau
   coupé au mauvais moment, ex. juste avant d'embarquer) restait silencieusement absent du
   cache jusqu'à la prochaine mise à jour de version — sans bouton pour retenter manuellement
   pendant qu'on est encore en ligne. cache.add() individuel (pas cache.addAll()) pour qu'un
   seul fichier en échec ne fasse pas échouer tout le lot. */
async function precacheAll() {
  const cache = await caches.open(CACHE_NAME);
  const results = await Promise.allSettled(
    PRECACHE_URLS.map(url => cache.add(url).catch(e => console.warn('[SW] Échec cache:', url, e.message)))
  );
  const ok = results.filter(r => r.status === 'fulfilled').length;
  console.log(`[SW] Pré-cache: ${ok}/${PRECACHE_URLS.length} fichiers`);
  return { ok, total: PRECACHE_URLS.length };
}

// ---- INSTALLATION : pré-cache des fichiers critiques ----
self.addEventListener('install', event => {
  console.log('[SW] Installation — pré-cache des assets');
  event.waitUntil(precacheAll().then(() => self.skipWaiting()));
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

/* fetchWithTimeout() — navigator.onLine ment très souvent en pratique (ex: Wi-Fi de bord
   d'avion "connecté" au point d'accès local mais sans aucune passerelle internet réelle) :
   les branches "network-first" ci-dessous croyaient alors être en ligne et lançaient un vrai
   fetch() SANS AUCUN TIMEOUT, qui pouvait rester bloqué de longues secondes (voire plus d'une
   minute selon le comportement du réseau captif) avant d'échouer et de retomber sur le cache
   — pendant ce temps l'appli semblait totalement figée/inutilisable. Toutes les requêtes
   "quand en ligne" passent maintenant par ce wrapper pour garantir un repli rapide sur le
   cache local dans tous les cas. */
function fetchWithTimeout(request, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(request, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

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

  // IGNORER les APIs météo et proxies CORS — toujours en réseau direct
  if (url.hostname.includes('aviationweather.gov') ||
      url.hostname.includes('metar.vatsim.net') ||
      url.hostname.includes('noaa.gov') ||
      url.hostname.includes('nws.noaa.gov') ||
      url.hostname.includes('corsproxy.io') ||
      url.hostname.includes('allorigins.win') ||
      url.hostname.includes('codetabs.com') ||
      url.hostname.includes('cors.sh') ||
      url.hostname.includes('ogimet.com') ||
      url.hostname.includes('meteo.fr') ||
      url.hostname.includes('meteo.be')) {
    return; // Ne pas intercepter
  }

  // Déterminer si c'est un fichier JSON de questions (network-first quand en ligne)
  const isJsonFile = url.pathname.endsWith('.json') && !url.pathname.endsWith('manifest.json');
  // config.js contient les clés Firebase/OpenAIP injectées à chaque déploiement :
  // s'il reste coincé en cache-first, une clé mise à jour côté secrets GitHub peut
  // rester invisible indéfiniment (carte OpenAIP qui ne s'affiche plus, etc.) — donc
  // même traitement network-first que les JSON de questions.
  const isConfigJs = url.pathname.endsWith('config.js');

  // === Stratégie pour fichiers JSON / config.js : Network-First (quand en ligne) ===
  // Garantit que les questions et la config sont toujours à jour entre navigateurs
  if ((isJsonFile || isConfigJs) && navigator.onLine) {
    event.respondWith(
      fetchWithTimeout(event.request, 3000).then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          const cleanUrl = new URL(event.request.url);
          cleanUrl.search = '';
          caches.open(CACHE_NAME).then(cache => cache.put(new Request(cleanUrl.toString()), clone));
        }
        return response;
      }).catch(() => {
        // Réseau échoué → fallback sur le cache
        return caches.match(event.request, { ignoreSearch: true }).then(cached => {
          if (cached) return cached;
          return isConfigJs
            ? new Response('', { status: 200, headers: { 'Content-Type': 'application/javascript' } })
            : new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
        });
      })
    );
    return;
  }

  // Pages HTML régénérées automatiquement toutes les ~3h par le workflow GitHub Actions
  // (NOTAMs, avis du jour, OPMET) — affichées via <iframe src="opmet.html"> etc. SANS
  // paramètre de version dans navlog.html. En cache-first classique, l'iframe affichait
  // silencieusement une donnée météo vieille de plusieurs heures tant que l'utilisateur
  // n'avait pas explicitement rechargé APRÈS qu'un premier passage en tâche de fond ait
  // rafraîchi le cache — inacceptable pour des METAR/TAF/NOTAM utilisés en préparation de
  // vol. Même traitement network-first que les JSON de questions, mais avec repli sur le
  // cache existant (pas de contenu vide) si hors-ligne.
  const isAutoFetchedWx = /\/(opmet|notams_belgique|daily_warnings)\.html$/.test(url.pathname);
  // Cartes TEMSI/WINTEM (manifest.json + PNG + PDF regénérés par le workflow toutes les
  // ~3h) : le code cliente (initTemsiCarousels) ajoute déjà un paramètre "?t=timestamp"
  // pour forcer un fetch frais après un clic sur "Relancer GitHub Action" — mais le
  // caches.match({ignoreSearch:true}) ci-dessous ignore justement ce paramètre, donc
  // cette tentative de cache-busting était neutralisée et l'utilisateur revoyait
  // indéfiniment la carte périmée même après un cycle du workflow réussi. Même
  // traitement network-first que isAutoFetchedWx.
  const isAutoFetchedTemsiWintem = /\/(temsi|wintem)_(france|euroc)[^/]*\.(png|pdf|json)$/.test(url.pathname);
  if ((isAutoFetchedWx || isAutoFetchedTemsiWintem) && navigator.onLine) {
    event.respondWith(
      fetchWithTimeout(event.request, 3000).then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          const cleanUrl = new URL(event.request.url);
          cleanUrl.search = '';
          caches.open(CACHE_NAME).then(cache => cache.put(new Request(cleanUrl.toString()), clone));
        }
        return response;
      }).catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
    return;
  }

  // === Stratégie pour les autres fichiers : Cache-First + Stale-While-Revalidate ===
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
      return fetchWithTimeout(event.request, 6000).then(response => {
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
  // Déclenché par le bouton "Forcer le téléchargement complet" du diagnostic hors-ligne
  // (configuration.html) — retente explicitement tout fichier manquant du pré-cache pendant
  // qu'on est encore en ligne, sans attendre une prochaine mise à jour de version du site.
  if (event.data === 'refreshPrecache') {
    precacheAll().then(result => {
      if (event.ports && event.ports[0]) event.ports[0].postMessage(result);
    });
  }
});
