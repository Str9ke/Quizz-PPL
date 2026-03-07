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
            
            # Ne pas recadrer les cartes météo, elles sont à afficher en entier
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
        
    # 3. WINTEM France FL050
    url_wintem_fr = get_sofia_map_url(session, "postWintem", "FRANCE", level="050")
    if url_wintem_fr:
        download_and_convert_pdf(session, url_wintem_fr, "wintem_france", "WINTEM France")

    # 4. WINTEM EUROC FL050
    url_wintem_eu = get_sofia_map_url(session, "postWintem", "EUROC", level="050")
    if url_wintem_eu:
        download_and_convert_pdf(session, url_wintem_eu, "wintem_euroc", "WINTEM EUROC")

if __name__ == "__main__":
    main()
