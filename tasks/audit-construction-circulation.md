# État des lieux : construction des voies et circulation des trains

Relevé du 2026-10-05, avant d'ajouter des outils de construction. Lecture seule, aucun code modifié.
« Essayé » = reproduit par un test jetable ; « lu » = déduit du code sans l'exécuter.
Les numéros de ligne datent du relevé ; une autre session modifiait `junction.ts`, `network.ts`, `locomotive.ts`, `reconcile.ts` en parallèle, ils ont pu glisser de quelques lignes.

## Comment c'est construit

- **Rail droit** (`Canvas.tsx:1280-1518`, saisie de longueur `2330-2380`) : un `addSegment` par clic, quatre chemins de pose distincts (clic sur un nœud, prolongement, double voie, longueur tapée). L'aperçu est un code à part (`placementPreview.ts:73-124`).
- **Rail courbe** (`Canvas.tsx:1181-1278`) : `resolveCurveTool` → `computeCurveToolGeometry` + `checkCurveJoins`, puis `addCurveChain` (pièces de 15° maximum). Seul outil où l'aperçu, le survol et le clic passent par la même fonction, et seul outil qui contrôle le raccord (15°) et le rayon mini à la pose.
- **Aiguillage** (`Canvas.tsx:1520-1558`) : pose une courbe en S (`applyFreeformParallelTurnout`, `constructionTemplates.ts:559`). **Il ne crée aucun objet aiguillage.**
- **Les aiguillages sont entièrement déduits de la forme** : `autoDetectJunctions` (`junction.ts:120`) tourne à chaque `notify()` et à la fin de chaque réconciliation. Il ne conserve que l'identifiant et `activeBranch` ; tige, voie directe, voie déviée, main et numéro de cœur sont recalculés à chaque fois. `placeTurnout` n'a aucun appelant hors tests.
- **Réconciliation** (`reconcile.ts:256`) : après chaque pose, soude les nœuds confondus, coupe un rail sous un nœud, crée un nœud à chaque croisement (≥ 1°). Tolérance 0,10·k m, 40 opérations maximum par appel.
- **Circulation** : à chaque nœud le train prend le premier voisin autorisé par `isTransitionAllowed` (`pathfinding.ts:92`) : règles d'aiguille, puis déviation ≤ 15° sur les tangentes, puis « tout droit » sur un nœud à 4 rails qui n'est pas un aiguillage. Les suiveurs sont reposés à chaque pas depuis le bogie de tête (`train.ts:442-460`).

## Ce qu'un train exige du graphe

