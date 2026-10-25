"""Fiches AIP OFFICIELLES des aérodromes -> aip_ad/<ICAO>.json (une par aérodrome, chargée à la demande
par la page ; embarquée dans l'appli pour le vol hors ligne) + aip_ad/index.json.

Sources (les plus à jour : cycle AIRAC en cours, relues chaque jeudi par update_aip.yml) :
  - Belgique / Luxembourg : eAIP skeyes, AD 2 (même session anti-robot que fetch_notams.py) ;
  - France : eAIP du SIA, AD 2 (aérodromes de tools/lf_aerodromes.txt qui ont une partie AD 2) ;
  - Pays-Bas : l'eAIP de LVNL est protégé par un défi anti-robot (Cloudflare) -> PAS de copie
    automatique (on ne contourne pas un blocage) ; la page affiche le lien vers l'eAIP officiel.
On garde les rubriques utiles au pilote VFR (2.2 administratif et site web de l'exploitant, 2.3
horaires, 2.4 services/carburant, 2.12–2.13 pistes, 2.17 espace ATS, 2.18 fréquences, 2.20
règlements locaux, 2.21 bruit, 2.22 procédures de vol, 2.23 renseignements supplémentaires),
texte recopié tel quel (cellules de tableau séparées par « | »).

Sites web : exploitant (AIP AD 2.2) -> champ "web" de chaque fiche. Les clubs (OpenStreetMap) sont
cherchés par la page, à la demande, quand on ouvre un aérodrome (serveur Overpass public).

Usage : python tools/aip_ad.py        (workflow update_aip.yml)
"""
import datetime as dt
import html
import json
import math
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "aip_ad")
BE = "https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/html/eAIP/"
SIA = "https://www.sia.aviation-civile.gouv.fr/media/dvd/"
KEEP = {"2.2", "2.3", "2.4", "2.12", "2.13", "2.17", "2.18", "2.20", "2.21", "2.22", "2.23"}
UA = {"User-Agent": "Mozilla/5.0 (QuizPPL briefing; +https://str9ke.github.io/Quizz-PPL/)"}


