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

    # Step 1: Initialize the OPMET form page (sets up server-side session state)
    init_url = "https://ops.skeyes.be/opersite/opmeteoindex.do?cmd=init"
    resp = session.get(init_url)
    resp.raise_for_status()
    print(f"OPMET init: status={resp.status_code}, length={len(resp.text)}")

    soup = BeautifulSoup(resp.text, 'html.parser')

    # Check if we got a login page instead of the form
    if soup.find('form', {'name': 'loginForm'}):
        print("OPMET: Session not authenticated - got login form")
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

    # Step 3: Build form payload
    payload = {}
    if opmet_form:
        print("OPMET: Using dynamically discovered form fields")
        for inp in opmet_form.find_all('input'):
            name = inp.get('name')
            if not name:
                continue
            inp_type = inp.get('type', 'text').lower()
            value = inp.get('value', '')
            if inp_type == 'hidden':
                payload[name] = value
            elif inp_type == 'text':
                payload[name] = 'EBSG'
            elif inp_type == 'checkbox':
                payload[name] = value or 'on'
            elif inp_type == 'submit':
                payload[name] = value
        for sel in opmet_form.find_all('select'):
            name = sel.get('name')
            if name:
                payload[name] = 'no'
    else:
        # Fallback: use common Struts form field names
        print("OPMET: No form found, using fallback field names")
        # Save the page for debugging
        with open("_debug_opmet_init.html", "w", encoding="utf-8") as dbg:
            dbg.write(resp.text)

    print(f"OPMET: Payload = {payload}")

    # Step 4: Submit to opmetData.do?cmd=retrieveOpmet (discovered from network console)
    submit_url = "https://ops.skeyes.be/opersite/opmetData.do?cmd=retrieveOpmet"
    submit_resp = session.post(submit_url, data=payload)
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

    print("OPMET: Failed to retrieve data")
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
