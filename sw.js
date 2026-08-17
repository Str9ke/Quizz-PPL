// ============================================================
// Service Worker — Quiz Aviation PPL — Mode Hors-Ligne
// Stratégie : Cache-First pour les assets statiques
//             Network-First pour les appels Firebase/Firestore
// ============================================================

const CACHE_NAME = 'quiz-ppl-v128';

/* ASSETS_CACHE — cache SÉPARÉ et VOLONTAIREMENT indépendant du numéro de version, réservé aux
   images (Symboles/**, IMAGES_**). Deux raisons, toutes deux issues de pannes réelles :
     1. Le cache principal est effacé à chaque nouvelle version. Les images, elles, ne changent
        pas : les y laisser imposait un re-téléchargement de ~80 Mio à chaque déploiement — en
        pratique jamais effectué, donc images cassées hors-ligne.
     2. Les images n'étaient mises en cache qu'après un affichage EN LIGNE (stale-while-
        revalidate). Une page de référence jamais ouverte au sol — marshalling, signes de
        plongée, symboles TEMSI — n'avait donc AUCUNE image disponible en vol.
   Ce cache n'est supprimé que si on change explicitement son nom ci-dessous. */
const ASSETS_CACHE = 'quiz-ppl-assets-v1';

/* isImageAsset() — une image de l'appli (pas une carte météo régénérée toutes les 3 h, qui
   doit rester sur la stratégie network-first plus bas). */
function isImageAsset(pathname) {
  if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(pathname)) return false;
  if (/\/(skeyes_|temsi_|wintem_|daily_warnings|opmet)/.test(pathname)) return false;
  return true;
}

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
  BASE + 'js/sidebar.js',
  BASE + 'js/pwa-install.js',
  BASE + 'manifest.json',
  BASE + 'assets-manifest.json',
  BASE + 'js/localmirror.js',
  BASE + 'js/remote-assets.js',
  BASE + 'js/tts.js',
  BASE + 'js/update-check.js',
  BASE + 'js/app-update.js',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
  BASE + 'icons/icon-192-maskable.png',
  BASE + 'icons/icon-512-maskable.png',
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

/* Fichiers SANS lesquels l'appli est inutilisable hors-ligne : tant que l'un d'eux manque dans
   le nouveau cache, les anciens caches ne doivent PAS être supprimés (voir 'activate'). On
   prend ici le pré-cache AU COMPLET, y compris le SDK Firebase servi par CDN (sans lui, plus
   d'accès aux réponses stockées hors-ligne) : conserver une génération de cache en trop ne
   coûte que du stockage, alors qu'en supprimer une de trop coûte la séance de révision. */
const CRITICAL_URLS = PRECACHE_URLS;

/* missingCriticalUrls() — liste ce qui manque encore dans le cache courant. */
async function missingCriticalUrls() {
  const cache = await caches.open(CACHE_NAME);
  const missing = [];
  for (const url of CRITICAL_URLS) {
    const hit = await cache.match(url, { ignoreSearch: true });
    if (!hit) missing.push(url);
  }
  return missing;
}

// ---- INSTALLATION : pré-cache des fichiers critiques ----
self.addEventListener('install', event => {
  console.log('[SW] Installation — pré-cache des assets');
  event.waitUntil(precacheAll().then(() => self.skipWaiting()));
});

