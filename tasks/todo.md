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
- Valeurs : P5 = 5,5 m/s², B5 = 10 m/s², urgence = 20 m/s² (arcade, à ajuster si besoin).

---

# Branche `feature/train-coupling` : à faire avant de la supprimer

Mis de côté le 2026-10-04. Rien n'est lancé tant que l'utilisateur ne le demande pas.

- [ ] 1. Commiter et pousser le travail en cours (il n'existe que localement) ; `CLAUDE.md` dans un commit `docs:` séparé
- [ ] 2. Vérifier `npm run typecheck` et `npm run build` verts
- [ ] 3. Fusionner `main` dans la branche (2 commits de retard : CI et `base` GitHub Pages)
- [ ] 4. Fusionner dans `developement`, puis supprimer la branche en local et sur le dépôt distant
- [ ] 5. Traiter ensuite `feature/curve-angle-rotation-gizmo` (conflits attendus sur `gizmo.ts` et `ToolBar.tsx`)
