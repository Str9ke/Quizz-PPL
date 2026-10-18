#!/usr/bin/env python3
"""Traduction des textes DANS les figures et tableaux, en gardant exactement leur forme.

Les schémas et tableaux de ces manuels sont vectoriels : leurs textes sont de vrais textes PDF.
On les remplace à l'endroit exact, dans la même couleur, la même taille (réduite seulement si le
français ne tient pas) et la même graisse ; les cadres, fonds colorés, flèches et images restent
intacts, puisque seul le texte est effacé (caviardage « texte seulement »).

- blocks(page, boxes) : blocs de texte situés dans les zones de figure ;
- apply(page, boxes, mapping) : efface et réécrit en français ceux qui ont une traduction ;
mapping = { texte anglais normalisé : texte français } (tools/livre/<id>/figtr.json).
Un bloc sans lettre (nombres, valeurs) ou sans traduction est laissé tel quel.
"""
import html
import re

import pymupdf


def norm(t):
    t = t.replace('­', '').replace('‐', '-')
    t = re.sub(r'-\s+(?=[a-z])', '', t)          # césure en fin de ligne
    return re.sub(r'\s+', ' ', t).strip()


def _inside(a, b, frac=0.6):
    w = min(a[2], b[2]) - max(a[0], b[0]); h = min(a[3], b[3]) - max(a[1], b[1])
    ar = (a[2] - a[0]) * (a[3] - a[1])
    return w > 0 and h > 0 and ar > 0 and (w * h) / ar >= frac


def _style(sp):
    return {
        'size': round(sp['size'], 2), 'color': sp['color'],
        'bold': bool(sp['flags'] & 16) or 'Bold' in sp['font'] or 'Black' in sp['font'] or 'Heavy' in sp['font'],
        'italic': bool(sp['flags'] & 2) or 'Italic' in sp['font'] or 'Oblique' in sp['font'],
        'serif': any(k in sp['font'] for k in ('Times', 'Serif', 'Garamond', 'Minion', 'Georgia')),
    }


def _segments(page, boxes):
    """Morceaux de ligne : spans contigus d'une même ligne (un grand blanc = deux cases)."""
    segs = []
    for b in page.get_text('dict', flags=pymupdf.TEXTFLAGS_TEXT)['blocks']:
        if b.get('type') != 0: continue
        for l in b['lines']:
            cur = None
            ldir = tuple(round(v) for v in l.get('dir', (1, 0)))
            for sp in l['spans']:
                if not sp['text'].strip():
                    continue
                bb = list(sp['bbox'])
                lead_sp = len(sp['text']) - len(sp['text'].lstrip(' '))
                if lead_sp:      # espaces de tête : la boîte du span commence avant le texte visible
                    bb[0] += lead_sp * sp['size'] * .278
                    sp = dict(sp, text=sp['text'].lstrip(' '))
                if cur and bb[0] - cur['bbox'][2] < max(2.5, sp['size'] * .9):
                    touching = bb[0] - cur['bbox'][2] < sp['size'] * .12      # ligature (« fi ») ou changement de style
                    cur['text'] += ('' if touching or cur['text'].endswith(' ') or sp['text'].startswith(' ') else ' ') + sp['text']
                    cur['bbox'] = [min(cur['bbox'][0], bb[0]), min(cur['bbox'][1], bb[1]), max(cur['bbox'][2], bb[2]), max(cur['bbox'][3], bb[3])]
                    if len(sp['text']) > len(cur['main']['text']): cur['main'] = sp
                else:
                    cur = {'text': sp['text'], 'bbox': bb, 'main': sp, 'first': sp, 'dir': ldir}
                    segs.append(cur)
    return [g for g in segs if any(_inside(g['bbox'], box) for box in boxes)]


def blocks(page, boxes):
    """Paragraphes de texte dans les zones `boxes` (une case de tableau = un paragraphe)."""
    cells = _cells(page)
    segs = sorted(_segments(page, boxes), key=lambda g: (round(g['bbox'][1], 1), g['bbox'][0]))
    paras = []
    for g in segs:
        st = _style(g['main']); bb = g['bbox']; cell = _cell_for(bb, cells)
        # Lettre initiale mise en valeur (couleur ou taille différente : acronymes PAVE, I'M SAFE…)
        f = g['first']; lead = None
        if f is not g['main'] and len(f['text'].strip()) <= 2 and (f['color'] != g['main']['color'] or f['size'] > g['main']['size'] * 1.15):
            lead = {'t': f['text'].strip(), 'color': f['color'], 'size': round(f['size'], 2),
                    'bold': bool(f['flags'] & 16) or 'Bold' in f['font']}
        for pa in reversed(paras[-6:]):
            pb = pa['bbox']; gap = bb[1] - pb[3]
            same_cell = (pa['cell'] == cell)
            aligned = abs(bb[0] - pa['lines'][-1][0]) < 3 or abs((bb[0] + bb[2]) / 2 - (pa['lines'][-1][0] + pa['lines'][-1][2]) / 2) < 3
            if pa['dir'] == g['dir'] == (1, 0) and same_cell and aligned and -1 < gap < st['size'] * .75 and abs(st['size'] - pa['size']) < .6 and st['color'] == pa['color']:
                pa['text'] += ' ' + g['text']
                pa['bbox'] = [min(pb[0], bb[0]), pb[1], max(pb[2], bb[2]), bb[3]]
                pa['lines'].append(bb); pa['leads'].append(lead)
                break
        else:
            pa = dict(st, text=g['text'], bbox=bb, lines=[bb], cell=cell, leads=[lead], dir=g['dir'])
            paras.append(pa)
    out = []
    for pa in paras:
        text = norm(pa['text'])
        if not re.search(r'[A-Za-z]{2}', text): continue
        pa['key'] = text
        out.append(pa)
    return out


