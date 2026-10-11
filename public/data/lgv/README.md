# Jeu de données « LGV France »

Le réseau ferré à grande vitesse de France, avec les raccordements vers quelques gares de centre-ville,
prêt à être chargé par l'éditeur : un fichier projet par ligne et un index.

- Données OpenStreetMap du 2026-10-07T16:59:56Z, générées le 2026-10-11.
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
| Autres voies | `autres-01.json` | 37 | 2.3 km | 7 ko |
| Autres voies | `autres-02.json` | 80 | 3.1 km | 14 ko |
| LGV Atlantique | `lgv-atlantique-01.json` | 305 | 40.6 km | 94 ko |
| LGV Atlantique | `lgv-atlantique-02.json` | 196 | 69.8 km | 49 ko |
| LGV Atlantique | `lgv-atlantique-03.json` | 240 | 50.2 km | 59 ko |
| LGV Atlantique | `lgv-atlantique-04.json` | 289 | 60.4 km | 66 ko |
| LGV Atlantique | `lgv-atlantique-05.json` | 510 | 129.6 km | 120 ko |
| LGV Atlantique | `lgv-atlantique-06.json` | 147 | 43.6 km | 35 ko |
| LGV Atlantique | `lgv-atlantique-07.json` | 371 | 86.5 km | 88 ko |
| LGV Atlantique | `lgv-atlantique-08.json` | 228 | 46.4 km | 53 ko |
| LGV Bretagne - Pays de la Loire | `lgv-bretagne-pays-de-la-loire-01.json` | 247 | 53.9 km | 61 ko |
| LGV Bretagne - Pays de la Loire | `lgv-bretagne-pays-de-la-loire-02.json` | 417 | 102.7 km | 98 ko |
| LGV Bretagne - Pays de la Loire | `lgv-bretagne-pays-de-la-loire-03.json` | 543 | 123.1 km | 126 ko |
| LGV Bretagne - Pays de la Loire | `lgv-bretagne-pays-de-la-loire-04.json` | 434 | 102.4 km | 104 ko |
| LGV Bretagne - Pays de la Loire | `lgv-bretagne-pays-de-la-loire-05.json` | 129 | 27.6 km | 30 ko |
| LGV Contournement de Nîmes et Montpellier | `lgv-contournement-nimes-montpellier-01.json` | 927 | 102.5 km | 277 ko |
| LGV Contournement de Nîmes et Montpellier | `lgv-contournement-nimes-montpellier-02.json` | 257 | 26.5 km | 77 ko |
| LGV Est européenne | `lgv-est-europeenne-01.json` | 303 | 95.5 km | 71 ko |
| LGV Est européenne | `lgv-est-europeenne-02.json` | 295 | 94.8 km | 73 ko |
| LGV Est européenne | `lgv-est-europeenne-03.json` | 207 | 89.9 km | 51 ko |
| LGV Est européenne | `lgv-est-europeenne-04.json` | 217 | 80.0 km | 52 ko |
| LGV Est européenne | `lgv-est-europeenne-05.json` | 307 | 60.1 km | 71 ko |
| LGV Est européenne | `lgv-est-europeenne-06.json` | 319 | 83.5 km | 74 ko |
| LGV Est européenne | `lgv-est-europeenne-07.json` | 364 | 88.6 km | 89 ko |
| LGV Est européenne | `lgv-est-europeenne-08.json` | 319 | 85.3 km | 74 ko |
| LGV Est européenne | `lgv-est-europeenne-09.json` | 373 | 86.5 km | 85 ko |
| LGV Est européenne | `lgv-est-europeenne-10.json` | 288 | 61.6 km | 68 ko |
| LGV Interconnexion Est | `lgv-interconnexion-est.json` | 1041 | 150.3 km | 246 ko |
| LGV Méditerranée | `lgv-mediterranee-01.json` | 592 | 83.6 km | 136 ko |
| LGV Méditerranée | `lgv-mediterranee-02.json` | 561 | 90.1 km | 118 ko |
| LGV Méditerranée | `lgv-mediterranee-03.json` | 963 | 89.3 km | 200 ko |
| LGV Méditerranée | `lgv-mediterranee-04.json` | 986 | 117.8 km | 215 ko |
| LGV Méditerranée | `lgv-mediterranee-05.json` | 540 | 76.8 km | 118 ko |
| LGV Méditerranée | `lgv-mediterranee-06.json` | 309 | 63.5 km | 74 ko |
| LGV Nord | `lgv-nord-01.json` | 967 | 111.3 km | 231 ko |
| LGV Nord | `lgv-nord-02.json` | 329 | 88.8 km | 79 ko |
| LGV Nord | `lgv-nord-03.json` | 561 | 108.3 km | 131 ko |
| LGV Nord | `lgv-nord-04.json` | 869 | 93.2 km | 199 ko |
| LGV Nord | `lgv-nord-05.json` | 485 | 109.4 km | 112 ko |
| LGV Nord | `lgv-nord-06.json` | 333 | 85.3 km | 81 ko |
| LGV Nord | `lgv-nord-07.json` | 287 | 84.9 km | 70 ko |
| LGV Nord | `lgv-nord-08.json` | 621 | 119.5 km | 144 ko |
| LGV Perpignan - Figueres | `lgv-perpignan-figueres.json` | 304 | 55.7 km | 66 ko |
| LGV Rhin-Rhône | `lgv-rhin-rhone-01.json` | 257 | 43.7 km | 59 ko |
| LGV Rhin-Rhône | `lgv-rhin-rhone-02.json` | 313 | 47.5 km | 76 ko |
| LGV Rhin-Rhône | `lgv-rhin-rhone-03.json` | 243 | 51.9 km | 55 ko |
| LGV Rhin-Rhône | `lgv-rhin-rhone-04.json` | 617 | 106.2 km | 141 ko |
| LGV Rhin-Rhône | `lgv-rhin-rhone-05.json` | 231 | 43.3 km | 54 ko |
| LGV Rhône-Alpes | `lgv-rhone-alpes-01.json` | 261 | 50.0 km | 61 ko |
| LGV Rhône-Alpes | `lgv-rhone-alpes-02.json` | 535 | 91.0 km | 130 ko |
| LGV Rhône-Alpes | `lgv-rhone-alpes-03.json` | 605 | 94.6 km | 131 ko |
| LGV Sud-Est | `lgv-sud-est-01.json` | 288 | 56.5 km | 69 ko |
| LGV Sud-Est | `lgv-sud-est-02.json` | 464 | 115.0 km | 111 ko |
| LGV Sud-Est | `lgv-sud-est-03.json` | 498 | 110.9 km | 115 ko |
| LGV Sud-Est | `lgv-sud-est-04.json` | 285 | 54.5 km | 62 ko |
| LGV Sud-Est | `lgv-sud-est-05.json` | 313 | 69.8 km | 72 ko |
| LGV Sud-Est | `lgv-sud-est-06.json` | 351 | 63.0 km | 78 ko |
| LGV Sud-Est | `lgv-sud-est-07.json` | 415 | 87.7 km | 95 ko |
| LGV Sud-Est | `lgv-sud-est-08.json` | 505 | 93.0 km | 116 ko |
| LGV Sud-Est | `lgv-sud-est-09.json` | 257 | 44.2 km | 61 ko |
| LGV Sud-Est | `lgv-sud-est-10.json` | 251 | 45.5 km | 57 ko |
| LGV Sud-Est | `lgv-sud-est-11.json` | 900 | 119.0 km | 203 ko |
| LGV Sud-Est | `lgv-sud-est-12.json` | 300 | 68.2 km | 68 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-01.json` | 299 | 59.4 km | 70 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-02.json` | 397 | 105.1 km | 96 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-03.json` | 347 | 100.5 km | 82 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-04.json` | 233 | 87.4 km | 60 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-05.json` | 350 | 86.0 km | 82 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-06.json` | 493 | 91.4 km | 110 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-07.json` | 522 | 112.6 km | 124 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique-08.json` | 145 | 22.5 km | 42 ko |
| Ligne de Coni à Vintimille | `ligne-746000.json` | 1184 | 52.4 km | 285 ko |
| Ligne de Tarascon à Sète-Ville | `ligne-810000.json` | 100 | 4.4 km | 28 ko |
| Ligne de Villeneuve-lès-Avignon à Avignon | `ligne-824000.json` | 193 | 8.8 km | 42 ko |
| Ligne de Lyon-Perrache à Marseille-Saint-Charles (via Grenoble) | `ligne-905000-01.json` | 1046 | 65.8 km | 238 ko |
| Ligne de Lyon-Perrache à Marseille-Saint-Charles (via Grenoble) | `ligne-905000-02.json` | 687 | 51.5 km | 150 ko |
| Ligne de Lyon-Perrache à Marseille-Saint-Charles (via Grenoble) | `ligne-905000-03.json` | 953 | 73.9 km | 213 ko |
| Ligne de Lyon-Perrache à Marseille-Saint-Charles (via Grenoble) | `ligne-905000-04.json` | 1128 | 61.2 km | 280 ko |
| Ligne de Livron à Aspres-sur-Buëch | `ligne-912000.json` | 253 | 17.9 km | 59 ko |
| Ligne de Veynes à Briançon | `ligne-915000-01.json` | 564 | 36.8 km | 134 ko |
| Ligne de Veynes à Briançon | `ligne-915000-02.json` | 222 | 20.3 km | 49 ko |
| Ligne de Veynes à Briançon | `ligne-915000-03.json` | 946 | 60.8 km | 210 ko |
| Ligne de Cheval-Blanc à Pertuis | `ligne-923000.json` | 318 | 40.8 km | 68 ko |
| Ligne d'Avignon à Miramas | `ligne-925000-01.json` | 587 | 43.3 km | 161 ko |
| Ligne d'Avignon à Miramas | `ligne-925000-02.json` | 775 | 96.0 km | 230 ko |
| Ligne d'Avignon à Miramas | `ligne-925000-03.json` | 138 | 7.3 km | 34 ko |
| Ligne de Sorgues - Châteauneuf-du-Pape à Carpentras | `ligne-927000.json` | 212 | 17.4 km | 64 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-01.json` | 2087 | 131.1 km | 601 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-02.json` | 267 | 13.4 km | 77 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-03.json` | 539 | 22.4 km | 144 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-04.json` | 662 | 53.0 km | 175 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-05.json` | 1014 | 94.1 km | 303 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-06.json` | 1447 | 118.8 km | 424 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-07.json` | 1196 | 89.1 km | 335 ko |
| Ligne de Marseille-Saint-Charles à Vintimille (frontière) | `ligne-930000-08.json` | 390 | 37.5 km | 116 ko |
| Ligne de Miramas à l'Estaque | `ligne-935000-01.json` | 823 | 74.5 km | 196 ko |
| Ligne de Miramas à l'Estaque | `ligne-935000-02.json` | 1466 | 92.1 km | 424 ko |
| Ligne de L'Estaque à Marseille-Saint-Charles | `ligne-939001.json` | 393 | 14.7 km | 80 ko |
| Ligne de La Pauline-Hyères aux Salins-d'Hyères | `ligne-942000.json` | 166 | 11.6 km | 49 ko |
| Ligne de Cannes-la-Bocca à Grasse | `ligne-944000-01.json` | 128 | 6.4 km | 29 ko |
| Ligne de Cannes-la-Bocca à Grasse | `ligne-944000-02.json` | 203 | 11.7 km | 57 ko |
| Ligne de Nice à Breil-sur-Roya | `ligne-945000.json` | 922 | 48.2 km | 248 ko |
| Ligne de Paris à Marseille : section Lyon - Marseille | `ligne-r4117951-01.json` | 908 | 108.5 km | 218 ko |
| Ligne de Paris à Marseille : section Lyon - Marseille | `ligne-r4117951-02.json` | 1238 | 133.4 km | 271 ko |
| Ligne de Paris à Marseille : section Lyon - Marseille | `ligne-r4117951-03.json` | 204 | 21.9 km | 43 ko |
| Ligne de Paris à Marseille : section Lyon - Marseille | `ligne-r4117951-04.json` | 1462 | 106.6 km | 372 ko |
| Raccordement de Lyon Part-Dieu par le nord | `racc-lyon-part-dieu-nord.json` | 661 | 42.4 km | 155 ko |
| Raccordement de Lyon Part-Dieu par le sud | `racc-lyon-part-dieu-sud-01.json` | 403 | 11.6 km | 90 ko |
| Raccordement de Lyon Part-Dieu par le sud | `racc-lyon-part-dieu-sud-02.json` | 2157 | 115.6 km | 519 ko |
| Raccordement de Lyon Part-Dieu par le sud | `racc-lyon-part-dieu-sud-03.json` | 147 | 19.0 km | 35 ko |
| Raccordement de Marseille Saint-Charles | `racc-marseille-saint-charles.json` | 1743 | 64.5 km | 425 ko |
| Raccordement de Paris Gare de Lyon | `racc-paris-gare-de-lyon-01.json` | 4235 | 191.9 km | 1062 ko |
| Raccordement de Paris Gare de Lyon | `racc-paris-gare-de-lyon-02.json` | 488 | 41.4 km | 148 ko |
| Raccordement de Paris Gare de Lyon | `racc-paris-gare-de-lyon-03.json` | 311 | 38.5 km | 82 ko |
