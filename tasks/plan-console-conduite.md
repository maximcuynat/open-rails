# Console de conduite adaptative et pupitre sur téléphone

Plan rédigé le 2026-10-05, corrigé le même jour avec les réponses de l'utilisateur, lancé le 2026-10-05 sur la branche `feature/driving-console` (partie de `developement`). Ce plan vit dans son propre fichier : `tasks/todo.md` est réécrit par d'autres sessions. Maquettes des trois consoles : https://claude.ai/artifact/Q34dt2Mh6cPk9RAQ5z7ufa

## Ce qui change pour le joueur

- La console de conduite est redessinée et existe en trois formes ; l'application choisit celle qui convient à la fenêtre, et un réglage permet d'en imposer une.
- Les rappels de touches sont sur les commandes elles-mêmes : le panneau de raccourcis au-dessus de la console disparaît.
- Un téléphone peut servir de pupitre : le PC affiche une adresse, un code et un QR code ; le téléphone ouvre la page, montre la liste des trains posés sur le canevas, et on choisit celui qu'on conduit. Ce choix prend les commandes sur le PC. Le téléphone montre ensuite le pupitre complet (vitesse, traction, frein, manomètres, inverseur, urgence, aiguillage suivant) et permet de changer de train ou de rendre les commandes.

## Quelle console pour quelle fenêtre

