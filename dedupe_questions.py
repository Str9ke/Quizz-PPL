"""
Supprime les VRAIS doublons détectés par check_duplicates.py, en respectant :
- AUTRES : doublons internes supprimés (garde la 1ère occurrence)
- GLIGLI : doublons internes supprimés dans les fichiers thématiques référencés
  par index (ref_file/ref_index) depuis les fichiers d'épreuve — les références
  sont réécrites pour continuer à pointer vers la bonne question après suppression
- AUTRES -> GLIGLI : l'entrée AUTRES est supprimée, la copie GLIGLI est conservée
  (priorité GLIGLI > EASA > AUTRES demandée par l'utilisateur ; AUTRES<->EASA et
  EASA<->GLIGLI ont 0 vrai doublon donc aucun arbitrage nécessaire ailleurs)

Préserve le style de formatage (indentation, fin de ligne) de chaque fichier.
"""
import json, glob, re, os

def normalize(text):
    text = text.lower().strip()
    text = re.sub(r'[^\w\s]', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text

def load_questions(files):
    qs = []
    for f in files:
        with open(f, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
        for idx, q in enumerate(data):
            choix = q.get('choix', [])
            br = q.get('bonne_reponse', 0)
            bonne_reponse_text = ''
            if choix:
                if 0 <= br < len(choix):
                    bonne_reponse_text = choix[br]
                elif 1 <= br <= len(choix):
                    bonne_reponse_text = choix[br - 1]
            image = q.get('image', q.get('image_url', '')) or ''
            qs.append({
                'file': os.path.basename(f),
                'idx': idx,
                'id': q.get('id', '?'),
                'question': q.get('question', ''),
                'norm': normalize(q.get('question', '')),
                'norm_reponse': normalize(bonne_reponse_text),
                'norm_choix': sorted([normalize(c) for c in choix]),
                'image': image,
            })
    return qs

def is_true_duplicate(qa, qb):
    if qa['norm'] != qb['norm']:
        return False
    if qa['norm_reponse'] != qb['norm_reponse']:
        return False
    if qa['norm_choix'] != qb['norm_choix']:
        return False
    img_a = os.path.basename(qa['image']) if qa['image'] else ''
    img_b = os.path.basename(qb['image']) if qb['image'] else ''
    if img_a and img_b and img_a.lower() != img_b.lower():
        return False
    if bool(img_a) != bool(img_b):
        return False
    return True

def build_norm_dict(qs):
    d = {}
    for q in qs:
        d.setdefault(q['norm'], []).append(q)
    return d

def find_internal_dupe_clusters(qs_by_norm):
    """Retourne une liste de clusters (listes de q) qui sont de vrais doublons internes."""
    clusters = []
    for norm, qs in qs_by_norm.items():
        if len(qs) < 2 or not norm.strip():
            continue
        used = set()
        for i, qa in enumerate(qs):
            if i in used:
                continue
            cluster = [qa]
            used.add(i)
            for j, qb in enumerate(qs):
                if j in used:
                    continue
                if is_true_duplicate(qa, qb):
                    cluster.append(qb)
                    used.add(j)
            if len(cluster) > 1:
                clusters.append(cluster)
    return clusters

def detect_style(path):
    with open(path, 'rb') as f:
        raw = f.read()
    crlf = b'\r\n' in raw
    text = raw.decode('utf-8')
    m = re.search(r'\[\r?\n( +)"?\S', text) or re.search(r'\[\r?\n( +)\{', text)
    indent = len(m.group(1)) if m else 2
    return indent, crlf

def write_json(path, data, indent, crlf):
    text = json.dumps(data, ensure_ascii=False, indent=indent)
    text += '\n'
    if crlf:
        text = text.replace('\n', '\r\n')
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)

# =========================================================
autres_files = [
    'questions_procedure_radio.json', 'questions_procedure_operationnelles.json',
    'questions_reglementation.json', 'questions_connaissance_avion.json',
    'questions_instrumentation.json', 'questions_masse_et_centrage.json',
    'questions_motorisation.json', 'questions_aerodynamique.json'
]
autres_files = [f for f in autres_files if os.path.exists(f)]
gligli_thematic_files = sorted([
    f for f in glob.glob('gligli_*.json') if 'epreuve' not in f
])
epreuve_files = sorted(glob.glob('gligli_epreuve_*.json'))

autres = load_questions(autres_files)
gligli = load_questions(gligli_thematic_files)

autres_by_norm = build_norm_dict(autres)
gligli_by_norm = build_norm_dict(gligli)

# --- 1. AUTRES doublons internes : indices a retirer par fichier ---
autres_remove = {}  # file -> set(idx)
for cluster in find_internal_dupe_clusters(autres_by_norm):
    keep = cluster[0]
    for q in cluster[1:]:
        autres_remove.setdefault(q['file'], set()).add(q['idx'])

# --- 2. AUTRES -> GLIGLI : retirer le cote AUTRES, garder GLIGLI ---
seen_pairs = set()
for qa in autres:
    matches = gligli_by_norm.get(qa['norm'], [])
    for qb in matches:
        if is_true_duplicate(qa, qb):
            key = (qa['file'], qa['idx'])
            if key not in seen_pairs:
                seen_pairs.add(key)
                autres_remove.setdefault(qa['file'], set()).add(qa['idx'])
            break

# --- 3. GLIGLI doublons internes (fichiers thematiques) : indices a retirer + mapping ---
gligli_remove = {}  # file -> set(idx)
gligli_redirect = {}  # (file, old_idx) -> kept_old_idx   (pour les entrees supprimees)
for cluster in find_internal_dupe_clusters(gligli_by_norm):
    keep = cluster[0]
    for q in cluster[1:]:
        gligli_remove.setdefault(q['file'], set()).add(q['idx'])
        gligli_redirect[(q['file'], q['idx'])] = keep['idx']

print("AUTRES: retrait de", sum(len(v) for v in autres_remove.values()), "entrees sur", len(autres_files), "fichiers")
print("GLIGLI: retrait de", sum(len(v) for v in gligli_remove.values()), "entrees sur", len(gligli_thematic_files), "fichiers")

# =========================================================
# Reecrire les fichiers AUTRES
# =========================================================
for fname, remove_idx in autres_remove.items():
    indent, crlf = detect_style(fname)
    with open(fname, encoding='utf-8') as f:
        data = json.load(f)
    new_data = [q for i, q in enumerate(data) if i not in remove_idx]
    write_json(fname, new_data, indent, crlf)
    print(f"  {fname}: {len(data)} -> {len(new_data)}")

# =========================================================
# Reecrire les fichiers GLIGLI thematiques + calculer le mapping old_idx -> new_idx
# =========================================================
gligli_index_map = {}  # file -> {old_idx: new_idx}  (pour les entrees CONSERVEES)
for fname in gligli_thematic_files:
    with open(fname, encoding='utf-8') as f:
        data = json.load(f)
    remove_idx = gligli_remove.get(fname, set())
    mapping = {}
    new_data = []
    for i, q in enumerate(data):
        if i in remove_idx:
            continue
        mapping[i] = len(new_data)
        new_data.append(q)
    gligli_index_map[fname] = mapping
    if remove_idx:
        indent, crlf = detect_style(fname)
        write_json(fname, new_data, indent, crlf)
        print(f"  {fname}: {len(data)} -> {len(new_data)}")

# =========================================================
# Corriger les ref_index dans les fichiers d'epreuve
# =========================================================
for fname in epreuve_files:
    with open(fname, encoding='utf-8') as f:
        data = json.load(f)
    changed = False
    for entry in data:
        if not isinstance(entry, dict) or 'ref_file' not in entry:
            continue
        rf = entry['ref_file']
        ri = entry['ref_index']
        if rf not in gligli_index_map:
            continue
        # Si l'ancien index pointait vers une entree supprimee (doublon), rediriger
        # vers l'entree conservee du meme cluster.
        target_old_idx = gligli_redirect.get((rf, ri), ri)
        new_idx = gligli_index_map[rf].get(target_old_idx)
        if new_idx is None:
            print(f"  ATTENTION: {fname} ref_file={rf} ref_index={ri} introuvable apres remap !")
            continue
        if new_idx != ri:
            entry['ref_index'] = new_idx
            changed = True
    if changed:
        indent, crlf = detect_style(fname)
        write_json(fname, data, indent, crlf)
        print(f"  {fname}: ref_index corriges")

print("\nTermine.")
