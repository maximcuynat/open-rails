import type { Camera } from '@infrastructure/render/camera'
import { segmentEnds } from '../../domain/geometry/segmentGeometry'
import { createNetwork, resetIdCounter, syncIdCounter, nodeLevel, MIN_LEVEL, MAX_LEVEL } from '../../domain/models/network'
import { declareTurnout, findJunctionAtNode, invalidateJunctionIndex, normalizeTurnoutRoles, stemRailFor } from '../../domain/models/junction'
import { cleanSpeedZones, restoreSpeedZone } from '../../domain/models/speedZones'
import {
  DEFAULT_SIGNALLING_SETTINGS,
  cleanSignals,
  isSignallingLevel,
  restoreSignal,
  type SignallingLevel,
  type SignallingSettings,
} from '../../domain/models/signals'
import { reconcileNetworkIntersections } from '../../domain/geometry/reconcile'
import { placementThresholds } from '../../domain/geometry/scale'
import type { Junction, JunctionKind, Network, PathPiece, RailNode, Segment, SegmentKind, SignalRole } from '../../domain/models/types'
import type { TrackSection } from '../../domain/models/sections'
import type { Unit, ScalePresetId } from '../../domain/models/units'
import type { GradientLimits } from '../../domain/services/kinematicDiagnostics'
import { deserializeTrains, serializeTrains } from '../../domain/models/train'
import type { SerializedTrain, TrainSet } from '../../domain/models/train'
import { DEFAULT_LINE_SETTINGS, LINE_SPEED_RANGE, type LineSettings, type LineType } from '../../domain/models/speedLimits'
import { CANT_RANGE } from '../../domain/models/cant'
import type { OsmSource } from '../../domain/import/osmTypes'

export const STORAGE_KEY = 'open-rail:network'

/** A height worth storing: a finite number off the ground, within MIN_LEVEL…MAX_LEVEL */
function isStoredLevel(level: unknown): level is number {
  return typeof level === 'number' && Number.isFinite(level) && level !== 0 && level >= MIN_LEVEL && level <= MAX_LEVEL
}

export interface SerializedNode {
  id: string
  x: number
  y: number
  /** Height of the track at the node, in levels (decimals allowed); only written off the ground */
  level?: number
}

export interface SerializedSegment {
  id: string
  from: string
  to: string
  kind: SegmentKind
  via?: { x: number; y: number }
  /** Path of a long rail (`kind: 'path'`): `[x, y, heading, curvature, length]` per piece */
  path?: number[][]
  /** Cant of a curved rail in mm; only written when it was set by hand */
  cant?: number
  /**
   * Legacy (saves made when the level was a property of the rail): never written, converted to
   * node heights on load.
   */
  level?: number
}

/**
 * Saved route table of a node. Files written before the table existed (project version 1) hold a
 * turnout by its parts instead (`straightSegmentId`, `activeBranch`…): both are read.
 */
export interface SerializedJunction {
  id: string
  nodeId: string
  kind?: JunctionKind
  /** Pairs of rails a train can pass between */
  passages?: [string, string][]
  /** For each position, the indices of the passages it opens */
  positions?: number[][]
  active?: number
  frogNumber?: number
  // Version 1
  stemNodeId?: string
  straightNodeId?: string
  divergingNodeId?: string
  straightSegmentId?: string
  divergingSegmentId?: string
  divergingRightNodeId?: string
  divergingRightSegmentId?: string
  activeBranch?: 'straight' | 'diverging' | 'left' | 'right'
  hand?: 'left' | 'right' | 'three_way'
}

/** Saved speed zone: its stretches in order from A to B, each from `t0` to `t1` on rail `segId` */
export interface SerializedSpeedZone {
  id: string
  /** km/h */
  speed: number
  spans: { segId: string; t0: number; t1: number }[]
}

/** Saved signal: where it stands, the direction of travel it speaks to (see `Signal.forward`) and what it is */
export interface SerializedSignal {
  id: string
  segId: string
  t: number
  forward: boolean
  role: SignalRole
  /** Options of the pro level; only written when set */
  cabMarker?: boolean
  oneWay?: boolean
}

