# Performances navigateur sur les très grands réseaux — plan

## Contexte

Demande : que l'éditeur reste fluide dans un navigateur avec beaucoup de rails. Travail dans le
worktree `../open-rails-perf`, branche `feature/perf-navigateur` (partie de `developement`, 8bb1407).

Deux plans précédents (`tasks/plan-perf-canvas.md`, `tasks/plan-grands-reseaux.md`) ont déjà réglé
le **dessin** (paliers de détail, tracés regroupés) et la conduite. Ce qui reste coûte ailleurs,
et grandit avec la taille du réseau :

| Constat (lu dans le code, 8bb1407) | Où | Quand |
|---|---|---|
| Chaque mouvement de souris appelle `store.notify()` : resynchronise jonctions, zones, signaux, re-rend tout React, repeint tout | `Canvas.tsx:2266` | à chaque `pointermove` |
| Le réseau entier est recomparé valeur par valeur pour savoir s'il a changé (pas de compteur de révision), + `JSON.stringify(sectionMeta)` | `networkDerived.ts:122-188, 273`, `trackSpeed.ts:99`, `signalBlocks.ts:80`, `speedSigns.ts:155` | à chaque image, plusieurs fois |
| `reconcileNetworkIntersections` compare chaque nœud à chaque rail et chaque rail à chaque rail, jusqu'à 40 passes | `reconcile.ts:301-500` | après chaque édition, annulation, chargement |
| Chaque édition sérialise tout le projet deux fois (sauvegarde + annulation) et écrit dans localStorage, qui échoue en silence au-delà de ~5 Mo | `editorStore.ts:1601-1607`, `persistence.ts:682-735` | à chaque `markDirty` (42 sites) |
| Aucun index spatial : tri des rails visibles, survol, accrochage = parcours de tout le réseau, 32 points par courbe avant tout rejet | `renderer.ts:578`, `network.ts:817`, `locomotive.ts:1237` | par image / par mouvement |
| Minimap : un `stroke` par rail à chaque rafraîchissement ; ~8 `getComputedStyle` par image | `MiniMap.tsx:66-90`, `renderer.ts:57-66` | par image |

Mesure de départ (`npm run bench`, script seul, canvas factice) : 13 527 rails → 9 à 16 ms par
image ; un seul des neuf blocs à l'écran coûte encore 15,7 ms contre 8,3 ms pour ce bloc seul : le
surcoût vient des comparaisons du réseau, pas du tracé. À 100 000 rails : ~100 ms par image.

**Cible** : 100 000 rails (ordre de grandeur de la carte LGV du plan « grands réseaux ») —
survol et déplacement de vue sans calcul proportionnel au réseau, une édition validée < 100 ms.

**Règle de ce plan : aucun pixel ne change** (leçon du 2026-10-05). Ce qui en déplacerait un est
listé à part, non fait.

**Contrainte** : une autre session travaille en ce moment dans `../open-rails-grands-reseaux`
(lot A : `segmentGeometry.ts`, et `curve.ts`, `locomotive.ts`, `network.ts`, `sections.ts`,
`signals.ts`, `speedSigns.ts`, `pathfinding.ts` modifiés non commités). Ici : modules nouveaux
autant que possible, retouches d'une ligne dans ces fichiers, aucune réécriture de leurs fonctions.

## Lot 0 — Mesure à 100 000 rails

- `src/infrastructure/render/render.bench.ts` : entrée `buildStations(9)` (~122 000 rails) —
  vue d'ensemble et un bloc en vue.
- Nouveau `src/application/state/scale.bench.ts` sur le même réseau : `notify()`, survol
  (`hitSegment` + `hitNode`), édition validée (`reconcileNetwork` + `markDirty`), `undo()`,
  `deserializeNetwork`.
- `tools/perf/make-stations.mjs` : écrit un projet JSON de N×N gares (hors dépôt), à ouvrir par
  Fichier ▸ Importer pour la mesure en navigateur.
