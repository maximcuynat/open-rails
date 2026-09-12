import { useSyncExternalStore } from 'react'
import { createCamera, type Camera } from '../render/camera'
import { createNetwork, resetIdCounter } from '../core/network'
import { CURVE_RADII } from '../core/profiles'
import { toggleJunction, toggleTurnoutHand, findJunctionAtNode, findJunctionBySegment, autoDetectJunctions } from '../core/junction'
import { reconcileNetworkIntersections } from '../core/reconcile'
import {
  saveNetworkToStorage,
  loadNetworkFromStorage,
  clearNetworkStorage,
  deserializeNetwork,
} from '../core/persistence'
import type { JunctionId, Network, Point, Selection } from '../core/types'

export type Tool = 'select' | 'place' | 'curve' | 'pan'

export type TrackMode = 'catalog' | 'freeform'

export type ThemeMode = 'light' | 'dark' | 'auto'

export interface CurveState {
  phase: 0 | 1
  startId: string | null
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
  camera: Camera = createCamera(0, 0, 3)
  selection: Selection = { nodes: new Set(), segments: new Set() }
  tool: Tool = 'place'
  snap = true
  showGrid = true
  lastNodeId: string | null = null
  curveState: CurveState = { phase: 0, startId: null }
  curveProfileIdx = 5 // index into CURVE_RADII (defaults to 730mm)
  curveSide: 1 | -1 = 1
  autoCurveSide = true
  cursorWorld: Point = { x: 0, y: 0 }
  snappedCursor: Point = { x: 0, y: 0 }
  hoverNodeId: string | null = null
  panning = false
  moved = false
  showMinimap = false

  // Track selection and mode
  trackMode: TrackMode = 'catalog'
  selectedStraightLength: number | 'auto' = 'auto'
  selectedCurveRadius = 730
  selectedCurveAngle = 22.5

  // Turnout configuration
  selectedFrog: 4 | 6 = 6
  selectedTurnoutHand: 'left' | 'right' = 'left'

  // Crossing / Intersection configuration
  selectedCrossingAngle = 15 // degrees (15, 30, 45, 60, 90)
  selectedCrossingLength = 124 // mm (standard Kato/Peco crossing length)

  // Dragging nodes (Select tool)
  isDraggingNode = false
  dragStartWorld: Point | null = null
  draggedNodeInitialPositions = new Map<string, Point>()

  // Box selection (Select tool)
  boxSelectStart: Point | null = null
  boxSelectEnd: Point | null = null
  isBoxSelecting = false

  // --- UI-facing state ---
  theme: ThemeMode = 'auto'
  projectName = 'Untitled Network'
  dirty = false

  constructor() {
    this.loadPersistedState()
  }

  /**
   * Load persisted layout from localStorage if present.
   */
  loadPersistedState = (): boolean => {
    const saved = loadNetworkFromStorage()
    if (!saved) return false
    this.network = saved.network
    if (saved.projectName) {
      this.projectName = saved.projectName
    }
    if (saved.camera) {
      this.camera = createCamera(saved.camera.x, saved.camera.y, saved.camera.scale)
    }
    return true
  }

  /**
   * Load network from serialized data structure.
   */
  loadFromData = (data: any): void => {
    const res = deserializeNetwork(data)
    this.network = res.network
    if (res.projectName) this.projectName = res.projectName
    if (res.camera) this.camera = createCamera(res.camera.x, res.camera.y, res.camera.scale)
    this.selection = { nodes: new Set(), segments: new Set() }
    this.lastNodeId = null
    this.curveState = { phase: 0, startId: null }
    this.markDirty()
    this.notify()
  }

  /**
   * Immediately save layout state to localStorage.
   */
  savePersistedState = (): void => {
    saveNetworkToStorage(this.network, this.projectName, this.camera)
  }

  /**
   * Reset the project to a fresh empty layout and clear localStorage.
   */
  newProject = (): void => {
    this.network = createNetwork()
    this.selection = { nodes: new Set(), segments: new Set() }
    this.lastNodeId = null
    this.curveState = { phase: 0, startId: null }
    this.projectName = 'Untitled Network'
    this.camera.x = 0
    this.camera.y = 0
    this.camera.scale = 3
    this.dirty = false
    clearNetworkStorage()
    resetIdCounter(0)
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
    this.version++
    this.listeners.forEach((l) => l())
  }

  setTool = (t: Tool): void => {
    this.tool = t
    if (t === 'select') {
      this.lastNodeId = null
      this.curveState = { phase: 0, startId: null }
    } else if (t === 'place') {
      this.curveState = { phase: 0, startId: null }
      // Auto-arm from selected node if exactly 1 node selected
      if (!this.lastNodeId && this.selection.nodes.size === 1) {
        const [singleId] = this.selection.nodes
        this.lastNodeId = singleId
      }
    } else if (t === 'curve') {
      if (this.selection.nodes.size === 1) {
        const [singleId] = this.selection.nodes
        this.curveState = { phase: 1, startId: singleId }
      } else if (this.lastNodeId) {
        this.curveState = { phase: 1, startId: this.lastNodeId }
      }
    }
    this.notify()
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

  toggleMinimap = (): void => {
    this.showMinimap = !this.showMinimap
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

  markDirty = (): void => {
    this.dirty = true
    this.savePersistedState()
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

  selectAll = (): void => {
    const nodes = new Set<string>()
    const segments = new Set<string>()
    for (const id of this.network.nodes.keys()) nodes.add(id)
    for (const id of this.network.segments.keys()) segments.add(id)
    this.selection = { nodes, segments }
    this.notify()
  }

  /** Reset the camera to fit all nodes, or origin if empty. */
  fitView = (viewportW: number, viewportH: number): void => {
    const nodes = [...this.network.nodes.values()]
    if (nodes.length === 0) {
      this.camera.x = 0
      this.camera.y = 0
      this.camera.scale = 3
      this.notify()
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
    const pad = 0.1
    const w = (maxX - minX) || 1
    const h = (maxY - minY) || 1
    const scale = Math.min(
      viewportW / (w * (1 + pad * 2)),
      viewportH / (h * (1 + pad * 2)),
    )
    this.camera.x = (minX + maxX) / 2
    this.camera.y = (minY + maxY) / 2
    this.camera.scale = Math.max(0.02, Math.min(64, scale))
    this.notify()
  }

  resetZoom = (): void => {
    this.camera.scale = 3
    this.notify()
  }

  /**
   * Reconcile network topology: heal disconnected branches, auto-split segments
   * at intersecting points/nodes, and auto-detect turnouts & crossings.
   */
  reconcileTopology = (tolerance = 3.5): { splitCount: number; weldedCount: number } => {
    const res = reconcileNetworkIntersections(this.network, tolerance)
    if (res.splitCount > 0 || res.weldedCount > 0) {
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
}

/** Hook: subscribe a React component to store version changes. */
export function useEditorVersion(store: EditorStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion)
}
