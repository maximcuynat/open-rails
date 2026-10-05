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

npx vitest run src/domain/models/train.test.ts      # single file
npx vitest run -t "<test name substring>"           # single test by name
```

There is no linter or formatter configured. `tsc` is the only static check, and it is strict with `noUnusedLocals` / `noUnusedParameters` (unused imports and variables are build errors) and `verbatimModuleSyntax` (type-only imports must use `import type` / `import { type X }`).

Vitest transpiles without typechecking, so a green test run does not mean the build passes — run `npm run typecheck` as well. The only CI is `.github/workflows/deploy.yml`, which runs `npm run build` on pushes to `main` and deploys `dist/` to GitHub Pages (hence `base: './'` in `vite.config.ts`); it does not run the tests, and pushes that only touch `*.md` do not trigger it.

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

`notify()` also runs `syncJunctions(network)` on every call. It does not re-derive turnouts: it keeps the route tables in line with the track (drops the ones whose node or rails are gone) and proposes a table only for a fork that has none.

Undo/redo is snapshot-based: `store.pushHistorySnapshot()` serializes the whole project through `serializeNetwork`, and `undo()`/`redo()` deserialize a snapshot back. Network-mutating actions must call `pushHistorySnapshot()` after they commit. `application/commands/` (`ICommand`, `CommandManager`) and `application/tools/ToolStrategy.ts` are scaffolding that nothing uses yet — tool behaviour is implemented as branches on `store.tool` inside `Canvas.tsx` and the store.

Two cross-component signals travel as `window` CustomEvents rather than through the store: `rail:fit-view` and `rail:commit-numeric-placement`.

### Domain model

- `models/types.ts` — `Network` is one graph: `nodes`, `segments`, `adjacency` (node → segment ids) and `junctions`, all `Map`s. Always mutate through the helpers in `models/network.ts` (`addNode`, `addSegment`, `addCurveSegment`, `removeSegment`, `dissolveNode`, …) so `adjacency` stays consistent.
- A curved segment is a quadratic Bézier defined by its two end nodes plus a `via` control point. Circular arcs from the catalog are converted to that form (`viaFromArc`, `arcToVia`). `geometry/tangent.ts` enforces G1 tangent continuity when chaining segments.
- A `Junction` is the route table of a node, not a separate structure: `passages` (pairs of rails a train can pass between), `positions` (which passages each position opens) and `active`. It is declared once — by the tool that lays the device (`declareBranchOff`, `declareTurnout`) or by `proposeJunction` for a hand-drawn fork — and then only follows its rails; it names segments, so helpers that replace a rail call `replaceJunctionRail`. A turnout or 3-way is read through `turnoutView` (stem, branches, hand, `activeBranch`: all derived, nothing but rails and position is stored).
- `models/routing.ts` answers every "can a train go from this rail to that one at this node" question (`isPassageOpen`, `openExit`, `entriesOf`, `isRailClosedAt`) for trains, path search and drawing alike. Rails a table does not name take the straightest continuation within the deflection limit, which is what makes a plain joint and a fixed crossing.
- Sections (`models/sections.ts`) are computed from the graph; only their user metadata (`sectionMeta`, keyed by section id) is stored.
- IDs are sequential (`n_12`, `s_40`) from a module-level counter in `models/network.ts`. After loading or deserializing a network, `syncIdCounter(net)` must run to avoid collisions; tests that assert on ids call `resetIdCounter()`.
- World coordinates are **meters**; `camera.scale` is pixels per meter. Model scales (HO, N, …) are presets in `models/units.ts` that change gauge, track spacing, display unit and default zoom, not the coordinate system. Format any displayed length through `formatDistance` / `formatRadius`.
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
- `tools/remote-relay/` — a WebSocket relay that pairs one PC and one phone per room code. It is a Vite plugin (`vite.config.ts`), so it only exists under `npm run dev` / `npm run preview`: the phone desk does not work on the static GitHub Pages build. `ws` is a dev dependency.
- `presentation/remote/` — the page a phone gets when the URL carries `?pupitre=CODE` (`main.tsx` loads it instead of `App`, without the editor bundle).

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
