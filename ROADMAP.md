# Roadmap — Open Rails

> Éditeur de voies ferrées et simulateur de conduite sur canvas infini.
> React 18 + TypeScript + Vite, rendu Canvas 2D natif, sans bibliothèque de rendu ni d'état.
> Dernière version publiée : **v0.5.0**. Point d'étape du 2026-10-11, fait en relisant le code.

Ce fichier donne la vue d'ensemble. Le détail de chaque chantier est dans `tasks/plan-*.md`,
les défauts connus dans `tasks/todo.md`, l'organisation du code dans `CLAUDE.md`.

---

## 1. Où en est le projet

### Ce qui est livré, par version

| Version | Contenu |
| ------- | ------- |
| v0.1 | Canvas infini, voies droites et courbes à tangence continue, aiguillages et traversées, recherche de chemin, sections nommées automatiquement, échelles de modélisme et unités, export SVG / PNG / JSON, rame TGV, conduite simple |
| v0.2 | Flotte de rames (`TrainSet`), attelage et dételage, rames articulées Duplex et TGV M, collisions, verrouillage des aiguilles, barre de contexte, raccourcis réassignables |
| v0.3 | Traction et freinage réalistes (frein à air, frein électrique), console de conduite adaptative, premier pupitre sur téléphone, zones de vitesse, dévers et déraillement, signalisation à deux niveaux (cantons, réservations, vitesse en cabine), niveaux et rampes (ponts, tunnels), heurtoirs, niveaux de détail au dézoom et vue schéma, menu Exemples |
| v0.4 | Import OpenStreetMap intégré, longs rails et simplification du réseau, pupitre plein écran à deux pouces, affichages de signalisation refaits |
| v0.5 | Jeu de données « LGV France » (16 lignes, 57 gares) et fenêtre « Ligne entre gares… » avec chargement des lignes voisines à l'approche, gares lues d'OSM, projection Lambert-93, fusion et découpe de projets, accélération du temps, tableau de l'aiguilleur, salon à huit pupitres en WebRTC avec appairage par QR code |

### Ce que disait l'ancienne roadmap (arrêtée à la v0.1.0), confronté au code

Les phases 0 à 3 étaient cochées et le sont toujours. Pour les phases 4 à 9 :

| Ancien item | État réel | Remarque |
| ----------- | --------- | -------- |
| 4.1 Sections | Fait autrement | Sections déduites du graphe, seules leurs métadonnées sont stockées ; pas d'outil de fusion / scission, pas de type `Portal` |
| 4.2 Vitesse limite | Fait autrement | Zones de vitesse posées sur la voie, limite en courbe calculée du rayon et du dévers |
| 4.3 Occupation | Fait | Portée par les cantons de signalisation |
| 4.4 Signaux | Fait | Deux niveaux (standard, pro), aspect calculé |
| 4.5 Itinéraires | Partiel | Réservation devant la rame et verrouillage des aiguilles ; **pas d'itinéraire défini par l'utilisateur** → lot F |
| 5 Annuler / refaire | Fait | Par instantanés, 60 pas |
| 5 Copier / coller / dupliquer | À faire | Aucun presse-papiers |
| 6 Sauvegarde automatique et restauration | Fait | |
| 6 Import JSON | Partiel | Par le menu (remplacer ou ajouter au projet) ; pas de dépôt de fichier par glisser |
| 7 Raccourcis configurables | Fait | |
| 7 Tactile sur le canvas | Partiel | Pas de pincement à deux doigts ; le pupitre téléphone, lui, est entièrement tactile |
| 7 Panneau des aiguillages | Fait | Aiguillage et traversée-jonction double |
| 8 Simulation de circulation | Fait | Limites, signaux fermés, plusieurs rames |
| 8 Mesures automatiques | Fait | |
| 8 Calques | À faire | Seuls les niveaux de voie existent |
| 8 Bibliothèque de gabarits | Partiel | Gabarits intégrés et Exemples ; pas de gabarit enregistré par l'utilisateur |
| 8 Règles de validation | Partiel | Diagnostics cinématiques, rayon à la pose, pentes ; pas de moteur de règles unique |
| 8 Annotations | À faire | |
| 8 Élévation | Partiel | Niveaux, rampes, ponts et tunnels ; pas de vue en coupe |
| 9 État vide au premier lancement | À faire | → lot E |
| 9 Tutoriel | À faire | |
| 9 Performance sur grands réseaux | Fait | Index spatial, recalcul incrémental, niveaux de détail |
| 9 Responsive, documentation, favicon, accessibilité | Partiel | |