/* ---- ACTIVATION ----
   Le nettoyage des anciens caches était INCONDITIONNEL, alors que precacheAll() ci-dessus
   "réussit" toujours (chaque cache.add() en échec est avalé individuellement). Conséquence
   vécue en vol : l'appli est ouverte une dernière fois avec un réseau capricieux, le nouveau
   Service Worker s'installe, ne parvient à mettre en cache presque aucun fichier… et efface
   malgré tout l'ANCIEN cache, pourtant complet. Une fois hors-ligne, il ne restait donc plus
   rien du tout : les questions ne se chargeaient plus, alors que le site avait été ouvert
   des dizaines de fois auparavant.
   Désormais les anciens caches ne sont supprimés QUE si le nouveau contient réellement tous
   les fichiers critiques. Sinon on les conserve : `caches.match()` (global, sans nom de cache)
   utilisé partout dans le gestionnaire fetch cherche dans TOUTES les générations de cache, si
   bien qu'un cache neuf incomplet est automatiquement complété par le précédent. */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Compléter d'abord ce qui manque (utile quand l'installation s'est faite en réseau dégradé).
    await precacheAll().catch(() => {});
    const missing = await missingCriticalUrls().catch(() => ['(vérification impossible)']);
    const keys = await caches.keys();
    // ASSETS_CACHE est explicitement EXCLU du ménage : les images ne changent jamais d'une
    // version à l'autre, et jusqu'ici chaque déploiement les effaçait avec le reste. C'est
    // pourquoi TOUTES les images (symboles, marshalling, plongée, images des questions)
    // apparaissaient cassées hors-ligne : elles n'étaient mises en cache qu'après avoir été
    // affichées EN LIGNE au moins une fois, dans le cache versionné… donc supprimées au
    // déploiement suivant. Les re-télécharger à chaque version serait de toute façon absurde :
    // ~80 Mio pour des fichiers strictement identiques.
    const others = keys.filter(k => k !== CACHE_NAME && k !== ASSETS_CACHE);

    if (!missing.length) {
      await Promise.all(others.map(k => caches.delete(k)));
      console.log('[SW] Cache complet — anciens caches supprimés');
    } else {
      // Cache neuf incomplet : on GARDE le plus récent des anciens comme filet de sécurité,
      // et on supprime seulement les plus anciens pour ne pas accumuler indéfiniment.
      const versionOf = name => { const m = /v(\d+)$/.exec(name); return m ? Number(m[1]) : -1; };
      const keepAlso = others.sort((a, b) => versionOf(b) - versionOf(a))[0];
      await Promise.all(others.filter(k => k !== keepAlso).map(k => caches.delete(k)));
      self._precacheIncomplete = true;
      console.warn('[SW] Cache incomplet (' + missing.length + ' fichier(s) manquant(s)) — ancien cache "' + keepAlso + '" CONSERVÉ comme filet de sécurité');
    }
    await self.clients.claim();

    /* Images de RÉFÉRENCE (Symboles/** : marshalling, signes de plongée, symboles TEMSI et
       carte météo — ~6 Mio) téléchargées automatiquement en tâche de fond, sans bloquer
       l'activation ni attendre que l'utilisateur pense à cliquer un bouton. Ce sont des
       planches qu'on consulte précisément quand on n'a pas de réseau ; les laisser dépendre
       d'une visite préalable en ligne était la garantie de les trouver vides en vol. Les
       images des QUESTIONS (~74 Mio) restent, elles, sur demande explicite — voir le bouton
       « Télécharger les images » dans configuration.html. */
    if (navigator.onLine) {
      downloadImages('reference', null).catch(e => console.warn('[SW] Pré-chargement des images de référence:', e.message));
    }
  })());
});

/* topUpPrecacheIfNeeded() — auto-réparation : tant que le cache courant est incomplet, toute
   requête réseau réussie sert de signal "la connexion est revenue" et déclenche une nouvelle
   tentative de pré-cache (au plus une par minute). Sans ça, un cache resté incomplet le
   demeurait jusqu'à la prochaine mise à jour du site ou un clic manuel sur "Forcer le
   téléchargement complet" — c'est-à-dire, potentiellement, jusqu'après le vol. */
