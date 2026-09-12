# DESCRIPTION — Rail-Editor

> Référence développeur complète pour Claude (ou tout assistant IA) afin de
> comprendre comment le projet **rail-editor** fonctionne de bout en bout.

---

## 1. Qu'est-ce que rail-editor ?

**rail-editor** est une application web (React 18 + TypeScript) qui permet de
**dessiner des réseaux de trains miniatures à l'échelle HO** sur un canevas
infini. L'utilisateur place des morceaux de rail (droits et courbes) issus du
catalogue **Kato Unitrack HO**, le logiciel assure la **continuité tangentielle
G1** entre segments, et peut exporter le réseau en JSON / SVG / PNG.

Le projet est volontairement minimaliste côté dépendances : **aucune librairie
de rendu tierce** (pas de Three.js, PixiJS, ou Konva). Tout le rendu se fait via
l'**API Canvas 2D** native du navigateur. La gestion d'état est également
maison : un `EditorStore` mutable couplé à `useSyncExternalStore`.

---

## 2. Stack technique

| Couche | Technologie |
|---|---|
| Framework | React 18.3 (`StrictMode`) |
| Build | Vite 5.4 (`base: './'`, port 8900) |
| Langage | TypeScript 5.6 (strict, ES2022, `verbatimModuleSyntax`) |
| Rendu | Canvas 2D (aucune lib tierce) |
| Police | `@fontsource/archivo` (400 / 600 / 800) |
| Tests | Vitest |
| Dépendances runtime | `react`, `react-dom`, `@fontsource/archivo` uniquement |

---

## 3. Structure des fichiers

```
rail-editor/
├── index.html                  # Point d'entrée HTML (#root)
├── vite.config.ts              # Config Vite (base './', port 8900)
├── tsconfig.json               # TS strict, ES2022, bundler resolution
├── package.json                # v0.0.1
├── ROADMAP.md                   # Roadmap 7 phases (FR), Phases 0-2 + UI done
├── HO.md                        # Base de connaissances échelle HO (Kato Unitrack)
├── DESCRIPTION.md              # ← Ce fichier
└── src/
    ├── main.tsx                # Montage React dans #root
    ├── App.tsx                 # Layout racine + thème + fit-view
    ├── styles.css              # Thèmes CSS (light/dark/auto) + layout grid
    ├── env.d.ts                # Déclarations de types globaux
    ├── core/                    # Logique pure (aucune dépendance React)
    │   ├── types.ts            # Modèle de données (Node, Segment, Network)
    │   ├── network.ts          # CRUD graphe, snapping, hit-testing
    │   ├── curve.ts            # Géométrie Bezier quadratique
    │   ├── tangent.ts          # Continuité G1, conversion arc ↔ Bezier
    │   ├── profiles.ts         # Catalogue Kato Unitrack HO + snapping pièces
    │   ├── curve.test.ts       # Tests courbes
    │   ├── network.test.ts     # Tests réseau
    │   ├── profiles.test.ts    # Tests profils
    │   └── tangent.test.ts     # Tests tangentes
    ├── render/                  # Rendu Canvas (aucune dépendance React)
    │   ├── camera.ts           # Caméra + transformations screen ↔ world
    │   └── renderer.ts         # Grille, rails, traverses, ballast, échelle
    └── ui/                      # Composants React
        ├── store.ts            # EditorStore (singleton mutable + subscribe)
        ├── Canvas.tsx          # <canvas> + handlers pointer/wheel + draw()
        ├── CanvasOverlay.tsx   # Textes d'aide + badge phase courbe
        ├── SidePanel.tsx       # Panneau propriétés contextuel (droite)
        ├── ToolBar.tsx         # Barre d'outils verticale (gauche)
        ├── TopBar.tsx          # Nom projet, menus, thème, exports
        ├── StatusBar.tsx       # Barre de statut (bas)
        ├── MiniMap.tsx         # Mini-carte (optionnelle)
        ├── Menu.tsx            # Primitives de menu déroulant
        └── useKeyboardShortcuts.ts  # Raccourcis clavier globaux
```

---

## 4. Architecture & flux de données

```
┌─────────────────────────────────────────────────────────┐
│ TopBar (nom, menus, thème, exports)                     │
├──────┬──────────────────────────────┬───────────────────┤
│Tool- │                              │                   │
│ Bar  │     Canvas (rendu 2D)         │   SidePanel       │
│      │     + CanvasOverlay (hints)   │   (contextuel)    │
│      │     + MiniMap (optionnel)     │                   │
├──────┴──────────────────────────────┴───────────────────┤
│ StatusBar (outil, coords, zoom, snap/grid)               │
└─────────────────────────────────────────────────────────┘
```

### Flux de données

