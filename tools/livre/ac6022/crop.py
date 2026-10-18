"""Découpe des figures de l'AC 60-22 (PDF scanné : pas de figures détectables automatiquement).
Usage : python tools/livre/ac6022/crop.py Livres/ac_60-22.pdf   puis   python tools/livre/rasterfix.py ac6022"""
import json, os, sys
import pymupdf
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
# (page PDF, n° de figure, boîte en px d'une page rendue à 1000 px de large)
F = [(6, '1', (255, 575, 725, 1000)), (7, '2', (300, 500, 725, 995)), (15, '4', (120, 462, 475, 762)),
     (20, '5', (185, 175, 740, 475)), (22, '6', (132, 580, 860, 815)), (24, '7', (110, 345, 885, 512))]
d = pymupdf.open(sys.argv[1]); out = {}
os.makedirs(os.path.join(ROOT, 'livre', 'ac6022', 'fig'), exist_ok=True)
for pn, no, (x0, y0, x1, y1) in F:
    p = d[pn - 1]; k = p.rect.width / 1000
    r = pymupdf.Rect(x0 * k, y0 * k, x1 * k, y1 * k); z = min(1500 / r.width, 4)
    pix = p.get_pixmap(matrix=pymupdf.Matrix(z, z), clip=r, alpha=False)
    name = '%03d_1.webp' % pn
    Image.frombytes('RGB', (pix.width, pix.height), pix.samples).save(os.path.join(ROOT, 'livre', 'ac6022', 'fig', name), 'WEBP', quality=82)
    out[str(pn)] = [{'no': no, 'y': 0.5, 'imgs': [{'f': name, 'w': pix.width, 'h': pix.height}]}]
json.dump(out, open(os.path.join(ROOT, 'livre', 'ac6022', 'figs.json'), 'w'), indent=0)
print(len(F), 'figures')
