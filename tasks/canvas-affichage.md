# Canevas : ce qui s'affiche, où, quand

Inventaire établi le 2026-10-04 par lecture du code (`Canvas.tsx`, `CanvasOverlay.tsx`, `FloatingActionBar.tsx`, `ContextMenu.tsx`, `DrivingHUD.tsx`, `renderer.ts`, `styles.css`). Rien n'a été regardé à l'écran : les recouvrements marqués **[code]** découlent directement des positions et des `z-index` écrits dans le code, ceux marqués **[à voir]** sont probables et à confirmer dans le navigateur.

Deux familles d'éléments :

- **dessinés dans le canevas** (pixels, suivent le zoom et le déplacement, ne captent pas les clics eux-mêmes) ;
- **éléments HTML posés par-dessus** (bulles, barres, panneaux : toujours au-dessus du dessin, et ils captent les clics quand ils sont interactifs).

C'est la seconde famille qui cache la première : un élément HTML passe toujours devant le gizmo, les cotes et les aperçus.

---

## 1. Dessiné dans le canevas

Dans l'ordre de dessin (le dernier est au-dessus). Source : `draw()` dans `Canvas.tsx`.

| # | Élément | Quand | Où |
|---|---|---|---|
| 1 | Grille | grille activée | tout le fond |
| 2 | Plateau (contour, cotes largeur/hauteur, titre) | plateau activé (échelles modélisme) | autour de l'origine |
| 3 | Voies : ballast, traverses, rails, joints, cœurs d'aiguillage, traversées | toujours ; trait simple quand on dézoome | sur le réseau |
| 3a | Liseré coloré de section | toujours | axe de la voie |
| 3b | **Badge de section** (nom, flèche, longueur) | selon le zoom : caché en vue large sauf section sélectionnée, compact en vue moyenne, complet en vue proche | milieu de la section |
| 3c | Panneau « fin de voie » | sur chaque bout de voie, sauf avec l'outil Navigation | sur le nœud |
| 3d | **« SENS INTERDIT · CONFLIT »** | conflit de sens entre sections | sur le nœud, texte au-dessus |
| 3e | **Losange d'avertissement** + libellé (« ∠ 23° Cassure », « Voie interrompue », « Jonction non franchissable ») | diagnostic cinématique ; libellé seulement à partir d'un certain zoom ; caché avec l'outil Navigation | sur le nœud, libellé au-dessus |
| 3f | Surbrillance de sélection | élément sélectionné | sur l'élément |
| 4 | Trains (caisses, bogies, soufflets) ; mode squelette et vecteurs en option | dès qu'un train existe | sur la voie |
| 5 | Ancienne locomotive | seulement s'il n'y a aucun train « nouveau modèle » | sur la voie |
| 6 | Points d'attelage (pastilles + libellés) | outil Attelage | bouts et jonctions des trains |
| 7 | Véhicule fantôme + indicateur d'accroche (avec libellé) | mode train, pose, hors conduite | sous le curseur, sur la voie |
| 8 | Contour rouge + badge « Supprimer » | mode train, suppression, véhicule survolé | sur le véhicule |
| 9 | Rectangle de sélection | Maj + glisser | — |
| 10 | Indicateur d'aimantation | outils de construction | sous le curseur |
| 11 | Point d'accroche sur voie + libellé « [x, y] +12,0 m » | outils de construction, voie survolée | 12 px au-dessus du point |
| 12 | Aperçu du rail droit + libellé + cote de longueur ; « Voie 2 » + cote d'entraxe en voie double | outil Pose, départ fixé | du départ au curseur |
| 13 | Aperçu de la courbe + libellé (rayon, angle, ou motif de refus en rouge) + cotes | outil Courbe, départ fixé | du départ au curseur |
| 14 | Aperçu de l'aiguillage + libellés « Départ aiguillage », « Insérer aiguillage ici » | outil Aiguillage | sur la voie / au curseur |
| 15 | Aperçu de découpe (libellé rouge) | outil Ciseaux | sur la voie survolée |
| 16 | Ruban de mesure + libellé (distance, angle, ΔX, ΔY) | outil Mesure, départ fixé | milieu du ruban |
| 17 | **Gizmo** : flèches X (rouge) et Y (verte) de 52 px partant à 12 px du centre, arc de rotation de rayon 58 px | outil Sélection **uniquement**, avec une sélection | centre de la sélection |
| 18 | Barre d'échelle | toujours | bas à droite du canevas |

