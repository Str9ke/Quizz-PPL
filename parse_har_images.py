
import json
with open('ops.skeyes.be_Archive [26-03-08 10-18-09].har', 'r', encoding='utf-8') as f:
    data = json.load(f)
for entry in data['log']['entries']:
    url = entry['request']['url']
    if ('.png' in url or '.gif' in url or '.jpg' in url or '.jpeg' in url) and 'animation_buttons' not in url:
        print(entry['request']['method'], url)

