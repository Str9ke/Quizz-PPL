import os
import requests
import cloudscraper
import fitz  # PyMuPDF
from bs4 import BeautifulSoup
from urllib.parse import urljoin
import json
import re


def _dms_to_deg(token):
    """Convertit '510539N' -> 51.094167 ou '0042341E' -> 4.394722 (degrés décimaux signés)."""
    m = re.match(r'(\d{2,3})(\d{2})(\d{2})([NSEW])', token)
    if not m:
        return None
    deg, mn, sec, hemi = m.groups()
    val = int(deg) + int(mn) / 60 + int(sec) / 3600
    if hemi in ('S', 'W'):
        val = -val
    return round(val, 6)


_COORD_PAIR_RE = re.compile(r'(\d{6}N)\s+(\d{7}E)')
# Le rayon apparaît dans les deux ordres selon la formulation du NOTAM :
# "RADIUS 01NM" (le plus courant) ou "2NM RADIUS" (ex. "ARC OF CIRCLE, 2NM RADIUS").
# La virgule décimale ("1,5NM") est normalisée en point avant conversion.
_RADIUS_NM_RE = re.compile(r'RADIUS[,\s]+([\d]+[.,]?[\d]*)\s*NM|([\d]+[.,]?[\d]*)\s*NM\s+RADIUS', re.I)
_RADIUS_M_RE = re.compile(r'RADIUS\s+(\d+)\s*M\b', re.I)
_WARNING_BLOCK_RE = re.compile(
    r'FROM:\s*(\d{2} \w{3} \d{4} \d{2}:\d{2})\s*TILL:\s*(\d{2} \w{3} \d{4} \d{2}:\d{2})\s*'
    r'(?:SCHEDULE:\s*(.+?)\n)?'
    r'(.*?)'
    r'Lower limit:\s*([\w./ ]+?)\s+Upper limit:\s*([\w./ ]+?)\s+([A-Z]\d{4}/\d{2})',
    re.S
)


def _extract_warning_coords(text):
    pairs = []
    for m in _COORD_PAIR_RE.finditer(text):
        lat, lon = _dms_to_deg(m.group(1)), _dms_to_deg(m.group(2))
        if lat is not None and lon is not None:
            pairs.append([lat, lon])
    return pairs


def _classify_warning_geometry(text):
    """Reconstruit au mieux la géométrie d'un avis (cercle, polygone, polygone à arc,
    point seul, ou 'unlocated' si aucune coordonnée n'est donnée dans le texte — ex.
    un nom de club/terrain sans lat/lon, non plaçable sur une carte sans référentiel externe).
    Les polygones à arc ("AN ARC OF CIRCLE ... TRACED CLOCKWISE TO ...") sont volontairement
    simplifiés en tracé polygonal reliant les sommets listés (suffisant pour une alerte
    visuelle, pas une distance de séparation réglementaire précise)."""
    coords = _extract_warning_coords(text)
    if not coords:
        return {'type': 'unlocated'}

    is_arc = bool(re.search(r'ARC OF CIRCLE', text, re.I))
    radius_m_match = _RADIUS_NM_RE.search(text)
    radius_nm = None
    if radius_m_match:
        raw = (radius_m_match.group(1) or radius_m_match.group(2)).replace(',', '.')
        radius_nm = float(raw)
    radius_m_only = _RADIUS_M_RE.search(text)
    radius_m_only = int(radius_m_only.group(1)) if radius_m_only else None

    if is_arc:
        return {'type': 'polygon_arc', 'vertices': coords, 'arcRadiusNm': radius_nm}
    if len(coords) == 1:
        if radius_nm:
            return {'type': 'circle', 'center': coords[0], 'radiusNm': radius_nm}
        if radius_m_only:
            return {'type': 'circle', 'center': coords[0], 'radiusNm': round(radius_m_only / 1852, 4)}
        return {'type': 'point', 'center': coords[0]}
    return {'type': 'polygon', 'vertices': coords}


def parse_daily_warnings(raw_text):
    """Découpe le texte brut du PIB 'WARNINGS' en une liste d'avis structurés, chacun avec
    sa géométrie reconstruite au mieux pour affichage sur une mini-carte côté client."""
    warnings = []
    for m in _WARNING_BLOCK_RE.finditer(raw_text):
        frm, till, schedule, body, lower, upper, ref = m.groups()
        body = ' '.join(body.split())
        if not body:
            continue
        warnings.append({
            'ref': ref,
            'from': frm,
            'till': till,
            'schedule': (schedule or '').strip() or None,
            'text': body,
            'lower': lower.strip(),
            'upper': upper.strip(),
            'geometry': _classify_warning_geometry(body),
        })
    return warnings


def convert_pdf_to_html(pdf_path, html_path, img_prefix):
    """Convert a PDF file to HTML with cropped PNG images."""
    doc = fitz.open(pdf_path)
    html_images = ""
    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        blocks = page.get_text("blocks")
        if blocks:
            x0 = min(b[0] for b in blocks)
            y0 = min(b[1] for b in blocks)
            x1 = max(b[2] for b in blocks)
            y1 = max(b[3] for b in blocks)
            margin = 10
            r_mediabox = page.mediabox
            new_x0 = max(r_mediabox.x0, x0 - margin)
            new_y0 = max(r_mediabox.y0, y0 - margin)
            new_x1 = min(r_mediabox.x1, x1 + margin)
            new_y1 = min(r_mediabox.y1, y1 + margin)
            if new_x0 < new_x1 and new_y0 < new_y1:
                rect = fitz.Rect(new_x0, new_y0, new_x1, new_y1)
                page.set_cropbox(rect)
        pix = page.get_pixmap(dpi=150)
        img_filename = f"{img_prefix}_{page_num}.png"
        pix.save(img_filename)
        html_images += f'<img class="map-img" src="{img_filename}" />\n'
    
    html_content = f"""<!DOCTYPE html><html><head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1.0'>
<style>
body {{ margin:0; padding:0; background:transparent; display:flex; flex-direction:column; align-items:center; font-family:sans-serif; }}
.nav-container {{ display:flex; gap:15px; padding:10px; background:rgba(255,255,255,0.9); position:sticky; top:0; z-index:100; border-radius:8px; align-items:center; margin-bottom:5px; box-shadow:0 2px 5px rgba(0,0,0,0.1); }}
.nav-btn {{ padding:8px 16px; background:#667eea; color:white; border:none; border-radius:6px; font-weight:bold; cursor:pointer; }}
.nav-btn:active {{ background:#5a6ad6; }}
.map-img {{ width:100%; display:none; margin:0 auto; border:1px solid #ccc; }}
.map-img.active {{ display:block; }}
</style>
</head><body>
<div class="nav-container" id="navContainer">
    <button class="nav-btn" onclick="changeImage(-1)">&#x25C0; Pr&eacute;c&eacute;dent</button>
    <span id="counter" style="font-weight:bold; font-size:14px; min-width:40px; text-align:center;"></span>
    <button class="nav-btn" onclick="changeImage(1)">Suivant &#x25B6;</button>
</div>
<div id="imageContainer" style="width:100%;">
{html_images}
</div>
<script>
    var currentImg = 0;
    var imgs = document.querySelectorAll('.map-img');
    function init() {{
        if(imgs.length <= 1) {{ document.getElementById('navContainer').style.display = 'none'; }}
        if(imgs.length > 0) showImage(0);
    }}
    function showImage(n) {{
        imgs.forEach(function(img) {{ img.classList.remove('active'); }});
        currentImg = n;
        if(currentImg >= imgs.length) currentImg = 0;
        if(currentImg < 0) currentImg = imgs.length - 1;
        imgs[currentImg].classList.add('active');
        document.getElementById('counter').innerText = (currentImg + 1) + " / " + imgs.length;
        // Tell parent iframe to resize to fit just the active image!
        setTimeout(function() {{
            try {{ window.parent.postMessage({{type: 'resize', height: document.body.scrollHeight}}, '*'); }} catch(e){{}}
        }}, 50);
    }}
    function changeImage(dir) {{ showImage(currentImg + dir); }}
    window.onload = init;
</script>
</body></html>"""
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    doc.close()

