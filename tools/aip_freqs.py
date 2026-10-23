#!/usr/bin/env python3
"""Fréquences radio OFFICIELLES (AIP) -> aip_freqs.json, lu par navlog.html (bouton 📻 des commentaires).

Sources (les plus à jour et officielles possible) :
  - Belgique/Luxembourg : eAIP skeyes (ops.skeyes.be, derrière le même pare-feu anti-robot que
    l'OPMET : la session est obtenue comme pour fetch_notams.py) —
      ENR 2.1 : chaque espace (FIR, CTA, TMA, CTR) avec classe, limites, organisme, indicatif et
                renvoi vers ses fréquences (« See EBxx AD 2.18 » ou « See § 3 ») ;
      ENR 2.1 § 3 : fréquences des organismes de contrôle et d'information (Brussels Information…) ;
      AD 2.18 de chaque aérodrome : toutes les fréquences (TWR, APP, Radio, ATIS…).
  - France : eAIP du SIA (cycle AIRAC en cours, accès libre) — AD 2.18 des aérodromes de la zone
    (fréquences de l'aérodrome, de l'approche et des secteurs SIV, ex. Lille Information SIV 1…).
Les contours des espaces viennent d'OpenAIP (openaip_data.json) : chaque espace OpenAIP est relié à
son entrée AIP par son nom (« CHARLEROI TMA 2A » = « CHARLEROI TMA TWO A »).

Usage :  python tools/aip_freqs.py            (dans le workflow update_aip.yml)
         python tools/aip_freqs.py --local DIR (pages déjà téléchargées, pour le développement)
"""
import datetime as dt
import json
import os
import re
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor

from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "aip_freqs.json")
BE = "https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/html/eAIP/"
SIA = "https://www.sia.aviation-civile.gouv.fr/media/dvd/"
# Zone utile (comme js/aerodromes-data.js)
ZONE = {"south": 48.8, "north": 52.0, "west": 0.8, "east": 6.6}
NUM = {"ONE": "1", "TWO": "2", "THREE": "3", "FOUR": "4", "FIVE": "5", "SIX": "6", "SEVEN": "7",
       "EIGHT": "8", "NINE": "9", "TEN": "10", "ELEVEN": "11", "TWELVE": "12"}
TYPES = ("TMA", "CTR", "CTA", "ATZ", "SIV", "FIR", "UIR", "TMZ", "RMZ")


def clean(t):
    return re.sub(r"\s+", " ", (t or "").replace("\xa0", " ")).strip()


def norm_key(name):
    """Clé de rapprochement des noms AIP / OpenAIP (accents, nombres en lettres, parenthèses)."""
    s = unicodedata.normalize("NFD", name.upper())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    toks = [NUM.get(t, t) for t in s.split()]
    out = []
    for t in toks:  # « 2 A » -> « 2A »
        if out and re.fullmatch(r"[A-D]", t) and re.fullmatch(r"\d+", out[-1]):
            out[-1] += t
        else:
            out.append(t)
    return " ".join(out)


def freqs_in(text):
    """Fréquences de RADIOCOMMUNICATION (118–137 MHz) d'une cellule : les balises (VOR/ILS 108–118 MHz)
    et 121.500 (détresse) sont exclues."""
    out = []
    for m in re.finditer(r"\b(1[0-3]\d\.\d{2,3})\b", text):
        f = m.group(1)
        v = float(f)
        if 118 <= v < 137 and abs(v - 121.5) > 1e-6:
            f = f if len(f.split(".")[1]) == 3 else f + "0"
            if f not in out:
                out.append(f)
    return out