def _cells(page):
    """Rectangles dessinés (cases de tableau, cadres colorés) de la page."""
    rects = []
    for dr in page.get_drawings():
        r = dr.get('rect')
        if r is not None and r.width > 6 and r.height > 4:
            rects.append([r.x0, r.y0, r.x1, r.y1])
    return rects


_VLINES = {}


def _vlines(page):
    """Traits verticaux (séparations de colonnes), mis en cache par page."""
    key = (id(page.parent), page.number)
    if key in _VLINES: return _VLINES[key]
    out = []
    for dr in page.get_drawings():
        for it in dr['items']:
            if it[0] == 'l' and abs(it[1].x - it[2].x) < .8 and abs(it[1].y - it[2].y) > 5:
                out.append((it[1].x, min(it[1].y, it[2].y), max(it[1].y, it[2].y)))
            elif it[0] == 're' and it[1].width < 1.6 and it[1].height > 5:
                out.append(((it[1].x0 + it[1].x1) / 2, it[1].y0, it[1].y1))
    _VLINES[key] = out
    return out


def _right_limit(page, bb):
    """Premier trait vertical à droite du texte qui traverse sa hauteur."""
    xs = [x for x, y0, y1 in _vlines(page) if x > bb[2] - .5 and y0 <= bb[1] + 1 and y1 >= bb[3] - 1]
    return min(xs) if xs else None


_FILLS = {}


def _fills(page):
    key = (id(page.parent), page.number)
    if key not in _FILLS:
        _FILLS[key] = [[d['rect'].x0, d['rect'].y0, d['rect'].x1, d['rect'].y1] for d in page.get_drawings()
                       if d.get('fill') is not None and d['rect'].width > 30 and d['rect'].height > 20]
    return _FILLS[key]


def _overlap(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0]); h = min(a[3], b[3]) - max(a[1], b[1])
    ar = (b[2] - b[0]) * (b[3] - b[1])
    return (w * h) / ar if w > 0 and h > 0 and ar > 0 else 0


def _cell_for(bb, cells, loose=False):
    best = None
    for c in cells:
        tv = (bb[3] - bb[1]) * .3 if loose else .5   # loose : la boîte du texte déborde (jambages) d'une case serrée
        if c[0] - .5 <= bb[0] and c[1] - tv <= bb[1] and c[2] + .5 >= bb[2] and c[3] + tv >= bb[3]:
            if best is None or (c[2] - c[0]) * (c[3] - c[1]) < (best[2] - best[0]) * (best[3] - best[1]):
                best = c
    return best


