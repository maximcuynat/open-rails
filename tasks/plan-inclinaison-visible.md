# Plan — Rendre l'inclinaison visible (dévers et pentes)

Plan du 2026-10-05, à valider. Aucun code écrit. À lancer après la v0.3.0, sur une branche `feature/visible-inclination` partant de `developement`.

## Objectif

Aujourd'hui le dévers et la pente agissent sur le train (vitesse en courbe, déraillement, effort en rampe) mais ne se voient pas : le dévers n'apparaît que dans l'inspecteur, la pente que dans la console. On veut les lire sur le canevas, sans passer à un rendu 3D.

## Principe

- **Le train : par le calcul.** La caisse penche de l'angle réel, et on dessine ce qu'on verrait de dessus.
- **La voie : par convention.** La projection exacte ne montre rien (écartement réduit de 0,5 % pour 150 mm de dévers, longueur réduite de 0,06 % à 35 ‰) ; on utilise donc des signes de plan, comme sur une carte.
- **Rien ne change dans la physique.** Les trois lots ne font que lire ce qui existe déjà (`trackProfile`, `cantOn`, `segmentGradient`).
- **Échelle réelle seulement** pour le dévers, comme la physique : aux échelles de modélisme le profil de voie est vide, donc rien ne s'affiche.

## Décisions à valider avant de coder

1. **Convention du dévers sur la voie** (lot 2) : rail extérieur surligné, hachures du côté bas, ou ombre portée. À choisir sur maquette (étape 2.1), pas sur description.
2. **Affichage par défaut** : dévers et pentes visibles d'office, avec une case dans Affichage pour les masquer (recommandé), ou masqués d'office.
3. **En conduite** : garder les repères de pente et de dévers (recommandé : ils font partie de la voie, comme les panneaux de vitesse) ou les masquer avec le reste de l'habillage.
4. **Train déraillé** : le dessiner couché du côté extérieur de la courbe (recommandé, c'est l'aboutissement logique du lot 1) ou le laisser droit.

## Lot 1 — La caisse du train penche

### Ce qu'on verra

En courbe, le toit se décale par rapport au châssis et laisse voir une bande de flanc du côté opposé. À basse vitesse la caisse penche vers l'intérieur (excès de dévers) ; à la vitesse d'équilibre elle est d'aplomb sur la voie penchée ; en survitesse elle se redresse puis verse vers l'extérieur. À l'entrée d'une courbe, l'avant penche avant l'arrière.

### Étapes