def sia_dir(today=None):
    today = today or dt.date.today()
    ref = dt.date(2026, 6, 11)
    d = ref + dt.timedelta(days=28 * ((today - ref).days // 28))
    mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.month - 1]
    return f"{SIA}eAIP_{d.day:02d}_{mon}_{d.year}/FRANCE/AIRAC-{d.isoformat()}/html/eAIP/", d.isoformat()


def clean(t):
    t = re.sub(r"<br\s*/?>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t).replace("\xa0", " ")
    t = re.sub(r"[ \t\r\f\v]+", " ", t)
    t = re.sub(r" *\n *", "\n", t)
    return re.sub(r"\n{2,}", "\n", t).strip()


def parse(page, fr=False):
    """Découpe une page AD 2 (format eAIP européen) en rubriques {n, t, lines}."""
    if fr:   # AIP France bilingue : on garde le français, on retire la traduction anglaise
        page = re.sub(r'<span[^>]*class="foreign"[^>]*>.*?</span>', " ", page, flags=re.S | re.I)
    page = re.sub(r"(?s)<(script|style)[^>]*>.*?</\1>", " ", page)
    parts = re.split(r"(?s)<h4[^>]*>(.*?)</h4>", page)
    secs = []
    for i in range(1, len(parts) - 1, 2):
        head = clean(parts[i])
        m = re.search(r"AD 2\.(\d+)", head)
        if not m or "2." + m.group(1) not in KEEP:
            continue
        num = "2." + m.group(1)
        title = re.sub(r"^.*?AD 2\.\d+\s*", "", head).strip()
        body = parts[i + 1]
        lines = []
        for tr in re.findall(r"(?s)<tr[^>]*>(.*?)</tr>", body):
            cells = [clean(c).replace(chr(10), " ") for c in re.findall(r"(?s)<t[dh][^>]*>(.*?)</t[dh]>", tr)]
            cells = [re.sub(r"\s*/$", "", c).strip() for c in cells]
            cells = [c for c in cells if c]
            if cells:
                lines.append(" | ".join(cells))
        if not lines:   # texte libre (règlements locaux, procédures…)
            txt = clean(re.sub(r"(?s)</(p|div|li)>", "\n", body))
            lines = [l for l in txt.split("\n") if l.strip()]
        lines = [re.sub(r"^\d+\s*\|\s*", "", l) for l in lines]       # n° de ligne du tableau AIP
        txt = "\n".join(lines)
        if len(txt) > 6000:
            txt = txt[:6000] + "\n[…] (suite dans l'AIP officiel)"
        secs.append({"n": num, "t": title, "x": txt})
    return secs


def site_of(secs):
    for s in secs:
        if s["n"] == "2.2":
            m = re.search(r"(?i)(?:website|site web|site internet|www)[^\n|]*?\|?\s*((?:https?://)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s|]*)", s["x"])
            if m and not m.group(1).upper().startswith(("NIL", "INFO")):
                u = m.group(1)
                return u if u.lower().startswith("http") else "https://" + u
    return None


def osm_web(ads):
    """Sites des aérodromes et des clubs (OpenStreetMap), rattachés au terrain le plus proche (< 3 km)."""
    q = """[out:json][timeout:180];
(
  nwr["aeroway"="aerodrome"]["icao"](48.0,-0.5,53.7,7.3);
  nwr["club"~"^(flying|aviation|gliding|aero|aeroclub|microlight|parachuting|skydiving)$"](48.0,-0.5,53.7,7.3);
  nwr["sport"~"^(gliding|parachuting|skydiving|microlight)$"]["website"](48.0,-0.5,53.7,7.3);
);
out center tags;"""
    els = None
    for ep in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
               "https://overpass.private.coffee/api/interpreter"):
        try:
            r = requests.post(ep, data={"data": q}, headers=UA, timeout=240)
            els = r.json().get("elements", [])
            break
        except Exception as e:
            print(f"OpenStreetMap ({ep}) indisponible :", e)
    if els is None:
        return {}
    res = {}

    def pos(e):
        c = e.get("center") or e
        return c.get("lat"), c.get("lon")

    for e in els:
        t = e.get("tags", {})
        if t.get("aeroway") == "aerodrome" and t.get("icao"):
            w = t.get("website") or t.get("contact:website")
            if w:
                res.setdefault(t["icao"].upper(), {"site": None, "clubs": []})["site"] = w
    for e in els:
        t = e.get("tags", {})
        if t.get("aeroway") == "aerodrome":
            continue
        w = t.get("website") or t.get("contact:website") or t.get("url")
        name = t.get("name")
        lat, lon = pos(e)
        if not name or lat is None:
            continue
        best, bd = None, 3.0
        for code, a in ads.items():
            d = 6371 * math.acos(min(1, math.sin(math.radians(lat)) * math.sin(math.radians(a[0])) +
                                     math.cos(math.radians(lat)) * math.cos(math.radians(a[0])) * math.cos(math.radians(lon - a[1]))))
            if d < bd:
                best, bd = code, d
        if best:
            cl = res.setdefault(best, {"site": None, "clubs": []})["clubs"]
            if not any(c["name"] == name for c in cl):
                cl.append({"name": name, "url": w})
    print(f"OpenStreetMap : {sum(1 for v in res.values() if v['site'])} sites d'aérodromes, "
          f"{sum(len(v['clubs']) for v in res.values())} clubs")
    return res


def main():
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)
    ad_pos = {}
    try:
        oa = json.load(open(os.path.join(ROOT, "openaip_data.json"), encoding="utf-8"))
        for a in oa.get("airports", []):
            c = (a.get("icaoCode") or "").upper()
            if c:
                ad_pos[c] = (a["geometry"]["coordinates"][1], a["geometry"]["coordinates"][0])
    except Exception as e:
        print("openaip_data.json :", e)
    fiches = {}

    # --- Belgique / Luxembourg (skeyes)
    try:
        sys.path.insert(0, ROOT)
        from fetch_notams import make_skeyes_session
        sk = make_skeyes_session()
        menu = sk.get(BE + "EB-menu-en-GB.html", timeout=60).text
        codes = sorted(set(re.findall(r"EB-AD-2\.([A-Z]{4})-en-GB\.html", menu)))
        for c in codes:
            r = sk.get(BE + f"EB-AD-2.{c}-en-GB.html", timeout=60)
            if r.status_code == 200:
                r.encoding = "utf-8"
                secs = parse(r.text)
                if secs:
                    fiches[c] = {"src": "eAIP Belgique & Luxembourg (skeyes)", "url": BE + f"EB-AD-2.{c}-en-GB.html", "lang": "en", "s": secs}
            time.sleep(0.3)
        print(f"Belgique/Luxembourg : {sum(1 for f in fiches.values() if 'skeyes' in f['src'])} fiches")
    except Exception as e:
        print("eAIP skeyes indisponible :", e)

    # --- France (SIA)
    base, airac = sia_dir()
    try:
        lf = open(os.path.join(ROOT, "tools", "lf_aerodromes.txt"), encoding="utf-8").read().split()
    except OSError:
        lf = []
    s = requests.Session()
    s.headers.update(UA)

    def one(c):
        try:
            r = s.get(f"{base}FR-AD-2.{c}-fr-FR.html", timeout=60)
            if r.status_code == 200 and "AD 2." in r.text:
                r.encoding = "utf-8"
                return c, parse(r.text, fr=True)
        except Exception:
            pass
        return c, None
    with ThreadPoolExecutor(max_workers=6) as ex:
        for c, secs in ex.map(one, lf):
            if secs:
                fiches[c] = {"src": f"eAIP France (SIA), cycle AIRAC du {airac}", "url": f"{base}FR-AD-2.{c}-fr-FR.html", "lang": "fr", "s": secs}
    print(f"France : {sum(1 for f in fiches.values() if 'SIA' in f['src'])} fiches")

    # OpenStreetMap : le serveur public Overpass est réservé aux usages « humains » ; la page interroge
    # donc OSM à la demande (un aérodrome à la fois) ; ici seulement si on le demande (--osm).
    web = osm_web(ad_pos) if "--osm" in sys.argv else {}
    gen = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    index = {}
    for c in sorted(set(fiches) | set(web)):
        f = fiches.get(c, {})
        w = web.get(c, {})
        site = site_of(f.get("s", [])) if f else None
        rec = {"icao": c, "generated": gen, "src": f.get("src"), "url": f.get("url"), "lang": f.get("lang"), "s": f.get("s", []),
               "web": {"aip": site, "osm": w.get("site"), "clubs": w.get("clubs", [])}}
        with open(os.path.join(OUT, c + ".json"), "w", encoding="utf-8") as fh:
            json.dump(rec, fh, ensure_ascii=False, separators=(",", ":"))
        index[c] = {"aip": bool(f), "web": bool(site or w.get("site") or w.get("clubs"))}
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
        json.dump({"generated": gen, "ad": index}, fh, separators=(",", ":"))
    print(f"aip_ad : {len(index)} aérodromes ({sum(1 for v in index.values() if v['aip'])} fiches AIP) en {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
