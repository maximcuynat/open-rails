# Réseaux d'exemple (Fichier ▸ Exemples)

## Fait (2026-10-05)

- [x] `tools/osm-import/osm_to_project.py` : OpenStreetMap (`osmnx`, `railway=rail`) → fichier projet à l'échelle réelle
- [x] `src/examples/` : catalogue (`index.ts`), `marseille-saint-charles.json` (asset séparé, chargé au clic)
- [x] Menu Fichier ▸ Exemples, confirmation si le plan n'est pas vide, cadrage à l'ouverture
- [x] Mention ODbL dans « À propos »
- [x] Tests `src/examples/examples.test.ts`
- [x] Passe de réconciliation : boîtes englobantes calculées une fois (≈ 500 ms → ≈ 60 ms sur 1 500 rails)

## Revue

- Marseille Saint-Charles : 1 441 nœuds, 1 503 rails, 140 zones de vitesse ; l'éditeur y lit 124 aiguillages
  et 20 traversées-jonctions, et la relecture ne soude ni ne coupe rien.
- Régénérer : `python tools/osm-import/osm_to_project.py --lat 43.3030 --lon 5.3815 --dist 1100 --name "Marseille Saint-Charles (OSM)" -o src/examples/marseille-saint-charles.json`
- Limites connues :
  - 27 rails courbes sur 1 255 ont un rayon < 100 m (4 sous 60 m), presque tous autour des
    traversées-jonctions, dont les quatre rails sont ramenés tangents au nœud : la vitesse en courbe y est basse.
  - 2 nœuds à quatre voies ne sont lus ni comme traversée ni comme TJD (le script les liste).
  - Ni signaux, ni quais, ni hauteurs (aucun croisement dénivelé rail/rail dans la zone), ni trains.
  - Vue d'ensemble chargée : étiquettes de zones et de sections superposées.

## Idées pour la suite

- Gares réelles, même script : Lyon Part-Dieu (gare de passage), Paris Gare de Lyon, triage de Miramas,
  bifurcation LGV d'Avignon, Zurich HB.
- Réseaux dessinés à la main : ovale HO Kato avec évitement, voie unique avec croisement (signalisation),
  terminus 3 voies + remise, triage en éventail, boucle de retournement, huit avec pont (rampes),
  démonstration bretelles / TJD.
- Poser un train et des signaux dans l'exemple de Marseille.
