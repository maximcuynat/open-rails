Recherche du 2026-10-05, avant le plan dévers. Lecture seule, aucun code modifié.

# Dévers ferroviaire et vitesse en courbe : rapport de recherche

Aucun fichier du dépôt n'a été modifié. Les référentiels SNCF pour lignes classiques (IN 0272) et la STI ont été lus dans le texte ; le référentiel LGV (IN 3278) et la norme EN 13803 n'ont pas pu l'être, donc les valeurs LGV reposent sur la STI grande vitesse 2008 et sur des déductions signalées comme telles.

Niveaux de confiance : **A** = confirmé par plusieurs sources, **B** = une seule source, **C** = estimé ou calculé par moi (méthode indiquée).

Sources principales (abréviations utilisées ensuite) :
- **IN0272** : référentiel SNCF/RFF « Conception du tracé de la voie courante V ≤ 220 km/h » (2006), texte lu sur un miroir : https://kupdf.net/download/sncf-in0272-conception-du-trace-de-la-voie-courante-v-220-km-h_5ce1303fe2b6f55471c09df8_pdf
- **ERA** : avis ERA OPI-2019-2, qui cite le tableau d'insuffisances de l'IN0272 : https://www.era.europa.eu/system/files/2022-10/Opinion%20ERA-OPI-2019-2.pdf
- **STI-2014** : règlement (UE) 1299/2014 consolidé, § 4.2.4.2 à 4.2.4.4 : https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:02014R1299-20230928
- **STI-GV-2008** : décision 2008/217/CE, § 4.2.7 et 4.2.8 : https://eur-lex.europa.eu/legal-content/FR/TXT/HTML/?uri=CELEX:32008D0217
- **Noblet** : cours SNCF « Tracé de voie » (Y. Noblet, v6.1 2017) : http://bazar.perso.free.fr/Files/Other/DOCUMENTATION/Trace/Trace%20de%20voie_diapos.pdf ; formulaire associé : http://bazar.perso.free.fr/Files/Other/DOCUMENTATION/Trace/formulaire.pdf
- **WP-FR** : https://fr.wikipedia.org/wiki/Insuffisance_de_d%C3%A9vers ; **WP-DE** : https://de.wikipedia.org/wiki/%C3%9Cberh%C3%B6hung ; **WP-EN** : https://en.wikipedia.org/wiki/Cant_deficiency

---

## 1. Physique

Notations : `v` en m/s, `V` en km/h, `R` en m, `d` dévers posé en mm, `e` = 1500 mm (entraxe des points de contact roue-rail pour la voie de 1435 mm, et non 1435), `g` = 9,81 m/s².

| Grandeur | Formule SI | Forme pratique | Source | Confiance |
|---|---|---|---|---|
| Accélération centripète | `a = v²/R` | `a = V²/(12,96·R)` | physique | A |
| Dévers d'équilibre | `tan α = v²/(g·R)`, `D_eq = e·v²/(g·R)` (petits angles) | `D_eq = 11,8·V²/R` mm | IN0272 § 6.3, Noblet, WP-FR | A |
| Insuffisance | — | `I = 11,8·V²/R − d` (si > 0) | IN0272 § 6.6 | A |
| Excès | — | `E = d − 11,8·V²/R` (si > 0, train lent ou arrêté) | IN0272 § 6.7 | A |
| Accélération non compensée dans le plan de la voie | `a_q = v²/R − g·d/e` | `a_q = I/153` m/s² (Noblet écrit 152,928) | Noblet ; recalculé : 1500/9,80665 = 152,96 | A |
| Accélération ressentie en caisse | `a_voy = a_q·(1+s)` | `s` = coefficient de souplesse : environ 0,4 voiture Corail, 0,25 automoteur, 0,2 TGV | Noblet | B |

- Le coefficient 11,8 vaut `1500/(9,81·3,6²)` = 11,80 (recalculé).
- Repères : 100 mm ≈ 0,65 m/s² ; 130 mm ≈ 0,85 ; 150 mm ≈ 0,98 ; 160 mm ≈ 1,05 (correspondance confirmée par WP-DE et Noblet).

## 2. Valeurs limites réelles

**Dévers posé**

