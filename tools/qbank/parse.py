"""Pages de correction (raw/) -> questions {id, question, choix, bonne_reponse, image_url, explication, explication_images, sujet}."""
import glob, html, json, os, re

BLOCK = "<table width='100%' border='0' cellspacing='0' cellpadding='5' class='texte cadre'>"


def fix(s):
    # page déclarée ISO-8859-1 mais écrite en Windows-1252 : ’ « » œ … arrivent en caractères de contrôle
    return ''.join(c.encode('latin-1').decode('cp1252', 'replace') if 0x80 <= ord(c) <= 0x9f else c for c in s)


def text(h):
    h = re.sub(r'(?i)<br\s*/?>|</br>', '\n', h)
    h = re.sub(r'(?i)</(p|div|li|tr)>', '\n', h)
    h = re.sub(r'(?i)<li[^>]*>', '- ', h)
    h = re.sub(r'<[^>]+>', '', h)
    h = html.unescape(h).replace('\xa0', ' ')
    h = re.sub(r'[ \t]+', ' ', h)
    h = re.sub(r' *\n *', '\n', h)
    return re.sub(r'\n{3,}', '\n\n', h).strip()


def imgs(h):
    out = []
    for src in re.findall(r'''<img[^>]*src=["']([^"']+)["']''', h, re.I):
        if 'images/bonne_reponse' in src or '/images/Bouton' in src or src.startswith('images/'):
            continue
        if not src.startswith('http'):
            src = 'https://www.chezgligli.net/' + src.lstrip('/')
        out.append(src)
    return out


def parse_page(t):
    t = fix(t)
    res = []
    for b in t.split(BLOCK)[1:]:
        m = re.search(r"class='qcm_examen_no'>(\d+)</td><td[^>]*class='qcm_examen_question'>(.*?)</td><td width='1px'", b, re.S)
        if not m:
            continue
        qid, qh = int(m.group(1)), m.group(2)
        # annexe : vignette dans la 3e case de la ligne de question
        am = re.search(r"<td width='1px' class='qcm_examen_question'>(.*?)</td></tr>", b, re.S)
        ah_ = am.group(1) if am else ''
        rows = re.findall(r"value='([A-F])'.*?class='qcm_examen_reponses(_bonne)?'[^>]*>(.*?)</tr>", b, re.S)
        choix, bonne, cimgs = [], None, []
        for k, (_, good, ah) in enumerate(rows):
            choix.append(text(ah))
            cimgs += imgs(ah)
            if good:
                bonne = k
        em = re.search(r"<div class='commentaires-list commentaire_cadre2'>(.*?)</div></td></tr>", b, re.S)
        eh = em.group(1) if em else ''
        qi = imgs(qh) + imgs(ah_)
        res.append({
            'gid': qid, 'question': text(qh), 'choix': choix, 'bonne_reponse': bonne,
            'q_imgs': qi, 'c_imgs': cimgs, 'explication': text(eh), 'e_imgs': imgs(eh),
        })
    return res


if __name__ == '__main__':
    idx = json.load(open('index.json', encoding='utf-8'))
    out = {}
    bad = 0
    for key, m in idx.items():
        cid, mid = key.split('/')
        qs = {}
        series = [(f'raw/{cid}_{mid}_{sid}.html', sname) for sid, sname in m['sujets'].items()]
        series += [(f, 'Autres questions (hors série)') for f in sorted(glob.glob(f'raw/miss_{cid}_{mid}_*.html'))]
        for fn, sname in series:
            if not os.path.exists(fn):
                continue
            for q in parse_page(open(fn, encoding='utf-8').read()):
                if q['bonne_reponse'] is None or len(q['choix']) < 2:
                    bad += 1
                    continue
                if q['gid'] in qs:
                    qs[q['gid']]['sujets'].append(sname)
                else:
                    q['sujets'] = [sname]
                    qs[q['gid']] = q
        out[key] = {**{k: v for k, v in m.items() if k != 'sujets'}, 'sujets': m['sujets'], 'questions': sorted(qs.values(), key=lambda q: q['gid'])}
        print(key, m['class'], m['name'][:40], 'site', m['count'], 'récupérées', len(qs), 'manquantes', len(set(m['all']) - {str(g) for g in qs}))
    json.dump(out, open('parsed.json', 'w', encoding='utf-8'), ensure_ascii=False)
    print('sans réponse', bad)
