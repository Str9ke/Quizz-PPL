#!/usr/bin/env bash
# Commit + push d'une partie des données du briefing (workflow rapide, voir _Publisher dans
# fetch_notams.py). Usage : git_publish.sh "message" fichier...  |  git_publish.sh "message" --all
#
# La copie du dépôt est PARTIELLE (sparse, sans contenu de fichiers) ; deux pièges mesurés :
#  - `git commit` calcule l'état de la copie de travail et télécharge pour cela les anciennes
#    versions des fichiers de données (~2,7 s) → commit « plomberie » (write-tree/commit-tree),
#    qui n'en a pas besoin (~0,03 s) ;
#  - le push télécharge les anciennes versions des fichiers envoyés pour n'envoyer que des
#    différences (--no-thin est sans effet en HTTPS) → les petits fichiers (OPMET…) sont
#    préchargés en début de job (voir update_notams.yml).
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
tree=$(git write-tree) || exit 1
[ "$tree" = "$(git rev-parse 'HEAD^{tree}')" ] && { rm -f "$trace"; exit 0; }   # rien de neuf
commit=$(git commit-tree "$tree" -p HEAD -m "$msg") || exit 1
git update-ref -m "commit: $msg" HEAD "$commit" || exit 1
tc=$(ms)
slow_commit=$(summary)
for attempt in 1 2 3 4 5; do
  if git push -q origin HEAD:main; then
    echo "commit ${tc} ms [${slow_commit}] push $(( $(ms) - tc )) ms (essai $attempt) [$(summary)]"
    exit 0
  fi
  rm -f "$trace"
  git fetch -q --depth=1 origin main
  git rebase -q origin/main || { git rebase --abort; sleep 1; }
done
exit 1
