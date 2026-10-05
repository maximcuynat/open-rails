# Performance du canvas sur les grands réseaux — plan après recherches

## Contexte

L'exemple Marseille Saint-Charles (1 441 nœuds, 1 503 rails, 144 jonctions, 140 zones de vitesse)
rend l'éditeur lent, surtout dézoomé, et la vue d'ensemble est encombrée d'étiquettes. Demande :
recherches approfondies, pas de code, un plan ; première étape = retirer des étiquettes au dézoom.

Entre-temps la branche `feature/render-lod` a été fusionnée (129f071) : trois paliers
`detail` / `line` / `schematic` selon l'écart des rails à l'écran (`src/infrastructure/render/lod.ts`),
voies groupées en un tracé (`lodTracks.ts`), pastilles de section sans chevauchement
(`lodOverlays.ts → placeBadges`), cache `networkDerived.ts`, banc `render.bench.ts`. Le plan part de là.
`tasks/todo.md` est en cours de modification par une autre session (dévers/pentes visibles) : ce
plan vivra dans son propre fichier `tasks/plan-perf-canvas.md`.

## Ce que disent les mesures (Chromium headless, 1600×1000, serveur de dev)

| Vue | Palier | Appels canvas / image | Coût |
|---|---|---|---|
| Vue d'ensemble (0,6 px/m) | line | 6 800 (347 `stroke`, 137 `fillText`) | dessin ≈ 2–6 ms, **mais ≈ 130 ms de calcul par cran de molette** |
| Zoom moyen (≈ 2,2 px/m) | detail | **107 000** (10 400 `stroke`, 55 000 `lineTo`, 3 600 `save`) | ≈ 150 ms / image |
| Zoom fort | detail | 79 000 | ≈ 80–110 ms / image |

Profil CPU en vue d'ensemble (ms par rafraîchissement) : détection des boucles 43
(`domain/services/pathfinding.ts`, appelée par `SidePanel.tsx:407`), `computeTrackSections` 29
(appelée 5× dans `SidePanel.tsx`, + `contextBarModel.ts:177`, + `savePersistedState`), `curveLength` 9,
`findJunctionAtNode` 6 (balayage linéaire, `routing.ts:48`). Le dessin lui-même : < 3 ms.

**Trois causes distinctes, donc :**
1. Dézoomé, le canvas n'est pas le problème : chaque `notify()` (molette, **chaque `pointermove`** —
   `Canvas.tsx:2245`, chaque tic de simulation) relance `syncJunctions`, redessine tout, redessine
   la minimap (≈ 3 000 appels non regroupés) et re-rend tout l'arbre React, dont le panneau latéral
   qui recalcule sections, boucles et composantes du graphe sans cache.
2. Au zoom moyen, le palier `detail` trace chaque rail séparément alors que ~80 % du réseau est
   encore visible : c'est le pire cas en dessin pur.
3. Les étiquettes : les pancartes de zone « Z 30 » / « R 30 » (début / fin de zone — pas un rayon)
   n'ont aucune règle de zoom ni d'anti-chevauchement (jusqu'à 280), chacune avec `measureText`.

Côté littérature (MDN, web.dev, Chromium/Skia, OpenLayers, Mapbox, Leaflet, Felt, tldraw,
Excalidraw, OpenRailwayMap) : le dézoom se règle par **niveaux de détail + regroupement des tracés
+ ne rien recalculer ni redessiner sans changement**. Le culling n'aide pas dézoomé (tout est
visible). Canvas 2D bien regroupé tient largement 10× ce réseau ; à 50× il faut en plus un cache
bitmap pour le déplacement.

## Plan, par lots (chacun mesuré avant / après, livrable séparément)

### Lot 0 — Mesure reproductible
- Étendre `render.bench.ts` à l'exemple Marseille aux trois échelles (0,3 / 0,7 / 2,2 px/m) :
  nombre d'appels par type et temps JS, avec le contexte enregistreur des tests existants.
- Script de mesure navigateur (appels canvas + profil CPU par cran de molette) rangé dans `tools/`.
- Générateur de réseau 10× (grille de copies de Marseille) pour vérifier que ça tient à l'échelle.
- Objectif chiffré : < 8 ms par image en vue d'ensemble et au zoom moyen, 0 calcul quand rien ne change.

