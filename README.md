# Quizz-PPL

Quiz PPL d’aviation – repo contenant le quiz, ses données et ses scripts.

## Arborescence

├── index.html  
├── quiz.html  
├── stats.html  
├── style.css  
├── script.js  
├── README.md  
├── section_easa_procedures_new.json  
├── section_easa_aerodynamique.json  
├── section_easa_connaissance_avion.json  
├── section_easa_meteorologie.json  
├── section_easa_navigation.json  
├── section_easa_performance_planification.json  
├── section_easa_reglementation.json  
├── questions_procedure_radio.json  
├── questions_procedure_operationnelles.json  
├── questions_reglementation.json  
├── questions_instrumentation.json  
├── questions_masse_et_centrage.json  
├── questions_motorisation.json  
├── IMAGES_EASA_PROCEDURE/  
├── IMAGES_EASA_REGLEMENTATION/  
├── IMAGES_EASA_AERODYNAMIQUE/  
├── IMAGES_EASA_CONNAISSANCE_AVION/  
├── IMAGES_EASA_METEOROLOGIE/  
├── IMAGES_EASA_NAVIGATION/  
├── IMAGES_EASA_PERFORMANCE_PLANIFICATION/  
└── IMAGES_EASA_PERF_HUMAINE/

## Détails des dossiers

### IMAGES_EASA_PROCEDURE/
Liste des fichiers d’illustration des questions EASA Procedures :
- manifest.json  
- EASA_PROCEDURE25.jpg  

### IMAGES_EASA_REGLEMENTATION/
Liste des fichiers d’illustration des questions EASA Réglementation :
- manifest.json  
- EASA_REGLEMENTATTION89.jpg
- EASA_REGLEMENTATTION90.jpg
- EASA_REGLEMENTATTION91.jpg
- EASA_REGLEMENTATTION92.jpg

### IMAGES_EASA_AERODYNAMIQUE/
Liste des fichiers d’illustration des questions EASA Aérodynamique :
- manifest.json  
- EASA_AERODYNAMIQUE11.jpg
- EASA_AERODYNAMIQUE15.jpeg
- EASA_AERODYNAMIQUE18.jpg
- EASA_AERODYNAMIQUE26.jpg
- EASA_AERODYNAMIQUE36.jpg
- EASA_AERODYNAMIQUE66.jpg
- EASA_AERODYNAMIQUE95.jpg

### IMAGES_EASA_CONNAISSANCE_AVION/
Liste des fichiers d’illustration des questions EASA Connaissance Avion :
- manifest.json  
- EASA_CONNAISSANCE_AVION04.jpeg
- EASA_CONNAISSANCE_AVION06.jpeg
- EASA_CONNAISSANCE_AVION16.jpg
- EASA_CONNAISSANCE_AVION18.jpeg
- EASA_CONNAISSANCE_AVION22.jpeg
- EASA_CONNAISSANCE_AVION48.jpg
- EASA_CONNAISSANCE_AVION49.jpg
- EASA_CONNAISSANCE_AVION65.jpg

### IMAGES_EASA_METEOROLOGIE/
Liste des fichiers d’illustration des questions EASA Météorologie :
- manifest.json  
- EASA_METEOROLOGIE56.jpg
- EASA_METEOROLOGIE57.jpg
- EASA_METEOROLOGIE58.jpg
- EASA_METEOROLOGIE70.jpg

### IMAGES_EASA_NAVIGATION/
Liste des fichiers d’illustration des questions EASA Navigation :
- manifest.json  
- EASA_NAVIGATION110.jpg
- EASA_NAVIGATION06.jpg
- EASA_NAVIGATION40.jpg
- EASA_NAVIGATION47.jpg
- EASA_NAVIGATION49.jpg
- EASA_NAVIGATION64.jpeg
- EASA_NAVIGATION84.jpg
- EASA_NAVIGATION85.jpg
- EASA_NAVIGATION121.jpeg
- EASA_NAVIGATION122.jpg

### IMAGES_EASA_PERFORMANCE_PLANIFICATION/
Liste des fichiers d’illustration des questions EASA Performance et Planification :
- manifest.json  
- Performanceplanification26.jpg
- Performanceplanification31.jpg
- Performanceplanification32.jpg
- Performanceplanification33.jpg
- Performanceplanification34.jpg
- Performanceplanification35.jpg
- Performanceplanification36.jpg
- Performanceplanification48.jpg
- Performanceplanification49.jpg
- Performanceplanification50.jpg
- Performanceplanification53.jpg
- Performanceplanification55.jpg
- Performanceplanification58.jpg
- Performanceplanification59.jpg
- Performanceplanification60.jpg
- Performanceplanification61.jpg
- Performanceplanification62.jpg
- Performanceplanification64.jpg
- Performanceplanification66.jpg
- Performanceplanification68.jpg
- Performanceplanification69.jpg
- Performanceplanification72.jpg
- Performanceplanification78.jpg
- Performanceplanification81.jpg
- Performanceplanification82.jpg
- Performanceplanification84.jpg
- Performanceplanification85.jpg
- Performanceplanification93.jpg
- Performanceplanification99.jpg
- Performanceplanification100.jpg
- Performanceplanification101.jpg

## Dossier d'images

Un dossier nommé **IMAGES_EASA_PERF_HUMAINE** a été ajouté à la racine.  
Il contient les images suivantes:
- image55.jpg
- image56.jpeg

## Fichiers principaux

- **index.html** : page d’accueil et d’authentification  
- **quiz.html** : affichage du quiz  
- **stats.html** : affichage des statistiques  
- **style.css** : styles globaux  
- **script.js** : logique du quiz et intégration Firestore

## Sécurité — Clés API 🔐

- Les clés sensibles ne doivent jamais être commitées en clair dans le dépôt. Le projet lit désormais la clé Firebase depuis `window.FIREBASE_CONFIG` si présent (voir `config.example.js`).
- Procédure recommandée après une fuite :
  1. **Révoquer / régénérer** la clé compromise dans la console Google Cloud immédiatement.
  2. Remplacer la clé dans votre environnement local (`config.js`) et **ne pas** committer `config.js`.
  3. Nettoyer l'historique Git si nécessaire (ex : `git filter-repo` ou BFG) — voir la doc Google/GitHub pour la procédure complète.
  4. Ajouter des **restrictions** (référents HTTP, IPs, APIs autorisées) à la clé dans la console GCP.

Si vous voulez, je peux :
- générer les commandes `git filter-repo` / BFG pour supprimer la clé de l'historique, ou
- vous guider pas à pas pour régénérer et restreindre la clé dans Google Cloud.
