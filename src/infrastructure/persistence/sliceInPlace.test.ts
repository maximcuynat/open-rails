import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { addStation } from '@domain/models/stations'
import { addPlatform, edgeLength } from '@domain/models/platforms'
import { addSignal } from '@domain/models/signals'
import { addSpeedZone } from '@domain/models/speedZones'
import { findJunctionAtNode } from '@domain/models/junction'
import { placementThresholds } from '@domain/geometry/scale'
import type { Network } from '@domain/models/types'
import { deserializeNetwork, resetMemoryStorage, type SerializedProject } from './persistence'
import { sliceProject } from './projectSlices'
import { addSliceInPlace, removeSliceInPlace, sliceHoldsRail } from './sliceInPlace'

/**
 * Three pieces of a line along x: a (0 → 1000), b (1000 → 2000, with a branch leaving at 1000)
 * and c (2000 → 3000). The node at x = 1000 is a fork whose table is in a and b; a station's
 * platform runs from 800 to 1200, over the border of a and b; b has a signal and a speed zone.
 * Cut as the generator does. The tests run with every revision checked (`src/testSetup.ts`):
 * every call is also compared with the network read anew from the union of what is loaded.
 */
function pieces(): { a: SerializedProject; b: SerializedProject; c: SerializedProject; fork: string } {
  const builder = new EditorStore()
  const net = builder.network
  const [n0, n1, n2, n3] = [0, 1000, 2000, 3000].map((x) => addNode(net, { x, y: 0 }))
  const a = addSegment(net, n0.id, n1.id)!.id
  const b = addSegment(net, n1.id, n2.id)!.id
  const branch = addSegment(net, n1.id, addNode(net, { x: 1500, y: 60 }).id)!.id
  const c = addSegment(net, n2.id, n3.id)!.id
  expect(addSignal(net, { segId: b, t: 0.5 }, true, 'spacing').ok).toBe(true)
  expect(addSpeedZone(net, [{ segId: c, t0: 0.2, t1: 0.8 }], 60)).not.toBeNull()
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
  expect(findJunctionAtNode(net, n1.id)).toBeDefined()
  const whole = builder.exportProject()
  delete whole.camera
  resetMemoryStorage()
  return {
    a: sliceProject(whole, (id) => id === a),
    b: sliceProject(whole, (id) => id === b || id === branch),
    c: sliceProject(whole, (id) => id === c),
    fork: n1.id,
  }
}

const tolerance = placementThresholds(1.435).reconcileTolerance

/** A network holding piece a alone, as the store reads it */
function loaded(first: SerializedProject): Network {
  return deserializeNetwork(first, tolerance).network
}

describe('the pieces of a project put onto a live network one at a time', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetIdCounter()
  })

  it('adds a piece: its nodes and rails, the fork of the border whole, the platform its whole length', () => {
    const { a, b, fork } = pieces()
    const net = loaded(a)
    const alone = findJunctionAtNode(net, fork)
    expect(alone?.passages.length ?? 0).toBeLessThan(2)
    const kept = net.nodes.get(a.nodes[0].id)
    addSliceInPlace(net, b, [a, b], tolerance)
    expect(net.segments.size).toBe(a.segments.length + b.segments.length)
    // What was there stays the object it was
    expect(net.nodes.get(a.nodes[0].id)).toBe(kept)
    expect(net.adjacency.get(fork)).toHaveLength(3)
    expect(findJunctionAtNode(net, fork)?.passages).toHaveLength(2)
    expect(net.signals.size).toBe(1)
    const platform = net.platforms.get('pl_1')!
    expect(platform.edges[0].track).toHaveLength(2)
    expect(edgeLength(net, platform.edges[0])).toBeCloseTo(400, 6)
  })

  it('takes a piece off: what only it held goes, the border keeps its other rails and the platform is shortened', () => {
    const { a, b, c, fork } = pieces()
    const net = loaded(a)
    addSliceInPlace(net, b, [a, b], tolerance)
    addSliceInPlace(net, c, [a, b, c], tolerance)
    expect(net.speedZones.size).toBe(1)
    removeSliceInPlace(net, b, [a, c], tolerance)
    expect(net.segments.size).toBe(a.segments.length + c.segments.length)
    expect(net.adjacency.get(fork)).toHaveLength(1)
    expect(net.signals.size).toBe(0)
    expect(net.speedZones.size).toBe(1)
    expect(edgeLength(net, net.platforms.get('pl_1')!.edges[0])).toBeCloseTo(200, 6)
    // And the first one can go too, then everything: an empty network is left
    removeSliceInPlace(net, a, [c], tolerance)
    expect(net.stations.size).toBe(0)
    expect(net.platforms.size).toBe(0)
    removeSliceInPlace(net, c, [], tolerance)
    expect(net.nodes.size).toBe(0)
    expect(net.segments.size).toBe(0)
  })

  it('comes back the same after a piece went and came again, in another order', () => {
    const { a, b, c } = pieces()
    const net = loaded(b)
    addSliceInPlace(net, c, [b, c], tolerance)
    addSliceInPlace(net, a, [b, c, a], tolerance)
    removeSliceInPlace(net, b, [c, a], tolerance)
    addSliceInPlace(net, b, [c, a, b], tolerance)
    expect(net.segments.size).toBe(a.segments.length + b.segments.length + c.segments.length)
    expect(net.platforms.get('pl_1')!.edges[0].track).toHaveLength(2)
  })

  it('tells which file holds a rail', () => {
    const { a, b } = pieces()
    expect(sliceHoldsRail(a, a.segments[0].id)).toBe(true)
    expect(sliceHoldsRail(b, a.segments[0].id)).toBe(false)
  })
})
