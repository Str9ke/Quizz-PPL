import os
import requests
import cloudscraper
import fitz  # PyMuPDF
from bs4 import BeautifulSoup
import json

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
        # Supprimer le texte rouge d'avertissement SKEYES
        red_font = notam_section.find('font', color='red')
        if red_font:
            red_font.decompose()

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
        doc = fitz.open("daily_warnings.pdf")
        html_images = ""
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            # Crop margins en cherchant les blocs de contenu
            blocks = page.get_text("blocks")
            if blocks:
                x0 = min(b[0] for b in blocks)
                y0 = min(b[1] for b in blocks)
                x1 = max(b[2] for b in blocks)
                y1 = max(b[3] for b in blocks)
                
                margin = 10
                
                # S'assurer que le cropbox calculé est valide par rapport au MediaBox
                r_mediabox = page.mediabox
                # Calculer les nouvelles coordonnées avec sécurité
                new_x0 = max(r_mediabox.x0, x0 - margin)
                new_y0 = max(r_mediabox.y0, y0 - margin)
                new_x1 = min(r_mediabox.x1, x1 + margin)
                new_y1 = min(r_mediabox.y1, y1 + margin)
                
                # Vérifier la validité de la boîte (x0 < x1 et y0 < y1)
                if new_x0 < new_x1 and new_y0 < new_y1:
                    rect = fitz.Rect(new_x0, new_y0, new_x1, new_y1)
                    page.set_cropbox(rect)
            
            pix = page.get_pixmap(dpi=150) # Bonne résolution
            img_filename = f"daily_warnings_page_{page_num}.png"
            pix.save(img_filename)
            html_images += f'<img src="{img_filename}" style="width:100%; display:block; margin:0 auto;" />\n'
        
        html_content = f"<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1.0'></head><body style='margin:0; padding:0; background:transparent;'>\n{html_images}\n</body></html>"
        
        with open("daily_warnings.html", "w", encoding="utf-8") as f:
            f.write(html_content)
        print("Daily Warnings images and HTML generated.")
        
    except Exception as e:
        print(f"Error converting PDF to images: {e}")

if __name__ == "__main__":
    main()
