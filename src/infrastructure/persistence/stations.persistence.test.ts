import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, generateId, resetIdCounter } from '../../domain/models/network'
import { positionOnSegment } from '../../domain/models/locomotive'
import { addStation } from '../../domain/models/stations'
import { deserializeNetwork, PROJECT_VERSION, serializeNetwork, type SerializedProject } from './persistence'

beforeEach(() => resetIdCounter(0))

/** Three rails along y = 0 (0–300–600–1000) */
function track() {
  const net = createNetwork()
  const nodes = [0, 300, 600, 1000].map((x) => addNode(net, { x, y: 0 }))
  const rails = nodes.slice(1).map((node, i) => addSegment(net, nodes[i].id, node.id)!)
  return { net, nodes, rails }
}

const throughJson = (project: SerializedProject): SerializedProject => JSON.parse(JSON.stringify(project))
const save = (net: ReturnType<typeof createNetwork>) => serializeNetwork(net, 'P')

describe('stations in a saved project', () => {
  it('a project without station is written without the key, at the version it had', () => {
    const { net } = track()
    const saved = throughJson(save(net))
    expect('stations' in saved).toBe(false)
    expect(saved.version).toBe(2)
    expect(deserializeNetwork(saved).network.stations.size).toBe(0)
    expect(JSON.stringify(save(deserializeNetwork(saved).network))).toBe(JSON.stringify(save(net)))
  })

  it('stations come back the same, in a version 4 file older builds refuse', () => {
    const { net, rails } = track()
    const full = addStation(net, { name: 'Clelles-Mens', pos: { x: 450, y: 0 }, uic: '8774762', code: 'CLM', stops: [{ segId: rails[1].id, t: 0.5, ref: 'A' }, { segId: rails[0].id, t: 0.9 }] })
    const bare = addStation(net, { name: 'Halte', pos: { x: 800, y: 30 }, stops: [] })

    const saved = throughJson(save(net))
    expect(saved.version).toBe(4)
    expect(PROJECT_VERSION).toBe(4)
    expect(saved.stations).toEqual([
      { id: full.id, name: 'Clelles-Mens', x: 450, y: 0, uic: '8774762', code: 'CLM', stops: [{ segId: rails[1].id, t: 0.5, ref: 'A' }, { segId: rails[0].id, t: 0.9 }] },
      { id: bare.id, name: 'Halte', x: 800, y: 30, stops: [] },
    ])
    const loaded = deserializeNetwork(saved).network
    expect([...loaded.stations.values()]).toEqual([...net.stations.values()])
    expect(JSON.stringify(save(loaded))).toBe(JSON.stringify(save(net)))
    expect(() => deserializeNetwork({ ...saved, version: 5 as 4 })).toThrow()
  })

  it('reads a damaged file without failing: what does not hold together is skipped', () => {
    const { net, rails } = track()
    const good = addStation(net, { name: 'G', pos: { x: 0, y: 0 }, stops: [{ segId: rails[0].id, t: 0.5 }] })
    const saved = throughJson(save(net))
    saved.stations = [
      ...saved.stations!,
      null,
      { id: 'st_50' },
      { id: 'st_51', name: 'Nowhere', x: 0, y: 0, stops: [{ segId: 'nowhere', t: 0.5 }, { segId: rails[1].id, t: 7 }] },
      { id: good.id, name: 'Again', x: 0, y: 0, stops: [] },
      { id: 'st_52', name: 'Odd stops', x: 1, y: 2, stops: 'none' },
    ] as never
    const loaded = deserializeNetwork(saved).network
    expect([...loaded.stations.keys()]).toEqual([good.id, 'st_51', 'st_52'])
    // Stops off the track are dropped once every rail is back; the station stays
    expect(loaded.stations.get('st_51')!.stops).toEqual([])
    expect(loaded.stations.get('st_52')).toEqual({ id: 'st_52', name: 'Odd stops', pos: { x: 1, y: 2 }, stops: [] })
    expect(deserializeNetwork({ ...saved, stations: 'none' } as never).network.stations.size).toBe(0)
  })

  it('new ids do not reuse those of the stations read', () => {
    const { net } = track()
    addStation(net, { name: 'G', pos: { x: 0, y: 0 }, stops: [] })
    const saved = throughJson(save(net))
    saved.stations![0].id = 'st_700'
    resetIdCounter(0)
    const loaded = deserializeNetwork(saved).network
    expect(loaded.stations.has('st_700')).toBe(true)
    expect(generateId('n')).toBe('n_701')
  })

  it('stops are put back before the reconcile pass, which carries them onto the rails it cuts', () => {
    // A second track runs across the rail of the stop without a node there: the load cuts both
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 1000, y: 0 })
    const rail = addSegment(net, a.id, b.id)!
    const c = addNode(net, { x: 400, y: -300 })
    const d = addNode(net, { x: 400, y: 300 })
    addSegment(net, c.id, d.id)
    const station = addStation(net, { name: 'G', pos: { x: 700, y: 0 }, stops: [{ segId: rail.id, t: 0.7, ref: '1' }, { segId: rail.id, t: 0.1 }] })

    const loaded = deserializeNetwork(throughJson(save(net))).network
    expect(loaded.segments.has(rail.id)).toBe(false)
    const back = loaded.stations.get(station.id)!
    expect(back.stops).toHaveLength(2)
    expect(back.stops[0].ref).toBe('1')
    for (const [i, stop] of back.stops.entries()) {
      expect(loaded.segments.has(stop.segId)).toBe(true)
      const original = positionOnSegment(net, rail.id, station.stops[i].t)!
      expect(positionOnSegment(loaded, stop.segId, stop.t)!.x).toBeCloseTo(original.x, 6)
    }
  })

  it('a step of the history brought to a network in place restores its stations', () => {
    const { net, rails } = track()
    const station = addStation(net, { name: 'G', pos: { x: 450, y: 0 }, uic: '8700001', stops: [{ segId: rails[1].id, t: 0.5 }] })
    const step = throughJson(save(net))
    // Edited since: a station gone, another one added
    net.stations.delete(station.id)
    addStation(net, { name: 'Other', pos: { x: 0, y: 0 }, stops: [] })
    // The check of the tests (checkAgainstFresh) compares the network brought in place with a fresh read
    const back = deserializeNetwork(step, undefined, net).network
    expect(back).toBe(net)
    expect([...net.stations.values()]).toEqual([{ id: station.id, name: 'G', pos: { x: 450, y: 0 }, uic: '8700001', stops: [{ segId: rails[1].id, t: 0.5 }] }])
  })
})
