"""Banques de questions par classe (chezgligli.net : ATPL, CAEA, Drones, PPL(H)) -> site.

Entrée  : <travail>/parsed.json (parse_qbank.py) + <travail>/codes.json (fetch_missing.py)
Sorties : qbank/<classe>_<module>.json (une banque par module, id = numéro d'origine du QCM, stable),
          qbank/img/ (annexes et illustrations téléchargées), js/qbank.js (registre : classes, modules, séries).

Usage : python tools/qbank/build_qbank.py <dossier de travail>
"""
import hashlib, json, os, re, sys, time
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'qbank')
IMG = os.path.join(OUT, 'img')
CLASSES = {  # clé interne -> (clé courte, nom court, libellé)
    'ATPL': ('ATPL', 'ATPL', 'ATPL — Licence de pilote de ligne avion'),
    'CAEA': ('CAEA', 'CAEA', "CAEA — Certificat d'aptitude à l'enseignement aéronautique"),
    'DRONES': ('DRONE', 'DRONE', 'Drones — Télépilote de drone civil'),
    'PPLH': ('PPLH', 'PPL(H)', 'PPL(H) — Licence de pilote privé hélicoptère'),
}


def safe_name(url):
    base = re.sub(r'[^A-Za-z0-9._-]+', '_', requests.utils.unquote(url.rsplit('/', 1)[-1]))[:80] or 'img'
    root, ext = os.path.splitext(base)
    return f"{root}_{hashlib.md5(url.encode()).hexdigest()[:6]}{ext.lower() or '.jpg'}"


def site_name(raw):
    """Nom dans le site : photos et schémas en WebP (5 à 10 fois plus légers), GIF gardés (animations)."""
    root, ext = os.path.splitext(raw)
    return raw if ext == '.gif' else root + '.webp'


def to_site(src, dst):
    if dst.endswith('.gif'):
        open(dst, 'wb').write(open(src, 'rb').read())
        return
    from PIL import Image
    im = Image.open(src)
    im = im.convert('RGBA' if im.mode in ('RGBA', 'LA', 'P') else 'RGB')
    im.thumbnail((1600, 1600))
    im.save(dst, 'WEBP', quality=80, method=6)


def main(work):
    parsed = json.load(open(os.path.join(work, 'parsed.json'), encoding='utf-8'))
    codes = json.load(open(os.path.join(work, 'codes.json'), encoding='utf-8'))
    os.makedirs(IMG, exist_ok=True)
    sess = requests.Session()
    sess.headers['User-Agent'] = 'Mozilla/5.0 (QuizPPL; usage personnel)'
    if os.environ.get('GLIGLI_PHPSESSID'):   # annexes servies aux abonnés connectés
        sess.cookies.set('PHPSESSID', os.environ['GLIGLI_PHPSESSID'], domain='www.chezgligli.net')
    urls = {}

    def local(u):
        if u not in urls:
            urls[u] = 'qbank/img/' + site_name(safe_name(u))
        return urls[u]

    reg, nth = {}, {}
    for key, m in parsed.items():
        cls = CLASSES[m['class']]
        img = codes.get(key, '')
        code = (re.search(r'module_(\d+)\.', img) or [None, ''])[1]   # ATPL : 010, 021… ; sinon ordre du site
        if not code:
            nth[cls[0]] = nth.get(cls[0], 0) + 1
            code = str(nth[cls[0]]).zfill(2)
        cat = f'QB {cls[0]} {code}'
        fname = f'qbank/{cls[0].lower()}_{code.lower()}.json'
        qs = []
        for q in m['questions']:
            qi = [local(u) for u in q['q_imgs']]
            qs.append({
                'id': q['gid'], 'question': q['question'], 'choix': q['choix'], 'bonne_reponse': q['bonne_reponse'],
                'image_url': qi[0] if qi else None,
                **({'images_question': qi[1:]} if len(qi) > 1 else {}),
                **({'images_choix': [local(u) for u in q['c_imgs']]} if q['c_imgs'] else {}),
                'explication': q['explication'],
                **({'explication_images': [local(u) for u in q['e_imgs']]} if q['e_imgs'] else {}),
                'sujets': q['sujets'],
            })
        if not qs:
            continue
        json.dump(qs, open(os.path.join(ROOT, fname), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        count = {}
        for q in qs:
            for s in q['sujets']:
                count[s] = count.get(s, 0) + 1
        order = list(m['sujets'].values()) + ['Autres questions (hors série)']
        c = reg.setdefault(cls[0], {'key': cls[0], 'short': cls[1], 'label': cls[2], 'count': 0, 'modules': []})
        c['modules'].append({'cat': cat, 'code': code, 'name': m['name'], 'file': fname, 'count': len(qs),
                             'sujets': [[s, count[s]] for s in dict.fromkeys(order) if count.get(s)]})
        c['count'] += len(qs)
        print(cat, m['name'][:50], len(qs))
    for c in reg.values():
        c['modules'].sort(key=lambda x: x['code'])
    order = ['ATPL', 'PPLH', 'CAEA', 'DRONE']
    data = {'source': 'chezgligli.net (abonnement de Thomas)', 'generated': time.strftime('%Y-%m-%d'),
            'classes': sorted(reg.values(), key=lambda c: order.index(c['key']) if c['key'] in order else 99)}
    with open(os.path.join(ROOT, 'js', 'qbank.js'), 'w', encoding='utf-8') as f:
        f.write('// Généré par tools/qbank/build_qbank.py — ne pas modifier à la main.\nwindow.QBANK = ')
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    # images (une seule fois chacune) : originaux gardés dans <travail>/imgcache, version allégée dans le site
    cache = os.path.join(work, 'imgcache')
    os.makedirs(cache, exist_ok=True)
    miss = 0
    for u, p in urls.items():
        fp = os.path.join(ROOT, p)
        raw = os.path.join(cache, safe_name(u))
        if os.path.exists(fp):
            continue
        if os.path.exists(raw):
            try:
                to_site(raw, fp)
            except Exception as e:
                print('  image illisible', e, u)
            continue
        for k in range(3):
            try:
                r = sess.get(u, timeout=60)
                if r.status_code == 200 and r.content:
                    open(raw, 'wb').write(r.content)
                    try:
                        to_site(raw, fp)
                    except Exception as e:
                        print('  image illisible', e, u)
                    break
                print('  image', r.status_code, u)
                miss += 1
                break
            except Exception as e:
                print('  image err', e, u)
                time.sleep(3)
        time.sleep(0.2)
    print(len(urls), 'images,', miss, 'introuvables ;', sum(c['count'] for c in reg.values()), 'questions')


if __name__ == '__main__':
    main(sys.argv[1])
