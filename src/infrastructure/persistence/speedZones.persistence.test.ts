import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, generateId, resetIdCounter } from '../../domain/models/network'
import { snapToNearestTrack } from '../../domain/models/locomotive'
import { advanceTrainSet, createVehicle, makeTrainSet } from '../../domain/models/train'
import { speedZonesAt } from '../../domain/models/speedZones'
import { addSpeedZoneBetween, speedZoneEnds, speedZoneLength } from '../../domain/services/speedZoneLayout'
import type { Network } from '../../domain/models/types'
import { deserializeNetwork, serializeNetwork, type SerializedProject } from './persistence'

beforeEach(() => resetIdCounter(0))

function at(net: Network, x: number, y = 0) {
  const hit = snapToNearestTrack(net, { x, y }, 0.5)!
  return { segId: hit.segId, t: hit.t }
}

/** Three rails along y = 0 (0–300–600–1000) */
function track() {
  const net = createNetwork()
  const nodes = [0, 300, 600, 1000].map((x) => addNode(net, { x, y: 0 }))
  const rails = nodes.slice(1).map((node, i) => addSegment(net, nodes[i].id, node.id)!)
  return { net, nodes, rails }
}

const throughJson = (project: SerializedProject): SerializedProject => JSON.parse(JSON.stringify(project))

