#!/usr/bin/env python3
"""Génère assets-manifest.json — la liste des images de l'appli.

Ce manifeste est lu par le Service Worker (sw.js) pour savoir quoi télécharger afin que les
images soient disponibles HORS-LIGNE. Sans lui, une image n'était mise en cache qu'après avoir
été affichée au moins une fois EN LIGNE : les planches de référence (marshalling, signes de
plongée, symboles TEMSI) — que l'on consulte précisément quand on n'a pas de réseau —
apparaissaient donc systématiquement cassées en vol.

Deux catégories, traitées différemment parce que leur poids n'a rien à voir :
  • "reference" (Symboles/**, ~6 Mio)  : téléchargé AUTOMATIQUEMENT en tâche de fond.
  • "questions" (IMAGES_**, ~74 Mio)   : téléchargé sur demande explicite, en Wi-Fi
                                         (bouton « Télécharger toutes les images »).

À relancer après tout ajout/suppression d'images :
    python3 tools/build_assets_manifest.py
"""

import json
import os

EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def collect(root: str) -> list:
    found = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if os.path.splitext(name)[1].lower() not in EXTS:
                continue
            rel = os.path.relpath(os.path.join(dirpath, name), REPO_ROOT)
            found.append(rel.replace(os.sep, "/"))
    return sorted(found)


def main() -> None:
    reference, questions = [], []
    for entry in sorted(os.listdir(REPO_ROOT)):
        path = os.path.join(REPO_ROOT, entry)
        if not os.path.isdir(path):
            continue
        if entry == "Symboles":
            reference += collect(path)
        elif entry.startswith("IMAGES_"):
            questions += collect(path)

    manifest = {
        "_comment": "Généré par tools/build_assets_manifest.py — ne pas éditer à la main.",
        "reference": sorted(reference),
        "questions": sorted(questions),
    }
    out = os.path.join(REPO_ROOT, "assets-manifest.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=0)

    def mb(paths):
        return sum(os.path.getsize(os.path.join(REPO_ROOT, p)) for p in paths) / 1e6

    print(f"reference : {len(reference):4d} fichiers  {mb(reference):6.1f} Mo")
    print(f"questions : {len(questions):4d} fichiers  {mb(questions):6.1f} Mo")
    print(f"-> {out}")


if __name__ == "__main__":
    main()