```
Entrée utilisateur (pointer / wheel / clavier)
    │
    ▼
Canvas.tsx (handlers pointerdown / move / up / wheel)
    │   getWorldPos() → snapToGrid()
    │   hitNode() / hitSegment()
    │
    ▼
EditorStore (singleton mutable)
    ├── network: Network   (nodes Map, segments Map, adjacency Map)
    ├── camera: Camera      (x, y, scale)
    ├── selection: Selection (nodes Set, segments Set)
    ├── tool, snap, curveState, curveProfileIdx, curveSide, ...
    │
    ├── store.notify()  →  version++  →  listeners (panels React re-render)
    │
    ▼
Canvas.draw() (impératif, pas de React reconciliation)
    ├── renderGrid()          ← camera
    ├── renderNetwork()       ← network + selection
    ├── renderSnapIndicator() ← snappedCursor
    ├── renderPlacePreview()  ← lastNodeId + cursor + outgoingTangent
    ├── renderCurvePreview()  ← curveState + CURVE_RADII + computeCurvePiece
    └── renderScaleBar()      ← camera
```

**Décision de design clé :** L'état critique pour le rendu (caméra, réseau)
vit dans des champs mutables ordinaires, **hors du cycle de reconciliation
React**, pour des performances maximales. Les panels React se ré-affichent via
un compteur de version (`useSyncExternalStore`). Le canevas se redessine de
façon impérative via `draw()`.

---

## 5. Modèle de données (`src/core/types.ts`)

```typescript
type NodeId = string
type SegmentId = string

interface Point { x: number; y: number }

interface RailNode {
  id: NodeId
  pos: Point
}

type SegmentKind = 'straight' | 'curve'

interface Segment {
  id: SegmentId
  from: NodeId
  to: NodeId
  kind: SegmentKind
  via?: Point   // Point de contrôle Bezier (courbes uniquement)
}

interface Network {
  nodes: Map<NodeId, RailNode>
  segments: Map<SegmentId, Segment>
  adjacency: Map<NodeId, SegmentId[]>  // node → segments connectés
}

interface Selection {
  nodes: Set<NodeId>
  segments: Set<SegmentId>
}
```

**Points importants :**
- Le `Network` utilise des `Map` (pas des tableaux) pour des lookups O(1).
- Les segments sont **non orientés** (l'adjacence est stockée sur les deux
  extrémités `from` et `to`).
- Toutes les coordonnées sont en **mm modèle** (unités monde à l'échelle HO).
- Les courbes sont des **Bezier quadratiques** définies par les points
  extrêmes `from`, `to` et un point de contrôle `via`.

---

## 6. Module par module

### 6.1 `src/main.tsx` — Point d'entrée

Monte l'app React dans `#root` en `StrictMode`. Importe les polices Archivo et
`styles.css`.

### 6.2 `src/App.tsx` — Composant racine

- Crée l'`EditorStore` **une seule fois** (pattern `useRef` + null-check).
- Subscribe via `useEditorVersion(store)` → re-render sur `store.notify()`.
- Suit la taille du viewport dans un `useState` mis à jour par `Canvas`.
- **Fit-to-view :** écoute l'événement `window` `'rail:fit-view'` (émis par le
  raccourci `F`), appelle `store.fitView(vp.w, vp.h)`.
- **Thème :** `useEffect` lit `store.theme` (`'auto' | 'light' | 'dark'`),
  pose l'attribut `data-theme` sur `<html>`. En `'auto'`, subscribe à
  `matchMedia('(prefers-color-scheme: dark)')`.

Layout en grille CSS :
```
div.app-layout (grid rows: auto 1fr auto)
├── TopBar
├── div.app-middle (grid cols: auto 1fr auto)
│   ├── ToolBar
│   ├── Canvas + CanvasOverlay + MiniMap (conditionnel)
│   └── SidePanel
└── StatusBar
```

### 6.3 `src/core/network.ts` — Graphe de réseau

CRUD sur le `Network`, snapping, et utilitaires de distance / hit-testing.

| Fonction | Signature | Rôle |
|---|---|---|
| `generateId` | `(prefix: string) => string` | Compteur monotone → `prefix_N` |
| `createNetwork` | `() => Network` | Maps vides |
| `addNode` | `(net, pos) => RailNode` | Crée nœud + entrée d'adjacence |
| `addSegment` | `(net, from, to) => Segment \| null` | Segment droit ; null si self-loop |
| `addCurveSegment` | `(net, from, to, via) => Segment \| null` | Segment courbe avec `via` |
| `removeNode` | `(net, id) => void` | Supprime nœud + segments connectés (cascade) |
| `removeSegment` | `(net, id) => void` | Supprime segment + nettoie adjacence |
| `snapToGrid` | `(pos, spacing) => Point` | `round(pos / spacing) * spacing` |
| `dist` | `(a, b) => number` | Distance euclidienne |
| `distToSegment` | `(p, a, b) => number` | Distance point→segment (projection clampée) |
| `hitNode` | `(net, pos, maxDist) => NodeId \| null` | Scan linéaire, plus proche dans le rayon |
| `hitSegment` | `(net, pos, maxDist) => SegmentId \| null` | Scan linéaire ; courbes via `distToCurve` |

