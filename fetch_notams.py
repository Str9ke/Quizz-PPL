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
        html_images += f'<img src="{img_filename}" style="width:100%; display:block; margin:0 auto;" />\n'
    html_content = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1.0'>"
        "</head><body style='margin:0; padding:0; background:transparent;'>\n"
        f"{html_images}\n</body></html>"
    )
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    doc.close()


def fetch_opmet(session):
    """Fetch OPMET (METAR/TAF/SIGMET/GAMET) data from Skeyes."""
    print("\n--- Fetching OPMET data ---")

    # Step 1: Get the OPMET form page (after login, should show the actual form)
    init_url = "https://ops.skeyes.be/opersite/opmeteoindex.do?cmd=init"
    resp = session.get(init_url)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, 'html.parser')

    # Check if we got a login page instead of the form
    if soup.find('form', {'name': 'loginForm'}):
        print("OPMET: Session not authenticated - got login form")
        return False

    # Find the OPMET form - look for forms with opmet-related action or many inputs
    forms = soup.find_all('form')
    opmet_form = None
    for f in forms:
        action = f.get('action', '')
        inputs = f.find_all(['input', 'select'])
        print(f"OPMET: Found form action='{action}' with {len(inputs)} fields")
        for inp in inputs:
            nm = inp.get('name', '')
            tp = inp.get('type', inp.name)
            val = inp.get('value', '')[:60]
            chk = ' CHECKED' if inp.get('checked') is not None else ''
            print(f"  {tp}: name={nm} value={val}{chk}")
        if 'opmet' in action.lower() or len(inputs) > 3:
            opmet_form = f

    if not opmet_form:
        print("OPMET: Could not find the OPMET form")
        with open("_debug_opmet_page.html", "w", encoding="utf-8") as dbg:
            dbg.write(resp.text)
        return False

    # Step 2: Build form data from the parsed form
    form_action = opmet_form.get('action', '')
    payload = {}

    for inp in opmet_form.find_all('input'):
        name = inp.get('name')
        if not name:
            continue
        inp_type = inp.get('type', 'text').lower()
        value = inp.get('value', '')

        if inp_type == 'hidden':
            payload[name] = value
        elif inp_type == 'text':
            # ICAO code field
            payload[name] = 'EBSG'
        elif inp_type == 'checkbox':
            # Enable all data type checkboxes (METAR, TAF, SIGMET, GAMET)
            payload[name] = value or 'on'
        elif inp_type == 'submit':
            payload[name] = value

    for sel in opmet_form.find_all('select'):
        name = sel.get('name')
        if not name:
            continue
        # METAR HISTORY → "no"
        payload[name] = 'no'

    print(f"OPMET: Submitting payload: {payload}")

    # Build the submit URL
    if form_action.startswith('http'):
        submit_url = form_action
    elif form_action.startswith('/'):
        submit_url = 'https://ops.skeyes.be' + form_action
    else:
        submit_url = 'https://ops.skeyes.be/opersite/' + form_action

    # Remove jsessionid from URL if present (session handles cookies)
    submit_url = re.sub(r';jsessionid=[^?]*', '', submit_url)

    # Submit the form
    submit_resp = session.post(submit_url, data=payload)
    submit_resp.raise_for_status()
    print(f"OPMET: Form submitted, status={submit_resp.status_code}, length={len(submit_resp.text)}")

    # Step 3: Download the PDF
    pdf_url = "https://ops.skeyes.be/opersite/opmet.do?cmd=opmetAsPdf"
    pdf_resp = session.get(pdf_url)
    pdf_resp.raise_for_status()

    if not pdf_resp.content[:4] == b'%PDF':
        print("OPMET: Response is not a PDF, saving debug output")
        with open("_debug_opmet_response.html", "wb") as dbg:
            dbg.write(pdf_resp.content)
        return False

    with open("opmet.pdf", "wb") as f:
        f.write(pdf_resp.content)
    print("OPMET PDF saved to opmet.pdf")

    # Convert PDF to HTML with images
    convert_pdf_to_html("opmet.pdf", "opmet.html", "opmet_page")
    print("OPMET images and HTML generated.")
    return True


def main():
    login_url = "https://ops.skeyes.be/opersite/login.do"
    data_url = "https://ops.skeyes.be/opersite/notamsummary.do?cmd=summaryToHtml"
    daily_url = "https://ops.skeyes.be/opersite/dailywarnings.do?cmd=warningstoday"
    
    username = os.getenv("SKEYES_USER")
    password = os.getenv("SKEYES_PASS")
    
    if not username or not password:
        print("Missing credentials")
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
    login_payload = {
        "j_username": username,
        "j_password": password
    }
    
    login_response = session.post(login_url, data=login_payload)
    login_response.raise_for_status()
    
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
        print(f"Error fetching OPMET: {e}")

if __name__ == "__main__":
    main()
