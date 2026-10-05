import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, dissolveNode, removeSegment, replaceRail, resetIdCounter, syncIdCounter, generateId } from './network'
import { splitSegment } from './junction'
import { duplicateReplacement } from './trackObjects'
import { performTrackCut } from '../geometry/constructionTemplates'
import { reconcileNetworkIntersections } from '../geometry/reconcile'
import {
  SIGNAL_REFUSAL_TEXT,
  addSignal,
  addSignalPair,
  checkSignalPlacement,
  cleanSignals,
  flipSignal,
  moveSignal,
  removeSignal,
  restoreSignal,
  setSignalOptions,
  setSignalRole,
  signalIndex,
  signalsOnRail,
  signalsRevision,
} from './signals'
import { addSignalRow, signalForwardFor, signalHeading, signalRowPlaces, signalWorldPosition, slideSignal } from '../services/signalLayout'
import type { Network, Signal } from './types'
import { at, chain, line } from './signalling.testkit'

beforeEach(() => resetIdCounter(0))

const only = (net: Network): Signal => {
  expect(net.signals.size).toBe(1)
  return [...net.signals.values()][0]
}

/** Where a signal stands in the world, and the way the trains it speaks to run */
function inWorld(net: Network, signal: Signal) {
  const pos = signalWorldPosition(net, signal)!
  const heading = signalHeading(net, signal)!
  return { x: pos.x, y: pos.y, hx: heading.x, hy: heading.y }
}

function expectSamePlace(net: Network, signal: Signal, before: ReturnType<typeof inWorld>) {
  const now = inWorld(net, signal)
  expect(now.x).toBeCloseTo(before.x, 6)
  expect(now.y).toBeCloseTo(before.y, 6)
  expect(now.hx).toBeCloseTo(before.hx, 6)
  expect(now.hy).toBeCloseTo(before.hy, 6)
}

