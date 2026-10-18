# Plan — Vue « Réseau France », chargement à l'approche, souterrain

Demandé le 2026-10-19. Décisions de l'utilisateur :
- **Vue France** : un projet « Réseau France » à part, verrouillé, sans ligne chargée au départ :
  tout le réseau du jeu de données en tracé simplifié, les morceaux chargés à l'approche d'une
  ligne, en édition comme en jeu.
- **Régions** : aucune nouvelle pour l'instant (LGV + PACA) ; le mécanisme d'abord.
- **Métro** : oui, catégorie à part dans le jeu de données (`railway=subway`), type de rail gardé
  sur le réseau. Après le chantier du sens de circulation (même générateur), avec sa régénération.
- **Souterrain** : un bouton surface / souterrain, et le passage automatique quand le train conduit
  entre en tunnel ou en sort.

## État des lieux (exploration du 2026-10-19)

- `renderDatasetOverview` (`datasetOverview.ts`) dessine les lignes non chargées de l'index, à
  tous les zooms, seulement dans un projet de jeu de données (`store.dataset`).
- Les morceaux ne se chargent qu'en jeu, train en marche (`checkDatasetLines` depuis
  `tickAllTrains`), par les portes du graphe des lignes ; la caméra de la vue libre ne fait que retenir.
- `addDatasetLines` / `removeDatasetLines` refont l'union de tout ce qui est chargé et la relisent :
  le coût croît avec tout le chargé (217 ms au pire mesuré). Pas de plafond, pas de cache des fichiers.
- `readRecipe` refuse une recette sans ligne ; `removeDatasetLines` garde toujours le dernier fichier.
- Souterrain : niveaux négatifs des nœuds ; tout ce qui est sous le sol est estompé en dur
  (`TUNNEL_ALPHA = 0.4`, pointillés ; véhicules 0.35) en une douzaine d'endroits
  (`renderer.ts`, `lodTracks.ts`, `signalRender.ts`, `Canvas.tsx`, `exportSvg.ts`). Pas de notion
  de « où est l'utilisateur ».

## Lots

### V1 — Projet « Réseau France »
- [ ] Recette sans ligne acceptée (`readRecipe`), projet vide verrouillé avec l'index et sa vue
      d'ensemble ; entrée « Fichier ▸ Réseau France » (et au lancement à côté du bac à sable)
- [ ] Sauvegardé en recette, rouvert au rechargement avec ce qui était chargé

### V2 — Chargement et déchargement à l'approche, dans tous les modes
- [ ] Vérification périodique hors `tickAllTrains` (mouvements de caméra, temporisée) : charger
      les morceaux dont la boîte touche la vue (plus une marge) à partir du palier « rails » ;
      décharger loin de la vue et des trains (`linesToDrop`) ; plus de « dernier fichier » gardé
- [ ] Plafond de morceaux chargés (le plus ancien vu d'abord), cache des fichiers déjà lus
- [ ] Ajout et retrait **incrémentaux** : lire le seul morceau ajouté, retirer le seul morceau
      parti, au lieu de relire l'union ; mesurer (`tools/perf/measure-driving.cjs`, et un essai
      de balayage de carte)
- [ ] Les gares de la vue d'ensemble seulement à partir d'un certain zoom

### V3 — Surface / souterrain
- [ ] `store.viewDepth: 'surface' | 'underground'` ; bouton dans l'interface (raccourci), passage
      automatique quand le train conduit change de côté du sol
- [ ] En surface : le souterrain à 15 % (au lieu de 40 %) ; dessous : le souterrain normal, la
      surface à 15 % ; un seul `levelAlpha(level, options)` au lieu des constantes en dur ;
      coût par passe de niveau, pas par rail
- [ ] Véhicules et signaux suivent la même règle ; export SVG inchangé

### V4 — Métro dans le jeu de données (après `plan-sens-circulation.md`)
- [ ] `railway=subway` demandé par le générateur, catégorie « Métro » (couleur, légende), type de
      rail gardé sur le réseau (`Segment.kind` ferroviaire : train / métro), sauvegardé
- [ ] Régénération (requêtes Overpass nouvelles, avec `User-Agent`)

## Revue

_(à remplir)_
