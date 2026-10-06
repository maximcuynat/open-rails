# Pupitre du téléphone « Deux pouces »

Demande (2026-10-06) : les commandes du pupitre mobile sont trop petites. Retenu : en portrait, deux moitiés d'écran qui sont chacune une manette entière ; en paysage, la même chose avec une manette par bord (« manette de jeu »).

## Principe

- Mise en page fluide (grille CSS calée sur l'écran réel) : plus de dessin de 390 px ou de bandeau PC de 984 px mis à l'échelle.
- Une manette = toute sa zone. Le geste est relatif : on pose le pouce n'importe où, rien ne bouge, puis on glisse. La course est de 1 pour 1 avec la graduation ; sur une manette courte (petit écran) elle est allongée pour qu'un cran demande toujours au moins 28 px de glissement, et on peut lâcher puis reprendre.
- Traction : part du cran en cours, s'arrête de cran en cran, reste où on la laisse. Frein : part du neutre, serre vers le bas, desserre vers le haut, revient au neutre au lâcher.
- Aucun changement de contrat : mêmes `ConsoleState` et `ConsoleCommand`, `protocol.ts` et le PC ne bougent pas.

## Étapes

- [x] 1. `padGeometry.ts` : position d'une manette après un glissement, avec ses tests
- [x] 2. `ThumbPads.tsx` : la zone tactile, la manette de traction, la manette de frein
- [x] 3. `TwoThumbDesk.tsx` : le pupitre des deux orientations (remplace `PortraitDesk.tsx` et le bandeau PC en paysage)
- [x] 4. `RemoteDesk.tsx` : barre sur une ligne, placée dans la grille ; retrait de la mise à l'échelle
- [x] 5. `deskView.ts` : retrait de `fitStage` / `deskDesign` et de leurs tests
- [x] 6. `remoteDesk.css` : grille portrait et paysage, manettes, barre du bas
- [x] 7. Contrôle : tests, typage, puis navigateur aux tailles 390 × 844, 844 × 390, 360 × 640, 667 × 375

## Revue

- Fait le 2026-10-06. `PortraitDesk.tsx`, la mise à l'échelle (`ScaledStage`, `fitStage`, `deskDesign`) et le bandeau PC sur téléphone sont retirés.
- Tests : 1972 passent (dont `padGeometry.test.ts`), `tsc --noEmit` passe.
- Navigateur sans interface, bout à bout avec un onglet PC : prise d'un train, glissements simulés sur les deux manettes (toucher sans bouger ne change rien, +2 crans, reprise plus bas, frein desserré pendant que la traction est tenue, retour au neutre au lâcher), les commandes arrivent au PC.
- Tailles regardées : 390 × 844 (manettes de 183 × 459 px), 844 × 390 (199 × 374 px), 667 × 375, 740 × 320, 360 × 640, 375 × 553.
- Écarts par rapport aux maquettes : pas de volet pour les statistiques (distance d'arrêt, pente et accélération restent affichées, et cèdent la place sur petit écran) ; « Changer de cabine » est dans la barre du bas dans les deux orientations ; la barre du haut tient sur une ligne (« Trains », « Rendre »).
- Reste à faire : essai sur un vrai téléphone, avec de vrais pouces (étape 19 de `plan-console-conduite.md`) — les glissements n'ont été joués que par des évènements simulés.
