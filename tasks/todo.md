# Tâches

Nettoyé le 2026-10-05 : les chantiers terminés ont été retirés (leur plan et leur revue restent dans l'historique git de ce fichier). Ne restent que le chantier en cours, ce qui est encore à faire et les défauts connus.

---

# En cours — Pentes (rampes entre deux niveaux)

Branche `feature/track-levels`. Plan validé le 2026-10-05, avec un visuel sobre (voir agent B). Suite des niveaux de voie (commits `41f3383`, `ffa1cc9`). Pas de commit tant que l'utilisateur ne le demande pas.

## Principe

La hauteur devient une propriété des **nœuds**, plus des segments : `RailNode.level?` (absent = 0, nombre décimal, en « niveaux »). Un segment va de la hauteur de son nœud de départ à celle de son nœud d'arrivée :

- deux bouts à la même hauteur : voie à plat (sol, pont ou tunnel), comme aujourd'hui ;
- deux bouts à des hauteurs différentes : **rampe**, sans rien stocker de plus.

Conséquences voulues :

- relier un nœud de pont à un nœud au sol crée la rampe toute seule ;
- monter une voie monte ses nœuds, donc les voies voisines deviennent ses rampes ;
- un changement de niveau brutal n'est plus représentable (plus de « falaise » avec culée au milieu d'une ligne) ;
- couper une rampe donne un nœud à la hauteur intermédiaire : chaque morceau garde sa part de la montée.

Règle unique, qui remplace « partager un niveau » : deux voies n'interagissent (croisement, soudure, découpe, doublon) que si, **à l'endroit où elles se rencontrent**, leurs hauteurs diffèrent de moins d'un demi-niveau (`LEVEL_CLEARANCE = 0.5`). Une rampe croise donc une voie au sol près de son pied et passe au-dessus près de son sommet.

La hauteur le long d'un segment est interpolée linéairement sur son paramètre `t` (exact à la découpe, approximation assumée sur une courbe de Bézier).

Pente = dénivelé × hauteur d'un niveau ÷ longueur du segment, en ‰. Deux réglages du projet, convertis selon l'échelle et modifiables dans les paramètres :

- `levelHeight` : hauteur d'un niveau, 6 m en réel (≈ 6,9 cm en HO) ;
- `maxGradient` : pente maximale, 35 ‰.

À 35 ‰, monter d'un niveau demande environ 171 m de rampe en réel, 1,97 m en HO.

## Pourquoi changer le modèle qui vient d'être commité

`Segment.level` ne peut pas décrire une rampe sans un second champ par segment, et rien n'y garantit que deux rampes consécutives se raccordent à la même hauteur. Avec la hauteur sur les nœuds, la continuité est acquise par construction et les rampes n'ont pas besoin d'être créées ni entretenues. Le coût : reprendre les helpers de niveau (une soixantaine d'appels, surtout mécanique) et relire les sauvegardes faites avec `Segment.level`.

## Phase 1 — Migration du modèle, sans élément graphique nouveau (un agent, avant les deux autres)