**Détails :**
- Les IDs sont générés par un compteur de module (pas d'UUID) : `n_1`, `s_2`, etc.
- `hitSegment` délègue les courbes à `distToCurve` (de `curve.ts`), les droits à
  `distToSegment`.
- Pas d'index spatial — hit-testing en O(n). Le ROADMAP mentionne un index
  spatial comme travail futur.
- `removeNode` cascade : supprime tous les segments connectés et nettoie
  l'adjacence de l'autre extrémité de chaque segment.

### 6.4 `src/core/curve.ts` — Géométrie Bezier quadratique

Toutes les mathématiques des courbes de Bézier quadratiques.

| Fonction | Signature | Description |
|---|---|---|
| `bezierPoint` | `(t, p0, p1, p2) => Point` | `B(t) = (1-t)²P₀ + 2(1-t)tP₁ + t²P₂` |
| `bezierDerivative1` | `(t, p0, p1, p2) => Point` | `B'(t) = 2(1-t)(P₁-P₀) + 2t(P₂-P₁)` |
| `bezierDerivative2` | `(p0, p1, p2) => Point` | `B''(t) = 2(P₂ - 2P₁ + P₀)` (constante) |
| `bezierTangent` | `(t, p0, p1, p2) => Point` | Alias de `bezierDerivative1` |
| `bezierNormal` | `(t, p0, p1, p2) => Point` | Perpendiculaire normalisée à la tangente |
| `curveRadiusAt` | `(t, p0, p1, p2) => number` | `R = |B'|³ / |B'×B''|` ; `Infinity` si droit |
| `minCurveRadius` | `(p0, p1, p2, samples=64) => number` | Échantillonne, retourne le R minimum |
| `clampVia` | `(p0, via, p2, minRadius) => Point` | Recherche binaire (40 it) : ramène `via` vers le milieu de la corde jusqu'à `minCurveRadius ≥ minRadius` |
| `discretizeCurve` | `(p0, via, p2, samples) => Point[]` | N+1 points à `t = 0..1` |
| `curveLength` | `(p0, via, p2, samples=64) => number` | Longueur arc polygonale |
| `curveSamples` | `(p0, via, p2, pxPerUnit) => number` | Adaptatif : `clamp(8, 512, ceil(pxLen/4))` |
| `distToCurve` | `(p, p0, via, p2, samples=32) => number` | Distance min à la polyligne discrétisée |

**Algorithme `clampVia` :**
```
1. midpoint = milieu de la corde [p0, p2]
2. Si minCurveRadius actuel ≥ minRadius → retourner via tel quel
3. Recherche binaire sur f ∈ [0, 1] :
   via' = lerp(via, midpoint, f)
   Si minCurveRadius(via') ≥ minRadius : hi = f
   Sinon : lo = f
4. Retourner lerp(via, midpoint, hi)
```
Cela ramène le point de contrôle vers la corde (rectilignifiant la courbe)
jusqu'à ce que la contrainte de rayon minimum soit satisfaite.

### 6.5 `src/core/tangent.ts` — Continuité G1 & géométrie d'arc

Continuité tangentielle G1 entre segments et conversion arc circulaire ↔ Bezier.

| Fonction | Signature | Description |
|---|---|---|
| `bezierStartTangent` | `(start, via) => Point` | Normalisé `(via - start)` — tangente en t=0 |
| `bezierEndTangent` | `(via, end) => Point` | Normalisé `(end - via)` — tangente en t=1 |
| `segmentTangentAt` | `(net, seg, nodeId) => Point \| null` | Tangente sortante au nœud pour un segment. Si `nodeId === seg.from` : tangente de départ. Si `nodeId === seg.to` : tangente d'arrivée. Droits : direction `from→to`. |
| `outgoingTangent` | `(net, nodeId, excludeSegId?) => Point \| null` | Trouve le premier segment adjacent (excluant `excludeSegId`), retourne sa tangente à ce nœud. Utilisé pour déterminer la direction entrante lors du chaînage. |
| `viaFromArc` | `(start, end, incomingDir) => Point` | Calcule le point de contrôle Bezier pour un arc circulaire partant de `start` avec tangente `incomingDir` et passant par `end` |
| `arcRadius` | `(start, end, incomingDir) => number` | `R = corde / (2·sin(α))` où α = angle tangente-corde |
| `arcDeflectionDeg` | `(start, end, incomingDir) => number` | Déflexion totale = `2α` en degrés |
| `viaFromTwoTangents` | `(start, end, incomingDir, outgoingDir) => Point` | G1 aux deux extrémités : résout `P₁ = P₀ + k·in = P₂ - m·out` par règle de Cramer |

**Algorithme `viaFromArc` (arc circulaire → Bezier) :**
```
1. chord = end - start, chordDir = normalize(chord)
2. α = atan2(cross(in, chordDir), dot(in, chordDir))  // angle tangente-corde (signé)
3. Si |α| < 1e-4 : retourner le milieu (droit)
4. endTangentDir = rotate(chordDir, α)  // angle tangent final = θ + 2α
5. Résoudre : start + t·incomingDir = end + s·endTangentDir (règle de Cramer)
6. Retourner start + t·incomingDir
```

**Algorithme `viaFromTwoTangents` (G1 aux deux extrémités) :**
```
1. P₁ = start + k·incomingDir = end - m·outgoingDir
2. Système :
   | in.x  out.x | |k|   | end-start |
   | in.y  out.y | |m| = | end-start |
3. Règle de Cramer → k = (rx·out.y - ry·out.x) / det
4. Retourner start + k·incomingDir
5. Si det ≈ 0 (tangentes parallèles) : fallback vers viaFromArc
```

### 6.6 `src/core/profiles.ts` — Catalogue Kato Unitrack HO

Encode le catalogue de produits Kato Unitrack HO — rayons de courbe standards,
longueurs droites, angles — plus le snapping et le calcul de pièces.

**Constantes :**

```typescript
const CURVE_RADII: number[] = [
  430, 490, 550, 610, 670, 730, 790, 867, Infinity
  // R430..R867, puis "droit" (Infinity)
]
const STRAIGHT_LENGTHS: number[] = [
  60, 94, 109, 114, 123, 149, 174, 227, 246, 369  // mm
]
const CURVE_ANGLES: number[] = [22.5, 10]  // 867mm = 10°, autres = 22.5°
```

| Fonction | Signature | Description |
|---|---|---|
| `radiusToAngle` | `(radius) => number` | 867 → 10°, sinon 22.5° |
| `snapStraightLength` | `(rawLength) => number` | Longueur droite standard la plus proche |
| `computeCurvePiece` | `(start, tangent, radius, side) => { end, via, angle }` | Calcule le point final + via Bezier pour une pièce de courbe standard |
| `computeStraightPiece` | `(start, direction, length) => Point` | `start + direction · length` |
| `radiusFromSagitta` | `(chord, sagitta) => number` | `R = (h² + (L/2)²) / (2h)` |
| `snapRadius` | `(rawRadius) => number` | Rayon standard le plus proche ; `Infinity` si > 1.5× le plus grand fini |
| `arcToVia` | `(start, end, radius, side) => Point` | Point de contrôle Bezier depuis corde + sagitta |

**Algorithme `computeCurvePiece` :**
```
1. angle = radiusToAngle(radius)     // 22.5° ou 10°
2. chord = 2·R·sin(angle/2)
3. chordDir = rotate(tangent, ±angle/2)  // ±side
4. end = start + chordDir · chord
5. via = arcToVia(start, end, radius, side)
```

**Algorithme `arcToVia` (corde + sagitta → point de contrôle) :**
```
1. mid = midpoint(start, end)
2. Si radius = Infinity : retourner mid (droit)
3. sagitta = R - √(R² - (L/2)²)
4. normal = perpendiculaire à la corde (normalisée)
5. via = mid + normal · sagitta · side
```

**Interface :** `CurveProfile { radius: number; label: string }` — tableau
dérivé `CURVE_PROFILES` avec labels comme `"R430"`, `"Straight"`.

### 6.7 `src/render/camera.ts` — Caméra

```typescript
interface Camera {
  x: number     // coord monde au centre du viewport
  y: number
  scale: number // pixels par unité monde (px/mm)
}
```

| Fonction | Signature | Description |
|---|---|---|
| `createCamera` | `(x=0, y=0, scale=1) => Camera` | Fabrique |
| `clampScale` | `(scale) => number` | `clamp(0.02, 64)` |
| `viewSpan` | `(cam, vw) => number` | `vw / cam.scale` — unités monde sur la largeur |
| `screenToWorld` | `(cam, px, py, vw, vh) => Point` | Conversion écran → monde |

**Formule de transformation** (utilisée partout) :
```
screenX = (worldX - cam.x) · cam.scale + vw/2
```

### 6.8 `src/render/renderer.ts` — Rendu Canvas

Tout le dessin Canvas 2D : grille, rails (détaillé + simplifié), traverses,
ballast, barre d'échelle.

**Constantes (échelle HO, mm modèle) :**

```typescript
const GAUGE = 16.5           // écartement des rails (standard HO)
const SLEEPER_SPACING = 25   // mm entre traverses
const SLEEPER_LENGTH = 22    // mm
const SLEEPER_WIDTH = 2.5    // mm
const RAIL_WIDTH = 1.0       // mm (Code 83)
const SIMPLIFY_THRESHOLD = 2 // px/mm — en dessous, rendu ligne simple
const MIN_RADIUS = 380       // mm (minimum HO)
```

**`pickSpacing(scale) => number`** — Espacement de grille adaptatif. Cible
~60px par cellule, arrondit à 1/2/5 × 10^n :
```
target = 60 / scale
power = floor(log10(target))
base = target / 10^power
step = base < 1.5 ? 1 : base < 3.5 ? 2 : base < 7.5 ? 5 : 10
return step × 10^power
```

**Fonctions de rendu :**

- **`renderGrid(ctx, cam, vw, vh)`** — Fond, lignes mineures, lignes majeures
  (toutes les 5), croix à l'origine. Couleurs via variables CSS (`--paper`,
  `--grid`, `--grid-major`).

