import os
import requests
import cloudscraper
import fitz  # PyMuPDF
from bs4 import BeautifulSoup
from urllib.parse import urljoin
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


def fetch_remote_sensing_images(session):
    """Fetch latest radar/satellite images by parsing remoteSensingDetail.do pages."""
    print("\n--- Fetching Remote Sensing Images ---")
    pages = [
        ("radarmax",       "radar", "skeyes_radar_max.gif"),
        ("radarppi",       "radar", "skeyes_radar_ppi.gif"),
        ("radarplip",      "radar", "skeyes_radar_plip.gif"),
        ("msghrv",         "msg",   "skeyes_msg_hrv.jpg"),
        ("msgir",          "msg",   "skeyes_msg_ir.jpg"),
        ("msgrgb",         "msg",   "skeyes_msg_rgb.jpg"),
        ("msghrv_benelux", "msg",   "skeyes_msg_hrv_benelux.jpg"),
        ("msgir_benelux",  "msg",   "skeyes_msg_ir_benelux.jpg"),
        ("msgrgb_benelux", "msg",   "skeyes_msg_rgb_benelux.jpg"),
    ]
    for html_param, type_param, output_filename in pages:
        try:
            detail_url = f"https://ops.skeyes.be/opersite/remoteSensingDetail.do?html={html_param}&type={type_param}"
            print(f"Fetching {output_filename} from {html_param}...")
            resp = session.get(detail_url, headers={"Referer": "https://ops.skeyes.be/opersite/opmeteoindex.do?cmd=init"})
            if resp.status_code != 200:
                print(f"  -> HTTP {resp.status_code}")
                continue
            soup = BeautifulSoup(resp.text, 'html.parser')
            # Find the main displayed image <img name='map' src='...'>
            map_img = soup.find('img', {'name': 'map'})
            if map_img and map_img.get('src'):
                img_src = map_img['src']
                img_url = urljoin("https://ops.skeyes.be", img_src)
                print(f"  -> Found image: {img_url}")
                img_resp = session.get(img_url, headers={"Referer": detail_url})
                if img_resp.status_code == 200 and len(img_resp.content) > 1000:
                    with open(output_filename, 'wb') as f:
                        f.write(img_resp.content)
                    print(f"  -> Saved {output_filename} ({len(img_resp.content)} bytes)")
                else:
                    print(f"  -> Image download failed: status={img_resp.status_code}, size={len(img_resp.content)}")
            else:
                print(f"  -> No <img name='map'> found in page")
                # Debug: save the page for inspection
                with open(f"_debug_{html_param}.html", "w", encoding="utf-8") as dbg:
                    dbg.write(resp.text[:2000])
        except Exception as e:
            print(f"  -> Error: {e}")


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
    fetch_remote_sensing_images(session)

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