import os
import requests
import cloudscraper
import fitz  # PyMuPDF
from bs4 import BeautifulSoup
import json
import re


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
        # Save debug file
        with open("_debug_opmet_init1.html", "w", encoding="utf-8") as dbg:
            dbg.write(resp.text)
        raise Exception(f"OPMET init 1 failed: login_form={has_login}, session_lost={has_session_lost}, url={resp.url}")

    # Step 2: Second Init explicitly for opmet.do
    init_url_2 = "https://ops.skeyes.be/opersite/opmet.do?cmd=init"
    resp = session.get(init_url_2, headers={"Referer": init_url_1})
    resp.raise_for_status()

    # Step 3: Payload
    payload = [
        ('templateName', ''),
        ('newTemplateName', ''),
        ('selectCountry', ''),
        ('template', 'select'),
        ('icaocodes', 'EBBR EBCI EBSG EBAW EBBE EBBL EBCV EBFN EBFS EBLG EBOS ELLX'),
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

    has_metar = 'METAR' in submit_resp.text or 'TAF' in submit_resp.text

    # Step 5: Try to download the PDF
    pdf_url = "https://ops.skeyes.be/opersite/opmet.do?cmd=opmetAsPdf"
    pdf_resp = session.get(pdf_url, headers={"Referer": post_url})
    pdf_resp.raise_for_status()

    is_pdf = pdf_resp.content[:4] == b'%PDF'
    if is_pdf:
        with open("opmet.pdf", "wb") as f:
            f.write(pdf_resp.content)
        convert_pdf_to_html("opmet.pdf", "opmet.html", "opmet_page")
        print("OPMET: PDF converted to images and HTML")
        return True

    # Fallback to HTML
    if has_metar:
        body = soup.find('body')
        body_html = str(body) if body else submit_resp.text
        html_content = (
            "<!DOCTYPE html><html><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width, initial-scale=1.0'>"
            "<style>body{font-family:monospace;font-size:13px;padding:10px;margin:0;"
            "background:transparent;white-space:pre-wrap;}</style>"
            "</head>" + body_html + "</html>"
        )
        with open("opmet.html", "w", encoding="utf-8") as f:
            f.write(html_content)
        return True
    else:
        raise Exception("OPMET Fetch complete but no METAR data or PDF found.")


def main():
    username = os.getenv("SKEYES_USER")
    password = os.getenv("SKEYES_PASS")
    
    if not username or not password:
        print("Missing credentials")
        open('opmet.pdf', 'wb').close()
        open('daily_warnings.pdf', 'wb').close()
        return

    session = cloudscraper.create_scraper(
        browser={'browser': 'chrome', 'platform': 'windows', 'desktop': True}
    )
    
    # ========== LOGIN ==========
    print("--- Login ---")
    login_url = "https://ops.skeyes.be/opersite/login.do"
    
    # Step A: GET login page to obtain JSESSIONID and discover form action
    login_page = session.get(login_url)
    print(f"Login page GET: status={login_page.status_code}, url={login_page.url}")
    print(f"Cookies after GET login: {session.cookies.get_dict()}")
    
    # Parse the login form to find the real action URL and field names
    login_soup = BeautifulSoup(login_page.text, 'html.parser')
    login_form = login_soup.find('form')
    form_action = login_url  # default
    if login_form:
        raw_action = login_form.get('action', '')
        form_method = login_form.get('method', 'POST').upper()
        print(f"Login form action='{raw_action}', method='{form_method}'")
        if raw_action:
            if raw_action.startswith('http'):
                form_action = raw_action
            elif raw_action.startswith('/'):
                form_action = "https://ops.skeyes.be" + raw_action
            else:
                form_action = "https://ops.skeyes.be/opersite/" + raw_action
        # Log all input fields in the form
        for inp in login_form.find_all('input'):
            print(f"  Login form field: name={inp.get('name')}, type={inp.get('type')}, value={str(inp.get('value',''))[:50]}")
    
    login_payload = {"j_username": username, "j_password": password}
    
    # Also add any hidden fields from the form
    if login_form:
        for inp in login_form.find_all('input', {'type': 'hidden'}):
            name = inp.get('name')
            if name and name not in login_payload:
                login_payload[name] = inp.get('value', '')
    
    print(f"POSTing to: {form_action}")
    login_response = session.post(form_action, data=login_payload, allow_redirects=True)
    print(f"Login POST: status={login_response.status_code}, final_url={login_response.url}")
    print(f"Cookies after POST login: {session.cookies.get_dict()}")
    
    # Check if login succeeded by visiting home.do
    home_resp = session.get("https://ops.skeyes.be/opersite/home.do")
    home_soup = BeautifulSoup(home_resp.text, 'html.parser')
    has_login_form = home_soup.find('form', {'name': 'loginForm'}) is not None
    print(f"Home.do check: status={home_resp.status_code}, has_login_form={has_login_form}")
    if has_login_form:
        print("WARNING: Login appears to have FAILED - home.do shows login form")
        print(f"Home.do response snippet: {home_resp.text[:500]}")
    else:
        print("Login appears successful - home.do does not show login form")
    login_response.raise_for_status()
    
    # Note: reordering requests here to avoid the struts session dropping early. 
    # Do OPMET immediately after login.
    try:
        fetch_opmet(session)
    except Exception as e:
        print(f"Error fetching OPMET: {e}")
        generate_error_html("opmet.html", "OPMET", session, str(e))

    
    # Next: Remote Sensing (Sats & Radar) Static Images
    skeyes_static_images = [
        ("skeyes_radar_max.gif", "https://ops.skeyes.be/opersite/resources/images/services/meteo/radar_max.gif"),
        ("skeyes_radar_ppi.gif", "https://ops.skeyes.be/opersite/resources/images/services/meteo/radar_ppi.gif"),
        ("skeyes_radar_plip.gif", "https://ops.skeyes.be/opersite/resources/images/services/meteo/radar_plip.gif"),
        ("skeyes_msg_ir_benelux.jpg", "https://ops.skeyes.be/opersite/resources/images/services/meteo/msg_ir_benelux.jpg"),
        ("skeyes_msg_rgb_benelux.jpg", "https://ops.skeyes.be/opersite/resources/images/services/meteo/msg_rgb_benelux.jpg"),
        ("skeyes_msg_hrv_benelux.jpg", "https://ops.skeyes.be/opersite/resources/images/services/meteo/msg_hrv_benelux.jpg"),
        ("skeyes_msg_hrv.jpg", "https://ops.skeyes.be/opersite/resources/images/services/meteo/msg_hrv.jpg"),
        ("skeyes_msg_ir.jpg", "https://ops.skeyes.be/opersite/resources/images/services/meteo/msg_ir.jpg"),
        ("skeyes_msg_rgb.jpg", "https://ops.skeyes.be/opersite/resources/images/services/meteo/msg_rgb.jpg")
    ]

    for filename, url in skeyes_static_images:
        try:
            print(f"Fetching static image {filename}...")
            resp = session.get(url, headers={"Referer": "https://ops.skeyes.be/opersite/home.do"})
            content_type = resp.headers.get('Content-Type', 'unknown')
            print(f"  -> status={resp.status_code}, content-type={content_type}, length={len(resp.content)}")
            if resp.status_code == 200 and ('image' in content_type or len(resp.content) > 1000):
                with open(filename, 'wb') as f:
                    f.write(resp.content)
                print(f"  -> Saved {filename} ({len(resp.content)} bytes)")
            else:
                print(f"  -> FAILED: not an image or too small (first 200 chars: {resp.text[:200]})")
        except Exception as e:
            print(f"Error fetching {filename}: {e}")

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
                function filterNotams() {
                    var filter = document.getElementById('notamSearch').value.toUpperCase();
                    var paragraphs = document.querySelectorAll('p');
                    for (var i = 0; i < paragraphs.length; i++) {
                        var txt = paragraphs[i].innerText || paragraphs[i].textContent;
                        if (txt.toUpperCase().indexOf(filter) > -1) {
                            paragraphs[i].style.display = "";
                        } else {
                            paragraphs[i].style.display = "none";
                        }
                    }
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
    except Exception as e:
        print(f"Error fetching daily warnings: {e}")

if __name__ == "__main__":
    main()