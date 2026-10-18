#!/usr/bin/env python3
"""Rend les pages originales d'un manuel en WebP 1600 px : livre/<id>/img/NNN.webp.

Usage :  python tools/livre/render.py <id> <chemin.pdf> [première] [dernière]
(images lues en ligne par le lecteur, non embarquées dans l'APK — voir tools/build_www.py)
"""
import os, sys
import pymupdf
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
W, Q = 1600, 78


def main():
    bid, pdf = sys.argv[1], sys.argv[2]
    d = pymupdf.open(pdf)
    first = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    last = int(sys.argv[4]) if len(sys.argv) > 4 else len(d)
    out = os.path.join(ROOT, 'livre', bid, 'img'); os.makedirs(out, exist_ok=True)
    tot = 0
    for n in range(first, last + 1):
        dst = os.path.join(out, '%03d.webp' % n)
        if os.path.exists(dst): continue
        p = d[n - 1]; z = W / p.rect.width
        pix = p.get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=False)
        Image.frombytes('RGB', (pix.width, pix.height), pix.samples).save(dst, 'WEBP', quality=Q, method=5)
        tot += os.path.getsize(dst)
    print(bid, last - first + 1, 'pages,', tot // 1048576, 'Mo')


if __name__ == '__main__':
    main()
