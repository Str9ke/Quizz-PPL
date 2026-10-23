#!/usr/bin/env python3
"""Génère js/aerodromes-data.js (aérodromes + pistes) depuis openaip_data.json.

Usage :  python tools/make_aerodromes.py

Pour chaque aérodrome avec indicatif OACI de la zone (nord de la France, Belgique, Pays-Bas du sud,
Luxembourg, ouest de l'Allemagne) : nom, position, altitude (ft), et TOUTES les pistes, chaque
extrémité avec son cap VRAI (le vent du METAR est en degrés vrais), sa longueur, la distance de
roulement disponible au décollage (TORA) et la distance d'atterrissage disponible (LDA).
Lu par navlog.html (onglet Perf, carte, METAR) : complète et corrige les tables écrites à la main
(ex. LFQO est Lille-Marcq-en-Barœul, pas Lens — Lens-Bénifontaine est LFQL).
À relancer après une mise à jour d'OpenAIP (workflow update_openaip.yml).
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "openaip_data.json")
OUT = os.path.join(ROOT, "js", "aerodromes-data.js")

# Zone retenue (degrés) et pays
ZONE = {"south": 48.8, "north": 52.0, "west": 0.8, "east": 6.6}
COUNTRIES = {"FR", "BE", "NL", "LU", "DE"}
SKIP_TYPES = {4, 7, 8}   # héliports, aérodromes fermés
# codes comme dans RUNWAY_DB de navlog.html : "asphalt" = piste en dur, sinon herbe/terre
SURF = {0: "asphalt", 1: "asphalt", 5: "asphalt", 7: "asphalt", 2: "grass", 3: "grass", 12: "grass", 13: "grass"}
M_TO_FT = 3.28084


def length_m(v):
    if not v:
        return None
    val, unit = v.get("value"), v.get("unit", 0)
    if val is None:
        return None
    return round(val * (0.3048 if unit == 1 else 1))


def main():
    data = json.load(open(SRC, encoding="utf-8"))
    out = {}
    for a in data["airports"]:
        icao = (a.get("icaoCode") or "").strip().upper()
        if len(icao) != 4 or a.get("type") in SKIP_TYPES or a.get("country") not in COUNTRIES:
            continue
        lon, lat = a["geometry"]["coordinates"]
        if not (ZONE["south"] <= lat <= ZONE["north"] and ZONE["west"] <= lon <= ZONE["east"]):
            continue
        el = a.get("elevation") or {}
        elev = el.get("value")
        if elev is not None and el.get("unit", 0) == 0:
            elev = round(elev * M_TO_FT)
        ends = []
        for r in a.get("runways") or []:
            d = (r.get("designator") or "").strip().upper()
            hdg = r.get("trueHeading")
            if not d or hdg is None:
                continue
            dims = r.get("dimension") or {}
            dd = r.get("declaredDistance") or {}
            sc = (r.get("surface") or {}).get("mainComposite")
            ends.append({"d": d, "hdg": int(round(hdg)) % 360, "len": length_m(dims.get("length")),
                         "tora": length_m(dd.get("tora")), "lda": length_m(dd.get("lda")),
                         "sfc": SURF.get(sc, "grass")})
        # Paires d'extrémités opposées (même revêtement, caps à ~180°) -> une piste « 17/35 »
        rwys, used = [], set()
        ends.sort(key=lambda e: e["d"])
        for i, e in enumerate(ends):
            if i in used:
                continue
            used.add(i)
            mate = None
            for j, f in enumerate(ends):
                if j in used:
                    continue
                diff = abs(((e["hdg"] - f["hdg"]) % 360) - 180)
                if diff <= 15 and f["sfc"] == e["sfc"] and (not e["len"] or not f["len"] or abs(e["len"] - f["len"]) <= 60):
                    mate = j
                    break
            pair = [e] + ([ends[mate]] if mate is not None else [])
            if mate is not None:
                used.add(mate)
            pair.sort(key=lambda x: x["hdg"])
            rwys.append({"rwy": "/".join(x["d"] for x in pair), "hdg": pair[0]["hdg"],
                         "len": max((x["len"] or 0) for x in pair) or None, "sfc": pair[0]["sfc"],
                         "ends": [{k: x[k] for k in ("d", "hdg", "tora", "lda")} for x in pair]})
        if not rwys:
            continue
        name = " ".join(w.capitalize() if len(w) > 2 else w.lower() for w in (a.get("name") or "").split())
        out[icao] = {"name": name, "lat": round(lat, 5), "lon": round(lon, 5), "elev": elev, "rwys": rwys}
    js = ("/* Généré par tools/make_aerodromes.py depuis openaip_data.json — ne pas modifier à la main.\n"
          "   Aérodromes de la zone (nord de la France, Belgique…) : position, altitude (ft) et toutes les\n"
          "   pistes (caps VRAIS, longueurs, TORA/LDA en m). Utilisé par navlog.html. */\n"
          "window.AERODROMES_DATA = " + json.dumps(out, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + ";\n")
    open(OUT, "w", encoding="utf-8", newline="\n").write(js)
    print(f"{len(out)} aérodromes -> {OUT} ({len(js) // 1024} Ko)")


if __name__ == "__main__":
    main()
