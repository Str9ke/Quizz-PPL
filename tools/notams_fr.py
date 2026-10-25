"""NOTAM officiels France + Pays-Bas + Belgique — SIA, SOFIA-Briefing (https://sofia-briefing.aviation-civile.gouv.fr).

Données publiques sous Licence Ouverte 2.0 (CGU SOFIA) : réutilisables à condition de ne pas les
altérer et de citer la source et la date de mise à jour -> le texte des NOTAM est recopié tel quel
(anglais + traduction française fournie par le SIA), source et heure de production dans le fichier.

Deux bulletins (PIB) VFR, valables 24 h à partir de maintenant :
  - « FIR » : NOTAM en route et avertissements des FIR Paris, Reims et Brest, du sol au FL 115 ;
  - « aérodromes » : NOTAM des aérodromes français de la zone (liste tools/lf_aerodromes.txt,
    au nord de la France, par lots : SOFIA refuse les très longues listes).
Sortie : notams_france.json (liste à plat, chaque NOTAM avec position/rayon/limites/dates) ;
l'onglet NOTAMs de navlog.html garde ceux qui concernent la route.

Usage : python tools/notams_fr.py   (aussi appelé par fetch_notams.py, partie « notam_fr »)
"""
import datetime as dt
import html
import json
import os
import re
import sys
import time

import requests

BASE = "https://sofia-briefing.aviation-civile.gouv.fr"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "notams_france.json")
FIRS = ["LFFF", "LFEE", "LFRR", "EHAA", "EBBU"]   # France + Pays-Bas + Belgique/Luxembourg
AD_LISTS = ["lf_aerodromes.txt", "eh_aerodromes.txt", "eb_aerodromes.txt"]
BATCH = 30


def _session():
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (QuizPPL briefing; +https://str9ke.github.io/Quizz-PPL/)",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": BASE + "/sofia/pages/prepavol.html",
    })
    s.get(BASE + "/sofia/pages/prepavol.html", timeout=40)   # cookie de session
    return s


def _pib(s, data):
    """Envoie une demande de bulletin ; SOFIA répond une page HTML dont le <div id="Message">
    contient le bulletin en JSON."""
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    data = dict(data, valid_from=now, duration="2400", traffic="V", isFromSofia="true",
                uuid="51a1f0e2-%04x-4%03x-8%03x-%012x" % (os.getpid() & 0xffff, int(time.time()) & 0xfff,
                                                            len(json.dumps(data)) & 0xfff, int(time.time() * 1000)))
    for attempt in range(3):
        r = s.post(BASE + "/sofia", data=data, timeout=120)
        m = re.search(r'<div id="Message">(.*?)</div>', r.text, re.S)
        msg = html.unescape(m.group(1)) if m else r.text
        if r.status_code == 200 and m:
            try:
                return json.loads(msg)
            except ValueError:
                pass
        if "Aucun a" in msg and "rodrome trouv" in msg:
            return "UNKNOWN_AD"          # un code de la liste est inconnu de SOFIA
        print(f"  SOFIA HTTP {r.status_code} ({msg[:120]!r}), nouvel essai", flush=True)
        time.sleep(4 * (attempt + 1))
    return None


def _aero(s, ads, found, unknown):
    """Bulletin d'aérodromes. Un seul code inconnu de SOFIA fait refuser tout le lot : on coupe
    alors le lot en deux jusqu'à isoler les codes inconnus (terrains privés, ULM…)."""
    d = _pib(s, {":operation": "postAeroPibRequest", "aero[]": ads})
    time.sleep(1.5)                     # SOFIA est un service public : on ne le presse pas
    if d == "UNKNOWN_AD":
        if len(ads) == 1:
            unknown.append(ads[0])
            return
        h = len(ads) // 2
        _aero(s, ads[:h], found, unknown)
        _aero(s, ads[h:], found, unknown)
    elif d:
        _walk(d.get("listnotams"), found, "AD")


def _walk(node, out, section):
    """Le bulletin range les NOTAM dans des groupes imbriqués (par aérodrome, par objet…) :
    on récupère tout objet qui a une ligne Q et un texte E, où qu'il soit."""
    if isinstance(node, dict):
        if "qLine" in node and "itemE" in node:
            out.append((section, node))
            return
        for v in node.values():
            _walk(v, out, section)
    elif isinstance(node, list):
        for v in node:
            _walk(v, out, section)


def _coord(c):
    m = re.match(r"(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])", c or "")
    if not m:
        return None, None
    lat = int(m[1]) + int(m[2]) / 60
    lon = int(m[4]) + int(m[5]) / 60
    return round(-lat if m[3] == "S" else lat, 4), round(-lon if m[6] == "W" else lon, 4)


def _slim(section, n):
    q = n.get("qLine") or {}
    lat, lon = _coord(n.get("coordinates"))
    ml = n.get("multiLanguage") or {}
    ref = ""
    if n.get("referredNumber"):
        ref = f"{n.get('referredSeries', '')}{int(n['referredNumber']):04d}/{int(n.get('referredYear') or 0):02d}"
    return {
        "id": f"{n.get('series', '')}{int(n.get('number') or 0):04d}/{int(n.get('year') or 0):02d}",
        "cc": ((n.get("itemA") or q.get("fir") or "")[:2]).upper(),
        "type": n.get("type"), "ref": ref, "sec": section,
        "a": n.get("itemA", ""), "fir": q.get("fir"),
        "q": (q.get("code23") or "") + (q.get("code45") or ""),
        "purpose": q.get("purpose"), "scope": q.get("scope"),
        "lo": q.get("lower"), "hi": q.get("upper"),
        "lat": lat, "lon": lon, "r": n.get("radius"),
        "b": n.get("startValidity"), "c": n.get("endValidity"),
        "d": n.get("itemD") or "", "e": n.get("itemE") or "", "e_fr": ml.get("itemE") or "",
        "f": n.get("itemF") or "", "g": n.get("itemG") or "",
    }


