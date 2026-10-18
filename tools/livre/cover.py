#!/usr/bin/env python3
"""Première de couverture d'un manuel → livre/<id>/cover.webp (vignette de la Bibliothèque).

Usage :  python tools/livre/cover.py <id> <chemin.pdf> [page]      (page 1 par défaut)
"""
import os, sys
import pymupdf
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
W = 480


def main():
    bid, pdf = sys.argv[1], sys.argv[2]
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    p = pymupdf.open(pdf)[n - 1]
    z = W / p.rect.width
    pix = p.get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=False)
    out = os.path.join(ROOT, 'livre', bid, 'cover.webp')
    Image.frombytes('RGB', (pix.width, pix.height), pix.samples).save(out, 'WEBP', quality=82, method=5)
    print(bid, out, pix.width, 'x', pix.height)


if __name__ == '__main__':
    main()
