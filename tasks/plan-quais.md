# Plan — Quais : construction, repères, import

Branche `feature/quais`, partie de `developement` le 2026-10-18. Aucun code encore : ce fichier
est la spécification à valider avant le premier lot.

## Ce qui est demandé

- Poser un quai le long d'une voie : **d'un côté**, **de l'autre**, **des deux côtés** (deux quais
  qui encadrent une voie) ou **en îlot** (un quai entre deux voies, qui sert les deux).
- Trois sortes de repères :
  1. **Repère d'arrêt de tête** : où s'arrête la tête du train, selon sa longueur ; le pilote s'y arrête.
  2. **Bornes de début et de fin** du quai : sa longueur, déplaçables à la souris.
  3. **Repères de construction** : cotes, aimantation, distance à la voie pendant la pose.
- Un quai **appartient à une gare** : itinéraires, pilote et bac à sable s'en servent. L'éditeur
  doit donc aussi savoir créer et nommer une gare.
- Les **quais d'OpenStreetMap** (`railway=platform`) entrent dans le même modèle, dans ce chantier
  (c'est le Q1 de `plan-jeu-conduite.md` : longueur réelle des quais).

## Ce qui existe (état des lieux du 2026-10-18)

- Pas d'objet quai. Un « quai » est un point d'arrêt `StationStop { segId, t, ref? }` dans une
  `Station` (`domain/models/types.ts:169-193`). Les gares ne viennent que de l'import OSM
  (`domain/import/osmStations.ts`) ; `stations.ts` le dit : rien ne les modifie dans l'éditeur.
- `railway=platform` n'est ni demandé à Overpass (`overpassClient.ts:129`) ni lu (`osmRead`).
- Une section `station_stop` n'est qu'une couleur (trait pointillé, `lodTracks.ts:358-414`).
- Le pilote arrête le **bogie avant** du véhicule de tête sur le point d'arrêt
  (`application/game/autopilot.ts:35-48`), pas le nez. `stationFit` et `createRakeAtStation`
  mesurent la voie d'aiguille à aiguille (`rakePlacement.ts:86-133`), faute de longueur de quai.
- Briques réutilisables : `computeParallelCurve` (`geometry/curve.ts:233`), formes de rail
  (`segmentGeometry.ts` : droite, courbe, rail long `path`), ballast courbe en polygone décalé
  (`renderer.ts:1686-1745`), `traceOffsetSpans` (`signalRender.ts:442`), les `TrackSpan` et leur
  remappage (`trackObjects.ts` : `remapTrackSpan`), la recette d'un nouvel outil
  (`tasks/audit-objets-de-voie.md:50-61`).
- **Piège de convention** : y vers le bas à l'écran. La normale de `bezierNormal` /
  `computeParallelCurve` pointe à **droite** à l'écran, le `leftOf` des signaux à gauche. Le quai
  fixe la sienne une fois pour toutes (ci-dessous) et la teste.

## Modèle proposé

```ts
/** Un bord de quai : la voie qu'il longe et de quel côté */
interface PlatformEdge {
  /** Les rails longés, dans l'ordre, du début à la fin du quai (TrackSpan : segId, t0, t1) */
  track: TrackSpan[]
  /** Côté de la voie, vu en allant du début à la fin du quai */
  side: 'left' | 'right'
  /** Numéro de voie affiché (« 1 », « A ») : le local_ref d'OSM ou la saisie */
  ref?: string
}

interface StopMarker {
  /** Distance au début du bord, m, le long de la voie (pas un t : il ne s'étire pas) */
  at: number
  /** Sens de marche auquel il s'adresse, par rapport au bord */
  heading: 'forward' | 'backward'
  /** Longueur de train la plus grande qu'il arrête, m ; absent : tous les trains */
  maxLength?: number
}

interface Platform {
  id: PlatformId          // pl_12, compteur commun (syncIdCounter)
  stationId: StationId
  /** Un bord (quai latéral) ou deux (quai en îlot, entre deux voies) */
  edges: [PlatformEdge] | [PlatformEdge, PlatformEdge]
  /** Largeur d'un quai latéral, m (un îlot va d'un bord à l'autre) */
  width: number
  markers: StopMarker[]   // rangés par bord : markers d'un îlot → `edge: 0 | 1`
}
```

- `Network.platforms: Map<PlatformId, Platform>`, avec le reste : `CountingMap` dans
  `createCountedNetwork`, empreinte dans l'oracle de `networkWatch.ts`, `syncIdCounter`,
  `touchNetwork(net, null)` après un changement en place.
- « Des deux côtés » = **deux quais latéraux**, un de chaque côté : rien de plus dans le modèle.
- Les **bornes** sont les extrémités de `track` : pas de champ à part.
- **Points d'arrêt** : une gare qui a des quais tire ses `stops` de leurs repères (un par bord et
  par sens). Une gare sans quai (anciens projets, imports sans `railway=platform`) garde les siens.
  Tout ce qui lit `station.stops` aujourd'hui (guide, pilote, pose de rame) continue de marcher.