describe('laying signals', () => {
  it('lays a signal on a rail with its direction and its role', () => {
    const { net, rails } = line(2, 500)
    const laid = addSignal(net, { segId: rails[0].id, t: 0.4 }, true, 'spacing')
    expect(laid.ok).toBe(true)
    const signal = only(net)
    expect(signal).toEqual({ id: signal.id, segId: rails[0].id, t: 0.4, forward: true, role: 'spacing' })
    expect(signal.id).toMatch(/^sig_\d+$/)
  })

  it('refuses a signal off the track, and says why', () => {
    const { net, rails } = line(1, 500)
    expect(addSignal(net, { segId: 'nowhere', t: 0.5 }, true, 'spacing')).toEqual({ ok: false, reason: 'off-track' })
    expect(addSignal(net, { segId: rails[0].id, t: 1.2 }, true, 'spacing')).toEqual({ ok: false, reason: 'off-track' })
    expect(addSignal(net, { segId: rails[0].id, t: NaN }, true, 'spacing')).toEqual({ ok: false, reason: 'off-track' })
    expect(net.signals.size).toBe(0)
    expect(SIGNAL_REFUSAL_TEXT['off-track']).toMatch(/rail/)
  })

  it('refuses a signal on points or on a crossing, and accepts it a little further', () => {
    const net = createNetwork()
    const main = chain(net, [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 1000, y: 0 }])
    chain(net, [{ x: 1000, y: 30 }], main.nodes[1])
    // The node at x = 500 now joins three rails
    expect(checkSignalPlacement(net, { segId: main.rails[0].id, t: 1 }, true)).toBe('on-switch')
    expect(checkSignalPlacement(net, { segId: main.rails[0].id, t: 0.999 }, true)).toBe('on-switch')
    expect(checkSignalPlacement(net, { segId: main.rails[1].id, t: 0.001 }, false)).toBe('on-switch')
    expect(checkSignalPlacement(net, { segId: main.rails[0].id, t: 0.99 }, true)).toBeNull()
    // The far ends are plain ends of track
    expect(checkSignalPlacement(net, { segId: main.rails[0].id, t: 0 }, true)).toBeNull()
    expect(SIGNAL_REFUSAL_TEXT['on-switch']).toMatch(/aiguillage/)
  })

  it('shrinks the clearance with the gauge on a model scale', () => {
    const net = createNetwork()
    const main = chain(net, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }])
    chain(net, [{ x: 2, y: 0.1 }], main.nodes[1])
    const place = { segId: main.rails[0].id, t: 0.5 }
    expect(checkSignalPlacement(net, place, true)).toBe('on-switch')
    expect(checkSignalPlacement(net, place, true, { gauge: 0.0165 })).toBeNull()
  })

  it('refuses a second signal of the same direction at the same place, not one for the other direction', () => {
    const { net, rails } = line(1, 500)
    const place = { segId: rails[0].id, t: 0.5 }
    expect(addSignal(net, place, true, 'spacing').ok).toBe(true)
    expect(addSignal(net, place, true, 'protection')).toEqual({ ok: false, reason: 'duplicate' })
    expect(addSignal(net, place, false, 'protection').ok).toBe(true)
    expect(net.signals.size).toBe(2)
  })

  it('lays a pair back to back for a track run both ways: two independent signals', () => {
    const { net, rails } = line(1, 500)
    const laid = addSignalPair(net, { segId: rails[0].id, t: 0.5 }, 'spacing')
    expect(laid.ok).toBe(true)
    if (!laid.ok) return
    const [first, second] = laid.signals
    expect(first.forward).toBe(true)
    expect(second.forward).toBe(false)
    expect(first.t).toBe(second.t)
    expect(first.id).not.toBe(second.id)
    // Each lives its own life
    expect(removeSignal(net, first.id)).toBe(true)
    expect(net.signals.has(second.id)).toBe(true)
  })

  it('lays none of a pair when one of the two is refused', () => {
    const { net, rails } = line(1, 500)
    const place = { segId: rails[0].id, t: 0.5 }
    addSignal(net, place, false, 'spacing')
    expect(addSignalPair(net, place, 'spacing')).toEqual({ ok: false, reason: 'duplicate' })
    expect(net.signals.size).toBe(1)
  })

  it('moves, turns, changes and removes a signal', () => {
    const { net, rails } = line(2, 500)
    const laid = addSignal(net, { segId: rails[0].id, t: 0.4 }, true, 'spacing')
    if (!laid.ok) throw new Error('refused')
    const id = laid.signal.id

    expect(moveSignal(net, id, { segId: rails[1].id, t: 0.25 }).ok).toBe(true)
    expect(net.signals.get(id)).toMatchObject({ segId: rails[1].id, t: 0.25, forward: true })
    expect(moveSignal(net, id, { segId: 'nowhere', t: 0.5 })).toEqual({ ok: false, reason: 'off-track' })
    expect(net.signals.get(id)).toMatchObject({ segId: rails[1].id, t: 0.25 })

    expect(flipSignal(net, id).ok).toBe(true)
    expect(net.signals.get(id)!.forward).toBe(false)

    expect(setSignalRole(net, id, 'protection')).toBe(true)
    expect(net.signals.get(id)!.role).toBe('protection')
    expect(setSignalRole(net, 'none', 'protection')).toBe(false)

    expect(removeSignal(net, id)).toBe(true)
    expect(removeSignal(net, id)).toBe(false)
    expect(net.signals.size).toBe(0)
  })

  it('does not turn a signal onto another one', () => {
    const { net, rails } = line(1, 500)
    const pair = addSignalPair(net, { segId: rails[0].id, t: 0.5 }, 'spacing')
    if (!pair.ok) throw new Error('refused')
    expect(flipSignal(net, pair.signals[0].id)).toEqual({ ok: false, reason: 'duplicate' })
    expect(pair.signals[0].forward).toBe(true)
  })

  it('keeps the options of the pro level whatever is changed around them', () => {
    const { net, rails } = line(1, 500)
    const laid = addSignal(net, { segId: rails[0].id, t: 0.4 }, true, 'spacing', { cabMarker: true })
    if (!laid.ok) throw new Error('refused')
    const signal = laid.signal
    expect(signal.cabMarker).toBe(true)
    expect('oneWay' in signal).toBe(false)

    setSignalOptions(net, signal.id, { oneWay: true })
    expect(signal).toMatchObject({ cabMarker: true, oneWay: true })
    setSignalRole(net, signal.id, 'protection')
    flipSignal(net, signal.id)
    expect(signal).toMatchObject({ cabMarker: true, oneWay: true, role: 'protection', forward: false })
    setSignalOptions(net, signal.id, { cabMarker: false })
    expect('cabMarker' in signal).toBe(false)
    expect(signal.oneWay).toBe(true)
  })
})