Dimensions de la zone du canevas (pas de l'écran). Fonction pure `chooseConsoleLayout(largeur, hauteur, préférence)`.

| Zone du canevas | Console | Raison |
|---|---|---|
| largeur ≥ 1100 et hauteur ≥ 720 | B · Écran de bord (coin bas-droit, 470 × 468) | assez haut pour le grand cadran, la voie reste dégagée |
| largeur ≥ 1000, hauteur < 720 | A · Bandeau pupitre (bas, 980 × 176) | large mais bas : tient sans défilement |
| largeur < 1000 | C · Deux manettes (vitesse en bas, leviers à droite) | étroit ou tactile : prend le moins de place |

- Réglage « Console de conduite » dans Affichage : Automatique (défaut), Bandeau, Écran de bord, Manettes. Enregistré avec les autres préférences.
- Une console imposée qui ne tient pas dans la fenêtre est réduite (échelle minimale 0,8), jamais coupée.
- Sur le téléphone : portrait = manettes agrandies avec les deux manomètres en plus ; paysage = bandeau sur toute la largeur.

## Architecture

Le principe : les consoles ne lisent plus le `store`. Elles reçoivent un état et émettent des commandes. Le même composant sert alors au PC (état tiré du store) et au téléphone (état reçu par le réseau).

- `ConsoleState` — tout ce que la console affiche, en données simples sérialisables : vitesse, vitesse max, cran, effort, inverseur et son verrou, état du frein, pressions CG et CF, accélération, pente, distance d'arrêt, composition, rang du train dans la flotte, urgence. Construit par une fonction pure à partir du train et de sa dynamique (extension de `drivingHudModel.ts`). La locomotive ancienne génération donne un état réduit (vitesse et commande), sans bloc frein.
- `FleetEntry[]` — la liste des trains du canevas pour l'écran de choix du téléphone : identifiant, rang, modèle, composition (motrices et voitures), vitesse, et lequel est conduit. Envoyée à la connexion puis à chaque changement (train posé, supprimé, couplé, découplé).
- `ConsoleCommand` — union fermée : cran ±1, cran fixé (borné de B5 à P5 : les crans négatifs sont le frein électrique), frein serrer / desserrer / maintenir, inverseur, urgence, aiguillage gauche / droite, choisir un train par son identifiant (ce qui prend les commandes), rendre les commandes, changer de cabine. Aucune commande d'édition du réseau.
- Le contrat est dans `src/application/console/consoleContract.ts`.
- `applyConsoleCommand(store, commande)` — seul point d'entrée vers le store, utilisé par la console locale, le clavier restant inchangé.

Fichiers prévus :

| Emplacement | Contenu |
|---|---|
| `presentation/components/console/` | instruments partagés (cadran demi-cercle, cadran à aiguille, manomètre, barres, échelle de crans, levier, inverseur, bouton maintenu, urgence), les trois dispositions, `chooseConsoleLayout` |
| `application/remote/protocol.ts` | messages, validation, numéro de version du protocole |
| `application/remote/remoteHost.ts` | côté PC : applique les commandes reçues, envoie l'état, sécurité de perte de liaison |
| `infrastructure/remote/webSocketLink.ts` | liaison WebSocket du navigateur, reconnexion |
| `tools/remote-relay/` | relais Node (salons à deux) et son branchement dans Vite |
| `presentation/remote/RemoteDesk.tsx` | la page du téléphone |

Les styles passent des objets en ligne de `DrivingHUD.tsx` à des classes dans `styles.css`, avec une variable d'échelle.

## Liaison téléphone ↔ PC

Un navigateur ne peut pas recevoir de connexion : il faut un relais entre les deux. Le PC reste le seul à simuler ; le téléphone n'a ni réseau ni physique.

- Relais : petit serveur WebSocket qui range les connexions par code de salon et transmet les messages entre le PC (hôte) et le téléphone (pupitre). Branché dans le serveur Vite (`npm run dev` et `npm run preview`), donc aucun processus de plus à lancer. `ws` en dépendance de développement seulement : les dépendances d'exécution ne changent pas.
- Appairage : menu Simulation → « Pupitre sur téléphone… ». Le PC ouvre un salon, affiche l'adresse `http://<ip-du-pc>:8900/open-rails/?pupitre=CODE`, le code à six caractères et un QR code. La page ouverte avec `?pupitre=` n'affiche que le pupitre.
- Déroulé sur le téléphone : connexion → liste des trains → choix d'un train (le PC entre en conduite sur ce train, ou change de train s'il conduisait déjà) → pupitre. Deux boutons en haut du pupitre : « Changer de train » (retour à la liste, le train quitté garde son frein dans l'état où il est) et « Rendre les commandes » (le PC quitte la conduite). Sans train sur le canevas, la liste le dit et attend.
- PC → téléphone : la liste des trains, puis `ConsoleState` du train conduit dix fois par seconde, et tout de suite après chaque commande. L'aiguille est lissée par une transition côté téléphone.
- Téléphone → PC : `ConsoleCommand` numérotées. Le PC valide chaque message (forme, bornes, version) et ignore le reste.
- Sécurité de conduite : serrer et desserrer sont des commandes maintenues ; le téléphone les répète toutes les 200 ms et le PC revient à « maintenir » après 600 ms de silence ou à la coupure. Le clavier du PC garde la main en permanence, arrêt d'urgence compris.
- Liaison rattachée à la session du PC, et à elle seule : le salon est créé par le PC, n'existe que tant que sa page est ouverte, n'accepte qu'un téléphone, et rien n'est enregistré côté relais (ni compte, ni réseau, ni historique). Fermer la page du PC ou couper depuis le PC ferme le salon ; un nouveau code est tiré à chaque ouverture.
- Les commandes portent déjà l'identifiant du train, pour permettre plus tard un téléphone par train.
- Indicateur sur le PC : pastille « téléphone connecté » dans la console, bouton pour couper.

Limites à connaître :

- **Réseau local d'abord, public ensuite.** La version publiée sur GitHub Pages est en HTTPS : un navigateur y interdit une liaison `ws://` vers une adresse locale. Le lot 2 fonctionne donc quand l'application est servie par le PC (`npm run dev -- --host` ou `preview`). Le lot 3 ajoute un relais hébergé en `wss://` pour le site public, avec exactement les mêmes règles de salon.
- **WSL2.** Le serveur tourne dans WSL2, que le téléphone n'atteint pas par défaut. Il faut le mode réseau « mirrored » (`.wslconfig`) ou une redirection de port Windows, plus une règle de pare-feu. À vérifier en premier, avant d'écrire le relais.
- Sans HTTPS, le téléphone ne peut pas empêcher la mise en veille de l'écran (l'API correspondante exige une page sécurisée).

