Recherche du 2026-10-05, signalisation simple ou réaliste. Lecture seule, aucun code modifié.

# Signalisation : monde simple, monde réaliste, ou les deux

Complète `tasks/recherche-signalisation.md` (signalisation française réelle, §9 et §10) sans la refaire. Ici : les systèmes simples des jeux, la question des deux niveaux, et une recommandation.

## 0. Lecture rapide

- Les jeux de gestion ont convergé vers **deux objets** : un signal qui regarde le canton en aval (block), et un signal qui regarde plus loin avant de laisser entrer (chemin chez OpenTTD, Transport Fever 2 et NIMBY Rails ; « chaîné » chez Factorio, Mashinky et Sweet Transit). OpenTTD cache depuis la version 12 tous les types sauf le signal de chemin, parce que c'est celui avec lequel les débutants se trompent le moins.
- Ces deux objets correspondent aux deux fonctions de la signalisation française : **espacement** (sémaphore de BAL) et **protection** (carré avec itinéraire). La correspondance est bonne pour la logique d'occupation et de réservation ; elle casse sur l'**annonce** et tout ce qui touche à la distance de freinage.
- Un moteur unique avec plusieurs jeux de règles est une pratique établie : OSRD (SNCF Réseau) charge BAL, BAPR et TVM comme des modules au-dessus des mêmes zones et itinéraires ; le patchpack JGR d'OpenTTD bascule en cours de partie entre freinage instantané et freinage réaliste sur le même réseau, en refusant la bascule tant qu'il reste des signaux incompatibles. Contre-exemple : Railway Empire 2 fait choisir le mode au début de la partie et interdit d'en changer.
- Aucun jeu trouvé ne fait **conduire à la main** un train à longue distance d'arrêt devant des signaux rouge / vert sans annonce. Ceux qui s'en approchent ajoutent tous une aide : état et distance du prochain signal dans le HUD (Train Sim World, Open Rails), ou réservation prolongée jusqu'à la distance de freinage (JGR).
- Recommandation : **option C**, un seul moteur, deux niveaux choisis par projet, sans conversion de données à la bascule.

Niveaux de confiance, comme dans la première recherche : **[C]** confirmé par au moins deux sources indépendantes ; **[1]** une seule source ; **[E]** estimé, déduit ou proposé par moi.

## Sources

| Id | Source | URL | Lecture |
|---|---|---|---|
| T1 | OpenTTD, manuel « Signals » (la page se dit elle-même « très datée ») | https://wiki.openttd.org/en/Manual/Signals | directe |
| T2 | OpenTTD, manuel « Building signals » | https://wiki.openttd.org/en/Manual/Building%20signals | directe |
| T3 | OpenTTD, billet officiel « Why we recommend Path Signals », 2021-11-06 | https://www.openttd.org/news/2021/11/06/explaining-signals-ui-change | directe |
| T4 | OpenTTD, manuel français « Signaux » (vocabulaire) | https://wiki.openttd.org/fr/Manual/Signaux | directe (titres) |
| T5 | OpenTTD, réglages de construction (archive) | https://wiki.openttd.org/en/Archive/Manual/Settings/Advanced%20Settings/Construction | résumé de recherche |
| G1 | JGR patchpack, wiki « Realistic braking » | https://github.com/JGRennison/OpenTTD-patches/wiki/Realistic-braking | directe |
| F1 | Factorio, wiki officiel « Rail signal » | https://wiki.factorio.com/Rail_signal | directe |
| F2 | Factorio, wiki officiel « Rail chain signal » | https://wiki.factorio.com/Rail_chain_signal | directe |
| F3 | Factorio, wiki officiel « Tutorial:Train signals » | https://wiki.factorio.com/Tutorial:Train_signals | directe |
| F4 | Factorio, Friday Facts #198 « Rail segment visualisation », 2017 | https://www.factorio.com/blog/post/fff-198 | directe |
| F5 | Guide tiers sur la règle « chain in, rail out » | https://www.switchbladegaming.com/strategy-games/factorio/train-signals-explained/ | résumé de recherche |
| P1 | Transport Fever 2, wiki officiel « Railway Signals » | https://wiki.transportfever2.com/doku.php?id=gamemanual:railwaysignals | directe |
| M1 | Mashinky, wiki officiel « Signals » | https://mashinky.com/wiki/index.php?title=Signals | directe |
| W1 | Sweet Transit, guide Steam « Super Beginner Signal Guide » | https://steamcommunity.com/sharedfiles/filedetails/?id=2842044516 | résumé de recherche |
| W2 | Sweet Transit, fil Steam « Signal tutorial is confusing » | https://steamcommunity.com/app/1612770/discussions/0/3462723449747861369/ | directe (forum) |
| E1 | Railway Empire 2, notes de la mise à jour 1.1 « Manual Signals », Kalypso, 2023 | https://www.kalypsomedia.com/post/railway-empire-2-update-1-1-manual-signals | directe |
| N1 | NIMBY Rails, wiki « Signal » | https://wiki.nimbyrails.com/Signal | directe |
| N2 | NIMBY Rails, wiki « How to signal a junction » | https://wiki.nimbyrails.com/How_to_signal_a_junction | directe |
| R1 | Rail Route, wiki officiel « Automation » | https://railroute.fandom.com/wiki/Automation | directe |
| R2 | Rail Route, wiki officiel « Building » | https://railroute.fandom.com/wiki/Building | directe |
| V1 | Train Valley, discussions et tests | https://steamcommunity.com/app/353640/discussions/0/530645446324234363/ ; https://www.gamespew.com/2019/04/train-valley-2-review/ | résumé de recherche |
| S1 | Simutrans-Extended, aide en jeu « Signals working methods » | https://translator.simutrans.com/data/web/101/help/en/signals_working_methods.html | directe |
| S2 | Forum Simutrans, « How to replace old signalling systems with track circuit block signalling? » | https://forum.simutrans.com/index.php?topic=19232.0 | directe (forum) |
| D1 | Derail Valley, manuel officiel « Difficulty » | https://manual.derailvalley.com/wiki/Difficulty/en | directe |
| D2 | Derail Valley, wiki « Signage » | https://derailvalley.fandom.com/wiki/Signage | directe |
| K1 | Train Sim World, « Settings Explained » (Dovetail Games) | https://support.dovetailgames.com/hc/en-us/articles/28572764655122-Train-Sim-World-Settings-Explained | directe |
| O1 | Open Rails, manuel, chapitre « Driving a Train » (Track Monitor) | https://open-rails.readthedocs.io/en/latest/driving.html | directe |
| Z1 | Trainz, « Help:DCC Mode » ; Train Simulator Classic, guide utilisateur | https://online.ts2009.com/mediaWiki/index.php/Help:DCC_Mode | résumé de recherche |
| Z2 | Microsoft Flight Simulator, options d'assistance | https://www.flightsimulator.com/accessibility/ | résumé de recherche |
| Q1 | OSRD, documents de conception « Signaling » | https://osrd.fr/en/docs/reference/design-docs/signaling/ | directe |
| Q2 | OSRD, « Signaling systems » | https://osrd.fr/en/docs/reference/design-docs/signaling/signaling-systems/ | directe |
| Q3 | OSRD, « Blocks and signals » | https://osrd.fr/en/docs/reference/design-docs/signaling/blocks-and-signals/ | directe |
| Q4 | OpenTrack (ETH Zurich), présentation | https://www.opentrack.ch/mobile/opentrack_e/opentrack_e.html | résumé de recherche |
| Q5 | SimSig ; TS2 ; Train Director ; Poste de Méru | https://www.simsig.co.uk/ ; http://ts2.sf.net/fr/ ; http://xtsl.free.fr/spip/rubrique.php3?id_rubrique=6 | résumé de recherche |
| Q6 | CORYS, simulateurs de conduite pour la SNCF | https://www.corys.com/en/sncf-makes-extensive-use-of-simbox-simulators/ ; https://www.acbm.com/virus/397_Nous_avons_essaye_un_vrai_simulateur_de_train_SNCF_.html | résumé de recherche |
| Q7 | RailSim-fr, forum et notices des packs de signaux SNCF pour Train Simulator | https://www.railsim-fr.com/ ; https://www.jymanet.fr/railsim/telechargements/sncf_signaux/SIGNAUX_BAPR_BM_V1-1.pdf | résumé de recherche |

