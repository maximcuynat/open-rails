# Tâches

Nettoyé le 2026-10-05 : les chantiers terminés ont été retirés (leur plan et leur revue restent dans l'historique git de ce fichier). Ne restent que le chantier en cours, ce qui est encore à faire et les défauts connus.

---

# Fait — Physique de conduite réaliste (commit `a2fdd8b`)

Branche `feature/driving-physics` (partie de `developement`). Plan validé le 2026-10-05, rédigé après recherche. Sources et chiffres détaillés : `tasks/recherche-traction.md`, `tasks/recherche-freinage.md` ; script de référence : `tasks/recherche-traction-sim.py`. Pas de commit tant que l'utilisateur ne le demande pas.

## Ce qui change pour le joueur

- Le train a une masse, une puissance et une résistance à l'avancement : il accélère fort au départ, de moins en moins vite ensuite (0 → 300 km/h en près de 5 minutes pour un Duplex), et ralentit tout seul très lentement en roue libre.
- La pente compte, en montée comme en descente : 35 ‰ retirent ou ajoutent 0,34 m/s². Un Duplex à pleine puissance ne tient qu'environ 185 km/h dans une rampe de 35 ‰.
- Le frein est un frein à air : on serre et on desserre, la pression de la conduite générale descend ou remonte, les cylindres suivent avec un délai. Un arrêt d'urgence depuis 300 km/h prend 3,3 km et 74 s, pas 170 m.
- À l'arrêt sur une rampe, un train frein desserré part en dérive. En entrant en conduite, tous les trains sont freins serrés : il faut desserrer pour partir.

## Modèle

Équation (sens positif = sens de marche) : `k · m · dv/dt = F_traction − F_frein − R(v) − F_pente − F_courbe`

| Terme | Formule | Origine |
|---|---|---|
| Masses tournantes | `k = 1,04` | thèse Bosquet, confirmé |
| Traction | `F = commande × min(F_max, P/v, μ(v) · m_adhérente · g)`, nulle sans motrice et au-delà de la vitesse maximale | fiches Alstom / SNCF |
| Adhérence (rail sec) | `μ = 7,5/(V+44) + 0,161`, V en km/h, plafonnée à 0,30 | Curtius-Kniffler |
| Résistance | `R = A + B·v + C·v²` ; A et B suivent la masse, C la longueur de la rame | base SNCF Thor (Dasye) |
| Pente | `F = m · g · (z_tête − z_queue) / L_rame` : moyenne sur toute la rame, adoucit les cassures de profil | usage courant, forme retenue par nous |
| Courbe | `F = m · g · 0,8 / R` (R en m) : négligeable sur LGV, sensible sous 1 000 m | Rochard & Schmid |
| Frein | décélération visée selon la vitesse × remplissage des cylindres, plafonnée par l'adhérence (`0,15 g`, décroissante au-delà de 250 km/h) | STI, EPSF |

Forces dissipatives (frein, résistance) : elles s'opposent au mouvement et, à l'arrêt, retiennent le train jusqu'à leur maximum. C'est ce qui permet à la fois la tenue en pente frein serré et la dérive frein desserré.

### Données par modèle (`rollingStock.ts`)

| | TGV Duplex | TGV M | Confiance |
|---|---|---|---|
| Motrice : masse / puissance / effort max | 68 t / 4 400 kW / 106 kN | 68 t / 3 880 kW / 122 kN | Duplex confirmé ; effort du TGV M non sourcé |
| Remorque : masse en charge | 36 t (rame de 424 t) | ≈ 46 t (rame de 460 t estimée) | TGV M estimé |
| Résistance, rame complète | A 2 680 N, B 115 N·s/m, C 6,93 N·s²/m² | A 2 910, B 125, C 6,03 | Duplex : une source solide ; TGV M estimé |
| Vitesse maximale | 320 km/h | 320 km/h | confirmé |

Masse, puissance, effort et résistance d'une rame sont **calculés à la demande** à partir de ses véhicules (aucune valeur en cache : les rames sont recomposées à huit endroits du code). Une rame sans motrice n'a aucun effort ; deux rames attelées additionnent tout.

### Frein à air

- État par train : pression de la **conduite générale** (5,0 bar desserré, 4,5 bar à la première dépression, 3,5 bar au serrage maximal, 0 en urgence) et remplissage des **cylindres de frein** (0 à 100 %, affiché en bar).
- Commande à impulsions, comme le robinet réel et comme Train Sim World : tant que « serrer » est tenu, la conduite se vide (à fond en 3,5 s) ; tant que « desserrer » est tenu, elle se regonfle (à fond en 4 s) ; relâché, la pression reste où elle est.
- Les cylindres suivent la dépression avec un délai (temps mort 0,5 s, montée 3 s, desserrage 4 à 5 s) : c'est ce délai qui donne les distances d'arrêt réelles.
- Décélération visée, rail sec, en palier (m/s²) :

| | > 300 km/h | 300–230 | 230–170 | < 170 |
|---|---|---|---|---|
| Serrage maximal de service | 0,75 | 0,85 | 1,00 | 1,10 |
| Urgence | 0,81 | 0,98 | 1,14 | 1,30 |

  Interpolée entre les tranches, proportionnelle au remplissage des cylindres. Ces valeurs sont des décélérations totales : la résistance à l'avancement en est retranchée pour ne pas la compter deux fois.
- Urgence : vidange de la conduite, traction coupée, desserrage impossible avant l'arrêt (verrou actuel conservé).
- La traction est coupée dès que le frein est serré, comme sur le matériel réel.

### Traction

- Le manipulateur garde ses crans, de N à P5 (20 % d'effort par cran). Les crans négatifs B1…B5 disparaissent : le frein a ses propres touches. (Revenus depuis comme frein électrique, voir le chantier suivant.)
- L'effort monte progressivement (0 à 100 % en 5 s), pas d'à-coup.
- L'inverseur garde ses règles (changement à l'arrêt seulement). Il fixe le sens de l'effort moteur ; le sens réel du mouvement peut s'en écarter quand la rame dérive.

### Intégration

- Pas de calcul fixe d'au plus 1/30 s : un pas d'affichage long est découpé, le résultat ne dépend plus de la fluidité.
- La vitesse reste positive avec un sens séparé, comme aujourd'hui ; le sens bascule tout seul quand la rame repart en arrière.
- Tous les trains sont simulés en conduite, y compris à l'arrêt (aujourd'hui un train arrêté sans traction est ignoré).

## Touches (réassignables)

| Action | Défaut | Aujourd'hui |
|---|---|---|
| Traction : un cran de plus / de moins | A / D (et ↑ / ↓) | inchangé, mais D ne descend plus sous N |
| Serrer le frein (maintenu) | E | nouveau |
| Desserrer le frein (maintenu) | Q | nouveau |
| Freinage d'urgence | Retour arrière | inchangé |
| Inverseur | W / S | inchangé |

Les lettres désignent la position des touches (clavier QWERTY), comme pour les commandes actuelles.

## Étapes

### Socle commun (moi, avant les agents)