describe('rail → signals index', () => {
  it('lists the signals of a rail in order along it, and nothing for a rail without signal', () => {
    const { net, rails } = line(2, 500)
    const far = addSignal(net, { segId: rails[0].id, t: 0.8 }, true, 'spacing')
    const near = addSignal(net, { segId: rails[0].id, t: 0.2 }, false, 'spacing')
    if (!far.ok || !near.ok) throw new Error('refused')
    expect(signalsOnRail(net, rails[0].id).map((s) => s.id)).toEqual([near.signal.id, far.signal.id])
    expect(signalsOnRail(net, rails[1].id)).toEqual([])
  })

  it('is kept between reads and rebuilt when a signal changes', () => {
    const { net, rails } = line(2, 500)
    const laid = addSignal(net, { segId: rails[0].id, t: 0.5 }, true, 'spacing')
    if (!laid.ok) throw new Error('refused')
    const index = signalIndex(net)
    const revision = signalsRevision(net)
    expect(signalIndex(net)).toBe(index)
    expect(signalsRevision(net)).toBe(revision)

    // A change that changes nothing keeps it
    setSignalRole(net, laid.signal.id, 'spacing')
    moveSignal(net, laid.signal.id, { segId: rails[0].id, t: 0.5 })
    expect(signalsRevision(net)).toBe(revision)

    moveSignal(net, laid.signal.id, { segId: rails[1].id, t: 0.5 })
    expect(signalsRevision(net)).toBeGreaterThan(revision)
    expect(signalIndex(net)).not.toBe(index)
    expect(signalsOnRail(net, rails[0].id)).toEqual([])
    expect(signalsOnRail(net, rails[1].id)).toHaveLength(1)
  })
})

