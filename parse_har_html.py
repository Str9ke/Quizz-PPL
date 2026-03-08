
import json
with open('ops.skeyes.be_Archive [26-03-08 10-18-09].har', 'r', encoding='utf-8') as f:
    data = json.load(f)
for entry in data['log']['entries']:
    url = entry['request']['url']
    if 'remoteSensingDetail.do' in url:
        resp_text = entry.get('response', {}).get('content', {}).get('text', '')
        # print specific parts of the html, let's look for 'var ' or 'image'
        import re
        for line in resp_text.split('\n'):
            if 'METSRV' in line or 'radar' in line or 'var' in line or 'image' in line.lower() or 'jpg' in line.lower() or 'png' in line.lower():
                print(line.strip())
        break