- [x] 0.1 Types et signatures : données physiques dans `RollingStockSpec`, état du frein dans `TrainSet` (`brakePipe`, `brakeCylinder`, commande de frein, effort appliqué), `DrivingEnvironment` (`levelHeight`), `TrainDynamics` (forces, accélération réelle, pente, pressions, distance d'arrêt, accélération transversale)
- [x] 0.2 Script de référence de la recherche (`sim.py`) recopié dans `tasks/` pour vérifier l'implémentation contre les mêmes chiffres

### Agent A — domaine

- [x] A1. `rollingStock.ts` : données par modèle, `consistMass`, `consistPower`, `consistMaxEffort`, `adhesiveMass`, `consistResistance(v)` ; tests (rame de 424 t, 8 800 kW, 212 kN ; R(300) ≈ 60 kN, R(100) ≈ 11 kN)
- [x] A2. Forces (`train.ts` ou un fichier `trainDynamics.ts`) : traction, adhérence, résistance, pente moyennée sur la rame, courbe ; `trainDynamics(net, train, env)` renvoie le détail
- [x] A3. Frein à air : conduite générale, cylindres, décélération visée par vitesse, plafond d'adhérence, urgence
- [x] A4. Intégration : pas fixe, forces dissipatives qui retiennent à l'arrêt, basculement du sens en dérive, vitesse ramenée exactement à zéro quand le frein tient
- [x] A5. `tickTrainSet` et `advanceTrainSet` : collision vérifiée aussi quand la rame recule en dérive ; butoir et obstacle retiennent la rame sans tremblement ; vitesse du choc renvoyée
- [x] A6. `stoppingDistance` par intégration (serrage maximal de service, délai compris, pente actuelle) ; accélération transversale `v²/R` exposée par véhicule (point d'accroche du futur plan dévers)
- [x] A7. Commandes : cran de traction 0…5, serrer / desserrer, urgence ; état de départ « frein serré » ; `resetTrainControls`, attelage, dételage et changement de cabine remis d'aplomb
- [x] A8. Tests de contrôle (voir plus bas) et réécriture des 13 tests qui figent les valeurs actuelles

### Agent B — store, clavier, HUD, rendu

- [x] B1. Boucle du store : tous les trains simulés en conduite, `levelHeight` transmis, fin de l'arrêt net imposé par le store, entrée en conduite freins serrés
- [x] B2. Clavier : actions « serrer » et « desserrer » maintenues (appui / relâchement), catalogue de raccourcis, fenêtre d'aide
- [x] B3. HUD : deux manomètres (conduite générale, cylindres de frein), effort de traction en %, accélération **réelle**, pente sous la rame en ‰, distance d'arrêt réelle dans l'unité du projet, cadran gradué jusqu'à la vitesse maximale du modèle
- [x] B4. Rendu debug : vecteur d'accélération et ruban d'arrêt lus dans `TrainDynamics` (corrige au passage la distance d'arrêt infinie hors freinage)
- [x] B5. Choc contre un butoir ou un autre train au-dessus de quelques km/h : message à l'écran
- [x] B6. Tests du store et du clavier

### Vérification finale

- [x] `npm test`, `npm run typecheck`, `npm run build`, relecture du diff
- [x] Comparaison au script de référence : mêmes temps et distances à 2 % près
- [x] Navigateur sans écran : départ freins serrés, desserrage, traction P5, serrage, urgence, manomètres
- [ ] Contrôle à l'œil par l'utilisateur : rampe de 35 ‰ dans les deux sens, dérive frein desserré, choc contre un heurtoir, boutons du HUD à la souris, lisibilité des manomètres

## Tests de contrôle

Chiffres réels ou réglementaires :

| Test | Attendu | Origine |
|---|---|---|
| Urgence 300 → 0, palier | 3 300 m ± 5 %, ≈ 74 s | TGV réel, KTX-I |
| Urgence 200 → 0 / 250 → 0 / 160 → 0 | ≤ 1 500 / 2 430 / 1 250 m | STI, EPSF |
| Serrage maximal de service 320 → 0 | ≤ 5 300 m | EPSF (lignes TVM) |
| Urgence à 230 km/h en descente de 35 ‰ | la rame s'arrête | cas d'étude EPSF |
| Accélération moyenne 0–40 / 0–120 / 0–160 km/h | ≥ 0,40 / 0,32 / 0,17 m/s² | STI |
| Accélération résiduelle à 320 km/h | ≥ 0,05 m/s² | STI |
| Résistance à 300 et 100 km/h | ≈ 60 et ≈ 12 kN | SNCF |
| Rampe de 35 ‰ sur une rame de 430 t | 148 kN | calcul, repris dans la thèse |

Chiffres du modèle de référence (à reproduire, pas des mesures) : Duplex 0 → 300 km/h en 289 s sur 15,3 km ; vitesse d'équilibre de 184 km/h en rampe de 35 ‰ ; roue libre depuis 300 km/h : 250 km/h après 119 s et 9 km.

Comportements : frein serré, la rame tient sur 35 ‰ ; frein desserré sans traction, elle part en arrière ; P5 la fait démarrer en rampe de 35 ‰ ; une rame sans motrice ne tracte pas ; même résultat à 1 % près avec un pas d'affichage de 1/60 s ou de 0,1 s.

## Revue (2026-10-05)

- `npm test` : 889 tests verts (45 fichiers, fichiers d'une autre session compris) ; `npm run typecheck` et `npm run build` verts, relancés après relecture.
- Tests de contrôle, tous verts : urgence 300 → 0 en 3 344 m et 73,8 s (attendu 3 300 m ± 5 %, 74 s) ; urgence 200 / 250 / 160 → 0 en 1 365 / 2 193 / 870 m ; service maximal 320 → 0 en 4 450 m ; Duplex 0 → 300 km/h en 291,5 s sur 15,26 km (référence 289 s, 15,3 km) ; équilibre à 184 km/h en rampe de 35 ‰ ; résistance 60,4 kN à 300 km/h ; même résultat à 0,2 % près entre un pas de 1/60 s et de 0,1 s.
- Vu dans un navigateur sans écran, avec une motrice seule : entrée en conduite freins serrés (3,5 bar, cylindres pleins), desserrage en maintenant Q (5,0 bar, cylindres vides), P5 jusqu'à 32 km/h, serrage en maintenant E (3,9 bar, cylindres à 2,5 bar, −0,73 m/s²), urgence (conduite à 0). Aucune erreur dans la console.
- Non vu à l'écran : rampe et dérive, choc contre un heurtoir, boutons serrer / desserrer à la souris, vue debug.
- Ajouté à la relecture : la distance d'arrêt s'affiche en mètres puis en kilomètres quelle que soit l'unité du projet (« 3,3 km », pas « 3300000 mm »).
- Écarts au plan :
  - remorque du TGV M à 36 t (le tableau du plan se contredisait : 46 t par remorque donnent 550 t, pas 460 t) ;
  - au-delà de la vitesse maximale, l'effort s'efface sur une bande étroite au lieu d'être coupé net (sinon l'accélération oscille) ;
  - un desserrage lâché au-dessus de 4,5 bar se termine seul, pour qu'un reste de pression ne coupe pas la traction sans que le joueur le voie ;
  - sortie d'urgence : la conduite revient directement à 3,5 bar ;
  - le message de choc passe par un rappel posé par le HUD, pour ne pas faire dépendre le store de l'interface.
- Restes connus : voir « Conduite » dans les défauts connus.

## Décisions prises

- **Crans de traction conservés**, frein à touches séparées (le manipulateur réel est continu ; les crans restent plus jouables au clavier).
- **Freins serrés à l'entrée en conduite** plutôt qu'une retenue automatique : c'est le comportement réel, et ça évite qu'un train posé sur une rampe parte tout seul.
- **TGV M** : mêmes courbes de freinage que le Duplex, masse et résistance estimées. Presque rien n'est publié ; les valeurs sont étiquetées comme estimées dans le code.
- **Ancienne `Locomotive`** : laissée telle quelle avec sa physique d'arcade. Elle n'est plus accessible depuis l'interface ; la retirer est un nettoyage à part.
- **Échelles HO / N** : les trains restent en dimensions et vitesses réelles quelle que soit l'échelle, comme aujourd'hui. La physique n'est juste qu'en 1:1.

## Hors périmètre

- Dévers et vitesse limite en courbe : plan dédié ci-dessous
- Vitesse imposée (régulateur de vitesse du TGV), répartition frein électrique / frein à disques, rail mouillé
- Raccordement vertical arrondi au pied et au sommet d'une rampe
- Pilotage depuis un téléphone (voir « Idées notées »)
- Mise à l'échelle des trains en HO / N ; retrait de l'ancienne `Locomotive`

---

# Fait — Frein électrique sur les crans négatifs du manipulateur (2026-10-05)

Branche `feature/driving-physics`, pas encore commité. Les crans B1…B5 retirés par `a2fdd8b` reviennent, cette fois comme frein électrique (rhéostatique) des motrices, en plus du frein à air. Chiffres : `tasks/recherche-freinage.md` §3.

## Ce qui change pour le joueur

- Le manipulateur va de B5 à P5. D / ↓ descend sous N, A / ↑ remonte ; un cran par appui.
- B1…B5 : 20 % de l'effort de frein électrique par cran. Le HUD affiche « B3 · 60 % » en ambre.
- Le frein électrique s'efface entre 30 et 10 km/h : pour s'arrêter et tenir à l'arrêt, il faut toujours le frein à air.
- Le frein à air est inchangé (E / Q, manomètres). Les deux s'additionnent. L'urgence ramène le manipulateur sur N.

## Modèle

- Effort maximal : 30 kN par bogie moteur sur Duplex, soit 60 kN par motrice et 120 kN par rame. TGV M : 60 kN par motrice, estimé.
- `F(v) = min(F_max, P / v) × effacement(v)`, plafonné par l'adhérence des essieux moteurs. `P` = puissance de traction (estimé, non publié) ; effacement linéaire de 30 à 10 km/h (estimé).
- Montée en 4 s (≈ 30 kN/s), descente en 1 s ; il ne monte qu'une fois la traction retombée à zéro.
- Indépendant de l'inverseur, nul sans motrice. Force dissipative : il ne fait jamais repartir la rame en arrière.
- Frein à air et frein électrique se partagent l'adhérence de la rame, le frein à air servi en premier.
- L'inverseur est verrouillé dès que le manipulateur n'est pas sur N.

## Étapes

- [x] 1. `rollingStock.ts` : `electricBrakeEffort` par motrice, `consistElectricBrakeEffort`
- [x] 2. `trainDynamics.ts` : `availableElectricBrake`, `stepElectricBrake`, force dans `computeForces`, `electricBrakeForce` et `electricBrakeEffort` dans `TrainDynamics`
- [x] 3. `train.ts` : champ `electricBrakeEffort`, `MIN_NOTCH`, bornes de `setNotch`, inverseur, urgence, remise à zéro
- [x] 4. Store et clavier : bornes B5…P5, libellés « Manipulateur »
- [x] 5. HUD (champ ambre « B3 · 60 % »), fenêtre des raccourcis, état « freinage » du debug
- [x] 6. Tests et vérification

## Revue

- `npm test` : 914 tests verts (45 fichiers) ; `npm run typecheck` et `npm run build` verts.
- Tests de contrôle, rame Duplex à B5 : 120 kN à 200 km/h, 105,6 kN à 300 km/h, 60 kN à 20 km/h, 0 à 10 km/h et en dessous ; −0,34 m/s² à 200 km/h en palier ; vitesse tenue vers 180 km/h en descente de 35 ‰ (sans lui la rame dépasse 250 km/h en 5 min) ; depuis 100 km/h la rame passe sous 10 km/h puis continue de rouler ; à l'arrêt sur une rampe elle dérive ; même résultat à 1 % près à 60 et à 10 images par seconde.
- Vu dans un navigateur sans écran, motrice seule lancée à 144 km/h : cinq appuis sur D donnent B5, l'effort monte à 60 kN en 4 s (−0,88 m/s²), 29 kN à 20 km/h, 0 à 8 km/h ; trois appuis sur A donnent B2 ; champ « B2 · 40 % » en ambre. Aucune erreur dans la console.
- Non vu à l'écran : boutons − / + du HUD à la souris, vue debug, rame complète.
- Restes connus : voir « Conduite » dans les défauts connus.

## Hors périmètre

- Conjugaison automatique frein électrique / frein à air, frein électrique en urgence
- Frein électrique dans la distance d'arrêt affichée (elle suppose le frein à air seul)
- Console adaptative et pupitre sur téléphone : leur plan devra borner « cran fixé » à B5…P5

---

# À valider — Niveaux de détail au dézoom (plan du 2026-10-05)

Demande : plus on dézoome, plus le dessin se simplifie, comme une carte en ligne. La vue rapprochée ne change pas.

## Constat

- Le seul palier existant (`SIMPLIFY_THRESHOLD`) ne s'active que sous 0,05 px/m. Entre 0,05 et environ 1,5 px/m, les deux files de rail sont à moins de 2 px l'une de l'autre : on voit un seul trait, mais on paie quatre tracés par rail, les raccords à chaque nœud, un rond par nœud et un heurtoir par bout de voie.
- Tous les seuils (0,05 ; 0,8 ; 0,9 ; 1,0 ; 3,0) sont en px/m, réglés pour le 1:1. En HO (350 px/m par défaut) ils ne se déclenchent jamais.
- Les ronds de nœud gardent leur taille à l'écran : en vue d'ensemble ils couvrent la voie.
- Les trains n'ont aucun palier : bogies et détails sont tracés quelle que soit leur taille à l'écran.

## Principe

Le palier dépend de l'écartement **à l'écran** (`écartement × échelle`, en pixels), pas de l'échelle brute : il vaut donc pour toutes les échelles de modélisme. Une seule fonction pure `trackLod(cam, gauge)` dans `render/lod.ts` ; tous les seuils au même endroit.

| Palier | Écartement à l'écran | Voies | Par-dessus |
|---|---|---|---|
| Détail | ≥ 3 px | comme aujourd'hui, inchangé | comme aujourd'hui |
| Ligne | 0,5 à 3 px | un trait par rail, de la largeur qu'occupaient les deux files (pas de saut visible au passage), tracés regroupés par style, plus de raccords | nœuds : seulement les sélectionnés et les bouts de voie ; heurtoirs masqués ; une flèche de sens par section |
| Schéma | < 0,5 px | une polyligne par section, points à moins d'un pixel fusionnés, courbes plates tracées droites : le coût suit le nombre de sections, plus le nombre de rails | aucun nœud ; diagnostics regroupés en pastilles avec un compteur ; badges des sections renommées ou sélectionnées seulement |

Dans tous les paliers : un badge qui en recouvrirait un autre n'est pas dessiné (priorité : sélectionné, renommé, puis le plus long).

## Étapes

- [ ] 0. Banc de mesure gardé dans le dépôt (hors de `npm test`) : temps par image à cinq zooms sur 1 000 et 4 000 rails, avec le détail par couche ; relevé de départ
- [ ] 1. `render/lod.ts` : `trackLod`, seuils en pixels, tests à 1:1 et en HO ; remplacer les comparaisons à `cam.scale` de `renderNetwork` par ce palier (sans changer ce qui s'affiche en 1:1 au zoom par défaut)
- [ ] 2. Palier Ligne : trait unique par rail, regroupé par style (normal, sélectionné, branche fermée, tunnel), halo de pont ; tests du nombre de tracés
- [ ] 3. Palier Ligne, par-dessus : nœuds, heurtoirs, flèches de sens
- [ ] 4. Palier Schéma : polylignes de section calculées une fois dans `networkDerived`, simplifiées selon le zoom ; tests
- [ ] 5. Badges sans recouvrement ; pastilles de diagnostics regroupés
- [ ] 6. Trains : silhouette sans bogies au palier Ligne, repère au palier Schéma ; vérifier qu'un train hors champ n'est pas tracé
- [ ] 7. Mesure finale, `npm test`, `npm run typecheck`, `npm run build`, contrôle dans le navigateur à chaque palier en 1:1 et en HO, captures avant/après aux seuils

Chaque étape est indépendante et peut être commitée seule ; 2 et 4 portent l'essentiel du gain.

## Points à trancher

- Couleur du trait au palier Ligne : couleur du rail (continuité avec la vue rapprochée, proposé) ou couleur de la section (comme le palier simplifié actuel) ? Au palier Schéma : couleur de la section.
- Nœuds masqués au dézoom : restent-ils cliquables ? Proposé : non, on ne saisit que ce qu'on voit ; la sélection par voie reste possible.
- Les rails sont tracés avec la constante `GAUGE` (1,435 m) et non l'écartement du projet : à vérifier en HO avant l'étape 1, le palier doit lire le même écartement que le tracé.

## Hors périmètre

- Index spatial pour le tri des rails visibles (utile seulement en vue rapprochée sur un très grand réseau)
- Tuiles ou image du réseau gardée en cache entre deux images

---

# Fait — Performance du rendu des voies et des sections (2026-10-05)

Demande : optimiser le rendu, sans rien changer à l'aspect (deux files de rail, pas de ballast ni de traverses). Modifications faites sur `feature/driving-physics`, à séparer au commit.

- [x] Mesure de départ (réseau de 4 000 rails, hors tracé du navigateur) : 21 ms par image en vue rapprochée, 76 ms réseau entier, 56 ms avec deux niveaux — dont 14 ms de `computeTrackSections` recalculé à chaque image et à chaque niveau
- [x] `render/networkDerived.ts` : sections, index rail → section, conflits de sens et diagnostics gardés d'une image à l'autre, recalculés seulement quand le réseau ou les réglages de section changent (comparaison exacte valeur par valeur, 0,35 ms pour 4 000 rails) ; 9 tests
- [x] `renderNetwork` : lit ce cache ; section sélectionnée trouvée par l'index au lieu d'un parcours de tous les rails de la section pour chaque rail
- [x] `Canvas.tsx` : les demandes de redessin d'une même image sont regroupées en un seul tracé (`redraw` dessinait deux fois : une fois lui-même, une fois par sa notification)
- [x] `npm test` (897), `npm run typecheck`, `npm run build` ; contrôle dans le navigateur sur 1 000 rails et deux niveaux

## Revue

Même réseau de 4 000 rails : 5 ms en vue rapprochée (était 21), 25 ms réseau entier (était 76), 7 ms avec deux niveaux (était 56). Dans le navigateur, 1 000 rails sur deux niveaux : 4,4 ms par image en vue rapprochée, 6 ms réseau entier ; 200 demandes de redessin dans la même image coûtent 4,7 ms au total.

Reste, non fait :
- Tracé groupé des rails (un seul `stroke` par style au lieu de quatre par rail) : c'est ce qui domine maintenant, mais l'ordre de superposition change légèrement aux traversées — à décider
- En vue à plusieurs niveaux, le tri des rails visibles est refait à chaque niveau
- Code de ballast, traverses, éclisses et détails de traversée : écrit, appelé par aucun rendu — à retirer ou à garder, au choix de l'utilisateur

---

# Prêt à lancer — Limites de vitesse posées sur la voie, dévers et déraillement

Plan rédigé le 2026-10-05 après recherche, corrigé avec les décisions de l'utilisateur ; **rien n'est codé, en attente de son feu vert**. Sources : `tasks/recherche-limites-vitesse.md`, `tasks/recherche-devers.md`, `tasks/audit-objets-de-voie.md`. 1:1 seulement. Branche dédiée à créer à partir de `developement`. Pas de commit tant que l'utilisateur ne le demande pas.

C'est le premier morceau du pan « signalisation » : il pose la brique commune — un objet attaché à la voie qui survit aux coupes et aux fusions de rails — dont les signaux se serviront ensuite (plan suivant).

## Ce qui change pour le joueur

- En construction, un outil **« Limite de vitesse »** : un clic sur la voie pour le début, un clic pour la fin, une vitesse. La zone se voit sur le canevas, se sélectionne, se modifie et se supprime.
- Le projet a une **vitesse de ligne** (plafond) choisie parmi des types réels : LGV 320, LGV 300, ligne classique 220, ligne classique 160, ligne secondaire 100, voie de service 30.
- Chaque courbe reçoit un **dévers** calculé d'après son rayon et la vitesse qui s'y applique, corrigeable à la main ; une courbe trop serrée impose sa propre vitesse.
- En conduite, le HUD affiche la **limite en cours** et la **prochaine limite plus basse avec sa distance**, comme les panneaux réels : annonce en noir sur blanc, limite en vigueur en blanc sur noir.
- Règle réelle reprise telle quelle : la vitesse basse doit être atteinte quand la **tête** entre dans la zone ; on ne réaccélère que quand la **queue** en est sortie.
- Courbe prise trop vite : inconfort, danger, puis **déraillement**, avec un bouton **« Remettre sur la voie »**.

## Barre d'outils de gauche : un mode « Signalisation »

Demande de l'utilisateur (2026-10-05). La barre de gauche a déjà deux contenus : les outils de voie, et un mode « train » qui remplace ses boutons (sélection, motrice, voiture, suppression — `isTrainMode` dans `ToolBar.tsx`, sous-modes `trainToolSubMode` du store). Les limites de vitesse puis les signaux prennent la même forme : un troisième contenu, « Signalisation », ouvert par un bouton de la barre.

- Dans ce plan, il contient : Sélection, Limite de vitesse, Supprimer.
- Il recevra ensuite les signaux, sans changer de place ni de logique : signal de block et signal de trajectoire au niveau simple, sémaphore, carré et repère de LGV au niveau réaliste (voir la feuille de route).
- Un seul sous-mode actif à la fois ; Échap revient à la sélection puis aux outils de voie, comme pour le mode train.

## Limite applicable en un point

La plus basse de : vitesse maximale du matériel, vitesse de ligne du projet, toutes les zones qui couvrent une partie de la rame (de la tête à la queue), vitesse maximale des courbes sous la rame.

## Brique commune : un objet qui suit la voie

Constat de l'audit : aujourd'hui rien ne suit la voie quand on la coupe. Une position est repérée par l'identifiant du rail, qui disparaît à chaque coupe, fusion ou réconciliation — y compris au chargement et à chaque annulation. Les trains eux-mêmes sont supprimés quand on coupe le rail sous eux.

Le seul mécanisme qui tient est celui des tables d'itinéraires des aiguillages : les quatre fonctions du domaine qui remplacent un rail (`splitSegment`, `splitSegmentAtNode`, `dissolveNode`, `removeDuplicateSegments`) préviennent les tables par `replaceJunctionRail`. On le généralise :

- un seul point de passage « ce rail est remplacé par ces morceaux, coupé à tel endroit », qui recale aussi les positions (`t` avant la coupe sur le premier morceau, après sur le second ; au prorata des longueurs pour une fusion ; sens retourné si le rail survivant est inversé) ;
- les objets de voie vivent **dans `Network`** (comme les tables d'itinéraires), pour être recalés par le domaine où que l'édition soit déclenchée (plus de vingt endroits dans l'interface) ;
- une zone est stockée comme la **liste des tronçons qu'elle couvre** (`TrackSpan { segId, t0, t1 }`, la forme déjà utilisée pour l'occupation des trains) : son trajet est figé à la pose, elle se dessine directement, et « quelle limite ici ? » se lit par un index par rail.

## Données

- **Projet** : `lineSpeed` (km/h) et `lineType` (`classique` ou `lgv`, pour les règles de dévers). Défaut : ligne classique à 160 km/h.
- **Zone de vitesse** (`net.speedZones`) : identifiant, vitesse (multiple de 10 km/h, 10 au minimum), tronçons couverts dans l'ordre de A vers B. Valable dans les deux sens de circulation.
- **Segment courbe** : `cant?` en mm, absent = dévers automatique.
- **Matériel** : insuffisance de dévers admise selon le type de ligne, seuil de renversement (estimés pour le TGV M).
- **Rame** : `derailed`, avec la vitesse et la limite au moment du déraillement.

## Modèle du dévers

Notations : `v` en m/s, `R` rayon en m, `d` dévers en mm, `e` distance entre les points de contact des deux roues (écartement + 65 mm, soit 1 500 mm en voie normale), `g` = 9,81.

| Grandeur | Formule | Origine |
|---|---|---|
| Dévers d'équilibre | `D_eq = e · v² / (g · R)` (forme pratique : `11,8 · V² / R`, V en km/h) | référentiel SNCF, confirmé |
| Insuffisance de dévers | `I = D_eq − d` | idem |
| Accélération transversale non compensée | `a_q = v²/R − g·d/e` (≈ `I / 153` m/s²) | idem |
| Vitesse maximale d'une courbe | `V = √((d + I_admise) · R / 11,8)` | idem |
| Renversement | quand `I ≥ I_renv`, avec `I_renv ≈ 525 mm` | calé sur Eckwersheim : **un seul accident, un seul matériel** |

#### Dévers automatique d'une courbe

```
D_eq = dévers d'équilibre à la vitesse de la ligne
d    = k · D_eq                      k = 0,5 sur ligne classique, 0,7 sur LGV
d    = au moins D_eq − I_admise      pour tenir la vitesse de la ligne si c'est possible
d    = au plus d_max et (R − 100)/2  d_max = 160 mm (classique), 180 mm (LGV)
d    = arrondi à 5 mm ; en dessous de 20 mm, pas de dévers
```

Si le dévers plafonné ne suffit pas, la courbe impose sa propre vitesse, plus basse que celle de la ligne.

#### Limites par type de ligne (TGV)

| | Ligne classique | LGV |
|---|---|---|
| Dévers maximal | 160 mm | 180 mm |
| Part du dévers d'équilibre (`k`) | 0,5 | 0,7 |
| Insuffisance admise | 160 mm jusqu'à 200 km/h, 150 mm au-delà | 130 mm jusqu'à 300 km/h, 80 mm au-delà |

Le `k` de 0,7 sur LGV n'a pas de source primaire (une courbe mesurée de la LGV Sud-Est le rend plausible) ; les insuffisances LGV viennent de la spécification européenne de 2008, le référentiel SNCF des LGV n'étant pas accessible.

#### Entrée et sortie de courbe

Le tracé n'a pas de courbes de raccordement : un alignement touche directement un arc. Règle minimale : le dévers monte linéairement sur une longueur `L = d · V / 180` (m, mm, km/h), à cheval sur le point de tangence, moitié dans l'alignement, moitié dans l'arc. Un arc trop court pour loger cette rampe voit son dévers réduit, donc sa vitesse aussi.

#### Seuils en conduite

| État | Condition | Effet |
|---|---|---|
| Normal | `I ≤ I_admise` | aucun |
| Inconfort | jusqu'à 230 mm | indicateur orange dans le HUD |
| Danger | au-delà de 300 mm | indicateur rouge |
| Renversement | `I ≥ 525 mm` | déraillement : arrêt d'urgence, rame inutilisable jusqu'à ce qu'on clique « Remettre sur la voie », message avec la vitesse et la limite |

Rapport entre vitesse de renversement et vitesse limite attendu : environ 1,5 sur ligne classique, 1,65 sur LGV.

## Étapes

### Phase 1 — Brique commune (un agent, avant le reste)

- [ ] 1.1 Point de passage unique « rail remplacé » dans le domaine, appelé par les quatre fonctions qui remplacent un rail ; les tables d'itinéraires passent par lui ; `splitSegment` fait remonter son point de coupe exact
- [ ] 1.2 Recalage d'un `TrackSpan` et d'une `TrackPosition` : coupe, fusion, rail inversé, doublon supprimé ; suppression d'un rail = tronçon retiré
- [ ] 1.3 `net.speedZones` : création, modification, suppression, nettoyage des zones vides, index `rail → zones` mis en cache
- [ ] 1.4 Chemin de A à B sur la voie, d'un point quelconque à un autre (enveloppe autour de `findPath`, qui ne va que de nœud à nœud) : refus si aucun chemin, plus court chemin sinon, aiguilles ignorées
- [ ] 1.5 Sauvegarde : zones écrites seulement s'il y en a, lues après la réconciliation du chargement, identifiants pris en compte par le compteur ; undo / redo
- [ ] 1.6 Tests : une zone survit à chaque opération (ciseaux, aiguillage posé dedans, croisement créé par une autre voie, nœud dissous, voie déplacée, changement de niveau, rechargement, annulation)

### Phase 2 — Agent A : domaine (limites, dévers, conduite)

- [ ] A1. `domain/models/cant.ts` : dévers d'équilibre, dévers automatique, vitesse maximale d'une courbe, insuffisance admise ; reconnaissance d'une courbe (suite de pièces de même sens et de rayon voisin) et rampe de dévers à ses deux bouts
- [ ] A2. Limite en un point de la voie et sous une rame (règle tête / queue) ; vitesse qui sert au dévers automatique d'une courbe = limite qui s'y applique
- [ ] A2 bis. Chevauchements : portions communes à deux zones, exposées pour le diagnostic et le panneau
- [ ] A3. Regard vers l'avant le long de l'itinéraire (aiguilles dans leur position du moment) : prochaine limite plus basse et sa distance, sur une portée d'au moins la distance d'arrêt
- [ ] A4. `trainDynamics` : `speedLimit`, `nextSpeedLimit` et sa distance, insuffisance de dévers et accélération non compensée, état de la courbe ; coût par image maîtrisé (résultats mis en cache tant que le réseau ne change pas)
- [ ] A5. Déraillement : `derailed`, arrêt d'urgence verrouillé, `rerailTrain` qui remet la rame sur la voie à l'arrêt, freins serrés
- [ ] A6. Sauvegarde de `lineSpeed`, `lineType` et du dévers corrigé ; une coupe transmet le dévers corrigé aux deux moitiés
- [ ] A7. Tests de contrôle (voir plus bas)

### Phase 2 — Agent B : outil, canevas, panneaux, HUD

- [ ] B0. Mode « Signalisation » de la barre de gauche, sur le modèle du mode train : bouton d'entrée, sous-modes (sélection, limite de vitesse, suppression), retour par Échap ; les zones ne sont sélectionnables et modifiables que dans ce mode, et restent visibles en dehors
- [ ] B1. Outil « Limite de vitesse » à deux clics, sur le modèle de la mesure : aimant sur la voie, aperçu du trajet et de sa longueur au survol, vitesse réglable dans la barre contextuelle (pas de 10 km/h), Échap en deux temps, raccourci, refus signalé hors voie ou sans chemin
- [ ] B2. Dessin sobre, dans l'esprit des pentes : un liseré le long de la portion limitée (passe des rails, pour suivre ponts et tunnels) et, à ses deux bouts, la vitesse et les lettres Z / R des pancartes réelles ; masqué au zoom lointain
- [ ] B3. Sélection d'une zone au clic, panneau latéral (vitesse, longueur, zones chevauchées, supprimer), suppression au clavier, une étape d'annulation par action ; alerte de chevauchement à la pose et marqueur de diagnostic sur la portion commune
- [ ] B4. Paramètres : « Type de ligne » et « Vitesse de ligne », avec les préréglages
- [ ] B5. Panneau du segment courbe : rayon, dévers (automatique ou corrigé), vitesse maximale de la courbe
- [ ] B6. HUD : cadran de vitesse en couleur (blanc, jaune, orange, rouge selon le tableau des décisions) avec un repère plein à la limite en cours et un repère creux à la prochaine ; limite en cours (blanc sur noir), prochaine limite (noir sur blanc) avec sa distance ; état de la courbe ; panneau de déraillement avec le bouton « Remettre sur la voie »
- [ ] B7. Tests du store, de la barre contextuelle et du modèle du HUD

### Vérification finale

- [ ] `npm test`, `npm run typecheck`, `npm run build`, relecture du diff
- [ ] Navigateur : poser une zone, la couper aux ciseaux, y brancher une voie, annuler ; courbe à la limite, en survitesse, déraillement et remise sur la voie ; prochaine limite annoncée à temps pour freiner

## Tests de contrôle

### Zones

- Une zone de 500 m coupée aux ciseaux en son milieu reste une zone de 500 m, au même endroit du monde
- Un aiguillage posé dans une zone ne la déplace pas ; la branche déviée n'est pas dans la zone
- Sauvegarde, chargement et annulation : mêmes zones, mêmes bouts à 1 cm près
- Tête dans une zone à 90 : limite 90 ; tête sortie, queue encore dedans : toujours 90 ; queue sortie : limite de la ligne
- Rame à 300 km/h, zone à 160 à 5 km : annoncée avec sa distance ; la distance décroît au rythme de la marche
- Deux zones qui se recouvrent sur 200 m : la plus basse s'applique sur ces 200 m, et le chevauchement est signalé avec sa longueur
- Couleur du cadran, limite à 160 : 140 km/h blanc, 150 et 160 orange, 161 rouge ; à 200 km/h avec une zone à 160 annoncée devant : jaune ; rouge l'emporte sur le reste
- Un projet sans zone se charge et se resauvegarde à l'identique

### Dévers

| Cas | Données | Attendu | Origine |
|---|---|---|---|
| Eckwersheim, vitesse nominale | R 945 m, d 163 mm, 160 km/h | I ≈ 157 mm, à la limite admise | données confirmées |
| Eckwersheim, essai | même courbe, 176 km/h | I ≈ 224 mm : inconfort, pas de renversement | idem |
| Eckwersheim, accident | même courbe, 235 km/h | renversement | vitesse de source secondaire |
| LGV Sud-Est, rayon minimal | R 4 000 m, d 180 mm, 300 km/h | I ≈ 86 mm, admis | rayon confirmé, dévers supposé |
| LGV Sud-Est, courbe mesurée | R 9 000 m, d 78 mm, 300 km/h | I ≈ 40 mm | une source |
| Ligne classique à 160 | R 1 000 m, d 160 mm | I ≈ 142 mm, admis ; rayon minimal ≈ 947 m | confirmé |
| Dévers automatique | R 1 000 m, ligne classique à 160 | ≈ 155 mm | règle SNCF |
| Voie sans dévers | R 500 m, I 150 mm | 80 km/h | calcul |

Comportements : une courbe plus serrée que ce que la ligne permet abaisse la limite de sa section ; un dévers corrigé à la main change la vitesse de la courbe ; la prochaine limite est annoncée avant d'y être ; un fichier sans ces champs se charge et se resauvegarde à l'identique.

## Décisions de l'utilisateur (2026-10-05)

1. Renversement = déraillement, avec un bouton « Remettre sur la voie ».
2. Le HUD prévient de la limite en cours et de la prochaine ; pas de freinage automatique.
3. Les limites se posent sur le canevas, d'un point A à un point B.
4. Défaut du projet : ligne classique à 160 km/h.
5. 1:1 seulement ; réseaux miniatures notés dans « Idées notées ».
6. Rail supprimé au milieu d'une zone : la zone est raccourcie ou coupée en deux, pas supprimée.
7. Voie déplacée : la zone suit la voie.
8. Une seule vitesse par zone, valable dans les deux sens ; le format laisse la place d'ajouter une valeur par catégorie de train et par sens.
9. Zones qui se chevauchent : autorisées, la plus basse l'emporte, **avec une alerte de chevauchement**.
10. L'annonce est calculée, pas posée, **avec un marqueur et un cadran de vitesse en couleur** (voir ci-dessous).

### Cadran de vitesse en couleur

| Couleur | Quand |
|---|---|
| Blanc | marche normale : plus de 10 km/h sous la limite, aucune baisse annoncée |
| Jaune | une limite plus basse est annoncée devant et la vitesse actuelle la dépasse : il faut freiner (**interprétation à confirmer** : l'utilisateur a cité le jaune sans préciser son cas) |
| Orange | à moins de 10 km/h sous la limite en cours, limite comprise |
| Rouge | dès que la limite est dépassée |

La couleur la plus grave l'emporte (rouge, puis orange, puis jaune). Elle s'applique à l'arc et au chiffre de vitesse.

Marqueurs sur le cadran : un repère plein à la limite en cours, un repère creux à la prochaine limite plus basse. À côté, la prochaine limite et sa distance.

### Alerte de chevauchement

- À la pose ou à la modification : message « Cette zone en chevauche une autre : la limite la plus basse s'applique ».
- En construction : la portion commune est signalée par le marqueur de diagnostic existant, comme une pente trop forte.
- Dans le panneau de la zone : la liste des zones qu'elle chevauche, avec leur vitesse.

## Hors périmètre

- Signaux, cantons, itinéraires, vitesse en cabine des LGV, contrôle de vitesse : plan suivant
- Vitesse des aiguillages en voie déviée : avec la signalisation (les tables trouvées se contredisent pour les aiguillages courants)
- Limite par catégorie de train et par sens, limitations temporaires de chantier
- Recalage des trains quand on coupe un rail sous eux : la brique commune le permet, à faire dans la foulée si l'utilisateur le veut
- Courbes de raccordement dans le tracé, trains pendulaires, autres modes de déraillement, inclinaison visible des véhicules
- Réseaux miniatures

---

# Ensuite — Signalisation : un moteur, deux niveaux (feuille de route, à valider)

Recherches du 2026-10-05 : `tasks/recherche-signalisation.md` (signalisation française réelle, règles, dessin) et `tasks/recherche-signalisation-niveaux.md` (monde simple, deux niveaux, palette). Rien n'est codé. Vient après le plan des limites de vitesse, dont il réutilise la brique « objet attaché à la voie » et le mode « Signalisation » de la barre de gauche.

## Choix proposé : un seul moteur, deux niveaux au choix du projet

Demande de l'utilisateur : un **monde simple** (signal de block et signal de trajectoire aux intersections) ou un **monde réaliste** (vrais signaux français, pour un public professionnel ou passionné).

Les deux reposent sur le même calcul : des signaux attachés à la voie, des cantons déduits, l'occupation par les trains, la réservation du trajet. Le signal de block est un sémaphore, le signal de trajectoire est un carré avec son itinéraire. Le niveau simple n'est donc pas un second système : c'est le même, avec moins d'objets, un autre dessin et sans les règles de conduite françaises.

| | Niveau simple | Niveau réaliste |
|---|---|---|
| Objets posés | signal de block, signal de trajectoire | sémaphore, carré, repère de LGV ; plus tard les signaux de ralentissement |
| États affichés | vert, jaune, rouge | les indications françaises (voie libre, avertissement, sémaphore, carré, puis clignotants et ralentissements) |
| Règles de conduite | tout rouge est un arrêt | sémaphore franchissable en marche à vue après arrêt, carré jamais ; 30 km/h à l'approche d'un signal annoncé fermé ; vitesse en cabine sur LGV |
| Dessin | un mât et un feu | cibles, plaques, repères réels |

Le niveau est un **réglage du projet**, modifiable à tout moment et sans conversion : le même signal stocké est relu par l'autre jeu de règles. Les réglages propres au réaliste restent en mémoire quand on repasse en simple.

Aucun logiciel trouvé ne présente un même réseau en « signaux de jeu » ou en « signaux d'un pays » : cette bascule est une extrapolation à partir d'outils voisins (OSRD de SNCF Réseau, OpenTTD JGR). Elle devra être testée par un aller-retour sur un projet type.

## Point dur : conduire à la main dans un monde simple

Dans les jeux à signalisation simple, les trains sont automatiques. Ici le joueur conduit une rame qui met 3 km à s'arrêter depuis 300 km/h : un signal à deux états, sans annonce, est inconduisible. Le niveau simple a donc dès le départ :

- un troisième état « attention » **calculé** (le signal suivant est fermé) ;
- dans le HUD, le prochain signal, et le premier signal fermé sur le trajet **quelle que soit sa distance** ;
- une alerte de freinage quand cette distance approche la distance d'arrêt ;
- la réservation du trajet prolongée devant le train du joueur jusqu'à sa distance d'arrêt ;
- un freinage d'urgence au franchissement d'un signal fermé (réglable).

Le train du joueur n'a pas de destination : son trajet est celui que donnent les aiguilles devant lui. Une aiguille prise dans une réservation ne se manœuvre plus.

## Palette du mode « Signalisation »

| Niveau simple | Niveau réaliste |
|---|---|
| Sélection | Sélection |
| Signal de block | Sémaphore (panneau de block) |
| Signal de trajectoire | Carré |
| Limite de vitesse | Repère de LGV |
| Supprimer | Limite de vitesse |
| | Supprimer |

Commun aux deux : un clic pose un signal du côté de la voie où se trouve le curseur ; une touche inverse son sens ; glisser le long de la voie pose en série avec un espacement réglable ; glisser un signal le déplace. Deux affichages à cocher : cantons colorés, réservations. Au plus trois indications à la pose (aperçu du signal, flèche de sens, couleur des deux cantons créés).

## Ordre de construction

| Rang | Contenu | Jouable |
|---|---|---|
| 1 | Signal attaché à la voie : pose avec aperçu et flèche de sens, retournement, suppression ; cantons déduits et colorés quand l'outil est actif | pose seulement |
| 2 | Occupation et règle de block à trois états ; dessin simple ; HUD (prochain signal, premier signal fermé, alerte de freinage) ; freinage d'urgence au franchissement | **oui : espacement, niveau simple** |
| 3 | Dessin et règles réalistes de la même règle de block : cible à trois feux, plaque, marche à vue ; réglage du projet et bascule | **oui : block réaliste** |
| 4 | Réservation de trajets ; signal de trajectoire et carré ; aiguilles immobilisées ; affichage des réservations | oui : intersections et gares |
| 5 | Pose en série, déplacement d'un signal, rapport de contrôle (cantons trop courts ou trop longs, aiguille sans protection) | confort |
| 6 | Réaliste seulement : vitesse en cabine des LGV, puis ralentissements pour les voies déviées, puis indications clignotantes | LGV, entrées en gare |

Les rangs 2 et 3 partagent tout le calcul. Chaque rang fera l'objet d'un plan détaillé au moment de le lancer.

## Risques

- **Deux jeux de règles qui divergent** : un seul calcul d'état ; chaque niveau ne fournit qu'une table « état → dessin » et ses règles de conduite ; tests communs.
- **Canton « toutes branches »** : sans signal de trajectoire devant une aiguille, un seul train bloque toute la bifurcation ; le rapport de contrôle signale les aiguilles sans protection.
- **Dérive du réaliste** (block manuel, voies de service, manœuvres) : s'en tenir au block automatique, aux carrés, à la vitesse en cabine et aux ralentissements.
- **Attentes du public professionnel** : aucune enquête trouvée, cette partie de la recherche est une estimation.

## À trancher par l'utilisateur

1. **Un moteur et deux niveaux** (proposé), ou un seul des deux mondes.
2. **Niveau par défaut d'un nouveau projet** : simple (proposé, plus accessible) ou réaliste.
3. **Franchissement d'un signal fermé** : freinage d'urgence automatique (proposé, réglable) ou simple alerte.
4. **Signal à double sens** : deux signaux dos à dos (proposé, c'est aussi le cas réel) ou un seul objet à deux faces.

## Reporté à plus tard

Trains pilotés par le jeu, contrôle de vitesse par balises, panneaux d'annonce des limites le long de la voie, vitesse des aiguillages en voie déviée (avec le rang 6), block manuel, voies de service.

---

# À faire

- [ ] Contrôle dans le navigateur des raccourcis clavier réassignables (section des paramètres : capture d'une touche, conflit, lettres AZERTY)
- [ ] Contrôle dans le navigateur des rames TGV articulées (sélecteur de modèle, rendu en contour)
- [ ] Traiter la branche `feature/curve-angle-rotation-gizmo` (conflits attendus sur `gizmo.ts` et `ToolBar.tsx`)
- [ ] Arrêt net au butoir (de la vitesse courante à 0) : choix à faire par l'utilisateur

## Idées notées (pas encore planifiées)

- **Réseaux miniatures (HO, N…) : dévers, limites de vitesse et physique à revoir** (noté le 2026-10-05). Tout ce qui touche à la conduite réaliste est réservé au 1:1 pour l'instant. À reprendre plus tard : les trains gardent des dimensions et des vitesses réelles quelle que soit l'échelle, et les courbes de catalogue sont bien plus serrées que la réalité (730 mm en HO ≈ 28 km/h réels). Il faudra décider d'une vitesse « à l'échelle », de la mise à l'échelle des véhicules et de ce que deviennent pente, dévers et limites sur une maquette.
- **Piloter son train depuis son téléphone** (demandé le 2026-10-05) : planifié, voir « Console de conduite adaptative et pupitre sur téléphone ». Choix retenu : relais WebSocket, réseau local d'abord. Reste une idée : capteurs du téléphone pour l'immersion.

Rien de ce qui touche `Canvas.tsx`, le clavier ou les composants React n'a été vérifié dans le navigateur à ce jour : il n'y a pas de test d'interface.

---

# Défauts connus (non traités)

## Pose et édition des voies

- Ciseaux sur un nœud : segment détaché arbitraire, et priorité du nœud sur le segment à faible zoom
- Fermeture de boucle sur un nœud existant : l'aperçu diffère de la pose
- `turnoutRadius` non branché
- Mode catalogue Kato inatteignable ; arrondi 0,1 m non adapté aux échelles modélisme
- Chevauchement partiel de deux courbes non fusionné ; réconciliation limitée à 40 opérations par appel
- Anciens aiguillages dessinés à la main entre 15° et 45° devenus infranchissables
- `findPath` / `reachableFrom` faux sur les doubles croisements (sans appelant hors tests)
- Gabarits non branchés à l'interface (liaison croisée, évitement, boucle de retournement — cette dernière infranchissable)

## Trains

- Couper un rail sous un train retire les véhicules posés dessus (annulable)
- Une pose libre au milieu d'un train peut le chevaucher
- Pas de collision entre les deux voies d'une traversée ni au gabarit d'un aiguillage ; pas d'auto-collision sur une boucle plus courte que le train
- Un scénario où `notify()` redéfinit les rôles des branches sous un train le décale de 5 m, à examiner
- En pose aimantée le sens `R` est relatif au train, en pose libre il est relatif au segment
- Rames articulées : bout libre d'une remorque sans porte-à-faux (le bogie dépasse de 1,35 m) ; fantôme d'une remorque posée contre une motrice dessiné sans son extension ; cotes TGV M en grande partie estimées
- Contrôle du raccord d'arrivée de l'outil courbe (`checkCurveJoins`) couvert seulement par les tests de l'agent qui l'a écrit

## Pilotage et interface

- Pas d'indication « aiguille occupée » sur le canevas ; pictogramme d'aiguillage dans le HUD non fait
- Faisceau debug en marche arrière : part du premier véhicule et non de la queue
- Boutons de la barre d'outils cliquables en conduite ; raccourcis globaux actifs quand la fenêtre des paramètres est ouverte (hors capture)
- Réseaux déjà enregistrés : gardent le nom « Untitled Network »
- Thème clair des éléments flottants et styles de boutons non unifiés

## Conduite

- HUD nettement plus haut qu'avant : il défile si la fenêtre est basse ; étiquettes des manomètres serrées (repères 4,5 et 5, valeur sous l'aiguille) ; légende des touches coupée à droite
- L'accélération affichée ignore les obstacles : une rame poussée contre un heurtoir affiche une accélération non nulle alors qu'elle ne bouge pas
- La distance d'arrêt suppose la pente actuelle constante et ignore les courbes ; elle est recalculée à chaque image en conduite (coût à surveiller)
- TGV M : masses, effort, résistance et freinage estimés, faute de données publiées
- Trains en dimensions et vitesses réelles à toutes les échelles : la physique n'est juste qu'en 1:1
- Ancienne `Locomotive` : toujours en physique d'arcade (inaccessible depuis l'interface)
- À l'arrêt en urgence, « un cran de moins » sur N lève le verrou d'urgence (et met maintenant le manipulateur sur B1)
- Frein électrique : sous 10 km/h le HUD affiche encore « B5 · 100 % » alors que l'effort est nul ; la distance d'arrêt l'ignore ; puissance et vitesse d'effacement estimées
- Ruban de distance d'arrêt du debug anguleux en courbe serrée (échantillonnage limité à 150 pas)

## Niveaux et pentes

- Un clic sur une voie sélectionne toute la section : le compteur de niveau lève tous ses nœuds ensemble ; pour n'en lever qu'une partie il faut la sélectionner seule
- Une soudure ou une découpe entre deux hauteurs distantes de moins d'un demi-niveau aligne la voie sur le nœud conservé : sa pente change sans avertissement
- Changer d'échelle remet la hauteur d'un niveau et la pente maximale aux valeurs de l'échelle (comme l'entraxe) ; la fenêtre des paramètres marque le projet modifié à chaque enregistrement
- En vue à plusieurs niveaux, `renderNetwork` tourne une fois par niveau visible plus une (les sections ne sont plus recalculées, le tri des rails visibles si)
- Pointillés du tunnel repris à zéro à chaque morceau de rail ; en vue simplifiée le tunnel n'a pas de style ; pas des traverses légèrement différent de part et d'autre d'une coupe dans le SVG
- `detectCrossings` ne voit pas un croisement sans nœud qui tombe exactement sur un sommet de la polyligne d'une courbe (défaut ancien, aussi sur des voies à plat)
- Debug des trains possiblement masqué par un pont ; tablier calé sur la constante `GAUGE`, comme les rails
- `NodePanel` change la sélection avant d'appeler le store (comme sa suppression) : une méthode dédiée serait plus propre ; `heightBand` / `segmentLevelPieces` auraient leur place dans le domaine
- Figeage de la barre au survol et élargissement des valeurs sans test automatique

## Code à retirer ou à brancher

- Ancienne `Locomotive` (rendu compris), `TrainBuilderPalette`, repli glisser au pointeur dans `Canvas.tsx`, Tab et `[` `]` en courbe
- Extraction des outils de `Canvas.tsx` vers `IToolStrategy`

---

# Table d'itinéraires par nœud

Validé le 2026-10-05 (plan : `~/.claude/plans/swirling-foraging-planet.md`, état des lieux : `tasks/audit-construction-circulation.md`). Travail fait dans un worktree, branche `feature/node-route-table`. Pas de commit tant que l'utilisateur ne le demande pas.

## Plan

- [x] 1. Modèle : `Junction` = table d'itinéraires (`passages`, `positions`, `active`), lue par `turnoutView`
- [x] 2. `models/routing.ts` : une seule réponse à « ce train peut-il passer de ce rail à celui-là » pour les trains, la recherche de chemin et le dessin
- [x] 3. Trains (`locomotive.ts`), recherche de chemin (`pathfinding.ts`), dessin, export SVG, panneau latéral, menu contextuel : lecture par la table
- [x] 4. Stabilité : `syncJunctions` ne redevine plus un aiguillage qui a ses rails ; `replaceJunctionRail` aux coupes, fusions et doublons
- [x] 5. L'outil aiguillage déclare son aiguillage (`declareBranchOff`)
- [x] 6. Sauvegarde version 2, lecture des fichiers version 1, compteur d'identifiants resynchronisé avant la réconciliation
- [x] 7. Tests, `npm test`, `npm run typecheck`, `npm run build`
- [ ] 8. Contrôle dans le navigateur
- [ ] 9. Fusion avec le chantier « niveaux » non commité (conflits attendus : `junction.ts`, `network.ts`, `reconcile.ts`, `crossing.ts`, `persistence.ts`, `constructionTemplates.ts`)

## Revue

- `vitest` : 711 tests verts (39 fichiers) ; `tsc --noEmit` et `npm run build` verts.
- Relecture indépendante faite, avec comparaison de l'ancien et du nouveau routage sur 28 formes de nœud : aucune forme où un train qui passait est bloqué ou dévié. Ses sept constats sont corrigés et couverts par un test chacun.
- Écarts par rapport au plan :
  - une branche tordue au-delà de 15° perd sa place dans la table (et l'aiguillage disparaît s'il ne reste qu'une branche), au lieu de garder une position morte qui coupait la voie principale ;
  - un rail qui prolonge une branche à travers la pointe fait du nœud un croisement de deux voies : la table est retirée ;
  - une fourche est proposée dès qu'un seul rail a deux ou trois continuations, même si d'autres rails ne font que croiser le nœud ;
  - `syncJunctions` est resté dans `junction.ts` (pas de fichier `junctionSync.ts`).
- Changements visibles : plus d'« aiguillage incomplet » sur une fourche sans tige ; `placeTurnout` ne déclare rien sans tige.
- Non fait : contrôle dans le navigateur ; aiguilles couplées et appareils à deux tiges (le modèle les permet, aucun outil ne les pose).
- Restes connus : recul à travers une aiguille fermée (R6), wagons supprimés en coupant sous un train (R5), collisions sur traversée (R15) ; `findJunctionAtNode` linéaire en nombre de tables.

---

# Fait — Refonte de la barre de menus (2026-10-05)

- [x] 1. Menus réorganisés : Fichier (sous-menu Exporter), Édition, Affichage (bascules à coche, sous-menu Thème), Simulation (nouveau), Aide (liens GitHub et notes de version)
- [x] 2. Composant `MenuBar` : coches, sous-menus, bascule au survol une fois un menu ouvert, flèches / Entrée / Échap ; un menu ouvert retient le clavier
- [x] 3. Partie droite réduite au badge d'échelle et au bouton de thème
- [x] 4. Nettoyage : `ShortcutsModal.tsx` et `AboutModal.tsx` extraits, « Supprimer » appelle `store.deleteSelection()`, styles en ligne passés dans `styles.css`
- [x] 5. Contrôle dans un navigateur sans interface (menus, clavier, thème, fenêtre des raccourcis), test unitaire `Menu.test.ts`

## Revue

- `tsc --noEmit` : aucune erreur dans les fichiers de la barre ; les erreurs restantes viennent du chantier physique en cours (`trainDynamics.ts`, `keybindings.test.ts`).
- Les raccourcis des actions non reconfigurables (Ctrl+Z, Ctrl+A, Suppr, Ctrl+0, Ctrl+,, R) restent des libellés fixes : ces touches sont câblées dans `useKeyboardShortcuts.ts`.

---

# Fait — Panneau debug des trains séparé du poste de conduite (2026-10-05)

Demande : le debug faisait « bricolé » (grille de mini-boutons à emoji, couleurs en dur) et vivait dans le poste de conduite. Décisions prises avec l'utilisateur : seul le panneau change (pas le dessin sur le canevas), il se déploie en bas à droite au-dessus du poste de conduite.

- [x] `hud/trainDebugLayers.ts` : liste unique des calques (clé, libellé, description) + test de couverture des clés de `trainDebugOptions`
- [x] `hud/TrainDebugPanel.tsx` : panneau au thème, une ligne-interrupteur de 32 px par calque, raccourci et bouton fermer dans l'en-tête
- [x] `App.tsx` + `.hud-dock` : le panneau et le poste de conduite sont empilés dans un même conteneur en bas à droite
- [x] `DrivingHUD.tsx` : grille de sous-options retirée, le bouton ⚙ ouvre/ferme le panneau
- [x] `Canvas.tsx` : la barre d'échelle se décale aussi quand le panneau est ouvert en édition

## Revue

- Vérifié dans le navigateur (1280×800) : en édition le panneau est seul dans le coin, en pilotage il est au-dessus du poste ; les lignes basculent ; thèmes clair et sombre. `npm run typecheck` passe, `npm test` passe hors `zzperf.tmp.test.ts` (fichier temporaire étranger à ce chantier, délai dépassé).
- Le panneau est maintenant accessible en édition, ce qui n'était pas le cas avant.
- Reste hors thème : le poste de conduite lui-même (sombre fixe). Sa ligne « Retour arrière / Urgence » déborde déjà à 220 px.
- `TrainBuilderPalette.tsx` (monté nulle part) garde une copie de l'ancienne grille : à retirer avec le composant.
