#!/usr/bin/env bash
# Commit + push d'une partie des données du briefing (workflow rapide, voir _Publisher dans
# fetch_notams.py). Usage : git_publish.sh "message" fichier...  |  git_publish.sh "message" --all
# La copie du dépôt est PARTIELLE (sparse, sans contenu de fichiers) : --sparse enregistre
# aussi les fichiers hors de la copie. Au push, git voudrait télécharger les anciennes versions
# des fichiers modifiés pour n'envoyer que des différences (des Mo d'images : ~20 s) —
# GIT_NO_LAZY_FETCH l'en empêche, il envoie alors les fichiers entiers (rapide, déjà compressés).
set -u
msg="$1"; shift
[ "$#" -gt 0 ] || exit 0
t0=$(date +%s%N)
ms() { echo $(( ($(date +%s%N) - t0) / 1000000 )); }
# Durées détaillées (trace git) des étapes de plus de 0,15 s — pour repérer un ralentissement
trace="${RUNNER_TEMP:-/tmp}/git_publish_trace.$$"
export GIT_TRACE2_PERF="$trace"
summary() {
  awk -F'|' -f "$(dirname "$0")/git_trace_summary.awk" "$trace" 2>/dev/null
  rm -f "$trace"
}
if [ "$1" = "--all" ]; then
  git add --sparse -A || exit 1          # tout ce qui a changé (filet de sécurité final)
else
  git add --sparse -- "$@" || exit 1
fi
git diff --cached --quiet && exit 0
git commit -q -m "$msg" || exit 1
tc=$(ms)
slow_commit=$(summary)
try_push() { GIT_NO_LAZY_FETCH=$1 git push -q --no-thin origin HEAD:main; }
for attempt in 1 2 3 4 5; do
  # Sans téléchargement d'abord ; au moindre souci, push classique avant de conclure à un conflit
  if try_push 1 || try_push 0; then
    echo "commit ${tc} ms [${slow_commit}] push $(( $(ms) - tc )) ms (essai $attempt) [$(summary)]"
    exit 0
  fi
  rm -f "$trace"
  git fetch -q --depth=1 origin main
  git rebase -q origin/main || { git rebase --abort; sleep 1; }
done
exit 1
