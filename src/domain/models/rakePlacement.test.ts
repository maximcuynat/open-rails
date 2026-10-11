import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, resetIdCounter } from './network'
import { createRake, createRakeAtStation, platformTrackLength, rakeLength, stationFit } from './rakePlacement'
import { ROLLING_STOCK, referenceConsist } from './rollingStock'
import { addStation } from './stations'
import { advanceTrainSet, getTrainSetVisuals, trackLeftAhead, vehicleRearEndPos } from './train'
import type { Network } from './types'

/** A straight from x = 0 to x = `length`, its only rail returned */
function straight(length: number): { net: Network; segId: string } {
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: length, y: 0 })
  return { net, segId: addSegment(net, a.id, b.id)!.id }
}

describe('a complete rake set down at once', () => {
  beforeEach(() => resetIdCounter())

  it.each(['duplex', 'tgvm'] as const)('lays every vehicle of a %s behind the lead, as long as the model says', (model) => {
    const { net, segId } = straight(1000)
    const train = createRake(net, segId, 0.6, 1, model)!
    expect(train.vehicles.map((v) => v.kind)).toEqual(referenceConsist(model).map((v) => v.kind))
    expect(train.vehicles[train.vehicles.length - 1].flipped).toBe(true)
    // In the order of the train along the rail: each bogie behind the one before it
    const ts = train.vehicles.flatMap((v) => [v.front.t, v.rear.t])
    expect(ts[0]).toBeCloseTo(0.6, 6)
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeLessThanOrEqual(ts[i - 1] + 1e-9)
    // From the first bogie to the last: the rake less its two overhangs
    const span = (ts[0] - ts[ts.length - 1]) * 1000
    expect(span).toBeGreaterThan(rakeLength(model) - 12)
    expect(span).toBeLessThan(rakeLength(model))
    // What is drawn holds together, and the rake drives
    expect(getTrainSetVisuals(net, train)!.vehicles).toHaveLength(ROLLING_STOCK[model].trailerCount + 2)
    expect(advanceTrainSet(net, train, 10)).toBe(true)
  })

  it('heads the other way when asked', () => {
    const { net, segId } = straight(1000)
    const train = createRake(net, segId, 0.4, -1, 'duplex')!
    const last = train.vehicles[train.vehicles.length - 1]
    expect(last.rear.t).toBeGreaterThan(train.vehicles[0].front.t)
  })

  it('gives nothing when the track behind is too short', () => {
    const { net, segId } = straight(1000)
    expect(createRake(net, segId, 0.1, 1, 'duplex')).toBeNull()
  })

  it('at a terminus, where the stop is at the buffers, leaves from the other cab and clear of them', () => {
    // Buffers at x = 0 and the stop 2 m from them: the nose of a train that arrived
    const { net, segId } = straight(3000)
    const station = addStation(net, { name: 'Terminus', pos: { x: 100, y: 0 }, stops: [{ segId, t: 2 / 3000 }] })
    const placed = createRakeAtStation(net, station, 'duplex')!
    const { vehicles } = placed.train
    // The lead is the power car at the open end, and the whole line is ahead of it
    expect(vehicles[0].kind).toBe('loco')
    expect(vehicles[0].front.t).toBeGreaterThan(vehicles[vehicles.length - 1].rear.t)
    expect(trackLeftAhead(net, placed.train, 2000)).toBeNull()
    // The tail end stands a metre from the buffers, not over them
    const tailEnd = vehicleRearEndPos(net, vehicles[vehicles.length - 1])!
    expect(tailEnd.x).toBeCloseTo(1, 1)
    // It drives away, nose first
    expect(placed.train.direction).toBe(1)
    expect(advanceTrainSet(net, placed.train, 50)).toBe(true)
    expect(vehicles[0].flipped ?? false).toBe(false)
  })

  it('on a through track, the lead bogie stays at the stop', () => {
    const { net, segId } = straight(6000)
    const station = addStation(net, { name: 'Passante', pos: { x: 3000, y: 0 }, stops: [{ segId, t: 0.5 }] })
    const placed = createRakeAtStation(net, station, 'duplex')!
    expect(placed.train.vehicles[0].front.t).toBeCloseTo(0.5, 6)
  })

  it('takes the first stop when both are as open, and leaves a taken track alone', () => {
    const net = createNetwork()
    const rails = [0, 10].map((y) => {
      const a = addNode(net, { x: 0, y })
      const b = addNode(net, { x: 6000, y })
      return addSegment(net, a.id, b.id)!.id
    })
    const station = addStation(net, { name: 'Passante', pos: { x: 3000, y: 5 }, stops: rails.map((segId) => ({ segId, t: 0.5 })) })
    const first = createRakeAtStation(net, station, 'duplex')!
    expect(first.stop.segId).toBe(rails[0])
    const second = createRakeAtStation(net, station, 'duplex', [first.train])!
    expect(second.stop.segId).toBe(rails[1])
    expect(createRakeAtStation(net, station, 'duplex', [first.train, second.train])).toBeNull()
  })

  it('gives nothing at a station whose platforms are all too short', () => {
    const { net, segId } = straight(120)
    const station = addStation(net, { name: 'Halte', pos: { x: 60, y: 0 }, stops: [{ segId, t: 0.5 }] })
    expect(createRakeAtStation(net, station, 'duplex')).toBeNull()
  })

  /** Two platform tracks between the same points: a short one of 250 m (up to the points of a siding) and a long one of 500 m, with 3 km of line either side */
  function twoPlatforms() {
    const net = createNetwork()
    const west = addNode(net, { x: 0, y: 0 })
    const far = addNode(net, { x: 9000, y: 0 })
    const rail = (ax: number, ay: number, bx: number, by: number) => addSegment(net, addNodeAt(ax, ay).id, addNodeAt(bx, by).id)!
    const nodes = new Map<string, ReturnType<typeof addNode>>([['0,0', west], ['9000,0', far]])
    function addNodeAt(x: number, y: number) {
      const key = `${x},${y}`
      let node = nodes.get(key)
      if (!node) nodes.set(key, (node = addNode(net, { x, y })))
      return node
    }
    rail(0, 0, 3000, 0)
    const long = [rail(3000, 0, 3250, 0), rail(3250, 0, 3500, 0)]
    rail(3500, 0, 9000, 0)
    // The short track leaves at 3000 and comes back at 3500; the points of a siding cut it at 3250
    rail(3000, 0, 3100, 6)
    const short = rail(3100, 6, 3250, 6)
    rail(3250, 6, 3400, 6)
    rail(3400, 6, 3500, 0)
    const siding = rail(3250, 6, 3350, 30)
    void siding
    const station = addStation(net, { name: 'Gare', pos: { x: 3250, y: 3 }, stops: [{ segId: short.id, t: 0.9, ref: 'courte' }, { segId: long[1].id, t: 0.5, ref: 'longue' }] })
    return { net, station, short, long }
  }

  it('measures a platform track from points to points', () => {
    const { net, short, long } = twoPlatforms()
    expect(platformTrackLength(net, { segId: long[0].id })).toBeCloseTo(500, 6)
    expect(platformTrackLength(net, { segId: long[1].id })).toBeCloseTo(500, 6)
    // From the points at 3000 to those of the siding at 3250, along the slanted rail then the straight one
    expect(platformTrackLength(net, { segId: short.id })).toBeCloseTo(Math.hypot(100, 6) + 150, 6)
    expect(platformTrackLength(net, { segId: 's_nope' })).toBe(0)
  })

  it('says how a rake compares with the platform tracks of a station', () => {
    const { net, station } = twoPlatforms()
    expect(stationFit(net, station, 'duplex')).toMatchObject({ tracks: 2, fitting: 2, placeable: true })
    expect(stationFit(net, station, 'duplex').longest).toBeCloseTo(500, 6)
    expect(stationFit(net, station, { model: 'regiolis', trailers: 1 }).fitting).toBe(2)
    // Two trainsets coupled: 401 m, longer than any track here but the long one
    const double = stationFit(net, station, { model: 'duplex', trailers: 8, units: 2 })
    expect(double.rakeLength).toBeCloseTo(401.18, 2)
    expect(double).toMatchObject({ fitting: 1, placeable: true })
    const tooLong = stationFit(net, station, { model: 'tgvm', trailers: 9, units: 2 })
    expect(tooLong.rakeLength).toBeGreaterThan(400)
  })

  it('takes a platform track that holds the whole rake before one it would stick out of', () => {
    const { net, station } = twoPlatforms()
    // The short track is the first stop, and as open as the other: two trainsets coupled (401 m) still go to the long one
    expect(createRakeAtStation(net, station, { model: 'duplex', trailers: 8, units: 2 })!.stop.ref).toBe('longue')
    // One trainset fits both: the first in the order of the stops
    expect(createRakeAtStation(net, station, 'duplex')!.stop.ref).toBe('courte')
  })

  it('sets down the composition asked for', () => {
    const { net, segId } = straight(2000)
    expect(createRake(net, segId, 0.9, 1, { model: 'duplex', trailers: 5 })!.vehicles).toHaveLength(7)
    const double = createRake(net, segId, 0.9, 1, { model: 'regiolis', trailers: 2, units: 2 })!
    expect(double.vehicles).toHaveLength(8)
    expect(rakeLength({ model: 'regiolis', trailers: 2, units: 2 })).toBeCloseTo(2 * 71.82 + 0.8, 2)
  })
})
