# Grands réseaux : rails longs, rendu léger, pilotage épuré — plan

## Contexte

Objectif : charger de grandes lignes (carte LGV de France, puis davantage) sans surcharger le
moteur ni le canvas, et alléger au maximum le mode pilotage (ne garder que l'essentiel).

Aujourd'hui un rail est une droite ou **une** courbe de Bézier quadratique entre deux nœuds : chaque
changement de direction crée un nœud et un rail (Marseille : 1 500 rails pour 261 tronçons entre
aiguillages ; LGV de France : ~100 000 rails estimés). Trois recherches ont été menées
(code + littérature), leurs constats :

1. **Géométrie des rails** : il n'y a pas de module central. ~60 fonctions refont chacune leur
   test « droite ou courbe » (83 lignes `kind ===`, ~55 branches sur `via`) ; la longueur d'un
   rail a 5 définitions (16, 32 ou 64 cordes) ; placer un bogie sur une courbe coûte ~1 000
   évaluations de Bézier (bissection × échantillonnage). ~250 appels passent déjà par les
   primitives de `locomotive.ts` (`positionOnSegment`, `tangentOnSegment`, `segmentPartialLength`).
2. **Formes de rail** : les vrais tracés et les simulateurs (Train Simulator / Open Rails,
   OpenDRIVE, IFC Rail, railML) stockent **un tronçon entre deux jonctions = une liste ordonnée de
   pièces droite / arc de cercle** (clothoïde en option). Sur une droite ou un arc : position à une
   distance, longueur, rayon et rails parallèles sont **exacts et en formule directe**. À écarter :
   Bézier cubiques / splines (pas de longueur ni de parallèle exactes) et `ctx.arc` pour des rayons
   kilométriques (bug Chrome connu, précision float32 loin de l'origine).
3. **Mode pilotage** : chaque image appelle `notify()` (synchronisation de toutes les jonctions,
   zones, signaux ; re-rendu React complet ; distance d'arrêt intégrée deux fois), fait 5 à 7
   comparaisons complètes du réseau (`trackGeometryRevision`, `networkDerived`), et dessine
   grille, bandes de section, bandes de zone, marques de dévers, échelle… dont le conducteur n'a
   pas besoin.

## Décisions de conception

- **Rail long** = troisième forme de `Segment`, `kind: 'path'` : deux nœuds d'extrémité + une
  liste de pièces `{ x0, y0, cap, courbure, longueur }` (droite = courbure 0), chaque pièce avec sa
  propre pose de départ (pas d'erreur cumulée) et une table des longueurs cumulées.
- **`t` reste dans 0…1** (`TrackPosition`, zones, signaux inchangés) et vaut, sur un rail long, la
  **fraction de longueur** : une coupe reste affine par morceau, donc signaux, zones et trains ne
  bougent pas quand on coupe (contrat de `trackObjects.ts`).
- Les rails droits et quadratiques existants **restent** (voie dessinée à la main, aiguillages du
  catalogue). Pas de migration forcée.
- **Dessin d'un arc** : une ou plusieurs `quadraticCurveTo` (erreur ≈ R·θ⁴/128, soit ~3 mm pour
  400 m à R = 4 000 m), coordonnées soustraites de l'origine de la vue en double précision ; les
  deux files de rail d'un arc sont des arcs de rayon R ± écartement/2. Nombre de cordes au dézoom en
  formule directe : pas de pyramide à stocker.
- **Clothoïde** : reportée. Sans elle, le dévers et la vitesse limite sautent à l'entrée d'une
  courbe au lieu de monter progressivement ; champ `dκ/ds` prévu dans le format pour l'ajouter.

## Lots (chacun livrable et mesuré seul)

### Lot P — Pilotage épuré (indépendant, à faire en premier)
Calcul :
- Boucle de simulation (`editorStore.ts`, `tickAllTrains`) : ne plus appeler `notify()` à chaque
  image. Notification « image » qui redessine le canvas seulement ; la console (`DrivingDock`)
  rafraîchie à ~10 Hz (cadence déjà utilisée par le pupitre téléphone) et sur commande.
- Ne pas lancer `syncJunctions` / `cleanSpeedZones` / `cleanSignals` en pilotage (l'édition y est refusée).
- `trackGeometryRevision`, `routeTablesRevision`, `networkDerived` : vrais compteurs de révision
  au lieu de comparaisons complètes (aujourd'hui 5 à 7 par image).
- Distance d'arrêt (`integrateStop`) calculée une fois par image et partagée tick / console.
- `getTrainSetVisuals` : silhouette seule hors palier `detail`, cache par position du train.
- Signalisation : n'actualiser les aspects que si un train change de canton ou une aiguille bouge.
Dessin — option « Vue de conduite épurée » (activée par défaut en pilotage, menu Affichage) :

| Gardé | Retiré |
|---|---|
| rails et position des aiguilles | grille, plateau |
| itinéraire devant le train | bande de couleur des sections |
| signaux et leur aspect, TIV | bandes orange des zones (les pancartes Z/R restent) |
| pancartes de vitesse | marques de dévers, chevrons et étiquettes de pente |
| trains (silhouettes) | bandes de cantons / réservations |
| heurtoirs, tabliers de pont | joints et reflet du rail, bogies, barre d'échelle, minimap |

- Entrée de banc « pilotage » dans `render.bench.ts` et mesure navigateur en conduite
  (`tools/perf/measure-canvas.cjs`).

### Lot A — Une seule géométrie de rail (aucun changement de comportement)
- Tests de caractérisation d'abord : figer les valeurs actuelles des 5 longueurs, des coupes
  (`splitSegment`), des distances de signaux et de sections.
- Nouveau module `src/domain/geometry/segmentGeometry.ts` : point à t, tangente à t, tangente
  d'extrémité, longueur, longueur t0→t1, **t à une distance** (aujourd'hui privé), t le plus proche
  d'un point, rayon et sens à t, boîte englobante, polyligne (avec tolérance), « pièces entre t0 et
  t1 ». Les primitives de `locomotive.ts` deviennent de simples renvois.
- Rebrancher les ~60 fonctions listées par l'inventaire (dont `network.ts`, `reconcile.ts`,
  `tangent.ts`, `junction.ts`, `crossing.ts`, `trackSpeed.ts`, `sections.ts`, `signals.ts`,
  `speedSigns.ts`, `renderer.ts`, `lodTracks.ts`, `speedZoneRender.ts`, `cantRender.ts`,
  `levelPieces.ts`, `networkDerived.ts`, `exportSvg.ts`, `MiniMap.tsx`, `Canvas.tsx`).
- Longueurs des courbes mises en cache par rail (table cumulée) : supprime la bissection à ~1 000
  évaluations par bogie.
- Écart assumé : unifier 16 / 32 / 64 cordes déplace des longueurs au 4ᵉ–5ᵉ chiffre ; les tests
  qui fixent des longueurs exactes seront réajustés et listés.

### Lot B — Le rail long (`kind: 'path'`)
Par ordre de risque pour la circulation des trains :
1. Primitives du lot A pour `path` (formules directes, recherche de la pièce par dichotomie).
2. Profil de vitesse / dévers / déraillement (`trackSpeed.ts`) : rayon, dévers et vitesse **par
   intervalle** du rail et non plus un seul par rail ; clé de cache incluant le tracé interne.
3. Coupe et fusion : `splitSegment`, `splitSegmentAtNode`, `dissolveNode` (fusionner deux rails en
   un rail long), `mergeReplacements`.
4. Réconciliation et croisements (`reconcile.ts`, `crossing.ts`) : test large par pièce (un rail
   de 100 km a une boîte immense), intersection par pièce.
5. Identité d'un rail (`findSameRail`, `removeDuplicateSegments`) : comparer le tracé.
6. Déplacement d'un nœud d'extrémité, soudure, inversion d'aiguille : règle retenue = seule la
   dernière pièce se réajuste, tangente au reste ; refus si impossible.
7. Persistance : format version 3, champ `pieces` ; **refus explicite d'un fichier plus récent**
   (aujourd'hui une forme inconnue est chargée comme une droite, sans avertir).
8. Rendu : tous les paliers passent par « pièces entre t0 et t1 » ; zone d'aiguillage de 25 m
   calculée en distance ; pastilles et flèches à mi-longueur ; export SVG.
9. Ergonomie : sélection au rectangle d'un rail long, parallèle d'un rail long (exacte : arcs).
Limite connue : les hauteurs restent portées par les nœuds (une pente constante par rail) ; un
profil en long à l'intérieur d'un rail long est hors de ce plan.

### Lot C — Import et simplification
- Convertisseur porté en TypeScript (`src/domain/services/osmImport.ts`, pur, testé), utilisable
  dans le navigateur et en ligne de commande ; `tools/osm-import/osm_to_project.py` retiré ensuite.
- Ajustement droites / arcs sous tolérance (nettoyage Douglas-Peucker, segmentation par cap et
  courbure, cercle aux moindres carrés, vérification de l'écart) → un rail long par tronçon.
- Géoréférencement du projet (origine, projection ; Lambert-93 pour la France) : deux imports se raccordent.
- Fichier ▸ Importer ▸ « Depuis OpenStreetMap… » (lieu, rayon, préréglage gare / ligne / LGV,
  taille annoncée avant téléchargement, remplacer ou ajouter). Mention ODbL.
- Édition ▸ « Simplifier le réseau » : fusionne les enfilades de rails existants en rails longs.
- Carte LGV de France préparée hors ligne (extrait Geofabrik, `highspeed=yes`), menu « Cartes ».

### Lot D — Seulement si les mesures le demandent
Index spatial (visibilité, clic, réconciliation), calques statique / dynamique avec réutilisation
par translation (la caméra suit le train), sauvegarde en IndexedDB, annulation par différences.

## Ordre et jalons
1. **Lot P** — pilotage fluide sur Marseille et sur le banc « 9 gares ».
2. **Lot A** — suite de tests verte à comportement égal ; gain immédiat sur le placement des bogies.
3. **Lot B** — Marseille convertie en ~260 rails longs : même dessin, mêmes trajets de train.
4. **Lot C** — import d'une gare depuis l'appli, puis carte LGV.
5. Mesure sur la carte LGV, puis décision sur le lot D.

## Vérification
- `npm test`, `npm run typecheck`, `npm run build` à chaque lot.
- Lot A : tests de caractérisation identiques avant / après ; captures pixel à pixel des paliers.
- Lot B : test d'équivalence — le même réseau en petits rails et en rails longs donne les mêmes
  positions de train après N secondes de conduite, les mêmes longueurs de canton, les mêmes
  vitesses limites (à la tolérance d'ajustement près) ; aller-retour sauvegarde / chargement ;
  coupe d'un rail long avec signal, zone et train dessus.
- Lots P, B, C : `tools/perf/measure-canvas.cjs` et `npm run bench` (appels canvas, ms de script
  par image, en édition et en conduite), chiffres notés dans le plan.
- Lot C : import de Marseille Saint-Charles comparé à l'exemple actuel (aiguillages reconnus).

## Suivi

- [ ] Lot P — pilotage épuré (première partie faite le 2026-10-06, voir ci-dessous)
- [ ] Lot A — une seule géométrie de rail (première étape faite le 2026-10-06, voir plus bas)
- [ ] Lot B — rail long (cœur fait le 2026-10-06, voir plus bas)
- [ ] Lot C — import et simplification
- [ ] Lot D — selon mesures

### Lot P — fait
- `store.notifyFrame(moved)` remplace `notify()` en fin de `tickAllTrains` : le canvas est
  redessiné à chaque image où un train a bougé, les panneaux (pupitre) au plus toutes les 100 ms
  (`DRIVING_PANEL_PERIOD_MS`), et le réseau n'est plus resynchronisé à chaque image. Trains à
  l'arrêt : un tracé toutes les 100 ms au lieu de 60 par seconde.
- Vue de conduite épurée (`store.minimalDrivingView`, Affichage ▸ « Vue de conduite épurée »,
  cochée par défaut) : sans grille, plateau, bandes de section, bandes de zone, marques de dévers et
  de pente, barre d'échelle ni minimap ; rails au palier `rails` au plus (ni joints ni reflet).
  Options de rendu ajoutées : `hideSpeedZoneBands`, `plainRails`.
- Mesure sur Marseille (script seul, hors React) : une image de simulation 3,7 ms → 1,5 ms
  (les 2,3 ms de `notify()` ne sont plus payés à chaque image), plus le re-rendu React complet
  qui passe de 60 à 10 par seconde.

- Réseau « tenu » pendant la conduite (`src/domain/models/networkWatch.ts`) : les comparaisons
  complètes du réseau (`trackGeometryRevision`, `routeTablesRevision`, `networkDerived`) sont
  faites une fois puis crues jusqu'à la prochaine notification de l'éditeur ou la prochaine
  aiguille manœuvrée. **Contrat** : toute modification du réseau est suivie de `store.notify()`
  (déjà la règle) ; un changement de position d'aiguille passe par `setJunctionPosition`.
- Distance d'arrêt et forces du train conduit calculées une fois par image, partagées avec le pupitre.
- Vue épurée : trains sans bogies ni soufflets, même de près.
- Mesure sur Marseille (script seul) : une image de simulation 3,7 ms → 0,5 à 1,1 ms.

### Lot P — reste
- [ ] Aspects des signaux recalculés sur évènement seulement (aujourd'hui à chaque image où un train bouge).
- [ ] `getTrainSetVisuals` en cache par position du train.
- [ ] Entrée « pilotage » dans `render.bench.ts` et mesure navigateur en conduite sur un grand réseau.
- [ ] Le survol de la souris en pilotage appelle encore `notify()` à chaque mouvement.

### Lot A — fait
- `src/domain/geometry/segmentGeometry.ts` : la forme d'un rail en un seul endroit (`segmentEnds`,
  `pointOnShape`, `tangentOnShape`, `shapeLengthBetween`, `shapeParamAtDistance`,
  `segmentShapeLength`, `segmentShapeLengthBetween`).
- Longueur d'une courbe par intégration de la vitesse (`curveLengthBetween`, Gauss-Legendre) au
  lieu de sommes de 16, 32 ou 64 cordes : une seule définition, exacte au micromètre sur une
  courbe de voie. Position à une distance par Newton (`curveParamAtDistance`) au lieu d'une
  dichotomie de 32 pas × 32 cordes.
- Passent maintenant par ce module : `positionOnSegment`, `tangentOnSegment`,
  `segmentPartialLength`, les deux `moveWithinSegment*` (`locomotive.ts`), `segmentLength`
  (`pathfinding.ts`), `segmentRunLength` (`network.ts`), la longueur des sections (`sections.ts`),
  `stretchLength` (`signals.ts`), `parameterAt` (`speedSigns.ts`), et tout ce qui appelle `curveLength`.
- Mesure : reculer un bogie de 5 m sur une courbe, 60 µs → 14 µs. Aucun test existant n'a bougé.

- Deuxième étape (2026-10-06) — passent aussi par le module :
  - tangente d'extrémité : `segmentTangentAt`, `getOutgoingTangent`, `getNodeSegmentEndVector`, `meetSmoothly` (`leaveVectorOnShape`, `leaveDirectionOnShape`) ;
  - point le plus proche et distance : `projectOnSegment`, `segmentHeightNear`, `hitSegment` (`closestParamOnShape`, `distanceToShape`) ;
  - polyligne et boîte : `railPolyline`, `detectCrossings`, `findSegmentCrossings`, `sectionPolyline`, la minimap, `isSegmentInBounds`, l'export SVG (`shapePolyline`, `shapeChordCount`, `shapeBounds`, `segmentBounds`) ;
  - pièces de dessin entre t0 et t1 (`shapePieces`, une liste — un seul élément pour les deux formes actuelles) : `subdivideCurve` / `subdivideStraight`, `pieceGeometry`, `renderLineTracks`, `renderDetailRails`, `renderSectionStripes`, `deckEndAt`, l'export SVG.
  - Sortie vérifiée identique appel canvas par appel canvas sur 30 scènes (dont Marseille) ; banc de rendu inchangé au bruit près ; `detectCrossings` sur une gare 3 à 6 fois plus rapide (formes et boîtes calculées une fois par rail).
  - `segmentEnds` rend toujours `{ a, b, via }` (`via: undefined` pour une droite) : une seule forme d'objet, sinon les boucles de dessin perdaient 8 à 15 %.

### Lot A — reste
- [ ] `spanGeometry` (`speedZoneRender.ts`) et `traceOuterRails` (`cantRender.ts`) : les router change le dernier chiffre de leurs sorties ; à faire en l'acceptant.
- [ ] Aimantation de l'éditeur, chacune avec son propre échantillonnage : `getTrackTangentAt`, `checkCurveJoins`, survol dans `Canvas.tsx`, `getStepPointsAlongSegment`, `signalRowPlaces`, pastilles et flèches à t = 0,5.
- Reportés au lot B, parce qu'il s'agit d'une logique par forme et non d'un rebranchement : les deux coupes (`splitSegment`, `splitSegmentAtNode`), le rayon en un point (`getTrackCurvatureAt`, `railGeometry` : deux définitions aujourd'hui), le test nœud-sur-rail et `evalSegment` de la réconciliation.

### Lot B — fait
- `kind: 'path'` : un rail entre deux nœuds qui porte son tracé, une liste de `PathPiece`
  (départ, cap, courbure signée, longueur ; droite = courbure 0). `t` = part de la longueur.
- `src/domain/geometry/railPath.ts` : point et cap à une distance, courbure, point le plus proche,
  pièces de dessin (arcs en quadratiques de 0,35 rad au plus), polyligne, coupe, sens inverse,
  boîte. Un rail long suit ses nœuds : son tracé est lu tourné, mis à l'échelle et décalé sur eux.
- Toutes les primitives de `segmentGeometry.ts` connaissent la troisième forme ; `curvatureOnShape` ajouté.
- Coupes (`splitSegment`, `splitSegmentAtNode`), raccord d'une voie qui vient buter dessus
  (réconciliation), identité (jamais pris pour le rail droit entre ses nœuds), rayon sous un bogie,
  profil de vitesse, caches (`pathChecksum`), dessin (tous paliers, bandes de zone, marques de
  dévers, bandes de signalisation), persistance.
- Persistance : version 3 dès qu'un rail long est présent ; un fichier plus récent que
  `PROJECT_VERSION` est refusé au lieu d'être lu de travers.
- `src/domain/geometry/arcFit.ts` (`fitPath`) : polyligne → droites et arcs tangents sous
  tolérance, extrémités et tangentes d'extrémité imposées exactement.
- `src/domain/services/longRails.ts` (`mergeIntoLongRails`) : chaque enfilade de petits rails entre
  deux nœuds utiles devient un rail long ; signaux, zones, trains et tables d'aiguillage suivent
  (`replaceRail`, les rails courbes reportés en 8 pas). Option « une courbe par rail ».
- Édition ▸ « Simplifier en rails longs » (`store.simplifyToLongRails`), annulable.

Mesures sur Marseille Saint-Charles (tolérance 0,3 m) :

| | Petits rails | Rails longs | Rails longs, une courbe par rail |
|---|---|---|---|
| Rails | 1 503 | 288 | 313 |
| Nœuds | 1 441 | 226 | 251 |
| Fichier JSON | 234 ko | 129 ko | 135 ko |
| Chargement (désérialisation) | 139 ms | 63 ms | 58 ms |
| Image, script seul (0,7 / 2,2 / 6 px/m) | 3,5 / 4,5 / 4,1 ms | 1,6 / 2,6 / 2,1 ms | 1,6 / 2,6 / 2,0 ms |

Longueur totale conservée à 0,1 % près ; 124 aiguillages et 20 TJD relus à l'identique ; un point
de la voie reste à moins de 1,1 m de sa place (écart latéral ≤ tolérance, le reste en longueur) ;
aucune erreur cinématique ; la réconciliation ne retouche rien.

### Lot B — reste
- [ ] Vitesse, dévers et déraillement **par courbe** à l'intérieur d'un rail long (aujourd'hui : la
      courbe la plus serrée vaut pour tout le rail, d'où l'option « une courbe par rail »).
- [ ] Croisement d'une voie dessinée en travers d'un rail long (seul le raccord en bout est géré).
- [ ] Voie parallèle d'un rail long, dévers réglé à la main, profil en long (hauteurs entre deux nœuds).
- [ ] Sélection au rectangle d'un rail long ; libellés du panneau latéral (« Voie droite » affiché).
- [ ] Aimantation de l'éditeur sur un rail long (`getTrackTangentAt`, survol dans `Canvas.tsx`, `getStepPointsAlongSegment`).
- [ ] Conduite d'un train de bout en bout sur Marseille convertie, comparée au réseau d'origine.
- [ ] `fitPath` : `chordTolerance` à régler pour l'import (points OSM espacés) ; cas dégénérés lents.

## Sources des recherches
- Open Rails / MSTS, tronçons droite ou arc : https://raw.githubusercontent.com/openrails/openrails/master/Source/Orts.Formats.Msts/TrackSectionsFile.cs
- Open Rails, position = tronçon + distance, rayon lu sur la pièce : https://raw.githubusercontent.com/openrails/openrails/master/Source/Orts.Simulation/Simulation/Traveller.cs
- OpenDRIVE 1.7, suite de pièces ligne / arc / spirale avec pose de départ : https://www.asam.net/fileadmin/Standards/OpenDRIVE/ASAM_OpenDRIVE_BS_V1-7-0.html
- railML 3, `horizontalCurve` : https://wiki3.railml.org/wiki/IS:horizontalCurve
- RailTopoModel, coordonnée intrinsèque 0…1 : https://wiki.railtopomodel.org/wiki/Intrinsic_positioning_/_referencing
- Chemins courbes, arcs et parallèles : https://www.redblobgames.com/articles/curved-paths/
- Splines d'arcs, approximation d'une clothoïde : https://www.forwiss.uni-passau.de/extern/doc/ITSC_2011.pdf
- Ajustement en segments et arcs sous tolérance : https://arxiv.org/pdf/1604.07476
- NIMBY Rails, arcs et droites puis splines : https://carloscarrasco.com/nimby-rails-june-2023/
- Bézier : pas de longueur ni de parallèle exactes : https://pomax.github.io/bezierinfo/
- Bug Chrome sur les arcs de très grand rayon : https://foosel.net/blog/2021-05-09-a-debugging-story/
- Précision float32 des chemins Skia : https://projectzero.google/2018/07/drawing-outside-box-precision-issues-in.html
