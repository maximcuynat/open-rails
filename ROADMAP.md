# Roadmap — open-rails

> Éditeur de rails sur canvas infini.
> Stack : React 18 + TypeScript + Vite 5 + Vitest.
> Dev server : `http://localhost:8900/`

## État actuel

| Composant                                                            | Statut |
| -------------------------------------------------------------------- | ------ |
| Scaffolding projet (Vite, TS, React)                                 | Fait   |
| Serveur dev port 8900                                                | Fait   |
| Canvas infini (pan + zoom cursé)                                     | Fait   |
| Grille adaptive (minor/major) déconnectée de la géométrie rail       | Fait   |
| Barre d'échelle adaptative en mm / m                                  | Fait   |
| HUD (zoom + coordonnées caméra)                                      | Fait   |
| Thèmes light / dark / auto (variables CSS dédiées)                   | Fait   |
| Modèle de données (Point, RailNode, Segment, Network)                | Fait   |
| Continuité tangentielle G1 stricte (10⁻⁵) entre coupons              | Fait   |
| Géométrie Bézier quadratique exacte ($R \tan(\theta/2)$)             | Fait   |
| Snapping magnétique intelligent (tolérance 16 px, priorité absolue)  | Fait   |
| Bouclage automatique de réseau (Loop Closure sans doublons de nœuds) | Fait   |
| Prolongement naturel depuis toute extrémité de rail                  | Fait   |
| Nettoyage automatique des nœuds orphelins lors de la suppression     | Fait   |
| Rendu HO 1:87 réaliste (ballast 32mm chanfreiné, traverses 2.8×26mm) | Fait   |
| Détection visuelle des extrémités libres (anneaux de snap dédiés)     | Fait   |
| Palette des voies (TrackPalette) 100% vectorielle SVG (0 emoji)      | Fait   |
| Mode Catalogue Kato HO (longueurs 60–369mm, rayons R430–R867, angles) | Fait   |
| Mode Voie Libre 100% (courbes flexibles continues, décalquage)       | Fait   |
| Déplacement libre des nœuds et intersections à la souris             | Fait   |
| Sélection multiple (rectangle de sélection + Shift+clic + Ctrl+A)    | Fait   |
| Suppression complète (`Delete` / `Backspace` / panneau latéral)      | Fait   |
| Barre d'outils avec icônes ferroviaires techniques (V, N, C, H)      | Fait   |
| Barre d'état avec sélecteur de mode et états d'accrochage            | Fait   |
| Raccourcis clavier (V, N, C, H, G, F, M, Tab, [, ], Del, Esc, Ctrl+0) | Fait   |
| MiniMap vectorielle synchronisée avec le viewport réel               | Fait   |
| Panneau latéral SidePanel avec conversion métrique (mm / m)          | Fait   |
| Export JSON / SVG (boîte englobante avec `via`) / PNG                | Fait   |
| Tests unitaires (100 tests Vitest, 100% passants)                    | Fait   |

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

- [x] Rail courbe en Bézier quadratique, avec `via` exact tangentiel ($R \tan(\theta/2)$)
- [x] Outil courbe (preview en direct, accrochage magnétique, fermeture de boucle)
- [x] Hit-testing et rendu détaillé/simplifié des courbes
- [x] Profils Kato Unitrack (R430 à R867 mm, angles 15° à 45°)
- [x] Continuité tangente G1 automatique entre segments chaînés ($10^{-5}$)
- [x] Mode Voie Libre 100% (`computeFreeformCurve`, flex track continue, décalquage)
- [x] Palette de sélection interactive (`TrackPalette.tsx`) 100% vectorielle SVG
- [x] 100 tests unitaires au total (Vitest)

**Livrable :** les rails s'enchaînent avec continuité tangente parfaite, soit au standard rigide Kato, soit en tracé flexible 100% libre.

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

- [ ] Outil **aiguillage** dans la barre d'outils et la palette, gabarit sélectionnable
- [ ] Pose sur du vide : place la jonction avec ses trois branches
- [ ] Pose sur une voie existante : le segment visé est découpé en deux, la
      jonction s'insère au point de découpe (style XTrackCAD)
- [ ] Alignement assisté : surbrillance magnétique des extrémités compatibles
- [ ] Refus de connexion si l'angle entre les deux voies dépasse une
      tolérance réglable (évite les jonctions vrillées)

### 3.3 — Édition libre des intersections

