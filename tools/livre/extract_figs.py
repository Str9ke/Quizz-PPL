#!/usr/bin/env python3
"""Découpe chaque figure des manuels (PDF) et la rattache à la traduction.

Usage :  python3 tools/livre/extract_figs.py phak|afh <chemin.pdf> [--dry]

Pour chaque page du PDF : détecte les zones « figure » (images bitmap + dessins vectoriels avec
leurs étiquettes), les recadre en WebP dans livre/<id>/fig/, puis écrit livre/<id>/figs.json :
    { "<pdf>": [ { "no": "5-3" | null, "imgs": [ {"f": "098_1.webp", "w": 1200, "h": 700} ] } ] }
`tools/livre/add_figs.py` fusionne ensuite ce fichier dans book.json. Le texte DES IMAGES n'est
pas traduit : on garde les figures telles qu'elles sont dans le livre.
"""
import json, os, re, sys
import pymupdf
from PIL import Image

pymupdf.TOOLS.mupdf_display_errors(False)
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MAXW, Q = 1600, 80
NUM = r'(?:[A-Z]-\d+|\d+-\d+)'
# Légende : « Figure 5-3. », « Figure 1. », « Figure 8 Reason’s… », « Table 2: », « Table 4 (below) »…
# mais PAS une référence dans le texte (« Figure 3 above is… », « Figure 10 shows… »).
CAP_RE = re.compile(r'^\s*(Figure|Table)\s+(?:(' + NUM + r')\.|(\d+)(?=\s*[.:,\u2013(]|\s*$|\s+[A-Z\u2018\u2019]))')


def inter(a, b, pad=0):
    return not (a[2] + pad < b[0] or b[2] + pad < a[0] or a[3] + pad < b[1] or b[3] + pad < a[1])


def union(a, b): return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]
def area(r): return max(0, r[2] - r[0]) * max(0, r[3] - r[1])


def inside_frac(a, b):
    """part de a contenue dans b"""
    w = min(a[2], b[2]) - max(a[0], b[0]); h = min(a[3], b[3]) - max(a[1], b[1])
    return (w * h) / area(a) if w > 0 and h > 0 and area(a) > 0 else 0


def find_regions(page, gap=6):
    W, H = page.rect.width, page.rect.height
    imgs, boxes = [], []
    for im in page.get_image_info():
        b = list(im['bbox'])
        vis = [max(b[0], 0), max(b[1], 0), min(b[2], W), min(b[3], H)]   # partie visible dans la page
        if area(vis) > 0.8 * W * H and b[0] < 5 and b[2] > W - 5: return []   # page d'ouverture : visuel plein fond
        b = vis
        if b[2] - b[0] < 3 or b[3] - b[1] < 3: continue
        imgs.append(b); boxes.append(b)
    for c in page.cluster_drawings():
        b = list(c)
        if b[2] - b[0] < 3 or b[3] - b[1] < 3: continue       # filets
        if b[1] < 40 or (b[3] > H - 30 and b[3] - b[1] < 30): continue   # en-tête / pied de page
        boxes.append(b)
    changed = True
    while changed:
        changed = False; out = []
        for b in boxes:
            for i, o in enumerate(out):
                if inter(b, o, gap): out[i] = union(o, b); changed = True; break
            else: out.append(b)
        boxes = out
    words = page.get_text('words')
    res = []
    for r in boxes:
        if area(r) < 20 * 20: continue
        has_img = any(inside_frac(i, r) > 0.5 for i in imgs)
        # étiquettes coupées au bord : on étend aux mots qui chevauchent la zone
        for w in words:
            wb = list(w[:4])
            if inter(wb, r) and inside_frac(wb, r) < 1: r = union(r, wb)
        nw = sum(1 for w in words if inside_frac(list(w[:4]), r) > 0.6)
        dense = not has_img and nw > 30    # encadré de texte : gardé seulement s'il porte une légende « Figure »
        if not has_img and area(r) < 40 * 40: continue
        r = [max(r[0], 0), max(r[1], 0), min(r[2], W), min(r[3], H)]   # reste dans la page
        if r[2] - r[0] < 8 or r[3] - r[1] < 8: continue
        res.append({'box': r, 'dense': dense})
    return res


def captions(page):
    """légendes « Figure N-M. … » : une par LIGNE (deux colonnes peuvent partager un bloc)"""
    out = []
    for b in page.get_text('dict')['blocks']:
        if b['type'] != 0: continue
        for l in b['lines']:
            t = ''.join(s['text'] for s in l['spans'])
            m = CAP_RE.match(t)
            if m:
                no = m.group(2) or m.group(3)
                out.append((('T' + no) if m.group(1) == 'Table' else no, list(l['bbox'])))
    return out