## Étapes

### Lot 1 — Console adaptative sur le PC

- [x] 1. Retirer l'agrandissement provisoire de 40 % (commit `91930bc` : `zoom` dans `DrivingHUD.tsx`, largeur du dock dans `styles.css`)
- [x] 2. `ConsoleState`, `ConsoleCommand`, `buildConsoleState`, `applyConsoleCommand` ; tests sur l'état (train à l'arrêt frein serré, en traction, en urgence, locomotive ancienne génération) et sur chaque commande
- [x] 3. Instruments partagés en composants pilotés par des valeurs, styles en classes
- [x] 4. Levier : glisser à la souris et au doigt (capture du pointeur), crans pour la traction, retour au centre pour le frein ; la géométrie (position → cran, position → commande de frein) en fonctions pures testées
- [x] 5. Les trois dispositions A, B, C
- [x] 6. `chooseConsoleLayout` et ses tests aux seuils ; réglage dans le menu Affichage, enregistré
- [x] 7. Intégration : barre d'échelle et mini-carte décalées selon la console affichée, panneau debug conservé à droite, panneau de raccourcis retiré, message d'impact inchangé
- [x] 8. Contrôle dans le navigateur à 1920 × 960, 1366 × 650 et 900 × 600, thème clair et sombre, train et locomotive ancienne génération
- [x] 9. `npm test`, `npm run typecheck`, `npm run build`

### Lot 2 — Pupitre sur téléphone

- [ ] 10. Vérifier qu'un téléphone du réseau local atteint le serveur de dev depuis WSL2 ; noter la configuration nécessaire dans le README
- [x] 11. `protocol.ts` : messages, validation, version ; tests (message mal formé, cran hors bornes, version différente)
- [x] 12. Relais : salons par code, deux rôles, battement de cœur, salon fermé au départ de l'hôte ; branchement dans Vite ; test avec deux clients
- [x] 13. `webSocketLink.ts` : connexion, reconnexion avec délai croissant, état de liaison
- [x] 14. `remoteHost.ts` : envoi de l'état, application des commandes, retour à « maintenir » sur silence ; tests avec une liaison factice
- [x] 15. QR code écrit par nous (mode octets, correction d'erreur faible, tailles suffisantes pour une adresse locale), fonction pure testée contre des matrices de référence
- [x] 16. Côté PC : entrée de menu, fenêtre d'appairage (adresse, code, QR code), pastille de connexion, bouton pour couper
- [x] 17. `RemoteDesk`, écran de choix : liste des trains du canevas, mise à jour en direct, état vide
- [x] 18. `RemoteDesk`, pupitre : plein écran, portrait et paysage, « Changer de train », « Rendre les commandes », reconnexion visible, vibration à chaque cran
- [ ] 19. Contrôle réel : téléphone sur le réseau local, choix d'un train parmi plusieurs, conduite complète, changement de train, coupure du wifi en plein serrage, fermeture de la page du PC
- [x] 20. Documentation : section dans `CLAUDE.md` (fait) ; `ROADMAP.md` à compléter après l'essai réel

### Lot 3 — Relais public (après le lot 2)

- [ ] 21. Choisir l'hébergement du relais (à décider avec l'utilisateur à ce moment-là : il faut un service qui accepte les WebSocket et fournit le HTTPS)
- [ ] 22. Relais autonome : le même code de salons que le lot 2, lancé hors de Vite ; adresse du relais configurable à la construction
- [ ] 23. Garde-fous d'un service exposé : salon rattaché à la session du PC uniquement, un seul téléphone, code long tiré au hasard, limite de débit et de taille des messages, salons inactifs fermés, rien d'enregistré
- [ ] 24. Contrôle réel depuis le site publié, téléphone en 4G

## Revue (2026-10-05)

