# Plan — Vue « Réseau France », chargement à l'approche, souterrain

Demandé le 2026-10-19. Décisions de l'utilisateur :
- **Vue France** : un projet « Réseau France » à part, verrouillé, sans ligne chargée au départ :
  tout le réseau du jeu de données en tracé simplifié, les morceaux chargés à l'approche d'une
  ligne, en édition comme en jeu.
- **Régions** : aucune nouvelle pour l'instant (LGV + PACA) ; le mécanisme d'abord.
- **Métro** : oui, catégorie à part dans le jeu de données (`railway=subway`), type de rail gardé
  sur le réseau. Après le chantier du sens de circulation (même générateur), avec sa régénération.
- **Souterrain** : un bouton surface / souterrain, et le passage automatique quand le train conduit
  entre en tunnel ou en sort.

## État des lieux (exploration du 2026-10-19)

- `renderDatasetOverview` (`datasetOverview.ts`) dessine les lignes non chargées de l'index, à
  tous les zooms, seulement dans un projet de jeu de données (`store.dataset`).
- Les morceaux ne se chargent qu'en jeu, train en marche (`checkDatasetLines` depuis
  `tickAllTrains`), par les portes du graphe des lignes ; la caméra de la vue libre ne fait que retenir.
- `addDatasetLines` / `removeDatasetLines` refont l'union de tout ce qui est chargé et la relisent :
  le coût croît avec tout le chargé (217 ms au pire mesuré). Pas de plafond, pas de cache des fichiers.
- `readRecipe` refuse une recette sans ligne ; `removeDatasetLines` garde toujours le dernier fichier.
- Souterrain : niveaux négatifs des nœuds ; tout ce qui est sous le sol est estompé en dur
  (`TUNNEL_ALPHA = 0.4`, pointillés ; véhicules 0.35) en une douzaine d'endroits
  (`renderer.ts`, `lodTracks.ts`, `signalRender.ts`, `Canvas.tsx`, `exportSvg.ts`). Pas de notion
  de « où est l'utilisateur ».

## Lots

### V1 — Projet « Réseau France »
- [x] Recette sans ligne acceptée (`readRecipe`), projet vide verrouillé avec l'index et sa vue
      d'ensemble ; entrée « Fichier ▸ Réseau France » (et au lancement à côté du bac à sable)
- [x] Sauvegardé en recette, rouvert au rechargement avec ce qui était chargé

### V2 — Chargement et déchargement à l'approche, dans tous les modes
- [x] Vérification périodique hors `tickAllTrains` (mouvements de caméra, temporisée) : charger
      les morceaux dont la boîte touche la vue (plus une marge) à partir du palier « rails » ;
      décharger loin de la vue et des trains (`linesToDrop`) ; plus de « dernier fichier » gardé
- [x] Plafond de morceaux chargés (le plus ancien vu d'abord), cache des fichiers déjà lus
- [x] Ajout et retrait **incrémentaux** : lire le seul morceau ajouté, retirer le seul morceau
      parti, au lieu de relire l'union ; mesurer (`tools/perf/measure-driving.cjs`, et un essai
      de balayage de carte)
- [x] Les gares de la vue d'ensemble seulement à partir d'un certain zoom

### V3 — Surface / souterrain
- [x] `store.viewDepth: 'surface' | 'underground'` ; bouton dans l'interface (raccourci), passage
      automatique quand le train conduit change de côté du sol
- [x] En surface : le souterrain à 15 % (au lieu de 40 %) ; dessous : le souterrain normal, la
      surface à 15 % ; un seul `levelAlpha(level, options)` au lieu des constantes en dur ;
      coût par passe de niveau, pas par rail
- [x] Véhicules et signaux suivent la même règle ; export SVG inchangé

### V4 — Métro dans le jeu de données (après `plan-sens-circulation.md`)
- [x] `railway=subway` demandé par le générateur, catégorie « Métro » (couleur, légende), type de
      rail gardé sur le réseau (`Segment.railway`, `kind` étant déjà la forme du rail), sauvegardé
- [x] Régénération (requêtes Overpass nouvelles, avec `User-Agent`)

## Revue

### V1–V3 (2026-10-19, branche `vue-reseau`)