def grid(table):
    """Tableau HTML -> lignes de cellules (texte), en dépliant rowspan/colspan."""
    rows, pending = [], {}
    for tr in table.find_all("tr"):
        cells, col = [], 0
        tds = tr.find_all(["td", "th"], recursive=False) or tr.find_all(["td", "th"])
        it = iter(tds)
        while True:
            if col in pending:
                txt, left = pending[col]
                cells.append(txt)
                if left <= 1:
                    del pending[col]
                else:
                    pending[col] = (txt, left - 1)
                col += 1
                continue
            try:
                td = next(it)
            except StopIteration:
                break
            txt = clean(td.get_text(" "))
            rs, cs = int(td.get("rowspan") or 1), int(td.get("colspan") or 1)
            for k in range(cs):
                cells.append(txt)
                if rs > 1:
                    pending[col] = (txt, rs - 1)
                col += 1
        while col in pending:
            txt, left = pending[col]
            cells.append(txt)
            if left <= 1:
                del pending[col]
            else:
                pending[col] = (txt, left - 1)
            col += 1
        rows.append(cells)
    return rows


def ad218(html, icao):
    """Tableau AD 2.18 d'un aérodrome -> [{svc, call, freq, hours, rmk}] (VHF civile seulement)."""
    s = BeautifulSoup(html, "html.parser")
    anchor = s.find(id=re.compile(r"AD-2\.18$")) or s.find(string=re.compile(icao + r"\s+AD\s+2\.18"))
    if anchor is None:
        return []
    table = anchor.find_next("table")
    if table is None:
        return []
    out = []
    for r in grid(table):
        if len(r) < 3 or r[0] in ("1", "Service designation", "Service") or r[2] in ("3", "FREQ", "Frequency", "Frequency/Channel"):
            continue
        svc, call, fr = r[0], r[1], r[2]
        hours = r[3] if len(r) > 3 else ""
        rmk = r[4] if len(r) > 4 else ""
        call = re.sub(r"\s*\((FR|EN|En|Fr|En/Fr|FR/EN)\)\s*", " ", call)
        call = clean(re.sub(r"\(\d\)", "", call))
        # « LILLE Information (FR) LILLE Information (EN) » -> une seule fois
        w = call.split(" ")
        if len(w) > 2 and w[0] in w[1:]:
            call = " ".join(w[:w.index(w[0], 1)])
        if clean(svc).upper() in ("VDF",):
            continue
        for f in freqs_in(fr):
            e = {"svc": clean(svc), "call": call, "freq": f, "hours": clean(hours)[:20], "rmk": clean(rmk)[:120]}
            if e not in out:
                out.append(e)
    return out


def limit_ft(txt):
    """« FL 095 » / « 1 500 FT AMSL » / « GND » / « UNL » -> pieds (FL = ×100, approx.)."""
    t = txt.upper().replace(" ", "")
    if "GND" in t or "SFC" in t:
        return 0
    if "UNL" in t:
        return 99999
    m = re.search(r"FL(\d+)", t)
    if m:
        return int(m.group(1)) * 100
    m = re.search(r"(\d+)FT", t)
    return int(m.group(1)) if m else None


