# Recalcul incrémental des données dérivées — plan

## Contexte

Le plan « perf navigateur » (livré dans `developement`, v0.4.0) a rendu le survol, le déplacement de
vue et l'image indépendants de la taille du réseau. **Une édition, elle, recalcule encore tout** :
à 122 000 rails, un clic qui pose un nœud isolé coûte 4,5 à 5 s en navigateur, une annulation 3,7 s ;
à 13 500 rails, ~0,5 s par clic. Mesure (script seul, `SCALE_COPIES=9`) de ce que coûte un nœud posé :

| Recalculé en entier après chaque édition | Coût | Où |
|---|---|---|
| Sections (chaînes + nommage + écriture d'une entrée `sectionMeta` **par rail**) | 2,15 s | `domain/models/sections.ts`, `infrastructure/render/networkDerived.ts` |
| Profil de voie (courbes, dévers, rampes) — tiré par le rapport de signalisation même sans marques de dévers | 1,23 s | `domain/models/trackSpeed.ts:341-476` |
| Longueur totale (`curveLength` par rail, jamais mémorisée) | 0,71 s | `networkDerived.ts:332-349` |
| Diagnostics cinématiques (par nœud, par rail, lacunes) | 0,39 s | `domain/services/kinematicDiagnostics.ts` |
| Boucles + composantes (panneau « rien de sélectionné ») | 0,49 s | `domain/services/pathfinding.ts` |
| `syncJunctions` deux fois (fin du raccordement + `notify`) : toutes les tables, tous les nœuds de degré ≥ 3 | 0,26 s | `domain/models/junction.ts:574-608` |
| Pas d'annulation : tout resérialisé + `copySectionMeta` (un objet par rail) | 0,39 s | `editorStore.ts:680-724`, `persistence.ts:197, 211-378` |
| Comparaison du réseau par le suiveur partagé (`networkIndex`) | 0,13 s | `domain/geometry/networkFollower.ts:78-167` |
| Annulation : `deserializeNetwork` → nouveau `Network` → tous les caches à froid | 3,7 s | `editorStore.ts:726-795` |

Demande (étape 5) : « il va vraiment falloir se pencher dessus pour pas que ça lague et refaire des
calculs inutiles ». **Objectif** : le coût d'une édition suit ce qui a changé, pas le réseau —
à 122 000 rails, un clic < 100 ms de JavaScript (hors sauvegarde différée), une annulation < 300 ms ;
à 13 500 rails, < 20 ms.

**Règles** : mêmes résultats qu'aujourd'hui, à l'identique (mêmes sections dans le même ordre, mêmes
noms, couleurs, rampes, diagnostics dans le même ordre — « aucun pixel ne bouge ») ; chaque
calcul incrémental a son **oracle** : en mode vérification (`verifyingNetworkRevisions()`, actif
dans toute la suite via `src/testSetup.ts`), le résultat incrémental est comparé au calcul complet
et une différence lève une erreur, comme `exhaustive` le fait déjà pour `reconcile`. Branche de
travail : `feature/recalcul-incremental` depuis `developement`, dans un worktree ; copie du plan et
suivi des mesures dans `tasks/plan-recalcul-incremental.md`.

## Principe

Un seul **flux de changements** par réseau, tiré du suiveur partagé (`networkIndex`) : chaque
consommateur (sections, profil, diagnostics, tables, historique) tient un curseur et demande « qu'est-ce
qui a changé depuis mon dernier passage ? ». Il reçoit des nœuds et des rails, en déduit la zone
touchée, refait cette zone seulement et remet le résultat dans l'ordre du réseau (rang `ord` des
enregistrements du suiveur). Un curseur trop ancien (journal élagué) ou une zone qui « déborde »
de ce qui était prévu ⇒ recalcul complet, jamais un résultat faux.

## Lot 1 — Flux de changements et mesures par rail (fondation)