def xover(a, b):
    return min(a[2], b[2]) - max(a[0], b[0])


def group(regions, caps):
    """regroupe les zones par légende : [{no, boxes:[...]}] dans l'ordre de lecture"""
    groups = []
    for r in regions: groups.append({'no': None, 'boxes': [r['box']], 'dense': r['dense']})
    best = {}
    for no, cb in caps:
        cand = []
        for gi, g in enumerate(groups):
            r = g['boxes'][0]
            if xover(r, cb) <= 0 and not (cb[0] >= r[0] - 20 and cb[2] <= r[2] + 20): continue
            d = cb[1] - r[3] if cb[1] >= r[1] else r[1] - cb[3]
            if cb[1] >= r[1] and cb[1] < r[3] - 5: d = 0
            if d > -5 and d < 90: cand.append((abs(d), gi))
        if cand:
            gi = min(cand)[1]
            if groups[gi]['no'] is None: groups[gi]['no'] = no
            else: groups[gi]['no'] += ',' + no
    groups = [g for g in groups if not g['dense'] or g['no']]
    # zones sans légende, voisines (même colonne, < 70 pt) d'une zone légendée : même figure
    for g in [g for g in groups if g['no'] is None]:
        r = g['boxes'][0]; near = []
        for h in groups:
            if h is g or h['no'] is None: continue
            for hb in h['boxes']:
                if xover(r, hb) > 0 and min(abs(r[1] - hb[3]), abs(hb[1] - r[3])) < 70: near.append((min(abs(r[1] - hb[3]), abs(hb[1] - r[3])), h))
        if near:
            h = min(near, key=lambda x: x[0])[1]; h['boxes'].append(r); g['boxes'] = []
    groups = [g for g in groups if g['boxes']]
    # ordre de lecture : colonne (gauche/droite) puis haut en bas ; pleine largeur d'abord
    return groups


def trim_captions(box, caps):
    """rogne le cadre pour qu'il n'englobe pas la ligne de légende (en bas ou en haut)"""
    b = list(box); h = b[3] - b[1]
    for _, cb in caps:
        if min(b[2], cb[2]) - max(b[0], cb[0]) <= 0: continue
        if cb[1] > b[1] + 0.7 * h and cb[1] < b[3] + 2: b[3] = min(b[3], cb[1] - 1)
        elif cb[3] < b[1] + 0.3 * h and cb[3] > b[1] - 2: b[1] = max(b[1], cb[3] + 1)
    return b if b[3] - b[1] > 8 else box


def render(page, box, out, pad=4, caps=()):
    box = trim_captions(box, caps)
    r = pymupdf.Rect(*box) + (-pad, -pad, pad, pad)
    for _, cb in caps:        # le remplissage ne doit pas non plus mordre sur la légende
        if min(box[2], cb[2]) - max(box[0], cb[0]) > 0:
            if cb[1] >= box[3] - 0.5: r.y1 = min(r.y1, cb[1] - 0.5)
            elif cb[3] <= box[1] + 0.5: r.y0 = max(r.y0, cb[3] + 0.5)
    r &= page.rect
    # Une ligne de texte courant qui frôle la figure (au-dessus ou au-dessous) ne doit pas être
    # rognée à moitié dans l'image : on recule le bord jusqu'à elle.
    for blk in page.get_text('dict')['blocks']:
        if blk.get('type') != 0: continue
        for l in blk['lines']:
            lb = l['bbox']
            if lb[2] < r.x0 or lb[0] > r.x1 or lb[3] < r.y0 or lb[1] > r.y1: continue
            cy = (lb[1] + lb[3]) / 2
            if cy < box[1] and lb[3] > r.y0: r.y0 = min(max(r.y0, lb[3] + .3), box[1])
            elif cy > box[3] and lb[1] < r.y1: r.y1 = max(min(r.y1, lb[1] - .3), box[3])
    z = min(MAXW / r.width, 4.0)
    z = max(z, 2.0) if r.width * 2.0 <= MAXW else z
    pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z), clip=r, alpha=False)
    im = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
    im.save(out, 'WEBP', quality=Q, method=5)
    return pix.width, pix.height