def be_enr21(html):
    """ENR 2.1 belge -> (espaces, organismes § 3)."""
    s = BeautifulSoup(html, "html.parser")
    spaces = []
    for t in s.find_all("table", class_="FirUirTma"):
        cap = t.find("caption")
        if not cap:
            continue
        name = clean(re.sub(r"\(\d\)", "", cap.get_text(" ")))
        d = {"name": name, "key": norm_key(name), "units": []}
        unit = None
        for r in grid(t):
            if not r:
                continue
            h = r[0].lower()
            low = [c.lower() for c in r]
            if "call sign" in low:
                i = low.index("call sign")
                name_u = clean(re.sub(r"\(\d\)", "", r[i - 1] if i > 0 else ""))
                call_u = clean(re.sub(r"\((En|Fr|EN|FR)\)", "", r[i + 1] if i + 1 < len(r) else ""))
                if not d["units"] or d["units"][-1]["unit"] != name_u:
                    unit = {"unit": name_u, "call": call_u, "ref": ""}
                    d["units"].append(unit)
                continue
            if "freq" in low and unit is not None:
                i = low.index("freq")
                unit["ref"] = " ".join(r[i + 1:])
                continue
            if h.startswith("vertical"):
                v = r[1] if len(r) > 1 else ""
                parts = [p.strip() for p in v.split("/")]
                d["upper"], d["lower"] = (parts + ["", ""])[:2]
                d["upperFt"], d["lowerFt"] = limit_ft(d["upper"]), limit_ft(d["lower"])
            elif h.startswith("airspace class"):
                d["cls"] = clean(re.sub(r"\(\d\)", "", r[1] if len(r) > 1 else ""))
        spaces.append(d)
    units = {}
    for t in s.find_all("table"):
        cap = t.find("caption")
        if not cap or "flight information units" not in cap.get_text(" ").lower():
            continue
        for r in grid(t):
            if len(r) < 4 or r[0] == "ATS unit":
                continue
            call = clean(r[1])
            for f in freqs_in(r[3]):
                e = {"svc": clean(r[0]), "call": call, "freq": f, "rmk": clean(r[4] if len(r) > 4 else "")[:80]}
                units.setdefault(call, [])
                if e not in units[call]:
                    units[call].append(e)
    return spaces, units


def resolve(space, ads, units):
    """Fréquences d'un espace AIP belge : AD 2.18 renvoyé, sinon § 3 (par indicatif)."""
    out = []
    if " FIR" in " " + space["name"]:  # FIR : service d'information de vol (Brussels Information)
        return [{"call": x["call"], "freq": x["freq"], "rmk": x.get("rmk", "")}
                for k, v in units.items() if k.endswith("Information") for x in v]
    for u in space["units"]:
        ref, call = u["ref"], u["call"]
        m = re.search(r"\b([A-Z]{4})\s*AD[ -]?2\.18", ref)
        cands = []
        if m and m.group(1) in ads:
            rows = ads[m.group(1)]
            words = [w for w in re.split(r"[ ,]+", call) if len(w) > 2]
            cands = [x for x in rows if any(w.lower() in x["call"].lower() for w in words if w.lower() not in ("brussels",))] \
                or [x for x in rows if x["call"].lower() in call.lower()] or [x for x in rows if x["svc"].startswith("APP")]
            if "Brussels" in call:
                cands = [x for x in rows if x["call"] and x["call"].split()[-1].lower() in call.lower()] or cands
        elif "3" in ref or not ref:
            for c in re.split(r",", call):
                cands += units.get(clean(c), [])
        for x in cands:
            e = {"call": x["call"], "freq": x["freq"], "rmk": x.get("rmk", "")}
            if e not in out:
                out.append(e)
    return out


def siv_numbers(rmk):
    """« Information/Radar SIV 6.1 à/to 6.4 » -> {"6.1","6.2","6.3","6.4"} ; « SIV 3 et/and 5 » -> {"3","5"}."""
    m = re.search(r"SIV\s*(.*)", rmk)
    if not m:
        return set()
    txt = m.group(1)
    out = set()
    nums = list(re.finditer(r"\d+(?:\.\d+)?", txt))
    for i, n in enumerate(nums):
        out.add(n.group(0))
        if i + 1 < len(nums) and re.search(r"à|to", txt[n.end():nums[i + 1].start()]):
            a, b = n.group(0), nums[i + 1].group(0)
            if "." in a and "." in b and a.split(".")[0] == b.split(".")[0]:
                for k in range(int(a.split(".")[1]), int(b.split(".")[1]) + 1):
                    out.add(a.split(".")[0] + "." + str(k))
            elif "." not in a and "." not in b:
                for k in range(int(a), int(b) + 1):
                    out.add(str(k))
    return out


