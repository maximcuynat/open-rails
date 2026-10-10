# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Open Rails (`rail-editor` in package.json) is a vector railway track editor and train simulator on an infinite canvas: React 18 + TypeScript + Vite, rendered with the native Canvas 2D API. Runtime dependencies are deliberately limited to `react`, `react-dom` and `@fontsource/archivo` — no rendering library, no state-management library. User-facing strings and the project docs are in French; code and comments are mostly English.

## Commands

```bash
npm run dev          # Vite dev server on http://localhost:8900
npm run build        # tsc --noEmit && vite build (typecheck gates the build)
npm run typecheck    # tsc --noEmit
npm test             # vitest run (whole suite, ~2 s)
npm run test:watch   # vitest watch mode
npm run bench        # vitest bench (verbose reporter, or nothing shows): one frame, one mouse move, one edit, on 13 527 rails (SCALE_COPIES=9: 122 000)
PROFILE=1 SCALE_COPIES=9 npx vitest run tools/perf/profile-undo.test.ts --silent=false   # where an edit and an undo spend their time (tools/perf/profile-*.test.ts, skipped by npm test)

npx vitest run src/domain/models/train.test.ts      # single file
npx vitest run -t "<test name substring>"           # single test by name
```

There is no linter or formatter configured. `tsc` is the only static check, and it is strict with `noUnusedLocals` / `noUnusedParameters` (unused imports and variables are build errors) and `verbatimModuleSyntax` (type-only imports must use `import type` / `import { type X }`).

Vitest transpiles without typechecking, so a green test run does not mean the build passes — run `npm run typecheck` as well. The only CI is `.github/workflows/deploy.yml`: it runs when a GitHub Release is published (or by manual dispatch), executes `npm test` then `npm run build`, and deploys `dist/` to GitHub Pages (hence `base: '/open-rails/'` in `vite.config.ts`). Nothing runs on a plain push. Its actions are pinned by commit SHA; `main` and `developement` refuse force-pushes and deletion, and `v*` tags cannot be moved.

## Architecture

Four layers under `src/`, imported through path aliases declared in both `tsconfig.json` and `vite.config.ts` (`@domain/*`, `@application/*`, `@infrastructure/*`, `@presentation/*`):

- `domain/` — pure TypeScript, no React or DOM. The network graph, geometry, the track-piece catalog, pathfinding, and train kinematics.
- `application/` — `state/editorStore.ts`, the single `EditorStore` class that holds all editor and simulation state.
- `infrastructure/` — `render/` (Canvas 2D drawing and camera), `persistence/` (JSON + localStorage), `export/` (SVG).
- `presentation/` — React components and the keyboard-shortcut hook.

The layering is not strictly inward: `EditorStore` imports from `infrastructure` (camera, persistence), and `gizmo.ts` / `dimensionOverlay.ts` under `presentation/components/canvas/` are canvas drawing helpers, not React components. `domain/` stays dependency-free and should remain so.

### State and render loop

`EditorStore` is a plain mutable class, instantiated once in `App.tsx` and passed down as a `store` prop. There is no immutable state: methods mutate fields in place and then call `store.notify()`, which bumps a version counter. React components subscribe through `useEditorVersion(store)` (`useSyncExternalStore` on that counter) and read fields directly off the store.

The canvas does not go through React reconciliation. `Canvas.tsx` owns an imperative `draw()` that calls the `render*` functions from `infrastructure/render/renderer.ts` in a fixed order (grid → baseboard → network → trains → previews → gizmo → scale bar), and it also holds all pointer/wheel interaction logic for every tool. Forgetting `notify()` after a mutation means neither the panels nor the canvas update.

`notify()` also runs `syncJunctions(network)`, `cleanSpeedZones` and `cleanSignals` — only when the network changed since its last call (see the revision below). `syncJunctions` does not re-derive turnouts: it keeps the route tables in line with the track (drops the ones whose node or rails are gone) and proposes a table only for a fork that has none. Two lighter notifications exist: `notifyView()` (camera moved: canvas and minimap, no React render) and `notifyFrame()` (simulation). A plain hover over the canvas notifies nothing.

### Network revision

