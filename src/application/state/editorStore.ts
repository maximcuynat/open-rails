import { useSyncExternalStore } from 'react'
import { createCamera, clampScale, fitDimensions, type Camera } from '@infrastructure/render/camera'
import { createNetwork, resetIdCounter, removeNode, removeSegment, addNode, addSegment, addCurveSegment, pruneOrphanNodes, dissolveNode, generateId } from '@domain/models/network'
import { computeParallelCurve } from '@domain/geometry/curve'
import { CURVE_RADII } from '@domain/profiles/profiles'
import { toggleJunction, toggleTurnoutHand, findJunctionAtNode, findJunctionBySegment, autoDetectJunctions } from '@domain/models/junction'
import { reconcileNetworkIntersections } from '@domain/geometry/reconcile'
import { placementThresholds, type PlacementThresholds } from '@domain/geometry/scale'
import {
  saveNetworkToStorage,
  loadNetworkFromStorage,
  clearNetworkStorage,
  deserializeNetwork,
  serializeNetwork,
  type SerializedProject,
} from '@infrastructure/persistence/persistence'
import type { JunctionId, Network, Point, Selection, Segment } from '@domain/models/types'
import type { SectionMetadata } from '@domain/models/sections'
import { computeTrackSections } from '@domain/models/sections'
import { type Unit, type ScalePresetId, SCALE_PRESETS } from '@domain/models/units'
import type { Locomotive } from '@domain/models/locomotive'
import {
  createLocomotive,
  advanceLocomotive,
  snapToNearestTrack,
  steerJunction,
  getLocomotiveFrontPos,
  reverseTGVTrain,
  hitTestTGVTrain,
  positionOnSegment,
  type TrainHitResult,
} from '@domain/models/locomotive'
import type { TrainSet, Vehicle, CouplerSnapTarget, Reverser } from '@domain/models/train'
import {
  TRAIN_CHAIN_SNAP_DISTANCE,
  makeTrainSet,
  setReverser,
  shiftReverser,
  setNotch,
  triggerEmergencyBrake,
  releaseEmergencyBrake,
  resetTrainControls,
  createVehicle,
  findCouplerSnap,
  advanceTrainSet,
  tickTrainSet,
  handleCouplingClick,
  findNearestCoupler,
  getAllCouplerPoints,
  hitTestTrainSet,
  hitTestTrainVehicle,
  removeVehicleFromTrainSet,
  steerTrainSetJunction,
  pruneTrainsToNetwork,
  serializeTrains,
  type CouplerPoint,
  type VehicleKind,
} from '@domain/models/train'

export type Tool =
  | 'select'
  | 'place'
  | 'curve'
  | 'turnout'
  | 'split'
  | 'measure'
  | 'pan'
  | 'locomotive'
  | 'coupling'

export type TrackMode = 'catalog' | 'freeform'

/** Name given to a project the user has not renamed yet. */
export const DEFAULT_PROJECT_NAME = 'Réseau sans titre'

/** Feedback shown when a vehicle cannot be placed where the user clicked or dropped it. */
export const TRAIN_PLACEMENT_REFUSED = 'Pose impossible ici : approchez le curseur d’un rail'

export type ThemeMode = 'light' | 'dark' | 'auto'

export interface CurveState {
  phase: 0 | 1
  startId: string | null
}

export interface ContextMenuTarget {
  type: 'canvas' | 'segment' | 'node' | 'junction' | 'train'
  id?: string
  worldPos: Point
}

export interface ContextMenuState {
  isOpen: boolean
  x: number
  y: number
  target: ContextMenuTarget | null
}

export interface TrainDebugOptions {
  vectors: boolean       // V, a, ac vectors
  yawAngles: boolean     // Bogie-body & inter-car articulation yaw angles
  gauge: boolean         // Kinematic dynamic gauge & overhang envelope
  lookahead: boolean     // Lookahead track trajectory & switch detection
  xray: boolean          // Translucent glass body instead of wireframe
}

/**
 * Central mutable store for the editor.
 *
 * Canvas-critical state (camera, network, selection, tool) lives in plain
 * fields mutated outside React for performance. A version counter + subscribe
 * lets UI panels re-render when something changes.
 */
export class EditorStore {
  // --- Mutable canvas state (not React state) ---
  network: Network = createNetwork()
  camera: Camera = createCamera(0, 0, 1) // 1 px per meter by default
  selection: Selection = { nodes: new Set(), segments: new Set() }
  tool: Tool = 'select'
  snap = true
  showGrid = true
  gridMode: 'auto' | 'fixed' = 'fixed'
  gridSpacing: number = 5 // meters in fixed mode (e.g. 1m, 2m, 5m, 10m, 25m, 50m)
  lastNodeId: string | null = null
  curveState: CurveState = { phase: 0, startId: null }
  curveProfileIdx = 2 // R500 (TER / ligne classique standard)
  curveSide: 1 | -1 = 1
  autoCurveSide = true
  cursorWorld: Point = { x: 0, y: 0 }
  snappedCursor: Point = { x: 0, y: 0 }
  hoverNodeId: string | null = null
  panning = false
  moved = false
  // Step-on-track: when Shift is held over a segment, stores the snap step points
  hoverSegSteps: { segId: string; points: Point[]; nearest: Point | null } | null = null
  showMinimap = false
  isSidePanelOpen = false

  // Mode double voie : Shift+Click pour poser 2 rails en parallele simultanement
  parallelMode = false
  parallelOffset: number = 3.3 // metres entre les 2 axes de voie (voie double standard)
  parallelLastNodeId: string | null = null // noeud courant sur la voie secondaire

  // Track selection and mode: freeform by default
  trackMode: TrackMode = 'freeform'
  selectedStraightLength: number | 'auto' = 'auto'
  selectedCurveRadius = 500
  selectedCurveAngle = 15

  // Turnout configuration
  selectedFrog: 4 | 6 = 6
  selectedTurnoutHand: 'left' | 'right' = 'left'

  // Crossing / Intersection configuration
  selectedCrossingAngle = 15 // degrees (15, 30, 45, 60, 90)
  selectedCrossingLength = 124 // mm (standard Kato/Peco crossing length)

  // --- Units, Scale and CAD Dimensioning System ---
  unit: Unit = 'm'
  scalePreset: ScalePresetId = '1:1'
  gauge: number = 1.435 // rail gauge in meters (UIC standard 1.435m, HO: 0.0165m, N: 0.009m)
  trackSpacing: number = 3.80 // standard double-track center-to-center spacing in meters
  showDimensions: boolean = true // live CAD dimensioning HUD overlay
  isSettingsOpen: boolean = false

  // --- Layout Board / Baseboard (Tableau de modélisme) ---
  boardEnabled: boolean = false // Active by default for miniature model scales (HO, N, TT, etc.)
  boardWidth: number = 2.40 // in meters (e.g. 240 cm = 8 ft)
  boardHeight: number = 1.20 // in meters (e.g. 120 cm = 4 ft)
  viewport: { w: number; h: number } = { w: 1200, h: 800 }

  // --- Locomotive / Simulation ---
  /** @deprecated Use trains[] instead. Kept for backward compatibility with renderer. */
  locomotive: Locomotive | null = null
  locomotivePreview: Locomotive | null = null // Ghost preview along track on hover
  trainWagonCount = 2 // legacy: used only for loco preview during drag
  isPlayMode = false
  locomotiveLength = 20 // meters (adjustable)
  locomotiveSpeed = 0.5 // meters per step (fallback keyboard advance increment)
  followLocomotiveCamera = true // Automatically center camera on locomotive in play mode
  showTrainDebug = false // Debug skeleton mode: see attachment points, pivots and accordions without body
  trainDebugOptions: TrainDebugOptions = {
    vectors: true,
    yawAngles: true,
    gauge: true,
    lookahead: true,
    xray: true,
  }
  isTrainSelected = false // Train selected in editor mode
  hoveredTrainPart: 'lead' | 'rear' | 'car' | null = null // Part currently under cursor
  hoveredTrainAnchor: Point | null = null // World anchor point of hovered part for UI badge
  draggingTrainItem: 'tgv_loco' | 'tgv_wagon' | null = null // Active item being dragged
  dragCursorScreen: Point | null = null // Screen position of cursor while dragging
  trainPlacementKind: 'tgv_loco' | 'tgv_wagon' = 'tgv_loco' // Selected vehicle kind for train placement

  // --- New: TrainSet fleet ---
  /** All train sets on the layout (independent or coupled rakes) */
  trains: TrainSet[] = []
  /** ID of the train currently selected / driven */
  selectedTrainId: string | null = null
  /** ID of the specific vehicle (loco or wagon) currently selected within the train */
  selectedTrainVehicleId: string | null = null
  /** Train tool submode: 'place' (place loco or wagon), 'select' (inspect / drive), or 'delete' (hover red outline & click to delete) */
  trainToolSubMode: 'select' | 'place' | 'delete' = 'place'
  /** Vehicle currently hovered under cursor in train delete tool */
  hoveredTrainDeleteVehicle: { train: TrainSet; vehicleId: string; kind: VehicleKind } | null = null
  /** Train placement heading orientation: 1 = forward along track segment, -1 = reversed */
  trainPlacementDirection: 1 | -1 = 1
  /**
   * Train being built in place mode (the counterpart of `lastNodeId` for rails): its free ends
   * attract the next vehicle from further away, so clicking along the track extends it car by car.
   */
  trainChainId: string | null = null
  /** Last recorded cursor world position for live direction flip updates */
  lastMouseWorld: Point | null = null
  /** Ghost preview train for single-vehicle placement (loco or wagon) */
  trainPlacementPreview: TrainSet | null = null
  /** Active magnetic coupler snap target when cursor is near an existing train's coupler */
  couplerSnapTarget: CouplerSnapTarget | null = null
  /** Coupler points cache for coupling mode rendering */
  couplerPoints: CouplerPoint[] = []
  /** Currently hovered coupler point in coupling mode */
  hoveredCouplerPoint: CouplerPoint | null = null

  // --- Locomotive Kinematics & Physics (legacy — used by selected train via bridge) ---
  locomotiveCurrentSpeed = 0 // current speed in m/s (0 = stopped)
  locomotiveMaxSpeed = 500 / 3.6 // max speed in m/s (500 km/h)
  locomotiveAcceleration = 5.5 // m/s^2 (applied while holding ArrowUp)
  locomotiveBraking = 10.0 // m/s^2 (applied while holding ArrowDown)
  locomotiveCoastingDecel = 0.5 // m/s^2 (friction / drag during coasting / inertia)
  locomotiveThrottle: 1 | 0 | -1 = 0 // 1 = accelerating, -1 = braking, 0 = coasting / inertia
  private simRafId: number | null = null
  private simLastTime = 0

