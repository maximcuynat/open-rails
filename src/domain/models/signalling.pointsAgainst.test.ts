import { describe, it, expect } from 'vitest'
import { addNode, addSegment, createNetwork } from './network'
import { declareDoubleSlip, setDoubleSlipSide } from './junction'
import { setSignalRole, type SignallingLevel } from './signals'
import { signalRoute } from './signalBlocks'
import { createSignallingState, updateSignalling, nodeReservedBy, signalStatus, type SignallingState } from './signalling'
import type { TrainSet } from './train'
import type { Segment, Signal } from './types'
import { crossoverLayout, drive, halt, headX, run, setPoints, signalAt, singleTrackLayout, trainAt } from './signalling.testkit'

/**
 * A route that stops on points set against its train leads nowhere: it is not a route to an end of
 * track. No signal lets a train onto it, and the train does not hold those points — they stay free
 * for the train they are set for, or to be thrown. Found with the example « Voie unique avec
 * évitement », where the train waiting at the exit of the loop used to take the points thrown for
 * the train coming in.
 */

const LEVELS: SignallingLevel[] = ['standard', 'pro']

const stateOf = (state: SignallingState, signal: Signal) => signalStatus(state, signal).state
const causeOf = (state: SignallingState, signal: Signal) => signalStatus(state, signal).cause

/** The farthest a train holds a rail, as a parameter of that rail (-1 when it holds none of it) */
function heldUpTo(state: SignallingState, train: TrainSet, rail: Segment): number {
  const spans = state.trains.get(train.id)!.reservation.spans.filter((span) => span.segId === rail.id)
  return Math.max(-1, ...spans.flatMap((span) => [span.t0, span.t1]))
}

/** The rails a train holds track on */
function heldRails(state: SignallingState, train: TrainSet): Set<string> {
  return new Set(state.trains.get(train.id)!.reservation.spans.map((span) => span.segId))
}

describe('points set against a train waiting at a path signal', () => {
  for (const order of ['waiting train first', 'incoming train first'] as const) {
    it(`are left to the train they were thrown for (${order})`, () => {
      const layout = singleTrackLayout()
      const { net } = layout
      layout.west('main')
      layout.east('main')
      // A westbound train waits on the main track of the east station, at its exit signal; an
      // eastbound one comes along the single track
      const waiting = halt(drive(trainAt(net, 3300, 0, 'west'), 0))
      const incoming = drive(trainAt(net, 2500, 0, 'east'), 10)
      const trains = order === 'waiting train first' ? [waiting, incoming] : [incoming, waiting]
      const state = createSignallingState()
      updateSignalling(net, trains, state)
      expect(stateOf(state, layout.exitEastMain)).toBe('stop')
      expect(stateOf(state, layout.entryEast)).toBe('stop')

      // The points are thrown to the siding for the incoming train
      layout.east('siding')
      updateSignalling(net, trains, state)

      // The exit signal of the waiting train must stay closed — the points are against it — and the
      // incoming train must be given its route into the siding
      expect(stateOf(state, layout.exitEastMain)).toBe('stop')
      expect(nodeReservedBy(state, layout.eastPoints.id)).toBe(incoming.id)
      expect(stateOf(state, layout.entryEast)).not.toBe('stop')
      expect(state.trains.get(waiting.id)!.waitingAt).toBe(layout.exitEastMain.id)
    })
  }

  it('with nobody else about, the signal still stays closed and the points free', () => {
    const layout = singleTrackLayout()
    const { net } = layout
    layout.east('siding')
    const waiting = halt(drive(trainAt(net, 3300, 0, 'west'), 0))
    const state = createSignallingState()
    updateSignalling(net, [waiting], state)

    expect(stateOf(state, layout.exitEastMain)).toBe('stop')
    expect(causeOf(state, layout.exitEastMain)).toBe('no-route')
    expect(nodeReservedBy(state, layout.eastPoints.id)).toBeNull()
    // Put back for it, they are its own and the whole single track with them
    layout.east('main')
    updateSignalling(net, [waiting], state)
    expect(stateOf(state, layout.exitEastMain)).not.toBe('stop')
    expect(nodeReservedBy(state, layout.eastPoints.id)).toBe(waiting.id)
    expect(heldRails(state, waiting)).toContain(layout.single.id)
  })
})