### Reste à faire hérité (hors programme ci-dessous)

- Essais sur de vrais téléphones (Wi-Fi puis 4G), relais TURN si la 4G échoue trop souvent — `plan-lignes-lgv-multijoueur.md`, `plan-console-conduite.md`
- Traversée-jonction double : dessin mécanique, export SVG, essai de conduite — `plan-traversee-jonction.md`
- Performance : couches statique / dynamique du canvas, cache des visuels de rame — `plan-perf-canvas.md`, `plan-grands-reseaux.md`
- Édition : copier / coller, calques, annotations, gabarits enregistrés, dépôt de fichier par glisser
- Contrôles à l'écran jamais faits par un humain et défauts connus — `tasks/todo.md`

---

## 2. Programme « Jeu de conduite sur le réseau réel »

Demande du 2026-10-11 : partir d'une gare, conduire sur le réseau réel chargé au fil du trajet,
avec une destination, des aides, et plus tard un pilote automatique.

Huit lots. Chacun se livre et se vérifie seul, sauf le lot G qui a besoin de l'itinéraire du lot F.

| Lot | Sujet | Déjà en place | Taille | Version visée |
| --- | ----- | ------------- | ------ | ------------- |
| D | Bogies visibles en conduite | **Fait**, à contrôler à l'écran | Petite | v0.6 |
| E | Mode bac à sable et écran de lancement | **Fait**, téléphone à essayer en vrai | Moyenne | v0.6 |
| F | Destination et itinéraire | Trajet ligne à ligne, plus court chemin sur les rails | Grande | v0.6 |
| G | Niveaux d'aide à la conduite | Tracé devant la rame sur 400 m, aiguilles à la main | Moyenne | v0.7 |
| A | Catégories de réseau et couleurs | Un booléen « grande vitesse » par ligne dans l'index | Moyenne | v0.7 |
| C | Vue d'ensemble grossière au dézoom | Quatre paliers de détail, vue schéma | Moyenne | v0.7 |
| B | Chargement et déchargement par morceaux | Chargement par ligne entière, jamais déchargé | Grande | v0.8 |
| H | Pilote automatique | Rien | Grande | Non planifié |

### Lot D — Bogies visibles en conduite

- **Constat.** Les bogies sont dessinés au palier Détail, mais la « vue de conduite épurée »
  (activée par défaut) rabat ce palier sur le palier Rails : en conduite on ne les voit jamais.