  turnoutStartId: string | null = null
  turnoutOffset = 4.0
  turnoutRadius = 40.0
  turnoutSide: 1 | -1 = 1

  measureStart: Point | null = null
  measureEnd: Point | null = null
  isMeasuring = false

  // Dragging nodes & sections (Select tool)
  isDraggingNode = false
  dragStartWorld: Point | null = null
  draggedNodeInitialPositions = new Map<string, Point>()
  draggedViaInitialPositions = new Map<string, Point>()

  // 2D Orthogonal & Rotation Gizmo (Translation & rotation handles on selected node/section)
  gizmoHoverAxis: 'x' | 'y' | 'rotate' | null = null
  gizmoDragAxis: 'x' | 'y' | 'rotate' | null = null
  gizmoDragDelta: Point = { x: 0, y: 0 }
  gizmoRotateDelta = 0 // degrees

  // Context Menu State (triggered by right-click without drag)
  contextMenu: ContextMenuState = {
    isOpen: false,
    x: 0,
    y: 0,
    target: null,
  }

  // Numeric CAD Input Overlay (AutoCAD/Blender style live typing)
  numericInput = ''
  isNumericInputActive = false

  openContextMenu = (x: number, y: number, target: ContextMenuTarget): void => {
    this.contextMenu = { isOpen: true, x, y, target }
    this.notify()
  }

  closeContextMenu = (): void => {
    if (this.contextMenu.isOpen) {
      this.contextMenu = { isOpen: false, x: 0, y: 0, target: null }
      this.notify()
    }
  }

  setNumericInput = (val: string): void => {
    this.numericInput = val
    this.isNumericInputActive = val.length > 0
    this.notify()
  }

  clearNumericInput = (): void => {
    if (this.numericInput !== '' || this.isNumericInputActive) {
      this.numericInput = ''
      this.isNumericInputActive = false
      this.notify()
    }
  }

  // Box selection (Select tool)
  boxSelectStart: Point | null = null
  boxSelectEnd: Point | null = null
  isBoxSelecting = false

  // Custom Section / Canton / Station track metadata (name, type, color)
  sectionMeta: Record<string, SectionMetadata> = {}

  // --- Undo / Redo history stack ---
  private history: SerializedProject[] = []
  private historyIndex = -1
  private isUndoingRedoing = false
  private maxHistory = 50
  /**
   * Network edit made by the first click of a construction tool and not yet in history:
   * 'orphan' = a lone start node, 'structural' = an existing rail was split.
   * The step is recorded when the placement commits, so one placement = one undo step.
   */
  private pendingEdit: 'none' | 'orphan' | 'structural' = 'none'

  get canUndo(): boolean {
    return this.historyIndex > 0 || (this.pendingEdit !== 'none' && this.historyIndex >= 0)
  }

  /** True while a construction tool waits for its next click (start node already picked). */
  get hasPendingPlacement(): boolean {
    return (
      this.lastNodeId !== null ||
      this.curveState.phase === 1 ||
      this.turnoutStartId !== null ||
      this.parallelLastNodeId !== null
    )
  }

  /**
   * Record that the first click of a construction tool touched the network without committing
   * anything yet. No history step is pushed: it comes with the commit, or with the cancel when
   * a rail was split (`structural`).
   */
  notePendingEdit = (structural: boolean): void => {
    if (structural) this.pendingEdit = 'structural'
    else if (this.pendingEdit === 'none') this.pendingEdit = 'orphan'
    this.notify()
  }

  /** Forget every half-finished tool action (placement, turnout, double track, measure, typing). */
  private resetPendingToolState(): void {
    this.lastNodeId = null
    this.curveState = { phase: 0, startId: null }
    this.turnoutStartId = null
    this.parallelMode = false
    this.parallelLastNodeId = null
    this.measureStart = null
    this.measureEnd = null
    this.isMeasuring = false
    this.numericInput = ''
    this.isNumericInputActive = false
    this.pendingEdit = 'none'
  }

  /**
   * Drop the start nodes a construction tool left without any rail, then record the step
   * if the abandoned placement had split a rail, so history always matches the network.
   */
  private discardPendingPlacement(): void {
    const candidates = [this.lastNodeId, this.curveState.startId, this.turnoutStartId, this.parallelLastNodeId]
    const structural = this.pendingEdit === 'structural'
    this.resetPendingToolState()
    for (const nid of candidates) {
      if (!nid) continue
      const adj = this.network.adjacency.get(nid) ?? []
      if (adj.length === 0) {
        this.network.nodes.delete(nid)
        this.network.adjacency.delete(nid)
      }
    }
    if (structural) this.markDirty()
  }

  get canRedo(): boolean {
    return this.historyIndex >= 0 && this.historyIndex < this.history.length - 1
  }