export interface SerializedCamera {
  x: number
  y: number
  scale: number
}

/** Serialized section (canton / troncon) with type, direction and topology */
export interface SerializedSection {
  id: string
  name: string
  type: string
  direction: string
  color: string
  segmentIds: string[]
  nodeIds: string[]
  totalLength: number
  hasDeadEnd?: boolean
  /** IDs des sections directement adjacentes (partageant un noeud) */
  adjacentSectionIds: string[]
}

/** Serialized graph node (adjacency) entry */
export interface SerializedGraphEdge {
  sectionId: string
  viaNodeId: string
}

export interface SerializedProject {
  version: 1 | 2 | 3
  name?: string
  nodes: SerializedNode[]
  segments: SerializedSegment[]
  junctions?: SerializedJunction[]
  camera?: SerializedCamera
  sectionMeta?: Record<string, any>
  gridMode?: 'auto' | 'fixed'
  gridSpacing?: number
  /** Computed sections (cantons) with type, direction, length, and adjacency graph */
  sections?: SerializedSection[]
  unit?: Unit
  scalePreset?: ScalePresetId
  gauge?: number
  trackSpacing?: number
  /** Height of one track level, in world meters (absent from files saved before ramps: default of the scale) */
  levelHeight?: number
  /** Steepest slope allowed, in ‰ (absent from files saved before ramps: default of the scale) */
  maxGradient?: number
  /** Levels without relief: they only stack the tracks, every slope is zero. Only written when on */
  flatLevels?: boolean
  /** Where the network was imported from (OpenStreetMap); absent from a project drawn by hand */
  osmSource?: OsmSource
  /** Ceiling speed of the line, km/h; only written when it is not the default one */
  lineSpeed?: number
  /** Conventional or high-speed line; only written when it is not the default one */
  lineType?: LineType
  showDimensions?: boolean
  boardEnabled?: boolean
  boardWidth?: number
  boardHeight?: number
  /** Trains standing on the layout (absent from files saved before trains were persisted) */
  trains?: SerializedTrain[]
  /** Speed limits laid on the track (absent when there is none) */
  speedZones?: SerializedSpeedZone[]
  /** Signals laid on the track (absent when there is none) */
  signals?: SerializedSignal[]
  /** Signalling level of the project; only written when it is not the default one */
  signallingLevel?: SignallingLevel
  /** Emergency brake on passing a closed signal; only written when it is not the default (on) */
  signalStopEnforced?: boolean
  /** Display: the blocks as coloured stripes; only written when ticked (off by default) */
  showSignalBlocks?: boolean
  /** Display: the track held for each train while driving; only written when ticked (off by default) */
  showSignalReservations?: boolean
  /** Display: cant and slopes marked on the track; only written when unticked (on by default) */
  hideInclination?: boolean
}

/**
 * The displays a project remembers: the two of the signalling, both off by default, and the marks
 * of cant and slopes, on by default
 */
export interface SignalDisplaySettings {
  blocks?: boolean
  reservations?: boolean
  /** False when the marks of cant and slopes are hidden; absent or true: shown */
  inclination?: boolean
}

/**
 * Own copy of the section settings. A saved project (and so every undo step) must not share them
 * with the editor, which changes them in place.
 */
function copySectionMeta(meta: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(meta).map(([id, value]) => [id, { ...value }]))
}

/** What an import leaves in a project beyond its track: levels without relief, and where the data comes from */
export interface ProjectOrigin {
  flatLevels?: boolean
  osmSource?: OsmSource | null
}

/**
 * Serialize a railway network into a pure JSON-friendly data structure.
 * What the network holds itself (rails, route tables, speed zones, signals) is read from `net`.
 */