- **Fait le 2026-10-11.** Les bogies sont dessinés en conduite au palier Détail (écartement d'au
  moins 5 px à l'écran), vue épurée comprise. Les soufflets et l'inclinaison des caisses restent
  masqués en vue épurée.
- **Vérifié par.** Test du rendu en vue épurée (`lodTrains.test.ts`). Reste à voir à l'écran.

### Lot E — Mode bac à sable et écran de lancement

- **Constat.** L'application s'ouvre directement sur l'éditeur. Charger un trajet ne pose aucune
  rame et n'entre pas en conduite ; il faut poser la rame à la main puis prendre les commandes.
- **À faire.**
  1. Écran de lancement avec le premier mode de jeu, « Bac à sable » ; l'éditeur reste accessible.
  2. Choix de la gare de départ (recherche existante) et du train : TGV seul choix actif,
     TER affiché « bientôt disponible ».
  3. Chargement des zones autour de la gare avec progression, pose automatique de la rame à quai.
  4. Choix du poste : téléphone (QR code du salon existant) ou pupitre PC (bandeau, écran, leviers).
  5. Entrée directe en conduite.
- **Fait le 2026-10-11.** Fenêtre « Bac à sable » ouverte au lancement sur une page vierge, et
  par Fichier ▸ Nouvelle partie : gare de départ, train (TGV Duplex, TGV M, TER annoncé), lignes
  de la gare chargées, rame complète posée à quai tournée vers la sortie (à un terminus, conduite
  depuis la cabine opposée aux heurtoirs), puis choix du téléphone ou d'un pupitre de l'écran et
  entrée en conduite. Code : `application/game/sandbox.ts`, `domain/models/rakePlacement.ts`,
  `SandboxModal.tsx`.
- **Reste.** Le chemin « téléphone » n'a pas été essayé avec un vrai téléphone. Après la sortie
  de gare, les aiguilles se règlent encore à la main (lot G).
- **Vérifié par.** Parcours complet en navigateur sans tête, d'une page vierge à une rame qui roule
  à Marseille Saint-Charles ; pose d'une rame qui peut partir contrôlée dans les 57 gares du jeu
  de données (`tools/perf/measure-sandbox-stations.test.ts`).

### Lot F — Destination et itinéraire

- **Constat.** Une rame n'a pas de destination. Le trajet entre gares est cherché ligne à ligne
  (`routeThroughStations`), jamais rail à rail ; `findTrackPath` sait le faire entre deux points
  mais ne sert qu'aux outils de pose. L'ordre des étapes n'est contrôlé que par la connexité.
- **À faire.**
  1. Itinéraire d'une rame : départ, étapes, destination, stocké avec la rame.
  2. Chemin rail à rail de quai à quai sur le réseau chargé, prolongé à mesure qu'il se charge.
  3. Contrôle de l'ordre des étapes : refus d'un ordre infaisable, signalement d'un détour
     (étape qui oblige à revenir sur ses pas), proposition de l'ordre le plus court.
  4. Fenêtre en haut à droite en conduite : gare courante, prochaine étape, destination,
     distance restante ; ajout et retrait d'étapes en route.
  5. Champs correspondants dans `ConsoleState` et sa validation, pour le pupitre téléphone.
- **Vérifié par.** Tests du chemin sur le jeu LGV (Marseille → Paris, avec et sans étape à Lyon),
  tests de l'ordre des étapes.

### Lot G — Niveaux d'aide à la conduite

- **Constat.** Le tracé affiché devant la rame suit les aiguilles telles qu'elles sont, sur 400 m.
  Les aiguilles se manœuvrent à la main.
- **À faire.** Un réglage d'aide à trois crans : *complète* (itinéraire surligné jusqu'à la
  prochaine étape, aiguilles orientées automatiquement devant la rame), *guidage* (itinéraire
  surligné, aiguilles à la main, alerte si l'aiguille devant mène hors de l'itinéraire),
  *aucune*. L'orientation automatique respecte le verrouillage et les réservations existants.
- **Dépend de.** Lot F.
- **Vérifié par.** Tests : une rame en aide complète arrive à destination sans manœuvre manuelle.

### Lot A — Catégories de réseau et couleurs

- **Constat.** Le modèle ne connaît qu'un type de ligne pour tout le projet (`lineType`) et l'index
  un booléen `highSpeed` par ligne. Au dézoom tous les rails ont la même couleur.
  Le jeu de données ne contient que les LGV et leurs raccordements.
- **Précision.** TER et Intercités sont des services, pas des voies : la catégorie portée par la
  voie sera celle de l'infrastructure (grande vitesse, ligne classique principale, ligne
  régionale, raccordement et voies de service), déduite des attributs OSM (`highspeed`, `usage`,
  `maxspeed`, `service`).