Everything kept from one frame to the next (sections and diagnostics in `networkDerived`, speed profile, blocks, the spatial index) asks `networkCheckToken(net)` (`domain/models/networkWatch.ts`) whether the network changed, instead of comparing all of it. A network made by `createNetwork()` counts for itself what is added to or removed from its maps, and keeps a journal of it (which id, in which map). **Code that changes a node or a rail in place (`node.pos.x = …`, `seg.via = …`, `seg.cant = …`) must call `touchNetwork(net, id)` afterwards, with the id of what it changed**; `touchNetwork(net, null)` for a route table, a zone, a signal or a station changed in place (they are read whole), `touchNetwork(net)` without id when it does not know what changed (the whole network is read again), `networkChanged()` where it has no network at hand (every network is read again) and `tablesChanged()` for points thrown without a network at hand. `invalidateSignals`, `invalidateSpeedZones` and `invalidateJunctionIndex` already do. The tests run with every revision checked against the content (`src/testSetup.ts`): a forgotten call throws "changed in place without touchNetwork", a wrong id "changed without touchNetwork saying what", in tests too. `store.sectionMeta` follows the same rule with `sectionMetaChanged(meta, keys)` (the keys written, when known).

`domain/geometry/networkFollower.ts` keeps the nodes and rails of a network on a grid (`SpatialGrid`): `railsInBox`, `nodesInBox`, `railsWithin`, `nodesWithin` give what a loop over the whole network would, in the same order — use them for anything that looks for what is near a point or in view. The same follower feeds a journal of changes (`networkChangesSince(net, cursor)`): **anything kept from the network and worked out again after an edit reads what changed since its own cursor and redoes only that** — the sections (`sectionTracker.ts`: the chains through the nodes that changed), the kinematic issues (`kinematicTracker.ts`), the totals and graph analyses (`networkDerived.ts`), the speed profile (`ProfileTracker` in `trackSpeed.ts`: the curves read through a node that changed), the route tables (`syncJunctions(net, scope)`), the lengths (`railMeasures.ts`), the saved form of nodes and rails (`persistence.ts`). Each has an oracle: under `verifyingNetworkRevisions()` (the whole test suite) the result is compared with the one worked out from the whole network, and a difference throws. `reconcileNetworkIntersections` keeps its own state per network the same way (`exhaustive` is its reference).

Undo/redo is snapshot-based: `store.pushHistorySnapshot()` serializes the whole project through `serializeNetwork` (nodes and rails as shared objects, never changed afterwards — a test that wants to alter a saved rail copies it), and `undo()`/`redo()` put a snapshot back **onto the live network in place** (`deserializeNetwork(step, reconciledAt, store.network)`: a node, rail or table still as saved stays the object it is; `applySectionMeta` does the same for the section settings), so that what is kept from the network only redoes what the step changes. Network-mutating actions must call `pushHistorySnapshot()` after they commit. `application/commands/` (`ICommand`, `CommandManager`) and `application/tools/ToolStrategy.ts` are scaffolding that nothing uses yet — tool behaviour is implemented as branches on `store.tool` inside `Canvas.tsx` and the store.

Two cross-component signals travel as `window` CustomEvents rather than through the store: `rail:fit-view` and `rail:commit-numeric-placement`.

### Domain model