- **`renderNetwork(ctx, cam, vw, vh, net, selection)`** — Itère tous les
  segments :
  - Si `cam.scale < SIMPLIFY_THRESHOLD` (2px/mm) : dessine une ligne simple /
    `quadraticCurveTo`, largeur 2px.
  - Sinon : délègue à `renderDetailedRail` ou `renderDetailedCurve`.
  - Dessine les nœuds par-dessus (cercle + point interne), culling hors écran.

- **`renderDetailedRail(ctx, cam, a, b, ...)`** — Rail droit détaillé :
  1. Calcule le vecteur perpendiculaire `n` à la direction du rail.
  2. Décale deux rails de ±GAUGE/2.
  3. Dans l'espace canvas rotaté : dessine le rectangle de ballast + les
     traverses (rectangles à intervalles SLEEPER_SPACING).
  4. Dessine deux rails parallèles (RAIL_WIDTH × scale px de large).
  5. Si sélectionné : surbrillance couleur accent (30% alpha, +4px plus large).

- **`renderDetailedCurve(ctx, cam, p0, via, p2, ...)`** — Rail courbé détaillé :
  1. `discretizeCurve` en N échantillons (adaptatif via `curveSamples`).
  2. Pour chaque échantillon : calcule `bezierNormal`, décale les rails
     gauche/droite de ±GAUGE/2.
  3. Dessine le ballast comme polygone rempli (rail gauche aller + rail droit
     retour).
  4. Dessine les traverses : pour chaque `t`, pivote le canvas selon l'angle
     normal, dessine un rectangle.
  5. Dessine les polylignes des deux rails.
  6. Si sélectionné : surbrillance accent.

