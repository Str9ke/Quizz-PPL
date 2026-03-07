import os
import requests
import cloudscraper
import fitz
from bs4 import BeautifulSoup
import json
import traceback

def download_and_convert_pdf(session, url, prefix, map_name):
    print(f"Fetching {map_name}...")
    try:
        resp = session.get(url)
        resp.raise_for_status()
        
        pdf_name = f"{prefix}.pdf"
        with open(pdf_name, "wb") as f:
            f.write(resp.content)
            
        doc = fitz.open(pdf_name)
        html_images = ""
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            
            # Recadrer les cartes météo pour enlever les marges blanches
            blocks = page.get_text("blocks")
            if blocks:
                x0 = min(b[0] for b in blocks)
                y0 = min(b[1] for b in blocks)
                x1 = max(b[2] for b in blocks)
                y1 = max(b[3] for b in blocks)
                
                margin = 5
                
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
            
            pix = page.get_pixmap(dpi=150)
            img_filename = f"{prefix}_page_{page_num}.png"
            pix.save(img_filename)
            html_images += f'<img src="{img_filename}" style="width:100%; display:block; margin:0 auto;" />\n'
            
        html_content = f"<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1.0'></head><body style='margin:0; padding:0; background:transparent;'>\n{html_images}\n</body></html>"
        
        with open(f"{prefix}.html", "w", encoding="utf-8") as f:
            f.write(html_content)
        print(f"✅ {map_name} processed and saved as {prefix}.html")
        
    except Exception as e:
        print(f"❌ Error processing {map_name} from {url}: {e}")
        traceback.print_exc()

def get_sofia_map_url(session, operation, zone, level=None):
    sofia_api = "https://sofia-briefing.aviation-civile.gouv.fr/sofia"
    data = {':operation': operation, 'zone': zone}
    if level:
        data['level'] = level
        
    try:
        req = session.post(sofia_api, data=data)
        soup = BeautifulSoup(req.text, 'html.parser')
        msg_div = soup.find('div', id='Message')
        if not msg_div:
            return None
        js_data = json.loads(msg_div.text)
        
        # Le premier élément est généralement le plus proche/récent
        # Wintem vs Temsi keys:
        key = 'wintem' if 'postWintem' in operation else 'temsi'
        
        # Retourne le lien de la première carte trouvée
        if 'zones' in js_data and len(js_data['zones']) > 0:
            zone_data = js_data['zones'][0]
            if key in zone_data and len(zone_data[key]) > 0:
                first_map = zone_data[key][0]
                link = first_map.get('link')
                if link:
                    return f"https://aviation.meteo.fr{link}"
    except Exception as e:
        print(f"Error fetching metadata for {operation} {zone}: {e}")
    return None

def main():
    # Use standard requests instead of cloudscraper to avoid SSL Handshake issues with SOFIA
    session = requests.Session()
    
    print("Scraping SOFIA for Meteo Pdfs...")
    
    # 1. TEMSI France
    url_temsi_fr = get_sofia_map_url(session, "postTemsi", "FRANCE")
    if url_temsi_fr:
        download_and_convert_pdf(session, url_temsi_fr, "temsi_france", "TEMSI France")
        
    # 2. TEMSI EUROC
    url_temsi_eu = get_sofia_map_url(session, "postTemsi", "EUROC")
    if url_temsi_eu:
        download_and_convert_pdf(session, url_temsi_eu, "temsi_euroc", "TEMSI EUROC")
        
    # 3. WINTEM EUROC FL050
    url_wintem_eu = get_sofia_map_url(session, "postWintem", "EUROC", level="050")
    if url_wintem_eu:
        download_and_convert_pdf(session, url_wintem_eu, "wintem_euroc", "WINTEM EUROC")

if __name__ == "__main__":
    main()
