# Tâches

Nettoyé le 2026-10-05 : tout ce qui est implémenté et fusionné dans `developement` a été retiré (plans, étapes cochées et revues restent dans l'historique git de ce fichier). Ne restent que ce qui est encore à faire, à contrôler, à décider, et les défauts connus.

Plans détaillés dans leurs propres fichiers : `plan-console-conduite.md` (pupitre sur téléphone), `plan-traversee-jonction.md`, `plan-inclinaison-visible.md`.

---

# Publication de la v0.3.0

`developement` contient tout ; `main` est encore à la v0.2.0 (plus la licence, la sécurité et les dépendances).

- [ ] Contrôle à l'écran par l'utilisateur (liste ci-dessous) : rien de cette version n'a été vu tourner par un humain
- [ ] Passer à 0.3.0 (`package.json`, `package-lock.json`), mettre à jour le README et `CLAUDE.md` (il décrit encore l'ancien déploiement)
- [ ] Pull request `developement` → `main`, fusion par commit de fusion, puis réaligner `developement` sur `main`
- [ ] Tag signé `v0.3.0` et release avec ses notes (déclenche le déploiement, premier passage des tests en CI)
- [ ] Notes de version : préciser que le pupitre sur téléphone ne fonctionne qu'avec `npm run dev`, pas sur le site publié
- [ ] Dependabot : décider des pull requests #18 (actions) et #19 (npm : React 19, TypeScript 7, Vite 8, Vitest 5)

---

# À contrôler à l'écran

Il n'y a pas de test d'interface : rien de ce qui touche `Canvas.tsx`, le clavier ou les composants React n'est vérifié autrement que par ces contrôles.

## Conduite

- [ ] Rampe de 35 ‰ dans les deux sens, dérive frein desserré, choc contre un heurtoir, boutons du poste à la souris, lisibilité des manomètres
- [ ] Frein électrique : boutons − / + à la souris, vue debug, rame complète

## Limites de vitesse et dévers

- [ ] Zone coupée aux ciseaux et annulation, courbe à la limite et en survitesse, déraillement et « Remettre sur la voie », couleurs du cadran, champ de dévers, paramètres de ligne

## Signalisation

- [ ] Bifurcation avec signal de trajectoire et réservation, voie unique avec évitements, franchissement d'un signal fermé, pose en série en glissant, déplacement d'un signal, panneaux d'annonce, vitesse en cabine sur LGV, thème sombre
- [ ] Ralentissement et rappel (cible élargie, clignotement), vitesse en cabine avec canton tampon et survitesse, cantons sous un pont, alternance au clic sur deux signaux dos à dos
- [ ] Aller-retour standard → pro → standard sur un projet réel (testé seulement en automatique)

## Niveaux de détail au dézoom

- [ ] Trains, saisie des nœuds et réseau en HO aux trois paliers
- [ ] Bandes de vitesse et cantons en vue dézoomée : ils sont dessinés sous le trait unique et sous le schéma (choix fait à la fusion avec la signalisation, pour que les deux chantiers restent compatibles)

## Autres

- [ ] Raccourcis clavier réassignables (capture d'une touche, conflit, lettres AZERTY)
- [ ] Rames TGV articulées (sélecteur de modèle, rendu en contour)
- [ ] Table d'itinéraires par nœud : aiguillages, traversées, coupes et fusions de rails
- [ ] Menu Fichier ▸ Exemples et gare de Marseille Saint-Charles importée
- [ ] Pupitre sur téléphone : voir `plan-console-conduite.md` (étapes 10 et 19)

---

# À décider

## Par l'utilisateur

- [ ] Branche `feature/curve-angle-rotation-gizmo` (conservée, non fusionnée) : son commit fait tourner la tangente d'une courbe avec la poignée « rotation », qui aujourd'hui fait pivoter la sélection. 16 zones de conflit sur 5 fichiers. Garder la poignée actuelle et ajouter une seconde poignée, ou abandonner cette fonction
- [ ] Tracé groupé des rails en vue détaillée (un seul tracé par style au lieu de quatre par rail) : plus rapide, mais l'ordre de superposition change légèrement aux traversées
- [ ] Code de ballast, traverses, éclisses et détails de traversée : écrit, appelé par aucun rendu — à retirer ou à garder

## Choix faits par les agents, à confirmer

- Cadran de vitesse : le jaune signifie « une limite plus basse est annoncée devant et la vitesse actuelle la dépasse »
- Courbe : inconfort jusqu'à 300 mm d'insuffisance de dévers inclus, danger au-delà ; un déraillement n'est pas effacé en entrant ou sortant de la conduite, mais l'est par un rechargement ou une annulation ; après déraillement la rame s'arrête au freinage d'urgence normal
- Signalisation : une rame réserve devant elle 1,5 × sa distance d'arrêt + 50 m ; un signal de protection ne s'ouvre pas si une rame circule en sens contraire sur la pleine voie qui suit ; une aiguille réservée reste manœuvrable par le conducteur de la rame concernée ; premier demandeur servi
- Niveau pro : un sémaphore franchi après un arrêt à moins de 200 m n'est pas une faute, un carré l'est toujours ; sens unique infranchissable par l'arrière aux deux niveaux
- Vitesse d'une aiguille en voie déviée : table basse quand le cœur est connu, sinon vitesse en courbe sans dévers ramenée au palier inférieur
- Niveaux de détail : couleur du rail au palier Ligne, couleur de la section au palier Schéma ; un nœud masqué n'est pas saisissable avec l'outil de sélection

---

# Chantiers ouverts

- **Inclinaison visible (dévers et pentes)** : en cours sur `feature/visible-inclination`, plan dans `plan-inclinaison-visible.md`
- **Pupitre sur téléphone** : reste le contrôle réel sur le réseau local et l'hébergement du relais pour le site publié (`plan-console-conduite.md`, étapes 10, 19 et 21 à 24)
- **Traversée-jonction double** : reste le rendu des lames, l'export SVG, le décalage automatique des pointes et la conduite sur les quatre itinéraires (`plan-traversee-jonction.md`)

---

# Idées notées (pas encore planifiées)

- **Réseaux miniatures (HO, N…)** : dévers, limites de vitesse et physique sont réservés au 1:1. Les trains gardent des dimensions et des vitesses réelles quelle que soit l'échelle, et les courbes de catalogue sont bien plus serrées que la réalité (730 mm en HO ≈ 28 km/h réels). Il faudra décider d'une vitesse « à l'échelle », de la mise à l'échelle des véhicules et de ce que deviennent pente, dévers et limites sur une maquette
- **Pupitre sur téléphone** : capteurs du téléphone pour l'immersion
- **Signalisation** : outil « évitement signalé » qui pose les six signaux d'un coup ; trains pilotés par le jeu ; contrôle de vitesse par balises ; indications clignotantes ; block manuel ; voies de service
- **Conduite** : vitesse imposée (régulateur du TGV) ; conjugaison automatique frein électrique / frein à air ; frein électrique en urgence et dans la distance d'arrêt affichée ; rail mouillé ; raccordement vertical arrondi au pied et au sommet d'une rampe
- **Limites de vitesse** : limite par catégorie de train et par sens ; limitations temporaires de chantier ; courbes de raccordement dans le tracé ; trains pendulaires ; autres modes de déraillement
- **Table d'itinéraires** : aiguilles couplées et appareils à deux tiges (le modèle les permet, aucun outil ne les pose)
- **Rendu** : index spatial pour le tri des rails visibles ; tuiles ou image du réseau gardée en cache entre deux images

---

# Défauts connus (non traités)

Liste reprise telle quelle des revues de chantier ; seuls les défauts marqués corrigés par un chantier ultérieur ont été retirés. Les défauts de la section « Conduite » datent d'avant la console adaptative et sont à revérifier.

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

- Couper un rail sous un train retire les véhicules posés dessus (annulable) ; la brique « rail remplacé » des zones de vitesse permet de le corriger
- Une pose libre au milieu d'un train peut le chevaucher
- Pas de collision entre les deux voies d'une traversée ni au gabarit d'un aiguillage ; pas d'auto-collision sur une boucle plus courte que le train
- Un scénario où `notify()` redéfinit les rôles des branches sous un train le décale de 5 m, à examiner
- Recul d'une rame à travers une aiguille fermée
- En pose aimantée le sens `R` est relatif au train, en pose libre il est relatif au segment
- Rames articulées : bout libre d'une remorque sans porte-à-faux (le bogie dépasse de 1,35 m) ; fantôme d'une remorque posée contre une motrice dessiné sans son extension ; cotes TGV M en grande partie estimées
- Contrôle du raccord d'arrivée de l'outil courbe (`checkCurveJoins`) couvert seulement par les tests de l'agent qui l'a écrit

## Pilotage et interface

- Pas d'indication « aiguille occupée » sur le canevas ; pictogramme d'aiguillage dans le poste de conduite non fait
- Faisceau debug en marche arrière : part du premier véhicule et non de la queue
- Boutons de la barre d'outils cliquables en conduite ; raccourcis globaux actifs quand la fenêtre des paramètres est ouverte (hors capture)
- Réseaux déjà enregistrés : gardent le nom « Untitled Network »
- Thème clair des éléments flottants et styles de boutons non unifiés ; le poste de conduite reste sombre dans les deux thèmes
- Les raccourcis des actions non reconfigurables (Ctrl+Z, Ctrl+A, Suppr, Ctrl+0, Ctrl+,, R) sont des libellés fixes dans les menus

## Conduite

- Poste de conduite plus haut qu'avant : il défile si la fenêtre est basse ; étiquettes des manomètres serrées (repères 4,5 et 5, valeur sous l'aiguille) ; légende des touches coupée à droite
- L'accélération affichée ignore les obstacles : une rame poussée contre un heurtoir affiche une accélération non nulle alors qu'elle ne bouge pas
- La distance d'arrêt suppose la pente actuelle constante et ignore les courbes ; elle est recalculée à chaque image en conduite (coût à surveiller)
- TGV M : masses, effort, résistance et freinage estimés, faute de données publiées
- Trains en dimensions et vitesses réelles à toutes les échelles : la physique n'est juste qu'en 1:1
- Ancienne `Locomotive` : toujours en physique d'arcade (inaccessible depuis l'interface)
- À l'arrêt en urgence, « un cran de moins » sur N lève le verrou d'urgence (et met le manipulateur sur B1)
- Frein électrique : sous 10 km/h le poste affiche encore « B5 · 100 % » alors que l'effort est nul ; puissance et vitesse d'effacement estimées
- Ruban de distance d'arrêt du debug anguleux en courbe serrée (échantillonnage limité à 150 pas)

## Signalisation

- Voie unique sans signal de protection aux entrées : deux rames opposées peuvent se retrouver arrêtées face à face (blocage sans collision) ; le rapport de contrôle signale ces aiguilles
- Rame en marche arrière à travers une aiguille prise en talon mal orientée : non testé
- Ancienne `Locomotive` : ignorée par la signalisation
- Traversée-jonction double : pas de vitesse en voie déviée
- Ralentissement et rappel identiques vus de dessus
- Fin de voie sur LGV sans repère : « 000 » sans annonce préalable
- Voie de type contresens (signaux denses dans un sens, rares dans l'autre) : ses signaux d'espacement sont signalés comme isolés
- `showDimensions` est restauré par l'annulation alors que les deux affichages de signalisation ne le sont pas
- Vitesse en cabine : séquence simplifiée ; palier 80 seulement devant un repère non franchissable ou une fin de voie
- Valeurs estimées, marquées dans le code : table tangente → vitesse des aiguilles, paliers déduits du rayon, canton de contrôle de survitesse, 100 m pour le vis-à-vis, clignotement à 1 Hz

## Limites de vitesse et dévers

- Le dévers n'apparaît que pour un rail sélectionné seul : un clic simple sur une voie sélectionne la section et ouvre un autre panneau
- Le message de chevauchement revient à chaque pas du compteur de vitesse tant que la zone en chevauche une autre
- Pas d'export SVG des zones ; clic droit pendant la pose d'une zone : ouvre le menu contextuel au lieu d'annuler (comme la mesure)
- Zone partielle sur un rail dont on déplace un bout : elle s'étire avec le rail
- Un dévers posé à la main peut être perdu par une édition qui recrée le rail courbe sans passer par la découpe ; il n'est pas réduit sur une courbe trop courte
- Rampe de dévers tronquée à un aiguillage, absente entre deux courbes de même sens
- Écartement modifié à la main (échelle « custom ») : traité comme hors 1:1, donc sans dévers
- Vérification du profil de voie à chaque image : 0,14 à 0,25 ms pour 4 000 rails, linéaire
- Seuil de renversement calé sur un seul accident ; valeurs du TGV M recopiées du Duplex
- Pas de panneau d'annonce pour une baisse de vitesse due à une courbe seule

## Niveaux et pentes

- Un clic sur une voie sélectionne toute la section : le compteur de niveau lève tous ses nœuds ensemble ; pour n'en lever qu'une partie il faut la sélectionner seule
- Une soudure ou une découpe entre deux hauteurs distantes de moins d'un demi-niveau aligne la voie sur le nœud conservé : sa pente change sans avertissement
- Changer d'échelle remet la hauteur d'un niveau et la pente maximale aux valeurs de l'échelle (comme l'entraxe) ; la fenêtre des paramètres marque le projet modifié à chaque enregistrement
- En vue à plusieurs niveaux, `renderNetwork` tourne une fois par niveau visible plus une, et le tri des rails visibles est refait à chaque niveau
- Pointillés du tunnel repris à zéro à chaque morceau de rail ; pas des traverses légèrement différent de part et d'autre d'une coupe dans le SVG
- `detectCrossings` ne voit pas un croisement sans nœud qui tombe exactement sur un sommet de la polyligne d'une courbe (défaut ancien, aussi sur des voies à plat)
- Debug des trains possiblement masqué par un pont ; tablier calé sur la constante `GAUGE`, comme les rails
- `NodePanel` change la sélection avant d'appeler le store (comme sa suppression) : une méthode dédiée serait plus propre ; `heightBand` / `segmentLevelPieces` auraient leur place dans le domaine
- Figeage de la barre au survol et élargissement des valeurs sans test automatique

## Niveaux de détail au dézoom

- Le palier lit la constante `GAUGE` comme le tracé des rails : en HO on reste au palier Détail tant que les rails ne suivent pas l'écartement du projet
- Le menu contextuel (clic droit) atteint encore un nœud masqué
- Palier Schéma : les niveaux ne sont pas superposés ; sélectionner un rail colore toute sa section ; le tunnel n'a pas de style
- L'ancienne `Locomotive` garde son dessin complet à tous les paliers
- Import circulaire `renderer.ts` ↔ `lodTracks.ts` (sans effet à l'exécution) ; seuils des badges et diagnostics dans `lodOverlays.ts` et non `lod.ts`
- Le dessin des marqueurs de diagnostic existe en double : `drawDiagnosticMarker` (limites de vitesse, signalisation) et sa version regroupée dans `renderer.ts` (reste de la fusion)

## Table d'itinéraires

- `findJunctionAtNode` linéaire en nombre de tables

## Code à retirer ou à brancher

- Ancienne `Locomotive` (rendu compris), `TrainBuilderPalette` (qui garde une copie de l'ancienne grille de debug), repli glisser au pointeur dans `Canvas.tsx`, Tab et `[` `]` en courbe
- Extraction des outils de `Canvas.tsx` vers `IToolStrategy`
