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
        for q in data:
            choix = q.get('choix', [])
            br = q.get('bonne_reponse', 0)
            # bonne_reponse is 0-based index in some files, 1-based in others
            # Detect: if br >= 1 and br <= len(choix), try 0-based first
            bonne_reponse_text = ''
            if choix:
                # In this project bonne_reponse is 0-based index
                if 0 <= br < len(choix):
                    bonne_reponse_text = choix[br]
                elif 1 <= br <= len(choix):
                    bonne_reponse_text = choix[br - 1]
            
            image = q.get('image', q.get('image_url', '')) or ''
            
            qs.append({
                'file': os.path.basename(f),
                'id': q.get('id', '?'),
                'question': q.get('question', ''),
                'norm': normalize(q.get('question', '')),
                'choix': choix,
                'bonne_reponse_idx': br,
                'bonne_reponse_text': bonne_reponse_text,
                'norm_reponse': normalize(bonne_reponse_text),
                'norm_choix': sorted([normalize(c) for c in choix]),
                'image': image,
            })
    return qs

def is_true_duplicate(qa, qb):
    """Check if two questions with same normalized question text are TRUE duplicates.
    Criteria: same question + same correct answer text + same choices (sorted) + same image status."""
    if qa['norm'] != qb['norm']:
        return False
    # Same correct answer?
    if qa['norm_reponse'] != qb['norm_reponse']:
        return False
    # Same set of choices?
    if qa['norm_choix'] != qb['norm_choix']:
        return False
    # Image consistency (both have or both don't; if both have, same basename)
    img_a = os.path.basename(qa['image']) if qa['image'] else ''
    img_b = os.path.basename(qb['image']) if qb['image'] else ''
    if img_a and img_b and img_a.lower() != img_b.lower():
        return False
    # If one has image and other doesn't, NOT a true duplicate
    if bool(img_a) != bool(img_b):
        return False
    return True

def same_question_diff_content(qa, qb):
    """Same question text but different answer/choices."""
    return qa['norm'] == qb['norm'] and not is_true_duplicate(qa, qb)

# =========================================================
# Load all questions
# =========================================================
autres_files = [
    'questions_procedure_radio.json',
    'questions_procedure_operationnelles.json',
    'questions_reglementation.json',
    'questions_connaissance_avion.json',
    'questions_instrumentation.json',
    'questions_masse_et_centrage.json',
    'questions_motorisation.json',
    'questions_aerodynamique.json'
]
autres_files = [f for f in autres_files if os.path.exists(f)]
easa_files = sorted(glob.glob('section_easa_*.json'))
gligli_files = sorted(glob.glob('gligli_*.json'))

autres = load_questions(autres_files)
easa = load_questions(easa_files)
gligli = load_questions(gligli_files)

print(f"AUTRES: {len(autres)} questions ({len(autres_files)} fichiers)")
print(f"EASA: {len(easa)} questions ({len(easa_files)} fichiers)")
print(f"GLIGLI: {len(gligli)} questions ({len(gligli_files)} fichiers)")
print()

# Build lookup dicts
def build_norm_dict(qs):
    d = {}
    for q in qs:
        d.setdefault(q['norm'], []).append(q)
    return d

autres_by_norm = build_norm_dict(autres)
easa_by_norm = build_norm_dict(easa)
gligli_by_norm = build_norm_dict(gligli)
all_by_norm = build_norm_dict(autres + easa + gligli)

easa_norms = set(easa_by_norm.keys())
gligli_norms = set(gligli_by_norm.keys())

# =========================================================
# 1. DOUBLONS INTERNES - VRAIS vs FAUX
# =========================================================
print("=" * 70)
print("1. DOUBLONS INTERNES (même groupe)")
print("=" * 70)

for group_name, group_by_norm, group_qs in [
    ("AUTRES", autres_by_norm, autres),
    ("EASA", easa_by_norm, easa),
    ("GLIGLI", gligli_by_norm, gligli)
]:
    norm_groups = {n: qs for n, qs in group_by_norm.items() if len(qs) > 1 and n.strip()}
    true_dupe_count = 0
    false_dupe_count = 0
    true_dupes_list = []
    false_dupes_list = []
    
    for norm, qs in norm_groups.items():
        # Compare all pairs
        # Group into clusters of true duplicates
        clusters = []
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
                true_dupes_list.append(cluster)
                true_dupe_count += len(cluster) - 1
        
        # Any remaining that matched on question but not on answer = false dupes
        # Check if the entire group has different answers
        unique_answers = set()
        for q in qs:
            unique_answers.add(q['norm_reponse'])
        if len(unique_answers) > 1:
            false_dupe_count += 1
            false_dupes_list.append(qs)
    
    print(f"\n--- {group_name} ---")
    print(f"  VRAIS doublons internes (question + réponse + choix + image identiques): {true_dupe_count} copies en trop")
    print(f"  FAUX doublons (même question, réponses différentes): {false_dupe_count} cas")
    
    if true_dupes_list:
        print(f"\n  VRAIS doublons internes {group_name} ({len(true_dupes_list)} groupes, {true_dupe_count} copies en trop):")
        for cluster in sorted(true_dupes_list, key=lambda c: -len(c)):
            q0 = cluster[0]
            print(f"    {len(cluster)}x [{q0['question'][:90]}]")
            print(f"       Réponse: {q0['bonne_reponse_text'][:80]}")
            if q0['image']:
                print(f"       Image: {q0['image']}")
            for q in cluster:
                print(f"       -> [{q['file']} Q{q['id']}]")
    
    if false_dupes_list:
        print(f"\n  FAUX doublons internes {group_name} (même question, contenu différent):")
        for qs in false_dupes_list[:10]:
            print(f"    Question: {qs[0]['question'][:90]}")
            for q in qs:
                print(f"       [{q['file']} Q{q['id']}] → Rép: {q['bonne_reponse_text'][:70]}")

