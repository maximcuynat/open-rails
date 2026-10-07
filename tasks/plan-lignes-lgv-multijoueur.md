# Lignes LGV entre gares et multijoueur conducteurs / aiguilleur — plan

Réflexion menée le 2026-10-07 (pas de code écrit). Objectif de la prochaine version : taper des
gares (Marseille Saint-Charles, Aix TGV, Avignon TGV, Lyon…), obtenir sur le canevas la ligne
à grande vitesse qui les relie, la conduire à plusieurs — des conducteurs sur téléphone, un
aiguilleur au PC — sans serveur à nous et sans à-coups.

## Contexte : ce qui existe déjà

- Import OSM complet dans l'appli (`src/domain/import/`, `src/infrastructure/osm/`,
  `OsmImportModal.tsx`) : Overpass avec trois serveurs de secours, fichier Overpass Turbo,
  recherche de lieu Nominatim, projection en mètres, aiguillages / TJD / croisements / niveaux /
  signaux, zones de vitesse, drapeau `highSpeed` (`highspeed=yes` ou `railway:tvm`).
- Rendu : index spatial (`SpatialGrid`, `NetworkFollower`), culling de la vue, quatre niveaux de
  détail (`lod.ts`), dérivés mis en cache par révision du réseau (`networkDerived`).
- Pupitre sur téléphone : contrat `ConsoleState` / `ConsoleCommand`, protocole validé
  (`protocol.ts`), hôte avec acquittements, battement de cœur et repli sur frein serré
  (`remoteHost.ts`), relais WebSocket Vite (`tools/remote-relay/`), abstraction `remoteLink`
  avec deux implémentations (WebSocket, faux lien de test).
- `npm run bench` mesure déjà une image, un survol et une édition sur 13 527 rails
  (122 000 avec `SCALE_COPIES=9`).

Ce qui manque :

- **Aucune gare** : ni `railway=station`, ni nom, ni quai n'est lu ; `station_stop` existe dans
  le domaine mais rien ne le remplit.
- **Repère non global** : la projection est centrée sur les données ; deux imports ne se
  superposent pas (Lambert-93 prévu au Lot C de `plan-grands-reseaux.md`, pas fait).
- **Zone d'import = disque de 15 km max** et l'import **remplace** le projet.
- **Un seul pupitre par salon**, relais seulement sous `npm run dev`, aucun état du monde
  (positions des autres trains) ne voyage.
- **Aucune mesure** au-delà des seuils d'alerte actuels (2 000 / 4 000 rails).

## Décisions de l'utilisateur (2026-10-07)

1. **LGV uniquement** dans un premier temps, **plus les raccordements** aux gares de centre-ville
   (Marseille Saint-Charles, Lyon Part-Dieu…) : la ligne part et arrive dans une vraie gare.
2. Ligne d'exemple de référence : **Marseille Saint-Charles → Aix-en-Provence TGV → Avignon TGV
   → Lyon**, aller et retour, à l'échelle 1.
3. Hébergement **100 % GitHub Pages** : pas de serveur à nous. Pour le multijoueur, **on essaie
   une mise en relation par un service public gratuit**.
4. Rôles : des **conducteurs** (pupitre, téléphone ou autre PC) et un **aiguilleur** au PC
   (schéma des aiguillages, position des trains, signaux). L'aiguilleur peut aussi **jouer seul**
   (conduire et aiguiller) : le mode solo actuel reste entier.
5. **Le réseau importé n'est pas modifiable** : pas de fusion import / retouches, pas d'édition à
   plusieurs.
6. Pas encore de mesure de ce qui casse entre 5 000 et 100 000 rails : **mesurer d'abord**.

Hypothèses prises faute de réponse (à confirmer) :

- Jusqu'à **8 conducteurs** par salon (amis dans la même pièce ou en ligne).
- Facteur d'**accélération du temps** réglable par l'hôte (Marseille–Lyon réel = 1h40).

## Constats qui orientent le plan

- **La France LGV entière est petite.** ~2 800 km de ligne, 5 600 km de voie. Mesuré au Lot 0
  sur l'échantillon de Pasilly : 4,9 rails par km de voie (205 m par rail), soit **~27 400 rails
  et 7 600 signaux pour toute la France**, et **~3 200 rails pour Marseille–Lyon** (600 km de
  voie). C'est le double de l'estimation initiale, mais toujours l'échelle du bench actuel
  (13 527 à 122 000). Le streaming par tuiles n'est **pas** justifié en première version ; la
  granularité « une ligne = un fichier » suffit.
- **Aix est ambigu** : Aix-en-Provence TGV (LGV Méditerranée, à Vitrolles) et Aix-centre (ligne
  classique) sont deux gares à 15 km. La recherche doit afficher les deux et laisser choisir.