describe('a route that stops on points set against it', () => {
  for (const level of LEVELS) {
    it(`is not given by a path signal, and passing the signal is a fault (${level})`, () => {
      const layout = crossoverLayout()
      const { net, pb, forkB } = layout
      // The trailing points on B are set for the crossover: against a train coming along B
      layout.route('diverging')
      const train = drive(trainAt(net, 700, 20, 'east'), 10)
      const state = createSignallingState()
      const settings = { level, stopEnforced: true }
      updateSignalling(net, [train], state, settings)

      expect(signalRoute(net, pb.id)).toMatchObject({ next: null, endsOnTrackEnd: false, blockedAt: forkB.id })
      expect(stateOf(state, pb)).toBe('stop')
      expect(state.trains.get(train.id)!.waitingAt).toBe(pb.id)
      expect(state.trains.get(train.id)!.grants.size).toBe(0)
      expect(nodeReservedBy(state, forkB.id)).toBeNull()
      // It holds the track up to the signal, nothing beyond
      expect(heldUpTo(state, train, layout.b.rails[0])).toBeCloseTo(pb.t, 9)

      const passings = run(net, [train], state, train, 300, settings)
      expect(passings.map((p) => [p.signalId, p.closed, p.fault])).toEqual([[pb.id, true, true]])
      expect(train.emergencyBrake).toBe(true)
    })

    it(`closes a block signal too, and the one before it shows caution (${level})`, () => {
      const layout = crossoverLayout()
      const { net, pb, forkB } = layout
      setSignalRole(net, pb.id, 'spacing')
      const before = signalAt(net, 300, 20, 'east')
      layout.route('diverging')
      const train = drive(trainAt(net, 700, 20, 'east'), 10)
      const state = createSignallingState()
      // With no train about, it is closed already, and announced
      updateSignalling(net, [], state, { level })
      expect(stateOf(state, pb)).toBe('stop')
      expect(causeOf(state, pb)).toBe('points-against')
      expect(stateOf(state, before)).toBe('caution')
      expect(causeOf(state, before)).toBe('next-stop')

      updateSignalling(net, [train], state, { level })
      expect(stateOf(state, pb)).toBe('stop')
      expect(causeOf(state, pb)).toBe('points-against')
      expect(state.trains.get(train.id)!.grants.size).toBe(0)
      expect(nodeReservedBy(state, forkB.id)).toBeNull()
      expect(heldUpTo(state, train, layout.b.rails[0])).toBeCloseTo(pb.t, 9)

      // Points put back: an ordinary free block again
      layout.route('straight')
      updateSignalling(net, [train], state, { level })
      expect(stateOf(state, pb)).toBe('clear')
      // …that the train is let into once the signal is within its reach, points and all
      run(net, [train], state, train, 100, { level, stopEnforced: true })
      expect(signalStatus(state, pb).clearedFor).toBe(train.id)
      expect(nodeReservedBy(state, forkB.id)).toBe(train.id)
    })
  }

  it('with no signal before them, the train holds the track up to the points but not the points', () => {
    const layout = crossoverLayout()
    const { net, forkB } = layout
    layout.route('diverging')
    // Past the path signal of B, 300 m from the points and fast enough to hold the track that far
    const train = drive(trainAt(net, 1100, 20, 'east'), 30)
    const other = drive(trainAt(net, 700, 0, 'east'), 10)
    const state = createSignallingState()
    // The train heading for the points set against it is listed first: it must not take them
    updateSignalling(net, [train, other], state)

    expect(heldUpTo(state, train, layout.b.rails[0])).toBe(1)
    expect(heldRails(state, train)).toEqual(new Set([layout.b.rails[0].id]))
    // They are held by the train whose route takes them, over the crossover
    expect(nodeReservedBy(state, forkB.id)).toBe(other.id)
    expect(stateOf(state, layout.pa)).not.toBe('stop')

    // Set for it, they are its own
    const alone = createSignallingState()
    layout.route('straight')
    updateSignalling(net, [train], alone)
    expect(nodeReservedBy(alone, forkB.id)).toBe(train.id)
    expect(heldRails(alone, train)).toContain(layout.b.rails[1].id)
  })

  it('a genuine end of track is still a route: the path signal before it opens, at caution', () => {
    const layout = crossoverLayout()
    const { net } = layout
    const last = signalAt(net, 2700, 0, 'east', 'protection')
    const train = drive(trainAt(net, 2600, 0, 'east'), 10)
    const state = createSignallingState()
    updateSignalling(net, [train], state)

    expect(signalRoute(net, last.id)).toMatchObject({ next: null, endsOnTrackEnd: true, blockedAt: null })
    expect(stateOf(state, last)).toBe('caution')
    expect(causeOf(state, last)).toBe('track-end')
    expect(signalStatus(state, last).clearedFor).toBe(train.id)
  })

  it('points met by their toe are never against the train: the signal opens for whichever branch they are set to', () => {
    const layout = crossoverLayout()
    const { net, pa, forkA, forkB } = layout
    const train = drive(trainAt(net, 700, 0, 'east'), 10)
    const state = createSignallingState()
    for (const to of ['straight', 'diverging'] as const) {
      layout.route(to)
      updateSignalling(net, [train], state)
      expect(signalRoute(net, pa.id)!.blockedAt).toBeNull()
      expect(stateOf(state, pa)).not.toBe('stop')
      expect(nodeReservedBy(state, forkA.id)).toBe(train.id)
      // Over the crossover the route takes the points of B by their heel, set for it
      expect(nodeReservedBy(state, forkB.id)).toBe(to === 'diverging' ? train.id : null)
    }
  })

  it('a double slip set for the other rail of the side the train comes by is against it', () => {
    const net = createNetwork()
    const centre = addNode(net, { x: 1000, y: 0 })
    const arm = (x: number, y: number): Segment => addSegment(net, addNode(net, { x, y }).id, centre.id)!
    const [west, westSlip, east, eastSlip] = [arm(0, 0), arm(0, 60), arm(2000, 0), arm(2000, 60)]
    const slip = declareDoubleSlip(net, { nodeId: centre.id, sides: [[west.id, westSlip.id], [east.id, eastSlip.id]] })
    const signal = signalAt(net, 900, 6, 'east', 'protection')
    const train = drive(trainAt(net, 700, 18, 'east'), 10)
    const state = createSignallingState()

    // West points set for the straight rail: the train on the other one finds the device against it
    setDoubleSlipSide(slip, 0, 0)
    updateSignalling(net, [train], state)
    expect(signalRoute(net, signal.id)).toMatchObject({ blockedAt: centre.id, endsOnTrackEnd: false, nodes: [] })
    expect(stateOf(state, signal)).toBe('stop')
    expect(nodeReservedBy(state, centre.id)).toBeNull()

    // Set for its rail, to either rail of the far side: a route, and the device is held
    for (const far of [0, 1]) {
      setDoubleSlipSide(slip, 0, 1)
      setDoubleSlipSide(slip, 1, far)
      updateSignalling(net, [train], state)
      expect(signalRoute(net, signal.id)).toMatchObject({ blockedAt: null, nodes: [centre.id] })
      expect(stateOf(state, signal)).not.toBe('stop')
      expect(nodeReservedBy(state, centre.id)).toBe(train.id)
    }
  })
})

