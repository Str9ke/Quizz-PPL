"""Aérodromes soumis à PPR (autorisation préalable) ou privés — France, Belgique, Luxembourg,
Pays-Bas, Allemagne, Royaume-Uni — depuis OpenAIP (champ « ppr » / « private »), pays entiers.
Sortie : ppr_aerodromes.json (liste compacte), utilisée par le bouton « 🔒 PPR » du Navlog.

Usage : OPENAIP_API_KEY=... python tools/fetch_ppr.py   (workflow update_aip.yml)
"""
import json, os, re, sys, time
import requests

COUNTRIES = ["FR", "BE", "LU", "NL", "DE", "GB"]
API = "https://api.core.openaip.net/api/airports"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "ppr_aerodromes.json")
TYPES = {0: "aérodrome", 1: "planeurs", 2: "aérodrome civil", 3: "aéroport international", 4: "héliport militaire",
         5: "aérodrome militaire", 6: "ULM", 7: "héliport civil", 8: "fermé", 9: "aéroport IFR", 10: "hydrobase",
         11: "altiport", 12: "aérodrome agricole", 13: "aérodrome mixte"}

KEY = os.environ.get("OPENAIP_API_KEY", "")
if not KEY:
    sys.exit("OPENAIP_API_KEY manquante")
S = requests.Session()
S.headers.update({"x-openaip-api-key": KEY, "Accept": "application/json"})


def get(params):
    delay = 15
    for _ in range(8):
        time.sleep(2.5)
        try:
            r = S.get(API, params=params, timeout=90)
        except requests.RequestException:
            time.sleep(delay); delay = min(delay * 2, 120); continue
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 502, 503, 504):
            ra = r.headers.get("Retry-After")
            time.sleep(int(ra) if ra and ra.isdigit() else delay); delay = min(delay * 2, 120); continue
        raise RuntimeError(f"HTTP {r.status_code} : {r.text[:200]}")
    raise RuntimeError("abandon")


PPR_RE = re.compile(r"\bPPR\b|prior permission|permission pr[ée]alable|autorisation pr[ée]alable", re.I)


STRONG_RE = re.compile(r"subject to (a )?prior permission|use of the aerodrome is subject|soumis[e]? à (une )?(autorisation|permission) pr[ée]alable|"
                       r"\bPPR (only|required|obligatoire|uniquement)|uniquement sur PPR|\bsur PPR|\bon PPR\b|\bPPR \d+ ?(HR|H)\b", re.I)


def add_from_aip(out):
    """Fiches AIP officielles (aip_ad/, eAIP skeyes + SIA) : terrains dont l'AIP impose une autorisation
    préalable, absents ou non marqués PPR dans OpenAIP. Position reprise d'openaip_data.json."""
    known = {x["icao"]: x for x in out if x["icao"]}
    oa = {}
    try:
        for a in json.load(open(os.path.join(ROOT, "openaip_data.json"), encoding="utf-8"))["airports"]:
            if a.get("icaoCode"):
                oa[a["icaoCode"]] = a
    except (OSError, ValueError, KeyError):
        pass
    for fn in sorted(os.listdir(os.path.join(ROOT, "aip_ad"))):
        if not re.match(r"^[A-Z]{4}\.json$", fn):
            continue
        d = json.load(open(os.path.join(ROOT, "aip_ad", fn), encoding="utf-8"))
        # lignes de l'AIP sur l'accès au terrain (pas l'avitaillement, la douane ni la santé, dont le
        # « PPR » ne concerne que ces services : LFQQ « Avitaillement … PPR en dehors de ces HOR »)
        lines = [ln for x in d.get("s", []) if x.get("n") in ("2.2", "2.3", "2.20") for ln in x.get("x", "").split("\n")
                 if not re.match(r"(?i)\s*(avitaillement|fuel|douane|customs|services de sant|health|sûreté|security|services de manutention|handling|dégivrage|de-icing|observations|bureau met|bia|bria|bdp|ats reporting)", ln)]
        txt = " ".join(lines)
        m = PPR_RE.search(txt)
        if not m:
            continue
        icao = d["icao"]
        why = re.sub(r"\s+", " ", txt[max(0, m.start() - 90):m.end() + 110]).strip()
        # PPR pour TOUS les vols (remarque générale) ou seulement pour certains (IFR, commerciaux…)
        strong = bool(STRONG_RE.search(txt))
        if icao in known:
            known[icao]["ppr"] = known[icao]["ppr"] or strong
            known[icao]["aip"] = why
            if not strong:
                known[icao]["cond"] = True
            continue
        o = oa.get(icao, {})
        c = (o.get("geometry") or {}).get("coordinates") or [None, None]
        fq = sorted(o.get("frequencies") or [], key=lambda f: not f.get("primary"))
        out.append({"icao": icao, "name": o.get("name", icao), "cc": o.get("country") or {"EB": "BE", "LF": "FR", "EL": "LU"}.get(icao[:2], ""),
                    "lat": c[1], "lon": c[0], "ppr": strong, "cond": not strong, "priv": bool(o.get("private")), "type": "", "elev": None, "rwy": None,
                    "freq": (fq[0].get("value") + " " + (fq[0].get("name") or "")).strip() if fq else "", "aip": why})


def main():
    out = []
    for cc in COUNTRIES:
        page, n = 1, 0
        while True:
            d = get({"country": cc, "limit": 1000, "page": page})
            items = d.get("items", [])
            for a in items:
                if not (a.get("ppr") or a.get("private")) or a.get("type") == 8:
                    continue
                c = (a.get("geometry") or {}).get("coordinates") or [None, None]
                rw = [x for x in a.get("runways") or [] if (x.get("dimension") or {}).get("length")]
                ln = max([x["dimension"]["length"]["value"] for x in rw], default=None)
                fq = sorted(a.get("frequencies") or [], key=lambda f: not f.get("primary"))
                el = a.get("elevation") or {}
                out.append({
                    "icao": a.get("icaoCode") or "", "name": a.get("name", ""), "cc": cc,
                    "lat": round(c[1], 4) if c[1] is not None else None, "lon": round(c[0], 4) if c[0] is not None else None,
                    "ppr": bool(a.get("ppr")), "priv": bool(a.get("private")), "type": TYPES.get(a.get("type"), ""),
                    "elev": round(el["value"] * (3.28084 if el.get("unit") == 0 else 1)) if el.get("value") is not None else None,
                    "rwy": ln, "freq": (fq[0].get("value") + " " + (fq[0].get("name") or "")).strip() if fq else "",
                })
                n += 1
            if page >= (d.get("totalPages") or 1):
                break
            page += 1
        print(cc, n, "aérodromes PPR/privés", flush=True)
    add_from_aip(out)
    out.sort(key=lambda x: (x["cc"], x["name"]))
    json.dump({"generated": int(time.time() * 1000), "source": "OpenAIP (CC BY-NC 4.0)", "items": out},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(len(out), "->", OUT)


if __name__ == "__main__":
    main()