« Résumé de recherche » = je n'ai lu que l'extrait rendu par le moteur de recherche, pas la page. Ces faits sont au mieux **[1]**.

## 1. Règles des systèmes simples

### 1.1 OpenTTD

Vocabulaire français d'après T4.

| Objet (anglais / français) | Règle | Source | Conf. |
|---|---|---|---|
| Block signal / signal de bloc | rouge si le bloc en aval contient un train. Le bloc est **tout ce qui est physiquement relié** jusqu'aux signaux suivants, toutes branches comprises, même si les trajets ne se touchent pas | T1 | C (avec T3) |
| Two-way signal / signal à double sens | un signal de bloc posé d'un clic vaut dans les deux sens ; un deuxième clic le rend à sens unique, un troisième inverse le sens, un quatrième revient au double sens | T1, T2 | C |
| One-way signal / signal à sens unique | n'autorise qu'un sens ; un train qui l'aborde à l'envers est bloqué et rebrousse. Le signal invisible de l'autre côté « existe toujours et reste rouge » | T1 | 1 |
| Entry pre-signal / pré-signal d'entrée | signal de bloc qui n'est vert que si **au moins un** signal de sortie du bloc suivant est vert ; sans signal de sortie derrière lui, il se comporte en signal de bloc | T1 | 1 |
| Exit signal / signal de sortie | signal de bloc ordinaire, que les pré-signaux d'entrée consultent | T1 | 1 |
| Combo signal / signal combiné | à la fois entrée et sortie : relaie l'état vers l'amont, pour des arbres de pré-signaux | T1 | 1 |
| Limite connue des pré-signaux | une sortie verte ouvre l'entrée même si le train ne peut pas atteindre cette sortie | T1 | 1 |
| Path signal / signal de chemin | **rouge par défaut** ; ne passe au vert que lorsque le train a réservé un chemin jusqu'à la prochaine position d'attente sûre. Ne vaut que dans un sens ; abordé par l'arrière il est ignoré (le calcul d'itinéraire pénalise seulement ce passage) | T1 | C (avec T3) |
| One-way path signal / signal de chemin à sens unique | comme le précédent, mais infranchissable par l'arrière | T1, T2 | C |
| Ce que le train réserve | des **morceaux de voie**, pas le bloc : deux trains partagent une zone si leurs chemins ne se touchent pas | T1, T3 | C |
| Safe waiting position / « aire d'attente sécurisée » (T4) | par définition : devant un signal, un dépôt, une fin de voie. Le **dos** d'un signal de chemin n'en est pas une : la réservation le traverse | T1 | 1 |
| Conséquence de pose | un signal seulement là où un train peut attendre sans bloquer une jonction ; donc avant la jonction, pas juste après ; laisser la longueur du plus long train après la jonction | T1, T2 | C |
| Comportement par défaut actuel | depuis la version 12, l'outil ne montre **que** les deux signaux de chemin ; les autres restent pour la compatibilité des sauvegardes et se réaffichent par réglage. Motif officiel : « plus facile de choisir », « beaucoup plus facile de se tirer dans le pied avec les signaux de bloc » | T3, T2 | C |
| Débogage | réglage « afficher les voies réservées » | T1 (T5 : activé par défaut) | 1 |

### 1.2 Factorio

Vocabulaire français d'après le wiki : « signal ferroviaire » et « signal ferroviaire chaîné ».

| Notion | Règle | Source | Conf. |
|---|---|---|---|
| Rail signal | découpe la voie en blocs ; un seul train par bloc. Vert : bloc vide. **Jaune** : un train qui ne peut plus s'arrêter a déjà l'autorisation d'entrer, le bloc lui est réservé et les autres entrées passent au rouge. Rouge : bloc occupé ou réservé | F1, F3 | C |
| Bloc | tous les rails reliés, « qu'un train puisse ou non circuler entre eux » | F1 | 1 |
| Rail chain signal | comme le signal ordinaire, **et** regarde les signaux de sortie du bloc suivant : si la sortie située sur le chemin du train est fermée, il retient le train. Plusieurs chaînés à la suite : le train n'entre que si son chemin est libre jusqu'à un bloc situé derrière un signal ordinaire, et il réserve tous les blocs traversés | F2, F3 | C |
| Exception | si la destination est atteignable sans franchir d'autre signal, le chaîné ne regarde pas les sorties | F2 | 1 |
| Couleurs du chaîné | vert : toutes les sorties libres ; jaune : réservé ; rouge : toutes fermées ; **bleu** : certaines seulement, le train passe ou non selon son chemin | F2 | 1 |
| Règle mnémotechnique | formulation officielle : « chaînés dans et avant les croisements, ordinaires aux sorties ». La forme courte « chain in, rail out » vient des guides de joueurs | F3 ; F5 | C pour la règle, 1 pour la formule |
| Espace après la sortie | après un signal de sortie, le signal suivant doit être au moins à une longueur du plus long train | F3 | 1 |
| Sens | le signal se pose **à droite** de la voie et autorise ce sens ; deux signaux face à face = double sens ; un train automatique n'entre pas dans une voie signalée seulement à gauche (d'où des erreurs « pas de chemin » sur une voie pourtant reliée) | F1, F3 | C |
| Blocs colorés | signal en main, chaque bloc est peint d'une couleur différente sur les rails ; ces couleurs n'ont aucun rapport avec celles des feux | F3 | C (avec F4) |
| Signal mal posé | il clignote s'il n'est pas sur un rail ou s'il ne sépare pas deux blocs | F1, F2 | 1 |
| Causes de blocage | (1) trains qui attendent sur un croisement ; (2) pas assez de place : boucle empruntée par plus de trains qu'elle n'en contient ; (3) deux jonctions trop proches pour la longueur des trains ; (4) voie unique à double sens sans chaînés | F3, F2 | 1 |
| Aides à voir | coloration des blocs ; option de débogage de la distance de freinage ; alertes de train sans chemin | F1, F3 ; alertes : résumé de recherche | 1 |

