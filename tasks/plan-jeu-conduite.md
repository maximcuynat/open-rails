# Jeu de conduite sur le réseau réel — suivi

Programme demandé le 2026-10-11 (bac à sable, itinéraire, aides, réseau chargé par morceaux,
couleurs par type de ligne, lignes classiques). La vue d'ensemble est dans `ROADMAP.md` § 2 ;
ce fichier dit où on en est et ce qui reste, en petits lots.

État au 2026-10-12 : tout est fusionné dans `developement` (branches `feature/jeu-conduite` puis
`feature/modes-jeu`), rien n'est publié. Ce fichier sert de base au plan de la prochaine version.

## Fait

- [x] **D** — Bogies visibles en conduite
- [x] **E** — Bac à sable : gare de départ, train, rame posée à quai, choix du pupitre
- [x] **F** — Destination, étapes à l'ordre logique, chemin rail à rail, fenêtre d'itinéraire
- [x] Jeu de données : raccordements de Paris et de Lyon nord reliés à leurs lignes
- [x] **G** — Aide à trois crans : aiguilles automatiques, chemin tracé, guidage
- [x] **C** — Lignes non chargées dessinées au dézoom, minimap du réseau entier
- [x] **A** (étapes 1 et 2) — Couleur par type de ligne et légende
- [x] **B** — Lignes coupées en morceaux de 40 km, chargés et déchargés en roulant
- [x] **A** (étape 3, pilote) — Lignes classiques de Provence-Alpes-Côte d'Azur
- [x] Étapes : quai traversant, rebroussement en terminus, rame tournée vers son chemin
- [x] **H** — Pilote automatique : vitesse, limites, signaux, arrêt à quai, arrêts en gare
- [x] Trajet choisi au temps de parcours (la LGV plutôt que la ligne classique à côté)
- [x] **M1** — TER Régiolis 4 caisses (quatre voitures sur cinq bogies, 160 km/h), au choix dans le bac à sable
- [x] Trajets selon le train : sans signalisation de cabine, pas de ligne à grande vitesse
- [x] Plusieurs trains : ajouter un train à la partie en cours (gare, ou clic sur la voie)
- [x] Vue libre : quitter un train laissé au pilote automatique, en reprendre un, en poser un autre ; aucun outil de voie tant que des trains roulent
- [x] Composition au choix : TGV de 5 voitures à la rame complète ou deux rames accouplées, TER de 3, 4 ou 6 caisses ou deux unités
- [x] Indication avant le lancement : la rame tient-elle sur les voies de la gare (longueur entre aiguilles)
- [x] Vue libre : le clic gauche maintenu déplace la vue
- [x] Modes de jeu (`tasks/plan-modes-jeu.md`) : pause sur Échap et Espace, sortie de la conduite
      qui garde vitesses, manettes et pilotes, sélecteur « Édition | Jeu », réseau réel sans mode
      édition (atteler, dételer, retirer un train en jeu), partie retrouvée après un rechargement
- [x] Fenêtre du bac à sable : le message de longueur de rame ne clignote plus
- [x] QA du 2026-10-16 (gstack, navigateur sans tête, branche `fix/qa-jeu`) : 8 défauts corrigés —
      ligne regardée gardée en vue libre, plus de « quitter » qui met en pause sur réseau réel,
      Échap laissé aux fenêtres ouvertes, panneau d'itinéraire au-dessus de l'écran de bord, textes.
      Rapport : `.gstack/qa-reports/qa-report-localhost-2026-10-16.md` (non versionné)
- [x] Par une autre session, sur la même branche : temps de trajet estimé dans la fenêtre
      d'itinéraire, cause du signal fermé au pupitre, courbes d'import compatibles avec la
      vitesse de la ligne

## En cours, non commité (autres sessions)

- Voie unique et croisements — `tasks/plan-voie-unique.md` (`crossingRules.ts`, `routeGuide.ts`,
  `trackPath.ts`, `itinerary.ts`) : typage et tests passent, à commiter.
- Bogies près d'un pont (`renderer.ts`, `trackLevels.test.ts`) : à commiter.

## Reste, en petits lots

Chaque lot se livre seul : fait, vérifié, commité, avant de passer au suivant.

### Lignes classiques, une région par lot

Marche à suivre pour une région : l'ajouter à `regions` dans `tools/lgv-dataset/manifest.json`,
`node tools/lgv-dataset/run.mjs`, puis `measure-sandbox-stations` (une rame se pose et part de
chaque gare) et `measure-itinerary` sur deux trajets de la région, relever le poids et le temps.

L'essai « toute la France d'un coup » du 2026-10-11 n'a pas abouti : les serveurs
d'OpenStreetMap refusent de répondre après une grosse requête. Sept régions sont arrivées et
sont en cache ; la conversion du pays entier n'a jamais tourné, son temps et sa mémoire sont
donc inconnus (PACA seule : 90 s ; la machine a 11 Go).

- [ ] **R1** — Auvergne-Rhône-Alpes (en cache) : relie Lyon, la LGV Rhône-Alpes et PACA
- [ ] **R2** — Île-de-France (en cache) : la plus dense, à surveiller pour le poids
- [ ] **R3** — Bourgogne-Franche-Comté (en cache)
- [ ] **R4** — Hauts-de-France (en cache)
- [ ] **R5** — Grand Est (en cache)
- [ ] **R6** — Centre-Val de Loire (en cache)
- [ ] **R7** — Bretagne (en cache)
- [ ] **R8** — Occitanie (à télécharger)
- [ ] **R9** — Nouvelle-Aquitaine (à télécharger)
- [ ] **R10** — Pays de la Loire (à télécharger)
- [ ] **R11** — Normandie (à télécharger)