- Suivre les rails : `remapPlatforms` dans `replaceRail` (à côté de `remapSignals`),
  `cleanPlatforms` quand un rail disparaît (le quai est raccourci, ou retiré s'il ne reste rien).
- Sauvegarde : `SerializedPlatform`, `SerializedProject.platforms?`, version de format suivante ;
  `projectMerge.ts` (fusion) et `projectSlices.ts` (découpe du jeu de données) les suivent.

### Cotes (1:1, ramenées aux autres échelles par `scaleFactor`)

| Grandeur | Valeur proposée | À confirmer |
|---|---|---|
| Axe de la voie → nez de quai | 1,70 m | norme française, à vérifier |
| Largeur d'un quai latéral | 6 m | réglable |
| Entraxe minimal pour un îlot | 2 × 1,70 + 3 m ≈ 6,4 m | en dessous l'outil refuse |
| Marge du repère au bout du quai | 10 m | |

L'entraxe normal (3,80 m) **ne laisse pas de place** pour un îlot : l'outil le dit, et le gabarit
« évitement à quai central » (lot Q6) écarte les voies comme il faut.

## Lots

Chaque lot est testé (oracle compris) et se mesure avant / après (`npm run bench`).

### Socle commun (fait à la main avant les agents, 2026-10-18)
- [x] Types (`Platform`, `PlatformEdge`, `StopMarker` dans `types.ts`), `Network.platforms` en carte
      comptée, ignorée par le suiveur des nœuds et rails, comptée par `syncIdCounter`
- [x] `models/platforms.ts` : cotes (`platformDimensions`), `addPlatform` / `removePlatform` /
      `platformsOf`, `edgeLength`, `pointOnEdge`, `sideNormal`, `edgeLine`, `platformOutline` ;
      convention de côté testée sur droite, courbe et voie parcourue à rebours

### Q0 — Modèle et persistance (domaine seul)
- [x] `networkWatch` (empreinte des quais dans l'oracle), `remapPlatforms`, `cleanPlatforms`
- [x] Sauvegarde, rechargement, annuler / refaire, fusion, découpe
- [x] `stops` tirés des repères pour une gare qui a des quais

### Q1 — Dessin
- [x] Corps du quai (polygone sous les rails, au-dessus du ballast), nez de quai marqué
- [x] Bornes de début et de fin, repères d'arrêt (petit panneau orienté, longueur écrite)
- [x] Dézoom : le quai devient un trait épais le long de la voie, puis disparaît ; culling par boîte
- [x] Thème sombre ; rien ne bouge au dessin des voies (règle : l'aspect ne change pas sans demande)

### Q2 — Outil « Quai » (pose)
- [x] Deux clics le long d'une voie (début, fin), comme une zone de vitesse ; le côté suit le
      curseur ; une touche pose des deux côtés
- [x] Curseur entre deux voies assez écartées : l'outil propose l'îlot ; trop proches : il dit pourquoi
- [x] **Repères de construction** : longueur en direct (`formatDistance`), aimantation aux
      extrémités d'un quai voisin et aux aiguilles, alignement avec le quai d'en face, rames
      qui y tiennent (`stationFit`) affichées pendant la pose
- [x] Gare : celle du quai voisin, sinon une nouvelle gare à nommer (« Gare n » ; le renommage est en Q3)
- [x] Barre contextuelle, raccourci, barre d'outils (style « réglage » vs « outil », vu le 2026-10-18)

### Q3 — Édition
- [x] Sélection d'un quai ; bornes déplacées à la souris, le long de la voie
- [x] Panneau : gare, numéros de voie, largeur ; suppression
- [x] Gares dans l'éditeur : créer, renommer, déplacer l'étiquette (le panneau actuel est en lecture seule)

### Q4 — Repères d'arrêt et conduite
- [x] Repères posés d'office (un par sens au bout du quai, moins la marge), ajoutés, déplacés,
      bornés en longueur de train
- [x] Le pilote arrête **le nez** du train sur le repère qui lui convient (le plus proche qui
      accepte sa longueur), plus le bogie avant ; mesurer avec `tools/perf/measure-pilot.test.ts`
- [x] `stationFit` et `createRakeAtStation` prennent la longueur du quai quand il y en a un
- [x] Le pupitre : distance au repère dans « Prochain arrêt »

### Q5 — Quais d'OpenStreetMap
- [x] Overpass : `railway=platform` et `public_transport=platform` + `train=yes` (lignes et surfaces)
- [x] Rattacher chaque quai aux voies qu'il longe : échantillons du contour projetés sur les
      rails, côté par le signe, îlot quand il y a des voies des deux côtés, longueur par recouvrement
- [x] `ref` (« 1;2 ») → numéros de voie ; les `railway=stop` existants → repères
- [ ] Jeu de données régénéré à la main (`node tools/lgv-dataset/run.mjs --dry` d'abord : poids
      des morceaux, gares sans quai trouvé) ; `stationFit` dit enfin « trop court » dans une halte

### Q6 — Gabarit (après les autres)
- [x] « Évitement à quai central » et « gare à deux quais latéraux » dans `constructionTemplates.ts`

## Décisions prises au lancement (2026-10-18, « go pour les lots »)

Les valeurs proposées sont retenues tant que rien ne les contredit : nez de quai à 1,70 m de
l'axe, quai latéral de 6 m, îlot d'au moins 3 m ; un repère par sens posé d'office, `maxLength`
pour en ajouter par longueur de train ; en Q4, le nez du train sur le repère. Q0 à Q3 sont menés
en parallèle par quatre agents, chacun dans son worktree, depuis le commit du socle :

| Agent | Lot | Fichiers qu'il possède |
|---|---|---|
| A | Q0 | `models/platforms.ts` (ajouts), `networkWatch.ts`, `network.ts` (`replaceRail`), `persistence.ts`, `projectMerge.ts`, `projectSlices.ts`, `stations.ts` |
| B | Q1 | `infrastructure/render/platformRender.ts` (nouveau), son branchement dans `renderer.ts` |
| C | Q2 | outil `platform` : store, `Canvas.tsx`, barre d'outils, barre contextuelle, raccourci |
| D | Q3 | sélection et édition : store, `Canvas.tsx` (mode sélection), `SidePanel.tsx`, gares dans l'éditeur |

## Questions ouvertes

1. Les cotes du tableau : bonnes valeurs, et faut-il une hauteur de quai (dessin seulement) ?
2. Repère d'arrêt : un repère par longueur de train (comme sur le terrain), ou un seul par sens
   et le pilote centre les trains courts ?
3. Le bac à sable pose aujourd'hui la rame bogie avant sur le point d'arrêt : passer au nez sur le
   repère change où tombent les trains déjà sauvegardés. Accepté ?
4. Ordre des lots : Q5 (OSM) peut passer avant Q2 si le réseau réel prime sur l'éditeur.

## Revue

### Q0 à Q3 — 2026-10-19
Menés en parallèle par quatre agents, fusionnés dans `feature/quais` (conflits de Q3 réglés à la
main dans le store, `Canvas.tsx` et `renderer.ts` : les options de dessin gardent la forme de Q1,
`platforms: { selectedId, hoveredId, unit }`). Typage propre, 2 956 tests au vert, les tests
d'annulation de Q2 et Q3 qui attendaient Q0 réactivés.

Essai au navigateur (deux voies à 10 m) : quai latéral posé en deux clics avec « Gare 1 » et ses
deux repères ; îlot entre les deux voies (« Quai central · 160.00 m », rames qui tiennent dans la
barre) ; sélection d'un quai ; borne tirée de 20 m (200 → 220 m) ; de près, ligne de sécurité,
bornes et repères. Aucune erreur dans la page.

À reprendre (repris le 2026-10-19, branche `quais-finitions`) :
- [x] La marque de la gare se pose au milieu du quai : un clic à cet endroit choisit la gare, pas le
      quai. → Le quai garde le clic : `store.stationPickAt` donne la gare à un clic sur sa marque même
      ou sur son étiquette (`stationMarkAt`, `stationRender.ts`, boîtes du dessin en mètres, nom mesuré
      au jugé), et dans l'approche de 14 px autour de la marque seulement quand aucun quai n'est sous
      le curseur ; le survol suit la même règle. La gare ne bouge pas (l'étiquette au milieu du quai
      reste lisible et déplaçable). Vu au navigateur : clic à 9 px de la marque → le quai, sur la
      marque ou le nom → la gare.
- [x] Les longueurs s'écrivent « 160.00 m » (`formatDistance`), pas « 160,00 m ». → `formatDecimal`
      (`units.ts`) : virgule dans `formatDistance`, `formatRadius`, `formatAngle`, la barre d'échelle,
      les badges de section, les longueurs, rayons et angles écrits à la main du panneau, du gizmo et
      de la mesure. `parseDistance` et les champs lisaient déjà la virgule ; les champs se remplissent
      par `String(n)`, jamais par un texte formaté. Les coordonnées « (x m, y m) » gardent le point
      (la virgule y sépare les deux nombres). L'export SVG n'écrit pas de longueur.
- [x] Un îlot qui perd une de ses voies est retiré, pas changé en quai latéral. → Règle 5 de
      `platforms.ts` : il devient un quai latéral sur la voie qui reste, du côté où il était, avec ses
      repères et sa largeur (dans `remapPlatforms` comme dans `settlePlatforms`).
- [x] `MergeReport.platformsAdded` n'est pas encore dit dans le compte rendu de fusion. → Chiffre
      « quai(s) ajouté(s) » après les gares, absent à zéro.
- [x] Un quai à cheval sur deux morceaux du jeu de données reste raccourci quand le second arrive (Q5).
      → Déjà réglé par l'ajout en place (`sliceInPlace.ts`, lot V de la vue, fusionné après cette
      revue : le quai est remis entier depuis le fichier qui arrive, raccourci depuis ceux qui restent ;
      test `editorStore.datasetPlatforms.test.ts`). Restaient deux défauts, vus sur le jeu de données
      réel (l'îlot `pl_140849`, entre `ligne-927000` et `ligne-r4117951-01`) : l'îlot était perdu tant
      qu'un seul morceau était là (réglé par le point précédent), et l'oracle de `sliceInPlace`
      refusait une gare de frontière à plusieurs quais : ses arrêts suivaient l'ordre de
      `net.platforms`, que remettre un morceau change. `settlePlatforms` range désormais les quais
      d'une gare par id. Rien à changer au générateur ni au jeu de données.

### Q6 — 2026-10-19
Deux gabarits de gare dans `constructionTemplates.ts`, paires `compute…Preview` / `apply…` :
- `computeIslandLoopPreview` / `applyIslandLoop` : sur la voie droite sous le curseur (une suite de
  rails droits alignés, à travers les joints simples : `straightRunThrough`), la voie s'écarte du
  côté du curseur de `2 × edgeOffset + width` (9,40 m à 1:1, au-dessus des 6,40 m de l'îlot
  minimal), par deux contre-courbes de 190 m de rayon, sur 220 m de quai ; le gabarit glisse le
  long de la droite pour y tenir, et dit la longueur qu'il lui faut quand elle est trop courte.
  Les coupures tombant à moins de 0,25 m d'un nœud se font sur le nœud. L'îlot est posé ensuite
  sur la voie telle qu'elle est après `reconcileNetworkIntersections`.
- `computeSidePlatformsPreview` / `applySidePlatforms` : la voie sous le curseur et celle d'à côté
  (du côté du curseur d'abord), un quai sur le côté extérieur de chacune, raccourci par pas de
  1/10 jusqu'à ce que les deux voies restent côte à côte (entraxe à 15 % près) : sur un évitement,
  le quai s'arrête avant les contre-courbes.
- Les deux passent par `layPlatformGroup` (sorti de `layPlatforms`) : gare voisine ou « Gare n »,
  repères par défaut ; la marque d'une gare de plusieurs quais se pose entre leurs voies.
- Interface : deux bascules dans la barre de l'outil Quai (`store.platformTemplate`,
  `application/tools/platformTemplateTool.ts`) ; aperçu au survol (voie nouvelle en tirets, quais,
  longueur et entraxe), clic = une étape d'annulation (`markDirty`) ; Échap repose le gabarit,
  puis quitte l'outil ; changer d'outil le repose.

Tests : géométrie (écartement, côté de l'îlot à gauche et à droite, droite en 16 rails, HO, voie
trop courte, courbe refusée, gare existante rejointe ; quais latéraux sur double voie, curseur à
l'extérieur, évitement, voie unique refusée) et store (barre, pose, annuler / rétablir, Échap).
Typage propre, 3 055 tests au vert. Au navigateur (une voie de 1 km et une double voie à 4 m) :
aperçu puis pose de chaque gabarit, îlot entre les deux voies avec ses repères, deux annulations
qui rendent les 3 rails d'origine ; aucune erreur de page (seulement les 403 des polices).

À reprendre :
- La longueur du quai (220 m) et le rayon (190 m) sont fixes : pas encore de réglage dans la barre.
- L'évitement à quai central ne se pose que sur une droite ; pas sur une courbe ni un rail long importé (`path`).
- ~~Les quais latéraux rejoignent une gare à moins de 300 m (`STATION_REACH`), même de l'autre côté
  d'un faisceau : vu à l'essai, une seconde gare voulue à 150 m de la première y est rattachée.~~
  **Réglé le 2026-10-22** : un quai ne rejoint plus une gare que si un quai de celle-ci est à moins
  de 40 m, ou si la gare s'arrête sur sa voie (gare OSM sans quai) ; sinon « Gare n » est créée, et
  la pose le dit (« Gare 2 créée », « Quai rattaché à Gare 1 »).
- `applyPassingSiding` coupe deux fois le même id de rail (la seconde coupure ne trouve plus le
  rail, c'est la réconciliation qui recoud) : le nouveau gabarit ne s'en sert pas, à reprendre à part.
