import { useSyncExternalStore } from 'react'
import { DEFAULT_LINE_SETTINGS, type LineSettings, type LineType } from '@domain/models/speedLimits'
import { createCamera, clampScale, fitDimensions, type Camera } from '@infrastructure/render/camera'
import { createNetwork, resetIdCounter, removeNode, removeSegment, addNode, addSegment, addCurveSegment, pruneOrphanNodes, dissolveNode, generateId, nodeLevel, setNodesLevel, canSpreadGradient, gradientRun, spreadGradient } from '@domain/models/network'
import { separateLevelsAtNode, throughTracksAtNode } from '@domain/models/crossing'
import { computeParallelCurve } from '@domain/geometry/curve'
import { CURVE_RADII } from '@domain/profiles/profiles'
import { toggleJunction, toggleTurnoutHand, turnoutHandFlipSegments, findJunctionAtNode, findJunctionBySegment, autoDetectJunctions, doubleSlipSideToward, throwDoubleSlipSide, type DoubleSlipSide } from '@domain/models/junction'
import { reconcileNetworkIntersections } from '@domain/geometry/reconcile'
import { cleanSpeedZones } from '@domain/models/speedZones'
import { DEFAULT_SIGNALLING_SETTINGS, cleanSignals, isSignallingLevel, type SignallingLevel, type SignallingSettings } from '@domain/models/signals'
import {
  addSignal,
  addSignalPair,
  checkSignalPlacement,
  flipSignal,
  moveSignal,
  removeSignal,
  setSignalOptions,
  setSignalRole,
  signalsRevision,
  type SignalRefusal,
} from '@domain/models/signals'
import type { Signal, SignalRole } from '@domain/models/types'
import { addSignalRow, moveSignalsOffSwitches, signalForwardFor, signalRowPlaces, slideSignal } from '@domain/services/signalLayout'
import { signalHeadWorld } from '@infrastructure/render/signalRender'
import {
  createSignallingState,
  estimatedStoppingDistance,
  isNodeReserved,
  resetSignalling,
  signalSpeedCap,
  trainSignalView,
  updateSignalling,
  type SignalPassing,
  type SignallingOptions,
  type SignallingState,
  type TrainSignalView,
} from '@domain/models/signalling'
import { isCabSignalled } from '@domain/models/cabSignalling'
import { tickSignalling, type CabOverspeed } from '@domain/models/trainSignalling'
import { removeSpeedZone, setSpeedZoneSpeed, speedZonesAt, normalizeZoneSpeed } from '@domain/models/speedZones'
import { addSpeedZoneBetween } from '@domain/services/speedZoneLayout'
import type { TrackPoint } from '@domain/services/trackPath'
import { LINE_SPEED_RANGE, overlapsOfZone, rerailTrain } from '@domain/models/speedLimits'
import { CANT_RANGE } from '@domain/models/cant'
import { placementThresholds, type PlacementThresholds } from '@domain/geometry/scale'
import {
  saveNetworkToStorage,
  loadNetworkFromStorage,
  clearNetworkStorage,
  deserializeNetwork,
  serializeNetwork,
  type SerializedProject,
  type SignalDisplaySettings,
} from '@infrastructure/persistence/persistence'
import {
  loadConsolePreference,
  loadKeyPreferences,
  loadRemoteHostPreference,
  saveConsolePreference,
  saveKeyPreferences,
  saveRemoteHostPreference,
} from '@infrastructure/persistence/preferences'
import { isConsolePreference, type ConsolePreference } from '@application/console/consolePreference'
import { defaultKeybindings, mergeWithDefaults, shortcutLabel, type ActionId, type Keybindings } from '@application/keybindings/keybindings'
import type { Junction, JunctionId, Network, Point, Selection, Segment, SpeedZone } from '@domain/models/types'
import type { SectionMetadata } from '@domain/models/sections'
import { networkDerived } from '@infrastructure/render/networkDerived'
import { type Unit, type ScalePresetId, SCALE_PRESETS, LEVEL_HEIGHT_RANGE, MAX_GRADIENT_RANGE } from '@domain/models/units'
import type { GradientLimits } from '@domain/services/kinematicDiagnostics'
import type { Locomotive } from '@domain/models/locomotive'
import {
  createLocomotive,
  advanceLocomotive,
  snapToNearestTrack,
  steerJunction,
  findUpcomingJunction,
  getLocomotiveFrontPos,
  reverseTGVTrain,
  hitTestTGVTrain,
  positionOnSegment,
  type TrainHitResult,
} from '@domain/models/locomotive'
import type { TrainSet, Vehicle, CouplerSnapTarget, Reverser } from '@domain/models/train'
import { DEFAULT_ROLLING_STOCK, type RollingStockModel } from '@domain/models/rollingStock'
import { setBrakeCommand, trainDynamics, trainSlope, type BrakeCommand, type DrivingEnvironment, type TrainDynamics } from '@domain/models/trainDynamics'
import {
  TRAIN_CHAIN_SNAP_DISTANCE,
  MAX_NOTCH,
  MIN_NOTCH,
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
  switchDrivingCab,
  trainAnchors,
  realignTrains,
  tickTrainSet,
  handleCouplingClick,
  findNearestCoupler,
  getAllCouplerPoints,
  hitTestTrainSet,
  hitTestTrainVehicle,
  removeVehicleFromTrainSet,
  steerTrainSetJunction,
  isJunctionOccupied,
  isTrackOccupied,
  type TrainOccupancyCache,
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
  | 'signal'

/**
 * Sub-modes of the signalling mode (tool `signal`), in the order of the toolbar; `select` and
 * `delete` act on whatever the mode lays on the track. `blockSignal` lays a block signal (a
 * sémaphore at the pro level), `pathSignal` a path signal (a carré), `cabMarker` a marker board of a
 * cab-signalled line (pro level only).
 */
export const SIGNAL_SUB_MODES = ['select', 'blockSignal', 'pathSignal', 'cabMarker', 'speedZone', 'delete'] as const
export type SignalSubMode = (typeof SIGNAL_SUB_MODES)[number]

/** The sub-modes that lay a signal */
export type SignalPlacementMode = 'blockSignal' | 'pathSignal' | 'cabMarker'

const isSignalPlacementMode = (mode: SignalSubMode): mode is SignalPlacementMode =>
  mode === 'blockSignal' || mode === 'pathSignal' || mode === 'cabMarker'

/** The sub-modes a signalling level offers, in the order of its toolbar */
export function signalSubModesFor(level: SignallingLevel): SignalSubMode[] {
  return SIGNAL_SUB_MODES.filter((mode) => mode !== 'cabMarker' || level === 'pro')
}

/** Spacings (m, at standard gauge) the signal tools offer for a row of signals */
export const SIGNAL_ROW_SPACINGS = [250, 500, 1000, 1500, 2000, 2500] as const
export const DEFAULT_SIGNAL_ROW_SPACING = 1500
/** A press and release less than this far apart on screen (px) is a click, not a drag along the track */
export const SIGNAL_DRAG_THRESHOLD = 8

/** Feedback shown when a row of signals cannot be laid because no track joins its two ends */
export const SIGNAL_ROW_NO_PATH = 'Aucun chemin ne relie ces deux points de la voie'

/** Where the next click of a signal tool would lay its signal */
export interface SignalAim {
  place: TrackPoint
  /** Direction of travel the signal would speak to (see `Signal.forward`) */
  forward: boolean
  /** Why the signal cannot stand there, null when it can */
  refusal: SignalRefusal | null
}

/** What a gesture of a signal tool did */
export type SignalToolResult =
  | { ok: true; signals: Signal[]; refused: number }
  | { ok: false; reason: SignalRefusal | 'driving' | 'no-path' }

/** Speed (km/h) of the first zone the speed limit tool lays */
export const DEFAULT_ZONE_TOOL_SPEED = 80

/** Highest speed (km/h) a zone is given from the interface: the highest line speed */
export const MAX_ZONE_SPEED = LINE_SPEED_RANGE.max

/** Feedback shown when a click of the speed limit tool is not on a rail */
export const SPEED_ZONE_OFF_TRACK = 'Limite de vitesse : cliquez sur une voie'
/** Feedback shown when no track joins the two ends of a speed zone */
export const SPEED_ZONE_NO_PATH = 'Aucun chemin ne relie ces deux points de la voie'
/** Feedback shown when a zone laid or changed shares track with another one */
export const SPEED_ZONE_OVERLAP = 'Cette zone en chevauche une autre : la limite la plus basse s’applique'

/** What a click of the speed limit tool did */
export type SpeedZoneClick = 'started' | 'placed' | 'off-track' | 'no-path' | 'refused'

export type TrackMode = 'catalog' | 'freeform'

/** Name given to a project the user has not renamed yet. */
export const DEFAULT_PROJECT_NAME = 'Réseau sans titre'

/** Feedback shown when a vehicle cannot be placed where the user clicked or dropped it. */
export const TRAIN_PLACEMENT_REFUSED = 'Pose impossible ici : approchez le curseur d’un rail'

/** Feedback shown when a junction is not thrown because a train stands over its points. */
export const JUNCTION_OCCUPIED_REFUSED = 'Aiguillage occupé par un train : manœuvre impossible'

/** Feedback shown when a junction is not thrown because it is held for a train that has its route over it. */
export const JUNCTION_RESERVED_REFUSED = 'Aiguillage réservé pour le trajet d’un train : manœuvre impossible'

/** Why a junction cannot be thrown: a train stands over its points, or it is part of a route held for a train */
export type JunctionLock = 'occupied' | 'reserved'

/** Feedback shown when a train has passed a closed signal against the rules */
export function signalPassedMessage(braked: boolean): string {
  return braked ? 'Signal fermé franchi : freinage d’urgence' : 'Signal fermé franchi'
}

/** Feedback shown when a train was caught overspeeding by its cab signalling */
export function overspeedMessage(braked: boolean): string {
  return braked ? 'Survitesse : freinage d’urgence' : 'Survitesse'
}

/** Impact speed (m/s) above which hitting a buffer stop or another train is reported: 5 km/h */
export const IMPACT_REPORT_SPEED = 5 / 3.6

/** Feedback shown when a train hits an obstacle at `speed` m/s */
export function trainImpactMessage(speed: number): string {
  return `Choc à ${Math.round(speed * 3.6)} km/h`
}

export type ThemeMode = 'light' | 'dark' | 'auto'

/** Who holds the brake handle of the driven train: this screen and its keyboard, or the phone desk */
export type BrakeSource = 'local' | 'remote'

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
  /** Inspector state before driving started, restored when driving stops */
  private sidePanelOpenBeforeDriving = false

  // Mode double voie : Shift+Click pour poser 2 rails en parallele simultanement
  parallelMode = false
  /** Double track asked for from the contextual bar: the next clicks behave like Maj+clic */
  parallelArmed = false
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
  /** Called when a driven train hits an obstacle faster than IMPACT_REPORT_SPEED (speed in m/s) */
  onTrainImpact: ((train: TrainSet, speed: number) => void) | null = null
  /** Trains whose current impact has already been reported */
  private impactReported = new Set<string>()
  /** Called once each time a train passes a closed signal against the rules of the signalling level */
  onSignalPassed: ((train: TrainSet, passing: SignalPassing) => void) | null = null
  /** Called once each time a train is caught overspeeding by its cab signalling (pro level, high-speed line) */
  onOverspeed: ((train: TrainSet, overspeed: CabOverspeed) => void) | null = null
  levelHeight: number = 6 // height of one track level in world meters (6 m at 1:1, scaled down for model scales)
  maxGradient: number = 35 // steepest slope allowed, in ‰ (a ramp above it is reported)
  lineSpeed: number = DEFAULT_LINE_SETTINGS.lineSpeed // ceiling speed of the line, km/h
  lineType: LineType = DEFAULT_LINE_SETTINGS.lineType // conventional or high-speed line: rules for cant
  /** Signalling level of the project: the same signals read as block / path signals or as French signals */
  signallingLevel: SignallingLevel = DEFAULT_SIGNALLING_SETTINGS.level
  /** Passing a closed signal applies the emergency brake */
  signalStopEnforced: boolean = DEFAULT_SIGNALLING_SETTINGS.stopEnforced
  /**
   * What the signals show and the track each train holds: simulation state, brought up to date at
   * every simulation step while driving (`tickAllTrains`) and empty otherwise. Never saved.
   */
  signalling: SignallingState = createSignallingState()
  /** Why the last junction throw was refused, null when it went through */
  lastJunctionRefusal: JunctionLock | null = null
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
  /** A phone holds the driving desk (set by the remote session): this screen then only watches */
  remoteDeskConnected = false
  /** Train the camera follows while spectating; null = the train the phone drives */
  spectatedTrainId: string | null = null

  /** True while a phone drives and this screen watches: no console here, no driving from this keyboard */
  get isSpectating(): boolean {
    return this.isPlayMode && this.remoteDeskConnected
  }

  /** The train the camera follows in driving mode: the spectated one while spectating, else the driven one */
  get cameraTrain(): TrainSet | null {
    if (this.isSpectating && this.spectatedTrainId) {
      const spectated = this.trains.find((t) => t.id === this.spectatedTrainId)
      if (spectated) return spectated
    }
    return this.selectedTrain
  }

  /** Called by the remote session when a phone takes or leaves the desk */
  setRemoteDeskConnected = (connected: boolean): void => {
    if (this.remoteDeskConnected === connected) return
    this.remoteDeskConnected = connected
    this.spectatedTrainId = null
    this.notify()
  }

  /** While spectating: follow this train with the camera (null = the train the phone drives) */
  spectateTrain = (trainId: string | null): void => {
    this.spectatedTrainId = trainId !== null && this.trains.some((t) => t.id === trainId) ? trainId : null
    this.followLocomotiveCamera = true
    this.centreCameraOnTrain(this.cameraTrain)
    this.notify()
  }

  /** While spectating: stop following any train, the view moves freely */
  setSpectatorFreeView = (): void => {
    this.followLocomotiveCamera = false
    this.notify()
  }

  private centreCameraOnTrain(train: TrainSet | null): void {
    const lead = train?.vehicles[0]
    const pos = lead ? positionOnSegment(this.network, lead.front.segId, lead.front.t) : null
    if (pos) {
      this.camera.x = pos.x
      this.camera.y = pos.y
    }
  }
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
  trainPlacementModel: RollingStockModel = DEFAULT_ROLLING_STOCK // Rolling stock of the vehicles placed next

  // --- New: TrainSet fleet ---
  /** All train sets on the layout (independent or coupled rakes) */
  trains: TrainSet[] = []
  /** ID of the train currently selected / driven */
  selectedTrainId: string | null = null
  /** ID of the specific vehicle (loco or wagon) currently selected within the train */
  selectedTrainVehicleId: string | null = null
  /** Train tool submode: 'select' (inspect / drive, the default so a click never places by accident), 'place' (place loco or wagon), or 'delete' (hover red outline & click to delete) */
  trainToolSubMode: 'select' | 'place' | 'delete' = 'select'
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

  // --- Signalling mode (tool `signal`) ---
  /** Sub-mode of the signalling mode: only one is active at a time */
  signalToolSubMode: SignalSubMode = 'select'
  /** First click of the speed limit tool: where the zone starts */
  speedZoneStart: TrackPoint | null = null
  /** Speed (km/h) of the next zone the speed limit tool lays */
  speedZoneToolSpeed = DEFAULT_ZONE_TOOL_SPEED
  /** Speed zone picked in the signalling mode */
  selectedSpeedZoneId: string | null = null
  /** Speed zone under the cursor in the signalling mode (select and delete sub-modes) */
  hoveredSpeedZoneId: string | null = null
  /** Signal tools: lay two signals back to back, one for each direction of travel */
  signalToolBothWays = false
  /** Signal tools: the signal speaks to the direction opposite to the side of the track the cursor is on */
  signalToolFlipped = false
  /** Signal tools: distance between the signals of a row, m at standard gauge (see `signalRowSpacing`) */
  signalToolSpacing: number = DEFAULT_SIGNAL_ROW_SPACING
  /** Marker board tool (pro level): the board laid is passable (`spacing`, F) or not (`protection`, Nf) */
  signalToolCabRole: SignalRole = 'spacing'
  /** Signal tools: where the button went down on the track; a drag from there lays a row */
  signalRowStart: SignalAim | null = null
  /** Signal tools: where the drag along the track has got to; null while the gesture is still a click */
  signalRowEnd: TrackPoint | null = null
  /** Signal picked in the signalling mode */
  selectedSignalId: string | null = null
  /** Signal under the cursor in the signalling mode (select and delete sub-modes) */
  hoveredSignalId: string | null = null
  /** The signal being dragged along the track, and where it stood when the drag began */
  signalDrag: { id: string; origin: { segId: string; t: number; forward: boolean } } | null = null
  /**
   * Display: every block as a coloured stripe along the track. Saved with the project when ticked,
   * restored when it is loaded; a display setting, so undo leaves it alone.
   */
  showSignalBlocks = false
  /** Display, while driving: the track held for each train. Saved and restored like `showSignalBlocks` */
  showSignalReservations = false
  /** Display: cant and slopes marked on the track. On by default; saved and restored like `showSignalBlocks` */
  showInclination = true
  /**
   * The blocks show while a signal is being laid or moved, whatever `showSignalBlocks` says, until
   * the display is unticked during it: this then stays off for the session. Not saved.
   */
  signalBlocksWhilePlacing = true

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
    this.parallelArmed = false
    this.parallelLastNodeId = null
    this.measureStart = null
    this.measureEnd = null
    this.isMeasuring = false
    this.speedZoneStart = null
    this.signalRowStart = null
    this.signalRowEnd = null
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

  /** The network whose signals were last checked against its points */
  private signalsSettledOn: Network | null = null

  /**
   * Push back the signals that points built by the edit being committed have left too near them
   * (`moveSignalsOffSwitches`), so that the move is part of the same undo step as the points. Only
   * done on the network being edited: a project just loaded, an undo step or a new project are
   * taken as they are (the signalling report names a signal that stands too near points).
   */
  private settleSignals(): void {
    const net = this.network
    const known = this.signalsSettledOn === net
    this.signalsSettledOn = net
    if (known && net.signals.size > 0) moveSignalsOffSwitches(net, this.signalPlacementOptions)
  }

  /** `settled`: the signals have just been checked against the points (`markDirty` does it before saving) */
  pushHistorySnapshot = (settled: boolean = false): void => {
    if (this.isUndoingRedoing) return
    if (!settled) this.settleSignals()
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
      this.gradientLimits,
      this.lineSettings,
      this.signallingSettings,
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
        this.restoreGradientSettings(res)
        this.restoreLineSettings(res)
        this.restoreSignallingSettings(res)
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
        this.restoreGradientSettings(res)
        this.restoreLineSettings(res)
        this.restoreSignallingSettings(res)
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
  /** Driving console asked for in Affichage; `auto` picks one from the size of the window */
  consolePreference: ConsolePreference = 'auto'
  /** Address of this PC on the local network, typed by the user for the phone desk; empty when none */
  remoteDeskHost = ''
  /** What each side holds the brake handle on (see `setSelectedTrainBrakeCommand`), and on which train */
  private brakeHolds: Record<BrakeSource, BrakeCommand> = { local: 'hold', remote: 'hold' }
  private brakeHoldTrainId: string | null = null
  projectName = DEFAULT_PROJECT_NAME
  dirty = false

  setSectionMeta = (sectionId: string, meta: Partial<SectionMetadata>): void => {
    this.setSectionsMeta([sectionId], meta)
  }

  /** Apply the same metadata to several sections as one edit (one undo step) */
  setSectionsMeta = (sectionIds: string[], meta: Partial<SectionMetadata>): void => {
    if (sectionIds.length === 0) return
    for (const sectionId of sectionIds) {
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
    }
    this.markDirty()
    this.notify()
  }

  // --- Keyboard shortcuts (user preference, stored apart from the project) ---
  keybindings: Keybindings = defaultKeybindings()
  /** Key position → character on the user's keyboard layout, for displaying position-bound keys */
  keyLabels: Record<string, string> = {}

  private loadKeyPreferences(): void {
    const prefs = loadKeyPreferences()
    if (!prefs) return
    this.keybindings = mergeWithDefaults(prefs.bindings)
    this.keyLabels = prefs.labels
  }

  private saveKeyPreferences(): void {
    saveKeyPreferences({ bindings: this.keybindings, labels: this.keyLabels })
  }

  setKeybindings = (bindings: Keybindings): void => {
    this.keybindings = bindings
    this.saveKeyPreferences()
    this.notify()
  }

  resetKeybindings = (): void => {
    this.setKeybindings(defaultKeybindings())
  }

  /** Record the characters the user's layout produces (from the browser's layout map or key presses) */
  setKeyLabels = (labels: Record<string, string>): void => {
    let changed = false
    for (const [code, label] of Object.entries(labels)) {
      if (this.keyLabels[code] !== label) {
        this.keyLabels = { ...this.keyLabels, [code]: label }
        changed = true
      }
    }
    if (!changed) return
    this.saveKeyPreferences()
    this.notify()
  }

  /** Label of the key bound to an action, as printed on the user's keyboard ('' when unassigned) */
  shortcutLabel = (actionId: ActionId): string => shortcutLabel(this.keybindings, actionId, this.keyLabels)

  /** " (X)" suffix for a tooltip, or '' when the action has no key */
  shortcutHint = (actionId: ActionId): string => {
    const label = this.shortcutLabel(actionId)
    return label ? ` (${label})` : ''
  }

  constructor() {
    this.loadKeyPreferences()
    const savedConsole = loadConsolePreference()
    if (isConsolePreference(savedConsole)) this.consolePreference = savedConsole
    this.remoteDeskHost = loadRemoteHostPreference()
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
    this.restoreGradientSettings(saved)
    this.restoreLineSettings(saved)
    this.restoreSignallingSettings(saved)
    this.restoreSignalDisplay(saved)
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
    this.restoreGradientSettings(res)
    this.restoreLineSettings(res)
    this.restoreSignallingSettings(res)
    this.restoreSignalDisplay(res)
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
      networkDerived(this.network, this.sectionMeta).sections,
      this.unit,
      this.scalePreset,
      this.gauge,
      this.trackSpacing,
      this.showDimensions,
      this.boardEnabled,
      this.boardWidth,
      this.boardHeight,
      this.trains,
      this.gradientLimits,
      this.lineSettings,
      this.signallingSettings,
      this.signalDisplaySettings,
    )
  }

  /**
   * Immediately save layout state to localStorage.
   */
  savePersistedState = (): void => {
    const sections = networkDerived(this.network, this.sectionMeta).sections
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
      this.gradientLimits,
      this.lineSettings,
      this.signallingSettings,
      this.signalDisplaySettings,
    )
  }

  /**
   * Reset the project to a fresh empty layout and clear localStorage.
   */
  newProject = (): void => {
    this.network = createNetwork()
    this.locomotive = null
    this.restoreTrains([])
    this.restoreSignallingSettings({})
    this.restoreSignalDisplay({})
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
    // The domain moves the zones itself when a rail is replaced; this only drops what would be
    // left on a rail taken out of the graph by other means
    cleanSpeedZones(this.network)
    cleanSignals(this.network)
    this.syncTrainsWithNetwork()
    this.version++
    this.listeners.forEach((l) => l())
  }

  /**
   * Tell the canvas and the mini-map that the camera moved, and nothing else: the version the React
   * components follow stays the same, so no panel is rendered again, and the network is not
   * checked. Only for a change no component shows — none reads the camera while rendering. Anything
   * else changed with it calls `notify`.
   */
  notifyView = (): void => {
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

    // Zones are only picked inside the signalling mode, which always opens on its selection
    if (t !== 'signal' || this.tool !== 'signal') {
      this.signalToolSubMode = 'select'
      this.selectedSpeedZoneId = null
      this.hoveredSpeedZoneId = null
      this.cancelSignalGesture()
      this.selectedSignalId = null
      this.hoveredSignalId = null
      this.signalToolFlipped = false
    }
    // Entering it drops the track selection: Delete must never reach a rail from there
    if (t === 'signal' && this.tool !== 'signal') this.selection = { nodes: new Set(), segments: new Set() }

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
    this.parallelArmed = false
    this.parallelLastNodeId = null
    this.notify()
  }

  /** True when the track tools lay a double track: a pair is in progress, or it was asked for. */
  get isParallelActive(): boolean {
    return this.parallelMode || this.parallelArmed
  }

  /** Switch double-track laying on (for the next rails) or off (the pair in progress ends). */
  toggleParallelMode = (): void => {
    if (this.isParallelActive) {
      this.exitParallelMode()
    } else {
      this.parallelArmed = true
      this.notify()
    }
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
      // The copy runs alongside its model, at the same heights
      const node = addNode(net, target, nodeLevel(net.nodes.get(nid)))
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

    const newNodeA = addNode(this.network, p2A, nodeLevel(nodeA))
    const newNodeB = addNode(this.network, p2B, nodeLevel(nodeB))

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
    // The rail runs from the height of one node to the height of the other (a ramp when they differ)
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
    this.setSidePanelOpen(!this.isSidePanelOpen)
  }

  setSidePanelOpen = (v: boolean): void => {
    // The inspector stays closed while driving (clean view); it comes back on exit
    if (this.isPlayMode) return
    this.isSidePanelOpen = v
    this.notify()
  }

  setTheme = (t: ThemeMode): void => {
    this.theme = t
    this.notify()
  }

  /** Choose the driving console; the choice follows the user across projects */
  setConsolePreference = (preference: ConsolePreference): void => {
    if (this.consolePreference === preference) return
    this.consolePreference = preference
    saveConsolePreference(preference)
    this.notify()
  }

  /** Kept as typed: whoever builds the pairing address validates it */
  setRemoteDeskHost = (host: string): void => {
    if (this.remoteDeskHost === host) return
    this.remoteDeskHost = host
    saveRemoteHostPreference(host)
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
      this.levelHeight = preset.defaultLevelHeight
      this.maxGradient = preset.defaultMaxGradient
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
    if (!this.isUndoingRedoing) this.settleSignals()
    this.savePersistedState()
    this.pushHistorySnapshot(true)
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
    // A signal being laid or dragged is dropped first (the dragged one goes back where it stood)
    const hadSignalGesture = this.cancelSignalGesture()
    const hadPending =
      hadPlacement ||
      this.measureStart !== null ||
      this.speedZoneStart !== null ||
      hadSignalGesture ||
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
    if (this.draggedNodeInitialPositions.size > 0) this.realignTrains()
    this.unpinTrains()
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
    } else if (this.tool === 'signal' && this.stepBackSignalMode()) {
      // Signalling climbs one level at a time, like the train mode: see `stepBackSignalMode`
    } else if (this.tool !== 'select') {
      this.setTool('select')
    } else {
      // A train picked from the select tool is released like any other selection
      this.releaseTrainSelection()
      this.clearSelection()
    }
    if (this.tool === 'locomotive' || this.tool === 'coupling') {
      // Escape climbs one level at a time: placement (and its train in progress), deletion or
      // coupling first fall back to the train selection, then the selected train is released,
      // and only from there does it go back to the select tool
      if (this.tool === 'coupling' || this.trainToolSubMode !== 'select') {
        this.tool = 'locomotive'
        this.trainToolSubMode = 'select'
      } else if (this.isTrainSelected) {
        this.releaseTrainSelection()
      } else {
        this.tool = 'select'
        this.trainToolSubMode = 'select'
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
    // Signalling mode: the only thing Delete removes is the selected zone
    if (this.tool === 'signal') {
      if (!this.deleteSelectedSignal()) this.deleteSelectedSpeedZone()
      return
    }
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

    // 4. Bring the route tables in line with what is left of the track
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
   * Raise (`delta` > 0) or lower the selection by `delta` levels: the nodes of the selected rails
   * (each node once, from its own height), or the selected nodes when no rail is selected. The
   * rails are not touched: an unselected neighbour that shares a moved node becomes a ramp.
   * Where a selected track crosses an unselected one on a shared node (a diamond), the node is
   * split first so that only the selected track moves: the crossing becomes a bridge.
   * Returns true when at least one node changed height.
   */
  shiftSelectionLevel = (delta: number): boolean => {
    const net = this.network
    const step = Math.round(delta)
    if (step === 0) return false

    const selected = this.selection.segments
    const nodeIds = new Set<string>()
    const shifted = new Map<string, string>() // rail -> ancestor its pieces would name
    for (const sid of selected) {
      const seg = net.segments.get(sid)
      if (!seg) continue
      shifted.set(sid, seg.parentSegmentId ?? sid)
      nodeIds.add(seg.from)
      nodeIds.add(seg.to)
    }
    if (shifted.size === 0) {
      for (const nid of this.selection.nodes) if (net.nodes.has(nid)) nodeIds.add(nid)
    }
    if (nodeIds.size === 0) return false

    // Rails keep their shape, and the trains their place: a rail that reconcile cuts (a bridge
    // brought down onto the track it spanned) is handled like any other cut
    this.pinTrains()
    let changed = 0
    for (const nid of nodeIds) {
      const target = nodeLevel(net.nodes.get(nid)) + step
      // A level crossing of a selected track with an unselected one becomes a bridge...
      const through = throughTracksAtNode(net, nid)
      const own = through?.tracks.find((track) => track.every((seg) => selected.has(seg.id)))
      const other = through?.tracks.find((track) => track !== own)
      if (own && other && !other.some((seg) => selected.has(seg.id)) && separateLevelsAtNode(net, nid, own[0].id, target)) {
        changed++
        continue
      }
      changed += setNodesLevel(net, [nid], target)
    }
    if (changed === 0) {
      this.unpinTrains()
      return false
    }
    // ...and a bridge brought back to the height of the track under it becomes a crossing again
    const before = new Set(net.segments.keys())
    this.reconcileNetwork()
    this.realignTrains()
    this.unpinTrains()

    // Keep the selection on the same track: the pieces of a shifted rail that was cut replace it
    const cutAncestors = new Set([...shifted].filter(([sid]) => !net.segments.has(sid)).map(([, ancestor]) => ancestor))
    const segments = new Set([...this.selection.segments].filter((sid) => net.segments.has(sid)))
    for (const seg of net.segments.values()) {
      if (!before.has(seg.id) && seg.parentSegmentId && cutAncestors.has(seg.parentSegmentId)) segments.add(seg.id)
    }
    const nodes = new Set([...this.selection.nodes].filter((nid) => net.nodes.has(nid)))
    this.selection = { ...this.selection, nodes, segments }

    this.markDirty()
    this.notify()
    return true
  }

  /**
   * True when « Lisser la pente » would change something: the selected rails form one run laid
   * end to end (at least two rails, no fork among them), its two ends are not at the same height,
   * and a node inside it is not on the even slope between them. A run that comes back to the
   * height it left (a whole bridge with its two ramps) is left out on purpose: evening it out
   * would flatten the bridge.
   */
  get canSpreadSelectionGradient(): boolean {
    const run = gradientRun(this.network, this.selection.segments)
    if (!run) return false
    const first = nodeLevel(this.network.nodes.get(run.nodeIds[0]))
    const last = nodeLevel(this.network.nodes.get(run.nodeIds[run.nodeIds.length - 1]))
    return first !== last && canSpreadGradient(this.network, this.selection.segments)
  }

  /**
   * Even out the slope along the selected run of rails: the heights of its inner nodes are set so
   * that every rail climbs at the same rate between its two ends. Returns true when a node moved.
   */
  spreadSelectionGradient = (): boolean => {
    const net = this.network
    if (!this.canSpreadSelectionGradient) return false

    // Same sequence as shiftSelectionLevel: the rails keep their shape and the trains their place,
    // and a node brought to the height of a track it was passing over or under meets it
    this.pinTrains()
    if (spreadGradient(net, this.selection.segments) === 0) {
      this.unpinTrains()
      return false
    }
    this.reconcileNetwork()
    this.realignTrains()
    this.unpinTrains()

    const segments = new Set([...this.selection.segments].filter((sid) => net.segments.has(sid)))
    const nodes = new Set([...this.selection.nodes].filter((nid) => net.nodes.has(nid)))
    this.selection = { ...this.selection, nodes, segments }

    this.markDirty()
    this.notify()
    return true
  }

  /** What slopes are measured against (see `analyzeKinematics`): the two slope settings of the project */
  get gradientLimits(): GradientLimits {
    return { levelHeight: this.levelHeight, maxGradient: this.maxGradient }
  }

  /**
   * Change the height of one level (world metres) and / or the steepest slope allowed (‰).
   * A value that is not a positive finite number is ignored; the others are kept within
   * LEVEL_HEIGHT_RANGE / MAX_GRADIENT_RANGE. One undo step when something changed.
   */
  setGradientSettings = (settings: { levelHeight?: number; maxGradient?: number }): void => {
    const within = (value: number | undefined, range: { min: number; max: number }, current: number): number =>
      typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.max(range.min, Math.min(range.max, value))
        : current
    const levelHeight = within(settings.levelHeight, LEVEL_HEIGHT_RANGE, this.levelHeight)
    const maxGradient = within(settings.maxGradient, MAX_GRADIENT_RANGE, this.maxGradient)
    if (levelHeight === this.levelHeight && maxGradient === this.maxGradient) return
    this.levelHeight = levelHeight
    this.maxGradient = maxGradient
    this.markDirty()
    this.notify()
  }

  /** Slope settings read from a project; one saved without them gets those of its scale */
  private restoreGradientSettings(saved: { levelHeight?: number; maxGradient?: number }): void {
    const preset = SCALE_PRESETS[this.scalePreset] ?? SCALE_PRESETS['1:1']
    this.levelHeight = saved.levelHeight ?? preset.defaultLevelHeight
    this.maxGradient = saved.maxGradient ?? preset.defaultMaxGradient
  }

  /** Line settings read from a project; one saved without them is on the default line */
  private restoreLineSettings(saved: { lineSpeed?: number; lineType?: LineType }): void {
    this.lineSpeed = saved.lineSpeed ?? DEFAULT_LINE_SETTINGS.lineSpeed
    this.lineType = saved.lineType ?? DEFAULT_LINE_SETTINGS.lineType
  }

  /** Signalling settings read from a project; one saved without them is on the default ones */
  private restoreSignallingSettings(saved: { signallingLevel?: SignallingLevel; signalStopEnforced?: boolean }): void {
    this.signallingLevel = saved.signallingLevel ?? DEFAULT_SIGNALLING_SETTINGS.level
    this.signalStopEnforced = saved.signalStopEnforced ?? DEFAULT_SIGNALLING_SETTINGS.stopEnforced
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

  /** True when a vehicle stands over the points of the junction: it cannot be thrown */
  isJunctionOccupied = (junc: Junction): boolean => isJunctionOccupied(this.network, junc, this.trains)

  /**
   * Why the junction cannot be thrown, null when it can: a vehicle stands over its points, or it is
   * part of the track held for a train (see `signalling`). `exceptTrainId` names a train whose own
   * reservation does not count: the driver of a train may still set the points ahead of it.
   */
  junctionLock = (junc: Junction, exceptTrainId?: string | null): JunctionLock | null => {
    if (this.isJunctionOccupied(junc)) return 'occupied'
    return isNodeReserved(this.signalling, junc.nodeId, exceptTrainId) ? 'reserved' : null
  }

  /** What to tell the user after a refused junction throw (see `lastJunctionRefusal`) */
  get junctionRefusalMessage(): string {
    return this.lastJunctionRefusal === 'reserved' ? JUNCTION_RESERVED_REFUSED : JUNCTION_OCCUPIED_REFUSED
  }

  /**
   * Throw the given junction, or the junction(s) of the current selection.
   * A junction with a train standing over its points, or held for the route of a train, is left as
   * it is; returns false when a throw was refused for that reason: `lastJunctionRefusal` then says
   * which, and `junctionRefusalMessage` gives the text (JUNCTION_OCCUPIED_REFUSED or
   * JUNCTION_RESERVED_REFUSED).
   * A double slip has two sets of points: `near` (a world position) throws the one on that side of
   * the node, and without it the device goes through its four positions in turn.
   */
  toggleActiveJunction = (junctionId?: JunctionId, near?: Point): boolean => {
    let targets: Junction[] = []
    if (junctionId) {
      const junc = this.network.junctions.get(junctionId)
      if (junc) targets = [junc]
    } else {
      let junc: Junction | undefined
      for (const nid of this.selection.nodes) {
        junc = findJunctionAtNode(this.network, nid)
        if (junc) break
      }
      if (!junc) {
        for (const sid of this.selection.segments) {
          junc = findJunctionBySegment(this.network, sid)
          if (junc) break
        }
      }
      if (junc) targets = [junc]
    }

    return this.throwJunctions(targets, (junc) => {
      const side = near ? doubleSlipSideToward(this.network, junc, near) : null
      if (side !== null) throwDoubleSlipSide(junc, side)
      else toggleJunction(junc)
    })
  }

  /** Throw the points of one side of a double slip. Refused like `toggleActiveJunction`. */
  throwDoubleSlipSide = (junctionId: JunctionId, side: DoubleSlipSide): boolean => {
    const junc = this.network.junctions.get(junctionId)
    return this.throwJunctions(junc ? [junc] : [], (target) => throwDoubleSlipSide(target, side))
  }

  /** Change the position of the junctions that are free to move; returns false when one was not */
  private throwJunctions(targets: Junction[], change: (junc: Junction) => void): boolean {
    const locks = targets.map((junc) => this.junctionLock(junc))
    const free = targets.filter((_, i) => locks[i] === null)
    this.lastJunctionRefusal = locks.find((lock) => lock !== null) ?? null
    for (const junc of free) change(junc)
    if (free.length > 0) {
      this.markDirty()
      this.notify()
    }
    return free.length === targets.length
  }

  /**
   * Mirror the diverging branch of the given turnout, or of the turnout of the current selection.
   * It is refused (returns false) while a train stands over the points or anywhere on the track
   * the flip relocates (the diverging branch and the rails attached to its end), which would be
   * pulled from under its vehicles, or while the turnout is held for the route of a train
   * (`lastJunctionRefusal` says which).
   */
  toggleTurnoutHandAtSelection = (junctionId?: JunctionId): boolean => {
    let junc: Junction | undefined = junctionId ? this.network.junctions.get(junctionId) : undefined
    if (!junctionId) {
      for (const nid of this.selection.nodes) {
        junc = findJunctionAtNode(this.network, nid)
        if (junc) break
      }
      if (!junc) {
        for (const sid of this.selection.segments) {
          junc = findJunctionBySegment(this.network, sid)
          if (junc) break
        }
      }
    }
    if (!junc) return true
    this.lastJunctionRefusal = this.junctionLock(junc)
    if (this.lastJunctionRefusal) return false
    if (isTrackOccupied(this.network, turnoutHandFlipSegments(this.network, junc), this.trains)) {
      this.lastJunctionRefusal = 'occupied'
      return false
    }
    toggleTurnoutHand(this.network, junc.id)
    this.markDirty()
    this.notify()
    return true
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
    // Coupled to a train, the chosen heading turns the vehicle around within the rake
    const flipped = this.trainPlacementDirection === -1
    const model = this.trainPlacementModel

    // 1. Train in progress: its free ends reach further, so the next click along the track extends it
    const chain = this.trainChain
    if (chain) {
      const chainSnapDist = Math.max(TRAIN_CHAIN_SNAP_DISTANCE, 60 / this.camera.scale)
      const snap = findCouplerSnap(this.network, [chain], worldPos, kind, chainSnapDist, flipped, model)
      if (snap) return { snap, vehicle: snap.snappedVehicle }
    }

    // 2. Magnetic coupler snap with any train
    const maxCouplerSnapDist = Math.max(6.0, 30 / this.camera.scale)
    const snap = findCouplerSnap(this.network, this.trains, worldPos, kind, maxCouplerSnapDist, flipped, model)
    if (snap) return { snap, vehicle: snap.snappedVehicle }

    // 3. Free placement on the track under the cursor, with the chosen heading: a new train
    const maxTrackSnapDist = Math.max(12.0, 45 / this.camera.scale)
    const trackSnap = snapToNearestTrack(this.network, worldPos, maxTrackSnapDist)
    if (!trackSnap) return null
    const vehicle = createVehicle(this.network, trackSnap.segId, trackSnap.t, kind, this.trainPlacementDirection, model)
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
    this.forgetBrakeHolds(null)
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
      // Clean driving view: the inspector closes, and reopens when driving stops
      this.sidePanelOpenBeforeDriving = this.isSidePanelOpen
      this.isSidePanelOpen = false
      this.closeContextMenu()
      if (this.trains.length > 0 && !this.selectedTrain) {
        this.selectTrainById(this.trains[0].id)
      }
      // Every train starts at rest with its brakes applied: the driver releases them to leave
      for (const t of this.trains) resetTrainControls(t)
      this.impactReported.clear()
      // Signals show their state from the first frame
      resetSignalling(this.signalling)
      this.refreshSignalling()
      if (this.followLocomotiveCamera) {
        this.focusOnLocomotive()
      }
      this.startSimulationLoop()
    } else {
      this.isSidePanelOpen = this.sidePanelOpenBeforeDriving
      this.stopSimulationLoop()
      resetSignalling(this.signalling)
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
      // Points held for another train stay as they are; the driver may still set those held for his own
      const heldForAnother = (junc: Junction): boolean => isNodeReserved(this.signalling, junc.nodeId, train.id)
      if (steerTrainSetJunction(this.network, train, steerDirection, this.trains, heldForAnother)) this.notify()
      return
    }
    if (!this.locomotive) return
    const upcoming = findUpcomingJunction(this.network, this.locomotive)
    if (upcoming && this.isJunctionOccupied(upcoming.junction)) return
    steerJunction(this.network, this.locomotive, steerDirection)
    this.notify()
  }

  /**
   * Take the controls from the cab at the other end of the driven train (stopped trains only).
   * Returns false when there is no power car at the other end or the train is moving.
   */
  switchSelectedTrainCab = (): boolean => {
    const train = this.selectedTrain
    const switched = train && switchDrivingCab(train)
    if (!train || !switched) return false
    this.trains = this.trains.map((t) => (t === train ? switched : t))
    this.selectedTrainVehicleId = switched.vehicles[0].id
    this.refreshCouplerPoints()
    if (this.isPlayMode && this.followLocomotiveCamera) {
      const lead = switched.vehicles[0].front
      const pos = positionOnSegment(this.network, lead.segId, lead.t)
      if (pos) {
        this.camera.x = pos.x
        this.camera.y = pos.y
      }
    }
    this.notify()
    return true
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

  /** Where every train stood when the current node drag started (see pinTrains) */
  private trainAnchors: Map<string, Point> | null = null

  /** Start of a rail reshape (node drag, gizmo): remember where the trains stand */
  pinTrains = (): void => {
    this.trainAnchors = this.trains.length > 0 ? trainAnchors(this.network, this.trains) : null
  }

  /** End of the rail reshape started by pinTrains */
  unpinTrains = (): void => {
    this.trainAnchors = null
  }

  /**
   * Re-lay the trains after rails were reshaped under them: each train stays where it stood
   * when the reshape started and keeps its length, only the rail changes.
   */
  realignTrains = (): void => {
    if (this.trains.length === 0) return
    realignTrains(this.network, this.trains, this.trainAnchors ?? undefined)
    this.refreshCouplerPoints()
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
    resetSignalling(this.signalling)
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
  /** Drop the focus on the selected train and vehicle, without notifying */
  private releaseTrainSelection(): void {
    this.selectedTrainId = null
    this.selectedTrainVehicleId = null
    this.isTrainSelected = false
  }

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

  /** What the track gives the driving physics beyond its plan geometry */
  get drivingEnvironment(): DrivingEnvironment {
    const env: DrivingEnvironment = { levelHeight: this.levelHeight, line: this.lineSettings }
    // The pro level weighs on the speed limit of a train; the standard level changes nothing
    if (this.signallingLevel === 'pro') {
      env.signalling = { level: 'pro', speedCapOf: (train) => signalSpeedCap(this.signalling, train.id, 'pro') }
    }
    return env
  }

  /** What the signalling engine reads besides the trains: the line, and the free blocks to count on a cab-signalled line */
  get signallingOptions(): SignallingOptions {
    const line = this.lineSettings
    return { line, clearance: isCabSignalled(this.signallingLevel, line) }
  }

  /**
   * Line speed and line type of the project, with what the cant rules read from the scale: the
   * gauge, and whether the project is at full size (cant, curve speeds and derailment are left out
   * on a model railway scale)
   */
  get lineSettings(): LineSettings {
    return { lineSpeed: this.lineSpeed, lineType: this.lineType, gauge: this.gauge, realScale: this.scalePreset === '1:1' }
  }

  /**
   * Change the line speed (km/h) and / or the line type of the project. A speed that is not a
   * finite number is ignored, the others are rounded to the km/h and kept within LINE_SPEED_RANGE;
   * an unknown line type is ignored. One undo step when something changed.
   */
  setLineSettings = (settings: Partial<LineSettings>): void => {
    const lineSpeed =
      typeof settings.lineSpeed === 'number' && Number.isFinite(settings.lineSpeed)
        ? Math.max(LINE_SPEED_RANGE.min, Math.min(LINE_SPEED_RANGE.max, Math.round(settings.lineSpeed)))
        : this.lineSpeed
    const lineType = settings.lineType === 'classic' || settings.lineType === 'highSpeed' ? settings.lineType : this.lineType
    if (lineSpeed === this.lineSpeed && lineType === this.lineType) return
    this.lineSpeed = lineSpeed
    this.lineType = lineType
    this.markDirty()
    this.notify()
  }

  /** Signalling settings of the project: the level its signals are read at, and what passing a closed one does */
  get signallingSettings(): SignallingSettings {
    return { level: this.signallingLevel, stopEnforced: this.signalStopEnforced }
  }

  /**
   * Change the signalling level and / or the emergency brake on passing a closed signal. The
   * signals themselves are not touched: the other level reads the same ones. An unknown level or a
   * value that is not a boolean is ignored. One undo step when something changed.
   */
  setSignallingSettings = (settings: Partial<SignallingSettings>): void => {
    const level = isSignallingLevel(settings.level) ? settings.level : this.signallingLevel
    const stopEnforced = typeof settings.stopEnforced === 'boolean' ? settings.stopEnforced : this.signalStopEnforced
    if (level === this.signallingLevel && stopEnforced === this.signalStopEnforced) return
    this.signallingLevel = level
    this.signalStopEnforced = stopEnforced
    this.markDirty()
    this.notify()
  }

  /**
   * Bring `signalling` up to date with the trains where they stand, outside the simulation step
   * (which does it itself): no train is braked and no passing is reported. Returns the state.
   */
  refreshSignalling = (): SignallingState => {
    updateSignalling(this.network, this.trains, this.signalling, this.signallingSettings, undefined, this.signallingOptions)
    return this.signalling
  }

  /**
   * What the signals say to the driver of the selected train: next signal, first closed signal,
   * braking alert (see `trainSignalView`). Null when no train is selected.
   */
  get selectedTrainSignals(): TrainSignalView | null {
    const train = this.selectedTrain
    if (!train) return null
    return trainSignalView(this.signalling, train.id, this.selectedTrainDynamics?.stoppingDistance ?? 0)
  }

  /**
   * Set the cant (mm) of the selected curved rails by hand, or give it back to the automatic rule
   * with null. Returns true when a rail changed.
   */
  setSelectionCant = (cant: number | null): boolean => {
    if (cant !== null && !Number.isFinite(cant)) return false
    // Whole millimetres within CANT_RANGE; only a curved rail carries a cant
    const target = cant === null ? undefined : Math.max(CANT_RANGE.min, Math.min(CANT_RANGE.max, Math.round(cant)))
    let changed = false
    for (const sid of this.selection.segments) {
      const seg = this.network.segments.get(sid)
      if (!seg || seg.kind !== 'curve' || !seg.via || seg.cant === target) continue
      if (target === undefined) delete seg.cant
      else seg.cant = target
      changed = true
    }
    if (changed) this.markDirty()
    return changed
  }

  /** Put the driven train back on the track after a derailment. Returns false when it is not derailed. */
  rerailSelectedTrain = (): boolean => {
    const train = this.selectedTrain
    if (!train || !rerailTrain(train)) return false
    this.notify()
    return true
  }

  /** Forces, pressures and stopping distance of the selected train, as the physics sees them now */
  get selectedTrainDynamics(): TrainDynamics | null {
    const train = this.selectedTrain
    return train ? trainDynamics(this.network, train, this.drivingEnvironment) : null
  }

  /** Put the selected train's handle on a notch: MIN_NOTCH (B5) … 0 (N) … MAX_NOTCH (P5) */
  setSelectedTrainNotch = (notch: number): void => {
    const train = this.selectedTrain
    if (train && setNotch(train, Math.max(MIN_NOTCH, Math.min(MAX_NOTCH, notch)))) this.notify()
  }

  /** Move the selected train's handle by one notch; it stops at B5 and at P5 */
  stepSelectedTrainNotch = (step: 1 | -1): void => {
    const train = this.selectedTrain
    if (train) this.setSelectedTrainNotch(train.notch + step)
  }

  /**
   * Move the selected train's brake handle: `apply` and `release` act for as long as they are
   * held, `hold` keeps the pressure where it is.
   *
   * Two sides can hold the one handle: this screen and its keyboard (`local`) and the phone desk
   * (`remote`). The last one to push it wins, and one side letting go (`hold`) only centres the
   * handle when the other is not still holding it.
   */
  setSelectedTrainBrakeCommand = (command: BrakeCommand, source: BrakeSource = 'local'): void => {
    const train = this.selectedTrain
    if (!train) return
    // What was held on another train, or before this driving session, is forgotten
    if (this.brakeHoldTrainId !== train.id) this.forgetBrakeHolds(train.id)
    this.brakeHolds[source] = command
    const wanted = command === 'hold' ? this.brakeHolds[source === 'local' ? 'remote' : 'local'] : command
    if (train.brakeCommand === wanted) return
    setBrakeCommand(train, wanted)
    // The domain refuses the handle while the emergency brake is latched
    if (train.brakeCommand === wanted) this.notify()
  }

  /** What one side currently holds the brake handle of the selected train on */
  heldBrakeCommand = (source: BrakeSource): BrakeCommand =>
    this.brakeHoldTrainId !== null && this.brakeHoldTrainId === this.selectedTrainId ? this.brakeHolds[source] : 'hold'

  /** Nobody holds the brake handle of the selected train any more: it goes back to `hold` */
  centreSelectedTrainBrake = (): void => {
    this.forgetBrakeHolds(null)
    const train = this.selectedTrain
    const held = train?.brakeCommand ?? 'hold'
    if (!train || held === 'hold') return
    setBrakeCommand(train, 'hold')
    if (train.brakeCommand !== held) this.notify()
  }

  private forgetBrakeHolds(trainId: string | null): void {
    this.brakeHoldTrainId = trainId
    this.brakeHolds = { local: 'hold', remote: 'hold' }
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

  // ─────────────────── Signalling mode: speed zones ───────────────────

  /** True in the signalling mode with the speed limit tool in hand (never while driving) */
  get isSpeedZoneTool(): boolean {
    return this.tool === 'signal' && this.signalToolSubMode === 'speedZone' && !this.isPlayMode
  }

  /** Open the signalling mode on a sub-mode, or change sub-mode. Refused while driving. */
  setSignalToolSubMode = (mode: SignalSubMode): void => {
    if (this.isPlayMode) return
    if (this.tool !== 'signal') this.setTool('signal')
    this.signalToolSubMode = mode
    this.speedZoneStart = null
    this.hoveredSpeedZoneId = null
    this.cancelSignalGesture()
    this.hoveredSignalId = null
    this.signalToolFlipped = false
    // A tool in hand: the keys act on what it is about to lay, not on a signal picked earlier
    if (mode !== 'select') this.selectedSignalId = null
    this.notify()
  }

  /** Leave the signalling mode for the track tools */
  exitSignalMode = (): void => {
    if (this.tool === 'signal') this.setTool('select')
  }

  /**
   * One Escape inside the signalling mode with nothing pending: back to its selection sub-mode,
   * then the selected signal or zone is released. False when there is nothing left but to leave the mode.
   */
  private stepBackSignalMode(): boolean {
    if (this.signalToolSubMode !== 'select') {
      this.signalToolSubMode = 'select'
      this.signalToolFlipped = false
    } else if (this.selectedSignal) {
      this.selectedSignalId = null
    } else if (this.selectedSpeedZone) {
      this.selectedSpeedZoneId = null
    } else {
      return false
    }
    this.hoveredSpeedZoneId = null
    this.hoveredSignalId = null
    this.notify()
    return true
  }

  /** The zone picked in the signalling mode; null outside it or once the zone is gone */
  get selectedSpeedZone(): SpeedZone | null {
    if (this.tool !== 'signal' || !this.selectedSpeedZoneId) return null
    return this.network.speedZones.get(this.selectedSpeedZoneId) ?? null
  }

  /** Pick a zone (null: none). Only in the signalling mode, never while driving. */
  selectSpeedZone = (id: string | null): boolean => {
    if (this.isPlayMode || this.tool !== 'signal') return false
    if (id !== null && !this.network.speedZones.has(id)) return false
    this.selectedSpeedZoneId = id
    // One thing is picked at a time in the signalling mode
    if (id !== null) this.selectedSignalId = null
    this.notify()
    return true
  }

  /** Place of the track under a world position, within the reach of a click; null off the track */
  trackPointAt = (worldPos: Point, tolerance: number = 14 / this.camera.scale): TrackPoint | null => {
    const hit = snapToNearestTrack(this.network, worldPos, tolerance)
    return hit ? { segId: hit.segId, t: hit.t } : null
  }

  /**
   * The zone under a world position. Where several overlap, the one after the selected zone:
   * clicking again on the shared stretch goes through them in turn.
   */
  speedZoneAt = (worldPos: Point, tolerance?: number): SpeedZone | null => {
    const point = this.trackPointAt(worldPos, tolerance)
    if (!point) return null
    const zones = speedZonesAt(this.network, point.segId, point.t)
    if (zones.length === 0) return null
    const current = zones.findIndex((zone) => zone.id === this.selectedSpeedZoneId)
    return zones[(current + 1) % zones.length]
  }

  /** Remember the zone under the cursor (select and delete sub-modes). True when it changed. */
  updateSpeedZoneHover = (worldPos: Point): boolean => {
    const hovered = this.tool === 'signal' && this.signalToolSubMode !== 'speedZone' && !this.isPlayMode
      ? this.speedZoneAt(worldPos)?.id ?? null
      : null
    if (hovered === this.hoveredSpeedZoneId) return false
    this.hoveredSpeedZoneId = hovered
    return true
  }

  /** Speed (km/h) of the next zone laid: a multiple of 10, from 10 to `MAX_ZONE_SPEED` */
  setSpeedZoneToolSpeed = (speed: number): void => {
    this.speedZoneToolSpeed = Math.min(MAX_ZONE_SPEED, normalizeZoneSpeed(speed))
    this.notify()
  }

  /**
   * One click of the speed limit tool on `point` (null: off the track). The first click sets the
   * start, the second lays the zone along the shortest way between the two, selects it and records
   * one undo step. A refused click keeps the start, so the next one can still close the zone.
   */
  clickSpeedZoneTool = (point: TrackPoint | null): SpeedZoneClick => {
    if (this.isPlayMode || !this.isSpeedZoneTool) return 'refused'
    if (!point) return 'off-track'
    if (!this.speedZoneStart) {
      this.speedZoneStart = { segId: point.segId, t: point.t }
      this.notify()
      return 'started'
    }
    const zone = addSpeedZoneBetween(this.network, this.speedZoneStart, point, this.speedZoneToolSpeed)
    if (!zone) return 'no-path'
    this.speedZoneStart = null
    this.selectedSpeedZoneId = zone.id
    this.markDirty()
    return 'placed'
  }

  /** True when the zone shares track with another one: the lower limit applies there */
  speedZoneOverlapsAnother = (id: string): boolean => overlapsOfZone(this.network, id).length > 0

  /** Change the speed of a zone (one undo step). False while driving, for no zone or for no change. */
  setSpeedZoneSpeed = (id: string, speed: number): boolean => {
    if (this.isPlayMode) return false
    const zone = this.network.speedZones.get(id)
    const next = Math.min(MAX_ZONE_SPEED, normalizeZoneSpeed(speed))
    if (!zone || zone.speed === next) return false
    setSpeedZoneSpeed(this.network, id, next)
    this.markDirty()
    return true
  }

  /** Remove a zone (one undo step). False while driving or for no zone. */
  deleteSpeedZone = (id: string): boolean => {
    if (this.isPlayMode || !removeSpeedZone(this.network, id)) return false
    if (this.selectedSpeedZoneId === id) this.selectedSpeedZoneId = null
    if (this.hoveredSpeedZoneId === id) this.hoveredSpeedZoneId = null
    this.markDirty()
    return true
  }

  deleteSelectedSpeedZone = (): boolean => {
    const zone = this.selectedSpeedZone
    return zone ? this.deleteSpeedZone(zone.id) : false
  }

  // ─────────────────── Signalling mode: signals ───────────────────

  /** The signal tool in hand, null without one (never while driving; the marker board only at the pro level) */
  get signalPlacementMode(): SignalPlacementMode | null {
    if (this.tool !== 'signal' || this.isPlayMode) return null
    const mode = this.signalToolSubMode
    if (!isSignalPlacementMode(mode)) return null
    return mode === 'cabMarker' && this.signallingLevel !== 'pro' ? null : mode
  }

  /** Role and options of the signal the tool in hand lays; null without a signal tool */
  get signalToolSpec(): { role: SignalRole; cabMarker: boolean } | null {
    switch (this.signalPlacementMode) {
      case 'blockSignal': return { role: 'spacing', cabMarker: false }
      case 'pathSignal': return { role: 'protection', cabMarker: false }
      case 'cabMarker': return { role: this.signalToolCabRole, cabMarker: true }
      default: return null
    }
  }

  /** Distance (m) between the signals of a row: `signalToolSpacing` brought to the gauge of the project */
  get signalRowSpacing(): number {
    return this.signalToolSpacing * (this.gauge > 0 ? this.gauge / 1.435 : 1)
  }

  /** A signal is being laid or moved: the blocks then have their own display switch */
  private get isPlacingSignal(): boolean {
    return this.signalPlacementMode !== null || this.signalDrag !== null
  }

  /**
   * Blocks are shown: the display is ticked — or, while a signal is being laid or moved, it has
   * not been unticked during it (`signalBlocksWhilePlacing`)
   */
  get signalBlocksVisible(): boolean {
    return this.isPlacingSignal ? this.signalBlocksWhilePlacing : this.showSignalBlocks
  }

  /** The two displays of the signalling the project remembers */
  get signalDisplaySettings(): SignalDisplaySettings {
    return { blocks: this.showSignalBlocks, reservations: this.showSignalReservations, inclination: this.showInclination }
  }

  /** Displays of a project just loaded: both off unless it says otherwise */
  private restoreSignalDisplay(saved: { showSignalBlocks?: boolean; showSignalReservations?: boolean; hideInclination?: boolean }): void {
    this.showSignalBlocks = saved.showSignalBlocks === true
    this.showSignalReservations = saved.showSignalReservations === true
    this.showInclination = saved.hideInclination !== true
  }

  /** The track held for each train is shown: the display is ticked, and only while driving */
  get signalReservationsVisible(): boolean {
    return this.showSignalReservations && this.isPlayMode
  }

  /**
   * Tick or untick the display of the blocks: what the box shows (`signalBlocksVisible`) is what it
   * flips. With a signal tool in hand that is the display of the blocks during the placement, which
   * can so be hidden; otherwise the display of the project, saved with it (no undo step).
   */
  toggleSignalBlocks = (): void => {
    if (this.isPlacingSignal) {
      this.signalBlocksWhilePlacing = !this.signalBlocksWhilePlacing
    } else {
      this.showSignalBlocks = !this.showSignalBlocks
      this.savePersistedState()
    }
    this.notify()
  }

  /** Tick or untick the display of the track held for each train: saved with the project (no undo step) */
  toggleSignalReservations = (): void => {
    this.showSignalReservations = !this.showSignalReservations
    this.savePersistedState()
    this.notify()
  }

  /** Tick or untick the marks of cant and slopes on the track: saved with the project (no undo step) */
  toggleInclination = (): void => {
    this.showInclination = !this.showInclination
    this.savePersistedState()
    this.notify()
  }

  setSignalToolBothWays = (on: boolean): void => {
    this.signalToolBothWays = on
    this.notify()
  }

  /** Turn the signal about to be laid round (it then stands across the track from the cursor) */
  flipSignalTool = (): void => {
    this.signalToolFlipped = !this.signalToolFlipped
    if (this.signalRowStart && !this.signalRowEnd) {
      const { place, forward } = this.signalRowStart
      this.signalRowStart = this.signalAimFor(place, !forward)
    }
    this.notify()
  }

  /** Spacing of a row of signals: one of `SIGNAL_ROW_SPACINGS` (the nearest one) */
  setSignalToolSpacing = (spacing: number): void => {
    if (!Number.isFinite(spacing)) return
    this.signalToolSpacing = SIGNAL_ROW_SPACINGS.reduce((best, value) =>
      Math.abs(value - spacing) < Math.abs(best - spacing) ? value : best)
    this.notify()
  }

  /** Marker board tool: lay passable boards (`spacing`, F) or boards that are not (`protection`, Nf) */
  setSignalToolCabRole = (role: SignalRole): void => {
    if (role !== 'spacing' && role !== 'protection') return
    this.signalToolCabRole = role
    this.notify()
  }

  private get signalPlacementOptions(): { gauge: number } {
    return { gauge: this.gauge }
  }

  private signalAimFor(place: TrackPoint, forward: boolean): SignalAim {
    const options = this.signalPlacementOptions
    const refusal =
      checkSignalPlacement(this.network, place, forward, options) ??
      (this.signalToolBothWays ? checkSignalPlacement(this.network, place, !forward, options) : null)
    return { place: { segId: place.segId, t: place.t }, forward, refusal }
  }

  /**
   * Where a signal tool aims from a world position: the nearest place of the track, for the
   * direction of travel that has the cursor on its left (a signal stands on the left of the trains
   * it speaks to) — the other one once the tool is flipped. Null off the track.
   */
  signalAimAt = (worldPos: Point, tolerance: number = 30 / this.camera.scale): SignalAim | null => {
    const place = this.trackPointAt(worldPos, tolerance)
    if (!place) return null
    const on = positionOnSegment(this.network, place.segId, place.t)
    if (!on) return null
    // Heading whose left-hand side points at the cursor (screen and world share their y axis)
    const side = { x: worldPos.x - on.x, y: worldPos.y - on.y }
    const forward = signalForwardFor(this.network, place, { x: -side.y, y: side.x })
    return this.signalAimFor(place, forward !== this.signalToolFlipped)
  }

  /**
   * Lay the signal of the tool in hand at `place` for the direction `forward` — two back to back
   * with « double sens ». One undo step. Refused while driving, without a signal tool, and where
   * `checkSignalPlacement` says so.
   */
  placeSignal = (place: TrackPoint, forward: boolean): SignalToolResult => {
    const spec = this.signalToolSpec
    if (this.isPlayMode || !spec) return { ok: false, reason: 'driving' }
    const options = { ...this.signalPlacementOptions, cabMarker: spec.cabMarker }
    let signals: Signal[]
    if (this.signalToolBothWays) {
      const laid = addSignalPair(this.network, place, spec.role, options)
      if (!laid.ok) return laid
      // The one for the direction asked comes first
      signals = forward ? laid.signals : [laid.signals[1], laid.signals[0]]
    } else {
      const laid = addSignal(this.network, place, forward, spec.role, options)
      if (!laid.ok) return laid
      signals = [laid.signal]
    }
    this.markDirty()
    return { ok: true, signals, refused: 0 }
  }

  /**
   * Lay a row of signals of the tool in hand from `a` to `b` along the track, one every
   * `signalRowSpacing`, for trains running from `a` to `b` (and the other way too with « double
   * sens »). One undo step for the whole row. Places where a signal cannot stand are skipped.
   */
  placeSignalRow = (a: TrackPoint, b: TrackPoint): SignalToolResult => {
    const spec = this.signalToolSpec
    if (this.isPlayMode || !spec) return { ok: false, reason: 'driving' }
    if (signalRowPlaces(this.network, a, b, this.signalRowSpacing).length === 0) return { ok: false, reason: 'no-path' }
    const laid = addSignalRow(this.network, a, b, this.signalRowSpacing, spec.role, {
      ...this.signalPlacementOptions,
      cabMarker: spec.cabMarker,
      bothWays: this.signalToolBothWays,
    })
    if (laid.signals.length === 0) return { ok: false, reason: laid.refused[0]?.reason ?? 'off-track' }
    this.markDirty()
    return { ok: true, signals: laid.signals, refused: laid.refused.length }
  }

  /** The places the row being drawn would lay its signals at (empty outside such a drag) */
  get signalRowPreview(): { place: TrackPoint; forward: boolean }[] {
    if (!this.signalRowStart || !this.signalRowEnd || !this.signalPlacementMode) return []
    return signalRowPlaces(this.network, this.signalRowStart.place, this.signalRowEnd, this.signalRowSpacing)
  }

  /** The button goes down with a signal tool in hand. False off the track: nothing begins. */
  beginSignalGesture = (worldPos: Point): boolean => {
    if (!this.signalPlacementMode) return false
    const aim = this.signalAimAt(worldPos)
    if (!aim) return false
    this.signalRowStart = aim
    this.signalRowEnd = null
    this.notify()
    return true
  }

  /**
   * The pointer moves with the button down: once the place of the track under it is
   * `SIGNAL_DRAG_THRESHOLD` px away from the one it went down on, the gesture is a row towards it.
   */
  updateSignalGesture = (worldPos: Point): void => {
    const start = this.signalRowStart
    if (!start) return
    const from = positionOnSegment(this.network, start.place.segId, start.place.t)
    const end = this.trackPointAt(worldPos, 30 / this.camera.scale)
    const to = end && positionOnSegment(this.network, end.segId, end.t)
    // Measured between the two places of the track: moving away from the rails is still a click
    const far = !!from && !!to && Math.hypot(to.x - from.x, to.y - from.y) * this.camera.scale > SIGNAL_DRAG_THRESHOLD
    this.signalRowEnd = far ? end : null
  }

  /** The button comes up: one signal for a click, a row for a drag. Null when no gesture was under way. */
  commitSignalGesture = (): SignalToolResult | null => {
    const start = this.signalRowStart
    const end = this.signalRowEnd
    if (!start) return null
    this.signalRowStart = null
    this.signalRowEnd = null
    const result = end ? this.placeSignalRow(start.place, end) : this.placeSignal(start.place, start.forward)
    if (!result.ok) this.notify()
    return result
  }

  /**
   * Drop the gesture of a signal tool, or put back the signal being dragged where it stood. True
   * when there was something to drop.
   */
  cancelSignalGesture = (): boolean => {
    let dropped = false
    if (this.signalRowStart) {
      this.signalRowStart = null
      this.signalRowEnd = null
      dropped = true
    }
    const drag = this.signalDrag
    if (drag) {
      this.signalDrag = null
      moveSignal(this.network, drag.id, drag.origin, drag.origin.forward, this.signalPlacementOptions)
      dropped = true
    }
    return dropped
  }

  /** The signal picked in the signalling mode; null outside it or once the signal is gone */
  get selectedSignal(): Signal | null {
    if (this.tool !== 'signal' || !this.selectedSignalId) return null
    return this.network.signals.get(this.selectedSignalId) ?? null
  }

  /** Pick a signal (null: none). Only in the signalling mode, never while driving. */
  selectSignal = (id: string | null): boolean => {
    if (this.isPlayMode || this.tool !== 'signal') return false
    if (id !== null && !this.network.signals.has(id)) return false
    this.selectedSignalId = id
    if (id !== null) this.selectedSpeedZoneId = null
    this.notify()
    return true
  }

  /**
   * The signal whose head, or whose place on the track, is under a world position: the nearest one.
   * Two signals back to back share their place on the track and stand on either side of it: the
   * one on the side of the cursor is the nearest. Right on the axis they are as near as each other
   * (within one pixel): the one after the selected signal is then taken, the one for the direction
   * of the rail first — clicking again there goes from one to the other, as for zones that overlap.
   */
  signalAt = (worldPos: Point, tolerance: number = 12 / this.camera.scale): Signal | null => {
    const found: { signal: Signal; dist: number }[] = []
    let bestDist = tolerance
    for (const signal of this.network.signals.values()) {
      const head = signalHeadWorld(this.network, signal, this.camera.scale, this.gauge)
      const foot = positionOnSegment(this.network, signal.segId, signal.t)
      if (!head || !foot) continue
      // The head first: two signals back to back share their place on the track
      const dist = Math.min(
        Math.hypot(worldPos.x - head.x, worldPos.y - head.y),
        Math.hypot(worldPos.x - foot.x, worldPos.y - foot.y) + tolerance / 2,
      )
      if (dist >= tolerance) continue
      found.push({ signal, dist })
      if (dist < bestDist) bestDist = dist
    }
    if (found.length === 0) return null
    const pixel = this.camera.scale > 0 ? 1 / this.camera.scale : 0
    const nearest = found
      .filter((entry) => entry.dist <= bestDist + pixel)
      .map((entry) => entry.signal)
      .sort((a, b) => Number(b.forward) - Number(a.forward) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    if (nearest.length === 1) return nearest[0]
    const current = nearest.findIndex((signal) => signal.id === this.selectedSignalId)
    return nearest[(current + 1) % nearest.length]
  }

  /** Remember the signal under the cursor (select and delete sub-modes). True when it changed. */
  updateSignalHover = (worldPos: Point): boolean => {
    const active = this.tool === 'signal' && !this.isPlayMode
      && (this.signalToolSubMode === 'select' || this.signalToolSubMode === 'delete')
    const hovered = active ? this.signalAt(worldPos)?.id ?? null : null
    if (hovered === this.hoveredSignalId) return false
    this.hoveredSignalId = hovered
    return true
  }

  /** Turn a signal round (one undo step). Returns why not when it cannot be. */
  flipSignalDirection = (id: string): SignalRefusal | 'driving' | null => {
    if (this.isPlayMode) return 'driving'
    const result = flipSignal(this.network, id, this.signalPlacementOptions)
    if (!result.ok) return result.reason
    this.markDirty()
    return null
  }

  /** Make a signal a block signal (`spacing`) or a path signal (`protection`). One undo step. */
  changeSignalRole = (id: string, role: SignalRole): boolean => {
    const signal = this.network.signals.get(id)
    if (this.isPlayMode || !signal || signal.role === role) return false
    if (!setSignalRole(this.network, id, role)) return false
    this.markDirty()
    return true
  }

  /** Make a signal a marker board of a cab-signalled line, or a lit signal again. One undo step. */
  setSignalCabMarker = (id: string, cabMarker: boolean): boolean => {
    const signal = this.network.signals.get(id)
    if (this.isPlayMode || !signal || !!signal.cabMarker === cabMarker) return false
    if (!setSignalOptions(this.network, id, { cabMarker })) return false
    this.markDirty()
    return true
  }

  /**
   * Make a path signal one-way — a stop no train passes for the trains that meet it from behind — or
   * a plain one again. One undo step. False while driving, for a block signal (the option only
   * means something on a path signal) and when nothing changes.
   */
  setSignalOneWay = (id: string, oneWay: boolean): boolean => {
    const signal = this.network.signals.get(id)
    if (this.isPlayMode || !signal || signal.role !== 'protection' || !!signal.oneWay === oneWay) return false
    if (!setSignalOptions(this.network, id, { oneWay })) return false
    this.markDirty()
    return true
  }

  /** Remove a signal (one undo step). False while driving or for no signal. */
  deleteSignal = (id: string): boolean => {
    if (this.isPlayMode) return false
    if (this.signalDrag?.id === id) this.signalDrag = null
    if (!removeSignal(this.network, id)) return false
    if (this.selectedSignalId === id) this.selectedSignalId = null
    if (this.hoveredSignalId === id) this.hoveredSignalId = null
    this.markDirty()
    return true
  }

  deleteSelectedSignal = (): boolean => {
    const signal = this.selectedSignal
    return signal ? this.deleteSignal(signal.id) : false
  }

  /** Start dragging a signal along the track (signalling mode, selection sub-mode). */
  beginSignalDrag = (id: string): boolean => {
    const signal = this.network.signals.get(id)
    if (this.isPlayMode || this.tool !== 'signal' || this.signalToolSubMode !== 'select' || !signal) return false
    this.signalDrag = { id, origin: { segId: signal.segId, t: signal.t, forward: signal.forward } }
    return true
  }

  /**
   * Slide the dragged signal to the place of the track under a world position, keeping the
   * direction of travel it speaks to. Where it cannot stand it stays where it last could.
   */
  dragSignalTo = (worldPos: Point): boolean => {
    const drag = this.signalDrag
    if (!drag) return false
    const place = this.trackPointAt(worldPos, 40 / this.camera.scale)
    if (!place) return false
    const before = signalsRevision(this.network)
    slideSignal(this.network, drag.id, place, this.signalPlacementOptions)
    return signalsRevision(this.network) !== before
  }

  /** The button comes up: the move is one undo step. True when the signal ended somewhere else. */
  endSignalDrag = (): boolean => {
    const drag = this.signalDrag
    if (!drag) return false
    this.signalDrag = null
    const signal = this.network.signals.get(drag.id)
    const moved = !!signal
      && (signal.segId !== drag.origin.segId || signal.t !== drag.origin.t || signal.forward !== drag.origin.forward)
    if (moved) this.markDirty()
    return moved
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
    this.trainToolSubMode = 'select'
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

  /** Choose the rolling stock (TGV Duplex, TGV M) of the vehicles placed from now on */
  setTrainPlacementModel = (model: RollingStockModel): void => {
    this.trainPlacementModel = model
    if (this.lastMouseWorld) {
      this.updateLocomotivePreview(this.lastMouseWorld)
    }
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

  /** Tell the interface, once per impact, that a train ran into a buffer stop or another train */
  private reportImpact(train: TrainSet): void {
    if (train.impactSpeed <= IMPACT_REPORT_SPEED) {
      this.impactReported.delete(train.id)
      return
    }
    if (this.impactReported.has(train.id)) return
    this.impactReported.add(train.id)
    this.onTrainImpact?.(train, train.impactSpeed)
  }

  /**
   * Run one simulation step on every TrainSet while driving. A train at rest is simulated too:
   * with its brakes released on a slope it has to be able to roll away.
   */
  tickAllTrains = (dt: number): void => {
    if (!this.isPlayMode || dt <= 0) return
    const occupancy: TrainOccupancyCache = new Map()
    const env = this.drivingEnvironment
    for (const train of this.trains) {
      // Nobody holds the brake handle of a train that is not driven
      if (train.id !== this.selectedTrainId && train.brakeCommand !== 'hold') setBrakeCommand(train, 'hold')
      // Stopping against an obstacle, holding at rest and rolling back are the domain's business
      tickTrainSet(this.network, train, dt, this.trains, occupancy, env)
      this.reportImpact(train)
    }
    // Once every train has moved: what each one holds, what the signals show, the signals passed
    // (nothing at all on a network without signal)
    // The driven train holds the track over the stopping distance its physics works out; the
    // others over the simple estimate, on the slope they stand on
    const drivenId = this.selectedTrainId
    let drivenDynamics: TrainDynamics | null = null
    const dynamicsOfDriven = (train: TrainSet): TrainDynamics => (drivenDynamics ??= trainDynamics(this.network, train, env))
    const stoppingOf = (train: TrainSet): number | null => {
      if (train.id === drivenId) return dynamicsOfDriven(train).stoppingDistance
      if (!(train.currentSpeed > 0)) return null
      return estimatedStoppingDistance(train.currentSpeed, train.direction * trainSlope(this.network, train, env))
    }
    const passings = tickSignalling(this.network, this.trains, this.signalling, this.signallingSettings, stoppingOf, {
      line: env.line,
      // The limit of the driven train is already worked out: the overspeed check does not look for it again
      speedLimitOf: (train) => (train.id === drivenId ? dynamicsOfDriven(train).speedLimit * 3.6 : null),
      onOverspeed: (train, overspeed) => this.onOverspeed?.(train, overspeed),
    })
    for (const passing of passings) {
      if (!passing.fault) continue
      const train = this.trains.find((t) => t.id === passing.trainId)
      if (train) this.onSignalPassed?.(train, passing)
    }
    // Sync telemetry to legacy fields
    if (this.selectedTrain) {
      this.locomotiveCurrentSpeed = this.selectedTrain.currentSpeed
    }
    // Sync camera to the lead vehicle of the followed train (the driven one, or the spectated one)
    if (this.followLocomotiveCamera) this.centreCameraOnTrain(this.cameraTrain)
    this.notify()
  }
}

/** Hook: subscribe a React component to store version changes. */
export function useEditorVersion(store: EditorStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion)
}
