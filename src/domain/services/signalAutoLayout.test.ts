import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_BLOCK_LENGTH, LONGEST_BLOCK, MIN_SIGNALLED_STRETCH, PROTECTION_SETBACK, blockCount, layAutomaticSignals, plainStretches } from './signalAutoLayout'
import { signalHeading, signalWorldPosition } from './signalLayout'
import { syncJunctions } from '../models/junction'
import { addNode, addSegment, createNetwork, resetIdCounter } from '../models/network'
import { signalBlocks } from '../models/signalBlocks'
import { MAX_BLOCK_LENGTH, signalReport } from '../models/signalReport'
import { addSignal, checkSignalPlacement } from '../models/signals'
import type { Network, Point, Signal } from '../models/types'

/** Rails through the points, a node at each; returns the ids of the nodes */
function lay(net: Network, points: Point[], from?: string): string[] {
  const ids = from ? [from] : []
  for (const point of points) {
    const node = addNode(net, point)
    const prev = ids[ids.length - 1]
    if (prev) addSegment(net, prev, node.id)
    ids.push(node.id)
  }
  return ids
}

/** A straight line along y = 0 from x = 0 to `length`, in rails of `rail` metres */
function line(length: number, rail = 100): Network {
  const net = createNetwork()
  lay(net, Array.from({ length: Math.round(length / rail) + 1 }, (_, i) => ({ x: i * rail, y: 0 })))
  return net
}

/**
 * A turnout at (0, 0): the stem runs west as far as −`stem`, the main branch east as far as
 * `main`, the other branch leaves north-east as far as x = `branch`.
 */
function turnout(stem: number, main: number, branch: number): Network {
  const net = createNetwork()
  const [points] = lay(net, [{ x: 0, y: 0 }])
  const steps = (to: number): number[] => Array.from({ length: Math.ceil(Math.abs(to) / 100) }, (_, i) => Math.sign(to) * Math.min(Math.abs(to), (i + 1) * 100))
  lay(net, steps(-stem).map((x) => ({ x, y: 0 })), points)
  lay(net, steps(main).map((x) => ({ x, y: 0 })), points)
  lay(net, steps(branch).map((x) => ({ x, y: -x * 0.05 })), points)
  syncJunctions(net)
  return net
}

const at = (net: Network, signal: Signal): Point => signalWorldPosition(net, signal)!
const eastbound = (net: Network, signal: Signal): boolean => signalHeading(net, signal)!.x > 0
const reportTypes = (net: Network): string[] => [...new Set(signalReport(net, { level: 'pro' }).map((entry) => entry.type))].sort()

describe('blockCount', () => {
  it('cuts plain track into blocks at least as long as the stopping distance, and as the default block', () => {
    // 160 km/h: 1 411 m to stop, under the default block
    expect(blockCount(1400, 160)).toBe(1)
    expect(blockCount(2900, 160)).toBe(2)
    expect(blockCount(6000, 160)).toBe(4)
    // 200 km/h: 2 205 m to stop
    expect(blockCount(6000, 200)).toBe(3)
    expect(blockCount(6000, 30)).toBe(4)
  })

  it('never makes a block longer than the longest allowed, even where a train needs more to stop', () => {
    // 300 km/h: 4 960 m to stop
    expect(blockCount(6000, 300)).toBe(Math.ceil(6000 / LONGEST_BLOCK))
    expect(6000 / blockCount(6000, 300)).toBeLessThanOrEqual(MAX_BLOCK_LENGTH)
    // 220 km/h: 2 668 m to stop; one block of 2 600 m would do
    expect(blockCount(2600, 220)).toBe(2)
  })

  it('uses the default block for marker boards, whatever the speed', () => {
    expect(blockCount(6000, 300, true)).toBe(6000 / DEFAULT_BLOCK_LENGTH)
  })

  it('shrinks with the gauge on a model scale', () => {
    expect(blockCount(60, 160, false, 0.01)).toBe(4)
  })
})

describe('plainStretches', () => {
  beforeEach(() => resetIdCounter())

  it('finds one stretch on a line, three around a turnout, each rail in exactly one', () => {
    const plain = plainStretches(line(1000))
    expect(plain).toHaveLength(1)
    expect(plain[0]).toMatchObject({ length: 1000, startsOnSwitch: false, endsOnSwitch: false, closed: false })
    expect(plain[0].rails).toHaveLength(10)

    const net = turnout(1000, 800, 600)
    const around = plainStretches(net)
    expect(around).toHaveLength(3)
    expect(around.map((stretch) => Number(stretch.startsOnSwitch) + Number(stretch.endsOnSwitch))).toEqual([1, 1, 1])
    expect(around.flatMap((stretch) => stretch.rails.map((rail) => rail.segId)).sort()).toEqual([...net.segments.keys()].sort())
  })

  it('reads a loop no points lead to as a closed stretch', () => {
    const net = createNetwork()
    const ids = lay(net, [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }, { x: 0, y: 500 }])
    addSegment(net, ids[3], ids[0])
    const [loop] = plainStretches(net)
    expect(plainStretches(net)).toHaveLength(1)
    expect(loop).toMatchObject({ closed: true, length: 2000, startsOnSwitch: false, endsOnSwitch: false })
  })
})

