import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, resetIdCounter } from '../models/network'
import { addPlatform } from '../models/platforms'
import { consistOf, ROLLING_STOCK } from '../models/rollingStock'
import { addStation } from '../models/stations'
import type { Network, PlatformEdge, StopMarker } from '../models/types'
import { chooseStopMarker, noseOffset, platformStopTargets, stationStopGoals, stationStopTargets, stopTargetOnArrival } from './stopMarkers'

beforeEach(() => resetIdCounter(0))

const marker = (at: number, heading: StopMarker['heading'], maxLength?: number): StopMarker => (maxLength === undefined ? { edge: 0, at, heading } : { edge: 0, at, heading, maxLength })

describe('the stop marker a train stops at', () => {
  it('is the one with the smallest longest-train the train fits under', () => {
    const markers = [marker(200, 'forward', 400), marker(120, 'forward', 120), marker(160, 'forward', 220)]
    expect(chooseStopMarker(markers, 100)).toBe(markers[1])
    expect(chooseStopMarker(markers, 120)).toBe(markers[1])
    expect(chooseStopMarker(markers, 200)).toBe(markers[2])
    expect(chooseStopMarker(markers, 390)).toBe(markers[0])
  })

  it('takes one for every train last, and the one furthest ahead when none takes the train', () => {
    const open = [marker(150, 'forward', 120), marker(210, 'forward')]
    expect(chooseStopMarker(open, 100)).toBe(open[0])
    expect(chooseStopMarker(open, 200)).toBe(open[1])
    // Every one bounded below the train: the furthest ahead, the way the train runs
    const bounded = [marker(150, 'forward', 120), marker(190, 'forward', 160), marker(170, 'forward', 140)]
    expect(chooseStopMarker(bounded, 400)).toBe(bounded[1])
    const back = [marker(30, 'backward', 120), marker(10, 'backward', 160), marker(50, 'backward', 140)]
    expect(chooseStopMarker(back, 400)).toBe(back[1])
    // Two as good: the one furthest ahead
    const twins = [marker(100, 'forward'), marker(180, 'forward')]
    expect(chooseStopMarker(twins, 50)).toBe(twins[1])
    expect(chooseStopMarker([], 50)).toBeNull()
  })

  it('measures the nose from the front bogie of the lead vehicle', () => {
    expect(noseOffset(consistOf('duplex'))).toBeCloseTo(ROLLING_STOCK.duplex.powerCar.noseOverhang, 9)
    expect(noseOffset([])).toBe(0)
  })
})

/**
 * A straight line from x = 0 to x = 2000 in two rails, the second laid backwards (from x = 2000 to
 * x = 1000), and a platform of 400 m from x = 800 to x = 1200, walked eastwards over both.
 */
function station(markers: StopMarker[]) {
  const net: Network = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 1000, y: 0 })
  const c = addNode(net, { x: 2000, y: 0 })
  const west = addSegment(net, a.id, b.id)!
  const east = addSegment(net, c.id, b.id)!
  const st = addStation(net, { name: 'Gare', pos: { x: 1000, y: 10 }, stops: [] })
  const edges: [PlatformEdge] = [{ track: [{ segId: west.id, t0: 0.8, t1: 1 }, { segId: east.id, t0: 1, t1: 0.8 }], side: 'left', ref: '1' }]
  const platform = addPlatform(net, { stationId: st.id, edges, width: 6, markers })
  return { net, st, west, east, platform }
}

describe('the stop targets of a station', () => {
  it('gives one per edge and direction, on the rail and running the way of its heading', () => {
    const { net, st, west, east, platform } = station([marker(390, 'forward'), marker(10, 'backward'), marker(300, 'forward', 200)])
    const targets = platformStopTargets(net, platform, 150)
    expect(targets).toHaveLength(2)
    // Eastwards, 150 m: the marker for trains up to 200 m, at x = 1100 on the rail laid backwards (t falls going east)
    expect(targets[0]).toMatchObject({ segId: east.id, forward: false, platformId: platform.id, edge: 0, marker: 2, ref: '1' })
    expect(targets[0].t).toBeCloseTo(0.9, 9)
    // Westwards: the one at x = 810 on the first rail, run towards its start
    expect(targets[1]).toMatchObject({ segId: west.id, forward: false, marker: 1 })
    expect(targets[1].t).toBeCloseTo(0.81, 9)
    // A longer train eastwards: the marker for every train
    expect(platformStopTargets(net, platform, 250)[0]).toMatchObject({ segId: east.id, marker: 0 })
    expect(stationStopTargets(net, st, 250)).toHaveLength(2)
  })

  it('reads the way a train arrives at an edge', () => {
    const { net, st, west, east } = station([marker(390, 'forward'), marker(10, 'backward')])
    expect(stopTargetOnArrival(net, st, 200, { segId: west.id, t: 0.9, forward: true })?.marker).toBe(0)
    expect(stopTargetOnArrival(net, st, 200, { segId: east.id, t: 0.95, forward: false })?.marker).toBe(0)
    expect(stopTargetOnArrival(net, st, 200, { segId: east.id, t: 0.95, forward: true })?.marker).toBe(1)
    // Off the platform
    expect(stopTargetOnArrival(net, st, 200, { segId: west.id, t: 0.2, forward: true })).toBeNull()
  })

  it('keeps the stops of a station without platforms, for either way', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 1000, y: 0 })
    const rail = addSegment(net, a.id, b.id)!
    const st = addStation(net, { name: 'Halte', pos: { x: 500, y: 0 }, stops: [{ segId: rail.id, t: 0.5, ref: 'A' }, { segId: 's_gone', t: 0.5 }] })
    expect(stationStopGoals(net, st, 200)).toEqual([{ segId: rail.id, t: 0.5, ref: 'A' }])
    expect(stationStopTargets(net, st, 200)).toEqual([])
  })

  it('has nowhere to stop at a station whose platforms have no marker', () => {
    const { net, st } = station([])
    expect(stationStopGoals(net, st, 200)).toEqual([])
  })
})
