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
- [x] **Lot 2 — quitter sans effacer.** `togglePlayMode` ne remet plus rien à zéro, ni à la sortie
  ni à l'entrée : vitesses, manettes et pilotes restent, et la conduite reprend de là (dans la vue
  libre si on l'avait quittée de là). `store.isSimulationHeld` + bandeau « Simulation suspendue »
  hors conduite (« Reprendre », « Tout remettre à l'arrêt » = `haltAllTrains`), mêmes entrées au menu
  Simulation. Un train neuf est à l'arrêt, freins serrés (`makeTrainSet`). Les pupitres téléphone
  lâchent leur train à la sortie (manette au neutre). Les pilotes sont effacés au chargement d'un
  projet ; ceux d'un train disparu, à la reprise.
- [x] **Lot 3a — mode visible.** Sélecteur « Édition | Jeu » toujours affiché dans la barre du haut
  (`topbar/modeSwitch.ts`, `ModeSwitch` dans `TopBar.tsx`), avec l'état du temps à côté de « Jeu » :
  en marche, en pause, suspendue. Sur un réseau réel le côté édition s'appelle « Trains » (la voie
  y est verrouillée). « Jeu » est grisé sans train.
- [ ] **Lot 3b — bac à sable sans mode « Trains ».** Demande d'abord, en jeu et à l'arrêt :
  atteler et dételer (les rames changent d'identifiant : pilotes, itinéraires et pupitres à
  reporter), retirer un train, poser un véhicule seul. Tant que ce n'est pas fait, le mode
  « Trains » reste le seul endroit où le faire.
- [ ] **Lot 4 — plus tard.** État en cours enregistré (vitesses, pilotes) pour reprendre après un
  rechargement.

## Reste des lots 1 et 2

- Un train laissé en marche garde sa vitesse même si on modifie la voie devant lui en édition :
  seuls les trains recréés (annulation, attelage, véhicules retirés avec leur rail) repartent à l'arrêt.
- Après un rechargement de page, les trains sont à l'arrêt et sans pilote (lot 4).

- Le pupitre téléphone ne sait pas que le jeu est en pause (pas de champ dans `ConsoleState`) : ses
  manettes bougent, le train ne part pas.
- Vu dans un navigateur sans écran, pas par un humain.