def generate_error_html(filename, title, session, exception_str):
    import datetime
    error_html = (
        f"<!DOCTYPE html><html><head><meta charset='utf-8'>"
        f"<meta name='viewport' content='width=device-width, initial-scale=1.0'>"
        f"<style>body{{font-family:monospace;font-size:12px;padding:10px;margin:0;background:#ffeeee;}}</style>"
        f"</head><body><h3>Erreur {title} Skeyes</h3>"
        f"<p><strong>Session perdue ou erreur technique.</strong></p>"
        f"<p>Exception: {exception_str}</p>"
        f"<p>Date/Heure: " + datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S") + "</p>"
        f"<p><strong>Cookies lors de la tentative :</strong> {session.cookies.get_dict()}</p>"
        f"</body></html>"
    )
    with open(filename, "w", encoding="utf-8") as f:
        f.write(error_html)


def fetch_skeyes_animation(session, detail_url, output_html_name, title):
    print(f"--- Fetching {title} ({output_html_name}) ---")
    try:
        resp = session.get(detail_url, headers={"Referer": "https://ops.skeyes.be/opersite/home.do"})
        resp.raise_for_status()

        matches = re.findall(r"'/remotesensing/([^']+)'", resp.text)
        matches += re.findall(r'"/remotesensing/([^"]+)"', resp.text)
        
        # Filter for known image extensions and deduplicate
        img_paths = sorted([m for m in list(set(matches)) if m.lower().endswith(('.jpg', '.png', '.gif')) and 'animation_buttons' not in m])
        
        if not img_paths:
            print(f"No images found for {title}")
            return
            
        print(f"Found {len(img_paths)} images for {title}")
        html_images = ""
        img_prefix = output_html_name.replace(".html", "")
        for i, path in enumerate(img_paths):
            img_url = f"https://ops.skeyes.be/remotesensing/{path}"
            img_resp = session.get(img_url)
            if img_resp.status_code == 200:
                img_ext = path.split('.')[-1]
                safe_name = f"{img_prefix}_{i}.{img_ext}"
                with open(safe_name, "wb") as f:
                    f.write(img_resp.content)
                html_images += f'<img class="map-img" src="{safe_name}" />\n'
                
        html_content = f"""<!DOCTYPE html><html><head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1.0'>
<style>
body {{ margin:0; padding:0; background:transparent; display:flex; flex-direction:column; align-items:center; font-family:sans-serif; }}
.nav-container {{ display:flex; gap:15px; padding:10px; background:rgba(255,255,255,0.9); position:sticky; top:0; z-index:100; border-radius:8px; align-items:center; margin-bottom:5px; box-shadow:0 2px 5px rgba(0,0,0,0.1); }}
.nav-btn {{ padding:8px 16px; background:#667eea; color:white; border:none; border-radius:6px; font-weight:bold; cursor:pointer; }}
.nav-btn:active {{ background:#5a6ad6; }}
.map-img {{ width:100%; display:none; margin:0 auto; max-width:100%; height:auto; border:1px solid #ccc; }}
.map-img.active {{ display:block; }}
</style>
</head><body>
<div class="nav-container" id="navContainer">
    <button class="nav-btn" onclick="changeImage(-1)">&#x25C0; Pr&eacute;c&eacute;dent</button>
    <span id="counter" style="font-weight:bold; font-size:14px; min-width:40px; text-align:center;"></span>
    <button class="nav-btn" onclick="changeImage(1)">Suivant &#x25B6;</button>
</div>
<div id="imageContainer" style="width:100%; position:relative; overflow:hidden;">
{html_images}
</div>
<script>
    var currentImg = {len(img_paths)-1}; 
    var imgs = document.querySelectorAll('.map-img');
    function init() {{
        if(imgs.length <= 1) {{ document.getElementById('navContainer').style.display = 'none'; }}
        if(imgs.length > 0) showImage(currentImg);
    }}
    function showImage(n) {{
        imgs.forEach(function(img) {{ img.classList.remove('active'); }});
        currentImg = n;
        if(currentImg >= imgs.length) currentImg = 0;
        if(currentImg < 0) currentImg = imgs.length - 1;
        imgs[currentImg].classList.add('active');
        document.getElementById('counter').innerText = (currentImg + 1) + " / " + imgs.length;
        setTimeout(function() {{
            try {{ window.parent.postMessage({{type: 'resize', height: document.body.scrollHeight}}, '*'); }} catch(e){{}}
        }}, 100);
    }}
    function changeImage(dir) {{ showImage(currentImg + dir); }}
    window.onload = init;
</script>
</body></html>"""
        with open(output_html_name, "w", encoding="utf-8") as f:
            f.write(html_content)
            
    except Exception as e:
        print(f"Error fetching animation {title}: {e}")