**V1 — « Réseau France ».** `DatasetRecipe.whole` (le réseau entier, ouvert sans ligne) ;
`readDatasetRecipe` accepte une recette sans ligne (le réseau entier, ou un trajet dont tout a été
déchargé ; refusée seulement sans ligne, sans gare et sans `whole`). `openWholeNetwork(store)`
(`journeyLoader.ts`) charge un projet vide (`emptyDatasetProject` : 1:1, m, écartement normal,
Lambert-93 de l'index) cadré sur tout l'index (`indexBbox`), verrouillé. Entrées : « Fichier ▸
Réseau France » (confirmation quand le projet a des trains ou des voies tracées à la main) et
« Explorer le réseau France » au pied de la fenêtre du bac à sable au lancement. Sauvé en recette ;
`reloadDataset` rouvre avec les morceaux chargés (projet vide s'il n'y en a aucun) et, pour le
réseau entier, sans la vitesse ni le type de ligne du premier fichier.

**V2 — À l'approche.** `store.refreshDatasetLines()` : appelée chaque seconde par la simulation
(trains : portes du graphe des lignes, comme avant) et par `useDatasetStreaming` (App) quand la vue
s'arrête 250 ms et chaque seconde sinon, dans tous les modes, pause comprise. Charge les morceaux
dont la boîte touche la vue + 5 km (`DATASET_VIEW_MARGIN_M`) à partir du palier « rails »
(`isDatasetViewNear`) ; décharge ce qui est à plus de 20 km de tout train et de la vue (qui porte
aussi loin qu'elle montre) ; plus de « dernier fichier ». Plafond `DATASET_MAX_PIECES` = 24
(`datasetMaxPieces`), le morceau vu le plus anciennement part d'abord (`datasetSeen`,
`piecesOverCap`) ; cache des fichiers lus (`LINE_FILE_CACHE_SIZE` = 48, par édition des données) ;
un fichier arrivé après le changement de projet n'est pas ajouté (`datasetGeneration`). Les gares
de la vue d'ensemble à partir de 0,008 px/m (`OVERVIEW_STATIONS_MIN_SCALE`).

Ajout et retrait **incrémentaux** (`infrastructure/persistence/sliceInPlace.ts`) :
`addSliceInPlace` pose les nœuds et rails absents, remet entières les tables, gares et quais de la
frontière ; `removeSliceInPlace` retire ce que seuls ce morceau tenait et remet la frontière telle
que les fichiers restants la tiennent ; les deux finissent par les nettoyages et
`adoptReconciledNetwork`. Oracle : en test, chaque appel est comparé au réseau relu de l'union des
fichiers chargés (à l'ordre des cartes près et à la position des aiguilles près, gardée quand la
voie ouverte existe encore). `railLine` suit à la volée. Mesure (`tools/perf/measure-dataset-pieces.test.ts`,
30 morceaux les plus proches de Paris ajoutés puis retirés un à un, jusqu'à 14 700 rails ; base et
branche alternées, machine partagée) : ajout 93–107 ms → 12–18 ms de moyenne (avec `notify`
160–180 → 20–28 ms ; pire 165–284 → 46–114 ms) ; retrait 97–105 → 9–13 ms (avec `notify`
165–173 → 14–19 ms). Navigateur : 8 à 15 ms pour un morceau de LGV, 53 ms pour
`racc-paris-gare-de-lyon-01` (4 000 rails).

**V3 — Surface / souterrain.** `store.viewDepth` (`setViewDepth`, `toggleViewDepth`), jamais
sauvé ; bouton « Surface / Souterrain » dans la barre du haut à droite (à côté du sélecteur de
mode), case « Vue en souterrain » du menu Affichage, raccourci `view.toggleDepth` (U). En conduite,
la vue suit le train de l'écran à chaque passage de son véhicule de tête sous le sol ou au-dessus
(une fois par passage : un choix à la main entre-temps est gardé). `levelAlpha(level, depth)` /
`levelDashed` (`render/levelAlpha.ts`, `OTHER_SIDE_ALPHA` = 0,15) remplacent les constantes à
chaque site : rails des quatre paliers, joints, tabliers (estompés avec la surface vue de dessous),
quais, bandes de vitesse, cantons, dévers et pentes, signaux, véhicules, ancienne locomotive ; le
papier des bordures et de l'intérieur des voies est estompé avec son niveau vu de dessous (sinon il
masquerait les tunnels). Une fois par passe de niveau. Export SVG inchangé (`TUNNEL_ALPHA` = 0,4
reste le sien). `npm run bench` alterné avant / après : minima identiques à ±4 % (bruit).

**Vérifié au navigateur** (serveur 8904, Playwright) : fenêtre de lancement → « Explorer le réseau
France » ; vue d'ensemble, rien chargé ; au palier « ligne » rien n'est demandé, au palier « rails »
`lgv-sud-est-03` arrive ; déplacé en Bretagne, le Sud-Est part et `lgv-bretagne-pays-de-la-loire-04`
arrive ; approche de Paris, bouton puis touche U ; rechargement : « Réseau France » rouvert avec ses
deux morceaux.