describe('points thrown against a route already given', () => {
  it('before the signal: the route is taken back, the signal closes, the points are let go — and given again when they are put back', () => {
    const layout = crossoverLayout()
    const { net, pb, forkB } = layout
    layout.route('straight')
    const train = drive(trainAt(net, 700, 20, 'east'), 10)
    const state = createSignallingState()
    updateSignalling(net, [train], state)
    expect(signalStatus(state, pb).clearedFor).toBe(train.id)
    expect(nodeReservedBy(state, forkB.id)).toBe(train.id)

    setPoints(net, forkB, layout.crossover, layout.b.rails[1])
    updateSignalling(net, [train], state)
    const record = state.trains.get(train.id)!
    expect(stateOf(state, pb)).toBe('stop')
    expect(signalStatus(state, pb).clearedFor).toBeNull()
    // Nothing is left dangling: no grant, no points, no track beyond the signal — and the train knows it waits
    expect(record.grants.size).toBe(0)
    expect(record.waitingAt).toBe(pb.id)
    expect(record.closedSignal?.id).toBe(pb.id)
    expect(nodeReservedBy(state, forkB.id)).toBeNull()
    expect(state.nodeReservations.size).toBe(0)
    expect(heldUpTo(state, train, layout.b.rails[0])).toBeCloseTo(pb.t, 9)

    setPoints(net, forkB, layout.b.rails[0], layout.b.rails[1])
    updateSignalling(net, [train], state)
    expect(signalStatus(state, pb).clearedFor).toBe(train.id)
    expect(nodeReservedBy(state, forkB.id)).toBe(train.id)
  })

  it('once past the signal: the train keeps the track up to the points, lets the points go and stops at them without a fault', () => {
    const layout = crossoverLayout()
    const { net, pb, forkB } = layout
    layout.route('straight')
    const train = drive(trainAt(net, 700, 20, 'east'), 10)
    const state = createSignallingState()
    updateSignalling(net, [train], state)
    const passed = run(net, [train], state, train, 300)
    expect(passed.map((p) => [p.signalId, p.fault])).toEqual([[pb.id, false]])
    expect(nodeReservedBy(state, forkB.id)).toBe(train.id)

    setPoints(net, forkB, layout.crossover, layout.b.rails[1])
    updateSignalling(net, [train], state)
    expect(nodeReservedBy(state, forkB.id)).toBeNull()
    expect(heldRails(state, train)).toEqual(new Set([layout.b.rails[0].id]))
    expect(heldUpTo(state, train, layout.b.rails[0])).toBe(1)

    // It runs up to the points and no further; nothing is passed, nothing is a fault
    const passings = run(net, [train], state, train, 600)
    expect(passings).toEqual([])
    expect(headX(net, train)).toBeGreaterThan(1380)
    expect(headX(net, train)).toBeLessThanOrEqual(1400)
    expect(train.emergencyBrake).toBe(false)
  })
})

