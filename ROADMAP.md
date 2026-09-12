# Roadmap — open-rails

> Éditeur de rails sur canvas infini.
> Stack : React 18 + TypeScript + Vite 5 + Vitest.
> Dev server : `http://localhost:8900/`

## État actuel

| Composant                                                   | Statut |
| ----------------------------------------------------------- | ------ |
| Scaffolding projet (Vite, TS, React)                        | Fait   |
| Serveur dev port 8900                                       | Fait   |
| Canvas infini (pan + zoom)                                  | Fait   |
| Grille adaptive (minor/major)                               | Fait   |
| Barre d'échelle adaptative                                  | Fait   |
| HUD (zoom + position caméra)                                | Fait   |
| Thèmes light/dark                                           | Fait   |
| Modèle de données (Point, Node, Segment, Network)           | Fait   |
| Placement de nœuds avec snap grille                         | Fait   |
| Rendu rails détaillés (double file + traverses)             | Fait   |
| Rendu simplifié (trait unique) quand dézoomé                | Fait   |
| Sélection nœuds et segments                                 | Fait   |
| Suppression (Delete/Backspace)                              | Fait   |
| Barre d'outils (Place, Curve, Select, Snap)                 | Fait   |
| Raccourcis clavier (N, C, V, G, Esc, Del)                   | Fait   |
| Tests unitaires (72 tests)                                  | Fait   |
| Continuité G1 (tangente entre segments)                     | Fait   |
| Courbes dynamiques (rayon calculé, pas fixe)                | Fait   |
| Courbes Bezier quadratique (3 clics: start → via → end)     | Fait   |
| Rendu courbes détaillé et simplifié                         | Fait   |
| Hit-test sur courbes                                        | Fait   |
| Preview courbe en temps réel                                | Fait   |
| Refonte UI (TopBar, ToolBar, SidePanel, StatusBar, MiniMap) | Fait   |
| Export JSON / SVG / PNG                                     | Fait   |
| Toggle thème manuel (light/dark/auto)                       | Fait   |

---

## Ce que font les logiciels de référence

Avant de détailler la suite, voici ce que font les outils établis du secteur,
ça cadre les choix de la phase 3.

XTrackCAD traite un aiguillage comme une pièce qui s'aligne automatiquement
sur les voies existantes pendant le glisser-déposer. Quand les extrémités
sont assez proches et orientées dans le même axe, le logiciel découpe la voie
existante et insère la connexion tout seul. Les extrémités non reliées
restent visibles et un mode d'affichage dédié permet de les repérer d'un
coup d'œil. Un réglage d'angle minimum évite les jonctions mal alignées, et
une fonction de recherche par easement lisse la transition entre deux
rayons différents.

AnyRail et SCARM suivent une logique voisine avec un retour visuel plus
direct : dès qu'une pièce en cours de placement s'approche d'une extrémité
compatible, cette extrémité s'allume en rouge pour indiquer qu'elle va se
connecter. L'utilisateur garde la main sur la validation du point de
jonction plutôt que de subir un snap automatique silencieux.

Trois idées reviennent dans tous ces outils et servent de base à la phase 3
ci-dessous. Le réseau reste un graphe de connexions, jamais juste un dessin.
Toute pièce déposée sur une voie existante la découpe pour s'y insérer
proprement. Et les extrémités non connectées doivent toujours être visibles,
jamais silencieuses.

---

## Phase 0 — Fondations visuelles ✅

- [x] Initialiser le projet (Vite + React + TS)
- [x] Configurer le serveur dev sur le port 8900
- [x] Canvas plein écran avec pan (pointer drag) et zoom (wheel, cursor-anchored)
- [x] Grille infinie adaptive (espacement logarithmique 1/2/5 × 10^n)
- [x] Marqueur d'origine (croix au point 0,0)
- [x] Barre d'échelle en bas à droite (s'adapte au zoom)
- [x] HUD (niveau de zoom + position caméra)
- [x] Support light/dark via CSS variables + `prefers-color-scheme`
- [x] Gestion DPR (Retina) via `setTransform`

---

## Phase 1 — Modèle de données et placement de base ✅