- Chiffres « avant » notés dans `tasks/plan-perf-navigateur.md` (copie de ce plan dans le worktree ;
  `tasks/todo.md` n'en garde qu'un renvoi, il est réécrit par d'autres sessions).

## Lot 1 — Un compteur de révision du réseau (la fondation)

Aujourd'hui « le réseau a-t-il changé ? » = recomparer tout. Remplacé par un compteur exact :

- `src/domain/models/networkWatch.ts` devient le module de révision : `networkRevision(net)`,
  `touchNetwork(net)`. Compteur tenu dans une `WeakMap` (le type `Network` ne change pas).
- `createNetwork()` (`network.ts:31`) crée des `Map` suivies (sous-classe dont `set` / `delete` /
  `clear` incrémentent la révision) : tout ajout ou retrait de nœud, rail, jonction, zone, signal
  est compté sans toucher aux ~40 fonctions qui les font.
- Écritures en place (≈ 30 sites recensés : `node.pos`, `seg.via`, `node.level`, `seg.cant`,
  `junction.active`, portées de zones, champs de signaux — `nodeTransform.ts`, `junction.ts`,
  `reconcile.ts`, `network.ts:162,188`, `editorStore.ts:1672-1680,3128`, `SidePanel.tsx:578-584`,
  `speedZones.ts`, `signals.ts`) : un `touchNetwork(net)` après chacune.
- Un réseau construit sans `createNetwork()` n'a pas de révision : comparaison complète, comme avant.
- **Filet** : en test (fichier `setupFiles` de Vitest), chaque lecture de révision est recoupée
  avec la comparaison complète actuelle (`NetworkSnapshot` étendu aux zones et signaux) et lève
  une erreur si le contenu a changé sans que la révision bouge. Toute la suite existante devient
  le détecteur d'un `touchNetwork` oublié.
- Consommateurs rebranchés sur la révision : `networkDerived` (et sa clé `sectionMeta` : révision
  tenue par les setters du store au lieu de `JSON.stringify` à chaque appel),
  `trackGeometryRevision`, `routeTablesRevision`, `routeTablesKey`, index des jonctions
  (`routing.ts`).
- `notify()` (`editorStore.ts:1078`) : `syncJunctions` / `cleanSpeedZones` / `cleanSignals` /
  `syncTrainsWithNetwork` seulement si la révision a bougé depuis le dernier passage.
- `holdNetwork` / `releaseNetwork` / `networkChanged` / `networkCheckToken` supprimés : la
  révision les remplace en conduite comme en édition (un seul mécanisme).

## Lot 2 — Souris et image : ne rien refaire sans changement

- `Canvas.tsx` `onMove` : plus de `notify()` inconditionnel. Nouveau `store.notifyUi()` (version +
  abonnés, sans rien du réseau) appelé seulement si le survol ou la prévisualisation a changé ;
  sinon rien, ou `notifyView()` quand seul le canvas suit le curseur. Idem pour les autres appels
  par image : bord d'écran (`:1130`), molette en outil train (`:2496`), `checkTrainHover`,
  `updateLocomotivePreview`, clic minimap, `fitView` / `resetZoom`, boucle de l'ancienne
  locomotive (`editorStore.ts:2601`).
- Couleurs du thème : cache par canvas dans `getCanvasStyle` (`renderer.ts:57`), vidé au
  changement de thème.
- Minimap (`MiniMap.tsx`) : fond du réseau gardé en bitmap à la résolution de l'écran, refait
  quand la révision change ; seul le rectangle de vue est retracé au déplacement.
- Panneaux : longueur totale (`SidePanel.tsx:380-396`), `detectCrossings` (`:566`) et
  `signalReport` (`:199`) passent dans `networkDerived` (calculés une fois par révision).
- `hitSegment` (`network.ts:817`) et `projectOnSegment` (`locomotive.ts:1191`) : rejet par boîte
  englobante avant d'échantillonner la courbe (même résultat, test d'équivalence).

