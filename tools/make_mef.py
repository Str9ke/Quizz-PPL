"""MEF (Maximum Elevation Figure) par case de 30' x 30' -> mef.json (embarqué : marche hors ligne).

Aucun service officiel ne publie les MEF en données numériques (les cartes OACI les impriment ;
open flightmaps n'en a pas) : on les CALCULE avec la méthode des cartes aéronautiques (guide des
cartes FAA, reprise par l'OACI) :
  - point le plus haut du relief de la case (modèle numérique de terrain SRTM, tuiles « Terrarium »
    publiques d'AWS, zoom 11 ≈ 50 m au sol à nos latitudes) ;
  - obstacle le plus haut de la case (vfr_data.json : listes officielles SIA et IGN belge) ;
  - relief : sommet + 200 ft (végétation, obstacles non cartographiés) + 100 ft (erreur verticale),
    obstacle : sommet + 100 ft ; on garde le plus grand, arrondi à la centaine supérieure.
C'est une aide à la préparation, pas une donnée officielle : la carte OACI papier fait foi.

Usage : python tools/make_mef.py   (après tools/fetch_vfrdata.py, qui fournit les obstacles)
"""
import io
import json
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "mef.json")
ZONE = {"south": 48.0, "north": 52.5, "west": -0.5, "east": 7.0}   # comme vfr_data.json, arrondi aux 30'
STEP = 0.5
Z = 11
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def get_tile(s, x, y):
    for attempt in range(4):
        try:
            r = s.get(URL.format(z=Z, x=x, y=y), timeout=60)
            if r.status_code == 200:
                a = np.asarray(Image.open(io.BytesIO(r.content)).convert("RGB"), dtype=np.float64)
                return x, y, a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
        except Exception:
            pass
        time.sleep(2 * (attempt + 1))
    return x, y, None


def main():
    t0 = time.time()
    nlat = round((ZONE["north"] - ZONE["south"]) / STEP)
    nlon = round((ZONE["east"] - ZONE["west"]) / STEP)
    terr = np.full((nlat, nlon), -1e9)
    terr_pos = {}
    x0, y0 = tile_xy(ZONE["north"], ZONE["west"], Z)
    x1, y1 = tile_xy(ZONE["south"], ZONE["east"], Z)
    jobs = [(x, y) for x in range(int(x0), int(x1) + 1) for y in range(int(y0), int(y1) + 1)]
    s = requests.Session()
    n = 2 ** Z
    missing = 0
    with ThreadPoolExecutor(max_workers=16) as ex:
        for x, y, el in ex.map(lambda j: get_tile(s, *j), jobs):
            if el is None:
                missing += 1
                continue
            px = np.arange(256) + 0.5
            lon = (x + px / 256) / n * 360 - 180
            lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * (y + px / 256) / n))))
            ci = np.floor((lon - ZONE["west"]) / STEP).astype(int)          # colonne de chaque pixel
            ri = np.floor((lat - ZONE["south"]) / STEP).astype(int)         # ligne de chaque pixel
            for r in np.unique(ri):
                if not 0 <= r < nlat:
                    continue
                rows = ri == r
                for c in np.unique(ci):
                    if not 0 <= c < nlon:
                        continue
                    blk = el[np.ix_(rows, ci == c)]
                    m = float(blk.max())
                    if m > terr[r, c]:
                        terr[r, c] = m
                        k = np.unravel_index(int(blk.argmax()), blk.shape)
                        rr = np.where(rows)[0][k[0]]; cc = np.where(ci == c)[0][k[1]]
                        terr_pos[(r, c)] = (round(float(lat[rr]), 4), round(float(lon[cc]), 4))
    print(f"relief : {len(jobs)} tuiles ({missing} manquantes) en {time.time() - t0:.0f}s", flush=True)

    obs = np.full((nlat, nlon), -1e9)
    obs_info = {}
    try:
        vd = json.load(open(os.path.join(ROOT, "vfr_data.json"), encoding="utf-8"))
        for o in (vd.get("obs_fr") or []) + (vd.get("obs_be") or []):
            if o.get("alt") is None:
                continue
            for la, lo in (o.get("line") or [[o["lat"], o["lon"]]]):     # ligne électrique : chaque point
                r = int(math.floor((la - ZONE["south"]) / STEP)); c = int(math.floor((lo - ZONE["west"]) / STEP))
                if 0 <= r < nlat and 0 <= c < nlon and o["alt"] > obs[r, c]:
                    obs[r, c] = o["alt"]
                    obs_info[(r, c)] = (o.get("t") or "obstacle", la, lo)
    except (OSError, ValueError) as e:
        print("obstacles indisponibles :", e)

    cells = []
    for r in range(nlat):
        for c in range(nlon):
            t_ft = terr[r, c] * 3.28084 if terr[r, c] > -1e8 else None
            o_ft = obs[r, c] if obs[r, c] > -1e8 else None
            cand = []
            if t_ft is not None:
                cand.append((max(t_ft, 0) + 300, "relief", round(max(t_ft, 0))) + terr_pos.get((r, c), (None, None)))
            if o_ft is not None:
                ti, la, lo = obs_info[(r, c)]
                cand.append((o_ft + 100, ti, round(o_ft), la, lo))
            if not cand:
                continue
            best = max(cand, key=lambda x: x[0])
            mef = int(math.ceil(best[0] / 100.0) * 100)
            cells.append({"s": round(ZONE["south"] + r * STEP, 2), "w": round(ZONE["west"] + c * STEP, 2),
                          "mef": mef, "by": best[1], "top": best[2], "lat": best[3], "lon": best[4],
                          "terr": round(max(t_ft, 0)) if t_ft is not None else None,
                          "obs": round(o_ft) if o_ft is not None else None})
    res = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "step": STEP, "zone": ZONE,
           "method": "relief +300 ft / obstacle +100 ft, arrondi à la centaine supérieure",
           "sources": "relief SRTM (AWS Terrain Tiles, Terrarium z11) ; obstacles SIA ENR 5.4 + IGN belge eTOD (vfr_data.json)",
           "cells": cells}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    print(f"mef.json : {len(cells)} cases, MEF de {min(x['mef'] for x in cells)} à {max(x['mef'] for x in cells)} ft "
          f"— {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