**Objectif :** pouvoir dessiner une ligne brisée à la souris, snapée sur la grille.

- [x] Types du domaine (`Point`, `Node`, `Segment`, `Network`)
- [x] Stockage de l'état du réseau (React ref + redraw à la demande)
- [x] Outil placer un nœud, avec chaînage automatique
- [x] Snap sur la grille (toggle `G`)
- [x] Rendu des nœuds par-dessus la grille
- [x] Rendu détaillé (double file + traverses + ballast) et simplifié
- [x] Hit-test et sélection sur nœuds et segments
- [x] Suppression (`Delete` / `Backspace`)
- [x] Tests unitaires : `network.test.ts` (18 tests)

**Livrable :** on peut dessiner une ligne brisée snapée, sélectionner et supprimer.

---

## Phase 2 — Courbes et types de rails ✅

**Objectif :** tracer des rails droits et courbes, les mélanger, avec continuité G1.

- [x] Rail courbe en Bezier quadratique, avec `via`
- [x] Outil courbe (3 clics puis 2 clics), preview en direct
- [x] Hit-testing et rendu détaillé/simplifié des courbes
- [x] Profils prédéfinis Kato Unitrack, puis courbes dynamiques (G1)
- [x] Continuité tangente automatique entre segments chaînés
- [x] 72 tests au total

**Livrable :** les rails s'enchaînent avec continuité tangente. Pas de rayon
fixe, tout dépend de l'orientation précédente et du point d'arrivée. Prêt
pour les aiguillages.

---

## Phase 3 — Topologie, jonctions et aiguillages

**Objectif :** transformer le dessin en un vrai graphe ferroviaire. Poser des
aiguillages, éditer librement n'importe quelle intersection, détecter les
chemins possibles à travers le réseau.

Cette phase remplace l'ancienne phase 3 "Aiguillages" par une version plus
large, découpée en 5 étapes qui se construisent les unes sur les autres.

### 3.1 — Extension du modèle : le nœud jonction

- [ ] Nouveau type `Junction` dans `types.ts` :
  - [ ] `id`, `position: Point`
  - [ ] `stem: NodeId` (branche commune)
  - [ ] `straightBranch: NodeId`, `divergingBranch: NodeId`
  - [ ] `activeBranch: 'straight' | 'diverging'`
  - [ ] `hand: 'left' | 'right'` (sens de la déviation)
- [ ] Une jonction reste un nœud du graphe existant : elle ne casse pas
      `adjacency`, elle ajoute juste une règle de traversée dessus
- [ ] Catalogue des gabarits d'aiguillage dans `profiles.ts` (numéro de
      talon #4 / #6, rayon de la branche déviée, angle), sur le modèle du
      catalogue Kato déjà en place pour les rails
- [ ] Tests : `junction.test.ts` (création, branches, validité)

### 3.2 — Pose et découpe automatique

- [ ] Outil **aiguillage** dans la barre d'outils, un gabarit sélectionnable
      comme pour les courbes (`[` / `]`)
- [ ] Pose sur du vide : place la jonction avec ses trois branches, comme un
      placement de courbe standard
- [ ] Pose sur une voie existante : le segment visé est découpé en deux, la
      jonction s'insère au point de découpe. Reprend l'idée de XTrackCAD, où
      déposer une pièce sur une voie la scinde automatiquement au lieu de la
      chevaucher
- [ ] Alignement assisté : pendant le déplacement de la pièce, les
      extrémités compatibles à proximité se surlignent, la pose confirme la
      connexion. Reprend le retour visuel d'AnyRail/SCARM plutôt qu'un snap
      silencieux
- [ ] Refus de connexion si l'angle entre les deux voies dépasse une
      tolérance réglable (évite les jonctions vrillées)

### 3.3 — Édition libre des intersections