| Contexte | Valeur | Source | Confiance |
|---|---|---|---|
| SNCF, lignes classiques | 160 mm normal, 180 mm exceptionnel (interdit au-delà de 160 en présence d'appareils de voie) | IN0272 § 6.5, ERA | A |
| SNCF, le long des quais | 110 mm recommandé | IN0272, STI-2014 | A |
| SNCF, petits rayons | `d ≤ (R−100)/2` si la rampe de dévers ≤ 2 mm/m (variantes `(R−150)/2`, `(R−250)/3`) | IN0272, Noblet | A |
| STI-2014, voie ballastée | 160 mm (fret et mixte), 180 mm (voyageurs) | STI-2014 tab. 7 | A |
| STI-GV-2008 | 180 mm en conception ; 190 mm maximum en exploitation | STI-GV-2008 § 4.2.7 | B |
| LGV françaises | 180 mm maximum, « pour permettre l'arrêt d'un train en toute sécurité » | dossier d'enquête publique SEA, WP-FR | A |
| Allemagne (DB) | 160 mm ballast, 170 mm voie sur dalle, 180 mm plafond réglementaire | WP-DE | B |

**Insuffisance de dévers**

| Contexte | Normale | Exceptionnelle | Source | Confiance |
|---|---|---|---|---|
| SNCF catégorie I (fret) | 110 | 130 | IN0272 § 6.6, ERA | A |
| SNCF catégorie II (loco + voitures) | 150 | 160 (150 si V > 160) | idem | A |
| SNCF catégorie III (automoteurs, TGV sur ligne classique) | 160 | 180 (160 si V > 200) | idem | A |
| SNCF, cumul `d + I` sans dérogation | 290 / 330 / 340 mm (cat. I / II / III) | — | IN0272 | B |
| STI-2014, matériel voyageurs | 153 mm jusqu'à 300 km/h, 100 mm au-delà | — | STI-2014 tab. 8, WP-DE | A |
| STI-2014, wagons fret | 130 mm (V ≤ 160) | — | idem | A |
| STI-GV-2008, ligne neuve, 250 < V ≤ 300 | 100 | 130 (150 sans ballast) | STI-GV-2008 § 4.2.8.1 | B |
| STI-GV-2008, V > 300 | 80 | 80 | idem | B |
| STI-GV-2008, V ≤ 160 / ≤ 200 / ≤ 230 / ≤ 250 | 160 / 140 / 120 / 100 | 180 / 165 / 165 / 150 | idem | B |
| Allemagne (DB) | 130 | 150 | WP-DE | B |
| Pendulaires | France 260, Allemagne 300 (ligne Hof–Nuremberg) | — | Noblet, manuel Open Rails (table FACT), WP-FR | A |

**Excès de dévers** : 110 mm normal et 130 mm exceptionnel pour le fret ; 110 mm « souhaitable » pour le train de voyageurs le plus lent (IN0272 § 6.7, confiance B).

Les valeurs propres au TGV Duplex et au TGV M n'ont pas été trouvées ; par défaut, les traiter comme catégorie III sur ligne classique et selon la STI-GV sur LGV.

## 3. Rayons, vitesses et vitesse maximale en courbe

**Formule à coder**

```
V_max (km/h) = sqrt( (d + I_adm) · R / 11,8 )        d, I_adm en mm, R en m
v_max (m/s)  = sqrt( g · R · (d + I_adm) / 1500 )
R_min (m)    = 11,8 · V² / (d + I_adm)
```

WP-FR donne la règle française abrégée `R_min = (V/5,2)²`, soit `d + I` ≈ 319 mm (160 + 160), ce qui recoupe la formule.

**Tableau rayon → V_max en km/h (calculé par moi, confiance C)**

| R (m) | d=0, I=150 (voie sans dévers) | d=160, I=130 | d=160, I=150 (classique voyageurs) | d=180, I=150 | d=180, I=80 (LGV > 300) | d=180, I=100 (LGV ≤ 300) |
|---|---|---|---|---|---|---|
| 150 | 44 | 61 | 63 | 65 | 57 | 60 |
| 200 | 50 | 70 | 72 | 75 | 66 | 69 |
| 300 | 62 | 86 | 89 | 92 | 81 | 84 |
| 500 | 80 | 111 | 115 | 118 | 105 | 109 |
| 800 | 101 | 140 | 145 | 150 | 133 | 138 |
| 1000 | 113 | 157 | 162 | 167 | 148 | 154 |
| 1500 | 138 | 192 | 199 | 205 | 182 | 189 |
| 2000 | 159 | 222 | 229 | 236 | 210 | 218 |
| 3000 | 195 | 272 | 281 | 290 | 257 | 267 |
| 4000 | 225 | 314 | 324 | 334 | 297 | 308 |
| 5000 | 252 | 351 | 362 | 374 | 332 | 344 |
| 6000 | 276 | 384 | 397 | 410 | 364 | 377 |
| 7000 | 298 | 415 | 429 | 442 | 393 | 408 |

- La colonne d=180, I=130 est identique à d=160, I=150 (même somme de 310 mm).
- En exploitation, arrondir à l'inférieur au multiple de 5 ou 10 km/h.
- Les petits rayons sont aussi bornés par `d ≤ (R−100)/2` : à R = 300 m, d ≤ 100 mm, donc V_max ≈ 80 km/h et non 89.

**Rayons réels des LGV**

| Ligne | Rayon | Vitesse | Source | Confiance |
|---|---|---|---|---|
| LGV Sud-Est | 4000 m minimum ; 3200 m sur quelques courbes (7 selon Wikipédia, 3 selon tgveurofrance) | conçue pour 300, ouverte à 270 | https://fr.wikipedia.org/wiki/LGV_Sud-Est ; https://www.tgveurofrance.com/vitesse/caracteristiques/index.htm | A (rayon), contradictoire (nombre) |
| LGV Rhône-Alpes | 4000 m minimum | 300 | Wikipédia FR | B |
| LGV Nord, LGV Méditerranée | 6000 m, ponctuellement 4000 m | 300 à 320 | Wikipédia FR | B |
| LGV Est | 7143 m, exceptions à 5556 m | conception 350, exploitation 320 | https://de.wikipedia.org/wiki/LGV_Est_europ%C3%A9enne | B |
| LGV SEA | 6875 m recommandé, 5900 m normal, 5560 m exceptionnel | référence 350 | dossier d'enquête publique RFF 2007 (PDF sur maxou93600.free.fr) | B |
| LGV Sud-Est, courbe de 9000 m | dévers posé 78 mm | — | https://cpdp.debatpublic.fr/cpdp-interconnexionsudlgv/docs/etudes-complementaires/Etudes_techniques.pdf | B |

Déductions (confiance C, en supposant d = 180 mm dans les courbes les plus serrées) :
- SEA à 350 km/h : 5560 m donne I = 80 mm et 5900 m donne I = 65 mm, ce qui colle au plafond de 80 mm de la STI-GV au-delà de 300 km/h.
- LGV Sud-Est : 4000 m à 300 km/h donne I = 86 mm ; 3200 m à 270 km/h donne I = 89 mm.
- En pratique, à 320 km/h sur les LGV récentes, l'insuffisance reste faible (5556 m donne 37 mm).

## 4. Choix du dévers sur une ligne

- **Principe du compromis** : le dévers est inférieur au dévers d'équilibre du train le plus rapide, pour que le train rapide reste sous l'insuffisance admise et que le train lent ou arrêté ne dépasse pas l'excès admis (110 mm) ni n'use le rail bas (IN0272 § 6.4 et 6.7, Noblet ; confiance A).
- **Règle SNCF** : `d = 1000·C/R`, avec un coefficient C constant par section de ligne à trafic homogène. La valeur optimale est `C ≈ 0,006·V²` (V = vitesse du train le plus rapide), soit `d ≈ 6·V²/R`, environ 51 % du dévers d'équilibre (IN0272 § 6.4 ; confiance B, primaire).
- **Règle des « 7/10 »** : Wikipédia FR et trainconsultant.com donnent 70 % du dévers théorique à la vitesse maximale. Elle contredit l'IN0272 pour les lignes mixtes mais paraît plausible sur LGV : la courbe de 9000 m de la LGV Sud-Est a 78 mm, soit 66 % de l'équilibre à 300 km/h et 82 % à 270 (calcul C sur donnée B).
- **Allemagne** : dévers arrondi à 5 mm, minimum 20 mm (WP-DE, B).

**Règle automatique proposée (C, fondée sur ce qui précède)**

```
D_eq  = 11,8 · V_ligne² / R
k     = 0,5 (ligne mixte, IN0272)  ou  0,7 (LGV / trafic homogène rapide)
d     = k · D_eq
d     = max(d, D_eq − I_adm)              // tenir V_ligne quitte à monter le dévers
d     = min(d, d_max, (R − 100)/2)        // d_max = 160 (classique) ou 180 (LGV)
si V_lent est défini : d = min(d, 11,8·V_lent²/R + 110)   // excès ≤ 110 mm
d     = arrondi à 5 mm ; si d < 20 mm → 0
si D_eq − d > I_adm → la courbe impose V_max(R, d, I_adm) < V_ligne
```

Open Rails applique la même logique : paramètres par tranche de vitesse (sous-compensation fret 100 mm et voyageurs 150 mm, dévers minimal 10 mm, maximal 180 mm, précision 5 mm), calcul à partir du rayon et de la vitesse limite au chargement de la ligne (https://open-rails.readthedocs.io/en/latest/features-route.html, section « Defining Curve Superelevation »).

## 5. Raccordements

| Paramètre | Normal | Exceptionnel | Source | Confiance |
|---|---|---|---|---|
| Rampe de dévers `Δd/Δl` | 180/V mm/m (soit 50 mm/s, roulis 2 °/s) | 216/V (60 mm/s) | IN0272 § 6.8, Noblet | A |
| Plafond absolu de la rampe | 2,5 mm/m recommandé | 4 mm/m | IN0272 § 6.8 | B |
| Variation d'insuffisance `ΔI/Δt = I·V/(3,6·L)` | 75 mm/s (65 pour TGV entre 200 et 220 km/h) | 90 mm/s (75) | IN0272 § 6.9, Noblet | A |
| Discontinuité d'insuffisance sans raccordement (SNCF) | 50 mm | 75 mm | IN0272 § 6.11, Noblet | A |
| Idem (STI-2014) | 130 mm (V ≤ 60), 125 mm (≤ 200), 85 mm (≤ 230) ; interdite au-delà de 230 km/h | — | STI-2014 § 4.2.4.4 | B |
| Longueur du raccordement progressif | 60 m minimum | 50 m | IN0272 § 6.12 | B |
| Longueur minimale d'un alignement ou d'une pleine courbe | V/2 m | V/3 m | IN0272 § 6.12 | B |
| Doucines (arrondis aux extrémités de la rampe) | 30 à 40 m | 20 m | IN0272 | B |
| Confort en variation d'accélération (jerk) | 0,30 très bien, 0,45 bien, 0,70 acceptable | 0,85 m/s³ | Noblet | B |

**Longueur minimale prête à coder** (V en km/h, d et I en mm, L en m) :

```
L_min = max( d·V/180 , I·V/270 , 60 )          // exceptionnel : d·V/216, I·V/324, 50
```

- Exemple : V = 160, d = 160, I = 150 donne max(142 ; 89 ; 60) = 142 m.
- Extrapolation aux LGV (C) : V = 320, d = 180 donne 320 m. Le manuel Open Rails cite aussi 50 mm/s pour la France à grande vitesse (B).

**Ce qu'on perd à ignorer les raccordements** :
- Passer directement d'un alignement à un arc crée un à-coup d'accélération transversale.
- Le dévers n'a pas de place pour monter : en réalité, il s'établit dans le raccordement.

**Règle minimale proposée (C)** : garder la géométrie alignement + arc, mais faire monter le dévers linéairement sur `L = d·V/180`, centré sur le point de tangence (moitié dans l'alignement, moitié dans l'arc), et calculer `a_q` avec le dévers local. Si l'arc est plus court que V/2 m ou ne peut pas loger `L`, réduire le dévers (`d ≤ 180·L_dispo/V`), ce qui abaisse automatiquement la vitesse de la courbe.

## 6. Conséquences du dépassement

| Niveau | Seuil | Source | Confiance |
|---|---|---|---|
| Confort assis : très bien / bien / acceptable / exceptionnel | 1,0 / 1,2 / 1,4 / 1,5 m/s² ressentis | Noblet | B |
| Confort debout | 0,85 / 1,0 / 1,2 / 1,4 m/s² | Noblet | B |
| Base SNCF | 0,15 g ressenti (0,135 g recommandé), d'où I = 150 à 160 mm avec s = 0,4 | Noblet | B |
| Objets qui glissent des tables | au-delà d'environ 150 mm (6 pouces) | WP-EN, non sourcé dans l'article | B faible |
| Toujours sûr pour du matériel apte | 260 à 300 mm (pendulaires en service) | Noblet, WP-DE | A |
| Renversement | voir ci-dessous | — | C |

**Cas réels**

- **Eckwersheim, 14/11/2015** (TGV Duplex Dasye en essai) :
  - Courbe de 945 m de rayon, dévers 163 mm, praticable à 160 km/h, consigne d'essai 176 km/h (160 + 10 %).
  - Entrée en courbe à 265 km/h, 243 km/h au point de déraillement ; le résumé du BEA-TT retient 255 km/h comme vitesse d'approche. Renversement vers l'extérieur.
  - Sources : https://fr.wikipedia.org/wiki/Accident_ferroviaire_d%27Eckwersheim (qui cite le rapport BEA-TT) et https://www.bea-tt.developpement-durable.gouv.fr/eckwersheim-english-summary-a983.html. Confiance A pour le rayon et les vitesses, B pour le dévers.
  - Vitesse de renversement : environ 235 km/h selon la note d'étape du BEA-TT, 230 km/h selon les experts judiciaires. Ces deux chiffres viennent d'une source secondaire (https://victimestgvaccident.wordpress.com/2016/06/10/effet-centrifuge/) ; le PDF du rapport BEA-TT n'a pas pu être extrait en texte. Confiance B.
  - Mes calculs (C) : à 160 km/h, I = 157 mm (cohérent avec la limite SNCF de 160). À 235 km/h, I ≈ 527 mm, soit a_q ≈ 3,4 m/s². Le renversement arrive donc à environ 1,47 fois la vitesse limite.
- **Saint-Jacques-de-Compostelle, 24/07/2013** (Alvia série 730) :
  - Limite 80 km/h ; 195 km/h à 250 m de la courbe, 179 km/h au déraillement, soit 2,2 fois la limite (Wikipédia EN et FR ; confiance A).
  - Rayon : environ 400 m, estimation de sources secondaires ; je n'ai trouvé ni rayon officiel ni dévers. Confiance B faible.
- **La Milesse, 22/12/2019** (LGV BPL) :
  - Aiguille prévue à 100 km/h franchie à 165 km/h par un TGV, sans conséquence.
  - Critère de renversement EN 14363 monté à 0,7 (limite 1) ; accélération transversale en caisse multipliée par 4 ; effort sur la voie brièvement au-dessus de la limite.
  - Source : rapport BEA-TT, https://www.bea-tt.developpement-durable.gouv.fr/IMG/pdf/rapport_beatt_2020_01.pdf. Confiance B (primaire).

**Modèle de renversement (C)**

```
I_renv ≈ 1500 · (e/2) / h_eff       quasi-statique ; h_eff = hauteur efficace du centre de gravité
V_renv = sqrt( (d + I_renv) · R / 11,8 )
```

- Calage sur Eckwersheim : I_renv ≈ 500 à 530 mm, soit h_eff ≈ 2,1 m. Cette hauteur efficace inclut la souplesse des suspensions, ce n'est pas la hauteur géométrique.
- Rapport `V_renv / V_limite = sqrt((d+I_renv)/(d+I_adm))` : environ 1,5 sur ligne classique (d = 160, I = 150), 1,65 sur LGV (d = 180, I = 80), 1,85 sans dévers (I = 150).
- Les autres modes de déraillement (ripage de la voie, montée de roue) n'ont pas été chiffrés ; je n'ai pas de valeur sourcée.

## 7. Limites de vitesse en exploitation (France)

- **Ligne classique** : la vitesse limite dépend de la portion de ligne et de la catégorie de train. Les limitations permanentes sont signalées par un TIV à distance (losange si la chute est ≥ 40 km/h), une pancarte Z à l'entrée de la zone et une pancarte R à la sortie (https://fr.wikipedia.org/wiki/Signalisation_ferroviaire_en_France ; confiance B).
- **KVB** : contrôle par balises avec deux courbes de vitesse, alerte sonore à la première puis freinage d'urgence à la seconde. Il peut être installé ponctuellement, notamment pour les courbes de faible rayon (Wikipédia FR ; confiance B). Les marges de +5 et +10 km/h que j'ai en mémoire ne sont pas vérifiées.
- **LGV (TVM-300 / TVM-430)** :
  - Vitesse affichée en cabine par canton (environ 2000 m en TVM-300, 1500 m en TVM-430). Le code transmet la vitesse du canton courant, celle de fin de canton et celle de fin du canton suivant.
  - Une restriction ne peut commencer qu'à une limite de canton.
  - Freinage d'urgence au-delà d'une vitesse de prise en charge : 315 km/h pour 300 affichés.
  - Source : https://fr.wikipedia.org/wiki/Transmission_voie-machine ; confiance B.
- **Granularité** : une limite s'applique à une zone avec un début et une fin, pas à la courbe seule. À Eckwersheim, la zone à 160 commençait juste avant la courbe (confiance A).
- La liste exacte des paliers TVM n'a pas été vérifiée.

**Conséquence pour le modèle** : limite par section de voie, avec héritage de la vitesse de ligne ; la courbe fournit un plafond calculé. La limite effective est le minimum des deux.

## 8. Autres simulateurs

| Simulateur | Dévers | Survitesse en courbe | Source | Confiance |
|---|---|---|---|---|
| Open Rails | calculé automatiquement par courbe (rayon + vitesse limite) ou table rayon → dévers ; rampe limitée à 0,003 et 55 mm/s | `v = sqrt(E·g·r/G)`, E = dévers + insuffisance propre au véhicule (fret 0, voyageurs 75 mm, locomotives 150 mm par défaut) ; message d'avertissement, puis message de renversement ; pas de dégâts visuels | https://open-rails.readthedocs.io/en/latest/physics.html et options.html | B (documentation officielle) |
| OpenBVE | dévers en mm saisi par courbe dans la ligne (`Track.Curve Rayon; Dévers`) | renversement et déraillement par voiture, à partir de la largeur de caisse et de la hauteur du centre de gravité (1,6 m par défaut) | https://openbve-project.net/documentation_hugo/en/routes/csv.html et trains/train_dat.html | B (documentation officielle) |
| Train Simulator Classic | fixé par la règle de voie (angle maximal, pourcentage courbure → angle), pas par courbe | non établi | forums Steam | B faible |
| Trainz | réglable par point de voie ; purement visuel d'après un forum | mode de déraillement « réaliste » lié à la vitesse | forums Auran, wiki TrainzOnline | B faible |

À retenir : dévers dérivé automatiquement puis surchargeable, insuffisance admise portée par le matériel, deux seuils (confort puis renversement).

## 9. Modélisme (HO / N)

- **NEM 114 (MOROP, 2007)** : le dévers n'est pas nécessaire dynamiquement en modélisme et augmente le risque de basculement vers l'intérieur. S'il est posé pour l'esthétique, il ne doit pas dépasser G/15 : 1 mm en HO (écartement 16,5 mm), 0,6 mm en N (9 mm). Source : https://www.morop.org/downloads/nem/de/nem114_d.pdf ; confiance B (primaire).
- **Équivalent réel (C)** : 1 mm × 87 ≈ 87 mm en HO, 0,6 mm × 160 ≈ 96 mm en N.
- **Kato** vend des courbes Unitrack HO à dévers (R730, R790) ; la valeur du dévers n'a pas été trouvée.
- **Transposition (C)** : vitesse à l'échelle = vitesse réelle / échelle. L'accélération transversale réelle du modèle est alors divisée par l'échelle (87 en HO), d'où l'inutilité physique du dévers.
- **Pour le simulateur** : raisonner en équivalent grandeur réelle (`R_réel = R_modèle × échelle`) et appliquer les mêmes formules. Un rayon HO de 730 mm vaut 63,5 m réels, soit environ 28 km/h réels sans dévers avec I = 150 mm. Les courbes de catalogue sont donc bien plus serrées que la réalité : en mode maquette, il faudra désactiver la contrainte ou la rendre purement indicative.

---

## Modèle recommandé pour le simulateur

**Données à stocker**
- Par section de voie : `vitesseLimite` (km/h, optionnelle, héritée de la vitesse de ligne du projet) et `typeLigne` (`classique` ou `lgv`), qui fixe `d_max`, `k` et le plafond d'insuffisance.
- Par segment courbe : `devers` en mm, optionnel. S'il est absent, il est calculé par la règle du point 4 ; l'utilisateur peut le surcharger.
- Par matériel : `insuffisanceAdmise` (mm) et `hauteurCdgEfficace` (m).
- Le sens du dévers se déduit du sens de la courbe.

**Valeurs par défaut proposées**

| Paramètre | Ligne classique | LGV | Origine |
|---|---|---|---|
| `d_max` | 160 mm | 180 mm | IN0272, STI |
| `k` (part du dévers d'équilibre) | 0,5 | 0,7 | IN0272 ; indice LGV Sud-Est |
| `I_adm` pour TGV | 160 mm jusqu'à 200 km/h, 150 mm jusqu'à 220 | 130 mm jusqu'à 300, 80 mm au-delà | IN0272, STI-GV-2008 |
| Excès maximal | 110 mm | 110 mm | IN0272 |
| Rampe de dévers | 180/V mm/m | 180/V mm/m (extrapolé) | IN0272 |

**Calculs à chaque pas de simulation**

```
d_local = dévers interpolé (rampe du point 5)
I       = 11,8·V²/R − d_local             (alignement : I = −d_local dans la rampe)
a_q     = I / 153                          m/s², signée
a_voy   = a_q · (1 + 0,2)                  TGV
V_courbe = sqrt((d + I_adm)·R/11,8)        plafond de la section
```

**Seuils (C, calés sur les sources ci-dessus)**

| État | Condition | Effet suggéré |
|---|---|---|
| Normal | I ≤ I_adm | aucun |
| Inconfort | I_adm < I ≤ environ 230 mm (a_voy jusqu'à environ 1,5 m/s² ressentis × marge) | indicateur orange |
| Alerte de survitesse | V > V_limite + 5 % (TVM : 315 pour 300) | alarme, freinage automatique optionnel |
| Danger | 300 mm < I < I_renv | indicateur rouge ; au-delà du domaine des pendulaires |
| Renversement | I ≥ I_renv ≈ 525 mm, soit `1500·0,75/h_eff` avec h_eff ≈ 2,1 m | déraillement |

Le seuil de 525 mm repose sur un seul accident et sur un TGV Duplex ; il faudra le laisser paramétrable par matériel.

## Points de contrôle

| # | Cas | R (m) | d (mm) | V (km/h) | Attendu | Confiance |
|---|---|---|---|---|---|---|
| 1 | Eckwersheim, vitesse nominale | 945 | 163 | 160 | I = 157 mm, a_q ≈ 1,02 m/s², à la limite de cat. III | A (données), C (calcul) |
| 2 | Eckwersheim, renversement | 945 | 163 | 235 | I ≈ 527 mm, doit basculer ; à 176 km/h (I = 224 mm) ne doit pas basculer | B |
| 3 | LGV Sud-Est, rayon minimal | 4000 | 180 (supposé) | 300 | I ≈ 86 mm ; à 270, I ≈ 35 mm | A (rayon), C (dévers) |
| 4 | LGV Sud-Est, courbe de 9000 m | 9000 | 78 | 300 | I ≈ 40 mm ; à 230, léger excès de 9 mm | B |
| 5 | LGV SEA, rayon exceptionnel | 5560 | 180 (supposé) | 350 | I ≈ 80 mm, exactement le plafond de la STI-GV | B (rayon), C |
| 6 | LGV Est, rayon courant | 7143 | — | 320 | D_eq = 169 mm : aucun plafonnement, d calculé ≈ 120 mm avec k = 0,7 | B |
| 7 | Ligne classique à 160 | 1000 | 160 | 160 | D_eq = 302 mm, I = 142 mm, admissible ; `R_min = (160/5,2)²` ≈ 947 m | A |
| 8 | Règle IN0272 du dévers | 1000 | calculé | 160 | `d = 6·160²/1000` ≈ 154 mm, arrondi à 155 | B |
| 9 | Saint-Jacques-de-Compostelle | ≈ 400 (non confirmé) | inconnu | 80 limite, 179 réel | sans dévers : D_eq = 189 mm à 80 et 945 mm à 179 ; doit dérailler quel que soit le dévers plausible | A (vitesses), B faible (rayon) |

## Non trouvé ou contradictoire

- **Référentiel LGV IN 3278** : texte non accessible. Les insuffisances normales et exceptionnelles SNCF sur LGV, le dévers réellement posé par courbe et les règles de raccordement LGV sont donc déduits de la STI-GV-2008 et des rayons publiés.
- **Insuffisance admise du TGV** : sources contradictoires. WP-EN dit 102 mm (4 pouces), WP-FR dit 160 mm maximum en France, WP-DE dit jusqu'à 180 mm sur le réseau SNCF, l'IN0272 dit 160 mm (180 exceptionnel) pour la catégorie III. Lecture la plus cohérente : environ 100 mm ou moins sur LGV à grande vitesse, 150 à 160 mm sur ligne classique.
- **Part du dévers d'équilibre** : 7/10 selon Wikipédia et trainconsultant, environ 0,51 selon l'IN0272 (`C = 0,006·V²`). Je n'ai pas trouvé de source primaire pour le 7/10.
- **LGV Sud-Est** : 7 ou 3 courbes de 3200 m selon la source. Je n'ai pas confirmé le « 6000 à 7000 m pour 320 km/h » sous cette forme : les chiffres trouvés sont 6000 m (4000 ponctuellement) pour les LGV Nord et Méditerranée, et 7143 / 5556 m ou 6875 / 5900 / 5560 m pour une conception à 350 km/h.
- **EN 13803** : texte normatif non accessible (l'extrait public s'arrête avant les tableaux). Les valeurs de variation viennent de l'IN0272 et de la STI.
- **Saint-Jacques-de-Compostelle** : rayon et dévers officiels (rapport CIAF) non trouvés.
- **Eckwersheim** : la vitesse de renversement de 235 km/h vient d'une source secondaire citant le BEA-TT.
- **TGV Duplex et TGV M** : hauteur du centre de gravité, coefficient de souplesse propre et insuffisance d'homologation non trouvés.
- **Train Simulator et Trainz** : informations de forums uniquement.
- **Kato** : valeur du dévers des courbes Unitrack à dévers non trouvée.
- **Paliers de vitesse TVM et marges KVB** : non vérifiés.
- **Seuils de ripage de voie et de montée de roue** : aucune valeur sourcée ; seul le renversement est chiffré.

## Inclinaison de la caisse (recherche du 2026-10-05, pour `tasks/plan-inclinaison-visible.md`)

Deux chiffres manquaient pour dessiner la caisse penchée : la hauteur de caisse et le coefficient de souplesse.

| Donnée | Valeur retenue | Source | Statut |
|---|---|---|---|
| Hauteur des remorques du TGV Duplex | 4,32 m (4,318 m) | https://fr.wikipedia.org/wiki/TGV_Duplex ; https://tcdurable.canalblog.com/pages/tgv-duplex/32015650.html | publié (source secondaire) |
| Hauteur des motrices du TGV Duplex | 4,10 m | mêmes pages | publié (source secondaire) |
| Hauteur du TGV M | 4,32 m pour la rame | https://fr.wikipedia.org/wiki/Avelia_Horizon (« leur hauteur de 4,32 m ») | publié pour la rame ; appliqué aux remorques. Motrice : ESTIMÉ, 4,10 m comme le Duplex |
| Coefficient de souplesse | 0,2 | Noblet, déjà cité plus haut (« 0,4 voiture Corail, 0,25 automoteur, 0,2 TGV ») | ESTIMÉ pour le Duplex comme pour le TGV M : c'est la valeur « TGV » en général |

Non trouvé : aucune valeur mesurée du coefficient de souplesse propre au Duplex ou au TGV M. Le coefficient se mesure selon la fiche UIC 505-1 et l'EN 14363 (https://www.eurailtest.com/en/our-offer/roll-flexibility-coefficient/), mais les rapports d'essai ne sont pas publics. La hauteur du centre de roulis n'est pas publiée non plus : le dessin fait tourner la caisse autour de l'axe de la voie, au niveau du rail.

Conséquence chiffrée, sans exagération (écartement des contacts 1 500 mm, remorque de 4,32 m) :

| Cas, courbe à 150 mm de dévers | Angle de la caisse | Décalage du toit |
|---|---|---|
| À l'arrêt (excès de 150 mm) | 5,74° × 1,2 = 6,9° vers l'intérieur | 0,52 m |
| Vitesse d'équilibre | 5,74° vers l'intérieur | 0,43 m |
| Insuffisance de 300 mm | 3,4° vers l'intérieur | 0,26 m |
| Insuffisance de 525 mm (renversement) | 1,6° vers l'intérieur | 0,12 m |

Avec une souplesse de 0,2, la caisse ne penche vers l'extérieur que si l'insuffisance dépasse cinq fois le dévers : jamais avant le renversement sur une courbe à 150 mm, seulement sur une courbe peu déversée (moins de 105 mm). Le plan annonçait « en survitesse elle verse vers l'extérieur » : avec les chiffres réels elle se redresse, sans plus.
