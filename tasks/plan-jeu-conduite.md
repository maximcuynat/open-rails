# Jeu de conduite sur le réseau réel — suivi

Programme demandé le 2026-10-11 (bac à sable, itinéraire, aides, réseau chargé par morceaux,
couleurs par type de ligne, lignes classiques). La vue d'ensemble est dans `ROADMAP.md` § 2 ;
ce fichier dit où on en est et ce qui reste, en petits lots.

Branche : `feature/jeu-conduite` (poussée). Rien n'est fusionné dans `developement`.

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
- [x] Par une autre session, sur la même branche : temps de trajet estimé dans la fenêtre
      d'itinéraire, cause du signal fermé au pupitre, courbes d'import compatibles avec la
      vitesse de la ligne

## En cours, non commité

- `tools/lgv-dataset/build.ts` : un fichier de ligne est daté par ses données et non par l'heure
  de génération, pour qu'une régénération sur les mêmes données ne change aucun fichier.

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

- [ ] **M1** — Matériel TER (annoncé « bientôt disponible » dans le bac à sable)
- [ ] **M2** — Matériel Intercités

### Divers

- [ ] **O1** — Catégorie de ligne lue à un import OpenStreetMap ordinaire (couleurs hors jeu de données)
- [ ] **O2** — Grille plus fine en zone dense (l'entrée de Paris est un morceau de 1 Mo)
- [ ] **O3** — Décharger aussi hors conduite ; ne plus charger tout un trajet dans « Ligne entre gares »
- [ ] **O4** — Une gare traversée sans arrêt n'est pas comptée comme desservie

### Pilote automatique, suites

- [ ] **P1** — Sur LGV, ne plus ralentir à l'excès devant ce que le signal de cabine annonce
- [ ] **P2** — Le commander depuis le pupitre téléphone
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
