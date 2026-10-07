# Affichages de la signalisation, des limites de vitesse et du dévers

Passe de design du 2026-10-06, branche `feature/signalling-display`. Tout a été regardé à l'écran, dans un Chromium sans écran, la simulation avancée pas à pas.

- Page avant / après : `tasks/maquettes/signalisation/index.html` (96 paires d'images, `avant/` et `apres/`, mêmes noms de fichiers).
- Réseaux d'essai : `tasks/maquettes/signalisation/reseaux/*.json` (Fichier ▸ Importer). Ils sont écrits par `reseaux/construire.ts` (`npx vite-node tasks/maquettes/signalisation/reseaux/construire.ts`).

Ce fichier a son propre nom parce que `tasks/todo.md` est réécrit par d'autres sessions.

## 1. Ce qui n'allait pas

### Sur le plan

| Image | Constat |
|---|---|
| `plan-signaux-*-sombre` | Le mât du signal était noir sur fond noir : la tête flottait à côté de la voie. Même défaut pour le poteau des panneaux « Z / R » et des panneaux d'annonce. |
| `plan-signaux-construction-*`, `plan-rapport-*`, `selection-signal-*` | Le libellé du rapport de contrôle (« Canton trop court : 1 050 m pour 1 411 m d'arrêt à 160 km/h ») s'écrivait sur la tête du signal qu'il concerne, et deux libellés voisins l'un sur l'autre. Sur une ligne signalée tous les kilomètres, le plan n'était plus qu'une pile d'étiquettes orange. |
| `plan-bifurcation-pro-*` | Ralentissement et rappel dessinés pareil (deux feux jaunes côte à côte). Aucun clignotement à 60 km/h, alors que le poste de conduite, lui, clignote. |
| `plan-voie-unique-*`, `plan-pont-tunnel-*` | Cantons en huit couleurs, dont orange, jaune, rose et vert clair : à côté de la bande ambre d'une zone de vitesse, du liseré de section et des feux, on ne savait plus ce qui était quoi. Le comportement sous un pont et en tunnel, lui, est bon. |
| `plan-zones-pro-*` (vue d'ensemble) | En vue schématique les panneaux « Z / R » et la bande disparaissent, mais les panneaux d'annonce restaient, seuls au-dessus d'une voie sans zone visible. |
| `plan-courbe-*`, `ecran-deraillement` | Le panneau de déraillement se posait au milieu du canevas, donc sur la rame déraillée que la caméra garde au centre. |
| `outil-pose-serie-*` | « Série 1 signaux ». |

### Au poste de conduite du PC

| Image | Constat |
|---|---|
| `poste-*-cabine` | Textes coupés par des points de suspension : « Voie libre, ann… », « Survitesse : freinage d'urg… ». C'est justement le message à lire en premier. |
| `poste-*-signaux-*` | Un signal fermé franchi ou une survitesse ne se voyaient que par une note de 11,5 px, dans un bloc qui gardait son aspect normal. Seule l'alerte de freinage changeait le bloc. |
| `poste-*-signaux-pro`, `poste-*-bifurcation-*` | Cible française de 22 × 48 px : les feux d'une cible élargie (ralentissement, rappel) faisaient 6 px. |
| `poste-*-limites` | Panneaux de limite en 13 px, plus petits que les libellés des touches. |

### Sur le pupitre du téléphone

Le pupitre reprend le même bloc de signalisation et les mêmes panneaux que le PC : il était déjà cohérent, et avait les mêmes défauts (textes longs, faute peu visible). Rien d'autre à redire sur la signalisation en portrait comme en paysage.

## 2. Parti pris

Un petit système, le même partout.

1. **Une couleur, un sens.** Vert, jaune, rouge : les feux, et rien d'autre. Ambre : les limites de vitesse (bande des zones) et les avertissements du rapport. Bleu, violet, sarcelle : les cantons et la voie réservée. Noir sur blanc : une limite annoncée ; blanc sur noir : une limite en vigueur — sur le plan (panneaux d'annonce, panneaux Z / R), au poste et sur le téléphone.
2. **Une forme, un objet.** Niveau standard : tête ronde pour un signal de block, losange pour un signal de trajectoire, un feu. Niveau pro : cible à un feu (sémaphore) ou deux (carré), plaque F / Nf ; deux feux jaunes côte à côte pour le ralentissement, l'un au-delà de l'autre pour le rappel, comme sur la cible vue de face au poste.
3. **Ce que le conducteur voit en premier.** Dans l'ordre : l'alerte de freinage (bloc rouge clignotant), une faute commise (bloc rouge fixe), la limite (panneau et couleur de la vitesse), le prochain signal. Le bloc de signalisation garde une taille fixe : rien ne bouge quand une alerte arrive ou repart.
4. **Tailles minimales.** Feu du plan : 3,5 px de rayon au plus loin. Texte du plan : 9 px. Poste : 12,5 px pour une note, 15 px pour un libellé ou un panneau.
5. **Au zoom lointain.** Les plaques et les étiquettes de vitesse des signaux s'effacent d'abord, puis les libellés du rapport, puis en vue schématique les panneaux de vitesse (zones et annonces ensemble). Les feux restent jusqu'au bout : c'est l'information de conduite.
6. **Thème sombre.** Ce qui est posé sur la feuille (mât, poteau) prend la couleur des rails du thème ; ce qui est un objet (tête, cible, panneau) garde ses couleurs réelles, avec un liseré clair. Le poste de conduite reste sombre dans les deux thèmes (inchangé).
7. **Sobre.** Aucun élément ajouté. Un seul mouvement nouveau : le clignotement des deux feux jaunes à 60 km/h sur le plan, au niveau pro, en conduite seulement.

## 3. Ce qui a été fait

Par ordre d'importance.

1. **Bloc de signalisation du poste (PC et téléphone)** — `signalParts.tsx`, `consoleSignals.css`, `consoleModel.ts`, `remoteDesk.css`.
   - 268 × 68 px au lieu de 232 × 56 ; cible et feu agrandis d'un quart ; libellé 15,5 px, note 12,5 px ; afficheur de cabine 23 px.
   - Trois états : calme, **alerte** (freiner maintenant : rouge clignotant, comme avant), **faute** (signal fermé franchi, survitesse : rouge fixe, nouveau). `SignalsView.urgency` le dit ; aucune donnée de plus dans `ConsoleState`, donc rien à changer dans `protocol.ts`.
   - Plus aucun texte coupé : notes courtes (« Signal fermé franchi · urgence », « Survitesse · urgence ») et « Annonce à suivre » au lieu de « Voie libre, annonce à suivre ». Les messages affichés en haut de l'écran au moment de l'évènement gardent leur phrase entière.
2. **Signaux du plan** — `signalRender.ts`, `themeInk.ts`, `Canvas.tsx`.
   - Mât à la couleur des rails du thème.
   - Rappel : deux feux l'un au-delà de l'autre ; ralentissement : côte à côte, le long de la voie quelle que soit son orientation (avant, toujours à l'horizontale de l'écran).
   - Clignotement à 60 km/h en conduite (les feux s'atténuent, ils ne s'éteignent pas).
   - Feu de 3,5 px au minimum, plaques et étiquettes en 9 px, barre du sens unique un peu plus longue.
3. **Rapport de contrôle sur le plan** — `diagnosticMarker.ts`, `signalRender.ts`.
   - Libellé réduit au nom du défaut ; la phrase entière reste dans le panneau du signal sélectionné.
   - Libellé du côté opposé à la tête du signal ; un libellé qui en couvrirait un autre, ou le losange d'un autre marqueur, n'est pas écrit (le losange reste).
4. **Cantons et voie réservée** — `signalRender.ts` : six teintes froides pour les cantons, cinq pour les rames.
5. **Limites de vitesse** — panneaux du poste en 15 px (`styles.css`) ; panneau d'annonce du plan de 18 px, masqué en vue schématique ; poteaux à la couleur du thème (`speedZoneRender.ts`).
6. **Déraillement** — le panneau est dans le haut du canevas (`styles.css`).
7. **Barre contextuelle** — « 1 signal » (`contextBarModel.ts`).

Tests : `signalRender.test.ts` (rappel empilé, clignotement, libellé du rapport, panneaux en vue schématique), `consoleModel.test.ts` (urgence, longueur des notes), `contextBarModel.signals.test.ts` (singulier). Vues figées mises à jour : le glyphe d'un rappel porte `stacked`, celui de 60 km/h `flashing` ; `signalsView` porte `urgency` ; les deux notes courtes ; le libellé de l'afficheur clignotant ; le marqueur du rapport écrit `reportLabel(entry)` au lieu de `entry.message`.

## 4. Ce qui n'a pas été fait, et pourquoi

- **Couleurs du cadran de vitesse** : laissées telles quelles (voir la question 1).
- **Rapport sur une LGV** : chaque repère est signalé « Canton trop court : 1 500 m pour 4 960 m d'arrêt à 300 km/h ». Sur une ligne à vitesse en cabine l'arrêt se fait sur plusieurs cantons : c'est le rapport (`signalReport.ts`) qui se trompe, pas l'affichage. Noté, non corrigé (hors périmètre).
- **Disque de l'aiguille suivante** (aide de conduite) : il recouvre le panneau « Z 60 » posé à la pointe de l'aiguille (`plan-voie-unique-*`). Il faudrait revoir le placement de l'un des deux ; non traité.
- **Le poste cache la voie devant la rame** : la caméra centre la tête du train, l'écran de bord et les manettes occupent la droite. Les signaux à venir passent sous le poste (`ecran-conduite-screen-*`, `ecran-conduite-levers-*`). Problème de mise en page de la conduite, pas de la signalisation ; non traité.
- **Rame déraillée** : rien ne la distingue sur le plan (pas de caisse couchée). Un dessin de plus ; non fait par sobriété.
- **Téléphone en paysage** : la poignée de la manette de traction couvre les repères P1 et B1. Existait avant, hors signalisation.
- **Panneau d'annonce au niveau standard** : il n'existe qu'au niveau pro (choix du moteur).
- **Entre 0,35 et 2,1 px/m** (voie en trait simple), les panneaux Z / R sont déjà masqués alors que les panneaux d'annonce du niveau pro restent : alignés seulement en vue schématique, pour ne pas toucher aux tests figés à ce zoom.
- **Dévers** : la marque sur le rail est discrète mais lisible aux deux thèmes ; inchangée.

## 5. Questions pour l'utilisateur

1. **Vitesse orange.** Elle passe à l'orange dès 10 km/h sous la limite : en roulant à la limite, elle est orange en permanence (`poste-*-cabine`, 290 pour 300). Garder, ou ne colorer qu'au-dessus de la limite ?
2. **Clignotement sur le plan.** Fidèle au niveau pro, mais c'est un élément qui bouge. Le garder ?
3. **Rappel empilé.** Deux feux l'un au-delà de l'autre sur le plan : assez différent du ralentissement, ou faut-il autre chose ?
4. **Cantons en teintes froides.** Six teintes au lieu de huit, plus proches entre elles. Deux cantons voisins restent-ils assez distincts ?
5. **Libellé court du rapport.** « Canton trop court » sur le plan, la phrase entière dans le panneau du signal : suffisant ?
6. **Bloc de signalisation plus grand** (+36 × 12 px) : il prend un peu plus de place au-dessus du poste.
7. **Mots.** « Annonce à suivre », « Signal fermé franchi · urgence », « Survitesse · urgence ».
8. **Panneau de déraillement en haut du canevas** plutôt qu'au centre.

## 6. Ce qui n'a pas pu être vérifié

- Le clignotement lui-même (feux à 60, alerte de freinage, afficheur de cabine) : une capture est une image fixe. Sur le plan, une capture a été prise entre deux éclats (`plan-bifurcation-pro-sombre`).
- Le pupitre sur un vrai téléphone : seulement un Chromium aux dimensions 390 × 844 et 844 × 390.
- Le marqueur de chevauchement de deux zones de vitesse, et le déplacement d'un signal à la souris : non capturés.
