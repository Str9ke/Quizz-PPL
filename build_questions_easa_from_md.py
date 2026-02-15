#!/usr/bin/env python3
# coding: utf-8
"""
Convertit un .md EASA -> JSON quiz.

Usage :
  python build_questions_easa_from_md.py  in.md  out.json
"""

import re, sys, json, pathlib, textwrap

######################### helpers ##############################################


def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def norm(txt: str) -> str:
    txt = txt.strip()
    txt = re.sub(r"[ \t]+", " ", txt)
    return txt


BULLET = r"[\-\*\u2022]?\s*"          # -, *, •  (bullet facultatif)
CHOICE_RGX = r"(?i)^\s*" + BULLET + r"({lettre})[.)]\s+(.*?)(?=^\s*" + BULLET + r"[a-d][.)]\s+|$)"


def split_questions_block(md: str):
    """retourne (questions_md, reponses_md)"""
    parts = re.split(r"(?i)^\s*réponses\b.*$", md, maxsplit=1, flags=re.M)
    if len(parts) != 2:
        die("❌  Séparateur « Réponses » introuvable – ajoute une ligne 'Réponses' dans le md.")
    return parts[0], parts[1]


def parse_answer_block(ans_md: str) -> dict[int, str]:
    ans_md = ans_md.replace("\n", " ")
    ans = {}
    for m in re.finditer(r"(\d+)\s*[:\-]\s*([a-d])", ans_md, re.I):
        ans[int(m.group(1))] = m.group(2).lower()
    return ans


def extract_questions(md_q: str):
    blocs = re.split(r"^\s*\d+\s*[.)]\s+", md_q, flags=re.M)[1:]
    out = []
    for idx, bloc in enumerate(blocs, 1):
        m = re.split(r"(?i)^\s*" + BULLET + r"a[.)]\s+", bloc, maxsplit=1, flags=re.M)
        if len(m) != 2:
            print(f"⚠️  Q{idx} ignorée – choix « a » non trouvé")
            continue
        enonce_raw, choix_raw = m
        choix = []
        for lettre in "abcd":
            rgx = CHOICE_RGX.format(lettre=lettre)
            mm = re.search(rgx, choix_raw, flags=re.M | re.S)
            if mm:
                choix.append(norm(mm.group(2)))
            else:
                print(f"⚠️  Q{idx} – option « {lettre} » manquante")
                choix.append("(option manquante)")
        out.append(
            {
                "id": idx,
                "categorie": "EASA PROCÉDURES OPÉRATIONNELLES",
                "question": norm(enonce_raw),
                "choix": choix,
            }
        )
    return out


def main(src_md: str, dst_json: str):
    print(f"↻  Lecture de {src_md} …")
    md = pathlib.Path(src_md).read_text(encoding="utf-8")
    q_md, r_md = split_questions_block(md)
    questions = extract_questions(q_md)
    answers = parse_answer_block(r_md)

    kept = []
    for q in questions:
        if q["id"] not in answers:
            print(f"⚠️  Pas de réponse pour Q{q['id']}, ignorée")
            continue
        q["bonne_reponse"] = ord(answers[q["id"]]) - ord("a")
        kept.append(q)

    pathlib.Path(dst_json).write_text(
        json.dumps(kept, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"✅  {len(kept):>3} questions exportées  →  {dst_json}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        die(
            textwrap.dedent(
                """\
                Usage :
                  python build_questions_easa_from_md.py  input.md  output.json
                """
            )
        )
    main(sys.argv[1], sys.argv[2])
