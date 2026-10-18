#!/usr/bin/env python3
"""Traduction du texte des figures MATRICIELLES (texte inclus dans une image, non modifiable).

Usage :  python tools/livre/rasterfix.py <id>        (à lancer après extract_figs.py)

Lit tools/livre/<id>/raster.json :
  { "062_3.webp": [ {"box": [x0, y0, x1, y1], "t": "texte français",
                     "lead": ["P", "#1f6fb5"],      # optionnel : 1re lettre d'une autre couleur
                     "color": "#000000",            # optionnel : sinon couleur du texte d'origine
                     "bold": true, "angle": 0, "align": "center", "size": 30 } ] }
Coordonnées en pixels de l'image livre/<id>/fig/<fichier>. Pour chaque zone : le texte d'origine
est repéré (pixels éloignés de la couleur du fond), effacé par « inpainting » (le fond — même
dégradé — est reconstruit), puis le français est écrit à la même place, même couleur, même graisse.
"""
import json, os, sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONTS = {
    (False, False): ['C:/Windows/Fonts/arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
    (True, False): ['C:/Windows/Fonts/arialbd.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
    (False, True): ['C:/Windows/Fonts/ariali.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf'],
    (True, True): ['C:/Windows/Fonts/arialbi.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf'],
}


def font(bold, italic, size):
    for p in FONTS[(bool(bold), bool(italic))]:
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def hexrgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def text_mask(img, box, thr=60):
    """Pixels du texte d'origine dans `box` : éloignés de la couleur du fond (médiane du pourtour)."""
    x0, y0, x1, y1 = box
    roi = img[y0:y1, x0:x1].astype(np.int32)
    border = np.concatenate([roi[0], roi[-1], roi[:, 0], roi[:, -1]])
    bg = np.median(border, axis=0)
    dist = np.sqrt(((roi - bg) ** 2).sum(axis=2))
    m = (dist > thr).astype(np.uint8) * 255
    return m, bg


def apply(img_path, items):
    pil = Image.open(img_path).convert('RGB')
    arr = np.array(pil)
    full_mask = np.zeros(arr.shape[:2], np.uint8)
    colors = []
    for it in items:
        x0, y0, x1, y1 = it['box']
        m, bg = text_mask(arr, (x0, y0, x1, y1), it.get('thr', 60))
        if it.get('maxlum'):      # ne garder que le texte très sombre (épargne un cadre coloré voisin)
            roi = arr[y0:y1, x0:x1].astype(np.float32)
            lum = roi[..., 0] * .299 + roi[..., 1] * .587 + roi[..., 2] * .114
            m[lum >= it['maxlum']] = 0
        sel = arr[y0:y1, x0:x1][m > 0]
        colors.append(tuple(int(v) for v in (np.percentile(sel, 50, axis=0) if len(sel) else (0, 0, 0))))
        k = np.ones((3, 3), np.uint8)
        full_mask[y0:y1, x0:x1] |= cv2.dilate(m, k, iterations=it.get('grow', 2))
    bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    bgr = cv2.inpaint(bgr, full_mask, 6, cv2.INPAINT_TELEA)
    out = Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    for it, auto in zip(items, colors):
        x0, y0, x1, y1 = it['box']
        w, h = x1 - x0, y1 - y0
        ang = it.get('angle', 0)
        bw, bh = (w, h) if not ang else (it.get('len', w), it.get('thick', h))
        size = it.get('size') or int(bh * .78)
        col = hexrgb(it['color']) if it.get('color') else auto
        lead = it.get('lead')
        lines = it['t'].split('\n')
        fixed = bool(it.get('size'))       # taille imposée : on ne réduit pas, la zone s'élargit
        while size > 6 and not fixed:
            f = font(it.get('bold'), it.get('italic'), size)
            widths = [f.getlength(l) for l in lines]
            if max(widths) <= bw * .98 and size * 1.18 * len(lines) <= bh * 1.05 + (0 if len(lines) == 1 else size): break
            size -= 1
        f = font(it.get('bold'), it.get('italic'), size)
        lh = size * 1.18
        bw0 = bw
        if fixed: bw = max(bw, max(f.getlength(l) for l in lines) + 4)
        layer = Image.new('RGBA', (int(bw), int(max(bh, lh * len(lines)))), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        ytop = (layer.size[1] - lh * len(lines)) / 2
        for i, line in enumerate(lines):
            lw = f.getlength(line)
            al = it.get('align', 'center')
            x = 0 if al == 'left' else (bw - lw) if al == 'right' else (bw - lw) / 2
            y = ytop + i * lh
            pieces = [(line, col)]
            if lead and i == 0 and line.startswith(lead[0]):
                pieces = [(lead[0], hexrgb(lead[1])), (line[len(lead[0]):], col)]
            for sub, c in it.get('hl', []):          # lettre(s) d'une autre couleur au milieu du texte
                new = []
                for txt, cc in pieces:
                    k = txt.find(sub) if cc == col else -1
                    if k >= 0: new += [(txt[:k], cc), (sub, hexrgb(c)), (txt[k + len(sub):], cc)]
                    else: new.append((txt, cc))
                pieces = new
            fb = font(True, it.get('italic'), size) if (lead and len(lead) > 2 and lead[2]) else f
            for j, (txt, cc) in enumerate(pieces):
                ff = fb if (j == 0 and lead and i == 0 and txt == lead[0]) else f
                if txt: d.text((x, y), txt, font=ff, fill=cc); x += ff.getlength(txt)
        if ang:
            layer = layer.rotate(ang, expand=True, resample=Image.BICUBIC)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if bw > bw0 and it.get('align') == 'left':     # texte plus long : il part du même point de départ
            import math
            dx = (bw - bw0) / 2; a = math.radians(ang)
            cx += dx * math.cos(a); cy -= dx * math.sin(a)
        out.paste(layer, (int(cx - layer.size[0] / 2), int(cy - layer.size[1] / 2)), layer)
    out.save(img_path, 'WEBP', quality=80, method=5)


def main():
    bid = sys.argv[1]
    cfg = json.load(open(os.path.join(ROOT, 'tools', 'livre', bid, 'raster.json'), encoding='utf-8'))
    for name, items in cfg.items():
        if name.startswith('_'): continue
        p = os.path.join(ROOT, 'livre', bid, 'fig', name)
        if not os.path.exists(p): print('absent :', name); continue
        apply(p, items)
        print(name, ':', len(items), 'textes')


if __name__ == '__main__':
    main()
