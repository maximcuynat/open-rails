import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PROJECT_NAME, EditorStore } from './editorStore'
import { addCurveSegment, addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { splitSegment } from '@domain/models/junction'
import { loadNetworkFromStorage, resetMemoryStorage } from '@infrastructure/persistence/persistence'

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
})

/** A store holding one committed straight rail from (0,0) to (100,0). */
function storeWithRail() {
  const store = new EditorStore()
  const a = addNode(store.network, { x: 0, y: 0 })
  const b = addNode(store.network, { x: 100, y: 0 })
  const seg = addSegment(store.network, a.id, b.id)!
  store.markDirty()
  return { store, a, b, seg }
}

/** What the place tool does on its first click in open space. */
function firstClick(store: EditorStore, x: number, y: number) {
  const node = addNode(store.network, { x, y })
  store.lastNodeId = node.id
  store.selection = { nodes: new Set([node.id]), segments: new Set() }
  store.notePendingEdit(false)
  return node
}

/** What the place tool does when the second click commits a rail in open space (chained). */
function commitClick(store: EditorStore, x: number, y: number) {
  const end = addNode(store.network, { x, y })
  addSegment(store.network, store.lastNodeId!, end.id)
  store.reconcileNetwork()
  store.markDirty()
  store.lastNodeId = end.id
  store.selection = { nodes: new Set([end.id]), segments: new Set() }
  return end
}

describe('project name', () => {
  it('is French by default and after "new project"', () => {
    const store = new EditorStore()
    expect(DEFAULT_PROJECT_NAME).toBe('Réseau sans titre')
    expect(store.projectName).toBe(DEFAULT_PROJECT_NAME)
    store.setProjectName('Gare de Lyon')
    store.newProject()
    expect(store.projectName).toBe(DEFAULT_PROJECT_NAME)
  })
})

describe('JSON export', () => {
  it('carries every setting the autosave does', () => {
    const { store } = storeWithRail()
    store.setScalePreset('HO', false)
    store.setBoardDimensions(3, 1.5)
    store.toggleDimensions()
    store.setGridSpacing(0.25)

    const exported = store.exportProject()
    expect(exported).toMatchObject({
      unit: 'mm',
      scalePreset: 'HO',
      gauge: 0.0165,
      trackSpacing: 0.05,
      showDimensions: false,
      boardEnabled: true,
      boardWidth: 3,
      boardHeight: 1.5,
      gridMode: 'fixed',
      gridSpacing: 0.25,
    })
    expect(exported.camera).toBeDefined()
    expect(exported.sections?.length).toBe(1)

    // Same content as what the autosave wrote
    store.savePersistedState()
    const saved = loadNetworkFromStorage()!
    for (const key of ['unit', 'scalePreset', 'gauge', 'trackSpacing', 'showDimensions', 'boardEnabled', 'boardWidth', 'boardHeight'] as const) {
      expect(saved[key]).toEqual(exported[key])
    }
  })

  it('round-trips through import into a fresh store', () => {
    const { store } = storeWithRail()
    store.setProjectName('Dépôt HO')
    store.setScalePreset('HO', false)
    store.setBoardDimensions(3, 1.5)
    store.toggleDimensions()
    const json = JSON.stringify(store.exportProject())

    resetMemoryStorage()
    const fresh = new EditorStore()
    expect(fresh.unit).toBe('m')
    fresh.loadFromData(JSON.parse(json))

    expect(fresh.projectName).toBe('Dépôt HO')
    expect(fresh.unit).toBe('mm')
    expect(fresh.scalePreset).toBe('HO')
    expect(fresh.gauge).toBe(0.0165)
    expect(fresh.trackSpacing).toBe(0.05)
    expect(fresh.parallelOffset).toBe(0.05)
    expect(fresh.showDimensions).toBe(false)
    expect(fresh.boardEnabled).toBe(true)
    expect(fresh.boardWidth).toBe(3)
    expect(fresh.boardHeight).toBe(1.5)
    expect(fresh.network.nodes.size).toBe(2)
    expect(fresh.network.segments.size).toBe(1)
  })
})

