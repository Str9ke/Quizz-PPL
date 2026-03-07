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
    # Custom filtering logic goes here based on the target HTML structure
    notam_section = soup.find('body') # Placeholder: adjust selector based on actual structure
    
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
            # Crop margins if PyMuPDF version doesn't support get_bbox_of_contents, use bbox alternatively
            try:
                bbox = page.get_bbox_of_contents()
            except AttributeError:
                # Fallback to compute visually if the method is not available in that version of PyMuPDF
                bbox = page.get_bounding_box(1) if hasattr(page, 'get_bounding_box') else page.rect
            
            rect = fitz.Rect(max(0, bbox.x0 - 10), max(0, bbox.y0 - 10), min(page.rect.x1, bbox.x1 + 10), min(page.rect.y1, bbox.y1 + 10))
            page.set_cropbox(rect)
            
            pix = page.get_pixmap(dpi=150) # Bonne résolution
            img_filename = f"daily_warnings_page_{page_num}.png"
            pix.save(img_filename)
            html_images += f'<img src="{img_filename}" style="width:100%; max-width:800px; margin-bottom:10px; border:1px solid #ccc; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" /><br/>\n'
        
        html_content = f"<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1.0'></head><body style='text-align:center; background:#fff; margin:0; padding:10px;'>\n{html_images}\n</body></html>"
        
        with open("daily_warnings.html", "w", encoding="utf-8") as f:
            f.write(html_content)
        print("Daily Warnings images and HTML generated.")
        
    except Exception as e:
        print(f"Error converting PDF to images: {e}")

if __name__ == "__main__":
    main()