def apply(page, boxes, mapping):
    """Remplace les textes traduits des zones `boxes`. Renvoie (traduits, non traduits)."""
    todo, missing = [], []
    for blk in blocks(page, boxes):
        fr = mapping.get(blk['key'])
        if fr and fr.strip() and fr != blk['key']: todo.append((blk, fr))
        elif not fr: missing.append(blk['key'])
    if not todo: return 0, missing
    cells = _cells(page)
    for blk, _ in todo:
        page.add_redact_annot(pymupdf.Rect(blk['bbox']), fill=False)
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                          graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                          text=pymupdf.PDF_REDACT_TEXT_REMOVE)
    for blk, fr in todo:
        bb = blk['bbox']
        cell = blk.get('cell')
        if len(blk['lines']) == 1:
            # étiquette dans une case serrée (dont la boîte du texte dépasse un peu) : la retrouver
            snug = _cell_for(bb, cells, loose=True)
            if snug is not None and (cell is None or (snug[2] - snug[0]) * (snug[3] - snug[1]) < (cell[2] - cell[0]) * (cell[3] - cell[1])):
                cell = snug
        mids = [(l[0] + l[2]) / 2 for l in blk['lines']]
        centered = False
        lefts =[l[0] for l in blk['lines']]
        if cell is not None and cell[2] - cell[0] < 400:
            centered = abs((bb[0] + bb[2]) / 2 - (cell[0] + cell[2]) / 2) < 3 and (bb[2] - bb[0]) < (cell[2] - cell[0]) * .9
            if len(lefts) >= 2 and max(lefts) - min(lefts) < 1.5: centered = False
        if not centered and len(mids) > 1 and max(mids) - min(mids) < 2 and max(lefts) - min(lefts) > 1.5 and (bb[2] - bb[0]) > 8:
            centered = True
        # Place disponible : la case qui contient le texte (sans déborder), sinon la zone du bloc
        # élargie vers la droite (le français est en moyenne 15 à 20 % plus long que l'anglais).
        if cell is not None:
            x0, x1 = cell[0] + 1.2, cell[2] - 1.2
            y0, y1 = max(cell[1] + .5, bb[1] - 1.5), min(cell[3] - .5, bb[3] + max(2, (bb[3] - bb[1]) * .6))
            if not centered:
                x0 = max(x0, bb[0] - .5)
        else:
            w = bb[2] - bb[0]
            multi = len(blk['lines']) > 1
            x0, x1 = bb[0] - .5, bb[2] + (1 if multi else w * .25)
            y0, y1 = bb[1] - 1, bb[3] + max(2, (bb[3] - bb[1]) * (.35 if multi else .5))
            if centered: x0, x1 = bb[0] - w * .12, bb[2] + w * .12
        lim = _right_limit(page, bb)
        if lim is not None and lim < x1: x1 = lim - 1.2
        # Cartes dessinées PAR-DESSUS la zone (ex. planche PAVE) : le texte d'origine s'arrêtait
        # à leur bord ; le français, écrit en dernier, passerait dessus → on s'arrête aussi.
        for ob in _fills(page):
            if ob[0] > bb[0] + 10 and ob[1] < y1 and ob[3] > y0 and ob[0] < x1 and _overlap(ob, bb) < .02:
                x1 = min(x1, ob[0] - 2)
            if ob[1] > bb[1] + 4 and ob[0] < x1 and ob[2] > x0 and ob[1] < y1 and _overlap(ob, bb) < .02:
                y1 = min(y1, ob[1] - 1)
        rgb = blk['color']
        css = ('* {font-family: %s; font-size: %.2fpx; color: #%06x; font-weight: %s; font-style: %s; '
               'text-align: %s; line-height: 1.12; margin: 0; padding: 0}') % (
            'serif' if blk['serif'] else 'sans-serif', blk['size'], rgb,
            'bold' if blk['bold'] else 'normal', 'italic' if blk['italic'] else 'normal',
            'center' if centered else 'left')
        leads = blk.get('leads') or []

        def line_html(i, txt):
            ld = leads[i] if i < len(leads) else None
            if ld and txt.startswith(ld['t']):
                return ('<span style="color:#%06x;font-size:%.2fpx;font-weight:%s">%s</span>' % (
                    ld['color'], ld['size'], 'bold' if ld['bold'] else 'inherit', html.escape(ld['t']))) + html.escape(txt[len(ld['t']):])
            return html.escape(txt)
        body = line_html(0, fr)
        if '\n' in fr:
            # Retours à la ligne voulus (colonne de libellés alignés sur les lignes du tableau) :
            # même interligne que l'original, pour que chaque libellé reste en face de sa ligne.
            parts = fr.split('\n')
            body = '<br>'.join(line_html(i, x) for i, x in enumerate(parts))
            ls = blk['lines']
            if len(ls) > 1:
                pitch = (ls[-1][1] - ls[0][1]) / (len(ls) - 1)
                css = css.replace('line-height: 1.12', 'line-height: %.2fpx' % max(pitch, blk['size']))
                y1 = max(y1, y0 + pitch * len(parts) + 2)
        ls = blk['lines']
        if '\n' in fr and len(fr.split('\n')) == len(ls) and blk.get('dir', (1, 0)) == (1, 0):
            for i, (txt, lb) in enumerate(zip(fr.split('\n'), ls)):
                lw = lb[2] - lb[0]
                if cell is not None:
                    lx0, lx1 = (cell[0] + 1.2, cell[2] - 1.2) if centered else (lb[0] - .5, cell[2] - 1.2)
                elif centered:
                    lx0, lx1 = lb[0] - lw * .25 - 2, lb[2] + lw * .25 + 2
                else:
                    lx0, lx1 = lb[0] - .5, lb[2] + max(lw * .3, 12)
                llim = _right_limit(page, lb)
                if llim is not None and llim < lx1: lx1 = llim - 1.2
                page.insert_htmlbox(pymupdf.Rect(lx0, lb[1] - 1, lx1, lb[3] + 2), line_html(i, txt),
                                    css=css.replace('line-height: 1.12', 'line-height: 1'), scale_low=0.35)
            continue
        d = blk.get('dir', (1, 0))
        if d != (1, 0):
            # Texte vertical : même boîte que l'original, écrit dans le même sens
            rot = {(0, -1): 90, (-1, 0): 180, (0, 1): 270}.get(d, 0)
            css = css.replace('text-align: left', 'text-align: center')
            page.insert_htmlbox(pymupdf.Rect(bb[0] - 1, bb[1] - (bb[3] - bb[1]) * .3, bb[2] + 1, bb[3] + (bb[3] - bb[1]) * .3),
                                body, css=css, scale_low=0.35, rotate=rot)
            continue
        page.insert_htmlbox(pymupdf.Rect(x0, y0, x1, y1), body, css=css, scale_low=0.35)
    return len(todo), missing
