import { useSyncExternalStore } from 'react'
import { createCamera, type Camera } from '../render/camera'
import { createNetwork } from '../core/network'
import { CURVE_RADII } from '../core/profiles'
import type { Network, Point, Selection } from '../core/types'

export type Tool = 'select' | 'place' | 'curve' | 'pan'

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
  curveProfileIdx = 0 // index into CURVE_RADII
  curveSide: 1 | -1 = 1
  cursorWorld: Point = { x: 0, y: 0 }
  snappedCursor: Point = { x: 0, y: 0 }
  panning = false
  moved = false
  showMinimap = false

  // --- UI-facing state ---
  theme: ThemeMode = 'auto'
  projectName = 'Untitled Network'
  dirty = false

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
    this.version++
    this.listeners.forEach((l) => l())
  }

  setTool = (t: Tool): void => {
    this.tool = t
    if (t === 'select') this.lastNodeId = null
    if (t !== 'curve') this.curveState = { phase: 0, startId: null }
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
    this.notify()
  }

  markDirty = (): void => {
    if (!this.dirty) {
      this.dirty = true
      this.notify()
    }
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

  cycleCurveProfile = (dir: 1 | -1): void => {
    this.curveProfileIdx = Math.max(0, Math.min(CURVE_RADII.length - 1, this.curveProfileIdx + dir))
    this.notify()
  }

  flipCurveSide = (): void => {
    this.curveSide = this.curveSide === 1 ? -1 : 1
    this.notify()
  }
}

/** Hook: subscribe a React component to store version changes. */
export function useEditorVersion(store: EditorStore): number {
  return useSyncExternalStore(store.subscribe, store.getVersion)
}