describe('layAutomaticSignals', () => {
  beforeEach(() => resetIdCounter())

  it('lays block signals in pairs on plain track, and none facing an end of track', () => {
    const net = line(6000)
    const result = layAutomaticSignals(net)
    expect(result).toMatchObject({ refused: 0, stretches: 1, shortStretches: 0, keptStretches: 0 })
    expect(result.signals).toHaveLength(6)
    expect(result.signals.every((signal) => signal.role === 'spacing' && !signal.cabMarker)).toBe(true)
    expect(result.signals.map((signal) => Math.round(at(net, signal).x)).sort((a, b) => a - b)).toEqual([1500, 1500, 3000, 3000, 4500, 4500])
    expect(result.signals.filter((signal) => eastbound(net, signal))).toHaveLength(3)
    expect(reportTypes(net)).toEqual([])
  })

  it('lays nothing on a line shorter than a block, which has no points to guard', () => {
    const net = line(1200)
    expect(layAutomaticSignals(net).signals).toHaveLength(0)
  })

  it('lays a path signal before the points on each track that leads to them, for the trains that run towards them', () => {
    const net = turnout(1000, 800, 600)
    const result = layAutomaticSignals(net)
    expect(result.refused).toBe(0)
    expect(result.signals).toHaveLength(3)
    expect(result.signals.every((signal) => signal.role === 'protection')).toBe(true)
    for (const signal of result.signals) {
      const pos = at(net, signal)
      expect(Math.hypot(pos.x, pos.y)).toBeCloseTo(PROTECTION_SETBACK, 0)
      // Every one of them speaks to the trains that run towards the points
      expect(eastbound(net, signal)).toBe(pos.x < 0)
      expect(checkSignalPlacement(net, signal, signal.forward, { ignoreId: signal.id })).toBeNull()
    }
    expect(reportTypes(net).filter((type) => type !== 'block-too-short')).toEqual([])
  })

  it('cuts a long approach into blocks, the last signal before the points being the path signal', () => {
    const net = turnout(6000, 800, 600)
    const result = layAutomaticSignals(net)
    const onStem = result.signals.filter((signal) => at(net, signal).x < 0).map((signal) => ({ x: Math.round(at(net, signal).x), role: signal.role, east: eastbound(net, signal) }))
    // 5 970 m from the end of track to the path signal: three blocks of 1 990 m
    expect(onStem.filter((signal) => signal.east).sort((a, b) => a.x - b.x)).toEqual([
      { x: -4010, role: 'spacing', east: true },
      { x: -2020, role: 'spacing', east: true },
      { x: -30, role: 'protection', east: true },
    ])
    expect(onStem.filter((signal) => !signal.east).sort((a, b) => a.x - b.x)).toEqual([
      { x: -4010, role: 'spacing', east: false },
      { x: -2020, role: 'spacing', east: false },
    ])
    // No block signal has the points in its block, none stands alone, none is on the points
    expect(reportTypes(net).filter((type) => type !== 'block-too-short')).toEqual([])
    for (const block of signalBlocks(net).values()) {
      if (net.signals.get(block.signalId)!.role === 'spacing') expect(block.conflictPoints).toEqual([])
    }
  })

  it('leaves a short stretch between two sets of points without signal', () => {
    const net = createNetwork()
    const [a] = lay(net, [{ x: 0, y: 0 }])
    const [, b] = lay(net, [{ x: MIN_SIGNALLED_STRETCH - 20, y: 0 }], a)
    lay(net, [{ x: -500, y: 0 }], a)
    lay(net, [{ x: -500, y: 25 }], a)
    lay(net, [{ x: 600, y: 0 }], b)
    lay(net, [{ x: 600, y: 25 }], b)
    syncJunctions(net)
    const result = layAutomaticSignals(net)
    expect(result).toMatchObject({ stretches: 5, shortStretches: 1 })
    expect(result.signals).toHaveLength(4)
    expect(result.signals.every((signal) => at(net, signal).x < -20 || at(net, signal).x > MIN_SIGNALLED_STRETCH)).toBe(true)
  })

  it('makes marker boards where the rails are said to be cab-signalled', () => {
    const net = line(6000)
    const result = layAutomaticSignals(net, { line: { lineSpeed: 300, lineType: 'highSpeed' }, cabMarker: () => true })
    expect(result.signals).toHaveLength(6)
    expect(result.signals.every((signal) => signal.cabMarker === true)).toBe(true)
  })

  it('with `keepSignalled`, leaves alone the plain track that already carries a signal', () => {
    const net = turnout(6000, 800, 600)
    const stem = [...net.segments.values()].find((seg) => net.nodes.get(seg.from)!.pos.x <= -3000 && net.nodes.get(seg.to)!.pos.x <= -3000)!
    const own = addSignal(net, { segId: stem.id, t: 0.5 }, true, 'spacing')
    expect(own.ok).toBe(true)
    const result = layAutomaticSignals(net, { keepSignalled: true })
    expect(result.keptStretches).toBe(1)
    // The two branches get their path signal, the stem keeps its one signal
    expect(result.signals).toHaveLength(2)
    expect(result.signals.every((signal) => at(net, signal).x > 0)).toBe(true)
    expect(net.signals.size).toBe(3)

    // Without it the stretch is signalled around what stands there
    const again = layAutomaticSignals(net)
    expect(again.signals.some((signal) => at(net, signal).x < 0)).toBe(true)
  })

  it('touches neither the nodes nor the rails', () => {
    const net = turnout(6000, 800, 600)
    const before = JSON.stringify([[...net.nodes.keys()], [...net.segments.keys()], [...net.junctions.keys()]])
    layAutomaticSignals(net)
    expect(JSON.stringify([[...net.nodes.keys()], [...net.segments.keys()], [...net.junctions.keys()]])).toBe(before)
  })
})
