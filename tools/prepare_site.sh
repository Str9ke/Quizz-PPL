#!/usr/bin/env bash
# Prépare le dossier site/ publié sur GitHub Pages (utilisé par deploy-pages.yml ET par
# update_notams.yml, qui déploie lui-même juste après la récupération météo pour gagner
# ~45 s). Variables d'environnement attendues : FIREBASE_API_KEY, OPENAIP_API_KEY.
set -e
rm -rf site
mkdir -p site
# copy files but exclude .git, .github and local-only config.js — ainsi que les fichiers de
# travail jamais servis par le site (~200 Mo : archives mhtml des questionnaires, captures
# réseau .har, documents .docx, scripts) : envoi et déploiement nettement plus rapides, et
# les captures .har (qui peuvent contenir des données de session) ne sont plus publiées.
rsync -a --exclude='.git' --exclude='.github' --exclude='config.js' --exclude='node_modules' --exclude='site' \
  --exclude='mhtml/' --exclude='HAR METEO/' --exclude='*.har' --exclude='*.docx' --exclude='*.py' \
  ./ site/

# version.json : sert à répondre à « suis-je à jour ? » (voir js/update-check.js).
# La version vient du CACHE_NAME du Service Worker, pas du commit — la météo est
# régénérée souvent et signalerait sinon une mise à jour plusieurs fois par jour.
python3 tools/app_version.py --write
cp version.json site/version.json
APP_VERSION="$(python3 tools/app_version.py)"

# config.js depuis les secrets, écrit par Python à partir des variables d'environnement :
# aucune interprétation par le shell, une clé contenant « $ » ou des guillemets reste intacte.
APP_VERSION="$APP_VERSION" python3 - <<'PY'
import json, os
with open("site/config.js", "w", encoding="utf-8") as f:
    f.write("window.FIREBASE_CONFIG = {\n  apiKey: %s\n};\n" % json.dumps(os.environ.get("FIREBASE_API_KEY", "")))
    f.write("window.OPENAIP_API_KEY = %s;\n" % json.dumps(os.environ.get("OPENAIP_API_KEY", "")))
    f.write('window.APP_BUILD = { version: %s, channel: "web" };\n' % json.dumps(os.environ["APP_VERSION"]))
PY
