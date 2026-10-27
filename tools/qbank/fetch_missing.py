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

import glob
for key, m in idx.items():
    cid, mid = key.split('/')
    for k in range(4):
        got = set()
        files = [f'raw/{cid}_{mid}_{sid}.html' for sid in m['sujets']] + glob.glob(f'raw/miss_{cid}_{mid}_*.html')
        for fn in files:
            if os.path.exists(fn):
                got |= {str(q['gid']) for q in parse_page(open(fn, encoding='utf-8').read())}
        miss = [x for x in m['all'] if x not in got]
        if not miss:
            break
        print(key, len(miss), 'hors série', flush=True)
        post({'pg': '2', 'ID': cid})          # le site garde la classe en session : module d'une autre classe = 0 QCM
        post({'pg': '3', 'ID': mid})
        post({'pg': '4', 'act': 'choix_all', 'limite_tot': str(len(m['all'])), 'NV_qcm': ','.join(miss), 'DV_qcm': '', 'RV_qcm': '',
              'limite1': str(len(miss)), 'limite2': '', 'limite3': '', 'limite4': '0'})
        c = post({'pg': '5', 'entrainement': 'all'})
        open(f'raw/miss_{cid}_{mid}_{k}.html', 'w', encoding='utf-8').write(c)
        print('  ->', len(parse_page(c)), flush=True)
print('FINI')