def main():
    """extract_figs.py <id> <pdf> [--pages a-b] [--dump] [--tr] [--dry]
    --pages a-b : pages du PDF à traiter (sinon : celles de livre/<id>/book.json)
    --dump      : écrit tools/livre/<id>/figtext.json (textes des figures, à traduire)
    --tr        : applique tools/livre/<id>/figtr.json (figures et tableaux traduits en place)
    Les figures listées dans tools/livre/<id>/config.json (« skip » : ["PPP_N", …]) sont écartées
    (visuels décoratifs, bandeaux de chapitre) ; « manual » : {"PPP": [[x0, y0, x1, y1, "n°"], …]}
    remplace la détection d'une page par des cadres en points PDF (tableaux sur plusieurs pages…)."""
    import figtrans
    book, pdf = sys.argv[1], sys.argv[2]
    dry = '--dry' in sys.argv
    dump = '--dump' in sys.argv
    d = pymupdf.open(pdf)
    if '--pages' in sys.argv:
        a_, b_ = sys.argv[sys.argv.index('--pages') + 1].split('-')
        pdfs = list(range(int(a_), int(b_) + 1))
    else:
        bk = json.load(open(os.path.join(ROOT, 'livre', book, 'book.json'), encoding='utf-8'))
        pdfs = sorted({p['pdf'] for c in bk['chapters'] for p in c['pages']})
    tdir = os.path.join(ROOT, 'tools', 'livre', book)
    cfg = {}
    if os.path.exists(os.path.join(tdir, 'config.json')):
        cfg = json.load(open(os.path.join(tdir, 'config.json'), encoding='utf-8'))
    skip = set(cfg.get('skip', []))
    manual = cfg.get('manual', {})  # {"PPP": [[x0, y0, x1, y1, "n° ou null"], …]}
    mapping = None
    if '--tr' in sys.argv:
        mapping = json.load(open(os.path.join(tdir, 'figtr.json'), encoding='utf-8'))
    outdir = os.path.join(ROOT, 'livre', book, 'fig')
    if not dry and not dump: os.makedirs(outdir, exist_ok=True)
    result = {}; nfig = nimg = 0; texts = {}; missing = set(); ntr = 0
    for pn in pdfs:
        if pn > len(d): continue
        page = d[pn - 1]
        caps = captions(page)
        gs = group(find_regions(page), caps)
        gs.sort(key=lambda g: (g['boxes'][0][1] > page.rect.height * 0.0, g['boxes'][0][0] > page.rect.width * 0.5 and (g['boxes'][0][2] - g['boxes'][0][0]) < page.rect.width * 0.6, g['boxes'][0][1]))
        gs = [g for gi, g in enumerate(gs) if '%03d_%d' % (pn, gi + 1) not in skip]
        if str(pn) in manual:  # cadres donnés à la main (points PDF) : remplacent la détection de la page
            gs = [{'no': m[4], 'boxes': [list(m[:4])]} for m in manual[str(pn)]]
        boxes = [b for g in gs for b in g['boxes']]
        if dump:
            for blk in figtrans.blocks(page, boxes):
                texts.setdefault(blk['key'], 'p%d' % pn)
            continue
        if mapping is not None and boxes:
            n, miss = figtrans.apply(page, boxes, mapping); ntr += n; missing.update(miss)
        items = []
        for gi, g in enumerate(gs):
            g['boxes'].sort(key=lambda b: b[1])
            imgs = []
            for bi, b in enumerate(g['boxes']):
                name = '%03d_%d%s.webp' % (pn, gi + 1, '' if len(g['boxes']) == 1 else chr(97 + bi))
                if dry: w = h = 0
                else: w, h = render(page, b, os.path.join(outdir, name), caps=caps)
                imgs.append({'f': name, 'w': w, 'h': h}); nimg += 1
            items.append({'no': g['no'], 'y': round(g['boxes'][0][1] / page.rect.height, 3), 'imgs': imgs}); nfig += 1
        if items: result[str(pn)] = items
    if dump:
        path = os.path.join(tdir, 'figtext.json')
        old = json.load(open(os.path.join(tdir, 'figtr.json'), encoding='utf-8')) if os.path.exists(os.path.join(tdir, 'figtr.json')) else {}
        todo = {k: v for k, v in texts.items() if k not in old}
        json.dump(todo, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
        print(book, ':', len(texts), 'textes de figures,', len(todo), 'à traduire ->', path)
        return
    if not dry:
        json.dump(result, open(os.path.join(ROOT, 'livre', book, 'figs.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print(book, 'pages avec figures:', len(result), 'figures:', nfig, 'images:', nimg,
          ('· textes traduits : %d · sans traduction : %d' % (ntr, len(missing))) if mapping is not None else '')
    if missing:
        print('  sans traduction :', ' | '.join(sorted(missing))[:2000])


if __name__ == '__main__':
    main()
