"""Récupère les séries (sujets) des classes demandées : pages de correction brutes dans raw/."""
import os, re, json, time, html
from s import S, B
CLASSES = {'7': 'ATPL', '10': 'DRONES', '6': 'CAEA', '2': 'PPLH'}
os.makedirs('raw', exist_ok=True)
idx = json.load(open('index.json', encoding='utf-8')) if os.path.exists('index.json') else {}

def post(d, tries=4):
    for k in range(tries):
        try:
            r = S.post(B, data=d, timeout=120)
            if r.status_code == 200 and 'Déconnexion' in r.text:
                return r.text
            print('  !', r.status_code, 'connecté' if 'Déconnexion' in r.text else 'DECONNECTE', flush=True)
            if 'Déconnexion' not in r.text: raise SystemExit('session expirée')
        except SystemExit: raise
        except Exception as e:
            print('  err', e, flush=True)
        time.sleep(5 * (k + 1))
    raise RuntimeError('échec')

for cid, cname in CLASSES.items():
    t = post({'pg': '2', 'ID': cid}); time.sleep(1)
    mods = re.findall(r'qcm_classe_select\(this\.form, (\d+)\)"[^>]*><br />\s*<p>(.*?)<br>(\d+) QCM', t, re.S)
    if not mods:
        mods = [(m, '', '0') for m in re.findall(r'qcm_classe_select\(this\.form, (\d+)\)', t)]
    print(cname, len(mods), 'modules', flush=True)
    for mid, mname, mcount in mods:
        key = cid + '/' + mid
        mt = post({'pg': '3', 'ID': mid}); time.sleep(1)
        allids = (re.search(r'name="NV_qcm" type="hidden" value="([\d,]*)"', mt) or [None, ''])[1]
        title = re.sub(r'<[^>]+>', ' ', (re.search(r"class='titre_module'>(.*?)<", mt) or [None, ''])[1])
        sujets = re.findall(r"qcm_choix_sujet\(document\.qcm_sujet, '(\d+)', '(.*?)'\); return false", mt)
        m = idx.setdefault(key, {'class': cname, 'module_id': mid, 'name': html.unescape(mname.strip()),
                                 'count': int(mcount), 'all': [x for x in allids.split(',') if x], 'sujets': {}})
        print(' ', key, m['name'][:50], mcount, 'QCM', len(sujets), 'sujets', flush=True)
        for sid, sname in sujets:
            fn = f'raw/{cid}_{mid}_{sid}.html'
            m['sujets'][sid] = html.unescape(sname).replace(chr(92) + "'", "'")
            if os.path.exists(fn): continue
            post({'pg': '4', 'act': 'sujet', 'ID': sid, 'numero': m['sujets'][sid]}); time.sleep(1)
            c = post({'pg': '5', 'entrainement': 'sujet'}); time.sleep(1)
            open(fn, 'w', encoding='utf-8').write(c)
        json.dump(idx, open('index.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('FINI')
