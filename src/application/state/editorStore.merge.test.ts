import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { isNetworkReconciled } from '@domain/geometry/reconcile'
import { convertOsm } from '@domain/import/osmImport'
import { options, readFixture } from '@domain/import/osmImport.testkit'
import { fakeIndex } from '@domain/dataset/datasetIndex.testkit'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { addStation } from '@domain/models/stations'
import { buildOsmProject } from '@application/import/osmProject'
import { resetMemoryStorage, type SerializedProject } from '@infrastructure/persistence/persistence'

/** A straight track along x through the given abscissas, with a station on its first rail when named */
function track(xs: number[], y = 0, station?: string): SerializedProject {
  resetMemoryStorage()
  resetIdCounter(0)
  const builder = new EditorStore()
  const net = builder.network
  const nodes = xs.map((x) => addNode(net, { x, y }))
  const rails = []
  for (let i = 1; i < nodes.length; i++) rails.push(addSegment(net, nodes[i - 1].id, nodes[i].id)!)
  if (station) addStation(net, { id: 'st_1', name: station, uic: '8700001', pos: { x: xs[0], y }, stops: [{ segId: rails[0].id, t: 0.5 }] })
  builder.markDirty()
  return JSON.parse(JSON.stringify(builder.exportProject()))
}

function storeWith(project: SerializedProject): EditorStore {
  resetMemoryStorage()
  const store = new EditorStore()
  store.loadFromData(JSON.parse(JSON.stringify(project)))
  return store
}

const tolerance = (store: EditorStore): number => store.getPlacementThresholds().reconcileTolerance

