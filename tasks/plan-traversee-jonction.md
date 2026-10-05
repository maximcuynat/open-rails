# Plan — nœud à 4 rails manœuvrable (traversée-jonction)

État : **option A faite** le 2026-10-05 (voir « Revue » en bas). Reste le rendu mécanique dédié.

## Le problème

Un nœud où se rejoignent 2 rails d'un côté et 2 de l'autre, tous tangents (deux aiguillages
dos à dos sur le même point), n'a aucune table d'itinéraires :

- `proposeJunction` (`src/domain/models/junction.ts:347`) trouve 4 tiges et rend `null`
  (`stems.length !== 1`) ;
- `syncJunctions` supprime la table d'un aiguillage dès qu'un 4ᵉ rail prolonge une de ses
  branches (`continuesABranch`) ;
- `routing.ts` retombe sur la règle par défaut : la continuation la plus droite, départagée de
  façon fixe (`straightestFirst`). Le nœud se comporte en croisement fixe, rien à basculer.

`JunctionKind` contient déjà `'double_slip'`, mais rien ne le déclare ni ne le lit.

## Décision à prendre

| | A — appareil `double_slip` (recommandé) | B — scinder automatiquement le nœud |
|---|---|---|
| Principe | une table à 4 passages sur le nœud | l'éditeur insère un court tronçon : deux nœuds à 3 rails |
| Tracé | inchangé | modifié (quelques mètres de voie ajoutés) |
| Coût | domaine + tous les lecteurs de `turnoutView` | une opération d'édition, tout le reste est déjà géré |
| Risque | appareil non-aiguillage : chaque lecteur doit le traiter | géométrie retouchée dans le dos de l'utilisateur |

## Option A — étapes

### 1. Domaine : la table (rend le nœud fonctionnel à lui seul)

- [x] `declareDoubleSlip(net, { nodeId, sideA: [rail, rail], sideB: [rail, rail] })` dans
      `junction.ts` : `passages` = les 4 paires A×B, `positions` = `[[0],[1],[2],[3]]`
      (les pointes de chaque côté choisissent un rail : un seul passage ouvert à la fois).
- [x] `proposeJunction` : quand il y a exactement 4 rails, 4 tiges, et que les rails se
      répartissent en deux paires opposées (chaque rail continue les deux d'en face et aucun de
      son côté) → `declareDoubleSlip`. Sinon `null` comme aujourd'hui (vrai croisement en X :
      chaque rail n'a qu'une continuation, donc 0 tige, inchangé).
- [x] `syncJunctions` : un aiguillage qui reçoit un 4ᵉ rail formant cette figure devient une
      traversée-jonction ouverte sur le même passage, au lieu de perdre sa table ; une
      traversée-jonction qui perd un rail redevient un aiguillage (`dropDeadPassages` +
      `normalizeTurnoutRoles`, comme le 3 voies → aiguillage).
- [x] Vue dérivée `doubleSlipView(net, junction)` : les deux rails de chaque côté, ordonnés
      (droit / dévié via `branchSides`), et la position de chaque jeu de pointes.
- [x] `setDoubleSlipSide(junction, side, railIndex)` : manœuvre un seul côté.
- [x] Tests dans `junction.test.ts` : proposition, les 4 itinéraires via `isPassageOpen`,
      rail fermé (`isRailClosedAt`), ajout/retrait d'un rail, indépendance à l'ordre des rails.

### 2. Persistance

- [x] Vérifier que `restoreJunction` (`persistence.ts:382`) relit un `double_slip` tel quel
      (la voie générique existe) ; test d'aller-retour, et undo/redo.

### 3. Commande

- [x] Clic / touche `T` : bascule le jeu de pointes du côté le plus proche du curseur
      (et non un cycle sur 4 positions).
- [x] `locomotive.ts:1065-1146` (choix de direction en conduite) : traiter l'appareil côté
      par côté — le train ne manœuvre que les pointes qu'il aborde par la pointe.
- [x] `SidePanel`, `ContextMenu`, `contextBarModel` : état et deux bascules.
- [x] Console (`consoleModel.ts`, `deskView.ts`, `RemoteDesk.tsx`) : prochain appareil affiché.

### 4. Rendu

- [ ] `renderer.ts` / `networkDerived.ts` / `exportSvg.ts` : lames des deux côtés selon la
      position, lanterne par côté ; pas de cœur de croisement fixe.

### 5. Lecteurs à passer en revue (appellent `turnoutView`, qui rend `null` ici)

`sections.ts`, `signalBlocks.ts`, `signalReport.ts`, `trackSpeed.ts` (vitesse en voie déviée),
`pathfinding.ts`, `signalling.testkit.ts`.

### Vérification

- [x] `npm test` et `npm run typecheck`.
- [x] Dans le navigateur : reproduire la figure de la capture, faire passer un train par les
      4 itinéraires, dans les deux sens.

## Option B — étapes

- [ ] Dans `syncJunctions` (ou à la pose du 4ᵉ rail), détecter la figure et décaler le
      rattachement du rail ajouté de `d` mètres le long de la voie droite (`splitSegment`).
- [ ] Choisir `d` (longueur minimale entre deux pointes) et l'historique (un seul snapshot).
- [ ] Tests + même vérification navigateur.

## Revue (2026-10-05)

Fait, option A :

- **Domaine** (`junction.ts`) : `declareDoubleSlip`, `doubleSlipView`, `doubleSlipSideOf`,
  `setDoubleSlipSide` / `throwDoubleSlipSide`, `doubleSlipSideToward`, et `openPassage` (met un
  appareil dans la position qui ouvre un passage donné, quel que soit son type).
  `proposeJunction` lit la figure ; `syncJunctions` transforme l'aiguillage qui reçoit le 4ᵉ rail
  (même id, même itinéraire ouvert) et refait un aiguillage quand un rail disparaît.
- **Critère** : deux rails par côté qui quittent le nœud sur la même droite (`isCrossingAngle`
  faux entre eux). Deux voies qui se croisent, même à faible angle, restent un croisement fixe.
- **Conduite** (`locomotive.ts`) : `findJunctionAhead` voit la traversée-jonction comme abordée
  par la pointe du côté opposé ; `steerJunction` passe par `openPassage`, donc choisir la sortie
  ouvre aussi les pointes du côté d'arrivée. `JunctionAhead` porte `stemSegmentId` et `branchRails`.
- **Commande** : clic sur le nœud sélectionné = pointes du côté du curseur ; `T` et « Aiguiller »
  de la barre = cycle des 4 positions ; panneau latéral = un bouton par côté.
- **Sections** : le nœud est une frontière de section, comme un aiguillage triple.
- **Rien à changer** : routage, signalisation, vitesses (ils ne lisent que la table), persistance
  (`restoreJunction` relit un `double_slip` tel quel), console (elle lit `TurnoutAhead`).
- **Écart au plan** : `T` fait un cycle (le raccourci n'a pas de position de curseur) ; seul le clic
  vise un côté.

Vérifié : `npm test` (1 618 tests), `npm run typecheck`, et dans le navigateur (figure chargée,
clic de chaque côté, boutons du panneau, « Aiguiller » de la barre).

Reste :

- [ ] Rendu mécanique dédié (lames, lanterne par côté) et export SVG : aujourd'hui seuls les
      rails fermés sont atténués, par la règle commune `isRailClosedAt`.
- [ ] Clic à droite du nœud : au-delà de 8 px la flèche X du gizmo prend le clic (même limite
      que pour un aiguillage simple).
- [ ] Conduite d'un train sur les 4 itinéraires dans le navigateur (couverte par les tests seulement).