- [ ] Déplacer un nœud partagé par plusieurs segments déplace tous les
      segments connectés (au lieu d'un déplacement isolé)
- [ ] Fusionner deux nœuds proches en un seul point de jonction (glisser un
      nœud sur un autre, ou commande "Souder")
- [ ] Scinder un segment existant en cliquant dessus avec l'outil place :
      insère un nœud intermédiaire sans casser la géométrie
- [ ] Convertir un croisement de deux voies en jonction réelle, ou au
      contraire dissocier une jonction en deux voies indépendantes
- [ ] Retourner une jonction (flip gauche/droite) sans la replacer
- [ ] Affichage dédié des extrémités non connectées (halo ou couleur), pour
      les repérer d'un coup d'œil comme dans XTrackCAD
- [ ] Tests : `junction-edit.test.ts` (fusion, scission, déplacement en cascade)

### 3.4 — Rendu et bascule des aiguillages

- [ ] Branche active dessinée pleine, branche inactive en pointillé ou
      grisée
- [ ] Clic sur la jonction ou touche `T` (jonction sélectionnée) : bascule
      `activeBranch`
- [ ] Animation courte de la transition (lerp visuel, pas juste un saut)
- [ ] Icône directionnelle dans le SidePanel quand une jonction est
      sélectionnée (numéro de talon, sens, branche active)

### 3.5 — Détection de chemins

- [ ] Fonction `findPath(net, fromNodeId, toNodeId)` : parcours du graphe en
      largeur, respecte `activeBranch` de chaque jonction traversée
      (n'emprunte pas la branche fermée)
- [ ] Fonction `reachableFrom(net, nodeId)` : ensemble de tous les points
      atteignables depuis un point donné, compte tenu de l'état actuel des
      aiguillages
- [ ] Surlignage du chemin entre deux points sélectionnés (Ctrl+clic sur un
      second nœud avec l'outil select)
- [ ] Détection des voies orphelines (culs-de-sac non voulus, segments
      totalement déconnectés du reste du réseau)
- [ ] Détection des boucles fermées (utile pour valider un ovale ou une
      voie de dépôt)
- [ ] Mode debug optionnel : affiche l'graphe topologique par-dessus le
      rendu (nœuds numérotés, jonctions en couleur)
- [ ] Tests : `pathfinding.test.ts` (chemin direct, chemin bloqué par une
      jonction fermée, détection de cul-de-sac, boucle fermée)

**Livrable :** un réseau avec aiguillages fonctionnels, des jonctions
éditables comme n'importe quel autre élément, et un graphe interrogeable
pour savoir ce qui est atteignable depuis n'importe quel point. C'est la
base indispensable pour découper le réseau en sections (phase 4) puis
simuler la circulation (phase 8).

---

## Phase 4 — Sections, occupation et signalisation

**Objectif :** découper le réseau en sections avec une limite de vitesse,
un état d'occupation, et des signaux qui réagissent automatiquement à ce
qui se passe autour d'eux. C'est le vocabulaire que JMRI et Rocrail
appellent "blocks" et "signal logic", adapté à un éditeur de plan plutôt
qu'à un pilotage temps réel.

### 4.1 — Modèle de section

- [ ] Type `Section` : `id`, `name`, `segmentIds: SegmentId[]` (suite
      contiguë de segments), `speedLimit`, `permissive: boolean`, `color`
- [ ] Type `Portal` : point de transition entre deux sections, support
      optionnel d'un signal (voir 4.4)
- [ ] Une section regroupe un ou plusieurs segments, elle ne remplace pas
      le graphe de la phase 3, elle l'annote
- [ ] Outil "section" : sélectionner une suite de segments contigus, leur
      assigner un nom et une couleur d'affichage
- [ ] Fusion/scission de sections, redécoupage automatique quand un
      segment est scindé (voir 3.3)
- [ ] Tests : `section.test.ts`

### 4.2 — Vitesse limite par section

- [ ] Champ `speedLimit` par section, affiché en overlay sur le canvas
      (étiquette ou code couleur selon la vitesse)
- [ ] Suggestion automatique de vitesse à la création, dérivée du rayon
      minimum de la section (via `curveRadiusAt`), modifiable à la main
- [ ] Alerte si la vitesse déclarée est incompatible avec le rayon réel de
      la section
- [ ] Cette valeur sera consommée telle quelle par la simulation (phase 8)

### 4.3 — Occupation

- [ ] État `occupied: boolean` par section, purement logiciel, pas de
      capteur réel puisqu'on est dans un éditeur de plan
- [ ] Pendant la simulation (phase 8), un train occupe une ou plusieurs
      sections selon sa position et sa longueur
- [ ] Option `permissive` : autorise plusieurs trains dans la même
      section, sinon la section se réserve pour un seul train à la fois
- [ ] Affichage visuel de l'occupation sur le canvas (surbrillance),
      cohérent avec le rendu des jonctions actives/inactives
- [ ] Tests : `occupancy.test.ts`

### 4.4 — Signaux

- [ ] Type `Signal` : `id`, `portalId`, `direction`, aspects disponibles
      (vert / jaune / rouge, sous-ensemble configurable), aspect courant
- [ ] Pose d'un signal sur un portail existant, orientation dans le sens
      de circulation qu'il protège
- [ ] Logique d'aspect dérivée automatiquement : rouge si la section
      protégée est occupée ou verrouillée par un itinéraire, jaune si la
      section suivante est occupée, vert sinon
- [ ] Recalcul de l'aspect à chaque changement d'occupation ou de position
      d'aiguillage
- [ ] Rendu du signal sur le canvas (icône orientée, couleur d'aspect)
- [ ] Tests : `signal.test.ts`

### 4.5 — Itinéraires et verrouillage

- [ ] Type `Route` : chemin prédéfini entre deux points, liste des
      aiguillages à positionner et des sections à réserver
- [ ] Activation d'un itinéraire : positionne les aiguillages du chemin,
      réserve les sections traversées, refuse si une section est déjà
      prise par un autre itinéraire actif (verrouillage simple)
- [ ] Libération automatique de l'itinéraire une fois le train passé, en
      simulation
- [ ] Tests : `route.test.ts`

**Livrable :** un réseau découpé en sections avec vitesse limite,
occupation simulée, signaux automatiques et itinéraires verrouillables.
Base directe pour une simulation de circulation réaliste.

---

## Phase 5 — Édition riche

**Objectif :** édition confortable, construction d'un réseau complet.

- [ ] Multi-sélection : Shift+clic, rectangle de sélection, Ctrl+A
- [ ] Déplacement d'un nœud unique ou d'un groupe (connexions suivent,
      y compris à travers les jonctions de la phase 3)
- [ ] Annuler / refaire : stack d'états, Ctrl+Z / Ctrl+Shift+Z, limite 50
- [ ] Copier / coller (Ctrl+C/V), dupliquer (Ctrl+D), y compris des
      groupes contenant des jonctions
- [ ] Raccourcis : `V` select, `N` nœud, `C` courbe, `S` aiguillage,
      `T` bascule jonction, `Suppr`
- [ ] `G` toggle snap grille, `F` fit-to-view
- [ ] Hit-test avec marge de tolérance
- [ ] Tests : `history.test.ts`, `selection.test.ts`

**Livrable :** édition fluide d'un réseau complet.

---

## Phase 6 — Persistance et export

**Objectif :** le travail est sauvegardé et exportable.

- [ ] Sauvegarde automatique en `localStorage` (debounce 1s)
- [ ] Restauration au chargement de l'app
- [ ] Import / export JSON du réseau complet, format versionné, incluant
      les jonctions, les sections, les signaux et leur état
- [ ] Drag-and-drop de fichier JSON
- [ ] Export SVG (rails uniquement) et PNG (rendu canvas)
- [ ] Nom du projet persistant, indicateur "modifications non sauvegardées"
- [ ] Tests : `persist.test.ts` (round-trip complet, jonctions incluses)

**Livrable :** sauvegarde fiable + export multi-format.

---

## Phase 7 — UI et ergonomie

**Objectif :** interface complète, utilisable sur desktop et mobile.

Itération 1 (TopBar, ToolBar, SidePanel, StatusBar, MiniMap, thèmes, export)
déjà livrée. Reste à faire :

- [ ] Raccourcis clavier configurables
- [ ] Support mobile / touch : pinch-to-zoom, pan à un doigt, tap pour
      placer/sélectionner, barre d'outils adaptée (bottom dock)
- [ ] Panneau propriétés pour les jonctions dans SidePanel (numéro de
      talon, sens, branche active, longueur de chaque branche)
- [ ] Panneau propriétés pour les sections (nom, couleur, vitesse limite,
      permissive) et pour les signaux (aspect courant, direction)
- [ ] Tests : `keymap.test.ts`

**Livrable :** interface desktop professionnelle, utilisable au doigt sur
tablette.

---

## Phase 8 — Fonctions avancées

**Objectif :** aller plus loin, s'appuyer sur la topologie (phase 3) et sur
les sections/signaux (phase 4).

- [ ] Simulation de circulation : un train suit les rails à vitesse
      paramétrable, plafonnée par `speedLimit` de la section traversée,
      respecte la branche active de chaque jonction (réutilise `findPath`
      et `reachableFrom`), s'arrête sur signal rouge, réserve et libère les
      sections qu'il occupe, sens bidirectionnel, plusieurs trains
      simultanés avec verrouillage mutuel des sections non permissives
- [ ] Mesures automatiques : longueur par segment, angle, rayon, longueur
      totale du réseau, nombre de jonctions, nombre de sections
- [ ] Calques (layers) : nommés, visibilité on/off, verrouillage
- [ ] Bibliothèque de gabarits : sauvegarder un bout de réseau (jonctions
      et sections incluses) comme gabarit réutilisable par glisser-déposer
- [ ] Règles de validation : rayon de courbure minimum, pente maximum,
      conflits de croisement, nœuds orphelins, jonctions mal alignées,
      sections sans limite de vitesse cohérente
- [ ] Annotations : texte libre, marqueurs, cotes manuelles
- [ ] Élévation / terrain (optionnel, gros scope) : axe Z, vue en coupe,
      heightmap en arrière-plan

**Livrable :** éditeur de rails complet avec simulation.

---

## Phase 9 — Finition produit

**Objectif :** passer d'un éditeur fonctionnel à un produit qu'on peut
livrer et montrer à quelqu'un d'autre sans l'accompagner.

- [ ] État vide soigné au premier lancement (pas un canvas nu et muet)
- [ ] Tutoriel interactif court ou tour guidé des outils
- [ ] Messages d'erreur et de blocage compréhensibles (ex : "aiguillage non
      connecté", "rayon inférieur au minimum")
- [ ] Performance : redraw incrémental ou index spatial pour le hit-test
      sur les grands réseaux (mentionné dans les principes techniques)
- [ ] Responsive complet, y compris tablette
- [ ] Documentation utilisateur courte (raccourcis, cycle de vie d'un
      projet, export)
- [ ] Icône, favicon, métadonnées de page soignées
- [ ] Revue d'accessibilité de base (contraste, focus clavier sur les menus)
- [ ] Build de production testé (npm run build) sans warning TypeScript

**Livrable :** un produit fini, prêt à être utilisé ou montré sans réserve.

---

## Principes techniques

- **Rendu** : Canvas 2D, pas de lib tierce. RAF loop pour la simulation,
  redraw à la demande pour l'édition.
- **État** : refs pour la caméra (muté hors React), state React pour la
  sélection et l'outil actif. Le réseau vit dans un ref + système de
  subscribe, comme `EditorStore`.
- **Topologie** : le réseau reste un seul graphe (`Network`). Une jonction
  est un nœud avec une règle de traversée en plus, pas une structure à part.
  Le pathfinding de la phase 3 et la simulation de la phase 8 s'appuient
  sur le même graphe.
- **Signalisation** : les sections, signaux et itinéraires (phase 4)
  annotent le graphe, ils ne le dupliquent pas. Une section référence des
  `segmentIds` existants, un signal référence un `Portal` existant.
- **Tests** : Vitest, logique pure isolée dans `src/core/`, pas de tests
  sur le canvas.
- **Structure des dossiers** :
  - `src/core/` — modèle de données, logique pure (network, types, history,
    persist, pathfinding, signaling)
  - `src/render/` — camera, renderer, palette
  - `src/ui/` — composants React
- **Pas de dépendance externe** au-delà de React. Pas de state management lib.
- **Performance** : redraw incrémental si le réseau devient large (dirty
  regions ou index spatial pour le hit-test).
