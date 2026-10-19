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

- [ ] Trouver la borne (échelle minimale de la caméra) ; une borne par projet : un projet de jeu
      de données recule jusqu'à voir tout l'index.
- [ ] Tests : `openWholeNetwork` cadre tout l'index dans la fenêtre ; les autres projets gardent
      leur borne.
- [ ] Vue d'ensemble, mini-carte, grille corrects et rapides à ce zoom.
- [ ] Navigateur (Playwright, port 8908) : « Explorer le réseau France », capture, aucune erreur.

## Revue