export function serializeNetwork(
  net: Network,
  projectName?: string,
  camera?: Camera,
  sectionMeta?: Record<string, any>,
  gridMode?: 'auto' | 'fixed',
  gridSpacing?: number,
  computedSections?: TrackSection[],
  unit?: Unit,
  scalePreset?: ScalePresetId,
  gauge?: number,
  trackSpacing?: number,
  showDimensions?: boolean,
  boardEnabled?: boolean,
  boardWidth?: number,
  boardHeight?: number,
  trains?: TrainSet[],
  gradient?: Partial<GradientLimits>,
  line?: Partial<LineSettings>,
  signalling?: Partial<SignallingSettings>,
  signalDisplay?: SignalDisplaySettings,
  origin?: ProjectOrigin,
): SerializedProject {
  const nodes: SerializedNode[] = []
  for (const n of net.nodes.values()) {
    nodes.push({
      id: n.id,
      x: n.pos.x,
      y: n.pos.y,
      ...(nodeLevel(n) !== 0 ? { level: nodeLevel(n) } : {}),
    })
  }

  const segments: SerializedSegment[] = []
  for (const s of net.segments.values()) {
    segments.push({
      id: s.id,
      from: s.from,
      to: s.to,
      kind: s.kind,
      via: s.via ? { x: s.via.x, y: s.via.y } : undefined,
      ...(isStoredCant(s) ? { cant: s.cant } : {}),
      ...(s.kind === 'path' ? { path: storedPath(net, s) } : {}),
    })
  }

  const junctions: SerializedJunction[] = []
  for (const j of net.junctions.values()) {
    junctions.push({
      id: j.id,
      nodeId: j.nodeId,
      kind: j.kind,
      passages: j.passages.map((p): [string, string] => [p.a, p.b]),
      positions: j.positions.map((position) => [...position]),
      active: j.active,
      ...(j.frogNumber !== undefined ? { frogNumber: j.frogNumber } : {}),
    })
  }

  const speedZones: SerializedSpeedZone[] = []
  for (const zone of net.speedZones.values()) {
    speedZones.push({
      id: zone.id,
      speed: zone.speed,
      spans: zone.spans.map((span) => ({ segId: span.segId, t0: span.t0, t1: span.t1 })),
    })
  }

  const signals: SerializedSignal[] = []
  for (const signal of net.signals.values()) {
    signals.push({
      id: signal.id,
      segId: signal.segId,
      t: signal.t,
      forward: signal.forward,
      role: signal.role,
      ...(signal.cabMarker ? { cabMarker: true } : {}),
      ...(signal.oneWay ? { oneWay: true } : {}),
    })
  }

  // Construire le graphe d'adjacence entre sections : deux sections sont adjacentes
  // si elles partagent au moins un noeud frontiere (endpoint de leurs segments)
  let serializedSections: SerializedSection[] | undefined
  if (computedSections && computedSections.length > 0) {
    // Index : nodeId -> sectionIds qui le contiennent
    const nodeSectionIndex = new Map<string, string[]>()
    for (const sec of computedSections) {
      for (const nid of sec.nodeIds) {
        if (!nodeSectionIndex.has(nid)) nodeSectionIndex.set(nid, [])
        nodeSectionIndex.get(nid)!.push(sec.id)
      }
    }

    serializedSections = computedSections.map((sec) => {
      const adjacentIds = new Set<string>()
      for (const nid of sec.nodeIds) {
        const neighbors = nodeSectionIndex.get(nid) ?? []
        for (const otherId of neighbors) {
          if (otherId !== sec.id) adjacentIds.add(otherId)
        }
      }
      return {
        id: sec.id,
        name: sec.name,
        type: sec.type,
        direction: sec.direction,
        color: sec.color,
        segmentIds: sec.segmentIds,
        nodeIds: sec.nodeIds,
        totalLength: Math.round(sec.totalLength * 100) / 100,
        hasDeadEnd: sec.hasDeadEnd || undefined,
        adjacentSectionIds: [...adjacentIds],
      }
    })
  }

  return {
    // 3 as soon as a long rail is in it: a build that does not know them must not open it as straight lines
    version: segments.some((s) => s.kind === 'path') ? 3 : 2,
    name: projectName,
    nodes,
    segments,
    junctions: junctions.length > 0 ? junctions : undefined,
    camera: camera
      ? {
          x: camera.x,
          y: camera.y,
          scale: camera.scale,
        }
      : undefined,
    sectionMeta: sectionMeta && Object.keys(sectionMeta).length > 0 ? copySectionMeta(sectionMeta) : undefined,
    gridMode,
    gridSpacing,
    sections: serializedSections,
    unit,
    scalePreset,
    gauge,
    trackSpacing,
    levelHeight: gradient?.levelHeight,
    maxGradient: gradient?.maxGradient,
    // A project drawn by hand carries neither: it is written back as it was
    flatLevels: origin?.flatLevels ? true : undefined,
    osmSource: origin?.osmSource ? { ...origin.osmSource } : undefined,
    // A project on the default line carries neither: a file saved before lines existed is written back as it was
    lineSpeed: line?.lineSpeed !== DEFAULT_LINE_SETTINGS.lineSpeed ? line?.lineSpeed : undefined,
    lineType: line?.lineType !== DEFAULT_LINE_SETTINGS.lineType ? line?.lineType : undefined,
    showDimensions,
    boardEnabled,
    boardWidth,
    boardHeight,
    trains: trains && trains.length > 0 ? serializeTrains(trains) : undefined,
    speedZones: speedZones.length > 0 ? speedZones : undefined,
    // A project without signal on the default settings carries none of these: it is written back as it was
    signals: signals.length > 0 ? signals : undefined,
    signallingLevel:
      signalling?.level !== undefined && signalling.level !== DEFAULT_SIGNALLING_SETTINGS.level ? signalling.level : undefined,
    signalStopEnforced:
      signalling?.stopEnforced !== undefined && signalling.stopEnforced !== DEFAULT_SIGNALLING_SETTINGS.stopEnforced
        ? signalling.stopEnforced
        : undefined,
    // Off by default: a project that shows neither carries neither
    showSignalBlocks: signalDisplay?.blocks ? true : undefined,
    showSignalReservations: signalDisplay?.reservations ? true : undefined,
    // On by default: only a project that hides the marks says so
    hideInclination: signalDisplay?.inclination === false ? true : undefined,
  }
}