- **Les terminus ne sont pas sur la LGV.** La LGV Méditerranée se raccorde au nord de Marseille
  et contourne Lyon par Saint-Exupéry ; Saint-Charles et Part-Dieu se rejoignent par quelques km
  de ligne classique. Le jeu de données doit contenir ces raccordements (décision 1).
- **Données pré-calculées plutôt qu'Overpass en direct.** Réseau en lecture seule + hébergement
  statique ⇒ générer une fois le réseau LGV France avec le pipeline existant, le publier en
  fichiers à côté de l'appli, régénérer par CI. Instantané, fiable, hors ligne ; Overpass reste
  pour l'import libre d'une zone.
- **Les trains sont faciles à mettre en réseau** : contraints à la voie, lents, prévisibles. On
  envoie (rail, position, vitesse, accélération) à 10 Hz et chaque client extrapole le long de la
  voie. 200 ms de latence sont invisibles. Pas de rollback.
- **Aiguillages, signaux, occupation des cantons exigent une autorité unique** : le PC hôte, qui
  simule déjà seul aujourd'hui. Topologie en étoile autour de lui.
- **Pas de multijoueur « zéro serveur »** : même sur un Wi-Fi commun, deux navigateurs doivent
  être mis en relation par un tiers. Le choix porte sur qui le fournit : service public gratuit
  (broker PeerJS, trackers / relais utilisés par des bibliothèques comme Trystero), ou relais
  hébergé par nous (Lot 3 de `plan-console-conduite.md`). WebRTC est natif au navigateur : pas
  de dépendance d'exécution pour le transport, seulement pour la mise en relation si on adopte
  une bibliothèque (à décider ; un client fait maison vers un broker public est possible).
- **Limite WebRTC à connaître** : derrière certains réseaux mobiles (NAT symétrique) la liaison
  directe échoue sans serveur TURN, qui coûte. Sur le même Wi-Fi ou en ADSL/fibre domestique ça
  passe avec un STUN public gratuit. Prévoir le repli : relais hébergé (étapes 21–24 du plan
  console) si l'essai public échoue trop souvent.

## Décisions de conception

- **Repère global** : tout réseau issu d'OSM est exprimé en Lambert-93 (EPSG:2154) avec une
  origine fixe, pour que toutes les lignes et toutes les gares se superposent. (Reprise du Lot C
  de `plan-grands-reseaux.md`, devient un prérequis.)
- **Gare = objet du domaine** : nom, code UIC, position, voies à quai (rails ou sections), et
  lien avec `station_stop`. Lue dans OSM (`railway=station`, `public_transport=station`,
  `uic_ref`, `name`) et croisée avec la liste des gares voyageurs SNCF (open data) pour les
  noms officiels.
- **Jeu de données « LGV France »** publié avec le site :
  - un **index** (quelques dizaines de ko, toujours chargé) : gares, bifurcations, lignes comme
    arêtes avec longueur, boîte englobante, nom (« LGV Méditerranée », « Raccordement de
    Marseille »…), date des données, mention ODbL ;
  - un **fichier de géométrie par ligne** (`SerializedProject` partiel, rails longs quand le
    Lot B les sait écrire, sinon rails actuels), de l'ordre du Mo ;
  - généré par un script Node (`tools/lgv-dataset/`) qui réutilise `domain/import/` tel quel sur
    l'extrait Geofabrik France filtré `railway=rail` + (`highspeed=yes` | `railway:tvm` |
    raccordement nommé) ; relancé par une action CI mensuelle ou manuelle.
- **Recherche de gare** : champ avec complétion sur l'index (hors ligne, instantané) ; Nominatim
  en secours pour une gare absente. Les homonymes (Aix-centre / Aix TGV) sont affichés avec leur
  type de ligne.
- **Itinéraire** : plus court chemin sur l'index (pas sur la géométrie), puis téléchargement des
  lignes traversées, assemblage en un réseau, `syncIdCounter`, cadrage de la vue. Aller-retour =
  deux sens sur la même double voie, rien de plus à charger.
- **Chargement / libération à la ligne** : une ligne hors de la vue et sans train dessus peut
  être retirée du réseau ; une ligne qu'un train va atteindre est chargée avant (anticipation
  sur l'itinéraire). Ensemble gardé = vue + marge ∪ voisinage de chaque train ∪ itinéraire à
  venir. Si un jour les lignes classiques décuplent le réseau, un découpage en tuiles s'ajoute
  **sous** le même index sans changer le reste.
- **Projet verrouillé** : un projet venu du jeu de données refuse les outils de modification du
  réseau (dessin, aiguillages, suppression, déplacement) mais accepte trains, conduite,
  réglages d'affichage. Ni provenance par way, ni fusion, ni CRDT.
