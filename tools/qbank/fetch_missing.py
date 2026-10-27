"""Après crawl.py : codes des modules (010, 021…) + questions rangées dans aucune série (raw/miss_*)."""
import json, os, re, time
from s import S, B
from parse import parse_page

idx = json.load(open('index.json', encoding='utf-8'))


def post(d):
    r = S.post(B, data=d, timeout=180)
    if 'Déconnexion' not in r.text:
        raise SystemExit('session expirée')
    time.sleep(1)
    return r.text


codes = {}
for cid in sorted({k.split('/')[0] for k in idx}):
    t = post({'pg': '2', 'ID': cid})
    for img, mid in re.findall(r'src="images/([^"]+)"\s*type=image onclick="qcm_classe_select\(this\.form, (\d+)\)', t):
        codes[cid + '/' + mid] = img
json.dump(codes, open('codes.json', 'w', encoding='utf-8'), indent=1)
print(codes)

for key, m in idx.items():
    cid, mid = key.split('/')
    got = set()
    for sid in m['sujets']:
        fn = f'raw/{cid}_{mid}_{sid}.html'
        if os.path.exists(fn):
            got |= {str(q['gid']) for q in parse_page(open(fn, encoding='utf-8').read())}
    miss = [x for x in m['all'] if x not in got]
    fn = f'raw/miss_{cid}_{mid}.html'
    if not miss or os.path.exists(fn):
        continue
    print(key, len(miss), 'hors série', flush=True)
    post({'pg': '4', 'act': 'choix_all', 'limite_tot': str(len(miss)), 'NV_qcm': ','.join(miss), 'DV_qcm': '', 'RV_qcm': '',
          'limite1': str(len(miss)), 'limite2': '', 'limite3': '', 'limite4': '0'})
    c = post({'pg': '5', 'entrainement': 'all'})
    open(fn, 'w', encoding='utf-8').write(c)
    print('  ->', len(parse_page(c)), flush=True)
print('FINI')
