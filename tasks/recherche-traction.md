Recherche du 2026-10-05, avant le plan de la physique de conduite. Lecture seule, aucun code modifié.

# Physique de conduite TGV (traction, roue libre, pente) : modèles et valeurs sourcées

Les coefficients de Davis de la base SNCF « Thor » (Dasye, POS) ont été retrouvés dans une thèse RFF/Ifsttar. Le modèle simple qui en découle reproduit le seul chiffre publié de montée en vitesse : 0→320 km/h en 316 s / 18,3 km calculé pour un TGV POS, contre 5 min 20 / 18 km publié.

Le freinage n'est pas couvert ici (autre recherche), sauf le frein électrodynamique en tant que limite d'effort moteur.

Niveaux de confiance : **[A]** plusieurs sources concordantes, **[B]** une seule source, **[C]** estimation de ma part (méthode indiquée).

## 1. Équation du mouvement

```
k · m · dv/dt = F_traction(v) − R(v) − m·g·sin(α) − R_courbe
```
Unités : m en kg, v en m/s, forces en N, g = 9,81 m/s².

| Élément | Valeur | Source | Conf. |
|---|---|---|---|
| Forme de l'équation | `k·M·γ = Fm − R − M·g·sin α` | Thèse Bosquet 2015, éq. 1.3 ; même forme dans le document V150 (Club de la Grande Vitesse Ferroviaire) | A |
| Masses tournantes k, rame TGV | 1,04 | Thèse Bosquet (tab. 2.5 et 3.1, valeur Thor ; revérifiée par calcul d'inertie sur les données SNCF du Duplex) | A |
| k rame V150 (grandes roues, 12 essieux moteurs) | 1,048 = (270 + 13)/270 | Document V150 §7.6 | B |
| k train remorqué par locomotive | 1,07 | Allenbach, corrigés d'exercices | B |

**Train long à cheval sur un changement de pente.** La littérature énergétique traite le train comme une masse ponctuelle (thèse Bosquet §1.4.1). Allenbach (exercice 15) prend la moyenne des déclivités pondérée par la longueur de train sur chaque tronçon. Pour le simulateur, à masse linéique uniforme, cela revient à **[C]** :
```
F_pente = m · g · (z_tête − z_queue) / L_rame
```
Cette forme lisse automatiquement les cassures de profil sur 200 m et utilise directement les hauteurs de nœuds. Variante plus fine : sommer `m_j·g·sin α_j` par véhicule (motrices de 68 t, plus lourdes au mètre).

## 2. Résistance à l'avancement (Davis)

`R = A + B·v + C·v²`. Conversions depuis les daN et km/h : A[N] = 10·A[daN] ; B[N·s/m] = 36·B[daN/(km/h)] ; C[N·s²/m²] = 129,6·C[daN/(km/h)²].

| Rame (masse de référence) | Formule publiée | A (N) | B (N·s/m) | C (N·s²/m²) | Source | Conf. |
|---|---|---|---|---|---|---|
| TGV Dasye, rame simple (430 t) | a = 0,6325 ; b = 0,00755 ; c = 0,0001244 par tonne | 2 720 | 116,9 | 6,933 | Thèse Bosquet fig. 1.12, base Thor | B+ |
| TGV POS, rame simple (420 t) | a = 0,6405 ; b = 0,00755 ; c = 0,0001214 par tonne | 2 690 | 114,2 | 6,608 | idem | B+ |
| TGV Sud-Est (masse non précisée) | 254 + 3,34·V + 0,0572·V² daN, V en km/h | 2 540 | 120,2 | 7,413 | Énoncés d'exercices (ilephysique, futura-sciences) | B |
| TGV Duplex 1re génération | Non publié séparément | prendre Dasye | | | Mêmes remorques et même nez | C |
| TGV M | Aucun coefficient publié | | | C ≈ 6,03 | Goeres (SNCF) : « réduit d'environ 13 % le coefficient de pénétration dans l'air » ; j'applique 0,87 au C du Dasye | C |
| Atlantique, Réseau | Non trouvés | | | | | |

- **Unités des coefficients Thor** : la thèse ne les écrit pas à côté de la figure. Je les ai déduites (daN/t, V en km/h) : cela donne 60,6 kN à 300 km/h, conforme à l'axe « R en Newton » de la figure.
- **Mise à l'échelle** : A et B suivent la masse, C non (aérodynamique).

Ordres de grandeur (Dasye 430 t, calculés) :

| v (km/h) | 100 | 200 | 300 | 320 |
|---|---|---|---|---|
| R (kN) | 11,3 | 30,6 | 60,6 | 67,9 |

Recoupements publiés :
- « 6 000 daN à 300 km/h contre environ 1 200 daN à 100 km/h » (note Objectif Carbone, citant un document SNCF).
- Traînée aérodynamique ≈ 80 % de R à 300 km/h, et R double entre 200 et 300 km/h (Goeres). Le modèle donne 79 % et un rapport de 1,98.
- Vent de face : +3 à 4 % sur C pour 10 km/h de vent à 540 km/h (V150).

## 3. Résistance de pente

- Exact : `F = m·g·sin α`. Usuel : `F ≈ m·g·i`, avec i en m/m.
- 1 ‰ = 9,81 N/t ≈ 1 daN/t, soit 0,00981 m/s² sans k et 0,00943 m/s² avec k = 1,04.
- Pour 430 t : 4,2 kN par ‰ ; une rampe de 35 ‰ coûte 148 kN (chiffre repris dans la thèse), soit plus que l'effort disponible au-dessus d'environ 225 km/h.

| Pente maximale | Valeur | Source | Conf. |
|---|---|---|---|
| LGV Sud-Est | 35 ‰ | Wikipédia FR (deux articles) ; récit La Vie du Rail | A |
| LGV dédiée voyageurs / ligne mixte | 35 mm/m / 12,5 mm/m | Thèse Bosquet (référentiels RFF) | B |
| LGV Cologne–Francfort | 40 ‰ | Wikipédia FR | B |
| Autres LGV françaises (25 ‰) | Non vérifié dans une source lue | | C |
| Lignes classiques | Non sourcé | | à chercher |

Conséquences calculées avec les jeux de paramètres du §9 **[C]** :

| | Duplex 424 t | TGV M 460 t |
|---|---|---|
| Vitesse d'équilibre en rampe de 25 ‰ | 225 km/h | 198 km/h |
| Vitesse d'équilibre en rampe de 35 ‰ | 184 km/h | 157 km/h |
| Entrée à 300 km/h dans 35 ‰, pleine puissance, après 1 / 3 / 5 km | 290 / 272 / 256 km/h | 289 / 269 / 249 km/h |

Repère réel : un TGV Sud-Est (6 450 kW), manipulateur à fond, franchit le sommet de la rampe de 35 ‰ du col du Bois-Clair à 200 km/h après l'avoir abordée vers 260 (La Vie du Rail, 1982). La longueur de la rampe n'est pas donnée.

## 4. Résistance en courbe

- Formule : pente équivalente `i_c = K/R` en ‰, avec K de 500 à 1 200 et 800 en moyenne (Rochard & Schmid, cités par la thèse §1.4.4). `F_c = m·g·(800/R)/1000`, R en m. **[B]**
- Röckl (650/(R−55) ‰ pour R ≥ 300 m) : cité de mémoire, non vérifié. **[C]**
- Négligeable sur LGV : moins de 1 kN pour R > 3 000 m sur une rame de 380 t (thèse), contre 60 kN de résistance à 300 km/h.
- Elle compte en dessous d'environ 1 000 m : 0,8 ‰ à 1 000 m, 2,7 ‰ à 300 m, 5,3 ‰ à 150 m. Dans l'éditeur, les rayons serrés de type réseau modèle la rendent significative.

## 5. Effort de traction

```
F(v) = cran · min( F_max , P_jante / v , μ(v) · m_adh · g )
v_transition = P_jante / F_max
```

| | Duplex (synchrone) | Dasye / Euroduplex / POS | TGV M |
|---|---|---|---|
| Puissance aux jantes, 25 kV | 8 800 kW [A] | 9 280 kW [A] | 7 760 kW (8 000 kW électriques) [A] |
| Puissance sous 1,5 kV | 3 680 kW [A] | 3 680 kW (7 200 kW sous 25 kV ligne classique) | 3 625 kW [B] |
| Effort au démarrage | 212 kN [B] | 220 kN [A] ; 223 kN selon Thor | 244 kN [B, non sourcé] |
| Effort à 320 km/h | 98 kN | 105 kN | 87 kN (calcul P/v) |
| Vitesse de transition P/F | 149 km/h [C] | 152 km/h [C] | 114 km/h [C] |
| Masse à vide | 380 t ; « en service » 390 t [A] | Dasye 380–384 t, tare 393 t ; Euroduplex 399 t | 413,5 t « en service » [B] |
| Masse en charge | 424 t [A] | 424–426 t ; 430 t dans Thor [A] | Non publiée ; plafond 476 t (17 t/essieu, 9 voitures) [B] |
| Essieux moteurs / masse adhérente | 8 / ≈136 t | 8 / ≈136 t (motrices de 68 t) [A] | 8 / ≈136 t [C] |
| Moteurs | 8 synchrones | 8 asynchrones | 8 asynchrones de 970–1 000 kW, sur bogie |
| Vitesse maximale | 300, puis 320 km/h | 320 km/h | 320 en service ; 350 (Wikipédia EN) ou 360 (FR) en conception |

Sources principales :
- **Duplex** : Wikipédia FR TGV Duplex et TGV Réseau (mêmes motrices ; 212 kN et 98 kN) ; Allenbach (« le TGV ne dispose que de 212 kN ») ; trains-europe.fr.
- **Dasye / POS** : tableau comparatif du document V150 (source Alstom/SNCF) ; thèse Bosquet tab. 3.1 ; Wikipédia FR Dasye, POS, Euroduplex.
- **TGV M** : Wikipédia FR ; blog cctbelfort ; Goeres. Les 244 kN ne figurent que dans l'infobox Wikipédia, sans référence.

**Forme réelle de la courbe (Dasye, Thor).** La puissance constante ne commence qu'au-dessus d'environ 180 km/h. En dessous, l'effort est limité par la chaîne de traction (tension, courant), pas par P/v (thèse §1.4.8). Le `min(F_max, P/v)` surestime donc un peu l'effort entre 100 et 180 km/h. Je n'ai pas pu extraire les points de la courbe (figure seulement).

**Rendement** jante/pantographe : 0,87 pour le POS (thèse, d'après Jeunesse & Rollin 2004). Utile seulement pour la consommation.

**Adhérence**

| Élément | Valeur | Source | Conf. |
|---|---|---|---|
| Plafond de dimensionnement traction (règlement) | 0,30 au démarrage ; 0,275 à 100 ; 0,19 à 200 ; 0,10 à 300 km/h | PTU LOC&PAS de l'OTIF, §4.2.8.1.2 (texte équivalent à la STI) | A |
| Curtius-Kniffler, rail sec | μ = 7,5/(V+44) + 0,161, V en km/h | Résultats de recherche (article MDPI, coalstonewcastle) ; forme confirmée par le manuel Open Rails | B |
| Curtius-Kniffler, rail mouillé | μ = 7,5/(V+44) + 0,13 | idem ; valable surtout jusqu'à 160 km/h | B |
| Rail sec et propre, avec antipatinage | 0,35 à 0,45 | Alacoque & Chapas | B |
| Rail humide ou gras | 0,15 à 0,35, typiquement ≈ 0,2 | idem | B |

Adhérence sollicitée (calcul, 136 t adhérentes) : 0,159 à 212 kN ; 0,165 à 220 kN ; 0,183 à 244 kN ; 0,083 à 300 km/h pour un Dasye. Un TGV n'est donc pas limité par l'adhérence sur rail sec. Sur rail gras (μ ≈ 0,10 à 0,15), l'effort au démarrage tombe vers 135 à 200 kN.

**Frein électrodynamique** (limite d'effort moteur, POS/Dasye) : 200 kN au maximum ; 1 100 kW par essieu en récupération, 945 kW en rhéostatique ; effort nul sous 10 km/h (thèse tab. 2.1 et fig. 2.18).

## 6. Accélérations résultantes

Valeurs publiées :

| Chiffre | Valeur | Source | Conf. |
|---|---|---|---|
| TGV POS, 0→320 km/h | 5 min 20 s sur 18 km | Wikipédia EN (« citation needed ») | B faible |
| TGV POS, accélération résiduelle à 320 km/h | 0,35 km/h/s = 0,097 m/s² | idem | B faible |
| Exigence réglementaire à la vitesse maximale de conception | ≥ 0,05 m/s² en palier, charge normale | PTU LOC&PAS | A |
| Exigence d'accélération moyenne (rames ≥ 250 km/h) | ≥ 0,40 m/s² de 0 à 40 ; ≥ 0,32 de 0 à 120 ; ≥ 0,17 de 0 à 160 km/h | idem | A |
| Dasye, accélération maximale mesurée en essais (LGV Rhin-Rhône) | 0,26 m/s² | Thèse Bosquet §3.4 | B |
| Dasye, paramètres de calcul horaire Thor | « accélération de confort » 0,25 m/s² ; « durée de démarrage » 25 s à 0,05 m/s² | Thèse tab. 3.1 | B |
| Trajet réel Paris–Bordeaux, montée à 296 km/h | 806 s (moyenne 0,10 m/s², limitations de sortie de Paris incluses) | Étude Comité TGV Réaction Citoyenne | B faible |

Prédictions du modèle du §9, pleine puissance, palier, sans plafond de confort **[C]** :

| | a à 0 km/h | a à 200 | a à 300 | a à 320 | 0→100 | 0→200 | 0→300 | 0→320 |
|---|---|---|---|---|---|---|---|---|
| Duplex 424 t | 0,48 m/s² | 0,29 | 0,10 | 0,07 | 59 s / 0,8 km | 130 s / 3,9 km | 289 s / 15,3 km | 354 s / 20,9 km |
| POS 420 t | 0,50 | 0,32 | 0,12 | 0,09 | 57 s / 0,8 km | 123 s / 3,6 km | 264 s / 13,7 km | 316 s / 18,3 km |
| TGV M 460 t | 0,50 | 0,23 | 0,08 | 0,05 | 56 s / 0,8 km | 137 s / 4,3 km | 339 s / 18,8 km | 424 s / 26,1 km |

En exploitation, l'accélération au démarrage est plafonnée vers 0,25 m/s² avec une mise en effort progressive. Le 0,5 m/s² théorique n'est pas ce que vit un voyageur.

## 7. Commande de traction en cabine

- **Deux commandes** : un manipulateur de traction (MP) et une vitesse imposée (VI).
- **MP continu, sans crans** : sur le TGV Sud-Est, il se déplace sur un « secteur intensité » et fixe le courant moteur, donc l'effort maximal autorisé. « À fond » correspond à l'intensité maximale (La Vie du Rail, 1982). **[B]**
- **VI = consigne de vitesse** : le dispositif module l'effort pour tenir cette vitesse, sans dépasser l'effort affiché au MP. Il déclenche automatiquement le frein électrique de maintien en pente. Conduite habituelle sur LGV : VI affichée et MP à fond. Si l'intensité affichée est insuffisante, la vitesse n'est pas tenue (La Vie du Rail ; cheminots.net). **[A]**
- **Générations suivantes** (Atlantique à Duplex) : manipulateurs traction-freinage jumelés gauche/droite, VI programmable (brevet EP0473512A1). Le manuel TSW2 du Duplex décrit un sélecteur de vitesse et un manipulateur en pourcentage. **[B]**
- **Mapping conseillé [C]** : cran n sur N → `F = (n/N) · min(F_max, P/v, adhérence)`. Ajouter une montée d'effort limitée (0 à 100 % en 5 à 10 s). Option : un mode VI où un régulateur ajuste l'effort entre le frein électrique maximal et le plafond fixé par le cran. La thèse Bosquet (§5) modélise ainsi le conducteur : régulateur proportionnel-intégral saturé à F_max, temps de réaction 1 s.

## 8. Marche sur l'erre

`a = −(A + B·v + C·v²) / (k·m)` en palier ; ajouter `−g·i/k` en déclivité.

| v (km/h) | 50 | 100 | 160 | 200 | 250 | 300 | 320 |
|---|---|---|---|---|---|---|---|
| Duplex 424 t (m/s²) | 0,013 | 0,026 | 0,049 | 0,069 | 0,100 | 0,137 | 0,154 |
| TGV M 460 t, estimé (m/s²) | 0,012 | 0,023 | 0,043 | 0,060 | 0,085 | 0,115 | 0,129 |

- Duplex en roue libre depuis 300 km/h en palier **[C]** : 250 km/h après 119 s / 9,0 km ; 200 km/h après 286 s / 19,4 km ; 100 km/h après 952 s / 45,6 km.
- Pente d'équilibre sur l'erre **[C]** : environ 14 ‰ à 300 km/h et 7 ‰ à 200 km/h. Une pente de 35 ‰ accélère donc fortement la rame.
- Recoupement qualitatif : La Vie du Rail décrit une trentaine de kilomètres sur l'erre avant Lyon. **[B]**

## 9. Valeurs recommandées pour le simulateur (SI)

| Paramètre | TGV Duplex | TGV M (Avelia Horizon) |
|---|---|---|
| Masse m | 424 000 kg en charge (390 000 à vide) [A] | 460 000 kg en charge [C] (413 500 à vide [B]) |
| k (masses tournantes) | 1,04 [A] | 1,04 [C] |
| Puissance aux jantes | 8 800 000 W [A] | 7 760 000 W [A] |
| Effort maximal | 212 000 N [B] | 244 000 N [B, non sourcé] |
| Vitesse de transition P/F | 41,5 m/s (149 km/h) | 31,8 m/s (114 km/h) |
| A | 2 680 N [C] | 2 910 N [C] |
| B | 115 N·s/m [C] | 125 N·s/m [C] |
| C | 6,93 N·s²/m² [B+] | 6,03 N·s²/m² [C] |
| Masse adhérente | 136 000 kg | 136 000 kg [C] |
| Adhérence sec / mouillé | 7,5/(V+44) + 0,161 / + 0,13 (V en km/h), plafonnée à 0,30 | idem |
| Vitesse maximale | 88,9 m/s (320 km/h) | 88,9 m/s (320 km/h) |
| Frein électrodynamique maximal | ≈ 200 000 N et ≈ 8 800 kW ; nul sous 10 km/h [C, par analogie POS] | Non trouvé |
| Plafond d'accélération en exploitation (optionnel) | 0,25 m/s² | idem |

- **A et B** : coefficients Thor du Dasye par tonne (0,6325 et 0,00755) multipliés par la masse.
- **Masse en charge du TGV M** : 413,5 t plus environ 600 voyageurs de 80 kg.
- **Variante Dasye / Euroduplex** : 9 280 kW, 220 kN, 430 t, A = 2 720, B = 116,9, C = 6,933.
- **Pas de temps de 16 ms** : Euler explicite suffit, la dynamique est très lente. Borner v à 0,5 m/s au minimum dans P/v.

## 10. Points de contrôle

1. **POS (9 280 kW, 220 kN, 420 t)** : 0→320 km/h en 320 s sur 18 km ; a(320) ≈ 0,097 m/s². Le modèle donne 316 s, 18,3 km et 0,090. Chiffre Wikipédia non référencé, probablement lui-même issu d'un calcul.
2. **Résistance en palier** : environ 60 kN à 300 km/h et 12 kN à 100 km/h ; rapport R(300)/R(200) ≈ 2 ; part aérodynamique ≈ 80 % à 300 km/h.
3. **Effort disponible à 320 km/h** : 105 kN (Dasye/POS), 98 kN (Réseau/Duplex).
4. **Accélération résiduelle à la vitesse maximale** : au moins 0,05 m/s². Le modèle donne 0,07 (Duplex) et 0,054 (TGV M) à 320 km/h.
5. **Accélérations moyennes minimales** : 0,40 / 0,32 / 0,17 m/s² sur 0–40 / 0–120 / 0–160 km/h. Le modèle TGV M donne 0,50 / 0,49 / 0,46.
6. **Démarrage** : 220 kN sur 430 t donne 0,49 m/s² théoriques. L'accélération maximale réellement mesurée sur un Dasye est de 0,26 m/s².
7. **Rampe de 35 ‰** : 148 kN de résistance de pente pour 430 t. Repère qualitatif : sommet franchi à 200 km/h par un TGV Sud-Est entré vers 260.
8. **Courbe** : moins de 1 kN pour R > 3 000 m sur une rame de 380 t.

## 11. Non trouvé ou contradictoire

- **Coefficients Davis du TGV M** : rien de publié. Seul le « −13 % » aérodynamique de Goeres existe. Avec mon estimation (460 t, C = 6,03), a(350 km/h) ≈ 0,016 m/s², en dessous des 0,05 exigés à la vitesse de conception. La masse en charge normale est donc plus faible, ou C plus bas, ou le −13 % ne s'applique pas tel quel. À traiter comme incertain.
- **Masse du TGV M** : 413,5 t « en service » (Wikipédia, composition non précisée) contre 476 t maximum (blog). La masse en charge normale n'est pas publiée. La vitesse de conception diverge aussi (350 ou 360 km/h).
- **Effort de 244 kN du TGV M** : infobox Wikipédia seulement, sans référence.
- **Coefficients propres au Duplex synchrone, au Réseau et à l'Atlantique** : non trouvés. La base Thor est confidentielle et l'article de Rochard & Schmid (2000) est payant. La thèse note une « sensible différence » entre Thor et Rochard pour un même matériel.
- **Masse du Duplex** : 380 t (à vide), 390 t (« en service »), 424 t (en charge), 430 t (Thor). Cohérent une fois les états de charge distingués, mais les fiches les mélangent.
- **Courbe effort–vitesse point par point** : seulement des figures. La zone 100–180 km/h du Dasye est sous l'hyperbole P/v ; l'écart n'est pas quantifié.
- **Temps 0→100, 0→200, 0→300 mesurés** pour Duplex et TGV M : aucun chiffre publié trouvé. Les fils fr.misc.transport.rail (« Accélération d'une rame TGV », « Caractéristiques dynamique ferroviaire ») existent mais n'ont pas pu être lus (Google Groups).
- **Pentes** : le « 25 ‰ ailleurs », les règles de la STI Infrastructure et les lignes classiques ne sont pas vérifiés dans une source lue.
- **Röckl et constantes de Curtius-Kniffler** : la première est de mémoire, les secondes viennent de résumés de recherche, pas d'un texte primaire lu.
- **Accès aux sources** : HAL bloque les robots ; la thèse Bosquet et l'étude du Comité TGV ont été lues via la Wayback Machine.

## Sources principales

- Thèse R. Bosquet (2015, Université de Nantes / RFF / Ifsttar) : https://theses.hal.science/tel-01201921 (copie lue : `https://web.archive.org/web/2020id_/https://tel.archives-ouvertes.fr/tel-01201921/document`)
- D. Goeres (SNCF), « Les chaînes de traction des TGV », Comptes Rendus Mécanique 2024 : https://comptes-rendus.academie-sciences.fr/mecanique/item/10.5802/crmeca.256.pdf
- « Le projet V150 », Club de la Grande Vitesse Ferroviaire : https://cgvf.fr/wp-content/uploads/2023/09/2022_04_03_V150_15-ans_AJ.pdf
- PTU LOC&PAS, OTIF (2022) : https://otif.org/fileadmin/new/3-Reference-Text/3D-Technical-Interoperability/3D1-Prescriptions-and-other-rules/PTU%20LOC%20PAS%202022-f%20En%20vigueur.pdf
- Alacoque & Chapas, « Gestion de l'adhérence » (Techniques de l'Ingénieur D 5535) : https://www.traction-electrique.ch/documents/Adherence.pdf
- Allenbach, corrigés d'exercices : https://www.traction-electrique.ch/documents/CorrigeTE.pdf
- Wikipédia FR : https://fr.wikipedia.org/wiki/TGV_Duplex · https://fr.wikipedia.org/wiki/TGV_Dasye · https://fr.wikipedia.org/wiki/TGV_R%C3%A9seau · https://fr.wikipedia.org/wiki/TGV_Euroduplex · https://fr.wikipedia.org/wiki/TGV_M · https://fr.wikipedia.org/wiki/LGV_Sud-Est · https://fr.wikipedia.org/wiki/Ligne_%C3%A0_grande_vitesse
- Wikipédia EN : https://en.wikipedia.org/wiki/TGV_POS · https://en.wikipedia.org/wiki/Avelia_Horizon
- TGV M : https://cctbelfort.canalblog.com/2025/09/les-rames-tgv-m-d-alstom.html
- Conduite : https://www.laviedurail.com/actualites/etait-vie-rail-31-conduire-tgv/ · https://www.cheminots.net/topic/28553-vitesse-impos%c3%a9e · https://patents.google.com/patent/EP0473512A1/fr
- Résistance : http://www.objectifcarbone.org/wp-content/uploads/2024/03/Objectif_Carbone_Note_TDN.pdf · https://www.ilephysique.net/sujet-forces-sur-un-tgv-183094.html · https://comitetgv.fr/wp-content/uploads/2022/01/REV-01-EtudeReductVitesse.pdf (lu via Wayback)
- Curtius-Kniffler : https://doi.org/10.3390/eng5030086 · https://open-rails.readthedocs.io/en/latest/physics.html

## Reproduire les chiffres « calcul »

Tous les chiffres marqués [C] des §3, §6 et §8 viennent d'une intégration d'Euler (pas de 10 ms) de l'équation du §1 avec `F = min(F_max, P/v)`, k = 1,04 et les paramètres du §9. Le script d'origine (`sim.py`) était dans le scratchpad de session et n'est pas conservé dans le dépôt ; il se réécrit en une trentaine de lignes à partir des formules ci-dessus.
