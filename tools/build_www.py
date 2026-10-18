#!/usr/bin/env python3
"""Assemble www/ — les fichiers embarqués DANS l'APK Android (Capacitor).

Différence essentielle avec le site web : ici les fichiers sont livrés à l'intérieur de
l'application. Ils ne dépendent donc plus d'un cache navigateur susceptible d'être vidé, ni
d'avoir été consultés au moins une fois en ligne. Questions, images et pages sont présentes dès
l'installation — c'est ce qui rend l'appli utilisable en vol PAR CONSTRUCTION, et non
« si le pré-cache a bien fonctionné ».

Usage :  python3 tools/build_www.py [--app ppl|briefing|biblio]

TROIS applications (voir js/apps.js) sont construites depuis ce même dépôt : chacune n'embarque
que SES pages et SES données (le Briefing n'emporte pas les 80 Mo d'images du quiz, ni le quiz
les manuels), plus tout ce qui est commun (styles, scripts, configuration, icônes).
"""

import argparse
import fnmatch
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "www")

# Répertoires jamais embarqués : outillage de développement, plateformes générées, sources.
EXCLUDE_DIRS = {
    ".git", ".github", "node_modules", "www", "android", "ios",
    "assets", "tools", "mhtml", "HAR METEO", "belgian-notam-retrieval",
    # Dossiers de travail, jamais utiles dans l'appli (manuels PDF sources, archives réseau, clé de
    # signature — publique mais sans rien à faire dans l'APK)
    "Livres", "HAR Num Wx-model Output", "HAR Surface Analysis", "android-signing", "__pycache__",
}

# Ce qui n'appartient qu'à UNE application (noms de fichiers à la racine, motifs, ou dossiers).
# Tout le reste est commun aux trois.
APP_ONLY = {
    "ppl": [
        "index.html", "quiz.html", "rates.html", "echecs.html", "difficultes.html", "epreuve.html",
        "examen.html", "syllabus.html", "stats.html", "historique.html", "search.html", "fiches.html",
        "symboles.html", "radial.html", "plongee.html",
        "section_easa_*.json", "gligli_*.json", "questions_*.json", "IMAGES_*/", "Symboles/",
    ],
    "briefing": [
        "briefing.html", "navlog.html", "urgences.html", "fiche_urgence_*.pdf", "openaip_*.json",
    ],
    "biblio": [
        "bibliotheque.html", "livre.html", "livre.css", "livre/",
    ],
}
# Page d'ouverture de l'APK (Capacitor ouvre toujours index.html)
APP_HOME = {"ppl": None, "briefing": "briefing.html", "biblio": "bibliotheque.html"}

# Fichiers jamais embarqués.
#
# Les données météo (skeyes_*, temsi_*, wintem_*, NOTAM, OPMET) sont régénérées à chaque récupération
# par GitHub Actions : les embarquer figerait dans l'APK une météo périmée dès la compilation,
# pour ~40 Mio inutiles. Elles sont récupérées en ligne, au sol, à la préparation du vol.
#
# config.js est exclu ici car il contient les clés Firebase/OpenAIP : il est régénéré depuis
# les secrets du dépôt au moment du build (voir .github/workflows/build-android.yml), exactement
# comme pour le déploiement du site.
EXCLUDE_FILES = [
    "config.js", "*.py", "*.har", "*.docx", "*.md", "*.log", "*.txt",
    "skeyes_*", "temsi_*", "wintem_*", "opmet*", "notams_belgique.html",
    "daily_warnings*", "figs.json", "c150_manual.pdf", "test_*.png", "_ci_logs*", "package.json", "package-lock.json",
    "capacitor.config.json", "firebase.json", "firestore.*", "storage.rules",
    "*.code-workspace", ".gitignore", ".DS_Store",
]


def excluded(name: str) -> bool:
    return any(fnmatch.fnmatch(name, pat) for pat in EXCLUDE_FILES)


