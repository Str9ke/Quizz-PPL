# Résumé d'une trace GIT_TRACE2_PERF : étapes de plus de 0,15 s (profondeur, nom, durée)
function trim(s) { gsub(/^[ .]+|[ ]+$/, "", s); return s }
$4 ~ /child_start/ { m = trim($9); id = m; sub(/ .*/, "", id); sub(/.*argv:\[/, "", m); sub(/\]$/, "", m)
                     sub(/^git /, "", m); start[trim($2) id] = substr(m, 1, 40) }
$4 ~ /child_exit/ && $7 + 0 > 0.15 { m = trim($9); id = m; sub(/ .*/, "", id); printf "%s<%s>=%.2f ", trim($2), start[trim($2) id], $7 }
$4 ~ /region_leave/ && $7 + 0 > 0.15 { m = trim($9); sub(/^label:/, "", m); printf "%s:%s=%.2f ", trim($2), m, $7 }
