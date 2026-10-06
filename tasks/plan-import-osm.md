# Plan — Import de réseaux réels depuis OpenStreetMap

Worktree `/home/mcuynat/github/open-rails-import`, branche `feature/osm-import` (partie de `developement`). Ouvert le 2026-10-06. Pas de commit tant que l'utilisateur ne le demande pas.

État : **en préparation**. La recherche (`tasks/recherche-import-osm.md`, échantillons dans `tasks/import-osm-echantillons/`) et l'état des lieux du code sont en cours ; les étapes seront écrites à leur retour.

## Décisions de l'utilisateur (2026-10-06)

1. **L'import ne dépend pas du niveau de signalisation.** Le moteur stocke un seul type de signal, relu en standard ou en pro : on importe toujours les données réelles, le niveau ne change que l'affichage et les règles.
2. **Fenêtre d'import avec des cases à cocher** : quoi importer (voies, ponts et tunnels, limites de vitesse, signaux réels, voies de service, voies désaffectées), quoi faire quand les données manquent (signalisation automatique), et le niveau du projet (standard ou pro).
3. **Priorité : savoir quelle voie passe au-dessus ou au-dessous de quelle autre**, pont ou tunnel. Exemple de référence : de la gare de Lyon à Paris jusqu'à la sortie de Paris.
4. **« Niveaux sans relief »** (validé) : un réglage du projet, activé par l'import. Les étages (0 au sol, +1 sur un pont, −1 en tunnel, −2 plus profond…) servent seulement à l'empilement — qui passe au-dessus de qui, dessin du pont ou du tunnel, pas de croisement entre deux étages. La pente vaut zéro partout : ni force de pente dans la physique, ni alerte « pente trop forte ».
5. **La topologie réelle des pentes est hors périmètre** : elle viendra dans une version ultérieure, où il suffira de désactiver ce réglage.

## Propositions en attente de la recherche

- Par défaut : niveau standard avec signalisation automatique cochée ; niveau pro avec les signaux réels tels qu'ils sont et le rapport de contrôle pour ce qui manque.
- Garder la trace de l'origine de ce qui est importé (identifiant OpenStreetMap), pour qu'un nouvel import n'écrase pas les corrections faites à la main.
- Bilan après l'import : ce qui a été trouvé, ce qui manque, les croisements dont l'étage n'a pas pu être décidé.
- Mention d'attribution OpenStreetMap dans tout projet qui contient des données importées.

## Où on en est (pour reprendre après une coupure)

Mis à jour le 2026-10-06.

- **État des lieux du code** : fait, voir `tasks/audit-import-osm.md`. Un import existe déjà hors de l'application : `tools/osm-import/osm_to_project.py` (Python), qui a produit l'exemple de Marseille, sans niveaux ni signaux. Le plan est de le porter en TypeScript dans l'application, d'y ajouter les niveaux, la fenêtre d'import, puis les signaux.
- **Recherche sur les données OpenStreetMap** : en cours (un agent). Elle écrira `tasks/recherche-import-osm.md` et quatre échantillons Overpass dans `tasks/import-osm-echantillons/` (grande gare, ligne TER à voie unique, LGV, gare de Lyon → sortie de Paris). Chiffre attendu : la part des croisements sans nœud commun dont l'étage est décidable.
- **Étapes du plan** : à écrire au retour de la recherche, puis lancer le code (agents), dans l'ordre : portage de la conversion, niveaux et réglage « niveaux sans relief », fenêtre d'import, signaux.

## Résultat de la recherche (2026-10-06)

Rapport complet : `tasks/recherche-import-osm.md`. Ce qui décide du plan :

- **Niveaux** : sur les quatre zones, 162 croisements voie × voie sans nœud commun, 162 tranchés par `bridge` / `tunnel` / `layer` (157 à Paris). Tous les ponts portent leur `layer`. Les 9 cas indécidables sont des tunnels de métro au même `layer`.
- **Règle** : `layer` entier s'il existe ; sinon pont = +1, tunnel = −1 (sauf `building_passage`) ; sinon 0. `layer` est local : il ne donne ni altitude ni pente.
- **Signaux réels** : utilisables à Paris (161 signaux principaux typés sur la zone), presque absents ailleurs (Dijon 0, LGV 0). Deux jeux de valeurs coexistent (`FR:CARRE` / `FR:C`…). Sans signalisation automatique, un réseau importé hors Île-de-France n'a pas de signaux.
- **Overpass** : appel direct possible depuis le navigateur, mais la moitié des requêtes ont échoué (504, 429). Il faut plusieurs serveurs, une nouvelle tentative, et l'import depuis un fichier.
- **Échantillons** : les quatre JSON contiennent chaque nœud deux fois (avec et sans attributs) ; garder la version qui a des `tags`.
- **Incident** : la première requête de l'agent de recherche portait l'adresse e-mail de l'utilisateur dans l'en-tête `User-Agent`, envoyée à trois serveurs Overpass. Signalé à l'utilisateur. Règle : aucun identifiant personnel dans une requête.

