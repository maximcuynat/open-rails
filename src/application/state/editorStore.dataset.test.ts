import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { addStation } from '@domain/models/stations'
import { fakeIndex } from '@domain/dataset/datasetIndex.testkit'
import type { DatasetRecipe } from '@domain/dataset/datasetRecipe'
import { getStorage, loadNetworkFromStorage, resetMemoryStorage, type SerializedProject } from '@infrastructure/persistence/persistence'
import { fakeDataset } from '@application/dataset/dataset.testkit'

/**
 * A line file as the dataset would give it: a straight track of four rails along x, a branch
 * leaving at x = 1000 (a turnout, proposed when the store looks at it), a station on the first
 * rail. Built in a store of its own and exported.
 */
function lineProject(): SerializedProject {
  const builder = new EditorStore()
  const net = builder.network
  const xs = [0, 500, 1000, 1500, 2000]
  const nodes = xs.map((x) => addNode(net, { x, y: 0 }))
  const rails = []
  for (let i = 1; i < nodes.length; i++) rails.push(addSegment(net, nodes[i - 1].id, nodes[i].id)!)
  addSegment(net, nodes[2].id, addNode(net, { x: 1500, y: 60 }).id)
  addStation(net, { id: 's1', name: 'Gare Un', uic: '8700001', code: 'GUN', pos: { x: 250, y: 0 }, stops: [{ segId: rails[0].id, t: 0.5 }] })
  builder.markDirty()
  builder.notify()
  return builder.exportProject()
}

const recipe = (): DatasetRecipe => ({ version: 1, dataDate: '2026-10-07T16:59:56Z', lines: ['a'], stations: ['s1', 's2'] })

function lockedStore(): { store: EditorStore; project: SerializedProject } {
  const project = lineProject()
  const store = new EditorStore()
  store.loadDataset(recipe(), project, new Map([['a', project]]), fakeIndex(), { minX: 0, minY: -100, maxX: 2000, maxY: 100 })
  return { store, project }
}

describe('a project loaded from the dataset', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetIdCounter()
  })

  it('is locked: the track is there, the drawing tools are refused, the looking and train tools taken', () => {
    const { store, project } = lockedStore()
    expect(store.isNetworkLocked).toBe(true)
    expect(store.canEditNetwork).toBe(false)
    expect(store.network.segments.size).toBe(project.segments.length)
    expect(store.tool).toBe('select')
    store.setTool('place')
    expect(store.tool).toBe('select')
    store.setTool('signal')
    expect(store.tool).toBe('select')
    store.setTool('locomotive')
    expect(store.tool).toBe('locomotive')
    store.setTool('pan')
    expect(store.tool).toBe('pan')
  })

  it('keeps its track whatever is asked of it', () => {
    const { store, project } = lockedStore()
    const rails = project.segments.length
    const anyRail = [...store.network.segments.keys()][0]
    store.selection = { nodes: new Set(), segments: new Set([anyRail]) }
    store.deleteSelection()
    expect(store.network.segments.size).toBe(rails)
    expect(store.createParallelTrackFromSelection()).toBe(false)
    expect(store.connectSelectedNodes()).toBe(false)
    expect(store.setSelectionCant(50)).toBe(false)
    expect(store.shiftSelectionLevel(1)).toBe(false)
    expect(store.simplifyToLongRails()).toBeNull()
    expect(store.reconcileNetwork()).toEqual({ splitCount: 0, weldedCount: 0 })
    expect(store.reconcileTopology()).toEqual({ splitCount: 0, weldedCount: 0 })
    const seg = store.network.segments.get(anyRail)!
    const name = store.sectionMeta[anyRail]?.name
    store.setSectionMeta(anyRail, { name: 'Renommée' })
    expect(store.sectionMeta[anyRail]?.name).toBe(name)
    expect(store.network.segments.get(anyRail)).toBe(seg)
    expect(store.network.segments.size).toBe(rails)
  })

  it('takes trains and lets the points be thrown, without writing any undo step', () => {
    const { store } = lockedStore()
    expect(store.canUndo).toBe(false)
    expect(store.placeTrainItem({ x: 300, y: 0 })).toBe(true)
    expect(store.trains.length).toBe(1)
    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(false)
    const junction = [...store.network.junctions.values()].find((j) => j.kind === 'turnout')
    expect(junction).toBeDefined()
    const before = junction!.active
    expect(store.toggleActiveJunction(junction!.id)).toBe(true)
    expect(store.network.junctions.get(junction!.id)!.active).not.toBe(before)
  })

  it('names the first station of the journey, frames the lines and remembers its files', () => {
    const { store } = lockedStore()
    expect(store.selectedStationId).toBe('s1')
    expect(store.selectedStation?.name).toBe('Gare Un')
    expect(store.camera.x).toBe(1000)
    expect(store.camera.y).toBe(0)
    expect(store.camera.scale).toBeGreaterThan(0)
    expect(store.dataset?.lines).toEqual(['a'])
    expect(store.datasetFiles.has('a')).toBe(true)
    expect(store.datasetIndex?.lines.length).toBe(5)
    expect(store.autosaveFailed).toBe(false)
  })

  it('is unlocked by a new project or a free import', () => {
    const { store, project } = lockedStore()
    store.newProject()
    expect(store.isNetworkLocked).toBe(false)
    expect(store.dataset).toBeNull()
    expect(store.datasetFiles.size).toBe(0)
    store.setTool('place')
    expect(store.tool).toBe('place')

    const again = lockedStore().store
    again.loadFromData(project)
    expect(again.isNetworkLocked).toBe(false)
    again.setTool('place')
    expect(again.tool).toBe('place')
  })
})

