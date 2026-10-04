# Leçons

## 2026-10-04 — Inverser le sens = refouler, pas retourner le train

- **Correction reçue** : en marche arrière, le train doit reculer en gardant son orientation ; il ne doit pas pivoter.
- **Cause** : `getTrainSetVisuals` passait `train.direction` à `getTGVDetails`, qui dessine le nez du côté du sens de marche. Les tests ne vérifiaient que la position des bogies, pas la carrosserie dessinée.
- **Règle** : `TrainSet.direction` est un sens de déplacement, jamais une orientation de caisse. L'orientation vient uniquement des bogies `front` / `rear` fixés à la pose. Pour tout changement de cinématique, tester aussi ce qui est dessiné (`getTrainSetVisuals`), pas seulement les positions sur la voie.

## 2026-10-04 — Modifier un rail ne déplace pas le train posé dessus

- **Correction reçue** : en déplaçant un nœud d'une voie, le train doit rester exactement où il est ; seul le rail change de dimension. Un premier correctif gardait la longueur du train mais le laissait glisser avec la voie.
- **Cause** : les bogies sont stockés en fraction de segment (`t`). Le recalage partait du bogie de tête à `t` constant, donc le train suivait l'allongement du segment.
- **Règle** : pour toute édition de la géométrie des rails, l'invariant est la position des trains dans le monde, pas leur `t`. Mémoriser la position monde avant l'édition (`pinTrains`), la reprojeter sur le rail après (`realignTrains`), et tester les coordonnées monde des bogies, pas seulement les distances entre eux.
