# Quiz PPL — guide pour reprendre le travail (à lire en premier)

Propriétaire : Thomas (str9ke). Il parle **français** : réponds toujours en français, simplement, sans jargon.
Dépôt : `Str9ke/Quizz-PPL`, branche de travail et de production : **`main`** (pas de PR sauf demande).

## Ce que c'est
- **Site** : PWA statique (HTML/JS/CSS, pas de framework ni de build) publiée par GitHub Pages depuis `main`
  (`.github/workflows/deploy-pages.yml` ; il injecte `config.js` depuis les secrets `FIREBASE_API_KEY`, `OPENAIP_API_KEY`).
- **Applis Android** : **Capacitor** (`capacitor.config.json`, appId remplacé par application au build — voir « Trois applications »). Construite par
  `.github/workflows/build-android.yml` à chaque push touchant le site : `tools/build_www.py` assemble `www/`
  (pages + questions + images embarquées dans l'APK), puis Gradle `assembleDebug`. L'APK est publié dans la
  pré-release GitHub **`android-latest`**. Il n'y a pas de dossier `android/` versionné : il est généré au build.
- **Signature** : `android-signing/debug.keystore` (versionnée exprès, voir son README) — ne JAMAIS la changer,
  sinon les mises à jour ne s'installent plus sans effacer les données.
- **Synchronisation** : Firebase/Firestore (règles `firestore.rules`, déployées par `deploy-firebase-rules.yml`).
  Progression en maps LWW : `rd` (lu), `hl` (surlignages), `gn` (temps), `nt` (notes), `pt`. Miroir local : `js/localmirror.js`.
- **Données auto** : `update_notams.yml`, `update_notams_classic.yml`, `update_openaip.yml` committent toutes seules
  NOTAM, météo (skeyes/temsi/wintem), OPMET → beaucoup de commits « Auto-update » : normal. **Toujours `git pull --rebase` avant de pousser.**

## Trois applications (depuis le 18/10/2026)
Un seul dépôt, un seul site, **trois applications** (registre : `js/apps.js`) — chacune son menu (`js/sidebar.js`, `MENUS`),
son manifeste, son logo (`icons/<app>-*.png`, sources `tools/make_logos.py`) et son APK :
| app | nom | accueil | manifeste | appId | pré-release / APK |
|---|---|---|---|---|---|
| `ppl` | Quiz PPL | `index.html` | `manifest.json` | `be.str9ke.quizzppl` (ancien appId : mise à jour par-dessus) | `android-latest` / `quiz-aviation-ppl.apk` |
| `briefing` | Briefing VFR | `briefing.html` (+ `navlog.html`, `urgences.html`) | `manifest-briefing.json` | `be.str9ke.briefingvfr` | `android-briefing` / `briefing-vfr.apk` |
| `biblio` | Bibliothèque du pilote | `bibliotheque.html` (+ `livre.html`) | `manifest-biblio.json` | `be.str9ke.bibliopilote` | `android-biblio` / `bibliotheque-pilote.apk` |
- Page d'une appli = `PAGE_APP` dans `js/apps.js` + son menu. Pages communes : `configuration.html`, `envoi-fichiers.html`
  (`?app=` ; sections filtrées par `data-apps`).
- `build-android.yml` = matrice des 3 applis ; `tools/build_www.py --app X` n'embarque que les fichiers de X (`APP_ONLY`) + le commun,
  écrit un `index.html` qui redirige vers l'accueil (Capacitor ouvre toujours index.html) et signale les liens non embarqués.
  `config.js` de l'APK contient `APP_BUILD.app`. Une seule version (`CACHE_NAME`) pour les trois.
- Chaque APK a son propre stockage : connexion par appli (`js/account.js`), transfert du stockage local via le compte
  (`js/app-transfer.js`, Firestore `quizProgress/{uid}/transfer`).
- **Mise à jour automatique** : `js/auto-update.js` (chargé par `js/apps.js`) — web : `reg.update()` + rechargement ;
  APK : lit la pré-release GitHub de l'appli (titre = version), télécharge l'APK (seul en Wi-Fi) et ouvre l'installateur.
- **METAR AéroWeb** (Météo-France, aviation.meteo.fr) : `fetch_aeroweb.py` (lancé par `fetch_notams.py`, partie « aeroweb »,
  secrets `AEROWEB_USER` / `AEROWEB_PASS`, mot de passe envoyé en MD5 comme le site) -> `opmet_aeroweb.json` (METAR, TAF long,
  PREDEC, MAA via `showmessage.php?code=`, code couleur via `ajax/ajax_trajet_get_stations.php`, SIGMET des FIR) ; onglet Météo
  « METAR AéroWeb » de `navlog.html` ; repris par l'onglet Perf (tableau de tous les décollages/atterrissages).
- **Aérodromes/pistes** : `js/aerodromes-data.js` généré par `tools/make_aerodromes.py` depuis `openaip_data.json` (caps vrais,
  TORA/LDA) ; complète et corrige `RUNWAY_DB`/`AIRPORT_*` de `navlog.html` (LFQO = Lille-Marcq, LFQL = Lens).
- **Performances (onglet Perf)** : moteur unique `AFM` / `afmCalc()` / `afmClimb()` dans `navlog.html` = tableaux EXACTS des
  manuels `Livres/Manual-de-vol-WAC-WEO.pdf` (F150M) et `Livres/Manual-de-vol-FCE.pdf` (F172M, tables par masse), avec les
  corrections propres à chaque manuel (température, vent, herbe, montée) et le vent de travers démontré (150 et 172 : 20 kt décollage / 15 kt atterrissage, relu dans les deux manuels).
  Cartes par décollage/atterrissage (`_renderPerfAllMoves`), tableaux officiels (`_renderAfmTables`).
- **Carte maille fine AéroWeb** (appli Android) : connexion native CapacitorHttp + CapacitorCookies (`capacitor.config.json`),
  identifiants sur le téléphone seulement ; bouton ← via `@capacitor/app` (`build-android.yml`).
- **Fréquences officielles** (bouton 📻 des commentaires du Navlog) : `tools/aip_freqs.py` -> `aip_freqs.json` (eAIP skeyes
  ENR 2.1 + AD 2.18 via la session anti-robot de `fetch_notams.py`, eAIP France SIA AD 2.18 du cycle AIRAC en cours), relié aux
  contours OpenAIP par le nom ; workflow `update_aip.yml` (jeudi + manuel). Bande radio 118–137 MHz seulement pour les
  communications ; balises (VOR/DME/NDB à moins de 25 NM, OpenAIP) proposées à part (indicatif + fréquence). Tous les espaces
  survolés sont proposés (traversés, au-dessus, en dessous). Changements de fréquences : `changes` dans `aip_freqs.json` +
  résumé du run GitHub Actions.
- **Noms automatiques des points** (`_renumberAutoWaypointNames`, `navlog.html`) : aérodrome proche (code OACI), sinon
  Nominatim (repère ou village, 1 requête/s, cache `navlogGeoNames`), sinon `WPn` ; un nom tapé à la main n'est jamais remplacé.
- **Calques OpenAIP de la carte de route** (menu « Calques OpenAIP », `_renderOaLayers` dans `navlog.html`) : espaces aériens
  (plancher < FL 100), aérodromes, balises VOR/NDB/DME depuis `openaip_data.json`, seuls les éléments visibles sont dessinés ;
  codes de type OpenAIP traduits dans `_openaipClassLabel` (21 vol à voile, 28 para/sport, 33 SIV, 26 CTA…).
- **Carte VFR, points VFR, obstacles, VAC** (menu « Calques OpenAIP » de la carte de route) : surcouche **open flightmaps**
  (tuiles `nwy-tiles-api.prod.newaydata.com`, cycle publié dans `vfr_data.json`, licence OFMA libre ; tuiles gardées hors ligne
  dans le cache `quiz-ppl-tiles-v1` de `sw.js`) ; `vfr_data.json` produit par `tools/fetch_vfrdata.py` (workflow `update_aip.yml`) :
  points VFR (OFMX France + Belgique), obstacles (SIA ENR 5.4 xlsx, skeyes ENR 5.4), liens VAC belges (eAIP skeyes AD 2, sinon site
  du terrain). VAC françaises : adresse fixe du SIA (`_vacLinks`, cycle AIRAC calculé). Obstacles belges = base eTOD de l'IGN belge
  (NGI, CC BY 4.0, lignes électriques comprises). **Carte OACI IGN** (SCAN OACI, WMTS `data.geopf.fr/private/wmts`, clé publique
  `ign_scan_ws`) ajoutée à la demande de Thomas (25/10/2026) en connaissance de la licence IGN (gratuite pro/associatif) : flux
  seulement, jamais de tuiles dans le dépôt ni l'APK.
- **MEF** (`tools/make_mef.py` -> `mef.json`, workflow `update_aip.yml`) : CALCULÉES par case de 30' (relief SRTM « Terrarium » +300 ft,
  obstacle +100 ft, arrondi à la centaine) ; tableau Navlog (`_mefBadge`, rouge si altitude < MEF), impression, profils, couche carte.