let _lastTopUp = 0;
function topUpPrecacheIfNeeded() {
  if (!self._precacheIncomplete) return;
  const now = Date.now();
  if (now - _lastTopUp < 60000) return;
  _lastTopUp = now;
  precacheAll()
    .then(() => missingCriticalUrls())
    .then(missing => {
      if (!missing.length) {
        self._precacheIncomplete = false;
        console.log('[SW] Cache complété automatiquement — filet de sécurité désormais inutile');
      }
    })
    .catch(() => {});
}

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

  /* Banques de questions : CACHE-FIRST (elles tombent plus bas dans le stale-while-revalidate),
     surtout PAS network-first. Ce sont des fichiers statiques qui ne changent qu'au rythme des
     déploiements : les servir depuis le cache est instantané et surtout increvable hors-ligne,
     la version fraîche étant récupérée en arrière-plan pour la navigation suivante. En
     network-first, un réseau qui ment (`navigator.onLine` vrai sur le Wi-Fi de bord d'un avion,
     sans passerelle réelle) imposait 3 s d'attente par fichier PUIS un repli sur un cache qui
     pouvait être vide — c'est ce qui a rendu les révisions totalement inaccessibles en vol. */
  const isQuestionBankJson = /\/(questions_|section_easa_|gligli_)[^/]*\.json$/.test(url.pathname);
  // config.js contient les clés Firebase/OpenAIP injectées à chaque déploiement :
  // s'il reste coincé en cache-first, une clé mise à jour côté secrets GitHub peut
  // rester invisible indéfiniment (carte OpenAIP qui ne s'affiche plus, etc.) — donc
  // même traitement network-first que les JSON de questions.
  const isConfigJs = url.pathname.endsWith('config.js');

  // Code applicatif (js/*.js) et pages HTML : la stratégie cache-first ci-dessous fait son
  // match via `caches.match(event.request, { ignoreSearch: true })` et STOCKE sous l'URL
  // débarrassée de sa query string (`cleanUrl.search = ''`, voir plus bas) — ce qui neutralise
  // COMPLÈTEMENT la convention de cache-busting `?v=YYYYMMDDx` utilisée sur tous les <script>
  // du site : bumper la version ne change rien pour le Service Worker, qui continue de
  // reconnaître "le même" fichier et sert l'ancienne copie en cache immédiatement (la version
  // fraîche n'est récupérée qu'en arrière-plan, pour la PROCHAINE visite — stale-while-
  // revalidate). Un déploiement mettait donc systématiquement un cycle de navigation complet
  // avant de réellement prendre effet chez un visiteur ayant déjà le Service Worker installé,
  // ce qui a fait passer plusieurs correctifs de cette session pour inopérants alors qu'ils
  // étaient simplement pas encore servis. Même traitement network-first que JSON/config.js.
  const isAppScript = /\/js\/[^/]+\.js$/.test(url.pathname);
  const isAppHtml = url.pathname.endsWith('.html');

  // === Stratégie pour fichiers JSON / config.js / JS applicatif / pages HTML : Network-First (quand en ligne) ===
  // Garantit que les questions, la config et le CODE sont toujours à jour entre navigateurs
  if (((isJsonFile && !isQuestionBankJson) || isConfigJs || isAppScript || isAppHtml) && navigator.onLine) {
    event.respondWith(
      fetchWithTimeout(event.request, 3000).then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          const cleanUrl = new URL(event.request.url);
          cleanUrl.search = '';
          caches.open(CACHE_NAME).then(cache => cache.put(new Request(cleanUrl.toString()), clone));
          topUpPrecacheIfNeeded();
        }
        return response;
      }).catch(() => {
        // Réseau échoué → fallback sur le cache. caches.match() SANS nom de cache parcourt
        // TOUTES les générations de cache : un cache neuf incomplet est donc complété par le
        // précédent, conservé exprès par 'activate' tant que le nouveau n'est pas complet.
        return caches.match(event.request, { ignoreSearch: true }).then(cached => {
          if (cached) return cached;
          // Navigation HTML sans copie en cache (précache manqué) : retomber sur index.html
          // plutôt qu'un placeholder vide, comme le fait la stratégie cache-first plus bas.
          if (isAppHtml) return caches.match(BASE + 'index.html', { ignoreSearch: true });
          if (isConfigJs || isAppScript) {
            return new Response('', { status: 200, headers: { 'Content-Type': 'application/javascript' } });
          }
          // Plus JAMAIS de "[]" en statut 200 pour un JSON introuvable : le client y voyait un
          // chargement RÉUSSI d'une banque vide, mémorisait ce vide dans son cache mémoire et
          // lançait un quiz sur 0 question, sans le moindre message d'erreur. Un vrai code
          // d'échec permet au client de distinguer "aucune question" de "pas pu charger".
          return new Response(JSON.stringify({ error: 'offline', url: url.pathname }), {
            status: 503, statusText: 'Offline', headers: { 'Content-Type': 'application/json' }
          });
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

  /* === Images de l'appli : CACHE-FIRST STRICT, stockage dans ASSETS_CACHE ===
     Volontairement SANS stale-while-revalidate : ces fichiers sont immuables (une image de
     question ou de symbole ne change jamais sans changer de nom), donc revalider ne sert à
     rien et ne ferait que gaspiller de la bande passante et des réveils réseau. Surtout, le
     stockage se fait dans ASSETS_CACHE et non dans le cache versionné : c'est ce qui permet
     aux images de SURVIVRE aux mises à jour de l'appli. */
  if (isImageAsset(url.pathname)) {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then(cached => {
        if (cached) return cached;
        return fetchWithTimeout(event.request, 8000).then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            const cleanUrl = new URL(event.request.url);
            cleanUrl.search = '';
            caches.open(ASSETS_CACHE).then(cache => cache.put(new Request(cleanUrl.toString()), clone));
          }
          return response;
        }).catch(() => new Response('', { status: 503, statusText: 'Offline (image)' }));
      })
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

  // Téléchargement en masse des images (bouton « Télécharger les images » de
  // configuration.html). `which` vaut 'reference' (symboles/marshalling/plongée, ~6 Mio) ou
  // 'all' (+ les images des questions, ~80 Mio au total).
  const msg = event.data;
  if (msg && typeof msg === 'object' && msg.type === 'downloadImages') {
    downloadImages(msg.which || 'reference', event.ports && event.ports[0]);
  }
  if (msg && typeof msg === 'object' && msg.type === 'imagesStatus') {
    imagesStatus().then(r => { if (event.ports && event.ports[0]) event.ports[0].postMessage(r); });
  }
});

