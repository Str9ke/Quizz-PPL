#!/usr/bin/env python3
"""Repère le texte des figures MATRICIELLES d'un livre (OCR Windows intégré, voir winocr.ps1).

Usage :  python tools/livre/ocrfig.py <id> [fichier.webp …]
Écrit tools/livre/<id>/ocr.json : { "fichier.webp": [ {"b": [x0, y0, x1, y1], "t": "texte"} … ] }
(lignes OCR regroupées en étiquettes : lignes proches, alignées à gauche ou centrées).
On traduit ensuite ces étiquettes dans tools/livre/<id>/rastertr.py, qui produit raster.json
pour rasterfix.py. Les figures vectorielles (textes extraits par extract_figs --dump) sont ignorées.
"""
import json, os, subprocess, sys, tempfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UP = 2  # agrandissement avant OCR (petits caractères)


def group(lines):
    lines = sorted(lines, key=lambda l: (l['b'][1], l['b'][0]))
    blocks = []
    for l in lines:
        x0, y0, x1, y1 = l['b']; h = y1 - y0
        for bl in reversed(blocks):
            bx0, by0, bx1, by1 = bl['b']; last = bl['last']
            gap = y0 - last[3]
            lh = last[3] - last[1]
            aligned = abs(x0 - last[0]) < max(lh, 12) or abs((x0 + x1) / 2 - (last[0] + last[2]) / 2) < max(lh, 12)
            if -2 < gap < 0.9 * max(h, lh) and aligned and abs(h - lh) < 0.5 * max(h, lh):
                bl['t'] += '\n' + l['t']; bl['b'] = [min(bx0, x0), by0, max(bx1, x1), y1]; bl['last'] = l['b']
                break
        else:
            blocks.append({'t': l['t'], 'b': list(l['b']), 'last': l['b']})
    return [{'t': b['t'], 'b': b['b']} for b in blocks]


def main():
    bid = sys.argv[1]
    figdir = os.path.join(ROOT, 'livre', bid, 'fig')
    files = sys.argv[2:] or sorted(f for f in os.listdir(figdir) if f.endswith('.webp'))
    out_path = os.path.join(ROOT, 'tools', 'livre', bid, 'ocr.json')
    out = json.load(open(out_path, encoding='utf-8')) if os.path.exists(out_path) else {}
    tmp = tempfile.mkdtemp()
    pngs = []
    for f in files:
        im = Image.open(os.path.join(figdir, f)).convert('RGB')
        im = im.resize((im.width * UP, im.height * UP), Image.LANCZOS)
        p = os.path.join(tmp, f.replace('.webp', '.png')); im.save(p); pngs.append(p)
    for i in range(0, len(pngs), 10):
        r = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
                            os.path.join(ROOT, 'tools', 'livre', 'winocr.ps1')] + pngs[i:i + 10],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        data = json.loads(r.stdout[r.stdout.index("{"):], strict=False)
        for png, lines in data.items():
            if isinstance(lines, dict): lines = [lines]
            for l in lines: l['b'] = [round(v / UP) for v in l['b']]
            out[png.replace('.png', '.webp')] = group(lines)
    json.dump(out, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print(bid, ':', len(files), 'figures,', sum(len(out[f.replace('.png', '.webp')]) for f in [os.path.basename(p) for p in pngs]), 'étiquettes ->', out_path)


if __name__ == '__main__':
    main()