describe('speed zones in a saved project', () => {
  it('a project without zone is written without the key and saved again identically', () => {
    const { net } = track()
    const saved = serializeNetwork(net, 'P')
    expect('speedZones' in throughJson(saved)).toBe(false)

    const again = serializeNetwork(deserializeNetwork(throughJson(saved)).network, 'P')
    expect(JSON.stringify(again)).toBe(JSON.stringify(saved))
  })

  it('a file from before the zones loads with none', () => {
    const { net } = track()
    const loaded = deserializeNetwork(throughJson(serializeNetwork(net))).network
    expect(loaded.speedZones.size).toBe(0)
  })

  it('zones come back the same: ids, speeds, order of the stretches, place in the world', () => {
    const { net } = track()
    const zone = addSpeedZoneBetween(net, at(net, 100), at(net, 900), 90)!
    const back = addSpeedZoneBetween(net, at(net, 500), at(net, 200), 30)!

    const saved = throughJson(serializeNetwork(net, 'P'))
    expect(saved.speedZones).toEqual([
      { id: zone.id, speed: 90, spans: zone.spans },
      { id: back.id, speed: 30, spans: back.spans },
    ])

    const loaded = deserializeNetwork(saved).network
    expect([...loaded.speedZones.keys()]).toEqual([zone.id, back.id])
    for (const original of [zone, back]) {
      const restored = loaded.speedZones.get(original.id)!
      expect(restored).not.toBe(original)
      expect(restored.speed).toBe(original.speed)
      expect(restored.spans).toEqual(original.spans)
      expect(speedZoneLength(loaded, restored)).toBeCloseTo(speedZoneLength(net, original), 9)
      expect(speedZoneEnds(loaded, restored)).toEqual(speedZoneEnds(net, original))
    }
    // Saved again, the file is the same
    expect(JSON.stringify(serializeNetwork(loaded, 'P'))).toBe(JSON.stringify(saved))
    // The index of the loaded network answers
    const place = at(loaded, 450)
    expect(speedZonesAt(loaded, place.segId, place.t).map((z) => z.id)).toEqual([zone.id, back.id])
  })

  it('a saved zone does not share its stretches with the network it was saved from', () => {
    const { net } = track()
    const zone = addSpeedZoneBetween(net, at(net, 100), at(net, 900), 90)!
    const saved = serializeNetwork(net)
    zone.spans[0].t0 = 0.9
    expect(saved.speedZones![0].spans[0].t0).toBeCloseTo(1 / 3, 9)
  })

  it('ids generated after a load stay clear of the zone ids, with or without trains', () => {
    const { net, rails } = track()
    addSpeedZoneBetween(net, at(net, 100), at(net, 900), 90)
    const saved = throughJson(serializeNetwork(net))
    saved.speedZones![0].id = 'z_900'

    resetIdCounter(0)
    deserializeNetwork(saved)
    expect(generateId('z')).toBe('z_901')

    const train = makeTrainSet(generateId('train'), [createVehicle(net, rails[0].id, 0.5, 'loco')!])
    advanceTrainSet(net, train, 0)
    const withTrain = throughJson(
      serializeNetwork(net, 'P', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, [train]),
    )
    withTrain.speedZones![0].id = 'z_5000'
    resetIdCounter(0)
    expect(deserializeNetwork(withTrain).trains).toHaveLength(1)
    expect(generateId('z')).toBe('z_5001')
  })

  it('keeps what can be kept of a file with invalid zones', () => {
    const { net, rails } = track()
    const saved = throughJson(serializeNetwork(net))
    const whole = (segId: string) => ({ segId, t0: 0, t1: 1 })
    saved.speedZones = [
      { id: 'z_10', speed: 90, spans: [whole(rails[0].id)] },
      // Not usable at all
      null,
      'zone',
      { id: 'z_11', speed: 95, spans: [whole(rails[0].id)] },
      { id: 'z_12', speed: 0, spans: [whole(rails[0].id)] },
      { id: 'z_13', speed: '90', spans: [whole(rails[0].id)] },
      { id: 14, speed: 90, spans: [whole(rails[0].id)] },
      { id: 'z_15', speed: 90 },
      { id: 'z_16', speed: 90, spans: [] },
      { id: 'z_10', speed: 60, spans: [whole(rails[1].id)] },
      { id: 'z_17', speed: 90, spans: [whole('s_missing'), { segId: rails[0].id, t0: 0.5, t1: 0.5 }] },
      // Usable in part
      { id: 'z_18', speed: 60, spans: [whole(rails[0].id), { segId: rails[1].id, t0: -1, t1: 2 }, null, { segId: rails[2].id, t0: 0, t1: 0.5 }] },
      { id: 'z_19', speed: 30, spans: [{ segId: rails[1].id, t0: 0.5, t1: 1, extra: true }, { segId: rails[2].id, t0: 'a', t1: 1 }] },
    ] as unknown as SerializedProject['speedZones']

    const loaded = deserializeNetwork(saved).network
    const zones = [...loaded.speedZones.values()]
    expect(zones.map((z) => [z.id.startsWith('z_'), z.speed, speedZoneLength(loaded, z)])).toEqual([
      [true, 90, 300],
      [true, 60, 300],
      [true, 30, 150],
      // The part of z_18 beyond the stretches that could not be read is a zone of its own
      [true, 60, 200],
    ])
    expect(zones.slice(0, 3).map((z) => z.id)).toEqual(['z_10', 'z_18', 'z_19'])
    expect(zones[2].spans).toEqual([{ segId: rails[1].id, t0: 0.5, t1: 1 }])
    expect(new Set(zones.map((z) => z.id)).size).toBe(4)
  })

  it('a zone saved on a rail that the reconcile pass of the load cuts again stays where it was', () => {
    // A file whose rails cross without having been cut (written by hand, or by a version that
    // reconciled differently): loading cuts both rails at the crossing and gives them new ids
    const net = createNetwork()
    const w = addNode(net, { x: 0, y: 0 })
    const e = addNode(net, { x: 1000, y: 0 })
    const s = addNode(net, { x: 400, y: -100 })
    const n = addNode(net, { x: 400, y: 100 })
    const main = addSegment(net, w.id, e.id)!
    const across = addSegment(net, s.id, n.id)!
    const zone = addSpeedZoneBetween(net, at(net, 250), at(net, 750), 90)!
    const crossZone = addSpeedZoneBetween(net, at(net, 400, 80), at(net, 400, -80), 30)!
    const saved = throughJson(serializeNetwork(net))
    expect(saved.segments).toHaveLength(2)

    const loaded = deserializeNetwork(saved).network
    expect(loaded.segments.size).toBe(4)
    expect(loaded.segments.has(main.id)).toBe(false)
    expect(loaded.segments.has(across.id)).toBe(false)

    expect(loaded.speedZones.size).toBe(2)
    const restored = loaded.speedZones.get(zone.id)!
    expect(restored.spans).toHaveLength(2)
    for (const span of restored.spans) expect(loaded.segments.has(span.segId)).toBe(true)
    const ends = speedZoneEnds(loaded, restored)!
    expect(Math.hypot(ends.a.x - 250, ends.a.y)).toBeLessThan(0.01)
    expect(Math.hypot(ends.b.x - 750, ends.b.y)).toBeLessThan(0.01)
    expect(speedZoneLength(loaded, restored)).toBeCloseTo(500, 6)

    const restoredCross = loaded.speedZones.get(crossZone.id)!
    const crossEnds = speedZoneEnds(loaded, restoredCross)!
    expect(Math.hypot(crossEnds.a.x - 400, crossEnds.a.y - 80)).toBeLessThan(0.01)
    expect(Math.hypot(crossEnds.b.x - 400, crossEnds.b.y + 80)).toBeLessThan(0.01)
    expect(speedZoneLength(loaded, restoredCross)).toBeCloseTo(160, 6)

    // Loaded a second time (what undo and redo do with a snapshot), nothing moves any more
    const twice = deserializeNetwork(throughJson(serializeNetwork(loaded))).network
    expect(JSON.stringify(serializeNetwork(twice))).toBe(JSON.stringify(serializeNetwork(loaded)))
  })
})
