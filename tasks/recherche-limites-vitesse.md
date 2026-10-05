Recherche du 2026-10-05, avant le plan des limites de vitesse. Lecture seule, aucun code modifié.

# Limites de vitesse sur le réseau ferré français : rapport de recherche

Aucun fichier du dépôt n'a été modifié. Les textes réglementaires ont été lus dans le texte (S1A, S1C, documents EPSF) ; leurs figures ne sont pas extraites par la conversion PDF, donc les aspects visuels reposent sur le texte réglementaire et sur des sites spécialisés. **Aucune table chiffrée de « distance de ralentissement » (distance d'annonce des TIV) n'a été trouvée** : c'est le principal manque (voir § 12).

Confiance : **C** = confirmé par plusieurs sources, **1** = une seule source, **E** = estimé ou déduit par moi. Les clés entre crochets renvoient à la liste des sources en fin de document.

## En bref

- Une limite de vitesse française est une **zone de A à B sur une voie**, définie par points kilométriques, superposée à une **vitesse plafond de ligne**. Le train doit être à la vitesse basse **quand sa tête entre** dans la zone et ne peut réaccélérer que **quand sa queue en est sortie**.
- Elle est **annoncée en amont**, à la « distance de ralentissement », par un tableau à chiffres noirs sur fond blanc (TIV à distance), puis **exécutée** au début de zone (pancarte Z, ou tableau à chiffres blancs sur fond noir), et levée à la pancarte R.
- Une même portion de voie peut porter **plusieurs limites selon la catégorie de train** (jusqu'à trois tableaux groupés). Pour un simulateur qui ne fait rouler que des TGV, une seule valeur par zone suffit au départ.
- Sur LGV il n'y a pas de panneaux de vitesse : la limite est affichée en cabine, canton par canton (environ 1 500 m), et une baisse est annoncée un canton avant.
- Le modèle le plus répandu dans les jeux est le « panneau ponctuel valable jusqu'au suivant » ; les outils professionnels (OSRD de SNCF Réseau, railML, OpenTrack) utilisent des **zones avec début, fin, sens et valeur par catégorie**. C'est ce second modèle qui correspond à la demande « de A à B ».

## 1. Types de lignes et de voies

| Type | Vitesse typique | Source | Conf. |
|---|---|---|---|
| LGV | plafond 320 km/h ; lignes ou sections à 300 et 270 | [EPSF-SYS], [OPENDATA] | C |
| Ligne classique, cas général | 160 km/h « standard » | [EPSF-SYS], [LSF-PRE] | C |
| Ligne classique sans passage à niveau | jusqu'à 200 km/h | [EPSF-SYS] | 1 |
| Ligne classique, maximum en signalisation au sol | 220 km/h (au-delà : signalisation de cabine obligatoire) | [EPSF-TVM] art. 101, [EPSF-PEDA] § 4.6.1 | C |
| Voie de service (dépôt, triage, garage) | 30 km/h, marche en manœuvre, pas de cantonnement | [LSF-VOIES], [LSF-VS] | C |
| Garage de circulation (voie de service accessible en pointe) | accès à 30 km/h | [LSF-VOIES] | 1 |
| Évitement de circulation (voie principale dédoublée) | accès à 60 km/h, « parfois plus » | [LSF-VOIES] | 1 |
| Voie unique à trafic restreint | « généralement pas plus de 50 km/h » | [EPSF-PEDA] § 3.3.3 | 1 |
| Marche à vue (tous types de voie) | 30 km/h maximum | [EPSF-TVM] glossaire | C |

Répartition réelle des 2 373 tronçons du jeu de données ouvert « vitesse maximale nominale sur ligne » de SNCF Réseau (nombre de tronçons par vitesse, requête du 2026-10-05, [OPENDATA]) : 30 → 291 ; 40 → 174 ; 60 → 156 ; 80 → 112 ; 90 → 145 ; 100 → 179 ; 110 → 126 ; 120 → 167 ; 130 → 87 ; 140 → 177 ; 150 → 76 ; 160 → 210 ; 200 → 35 ; 220 → 44 ; 230 → 18 ; 270 → 15 ; 300 → 25 ; 320 → 10. Les valeurs sont presque toutes des multiples de 10 (quelques multiples de 5). Conf. C pour les valeurs, c'est une source primaire.

Groupes UIC (1 à 9) : ils classent les lignes par tonnage pour la maintenance, pas par vitesse ; non retenus. Je n'ai pas vérifié leur définition dans une source primaire.

Voies de gare et voies à quai : **aucune règle générale de vitesse trouvée** (voir § 8).

## 2. Types de trains et dépendance à la catégorie

La vitesse limite d'un train est la plus basse entre celle des renseignements techniques (RT) pour sa catégorie, celle liée à sa composition, et celles de la signalisation [EPSF-RC7A].

| Catégorie réglementaire | Signification | Conf. |
|---|---|---|
| V200, V160, V140, V120 (R… si réversible) | trains de voyageurs remorqués, le nombre est la vitesse limite | C [EPSF-RC7A] art. 1102.2 |
| MVGV, MV160, ME140, ME120, ME100 | messageries | C |
| MA100, MA90, MA80 | marchandises | C |
| Code à 4 caractères, ex. E32C, E30C, E16C, T14N | automoteurs : E/T/B (électrique, thermique, bimode) + vitesse en dizaines + lettre ; **C = respecte les TIV de type C**, N = ne les respecte pas | 1 [EPSF-RC7A] art. 1102.3 |
| AUTOM / AUTOR | automoteurs électriques / autorails (ancienne dénomination encore employée) | 1 [LSF-LPV] |

Vitesses maximales de matériels (ordre de grandeur pour des valeurs par défaut) : TGV Duplex 320 km/h, TGV M 320 km/h en exploitation (conception 360) — conf. 1 chacun, Wikipédia ; Régiolis (TER) 160 km/h, option 200 — conf. 1. Intercités, Transilien et fret : **non vérifiés dans cette recherche** ; les indices ci-dessus donnent les plafonds réglementaires par catégorie (V160/V200, MA100, ME120…).

**Oui, une même portion de voie peut avoir plusieurs limites selon le train.** Trois mécanismes [S1A] art. 307 à 311, confirmés par [DOCRAIL] et [LSF-LPV] (conf. C) :

| Tableau | S'adresse à | Forme |
|---|---|---|
| TIV ordinaire à un nombre | tous les trains | carré ou losange |
| TIV ordinaire à deux nombres | le plus élevé : trains au moins aussi rapides que les MA 100 ; le plus bas : les autres | carré ou losange |
| TIV type B | trains autorisés à dépasser 140 km/h | demi-cercle, courbure en bas |
| TIV type C | trains automoteurs ; à deux nombres, celui du bas en italique vise les pendulaires | demi-cercle, courbure en haut |
| TIV pentagonal | certaines locomotives (pancarte L), messageries, marchandises ; chiffre en **dizaines** de km/h ; zones courtes (ordre de 500 m, [LSF-LPV]) | pentagone |

Les tableaux B, C et ordinaire peuvent être groupés sur le même support, par exemple « C 130 / pendulaire 140, ordinaire 120 » [DOCRAIL].

## 3. Comment une limite est définie

| Notion | Définition | Source | Conf. |
|---|---|---|---|
| Vitesse limite de ligne (« plafond ») | inscrite aux RT / livret de ligne, par section de ligne et par catégorie de train ; non signalée sur le terrain sauf aux transitions | [S1A] art. 301 et 312, [LSF-LPV] | C |
| Point de transition | changement de plafond ; placé à un point remarquable (bâtiment voyageurs, poste…) ou repéré par une pancarte « Km 123,4 » (PK arrondi à l'hectomètre) | [S1A] art. 312 | C |
| LPV (limitation permanente) | zone plus basse que le plafond : courbe, aiguille, ouvrage d'art ; signalée par TIV ou par signaux de ralentissement ; les zones de moins de 5 km ne figurent pas au livret et sont signalées par TIV | [S1A] art. 301, [LSF-LPV] | C (5 km : 1) |
| LTV (limitation temporaire) | chantier ; signalée par des TIV de chantier **ronds**, qui s'ajoutent à la signalisation existante sans la modifier ; prévue ou inopinée | [S1A] art. 313 à 316 | C |
| Bornes | début et fin par points kilométriques ; le jeu de données ouvert est structuré en `code_ligne`, `pkd`, `pkf`, `v_max` | [OPENDATA] | C |

**« De tel point à tel point, par voie et par sens » : oui pour la signalisation, partiellement vérifié pour la définition.** La signalisation dépend du sens : dans le sens de la vitesse décroissante la pancarte Km est précédée d'un TIV à distance, dans le sens croissant elle est seule [S1A] art. 312 ; les signaux s'adressent à une voie et un sens (implantés à gauche de la voie) [DOCRAIL], [WP-SIG]. Que la valeur elle-même diffère par voie et par sens dans les RT est affirmé par [LSF-LPV] (« vitesses limites sur les différentes voies ») mais je n'ai pas lu de RT réel : conf. 1.

Règle d'application (conf. C, [S1A] art. 302, 306, 307 ; [LSF-LPV]) :
- baisse : la vitesse doit être atteinte quand la **tête** franchit le début de zone (pancarte Z, TIV d'exécution, aiguille) ;
- reprise : seulement quand le **dernier véhicule** a franchi la fin (pancarte R, dernière aiguille). Exception : limitation ne visant que la locomotive (pancarte L), reprise dès que la locomotive est passée.

## 4. Signalisation des limites (lignes classiques)

| Signal | Rôle | Aspect | Source | Conf. |
|---|---|---|---|---|
| TIV fixe à distance, carré | annonce d'une LPV | chiffres noirs sur fond blanc | [S1A] art. 307 | C |
| TIV fixe à distance, losange | idem, équipé de la répétition en cabine (crocodile) ; utilisé quand la chute est d'au moins 40 km/h | chiffres noirs sur fond blanc | [S1A] art. 307, [LSF-LPV], [WP-RAL] | C |
| Pancarte Z | début de la zone | lettre blanche sur fond noir, non éclairée | [S1A] art. 307 | C |
| Pancarte R | fin de zone, reprise | lettre blanche sur fond noir | [S1A] art. 307 | C |
| TIV mobile à distance | annonce de la vitesse d'une aiguille en voie déviée (60, 70… km/h) ; effacé si voie directe | losange, chiffres noirs sur blanc ; ouvert : bande verticale blanche | [S1A] art. 306 | C |
| TIV de rappel | exécution, groupé avec le carré qui précède l'aiguille | carré, chiffres blancs sur fond noir | [S1A] art. 306 | C |
| Chevron pointe en bas | repère l'aiguille en pointe où la limite commence | couleurs non vérifiées | [S1A] art. 302 | C |
| Chevron pointe en haut | repère une aiguille prise en talon (sortie de faisceau) | couleurs non vérifiées | [S1A] art. 608 | 1 |
| Pancarte « Km … » | point de transition du plafond | noir sur fond blanc | [S1A] art. 312 | C |
| Tableau P | préannonce d'un TIV pour les trains à plus de 160 km/h : franchir le TIV à 160 au plus | carré, P noir sur blanc | [S1A] art. 310 | C |
| TIV de chantier à distance | annonce d'une LTV ; avec disque jaune si limite ≤ 40 km/h | **rond**, chiffres noirs sur blanc | [S1A] art. 313 | C |
| TIV de chantier d'exécution | début de la LTV | rond, chiffres blancs sur noir | [S1A] art. 313 | C |
| Tableau blanc | fin de la LTV | rond blanc | [S1A] art. 313 | C |

Les TIV sont en km/h, multiples de 10, parfois de 5 [LSF-LPV], [DOCRAIL]. Le texte en vigueur (annexe VII de l'arrêté du 19 mars 2012, complétée par [EPSF-012], version du 21-01-2026) reprend ces dispositions ; la numérotation des articles a changé (502 à 508) mais pas le contenu que j'ai pu comparer.

**Distance d'annonce.** La règle est qualitative : le TIV à distance est implanté « au moins à la distance de ralentissement » de l'origine de la zone, calculée pour le train le plus rapide de la ligne, selon le profil, la vitesse d'approche et la capacité de freinage [LSF-LPV], [LSF-LTV], [LSF-DIST] (conf. C sur le principe). **Aucune table de valeurs trouvée.** Points de repère chiffrés disponibles :

| Repère | Valeur | Source | Conf. |
|---|---|---|---|
| Distance d'annonce d'arrêt de référence des automoteurs | 900 à 1 100 m à 140 km/h ; 740 m à 120 km/h | [EPSF-RC7A] art. 1102.3 | 1 |
| Arrêt depuis 160 km/h | plus de 1 500 m si pente moyenne > 4 ‰ | [DOCRAIL] | 1 |
| Implantation des signaux sur ligne classique | faite pour 160 km/h ; au-delà (jusqu'à 220) on ajoute la préannonce | [LSF-PRE] | 1 |
| Décélération implicite de ces repères | environ 0,65 à 0,75 m/s² | calcul v²/2d | E |

**Seuil d'annonce.** Je n'ai trouvé aucun seuil en dessous duquel l'annonce est dispensée : toute LPV signalée par TIV comporte un TIV à distance. Les seuils qui existent portent sur autre chose : 40 km/h de chute pour le losange à crocodile ; plafond amont supérieur à 140 km/h pour l'obligation d'un TIV avant un point de transition situé à un point remarquable [S1A] art. 312. En revanche une hausse de vitesse n'est jamais annoncée.

## 5. Limites données par les signaux lumineux et les aiguilles

| Signal | Aspect | Sens | Source | Conf. |
|---|---|---|---|---|
| Ralentissement 30 | 2 feux jaunes sur une ligne horizontale | à distance : aiguille en déviation à 30 km/h | [S1A] art. 302 | C |
| Rappel 30 | 2 feux jaunes sur une ligne verticale | groupé avec le carré qui précède l'aiguille | [S1A] art. 302 | C |
| Ralentissement 60 / rappel 60 | mêmes feux, **clignotants** | idem à 60 km/h, signalisation lumineuse seulement | [S1A] art. 303 | C |
| Feu vert clignotant | — | ramener la vitesse à 160 km/h au plus tard au signal suivant (trains > 160) | [S1A] art. 214 | C |
| Feu blanc | — | marche en manœuvre ; s'il donne accès à une voie principale, marche à vue sans dépasser 30 km/h sur les appareils de voie | [S1A] art. 218 | C |

Au-delà de 60 km/h la vitesse d'une aiguille en déviation est donnée par TIV mobiles. Si le rappel est présenté ouvert (voie directe), le conducteur reprend sa vitesse.

Vitesse en voie déviée selon la tangente du cœur — **les deux tables trouvées divergent** :

| Tangente | Longueur [ADV-OB] | Vitesse [ADV-OB] | Vitesse [ADV-FORUM] |
|---|---|---|---|
| 0,13 | 24 m | 30 | 30 |
| 0,11 | 28 m | 40 | 30 |
| 0,10 | 30 m | 50 | — |
| 0,085 | 40 m | 70 | 60 |
| 0,05 (et 0,0654) | 63 m | 100 | 90 |
| 0,034 | 88 m | 120 (150 si symétrique) | — |
| 0,0218 (1/46), pointe mobile | — | 160 | 160 |
| 0,0154 (1/65), pointe mobile | — | 220 | 220 |

Conf. C pour 0,13 → 30, 1/46 → 160 et 1/65 → 220 ; conf. 1 et contradictoire pour le reste. Les deux sources sont un blog d'ancien cheminot et un forum, pas un référentiel. [WP-ADV] indique jusqu'à 230 km/h en France en voie déviée. Les valeurs 80 et 170 km/h de la demande n'ont pas été retrouvées comme vitesses d'appareil de voie ; 170 et 230 existent comme taux TVM 430 (§ 6), le lien avec les appareils 1/46 et 1/65 est une déduction de ma part (E). En voie directe la tangente ne limite pas la vitesse [ADV-FORUM]. Aiguilles non verrouillées (voies de service, certaines voies uniques) : 30 km/h le plus souvent [WP-ADV].

## 6. LGV : vitesse en cabine (TVM)

| Point | Valeur | Source | Conf. |
|---|---|---|---|
| Principe | la cabine affiche en permanence le taux à respecter, annoncé en amont du point d'exécution ; pas de TVM sur voies de service | [EPSF-TVM] art. 101 | C |
| Taux TVM 300 | 300, 270, 220, 160, 80, 000, plus « rouge » (marche à vue 30) | [WP-TVM], [LSF-TVM] | C |
| Taux supplémentaires TVM 430 | 320, 230, 200, 170, 130, 60 | [WP-TVM] | C pour 320/230/200 ([LSF-TVM]), 1 pour 170/130/60 |
| Longueur des cantons | environ 2 000 m (TVM 300), 1 500 m (TVM 430) | [WP-TVM], [LSF-TVM] | C |
| Repères de canton | jalon à triangle jaune sur fond bleu, la pointe désigne la voie ; plaque Nf (non franchissable) ou F (franchissable en marche à vue) | [WP-TVM], [EPSF-TVM] art. 201 | C |
| Annonce (A) | chiffres noirs sur fond blanc (losange, carré sur certains engins) : se conformer au plus tard à l'indication d'exécution, donc en fin de canton | [EPSF-TVM] art. 201 | C |
| Exécution (E) | taux à respecter tant qu'il est affiché ; chiffres blancs sur fond noir | [WP-TVM] | 1 |
| Clignotement | l'indication suivante peut être plus restrictive ; TVM 300 : seule la marche normale sur fond vert clignote ; TVM 430 : toutes les indications sauf arrêt et marche à vue | [EPSF-TVM] art. 203 | C |
| Arrêt « 000 » | chiffres noirs sur fond rouge : s'arrêter avant un repère Nf, franchir un repère F en marche à vue | [EPSF-TVM] art. 201 | C |
| Changement d'indication | accompagné d'un signal sonore ; une indication restrictive n'apparaît qu'au passage d'un repère | [EPSF-TVM] art. 203, [WP-TVM] | C |
| Séquence d'arrêt depuis 300 km/h | 300 → 270A → 220A → 160A → 80A → 000, environ 10 km | [WP-TVM], [LSF-TVM] | C sur l'ordre de grandeur |
| Données TVM 430 | vitesse du canton, vitesse en fin de canton, vitesse en fin du canton suivant, déclivité, distance but | [EPSF-PEDA] § 4.6.1, [WP-TVM] | C |

Une restriction sur LGV (courbe, aiguille, LTV) est donc annoncée par les taux d'annonce successifs des cantons amont, pas par des tableaux ; les LTV peuvent aussi l'être par des signaux de chantier au sol [EPSF-TVM] art. 306.

## 7. Contrôle de vitesse (à laisser hors périmètre au départ)

| Système | Fonctionnement | Source | Conf. |
|---|---|---|---|
| KVB, vitesse plafond | alerte sonore et voyant au-delà de **+5 km/h** ; freinage d'urgence au-delà de **+10 km/h**, voyant FU jusqu'à l'arrêt | [LSF-KVB] | 1 (site détaillé ; un résumé de moteur de recherche concordant, non relu à la source) |
| KVB, approche d'un point but | trois courbes : alerte (environ 5 s avant), contrôle (déclenche l'urgence), freinage d'urgence établi (à ne pas dépasser) | [LSF-KVB], [WP-KVB] | C |
| KVB, approche d'un signal fermé | vitesse d'approche 30 km/h (alerte 35, contrôle 40) ou 10 km/h (12,5 et 15) si moins de 200 m de glissement | [LSF-KVB], [S1C] art. 203 | C |
| KVB, champ | plafond, LPV, LTV, préannonce à 160 ; jamais au-dessus de 220 km/h | [S1C], [WP-TVM] | C |
| COVIT (TVM) | contrôle continu ; prise en charge (freinage d'urgence) à +15 km/h au-dessus de 200 (320 → 335, 300 → 315, 270 → 285, 230 → 245, 220 → 235, 200 → 215), +10 km/h en dessous (160 → 170, 80 → 90) ; par palier en TVM 300, par courbe décroissante en TVM 430 | [LSF-TVM], [WP-TVM], [EPSF-PEDA] | C |

## 8. Zones particulières

| Zone | Limite courante | Source | Conf. |
|---|---|---|---|
| Voies à quai, traversée de gare | pas de règle générale trouvée : limites locales par TIV ou par les aiguilles d'entrée | — | non trouvé |
| Voie en impasse avec heurtoir | contrôle KVB à 10 km/h possible à l'approche du heurtoir, traité comme un signal d'arrêt fermé | [S1C] art. 203 note 2 | 1 |
| Départ d'une voie de service | 30 km/h jusqu'à ce que tout le train soit sur voie principale | [LSF-VS] | 1 |
| Passages à niveau | pas de limite au droit du passage ; ils ont été supprimés des lignes parcourues à plus de 160 km/h (quelques exceptions) | [WP-PN], [EPSF-SYS] | C |
| Chantiers | LTV, § 3 et 4 | [S1A] | C |
| Sections de séparation (sectionnement, baissez panto) | consignes de traction, aucune limite de vitesse trouvée | [WP-SIG] | 1 |
| Contresens sur voie unique temporaire | 70 km/h | [EPSF-PEDA] § 3.4 | 1 |

## 9. Dans d'autres logiciels

| Logiciel | Modèle | Catégories | Source | Conf. |
|---|---|---|---|---|
| Open Rails / MSTS | panneau ponctuel (*speedpost*) valable jusqu'au suivant, plus plafond de route, plus limites de signaux ; la limite appliquée est le minimum ; une hausse ne vaut qu'une fois la queue passée | non pour les signaux SPEED (« pas de vitesse par type de train ») | [OR] § 11.9, 11.12.3, 11.15.1 | 1 (documentation officielle) |
| openBVE | commande `Track.Limit` en un point : « nouvelle limite à partir de ce point », baisse immédiate, hausse quand tout le train est passé, 0 = levée | non | [BVE] | 1 (documentation officielle) |
| Trainz | panneau ponctuel valable jusqu'au suivant ; piège connu : il faut reposer la vitesse de ligne à la sortie d'une voie lente | non | [TRAINZ] | 1 (forum) |
| Train Simulator Classic | propriété du **tronçon de voie** : deux vitesses, primaire (voyageurs) et secondaire (autres) ; les panneaux sont des objets distincts | 2 | [TSC] et résultat de recherche | 1 |
| Train Sim World | vitesse portée par la voie, marqueurs aux changements | non vérifié | discussion Steam, résultat de recherche seulement | 1, faible |
| OpenTrack | attribut de l'arête du graphe : vitesse maximale par catégorie de train | oui | résumé d'article, résultat de recherche seulement | 1, faible |
| railML 2 | `speedChange` ponctuel sur une voie, avec `dir` (up/down), `vMax`, et rattaché à un `speedProfile` par catégorie (profils « croissants » et « décroissants » superposables) ; `trainRelation` dit si le changement vaut pour la tête ou la queue | oui | [RAILML] | 1 (spécification) |
| OSRD (SNCF Réseau, libre) | `SpeedSection` : zone avec `track_ranges` (voie, début, fin, `applicable_directions`), `speed_limit`, `speed_limit_by_tag` ; les zones peuvent se chevaucher ; un signal d'annonce référence la zone qu'il annonce | oui (étiquettes) | [OSRD], [OSRD-EX] | C |
| RailSys | non documenté publiquement, non trouvé | — | — | — |

Lecture : les jeux retiennent le panneau ponctuel parce qu'il se pose comme un objet de décor et se lit en parcourant la voie ; son défaut est de ne pas avoir de fin (oubli de la « reprise ») et de mal gérer les deux sens. Les outils d'étude retiennent la zone parce qu'elle a un début, une fin, un sens, qu'elle se superpose à un plafond et qu'elle porte une valeur par catégorie. Tous appliquent la même règle tête/queue que la réglementation française.

## 10. Modèle recommandé pour le simulateur

Le dépôt a déjà des sections typées (`SectionType` : `circulation`, `station_stop`, `siding`, `yard`), un sens par section (`SectionDirection`), un `frogNumber` par appareil de voie et un `maxSpeed` par matériel : le modèle ci-dessous s'appuie dessus. Les valeurs marquées E sont des choix de ma part.

Limite applicable en un point = minimum de : vitesse maximale du train, plafond du type de voie, toutes les zones de vitesse couvrant **une partie du train** (de la tête à la queue), vitesse de l'aiguille prise en déviation.

### Version minimale

| Notion | Proposition |
|---|---|
| Plafond par type de voie | `yard` 30 ; `siding` 60 ; `circulation` 160 par défaut, réglable ; `station_stop` hérite de la ligne (E, faute de règle trouvée) |
| Type de ligne (préréglage du plafond de circulation) | LGV 320 ; LGV 300 ; classique 220 ; classique 160 ; secondaire 100 ; voie de service 30 |
| Zone de vitesse | `{ id, vitesse km/h, début (segId, t), fin (segId, t), sens : deux sens / direct / inverse }`, posée de A à B le long d'un chemin sans bifurcation ; valeurs par pas de 10 km/h, minimum 10 |
| Catégorie de train | aucune : une seule valeur par zone |
| Règle tête/queue | baisse à l'entrée de la tête, reprise quand la queue est sortie |
| Annonce | calculée, pas posée : pour chaque baisse en aval sur l'itinéraire, distance d'annonce = (v₁² − v₂²) / (2 × 0,7 m/s²), plancher 300 m (E, calé sur les repères du § 4) ; le HUD affiche limite en cours, prochaine limite plus basse et distance |
| Dessin en vue de dessus | TIV à distance au point d'annonce, pancarte Z au début, pancarte R à la fin, du côté gauche dans le sens de marche |
| Aiguilles en déviation | par tangente (1 / `frogNumber`) : ≥ 0,11 → 30 ; 0,085 → 60 ; 0,05 → 90 ; 0,034 → 120 ; 1/46 → 160 ; 1/65 → 220 (valeurs basses retenues là où les sources divergent) |

### Version plus complète

| Ajout | Détail |
|---|---|
| Valeur par catégorie | `vitesseParCatégorie` facultatif sur la zone, à la manière d'OSRD ; catégories utiles : `grande_vitesse`, `automoteur`, `voyageurs_remorqué`, `fret` ; dessin par TIV type B / C groupés |
| Zones temporaires (LTV) | drapeau `temporaire` : mêmes données, tableaux ronds, disque jaune si ≤ 40 |
| Mode cabine sur LGV | sur une voie de type LGV, pas de panneaux : repères de canton tous les 1 500 m et, dans le HUD, afficheur TVM (taux d'exécution, taux d'annonce, clignotement quand le canton suivant est plus restrictif), les limites étant arrondies au taux TVM inférieur |
| Annonce par signaux | ralentissement 30 / 60 et rappel sur les signaux du cantonnement, à coordonner avec l'autre recherche |
| Survitesse | alerte à +5 km/h, freinage d'urgence à +10 km/h (KVB) ; +15 km/h au-dessus de 200 sur LGV (COVIT) |
| Préannonce | tableau P et feu vert clignotant pour les trains à plus de 160 km/h sur ligne classique |

### À simplifier ou à laisser hors périmètre

- TIV pentagonaux, pancarte L, TIV à deux nombres MA 100, pendulaires : hors périmètre.
- Courbes de freinage KVB, vitesses d'approche 30/10 des signaux fermés : relèvent du cantonnement.
- Profil en long dans la distance d'annonce : à ignorer d'abord (le réel en tient compte).
- Repère d'approche, repère de proximité, crocodile et répétition des signaux : hors périmètre.

## 11. Dessin des panneaux utiles

Tous les tableaux sont implantés à gauche de la voie dans le sens de marche (à droite en Alsace-Moselle) [DOCRAIL], [WP-SIG]. En vue de dessus, le plus sobre est un petit pictogramme orienté face au train, relié à la voie par un trait.

| Panneau | Forme | Fond | Texte |
|---|---|---|---|
| TIV à distance, chute < 40 km/h | carré | blanc, liseré noir | vitesse en km/h, noir |
| TIV à distance, chute ≥ 40 km/h | losange (carré sur la pointe) | blanc, liseré noir | vitesse, noir |
| Pancarte Z | rectangle | noir | « Z » blanc |
| Pancarte R | rectangle | noir | « R » blanc |
| TIV de rappel / d'exécution | carré | noir | vitesse, blanc |
| TIV type B | demi-disque, bord droit en haut, courbure en bas | blanc | vitesse, noir |
| TIV type C | demi-disque, courbure en haut, bord droit en bas | blanc | vitesse, noir |
| Pancarte Km | rectangle | blanc | « Km » et PK à une décimale, noir |
| TIV de chantier à distance | disque | blanc | vitesse, noir ; disque jaune à feu jaune au-dessus si ≤ 40 |
| TIV de chantier d'exécution | disque | noir | vitesse, blanc |
| Fin de chantier | disque | blanc | aucun |
| Tableau P | carré | blanc | « P » noir |
| Ralentissement 30 / 60 | cible de signal | noir | 2 feux jaunes côte à côte, fixes / clignotants |
| Rappel 30 / 60 | cible de signal | noir | 2 feux jaunes l'un au-dessus de l'autre, fixes / clignotants |
| Repère de canton TVM | jalon carré | bleu | triangle jaune dont la pointe désigne la voie |

HUD, façon TVM : case d'**annonce** = chiffres noirs sur losange ou carré blanc ; case d'**exécution** = chiffres blancs sur fond noir ; vitesse de fond de ligne sur fond vert ; « 000 » sur fond rouge ; clignotement = prochaine indication plus restrictive. Pour une ligne classique, reprendre les mêmes codes que les tableaux : prochaine limite en noir sur blanc (losange), limite en cours en blanc sur noir.

## 12. Non trouvé ou contradictoire

- **Table des distances de ralentissement** (distance d'annonce d'un TIV selon vitesse d'approche, vitesse visée et déclivité) : non trouvée. Elle figure vraisemblablement dans un référentiel d'implantation de SNCF Réseau non public. La formule du § 10 est une estimation.
- **Seuil de baisse dispensant d'annonce** : aucun trouvé ; seul le seuil de 40 km/h pour le losange à crocodile est établi.
- **Tangente → vitesse** : deux tables non officielles et divergentes (0,11 : 30 ou 40 ; 0,085 : 60 ou 70 ; 0,05 : 90 ou 100). 80 et 170 km/h non retrouvés ; 230 km/h cité par Wikipédia sans tangente associée.
- **Losange ou carré** : le S1A lie le losange à la présence du crocodile, les sites spécialisés à une chute d'au moins 40 km/h (Wikipédia écrit « supérieure à 40 »). Les deux se recoupent mais le seuil exact (≥ ou >) n'est pas tranché par le texte réglementaire lu.
- **Couleurs de l'afficheur TVM** : Wikipédia décrit le fond de ligne en « chiffres blancs sur fond vert » ; le texte EPSF ne décrit que l'annonce (noir sur blanc) et l'arrêt (noir sur rouge), ses figures étant perdues à l'extraction. Couleur des chiffres sur fond vert à vérifier sur photo.
- **Nombre de cantons d'une séquence d'arrêt** : « 5 cantons, 10 000 m » [LSF-TVM] contre « 6 ou 7 cantons, environ 10 km » [WP-TVM] ; seule la distance concorde.
- **Vitesse en gare et à quai**, **vitesses des Intercités / Transilien / fret**, **groupes UIC**, **RailSys** : non trouvés ou non vérifiés.
- **Valeur par voie et par sens dans les RT** : affirmée par un site, aucun RT réel consulté.
- **Couleurs des chevrons** : non décrites dans le texte extrait.
- Version des textes : le S1A lu est l'édition SNCF de 2005 (IN 1482), le S1C celle de 2003 ; le texte en vigueur est l'annexe VII de l'arrêté du 19 mars 2012, dont je n'ai lu que les compléments EPSF de 2026, concordants.
- Deux résumés automatiques de moteur de recherche étaient faux et ont été écartés après lecture des sources : « TIV à distance implanté à 100 m » (c'est le TIV de chantier de la ligne du Blanc-Argent) et « distance limitée à 500 m » (ligne de Cerdagne) [EPSF-011].

## Sources

- [S1A] SNCF, règlement S1A titre I « Signalisation au sol », IN 1482, 2005 — https://www.jonroma.net/media/rail/opdocs/world/france/S%201%20A%20I-%20Signalisation%20au%20sol.pdf
- [S1C] SNCF, règlement S1C « Répétition des signaux, contrôles de vitesse et de franchissement », IN 1493, 2003 — https://www.jonroma.net/media/rail/opdocs/world/france/S%201%20C%E2%80%93%20Re%CC%81pe%CC%81tition%20des%20signaux%20-%20Contro%CC%82les%20de%20vitesse%20et%20de%20franchissment.pdf
- [EPSF-012] Dispositions complémentaires à l'annexe VII, signalisation au sol, version 4 du 21-01-2026 — https://www.securite-ferroviaire.fr/sites/default/files/reglementations/pdf/2026-06/RFN-IG-SE-01-A-00-num-12-V4-Dispositions-complementaires-annexe-VII-arret%C3%A9-19032012-Signalisation-au-sol-et-signalisation-a-main.pdf
- [EPSF-011] Signaux non repris à l'arrêté du 19 mars 2012 — https://www.securite-ferroviaire.fr/sites/default/files/reglementations/pdf/2023-03/rfn-ig-se-01-00-num-011-v3.pdf
- [EPSF-TVM] Signalisation de cabine du type TVM, RFN-IG-SE 01 A-00-n°013 — https://www.securite-ferroviaire.fr/sites/default/files/reglementations/pdf/2023-03/rfn-ig-se-01-00-num-013.pdf
- [EPSF-RC7A] Règles de composition, freinage, vitesse limite et masse des trains, RC A-B 7a n°1 version 6 — https://www.securite-ferroviaire.fr/sites/default/files/reglementations/pdf/2023-03/rc-ab-7a-num-1-v6.pdf
- [EPSF-PEDA] Document pédagogique « Les signaux, les régimes d'exploitation, les systèmes d'espacement », 2017 — https://www.securite-ferroviaire.fr/sites/default/files/reglementations/pdf/2023-03/document-pedagogique-signaux-regimes-exploitation-v1.pdf
- [EPSF-SYS] « Le système ferroviaire français » — https://www.securite-ferroviaire.fr/espace-grand-public/le-systeme-ferroviaire-francais
- [OPENDATA] SNCF Réseau, « Vitesse maximale nominale sur ligne » — https://ressources.data.sncf.com/explore/dataset/vitesse-maximale-nominale-sur-ligne/information/
- [DOCRAIL] « Les Tableaux Indicateurs de Vitesses ou TIV » — https://docrail.fr/les-tableaux-indicateurs-de-vitesses-ou-tiv/
- [LSF-LPV] http://lesiteferroviaire.free.fr/lpv.htm — [LSF-LTV] http://lesiteferroviaire.free.fr/ltv.htm — [LSF-KVB] http://lesiteferroviaire.free.fr/kvb.htm — [LSF-TVM] http://lesiteferroviaire.free.fr/TVM%20430.htm et http://lesiteferroviaire.free.fr/La%20TVM%20300.htm — [LSF-VOIES] http://lesiteferroviaire.free.fr/les%20differents%20types%20de%20voie.htm — [LSF-VS] http://lesiteferroviaire.free.fr/Circulation%20sur%20voie%20de%20service.htm — [LSF-PRE] http://lesiteferroviaire.free.fr/la%20preannonce.htm — [LSF-DIST] http://lesiteferroviaire.free.fr/distance%20d_arret%20ralentisseme.htm
- [WP-TVM] https://fr.wikipedia.org/wiki/Transmission_voie-machine — [WP-SIG] https://fr.wikipedia.org/wiki/Signalisation_ferroviaire_en_France — [WP-RAL] https://fr.wikipedia.org/wiki/Ralentissement_(signalisation_ferroviaire) — [WP-KVB] https://fr.wikipedia.org/wiki/Contrôle_de_vitesse_par_balises — [WP-ADV] https://fr.wikipedia.org/wiki/Appareil_de_voie — [WP-PN] https://fr.wikipedia.org/wiki/Passage_à_niveau_en_France — matériels : https://fr.wikipedia.org/wiki/TGV_M , https://fr.wikipedia.org/wiki/TGV_Duplex , https://fr.wikipedia.org/wiki/Régiolis
- [ADV-OB] https://cheminot-transport.over-blog.com/2023/11/les-appareils-de-voie-premiere-partie.html — [ADV-FORUM] https://www.cheminots.net/topic/19684-vitesse-de-franchissement-d-appareil-de-voie/
- [OR] https://open-rails.readthedocs.io/en/latest/operation.html — [BVE] https://openbve-project.net/documentation/HTML/route_csv.html — [TRAINZ] https://forums.auran.com/threads/range-distance-for-a-speed-limit-sign.159750/ — [TSC] https://www.christrains.com/tscdevdocs/reference-manual/content-basics/track-rules-setup/creating-track-rules.html
- [RAILML] https://wiki2.railml.org/wiki/IS:speedChange et https://wiki2.railml.org/wiki/IS:speedProfile — [OSRD] https://osrd.fr/en/docs/reference/design-docs/signaling/speed-limits/ — [OSRD-EX] https://osrd.fr/en/docs/explanation/models/data-models-full-example/
