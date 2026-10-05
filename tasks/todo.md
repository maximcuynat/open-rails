# Tâches

Nettoyé le 2026-10-05 : les chantiers terminés ont été retirés (leur plan et leur revue restent dans l'historique git de ce fichier). Ne restent que le chantier en cours, ce qui est encore à faire et les défauts connus.

---

# En cours — Niveaux de voie (ponts, sauts-de-mouton, tunnels)

Branche `feature/track-levels` (partie de `developement`). Validé le 2026-10-05. Prérequis de l'import OSM (hors périmètre ici). Pas de commit tant que l'utilisateur ne le demande pas.

## Principe

Un entier optionnel `level` sur `Segment` (absent = 0, plage −5…+5, équivalent du `layer` d'OSM). Pas d'altitude, pas de pente, pas de niveau sur les nœuds : le niveau d'un nœud se déduit de ses segments (un nœud de rampe touche deux niveaux). Le niveau ne joue que là où deux voies se croisent ou se touchent **sans nœud commun**.

Règle unique, partagée par tous les points ci-dessous : deux voies n'interagissent (croisement, soudure, découpe, doublon) que si elles ont un niveau en commun.

## Contrat commun (posé avant de lancer les agents)

- [x] 0. `types.ts` : `Segment.level?` ; `network.ts` : `MIN_LEVEL`, `MAX_LEVEL`, `segmentLevel(seg)`, `nodeLevels(net, nodeId)`, `setSegmentsLevel(net, ids, level)` (0 = champ supprimé, pour ne pas changer les fichiers existants) ; `editorStore.ts` : signature `shiftSelectionLevel(delta)`

## Agent A — domaine, sauvegarde, store

- [x] A1. Héritage du niveau partout où un segment est recréé, via un seul helper qui copie `parentSegmentId` + `level` : `splitSegmentAtNode` (`reconcile.ts`, droite et courbe), les découpes de `junction.ts`, `dissolveNode` (`network.ts` : fusion refusée si les deux moitiés n'ont pas le même niveau), ciseaux et voie parallèle (`constructionTemplates.ts`)
- [x] A2. Réconciliation (`reconcile.ts`, `network.ts`) :
  - candidats `cross` ignorés si les niveaux diffèrent
  - candidats `split` / `weld` nœud-sur-segment et nœud-sur-nœud ignorés sans niveau commun (un nœud isolé reste compatible avec tout)
  - `removeDuplicateSegments` ne supprime pas un doublon d'un autre niveau
- [x] A3. Croisements (`crossing.ts`) : la détection géométrique sans nœud de `detectCrossings` ignore les paires de niveaux différents (corrige d'un coup le panneau latéral, le rendu des cœurs et l'export SVG)
- [x] A4. Décroiser un croisement existant : `separateLevelsAtNode(net, nodeId)` — quand un nœud de degré 4 porte deux voies traversantes de niveaux différents, la voie du dessus reçoit un nœud jumeau au même endroit. C'est ce qui permet de transformer un diamant déjà posé en pont ; la règle A2 empêche la réconciliation de ressouder les deux nœuds
- [x] A5. Persistance (`persistence.ts`) : `level` optionnel dans `SerializedSegment`, écrit seulement s'il est non nul, validé (entier borné) à la lecture, lu **avant** la réconciliation du chargement. Pas de changement de `version` ; l'undo suit tout seul (instantanés)
- [x] A6. Store (`editorStore.ts`) : `shiftSelectionLevel(delta)` → `setSegmentsLevel`, `separateLevelsAtNode` sur les nœuds touchés, `reconcileNetwork()` (redescendre un pont à 0 doit recréer le croisement), trains gardés en place, `pushHistorySnapshot()`, `notify()`
- [x] A7. Pointage (`hitSegment`, `hitNode`, `snapToNearestTrack`) : à distance égale, le niveau le plus haut l'emporte (on clique ce qu'on voit)
- [x] A8. Collisions entre trains (`train.ts`) : vérifier comment elles sont calculées ; si c'est géométrique, deux trains sur des niveaux différents ne se heurtent pas. `computeTrackSections` : confirmer par un test que deux voies superposées restent deux sections indépendantes
- [x] A9. Tests pour chaque point

## Agent B — visuel et interface

- [x] B1. Voies (`renderer.ts`) : segments dessinés par niveau croissant ; niveau > 0 : tablier (bande plus large que le ballast + garde-corps) dessiné sous la voie, qui masque ce qui passe dessous ; niveau < 0 : voie atténuée et en pointillés (tunnel) ; mode simplifié (faible zoom) : ordre + liseré seulement
- [x] B2. Rampes : culée dessinée au nœud où le niveau change, pour que le tablier ne s'arrête pas net
- [x] B3. Trains par niveau (`renderer.ts`, `Canvas.tsx`) : un véhicule est au niveau du segment qui porte ses bogies (le plus haut des deux sur une rampe). Dessin entrelacé niveau par niveau — voies du niveau, puis véhicules du niveau — pour qu'un train qui passe **sous** un pont soit caché par le tablier ; véhicule en tunnel (niveau < 0) atténué. Les surcouches (nœuds, badges, diagnostics, faisceau de pilotage) restent dessinées une seule fois, par-dessus. Réseau sans niveau : même chemin de dessin qu'aujourd'hui, aucun changement visible
- [x] B4. Export SVG (`exportSvg.ts`) : même ordre de niveaux, tablier et tunnel
- [x] B5. Interface : champ « Niveau » avec `−` / `+` dans `SegmentPanel` (`SidePanel.tsx`) ; actions « Monter » / « Descendre » dans la barre contextuelle des voies (`contextBarModel.ts`), qui marchent sur une sélection multiple (un pont = plusieurs coupons) ; niveau affiché sur la voie sélectionnée quand il est non nul
- [x] B6. Tests de rendu (mock `ctx`) et de la barre contextuelle

## Vérification finale (après les deux agents)

- [x] `npm test`, `npm run typecheck`, `npm run build`
- [x] Relecture du diff complet
- [x] Contrôle dans le navigateur (captures sans écran, thèmes clair et sombre) : pont, culées, tunnel, « Descendre » de bout en bout
- [ ] Contrôle à l'œil par l'utilisateur : train sous un pont, champ « Niveau » du panneau latéral, export SVG

## Tests clés

- Deux droites qui se croisent à des niveaux différents : aucun nœud créé, aucun croisement détecté, deux sections indépendantes ; au même niveau : comportement actuel inchangé
- Un segment de niveau 1 coupé (ciseaux, aiguillage, réconciliation) donne deux moitiés de niveau 1
- Diamant existant, une voie montée à 1 : deux nœuds superposés, plus de croisement ; redescendue à 0 : le diamant revient
- Sauvegarde → chargement : niveaux conservés, pas de nœud recréé sous le pont ; un fichier sans `level` se charge à l'identique
- Rendu (mock `ctx`) : la voie de niveau 1 est tracée après celle de niveau 0 ; un véhicule de niveau 0 est tracé avant le tablier de niveau 1

## Revue (2026-10-05)

- `npm test` : 684 tests verts (38 fichiers, 66 nouveaux) ; `npm run typecheck` et `npm run build` verts, relancés après relecture.
- Vu dans un navigateur sans écran, sur un réseau de test : tablier opaque et garde-corps (clair et sombre), culées aux rampes, tunnel atténué en pointillés, aucun nœud créé sous le pont ; clic sur la voie puis « Descendre » : les croisements apparaissent, la barre affiche « Tunnel −1 à Sol ».
- Non vu à l'écran : un train sous un pont (couvert par un test d'ordre des appels canvas), le champ « Niveau » du panneau latéral, l'export SVG.
- Ajouté à la relecture :
  - un rail posé depuis un nœud (outils de pose, « relier deux nœuds », voie double) prend le niveau de la voie qu'il prolonge — sinon un rail tiré d'un nœud de pont ressoudait le pont à la voie du dessous ;
  - « Monter » / « Descendre » proposés aussi quand la voie est sélectionnée avec ses nœuds (c'est ce que donne un clic sur une voie).
- Écarts au plan : paramètre `level` optionnel en fin de `addSegment`, `addCurveSegment`, `addCurveChain`, `addArcCurve`, `findSameRail` ; la voie parallèle est dans le store, pas dans `constructionTemplates.ts` ; tests de rendu dans `trackLevels.test.ts` (contexte enregistreur) ; un `toEqual` existant de `contextBarModel.test.ts` complété par les deux nouvelles actions.
- Collisions entre trains : calculées le long de la voie, donc rien à changer.
- Restes connus :
  - un clic sur une voie sélectionne toute la section : « Monter » lève rampes et pont ensemble ; pour ne lever qu'un coupon il faut le sélectionner seul ;
  - en vue à plusieurs niveaux, `renderNetwork` (et `computeTrackSections`) tourne une fois par niveau visible plus une : coût à mesurer sur un grand réseau ;
  - `applyBalloonLoop` n'hérite pas du niveau ; pas de portail de tunnel ; pas d'étiquette de niveau sur le canevas ; tablier calé sur la constante `GAUGE`, comme les rails ;
  - debug des trains possiblement masqué par un pont ; l'ancienne `Locomotive` prend le niveau de sa motrice en un bloc ;
  - descendre un pont sous lequel stationne un train coupe le rail et retire les véhicules (défaut déjà listé plus bas).

## Barre contextuelle stable (ajout du 2026-10-05, à la demande de l'utilisateur)

La barre flottante est centrée et suit la largeur de son contenu : chaque changement décalait les boutons sous le curseur.

- [x] 1. Niveau en compteur `−  valeur  +` à largeur fixe, toujours affiché pour une voie (« Sol » compris) ; sélection sur plusieurs niveaux en forme courte (« −1 à +2 »)
- [x] 2. Règles de la barre : action indisponible grisée au lieu d'être retirée (« Voie double ») ; libellé de gauche à largeur minimale ; une valeur ne fait que s'élargir tant que la barre garde le même sujet
- [x] 3. Barre figée tant que la souris est dessus (bord gauche verrouillé, recentrage quand le pointeur sort)
- [x] Tests du modèle mis à jour, `npm test`, `npm run typecheck`, `npm run build`
- [x] Navigateur sans écran : quatre clics sur `−` au même point de l'écran (Pont +1 → Tunnel −3), positions de `−`, `+` et « Supprimer » identiques au pixel près
- Non couvert par un test automatique : le figeage au survol et l'élargissement des valeurs (pas de test de composant React) ; vérifiés seulement par le scénario ci-dessus.
- Reste connu : une voie qui passe par le niveau 0 en croisant une autre y est coupée ; les deux moitiés restent séparées une fois redescendue en tunnel.

## Hors périmètre

- Import OSM, fond de carte, projection
- Contrôle de cohérence des rampes (une voie de niveau 1 raccordée directement à du niveau 0 est acceptée telle quelle)
- Raccourci clavier pour monter / descendre

---

# À faire

- [ ] Contrôle dans le navigateur des raccourcis clavier réassignables (section des paramètres : capture d'une touche, conflit, lettres AZERTY)
- [ ] Contrôle dans le navigateur des rames TGV articulées (sélecteur de modèle, rendu en contour)
- [ ] Traiter la branche `feature/curve-angle-rotation-gizmo` (conflits attendus sur `gizmo.ts` et `ToolBar.tsx`)
- [ ] Arrêt net au butoir (de la vitesse courante à 0) : choix à faire par l'utilisateur

Rien de ce qui touche `Canvas.tsx`, le clavier ou les composants React n'a été vérifié dans le navigateur à ce jour : il n'y a pas de test d'interface.

---

# Défauts connus (non traités)

## Pose et édition des voies

- Ciseaux sur un nœud : segment détaché arbitraire, et priorité du nœud sur le segment à faible zoom
- Fermeture de boucle sur un nœud existant : l'aperçu diffère de la pose
- `turnoutRadius` non branché
- Mode catalogue Kato inatteignable ; arrondi 0,1 m non adapté aux échelles modélisme
- Chevauchement partiel de deux courbes non fusionné ; réconciliation limitée à 40 opérations par appel
- Anciens aiguillages dessinés à la main entre 15° et 45° devenus infranchissables
- `findPath` / `reachableFrom` faux sur les doubles croisements (sans appelant hors tests)
- Gabarits non branchés à l'interface (liaison croisée, évitement, boucle de retournement — cette dernière infranchissable)

## Trains

- Couper un rail sous un train retire les véhicules posés dessus (annulable)
- Une pose libre au milieu d'un train peut le chevaucher
- Pas de collision entre les deux voies d'une traversée ni au gabarit d'un aiguillage ; pas d'auto-collision sur une boucle plus courte que le train
- Un scénario où `notify()` redéfinit les rôles des branches sous un train le décale de 5 m, à examiner
- En pose aimantée le sens `R` est relatif au train, en pose libre il est relatif au segment
- Rames articulées : bout libre d'une remorque sans porte-à-faux (le bogie dépasse de 1,35 m) ; fantôme d'une remorque posée contre une motrice dessiné sans son extension ; cotes TGV M en grande partie estimées
- Contrôle du raccord d'arrivée de l'outil courbe (`checkCurveJoins`) couvert seulement par les tests de l'agent qui l'a écrit

## Pilotage et interface

- Pas d'indication « aiguille occupée » sur le canevas ; pictogramme d'aiguillage dans le HUD non fait
- Faisceau debug en marche arrière : part du premier véhicule et non de la queue
- Boutons de la barre d'outils cliquables en conduite ; raccourcis globaux actifs quand la fenêtre des paramètres est ouverte (hors capture)
- Réseaux déjà enregistrés : gardent le nom « Untitled Network »
- Thème clair des éléments flottants et styles de boutons non unifiés

## Code à retirer ou à brancher

- Ancienne `Locomotive` (rendu compris), `TrainBuilderPalette`, repli glisser au pointeur dans `Canvas.tsx`, Tab et `[` `]` en courbe
- Extraction des outils de `Canvas.tsx` vers `IToolStrategy`