print()

# =========================================================
# 2. DOUBLONS INTER-GROUPES - VRAIS vs FAUX
# =========================================================
print("=" * 70)
print("2. DOUBLONS INTER-GROUPES")
print("=" * 70)

def analyze_cross_group(group_a, group_a_name, group_b_by_norm, group_b_name):
    """Analyze cross-group duplicates with true/false distinction."""
    true_dupes = []  # (qa, qb) true duplicate pairs
    false_dupes = []  # (qa, qb_list) same question but different answers
    
    seen = set()
    for qa in group_a:
        if qa['norm'] not in group_b_by_norm:
            continue
        key = (qa['file'], qa['id'])
        if key in seen:
            continue
        seen.add(key)
        
        matches_b = group_b_by_norm[qa['norm']]
        found_true = False
        for qb in matches_b:
            if is_true_duplicate(qa, qb):
                true_dupes.append((qa, qb))
                found_true = True
                break
        if not found_true:
            false_dupes.append((qa, matches_b))
    
    return true_dupes, false_dupes

# AUTRES vs EASA
true_ae, false_ae = analyze_cross_group(autres, "AUTRES", easa_by_norm, "EASA")
# AUTRES vs GLIGLI
true_ag, false_ag = analyze_cross_group(autres, "AUTRES", gligli_by_norm, "GLIGLI")
# EASA vs GLIGLI
true_eg, false_eg = analyze_cross_group(easa, "EASA", gligli_by_norm, "GLIGLI")

print(f"\n--- AUTRES → EASA ---")
print(f"  VRAIS doublons: {len(true_ae)}")
print(f"  FAUX doublons (même question, contenu différent): {len(false_ae)}")
if true_ae:
    print(f"\n  Liste des VRAIS doublons AUTRES → EASA:")
    for qa, qb in true_ae:
        print(f"    [{qa['file']} Q{qa['id']}] = [{qb['file']} Q{qb['id']}]")
        print(f"      Q: {qa['question'][:100]}")
        print(f"      R: {qa['bonne_reponse_text'][:100]}")
if false_ae:
    print(f"\n  FAUX doublons AUTRES → EASA (même question, contenu différent):")
    for qa, matches in false_ae:
        print(f"    [{qa['file']} Q{qa['id']}]: {qa['question'][:80]}")
        print(f"      AUTRES rép: {qa['bonne_reponse_text'][:70]}")
        for qb in matches[:1]:
            print(f"      EASA   rép: {qb['bonne_reponse_text'][:70]}")

print(f"\n--- AUTRES → GLIGLI ---")
print(f"  VRAIS doublons: {len(true_ag)}")
print(f"  FAUX doublons (même question, contenu différent): {len(false_ag)}")
if true_ag:
    print(f"\n  Liste des VRAIS doublons AUTRES → GLIGLI:")
    for qa, qb in true_ag:
        print(f"    [{qa['file']} Q{qa['id']}] = [{qb['file']} Q{qb['id']}]")
        print(f"      Q: {qa['question'][:100]}")
        print(f"      R: {qa['bonne_reponse_text'][:100]}")
        if qa['image'] or qb['image']:
            print(f"      Img A: {qa['image']}  |  Img B: {qb['image']}")
if false_ag:
    print(f"\n  FAUX doublons AUTRES → GLIGLI (même question, contenu différent):")
    for qa, matches in false_ag:
        print(f"    [{qa['file']} Q{qa['id']}]: {qa['question'][:80]}")
        print(f"      AUTRES rép: {qa['bonne_reponse_text'][:70]}")
        for qb in matches[:1]:
            print(f"      GLIGLI rép: {qb['bonne_reponse_text'][:70]}")

print(f"\n--- EASA → GLIGLI ---")
print(f"  VRAIS doublons: {len(true_eg)}")
print(f"  FAUX doublons (même question, contenu différent): {len(false_eg)}")
if true_eg:
    print(f"\n  Liste des VRAIS doublons EASA → GLIGLI:")
    for qa, qb in true_eg:
        print(f"    [{qa['file']} Q{qa['id']}] = [{qb['file']} Q{qb['id']}]")
        print(f"      Q: {qa['question'][:100]}")
        print(f"      R: {qa['bonne_reponse_text'][:100]}")
if false_eg:
    print(f"\n  FAUX doublons EASA → GLIGLI (même question, contenu différent):")
    for qa, matches in false_eg:
        print(f"    [{qa['file']} Q{qa['id']}]: {qa['question'][:80]}")
        print(f"      EASA   rép: {qa['bonne_reponse_text'][:70]}")
        for qb in matches[:1]:
            print(f"      GLIGLI rép: {qb['bonne_reponse_text'][:70]}")

print()

# =========================================================
# 3. RÉSUMÉ FINAL
# =========================================================
print("=" * 70)
print("3. RÉSUMÉ FINAL - VRAIS DOUBLONS À SUPPRIMER")
print("=" * 70)

# Count true internal dupes
for group_name, group_by_norm in [("AUTRES", autres_by_norm), ("EASA", easa_by_norm), ("GLIGLI", gligli_by_norm)]:
    norm_groups = {n: qs for n, qs in group_by_norm.items() if len(qs) > 1 and n.strip()}
    true_count = 0
    for norm, qs in norm_groups.items():
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
                true_count += len(cluster) - 1
    print(f"{group_name} doublons internes vrais: {true_count} copies en trop")

print(f"AUTRES → EASA vrais doublons: {len(true_ae)}")
print(f"AUTRES → GLIGLI vrais doublons: {len(true_ag)}")
print(f"EASA → GLIGLI vrais doublons: {len(true_eg)}")