def airac_base(today=None):
    """Dossier eAIP du SIA pour le cycle AIRAC en cours (cycles de 28 jours ; 11/06/2026 = référence)."""
    today = today or dt.date.today()
    ref = dt.date(2026, 6, 11)
    n = (today - ref).days // 28
    d = ref + dt.timedelta(days=28 * n)
    mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.month - 1]
    return f"{SIA}eAIP_{d.day:02d}_{mon}_{d.year}/FRANCE/AIRAC-{d.isoformat()}/html/eAIP/", d.isoformat()


def match_openaip(spaces_be, ads):
    """Relie chaque espace OpenAIP de la zone à ses fréquences officielles."""
    data = json.load(open(os.path.join(ROOT, "openaip_data.json"), encoding="utf-8"))
    by_key = {}
    for sp in spaces_be:
        by_key.setdefault(sp["key"], sp)
    out = {}
    for a in data.get("airspaces", []):
        name = a.get("name") or ""
        country = a.get("country")
        k = norm_key(name)
        rec = None
        if country in ("BE", "LU"):
            rec = by_key.get(k)
            if rec is None:  # « BRUSSELS TMA 2 BRUSSELS DEP » : clé de l'espace sans le suffixe d'organisme
                toks = k.split()
                for i in range(len(toks), 1, -1):
                    if " ".join(toks[:i]) in by_key:
                        rec = by_key[" ".join(toks[:i])]
                        break
            if rec is not None and rec.get("freqs"):
                out[name] = {"src": "AIP Belgique ENR 2.1", "aip": rec["name"], "freqs": rec["freqs"]}
                continue
        if country in ("BE", "LU", "FR"):
            toks = k.split()
            typ = next((t for t in toks if t in TYPES), None)
            place = [t for t in toks if t not in TYPES and not re.fullmatch(r"\d+[A-Z]?|\d+\.\d+|HX", t)]
            if not typ or not place:
                continue
            nums = re.findall(r"(\d+(?:\.\d+)?)", name)
            rows = []
            pref = "LF" if country == "FR" else "E"
            for icao, lst in ads.items():
                if not icao.startswith(pref):
                    continue
                for x in lst:
                    if norm_key(x["call"]).startswith(place[0] + " ") and x.get("src") != "OpenAIP":
                        rows.append(x)
            def pick(svcs):
                return [x for sv in svcs for x in rows if x["svc"] == sv]
            if typ == "SIV":
                sel = [x for x in rows if x["svc"] == "FIS" and nums and nums[0] in siv_numbers(x["rmk"])]
                sel = sel or pick(["FIS"])
            elif typ in ("TMA", "CTA"):
                sel = pick(["APP", "FIS"])
            elif typ in ("CTR", "ATZ"):
                sel = pick(["TWR", "AFIS", "A/A", "APP", "ATIS"])
            else:
                sel = []
            seen, fr = set(), []
            for x in sel:
                if x["freq"] not in seen:
                    seen.add(x["freq"])
                    fr.append({"call": x["call"], "freq": x["freq"], "rmk": x["rmk"]})
            if fr:
                out[name] = {"src": "AIP " + ("France" if country == "FR" else "Belgique") + " AD 2.18", "freqs": fr}
    return out


