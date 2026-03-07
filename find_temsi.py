import requests
import re
from bs4 import BeautifulSoup

url = "https://sofia-briefing.aviation-civile.gouv.fr/sofia/pages/meteotemsi.html"
res = requests.get(url)
soup = BeautifulSoup(res.text, 'html.parser')

for script in soup.find_all('script'):
    src = script.get('src')
    if src:
        if not src.startswith('http'):
            src = "https://sofia-briefing.aviation-civile.gouv.fr" + src
        try:
            js = requests.get(src).text
            if 'temsi' in js.lower():
                print(f"Found 'temsi' in {src}")
                # Find all API-like paths
                paths = set(re.findall(r'(\/[a-zA-Z0-9_\-\.]+)+', js))
                for p in paths:
                    if 'temsi' in p.lower() or 'meteo' in p.lower():
                        print("  ->", p)
        except Exception as e:
            pass
