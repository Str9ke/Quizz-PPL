#!/usr/bin/env bash
# Commit + push d'une partie des données du briefing (workflow rapide, voir _Publisher dans
# fetch_notams.py). Usage : git_publish.sh "message" fichier...  |  git_publish.sh "message" --all
#
# La copie du dépôt est PARTIELLE (sparse, sans contenu de fichiers) ; deux pièges mesurés :
#  - `git commit` (état de la copie de travail) et `git write-tree` (vérification que chaque
#    fichier présent sur le disque existe en version enregistrée) téléchargent les anciennes
#    versions des fichiers de données déjà écrits — cartes TEMSI… (1 à 2,7 s mesurées) →
#    commit « plomberie » avec write-tree --missing-ok (~0,03 s) : ces versions existent sur
#    GitHub, inutile de les rapatrier ;
#  - le push télécharge les anciennes versions des fichiers envoyés pour n'envoyer que des
#    différences (--no-thin est sans effet en HTTPS) → les petits fichiers (OPMET…) sont
#    préchargés en début de job (voir update_notams.yml).
set -u
# Jamais d'attente interactive (éditeur, identifiants) dans un workflow : un `git rebase` qui
# ouvrait un éditeur ou un push qui attendait laissait le job tourner jusqu'au délai maximal de
# GitHub (6 h). Chaque opération réseau a aussi un délai maximal.
export GIT_EDITOR=true GIT_TERMINAL_PROMPT=0 GIT_MERGE_AUTOEDIT=no
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
tree=$(git write-tree --missing-ok) || exit 1
[ "$tree" = "$(git rev-parse 'HEAD^{tree}')" ] && { rm -f "$trace"; exit 0; }   # rien de neuf
commit=$(git commit-tree "$tree" -p HEAD -m "$msg") || exit 1
git update-ref -m "commit: $msg" HEAD "$commit" || exit 1
tc=$(ms)
slow_commit=$(summary)
for attempt in 1 2 3 4 5; do
  if timeout 180 git push -q origin HEAD:main; then
    echo "commit ${tc} ms [${slow_commit}] push $(( $(ms) - tc )) ms (essai $attempt) [$(summary)]"
    exit 0
  fi
  rm -f "$trace"
  # Quelqu'un a poussé entre-temps (autre workflow de données). PAS de `git rebase` : dans cette
  # copie partielle et superficielle (depth 1, sans contenu), il rejouait tout l'historique et
  # rapatriait les ~380 Mo du dépôt fichier par fichier (job bloqué 30 min, 25/10/2026). On reprend
  # l'arbre publié tel quel et on y remet seulement NOS fichiers (les nôtres sont les plus récents).
  files=$(git diff-tree --no-commit-id --name-only -r HEAD)
  timeout 300 git fetch -q --depth=1 origin main || { sleep 2; continue; }
  git read-tree origin/main || continue
  printf '%s
' $files | git add --sparse -A --pathspec-from-file=- || continue
  tree=$(git write-tree --missing-ok) || continue
  commit=$(git commit-tree "$tree" -p origin/main -m "$msg") || continue
  git update-ref -m "commit: $msg" HEAD "$commit" || continue
  tc=$(ms)
done
exit 1
