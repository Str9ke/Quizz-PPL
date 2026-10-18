# Écrit raster.json (textes des figures matricielles du CAP 737) : `python tools/livre/cap737/raster_src.py`
# puis `python tools/livre/rasterfix.py cap737` juste après une extraction (les images sont modifiées en place).
import json, os

def col(x0, x1, items, **kw):
    """Colonne d'un carnet manuscrit : (y0, y1, texte) -> zones alignées à gauche."""
    return [dict(box=[x0, y0, x1, y1], t=t, align='left', script=True, color='#111111', size=30, **kw) for y0, y1, t in items]

R = {"_": "Figures matricielles du CAP 737 (coordonnées en pixels des images livre/cap737/fig)"}

# Tableau 3 : case trop petite pour le texte vectoriel
R["207_1.webp"] = [
    {"box": [670, 165, 1025, 222], "t": "Transmettre le savoir", "color": "#000000", "fill": "#ffffff", "size": 32, "align": "left"},
    {"box": [670, 278, 1025, 335], "t": "Instructeur", "color": "#000000", "fill": "#ffffff", "size": 32, "align": "left"},
    {"box": [670, 350, 1025, 405], "t": "Instructeur", "color": "#000000", "fill": "#ffffff", "size": 32, "align": "left"}]

# Figure 2 : troïka (étiquettes trop longues pour leur cadre vectoriel)
W = dict(color='#000000', fill='#ffffff', size=44, align='left')
R["016_1.webp"] = [dict(box=[630, 40, 1548, 122], t="Atténuer les conséquences de l’erreur", **W),
                   dict(box=[630, 236, 1548, 350], t="Intercepter l’erreur", **W),
                   dict(box=[630, 440, 1548, 527], t="Éviter l’erreur", **W)]

# Figure 1 : modèle de gestion des erreurs (Helmreich)
B = dict(color='#000000', size=36)
R["015_1.webp"] = [
    dict(box=[12, 62, 262, 159], t="Menaces\nexternes", bold=True, **B),
    dict(box=[286, 20, 552, 190], t="Événements /\nrisques\nprévus", **B),
    dict(box=[625, 20, 890, 190], t="Événements /\nrisques\nimprévus", **B),
    dict(box=[963, 20, 1228, 190], t="Erreur\nexterne", **B),
    dict(box=[30, 525, 250, 632], t="Menaces\ninternes", bold=True, **B),
    dict(box=[625, 490, 890, 660], t="Erreur de\nl’équipage", **B),
    dict(box=[8, 1090, 268, 1198], t="Comporte-\nments CRM", bold=True, **B),
    dict(box=[343, 1005, 664, 1268], t="Repérage\ndes menaces et\névitement\ndes erreurs", **B),
    dict(box=[794, 1005, 1115, 1268], t="Détection\net gestion\ndes erreurs", **B),
    dict(box=[8, 1418, 268, 1482], t="Résultats", bold=True, **B),
    dict(box=[117, 1570, 382, 1738], t="Un vol\nsûr", **B),
    dict(box=[455, 1570, 720, 1738], t="Retour à\nun vol sûr", **B),
    dict(box=[907, 1570, 1172, 1738], t="Erreur\nsupplémentaire", **B),
    dict(box=[612, 1835, 905, 1950], t="Incident /\naccident", **B)]

# Figure 8 : modèle de Reason
R["057_1.webp"] = [
    dict(box=[648, 86, 820, 122], t="Défenses", bold=True, align='left', color='#222222', size=26),
    dict(box=[648, 123, 840, 154], t="Inadéquates", align='left', color='#333333', size=22),
    dict(box=[364, 154, 532, 206], t="Interactions avec\ndes événements", align='left', color='#333333', size=22),
    dict(box=[364, 207, 458, 237], t="locaux", align='left', color='#333333', size=22),
    dict(box=[558, 268, 760, 334], t="Activités\nproductives", bold=True, align='left', color='#222222', size=26),
    dict(box=[558, 335, 760, 364], t="Actes dangereux", align='left', color='#333333', size=22),
    dict(box=[1045, 376, 1330, 437], t="Fenêtre limitée\nd’occasion d’accident", align='left', color='#333333', size=22),
    dict(box=[474, 453, 720, 489], t="Préconditions", bold=True, align='left', color='#222222', size=26),
    dict(box=[474, 490, 690, 570], t="Précurseurs\npsychologiques\ndes actes dangereux", align='left', color='#333333', size=22),
    dict(box=[388, 636, 690, 671], t="Encadrement", bold=True, align='left', color='#222222', size=26),
    dict(box=[388, 672, 580, 702], t="Défaillances", align='left', color='#333333', size=22),
    dict(box=[298, 820, 470, 886], t="Décideurs", bold=True, align='left', color='#222222', size=26),
    dict(box=[298, 887, 440, 944], t="Décisions\nfaillibles", align='left', color='#333333', size=22),
    dict(box=[978, 808, 1440, 842], t="Défaillances actives et latentes", align='left', color='#333333', size=24),
    dict(box=[893, 855, 1200, 889], t="Défaillances actives", align='left', color='#333333', size=24),
    dict(box=[806, 900, 1100, 934], t="Défaillances latentes", align='left', color='#333333', size=24),
    dict(box=[720, 946, 1010, 980], t="Défaillances latentes", align='left', color='#333333', size=24),
    dict(box=[636, 991, 925, 1025], t="Défaillances latentes", align='left', color='#333333', size=24)]