### Lot 1 — Étiquettes au dézoom (**change l'affichage** — c'est la demande)
Tout dans `lodOverlays.ts` / `speedZoneRender.ts`, seuils en pixels d'écartement des rails comme
l'existant (valables à toutes les échelles de modélisme).
- Pancartes Z / R : affichées au palier `detail` seulement ; aux paliers `line` et `schematic`,
  uniquement pour la zone sélectionnée ou en alerte. Au palier `detail`, passage par `placeBadges`
  (déjà utilisé pour les sections) pour ne plus se superposer, priorité : sélection, alerte, zone la plus longue.
- Bandes orange des zones : conservées au palier `line` (elles portent l'information sans texte),
  masquées au palier `schematic` sauf sélection — aujourd'hui elles font 5 px mini, plus larges que la voie.
- Marqueurs de diagnostic et conflits de sens : regroupement (`clusterMarkers`) étendu au palier `line`.
- Anneaux des fins de voie : gardés au palier `line` (ils servent à prolonger une voie), inchangés.
- Remplacer les deux seuils en échelle brute (`SIMPLIFY_THRESHOLD`, `scale >= 0.9` dans
  `diagnosticMarker.ts`) par des seuils en pixels.
- Cache des largeurs de texte (`measureText`) par police + chaîne, partagé par pastilles, pancartes, diagnostics.
- Tests : compléter `lodOverlays.test.ts` et les tests de zones de `trackLevels.test.ts`.

### Lot 2 — Ne rien recalculer quand seule la caméra ou la souris bouge (aucun pixel modifié)
Le plus gros gain mesuré en vue d'ensemble.
- `Canvas.tsx` : ne plus appeler `store.notify()` à chaque `pointermove` ; ne notifier que si le
  survol ou une prévisualisation a réellement changé ; le déplacement / zoom de caméra redessine le
  canvas sans passer par React (signal « caméra » séparé du compteur de version des données).
- `notify()` (`editorStore.ts`) : `syncJunctions` / `cleanSpeedZones` seulement quand le réseau a
  changé, pas sur un changement de caméra, de survol ou un tic de simulation.
- Panneau latéral, barre contextuelle : lire les sections dans `networkDerived` au lieu de
  rappeler `computeTrackSections` (6 sites) ; mettre boucles / composantes / culs-de-sac / analyse
  cinématique dans le même cache ; ne pas rendre le contenu du panneau quand il est replié.
- `findJunctionAtNode` : table nœud → jonction tenue à jour, au lieu du balayage linéaire.
- `networkDerived` : clé par compteur de révision au lieu de la comparaison complète à chaque image.
- Minimap : regroupée sur `requestAnimationFrame`, fond du réseau gardé en bitmap, seul le
  rectangle de vue redessiné au déplacement.
- `getComputedStyle` (≈ 8 par image) : couleurs du thème mises en cache, invalidées au changement de thème.
- `hitSegment` (survol, outil sélection) : rejet par boîte englobante avant l'échantillonnage des courbes.

### Lot 3 — Palier `detail` au zoom moyen (pixels à valider)
- Sans changement de pixel : géométrie écran-indépendante de chaque rail mise en cache (points des
  deux files, intervalles d'aiguillage, joints), suppression du double `curveLength` inutile
  (`renderer.ts:1681`), suppression des `save` / `restore` par rail.
- Avec changement possible d'un pixel d'anticrénelage aux raccords (**à signaler et valider par
  comparaison d'images**) : regrouper les rails de même style en un tracé par style, comme au
  palier `line` — vise 10 400 → quelques dizaines de `stroke`. Le test `lodTracks.test.ts:221` sera à réécrire.
- Bande centrale des sections : un tracé par couleur au lieu d'un par rail.

### Lot 4 — Calques : ce qui bouge séparé de ce qui ne bouge pas
- Deux canvas empilés : réseau statique (grille, voies, étiquettes, `alpha: false`) et dynamique
  (trains, itinéraire, prévisualisations d'outil, gizmo, sélection au survol).
- Drapeau « à redessiner » par calque : en conduite, seuls les trains sont redessinés à 60 i/s,
  quel que soit le nombre de rails ; au survol, seul le calque dynamique.
- Ordre de superposition trains / ponts à préserver (les niveaux intercalent trains et voies) : à
  traiter en gardant les trains sous un pont dans le calque statique-par-niveau, ou en ne séparant
  que quand un seul niveau est en vue. Point de conception à trancher au début du lot.

### Lot 5 — Seulement si les lots 1–4 ne suffisent pas à 10×
- Dégradation pendant le geste : palier et étiquettes figés pendant molette / déplacement, passe
  nette ~150 ms après (OpenLayers, tldraw).
- `Path2D` en coordonnées monde par (case de grille × style × palier), dessinés avec
  `setTransform` ; la même grille sert d'index spatial pour le culling et le picking.
- Bitmap du calque statique avec marge : translaté au déplacement, mis à l'échelle pendant le
  zoom, redessiné net à l'arrêt (Leaflet, OpenLayers `VectorImageLayer`).

### Écarté, avec la raison
- Culling comme remède au dézoom : tout est visible, gain nul.
- `OffscreenCanvas` dans un worker : ne réduit pas le travail de tracé, impose de dupliquer l'état.
- Tuiles raster, rectangles sales sur le calque statique : complexité élevée pour des traits fins.
- `desynchronized`, `willReadFrequently`, lecture de pixels pour le picking : sans gain ou nuisibles.
- WebGL : le seuil se situe vers 50–100 000 primitives animées en plein détail ; on en est loin.

## Ordre proposé et gains attendus
1. Lot 0 puis Lot 1 (visible tout de suite, demandé).
2. Lot 2 (vue d'ensemble : ≈ 130 ms → quelques ms par cran ; survol : plus aucun recalcul).
3. Lot 3 (zoom moyen : ≈ 150 ms → objectif < 10 ms).
4. Lot 4, puis réévaluer avec le réseau 10× avant d'ouvrir le Lot 5.

## Vérification
- `npm test` et `npm run typecheck` à chaque lot ; banc `render.bench.ts` avant / après, chiffres notés dans le plan.
- Navigateur : script de mesure sur Marseille aux trois échelles + réseau 10×, onglet Performance
  de Chrome sur la machine réelle (le headless rend en logiciel et exagère le coût de tracé).
- Lots 3 et 4 : captures avant / après aux mêmes caméras, comparées pixel à pixel ; tout écart est
  montré avant d'être gardé (règle de `tasks/lessons.md`).
- Lot 1 : captures de la vue d'ensemble et du zoom moyen, à valider visuellement.

## Suivi

- [x] Lot 0 — mesure reproductible
- [x] Lot 1 — étiquettes au dézoom
- [x] Palier intermédiaire « rails » (ajouté le 2026-10-05 à la demande : dégrader comme une carte)
- [x] Lot 2 — aucun recalcul quand seule la caméra bouge (reste : survol de la souris, voir plus bas)
- [x] Lot 3 — palier `detail` : rails, bandes de section et joints regroupés par style
- [ ] Lot 4 — calques statique / dynamique
- [ ] Lot 5 — à réévaluer sur le réseau 10×

### Lot 0 — fait
- `npm run bench` : entrées « Marseille Saint-Charles » (0,3 / 0,7 / 2,2 px/m) et « 9 stations »
  (13 527 rails) dans `src/infrastructure/render/render.bench.ts`.
- `tools/perf/measure-canvas.cjs` : appels canvas par image et profil CPU par rafraîchissement,
  dans un Chromium à part (mode d'emploi en tête du fichier).

### Lot 1 et palier « rails » — fait
Quatre paliers, selon l'écart des rails à l'écran (`lod.ts`) :

| Palier | Écart des rails | Échelle à 1:1 | Voies | Repères |
|---|---|---|---|---|
| `schematic` | < 0,5 px | < 0,35 px/m | une ligne par section, d'une seule couleur, assez large pour toucher la voie voisine : une gare est un trait épais qui s'affine en s'éloignant | sélection seule ; ni bande ni pancarte de zone |
| `line` | 0,5 – 3 px | 0,35 – 2,1 px/m | une ligne par voie | fins de voie ; bandes de zone ; aucune pancarte ; pastilles des seules sections longues (≥ 240 px), nommées ou sélectionnées ; diagnostics regroupés |
| `rails` | 3 – 5 px | 2,1 – 3,5 px/m | deux rails en quelques tracés (liseré), bande de section par couleur | tous les nœuds (deux remplissages) ; heurtoirs ; pastilles et pancartes des seuls éléments longs (≥ 240 px) |
| `detail` | ≥ 5 px | ≥ 3,5 px/m | rail par rail, joints, champignon | tout |

- Le zoom par défaut d'un réseau 1:1 (2,5 px/m) tombe dans le palier `rails` : deux rails et bande
  de section, sans reflet du champignon ni joints ; le plein détail vient un cran de molette plus
  près. Les échelles de modélisme restent toujours en `detail`.
- Pancartes Z / R : plus jamais superposées (`placeBadges`), la zone la plus longue garde la sienne.
- Largeurs de texte mesurées une fois (`textWidth.ts`).

Mesures sur Marseille (appels canvas par image, navigateur headless 1600×1000) :

| Vue | Avant | Après |
|---|---|---|
| Vue d'ensemble (0,6 px/m) | 6 800 — 347 `stroke`, 137 `fillText`, 137 `measureText` | 5 400 — 75 `stroke`, 1 `fillText`, 1 `measureText` |
| Zoom moyen (2,2 px/m) | 107 000 — 10 400 `stroke`, 3 574 `save` | 13 900 — 215 `stroke`, 113 `save` |
| Zoom fort (palier `detail`) | 79 000 — 2 800 `stroke`, 64 000 `lineTo` | 9 700 — 135 `stroke`, 2 000 `lineTo` |

Réglages à ajuster au goût, une constante chacun : `LOD_RAILS_BELOW_PX` (début du plein détail),
`LABEL_MIN_LENGTH_FAR_PX` (longueur à l'écran à partir de laquelle une voie ou une zone est
nommée hors du plein détail). Les points de tous les nœuds restent affichés au palier `rails`
(on peut encore les saisir) : n'y garder que les aiguillages et les fins de voie allégerait encore.

### Lot 3 — fait
- Rails du palier `detail` : chaque file de rail d'une courbe est une courbe quadratique décalée
  (`addOffsetCurve`, écart < 1 % de l'écartement) au lieu de 32 segments ; tous les rails d'un
  même style en un tracé (`renderDetailRails`), comme les bandes de section et les joints.
- Écarts d'aspect possibles, de l'ordre du pixel d'anticrénelage : aux croisements les
  champignons passent tous au-dessus des patins ; dans un tunnel, un joint sur une branche
  fermée est atténué deux fois (comme ses rails) au lieu d'une.
- Reste : géométrie écran-indépendante en cache (le calcul est refait à chaque image).

### Lot 2 — fait pour la caméra
Script par rafraîchissement de la vue d'ensemble de Marseille : **≈ 110 ms → 3,7 ms**.
- Analyses du graphe (sections, boucles, culs-de-sac, composantes, cinématique, conflits de sens)
  lues dans `networkDerived` par le panneau latéral, la barre contextuelle, le canvas et la sauvegarde.
- `findJunctionAtNode` : index nœud → jonction (`routing.ts`). **Contrat** : tout code qui ajoute,
  retire ou déplace une jonction sans passer par les fonctions de `junction.ts` appelle
  `invalidateJunctionIndex(net)` (documenté sur `Network.junctions`).
- `store.notifyView()` : molette et déplacement de la vue redessinent canvas et minimap sans
  re-rendre React ni relancer les synchronisations du réseau. À n'utiliser que si rien de ce
  qu'un panneau affiche n'a changé.
- Panneau latéral replié : plus aucun calcul. Minimap : un tracé par image.

Reste du lot 2 :
- [ ] Survol : chaque `pointermove` appelle encore `notify()` (un rendu React + un tracé complet).
- [ ] `networkDerived` par compteur de révision (sa comparaison est devenue le premier poste, ≈ 1 ms).
- [ ] Minimap en bitmap, cache de `getComputedStyle`, boîte englobante dans `hitSegment`.

## Recherches : ce qui a été retenu, et d'où ça vient

**Regrouper les tracés** — un chemin et un `stroke()` par style ; c'est le seul regroupement que
Canvas 2D offre. AG Grid mesure 287 ms → 15 ms pour 100 000 points en regroupant et en sortant
`save` / `restore` de la boucle. Attention aux bandes translucides : regroupées, leurs
recouvrements ne s'assombrissent plus.
- https://www.ag-grid.com/blog/optimising-html5-canvas-rendering-best-practices-and-techniques/
- https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas
- https://web.dev/articles/canvas-performance
- https://discourse.wicg.io/t/why-is-canvas-2d-so-slow/2232/

**Niveaux de détail d'après la taille à l'écran** — règles par plage de zoom des moteurs de carte ;
OpenRailwayMap n'affiche voies de service, quais et leurs étiquettes qu'à partir de certains zooms ;
tldraw et Felt simplifient et masquent au dézoom ; tldraw fige le niveau de zoom pendant le geste.
- https://docs.mapbox.com/style-spec/reference/layers/
- https://github.com/OpenRailwayMap/OpenRailwayMap-CartoCSS/blob/master/standard.mss
- https://tldraw.dev/sdk-features/performance
- https://felt.com/blog/from-svg-to-canvas-part-1-making-felt-faster

**Étiquettes** — placement glouton par priorité avec test de collision (OpenLayers `declutter`,
Mapbox avec une grille de 25 px) ; le texte est cher : mettre les largeurs en cache, voire le rendu
en bitmap.
- https://github.com/mapbox/mapbox-gl-js/pull/5150
- https://github.com/openlayers/openlayers/pull/7328
- https://www.mirkosertic.de/blog/2015/03/tuning-html5-canvas-filltext/

**Calques et cache bitmap** — séparer par fréquence de mise à jour (MDN, web.dev, Excalidraw :
canvas statique + canvas interactif) ; Leaflet et OpenLayers réutilisent l'image pendant le
déplacement et le zoom et redessinent net à l'arrêt.
- https://openlayers.org/en/latest/apidoc/module-ol_layer_VectorImage-VectorImageLayer.html
- https://github.com/leaflet/leaflet/issues/9961
- https://konvajs.org/docs/performance/All_Performance_Tips.html

**`Path2D` et index spatial** — la transformation s'applique au moment du `stroke(path)` : un
chemin en coordonnées monde se réutilise d'une image à l'autre ; Felt les garde dans des `WeakMap`.
Une grille uniforme suffit comme index (Mapbox l'a préférée à un R-tree).
- https://html.spec.whatwg.org/multipage/canvas.html
- https://developer.mozilla.org/en-US/docs/Web/API/Path2D/addPath
- https://github.com/mourner/flatbush

**Planification** — un drapeau « à redessiner » et une seule boucle `requestAnimationFrame` ; ne
pas dessiner dans les gestionnaires de pointeur ; garder caméra et survol hors de l'état React.
- https://developer.chrome.com/blog/aligning-input-events
- https://github.com/excalidraw/excalidraw/issues/10063

**Pièges** — une lecture de pixels (`getImageData`) fait basculer le canvas en rendu logiciel
(0,1 ms → 47 ms par image dans le test cité) ; `desynchronized` ne sert que la latence du stylet ;
`OffscreenCanvas` en worker ne réduit pas le tracé.
- https://www.schiener.io/2024-08-02/canvas-willreadfrequently
- https://developer.chrome.com/blog/desynchronized
- https://web.dev/articles/offscreen-canvas

**Où Canvas 2D s'arrête** — les plafonds cités (Excalidraw ~8–14 000 éléments, iD) viennent de
rendus élément par élément ; en tracés regroupés, le seuil est plutôt vers 50–100 000 primitives
animées en plein détail.
- https://github.com/excalidraw/excalidraw/issues/8136
- https://deck.gl/docs/developer-guide/performance
