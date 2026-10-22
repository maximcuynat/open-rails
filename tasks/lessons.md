# Leçons

## 2026-10-04 — Inverser le sens = refouler, pas retourner le train

- **Correction reçue** : en marche arrière, le train doit reculer en gardant son orientation ; il ne doit pas pivoter.
- **Cause** : `getTrainSetVisuals` passait `train.direction` à `getTGVDetails`, qui dessine le nez du côté du sens de marche. Les tests ne vérifiaient que la position des bogies, pas la carrosserie dessinée.
- **Règle** : `TrainSet.direction` est un sens de déplacement, jamais une orientation de caisse. L'orientation vient uniquement des bogies `front` / `rear` fixés à la pose. Pour tout changement de cinématique, tester aussi ce qui est dessiné (`getTrainSetVisuals`), pas seulement les positions sur la voie.

## 2026-10-04 — Modifier un rail ne déplace pas le train posé dessus

- **Correction reçue** : en déplaçant un nœud d'une voie, le train doit rester exactement où il est ; seul le rail change de dimension. Un premier correctif gardait la longueur du train mais le laissait glisser avec la voie.
- **Cause** : les bogies sont stockés en fraction de segment (`t`). Le recalage partait du bogie de tête à `t` constant, donc le train suivait l'allongement du segment.
- **Règle** : pour toute édition de la géométrie des rails, l'invariant est la position des trains dans le monde, pas leur `t`. Mémoriser la position monde avant l'édition (`pinTrains`), la reprojeter sur le rail après (`realignTrains`), et tester les coordonnées monde des bogies, pas seulement les distances entre eux.

## 2026-10-05 — « Travailler sur le rendu » ne veut pas dire changer l'aspect

- **Correction reçue** : j'avais proposé de brancher ballast et traverses ; réponse : optimiser les performances, garder l'aspect actuel (deux files de rail uniquement).
- **Cause** : j'ai lu « rendu des voies » comme une demande visuelle et mis en avant le gain d'aspect.
- **Règle** : sur le rendu, la performance d'abord et l'aspect ne bouge pas sans demande explicite. Ne pas proposer de rebrancher ballast, traverses ou éclisses. Toute optimisation qui déplace un pixel (ordre de superposition, regroupement de tracés) est signalée avant d'être faite.

## 2026-10-11 — Croisement : un train à l'arrêt occupe la voie sous lui, pas seulement devant lui

- **Correction reçue** : après ma première version du croisement sur voie unique, deux trains se retrouvaient encore sur la même voie : l'un visait le quai où l'autre attendait, la voie d'à côté libre.
- **Cause** : je ne comptais comme « prise » que la voie du trajet à venir de l'autre train, à partir de son bogie de tête ; les rails sous sa rame n'y étaient pas. Et mes essais faisaient toujours partir les deux trains en même temps : aucun n'attendait à quai pendant que l'autre arrivait. Le trajet n'était par ailleurs revu qu'une fois le train arrêté.
- **Règle** : pour tout ce qui choisit une voie ou un quai, l'occupation d'un train est sa rame entière plus son trajet. Dans les essais de circulation, toujours un cas où un train attend à l'arrêt, et un cas sur les données réelles (rails de 60 m), pas seulement sur le tracé d'essai fait d'un seul long rail.

## 2026-10-11 — Fenêtre du bac à sable : un message qui clignote, c'est un effet relancé à chaque rendu

- **Correction reçue** : gare choisie sans toucher à la composition, le message « la rame tient sur N voies » apparaissait et disparaissait sans fin.
- **Cause** : l'effet qui lance la vérification dépendait de la composition, et la composition par défaut (`defaultRakeOption`) était un objet neuf à chaque rendu : l'effet repartait, effaçait le message, le réécrivait, et ainsi de suite (233 changements de la fenêtre en 3 s). Mon contrôle au navigateur lisait le message une fois affiché, jamais sa tenue dans le temps, et toujours après avoir cliqué une composition — le seul cas où l'objet était stable.
- **Règle** : une valeur calculée qui sert de dépendance à un effet passe par `useMemo` (ou l'effet dépend de son identifiant). Au contrôle d'une fenêtre : essayer le chemin par défaut, sans rien choisir, et compter les changements du DOM pendant quelques secondes sans y toucher (zéro attendu).

## 2026-10-22 — Un comportement surprenant n'est pas forcément un défaut
- Motif : en revue CEO, j'ai qualifié de défaut « ouvrir un fichier garde l'historique d'annulation » sans lire le commentaire de `loadOsmImport` (`osmProject.ts`), qui le décrivait comme voulu, ni les tests qui le vérifiaient.
- Règle : avant d'écrire « défaut » dans une revue, chercher le commentaire de doc de la fonction et un test qui fige le comportement (`grep` du nom de fonction dans `*.test.ts`). S'il en existe, présenter un changement de contrat, pas un bug.

## 2026-10-22 — `rm` est interactif dans ce shell
- Motif : un `rm fichier` dans une commande composée a attendu une confirmation et bloqué la commande jusqu'au délai.
- Règle : toujours `rm -f` dans les scripts et commandes (voir la mémoire « Shell zsh pitfalls »).