def fetch(out_path=OUT):
    t0 = time.time()
    s = _session()
    found = []
    firs = _pib(s, {":operation": "postAreaPibRequest", "fl_lower": "0", "fl_upper": "115", "fir[]": FIRS})
    if isinstance(firs, dict):
        _walk(firs.get("listnotams"), found, "FIR")
        _walk(firs.get("listFIRs"), found, "FIR")
    ads = []
    for fn in AD_LISTS:      # SOFIA (SIA) reçoit aussi les NOTAM étrangers via la base européenne EAD
        try:
            ads += open(os.path.join(ROOT, "tools", fn), encoding="utf-8").read().split()
        except OSError:
            pass
    unknown = []
    for i in range(0, len(ads), BATCH):
        _aero(s, ads[i:i + BATCH], found, unknown)
    if unknown:
        print("Aérodromes inconnus de SOFIA (à retirer de tools/lf_aerodromes.txt) :", " ".join(unknown))
    seen, notams = set(), []
    for sec, n in found:
        x = _slim(sec, n)
        key = x["id"] + "|" + x["a"]
        if key in seen:
            continue
        seen.add(key)
        notams.append(x)
    notams.sort(key=lambda x: (x["sec"] != "AD", x["a"], x["id"]))
    res = {
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "SIA — SOFIA-Briefing (Licence Ouverte 2.0 ; NOTAM étrangers reçus de la base européenne EAD), bulletins VFR FIR " + "/".join(FIRS)
                  + f" (SFC–FL115) et {len(ads)} aérodromes",
        "firs": FIRS, "aerodromes": ads, "count": len(notams), "notams": notams,
    }
    if not notams:
        raise RuntimeError("aucun NOTAM reçu de SOFIA")
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, out_path)
    print(f"NOTAM France : {len(notams)} NOTAM ({sum(1 for n in notams if n['sec'] == 'AD')} aérodromes) "
          f"en {time.time() - t0:.1f}s")
    return res


def _spaced(t):
    """SOFIA colle parfois les groupes (« Q1004NOSIG », « SCT030BECMG ») : on remet l'espace."""
    t = re.sub(r"(?<=\S)(?=(?:BECMG|TEMPO|NOSIG|PROB\d{2}|FM\d{6}|RMK)(?![A-Z]))", " ", t or "")
    return re.sub(r"\s+", " ", t).strip()


def fetch_opmet(stations=None, out_path=os.path.join(ROOT, "opmet_nl.json")):
    """METAR / TAF officiels des Pays-Bas (+ SIGMET/AIRMET/GAMET de FIR joints par le SIA) (KNMI, diffusés par le réseau OPMET aéronautique) via
    SOFIA-Briefing (SIA) -> opmet_nl.json. Les aérodromes sans observation sont ignorés."""
    t0 = time.time()
    if stations is None:
        try:
            stations = open(os.path.join(ROOT, "tools", "eh_aerodromes.txt"), encoding="utf-8").read().split()
        except OSError:
            stations = []
    s = _session()
    s.headers["Accept"] = "application/json"
    out, other, seen = [], [], set()
    for i in range(0, len(stations), 25):
        try:
            r = s.post(BASE + "/sofia", data={":operation": "postOpmet", "aerodromes[]": stations[i:i + 25], "isFromSofia": "true"}, timeout=90)
            d = json.loads(r.json().get("status.message") or "{}")
        except Exception as e:
            print("  OPMET SOFIA :", e)
            continue
        for a in d.get("aerodromes") or []:
            ops = a.get("opmets") or []
            met = [_spaced(o.get("text")) for o in ops if (o.get("type") or "").upper() in ("METAR", "SPECI")]
            taf = [_spaced(o.get("text")) for o in ops if (o.get("type") or "").upper().startswith("TAF")]
            if met or taf:
                out.append({"icao": a.get("icao"), "name": a.get("name"), "metar": met, "taf": taf})
            # messages de FIR joints par le SIA (SIGMET, AIRMET, GAMET…) : une seule fois chacun
            for o in ops:
                typ = (o.get("type") or "").upper()
                if typ in ("METAR", "SPECI") or typ.startswith("TAF"):
                    continue
                txt = (o.get("text") or "").strip()
                if txt and txt[:80] not in seen:
                    seen.add(txt[:80])
                    other.append({"type": typ, "text": txt})
        time.sleep(1)
    res = {"generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "SIA — SOFIA-Briefing (Licence Ouverte 2.0) ; observations KNMI (réseau OPMET aéronautique)",
           "stations": out, "fir": other}
    if not out:
        raise RuntimeError("aucun METAR néerlandais reçu")
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, out_path)
    print(f"OPMET Pays-Bas : {len(out)} aérodromes en {time.time() - t0:.1f}s")
    return res


if __name__ == "__main__":
    if "--opmet" in sys.argv:
        fetch_opmet()
        sys.exit(0)
    try:
        fetch()
    except Exception as e:
        print("NOTAM France en échec :", e)
        sys.exit(1)
