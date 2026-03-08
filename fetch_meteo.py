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
            
            # Recadrer les cartes meteo en incluant le texte ET les images
            blocks = page.get_text('blocks')
            imgs = page.get_image_info()
            if blocks or imgs:
                x0 = min([b[0] for b in blocks] + [i['bbox'][0] for i in imgs]) if blocks or imgs else 0
                y0 = min([b[1] for b in blocks] + [i['bbox'][1] for i in imgs]) if blocks or imgs else 0
                x1 = max([b[2] for b in blocks] + [i['bbox'][2] for i in imgs]) if blocks or imgs else page.mediabox.x1
                y1 = max([b[3] for b in blocks] + [i['bbox'][3] for i in imgs]) if blocks or imgs else page.mediabox.y1
                margin = 5
                r_mediabox = page.mediabox
                new_x0 = max(r_mediabox.x0, x0 - margin)
                new_y0 = max(r_mediabox.y0, y0 - margin)
                new_x1 = min(r_mediabox.x1, x1 + margin)
                new_y1 = min(r_mediabox.y1, y1 + margin)
                if new_x0 < new_x1 and new_y0 < new_y1:
                    rect = fitz.Rect(new_x0, new_y0, new_x1, new_y1)
                    page.set_cropbox(rect)
            pix = page.get_pixmap(dpi=150)
            img_filename = f'{prefix}_page_{page_num}.png'
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
        setTimeout(function() {{
            try {{ window.parent.postMessage({{type: 'resize', height: document.body.scrollHeight}}, '*'); }} catch(e){{}}
        }}, 50);
    }}
    function changeImage(dir) {{ showImage(currentImg + dir); }}
    window.onload = init;
</script>
</body></html>"""

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