describe('a dataset project saved as a recipe', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetIdCounter()
  })

  it('writes its recipe, trains and camera to the storage, never its track', () => {
    const { store } = lockedStore()
    expect(store.placeTrainItem({ x: 300, y: 0 })).toBe(true)
    store.flushPersistedState()
    const text = getStorage()!.getItem('open-rail:network')!
    expect(text.length).toBeLessThan(5000)
    const stored = JSON.parse(text) as SerializedProject
    expect(stored.nodes).toEqual([])
    expect(stored.segments).toEqual([])
    expect(stored.dataset).toEqual(recipe())
    expect(stored.trains?.length).toBe(1)
    expect(stored.camera?.x).toBe(1000)
    expect(store.autosaveFailed).toBe(false)

    const read = loadNetworkFromStorage()!
    expect(read.dataset).toEqual(recipe())
    expect(read.network.segments.size).toBe(0)
    expect(read.stored.trains?.length).toBe(1)
  })

  it('comes back locked and empty, waiting for its lines to be fetched again', () => {
    const { store } = lockedStore()
    store.placeTrainItem({ x: 300, y: 0 })
    store.flushPersistedState()
    const again = new EditorStore()
    expect(again.isNetworkLocked).toBe(true)
    expect(again.network.segments.size).toBe(0)
    expect(again.datasetReloadPending).toBe(true)
    expect(again.datasetStoredProject?.trains?.length).toBe(1)
    expect(again.canUndo).toBe(false)
  })

  it('exports its whole track with its recipe, and a re-import of that file stays locked', () => {
    const { store, project } = lockedStore()
    const exported = store.exportProject()
    expect(exported.nodes.length).toBe(project.nodes.length)
    expect(exported.dataset).toEqual(recipe())

    const fresh = new EditorStore()
    fresh.loadFromData(JSON.parse(JSON.stringify(exported)))
    expect(fresh.isNetworkLocked).toBe(true)
    expect(fresh.network.segments.size).toBe(project.segments.length)
    expect(fresh.canUndo).toBe(false)

    fresh.loadFromData(JSON.parse(JSON.stringify(project)))
    expect(fresh.isNetworkLocked).toBe(false)
  })
})

describe('lines fetched as a train nears them', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetIdCounter()
  })

  /** Line a loaded alone, with a loader that answers with line b when asked */
  function driving(connectionX = 1000) {
    const { index, files } = fakeDataset()
    index.connections[0].x = connectionX
    const store = new EditorStore()
    const a = files['a.json']
    store.loadDataset({ version: 1, dataDate: index.dataDate, lines: ['a'], stations: ['s1'] }, a, new Map([['a', a]]), index, null)
    let release: (() => void) | null = null
    const asked: string[][] = []
    store.datasetLoader = (lines) => {
      asked.push(lines)
      return new Promise((resolve) => {
        release = () => resolve(new Map(lines.map((id) => [id, files[`${id}.json`]])))
      })
    }
    expect(store.placeTrainItem({ x: 300, y: 0 })).toBe(true)
    store.togglePlayMode()
    expect(store.isPlayMode).toBe(true)
    return { store, asked, release: () => release?.(), railsOfB: files['b.json'].segments.length }
  }

  it('asks for the line beyond a connection within reach, once, and adds it without stopping the train', async () => {
    const { store, asked, release, railsOfB } = driving()
    const before = store.network.segments.size
    const train = store.trains[0]
    const front = train.vehicles[0].front.segId
    store.tickAllTrains(1.0)
    expect(asked).toEqual([['b']])
    expect(store.datasetPending.has('b')).toBe(true)
    store.tickAllTrains(1.0)
    expect(asked.length).toBe(1)
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.network.segments.size).toBe(before + railsOfB)
    expect(store.dataset?.lines).toEqual(['a', 'b'])
    expect(store.datasetPending.size).toBe(0)
    expect(store.isPlayMode).toBe(true)
    expect(store.trains.length).toBe(1)
    expect(store.trains[0]).toBe(train)
    expect(store.network.segments.has(front)).toBe(true)
    expect(store.datasetLastAddMs).toBeGreaterThanOrEqual(0)
    store.tickAllTrains(1.0)
    expect(asked.length).toBe(1)
  })

  it('leaves alone a connection out of reach, and does nothing on an unlocked project', () => {
    const { store, asked } = driving(60_000)
    store.tickAllTrains(1.0)
    store.tickAllTrains(1.0)
    expect(asked).toEqual([])
    const free = new EditorStore()
    expect(free.addDatasetLines(new Map())).toBe(0)
  })
})