def other_apps_patterns(app):
    """Motifs (fichiers et dossiers « x/ ») appartenant aux AUTRES applications que `app`."""
    return [pat for a, pats in APP_ONLY.items() if a != app for pat in pats]


def belongs_elsewhere(rel_path, is_dir, foreign):
    top = rel_path.replace("\\", "/").split("/")[0]
    for pat in foreign:
        if pat.endswith("/"):
            if fnmatch.fnmatch(top, pat[:-1]) and (is_dir or "/" in rel_path.replace("\\", "/")):
                return True
        elif "/" not in rel_path.replace("\\", "/") and fnmatch.fnmatch(rel_path, pat):
            return True
    return False


def check_links(app):
    """Contrôle : chaque fichier local référencé par une page embarquée doit être présent.
    Un oubli donnerait une page cassée dans l'APK, découverte seulement sur le téléphone."""
    missing = set()
    pat = re.compile(r"""(?:src|href)\s*=\s*["']([^"'#?:]+\.(?:html|css|js|json|png|jpe?g|gif|webp|svg|pdf))["']""", re.I)
    for name in os.listdir(OUT):
        if not name.endswith(".html"):
            continue
        text = open(os.path.join(OUT, name), encoding="utf-8", errors="ignore").read()
        for ref in pat.findall(text):
            if ref.startswith(("http", "//")) or excluded(os.path.basename(ref)):
                continue
            if not os.path.exists(os.path.join(OUT, ref)):
                missing.add(f"{name} -> {ref}")
    for m in sorted(missing):
        print("  (non embarqué) " + m)
    return missing


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--app", default="ppl", choices=sorted(APP_ONLY))
    app = ap.parse_args().app
    foreign = other_apps_patterns(app)
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)

    copied = 0
    total_bytes = 0
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT)
        if rel_dir == ".":
            rel_dir = ""
            dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS and not d.startswith('.') and not belongs_elsewhere(d, True, foreign)]
        # Pages originales des livres (livre/<id>/img, des centaines de Mo) : lues en ligne et
        # mises en cache à la demande (voir js/livre.js) ; seul le texte est embarqué.
        if rel_dir.startswith("livre") and os.path.basename(dirpath) == "img":
            continue
        for name in filenames:
            if excluded(name):
                continue
            if not rel_dir and belongs_elsewhere(name, False, foreign):
                continue
            src = os.path.join(dirpath, name)
            dst = os.path.join(OUT, rel_dir, name) if rel_dir else os.path.join(OUT, name)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
            copied += 1
            total_bytes += os.path.getsize(src)

    # Briefing / Bibliothèque : index.html ouvre la page d'accueil de l'application.
    home = APP_HOME[app]
    if home:
        if not os.path.exists(os.path.join(OUT, home)):
            sys.exit(f"ERREUR : {home} absent de www/ — build interrompu.")
        with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
            f.write('<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">'
                    f'<meta http-equiv="refresh" content="0;url={home}">'
                    f'<script>location.replace("{home}" + location.hash);</script></head><body></body></html>')

    # Sans index.html, Capacitor construit un APK qui ouvre une page blanche — échouer ici est
    # infiniment préférable à livrer ça.
    if not os.path.exists(os.path.join(OUT, "index.html")):
        sys.exit("ERREUR : index.html absent de www/ — build interrompu.")

    def count(*exts):
        n = 0
        for dp, _dn, fns in os.walk(OUT):
            n += sum(1 for f in fns if os.path.splitext(f)[1].lower() in exts)
        return n

    print(f"www/ assemblé pour l'application « {app} » : {copied} fichiers, {total_bytes / 1e6:.1f} Mo")
    check_links(app)
    print(f"  html   : {count('.html')}")
    print(f"  js/css : {count('.js', '.css')}")
    print(f"  json   : {count('.json')}")
    print(f"  images : {count('.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg')}")


if __name__ == "__main__":
    main()
