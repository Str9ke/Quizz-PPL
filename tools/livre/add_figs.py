#!/usr/bin/env python3
"""Fusionne livre/<id>/figs.json (voir extract_figs.py) dans livre/<id>/book.json.

Usage :  python3 tools/livre/add_figs.py phak|afh

- Un bloc  {"fig": "Figure 5-3. légende…"}  reçoit ses images : {"fig": …, "imgs": [{f,w,h}]}.
  Le rattachement se fait par NUMÉRO de figure sur tout le livre (la traduction place parfois la
  figure sur la page voisine de celle du PDF).
- Une figure du livre ABSENTE de la traduction (traduction condensée) est ajoutée comme nouveau
  bloc, juste après le paragraphe qui la cite (« [Figure 1-4] »), sinon à sa hauteur dans la page.
- Idempotent : on peut le relancer après build_phak.py (qui régénère book.json depuis tr/*.txt).
"""
import collections, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NUM = r'(?:[A-Z]-\d+|\d+-\d+)'


def plain(h): return re.sub(r'<[^>]+>', ' ', h or '')


def block_words(b):
    if 'ul' in b or 'ol' in b: return sum(len(plain(x).split()) for x in (b.get('ul') or b.get('ol')))
    for k in ('h', 'h3', 'p'):
        if k in b: return len(plain(b[k]).split()) or 1
    return 6  # figure


def block_text(b):
    if 'ul' in b or 'ol' in b: return ' '.join(plain(x) for x in (b.get('ul') or b.get('ol')))
    return plain(b.get('h') or b.get('h3') or b.get('p') or '')


def main():
    book = sys.argv[1]
    bpath = os.path.join(ROOT, 'livre', book, 'book.json')
    bk = json.load(open(bpath, encoding='utf-8'))
    fg = json.load(open(os.path.join(ROOT, 'livre', book, 'figs.json'), encoding='utf-8'))
    pages = {}
    for c in bk['chapters']:
        for p in c['pages']:
            pages[p['pdf']] = p
            p['blocks'] = [b for b in p['blocks'] if not b.get('extra')]      # idempotence
            for b in p['blocks']: b.pop('imgs', None); b.pop('same', None)

    groups = {}                                    # (pdf, i) -> groupe
    bynum = collections.defaultdict(list)
    for pdf, gs in fg.items():
        for i, g in enumerate(gs):
            groups[(int(pdf), i)] = g
            for n in (g['no'] or '').split(','):
                if n: bynum[n].append((int(pdf), i))

    used, matched, unmatched = set(), 0, []
    for pdf, p in pages.items():
        for b in p['blocks']:
            if 'fig' not in b: continue
            m = re.match(r'\s*Figure\s+(' + NUM + r')', plain(b['fig']))
            n = m.group(1) if m else None
            cands = [k for k in bynum.get(n, []) if k not in used]
            if cands:
                k = min(cands, key=lambda x: abs(x[0] - pdf)); used.add(k)
                b['imgs'] = groups[k]['imgs']; matched += 1
            elif n and bynum.get(n):       # même image que celle d'une autre légende (figure à deux numéros)
                b['same'] = 1; matched += 1
            else: unmatched.append((pdf, b))
    # légendes sans numéro concordant (coquille du PDF, « 13-5A », « Figures 12-13 et 12-14 », figure à
    # sous-parties…) : on les associe, PAGE par PAGE, aux figures restantes de la même page du PDF
    bypage = collections.defaultdict(list)
    for pdf, b in unmatched: bypage[pdf].append(b)
    still = []
    for pdf, blocks in bypage.items():
        cands = sorted((k for k in groups if k[0] == pdf and k not in used), key=lambda k: k[1])
        if not cands: still += [(pdf, b) for b in blocks]; continue
        if len(blocks) == 1:                       # une légende pour toutes les figures restantes de la page
            blocks[0]['imgs'] = [im for k in cands for im in groups[k]['imgs']]; used.update(cands); matched += 1
        elif len(blocks) == len(cands):            # autant de légendes que de figures : dans l'ordre
            for b, k in zip(blocks, cands): b['imgs'] = groups[k]['imgs']; used.add(k); matched += 1
        else: still += [(pdf, b) for b in blocks]
    unmatched = still

    # figures du livre absentes de la traduction
    extra = collections.defaultdict(list)
    for k, g in groups.items():
        if k in used: continue
        if k[0] not in pages: print('! page PDF', k[0], 'absente du livre : figure ignorée', g['no']); continue
        extra[k[0]].append((k, g))
    added = 0
    for pdf, lst in extra.items():
        p = pages[pdf]
        for k, g in sorted(lst, key=lambda kg: -kg[1].get('y', 0)):       # du bas vers le haut : les indices restent valides
            nums = [n for n in (g['no'] or '').split(',') if n]
            at = None
            for n in nums:       # paragraphe qui cite la figure
                for i, b in enumerate(p['blocks']):
                    if 'fig' in b: continue
                    if re.search(r'Figure\s+' + re.escape(n) + r'(?!\d)', block_text(b), re.I): at = i + 1; break
                if at is not None: break
            if at is None:       # sinon : à la hauteur de la figure dans la page, au prorata du texte
                tot = sum(block_words(b) for b in p['blocks']) or 1
                acc, at = 0, len(p['blocks'])
                for i, b in enumerate(p['blocks']):
                    if acc / tot >= g.get('y', 0): at = i; break
                    acc += block_words(b)
            cap = ('Figure ' + ', '.join(nums)) if nums else ''
            p['blocks'].insert(at, {'fig': cap, 'imgs': g['imgs'], 'extra': 1}); added += 1

    json.dump(bk, open(bpath, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    tot_imgs = sum(len(b.get('imgs', [])) for c in bk['chapters'] for p in c['pages'] for b in p['blocks'])
    print(book, 'rattachées:', matched, '· ajoutées (absentes de la traduction):', added,
          '· légendes sans image:', [(q, re.sub('<[^>]+>', '', b['fig'])[:30]) for q, b in unmatched],
          '· images au total:', tot_imgs, '/', sum(len(g['imgs']) for g in groups.values()))


if __name__ == '__main__':
    main()
