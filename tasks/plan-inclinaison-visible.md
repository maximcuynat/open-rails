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

- [ ] 1.1 Recherche courte, notée dans `tasks/recherche-devers.md` : hauteur de caisse et coefficient de souplesse (roulis de la caisse sur ses suspensions par unité d'insuffisance de dévers) du TGV Duplex. Marquer « ESTIMÉ » ce qui n'est pas publié, comme le reste du catalogue.
- [ ] 1.2 `domain/models/rollingStock.ts` : ajouter `height` et `rollCoefficient` au matériel (Duplex, TGV M).
- [ ] 1.3 `domain/models/trackSpeed.ts` : exposer le dévers et le côté de la courbe à une position (`cantOn` est privé aujourd'hui ; `RailCurve.hand` donne le côté).
- [ ] 1.4 Nouveau module pur `domain/models/bodyLean.ts` : pour un véhicule, l'angle de la caisse à chaque bogie = angle du dévers − souplesse × angle de l'insuffisance à la vitesse courante, signé vers l'intérieur de la courbe ; et le décalage du toit qui en découle (hauteur × sinus). Zéro en alignement et hors échelle réelle.
- [ ] 1.5 Tests du module : alignement = 0 ; à l'arrêt en courbe = angle du dévers, vers l'intérieur ; à la vitesse d'équilibre = angle du dévers exactement ; en forte survitesse = vers l'extérieur ; rampe de dévers en bout de courbe = avant et arrière différents ; courbe à gauche et à droite symétriques ; rail parcouru dans les deux sens.
- [ ] 1.6 `domain/models/train.ts` (`getTrainSetVisuals`) : ajouter à chaque véhicule le contour du toit, déduit de l'emprise au sol en décalant l'avant et l'arrière chacun de son décalage. L'emprise au sol ne change pas : la sélection, les collisions et l'attelage continuent de s'appuyer dessus.
- [ ] 1.7 `infrastructure/render/renderer.ts` (`renderTrainSet`) : dessiner l'emprise dans la teinte du flanc, puis le toit par-dessus ; pare-brise, phares et soufflets suivent le toit. Palier « détail » seulement ; rien de plus aux paliers « ligne » et « schéma ».
- [ ] 1.8 Tests du rendu (contexte simulé) : en alignement le dessin est identique à aujourd'hui ; en courbe le toit est décalé du bon côté ; aucun tracé supplémentaire aux paliers dézoomés ni hors champ.
- [ ] 1.9 Si la décision 4 est « oui » : train déraillé dessiné couché vers l'extérieur.

## Lot 2 — Le dévers marqué sur la voie

- [ ] 2.1 Maquettes dans `tasks/maquettes/` : la même courbe (R 500 m, 150 mm) avec les trois conventions, en thème clair et sombre, à deux zooms. Choix par l'utilisateur.
- [ ] 2.2 `infrastructure/render/` : nouveau module `cantRender.ts`, appelé avec les couches posées sous ou sur les rails d'un niveau (même endroit que les bandes de vitesse). Intensité proportionnelle au dévers (0 à 180 mm), côté donné par `RailCurve.hand`, et progressive sur les raccordements en bout de courbe.
- [ ] 2.3 Mise en cache par révision de géométrie dans `networkDerived` : le profil de voie n'est pas recalculé à chaque image.
- [ ] 2.4 Palier « détail » seulement ; ponts et tunnels respectés (tracé avec les rails de son niveau, estompé en tunnel).
- [ ] 2.5 Case « Dévers et pentes » dans le menu Affichage, réglage enregistré avec les préférences d'affichage.
- [ ] 2.6 Tests : rien en alignement, rien hors échelle réelle, côté correct à gauche et à droite, intensité croissante avec le dévers, rien au dézoom, niveau respecté.

## Lot 3 — Les pentes marquées sur la voie

- [ ] 3.1 `domain/models/network.ts` : regrouper les rails consécutifs de même pente en « rampes » (s'appuyer sur `gradientRun` et `segmentGradient`), avec leur sens de montée.
- [ ] 3.2 `infrastructure/render/` : chevrons le long de la rampe, pointe vers le haut, espacés d'un pas constant à l'écran ; une étiquette par rampe (« 35 ‰ ») au milieu, placée par le même mécanisme anti-recouvrement que les badges de section.
- [ ] 3.3 Couleur d'alerte quand la pente dépasse la limite réglée (le diagnostic existe déjà : réutiliser son seuil, ne pas le dupliquer).
- [ ] 3.4 Paliers : chevrons et étiquette en « détail », étiquette seule en « ligne », rien en « schéma ».
- [ ] 3.5 Même case d'affichage que le lot 2.
- [ ] 3.6 Tests : palier = aucun signe ; sens des chevrons selon le sens de montée, quel que soit le sens du rail ; une seule étiquette pour une rampe de plusieurs rails ; alerte au-delà du seuil ; valable à toutes les échelles (la pente ne dépend pas de l'échelle réelle).

## Vérification

- [ ] `npm test`, `npm run typecheck`, `npm run build` verts à la fin de chaque lot.
- [ ] Banc de mesure du rendu (`render.bench.ts`) avant et après : pas de régression mesurable sur 1 000 et 4 000 rails.
- [ ] Contrôle dans le navigateur avec captures : courbe prise à l'arrêt, à la vitesse d'équilibre et en survitesse ; entrée et sortie de courbe ; rampe montante et descendante ; pont et tunnel ; thèmes clair et sombre ; un réseau en HO (aucun dévers affiché, pentes affichées).

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

_À remplir après réalisation._