### V4 (2026-10-19, branche `dataset-metro`)

**Rail.** `Segment.railway?: 'subway'` (absent : le chemin de fer ; `kind` désigne déjà la forme du
rail, d'où un autre nom), outils dans `models/railway.ts` (`isSubwayRail`, `setRailway`,
`remapRailway`). Fait comme `Segment.running` : `RailReplacement.railway` (rempli par la découpe, la
fusion, les doublons et les rails longs, `handedOn`), `replaceRail` le donne aux morceaux qui n'en
ont pas ; les rails longs gardent un nœud entre métro et train ; empreinte de l'oracle
(`networkWatch`) et suivi (`networkFollower`) ; sauvegarde (`SerializedSegment.railway`, valeur
inconnue lue comme le chemin de fer), `readSavedSegment` (donc `sliceInPlace`), découpe et fusion de
projets par recopie (testé).

**Import.** `railway=subway` avec `extraKinds: ['subway']` : le rail prend `railway: 'subway'` de la
voie à son milieu (`layRunning`). Un métro sans `maxspeed` est pris à 80 km/h au plus
(`SUBWAY_ASSUMED_SPEED`). Ses arrêts ne font pas de gare (`track-not-imported`) : les étiquettes de
mode manquent souvent, la première régénération à blanc avait ajouté dix stations de métro (Corvisart,
Pont de Bois…). Les métros français roulent à droite : la règle de déduction y garde la droite (voir
`plan-sens-circulation.md`) ; l'écart de la règle aux étiquettes retombe de 60,6 à 42,1 km.
Souterrain : `tunnel` / `layer` sont posés sur presque toutes les voies (Paris : 672 voies en tunnel
sur 855, 6 par `layer` seul, aucune par `location=underground` seul) ; 625 km sur 695 sont sous le
sol, donc estompés en surface par `levelAlpha`.

**Générateur.** `manifest.subways` (Paris, Lyon, Marseille, Lille : les villes que le jeu touche ; une
boîte chacune) ; `subwayQuery` (voies `railway=subway` hors dépôts et garages, routes
`route=subway`). `assignLines` nomme une voie de métro d'après le `ref` de ses routes
(`metro-paris-1`, « Métro de Paris, ligne 1 », catégorie `subway`), le plus petit quand elle en porte
plusieurs ; une section sans nom ne prend la ligne que d'une voisine de même nature (métro ou train),
sinon « Métro, autres voies » (`metro-autres`) ; `absorbSmallLines` ne verse une ligne de métro que
dans une ligne de métro.

**Application.** `LineCategory` `subway` (« Métro », violet `#9333ea`) : couleur des rails chargés
(`railTint`), vue d'ensemble, mini-carte, légende. `store.railsBlockedFor` tient le chemin de chaque
train hors des voies de métro (aucun matériel n'en est un), `travelWeight` / `travelWeightFor` n'entrent
jamais dans une ligne de métro.

**Régénération.** 26 lignes de métro avant découpe, 13 747 rails, 695 km de voie (625 sous le sol),
3,38 Mio ; fichiers de lignes 19,76 Mio contre 16,38 (+20,6 %, sous le seuil de 25 %). 76 596 rails,
8 613 km, 200 gares comme avant. Aix-en-Provence TGV → Avignon TGV toujours à gauche
(`explore-aix-avignon.test.ts`, voir plus bas).

**Reste.** Pas de gares de métro ni de matériel métro ; Rennes, Toulouse et Rouen (non touchées par
le jeu de données) ne sont pas demandées ; Orlyval est dans la boîte de Paris s'il est étiqueté
`railway=subway`. Une section qui joint métro et train par un nœud de degré 2 est nommée par sa
majorité (rare dans les données).

**Reste / risques (V1–V3).** Le cadrage du pays bute sur l'échelle minimale de la caméra (la France entière
ne tient pas dans la fenêtre). La position des aiguilles d'une table de frontière est gardée quand
la voie qu'elle ouvre existe encore, sinon reprise du fichier. Fusion avec le sens de circulation :
`deserializeNetwork` a été découpé (`readSavedSegment`) — un champ ajouté au rail (`running`) doit
y être lu pour que `addSliceInPlace` le pose aussi ; l'oracle des tests compare chaque champ des
nœuds et des rails et le signalera sinon. Fusion avec le correctif des ponts : `renderTrainSet` prend un paramètre de plus (`depth`)
et `atLevel` y lit `levelAlpha`.
