import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, resetIdCounter } from './network'
import { addSpeedZoneBetween } from '../services/speedZoneLayout'
import { MAX_BLOCK_LENGTH, signalReport } from './signalReport'
import type { LineSettings } from './speedLimits'
import { at, chain, crossoverLayout, junctionAt, line, signalAt, singleTrackLayout } from './signalling.testkit'
import { LONE_SIGNAL_REACH } from './signalReport'
import { addSignal } from './signals'

beforeEach(() => resetIdCounter(0))

const CLASSIC_160: LineSettings = { lineSpeed: 160, lineType: 'classic' }

describe('signalling report', () => {
  it('says nothing of a network without signal', () => {
    const { net } = line(4, 500)
    expect(signalReport(net)).toEqual([])
  })

  it('reports a block shorter than the stopping distance at the limit that applies at its signal', () => {
    const { net } = line(12, 500)
    // 160 km/h: 44.4² / (2 × 0.7) = 1 411 m
    const short = signalAt(net, 1000.5, 0, 'east')
    const long = signalAt(net, 2000.5, 0, 'east')
    signalAt(net, 4000.5, 0, 'east')
    signalAt(net, 5999, 0, 'east')
    const report = signalReport(net, { line: CLASSIC_160 })
    const entry = report.find((e) => e.signalId === short.id)!
    expect(entry).toMatchObject({ type: 'block-too-short', segId: short.segId, t: short.t, speed: 160 })
    expect(entry.length).toBeCloseTo(1000, 6)
    expect(entry.stoppingDistance).toBeCloseTo((160 / 3.6) ** 2 / 1.4, 6)
    expect(entry.message).toMatch(/^Canton trop court : 1.000 m pour 1.411 m d’arrêt à 160 km\/h$/)
    expect(report.some((e) => e.signalId === long.id)).toBe(false)

    // Under a zone at 90 km/h (446 m to stop) the same block is long enough
    addSpeedZoneBetween(net, at(net, 800), at(net, 2100), 90)
    expect(signalReport(net, { line: CLASSIC_160 }).some((e) => e.signalId === short.id)).toBe(false)
  })

  it('reports a block of more than 2 800 m at the pro level only', () => {
    const { net } = line(12, 500)
    const first = signalAt(net, 500.5, 0, 'east')
    signalAt(net, 3500.5, 0, 'east')
    expect(MAX_BLOCK_LENGTH).toBe(2800)
    expect(signalReport(net, { level: 'standard' }).filter((e) => e.type === 'block-too-long')).toEqual([])
    const entries = signalReport(net, { level: 'pro' }).filter((e) => e.type === 'block-too-long')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ signalId: first.id, segId: first.segId, t: first.t })
    expect(entries[0].length).toBeCloseTo(3000, 6)
    expect(entries[0].message).toMatch(/^Canton trop long : 3.000 m \(2.800 m au plus\)$/)
  })

  it('reports points met by their toe in the block of a block signal, not behind a path signal', () => {
    const net = createNetwork()
    const main = chain(net, [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 6000, y: 0 }])
    chain(net, [{ x: 3400, y: 20 }, { x: 6000, y: 20 }], main.nodes[1])
    const junction = junctionAt(net, main.nodes[1])
    const entry = signalAt(net, 500, 0, 'east', 'spacing')

    const found = signalReport(net).filter((e) => e.type === 'unprotected-switch')
    expect(found).toEqual([
      {
        type: 'unprotected-switch',
        segId: main.rails[0].id,
        t: 1,
        signalId: entry.id,
        nodeId: main.nodes[1].id,
        junctionId: junction.id,
        message: 'Aiguille abordée par la pointe sans signal de protection en amont',
      },
    ])

    // A path signal before the points: nothing left to say about them
    signalAt(net, 2900, 0, 'east', 'protection')
    expect(signalReport(net).filter((e) => e.type === 'unprotected-switch')).toEqual([])
  })

  it('does not report points met by their heel, and reports each node once', () => {
    const layout = crossoverLayout()
    const { net } = layout
    // The layout has path signals before its points: turn them into block signals
    layout.pa.role = 'spacing'
    layout.pb.role = 'spacing'
    const found = signalReport(net).filter((e) => e.type === 'unprotected-switch')
    // Only the points on A part two routes for eastbound trains; those on B are met by the heel
    expect(found.map((e) => e.nodeId)).toEqual([layout.forkA.id])
  })

  it('reports a crossing in the block of a block signal', () => {
    // Two tracks through one node: west to east and south to north
    const net = createNetwork()
    const westEast = chain(net, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }])
    const node = westEast.nodes[1]
    const south = addNode(net, { x: 1000, y: -1000 })
    const north = addNode(net, { x: 1000, y: 1000 })
    addSegment(net, south.id, node.id)
    addSegment(net, node.id, north.id)

    const entry = signalAt(net, 500, 0, 'east')
    const found = signalReport(net).filter((e) => e.type === 'unprotected-switch')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ signalId: entry.id, nodeId: node.id, message: 'Croisement sans signal de protection en amont' })
  })
})

