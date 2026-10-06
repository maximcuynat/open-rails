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
  - Ni signaux, ni quais, ni hauteurs (aucun croisement dénivelé rail/rail dans la zone) ; une rame à quai depuis.
  - Vue d'ensemble chargée : étiquettes de zones et de sections superposées.

## Exemples dessinés à la main, prêts à conduire (2026-10-05)

- [x] `tools/examples/` : un générateur par exemple (`builder.ts` porte les gestes de l'éditeur : voie, arc,
  aiguillage parallèle, bretelle, signal, zone de vitesse, rame complète), projet écrit par `store.exportProject()`
- [x] Sept exemples au menu, du plus simple au plus chargé : Premiers tours de roue, Rampe et courbe,
  Saut-de-mouton, Bifurcation, Terminus, Voie unique avec évitement, Gare de passage (type Aix-en-Provence TGV) ;
  Marseille en dernier
- [x] Une rame à quai dans Marseille Saint-Charles (`marseille-train.ts` n'ajoute que la clé `trains` au fichier)
- [x] Un exemple qui porte une caméra s'ouvre dessus (sa rame, à 4 px/m) ; les autres sont cadrés en entier
- [x] Tests `src/examples/examples.test.ts` + `driving.testkit.ts` : relecture sans perte, aucun défaut
  cinématique, contrôle de la signalisation vide, rame complète sur la voie, conduite simulée par les appels
  du clavier, et ce que chaque exemple montre
- [x] « Voie unique avec évitement » : au menu, entre Terminus et Gare de passage (2026-10-06). Le défaut qui le
  retenait est corrigé dans le domaine : un itinéraire qui bute sur une aiguille tournée contre son train n'est
  plus un itinéraire « vers une fin de voie » (`SignalRoute.blockedAt`). Son signal reste fermé — carré comme
  sémaphore, cause `points-against` pour ce dernier —, l'itinéraire déjà donné est repris si l'aiguille est
  tournée ensuite, et le train tient la voie jusqu'à l'aiguille sans tenir l'aiguille. Les deux rames se
  croisent dans les deux ordres de la liste, aiguilles tournées au clic ou aux flèches, sans mise au neutre
  (`examples.test.ts`) ; cas voisins dans `src/domain/models/signalling.pointsAgainst.test.ts`.

Régénérer : `npx vite-node tools/examples/generate.ts` (tous), ou `npx vite-node tools/examples/generate.ts terminus` (un seul).

À savoir :
- Les aiguilles n'ont de vitesse en voie déviée que pour la signalisation « pro » : chaque voie déviée porte
  donc une zone à la vitesse de son aiguille, posée à partir de la pointe (posée plus loin, l'annonce donne
  d'abord la limite de la courbe).
- Ligne à 300 km/h : le contrôle demande 4 960 m de canton (arrêt à 0,7 m/s²). Le carré d'entrée de la gare
  de passage est donc à 5 km des aiguilles, et la ligne fait 22 km.
- Marseille : la rame est sur la voie d'où les aiguilles, telles qu'importées, laissent rouler le plus loin
  (650 m) ; au-delà il faut tourner les aiguilles.

## Idées pour la suite

- Gares réelles, même script : Lyon Part-Dieu (gare de passage), Paris Gare de Lyon, triage de Miramas,
  bifurcation LGV d'Avignon, Zurich HB.
- Réseaux dessinés à la main : ovale HO Kato avec évitement, voie unique avec croisement (signalisation),
  terminus 3 voies + remise, triage en éventail, boucle de retournement, huit avec pont (rampes),
  démonstration bretelles / TJD.
- Poser des signaux dans l'exemple de Marseille.
