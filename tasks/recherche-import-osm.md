Recherche du 2026-10-06, avant le plan de l'import OpenStreetMap. Lecture seule, aucun code modifié.

# Import de réseaux réels depuis OpenStreetMap — état des données pour la France

Niveaux de confiance utilisés dans les tableaux :

- **C** — confirmé : plusieurs sources concordantes, ou mesuré par moi (Overpass / taginfo / en-têtes HTTP) le 2026-10-06.
- **S** — une seule source lue (page citée).
- **E** — estimé ou déduit par moi, non vérifié dans une page lue.

Abréviations de sources :

| Sigle | URL |
|---|---|
| ORM/T | https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging (révision du 2026-08-29) |
| ORM/FR | https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_France (marquée « WIP », révision du 2026-10-06 04:24 UTC) |
| ORM/FR-fr | https://wiki.openstreetmap.org/wiki/FR:OpenRailwayMap/Tagging_in_France (révision du 2026-09-03) |
| ORM/FR-talk | https://wiki.openstreetmap.org/wiki/Talk:OpenRailwayMap/Tagging_in_France |
| W:signal | https://wiki.openstreetmap.org/wiki/Tag:railway=signal |
| W:switch | https://wiki.openstreetmap.org/wiki/Tag:railway=switch |
| W:layer / W:bridge / W:tunnel / W:covered | https://wiki.openstreetmap.org/wiki/Key:layer , `Key:bridge`, `Key:tunnel`, `Key:covered` |
| W:position | https://wiki.openstreetmap.org/wiki/Key:railway:position |
| W:refSNCF | https://wiki.openstreetmap.org/wiki/FR:Key:ref:FR:SNCF_Reseau |
| W:overpass | https://wiki.openstreetmap.org/wiki/Overpass_API |
| OP:commons | https://dev.overpass-api.de/overpass-doc/en/preface/commons.html |
| TI-monde | https://taginfo.openstreetmap.org/ (API `/api/4/key/stats`) |
| TI-FR | https://taginfo.geofabrik.de/europe:france/ (données jusqu'au 2026-10-05) |
| OSMF:attr | https://osmfoundation.org/wiki/Licence/Attribution_Guidelines |
| OSMF:faq | https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ |
| SNCF | https://ressources.data.sncf.com/ (API `explore/v2.1/catalog/datasets`) |
| OSRD | https://github.com/OpenRailAssociation/osrd/tree/dev/editoast/osm_to_railjson |
| Mesure | mes requêtes Overpass du 2026-10-06, échantillons dans `tasks/import-osm-echantillons/` |

---

## 0. En bref

