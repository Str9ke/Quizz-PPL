"""SUP AIP France métropole en vigueur ou à venir (liste publique du SIA) -> sup_aip.json.

Chaque SUP AIP : numéro, titre, dates de validité, lien PDF officiel. La page du Navlog garde ceux
valables le jour du vol et met en avant ceux qui citent un terrain de la route ou créent une zone
(ZRT, ZDT, ZIT…). Le texte n'est pas modifié (Licence Ouverte du SIA, source citée).

Usage : python tools/sup_aip.py   (workflow update_aip.yml)
"""
import html, json, os, re, time
import requests

URL = "https://www.sia.aviation-civile.gouv.fr/documents/supaip/aip/id/6"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "sup_aip.json")


def main():
    r = requests.get(URL, timeout=90, headers={"User-Agent": "Mozilla/5.0 (QuizPPL briefing)"})
    r.raise_for_status()
    t = re.sub(r"<script.*?</script>", "", r.text, flags=re.S)
    items = []
    # une ligne <tr> par SUP : lien de téléchargement, <b>numéro</b> <span>titre</span>, « Valide du … au … »
    for row in re.split(r'<tr class="tr_ligne_document', t)[1:]:
        a = re.search(r'class="lien_sup_aip" href="([^"]+)"\s*>\s*<b>([^<]+)</b>\s*<span>(.*?)</span>', row, re.S)
        v = re.findall(r"<strong>(\d{4}-\d{2}-\d{2})</strong>", row)
        if not a or len(v) < 2:
            continue
        title = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", a.group(3)))).strip()
        items.append({"num": a.group(2).strip(), "title": title, "from": v[0], "to": v[1], "url": a.group(1)})
    if not items:
        raise SystemExit("aucun SUP AIP trouvé (page modifiée ?)")
    json.dump({"generated": int(time.time() * 1000), "source": "SIA — SUP AIP France métropole", "page": URL, "items": items},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(len(items), "SUP AIP ->", OUT)


if __name__ == "__main__":
    main()
