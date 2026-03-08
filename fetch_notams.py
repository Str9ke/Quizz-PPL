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
    <button class="nav-btn" onclick="changeImage(-1)">&#x25C0; Précédent</button>
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


def fetch_opmet(session):
    """Fetch OPMET (METAR/TAF/SIGMET/GAMET) data from Skeyes."""
    print("\n--- Fetching OPMET data ---")
    print(f"Current session cookies: {session.cookies.get_dict()}")

    # Step 0: Ensure we go back to the home page to reset the Struts Action Flow
    home_url = "https://ops.skeyes.be/opersite/home.do"
    try:
        session.get(home_url)
    except Exception as e:
        print(f"Warning: Failed to reach home.do: {e}")

    # Step 1: Initialize the OPMET form page (sets up server-side session state)
    init_url = "https://ops.skeyes.be/opersite/opmeteoindex.do?cmd=init"
    # Provide a Referer header to simulate normal navigation
    resp = session.get(init_url, headers={"Referer": home_url})
    resp.raise_for_status()
    print(f"OPMET init: status={resp.status_code}, length={len(resp.text)}")

    soup = BeautifulSoup(resp.text, 'html.parser')

    # Check if we got a login page instead of the form
    if soup.find('form', {'name': 'loginForm'}):
        import datetime
        print("OPMET: Session not authenticated - got login form")
        
        # DEBUG: try to grab menu to see exact URL
        menu_links_info = ""
        try:
            m_resp = session.get("https://ops.skeyes.be/opersite/menu.do")
            if m_resp.status_code == 200:
                m_soup = BeautifulSoup(m_resp.text, 'html.parser')
                menu_links_info = "<h4>Menu links found:</h4><ul>"
                for a in m_soup.find_all('a'):
                    menu_links_info += f"<li>{a.get('href')} ({a.text.strip()})</li>"
                menu_links_info += "</ul>"
        except Exception as ex:
            menu_links_info = f"<p>Menu fetch error: {ex}</p>"

        error_html = (
            "<!DOCTYPE html><html><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width, initial-scale=1.0'>"
            "<style>body{font-family:monospace;font-size:12px;padding:10px;margin:0;background:#ffeeee;}</style>"
            "</head><body><h3>Erreur OPMET Skeyes</h3>"
            "<p><strong>Session perdue ou non authentifi&eacute;e par Skeyes. Redirection vers login.</strong></p>"
            "<p>Date/Heure: " + datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S") + "</p>"
            "<p><strong>Cookies lors de la tentative :</strong> " + str(session.cookies.get_dict()) + "</p>"
            "<hr/>" + menu_links_info + 
            "</body></html>"
        )
        with open("opmet.html", "w", encoding="utf-8") as f:
            f.write(error_html)
        open('opmet.pdf', 'wb').close()
        return False

    # Step 2: Discover form field names from the init page
    # Look for the OPMET form (not language-switch or other utility forms)
    opmet_form = None
    for f in soup.find_all('form'):
        action = f.get('action', '')
        inputs = f.find_all(['input', 'select'])
        print(f"OPMET: Form action='{action}' fields={len(inputs)}")
        for inp in inputs:
            nm = inp.get('name', '')
            tp = inp.get('type', inp.name)
            val = str(inp.get('value', ''))[:80]
            chk = ' CHECKED' if inp.get('checked') is not None else ''
            sel = ''
            if inp.name == 'select':
                opts = [o.get('value', '') for o in inp.find_all('option')]
                sel = f' options={opts}'
            print(f"  {tp}: name={nm} value={val}{chk}{sel}")
        # The OPMET form has checkboxes for data types and text input for ICAO
        if len(inputs) > 3 or 'opmet' in action.lower():
            opmet_form = f

    # Step 3: Parse hidden fields and build payload based on user requirements
    payload = []
    
    if opmet_form:
        print("OPMET: Merging dynamically discovered hidden fields")
        # Extract secret tokens or hidden fields from the form
        for inp in opmet_form.find_all('input'):
            name = inp.get('name')
            if not name:
                continue
            inp_type = inp.get('type', 'text').lower()
            if inp_type == 'hidden':
                payload.append((name, inp.get('value', '')))
    
    # Add our required fields
    payload.append(('briefingType', 'PRO'))
    payload.append(('type', 'METAR'))
    payload.append(('type', 'TAF'))
    payload.append(('locationType', 'STATIONS'))
    payload.append(('stations', 'EBBR EBCI EBSG EBAW EBBE EBBL EBCV EBFN EBFS EBLG EBOS ELLX'))
    payload.append(('allStations', 'false'))
    payload.append(('submit', 'Submit'))

    headers = {'Content-Type': 'application/x-www-form-urlencoded'}
    print(f"OPMET: Payload = {payload}")

    # Step 4: Submit to opmetData.do (extract action directly from form)
    action_url = opmet_form.get('action', '/opersite/opmetData.do') if opmet_form else '/opersite/opmetData.do'
    if not action_url.startswith('http'):
        action_url = "https://ops.skeyes.be" + action_url
        
    submit_url = action_url
    # We also add the Referer header correctly
    headers['Referer'] = "https://ops.skeyes.be/opersite/opmeteoindex.do?cmd=init"
    
    submit_resp = session.post(submit_url, data=payload, headers=headers)
    submit_resp.raise_for_status()
    print(f"OPMET: Submit status={submit_resp.status_code}, length={len(submit_resp.text)}")

    # Check if the response contains actual METAR/TAF data
    has_metar = 'METAR' in submit_resp.text or 'TAF' in submit_resp.text
    print(f"OPMET: Response contains METAR/TAF data: {has_metar}")

    if not has_metar:
        with open("_debug_opmet_submit.html", "w", encoding="utf-8") as dbg:
            dbg.write(submit_resp.text)
        print("OPMET: No METAR data in response, debug file saved")

    # Step 5: Try to download the PDF (available after form submission)
    pdf_url = "https://ops.skeyes.be/opersite/opmet.do?cmd=opmetAsPdf"
    pdf_resp = session.get(pdf_url)
    pdf_resp.raise_for_status()
    print(f"OPMET PDF: status={pdf_resp.status_code}, length={len(pdf_resp.content)}, "
          f"content-type={pdf_resp.headers.get('Content-Type', 'unknown')}")

    is_pdf = pdf_resp.content[:4] == b'%PDF'

    if is_pdf:
        with open("opmet.pdf", "wb") as f:
            f.write(pdf_resp.content)
        print("OPMET: PDF saved to opmet.pdf")
        convert_pdf_to_html("opmet.pdf", "opmet.html", "opmet_page")
        print("OPMET: PDF converted to images and HTML")
        return True

    # Step 6: Fallback - if no PDF, save the HTML response from the form submission
    print("OPMET: PDF not available, saving HTML response directly")
    if has_metar:
        # Build a standalone HTML page from the OPMET results
        result_soup = BeautifulSoup(submit_resp.text, 'html.parser')
        body = result_soup.find('body')
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
        print("OPMET: HTML saved to opmet.html")
        return True

    print("OPMET: Failed to retrieve data - injecting debug info into opmet.html")
    import datetime
    error_html = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1.0'>"
        "<style>body{font-family:monospace;font-size:12px;padding:10px;margin:0;background:#ffeeee;}</style>"
        "</head><body><h3>Erreur OPMET Skeyes</h3>"
        "<p>Date/Heure: " + datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S") + "</p>"
        "<p><strong>Cookies envoyés :</strong> " + str(session.cookies.get_dict()) + "</p>"
        "<p><strong>Payload :</strong> " + str(payload) + "</p>"
        "<p><strong>URL de soumission :</strong> " + submit_url + "</p>"
        "<hr><div style='white-space:pre-wrap;'>" + submit_resp.text + "</div></body></html>"
    )
    with open("opmet.html", "w", encoding="utf-8") as f:
        f.write(error_html)
        open('opmet.pdf', 'wb').close()
    
    with open("_debug_opmet_pdf.html", "wb") as dbg:
        dbg.write(pdf_resp.content)
    return False


