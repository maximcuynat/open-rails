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

- **La France LGV entière est petite.** ~2 800 km de ligne, 5 600 km de voie. Géométrie douce,
  donc rails longs après ajustement en arcs : estimation **10 000 à 20 000 rails** pour toute la
  France, soit l'échelle du bench actuel (13 527). Le streaming par tuiles n'est **pas** justifié
  en première version ; la granularité « une ligne = un fichier » suffit.
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
- [ ] 1. Construire un réseau de l'ordre de 15 000 rails en géométrie LGV (duplication d'un
  échantillon `tasks/import-osm-echantillons/` ou import Overpass par fichier) ; `npm run bench`
  et `tools/perf/measure-canvas.cjs` en édition et en conduite ; chiffres notés ici.
- [ ] 2. Mesurer la sauvegarde : taille JSON, échec de quota `localStorage`, durée de
  `JSON.stringify`. Décider IndexedDB (Lot D grands réseaux) sur mesure, pas sur intuition.
- [ ] 3. Mesurer la conversion `convertOsm` sur 300 km : si > 1 s, Web Worker pour l'import
  libre (le jeu de données pré-calculé ne passe pas par là).

### Lot 1 — Repère global et gares
- [ ] 4. Projection Lambert-93 à origine fixe dans `osmProjection.ts` (option, l'existante reste
  par défaut pour l'import libre) ; `osmSource` porte le repère.
- [ ] 5. Lecture des gares dans `osmRead` / `osmBuild` : nœuds et zones `railway=station`,
  `uic_ref`, `name` ; rattachement aux rails à quai ; remplissage de `station_stop`.
- [ ] 6. Type `Station` dans le domaine, sérialisé dans `SerializedProject` (version 4), dessiné
  (nom au niveau de détail adapté).
- [ ] 7. Liste des gares voyageurs SNCF embarquée (`src/domain/import/stations-fr.json`, code UIC,
  nom, lat/lon) ; croisement par `uic_ref` puis par distance.

### Lot 2 — Jeu de données « LGV France »
- [ ] 8. Script `tools/lgv-dataset/` (Node, TypeScript, réutilise `domain/import/`) : extraction
  Geofabrik → filtre LGV + raccordements → conversion par ligne → fichiers de géométrie +
  index. Liste des raccordements à inclure établie à la main (Marseille, Lyon Part-Dieu,
  Paris Gare de Lyon, Valence…) et versionnée.
- [ ] 9. Format de l'index et des fichiers de ligne, documenté ; test d'aller-retour
  sérialisation ; mention ODbL et date dans l'index.
- [ ] 10. Publication dans `public/data/lgv/` (servi par GitHub Pages) ; action CI de
  régénération (manuelle d'abord, mensuelle ensuite). Taille totale notée.
- [ ] 11. Contrôle : LGV Méditerranée vérifiée sur place (vitesse 300, aiguillages de
  bifurcation, raccordement de Marseille), Marseille → Lyon mesurable sur le canevas.

### Lot 3 — Recherche de gares et chargement par ligne
- [ ] 12. Champ « Ligne entre gares… » (menu Fichier ou Cartes) : complétion sur l'index, liste
  ordonnée de gares, homonymes distingués, aperçu de la longueur et des lignes traversées.
- [ ] 13. Plus court chemin sur l'index ; téléchargement des lignes ; assemblage ; projet
  verrouillé ; cadrage ; attribution ODbL.
- [ ] 14. Chargement / libération à la ligne selon vue + trains + itinéraire ; anticipation
  avant qu'un train atteigne une ligne non chargée.
- [ ] 15. Facteur d'accélération du temps dans la simulation (si confirmé).
- [ ] 16. Mesure sur Marseille → Lyon chargée : images par seconde en conduite, mémoire, temps
  de chargement. Décision tuiles / IndexedDB sur ces chiffres.

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

## Hors périmètre (cette version)

- Lignes classiques en dehors des raccordements ; tuiles ; serveur autoritaire hébergé.
- Édition du réseau importé, à un ou à plusieurs ; comptes ; reprise de session.
- Serveur TURN payant.