- `npm test` : 1132 tests verts (61 fichiers) ; `npm run typecheck` et `npm run build` verts.
- Essai bout à bout dans un navigateur sans interface : un onglet PC ouvre la session, un téléphone émulé rejoint avec le code, choisit le train ; le PC entre en conduite et affiche la pastille « Téléphone ».
- Vérifié par les agents : les trois consoles à 1920 × 960, 1366 × 650 et 900 × 600 dans les deux thèmes ; décodage du QR ; retour à « maintenir » sur silence et sur coupure ; frein tenu au clavier non écrasé par le téléphone ; gestes tactiles sur les leviers.
- Écarts par rapport au plan et aux maquettes :
  - manipulateur de B5 à P5 (frein électrique) : 11 crans sur le bandeau et le levier ; touches « Cran − / + » sur l'écran de bord ;
  - entre 1000 et 1100 px de large avec 720 px de haut ou plus : bandeau ;
  - le code du salon est tiré par le PC, et une reconnexion reprend sa place (jeton client, délai de grâce de 20 s côté téléphone) ;
  - `ConsoleState` a reçu `upcomingTurnout` et `canSwitchCab` ;
  - le frein tenu est suivi par côté (clavier / téléphone) dans le store ;
  - la disposition portrait du téléphone n'avait pas de maquette : elle est composée des instruments existants.
- Restes connus :
  - **aucun essai sur un vrai téléphone** (étapes 10 et 19) : sur cette machine le relais n'annonce que des adresses internes à WSL2 ; il faut le mode réseau « mirrored » ou une redirection de port, et lancer `npm run dev -- --host` ;
  - sous environ 790 px de large (bandeau) ou 705 px (manettes), une console imposée déborde ;
  - Safari n'anime pas les arcs des manomètres : ils avancent par pas de 100 ms ;
  - crans du bandeau étroits au doigt en paysage sur téléphone (les boutons − / + font le travail) ;
  - le chiffre de vitesse du bandeau frôle les graduations à trois chiffres ;
  - non vus dans le navigateur : bouton « Copier », bouton « Changer de cabine », message de la fenêtre d'appairage en HTTPS.

## Diagnostic du premier essai réel (2026-10-05)

Le téléphone n'atteignait pas `192.168.1.82:8900`. WSL2 est déjà en mode « mirrored » (`eth2` porte 192.168.1.82). Deux causes :

1. Vite n'écoutait que sur `127.0.0.1`. Corrigé : `server.host` et `preview.host` à `true` dans `vite.config.ts` ; la page et le relais répondent maintenant sur 192.168.1.82 depuis le PC.
2. Le pare-feu Hyper-V de Windows bloque les connexions entrantes vers WSL (`DefaultInboundAction : Block`) et seule une règle pour le port 8081 (Expo) existe. À faire par l'utilisateur, dans un PowerShell administrateur : `New-NetFirewallHyperVRule -Name OpenRails8900 -DisplayName "Open Rails 8900" -Direction Inbound -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol TCP -LocalPorts 8900`. Non vérifié depuis un téléphone.

## Décisions de l'utilisateur (2026-10-05)

1. Seuils du choix automatique : validés tels quels.
2. QR code : écrit par nous, sans dépendance. Une fois connecté, le téléphone choisit son train dans la liste des trains du canevas.
3. Portée : réseau local d'abord, relais public ensuite. La liaison reste rattachée à la session du PC uniquement pour le moment.
4. Le téléphone prend les commandes en choisissant un train, et peut les rendre.
5. Réalisation par deux agents en parallèle sur des fichiers séparés.

Reste à décider plus tard : l'hébergement du relais public (étape 21).

## Hors périmètre

- Plusieurs téléphones, un par train.
- Comptes, sessions partagées entre plusieurs PC, reprise d'une session après fermeture de la page.
- Vue de la voie ou caméra sur le téléphone.
- Édition du réseau depuis le téléphone.
- Signaux et limites de vitesse dans la barre de distance de l'écran de bord (elle n'affiche que la distance d'arrêt).