1. Raccord ≤ 15° à chaque nœud du trajet, sinon c'est une fin de voie.
2. Tout choix d'itinéraire doit être un aiguillage reconnu : nœud à 3 rails (tige + 2 branches ≤ 15°) ou à 4 rails (tige + 3 branches).
3. Une seule sortie autorisée par (nœud, rail d'arrivée) ; sinon c'est l'ordre d'insertion dans `adjacency` qui décide.
4. Les branches d'un aiguillage doivent aboutir à des nœuds différents (les règles comparent des identifiants de nœud, `pathfinding.ts:111-151`).
5. Les identifiants de segment sous un train doivent survivre : une position est `(segId, t, forward)`. Toute coupe, dissolution ou suppression en émet de nouveaux.
6. Deux trains ne se voient que s'ils sont sur le même segment.

## Risques, par gravité

### Graves

- **R1 — Recharger un fichier peut abîmer le réseau** (essayé). `deserializeNetwork` réconcilie (`persistence.ts:293`) avant de resynchroniser le compteur d'identifiants (`:325`). Sur une page fraîche, les nœuds et segments créés par la réconciliation s'appellent `n_1`, `s_1`… et écrasent ceux du fichier. Se déclenche quand l'état sauvegardé a encore besoin d'être réconcilié : plus de 40 opérations en attente, inversion de main d'un aiguillage (`editorStore.ts:1697`, déplace un nœud sans réconcilier), fichier importé ou modifié à la main.
- **R2 — Modifier la voie près d'un aiguillage peut inverser son itinéraire et déplacer un train** (essayé). Sur un aiguillage posé par l'outil (branche tangente à la tige) ou un Y symétrique, « directe » et « déviée » sont départagées par l'ordre d'`adjacency` (`junction.ts:156-172`). `splitSegment` réinsère le rail en dernier : au `notify()` suivant les rôles s'échangent, `activeBranch` garde son étiquette, l'aiguille est donc manœuvrée de fait, sans passer par le garde « aiguille occupée ». Un train à cheval est reposé sur l'autre branche au premier recul : 5,7 m d'écart mesuré, 14,3 m sur un Y symétrique. C'est le défaut « 5 m » déjà noté dans `todo.md`.
- **R3 — Un 4ᵉ rail sur la pointe d'un aiguillage supprime l'aiguillage sans prévenir** (essayé). Le nœud devient une traversée fixe : depuis la tige seule la voie la plus droite reste accessible. Un nœud à 4 rails avec deux tiges (traversée-jonction, cœur de bretelle double) ne peut pas être représenté : `Junction` n'a qu'une tige. À 5 rails et plus, aucun aiguillage, itinéraire selon l'ordre d'`adjacency`.
- **R4 — Le rail droit pose des angles infranchissables sans rien dire** (lu ; fourche à 41° essayée → aucun aiguillage). Clic sur un nœud existant ou arrivée sur un rail : raccord à n'importe quel angle, alors que l'aperçu montre un rail dans l'axe. Le rail est une impasse pour les trains ; seul le diagnostic cinématique le signale après coup.
- **R5 — Couper, dissoudre ou supprimer un rail occupé supprime les véhicules dessus, sans refus ni message** (lu). Concerne tous les `splitSegment` de `Canvas.tsx`, les ciseaux, la réconciliation et `deleteSelection`. Seules la manœuvre d'aiguille et l'inversion de main sont gardées.
- **R6 — Reculer à travers une aiguille fermée laisse le train coincé** (essayé). La queue et les suiveurs passent (`walkBackward` force branche → tige, `locomotive.ts:217-237`), puis le bogie de tête est refusé à la pointe. L'aiguille est alors occupée, donc impossible à manœuvrer ; il faut repartir en avant.

### Moyens

- **R7 — Deux rails entre les deux mêmes nœuds à un aiguillage : tout est bloqué** (essayé). `straightNodeId === divergingNodeId`, toutes les sorties refusées. Les gabarits actuels l'évitent en insérant un nœud intermédiaire ; un outil d'évitement ou de voie parallèle devra faire de même.
- **R8 — Une liaison entre deux voies donne deux aiguillages indépendants** (essayé). L'itinéraire en diagonale n'existe que si les deux sont manœuvrés ; avec un seul, le train est bloqué à l'autre pointe. Aucun couplage possible dans le modèle.
- **R9 — Le dessin peut contredire l'itinéraire** (essayé pour l'estompage, lu pour les lames). Le routage compare des nœuds, le dessin des segments. Sur un aiguillage à branche tangente, la main est décidée par du bruit numérique (fausse dans 1 440 cas sur 2 880 essayés) et la courbe peut être étiquetée « directe » : lames et cœur peuvent être dessinés du mauvais côté.
- **R10 — Tolérances d'accrochage incohérentes** (lu). Aimant de nœud `min(0,80 m, 16 px)`, rail 16 / 18 / 24 px selon l'outil, réconciliation 0,10·k m. À faible zoom un clic à 3 px d'une extrémité coupe le rail au lieu de prendre le nœud : segment minuscule + nœud à 3 rails. Plusieurs constantes ignorent l'échelle modélisme.
- **R11 — Deux fonctions de coupe différentes** (lu). `splitSegment` (outils) choisit sur une courbe le plus proche de 31 échantillons ; `splitSegmentAtNode` (réconciliation) est exact. L'outil courbe valide une géométrie puis en pose une légèrement différente quand la cible est une courbe.
- **R12 — Le bout de la courbe en S de l'outil aiguillage n'est pas contrôlé** (lu) : ni accrochage ni aperçu du raccord, la réconciliation fait ce qu'elle trouve après le clic.
- **R13 — Ajouter ou retirer une branche réinterprète l'itinéraire** (essayé) : aiguillage dévié + 3ᵉ branche → remis en voie directe ; triple en « gauche » dont on retire la gauche → bascule à droite.
- **R14 — Aiguillages périmés ou en double** (essayé) : `removeNode` sur une pointe laisse l'aiguillage dans `net.junctions` ; souder deux pointes laisse deux aiguillages sur un nœud le temps de quelques `notify()`.
- **R15 — Collisions non détectées** : les deux voies d'une traversée (essayé : un train en traverse un autre), le gabarit d'un aiguillage, la queue du train lui-même.

