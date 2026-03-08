import json

file_path = 'ops.skeyes.be_Archive [26-03-08 10-02-41].har'

with open(file_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

for entry in data['log']['entries']:
    request = entry['request']
    url = request['url']
    
    if 'opmet' in url.lower():
        method = request.get('method')
        response = entry.get('response', {})
        status = response.get('status')
        
        headers = request.get('headers', [])
        referer = next((h['value'] for h in headers if h['name'].lower() == 'referer'), None)
        
        print(f"Method: {method}")
        print(f"URL: {url}")
        print(f"Referer: {referer}")
        print(f"Status: {status}")
        
        if method == 'POST':
            post_data = request.get('postData', {})
            if 'text' in post_data:
                print(f"POST Body: {post_data['text']}")
        print("-" * 40)
