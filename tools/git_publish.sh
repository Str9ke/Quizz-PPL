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
if [ "$1" = "--all" ]; then
  git add --sparse -A || exit 1          # tout ce qui a changé (filet de sécurité final)
else
  git add --sparse -- "$@" || exit 1
fi
git diff --cached --quiet && exit 0
git commit -q -m "$msg" || exit 1
tc=$(ms)
trace="${RUNNER_TEMP:-/tmp}/git_push_trace.$$"
try_push() { GIT_NO_LAZY_FETCH=$1 GIT_TRACE2_PERF="$trace" git push -q --no-thin origin HEAD:main; }
for attempt in 1 2 3 4 5; do
  # Sans téléchargement d'abord ; au moindre souci, push classique avant de conclure à un conflit
  if try_push 1 || try_push 0; then
    # Durées (ms) : commit, puis étapes du push les plus longues — pour repérer un ralentissement
    slow=$(awk -F'|' '/region_leave|child_exit/ && $7+0 > 0.15 { l=$10; gsub(/^[ .]+|[ ]+$/, "", l); sub(/ code:0$/, "", l); printf "%s=%.2f ", l, $7 }' "$trace" 2>/dev/null)
    echo "commit ${tc} ms, push $(( $(ms) - tc )) ms (essai $attempt) ${slow}"
    rm -f "$trace"
    exit 0
  fi
  rm -f "$trace"
  git fetch -q --depth=1 origin main
  git rebase -q origin/main || { git rebase --abort; sleep 1; }
done
exit 1