describe('a signal stays where it is when its track is edited', () => {
  function withSignal(forward: boolean) {
    const { net, rails, nodes } = line(3, 300)
    const laid = addSignal(net, { segId: rails[1].id, t: 0.25 }, forward, 'protection', { cabMarker: true })
    if (!laid.ok) throw new Error('refused')
    return { net, rails, nodes, signal: laid.signal, before: inWorld(net, laid.signal) }
  }

  it.each([true, false])('when the scissors cut its rail on either side of it (forward = %s)', (forward) => {
    for (const x of [320, 520]) {
      resetIdCounter(0)
      const { net, rails, signal, before } = withSignal(forward)
      expect(performTrackCut(net, { x, y: 0 })).toBe(true)
      expect(net.segments.has(rails[1].id)).toBe(false)
      expect(net.signals.get(signal.id)).toBe(signal)
      expect(net.segments.has(signal.segId)).toBe(true)
      expectSamePlace(net, signal, before)
      expect(signal).toMatchObject({ role: 'protection', cabMarker: true })
    }
  })

  it('when its rail is split by a turnout or a crossing', () => {
    const { net, rails, signal, before } = withSignal(true)
    expect(splitSegment(net, rails[1].id, { x: 500, y: 0 })).not.toBeNull()
    expectSamePlace(net, signal, before)
    expect(signalsOnRail(net, signal.segId)).toEqual([signal])
  })

  it('when a node of its track is dissolved and two rails become one', () => {
    const { net, nodes, signal, before } = withSignal(false)
    const merged = dissolveNode(net, nodes[1].id)
    expect(merged).not.toBeNull()
    expect(signal.segId).toBe(merged!.id)
    expectSamePlace(net, signal, before)
  })

  it('when its rail is replaced by one that runs the other way: it turns with it', () => {
    const { net, rails, nodes, signal, before } = withSignal(true)
    // The same rail laid from the other end takes its place
    const old = rails[1]
    const survivor = { id: generateId('s'), from: nodes[2].id, to: nodes[1].id, kind: 'straight' as const }
    net.segments.set(survivor.id, survivor)
    net.adjacency.get(nodes[1].id)!.push(survivor.id)
    net.adjacency.get(nodes[2].id)!.push(survivor.id)
    replaceRail(net, duplicateReplacement(old, survivor))
    expect(signal.segId).toBe(survivor.id)
    expect(signal.forward).toBe(false)
    expect(signal.t).toBeCloseTo(0.75, 9)
    expectSamePlace(net, signal, before)
  })

  it('when the reconcile pass cuts its rail where another track meets it', () => {
    const { net, signal, before } = withSignal(true)
    chain(net, [{ x: 600, y: -200 }, { x: 600, y: 0 }])
    reconcileNetworkIntersections(net, 0.5)
    expect(net.signals.get(signal.id)).toBe(signal)
    expectSamePlace(net, signal, before)
  })

  it('and goes with its rail when the rail is removed', () => {
    const { net, rails, signal } = withSignal(true)
    const other = addSignal(net, { segId: rails[0].id, t: 0.5 }, true, 'spacing')
    const revision = signalsRevision(net)
    removeSegment(net, rails[1].id)
    expect(net.signals.has(signal.id)).toBe(false)
    expect(other.ok && net.signals.has(other.signal.id)).toBe(true)
    expect(signalsRevision(net)).toBeGreaterThan(revision)
    expect(signalsOnRail(net, rails[1].id)).toEqual([])
  })

  it('cleanSignals drops what is left on a rail taken out by other means', () => {
    const { net, rails, signal } = withSignal(true)
    expect(cleanSignals(net)).toBe(false)
    net.segments.delete(rails[1].id)
    expect(cleanSignals(net)).toBe(true)
    expect(net.signals.has(signal.id)).toBe(false)
  })
})

describe('signals read from a save', () => {
  it('restores a signal under its id and skips a record that does not hold together', () => {
    const { net, rails } = line(1, 500)
    expect(restoreSignal(net, { id: 'sig_7', segId: rails[0].id, t: 0.5, forward: false, role: 'protection', oneWay: true })).toBe(true)
    expect(net.signals.get('sig_7')).toEqual({ id: 'sig_7', segId: rails[0].id, t: 0.5, forward: false, role: 'protection', oneWay: true })
    // Same id again, missing fields, wrong types
    expect(restoreSignal(net, { id: 'sig_7', segId: rails[0].id, t: 0.1, forward: true, role: 'spacing' })).toBe(false)
    expect(restoreSignal(net, { id: 'sig_8', segId: rails[0].id, t: '0.5', forward: true })).toBe(false)
    expect(restoreSignal(net, { id: 'sig_8', segId: rails[0].id, t: 0.5 })).toBe(false)
    expect(restoreSignal(net, null)).toBe(false)
    // An unknown role falls back on a block signal
    expect(restoreSignal(net, { id: 'sig_9', segId: rails[0].id, t: 0.2, forward: true, role: 'whatever' })).toBe(true)
    expect(net.signals.get('sig_9')!.role).toBe('spacing')
    expect(net.signals.size).toBe(2)
  })

  it('the id counter knows the signals', () => {
    const { net, rails } = line(1, 500)
    restoreSignal(net, { id: 'sig_900', segId: rails[0].id, t: 0.5, forward: true, role: 'spacing' })
    syncIdCounter(net)
    expect(generateId('n')).toBe('n_901')
  })
})