### 1.3 Les autres, seulement ce qui diffère

| Jeu | Particularités | Source | Conf. |
|---|---|---|---|
| Transport Fever 2 | **un seul type** : tous les signaux sont des signaux de chemin. Le chemin se termine au prochain signal ou au prochain arrêt de la ligne. Un signal vu de dos est ignoré ; l'option « sens unique », dans la fenêtre du signal, le rend infranchissable par l'arrière. Les exemples du manuel dessinent le chemin réservé en bleu et la partie bloquée en jaune | P1 | 1 (officiel) |
| Mashinky | signal de block et signal chaîné (« vert s'il y a au moins un vert derrière lui ») ; double sens par défaut. Par défaut le jeu **choisit lui-même le type** à poser. Bouton « ignorer le prochain signal » pour démêler un blocage | M1 | 1 (officiel) |
| Sweet Transit | modèle Factorio : signal et signal chaîné ; blocs colorés quand l'outil signal est actif | W1 | 1 (guide de joueur) |
| Railway Empire 2 | mode « Automatique (recommandé) » : le joueur donne un sens aux voies, le jeu pose les signaux. Mode « Manuel » : signaux « stop » (deux sens, pour découper une longue voie) et « directionnels » (un sens), pose de plusieurs signaux à distance fixe, retrait de tous les signaux d'un tronçon. **Mode choisi en début de partie, non modifiable, les deux étant « incompatibles »** | E1 | 1 (officiel) |
| Train Valley | pas de signaux : le joueur manœuvre les aiguilles et arrête les trains lui-même ; choix assumé par les développeurs | V1 | 1 (résumé) |
| Mini Metro | non pertinent : pas de signalisation à ma connaissance | — | E, non vérifié |
| NIMBY Rails | le **signal de block a été retiré du jeu**. Restent : signal de chemin (vérifie le trajet du train jusqu'au prochain signal de chemin de même sens ou à la prochaine balise) ; **balise de block** (arrête une vérification ou une réservation, dans les deux sens, sans pouvoir arrêter un train) ; sens unique ; « no-way » (voie interdite). Règle des jonctions : signal de chemin à l'entrée, balise à la sortie | N1, N2 | 1 (wiki du jeu) |
| Rail Route | le joueur est l'aiguilleur : signaux manuels, améliorables en **signaux automatiques** (placent eux-mêmes les aiguilles vers la voie choisie) ; **capteurs** qui demandent un itinéraire au passage du train selon sa prochaine gare ; file d'attente d'itinéraires ; itinéraire perpétuel. Un capteur trop près d'un signal fermé fait ralentir le train | R1, R2 | 1 (officiel) |

Constat **[E]** : en dehors des pré-signaux d'OpenTTD (hérités, cachés), tous ces jeux tiennent avec deux objets au plus, et trois d'entre eux (Transport Fever 2, NIMBY Rails, OpenTTD par défaut) sont passés au **signal de chemin seul**.

## 2. Ce que les joueurs comprennent mal, et les aides

### 2.1 Erreurs récurrentes

| Erreur ou incompréhension | Où | Source | Conf. |
|---|---|---|---|
| Signal juste après une jonction : le train attend en travers et bloque les autres | OpenTTD, Factorio, TF2 | T1, F3, P1 | C |
| Signaux ordinaires à l'entrée d'un croisement, chaînés à la sortie (l'inverse de la règle) | Factorio | F3, F5 | 1 |
| Bloc plus court que le train : la queue reste dans la jonction précédente | Factorio, TF2, NIMBY | F3, P1, N2 | C |
| Croire qu'un bloc suit le trajet : il englobe toutes les branches reliées | OpenTTD, Factorio | T1, F1 | C |
| Voie unique avec évitement sans signaux aux deux bouts de l'évitement : les deux trains se bloquent en gare | TF2 | P1 | 1 |
| Signaux à double sens : nez à nez | Mashinky | M1 | 1 |
| Sens du signal : signal du mauvais côté, voie devenue à sens unique sans que le joueur le voie | Factorio | F3 | 1 |
| Sens unique « visuel » qui cache un signal rouge permanent de l'autre côté | OpenTTD | T1 | 1 |
| Trop de trains pour la place disponible : aucun réglage de signaux n'y remédie | Factorio | F3 | 1 |
| Couleur des blocs confondue avec la couleur des feux | Factorio | F3 | 1 |
| Tutoriel qui fait poser des signaux sans dire où ni pourquoi : « je n'y comprends rien, pour moi ça casse le jeu » | Sweet Transit | W2 | 1 (forum) |
| Choix entre six types de signaux : la question la plus posée après la version 12 | OpenTTD | T3 | 1 |

### 2.2 Aides apportées

| Aide | Jeu | Détail | Source | Conf. |
|---|---|---|---|---|
| Coloration des blocs à la pose | Factorio, Sweet Transit | née d'une option de débogage : les testeurs du tutoriel disaient comprendre les signaux « presque instantanément » avec elle | F4, F3, W1 | C |
| Positions possibles et sens d'approche montrés sous le curseur | Factorio | parmi les indications affichées à la pose : nouveau segment, positions de signal possibles, sens du train qui abordera le signal. L'équipe note elle-même que cela fait **trop d'indications à la fois** | F4 | 1 |
| Emplacement « en face » surligné | Factorio | l'emplacement opposé à un signal existant est surligné en blanc, pour faire un double sens | F1 | 1 |
| Signal invalide qui clignote | Factorio | s'il ne sépare rien | F1 | 1 |
| Pose en série par glisser, espacement réglable | OpenTTD, Mashinky, Railway Empire 2 | voir §3 | T2, M1, E1 | C |
| Conversion par clic | OpenTTD, Rail Route | Ctrl+clic fait défiler les types ; outil de conversion ; Rail Route : clic avec l'outil « signal automatique » sur un signal manuel | T2, R2 | 1 chacun |
| Choix automatique du type | Mashinky | par défaut le jeu décide block ou chaîné | M1 | 1 |
| Réduction du choix | OpenTTD 12, TF2, NIMBY | un seul type visible par défaut | T3, P1, N1 | C |
| Affichage des réservations | OpenTTD, TF2, NIMBY | voies réservées surlignées ; chemin vu dans un mode de carte | T1, P1, N1 | C |
| Alerte « train en attente » | NIMBY Rails | délai réglable de 0 minute à 24 heures, réglage global | N1 | 1 |
| Alerte sur automatisme cassé | Rail Route | triangle sur un capteur dont l'itinéraire n'existe plus | R2 | 1 |
| Sortie de blocage à la main | Mashinky | faire ignorer le prochain signal, inverser le train | M1 | 1 |
| Exemples types dans la documentation | OpenTTD, Factorio, NIMBY | six gares et jonctions types ; jonction en T avec plan à copier | T3, F3, N2 | C |

## 3. Ergonomie de pose

| Question | OpenTTD | Factorio | Transport Fever 2 | Mashinky | NIMBY Rails | Rail Route |
|---|---|---|---|---|---|---|
| Choix du sens | clics successifs sur le signal posé : double sens → sens unique → sens inverse → double sens ; un signal de chemin n'a toujours qu'un sens | côté de la voie : le signal vaut pour le sens dont il est à droite | signal lu dans un sens ; « sens unique » en option dans sa fenêtre | **côté de la voie cliqué** (« zoomez, on s'y fait ») | touche F ou bouton pour retourner ; décalage latéral purement cosmétique | clic gauche sur le signal pour l'inverser |
| Double sens | état du signal de bloc | deux signaux face à face | non décrit | type par défaut | option « toujours » du signal de chemin ; la balise vaut dans les deux sens | non décrit |
| Pose sur voie existante | oui, sans couper la voie | oui, à des emplacements proposés | oui | oui | oui ; un signal se **déplace en le glissant** le long de la voie | oui |
| Interdits | case avec jonction ou passage à niveau, pont, tunnel | emplacements non valides | non décrit | quai et intersection ; tunnel difficile | non décrit | uniquement en voie droite ; pas sur aiguille, courbe, quai, autoblock, tunnel |
| Pose en série | glisser le long de la voie ; **Ctrl+glisser** : pose automatique jusqu'à une gare, un autre signal ou une bifurcation ; bouton de densité (tous les N carreaux, 4 par défaut) ; partir d'un signal existant reprend son sens | non trouvé | non trouvé | outil multi-signal à espacement réglable | non trouvé | signaux posés d'office aux bouts des quais et des autoblocks |
| Conversion | Ctrl+clic ou outil dédié | non trouvé | — | — | menu du signal | outil d'amélioration |
| Suppression | outil démolition, clic ou glisser (même densité) | non trouvé | non trouvé | non trouvé | touche Suppr sur la sélection | démolition ; il faut retirer signal ou capteur avant la voie ; ceux des quais ne se retirent pas |
| Source | T2, T1 | F1, F3, F4 | P1 | M1 | N1 | R2 |

Confiance : **[1]** par cellule (une source officielle par jeu). Railway Empire 2 ajoute la pose de plusieurs signaux « à une certaine distance » et le retrait de tous les signaux d'un tronçon (E1, 1).

Lecture **[E]** : trois façons de donner le sens coexistent — côté cliqué (Mashinky, Factorio), clics successifs (OpenTTD), touche de retournement (NIMBY, Rail Route). Le côté cliqué est le plus direct mais demande de zoomer ; la touche de retournement est la plus tolérante. Aucun jeu lu n'impose de **distance minimale** entre signaux ; ils se limitent à interdire les aiguilles et à recommander une longueur de train.

## 4. Logiciels à deux niveaux de réalisme

| Logiciel | Ce qui a deux niveaux | Comment le choix est présenté | Ce qui est partagé | Bascule sur l'existant | Source | Conf. |
|---|---|---|---|---|---|---|
| OSRD (SNCF Réseau) | plusieurs **systèmes de signalisation** (BAL, BAPR, TVM) | par signal : chaque signal logique a son système ; un signal physique peut en porter plusieurs | zones, itinéraires et blocs déduits ; chaque système est un module qui déclare son état, ses propriétés et deux conditions : « borne de bloc quand… », « borne d'itinéraire quand… » (BAL : toujours ; seulement si Nf) | sans objet (outil d'étude) | Q1, Q2, Q3 | 1 (officiel) |
| OpenTTD + JGR patchpack | modèle de freinage « original » (arrêt instantané) ou « réaliste » (distance d'arrêt, réservation prolongée), plus signaux à plusieurs aspects par jeu graphique | réglage global de la partie, « fonction avancée, pas pour les débutants » | même réseau, mêmes signaux, même réservation | **possible en cours de partie**, mais **refusée** tant qu'il reste des signaux interdits en mode réaliste (pré-signaux, double sens) ; une commande les localise. Les signaux de bloc sont réinterprétés : automatiques en pleine voie, rouges par défaut ailleurs | G1 | 1 (officiel du patchpack) |
| OpenTTD 12 | interface : un type de signal visible, ou tous | réglage d'interface | tout | immédiate, rien ne change sur le réseau | T3, T2 | C |
| Simutrans / Simutrans-Extended | Extended ajoute des « méthodes d'exploitation » réelles (marche à vue, intervalle de temps, bâton pilote, block absolu, block par circuits de voie, signalisation de cabine…) | **par signal** ; plusieurs méthodes coexistent sur un réseau ; Extended est une version séparée du jeu | le réseau | le remplacement d'une méthode par une autre se fait à la main et pose question aux joueurs (cas sans équivalent, blocages) | S1, S2 | 1 |
| Railway Empire 2 | signaux automatiques ou manuels | **à la création de la partie** | — | **interdite** : « les deux systèmes sont incompatibles » | E1 | 1 (officiel) |
| Train Sim World | signaux du pays reproduits dans le monde ; HUD qui en donne une **représentation simplifiée (vert, jaune, rouge) avec la distance** ; systèmes de sécurité activables | réglages globaux du joueur, élément par élément ; HUD normal / simple / minimal | la simulation ; seule la présentation change | immédiate | K1 | 1 (officiel) |
| Open Rails | Track Monitor complet, ou mode « immersif » qui cache l'aspect des signaux à venir mais garde leur position (« ce qu'un conducteur connaît de mémoire ») | raccourci en conduite | la simulation | immédiate | O1 | 1 (officiel) |
| Derail Valley | préréglages Confort / Standard / Réaliste, plus préréglages personnels | par session ; paramètres individuels dans un éditeur | le monde | « modifiable à tout moment d'une session » | D1 | 1 (officiel) |
| Trainz, Train Simulator Classic | commande simple (DCC / Simple) ou réaliste (Cab / Expert), avec une physique moins fine en mode simple chez Trainz | par session ou réglage global | réseau et signaux | par session | Z1 | 1 (résumé) |
| Microsoft Flight Simulator | préréglages d'assistance, puis réglage par élément | global, modifiable | la simulation | immédiate | Z2 | 1 (résumé) |

Ce qu'on peut en conclure **[E]** :

1. « Un moteur, plusieurs habillages » est courant, sous deux formes. Soit **seule la présentation change** (Train Sim World, Open Rails, OpenTTD 12) : la bascule est gratuite. Soit **les règles changent** sur les mêmes objets (JGR, OSRD, Simutrans-Extended) : cela tient, à condition que le moteur raisonne en zones et en réservations et que les règles soient un module.
2. Quand les règles changent, la bascule a besoin d'un **contrôle** : JGR la refuse tant que des objets sont incompatibles et aide à les trouver. Railway Empire 2 a préféré l'interdire.
3. Le choix se fait par projet ou par réglage global dans les jeux ; par objet dans les outils qui modélisent le réel (OSRD, Simutrans-Extended), parce qu'une vraie ligne mélange les systèmes.
4. Aucun exemple trouvé d'un même réseau présenté au choix en « signaux de jeu » et en « signaux d'un pays réel ». La combinaison recommandée plus bas est donc une extrapolation, pas une pratique observée telle quelle.

## 5. Correspondance simple ↔ réaliste

| Notion simple | Équivalent français | Qualité | Remarque |
|---|---|---|---|
| Signal de block | sémaphore de BAL (plaque F) à l'entrée d'un canton | bonne | même règle d'occupation. En France le canton suit une voie ; dans les jeux il englobe toutes les branches |
| Signal de chemin | carré (plaque Nf), origine d'un itinéraire formé automatiquement à l'approche | bonne | « rouge par défaut, s'ouvre quand le trajet est réservé » est exactement le carré sans itinéraire formé de la première recherche (§7, §10 b) |
| Signal chaîné (Factorio) | pas d'objet équivalent ; le besoin est couvert par le carré et par la règle « un itinéraire ne se forme que jusqu'à un point où le train peut s'arrêter » | approximative | [E] |
| Pré-signaux (OpenTTD) | aucun | nulle | T1 le dit lui-même : pas d'équivalent réel |
| Réservation de trajet | itinéraire formé et enclenché ; aiguilles immobilisées | bonne | |
| Libération derrière le train | transit souple (aiguille par aiguille) ; destruction automatique | bonne | |
| Deux trains dans la même zone si les trajets ne se touchent pas | itinéraires compatibles | bonne | |
| Signal ignoré vu de dos | un signal ne s'adresse qu'à un sens de circulation | bonne | |
| Sens unique | voie non banalisée : pas de signaux pour l'autre sens ; en voie banalisée, enclenchement de sens | approximative | en réalité c'est une propriété de la voie, pas d'un signal |
| Double sens (deux signaux dos à dos) | voie banalisée, IPCS | approximative | |
| Position d'attente sûre | point d'arrêt devant un signal placé à 100 m au moins du garage franc | bonne | même idée : ne pas attendre en travers d'un appareil de voie |
| Balise de block (NIMBY) | limite de zone sans signal (joint) ; ou repère sans feux | approximative | [E] |
| Jaune de Factorio (« réservé, le train ne peut plus s'arrêter ») | enclenchement d'approche | approximative | [E] |
| File d'itinéraires, itinéraire perpétuel (Rail Route) | itinéraire enregistré ; tracé permanent | bonne | |

Correspondances réelles tirées de `recherche-signalisation.md` §1, §5, §7 ; le rapprochement lui-même est **[E]**.

Où la correspondance casse :

| Point | Monde simple | Réalité française | Conséquence |
|---|---|---|---|
| Annonce | aucune : le signal ne dit que « passe » ou « arrête » | tout signal d'arrêt est annoncé à distance d'arrêt par un avertissement, lui-même parfois par un jaune clignotant, puis un vert clignotant au-delà de 160 km/h | sans annonce, un train conduit à la main ne peut pas s'arrêter (§6) |
| Distance de freinage | nulle ou négligée ; les trains de jeu s'arrêtent au pied du signal | 1 500 m à 160 km/h (première recherche §5), environ 3 km à 300 km/h (chiffre du projet) ; cantons de BAL de 500 à 2 800 m ; séquence d'arrêt TVM sur environ 10 km | la longueur des cantons devient une contrainte de conception |
| Voie déviée | le signal de chemin s'ouvre, sans indication de vitesse | ralentissement 30 ou 60 annoncé, puis rappel sur le carré | il faut un état de plus par signal et une vitesse par aiguille |
| LGV | signal au sol identique | pas de feux : repères F / Nf et vitesse en cabine | objet différent et afficheur de HUD différent |
| Franchissable ou non | un rouge est un rouge | sémaphore F franchissable en marche à vue après arrêt ; carré Nf jamais sans ordre | règle de conduite absente du monde simple |
| Canton | toutes branches reliées | une voie | en posant un signal de chemin à chaque entrée de jonction, les deux coïncident |
| Délais | annulation immédiate | enclenchement d'approche, délai de 1 à 3 minutes | à ajouter seulement au niveau réaliste |
| Protection de flanc, glissement | absents | aiguilles de protection ; canton tampon sur LGV | peuvent rester hors périmètre |

## 6. Conduite manuelle dans un monde simple

Ce qu'implique un signal rouge / vert sans annonce pour un conducteur humain :

- Le feu n'est lisible qu'à quelques centaines de mètres (visibilité « normale » de 300 m au-delà de 120 km/h, première recherche §4) alors que l'arrêt en demande dix fois plus à 300 km/h. Sans autre information, la seule conduite sûre est de rouler à une vitesse permettant l'arrêt à vue : c'est la **marche à vue**, 30 km/h. Déduction **[E]** à partir de faits **[C]**.
- La page d'OpenTTD reconnaît l'écart : dans le jeu le freinage n'a rien à voir avec celui d'un train réel, et les vrais réseaux utilisent des signaux à distance (T1, 1).
- Le patchpack JGR est le seul cas trouvé où des signaux de jeu rencontrent une vraie distance d'arrêt. Sa réponse (G1, 1) : le train **réserve devant lui tant que sa distance de freinage n'est pas couverte**, sur plusieurs cantons s'il le faut ; il ne met à jour ce qu'il sait qu'en abordant un signal (« le seul moment où le conducteur hypothétique est informé ») ; sur voie unique il faut ajouter des signaux « pour donner au conducteur un préavis » ; en option, ce que le conducteur peut savoir est limité par le nombre d'aspects du signal. Autrement dit : dès que le freinage devient réaliste, le jeu réinvente l'annonce.
- Rail Route le montre en creux : un capteur trop près d'un signal encore fermé fait ralentir les trains rapides (R2, 1).

Jeux de conduite et signalisation simplifiée :

| Jeu | Ce qu'il fait | Source | Conf. |
|---|---|---|---|
| Train Sim World | signaux réels dans le monde ; le HUD donne le prochain signal sous forme simplifiée **vert / jaune / rouge avec sa distance**, un marqueur à l'emplacement du signal, et un moniteur de voie sur les 2 km à venir ; systèmes de sécurité désactivables | K1 | 1 (officiel) |
| Open Rails | Track Monitor : signaux à venir, aspect et distance ; si aucun signal n'est dans la fenêtre, l'aspect du premier signal plus lointain est tout de même affiché avec sa distance ; mode immersif qui cache les aspects | O1 | 1 (officiel) |
| Derail Valley | pas de signaux de block : panneaux de vitesse, d'aiguille et de fin de voie seulement | D2 | 1 ; l'absence de signaux de block est ma lecture de la page, à confirmer |
| Train Valley | pas de signaux ; le joueur arrête les trains lui-même | V1 | 1 (résumé) |
| Trainz | signaux à calcul automatique (arrêt, attention, attention avancée) | première recherche §9 | 1 (résumé) |

Je n'ai **pas trouvé** de jeu de conduite qui présente au conducteur des signaux volontairement génériques à deux états. Ceux qui simplifient gardent les signaux du pays et simplifient **le HUD**.

Aides minimales **[E]** pour que le niveau simple soit conduisible :

1. **Troisième état calculé** : un signal est affiché « attention » (jaune) quand le signal suivant sur le trajet est fermé. C'est la règle VL / A / S de la première recherche (§10 a) ; le joueur ne pose rien de plus.
2. **Prochain signal fermé dans le HUD, sans limite de distance** : état et distance du prochain signal, et distance du premier signal fermé même s'il est trois cantons plus loin (ce que fait Open Rails). C'est ce qui rend le système indépendant de la longueur des cantons.
3. **Alerte de freinage** : comparer la distance au premier signal fermé à la distance d'arrêt à la vitesse courante (déjà calculée pour l'arrêt au heurtoir) ; avertir quand la marge passe sous quelques secondes. C'est le principe « distance but » de la TVM 430 et de l'ETCS, sans leur affichage.
4. **Réservation prolongée pour le train du joueur** : un signal franchi au vert ne doit pas être suivi d'un rouge impossible à respecter ; la réservation devant un train en mouvement s'étend au moins jusqu'à sa distance d'arrêt (principe JGR).
5. **Sanction réglable** : franchir un signal fermé = freinage d'urgence, désactivable.
6. **Contrôle d'édition** : signaler un canton plus court que la distance d'arrêt à la vitesse de la ligne. Avec l'aide n° 2 ce n'est plus bloquant, seulement informatif.

## 7. Attentes d'un public professionnel ou passionné

Outils déjà utilisés :

| Outil | Public | Ce qu'il fait de la signalisation | Source | Conf. |
|---|---|---|---|---|
| OSRD | SNCF Réseau, études de capacité et d'horaires ; libre | BAL, BAPR, TVM en modules ; signaux à propriétés (Nf, ralentissement 30 / 60, rappel) ; paramètres dépendant de l'itinéraire ; détection de conflits | Q1, Q2, Q3 | 1 (officiel) |
| OpenTrack | bureaux d'études, universités (ETH Zurich) | simulation microscopique : signaux, rayons, déclivités, vitesses, matériel, horaire | Q4 | 1 (résumé) |
| RailSys | exploitants, bureaux d'études | non documenté publiquement ; non trouvé, comme dans la recherche sur les vitesses | — | — |
| SimSig | passionnés et professionnels britanniques | poste d'aiguillage, enclenchements complets ; uniquement la Grande-Bretagne | Q5 | 1 (résumé) |
| TS2, Train Director, Poste de Méru | passionnés | simulateurs de poste libres ou gratuits ; Poste de Méru est français | Q5 | 1 (résumé) |
| Rail Route | joueurs | aiguilleur simplifié, pas d'aspects | R1 | 1 |
| Simulateurs CORYS de la SNCF | formation des conducteurs | lignes entièrement signalisées, KVB simulé | Q6 | 1 (résumé, source commerciale) |
| Train Simulator Classic avec packs de signaux SNCF, Open Rails | passionnés français | BAL, BAPR / BM, IPCS, TVM 300, KVB reproduits par scripts, avec notices | Q7 | 1 (résumé) |

Attentes. Les sources lues ne contiennent **pas d'enquête** auprès de ce public ; la liste ci-dessous est **[E]**, appuyée sur ce que les outils ci-dessus prennent la peine de modéliser et sur un retour de forum connu par résumé seulement (Q7 : sur une ligne française de Train Simulator, la TVM est jugée bien faite, l'absence de KVB et des tableaux de vitesse mal faits sont reprochés).

| Attente | Niveau | Pourquoi |
|---|---|---|
| Séquences exactes : jamais de voie libre juste avant un signal fermé ; VL → A → S ; (A) si canton court ; ralentissement puis rappel | rédhibitoire si faux | c'est ce qu'un conducteur lit en premier |
| Distinction sémaphore / carré, plaques F et Nf, œilleton | rédhibitoire si absente | elle change la conduite à tenir |
| Signal à gauche, cible réelle (position des feux), panneau rond pour l'avertissement seul | attendu | les passionnés repèrent une cible fausse |
| Carré fermé sans itinéraire ; aiguilles immobilisées sous un itinéraire | attendu | base de la logique de poste |
| Vitesse d'approche de 30 km/h après un avertissement (KVB), freinage d'urgence au franchissement | attendu des conducteurs | reproché quand il manque (Q7) |
| Sur LGV : aucun feu, repères, afficheur de cabine avec la séquence de taux | attendu | le matériel du projet est un TGV |
| Longueurs de canton et distances d'implantation plausibles | apprécié | les valeurs sont dans la première recherche (§5) |
| Tableaux de vitesse corrects | apprécié | cités dans les reproches (Q7) |
| Enclenchement d'approche temporisé, protection de flanc, BAPR, block manuel, carré violet, signaux de manœuvre | bonus | utile aux étudiants en exploitation, peu visible en conduite |
| Outil d'étude (graphique espace-temps, calcul de capacité) | hors périmètre | c'est le terrain d'OSRD et d'OpenTrack |

Jusqu'où aller **[E]** : les étapes (a) à (d) de la première recherche, plus la règle KVB des 30 km/h, couvrent tout ce qui est classé « rédhibitoire » ou « attendu ». Un niveau réaliste qui s'arrêterait à l'étape (a) avec des cibles génériques ne serait pas crédible pour ce public ; il le devient avec (a) + (b) dessinées correctement.

## 8. Recommandation

Tout ce chapitre est une proposition **[E]**.

### Choix : option C

Un seul moteur — signaux attachés à la voie, cantons déduits, réservation de trajets — avec deux niveaux de présentation et de règles, choisis par projet.

| Option | Pour | Contre |
|---|---|---|
| A. Simple seul | le plus rapide ; compris de tous les joueurs de jeux de gestion | non conduisible tel quel avec la physique actuelle (§6) : il faut de toute façon calculer une annonce ; aucun intérêt pour le public visé par « réseau français, échelle 1:1 » |
| B. Réaliste seul | cohérent avec le projet ; feuille de route déjà écrite | marche d'entrée haute : sept à neuf feux, plaques, itinéraires ; un réseau de test demande de connaître la différence entre sémaphore et carré |
| **C. Un moteur, deux niveaux** | le calcul est le même (§5 : block = espacement, chemin = protection) ; le niveau simple sert de mode d'apprentissage et de mode de mise au point du réseau ; le surcoût se limite à un second dessin et une seconde palette | deux jeux de règles à tester ; il faut tenir la frontière (voir risques) |

Argument décisif : la règle de calcul du niveau simple **avec** l'aide n° 1 du §6 (jaune calculé) est mot pour mot celle de l'étape (a) de la première recherche. Le niveau simple n'est pas un second système, c'est le même avec moins d'objets, un autre dessin et sans les règles de conduite françaises. OSRD et JGR montrent que cette architecture tient (§4).

### Ce qui est commun (le moteur)

| Élément | Contenu |
|---|---|
| Signal stocké | position sur la voie, sens de lecture, **fonction** (`espacement` ou `protection`), options ; même forme dans les deux niveaux |
| Réglage de projet | `niveau de signalisation : simple / réaliste` |
| Cantons | déduits des signaux, jamais stockés (première recherche §10) |
| Occupation | intervalle queue-tête de chaque train |
| Réservation | par tronçon et par aiguille, le long du trajet ; libération derrière la queue |
| Trajet d'un train conduit à la main | le train n'a pas de destination : son trajet est celui que donnent les aiguilles devant lui ; une aiguille prise dans une réservation ne se manœuvre plus |
| État interne d'un signal | fermé / attention / ouvert, plus les états propres au niveau réaliste |
| HUD | prochain signal et distance ; premier signal fermé et distance ; alerte de freinage |
| Outils d'édition | pose, retournement, déplacement, pose en série, suppression, coloration des cantons, affichage des réservations |

### Niveau simple

Objets posés :

| Objet | Rôle | Options |
|---|---|---|
| Signal de block | espacement en pleine voie | sens ; double sens (deux signaux dos à dos, comme Factorio) |
| Signal de chemin | devant une aiguille ou un croisement | sens ; sens unique (infranchissable par l'arrière) |

Rien d'autre : ni pré-signaux, ni signal chaîné, ni balise. OpenTTD, Transport Fever 2 et NIMBY Rails montrent que le signal de chemin suffit aux jonctions.

Règles :

1. Signal de block : fermé si son canton (toutes branches reliées jusqu'aux signaux suivants) est occupé ou réservé ; sinon ouvert.
2. Signal de chemin : fermé par défaut ; il s'ouvre quand le trajet du train qui approche, jusqu'au prochain signal de même sens ou à une fin de voie, est libre et réservé.
3. Un signal vu de dos est ignoré, sauf s'il est à sens unique.
4. Affichage à trois états : vert, jaune (le signal suivant sur le trajet est fermé), rouge. Le jaune est calculé.
5. Aides du §6 : premier signal fermé dans le HUD sans limite de distance, alerte de freinage, réservation prolongée devant le train du joueur.
6. Tout rouge est un arrêt ; le franchir déclenche un freinage d'urgence (réglable). Pas de plaques, pas de marche à vue, pas de vitesse d'approche.
7. Dessin : un mât et un feu ; un losange ou un second point pour distinguer le signal de chemin.

### Niveau réaliste

Objets posés :

| Objet | Fonction moteur | Étape de la première recherche |
|---|---|---|
| Sémaphore (panneau de BAL, plaque F) | espacement | (a) |
| Carré (plaque Nf, œilleton) | protection | (b) |
| Repère de LGV F / Nf | espacement / protection, sans feux | (d) |
| Capacité du panneau à annoncer ou rappeler un ralentissement | option des deux premiers | (c) |
| Plus tard : avertissement seul (panneau rond, BAPR), carré violet | — | hors étapes |

Règles : celles du §10 de `recherche-signalisation.md`, sans changement — VL / A / S puis (A) et (VL) ; carré fermé sans itinéraire ; itinéraire demandé à l'approche ou tracé à la main ; transit souple ; ralentissement et rappel ; séquence TVM. S'y ajoutent les règles de conduite : sémaphore F franchissable en marche à vue après arrêt, carré jamais ; 30 km/h à l'approche d'un signal annoncé fermé ; répétition sonore avec acquittement.

### La bascule

Le niveau est un réglage du projet, modifiable à tout moment, **sans conversion de données** : le même signal stocké est relu par l'autre jeu de règles.

| Sens | Ce qui se passe |
|---|---|
| Simple → réaliste | signal de block → sémaphore F ; signal de chemin → carré Nf avec demande d'itinéraire automatique ; double sens → deux panneaux. Un **rapport de contrôle** liste sans bloquer : cantons plus courts que la distance d'arrêt, cantons de plus de 2 800 m, carré à moins de 100 m d'un point de convergence, aiguille abordée par la pointe sans carré en amont, ligne à plus de 220 km/h avec des signaux au sol |
| Réaliste → simple | sémaphore → block ; carré → chemin ; repère F / Nf → block / chemin dessiné comme un signal ; les états se projettent sur trois couleurs (S et C → rouge ; A, (A), ralentissement → jaune ; VL, (VL) → vert). Les réglages propres au réaliste (plaques, capacité de ralentissement, type de cible) restent en mémoire, inactifs, et reviennent au retour |

La bascule est donc sans perte dans les deux sens. Modèle : JGR pour le contrôle, à ceci près qu'ici il informe au lieu de refuser.

### Ordre de construction

| Rang | Contenu | Jouable ? |
|---|---|---|
| 1 | Signal attaché à la voie (brique déjà prévue), pose avec aperçu sous le curseur et flèche de sens, retournement, suppression ; cantons déduits et **colorés** quand l'outil est actif | pose seulement |
| 2 | Occupation et règle de block à trois états ; dessin simple ; prochain signal, premier signal fermé et alerte de freinage dans le HUD ; freinage d'urgence au franchissement | **oui : espacement, niveau simple** |
| 3 | Dessin réaliste de la même règle : cible à trois feux vue de face dans le HUD, plaque F, marche à vue après arrêt, 30 km/h d'approche ; réglage de projet et bascule | **oui : étape (a) réaliste** |
| 4 | Réservation de trajets ; signal de chemin / carré ; aiguilles immobilisées ; affichage des réservations ; alerte « train en attente » | oui : jonctions et gares |
| 5 | Pose en série avec espacement ; rapport de contrôle ; déplacement d'un signal le long de la voie | confort |
| 6 | Réaliste seulement : repères et vitesse en cabine (d), puis ralentissements (c), puis jaune et vert clignotants | LGV, entrées en gare |

Les rangs 2 et 3 partagent tout le calcul : le niveau réaliste n'attend pas que le niveau simple soit fini. C'est l'ordre de la feuille de route existante (a, b, d, c) avec le dessin simple en premier, parce qu'il permet de valider cantons et occupation avant d'investir dans les cibles.

### Risques

| Risque | Parade |
|---|---|
| Deux jeux de règles divergent | un seul calcul d'état ; chaque niveau ne fournit qu'une table « état → dessin » et ses règles de conduite ; tests communs sur le calcul |
| Le niveau simple reste inconduisible à 300 km/h | les aides n° 2 à 4 du §6 en font partie dès le rang 2 ; ne pas les repousser |
| Le canton « toutes branches » surprend au niveau réaliste | le rapport de contrôle signale une aiguille sans carré ; avec un carré à chaque entrée de jonction les cantons deviennent linéaires |
| Le train du joueur n'a pas de destination | trajet = aiguilles en place ; à l'approche d'un signal de chemin fermé, le HUD dit quelle réservation manque |
| Blocages avec des trains automatiques | hors sujet tant que les trains pilotés par le jeu n'existent pas ; la réservation par tronçon et la règle « attendre devant la jonction » sont déjà les bonnes |
| Dérive de périmètre du réaliste (BAPR, block manuel, manœuvres) | s'en tenir aux lignes « rédhibitoire » et « attendu » du §7 |
| Trop d'indications à la pose | Factorio l'a constaté (F4) : au plus trois à la fois — aperçu du signal, flèche de sens, couleur des deux cantons créés |
| Objets qui ne survivent pas aux coupes de rails | traité par la brique « objet attaché à la voie » (`audit-objets-de-voie.md`) |
| Promesse de bascule sans perte | tester l'aller-retour simple → réaliste → simple sur un projet type |

## 9. Palette d'outils

Proposition **[E]**, dans le mode « Signalisation » déjà prévu pour la barre de gauche (sélection, limite de vitesse, suppression).

Niveau simple, dans l'ordre :

1. Sélection
2. Signal de block
3. Signal de chemin
4. Limite de vitesse
5. Supprimer

Niveau réaliste, dans l'ordre :

1. Sélection
2. Sémaphore (panneau de block)
3. Carré
4. Repère de LGV
5. Limite de vitesse
6. Supprimer

Commun aux deux niveaux :

| Où | Contenu |
|---|---|
| Barre contextuelle, outil de pose actif | Inverser le sens (touche F) ; Double sens ; Espacement de la pose en série (mètres) |
| Barre contextuelle, signal sélectionné | Inverser ; changer de type (block ↔ chemin, sémaphore ↔ carré) ; au niveau réaliste : plaque, capacité de ralentissement ; au niveau simple : sens unique |
| Gestes | clic = un signal, du côté de la voie où se trouve le curseur ; glisser le long de la voie = pose en série ; glisser un signal = le déplacer |
| Affichage (bascules) | Cantons ; Réservations ; au niveau réaliste : Contrôles d'implantation |
| Réglages du projet | Niveau de signalisation |

La pose en série est un geste et non un bouton : c'est le choix d'OpenTTD, et il garde la palette à cinq ou six entrées.

## 10. Non trouvé ou contradictoire

| Sujet | État |
|---|---|
| Jeu de conduite à signaux volontairement génériques | aucun trouvé ; les jeux de conduite gardent les signaux réels et simplifient le HUD |
| Même réseau présenté en « signaux de jeu » ou en « signaux d'un pays » | aucun exemple ; la recommandation extrapole à partir d'OSRD, de JGR et de Train Sim World |
| Enquête ou retour structuré de cheminots sur les simulateurs | non trouvé ; le §7 est une estimation, le seul retour de forum est connu par résumé de recherche |
| RailSys | toujours non documenté publiquement |
| Simulateurs internes de la SNCF pour les agents de circulation | non trouvé ; seuls les simulateurs de conduite CORYS apparaissent, par une source commerciale |
| Sweet Transit, Train Valley | pas de documentation officielle lue ; guide de joueur et résumés seulement |
| Mini Metro | non vérifié |
| Railway Empire 2, mode automatique | le détail des règles (où le jeu pose ses signaux) n'est pas décrit dans la source lue |
| Factorio 2.0 | changements éventuels de la pose des signaux non recherchés ; les pages lues datent de 2017 à 2023 |
| Factorio, alertes « pas de chemin » et « destination pleine » | connues par résumé de recherche seulement |
| OpenTTD | T1 se déclare « très datée » ; les réglages (réservations affichées par défaut, densité de 4 carreaux) viennent d'une page d'archive ou de T2 et peuvent avoir changé ; avertissement « train bloqué » non trouvé dans la documentation |
| Distance minimale entre deux signaux | aucun jeu lu n'en impose ; seules des interdictions (aiguille, quai, tunnel) et une recommandation de longueur de train |
| Signal à double sens | deux modèles incompatibles : un objet à deux faces (OpenTTD, Mashinky) ou deux objets dos à dos (Factorio). Mashinky signale que le double sens est la première cause de nez à nez |
| Bloc ou chemin comme premier objet à enseigner | OpenTTD, TF2 et NIMBY disent « chemin seul » ; Factorio, Mashinky et Sweet Transit gardent le block comme base. La recommandation garde les deux parce que le block correspond au sémaphore |
| Derail Valley | l'absence de signaux de block est déduite de la page « Signage », non affirmée par elle |
| Trainz, Train Simulator Classic, Microsoft Flight Simulator, OpenTrack, SimSig | résumés de recherche seulement |
