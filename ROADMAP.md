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
| F | Destination et itinéraire | **Fait** | Grande | v0.6 |
| G | Niveaux d'aide à la conduite | **Fait** | Moyenne | v0.7 |
| A | Catégories de réseau et couleurs | **Fait** pour le jeu de données ; import OSM à faire | Moyenne | v0.7 |
| C | Vue d'ensemble grossière au dézoom | **Fait** | Moyenne | v0.7 |
| B | Chargement et déchargement par morceaux | **Fait** | Grande | v0.8 |
| H | Pilote automatique | **Fait** | Grande | v0.8 |

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
- **Fait le 2026-10-11.**
  1. Itinéraire porté par la rame (`TrainSet.itinerary`), enregistré avec elle.
  2. Chemin rail à rail jusqu'au quai de la prochaine gare, ou jusqu'au raccordement vers la
     ligne suivante tant qu'elle n'est pas chargée ; recalculé quand la voie change ou que la rame
     quitte le chemin (`domain/services/routeGuide.ts`, `findTrackPathToAny`).
  3. Ordre des étapes tenu logique par construction : une gare ajoutée se place là où elle
     allonge le moins le trajet (entre Marseille et Paris, Lyon se met entre les deux ; Lille se
     met après Paris). Une gare qu'aucune ligne ne relie est refusée.
  4. Fenêtre « Itinéraire » en haut à droite en conduite : gare quittée, prochaine gare avec sa
     distance et sa voie, étapes à venir, ajout et retrait en route, arrivée constatée à l'arrêt
     à quai.
  5. Champ `route` dans `ConsoleState` et sa validation ; **pas encore affiché** sur le pupitre
     téléphone.
- **Vérifié par.** Tests (`itinerary.test.ts`, `routeGuide.test.ts`, `application/game/`), parcours
  en navigateur sans tête, et le jeu de données réel
  (`tools/perf/measure-itinerary.test.ts`) : Marseille → Avignon TGV → Lyon Part-Dieu trouvé rail
  à rail (325 km, 50 à 140 ms de recherche, mesure de la distance restante en 0,004 ms).
- **Étapes et quais (2026-10-12).** À une gare d'étape la rame vise un quai d'où elle peut
  repartir : un quai traversant sur le chemin de la gare suivante, ou, dans un terminus, un quai
  relié à la sortie vers elle (elle y change de cabine). Avant, elle visait le quai le plus
  proche, parfois une voie en impasse. Sous l'aide complète, une rame à l'arrêt envoyée dans le
  sens opposé à celui où elle est posée change de cabine toute seule.
- **Défaut du jeu de données, corrigé le 2026-10-12.** Paris Gare de Lyon et le nord de Lyon
  Part-Dieu étaient injoignables par le rail : les couloirs des raccordements s'écartaient de la
  voie (jusqu'à 740 m à Paris, 4 km à Lyon nord, pour un rayon de 400 m) et le raccordement de
  Paris sortait en 12 morceaux. Couloirs recalculés le long du chemin réel, voies de jonction
  et communications incluses, jeu de données régénéré. Marseille → Paris : 747 km trouvés rail à
  rail ; un test garde la continuité Marseille ↔ Lyon ↔ Paris (`dataset.samples.test.ts`).

### Lot G — Niveaux d'aide à la conduite

- **Constat.** Le tracé affiché devant la rame suit les aiguilles telles qu'elles sont, sur 400 m.
  Les aiguilles se manœuvrent à la main.
- **Fait le 2026-10-11.** Réglage « Aide » à trois crans dans la fenêtre d'itinéraire, mémorisé
  d'une session à l'autre :
  - *Complète* (par défaut) : chemin tracé sur la voie jusqu'à la prochaine gare, aiguilles
    orientées automatiquement devant la rame (2 km au moins, 45 s de marche à grande vitesse).
    Une aiguille occupée ou réservée pour une autre rame est laissée telle quelle.
  - *Guidage* : chemin tracé, aiguilles à la main ; la fenêtre signale l'aiguille orientée hors
    du chemin et sa distance.
  - *Aucune* : ni tracé ni aiguilles.
- **Vérifié par.** Tests des trois crans (`application/game/itinerary.test.ts`), et en navigateur
  sans tête : au départ de Marseille vers Avignon TGV, 8 aiguilles orientées sans intervention,
  la rame reste sur le chemin, la LGV se charge en route, aucun signal franchi fermé.
- **Reste.** L'aide n'est pas affichée ni réglable depuis le pupitre téléphone. Elle ne tient
  pas la vitesse : la limite reste à respecter à la main (une rame lancée à fond déraille en
  sortie de gare) — c'est le pilote automatique, lot H.

### Lot A — Catégories de réseau et couleurs

- **Constat.** Le modèle ne connaît qu'un type de ligne pour tout le projet (`lineType`) et l'index
  un booléen `highSpeed` par ligne. Au dézoom tous les rails ont la même couleur.
  Le jeu de données ne contient que les LGV et leurs raccordements.
- **Précision.** TER et Intercités sont des services, pas des voies : la catégorie portée par la
  voie sera celle de l'infrastructure (grande vitesse, ligne classique principale, ligne
  régionale, raccordement et voies de service), déduite des attributs OSM (`highspeed`, `usage`,
  `maxspeed`, `service`).