- [x] 1.1 Recherche courte, notée dans `tasks/recherche-devers.md` : hauteur de caisse et coefficient de souplesse (roulis de la caisse sur ses suspensions par unité d'insuffisance de dévers) du TGV Duplex. Marquer « ESTIMÉ » ce qui n'est pas publié, comme le reste du catalogue.
- [x] 1.2 `domain/models/rollingStock.ts` : ajouter `height` et `rollCoefficient` au matériel (Duplex, TGV M).
- [x] 1.3 `domain/models/trackSpeed.ts` : exposer le dévers et le côté de la courbe à une position (`cantOn` est privé aujourd'hui ; `RailCurve.hand` donne le côté).
- [x] 1.4 Nouveau module pur `domain/models/bodyLean.ts` : pour un véhicule, l'angle de la caisse à chaque bogie = angle du dévers − souplesse × angle de l'insuffisance à la vitesse courante, signé vers l'intérieur de la courbe ; et le décalage du toit qui en découle (hauteur × sinus). Zéro en alignement et hors échelle réelle.
- [x] 1.5 Tests du module : alignement = 0 ; à l'arrêt en courbe = angle du dévers, vers l'intérieur ; à la vitesse d'équilibre = angle du dévers exactement ; en forte survitesse = vers l'extérieur ; rampe de dévers en bout de courbe = avant et arrière différents ; courbe à gauche et à droite symétriques ; rail parcouru dans les deux sens.
- [x] 1.6 `domain/models/train.ts` (`getTrainSetVisuals`) : ajouter à chaque véhicule le contour du toit, déduit de l'emprise au sol en décalant l'avant et l'arrière chacun de son décalage. L'emprise au sol ne change pas : la sélection, les collisions et l'attelage continuent de s'appuyer dessus.
- [x] 1.7 `infrastructure/render/renderer.ts` (`renderTrainSet`) : dessiner l'emprise dans la teinte du flanc, puis le toit par-dessus ; pare-brise, phares et soufflets suivent le toit. Palier « détail » seulement ; rien de plus aux paliers « ligne » et « schéma ».
- [x] 1.8 Tests du rendu (contexte simulé) : en alignement le dessin est identique à aujourd'hui ; en courbe le toit est décalé du bon côté ; aucun tracé supplémentaire aux paliers dézoomés ni hors champ.
- [x] 1.9 Si la décision 4 est « oui » : train déraillé dessiné couché vers l'extérieur.

## Lot 2 — Le dévers marqué sur la voie

- [ ] 2.1 (abandonnée : convention choisie sans maquette, rail extérieur surligné) Maquettes dans `tasks/maquettes/` : la même courbe (R 500 m, 150 mm) avec les trois conventions, en thème clair et sombre, à deux zooms. Choix par l'utilisateur.
- [x] 2.2 `infrastructure/render/` : nouveau module `cantRender.ts`, appelé avec les couches posées sous ou sur les rails d'un niveau (même endroit que les bandes de vitesse). Intensité proportionnelle au dévers (0 à 180 mm), côté donné par `RailCurve.hand`, et progressive sur les raccordements en bout de courbe.
- [x] 2.3 Mise en cache par révision de géométrie dans `networkDerived` : le profil de voie n'est pas recalculé à chaque image.
- [x] 2.4 Palier « détail » seulement ; ponts et tunnels respectés (tracé avec les rails de son niveau, estompé en tunnel).
- [x] 2.5 Case « Dévers et pentes » dans le menu Affichage, réglage enregistré avec les préférences d'affichage.
- [x] 2.6 Tests : rien en alignement, rien hors échelle réelle, côté correct à gauche et à droite, intensité croissante avec le dévers, rien au dézoom, niveau respecté.

## Lot 3 — Les pentes marquées sur la voie

- [x] 3.1 `domain/models/network.ts` : regrouper les rails consécutifs de même pente en « rampes » (s'appuyer sur `gradientRun` et `segmentGradient`), avec leur sens de montée.
- [x] 3.2 `infrastructure/render/` : chevrons le long de la rampe, pointe vers le haut, espacés d'un pas constant à l'écran ; une étiquette par rampe (« 35 ‰ ») au milieu, placée par le même mécanisme anti-recouvrement que les badges de section.
- [x] 3.3 Couleur d'alerte quand la pente dépasse la limite réglée (le diagnostic existe déjà : réutiliser son seuil, ne pas le dupliquer).
- [x] 3.4 Paliers : chevrons et étiquette en « détail », étiquette seule en « ligne », rien en « schéma ».
- [x] 3.5 Même case d'affichage que le lot 2.
- [x] 3.6 Tests : palier = aucun signe ; sens des chevrons selon le sens de montée, quel que soit le sens du rail ; une seule étiquette pour une rampe de plusieurs rails ; alerte au-delà du seuil ; valable à toutes les échelles (la pente ne dépend pas de l'échelle réelle).

## Vérification

- [x] `npm test`, `npm run typecheck`, `npm run build` verts à la fin de chaque lot.
- [x] Banc de mesure du rendu (`render.bench.ts`) avant et après : pas de régression mesurable sur 1 000 et 4 000 rails.
- [x] Contrôle dans le navigateur avec captures : courbe prise à l'arrêt, à la vitesse d'équilibre et en survitesse ; entrée et sortie de courbe ; rampe montante et descendante ; pont et tunnel ; thèmes clair et sombre ; un réseau en HO (aucun dévers affiché, pentes affichées).

## Hors périmètre

- Rendu 3D ou perspective.
- Tout changement de la physique, des vitesses limites ou des règles de déraillement.
- Dévers aux échelles de modélisme.
- Ombres portées générales (bâtiments, relief).

## Risques

- **Lisibilité** : à faible zoom le décalage du toit fait moins d'un pixel. Il ne faut pas l'exagérer, sinon on perd le lien avec la physique ; c'est le rôle des lots 2 et 3 de rester lisibles plus loin.
- **Données manquantes** : hauteur et souplesse du TGV M ne sont probablement pas publiées ; elles seront estimées et marquées comme telles.
- **Coût du dessin** : le lot 1 ajoute un contour par véhicule visible, le lot 2 un tracé par courbe visible. À mesurer, pas à supposer.
- **Fichiers très fréquentés** : `renderer.ts` et `train.ts` sont modifiés par presque tous les chantiers. Faire les trois lots à la suite sur une seule branche courte, et la fusionner vite.

## Revue

Réalisé le 2026-10-05 sur `feature/visible-inclination`, les trois lots à la suite. Rien n'est commité.

### Décisions prises

- Décisions 1 à 4 : rail extérieur surligné ; visible d'office avec la case « Dévers et pentes » ; gardé en conduite ; train déraillé couché vers l'extérieur.
- La case est enregistrée avec le projet, comme « Cantons » et « Réservations » (`hideInclination`, écrit seulement quand la case est décochée : un projet existant est réécrit à l'identique).
- L'inclinaison de la caisse ne dépend pas de la case : elle fait partie du train.
- Angle à l'arrêt : dévers × (1 + souplesse), d'après la formule de l'étape 1.4. L'étape 1.5 disait « = angle du dévers » ; c'est à la vitesse d'équilibre que l'angle vaut exactement celui du dévers.
- La caisse tourne autour de l'axe de la voie au niveau du rail ; vue de dessus, le toit est décalé de hauteur × sinus et rétréci du cosinus, et le flanc visible est tracé du côté opposé.
- Train déraillé : couché à 90° du côté extérieur de la courbe où il se trouve la première fois qu'il est dessiné déraillé ; le côté est gardé tant que dure le déraillement (clé : l'enregistrement `train.derailed`, non modifié). S'il n'a jamais été dessiné dans une courbe (hors champ ou dézoomé au moment du déraillement, projet rechargé), il reste droit.
- Dévers : mis en cache par profil de voie (`trackProfile` rend le même objet tant que la voie, les zones et les réglages de ligne ne changent pas) plutôt que dans `networkDerived`, dont l'empreinte ne suit ni le dévers saisi à la main ni les zones. Les rampes de pente, elles, sont dans `networkDerived`.
- Une rampe s'arrête à un changement de pente de plus de 0,5 ‰, à un sommet, à un creux et à tout nœud qui joint plus de deux rails (aiguillage compris).
- Couleurs : `--accent` pour le dévers, `--ink` / `--danger` / `--paper` pour les pentes. Le flanc du train reprend la teinte codée en dur des caisses.

### Tests

1 813 tests avant, 1 866 après (53 nouveaux, aucun modifié) : `bodyLean.test.ts` (18), `gradientRamps.test.ts` (8), `inclination.test.ts` (22, rendu des trois lots), `editorStore.inclination.test.ts` (5). `tsc --noEmit` et `vite build` verts.

### Banc de mesure (`render.bench.ts`, temps minimal par image en ms, machine chargée : les moyennes varient de ±10 %)

| | 8 px/m | 2,5 px/m | 1 px/m | 0,4 px/m | 0,1 px/m |
|---|---|---|---|---|---|
| 1 000 rails, avant | 4,81 | 7,85 | 1,48 | 1,33 | 0,25 |
| 1 000 rails, après, repères masqués | 4,55 | 6,85 | 1,36 | 1,33 | 0,25 |
| 1 000 rails, après, repères affichés | 4,63 | 7,44 | 1,35 | 1,34 | 0,25 |
| 4 000 rails, avant | 12,25 | 19,01 | 5,55 | 6,26 | 1,04 |
| 4 000 rails, après, repères masqués | 12,00 | 16,77 | 5,04 | 6,35 | 1,07 |
| 4 000 rails, après, repères affichés | 12,04 | 17,53 | 5,02 | 6,41 | 1,02 |

Le banc dessine désormais les repères (`BENCH_NO_INCLINATION=1` pour les retirer). Coût mesuré du dévers : environ 0,5 ms par image quand toutes les courbes du triage sont à l'écran (2,5 px/m), dans le bruit ailleurs ; rien aux paliers dézoomés. Le triage du banc n'a ni rampe ni train : les chevrons et la caisse penchée ne sont pas mesurés.

### Vu à l'écran (captures dans le dossier `inclinaison/` du bac à sable de la session)

- Train à l'arrêt en courbe (01, 02) : toit décalé vers l'intérieur d'environ 0,5 m, flanc visible côté extérieur. Lisible à partir de 10 px/m environ.
- Vitesse d'équilibre (03) : presque identique à l'arrêt (9 cm d'écart, 2 px à 22 px/m). Survitesse (04) : le flanc se réduit nettement, la caisse reste légèrement vers l'intérieur. C'est la physique réelle, pas un défaut de tracé.
- Entrée de courbe (05) : l'avant penche, l'arrière sur l'alignement est presque droit ; le surlignage du rail extérieur s'épaissit par paliers le long du raccordement.
- Déraillé (06) : bande de 4,3 m côté extérieur, le toit réduit à un trait ; le nez de la motrice n'est plus reconnaissable.
- Rampes (07 à 10) : chevrons vers le haut, étiquette « 30 ‰ », rouge au-delà de la limite (40 et 60 ‰), pointillés estompés en tunnel, tablier de pont respecté ; étiquette seule au palier « ligne ».
- Thème sombre (12 à 14), HO (15, 16 : aucun dévers, aucune caisse penchée, pentes affichées), case décochée (17), conduite (18 : repères conservés).

### Limites constatées

- Le surlignage du dévers et le flanc du train sont tous deux bleus et du même côté quand le train est à l'arrêt : ils se confondent sous le train.
- Près du seuil du palier « détail » (2 à 3 px/m), les chevrons font 2,5 px et se lisent mal sur un tablier ; l'étiquette porte alors l'information.
- Une étiquette de pente évite les badges de section, pas les marqueurs de diagnostic (« Pente 60 ‰ ») : les deux peuvent se toucher, et disent alors la même chose.
- Le contour de sélection suit l'emprise au sol, pas le toit : il est décalé de la caisse dessinée en courbe.

### Non vérifié

- Les vitesses des captures ont été posées sur le train (`currentSpeed`, `derailed`), pas atteintes en conduisant : la conduite réelle en courbe et un déraillement en marche n'ont pas été rejoués dans le navigateur.
- Sortie de courbe : non capturée (symétrique de l'entrée, couverte par les tests).
- La locomotive historique (`renderLocomotive`) ne penche pas.
- Menu Affichage : la case n'a pas été cliquée dans le navigateur ; la bascule est passée par `store.toggleInclination()` et par les tests du store.

### Estimé

- Coefficient de souplesse 0,2 (Duplex et TGV M), hauteur de la motrice du TGV M : voir la fin de `tasks/recherche-devers.md`.

### Deuxième passe (2026-10-05) : cinq défauts corrigés

- Flanc du train : gris ardoise (`TRAIN_FLANK_FILL`), distinct du toit bleu ciel et du surlignage du dévers (`--accent`), dans les deux thèmes.
- Chevrons : taille, pas et trait en pixels d'écran avec un minimum (9 px de large, pas de 32 px, trait de 1,6 px) et un liseré de la couleur du fond ; pas de 48 px en vue rapprochée (`chevronMetrics`).
- Étiquettes de pente : placées après les marqueurs de diagnostic et par le même mécanisme que les badges ; une étiquette qui toucherait un marqueur n'est pas dessinée.
- Contour de sélection : il entoure ce qui est dessiné (toit et flanc, `TrainVehicleVisual.drawn`) et passe par-dessus la caisse quand elle penche ; la sélection à la souris reste sur l'emprise au sol.
- Train déraillé : chaque véhicule garde sa silhouette point pour point (nez compris), large de la hauteur de caisse, de l'axe de la voie vers l'extérieur.
- Tests : 1 871 (5 de plus). Le test du pas des chevrons, écrit à la première passe, lit maintenant `chevronMetrics` : le pas n'est plus une constante.
- Vu à l'écran (captures `2x-*`) : arrêt en courbe clair et sombre, chevrons à 2,2 et 3 px/m, rampe raide avec son diagnostic, véhicule sélectionné, train couché, sortie de courbe, case « Dévers et pentes » cliquée dans le menu, déraillement atteint en conduisant (240 km/h dans la courbe de 500 m) : le train reste couché du même côté une fois sorti de la courbe.
- Conduite : les touches W et A ont été pressées ; Q (desserrer) doit rester enfoncée, elle a été tenue par un évènement `keydown` envoyé à la page.
- Reste : un train déraillé continue de glisser sur la voie pendant que la console annonce « Le train est immobilisé » (comportement existant, hors périmètre).