- **Un projet verrouillé ne sauvegarde pas sa géométrie** (décision issue du Lot 0 : la France
  LGV pèse 9,5 Mio de JSON, le quota `localStorage` est de 5 Mio). L'autosave et l'historique
  d'annulation n'écrivent que la **recette** : identifiants des lignes, version du jeu de
  données, trains, caméra, réglages. Au rechargement, l'appli retélécharge les lignes. Pas
  d'IndexedDB, quelle que soit la taille du réseau.
- **Multijoueur en étoile** :
  - le PC hôte (aiguilleur) simule, détient aiguillages, signaux et cantons ; il peut aussi
    conduire (solo ou en plus des pupitres) ;
  - le salon passe de 1 à N pupitres, un train par pupitre, la flotte et l'état de console par
    train existent déjà ; `ConsoleCommand` porte déjà l'identifiant du train ;
  - nouveau message hôte → pupitres : **état du monde léger** à 10 Hz (par train : rail, `t`,
    vitesse, accélération ; aiguillages changés ; signaux changés), que le pupitre extrapole
    le long de la voie entre deux messages pour afficher les autres trains ;
  - transport : troisième implémentation de `remoteLink` en **WebRTC DataChannel** ; le
    protocole v1 ne change pas, seule la mise en relation (code de salon ↔ offre/réponse) est
    nouvelle ; le relais WebSocket local reste pour `npm run dev` ;
  - mise en relation : essai avec un service public gratuit ; code de salon long, salon
    rattaché à la page de l'hôte, limite de débit et de taille (déjà 32 Ko) ;
  - **le réseau ne voyage pas** : chaque pupitre connaît la ligne par l'identifiant de ligne et
    la date du jeu de données, et la télécharge lui-même depuis le site statique ; l'hôte
    refuse un pupitre dont la version diffère.
- **Vue aiguilleur** = le mode pilotage épuré du PC (Lot P de `plan-grands-reseaux.md`) plus un
  tableau de contrôle : schéma des aiguillages avec leur position, cantons occupés, signaux,
  trains et leur conducteur. Le niveau de détail `schematic` existant est le point de départ.
- **Temps** : facteur d'accélération réglable par l'hôte, diffusé aux pupitres (décision à
  confirmer).

## Lots (chacun livrable et mesuré seul)

### Lot 0 — Mesure (avant tout)
- [x] 1. Construire un réseau de l'ordre de 15 000 rails en géométrie LGV (duplication d'un
  échantillon `tasks/import-osm-echantillons/` ou import Overpass par fichier) ; `npm run bench`
  et `tools/perf/measure-canvas.cjs` en édition et en conduite ; chiffres notés ici.
- [x] 2. Mesurer la sauvegarde : taille JSON, échec de quota `localStorage`, durée de
  `JSON.stringify`. Décider IndexedDB (Lot D grands réseaux) sur mesure, pas sur intuition.
- [x] 3. Mesurer la conversion `convertOsm` sur 300 km : si > 1 s, Web Worker pour l'import
  libre (le jeu de données pré-calculé ne passe pas par là).

