"""Télécharge une fois pour toutes les données OpenAIP de la zone « Belgique + ~1 h de vol »
(espaces aériens, aérodromes, VOR/NDB/DME) dans openaip_data.json, publié avec le site.

Pourquoi côté serveur : depuis l'automne 2026, l'API OpenAIP (api.core.openaip.net)
  - refuse toute zone de plus de 250 000 km² (HTTP 400) — la zone de l'export KML en fait ~500 000 ;
  - limite très fortement le débit (HTTP 429 dès quelques requêtes rapprochées).
Le navigateur, qui enchaînait une dizaine de requêtes à chaque clic, échouait donc presque
toujours. Ici, on découpe la zone en 4 morceaux et on espace les requêtes en respectant les
refus (Retry-After / attente croissante). Les espaces aériens ne changent qu'aux cycles AIRAC
(28 jours) : une mise à jour à la demande suffit (workflow update_openaip.yml).

Usage : OPENAIP_API_KEY=... python tools/fetch_openaip.py
"""
import json, os, sys, time
import requests

ZONE = {"south": 47.3, "north": 53.7, "west": -0.5, "east": 9.4}
LAT_SPLIT, LON_SPLIT = 2, 2           # 4 morceaux de ~130 000 km² chacun
ENDPOINTS = ("airspaces", "airports", "navaids")
API = "https://api.core.openaip.net/api/"
OUT = "openaip_data.json"

KEY = os.environ.get("OPENAIP_API_KEY", "")
if not KEY:
    sys.exit("OPENAIP_API_KEY manquante")

session = requests.Session()
session.headers.update({"x-openaip-api-key": KEY, "Accept": "application/json"})
_last = [0.0]


def get(url, tries=8):
    delay = 20
    for attempt in range(1, tries + 1):
        wait = 2.5 - (time.time() - _last[0])      # au moins 2,5 s entre deux requêtes
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            r = session.get(url, timeout=90)
        except requests.RequestException as e:
            print(f"  réseau ({e.__class__.__name__}), nouvel essai dans {delay}s", flush=True)
            time.sleep(delay); delay = min(delay * 2, 120); continue
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 502, 503, 504):
            ra = r.headers.get("Retry-After")
            pause = int(ra) if ra and ra.isdigit() else delay
            print(f"  HTTP {r.status_code}, attente {pause}s (essai {attempt}/{tries})", flush=True)
            time.sleep(pause); delay = min(delay * 2, 120); continue
        raise RuntimeError(f"HTTP {r.status_code} : {r.text[:200]}")
    raise RuntimeError(f"abandon après {tries} essais : {url}")


def tiles():
    dlat = (ZONE["north"] - ZONE["south"]) / LAT_SPLIT
    dlon = (ZONE["east"] - ZONE["west"]) / LON_SPLIT
    for i in range(LAT_SPLIT):
        for j in range(LON_SPLIT):
            s = ZONE["south"] + i * dlat
            w = ZONE["west"] + j * dlon
            yield f"{w:.4f},{s:.4f},{w + dlon:.4f},{s + dlat:.4f}"


def fetch_all(endpoint):
    seen = {}
    for bbox in tiles():
        page = 1
        while page and page <= 50:
            data = get(f"{API}{endpoint}?bbox={bbox}&limit=1000&page={page}")
            items = data.get("items") or []
            for it in items:
                seen[it.get("_id") or json.dumps(it, sort_keys=True)[:200]] = it
            print(f"{endpoint} {bbox} page {page}: {len(items)} (total {len(seen)})", flush=True)
            page = data.get("nextPage") if len(items) >= 1000 else None
    return list(seen.values())


def slim(it):
    # Champs d'audit inutiles à l'appli : fichier plus léger
    return {k: v for k, v in it.items() if k not in ("createdBy", "createdAt", "updatedBy", "updatedAt", "__v")}


def main():
    t0 = time.time()
    out = {"ts": int(time.time() * 1000), "bbox": ZONE}
    for ep in ENDPOINTS:
        out[ep] = [slim(x) for x in fetch_all(ep)]
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    # Petit résumé lu par la page au chargement (évite de télécharger le gros fichier pour rien)
    with open("openaip_meta.json", "w", encoding="utf-8") as f:
        json.dump({"ts": out["ts"], **{ep: len(out[ep]) for ep in ENDPOINTS}}, f)
    size = os.path.getsize(OUT) / 1e6
    msg = " · ".join(f"{ep} {len(out[ep])}" for ep in ENDPOINTS)
    print(f"::notice title=OpenAIP::{msg} — {size:.1f} Mo en {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
