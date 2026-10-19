# Plan — Pose en gare vers la destination, recul jusqu'à la France entière

Demandé le 2026-10-19 (branche `pose-destination`, depuis `feature/quais` b3b6ae3).

## Tâche 1 — La pose de rame en gare connaît la destination

Constat : `placeRank` (`rakePlacement.ts`) range les arrêts par une issue, le sens normal
(`Segment.running`), la voie devant ; il ne sait pas où va le train : posé dans le sens normal,
il peut l'être dos au trajet (il repart de son autre cabine, sur la voie de droite).

- [x] Domaine : `createRakeAtStation(net, station, rake, others, heading?)` ; `RakeHeading` =
      gare visée (chargée) ou portes vers sa ligne (`gatesToward`), rails interdits.
      Pour chaque pose candidate : le chemin **devant** le train vers la gare (ses arrêts pour sa
      longueur) ou vers les portes, avec `runningToll` (`findWayAhead`, `routeGuide.ts`).
      Rang : une issue, puis un chemin devant, puis le moins de voie à contre-sens sur ce chemin
      (voie à quai comprise), puis le sens normal de la voie à quai, puis le chemin le plus court,
      puis la voie devant. Sans destination (ou aucun chemin) : le rang d'aujourd'hui.
- [x] Tests du domaine (petit réseau à double voie) : destination à l'est → voie nord vers l'est ;
      à l'ouest → voie sud vers l'ouest ; par les portes ; voie unique : face au chemin.
- [x] Application : `placeRakeAtStation(stationId, rake, toward?)` — le cap calculé comme le guide
      d'itinéraire (`gatesToward` factorisé avec `refreshRouteGuide`) ; `prepareSandbox` /
      `addSandboxTrain` prennent une destination facultative, la posent et l'ajoutent à l'itinéraire.
- [x] Fenêtre du bac à sable : champ « Destination (facultatif) ».
- [x] Mesure `tools/perf/explore-aix-avignon.test.ts` (0 km à droite) et sens inverse
      Avignon TGV → Aix-en-Provence TGV.

## Tâche 2 — « Réseau France » : reculer jusqu'à la France entière

- [x] Trouver la borne (échelle minimale de la caméra) ; une borne par projet : un projet de jeu
      de données recule jusqu'à voir tout l'index.
- [x] Tests : `openWholeNetwork` cadre tout l'index dans la fenêtre ; les autres projets gardent
      leur borne.
- [x] Vue d'ensemble, mini-carte, grille corrects et rapides à ce zoom.
- [x] Navigateur (Playwright, port 8908) : « Explorer le réseau France », capture, aucune erreur.

## Revue

Fait le 2026-10-19 (branche `pose-destination`).

**Tâche 1.** `RakeHeading` (`rakePlacement.ts`) : la gare visée quand elle est chargée, sinon les portes
vers sa ligne, et les rails interdits au train. `placeRank` cherche pour chaque pose candidate (les
deux cabines, chaque arrêt) le chemin **devant** le train (`findWayAhead`, `routeGuide.ts` : mêmes
buts que `findRouteGuide`, `runningToll` payé, pas de demi-tour) ; rang : une issue, un chemin devant,
le moins de voie à contre-sens sur ce chemin (par 10 m, voie à quai comprise), le sens normal de la
voie à quai, le chemin le plus court (par 100 m), la voie devant. Sans cap, ou si aucune pose n'a de
chemin, le rang reste celui d'avant (mêmes termes pour toutes). `store.placeRakeAtStation(id, rake,
toward?)` calcule le cap à partir de la rame posée sans cap (ce qu'elle peut emprunter, les lignes sous
elle) par `rakeHeadingToward` (`application/game/itinerary.ts`, qui partage `gatesTowardStation` avec
`refreshRouteGuide`), puis repose. `prepareSandbox` / `addSandboxTrain` : `options.destination`, posée
et ajoutée à l'itinéraire (`addItineraryStop`) ; un refus revient dans `SandboxStart.destinationRefused`
(avertissement à l'écran). Fenêtre du bac à sable : champ « Destination » facultatif sous la gare de
départ. Vérifié au navigateur : Avignon TGV → Aix TGV, posé voie 3 dans le sens normal, itinéraire
rempli, fenêtre immobile (0 changement du DOM en 2,5 s), aucune erreur.

Mesure (`PROFILE=1 npx vitest run tools/perf/explore-aix-avignon.test.ts --silent=false`, les deux sens,
destination connue ou non à la pose) :

| Trajet | Pose | Voie de droite | Contre-sens | Arrivée |
|---|---|---|---|---|
| Aix TGV → Avignon TGV, destination connue | voie 4, sens normal | 0,0 km | 0,0 km | 1 302 s |
| Avignon TGV → Aix TGV, destination connue | voie 3, sens normal | 0,0 km | 0,0 km | 1 101 s |
| Aix TGV → Avignon TGV, sans destination | voie 4, sens normal | 0,0 km | 0,0 km | 1 304 s |
| Avignon TGV → Aix TGV, sans destination | voie 4, dos au trajet | 17,8 km | 18,2 km | 1 463 s |

La pose avec cap coûte 41–47 ms (une recherche de chemin par pose candidate) contre 9 ms sans, une fois.
L'essai lisait la rame d'avant le changement de cabine (`switchTrainCab` remplace l'objet) : corrigé, il
relit le train du store (sans quoi le dernier cas semblait ne jamais partir).

**Tâche 2.** La borne était `clampScale` (`infrastructure/render/camera.ts`) : 0,002 px/m, 1 000 px
pour 500 km, alors que l'index fait 713 × 954 km. `clampScale(scale, min)` ; `MIN_CAMERA_SCALE` (0,002)
pour tout projet, `DATASET_MIN_CAMERA_SCALE` (0,0002 : la France dans 360 px) pour un projet de jeu de
données, par `store.minCameraScale` ; lu par `frameBox` (donc `openWholeNetwork`), l'ajustement à la
vue et la molette. La grille espace déjà ses lignes d'au moins 8 px (test : moins de 320 tracés à la
borne, pas de 5 m compris), l'échelle passe en km (test), la vue d'ensemble trace les mêmes contours
qu'à 0,002. Mini-carte : le clic de navigation lisait les nœuds chargés et non l'index que la carte
dessine (sur « Réseau France » vide, il centrait sur la caméra) : il lit maintenant le cadre de la carte
dessinée (`mapFrame`). Navigateur (port 8908, Playwright, 1 280 × 800) : « Explorer le réseau France »
cadre à 0,00072 px/m, l'index entier dans la vue ; molette jusqu'à 0,0002 ; image toutes les 16,7 ms
(médiane) à 0,0002, 0,002 et 0,02 px/m ; clic sur la mini-carte à 11 km de Marseille Saint-Charles
(un pixel de la carte vaut 9,5 km) ; aucune erreur.

**Reste.** La destination n'est connue qu'à la pose par le bac à sable : un arrêt ajouté ensuite par le
panneau d'itinéraire à un train qui n'a pas bougé ne le repose pas (il change seulement de cabine,
`faceTheWay`). En quittant un projet de jeu de données pour un autre, une caméra plus loin que 0,002 y
reste jusqu'au premier coup de molette (qui la ramène à la borne).