- `models/types.ts` — `Network` is one graph: `nodes`, `segments`, `adjacency` (node → segment ids), `junctions`, `speedZones`, `signals` and `stations`, all `Map`s. A `Station` (name, UIC code, SNCF trigram, position) names the rails of its platform stops; it is laid by the OSM import and read only (canvas, side panel), through the helpers of `models/stations.ts`. Its `station_stop` section names live in `store.sectionMeta`, derived at import (`stationSectionMeta`). Always mutate through the helpers in `models/network.ts` (`addNode`, `addSegment`, `addCurveSegment`, `removeSegment`, `dissolveNode`, …) so `adjacency` stays consistent.
- A curved segment is a quadratic Bézier defined by its two end nodes plus a `via` control point. Circular arcs from the catalog are converted to that form (`viaFromArc`, `arcToVia`). `geometry/tangent.ts` enforces G1 tangent continuity when chaining segments.
- A `Junction` is the route table of a node, not a separate structure: `passages` (pairs of rails a train can pass between), `positions` (which passages each position opens) and `active`. It is declared once — by the tool that lays the device (`declareBranchOff`, `declareTurnout`) or by `proposeJunction` for a hand-drawn fork — and then only follows its rails; it names segments, so helpers that replace a rail call `replaceJunctionRail`. A turnout or 3-way is read through `turnoutView` (stem, branches, hand, `activeBranch`: all derived, nothing but rails and position is stored). Four rails tangent at one node (two turnouts sharing their points) make a `double_slip`, read through `doubleSlipView`: two rails per side, one set of points per side, one passage open at a time; code that only needs a route open uses `openPassage`.
- `models/routing.ts` answers every "can a train go from this rail to that one at this node" question (`isPassageOpen`, `openExit`, `entriesOf`, `isRailClosedAt`) for trains, path search and drawing alike. Rails a table does not name take the straightest continuation within the deflection limit, which is what makes a plain joint and a fixed crossing.
- Sections (`models/sections.ts`) are computed from the graph; only their user metadata (`sectionMeta`, keyed by section id) is stored.
- IDs are sequential (`n_12`, `s_40`) from a module-level counter in `models/network.ts`. After loading or deserializing a network, `syncIdCounter(net)` must run to avoid collisions; tests that assert on ids call `resetIdCounter()`.
- World coordinates are **meters**; `camera.scale` is pixels per meter. Model scales (HO, N, …) are presets in `models/units.ts` that change gauge, track spacing, display unit and default zoom, not the coordinate system. Format any displayed length through `formatDistance` / `formatRadius`.
- The OSM import (`domain/import/`) projects either in a local frame centred on the data or, on request, in Lambert-93 with a fixed origin (`osmProjection.ts`: `projectionFor(frame, origin)` is the one way to read an import's coordinates back; `OsmSource.frame` remembers it). Stations come from the `railway=stop` positions grouped by UIC code or name (`osmStations.ts`), named officially from the embedded SNCF list `src/data/stations-fr.json` (`models/stationRegistry.ts`, loaded lazily by `application/import/stationRegistry.ts`).
- `public/data/lgv/` is the pre-computed « LGV France » dataset (one `SerializedProject` per high-speed line and approach, in Lambert-93, plus `index.json`), generated by `node tools/lgv-dataset/run.mjs` from OpenStreetMap (manifest, tiled Overpass fetch with a disk cache, lines by OSM relation id, `sliceProject` / `unionProjects` in `infrastructure/persistence/projectSlices.ts`); it is regenerated by hand, never by CI.
- « Fichier ▸ Ligne entre gares… » (`LineBetweenStationsModal.tsx`) searches that index and loads the lines of a journey as a **locked project** (`store.dataset`, `canEditNetwork`: no drawing tools, no history; trains and driving allowed), saved as a **recipe** only (`SerializedProject.dataset`, fetched again at start by `reloadDataset`); a line a train nears is fetched and added in place (`addDatasetLines`). Pure logic in `src/domain/dataset/`, fetching in `src/application/dataset/`. Under `npm run dev` the store is exposed as `window.__openRailsStore` for `tools/perf/measure-driving.cjs`.
- « Fichier ▸ Ajouter un JSON au projet… » adds a project file to the current one instead of replacing it: `mergeProjects` (`infrastructure/persistence/projectMerge.ts`, pure, on saved data) gives the file ids of its own (`renumberProject`), moves it onto the map of the current project (`reprojection` in `osmProjection.ts`), melts shared nodes, doubled rails (long rails too) and stations, and lets the current project win a conflict; `store.mergeProjectFile` loads the result in place, reconciles until nothing is left to weld, and makes it one undo step. The wording of its report is in `application/import/mergeReport.ts`.
- `geometry/constructionTemplates.ts` holds the compound operations (auto-connect, crossover, passing siding, balloon loop, track cut) as `compute…Preview` / `apply…` pairs: the preview is drawn while hovering and the same result is applied on click.

### Trains

There are two generations of train model, and both are live:

- `models/locomotive.ts` — the original single `Locomotive` (fixed TGV consist). It also owns the shared track-walking primitives everything else builds on: `TrackPosition` (`segId`, `t`, `forward`), `walkForward` / `walkBackward`, `snapToNearestTrack`, `computeBogieFrame`, junction steering.
- `models/train.ts` — `TrainSet`, an ordered list of `Vehicle`s (`loco` / `wagon`) that can be coupled and decoupled at runtime. `vehicles[0]` is the lead; `advanceTrainSet` moves it and re-derives every follower with `walkBackward`.

The store carries both (`store.locomotive` and `store.trains`). The simulation loop (`startSimulationLoop`, a `requestAnimationFrame` loop in the store) ticks `trains` when any exist and falls back to the legacy locomotive otherwise, and `tickAllTrains` copies the selected train's speed and throttle back into the legacy `locomotive*` fields because the legacy console state still reads those. New train work should target `TrainSet`.

### Driving console and phone desk

A driving console never reads the store. It receives a `ConsoleState` and emits `ConsoleCommand`s, both plain JSON and declared in `application/console/consoleContract.ts`; `buildConsoleState` / `buildFleet` read the store and `applyConsoleCommand` is the only way a console acts on it. That is what lets the same components run on the PC and on a phone.

- `presentation/components/console/` — the shared instruments and the three layouts (`band`, `screen`, `levers`); `chooseConsoleLayout` picks one from the canvas size unless the `consolePreference` setting forces one. `hud/DrivingDock.tsx` is the PC container and the only part that touches the store.
- `application/remote/` — the phone link: `protocol.ts` (messages, strict validation of everything received), `remoteHost.ts` (PC side, sends the fleet and the state, falls back to brake `hold` when the phone goes silent), `remoteDesk.ts` (phone side), `remoteSession.ts` (opens and closes a session on the PC). `infrastructure/remote/webSocketLink.ts` is the browser transport.
- `tools/remote-relay/` — a WebSocket relay that seats one PC and up to eight phone desks per room code, each desk known by a number (`rooms.ts`). It is a Vite plugin (`vite.config.ts`), so it only exists under `npm run dev` / `npm run preview`. On a page served over HTTPS (the published site) the desks reach the PC directly instead: the page of the PC runs the same rooms (`application/remote/roomRelay.ts`) and each desk is a WebRTC data channel (`infrastructure/remote/rtcHostLink.ts`, `rtcDeskLink.ts`), introduced by the public PeerJS broker through a client of our own (`peerBroker.ts`; its messages must keep the shape of the PeerJS library's, see `rtcPeer.ts`). `remoteRoute` in `protocol.ts` picks the way; `?liaison=webrtc&courtier=local` tries the direct one under `npm run dev` against the broker the dev server serves. `ws` is a dev dependency.
- `presentation/remote/` — the page a phone gets when the URL carries `?pupitre=CODE` (`main.tsx` loads it instead of `App`, without the editor bundle).

Each train has one driver: this screen for its selected train, or a desk (`store.trainDrivers`, `driverOf`, `takeTrain` / `releaseTrain`); a desk acts through `applyDeskCommand(store, desk, command)` on the train it holds and no other, and `tickAllTrains` neutralises only the trains nobody drives. The dispatcher's board (`hud/DispatcherPanel.tsx`, readers in `application/console/dispatcher.ts`) lists who drives what and the points ahead; while it is up a click on the mark of a set of points throws it at any zoom.

A field added to `ConsoleState` must also be added to the validation in `protocol.ts`, or it is dropped on the way to the phone. The plan and what is left to do are in `tasks/plan-console-conduite.md`.

## Tests

Tests sit next to the code as `*.test.ts` and run in Vitest's default Node environment — there is no jsdom and no React component test. The patterns in use:

- Domain logic is tested directly on a `Network` built with `createNetwork()` / `addNode()` / `addSegment()`.
- Renderer tests pass a hand-rolled mock `CanvasRenderingContext2D` made of `vi.fn()` stubs and assert on the calls.
- Store and interaction tests construct `new EditorStore()` and call its methods; persistence falls back to an in-memory storage when `localStorage` is absent (`resetMemoryStorage()` clears it between tests).

## Documentation in the repo

- `ROADMAP.md` — phased plan with done/todo checkboxes; the status table at the top is current.
- `HO.md` — reference tables for HO scale and the Kato Unitrack catalog (piece lengths, radii, turnout geometry) that `domain/profiles/profiles.ts` and `TURNOUT_SPECS` are based on.
- `DESCRIPTION.md` and the "Architecture logicielle" section at the end of `ROADMAP.md` predate the current layout: they describe `src/core/`, `src/render/`, `src/ui/`, millimetre world units, and no undo or persistence. Treat them as background on design intent, not as a map of the code.