- **`renderScaleBar(ctx, cam, vw, vh)`** — Indicateur d'échelle (bas-droite) :
  1. Cible ~100px → `worldDist = niceNumber(100 / scale)`.
  2. Dessine un fond pill + barre + label (ex. "500mm", "1.5k").

**Helpers privés :** `w2s` (monde→écran), `niceNumber` (1/2/5×10^n),
`formatDistance`, `roundRect`.

### 6.9 `src/ui/store.ts` — Gestion d'état

Singleton mutable central — source de vérité unique pour tout l'état éditeur.

```typescript
type Tool = 'select' | 'place' | 'curve' | 'pan'
type ThemeMode = 'light' | 'dark' | 'auto'
interface CurveState { phase: 0 | 1; startId: string | null }
```

**Champs de la classe `EditorStore` :**

| Champ | Type | Défaut | Description |
|---|---|---|---|
| `network` | `Network` | vide | Le graphe de rails |
| `camera` | `Camera` | `(0, 0, 3)` | Viewport |
| `selection` | `Selection` | Sets vides | Nœuds/segments sélectionnés |
| `tool` | `Tool` | `'place'` | Outil actif |
| `snap` | `boolean` | `true` | Snapping à la grille |
| `showGrid` | `boolean` | `true` | Visibilité grille |
| `lastNodeId` | `string \| null` | `null` | Dernier nœud placé (pour chaînage) |
| `curveState` | `CurveState` | `{phase:0, startId:null}` | État placement courbe (2 clics) |
| `curveProfileIdx` | `number` | `0` | Index dans `CURVE_RADII` |
| `curveSide` | `1 \| -1` | `1` | Direction courbe (gauche/droite) |
| `cursorWorld` | `Point` | `(0,0)` | Position curseur brute |
| `snappedCursor` | `Point` | `(0,0)` | Curseur snapé à la grille |
| `panning` | `boolean` | `false` | En train de panner |
| `moved` | `boolean` | `false` | A dépassé 1px (seuil de drag) |
| `showMinimap` | `boolean` | `false` | Visibilité mini-carte |
| `theme` | `ThemeMode` | `'auto'` | Préférence thème |
| `projectName` | `string` | `'Untitled Network'` | Nom du projet |
| `dirty` | `boolean` | `false` | Changements non sauvegardés |

**Pattern de subscription :**
```typescript
private listeners = new Set<() => void>()
private version = 0
subscribe = (listener) => {
  this.listeners.add(listener)
  return () => this.listeners.delete(listener)
}
getVersion = () => this.version
notify = () => {
  this.version++
  this.listeners.forEach(l => l())
}
```

**Méthodes :** `setTool`, `setSnap`, `toggleSnap`, `toggleGrid`,
`toggleMinimap`, `setTheme`, `cycleTheme`, `setProjectName`, `markDirty`,
`markClean`, `setSelection`, `clearSelection`, `fitView`, `resetZoom`,
`cycleCurveProfile`, `flipCurveSide`.

**`fitView(vw, vh)`** : Calcule la bounding box de tous les nœuds, centre la
caméra, ajuste l'échelle pour tenir avec 10% de marge. Réseau vide → origine à
l'échelle 3.

**`useEditorVersion(store): number`** — Hook utilisant
`useSyncExternalStore(store.subscribe, store.getVersion)`.

### 6.10 `src/ui/Canvas.tsx` — Composant Canvas & Interactions

L'élément `<canvas>`, tous les handlers d'événements pointer/wheel, la boucle
de dessin impérative, et la logique de placement/courbe.

**Fonctions helpers locales :**

- **`renderSnapIndicator(ctx, cam, vw, vh, pos)`** — Croix + anneau à la
  position du curseur snappé (couleur accent).

