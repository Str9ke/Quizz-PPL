# Le Manoir de l'Enfer — Phase 1

Tranche verticale jouable : porche/hall → couloir avec créature → porte
fermée à clé (non franchissable) → salle à manger (scène narrative fixe).

## Ouvrir le projet

1. Ouvrir Godot 4.x (Godot 4.3+ recommandé).
2. "Importer", pointer sur `manoir-enfer/project.godot`.
3. Lancer le projet (F5) : la scène `Main.tscn` charge automatiquement le hall.

> Ce projet a été écrit à la main (aucun éditeur Godot n'était disponible
> dans l'environnement où il a été créé) : les fichiers `.tscn`/`.gd`
> suivent le format texte standard de Godot 4, mais n'ont pas encore été
> ouverts/testés dans l'éditeur. À valider en premier lieu à l'ouverture.

## Contrôles

- Déplacement : flèches directionnelles.
- Interagir avec la porte verrouillée : `Entrée` / `Espace` (action
  `ui_accept`) une fois à proximité.

## Ce qui est en place

- `scripts/player.gd` : déplacement du personnage (`CharacterBody2D`).
- `scripts/map_tracker.gd` (autoload `MapTracker`) : mémorise les pièces
  visitées, émet `room_visited` (la carte se remplit automatiquement,
  sans UI de carte dédiée pour l'instant — hors scope Phase 1).
- `scripts/fear_meter.gd` (autoload/scène `FearMeter`) : jauge de Peur
  affichée à l'écran, plafond tiré aléatoirement (1d6+6) comme dans le
  livre, augmente sur événements scriptés (créature repérée, choix au
  dîner).
- `scripts/creature_patrol.gd` : patrouille aller-retour + détection du
  joueur dans un rayon, utilisée par la créature du couloir.
- `scripts/room_zone.gd`, `scripts/scene_door.gd`, `scripts/locked_door.gd` :
  petits scripts génériques et réutilisables (détection d'entrée dans une
  pièce, changement de scène en franchissant une porte, message
  "c'est verrouillé" sur la porte fermée à clé) — non listés explicitement
  dans le CLAUDE.md d'origine mais nécessaires pour faire fonctionner les
  systèmes demandés sans dupliquer de code entre les pièces.
- `scenes/rooms/Hall.tscn`, `Couloir.tscn`, `SalleAManger.tscn` : les trois
  pièces de la tranche verticale, plus `Main.tscn` comme point d'entrée.

## Prochaine étape

Une fois cette tranche testée bout en bout dans l'éditeur (mouvement,
collisions, détection de la créature, porte verrouillée, transition vers
la scène narrative), s'arrêter et évaluer avant d'attaquer la Phase 2
(combat aux dés complet, reste du manoir, fins multiples, inventaire).