def fetch_opmet(session):
    """Fetch OPMET (METAR/TAF/SIGMET/GAMET) data from Skeyes."""
    print("\n--- Fetching OPMET data ---")
    print(f"Cookies before OPMET: {session.cookies.get_dict()}")
    
    # Step 1: Initialize the OPMET form page
    init_url_1 = "https://ops.skeyes.be/opersite/opmeteoindex.do?cmd=init"
    resp = session.get(init_url_1, headers={"Referer": "https://ops.skeyes.be/opersite/home.do"})
    print(f"OPMET init 1: status={resp.status_code}, url={resp.url}, length={len(resp.text)}")
    
    soup = BeautifulSoup(resp.text, 'html.parser')
    has_login = soup.find('form', {'name': 'loginForm'}) is not None
    has_session_lost = "Session perdue" in resp.text
    print(f"OPMET init 1: has_login_form={has_login}, has_session_lost={has_session_lost}")
    
    if has_login or has_session_lost:
        with open("_debug_opmet_init1.html", "w", encoding="utf-8") as dbg:
            dbg.write(resp.text)
        raise Exception(f"OPMET init 1 failed: login_form={has_login}, session_lost={has_session_lost}, url={resp.url}")

    # Step 2: Second Init explicitly for opmet.do
    init_url_2 = "https://ops.skeyes.be/opersite/opmet.do?cmd=init"
    resp = session.get(init_url_2, headers={"Referer": init_url_1})
    resp.raise_for_status()

    # Step 3: Payload — ICAO codes must be separated by semicolons
    payload = [
        ('templateName', ''),
        ('newTemplateName', ''),
        ('selectCountry', ''),
        ('template', 'select'),
        ('icaocodes', 'EBBR;EBCI;EBSG;EBAW;EBBE;EBBL;EBCV;EBFN;EBFS;EBLG;EBOS;ELLX'),
        ('land1', 'on'),
        ('metar', 'on'),
        ('taf', 'on'),
        ('sigmet', 'on'),
        ('gametairmet', 'on'),
    ]

    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': init_url_2
    }
    
    post_url = "https://ops.skeyes.be/opersite/opmetData.do?cmd=retrieveOpmet"
    submit_resp = session.post(post_url, data=payload, headers=headers)
    submit_resp.raise_for_status()

    soup = BeautifulSoup(submit_resp.text, 'html.parser')
    if soup.find('form', {'name': 'loginForm'}) or "Session perdue" in submit_resp.text:
        raise Exception("OPMET fetch returned login form or session lost error")

    # Check for actual METAR data lines (e.g. "METAR EBBR" or "TAF EBBR")
    has_metar = bool(re.search(r'METAR\s+EB|TAF\s+EB|SIGMET|GAMET', submit_resp.text))
    has_error = 'Invalid characters' in submit_resp.text or 'Errors' in submit_resp.text
    print(f"OPMET POST response: has_metar={has_metar}, has_error={has_error}, length={len(submit_resp.text)}")

    if has_error:
        print("OPMET: Form returned errors")
        with open("_debug_opmet_response.html", "w", encoding="utf-8") as dbg:
            dbg.write(submit_resp.text)

    # Extract METAR/TAF data from HTML response
    if has_metar:
        # Get raw text from the body, stripping Skeyes page chrome
        body = soup.find('body')
        if body:
            for tag in body.find_all(['form', 'script', 'style', 'link', 'nav', 'header']):
                tag.decompose()
            raw_text = body.get_text('\n')
        else:
            raw_text = soup.get_text('\n')

        # Clean up: collapse excessive blank lines, fix broken words from table layout
        lines = raw_text.split('\n')
        cleaned = []
        for line in lines:
            stripped = line.rstrip()
            if stripped:
                cleaned.append(stripped)
            elif cleaned and cleaned[-1] != '':
                cleaned.append('')
        raw_text = '\n'.join(cleaned).strip()
        # Remove leading/trailing blank lines between sections
        raw_text = re.sub(r'\n{3,}', '\n\n', raw_text)

        # Parse into sections
        sections = {}
        current_section = 'header'
        sections[current_section] = []

        for line in raw_text.split('\n'):
            # Detect section headers
            line_upper = line.strip().upper()
            if line_upper == 'METAR':
                current_section = 'METAR'
                sections[current_section] = []
                continue
            elif line_upper == 'TAF FC':
                current_section = 'TAF FC'
                sections[current_section] = []
                continue
            elif line_upper == 'TAF FT':
                current_section = 'TAF FT'
                sections[current_section] = []
                continue
            elif line_upper == 'SIGMET':
                current_section = 'SIGMET'
                sections[current_section] = []
                continue
            elif line_upper == 'GAMET':
                current_section = 'GAMET'
                sections[current_section] = []
                continue
            elif line_upper == 'AIRMET':
                current_section = 'AIRMET'
                sections[current_section] = []
                continue

            if current_section not in sections:
                sections[current_section] = []
            sections[current_section].append(line)

        # Build entries per section: join continuation lines for METAR/TAF
        def format_entries(lines):
            """Group related lines into individual reports."""
            entries = []
            current = []
            for line in lines:
                stripped = line.strip()
                if not stripped:
                    if current:
                        entries.append(' '.join(current))
                        current = []
                    continue
                # New METAR/SPECI/TAF entry or "not provided" line
                if re.match(r'^(METAR|SPECI|TAF)\s+E[BL]', stripped) or re.match(r'^E[BL]\w+\s+(not provided|NIL)', stripped):
                    if current:
                        entries.append(' '.join(current))
                    current = [stripped]
                else:
                    current.append(stripped)
            if current:
                entries.append(' '.join(current))
            return entries

        # Section labels and icons
        section_config = [
            ('METAR', '🌤️', 'METAR'),
            ('TAF FC', '📋', 'TAF Court Terme'),
            ('TAF FT', '📋', 'TAF Long Terme'),
            ('SIGMET', '⚠️', 'SIGMET'),
            ('GAMET', '📄', 'GAMET'),
            ('AIRMET', '📄', 'AIRMET'),
        ]

        def colorize_metar_taf(text):
            """Add color spans to METAR/TAF parameters."""
            # Already HTML-escaped input
            # Wind: 08003KT, VRB01KT, 08003G15KT, 050V110
            text = re.sub(r'\b(\d{3}|VRB)(\d{2,3})(G\d{2,3})?(KT|MPS)\b',
                          r'<span class="wx-wind">\1\2\3\4</span>', text)
            text = re.sub(r'\b(\d{3}V\d{3})\b', r'<span class="wx-wind">\1</span>', text)
            # Visibility: 4000, 9999, CAVOK
            text = re.sub(r'\b(CAVOK)\b', r'<span class="wx-vis-good">\1</span>', text)
            text = re.sub(r'(?<!\d)\b(\d{4})\b(?!\d|Z|/)',
                          lambda m: f'<span class="wx-vis-{"good" if int(m.group(1))>=5000 else "bad"}">{m.group(1)}</span>', text)
            # Weather phenomena: BR, FG, RA, SN, TS, etc.
            text = re.sub(r'\b(\+?-?(?:VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)?(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+)\b',
                          r'<span class="wx-phen">\1</span>', text)
            # NSW (No Significant Weather)
            text = re.sub(r'\b(NSW)\b', r'<span class="wx-vis-good">\1</span>', text)
            # Clouds: FEW, SCT, BKN, OVC, NCD, NSC, VV///
            text = re.sub(r'\b(FEW|SCT|BKN|OVC|NCD|NSC)(\d{3})(///|CB|TCU)?\b',
                          r'<span class="wx-cloud">\1\2\3</span>', text)
            text = re.sub(r'\b(VV\d{3}|VV///)\b', r'<span class="wx-cloud">\1</span>', text)
            # QNH: Q1024
            text = re.sub(r'\b(Q\d{4})\b', r'<span class="wx-qnh">\1</span>', text)
            # Temperature: 09/08, M02/M05
            text = re.sub(r'\b(M?\d{2}/M?\d{2})\b', r'<span class="wx-temp">\1</span>', text)
            # Trend keywords: NOSIG, BECMG, TEMPO, PROB30, PROB40
            text = re.sub(r'\b(NOSIG|BECMG|TEMPO|PROB\d{2}|INTER)\b',
                          r'<span class="wx-trend">\1</span>', text)
            # Military color codes: BLU, WHT, GRN, YLO, AMB, RED
            text = re.sub(r'\b(BLU|WHT|GRN|YLO|AMB|RED)\b',
                          lambda m: f'<span class="wx-mil-{m.group(1).lower()}">{m.group(1)}</span>', text)
            return text

        def colorize_gamet(text):
            """Add color spans to GAMET wind/temperature/visibility parameters."""
            # Already HTML-escaped input
            # Section labels: WIND/T:, SFC WIND..., PSYS:, etc.
            text = re.sub(r'^((?:WIND/T|SFC WIND[^:]*|SFC VIS[^:]*|PSYS|SIG CLD|CLD|FZLVL|MNM QNH|OTLK|SECN\s+[IV]+):)',
                          r'<span class="gamet-label">\1</span>', text, flags=re.MULTILINE)
            # Wind direction/speed: 140/05KT, 160-190/05KT, 030-090/04-08KT
            text = re.sub(r'\b(\d{3}(?:-\d{3})?/\d{2,3}(?:-\d{2,3})?KT)\b',
                          r'<span class="wx-wind">\1</span>', text)
            # Variable wind: VRB/03-05KT
            text = re.sub(r'\b(VRB/\d{2,3}(?:-\d{2,3})?KT)\b',
                          r'<span class="wx-wind">\1</span>', text)
            # Variable wind: VRB 03KT
            text = re.sub(r'\b(VRB\s+\d{2,3}KT)\b',
                          r'<span class="wx-wind">\1</span>', text)
            # METAR-style wind in case: 02004KT
            text = re.sub(r'\b((?:\d{3}|VRB)\d{2,3}(?:G\d{2,3})?KT)\b',
                          r'<span class="wx-wind">\1</span>', text)
            # Temperatures: PS13, MS04
            text = re.sub(r'\b([PM]S\d{1,2})\b',
                          r'<span class="wx-temp">\1</span>', text)
            # Altitudes & Flight Levels: 1000FT, FL100, 7500FT AMSL
            text = re.sub(r'\b(\d{3,5}FT(?:\s+(?:AMSL|AGL))?)\b',
                          r'<span class="wx-alt">\1</span>', text)
            text = re.sub(r'\b(FL\d{2,3})\b',
                          r'<span class="wx-alt">\1</span>', text)
            # Visibility: 0500-2500M, 3500M
            text = re.sub(r'\b(\d{3,4}(?:-\d{3,4})?M)\b',
                          r'<span class="wx-vis-bad">\1</span>', text)
            text = re.sub(r'\b(\d{1,2}KM)\b',
                          r'<span class="wx-vis-good">\1</span>', text)
            # Clouds: BKN, SCT, FEW, OVC
            text = re.sub(r'\b(FEW|SCT|BKN|OVC|NCD|NSC)\b',
                          r'<span class="wx-cloud">\1</span>', text)
            # Weather phenomena: FG, BR, RA, SN, TS, etc.
            text = re.sub(r'\b(FG|BR|RA|SN|TS|DZ|SH|GR|IC|SG)\b',
                          r'<span class="wx-phen">\1</span>', text)
            # Pressure: 1035HPA
            text = re.sub(r'\b(\d{3,4}HPA)\b',
                          r'<span class="wx-qnh">\1</span>', text)
            return text

        # Generate HTML
        html_parts = []
        html_parts.append("""<!DOCTYPE html><html><head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1.0'>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html{color-scheme:dark}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;padding:12px;margin:0;
  background:transparent;color:#e0e0e8}
.section{margin-bottom:16px;border-radius:10px;overflow:hidden;background:transparent}
.section-header{padding:10px 14px;font-weight:700;font-size:16px;background:rgba(102,126,234,.12);border-bottom:1px solid #333350;border-radius:10px 10px 0 0;display:flex;align-items:center;gap:8px;color:#fff}
.section-header .icon{font-size:18px}
.entry{padding:8px 14px;font-family:'Cascadia Code','Fira Code','SF Mono',Consolas,monospace;font-size:13.5px;line-height:1.6;border-bottom:1px solid rgba(255,255,255,.06);white-space:pre-wrap;word-break:break-word;color:#e0e0e8}
.entry:last-child{border-bottom:none}
.entry-nil{color:#a0a0b8;font-style:italic}
.entry-notprov{color:#a0a0b8;font-style:italic;font-size:12px}
.icao{color:#f59e0b;font-weight:700}
.timestamp{color:#a78bfa}
.wx-wind{color:#60a5fa;font-weight:600}
.wx-vis-good{color:#34d399}
.wx-vis-bad{color:#fb923c;font-weight:600}
.wx-phen{color:#f87171;font-weight:700}
.wx-cloud{color:#c084fc}
.wx-qnh{color:#2dd4bf;font-weight:600}
.wx-temp{color:#fbbf24}
.wx-trend{color:#f472b6;font-weight:700;text-decoration:underline;text-underline-offset:2px}
.wx-mil-blu{color:#3b82f6}.wx-mil-wht{color:#e5e7eb}.wx-mil-grn{color:#22c55e}
.wx-mil-ylo{color:#eab308}.wx-mil-amb{color:#f97316;font-weight:700}.wx-mil-red{color:#ef4444;font-weight:700}
.gamet-block{padding:10px 14px;font-family:'Cascadia Code','Fira Code','SF Mono',Consolas,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;color:#e0e0e8}
.gamet-label{color:#a78bfa;font-weight:700}
.wx-alt{color:#38bdf8}
.updated{text-align:center;padding:8px;font-size:11px;color:#a0a0b8}
body.light{color:#333;color-scheme:light}
body.light .section-header{color:#212121;border-color:#b0bec5}
body.light .entry{color:#333;border-color:rgba(0,0,0,.08)}
body.light .entry-nil,body.light .entry-notprov{color:#666}
body.light .gamet-block{color:#333}
body.light .updated{color:#666}
</style>
<script>
try{
  function _syncTheme(){
    try{if(window.parent&&window.parent.document.body.classList.contains('light'))document.body.classList.add('light');else document.body.classList.remove('light');}catch(e){}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',_syncTheme);
  else _syncTheme();
}catch(e){}
</script>
</head><body>
""")

        from datetime import datetime, timezone
        now_utc = datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%MZ')

        for section_key, icon, label in section_config:
            if section_key not in sections:
                continue
            lines = sections[section_key]

            html_parts.append(f'<div class="section"><div class="section-header"><span class="icon">{icon}</span>{label}</div>')

            if section_key in ('METAR', 'TAF FC', 'TAF FT'):
                entries = format_entries(lines)
                if not entries:
                    html_parts.append('<div class="entry entry-nil">Aucune donnée</div>')
                for entry in entries:
                    entry_esc = entry.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                    if 'not provided' in entry.lower() or entry.strip().endswith('NIL') or entry.strip().endswith('NIL='):
                        css = 'entry-notprov'
                    else:
                        css = 'entry'
                    # Highlight ICAO code
                    entry_esc = re.sub(r'\b(E[BL][A-Z]{2})\b', r'<span class="icao">\1</span>', entry_esc)
                    # Highlight timestamp
                    entry_esc = re.sub(r'\b(\d{6}Z)\b', r'<span class="timestamp">\1</span>', entry_esc)
                    # Highlight METAR/TAF parameters
                    if css == 'entry':
                        entry_esc = colorize_metar_taf(entry_esc)
                    html_parts.append(f'<div class="entry {css}">{entry_esc}</div>')
            elif section_key in ('SIGMET', 'AIRMET'):
                content = '\n'.join(lines).strip()
                if not content or content == 'NIL':
                    html_parts.append('<div class="entry entry-nil">NIL</div>')
                else:
                    c = content.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                    html_parts.append(f'<div class="entry">{c}</div>')
            elif section_key == 'GAMET':
                content = '\n'.join(lines).strip()
                if not content or content == 'NIL':
                    html_parts.append('<div class="entry entry-nil">NIL</div>')
                else:
                    c = content.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                    c = colorize_gamet(c)
                    html_parts.append(f'<div class="gamet-block">{c}</div>')

            html_parts.append('</div>')

        html_parts.append(f'<div class="updated">Mis à jour: {now_utc}</div>')
        html_parts.append('</body></html>')

        with open("opmet.html", "w", encoding="utf-8") as f:
            f.write('\n'.join(html_parts))
        print("OPMET: saved clean METAR/TAF data HTML")

    # Secondary: also try PDF download
    pdf_url = "https://ops.skeyes.be/opersite/opmet.do?cmd=opmetAsPdf"
    pdf_resp = session.get(pdf_url, headers={"Referer": post_url})
    pdf_resp.raise_for_status()

    is_pdf = pdf_resp.content[:4] == b'%PDF'
    pdf_size = len(pdf_resp.content)
    print(f"OPMET PDF: is_pdf={is_pdf}, size={pdf_size}")

    if is_pdf and pdf_size > 2000:
        with open("opmet.pdf", "wb") as f:
            f.write(pdf_resp.content)
        # Only overwrite HTML if we didn't already have good HTML data
        if not has_metar:
            convert_pdf_to_html("opmet.pdf", "opmet.html", "opmet_page")
        print("OPMET: PDF saved")
    elif not has_metar:
        raise Exception(f"OPMET: no METAR data in HTML and PDF too small ({pdf_size} bytes)")

    return True