`src/domain/geometry/networkFollower.ts`
- `follow` rapporte en plus : `structure` (rail ajouté, retiré ou dont une extrémité a changé —
  un simple déplacement ne touche pas la structure), `reorderedRails` (rails sortis de l'ordre
  relatif précédent : en parcourant l'ancien ordre, un rail dont le nouveau rang est inférieur à
  celui de son prédécesseur, et ce prédécesseur — surensemble, suffisant), et `changedTables`
  (nœuds dont la table de routes est apparue, disparue, ou dont `kind` / `active` / `passages` /
  `positions` / `frogNumber` ont changé : petit enregistrement par table, comparé à chaque passage,
  O(tables)).
- `ChangeFeed` : journal des passages du suiveur partagé, `read(cursor)` rend l'union des
  changements depuis le curseur et le nouveau curseur, `null` si le curseur est perdu (journal
  borné : au-delà de 64 passages ou de n entrées, les curseurs en retard sont perdus). Exposé par
  `networkFeed(net)` ; le jeton `networkCheckToken` reste la garde rapide (rien ne bouge au même jeton).
- `dirtyNodesOf(net, changes)` : `movedNodes ∪ leftNodes ∪ extrémités des changedRails ∪ changedTables`.
- Réseau sans révision (fait à la main) : pas de flux, les consommateurs calculent tout, comme aujourd'hui.

