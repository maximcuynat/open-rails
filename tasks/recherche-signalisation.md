Recherche du 2026-10-05, avant le plan de la signalisation. Lecture seule, aucun code modifié.

# Signalisation ferroviaire française : état de l'art pour le simulateur

## 0. Lecture rapide

- La signalisation française sépare deux fonctions : **l'espacement** (cantonnement, signal type : sémaphore, 1 feu rouge, franchissable sous conditions) et **la protection** des aiguilles et itinéraires (signal type : carré, 2 feux rouges, jamais franchissable sans ordre).
- En BAL, chaque panneau annonce le suivant. La règle de base tient en trois lignes : canton occupé = sémaphore ; canton libre et panneau suivant à l'arrêt = avertissement ; sinon voie libre. C'est exactement le modèle « aspect = nombre de cantons libres devant » d'OpenBVE.
- Une voie déviée se signale par deux signaux : ralentissement (à distance, 2 jaunes horizontaux) puis rappel (sur le carré qui précède l'aiguille, 2 jaunes verticaux) ; fixes = 30 km/h, clignotants = 60 km/h.
- Sur LGV il n'y a pas de feux : des repères fixes (carré bleu à triangle jaune, plaque F ou Nf) bornent les cantons et la cabine affiche une vitesse. La séquence d'arrêt à 300 km/h s'étale sur 4 cantons, plus un canton d'attention en amont et un canton tampon en aval.
- Ordre de mise en œuvre conseillé : (a) block automatique seul, (b) carrés et itinéraires, (c) ralentissements, (d) TVM. Chaque étape est jouable seule.

Niveaux de confiance utilisés : **[C]** confirmé par au moins deux sources indépendantes ; **[1]** une seule source ; **[E]** estimé ou déduit par moi (à valider).

## Sources

| Id | Source | URL |
|---|---|---|
| S1 | SNCF, IN 1482, Règlement S1A Titre I « Signalisation au sol », version 1 du 05/10/2005 (texte réglementaire d'origine ; remplacé depuis par l'annexe VII de l'arrêté du 19 mars 2012 et S1b ci-dessous, mais les signaux décrits sont les mêmes) | http://www.rmb.asso.fr/signalisation.pdf (miroir : https://www.jonroma.net/media/rail/opdocs/world/france/S%201%20A%20I-%20Signalisation%20au%20sol.pdf) |
| S1b | SNCF Réseau, RFN-IG-SE 01 A-00 n°012 v4, dispositions complémentaires à l'annexe VII, signalisation au sol (téléchargé, seulement sondé pour recouper les distances de 500 m et 400 m) | https://www.securite-ferroviaire.fr/sites/default/files/reglementations/pdf/2026-06/RFN-IG-SE-01-A-00-num-12-V4-Dispositions-complementaires-annexe-VII-arret%C3%A9-19032012-Signalisation-au-sol-et-signalisation-a-main.pdf |
| S2 | EPSF, document pédagogique « Les signaux, les régimes d'exploitation, les systèmes d'espacement », 05/07/2017 | https://www.securite-ferroviaire.fr/sites/default/files/reglementations/pdf/2023-03/document-pedagogique-signaux-regimes-exploitation-v1.pdf |
| S3 | Roger Rétiveau, « La signalisation ferroviaire », Presses des Ponts, 1987, 619 p. (manuel technique SNCF ; ancien mais très précis sur l'implantation, les enclenchements, le PRS et la TVM 300) | https://lafibre.info/images/doc/198710_la_signalisation_ferroviaire_roger_retiveau.pdf |
| S4 | SNCF Réseau, RFN-IG-SE 01 A-00 n°013, « Signalisation de cabine du type TVM », v1 du 24/11/2015 | https://www.securite-ferroviaire.fr/sites/default/files/reglementations/pdf/2023-03/rfn-ig-se-01-00-num-013.pdf |
| S5 | EPSF, recommandation RC A-B 1c n°1, « Dispositifs de sécurité et automatismes embarqués », 06/11/2014 (VACMA, KVB, répétition des signaux) | https://www.securite-ferroviaire.fr/sites/default/files/reglementations/pdf/2023-03/rc-ab-1c-num-1-v1-mac.pdf |
| W1 | Wikipédia FR, Signalisation ferroviaire en France | https://fr.wikipedia.org/wiki/Signalisation_ferroviaire_en_France |
| W2 | Wikipédia FR, Block automatique lumineux | https://fr.wikipedia.org/wiki/Block_automatique_lumineux |
| W3 | Wikipédia FR, Block automatique à permissivité restreinte | https://fr.wikipedia.org/wiki/Block_automatique_%C3%A0_permissivit%C3%A9_restreinte |
| W4 | Wikipédia FR, Transmission voie-machine | https://fr.wikipedia.org/wiki/Transmission_voie-machine |
| W5 | Wikipédia FR, Carré (signal) ; Feu vert clignotant ; Cantonnement téléphonique ; Crocodile ; Veille automatique ; Contrôle de vitesse par balises ; Système européen de contrôle des trains | https://fr.wikipedia.org/wiki/Carr%C3%A9_(signal) et pages liées |
| X1 | X. Geillon, « La signalisation ferroviaire » et plan coté SNCF des cibles et mâts | http://xgeillon.free.fr/trains/signaux/signaux.htm ; http://xgeillon.free.fr/trains/signaux/dimension-signaux.pdf |
| X2 | NitraThor, fiches « Signaux SNCF », « Enchaînement signalisation » (d'après l'Abrégé de signalisation d'E. Bournez), « Cibles et silhouettes » | https://www.nitrathor.fr/fiches/enchainement-signalisation ; https://www.nitrathor.fr/projets/signalisation-lumineuse/cibles-et-silhouettes |
| X3 | DocRail, « Le signal carré » | https://docrail.fr/le-signal-carre/ |
| X4 | Forum cheminots.net, « Disposition des feux sur les panneaux » (forum, utilisé seulement en recoupement) | https://www.cheminots.net/topic/41866-disposition-des-feux-sur-les-panneaux-de-signalisation/ |
| X5 | Rail Passion, déploiement ERTMS et LGV Paris-Lyon | https://www.railpassion.fr/infrastructure/le-deploiement-de-lertms-a-petits-pas/ ; https://www.railpassion.fr/grande-vitesse/lgv-paris-lyon-va-gagner-capacite/ |
| J1 | OpenTTD, manuel des signaux | https://wiki.openttd.org/en/Manual/Signals |
| J2 | Open Rails, manuel, chapitre 11 « Train Operation » | https://open-rails.readthedocs.io/en/latest/operation.html |
| J3 | OpenBVE, format de route CSV (Track.Section, Track.SigF) | https://openbve-project.net/documentation/HTML/route_csv.html |
| J4 | Rail Route, wiki officiel, Routing et Automation | https://railroute.fandom.com/wiki/Routing ; https://railroute.fandom.com/wiki/Automation |
| J5 | NIMBY Rails, devblog 2021-05 (introduction des signaux) | https://carloscarrasco.com/nimby-rails-may-2021/ |
| J6 | Simutrans, guide des signaux (lu via résumé de recherche seulement) | https://sourceforge.net/p/simutrans/wiki/Signal%20guide/ |
| J7 | SimSig, wiki « Routing trains » (lu via résumé de recherche seulement) | https://www.simsig.co.uk/Wiki/Show?page=usertrack:ssrun:routing_trains |
| J8 | Trainz, wiki « Class Signal » (lu via résumé de recherche seulement) | https://online.ts2009.com/mediaWiki/index.php/Class_Signal |
| J9 | Dovetail Games, « Great Western Express Signalling » pour Train Sim World (lu via résumé de recherche seulement) | https://live.dovetailgames.com/live/train-sim-world/articles/article/great-western-express-signalling-a-brief-introduction |

Remarque sur S1 : le texte lu est une copie locale de l'IN 1482 (même référence, même édition) ; les deux URL répondent mais je n'ai pas comparé les fichiers octet par octet.

## 1. Principes

| Notion | Ce qu'il faut retenir | Source | Confiance |
|---|---|---|---|
| Risques couverts | Rattrapage (même sens), prise en écharpe (itinéraires convergents), nez à nez (sens contraires), déraillement par survitesse, obstacle | S2 §1 ; S3 §1.1.1 | C |
| Cantonnement | La ligne est découpée en cantons ; l'entrée de chacun est commandée par un signal ; un seul train par canton ; le signal d'entrée reste fermé pendant toute l'occupation | S2 §4.2 ; S3 §8.1.2 ; S1 art. 201 | C |
| Pourquoi | La distance d'arrêt dépasse la distance de visibilité : on ne peut pas rouler à vue | S2 §4.2 ; S3 §8.1.1 | C |
| Permissivité | Cantonnement « absolu » : interdit d'entrer en canton occupé de sa propre initiative. « Permissif » : autorisé moyennant précautions (marche à vue). Le BAL est permissif, le BAPR l'est de façon restreinte, le block manuel ne l'est pas | S3 §8.1.3, §8.7.2, §8.8.1 ; S2 §4.4 | C |
| Marche à vue | Avancer prudemment, pouvoir s'arrêter avant une queue de train, un signal d'arrêt ou un obstacle, sans dépasser 30 km/h | S4 glossaire ; S3 §1.2.3 | C |
| Marche en manœuvre | Avancer prudemment sans dépasser 30 km/h, prêt à obéir aux signaux | S3 §1.2.3 ; X1 | C |
| Protection | Les appareils de voie et parties de voie (aiguilles, traversées, zones de stationnement) sont protégés par un signal carré (carré sur voie principale, carré violet sur voie de service), manœuvré depuis un poste | S1 art. 201 ; S2 §2.3.1 | C |
| Annonce | Carré, sémaphore et feu rouge clignotant sont annoncés à distance par un avertissement, lui-même parfois précédé d'un feu jaune clignotant, et d'un feu vert clignotant au-delà de 160 km/h. Les signaux abordés en marche à vue ou en manœuvre ne sont pas annoncés | S1 art. 202 ; S2 §2.3.3 | C |
| Signal fixe / mobile, ouvert / fermé | Un signal « mobile » a deux aspects : « fermé » (l'ordre s'applique) et « ouvert » (l'ordre est levé). Vocabulaire à reprendre tel quel dans le code | S1 art. 102 | C |
| Signaux combinés | Sur un même panneau, seule l'indication (ou les indications) la plus impérative est présentée | S1 art. 105 ; S3 §1.7 | C |
| Enclenchement | Dispositif qui rend impossible une commande dangereuse : un signal ne s'ouvre que si les aiguilles sont en bonne position et verrouillées ; une aiguille ne se manœuvre pas tant qu'un signal est ouvert vers elle ou qu'un train est dessus ; deux itinéraires incompatibles ne se forment pas ensemble | S3 ch. 7 et §13.3 | 1 (source technique unique mais faisant autorité) |

Minimum à comprendre pour un simulateur : un signal d'arrêt a un **type** (espacement ou protection), un **état** déduit de l'occupation et des itinéraires, et il est **annoncé** par le signal précédent. Tout le reste en découle.

## 2. Systèmes de block en France

| Système | Principe | Longueur des cantons | Détection | Lignes | Sources | Confiance |
|---|---|---|---|---|---|---|
| Cantonnement téléphonique | Les agents des postes encadrants s'annoncent les trains et se rendent « voie libre » par dépêche ; aucune détection. Assisté par informatique (CAPI) sur voie unique avec voyageurs depuis l'accident de Flaujac (1985) | de gare à gare | aucune (observation de la queue du train) | trafic très faible, double voie ou voie unique | S2 §4.3 ; W5 | C |
| Block manuel par appareils (BM, BMU en double voie, BMVU en voie unique) | Des gardes manœuvrent les sémaphores ; des appareils de block reliés entre postes interdisent d'ouvrir vers un canton occupé. Non permissif. En voie unique, sémaphores normalement fermés | de poste à poste, « 10 à 25 km » (X2), plusieurs dizaines de km la nuit (S2) | pédales ou détecteurs de passage aux postes, plus vérification visuelle de la signalisation d'arrière | lignes peu chargées | S2 §4.4 ; S3 §8.1.5 ; X2 | C (principe) ; 1 (10 à 25 km) |
| BAPR | Block automatique à cantons longs. Le sémaphore d'entrée (panneau oblong, vert / rouge) et son avertissement (panneau rond, plaque A) sont deux signaux séparés. Entrée en canton occupé seulement après avis du régulateur, ou 15 min d'attente si le téléphone est en dérangement. Vitesse limitée à 160 km/h. Créé en 1968 | 6 km minimum (S3) ; « 6 à 15 km » (W3) ; « jusqu'à 15 km et plus » (S2) | circuits de voie ou compteurs d'essieux (S2 : « généralement » comptage d'essieux ; S3, 1987 : « généralement » circuits de voie) | trafic moyen | S2 §4.5.2 ; S3 §8.8 ; W3 | C |
| BAL | Block automatique à cantons courts. Le panneau d'entrée d'un canton porte aussi l'annonce du panneau suivant. Signaux allumés en permanence, à voie libre au repos. Permissif. Intervalle de 2,5 à 3 min entre trains | maximum 2 800 m ; « généralement 1 500 m » sur ligne à 160 km/h ; minimum 500 m avec jaune clignotant systématique | circuits de voie | lignes principales chargées ; critère d'installation selon S3 : environ 100 mouvements par jour (deux sens) en double voie, 40 en voie unique | S2 §4.5.1 ; S3 §8.1.6, §8.7 ; W2 | C |
| BAL dans les gares de BAPR ou de BM | La traversée des gares peut comporter des cantons courts de BAL (1 500 à 2 800 m), avec la permissivité du BAL | — | — | — | S1 art. 201 ; S3 §8.8.1 | C |
| TVM / ETCS 2 | Signalisation de cabine, voir §6 | 1 500 à 2 000 m | circuits de voie | LGV | S2 §4.6 ; W4 | C |

Détection, en deux phrases. Circuit de voie : un émetteur injecte un courant dans les deux files de rails, un récepteur à l'autre bout l'attend ; le premier essieu court-circuite la voie, le récepteur ne reçoit plus rien, le canton est occupé (S2 §4.5, C avec W4). Compteur d'essieux : un point de détection à chaque bout compte les essieux entrants et sortants ; égalité = canton libre (S2 §4.5, 1).

Détail utile au simulateur : le joint qui déclenche la fermeture du signal (« joint bloqueur ») est placé **12 à 18 m en aval du panneau**, pour que le conducteur ne voie pas son propre signal passer au rouge (S3 §8.7.3, 1).

Voie unique : le block doit empêcher le nez à nez en plus du rattrapage ; en BMVU, avant d'ouvrir un sémaphore, un « test » vérifie que le sémaphore opposé est fermé et bloqué et que la voie est libre (S2 §4.4.2, 1). La voie banalisée est une voie parcourue dans les deux sens avec des installations de sécurité qui s'opposent au nez à nez (S2 §3.3, 1) ; les LGV sont banalisées (S3 §19.2, 1).

## 3. Signaux lumineux et indications

### 3.1 Tableau des indications

Notation SNCF : les parenthèses indiquent un feu clignotant, par exemple (A) = feu jaune clignotant.

| Signal | Abrév. | Aspect lumineux | Ordre donné au conducteur | Rôle | Sources | Confiance |
|---|---|---|---|---|---|---|
| Carré | C | 2 feux rouges, sur une ligne verticale ou horizontale | Arrêt avant le signal. Ne se franchit jamais de sa propre initiative ; franchissement sur ordre écrit du poste, puis marche à vue | protection (voies principales) | S1 art. 203 ; S3 §1.2.1 ; W5 | C |
| Carré violet | Cv | 1 feu violet | Arrêt avant le signal | protection sur voies de service ; origine des refoulements sur voie principale (souvent en type bas) | S1 art. 204 ; S3 §1.2.2 | C |
| Guidon d'arrêt | GA | bande lumineuse rouge horizontale ; ouvert = éteint | Arrêt avant le signal. N'est rencontré qu'en marche à vue ou en manœuvre ; protège un PN, une manœuvre, un appareil isolé | protection locale | S1 art. 205 ; S3 §1.2.3 | C |
| Sémaphore | S | 1 feu rouge (avec œilleton allumé si le panneau porte une plaque Nf) | Arrêt avant le signal. En BAL (plaque F) le conducteur peut repartir de lui-même en marche à vue ; en BAPR selon avis du régulateur ; en BM non | espacement | S1 art. 208, 220, 221 ; S3 §1.2.4, §8.7.2 | C |
| Feu rouge clignotant | (S) | 1 feu rouge clignotant | Pas d'arrêt : franchir à 15 km/h au plus, puis marche à vue jusqu'à la fin du canton | espacement sans arrêt (rampes, gares de banlieue), réception sur voie occupée, annonce d'un signal d'arrêt à moins de 500 m | S1 art. 210 ; S3 §1.2.5 | C |
| Disque | D | 1 rouge + 1 jaune, sur une ligne horizontale ou verticale ; panneau rond | Arrêt différé : marche à vue dès que possible, arrêt avant le premier appareil de voie ou au poste, reprise après autorisation. Lignes à block manuel, en voie de disparition, non utilisé au-delà de 140 km/h | protection de petites gares | S1 art. 207 ; S3 §1.2.6 | C |
| Avertissement | A | 1 feu jaune | Être en mesure de s'arrêter avant le signal d'arrêt annoncé (carré, sémaphore), ou d'observer un feu rouge clignotant. Annonce aussi un heurtoir, un panneau éteint, un feu blanc | annonce | S1 art. 211 ; S3 §1.3.1 | C |
| Feu jaune clignotant | (A) | 1 feu jaune clignotant | Être en mesure de s'arrêter avant le signal d'arrêt annoncé « à distance réduite » par l'avertissement suivant. Peut aussi annoncer un ralentissement 30 à distance réduite | annonce d'un avertissement trop proche de son signal | S1 art. 213 ; S3 §1.3.2 | C |
| Feu vert | VL | 1 feu vert | Marche normale autorisée, si rien ne s'y oppose | voie libre | S1 art. 217 | C |
| Feu vert clignotant | (VL) | 1 feu vert clignotant | Équivaut au vert fixe pour les trains limités à 160 km/h ; les autres ramènent leur vitesse à 160 km/h au plus tard au panneau suivant | préannonce sur lignes à plus de 160 km/h | S1 art. 214 ; S3 §1.3.3 | C |
| Ralentissement 30 | R | 2 feux jaunes sur une ligne horizontale | Ne pas dépasser 30 km/h au franchissement de l'aiguille annoncée | annonce de voie déviée | S1 art. 302 | C |
| Rappel 30 | RR | 2 feux jaunes sur une ligne verticale | Idem, sur le panneau du carré qui précède l'aiguille | exécution | S1 art. 302 | C |
| Ralentissement 60 | (R) | les 2 jaunes horizontaux clignotent ensemble | 60 km/h à l'aiguille | annonce | S1 art. 303 | C |
| Rappel 60 | (RR) | les 2 jaunes verticaux clignotent ensemble | 60 km/h à l'aiguille | exécution | S1 art. 303 | C |
| Feu blanc | M | 1 feu blanc | Marche en manœuvre. Si un carré violet donne accès à une voie principale : marche à vue, 30 km/h sur les appareils de voie, jusqu'au signal d'entrée du canton suivant (en block automatique) | manœuvre ; aspect « ouvert » normal des signaux de voies de service | S1 art. 216, 218 | C |
| Feu blanc clignotant | (M) | 1 feu blanc clignotant | Manœuvre sur un parcours court ; interdit dans tous les cas le départ en ligne | manœuvre courte | S1 art. 219 | C |
| Bande jaune horizontale | BJ | bande lumineuse jaune, en complément de l'avertissement du carré d'entrée | S'arrêter à quai sur une distance réduite (voie courte ou partiellement occupée) ; entrée à 40 km/h au plus selon S3 | information | S1 art. 212 ; S3 §1.3.4 | C (principe) ; 1 (40 km/h) |
| Signal lumineux de manœuvre | SLM | 3 unités blanches : 2 feux alternés en vertical = « tirez », en horizontal = « refoulez », éteint = « arrêtez » | Ordres de manœuvre en tiroir | manœuvre | S1 art. 502 | 1 |

### 3.2 Arrêt absolu ou franchissable : plaques et œilleton

Le conducteur arrêté devant **un seul feu rouge fixe** (ou un panneau éteint) doit savoir si c'est un sémaphore ou un carré dont un feu est grillé. Il lit la plaque d'identification, puis l'œilleton (petit feu auxiliaire « blanc bleuté »).

| Plaque | Graphisme | Signification | Conduite devant un feu rouge fixe | Sources | Confiance |
|---|---|---|---|---|---|
| Nf | lettres blanches sur fond noir | le signal le plus impératif du panneau est un carré | regarder l'œilleton : allumé = sémaphore ; éteint ou absent = se comporter comme devant un carré | S1 art. 220, 221 ; W5 | C |
| F | blanc sur noir | sémaphore de BAL (ou feu rouge clignotant), franchissable à l'initiative du conducteur | sémaphore de BAL | S1 art. 220, 221 | C |
| PR | blanc sur noir | sémaphore d'entrée d'un canton de BAPR | sémaphore de BAPR | S1 art. 220 ; S3 §1.10.2 | C |
| BM | blanc sur noir | sémaphore d'entrée d'un canton de BM | sémaphore de BM, non franchissable de sa propre initiative | S1 art. 220 ; S2 §4.4.1 | C |
| A | lettre noire sur fond blanc, panneau rond | le panneau ne porte que des signaux à distance, le plus impératif étant l'avertissement | — | S1 art. 220 | C |
| D | noir sur blanc, panneau rond | idem, le plus impératif étant le disque | — | S1 art. 220 | C |
| Plaque de cantonnement « PR » ou « BM » (éventuellement « vers ... ») | noir sur blanc, sous une plaque Nf | mode de cantonnement du canton vers lequel le carré s'ouvre | — | S1 art. 220 | 1 |

Le texte extrait de S1 ne restitue pas les glyphes des plaques (images) : l'association lettre / signification est sûre, la casse exacte « Nf » vient de S2, S4 et W2.

Origine de la plaque F : à l'origine tous les panneaux de BAL avaient un œilleton ; par économie il a été remplacé par une plaque F réflectorisée sur les panneaux à 3 feux, sauf sur potence (X2, d'après Bournez ; cohérent avec S3 §8.7.2 ; C).

### 3.3 Séquences normales

| Situation | Séquence rencontrée par le train suiveur (du plus loin au plus près de l'obstacle) | Sources | Confiance |
|---|---|---|---|
| BAL à 3 indications | VL → A → S (ou C) | S3 §8.7.1 ; W2 ; S2 §4.5.1 | C |
| BAL à 4 indications (cantons plus courts que la distance d'arrêt) | VL → (A) → A → S | S3 §8.7.1 ; S1 art. 213 | C |
| Ligne à plus de 160 km/h (jusqu'à 220) | (VL) → A → S, ou (VL) → (A) → A → S. Le découpage des cantons reste fait pour 160 km/h ; la préannonce est donnée « généralement à deux cantons du point d'arrêt » | S3 §8.7.3 ; S1 art. 214 ; S2 §2.3.4 | C |
| BAPR | panneau rond A (jaune) placé à distance d'arrêt, puis panneau d'entrée du canton S (rouge) ; l'aspect ouvert de chacun est le vert | S3 §8.8.1 ; W3 | C |
| Voie déviée à 30 | R sur le panneau à distance, puis RR sur le carré qui précède l'aiguille | S1 art. 302 | C |
| Voie déviée à 30 avec un panneau intermédiaire | R est répété sur le panneau intermédiaire ; l'usage est de remplacer le premier R par (A) si le panneau intermédiaire est à 500 m au moins du rappel | S3 §1.4.1 | 1 |
| Voie déviée à 60 | (R) puis (RR) ; le premier (R) ne peut jamais être remplacé par (A) | S1 art. 303 ; S3 §1.4.1 | C |
| Voie déviée à plus de 60 | TIV mobiles à distance et de rappel : hors périmètre, voir l'autre recherche | S3 §1.4.1 | 1 |
| Panneau éteint | le panneau amont l'annonce comme s'il était à l'arrêt (donc A) | S3 §8.7.2 ; S1 art. 211 | C |
| Signal d'arrêt à moins de 500 m du précédent | l'avertissement est remplacé par un feu rouge clignotant | S3 §1.3.2 note | 1 |

### 3.4 Combinaisons autorisées sur un même panneau

| Combinaison | Règle | Source | Confiance |
|---|---|---|---|
| A + RR30 | autorisée ; l'avertissement est toujours le feu du bas | S1 art. 211 | 1 |
| A + RR60 | autorisée en signalisation lumineuse | S1 art. 211 | 1 |
| (A) + R60 | autorisée | S1 art. 213 | 1 |
| (A) + RR30 ou (A) + RR60 | autorisées ; dans ce cas l'avertissement suivant peut n'être qu'à 500 m de son signal d'arrêt | S1 art. 213, 303 | 1 |
| Rouge + jaune | seulement pour le disque, sur panneau rond | S1 art. 207 ; X4 | C |
| Vert + jaune | n'existe plus (ancien préavertissement, supprimé en 1975) | X4 | 1 (forum) |
| Nombre maximal de feux allumés | 3 jaunes au plus, hors œilleton et indicateur de direction | X4 | 1 (forum) |
| Double préannonce | interdite | W5 (Feu vert clignotant) | 1 |

Hiérarchie complète des indications : S3 §1.7 la donne dans une figure (fig. 1.170) que l'extraction de texte n'a pas restituée. **Non trouvée sous forme de liste.** Ordre déduit des règles ci-dessus, à valider : C > S > (S) > A > (A) > R / RR > (VL) > VL, les indications de vitesse R et RR se cumulant avec A ou (A) selon le tableau **[E]**.

## 4. Forme physique des signaux

| Élément | Fait | Source | Confiance |
|---|---|---|---|
| Panneau | feux groupés sur un écran noir bordé d'un liseré blanc, de forme oblongue ou circulaire | S1 art. 103 ; S3 §1.1.2 | C |
| Panneau rond | réservé aux panneaux qui ne portent que des signaux à distance (avertissement, disque) : en cas d'extinction, le conducteur sait qu'il n'y a pas d'arrêt absolu | S1 art. 220 ; S3 fig. 1.8 note | C |
| Côté | à gauche de la voie ou au-dessus ; à droite en Alsace-Moselle (Bas-Rhin, Haut-Rhin, Moselle), où l'on circule à droite | S1 art. 106 ; W1 | C |
| Signal implanté du « mauvais » côté | porte une flèche blanche oblique pointant vers sa voie ; pas de flèche en IPCS (contresens permanent), où les signaux de contresens sont de l'autre côté par construction | S1 art. 106 ; W1 | C |
| Supports | mât droit, mât « drapeau » (cible déportée de 495 mm), potence, portique, type bas au ras du sol | X1 (plan coté) ; S3 fig. 1.2, 1.3 | C (existence) ; 1 (495 mm) |
| Hauteur | axe de référence de la cible à environ 3,6 m (hauteur normale) ou 5,5 m (mât haut) au-dessus du rail : cotes lues 3 585 / 3 670 mm et 5 445 / 5 530 mm selon la cible | X1 (plan coté) | 1 |
| Feux | entraxe vertical 220 mm ; bras latéral à 600 mm ; 320 mm entre le feu du bas et la base de la cible | X1 (plan coté) | 1 |
| Œilleton | petit feu blanc bleuté, à gauche du mât, vers le bas de la cible | S1 art. 220 ; X1 ; X2 | C |
| Plaque de repérage | sous la cible, inscription noire sur fond blanc : numéro ou PK arrondi à l'hectomètre ; précédé de « C », « Cv » ou « GA » selon le signal | S1 art. 107 ; S3 §1.10.1 | C |
| Mirlitons | 3 balises à 3, 2 puis 1 bandes obliques noires sur fond blanc, à 100 m d'intervalle, avant un signal à visibilité réduite | S1 art. 108 ; S3 §1.8.3 | C |
| Visibilité « normale » | 100 m si V ≤ 60 km/h ; 200 m jusqu'à 120 ; 300 m au-delà | S3 §1.8.2 | 1 |
| Crocodile, balise | entre les rails, quelques mètres avant le signal (voir §8) | S3 §1.9 ; W5 | C |
| Signal annulé | croix de Saint-André blanche, feux éteints | S3 §1.12 ; S2 | C |

### Types de cibles et disposition des feux

Les lettres de type (A, C, F, H, ...) viennent de sources de modélisme (X2, ntrail45) ; le plan coté SNCF reproduit par X1 montre les mêmes formes sans les lettres. Les positions de feux ci-dessous sont lues sur ce plan, de haut en bas. « Cache » = emplacement obturé quand le feu n'est pas installé.

| Type | Forme | Emplacements, de haut en bas | Indications possibles | Confiance |
|---|---|---|---|---|
| A (3 feux) | oblong vertical | 1 vert (ou blanc) ; 2 rouge (ou cache) ; 3 jaune (ou violet, ou rouge) | BAL : VL, S, A. Voie de service : blanc en haut, violet en bas. BAPR / BM : vert, rouge | C pour l'ordre vert / rouge / jaune (X1, X4, S1 art. 211) ; 1 pour les variantes |
| C (5 feux) | oblong vertical plus haut | 1 rouge du carré (ou violet) ; 2 blanc (ou cache) ; 3 vert ; 4 rouge ; 5 jaune | C (feux 1 et 4), S (feu 4), A, VL, Cv, M | 1 (X1), cohérent avec X2 |
| F (7 feux) | « L » retourné : colonne de 6 plus 1 feu en haut à droite | rangée du haut : jaune (colonne) et jaune (bras droit) ; puis rouge du carré (ou violet) ; blanc ; vert ; rouge ; jaune | comme C, plus R / (R) par les deux jaunes du haut | 1 (X1) ; liste d'indications X2 |
| H (9 feux) | colonne de 6 plus colonne de 3 à droite | colonne gauche : jaune ; rouge du carré (ou violet) ; blanc ; vert ; rouge ; jaune. Colonne droite : jaune ; jaune ; jaune (celui du milieu au niveau du jaune haut de la colonne gauche) | comme F, plus RR / (RR) | 1 (X1) ; l'attribution « paire horizontale = R, paire verticale de droite = RR » est ma lecture du plan **[E]**, cohérente avec S1 art. 302 |
| R (6 feux) | non vue | — | A, S, VL, R, RR (X2) | 1, forme non trouvée |
| J (2 feux) | petit oblong | 2 feux | Cv + M, ou VL + S (X2) | 1 |
| Rond | disque, 6 emplacements | jaune en haut à gauche et à droite, vert au centre haut, rouge à mi-hauteur, jaune en bas (attribution partiellement illisible sur le plan) | avertissement de BAPR (jaune, vert), disque (rouge + jaune) | 1, détail incertain |
| Bas | petit boîtier au sol | — | carré violet et feu blanc pour les refoulements | S1 art. 222 ; S3 §1.2.2 ; C |

À noter : les deux rouges du carré sont volontairement espacés (le blanc s'intercale) et le second rouge est une optique plus petite (X4, forum, 1).

## 5. Emplacement des signaux

| Règle | Valeur | Source | Confiance |
|---|---|---|---|
| Sémaphore | à l'origine du canton qu'il protège ; en gare, un sémaphore près de chaque point normal de départ ; sans carré de sortie, il est en aval du quai ou du dernier appareil ; avec carrés de sortie, il est porté par ces panneaux | S3 §1.2.4 | 1 |
| Carré, cas général | peut être juste devant le point à protéger (quelques mètres) | S3 §1.2.1 | 1 |
| Carré protégeant une aiguille en talon ou une traversée (risque de prise en écharpe) | à 100 m au moins du garage franc, pour absorber un léger dépassement. Le garage franc est le point où l'entrevoie atteint 2 m entre bords extérieurs des rails voisins | S3 §1.2.1 ; X3 (« environ 100 m » retenu à l'unification de 1938) | C |
| Distance maximale carré / point protégé | habituellement pas plus de 3 000 m | S3 §1.2.1 | 1 |
| Carré portant un rappel de ralentissement | à 400 m au plus de l'aiguille en pointe si elle se franchit à moins de 60 km/h, 600 m au plus à 60 km/h et plus (pour que le conducteur n'oublie pas la limitation) | S3 §1.2.1 | 1 |
| Carré violet | le plus près possible du garage franc ou de la pointe de l'aiguille | S3 §1.2.2 | 1 |
| Avertissement | à une distance au moins égale à la distance d'arrêt du signal annoncé, sans dépasser 3 000 m | S3 §1.3.1 | 1 |
| Distance d'arrêt servant à implanter l'avertissement | fonction de la déclivité, de la vitesse d'approche et du freinage. Exemple S3 pour une ligne à 160 km/h : 1 350 m (rampe de 4 à 8 pour mille) à 1 500 m (palier et pentes). Tableau issu d'une extraction de texte, à relire sur l'original (p. 4) avant de coder des valeurs | S3 §1.1.5 | 1, lecture fragile |
| Avertissement trop proche | si l'avertissement ne peut pas être à distance d'arrêt, le panneau précédent porte (A) ; la distance (A) → signal d'arrêt doit être au moins la distance d'arrêt ; la distance A → signal d'arrêt peut descendre à 500 m, et à 400 m aux abords de gares en impasse à vitesse limitée | S1 art. 213 et note ; S1b ; S3 §1.3.2 | C |
| Canton de BAL | au moins la distance d'arrêt en BAL à 3 indications ; environ la moitié en BAL à 4 indications, jamais moins de 500 m ; 2 800 m au plus « afin qu'un mécanicien n'ait pas tendance à oublier » l'avertissement reçu | S3 §8.7.1 ; S2 §4.5.1 | C |
| Ralentissement | à « distance de ralentissement » de la pointe de la première aiguille ; le rappel est toujours groupé avec le carré qui précède l'aiguille | S3 §1.4.1 ; S1 art. 302 | C |
| Chevron pointe en bas | repère l'aiguille (ou la première) quand c'est nécessaire | S1 art. 302 ; S2 | C |
| Disque | à distance d'arrêt du premier point à protéger ; non annoncé | S3 §1.2.6 | 1 |
| Petite gare en block automatique | pour chaque sens, un panneau C + S + A + VL en amont des appareils de voie | S3 §8.9.1 | 1 |
| Entrée de LGV | le dernier panneau latéral est surmonté d'un tableau lumineux (« TGV » en 1987, « CAB » aujourd'hui) ; l'armement de la cabine se fait à hauteur ou juste en aval du dernier signal au sol, qui est un carré | S3 §19.9 ; S2 §2.4 ; S1 art. 218 | C |

**« Distance de glissement »** : le terme n'apparaît ni dans S1 ni dans S3. X2 (d'après Bournez) parle d'« une distance de glissement de quelques centaines de mètres au plus » entre le signal de protection et l'aiguille. La seule valeur chiffrée trouvée est le minimum de 100 m au garage franc. Il n'existe pas, dans les sources lues, d'équivalent français de l'« overlap » britannique enclenché derrière chaque signal sur ligne classique ; l'équivalent sur LGV est le **canton tampon** (§6).

Signaux d'entrée, de sortie, de bifurcation : ce ne sont pas des types réglementaires distincts mais des carrés nommés d'après leur emplacement (« carré d'entrée », « carrés de sortie », carré « de protection » d'une bifurcation) (S1 art. 210, 212 ; S3 §1.2.4, §8.9 ; C).

## 6. Sur LGV : TVM et ETCS

| Élément | Fait | Source | Confiance |
|---|---|---|---|
| Pourquoi | au-delà de 220 km/h la signalisation au sol n'est plus utilisée | S4 art. 101 ; S2 §4.6.1 ; S3 §19.1 | C |
| Principe | la cabine affiche en permanence le taux de vitesse à respecter, éventuellement annoncé un canton à l'avance ; pas utilisée sur voies de service | S4 art. 101 | C |
| Transmission | continue, par les circuits de voie (courant codé dans les rails, capté par des antennes devant le premier essieu), complétée par des boucles ou balises ponctuelles | S2 §4.6.1 ; W4 ; S3 §19.6 | C |
| Repère | cocarde fixe carrée, réflectorisée, fond bleu, triangle jaune dont la pointe désigne la voie concernée ; plaque de numéro noir sur blanc ; plaque F ou Nf. Implanté à l'extérieur des voies | S3 §19.4 ; W4 ; X5 | C |
| Repère F | équivaut à un sémaphore de BAL : arrêt permissif, espacement | S3 §19.4.2 | 1 |
| Repère Nf | équivaut à un carré : arrêt absolu, protection des appareils de voie ; franchissement sur autorisation du régulateur ; un dispositif ponctuel déclenche le freinage en cas de franchissement intempestif | S3 §19.4.2, §19.7.4 ; S4 art. 311 | C |
| Jalon de manœuvre | repère d'origine de mouvements commandés (rebroussement, refoulement). Aspect non décrit dans le texte extrait | S4 art. 308 | 1, aspect non trouvé |
| Longueur des cantons | environ 2 000 m en TVM 300, 1 500 m en TVM 430 ; circuits de voie jusqu'à 2 500 m | W4 ; S3 §19.6.2 | 1 pour chaque valeur |
| TVM 300 | analogique, une information parmi 18 (14 utilisées) : seulement la vitesse du canton courant ; contrôle de vitesse par paliers. LGV Sud-Est, Atlantique, nord de Rhône-Alpes | S2 §4.6.1 ; W4 | C |
| TVM 430 | numérique, mot de 27 bits : vitesse du canton, vitesse en fin de canton, vitesse en fin du canton suivant, déclivité, distance au bout du canton ; contrôle par courbe continue. LGV Nord et suivantes | S2 §4.6.1 ; W4 | C |
| Séquence d'arrêt à 300 km/h (TVM 300) | la distance d'arrêt est partagée en 4 cantons ; s'y ajoutent un canton d'attention en amont (indication de vitesse limite clignotante) et un canton tampon entre le repère d'arrêt et le point à protéger | S3 §19.7 | 1 |
| Ordre de grandeur | « 6 ou 7 cantons, environ 10 km » ; exemple EPSF d'un TGV arrêté 7 cantons devant en TVM 430 | W4 ; S2 §4.6.1 | C |
| Tampon réduit | repère Nf à moins d'un canton mais à plus de 570 m du point protégé : séquence sur 5 cantons, avec 80A et un contrôle à 90 km/h. Tampon minimal (100 à 570 m) : contrôle ponctuel à 65 km/h en plus | S3 §19.7.2, §19.7.3 | 1 |
| Changement d'indication | une indication plus restrictive n'apparaît qu'à l'entrée d'un canton, au repère ; une indication moins restrictive peut apparaître n'importe où | S3 §19.5.1 ; W4 | C |
| Voie déviée | signalée en cabine par une annonce puis une exécution, par exemple 160A puis 160E pour un changement de voie à 160 km/h, 220A / 220E pour une bifurcation à 220 | S3 §19.8.2 | 1 |
| Action des postes | « Rouge » si l'itinéraire n'est pas établi ; taux d'exécution imposé par la position d'une aiguille | W4 | 1 |
| Double signalisation | certaines sections ont TVM et signaux au sol | S4 ch. 5 | 1 |

### Indications en cabine

| Indication | Sens | Vitesse de déclenchement du freinage (TVM 300) | Source | Confiance |
|---|---|---|---|---|
| 300V (ou 270V, 320 en TVM 430) | vitesse limite de la ligne | 315 km/h pour 300 ; 285 pour 270 | S3 §19.5 ; W4 | C / 1 pour les seuils |
| (300V) clignotant (« prémonitoire ») | la vitesse reste autorisée jusqu'au bout du canton, mais une annonce est possible au canton suivant | idem | S3 §19.5 ; W4 | C |
| 270A, 220A, 160A, 80A (annonces) | ne pas dépasser ce taux à l'entrée du canton suivant ; toujours présentées dans cet ordre décroissant | 235 pendant 220A ; 170 pendant 160A (W4) | S3 §19.5 ; W4 ; S4 art. 201 | C |
| 220E, 160E, 80E (exécutions) | ne pas dépasser ce taux ; normalement précédée de l'annonce de même taux | 235, 170, 90 | S3 §19.5 ; W4 | C |
| 000 (« zéro ») | s'arrêter avant le premier repère rencontré ; repère F : le franchir en marche à vue | — | S4 art. 201 ; S3 §19.5 | C |
| Rouge | marche à vue (30 km/h au plus) et arrêt avant le premier repère Nf | 35 km/h | S3 §19.5 ; W4 | C |
| TVM 430 | taux supplémentaires 320, 230, 200, 170, 130, 60 ; toutes les annonces et exécutions peuvent clignoter (= le canton suivant sera encore plus restrictif) | courbe continue | W4 ; S4 art. 203 | C |

Couleurs de l'afficheur : annonce = chiffres noirs sur fond blanc (losange) ; arrêt = chiffres noirs sur fond rouge (S4, citant l'arrêté). Vitesse de ligne sur fond vert (S3 : chiffres noirs ; W4 : chiffres blancs). Exécution : W4 dit chiffres blancs sur fond noir. **Les sources divergent sur la couleur des chiffres ; seul l'aspect des annonces et du zéro est établi par le texte réglementaire.**

### ETCS niveau 2

| Fait | Source | Confiance |
|---|---|---|
| Signalisation de cabine par radio (GSM-R) ; le train reçoit une autorisation de mouvement avec vitesse but et distance but ; le centre radio (RBC) travaille avec les enclenchements ; la détection reste au sol (circuits de voie ou compteurs d'essieux) ; pas de matérialisation obligatoire des cantons | S2 §4.6.2 | 1 (source officielle) |
| Repère d'arrêt ETCS au sol ; sur LGV équipées des deux systèmes, les repères portent les deux pancartes | S2 §2.4 ; X5 | C |
| LGV Est : ETCS 2 en cohabitation avec la TVM 430 depuis 2013-2014 (phase 2 en 2016) ; SEA et BPL : ETCS 2 depuis 2017 | W5 (ETCS) ; X5 | C pour LGV Est ; 1 pour les dates SEA / BPL (marquées « référence nécessaire » sur Wikipédia) |
| LGV Paris-Lyon : remplacement de la TVM 300 par l'ERTMS 2, objectif 13 → 16 trains par heure | X5 ; résumé de recherche | C pour le projet ; **état exact de mise en service non établi** (voir §12) |

## 7. Itinéraires et postes d'aiguillage

Fonctionnement d'un poste à itinéraires (PRS), d'après S3 ch. 7 et 13. Source unique mais de référence ; confiance **1** partout sauf mention.

| Phase | Ce qui se passe |
|---|---|
| 1. Commande | l'aiguilleur appuie sur le bouton de l'itinéraire (un bouton par couple origine-destination). Si l'itinéraire est incompatible avec un autre, il est seulement **enregistré** (voyant blanc clignotant) et se formera dès que possible |
| 2. Formation | les aiguilles du parcours **et celles qui le protègent** prennent leur position |
| 3. Enclenchement | les commandes d'aiguilles sont immobilisées (voyant blanc fixe) |
| 4. Contrôle et ouverture | le carré d'origine ne s'ouvre que si : aiguilles contrôlées en position et verrouillées, itinéraire formé et enclenché, commutateur de fermeture en position ouverte, aucun itinéraire de sens inverse formé ou engagé |
| 5. Passage du train | l'occupation de la zone en aval du carré le referme aussitôt |
| 6. Destruction automatique | déclenchée par l'occupation puis la libération de la première zone aval (plus une pédale) ; le poste revient au repos sans action |
| 7. Transit souple | chaque aiguille reste enclenchée jusqu'à ce que le train l'ait dégagée, puis se libère une à une derrière lui, ce qui permet de préparer l'itinéraire suivant au plus tôt. « Transit rigide » : tout reste enclenché jusqu'à dégagement complet |

| Enclenchement | Rôle | Paramètres |
|---|---|---|
| Enclenchement d'approche | interdit de modifier un itinéraire établi dès qu'un train approche et a pu voir ouvert le premier signal d'annonce | la zone d'approche commence en principe 500 m en amont du premier signal d'annonce (A, (A) ou (VL)) et finit au joint juste en aval du carré. En BAL elle commence en général à l'entrée du canton précédant ce signal d'annonce |
| Destruction manuelle, zone d'approche libre | immédiate | — |
| Destruction manuelle, zone d'approche occupée et carré déjà ouvert | l'aiguilleur ferme d'abord le carré, puis la destruction n'est effective qu'après une temporisation | « temps moral » de 1 à 3 min ; 3 min habituellement sur voies principales ; 1 min pour les carrés violets de manœuvre |
| Enclenchement de parcours | variante sans circuit de voie en amont : agit dès l'ouverture du signal, donc toujours temporisé | idem |
| Enclenchement de proximité | n'ouvre le carré que lorsque le train a assez ralenti (accès à une impasse courte, aiguille éloignée rarement déviée) | pédale à 150 m au plus en amont du signal |
| Sens inverses | interdit d'ouvrir ensemble deux signaux d'itinéraires de sens contraires partageant une partie de voie | — |
| Tracé permanent | l'itinéraire se reforme tout seul après chaque train ; annule la destruction automatique | — |
| Fermeture d'urgence | un commutateur libre permet toujours de refermer un carré | — |

Ce qui lie un signal aux aiguilles en aval : le carré est l'« origine » d'un ou plusieurs itinéraires. Son **ouverture** dépend de la position contrôlée des aiguilles ; son **indication la moins impérative** dépend de l'itinéraire formé : VL pour la voie directe, (RR) pour une déviation à 60, RR pour une déviation à 30, et le panneau amont porte l'annonce correspondante (S3 §13.3.5, exemple des itinéraires AB, AC, AG ; 1).

Technologies de postes sur LGV : PRS (Sud-Est, Atlantique), PRCI (Nord, Rhône-Alpes), SEI (Méditerranée, Est, Rhin-Rhône) (W4, 1).

### Règles minimales pour un comportement crédible **[E]**

1. Un itinéraire = un signal d'origine, un signal (ou heurtoir) de destination, la liste des tronçons parcourus et la position exigée de chaque aiguille.
2. Il ne se forme que si aucun de ses tronçons ni aucune de ses aiguilles n'est occupé ou réservé par un autre itinéraire.
3. Le carré ne s'ouvre qu'une fois les aiguilles en position et réservées ; il se referme dès que la tête du train le franchit.
4. Les aiguilles se libèrent une à une quand la queue du train les dégage ; l'itinéraire se détruit tout seul.
5. Annulation : immédiate si aucun train n'approche ; sinon le signal se ferme et les aiguilles ne se libèrent qu'après un délai.
6. Sans itinéraire, un carré reste fermé.

Ces six règles reproduisent les phases 1 à 7 ci-dessus sans simuler de relais. La protection de flanc (aiguilles hors parcours mises en position de protection) existe en réalité (phase 2) mais peut être omise au début.

## 8. Sécurité embarquée liée aux signaux

| Dispositif | Principe | Paramètres utiles | Source | Confiance |
|---|---|---|---|---|
| Répétition des signaux par crocodile et brosse | une barre métallique d'environ 2 m entre les rails, quelques mètres avant le signal, touchée par une brosse sous l'engin : son continu si le signal est franchi « fermé », son bref s'il est « ouvert » ; l'état est enregistré | le conducteur doit acquitter au bouton de vigilance ; sans action dans les 5 s, freinage automatique | S3 §1.9.1 ; W5 (Crocodile) | C |
| Signaux répétés « fermé » | avertissement, feu jaune clignotant, disque, ralentissements 30 et 60, TIV à distance en losange ; et, s'ils sont sur un panneau équipé, carré, carré violet, sémaphore, feu rouge clignotant, feu blanc | les rappels de ralentissement ne sont pas répétés : un panneau qui ne montre qu'un rappel se répète « ouvert » | S3 §1.9.1 ; W5 | C |
| Panneaux non équipés | voies parcourues à 40 km/h ou moins | — | S3 §1.9.1 | 1 |
| Préannonce | au franchissement d'un feu vert clignotant : son modulé et voyant « P » ; contrôle que la vitesse est revenue à 160 km/h au signal suivant. Fonction reprise depuis par le KVB | — | S3 §1.9.1 ; W5 (KVB) | C |
| Détonateurs | certains carrés de voie principale parcourue à plus de 40 km/h font exploser un pétard s'ils sont franchis fermés | — | S3 §1.9.2 ; S1 art. 404 | C |
| VACMA | veille automatique : le conducteur tient un appui (pédale, cerclo, bouton) et doit le relâcher brièvement à intervalles | relâché plus de 5 s : alarme puis freinage ; maintenu environ 1 min sans relâcher (30 s sur certains engins) : alarme puis freinage | S5 art. 201 ; W5 (Veille automatique : 1 min ± 10 s, 3 s pour réagir) | C |
| KVB | balises entre les rails au droit des signaux ; un calculateur de bord construit une courbe de décélération vers le signal d'arrêt annoncé et contrôle aussi le franchissement des signaux d'arrêt fermés. Deux seuils : alerte sonore, puis freinage d'urgence irréversible jusqu'à l'arrêt. Ce n'est pas une signalisation : il n'affiche pas les signaux | à l'approche de tout signal d'arrêt annoncé fermé, **30 km/h au plus** (affichage « 00 »), ou 10 km/h (« 000 », par exemple vers un heurtoir) ; transmission ponctuelle : le train ne « sait » qu'un signal s'est rouvert qu'en le franchissant, sauf zones à transmission continue (KVBP) | S5 art. 302 à 305 ; W5 (KVB) | C |
| Sur LGV | le contrôle de vitesse est intégré à la TVM (« COVIT ») ; tout changement d'indication plus restrictif sonne et doit être acquitté sous 5 s | — | S2 §1, §4.6 ; S3 §19.5 | C |

Conséquence pour le jeu : après un avertissement, un conducteur réel aborde le signal d'arrêt à 30 km/h au plus, même si le signal s'est rouvert entre-temps (KVB ponctuel). C'est un comportement simple à reproduire et très visible.

## 9. Dans d'autres logiciels

| Logiciel | Modèle de cantons et de signaux | Itinéraires | Fidélité | Coût sur un graphe | Source | Confiance |
|---|---|---|---|---|---|---|
| OpenTTD, signaux de block (anciens) | le signal est vert si le block en aval ne contient aucun train ; le block est tout ce qui est relié jusqu'aux signaux suivants, toutes branches comprises | aucun | faible : une bifurcation entière est bloquée par un seul train ; blocages aux jonctions | très faible : un parcours du graphe | J1 | 1 |
| OpenTTD, signaux de chemin (défaut actuel) | le signal est rouge par défaut ; le train **réserve les tronçons de son chemin** jusqu'à la prochaine « position d'attente sûre » (devant un signal, un dépôt, une fin de voie) ; deux trains peuvent partager un block si leurs chemins ne se touchent pas | implicites, calculés par le train | bonne pour la capacité ; pas d'aspects d'annonce | moyen : réservation par tronçon | J1 | 1 |
| Simutrans | les trains réservent les voies qu'ils vont utiliser dans le block, pas le block ; variantes : pré-signal (vérifie deux blocks), signal de long block (réservation directionnelle pour voie unique), signal de choix (choisit un quai libre) | implicites | moyenne | moyen | J6 (résumé de recherche) | 1, non lu directement |
| NIMBY Rails (v1.2) | signal de block simple : toutes les voies en aval sont balayées jusqu'à 10 km, toutes branches comprises, jusqu'au prochain signal ou à une « balise de block » qui ferme un block sans pouvoir arrêter de train ; signaux à sens unique ; pas de signaux en pleine voie nécessaires ; le jeu est agnostique sur le côté de la voie | signaux de chemin ajoutés ensuite (non vérifié) | faible à moyenne | très faible | J5 | 1 |
| Rail Route | le joueur est l'aiguilleur : il clique un signal d'origine puis une destination, les aiguilles se placent et l'itinéraire se verrouille en vert ; signaux automatiques, capteurs qui demandent l'itinéraire à l'approche du train, file d'attente d'itinéraires, « routage perpétuel » | explicites, plus court chemin libre | bonne pour la logique de poste ; pas d'aspects | moyen | J4 | 1 |
| Open Rails | la voie est découpée en sections ; en mode « Auto Signal » le chemin du train est libéré de signal en signal, le nombre de signaux libérés devant étant un paramètre par type de signal ; aspects calculés par des scripts par type de signal ; pièges anti-blocage sur les tronçons communs à sens opposés ; franchissement d'un signal fermé = freinage d'urgence et perte de contrôle | chemin fixé par l'activité, réservé devant le train | élevée | élevé (scripts, modes, interblocages) | J2 | 1 |
| OpenBVE | la ligne est une suite de « sections » ; chaque section liste ses aspects : a0 si elle est occupée, a1 si elle est libre et la suivante rouge, a2 si deux sont libres, etc. Les signaux visibles ne sont que la représentation d'une section | aucun (ligne unique) | élevée pour la conduite | très faible | J3 | 1 |
| Trainz | état des signaux calculé automatiquement : arrêt, attention (suivant rouge), attention avancée (suivant jaune), avec variantes de direction ; des « signaux invisibles » servent à borner les jonctions | implicites | moyenne | faible | J8 (résumé de recherche) | 1, non lu directement |
| Train Sim World | block par circuits de voie : rouge derrière le train, jaune derrière, etc. ; signalisation réelle de chaque pays reproduite ligne par ligne | scénarisés | élevée en aspects | élevé (contenu par ligne) | J9 (résumé de recherche) | 1, non lu directement |
| SimSig | simulateur de poste : itinéraire par clic entrée puis sortie ; toute zone occupée de l'itinéraire remet le signal d'entrée à l'arrêt ; « overlap » réservé au-delà du signal de sortie et relâché après temporisation ; enclenchement d'approche temporisé (environ 2 min) | explicites, enclenchements complets | la plus élevée côté poste | élevé | J7 (résumé de recherche) | 1, non lu directement |

### Ce qui se transpose le mieux sur un graphe de voies

| Approche | Simplicité | Réalisme obtenu | Verdict |
|---|---|---|---|
| Block « toutes branches » (OpenTTD ancien, NIMBY) | maximale | correct en pleine voie, mauvais aux bifurcations | bon point de départ pour l'étape (a), en gardant la possibilité de borner un block sans signal |
| Aspect = nombre de cantons libres devant (OpenBVE) | maximale | reproduit exactement VL / A / S, puis (A) et (VL) en ajoutant des rangs | **meilleur rapport réalisme / complexité** pour les indications |
| Réservation de tronçons le long du chemin (OpenTTD chemin, Simutrans) | moyenne | évite les blocages, permet deux mouvements simultanés dans une même zone | c'est la forme simple du « transit souple » ; bonne base pour l'étape (b) |
| Itinéraires explicites origine-destination (Rail Route, SimSig) | moyenne à élevée | fidèle au PRS français | à adopter pour l'étape (b), avec demande automatique à l'approche pour ne pas imposer le rôle d'aiguilleur |
| Scripts par type de signal (Open Rails) | élevée | maximal, multi-pays | inutile ici : un seul code de signaux, des règles en dur suffisent |

## 10. Modèle recommandé pour le simulateur

Tout ce chapitre est une proposition **[E]** appuyée sur les faits des sections 1 à 9. Vocabulaire du dépôt repris : `Network`, segments, jonctions avec `activeBranch`, `TrackPosition` (`segId`, `t`, `forward`), `TrainSet`. Les « sections » existantes (`models/sections.ts`) sont découpées par la topologie, pas par les signaux : un canton est une notion différente et doit être calculé à part.

Principe commun : comme les jonctions et les sections, **les cantons et les indications sont dérivés, pas stockés**. On ne stocke que les signaux posés et, plus tard, les itinéraires demandés.

### Étape (a) : block automatique

Données à stocker :

| Donnée | Contenu |
|---|---|
| Signal | identifiant ; ancrage sur la voie (`segId`, `t`) ; sens de circulation auquel il s'adresse ; côté d'affichage (gauche par défaut, option droite) ; type de panneau ; repérage (numéro ou PK) |
| Réglages de ligne | vitesse de la ligne (pour décider si la préannonce existe), côté de circulation |
| Par train | rien de nouveau : la tête et la queue suffisent |

Calculs :

1. **Canton d'un signal** : ensemble des tronçons atteints en partant du signal dans son sens, jusqu'au prochain signal de même sens ou jusqu'à une fin de voie. Aux aiguilles, suivre la branche active pour chercher le « signal suivant », mais inclure toutes les branches pour l'occupation tant qu'aucun signal ne les borne (comportement OpenTTD / NIMBY, prudent par défaut).
2. **Occupation** : un canton est occupé si l'intervalle queue-tête d'un train le recoupe, quel que soit le sens du train. Décaler le début du canton d'une quinzaine de mètres en aval du signal (joint bloqueur à 12-18 m) pour que le conducteur voie son signal ouvert jusqu'au franchissement.
3. **Indication**, en comptant les cantons libres devant (modèle OpenBVE) :

| Condition | Indication |
|---|---|
| canton occupé | sémaphore S |
| canton libre, signal suivant à l'arrêt, ou canton finissant sur un heurtoir | avertissement A |
| canton libre, signal suivant à A, et canton suivant plus court que la distance d'arrêt | feu jaune clignotant (A) |
| ligne à plus de 160 km/h, deux cantons avant l'arrêt (le signal suivant montre A ou (A)) | feu vert clignotant (VL) |
| sinon | voie libre VL |

Les deux lignes du milieu peuvent attendre : VL / A / S suffit pour une première version, à condition que les cantons posés soient au moins aussi longs que la distance d'arrêt. Un contrôle d'édition peut signaler un canton trop court (moins que la distance d'arrêt à la vitesse de la ligne) ou trop long (plus de 2 800 m en BAL).

Ce que voit le conducteur : le prochain signal dans le HUD (cible vue de face, distance) ; son son de répétition au franchissement d'un signal fermé avec acquittement ; règle de conduite : après A, être capable de s'arrêter au signal suivant et l'aborder à 30 km/h au plus. Sémaphore à plaque F : arrêt, puis reprise possible en marche à vue (30 km/h) jusqu'au bout du canton. Franchir un signal fermé sans s'être arrêté = freinage d'urgence (c'est ce que font le KVB et Open Rails).

Pour les trains pilotés par le jeu : viser l'arrêt quelques mètres avant le signal fermé, exactement comme l'arrêt « nez au heurtoir » déjà en place.

### Étape (b) : signaux de protection et itinéraires

Données à stocker en plus :

| Donnée | Contenu |
|---|---|
| Signal | drapeau « protection » (carré, plaque Nf, œilleton) ; variante carré violet pour les voies de service |
| Itinéraire demandé | signal d'origine, destination (signal ou fin de voie), état (enregistré, formé, engagé), option tracé permanent |
| Réservation | par tronçon et par aiguille : identifiant de l'itinéraire qui le tient |

Un itinéraire possible n'a pas besoin d'être saisi à la main : il se **déduit** du graphe (chemins du signal d'origine jusqu'au prochain signal de même sens, un par combinaison de branches). On ne stocke que ceux qui sont demandés.

Règles :

| Règle | Détail |
|---|---|
| Formation | possible si aucun tronçon ni aucune aiguille du chemin n'est occupé ou réservé ; sinon l'itinéraire reste « enregistré » et se formera dès que possible |
| Effet | les aiguilles prennent la position voulue (`activeBranch`) et ne peuvent plus être manœuvrées, ni à la main ni par un autre itinéraire |
| Indication du carré | fermé (2 rouges) tant qu'aucun itinéraire n'est formé depuis lui. Une fois formé, il applique la règle de block de l'étape (a) sur le chemin réservé : S avec œilleton si le canton est occupé, A, ou VL |
| Annonce | le signal amont traite un carré fermé comme un signal à l'arrêt : il montre A |
| Passage | le carré se referme quand la tête du train le franchit |
| Transit souple | chaque tronçon et chaque aiguille se libère quand la queue du train l'a dégagé |
| Destruction | automatique quand tout est libéré ; avec tracé permanent, l'itinéraire se reforme aussitôt |
| Annulation | immédiate si aucun train n'est entre le signal d'annonce et le carré ; sinon le carré se ferme et les aiguilles restent verrouillées pendant un délai (réalité : 1 à 3 min ; à raccourcir pour le jeu) |
| Sens inverses | découle de la réservation par tronçon : deux itinéraires opposés sur la même voie ne peuvent pas coexister |
| Demande automatique | par défaut, un train demande son itinéraire en approchant du signal d'annonce (capteurs de Rail Route, « Auto Signal » d'Open Rails) ; le joueur peut aussi le tracer à la main |

Ce que voit le conducteur : carré fermé = arrêt absolu, aucune reprise de sa propre initiative. Sur le HUD, la plaque Nf et l'œilleton permettent de distinguer « sémaphore sur panneau Nf » de « carré ».

Contrôles d'édition utiles : aiguille prise en talon ou traversée sans carré à 100 m au moins du point de convergence ; aiguille en pointe sans carré en amont.

### Étape (c) : ralentissements pour voies déviées

Données à stocker en plus : par aiguille, la vitesse autorisée en voie déviée (30, 60, ou plus ; à tirer du catalogue d'appareils de voie, sujet de l'autre recherche) ; par signal, la capacité du panneau (type F pour annoncer, type H pour rappeler).

Règles :

| Règle | Détail |
|---|---|
| Rappel | si l'itinéraire formé depuis un carré passe une aiguille en déviation limitée à 30 ou 60, le carré montre RR ou (RR), seul ou avec A / (A) selon le block |
| Annonce | le signal précédent montre R ou (R) à la place de VL |
| Priorité | si le carré est fermé, l'amont montre A et non R (on annonce l'arrêt, pas le ralentissement) |
| Zone | la limitation s'applique de l'aiguille jusqu'à ce que le dernier véhicule ait franchi la dernière aiguille de la série |
| Plus de 60 km/h en déviation | pas de R / RR mais des tableaux de vitesse : hors de cette étape |
| Implantation | le carré porteur du rappel est à 400 m au plus de l'aiguille (600 m si 60 km/h) |

Ce que voit le conducteur : deux jaunes horizontaux puis deux jaunes verticaux ; un plafond de vitesse temporaire sur le HUD entre l'aiguille et le dégagement de la queue.

### Étape (d) : signalisation en cabine façon TVM

Données à stocker en plus : un attribut de ligne ou de tronçon « signalisation de cabine » ; des repères (même ancrage qu'un signal, type F ou Nf, pas de feux) ; les points d'entrée et de sortie du domaine.

Règles (TVM 300 simplifiée, ligne à 300 km/h), en comptant les cantons entre le train et l'obstacle :

| Position | Indication en cabine |
|---|---|
| canton occupé par le train précédent, ou itinéraire non formé derrière un repère Nf | Rouge |
| canton tampon, juste avant | à protéger par l'indication 000 du canton précédent ; l'affichage dans le tampon lui-même (Rouge) est une déduction |
| 1 canton avant le tampon | 000 : arrêt au repère suivant |
| 2 cantons avant | 160A |
| 3 cantons avant | 220A |
| 4 cantons avant | 270A |
| 5 cantons avant | (300V) clignotant |
| au-delà | 300V |

Autres règles : une indication plus restrictive ne s'affiche qu'au passage d'un repère ; une moins restrictive s'affiche tout de suite. Voie déviée : annonce puis exécution (160A puis 160E). Survitesse : freinage d'urgence au-delà de la vitesse affichée plus 10 à 15 km/h (315 pour 300, 285 pour 270, 235 pour 220, 170 pour 160, 90 pour 80, 35 pour Rouge). Repère F : après arrêt, reprise possible ; repère Nf : non.

Ce que voit le conducteur : aucun feu sur la voie, des repères bleus à triangle jaune ; sur le HUD un afficheur de vitesse-consigne avec fond de couleur, un son à chaque changement restrictif. Une variante TVM 430 (afficher aussi la vitesse du canton suivant par clignotement, courbe continue) n'apporte rien au début.

### Ordre et dépendances

| Étape | Dépend de | Apporte |
|---|---|---|
| (a) | rien | l'espacement, les trois aspects de base, le HUD signal |
| (b) | (a) | la sécurité aux aiguilles, les mouvements simultanés en gare |
| (c) | (b) et les vitesses d'aiguille | le réalisme des entrées en gare |
| (d) | le calcul de cantons de (a), les repères Nf de (b) | les LGV, le cœur du matériel TGV actuel |

Comme le matériel actuel est un TGV, (d) peut être tirée avant (c) : elle réutilise le calcul de cantons et n'a besoin d'aucun dessin de feux.

## 11. Dessin

### Vue de dessus (canevas)

Aucune source lue ne décrit les symboles des schémas de signalisation SNCF : ce qui suit est une proposition **[E]** fondée sur la forme réelle des objets.

| Objet | Proposition |
|---|---|
| Signal sur mât | un point (le mât) à gauche de la voie dans le sens concerné, à 2,5-3 m de l'axe (valeur non sourcée) ; un trait court perpendiculaire à la voie (la cible vue par la tranche) ; un petit disque de la couleur de l'indication, tourné vers les trains qui arrivent |
| Sens | le disque coloré est du côté d'où vient le train ; un signal ne se voit que d'un sens |
| Carré | deux petits disques rouges côte à côte, ou un petit carré plein, pour le distinguer d'un sémaphore à une échelle lisible |
| Carré violet de type bas | petit rectangle au ras de la voie, sans mât |
| Panneau rond (avertissement de BAPR, disque) | cercle au lieu du trait |
| Repère TVM | petit carré bleu avec un triangle jaune pointant vers la voie, à l'extérieur de la plateforme |
| Crocodile | petit trait dans l'axe de la voie juste avant le signal (optionnel) |
| Canton | à l'état sélectionné : surlignage du canton, rouge s'il est occupé |
| Zoom faible | ne garder que le disque coloré |

### Vue de face (HUD et panneau de propriétés)

Faits sourcés (X1 pour les positions, S1 pour les aspects) :

| Élément | Description |
|---|---|
| Cible | fond noir, liseré blanc continu près du bord, extrémités arrondies |
| Proportions | feux ronds, entraxe vertical 220 mm ; cible de 3 feux d'environ 0,45 m de large pour 0,9 m de haut (estimation d'après le plan, non cotée) |
| Type A | 3 feux en colonne : vert, rouge, jaune de haut en bas |
| Type C | 5 feux en colonne : rouge (second feu du carré), blanc, vert, rouge, jaune |
| Type F | la colonne du type C surmontée d'un jaune, plus un jaune à droite sur la même rangée (bras à 600 mm) |
| Type H | la colonne du type F, plus une colonne droite de 3 jaunes espacés de 300 mm |
| Panneau rond | disque noir à liseré blanc ; avertissement : un jaune ; disque : un rouge et un jaune sur une ligne horizontale |
| Carré | 2 rouges (les feux 1 et 4 d'une cible C) |
| Sémaphore | 1 rouge (le rouge du bas) ; sur panneau Nf, œilleton allumé |
| Avertissement | le jaune du bas |
| Voie libre | le vert |
| Ralentissement | 2 jaunes sur une ligne horizontale ; clignotants ensemble pour 60 |
| Rappel | 2 jaunes sur une ligne verticale ; clignotants ensemble pour 60 |
| Carré violet | 1 feu violet |
| Manœuvre | 1 feu blanc, fixe ou clignotant |
| Guidon d'arrêt | bande lumineuse rouge horizontale |
| Œilleton | petit feu blanc bleuté, à gauche du mât, au niveau du bas de la cible |
| Plaque d'identification | petit rectangle sous la cible : « Nf » ou « F » (aussi « PR », « BM ») en blanc sur noir ; « A » ou « D » en noir sur blanc |
| Plaque de repérage | rectangle blanc, inscription noire : numéro ou PK à l'hectomètre, précédé de « C », « Cv » ou « GA » |
| Flèche | blanche, oblique, vers la voie concernée, si le signal n'est pas du côté normal |
| Feux éteints | à dessiner en gris foncé : la position du feu allumé fait partie de la lecture |
| Clignotement | cadence non trouvée dans les sources ; à choisir (environ 1 Hz) **[E]** |

Afficheur TVM pour le HUD : un nombre à trois chiffres dans un cartouche. Vitesse de ligne : fond vert. Annonce : chiffres noirs sur fond blanc, avec un losange. Zéro : « 000 » en noir sur fond rouge. Rouge : cartouche rouge. Exécution : chiffres blancs sur fond noir d'après Wikipédia seulement.

Repère TVM vu de face : carré bleu réflectorisé, triangle jaune pointant vers la voie, plaque « F » ou « Nf », plaque de numéro noir sur blanc.

## 12. Non trouvé ou contradictoire

| Sujet | État |
|---|---|
| Longueur maximale d'un canton de BAL | 2 800 m pour S2, S3 et W2 ; « 3 km maximum » dans W3. Retenir 2 800 m |
| Longueur des cantons de BAPR | 6 km minimum (S3), 6 à 15 km (W3), 6 à 16 km (W1), « jusqu'à 15 km et plus » (S2). Pas de maximum réglementaire trouvé |
| Détection en BAPR | circuits de voie « généralement » en 1987 (S3), comptage d'essieux « généralement » en 2017 (S2) : évolution dans le temps plutôt que contradiction |
| Distance minimale avertissement / signal d'arrêt | 500 m (S1, S1b, S3), 400 m par exception en zone de gare à vitesse limitée (S1, S1b) ; W1 dit seulement « jusqu'à 400 m » |
| Distance de glissement | pas de valeur réglementaire trouvée ; seul le minimum de 100 m au garage franc (S3, X3) et « quelques centaines de mètres au plus » (X2) |
| Tableau des distances d'implantation selon vitesse et déclivité | présent dans S3 p. 4 mais extrait de façon peu fiable ; les référentiels actuels de SNCF Réseau ne sont pas publics |
| Hiérarchie complète des indications combinées | figure de S3 non lisible ; ordre proposé au §3.4 à valider |
| Disposition exacte des feux du panneau rond et du type R | partiellement illisible (rond) ou non trouvée (R) |
| Lettres des types de cibles | viennent de sources de modélisme ; non vues dans un document SNCF |
| Distance latérale du mât à la voie, dimensions des cibles hors entraxes | non trouvées |
| Cadence de clignotement | non trouvée |
| Symboles de plan pour la vue de dessus | non recherchés dans un référentiel de schémas ; proposition seulement |
| Conduite après arrêt devant un sémaphore ou un carré (règlement S1B, IN 1490) | non lu ; les règles de reprise citées viennent de S3 et de Wikipédia |
| Annexe VII de l'arrêté du 19 mars 2012 | non lue directement ; connue par les citations de S4 et S5. S1 (2005) est le texte d'origine, plus lisible, mais n'est plus le texte en vigueur |
| Aspect du jalon de manœuvre TVM | non décrit dans le texte extrait |
| Couleurs de l'afficheur TVM | divergence entre S3 (chiffres noirs sur vert), W4 (chiffres blancs sur vert, exécution en blanc sur noir) et S4 (annonce en noir sur blanc, zéro en noir sur rouge). Dépend aussi de la génération de matériel |
| Longueur des cantons TVM | 2 000 m (TVM 300) et 1 500 m (TVM 430) : Wikipédia seulement |
| Affichage dans le canton tampon | non trouvé explicitement ; « Rouge » est une déduction |
| Séquence exacte en TVM 430 à 320 km/h | non trouvée (seul un exemple graphique dans S2) |
| ETCS 2 sur la LGV Paris-Lyon | Wikipédia indique une mise en œuvre en novembre 2024 en cohabitation avec la TVM ; Rail Passion annonçait un service commercial en 2025 ; un article de mars 2026 (Railway Gazette, connu par résumé de recherche seulement) parle de fin d'essais dynamiques. État réel à ce jour non établi |
| SimSig, Simutrans, Trainz, Train Sim World | décrits d'après des résumés de recherche, pages non lues directement |
| NIMBY Rails | seule l'introduction des signaux en 2021 a été lue ; les signaux de chemin ajoutés ensuite ne sont pas vérifiés |