def _extract_utc_timestamp(original_path):
    """Extract UTC timestamp string from a Skeyes image path. Returns ISO-like 'YYYY-MM-DDTHH:MMZ' or None."""
    basename = original_path.rsplit('/', 1)[-1]
    # MSG satellite: 202603080530_MSG3_Europe_IR108_WEB.jpeg
    m = re.match(r'(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})_MSG', basename)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}T{m.group(4)}:{m.group(5)}Z"
    # Radar PLIP: METSRV202603080740.PLIP.jpg
    m = re.match(r'METSRV(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})', basename)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}T{m.group(4)}:{m.group(5)}Z"
    # Radar MAX/PPI: RADSRV260308075505.MAX3061.gif (YYMMDDHHmmSS)
    m = re.match(r'RADSRV(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\d{2}', basename)
    if m:
        return f"20{m.group(1)}-{m.group(2)}-{m.group(3)}T{m.group(4)}:{m.group(5)}Z"
    # Numwx prec: europpn_2026030800Z_006.jpg
    m = re.match(r'europpn_(\d{4})(\d{2})(\d{2})(\d{2})Z_(\d{3})', basename)
    if m:
        from datetime import datetime as _dt, timedelta as _td
        base = _dt(int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)))
        valid = base + _td(hours=int(m.group(5)))
        return valid.strftime("%Y-%m-%dT%H:%MZ")
    # Numwx wind: nmesowdt06.gif, nmewdfl1006.gif – offset from today's 00Z
    m = re.search(r'(\d{2,3})\.gif$', basename)
    if m and '/modeloutput/' in original_path:
        from datetime import datetime as _dt, timedelta as _td, timezone as _tz
        offset_h = int(m.group(1))
        base = _dt.now(_tz.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        valid = base + _td(hours=offset_h)
        return valid.strftime("%Y-%m-%dT%H:%MZ")
    return None


def fetch_remote_sensing_images(session):
    """Fetch all timestamped radar/satellite/numwx images from Skeyes remoteSensingDetail pages."""
    print("\n--- Fetching Remote Sensing Images ---")
    pages = [
        ("radarmax",       "radar", "skeyes_radar_max"),
        ("radarppi",       "radar", "skeyes_radar_ppi"),
        ("radarplip",      "radar", "skeyes_radar_plip"),
        ("msghrv",         "msg",   "skeyes_msg_hrv"),
        ("msgir",          "msg",   "skeyes_msg_ir"),
        ("msgrgb",         "msg",   "skeyes_msg_rgb"),
        ("msghrv_benelux", "msg",   "skeyes_msg_hrv_benelux"),
        ("msgir_benelux",  "msg",   "skeyes_msg_ir_benelux"),
        ("msgrgb_benelux", "msg",   "skeyes_msg_rgb_benelux"),
        # Numerical Weather Model outputs
        ("wind10",         "numwx", "skeyes_numwx_wind10"),
        ("windfl10",       "numwx", "skeyes_numwx_windfl10"),
        ("windfl20",       "numwx", "skeyes_numwx_windfl20"),
        ("windfl30",       "numwx", "skeyes_numwx_windfl30"),
        ("windfl50",       "numwx", "skeyes_numwx_windfl50"),
        ("windfl100",      "numwx", "skeyes_numwx_windfl100"),
        ("numprec",        "numwx", "skeyes_numwx_prec"),
    ]
    manifest = {}
    for html_param, type_param, prefix in pages:
        try:
            detail_url = f"https://ops.skeyes.be/opersite/remoteSensingDetail.do?html={html_param}&type={type_param}"
            referer = "https://ops.skeyes.be/opersite/meteonumwxStart.do" if type_param == "numwx" else "https://ops.skeyes.be/opersite/opmeteoindex.do?cmd=init"
            print(f"Fetching {prefix} from {html_param}...")
            resp = session.get(detail_url, headers={"Referer": referer})
            if resp.status_code != 200:
                print(f"  -> HTTP {resp.status_code}")
                continue
            
            # Extract ALL image URLs from the page (from preloadImages JS and img tags)
            img_paths = []
            for m in re.finditer(r"['\"](/(?:remotesensing|modeloutput)/[^'\"]+\.(gif|jpg|jpeg|png))['\"]", resp.text, re.IGNORECASE):
                path = m.group(1)
                if 'animation_buttons' not in path and 'roads' not in path and path not in img_paths:
                    img_paths.append(path)
            
            if not img_paths:
                print(f"  -> No images found")
                continue
            
            print(f"  -> Found {len(img_paths)} images")
            filenames = []
            timestamps = []
            for i, path in enumerate(img_paths):
                img_url = f"https://ops.skeyes.be{path}"
                ext = path.rsplit('.', 1)[-1].lower()
                if ext == 'jpeg':
                    ext = 'jpg'
                filename = f"{prefix}_{i:02d}.{ext}"
                img_resp = session.get(img_url, headers={"Referer": detail_url})
                if img_resp.status_code == 200 and len(img_resp.content) > 500:
                    with open(filename, 'wb') as f:
                        f.write(img_resp.content)
                    filenames.append(filename)
                    ts = _extract_utc_timestamp(path)
                    timestamps.append(ts)
                else:
                    print(f"  -> Failed {filename}: status={img_resp.status_code}, size={len(img_resp.content)}")
            
            if filenames:
                manifest[prefix] = {"files": filenames, "times": timestamps}
                print(f"  -> Saved {len(filenames)} images for {prefix}")
        except Exception as e:
            print(f"  -> Error: {e}")
    
    # Write manifest JSON
    with open("skeyes_images.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f)
    return manifest


def fetch_sfc_analysis(session, manifest):
    """Fetch SFC Analysis Europe charts (06Z/12Z) from Skeyes Flight Briefing Charts."""
    print("\n--- Fetching SFC Analysis ---")
    base = "https://ops.skeyes.be/opersite"
    referer = f"{base}/opmeteoindex.do?cmd=init"

    # First, GET the Flight Briefing Charts page to obtain current form defaults
    init_resp = session.get(f"{base}/opmeteoindex.do?cmd=init", headers={"Referer": referer})
    # Extract dynamic default values for SIGWX/UWC/LLSWC time selects
    charttime1 = re.search(r"name=['\"]charttime1['\"][^>]*>.*?<option[^>]*value=['\"]([^'\"]+)['\"]", init_resp.text, re.S)
    charttime2 = re.search(r"name=['\"]charttime2['\"][^>]*>.*?<option[^>]*value=['\"]([^'\"]+)['\"]", init_resp.text, re.S)
    charttime3 = re.search(r"name=['\"]charttime3['\"][^>]*>.*?<option[^>]*value=['\"]([^'\"]+)['\"]", init_resp.text, re.S)
    ct1 = charttime1.group(1) if charttime1 else ""
    ct2 = charttime2.group(1) if charttime2 else ""
    ct3 = charttime3.group(1) if charttime3 else ""

    filenames = []
    timestamps = []
    for time_val in ("06Z", "12Z"):
        try:
            data = {
                "fileType": "SFC",
                "selswc": "",
                "seluwc": "",
                "browser": "moz",
                "charttimesfc": time_val,
                "chartarea1": "Europe",
                "charttime1": ct1,
                "charttypeswc": "pdf",
                "chartarea2": "Europe",
                "charttime2": ct2,
                "chartfl": "FL050",
                "charttypeuwc": "pdf",
                "chartarea3": "Belgium",
                "charttime3": ct3,
                "charttypellswc": "pdf",
            }
            resp = session.post(
                f"{base}/metflightbriefing.do?cmd=retrieveBriefing",
                data=data,
                headers={"Referer": referer},
            )
            if resp.status_code != 200:
                print(f"  SFC {time_val}: HTTP {resp.status_code}")
                continue
            ct = resp.headers.get("Content-Type", "")
            if "image" in ct:
                # Direct image response
                ext = "gif" if "gif" in ct else "png" if "png" in ct else "jpg"
                fname = f"skeyes_sfc_{time_val.lower()}.{ext}"
                with open(fname, "wb") as f:
                    f.write(resp.content)
                filenames.append(fname)
                timestamps.append(time_val.replace("Z", ":00Z"))
                print(f"  SFC {time_val}: saved {fname} ({len(resp.content)} bytes)")
            else:
                # HTML response – look for image inside iframe
                html = resp.text
                print(f"  SFC {time_val}: HTML response ({len(html)} bytes)")
                img_src = None
                # Check for iframe with chart content
                iframe_match = re.search(r"<iframe[^>]+src=['\"]([^'\"]+)['\"]", html, re.I)
                if iframe_match:
                    iframe_url = iframe_match.group(1)
                    if not iframe_url.startswith("http"):
                        iframe_url = f"https://ops.skeyes.be/opersite/{iframe_url}" if not iframe_url.startswith("/") else f"https://ops.skeyes.be{iframe_url}"
                    iframe_resp = session.get(iframe_url, headers={"Referer": referer})
                    if iframe_resp.status_code == 200:
                        iframe_html = iframe_resp.text
                        iframe_ct = iframe_resp.headers.get("Content-Type", "")
                        if "image" in iframe_ct:
                            ext = "gif" if "gif" in iframe_ct else "png" if "png" in iframe_ct else "jpg"
                            fname = f"skeyes_sfc_{time_val.lower()}.{ext}"
                            with open(fname, "wb") as out:
                                out.write(iframe_resp.content)
                            filenames.append(fname)
                            timestamps.append(time_val.replace("Z", ":00Z"))
                            print(f"  SFC {time_val}: saved {fname} ({len(iframe_resp.content)} bytes)")
                            continue
                        # Use BS4 to find <img> tags (skips script content)
                        iframe_soup = BeautifulSoup(iframe_html, "html.parser")
                        for img_tag in iframe_soup.find_all("img"):
                            s = img_tag.get("src", "")
                            if s:
                                img_src = s
                                break
                        # Fallback: search for image URLs in raw JS
                        if not img_src:
                            for ji in re.findall(r'["\']([^"\']*\.(?:gif|jpg|jpeg|png))["\']', iframe_html, re.I):
                                if '+' not in ji:
                                    img_src = ji
                                    break
                # Try <img src="..."> in main page as fallback
                if not img_src:
                    m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', html, re.I)
                    if m:
                        img_src = m.group(1)
                if img_src:
                    if not img_src.startswith("http"):
                        img_src = f"https://ops.skeyes.be{img_src}" if img_src.startswith("/") else f"{base}/{img_src}"
                    img_resp = session.get(img_src, headers={"Referer": referer})
                    if img_resp.status_code == 200 and len(img_resp.content) > 500:
                        ext = img_src.rsplit(".", 1)[-1].lower()
                        if ext not in ("gif", "jpg", "jpeg", "png"):
                            ext = "gif"
                        if ext == "jpeg":
                            ext = "jpg"
                        fname = f"skeyes_sfc_{time_val.lower()}.{ext}"
                        with open(fname, "wb") as f:
                            f.write(img_resp.content)
                        filenames.append(fname)
                        timestamps.append(time_val.replace("Z", ":00Z"))
                        print(f"  SFC {time_val}: saved {fname} ({len(img_resp.content)} bytes)")
                    else:
                        print(f"  SFC {time_val}: image fetch failed ({img_resp.status_code})")
                else:
                    print(f"  SFC {time_val}: no image URL found in response")
        except Exception as e:
            print(f"  SFC {time_val}: error: {e}")
    if filenames:
        manifest["skeyes_sfc_analysis"] = {"files": filenames, "times": timestamps}
        # Re-write manifest with SFC data
        with open("skeyes_images.json", "w", encoding="utf-8") as f:
            json.dump(manifest, f)
        print(f"  -> Saved {len(filenames)} SFC Analysis images")
    else:
        print("  -> No SFC Analysis images obtained")


def do_login(session, username, password):
    """Authenticate to the Skeyes opersite. Returns True if login succeeded."""
    print("--- Login ---")
    base = "https://ops.skeyes.be"
    
    # Step 1: GET login.do to obtain JSESSIONID
    init_resp = session.get(f"{base}/opersite/login.do")
    print(f"GET login.do: status={init_resp.status_code}, url={init_resp.url}")
    print(f"Cookies: {session.cookies.get_dict()}")
    
    # Step 2: Follow the actual login form link: login.forward.do?cmd=init
    login_resp = session.get(f"{base}/opersite/login.forward.do?cmd=init",
                             headers={"Referer": init_resp.url})
    print(f"GET login.forward.do: status={login_resp.status_code}, url={login_resp.url}")
    page_html = login_resp.text
    
    # Step 3: Parse the login form
    # Find form action
    action_match = re.search(r'<form[^>]*name="loginForm"[^>]*action="([^"]*)"', page_html, re.IGNORECASE)
    if not action_match:
        action_match = re.search(r'<form[^>]*action="([^"]*)"[^>]*name="loginForm"', page_html, re.IGNORECASE)
    if not action_match:
        action_match = re.search(r'<form[^>]*action="([^"]*)"', page_html, re.IGNORECASE)
    form_action_raw = action_match.group(1).replace('&amp;', '&') if action_match else 'login.do?cmd=authenticate&eaip=no'
    print(f"Form action: {form_action_raw}")
    
    # Find ALL input fields using regex
    data = {}
    for m in re.finditer(r'<input\b([^>]*)/?>', page_html, re.IGNORECASE):
        attrs = m.group(1)
        name_m = re.search(r'name="([^"]*)"', attrs)
        value_m = re.search(r'value="([^"]*)"', attrs)
        type_m = re.search(r'type="([^"]*)"', attrs)
        if name_m:
            field_name = name_m.group(1)
            field_value = value_m.group(1) if value_m else ''
            field_type = type_m.group(1) if type_m else ''
            data[field_name] = field_value
            print(f"  Field: {field_name} type={field_type} value={field_value[:30]}")
    
    # Set credentials based on discovered fields
    if 'j_username' in data or 'j_password' in data:
        data['j_username'] = username
        data['j_password'] = password
    else:
        # Auto-detect credential fields by name
        found_user = found_pass = False
        for name in list(data.keys()):
            lower = name.lower()
            if 'user' in lower or 'login' in lower or lower == 'name':
                data[name] = username
                found_user = True
                print(f"  -> Setting {name} = <username>")
            elif 'pass' in lower or 'pwd' in lower:
                data[name] = password
                found_pass = True
                print(f"  -> Setting {name} = <password>")
        if not found_user or not found_pass:
            # Fallback: use j_username/j_password
            data['j_username'] = username
            data['j_password'] = password
            print("  -> Fallback: using j_username/j_password")
    
    # Step 4: Build the POST URL
    if form_action_raw.startswith('/'):
        post_url = base + form_action_raw
    elif form_action_raw.startswith('http'):
        post_url = form_action_raw
    else:
        post_url = urljoin(login_resp.url, form_action_raw)
    
    print(f"\nPOST -> {post_url}")
    print(f"POST data keys: {list(data.keys())}")
    resp = session.post(post_url, data=data, allow_redirects=True)
    print(f"Response: status={resp.status_code}, url={resp.url}")
    print(f"Cookies: {session.cookies.get_dict()}")
    
    # Check if we got redirected to a non-login page (success)
    if 'login' not in resp.url.lower().split('/')[-1]:
        print("Login redirect indicates success")
    
    # Verify: try accessing a protected resource
    verify = session.get(f"{base}/opersite/opmeteoindex.do?cmd=init",
                         headers={"Referer": f"{base}/opersite/opmeteoindex.do"})
    is_login_page = 'login.jsp' in verify.url or 'login.do' in verify.url
    print(f"Auth verify: status={verify.status_code}, url={verify.url}, is_login={is_login_page}")
    
    if not is_login_page:
        print("Login successful!")
        return True
    
    # Login failed - dump debug info
    print("WARNING: Login failed")
    error_match = re.search(r'class="[^"]*error[^"]*"[^>]*>([^<]+)', resp.text, re.IGNORECASE)
    if error_match:
        print(f"Error message on page: {error_match.group(1).strip()}")
    with open("_debug_login_page.html", "w", encoding="utf-8") as f:
        f.write(page_html)
    with open("_debug_login_response.html", "w", encoding="utf-8") as f:
        f.write(resp.text)
    return False


def main():
    username = os.getenv("SKEYES_USER")
    password = os.getenv("SKEYES_PASS")
    
    if not username or not password:
        print("Missing credentials")
        return

    session = cloudscraper.create_scraper(
        browser={'browser': 'chrome', 'platform': 'windows', 'desktop': True}
    )
    
    logged_in = do_login(session, username, password)
    
    # OPMET (requires auth)
    try:
        fetch_opmet(session)
    except Exception as e:
        print(f"Error fetching OPMET: {e}")
        generate_error_html("opmet.html", "OPMET", session, str(e))
    
    # Remote sensing images (fetch via detail pages)
    manifest = fetch_remote_sensing_images(session)

    # SFC Analysis charts
    fetch_sfc_analysis(session, manifest)

    print("--- Extracting NOTAMs ---")
    try:
        data_url = "https://ops.skeyes.be/opersite/notamsummary.do?cmd=summaryToHtml"
        data_response = session.post(data_url)
        data_response.raise_for_status()
        
        soup = BeautifulSoup(data_response.text, 'html.parser')
        notam_section = soup.find('body')

        if notam_section:
            search_html = BeautifulSoup("""
            <div style='margin: 15px 0; text-align: center;'>
                <input type='text' id='notamSearch' placeholder='Rechercher un mot clé (ex: EBCI, TRA, etc.)...' style='padding: 12px; width: 85%; font-size: 16px; border: 1px solid #999; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);' onkeyup='filterNotams()'>
            </div>
            <script>
                // Le filtre masquait les paragraphes non concernés mais ne mettait jamais le
                // terme recherché en évidence dans ceux qui restaient affichés — sans retour
                // visuel clair, ça pouvait donner l'impression que "la recherche ne marche pas".
                // On surligne maintenant le texte trouvé (comme highlightNotamTerms ci-dessous),
                // en ne touchant qu'aux segments de texte (jamais aux balises/attributs) pour ne
                // pas casser les liens/images imbriqués dans les paragraphes.
                function _notamEscRe(s) { return s.replace(/[.*+?^${}()|[\]\\\\]/g, '\\\\$&'); }
                function _notamHighlightHtml(html, term) {
                    var re = new RegExp('(' + _notamEscRe(term) + ')', 'ig');
                    var parts = html.split(/(<[^>]+>)/);
                    for (var j = 0; j < parts.length; j++) {
                        if (parts[j].charAt(0) !== '<') {
                            parts[j] = parts[j].replace(re, '<mark style="background:#fff176;color:#000;padding:0 1px">$1</mark>');
                        }
                    }
                    return parts.join('');
                }
                function filterNotams() {
                    var filter = document.getElementById('notamSearch').value.trim();
                    var filterUpper = filter.toUpperCase();
                    var paragraphs = document.querySelectorAll('p');
                    for (var i = 0; i < paragraphs.length; i++) {
                        var p = paragraphs[i];
                        if (p.dataset.origHtml === undefined) p.dataset.origHtml = p.innerHTML;
                        if (!filter) {
                            p.innerHTML = p.dataset.origHtml;
                            p.style.display = "";
                            continue;
                        }
                        var txt = p.innerText || p.textContent;
                        if (txt.toUpperCase().indexOf(filterUpper) > -1) {
                            p.style.display = "";
                            p.innerHTML = _notamHighlightHtml(p.dataset.origHtml, filter);
                        } else {
                            p.style.display = "none";
                        }
                    }
                }
                // Appelable depuis une page parente (ex: navlog.html, iframe same-origin) pour
                // surligner les NOTAM concernant une liste de codes OACI (route/dégagement),
                // sans masquer les autres NOTAM (contrairement à filterNotams()).
                function highlightNotamTerms(termsStr) {
                    var terms = (termsStr || '').toUpperCase().split(/[\s,]+/).filter(Boolean);
                    var paragraphs = document.querySelectorAll('p');
                    var firstMatch = null;
                    for (var i = 0; i < paragraphs.length; i++) {
                        var txt = (paragraphs[i].innerText || paragraphs[i].textContent).toUpperCase();
                        var matched = terms.length > 0 && terms.some(function(t) { return txt.indexOf(t) > -1; });
                        paragraphs[i].style.background = matched ? '#fff59d' : '';
                        paragraphs[i].style.color = matched ? '#000' : '';
                        paragraphs[i].style.display = '';
                        if (matched && !firstMatch) firstMatch = paragraphs[i];
                    }
                    if (firstMatch) firstMatch.scrollIntoView({behavior: 'smooth', block: 'center'});
                    return !!firstMatch;
                }
            </script>
            """, 'html.parser')

            h1_tag = notam_section.find('h1')
            if h1_tag:
                h1_tag.insert_after(search_html)
            else:
                notam_section.insert(0, search_html)

        html_output = str(notam_section) if notam_section else "<p>No NOTAMs found / Parsing failed</p>"
        with open("notams_belgique.html", "w", encoding="utf-8") as f:
            f.write(html_output)
    except Exception as e:
        print(f"Error extracting NOTAMs: {e}")

    print("--- Extracting Daily Warnings ---")
    try:
        daily_url = "https://ops.skeyes.be/opersite/dailywarnings.do?cmd=warningstoday"
        daily_response = session.get(daily_url)
        daily_response.raise_for_status()

        with open("daily_warnings.pdf", "wb") as f:
            f.write(daily_response.content)

        convert_pdf_to_html("daily_warnings.pdf", "daily_warnings.html", "daily_warnings_page")

        # Extraction structurée (JSON) des avis, en plus des images de la page — utilisée
        # par navlog.html pour afficher une bannière d'alerte automatique et situer chaque
        # zone sur une mini-carte, sans devoir faire relire le PDF/les images par l'utilisateur.
        try:
            warn_doc = fitz.open("daily_warnings.pdf")
            full_text = "\n".join(page.get_text("text") for page in warn_doc)
            warnings_list = parse_daily_warnings(full_text)
            with open("daily_warnings.json", "w", encoding="utf-8") as f:
                json.dump({
                    "generated": daily_response.headers.get("Date"),
                    "count": len(warnings_list),
                    "warnings": warnings_list,
                }, f, ensure_ascii=False, indent=2)
            print(f"--- Extracted {len(warnings_list)} structured daily warnings ---")
        except Exception as e:
            print(f"Error parsing daily warnings text: {e}")
    except Exception as e:
        print(f"Error fetching daily warnings: {e}")

def main_opmet_only():
    """Point d'entrée léger pour le bouton 'OPMET rapide' : login + fetch_opmet() UNIQUEMENT
    (pas de NOTAMs, pas d'images radar/satellite, pas de TEMSI/WINTEM) — récupère et remplace
    la TOTALITÉ de l'OPMET (METAR + TAF + SIGMET + GAMET/AIRMET, exactement comme sur la page
    Skeyes) dans opmet.html, réutilisant fetch_opmet() telle quelle (même sortie que le
    pipeline complet), pour un job GitHub Actions le plus court possible."""
    username = os.getenv("SKEYES_USER")
    password = os.getenv("SKEYES_PASS")

    if not username or not password:
        print("Missing credentials")
        return

    session = cloudscraper.create_scraper(
        browser={'browser': 'chrome', 'platform': 'windows', 'desktop': True}
    )
    do_login(session, username, password)

    try:
        fetch_opmet(session)
    except Exception as e:
        print(f"Error fetching OPMET (fast): {e}")
        generate_error_html("opmet.html", "OPMET", session, str(e))


if __name__ == "__main__":
    import sys
    if '--opmet-only' in sys.argv:
        main_opmet_only()
    else:
        main()