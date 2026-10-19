# Jeu de données « LGV France »

Le réseau ferré à grande vitesse de France, avec les raccordements vers quelques gares de centre-ville,
prêt à être chargé par l'éditeur : un fichier projet par ligne et un index.

- Données OpenStreetMap du 2026-10-07T16:59:56Z, générées le 2026-10-19.
- Voies, gares et signaux : © les contributeurs d’OpenStreetMap, licence ODbL 1.0 — https://www.openstreetmap.org/copyright
- Noms et codes des gares : SNCF Gares & Connexions, « Gares de voyageurs », licence ODbL 1.0 — https://ressources.data.sncf.com/explore/dataset/gares-de-voyageurs/
- Repère : Lambert-93 (EPSG:2154), origine (46,5° N, 3° E) au monde (0, 0), y vers le sud.

Régénérer : `node tools/lgv-dataset/run.mjs` (voir `tools/lgv-dataset/manifest.json` ; `--offline` relit le cache).

## Fichiers

`index.json` : les lignes (fichier, longueur, boîte, gares), les raccords entre lignes (nœuds communs) et les gares
(nom, code UIC, trigramme, position, lignes). Chaque fichier de ligne est un projet complet de l'éditeur ; les
fichiers partagent leurs ids et se réunissent par union (`unionProjects`).

