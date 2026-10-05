# État des lieux : objets attachés à la voie (zones de vitesse, signaux)

Relevé du 2026-10-05 sur `feature/driving-physics`, avant le plan des limites de vitesse et de la signalisation. Lecture seule, aucun test lancé. Version condensée du rapport d'exploration ; les numéros de ligne datent du relevé.

## Trois constats

- **Rien ne fait suivre une position `(segId, t)` à travers une coupe ou une fusion.** Les trains ne survivent qu'aux déformations de rail (`pinTrains` / `realignTrains`) ; sur un rail coupé ils sont supprimés par `pruneTrainsToNetwork`, appelé à chaque `notify()`.
- **`parentSegmentId` n'est pas sauvegardé** (absent de `SerializedSegment`), ne désigne que l'ancêtre racine et ne dit pas quelle partie du rail d'origine un morceau couvre.
- **L'identifiant d'une section est la liste triée de ses segments** (`sections.ts:436`) : il change à chaque coupe, et un seul morceau hérite des réglages. Attacher une limite à une section n'est pas fiable.

## Ce qui change un `segId`

| Opération | Effet |
|---|---|
| `splitSegment` (`junction.ts:604`), `splitSegmentAtNode` (`reconcile.ts:16`) | l'ancien id disparaît, deux nouveaux ; sens conservé |
| Ciseaux sur un nœud (`performTrackCut`) | id conservé, un bout reculé de 0,25 m |
| `dissolveNode` (`network.ts:318`) | deux ids disparaissent, un nouveau ; **sens arbitraire** |
| `weldNodes`, déplacement de nœud, gizmo | ids et `t` conservés, géométrie changée |
| `removeDuplicateSegments` | le plus récent supprimé, le survivant peut être en sens inverse |
| `reconcileNetworkIntersections` | enchaîne tout ça ; tourne après chaque pose, **au chargement et à chaque undo / redo** (`persistence.ts:414`) |

Le réseau est muté depuis plus de vingt endroits (`Canvas.tsx`, menus, barre contextuelle, gabarits, store), sans point de passage commun.

## Le précédent qui tient : les tables d'itinéraires

`replaceJunctionRail(net, oldSegId, pieces)` (`network.ts:397`) est appelé par les quatre fonctions qui remplacent un rail (`splitSegment`, `splitSegmentAtNode`, `dissolveNode`, `removeDuplicateSegments`). Il fonctionne parce que `Junction` vit dans `Network`. C'est le seul mécanisme qui propage un remplacement de rail.

## Outils utiles déjà là

- Projeter un clic : `snapToNearestTrack(net, pos, maxDist) → { segId, t, dist }` (`locomotive.ts:1202`).
- Portion de voie : `TrackSpan { segId, t0, t1 }` et `WalkTrace` (`locomotive.ts:70-80`) — la forme naturelle d'une zone de A à B, déjà utilisée par `trainOccupancy` et `traceAhead`.
- Longueur partielle : `segmentPartialLength` ; dessin d'un tronçon : `subdivideCurve` / `subdivideStraight` (`renderer.ts:367`, `391`).
- Chemin : `findPath` (`pathfinding.ts:119`) va de nœud à nœud seulement ; il faut une enveloppe pour aller de `(segId, t)` à `(segId, t)`.
- Marche vers l'avant sans plafond : `traceAhead` (`train.ts:404`, privée). `sampleForwardTrack` est plafonné à 150 pas et `findJunctionAhead` à 10 segments.
- Niveau d'un point : `trackPositionBand` (`levelPieces.ts:77`).
- Canal vers la physique : `DrivingEnvironment` (`trainDynamics.ts:30`).

## Options de stockage