describe('signalling report: a block signal alone on a track signalled both ways', () => {
  const lone = (net: Parameters<typeof signalReport>[0], options = {}) =>
    signalReport(net, options).filter((entry) => entry.type === 'lone-signal')

  it('reports the block signal that has no signal of the other direction near it', () => {
    const { net } = line(1, 6000)
    const alone = signalAt(net, 1000, 0, 'east')
    const east = signalAt(net, 3000, 0, 'east')
    const west = signalAt(net, 3000, 0, 'west')
    const entries = lone(net)
    expect(entries.map((entry) => entry.signalId)).toEqual([alone.id])
    expect(entries[0]).toMatchObject({ type: 'lone-signal', segId: alone.segId, t: alone.t })
    expect(entries[0].message).toMatch(/^Signal isolé sur une voie signalée dans les deux sens/)
    // The pair at 3000 goes together
    expect(entries.some((entry) => entry.signalId === east.id || entry.signalId === west.id)).toBe(false)
    // Its opposite number laid, nothing is left to say
    signalAt(net, 1000, 0, 'west')
    expect(lone(net)).toEqual([])
  })

  it('takes two signals within 100 m of each other as a pair, at the gauge of the project', () => {
    const { net } = line(1, 6000)
    const east = signalAt(net, 3000, 0, 'east')
    const west = signalAt(net, 3000 + LONE_SIGNAL_REACH - 1, 0, 'west')
    expect(lone(net)).toEqual([])
    // On a model scale the reach shrinks with the gauge: the same two are too far apart
    const ho = { line: { lineSpeed: 160, lineType: 'classic' as const, gauge: 0.0165 } }
    expect(lone(net, ho).map((entry) => entry.signalId).sort()).toEqual([east.id, west.id].sort())
    const { net: far } = line(1, 6000)
    signalAt(far, 3000, 0, 'east')
    signalAt(far, 3000 + LONE_SIGNAL_REACH + 1, 0, 'west')
    expect(lone(far)).toHaveLength(2)
  })

  it('a track signalled for one direction only is never reported: nothing says it is run both ways', () => {
    // A double track, one direction per track
    const net = createNetwork()
    chain(net, [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 6000, y: 0 }])
    chain(net, [{ x: 0, y: 20 }, { x: 3000, y: 20 }, { x: 6000, y: 20 }])
    for (const x of [500, 2000, 3500, 5000]) {
      signalAt(net, x, 0, 'east')
      signalAt(net, x + 300, 20, 'west')
    }
    expect(lone(net)).toEqual([])
    // With a crossover between the two tracks and its path signals: still one direction per track
    const { net: crossed } = crossoverLayout()
    expect(lone(crossed)).toEqual([])
  })

  it('a passing loop signalled by the book — exits and entries, six path signals — is not reported', () => {
    const layout = singleTrackLayout()
    // The single track carries an entry signal for each direction, far apart: path signals stand alone by design
    expect(layout.entryEast.forward).not.toBe(layout.entryWest.forward)
    expect(signalReport(layout.net).filter((entry) => entry.type === 'lone-signal')).toEqual([])
    expect(signalReport(layout.net, { level: 'pro' }).filter((entry) => entry.type === 'lone-signal')).toEqual([])
    // A block signal dropped in the middle of the single track, for one direction only, is
    const middle = signalAt(layout.net, 2000, 0, 'east')
    expect(lone(layout.net).map((entry) => entry.signalId)).toEqual([middle.id])
    signalAt(layout.net, 2000, 0, 'west')
    expect(lone(layout.net)).toEqual([])
  })

  it('follows the plain track over its rails whichever way they were laid, and stops at points', () => {
    // Three rails in a row, the middle one laid east to west; points at x = 4000
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 1000, y: 0 })
    const c = addNode(net, { x: 2000, y: 0 })
    const d = addNode(net, { x: 4000, y: 0 })
    const e = addNode(net, { x: 6000, y: 0 })
    const f = addNode(net, { x: 6000, y: 200 })
    addSegment(net, a.id, b.id)
    const reversed = addSegment(net, c.id, b.id)!
    addSegment(net, c.id, d.id)
    addSegment(net, d.id, e.id)
    addSegment(net, d.id, f.id)
    // Eastbound at x = 1020 on the reversed rail (`forward` false there), westbound at x = 2040 on the third rail
    const east = addSignal(net, { segId: reversed.id, t: 0.98 }, false, 'spacing')
    const west = signalAt(net, 2040, 0, 'west')
    if (!east.ok) throw new Error(east.reason)
    // 1 020 m apart along the track: each stands alone
    expect(lone(net).map((entry) => entry.signalId).sort()).toEqual([east.signal.id, west.id].sort())
    // A westbound signal 40 m from the eastbound one, on the first rail: a pair across the joint
    const near = signalAt(net, 980, 0, 'west')
    expect(lone(net).map((entry) => entry.signalId)).toEqual([west.id])
    expect(near.segId).not.toBe(reversed.id)
    // Beyond the points the track is another one: a westbound signal there says nothing of this one
    const { net: split } = line(1, 3000)
    const tail = chain(split, [{ x: 5000, y: 0 }], [...split.nodes.values()][1])
    chain(split, [{ x: 5000, y: 200 }], [...split.nodes.values()][1])
    signalAt(split, 1000, 0, 'east')
    signalAt(split, 4000, 0, 'west')
    expect(tail.rails).toHaveLength(1)
    expect(lone(split)).toEqual([])
  })
})

describe('signalling report: a signal too near points built after it', () => {
  it('reports the signal that could not be pushed back', () => {
    const { net, nodes } = line(2, 1000)
    const signal = signalAt(net, 999, 0, 'east')
    expect(signalReport(net).some((entry) => entry.type === 'signal-on-switch')).toBe(false)
    // A branch is laid from the joint at x = 1000: the signal now stands 1 m before points
    chain(net, [{ x: 2000, y: 200 }], nodes[1])
    const entry = signalReport(net).find((e) => e.type === 'signal-on-switch')
    expect(entry).toMatchObject({ signalId: signal.id, segId: signal.segId, t: signal.t })
    expect(entry!.message).toMatch(/^Signal trop près d’un aiguillage/)
  })
})