- **Mode « Infos au clic »** de la carte de route (`_mapIdentify`) : espaces aériens au-dessus du point (+ fréquences AIP), MEF,
  aérodromes (VAC), points VFR, obstacles, NOTAM (France + Belgique) ; la route n'est pas modifiée et ses points laissent passer le
  clic. Mode Info par défaut ; bouton Info (vert) / Nav (rose) ; chaque ligne survolée s'allume sur la carte (`_miHighlight`), un
  clic ouvre le détail. Panneau ancré à gauche (PC) ou en tiroir en bas (téléphone) : liste -> détail (zone cadrée dans la partie
  libre, ‹ › et flèches du clavier pour la suivante, « Liste » ramène la vue), un clic sur la carte ferme seulement le panneau. Bouton « Masquer la route » (`_routeHidden`).
- **Dégagements par étape** (`renderAltnPanel`, sous le Navlog) : aérodromes de `AERODROMES_DATA` à moins de 25 NM du tracé de
  l'étape, distance au tracé + distance/Rm depuis l'arrivée ; D1/D2 gardés sur le point d'arrivée (`wp._altn`) ; ceux de la dernière
  étape remplissent le FPL (`fpl_altn1/2`) et la distance « Dégagement » du devis ; ligne « Dégagements » sur la feuille imprimée.
  Feuille imprimée : départ/arrivée à l'altitude du terrain (`_adElevFor`), MEF sous l'altitude du leg.