## Lot 3 — Coût d'une édition, de l'annulation, du chargement

- `reconcile.ts`, `crossing.ts:229-310`, `kinematicDiagnostics.ts:91-133` : les candidats
  viennent d'une grille uniforme locale (nouveau `src/domain/geometry/spatialGrid.ts`, pur,
  reconstruite à chaque passe donc jamais périmée) au lieu de toutes les paires. Candidats
  parcourus dans l'ordre d'origine : mêmes décisions qu'aujourd'hui, test de comparaison
  ancien / nouveau sur réseaux aléatoires.
- `markDirty()` : une seule sérialisation, partagée entre l'annulation et la sauvegarde.
- Sauvegarde automatique différée (au repos, ~400 ms) et forcée sur `pagehide` / `beforeunload`
  (déjà branchés, `App.tsx:45-55`). Échec de quota : message affiché une fois (« projet trop
  volumineux pour la sauvegarde automatique, exportez-le ») au lieu d'un `console.warn`.
- Historique : le plafond de 50 devient un budget (nombre de pas réduit quand le réseau est gros).
- Chargement (`persistence.ts`) : `Math.max(...ids)` (`:597`, erreur de pile vers 200 000
  identifiants) remplacé par une boucle ; restauration des jonctions sans reconstruire l'index à
  chacune (`:383,415`).

## Lot 4 — Index spatial partagé pour l'image et le survol