## Étapes

Branche avancée sur `developement` (`de82ca9`) avant de coder. Contrat partagé : `src/domain/import/osmTypes.ts` et les deux fonctions de `src/domain/import/osmImport.ts`.

### Lot 1 — voies, niveaux, fenêtre (trois agents, fichiers disjoints)

- [x] **A. Conversion** (`src/domain/import/`) : lecture de la réponse Overpass (doublons de nœuds), projection, filtre par options, portage de `chains` / `thin` / `tangents` / `lay` / `find_double_slips` / `untangle` du script Python, niveaux sur les nœuds, contrôle de chaque croisement sans nœud commun, zones de vitesse, bilan. Preuve : les quatre échantillons convertis, réconciliation qui ne trouve rien, aucun croisement à niveau créé là où OSM donne deux niveaux.
- [x] **B. Réglages du projet** (fait le 2026-10-06 : `store.gradientLimits` rend une hauteur de niveau nulle quand `flatLevels` est actif ; 2032 tests, typecheck et build verts ; pas encore vu dans le navigateur) : `flatLevels` (« niveaux sans relief » : pente nulle dans la physique, pas d'alerte de pente) et `osmSource` (provenance), suivis sur toute la chaîne de sauvegarde et d'annulation ; case dans les réglages.
- [x] **C. Fenêtre d'import** (fait le 2026-10-06) : choix de la zone (recherche d'un lieu, coordonnées ou lien OpenStreetMap, rayon), ou fichier ; téléchargement Overpass avec serveurs de secours ; décompte avant confirmation ; cases à cocher ; bilan après l'import ; mention OpenStreetMap sur le plan, dans « À propos » et dans les exports.
- [x] Vérification d'ensemble (2026-10-06) : 2228 tests, typecheck et build verts ; Paris importé dans le navigateur par fichier (7 075 rails, 156 croisements superposés, 0 indécis, 2,9 s, 3,1 Mo en sauvegarde automatique, undo / redo) ; une requête Overpass réelle réussie depuis la page (Clelles, 400 m). Par défaut l'import garde aussi les réseaux non raccordés (`keepDetachedOverKm: 0`), sinon Austerlitz disparaissait.
- [ ] Reste du lot 1 : case des réglages « niveaux sans relief » et conduite d'un train sur un réseau importé non vues à l'écran ; recherche de lieu (Nominatim) jamais appelée en vrai ; rails courbes de rayon < 150 m (330 sur 3 071 à Paris) à mesurer en conduite ; conversion à sortir du chunk principal.

### Lot 2 — signaux

