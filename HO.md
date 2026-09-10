# Base de connaissance — Rails échelle HO

Reference document for the rail editor. All dimensions in model mm unless noted.

## 1. Normes de base

| Parametre | Valeur |
|---|---|
| Ratio echelle | 1:87 (Europe), 1:80 (Japon) |
| Ecartement des rails | 16.5 mm |
| Ecartement reel represente | Voie standard, 1435 mm |
| Norme europeenne | NEM 010 |
| Norme nord-americaine | NMRA S-1.2 |

## 2. Code des rails

| Code | Hauteur (mm) | Usage |
|---|---|---|
| Code 100 | 2.54 | Ancien standard, robuste |
| Code 83 | 2.11 | Standard actuel, voies principales |
| Code 70 | 1.78 | Voies secondaires |
| Code 55 | 1.40 | Reserve echelle N |

## 3. Kato Unitrack HO — rails droits

| Reference | Longueur (mm) | Description |
|---|---|---|
| 2-105 | 60 | Rail droit |
| 2-111 | 94 | Rail droit |
| 2-120 | 114 | Rail droit |
| 2-130 | 174 | Rail droit |
| 2-140 | 123 | Rail droit |
| 2-150 | 246 | Rail droit |
| 2-151 | 246 | Rail d'alimentation |
| 2-160 | 227 | Rail droit |
| 2-170 | 109 | Rail avec butoir |
| 2-180 | 369 | Rail droit |
| 2-193 | 149 | Rail droit |
| 2-401 | 60 | Croisement 90 degres |

## 4. Kato Unitrack HO — rails courbes

Toutes les courbes Kato font 22.5 degres (sauf 2-290 a 10 degres).
4 pieces = quart de cercle, 16 pieces = cercle complet.

| Reference | Rayon (mm) | Angle (deg) |
|---|---|---|
| 2-260 | 430 | 22.5 |
| 2-270 | 490 | 22.5 |
| 2-210 | 550 | 22.5 |
| 2-220 | 610 | 22.5 |
| 2-230 | 670 | 22.5 |
| 2-240 | 730 | 22.5 |
| 2-250 | 790 | 22.5 |
| 2-290 | 867 | 10 |

Rayon minimal recommande HO: 380 mm (15 pouces).

## 5. Conversion angle-cercle

| Angle unitaire | Pieces pour cercle complet |
|---|---|
| 22.5 | 16 |
| 15 | 24 |
| 10 | 36 |

## 6. Kato Unitrack HO — aiguillages

| Reference | Sens | Type | Rayon devie (mm) | Longueur (mm) | Angle (deg) |
|---|---|---|---|---|---|
| 2-840 | Gauche | #4 manuel | 490 | 246 | 22.5 |
| 2-841 | Droite | #4 manuel | 490 | 246 | 22.5 |
| 2-852 | Gauche | #4 manuel | 550 | 246 | 22.5 |
| 2-853 | Droite | #4 manuel | 550 | 246 | 22.5 |
| 2-860 | Gauche | #6 motorise | 867 | 492 | 10 |
| 2-861 | Droite | #6 motorise | 867 | 492 | 10 |
| 2-862 | Gauche | #6 manuel | 867 | 492 | 10 |
| 2-863 | Droite | #6 manuel | 867 | 492 | 10 |

Aiguillage #4: frog angle 22.5 degres, rayon devie 490-550 mm.
Aiguillage #6: frog angle 10 degres, rayon devie 867 mm.

## 7. Constantes de rendu (model mm)

- Gauge: 16.5 mm
- Code 83 hauteur: 2.11 mm
- Rail head width: ~1.0 mm
- Sleeper spacing: ~25 mm (HO)
- Sleeper length: ~22 mm (gauges + 5.5 mm)
- Sleeper width: ~2.5 mm
- Ballast width: ~28 mm

## 8. Bonnes pratiques

- Code 83 pour les voies visibles, code 100 pour zones cachees
- Rayon minimal 380 mm, preferer 550+ pour longs wagons
- Combiner plusieurs rayons pour ajuster la largeur d'une boucle
- Tester l'ecartement avec jauge NMRA