/* loadAssetManifest() — liste des images de l'appli, générée au build par
   tools/build_assets_manifest.py et déployée avec le site. */
async function loadAssetManifest() {
  const res = await fetch(BASE + 'assets-manifest.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('manifeste des images introuvable');
  return res.json();
}

function manifestUrls(manifest, which) {
  const list = (which === 'all')
    ? [].concat(manifest.reference || [], manifest.questions || [])
    : (manifest.reference || []);
  return list.map(p => BASE + p);
}

/* imagesStatus() — combien d'images sont déjà disponibles hors-ligne. Sert à afficher un état
   honnête ("312 / 710") plutôt qu'un simple "activé/désactivé" qui ne dit rien de ce qui est
   réellement téléchargé. */
async function imagesStatus() {
  try {
    const manifest = await loadAssetManifest();
    const cache = await caches.open(ASSETS_CACHE);
    const all = manifestUrls(manifest, 'all');
    const ref = manifestUrls(manifest, 'reference');
    let okAll = 0, okRef = 0;
    for (const u of all) {
      if (await cache.match(u, { ignoreSearch: true })) {
        okAll++;
        if (ref.indexOf(u) !== -1) okRef++;
      }
    }
    return { totalAll: all.length, cachedAll: okAll, totalRef: ref.length, cachedRef: okRef };
  } catch (e) {
    return { error: e.message };
  }
}

/* downloadImages() — télécharge dans ASSETS_CACHE toutes les images manquantes, en petits lots
   séquentiels. Rapporte sa progression en continu via le port du MessageChannel : sur ~80 Mio,
   un bouton qui reste muet plusieurs minutes serait indistinguable d'un plantage. Les fichiers
   déjà présents sont sautés — relancer après une coupure reprend là où ça s'était arrêté au
   lieu de tout recommencer. */
async function downloadImages(which, port) {
  const report = m => { try { if (port) port.postMessage(m); } catch (e) { /* port fermé */ } };
  let urls;
  try {
    const manifest = await loadAssetManifest();
    urls = manifestUrls(manifest, which);
  } catch (e) {
    report({ done: true, error: 'Manifeste des images introuvable : ' + e.message });
    return;
  }

  const cache = await caches.open(ASSETS_CACHE);
  const todo = [];
  for (const u of urls) {
    if (!(await cache.match(u, { ignoreSearch: true }))) todo.push(u);
  }

  const total = urls.length;
  let done = total - todo.length;
  let failed = 0;
  report({ total, done, failed, phase: 'start' });

  const BATCH = 6;
  for (let i = 0; i < todo.length; i += BATCH) {
    if (!navigator.onLine) {
      report({ total, done, failed, finished: true, aborted: 'hors-ligne' });
      return;
    }
    const batch = todo.slice(i, i + BATCH);
    await Promise.all(batch.map(async u => {
      try {
        const res = await fetchWithTimeout(new Request(u), 20000);
        if (res && res.ok) { await cache.put(new Request(u), res.clone()); done++; }
        else failed++;
      } catch (e) { failed++; }
    }));
    report({ total, done, failed, phase: 'progress' });
  }
  report({ total, done, failed, finished: true });
}