- [ ] 1.1 `types.ts` : `RailNode.level?` ; `Segment.level` retiré du modèle (lu seulement à l'ouverture d'une ancienne sauvegarde)
- [ ] 1.2 `network.ts` : `nodeLevel(node)`, `segmentEndLevels(net, seg)`, `segmentHeightAt(net, seg, t)`, `isRamp(net, seg)`, `segmentBand(net, seg)` (niveau de dessin : le bout le plus haut, ou le plus bas pour une voie sous le sol), `setNodesLevel(net, ids, level)` ; `segmentLevel` / `nodeLevels` / `branchLevel` / `setSegmentsLevel` remplacés
- [ ] 1.3 Tous les appelants adaptés (réconciliation, croisements, pointage, gabarits, store, rendu, export, interface) en gardant le comportement actuel pour les voies à plat
- [ ] 1.4 Persistance : `level` sur `SerializedNode` (écrit seulement s'il est non nul) ; ancienne sauvegarde avec `level` sur les segments : chaque nœud prend, parmi les niveaux de ses rails, celui qui est le plus éloigné du sol
- [ ] 1.5 Les 684 tests passent, adaptés seulement là où ils posent `seg.level` à la main ; `npm run typecheck`, `npm run build`

## Phase 2 — Agent A : domaine, sauvegarde, store

- [ ] A1. Règle de hauteur dans la réconciliation (`reconcile.ts`) : candidats `cross`, `split`, `weld` et doublons décidés sur l'écart de hauteur au point de rencontre ; `weldNodes` garde la hauteur du nœud conservé
- [ ] A2. Croisements (`crossing.ts`) : `detectCrossings` sur la même règle ; `separateLevelsAtNode` inchangé dans son rôle (le nœud jumeau reçoit la hauteur de la voie du dessus)
- [ ] A3. Découpe et fusion : le nœud créé par une découpe prend la hauteur interpolée ; `dissolveNode` refuse de supprimer un nœud dont la hauteur n'est pas alignée avec ses deux voisins (sinon la pente changerait sans le dire)
- [ ] A4. Pose : un nœud créé en prolongeant une voie prend la hauteur du nœud de départ ; arriver sur un nœud existant d'une autre hauteur donne une rampe ; gabarits (`constructionTemplates.ts`) et voie parallèle recopient les hauteurs
- [ ] A5. Pente (`network.ts` ou `services/`) : `segmentGradient(net, seg, levelHeight)` en ‰, signée dans le sens du segment ; `spreadGradient(net, segmentIds)` : sur une suite de rails bout à bout, répartit le dénivelé entre les deux extrémités au prorata des longueurs
- [ ] A6. Diagnostic (`kinematicDiagnostics.ts`) : nouveau type « pente trop forte » quand un segment dépasse `maxGradient`
- [ ] A7. Store : `levelHeight`, `maxGradient` (valeurs par défaut dans `SCALE_PRESETS`, sauvegardés avec le projet) ; `shiftSelectionLevel(delta)` agit sur les nœuds des rails sélectionnés, ou sur les nœuds sélectionnés seuls ; `spreadSelectionGradient()` ; même enchaînement que les autres éditions (trains gardés en place, réconciliation, historique, `notify()`)
- [ ] A8. Pointage : à distance égale, la voie la plus haute **à cet endroit** l'emporte
- [ ] A9. Tests pour chaque point

## Phase 2 — Agent B : visuel et interface

Consigne de l'utilisateur (2026-10-05) : visuel très sobre, on garde le dessin actuel. Juste les rails, pas de traverses ni d'élément nouveau ; pointillés légers pour les tunnels ; pont comme aujourd'hui.

- [ ] B1. Ordre de dessin par `segmentBand` ; un véhicule est dessiné avec le segment qui le porte
- [ ] B2. Rampe : rails seuls. Le style existant s'applique simplement à la partie de la rampe qui est réellement au-dessus ou au-dessous : tablier actuel là où la hauteur dépasse un demi-niveau (c'est ce qui masque la voie du dessous), pointillés actuels du tunnel là où elle passe sous un demi-niveau. Culée actuelle au début du tablier. Aucun talus, hachure, portail, chevron ni étiquette
- [ ] B3. Export SVG : même règle
- [ ] B4. Interface :
  - `SegmentPanel` : niveau de départ et d'arrivée, dénivelé en mètres, pente en ‰ (rouge si trop forte)
  - `NodePanel` : compteur « Niveau » du nœud
  - barre contextuelle : le compteur agit sur la sélection (rails ou nœuds), il affiche « 0 à +1 » sur une rampe ; action « Lisser la pente » active quand la sélection est une suite de rails dont les deux bouts ne sont pas à la même hauteur ; mêmes règles de stabilité que le reste de la barre
  - paramètres : « Hauteur d'un niveau » et « Pente maximale »