# Figure 10 : multitâche
R["071_1.webp"] = [
    dict(box=[40, 85, 310, 155], t="Oreilles", size=36, color="#333333"),
    dict(box=[872, 90, 1150, 162], t="Yeux", size=36, color="#333333"),
    dict(box=[34, 452, 316, 584], t="Boucle\nphonologique", size=36, color="#333333"),
    dict(box=[455, 432, 712, 562], t="Administrateur\ncentral", size=36, color="#333333"),
    dict(box=[872, 412, 1155, 594], t="Calepin\nvisuo-\nspatial", size=36, color="#333333"),
    dict(box=[34, 905, 316, 1035], t="Sortie\nvocale", size=36, color="#333333"),
    dict(box=[876, 878, 1160, 1058], t="Sortie\nmanuelle\n(physique)", size=36, color="#333333")]

# Figure 12 : le carnet de Jessie (positifs / négatifs)
R["099_1.webp"] = [dict(box=[320, 38, 540, 102], t="négatifs", script=True, color='#111111', size=44),
                   dict(box=[1000, 45, 1220, 112], t="positifs", script=True, color='#111111', size=44)] + \
    col(85, 315, [(200, 290, "Peu\ntravailleur"), (312, 362, "Pas sportif"), (386, 434, "N’aime pas\nle cinéma"),
                  (456, 504, "Peu séduisant"), (530, 614, "Vit chez\nses parents"), (640, 720, "S’habille\nmal"),
                  (745, 865, "Assez mal\npayé, sans\nfortune"), (890, 975, "Aime les\njeux d’argent"), (1000, 1050, "Grand fêtard")]) + \
    col(330, 530, [(196, 244, "Bourreau\nde travail"), (268, 314, "Anxieux"), (340, 390, "Arrogant"),
                   (410, 500, "Trop\napprêté"), (520, 605, "A beaucoup\nde conquêtes"), (630, 680, "Aime le foot"),
                   (700, 750, "Têtu")]) + \
    col(560, 775, [(196, 248, "Assez timide"), (266, 350, "Très vieille\nvoiture"), (376, 534, "Mes amis ne\nle trouvent pas\ntrès séduisant"),
                   (556, 680, "Sans doute\njamais eu\nde partenaire"), (700, 790, "Vêtements\ndémodés"), (810, 860, "Aime le hockey")]) + \
    col(835, 1050, [(205, 290, "Drôle de\ncaractère"), (312, 364, "Super famille"), (386, 464, "Bon sens\nde l’humour"),
                    (496, 580, "Se remet\nen forme"), (606, 724, "Aime voyager\net sortir"), (750, 905, "N’aime ni le\nfoot ni le\nsport en\ngénéral"),
                    (926, 980, "Aime les animaux")]) + \
    col(1065, 1280, [(196, 244, "Beau"), (268, 314, "Travailleur"), (340, 390, "Bien habillé"), (414, 462, "Bon salaire"),
                     (486, 534, "Riche"), (558, 608, "Intelligent"), (630, 680, "Beau physique"),
                     (700, 825, "Réussit, bel\navenir"), (845, 930, "Aime les bons\nrestaurants")]) + \
    col(1298, 1510, [(196, 244, "Gentil"), (268, 350, "Pas\nmatérialiste"), (376, 460, "Sans doute\nfidèle"), (486, 534, "Cultivé"),
                     (558, 645, "Agréable\net poli"), (668, 716, "Bon métier"), (740, 790, "A son appart")])

DIMS = "Intelligence\nAttrait physique\nSens de l’humour\nPersonnalité\nMétier\nFortune"
# Figure 13 : méthode 2
R["099_2.webp"] = [dict(box=[245, 85, 490, 155], t="Dimensions", script=True, color='#111111', size=42),
                   dict(box=[910, 85, 1275, 158], t="Notes (sur dix)", script=True, color='#111111'),
                   dict(box=[212, 262, 600, 545], t=DIMS, script=True, color='#111111', align='left')]
# Figure 14 : méthode 3
R["100_1.webp"] = [dict(box=[96, 160, 320, 222], t="Dimension", script=True, color='#111111', size=42),
                   dict(box=[505, 138, 705, 238], t="Poids\n(importance)", script=True, color='#111111'),
                   dict(box=[965, 50, 1315, 118], t="Note × poids", script=True, color='#111111'),
                   dict(box=[98, 262, 478, 540], t=DIMS, script=True, color='#111111', align='left')]

json.dump(R, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'raster.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(sum(len(v) for k, v in R.items() if not k.startswith('_')), 'zones')