/**
 * Put a saved speed zone back as it was saved. A record without a usable id or speed is skipped;
 * `cleanSpeedZones` then drops a stretch on a rail that is not there, or out of 0…1, and cuts the
 * zone at that place.
 */
function restoreZone(net: Network, z: SerializedSpeedZone): void {
  if (!z || typeof z.id !== 'string' || !Array.isArray(z.spans)) return
  restoreSpeedZone(
    net,
    z.id,
    z.speed,
    z.spans.map((span) =>
      span && typeof span.segId === 'string' && typeof span.t0 === 'number' && typeof span.t1 === 'number'
        ? { segId: span.segId, t0: span.t0, t1: span.t1 }
        : null,
    ),
  )
}

const JUNCTION_KINDS: JunctionKind[] = ['turnout', 'three_way', 'crossing', 'double_slip', 'custom']

/** Put a saved route table back on its node. A record that does not hold together is skipped. */
function restoreJunction(net: Network, j: SerializedJunction): void {
  if (!j || typeof j.id !== 'string' || typeof j.nodeId !== 'string' || !net.nodes.has(j.nodeId)) return
  if (findJunctionAtNode(net, j.nodeId)) return

  if (Array.isArray(j.passages)) {
    const passages = j.passages
      .filter((p) => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string')
      .map(([a, b]) => ({ a, b }))
    const positions = (Array.isArray(j.positions) ? j.positions : [])
      .filter((position) => Array.isArray(position))
      .map((position) => position.filter((i) => Number.isInteger(i) && i >= 0 && i < passages.length))
    if (passages.length !== j.passages.length || positions.length === 0) return
    // A turnout is a stem and two or three branches; anything else under that name is not restored
    const kind = j.kind && JUNCTION_KINDS.includes(j.kind) ? j.kind : 'custom'
    if (kind === 'turnout' || kind === 'three_way') {
      const stem = passages[0]?.a
      const branches = new Set(passages.map((p) => p.b))
      const wellFormed =
        passages.length === (kind === 'turnout' ? 2 : 3) &&
        branches.size === passages.length &&
        passages.every((p) => p.a === stem) &&
        !branches.has(stem)
      if (!wellFormed) return
    }
    const junction: Junction = {
      id: j.id,
      nodeId: j.nodeId,
      kind,
      passages,
      positions,
      active: Number.isInteger(j.active) && j.active! >= 0 && j.active! < positions.length ? j.active! : 0,
    }
    if (typeof j.frogNumber === 'number') junction.frogNumber = j.frogNumber
    net.junctions.set(junction.id, junction)
    invalidateJunctionIndex(net)
    return
  }

  // Version 1: a turnout saved by its parts. Its roles were settled by the order of the rails at
  // the node, so they are read again from the geometry; the rail that was open stays open.
  if (typeof j.straightSegmentId !== 'string' || typeof j.divergingSegmentId !== 'string') return
  if (!net.segments.has(j.straightSegmentId) || !net.segments.has(j.divergingSegmentId)) return
  const right = j.divergingRightSegmentId && net.segments.has(j.divergingRightSegmentId) ? j.divergingRightSegmentId : undefined
  const branches = [j.straightSegmentId, j.divergingSegmentId, j.hand === 'three_way' ? right : undefined]
  const stemSegmentId = stemRailFor(net, j.nodeId, branches, j.stemNodeId)
  if (!stemSegmentId) return
  const junction = declareTurnout(net, {
    nodeId: j.nodeId,
    stemSegmentId,
    straightSegmentId: j.straightSegmentId,
    divergingSegmentId: j.divergingSegmentId,
    divergingRightSegmentId: branches[2],
    activeBranch: j.activeBranch,
    id: j.id,
  })
  normalizeTurnoutRoles(net, junction)
}

/** Newest project version this build reads */
export const PROJECT_VERSION = 3

/**
 * The path of a long rail as it is saved: one `[x, y, heading, curvature, length]` per piece, where
 * the rail lies now (it follows its nodes when they are moved).
 */
function storedPath(net: Network, seg: Segment): number[][] {
  const pieces = segmentEnds(net, seg)?.path?.pieces ?? seg.path ?? []
  return pieces.map((piece) => [piece.x, piece.y, piece.heading, piece.curvature, piece.length])
}

/** The pieces of a saved path, null when it does not hold together (the rail is then read as a straight line) */
function readPath(saved: unknown): PathPiece[] | null {
  if (!Array.isArray(saved) || saved.length === 0) return null
  const pieces: PathPiece[] = []
  for (const entry of saved) {
    if (!Array.isArray(entry) || entry.length !== 5 || !entry.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
    const [x, y, heading, curvature, length] = entry as number[]
    if (!(length > 0)) return null
    pieces.push({ x, y, heading, curvature, length })
  }
  return pieces
}

/** A cant worth storing: set by hand on a curved rail, within `CANT_RANGE` */
function isStoredCant(seg: { kind: SegmentKind; cant?: unknown }): seg is { kind: SegmentKind; cant: number } {
  return (
    seg.kind === 'curve' &&
    typeof seg.cant === 'number' &&
    Number.isFinite(seg.cant) &&
    seg.cant >= CANT_RANGE.min &&
    seg.cant <= CANT_RANGE.max
  )
}

/** A line speed read from a file: kept only when it is one the settings accept */
function storedLineSpeed(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= LINE_SPEED_RANGE.min && value <= LINE_SPEED_RANGE.max
    ? value
    : undefined
}

/** A setting read from a file: kept only when it is a usable (finite, positive) number */
function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/** The provenance read from a file: kept only when every field is usable */
function storedOsmSource(value: unknown): OsmSource | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { lat, lon, dataDate, importedAt } = value as Record<string, unknown>
  if (typeof lat !== 'number' || !Number.isFinite(lat) || typeof lon !== 'number' || !Number.isFinite(lon)) return undefined
  if (typeof dataDate !== 'string' || typeof importedAt !== 'string') return undefined
  return { lat, lon, dataDate, importedAt }
}

/**
 * Reconstruct a full in-memory Network structure from serialized data,
 * rebuilding adjacency, resolving junctions, and synchronizing ID counters.
 */
export function deserializeNetwork(data: SerializedProject): {
  network: Network
  projectName?: string
  camera?: SerializedCamera
  sectionMeta?: Record<string, any>
  gridMode?: 'auto' | 'fixed'
  gridSpacing?: number
  unit?: Unit
  scalePreset?: ScalePresetId
  gauge?: number
  trackSpacing?: number
  levelHeight?: number
  maxGradient?: number
  flatLevels?: boolean
  osmSource?: OsmSource
  lineSpeed?: number
  lineType?: LineType
  signallingLevel?: SignallingLevel
  signalStopEnforced?: boolean
  showSignalBlocks?: boolean
  showSignalReservations?: boolean
  hideInclination?: boolean
  showDimensions?: boolean
  boardEnabled?: boolean
  boardWidth?: number
  boardHeight?: number
  trains: TrainSet[]
} {
  // A file from a newer build holds things this one would read wrong (a long rail as a straight line)
  if (typeof data?.version === 'number' && data.version > PROJECT_VERSION) {
    throw new Error(`Project version ${data.version} is newer than this build reads (${PROJECT_VERSION})`)
  }
  const net = createNetwork()
  if (!data || typeof data !== 'object') {
    return { network: net, trains: [] }
  }

  // 1. Restore nodes
  if (Array.isArray(data.nodes)) {
    for (const n of data.nodes) {
      if (!n || typeof n.id !== 'string') continue
      const x = typeof n.x === 'number' && !Number.isNaN(n.x) ? n.x : 0
      const y = typeof n.y === 'number' && !Number.isNaN(n.y) ? n.y : 0
      const node: RailNode = { id: n.id, pos: { x, y } }
      if (isStoredLevel(n.level)) node.level = n.level
      net.nodes.set(node.id, node)
      net.adjacency.set(node.id, [])
    }
  }

  // 2. Restore segments
  // Legacy saves carry the level on the rails: each node takes, among the levels of its rails, the
  // one furthest from the ground (the upper one on a tie)
  const legacyLevels = new Map<string, number>()
  if (Array.isArray(data.segments)) {
    for (const s of data.segments) {
      if (!s || typeof s.id !== 'string' || !s.from || !s.to) continue
      // Segments must link existing nodes
      if (!net.nodes.has(s.from) || !net.nodes.has(s.to)) continue

      const path = s.kind === 'path' ? readPath(s.path) : null
      const kind: SegmentKind = path ? 'path' : s.kind === 'curve' ? 'curve' : 'straight'
      const seg: Segment = {
        id: s.id,
        from: s.from,
        to: s.to,
        kind,
        ...(path ? { path } : {}),
        via:
          kind === 'curve' &&
          s.via &&
          typeof s.via.x === 'number' &&
          typeof s.via.y === 'number' &&
          !Number.isNaN(s.via.x) &&
          !Number.isNaN(s.via.y)
            ? { x: s.via.x, y: s.via.y }
            : undefined,
      }
      // Before the reconcile pass, which hands the cant down to the pieces of a rail it cuts
      if (isStoredCant({ kind, cant: s.cant }) && seg.via) seg.cant = s.cant
      if (isStoredLevel(s.level)) {
        for (const nodeId of [seg.from, seg.to]) {
          const known = legacyLevels.get(nodeId) ?? 0
          const further = Math.abs(s.level) > Math.abs(known) || (Math.abs(s.level) === Math.abs(known) && s.level > known)
          if (further) legacyLevels.set(nodeId, s.level)
        }
      }
      net.segments.set(seg.id, seg)
      net.adjacency.get(s.from)?.push(seg.id)
      net.adjacency.get(s.to)?.push(seg.id)
    }
  }

  // Heights are settled before the reconcile pass below, which must not join a bridge to the track
  // under it. A node that states its own height keeps it.
  for (const [nodeId, level] of legacyLevels) {
    const node = net.nodes.get(nodeId)
    if (node && node.level === undefined) node.level = level
  }

  // 3. Restore the route tables as they were saved: roles and positions are not re-derived
  if (Array.isArray(data.junctions)) {
    for (const j of data.junctions) restoreJunction(net, j)
  }

  // Speed zones name rails, like the tables: they are put back on the rails as saved, before the
  // reconcile pass, which then carries them onto whatever rail it cuts or merges (`replaceRail`).
  // Read after it, a zone on a rail the pass cuts again would have lost its rail.
  if (Array.isArray(data.speedZones)) {
    for (const z of data.speedZones) restoreZone(net, z)
  }

  // Signals too name rails: put back before the reconcile pass, which keeps each one at its place
  // on whatever rail it cuts or merges. A record that does not hold together is skipped.
  if (Array.isArray(data.signals)) {
    for (const signal of data.signals) restoreSignal(net, signal)
  }

  // 4. Ids generated from here on (by the reconcile pass below) must not reuse the ones just read
  syncIdCounter(net)

  // Only now that every id of the file is known: a zone cut in two where a stretch is unusable takes a new id
  cleanSpeedZones(net)
  // A signal on a rail that is not in the file, or out of 0…1, is dropped
  cleanSignals(net)

  // 5. Reconcile intersections; it ends by bringing the tables in line with the track
  reconcileNetworkIntersections(
    net,
    placementThresholds(typeof data.gauge === 'number' ? data.gauge : undefined).reconcileTolerance,
  )

  cleanSpeedZones(net)
  cleanSignals(net)
  syncIdCounter(net)

  // 6. Restore trains (stopped, controls at rest) and keep their ids clear of future generateId calls
  const trains = deserializeTrains(net, data.trains)
  if (trains.length > 0) {
    const ids = [...net.nodes.keys(), ...net.segments.keys(), ...net.junctions.keys(), ...net.speedZones.keys(), ...net.signals.keys()]
    for (const train of trains) ids.push(train.id, ...train.vehicles.map((v) => v.id))
    resetIdCounter(Math.max(0, ...ids.map((id) => Number(id.match(/_(\d+)$/)?.[1] ?? 0))))
  }

  let camera: SerializedCamera | undefined
  if (data.camera && typeof data.camera === 'object') {
    const cx = typeof data.camera.x === 'number' && !Number.isNaN(data.camera.x) ? data.camera.x : 0
    const cy = typeof data.camera.y === 'number' && !Number.isNaN(data.camera.y) ? data.camera.y : 0
    const cs =
      typeof data.camera.scale === 'number' && !Number.isNaN(data.camera.scale) && data.camera.scale > 0
        ? data.camera.scale
        : 3
    camera = { x: cx, y: cy, scale: cs }
  }

  return {
    network: net,
    projectName: typeof data.name === 'string' ? data.name : undefined,
    camera,
    sectionMeta: data.sectionMeta && typeof data.sectionMeta === 'object' ? copySectionMeta(data.sectionMeta) : undefined,
    gridMode: data.gridMode === 'auto' || data.gridMode === 'fixed' ? data.gridMode : undefined,
    gridSpacing: typeof data.gridSpacing === 'number' && data.gridSpacing > 0 ? data.gridSpacing : undefined,
    unit: data.unit,
    scalePreset: data.scalePreset,
    gauge: typeof data.gauge === 'number' ? data.gauge : undefined,
    trackSpacing: typeof data.trackSpacing === 'number' ? data.trackSpacing : undefined,
    levelHeight: positiveNumber(data.levelHeight),
    maxGradient: positiveNumber(data.maxGradient),
    flatLevels: data.flatLevels === true ? true : undefined,
    osmSource: storedOsmSource(data.osmSource),
    lineSpeed: storedLineSpeed(data.lineSpeed),
    lineType: data.lineType === 'classic' || data.lineType === 'highSpeed' ? data.lineType : undefined,
    signallingLevel: isSignallingLevel(data.signallingLevel) ? data.signallingLevel : undefined,
    signalStopEnforced: typeof data.signalStopEnforced === 'boolean' ? data.signalStopEnforced : undefined,
    showSignalBlocks: data.showSignalBlocks === true ? true : undefined,
    showSignalReservations: data.showSignalReservations === true ? true : undefined,
    hideInclination: data.hideInclination === true ? true : undefined,
    showDimensions: typeof data.showDimensions === 'boolean' ? data.showDimensions : undefined,
    boardEnabled: typeof data.boardEnabled === 'boolean' ? data.boardEnabled : undefined,
    boardWidth: typeof data.boardWidth === 'number' ? data.boardWidth : undefined,
    boardHeight: typeof data.boardHeight === 'number' ? data.boardHeight : undefined,
    trains,
  }
}

// In-memory fallback for environments without localStorage (e.g. some test runners)
let memoryStorage: Record<string, string> = {}

export function getStorage(): {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear?: () => void
} | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
    if (typeof localStorage !== 'undefined') {
      return localStorage
    }
  } catch {
    // Access denied to localStorage (e.g. cross-origin iframe or private browsing)
  }
  return {
    getItem: (key: string) => (key in memoryStorage ? memoryStorage[key] : null),
    setItem: (key: string, value: string) => {
      memoryStorage[key] = value
    },
    removeItem: (key: string) => {
      delete memoryStorage[key]
    },
    clear: () => {
      memoryStorage = {}
    },
  }
}

