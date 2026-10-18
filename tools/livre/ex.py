"""Texte d'une page de manuel, colonnes remises dans l'ordre de lecture (aide à la traduction).
Usage : python tools/livre/ex.py <chemin.pdf> <première> <dernière>
"""
import sys,re,fitz
d=None
def page_text(pn):
    p=d[pn-1]; W=p.rect.width; H=p.rect.height
    blocks=[b for b in p.get_text('dict')['blocks'] if b['type']==0]
    items=[]
    for b in blocks:
        x0,y0,x1,y1=b['bbox']
        lines=[]
        for l in b['lines']:
            out=''
            for s in l['spans']:
                t=s['text']
                if not t.strip(): out+=t; continue
                bold='Bold' in s['font'] and 'Helvetica' in s['font']
                ital='Italic' in s['font'] or 'Oblique' in s['font']
                big=s['size']>=11
                if bold or big: t='<<'+t.strip()+'>> '
                elif ital: t='_'+t.strip()+'_ '
                out+=t
            lines.append(out)
        txt=''
        for ln in lines:
            ln=ln.rstrip()
            if txt.endswith('-') and not txt.endswith(' -'): txt=txt[:-1]+ln.lstrip()
            else: txt+=(' ' if txt else '')+ln.strip()
        txt=re.sub(r'\s+',' ',txt).replace('<< ','<<').replace(' >>','>>').replace('>> <<',' ')
        if not txt.strip(): continue
        # ignorer numéro de page / en-tête
        if re.fullmatch(r'([A-Z]|\d{1,2})-\d{1,3}',txt.strip()) and y0>H-90: continue
        col=0 if x0<W*0.47 else 1
        if x1-x0>W*0.7: col=0   # pleine largeur
        items.append((col if (x1-x0)<=W*0.7 else -1,y0,x0,txt))
    full=[i for i in items if i[0]==-1]; cols=[i for i in items if i[0]!=-1]
    # ordre : pleine largeur haute avant colonnes, basse après
    cols.sort(key=lambda i:(i[0],i[1]))
    return [i[3] for i in sorted(full,key=lambda i:i[1]) if i[1]<200]+[i[3] for i in cols]+[i[3] for i in sorted(full,key=lambda i:i[1]) if i[1]>=200]
if __name__=='__main__':
    d=fitz.open(sys.argv[1])
    a,b=int(sys.argv[2]),int(sys.argv[3])
    for pn in range(a,b+1):
        print(f'\n=== PDF {pn}')
        for t in page_text(pn): print(t)