def main():
    local = sys.argv[sys.argv.index("--local") + 1] if "--local" in sys.argv else None
    t0 = time.time()
    if local:
        def get_be(page):
            p = os.path.join(local, page)
            return open(p, encoding="utf-8").read() if os.path.exists(p) else ""
    else:
        sys.path.insert(0, ROOT)
        from fetch_notams import make_skeyes_session
        sess = make_skeyes_session()

        def get_be(page):
            r = sess.get(BE + page, timeout=40)
            r.encoding = "utf-8"
            return r.text if r.status_code == 200 else ""
    import requests
    fr_session = requests.Session()
    fr_session.headers["User-Agent"] = "Mozilla/5.0 (QuizPPL briefing; +https://str9ke.github.io/Quizz-PPL/)"

    # --- Belgique
    menu = get_be("EB-menu-en-GB.html") if not local else ""
    be_ads = sorted(set(re.findall(r"EB-AD-2\.([A-Z]{4})-en-GB\.html", menu))) if menu else \
        sorted(re.findall(r"EB-AD-2\.([A-Z]{4})\.html", " ".join(os.listdir(local))))
    ads = {}

    def one_be(icao):
        html = get_be(f"EB-AD-2.{icao}.html" if local else f"EB-AD-2.{icao}-en-GB.html")
        return icao, ad218(html, icao) if html else []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for icao, lst in ex.map(one_be, be_ads):
            if lst:
                ads[icao] = lst
    enr = get_be("EB-ENR-2.1.html" if local else "EB-ENR-2.1-en-GB.html")
    spaces, units = be_enr21(enr) if enr else ([], {})
    for sp in spaces:
        sp["freqs"] = resolve(sp, ads, units)

    # --- France (AD 2.18 des aérodromes de la zone)
    base, airac = airac_base()
    lf = []
    try:
        oa = json.load(open(os.path.join(ROOT, "openaip_data.json"), encoding="utf-8"))
        for a in oa.get("airports", []):
            c = (a.get("icaoCode") or "").upper()
            lon, lat = a["geometry"]["coordinates"]
            if c.startswith("LF") and ZONE["south"] <= lat <= ZONE["north"] and ZONE["west"] <= lon <= ZONE["east"]:
                lf.append(c)
    except Exception as e:
        print("openaip_data.json illisible :", e)
    lf = sorted(set(lf))

    def one_fr(icao):
        if local and os.path.exists(os.path.join(local, f"FR-AD-2.{icao}.html")):
            html = open(os.path.join(local, f"FR-AD-2.{icao}.html"), encoding="utf-8").read()
        else:
            try:
                r = fr_session.get(f"{base}FR-AD-2.{icao}-fr-FR.html", timeout=40)
                html = r.text if r.status_code == 200 else ""
            except Exception:
                html = ""
        return icao, ad218(html, icao) if html else []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for icao, lst in ex.map(one_fr, lf):
            if lst:
                ads[icao] = lst

    try:
        oa = json.load(open(os.path.join(ROOT, "openaip_data.json"), encoding="utf-8"))
        for a in oa.get("airports", []):
            c = (a.get("icaoCode") or "").upper()
            if not c or c in ads or not a.get("frequencies"):
                continue
            lon, lat = a["geometry"]["coordinates"]
            if not (ZONE["south"] <= lat <= ZONE["north"] and ZONE["west"] <= lon <= ZONE["east"]):
                continue
            lst = []
            for f in a["frequencies"]:
                for v in freqs_in(str(f.get("value", ""))):
                    lst.append({"svc": "", "call": (f.get("name") or a.get("name") or c).title(), "freq": v, "hours": "", "rmk": "OpenAIP (pas de fiche AD 2.18)", "src": "OpenAIP"})
            if lst:
                ads[c] = lst
    except Exception as e:
        print("fréquences OpenAIP :", e)

    result = {
        "generated": int(time.time() * 1000),
        "sources": {"BE": "eAIP Belgium & Luxembourg (skeyes) — ENR 2.1, AD 2.18",
                    "FR": f"eAIP France (SIA) AIRAC {airac} — AD 2.18"},
        "aerodromes": ads,
        "units": units,
        "airspacesBE": [{k: sp[k] for k in ("name", "cls", "lower", "upper", "lowerFt", "upperFt", "freqs") if k in sp} for sp in spaces],
        "openaip": match_openaip(spaces, ads),
    }
    if not ads:
        print("Aucune donnée AIP récupérée — fichier non modifié")
        return 1
    tmp = OUT + ".tmp"
    json.dump(result, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    print(f"AIP : {len(ads)} aérodromes, {len(spaces)} espaces BE, {len(result['openaip'])} espaces OpenAIP reliés "
          f"({time.time() - t0:.0f}s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
