import os
import requests
import fitz
from bs4 import BeautifulSoup
import json
import traceback
import glob

def download_and_convert_pdf(session, url, prefix, map_name):
    print(f"Fetching {map_name}...")
    try:
        resp = session.get(url)
        resp.raise_for_status()
        
        pdf_name = f"{prefix}.pdf"
        with open(pdf_name, "wb") as f:
            f.write(resp.content)
            
        doc = fitz.open(pdf_name)
        images = []
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
            images.append(img_filename)
            
        print(f"✅ {map_name} -> {len(images)} page(s)")
        return images
        
    except Exception as e:
        print(f"❌ Error processing {map_name} from {url}: {e}")
        traceback.print_exc()
        return []

def get_all_sofia_maps(session, operation, zone, level=None, level_filter=None):
    """Return list of {date, deadline, level, link} for all available maps."""
    sofia_api = "https://sofia-briefing.aviation-civile.gouv.fr/sofia"
    data = {':operation': operation, 'zone': zone}
    if level:
        data['level'] = level
        
    try:
        req = session.post(sofia_api, data=data)
        soup = BeautifulSoup(req.text, 'html.parser')
        msg_div = soup.find('div', id='Message')
        if not msg_div:
            return []
        js_data = json.loads(msg_div.text)
        
        key = 'wintem' if 'postWintem' in operation else 'temsi'
        
        results = []
        if 'zones' in js_data and len(js_data['zones']) > 0:
            zone_data = js_data['zones'][0]
            for entry in zone_data.get(key, []):
                # Filter by level if specified (e.g. only FL20-100 for WINTEM France)
                if level_filter and entry.get('level') != level_filter:
                    continue
                link = entry.get('link')
                if link:
                    results.append({
                        'date': entry.get('date', ''),
                        'deadline': entry.get('deadline', ''),
                        'level': entry.get('level', ''),
                        'url': f"https://aviation.meteo.fr{link}"
                    })
        return results
    except Exception as e:
        print(f"Error fetching metadata for {operation} {zone}: {e}")
        return []

def fetch_all_charts(session, operation, zone, prefix, map_name, level=None, level_filter=None):
    """Fetch all available time entries for a chart type, generate PNGs and manifest."""
    entries = get_all_sofia_maps(session, operation, zone, level=level, level_filter=level_filter)
    if not entries:
        print(f"⚠️ No entries found for {map_name}")
        return
    
    print(f"📊 {map_name}: {len(entries)} time entries found")
    
    # Clean up old files for this prefix
    for old_file in glob.glob(f"{prefix}_*.png"):
        os.remove(old_file)
    for old_file in glob.glob(f"{prefix}.pdf"):
        pass  # Keep overwriting
    
    manifest = []
    
    for idx, entry in enumerate(entries):
        entry_prefix = f"{prefix}_{idx}"
        images = download_and_convert_pdf(session, entry['url'], entry_prefix, f"{map_name} [{entry['deadline']}]")
        
        manifest.append({
            'date': entry['date'],
            'deadline': entry['deadline'],
            'level': entry['level'],
            'images': images
        })
    
    # Also keep backward-compatible single file (first entry = current)
    if entries:
        images = download_and_convert_pdf(session, entries[0]['url'], prefix, f"{map_name} (current)")
    
    # Write manifest
    manifest_file = f"{prefix}_manifest.json"
    with open(manifest_file, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"✅ Manifest written: {manifest_file} ({len(manifest)} entries)")
    
    # Build HTML page with all entries (backward-compatible)
    html_images = ""
    for midx, m in enumerate(manifest):
        for img in m['images']:
            cls = "map-img active" if midx == 0 else "map-img"
            html_images += f'<img class="{cls}" src="{img}" data-label="{m["deadline"]}" />\n'
            if midx == 0:
                cls = "map-img"  # Only first image is active
    
    html_content = f"""<!DOCTYPE html><html><head><meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1.0'>
<style>
body {{ margin:0; padding:0; background:transparent; display:flex; flex-direction:column; align-items:center; font-family:sans-serif; overflow:hidden; }}
.nav-container {{ display:flex; gap:15px; padding:10px; background:rgba(255,255,255,0.9); position:sticky; top:0; z-index:100; border-radius:8px; align-items:center; margin-bottom:5px; box-shadow:0 2px 5px rgba(0,0,0,0.1); }}
.nav-btn {{ padding:8px 16px; background:#667eea; color:white; border:none; border-radius:6px; font-weight:bold; cursor:pointer; }}
.nav-btn:active {{ background:#5a6ad6; }}
.map-img {{ width:100%; display:none; margin:0 auto; border:none; }}
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

def main():
    import time
    from concurrent.futures import ThreadPoolExecutor
    t0 = time.time()
    session = requests.Session()
    session.mount("https://", requests.adapters.HTTPAdapter(pool_maxsize=16))

    print("Scraping SOFIA for Meteo Pdfs...")

    # Les 4 cartes sont indépendantes (préfixes de fichiers distincts) : récupérées en
    # parallèle au lieu de l'une après l'autre.
    jobs = [
        # 1. TEMSI France - all time entries
        dict(operation="postTemsi", zone="FRANCE", prefix="temsi_france", map_name="TEMSI France"),
        # 2. TEMSI EUROC - all time entries
        dict(operation="postTemsi", zone="EUROC", prefix="temsi_euroc", map_name="TEMSI EUROC"),
        # 3. WINTEM France FL050 - filter to low level only
        dict(operation="postWintem", zone="FRANCE", prefix="wintem_france", map_name="WINTEM France",
             level="050", level_filter="FL20-100"),
        # 4. WINTEM EUROC FL050 - filter to low level only
        dict(operation="postWintem", zone="EUROC", prefix="wintem_euroc", map_name="WINTEM EUROC",
             level="050", level_filter="FL50-100"),
    ]
    ready_dir = os.getenv("READY_DIR")

    def run(job):
        try:
            fetch_all_charts(session, **job)
        except Exception as e:
            print(f"❌ {job['map_name']}: {e}")
        finally:
            # Témoin pour la publication progressive (voir _Publisher dans fetch_notams.py) :
            # cette carte est prête, ses fichiers peuvent partir tout de suite.
            if ready_dir:
                os.makedirs(ready_dir, exist_ok=True)
                path = os.path.join(ready_dir, job["prefix"])
                with open(path + ".tmp", "w", encoding="utf-8") as f:
                    f.write(job["prefix"] + "*\n")
                os.replace(path + ".tmp", path)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(run, jobs))
    print(f"::notice title=Durée TEMSI/WINTEM::{time.time() - t0:.1f}s")

if __name__ == "__main__":
    main()

