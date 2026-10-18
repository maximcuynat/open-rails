import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { addStation } from '@domain/models/stations'
import { addPlatform, edgeLength } from '@domain/models/platforms'
import { fakeIndex } from '@domain/dataset/datasetIndex.testkit'
import { resetMemoryStorage, type SerializedProject } from '@infrastructure/persistence/persistence'
import { sliceProject, unionProjects } from '@infrastructure/persistence/projectSlices'

/**
 * Two pieces of a line end to end along x, a (0 → 1000) and b (1000 → 2000), and a station whose
 * platform runs from x = 800 to x = 1200: over the border of the two pieces. Cut as the generator does.
 */
function pieces(): { a: SerializedProject; b: SerializedProject } {
  const builder = new EditorStore()
  const net = builder.network
  const [n0, n1, n2] = [0, 1000, 2000].map((x) => addNode(net, { x, y: 0 }))
  const a = addSegment(net, n0.id, n1.id)!.id
  const b = addSegment(net, n1.id, n2.id)!.id
  const station = addStation(net, { id: 'st_1', name: 'Gare Frontière', pos: { x: 1000, y: 5 }, stops: [{ segId: a, t: 0.9 }] })
  addPlatform(net, {
    id: 'pl_1',
    stationId: station.id,
    edges: [{ track: [{ segId: a, t0: 0.8, t1: 1 }, { segId: b, t0: 0, t1: 0.2 }], side: 'right', ref: '1' }],
    width: 6,
    markers: [{ edge: 0, at: 390, heading: 'forward' }, { edge: 0, at: 10, heading: 'backward' }],
  })
  builder.markDirty()
  builder.notify()
  const whole = builder.exportProject()
  delete whole.camera
  resetMemoryStorage()
  return { a: sliceProject(whole, (id) => id === a), b: sliceProject(whole, (id) => id === b) }
}

describe('a platform over the border of two pieces of the dataset', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetIdCounter()
  })

  it('is in both files whole, shortened while one piece is loaded, whole again once the other comes', () => {
    const { a, b } = pieces()
    expect(a.platforms).toEqual(b.platforms)
    const store = new EditorStore()
    store.loadDataset({ version: 1, dataDate: '2026-10-07', lines: ['a'], stations: ['st_1'] }, a, new Map([['a', a]]), fakeIndex(), null)
    const alone = store.network.platforms.get('pl_1')!
    expect(edgeLength(store.network, alone.edges[0])).toBeCloseTo(200, 6)
    expect(alone.markers.map((m) => Math.round(m.at * 1e6) / 1e6)).toEqual([200, 10])

    expect(store.addDatasetLines(new Map([['b', b]]))).toBe(1)
    const whole = store.network.platforms.get('pl_1')!
    expect(whole.edges[0].track).toHaveLength(2)
    expect(edgeLength(store.network, whole.edges[0])).toBeCloseTo(400, 6)
    expect(whole.markers.map((m) => m.at)).toEqual([390, 10])
    expect(store.network.stations.get('st_1')!.stops).toHaveLength(2)

    // And shortened again when that piece goes
    expect(store.removeDatasetLines(['b'])).toBe(1)
    expect(edgeLength(store.network, store.network.platforms.get('pl_1')!.edges[0])).toBeCloseTo(200, 6)
  })

  it('the union of the pieces has it once, as it was', () => {
    const { a, b } = pieces()
    expect(unionProjects([a, b]).platforms).toEqual(a.platforms)
  })
})
