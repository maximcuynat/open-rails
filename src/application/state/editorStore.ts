import { useSyncExternalStore } from 'react'
import { mergeIntoLongRails } from '@domain/services/longRails'
import { fitPath } from '@domain/geometry/arcFit'
import { networkCheckToken, touchNetwork, verifyingNetworkRevisions } from '@domain/models/networkWatch'
import { dirtyNodesOf, networkChangesSince } from '@domain/geometry/networkFollower'
import { DEFAULT_LINE_SETTINGS, type LineSettings, type LineType } from '@domain/models/speedLimits'
import { createCamera, clampScale, fitDimensions, type Camera } from '@infrastructure/render/camera'
import { raiseIdCounter } from '@domain/models/ids'
import { createNetwork, syncIdCounter, resetIdCounter, removeNode, removeSegment, addNode, addSegment, addCurveSegment, pruneOrphanNodes, dissolveNode, generateId, nodeLevel, setNodesLevel, canSpreadGradient, gradientRun, spreadGradient } from '@domain/models/network'
import { separateLevelsAtNode, throughTracksAtNode } from '@domain/models/crossing'
import { computeParallelCurve } from '@domain/geometry/curve'
import { CURVE_RADII } from '@domain/profiles/profiles'
import { toggleJunction, toggleTurnoutHand, turnoutHandFlipSegments, findJunctionAtNode, findJunctionBySegment, autoDetectJunctions, doubleSlipSideToward, throwDoubleSlipSide, type DoubleSlipSide } from '@domain/models/junction'
import { isNetworkReconciled, reconcileNetworkIntersections } from '@domain/geometry/reconcile'
import { cleanSpeedZones } from '@domain/models/speedZones'
import { DEFAULT_SIGNALLING_SETTINGS, cleanSignals, isSignallingLevel, type SignallingLevel, type SignallingSettings } from '@domain/models/signals'
import { cleanStations, stationAt } from '@domain/models/stations'
import { setStationIdentity } from '@domain/models/stations'
import { withoutStation } from '@domain/services/itinerary'
import {
  addMarker,
  createStation,
  deleteStation,
  moveEdgeEnd,
  moveMarker,
  moveStationLabel,
  MIN_PLATFORM_LENGTH,
  platformAt,
  platformCentre,
  platformEndAt,
  platformMarkerAt,
  platformShape,
  removeMarker,
  restorePlatformShape,
  setMarkerOptions,
  setPlatformRef,
  setPlatformStation,
  setPlatformWidth,
  type PlatformEnd,
  type PlatformMarkerHit,
  type PlatformShape,
} from '@domain/models/platformEdit'
import { edgeLength, platformDimensions, removePlatform, settlePlatforms, type PlatformDimensions } from '@domain/models/platforms'
import type { Platform, StopMarker } from '@domain/models/types'
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
import type { Signal, SignalRole, Station } from '@domain/models/types'
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
import { DATASET_LOCKED_TOOLS, type DatasetRecipe } from '@domain/dataset/datasetRecipe'
import { lineCategory, type BBox, type DatasetIndex, type LineId } from '@domain/dataset/datasetIndex'
import { boxesMeet, connectionsToward, distanceToBox, linesToDrop, piecesOverCap } from '@domain/dataset/lineRoute'
import { isProjectFile, mergeProjects } from '@infrastructure/persistence/projectMerge'
import type { MergeOutcome } from '@application/import/mergeReport'
import { addSliceInPlace, removeSliceInPlace, sliceHoldsRail } from '@infrastructure/persistence/sliceInPlace'
import {
  saveNetworkToStorage,
  loadNetworkFromStorage,
  clearNetworkStorage,
  deserializeNetwork,
  serializeNetwork,
  type ProjectOrigin,
  type SerializedProject,
  type SignalDisplaySettings,
} from '@infrastructure/persistence/persistence'
import {
  loadConsolePreference,
  loadDrivingAid,
  saveDrivingAid,
  loadGameState,
  saveGameState,
  loadTimeFactorPreference,
  loadKeyPreferences,
  loadRemoteHostPreference,
  saveConsolePreference,
  saveTimeFactorPreference,
  saveKeyPreferences,
  saveRemoteHostPreference,
} from '@infrastructure/persistence/preferences'
import { isConsolePreference, type ConsolePreference } from '@application/console/consolePreference'
import { defaultKeybindings, mergeWithDefaults, shortcutLabel, type ActionId, type Keybindings } from '@application/keybindings/keybindings'
import type { Junction, JunctionId, Network, Point, Selection, Segment, SpeedZone } from '@domain/models/types'
import type { SectionMetadata } from '@domain/models/sections'
import { applySectionMeta, networkDerived, sectionMetaChanged } from '@infrastructure/render/networkDerived'
import { type Unit, type ScalePresetId, SCALE_PRESETS, LEVEL_HEIGHT_RANGE, MAX_GRADIENT_RANGE } from '@domain/models/units'
import type { GradientLimits } from '@domain/services/kinematicDiagnostics'
import type { OsmSource } from '@domain/import/osmTypes'
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
import { DEFAULT_ROLLING_STOCK, stockSpec, type RakeChoice, type RollingStockModel } from '@domain/models/rollingStock'
import { LINE_CATEGORY_COLORS } from '@infrastructure/render/datasetOverview'
import { trackLod } from '@infrastructure/render/lod'
import { trackPositionBand } from '@infrastructure/render/levelPieces'
import { isUnderground, type ViewDepth } from '@infrastructure/render/levelAlpha'
import { createRakeAtStation, createRakeAtTrack } from '@domain/models/rakePlacement'
import { refreshRouteGuide, startItineraryAt, type RouteGuideState } from '@application/game/itinerary'
import { applyGame, captureGame } from '@domain/models/runningState'
import { isDrivingAid, type DrivingAid } from '@application/game/drivingAid'
import { newPilotMemory, runAutopilots, type PilotMemory } from '@application/game/autopilot'
import type { SegmentId, StationId, StationStop } from '@domain/models/types'
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
  | 'platform'

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

/** What the selection tool drags of a platform: one of its ends, or one of its stop markers */
export type PlatformDrag =
  | ({ kind: 'end'; origin: PlatformShape } & PlatformEnd)
  | ({ kind: 'marker'; origin: PlatformShape } & PlatformMarkerHit)

