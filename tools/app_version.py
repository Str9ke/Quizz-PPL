#!/usr/bin/env python3
"""Extrait la version de l'application et écrit version.json.

La version est celle du Service Worker (`CACHE_NAME` dans sw.js, ex. « quiz-ppl-v123 ») et NON
le dernier commit. C'est délibéré : les données météo sont régénérées toutes les ~3 h par
GitHub Actions, et se fier au commit signalerait une « mise à jour disponible » plusieurs fois
par jour sans qu'une seule ligne de l'application n'ait changé — une alerte qu'on apprend en
deux jours à ignorer, y compris le jour où elle compte vraiment. CACHE_NAME, lui, n'est
incrémenté que lors d'une vraie modification de l'appli.

Usage :
    python3 tools/app_version.py            # affiche la version
    python3 tools/app_version.py --write    # écrit aussi version.json
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def app_version() -> str:
    sw = os.path.join(ROOT, "sw.js")
    with open(sw, encoding="utf-8") as fh:
        for line in fh:
            m = re.match(r"\s*const\s+CACHE_NAME\s*=\s*['\"]([^'\"]+)['\"]", line)
            if m:
                return m.group(1)
    sys.exit("ERREUR : CACHE_NAME introuvable dans sw.js")


def main() -> None:
    version = app_version()
    if "--write" in sys.argv:
        payload = {
            "_comment": "Généré par tools/app_version.py — sert à répondre à « suis-je à jour ? ».",
            "appVersion": version,
            "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        out = os.path.join(ROOT, "version.json")
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        print(f"version.json écrit -> {version}")
    else:
        print(version)


if __name__ == "__main__":
    main()