1. **Dans `Network`, en `(segId, t)`, recalé par les opérations du domaine** (modèle des tables d'itinéraires) : exact, couvre tous les sites d'appel, suit la réconciliation du chargement ; touche le cœur du domaine ; `splitSegment` doit faire remonter son `t` de coupe.
2. **Ancrage en coordonnées monde, reprojeté** (modèle des trains) : insensible aux changements d'id ; ambigu entre voies proches ou superposées ; le trajet d'une zone doit être recalculé par recherche de chemin.
3. **Zone = liste explicite de `TrackSpan[]`, signal = `TrackPosition`**, avec le recalage de l'option 1 : trajet figé à la pose, dessin direct, recherche en O(1) par index de segment, même forme que l'occupation des trains.
4. Par section (`sectionMeta`) : écartée.
5. Nœuds dédiés aux bouts : fragiles (`dissolveNode`, `weldNodes`), alourdissent le réseau.

**Recommandation de l'audit** : option 3 pour les zones et `TrackPosition` (avec `forward` = sens de lecture) pour les signaux, recalés par le mécanisme de l'option 1, plus un ancrage monde pour les déformations sans changement d'id. Appliqué aux trains, le même mécanisme corrigerait leur suppression sur un rail coupé.

**À trancher côté produit** : que devient une zone quand un de ses rails est supprimé, et quand une voie est déplacée.

## Parcours type d'un outil à deux clics (modèle : la mesure)

1. `Tool` (`editorStore.ts:74`) ; `tsc` signale alors le `switch` de `contextBarModel.ts`.
2. État « premier point » dans le store, remis à zéro dans `resetPendingToolState`, compté dans `hadPending` de `cancelInteraction` (Échap en deux temps).
3. Actions `add` / `update` / `remove` finissant par `markDirty()` ; refus en conduite.
4. `ToolBar.tsx` (`TOOLS`), `keybindings.ts` (`tool.<id>`), `useKeyboardShortcuts.ts`.
5. `Canvas.tsx` : branche dans `onDown` près de la mesure, et les **trois** listes d'outils aimantés (rien ne prévient si on en oublie une).
6. Aperçu : `resolve…(store)` dans `placementPreview.ts`, lu par le dessin et par la barre contextuelle.
7. Barre contextuelle : étape, longueur en direct, valeur (compteur comme « Niveau »).
8. Rendu permanent : surlignage dans la passe « tracks » (hérite des niveaux), panneaux dans « overlays » comme le heurtoir.
9. Sélection : champ dédié comme `selectedTrainId`, test de clic avant `hitSegment`, branche en tête de `SidePanel.tsx`, cas dans `deleteSelection`.
10. Persistance : champ optionnel de `SerializedProject`, 18ᵉ paramètre positionnel de `serializeNetwork` (cinq sites), lecture après la réconciliation, ids ajoutés au relevé du compteur ; puis `loadPersistedState`, `loadFromData`, `undo`, `redo`, `newProject`.

## Pièges

1. Sens `from → to` arbitraire, peut se retourner ; un signal a besoin d'une orientation qui y survive.
2. `t` n'est pas une distance sur une Bézier ; trois approximations de longueur coexistent (16, 32 et 64 échantillons).
3. Un nœud déplacé étire tout ce qui est stocké en `t`.
4. Chemin A → B ambigu (boucles, rails doubles, aiguilles) ; une zone qui traverse un aiguillage couvre une branche et pas l'autre.
5. `notify()` tourne à chaque mouvement de souris et à chaque image de conduite ; `trainDynamics` est recalculé à chaque image par le HUD : il faut un index `segId → zones` mis en cache (modèle `networkDerived`).
6. `syncIdCounter` ignore tout ce qui n'est pas nœud, segment ou aiguillage.
7. Les trains sont dessinés au-dessus des « overlays » sur un seul niveau, en dessous dès qu'un pont est visible.
8. `computeTrackSections` écrit dans `sectionMeta` pendant le rendu ; les clés mortes s'accumulent.
9. Aucune donnée ne relie les pièces d'une même courbe (découpées par 15°) : pour reconnaître une courbe il faut marcher de segment en segment tant que le sens de rotation et le rayon se suivent.
10. Les heurtoirs ne sont pas un précédent de stockage : ils sont déduits (nœud à un seul rail), rien n'est sauvegardé.
