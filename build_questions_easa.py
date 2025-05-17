#!/usr/bin/env python3
# build_questions_easa.py
#
# Convertit le DOCX « Questionnaire EASA procédures opérationnelles »
# vers un fichier JSON compatible avec votre quiz.

import sys, re, json, os
from pathlib import Path

try:
    import docx2txt
except ImportError:
    sys.exit("❌  Le module docx2txt n'est pas installé :  pip install docx2txt")

###############################################################################
# Config – chemins par défaut
###############################################################################
DOCX_DEFAULT  = Path("Questionnaire EASA procédures opérationnelles.docx")
JSON_DEFAULT  = Path("questions_easa_procedures_operationnelles.json")
CATEGORIE     = "PROCÉDURES OPÉRATIONNELLES (EASA)"

###############################################################################
# 1) Arguments CLI : docx_in  json_out
###############################################################################
docx_in  = Path(sys.argv[1]) if len(sys.argv) >= 2 else DOCX_DEFAULT
json_out = Path(sys.argv[2]) if len(sys.argv) >= 3 else JSON_DEFAULT

if not docx_in.exists():
    sys.exit(f"❌  Fichier DOCX introuvable : {docx_in}")

###############################################################################
# 2) Extraction brute du texte
###############################################################################
print(f"↻  Lecture de {docx_in} …")
raw_text = docx2txt.process(str(docx_in))
lines    = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]

###############################################################################
# 3) Séparation Questions / Réponses
#    On suppose que le bloc de réponses est à la fin, commence par « Réponses »
###############################################################################
answers_start = None
for i, ln in enumerate(lines):
    if re.match(r'^\s*R[ée]ponses', ln, re.I):
        answers_start = i
        break

if answers_start is None:
    sys.exit("❌  Bloc « Réponses » non trouvé dans le document.")

question_lines = lines[:answers_start]
answer_lines   = " ".join(lines[answers_start:])   # concat pour parsing simple

###############################################################################
# 4) Parsing des réponses :  "1 : c 2 : a 3 : d …"
###############################################################################
correct_dict = {}   # N° -> 'a' … 'd'

for num, letter in re.findall(r'(\d+)\s*[:\-]\s*([abcd])', answer_lines, re.I):
    correct_dict[int(num)] = letter.lower()

if not correct_dict:
    sys.exit("❌  Aucune réponse n’a été trouvée / reconnue.")

###############################################################################
# 5) Parsing des questions
###############################################################################
questions = []
idx = 0
while idx < len(question_lines):
    q_match = re.match(r'^(\d+)[\.\:]\s*(.+)', question_lines[idx])
    if not q_match:               # ligne sans n° ? -> ignore
        idx += 1
        continue

    q_num  = int(q_match.group(1))
    q_text = q_match.group(2).strip()
    idx   += 1

    # Récupère les 4 (ou +) propositions qui suivent
    choix = []
    while idx < len(question_lines):
        opt_match = re.match(r'^([a-d])[).]\s*(.+)', question_lines[idx], re.I)
        if not opt_match:
            break
        choix.append(opt_match.group(2).strip())
        idx += 1
        # si on vient de récupérer la 4ᵉ proposition -> on peut sortir,
        # mais on laisse la boucle gérer un éventuel « e. » si présent
        if len(choix) >= 4:
            pass

    if len(choix) < 2:            # question mal formée → on ignore
        continue

    # Bonne réponse
    lettre_bonne = correct_dict.get(q_num)
    if lettre_bonne is None:
        print(f"⚠️  Réponse manquante pour la question {q_num}, ignorée.")
        continue

    try:
        bonne_index = ['a','b','c','d','e','f'].index(lettre_bonne)
    except ValueError:
        print(f"⚠️  Lettre hors plage (question {q_num}) : {lettre_bonne}")
        continue
    if bonne_index >= len(choix):
        print(f"⚠️  Incohérence Q{q_num} : {lettre_bonne} hors {len(choix)} choix")
        continue

    questions.append({
        "id":          q_num,
        "categorie":   CATEGORIE,
        "question":    q_text,
        "choix":       choix,
        "bonne_reponse": bonne_index
    })

###############################################################################
# 6) Export JSON
###############################################################################
with open(json_out, "w", encoding="utf-8") as f:
    json.dump(questions, f, ensure_ascii=False, indent=2)

print(f"✅  {len(questions)} questions exportées  →  {json_out}")