describe('laying along the track', () => {
  /** Two rails end to end along y = 0, the second laid from its far end: it runs against the first */
  function opposedRails() {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 500, y: 0 })
    const c = addNode(net, { x: 1000, y: 0 })
    const first = addSegment(net, a.id, b.id)!
    const second = addSegment(net, c.id, b.id)!
    return { net, first, second }
  }

  it('reads the direction of a new signal from a direction of the world', () => {
    const { net, first, second } = opposedRails()
    expect(signalForwardFor(net, { segId: first.id, t: 0.5 }, { x: 1, y: 0 })).toBe(true)
    expect(signalForwardFor(net, { segId: second.id, t: 0.5 }, { x: 1, y: 0 })).toBe(false)
    expect(signalForwardFor(net, { segId: second.id, t: 0.5 }, { x: -1, y: 0 })).toBe(true)
  })

  it('slides a signal along the track and keeps the direction of travel it speaks to', () => {
    const { net, first, second } = opposedRails()
    const laid = addSignal(net, { segId: first.id, t: 0.5 }, true, 'spacing')
    if (!laid.ok) throw new Error('refused')
    const signal = laid.signal
    expect(signalHeading(net, signal)!.x).toBeCloseTo(1)

    expect(slideSignal(net, signal.id, at(net, 800)).ok).toBe(true)
    expect(signal.segId).toBe(second.id)
    expect(signal.forward).toBe(false)
    expect(signalWorldPosition(net, signal)!.x).toBeCloseTo(800)
    expect(signalHeading(net, signal)!.x).toBeCloseTo(1)

    // And back, against the direction it speaks to
    expect(slideSignal(net, signal.id, at(net, 100)).ok).toBe(true)
    expect(signal.segId).toBe(first.id)
    expect(signalHeading(net, signal)!.x).toBeCloseTo(1)
  })

  it('refuses to slide a signal to a track it cannot reach', () => {
    const { net, first } = opposedRails()
    const island = chain(net, [{ x: 0, y: 100 }, { x: 500, y: 100 }])
    const laid = addSignal(net, { segId: first.id, t: 0.5 }, true, 'spacing')
    if (!laid.ok) throw new Error('refused')
    expect(slideSignal(net, laid.signal.id, { segId: island.rails[0].id, t: 0.5 })).toEqual({ ok: false, reason: 'off-track' })
    expect(laid.signal.segId).toBe(first.id)
  })

  it('lays a row of signals at a regular spacing, all for the direction of the row', () => {
    const { net } = opposedRails()
    expect(signalRowPlaces(net, at(net, 100), at(net, 900), 200)).toHaveLength(5)
    const row = addSignalRow(net, at(net, 100), at(net, 900), 200, 'spacing')
    expect(row.refused).toEqual([])
    expect(row.signals.map((s) => Math.round(signalWorldPosition(net, s)!.x))).toEqual([100, 300, 500, 700, 900])
    for (const signal of row.signals) expect(signalHeading(net, signal)!.x).toBeCloseTo(1)
  })

  it('lays the row both ways when asked, and reports the places it had to skip', () => {
    const { net } = opposedRails()
    const row = addSignalRow(net, at(net, 900), at(net, 100), 400, 'protection', { bothWays: true })
    expect(row.signals).toHaveLength(6)
    expect(row.signals.filter((s) => signalHeading(net, s)!.x < 0)).toHaveLength(3)
    const again = addSignalRow(net, at(net, 900), at(net, 100), 400, 'protection')
    expect(again.signals).toEqual([])
    expect(again.refused.map((r) => r.reason)).toEqual(['duplicate', 'duplicate', 'duplicate'])
  })
})