Possible une fois la révision exacte (lot 1) : une grille par réseau, refaite quand la révision change.
- `segmentsInBounds` (`renderer.ts:578`, appelé jusqu'à deux fois par image) et les boucles
  « tous les nœuds » du rendu (heurtoirs `:1041`, points `:1054`, joints `:2234`) interrogent la grille.
- `hitNode`, `findNearestNode`, `hitSegment`, `snapToNearestTrack`, `getTrackTangentAt` : variantes
  indexées pour le survol et la prévisualisation ; résultat identique au parcours complet (ordre
  d'origine conservé, test d'équivalence).

## Hors de ce plan (à décider après mesure)

- Calques statique / dynamique, `Path2D` par case, bitmap pendant le déplacement : touchent aux
  pixels (ordre trains / ponts), à valider par comparaison d'images.
- Mise à jour incrémentale des données dérivées (sections, profil, cantons) : après ce plan, un
  nœud déplacé sur un réseau de 100 000 rails recalcule encore tout à chaque mouvement.
- Sauvegarde en IndexedDB, annulation par différences, chargement hors du fil principal.
- `computeTrackSections` (parties quadratiques), `detectLoops` (récursion aussi profonde que la
  ligne) : dans des fichiers en cours de modification par l'autre session — à reprendre après sa fusion.

## Vérification

- À chaque lot : `npm test`, `npm run typecheck`, `npm run build` ; `npm run bench` avant / après,
  chiffres notés dans `tasks/plan-perf-navigateur.md`.
- Lot 1 : la suite complète tourne avec le recoupement révision / comparaison activé.
- Lots 2 et 4 : tests de rendu existants inchangés (mêmes appels canvas) ; captures aux mêmes
  caméras avant / après, comparées pixel à pixel, sur Marseille.
- Navigateur (`npm run dev` + `tools/perf/measure-canvas.cjs`, et le fichier de 9×9 gares
  importé) : survol, déplacement de vue, pose d'un rail, annulation, conduite d'un train.
- Aucun commit sans demande ; un message de commit proposé par lot.

## Suivi (2026-10-06)

- [x] Lot 0 — bancs à 13 527 et 121 743 rails (`npm run bench`, `SCALE_COPIES=9` pour le grand), `tools/perf/make-stations.mjs`
- [x] Lot 1 — révision du réseau (`networkWatch.ts`), vérifiée dans tous les tests
- [x] Lot 2 — survol sans notification, minimap en bitmap, totaux et croisements du panneau gardés avec les données dérivées
- [x] Lot 3 — réconciliation incrémentale, trous et croisements par grille, sauvegarde différée, historique borné, annulation sans réconciliation
- [x] Lot 4 — index spatial partagé (`networkFollower.ts`) pour le tri des rails visibles, le survol et l'accrochage
- [ ] Non fait : cache des couleurs du thème (gain négligeable mesuré), une seule sérialisation pour sauvegarde et annulation

### Mesures (script seul, canvas factice ; avant = commit 8bb1407)

| | 13 527 rails avant | après | 121 743 rails après |
|---|---|---|---|
| Notification sans changement | 7 ms | 0,01 ms | 0,02 ms |
| Données dérivées redemandées | 15 ms | 0,04 ms | 0,06 ms |
| Mouvement de souris (nœud + rail) | 20 ms | 0,1 ms | 0,2 ms |
| Mouvement de souris (voie la plus proche) | 60 ms | 0,1 ms | 0,2 ms |
| Édition validée (écriture en stockage comprise) | 6 460 ms | ~260 ms | ~3 400 ms |
| — dont réconciliation | non isolé | 11 ms | ~150 ms |
| — dont sections et diagnostics | non isolé (sections seules : 3 300 ms) | ~160 ms | ~2 000 ms |
| Annuler puis rétablir | 12 700 ms | ~800 ms | ~11 700 ms |
| Relecture d'un projet | 4 200 ms | ~900 ms | ~11 000 ms |
| Boucles du panneau « Réseau » | 2 520 ms | 26 ms | 260 ms |

| Une image à 121 743 rails | avant | après |
|---|---|---|
| Une gare en vue (2,2 px/m) | 75 ms | 9,4 ms |
| Palier « ligne » (0,7 px/m) | 57 ms | 16 ms |
| Schématique (0,3 px/m) | 19,5 ms | 5 ms |
| Tout le réseau (0,067 px/m) | 63 ms | 15 ms |

Navigateur (Chromium sans écran, rendu logiciel, 1600×1000) : aucune erreur de page sur Marseille,
13 527 et 121 743 rails ; pose d'un rail, annulation, rétablissement et conduite corrects ; 60
mouvements de souris en sélection = 0 tracé sur le canvas. À 121 743 rails un clic qui modifie le
réseau prend 4,5 à 5 s et une annulation 3,7 s.

### Aspect

Captures de Marseille (vue d'ensemble, 3 et 7 crans de zoom) comparées pixel à pixel au commit
8bb1407 : identiques, et les appels canvas de l'image sont les mêmes un à un. Une seule variation,
côté base : avec `measure-canvas.cjs` non modifié, la base rend 18 pixels (écart ≤ 6/255) autrement
que dans tous les autres déroulés rejoués ; non expliqué, la branche rend toujours l'autre image.

Seul changement visible : la pastille « modifié » de la barre du haut passe au rouge, avec une
infobulle, quand le navigateur n'a pas pu enregistrer le projet (trop volumineux).

### Ce qui limite encore l'édition d'un très grand réseau

Après chaque changement, tout est recalculé d'un bloc. À 121 743 rails : sections 2,1 s, profil de
la voie 1,2 s (paliers `detail` et `rails`), longueur totale 0,7 s et boucles / composantes 0,5 s
(panneau « Réseau » ouvert), diagnostics 0,4 s.
- Les longueurs de courbe (`curveLength`) sont recalculées par les sections, le profil et les
  totaux : le lot A de `plan-grands-reseaux.md` (longueurs gardées par rail, déjà dans
  `developement`) en retire une bonne part. À la fusion, `trackTotals` de `networkDerived.ts` est à
  rebrancher sur `segmentShapeLength`.
- Au-delà : sections, profil et diagnostics incrémentaux (ne recalculer que ce qui touche les
  rails modifiés — `NetworkFollower.follow` dit déjà lesquels), annulation par différences,
  sauvegarde en IndexedDB, chargement hors du fil principal.
- Première passe de réconciliation d'un fichier importé : ~1 s par 13 500 rails (11 s à 121 743).