- [ ] B5. Pente trop forte : signalée sur le canevas par le marqueur de diagnostic existant, sans dessin nouveau
- [ ] B6. Tests de rendu (contexte enregistreur de `trackLevels.test.ts`), de la barre contextuelle et de l'export

## Vérification finale

- [ ] `npm test`, `npm run typecheck`, `npm run build`
- [ ] Relecture du diff complet
- [ ] Navigateur : pont avec deux rampes, tunnel avec ses deux descentes, rampe trop raide signalée, « Lisser la pente » sur trois coupons, ancienne sauvegarde relue
- [ ] Contrôle à l'œil par l'utilisateur

## Tests clés

- Relier un nœud de niveau 1 à un nœud au sol : un seul rail, pente = 6 m ÷ longueur ; le couper au milieu donne un nœud à 0,5 et deux rails de même pente
- Une rampe 0 → 1 croisée par une voie au sol à 20 % de sa longueur : croisement créé ; à 80 % : aucun nœud, la voie passe dessous
- Monter une voie isolée entre deux voisines : les deux voisines deviennent des rampes, aucune géométrie ne bouge, les trains restent en place
- Diamant → pont → diamant toujours réversible
- « Lisser la pente » sur trois rails de longueurs différentes : même pente sur les trois
- Pente au-delà de `maxGradient` : diagnostic présent ; en deçà : absent
- Ancienne sauvegarde (`level` sur les segments) relue sans perdre de pont ; sauvegarde → chargement → hauteurs identiques, y compris décimales
- Réseau sans aucune hauteur : mêmes appels de dessin et même fichier de sauvegarde qu'avant

## Hors périmètre

- Habillage des rampes (talus, hachures, portail de tunnel, chevrons et étiquette de pente sur le canevas) : écarté pour l'instant à la demande de l'utilisateur
- Effet de la pente sur la conduite (ralentir en montée, accélérer en descente)
- Alerte de gabarit quand une voie passe au-dessus d'une autre avec moins d'un niveau de dégagement
- Raccordement vertical arrondi au pied et au sommet d'une rampe (la pente change d'un coup au nœud)
- Import OSM, fond de carte, projection

---

# À faire

- [ ] Contrôle dans le navigateur des raccourcis clavier réassignables (section des paramètres : capture d'une touche, conflit, lettres AZERTY)
- [ ] Contrôle dans le navigateur des rames TGV articulées (sélecteur de modèle, rendu en contour)
- [ ] Traiter la branche `feature/curve-angle-rotation-gizmo` (conflits attendus sur `gizmo.ts` et `ToolBar.tsx`)
- [ ] Arrêt net au butoir (de la vitesse courante à 0) : choix à faire par l'utilisateur

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

## Niveaux de voie

- Un clic sur une voie sélectionne toute la section : le compteur de niveau lève tous ses coupons ensemble ; pour n'en lever qu'un il faut le sélectionner seul
- En vue à plusieurs niveaux, `renderNetwork` (et `computeTrackSections`) tourne une fois par niveau visible plus une : coût à mesurer sur un grand réseau
- `applyBalloonLoop` n'hérite pas du niveau ; pas d'étiquette de niveau sur le canevas ; tablier calé sur la constante `GAUGE`, comme les rails
- Debug des trains possiblement masqué par un pont ; l'ancienne `Locomotive` prend le niveau de sa motrice en un bloc
- Une voie qui passe par le niveau 0 en croisant une autre y est coupée ; les deux moitiés restent séparées ensuite
- Non vu à l'écran : un train sous un pont, le champ « Niveau » du panneau latéral, l'export SVG ; figeage de la barre au survol et élargissement des valeurs sans test automatique

## Code à retirer ou à brancher

- Ancienne `Locomotive` (rendu compris), `TrainBuilderPalette`, repli glisser au pointeur dans `Canvas.tsx`, Tab et `[` `]` en courbe
- Extraction des outils de `Canvas.tsx` vers `IToolStrategy`