À décider en route : si la conversion de plusieurs régions ensemble ne tient pas en mémoire,
convertir région par région et réunir les résultats. La Corse est en voie métrique
(`railway=narrow_gauge`) : hors de ce jeu de données.

### Pupitre téléphone

- [ ] **T1** — Afficher l'itinéraire sur le pupitre (le champ `route` arrive déjà, validé)
- [ ] **T2** — Régler l'aide depuis le pupitre
- [ ] **T3** — Essai sur de vrais téléphones du lancement « bac à sable ▸ téléphone »

### Trains

- [ ] **M2** — Matériel Intercités (une locomotive et des voitures Corail : pas articulé, à voir avec le modèle de rame)
- [ ] **M3** — Autres TER (Régiolis 6 caisses, Regio 2N) : des fiches de plus
- [ ] **M4** — Livrée propre au TER (il est dessiné comme les TGV, aux proportions près)
- [ ] **M5** — Électrification : le jeu ne sait pas quelles lignes ont une caténaire

### Divers

- [ ] **O1** — Catégorie de ligne lue à un import OpenStreetMap ordinaire (couleurs hors jeu de données)
- [ ] **O2** — Grille plus fine en zone dense (l'entrée de Paris est un morceau de 1 Mo)
- [ ] **O3** — Décharger aussi hors conduite ; ne plus charger tout un trajet dans « Ligne entre gares »
- [ ] **O4** — Une gare traversée sans arrêt n'est pas comptée comme desservie

### Composition et quais, suites

- [ ] **Q1** — Longueur réelle des quais : la lire d'OpenStreetMap (`railway=platform`) à l'import.
      Aujourd'hui l'indication mesure la voie entre deux aiguilles, pas le quai : dans une halte
      en pleine ligne, elle dit « tient » même si le quai est court.
- [ ] **Q2** — Choisir la composition aussi pour un train posé au clic en vue libre (rame complète seulement)

### Plusieurs trains, suites

- [x] **V1** — Réglé autrement : Échap met en pause, quitter la conduite ne remet plus rien à zéro, et la partie reprend d'où elle était (`tasks/plan-modes-jeu.md`)
- [ ] **V2** — Donner un itinéraire à un train posé sur la voie hors d'une gare (il n'a pas de gare de départ)

### Modes de jeu, finitions

- [x] **J1** — Sur un réseau réel, les boutons ⏹ (barre d'outils) et ✕ (console) disaient « quitter » et mettaient en pause : retirés (QA du 2026-10-16)
- [ ] **J2** — Dire la pause au pupitre téléphone (champ à ajouter à `ConsoleState` et à `protocol.ts`)
- [ ] **J3** — Un train laissé en marche dont la voie est modifiée en édition : le remettre à l'arrêt
- [ ] **J4** — Après un rechargement : temps d'arrêt en gare du pilote, train déraillé ou en survitesse

### Voie unique, suites (`tasks/plan-voie-unique.md`)

- [ ] **U1** — Une place à l'arrivée : ne s'engager vers un évitement que s'il y restera une voie libre
- [ ] **U2** — Réseau sans signaux : le pilote ne sait pas se protéger seul
- [ ] **U3** — Nice – Breil, Cannes – Grasse
- [ ] **U4** — Train parti de Château-Arnoux qui n'a gardé que Sisteron dans son itinéraire, sans message

### Pilote automatique, suites

- [x] **P1** — Sur LGV, ne plus ralentir à l'excès devant ce que le signal de cabine annonce
- [x] **P2** — Le commander depuis le pupitre téléphone (bouton « Pilote », à essayer sur un vrai téléphone)
- [x] Manipulateur de B10 à P10, conduite du pilote cran par cran, arrêt à quai d'un seul freinage — `tasks/plan-pilote-crans.md`
- [ ] **P3** — Trains pilotés par le jeu autour du joueur

## À contrôler à l'écran

Vérifié en navigateur sans tête et par les tests, jamais par un humain :

- [ ] Fenêtre « Bac à sable » au lancement, et son ouverture à chaque projet vide
- [ ] Bogies en conduite, de près
- [ ] Fenêtre d'itinéraire : ajout et retrait d'étapes, arrivée à quai
- [ ] Aide complète sur un trajet entier jusqu'à une gare d'arrivée
- [ ] Couleurs et légende au dézoom, thème sombre compris
- [ ] Morceaux qui arrivent et partent en roulant, sans à-coup visible
- [ ] Pilote automatique sur un trajet entier, et sa coupure dès qu'on touche une manette
- [ ] Échelle à 21 crans du bandeau et des manettes, touche maintenue qui s'arrête sur N
- [ ] Bouton « Pilote » du pupitre téléphone
- [ ] Pause (Échap, Espace, bouton ⏸), bandeau « En pause », reprise
- [ ] Quitter la conduite puis « Reprendre » ; « Tout remettre à l'arrêt » ; sélecteur « Édition | Jeu »
- [ ] Atteler, dételer et retirer un train en jeu sur un réseau réel
- [ ] Partie retrouvée après un rechargement de la page, en vue libre comprise
- [ ] Choix de la composition et message de longueur dans la fenêtre du bac à sable
- [ ] Plusieurs trains : en ajouter un, quitter le sien, vue libre au clic gauche
