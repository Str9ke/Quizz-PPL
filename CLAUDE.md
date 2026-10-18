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
- Le Briefing : accueil tableau de bord `briefing.html` ; les METAR Internet sont dans l'onglet `#metar` (secours si pas d'OPMET).

## Règles qui comptent
1. **Incrémenter `CACHE_NAME` dans `sw.js`** (actuellement `quiz-ppl-v221`) à chaque modification qui change le site
   ou l'APK, même si seul un workflow change. C'est ce numéro qui déclenche « mise à jour disponible » et nomme la version de l'APK
   (`tools/app_version.py`). Oubli = les utilisateurs ne reçoivent pas la mise à jour.
2. L'appli doit marcher **hors ligne en vol** : tout nouveau fichier de contenu doit être embarqué (voir `EXCLUDE_*` de
   `tools/build_www.py`) et pré-caché par `sw.js` si pertinent. `livre/*/img` est exclu de l'APK (téléchargé à la demande).
3. Ne jamais committer de clés/secrets ; `config.js` est local et ignoré (modèle : `config.example.js`).
4. Ne pas contourner un blocage réseau (faa.gov est bloqué dans l'environnement cloud).
5. Avant tout push : ne casser ni `index.html` (menu Briefing / PPL / Aviation, démarrage sur Briefing) ni les pages quiz.

## Contenu quiz
Questions : `section_easa_*.json`, `gligli_*_easy/hard.json`, `questions_*.json` (4742 questions) ; images `IMAGES_*`.
Scripts : `build_questions_easa*.py`, `check_duplicates.py`, `dedupe_questions.py`. Pages : `quiz.html`, `examen.html`,
`epreuve.html`, `stats.html`, `echecs.html`, `difficultes.html`, `historique.html`, `search.html`, `fiches.html`, `syllabus.html`,
`navlog.html`, `opmet.html`, `urgences.html` (onglets F-150L + **fiches F 172 M** : `js/urgences172.js`, PDF A5 `fiche_urgence_172M_A5.pdf` à régénérer par impression Chrome si les fiches changent ; manuels sources dans `Livres/`), `radial.html`, `plongee.html`, `urgences.html`, `symboles.html`, `configuration.html`,
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
  `fill` (case repeinte en blanc puis texte réécrit).
  Dépendances locales : pymupdf, pillow, numpy, opencv-python-headless.

## Pièges connus
- Une mise à jour d'APK signée par une autre clé → « Application non installée » (voir signature).
- L'action `setup-android` : ne pas installer le paquet SDK `tools` (retiré par Google) — `packages: 'platform-tools'`.
- Les workflows automatiques poussent sur `main` en même temps que toi : conflits → `git pull --rebase`.
- `__pycache__`, `node_modules`, `*.har`, `_ci_logs*` ne doivent pas être versionnés.

## Comment travailler
Petits changements ciblés, commit clair en français, push sur `main`, puis vérifier que les workflows Pages et Android passent
(onglet Actions). Annoncer à Thomas ce qui a changé et s'il doit réinstaller l'APK / recharger l'appli.