### Lot 1 — Repère global et gares
- [x] 4. Projection Lambert-93 à origine fixe dans `osmProjection.ts` (option, l'existante reste
  par défaut pour l'import libre) ; `osmSource` porte le repère.
- [x] 5. Lecture des gares dans `osmRead` / `osmBuild` : nœuds et zones `railway=station`,
  `uic_ref`, `name` ; rattachement aux rails à quai ; remplissage de `station_stop`.
- [x] 6. Type `Station` dans le domaine, sérialisé dans `SerializedProject` (version 4), dessiné
  (nom au niveau de détail adapté).
- [x] 7. Liste des gares voyageurs SNCF embarquée (`src/domain/import/stations-fr.json`, code UIC,
  nom, lat/lon) ; croisement par `uic_ref` puis par distance.

### Lot 2 — Jeu de données « LGV France »
- [x] 8. Script `tools/lgv-dataset/` (Node, TypeScript, réutilise `domain/import/`) : extraction
  Geofabrik → filtre LGV + raccordements → conversion par ligne → fichiers de géométrie +
  index. Liste des raccordements à inclure établie à la main (Marseille, Lyon Part-Dieu,
  Paris Gare de Lyon, Valence…) et versionnée.
- [x] 9. Format de l'index et des fichiers de ligne, documenté ; test d'aller-retour
  sérialisation ; mention ODbL et date dans l'index.
- [x] 10. Publication dans `public/data/lgv/` (servi par GitHub Pages) ; action CI de
  régénération (manuelle d'abord, mensuelle ensuite). Taille totale notée.
- [x] 11. Contrôle : LGV Méditerranée vérifiée sur place (vitesse 300, aiguillages de
  bifurcation, raccordement de Marseille), Marseille → Lyon mesurable sur le canevas.

### Lot 3 — Recherche de gares et chargement par ligne
- [x] 12. Champ « Ligne entre gares… » (menu Fichier ou Cartes) : complétion sur l'index, liste
  ordonnée de gares, homonymes distingués, aperçu de la longueur et des lignes traversées.
- [x] 13. Plus court chemin sur l'index ; téléchargement des lignes ; assemblage ; projet
  verrouillé ; cadrage ; attribution ODbL.
  Recherche de chemin **orientée** (état = nœud + rail d'arrivée) : `findPath` travaille par nœud et
  trouve ou non selon le nœud de départ choisi (Lot 2 : Marseille → Part-Dieu trouvé à la 17e
  combinaison départ/arrivée, 325 km).
- [x] 14. Chargement / libération à la ligne selon vue + trains + itinéraire ; anticipation
  avant qu'un train atteigne une ligne non chargée.
- [ ] 15. Facteur d'accélération du temps dans la simulation (si confirmé).
- [x] 16. Mesure sur Marseille → Lyon chargée : images par seconde en conduite, mémoire, temps
  de chargement. Décision tuiles / IndexedDB sur ces chiffres.

### Lot 3 bis — Fusion de projets (« Fichier ▸ Ajouter un JSON au projet… »)
Demandé le 2026-10-07 : importer plusieurs JSON quelconques dans un même projet, conflits,
jonctions et coordonnées résolus. Le Lot 3 ne réunit que des fichiers du jeu de données (mêmes
ids, même repère) ; ce lot généralise à tout fichier, sur le même code (`projectSlices.ts`).
Hypothèses tant que l'utilisateur ne dit pas autrement : **le projet courant gagne** sur un
conflit (réglages, voie décrite deux fois) ; le placement manuel est le dernier point, séparable.
- [ ] 25. Renumérotation du fichier entrant (`renumberProject` : nœuds, rails, tables, zones,
  signaux, gares, clés de `sectionMeta`, `parentSegmentId`) à partir du compteur courant ;
  identité du résultat avec le fichier d'origine à la renumérotation près (test).
- [ ] 26. Coordonnées : même repère → rien ; import OSM en repère local → reprojection en
  Lambert-93 (inverse de la projection locale à écrire, testé au centimètre contre la
  projection directe) quand le projet courant est en Lambert-93, et l'inverse ; un fichier sans
  géoréférence ni repère commun est posé tel quel et signalé (voir 29).
- [ ] 27. Dédoublonnage avant soudure : rails identiques (extrémités à moins de la tolérance de
  réconciliation, même forme) → un seul, le projet courant gagne ; gares par code UIC puis par
  nom ; zones de vitesse et signaux portés par un rail écarté retirés. Sans ce pas, deux imports
  qui se recouvrent fabriquent des croisements fantômes entre les deux copies.
- [ ] 28. Soudure aux bords : `reconcileNetworkIntersections` sur la zone de contact (boîte des
  rails ajoutés élargie de la tolérance), `syncJunctions` propose les tables des fourches nées de
  la soudure ; bilan dans la fenêtre d'import (rails ajoutés, écartés, nœuds soudés, croisements,
  gares fusionnées, réglages ignorés) ; un pas d'annulation pour toute la fusion.
- [ ] 29. Placement manuel d'un réseau sans géoréférence : fantôme du fichier déplaçable et
  tournable sur le canevas, clic pour poser, puis 27–28. Interface surtout ; à faire si les
  fichiers ne viennent pas tous d'OSM.
Vérification : deux imports OSM voisins qui se recouvrent (fixtures de Pasilly et Clelles
découpées en deux moitiés avec recouvrement) donnent après fusion le même réseau que l'import
d'un bloc (idiome `parts` de `projectSlices.test.ts`) ; un fichier en repère local ajouté à un
projet Lambert-93 se superpose aux gares du registre à moins de 5 m.

### Lot 4 — Salon à N pupitres et état du monde
- [ ] 17. `rooms.ts` et `remoteHost.ts` : N pupitres, un train par pupitre, prise et rendu des
  commandes par train, pastilles « conducteur » sur le PC.
- [ ] 18. Message `world` (positions, aiguillages, signaux changés) à 10 Hz, validé dans
  `protocol.ts` ; extrapolation le long de la voie côté pupitre ; test sur `fakeLink` avec
  latence simulée.
- [ ] 19. Vue aiguilleur sur le PC : tableau de contrôle au-dessus du mode pilotage épuré
  (aiguillages cliquables, cantons, signaux, trains nommés par conducteur).
- [ ] 20. Vérification de version du jeu de données entre hôte et pupitres.

### Lot 5 — Mise en relation publique (essai)
- [ ] 21. Lien `remoteLink` WebRTC DataChannel, protocole v1 inchangé, STUN public.
- [ ] 22. Mise en relation par un service public gratuit (choix à faire à ce moment-là :
  broker PeerJS, trackers / relais type Trystero, autre) ; code de salon long ; QR code
  existant réutilisé.
- [ ] 23. Essai réel depuis le site publié : même Wi-Fi, puis 4G. Taux d'échec de connexion
  noté. Si trop élevé : repli sur le relais hébergé (étapes 21–24 de `plan-console-conduite.md`).
- [ ] 24. Notes de version : ce qui marche sur le site publié, ce qui exige `npm run dev`.

## Ordre et jalons

1. **Lot 0** — chiffres en main ; décide IndexedDB / Worker / rails longs d'abord.
2. **Lot 1** — un import libre de Marseille montre ses gares nommées ; deux imports voisins se
   superposent.
3. **Lot 2** — `public/data/lgv/` existe, LGV Méditerranée se charge en un clic.
4. **Lot 3** — « Marseille Saint-Charles → Lyon » tapé, ligne chargée, conduite en solo.
4 bis. **Lot 3 bis** — un second JSON ajouté au projet se soude au premier sans doublon, bilan lisible.
5. **Lot 4** — deux téléphones conduisent deux trains sur la ligne, le PC aiguille, en local.
6. **Lot 5** — la même partie depuis le site publié.

Dépendances vers les autres plans : Lot B rails longs (`plan-grands-reseaux.md`) améliore le
Lot 2 mais ne le bloque pas (le script écrit les rails disponibles) ; Lot P pilotage épuré est
la base de la vue aiguilleur.

## Vérification

- `npm test`, `npm run typecheck`, `npm run build` à chaque lot.
- Lot 0 et 3 : chiffres du bench et de `measure-canvas.cjs` collés ici.
- Lot 1 : test d'aller-retour projection Lambert-93 sur des points connus (IGN) ; gares de
  Marseille Saint-Charles reconnues sur l'échantillon.
- Lot 2 : test du script sur un petit extrait versionné ; index cohérent (toute arête relie deux
  nœuds existants, longueur = somme des rails).
- Lot 4 : test `fakeLink` avec latence 200 ms et perte 5 % : écart de position extrapolée
  < 2 m à 300 km/h ; repli sur frein serré inchangé.
- Lot 5 : contrôle humain, réseau local puis 4G.

## Questions ouvertes

- Nombre maximal de conducteurs par salon (8 proposé).
- Accélération du temps : voulue ? bornes ?
- Service de mise en relation : lequel, et accepte-t-on une dépendance d'exécution pour lui ?
- Faut-il montrer sur le pupitre les autres trains (oui proposé, via `world`) ou seulement les
  signaux ?
- Jusqu'où vont les raccordements inclus : seulement vers les terminus de l'exemple, ou toutes
  les gares de centre-ville atteintes par une LGV ?

## Suivi

### Lot 0 — fait le 2026-10-07

Scripts : `tools/perf/measure-lgv.test.ts` (Node ; `PROFILE=1 LGV_KM=<km de voie>
LGV_TARGET_RAILS=<rails> LGV_OUT=<projet.json> npx vitest run tools/perf/measure-lgv.test.ts
--silent=false`) et `tools/perf/measure-project.cjs` (navigateur ; importe un fichier projet par
le menu et mesure). Réseau de mesure : la réponse Overpass de Pasilly (`fixtures/lgv-pasilly.json`,
54 km de voie, 263 rails) répétée côte à côte jusqu'à la longueur voulue puis convertie d'un bloc ;
les copies ne sont pas raccordées entre elles.

| Réseau | voie | rails | signaux | JSON | `convertOsm` | chargement | image JS fit / 1 / 8 px/m | navigateur fit / zoomé | autosave |
|---|---|---|---|---|---|---|---|---|---|
| Pasilly | 54 km | 263 | 73 | — | 0,2–0,3 s | — | — | — | — |
| ≈ Marseille–Lyon | 600 km | 3 168 | 876 | 1,07 Mio | 1,7 s | 0,18 s | 2,1 / 1,6 / 2,7 ms | 24 / 17–21 ms | ok |
| banc 15 800 rails | 3 240 km | 15 810 | — | 5,37 Mio | — | 1,43 s | 21 / 4,1 / 7,4 ms | — | à la limite |
| France LGV | 5 600 km | 27 423 | 7 592 | 9,55 Mio | 24 s | 1,44 s | 35 / 4,7 / 13,5 ms | 52 / 19–34 ms | **échec** |
| 2 × France | 11 200 km | 54 846 | — | 19,3 Mio | — | 2,84 s | 42 / 8,6 / 22,5 ms | — | — |

Autres chiffres : `tickAllTrains` 0,1 ms par pas (un train à pleine puissance, 600 pas), à toute
taille ; données dérivées à froid (sections) 344 / 547 / 1 384 ms pour 15 800 / 27 400 / 54 800
rails ; premier `markDirty` 244 / 326 / 653 ms ; `pushHistorySnapshot` 22 / 39 / 64 ms ; import du
fichier dans le navigateur (lecture + parse + chargement + première image) 0,47 s pour 600 km,
1,77 s pour la France. Les temps « navigateur » viennent d'un Chromium headless qui rastérise en
logiciel : plancher ~15 ms même pour une vue vide, script 1,5 à 3 ms par image ; la vue
d'ensemble de la France fait 16 000 appels canvas.

Décisions :

1. **Pas de tuiles ni de streaming en v1.** Marseille–Lyon (~3 200 rails) ne coûte rien ; la
   France entière tient en mémoire et se dessine (3 à 14 ms de script par image). Chargement à la
   ligne (décision de conception) suffisant.
2. **Pas d'IndexedDB** : un projet verrouillé ne sauvegarde que sa recette (voir Décisions de
   conception). Marseille–Lyon seul (1,07 Mio) tiendrait de toute façon dans le quota.
3. **Pas de Web Worker** pour l'import libre : 1,7 s pour 600 km de voie, quasi linéaire
   (~3 à 4 ms par km de voie). La génération du jeu de données (24 s pour la France) est hors
   ligne.
4. **Rails longs (Lot B grands réseaux)** : bonus, pas prérequis. Un rail long par tronçon entre
   aiguillages diviserait le nombre de rails par dix et la taille du JSON d'autant.

Pistes à creuser (étape 16, pas bloquantes) :

- L'image au niveau « détail » (8 px/m, 240 × 135 m à l'écran) **croît avec la taille du réseau**
  (7,4 → 13,5 → 22,5 ms pour 15 800 → 27 400 → 54 800 rails) alors que ce qui est visible ne
  change pas : quelque chose parcourt tout le réseau à ce niveau. Profil navigateur :
  `renderNetwork`, `nodesAmongInBox`, `isPointInBounds`.
