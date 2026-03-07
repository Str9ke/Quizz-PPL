import os
import requests
import cloudscraper
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
    session = cloudscraper.create_scraper()
    
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
    
    with open("daily_warnings.html", "w", encoding="utf-8") as f:
        f.write(daily_response.text)
        
    print("Daily Warnings saved to daily_warnings.html")

if __name__ == "__main__":
    main()