describe('cab signalling ahead of points set against the route', () => {
  const options = { clearance: true, line: { lineSpeed: 300, lineType: 'highSpeed' as const } }
  const clearanceOf = (state: SignallingState, train: TrainSet) => {
    const { blocks, obstacle } = state.trains.get(train.id)!.clearance!
    return { blocks, obstacle }
  }

  it('counts the block up to the closed signal, and reads the stop as absolute whatever the signal', () => {
    for (const role of ['protection', 'spacing'] as const) {
      const layout = crossoverLayout()
      const { net, pb } = layout
      setSignalRole(net, pb.id, role)
      // Near enough the signal to have asked for its route
      const train = drive(trainAt(net, 700, 20, 'east'), 10)
      const state = createSignallingState()

      layout.route('straight')
      updateSignalling(net, [train], state, { level: 'pro' }, undefined, options)
      // Points for it: its block, the one to the block signal of B, the last one to the end of the track
      expect(clearanceOf(state, train)).toEqual({ blocks: 3, obstacle: 'absolute' })

      layout.route('diverging')
      updateSignalling(net, [train], state, { level: 'pro' }, undefined, options)
      expect(stateOf(state, pb)).toBe('stop')
      expect(clearanceOf(state, train)).toEqual({ blocks: 1, obstacle: 'absolute' })
    }
  })

  it('in the block of the train itself, the points are where the track ends for it', () => {
    const layout = crossoverLayout()
    const { net } = layout
    layout.route('diverging')
    const train = drive(trainAt(net, 1100, 20, 'east'), 10)
    const state = createSignallingState()
    updateSignalling(net, [train], state, { level: 'pro' }, undefined, options)
    expect(clearanceOf(state, train)).toEqual({ blocks: 1, obstacle: 'absolute' })
  })
})
