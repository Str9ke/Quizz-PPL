
import json
with open('ops.skeyes.be_Archive [26-03-08 10-18-09].har', 'r', encoding='utf-8') as f:
    data = json.load(f)
for entry in data['log']['entries']:
    request = entry['request']
    url = request['url']
    if 'opersite' in url:
        method = request.get('method')
        headers = request.get('headers', [])
        referer = next((h['value'] for h in headers if h['name'].lower() == 'referer'), None)
        print(f'{method} {url} | Ref: {referer}')

