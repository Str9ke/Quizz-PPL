"""METAR / TAF officiels de Météo-France (AéroWeb, aviation.meteo.fr) -> opmet_aeroweb.json

Lancé par fetch_notams.py en même temps que l'OPMET Skeyes (bouton « Récupérer toutes les données »
ou « OPMET seul » de la page Briefing), ou seul :  python fetch_aeroweb.py

AéroWeb exige un compte : identifiants dans les secrets GitHub AEROWEB_USER / AEROWEB_PASS (le mot
de passe n'est jamais écrit dans le dépôt ; le site attend son empreinte MD5, comme son formulaire).

Deux sources, toutes deux utilisées par le site lui-même :
  - ajax/ajax_trajet_get_stations.php (carte « Météo à la carte ») : pour toute une zone, la liste des
    stations avec position, nom, METAR et le CODE COULEUR visibilité / plafond (légende du site) ;
  - showmessage.php?code=XXXX (« Modifier l'aérodrome » / message d'un aérodrome) : le message
    COMPLET — METAR, TAF LONG, PREDEC, MAA (avertissements d'aérodrome), et les SIGMET de la FIR —
    bien plus long que l'infobulle de la carte.
"""
import hashlib
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor

import warnings

import requests
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

BASE = "https://aviation.meteo.fr/"
OUT = "opmet_aeroweb.json"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36")

# Zone de la carte (lon/lat) : nord de la France, Belgique, Pays-Bas du sud, sud-est de l'Angleterre.
BBOX = (-1.5, 48.3, 7.2, 52.6)

# Aérodromes dont on veut le message complet : ceux de la région (liste des dossiers AéroWeb de
# Thomas). Les stations de la carte sont ajoutées si elles tombent dans la zone ci-dessus.
STATIONS = """
LFAC LFIS LFQN LFAK LFAT LFQT LFAM LFQL LFQO LFQQ LFOI LFQD LFQS LFQI LFAQ LFAY LFAV LFYG LFQJ
LFAB LFAG LFAE LFOW LFQV LFAF LFAD LFAP LFAR LFSJ LFSR LFJS LFPC LFPG LFPO LFPB LFPN LFOB
EBFN EBOS EBMO EBZU EBKT EBAM EBTY EBIS EBGG EBCV EBSG EBUL EBBR EBCI EBLG EBAW EBAV EBTN EBNM
EBMB EBBE EBFS EBSU EBDT EBST EBZR EBBT EBHN EBOR EBZH EBKH EBLE EBWE EBBX EBSH EBZW EBSL EBBL
EBNE EBTX EBSP EBGB EBMG EBML EBLN EBBY EBBZ EBCF
EHMZ EHWO EHSE EHGR EHBK EHBD EHEH
EGKH EGMF EGSQ EGTO EGMC EGSW EGKL EGMT EGML EGSR EGKB EGST EGLC EGSO EGSG EGUW EGSL EGHB EGMD
EGKE EGKK EGLL EGMH
""".split()


def _txt(el):
    """Texte d'un élément HTML, retours à la ligne (<br>) conservés."""
    for br in el.find_all("br"):
        br.replace_with("\n")
    t = el.get_text()
    t = re.sub(r"[ \t\xa0]+", " ", t)
    return "\n".join(l.strip() for l in t.split("\n") if l.strip())


def parse_message(html):
    """showmessage.php -> {"code", "name", "blocks": [{label, text}], "fir": {"name", "blocks"}}."""
    soup = BeautifulSoup(html, "html.parser")
    st = {"code": "", "name": "", "blocks": [], "fir": None}
    cur = st["blocks"]
    head = []
    label = None
    for sp in soup.find_all("span"):
        cls = " ".join(sp.get("class") or [])
        if "texte3" in cls:
            v = _txt(sp)
            if not v:
                continue
            if v.upper() == "FIR":
                st["fir"] = {"name": "", "blocks": []}
                cur = st["fir"]["blocks"]
            elif st["fir"] is not None:
                if not st["fir"]["blocks"]:
                    st["fir"]["name"] = (st["fir"]["name"] + " " + v).strip()
            elif not st["blocks"]:
                head.append(v)
        elif "texte2" in cls:
            label = _txt(sp).rstrip(" :")
        elif "texte1" in cls:
            cur.append({"label": label or "", "text": _txt(sp)})
            label = None
    if head:
        st["code"] = head[0]
        st["name"] = " ".join(head[1:])
    return st