describe('a project file added to the current project', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetIdCounter(0)
  })

  it('joins the two where they share a node, under ids that do not clash', () => {
    const west = track([0, 500, 1000], 0, 'Gare Un')
    const east = track([1000, 1500, 2000], 0, 'Gare Un')
    // Both files count from 1: the same ids name different things
    expect(east.nodes.map((n) => n.id)).toEqual(west.nodes.map((n) => n.id))
    const store = storeWith(west)
    store.projectName = 'Ouest'
    const camera = { ...store.camera }
    const report = store.mergeProjectFile(east)!
    expect(report).toMatchObject({ nodesAdded: 2, railsAdded: 2, nodesMerged: 1, railsDropped: 0, stationsMerged: 1, stationsAdded: 0 })
    expect(store.network.nodes.size).toBe(5)
    expect(store.network.segments.size).toBe(4)
    // The shared node carries a rail of each file
    const joint = [...store.network.nodes.values()].find((n) => n.pos.x === 1000)!
    expect(store.network.adjacency.get(joint.id)!.length).toBe(2)
    // One station, with a stop from each file
    expect(store.network.stations.size).toBe(1)
    expect([...store.network.stations.values()][0].stops.length).toBe(2)
    expect(isNetworkReconciled(store.network, tolerance(store))).toBe(true)
    expect(store.projectName).toBe('Ouest')
    expect({ ...store.camera }).toEqual(camera)
  })

  it('is one step of the history: undone, the project is what it was; redone, the two again', () => {
    const store = storeWith(track([0, 500, 1000]))
    const before = JSON.stringify(store.exportProject())
    store.mergeProjectFile(track([1000, 1500, 2000], 0))
    expect(store.network.segments.size).toBe(4)
    expect(store.canUndo).toBe(true)
    store.undo()
    expect(JSON.stringify(store.exportProject())).toBe(before)
    store.redo()
    expect(store.network.segments.size).toBe(4)
  })

  it('welds a rail end of the file onto a rail of the project, and cuts where they cross', () => {
    const store = storeWith(track([0, 1000]))
    // A track that ends on the middle of the first, and one that crosses it
    resetMemoryStorage()
    resetIdCounter(0)
    const builder = new EditorStore()
    const net = builder.network
    addSegment(net, addNode(net, { x: 400, y: 0 }).id, addNode(net, { x: 400, y: 300 }).id)
    addSegment(net, addNode(net, { x: 700, y: -200 }).id, addNode(net, { x: 700, y: 200 }).id)
    builder.markDirty()
    const other = JSON.parse(JSON.stringify(builder.exportProject()))
    resetMemoryStorage()
    const report = store.mergeProjectFile(other)!
    expect(report.repairs).toBeGreaterThan(0)
    expect(isNetworkReconciled(store.network, tolerance(store))).toBe(true)
    // The first rail is now three: cut at 400 and at 700
    const onAxis = [...store.network.segments.values()].filter((seg) => store.network.nodes.get(seg.from)!.pos.y === 0 && store.network.nodes.get(seg.to)!.pos.y === 0)
    expect(onAxis.length).toBe(3)
  })

  it('keeps the trains of the project where they stand, and takes those of the file', () => {
    const store = storeWith(track([0, 500, 1000]))
    store.setTool('locomotive')
    expect(store.placeTrainItem({ x: 250, y: 0 })).toBe(true)
    const train = store.trains[0]
    const at = { ...train.vehicles[0].front }
    resetMemoryStorage()
    const other = storeWith(track([1000, 1500, 2000]))
    other.setTool('locomotive')
    expect(other.placeTrainItem({ x: 1750, y: 0 })).toBe(true)
    const file = JSON.parse(JSON.stringify(other.exportProject()))
    resetMemoryStorage()
    const report = store.mergeProjectFile(file)!
    expect(report.trainsAdded).toBe(1)
    expect(store.trains.length).toBe(2)
    expect(store.trains[0]).toBe(train)
    expect(train.vehicles[0].front).toEqual(at)
    for (const t of store.trains) for (const v of t.vehicles) expect(store.network.segments.has(v.front.segId)).toBe(true)
    const ids = store.trains.flatMap((t) => [t.id, ...t.vehicles.map((v) => v.id)])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('added to itself, a real import changes nothing', () => {
    resetIdCounter(0)
    const whole = buildOsmProject(convertOsm(readFixture('clelles-mens'), options({ traceWays: true })), { levels: true, now: new Date('2026-10-10T12:00:00Z') })
    const store = storeWith(whole)
    const rails = store.network.segments.size
    const nodes = store.network.nodes.size
    const report = store.mergeProjectFile(JSON.parse(JSON.stringify(store.exportProject())))!
    expect(report).toMatchObject({ nodesAdded: 0, railsAdded: 0, repairs: 0, frame: 'same' })
    expect(store.network.segments.size).toBe(rails)
    expect(store.network.nodes.size).toBe(nodes)
  })

  it('is refused while driving and on a dataset project; a file that is no project is an error', () => {
    const file = track([1000, 1500])
    const store = storeWith(track([0, 500, 1000]))
    expect(() => store.mergeProjectFile({ hello: 'world' })).toThrow('Fichier JSON invalide')
    expect(() => store.mergeProjectFile({ nodes: [{ id: 'n_1', x: 'a', y: 0 }], segments: [] })).toThrow('Fichier JSON invalide')
    expect(store.network.segments.size).toBe(2)
    store.setTool('locomotive')
    store.placeTrainItem({ x: 250, y: 0 })
    store.togglePlayMode()
    expect(store.isPlayMode).toBe(true)
    expect(store.mergeProjectFile(file)).toBeNull()
    expect(store.network.segments.size).toBe(2)

    resetMemoryStorage()
    const locked = new EditorStore()
    const project = track([0, 500, 1000])
    resetMemoryStorage()
    locked.loadDataset({ version: 1, dataDate: '2026-10-07T16:59:56Z', lines: ['a'], stations: [] }, project, new Map([['a', project]]), fakeIndex(), { minX: 0, minY: -100, maxX: 1000, maxY: 100 })
    expect(locked.mergeProjectFile(file)).toBeNull()
    expect(locked.network.segments.size).toBe(2)
  })
})