describe('undo granularity', () => {
  it('deleting a selection is one undo step', () => {
    const { store, seg } = storeWithRail()
    store.selection = { nodes: new Set(), segments: new Set([seg.id]) }
    store.deleteSelection()
    expect(store.network.segments.size).toBe(0)

    store.undo()
    expect(store.network.segments.size).toBe(1)
    expect(store.network.nodes.size).toBe(2)
  })

  it('placing a rail (two clicks) is one undo step', () => {
    const store = new EditorStore()
    firstClick(store, 0, 0)
    commitClick(store, 50, 0)
    expect(store.network.segments.size).toBe(1)

    store.undo()
    expect(store.network.segments.size).toBe(0)
    expect(store.network.nodes.size).toBe(0)
    expect(store.canUndo).toBe(false)

    store.redo()
    expect(store.network.segments.size).toBe(1)
  })

  it('a chain of rails undoes one rail at a time', () => {
    const store = new EditorStore()
    firstClick(store, 0, 0)
    commitClick(store, 50, 0)
    commitClick(store, 100, 0)
    expect(store.network.segments.size).toBe(2)

    store.undo()
    expect(store.network.segments.size).toBe(1)
    store.undo()
    expect(store.network.segments.size).toBe(0)
  })

  it('undo during a pending first click only drops that click', () => {
    const { store } = storeWithRail()
    firstClick(store, 0, 50)
    expect(store.network.nodes.size).toBe(3)

    store.undo()
    expect(store.network.nodes.size).toBe(2)
    expect(store.network.segments.size).toBe(1)
    expect(store.lastNodeId).toBeNull()
    // The rail itself is still one undo away
    store.undo()
    expect(store.network.segments.size).toBe(0)
  })

  it('cancelling a pose that started by cutting a rail leaves exactly one step for the cut', () => {
    const { store, seg } = storeWithRail()
    store.setTool('turnout')
    const split = splitSegment(store.network, seg.id, { x: 40, y: 0 })!
    store.turnoutStartId = split.midNode.id
    store.notePendingEdit(true)
    expect(store.network.segments.size).toBe(2)

    store.cancelInteraction()
    expect(store.turnoutStartId).toBeNull()
    expect(store.network.segments.size).toBe(2)

    store.undo()
    expect(store.network.segments.size).toBe(1)
  })

  it('cancelling a lone start node adds no undo step', () => {
    const { store } = storeWithRail()
    store.setTool('place')
    firstClick(store, 0, 50)
    store.cancelInteraction()
    expect(store.network.nodes.size).toBe(2)

    // The first undo removes the rail: there is no empty step in between
    store.undo()
    expect(store.network.segments.size).toBe(0)
  })
})

describe('undo / redo reset pending tool state', () => {
  it('clears turnout, double-track, measure and typing state', () => {
    const { store, a } = storeWithRail()
    const c = addNode(store.network, { x: 200, y: 0 })
    addSegment(store.network, a.id, c.id)
    store.markDirty()

    store.setTool('turnout')
    store.turnoutStartId = a.id
    store.parallelMode = true
    store.parallelLastNodeId = c.id
    store.measureStart = { x: 1, y: 1 }
    store.isMeasuring = true
    store.setNumericInput('12')

    store.undo()
    expect(store.turnoutStartId).toBeNull()
    expect(store.parallelMode).toBe(false)
    expect(store.parallelLastNodeId).toBeNull()
    expect(store.measureStart).toBeNull()
    expect(store.isMeasuring).toBe(false)
    expect(store.isNumericInputActive).toBe(false)
    expect(store.hasPendingPlacement).toBe(false)

    store.turnoutStartId = a.id
    store.redo()
    expect(store.turnoutStartId).toBeNull()
  })
})

