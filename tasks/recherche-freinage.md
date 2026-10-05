Recherche du 2026-10-05, avant le plan de la physique de conduite. Lecture seule, aucun code modifié.

# Freinage d'un TGV : modèles et valeurs chiffrées pour le simulateur

Aucun fichier du dépôt n'a été modifié (les téléchargements sont restés dans le scratchpad). Les valeurs réglementaires viennent de sources primaires lues en entier ; les valeurs propres au TGV Duplex / TGV M sont plus minces et je le signale à chaque fois.

**Point d'attention pour l'intégration :** toutes les décélérations réglementaires ci-dessous sont des décélérations *totales en palier* (freins + résistance à l'avancement). Si l'autre chercheur simule R(v) séparément, il faut retrancher R(v)/m de mes tables, sinon double comptage.

Niveaux de confiance : **A** = plusieurs sources ou texte réglementaire lu ; **B** = une seule source ; **C** = estimation de ma part (méthode indiquée).

## Sources lues

| Réf. | Document | URL |
|---|---|---|
| S1 | STI « matériel roulant grande vitesse » 2008/232/CE, §4.2.4 (texte complet) | https://www.legislation.gov.uk/eudn/2008/232/annex/division/4/adopted/data.xht |
| S2 | STI LOC&PAS 1302/2014, version OTIF en français, §4.2.4 | https://otif.org/fileadmin/new/3-Reference-Text/3D-Technical-Interoperability/3D1-Prescriptions-and-other-rules/PTU%20LOC%20PAS%202022-f%20En%20vigueur.pdf |
| S3 | EPSF SAM F 018, freinage sur ligne équipée de TVM (>220 km/h) | https://www.securite-ferroviaire.fr/sites/default/files/reglementations/pdf/2023-03/sam-f018-v1.pdf |
| S4 | EPSF SAM F 005 v2, performances de freinage, signalisation au sol | https://www.securite-ferroviaire.fr/sites/default/files/reglementations/pdf/2023-03/sam-f005-v2-mac.pdf |
| S5 | EPSF SAM F 301, organes de commande du frein en cabine | https://www.securite-ferroviaire.fr/sites/default/files/reglementations/pdf/2023-03/sam-f301-v1.pdf |
| S6 | EPSF SAM F 007, freins d'immobilisation | https://www.securite-ferroviaire.fr/sites/default/files/reglementations/pdf/2023-03/sam-f007-v1-mac.pdf |
| S7 | EPSF SAM F 006, freins dynamiques | https://www.securite-ferroviaire.fr/sites/default/files/reglementations/pdf/2023-03/sam-f006-v1-mac.pdf |
| S8 | TGVweb (recherche, motrice, signalisation, Duplex) | http://www.railfaneurope.net/tgv/research.html ; /motrice.html ; /signals.html ; /duplex.html |
| S9 | ACTGV, « Freinage trains » (extraits) | http://actgv.fr/wp-content/uploads/2018/10/Freinage-trains-Site-10-2018.pdf |
| S10 | Wikipédia EN KTX-I (dérivé du TGV Réseau), THSR 700T, Class 373 | https://en.wikipedia.org/wiki/KTX-I ; /THSR_700T ; /British_Rail_Class_373 |
| S11 | Wikipédia FR TVM, TGV Duplex, Avelia Horizon | https://fr.wikipedia.org/wiki/Transmission_voie-machine ; /TGV_Duplex ; /TGV_M |
| S12 | Powell & Palacín 2015, stabilité des voyageurs (Springer, accès libre) | https://link.springer.com/article/10.1007/s40864-015-0012-y |
| S13 | sterlingot.com, conduite du TGV | http://www.sterlingot.com/TGV/conduite.html |
| S14 | Cité des sciences, exposition grande vitesse | https://www.cite-sciences.fr/fr/ressources/expositions-passees/grande-vitesse-ferroviaire/lexposition/deplacer-un-train-de-400-tonnes-a-320-kmh |
| S15 | TGV 001, équipement de freinage (Marc Dufour) | http://emdx.org/rail/40ansTGV/D-EquipementDeFreinage.html |
| S16 | Railway PRO, contrat Knorr-Bremse Avelia Horizon | https://www.railwaypro.com/wp/knorr-bremse-wins-contract-for-avelia-horizon-trains/ |
| S17 | Forum cheminots.net (témoignages) ; commentaire LinkedIn d'un ancien de Carbone Lorraine | https://www.cheminots.net/topic/16587-temps-pour-d%C3%A9c%C3%A9l%C3%A9ration-durgence-tgv/ ; https://fr.linkedin.com/posts/fran%C3%A7ois-reiniche-7a708b142_le-freinage-sur-un-tgv-%C3%A7a-rigole-pas-72-activity-7117149568491745280-vSCK |

## 1. Décélérations réelles et exigées

Formule de distance d'arrêt de la STI (S1 §4.2.4.1.d), v en m/s, a en m/s², te en s :

```
S = V0·te + Σ_i (V_i² − V_{i+1}²) / (2·a_i)     (bornes de tranches : 300, 230, 170, 0 km/h)
te = temps mort + ½ · temps de montée (montée = temps pour atteindre 95 % de l'effort)
```

J'ai réintégré cette formule numériquement : elle redonne exactement le tableau 7 de la STI (5 360 / 3 650 / 2 430 / 1 500 m), donc tu peux la coder telle quelle.

Décélérations moyennes minimales en frein établi, palier (m/s²) :

| Mode | te (s) | 350–300 | 300–230 | 230–170 | 170–0 | Source | Conf. |
|---|---|---|---|---|---|---|---|
| Urgence cas A (rail sec, un frein dynamique isolé) | 3 | 0,75 | 0,90 | 1,05 | 1,20 | S1 tab. 6 | A |
| Urgence cas B (cas A + adhérence réduite + garnitures humides) | 3 | 0,60 | 0,70 | 0,80 | 0,90 | S1 tab. 6 | A |
| Service (minimum) | 2 | 0,30 | 0,35 | 0,60 | 0,60 | S1 tab. 8 | A |
| Service maximal, lignes TVM (France) | — | 0,70 (320–300) | 0,70 | 0,80 | 0,90 | S3 §7.2.2 | A |
| Urgence, lignes TVM (France, cumul des dégradations) | ≤ 3 | 0,675 (320–300) | 0,65 | 0,79 | 0,86 | S3 §7.3.1 | A |

- **Plafond absolu :** décélération moyenne < 2,5 m/s² tous freins confondus (S1 §4.2.4.5, repris S2). Tes 10 et 20 m/s² actuels sont 4 à 8 fois au-dessus.
- **Service ≤ urgence :** la STI demande de pouvoir limiter le service maximal sous l'urgence (S2 §4.2.4.5.3).
- **Service courant à grande vitesse :** il doit pouvoir se faire sans freins à frottement, donc au frein électrique seul (S3 §5.1).
- **Valeurs réelles :** KTX-I, 300→0 en 74 s et 3,3 km, soit ≈ 1,05–1,13 m/s² en moyenne (S10) ; « 4 km/h par seconde maximum » ≈ 1,11 m/s² (S17, conf. B) ; THSR 700T en service 0,34 m/s² à 300 km/h, 0,75 m/s² sous 70 km/h, urgence 1 m/s² (S10, à titre de comparaison, pas un TGV).

## 2. Distances d'arrêt publiées

| Cas | Distance | Source | Conf. |
|---|---|---|---|
| STI, urgence cas A, 350 / 300 / 250 / 200 km/h | ≤ 5 360 / 3 650 / 2 430 / 1 500 m | S1 tab. 7, S2 §4.2.4.5.2 | A |
| STI, urgence cas B, mêmes vitesses | ≤ 6 820 / 4 690 / 3 130 / 1 940 m | S1 tab. 7 | A |
| TGV, urgence 300 km/h, palier | 3 300 m | S13 ; KTX-I 3,3 km en 74 s (S10) ; ≈ 3 000–3 300 m selon garnitures (S17) | A |
| TGV, urgence 320 km/h | « plus de 3 km » | S14 | B |
| TGV, urgence 320 km/h, rame de 390 t | 3,3 km (tweet « Voie Libre SNCF », vu en extrait de recherche seulement) | — | B, douteux (voir §11) |
| Eurostar 373, 300 km/h | 2,7 km en 65 s (section marquée « sans source » sur Wikipédia) | S10 | B, faible |
| Séquence d'arrêt TVM 430, TGV Réseau à 300 km/h (service + marges) | 7 500 m = 5 cantons de 1 500 m | S8 | B |
| Séquence d'arrêt TVM depuis 300/320 km/h | 6–7 cantons, ≈ 10 km | S11 | B |
| Automotrice 200 km/h (pas un TGV), urgence, ≥ 8 bogies | ≤ 1 940 m, a ≥ 0,83 m/s² | S4 tab. 10 | A |
| Automoteur 160 km/h, urgence, ≥ 8 bogies | ≤ 1 250 m, a ≥ 0,83 m/s², te ≤ 3 s | S4 tab. 9 | A |

Non trouvé : distances réelles d'un TGV depuis 200 et 160 km/h, distance d'un arrêt de service chronométré, tout chiffre pour le TGV M.

## 3. Types de freins et plages d'efficacité

| Frein | Où | Valeurs | Source | Conf. |
|---|---|---|---|---|
| Rhéostatique | bogies moteurs | 30 kN par bogie moteur sur Duplex (24 kN avant), soit 120 kN pour 4 bogies | S8 | B |
| Rhéostatique, usage | — | seul à haute vitesse, combiné aux freins de roue sous un seuil ; absorbe près de la moitié de l'énergie d'un arrêt depuis Vmax | S8 | B |
| Récupération | — | les forums disent « rhéostatique seulement » pour les TGV classiques ; les infobox Wikipédia disent « regenerative » pour Duplex ; récupération confirmée pour le TGV M | S11, forum | contradictoire |
| Disques, bogies porteurs | 4 disques par essieu, acier, Ø 640 mm, 18,5 MJ par disque | S8, TD Lycée Brizeux (https://www.cpge-brizeux.fr/wordpress/wp-content/uploads/CI8_TD21-freinage-de-TGV_v20.pdf) | A |
| Disques flasqués sur roues motrices | Duplex et suivants, à la place des semelles | S8, S13 | A |
| Semelles | essieux moteurs des générations antérieures (PSE, Atlantique, Réseau, Eurostar) | S8, S10 | A |
| Courants de Foucault linéaire | absent des TGV de série ; prototype sur TGV Réseau (jusqu'à 16 % de l'effort) ; efficace au-dessus de ~220 km/h | S8 | B |
| Patins magnétiques | interdits au-dessus de 280 km/h par la STI ; présents sur le TGV 001 seulement | S1, S15 | A / B |
| TGV M | frein direct à commande électrique par bus (Knorr-Bremse), 3 disques par essieu au lieu de 4 (ce dernier point vu en extrait de recherche) | S16, S11 | B |

Conjugaison (S7) : l'effort est demandé en priorité au frein dynamique dans la limite de sa courbe F(v), le frottement complète. En urgence, si le dynamique est défaillant, le frottement donne son plein effort. En urgence réglementaire, le dynamique ne compte que s'il est indépendant de la caténaire (S1, S3).

```
F_dyn(v)  = min(F_dyn_max, P_dyn_max / v) · rampe_basse_vitesse(v)
F_frott   = max(0, F_demandé − F_dyn)
120 kN / 390 t ≈ 0,31 m/s²   (frein seul, hors résistance à l'avancement)
```

Non trouvé : P_dyn_max et la vitesse d'effacement du rhéostatique sur Duplex. Estimation (C) : effacement linéaire entre 30 et 10 km/h (le TGV 001 coupait le rhéostatique vers 40 km/h, S15).

## 4. Temps de réponse

| Grandeur | Valeur | Source | Conf. |
|---|---|---|---|
| Temps équivalent en urgence (V ≥ 250 km/h) | ≤ 3 s | S1, S2, S3 | A |
| Temps mort en urgence | ≤ 2 s | S2 | A |
| Temps équivalent en service | 2 s | S1 tab. 8 | A |
| Coupure de la traction en urgence | < 2 s | S2 | A |
| Serrage à fond : chute de 1,5 bar à la conduite générale (automoteur) | 3,5 ± 0,5 s | S5 | A |
| Première dépression : 0,35 bar | ≤ 0,5 s | S5 | A |
| Desserrage complet : 3,5 → 4,9 bar (automoteur) | 4 ± 0,5 s, puis < 5 s pour stabiliser | S5 | A |
| Remplissage des cylindres à 95 % (frein pneumatique de secours) | 3–5 s | S1 §4.2.4.8 | A |
| Vidange des cylindres jusqu'à 0,4 bar | ≥ 5 s | S1 §4.2.4.8 | A |
| Pente de variation du frein dynamique (règle locomotives) | ≈ 30 kN/s | S7 | B |

```
a(t) = 0                              pour t < t_mort
a(t) = a_cible · (t − t_mort)/t_montée  ensuite, plafonné à a_cible
te   = t_mort + t_montée/2
```

## 5. Adhérence

| Règle | Valeur | Source | Conf. |
|---|---|---|---|
| Adhérence maximale supposable, 30 < v < 250 km/h | 0,15 | S2 §4.2.4.6.1 | A |
| De 250 à 350 km/h | décroît linéairement de 0,05, soit 0,10 à 350 | S2 | A |
| Variante STI 2008 | 0,15 sous 200 km/h, linéaire jusqu'à 0,10 à 350 | S1 | A |
| Frein de stationnement | ≤ 0,12 | S2 | A |
| Service courant sur LGV | < 0,11 sous 200 km/h | S3 §6.1.1 | A |
| Sans anti-enrayeur | ≈ 0,09 (disques seuls), 0,11–0,12 (semelles fonte), 0,07–0,08 (composite) | S9 | B |
| Anti-enrayeur | obligatoire au-dessus de 150 km/h | S2 | A |

```
µ_max(v) = 0,15                                 si v ≤ 250 km/h
µ_max(v) = 0,15 − 0,05·(v_kmh − 250)/100        si 250 < v ≤ 350
a_frein_max(v) ≈ µ_max(v) · g                   → 1,47 m/s² sous 250 ; 1,13 à 320 ; 0,98 à 350
```

Rail mouillé : le cas B de la STI (0,60 / 0,70 / 0,80 / 0,90) revient à multiplier le cas A par 0,75–0,80. Un coefficient 0,75 est la façon la plus simple de le coder. Rail gras : un témoignage rapporte une glissade de plusieurs centaines de mètres (S17, anecdotique).

## 6. Confort

| Limite | Valeur | Source | Conf. |
|---|---|---|---|
| Jerk moyen en urgence (hors instant de l'arrêt) | ≤ 4 m/s³ sur 200 ms | S4 §5.2.2 | A |
| Voyageurs debout : accélération admissible, jerk | 0,11–0,15 g (1,1–1,5 m/s²), 0,30 g/s (≈ 2,9 m/s³) | S12 (Hoberock) | B |
| Perte d'équilibre debout face à la marche, sans appui | 0,13 g en moyenne | S12 (Hirshfeld) | B |
| Voyageurs assis délogés | 2,45 m/s² (siège transversal), 1,4 m/s² (siège longitudinal) | S12 | B |
| Jerk en service, transport urbain (EN 13452-1) | 1,5 m/s³ (extrait de recherche, norme non lue) | — | B, faible |

Pratique de conduite : on relâche le frein juste avant l'arrêt pour éviter l'à-coup (S12).

## 7. Effet de la pente

```
a_nette = a_frein_palier − g · i / 1000      (i en ‰, positif en descente ; g = 9,81)
        → 0,00981 m/s² par ‰ ; 35 ‰ = 0,343 m/s²
d = V0·te + Σ (V_i² − V_{i+1}²) / (2·(a_i − g·i/1000))
```

- **Masses tournantes :** l'ETCS divise par (1 + masses tournantes), soit environ 4 % de moins. Je cite cette formule de mémoire (Subset-026 §3.13), je ne l'ai pas relue : confiance C.
- **Correction réglementaire française :** S4 parle de « 1 500 m en palier ou l'équivalent selon les déclivités » sans donner la formule. Non trouvée.
- **Cas à étudier en forte pente (urgence, rail sec, S3 §7.4) :** 320 km/h sur 16 ‰, 300 sur 22 ‰, 270 sur 30 ‰, 230 sur 35 ‰. Ce sont de bons cas de test.
- **Maintien de vitesse :** sur 35 ‰, il doit être possible au frein dynamique seul (S3). C'est cohérent : 390 t × 0,343 ≈ 134 kN moins la résistance à l'avancement, contre 120 kN de rhéostatique.

Décélération nette en descente de 35 ‰ (calcul de ma part à partir des tables) :

| Freinage | > 300 km/h | 300–230 | 230–170 | < 170 |
|---|---|---|---|---|
| Service minimum STI (0,30 / 0,35 / 0,60 / 0,60) | −0,04 (le train accélère) | ≈ 0,01 | 0,26 | 0,26 |
| Service maximal TVM (0,70 / 0,70 / 0,80 / 0,90) | 0,36 | 0,36 | 0,46 | 0,56 |

## 8. Commande de frein en cabine

| Élément | Valeur | Source | Conf. |
|---|---|---|---|
| Conduite générale en régime | 5 ± 0,05 bar | S5 ; S8 | A |
| Conduite principale | 8–9 bar | S8 | A |
| Première dépression | 0,5 bar (4,5 bar) | S5 | A |
| Serrage gradué | pas de 0,05 bar ; desserrage par pas ≤ 0,1 bar | S5 | A |
| Serrage à fond (service maximal) | −1,5 bar, soit 3,5 bar ; « 1,5 à 2 bar » selon S4 | S5, S4, S8 | A |
| Urgence | vidange rapide, conduite générale à 0 bar (≤ 2 bar selon S1), traction coupée, desserrage inhibé | S5, S1, S2 | A |
| Commandes d'urgence | deux indépendantes, dont un coup-de-poing rouge ; l'autre peut être la position extrême du manipulateur | S2, S5 | A |
| Nombre de niveaux en service | au moins 7, desserrage et maximum compris | S2 §4.2.4.4.2 | A |
| Traction coupée dès qu'on freine | au-dessus de 15 km/h | S2 | A |

Le manipulateur des TGV actuels commande une pression cible de façon quasi continue (robinet électrique à impulsions, S5 ; un guide de simulateur décrit « serrer jusqu'à 4 bar », https://kdecherf.com/blog/2022/08/10/tsw2-conduire-un-tgv-duplex-200-sur-la-lgv-mediterranee/). Le seul TGV à crans documenté est le TGV 001 : 8 positions, 5 crans à 0,6 / 0,9 / 1,2 / 1,8 / 2,2 bar de dépression, le dernier étant l'urgence (S15).

Correspondance proposée pour le jeu (C) : B1 = −0,5 bar, B2 = −0,75, B3 = −1,0, B4 = −1,25, B5 = −1,5, urgence = vidange. La proportion d'effort par cran est un choix de ma part (voir §A).

## 9. Immobilisation en pente

| Exigence | Valeur | Source | Conf. |
|---|---|---|---|
| Tenue au frein à friction seul, sans air ni énergie, charge normale | 35 ‰ pendant ≥ 2 h | S1 §4.2.4.6 ; S6 (35 mm/m par défaut) | A |
| Tenue illimitée | 35 ‰, avec frein de stationnement et cales si besoin | S1 | A |
| Frein de stationnement, rame vide sans énergie | 40 ‰, serré automatiquement à la mise hors tension | S2 §4.2.4.5.5 et §4.2.4.4.5 | A |
| Frein d'immobilisation en ligne (FIL) | commande volontaire, cabine en service | S6, S9 | A |
| Mise hors service de la cabine | serrage maximal de service + urgence automatiques | S6 | A |

Je n'ai trouvé aucune retenue automatique du type « aide au démarrage en côte » sur les TGV classiques : si le conducteur desserre en pente sans traction, la rame part. Pour le TGV M, non documenté.

## 10. Masse freinée (λ)

- λ = masse freinée / masse du train × 100. La STI ne l'exige que pour les véhicules d'exploitation générale ; les rames fixes comme le TGV sont décrites directement par a(v) et te (S2).
- Conversion ETCS : a ≈ 0,0075·λ + 0,076 m/s² (extrait de recherche seulement, confiance B faible).
- λ d'un TGV : non trouvé. Je déconseille de passer par λ ; utilise les tables de décélération.

## A. Valeurs recommandées pour le simulateur

Tout ce tableau est une estimation de ma part (C), calée sur les sources ci-dessus. Décélérations totales en palier, rail sec, en m/s² :

| Cran | Dépression | > 300 km/h | 300–230 | 230–170 | < 170 | Arrêt depuis 300 km/h (te = 2 s) |
|---|---|---|---|---|---|---|
| B1 (20 %) | 0,5 bar | 0,15 | 0,17 | 0,20 | 0,22 | 18,3 km |
| B2 (40 %) | 0,75 bar | 0,30 | 0,34 | 0,40 | 0,44 | 9,2 km |
| B3 (60 %) | 1,0 bar | 0,45 | 0,51 | 0,60 | 0,66 | 6,2 km |
| B4 (80 %) | 1,25 bar | 0,60 | 0,68 | 0,80 | 0,88 | 4,7 km |
| B5 (service maximal) | 1,5 bar | 0,75 | 0,85 | 1,00 | 1,10 | 3,8 km |
| Urgence | vidange | 0,81 | 0,98 | 1,14 | 1,30 | 3,30 km en 72,8 s |

- **Courbe d'urgence :** c'est le cas A de la STI multiplié par 1,086, facteur ajusté pour donner 3 300 m depuis 300 km/h. Elle donne aussi 72,8 s, contre 74 s publiés pour le KTX-I. L'adhérence sollicitée reste ≤ 0,133.
- **B5 :** placé entre le minimum TVM (0,70–0,90) et l'urgence.
- **B2 :** à peu près le minimum de service de la STI, soit le frein électrique seul à haute vitesse.
- **B3 :** 6,2 km depuis 300 km/h, cohérent avec la séquence TVM de 7,5 km marges comprises.
- **Lissage :** interpole linéairement entre les centres de tranches pour éviter des marches de décélération.
- **Rail mouillé :** multiplier par 0,75 ; plafonner dans tous les cas à µ_max(v)·g.
- **Pente :** `a_nette = a_table·k_adhérence − g·i/1000 − (R(v)/m si la table est convertie en frein seul)`.
- **Établissement en service :** temps mort 0,5 s puis rampe de 3 s (te = 2 s).
- **Établissement en urgence :** temps mort 1 s puis rampe de 2 s (te = 2 s, sous la limite de 3 s), traction coupée immédiatement.
- **Desserrage :** rampe de 4 à 5 s.
- **Jerk :** 0,8–1,0 m/s³ en service, 4 m/s³ au maximum en urgence. Relâcher vers 3 km/h pour arrêter sans à-coup.
- **Arrêt en pente :** frein serré (B1 ou plus), la rame tient sur toute pente ≤ 40 ‰. Frein desserré sans traction, elle part à g·i/1000 moins la résistance. Option de jeu : serrage automatique quand v = 0 et manipulateur au neutre depuis plus de quelques secondes, façon frein de stationnement.
- **TGV M :** mêmes courbes faute de données ; temps de réponse plus court plausible (commande électrique directe), par exemple te = 1,5 s (C).

## B. Points de contrôle

| # | Test (palier sauf mention) | Attendu | Nature |
|---|---|---|---|
| 1 | Urgence 300→0 | 3 300 m, ≈ 74 s | réel (S13, S10) |
| 2 | Urgence 300→0 | ≤ 3 650 m | limite STI cas A |
| 3 | Urgence 200→0 | ≤ 1 500 m (mon modèle : 1 344 m) | limite STI |
| 4 | Urgence 250→0 | ≤ 2 430 m | limite STI |
| 5 | Urgence 320→0 | « plus de 3 km » ; mon modèle : 3 900 m ; borne TVM dégradée : 5 646 m | réel flou (S14) + calcul |
| 6 | Urgence rail mouillé 300→0 / 200→0 | ≤ 4 690 / 1 940 m | limite STI cas B |
| 7 | Service normal 300→0 | tient dans 7 500 m (5 cantons) ; ≈ 10 km depuis 320 | réel (S8, S11) |
| 8 | Service maximal 320→0, te = 2 s | ≤ 5 302 m | calcul d'après S3 |
| 9 | Urgence 160→0 | ≤ 1 250 m (mon modèle : 849 m) | S4, automoteurs |
| 10 | Urgence 230 km/h en descente de 35 ‰ | l'arrêt doit rester possible (mon modèle : 2 456 m) | cas S3 §7.4 |

## 11. Non trouvé ou contradictoire

- **Distance d'urgence depuis 320 km/h :** 3,3 km (tweet SNCF) et « ≈ 3 000 m à 4 km/h/s maximum » (LinkedIn) sont incompatibles avec 3 300 m depuis 300 km/h. À 1,11 m/s² constant il faut déjà 3 556 m depuis 320. Je retiens ≈ 3,8–3,9 km comme estimation et « > 3 km » comme seule valeur sûre.
- **Eurostar 2,7 km en 65 s depuis 300 km/h :** implique 1,28 m/s² moyen, au-dessus des autres sources, et la section n'est pas sourcée.
- **SAM F 018 :** le minimum d'urgence est inférieur au minimum de service maximal. Ce n'est pas une erreur de lecture (vérifié en extraction avec mise en page) : l'urgence cumule toutes les dégradations.
- **Frein électrique des Duplex :** rhéostatique seul ou récupération, sources contradictoires. Puissance maximale et vitesse d'effacement non trouvées.
- **Courbe de service réelle d'un TGV, crans réels du manipulateur Duplex / TGV M, λ d'un TGV :** non trouvés.
- **TGV M :** aucune performance de freinage chiffrée publiée. Wikipédia FR dit « pas de freinage pneumatique », Wikipédia EN dit « electro-pneumatic disc and tread ». L'interprétation la plus plausible est une commande électrique avec actionneurs pneumatiques.
- **Sources inaccessibles :** rapport BEA-TT d'Eckwersheim (PDF à police non extractible), article de l'International Railway Journal (403), fils fr.misc.transport.rail, fiches UIC 544-1 et EN 14531 (payantes).
