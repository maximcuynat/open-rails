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
- [x] `Segment.running?: 'forward' | 'backward'` (sens normal, de `from` vers `to` ou l'inverse)
- [x] Sauvegarde, découpe, fusion de projets ; `replaceRail` le reporte sur les rails coupés ou
      fusionnés (retourné quand le rail l'est) ; `touchNetwork(net, id)` à chaque changement ; oracle
- [x] Import OSM : `railway:preferred_direction` de la voie au milieu de chaque rail
      (`osmImport.ts`, à côté de `wayOfRail`), `both` ou absent : pas de sens

### S2 — Repli « garder la gauche »
- [x] Rail sans sens et voie parallèle à l'entraxe : le sens normal laisse l'autre voie à droite
      (gauche de (hx, hy) = (hy, −hx), y vers le bas) ; pas sur voie unique ni dans les gares à
      plus de deux voies ; une option pour la circulation à droite (Alsace-Moselle) plus tard

### S3 — Coût dans la recherche
- [x] `runningToll(net)` (proportionnel à la longueur parcourue à contre-sens, pas un forfait),
      ajouté au péage de `refreshRouteGuide` ; hors de `standsInTheWay` (qui lit `toll > 0` comme
      « un train gêne ») ; aussi pour les recherches sans péage de `routeGuide.ts` et `onwardStops`
- [x] Un coût, pas une interdiction : un train retenu peut encore passer à contre-sens

### S4 — Départ en gare
- [x] `createRakeAtStation` / `bestRakeAt` : préférer l'arrêt et le sens qui parcourent la voie à
      quai dans son sens normal, avant « le plus de voie devant » (tient compte des repères de Q4)

### S5 — Jeu de données
- [x] Générateur : rails avec leur sens ; `node tools/lgv-dataset/run.mjs --dry` (depuis le cache),
      puis régénération de `public/data/lgv/` ; vérifier Aix TGV → Avignon TGV à gauche
      (`tools/perf/` : un essai de trajet comme `explore-ligne-des-alpes.test.ts`)

### S6 — Option
- [x] Contre-sens dit au pupitre (IPCS)

### S7 — Pose vers la destination (`plan-pose-destination.md`)
- [x] La pose en gare reçoit la prochaine gare (ou les portes vers sa ligne) et prend la voie à quai et
      le sens d'où le chemin part dans le sens normal ; bac à sable : destination facultative

## Revue

Fait le 2026-10-19 (branche `sens-circulation`, depuis `feature/quais` 55654e2).

- **S1** : `Segment.running` (`types.ts`), outils dans `models/running.ts` (`setRunning`, `runsAgainst`,
  `runningCarriesOn`, `remapRunning`). `RailReplacement.running` est rempli par `splitReplacement`,
  `mergeReplacements`, `duplicateReplacement` et par les rails longs ; `replaceRail` le donne aux morceaux
  qui n'en ont pas (retourné quand le morceau est posé dans l'autre sens ; à la fusion de deux rails, le
  premier l'emporte). Les rails longs gardent un nœud là où le sens change. Empreinte de l'oracle
  (`networkWatch`) et suivi (`networkFollower`) ; sauvegarde (`SerializedSegment.running`, valeur
  inconnue ignorée), découpe et fusion de projets par recopie (à la fusion, sur un rail en double, le
  projet courant l'emporte). Import : `railway:preferred_direction` de la voie au milieu de chaque rail
  posé, avant toute découpe.
- **S2** : `inferKeepLeft` (`services/runningDirection.ts`), lancé à l'import par défaut
  (`OsmImportOptions.keepLeft`, donc dans l'application comme dans le générateur ; pas de case à cocher
  dans la fenêtre d'import). Un échantillon tous les 50 m : exactement une voie parallèle (moins de 6°)
  à 2,5 – 7,5 m, aucune autre à moins de 12 m ; 60 % des échantillons la voient, 90 % du même côté. Une
  double voie de moins de 2,5 km entre deux voies uniques est un évitement : pas de sens (sinon le train
  seul passerait dans chaque évitement, cf. `crossingRules.ts`). Les voies `both` ne sont pas touchées.
- **S3** : `runningToll(net, reversed)` : longueur du rail entré à contre-sens × `RUNNING_TOLL_PER_M` (1 :
  un mètre à contre-sens compte double) ; le rail de départ ne paie pas, celui de l'arrivée paie entier.
  Ajouté dans `findRouteGuide` (donc pour tous ses appelants) à la place de `refreshRouteGuide`, aux
  recherches sans péage, et à rebours pour le retour d'`onwardStops`. `standsInTheWay` n'y touche pas.
- **S4** : `placeRank` : une issue (300 m de voie devant ; l'examen s'arrête aux premières aiguilles,
  souvent avant 700 m, d'où ce seuil plutôt que `DEPARTURE_REACH`), puis le sens normal, puis la voie
  devant. La pose ne connaît pas la destination : elle choisit le sens normal, pas le bon côté.
- **S5** : le générateur envoie un User-Agent (`open-rails-dataset (github.com/maximcuynat/open-rails)`),
  rapporte les sens et confronte la règle aux étiquettes (`checkKeepLeft`). Essai à blanc puis
  régénération : 6 914 km de voie avec un sens par étiquette, 74 km par la règle, 930 km sans ; la
  règle dit comme l'étiquette sur 5 846 km et l'inverse sur 41 km (99,3 %). Quais : 7 376 lus, 418
  posés (98 centraux) ; 23 gares sur 200 sans quai. Fichiers : 16,38 Mio contre 15,5 (+5 %).
- **Aix-en-Provence TGV → Avignon TGV** (`tools/perf/explore-aix-avignon.test.ts`) : avant, posé voie 3 vers
  le nord, 38,2 km sur la voie de droite ; après, posé voie 4 dans le sens normal, 70,3 km sur la voie de
  gauche, 0 sur celle de droite, 0 m à contre-sens, arrivé en 1 304 s.
- **S6** : `ConsoleState.wrongTrack` (validé dans `protocol.ts`), « Contre-sens » sous la vitesse sur les
  trois pupitres et le téléphone (`SpeedCaption`).
- Reste : ~~circulation à droite (Alsace-Moselle)~~ (fait, ci-dessous) ; ~~donner la destination à la pose en gare~~ (fait : S7).

### Alsace-Moselle (2026-10-19, branche `dataset-metro`)

- [x] Garder la droite sur le réseau classique des départements 57, 67 et 68 ; les LGV y gardent la gauche
- [x] Les métros gardent la droite (Paris, Lyon, Marseille, Lille, apportés par le lot V4 de `plan-vue-reseau.md`)

**Approche.** OSM n'a pas d'étiquette du côté de circulation, et le pays (relation) ne dit rien
des départements : un polygone grossier des trois départements en (lat, lon)
(`services/rightHandRunning.ts`, `ALSACE_MOSELLE`, à environ 2 km des limites), projeté une fois dans
le repère de l'import (`rightHandArea(project)`, local comme Lambert-93) ; le milieu du rail y est
testé. `keepLeftDecisions` / `inferKeepLeft` prennent `keepsRight(seg)` : l'autre voie est alors
laissée à gauche. À l'import : vrai pour un rail de métro, et pour un rail dont la voie n'est pas à
grande vitesse (`highspeed=yes` ou TVM) au milieu duquel le polygone répond oui. La même règle sert
au contrôle contre les étiquettes (`checkKeepLeft`). Le rapport compte `rightHandKm`.

**Tests.** Villes dedans (Metz, Thionville, Forbach, Sarreguemines, Sarrebourg, Strasbourg, Haguenau,
Sélestat, Colmar, Mulhouse) et dehors (Nancy, Lunéville, Saint-Dié, Épinal, Belfort, Longwy,
Luxembourg, Sarrebruck, Kehl, Bâle, Paris) ; double voie classique vers 48,5° N 7,5° E à droite, LGV
au même endroit à gauche ; double voie de métro à droite.

**Jeu de données.** 391 km de voie reçoivent leur sens par la règle, dont 317 en gardant la droite
(les métros pour l'essentiel) ; en Alsace-Moselle le jeu n'a que 248 km de voie ferrée (la LGV Est
et ses raccordements), tous déjà orientés par étiquette ou par la règle. Écart de la règle aux
étiquettes : 42,1 km sur 5 907 (avant le métro : 41 km).

**Reste.** Les points de changement de côté (sauts-de-mouton de Lunéville, Montreux-Vieux…) tombent
près des limites, où le polygone est approximatif ; le jeu n'a pas encore de lignes classiques
d'Alsace pour l'éprouver en circulation.
