# État des lieux du code avant l'import OpenStreetMap

Relevé du 2026-10-06 sur `feature/osm-import` (HEAD `084f722`). Lecture seule, aucun test lancé : les coûts viennent du code et des documents du dépôt. Version condensée du rapport d'exploration ; les numéros de ligne datent du relevé.

## Découverte principale : un import existe déjà, hors de l'application

`tools/osm-import/osm_to_project.py` (Python, `osmnx` + `networkx`) télécharge `railway=rail` autour d'un point et écrit un projet. Son résultat est l'exemple `src/examples/marseille-saint-charles.json` : 1 441 nœuds, 1 503 rails, 140 zones de vitesse, aucun niveau, aucun signal. Toute sa logique est à porter en TypeScript si l'import doit tourner dans le navigateur :

- projection azimutale équidistante centrée, puis `y = −y` (x à l'est, **y au sud**) ;
- seule la plus grande composante connexe est gardée ;
- `chains()` : suites de nœuds entre deux nœuds de degré ≠ 2 (une boucle fermée sans aiguille est ignorée) ;
- `thin()` : retire les points à moins de 10 m du précédent (30 m autour d'une traversée-jonction) ;
- `tangents()` : tangente en chaque point (cercle par trois points, ou direction d'un long alignement) ;
- `lay()` : droite si l'angle corde / tangente est sous 0,15° ; un arc si les deux angles sont opposés et comparables ; sinon deux courbes tangentes avec un nœud intermédiaire ;
- `find_double_slips()` : nœud `railway=switch` à quatre voies, rails ramenés tangents à un axe commun ;
- `untangle()` : redresse deux départs d'un même nœud qui se croiseraient ;
- `maxspeed` → zones arrondies à 10 km/h, un tronçon `0 → 1` par rail ; vitesse de ligne = vitesse maximale lue ;
- non lus : signaux, quais, hauteurs.

Limites connues (`tasks/plan-exemples.md`) : 27 courbes sur 1 255 sous 100 m de rayon, presque toutes autour des traversées-jonctions ; 2 nœuds à quatre voies non reconnus.

## Ce qui décide de la conception

1. **La réconciliation applique au plus 40 corrections par appel** (`reconcile.ts:309`) et coûte O(rails²) par passe. Elle tourne à chaque chargement et à **chaque undo / redo**. Il faut livrer un réseau déjà propre : l'objectif est le test des exemples « nothing to weld, cut or drop ».
2. **Un pont sans niveau devient un croisement à niveau**, à chaque chargement. Les hauteurs se posent sur les nœuds (`RailNode.level`), **avant** la première réconciliation. Deux voies ne se rencontrent que si leurs hauteurs au point de croisement diffèrent de moins de 0,5 niveau.
3. **Un angle de plus de 15° à un nœud est une fin de voie** pour les trains et pour la recherche de chemin. L'angle se mesure sur la tangente au nœud. Une aiguille à trois voies est reconnue toute seule si ses deux branches partent à 15° au plus du prolongement du tronc ; une traversée-jonction seulement si ses quatre rails sont tangents à un axe commun.
4. **Compteur d'identifiants global** : ne jamais utiliser un identifiant OSM comme identifiant de nœud (un suffixe `_123456789` propulserait le compteur).
5. **Sauvegarde automatique et annulation par instantané complet** : `localStorage` (environ 5 Mo) reçoit tout le projet à chaque édition ; l'échec de quota est silencieux.

## Autres faits utiles

- Une courbe est une Bézier quadratique `from → via → to`. Briques pour poser des arcs : `tangentArcPieces`, `viaFromTwoTangents`, `viaFromArc`, `splitCurveIntoArcPieces`, `addCurveChain` (`geometry/curve.ts`, `geometry/tangent.ts`, `models/network.ts`). `circleArcPieces` est privée. Rien en TypeScript ne convertit une suite de points en droites et en arcs.
- Une Bézier dissymétrique (jambes différentes de plus de 1 %) est prise à son rayon le plus serré pour la vitesse : viser des arcs symétriques, 15° au plus par morceau.
- Aucune fonction du domaine ne refuse un rail court ; deux nœuds à 0,10 m sont soudés ; un signal est refusé à moins de 2 m d'une aiguille.
- Zones : `addSpeedZone(net, spans, speed)` avec les rails d'un tronçon suffit (pas de recherche de chemin). Les zones valent dans les deux sens : `maxspeed:forward` / `backward` n'a pas d'équivalent.
- Signaux : `addSignal(net, { segId, t }, forward, role, { cabMarker, oneWay, gauge })` ; `forward` = sens `from → to` du rail. Construire chaque chaîne dans le sens du `way` OSM simplifie le sens des signaux.
- Chargement : `store.loadFromData(projet)` est le seul chemin qui règle store, historique et sauvegarde ; un import est annulable.
- Menu : `TopBar.tsx`, menu « Fichier », à côté de « Importer JSON… » et du sous-menu « Exemples ». `Modal.tsx` ferme tout de suite après `onConfirm` : inadaptée telle quelle à un traitement asynchrone (mettre ses propres boutons). Cases à cocher : style `settings-checkbox-row` de `SettingsModal.tsx`.
- Aucun appel vers un domaine tiers aujourd'hui, aucune politique de sécurité de contenu : un appel à Overpass ne dépend que du CORS du serveur. Mention ODbL déjà présente dans `AboutModal.tsx` pour les exemples.
- Aucun champ de provenance ni d'origine géographique dans le projet. Un champ de projet doit suivre toute la chaîne (`serializeNetwork`, `deserializeNetwork`, `loadFromData`, `loadPersistedState`, `exportProject`, `savePersistedState`, `pushHistorySnapshot`, `undo`, `redo`), sinon un undo l'efface.
- Tests : fichiers d'essai lus par `readFileSync(fileURLToPath(new URL('./x.json', import.meta.url)))` ; `src/examples/examples.test.ts` est le modèle de ce qu'un réseau importé doit passer (lu comme il est écrit, aucun défaut cinématique, conduite simulée).

## Taille de réseau

| Taille | État |
|---|---|
| 1 500 à 2 000 rails (une grande gare et son avant-gare) | seul ordre de grandeur couvert de bout en bout (Marseille) |
| 4 000 rails | simulation et signalisation testées ; chargement et undo de l'ordre de la demi-seconde (estimation) |
| 13 500 rails | seul le rendu est mesuré ; chargement, undo et pose en secondes, sauvegarde automatique au-delà du quota (estimation) |

Leviers côté import : limiter l'emprise, allonger les rails (droits fusionnés, arcs jusqu'à 15°), écarter les voies de service par une case, afficher le nombre de rails prévu avant de confirmer. Une autre session travaille sur les grands réseaux (`feature/grands-reseaux`).

## Chemin recommandé

Conversion pure dans `src/domain/import/` (sans DOM ni réseau, testable en Node), appel réseau dans `src/infrastructure/osm/`, fenêtre dans `src/presentation/components/topbar/`. Construire par les fonctions du domaine dans un réseau neuf — nœuds avec leurs niveaux, rails chaîne par chaîne dans le sens du `way`, une réconciliation qui doit ne rien trouver, zones, signaux, contrôles (`analyzeKinematics`, `signalReport`) pour le bilan — puis `serializeNetwork` et `store.loadFromData`.
