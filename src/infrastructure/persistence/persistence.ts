import type { Camera } from '@infrastructure/render/camera'
import { createNetwork, resetIdCounter, syncIdCounter, nodeLevel, MIN_LEVEL, MAX_LEVEL } from '../../domain/models/network'
import { findJunctionAtNode } from '../../domain/models/junction'
import { reconcileNetworkIntersections } from '../../domain/geometry/reconcile'
import { placementThresholds } from '../../domain/geometry/scale'
import type { Junction, Network, RailNode, Segment, SegmentKind } from '../../domain/models/types'
import type { TrackSection } from '../../domain/models/sections'
import type { Unit, ScalePresetId } from '../../domain/models/units'
import type { GradientLimits } from '../../domain/services/kinematicDiagnostics'
import { deserializeTrains, serializeTrains } from '../../domain/models/train'
import type { SerializedTrain, TrainSet } from '../../domain/models/train'

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
  /**
   * Legacy (saves made when the level was a property of the rail): never written, converted to
   * node heights on load.
   */
  level?: number
}

export interface SerializedJunction {
  id: string
  nodeId: string
  stemNodeId?: string
  straightNodeId: string
  divergingNodeId: string
  straightSegmentId: string
  divergingSegmentId: string
  divergingRightNodeId?: string
  divergingRightSegmentId?: string
  activeBranch: 'straight' | 'diverging' | 'left' | 'right'
  hand: 'left' | 'right' | 'three_way'
  frogNumber?: number
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
  version: 1
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
  showDimensions?: boolean
  boardEnabled?: boolean
  boardWidth?: number
  boardHeight?: number
  /** Trains standing on the layout (absent from files saved before trains were persisted) */
  trains?: SerializedTrain[]
}

/**
 * Serialize a railway network into a pure JSON-friendly data structure.
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
    })
  }

  const junctions: SerializedJunction[] = []
  for (const j of net.junctions.values()) {
    junctions.push({
      id: j.id,
      nodeId: j.nodeId,
      stemNodeId: j.stemNodeId,
      straightNodeId: j.straightNodeId,
      divergingNodeId: j.divergingNodeId,
      divergingRightNodeId: j.divergingRightNodeId,
      straightSegmentId: j.straightSegmentId,
      divergingSegmentId: j.divergingSegmentId,
      divergingRightSegmentId: j.divergingRightSegmentId,
      activeBranch: j.activeBranch,
      hand: j.hand,
      frogNumber: j.frogNumber,
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
    version: 1,
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
    sectionMeta: sectionMeta && Object.keys(sectionMeta).length > 0 ? sectionMeta : undefined,
    gridMode,
    gridSpacing,
    sections: serializedSections,
    unit,
    scalePreset,
    gauge,
    trackSpacing,
    levelHeight: gradient?.levelHeight,
    maxGradient: gradient?.maxGradient,
    showDimensions,
    boardEnabled,
    boardWidth,
    boardHeight,
    trains: trains && trains.length > 0 ? serializeTrains(trains) : undefined,
  }
}

/** A setting read from a file: kept only when it is a usable (finite, positive) number */
function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
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
  showDimensions?: boolean
  boardEnabled?: boolean
  boardWidth?: number
  boardHeight?: number
  trains: TrainSet[]
} {
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

      const kind: SegmentKind = s.kind === 'curve' ? 'curve' : 'straight'
      const seg: Segment = {
        id: s.id,
        from: s.from,
        to: s.to,
        kind,
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

  // 3. Reconcile intersections and auto-detect junctions (scans degree-3 forks)
  reconcileNetworkIntersections(
    net,
    placementThresholds(typeof data.gauge === 'number' ? data.gauge : undefined).reconcileTolerance,
  )

  // 4. Restore/overlay persisted junctions (preserves activeBranch toggle state and explicitly placed turnouts)
  if (Array.isArray(data.junctions)) {
    for (const j of data.junctions) {
      if (!j || typeof j.id !== 'string' || !j.nodeId) continue
      if (!net.nodes.has(j.nodeId)) continue
      if (!net.segments.has(j.straightSegmentId) || !net.segments.has(j.divergingSegmentId)) continue
      const existing = findJunctionAtNode(net, j.nodeId)
      const junctionId = existing ? existing.id : j.id
      const junction: Junction = {
        id: junctionId,
        nodeId: j.nodeId,
        stemNodeId: j.stemNodeId,
        straightNodeId: j.straightNodeId,
        divergingNodeId: j.divergingNodeId,
        divergingRightNodeId: j.divergingRightNodeId,
        straightSegmentId: j.straightSegmentId,
        divergingSegmentId: j.divergingSegmentId,
        divergingRightSegmentId: j.divergingRightSegmentId,
        activeBranch: j.activeBranch ?? 'straight',
        hand: j.hand ?? 'left',
        frogNumber: j.frogNumber,
      }
      net.junctions.set(junction.id, junction)
    }
  }

  // 5. Update ID counter so that subsequent rails added will not have collision IDs
  syncIdCounter(net)

  // 6. Restore trains (stopped, controls at rest) and keep their ids clear of future generateId calls
  const trains = deserializeTrains(net, data.trains)
  if (trains.length > 0) {
    const ids = [...net.nodes.keys(), ...net.segments.keys(), ...net.junctions.keys()]
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
    sectionMeta: data.sectionMeta && typeof data.sectionMeta === 'object' ? data.sectionMeta : undefined,
    gridMode: data.gridMode === 'auto' || data.gridMode === 'fixed' ? data.gridMode : undefined,
    gridSpacing: typeof data.gridSpacing === 'number' && data.gridSpacing > 0 ? data.gridSpacing : undefined,
    unit: data.unit,
    scalePreset: data.scalePreset,
    gauge: typeof data.gauge === 'number' ? data.gauge : undefined,
    trackSpacing: typeof data.trackSpacing === 'number' ? data.trackSpacing : undefined,
    levelHeight: positiveNumber(data.levelHeight),
    maxGradient: positiveNumber(data.maxGradient),
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
