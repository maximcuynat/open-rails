# Leçons

## 2026-10-04 — Inverser le sens = refouler, pas retourner le train

- **Correction reçue** : en marche arrière, le train doit reculer en gardant son orientation ; il ne doit pas pivoter.
- **Cause** : `getTrainSetVisuals` passait `train.direction` à `getTGVDetails`, qui dessine le nez du côté du sens de marche. Les tests ne vérifiaient que la position des bogies, pas la carrosserie dessinée.
- **Règle** : `TrainSet.direction` est un sens de déplacement, jamais une orientation de caisse. L'orientation vient uniquement des bogies `front` / `rear` fixés à la pose. Pour tout changement de cinématique, tester aussi ce qui est dessiné (`getTrainSetVisuals`), pas seulement les positions sur la voie.
