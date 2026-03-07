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

    browser_headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "fr,fr-FR;q=0.9,en-US;q=0.8,en;q=0.7",
        "Upgrade-Insecure-Requests": "1",
    }

    # Step 1: Open the meteo portal first, then try the two OPMET init URLs seen around the UI.
    portal_url = "https://ops.skeyes.be/oper-meteo-info"
    try:
        portal_resp = session.get(portal_url, headers=browser_headers)
        print(f"OPMET portal: status={portal_resp.status_code}, final_url={portal_resp.url}")
    except Exception as exc:
        print(f"OPMET portal warm-up failed: {exc}")

    init_attempts = []
    init_candidates = [
        "https://ops.skeyes.be/opersite/opmet.do?cmd=init",
        "https://ops.skeyes.be/opersite/opmeteoindex.do?cmd=init",
    ]

    resp = None
    soup = None
    for init_url in init_candidates:
        headers = dict(browser_headers)
        headers["Referer"] = portal_url
        current_resp = session.get(init_url, headers=headers)
        current_resp.raise_for_status()
        current_soup = BeautifulSoup(current_resp.text, 'html.parser')
        got_login = current_soup.find('form', {'name': 'loginForm'}) is not None
        init_attempts.append({
            "url": init_url,
            "final_url": current_resp.url,
            "status": current_resp.status_code,
            "length": len(current_resp.text),
            "got_login": got_login,
        })
        print(
            f"OPMET init attempt: url={init_url} status={current_resp.status_code} "
            f"final_url={current_resp.url} length={len(current_resp.text)} login={got_login}"
        )
        if not got_login:
            resp = current_resp
            soup = current_soup
            break

    if resp is None or soup is None:
        print("OPMET: Session not authenticated - got login form on all init URLs")
        attempts_html = "".join(
            f"<li><b>{a['url']}</b><br>status={a['status']} final={a['final_url']} "
            f"length={a['length']} login={a['got_login']}</li>"
            for a in init_attempts
        )
        with open("opmet.html", "w", encoding="utf-8") as f:
            f.write(
                "<!DOCTYPE html><html><head><meta charset='utf-8'>"
                "<meta name='viewport' content='width=device-width, initial-scale=1.0'></head>"
                "<body style='font-family:system-ui,sans-serif;padding:16px'>"
                "<h1>Session perdue ou non authentifiee par Skeyes</h1>"
                "<p>Le module OPMET refuse encore l'ouverture directe. Details:</p>"
                f"<ul>{attempts_html}</ul>"
                "</body></html>"
            )
        return False

    print(f"OPMET init selected: status={resp.status_code}, final_url={resp.url}, length={len(resp.text)}")

    # Step 2: Build the exact payload that the browser sends
    payload = {
        "templateName": "",
        "newTemplateName": "",
        "selectCountry": "",
        "template": "select",
        "icaocodes": "EBSG",
        "land1": "on",
        "metar": "on",
        "taf": "on",
        "sigmet": "on",
        "gametairmet": "on",
        "metarHistory": "0"
    }

    print(f"OPMET: Payload = {payload}")

    # Step 3: Submit directly to opmetData.do?cmd=retrieveOpmet
    submit_url = "https://ops.skeyes.be/opersite/opmetData.do?cmd=retrieveOpmet"
    
    # Need to specify content-type for form urlencoded
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://ops.skeyes.be',
        'Referer': resp.url,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
    submit_resp = session.post(submit_url, data=payload, headers=headers)
    
    if not submit_resp.ok:
        print(f"OPMET Submit failed: {submit_resp.status_code}")
        with open("opmet.html", "w", encoding="utf-8") as f:
            f.write(f"<!-- ERROR HTTP {submit_resp.status_code} -->\n{submit_resp.text}")
        submit_resp.raise_for_status()
        
    print(f"OPMET: Submit status={submit_resp.status_code}, length={len(submit_resp.text)}")

    # Check if the response contains actual METAR/TAF data
    has_metar = 'METAR' in submit_resp.text or 'TAF' in submit_resp.text
    print(f"OPMET: Response contains METAR/TAF data: {has_metar}")

    if not has_metar:
        with open("opmet.html", "w", encoding="utf-8") as f:
            f.write("<!-- DEBUG OUTPUT -->\n" + submit_resp.text)
        print("OPMET: No METAR data in response, saved to opmet.html for debug")
        return False

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
    with open("opmet.html", "w", encoding="utf-8") as f:
        f.write("<!-- DEBUG --><h1>Ã‰chec inattendu : ni rapport mÃ©tÃ©o ni PDF trouvÃ©</h1>")
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

    # --- Extract OPMET (METAR/TAF/SIGMET/GAMET) RIGHT AFTER NOTAMS TO KEEP SESSION ALIVE ---
    try:
        fetch_opmet(session)
    except Exception as e:
        print(f"Error fetching OPMET: {e}")
        with open("opmet.html", "w", encoding="utf-8") as f:
            f.write(f"<!-- ERROR -->\n<h1>Error fetching OPMET</h1><pre>{e}</pre>")

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


