import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment, createNetwork, resetIdCounter } from '../../domain/models/network'
import { addPlatform, removePlatform, updatePlatform } from '../../domain/models/platforms'
import { addStation } from '../../domain/models/stations'
import type { Network } from '../../domain/models/types'
import { deserializeNetwork, resetMemoryStorage, serializeNetwork, type SerializedProject } from './persistence'

beforeEach(() => resetIdCounter(0))

/** Two rails along y = 0 (0–300–600), a station, and a platform over 100…500 with its two markers */
function layout(net: Network = createNetwork()) {
  const nodes = [0, 300, 600].map((x) => addNode(net, { x, y: 0 }))
  const rails = nodes.slice(1).map((node, i) => addSegment(net, nodes[i].id, node.id)!)
  const station = addStation(net, { name: 'Gare', pos: { x: 300, y: -20 }, stops: [{ segId: rails[0].id, t: 0.5 }] })
  const platform = addPlatform(net, {
    stationId: station.id,
    edges: [{ track: [{ segId: rails[0].id, t0: 1 / 3, t1: 1 }, { segId: rails[1].id, t0: 0, t1: 2 / 3 }], side: 'right', ref: 'A' }],
    width: 6,
    markers: [{ edge: 0, at: 390, heading: 'forward', maxLength: 200 }, { edge: 0, at: 10, heading: 'backward' }],
  })
  return { net, rails, station, platform }
}

const throughJson = (project: SerializedProject): SerializedProject => JSON.parse(JSON.stringify(project))
const save = (net: Network) => serializeNetwork(net, 'P')

describe('platforms in a saved project', () => {
  it('come back the same, in a version 5 file; a project without platform is written as before', () => {
    const { net, station, platform } = layout()
    const saved = throughJson(save(net))
    expect(saved.version).toBe(5)
    expect(saved.platforms).toEqual([
      {
        id: platform.id,
        stationId: station.id,
        edges: [{ track: platform.edges[0].track, side: 'right', ref: 'A' }],
        width: 6,
        markers: [{ edge: 0, at: 390, heading: 'forward', maxLength: 200 }, { edge: 0, at: 10, heading: 'backward' }],
      },
    ])
    const loaded = deserializeNetwork(saved).network
    expect([...loaded.platforms.values()]).toEqual([...net.platforms.values()])
    // Loading settles the stops of the station from the markers
    expect(loaded.stations.get(station.id)!.stops.map((stop) => [stop.segId, stop.ref])).toEqual([
      [platform.edges[0].track[1].segId, 'A'],
      [platform.edges[0].track[0].segId, 'A'],
    ])
    expect(JSON.stringify(save(loaded))).toBe(JSON.stringify(save(deserializeNetwork(throughJson(save(loaded))).network)))

    removePlatform(net, platform.id)
    const without = throughJson(save(net))
    expect('platforms' in without).toBe(false)
    expect(without.version).toBe(4)
  })

  it('a damaged record is skipped, a platform of a station that is not in the file is dropped', () => {
    const { net, platform } = layout()
    const saved = throughJson(save(net))
    saved.platforms!.push({ id: 'pl_90', stationId: 'st_none', edges: saved.platforms![0].edges, width: 6, markers: [] })
    saved.platforms!.push({ id: 'pl_91' } as never, null as never)
    const loaded = deserializeNetwork(saved).network
    expect([...loaded.platforms.keys()]).toEqual([platform.id])
  })

  it('stays the object it is when a step put back in place holds it as it was', () => {
    const { net, platform } = layout()
    const step = save(net)
    deserializeNetwork(step, undefined, net)
    expect(net.platforms.get(platform.id)).toBe(platform)
    updatePlatform(net, platform.id, { width: 4 })
    deserializeNetwork(step, undefined, net)
    const back = net.platforms.get(platform.id)!
    expect(back).not.toBe(platform)
    expect(back.width).toBe(6)
  })
})

describe('platforms and the undo history', () => {
  beforeEach(() => resetMemoryStorage())

  it('adding and removing a platform are undone and redone', () => {
    resetMemoryStorage()
    const store = new EditorStore()
    const { rails, station } = layout(store.network)
    removePlatform(store.network, [...store.network.platforms.keys()][0])
    store.notify()
    store.pushHistorySnapshot()
    const stopsBefore = store.network.stations.get(station.id)!.stops.map((s) => ({ ...s }))

    const platform = addPlatform(store.network, {
      stationId: station.id,
      edges: [{ track: [{ segId: rails[1].id, t0: 0, t1: 1 }], side: 'left' }],
      width: 6,
      markers: [{ edge: 0, at: 150, heading: 'forward' }],
    })
    store.notify()
    store.pushHistorySnapshot()
    expect(store.network.stations.get(station.id)!.stops).toEqual([{ segId: rails[1].id, t: expect.closeTo(0.5, 9) }])

    store.undo()
    expect(store.network.platforms.size).toBe(0)
    // A station that has no platform any more keeps the stops it was saved with
    expect(store.network.stations.get(station.id)!.stops).toEqual(stopsBefore)

    store.redo()
    expect([...store.network.platforms.values()]).toEqual([platform])
    expect(store.network.stations.get(station.id)!.stops).toEqual([{ segId: rails[1].id, t: expect.closeTo(0.5, 9) }])

    removePlatform(store.network, platform.id)
    store.notify()
    store.pushHistorySnapshot()
    store.undo()
    expect(store.network.platforms.get(platform.id)).toEqual(platform)
  })
})
