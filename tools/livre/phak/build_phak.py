import re,json,glob,os,shutil,html
R='/home/user/Quizz-PPL/livre/phak'
SRC='/tmp/claude-0/-home-user-Quizz-PPL/8beebd1b-8d3f-5bcf-aa92-0ee999b0ecbe/scratchpad/src'
GROUPS=[('A','À lire en priorité pour le PPL','Aérodynamique, commandes, systèmes, performances, météo, navigation : le socle de la théorie.'),
        ('B','Pour compléter','Contexte, décision, aéronef, instruments, documents, aéroports, espace aérien, médical.'),
        ('C','Références','Glossaire et annexes.')]
# n : (label, titre, groupe, première page pdf, dernière page pdf)
CHAPTERS={1:('Chapitre 1','Introduction au vol','B',16,39),2:('Chapitre 2','Prise de décision aéronautique','B',40,71),3:('Chapitre 3','Structure et composants de l’aéronef','B',72,87),
 4:('Chapitre 4','Principes du vol','A',88,96),5:('Chapitre 5','Aérodynamique du vol','A',98,148),6:('Chapitre 6','Commandes de vol','A',149,160),7:('Chapitre 7','Systèmes de l’aéronef','A',161,202),
 8:('Chapitre 8','Instruments de vol','A',203,230),9:('Chapitre 9','Manuels de vol et documents','B',231,244),10:('Chapitre 10','Masse et centrage','A',245,256),11:('Chapitre 11','Performances de l’aéronef','A',257,284),
 12:('Chapitre 12','Théorie météorologique','A',285,310),13:('Chapitre 13','Services météorologiques aéronautiques','A',311,334),14:('Chapitre 14','Opérations d’aéroport','A',335,375),
 15:('Chapitre 15','Espace aérien','A',376,387),16:('Chapitre 16','Navigation','A',388,422),17:('Chapitre 17','Facteurs aéromédicaux','B',423,452),
 18:('Annexe A','Données de performance (Cessna 172R)','C',453,460),19:('Annexe B','Abréviations','C',461,472),20:('Annexe C','Panneaux et marquages d’aéroport','C',473,476),21:('Glossaire','Glossaire A–Z','C',477,512)}
def inl(t):
    t=t.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
    t=re.sub(r'==(.+?)==',r'<mark>\1</mark>',t); t=re.sub(r'\*\*(.+?)\*\*',r'<b>\1</b>',t); t=re.sub(r'(?<![\w*])\*(.+?)\*(?![\w*])',r'<i>\1</i>',t)
    return t
def words(h): return len(re.sub(r'<[^>]+>',' ',h).split())
def parse(path):
    n=None;intro='';pages=[];cur=None;sheet=[];nums=[];mode=None;lst=None
    for raw in open(path,encoding='utf8'):
        line=raw.rstrip('\n')
        if not line.strip(): continue
        if line.startswith('@CH '): n=int(line[4:].split()[0]); continue
        if line.startswith('@INTRO '): intro=inl(line[7:]); continue
        if line.startswith('@PAGE '):
            m=re.match(r'@PAGE (\S+) pdf=(\d+)',line); cur={'ref':m.group(1),'pdf':int(m.group(2)),'blocks':[],'summary':[],'vocab':[]}; pages.append(cur); mode='page'; lst=None; continue
        if line=='@SHEET': mode='sheet'; continue
        if line=='@NUMS': mode='nums'; continue
        if mode=='sheet': sheet.append(inl(line.lstrip('* ').strip())); continue
        if mode=='nums': a,b=line.split(' | ',1); nums.append([inl(a),inl(b)]); continue
        b=cur['blocks']
        if line.startswith('# '): b.append({'h':inl(line[2:])}); lst=None
        elif line.startswith('## '): b.append({'h3':inl(line[3:])}); lst=None
        elif line.startswith('P: '): b.append({'p':inl(line[3:])}); lst=None
        elif line.startswith('FIG: '): b.append({'fig':inl(line[5:])}); lst=None
        elif line.startswith('- '):
            if lst!='ul': b.append({'ul':[]}); lst='ul'
            b[-1]['ul'].append(inl(line[2:]))
        elif re.match(r'\d+\. ',line):
            if lst!='ol': b.append({'ol':[]}); lst='ol'
            b[-1]['ol'].append(inl(re.sub(r'^\d+\. ','',line)))
        elif line.startswith('SUM: '): cur['summary']=[inl(x.strip()) for x in line[5:].split(' || ')]
        elif line.startswith('VOC: '): cur['vocab']=[[inl(y.strip()) for y in x.split(' | ',1)] for x in line[5:].split(' ;; ')]
        else: raise SystemExit(f'{path}: ligne inconnue: {line[:60]}')
    for p in pages:
        p['w']=sum(words(x) if isinstance(x,str) else sum(words(y) for y in x) for blk in p['blocks'] for x in blk.values())
        assert p['summary'] and p['vocab'], (path,p['ref'],'résumé/vocabulaire manquant')
    return n,intro,pages,sheet,nums
def main():
    done={}
    for f in sorted(glob.glob(SRC+'/tr/ch*.txt')):
        n,intro,pages,sheet,nums=parse(f); done[n]=(intro,pages,sheet,nums)
    chapters=[]
    for n,(label,title,g,a,b) in CHAPTERS.items():
        if n not in done: continue
        intro,pages,sheet,nums=done[n]
        chapters.append({'n':n,'label':label,'title':title,'intro':intro,'group':dict((x[0],x[1]) for x in GROUPS)[g],'sheet':{'points':sheet,'nums':nums},'pages':pages})
        for p in pages:
            src=f'{SRC}/phak_img/{p["pdf"]:03d}.webp'; os.makedirs(R+'/img',exist_ok=True)
            assert os.path.exists(src),src; shutil.copy2(src,f'{R}/img/{p["pdf"]:03d}.webp')
    pending=[f'{CHAPTERS[n][0]} — {CHAPTERS[n][1]}' for n in CHAPTERS if n not in done]
    json.dump({'id':'phak','title':'Manuel du pilote, en français','eyebrow':'FAA-H-8083-25C · Pilot’s Handbook of Aeronautical Knowledge',
      'footer':'Traduction non officielle, faite pour étudier. Règles américaines : pour l’Europe et la Belgique, la réglementation en vigueur, l’AIP et ton instructeur font foi. Les figures ne sont pas traduites : ouvre la page originale pour les voir.',
      'groups':[{'name':g[1],'sub':g[2]} for g in GROUPS],'pending':pending,'chapters':chapters},open(R+'/book.json','w',encoding='utf8'),ensure_ascii=False,separators=(',',':'))
    print(len(chapters),'chapitres,',sum(len(c['pages']) for c in chapters),'pages,',sum(p['w'] for c in chapters for p in c['pages']),'mots ;',len(pending),'en attente')
main()