- [x] Déplacer un nœud partagé par plusieurs segments déplace tous les
      segments connectés en temps réel (`isDraggingNode`)
- [x] Nettoyage automatique des nœuds orphelins lors de la suppression d'un rail
- [x] Affichage dédié des extrémités non connectées (anneaux de snap vert/accentué)
- [ ] Fusionner deux nœuds proches en un seul point de jonction (souder)
- [ ] Scinder un segment existant en cliquant dessus avec l'outil place
- [ ] Convertir un croisement de deux voies en jonction réelle
- [ ] Retourner une jonction (flip gauche/droite) sans la replacer
- [ ] Tests : `junction-edit.test.ts` (fusion, scission, déplacement en cascade)

### 3.4 — Rendu et bascule des aiguillages

- [ ] Branche active dessinée pleine, branche inactive en pointillé ou
      grisée
- [ ] Clic sur la jonction ou touche `T` (jonction sélectionnée) : bascule
      `activeBranch`
- [ ] Animation courte de la transition (lerp visuel)
- [ ] Icône directionnelle dans le SidePanel quand une jonction est
      sélectionnée (numéro de talon, sens, branche active)

### 3.5 — Détection de chemins

- [ ] Fonction `findPath(net, fromNodeId, toNodeId)` : parcours du graphe en
      largeur, respecte `activeBranch` de chaque jonction traversée
- [ ] Fonction `reachableFrom(net, nodeId)` : ensemble des nœuds atteignables
- [ ] Surlignage du chemin entre deux points sélectionnés
- [ ] Détection des voies orphelines et boucles fermées
- [ ] Tests : `pathfinding.test.ts`

**Livrable :** un réseau avec aiguillages fonctionnels, des jonctions
éditables comme n'importe quel autre élément, et un graphe interrogeable
pour savoir ce qui est atteignable depuis n'importe quel point.

---

## Phase 4 — Sections, occupation et signalisation

**Objectif :** découper le réseau en sections avec une limite de vitesse,
un état d'occupation, et des signaux automatiques.

### 4.1 — Modèle de section
- [ ] Type `Section` : `id`, `name`, `segmentIds: SegmentId[]`, `speedLimit`, `permissive: boolean`, `color`
- [ ] Type `Portal` : point de transition entre deux sections, support optionnel d'un signal
- [ ] Outil "section" et gestion fusion/scission
- [ ] Tests : `section.test.ts`

### 4.2 — Vitesse limite par section
- [ ] Champ `speedLimit` par section avec overlay
- [ ] Suggestion automatique dérivée du rayon minimum de la section

### 4.3 — Occupation
- [ ] État `occupied: boolean` par section (simulation)
- [ ] Surbrillance visuelle de l'occupation sur le canvas

### 4.4 — Signaux
- [ ] Type `Signal` : aspects vert / jaune / rouge
- [ ] Calcul d'aspect automatique selon occupation et position d'aiguillage

### 4.5 — Itinéraires et verrouillage
- [ ] Type `Route` et réservation d'itinéraires

---

## Phase 5 — Édition riche

**Objectif :** édition confortable, construction d'un réseau complet.

- [x] Multi-sélection : Shift+clic, rectangle de sélection (box select), Ctrl+A
- [x] Déplacement d'un nœud unique ou d'un groupe à la souris (les voies suivent)
- [x] Raccourcis complets : `V` select, `N` droite, `C` courbe, `H` pan, `G` snap grille, `F` fit, `M` mode libre/kato, `Tab` côté courbe, `[` `]` rayon, `Suppr`
- [x] Hit-test tolérant (14px nœuds, 12px segments, 16px snap magnétique)
- [ ] Annuler / refaire : stack d'états, Ctrl+Z / Ctrl+Shift+Z, limite 50
- [ ] Copier / coller (Ctrl+C/V), dupliquer (Ctrl+D)
- [ ] Tests : `history.test.ts`, `selection.test.ts`

---

## Phase 6 — Persistance et export

**Objectif :** le travail est sauvegardé et exportable.

- [x] Export SVG (avec boîtes englobantes incluant les points `via`)
- [x] Export PNG (rendu haute définition canvas)
- [x] Export JSON du réseau
- [x] Nom du projet éditable et indicateur de modifications (`dirty`)
- [ ] Sauvegarde automatique en `localStorage` (debounce 1s)
- [ ] Restauration automatique au chargement
- [ ] Import JSON par menu et drag-and-drop de fichier
- [ ] Tests : `persist.test.ts`