| Ligne | Fichier | Rails | Longueur | Taille |
|---|---|---|---|---|
| Autres voies | `autres-01.json` | 37 | 2.3 km | 9 ko |
| Autres voies | `autres-02.json` | 80 | 3.1 km | 16 ko |
| LGV Atlantique | `lgv-atlantique-01.json` | 276 | 40.6 km | 91 ko |
| LGV Atlantique | `lgv-atlantique-02.json` | 195 | 69.8 km | 52 ko |
| LGV Atlantique | `lgv-atlantique-03.json` | 230 | 50.2 km | 61 ko |
| LGV Atlantique | `lgv-atlantique-04.json` | 290 | 60.4 km | 71 ko |
| LGV Atlantique | `lgv-atlantique-05.json` | 510 | 129.6 km | 130 ko |
| LGV Atlantique | `lgv-atlantique-06.json` | 147 | 43.6 km | 38 ko |
| LGV Atlantique | `lgv-atlantique-07.json` | 371 | 86.5 km | 95 ko |
| LGV Atlantique | `lgv-atlantique-08.json` | 225 | 46.4 km | 57 ko |
| LGV Bretagne - Pays de la Loire | `lgv-bretagne-pays-de-la-loire-01.json` | 240 | 53.9 km | 64 ko |
| LGV Bretagne - Pays de la Loire | `lgv-bretagne-pays-de-la-loire-02.json` | 410 | 102.7 km | 104 ko |
| LGV Bretagne - Pays de la Loire | `lgv-bretagne-pays-de-la-loire-03.json` | 544 | 123.1 km | 136 ko |
| LGV Bretagne - Pays de la Loire | `lgv-bretagne-pays-de-la-loire-04.json` | 431 | 102.4 km | 111 ko |
| LGV Bretagne - Pays de la Loire | `lgv-bretagne-pays-de-la-loire-05.json` | 129 | 27.6 km | 32 ko |
| LGV Contournement de Nîmes et Montpellier | `lgv-contournement-nimes-montpellier-01.json` | 923 | 102.5 km | 302 ko |
| LGV Contournement de Nîmes et Montpellier | `lgv-contournement-nimes-montpellier-02.json` | 255 | 26.5 km | 81 ko |
| LGV Est européenne | `lgv-est-europeenne-01.json` | 303 | 95.5 km | 77 ko |
| LGV Est européenne | `lgv-est-europeenne-02.json` | 297 | 94.5 km | 80 ko |
| LGV Est européenne | `lgv-est-europeenne-03.json` | 205 | 90.2 km | 55 ko |
| LGV Est européenne | `lgv-est-europeenne-04.json` | 217 | 80.0 km | 57 ko |
| LGV Est européenne | `lgv-est-europeenne-05.json` | 307 | 60.1 km | 77 ko |
| LGV Est européenne | `lgv-est-europeenne-06.json` | 319 | 83.5 km | 82 ko |
| LGV Est européenne | `lgv-est-europeenne-07.json` | 363 | 88.6 km | 96 ko |
| LGV Est européenne | `lgv-est-europeenne-08.json` | 315 | 85.3 km | 79 ko |
| LGV Est européenne | `lgv-est-europeenne-09.json` | 369 | 86.5 km | 92 ko |
| LGV Est européenne | `lgv-est-europeenne-10.json` | 285 | 61.6 km | 73 ko |
| LGV Interconnexion Est | `lgv-interconnexion-est.json` | 1035 | 150.3 km | 266 ko |
| LGV Méditerranée | `lgv-mediterranee-01.json` | 592 | 83.6 km | 147 ko |
| LGV Méditerranée | `lgv-mediterranee-02.json` | 559 | 90.1 km | 129 ko |
| LGV Méditerranée | `lgv-mediterranee-03.json` | 958 | 89.3 km | 218 ko |
| LGV Méditerranée | `lgv-mediterranee-04.json` | 982 | 117.8 km | 235 ko |
| LGV Méditerranée | `lgv-mediterranee-05.json` | 538 | 76.8 km | 128 ko |
| LGV Méditerranée | `lgv-mediterranee-06.json` | 288 | 63.5 km | 77 ko |
| LGV Nord | `lgv-nord-01.json` | 955 | 111.3 km | 245 ko |
| LGV Nord | `lgv-nord-02.json` | 329 | 88.8 km | 86 ko |
| LGV Nord | `lgv-nord-03.json` | 557 | 108.3 km | 139 ko |
| LGV Nord | `lgv-nord-04.json` | 849 | 93.2 km | 212 ko |
| LGV Nord | `lgv-nord-05.json` | 485 | 109.4 km | 120 ko |
| LGV Nord | `lgv-nord-06.json` | 325 | 85.3 km | 86 ko |
| LGV Nord | `lgv-nord-07.json` | 287 | 84.9 km | 76 ko |
| LGV Nord | `lgv-nord-08.json` | 621 | 119.5 km | 156 ko |
| LGV Perpignan - Figueres | `lgv-perpignan-figueres.json` | 295 | 55.7 km | 69 ko |
| LGV Rhin-Rhône | `lgv-rhin-rhone-01.json` | 258 | 43.6 km | 65 ko |
| LGV Rhin-Rhône | `lgv-rhin-rhone-02.json` | 314 | 47.5 km | 83 ko |
| LGV Rhin-Rhône | `lgv-rhin-rhone-03.json` | 240 | 51.9 km | 59 ko |
| LGV Rhin-Rhône | `lgv-rhin-rhone-04.json` | 609 | 106.2 km | 152 ko |
| LGV Rhin-Rhône | `lgv-rhin-rhone-05.json` | 227 | 43.3 km | 57 ko |
| LGV Rhône-Alpes | `lgv-rhone-alpes-01.json` | 249 | 50.0 km | 63 ko |
| LGV Rhône-Alpes | `lgv-rhone-alpes-02.json` | 535 | 91.0 km | 141 ko |
| LGV Rhône-Alpes | `lgv-rhone-alpes-03.json` | 599 | 94.6 km | 142 ko |
| LGV Sud-Est | `lgv-sud-est-01.json` | 270 | 56.5 km | 71 ko |
| LGV Sud-Est | `lgv-sud-est-02.json` | 464 | 115.0 km | 120 ko |
| LGV Sud-Est | `lgv-sud-est-03.json` | 498 | 110.9 km | 125 ko |
| LGV Sud-Est | `lgv-sud-est-04.json` | 283 | 54.5 km | 67 ko |
| LGV Sud-Est | `lgv-sud-est-05.json` | 313 | 69.8 km | 78 ko |
| LGV Sud-Est | `lgv-sud-est-06.json` | 351 | 63.0 km | 85 ko |
| LGV Sud-Est | `lgv-sud-est-07.json` | 415 | 87.7 km | 103 ko |
| LGV Sud-Est | `lgv-sud-est-08.json` | 502 | 93.0 km | 125 ko |
| LGV Sud-Est | `lgv-sud-est-09.json` | 255 | 44.2 km | 66 ko |
| LGV Sud-Est | `lgv-sud-est-10.json` | 248 | 45.5 km | 61 ko |
| LGV Sud-Est | `lgv-sud-est-11.json` | 898 | 119.0 km | 221 ko |
| LGV Sud-Est | `lgv-sud-est-12.json` | 294 | 68.1 km | 73 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-01.json` | 288 | 59.4 km | 74 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-02.json` | 397 | 105.1 km | 103 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-03.json` | 347 | 100.5 km | 89 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-04.json` | 233 | 87.4 km | 65 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-05.json` | 350 | 86.0 km | 89 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-06.json` | 494 | 91.4 km | 120 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-07.json` | 522 | 112.6 km | 134 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-08.json` | 145 | 22.5 km | 45 ko |
| Ligne de Coni à Vintimille | `ligne-746000.json` | 1181 | 52.4 km | 295 ko |
| Ligne de Tarascon à Sète-Ville | `ligne-810000.json` | 100 | 4.4 km | 30 ko |
| Ligne de Villeneuve-lès-Avignon à Avignon | `ligne-824000.json` | 192 | 8.8 km | 46 ko |
| Ligne de Lyon-Perrache à Marseille-Saint-Charles (via Grenoble) | `ligne-905000-01.json` | 1015 | 65.7 km | 240 ko |
| Ligne de Lyon-Perrache à Marseille-Saint-Charles (via Grenoble) | `ligne-905000-02.json` | 527 | 43.8 km | 116 ko |
| Ligne de Lyon-Perrache à Marseille-Saint-Charles (via Grenoble) | `ligne-905000-03.json` | 120 | 7.8 km | 29 ko |
| Ligne de Lyon-Perrache à Marseille-Saint-Charles (via Grenoble) | `ligne-905000-04.json` | 901 | 73.9 km | 205 ko |
| Ligne de Lyon-Perrache à Marseille-Saint-Charles (via Grenoble) | `ligne-905000-05.json` | 1095 | 61.2 km | 288 ko |
| Ligne de Livron à Aspres-sur-Buëch | `ligne-912000.json` | 225 | 17.9 km | 55 ko |
| Ligne de Veynes à Briançon | `ligne-915000-01.json` | 547 | 36.8 km | 135 ko |
| Ligne de Veynes à Briançon | `ligne-915000-02.json` | 220 | 20.3 km | 49 ko |
| Ligne de Veynes à Briançon | `ligne-915000-03.json` | 911 | 60.8 km | 207 ko |
| Ligne de Cheval-Blanc à Pertuis | `ligne-923000.json` | 315 | 40.8 km | 67 ko |
| Ligne d'Avignon à Miramas | `ligne-925000-01.json` | 587 | 43.3 km | 175 ko |
| Ligne d'Avignon à Miramas | `ligne-925000-02.json` | 755 | 96.0 km | 247 ko |
| Ligne d'Avignon à Miramas | `ligne-925000-03.json` | 136 | 7.3 km | 36 ko |
| Ligne de Sorgues - Châteauneuf-du-Pape à Carpentras | `ligne-927000.json` | 209 | 17.4 km | 67 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-01.json` | 2023 | 131.1 km | 648 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-02.json` | 266 | 13.4 km | 93 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-03.json` | 530 | 22.4 km | 153 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-04.json` | 652 | 53.0 km | 194 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-05.json` | 1034 | 93.8 km | 340 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-06.json` | 1434 | 118.8 km | 469 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-07.json` | 1151 | 89.1 km | 356 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-08.json` | 431 | 37.9 km | 140 ko |
| Ligne de Miramas à l'Estaque | `ligne-935000-01.json` | 812 | 74.5 km | 210 ko |
| Ligne de Miramas à l'Estaque | `ligne-935000-02.json` | 1420 | 92.0 km | 455 ko |
| Ligne de L'Estaque à Marseille-Saint-Charles | `ligne-939001.json` | 393 | 14.7 km | 87 ko |
| Ligne de La Pauline-Hyères aux Salins-d'Hyères | `ligne-942000.json` | 159 | 11.6 km | 50 ko |
| Ligne de Cannes-la-Bocca à Grasse | `ligne-944000-01.json` | 128 | 6.4 km | 30 ko |
| Ligne de Cannes-la-Bocca à Grasse | `ligne-944000-02.json` | 195 | 11.7 km | 59 ko |
| Ligne de Nice à Breil-sur-Roya | `ligne-945000.json` | 843 | 48.2 km | 237 ko |
| Ligne de Paris à Marseille : section Lyon - Marseille | `ligne-r4117951-01.json` | 862 | 108.5 km | 230 ko |
| Ligne de Paris à Marseille : section Lyon - Marseille | `ligne-r4117951-02.json` | 1217 | 133.4 km | 300 ko |
| Ligne de Paris à Marseille : section Lyon - Marseille | `ligne-r4117951-03.json` | 202 | 21.9 km | 47 ko |
| Ligne de Paris à Marseille : section Lyon - Marseille | `ligne-r4117951-04.json` | 1448 | 106.6 km | 411 ko |
| Raccordement de Lyon Part-Dieu par le nord | `racc-lyon-part-dieu-nord.json` | 656 | 42.4 km | 167 ko |
| Raccordement de Lyon Part-Dieu par le sud | `racc-lyon-part-dieu-sud-01.json` | 399 | 11.6 km | 93 ko |
| Raccordement de Lyon Part-Dieu par le sud | `racc-lyon-part-dieu-sud-02.json` | 2152 | 115.6 km | 573 ko |
| Raccordement de Lyon Part-Dieu par le sud | `racc-lyon-part-dieu-sud-03.json` | 147 | 19.0 km | 39 ko |
| Raccordement de Marseille Saint-Charles | `racc-marseille-saint-charles.json` | 1737 | 64.5 km | 435 ko |
| Raccordement de Paris Gare de Lyon | `racc-paris-gare-de-lyon-01.json` | 4205 | 191.9 km | 1133 ko |
| Raccordement de Paris Gare de Lyon | `racc-paris-gare-de-lyon-02.json` | 483 | 41.4 km | 166 ko |
| Raccordement de Paris Gare de Lyon | `racc-paris-gare-de-lyon-03.json` | 308 | 38.5 km | 88 ko |