- Le chargement (`deserializeNetwork`) coûte 1,4 s pour la France : acceptable à la ligne
  (0,18 s pour 600 km), à revoir si la France entière devait se charger d'un coup.
- La vue d'ensemble (niveau schématique) dessine 16 000 appels canvas pour la France : une
  polyligne par section existe déjà, elle profitera des rails longs.

### Lot 1 — fait le 2026-10-07 (branche `feature/lignes-lgv`, trois commits)

- **Repère Lambert-93** (`osmProjection.ts`) : option `frame` de l'import, case « Repère national
  Lambert-93 » dans la fenêtre, `OsmSource.frame` gardé par la persistance. Formules vérifiées au
  centimètre sur trois gares SNCF (x_l93/y_l93 ↔ WGS84). La projection locale reste le défaut.
- **`Network.stations`** : `Station { id, name, pos, uic?, code?, stops: { segId, t, ref? }[] }`,
  module `models/stations.ts` (add, remove, identité, clean, remap via `replaceRail`, restore),
  compté par la révision, sauvegardé en **version 4** du projet quand il y a des gares, annulé et
  rechargé comme le reste.
- **Import** : la requête Overpass ramène les nœuds `railway=station|halt` ; `osmStations.ts`
  groupe les positions d'arrêt (`railway=stop`) par code UIC puis par nom à moins de 1 500 m,
  le nœud de gare précise nom et trigramme (`railway:ref`), un bâtiment seul se rattache aux voies
  à moins de 80 m, un nœud sur une voie non importée (métro) reste à sa voie. Placeur commun avec
  les signaux (`osmPlace.ts`). Les voies à quai deviennent des sections `station_stop` nommées
  « Gare · voie n » (`stationSectionMeta`). Fixture de Clelles enrichie des tags de gare : 1 gare,
  UIC 8774762, CMS, 2 arrêts.