`src/domain/geometry/railMeasures.ts` (nouveau) : longueur de forme par rail (`segmentShapeLength`,
même fonction qu'aujourd'hui) mémorisée par réseau, invalidée par les `changedRails` du flux.
Branchée dans `getSegLength` (sections), `segmentRunLength` (`network.ts:613`), `trackTotals`
(`curveLength(a, via, b)` = `shapeLengthBetween` 0…1 d'une courbe : même nombre), `buildProfile`
(`segmentArcLength` → `segmentLength` : vérifier qu'il vaut la longueur de forme, sinon deuxième valeur mémorisée).

## Lot 2 — Sections, diagnostics et totaux (`networkDerived`)

**Chaînes** (`sections.ts`) : séparer `computeTrackSections` en `findSectionChains(net)` (structure
→ `RawSection[]`, inchangé) et `nameSections(net, raws, meta)` (nommage, passes 1–3). Nouveau
`SectionTracker` (dans `sections.ts` ou `sectionTracker.ts`) qui tient les chaînes d'un réseau :
- La décision « on continue ou on s'arrête » à un nœud (`getNextThroughSegment`, `sections.ts:115`)
  ne lit que ce nœud : son degré, la nature de sa table, les rayons de ses rails. Elle ne change
  qu'aux **nœuds sales** (`dirtyNodesOf`).
- Sections touchées = celles qui contiennent un rail incident à un nœud sale, ou un rail de
  `reorderedRails`, plus les rails nouveaux. Fermeture : si une section touchée passe par un nœud
  de degré ≥ 4 sans aiguille triple ni TJD (continuation « la plus droite », pas forcément
  symétrique), toutes les sections de ce nœud sont touchées aussi.
- Reconstruction : retirer les sections touchées, remettre leurs rails dans le pool, relancer la
  marche de `findSectionChains` depuis les rails du pool par rang croissant (même point de départ,
  même orientation qu'un calcul complet : la section part du côté `from` de son rail de plus petit
  rang). Une marche qui sort du pool ⇒ erreur en mode vérification, calcul complet sinon.
- Ordre du résultat : les sections triées par le rang actuel de leur premier rail (les rangs
  bougent à chaque passage, l'ordre relatif des rails gardés non, sauf `reorderedRails`).
- `sectionOfSegment` tenu au fil des retraits et ajouts.

**Nommage** : les passes restent globales (exactitude), mais bon marché :
- `sectionAncestors` ne se construit plus pour tout : un rail sans `parentSegmentId` n'a que
  lui-même pour ancêtre (⇒ `sectionOfSegment`) ; seul un index des rails à lignée est bâti.
- Écriture dans `customMeta` : l'entrée par rail / par section n'est remplacée que si un champ
  diffère (plus d'allocation par rail à chaque passage) ; les entrées ne sont jamais modifiées en
  place (c'est déjà le cas : `setSectionsMeta` et `sections.ts:466-483` remplacent ; en mode
  vérification, les entrées sont gelées pour le prouver).
- Une section gardée dont nom, type, couleur, direction et `isCustomName` n'ont pas changé garde
  son objet `TrackSection` (les tableaux `segmentIds` / `orderedNodeIds` / `nodeIds` aussi).
- Oracle : en mode vérification, `toEqual` contre `computeTrackSections(net, copie de meta)`.

**`networkDerived.ts`** : l'entrée de cache par réseau devient un consommateur du flux :
- nouvel objet `NetworkDerived` dès que le réseau ou les réglages des sections ont changé (mêmes
  identités que les tests exigent : `toBe` au même jeton, `not.toBe` après édition, aiguille
  basculée (`changedTables`), renommage) ; `NetworkSnapshot` disparaît (le flux le remplace, le
  réseau sans révision garde le calcul complet).
- Membres paresseux : `kinematicIssues`, `steepRails`, `sectionPolylines`, `sectionBadgeAnchors`
  (recalculé en entier : un point milieu par section), `ramps`, `crossings` suivent la géométrie ;
  `deadEnds`, `loops`, `components` ne suivent que `structure` — un déplacement de nœud ne les
  refait pas ; un changement des seuls réglages ne refait aucun membre paresseux.
- `trackTotals` : somme dans l'ordre du réseau des longueurs mémorisées (même ordre d'addition, même
  nombre), O(n) sans géométrie.
- `conflicts` : recalculé en entier (`detectDirectionConflicts`, O(sections), bon marché).

**Diagnostics** (`kinematicDiagnostics.ts`) : `KinematicTracker` par réseau et par clé
(`gauge|levelHeight|maxGradient`) : problèmes par nœud (`analyzeKinematics`, cas 1/2/3 : ne lisent
que le nœud et les tangentes de ses rails), par rail (`detectSteepGradients`), lacunes par paire
d'extrémités (`detectTrackGaps` : paires retrouvées par `nodesInBox` autour des extrémités
sales). Refaits pour les nœuds sales et rails changés ; liste réassemblée dans l'ordre d'aujourd'hui
(lacunes dans l'ordre des nœuds puis de leur partenaire, pentes dans l'ordre des rails, nœuds dans
l'ordre des nœuds). Oracle : `toEqual` contre `analyzeKinematics`.

## Lot 3 — Profil de voie (`trackSpeed.ts`)

`ProfileTracker` par réseau (clé `lineKey` : un changement de ligne refait tout) :
- Brouillons par rail (`railGeometry` + longueur mémorisée) refaits pour `changedRails`.
- Courbes touchées : celles qui tiennent un rail changé ou un rail au contact d'un nœud sale (la
  relation `soleNeighbour` et `meetSmoothly` y changent), et celles dont les rampes ont été posées
  sur un rail changé ou ont traversé un nœud sale (chaque courbe garde la liste des rails et nœuds
  couverts par ses rampes). Zones (`speedZonesRevision`) : `appliedSpeedOnRail` recalculée pour
  tous les rails courbes (recherches de zones, pas de géométrie), courbes marquées si une vitesse change.
- Reconstruction : dissoudre les courbes touchées, relancer `recogniseCurves` sur le pool de leurs
  rails (une reconnaissance qui sort du pool ⇒ calcul complet), reposer leurs rampes.
- `curves` réordonné par rang du premier rail (index `RailCurve.curve` réattribués — objets
  `RailCurve` recopiés, le profil précédent n'est pas modifié) ; `ramps` assemblé à partir des
  contributions par courbe, dans l'ordre des courbes puis début/fin, intérieur puis extérieur (même
  ordre de liste qu'aujourd'hui : `trackCantOn` garde la première rampe à égalité) ; `lengths`
  prérempli comme aujourd'hui depuis les mesures.
- Nouvel objet `TrackProfile` à chaque changement, le même sinon (`profileBuilds` compte toujours).
- Oracle : `toEqual` contre `buildProfile` (`rails`, `curves`, `ramps`, clés de `lengths`).

## Lot 4 — Tables de routes et raccordement sur les nœuds touchés

- `syncJunctions(net, scope?)` (`junction.ts:574`) : avec `scope = Set<NodeId>`, la boucle 1 ne
  visite que les tables de ces nœuds et celles dont le nœud a disparu, la boucle 2 que ces nœuds ;
  sans `scope`, comme aujourd'hui. `notify` (`editorStore.ts:1149`) lit le flux (curseur du store)
  et passe `dirtyNodesOf` ; curseur perdu ⇒ passe complète. La passe de fin de `reconcile`
  (`reconcile.ts:686`) se limite aux nœuds qu'il a soudés ou coupés. Oracle : en mode vérification,
  une passe complète juste après ne touche rien (jeton inchangé).
- `ReconcileState` (`reconcile.ts:428`) abandonne son propre `NetworkFollower(tolerance)` pour le
  flux partagé, les requêtes de grille élargies de la tolérance (même candidats qu'une grille à
  marge) : une seule comparaison du réseau par édition. Oracle existant : `exhaustive`.

## Lot 5 — Historique et annulation sans repartir à froid

- `serializeNetwork` (`persistence.ts:211`) : objets sérialisés par nœud / rail / table / zone /
  signal mémorisés par réseau, remplacés quand le flux les dit changés (zones et signaux : par
  `speedZonesRevision` / `signalsRevision`, petits) ; un pas = tableaux de ces objets (jamais
  modifiés après coup : gelés en mode vérification ; `deserializeNetwork` et `restoreTrains` n'y
  écrivent pas — à vérifier) ; `copySectionMeta` devient une copie superficielle (entrées immuables, lot 2).
- `applyProject(net, step)` (nouveau, `persistence.ts`) : amène le réseau vivant à l'état du pas,
  **sur place** : nœuds, rails, tables, zones, signaux diffés par id (objet gardé quand tous les
  champs sont égaux, le `path` comparé nombre à nombre), `Map` reconstruites dans l'ordre du pas,
  adjacence rebâtie comme `deserializeNetwork` la bâtit (même ordre), `syncIdCounter`,
  `touchNetwork`. `undo` / `redo` l'emploient : `this.network` reste le même objet, le flux voit la
  différence, chaque cache ne refait que ce qui diffère ; `adoptReconciledNetwork` quand le pas était
  raccordé, comme aujourd'hui. Oracle : en mode vérification, contenu comparé champ à champ à
  `deserializeNetwork(step).network`.

## Lot 6 — Suivi en O(changements) : journal des `Map` comptées

- `CountingMap` (`networkWatch.ts:28`) journalise les clés posées et retirées ; `touchNetwork(net, id?)`
  journalise l'id (nœud, rail, table, zone, signal), sans id ⇒ marque « inconnu ».
- `follow` : sans « inconnu » depuis son dernier passage, n'examine que les ids journalisés ; les
  rangs deviennent des rangs à trous (nouvelle entrée = rang max + 1, renumérotés à une passe
  complète ; `nodesInOrder` / `railsInOrder` remplacés par les références des enregistrements).
  En mode vérification, un passage par journal est recoupé avec une passe complète (erreur
  « touchNetwork sans l'id de ce qui a changé »).
- Les écrivains chauds donnent l'id : déplacement de nœud (`nodeTransform.ts`), `via`, `cant`,
  `level`, `setJunctionPosition`, zones, signaux. `markDirty` garde `networkChanged()` (jeton) ; le
  filet « édition validée ⇒ tout recomparer » ne subsiste qu'en mode vérification (toute la suite
  de tests), et à chaque passe complète.
- À faire **après mesure** des lots 1–5 : c'est le dernier O(n) par édition (0,13 s à 122 000).

## Vérification

- À chaque lot : `npm test` (oracles actifs sur toute la suite), `npm run typecheck`, `npm run build`.
- Nouveaux tests : suites d'éditions aléatoires sur `buildYard` / `buildStations` (pose, retrait,
  déplacement, coupe, soudure, aiguille basculée, renommage, annulation) comparant après chaque
  pas l'incrémental au complet — sections, profil, diagnostics, tables, `applyProject`.
- `npm run bench` (scale.bench : édition et ses parts, annulation) avant / après chaque lot, à
  13 527 et 122 000 rails (`SCALE_COPIES=9`), plus trois entrées : « un nœud déplacé », « une
  section renommée », « une aiguille basculée ». Chiffres dans `tasks/plan-recalcul-incremental.md`.
- Navigateur (`npm run dev`, projet 9×9 gares importé, `tools/perf/measure-canvas.cjs`) : clic
  qui pose un nœud, glissement d'un nœud, annulation, basculement d'aiguille.
- Captures de Marseille aux mêmes caméras avant / après, comparées pixel à pixel (`diff-png.cjs`).
- Aucun commit sans demande ; un message proposé par lot (`perf(derived): …`, `perf(profile): …`,
  `perf(history): …`).

## Suivi

Mesures script seul (`src/_profile.test.ts`, provisoire), une édition = un rail posé loin des gares,
données dérivées demandées ensuite (sections, conflits, diagnostics, totaux). « Comparaison » = le
passage du suiveur partagé sur tout le réseau (lot 6).

| | 13 527 rails | 121 743 rails |
|---|---|---|
| Avant (sections + diagnostics recalculés en entier) | ~150 ms | ~2,5 s |
| Lot 1 + 2 : données dérivées après l'édition | 4–7 ms | 47–72 ms |
| dont comparaison du réseau (suiveur) | 2,5–6 ms | 30–65 ms |
| Nœud déplacé (comparaison comprise) | 10 ms | 108 ms |
| Boucles / composantes / impasses | gardées quand seule la géométrie change | idem |

Lot 1 — `networkFollower.ts` : `structure`, `removedRails`, `reorderedRails`, `changedTables` ;
`ChangeFeed` (`networkChangesSince`, 64 passages, au plus n entrées) ; `dirtyNodesOf` ;
`railMeasures.ts`. Lot 2 — `sections.ts` scindé (`walkSectionChain`, `findSectionChains`,
`nameSections` avec index des réglages et objets gardés), `sectionTracker.ts` (chaînes touchées,
fermeture par les croisements, pool, oracle), `kinematicTracker.ts` (nœuds, rails raides, lacunes
autour des extrémités sales, oracle), `networkDerived.ts` (flux, `TotalsTracker`, graphe gardé
tant que la structure tient, extrémités de section gardées pour les conflits).

Lot 3 — `trackSpeed.ts` : `ProfileTracker` (brouillons par rail, courbes avec les nœuds lus
`touched`, rampes par courbe, pool, oracle) ; un profil dont rien n'a bougé est un nouvel objet qui
partage `rails` / `ramps` (identité = « la voie ou les zones ont changé », comme avant) ;
`cantStretches` gardé par `profile.rails`. Profil après une édition loin des courbes : 0,1 ms
(était 1,23 s à 122k) ; zone posée sur une courbe : ~170 ms à 122k (vitesse appliquée relue sur
101 000 rails courbes, assemblage O(courbes)).

Lot 4 — `syncJunctions(net, scope)` : `notify` passe les nœuds sales du flux (curseur du store) et,
en mode vérification, recoupe avec une passe complète ; la fin de `reconcile` passe les nœuds
changés depuis la dernière passe (`changedSinceSync`) et ceux des soudures / coupes.

Lot 5 — `persistence.ts` : objets sérialisés par nœud et rail gardés par réseau (`itemsOf`, gelés
en tests), `copySectionMeta` superficiel (entrées gelées en tests) ; `deserializeNetwork(data,
reconciledAt, into)` ramène un réseau à un pas **sur place** (nœud, rail gardés quand l'objet
sérialisé du pas est celui que le réseau tient encore ; tables gardées champ à champ ; oracle
contre une lecture à neuf) ; `adoptReconciledNetwork` garde l'état de raccordement et ne vérifie
les tables qu'aux nœuds changés. `undo` / `redo` l'emploient : `store.network` reste le même objet.

Bench `scale.bench` à 121 743 rails, après les lots 1–4 (la sauvegarde y est forcée à chaque
passage ; en navigateur elle est différée) : raccordement 64 ms, pas d'annulation 238 ms,
données dérivées 95–384 ms (comparaison du réseau comprise), édition validée 894 ms (était ~4,5 s).

Lot 6 — `networkWatch.ts` : journal des mouvements de la révision (`CountingMap` note la clé et la
`Map`, `touchNetwork(net, id)` l'id, `touchNetwork(net, null)` « tables / zones / signaux
seulement », `networkJournal`) ; `follow` n'examine que les entrées du journal (rangs à trous,
recoupement complet en tests : « changed without touchNetwork saying what ») ; un `networkChanged()`
(époque) fait relire tout, `tablesChanged()` (aiguille basculée) seulement les tables ; `markDirty`
ne bouge plus l'époque. Écrivains en place dotés de l'id : `nodeTransform`, soudures / coupes du
raccordement, `weldNodes`, `crossing.ts`, boucle de retournement, dévers, hauteurs, panneau latéral.

