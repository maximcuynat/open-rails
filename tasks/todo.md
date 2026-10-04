# Correctifs du système de pose de rails

Suite au bilan du 2026-10-04. Pas de commit tant que l'utilisateur ne le demande pas.

## Plan

- [x] 1. Ciseaux : ne couper que le segment réellement sous le curseur (`performTrackCut`)
- [x] 2. Gizmo / glisser de nœud : les points de contrôle `via` suivent (translation, rotation, nœud seul)
- [x] 3. Seuils relatifs à l'échelle (tolérance de réconciliation, corde mini, décalages) dérivés de l'écartement
- [x] 4. Courbes fidèles au cercle : découpage automatique en pièces d'angle borné
- [x] 5. Rayon minimal réellement appliqué (courbe, accrochage, aiguillage parallèle)
- [x] 6. Une seule fonction de géométrie pour l'outil Courbe, partagée par l'aperçu, le clic et le survol
- [x] Tests ajoutés pour chaque point, `vitest`, `tsc --noEmit` et build verts

## Hors périmètre (signalé, non traité)

- Extraction complète des outils de `Canvas.tsx` vers `IToolStrategy`
- Suppression ou branchement des gabarits non utilisés (liaison croisée, évitement, boucle)

## Revue

- `vitest` : 395 tests verts (28 fichiers) ; `tsc --noEmit` et `npm run build` verts, relancés après relecture.
- Chaque correctif rejoué par un test jetable indépendant : ciseaux, arc 90° R500 (6 pièces, rayon mini 495,7 m, écart 0,018 m), gizmo, rotation d'un nœud seul, HO.
- Câblage `Canvas.tsx` non vérifié dans le navigateur (pas de test d'interface).
- Ajouté à la relecture : accrochage grille du gizmo X/Y stable sur un nœud hors grille ; libellé « RR » de l'aiguillage.
- Restes connus : ciseaux sur un nœud (segment détaché arbitraire, priorité du nœud sur le segment à faible zoom) ; fermeture de boucle sur un nœud existant (aperçu ≠ pose) ; `turnoutRadius` non branché ; mode catalogue et arrondi 0,1 m non adaptés aux échelles modélisme.

---

# Pilotage des trains : inverseur, crans, arrêt d'urgence

Validé le 2026-10-04. Pas de commit tant que l'utilisateur ne le demande pas.

## Plan

- [x] 1. Domaine (`train.ts`) : `reverser` AV/N/AR, `notch` -5…+5, `emergencyBrake`, fonctions pures de commande, `tickTrainSet` proportionnel aux crans, suppression de `throttle` / `isReversing`
- [x] 2. Store : actions de pilotage du train sélectionné, remise à zéro des commandes en sortie de pilotage, locomotive legacy inchangée
- [x] 3. Clavier : ↑/↓ un cran par appui, Maj+↑/↓ inverseur, Retour arrière arrêt d'urgence
- [x] 4. HUD bas-droite refait : vitesse, inverseur, échelle de crans, arrêt d'urgence, légende des commandes
- [x] 5. Tests domaine + store, `npm test`, `npm run typecheck`

## Revue

- `npm test` : 329 tests verts ; `npm run typecheck` et `npm run build` verts.
- HUD non vérifié visuellement dans le navigateur.
- Corrigé au passage : la déclaration du champ `selectedTrainVehicleId` manquait dans `EditorStore` (le typecheck échouait déjà avant ce chantier).
- `R` / `Tab` ne retournent plus un `TrainSet` en pilotage ; le bouton « Inverser le sens » de la barre d'outils bascule l'inverseur AV ↔ AR.
- HUD refait en version compacte : raccourcis au-dessus, cadran de vitesse avec inverseur au centre, cran dans un seul champ avec `−` / `+`, distance d'arrêt, arrêt d'urgence.
- Marche arrière : la motrice n'est plus retournée au dessin, le train refoule (voir `tasks/lessons.md`).
- Valeurs : P5 = 5,5 m/s², B5 = 10 m/s², urgence = 20 m/s² (arcade, à ajuster si besoin).

---

# Branche `feature/train-coupling` : à faire avant de la supprimer

Mis de côté le 2026-10-04. Rien n'est lancé tant que l'utilisateur ne le demande pas.

- [ ] 1. Commiter et pousser le travail en cours (il n'existe que localement) ; `CLAUDE.md` dans un commit `docs:` séparé
- [ ] 2. Vérifier `npm run typecheck` et `npm run build` verts
- [ ] 3. Fusionner `main` dans la branche (2 commits de retard : CI et `base` GitHub Pages)
- [ ] 4. Fusionner dans `developement`, puis supprimer la branche en local et sur le dépôt distant
- [ ] 5. Traiter ensuite `feature/curve-angle-rotation-gizmo` (conflits attendus sur `gizmo.ts` et `ToolBar.tsx`)

---

# Harmonisation de l'interface (suite au topo du 2026-10-04)

Deux agents en parallèle, périmètres de fichiers disjoints, puis relecture et commit.

## Agent A — mode train « comme la pose de rail »

- [x] A1. Un seul chemin de pose : clic, glisser-déposer et menu contextuel donnent le même `TrainSet`, sans ancienne `Locomotive` cachée
- [x] A2. « Train en cours » : chaque clic ajoute un véhicule au bout ; Échap arrête la chaîne, puis revient à Sélection
- [x] A3. Pas d'édition (pose, suppression, attelage) pendant la conduite
- [x] A4. Aiguiller en conduite (←/→) fonctionne pour un `TrainSet`
- [x] A5. Trains sauvegardés (stockage local + JSON), annulables, nettoyés par « Nouveau réseau » et quand leur voie disparaît
- [x] A6. Textes d'aide du mode train à jour, refus de pose signalé

## Agent B — fiabilité de l'éditeur de voie et cohérence générale

- [x] B1. Export JSON complet (échelle, unité, écartement, entraxe, plateau)
- [x] B2. Suppr / Retour arrière pendant une pose ne supprime plus le nœud de départ
- [x] B3. Une action = une étape d'annulation ; annuler remet l'outil en cours à zéro
- [x] B4. Menu contextuel : « Supprimer l'aiguillage » et « Créer voie parallèle » agissent sur la cible ; « Dupliquer voie double » branché ou retiré
- [x] B5. Pose de rail enchaînée ; Échap annule la pose en cours, puis revient à Sélection, sans vider la sélection par surprise
- [x] B6. Raccourcis : pas de déclenchement avec Ctrl/Cmd, Espace/F5 cohérents, fenêtre d'aide et README exacts
- [x] B7. Barre d'état affichée ; textes d'aide faux corrigés
- [x] B8. Vocabulaire : un nom par notion, plus d'anglais résiduel, nom du produit unique

## Hors périmètre de ce lot

- Thème clair des éléments flottants et unification des styles de boutons
- Suppression complète du code de l'ancienne `Locomotive` (rendu compris)
- Mode catalogue Kato (inatteignable aujourd'hui)

## Revue

- `tsc --noEmit`, `vitest` (451 tests, 31 fichiers) et `vite build` verts, relancés après relecture.
- Rien n'a été vérifié dans le navigateur : les gestionnaires de `Canvas.tsx`, le clavier et les composants React n'ont pas de tests ; seule la logique du store, du domaine et de la persistance est couverte.
- Ajouté à la relecture : en conduite, les raccourcis d'édition sont coupés (seuls F5, F, I et Ctrl+0 passent).
- Restes connus : couper un rail sous un train retire les véhicules posés dessus (annulable) ; une pose libre au milieu d'un train peut le chevaucher ; basculer un aiguillage sous un train déplace ses wagons ; les boutons de la barre d'outils restent cliquables en conduite ; les réseaux déjà enregistrés gardent le nom « Untitled Network » ; code mort à retirer (`TrainBuilderPalette`, repli glisser au pointeur dans `Canvas.tsx`, Tab et `[` `]` en courbe).

---

# Comportement des trains et conflits de rails (suite à la vérification du 2026-10-04)

Tous les défauts ci-dessous ont été reproduits sur `c775df8` juste avant de lancer les corrections. Un agent code, un second vérifie de façon indépendante, puis rapport. Pas de commit tant que l'utilisateur ne le demande pas.

## Plan

- [x] T1. Collision : un train s'arrête au contact d'un autre au lieu de le traverser
- [x] T2. Marche arrière contre un butoir : le train ne se tasse plus (déplacement tout ou rien)
- [x] T3. Aiguillage occupé par un train : bascule refusée
- [x] T4. Angles vifs : pas d'aiguillage reconnu au-delà d'un angle réaliste, et un train ne franchit pas un coude ; coude signalé
- [x] R1. Rails superposés (doublon, rail court sur rail long, chevauchement partiel) : fusionnés, plus d'aiguillage fantôme
- [x] R2. Courbe coupant une droite : tous les points de croisement, placés sur les deux voies
- [x] R3. Traversées reconnues aussi pour un croisement très fermé ou courbe/droite
- [x] R4. Trou entre deux bouts de rail proches : signalé
- [x] Tests pour chaque point ; `vitest`, `tsc --noEmit`, build verts

## Laissé tel quel

- Arrêt net au butoir (de la vitesse courante à 0, moins d'un pas avant la fin de voie) : choix à faire par l'utilisateur.

## Revue

- Trois passages de code, deux vérifications indépendantes, puis contrôle final : `tsc --noEmit`, `vitest` (506 tests) et build verts ; sondes rejouées sur le code final.
- Rien n'a été vérifié dans le navigateur.
- Limite d'angle franchissable : 15° (`MAX_TRANSITION_DEFLECTION_DEG`), partagée par les trains, la détection d'aiguillage, le diagnostic et l'outil courbe.
- Non revérifié de façon indépendante : le contrôle du raccord d'arrivée de l'outil courbe (`checkCurveJoins`), couvert seulement par les tests de l'agent de code.
- Restes connus : pas de collision entre deux voies d'une traversée ni au gabarit d'un aiguillage ; pas d'auto-collision sur une boucle plus courte que le train ; chevauchement partiel de deux courbes non fusionné ; réconciliation limitée à 40 opérations par appel ; `findPath` / `reachableFrom` faux sur les doubles croisements (sans appelant hors tests) ; gabarit « boucle de retournement » infranchissable (non branché à l'interface) ; anciens aiguillages dessinés à la main entre 15° et 45° devenus infranchissables ; un scénario où `notify()` redéfinit les rôles des branches sous un train le décale de 5 m, à examiner.

---

# Locomotive attelée à l'envers (rame réversible)

Validé le 2026-10-04. Pas de commit tant que l'utilisateur ne le demande pas.

## Plan

- [x] 1. Domaine (`train.ts`) : `Vehicle.flipped`, `reverseTrainSet`, `findCouplerSnap(..., flipped)`, attelage arrière-arrière / nez à nez dans `handleCouplingClick`, dessin de la loco retournée et de ses accordéons
- [x] 2. Dételage / suppression : un train à l'arrêt dont toutes les locos sont retournées est remis nez en avant
- [x] 3. Sauvegarde : `flipped` conservé, anciens fichiers compatibles
- [x] 4. Store : la touche R / « Inverser le sens » retourne aussi le véhicule aimanté sur un attelage
- [x] 5. Tests domaine + store, `npm test`, `npm run typecheck`

## Revue

- `vitest` : 555 tests verts (33 fichiers) ; `tsc --noEmit` vert.
- `front` / `rear` restent dans l'ordre de la rame : cinématique, collisions et aiguillages inchangés.
- Non vérifié dans le navigateur (pas de test d'interface).
- Reste connu : en pose aimantée le sens R est relatif au train, en pose libre il est relatif au segment.

---

# Raccourcis clavier réassignables (conduite + outils)

Validé le 2026-10-04. Pas de commit tant que l'utilisateur ne le demande pas.

## Plan

- [x] 1. Catalogue d'actions et correspondance touche → action (`application/keybindings/keybindings.ts`) : WASD par défaut en conduite, flèches en secondaire, debug sur F3
- [x] 2. Sauvegarde séparée du projet (`open-rail:keybindings`) et état dans le store
- [x] 3. `useKeyboardShortcuts` lit le catalogue ; `handleKeyDown` / `handleKeyUp` extraits pour les tests
- [x] 4. Section « Raccourcis clavier » dans les paramètres (capture, conflit, retrait, réinitialisation)
- [x] 5. Indications de touches (barre d'outils, menus, barre contextuelle, inspecteur, HUD, fenêtre d'aide) lues depuis le catalogue
- [x] 6. Tests, `npm test`, `npm run typecheck`, `npm run build`
- [ ] 7. Contrôle dans le navigateur

## Revue

- `vitest` : 573 tests verts (34 fichiers, 20 nouveaux) ; `tsc --noEmit` et build verts.
- Écart au plan : les touches de conduite sont liées à la position (`e.code`), les touches d'outils à la lettre (`e.key`). En tout-position, « M pour mesure » tombait sur la touche `,` en AZERTY.
- `D` ne bascule plus le debug (F3 partout) ; `[` / `]` sont liés à la position, donc atteignables en AZERTY.
- Non vérifié dans le navigateur : la section des paramètres (capture d'une touche, conflit) et l'affichage des lettres AZERTY n'ont aucun test d'interface.
- Reste connu : pendant que la fenêtre des paramètres est ouverte, les raccourcis globaux restent actifs hors capture (comportement antérieur).

---

# Pilotage : voir où mène le prochain aiguillage

Validé le 2026-10-04 (options 1 + 2 + portée variable). Pas de commit tant que l'utilisateur ne le demande pas.

## Plan

- [x] 1. Domaine (`locomotive.ts`) : `findJunctionAhead` (aiguillage, distance, cap à l'arrivée, pointe/talon, branches de gauche à droite) ; `findUpcomingJunction` et `steerJunction` s'appuient dessus (gauche/droite selon le sens d'arrivée sur l'aiguille)
- [x] 2. Domaine (`train.ts`) : `trainRouteStart`, le bout de rame dont part l'itinéraire, partagé avec `steerTrainSetJunction`
- [x] 3. Rendu : `renderDrivingRoute` — faisceau d'itinéraire (portée selon la vitesse, cyan en voie directe, ambre après une aiguille déviée), anneau + pictogramme de l'aiguille commandée, aiguille prise en talon fermée en rouge
- [x] 4. `Canvas.tsx` : dessin en pilotage pour le train conduit (et la locomotive legacy)
- [x] 5. Tests domaine + rendu, `npm test`, `npm run typecheck`

## Revue

- `vitest` : 593 tests verts (35 fichiers) ; `tsc --noEmit` vert.
- Le faisceau « Trajet 50m » existant n'est dessiné qu'en mode debug : l'aide au pilotage est une fonction à part (`renderDrivingRoute`), dessinée sous les trains dès qu'on pilote. Le faisceau debug n'est pas modifié.
- Changement de comportement : `← →` classe les branches selon le sens d'arrivée sur l'aiguille et non plus selon le cap du train (les deux coïncident en approche rectiligne ; après une courbe l'ancien calcul pouvait inverser gauche et droite).
- Non vérifié dans le navigateur (pas de test d'interface) : tailles, couleurs et position du pictogramme à régler à l'œil.
- Restes connus : pas d'indication « aiguille occupée » sur le canevas ; le faisceau debug en marche arrière part toujours du premier véhicule et non de la queue ; pictogramme HUD (option 3) non fait.

---

# Rames TGV articulées (Duplex / TGV M)

Plan validé le 2026-10-04 (détail : `~/.claude/plans/replicated-sauteeing-wave.md`). Pas de commit tant que l'utilisateur ne le demande pas.

- [x] 1. Table de matériel et règles de jonction : `src/domain/models/rollingStock.ts` + tests (Duplex 200,19 m / 13 bogies, TGV M 202 m / 14 bogies)
- [x] 2. Placement le long de la voie (`train.ts`) : `jointSpacing` / `endOverhang` à la place de la formule fixe, bogie partagé entre remorques
- [x] 3. Attelage et construction : dételage seulement entre deux motrices, modèle choisi dans la barre d'outils
- [x] 4. Visuels en contour : bogies dédoublonnés, caisses de pivot à pivot, soufflet sur le bogie partagé
- [x] 5. Persistance : champ `model`, recalage des anciennes sauvegardes au chargement
- [x] 6. Tests existants mis à jour, `npm test`, `npm run typecheck`, `npm run build`
- [ ] 7. Contrôle dans le navigateur

## Revue

- `npm test` : 614 tests verts (35 fichiers) ; `npm run typecheck` et `npm run build` verts, relancés après relecture.
- Contrôle indépendant : Duplex M+8R+M = 200,190 m sur 13 bogies ; TGV M à 9 voitures = 202,000 m sur 14 bogies ; en courbe R150, bogie partagé identique à chaque pas et décalage latéral maxi 4 cm aux jonctions articulées.
- Non vérifié dans le navigateur (sélecteur de modèle, rendu en contour).
- Restes connus : bout libre d'une remorque sans porte-à-faux (le bogie dépasse de 1,35 m, léger chevauchement à l'arrêt contre un autre train) ; fantôme d'une remorque posée contre une motrice dessiné sans son extension ; cotes TGV M en grande partie estimées.

---

# Niveaux de voie (ponts, sauts-de-mouton, tunnels)

Plan proposé le 2026-10-04, à valider. Prérequis de l'import OSM (hors périmètre ici). Pas de commit tant que l'utilisateur ne le demande pas.

## Principe

Un entier optionnel `level` sur `Segment` (absent = 0, plage −5…+5, équivalent du `layer` d'OSM). Pas d'altitude, pas de pente, pas de niveau sur les nœuds : le niveau d'un nœud se déduit de ses segments (un nœud de rampe touche deux niveaux). Le niveau ne joue que là où deux voies se croisent ou se touchent **sans nœud commun**.

Règle unique, partagée par tous les points ci-dessous : deux voies n'interagissent (croisement, soudure, découpe, doublon) que si elles ont un niveau en commun.

## Plan

- [ ] 1. Modèle (`types.ts`, `network.ts`) : champ `level?`, `segmentLevel(seg)`, `nodeLevels(net, nodeId)`, `setSegmentsLevel(net, ids, level)` (0 = champ supprimé, pour ne pas changer les fichiers existants)
- [ ] 2. Héritage du niveau partout où un segment est recréé, via un seul helper qui copie `parentSegmentId` + `level` : `splitSegmentAtNode` (`reconcile.ts`, droite et courbe), les deux découpes de `junction.ts` (l. 547 et 587), `dissolveNode` (`network.ts` : fusion refusée si les deux moitiés n'ont pas le même niveau), ciseaux et voie parallèle (`constructionTemplates.ts`)
- [ ] 3. Réconciliation (`reconcile.ts`, `network.ts`) :
  - candidats `cross` ignorés si les niveaux diffèrent
  - candidats `split` / `weld` nœud-sur-segment et nœud-sur-nœud ignorés sans niveau commun (un nœud isolé reste compatible avec tout)
  - `removeDuplicateSegments` ne supprime pas un doublon d'un autre niveau
- [ ] 4. Croisements (`crossing.ts`) : la détection géométrique sans nœud de `detectCrossings` ignore les paires de niveaux différents (corrige d'un coup le panneau latéral, le rendu des cœurs et l'export SVG)
- [ ] 5. Décroiser un croisement existant (`crossing.ts` ou `network.ts`) : `separateLevelsAtNode(net, nodeId)` — quand un nœud de degré 4 porte deux voies traversantes de niveaux différents, la voie du dessus reçoit un nœud jumeau au même endroit. C'est ce qui permet de transformer un diamant déjà posé en pont ; la règle du point 3 empêche la réconciliation de ressouder les deux nœuds
- [ ] 6. Persistance (`persistence.ts`) : `level` optionnel dans `SerializedSegment`, écrit seulement s'il est non nul, validé (entier borné) à la lecture, lu **avant** la réconciliation du chargement. Pas de changement de `version` ; l'undo suit tout seul (instantanés)
- [ ] 7. Store (`editorStore.ts`) : `shiftSelectionLevel(delta)` → `setSegmentsLevel`, `separateLevelsAtNode` sur les nœuds touchés, `reconcileNetwork()` (redescendre un pont à 0 doit recréer le croisement), `pushHistorySnapshot()`, `notify()`
- [ ] 8. Interface : champ « Niveau » avec `−` / `+` dans `SegmentPanel` (`SidePanel.tsx`) ; actions « Monter » / « Descendre » dans la barre contextuelle des voies (`contextBarModel.ts`), qui marchent sur une sélection multiple (un pont = plusieurs coupons)
- [ ] 9. Rendu (`renderer.ts`, `exportSvg.ts`) : segments dessinés par niveau croissant ; niveau > 0 : tablier (bande plus large que le ballast + garde-corps) dessiné sous la voie, qui masque ce qui passe dessous ; niveau < 0 : voie atténuée et en pointillés (tunnel) ; mode simplifié (faible zoom) : ordre + liseré seulement
- [ ] 10. Pointage (`hitSegment`, `hitNode`, `snapToNearestTrack`) : à distance égale, le niveau le plus haut l'emporte (on clique ce qu'on voit)
- [ ] 11. Tests pour chaque point, `npm test`, `npm run typecheck`, `npm run build`, contrôle dans le navigateur sur un huit avec pont

## Tests clés

- Deux droites qui se croisent à des niveaux différents : aucun nœud créé, aucun croisement détecté, deux sections indépendantes ; au même niveau : comportement actuel inchangé
- Un segment de niveau 1 coupé (ciseaux, aiguillage, réconciliation) donne deux moitiés de niveau 1
- Diamant existant, une voie montée à 1 : deux nœuds superposés, plus de croisement ; redescendue à 0 : le diamant revient
- Sauvegarde → chargement : niveaux conservés, pas de nœud recréé sous le pont ; un fichier sans `level` se charge à l'identique
- Rendu (mock `ctx`) : la voie de niveau 1 est tracée après celle de niveau 0

## À vérifier pendant l'implémentation

- Collisions entre trains (`train.ts` l. 400) : si elles sont calculées le long de la voie, rien à faire ; si elles sont géométriques, filtrer par niveau
- `computeTrackSections` : fondé sur les nœuds, donc a priori rien à changer une fois qu'aucun nœud n'est créé sous le pont

## Hors périmètre

- Import OSM, fond de carte, projection
- Trains dessinés par niveau : les trains sont tracés après tout le réseau, donc un train qui passe **sous** un pont apparaîtra par-dessus le tablier. Corriger ça demande d'entrelacer réseau et trains niveau par niveau dans `Canvas.tsx` : chantier à part
- Contrôle de cohérence des rampes (une voie de niveau 1 raccordée directement à du niveau 0 est acceptée telle quelle)
- Raccourci clavier pour monter / descendre
