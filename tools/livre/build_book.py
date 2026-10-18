#!/usr/bin/env python3
"""Construit livre/<id>/book.json à partir de la traduction tools/livre/<id>/tr/ch*.txt.

Usage :  python tools/livre/build_book.py <id>        (ex. rmh, cap737, ac6022)

Configuration du livre : tools/livre/<id>/config.json
  { "title", "eyebrow", "footer", "groups": [[clé, nom, sous-titre]],
    "chapters": { "n": [libellé, titre, clé de groupe] } }
Format des fichiers de traduction : identique au PHAK (voir tools/livre/phak/build_phak.py) —
@CH n, @INTRO, @PAGE ref pdf=N, # h2, ## h3, P:, - , 1. , FIG:, SUM: a || b, VOC: fr | en ;; …,
puis @SHEET (points à retenir) et @NUMS (chiffres « valeur | sens »).
Les images des pages (livre/<id>/img/NNN.webp) sont produites par tools/livre/render.py, les
figures traduites par tools/livre/extract_figs.py + add_figs.py.
"""
import glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def inl(t):
    t = t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    t = re.sub(r'==(.+?)==', r'<mark>\1</mark>', t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'(?<![\w*])\*(.+?)\*(?![\w*])', r'<i>\1</i>', t)
    return t


def words(h): return len(re.sub(r'<[^>]+>', ' ', h).split())


def parse(path):
    n = None; intro = ''; pages = []; cur = None; sheet = []; nums = []; mode = None; lst = None
    for raw in open(path, encoding='utf8'):
        line = raw.rstrip('\n')
        if not line.strip(): continue
        if line.startswith('@CH '): n = int(line[4:].split()[0]); continue
        if line.startswith('@INTRO '): intro = inl(line[7:]); continue
        if line.startswith('@PAGE '):
            m = re.match(r'@PAGE (\S+) pdf=(\d+)', line)
            cur = {'ref': m.group(1), 'pdf': int(m.group(2)), 'blocks': [], 'summary': [], 'vocab': []}
            pages.append(cur); mode = 'page'; lst = None; continue
        if line == '@SHEET': mode = 'sheet'; continue
        if line == '@NUMS': mode = 'nums'; continue
        if mode == 'sheet': sheet.append(inl(line.lstrip('* ').strip())); continue
        if mode == 'nums': a, b = line.split(' | ', 1); nums.append([inl(a), inl(b)]); continue
        if cur is None: raise SystemExit(f'{path}: contenu avant le premier @PAGE : {line[:60]}')
        b = cur['blocks']
        if line.startswith('# '): b.append({'h': inl(line[2:])}); lst = None
        elif line.startswith('## '): b.append({'h3': inl(line[3:])}); lst = None
        elif line.startswith('P: '): b.append({'p': inl(line[3:])}); lst = None
        elif line.startswith('FIG: '): b.append({'fig': inl(line[5:])}); lst = None
        elif line.startswith('- '):
            if lst != 'ul': b.append({'ul': []}); lst = 'ul'
            b[-1]['ul'].append(inl(line[2:]))
        elif re.match(r'\d+\. ', line):
            if lst != 'ol': b.append({'ol': []}); lst = 'ol'
            b[-1]['ol'].append(inl(re.sub(r'^\d+\. ', '', line)))
        elif line.startswith('SUM: '): cur['summary'] = [inl(x.strip()) for x in line[5:].split(' || ')]
        elif line.startswith('VOC: '): cur['vocab'] = [[inl(y.strip()) for y in x.split(' | ', 1)] for x in line[5:].split(' ;; ')]
        else: raise SystemExit(f'{path}: ligne inconnue : {line[:60]}')
    for p in pages:
        p['w'] = sum(words(x) if isinstance(x, str) else sum(words(y) for y in x) for blk in p['blocks'] for x in blk.values())
        assert p['summary'] and p['vocab'], (path, p['ref'], 'résumé/vocabulaire manquant')
    return n, intro, pages, sheet, nums


def main():
    bid = sys.argv[1]
    src = os.path.join(ROOT, 'tools', 'livre', bid)
    out = os.path.join(ROOT, 'livre', bid)
    cfg = json.load(open(os.path.join(src, 'config.json'), encoding='utf-8'))
    done = {}
    for f in sorted(glob.glob(os.path.join(src, 'tr', 'ch*.txt'))):
        n, intro, pages, sheet, nums = parse(f)
        if n in done:
            i0, p0, s0, n0 = done[n]; done[n] = (i0 or intro, p0 + pages, s0 or sheet, n0 or nums)
        else:
            done[n] = (intro, pages, sheet, nums)
    groups = {g[0]: g[1] for g in cfg['groups']}
    chapters = []
    for key, (label, title, g) in sorted(cfg['chapters'].items(), key=lambda kv: int(kv[0])):
        n = int(key)
        if n not in done: continue
        intro, pages, sheet, nums = done[n]
        for p in pages:
            img = os.path.join(out, 'img', '%03d.webp' % p['pdf'])
            assert os.path.exists(img), f'image de page manquante : {img} (lancer tools/livre/render.py)'
        chapters.append({'n': n, 'label': label, 'title': title, 'intro': intro, 'group': groups[g],
                         'sheet': {'points': sheet, 'nums': nums}, 'pages': pages})
    pending = [f'{v[0]} — {v[1]}' for k, v in cfg['chapters'].items() if int(k) not in done]
    os.makedirs(out, exist_ok=True)
    json.dump({'id': bid, 'title': cfg['title'], 'eyebrow': cfg['eyebrow'], 'footer': cfg['footer'],
               'groups': [{'name': g[1], 'sub': g[2]} for g in cfg['groups']], 'pending': pending, 'chapters': chapters},
              open(os.path.join(out, 'book.json'), 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
    print(bid, ':', len(chapters), 'chapitres,', sum(len(c['pages']) for c in chapters), 'pages,',
          sum(p['w'] for c in chapters for p in c['pages']), 'mots ;', len(pending), 'en attente')


if __name__ == '__main__':
    main()
