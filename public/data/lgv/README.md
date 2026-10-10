# Jeu de données « LGV France »

Le réseau ferré à grande vitesse de France, avec les raccordements vers quelques gares de centre-ville,
prêt à être chargé par l'éditeur : un fichier projet par ligne et un index.

- Données OpenStreetMap du 2026-10-07T16:59:56Z, générées le 2026-10-07.
- Voies, gares et signaux : © les contributeurs d’OpenStreetMap, licence ODbL 1.0 — https://www.openstreetmap.org/copyright
- Noms et codes des gares : SNCF Gares & Connexions, « Gares de voyageurs », licence ODbL 1.0 — https://ressources.data.sncf.com/explore/dataset/gares-de-voyageurs/
- Repère : Lambert-93 (EPSG:2154), origine (46,5° N, 3° E) au monde (0, 0), y vers le sud.

Dans l'éditeur : Fichier ▸ « Ligne entre gares… » cherche les gares dans `index.json`, télécharge les fichiers des
lignes de l'itinéraire et les charge comme projet verrouillé (sauvegardé comme recette, rechargé à l'ouverture) ; une ligne
voisine est ajoutée quand un train s'en approche.

Régénérer : `node tools/lgv-dataset/run.mjs` (voir `tools/lgv-dataset/manifest.json` ; `--offline` relit le cache).

## Fichiers

`index.json` : les lignes (fichier, longueur, boîte, gares), les raccords entre lignes (nœuds communs) et les gares
(nom, code UIC, trigramme, position, lignes). Chaque fichier de ligne est un projet complet de l'éditeur ; les
fichiers partagent leurs ids et se réunissent par union (`unionProjects`).

| Ligne | Fichier | Rails | Longueur | Taille |
|---|---|---|---|---|
| LGV Atlantique | `lgv-atlantique.json` | 2286 | 527.1 km | 561 ko |
| LGV Bretagne - Pays de la Loire | `lgv-bretagne-pays-de-la-loire.json` | 1770 | 409.7 km | 415 ko |
| LGV Contournement de Nîmes et Montpellier | `lgv-contournement-nimes-montpellier.json` | 1184 | 129.0 km | 356 ko |
| LGV Est européenne | `lgv-est-europeenne.json` | 2992 | 825.9 km | 703 ko |
| LGV Interconnexion Est | `lgv-interconnexion-est.json` | 1041 | 150.3 km | 246 ko |
| LGV Méditerranée | `lgv-mediterranee.json` | 3892 | 519.7 km | 841 ko |
| LGV Nord | `lgv-nord.json` | 4452 | 800.7 km | 1042 ko |
| LGV Perpignan - Figueres | `lgv-perpignan-figueres.json` | 304 | 55.7 km | 66 ko |
| LGV Rhin-Rhône | `lgv-rhin-rhone.json` | 1661 | 292.5 km | 383 ko |
| LGV Rhône-Alpes | `lgv-rhone-alpes.json` | 1401 | 235.6 km | 321 ko |
| LGV Sud-Est | `lgv-sud-est.json` | 4822 | 927.3 km | 1099 ko |
| LGV Sud Europe Atlantique | `lgv-sud-europe-atlantique.json` | 2786 | 664.8 km | 663 ko |
| Raccordement de Lyon Part-Dieu par le nord | `racc-lyon-part-dieu-nord.json` | 224 | 16.6 km | 53 ko |
| Raccordement de Lyon Part-Dieu par le sud | `racc-lyon-part-dieu-sud.json` | 2274 | 141.4 km | 549 ko |
| Raccordement de Marseille Saint-Charles | `racc-marseille-saint-charles.json` | 1564 | 61.0 km | 378 ko |
| Raccordement de Paris Gare de Lyon | `racc-paris-gare-de-lyon.json` | 3973 | 243.3 km | 1057 ko |