---

## 2. Éléments HTML par-dessus le canevas

| Élément | Quand | Où | z-index | Capte les clics |
|---|---|---|---|---|
| **Barre d'actions flottante** (Aiguiller, Inverser D/G, Scinder, Voie double, Prolonger, Supprimer) | outil Sélection + sélection ; cachée si le centre de la sélection est à moins de 40 px du haut | centrée sur le centre de la sélection, **54 px au-dessus** | 45 | oui |
| Menu contextuel | clic droit sans glisser | au curseur (recalé dans l'écran) | 1000 | oui |
| Champ « Renommer la section » | double-clic sur une voie | au point cliqué | 100 | oui |
| Pastille de saisie « Longueur : 12 m ↵ » | chiffres tapés pendant une pose | curseur +20 px / −25 px | 100 | non |
| Badge de pose de train (« Attelé au train T1 · 3 véhicules » / « Nouveau train T2 ») | mode train, pose, fantôme visible | 34 px au-dessus du fantôme | 40 | non |
| Badge de glisser (« Poser Motrice TGV ») | glisser-déposer d'un véhicule | curseur +14 px | 9999 | non |
| Bouton « Prendre le contrôle » | ancienne locomotive survolée ou sélectionnée, hors conduite | 40 px au-dessus | 50 | oui |
| Carte de pose (distance, « Flex », « Aiguillage parallèle », « Voie double ») | pose en cours (rail, courbe, aiguillage) | bas centre, à 54 px du bas | — | non |
| Ancienne carte de conduite (vitesse, boutons) | conduite avec l'ancienne locomotive seulement | bas centre, à 54 px du bas | — | oui |
| Badge de phase « 1/2 », « 2/2 » | outil Courbe | haut centre, à 12 px | — | non |
| **Bulle d'aide** (une ligne, change selon l'outil et l'état) | presque toujours | bas centre, à 14 px du bas | — | non |
| Barre d'outils (îlot outils ou panneau train, îlot grille/aimantation, volet du pas de grille) | toujours ; panneau train en mode train | haut gauche, 16 px | 15 (volet 100, infobulle 60) | oui |
| Bouton d'ouverture de l'inspecteur | toujours | haut droite, 16 px (se décale à 316 px quand le panneau est ouvert) | 18 | oui |
| Inspecteur (panneau latéral, 290 px) | ouvert à la demande | droite, de 16 px du haut à 16 px du bas | 20 | oui |
| Mini-carte | activée dans le menu Affichage | bas gauche, 12 px | 8 | oui |
| **Poste de conduite** (vitesse, inverseur, crans, arrêt d'urgence, légende) | conduite | **fixe** bas droite de la fenêtre, 16 px, 220 px de large | 1000 | oui |
| Notifications (toasts) | à chaque message | **fixe** bas droite de la fenêtre, 24 px | 200 | non |
| Fenêtres (réglages, raccourcis, nouveau réseau) | à la demande | plein écran | 100 | oui |
| Barre d'état | toujours | sous le canevas, 28 px de haut | 10 | — |

---

## 3. Ce qui est visible en même temps, par situation

| Situation | Dessiné | HTML |
|---|---|---|
| Sélection, rien de sélectionné | voies, badges de section, avertissements, trains | bulle d'aide |
| **Nœud sélectionné** | + surbrillance, **gizmo** | **barre d'actions** (Prolonger, Supprimer ; Aiguiller et Inverser si aiguillage), bulle d'aide, inspecteur si ouvert |
| **Voie / section sélectionnée** | + surbrillance, **gizmo**, badge de section (forcé visible) | **barre d'actions** (Scinder, Voie double, Supprimer…), bulle d'aide |
| Pose de rail, avant le 1er clic | aimantation, point d'accroche + libellé | bulle d'aide |
| Pose de rail, départ fixé | + aperçu, libellé, cote ; voie 2 et entraxe en voie double | carte de pose, bulle d'aide, pastille de saisie si chiffres |
| Courbe | idem + libellé rayon/angle ou refus | badge de phase, carte de pose, bulle d'aide, pastille de saisie |
| Aiguillage | aperçu, libellés ; **avertissement « fourche sans voie d'arrivée »** tant qu'il est en construction | carte de pose, bulle d'aide |
| Ciseaux | aperçu de découpe | bulle d'aide |
| Mesure | ruban + libellé | bulle d'aide |
| Mode train, pose | fantôme, indicateur d'accroche + son libellé | **badge de pose**, panneau train, bulle d'aide |
| Mode train, suppression | contour rouge + badge « Supprimer » | panneau train, bulle d'aide |
| Attelage | pastilles d'attelage + libellés | panneau train, bulle d'aide |
| Conduite | trains, squelette/vecteurs en option ; panneaux et avertissements de voie restent affichés | poste de conduite, bulle d'aide (longue), notifications |

---

## 4. Recouvrements et conflits repérés

### A. Autour de la sélection

1. **La barre d'actions cache le gizmo** **[code]** — ton exemple. Elle est centrée sur le même point que le gizmo, 54 px au-dessus. Or la flèche Y monte de 12 à 64 px et l'arc de rotation est à 58 px : la barre recouvre la pointe de la flèche Y et l'arc, et comme elle capte les clics, on ne peut plus les saisir à cet endroit.
2. **La barre d'actions disparaît près du haut de l'écran** **[code]** — elle est simplement masquée quand la sélection est à moins de 40 px du haut, au lieu de passer en dessous.
3. **La barre d'actions passe par-dessus la barre d'outils et l'inspecteur** **[code]** — son z-index (45) est supérieur aux leurs (15 et 20) : sélectionner un élément près du bord gauche ou sous le panneau droit la fait déborder sur eux.
4. **Badge de section sous le gizmo** **[à voir]** — quand une section est sélectionnée, son badge est forcé visible au milieu de la section, là où se place le gizmo.
5. **Avertissements sous le gizmo et la barre** **[à voir]** — losange, « Cassure », « SENS INTERDIT », panneau de fin de voie sont dessinés sur le nœud ; si on sélectionne ce nœud, gizmo et barre viennent au même endroit.
6. **Champ « Renommer la section »** **[à voir]** — il s'ouvre au point cliqué, là où la barre d'actions est déjà affichée pour la section sélectionnée.

### B. Pendant une pose

7. **Trois à quatre textes autour du curseur** **[à voir]** — libellé de l'aperçu, cote de longueur, libellé du point d'accroche (« +12,0 m ») et pastille de saisie se retrouvent dans la même zone.
8. **Deux libellés sur le véhicule fantôme** **[à voir]** — l'indicateur d'accroche dessine son propre libellé, et le badge « Attelé au train… » s'affiche 34 px au-dessus.
9. **Avertissement pendant la pose d'un aiguillage** **[code]** — la fourche sans voie d'arrivée est signalée par un losange pendant qu'on construit, à l'endroit de l'aperçu.
10. **Menu contextuel en pleine pose** **[code]** — un clic droit sur un nœud ou une voie ouvre le menu même si une pose est en cours ; il recouvre l'aperçu.

### C. Bas de l'écran

11. **Bulle d'aide trop longue** **[à voir]** — une seule ligne pouvant dépasser 150 caractères (conduite, pose) : sur une fenêtre étroite elle passe sous la mini-carte (bas gauche) et le poste de conduite (bas droite), ou revient à la ligne et remonte dans la carte de pose située 40 px plus haut.
12. **Poste de conduite sur les notifications** **[code]** — les deux sont fixés en bas à droite ; le poste de conduite (z-index 1000) est au-dessus des notifications (200). Les messages de refus (« aiguillage occupé », pose refusée) sont donc cachés précisément en conduite.
13. **Poste de conduite sur la barre d'état et l'inspecteur** **[code]** — fixé à 16 px du bas de la fenêtre, il mord sur la barre d'état (28 px) à droite, et recouvre le bas de l'inspecteur quand celui-ci est ouvert.
14. **Notifications sur l'inspecteur** **[code]** — même coin : elles couvrent le bas du panneau ouvert.

### D. Empilement général

15. **Échelle de z-index incohérente** **[code]** — badge de glisser 9999, poste de conduite et menu contextuel 1000, notifications 200, fenêtres 100, pastille de saisie 100, bouton « Prendre le contrôle » 50, barre d'actions 45, badge de pose 40, inspecteur 20, barre d'outils 15, mini-carte 8. Conséquence directe : le poste de conduite reste affiché **par-dessus** une fenêtre de réglages ouverte en conduite.
16. **Thème clair** **[code]** — barre d'actions, menu contextuel, badges, pastille de saisie et poste de conduite ont des couleurs sombres écrites en dur : ils ne suivent pas le thème.
17. **Rien n'est masqué pendant la conduite** **[code]** — panneaux de fin de voie, avertissements et badges de section restent affichés sous le train.

---

## 5. Questions à trancher ensemble

- **Où mettre les actions de la sélection ?** Au-dessus du gizmo (plus haut que l'arc), en dessous, sur le côté, ou seulement dans l'inspecteur et le menu contextuel ?
- **Une règle de priorité autour d'un point** : quand gizmo, barre, badge de section et avertissement tombent au même endroit, lequel reste et lesquels s'effacent ?
- **Une zone réservée par type d'information** : aide (bas centre), état de la pose (carte), conduite (bas droite), notifications (à déplacer, par exemple haut centre ou haut droite) ?
- **Bulle d'aide** : la raccourcir, la limiter à deux raccourcis, ou la remplacer par la barre d'état ?
- **Conduite** : quels éléments d'édition masquer (avertissements, badges, panneaux de fin de voie) ?
- **Une seule échelle de z-index** : dessin < panneaux < éléments flottants liés à la sélection < menus < poste de conduite < fenêtres < notifications.

---

## 6. Décisions (2026-10-04) et cible

Décisions prises par l'utilisateur :

1. **Barre contextuelle fixe** en bas au centre du canevas, qui change selon l'outil. Plus rien d'interactif ne flotte sur le dessin : le gizmo reste toujours libre.
2. **Plus de bulle d'aide permanente.** Restent les infobulles des boutons (avec leur raccourci) et la fenêtre des raccourcis.
3. **Notifications en haut au centre**, sous la barre du haut.
4. **Vue épurée en conduite** : on masque l'habillage d'édition.

### Zones

| Zone | Contenu |
|---|---|
| Haut gauche | barre d'outils |
| Haut centre | notifications |
| Haut droite | bouton et panneau de l'inspecteur |
| Bas gauche | mini-carte |
| **Bas centre** | **barre contextuelle** (une seule, jamais deux éléments empilés) |
| Bas droite | barre d'échelle ; poste de conduite en conduite, à l'intérieur de la zone du canevas |
| Sous le canevas | barre d'état |

### Barre contextuelle, outil par outil

| Outil / état | Contenu |
|---|---|
| Sélection, rien de sélectionné | barre absente |
| Sélection, un nœud | « Nœud » · Prolonger · Aiguiller et Inverser D/G si aiguillage · Voie double si possible · Supprimer |
| Sélection, voie(s) | « Voie » · Scinder · Voie double · Supprimer |
| Pose de rail | avant le départ : « Voie droite — départ » ; ensuite : longueur en direct, saisie numérique, Voie double (avec entraxe), Terminer |
| Courbe | étape 1/2 ou 2/2, rayon et angle en direct ou motif de refus, Voie double, Terminer |
| Aiguillage | étape, valide ou non, Annuler |
| Ciseaux | libellé de l'outil seul |
| Mesure | distance et angle en direct, Effacer |
| Navigation | barre absente |
| Train, pose | véhicule choisi · « Nouveau train T2 » ou « Attelé au train T1 · 3 véhicules » · Inverser le sens · Terminer |
| Train, sélection | véhicule sélectionné · Conduire · Supprimer |
| Train, suppression / attelage | libellé de l'état |
| Conduite | barre absente (le poste de conduite suffit) |

### Ce qui disparaît du dessin

Bulle d'aide, badge de phase, carte de pose, barre d'actions flottante, pastille de saisie près du curseur, badge sur le véhicule fantôme, bouton « Prendre le contrôle » et ancienne carte de conduite : leur contenu utile passe dans la barre contextuelle.

### Règles sur le dessin

- Pendant une pose, un seul texte près du curseur (la cote, ou le motif de refus) ; le libellé du point d'accroche ne s'affiche qu'avant le premier clic.
- Le badge d'une section sélectionnée ne se place jamais sous le gizmo.
- Pas d'avertissement sur le nœud en cours de construction.
- En conduite : pas de badge de section, de panneau de fin de voie, d'avertissement ni de gizmo ; barre d'outils réduite au bouton d'arrêt ; inspecteur fermé.

### Empilement (une seule échelle)

dessin < mini-carte < barre d'outils et inspecteur < barre contextuelle < poste de conduite < volets et menus déroulants < menu contextuel < fenêtres < notifications < badge de glisser.