- [x] Signalisation automatique après import (fait le 2026-10-06). `services/signalLayout.ts` ne contient pas de placement sur un réseau entier (seulement l'outil « rangée » et le recul hors des aiguillages) : le placement est un service voisin, `services/signalAutoLayout.ts`, qui pose par les mêmes fonctions du moteur (`addSignal`, `addSignalPair`). Règle : par portion de voie courante (d'un appareil ou d'une fin de voie au suivant), dans les deux sens — rien sous 100 m ; un signal de protection 30 m avant chaque appareil ; entre les deux, des paires de signaux d'espacement qui découpent en cantons égaux d'au moins la distance d'arrêt et 1 500 m, sans dépasser 2 380 m ; repères de LGV tous les 1 500 m sur les voies à grande vitesse.
- [x] Signaux réels (fait le 2026-10-06) : table de synonymes `domain/import/osmSignalTable.ts`, lecture et pose `osmSignals.ts`. Carré, guidon d'arrêt, sémaphore qui peut présenter le carré ou porte la plaque Nf → protection ; sémaphore → espacement ; repères de LGV (`FR:marker` + `stop_marker`, anciens `FR:REP_TVM`…) → `cabMarker` ; carré violet, annonces, tableaux de vitesse laissés de côté et comptés. Paris : 125 posés sur 126 lisibles (106 protection, 19 espacement). Fenêtre : deux cases (signalisation automatique, signaux réels avec leur nombre) qui donnent aucune / automatique / réels / mixte, et le niveau du projet ; passer en pro propose les signaux réels seuls tant qu'aucune case n'a été touchée. Mixte : une portion de voie courante qui porte un signal réel ne reçoit aucun signal généré.
- [x] Fenêtre d'import chargée à la demande : le chunk `App` passe de 588,7 à 527,4 ko (gzip 175,9 → 153,1), la fenêtre et la conversion font 80,8 ko à part.
- [ ] Reste du lot 2 : sens de circulation des voies (`railway:preferred_direction`, présent sur 430 des 1 192 voies de Paris) non lu — la signalisation automatique équipe tout dans les deux sens ; le rapport de contrôle juge « trop courts » les cantons de 1 500 m des repères de LGV (il ne connaît pas la signalisation de cabine) ; à Dijon, tout train qui entre finit devant un aiguillage pris en talon mal orienté (positions par défaut), le signal de protection reste fermé tant qu'on ne le manœuvre pas.

### Lot 3 — plus tard

- Provenance par voie (identifiant OSM) pour un nouvel import qui n'écrase pas les retouches.
- Pentes réelles (désactiver « niveaux sans relief »).
- Sort du script Python `tools/osm-import/` : à décider à la résolution (une seule logique de conversion).

## Autres sessions à prendre en compte

- Une session de l'utilisateur nommée « Import Railway » travaille en parallèle sur la signalisation et l'import (c'est probablement elle qui a écrit le script Python et les exemples : commits `65bb2f5`, `60785b6`, et un correctif de signalisation `3d4da97`). L'utilisateur ne sait pas précisément ce qu'elle fait.
- D'autres worktrees avancent : `feature/grands-reseaux` (fusionné dans `developement` le 2026-10-06), `feature/perf-navigateur`, `fix/example-loop-and-traction`.
- `developement` a avancé depuis la création de ce worktree (`084f722` → `8bb1407` au moins).

**Résolution demandée par l'utilisateur** : une fois ce chantier et celui des affichages (`/home/mcuynat/github/open-rails-affichages`, branche `feature/signalling-display`) terminés, fusionner `developement` dans chacune des deux branches, résoudre les conflits avec le travail des autres sessions (import et signalisation en particulier), relancer tests, typecheck et build, et vérifier qu'aucune fonction n'existe en double (import Python contre import intégré, exemples).


## État au 2026-10-06, après le lot 2

- **Lots 1 et 2 faits, non commités** : 127 fichiers de tests, 2309 tests passés, typecheck et build verts (relancés après les deux derniers agents).
- **Courbes** : les coudes de 40 à 65 m que l'ajustement posait en pleine voie sont corrigés (rails où la géométrie permet moins que la zone : Clelles 52 → 11, LGV 40 → 0, Dijon 81 → 26, Paris 209 → 78). Ce qui reste vient des données ou des règles de dévers de l'application.
- **Conduite** (store, conducteur qui connaît son itinéraire) : LGV 17,7 km à 298 km/h, Clelles bord à bord, Dijon 8 km, Paris 4,7 à 6,9 km du heurtoir au bord, sans incident, pente nulle partout.
- **Annonce de la prochaine limite corrigée** (`trackSpeed.ts`, `walkAhead`) : elle s'arrêtait à la première limite plus basse et masquait celle qui impose de freiner ; elle annonce maintenant celle qu'il faut freiner en premier (marge 1,5 sur la distance de freinage). Dijon conduit au pupitre sur 4 km sans incident ; 128 fichiers, 2312 tests, typecheck et build verts.
- **À faire après la résolution avec la branche des affichages** : lisibilité du plan d'une gare importée (bandes de zones de vitesse, étiquettes de section et libellés du rapport se recouvrent) ; champs désactivés des réglages non grisés.
- **Limites connues** : aiguilles importées en position par défaut (il faut les manœuvrer pour traverser une gare) ; sens de circulation des voies non lu ; rapport de contrôle qui juge trop courts les cantons de repères de LGV ; traversées-jonctions qui plient l'itinéraire direct (14 rails lents à Paris).