- **Liste SNCF** « gares de voyageurs » (2 792 gares, ODbL) dans `src/data/stations-fr.json`
  (167 ko, régénérée par `tools/stations/fetch-sncf-stations.mjs`), chargée à la demande par la
  fenêtre d'import ; correspondance par UIC (7 chiffres) sinon à moins de 300 m → nom officiel,
  trigramme.
- **Canvas et panneau** : marque et pastille de nom à tout niveau de détail (`stationRender.ts`),
  réservées avant les signaux et les badges ; sélection et survol avec l'outil sélection ;
  `StationPanel` en lecture seule (nom, code, UIC, voies à quai et leurs sections).
- Suite : 2 542 tests verts, `npm run build` vert, contrôle à l'écran sur la fixture de Clelles
  (fenêtre : « 1 dans la zone », bilan « 1 gare posée, avec 2 voies à quai », projet sauvé en
  version 4 avec « Clelles - Mens », CMS, deux sections « voie 1 » / « voie 2 »).

Reste pour plus tard (noté) : ramener les ways `railway=platform` pour les numéros de voie quand
les arrêts n'ont pas de `local_ref` ; mention SNCF dans la fenêtre « À propos » seulement quand le
projet a des gares (aujourd'hui dès qu'il vient d'OSM).

### Lot 2 — fait le 2026-10-07 (branche `feature/lignes-lgv`, trois commits)

- **Extraction** : 40 tuiles de 2° clippées à la France (aire Overpass 3602202162), aucune trop
  grande ; 4 raccordements. Premier passage : 44 requêtes, Overpass « busy » 20 fois (pauses 30,
  60, 120 s), la dernière tuile a échoué au 4e essai et est passée à la relance (le cache reprend),
  ≈ 45 min en tout ; les corrections de couloir ont coûté 3 requêtes de plus. Cache brut 44 Mo.
- **Deux défauts vus sur la première génération** (350 495 éléments, 189 565 rails, 16 117 km,
  337 « lignes », 46,75 Mio) et corrigés : `["railway:tvm"]` attrapait `railway:tvm=no`
  (18 766 voies classiques) → filtre `~"^[0-9]"` ; l'identité des lignes par `ref` ne tenait pas
  (« 752 000 » avec espace, « LN2 », absent, trois LGV sous 752000, relations « voie 1 / voie 2 /
  section » qui fragmentaient) → le manifeste liste les **relations OSM par id** pour chaque
  ligne, par ordre de priorité ; les autres relations ne disent rien ; plus de repli sur les noms.
  Le cache a été migré par script (voies classiques retirées) au lieu d'être redemandé.
- **Génération retenue** : 91 322 éléments fusionnés ; `convertOsm` 26 s ; 36 626 rails, 6 001 km
  de voie, 57 gares, 25 bouts détachés < 2 km retirés ; réconciliation 0 coupe / 0 soudure ;
  9 zones de vitesse coupées aux frontières ; 680 ways grande vitesse hors relation listée
  (raccordements, pris par propagation) ; **« autres » vide**. 16 fichiers, 35 raccords entre
  lignes, **8,53 Mio** (table par ligne dans `public/data/lgv/README.md`) : les 12 LGV de 66 ko
  (Perpignan–Figueres) à 1 099 ko (Sud-Est, 927 km de voie) ; raccordements 53 à 1 057 ko (Paris).
  Longueurs cohérentes avec le réseau réel (LGV Est 826 km de voie pour 406 km de ligne double…).
- **Couloirs de raccordement** tracés depuis OSM après deux trous trouvés par composantes
  connexes et bouts de voie : la LGV Méditerranée finit à la bifurcation des Tuileries (nord de
  Marseille), la ligne PLM descend à Saint-Charles en 7,4 km ; la ligne Lyon–Grenoble passe 800 m
  au nord de la droite Saint-Quentin – Saint-Priest et la PLM 600 m à l'ouest de la droite
  Vénissieux – Guillotière. Points tous les ~1 km dans les courbes, rayon 400 m ; disque de
  Gare de Lyon ramené à 1 km (Bercy et Austerlitz ne sont pas voulus).
- **Contrôles** : `npm test` vert (`dataset.samples.test.ts` actif : fichiers chargés, index
  cohérent, union Marseille–Lyon), `tsc` vert. Navigateur sans tête sur `lgv-mediterranee.json`
  (841 ko) : import 369 ms, autosauvegarde 1,47 Mio OK, trame 16,6 ms (plancher logiciel), 0,7 ms
  de script. Union Méditerranée + Rhône-Alpes + deux raccordements : 9 131 rails, 2,04 Mio, un
  seul tenant (hors 95 nœuds d'un bout isolé), **Marseille Saint-Charles → Lyon Part-Dieu
  325,2 km / 2 364 rails** par `findPath`. Captures : Aix-en-Provence TGV et Avignon TGV nommées
  avec « voie 3 / voie 4 », vitesses 300 et 320, bifurcations avec tables, Tuileries reliée,
  faisceau de Saint-Charles « voie A … voie C ».
- **CI de régénération différée** : Overpass refuse déjà les requêtes nationales depuis un poste
  (une tuile sur deux « busy »), un runner ferait pire ; `node tools/lgv-dataset/run.mjs` à la
  main, cache hors git.

Reste pour plus tard (noté) : gares doublées par le regroupement (Paris Austerlitz ×3, CDG 2 TGV
×2 sous deux UIC) et un nœud « Calais, France » sans UIC ; couloirs tracés à la main (une
alternative : les relations des lignes classiques clippées par une boîte) ; `findPath` orienté
(Lot 3) ; `--round` non mesuré (les fichiers tiennent déjà sous 1,1 Mio).

### Lot 3 — fait le 2026-10-07 (branche `feature/lignes-lgv`, neuf commits, le facteur de temps à part)

- **Fichier ▸ « Ligne entre gares… »** (`LineBetweenStationsModal.tsx`, paresseuse) : recherche par
  préfixe de mots sur le nom normalisé ou le trigramme (`stationSearch.ts`), homonymes signalés
  par UIC et trigramme (les deux « Aéroport Charles de Gaulle 2 TGV »), gares ordonnées (monter,
  descendre, retirer), aperçu (lignes dans l'ordre, km de voie, octets, date, attribution),
  « Charger » ou « Charger et remplacer ». Logique pure dans `src/domain/dataset/` (`lineRoute.ts`,
  `journeyPlan.ts`), testée sur un index fabriqué et sur le vrai : Marseille → Lyon = les 4 lignes
  attendues, Paris → Marseille passe par la Sud-Est.
- **Itinéraire sur l'index** : lignes = sommets, raccords = arêtes, Dijkstra à balayage ; pas de
  recherche sur la géométrie. Les types de l'index ont quitté `tools/` pour `src/domain/dataset/`
  (`readDatasetIndex` valide ce qui est lu), le générateur les importe.
- **Projet verrouillé** (`store.dataset`, `isNetworkLocked`, `canEditNetwork`) : `setTool` refuse les
  outils de construction (gardés : sélection, vue, mesure, train, attelage), les méthodes d'édition
  du store rendent la main, pas d'historique (`canUndo` faux), glisser de nœud et gizmo coupés dans
  le canevas ; barre d'outils grisée « Réseau importé, non modifiable », menus contextuel et
  Édition sans couper/supprimer/parallèle, note dans l'inspecteur. Trains, conduite, aiguillages
  manœuvrés, gares : inchangés.
- **Recette à la place de la géométrie** : `SerializedProject.dataset`, portée par `ProjectOrigin` ;
  `flushPersistedState` écrit un réseau vide avec trains, caméra, réglages (750 à 990 caractères
  au lieu de 2 Mio) ; au démarrage, `reloadDataset` retélécharge les lignes et repose trains et
  caméra (toasts « Rechargement de la ligne… » / « … rechargée ») ; fichiers injoignables → message
  en français, recette conservée, reprise au prochain démarrage (vérifié en coupant les routes
  `data/lgv/**`). L'export JSON reste la géométrie complète plus la recette : réimporté, il se
  reverrouille. `PROJECT_VERSION` reste 4 (argumenté dans le plan d'implémentation).
- **Lignes à la volée** : une fois par seconde en conduite, tout raccord à moins de 5 km de la tête
  d'un train vers une ligne non chargée est demandé (`datasetLoader`, posé par
  `installLineStreaming`), puis `unionProjects` + `deserializeNetwork(union, tolérance, réseau)` **en
  place** : trains intacts, conduite continue, recette étendue, toast « … chargée en route ». Jamais
  de déchargement. Test sous l'oracle des révisions.
- **Mesures** (`tools/perf/measure-driving.cjs`, Chromium sans tête, tramage logiciel ; le store est
  exposé sur `window.__openRailsStore` en build de développement seulement) :

  | | Marseille → Lyon (4 lignes, 9 131 rails) | Marseille → Avignon, train à Valence (2 → 3 lignes) |
  |---|---|---|
  | Aperçu | 958 km de voie, 2,0 Mio | 581 km, 1,2 Mio |
  | Charger → toast | 300 ms | 237 ms |
  | Tas JS vide / chargé | 28 / 71 Mio | 28 / 52 Mio |
  | Conduite 30 s | 60 i/s, trame médiane 16,7 ms, p95 16,8 ms, pire 33 ms | 59,6 i/s, p95 16,8 ms, **pire 217 ms** (ajout de la LGV Rhône-Alpes, 1 401 rails, union de 6 857 rails rechargée en place) |
  | Tas en conduite | 90 → 172 Mio en 30 s (le ramasse-miettes du Chromium sans tête tarde ; l'autre série redescend de 142 à 79) | 112 → 90 Mio |
  | Rechargement par recette | 567 ms | 550 ms |

  **Décision (item 16)** : ni tuiles ni IndexedDB. Un trajet se charge en 0,3 s, se recharge en
  0,6 s, tient en 70 Mio ; l'à-coup de 217 ms d'une ligne ajoutée en route est perceptible mais
  rare (une fois par ligne) ; à revoir seulement si les lignes classiques décuplent le réseau
  (désérialiser la seule ligne ajoutée au lieu de l'union).

Reste pour plus tard (noté) : l'à-coup de l'ajout en route (désérialiser la tranche ajoutée seule) ;
le tas qui grimpe en conduite à vérifier sur un vrai navigateur ; un item « Recharger la ligne »
dans Fichier pour réessayer sans redémarrer ; mémoire double des fichiers gardés (`datasetFiles`).

## Hors périmètre (cette version)

- Lignes classiques en dehors des raccordements ; tuiles ; serveur autoritaire hébergé.
- Édition du réseau importé, à un ou à plusieurs ; comptes ; reprise de session.
- Serveur TURN payant.