def login(session, user, password):
    session.get(BASE + "login.php", timeout=20)
    r = session.post(BASE + "ajax/login_valid.php", timeout=20,
                     data={"login": user, "password": hashlib.md5(password.encode("utf-8")).hexdigest()},
                     headers={"X-Requested-With": "XMLHttpRequest", "Referer": BASE + "login.php"})
    if r.text.strip() != "ok":
        raise RuntimeError("connexion AéroWeb refusée : " + r.text.strip()[:120])


def fetch_map(session):
    """Stations de la zone : position, nom, METAR, code couleur visibilité/plafond."""
    url = (BASE + "ajax/ajax_trajet_get_stations.php?reseau=&type=oaci&SERVICE=WFS&VERSION=1.0.0"
           "&REQUEST=GetFeature&SRS=EPSG%3A900913&BBOX=" + ",".join(str(v) for v in BBOX) + "&LEVEL=8")
    r = session.get(url, timeout=30, headers={"X-Requested-With": "XMLHttpRequest", "Referer": BASE + "accueil.php"})
    r.raise_for_status()
    soup = BeautifulSoup(r.content, "html.parser")
    date = soup.find("date")
    out = {}
    for op in soup.find_all("opmet"):
        code = op.get("id")
        if not code:
            continue
        name = op.find("name")
        d = {"name": name.get_text(strip=True) if name else "",
             "lat": float(op.get("latitude") or 0), "lon": float(op.get("longitude") or 0)}
        m = op.find("speci") or op.find("metar")
        if m is not None:
            d.update({"color": m.get("color_odmx") or "", "visi": m.get("visi_odmx") or "",
                      "plafond": m.get("plafond_odmx") or "", "metar": m.get_text(strip=True)})
        for tag, key in (("tafl", "taf"), ("tafc", "taf_court")):
            t = op.find(tag)
            if t is not None and t.get_text(strip=True):
                d[key] = t.get_text(strip=True)
        out[code] = d
    return out, (date.get_text(strip=True) if date else "")


def fetch_aeroweb():
    user, pwd = os.getenv("AEROWEB_USER"), os.getenv("AEROWEB_PASS")
    t0 = time.time()
    result = {"source": "AéroWeb (aviation.meteo.fr)", "generated": int(time.time() * 1000),
              "stations": {}, "firs": {}}
    if not user or not pwd:
        result["error"] = ("Identifiants AéroWeb absents : ajouter les secrets AEROWEB_USER et AEROWEB_PASS "
                           "dans GitHub (Settings → Secrets and variables → Actions).")
        _write(result)
        print("AéroWeb : identifiants absents")
        return False
    s = requests.Session()
    s.headers["User-Agent"] = UA
    try:
        login(s, user, pwd)
        stations, date = fetch_map(s)
        result["date"] = date
        codes = list(dict.fromkeys(STATIONS))

        def one(code):
            try:
                r = s.get(BASE + "showmessage.php", params={"code": code}, timeout=25,
                          headers={"X-Requested-With": "XMLHttpRequest", "Referer": BASE + "accueil.php"})
                r.encoding = r.encoding or "ISO-8859-1"
                return code, parse_message(r.text)
            except Exception as e:  # une station en échec ne bloque pas les autres
                return code, {"error": str(e)}

        with ThreadPoolExecutor(max_workers=8) as ex:
            for code, msg in ex.map(one, codes):
                st = stations.get(code, {})
                if msg.get("error"):
                    st["error"] = msg["error"]
                else:
                    if msg.get("name") and not st.get("name"):
                        st["name"] = msg["name"]
                    st["blocks"] = msg["blocks"]
                    fir = msg.get("fir")
                    if fir and fir.get("name"):
                        key = fir["name"].split()[0]
                        st["fir"] = key
                        # même FIR pour plusieurs aérodromes : on garde la version la plus complète
                        if len(fir["blocks"]) >= len(result["firs"].get(key, {}).get("blocks", [])):
                            result["firs"][key] = fir
                if st.get("blocks") or st.get("metar"):
                    result["stations"][code] = st
        print(f"AéroWeb : {len(result['stations'])} aérodromes en {time.time() - t0:.1f}s")
        _write(result)
        return True
    except Exception as e:
        result["error"] = "Récupération AéroWeb en échec : " + str(e)
        print(result["error"])
        _write(result)
        return False


def _write(data):
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)


if __name__ == "__main__":
    fetch_aeroweb()
