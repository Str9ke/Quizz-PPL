# Traduction des textes des figures/tableaux du Risk Management Handbook (FAA-H-8083-2A).
# `python tools/livre/rmh/figtr_src.py` écrit figtr.json (utilisé par extract_figs.py --tr).
# Une valeur contenant « \n » garde l'alignement ligne à ligne de l'original (colonnes de tableau).
import json, os

T = {
# ---- p10-11 : rapport NTSB, PAVE
"Figure 1-1. Sample NTSB final report.": "Figure 1-1. Exemple de rapport final du NTSB.",
"below describes how PAVE items may relate to the accident.": "below describes how PAVE items may relate to the accident.",  # texte courant au-dessus de la figure : laissé tel quel (hors image)
"Pilot": "Pilote",
"A pilot must continually make decisions about competency, condition of health, mental and emotional state, level of fatigue, and many other variables. For example, a pilot may be called early in the morning to make a long flight. If a pilot has had only a few hours of sleep and is concerned that the sinus congestion being experienced could be the onset of a cold, it would be prudent to consider if the flight could be accomplished safely.":
  "Le pilote doit sans cesse décider de sa compétence, de sa santé, de son état mental et émotionnel, de sa fatigue et de bien d’autres variables. Exemple : appelé tôt le matin pour un long vol, après quelques heures de sommeil seulement et avec un nez bouché qui pourrait annoncer un rhume, il est prudent de se demander si le vol peut se faire en sécurité.",
"Aircraft": "Aéronef",
"A pilot had only 4 hours of sleep the night before being asked by the boss to fly to a meeting in a city 750 miles away. The reported weather was marginal and not expected to improve. After assessing fitness as a pilot, it was decided that it would not be wise to make the flight. The boss was initially unhappy, but was later convinced by the pilot that the risks involved were unacceptable.":
  "Un pilote n’a dormi que 4 heures quand son patron lui demande de l’emmener à une réunion à 750 milles. La météo annoncée est limite et ne doit pas s’améliorer. Après avoir évalué son aptitude, il juge plus sage de ne pas partir. Le patron, d’abord mécontent, finit par admettre que les risques étaient inacceptables.",
"A pilot frequently bases decisions on evaluation of the airplane, such as performance, equipment, or airworthiness.":
  "Le pilote fonde souvent ses décisions sur l’évaluation de l’avion : performances, équipements, navigabilité.",
"During a preflight, a pilot noticed a small amount of oil dripping from the bottom of the cowling. Although the quantity of oil seemed insignificant at the time, the pilot decided to delay the takeoff and have a mechanic check the source of the oil. The pilot’s good judgment was confirmed when the mechanic found that one of the oil cooler hose fittings was loose.":
  "À la visite prévol, un pilote remarque un peu d’huile qui goutte sous le capot. La quantité semble négligeable, mais il retarde le décollage et fait vérifier la fuite par un mécanicien. Bien vu : un raccord de durite du radiateur d’huile était desserré.",
"Environment": "Environnement",
"The environment encompasses many elements that are not pilot or airplane related, including such factors as weather, air traffic control (ATC), navigational aids (NAVAIDS), terrain,":
  "L’environnement regroupe tout ce qui ne dépend ni du pilote ni de l’avion : météo, contrôle aérien (ATC), aides à la navigation (NAVAIDS), relief,",
"takeoff and landing areas, and surrounding obstacles. Weather": "aires de décollage et d’atterrissage, obstacles alentour. La météo",
"is one element that can change drastically over time and distance.": "peut changer du tout au tout avec le temps et la distance.",
"The environment encompasses many elements that are not pilot or airplane related, including such factors as weather, air traffic control (ATC), navigational aids (NAVAIDS), terrain, takeoff and landing areas, and surrounding obstacles. Weather is one element that can change drastically over time and distance.":
  "L’environnement regroupe tout ce qui ne dépend ni du pilote ni de l’avion : météo, contrôle aérien (ATC), aides à la navigation (NAVAIDS), relief, aires de décollage et d’atterrissage, obstacles alentour. La météo peut changer du tout au tout avec le temps et la distance.",
"External Pressures": "Enjeux et pressions externes",
"A pilot was landing a small airplane just after a heavy jet had departed a parallel runway. The pilot assumed that wake turbulence would not be a problem since landings had been performed under similar circumstances. Due to a combination of prevailing winds and wake turbulence from the heavy jet drifting across the landing runway, the airplane made a hard landing. The pilot made an error when assessing the flight environment.":
  "Un pilote atterrit sur un petit avion juste après le départ d’un gros jet sur une piste parallèle. Il pense que la turbulence de sillage ne posera pas de problème, puisqu’il a déjà atterri dans des conditions semblables. Mais le vent pousse le sillage du jet sur sa piste : atterrissage dur. Il a mal évalué l’environnement du vol.",
"The interaction between the pilot, airplane, and the environment is greatly influenced by the purpose of each flight operation. The pilot must evaluate the three previous areas to decide on the desirability of undertaking or continuing the flight as planned. It is worth asking why the flight is being made, how critical it is to maintain the schedule, and if the trip is worth the risks.":
  "L’interaction pilote–avion–environnement dépend beaucoup du but du vol. Le pilote évalue les trois domaines précédents pour décider s’il est souhaitable d’entreprendre ou de poursuivre le vol prévu. Bonnes questions : pourquoi ce vol ? Est-il vital de tenir l’horaire ? Le voyage vaut-il ces risques ?",
"On a ferry flight to deliver an airplane from the factory, the pilot calculated the groundspeed and determined he would arrive at the destination with only 10 minutes of fuel remaining. A check of the weather revealed he would be flying into marginal weather conditions. By asking himself whether it was more critical to maintain the schedule or to arrive with an intact":
  "En convoyage d’un avion neuf, le pilote calcule sa vitesse sol : il arriverait avec 10 minutes de carburant seulement. La météo annonce des conditions limites. En se demandant s’il est plus important de tenir l’horaire ou d’arriver avec un avion",
"aircraft, the pilot decided to schedule a refuel stop even though": "intact, il prévoit une escale carburant, même si",
"it would mean he would not be able to keep to the schedule. He chose not to “stretch” the fuel supply in marginal weather conditions which could have resulted in an emergency landing.":
  "cela l’empêche de tenir l’horaire. Il refuse de « tirer » sur le carburant par météo limite, ce qui aurait pu finir en atterrissage d’urgence.",
# ---- p13 : catégories météo
"Category": "Catégorie", "Ceiling": "Plafond", "Visibility": "Visibilité",
"Visual Flight Rules": "Vol à vue", "and": "et", "and/or": "et/ou",
"Greater than 3,000 feet AGL": "Plus de 3 000 ft sol", "Greater than 5 miles": "Plus de 5 milles",
"VFR": "VFR", "Marginal Visual Flight Rules": "Vol à vue marginal",
"1,000 to 3,000 feet AGL": "1 000 à 3 000 ft sol", "3 to 5 miles": "3 à 5 milles", "MVFR": "MVFR",
"Instrument Flight Rules": "Vol aux instruments", "500 to below 1,000 feet AGL": "500 à moins de 1 000 ft sol",
"1 mile to less than 3 miles": "1 à moins de 3 milles", "IFR": "IFR",
"Low Instrument Flight Rules": "Vol aux instruments bas", "below 500 feet AGL": "moins de 500 ft sol",
"less than 1 mile": "moins d’1 mille", "LIFR": "LIFR",
# ---- p14 : synthèse expérience
"Certification, Training, and Experience Summary": "Licences, formation et expérience : synthèse",
"Certification Level": "Niveau de licence",
"Certificate level (e.g., private, commercial, ATP)": "Licence (ex. : privé, professionnel, ATP)",
"Ratings (e.g., instrument, multiengine)": "Qualifications (ex. : IR, multimoteur)",
"Endorsements (e.g., complex, high performance, high altitude)": "Extensions (ex. : avion complexe, haute performance, haute altitude)",
"Training Summary": "Formation",
"Flight review (e.g., certificate, rating, wings)": "Contrôle périodique (licence, qualification, WINGS)",
"Instrument Proficiency Check": "Contrôle de compétence IFR",
"Time since checkout in aircraft 1": "Temps depuis le lâcher sur l’avion 1",
"Time since checkout in aircraft 2": "Temps depuis le lâcher sur l’avion 2",
"Time since checkout in aircraft 3": "Temps depuis le lâcher sur l’avion 3",
"Variation in equipment (e.g., GPS navigators, autopilot)": "Variantes d’équipement (ex. : GPS, pilote automatique)",
"Experience": "Expérience", "Total flying time": "Heures de vol totales", "Years of flying experience": "Années de pilotage",
"Recent Experience (last 12 months)": "Expérience récente (12 derniers mois)", "Hours": "Heures",
"Hours in this aircraft (or identical model)": "Heures sur cet avion (ou modèle identique)",
"Landings": "Atterrissages", "Night hours": "Heures de nuit", "Night landings": "Atterrissages de nuit",
"Hours flown in high density altitude": "Heures à altitude-densité élevée",
"Hours flown in mountainous terrain": "Heures en région montagneuse",
"Crosswind landings": "Atterrissages vent de travers", "IFR hours": "Heures IFR",
"IMC hours (actual conditions)": "Heures IMC (conditions réelles)",
"Approaches (actual or simulated)": "Approches (réelles ou simulées)",
# ---- p15-16 : évaluation « confort »
"Experience and “Comfort Level” Assessment": "Évaluation expérience et « niveau de confort »",
"VFR & MVFR": "VFR et MVFR", "Weather Condition": "Conditions météo",
"Day Night": "Jour\nNuit",
"> 5 miles — 8 miles": "> 5 milles\n—\n8 milles",
"3–5 miles 4 miles —": "3–5 milles\n4 milles\n—",
"Figure 2-3. A sample pilot experience and comfort level assessment for VFR and MVFR.": "Figure 2-3. Exemple d’évaluation expérience/confort en VFR et MVFR.",
"IFR & LIFR": "IFR et LIFR",
"1–3 miles 1 mile 3 miles": "1–3 milles\n1 mille\n3 milles",
"< 1 mile — —": "< 1 mille\n—\n—",
"Figure 2-4. A sample pilot experience and comfort level assessment for IFR and LIFR.": "Figure 2-4. Exemple d’évaluation expérience/confort en IFR et LIFR.",
"Combined VFR & IFR": "VFR et IFR combinés",
"4 miles 8 miles": "4 milles\n8 milles", "1 mile 3 miles": "1 mille\n3 milles",
"Wind & Turbulence": "Vent et turbulence", "Make/": "Marque/", "SE": "MONO", "ME": "MULTI", "Model": "modèle",
"Turbulence": "Turbulence", "10 knots 5 knots": "10 kt\n5 kt", "15 knots 8 knots": "15 kt\n8 kt",
"Surface wind speed Surface wind gusts Crosswind component": "Vent au sol\nRafales au sol\nComposante de travers",
"Figure 2-6. A sample pilot experience and comfort level assessment for wind and turbulence.": "Figure 2-6. Exemple d’évaluation expérience/confort : vent et turbulence.",
"Performance Factors": "Facteurs de performance", "Performance": "Performances",
"Shortest runway Highest terrain Highest density altitude": "Piste la plus courte\nRelief le plus haut\nAltitude-densité max.",
"Figure 2-7. Sample experience and comfort level assessment for performance factors.": "Figure 2-7. Exemple d’évaluation expérience/confort : facteurs de performance.",
"Baseline Personal Minimums": "Minima personnels de base",
"Figure 2-8. Sample baseline personal minimums.": "Figure 2-8. Exemple de minima personnels de base.",
# ---- p17 : ajustements
"If you are facing": "Si tu dois composer avec",
"Adjust baseline personal minimums by": "Ajuste tes minima de base en",
"Illness, use of medication, stress, or fatigue; lack of currency (e.g., have not flown for several weeks)": "Maladie, médicaments, stress ou fatigue ; manque d’entraînement récent (ex. : pas volé depuis des semaines)",
"Adding at least 500 feet to ceiling": "ajoutant au moins 500 ft au plafond",
"An unfamiliar airplane or an aircraft with unfamiliar avionics or other equipment": "Un avion inconnu, ou une avionique ou des équipements inhabituels",
"Adding at least 1/2 mile to visibility": "ajoutant au moins 1/2 mille à la visibilité",
"Unfamiliar airports and airspace; different terrain or other unfamiliar characteristics": "Aérodromes et espaces inconnus ; relief différent ou autres particularités",
"enVironment": "enVironnement",
"Adding at least 500 feet to runway length": "ajoutant au moins 500 ft à la longueur de piste",
"External": "Pressions",
"“Must meet” deadlines, pressures from passengers, etc.": "Échéances « impératives », pression des passagers, etc.",
"Subtracting at least 5 knots from winds": "retirant au moins 5 kt aux vents",
"Pressures": "externes",
# ---- p20-21 : attitudes dangereuses
"The Five Hazardous Attitudes": "Les cinq attitudes dangereuses",
"Anti-authority: “Don’t tell me.”": "Anti-autorité : « On ne me dicte rien. »",
"This attitude is found in people who do not like anyone telling them what to do. In a sense, they are saying, “No one can tell me what to do.” They may be resentful of having someone tell them what to do or may regard rules, regulations, and procedures as silly or unnecessary. However, it is always pilot prerogative to question authority if it seems to be in error.":
  "Attitude de ceux qui n’aiment pas qu’on leur dise quoi faire : « Personne ne me donne d’ordres. » Ils supportent mal les consignes ou jugent règles, règlements et procédures idiots ou inutiles. Le pilote garde pourtant toujours le droit de contester une autorité qui semble se tromper.",
"Impulsivity: “Do it quickly.”": "Impulsivité : « Vite, on y va ! »",
"This is the attitude of people who frequently feel the need to do something—anything—immediately. They do not stop to think about what they are about to do; they do not select the best alternative; and they do the ﬁrst thing that comes to mind.":
  "Attitude de ceux qui ressentent le besoin de faire quelque chose — n’importe quoi — tout de suite. Ils ne s’arrêtent pas pour réfléchir, ne choisissent pas la meilleure option et font la première chose qui leur vient à l’esprit.",
"Invulnerability: “It won’t happen to me.”": "Invulnérabilité : « Ça ne m’arrivera pas. »",
"Many people believe that accidents happen to others, but never to them. They know accidents can happen, and they know that anyone can be affected. They never really feel or believe that they will be personally involved. Pilots who think this way are more likely to take chances and increase risk.":
  "Beaucoup pensent que les accidents n’arrivent qu’aux autres. Ils savent qu’ils existent et peuvent toucher n’importe qui, mais ne croient jamais vraiment être concernés. Les pilotes qui pensent ainsi prennent plus de risques.",
"Macho: “I can do it.”": "Macho : « Je peux le faire. »",
"Pilots who are always trying to prove that they are better than anyone else are thinking, “I can do it, I’ll show them.” Pilots with this type of attitude will try to prove themselves by taking risks in order to impress others. While this pattern is thought to be a male characteristic, women are equally susceptible.":
  "Le pilote qui veut toujours prouver qu’il est le meilleur pense : « Je vais leur montrer. » Il prend des risques pour impressionner. On croit ce travers masculin, mais les femmes y sont tout autant exposées.",
"Resignation: “What’s the use?”": "Résignation : « À quoi bon ? »",
"Pilots who think, “What’s the use?” do not see themselves as being able to make a great deal of difference in what happens to them. When things go well, the pilot is apt to think that it is good luck. When things go badly, the pilot may feel that “someone is out to get me,” or attribute it to bad luck. The pilot will leave the action to others, for better or worse. Sometimes, such pilots will even go along with unreasonable requests just to be a “nice guy.”":
  "Le pilote qui pense « À quoi bon ? » ne se croit pas capable de changer grand-chose à ce qui lui arrive. Quand tout va bien, c’est la chance ; quand tout va mal, « on m’en veut » ou c’est la malchance. Il laisse agir les autres, pour le meilleur ou pour le pire, et accepte parfois des demandes déraisonnables pour rester « sympa ».",
"Hazardous Attitude": "Attitude dangereuse", "Antidotes": "Antidotes", "Macho": "Macho",
"Steve often brags to his friends about his skills as a pilot and how close to the ground he flies. During a local pleasure flight in his singleengine airplane, he decides to buzz some":
  "Steve se vante souvent auprès de ses amis de ses talents de pilote et de voler au ras du sol. Lors d’un vol local sur son monomoteur, il décide de passer en rase-mottes au-dessus d’amis",
"Taking chances is foolish.": "Prendre des risques, c’est idiot.",
"friends barbecuing at a nearby park.": "qui font un barbecue dans un parc voisin.",
"Anti-authority": "Anti-autorité",
"Follow the rules. They help prevent accidents.": "Respecte les règles : elles évitent des accidents.",
"Although he knows that flying so low to the ground is prohibited by the regulations, he feels that the regulations are too restrictive in some circumstances.":
  "Il sait que voler si bas est interdit, mais trouve la réglementation trop restrictive dans certains cas.",
"Invulnerability": "Invulnérabilité", "It could happen to me.": "Ça peut m’arriver.",
"Steve is not worried about an accident since he has flown this low many times before, and he has not had any problems.":
  "Steve ne craint pas l’accident : il a souvent volé aussi bas sans le moindre problème.",
"Impulsivity": "Impulsivité",
"As he is buzzing the park, the airplane does not climb as well as Steve had anticipated, and without thinking, he pulls back hard on the yoke. The airspeed drops, and the airplane is close to stalling as the wing brushes a power line.":
  "Au-dessus du parc, l’avion monte moins bien que prévu ; sans réfléchir, Steve tire fort sur le manche. La vitesse chute, l’avion frôle le décrochage et l’aile touche une ligne électrique.",
"Not so fast. Think first.": "Pas si vite. Réfléchis d’abord.",
"Resignation": "Résignation",
"Although Steve manages to recover, the wing sustains minor damage. Steve thinks to himself, “It doesn’t really matter how much effort I put in—the end result is the same whether I really try or not.”":
  "Steve rattrape l’avion, mais l’aile est légèrement endommagée. Il se dit : « Peu importe mes efforts, le résultat est le même que j’essaie ou non. »",
"I’m not helpless. I can make a difference.": "Je ne suis pas impuissant. Je peux changer les choses.",
"Figure 3-2. Antidotes to hazardous attitudes.": "Figure 3-2. Antidotes aux attitudes dangereuses.",
# ---- p24 : I'M SAFE
"I'M SAFE CHECKLIST": "CHECK-LIST I’M SAFE",
"Illness—Do I have any symptoms?": "Indisposition — Ai-je des symptômes ?",
"Medication—Have I been taking prescription or over-the-counter drugs? Stress—Am I under psychological pressure from the job? Worried about financial matters, health problems, or family discord? Alcohol—Have I been drinking within 8 hours? Within 24 hours? Fatigue—Am I tired and not adequately rested?":
  "Médicaments — Ai-je pris des médicaments, sur\nordonnance ou en vente libre ?\nStress — Suis-je sous pression psychologique :\ntravail, soucis d’argent, de santé,\nconflits familiaux ?\nAlcool — Ai-je bu dans les 8 dernières heures ?\nDans les 24 dernières heures ?\nFatigue — Suis-je fatigué, mal reposé ?",
"Emotion—Am I emotionally upset?": "Esprit — Suis-je bouleversé, contrarié ?",
# ---- p28 : grille d'évaluation
"RISK ASSESSMENT": "ÉVALUATION DU RISQUE", "Pilot’s Name": "Nom du pilote", "Flight From": "Départ", "To": "Arr.",
"SLEEP": "SOMMEIL", "HOW IS THE DAY GOING?": "TA JOURNÉE ?",
"1. Did not sleep well or less than 8 hours 2. Slept well": "1. Mal dormi ou moins de 8 heures\n2. Bien dormi",
"1. Seems like one thing after another (late,": "1. Les tracas s’enchaînent (en retard,",
"making errors, out of step)": "erreurs, pas dans le rythme)",
"2. Great day": "2. Excellente journée",
"HOW DO YOU FEEL?": "TA FORME ?", "IS THE FLIGHT": "LE VOL A LIEU",
"1. Have a cold or ill 2. Feel great 3. Feel a bit off": "1. Enrhumé ou malade\n2. En pleine forme\n3. Pas tout à fait en forme",
"1. Day? 2. Night?": "1. De jour ?\n2. De nuit ?",
"WEATHER AT TERMINATION": "MÉTÉO À DESTINATION", "PLANNING": "PRÉPARATION",
"1. Greater than 5 miles visibility and 3,000 feet": "1. Visibilité > 5 milles et plafond",
"1. Rush to get off ground 2. No hurry 3. Used charts and computer to assist 4. Used computer program for all planning":
  "1. Pressé de décoller\n2. Sans précipitation\n3. Cartes + ordinateur en appui\n4. Tout par logiciel",
"ceilings": "de 3 000 ft",
"2. At least 3 miles visibility and 1,000 feet ceilings, but less than 3,000 feet ceilings and 5 miles visibility":
  "2. Au moins 3 milles et plafond de 1 000 ft,\nmais moins de 3 000 ft de plafond\net de 5 milles de visibilité",
"Yes No Yes No Yes": "Oui\nNon\nOui\nNon\nOui", "3. IMC conditions": "3. Conditions IMC",
"5. Did you verify weight and balance?": "5. Masse et centrage faits ?",
"6. Did you evaluate performance?": "6. Performances évaluées ?",
"Column total": "Total colonne", "No Yes No": "Non\nOui\nNon",
"7. Do you brief your passengers on the": "7. Briefing des passagers",
"ground and in flight?": "au sol et en vol ?",
"TOTAL SCORE": "SCORE TOTAL", "Endangerment": "Danger", "Low risk": "Risque faible",
"Not complex flight": "Vol simple", "Exercise caution": "Prudence", "Area of concern": "Zone critique",
# ---- p29-42 : outil d'évaluation FRAT
"Flight Risk Assessment Tool": "Outil d’évaluation des risques du vol",
"PAVE Area": "Domaine PAVE", "Hazard": "Danger", "Risk": "Risque", "Likelihood": "Probabilité",
"Severity": "Gravité", "Composite Risk": "Risque global", "Mitigation Results": "Résultat de l’atténuation",
"Pilot “P”": "Pilote « P »", "Capability Aeromedical": "Compétence\nAéromédical",
"Aircraft “A”": "Aéronef « A »", "Fuel/Range/Payload Equipment Performance": "Carburant/rayon/charge\nÉquipement\nPerformances",
"Environment “V”": "Environnement « V »",
"Weather Terrain Airspace, ATC, Airports Night/Over Water": "Météo\nRelief\nEspace, ATC, AD\nNuit/survol mer",
"External Pressure “E”": "Pressions externes « E »", "Personal Business": "Personnel\nProfessionnel",
"Risk Assessment Matrix": "Matrice d’évaluation du risque",
"Catastrophic": "Catastrophique", "Critical": "Critique", "Marginal": "Marginale", "Negligible": "Négligeable",
"High": "Élevé", "Serious": "Sérieux", "Probable": "Probable", "Occasional": "Occasionnelle",
"Medium": "Moyen", "Low": "Faible", "Remote": "Rare", "Improbable": "Improbable",
"serious": "sérieux", "high": "élevé", "occasional": "occasionnelle", "critical": "critique",
"probable": "probable", "catastrophic": "catastrophique", "medium": "moyen", "remote": "rare",
"Not IFR proficient Alcohol and lack of sleep": "Pas entraîné IFR\nAlcool et manque de sommeil",
"LOC Fatigue related errors": "LOC\nErreurs dues à la fatigue",
"remote occasional": "rare\noccasionnelle",
"catastrophic critical": "catastrophique\ncritique",
"catastrophic catastrophic": "catastrophique\ncatastrophique",
"catastrophic catastrophic catastrophic": "catastrophique\ncatastrophique\ncatastrophique",
"Cannot carry full fuel Not certified for known ice Marginal takeoff performance": "Pleins impossibles\nNon certifié givrage\nPerfs décollage limites",
"Fuel exhaustion LOC Overrun, LOC, or CFIT": "Panne sèche\nLOC\nSortie de piste, LOC, CFIT",
"Weather Terrain": "Météo\nRelief",
"Thunderstorms, icing, low ceilings High terrain": "Orages, givrage, plafonds bas\nRelief élevé",
"LOC and CFIT CFIT": "LOC et CFIT\nCFIT",
"occasional occasional": "occasionnelle\noccasionnelle",
"Airspace, ATC, Airports Night/Over Water": "Espace, ATC, AD\nNuit/survol mer",
"High density altitude N/A": "Altitude-densité élevée\nS. O.",
"CFIT N/A": "CFIT\nS. O.",
"N/A Meeting deadlines for myself and Ms. Smith": "S. O.\nDélais à tenir (moi et Mme Smith)",
"N/A Increased risk in all other categories": "S. O.\nRisque accru partout ailleurs",
"Add 500' to minimums improbable/catastrophic now": "+500 ft aux minima → improbable/catastrophique :",
"Capability": "Compétence", "Not IFR proficient": "Pas entraîné IFR", "LOC": "LOC",
"medium No alcohol/adequate rest remote/marginal now": "moyen\nNi alcool, repos suffisant → rare/marginale :",
"Aeromedical": "Aéromédical", "Alcohol and lack of sleep": "Alcool et manque de sommeil",
"Fatigue related errors": "Erreurs dues à la fatigue",
"Fuel/Range/Payload Equipment": "Carburant/rayon/charge\nÉquipement",
"Cannot carry full fuel Not certified for known ice": "Pleins impossibles\nNon certifié givrage",
"Fuel exhaustion LOC": "Panne sèche\nLOC",
"Add fuel stop improbable/negligible now low": "Escale carburant → improbable/négligeable : faible",
"Avoid icing conditions remote/marginal now medium": "Éviter le givrage → rare/marginale : moyen",
"Marginal takeoff performance": "Perfs décollage limites", "Overrun, LOC, or CFIT": "Sortie de piste, LOC, CFIT",
"Depart from KDRO remote/marginal now medium": "Partir de KDRO → rare/marginale : moyen",
"Weather": "Météo", "Thunderstorms, icing, low ceilings": "Orages, givrage, plafonds bas", "LOC and CFIT": "LOC et CFIT",
"Fly well south of front remote/critical now medium": "Passer loin au sud du front → rare/critique : moyen",
"Terrain": "Relief", "High terrain": "Relief élevé", "CFIT": "CFIT",
"Deviate south improbable/critical now medium": "Dévier au sud → improbable/critique : moyen",
"Airspace, ATC, Airports": "Espace, ATC, AD", "High density altitude": "Altitude-densité élevée",
"Brief Smiths, depart Monday AM, shuttle Smiths to": "Briefer les Smith, partir lundi matin, les conduire à",
"Meeting deadlines for myself and Ms. Smith": "Délais à tenir (moi et Mme Smith)",
"Increased risk in all other categories": "Risque accru partout ailleurs",
"Personal & Business": "Perso. et pro.",
"KDRO, Add fuel stop improbable/negligible now low": "KDRO, escale carburant → improbable/négligeable : faible",
# ---- p48 : TEM
"Recognize": "Reconnaître", "Recover": "Récupérer", "Anticipate": "Anticiper", "Threats": "Menaces",
"Undesired": "État", "aircraft": "indésirable", "state": "de l’avion",
"Incident/": "Incident /", "Errors": "Erreurs", "Accident": "accident",
"Prevent": "Prévenir", "Trap": "Intercepter", "Mitigate": "Atténuer",
# ---- p52 : annonciateurs (inchangés) + légende
"Figure 7-3. Flight mode annunciators in green indicate the autopilot is engaged in heading “HDG” and altitude “ALT”":
  "Figure 7-3. En vert, les modes engagés du pilote automatique : cap « HDG » et altitude « ALT »,",
"mode, maintaining 9,000 feet MSL. The white “LOC” and “GS” annunciators indicate approach mode is armed but not":
  "maintien de 9 000 ft MSL. En blanc, « LOC » et « GS » : mode approche armé mais pas",
"engaged.": "encore engagé.",
# ---- p55 : 3P
"(Perceive)": "(Percevoir)", "Aeronautical": "Prise de", "Decision-": "décision", "Making": "aéronautique",
"(Process)": "(Analyser)", "(Perform)": "(Agir)",
# ---- p61-63
"Figure B-4. 3P process.": "Figure B-4. Méthode des 3P.",
"The DECIDE Model": "Le modèle DECIDE",
"Figure B-8. The DECIDE Model.": "Figure B-8. Le modèle DECIDE.",
}

json.dump(T, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'figtr.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(T), 'traductions')