- **Fait le 2026-10-12 (étapes 1 et 2, pour les projets du jeu de données).**
  1. Catégorie par ligne dans l'index (`IndexLine.category` : grande vitesse, classique,
     régionale, raccordement et service ; le jeu actuel n'a que les deux premières).
  2. Aux paliers Ligne et Schéma, chaque voie chargée prend la couleur de la catégorie de sa
     ligne ; de près (paliers Rails et Détail) rien ne change. Légende en bas à gauche.
- **Reste.**
  - Un import OpenStreetMap ordinaire n'a pas de catégorie : il faut la lire des attributs à
    l'import et la garder par section.
  - Étape 3, **commencée le 2026-10-12 par une région pilote** : Provence-Alpes-Côte d'Azur.
    Le manifeste nomme une région (`regions`), le générateur en prend toutes les voies de
    circulation et nomme chaque ligne d'après sa relation OpenStreetMap (« Ligne de
    Marseille-Saint-Charles à Vintimille »…), principale ou régionale selon ses voies. 17 lignes
    classiques, 1 860 km de voie, 142 gares de plus (200 en tout) ; le jeu passe de 9 à 15 Mo et
    sa génération de 30 à 90 s. Trajets vérifiés rail à rail : Marseille → Toulon → Nice,
    Marseille → Briançon, Nice → Toulon → Marseille → Avignon → Lyon (rebroussement à
    Saint-Charles), Nice → Paris (971 km).
  - Les autres régions restent à ajouter une à une. Ordre de grandeur : l'Île-de-France a deux
    fois plus de voies que PACA ; la France entière pèserait autour de 100 Mo, à décider avant
    de continuer (dépôt, temps de génération).
  - Les trains restent des TGV : pas encore de matériel TER ou Intercités.
- **Vérifié par.** Tests du rendu par palier (`lodTracks.test.ts`), et en navigateur.

### Lot C — Vue d'ensemble grossière au dézoom

- **Constat.** Un système équivalent existe pour ce qui est chargé : quatre paliers (Détail,
  Rails, Ligne, Schéma), et au palier Schéma une polyligne par section dont les points à moins
  d'un pixel sont écartés à chaque image. **Il ne couvre pas la demande sur deux points** : rien
  n'est dessiné pour le réseau non chargé, et la simplification ne réduit pas la géométrie stockée.
- **Fait le 2026-10-12.**
  1. Tracé simplifié de chaque ligne dans l'index (`lineOutline` : le plus long chemin de la
     ligne, puis ses branches, une voie valant pour toutes celles qui la longent ; écart maximal
     de 40 m). 16 lignes en 2 000 points, l'index passe de 25 à 55 ko.
  2. Les lignes non chargées sont dessinées à partir de ces tracés, à tout zoom, avec leurs
     gares : la France des LGV est visible dès le lancement, avec une seule gare chargée.
  3. La minimap d'un projet du jeu de données montre tout le réseau, les lignes non chargées
     par leur tracé.
- **Reste.** Les lignes *chargées* gardent leur dessin par section au palier Schéma : à ce zoom
  deux voies parallèles sont déjà à moins d'un pixel, le gain serait de temps de calcul, pas
  d'aspect. Une image tient dans 16,7 ms (limite de l'écran) aux trois zooms essayés.
- **Vérifié par.** Tests (`lineOutline.test.ts`, `datasetOverview.test.ts`), et en navigateur.

### Lot B — Chargement et déchargement par morceaux

- **Constat.** L'unité chargée est une ligne entière (54 ko à 1,1 Mo). Une ligne est chargée
  quand une rame arrive à 5 km d'un raccordement. **Rien n'est jamais déchargé**, chaque ajout
  refond tous les fichiers déjà tenus, et il n'y a aucun cache hors mémoire.
