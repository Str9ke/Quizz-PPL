#!/usr/bin/env python3
# build_questions_easa.py
#
# Convertit le DOCX « Questionnaire EASA procédures opérationnelles »
# vers un fichier JSON compatible avec votre quiz.

import sys, re, json
from pathlib import Path

# 1) Fichier Markdown en entrée (obligatoire)
if len(sys.argv) < 2:
    sys.exit("Usage: build_questions_easa.py <Questionnaire EASA ...>.md [output.json]")
md_path = Path(sys.argv[1])
if not md_path.exists():
    sys.exit(f"❌  Markdown introuvable : {md_path}")

# 2) Déduire le fichier JSON de sortie
out_path = Path(sys.argv[2]) if len(sys.argv) >= 3 else \
    md_path.with_name("section_" + md_path.stem.lower().replace(" ", "_") + ".json")

# 3) Déduire la catégorie depuis le nom du fichier
#    ex: "Questionnaire EASA navigation.md" → "EASA navigation"
cat = md_path.stem
if cat.lower().startswith("questionnaire "):
    cat = cat[len("questionnaire "):]
CATEGORIE = cat.upper()

# 4) Charger et nettoyer le texte
text = md_path.read_text(encoding="utf-8")
lines = [ln.strip() for ln in text.splitlines()]

# 5) Localiser le bloc Réponses
answers_idx = next((i for i, ln in enumerate(lines)
                    if re.match(r'^\*?\s*Réponses', ln, re.I)), None)
if answers_idx is None:
    sys.exit("❌  Bloc Réponses non trouvé.")
q_lines = lines[:answers_idx]
a_block = " ".join(lines[answers_idx:])

# 6) Parser les réponses « 1 : b 2 : c … »
answers = {}
for num, let in re.findall(r'(\d+)\s*[:\-]\s*([A-Da-d])', a_block):
    answers[int(num)] = ord(let.lower()) - ord('a')

# 7) Extraire les questions et choix
questions = []
i = 0
while i < len(q_lines):
    m = re.match(r'^(\d+)\.\s*(.+)', q_lines[i])
    if not m:
        i += 1
        continue
    qid = int(m.group(1))
    qtext = m.group(2).strip()
    i += 1
    # collecter choix numérotés 1., 2., …
    choix = []
    while i < len(q_lines) and re.match(r'^\d+\.\s*', q_lines[i]):
        c = re.sub(r'^\d+\.\s*', '', q_lines[i]).strip()
        choix.append(c)
        i += 1
    # valider la réponse
    idx = answers.get(qid)
    if idx is None or idx >= len(choix):
        # ignorer si pas de réponse ou indice invalide
        continue
    questions.append({
        "id": qid,
        "categorie": CATEGORIE,
        "question": qtext,
        "choix": choix,
        "bonne_reponse": idx
    })

# 8) Écrire le JSON
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(questions, f, ensure_ascii=False, indent=2)

print(f"✅  {len(questions)} questions exportées → {out_path}")

if __name__ == "__main__":
    # Exemple d'utilisation : python build_questions_easa.py "Questionnaire EASA Aérodynamique principes du vol.md"
    # ou pour préciser le JSON de sortie :
    # python build_questions_easa.py "Questionnaire EASA Aérodynamique principes du vol.md" section_easa_aerodynamique.json
    main()
