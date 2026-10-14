#!/usr/bin/env bash
# Commit + push d'une partie des données du briefing (workflow rapide, voir _Publisher dans
# fetch_notams.py). Usage : git_publish.sh "message" fichier...  |  git_publish.sh "message" --all
# La copie du dépôt est PARTIELLE (sparse) : --sparse enregistre aussi les fichiers hors de
# la copie ; --no-thin évite que git aille rechercher les anciennes versions absentes (~20 s).
set -u
msg="$1"; shift
[ "$#" -gt 0 ] || exit 0
if [ "$1" = "--all" ]; then
  git add --sparse -A || exit 1          # tout ce qui a changé (filet de sécurité final)
else
  git add --sparse -- "$@" || exit 1
fi
git diff --cached --quiet && exit 0
git commit -q -m "$msg" || exit 1
for attempt in 1 2 3 4 5; do
  git push -q --no-thin origin HEAD:main && exit 0
  git fetch -q --depth=1 origin main
  git rebase -q origin/main || { git rebase --abort; sleep 1; }
done
exit 1
