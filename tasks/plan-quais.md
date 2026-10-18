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
- [ ] Corps du quai (polygone sous les rails, au-dessus du ballast), nez de quai marqué
- [ ] Bornes de début et de fin, repères d'arrêt (petit panneau orienté, longueur écrite)
- [ ] Dézoom : le quai devient un trait épais le long de la voie, puis disparaît ; culling par boîte
- [ ] Thème sombre ; rien ne bouge au dessin des voies (règle : l'aspect ne change pas sans demande)

### Q2 — Outil « Quai » (pose)
- [ ] Deux clics le long d'une voie (début, fin), comme une zone de vitesse ; le côté suit le
      curseur ; une touche pose des deux côtés
- [ ] Curseur entre deux voies assez écartées : l'outil propose l'îlot ; trop proches : il dit pourquoi
- [ ] **Repères de construction** : longueur en direct (`formatDistance`), aimantation aux
      extrémités d'un quai voisin et aux aiguilles, alignement avec le quai d'en face, rames
      qui y tiennent (`stationFit`) affichées pendant la pose
- [ ] Gare : celle du quai voisin, sinon une nouvelle gare à nommer
- [ ] Barre contextuelle, raccourci, barre d'outils (style « réglage » vs « outil », vu le 2026-10-18)

### Q3 — Édition
- [ ] Sélection d'un quai ; bornes déplacées à la souris, le long de la voie
- [ ] Panneau : gare, numéros de voie, largeur ; suppression
- [ ] Gares dans l'éditeur : créer, renommer, déplacer l'étiquette (le panneau actuel est en lecture seule)

### Q4 — Repères d'arrêt et conduite
- [ ] Repères posés d'office (un par sens au bout du quai, moins la marge), ajoutés, déplacés,
      bornés en longueur de train
- [ ] Le pilote arrête **le nez** du train sur le repère qui lui convient (le plus proche qui
      accepte sa longueur), plus le bogie avant ; mesurer avec `tools/perf/measure-pilot.test.ts`
- [ ] `stationFit` et `createRakeAtStation` prennent la longueur du quai quand il y en a un
- [ ] Le pupitre : distance au repère dans « Prochain arrêt »

### Q5 — Quais d'OpenStreetMap
- [ ] Overpass : `railway=platform` et `public_transport=platform` + `train=yes` (lignes et surfaces)
- [ ] Rattacher chaque quai aux voies qu'il longe : échantillons du contour projetés sur les
      rails, côté par le signe, îlot quand il y a des voies des deux côtés, longueur par recouvrement
- [ ] `ref` (« 1;2 ») → numéros de voie ; les `railway=stop` existants → repères
- [ ] Jeu de données régénéré à la main (`node tools/lgv-dataset/run.mjs --dry` d'abord : poids
      des morceaux, gares sans quai trouvé) ; `stationFit` dit enfin « trop court » dans une halte

### Q6 — Gabarit (après les autres)
- [ ] « Évitement à quai central » et « gare à deux quais latéraux » dans `constructionTemplates.ts`

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

_(à remplir à la fin de chaque lot)_