1. **Voies, topologie, ponts et tunnels, vitesses des voies principales : très bon.** Une voie OSM = une voie physique. Sur les quatre zones mesurées, 80 à 100 % de la longueur des voies principales porte `maxspeed`, 100 % porte `gauge`, 94 à 98 % l'électrification.
2. **« Qui passe au-dessus de qui » : décidable presque partout.** Sur 628 croisements géométriques sans nœud commun relevés dans les quatre zones, 619 (98,6 %) sont tranchés par les attributs ; **162 sur 162 pour les croisements voie ferrée × voie ferrée (`rail` × `rail`)**. Les 9 cas indécidables sont tous des tunnels de métro au même `layer`.
3. **Aiguillages : la position est fiable, le type ne l'est pas.** 79 à 98 % des nœuds de degré 3 sont marqués `railway=switch`, mais le côté de déviation n'est noté que sur 4 % des aiguillages français et la vitesse en déviation sur 0,3 %. Il faut tout déduire de la géométrie.
4. **Signaux : couverture très inégale, et deux schémas de valeurs coexistent.** 17 500 nœuds `railway=signal` en France, dont 5 473 seulement portent un signal principal français typé, et **la moitié de ceux-ci tiennent dans 8 cases de 0,25° autour de Paris**. Paris-Gare de Lyon : 256 signaux. Dijon-Ville : 9 signaux, aucun typé. LGV à Pasilly : 0. De plus la page de référence a été réécrite (2025-2026) : `FR:CARRE` (ancien, 1 682 objets) et `FR:C` (nouveau, 1 677 objets) désignent le même signal. **Importer les signaux réels n'est réaliste que comme option, zone par zone, avec génération automatique en repli.**
5. **Overpass est appelable depuis un navigateur (CORS ouvert, mesuré), mais le serveur public est saturé** : environ la moitié de mes requêtes ont reçu un 504, et la politique d'usage demande à une application de rester sous ~100 requêtes et ~10 Mo par jour **tous utilisateurs confondus**. Il faut un point d'accès configurable, un cache, et un import par fichier en secours.
6. **Le jeu de données ouvert « signalisation permanente » de SNCF Réseau a été retiré** (il n'existe plus sur le portail). Les autres jeux SNCF Réseau (vitesses, cantonnement, KVB…) sont sous ODbL mais datent de 2020-2022 et sont par ligne, pas par voie.

---

## 1. Voies

| Fait | Détail | Source | Conf. |
|---|---|---|---|
| Une voie OSM = une voie physique | « Each track is to be treated separately. Thus, double track lines are to be mapped with two separate tracks. » `tracks=*` n'est pas interprété par OpenRailwayMap. | ORM/T § Tracks | C (page + mesure : entraxe LGV mesuré 4,18 m entre voie 1 et voie 2) |
| `railway=rail` | voie active. Autres valeurs documentées : `proposed`, `construction` (+ `construction=*` pour le type), `disused` (rails en place, inutilisée), `abandoned` (plus de rails, plate-forme visible), `razed`, `narrow_gauge`, `light_rail`, `subway`, `tram`, `miniature`. | ORM/T | S |
| `subway` | « Do not map ordinary railway, which goes partially underground, with this tag » : le RER est en `railway=rail` + `tunnel=yes` + `layer` négatif, pas en `subway`. Vérifié : le RER A à Gare de Lyon est en `rail`, le métro en `subway`. | ORM/T, Mesure | C |
| `usage` | `main`, `branch`, `industrial`, `military`, `tourism`, `test`, `scientific`. À ne mettre **que sur les voies principales** (pas sur les voies de service). | ORM/T | S |
| `service` | `yard`, `siding`, `spur`, `crossover`. À mettre sur **toute voie qui n'est pas principale**. Donc : pas de `service` ⇒ voie principale. | ORM/T | C (mesure : toutes les voies ont l'un ou l'autre, presque jamais les deux) |
| `gauge` | écartement en mm, défaut 1435 ; plusieurs valeurs séparées par `;` pour 3 files de rails. | ORM/T | S |
| `electrified` | `contact_line`, `rail`, `4th_rail`, `ground-level_power_supply`, `no`, `yes` (déconseillé). `voltage` en volts, `frequency` en Hz (`0` = continu). | ORM/T | S |
| `tracks`, `passenger_lines` | `tracks` ignoré quand chaque voie est tracée. `passenger_lines` = nombre de voies de la ligne (vu : 1, 2, 4, 6, 8, 10) ; c'est une information sur la ligne, pas sur la voie. | ORM/T, Mesure | C |
| `ref` | numéro de la **ligne** (en France : code ligne RFN, ex. `830000`). | ORM/T, Mesure | C |
| `railway:track_ref` | numéro de la **voie** (vu : `1`, `2`, `1BIS`, `2M`, `U`, `E`, `A`…`I`, `J1618`). | ORM/T, Mesure | C |
| `ref:FR:SNCF_Reseau` | propre à la France, sur les voies : `ligne,tronçon,voie,PK début,PK fin` (ex. `905000,1,UNIQUE,133.682,232.968`). 87 312 voies en France. | W:refSNCF, TI-FR, Mesure | C |
| `name` | nom de la ligne (« Ligne de Paris-Lyon à Marseille-Saint-Charles »), parfois nom de voie (« Voie 4 ») contrairement à la règle. | ORM/T, Mesure | C |
| Sens de circulation | `railway:preferred_direction=forward/backward/both` (par rapport au sens du tracé OSM) ; `railway:bidirectional=regular/signals/possible`. | ORM/T | S |
| Relations de ligne | `type=route` + `route=tracks` (l'infrastructure : la ligne) ; `route=railway` (itinéraire d'exploitation). **En France, les lignes sont en `route=railway`** : aucune relation `route=tracks` dans les quatre zones, 24 relations `route=railway` (dont des relations « voie 1 / voie 2 de la ligne… »). | ORM/T, Mesure | C |
| Systèmes de sécurité sur la voie | `railway:kvb=yes/no`, `railway:tvm=300/430/yes/no`, `railway:etcs=1/2/yes/no`, `railway:crocodile=yes/no`, `railway:bal=yes/no`, `railway:bapr=yes/no`, `railway:bm=yes/no/bmu/bmus/bmcv/bamu…`. Un projet de remplacement par `railway:train_protection` est en brouillon. | ORM/T § Train protection systems | S |
| … et leur usage réel en France | `railway:kvb` 84 797 objets, `railway:tvm` 26 522, `railway:etcs` 22 620 ; **`railway:bal` 0 (monde), `railway:bapr` 44, `railway:bm` 0** : le mode de cantonnement n'est pas dans OSM. | TI-FR, TI-monde | C |

## 2. Niveaux : pont, tunnel, `layer`

### 2.1 Règles de marquage

| Règle | Texte ou fait | Source | Conf. |
|---|---|---|---|
| `layer` est **local et relatif** | « Layer provides absolutely no information about relative or absolute height difference of objects which do not immediately cross or overlap. A change in layer should not be used to indicate a change in elevation. A bridge is at layer 1 even if it is only several feet above sea level while the peak of Mount Everest is at layer 0. » | W:layer | S |
| Valeur implicite | « All ways without an explicit value are assumed to have layer 0. » `0` ne s'écrit pas. Valeurs usuelles de −5 à 5. | W:layer | S |
| Pont ou tunnel sans `layer` | « Although some map rendering and quality assurance services assume that bridges and tunnels are at layers +1 and −1 respectively, it is better to explicitly state the layer. » ORM/T donne `layer=1` comme défaut d'un pont et `layer=-1` comme défaut d'un tunnel. **Donc : pont sans `layer` ⇒ +1, tunnel sans `layer` ⇒ −1, par convention des consommateurs, pas par règle stricte.** | W:layer, ORM/T § Bridges, § Tunnels | C |
| Plus petite valeur suffisante | « Only use layer=2 for a bridge that passes over a feature that is already at level 1; similarly only use layer=-2 for a tunnel that passes below another tunnel. » Mais : « some higher values are often locally used/reserved for very long bridges or underground networks ». | W:layer | S |
| `layer` seulement avec un ouvrage | « Only ways with one of the tags tunnel, bridge, highway=steps, highway=elevator, covered should be tagged with the layer tag, similar for railways. » Pas de `layer` pour un remblai ou une tranchée : `embankment=yes`, `cutting=yes`. | W:layer | S (et **contredit par la mesure**, voir 2.2 : 140 voies au sol avec `layer=-1` à Paris) |
| Où la voie est coupée | Pont : « Split the upper way at each end of the bridge (which is where it joins solid ground). » La rampe d'accès « is not part of the bridge ». Tunnel : « Split the way at the points where the tunnel starts and ends. » **Le nœud de bout est donc au pied de l'ouvrage (culée, tête de tunnel) : la portion marquée est entièrement en ouvrage, la rampe est dans la voie voisine, qui est au niveau 0.** | W:bridge, W:tunnel | C (mesure : 100 % des bouts de pont joignent une voie sans `layer`) |
| Jonction sur l'ouvrage | « It is good practice to not let a bridge terminate at a road junction » ; idem tunnel. Non respecté pour le rail : voir 2.2. | W:bridge, W:tunnel | C |
| `tunnel=building_passage` | passage sous un bâtiment ; « should normally not have a layer assigned as there is no clear above/below relation to the building ». | W:tunnel | S |
| `covered=yes` | voie couverte par un bâtiment ou une structure sans que ce soit un tunnel (ouverte au moins d'un côté, tranchée couverte, halle). Pas de relation de niveau. | W:covered | S |
| Métro et réseaux souterrains | « For metros/subways or other very long ways, it is often convenient to use layer=-2 to accommodate underground passages for pedestrians. » | W:tunnel | S |
| Gares à plusieurs niveaux | la règle générale renvoie à `level=*` (étages d'un bâtiment) plutôt qu'à `layer`. En pratique les deux sont posés : à Paris 268 voies `rail` portent `level` (de −8 à 1) et 437 portent `layer`. | W:layer, Mesure | C |
| `ele`, `incline` | altitude et pente existent comme clés mais sont quasi absentes : `ele` sur 49 voies à Paris (deux valeurs seulement), `incline` sur 0 voie dans les quatre zones. | ORM/T, Mesure | C |
| Valeurs de `bridge` | `yes`, `viaduct`, `cantilever`, `covered`, `movable`, `trestle`. Valeurs de `tunnel` : `yes`, `building_passage`, `avalanche_protector` ; vu aussi `tunnel=covered` (6 voies à Dijon, non documenté dans les pages lues). | ORM/T, W:tunnel, Mesure | C |

### 2.2 Mesures (chiffre clé)

**Méthode.** Projection locale des nœuds, puis recherche de toutes les paires de segments appartenant à deux voies différentes, **sans nœud commun**, qui se coupent réellement. Voies prises en compte : `railway` ∈ `rail`, `light_rail`, `subway`, `tram`, `narrow_gauge`, `disused`, `construction`, `abandoned`. Un croisement est dit **décidable** si (A) les `layer` des deux voies diffèrent (absent = 0 ; une valeur multiple `-1;-2` est traitée comme un intervalle, et il faut que les intervalles soient disjoints), ou (B) les `layer` sont égaux mais l'une des deux voies est un pont ou un tunnel et l'autre est au sol. Tout le reste est indécidable. Calcul exact sur l'ensemble des données de chaque zone, pas un échantillon.

| Zone | Croisements (tous types de voies) | Décidables | dont `rail` × `rail` | `rail` × autre (métro, tram, désaffecté) | Indécidables |
|---|---|---|---|---|---|
| (d) Paris Gare de Lyon – Charenton | 603 | 594 (98,5 %) | **157 / 157** | 372 / 372 | 9 : métro × métro, deux tunnels à `layer=-2` (autour de la voie 206318501) |
| (a) Dijon-Ville | 23 | 23 (100 %) | 3 / 3 | 20 / 20 (tram) | 0 |
| (b) Clelles-Mens | 0 | — | — | — | — |
| (c) LGV, bifurcation de Pasilly | 2 | 2 (100 %) | 2 / 2 (saut-de-mouton) | — | 0 |
| **Total** | **628** | **619 (98,6 %)** | **162 / 162** | 392 / 392 | 9 |

Sur les 594 croisements décidables de Paris, 590 le sont par des `layer` différents (cas A) et 4 seulement par le cas B. Aucun croisement « au sol × au sol sans nœud commun » (qui serait une erreur de carte) n'a été trouvé.

Combinaisons les plus fréquentes à Paris (dessus → dessous) : pont `1` sur sol `0` : 140 ; sol `0` sur tunnel `-2` : 67 ; sol `0` sur tunnel `-1` : 54 ; sol `0` sur tunnel `-4;-5` : 41 ; pont `1` sur tunnel `-2` : 37 ; pont `1` sur tunnel `-1` : 32 ; tunnel `-1` sur tunnel `-2` : 29 ; pont `2` sur tunnel `-1` : 20 ; passage sous bâtiment `-1` sur tunnel `-2` : 20 ; pont `1` sur **sol `-1`** : 17 ; tunnel `-2` sur tunnel `-7` : 15.

Répartition des attributs de niveau sur les voies `railway=rail` :

| | (d) Paris | (a) Dijon | (b) Clelles | (c) Pasilly |
|---|---|---|---|---|
| voies `rail` | 1 192 | 306 | 33 | 58 |
| `bridge` | 23 (`yes`) | 61 (`yes`) | 10 (`yes` 8, `viaduct` 2) | 22 (`yes`) |
| `tunnel` | 319 (`yes` 268, `building_passage` 51) | 15 (`yes` 9, `covered` 6) | 2 | 0 |
| `covered` | 31 | 5 | 0 | 0 |
| `cutting` / `embankment` | 57 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| `layer` (voies) | 437 | 70 | 12 | 22 |
| valeurs de `layer` | `-1` 323, `-2` 22, `1` 17, `-3` 16, `2` 13, `-4` 9, `-5` 9, `-8` 7, `-7` 2, **valeurs multiples sur 19 voies** (`-1;-2` 6, `-2;-3;-4;-5;-6;-7;-8` 4, `-4;-5` 4, `-2;-3` 3, `-3;-4;-5` 2) | `1` 60, `-1` 9, `2` 1 | `1` 10, `-1` 2 | `1` 22 |
| pont sans `layer` | **0** | **0** | **0** | **0** |
| tunnel sans `layer` | 49 (dont 22 `building_passage`) | 6 | 0 | — |
| `layer` sans pont, tunnel ni `covered` | **140** (presque tous `-1` ; 30 avec `cutting=yes`) | 0 | 0 | 0 |
| longueur d'une voie « pont » | médiane 97 m (11–119) | 28 m (4–363) | 19 m (4–279) | 7 m (3–37) |
| longueur d'une voie « tunnel » | médiane 74 m (2–1 439) | 91 m | 367 m | — |

Autres types à Paris — `subway` (99 voies) : `tunnel` 66, `bridge` 15, `layer` `-2` 39, `-1` 19, `1` 9, `2` 6, `-3` 3, `-5` 2 ; `tram` (57) : 14 ponts, tous `layer=1` ; `disused` (120) : 33 ponts, 13 tunnels.

Ce que disent ces chiffres (confiance C, mesure) :

- Un pont porte toujours son `layer` (0 pont sans `layer` sur 116). Un tunnel pas toujours (55 sans `layer` sur 336) : la valeur implicite −1 est nécessaire.
- **`layer=-1` au sol existe** : à Paris, 140 voies sans ouvrage portent `layer=-1` (voies en tranchée de l'avant-gare et sous dalle). 17 croisements « pont `1` sur sol `-1` » en dépendent. Il faut donc lire `layer` même sans `bridge` ni `tunnel`.
- **Les valeurs multiples existent** (`layer=-2;-3;-4;-5;-6;-7;-8`, voies du RER) : à traiter comme un intervalle, pas comme une erreur.
- Les valeurs vont jusqu'à −8 dans une grande gare : c'est un ordre local, pas une profondeur.
- **Un aiguillage peut être posé sur le nœud de bout d'un ouvrage** : 119 bouts de voie « tunnel » à Paris et 29 bouts de voie « pont » à Dijon sont des nœuds `railway=switch`. La règle « pas de jonction au bout d'un ouvrage » n'est pas tenue pour le rail.
- Les transitions de niveau se font **sans rampe** : la voie « pont » (7 à 100 m) est au niveau 1, sa voisine immédiatement au niveau 0. Rien dans OSM ne dit où la rampe commence.

## 3. Vitesses

| Fait | Détail | Source | Conf. |
|---|---|---|---|
| `maxspeed` sur la voie | « The maximum permissible speed in a track section. » En km/h sans unité, sinon `10 mph`. Pour une vitesse variable (signaux), la plus haute. | ORM/T | S |
| Par sens | `maxspeed:forward` / `maxspeed:backward`, relatifs au sens du tracé OSM. Rare : 7 voies sur 1 589 dans les quatre zones (Dijon : 120 dans un sens, 60 dans l'autre). 178 246 objets dans le monde, toutes routes comprises. | ORM/T, Mesure, TI-monde | C |
| Par catégorie de train | seule clé documentée dans ORM/T : `maxspeed:tilting` (trains pendulaires). **Aucune clé du type `maxspeed:freight` n'est documentée dans les pages lues** ; aucune vue dans les échantillons. | ORM/T, Mesure | C pour l'absence dans les échantillons ; l'existence d'autres clés ailleurs n'est pas vérifiée |
| `maxspeed:conditional` | 0 voie ferrée dans les quatre zones. | Mesure | C |
| `highspeed=yes` | ligne à grande vitesse (> 200 km/h). Pasilly : 53 voies sur 58. 8 967 objets en France. C'est le seul marqueur « LGV » ; `usage=main` reste posé en plus. | ORM/T, Mesure, TI-FR | C |
| Découpage | **une voie OSM par tronçon de vitesse** : la voie est coupée au nœud où la vitesse change. Mesuré : 45 joints simples avec changement de `maxspeed` à Paris, 10 à Dijon, 2 à Clelles, 2 à Pasilly (270 → 220). | Mesure | C |
| Couverture, voies principales | part de la longueur portant `maxspeed` : Paris 84 %, Dijon 80 %, Clelles 100 %, Pasilly 100 %. | Mesure | C |
| Couverture, voies de service | Paris 2 %, Dijon 1 %, Clelles 0 %, Pasilly 22 %. | Mesure | C |
| Valeurs vues | Paris 30/60/90/70/100/120/80/140 ; Dijon 60/50/30/160/120/140 ; Clelles 55/70/40 ; Pasilly 300/270/220/160. | Mesure | C |
| Vitesse en déviation d'un aiguillage | `railway:maxspeed:diverging` / `railway:maxspeed:straight` sur le nœud. 216 objets en France sur 65 640 aiguillages. | W:switch, TI-FR | C |
| Tableaux de vitesse | les TIV sont des signaux (`railway:signal:speed_limit*`), voir § 5 : ils portent la vitesse affichée (`…:speed`). | ORM/FR | S |

## 4. Aiguillages, traversées, fins de voie

| Fait | Détail | Source | Conf. |
|---|---|---|---|
| `railway=switch` | **nœud** commun aux voies, posé à la pointe. « Without it, a crossing of two tracks might either be interpreted as a flat crossing or a slip switch. » | ORM/T, W:switch | C |
| `railway:switch` | `default` (ne s'écrit pas), `three_way`, `single_slip`, `double_slip`, `wye`, `curved`, `abt`. | ORM/T, W:switch | C |
| `railway:turnout_side` | `left` / `right` ; inutile pour triple, symétrique, TJD. | ORM/T | S |
| `railway:local_operated` | `yes` (à pied d'œuvre) / `no` (depuis un poste), défaut `no`. | ORM/T | S |
| Autres | `ref`, `railway:switch:electric`, `railway:switch:heated`, `railway:switch:movable_frog`, `railway:radius` (rayon de la voie déviée, ou `clothoid`), `railway:switch:resetting`, `railway:switch:configuration=inside/outside`. | ORM/T | S |
| `railway=railway_crossing` | nœud commun de deux voies qui se croisent à niveau sans pouvoir changer de voie. | ORM/T | S |
| `railway=buffer_stop` | heurtoir, en général sur le dernier nœud. | ORM/T | S |
| `railway=derail` | taquet dérailleur ; `railway:derail=wedge/trap_point/catch_point`. 200 en France. | ORM/T, TI-FR | C |
| `railway=turntable` | plaque tournante (336 en France). Aussi `railway=traverser` (vu à Paris, 3 voies). | TI-FR, Mesure | C |

Mesures :

| | (d) Paris | (a) Dijon | (b) Clelles | (c) Pasilly | France (TI-FR) |
|---|---|---|---|---|---|
| nœuds `railway=switch` | 700 | 136 | 6 | 10 | 65 640 |
| nœuds de degré 3 sur `rail`, dont marqués `switch` | 675, dont 536 (79 %) | 117, dont 115 (98 %) | 5, dont 5 | 11, dont 9 | — |
| nœuds de degré ≥ 4 | 172 : `switch` 111, `railway_crossing` 47, sans marque 12, autres 2 | 25 : `switch` 19, `railway_crossing` 5, sans marque 1 | 1 `switch` | 0 | `railway_crossing` 2 746 |
| `railway:switch` renseigné | 71 (`double_slip` 68, `three_way` 2, `single_slip` 1) | 22 (`default` 13, `double_slip` 9) | 0 | 0 | 6 937 (10,6 %) |
| `railway:turnout_side` | 8 | 0 | 0 | 0 | 2 775 (4,2 %) |
| `railway:local_operated` | 0 | 11 (`no`) | 0 | 0 | 2 826 (4,3 %) |
| `ref` sur l'aiguillage | 10 | 16 | 0 | 0 | — |
| `railway:position:exact` sur l'aiguillage | 71 | 41 | 0 | 7 | — |
| bouts de voie (degré 1), dont `buffer_stop` | 231, dont 99 | 49, dont 30 | 3, dont 1 | 9, dont 3 | `buffer_stop` 15 126 |

À retenir : à Paris, 111 nœuds `switch` sont de degré ≥ 4 alors que 71 seulement ont un type ; **une quarantaine d'aiguillages à quatre branches n'ont donc aucun type** (TJD probable ou deux aiguilles pointe à pointe : indécidable par les attributs). Les bouts de voie au bord de la boîte englobante comptent parmi les « degré 1 » : ce ne sont pas des heurtoirs manquants.

## 5. Signaux

### 5.1 Schéma général (OpenRailwayMap)

| Élément | Détail | Source | Conf. |
|---|---|---|---|
| Objet | **nœud de la voie** `railway=signal`. Vérifié : 252 des 256 signaux de Paris sont sur un nœud d'une voie `rail`. | W:signal, Mesure | C |
| `railway:signal:direction` | `forward` / `backward` / `both` : sens **de circulation auquel le signal s'adresse**, par rapport au sens du tracé OSM. | ORM/FR, W:signal | C |
| `railway:signal:position` | `left`, `right`, `bridge`, `overhead`, `catenary_mast`, `ground`, `in_track` (par rapport au sens du tracé). | ORM/FR | S |
| Catégories | `railway:signal:<catégorie>=<pays>:<type>` avec `main`, `distant`, `combined`, `minor`, `shunting`, `speed_limit`, `speed_limit_distant`, `train_protection`, `route`, `route_distant`, `electricity`, `stop`, `departure`, `crossing`, `whistle`… Un nœud peut porter plusieurs catégories (un mât = un nœud). | W:signal, ORM/FR | C |
| Sous-clés | `:form` (`light`, `sign`, `board`, `semaphore`), `:states` (aspects possibles, séparés par `;`), `:height` (`normal`, `dwarf`), `:function` (`entry`, `exit`, `intermediate`, `block`), `:speed`, `:shape`, `:type`, `:caption`, `:deactivated=yes`. | W:signal, ORM/FR | C |
| `ref` | repère du signal (plaque de repérage). En France s'y ajoute `railway:signal:<cat>:ref` = `idreseau` SNCF Réseau. | ORM/FR | S |
| Limites du schéma | un signal valable pour deux voies se saisit deux fois ; deux signaux de même catégorie sur un mât = deux nœuds à ~1 m ; pas de relation « signal → voie ». | W:signal § Weak Points | S |
| Position kilométrique | `railway:position:exact` sur le signal (144 des 256 signaux de Paris). | ORM/FR, Mesure | C |

### 5.2 Valeurs propres à la France — état de la documentation

**La page existe, en anglais (ORM/FR) et en français (ORM/FR-fr), et elle est très détaillée, mais :**

1. elle est marquée « WIP » et a été modifiée le jour même de cette recherche (2026-10-06) ;
2. **elle a été réécrite entre fin 2025 et 2026** : la révision du 2025-10-26 documentait `FR:CARRE`, `FR:CV`, `FR:REP_TGV`, `FR:TIV-D` posé directement dans `speed_limit_distant`, `FR:CAB_E/R/S`, `FR:CHEVRON_BAS`… ; la révision actuelle documente `FR:C`, `FR:Cv`, `FR:marker`, `FR:speed_indicator` + sous-clé, etc. **Aucune table de correspondance ancien → nouveau n'est publiée dans les pages lues** ;
3. les données OSM contiennent les deux générations à parts égales (TI-FR) ;
4. la page créée le 2024-04-01 se présente comme une « consolidation éditoriale » ; elle s'appuyait sur le jeu ouvert « signalisation permanente » de SNCF Réseau, **retiré du portail** (ORM/FR-talk, février 2026 ; vérifié : 404).

### 5.3 Table des valeurs françaises

« Documenté » = présent dans ORM/FR, révision du 2026-10-06. « Ancien » = documenté dans la révision du 2025-10-26, ou simplement rencontré dans les données. Les nombres sont ceux de TI-FR (France entière, 2026-10-05).

**Signaux d'arrêt — `railway:signal:main`**

| Valeur | Désigne | Statut | Nombre en France |
|---|---|---|---|
| `FR:C` | **Carré** : arrêt absolu, deux feux rouges, plaque « Nf » | documenté | 1 677 |
| `FR:CARRE` | Carré | ancien | 1 682 |
| `FR:Cv` | **Carré violet** : arrêt absolu pour les manœuvres et voies de service | documenté | 80 |
| `FR:CV` | Carré violet | ancien | 584 |
| `FR:S` | **Sémaphore** : arrêt franchissable sous conditions (block), plaque « F », « BM » ou « PR » | documenté (inchangé) | 1 414 |
| `FR:GA` | **Guidon d'arrêt** : bande rouge, arrêt avant le signal | documenté (inchangé) | 25 |
| `FR:GABARIT` | non documenté dans la révision actuelle (signal de gabarit ; la révision actuelle utilise `railway:signal:clearance=FR:reduced_clearance`) | ancien | 15 |
| `FR:Carré violet`, `FR:Sémaphore` posés dans `railway:signal:minor` | erreurs de saisie | hors schéma | 41 + 1 |

Sous-clés de `main` : `:form` = `light` ou `sign` (mécanique) ; `:shape` = cible `FR:A`, `FR:C`, `FR:F`, `FR:H` (aussi `FR:K` 166 objets, non documenté dans la révision actuelle) ; `:states` ; `:height=dwarf` (carré bas) ; `:arrangement=vertical` ; `:function=intermediate` (signal de milieu de quai) ; `:type` = plaque d'identification : `FR:F`, `FR:PR`, `FR:BM` pour un sémaphore, `FR:BM` / `FR:PR` pour un carré ; `:caption` ; `:deactivated=yes` (croix de Saint-André). **Clé ancienne rencontrée, absente de la révision actuelle : `railway:signal:main:plate`** = `FR:NF` (133 à Paris), `FR:F` (17), `FR:BM` (2) ; et `railway:signal:main:clearing_light=yes` (œilleton, 62 à Paris).

**Aspects — valeurs de `railway:signal:main:states` / `distant:states`** (module wiki `FR:RailwaySignalState` + valeurs rencontrées)

| Valeur | Aspect | | Valeur | Aspect |
|---|---|---|---|---|
| `FR:C` | Carré | | `FR:R` | Ralentissement 30 |
| `FR:Cv` (ancien `FR:CV`) | Carré violet | | `FR:(R)` | Ralentissement 60 |
| `FR:S` | Sémaphore | | `FR:RR` | Rappel 30 |
| `FR:(S)` | Feu rouge clignotant | | `FR:(RR)` | Rappel 60 |
| `FR:A` | Avertissement | | `FR:M` | Feu blanc |
| `FR:(A)` | Feu jaune clignotant | | `FR:(M)` | Feu blanc clignotant |
| `FR:D` | Disque | | `FR:VL` | Feu vert (voie libre) |
| `FR:X` | Annulé | | `FR:(VL)` | Feu vert clignotant |

Les combinaisons `R+A`, `R+(A)`, `(R)+A`, `(R)+(A)`, `RR+A`, `RR+(A)`, `(RR)+A`, `(RR)+(A)` existent aussi dans le module. Les codes sans parenthèses (`C`, `Cv`, `D`, `S`, `A`, `R`, `RR`, `M`, `VL`) sont **déduits** des noms du module et des valeurs mesurées à Paris (ex. `FR:A;FR:C;FR:S;FR:VL` 49 fois, `FR:CV;FR:M` 31 fois) : conf. C pour ceux vus dans les données, E pour `FR:D` et `FR:X` comme états.

**Signaux à distance — `railway:signal:distant`**

| Valeur | Désigne | Statut | Nombre |
|---|---|---|---|
| `FR:A` | **Avertissement** (annonce un sémaphore de BAPR fermé), plaque « A » | documenté | 166 |
| `FR:D` | **Disque** : marche à vue, arrêt avant la première aiguille | documenté | 9 |
| `FR:mirliton` (+ `:type=I/II/III`) | **Mirlitons** : balises d'approche à 3, 2, 1 bandes | documenté | 260 |
| `FR:C` (+ `:distance`) | pancarte d'annonce d'un carré à distance | documenté | non relevé |
| `FR:GA` (+ `:distance`) | pancarte d'annonce d'un guidon d'arrêt | documenté | 3 |

**Vitesse — `railway:signal:speed_limit` et `railway:signal:speed_limit_distant`**

| Valeur (schéma actuel) | Désigne | Ancienne forme rencontrée | Nombre (actuel / ancien) |
|---|---|---|---|
| `speed_limit_distant=FR:speed_indicator` + `…:fixed=FR:TIV-D` + `…:fixed:speed` | **TIV à distance fixe**, type ordinaire | `speed_limit_distant=FR:TIV-D` + `…:speed` ; `FR:TIV-D_FIXE` | 483 / 1 182 + 99 |
| `…:switchable=FR:TIV-D` + `:speed` + `:turn_direction` | **TIV-D mobile** (avant une aiguille en déviation) | `FR:TIV-D_MOB` | — / 5 |
| `…:fast=FR:TIV-D` | TIV-D fixe **type B** (trains > 140 km/h) | `FR:TIV-D_B` | — / 8 |
| `…:railcar=FR:TIV-D` | TIV-D fixe **type C** (automoteurs) | `FR:TIV-D_C_FIXE` | — / 1 |
| `…:freight=FR:TIV-D` | **TIV pentagonal** à distance (fret) | `FR:TIV_PENDIS` (rév. 2025) | non relevé |
| `speed_limit_distant=FR:P` | **Tableau P** : préannonce (trains > 160 km/h) | inchangé | 41 |
| `speed_limit=FR:speed_indicator` + `…:switchable=FR:TIV-R` + `:speed` | **TIV de rappel** mobile, groupé avec le carré | `speed_limit_reminder=FR:TIV-R` | 23 / 3 |
| `speed_limit=FR:marker` + `…:main=FR:Z` + `:function=entry` | **Tableau Z** : début de la zone à vitesse limitée | `speed_limit=FR:Z` | 476 (tous `FR:marker`) / 857 |
| `speed_limit=FR:marker` + `…:main=FR:R` + `:function=exit` | **Tableau R** : fin de zone, reprise de vitesse | `speed_limit=FR:R` | (idem) / 216 |
| `speed_limit=FR:marker` + `…:transition=FR:Km` | **Repère Km** : point de changement de vitesse | `speed_limit=FR:KM` | (idem) / 66 |
| `speed_limit=FR:chevron` | **Chevron pointe en bas** : position de l'aiguille | `FR:Chevron` 211, `FR:CHEVRON` 170, `FR:CHEVRON_BAS` 43 | 2 / 424 |
| `speed_limit=FR:R30`, `FR:RR30` | Ralentissement 30 et Rappel 30 **mécaniques** | — | non relevé |
| `speed_limit=FR:speed_indicator` + `…:freight=FR:TIV-E` / `FR:white_board` | TIV pentagonal d'exécution / tableau blanc de fin | `FR:TIV_PENEXE`, `FR:TIV_PENREP` (rév. 2025) | non relevé |
| `speed_limit_distant:restriction=FR:L` | pancarte L (certaines séries de locomotives) | — | non relevé |
| `speed_limit=FR:washing_facility` | vitesse en machine à laver | — | 2 |

**Signalisation de cabine et LGV — `railway:signal:train_protection`**

| Valeur (schéma actuel) | Désigne | Ancienne forme rencontrée | Nombre (actuel / ancien) |
|---|---|---|---|
| `FR:marker` + `…:main=stop_marker` + `…:main:form=sign` + `…:main:type=FR:F` ou `FR:NF` | **Repère TVM** (triangle jaune sur fond bleu) : `FR:F` franchissable (espacement), `FR:NF` non franchissable (protection) ; option `…:main:passing_light=yes` | `FR:REP_TVM` 376, `FR:repère_arrêt_TVM` 54, `FR:repère_arrêt_ETCS;FR:repère_arrêt_TVM` 75, `FR:REP_ETCS;FR:REP_TVM` 9, `FR:TVM` 9 ; `FR:REP_TGV` (rév. 2025) | 197 (tous `FR:marker`) / 523 |
| `FR:marker` + `…:system_change=FR:type_transition` + `:type=300/430` | pancarte de transition TVM 300 / 430 | — | (inclus dans 197) |
| `train_protection=FR:CAB` + `:function=entry` | pancarte **CAB** d'entrée en signalisation de cabine | `FR:pancarte_CAB_entrée` 21, `FR:CAB_EXE` 2, `FR:CAB_E` (rév. 2025) | 4 / 23 |
| `train_protection=FR:CAB` + `:function=exit` | pancarte de **fin de CAB** | `FR:pancarte_CAB_sortie` 18, `FR:CAB_S` 2, `FR:CAB_FIN` 1 | (idem) / 21 |
| `train_protection_distant=FR:CAB` | pancarte CAB d'annonce | `FR:CAB_DIS` 6 | non relevé / 6 |
| `train_protection=FR:X` | croix lumineuse SACEM (RER A) | — | non relevé |
| `railway:signal:shunting=FR:marker` | **Jalon de manœuvre** | `FR:jalon_de_manoeuvre_TVM` (dans `train_protection`) 12, `FR:JALON_MAN` (rév. 2025) | 9 / 12 |
| repères ETCS | page séparée `OpenRailwayMap/ETCS_Markers` (non lue en détail) ; `ETCS:marker` 10 en France | — | 10 |

**Direction, manœuvre et divers (schéma actuel, sauf mention)**

| Clé = valeur | Désigne |
|---|---|
| `railway:signal:route=FR:ID` (+ `:states=FR:ID1…FR:ID5`) | Indicateur de direction |
| `railway:signal:switch=FR:TIDD` (ancien : `route_distant=FR:TIDD`, vu 5 fois à Paris) | Tableau indicateur de direction à distance |
| `railway:signal:route_distant=FR:TLD` | Tableau lumineux de direction |
| `railway:signal:short_route=FR:yellow_band` | Bande lumineuse jaune horizontale |
| `railway:signal:wrong_road=FR:IPCS` + `:entry=FR:TECS` / `:exit=FR:TSCS` (ancien : `wrong_route=FR:TECS` / `FR:TSCS`) | Tableaux d'entrée et de sortie de contresens (IPCS) |
| `railway:signal:shunting=FR:SLM` | Signal lumineux de manœuvre |
| `railway:signal:shunting=FR:H`, `FR:end_of_track`, `FR:MV`, `FR:LGR`, `FR:LM`, `FR:limit` | heurtoir, fin de voie, pancartes MV / LGR / LM, autres limites |
| `railway:signal:shunting_route=FR:destination` + `:depot=FR:D`, `:stabling=FR:G`, `:short_block=FR:SAS`, `:dead_end=FR:Imp`, `:buffer_stop=FR:Heurtoir` (ancien : `shunting=FR:G` 246, `FR:DEPOT` 12, `FR:IMP` 13, `FR:HEURTOIR_A` 23) | tableaux D, G, SAS, Imp, heurtoir à distance |
| `railway:signal:minor=FR:chevron` (273) (ancien : `shunting=FR:CHEVRON_HAUT` 46) | Chevron pointe en haut |
| `railway:signal:minor=FR:TLC`, `FR:TIP`, `FR:signals_on_left`, `FR:signals_on_right`, `FR:instruction_board` | TLC, TIP, pancartes « signaux à gauche / à droite », tableaux de consigne |
| `railway:signal:stop=FR:ARRET`, `FR:STOP`, `FR:passenger_stop` (+ sous-clés `any`, `conventional=FR:TT`, `regional=FR:Z57`, `suburban=FR:Z50`, `highspeed=FR:TGV`, `accessibility=FR:UFR`) | pancartes d'arrêt et repères d'arrêt des trains de voyageurs |
| `railway:signal:stop_distant=FR:ARRET`, `FR:STOP` | pancartes d'arrêt à distance |
| `railway:signal:coupling=FR:stop_marker` | repères d'arrêt pour raccordement / coupe (2TMV) |
| `railway:signal:departure=FR:SLD`, `FR:DD`, `FR:DAMM`, `FR:RLI`, `FR:reporting`, `FR:departure_marker` | signal lumineux de départ, demande de départ, DAMM, RLI… |
| `railway:signal:station_distant=FR:GARE`, `railway:signal:station=FR:bilateral_exit_signals` | pancarte GARE, signaux de sortie bilatéraux |
| `railway:signal:electricity=FR:power_off_advance`, `FR:power_off`, `FR:power_on`, `FR:REV`, `FR:pantograph_down_advance`, `FR:pantograph_down`, `FR:pantograph_up`, `FR:end_of_catenary`, `FR:frost` | sectionnement, coupez courant, fin de parcours, REV, baissez panto, fin de caténaire, givre |
| `railway:signal:catenary=FR:reminder`, `FR:transition`, `FR:switchable_station` | tension caténaire |
| `railway:signal:crossing_hint=FR:PN`, `FR:radio_command` ; `railway:signal:crossing_info=FR:PN` ; `railway:signal:crossing=FR:SFC` | annonce de passage à niveau, signal de franchissement conditionnel |
| `railway:signal:whistle=FR:S` (ancien `FR:SIFFLER`) | pancarte S (siffler) |
| `railway:signal:radio=FR:marker`, `railway:signal:bimode=FR:BIMODE`, `railway:signal:snowplow=FR:equipment`, `railway:signal:structure=FR:tunnel`, `railway:signal:clearance=FR:reduced_clearance`, `railway:signal:lightbox=FR:double_lightbox`, `railway:signal:facility=FR:POSTE` / `FR:boundary`, `railway:signal:servicing=FR:L` | radio sol-train, bimode, chasse-neige, tunnel, gabarit réduit, caisson double, établissement, machine à laver |
| `railway:crocodile=yes` sur le nœud du signal | crocodile (103 signaux à Paris) |

### 5.4 Ce qui est réellement dans les données

| | (d) Paris | (a) Dijon | (b) Clelles | (c) Pasilly |
|---|---|---|---|---|
| nœuds `railway=signal` | 256 | 9 | 6 | **0** |
| avec `railway:signal:direction` | 251 (`forward` 204, `backward` 47) | 2 | 5 | — |
| avec `railway:signal:position` | 251 (`left` 124, `bridge` 91, `right` 36) | 0 | 5 | — |
| **signal principal typé** | **161** : `FR:CARRE` 73, `FR:CV` 34, `FR:C` 31, `FR:S` 22, `FR:GABARIT` 1 | **0** | **0** | — |
| sans aucune clé de type | 16 | **9** | 1 | — |
| `distant` | 0 | 0 | `FR:A` 2 | — |
| `speed_limit` | `FR:Z` 55, `FR:CHEVRON` 10, `FR:marker` 8, `FR:R` 8, `FR:KM` 1, `FR:Chevron` 1 | 0 | `FR:Z` 1, `FR:R` 1 | — |
| `speed_limit_distant` | `FR:TIV-D` 61, `FR:speed_indicator` 7, `FR:TIV-D_MOB` 2 ; vitesses 30 (40 fois), 60, 70, 90, 50, 110 | 0 | `FR:TIV-D` 1 (40) | — |
| `main:states` | `FR:A;FR:C;FR:S;FR:VL` 49, `FR:CV;FR:M` 31, `FR:A;FR:C;FR:M;FR:S;FR:VL` 20, `FR:A;FR:S;FR:VL` 14, `FR:A;FR:C;FR:R;FR:RR;FR:S;FR:VL` 12, … | — | — | — |
| `main:plate` (clé ancienne) | `FR:NF` 133, `FR:F` 17, `FR:BM` 2 | — | — | — |
| `main:shape` | `FR:C` 75, `FR:A` 44, `FR:H` 19, `FR:F` 12 | — | — | — |
| autres | `shunting` : `FR:G` 13, `FR:CHEVRON_HAUT` 2 ; `departure` : `FR:SLD` 7, `FR:reporting` 2 ; `route_distant=FR:TIDD` 5 ; `minor` : `FR:reduced_clearance` 15 | — | — | — |
| signaux principaux par km de voie principale | 1,64 | 0 | 0 | 0 |

France entière et monde :

| Mesure | Valeur | Source | Conf. |
|---|---|---|---|
| nœuds `railway=signal`, France | 17 533 (TI-FR) ; 17 442 dans la zone administrative France (Overpass) | TI-FR, Mesure | C |
| dont signal principal français typé (`railway:signal:main=FR:*`) | **5 473**, dont 5 215 avec un sens | Mesure | C |
| dont sans aucune clé de type | **5 321 (30 %)** | Mesure | C |
| concentration | les 5 473 signaux principaux tiennent dans 157 cases de 0,25° ; **une seule case (Paris sud-ouest) en contient 21 %, 8 cases en contiennent 50 %** (7 en Île-de-France, 1 autour de Rennes) | Mesure | C |
| repères de cabine (`train_protection`) | 798 en France, groupés sur quelques tronçons (LGV Méditerranée vers 43,5°N 4,5–5°E : 167 ; LGV Atlantique et BPL vers 47,5–48°N, 1°O–1,5°E : ~375) | Mesure | C |
| origine | `source=SNCF - 03/2022` sur 2 676 signaux (import du jeu ouvert retiré depuis), `BDOrtho IGN` / `PCRS` ~3 000, sans source 10 609 | Mesure | C |
| pour comparaison | 65 640 aiguillages, 133 455 voies `rail`, 13 799 `milestone` en France | TI-FR | C |
| monde, clés de signaux | `railway=signal` 519 485 ; `railway:signal:direction` 505 506 ; `:position` 401 929 ; `:main` 112 746 ; `:distant` 63 736 ; `:combined` 44 314 ; `:speed_limit` 71 235 ; `:speed_limit_distant` 31 046 ; `:minor` 63 811 ; `:shunting` 46 146 ; `:train_protection` 8 413 | TI-monde | C |
| France, clés générales | `railway:signal:direction` 13 639 ; `:position` 12 687 | TI-FR | C |

**Conclusion sur les signaux.** La France pèse 3,4 % des signaux mondiaux d'OSM et 4,9 % des signaux principaux, pour un réseau qui est l'un des plus grands d'Europe. La couverture est bonne sur une partie de l'Île-de-France, ponctuelle ailleurs, nulle sur la plupart des LGV. Le nombre réel de signaux du réseau n'a pas été trouvé (voir « non trouvé »), donc aucun taux national ne peut être donné ; l'ordre de grandeur est « une petite fraction » (conf. E).

## 6. Repères, gares, passages à niveau

| Fait | Détail | Source | Conf. |
|---|---|---|---|
| `railway=milestone` | nœud sur la voie (une fois par voie d'une ligne multiple). `railway:position` = valeur arrondie du repère (km, point décimal), `railway:position:exact` = valeur exacte. Miles : préfixe `mi:`. Valeurs négatives permises. | ORM/T, W:position | C |
| Plusieurs lignes au même point | `railway:position:<ref de ligne>=…` | W:position | S |
| Couverture PK | `milestone` : Paris 11, Dijon 0, Clelles 0, **Pasilly 105** (dont LGV). France : 13 799 `milestone`, `railway:position` 14 252, **`railway:position:exact` 40 005** (sur signaux, aiguillages, PN). | Mesure, TI-FR | C |
| PK par voie | `ref:FR:SNCF_Reseau` donne les PK de début et de fin du tronçon de voie SNCF auquel la voie OSM appartient (pas ceux de la voie OSM elle-même). Présent sur 45 % (Paris) à 95 % (Pasilly, Clelles) des voies. | W:refSNCF, Mesure | C |
| Gares | `railway=station` (nœud ou surface), `railway=halt` ; quais `railway=platform` (voie ou surface) et `railway=platform_edge` ; point d'arrêt `railway=stop` (nœud sur la voie) ; `public_transport=stop_area` (relation qui regroupe). Vu aussi : `train_station_entrance`, `subway_entrance`, `platform_marker`, `signal_box`. | ORM/T (sections non lues en détail), Mesure | S pour les définitions, C pour la présence |
| Dans les zones | Paris : 32 `station`, 107 `stop`, 84 voies `platform` ; Dijon : 1 `station`, 11 `stop`, 23 `platform` ; Clelles : 1 `station`, 2 `stop`, 2 `platform`. | Mesure | C |
| Passages à niveau | `railway=level_crossing` (route), `railway=crossing` (piétons), nœud commun à la voie et à la route. 29 710 `level_crossing` en France (SNCF Réseau en liste 16 878 sur le RFN). Paris 18 (surtout tram : `tram_level_crossing` 81), Dijon 2, Pasilly 3. | ORM/T, TI-FR, SNCF, Mesure | C |

## 7. Zones mesurées et requêtes

| Zone | Boîte (sud, ouest, nord, est) | Taille | Contenu | Fichier brut |
|---|---|---|---|---|
| (a) nœud ferroviaire | `47.305,5.000,47.335,5.045` | 3,3 × 3,4 km | Dijon-Ville : gare, bifurcations vers Paris, Lyon, Vallorbe, Épinac ; tram | `zone-a-dijon-ville-noeud-ferroviaire.json` (615 ko) |
| (b) voie unique | `44.790,5.590,44.860,5.670` | 7,8 × 6,3 km | ligne des Alpes (Grenoble – Veynes, code 905000), gare de croisement de Clelles-Mens (voie `E` d'évitement) | `zone-b-clelles-mens-voie-unique-ligne-des-alpes.json` (89 ko) |
| (c) LGV | `47.660,4.020,47.750,4.150` | 10 × 9,7 km | LGV Sud-Est, bifurcation de Pasilly et raccordement vers Aisy (code 768300), saut-de-mouton | `zone-c-lgv-sud-est-bifurcation-de-pasilly.json` (149 ko) |
| (d) sortie de Paris | `48.815,2.365,48.850,2.425` | 3,9 × 4,4 km | Paris Gare de Lyon (surface et souterraine), Bercy, Austerlitz en partie, RER A et D, métro, faisceaux jusqu'à Charenton | `zone-d-paris-gare-de-lyon-bercy-charenton.json` (2,52 Mo) |

Synthèse par zone (voies `railway=rail`) :

| | (a) Dijon | (b) Clelles | (c) Pasilly | (d) Paris |
|---|---|---|---|---|
| voies OSM `rail` / longueur | 306 / 51,9 km | 33 / 12,6 km | 58 / 54,0 km | 1 192 / 236,1 km |
| dont voies principales (sans `service`) | 200 / 38,9 km | 31 / 12,0 km | 52 / 51,5 km | 457 / 98,2 km |
| `maxspeed` (part de la longueur totale) | 60 % | 95 % | 96 % | 36 % |
| `maxspeed`, voies principales seulement | 80 % | 100 % | 100 % | 84 % |
| `usage` | `main` 184, `branch` 12 | `branch` 27 | `main` 53 | `main` 465 |
| `service` | `yard` 53, `crossover` 47, `siding` 6 | `siding` 2 | `siding` 3, `crossover` 3 | `yard` 618, `crossover` 78, `siding` 39 |
| électrification | 1 500 V cc, 98 % | non électrifiée | 25 kV 50 Hz, 97 % | 1 500 V cc, 94 % |
| `railway:track_ref` | 90 % | 95 % | 97 % | 43 % |
| `railway:kvb` / `railway:tvm` | `kvb=yes` 176 | `kvb=no`, `tvm=no`, `etcs=no` sur tout | `tvm=300` 54, `kvb=yes` 53 | `kvb=yes` 474 |
| aiguillages | 136 | 6 | 10 | 700 |
| ponts / tunnels (voies) | 61 / 15 | 10 / 2 | 22 / 0 | 23 / 319 |
| signaux (dont principaux typés) | 9 (0) | 6 (0) | 0 | 256 (161) |
| points kilométriques (`milestone`) | 0 | 0 | 105 | 11 |
| autres voies | tram 29, `razed` 6, `abandoned` 3 | — | `abandoned` 9 | `subway` 99, `tram` 57, `disused` 120, `abandoned` 75 |

### Requêtes Overpass utilisées

Requête des quatre échantillons (remplacer la boîte). Elle sort d'abord les objets ferroviaires avec leurs attributs, puis les nœuds de géométrie, puis les relations de ligne **sans leurs membres** (récursion volontairement évitée : une relation de ligne fait des centaines de kilomètres).

```
[out:json][timeout:90][bbox:48.815,2.365,48.850,2.425];
(way[railway];node[railway];)->.a;
.a out body;
way.a;>;out skel qt;
way.a;rel(bw)[type=route][route~"^(tracks|railway)$"];out tags;
```

**Piège de cette forme, présent dans les quatre fichiers enregistrés** : un nœud ferroviaire qui est aussi un sommet de voie sort **deux fois**, d'abord avec ses attributs, ensuite nu (`out skel`). Un lecteur qui écrase par identifiant perd les attributs (c'est ce qui m'a d'abord fait compter 1 aiguillage à Paris au lieu de 700). Il faut fusionner en gardant la version qui a des `tags`.

Requête recommandée pour l'import (vérifiée sur la zone b : 513 nœuds, 37 voies, 2 relations, aucun doublon, 87,5 ko) :

```
[out:json][timeout:60][bbox:44.790,5.590,44.860,5.670];
(way[railway];node[railway];)->.a;
(.a;way.a;>;);
out body qt;
way.a;rel(bw)[type=route][route~"^(tracks|railway)$"];
out tags;
```

Comptages et contrôles :

```
[out:json][timeout:60][bbox:48.815,2.365,48.850,2.425];
node[railway=switch];out count;
node[railway=signal];out count;
node[railway=milestone];out count;
node[railway=buffer_stop];out count;
```

```
[out:json][timeout:170];
area["ISO3166-1"="FR"]["admin_level"="2"]->.fr;
node[railway=signal](area.fr);
out body;
```

(Cette dernière renvoie 6,7 Mo et 17 442 nœuds ; elle a servi à mesurer la concentration géographique, elle n'est pas enregistrée dans les échantillons.)

Variante à connaître, non exécutée : remplacer `out body qt;` par `out body geom;` pour que chaque voie porte sa géométrie en ligne (`geometry: [{lat, lon}, …]`). Elle dispense de relire les nœuds mais **il faut garder `nodes`** pour la topologie : deux voies sont raccordées si et seulement si elles partagent un identifiant de nœud.

## 8. Récupération des données

| Fait | Détail | Source | Conf. |
|---|---|---|---|
| Point d'accès principal | `https://overpass-api.de/api/interpreter`, requête dans le paramètre `data` (GET ou POST `application/x-www-form-urlencoded`). | W:overpass, Mesure | C |
| Appel depuis un navigateur | **oui** : réponse avec `Access-Control-Allow-Origin: *` (mesuré sur `overpass-api.de` et `maps.mail.ru` en envoyant un en-tête `Origin`). Un site statique sans serveur peut donc appeler Overpass avec `fetch`. | Mesure | C |
| Politique d'usage | « You can assume that you don't disturb other users when you do less than 10,000 queries per day and download less than 1 GB data per day. » **« If you set something up that uses the Overpass API regularly, then divide those numbers by 100 (making less than 100 queries fetching less 10 MB of data per day fine). If you have an app or website, then the usage counts towards the sum of requests made by all your users. »** | W:overpass, OP:commons | C pour 10 000 / 1 Go ; S pour la division par 100 |
| Identification | « Be sure to check that your app or website adds User-Agent or Referer headers that uniquely identify your app. » Pas de requêtes en parallèle. Usage commercial : serveur propre ou payant. Après un 429 ou un 406, attendre 30 s. Mention : « Do not use platforms for fast-deployment of AI-generated apps like lovable.app or netlify.app ». Dans un navigateur, `Referer` est envoyé par le navigateur ; `User-Agent` ne peut pas être fixé de façon fiable par `fetch` (conf. E). | W:overpass | S |
| État du service | « Nowadays this server is overloaded - be mindful of that, do not overconsume resources and do not expect high reliability. » **Mesuré : sur une vingtaine de requêtes, environ la moitié a échoué** (HTTP 504 « The server is probably too busy », un 429, un échec de connexion), sur les trois serveurs essayés. `/api/status` annonce « Rate limit: 2 » (deux requêtes simultanées par adresse). | W:overpass, Mesure | C |
| Miroirs | `https://maps.mail.ru/osm/tools/overpass/api/interpreter` (VK Maps, « no requests limitations », CORS ouvert mesuré) ; `https://overpass.private.coffee/api/interpreter` (ex-kumi.systems, « no rate limit », prévenir pour un gros projet ; trois 504 et un échec lors de mes essais, CORS non mesuré). Mêmes données que le serveur principal à une minute près (vérifié : comptages identiques). | W:overpass, Mesure | C |
| Limites techniques | délai par défaut 180 s, réglable par `[timeout:…]` ; mémoire réglable par `[maxsize:…]`. Valeur par défaut de `maxsize` non lue (512 Mo de mémoire, conf. E). | W:overpass | S |
| Taille des réponses | 2,52 Mo pour 17 km² de Paris (tout `railway`, tram et métro compris) ; 615 ko pour 11 km² de Dijon ; 149 ko pour 97 km² de campagne avec LGV ; 89 ko pour 49 km² de voie unique. Ordre de grandeur : **0,15 Mo/km² en ville dense, 2 ko/km² en campagne**. Une boîte de 20 × 20 km sur une grande ville peut dépasser 10 Mo. | Mesure | C |
| Format JSON | `{ version, generator, osm3s: { timestamp_osm_base, copyright }, elements: [...] }`. Nœud : `{type:"node", id, lat, lon, tags?}`. Voie : `{type:"way", id, nodes:[id…], tags}`. Relation : `{type:"relation", id, tags, members?}`. | Mesure | C |
| Lire la géométrie | une voie est la suite ordonnée de ses `nodes` ; les coordonnées sont dans les éléments `node` (WGS 84, degrés décimaux, 7 décimales). Le **sens du tracé** (ordre des nœuds) est celui auquel se réfèrent `forward` / `backward`, `left` / `right`. | Mesure, ORM/T | C |
| Extraits Geofabrik | `https://download.geofabrik.de/europe/france.html` : fichiers `.osm.pbf` par pays et par région, mis à jour chaque jour. Filtrage conseillé par OSRD : `osmium tags-filter fichier.osm.pbf nwr/railway r/public_transport=stop_area`. **Format binaire, plusieurs Go pour un pays : pas utilisable directement dans un navigateur**, c'est une voie pour un outil hors ligne qui préparerait des fichiers. Tailles non mesurées (redirection). | OSRD (README), W:overpass | S |
| Alternative par fichier | l'utilisateur lance la requête dans Overpass Turbo (`https://overpass-turbo.eu/`) et enregistre le JSON, que le logiciel ouvre. Même format que l'appel direct. | E | E |

## 9. Géométrie

| Fait | Détail | Source | Conf. |
|---|---|---|---|
| Nature | lignes brisées en latitude / longitude ; aucune notion d'arc, de clothoïde ni de rayon (sauf `railway:radius` sur un aiguillage, non rencontré). | ORM/T, Mesure | C |
| Densité de points | espacement médian entre sommets : Paris 17 m (10 % < 7 m, 90 % < 52 m), Dijon 21 m, Clelles 21 m, LGV 59 m (90 % < 177 m, max 1 439 m en alignement). En courbe (rayon local < 3 000 m) : médiane 16 à 21 m, 90 % < 37 m ; **angle par sommet médian 1,9° (Paris, Dijon), 3,3° (ligne de montagne)**, 90 % < 4 à 6°. | Mesure | C |
| Précision relative | entraxe mesuré entre voie 1 et voie 2 de la LGV Sud-Est : médiane 4,18 m, 10 % – 90 % : 4,06 – 4,37 m (entraxe réel de cette ligne : 4,20 m, conf. E). **Le tracé relatif est donc bon à ±15 cm près sur une ligne récente.** | Mesure | C |
| Précision absolue | non mesurée. Dépend de l'imagerie de saisie : les `source` rencontrés sont `BDOrtho IGN`, `PCRS Raster` (orthophotographies de précision) et `cadastre-dgi-fr` (2010). Ordre de grandeur : 1 m ou mieux avec ces sources, plusieurs mètres ailleurs. | Mesure (attribut `source`), E | E |
| Projection locale | à calculer autour du centre de la zone importée. Erreurs mesurées (pyproj, ellipsoïde WGS 84, point d'origine 47°N) : voir tableau ci-dessous. **Recommandation : Mercator transverse locale centrée sur la zone** (ou toute projection conforme tangente au centre) ; l'équirectangulaire simple est inacceptable au-delà de quelques kilomètres ; Lambert-93 a une échelle fausse d'environ 1 m/km. | Mesure | C |

| Distance au centre | Équirectangulaire, sphère | Équirectangulaire, rayons de l'ellipsoïde | Mercator transverse locale | Lambert-93 |
|---|---|---|---|---|
| 5 km | 14,5 m | 0,8 m | < 1 cm | 4,6 m |
| 10 km | 29 m | 3,1 m | < 1 cm | 9,2 m |
| 25 km | 80 m | 19,6 m | 6 cm | 23 m |
| 50 km | 185 m | 79 m | 51 cm | 47 m |
| erreur sur un segment de 1 km à 25 km du centre | 7,1 m | 4,2 m | 0,8 cm | 0,94 m |

| Fait | Détail | Source | Conf. |
|---|---|---|---|
| Retrouver arcs et alignements | aucune source lue ne décrit une méthode propre à OSM. Méthodes classiques : (1) courbure discrète par triplets de sommets (cercle passant par trois points), lissée, puis découpage en plages « courbure ≈ 0 » (alignement) et « courbure ≈ constante » (arc) ; (2) ajustement de cercle aux moindres carrés sur chaque plage (Kåsa, Pratt, Taubin) ; (3) ajustement en biarcs avec continuité de tangente ; (4) simplification préalable (Douglas-Peucker) à tolérance ~0,2 m pour retirer le bruit. Avec 1,9° par sommet et un sommet tous les 20 m, le rayon se retrouve bien ; les courbes de raccordement (clothoïdes) ne se retrouvent pas. | E | E |
| OpenRailwayMap | affiche les lignes brisées telles quelles ; n'interprète pas `tracks` ; schéma de marquage de référence. | ORM/T | S |
| OSRD (SNCF Réseau, OpenRail Association) | **oui, il importe OSM** : outil `osm_to_railjson`, à partir d'un fichier `.osm.pbf`. Il lit `railway=rail`, `service`, `usage`, `gauge`, `voltage`, `maxspeed`, `maxspeed:forward`, `maxspeed:backward`, `railway:track_ref`, les aiguillages (`point_switch`, `double_slip_switch`, `crossing`, `link`), les heurtoirs, les signaux (`railway:signal:main` ou `:combined`, `:direction`, `:position`, `ref`) qu'il range tous en système « BAL ». **Il propose `--generate-signals` : signaux générés automatiquement** (cantons d'une longueur calculée d'après la vitesse, 1 500 m par défaut et en TVM ; signal à 100 m avant un groupe d'aiguillages ; aiguillages à moins de 500 m regroupés en un nœud). Je n'ai trouvé dans son code aucune lecture de `layer`, `bridge` ou `tunnel`. | OSRD (code lu : `osm_to_railjson.rs`, `signal.rs`, `generate_signals.rs`, README) | C pour les clés lues ; S pour l'absence de `layer` |
| osm2rail | bibliothèque Python : télécharge par Overpass ou lit `.osm` / `.pbf`, exporte nœuds et tronçons au format GMNS (CSV). Pas d'ajustement d'arcs mentionné. | https://github.com/PariseC/osm2rail | S |
| NIMBY Rails | utilise OSM comme fond de carte, mais **masque les voies ferrées et gares existantes** ; pas d'import du réseau réel. | https://wiki.openstreetmap.org/wiki/NIMBY_Rails (résumé de recherche, page non ouverte) | S |
| JOSM, Rail Route | non étudiés. | — | — |

## 10. Licence

| Fait | Détail | Source | Conf. |
|---|---|---|---|
| Licence | Open Database License (ODbL) 1.0. La réponse Overpass le rappelle elle-même : « The data included in this document is from www.openstreetmap.org. The data is made available under ODbL. » | Mesure, OSMF:attr | C |
| Attribution | « Attribution must be to “OpenStreetMap”. The historical forms “© OpenStreetMap contributors” or “© OpenStreetMap” are acceptable. » Lisible, proche de l'œuvre ou là où l'utilisateur l'attend. | OSMF:attr | S |
| Jeux et simulations | « attribution can be provided either by a splash screen on application startup, in the game view, during gameplay, on the credits page, in the menu, or in another suitable location. » | OSMF:attr | S |
| Bases de données | « You must include attribution to OpenStreetMap and either the text of the ODbL or a link to it as part of the database, derivative database… in a location where users would be likely to look for it, such as a readme file, or within the data or metadata. » | OSMF:attr | S |
| Partage à l'identique | « Where you make our data or any Derivative Database available to others, it must continue to be licensed under the ODbL. » Un usage interne non public n'oblige à rien. | OSMF:faq | S |
| Conséquence pour le logiciel | (1) le **logiciel** n'est pas touché par l'ODbL ; (2) un **projet** qui contient un réseau importé est, selon toute vraisemblance, une base dérivée : s'il est partagé publiquement, il l'est sous ODbL, avec l'attribution ; (3) une **image** exportée (SVG, capture) est une œuvre produite : attribution seule. Le seuil en dessous duquel un extrait n'est pas « substantiel » n'a pas été vérifié. | déduction à partir de OSMF:attr et OSMF:faq | E |
| Formulation proposée | dans l'interface, visible quand un réseau importé est affiché : « © les contributeurs d'OpenStreetMap » avec un lien vers `https://www.openstreetmap.org/copyright`. Dans le fichier de projet (métadonnées) : source « OpenStreetMap », licence « ODbL 1.0 », lien `https://opendatacommons.org/licenses/odbl/`, date des données (`osm3s.timestamp_osm_base`), boîte englobante. Dans l'export SVG : la même mention en texte. | E (d'après OSMF:attr) | E |

## 11. Autres sources françaises ouvertes

Portail `https://ressources.data.sncf.com/` (164 jeux, interrogeable par API JSON, **CORS ouvert : `access-control-allow-origin: *` mesuré**). Tous les jeux ci-dessous sont publiés par SNCF Réseau sous **ODbL** (champ `license` du catalogue), donc sous la même licence qu'OSM.

| Jeu (identifiant) | Contenu | Enregistrements | Dernière modification | Exploitable ? |
|---|---|---|---|---|
| `vitesse-maximale-nominale-sur-ligne` | par tronçon de **ligne** : `code_ligne`, `v_max`, `pkd`, `pkf` (forme `629+739`), tracé `geo_shape` | 2 373 | 2022-03-24 | oui pour combler un `maxspeed` absent sur une voie principale ; pas par voie, pas par sens, pas par catégorie |
| `formes-des-lignes-du-rfn` | tracé des lignes | 1 638 | 2022-03-24 | moins fin qu'OSM |
| `fichier-de-formes-des-voies-du-reseau-ferre-national` | tracé des **voies** (clé de `ref:FR:SNCF_Reseau`) | 9 956 | 2020-09-29 | redondant avec OSM, plus ancien |
| `mode-de-cantonnement-des-lignes` | BAL, BAPR, BM… par tronçon de ligne | 1 663 | 2022-03-24 | **utile pour choisir le type de signaux générés** (absent d'OSM) |
| `regime-dexploitation-des-lignes` | voie unique, double voie, banalisée… | 1 113 | 2022-03-24 | utile pour le sens des voies |
| `lignes-equipees-de-kvb` | KVB par ligne | 599 | 2022-03-24 | redondant avec `railway:kvb` |
| `lignes-lgv-et-par-ecartement`, `lignes-par-type`, `lignes-par-statut` | LGV, écartement, type et statut de ligne | 2 166 / 3 010 / 1 638 | 2020 – 2022 | redondant avec `highspeed`, `usage` |
| `liste-des-lignes-electrifiees` | électrification par ligne | 1 254 | 2020-05-26 | redondant |
| `caracteristique-des-voies-et-declivite` | déclivités | 7 889 | 2020-05-26 | pour une version ultérieure (pentes) |
| `liste-des-circuits-de-voie` | circuits de voie (zones de détection) | 84 867 | 2020-05-26 | piste pour les cantons, non examinée |
| `liste-des-passages-a-niveau`, `liste-des-gares`, `liste-des-quais`, `liste-des-ponts-route`, `liste-des-passerelles`, `liste-des-passages-souterrains`, `liste-ouvrages-en-terre` | ouvrages et points remarquables | 16 878 / 6 469 / 5 507 / 10 257 / 1 103 / 681 / 25 845 | 2020 – 2022 | appoint |
| `particularite-dexploitation-des-voies`, `classification-darmement-des-voies` | particularités, armement | 2 573 / 16 050 | 2020-05-26 | appoint |
| `images-des-feux-de-circulation-ferroviaire-en-france` | images de feux (jeu d'apprentissage) | 105 352 | 2020-07-21 | non : ce ne sont pas des positions de signaux (contenu non examiné) |
| **`signalisation-permanente`** | positions et types des signaux, identifiant `idreseau` | — | — | **retiré** : 404 sur le portail ; « withdrawn along with other datasets about 1.5 years ago » (ORM/FR-talk, 2026-02-07). 2 676 signaux OSM en viennent (`source=SNCF - 03/2022`). |

Aucun jeu « points kilométriques » n'apparaît dans le catalogue ; les PK ne sont présents que comme bornes des tronçons (`pkd`, `pkf`). Les jeux sont **figés depuis 2020-2022**.

---

## Correspondance proposée

| Donnée OSM | Devient dans le logiciel | Ce qu'on perd ou ce qu'il faut inventer |
|---|---|---|
| voie `railway=rail` (et, en option, `light_rail`, `subway`, `tram`, `narrow_gauge`) : suite de nœuds | une suite de voies droites et courbes, après projection Mercator transverse locale et ajustement d'arcs | les clothoïdes ; le rayon exact ; la précision absolue (≈ 1 m). `disused`, `abandoned`, `construction`, `proposed`, `razed` : à écarter par défaut. |
| nœud partagé par deux voies OSM | raccord de voies (c'est la **seule** preuve de continuité) | rien. Deux voies qui se superposent sans nœud commun ne sont pas raccordées. |
| `service` présent / absent ; `usage` | voie de service / voie principale ; ligne principale ou secondaire | — |
| `highspeed=yes` (sinon `maxspeed` > 220, sinon `railway:tvm` ≠ `no`) | type de ligne LGV ; sinon classique | — |
| `maxspeed` de la voie | zone de limite de vitesse de A à B = les bouts de la voie OSM ; fusionner les voies consécutives de même vitesse | pas de vitesse par catégorie de train. Absent sur 0 à 20 % des voies principales et presque toutes les voies de service : valeur par défaut à proposer (30 km/h en voie de service ; vitesse de la voie voisine ou de la ligne en voie principale). |
| `maxspeed:forward` / `:backward` | vitesse par sens si le logiciel la gère, sinon la plus basse | rare (0,4 % des voies mesurées). |
| nœud `railway=switch` de degré 3 | aiguillage ; **voie directe et côté de déviation déduits de la géométrie** (la paire de branches la plus alignée est la voie directe) | `railway:turnout_side` absent à 96 % ; vitesse en déviation absente à 99,7 % : à fixer par défaut (30 ou 60 km/h) ou d'après le rayon mesuré. Position par défaut inconnue. |
| nœud `switch` de degré 4, `railway:switch=double_slip` / `single_slip` | traversée-jonction double / simple | une quarantaine de nœuds de degré 4 sans type à Paris : choisir TJD par défaut si les quatre branches sont tangentes deux à deux, sinon signaler. |
| `railway:switch=three_way` | aiguillage triple | 2 cas à Paris. |
| nœud `railway=railway_crossing` | traversée fixe (croisement à niveau sans changement de voie) | — |
| nœud de degré 3 ou 4 sans marque | traiter comme un aiguillage (degré 3) ou une traversée (degré 4) d'après les angles, et le signaler | 2 à 21 % des nœuds de degré 3. |
| `railway=buffer_stop`, bout de voie de degré 1 | fin de voie (heurtoir) | un bout de voie au bord de la boîte importée n'est pas une fin de voie : le marquer « coupé par l'import ». |
| `bridge`, `tunnel`, `layer`, `covered` | **niveau d'empilement entier par portion de voie**, voir ci-dessous | pas de pente, pas d'altitude, pas de position de rampe. |
| `railway=signal` + `railway:signal:direction` | signal : position = le nœud (abscisse sur la voie), sens de lecture = `forward` → sens du tracé OSM, `backward` → sens inverse | `both` et l'absence de sens (5 % des signaux principaux) : à ignorer ou à demander. |
| `railway:signal:main` = `FR:C` ou `FR:CARRE` ; ou `main:states` contenant `FR:C` ; ou plaque `FR:NF` | pro : **carré**, fonction protection ; standard : signal de trajectoire | les aspects (`states`), la cible, l'œilleton, les indicateurs de direction. |
| `railway:signal:main=FR:S` (et pas de `FR:C` dans `states`) ; plaque `FR:F`, `FR:PR`, `FR:BM` | pro : **sémaphore**, fonction espacement ; standard : signal de block | la distinction BAL / BAPR / BM (plaque) si le logiciel ne la porte pas. |
| `railway:signal:main=FR:GA` | carré (protection), par approximation | la nature du guidon d'arrêt. |
| `railway:signal:main` = `FR:Cv` ou `FR:CV` | pas d'équivalent : ignorer, ou carré sur voie de service si l'utilisateur le demande | la signalisation de manœuvre. |
| `railway:signal:train_protection=FR:marker` + `…:main=stop_marker` + `…:main:type=FR:NF` / `FR:F` | pro : **repère de LGV sans feux**, protection (`FR:NF`) ou espacement (`FR:F`) | anciennes valeurs `FR:REP_TVM`, `FR:repère_arrêt_TVM` : le type Nf / F n'y est pas lisible avec certitude → espacement par défaut, protection s'il précède un aiguillage. |
| `railway:signal:distant` (`FR:A`, `FR:D`), mirlitons, TIDD, pancartes | rien (l'annonce est implicite dans le logiciel) | tout. |
| `railway:signal:speed_limit*` (TIV, Z, R) | rien ; au mieux, contrôle de cohérence avec les zones de vitesse | les tableaux eux-mêmes. |
| `railway=milestone` + `railway:position` ; `ref:FR:SNCF_Reseau` | repère kilométrique si le logiciel en a, sinon rien | — |
| `railway=station` / `halt` / `platform` / `stop` | nom de gare, quai, point d'arrêt si le logiciel en a | — |
| `railway=level_crossing` | passage à niveau si le logiciel en a | — |
| `ref`, `name`, `railway:track_ref` | nom de ligne et de voie (étiquettes) | — |
| `electrified`, `voltage`, `frequency`, `railway:kvb`, `railway:tvm`, `railway:etcs` | `railway:tvm` sert à choisir le type de ligne et de signaux générés ; le reste n'a pas d'équivalent | — |

### Des attributs au niveau d'empilement

Règle proposée, par voie OSM (donc par portion, puisque la voie est coupée aux bouts de chaque ouvrage) :

1. **Si `layer` est présent et entier** : niveau = cette valeur, quels que soient les autres attributs (y compris pour une voie au sol : `layer=-1` en tranchée existe, 140 voies à Paris).
2. **Si `layer` est une liste** (`-1;-2`) : garder l'intervalle [min, max] ; niveau affiché = la valeur la plus proche de 0 ; marquer la portion « niveau incertain ».
3. **Sinon, si `bridge` est présent et différent de `no`** : niveau = +1.
4. **Sinon, si `tunnel` est présent, différent de `no` et de `building_passage`** : niveau = −1.
5. **Sinon** (`tunnel=building_passage`, `covered=*`, `cutting`, `embankment`, rien) : niveau = 0. `covered` et `building_passage` peuvent donner un simple indicateur « voie couverte », sans changer le niveau.

Ensuite :

6. **Contrôle aux croisements.** Chercher les croisements géométriques sans nœud commun (même calcul que ma mesure). Si les deux niveaux diffèrent, le plus grand est au-dessus : c'est décidé. S'ils sont égaux : indécidable, à signaler dans le compte rendu d'import.
7. **Compression facultative.** Les valeurs brutes vont de −8 à +2 à Paris. Comme seul l'ordre aux croisements compte, on peut renuméroter : construire le graphe « A passe sur B » à partir des croisements, puis donner à chaque portion le plus petit niveau qui respecte tous ses croisements (0 pour celles qui ne croisent rien et ne sont ni pont ni tunnel). À ne faire que si le logiciel veut des niveaux compacts ; sinon garder la valeur OSM, qui est déjà un entier utilisable.
8. **Transitions.** Le niveau change d'un coup au nœud de bout de l'ouvrage, sans rampe. Si le logiciel exige une rampe entre deux niveaux, il doit la fabriquer sur les portions voisines (longueur par défaut), puisque OSM ne dit rien de l'endroit où elle commence.

Cas où ce n'est pas décidable :

- **deux voies au même niveau qui se croisent sans nœud commun** : deux tunnels au même `layer` (9 cas, métro parisien), ou deux voies au sol (0 cas mesuré, mais c'est l'erreur de carte classique) ;
- **`layer` à valeurs multiples** dont les intervalles se recouvrent (19 voies à Paris, RER) ;
- **aiguillage posé sur le nœud de bout d'un ouvrage** (119 bouts de tunnel à Paris, 29 bouts de pont à Dijon) : les branches de l'aiguillage ont des niveaux différents ; choisir de donner à l'aiguillage le niveau de l'ouvrage, ou de reporter la transition sur la branche au sol ;
- **gare à plusieurs niveaux** décrite avec `level` plutôt que `layer` (268 voies à Paris portent `level`) : non utilisé par la règle ci-dessus ; à lire en secours quand `layer` manque ;
- **tunnel sans `layer` sous un autre tunnel sans `layer`** : tous deux à −1 par défaut ;
- **`tunnel=building_passage`** : par définition sans relation dessus / dessous ;
- croisement avec **autre chose qu'une voie ferrée** (route, rivière) : hors du calcul, mais c'est lui qui explique la plupart des ponts.

## Ce qui est réaliste

Par ordre de fiabilité décroissante, pour la France :

1. **Tracé et topologie des voies** — fiable partout. Une voie OSM par voie physique, nœuds partagés aux raccords, entraxe juste à ±15 cm sur ligne récente. L'ajustement d'arcs est à écrire mais les données le permettent (un sommet tous les 16 à 21 m en courbe).
2. **Voie principale / voie de service, LGV / classique, écartement, électrification** — fiable (≥ 94 % de la longueur).
3. **Niveaux (dessus / dessous)** — fiable : 162 croisements voie × voie décidés sur 162, 619 sur 628 tous types de voies confondus. Tous les ponts ont leur `layer`. Les cas indécidables sont rares et repérables automatiquement. Les pentes et les rampes ne sont pas dans OSM.
4. **Vitesses des voies principales** — bonnes : 80 à 100 % de la longueur. Les trous se comblent par la vitesse des voies voisines ou par le jeu SNCF `vitesse-maximale-nominale-sur-ligne` (par ligne, 2022). Voies de service : presque jamais renseignées, valeur par défaut nécessaire.
5. **Aiguillages : position** — bonne (79 à 98 % des nœuds de degré 3 marqués, et un nœud de degré 3 non marqué reste un aiguillage géométriquement). **Type, côté, vitesse en déviation, position normale** — à déduire de la géométrie ou à fixer par défaut ; les TJD sont marquées dans les grandes gares mais pas toutes.
6. **Heurtoirs** — partiels (33 à 61 % des bouts de voie, bords de boîte compris).
7. **Points kilométriques** — très inégaux (105 sur une zone, 0 sur deux autres) ; `ref:FR:SNCF_Reseau` donne seulement les PK des bouts de tronçon.
8. **Signaux** — irréguliers. Utilisables tels quels sur une partie de l'Île-de-France et quelques nœuds ; absents ou sans type ailleurs ; quasi absents des LGV hors LGV Méditerranée, Atlantique et BPL. Deux jeux de valeurs à reconnaître.

Ce qu'il faudra compléter autrement :

- **Signaux : génération automatique par défaut**, comme le fait OSRD (`--generate-signals`) : signal de protection avant chaque groupe d'aiguillages, signaux d'espacement à intervalle déduit de la vitesse, repères sans feux si `railway:tvm` ou `highspeed`. L'import des signaux réels est une **option** de la fenêtre, qui devrait afficher avant de valider combien de signaux principaux typés la zone contient (par exemple « 161 signaux réels trouvés » ou « aucun »), et permettre « réels là où il y en a, générés ailleurs ».
- **Vitesse en déviation et position normale des aiguillages** : valeur par défaut, retouche à la main.
- **Vitesses des voies de service** : valeur par défaut.
- **Rampes entre niveaux** : générées, ou saisies à la main dans une version ultérieure.
- **Mode de cantonnement** (BAL, BAPR, BM) : absent d'OSM ; disponible par ligne dans le jeu SNCF `mode-de-cantonnement-des-lignes` (2022), sinon choix de l'utilisateur.

Options que la fenêtre d'import devrait proposer, d'après ces mesures : la zone (avec une estimation de taille avant téléchargement) ; les types de voies (`rail` seul par défaut ; tram, métro, voies désaffectées en option — à Paris ils doublent le volume) ; voies de service oui / non ; signaux : générés / réels / mixte ; vitesse par défaut des voies sans `maxspeed` ; le serveur Overpass ; l'import depuis un fichier.

## Risques

1. **Disponibilité d'Overpass.** Environ la moitié de mes requêtes ont échoué (504, 429). Le serveur public se dit lui-même surchargé et demande à une application de rester sous ~100 requêtes et ~10 Mo par jour, tous utilisateurs confondus — quatre imports comme celui de Paris suffisent à atteindre ce volume. Parades : serveur configurable et miroirs, nouvelle tentative après 30 s, cache local des réponses, import par fichier, limite de surface.
2. **Deux schémas de signaux, et une page de référence qui bouge.** `FR:CARRE` / `FR:C`, `FR:CV` / `FR:Cv`, `FR:TIV-D` direct / `FR:speed_indicator` + sous-clé, `FR:REP_TVM` / `FR:marker`, `:plate` / `:type`. La page est « WIP » et a été modifiée le jour de la recherche ; d'autres renommages sont probables. Il faut une table de synonymes tenue à part du code de lecture, et accepter les valeurs inconnues sans échouer.
3. **Couverture des signaux trompeuse.** Un utilisateur qui essaie sur Paris conclura que tout y est ; à Dijon il obtiendra 9 signaux sans type, sur une LGV aucun. Sans génération automatique, le réseau importé n'est pas exploitable par la simulation.
4. **Doublons de nœuds dans la réponse** selon la forme de la requête (présent dans les quatre échantillons) : un lecteur naïf perd tous les attributs des aiguillages et des signaux.
5. **Sens du tracé.** `forward` / `backward` et `left` / `right` dépendent du sens de la voie OSM ; si l'import fusionne ou retourne des voies, il doit retourner ces attributs avec.
6. **Bords de la boîte.** Voies coupées au bord (faux bouts de voie), ouvrages et courbes tronqués, relations incomplètes.
7. **Volume en ville.** 1 192 voies et 700 aiguillages sur 17 km² à Paris ; le tram et le métro s'y ajoutent si on ne filtre pas. À confronter aux limites de performance du canevas et de l'historique par instantanés.
8. **Niveaux.** `layer` est local : ne jamais en tirer une altitude ni comparer deux portions qui ne se croisent pas. Valeurs multiples, `layer` au sol, aiguillages en bout d'ouvrage : cas réels, mesurés.
9. **Aiguillages complexes.** Nœuds de degré 4 sans type, TJD, traversées, aiguillages enchevêtrés des avant-gares : la reconstruction en appareils du logiciel est le point le plus délicat après les signaux.
10. **Géométrie.** Lignes brisées sans rayon : l'ajustement peut produire des cassures de tangente aux raccords et des rayons faux dans les appareils de voie ; les courbes de raccordement sont perdues.
11. **Licence.** Un projet contenant un import est très probablement une base dérivée sous ODbL : le logiciel doit inscrire l'attribution et la licence dans le fichier exporté et l'afficher. Mélanger ensuite des données d'une autre licence dans le même projet peut poser problème.
12. **Sources SNCF figées** (2020-2022) et jeu des signaux retiré : ne pas en faire une dépendance.
13. **Qualité variable d'OSM** : attributs fautifs rencontrés (`FR:Carré violet` dans `minor`, `tunnel=covered`, noms de voie dans `name`, `layer` à liste). Tout attribut doit être lu avec tolérance.

## Ce que je n'ai pas trouvé

- **Le nombre réel de signaux du réseau ferré national**, donc aucun taux de couverture national chiffré pour les signaux.
- **Une table officielle de correspondance entre anciennes et nouvelles valeurs françaises** (`FR:CARRE` → `FR:C`, etc.) : elle est déduite ici de la comparaison de deux révisions de la page et des données.
- La signification documentée de plusieurs valeurs rencontrées dans les données mais absentes de la révision actuelle : `railway:signal:main:shape=FR:K`, `railway:signal:main:plate`, `FR:GABARIT`, `FR:repère_arrêt_ETCS`, `FR:light_box` (`combined`), `FR:ATC`.
- Le détail de la page `OpenRailwayMap/ETCS_Markers` (téléchargée, non dépouillée).
- Une clé de vitesse **par catégorie de train** autre que `maxspeed:tilting` : rien dans les pages lues, rien dans les échantillons ; je ne peux pas affirmer qu'il n'en existe pas ailleurs.
- La **précision absolue** des voies OSM en France (aucune mesure faite, aucune source chiffrée lue).
- Une **méthode publiée d'ajustement d'arcs** propre aux voies ferrées d'OSM ; les méthodes citées au § 9 sont générales et non sourcées.
- Les tailles des extraits Geofabrik (la requête d'en-têtes a été redirigée) et la valeur par défaut de `maxsize` d'Overpass.
- Le comportement de **JOSM** et de **Rail Route** (non étudiés) ; pour **NIMBY Rails**, une seule source indirecte.
- Le seuil ODbL d'extrait « substantiel » et le texte exact de la page `openstreetmap.org/copyright` (non relus).
- Le contenu des jeux SNCF `liste-des-circuits-de-voie` et `images-des-feux-de-circulation-ferroviaire-en-france` (seuls les titres et les compteurs ont été lus).
- Si `overpass.private.coffee` ouvre bien le CORS (le serveur ne répondait pas lors de la mesure).