- **Fait le 2026-10-12.**
  1. Chaque ligne est découpée en morceaux sur une grille de 40 km (`tools/lgv-dataset/pieces.ts`).
     Un rail va entier au morceau où tombe son milieu : rien n'est coupé, une frontière tombe
     toujours sur un nœud, comme entre deux lignes. 16 lignes deviennent 77 morceaux (médiane
     347 rails et 82 ko ; le plus gros, l'entrée de Paris, 4 235 rails et 1 Mo). Un morceau est
     pour l'application ce qu'était une ligne : un fichier, une entrée de l'index.
  2. En conduite, une fois par seconde : un morceau est chargé quand une rame arrive à 5 km de
     sa jonction, et déchargé quand toutes les rames en sont à plus de 20 km. Un morceau où se
     trouve un véhicule n'est jamais déchargé, ni un morceau en cours de téléchargement.
  3. Ajout et retrait en place, la conduite continue. Les arrivées et départs sont silencieux.
  4. Un projet enregistré avant la découpe se recharge : une ligne entière vaut pour ses morceaux.
- **Mesuré** en navigateur, Marseille vers Lyon à vitesse de ligne sur 130 km : 4 morceaux
  chargés, 3 déchargés, jamais plus de 2 450 rails en mémoire (1 à 2 morceaux le plus souvent),
  ajout en 14 ms au plus, retrait en 11 ms au plus, mémoire stable à 58 Mo, aucun arrêt
  d'urgence ni signal franchi fermé.
- **Reste.**
  - Pas de cache local à part celui du navigateur (les fichiers sont statiques, il les garde) :
    IndexedDB n'apporterait que le jeu hors connexion.
  - Au bord d'un morceau absent la voie s'arrête, comme au bord d'une ligne absente jusqu'ici ;
    pas de signal dédié.
  - L'entrée de Paris reste un gros morceau : la grille pourrait être plus fine en zone dense.
  - Hors conduite rien n'est déchargé (la fenêtre « Ligne entre gares » charge tout un trajet).

### Lot H — Pilote automatique

- **Fait le 2026-10-11**, à la demande (il était hors des versions à venir).
- **Ce qu'il fait.** Case « Pilote automatique » dans la fenêtre d'itinéraire. Il tient la vitesse
  juste sous la limite, freine à temps pour une limite plus basse, un signal fermé, une rame
  devant et le quai de la prochaine gare ; il s'y arrête au mètre près, y reste 30 s, repart vers
  l'étape suivante, change de cabine dans un terminus, et reste à l'arrêt une fois arrivé. Sans
  itinéraire il tient seulement la vitesse de la ligne et obéit aux signaux. Toute action sur les
  manettes le coupe.
- **Comment.** Il conduit comme un pupitre : il lit le `ConsoleState` de la rame et règle les
  manettes (`application/console/autopilot.ts`, `application/game/autopilot.ts`), dix fois par
  seconde. Les aiguilles ne sont pas son affaire : c'est l'aide complète qui les oriente.
- **Vérifié par.** Tests sur des trajets simulés (arrêt à quai sans dépassement, arrêt
  intermédiaire, reprise en main) et en navigateur : Marseille Saint-Charles → Avignon TGV par la
  LGV, 287 km/h au plus, arrivée à quai, aucun dépassement de limite, aucun signal franchi fermé,
  aucun freinage d'urgence.
- **Reste.** Sur LGV il ralentit parfois fortement puis réaccélère (prudence devant ce que le
  signal de cabine annonce) : à affiner. Pas de commande depuis le pupitre téléphone (il y est
  seulement signalé dans l'état). Pas encore de trains pilotés par le jeu autour du joueur.
- **Corrigé au passage.** Avec les lignes classiques, l'itinéraire prenait la ligne classique
  (plus courte) au lieu de la LGV, et pouvait faire sortir la rame vers un morceau chargé à côté :
  le trajet est maintenant choisi au temps de parcours, et part du morceau où se trouve la rame.

### Où on en est (2026-10-11)

Les lots A à G sont faits, sur la branche `feature/jeu-conduite` ; les lignes classiques ont
commencé par une région pilote (Provence-Alpes-Côte d'Azur). Rien n'est encore fusionné dans
`developement` ni publié.

### Suite, en petits lots

Le détail et les cases à cocher sont dans `tasks/plan-jeu-conduite.md`.

1. **Lignes classiques, une région par lot** : Auvergne-Rhône-Alpes d'abord (elle relie Lyon, la
   LGV Rhône-Alpes et PACA), puis l'Île-de-France, puis les autres. L'essai de toute la France
   en une fois n'a pas abouti (serveurs d'OpenStreetMap surchargés) ; sept régions sont en cache.
2. **Pupitre téléphone** : y afficher l'itinéraire, y régler l'aide, essai sur de vrais téléphones.
3. **Matériel TER et Intercités** : aujourd'hui seuls des TGV roulent, même sur les lignes classiques.

---

## 3. Règles qui ne changent pas

- Le réseau reste un seul graphe ; sections, signaux, zones et itinéraires l'annotent.
- `domain/` sans dépendance ; pas de bibliothèque de rendu ni d'état.
- Sur le rendu, la performance d'abord : l'aspect de près ne change pas sans demande explicite.
- Tout ce qui est gardé du réseau d'une image à l'autre se recalcule par différence, avec son oracle en test.
- Chaque lot se mesure avant et après (`npm run bench`, `tools/perf/`).
