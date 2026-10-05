# Tâches

Nettoyé le 2026-10-05 : les chantiers terminés ont été retirés (leur plan et leur revue restent dans l'historique git de ce fichier). Ne restent que le chantier en cours, ce qui est encore à faire et les défauts connus.

---

# À valider — Physique de conduite réaliste

Branche `feature/track-levels` (ou une branche dédiée, au choix de l'utilisateur). Plan rédigé le 2026-10-05 après recherche ; **rien n'est codé**. Sources et chiffres détaillés : `tasks/recherche-traction.md`, `tasks/recherche-freinage.md`. Pas de commit tant que l'utilisateur ne le demande pas.

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

- Le manipulateur garde ses crans, de N à P5 (20 % d'effort par cran). Les crans négatifs B1…B5 disparaissent : le frein a ses propres touches.
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

- [ ] 0.1 Types et signatures : données physiques dans `RollingStockSpec`, état du frein dans `TrainSet` (`brakePipe`, `brakeCylinder`, commande de frein, effort appliqué), `DrivingEnvironment` (`levelHeight`), `TrainDynamics` (forces, accélération réelle, pente, pressions, distance d'arrêt, accélération transversale)
- [ ] 0.2 Script de référence de la recherche (`sim.py`) recopié dans `tasks/` pour vérifier l'implémentation contre les mêmes chiffres

### Agent A — domaine

- [ ] A1. `rollingStock.ts` : données par modèle, `consistMass`, `consistPower`, `consistMaxEffort`, `adhesiveMass`, `consistResistance(v)` ; tests (rame de 424 t, 8 800 kW, 212 kN ; R(300) ≈ 60 kN, R(100) ≈ 11 kN)
- [ ] A2. Forces (`train.ts` ou un fichier `trainDynamics.ts`) : traction, adhérence, résistance, pente moyennée sur la rame, courbe ; `trainDynamics(net, train, env)` renvoie le détail
- [ ] A3. Frein à air : conduite générale, cylindres, décélération visée par vitesse, plafond d'adhérence, urgence
- [ ] A4. Intégration : pas fixe, forces dissipatives qui retiennent à l'arrêt, basculement du sens en dérive, vitesse ramenée exactement à zéro quand le frein tient
- [ ] A5. `tickTrainSet` et `advanceTrainSet` : collision vérifiée aussi quand la rame recule en dérive ; butoir et obstacle retiennent la rame sans tremblement ; vitesse du choc renvoyée
- [ ] A6. `stoppingDistance` par intégration (serrage maximal de service, délai compris, pente actuelle) ; accélération transversale `v²/R` exposée par véhicule (point d'accroche du futur plan dévers)
- [ ] A7. Commandes : cran de traction 0…5, serrer / desserrer, urgence ; état de départ « frein serré » ; `resetTrainControls`, attelage, dételage et changement de cabine remis d'aplomb
- [ ] A8. Tests de contrôle (voir plus bas) et réécriture des 13 tests qui figent les valeurs actuelles

### Agent B — store, clavier, HUD, rendu

- [ ] B1. Boucle du store : tous les trains simulés en conduite, `levelHeight` transmis, fin de l'arrêt net imposé par le store, entrée en conduite freins serrés
- [ ] B2. Clavier : actions « serrer » et « desserrer » maintenues (appui / relâchement), catalogue de raccourcis, fenêtre d'aide
- [ ] B3. HUD : deux manomètres (conduite générale, cylindres de frein), effort de traction en %, accélération **réelle**, pente sous la rame en ‰, distance d'arrêt réelle dans l'unité du projet, cadran gradué jusqu'à la vitesse maximale du modèle
- [ ] B4. Rendu debug : vecteur d'accélération et ruban d'arrêt lus dans `TrainDynamics` (corrige au passage la distance d'arrêt infinie hors freinage)
- [ ] B5. Choc contre un butoir ou un autre train au-dessus de quelques km/h : message à l'écran
- [ ] B6. Tests du store et du clavier

### Vérification finale

- [ ] `npm test`, `npm run typecheck`, `npm run build`, relecture du diff
- [ ] Comparaison au script de référence : mêmes temps et distances à 2 % près
- [ ] Navigateur : départ arrêté, montée en vitesse, arrêt de service, urgence, rampe de 35 ‰ dans les deux sens, dérive frein desserré, manomètres

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

## Décisions prises, à confirmer

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

# Ensuite — Dévers et vitesse limite en courbe (plan dédié)

À faire après la physique de conduite. Recherche faite le 2026-10-05 (`tasks/recherche-devers.md`). Ébauche à détailler et à valider le moment venu.

## Principe

- Le dévers ne change pas la vitesse du train : il fixe la vitesse à laquelle une courbe peut être prise. `V_max = √((dévers + insuffisance admise) × R / 11,8)` (km/h, mm, m).
- Il dépend de la ligne : il faut d'abord une **vitesse limite par section de voie** (héritée d'une vitesse de ligne du projet) et un **type de ligne** (classique ou LGV).
- Le dévers de chaque courbe est **calculé automatiquement** à partir du rayon et de la vitesse de la ligne (règle SNCF : environ la moitié du dévers d'équilibre sur ligne classique, 70 % sur LGV, plafonné à 160 ou 180 mm), et l'utilisateur peut le corriger.
- En conduite : accélération transversale non compensée calculée à chaque instant, puis trois niveaux — inconfort, danger, renversement.

## Étapes prévues

- [ ] 1. Données : vitesse limite et type de ligne par section (`sectionMeta`), vitesse de ligne du projet, dévers optionnel par segment courbe, insuffisance admise par matériel ; sauvegarde
- [ ] 2. Domaine : dévers d'équilibre, règle de calcul automatique, vitesse maximale d'une courbe, limite effective d'une section (la plus basse des deux), rampe de dévers aux extrémités de l'arc
- [ ] 3. Conduite : insuffisance et accélération transversale sous chaque véhicule (à partir de l'accélération `v²/R` exposée par la physique), seuils inconfort / danger / renversement, déraillement
- [ ] 4. Diagnostic d'édition : courbe trop serrée pour la vitesse de sa section, signalée comme une pente trop forte
- [ ] 5. Interface : vitesse limite dans le panneau de section, dévers et vitesse maximale dans le panneau du segment, vitesse limite et survitesse dans le HUD
- [ ] 6. Tests sur les cas réels : Eckwersheim (945 m, 163 mm : limite 160 km/h, renversement vers 235 km/h), LGV Sud-Est (4 000 m à 300 km/h), ligne classique (1 000 m à 160 km/h)

## Points à trancher au moment du plan

- Modèles de voies miniatures (HO / N) : les courbes de catalogue sont bien plus serrées que la réalité (730 mm en HO ≈ 28 km/h réels) ; la contrainte devra y être désactivée ou seulement indicative
- Courbes de raccordement : absentes du tracé ; règle minimale proposée par la recherche (dévers qui monte sur une longueur dépendant de la vitesse, à cheval sur le point de tangence)
- Seuil de renversement : calé sur un seul accident et un seul matériel, à laisser réglable

---

# À faire

- [ ] Contrôle dans le navigateur des raccourcis clavier réassignables (section des paramètres : capture d'une touche, conflit, lettres AZERTY)
- [ ] Contrôle dans le navigateur des rames TGV articulées (sélecteur de modèle, rendu en contour)
- [ ] Traiter la branche `feature/curve-angle-rotation-gizmo` (conflits attendus sur `gizmo.ts` et `ToolBar.tsx`)
- [ ] Arrêt net au butoir (de la vitesse courante à 0) : choix à faire par l'utilisateur

## Idées notées (pas encore planifiées)

- **Piloter son train depuis son téléphone** (demandé le 2026-10-05, à faire après la physique de conduite). Le téléphone ouvre une page simple (manette : traction, frein avec pression, inverseur, urgence, vitesse) et se connecte au navigateur qui fait tourner la simulation, par exemple en scannant un QR code affiché à l'écran. Points à trancher au moment du plan :
  - le site est statique (GitHub Pages), donc pas de serveur à nous : soit une liaison directe entre les deux navigateurs (WebRTC, avec un petit service public pour la mise en relation), soit un relais WebSocket à héberger ;
  - le navigateur de bureau reste le seul à simuler ; le téléphone n'envoie que des commandes et reçoit la télémétrie ;
  - retour haptique (vibration) et capteurs du téléphone pour l'immersion, si le navigateur mobile le permet.

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

## Niveaux et pentes

- Un clic sur une voie sélectionne toute la section : le compteur de niveau lève tous ses nœuds ensemble ; pour n'en lever qu'une partie il faut la sélectionner seule
- Une soudure ou une découpe entre deux hauteurs distantes de moins d'un demi-niveau aligne la voie sur le nœud conservé : sa pente change sans avertissement
- Changer d'échelle remet la hauteur d'un niveau et la pente maximale aux valeurs de l'échelle (comme l'entraxe) ; la fenêtre des paramètres marque le projet modifié à chaque enregistrement
- En vue à plusieurs niveaux, `renderNetwork` (et `computeTrackSections`) tourne une fois par niveau visible plus une : coût à mesurer sur un grand réseau
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
