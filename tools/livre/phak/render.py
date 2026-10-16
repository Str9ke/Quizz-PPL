import sys,io,os,fitz
from PIL import Image
from multiprocessing import Pool
W,Q=1600,78
def job(a):
    pdf,pn,out=a
    if os.path.exists(out): return 0
    d=fitz.open(pdf); p=d[pn-1]; z=W/p.rect.width
    pix=p.get_pixmap(matrix=fitz.Matrix(z,z),alpha=False)
    Image.frombytes('RGB',(pix.width,pix.height),pix.samples).save(out,'WEBP',quality=Q,method=5)
    return os.path.getsize(out)
if __name__=='__main__':
    pdf,outdir,first,last=sys.argv[1],sys.argv[2],int(sys.argv[3]),int(sys.argv[4])
    os.makedirs(outdir,exist_ok=True)
    jobs=[(pdf,n,f'{outdir}/{n:03d}.webp') for n in range(first,last+1)]
    with Pool(4) as p: s=p.map(job,jobs,chunksize=8)
    print(len(jobs),'pages',sum(s)//1048576,'Mo')
