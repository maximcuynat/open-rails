import { beforeEach, describe, expect, it } from 'vitest'
import { resetIdCounter } from '../models/network'
import { syncJunctions } from '../models/junction'
import { SIGNAL_SWITCH_CLEARANCE, checkSignalPlacement, signalsRevision } from '../models/signals'
import { signalReport } from '../models/signalReport'
import { chain, line, signalAt } from '../models/signalling.testkit'
import { moveSignalsOffSwitches, signalWorldPosition } from './signalLayout'

beforeEach(() => resetIdCounter(0))

/** Two rails along y = 0 joined at x = 1000; `branch()` lays a third rail from that joint, making points of it */
function track() {
  const { net, nodes, rails } = line(2, 1000)
  return {
    net,
    nodes,
    rails,
    /** Points facing eastbound trains: a branch leaving the joint towards the east */
    branchEast: () => {
      const laid = chain(net, [{ x: 2000, y: 150 }], nodes[1])
      syncJunctions(net)
      return laid.rails[0]
    },
    /** Points trailing for eastbound trains: a branch joining from the west */
    branchWest: () => {
      const laid = chain(net, [{ x: 0, y: 150 }], nodes[1])
      syncJunctions(net)
      return laid.rails[0]
    },
  }
}

const xOf = (net: Parameters<typeof signalWorldPosition>[0], signal: Parameters<typeof signalWorldPosition>[1]) => signalWorldPosition(net, signal)!.x

describe('signals pushed back off points built after them', () => {
  it('points right ahead of a signal: it goes back along its approach to the clearance, on its own rail', () => {
    const t = track()
    const east = signalAt(t.net, 999, 0, 'east')
    const west = signalAt(t.net, 1001, 0, 'west')
    expect(moveSignalsOffSwitches(t.net)).toEqual({ moved: [], stuck: [] })
    t.branchEast()
    expect(checkSignalPlacement(t.net, east, east.forward, { ignoreId: east.id })).toBe('on-switch')

    expect(moveSignalsOffSwitches(t.net)).toEqual({ moved: [east.id, west.id], stuck: [] })
    // 2 m before the points, each on the side its trains come from
    expect(xOf(t.net, east)).toBeCloseTo(1000 - SIGNAL_SWITCH_CLEARANCE, 2)
    expect(xOf(t.net, east)).toBeLessThan(1000 - SIGNAL_SWITCH_CLEARANCE)
    expect(xOf(t.net, west)).toBeCloseTo(1000 + SIGNAL_SWITCH_CLEARANCE, 2)
    expect(east.segId).toBe(t.rails[0].id)
    expect(west.segId).toBe(t.rails[1].id)
    expect(east.forward).toBe(true)
    expect(west.forward).toBe(false)
    expect(checkSignalPlacement(t.net, east, east.forward, { ignoreId: east.id })).toBeNull()
    expect(signalReport(t.net).some((entry) => entry.type === 'signal-on-switch')).toBe(false)
    // Nothing more to do: not a signal is touched
    const revision = signalsRevision(t.net)
    expect(moveSignalsOffSwitches(t.net)).toEqual({ moved: [], stuck: [] })
    expect(signalsRevision(t.net)).toBe(revision)
  })

  it('points right behind a signal on a branch: it goes back across them onto the stem', () => {
    const t = track()
    // Eastbound, 1 m past the joint: once the branch is laid the points are behind it
    const signal = signalAt(t.net, 1001, 0, 'east')
    t.branchEast()
    expect(moveSignalsOffSwitches(t.net)).toEqual({ moved: [signal.id], stuck: [] })
    // On the stem now, before the points, still speaking to eastbound trains
    expect(signal.segId).toBe(t.rails[0].id)
    expect(xOf(t.net, signal)).toBeCloseTo(1000 - SIGNAL_SWITCH_CLEARANCE, 2)
    expect(signal.forward).toBe(true)
  })

  it('two rails lead to the signal from behind: it stays, and the report names it', () => {
    const t = track()
    // Eastbound, 1 m past the joint, on the stem of points trailing for it: its trains come by either branch
    const signal = signalAt(t.net, 1001, 0, 'east')
    t.branchWest()
    expect(moveSignalsOffSwitches(t.net)).toEqual({ moved: [], stuck: [signal.id] })
    expect(xOf(t.net, signal)).toBeCloseTo(1001, 6)
    expect(signalReport(t.net).find((entry) => entry.type === 'signal-on-switch')).toMatchObject({ signalId: signal.id })
  })

  it('a rail too short to hold it clear of both ends: it stays', () => {
    const { net, nodes } = line(1, 1000)
    // A 3 m rail between two joints that both become points
    const short = chain(net, [{ x: 1003, y: 0 }, { x: 2000, y: 0 }], nodes[1])
    const signal = signalAt(net, 1001.5, 0, 'east')
    chain(net, [{ x: 2000, y: 150 }], short.nodes[1])
    chain(net, [{ x: 0, y: 150 }], nodes[1])
    syncJunctions(net)
    expect(moveSignalsOffSwitches(net)).toEqual({ moved: [], stuck: [signal.id] })
    expect(xOf(net, signal)).toBeCloseTo(1001.5, 6)
  })

  it('another signal of the same direction already stands where it would go: it stays', () => {
    const t = track()
    const signal = signalAt(t.net, 999, 0, 'east')
    const inTheWay = signalAt(t.net, 998, 0, 'east')
    t.branchEast()
    expect(moveSignalsOffSwitches(t.net)).toEqual({ moved: [], stuck: [signal.id] })
    expect(xOf(t.net, inTheWay)).toBeCloseTo(998, 6)
  })

  it('the clearance follows the gauge of the project', () => {
    const t = track()
    const signal = signalAt(t.net, 999.5, 0, 'east')
    t.branchEast()
    // In HO the clearance is 2 × 16.5 / 1435 = 0.023 m: the signal stands clear
    expect(moveSignalsOffSwitches(t.net, { gauge: 0.0165 })).toEqual({ moved: [], stuck: [] })
    expect(moveSignalsOffSwitches(t.net)).toEqual({ moved: [signal.id], stuck: [] })
  })
})
