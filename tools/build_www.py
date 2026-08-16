#!/usr/bin/env python3
"""Assemble www/ — les fichiers embarqués DANS l'APK Android (Capacitor).

Différence essentielle avec le site web : ici les fichiers sont livrés à l'intérieur de
l'application. Ils ne dépendent donc plus d'un cache navigateur susceptible d'être vidé, ni
d'avoir été consultés au moins une fois en ligne. Questions, images et pages sont présentes dès
l'installation — c'est ce qui rend l'appli utilisable en vol PAR CONSTRUCTION, et non
« si le pré-cache a bien fonctionné ».

Usage :  python3 tools/build_www.py
"""

import fnmatch
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "www")

# Répertoires jamais embarqués : outillage de développement, plateformes générées, sources.
EXCLUDE_DIRS = {
    ".git", ".github", "node_modules", "www", "android", "ios",
    "assets", "tools", "mhtml", "HAR METEO", "belgian-notam-retrieval",
}

# Fichiers jamais embarqués.
#
# Les données météo (skeyes_*, temsi_*, wintem_*, NOTAM, OPMET) sont régénérées toutes les ~3 h
# par GitHub Actions : les embarquer figerait dans l'APK une météo périmée dès la compilation,
# pour ~40 Mio inutiles. Elles sont récupérées en ligne, au sol, à la préparation du vol.
#
# config.js est exclu ici car il contient les clés Firebase/OpenAIP : il est régénéré depuis
# les secrets du dépôt au moment du build (voir .github/workflows/build-android.yml), exactement
# comme pour le déploiement du site.
EXCLUDE_FILES = [
    "config.js", "*.py", "*.har", "*.docx", "*.md", "*.log", "*.txt",
    "skeyes_*", "temsi_*", "wintem_*", "opmet*", "notams_belgique.html",
    "daily_warnings*", "package.json", "package-lock.json",
    "capacitor.config.json", "firebase.json", "firestore.*", "storage.rules",
    "*.code-workspace", ".gitignore", ".DS_Store",
]


def excluded(name: str) -> bool:
    return any(fnmatch.fnmatch(name, pat) for pat in EXCLUDE_FILES)


def main() -> None:
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)

    copied = 0
    total_bytes = 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT)
        if rel_dir == ".":
            rel_dir = ""
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for name in filenames:
            if excluded(name):
                continue
            src = os.path.join(dirpath, name)
            dst = os.path.join(OUT, rel_dir, name) if rel_dir else os.path.join(OUT, name)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
            copied += 1
            total_bytes += os.path.getsize(src)

    # Sans index.html, Capacitor construit un APK qui ouvre une page blanche — échouer ici est
    # infiniment préférable à livrer ça.
    if not os.path.exists(os.path.join(OUT, "index.html")):
        sys.exit("ERREUR : index.html absent de www/ — build interrompu.")

    def count(*exts):
        n = 0
        for dp, _dn, fns in os.walk(OUT):
            n += sum(1 for f in fns if os.path.splitext(f)[1].lower() in exts)
        return n

    print(f"www/ assemblé : {copied} fichiers, {total_bytes / 1e6:.1f} Mo")
    print(f"  html   : {count('.html')}")
    print(f"  js/css : {count('.js', '.css')}")
    print(f"  json   : {count('.json')}")
    print(f"  images : {count('.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg')}")


if __name__ == "__main__":
    main()
