# Manipulateur à ±10 crans et pilote automatique amélioré

## Contexte

Le manipulateur va de B5 à P5 : chaque cran vaut 20 % de l'effort, trop gros pour tenir une
vitesse. Le pilote automatique (`pilotOrders`) en hérite : il tire fort, coupe, freine (trois
bandes autour de la vitesse visée), rampe longtemps avant un quai et ralentit trop tôt sur LGV.

Décidé avec toi :
- manipulateur de **B10 à P10** (10 % par cran) ;
- bandeau PC en **échelle graduée** : 21 cases fines, libellés sur B10, B5, N, P5, P10 seulement ;
- clavier : **touche maintenue = les crans défilent**, arrêt sur N ;
- pilote : régulation douce, arrêt à quai plus précis, P1 (signal de cabine), P2 (téléphone).

Cinq lots, chacun livré seul : fait, testé, commité avant le suivant. Le plan sera recopié dans
`tasks/plan-pilote-crans.md` au démarrage (pas dans `todo.md`, réécrit par d'autres sessions).

## Lot 1 — Manipulateur à ±10 crans

**Modèle.** `src/domain/models/trainDynamics.ts` : `TRACTION_NOTCHES = 10`,
`ELECTRIC_BRAKE_NOTCHES = 10`. `MAX_NOTCH` / `MIN_NOTCH` (`train.ts`), `buildConsoleState`,
`setNotch`, le protocole (`NOTCH_LIMIT = 32`) et les leviers (`notchAtRatio` / `ratioOfNotch`)
suivent sans changement. Le cran n'est pas enregistré dans les projets : pas de migration.

**Affichage.**
- `consoleModel.ts` — `NotchStop` gagne `major` (cran multiple de 5, N compris) ; `notchStops` le remplit.
- `instruments.tsx` `NotchScale` — libellé écrit seulement sur un cran `major`, `title` /
  `aria-label` sur tous ; `styles.css` `.console-notch` : cases fines, trait plus haut sur `major`.
  Le cran en cours reste écrit en clair (`handleLabel`, « P7 · 70 % », déjà là).
- `consoleParts.tsx` `ThrottleLever` et `remote/ThumbPads.tsx` `TractionPad` — libellé vide hors
  `major` : un trait par cran, un nom tous les cinq (vérifier que `Lever` dessine le trait sans nom).
- `remote/padGeometry.ts` — `MIN_SLIDE_PER_NOTCH` 28 → 14 px : la course minimale reste 280 px.

**Clavier.** `useKeyboardShortcuts.ts`, action `drive.notchUp/Down` : un appui = un cran ; sur
`e.repeat`, un cran toutes les ~120 ms (cadence propre, pas celle du système), et le défilement
s'arrête sur N jusqu'au relâchement. La règle est une fonction pure testée (instant du dernier
pas, cran, « bloqué sur N ») ; remise à zéro dans `handleKeyUp` et à la perte de focus.

**Pilote, sans changer sa conduite.** `application/console/autopilot.ts` : les deux formules de
cran sont mises à l'échelle (`/1.5` → `/0.75`, `/0.8` → `/0.4`) pour que le lot 1 soit neutre.

**Textes et tests.** « P5 / B5 » → « P10 / B10 » dans `ShortcutsModal.tsx`, les commentaires de
`editorStore.ts`, `tasks/plan-console-conduite.md`. Tests qui écrivent 5 / −5 ou un cran précis
(`trainDynamics.test.ts`, `train.test.ts`, `consoleCommands.test.ts`, `consoleModel.test.ts`,
`leverGeometry.test.ts`, `padGeometry.test.ts`, `remoteSession.test.ts`, `protocol.test.ts`,
`autopilot.test.ts`…) : passer par `MAX_NOTCH` / `MIN_NOTCH` quand le test parle de la butée,
doubler le cran quand il parle d'une part d'effort (cran 3 = 60 % devient cran 6).

## Lot 2 — Régulation douce

Dans `pilotOrders` (pur, sans mémoire), les trois bandes sont remplacées par une commande par pas :
- accélération voulue `a* = (visée − v) / τ` (τ ≈ 4 s), bornée par la décélération de plan ;
  devant une contrainte, `a*` ne dépasse pas `−needed` ;
- comparée à `state.acceleration` : en dessous de la bande → un cran de plus, au-dessus → un
  cran de moins, depuis `state.notch`. Le manipulateur lui-même tient lieu d'intégrateur : pas
  d'écart permanent en rampe ou à grande vitesse ;
- un seul cran par regard, et seulement quand `state.handleEffort` a rejoint le cran en cours
  (l'effort suit le cran avec une rampe) — sauf retour direct à N pour freiner à l'air ou en urgence ;
- les crans négatifs (frein électrique) sont sur la même échelle ; le frein à air ne vient que
  si B10 ne suffit pas ou sous la vitesse où le frein électrique s'efface.

Mesure avant / après, dans `application/game/autopilot.test.ts` (ligne droite existante `line()`),
gardée comme tests : écart de vitesse en croisière (≤ 0,5 m/s sous la visée, jamais au-dessus de
la limite), nombre de passages par N sur deux minutes de croisière, aucun saut de plus d'un cran
hors freinage. Même scénario avec une rampe.

## Lot 3 — Arrêt à quai plus précis

Aujourd'hui : `REACTION_S` retranche `v × 2,5 s` à la distance jusqu'au bout, puis rampage à
1,5 m/s (`CREEP_*`). À faire dans `pilotSpeed` / `pilotOrders` :
- une seule courbe jusqu'au point d'arrêt ; la marge de réaction décroît avec la vitesse ;
- frein à air dosé sur la décélération nécessaire (`needed / full`) et non par seuils ;
- rampage réduit à un filet de sécurité (rame arrêtée trop court), pas le cas normal.

Tests : arrêt entre −5 m et +1 m du repère (aujourd'hui −60 / +3), temps passé sous 2 m/s avant
l'arrêt borné, pas de freinage d'urgence, pas de reprise de traction dans les 200 derniers mètres.
Les valeurs exactes sont fixées après mesure de l'existant.

## Lot 4 — P1, signal de cabine

`pilotSpeed` prend toute vitesse de cabine `> 0` comme plafond immédiat. Or une **annonce**
(`cab.kind === 'announce'`) se respecte au prochain repère : elle devient une contrainte
`{ speed, distance: markerDistance }` dans `constraintsOf` ; `execute` et `line` restent des
plafonds ; sans repère (`markerDistance === null`), plafond comme aujourd'hui.

Tests : pur (à 3 km du repère sous « 160 annoncé », la visée reste au-dessus de 160 et y arrive
au repère) ; sur une ligne à signalisation de cabine avec un train devant, le pilote ne déclenche
jamais le contrôle de vitesse (`cabControlSpeed` + marge, `cabSignalling.ts`) et s'arrête au repère.

## Lot 5 — P2, pilote depuis le téléphone

- `consoleContract.ts` : commande `{ type: 'autopilot'; on: boolean }` (et dans la liste des types) ;
- `protocol.ts` : validation de la commande (`state.autopilot` est déjà validé) ;
- `consoleCommands.ts` : appliquée par `store.setAutopilot` dans les deux chemins (PC et
  `applyDeskCommand`) ; elle n'entre pas dans `HANDLE_COMMANDS` ;
- `remote/TwoThumbDesk.tsx` : bouton « Pilote » allumé quand `state.autopilot` ; toucher une
  manette le coupe (déjà le cas). Témoin « PILOTE » sur les trois consoles PC ;
- `remoteHost.ts` : le repli « frein maintenu » quand le téléphone se tait ne doit pas se battre
  avec le pilote — à vérifier, test à l'appui.

## Vérification

À chaque lot : `npm test`, `npm run typecheck`, puis commit proposé (`feat(console): …`,
`feat(game): …`).

À l'écran (navigateur sans tête, `npm run dev`, bac à sable) : captures des trois consoles
(bandeau, écran de bord, manettes) à 100 % et à 80 %, thème sombre compris, et de la page
téléphone en portrait et paysage ; touche maintenue qui s'arrête sur N ; un trajet entier au
pilote sur LGV (`tools/perf/measure-driving.cjs`, dont les 12 pas de cran passent à 20).

En fin de programme : `tasks/plan-jeu-conduite.md` (P1, P2 cochés, lignes « à contrôler à
l'écran »), `tasks/plan-console-conduite.md`, et la phrase du pilote dans `CLAUDE.md` si P2 la change.

## Revue (2026-10-11)

Les cinq lots sont faits ; `npm test` (2829 tests) et `npm run typecheck` passent. Rien n'est commité.

Mesures du pilote, `PROFILE=1 npx vitest run tools/perf/measure-pilot.test.ts --silent=false`
(TGV Duplex, ligne droite à 160 km/h, avant = commit `edb4261`) :

| | avant | après |
|---|---|---|
| Croisière 2 min en palier : mouvements du manipulateur | 186 | 0 |
| Croisière : écart à la vitesse visée | 0,81 m/s | 0,19 m/s |
| Rampe de 12 ‰ : écart maximal | 1,52 m/s | 0,17 m/s |
| Vers un quai : mouvements du manipulateur / plus grand saut | 298 / tout le manipulateur | 48 / 1 cran |
| Vers un quai : inversions serrer ↔ desserrer du frein | 35 | 5 |
| Arrêt par rapport au repère | −0,51 m | −0,69 m |
| Durée du trajet de 11,5 km | 365 s | 365 s |

- L'arrêt était déjà précis ; le gain du lot 3 est la régularité : une décélération continue
  jusqu'au repère (0,35 m/s² sur la fin) au lieu d'un relâchement suivi d'une reprise.
- Le freinage le plus fort monte de 0,59 à 0,73 m/s² au début d'un freinage : le frein électrique
  met 4 s à s'établir, le pilote rattrape sa courbe. Reste sous le freinage de service.
- Lot 4 : avec des cantons de 1 500 m, l'annonce se respecte au repère (à mi-canton sous « 270
  annoncé » : 264 km/h avant, plus de 275 après) et le contrôle de vitesse ne se déclenche pas.
- Vu à l'écran (navigateur sans tête) : bandeau, écran de bord et manettes à 21 crans, touche
  maintenue qui s'arrête sur N, témoin « Pilote · Traction ». Pas vu : la page téléphone (bouton
  « Pilote », manette à 21 crans) et le bandeau réduit à 80 %.
- Écart au plan : pas de témoin séparé sur les consoles, le titre du manipulateur le porte.