### Mineurs

- Fourche de deux rails à moins de 36° sur un nœud à 2 rails : aiguillage sans tige, les deux bras bloqués.
- Plafond de 40 opérations de réconciliation ; combiné à R1, c'est un chemin de corruption.
- Les trains ignorent les sens uniques des sections (`sectionMeta` n'est jamais passé aux marches).
- `findJunctionAhead` s'arrête à 10 segments ; une courbe en pièces de 15° les consomme vite, les touches d'aiguillage peuvent rester sans effet jusqu'à ce que le train soit proche.
- Double voie : `lastNodeId` peut pointer sur un nœud que la réconciliation a soudé ; clics sans effet jusqu'à Échap.

## Ce qui est sain

- Graphe : pas de boucle sur un nœud, pas de doublon identique, croisements ≥ 1° reliés par un nœud, un pas d'annulation par pose pour les trois outils.
- Détection : identifiant et `activeBranch` stables d'un appel à l'autre ; seuil de 15° appliqué pareil par le détecteur et par les trains ; Y net, T, traversée et aiguillage triple se comportent de façon déterministe.
- Trains : longueurs sur les courbes calculées en abscisse curviligne partout ; restauration des trains à l'annulation et au chargement ; gardes sur la manœuvre d'aiguille et l'inversion de main.

## Code mort qui peut tromper

- `placeTurnout` et `TURNOUT_SPECS` (tests seulement, longueurs en millimètres dans un monde en mètres).
- `application/commands/*`, `ToolStrategy.ts`.
- `applyAutoConnect`, `applyCrossover`, `applyParallelTurnout`, `applyPassingSiding`, `applyBalloonLoop` : aucun appelant. `applyBalloonLoop` pose 8 cordes droites à 45°, infranchissables.
- `store.turnoutRadius`, `turnoutSide`, `turnoutOffset` : écrits, jamais lus. Mode catalogue inatteignable.
- Locomotive legacy : plus accessible depuis l'interface.

## Règles pour un nouvel outil, en l'état actuel du modèle

- Garder chaque nœud à 3 rails au plus, ou une vraie traversée / un vrai triple à 4.
- Jamais deux rails entre les deux mêmes nœuds à un aiguillage.
- Tester `isTrackOccupied` avant de couper ou supprimer.
- Ne rien écrire dans un aiguillage hors `activeBranch` : tout le reste est écrasé au `notify()` suivant.
- Appeler `notify()` avant que quoi que ce soit ne parcoure la voie.

## Questions à trancher pour le plan

1. Aiguillages déduits de la forme (aujourd'hui) ou déclarés par l'outil qui les pose ? R2, R3, R8, R9 et R13 viennent tous de la déduction.
2. Faut-il un modèle pour les appareils à deux tiges (traversée-jonction, bretelle double) et le couplage de deux aiguilles ?
3. Que fait une modification de voie sous un train : refus, ou repositionnement du train sur les nouveaux morceaux ?
4. Un seul chemin de pose et d'accrochage partagé par tous les outils (comme l'outil courbe), avec le contrôle des 15° à la pose ?