def main():
    login_url = "https://ops.skeyes.be/opersite/login.do"
    data_url = "https://ops.skeyes.be/opersite/notamsummary.do?cmd=summaryToHtml"
    daily_url = "https://ops.skeyes.be/opersite/dailywarnings.do?cmd=warningstoday"
    
    username = os.getenv("SKEYES_USER")
    password = os.getenv("SKEYES_PASS")
    
    if not username or not password:
        print("Missing credentials")
        error_html = (
            "<!DOCTYPE html><html><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width, initial-scale=1.0'>"
            "<style>body{font-family:monospace;font-size:12px;padding:10px;margin:0;background:#ffeeee;}</style>"
            "</head><body><h3>Erreur d'authentification Skeyes</h3>"
            "<p><strong>Identifiants manquants. Veuillez configurer SKEYES_USER et SKEYES_PASS.</strong></p>"
            "</body></html>"
        )
        for filename in ["opmet.html", "notams_belgique.html", "daily_warnings.html"]:
            with open(filename, "w", encoding="utf-8") as f:
                f.write(error_html)
        open('opmet.pdf', 'wb').close()
        open('daily_warnings.pdf', 'wb').close()
        return

    # Utilisation de cloudscraper pour contourner la protection WAF Azure (Erreur 403)
    session = cloudscraper.create_scraper(
        browser={
            'browser': 'chrome',
            'platform': 'windows',
            'desktop': True
        }
    )
    
    # Login
    print("--- Login ---")
    # Step 0: Get login page to retrieve any initial JSESSIONID cookies and hidden fields
    initial_login = session.get(login_url)
    print(f"Initial login page status: {initial_login.status_code}")
    
    login_payload = {
        "j_username": username,
        "j_password": password
    }
    
    login_response = session.post(login_url, data=login_payload)
    login_response.raise_for_status()
    print(f"Login response status: {login_response.status_code}")
    print(f"Cookies after login: {session.cookies.get_dict()}")
    
    # Extract
    data_response = session.post(data_url)
    data_response.raise_for_status()
    
    # Parse
    soup = BeautifulSoup(data_response.text, 'html.parser')
    notam_section = soup.find('body')

    if notam_section:
        # Ajouter une barre de recherche
        search_html = BeautifulSoup("""
        <div style='margin: 15px 0; text-align: center;'>
            <input type='text' id='notamSearch' placeholder='Rechercher un mot clé (ex: EBCI, TRA, etc.)...' style='padding: 12px; width: 85%; font-size: 16px; border: 1px solid #999; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);' onkeyup='filterNotams()'>
        </div>
        <script>
            function filterNotams() {
                var filter = document.getElementById('notamSearch').value.toUpperCase();
                // Les NOTAMs sont dans des balises <p>, on filtre aussi les en-têtes d'aérodrome (<b>) en option, mais on se base surtout sur <p>.
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
        
        # Insérer juste après le titre h1 s'il existe
        h1_tag = notam_section.find('h1')
        if h1_tag:
            h1_tag.insert_after(search_html)
        else:
            notam_section.insert(0, search_html)

    html_output = str(notam_section) if notam_section else "<p>No NOTAMs found / Parsing failed</p>"
    
    with open("notams_belgique.html", "w", encoding="utf-8") as f:
        f.write(html_output)
        
    print("NOTAMs saved to notams_belgique.html")

    # --- Extract Daily Warnings ---
    daily_response = session.get(daily_url)
    daily_response.raise_for_status()
    
    # Save the PDF file
    with open("daily_warnings.pdf", "wb") as f:
        f.write(daily_response.content)

    print("Daily Warnings PDF saved to daily_warnings.pdf")

    # --- Convert PDF to HTML with Images (For strict Mobile/Android compatibility) ---
    try:
        convert_pdf_to_html("daily_warnings.pdf", "daily_warnings.html", "daily_warnings_page")
        print("Daily Warnings images and HTML generated.")
    except Exception as e:
        print(f"Error converting Daily Warnings PDF to images: {e}")

    # --- Extract OPMET (METAR/TAF/SIGMET/GAMET) ---
    try:
        fetch_opmet(session)
    except Exception as e:
        import traceback
        import datetime
        print(f"Error fetching OPMET: {e}")
        error_html = (
            "<!DOCTYPE html><html><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width, initial-scale=1.0'>"
            "<style>body{font-family:monospace;font-size:12px;padding:10px;margin:0;background:#ffeeee;}</style>"
            "</head><body><h3>Erreur Execution OPMET (Python Exception)</h3>"
            "<p>Date/Heure: " + datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S") + "</p>"
            "<p><strong>Exception :</strong> " + str(e) + "</p>"
            "<hr><div style='white-space:pre-wrap;'>" + traceback.format_exc() + "</div></body></html>"
        )
        with open("opmet.html", "w", encoding="utf-8") as f:
            f.write(error_html)
        open('opmet.pdf', 'wb').close()

if __name__ == "__main__":
    main()