- **À faire.**
  1. Catégorie par ligne dans l'index et par section dans le projet, lue à l'import OSM.
  2. Une couleur par catégorie aux paliers Ligne et Schéma, avec légende ; aspect inchangé de près.
  3. Extension du jeu de données aux lignes classiques (régénération hors CI), par régions.
- **Vérifié par.** Tests de classement sur des extraits OSM, test du rendu par catégorie,
  mesure d'une image au dézoom avant et après.

### Lot C — Vue d'ensemble grossière au dézoom

- **Constat.** Un système équivalent existe pour ce qui est chargé : quatre paliers (Détail,
  Rails, Ligne, Schéma), et au palier Schéma une polyligne par section dont les points à moins
  d'un pixel sont écartés à chaque image. **Il ne couvre pas la demande sur deux points** : rien
  n'est dessiné pour le réseau non chargé, et la simplification ne réduit pas la géométrie stockée.
- **À faire.**
  1. Tracé simplifié de chaque ligne dans l'index (quelques centaines de points par ligne,
     calculé à la génération du jeu de données), dessiné pour les lignes non chargées.
  2. Au plus large, points grossiers pour les gares et trait unique par ligne, voies parallèles
     confondues.
  3. Minimap dessinée à partir de ces mêmes tracés.
- **Vérifié par.** Mesure d'une image France entière ; test du tracé simplifié (écart maximal borné).

### Lot B — Chargement et déchargement par morceaux

- **Constat.** L'unité chargée est une ligne entière (54 ko à 1,1 Mo). Une ligne est chargée
  quand une rame arrive à 5 km d'un raccordement. **Rien n'est jamais déchargé**, chaque ajout
  refond tous les fichiers déjà tenus, et il n'y a aucun cache hors mémoire.
- **À faire.**
  1. Découpe du jeu de données en dalles sur une grille fixe en Lambert-93 (génération), rails
     coupés aux bords avec des nœuds de couture stables.
  2. Gestionnaire de dalles : charge celles qui entourent chaque rame et celles de son
     itinéraire devant elle ; décharge celles qui sont loin de toute rame, avec une marge pour
     éviter les allers-retours. Une dalle occupée par une rame n'est jamais déchargée.
  3. Ajout et retrait d'une dalle en place, sans refondre le reste.
  4. Cache local des dalles (IndexedDB) avec version du jeu de données.
  5. Signaux, cantons et réservations aux bords d'une dalle absente : voie fermée, jamais vide.
- **Vérifié par.** Trajet Marseille → Paris automatisé : mémoire et nombre de rails bornés,
  aucune rame sur une dalle déchargée ; mesure du temps d'ajout et de retrait d'une dalle.

### Lot H — Pilote automatique (non planifié)

Inscrit au plan, **affecté à aucune version**. Une rame conduite par le jeu : tenue de la
vitesse limite, freinage de service vers un signal ou une limite, arrêt à quai, suivi d'un
itinéraire. S'appuiera sur les lots F et G. Il ouvrira aussi les trains pilotés par le jeu
(circulation autour du joueur) et le régulateur de vitesse du TGV.

### Ordre

1. **v0.6 — Bac à sable** : D, puis E, puis F. On peut lancer une partie et savoir où l'on va.
2. **v0.7 — Lisibilité et aides** : G, A (étapes 1 et 2), C.
3. **v0.8 — Grand réseau** : B, puis A étape 3 (lignes classiques, qui n'ont de sens qu'une fois
   le déchargement en place).

---

## 3. Règles qui ne changent pas

- Le réseau reste un seul graphe ; sections, signaux, zones et itinéraires l'annotent.
- `domain/` sans dépendance ; pas de bibliothèque de rendu ni d'état.
- Sur le rendu, la performance d'abord : l'aspect de près ne change pas sans demande explicite.
- Tout ce qui est gardé du réseau d'une image à l'autre se recalcule par différence, avec son oracle en test.
- Chaque lot se mesure avant et après (`npm run bench`, `tools/perf/`).