/** Reset in-memory storage fallback (useful in tests). */
export function resetMemoryStorage(): void {
  memoryStorage = {}
}

/**
 * Save current network state to localStorage (or memory fallback).
 */
export function saveNetworkToStorage(
  net: Network,
  projectName?: string,
  camera?: Camera,
  sectionMeta?: Record<string, any>,
  gridMode?: 'auto' | 'fixed',
  gridSpacing?: number,
  computedSections?: TrackSection[],
  unit?: Unit,
  scalePreset?: ScalePresetId,
  gauge?: number,
  trackSpacing?: number,
  showDimensions?: boolean,
  boardEnabled?: boolean,
  boardWidth?: number,
  boardHeight?: number,
  trains?: TrainSet[],
  gradient?: Partial<GradientLimits>,
  line?: Partial<LineSettings>,
  signalling?: Partial<SignallingSettings>,
  signalDisplay?: SignalDisplaySettings,
  origin?: ProjectOrigin,
): boolean {
  try {
    const storage = getStorage()
    if (!storage) return false
    const serialized = serializeNetwork(
      net,
      projectName,
      camera,
      sectionMeta,
      gridMode,
      gridSpacing,
      computedSections,
      unit,
      scalePreset,
      gauge,
      trackSpacing,
      showDimensions,
      boardEnabled,
      boardWidth,
      boardHeight,
      trains,
      gradient,
      line,
      signalling,
      signalDisplay,
      origin,
    )
    storage.setItem(STORAGE_KEY, JSON.stringify(serialized))
    return true
  } catch (err) {
    console.warn('Failed to save network to storage', err)
    return false
  }
}

