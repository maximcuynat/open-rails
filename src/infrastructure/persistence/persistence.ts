import type { Camera } from '@infrastructure/render/camera'
import { createNetwork, syncIdCounter } from '../../domain/models/network'
import { findJunctionAtNode } from '../../domain/models/junction'
import { reconcileNetworkIntersections } from '../../domain/geometry/reconcile'
import type { Junction, Network, RailNode, Segment, SegmentKind } from '../../domain/models/types'
import type { TrackSection } from '../../domain/models/sections'

export const STORAGE_KEY = 'open-rail:network'

export interface SerializedNode {
  id: string
  x: number
  y: number
  z?: number
}

export interface SerializedSegment {
  id: string
  from: string
  to: string
  kind: SegmentKind
  via?: { x: number; y: number }
  overpass?: boolean
  layer?: number
}

export interface SerializedJunction {
  id: string
  nodeId: string
  stemNodeId?: string
  straightNodeId: string
  divergingNodeId: string
  straightSegmentId: string
  divergingSegmentId: string
  activeBranch: 'straight' | 'diverging'
  hand: 'left' | 'right'
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
): SerializedProject {
  const nodes: SerializedNode[] = []
  for (const n of net.nodes.values()) {
    nodes.push({
      id: n.id,
      x: n.pos.x,
      y: n.pos.y,
      z: typeof n.z === 'number' ? n.z : typeof n.pos.z === 'number' ? n.pos.z : undefined,
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
      overpass: s.overpass || undefined,
      layer: typeof s.layer === 'number' && s.layer !== 0 ? s.layer : undefined,
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
      straightSegmentId: j.straightSegmentId,
      divergingSegmentId: j.divergingSegmentId,
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
  }
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
} {
  const net = createNetwork()
  if (!data || typeof data !== 'object') {
    return { network: net }
  }

  // 1. Restore nodes
  if (Array.isArray(data.nodes)) {
    for (const n of data.nodes) {
      if (!n || typeof n.id !== 'string') continue
      const x = typeof n.x === 'number' && !Number.isNaN(n.x) ? n.x : 0
      const y = typeof n.y === 'number' && !Number.isNaN(n.y) ? n.y : 0
      const z = typeof n.z === 'number' && !Number.isNaN(n.z) ? n.z : 0
      const node: RailNode = { id: n.id, pos: { x, y, z }, z }
      net.nodes.set(node.id, node)
      net.adjacency.set(node.id, [])
    }
  }

  // 2. Restore segments
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
        overpass: s.overpass === true ? true : undefined,
        layer: typeof s.layer === 'number' ? s.layer : undefined,
      }
      net.segments.set(seg.id, seg)
      net.adjacency.get(s.from)?.push(seg.id)
      net.adjacency.get(s.to)?.push(seg.id)
    }
  }

  // 3. Reconcile intersections and auto-detect junctions (scans degree-3 forks)
  reconcileNetworkIntersections(net)

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
        straightSegmentId: j.straightSegmentId,
        divergingSegmentId: j.divergingSegmentId,
        activeBranch: j.activeBranch === 'diverging' ? 'diverging' : 'straight',
        hand: j.hand === 'right' ? 'right' : 'left',
        frogNumber: j.frogNumber,
      }
      net.junctions.set(junction.id, junction)
    }
  }

  // 5. Update ID counter so that subsequent rails added will not have collision IDs
  syncIdCounter(net)

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
  }
}

// In-memory fallback for environments without localStorage (e.g. some test runners)
let memoryStorage: Record<string, string> = {}

function getStorage(): {
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
): boolean {
  try {
    const storage = getStorage()
    if (!storage) return false
    const serialized = serializeNetwork(net, projectName, camera, sectionMeta, gridMode, gridSpacing, computedSections)
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