---

## Phase 7 — UI et ergonomie

**Objectif :** interface complète, utilisable sur desktop et tactile.

- [x] TopBar avec menu complet (Fichier, Édition, Affichage, Aide)
- [x] ToolBar verticale avec icônes ferroviaires vectorielles SVG
- [x] Palette flottante TrackPalette 100% SVG (0 emoji) : bascule Catalogue Kato / Voie Libre, coupons droits et courbes
- [x] SidePanel avec conversion métrique mm/m et suppression sécurisée
- [x] StatusBar avec indicateurs d'état et raccourcis
- [x] MiniMap vectorielle synchronisée avec le viewport
- [x] Thèmes light / dark / auto
- [ ] Raccourcis clavier configurables
- [ ] Support mobile / touch (pinch-to-zoom, pan tactile)
- [ ] Panneau propriétés pour les jonctions et aiguillages dans SidePanel

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

## Architecture logicielle

Cette section décrit l'organisation cible, existant et à venir. Le détail
module par module de l'existant reste dans `DESCRIPTION.md` ; ici, on garde
la vue d'ensemble et on situe où va chaque nouvelle brique du roadmap.

### Principes

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
- **Pas de dépendance externe** au-delà de React. Pas de state management lib.
- **Performance** : redraw incrémental si le réseau devient large (dirty
  regions ou index spatial pour le hit-test).

### Arborescence cible

```
src/
├── core/                     # logique pure, sans dépendance React
│   ├── types.ts              # Point, RailNode, Segment, Network (existant)
│   ├── network.ts            # CRUD graphe, snapping, hit-testing (existant)
│   ├── curve.ts               # géométrie Bezier quadratique (existant)
│   ├── tangent.ts             # continuité G1, arc ↔ Bezier (existant)
│   ├── profiles.ts            # catalogue Kato Unitrack HO (existant)
│   ├── junction.ts            # phase 3.1 — type Junction, branches, gabarits
│   ├── junction-edit.ts       # phase 3.3 — fusion, scission, déplacement en cascade
│   ├── pathfinding.ts         # phase 3.5 — findPath, reachableFrom
│   ├── section.ts             # phase 4.1/4.2 — type Section, Portal, vitesse
│   ├── occupancy.ts           # phase 4.3 — état occupied, réservation
│   ├── signal.ts              # phase 4.4 — type Signal, calcul d'aspect
│   ├── route.ts               # phase 4.5 — type Route, verrouillage
│   ├── history.ts             # phase 5 — undo/redo
│   ├── persist.ts             # phase 6 — sauvegarde/restauration JSON
│   └── *.test.ts              # un fichier de test par module ci-dessus
├── render/                   # rendu Canvas, sans dépendance React
│   ├── camera.ts             # caméra + transformations screen ↔ world (existant)
│   └── renderer.ts           # grille, rails, traverses, ballast (existant)
│       # + rendu jonctions (3.4), sections (4.1), signaux (4.4)
└── ui/                        # composants React
    ├── store.ts               # EditorStore, état mutable + subscribe (existant)
    ├── Canvas.tsx              # <canvas> + interactions (existant)
    ├── CanvasOverlay.tsx        # aide contextuelle (existant)
    ├── SidePanel.tsx            # panneau propriétés (existant, à étendre
    │                             # avec JunctionPanel, SectionPanel, SignalPanel)
    ├── ToolBar.tsx, TopBar.tsx, StatusBar.tsx, MiniMap.tsx, Menu.tsx (existant)
    └── useKeyboardShortcuts.ts  # raccourcis globaux (existant)
```

**Règle de placement :** toute nouvelle logique de graphe (jonctions,
sections, chemins, signaux) va dans `src/core/`, testée en isolation, sans
toucher au rendu. Le rendu de ces nouveaux objets s'ajoute à
`renderer.ts`, pas dans de nouveaux fichiers de rendu séparés, pour garder
un seul pipeline de dessin. Les nouveaux panneaux du `SidePanel` suivent le
même pattern dispatcher que l'existant : un composant par type d'objet
sélectionné.

- **Pas de dépendance externe** au-delà de React. Pas de state management lib.
- **Performance** : redraw incrémental si le réseau devient large (dirty
  regions ou index spatial pour le hit-test).