/**
 * Load persisted network state from localStorage (or memory fallback).
 */
export function loadNetworkFromStorage(): {
  network: Network
  projectName?: string
  camera?: SerializedCamera
  sectionMeta?: Record<string, any>
  gridMode?: 'auto' | 'fixed'
  gridSpacing?: number
  unit?: Unit
  scalePreset?: ScalePresetId
  gauge?: number
  trackSpacing?: number
  levelHeight?: number
  maxGradient?: number
  flatLevels?: boolean
  osmSource?: OsmSource
  lineSpeed?: number
  lineType?: LineType
  signallingLevel?: SignallingLevel
  signalStopEnforced?: boolean
  showSignalBlocks?: boolean
  showSignalReservations?: boolean
  hideInclination?: boolean
  showDimensions?: boolean
  boardEnabled?: boolean
  boardWidth?: number
  boardHeight?: number
  trains: TrainSet[]
} | null {
  try {
    const storage = getStorage()
    if (!storage) return null
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SerializedProject
    if (!parsed || typeof parsed !== 'object') return null
    return deserializeNetwork(parsed)
  } catch (err) {
    console.warn('Failed to load network from storage', err)
    return null
  }
}

/**
 * Clear the persisted network state in localStorage (used for "New project").
 */
export function clearNetworkStorage(): void {
  try {
    const storage = getStorage()
    if (storage) {
      storage.removeItem(STORAGE_KEY)
    }
  } catch (err) {
    console.warn('Failed to clear network from storage', err)
  }
}