- **`renderPlacePreview(ctx, cam, vw, vh, start, cursor, incomingTangent)`** —
  Aperçu rail droit :
  1. Direction = `normalize(cursor - start)` ou `incomingTangent` si curseur
     trop proche.
  2. `snappedLen = snapStraightLength(dist)` — snap à la longueur droite Kato
     la plus proche.
  3. `snappedEnd = computeStraightPiece(start, dir, snappedLen)`.
  4. Dessine le marqueur de nœud de départ.
  5. Si zoomé : `renderDetailedRail` à 70% alpha. Sinon : ligne pointillée.
  6. Ligne fantôme du bout snappé au curseur (20% alpha).
  7. Label de longueur : `"${snappedLen}mm"`.

- **`renderCurvePreview(ctx, cam, vw, vh, data)`** — Aperçu courbe :
  1. `{ end, via, angle } = computeCurvePiece(start, incomingTangent, radius, side)`.
  2. `len = curveLength(start, via, end)`.
  3. Dessine le marqueur de départ.
  4. Si zoomé : `renderDetailedCurve` à 50% alpha. Sinon :
     `quadraticCurveTo` pointillé.
  5. Label : `"R{radius} {angle}°  L: {len}mm"`.

**`draw()` (pipeline de rendu, l'ordre compte) :**
```
1. Fond (grille ou remplissage simple)
2. renderNetwork()
3. renderSnapIndicator()     (si snap && outil place/curve)
4. renderPlacePreview()      (si outil place && lastNodeId)
5. renderCurvePreview()      (si curve phase 1 && startId)
6. renderScaleBar()
```

**Handlers d'événements :**

- **`pointerdown` :**
  - **Clic droit (button 2) :** Annule le chaînage + état courbe → `redraw()`.
  - **Molette (button 1) / Shift+gauche / outil pan :** Démarre le panning
    (capture du pointer).
  - **Gauche + outil courbe :**
    - Phase 0 : Hit nœud existant ou création → `curveState = {phase:1, startId}`.
    - Phase 1 : `computeCurvePiece(startNode.pos, incomingTangent, radius, side)`
      → ajoute nœud final + segment courbe → chaîne (le final devient le
      nouveau départ). Si radius = Infinity : place un droit (246mm par défaut).
  - **Gauche + outil place :**
    - Hit nœud existant : si `lastNodeId` existe et diffère, connecte avec un
      segment. `lastNodeId = existing`.
    - Pas de hit + `lastNodeId` : direction = `normalize(cursor - lastNode)`,
      `snapStraightLength(dist)`, `computeStraightPiece` → ajoute nœud +
      segment. Chaîne.
    - Pas de hit + pas de `lastNodeId` : place le nœud de départ.
  - **Gauche + outil select :** Hit nœud → sélectionne. Hit segment →
    sélectionne. Vide → démarre le panning + clear sélection.

- **`pointermove` :** Met à jour `cursorWorld` + `snappedCursor`. Si panning :
  déplace la caméra. Sinon : redraw pour l'aperçu.

- **`pointerup` :** Relâche le panning + capture.

- **`wheel` :** Zoom ancré au curseur :
  ```
  1. worldBefore = screenToWorld(px, py)
  2. cam.scale = clampScale(cam.scale * 1.15^±1)
  3. cam.x/y ajustés pour que worldBefore reste sous le curseur
  4. draw() + notify()
  ```

- **`contextmenu` :** Prévenu (géré dans pointerdown).

### 6.11 `src/ui/CanvasOverlay.tsx` — Aide contextuelle

Textes d'aide non interactifs + badge de phase courbe.

`hintText(store)` retourne des conseils selon l'outil :
- **Place :** chaîne active / premier nœud
- **Curve :** phase 1 (point final) / phase 0 (point de départ)
- **Select :** instructions de sélection
- **Pan :** instructions de drag/scroll

Affiche `phase-badge` (`1/2` ou `2/2`) quand l'outil courbe est actif, et
`canvas-hint` en bas-centre.

### 6.12 `src/ui/SidePanel.tsx` — Panneau propriétés

Panneau droit qui change de contenu selon la sélection.

- **`NetworkPanel(store)`** — Rien de sélectionné :
  - Compte nœuds, segments, répartition droit/courbe, longueur totale.
- **`NodePanel(store, nodeId)`** — Un nœud sélectionné :
  - X/Y éditables (applique sur blur).
  - Liste des segments connectés (cliquables → navigue vers l'autre extrémité).
  - Bouton supprimer.
- **`SegmentPanel(store, segId)`** — Un segment sélectionné :
  - Type, longueur, rayon (`arcRadius`), déflexion (`arcDeflectionDeg`),
    point via.
  - Liste des extrémités (cliquables → sélectionne le nœud).
  - Bouton supprimer.
- **`SidePanel(store)`** — Dispatcher : 1 nœud → NodePanel, 1 segment →
  SegmentPanel, sinon NetworkPanel.

### 6.13 `src/ui/ToolBar.tsx` — Barre d'outils

Barre verticale gauche avec sélecteurs d'outils + boutons de bascule.

| Outil | Raccourci | Groupe | Icône |
|---|---|---|---|
| Select | V | 0 | Curseur flèche |
| Place node | N | 1 | Cercle + marques plus |
| Curve | C | 1 | Arc avec extrémités |
| Pan | H | 2 | Flèches 4 directions |

Séparateurs de groupe insérés quand le groupe change. Après les outils :
bascule snap (G) + bascule grille.

### 6.14 `src/ui/TopBar.tsx` — Barre du haut, menus, exports

Nom du projet (éditable), barre de menus (File/Edit/View/Help), bascule thème,
fonctions d'export.

**Menus :**
- **File :** New (reload), Export JSON, Export SVG, Export PNG
- **Edit :** Undo/Redo (désactivé), Delete, Duplicate (désactivé), Select all
  (désactivé), Clear selection
- **View :** Fit to view (F), Zoom 100% (Ctrl+0), Toggle grid, Toggle snap
  (G), Toggle minimap
- **Help :** Raccourcis clavier (alert dialog)

**Bascule thème :** `store.cycleTheme()` — cycle auto→light→dark→auto. Icône
SVG différente par mode.

**Exports :**
- `exportJSON(store)` : Sérialise le réseau en `{version:1, name, nodes[],
  segments[]}`, déclenche un téléchargement, `markClean()`.
- `exportSVG(store)` : Calcule la bounding box (pad 10mm), génère des paths SVG
  (`M...L...` pour droits, `M...Q...` pour courbes).
- `exportPNG(store)` : Récupère le canvas live via
  `document.querySelector('.canvas-wrap canvas')`, `canvas.toBlob()` →
  téléchargement.
- `download(content, filename, type)` : Crée Blob + anchor + click.

### 6.15 `src/ui/StatusBar.tsx` — Barre de statut

- **Gauche :** label outil + statut contextuel (`toolStatus(store)`).
- **Centre :** bascules snap/grid.
- **Droite :** zoom (`cam.scale.toFixed(2) + 'x'`, cliquable → `resetZoom`) +
  coords curseur `(x, y)` en unités monde.

### 6.16 `src/ui/MiniMap.tsx` — Mini-carte

Mini-carte 160×120px (bas-gauche), montre le réseau + rectangle de viewport,
clic pour naviguer.

Calcule les bounds du réseau (ou centre caméra si vide), ajuste l'échelle pour
tenir avec marge 1.2×. Dessine les segments (courbes discrétisées à 8
échantillons via `bezierPoint`), les nœuds en points 2px, le rectangle de
viewport (stroke accent).

`navigate(e)` : clic/drag convertit coords minimap → coords monde, ajuste
`cam.x/y`, notifie.

### 6.17 `src/ui/Menu.tsx` — Primitives menu déroulant

```typescript
interface MenuItem {
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  separatorAfter?: boolean
}
```

`Menu` — Toggle ouvert/fermé, clic-extérieur + Escape pour fermer, rend le
dropdown. `MenuBar` — Conteneur flex pour plusieurs `Menu`.

### 6.18 `src/ui/useKeyboardShortcuts.ts` — Raccourcis clavier

Handler `keydown` au niveau window. Ignore les événements depuis `<input>`,
`<textarea>`, ou `contentEditable`.

| Touche | Action |
|---|---|
| Delete / Backspace | Supprime tous les nœuds + segments sélectionnés, clear sélection |
| Escape | Reset lastNodeId, curveState, clear sélection |
| V | Outil 'select' |
| N | Outil 'place' |
| C | Outil 'curve' |
| H | Outil 'pan' |
| G | Bascule snap |
| F | Émet événement `window` `'rail:fit-view'` (géré par App) |
| Ctrl+0 / Cmd+0 | `store.resetZoom()` |

---

## 7. Flux d'interaction détaillés

### 7.1 Placement d'un rail droit (outil Place)

```
Clic 1 → addNode(snapped) → lastNodeId = newId
         (pas d'aperçu, lastNodeId était null)
Clic 2 → dir = normalize(cursor - lastNode.pos)
         snappedLen = snapStraightLength(dist)   // plus proche longueur Kato
         endPos = computeStraightPiece(lastNode.pos, dir, snappedLen)
         addNode(endPos) + addSegment(lastNodeId, newId)
         lastNodeId = newId   (chaînage)
Souris move → renderPlacePreview(lastNode.pos, snappedCursor, outgoingTangent)
Clic droit / Esc → lastNodeId = null (fin de chaîne)
```

### 7.2 Placement d'une courbe (outil Curve)

```
Clic 1 (phase 0) → hitNode ou addNode → curveState = {phase:1, startId}
Clic 2 (phase 1) → incoming = outgoingTangent(net, startId)
                   radius = CURVE_RADII[curveProfileIdx]
                   {end, via} = computeCurvePiece(startNode.pos, incoming, radius, side)
                   addNode(end) + addCurveSegment(startId, endId, via)
                   curveState = {phase:1, startId: endId}   (chaînage)
Souris move → renderCurvePreview({start, incomingTangent, radius, side})
Clic droit / Esc → curveState = {phase:0, startId:null}
```

### 7.3 Pan & Zoom

```
Pan : molette / shift+drag / outil pan drag → cam.x/y -= delta/scale
Zoom : wheel → ancré au curseur (le point monde sous le curseur reste fixe)
        facteur = 1.15 (zoom in) ou 1/1.15 (zoom out)
        cam.scale = clamp(0.02, 64, scale * facteur)
```

### 7.4 Sélection & suppression

```
Outil select clic → hitNode → sélectionne nœud / hitSegment → sélectionne segment
Touche Delete → removeNode/removeSegment pour tout dans la sélection → clearSelection
```

---

## 8. Configuration & fichiers de projet

### `index.html`
Point d'entrée Vite standard. Div `#root`, meta `theme-color` pour light/dark,
titre "Open Rail".

### `vite.config.ts`
```typescript
export default defineConfig({
  base: './',           // chemins relatifs (hébergement statique)
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 8900 },
})
```

### `tsconfig.json`
Strict mode, target ES2022, `bundler` module resolution, `react-jsx` transform,
`noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `noEmit`
(typecheck uniquement).

### `package.json`
v0.0.1. Scripts : `dev` (vite), `build` (tsc + vite build), `typecheck`, `test`
(vitest run), `test:watch`.

### `ROADMAP.md`
Roadmap de développement en 7 phases (en français). **Phases 0-2 + itération UI
1 sont complètes.** En attente :
- Phase 3 : aiguillages / turnouts
- Phase 4 : multi-sélection, undo/redo, copier/coller
- Phase 5 : persistance / localStorage
- Phase 6 : mobile / touch
- Phase 7 : simulation, calques, validation, 3D

### `HO.md`
Base de connaissances échelle HO : standards (1:87, écartement 16.5mm), codes
de rail (Code 83 = 2.11mm), catalogues Kato Unitrack HO (droits/courbes/
aiguillages), constantes de rendu, bonnes pratiques (rayon minimum 380mm,
préférer 550+).

---

## 9. Système de thèmes (`src/styles.css`)

Thèmes via variables CSS, layout via CSS grid.

- `:root` — valeurs par défaut light
- `[data-theme='dark']` — overrides dark
- `@media (prefers-color-scheme: dark)` + `:root:not([data-theme])` — dark
  auto quand pas de thème explicite

**Variables CSS clés :** `--ink`, `--paper`, `--grid`, `--grid-major`,
`--panel`, `--panel-2`, `--border`, `--accent`, `--accent-fg`, `--sleeper`,
`--danger`, `--shadow`.

**Layout :** `.app-layout` (grid rows: auto 1fr auto), `.app-middle` (grid
cols: auto 1fr auto). Responsive : panneau latéral caché sous 720px.

---

## 10. Concepts clés à retenir

1. **Tout est en mm modèle HO.** Les coordonnées monde sont des millimètres à
   l'échelle HO. L'échelle de la caméra est en pixels par mm.

2. **Les courbes sont des Bezier quadratiques.** Définies par deux points
   extrêmes et un point de contrôle `via`. La géométrie d'arc circulaire est
   convertie en Bezier via `viaFromArc` ou `arcToVia`.

3. **Continuité G1 au chaînage.** Quand on place un nouveau segment après un
   existant, la tangente sortante du segment précédent (`outgoingTangent`)
   devient la direction entrante du nouveau, assurant une transition lisse.

4. **Snapping au catalogue Kato.** Les longueurs droites sont snappées aux
   longueurs standard Kato (`STRAIGHT_LENGTHS`). Les courbes utilisent les
   rayons standard (`CURVE_RADII`) avec angles de 22.5° ou 10°.

5. **Rendu adaptatif.** Sous 2px/mm, le rendu se simplifie en lignes simples.
   Au-dessus, il dessine le ballast, les traverses, et les doubles rails en
   détail. Le nombre d'échantillons de courbe s'adapte au zoom.

6. **État mutable hors React.** Le `EditorStore` mute directement ses champs
   pour la performance. React ne re-render que les panels (via compteur de
   version), le canvas se redessine impérativement.

7. **Pas d'undo/redo.** Non implémenté (Phase 4 du roadmap). Pas de
   persistance non plus (Phase 5).

8. **IDs séquentiels.** Générés par un compteur de module (`n_1`, `s_2`), pas
   des UUID. Attention : le compteur n'est pas reset au chargement d'un
   réseau exporté (potentielles collisions).

---

## 11. Commandes utiles

```bash
npm run dev          # Démarre le serveur de dev (port 8900)
npm run build        # Typecheck + build de production
npm run typecheck    # Typecheck uniquement
npm run test         # Lance les tests Vitest
npm run test:watch   # Tests en mode watch
```

---

## 12. Améliorations futures connues (ROADMAP)

| Phase | Statut | Contenu |
|---|---|---|
| 0 | ✅ Done | Setup projet, types, réseau de base |
| 1 | ✅ Done | Géométrie courbes, tangentes, catalogue |
| 2 | ✅ Done | Rendu Canvas détaillé, caméra, grille |
| UI-1 | ✅ Done | Toolbar, TopBar, SidePanel, StatusBar, menus |
| 3 | ⏳ En attente | Aiguillages / turnouts |
| 4 | ⏳ En attente | Multi-sélection, undo/redo, copier/coller |
| 5 | ⏳ En attente | Persistance / localStorage |
| 6 | ⏳ En attente | Mobile / touch |
| 7 | ⏳ En attente | Simulation, calques, validation, 3D |