describe('parallel track from a rail selection', () => {
  it('doubles a selected straight rail (section selection: rail + its nodes) in one undo step', () => {
    const { store, a, b, seg } = storeWithRail()
    store.selection = { nodes: new Set([a.id, b.id]), segments: new Set([seg.id]) }
    expect(store.canCreateParallelTrack).toBe(true)

    expect(store.createParallelTrackFromSelection()).toBe(true)
    expect(store.network.segments.size).toBe(2)
    const created = [...store.selection.segments].map((id) => store.network.segments.get(id)!)
    expect(created).toHaveLength(1)
    const from = store.network.nodes.get(created[0].from)!.pos
    const to = store.network.nodes.get(created[0].to)!.pos
    expect(Math.abs(from.y)).toBeCloseTo(store.parallelOffset)
    expect(to.y).toBeCloseTo(from.y)
    expect(to.x - from.x).toBeCloseTo(100)

    store.undo()
    expect(store.network.segments.size).toBe(1)
  })

  it('keeps the copy on one side of a run whose rails point in opposite directions', () => {
    const { store, b, seg } = storeWithRail()
    // Second rail drawn backwards: C -> B
    const c = addNode(store.network, { x: 200, y: 0 })
    const back = addSegment(store.network, c.id, b.id)!
    store.markDirty()

    expect(store.createParallelTrackFromSelection(4, [seg.id, back.id])).toBe(true)
    // Two new rails sharing their middle node: 3 new nodes, all on the same side
    expect(store.selection.segments.size).toBe(2)
    expect(store.selection.nodes.size).toBe(3)
    const ys = [...store.selection.nodes].map((id) => store.network.nodes.get(id)!.pos.y)
    for (const y of ys) expect(y).toBeCloseTo(ys[0])
    expect(Math.abs(ys[0])).toBeCloseTo(4)
  })

  it('mitres the corner between two rails at an angle', () => {
    const { store, b, seg } = storeWithRail()
    const c = addNode(store.network, { x: 100, y: 100 })
    const up = addSegment(store.network, b.id, c.id)!
    store.markDirty()

    expect(store.createParallelTrackFromSelection(10, [seg.id, up.id])).toBe(true)
    expect(store.selection.nodes.size).toBe(3)
    const corner = [...store.selection.nodes]
      .map((id) => store.network.nodes.get(id)!.pos)
      .find((p) => Math.abs(p.x - 90) < 1e-6 && Math.abs(p.y - 10) < 1e-6)
    expect(corner).toBeDefined()
  })

  it('doubles a curved rail with a curve', () => {
    const store = new EditorStore()
    const a = addNode(store.network, { x: 0, y: 0 })
    const b = addNode(store.network, { x: 100, y: 100 })
    const curve = addCurveSegment(store.network, a.id, b.id, { x: 100, y: 0 })!
    store.markDirty()

    expect(store.createParallelTrackFromSelection(5, [curve.id])).toBe(true)
    const created = store.network.segments.get([...store.selection.segments][0])!
    expect(created.kind).toBe('curve')
    expect(created.via).toBeDefined()
  })

  it('refuses when nothing usable is selected', () => {
    const { store, a } = storeWithRail()
    store.selection = { nodes: new Set([a.id]), segments: new Set() }
    expect(store.canCreateParallelTrack).toBe(false)
    expect(store.createParallelTrackFromSelection()).toBe(false)
    expect(store.network.segments.size).toBe(1)
  })
})

describe('Escape (cancelInteraction)', () => {
  it('first cancels the pending pose and keeps the tool, then returns to the select tool', () => {
    const store = new EditorStore()
    store.setTool('place')
    firstClick(store, 0, 0)
    expect(store.hasPendingPlacement).toBe(true)

    store.cancelInteraction()
    expect(store.tool).toBe('place')
    expect(store.hasPendingPlacement).toBe(false)
    expect(store.network.nodes.size).toBe(0)
    expect(store.selection.nodes.size).toBe(0)

    store.cancelInteraction()
    expect(store.tool).toBe('select')
  })

  it('ends a chain without removing the rails already placed', () => {
    const store = new EditorStore()
    store.setTool('place')
    firstClick(store, 0, 0)
    commitClick(store, 50, 0)

    store.cancelInteraction()
    expect(store.tool).toBe('place')
    expect(store.lastNodeId).toBeNull()
    expect(store.network.segments.size).toBe(1)
  })

  it('does not wipe an existing selection when it only cancels a pending measure', () => {
    const { store, seg } = storeWithRail()
    store.selection = { nodes: new Set(), segments: new Set([seg.id]) }
    store.setTool('measure')
    store.measureStart = { x: 0, y: 0 }
    store.isMeasuring = true

    store.cancelInteraction()
    expect(store.tool).toBe('measure')
    expect(store.measureStart).toBeNull()
    expect(store.selection.segments.has(seg.id)).toBe(true)

    store.cancelInteraction()
    expect(store.tool).toBe('select')
    expect(store.selection.segments.has(seg.id)).toBe(true)

    // In the select tool with nothing pending, Escape deselects
    store.cancelInteraction()
    expect(store.selection.segments.size).toBe(0)
  })
})

describe('pending placement guard', () => {
  it('reports a pending placement for every construction tool state', () => {
    const { store, a } = storeWithRail()
    expect(store.hasPendingPlacement).toBe(false)
    store.lastNodeId = a.id
    expect(store.hasPendingPlacement).toBe(true)
    store.lastNodeId = null
    store.curveState = { phase: 1, startId: a.id }
    expect(store.hasPendingPlacement).toBe(true)
    store.curveState = { phase: 0, startId: null }
    store.turnoutStartId = a.id
    expect(store.hasPendingPlacement).toBe(true)
  })
})
