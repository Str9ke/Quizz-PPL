"""Session chezgligli.net de l'abonné : cookie PHPSESSID du navigateur connecté (jamais dans le dépôt).
Récupérer la valeur : navigateur connecté au site -> F12 -> Stockage/Application -> Cookies -> PHPSESSID,
puis   set GLIGLI_PHPSESSID=xxxx   (PowerShell : $env:GLIGLI_PHPSESSID='xxxx')."""
import os, sys
import requests
if not os.environ.get('GLIGLI_PHPSESSID'):
    sys.exit('GLIGLI_PHPSESSID manquant (cookie de session du site, voir en-tête de s.py)')
S = requests.Session()
S.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:158.0) Gecko/20100101 Firefox/158.0'
S.cookies.set('PHPSESSID', os.environ['GLIGLI_PHPSESSID'], domain='www.chezgligli.net')
S.cookies.set('hasConsent', 'true', domain='www.chezgligli.net')
B = 'https://www.chezgligli.net/qcm.php'