Mesures script seul après les six lots, 121 743 rails (profil `tools/perf/profile-*.test.ts`) :
comparaison du réseau 4–10 ms (était 55), raccordement 6–8 ms (était 45), données dérivées après
un rail posé 46–69 ms, après un nœud déplacé 96 ms, profil 0,2 ms (édition loin des courbes),
pas d'annulation 115 ms (dont `serializeNetwork` 110 : copie des réglages de sections et tables),
`markDirty` sans sauvegarde 112 ms, annulation 390–460 ms (était 3,7 s), boucles + composantes
230 ms quand la structure change et que rien n'est sélectionné (recalcul complet, à faire).

Restes O(n) par édition : `serializeNetwork` (copie superficielle des 137 000 entrées de
`sectionMeta`, 8 500 tables), nommage des sections O(sections) (~20 ms), `deserializeNetwork` sur
place (vérification de l'ordre et des objets : ~80 ms), boucles / composantes sur changement de
structure, zone posée sur une courbe (vitesse relue sur toutes les courbes).

### Vérification finale (2026-10-07)

- `npm test` : 2 498 tests verts (oracles actifs : sections, diagnostics, profil, tables, pas
  d'annulation sur place, suiveur par journal), `npm run typecheck`, `npm run build` : OK.
- Marseille, trois vues, base `developement` (7bc683d) servie comme le worktree (`node_modules`
  lié) contre le worktree : captures **identiques pixel à pixel** ; mêmes temps d'image.
- Navigateur headless (`functional.cjs` : import, pose d'un rail en deux clics, annulation,
  rétablissement ; le tracé de l'image entière est compris, en rastérisation logicielle) :

| | 13 527 rails, base | 13 527 rails, après | 121 743 rails, après (avant : 4,5–5 s / 3,7 s) |
|---|---|---|---|
| clic (rail posé) | 266 ms | 197–216 ms | 1 350 ms (dont ~500 ms de tracé : « pan » = 526 ms) |
| annulation | 301 ms | 120 ms | 900 ms |
| rétablissement | 205 ms | 190 ms | 810 ms |

- `npm run bench` (sauvegarde forcée à chaque passage, 504 ms à 122k) : édition validée 636 ms
  (était 1 381 après le plan navigateur, ~4,5 s avant) ; raccordement 10 ms ; dérivées 111 ms ;
  pas d'annulation 139 ms ; annulation + rétablissement 1 948 ms (était 6 548). À 13 527 rails :
  édition 55 ms (dont 37 de sauvegarde), annulation + rétablissement 141 ms.

Hors de ce plan : le tracé d'une image à 122 000 rails avec tout le réseau en vue (~500 ms en
headless) domine désormais le clic ; boucles / composantes incrémentales ; `serializeNetwork`
(copie des réglages de sections) et nommage O(sections).
