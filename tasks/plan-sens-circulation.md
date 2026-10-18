# Plan — Sens normal de circulation (circulation à gauche)

Demandé le 2026-10-19 : un TGV d'Aix-en-Provence TGV vers Avignon TGV montait sur la voie de droite.
À lancer après la fusion de Q4 et Q5 (`plan-quais.md`), puis régénérer le jeu de données (accord donné).

## Constat (enquête du 2026-10-19)

- La recherche de chemin (`trackPath.ts`, `findTrackPathToAny`) ne compte que la distance ; ses
  seuls leviers sont `blocked` et `toll`. `crossingToll` ne coûte que les voies d'autres trains.
  Rien ne lit un sens normal : `SectionDirection` est un sens interdit lu par `findPath` seul,
  que personne n'appelle.
- Départ : `createRakeAtStation` prend, à voie devant égale, le premier arrêt de la gare. À Aix
  TGV c'est la voie 3 (est), la voie de droite vers le nord ; rester sur sa voie est ensuite
  toujours plus court qu'une communication, et l'aide complète manœuvre les aiguilles pour l'y garder.
- Les repères de LGV sont posés dans les deux sens sur chaque voie : un train à contre-sens a une
  signalisation de cabine normale, et la signalisation ne peut pas donner le sens normal.
- La donnée existe : `railway:preferred_direction` est dans le cache du générateur
  (`tools/lgv-dataset/cache/`). Entre Aix et Avignon, 259 voies sur 260 l'ont et 250 correspondent
  à la circulation à gauche (9 à vérifier : voies de gare ou de communication).
- Une règle « garder la gauche aux aiguilles » a déjà été essayée et laissée de côté sur voie unique
  (`crossingRules.ts`, en-tête) : elle faisait passer les trains dans chaque évitement. Une voie
  unique n'a pas de sens normal, elle ne paiera rien ici.

## Lots

### S1 — Donnée sur le rail
- [ ] `Segment.running?: 'forward' | 'backward'` (sens normal, de `from` vers `to` ou l'inverse)
- [ ] Sauvegarde, découpe, fusion de projets ; `replaceRail` le reporte sur les rails coupés ou
      fusionnés (retourné quand le rail l'est) ; `touchNetwork(net, id)` à chaque changement ; oracle
- [ ] Import OSM : `railway:preferred_direction` de la voie au milieu de chaque rail
      (`osmImport.ts`, à côté de `wayOfRail`), `both` ou absent : pas de sens

### S2 — Repli « garder la gauche »
- [ ] Rail sans sens et voie parallèle à l'entraxe : le sens normal laisse l'autre voie à droite
      (gauche de (hx, hy) = (hy, −hx), y vers le bas) ; pas sur voie unique ni dans les gares à
      plus de deux voies ; une option pour la circulation à droite (Alsace-Moselle) plus tard

### S3 — Coût dans la recherche
- [ ] `runningToll(net)` (proportionnel à la longueur parcourue à contre-sens, pas un forfait),
      ajouté au péage de `refreshRouteGuide` ; hors de `standsInTheWay` (qui lit `toll > 0` comme
      « un train gêne ») ; aussi pour les recherches sans péage de `routeGuide.ts` et `onwardStops`
- [ ] Un coût, pas une interdiction : un train retenu peut encore passer à contre-sens

### S4 — Départ en gare
- [ ] `createRakeAtStation` / `bestRakeAt` : préférer l'arrêt et le sens qui parcourent la voie à
      quai dans son sens normal, avant « le plus de voie devant » (tient compte des repères de Q4)

### S5 — Jeu de données
- [ ] Générateur : rails avec leur sens ; `node tools/lgv-dataset/run.mjs --dry` (depuis le cache),
      puis régénération de `public/data/lgv/` ; vérifier Aix TGV → Avignon TGV à gauche
      (`tools/perf/` : un essai de trajet comme `explore-ligne-des-alpes.test.ts`)

### S6 — Option
- [ ] Contre-sens dit au pupitre (IPCS)

## Revue

_(à remplir)_
