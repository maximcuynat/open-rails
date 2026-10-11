# Modes édition et jeu : ne plus perdre la partie en cours

Branche `feature/modes-jeu`, ouverte le 2026-10-11 depuis `developement`.

## Constat

`isPlayMode` décidait à la fois du mode (édition ou jeu), de l'horloge (la simulation tourne ou non)
et du train tenu. Quitter la conduite remet tous les trains à l'arrêt (vitesse, manipulateur,
inverseur, freins), décoche tous les pilotes automatiques, efface les signaux et les conducteurs —
et la même remise à zéro est refaite à l'entrée. Une dizaine de chemins y mènent sans confirmation,
dont Échap et Espace.

## Lots

- [x] **Lot 1 — la pause.** `store.isPaused`, `setPaused`, `togglePause` : `simulateFrame` ne fait
  rien tant que la pause dure, rien n'est remis à zéro. Échap et Espace (`drive.pause`) mettent en
  pause et reprennent ; Échap range d'abord un train armé à poser. `drive.leave` (quitter) n'a plus
  de touche par défaut. `hud/PauseControl.tsx` : bouton ⏸ en haut au centre, bandeau « En pause »
  avec « Reprendre » et « Quitter la conduite » (confirmation si un train roule ou est sous pilote).
- [ ] **Lot 2 — quitter sans effacer.** Retour à l'édition qui fige les trains au lieu de les
  remettre à zéro, pilotes gardés ; « Reprendre la simulation » ; « Tout remettre à l'arrêt » en
  bouton à part ; un train dont la voie a été modifiée repart seul à l'arrêt.
- [ ] **Lot 3 — mode visible, sortie volontaire.** Indicateur « Édition | Jeu » ; une seule sortie,
  confirmée (les boutons ⏹ de la barre d'outils, ✕ de la console, le menu et F5 quittent encore
  sans rien demander) ; en bac à sable, plus de mode édition (attelage et dételage en jeu, à l'arrêt).
- [ ] **Lot 4 — plus tard.** État en cours enregistré (vitesses, pilotes) pour reprendre après un
  rechargement.

## Reste du lot 1

- Le pupitre téléphone ne sait pas que le jeu est en pause (pas de champ dans `ConsoleState`) : ses
  manettes bougent, le train ne part pas.
- Vu dans un navigateur sans écran, pas par un humain.
