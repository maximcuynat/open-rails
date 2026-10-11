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
- [x] **Lot 3b — réseau réel sans mode « Trains ».** `store.hasBuildMode` (faux dès qu'il y a
  un `dataset`) : `togglePlayMode` y met en pause au lieu de sortir, le sélecteur n'affiche que
  « Jeu », le bandeau de pause n'a plus de « Quitter la conduite ». En jeu, à l'arrêt :
  `armCoupling` + clic sur un attelage (`coupleInGame` : la rame qui garde la tête garde pilote,
  pupitre, itinéraire et cet écran), `removeTrainInGame` (jamais le dernier, jamais un train qui
  roule). `hud/YardTools.tsx` dans les deux panneaux. Une partie retrouvée après un rechargement
  reprend en pause (`enterGamePaused`).
- [x] **Lot 4 — partie retrouvée après un rechargement.** `domain/models/runningState.ts`
  (`captureGame`, `applyGame`) : vitesse, manettes, freins, pilote et vue libre de chaque train,
  écrits à part du projet (`open-rail:game`, à chaque écriture du projet) — ni les fichiers ni
  l'annulation ne les portent. Rendus au chargement à un train resté où il était
  (`restoreSavedGame`) ; tout ce qui ne se relit pas est ignoré. Sur un réseau de son cru, la
  simulation revient « suspendue » ; sur un réseau réel, en jeu et en pause.

## Reste des lots 1 à 3

- Sur un réseau réel, les boutons ⏹ (barre d'outils) et ✕ (console) disent encore « quitter » alors
  qu'ils mettent en pause.
- Poser un véhicule seul n'existe plus sur un réseau réel une fois la partie lancée : on pose une
  rame, on la dételle, on retire ce qui est en trop.
- Avant le premier lancement (« Ligne entre gares… » sans train), l'outil Train de l'éditeur sert encore.

- Un train laissé en marche garde sa vitesse même si on modifie la voie devant lui en édition :
  seuls les trains recréés (annulation, attelage, véhicules retirés avec leur rail) repartent à l'arrêt.
- Après un rechargement : le temps d'arrêt en gare du pilote repart de zéro, l'état des signaux est
  recalculé, un train déraillé ou en survitesse ne le retrouve pas, les pupitres téléphone sont à reprendre.
- L'état est écrit quand le projet l'est (fermeture de la page, pose d'un train…) : après un
  plantage du navigateur, la partie revient à la dernière écriture.

- Le pupitre téléphone ne sait pas que le jeu est en pause (pas de champ dans `ConsoleState`) : ses
  manettes bougent, le train ne part pas.
- Vu dans un navigateur sans écran, pas par un humain.