- **Espace de travail synchronisé** : `_doAutosave` (localStorage `navlog_autosave_v1`, date = dernière VRAIE modification via
  `_wsSig`) + Firestore `quizProgress/{uid}/session/navlogWorkspace` (`_wsCloudPush`/`_wsCloudPull` : le plus récent l'emporte,
  lu à la connexion et au retour sur l'appli ; aucun envoi avant la première lecture).
- **METAR en français** : `js/metar-fr.js` (`metarFr`, `metarFrToggle`) ; bouton « 🇫🇷 METAR en français » (OPMET + AéroWeb),
  clic sur un METAR = bascule ; préférence `metarFr` dans le localStorage.
- Récupération rapide « OPMET + NOTAM » (`fetch_notams.py --opmet-only`) : OPMET skeyes + AéroWeb + NOTAM skeyes (`fetch_be_notams`) + SIA.
- Barre du haut du Navlog : « Tout récupérer » / « OPMET + NOTAM » (serveur + `refreshAllWeatherData`) / « Rafraîchir ».
- **Pays-Bas (officiel, via SIA SOFIA)** : NOTAM FIR EHAA + aérodromes (`tools/eh_aerodromes.txt`), NOTAM belges structurés (EBBU +
  `tools/eb_aerodromes.txt`) dans `notams_france.json` (champ `cc`) ; METAR/TAF néerlandais (KNMI) `fetch_opmet` -> `opmet_nl.json`
  (partie « opmet_nl », récupération complète et rapide), carte « METAR / TAF Pays-Bas » (onglet Météo). eAIP LVNL derrière Cloudflare :
  pas de copie automatique (lien seulement).
- **Fiches AIP des aérodromes** : `tools/aip_ad.py` (update_aip.yml) -> `aip_ad/<ICAO>.json` (eAIP skeyes + SIA, rubriques AD 2.2–2.4,
  2.12–2.13, 2.17–2.18, 2.20–2.23 + site de l'exploitant) ; chargées à la demande dans le panneau Infos ; clubs/sites OpenStreetMap
  cherchés par la page (Overpass, 3 km, cache 30 j `osmClubs_v1`). Panneau Infos : « VOR reçus ici » (ligne de vue radio, portée
  publiée, radial magnétique). Menu « Calques » : fonds OSM / Google plan / Google satellite / relief (`_setMapBase`).
- **Traduction** (`js/metar-fr.js`, `aeroFr`) : METAR, TAF (`tafFr`), textes abrégés OACI (`textFr` : NOTAM, GAMET, SIGMET, AIRMET, MAA)
  ; clic sur un message = bascule ; s'applique à l'OPMET (iframe), AéroWeb, Pays-Bas, NOTAM (`.frn-txt`, iframe skeyes), `.aero-tr`.
- **METAR les plus récents partout** : `_metarPool` (`_rebuildMetarPool`, `_loadMetarSources` : OPMET skeyes, AéroWeb, KNMI, Internet ;
  heure d'observation la plus récente) -> Perf (`_perfWxFor`) et `wxCache` (`_syncWxCacheFromPool`) ; `_latestTaf`.
- **NOTAM de la route** (`_routeNotams`, `_routeSamples`) : boutons carte « ⚠️ NOTAM », « 🌤️ METAR / TAF », « 🗼 Obstacles »
  (panneau latéral `_miOpenList`) ; onglet Altitudes `renderAltitudesNotams` (survol = bande sur le graphique) ; « 📍 Voir où » des
  NOTAM = fenêtre carte `_showNotamOnMap` (retour = historique). Popups de la carte : clic arrêté (`popupopen`), boutons inline via
  `window._rmClosePopup` (routeMap n'est pas global !). Tableaux legs (`_toggleRecapTable`) et dégagements (`_toggleAltn`) repliables.
- **Barre de la carte** : 2 lignes « Carte » (mode, ↶ ↷ `routeUndo/routeRedo` + Ctrl+Z/Y via `_hist`, recentrer, plein écran (barre
  visible), masquer route, étapes `_mapStageAllows` basé sur `_navStageSegs`, calques, mesure) et « Route » (panneaux `_miOpenList` :
  NOTAM, METAR/TAF, Fréquences `showRouteFreqPanel`, VOR `showRouteVorPanel`, Zones actives `showRouteActivePanel`, Obstacles = panneau
  + calque). Survol d'une ligne = repère sur le(s) profil(s) (`_profBand`, item.prof). Altitude officielle des terrains partout
  (`_adElevFor`). M&C : `fuelManual` gardé (dossier, autosave, cloud), bouton « ⛽ Devis ». Altitudes : graphique + panneau Zones/NOTAM
  (`.alt-split`). Modèles Météociel : onglets `_modelTab` à heure commune (`modelCarousel.syncTo`). Fiche aérodrome : schéma THÉORIQUE
  de tour de piste (`_drawCircuit`, sens OpenAIP `turnDirection` 0 droite/1 gauche) + note de tarif (localStorage `adFeeNotes`).
- **NOTAM belges localisés** : `_loadBeNotams()` lit `notams_belgique.html` (coordonnées, rayon, polygone) ; carte « NOTAM Belgique
  localisés » de l'onglet NOTAMs ; tout NOTAM (FR/BE) cliquable -> `_showNotamOnMap`. « Zones du jour » : avis du jour (retrouvés par
  leur nom dans OpenAIP s'ils n'ont pas de coordonnées) + NOTAM belges + NOTAM France autour de la route.
- **NOTAM France officiels** : `tools/notams_fr.py` (SIA SOFIA-Briefing, Licence Ouverte 2.0 : texte non modifié, source et date
  citées) -> `notams_france.json` (partie « notam_fr » de `fetch_notams.py`, récupérée avec le briefing) ; FIR LFFF/LFEE/LFRR
  SFC–FL115 + aérodromes de `tools/lf_aerodromes.txt` ; onglet NOTAMs, carte « NOTAM France » filtrée autour de la route.
- **Givrage carburateur** (onglet Météo, sous-onglet « 🧊 Givrage carbu », `_renderCarbIcing`/`refreshCarbIcing`) : diagramme
  T / point de rosée dessiné en SVG, zones `CI_ZONES` simplifiées (CAA Safety Sense 14, FAA SAIB CE-09-35), courbes d'HR ;
  repères : METAR officiels des terrains de la route (`_perfWxFor`) + trace 12 h (aviationweather.gov), prévision AROME
  Météo-France (Open-Meteo, `models=meteofrance_seamless`, niveaux de pression interpolés à l'altitude du leg) à l'heure de
  passage (`_ciFlightPoints`) ; dernière copie dans le localStorage `ciLast` (hors ligne).
- **Menu latéral repliable sur ordinateur** (`js/sidebar.js`, classe `body.sidebar-collapsed`, mémorisé) ; la carte de route
  prend toute la largeur disponible.
- **Dossiers du navlog** : copie complète dans IndexedDB (`navlogStore`), copie allégée dans le localStorage (`navlog_dossiers`).
- **Étapes** (source unique) : `_navStageSegs()` / `_legStageIdx()` dans `navlog.html` — utilisés par Navlog, Carbu, impression, FPL, Perf.
  `_isStageEnd(i)` : terrain de départ/arrivée d'une étape (ou son doublon au même endroit) -> les profils d'altitude y atterrissent.
- **Devis / coût** : réglages instructeur, tarifs, roulage par étape dans `getConfig().devis` (`_devisCfg`/`_devisApply`/`_devisSet`)
  -> gardés avec la route et synchronisés (avant : localStorage seul = totaux différents PC/téléphone). Un aérodrome d'étape
  (`_isFieldPoint`, `_stageBoundary`) ne peut pas devenir point de circuit (protection dans `setCircuitType`/`toggleCircuitType`) ;
  `_fixFieldCircuits` (début de `recalcNavlog`) répare les anciens cas (« circuit départ » après un point de nav = escale perdue -> `isEtape`).
  Une escale `isEtape` coupe le vol en étapes même sans `_stages` (`_computeStageSegments`).
- **Modules du Navlog hors page** (28/10/2026) : le script principal de `navlog.html` expose `window.NL` (pont : route, carte,
  outils OpenAIP/NOTAM…) + événements `nl:ready`, `nl:recalc` ; accroches `NLX.onCrosshair` (survol tracé/profil) et
  `NLX.dossierExtra` (dossier PDF consolidé). `js/nav-wx.js` : sous-onglet Météo « Météo de la route » (soleil/nuit aéronautique,
  AROME le long du tracé à l'heure de passage : base nuages, visibilité, 0 °C, averses/orages/brouillard, minima VFR ; coupe
  verticale ; meilleure altitude). `js/nav-brief.js` : encart « Points à vérifier » (onglet Navlog : terrains d'après `aip_ad/`
  — carburant AD 2.4, horaires AD 2.3, PPR —, frontières, activité militaire/BIRDTAM/para/drones des NOTAM + avis du jour, SUP AIP),
  boutons carte « 🔒 PPR » (`ppr_aerodromes.json`, `tools/fetch_ppr.py`, FR/BE/LU/NL/DE/GB) et « ✈️ Trafic » (OpenSky, natif dans
  l'APK), onglet « Pilote » (validités, 3 atterrissages/90 j, Firestore `session/pilotValidity`), check-lists F150M/F172M (textes
  des manuels, onglet Checklist). `js/nav-flight.js` : onglet « En vol » + boutons carte « Vol GPS / Plus proche / Plané » (HUD,
  écart de route, alertes d'espaces horizontales et verticales avec fréquence et voix, log en direct, minuteur réservoir, traces
  IndexedDB `nlxTracks` + GPX/KML + rejeu). APK : permissions de localisation ajoutées par `build-android.yml`.
  `tools/sup_aip.py` -> `sup_aip.json` (update_aip.yml, lundi + jeudi). AUP/UUP Eurocontrol (403) et carte AZBA (clé chiffrée) :
  liens seulement, pas de contournement. **Zones militaires activées** : bouton carte « 🎯 Militaire » (`milZones`, nav-brief.js) =
  NOTAM SIA (« ZONES AIRFORCE RTBA ACT … hhmm-hhmm », zones R/D/TSA « ACT ») + avis du jour skeyes, contours OpenAIP par désignation,
  conflit route/heure/altitude -> encart et alertes en vol. **Trafic** (`js/nav-traffic.js`, rendu type tar1090 : couleurs
  d'altitude, traînées, fiche au clic + adsbdb/planespotters) : APK = adsb.lol en natif ; web = relais Cloudflare Worker
  `tools/traffic-relay/` (workflow `deploy-traffic-relay.yml`, secrets CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID, adresse
  écrite dans `traffic_relay.json`, relais en service : `https://quizppl-trafic.thomas-delavallee.workers.dev`) ; sans relais : fenêtre d'aide
  (adresse manuelle localStorage `trafficRelay`). Trafic proche/convergent (`conflicts`, CPA relatif, heure d'horloge, voix) par rapport à
  `NLX.ownFix()` (mode vol ou bouton « 📍 Position ») ; en vol le trafic ne s'arrête pas et garde les derniers avions grisés sans réseau.
  Plané : finesse/vitesse des manuels (`glideRatio` 8.7, `glideKt` 60 F150M / 65 F172M dans MB_DATA) ; survol suivi sur la carte
  (le mode Info rend le tracé insensible). « Plus proche » sans GPS : clic sur la carte -> directs vers 5 terrains. `sw.js` ne doit JAMAIS servir Open-Meteo/OpenSky depuis le cache (ignoreSearch).
- Le Briefing : accueil tableau de bord `briefing.html` ; les METAR Internet sont dans l'onglet `#metar` (secours si pas d'OPMET).

## Règles qui comptent
1. **Incrémenter `CACHE_NAME` dans `sw.js`** (actuellement `quiz-ppl-v262`) à chaque modification qui change le site
   ou l'APK, même si seul un workflow change. C'est ce numéro qui déclenche « mise à jour disponible » et nomme la version de l'APK
   (`tools/app_version.py`). Oubli = les utilisateurs ne reçoivent pas la mise à jour.
2. L'appli doit marcher **hors ligne en vol** : tout nouveau fichier de contenu doit être embarqué (voir `EXCLUDE_*` de
   `tools/build_www.py`) et pré-caché par `sw.js` si pertinent. `livre/*/img` est exclu de l'APK (téléchargé à la demande).
3. Ne jamais committer de clés/secrets ; `config.js` est local et ignoré (modèle : `config.example.js`).
4. Ne pas contourner un blocage réseau (faa.gov est bloqué dans l'environnement cloud).
5. Avant tout push : ne casser ni `index.html` (menu Briefing / PPL / Aviation, démarrage sur Briefing) ni les pages quiz.

## Contenu quiz
Questions : `section_easa_*.json`, `gligli_*_easy/hard.json`, `questions_*.json` (4742 questions) ; images `IMAGES_*`.
Scripts : `build_questions_easa*.py`, `check_duplicates.py`, `dedupe_questions.py`.
**Banques par classe (27/10/2026, à la demande de Thomas, depuis son abonnement chezgligli.net)** : ATPL (14 modules 010…092),
PPL(H), CAEA, Drones — 15 584 questions, `qbank/<classe>_<module>.json` (id = numéro d'origine du QCM, champ `sujets` = séries)
+ `qbank/img/` (WebP), registre `js/qbank.js` ; logique `js/qbank-ui.js` : catégories `QB ATPL` (classe), `QB ATPL 010` (module),
`QB ATPL 010 :: <série>` (menu « Série » sous Catégorie) ; clé de progression = module + id ; hors « TOUTES » ; pages Échecs/
Difficultés/Historique/Recherche ajoutent les modules déjà travaillés (`_qbAnswered`). Mise à jour : dans un dossier de travail,
`GLIGLI_PHPSESSID=<cookie PHPSESSID du navigateur connecté>` puis `tools/qbank/crawl_qbank.py` (pages de correction des séries ->
raw/), `fetch_missing.py` (codes modules + questions hors série), `parse.py` (-> parsed.json), `build_qbank.py <dossier>`.
Contenu payant d'un tiers : ne jamais committer le cookie ni le HAR (`Livres/` ignoré).
Menu Catégorie : « TOUTES LES QUESTIONS PPL(A) » (inchangé, sans les banques), `TOUT` (PPL(A) + banques), `COMMENTEES`
(PPL(A) avec explication), `TOUT COMMENTEES`, et par classe `QB <classe> :: #commentees` ; page Stats : un groupe par classe. Pages : `quiz.html`, `examen.html`,
`epreuve.html`, `stats.html`, `echecs.html`, `difficultes.html`, `historique.html`, `search.html`, `fiches.html`, `syllabus.html`,
`navlog.html`, `opmet.html`, `urgences.html` (onglets F-150L + **fiches F 172 M** : `js/urgences172.js`, 5 pages de 138 × 210 mm (A5 moins 1 cm, pochettes plastiques), mise en page FIXE (`PAGES` = une page : 1 moteur, 2 incendies, 3 atterrissages, 4 électrique + moteur irrégulier, 5 givrage/vrille), PDF `fiche_urgence_172M_A5.pdf` à régénérer par impression Chrome si les fiches changent ; manuels sources dans `Livres/`), `radial.html`, `plongee.html`, `urgences.html`, `symboles.html`, `configuration.html`,
`envoi-fichiers.html` (envoi de gros fichiers, jusqu'à 300 Mo).

## Le lecteur de livres (`livre.html?b=afh|phak`)
Fichiers : `livre.html`, `livre.css`, `js/livre.js`, `js/sidebar.js`, données `livre/<id>/book.json` + `livre/<id>/img/NNN.webp`
(1600 px, WebP q78). Fonctions : 4 couleurs de surlignage (jaune renforcé), notes, progression et temps par chapitre
synchronisés, hors ligne, page originale en pleine largeur par défaut + visionneuse zoomable plein écran.
- **AFH** (FAA-H-8083-3C, vol) : déjà fait. **PHAK** (FAA-H-8083-25C, 522 p.) : **terminé**, 21 chapitres, 488 pages,
  traduction française *condensée* (annexe B = abréviations utiles au pilote seulement), glossaire A–Z inclus.
- Chaque page = termes clés surlignés (`==terme==`), résumé (`SUM:`), vocabulaire (`VOC:`), image d'origine ; chaque chapitre
  = fiche « chiffres à connaître » (`@SHEET`, `@NUMS`).
- **Chaîne de fabrication** (sources dans `tools/livre/phak/` : `tr/ch*.txt`, `build_phak.py`, `ex.py`, `render.py`) :
  `python3 build_phak.py` lit `tr/ch*.txt` et écrit `livre/phak/book.json` + copie les images depuis `src/phak_img/`
  (les PDF sources ne sont pas dans le dépôt ; branche `book-sources` = morceaux de PDF, supprimable).
  Format des fichiers : voir l'en-tête de `build_phak.py` (`@CH n`, `@PAGE ref pdf=N`, `# h2`, `## h3`, `P:`, `- `, `1. `, `FIG:`,
  `SUM: a || b`, `VOC: fr | en ;; …`). Chaque ligne non vide doit commencer par l'un de ces préfixes ; la page juste avant `@SHEET`
  doit garder ses `SUM:`/`VOC:`.

- **Figures découpées** (`livre/<id>/fig/*.webp`, `livre/<id>/figs.json`) : chaque figure du PDF est recadrée et insérée dans le
  texte (texte des images NON traduit). Chaîne : `python3 tools/livre/extract_figs.py phak Livres/<pdf>` (détecte images + dessins
  vectoriels, recadre, écrit `fig/` et `figs.json`) puis `python3 tools/livre/add_figs.py phak` (fusionne dans `book.json` :
  rattachement par numéro de figure, figures absentes de la traduction ajoutées après le paragraphe qui les cite). **Relancer
  `add_figs.py` après chaque `build_phak.py`** (qui régénère `book.json`). Les `fig/` sont embarquées dans l'APK (hors-ligne en vol).
  Les PDF sources sont dans `Livres/` (ignoré par Git) : `faa-h-8083-25c.pdf` (PHAK), `00_afh_fullvv.pdf` (AFH). PHAK : 522 images,
  AFH : 279 images, toutes insérées. Un PDF tronqué n'a plus de pages exploitables : vérifier `len(pymupdf.open(pdf))` avant de lancer.

- **Nouveaux livres (chaîne générique, oct. 2026)** — ex. `rmh` (Risk Management Handbook, FAA-H-8083-2A) :
  1. `tools/livre/<id>/config.json` (titre, groupes, chapitres, `skip` = bandeaux décoratifs à ne pas extraire) ;
  2. `python tools/livre/render.py <id> Livres/<pdf>` (pages originales) et `python tools/livre/cover.py <id> Livres/<pdf>` (couverture) ;
  3. texte : `python tools/livre/ex.py Livres/<pdf> a b` pour lire, traduire dans `tools/livre/<id>/tr/chNN.txt` (format PHAK) ;
  4. figures : `extract_figs.py <id> <pdf> --pages a-b --dump` → textes des schémas ; traduire dans `figtr_src.py` (→ `figtr.json`) ;
     `extract_figs.py ... --tr` découpe ET traduit les figures vectorielles **en place** (`figtrans.py` : même couleur, taille, graisse,
     lettres d'acronymes colorées, textes verticaux) ; puis `python tools/livre/rasterfix.py <id>` pour les figures **matricielles**
     (`raster.json` : zones en pixels, effacement par inpainting OpenCV puis texte français) — à lancer UNE fois après chaque extraction ;
  5. `python tools/livre/build_book.py <id>` puis `python tools/livre/add_figs.py <id>` ;
  6. ajouter le livre dans `bibliotheque.html` (`BOOKS`), `js/sidebar.js` (menu biblio) et `sw.js` (book.json + cover.webp).
  PDF scannés (ex. `ac6022`) : pas de figures détectables → découpe à la main (`tools/livre/<id>/crop.py`) et `raster.json` en mode
  `fill` (case repeinte en blanc puis texte réécrit). Tableaux sur plusieurs pages ou cadres mal détectés : `"manual"` dans
  `config.json` (`{"PPP": [[x0, y0, x1, y1, "n°"]]}` en points PDF, remplace la détection de la page). `raster.json` peut être
  généré par un script (`tools/livre/cap737/raster_src.py`) ; `"script": true` = écriture manuscrite (Segoe Script).
  Livres faits : afh, phak, rmh (FAA-H-8083-2A), ac6022 (AC 60-22), cap737 (CAA CAP 737, 222 p., 25 figures/tableaux).
  Figures MATRICIELLES nombreuses : `python tools/livre/ocrfig.py <id>` (OCR Windows intégré, `tools/livre/winocr.ps1`) repère
  les étiquettes dans `tools/livre/<id>/ocr.json` ; on les traduit dans `tools/livre/<id>/rastertr.py` (→ raster.json, taille
  d’origine de chaque étiquette) puis `rasterfix.py`. Légendes « Figure 1.1 » (chapitre.figure) reconnues.
  **Livre Oxford `hpl`** (Human Performance and Limitations, ATPL 040) : ŒUVRE PROTÉGÉE (reproduction interdite sans accord
  écrit de CAE Oxford) → publié dans l’appli à la demande de Thomas (19/10/2026) ; seules les sources de travail
  `tools/livre/hpl/` restent en local (`.gitignore`). Une carte de `bibliotheque.html` avec `opt: true` n’apparaît que si
  le livre est présent.
  Dépendances locales : pymupdf, pillow, numpy, opencv-python-headless.

## Pièges connus
- Une mise à jour d'APK signée par une autre clé → « Application non installée » (voir signature).
- L'action `setup-android` : ne pas installer le paquet SDK `tools` (retiré par Google) — `packages: 'platform-tools'`.
- Les workflows automatiques poussent sur `main` en même temps que toi : conflits → `git pull --rebase`.
- `__pycache__`, `node_modules`, `*.har`, `_ci_logs*` ne doivent pas être versionnés.

## Comment travailler
Petits changements ciblés, commit clair en français, push sur `main`, puis vérifier que les workflows Pages et Android passent
(onglet Actions). Annoncer à Thomas ce qui a changé et s'il doit réinstaller l'APK / recharger l'appli.