/** What the selection tool finds of a platform under the cursor, the handles before the body */
export type PlatformHit =
  | ({ kind: 'end' } & PlatformEnd)
  | ({ kind: 'marker' } & PlatformMarkerHit)
  | { kind: 'body'; platformId: string }

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
/** Under this speed (m/s) a train counts as at rest: it can be coupled, parted or taken out */
const AT_REST_SPEED = 0.1

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
  /** Levels without relief: they only say which track passes over which, every slope is zero (see `gradientLimits`) */
  flatLevels: boolean = false
  /** Where the network was imported from (OpenStreetMap), null for a project drawn by hand */
  osmSource: OsmSource | null = null
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
  /** The time of the simulation is stopped: every train stays as it is, handles and pilots included, until it is resumed */
  isPaused = false
  locomotiveLength = 20 // meters (adjustable)
  locomotiveSpeed = 0.5 // meters per step (fallback keyboard advance increment)
  followLocomotiveCamera = true // Automatically center camera on locomotive in play mode
  /** The trains held by a phone desk, by desk number (set by the remote session); empty outside driving */
  trainDrivers = new Map<string, number>()
  /** The way of each train to the next station of its itinerary, found on the track loaded; never saved */
  routeGuides = new Map<string, RouteGuideState>()
  private routeGuideElapsed = 0
  /** The trains the automatic pilot drives, with what it remembers of each; never saved */
  autopilots = new Map<string, PilotMemory>()

  /** Hand a train to the automatic pilot, or take it back */
  setAutopilot = (trainId: string, on: boolean): void => {
    if (on === this.autopilots.has(trainId)) return
    if (on) this.autopilots.set(trainId, newPilotMemory())
    else this.autopilots.delete(trainId)
    this.notify()
  }

  /** How much the game helps along an itinerary: way drawn and points set, way drawn only, or nothing */
  drivingAid: DrivingAid = 'full'
  /** The desks seated in the room and the name each driver gave, by desk number */
  deskNames = new Map<number, string>()

  // --- Dataset: a project built from the published « LGV France » lines ---
  /** Recipe of the dataset the project is built from; null for a hand-drawn or free-imported project */
  dataset: DatasetRecipe | null = null
  /** The index the recipe refers to, once fetched (where a train finds the lines it approaches); never saved */
  datasetIndex: DatasetIndex | null = null
  /** The files of the lines loaded, kept to be put together again when a line is added */
  datasetFiles = new Map<LineId, SerializedProject>()
  /** Bumped whenever a file comes or goes: what is worked out from the files is worked out again */
  private datasetFilesRevision = 0
  private railTintCache: { index: DatasetIndex; tint: (segId: string) => string | undefined } | null = null
  /** The file each rail came with (the first loaded that holds it), kept as files come and go */
  private railLineMap = new Map<SegmentId, LineId>()
  /** When each piece loaded was last in view or near a train (`datasetClock`): the ones seen longest ago go first past the cap */
  datasetSeen = new Map<LineId, number>()
  /** Counts the checks of the dataset lines: the clock of `datasetSeen` */
  private datasetClock = 0
  /** Bumped when the dataset project is replaced: a file asked for by the previous one is not added to this one */
  private datasetGeneration = 0
  /** When the lines were last checked against the view and the trains (ms, `performance.now`) */
  datasetRefreshedAt = -Infinity

  /**
   * The rails of a dataset project a train must keep off: those of the high-speed lines, for a
   * train without their cab signalling. Undefined when it may go anywhere.
   */
  railsBlockedFor = (train: TrainSet): ((segId: SegmentId) => boolean) | undefined => {
    const index = this.datasetIndex
    if (!this.dataset || !index || train.vehicles.every((veh) => stockSpec(veh).cabSignalling)) return undefined
    const highSpeed = new Set(index.lines.filter((line) => lineCategory(line) === 'highSpeed').map((line) => line.id))
    const railLine = this.railLine
    return (segId) => {
      const line = railLine.get(segId)
      return line !== undefined && highSpeed.has(line)
    }
  }

  /** The lines (or pieces of lines) of the dataset a train stands on */
  linesUnder = (train: TrainSet): Set<LineId> => {
    const railLine = this.railLine
    const under = new Set<LineId>()
    for (const veh of train.vehicles) {
      for (const pos of [veh.front, veh.rear]) {
        const line = railLine.get(pos.segId)
        if (line) under.add(line)
      }
    }
    return under
  }

  /** The file (line, or piece of a line) each rail of a dataset project came with; the first that holds it */
  private get railLine(): ReadonlyMap<SegmentId, LineId> {
    return this.railLineMap
  }

  /** The colour of the kind of line each rail of a dataset project belongs to; undefined on any other project */
  get railTint(): ((segId: string) => string | undefined) | undefined {
    const index = this.datasetIndex
    if (!this.dataset || !index || this.datasetFiles.size === 0) return undefined
    const cache = this.railTintCache
    if (cache && cache.index === index) return cache.tint
    const colorOfLine = new Map(index.lines.map((line) => [line.id, LINE_CATEGORY_COLORS[lineCategory(line)]]))
    const railLine = this.railLineMap
    const tint = (segId: string): string | undefined => {
      const line = railLine.get(segId)
      return line === undefined ? undefined : colorOfLine.get(line)
    }
    this.railTintCache = { index, tint }
    return tint
  }
  /** Fetches the files of some lines; set by the application layer (the store does not fetch) */
  datasetLoader: ((lines: LineId[]) => Promise<Map<LineId, SerializedProject>>) | null = null
  /** Lines asked for and not arrived yet */
  datasetPending = new Set<LineId>()
  /** The stored project was a recipe without geometry: the application must fetch the lines again */
  datasetReloadPending = false
  /** How long the last addition of lines took, in ms (read by the measuring scripts) */
  datasetLastAddMs = 0
  /** How long the last drop of lines took, ms (measures) */
  datasetLastRemoveMs = 0
  /** The stored recipe-only project, kept until its lines are fetched again (trains and camera to put back) */
  datasetStoredProject: SerializedProject | null = null
  /** Seconds since the trains were last checked against the connections to lines not loaded */
  private datasetCheckElapsed = 0
  /** How many pieces of the dataset stay loaded at most: past it, the ones seen longest ago are dropped */
  datasetMaxPieces = DATASET_MAX_PIECES
  /** Lines fetched because a train came near them; the dock says so */
  onDatasetLinesAdded: ((lines: LineId[], rails: number) => void) | null = null
  /** A fetch of lines a train came near failed; the dock says so */
  onDatasetError: ((error: unknown) => void) | null = null

  /** A project from the dataset: its track is read only */
  get isNetworkLocked(): boolean {
    return this.dataset !== null
  }

  /** The track may be drawn, moved or deleted: not while driving, not on a dataset project */
  get canEditNetwork(): boolean {
    return !this.isPlayMode && !this.isNetworkLocked
  }
  /** The dispatcher's board was asked for (Affichage ▸ « Tableau de l'aiguilleur ») */
  showDispatcher = false

  /**
   * The side of the ground the canvas looks at: the surface (the tunnels faded and dashed) or
   * below ground (the tunnels drawn as they are, the surface faded). Switched by hand
   * (`toggleViewDepth`, the top bar, `view.toggleDepth`) and on its own when the train of this
   * screen goes into a tunnel or comes out of one. Never saved.
   */
  viewDepth: ViewDepth = 'surface'
  /** The train whose side of the ground the view follows, and the side it was last on */
  private depthFollowed: { trainId: string; underground: boolean } | null = null

  setViewDepth = (depth: ViewDepth): void => {
    if (depth === this.viewDepth) return
    this.viewDepth = depth
    this.notify()
  }

  toggleViewDepth = (): void => {
    this.setViewDepth(this.viewDepth === 'surface' ? 'underground' : 'surface')
  }

  /**
   * While driving: the view goes below ground when the train of this screen goes into a tunnel
   * (its lead vehicle's level goes under 0), and back up when it comes out — once per crossing,
   * so that a side chosen by hand meanwhile stays. A train taken already in a tunnel is looked at there.
   */
  private followDrivenDepth(): void {
    const train = this.cameraTrain
    const lead = train?.vehicles[0]
    if (!train || !lead) {
      this.depthFollowed = null
      return
    }
    const level = Math.max(trackPositionBand(this.network, lead.front), trackPositionBand(this.network, lead.rear))
    const underground = isUnderground(level)
    const followed = this.depthFollowed
    if (followed && followed.trainId === train.id && followed.underground === underground) return
    this.depthFollowed = { trainId: train.id, underground }
    this.setViewDepth(underground ? 'underground' : 'surface')
  }

  /** The board is up: while driving, when asked for or as soon as a desk sits in the room */
  get dispatcherVisible(): boolean {
    return this.isPlayMode && (this.showDispatcher || this.deskNames.size > 0)
  }

  toggleDispatcher = (): void => {
    this.showDispatcher = !this.showDispatcher
    this.notify()
  }

  /** Show a place: the view stops following a train and centres there */
  showPlace = (x: number, y: number): void => {
    this.followLocomotiveCamera = false
    this.camera.x = x
    this.camera.y = y
    this.notify()
  }

  /** Who drives a train: a desk (its number), this screen (`host`: its selected train while driving), or nobody */
  driverOf = (trainId: string): 'host' | number | null => {
    const desk = this.trainDrivers.get(trainId)
    if (desk !== undefined) return desk
    return this.isPlayMode && trainId === this.selectedTrainId ? 'host' : null
  }

  /** What a driver is called on screen: the name the desk gave, « Pupitre 3 » without one, « PC » for this screen */
  driverName = (driver: 'host' | number | null): string | null => {
    if (driver === null) return null
    if (driver === 'host') return 'PC'
    return this.deskNames.get(driver) || `Pupitre ${driver}`
  }

  /** The train a desk holds */
  deskTrain = (desk: number): TrainSet | null => {
    for (const [trainId, holder] of this.trainDrivers) if (holder === desk) return this.trains.find((t) => t.id === trainId) ?? null
    return null
  }

  /** True while this screen watches its selected train, a desk at its controls: no console here, no driving from this keyboard */
  get isSpectating(): boolean {
    return this.isPlayMode && this.selectedTrainId !== null && this.trainDrivers.has(this.selectedTrainId)
  }

  /** The train this screen drives: its selected one, unless a desk holds it */
  private get hostTrain(): TrainSet | null {
    const train = this.selectedTrain
    return train && !this.trainDrivers.has(train.id) ? train : null
  }

  /** The train the camera follows in driving mode */
  get cameraTrain(): TrainSet | null {
    return this.selectedTrain
  }

  /** A desk sat down in the room (or gave its name again) */
  seatDesk = (desk: number, name?: string): void => {
    const given = name?.trim() ?? ''
    if (this.deskNames.get(desk) === given) return
    this.deskNames.set(desk, given)
    this.notify()
  }

  /**
   * A desk fell silent or lost its link: the handles of its train go to rest, and the train stays
   * its own for the time it may take to come back (see `DESK_RETURN_GRACE_MS` in the session)
   */
  restDesk = (desk: number): void => {
    const train = this.deskTrain(desk)
    if (!train) return
    if (train.brakeCommand !== 'hold') setBrakeCommand(train, 'hold')
    if (train.notch > 0) setNotch(train, 0)
    this.notify()
  }

  /** A desk left the room: the train it held is nobody's */
  unseatDesk = (desk: number): void => {
    this.releaseTrain(desk)
    if (this.deskNames.delete(desk)) this.notify()
  }

  /** The room closed: every desk is gone */
  unseatAllDesks = (): void => {
    for (const desk of [...this.deskNames.keys()]) this.unseatDesk(desk)
  }

  /**
   * A desk takes the controls of a train (driving starts if it had not). Refused when another
   * desk holds it. The train the desk held before is let go. This screen's own train may be
   * taken: the screen then watches it, and is free to pick another one.
   */
  takeTrain = (trainId: string, desk: number): boolean => {
    const train = this.trains.find((t) => t.id === trainId)
    if (!train) return false
    const holder = this.trainDrivers.get(trainId)
    if (holder === desk) return true
    if (holder !== undefined) return false
    if (!this.isPlayMode) {
      if (!this.selectedTrain) this.selectTrainById(trainId)
      this.togglePlayMode()
      if (!this.isPlayMode) return false
    }
    this.releaseTrain(desk)
    // What this screen held on the handle of that train is not the desk's
    if (trainId === this.selectedTrainId) this.centreSelectedTrainBrake()
    this.trainDrivers.set(trainId, desk)
    this.notify()
    return true
  }

  /** A desk lets go of its train: handles at rest, the train is nobody's (the simulation goes on) */
  releaseTrain = (desk: number): void => {
    const train = this.deskTrain(desk)
    if (!train) return
    this.trainDrivers.delete(train.id)
    if (train.brakeCommand !== 'hold') setBrakeCommand(train, 'hold')
    if (train.notch > 0) setNotch(train, 0)
    this.notify()
  }

  /** Follow this train with the camera: it becomes the one this screen looks at, and drives when no desk holds it */
  spectateTrain = (trainId: string | null): void => {
    if (trainId !== null && trainId !== this.selectedTrainId && this.trains.some((t) => t.id === trainId)) {
      // The train left behind keeps its brake where it is: nobody holds its handle any more
      this.centreSelectedTrainBrake()
      this.selectTrainById(trainId)
    }
    this.followLocomotiveCamera = true
    this.centreCameraOnTrain(this.cameraTrain)
    this.notify()
  }

  /** Stop following any train, the view moves freely */
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
  /** First click of the platform tool: where the platform starts (see `application/tools/platformTool.ts`) */
  platformStart: TrackPoint | null = null
  /** Platform tool: lay one platform on each side of the track (the toggle of the bar) */
  platformBothSides = false
  /** Platform tool: Shift is held, which turns « both sides » the other way while it is */
  platformShiftHeld = false
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
  /** Station picked with the selection tool (read only: its panel says what it is) */
  selectedStationId: string | null = null
  /** Station under the cursor with the selection tool */
  hoveredStationId: string | null = null
  /** The station mark being dragged with the selection tool, and where it stood */
  stationDrag: { id: string; origin: Point } | null = null
  /** Platform picked with the selection tool */
  selectedPlatformId: string | null = null
  /** Platform under the cursor with the selection tool */
  hoveredPlatformId: string | null = null
  /** An end (« borne ») or a stop marker of a platform being dragged, and the platform as it was */
  platformDrag: PlatformDrag | null = null
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
    if (this.isNetworkLocked) return false
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
    this.platformStart = null
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
    if (this.isNetworkLocked) return false
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
    // A dataset project has nothing to undo: its track is read only, and its save is a recipe
    if (this.isNetworkLocked) return
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
      this.gradientSettings,
      this.lineSettings,
      this.signallingSettings,
      undefined,
      this.projectOrigin,
    )
    // Truncate any forward redo history if we are in the middle of history
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1)
    }
    this.history.push(snapshot)
    // A step taken from a track that needs no mending is put back without looking for any
    const tolerance = this.getPlacementThresholds().reconcileTolerance
    if (isNetworkReconciled(this.network, tolerance)) reconciledSteps.set(snapshot, tolerance)
    // As many steps as the memory allows: fewer on a very large network, never less than one undo
    const weight = (step: SerializedProject): number => step.nodes.length + step.segments.length
    let total = 0
    for (const step of this.history) total += weight(step)
    while (this.history.length > 2 && (this.history.length > this.maxHistory || total > HISTORY_BUDGET)) {
      total -= weight(this.history.shift()!)
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
        // The step is put back onto the network in place: what did not change is kept as it is
        const res = deserializeNetwork(snapshot, reconciledSteps.get(snapshot), this.network)
        this.network = res.network
        this.restoreTrains(res.trains)
        applySectionMeta(this.sectionMeta, snapshot.sectionMeta ?? {})
        if (res.unit) this.unit = res.unit
        if (res.scalePreset) this.scalePreset = res.scalePreset
        if (res.gauge) this.gauge = res.gauge
        if (res.trackSpacing) {
          this.trackSpacing = res.trackSpacing
          this.parallelOffset = res.trackSpacing
        }
        this.restoreGradientSettings(res)
        this.osmSource = res.osmSource ?? null
        this.restoreLineSettings(res)
        this.restoreSignallingSettings(res)
        if (typeof res.showDimensions === 'boolean') this.showDimensions = res.showDimensions
        this.selection = { nodes: new Set(), segments: new Set() }
        this.selectedStationId = null
        this.selectedPlatformId = null
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
        // The step is put back onto the network in place: what did not change is kept as it is
        const res = deserializeNetwork(snapshot, reconciledSteps.get(snapshot), this.network)
        this.network = res.network
        this.restoreTrains(res.trains)
        applySectionMeta(this.sectionMeta, snapshot.sectionMeta ?? {})
        if (res.unit) this.unit = res.unit
        if (res.scalePreset) this.scalePreset = res.scalePreset
        if (res.gauge) this.gauge = res.gauge
        if (res.trackSpacing) {
          this.trackSpacing = res.trackSpacing
          this.parallelOffset = res.trackSpacing
        }
        this.restoreGradientSettings(res)
        this.osmSource = res.osmSource ?? null
        this.restoreLineSettings(res)
        this.restoreSignallingSettings(res)
        if (typeof res.showDimensions === 'boolean') this.showDimensions = res.showDimensions
        this.selection = { nodes: new Set(), segments: new Set() }
        this.selectedStationId = null
        this.selectedPlatformId = null
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
  /** How fast the simulated time runs against the real one; the host's choice, kept across projects */
  timeFactor: TimeFactor = 1
  /** Address of this PC on the local network, typed by the user for the phone desk; empty when none */
  remoteDeskHost = ''
  /** What each side holds the brake handle on (see `setSelectedTrainBrakeCommand`), and on which train */
  private brakeHolds: Record<BrakeSource, BrakeCommand> = { local: 'hold', remote: 'hold' }
  private brakeHoldTrainId: string | null = null
  projectName = DEFAULT_PROJECT_NAME
  dirty = false

  setSectionMeta = (sectionId: string, meta: Partial<SectionMetadata>): void => {
    if (this.isNetworkLocked) return
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
    sectionMetaChanged(this.sectionMeta, sectionIds.flatMap((sectionId) => [sectionId, ...sectionId.split('-')]))
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
    const savedAid = loadDrivingAid()
    if (isDrivingAid(savedAid)) this.drivingAid = savedAid
    const savedFactor = Number(loadTimeFactorPreference())
    if (isTimeFactor(savedFactor)) this.timeFactor = savedFactor
    this.remoteDeskHost = loadRemoteHostPreference()
    this.loadPersistedState()
    if (!this.datasetReloadPending) this.restoreSavedGame()
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
    this.dataset = saved.dataset ?? null
    if (saved.dataset && saved.network.segments.size === 0) {
      // A recipe without its geometry: the application fetches the lines again and puts the trains back
      this.datasetReloadPending = true
      this.savedGamePending = true
      this.datasetStoredProject = saved.stored
    }
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
    this.osmSource = saved.osmSource ?? null
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
    this.forgetDataset()
    // A full export of a dataset project carries its recipe: it stays read only
    if (res.dataset) this.dataset = res.dataset
    this.adoptLoadedProject(res)
    this.selection = { nodes: new Set(), segments: new Set() }
    this.selectedStationId = null
    this.selectedPlatformId = null
    this.resetPendingToolState()
    if (res.dataset) {
      this.history = []
      this.historyIndex = -1
      this.pendingEdit = 'none'
    }
    this.markDirty()
    this.notify()
  }

  /**
   * Add a project file to the current project instead of replacing it (« Ajouter un JSON au
   * projet… »): the file takes ids of its own, is moved onto the map of the current project when
   * both say where they are, and what the two have in common is taken once (`mergeProjects`).
   * The network is brought to the result in place, then welded and cut where the two meet. The
   * view, the name and the settings stay those of the current project; one step of the history.
   * Returns what was done (`repairs`: the rails and nodes the welding made or took away), null when the network cannot be edited (driving, dataset project);
   * throws « Fichier JSON invalide » when the data is not a project.
   */
  mergeProjectFile = (data: unknown): MergeOutcome | null => {
    if (!this.canEditNetwork) return null
    if (!isProjectFile(data)) throw new Error('Fichier JSON invalide')
    const tolerance = this.getPlacementThresholds().reconcileTolerance
    const current = this.exportProject()
    const { project, report } = mergeProjects(current, data, { tolerance })
    // The trains of the current project stay the objects they are, held where they stand while
    // the rails are welded under them; only those the file brings are taken from what is read
    const mine = new Set(this.trains.map((train) => train.id))
    this.pinTrains()
    const res = deserializeNetwork(project, undefined, this.network)
    this.network = res.network
    // Loading welds and cuts where the two meet, and a pass stops after a number of repairs:
    // again until one finds nothing. What it did shows in the rails it made
    for (let pass = 0; pass < 50; pass++) {
      const { splitCount, weldedCount } = reconcileNetworkIntersections(this.network, tolerance)
      if (splitCount + weldedCount === 0) break
    }
    const repairs = Math.abs(this.network.segments.size - project.segments.length) + Math.abs(this.network.nodes.size - project.nodes.length)
    this.realignTrains()
    this.unpinTrains()
    const brought = pruneTrainsToNetwork(this.network, res.trains.filter((train) => !mine.has(train.id)))
    if (brought.length > 0) {
      this.trains = [...this.trains, ...brought]
      this.refreshCouplerPoints()
    }
    this.syncTrainsWithNetwork()
    applySectionMeta(this.sectionMeta, res.sectionMeta ?? {})
    if (!this.osmSource && res.osmSource) this.osmSource = res.osmSource
    this.selection = { nodes: new Set(), segments: new Set() }
    this.resetPendingToolState()
    this.markDirty()
    return { ...report, repairs }
  }

  /** The trains, settings and provenance a loaded file brings; its network is already in place */
  private adoptLoadedProject(res: ReturnType<typeof deserializeNetwork>): void {
    this.locomotive = null
    this.restoreTrains(res.trains)
    this.autopilots.clear()
    this.savedGamePending = false
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
    // The provenance belongs to the loaded file, like the section names
    this.osmSource = res.osmSource ?? null
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
  }

  /** The project is no longer one of the dataset */
  private forgetDataset(): void {
    this.dataset = null
    this.datasetIndex = null
    this.datasetFiles = new Map()
    this.railLineMap = new Map()
    this.datasetSeen.clear()
    this.datasetGeneration++
    this.datasetFilesRevision++
    this.datasetPending.clear()
    this.datasetLoader = null
    this.datasetReloadPending = false
    this.datasetStoredProject = null
  }

  /**
   * Load the lines of the dataset as a locked project: `project` is their union (already
   * reconciled by the generator, so it is adopted as it is), `files` the file of each line,
   * `frame` the box the camera is put on unless the project (or `options.camera`) has one.
   * Trains given in `options` stand in for those of the project (a recipe reloaded at start).
   */
  loadDataset = (
    recipe: DatasetRecipe,
    project: SerializedProject,
    files: ReadonlyMap<LineId, SerializedProject>,
    index: DatasetIndex,
    frame: BBox | null,
    options: { name?: string; trains?: SerializedProject['trains']; camera?: SerializedProject['camera'] } = {},
  ): void => {
    const data: SerializedProject = { ...project }
    if (options.trains !== undefined) data.trains = options.trains
    // The camera of a line file (if any) says nothing: the frame of the journey does, unless a saved one is given
    if (options.camera) data.camera = options.camera
    else delete data.camera
    const tolerance = placementThresholds(typeof data.gauge === 'number' ? data.gauge : undefined).reconcileTolerance
    const res = deserializeNetwork(data, tolerance)
    this.network = res.network
    this.dataset = recipe
    this.datasetIndex = index
    this.datasetFiles = new Map(files)
    this.railLineMap = new Map()
    for (const [id, file] of this.datasetFiles) for (const seg of file.segments) if (!this.railLineMap.has(seg.id)) this.railLineMap.set(seg.id, id)
    this.datasetSeen.clear()
    this.datasetGeneration++
    this.datasetFilesRevision++
    this.datasetPending.clear()
    this.datasetReloadPending = false
    this.adoptLoadedProject(res)
    // A stored project found again (its trains come with it): they are in place only now, and get
    // back what they were doing — each time, were the lines fetched twice
    if (options.trains !== undefined) this.restoreSavedGame()
    if (options.name) this.projectName = options.name
    if (!options.camera && frame) this.frameBox(frame)
    this.selection = { nodes: new Set(), segments: new Set() }
    this.resetPendingToolState()
    this.tool = 'select'
    // Nothing to undo back to: the dialog said the previous project would be replaced
    this.history = []
    this.historyIndex = -1
    this.pendingEdit = 'none'
    this.autosaveFailed = false
    this.selectedStationId = recipe.stations.find((id) => this.network.stations.has(id)) ?? null
    this.markDirty()
    this.notify()
  }

  /** Put the camera on a world box, with a margin, within the viewport */
  frameBox = (box: BBox, viewportW?: number, viewportH?: number): void => {
    const vw = viewportW ?? this.viewport.w
    const vh = viewportH ?? this.viewport.h
    const width = Math.max(1, box.maxX - box.minX)
    const height = Math.max(1, box.maxY - box.minY)
    this.camera.x = (box.minX + box.maxX) / 2
    this.camera.y = (box.minY + box.maxY) / 2
    this.camera.scale = clampScale(0.9 * Math.min(vw / width, vh / height))
    this.notifyView()
  }

  /** Once a second while driving: the lines are checked against the trains (and the view) */
  private checkDatasetLines(dt: number): void {
    if (!this.dataset || !this.datasetIndex || !this.datasetLoader) return
    this.datasetCheckElapsed += dt
    if (this.datasetCheckElapsed < DATASET_CHECK_PERIOD_S) return
    this.datasetCheckElapsed = 0
    this.refreshDatasetLines()
  }

  /** The box of the world the canvas shows, from the camera and the size of the viewport */
  private get viewBox(): BBox {
    const halfW = this.viewport.w / 2 / this.camera.scale
    const halfH = this.viewport.h / 2 / this.camera.scale
    return { minX: this.camera.x - halfW, minY: this.camera.y - halfH, maxX: this.camera.x + halfW, maxY: this.camera.y + halfH }
  }

  /** True when the view is close enough for the pieces it meets to be fetched: from the « rails » tier of the track up */
  get isDatasetViewNear(): boolean {
    // The rails are drawn at standard gauge whatever the project's (`renderer.ts`, `GAUGE`)
    const tier = trackLod(this.camera.scale, STANDARD_TRACK_GAUGE)
    return tier === 'rails' || tier === 'detail'
  }

  /**
   * Bring the lines (pieces of lines) of a dataset project in line with where one looks and where
   * the trains run, in every mode, paused or not: called once a second while the trains run, and
   * by the canvas when the view moves (`useDatasetStreaming`).
   * - fetched: the pieces whose box meets the view and its margin (`DATASET_VIEW_MARGIN_M`) once
   *   the view is close enough (`isDatasetViewNear`: the overview is enough further out), and the
   *   pieces beyond a connection within reach of a train's lead (`DATASET_LOOKAHEAD_M`);
   * - dropped: the pieces far from the view and from every train (`DATASET_KEEP_M`), never one a
   *   vehicle stands on nor one asked for; and past `datasetMaxPieces`, the ones seen longest ago.
   */
  refreshDatasetLines = (): void => {
    const index = this.datasetIndex
    if (!this.dataset || !index) return
    this.datasetRefreshedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const clock = ++this.datasetClock
    const loaded = new Set(this.datasetFiles.keys())
    const wanted = new Set<LineId>()

    // Ahead of the trains: the lines beyond the connections within reach of a lead
    const gates = connectionsToward(index, loaded)
    const leads: Point[] = []
    for (const train of this.trains) {
      const lead = train.vehicles[0]
      const pos = lead ? positionOnSegment(this.network, lead.front.segId, lead.front.t) : null
      if (!pos) continue
      leads.push(pos)
      for (const gate of gates) {
        if (Math.hypot(gate.x - pos.x, gate.y - pos.y) > DATASET_LOOKAHEAD_M) continue
        for (const id of gate.lines) if (!this.datasetPending.has(id)) wanted.add(id)
      }
      for (const line of index.lines) {
        if (loaded.has(line.id) && distanceToBox(pos.x, pos.y, line.bbox) <= DATASET_LOOKAHEAD_M) this.datasetSeen.set(line.id, clock)
      }
    }

    // In view: what the view meets is seen; fetched once the view is close enough
    const view = this.viewBox
    const margin = { minX: view.minX - DATASET_VIEW_MARGIN_M, minY: view.minY - DATASET_VIEW_MARGIN_M, maxX: view.maxX + DATASET_VIEW_MARGIN_M, maxY: view.maxY + DATASET_VIEW_MARGIN_M }
    const near = this.isDatasetViewNear
    for (const line of index.lines) {
      if (!boxesMeet(line.bbox, margin)) continue
      if (loaded.has(line.id)) this.datasetSeen.set(line.id, clock)
      else if (near && !this.datasetPending.has(line.id)) wanted.add(line.id)
    }

    // Never dropped: what a vehicle stands on, what is asked for or on its way
    const held = new Set<LineId>([...wanted, ...this.datasetPending])
    for (const id of this.occupiedLines()) {
      held.add(id)
      this.datasetSeen.set(id, clock)
    }
    // Far from every train and from the view (which reaches as far as it shows)
    const centre = { x: this.camera.x, y: this.camera.y, keep: DATASET_KEEP_M + Math.hypot(view.maxX - view.minX, view.maxY - view.minY) / 2 }
    const far = new Set(linesToDrop(index, loaded, [...leads, centre], DATASET_KEEP_M, held))
    // And past the cap, the ones seen longest ago, with room for those to come
    const left = [...loaded].filter((id) => !far.has(id))
    for (const id of piecesOverCap(left, this.datasetSeen, held, this.datasetMaxPieces, wanted.size)) far.add(id)
    if (far.size > 0) this.removeDatasetLines([...far])

    if (wanted.size === 0 || !this.datasetLoader) return
    // Never more at once than the cap holds: the nearest the middle of the view first
    const ids = [...wanted]
      .sort((a, b) => distanceToBox(this.camera.x, this.camera.y, lineBox(index, a)) - distanceToBox(this.camera.x, this.camera.y, lineBox(index, b)))
      .slice(0, Math.max(1, this.datasetMaxPieces))
    for (const id of ids) this.datasetPending.add(id)
    const generation = this.datasetGeneration
    void this.datasetLoader(ids)
      .then((files) => {
        // The project was replaced meanwhile: what it asked for is not this one's
        if (generation !== this.datasetGeneration) return
        const rails = this.addDatasetLines(files)
        for (const id of files.keys()) this.datasetSeen.set(id, this.datasetClock)
        if (rails > 0) this.onDatasetLinesAdded?.(ids, rails)
      })
      .catch((error: unknown) => {
        if (generation !== this.datasetGeneration) return
        console.warn('Lignes du jeu de données non chargées', error)
        this.onDatasetError?.(error)
      })
      .finally(() => {
        if (generation === this.datasetGeneration) for (const id of ids) this.datasetPending.delete(id)
      })
  }

  /** The lines (pieces of lines) a vehicle of a train stands on */
  private occupiedLines(): Set<LineId> {
    const railLine = this.railLine
    const occupied = new Set<LineId>()
    for (const train of this.trains) {
      for (const veh of train.vehicles) {
        for (const pos of [veh.front, veh.rear]) {
          const line = railLine.get(pos.segId)
          if (line) occupied.add(line)
        }
      }
    }
    return occupied
  }

  /** The reconcile tolerance of the dataset project: the one its files were reconciled at */
  private datasetTolerance(file: SerializedProject): number {
    return placementThresholds(typeof file.gauge === 'number' ? file.gauge : undefined).reconcileTolerance
  }

  /**
   * Add the files of some lines to the dataset project, in place: each one is put onto the live
   * network alone (`addSliceInPlace`) — what is already there stays the object it is, the trains
   * keep their rails, the driving goes on. Returns how many rails were added.
   */
  addDatasetLines = (files: ReadonlyMap<LineId, SerializedProject>): number => {
    if (!this.dataset) return 0
    const added: LineId[] = []
    for (const [id, project] of files) {
      if (this.datasetFiles.has(id)) continue
      added.push(id)
      this.datasetFiles.set(id, project)
    }
    if (added.length === 0) return 0
    this.datasetFilesRevision++
    const before = this.network.segments.size
    const t0 = performance.now()
    // The files come after those already loaded, in their order: each is put on with the ones before it
    const all = [...this.datasetFiles.values()]
    const base = all.length - added.length
    for (const [i, id] of added.entries()) {
      const file = files.get(id)!
      const upTo = all.slice(0, base + i + 1)
      addSliceInPlace(this.network, file, upTo, this.datasetTolerance(file))
      for (const seg of file.segments) if (!this.railLineMap.has(seg.id)) this.railLineMap.set(seg.id, id)
      if (file.sectionMeta) {
        const keys = Object.keys(file.sectionMeta).filter((key) => !(key in this.sectionMeta))
        for (const key of keys) this.sectionMeta[key] = file.sectionMeta[key]
        if (keys.length) sectionMetaChanged(this.sectionMeta, keys)
      }
    }
    this.keepTrainIdsClear()
    this.dataset = { ...this.dataset, lines: [...this.dataset.lines, ...added] }
    this.datasetLastAddMs = performance.now() - t0
    this.savePersistedState()
    this.notify()
    return this.network.segments.size - before
  }

  /**
   * Putting lines onto the live network sets the ids to come after those of the track alone: the
   * trains, which are not part of what is put back, keep theirs — a train added afterwards must
   * not be given the id of one that is running.
   */
  private keepTrainIdsClear(): void {
    let highest = 0
    const scan = (id: string): void => {
      const n = Number(id.slice(id.lastIndexOf('_') + 1))
      if (Number.isInteger(n) && n > highest) highest = n
    }
    for (const train of this.trains) {
      scan(train.id)
      for (const veh of train.vehicles) scan(veh.id)
    }
    raiseIdCounter(highest)
  }

  /**
   * Drop some lines (or pieces of lines) of the dataset project, in place: each one is taken off
   * the live network alone (`removeSliceInPlace`), what another file holds too stays, everything
   * else stays the object it is. A line a vehicle stands on is kept whatever is asked; the last
   * one may go (the project is then the overview alone). Returns how many rails went.
   */
  removeDatasetLines = (ids: readonly LineId[]): number => {
    if (!this.dataset || ids.length === 0) return 0
    const occupied = this.occupiedLines()
    const going = [...new Set(ids)].filter((id) => this.datasetFiles.has(id) && !occupied.has(id))
    if (going.length === 0) return 0
    this.datasetFilesRevision++
    const before = this.network.segments.size
    const t0 = performance.now()
    for (const id of going) {
      const file = this.datasetFiles.get(id)!
      this.datasetFiles.delete(id)
      this.datasetSeen.delete(id)
      const remaining = [...this.datasetFiles.values()]
      removeSliceInPlace(this.network, file, remaining, this.datasetTolerance(file))
      // A rail another file holds too now goes with that one
      for (const seg of file.segments) {
        if (this.railLineMap.get(seg.id) !== id) continue
        this.railLineMap.delete(seg.id)
        for (const [other, project] of this.datasetFiles) {
          if (sliceHoldsRail(project, seg.id)) {
            this.railLineMap.set(seg.id, other)
            break
          }
        }
      }
    }
    this.keepTrainIdsClear()
    this.dataset = { ...this.dataset, lines: this.dataset.lines.filter((id) => !going.includes(id)) }
    this.datasetLastRemoveMs = performance.now() - t0
    this.savePersistedState()
    this.notify()
    return before - this.network.segments.size
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
      this.gradientSettings,
      this.lineSettings,
      this.signallingSettings,
      this.signalDisplaySettings,
      this.projectOrigin,
    )
  }

  /** The write of the project to localStorage that is waiting, if any */
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  /** True when the last write to localStorage failed: the project is larger than the browser keeps */
  autosaveFailed = false
  /** Nodes and rails of the project when that write failed: a project that large is not written again */
  private autosaveFailedSize = 0

  /**
   * Save the project to localStorage. In the browser the write waits AUTOSAVE_DELAY_MS, so that
   * a run of edits is written once: on a large network, writing the whole project costs more than
   * the edit itself. Leaving the page writes at once (`flushPersistedState`). Without a window
   * (the tests) it is written straight away.
   */
  savePersistedState = (): void => {
    if (typeof window === 'undefined') {
      this.flushPersistedState()
      return
    }
    if (this.saveTimer !== null) return
    this.saveTimer = setTimeout(() => this.flushPersistedState(), AUTOSAVE_DELAY_MS)
  }

  /** Write the project to localStorage now, whether or not a write was waiting */
  flushPersistedState = (): void => {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    // What the trains are doing goes with where they stand: a page loaded again finds the game as it was
    // (not while the lines of a real network are still being fetched again: the game written then is the one to find)
    if (!this.savedGamePending) saveGameState(captureGame(this.trains, new Set(this.autopilots.keys()), this.isFreeView || (!this.isPlayMode && this.leftInFreeView)))
    // Putting a project the browser has no room for into text again at every edit is time spent
    // for nothing: it is tried again once the project is smaller
    // A dataset project is saved as its recipe: the lines are fetched again, never written
    const recipeOnly = this.dataset !== null
    const size = recipeOnly ? 0 : this.network.nodes.size + this.network.segments.size
    if (this.autosaveFailed && size >= this.autosaveFailedSize) return
    const sections = recipeOnly ? undefined : networkDerived(this.network, this.sectionMeta).sections
    const saved = saveNetworkToStorage(
      recipeOnly ? EMPTY_NETWORK : this.network,
      this.projectName,
      this.camera,
      recipeOnly ? undefined : this.sectionMeta,
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
      this.gradientSettings,
      this.lineSettings,
      this.signallingSettings,
      this.signalDisplaySettings,
      this.projectOrigin,
    )
    if (!saved) this.autosaveFailedSize = size
    if (saved === this.autosaveFailed) {
      // The top bar says whether the project is kept by the browser
      this.autosaveFailed = !saved
      this.version++
      this.listeners.forEach((l) => l())
    }
  }

  /**
   * Reset the project to a fresh empty layout and clear localStorage.
   */
  newProject = (): void => {
    this.network = createNetwork()
    this.locomotive = null
    this.restoreTrains([])
    this.autopilots.clear()
    this.savedGamePending = false
    this.restoreSignallingSettings({})
    this.restoreSignalDisplay({})
    this.flatLevels = false
    this.osmSource = null
    this.forgetDataset()
    this.sectionMeta = {}
    this.selection = { nodes: new Set(), segments: new Set() }
    this.selectedStationId = null
    this.selectedPlatformId = null
    this.tool = 'pan'
    this.resetPendingToolState()
    this.projectName = DEFAULT_PROJECT_NAME
    this.camera.x = 0
    this.camera.y = 0
    this.camera.scale = 3
    this.dirty = false
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.autosaveFailed = false
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

  /** The network `notify` last checked the route tables, zones and signals of, its revision then, and where in its feed of changes */
  private syncedNetwork: Network | null = null
  private syncedToken: number | undefined = undefined
  private syncedCursor: number | undefined = undefined

  /** Notify UI subscribers that something changed. Call after mutating state. */
  notify = (): void => {
    this.drivenDynamics = null
    // The route tables, zones and signals only need checking against a network that changed
    // since they last were (see `networkWatch`)
    const token = networkCheckToken(this.network)
    if (token === undefined || token !== this.syncedToken || this.network !== this.syncedNetwork) {
      // Only the tables at the nodes where something changed since the last check can have anything to follow
      const reading = networkChangesSince(this.network, this.network === this.syncedNetwork ? this.syncedCursor : undefined)
      const scope = token !== undefined && reading.changes ? dirtyNodesOf(reading.changes, reading.index) : undefined
      autoDetectJunctions(this.network, scope)
      if (scope && verifyingNetworkRevisions()) {
        // Tests: a check of every table right after must find nothing to follow
        const after = networkCheckToken(this.network)
        autoDetectJunctions(this.network)
        if (networkCheckToken(this.network) !== after) throw new Error('A route table away from the nodes that changed had something to follow')
      }
      // The domain moves the zones itself when a rail is replaced; this only drops what would be
      // left on a rail taken out of the graph by other means
      cleanSpeedZones(this.network)
      cleanSignals(this.network)
      cleanStations(this.network)
      // After the stations: the stops of a station that has platforms are drawn from their markers
      settlePlatforms(this.network)
      this.syncedNetwork = this.network
      this.syncedToken = networkCheckToken(this.network)
      // What the check itself changed (tables) is not to be checked again
      this.syncedCursor = networkChangesSince(this.network, reading.cursor).cursor
    }
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

  /** When the panels were last rendered again from the simulation loop, ms */
  private lastFrameRender = 0

  /**
   * Tell the subscribers that the trains moved, from the simulation loop. The canvas draws every
   * frame a train moved (`moved`); the panels (driving console, toolbar) are only rendered again every
   * `DRIVING_PANEL_PERIOD_MS`, which is as fast as their figures can be read. The network is not
   * checked: a train that runs does not change it, and whatever does — points thrown, a command of
   * the driver — calls `notify` itself.
   */
  notifyFrame = (moved = true): void => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const panels = now - this.lastFrameRender >= DRIVING_PANEL_PERIOD_MS || now < this.lastFrameRender
    if (panels) {
      this.lastFrameRender = now
      this.version++
    }
    // Every train at a stand: the picture is the one already on screen. It is drawn again with the
    // panels only, for what still changes without a train moving (a signal clearing, a gauge).
    if (moved || panels) this.listeners.forEach((l) => l())
  }

  /**
   * Driving view kept to what a driver reads — rails, points, route, signals, speed boards, trains:
   * the grid, the stripes of the sections, the bands of the speed zones, the marks of cant and
   * slope and the scale bar are left out while driving. Ticked by default.
   */
  minimalDrivingView = true

  /** True while the canvas draws the plain driving view */
  get isPlainDrivingView(): boolean {
    return this.isPlayMode && this.minimalDrivingView
  }

  toggleMinimalDrivingView = (): void => {
    this.minimalDrivingView = !this.minimalDrivingView
    this.notify()
  }

  setTool = (t: Tool): void => {
    // A dataset project keeps its track as it is: only the looking and train tools apply
    if (this.isNetworkLocked && !DATASET_LOCKED_TOOLS.has(t)) return
    // While trains run nothing is laid nor cut: the track is what they run on
    if (this.isPlayMode && !DATASET_LOCKED_TOOLS.has(t)) return
    // If transitioning away from an active creation without finishing, clean up abandoned degree 0 nodes
    this.discardPendingPlacement()

    // The construction tools mark their working node through the selection: it must not
    // survive as a real selection (and show the gizmo) once the tool is left
    if (this.tool !== t && (this.tool === 'place' || this.tool === 'curve' || this.tool === 'turnout')) {
      this.selection = { nodes: new Set(), segments: new Set() }
      this.selectedStationId = null
      this.selectedPlatformId = null
    }

    // A station or a platform is only picked with the selection tool
    if (t !== 'select') {
      this.selectedStationId = null
      this.selectedPlatformId = null
      this.hoveredStationId = null
      this.hoveredPlatformId = null
      this.cancelPlatformGesture()
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
    if (this.isNetworkLocked) return false
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
    if (this.isNetworkLocked) return false
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

  /** Run the simulated time faster or slower than the real one; the choice follows the user across projects */
  setTimeFactor = (factor: number): void => {
    if (!isTimeFactor(factor) || factor === this.timeFactor) return
    this.timeFactor = factor
    saveTimeFactorPreference(factor)
    this.notify()
  }

  /** The next factor of the list, back to ×1 after the last */
  cycleTimeFactor = (): void => {
    const i = TIME_FACTORS.indexOf(this.timeFactor)
    this.setTimeFactor(TIME_FACTORS[(i + 1) % TIME_FACTORS.length])
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
    this.selectedStationId = null
    this.selectedPlatformId = null
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
    // So is a platform end, a stop marker or a station mark being dragged (it goes back where it was)
    const hadPlatformGesture = this.cancelPlatformGesture()
    const hadPending =
      hadPlacement ||
      hadPlatformGesture ||
      this.measureStart !== null ||
      this.speedZoneStart !== null ||
      this.platformStart !== null ||
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
    for (const nid of this.draggedNodeInitialPositions.keys()) touchNetwork(this.network, nid)
    for (const sid of this.draggedViaInitialPositions.keys()) touchNetwork(this.network, sid)
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
    // A platform picked with the selection tool: Delete removes it, and nothing else
    if (this.tool === 'select' && this.selectedPlatform) {
      this.deleteSelectedPlatform()
      return
    }
    // A station picked: Delete removes it with its platforms
    if (this.tool === 'select' && this.selectedStation) {
      this.deleteStation(this.selectedStation.id)
      return
    }
    if (this.isTrainSelected || this.tool === 'locomotive' || this.tool === 'coupling') {
      if (this.selectedTrain || this.locomotive) {
        this.deleteSelectedTrainOrVehicle()
        return
      }
    }

    // The track of a dataset project stays
    if (this.isNetworkLocked) return

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
          sectionMetaChanged(this.sectionMeta, [dissolvedSeg.id])
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
    if (this.isNetworkLocked) return { splitCount: 0, weldedCount: 0 }
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
    if (this.isNetworkLocked) return false
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

  /**
   * What slopes are measured against (see `analyzeKinematics`), for the diagnostics, the drawing,
   * the panels and the driving physics alike. With levels without relief a level has no height:
   * every slope is zero, so nothing is reported, marked or felt by a train.
   */
  get gradientLimits(): GradientLimits {
    return { levelHeight: this.flatLevels ? 0 : this.levelHeight, maxGradient: this.maxGradient }
  }

  /** The slope settings as the project stores them, whether the levels have relief or not */
  private get gradientSettings(): GradientLimits {
    return { levelHeight: this.levelHeight, maxGradient: this.maxGradient }
  }

  /** What an import leaves in the project, saved with it */
  private get projectOrigin(): ProjectOrigin {
    return { flatLevels: this.flatLevels, osmSource: this.osmSource, dataset: this.dataset }
  }

  /** Levels with or without relief. One undo step when it changed. */
  setFlatLevels = (value: boolean): void => {
    if (value === this.flatLevels) return
    this.flatLevels = value
    this.markDirty()
    this.notify()
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
  private restoreGradientSettings(saved: { levelHeight?: number; maxGradient?: number; flatLevels?: boolean }): void {
    const preset = SCALE_PRESETS[this.scalePreset] ?? SCALE_PRESETS['1:1']
    this.levelHeight = saved.levelHeight ?? preset.defaultLevelHeight
    this.maxGradient = saved.maxGradient ?? preset.defaultMaxGradient
    this.flatLevels = saved.flatLevels ?? false
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
    if (this.isNetworkLocked) return { splitCount: 0, weldedCount: 0 }
    const res = reconcileNetworkIntersections(this.network, tolerance)
    const pruned = this.pruneOrphans(false)
    if (res.splitCount > 0 || res.weldedCount > 0 || pruned > 0) {
      this.markDirty()
      this.notify()
    }
    return res
  }

  /**
   * Replace every run of small rails between two junctions by long rails (see `mergeIntoLongRails`):
   * far fewer rails and nodes for the same track, within a few decimetres of it. One undo step.
   * Refused while driving. Returns the number of rails before and after, null when refused.
   */
  simplifyToLongRails = (): { before: number; after: number } | null => {
    if (this.isPlayMode || this.isNetworkLocked) return null
    this.selection = { nodes: new Set(), segments: new Set() }
    this.selectedStationId = null
    this.selectedPlatformId = null
    const result = mergeIntoLongRails(this.network, {
      fit: fitPath,
      // 30 cm at full size, and the same share of the gauge on a model scale
      tolerance: LONG_RAIL_TOLERANCE * (this.gauge / STANDARD_TRACK_GAUGE),
      cutStraightsOver: LONG_RAIL_CUT_STRAIGHTS * (this.gauge / STANDARD_TRACK_GAUGE),
    })
    if (result.merged > 0) {
      this.markDirty()
      this.notify()
    }
    return { before: result.before, after: result.after }
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
    if (this.isNetworkLocked) return
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
    if (this.isNetworkLocked) return
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
    if (this.isNetworkLocked) return
    this.selectedTurnoutHand = hand
    this.notify()
  }

  toggleTurnoutHand = (): void => {
    if (this.isNetworkLocked) return
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
    if (this.isNetworkLocked) return false
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
    // A real network has nothing to build: its game is never left, what asks for it stops the time
    if (this.isPlayMode && !this.hasBuildMode) {
      this.togglePause()
      return
    }
    this.isPlayMode = !this.isPlayMode
    this.isPaused = false
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
      // Back as it was left: on no train when the view was free, and a pilot still has a train to hold
      for (const id of [...this.autopilots.keys()]) if (!this.trains.some((t) => t.id === id)) this.autopilots.delete(id)
      if (this.trains.length > 0 && !this.selectedTrain && !(this.leftInFreeView && this.autopilots.size > 0)) {
        this.selectTrainById(this.trains[0].id)
      }
      this.leftInFreeView = false
      // The trains go on as they were left (speed, handles, pilots): a train just laid is at rest,
      // brakes applied (`makeTrainSet`), and `haltAllTrains` puts every one of them back there
      this.impactReported.clear()
      // Signals show their state from the first frame
      resetSignalling(this.signalling)
      this.refreshSignalling()
      if (this.followLocomotiveCamera) {
        this.focusOnLocomotive()
      }
      this.startSimulationLoop()
    } else {
      // Nothing of the trains is reset: the simulation is held, and goes on from here when
      // driving starts again. The desks let go: no phone drives while the time is stopped
      this.leftInFreeView = this.selectedTrainId === null && this.trains.length > 0
      this.couplingArmed = false
      for (const desk of new Set(this.trainDrivers.values())) this.releaseTrain(desk)
      this.rakePlacement = null
      this.isSidePanelOpen = this.sidePanelOpenBeforeDriving
      this.stopSimulationLoop()
      resetSignalling(this.signalling)
      this.locomotiveCurrentSpeed = 0
      this.locomotiveThrottle = 0
      // Where the trains were driven to is one undo step, and survives a reload
      const lastSaved = this.history[this.historyIndex]?.trains ?? []
      if (JSON.stringify(serializeTrains(this.trains)) !== JSON.stringify(lastSaved)) {
        this.commitTrainChange()
      }
    }
    this.notify()
  }

  /**
   * Whether there is a mode to build in besides the game. Not on a real network: its track is
   * locked, and its trains are set down, coupled and removed while the game runs.
   */
  get hasBuildMode(): boolean {
    return this.dataset === null
  }

  /**
   * Give the trains back what they were doing when the project was last written (speed, handles,
   * brakes, pilots), once the trains of the stored project are in place. A train
   * that is not where it was then stays at rest. Returns how many trains got their state back.
   */
  restoreSavedGame = (): number => {
    this.savedGamePending = false
    const game = applyGame(this.trains, loadGameState())
    for (const id of game.piloted) this.autopilots.set(id, newPilotMemory())
    this.leftInFreeView = game.freeView
    if (game.freeView) this.releaseTrainSelection()
    return game.restored
  }

  /** The game written before the page was loaded again is still to be given back: the trains of a real network come with its lines */
  private savedGamePending = false

  /** A game found again (a page loaded again): it starts with the time stopped, for the player to look before the trains move */
  enterGamePaused = (): void => {
    if (this.isPlayMode || this.trains.length === 0) return
    this.togglePlayMode()
    this.setPaused(true)
  }

  /** Driving was left from the free view: it starts again there, on no train */
  private leftInFreeView = false

  /**
   * Out of play mode with trains that were left running: a train still has speed, or a pilot holds
   * one. Driving again goes on from there; `haltAllTrains` is the way to start from rest instead.
   */
  get isSimulationHeld(): boolean {
    return !this.isPlayMode && (this.autopilots.size > 0 || this.trains.some((t) => Math.abs(t.currentSpeed) > 0.1))
  }

  /** Every train at rest, brakes applied, handles at neutral, and no pilot: the simulation starts afresh, the trains where they stand */
  haltAllTrains = (): void => {
    for (const t of this.trains) resetTrainControls(t)
    this.autopilots.clear()
    this.leftInFreeView = false
    this.forgetBrakeHolds(null)
    this.notify()
  }

  /** Stop the time of the simulation, or let it run again. Nothing is reset: speeds, handles, pilots and signals stay as they are */
  setPaused = (paused: boolean): void => {
    if (!this.isPlayMode || this.isPaused === paused) return
    this.isPaused = paused
    this.notify()
  }

  togglePause = (): void => this.setPaused(!this.isPaused)

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
      // The real time of the frame, bounded (a tab left in the background does not jump)
      const dt = Math.min((now - this.simLastTime) / 1000, 0.1)
      this.simLastTime = now
      this.simulateFrame(dt)
      this.simRafId = requestAnimationFrame(loop)
    }
    this.simRafId = requestAnimationFrame(loop)
  }

  /**
   * One frame of simulation: the step of real time, taken as many times as the time factor says.
   * Repeating the step, rather than stretching it, keeps everything that happens per step (the
   * traction and brakes taking hold, the signalling, the collisions) exactly as at ×1.
   */
  simulateFrame = (dt: number): void => {
    if (this.isPaused) return
    for (let i = 0; i < this.timeFactor; i++) {
      if (this.trains.length > 0) this.tickAllTrains(dt)
      else if (this.locomotive) this.tickSimulation(dt)
      else return
    }
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

  /** Steer the next facing turnout of a train left or right */
  steerTrainTurnout = (train: TrainSet, steerDirection: 'left' | 'right'): void => {
    // Points held for another train stay as they are; the driver may still set those held for his own
    const heldForAnother = (junc: Junction): boolean => isNodeReserved(this.signalling, junc.nodeId, train.id)
    if (steerTrainSetJunction(this.network, train, steerDirection, this.trains, heldForAnother)) this.notify()
  }

  /** Steer the upcoming junction left or right relative to the train this screen drives */
  steerUpcomingTurnout = (steerDirection: 'left' | 'right'): void => {
    if (this.selectedTrain) {
      const train = this.hostTrain
      if (train) this.steerTrainTurnout(train, steerDirection)
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
    const train = this.hostTrain
    return !!train && this.switchTrainCab(train)
  }

  /** Take the controls of a train from the cab at its other end (see `switchSelectedTrainCab`) */
  switchTrainCab = (train: TrainSet): boolean => {
    const switched = switchDrivingCab(train)
    if (!switched) return false
    this.trains = this.trains.map((t) => (t === train ? switched : t))
    const selected = switched.id === this.selectedTrainId
    if (selected) this.selectedTrainVehicleId = switched.vehicles[0].id
    this.refreshCouplerPoints()
    if (selected && this.isPlayMode && this.followLocomotiveCamera) this.centreCameraOnTrain(switched)
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
    this.isPaused = false
    this.couplingArmed = false
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

  /**
   * Set a complete rake of `model` down at a platform of a station of the network, facing the way
   * out, select it and put the camera on its head, close enough for its bogies to show. Returns
   * the stop it stands at; null for an unknown station, or when no platform free of the other
   * trains holds the whole rake. While trains are being driven it joins them: it stands at rest,
   * brakes applied, and this screen moves to it — the train it was on keeps its pilot if it has
   * one, else it is left with its brake where it is, like any train let go of.
   */
  placeRakeAtStation = (stationId: StationId, rake: RollingStockModel | RakeChoice): StationStop | null => {
    const station = this.network.stations.get(stationId)
    if (!station) return null
    const placed = createRakeAtStation(this.network, station, rake, this.trains)
    if (!placed) return null
    startItineraryAt(placed.train, stationId)
    this.adoptRake(placed.train)
    return placed.stop
  }

  /**
   * Set a complete rake of `model` down on the track nearest to a place of the world, facing the
   * way with most track ahead: a train put anywhere, while the others run. False when there is no
   * track near enough, or when the whole rake does not fit there clear of the other trains.
   */
  placeRakeAt = (worldPos: Point, rake: RollingStockModel | RakeChoice): boolean => {
    const snap = snapToNearestTrack(this.network, worldPos, Math.max(12, 45 / this.camera.scale))
    const train = snap ? createRakeAtTrack(this.network, snap.segId, snap.t, rake, this.trains) : null
    if (!train) return false
    this.rakePlacement = null
    this.adoptRake(train)
    return true
  }

  /** A rake just set down joins the trains: selected, in view close enough for its bogies, at rest when the others are driven */
  private adoptRake(train: TrainSet): void {
    if (this.isPlayMode) {
      resetTrainControls(train)
      this.centreSelectedTrainBrake()
      this.followLocomotiveCamera = true
    }
    this.trains = [...this.trains, train]
    this.trainChainId = null
    this.selectTrainById(train.id)
    this.refreshCouplerPoints()
    const head = trainAnchors(this.network, [train]).get(train.id)
    if (head) {
      this.camera.x = head.x
      this.camera.y = head.y
      this.camera.scale = clampScale(RAKE_START_SCALE)
    }
    this.commitTrainChange()
  }

  /**
   * No train of this screen while the simulation runs: the view is free, the trains go on under
   * their pilots, and a train can be taken, or a new one set down.
   */
  get isFreeView(): boolean {
    return this.isPlayMode && this.selectedTrainId === null
  }

  /** The rake the next click on the track sets down; null when no placing is armed */
  rakePlacement: RakeChoice | null = null

  armRakePlacement = (rake: RakeChoice | null): void => {
    this.rakePlacement = rake
    if (rake) this.couplingArmed = false
    this.notify()
  }

  /** While trains run: the next click on a coupling couples two rakes at rest, or parts one */
  couplingArmed = false

  armCoupling = (on: boolean): void => {
    if (!this.isPlayMode || this.couplingArmed === on) return
    this.couplingArmed = on
    if (on) this.rakePlacement = null
    this.hoveredCouplerPoint = null
    this.notify()
  }

  /** The couplings of the trains where they stand now, for the canvas while coupling is armed in the game */
  liveCouplerPoints = (): CouplerPoint[] => getAllCouplerPoints(this.network, this.trains)

  /**
   * Take a train out of the game while it runs. Refused for a train that moves, and for the last
   * one (a game has a train). This screen goes to the free view when it was on that train.
   */
  removeTrainInGame = (id: string): 'done' | 'moving' | 'last' | 'unknown' => {
    const train = this.trains.find((t) => t.id === id)
    if (!this.isPlayMode || !train) return 'unknown'
    if (this.trains.length < 2) return 'last'
    if (Math.abs(train.currentSpeed) > AT_REST_SPEED) return 'moving'
    this.autopilots.delete(id)
    this.trainDrivers.delete(id)
    this.routeGuides.delete(id)
    if (this.selectedTrainId === id) {
      this.releaseTrainSelection()
      this.followLocomotiveCamera = false
    }
    this.trains = this.trains.filter((t) => t.id !== id)
    this.commitTrainChange()
    return 'done'
  }

  /**
   * Put the ids to come back after those of this project: to be called after a network was read
   * on the side (a station looked at before a train is set down there), which moves the counter
   * to the ids of that other network.
   */
  restoreIdCounter = (): void => {
    syncIdCounter(this.network)
    this.keepTrainIdsClear()
  }

  /**
   * Leave the train of this screen to its automatic pilot and look elsewhere. Only a train the
   * pilot holds can be left: nobody would drive it otherwise. Returns false when it was not.
   */
  leaveTrain = (): boolean => {
    const train = this.selectedTrain
    if (!this.isPlayMode || !train || !this.autopilots.has(train.id)) return false
    this.releaseTrainSelection()
    this.followLocomotiveCamera = false
    this.notify()
    return true
  }

  setDrivingAid = (aid: DrivingAid): void => {
    if (this.drivingAid === aid) return
    this.drivingAid = aid
    saveDrivingAid(aid)
    // At once, not at the next second: the points ahead of every train on its way
    for (const train of this.trains) if (train.itinerary) refreshRouteGuide(this, train)
    this.notify()
  }

  /** Points were set for a train by the driving aid: the panels and the canvas are told */
  pointsThrownByAid = (): void => {
    this.markDirty()
    this.notify()
  }

  /** The itinerary of a train was changed: its way is found again, the project saved, the panels told */
  itineraryChanged = (train: TrainSet): void => {
    this.routeGuides.delete(train.id)
    refreshRouteGuide(this, train)
    this.dirty = true
    this.savePersistedState()
    this.notify()
  }

  /** Once a second while driving: where each train is on the way to its next station */
  private checkItineraries(dt: number): void {
    this.routeGuideElapsed += dt
    if (this.routeGuideElapsed < ROUTE_GUIDE_PERIOD_S) return
    this.routeGuideElapsed = 0
    let called = false
    for (const train of this.trains) if (train.itinerary && refreshRouteGuide(this, train)) called = true
    for (const id of [...this.routeGuides.keys()]) if (!this.trains.some((t) => t.id === id)) this.routeGuides.delete(id)
    if (called) {
      this.dirty = true
      this.savePersistedState()
    }
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
    const env: DrivingEnvironment = { levelHeight: this.gradientLimits.levelHeight, line: this.lineSettings }
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
    if (this.isNetworkLocked) return false
    if (cant !== null && !Number.isFinite(cant)) return false
    // Whole millimetres within CANT_RANGE; only a curved rail carries a cant
    const target = cant === null ? undefined : Math.max(CANT_RANGE.min, Math.min(CANT_RANGE.max, Math.round(cant)))
    let changed = false
    for (const sid of this.selection.segments) {
      const seg = this.network.segments.get(sid)
      if (!seg || seg.kind !== 'curve' || !seg.via || seg.cant === target) continue
      if (target === undefined) delete seg.cant
      else seg.cant = target
      touchNetwork(this.network, seg.id)
      changed = true
    }
    if (changed) this.markDirty()
    return changed
  }

  /** Put the driven train back on the track after a derailment. Returns false when it is not derailed. */
  rerailSelectedTrain = (): boolean => {
    const train = this.hostTrain
    return !!train && this.rerail(train)
  }

  /** Put a train back on the track after a derailment. Returns false when it is not derailed. */
  rerail = (train: TrainSet): boolean => {
    if (!rerailTrain(train)) return false
    this.notify()
    return true
  }

  /** Forces, pressures and stopping distance of the selected train, as the physics sees them now */
  get selectedTrainDynamics(): TrainDynamics | null {
    const train = this.selectedTrain
    return train ? this.dynamicsOf(train) : null
  }

  /** Forces, pressures and stopping distance of a train, as the physics sees them now */
  dynamicsOf = (train: TrainSet): TrainDynamics => {
    // The simulation step has just worked them out for this very state of a driven train: the
    // stopping distance alone is a whole braking run integrated, not to be done twice per frame
    return this.drivenDynamics?.get(train) ?? trainDynamics(this.network, train, this.drivingEnvironment)
  }

  /** Dynamics of the driven trains as of the last simulation step; dropped by any notification */
  private drivenDynamics: Map<TrainSet, TrainDynamics> | null = null

  /** Put a train's handle on a notch: MIN_NOTCH (B10) … 0 (N) … MAX_NOTCH (P10) */
  setTrainNotch = (train: TrainSet, notch: number): void => {
    if (setNotch(train, Math.max(MIN_NOTCH, Math.min(MAX_NOTCH, notch)))) this.notify()
  }

  /** Move a train's brake handle: `apply` and `release` act for as long as they are held, `hold` keeps the pressure where it is */
  setTrainBrakeCommand = (train: TrainSet, command: BrakeCommand): void => {
    if (train.brakeCommand === command) return
    setBrakeCommand(train, command)
    // The domain refuses the handle while the emergency brake is latched
    if (train.brakeCommand === command) this.notify()
  }

  /** Set a train's reverser (refused while moving or in traction) */
  setTrainReverser = (train: TrainSet, reverser: Reverser): void => {
    if (setReverser(train, reverser)) this.notify()
  }

  /** Trigger a train's emergency brake, or release it once the train has stopped */
  toggleTrainEmergencyBrake = (train: TrainSet): void => {
    if (!train.emergencyBrake) triggerEmergencyBrake(train)
    else if (!releaseEmergencyBrake(train)) return
    this.notify()
  }

  /** Put the selected train's handle on a notch: MIN_NOTCH (B10) … 0 (N) … MAX_NOTCH (P10) */
  setSelectedTrainNotch = (notch: number): void => {
    const train = this.hostTrain
    if (train) this.setTrainNotch(train, notch)
  }

  /** Move the selected train's handle by one notch; it stops at B10 and at P10 */
  stepSelectedTrainNotch = (step: 1 | -1): void => {
    const train = this.hostTrain
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
    const train = this.hostTrain
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
    const train = this.hostTrain
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
    const train = this.hostTrain
    if (train && setReverser(train, reverser)) this.notify()
  }

  /** Move the selected train's reverser one position towards forward (1) or reverse (-1) */
  shiftSelectedTrainReverser = (step: 1 | -1): void => {
    const train = this.hostTrain
    if (train && shiftReverser(train, step)) this.notify()
  }

  /** Trigger the selected train's emergency brake, or release it once the train has stopped */
  toggleSelectedTrainEmergencyBrake = (): void => {
    const train = this.hostTrain
    if (train) this.toggleTrainEmergencyBrake(train)
  }

  // ─────────────────── Platform tool ───────────────────

  /** The platform tool lays one platform on each side of the track: the toggle, turned over by Shift */
  get platformBothSidesActive(): boolean {
    return this.platformBothSides !== this.platformShiftHeld
  }

  setPlatformBothSides = (on: boolean): void => {
    this.platformBothSides = on
    this.notify()
  }

  /** Shift went down or up: the platform tool shows what it would lay then */
  setPlatformShiftHeld = (held: boolean): void => {
    if (this.platformShiftHeld === held) return
    this.platformShiftHeld = held
    if (this.tool === 'platform') this.notify()
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
  /** The station picked, if it still exists */
  get selectedStation(): Station | null {
    return this.selectedStationId ? this.network.stations.get(this.selectedStationId) ?? null : null
  }

  /** Pick a station (null: none): its panel opens. Picking one drops the track selection. */
  selectStation = (id: string | null): boolean => {
    if (id !== null && !this.network.stations.has(id)) return false
    if (id === this.selectedStationId) return true
    if (id !== null) {
      this.selection = { nodes: new Set(), segments: new Set() }
      this.selectedPlatformId = null
    }
    this.selectedStationId = id
    this.notify()
    return true
  }

  /** The station whose mark is under a world position, within `tolerance` metres */
  stationAt = (worldPos: Point, tolerance: number = 14 / this.camera.scale): Station | null => {
    return stationAt(this.network, worldPos, tolerance)
  }

  /** Remember the station under the cursor (selection tool). True when it changed. */
  updateStationHover = (worldPos: Point): boolean => {
    const hovered = this.tool === 'select' && !this.isPlayMode ? this.stationAt(worldPos)?.id ?? null : null
    if (hovered === this.hoveredStationId) return false
    this.hoveredStationId = hovered
    return true
  }

  // ─────────────────── Stations and platforms in the editor (selection tool) ───────────────────

  /** A new station named `name`, at `pos` (the centre of the view when left out). One undo step; it is selected. */
  createStation = (name: string, pos?: Point): string | null => {
    if (!this.canEditNetwork) return null
    const station = createStation(this.network, name, pos ?? { x: this.camera.x, y: this.camera.y })
    this.selection = { nodes: new Set(), segments: new Set() }
    this.selectedPlatformId = null
    this.selectedStationId = station.id
    this.markDirty()
    return station.id
  }

  /**
   * Name and SNCF code of a station; a field left out is kept, an empty code clears it, an empty
   * name is refused. One undo step. False when refused or nothing changes.
   */
  renameStation = (id: string, identity: { name?: string; code?: string }): boolean => {
    const station = this.network.stations.get(id)
    if (!this.canEditNetwork || !station) return false
    const next: { name?: string; code?: string } = {}
    if (identity.name !== undefined) {
      const name = identity.name.trim()
      if (name === '') return false
      if (name !== station.name) next.name = name
    }
    if ('code' in identity) {
      const code = identity.code?.trim().toUpperCase() || undefined
      if (code !== station.code) next.code = code
    }
    if (Object.keys(next).length === 0) return false
    setStationIdentity(this.network, id, next)
    this.markDirty()
    return true
  }

  /**
   * Delete a station with all its platforms (one undo step); the track stays, and the journeys of
   * the trains no longer call there. False when the network cannot be edited or there is no such station.
   */
  deleteStation = (id: string): boolean => {
    if (!this.canEditNetwork || deleteStation(this.network, id) === null) return false
    if (this.stationDrag?.id === id) this.stationDrag = null
    if (this.platformDrag && !this.network.platforms.has(this.platformDrag.platformId)) this.platformDrag = null
    if (this.selectedStationId === id) this.selectedStationId = null
    if (this.hoveredStationId === id) this.hoveredStationId = null
    if (this.selectedPlatformId && !this.network.platforms.has(this.selectedPlatformId)) this.selectedPlatformId = null
    if (this.hoveredPlatformId && !this.network.platforms.has(this.hoveredPlatformId)) this.hoveredPlatformId = null
    for (const train of this.trains) {
      if (!train.itinerary) continue
      const itinerary = withoutStation(train.itinerary, id)
      if (itinerary === train.itinerary) continue
      train.itinerary = itinerary
      this.routeGuides.delete(train.id)
    }
    this.markDirty()
    return true
  }

  /** Start dragging the mark (label) of a station with the selection tool. False when the network cannot be edited. */
  beginStationDrag = (id: string): boolean => {
    const station = this.network.stations.get(id)
    if (!this.canEditNetwork || this.tool !== 'select' || !station) return false
    this.stationDrag = { id, origin: { x: station.pos.x, y: station.pos.y } }
    return true
  }

  /** Move the dragged station mark to a world position. True when it moved. */
  dragStationTo = (worldPos: Point): boolean => {
    const drag = this.stationDrag
    return drag ? moveStationLabel(this.network, drag.id, worldPos) : false
  }

  /** The button comes up: the move is one undo step. True when the station ended somewhere else. */
  endStationDrag = (): boolean => {
    const drag = this.stationDrag
    if (!drag) return false
    this.stationDrag = null
    const station = this.network.stations.get(drag.id)
    const moved = !!station && (station.pos.x !== drag.origin.x || station.pos.y !== drag.origin.y)
    if (moved) this.markDirty()
    return moved
  }

  /** Sizes of a platform at the scale of the project */
  get platformDims(): PlatformDimensions {
    return platformDimensions(this.gauge)
  }

  /** The platform picked, if it still exists */
  get selectedPlatform(): Platform | null {
    return this.selectedPlatformId ? this.network.platforms.get(this.selectedPlatformId) ?? null : null
  }

  /** Pick a platform (null: none) with the selection tool: its panel opens, the track and station selections go. */
  selectPlatform = (id: string | null): boolean => {
    if (id !== null && (this.tool !== 'select' || !this.network.platforms.has(id))) return false
    if (id === this.selectedPlatformId) return true
    if (id !== null) {
      this.selection = { nodes: new Set(), segments: new Set() }
      this.selectedStationId = null
    }
    this.selectedPlatformId = id
    this.notify()
    return true
  }

  /**
   * What of a platform is under a world position, within `tolerance` metres: a stop marker of the
   * selected platform, an end (« borne ») of the selected platform then of any other, and last the
   * body of a platform. Null when there is none.
   */
  platformHitAt = (worldPos: Point, tolerance: number = 10 / this.camera.scale): PlatformHit | null => {
    const dims = this.platformDims
    const selected = this.selectedPlatform?.id
    if (selected) {
      const marker = platformMarkerAt(this.network, worldPos, dims, tolerance, selected)
      if (marker) return { kind: 'marker', ...marker }
      const end = platformEndAt(this.network, worldPos, dims, tolerance, selected)
      if (end) return { kind: 'end', ...end }
    }
    const end = platformEndAt(this.network, worldPos, dims, tolerance)
    if (end) return { kind: 'end', ...end }
    const body = platformAt(this.network, worldPos, dims, 0)
    return body ? { kind: 'body', platformId: body.id } : null
  }

  /** Remember the platform under the cursor (selection tool). True when it changed. */
  updatePlatformHover = (worldPos: Point): boolean => {
    const hovered = this.tool === 'select' && !this.isPlayMode && this.network.platforms.size > 0
      ? this.platformHitAt(worldPos)?.platformId ?? null
      : null
    if (hovered === this.hoveredPlatformId) return false
    this.hoveredPlatformId = hovered
    return true
  }

  /** Start dragging an end or a stop marker of a platform (selection tool). False when the network cannot be edited. */
  beginPlatformDrag = (hit: PlatformHit): boolean => {
    const platform = this.network.platforms.get(hit.platformId)
    if (!this.canEditNetwork || this.tool !== 'select' || !platform || hit.kind === 'body') return false
    const origin = platformShape(platform)
    this.platformDrag = hit.kind === 'end'
      ? { kind: 'end', platformId: hit.platformId, edge: hit.edge, end: hit.end, origin }
      : { kind: 'marker', platformId: hit.platformId, index: hit.index, origin }
    return true
  }

  /** Slide what is dragged of a platform to the place of its track nearest to a world position. True when it moved. */
  dragPlatformTo = (worldPos: Point): boolean => {
    const drag = this.platformDrag
    if (!drag) return false
    if (drag.kind === 'marker') return moveMarker(this.network, drag.platformId, drag.index, worldPos)
    const minLength = MIN_PLATFORM_LENGTH * (this.platformDims.width / platformDimensions().width)
    return moveEdgeEnd(this.network, drag.platformId, drag.edge, drag.end, worldPos, minLength)
  }

  /**
   * What the canvas writes beside a dragged platform: the length of the edge for an end, the
   * distance from a stop marker to the end of the platform the train runs towards. Null without a drag.
   */
  get platformDragMeasure(): { kind: 'end' | 'marker'; length: number } | null {
    const drag = this.platformDrag
    const platform = drag && this.network.platforms.get(drag.platformId)
    if (!drag || !platform) return null
    if (drag.kind === 'end') {
      const edge = platform.edges[drag.edge]
      return edge ? { kind: 'end', length: edgeLength(this.network, edge) } : null
    }
    const marker = platform.markers[drag.index]
    const edge = marker && platform.edges[marker.edge]
    if (!marker || !edge) return null
    return { kind: 'marker', length: marker.heading === 'forward' ? edgeLength(this.network, edge) - marker.at : marker.at }
  }

  /** The button comes up: the drag is one undo step. True when the platform changed. */
  endPlatformDrag = (): boolean => {
    const drag = this.platformDrag
    if (!drag) return false
    this.platformDrag = null
    const platform = this.network.platforms.get(drag.platformId)
    const changed = !!platform && JSON.stringify(platformShape(platform)) !== JSON.stringify(drag.origin)
    if (changed) this.markDirty()
    return changed
  }

  /** Drop a platform or station drag, putting back what moved. True when there was one. */
  private cancelPlatformGesture(): boolean {
    const platformDrag = this.platformDrag
    const stationDrag = this.stationDrag
    this.platformDrag = null
    this.stationDrag = null
    if (platformDrag) restorePlatformShape(this.network, platformDrag.platformId, platformDrag.origin)
    if (stationDrag) moveStationLabel(this.network, stationDrag.id, stationDrag.origin)
    return platformDrag !== null || stationDrag !== null
  }

  /** Remove a platform (one undo step). False when the network cannot be edited or there is no such platform. */
  deletePlatform = (id: string): boolean => {
    if (!this.canEditNetwork) return false
    if (this.platformDrag?.platformId === id) this.platformDrag = null
    if (!removePlatform(this.network, id)) return false
    if (this.selectedPlatformId === id) this.selectedPlatformId = null
    if (this.hoveredPlatformId === id) this.hoveredPlatformId = null
    this.markDirty()
    return true
  }

  deleteSelectedPlatform = (): boolean => {
    const platform = this.selectedPlatform
    return platform ? this.deletePlatform(platform.id) : false
  }

  /** One change of a platform through a domain helper: one undo step when it changed anything */
  private editPlatform(change: () => boolean): boolean {
    if (!this.canEditNetwork || !change()) return false
    this.markDirty()
    return true
  }

  /** Track number of an edge of a platform (empty: none). One undo step. */
  setPlatformRef = (id: string, edge: 0 | 1, ref: string): boolean =>
    this.editPlatform(() => setPlatformRef(this.network, id, edge, ref))

  /** Width of a platform beside one track, metres at 1:1. One undo step. */
  setPlatformWidth = (id: string, width: number): boolean =>
    this.editPlatform(() => setPlatformWidth(this.network, id, width))

  /** The station a platform belongs to. One undo step. */
  setPlatformStation = (id: string, stationId: string): boolean =>
    this.editPlatform(() => setPlatformStation(this.network, id, stationId))

  /** A new station, set in the middle of a platform, which then belongs to it. One undo step. Returns its id. */
  createStationForPlatform = (id: string, name: string): string | null => {
    const platform = this.network.platforms.get(id)
    if (!this.canEditNetwork || !platform) return null
    const pos = platformCentre(this.network, platform, this.platformDims) ?? { x: this.camera.x, y: this.camera.y }
    const station = createStation(this.network, name, pos)
    setPlatformStation(this.network, id, station.id)
    this.markDirty()
    return station.id
  }

  /** A stop marker added to an edge, short of the end a train running `heading` comes to. One undo step. */
  addPlatformMarker = (id: string, edge: 0 | 1, heading: StopMarker['heading']): boolean => {
    const track = this.network.platforms.get(id)?.edges[edge]
    if (!track) return false
    const length = edgeLength(this.network, track)
    const inset = Math.min(this.platformDims.markerMargin, length / 2)
    return this.editPlatform(() => addMarker(this.network, id, { edge, at: heading === 'forward' ? length - inset : inset, heading }) !== null)
  }

  /** Remove a stop marker of a platform. One undo step. */
  removePlatformMarker = (id: string, index: number): boolean =>
    this.editPlatform(() => removeMarker(this.network, id, index))

  /** Direction and longest train of a stop marker (`maxLength` undefined: every train). One undo step. */
  setPlatformMarker = (id: string, index: number, options: { heading?: StopMarker['heading']; maxLength?: number }): boolean =>
    this.editPlatform(() => setMarkerOptions(this.network, id, index, options))

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
      // On a real network the game is not left: coupling is armed in it (`armCoupling`)
      if (this.isPlayMode && !this.hasBuildMode) return
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
  handleCouplingClick = (worldPos: Point): 'done' | 'moving' | 'nothing' => {
    if (this.isPlayMode) return this.couplingArmed ? this.coupleInGame(worldPos) : 'nothing'
    const updated = handleCouplingClick(this.network, this.trains, worldPos)
    if (updated === this.trains) return 'nothing'
    this.trains = updated
    // The selected train may have been merged or split into trains with new ids
    if (!this.selectedTrain) {
      this.selectTrainById(this.trains.length > 0 ? this.trains[this.trains.length - 1].id : null)
    }
    this.repairTrainSelection()
    this.refreshCouplerPoints()
    this.commitTrainChange()
    return 'done'
  }

  /**
   * The same click while trains run: only between rakes at rest. A rake made of others takes
   * their place: the one that keeps the head of a rake keeps its pilot, its desk and this
   * screen; the rake coupled behind another gives up its own.
   */
  private coupleInGame(worldPos: Point): 'done' | 'moving' | 'nothing' {
    const before = this.trains
    const updated = handleCouplingClick(this.network, before, worldPos)
    if (updated === before) return 'nothing'
    const gone = before.filter((t) => !updated.includes(t))
    if (gone.some((t) => Math.abs(t.currentSpeed) > AT_REST_SPEED)) return 'moving'
    const made = updated.filter((t) => !before.includes(t))
    const watched = this.selectedTrainVehicleId
    const wasSelected = gone.some((t) => t.id === this.selectedTrainId)
    for (const old of gone) {
      const heir = made.find((t) => t.vehicles[0].id === old.vehicles[0].id)
      const pilot = this.autopilots.get(old.id)
      const desk = this.trainDrivers.get(old.id)
      this.autopilots.delete(old.id)
      this.trainDrivers.delete(old.id)
      this.routeGuides.delete(old.id)
      if (heir && pilot) this.autopilots.set(heir.id, pilot)
      if (heir && desk !== undefined) this.trainDrivers.set(heir.id, desk)
    }
    // The part let go has no journey of its own: it stands where it was parted
    for (const t of made) if (!gone.some((old) => old.vehicles[0].id === t.vehicles[0].id)) delete t.itinerary
    this.trains = updated
    if (wasSelected) {
      const now = made.find((t) => t.vehicles.some((v) => v.id === watched)) ?? made[0]
      this.selectTrainById(now.id, now.vehicles.some((v) => v.id === watched) ? watched ?? undefined : undefined)
    }
    this.hoveredCouplerPoint = null
    this.commitTrainChange()
    return 'done'
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
    this.drivenDynamics = null
    const occupancy: TrainOccupancyCache = new Map()
    const env = this.drivingEnvironment
    // Driven: held by a desk, the train of this screen, or one the automatic pilot holds
    const isDriven = (train: TrainSet): boolean => train.id === this.selectedTrainId || this.trainDrivers.has(train.id) || this.autopilots.has(train.id)
    runAutopilots(this, dt)
    for (const train of this.trains) {
      if (!isDriven(train)) {
        // Nobody holds the brake handle of a train that is not driven
        if (train.brakeCommand !== 'hold') setBrakeCommand(train, 'hold')
        // Nor its traction handle: a train left under power coasts, it does not keep pulling by itself
        if (train.notch > 0) setNotch(train, 0)
      }
      // Stopping against an obstacle, holding at rest and rolling back are the domain's business
      tickTrainSet(this.network, train, dt, this.trains, occupancy, env)
      this.reportImpact(train)
    }
    // A desk whose train is gone (uncoupled into another, deleted) holds nothing
    for (const trainId of [...this.trainDrivers.keys()]) if (!this.trains.some((t) => t.id === trainId)) this.trainDrivers.delete(trainId)
    // A train nearing a line of the dataset that is not loaded: its file is asked for now
    this.checkDatasetLines(dt)
    // Into a tunnel or out of one: the view goes with the train of this screen
    this.followDrivenDepth()
    this.checkItineraries(dt)
    // Once every train has moved: what each one holds, what the signals show, the signals passed
    // (nothing at all on a network without signal)
    // A driven train holds the track over the stopping distance its physics works out; the
    // others over the simple estimate, on the slope they stand on
    const dynamics = new Map<TrainSet, TrainDynamics>()
    const dynamicsOfDriven = (train: TrainSet): TrainDynamics => {
      let known = dynamics.get(train)
      if (!known) dynamics.set(train, (known = trainDynamics(this.network, train, env)))
      return known
    }
    const stoppingOf = (train: TrainSet): number | null => {
      if (isDriven(train)) return dynamicsOfDriven(train).stoppingDistance
      if (!(train.currentSpeed > 0)) return null
      return estimatedStoppingDistance(train.currentSpeed, train.direction * trainSlope(this.network, train, env))
    }
    const passings = tickSignalling(this.network, this.trains, this.signalling, this.signallingSettings, stoppingOf, {
      line: env.line,
      // The limit of a driven train is already worked out: the overspeed check does not look for it again
      speedLimitOf: (train) => (isDriven(train) ? dynamicsOfDriven(train).speedLimit * 3.6 : null),
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
    // Sync camera to the lead vehicle of the followed train
    if (this.followLocomotiveCamera) this.centreCameraOnTrain(this.cameraTrain)
    // Kept for the consoles, which show the same figures: worked out now if the step did not need them
    for (const train of this.trains) if (isDriven(train)) dynamicsOfDriven(train)
    this.drivenDynamics = dynamics
    this.notifyFrame(this.trains.some((train) => train.currentSpeed !== 0))
  }
}

/** How far (m, at standard gauge) a long rail may lie from the small rails it replaces */
const LONG_RAIL_TOLERANCE = 0.3
/** A long rail is cut in the middle of the straights this long (m, at standard gauge) between two of its curves */
const LONG_RAIL_CUT_STRAIGHTS = 100
const STANDARD_TRACK_GAUGE = 1.435

/** While trains run, the panels are rendered again at most this often, ms (the phone desk is sent its state at the same pace) */
export const DRIVING_PANEL_PERIOD_MS = 100

/** The steps of the undo history taken from a reconciled track, with the tolerance it was reconciled at */
const reconciledSteps = new WeakMap<SerializedProject, number>()

/** How long the write of the project to localStorage waits after an edit, ms: the edits made meanwhile are written with it */
const AUTOSAVE_DELAY_MS = 400
/** The speeds of the simulated time the host may choose */
export const TIME_FACTORS = [1, 2, 5, 10] as const
export type TimeFactor = (typeof TIME_FACTORS)[number]
export const isTimeFactor = (v: unknown): v is TimeFactor => (TIME_FACTORS as readonly number[]).includes(v as number)
/** How close (m) a train's lead comes to a connection before the line beyond it is fetched */
export const DATASET_LOOKAHEAD_M = 5000
/** A loaded line every train is further than this (m) from is dropped; well beyond `DATASET_LOOKAHEAD_M` */
export const DATASET_KEEP_M = 20_000
/** How often (s) the trains are checked against the connections */
const DATASET_CHECK_PERIOD_S = 1
/** The pieces whose box comes this close (m) to the view are fetched, once the view is near enough */
export const DATASET_VIEW_MARGIN_M = 5000
/** How many pieces of the dataset stay loaded at most (about 10 000 rails): past it, the ones seen longest ago go */
export const DATASET_MAX_PIECES = 24
/** The box of a line (piece) of the index */
function lineBox(index: DatasetIndex, id: LineId): BBox {
  return index.lines.find((line) => line.id === id)?.bbox ?? { minX: Infinity, minY: Infinity, maxX: Infinity, maxY: Infinity }
}
/** How often (s) the trains are placed on the way to their next station */
const ROUTE_GUIDE_PERIOD_S = 1
/** Camera scale (px per metre) a rake set down at a station is shown at: its bogies show from 3.5 */
const RAKE_START_SCALE = 4
/** What a dataset project writes in place of its track: nothing (never changed) */
const EMPTY_NETWORK = createNetwork()

/** Nodes and rails the undo history keeps in all, over all its steps (50 steps of a network of 40 000) */
const HISTORY_BUDGET = 2_000_000

/** Hook: subscribe a React component to store version changes. */
export function useEditorVersion(store: EditorStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion)
}