  pushHistorySnapshot = (): void => {
    if (this.isUndoingRedoing) return
    this.syncTrainsWithNetwork()
    const snapshot = serializeNetwork(
      this.network,
      this.projectName,
      undefined,
      this.sectionMeta,
      this.gridMode,
      this.gridSpacing,
      undefined,
      this.unit,
      this.scalePreset,
      this.gauge,
      this.trackSpacing,
      this.showDimensions,
      this.boardEnabled,
      this.boardWidth,
      this.boardHeight,
      this.trains,
    )
    // Truncate any forward redo history if we are in the middle of history
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1)
    }
    this.history.push(snapshot)
    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }
    this.historyIndex = this.history.length - 1
    this.pendingEdit = 'none'
  }

  undo = (): void => {
    if (!this.canUndo || this.isPlayMode) return
    // A placement that has not committed yet is undone by going back to the current step
    if (this.pendingEdit === 'none') this.historyIndex--
    const snapshot = this.history[this.historyIndex]
    if (snapshot) {
      this.isUndoingRedoing = true
      try {
        const res = deserializeNetwork(snapshot)
        this.network = res.network
        this.restoreTrains(res.trains)
        if (res.sectionMeta) this.sectionMeta = res.sectionMeta
        else this.sectionMeta = {}
        if (res.unit) this.unit = res.unit
        if (res.scalePreset) this.scalePreset = res.scalePreset
        if (res.gauge) this.gauge = res.gauge
        if (res.trackSpacing) {
          this.trackSpacing = res.trackSpacing
          this.parallelOffset = res.trackSpacing
        }
        if (typeof res.showDimensions === 'boolean') this.showDimensions = res.showDimensions
        this.selection = { nodes: new Set(), segments: new Set() }
        this.resetPendingToolState()
        this.dirty = true
        this.savePersistedState()
        this.notify()
      } finally {
        this.isUndoingRedoing = false
      }
    }
  }

  redo = (): void => {
    if (!this.canRedo || this.isPlayMode) return
    this.historyIndex++
    const snapshot = this.history[this.historyIndex]
    if (snapshot) {
      this.isUndoingRedoing = true
      try {
        const res = deserializeNetwork(snapshot)
        this.network = res.network
        this.restoreTrains(res.trains)
        if (res.sectionMeta) this.sectionMeta = res.sectionMeta
        else this.sectionMeta = {}
        if (res.unit) this.unit = res.unit
        if (res.scalePreset) this.scalePreset = res.scalePreset
        if (res.gauge) this.gauge = res.gauge
        if (res.trackSpacing) {
          this.trackSpacing = res.trackSpacing
          this.parallelOffset = res.trackSpacing
        }
        if (typeof res.showDimensions === 'boolean') this.showDimensions = res.showDimensions
        this.selection = { nodes: new Set(), segments: new Set() }
        this.resetPendingToolState()
        this.dirty = true
        this.savePersistedState()
        this.notify()
      } finally {
        this.isUndoingRedoing = false
      }
    }
  }

  // --- UI-facing state ---
  theme: ThemeMode = 'auto'
  projectName = DEFAULT_PROJECT_NAME
  dirty = false

  setSectionMeta = (sectionId: string, meta: Partial<SectionMetadata>): void => {
    const isCustom = meta.name !== undefined ? true : this.sectionMeta[sectionId]?.isCustomName
    const updated = {
      ...this.sectionMeta[sectionId],
      ...meta,
      ...(isCustom ? { isCustomName: true } : {}),
    }
    this.sectionMeta[sectionId] = updated

    // Also associate metadata with individual constituent segment IDs so it survives splits/cuts
    const segIds = sectionId.split('-')
    for (const sid of segIds) {
      if (sid) {
        this.sectionMeta[sid] = {
          ...this.sectionMeta[sid],
          ...meta,
          ...(isCustom ? { isCustomName: true } : {}),
        }
      }
    }
    this.markDirty()
    this.notify()
  }

  constructor() {
    this.loadPersistedState()
    this.pushHistorySnapshot()
  }

  /**
   * Load persisted layout from localStorage if present.
   */
  loadPersistedState = (): boolean => {
    const saved = loadNetworkFromStorage()
    if (!saved) return false
    this.network = saved.network
    this.trains = saved.trains
    if (saved.projectName) {
      this.projectName = saved.projectName
    }
    if (saved.camera) {
      this.camera = createCamera(saved.camera.x, saved.camera.y, saved.camera.scale)
    }
    if (saved.sectionMeta) {
      this.sectionMeta = saved.sectionMeta
    }
    if (saved.gridMode) {
      this.gridMode = saved.gridMode
    }
    if (saved.gridSpacing) {
      this.gridSpacing = saved.gridSpacing
    }
    if (saved.unit) {
      this.unit = saved.unit
    }
    if (saved.scalePreset) {
      this.scalePreset = saved.scalePreset
    }
    if (saved.gauge) {
      this.gauge = saved.gauge
    }
    if (saved.trackSpacing) {
      this.trackSpacing = saved.trackSpacing
      this.parallelOffset = saved.trackSpacing
    }
    if (typeof saved.showDimensions === 'boolean') {
      this.showDimensions = saved.showDimensions
    }
    if (typeof saved.boardEnabled === 'boolean') {
      this.boardEnabled = saved.boardEnabled
    } else if (this.scalePreset !== '1:1') {
      this.boardEnabled = true
    }
    if (typeof saved.boardWidth === 'number' && saved.boardWidth > 0) {
      this.boardWidth = saved.boardWidth
    }
    if (typeof saved.boardHeight === 'number' && saved.boardHeight > 0) {
      this.boardHeight = saved.boardHeight
    }
    return true
  }

  /**
   * Load network from serialized data structure.
   */
  loadFromData = (data: any): void => {
    const res = deserializeNetwork(data)
    this.network = res.network
    this.locomotive = null
    this.restoreTrains(res.trains)
    if (res.projectName) this.projectName = res.projectName
    if (res.camera) this.camera = createCamera(res.camera.x, res.camera.y, res.camera.scale)
    // Section names belong to the imported file: never keep those of the previous network
    this.sectionMeta = res.sectionMeta ?? {}
    if (res.gridMode) this.gridMode = res.gridMode
    if (res.gridSpacing) this.gridSpacing = res.gridSpacing
    if (res.unit) this.unit = res.unit
    if (res.scalePreset) this.scalePreset = res.scalePreset
    if (res.gauge) this.gauge = res.gauge
    if (res.trackSpacing) {
      this.trackSpacing = res.trackSpacing
      this.parallelOffset = res.trackSpacing
    }
    if (typeof res.showDimensions === 'boolean') this.showDimensions = res.showDimensions
    if (typeof res.boardEnabled === 'boolean') {
      this.boardEnabled = res.boardEnabled
    } else if (this.scalePreset !== '1:1') {
      this.boardEnabled = true
    }
    if (typeof res.boardWidth === 'number' && res.boardWidth > 0) {
      this.boardWidth = res.boardWidth
    }
    if (typeof res.boardHeight === 'number' && res.boardHeight > 0) {
      this.boardHeight = res.boardHeight
    }
    this.selection = { nodes: new Set(), segments: new Set() }
    this.resetPendingToolState()
    this.markDirty()
    this.notify()
  }

  /**
   * Full project as JSON data: the single source for everything that leaves the store
   * (file export), carrying the same fields as the autosave.
   */
  exportProject = (): SerializedProject => {
    return serializeNetwork(
      this.network,
      this.projectName,
      this.camera,
      this.sectionMeta,
      this.gridMode,
      this.gridSpacing,
      computeTrackSections(this.network, this.sectionMeta),
      this.unit,
      this.scalePreset,
      this.gauge,
      this.trackSpacing,
      this.showDimensions,
      this.boardEnabled,
      this.boardWidth,
      this.boardHeight,
      this.trains,
    )
  }

  /**
   * Immediately save layout state to localStorage.
   */
  savePersistedState = (): void => {
    const sections = computeTrackSections(this.network, this.sectionMeta)
    saveNetworkToStorage(
      this.network,
      this.projectName,
      this.camera,
      this.sectionMeta,
      this.gridMode,
      this.gridSpacing,
      sections,
      this.unit,
      this.scalePreset,
      this.gauge,
      this.trackSpacing,
      this.showDimensions,
      this.boardEnabled,
      this.boardWidth,
      this.boardHeight,
      this.trains,
    )
  }

  /**
   * Reset the project to a fresh empty layout and clear localStorage.
   */
  newProject = (): void => {
    this.network = createNetwork()
    this.locomotive = null
    this.restoreTrains([])
    this.sectionMeta = {}
    this.selection = { nodes: new Set(), segments: new Set() }
    this.tool = 'pan'
    this.resetPendingToolState()
    this.projectName = DEFAULT_PROJECT_NAME
    this.camera.x = 0
    this.camera.y = 0
    this.camera.scale = 3
    this.dirty = false
    clearNetworkStorage()
    resetIdCounter(0)
    this.history = []
    this.historyIndex = -1
    this.pushHistorySnapshot()
    this.notify()
  }

  // --- Notification ---
  private listeners = new Set<() => void>()
  private version = 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getVersion = (): number => this.version

  /** Notify UI subscribers that something changed. Call after mutating state. */
  notify = (): void => {
    autoDetectJunctions(this.network)
    this.syncTrainsWithNetwork()
    this.version++
    this.listeners.forEach((l) => l())
  }

  setTool = (t: Tool): void => {
    // If transitioning away from an active creation without finishing, clean up abandoned degree 0 nodes
    this.discardPendingPlacement()

    // The construction tools mark their working node through the selection: it must not
    // survive as a real selection (and show the gizmo) once the tool is left
    if (this.tool !== t && (this.tool === 'place' || this.tool === 'curve' || this.tool === 'turnout')) {
      this.selection = { nodes: new Set(), segments: new Set() }
    }

    this.tool = t
    this.gizmoHoverAxis = null
    this.gizmoDragAxis = null
    this.gizmoDragDelta = { x: 0, y: 0 }
    this.hoverSegSteps = null
    this.hoverNodeId = null
    this.locomotivePreview = null
    this.trainPlacementPreview = null
    this.couplerSnapTarget = null
    this.hoveredTrainDeleteVehicle = null
    this.trainChainId = null
    this.notify()
  }

  toggleTurnoutSide = (): void => {
    this.turnoutSide = this.turnoutSide === 1 ? -1 : 1
    this.notify()
  }

  setTurnoutOffset = (val: number): void => {
    this.turnoutOffset = Math.max(1.5, Math.min(20, val))
    this.notify()
  }

  setTurnoutRadius = (val: number): void => {
    this.turnoutRadius = Math.max(15, Math.min(200, val))
    this.notify()
  }

  exitParallelMode = (): void => {
    this.parallelMode = false
    this.parallelLastNodeId = null
    this.notify()
  }

  setParallelOffset = (offset: number): void => {
    if (offset > 0) {
      this.parallelOffset = offset
      this.notify()
    }
  }

  /** True when the selection can be doubled: one or more rails, or exactly two nodes. */
  get canCreateParallelTrack(): boolean {
    return this.selection.segments.size > 0 || this.selection.nodes.size === 2
  }

  /**
   * Double the given rails with a parallel track at `off` metres (positive = left of the
   * direction of travel of the first rail). Rails are oriented as one run so the copy stays
   * on the same side all along; curves get a concentric copy and corners are mitred.
   */
  private createParallelTrackFromSegments(segIds: string[], off: number): boolean {
    const net = this.network
    const ids = segIds.filter((id) => net.segments.has(id))
    if (ids.length === 0 || off === 0) return false
    const selected = new Set(ids)

    // Orient every rail consistently with its neighbours
    const reversed = new Map<string, boolean>()
    for (const root of ids) {
      if (reversed.has(root)) continue
      reversed.set(root, false)
      const queue = [root]
      while (queue.length > 0) {
        const sid = queue.pop()!
        const seg = net.segments.get(sid)!
        const rev = reversed.get(sid)!
        for (const nid of [seg.from, seg.to]) {
          const isHead = (nid === seg.to) !== rev
          for (const otherId of net.adjacency.get(nid) ?? []) {
            if (!selected.has(otherId) || reversed.has(otherId)) continue
            const other = net.segments.get(otherId)!
            // A neighbour leaves the node this rail arrives at, and arrives where it leaves
            reversed.set(otherId, isHead ? other.from !== nid : other.to !== nid)
            queue.push(otherId)
          }
        }
      }
    }

    const pieces = ids.map((sid) => {
      const seg = net.segments.get(sid)!
      const rev = reversed.get(sid)!
      const fromId = rev ? seg.to : seg.from
      const toId = rev ? seg.from : seg.to
      const a = net.nodes.get(fromId)!.pos
      const b = net.nodes.get(toId)!.pos
      if (seg.via) {
        const par = computeParallelCurve(a, seg.via, b, off)
        return { fromId, toId, start: par.start, end: par.end, via: par.via as Point | null }
      }
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const nx = (-(b.y - a.y) / len) * off
      const ny = ((b.x - a.x) / len) * off
      return { fromId, toId, start: { x: a.x + nx, y: a.y + ny }, end: { x: b.x + nx, y: b.y + ny }, via: null }
    })

    // Where exactly two rails meet, both copies share one node (mitre of the two offsets)
    const offsetsAt = new Map<string, Point[]>()
    for (const p of pieces) {
      for (const [nid, pos] of [[p.fromId, p.start], [p.toId, p.end]] as const) {
        const origin = net.nodes.get(nid)!.pos
        const list = offsetsAt.get(nid) ?? []
        list.push({ x: pos.x - origin.x, y: pos.y - origin.y })
        offsetsAt.set(nid, list)
      }
    }
    const sharedNodeIds = new Map<string, string>()
    const newNodes = new Set<string>()
    const nodeFor = (nid: string, pos: Point): string => {
      const shared = sharedNodeIds.get(nid)
      if (shared) return shared
      const vecs = offsetsAt.get(nid) ?? []
      let target = pos
      let isShared = false
      if (vecs.length === 2) {
        const cos = (vecs[0].x * vecs[1].x + vecs[0].y * vecs[1].y) / (off * off)
        // Beyond ~120° the mitre runs away: leave the two ends apart
        if (cos > -0.5) {
          const origin = net.nodes.get(nid)!.pos
          target = {
            x: origin.x + (vecs[0].x + vecs[1].x) / (1 + cos),
            y: origin.y + (vecs[0].y + vecs[1].y) / (1 + cos),
          }
          isShared = true
        }
      }
      const node = addNode(net, target)
      newNodes.add(node.id)
      if (isShared) sharedNodeIds.set(nid, node.id)
      return node.id
    }

    const newSegs = new Set<string>()
    for (const p of pieces) {
      const fromId = nodeFor(p.fromId, p.start)
      const toId = nodeFor(p.toId, p.end)
      const seg = p.via ? addCurveSegment(net, fromId, toId, p.via) : addSegment(net, fromId, toId)
      if (seg) newSegs.add(seg.id)
    }
    if (newSegs.size === 0) return false

    this.selection = { nodes: newNodes, segments: newSegs }
    this.reconcileNetwork()
    this.markDirty()
    return true
  }

  /**
   * Crée un doublement de voie parallèle à la distance parallèle active : à partir des rails
   * donnés ou sélectionnés, sinon à partir de 2 nœuds sélectionnés (vecteur perpendiculaire).
   */
  createParallelTrackFromSelection = (customOffset?: number, segmentIds?: Iterable<string>): boolean => {
    const segIds = [...(segmentIds ?? this.selection.segments)]
    if (segIds.length > 0) {
      return this.createParallelTrackFromSegments(segIds, customOffset ?? this.parallelOffset)
    }
    if (this.selection.nodes.size !== 2) return false
    const [idA, idB] = [...this.selection.nodes]
    const nodeA = this.network.nodes.get(idA)
    const nodeB = this.network.nodes.get(idB)
    if (!nodeA || !nodeB) return false

    const dx = nodeB.pos.x - nodeA.pos.x
    const dy = nodeB.pos.y - nodeA.pos.y
    const len = Math.hypot(dx, dy)
    if (len < this.getMinTrackLength()) return false

    const ux = dx / len
    const uy = dy / len
    // Normale gauche perpendiculaire
    const nx = -uy
    const ny = ux
    const off = customOffset ?? this.parallelOffset

    // Créer ou récupérer le segment principal entre A et B s'il n'existe pas encore
    let mainSeg = null
    const adjA = this.network.adjacency.get(idA) ?? []
    for (const sid of adjA) {
      const s = this.network.segments.get(sid)
      if (s && (s.from === idB || s.to === idB)) {
        mainSeg = s
        break
      }
    }
    if (!mainSeg) {
      mainSeg = addSegment(this.network, idA, idB)
    }

    // Créer les 2 nouveaux nœuds parallèles
    const p2A = { x: nodeA.pos.x + nx * off, y: nodeA.pos.y + ny * off }
    const p2B = { x: nodeB.pos.x + nx * off, y: nodeB.pos.y + ny * off }

    const newNodeA = addNode(this.network, p2A)
    const newNodeB = addNode(this.network, p2B)

    const secSeg = addSegment(this.network, newNodeA.id, newNodeB.id)

    // Sélectionner les 2 nouveaux nœuds pour permettre d'enchaîner la pose ou les visualiser
    this.selection = { nodes: new Set([newNodeA.id, newNodeB.id]), segments: new Set(secSeg ? [secSeg.id] : []) }
    this.reconcileNetwork()
    this.markDirty()
    this.notify()
    return true
  }

  /**
   * Relie directement deux nœuds sélectionnés par un rail droit.
   */
  connectSelectedNodes = (): boolean => {
    if (this.selection.nodes.size !== 2) return false
    const [idA, idB] = [...this.selection.nodes]
    const s = addSegment(this.network, idA, idB)
    this.reconcileNetwork()
    this.markDirty()
    this.notify()
    return !!s
  }

  setSnap = (v: boolean): void => {
    this.snap = v
    this.notify()
  }

  toggleSnap = (): void => {
    this.snap = !this.snap
    this.notify()
  }

  toggleGrid = (): void => {
    this.showGrid = !this.showGrid
    this.notify()
  }

  setGridMode = (mode: 'auto' | 'fixed'): void => {
    this.gridMode = mode
    this.notify()
  }

  setGridSpacing = (spacing: number): void => {
    if (spacing > 0) {
      this.gridSpacing = spacing
      this.gridMode = 'fixed'
      this.notify()
    }
  }

  toggleMinimap = (): void => {
    this.showMinimap = !this.showMinimap
    this.notify()
  }

  toggleSidePanel = (): void => {
    this.isSidePanelOpen = !this.isSidePanelOpen
    this.notify()
  }

  setSidePanelOpen = (v: boolean): void => {
    this.isSidePanelOpen = v
    this.notify()
  }

  setTheme = (t: ThemeMode): void => {
    this.theme = t
    this.notify()
  }

  cycleTheme = (): void => {
    this.theme = this.theme === 'auto' ? 'light' : this.theme === 'light' ? 'dark' : 'auto'
    this.notify()
  }

  setProjectName = (name: string): void => {
    this.projectName = name
    this.savePersistedState()
    this.notify()
  }

  setUnit = (unit: Unit): void => {
    this.unit = unit
    this.savePersistedState()
    this.notify()
  }

  setScalePreset = (presetId: ScalePresetId, autoFit = true): void => {
    this.scalePreset = presetId
    const preset = SCALE_PRESETS[presetId]
    if (preset) {
      this.unit = preset.defaultUnit
      this.gauge = preset.defaultGauge
      this.trackSpacing = preset.defaultTrackSpacing
      this.parallelOffset = preset.defaultTrackSpacing
      if (preset.defaultBoardWidth && preset.defaultBoardHeight) {
        this.boardWidth = preset.defaultBoardWidth
        this.boardHeight = preset.defaultBoardHeight
        this.boardEnabled = true
      } else if (presetId === '1:1') {
        this.boardEnabled = false
      }
      if (presetId === 'HO' || presetId === 'TT') {
        this.gridSpacing = 0.1
      } else if (presetId === 'N' || presetId === 'Z') {
        this.gridSpacing = 0.05
      } else if (presetId === 'O') {
        this.gridSpacing = 0.2
      } else if (presetId === '1:1') {
        this.gridSpacing = 5
      }

      if (autoFit) {
        if (this.boardEnabled) {
          this.fitBoard()
        } else if (preset.defaultCameraScale) {
          this.camera.x = 0
          this.camera.y = 0
          this.camera.scale = preset.defaultCameraScale
        }
      }
    }
    this.savePersistedState()
    this.notify()
  }

  setViewport = (w: number, h: number): void => {
    if (w > 0 && h > 0) {
      this.viewport = { w, h }
    }
  }

  setBoardEnabled = (enabled: boolean): void => {
    this.boardEnabled = enabled
    this.savePersistedState()
    this.notify()
  }

  setBoardDimensions = (width: number, height: number): void => {
    if (width > 0 && height > 0) {
      this.boardWidth = width
      this.boardHeight = height
      this.savePersistedState()
      this.notify()
    }
  }

  fitBoard = (viewportW?: number, viewportH?: number): void => {
    const vw = viewportW ?? this.viewport.w
    const vh = viewportH ?? this.viewport.h
    const fit = fitDimensions(vw, vh, this.boardWidth, this.boardHeight, 0.15)
    this.camera.x = fit.x
    this.camera.y = fit.y
    this.camera.scale = fit.scale
    this.notify()
  }

  setCustomGauge = (gauge: number): void => {
    if (gauge > 0) {
      this.gauge = gauge
      this.scalePreset = 'custom'
      this.savePersistedState()
      this.notify()
    }
  }

  setCustomTrackSpacing = (spacing: number): void => {
    if (spacing > 0) {
      this.trackSpacing = spacing
      this.parallelOffset = spacing
      this.savePersistedState()
      this.notify()
    }
  }

  toggleDimensions = (): void => {
    this.showDimensions = !this.showDimensions
    this.savePersistedState()
    this.notify()
  }

  openSettings = (): void => {
    this.isSettingsOpen = true
    this.notify()
  }

  closeSettings = (): void => {
    this.isSettingsOpen = false
    this.notify()
  }

  toggleSettings = (): void => {
    this.isSettingsOpen = !this.isSettingsOpen
    this.notify()
  }

  getMinTrackLength = (): number => {
    const preset = SCALE_PRESETS[this.scalePreset]
    return preset ? preset.minLength : 0.05
  }

  markDirty = (): void => {
    this.dirty = true
    this.savePersistedState()
    this.pushHistorySnapshot()
    this.notify()
  }

  markClean = (): void => {
    if (this.dirty) {
      this.dirty = false
      this.notify()
    }
  }

  setSelection = (sel: Selection): void => {
    this.selection = sel
    this.notify()
  }

  clearSelection = (): void => {
    this.selection = { nodes: new Set(), segments: new Set() }
    this.notify()
  }

  /**
   * Prune all disconnected/orphan nodes (degree 0) from the network,
   * optionally preserving active nodes currently involved in a tool interaction.
   */
  pruneOrphans = (preserveActive = false): number => {
    const keep = new Set<string>()
    if (preserveActive) {
      if (this.lastNodeId) keep.add(this.lastNodeId)
      if (this.curveState.startId) keep.add(this.curveState.startId)
      if (this.turnoutStartId) keep.add(this.turnoutStartId)
      if (this.parallelLastNodeId) keep.add(this.parallelLastNodeId)
    }
    const pruned = pruneOrphanNodes(this.network, keep)
    if (pruned > 0) {
      this.markDirty()
      this.notify()
    }
    return pruned
  }

  /**
   * Cancel active tool interaction (Escape / Right click),
   * pruning any abandoned placement node that was created on click 1 with 0 connections.
   */
  cancelInteraction = (): void => {
    // Escape is two-step for the track tools: it first cancels what is pending (tool and
    // selection are kept), and only with nothing pending does it go back to the select tool.
    const hadPlacement = this.hasPendingPlacement
    const hadPending =
      hadPlacement ||
      this.measureStart !== null ||
      this.isNumericInputActive ||
      this.isDraggingNode ||
      this.gizmoDragAxis !== null ||
      this.contextMenu.isOpen

    // Clean up any candidate nodes that have 0 connections
    this.discardPendingPlacement()
    // Restore dragged node positions if cancelled mid-drag
    for (const [nid, initPos] of this.draggedNodeInitialPositions) {
      const node = this.network.nodes.get(nid)
      if (node) {
        node.pos.x = initPos.x
        node.pos.y = initPos.y
      }
    }
    for (const [sid, initVia] of this.draggedViaInitialPositions) {
      const seg = this.network.segments.get(sid)
      if (seg && seg.via) {
        seg.via.x = initVia.x
        seg.via.y = initVia.y
      }
    }
    this.gizmoHoverAxis = null
    this.gizmoDragAxis = null
    this.gizmoDragDelta = { x: 0, y: 0 }
    this.gizmoRotateDelta = 0
    this.closeContextMenu()
    this.clearNumericInput()
    this.hoverSegSteps = null
    this.hoverNodeId = null
    this.isDraggingNode = false
    this.dragStartWorld = null
    this.draggedNodeInitialPositions.clear()
    this.draggedViaInitialPositions.clear()
    this.pruneOrphans(false)
    if (this.tool === 'locomotive' || this.tool === 'coupling') {
      this.clearSelection()
    } else if (hadPending) {
      // The construction tools mark their working node through the selection: it goes with
      // the placement. Any other selection survives the cancel.
      if (hadPlacement) this.clearSelection()
      else this.notify()
    } else if (this.tool !== 'select') {
      this.setTool('select')
    } else {
      this.clearSelection()
    }
    if (this.tool === 'locomotive' || this.tool === 'coupling') {
      // Escape climbs one level at a time: placement (and its train in progress), deletion or
      // coupling first fall back to the train selection, and only from there to the select tool
      if (this.tool === 'coupling' || this.trainToolSubMode !== 'select') {
        this.tool = 'locomotive'
        this.trainToolSubMode = 'select'
      } else {
        this.tool = 'select'
        this.trainToolSubMode = 'place'
      }
      this.trainChainId = null
      this.draggingTrainItem = null
      this.dragCursorScreen = null
      this.hoveredTrainDeleteVehicle = null
      this.locomotivePreview = null
      this.trainPlacementPreview = null
      this.couplerSnapTarget = null
      this.refreshCouplerPoints()
      this.notify()
    }
  }

  selectAll = (): void => {
    const nodes = new Set<string>()
    const segments = new Set<string>()
    for (const id of this.network.nodes.keys()) nodes.add(id)
    for (const id of this.network.segments.keys()) segments.add(id)
    this.selection = { nodes, segments }
    this.notify()
  }

  /**
   * Deletes currently selected elements according to strict graph theory principles.
   * - Selected segments are removed from the network graph.
   * - Boundary/intersection nodes that still connect surviving tracks are NEVER deleted,
   *   ensuring adjacent tracks and lines at junctions remain 100% intact.
   * - Internal nodes whose incident segments are all removed are cleaned up as orphans.
   * - Junctions and turnouts are cleanly reconciled.
   */
  deleteSelection = (): void => {
    if (this.isTrainSelected || this.tool === 'locomotive' || this.tool === 'coupling') {
      if (this.selectedTrain || this.locomotive) {
        this.deleteSelectedTrainOrVehicle()
        return
      }
    }

    const sel = this.selection
    if (sel.segments.size === 0 && sel.nodes.size === 0) return

    const segsToDelete = new Set(sel.segments)
    const nodesToDelete = new Set(sel.nodes)

    // If segments were selected for deletion, protect any node that still has surviving connected segments
    if (segsToDelete.size > 0) {
      for (const nid of nodesToDelete) {
        const adj = this.network.adjacency.get(nid) ?? []
        const hasSurvivingSegments = adj.some((sid) => !segsToDelete.has(sid))
        if (hasSurvivingSegments) {
          // This node touches other tracks that are not being deleted — PRESERVE IT!
          nodesToDelete.delete(nid)
        }
      }
    }

    // 1. Remove all selected segments
    for (const sid of segsToDelete) {
      removeSegment(this.network, sid, false)
    }

    // 2. Remove / dissolve nodes that were specifically targeted
    for (const nid of nodesToDelete) {
      if (!this.network.nodes.has(nid)) continue

      const adj = this.network.adjacency.get(nid) ?? []
      const hasSelectedAdjacentSegment = adj.some((sid) => segsToDelete.has(sid))

      let dissolvedSeg: Segment | null = null
      if (!hasSelectedAdjacentSegment && adj.length === 2) {
        const seg1 = this.network.segments.get(adj[0])
        const seg2 = this.network.segments.get(adj[1])
        const oldMeta = (seg1 ? this.sectionMeta[seg1.id] : null) || (seg2 ? this.sectionMeta[seg2.id] : null)

        dissolvedSeg = dissolveNode(this.network, nid)
        if (dissolvedSeg && oldMeta) {
          this.sectionMeta[dissolvedSeg.id] = { ...oldMeta }
        }
      }

      if (!dissolvedSeg) {
        removeNode(this.network, nid)
      }

      if (this.lastNodeId === nid) this.lastNodeId = null
      if (this.curveState.startId === nid) {
        this.curveState = { phase: 0, startId: null }
      }
    }

    // 3. Clean up any remaining isolated/orphan nodes (degree 0) that lost all segments
    for (const [nid, adj] of this.network.adjacency) {
      if (adj.length === 0) {
        this.network.nodes.delete(nid)
        this.network.adjacency.delete(nid)
        if (this.lastNodeId === nid) this.lastNodeId = null
        if (this.curveState.startId === nid) {
          this.curveState = { phase: 0, startId: null }
        }
      }
    }

    // 4. Reconcile junctions: remove invalid turnout entries where segments or nodes were deleted
    for (const [juncId, junc] of this.network.junctions) {
      const nodeExists = this.network.nodes.has(junc.nodeId)
      const adj = this.network.adjacency.get(junc.nodeId) ?? []
      const sStraight = this.network.segments.has(junc.straightSegmentId)
      const sDiverging = this.network.segments.has(junc.divergingSegmentId)

      if (!nodeExists || adj.length !== 3 || !sStraight || !sDiverging) {
        this.network.junctions.delete(juncId)
      }
    }

    // Re-detect turnouts on any modified 3-way nodes
    autoDetectJunctions(this.network)

    this.clearSelection()
    this.markDirty()
    this.notify()
  }

  /** Reset the camera to fit all nodes and board, or board/origin if empty. */
  fitView = (viewportW?: number, viewportH?: number): void => {
    const vw = viewportW ?? this.viewport.w
    const vh = viewportH ?? this.viewport.h
    const nodes = [...this.network.nodes.values()]

    if (nodes.length === 0) {
      if (this.boardEnabled) {
        this.fitBoard(vw, vh)
      } else {
        this.camera.x = 0
        this.camera.y = 0
        this.camera.scale = this.scalePreset === '1:1' ? 2.5 : (SCALE_PRESETS[this.scalePreset]?.defaultCameraScale ?? 350)
        this.notify()
      }
      return
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      if (n.pos.x < minX) minX = n.pos.x
      if (n.pos.y < minY) minY = n.pos.y
      if (n.pos.x > maxX) maxX = n.pos.x
      if (n.pos.y > maxY) maxY = n.pos.y
    }

    if (this.boardEnabled) {
      const halfBW = this.boardWidth / 2
      const halfBH = this.boardHeight / 2
      minX = Math.min(minX, -halfBW)
      maxX = Math.max(maxX, halfBW)
      minY = Math.min(minY, -halfBH)
      maxY = Math.max(maxY, halfBH)
    }

    const pad = 0.12
    const w = (maxX - minX) || 1
    const h = (maxY - minY) || 1
    const scale = Math.min(
      vw / (w * (1 + pad * 2)),
      vh / (h * (1 + pad * 2)),
    )
    this.camera.x = (minX + maxX) / 2
    this.camera.y = (minY + maxY) / 2
    this.camera.scale = clampScale(scale)
    this.notify()
  }

  resetZoom = (): void => {
    if (this.boardEnabled) {
      this.fitBoard()
    } else {
      this.camera.scale = SCALE_PRESETS[this.scalePreset]?.defaultCameraScale ?? 2.5
      this.notify()
    }
  }

  /** World-space thresholds of the track tools, scaled to the current rail gauge. */
  getPlacementThresholds = (): PlacementThresholds => placementThresholds(this.gauge)

  /**
   * Reconcile pass run after every track edit, with the tolerance of the current scale.
   */
  reconcileNetwork = (): { splitCount: number; weldedCount: number } => {
    return reconcileNetworkIntersections(this.network, this.getPlacementThresholds().reconcileTolerance)
  }

  /**
   * Reconcile network topology: heal disconnected branches, auto-split segments
   * at intersecting points/nodes, and auto-detect turnouts & crossings.
   */
  reconcileTopology = (tolerance = this.getPlacementThresholds().healTolerance): { splitCount: number; weldedCount: number } => {
    const res = reconcileNetworkIntersections(this.network, tolerance)
    const pruned = this.pruneOrphans(false)
    if (res.splitCount > 0 || res.weldedCount > 0 || pruned > 0) {
      this.markDirty()
      this.notify()
    }
    return res
  }

  cycleCurveProfile = (dir: 1 | -1): void => {
    // Only cycle non-Infinity radii
    const validCount = CURVE_RADII.length - 1
    this.curveProfileIdx = Math.max(0, Math.min(validCount - 1, this.curveProfileIdx + dir))
    const r = CURVE_RADII[this.curveProfileIdx]
    if (r !== Infinity) this.selectedCurveRadius = r
    this.notify()
  }

  flipCurveSide = (): void => {
    this.curveSide = this.curveSide === 1 ? -1 : 1
    this.autoCurveSide = false
    this.notify()
  }

  toggleAutoCurveSide = (): void => {
    this.autoCurveSide = !this.autoCurveSide
    this.notify()
  }

  setTrackMode = (mode: TrackMode): void => {
    this.trackMode = mode
    this.notify()
  }

  setSelectedStraightLength = (len: number | 'auto'): void => {
    this.selectedStraightLength = len
    this.notify()
  }

  setSelectedCurveRadius = (r: number): void => {
    this.selectedCurveRadius = r
    const idx = CURVE_RADII.indexOf(r)
    if (idx >= 0) this.curveProfileIdx = idx
    this.notify()
  }

  setSelectedCurveAngle = (a: number): void => {
    this.selectedCurveAngle = a
    this.notify()
  }

  setSelectedFrog = (frog: 4 | 6): void => {
    this.selectedFrog = frog
    this.notify()
  }

  setSelectedTurnoutHand = (hand: 'left' | 'right'): void => {
    this.selectedTurnoutHand = hand
    this.notify()
  }

  toggleTurnoutHand = (): void => {
    this.selectedTurnoutHand = this.selectedTurnoutHand === 'left' ? 'right' : 'left'
    this.notify()
  }

  setSelectedCrossingAngle = (angle: number): void => {
    this.selectedCrossingAngle = angle
    this.notify()
  }

  setSelectedCrossingLength = (len: number): void => {
    this.selectedCrossingLength = len
    this.notify()
  }

  cycleCrossingAngle = (): void => {
    const angles = [15, 30, 45, 90]
    const idx = angles.indexOf(this.selectedCrossingAngle)
    const nextIdx = (idx + 1) % angles.length
    this.selectedCrossingAngle = angles[nextIdx]
    this.notify()
  }

  toggleActiveJunction = (junctionId?: JunctionId): void => {
    if (junctionId) {
      const junc = this.network.junctions.get(junctionId)
      if (junc) {
        toggleJunction(junc)
        this.markDirty()
        this.notify()
      }
      return
    }
    if (this.selection.junctions && this.selection.junctions.size > 0) {
      for (const jid of this.selection.junctions) {
        const junc = this.network.junctions.get(jid)
        if (junc) toggleJunction(junc)
      }
      this.markDirty()
      this.notify()
      return
    }
    for (const nid of this.selection.nodes) {
      const junc = findJunctionAtNode(this.network, nid)
      if (junc) {
        toggleJunction(junc)
        this.markDirty()
        this.notify()
        return
      }
    }
    for (const sid of this.selection.segments) {
      const junc = findJunctionBySegment(this.network, sid)
      if (junc) {
        toggleJunction(junc)
        this.markDirty()
        this.notify()
        return
      }
    }
  }

  toggleTurnoutHandAtSelection = (): void => {
    for (const nid of this.selection.nodes) {
      const junc = findJunctionAtNode(this.network, nid)
      if (junc) {
        toggleTurnoutHand(this.network, junc.id)
        this.markDirty()
        this.notify()
        return
      }
    }
    for (const sid of this.selection.segments) {
      const junc = findJunctionBySegment(this.network, sid)
      if (junc) {
        toggleTurnoutHand(this.network, junc.id)
        this.markDirty()
        this.notify()
        return
      }
    }
  }

  // --- Locomotive / Simulation methods ---

  /** Start dragging a train component (motrice or wagon) */
  startTrainDrag = (item: 'tgv_loco' | 'tgv_wagon', screenPos?: Point): void => {
    this.draggingTrainItem = item
    this.dragCursorScreen = screenPos ?? null
    this.locomotivePreview = null
    this.notify()
  }

  /** Update drag position and track snap preview */
  updateTrainDrag = (worldPos: Point, screenPos?: Point): void => {
    if (!this.draggingTrainItem) return
    if (screenPos) {
      this.dragCursorScreen = screenPos
    }
    this.updateLocomotivePreview(worldPos)
  }

  /** Complete train drag and drop onto track */
  endTrainDrag = (worldPos: Point): boolean => {
    if (!this.draggingTrainItem) return false
    return this.handleDropTrainItem(this.draggingTrainItem, worldPos)
  }

  /** Cancel active train dragging */
  cancelTrainDrag = (): void => {
    this.draggingTrainItem = null
    this.dragCursorScreen = null
    this.locomotivePreview = null
    this.trainPlacementPreview = null
    this.couplerSnapTarget = null
    this.notify()
  }

  /** The train being built in place mode, if it still exists */
  get trainChain(): TrainSet | null {
    if (!this.trainChainId) return null
    return this.trains.find(t => t.id === this.trainChainId) ?? null
  }

  /**
   * Where a vehicle of `kind` lands for a cursor at worldPos: coupled to a train end (`snap`),
   * or alone on the track as a new train. Null when the cursor is too far from any rail.
   * The ghost preview and the actual placement both go through here, so they always agree.
   */
  private computeTrainPlacement(worldPos: Point, kind: VehicleKind): { snap: CouplerSnapTarget | null; vehicle: Vehicle } | null {
    // 1. Train in progress: its free ends reach further, so the next click along the track extends it
    const chain = this.trainChain
    if (chain) {
      const chainSnapDist = Math.max(TRAIN_CHAIN_SNAP_DISTANCE, 60 / this.camera.scale)
      const snap = findCouplerSnap(this.network, [chain], worldPos, kind, chainSnapDist)
      if (snap) return { snap, vehicle: snap.snappedVehicle }
    }

    // 2. Magnetic coupler snap with any train
    const maxCouplerSnapDist = Math.max(6.0, 30 / this.camera.scale)
    const snap = findCouplerSnap(this.network, this.trains, worldPos, kind, maxCouplerSnapDist)
    if (snap) return { snap, vehicle: snap.snappedVehicle }

    // 3. Free placement on the track under the cursor, with the chosen heading: a new train
    const maxTrackSnapDist = Math.max(12.0, 45 / this.camera.scale)
    const trackSnap = snapToNearestTrack(this.network, worldPos, maxTrackSnapDist)
    if (!trackSnap) return null
    const vehicle = createVehicle(this.network, trackSnap.segId, trackSnap.t, kind, this.trainPlacementDirection)
    return vehicle ? { snap: null, vehicle } : null
  }

  /** Update ghost preview when hovering track in locomotive tool or actively dragging */
  updateLocomotivePreview = (worldPos: Point): void => {
    this.lastMouseWorld = worldPos
    const isPlacing = this.draggingTrainItem !== null || (this.tool === 'locomotive' && this.trainToolSubMode === 'place')
    if (this.isPlayMode || !isPlacing) {
      if (this.trainPlacementPreview !== null || this.locomotivePreview !== null || this.couplerSnapTarget !== null) {
        this.trainPlacementPreview = null
        this.locomotivePreview = null
        this.couplerSnapTarget = null
        this.notify()
      }
      return
    }

    const isWagon = this.draggingTrainItem === 'tgv_wagon' ||
      (!this.draggingTrainItem && this.trainPlacementKind === 'tgv_wagon')
    const placement = this.computeTrainPlacement(worldPos, isWagon ? 'wagon' : 'loco')

    if (!placement) {
      if (this.trainPlacementPreview !== null || this.locomotivePreview !== null || this.couplerSnapTarget !== null) {
        this.trainPlacementPreview = null
        this.locomotivePreview = null
        this.couplerSnapTarget = null
        this.notify()
      }
      return
    }

    this.couplerSnapTarget = placement.snap
    this.trainPlacementPreview = makeTrainSet('preview_train', [placement.vehicle])
    this.locomotivePreview = null
    this.notify()
  }

  /** Place locomotive on the nearest track segment to a world position */
  placeLocomotiveAt = (worldPos: Point): boolean => {
    if (this.locomotivePreview) {
      this.locomotive = this.locomotivePreview
      this.locomotivePreview = null
      this.notify()
      return true
    }

    const snap = snapToNearestTrack(this.network, worldPos)
    if (!snap) return false
    const loco = createLocomotive(
      this.network,
      snap.segId,
      snap.t,
      this.locomotiveLength,
      14,
      this.trainWagonCount
    )
    if (!loco) return false
    this.locomotive = loco
    this.isTrainSelected = true
    this.notify()
    return true
  }

  /** Select or deselect the train */
  selectTrain = (selected: boolean = true): void => {
    this.isTrainSelected = selected
    this.notify()
  }

  /** Set the number of passenger cars in the articulated TGV train */
  setTrainWagonCount = (count: number): void => {
    this.trainWagonCount = Math.max(0, Math.min(8, Math.round(count)))
    if (this.locomotive) {
      this.locomotive.wagonCount = this.trainWagonCount
    }
    this.notify()
  }

  /** Increment passenger car count */
  addTrainWagon = (): void => {
    this.setTrainWagonCount(this.trainWagonCount + 1)
  }

  /** Decrement passenger car count */
  removeTrainWagon = (): void => {
    this.setTrainWagonCount(this.trainWagonCount - 1)
  }

  /** Find a train from the fleet at worldPos */
  findTrainAt = (worldPos: Point): TrainSet | null => {
    for (const t of this.trains) {
      if (hitTestTrainSet(this.network, t, worldPos, 2.5 / this.camera.scale)) {
        return t
      }
    }
    return null
  }

  /** Perform hit test on train at a world position */
  checkTrainHover = (worldPos: Point): TrainHitResult => {
    if (this.trains.length > 0) {
      const hitTrain = this.findTrainAt(worldPos)
      if (hitTrain) {
        if (this.hoveredTrainPart !== 'lead') {
          this.hoveredTrainPart = 'lead'
          this.notify()
        }
        return { hit: true, part: 'lead' }
      }
    }
    if (!this.locomotive) {
      if (this.hoveredTrainPart !== null) {
        this.hoveredTrainPart = null
        this.hoveredTrainAnchor = null
        this.notify()
      }
      return { hit: false, part: 'none' }
    }
    const res = hitTestTGVTrain(this.network, this.locomotive, worldPos, 2.5 / this.camera.scale)
    const newPart: 'lead' | 'rear' | 'car' | null = (res.hit && res.part !== 'none') ? res.part : null
    const newAnchor = res.anchorPoint ?? null
    if (newPart !== this.hoveredTrainPart || (newAnchor && !this.hoveredTrainAnchor)) {
      this.hoveredTrainPart = newPart
      this.hoveredTrainAnchor = newAnchor
      this.notify()
    }
    return res
  }

  /**
   * Drop a vehicle picked outside the canvas (sidebar drag, context menu) at worldPos.
   * Same result as a click in place mode: the train tool is armed with that vehicle kind
   * and the vehicle goes through `placeTrainItem`.
   */
  handleDropTrainItem = (itemType: 'tgv_loco' | 'tgv_wagon', worldPos: Point): boolean => {
    this.draggingTrainItem = null
    this.dragCursorScreen = null
    if (this.isPlayMode) {
      this.notify()
      return false
    }
    if (this.tool !== 'locomotive') this.setTool('locomotive')
    this.trainPlacementKind = itemType
    this.trainToolSubMode = 'place'
    this.hoveredTrainDeleteVehicle = null
    const placed = this.placeTrainItem(worldPos, itemType)
    this.notify()
    return placed
  }

  /** Toggle train kinematic skeleton / debug visualization mode */
  toggleTrainDebug = (): void => {
    this.showTrainDebug = !this.showTrainDebug
    this.notify()
  }

  /** Toggle specific train debug layer */
  toggleTrainDebugOption = (key: keyof TrainDebugOptions): void => {
    this.trainDebugOptions[key] = !this.trainDebugOptions[key]
    this.notify()
  }

  /** Center camera on the locomotive */
  focusOnLocomotive = (): void => {
    if (!this.locomotive) return
    const pos = getLocomotiveFrontPos(this.network, this.locomotive)
    if (pos) {
      this.camera.x = pos.x
      this.camera.y = pos.y
      this.notify()
    }
  }

  /** Toggle play mode on/off */
  togglePlayMode = (): void => {
    if (!this.locomotive && this.trains.length === 0) return
    this.isPlayMode = !this.isPlayMode
    if (this.isPlayMode) {
      // Switch away from any tool interaction
      this.lastNodeId = null
      this.curveState = { phase: 0, startId: null }
      this.turnoutStartId = null
      this.trainChainId = null
      this.draggingTrainItem = null
      this.dragCursorScreen = null
      this.trainPlacementPreview = null
      this.couplerSnapTarget = null
      this.hoveredTrainDeleteVehicle = null
      if (this.trains.length > 0 && !this.selectedTrain) {
        this.selectTrainById(this.trains[0].id)
      }
      if (this.followLocomotiveCamera) {
        this.focusOnLocomotive()
      }
      this.startSimulationLoop()
    } else {
      this.stopSimulationLoop()
      this.locomotiveCurrentSpeed = 0
      this.locomotiveThrottle = 0
      for (const t of this.trains) resetTrainControls(t)
      // Where the trains were driven to is one undo step, and survives a reload
      const lastSaved = this.history[this.historyIndex]?.trains ?? []
      if (JSON.stringify(serializeTrains(this.trains)) !== JSON.stringify(lastSaved)) {
        this.commitTrainChange()
      }
    }
    this.notify()
  }

  /** Set the throttle state of the legacy locomotive: 1 = accelerate, -1 = brake/decelerate, 0 = coast/inertia */
  setLocomotiveThrottle = (throttle: 1 | 0 | -1): void => {
    if (this.locomotiveThrottle !== throttle) {
      this.locomotiveThrottle = throttle
      this.notify()
    }
  }

  /** Run one physical simulation tick (dt in seconds) */
  tickSimulation = (dt: number): void => {
    if (!this.locomotive || !this.isPlayMode || dt <= 0) return

    // Mise à jour de la vitesse selon la commande (accélération, freinage ou inertie)
    if (this.locomotiveThrottle === 1) {
      // Flèche Haut : accélération active
      this.locomotiveCurrentSpeed = Math.min(
        this.locomotiveMaxSpeed,
        this.locomotiveCurrentSpeed + this.locomotiveAcceleration * dt
      )
    } else if (this.locomotiveThrottle === -1) {
      // Flèche Bas : décélération / freinage actif
      this.locomotiveCurrentSpeed = Math.max(
        0,
        this.locomotiveCurrentSpeed - this.locomotiveBraking * dt
      )
    } else {
      // Inertie (roue libre) : résistance au roulement / traînée progressive
      if (this.locomotiveCurrentSpeed > 0) {
        this.locomotiveCurrentSpeed = Math.max(
          0,
          this.locomotiveCurrentSpeed - this.locomotiveCoastingDecel * dt
        )
      }
    }

    // Déplacement sur le réseau si la vitesse est positive
    if (this.locomotiveCurrentSpeed > 0) {
      const dist = this.locomotiveCurrentSpeed * dt
      const moved = advanceLocomotive(this.network, this.locomotive, dist)
      if (!moved) {
        // En fin de voie ou bloqué par un butoir : arrêt immédiat
        this.locomotiveCurrentSpeed = 0
      } else if (this.followLocomotiveCamera) {
        const pos = getLocomotiveFrontPos(this.network, this.locomotive)
        if (pos) {
          this.camera.x = pos.x
          this.camera.y = pos.y
        }
      }
      this.notify()
    } else if (this.locomotiveThrottle !== 0) {
      this.notify()
    }
  }

  /** Start requestAnimationFrame simulation loop */
  startSimulationLoop = (): void => {
    if (this.simRafId !== null || typeof window === 'undefined') return
    this.simLastTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const loop = (now: number) => {
      if (!this.isPlayMode || (!this.locomotive && this.trains.length === 0)) {
        this.stopSimulationLoop()
        return
      }
      const dt = Math.min((now - this.simLastTime) / 1000, 0.1)
      this.simLastTime = now
      if (this.trains.length > 0) {
        this.tickAllTrains(dt)
      } else if (this.locomotive) {
        this.tickSimulation(dt)
      }
      this.simRafId = requestAnimationFrame(loop)
    }
    this.simRafId = requestAnimationFrame(loop)
  }

  /** Stop simulation loop */
  stopSimulationLoop = (): void => {
    if (this.simRafId !== null && typeof window !== 'undefined') {
      cancelAnimationFrame(this.simRafId)
      this.simRafId = null
    }
    this.locomotiveThrottle = 0
  }

  /** Advance the locomotive by one step (discrete fallback: forward only) */
  stepLocomotive = (direction: 1 | -1): void => {
    if (!this.locomotive || !this.isPlayMode) return
    if (direction === -1) {
      this.flipLocomotiveDirection()
      return
    }
    const moved = advanceLocomotive(this.network, this.locomotive, this.locomotiveSpeed)
    if (moved && this.followLocomotiveCamera) {
      const pos = getLocomotiveFrontPos(this.network, this.locomotive)
      if (pos) {
        this.camera.x = pos.x
        this.camera.y = pos.y
      }
    }
    this.notify()
  }

  /** Steer the upcoming junction left or right relative to the locomotive */
  steerUpcomingTurnout = (steerDirection: 'left' | 'right'): void => {
    const train = this.selectedTrain
    if (train) {
      if (steerTrainSetJunction(this.network, train, steerDirection)) this.notify()
      return
    }
    if (!this.locomotive) return
    steerJunction(this.network, this.locomotive, steerDirection)
    this.notify()
  }

  /**
   * Reverse the travel direction: a TrainSet gets its reverser thrown to the opposite side
   * (refused while moving), the legacy TGV swaps its active driving cab.
   */
  flipLocomotiveDirection = (): void => {
    if (this.selectedTrain) {
      this.setSelectedTrainReverser(this.selectedTrain.reverser === 'reverse' ? 'forward' : 'reverse')
      return
    }
    if (!this.locomotive) return

    // Relève de cabine : arrêt complet du train pour transférer les commandes
    if (this.locomotiveCurrentSpeed > 0) {
      this.locomotiveCurrentSpeed = 0
    }
    this.locomotiveThrottle = 0

    const reversed = reverseTGVTrain(this.network, this.locomotive)
    if (reversed) {
      this.locomotive = reversed
      if (this.followLocomotiveCamera) {
        this.focusOnLocomotive()
      }
    }
    this.notify()
  }

  /** Flip orientation for single vehicle placement preview and placement (R key) */
  flipTrainPlacementDirection = (): void => {
    this.trainPlacementDirection = (this.trainPlacementDirection === 1 ? -1 : 1) as 1 | -1
    if (this.lastMouseWorld) {
      this.updateLocomotivePreview(this.lastMouseWorld)
    }
    this.notify()
  }

  /** Remove the locomotive from the layout */
  removeLocomotive = (): void => {
    this.stopSimulationLoop()
    this.locomotiveCurrentSpeed = 0
    this.locomotiveThrottle = 0
    this.locomotive = null
    this.isTrainSelected = false
    this.hoveredTrainPart = null
    this.hoveredTrainAnchor = null
    this.isPlayMode = false
    this.notify()
  }

  /** Set the locomotive length (for future placement) */
  setLocomotiveLength = (len: number): void => {
    if (len > 2) {
      this.locomotiveLength = len
      this.notify()
    }
  }

  // ─── TrainSet fleet methods ──────────────────────────────────────────────────

  /**
   * Save the trains and record one undo step. Every train edit (place, delete, couple, decouple)
   * ends here, after the change is made.
   */
  private commitTrainChange(): void {
    this.dirty = true
    this.savePersistedState()
    this.pushHistorySnapshot()
    this.notify()
  }

  /** Keep the train selection pointing at a train and a vehicle that still exist */
  private repairTrainSelection(): void {
    const train = this.selectedTrain
    if (!train) {
      this.selectedTrainId = null
      this.selectedTrainVehicleId = null
      this.isTrainSelected = false
    } else if (!train.vehicles.some(v => v.id === this.selectedTrainVehicleId)) {
      this.selectedTrainVehicleId = train.vehicles[0]?.id ?? null
    }
    if (this.trainChainId && !this.trainChain) this.trainChainId = null
  }

  /** Drop the vehicles whose rails were removed by a network edit */
  private syncTrainsWithNetwork(): void {
    if (this.trains.length === 0) return
    const pruned = pruneTrainsToNetwork(this.network, this.trains)
    if (pruned === this.trains) return
    this.trains = pruned
    this.trainPlacementPreview = null
    this.couplerSnapTarget = null
    this.hoveredTrainDeleteVehicle = null
    this.repairTrainSelection()
    this.refreshCouplerPoints()
    if (this.isPlayMode && this.trains.length === 0 && !this.locomotive) {
      this.isPlayMode = false
      this.stopSimulationLoop()
    }
  }

  /** Replace the fleet with trains coming from a snapshot or a file: all stopped, driving mode left */
  private restoreTrains(trains: TrainSet[]): void {
    if (this.isPlayMode) {
      this.isPlayMode = false
      this.stopSimulationLoop()
    }
    this.trains = trains
    this.locomotiveCurrentSpeed = 0
    this.trainChainId = null
    this.trainPlacementPreview = null
    this.locomotivePreview = null
    this.couplerSnapTarget = null
    this.hoveredTrainDeleteVehicle = null
    this.hoveredCouplerPoint = null
    this.repairTrainSelection()
    this.refreshCouplerPoints()
  }

  /**
   * Unified train placement, the single path for every way of adding a vehicle: coupled to the
   * train in progress or to a nearby train end, otherwise alone on the track as a new train.
   * Refused (false) in play mode and when worldPos is too far from a rail.
   */
  placeTrainItem = (worldPos: Point, overrideKind?: 'tgv_loco' | 'tgv_wagon'): boolean => {
    if (this.isPlayMode) return false
    const isWagon = overrideKind === 'tgv_wagon' ||
      (!overrideKind && this.trainPlacementKind === 'tgv_wagon')
    const placement = this.computeTrainPlacement(worldPos, isWagon ? 'wagon' : 'loco')
    if (!placement) return false

    let train: TrainSet
    let vehicle = placement.vehicle
    if (placement.snap) {
      train = placement.snap.train
      vehicle = { ...vehicle, id: generateId('veh') }
      if (placement.snap.end === 'rear') train.vehicles.push(vehicle)
      else train.vehicles.unshift(vehicle)
      advanceTrainSet(this.network, train, 0)
    } else {
      train = makeTrainSet(generateId('train'), [vehicle])
      this.trains = [...this.trains, train]
    }

    this.trainChainId = train.id
    this.selectTrainById(train.id, vehicle.id)
    this.locomotivePreview = null
    this.refreshCouplerPoints()
    this.commitTrainChange()
    // Show at once where the next vehicle would go
    this.trainPlacementPreview = null
    this.couplerSnapTarget = null
    this.updateLocomotivePreview(worldPos)
    return true
  }

  /** Place a new independent locomotive TrainSet at worldPos */
  placeTrainLoco = (worldPos: Point): boolean => {
    return this.placeTrainItem(worldPos, 'tgv_loco')
  }

  /** Place a new independent wagon TrainSet at worldPos */
  placeTrainWagon = (worldPos: Point): boolean => {
    return this.placeTrainItem(worldPos, 'tgv_wagon')
  }

  /** Select a train by its id and optionally target a specific vehicle */
  selectTrainById = (id: string | null, vehicleId?: string): void => {
    this.selectedTrainId = id
    this.isTrainSelected = id !== null
    const train = this.selectedTrain
    if (vehicleId) {
      this.selectedTrainVehicleId = vehicleId
    } else if (train && train.vehicles.length > 0) {
      this.selectedTrainVehicleId = train.vehicles[0].id
    } else {
      this.selectedTrainVehicleId = null
    }
    this.notify()
  }

  /** Find specific vehicle (loco or wagon) in any train at a world position */
  findVehicleAt = (worldPos: Point, customTolerance?: number): { train: TrainSet; vehicleId: string; kind: VehicleKind } | null => {
    const tol = customTolerance ?? Math.max(2.5, 16 / this.camera.scale)
    for (const t of this.trains) {
      const hit = hitTestTrainVehicle(this.network, t, worldPos, tol)
      if (hit) return { train: t, vehicleId: hit.vehicleId, kind: hit.kind }
    }
    return null
  }

  /** Switch train tool submode ('select', 'place', 'delete') */
  setTrainToolSubMode = (mode: 'select' | 'place' | 'delete'): void => {
    this.trainToolSubMode = mode
    this.tool = 'locomotive'
    if (mode !== 'delete') {
      this.hoveredTrainDeleteVehicle = null
    }
    if (mode !== 'place') {
      this.trainPlacementPreview = null
      this.couplerSnapTarget = null
      this.trainChainId = null
    }
    this.refreshCouplerPoints()
    this.notify()
  }

  /** Update vehicle hovered under cursor in delete mode */
  updateTrainDeleteHover = (worldPos: Point): void => {
    if (this.tool !== 'locomotive' || this.trainToolSubMode !== 'delete') {
      if (this.hoveredTrainDeleteVehicle !== null) {
        this.hoveredTrainDeleteVehicle = null
        this.notify()
      }
      return
    }
    const hit = this.findVehicleAt(worldPos)
    const oldHit = this.hoveredTrainDeleteVehicle
    if (hit?.vehicleId !== oldHit?.vehicleId || hit?.train.id !== oldHit?.train.id) {
      this.hoveredTrainDeleteVehicle = hit
      this.notify()
    }
  }

  /** Delete the vehicle directly under worldPos (used by Delete tool click) */
  deleteVehicleAt = (worldPos: Point): boolean => {
    if (this.isPlayMode) return false
    const hit = this.findVehicleAt(worldPos)
    if (hit) {
      if (hit.train.vehicles.length > 1) {
        const updated = removeVehicleFromTrainSet(this.network, hit.train, hit.vehicleId)
        if (updated) {
          this.trains = this.trains.map(t => t.id === hit.train.id ? updated : t)
          if (this.selectedTrainId === hit.train.id) {
            this.selectedTrainVehicleId = updated.vehicles[0]?.id ?? null
          }
        } else {
          this.removeTrainSet(hit.train.id)
        }
      } else {
        this.removeTrainSet(hit.train.id)
      }
      this.hoveredTrainDeleteVehicle = null
      this.refreshCouplerPoints()
      this.commitTrainChange()
      return true
    }

    if (this.locomotive) {
      const locoHit = hitTestTGVTrain(this.network, this.locomotive, worldPos, 4.0 / this.camera.scale)
      if (locoHit.hit) {
        this.removeLocomotive()
        this.hoveredTrainDeleteVehicle = null
        this.notify()
        return true
      }
    }
    return false
  }

  /** Delete the currently selected train or vehicle */
  deleteSelectedTrainOrVehicle = (): void => {
    if (this.isPlayMode) return
    if (!this.selectedTrainId) {
      if (this.locomotive) {
        this.removeLocomotive()
      }
      return
    }

    const train = this.selectedTrain
    if (!train) return

    // If a specific vehicle is selected within a multi-vehicle train
    if (this.selectedTrainVehicleId && train.vehicles.length > 1) {
      const updated = removeVehicleFromTrainSet(this.network, train, this.selectedTrainVehicleId)
      if (updated) {
        this.trains = this.trains.map(t => t.id === train.id ? updated : t)
        this.selectedTrainVehicleId = updated.vehicles[0]?.id ?? null
      } else {
        this.removeTrainSet(train.id)
      }
    } else {
      // Entire train (or single-vehicle train) deleted
      this.removeTrainSet(train.id)
    }
    this.refreshCouplerPoints()
    this.commitTrainChange()
  }

  /** Remove a TrainSet from the layout */
  removeTrainSet = (id: string): void => {
    this.trains = this.trains.filter(t => t.id !== id)
    if (this.selectedTrainId === id) {
      this.selectedTrainId = this.trains.length > 0 ? this.trains[0].id : null
      this.selectedTrainVehicleId = this.selectedTrain?.vehicles[0]?.id ?? null
      this.isTrainSelected = this.selectedTrainId !== null
    }
    if (this.trainChainId === id) this.trainChainId = null
    this.refreshCouplerPoints()
    this.notify()
  }

  /** Get the currently selected TrainSet (for driving) */
  get selectedTrain(): TrainSet | null {
    if (!this.selectedTrainId) return null
    return this.trains.find(t => t.id === this.selectedTrainId) ?? null
  }

  /** Put the selected train's combined handle on a notch (+ traction, 0 neutral, - brake) */
  setSelectedTrainNotch = (notch: number): void => {
    const train = this.selectedTrain
    if (train && setNotch(train, notch)) this.notify()
  }

  /** Move the selected train's handle by one notch towards traction (1) or brake (-1) */
  stepSelectedTrainNotch = (step: 1 | -1): void => {
    const train = this.selectedTrain
    if (train) this.setSelectedTrainNotch(train.notch + step)
  }

  /** Set the selected train's reverser (refused while moving or in traction) */
  setSelectedTrainReverser = (reverser: Reverser): void => {
    const train = this.selectedTrain
    if (train && setReverser(train, reverser)) this.notify()
  }

  /** Move the selected train's reverser one position towards forward (1) or reverse (-1) */
  shiftSelectedTrainReverser = (step: 1 | -1): void => {
    const train = this.selectedTrain
    if (train && shiftReverser(train, step)) this.notify()
  }

  /** Trigger the selected train's emergency brake, or release it once the train has stopped */
  toggleSelectedTrainEmergencyBrake = (): void => {
    const train = this.selectedTrain
    if (!train) return
    if (!train.emergencyBrake) triggerEmergencyBrake(train)
    else if (!releaseEmergencyBrake(train)) return
    this.notify()
  }

  /** Toggle coupling mode on/off */
  toggleCouplingMode = (): void => {
    if (this.tool === 'coupling') {
      this.tool = 'locomotive'
      this.trainToolSubMode = 'select'
    } else {
      if (this.isPlayMode) this.togglePlayMode()
      this.tool = 'coupling'
      this.hoveredTrainDeleteVehicle = null
      this.trainPlacementPreview = null
      this.couplerSnapTarget = null
      this.trainChainId = null
    }
    this.refreshCouplerPoints()
    this.notify()
  }

  /** Exit train mode back to standard rail layout mode */
  exitTrainMode = (): void => {
    this.tool = 'select'
    this.trainToolSubMode = 'place'
    this.isTrainSelected = false
    this.trainChainId = null
    this.locomotivePreview = null
    this.trainPlacementPreview = null
    this.couplerSnapTarget = null
    this.hoveredTrainDeleteVehicle = null
    this.refreshCouplerPoints()
    this.notify()
  }

  /** Set the vehicle kind to place (loco or wagon) and ensure locomotive tool is active */
  setTrainPlacementKind = (kind: 'tgv_loco' | 'tgv_wagon'): void => {
    this.trainPlacementKind = kind
    this.tool = 'locomotive'
    this.trainToolSubMode = 'place'
    this.hoveredTrainDeleteVehicle = null
    this.refreshCouplerPoints()
    this.notify()
  }

  /** Refresh the cached coupler points for rendering */
  refreshCouplerPoints = (): void => {
    if (this.tool === 'coupling') {
      this.couplerPoints = getAllCouplerPoints(this.network, this.trains)
    } else {
      this.couplerPoints = []
    }
  }

  /** Handle a click in coupling mode: couple two nearby ends or split at a joint (one undo step) */
  handleCouplingClick = (worldPos: Point): void => {
    if (this.isPlayMode) return
    const updated = handleCouplingClick(this.network, this.trains, worldPos)
    if (updated === this.trains) return
    this.trains = updated
    // The selected train may have been merged or split into trains with new ids
    if (!this.selectedTrain) {
      this.selectTrainById(this.trains.length > 0 ? this.trains[this.trains.length - 1].id : null)
    }
    this.repairTrainSelection()
    this.refreshCouplerPoints()
    this.commitTrainChange()
  }

  /** Find nearest coupler to a world position for hover highlight */
  findNearestCouplerAt = (worldPos: Point): CouplerPoint | null => {
    const nearest = findNearestCoupler(this.network, this.trains, worldPos)
    if (this.hoveredCouplerPoint !== nearest) {
      this.hoveredCouplerPoint = nearest
      this.notify()
    }
    return nearest
  }

  /** Tick all TrainSets that are in play mode */
  tickAllTrains = (dt: number): void => {
    if (!this.isPlayMode || dt <= 0) return
    for (const train of this.trains) {
      if (train.currentSpeed > 0 || train.notch > 0) {
        const moved = tickTrainSet(this.network, train, dt)
        if (!moved) {
          // End of track: stop dead and cut traction
          train.currentSpeed = 0
          train.notch = Math.min(train.notch, 0)
        }
      }
    }
    // Sync telemetry to legacy fields
    if (this.selectedTrain) {
      this.locomotiveCurrentSpeed = this.selectedTrain.currentSpeed
    }
    // Sync camera to selected train's lead vehicle
    if (this.followLocomotiveCamera && this.selectedTrain) {
      const lead = this.selectedTrain.vehicles[0]
      if (lead) {
        const pos = positionOnSegment(this.network, lead.front.segId, lead.front.t)
        if (pos) {
          this.camera.x = pos.x
          this.camera.y = pos.y
        }
      }
    }
    this.notify()
  }
}

/** Hook: subscribe a React component to store version changes. */
export function useEditorVersion(store: EditorStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion)
}
