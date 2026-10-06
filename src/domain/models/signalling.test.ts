import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import { addSegment, createNetwork, resetIdCounter } from './network'
import { syncJunctions } from './junction'
import { endOverhang } from './rollingStock'
import { addSignal, addSignalPair, removeSignal, type SignallingSettings } from './signals'
import { signalBlockStats, signalTopology } from './signalBlocks'
import { trackGeometryRevision } from './trackSpeed'
import {
  ON_SIGHT_SPEED,
  SIGNAL_BRAKE_ALERT_MARGIN,
  approachDistance,
  createSignallingState,
  defaultSignalStatus,
  estimatedStoppingDistance,
  isNodeReserved,
  nodeReservedBy,
  reservationReach,
  signalAspect,
  signalStatus,
  signallingStats,
  trainSignalView,
  updateSignalling,
  type SignallingState,
} from './signalling'
import { tickSignalling } from './trainSignalling'
import { advanceTrainSet, resetTrainControls, type TrainSet } from './train'
import { BRAKE_PIPE_RELEASED, trainDynamics } from './trainDynamics'
import type { Network, Signal } from './types'
import { chain, crossoverLayout, drive, halt, headX, line, run, signalAt, singleTrackLayout, trainAt } from './signalling.testkit'
import { networkChanged, verifyNetworkRevisions } from '@domain/models/networkWatch'

beforeEach(() => resetIdCounter(0))

const PRO: SignallingSettings = { level: 'pro', stopEnforced: true }

const stateOf = (state: SignallingState, signal: Signal) => state.signals.get(signal.id)?.state
const causeOf = (state: SignallingState, signal: Signal) => state.signals.get(signal.id)?.cause
/** x of the leading end of an eastbound train */
const noseX = (net: Network, train: TrainSet) => headX(net, train) + endOverhang(train.vehicles, 0, 'front')

/** A line of 6 000 m with a block signal for eastbound trains every 1 000 m from x = 1000 to x = 5000 */
function blockLine() {
  const laid = line(12, 500)
  const signals = [1000.5, 2000.5, 3000.5, 4000.5, 5000.5].map((x) => signalAt(laid.net, x, 0, 'east'))
  return { ...laid, signals }
}

describe('nothing without signals', () => {
  it('a network without signal costs nothing and holds nothing', () => {
    const { net } = line(4, 500)
    const train = drive(trainAt(net, 300, 0, 'east'), 20)
    const state = createSignallingState()
    const before = { ...signallingStats }
    for (let i = 0; i < 20; i++) {
      advanceTrainSet(net, train, 5)
      expect(tickSignalling(net, [train], state)).toEqual([])
    }
    expect(signallingStats).toEqual(before)
    expect(state.signals.size).toBe(0)
    expect(state.trains.size).toBe(0)
    expect(state.railReservations.size).toBe(0)
    expect(state.revision).toBe(0)
    expect(trainSignalView(state, train.id, 500)).toEqual({ nextSignal: null, closedSignal: null, brakeAlert: false, waitingAt: null, onSight: false })
  })
})

describe('three-state block on a plain line', () => {
  it('closes the signal behind a train, shows caution one block back and clear before that', () => {
    const { net, signals } = blockLine()
    const ahead = trainAt(net, 3500, 0, 'east')
    const state = createSignallingState()
    updateSignalling(net, [ahead], state)
    // The train stands between the signals at 3 000 and 4 000
    expect(signals.map((signal) => stateOf(state, signal))).toEqual(['clear', 'caution', 'stop', 'clear', 'caution'])
    expect(causeOf(state, signals[2])).toBe('occupied')
    expect(causeOf(state, signals[1])).toBe('next-stop')
    expect(causeOf(state, signals[0])).toBeNull()
    // The last block runs to the end of the track
    expect(causeOf(state, signals[4])).toBe('track-end')
  })

  it('a second train follows: the states move with the first one', () => {
    const { net, signals } = blockLine()
    const first = drive(trainAt(net, 3500, 0, 'east'), 30)
    const second = drive(trainAt(net, 500, 0, 'east'), 30)
    const trains = [first, second]
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    expect(stateOf(state, signals[2])).toBe('stop')
    expect(stateOf(state, signals[1])).toBe('caution')

    // The first one leaves its block entirely: the signal behind it opens to caution, the next closes
    run(net, trains, state, first, 600)
    expect(noseX(net, first)).toBeGreaterThan(4100)
    expect(stateOf(state, signals[2])).toBe('caution')
    expect(stateOf(state, signals[3])).toBe('stop')
    expect(stateOf(state, signals[1])).toBe('clear')
  })

  it('a train straddling a signal occupies both blocks; the block is free once its tail has left it', () => {
    const { net, signals } = blockLine()
    const train = drive(trainAt(net, 3990, 0, 'east'), 10)
    const trains = [train]
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    expect(stateOf(state, signals[2])).toBe('stop')
    expect(stateOf(state, signals[3])).not.toBe('stop')

    run(net, trains, state, train, 15)
    expect(stateOf(state, signals[2])).toBe('stop')
    expect(stateOf(state, signals[3])).toBe('stop')

    run(net, trains, state, train, 30)
    expect(stateOf(state, signals[2])).toBe('caution')
    expect(stateOf(state, signals[3])).toBe('stop')
  })

  it('a train occupies whichever way it faces, and holds nothing when it is parked', () => {
    const { net, signals } = blockLine()
    const parked = trainAt(net, 3500, 0, 'west')
    const state = createSignallingState()
    updateSignalling(net, [parked], state)
    expect(stateOf(state, signals[2])).toBe('stop')
    expect(state.trains.get(parked.id)!.reservation).toEqual({ spans: [], nodes: [] })
    expect(state.railReservations.size).toBe(0)
  })
})

describe('what a train has ahead', () => {
  it('gives the next signal and the first closed one, each with its distance from the leading end', () => {
    const { net, signals } = blockLine()
    const ahead = trainAt(net, 3500, 0, 'east')
    const train = drive(trainAt(net, 700, 0, 'east'), 30)
    const state = createSignallingState()
    updateSignalling(net, [ahead, train], state)

    const nose = noseX(net, train)
    const view = trainSignalView(state, train.id, 0)
    expect(view.nextSignal).toMatchObject({ id: signals[0].id, state: 'clear' })
    expect(view.nextSignal!.distance).toBeCloseTo(1000.5 - nose, 4)
    // Two signals further: found however far it is within the look-ahead
    expect(view.closedSignal!.id).toBe(signals[2].id)
    expect(view.closedSignal!.distance).toBeCloseTo(3000.5 - nose, 4)
  })

  it('counts the distances down as the train runs, without walking the route again', () => {
    const { net, signals } = blockLine()
    const ahead = trainAt(net, 3500, 0, 'east')
    const train = drive(trainAt(net, 700, 0, 'east'), 30)
    const trains = [ahead, train]
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    const walks = signallingStats.routeWalks
    const builds = signalBlockStats.topologyBuilds

    run(net, trains, state, train, 200)
    expect(signallingStats.routeWalks).toBe(walks)
    expect(signalBlockStats.topologyBuilds).toBe(builds)
    const view = trainSignalView(state, train.id, 0)
    expect(view.nextSignal!.distance).toBeCloseTo(1000.5 - noseX(net, train), 4)
    expect(view.closedSignal!.distance).toBeCloseTo(3000.5 - noseX(net, train), 4)

    // Past the first signal the next one is the second, now at caution
    run(net, trains, state, train, 400)
    expect(trainSignalView(state, train.id, 0).nextSignal).toMatchObject({ id: signals[1].id, state: 'caution' })
  })

  it('raises the braking alert when the closed signal comes within the stopping distance and its margin', () => {
    const { net } = blockLine()
    const ahead = trainAt(net, 3500, 0, 'east')
    const train = drive(trainAt(net, 700, 0, 'east'), 30)
    const state = createSignallingState()
    updateSignalling(net, [ahead, train], state)
    const distance = trainSignalView(state, train.id, 0).closedSignal!.distance

    expect(trainSignalView(state, train.id, distance / SIGNAL_BRAKE_ALERT_MARGIN - 1).brakeAlert).toBe(false)
    expect(trainSignalView(state, train.id, distance / SIGNAL_BRAKE_ALERT_MARGIN + 1).brakeAlert).toBe(true)
    // At rest there is nothing to brake
    expect(trainSignalView(state, train.id, 0).brakeAlert).toBe(false)
  })

  it('a signal seen from behind is ignored: a westbound train has none of these ahead and passes none', () => {
    const { net, signals } = blockLine()
    const train = drive(trainAt(net, 4500, 0, 'west'), 20)
    const trains = [train]
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    expect(trainSignalView(state, train.id, 100).nextSignal).toBeNull()
    expect(trainSignalView(state, train.id, 100).closedSignal).toBeNull()

    const passings = run(net, trains, state, train, 2200)
    expect(headX(net, train)).toBeLessThan(2400)
    expect(passings).toEqual([])
    expect(train.emergencyBrake).toBe(false)
    // It still occupies their blocks on its way
    expect(stateOf(state, signals[1])).toBe('stop')
  })

  it('two signals back to back: each direction reads its own', () => {
    const { net, rails } = line(8, 500)
    const pair = addSignalPair(net, { segId: rails[4].id, t: 0.5 }, 'spacing')
    if (!pair.ok) throw new Error('refused')
    const [east, west] = pair.signals
    const eastbound = drive(trainAt(net, 1000.5, 0, 'east'), 20)
    const westbound = drive(trainAt(net, 3600.5, 0, 'west'), 20)
    const state = createSignallingState()
    updateSignalling(net, [eastbound, westbound], state)
    expect(trainSignalView(state, eastbound.id, 0).nextSignal!.id).toBe(east.id)
    expect(trainSignalView(state, westbound.id, 0).nextSignal!.id).toBe(west.id)
  })
})

describe('reservation ahead of a train', () => {
  it('holds the track over the stopping distance and its margin, and nothing behind the leading end', () => {
    const { net } = line(40, 250)
    signalAt(net, 9000.5, 0, 'east')
    const train = drive(trainAt(net, 1000, 0, 'east'), 40)
    const state = createSignallingState()
    updateSignalling(net, [train], state)
    const spans = state.trains.get(train.id)!.reservation.spans
    const reach = reservationReach(40)
    expect(reach).toBeGreaterThan(estimatedStoppingDistance(40))
    // Whole rails, from the bogie to the rail the reach ends on
    const xs = spans.flatMap((span) => {
      const seg = net.segments.get(span.segId)!
      const from = net.nodes.get(seg.from)!.pos.x
      const to = net.nodes.get(seg.to)!.pos.x
      return [from + (to - from) * span.t0, from + (to - from) * span.t1]
    })
    expect(Math.min(...xs)).toBeCloseTo(1000, 6)
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(noseX(net, train) + reach)
    expect(Math.max(...xs)).toBeLessThan(noseX(net, train) + reach + 250)
    // All in the direction of travel
    expect(spans.every((span) => span.t1 > span.t0)).toBe(true)
  })

  it('is given up when the train is parked, and taken the other way when it turns back', () => {
    const { net } = line(12, 500)
    signalAt(net, 5000.5, 0, 'east')
    const train = drive(trainAt(net, 2000, 0, 'east'), 20)
    const state = createSignallingState()
    updateSignalling(net, [train], state)
    expect(state.trains.get(train.id)!.reservation.spans.length).toBeGreaterThan(0)

    // Turned back at rest: the reverser now points the other way
    halt(train)
    train.direction = -1
    train.reverser = 'reverse'
    updateSignalling(net, [train], state)
    const backwards = state.trains.get(train.id)!.reservation.spans
    expect(backwards.length).toBeGreaterThan(0)
    expect(backwards.every((span) => span.t1 < span.t0)).toBe(true)

    resetTrainControls(train)
    updateSignalling(net, [train], state)
    expect(state.trains.get(train.id)!.reservation.spans).toEqual([])
    expect(state.railReservations.size).toBe(0)
  })

  it('closes a block signal whose block it enters by another way', () => {
    // A westbound train on a line signalled for eastbound trains holds track in their blocks
    const { net, signals } = blockLine()
    const westbound = drive(trainAt(net, 2900, 0, 'west'), 30)
    const state = createSignallingState()
    updateSignalling(net, [westbound], state)
    // It stands in the block of the signal at 2 000 and holds track in that of the signal at 1 000
    expect(stateOf(state, signals[1])).toBe('stop')
    expect(causeOf(state, signals[1])).toBe('occupied')
    expect(stateOf(state, signals[0])).toBe('stop')
    expect(causeOf(state, signals[0])).toBe('reserved')
  })
})

describe('a route given is kept', () => {
  /** A fork at x = 1000 with a block signal before it at x = 500 and one on each branch at x = 2000 */
  function fork() {
    const net = createNetwork()
    const main = chain(net, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 3000, y: 0 }])
    const branch = chain(net, [{ x: 1400, y: 20 }, { x: 3000, y: 20 }], main.nodes[1])
    syncJunctions(net)
    const entry = signalAt(net, 500, 0, 'east')
    signalAt(net, 2000, 0, 'east')
    signalAt(net, 2000, 20, 'east')
    const junction = [...net.junctions.values()][0]
    junction.active = junction.positions.findIndex((open) =>
      open.some((i) => [junction.passages[i].a, junction.passages[i].b].includes(main.rails[1].id)),
    )
    networkChanged()
    return { net, main, branch, entry }
  }

  it('without a path signal a train on either branch closes the block signal before the fork', () => {
    const { net, entry } = fork()
    const onBranch = trainAt(net, 1700, 20, 'east')
    const coming = drive(trainAt(net, 300, 0, 'east'), 10)
    const state = createSignallingState()
    updateSignalling(net, [onBranch, coming], state)
    // The points lead along the main line, the train stands on the branch: closed all the same
    expect(stateOf(state, entry)).toBe('stop')
    expect(causeOf(state, entry)).toBe('occupied')
    expect(state.trains.get(coming.id)!.grants.size).toBe(0)

    // Beyond the signal of the branch, it is out of the block
    const state2 = createSignallingState()
    updateSignalling(net, [trainAt(net, 2100, 20, 'east'), coming], state2)
    expect(stateOf(state2, entry)).toBe('clear')
  })

  it('a signal open for a train does not close in front of it for what happens on another branch', () => {
    const { net, entry } = fork()
    const coming = drive(trainAt(net, 420, 0, 'east'), 10)
    const trains = [coming]
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    expect(stateOf(state, entry)).toBe('clear')
    expect(state.signals.get(entry.id)!.clearedFor).toBe(coming.id)

    // A train turns up on the branch the points do not lead to
    trains.push(trainAt(net, 1700, 20, 'east'))
    updateSignalling(net, trains, state)
    expect(stateOf(state, entry)).toBe('clear')
    const passings = run(net, trains, state, coming, 150)
    expect(passings.map((p) => p.fault)).toEqual([false])

    // Behind it the signal is closed, and the next train is not let in while the branch is occupied
    const follower = drive(trainAt(net, 300, 0, 'east'), 10)
    trains.push(follower)
    run(net, trains, state, coming, 1600)
    expect(noseX(net, coming)).toBeGreaterThan(2100)
    expect(stateOf(state, entry)).toBe('stop')
    expect(state.trains.get(follower.id)!.grants.size).toBe(0)
  })

  it('but is lost when its own track is taken', () => {
    const { net, entry } = fork()
    const coming = drive(trainAt(net, 420, 0, 'east'), 10)
    const trains = [coming]
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    expect(state.trains.get(coming.id)!.grants.has(entry.id)).toBe(true)
    trains.push(trainAt(net, 1700, 0, 'east'))
    updateSignalling(net, trains, state)
    expect(state.trains.get(coming.id)!.grants.has(entry.id)).toBe(false)
    expect(stateOf(state, entry)).toBe('stop')
  })
})

describe('stopping distance of the physics', () => {
  it('the track is held over the longer of the estimate and what the physics gives', () => {
    const { net } = line(60, 250)
    signalAt(net, 14_000.5, 0, 'east')
    const train = drive(trainAt(net, 1000, 0, 'east'), 40)
    const reached = (state: SignallingState): number => {
      const xs = state.trains.get(train.id)!.reservation.spans.map((span) => {
        const seg = net.segments.get(span.segId)!
        const from = net.nodes.get(seg.from)!.pos.x
        return from + (net.nodes.get(seg.to)!.pos.x - from) * span.t1
      })
      return Math.max(...xs) - noseX(net, train)
    }
    const estimate = createSignallingState()
    updateSignalling(net, [train], estimate)
    expect(reached(estimate)).toBeGreaterThanOrEqual(reservationReach(40))

    // The physics says more (a steep way down, say): it is the one that counts
    const longer = createSignallingState()
    updateSignalling(net, [train], longer, undefined, () => 4000)
    expect(reached(longer)).toBeGreaterThanOrEqual(4000 * 1.5)
    // It says less, or cannot tell: the estimate stands
    for (const given of [10, Infinity, NaN, null]) {
      const state = createSignallingState()
      updateSignalling(net, [train], state, undefined, () => given)
      expect(reached(state)).toBe(reached(estimate))
    }
  })

  it('on level track the estimate is no shorter than the stopping distance of a TGV under full service braking', () => {
    const { net } = line(4, 500)
    const train = trainAt(net, 1000, 0, 'east')
    train.reverser = 'forward'
    train.brakePipe = BRAKE_PIPE_RELEASED
    train.brakeCylinder = 0
    for (const kmh of [30, 80, 160, 220, 300, 320]) {
      train.currentSpeed = kmh / 3.6
      const physics = trainDynamics(net, train).stoppingDistance
      expect(physics).toBeGreaterThan(0)
      expect(estimatedStoppingDistance(train.currentSpeed)).toBeGreaterThanOrEqual(physics)
    }
  })
})

describe('path signal at a junction', () => {
  it('stays closed until a train comes near, opens for it and closes behind its leading end', () => {
    const layout = crossoverLayout()
    const { net, pa, sa } = layout
    layout.route('straight')
    const train = drive(trainAt(net, 100, 0, 'east'), 10)
    const trains = [train]
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    // Too far to ask yet
    expect(approachDistance(10)).toBeLessThan(700)
    expect(stateOf(state, pa)).toBe('stop')
    expect(causeOf(state, pa)).toBe('no-route')
    expect(trainSignalView(state, train.id, 0).closedSignal!.id).toBe(pa.id)

    run(net, trains, state, train, 500)
    expect(stateOf(state, pa)).toBe('clear')
    expect(state.signals.get(pa.id)!.clearedFor).toBe(train.id)
    expect(state.trains.get(train.id)!.grants.has(pa.id)).toBe(true)
    expect(nodeReservedBy(state, layout.forkA.id)).toBe(train.id)
    // The next signal on the route is the block signal at 2 500, itself at caution before the end of the track
    expect(stateOf(state, sa)).toBe('caution')

    const passings = run(net, trains, state, train, 350)
    expect(passings).toEqual([{ trainId: train.id, signalId: pa.id, speed: 10, closed: false, fault: false, onSight: false }])
    expect(stateOf(state, pa)).toBe('stop')
    expect(train.emergencyBrake).toBe(false)
    // Let past the signal, it holds its route as far as the next one
    expect(state.trains.get(train.id)!.holdsToNextSignal).toBe(true)
    expect(nodeReservedBy(state, layout.forkA.id)).toBe(train.id)
  })

  it('shows caution when the next signal on the route given is closed', () => {
    const layout = crossoverLayout()
    const { net, pa, sa } = layout
    layout.route('straight')
    const parked = trainAt(net, 2800, 0, 'east')
    const train = drive(trainAt(net, 700, 0, 'east'), 10)
    const state = createSignallingState()
    updateSignalling(net, [parked, train], state)
    expect(stateOf(state, sa)).toBe('stop')
    expect(stateOf(state, pa)).toBe('caution')
    expect(causeOf(state, pa)).toBe('next-stop')
  })

  it('two trains on routes that do not touch pass together', () => {
    const layout = crossoverLayout()
    const { net, pa, pb } = layout
    layout.route('straight')
    const onA = drive(trainAt(net, 700, 0, 'east'), 10)
    const onB = drive(trainAt(net, 700, 20, 'east'), 10)
    const trains = [onA, onB]
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    expect(stateOf(state, pa)).not.toBe('stop')
    expect(stateOf(state, pb)).not.toBe('stop')
    expect(nodeReservedBy(state, layout.forkA.id)).toBe(onA.id)
    expect(nodeReservedBy(state, layout.forkB.id)).toBe(onB.id)

    // Both go through, side by side, without a fault
    for (let i = 0; i < 60; i++) {
      for (const train of trains) advanceTrainSet(net, train, 10, trains)
      expect(tickSignalling(net, trains, state).filter((p) => p.fault)).toEqual([])
    }
    expect(noseX(net, onA)).toBeGreaterThan(1250)
    expect(noseX(net, onB)).toBeGreaterThan(1250)
  })

  it('on routes that cross, one waits: the first to ask has the junction', () => {
    const layout = crossoverLayout()
    const { net, pa, pb } = layout
    layout.route('diverging')
    const onA = drive(trainAt(net, 700, 0, 'east'), 10)
    const onB = drive(trainAt(net, 700, 20, 'east'), 10)
    const trains = [onA, onB]
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    // The route of the train on A goes over the crossover onto B
    expect(stateOf(state, pa)).not.toBe('stop')
    expect(nodeReservedBy(state, layout.forkB.id)).toBe(onA.id)
    // The points on B are set against the train on B, and held: its signal stays closed
    expect(stateOf(state, pb)).toBe('stop')
    expect(trainSignalView(state, onB.id, 0).closedSignal!.id).toBe(pb.id)
  })

  it('the route held is not taken by a train that asks later, whatever the order of the trains', () => {
    const layout = crossoverLayout()
    const { net, pa, pb } = layout
    layout.route('straight')
    // The train on B comes first and has its route along B
    const onB = drive(trainAt(net, 700, 20, 'east'), 10)
    const state = createSignallingState()
    updateSignalling(net, [onB], state)
    expect(stateOf(state, pb)).not.toBe('stop')

    // A train then appears on A, listed first, with the points now leading it onto B
    const onA = drive(trainAt(net, 700, 0, 'east'), 10)
    layout.route('diverging')
    // The points on B are held for the train on B: put them back, only those on A lead to the crossover
    layout.route('straight')
    const junctionA = [...net.junctions.values()].find((j) => j.nodeId === layout.forkA.id)!
    junctionA.active = junctionA.positions.findIndex((open) =>
      open.some((i) => [junctionA.passages[i].a, junctionA.passages[i].b].includes(layout.crossover.id)),
    )
    networkChanged()
    updateSignalling(net, [onA, onB], state)
    expect(stateOf(state, pb)).not.toBe('stop')
    expect(state.signals.get(pb.id)!.clearedFor).toBe(onB.id)
    expect(stateOf(state, pa)).toBe('stop')
    expect(trainSignalView(state, onA.id, 0).waitingAt).toBe(pa.id)
  })

  it('frees the route behind the tail, points by points', () => {
    const layout = crossoverLayout()
    const { net, pa, pb } = layout
    layout.route('diverging')
    const onA = drive(trainAt(net, 700, 0, 'east'), 10)
    const onB = drive(trainAt(net, 700, 20, 'east'), 0)
    const trains = [onA, onB]
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    expect(stateOf(state, pb)).toBe('stop')

    // Over the first points: they are held (reserved, then occupied) until the tail has left them
    run(net, trains, state, onA, 310)
    expect(noseX(net, onA)).toBeGreaterThan(1000)
    expect(isNodeReserved(state, layout.forkA.id) || state.trains.get(onA.id)!.occupancy.nodes.includes(layout.forkA.id)).toBe(true)
    expect(stateOf(state, pa)).toBe('stop')

    run(net, trains, state, onA, 60)
    // Tail clear of the first points: they are free again, the second ones still held for the train
    expect(headX(net, onA)).toBeGreaterThan(1040)
    expect(isNodeReserved(state, layout.forkA.id)).toBe(false)
    expect(state.trains.get(onA.id)!.occupancy.nodes).not.toContain(layout.forkA.id)
    expect(nodeReservedBy(state, layout.forkB.id)).toBe(onA.id)
    expect(stateOf(state, pb)).toBe('stop')

    // Once it has gone past the next signal on B, tail included, the train waiting on B gets its route
    run(net, trains, state, onA, 1600)
    expect(headX(net, onA)).toBeGreaterThan(2550)
    layout.route('straight')
    updateSignalling(net, trains, state)
    expect(isNodeReserved(state, layout.forkB.id, onB.id)).toBe(false)
    expect(stateOf(state, pb)).not.toBe('stop')
    expect(state.signals.get(pb.id)!.clearedFor).toBe(onB.id)
  })

  it('gives up a route when the train stops far from the signal', () => {
    const layout = crossoverLayout()
    const { net, pa } = layout
    layout.route('straight')
    const train = drive(trainAt(net, 400, 0, 'east'), 30)
    const state = createSignallingState()
    updateSignalling(net, [train], state)
    // 500 m away at 30 m/s: within the approach distance
    expect(stateOf(state, pa)).not.toBe('stop')
    expect(nodeReservedBy(state, layout.forkA.id)).toBe(train.id)

    halt(train)
    updateSignalling(net, [train], state)
    expect(stateOf(state, pa)).toBe('stop')
    expect(nodeReservedBy(state, layout.forkA.id)).toBeNull()
  })
})

describe('single track between two passing loops', () => {
  it('lets one train at a time onto the single track', () => {
    const layout = singleTrackLayout()
    const { net } = layout
    layout.west('main')
    layout.east('main')
    const eastbound = drive(trainAt(net, 700, 0, 'east'), 10)
    const westbound = drive(trainAt(net, 3300, 0, 'west'), 10)
    const trains = [eastbound, westbound]
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    expect(stateOf(state, layout.exitWestMain)).not.toBe('stop')
    expect(stateOf(state, layout.exitEastMain)).toBe('stop')
    expect(trainSignalView(state, westbound.id, 0).waitingAt).toBe(layout.exitEastMain.id)

    // The eastbound train runs the single track; the other still waits while it is on it
    run(net, trains, state, eastbound, 1800)
    expect(headX(net, eastbound)).toBeGreaterThan(2450)
    expect(stateOf(state, layout.exitEastMain)).toBe('stop')
    // The main track of the far station is taken: no route into it, the train waits for one
    expect(stateOf(state, layout.entryEast)).toBe('stop')
    expect(trainSignalView(state, eastbound.id, 0).waitingAt).toBe(layout.entryEast.id)
    // The station is entered by its siding instead
    layout.east('siding')
    updateSignalling(net, trains, state)
    expect(stateOf(state, layout.entryEast)).not.toBe('stop')

    // Once it is in the siding, tail clear of the points, the single track is given the other way
    const passings = run(net, trains, state, eastbound, 1100)
    expect(passings.map((p) => [p.signalId, p.fault])).toEqual([[layout.entryEast.id, false]])
    expect(headX(net, eastbound)).toBeGreaterThan(3450)
    layout.east('main')
    updateSignalling(net, trains, state)
    expect(stateOf(state, layout.exitEastMain)).not.toBe('stop')
    expect(state.signals.get(layout.exitEastMain.id)!.clearedFor).toBe(westbound.id)
  })

  it('gives the single track to whichever asks first, and to nobody twice', () => {
    const layout = singleTrackLayout()
    const { net } = layout
    layout.west('main')
    layout.east('main')
    const eastbound = drive(trainAt(net, 700, 0, 'east'), 10)
    const westbound = drive(trainAt(net, 3300, 0, 'west'), 10)
    // Listed the other way round: the westbound one is served first
    const trains = [westbound, eastbound]
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    expect(stateOf(state, layout.exitEastMain)).not.toBe('stop')
    expect(stateOf(state, layout.exitWestMain)).toBe('stop')
    const holders = new Set(state.railReservations.get(layout.single.id)!.map((res) => res.trainId))
    expect([...holders]).toEqual([westbound.id])
  })

  it('with signals along the single track, a train is still not let in against another one', () => {
    const layout = singleTrackLayout()
    const { net } = layout
    layout.west('main')
    layout.east('main')
    // Block signals in the middle, one for each direction: each route into the single track is now
    // only half of it, and the two halves do not touch
    const midEast = signalAt(net, 2000, 0, 'east')
    const midWest = signalAt(net, 2000, 0, 'west')
    const eastbound = drive(trainAt(net, 700, 0, 'east'), 10)
    const westbound = drive(trainAt(net, 3300, 0, 'west'), 10)
    const trains = [eastbound, westbound]
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    expect(stateOf(state, layout.exitWestMain)).not.toBe('stop')
    expect(stateOf(state, layout.exitEastMain)).toBe('stop')

    // Still so with the eastbound train on the single track, short of the middle
    run(net, trains, state, eastbound, 600)
    expect(headX(net, eastbound)).toBeGreaterThan(1250)
    expect(stateOf(state, layout.exitEastMain)).toBe('stop')
    expect(stateOf(state, midEast)).not.toBe('stop')
    void midWest
  })

  it('a second train may follow the first in the same direction', () => {
    const layout = singleTrackLayout()
    const { net } = layout
    layout.west('main')
    layout.east('siding')
    signalAt(net, 2000, 0, 'east')
    const first = drive(trainAt(net, 2300, 0, 'east'), 10)
    const second = drive(trainAt(net, 700, 0, 'east'), 10)
    const state = createSignallingState()
    updateSignalling(net, [first, second], state)
    // The first is beyond the middle signal: the first half is free for the second
    expect(stateOf(state, layout.exitWestMain)).toBe('caution')
  })
})

describe('passing a closed signal', () => {
  function closedBlock() {
    const laid = blockLine()
    const ahead = trainAt(laid.net, 2500, 0, 'east')
    const train = drive(trainAt(laid.net, 1700, 0, 'east'), 20)
    return { ...laid, ahead, train, trains: [ahead, train], closed: laid.signals[1] }
  }

  it('applies the emergency brake and leaves a trace on the train, once', () => {
    const { net, trains, train, closed } = closedBlock()
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    expect(stateOf(state, closed)).toBe('stop')

    const passings = run(net, trains, state, train, 400)
    expect(passings).toEqual([{ trainId: train.id, signalId: closed.id, speed: 20, closed: true, fault: true, onSight: false }])
    expect(train.emergencyBrake).toBe(true)
    expect(train.signalPassed).toEqual({ signalId: closed.id, speed: 72, braked: true })
    // The run stopped at the fault: the leading end is just past the signal
    expect(noseX(net, train)).toBeGreaterThan(2000.5)
    expect(noseX(net, train)).toBeLessThan(2006)

    // Nothing more is reported while it stands there
    expect(tickSignalling(net, trains, state)).toEqual([])
    resetTrainControls(train)
    expect(train.signalPassed).toBeNull()
  })

  it('leaves the trace without braking when the setting is off', () => {
    const { net, trains, train, closed } = closedBlock()
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    const passings = run(net, trains, state, train, 400, { level: 'standard', stopEnforced: false })
    expect(passings.map((p) => p.fault)).toEqual([true])
    expect(train.emergencyBrake).toBe(false)
    expect(train.signalPassed).toEqual({ signalId: closed.id, speed: 72, braked: false })
  })

  it('an open signal passed afterwards clears the trace', () => {
    const { net, signals } = blockLine()
    const ahead = trainAt(net, 2500, 0, 'east')
    const train = drive(trainAt(net, 1700, 0, 'east'), 20)
    const trains = [ahead, train]
    const state = createSignallingState()
    const lax: SignallingSettings = { level: 'standard', stopEnforced: false }
    updateSignalling(net, trains, state)
    run(net, trains, state, train, 400, lax)
    expect(train.signalPassed).toBeTruthy()
    // The train ahead goes away; ours carries on to the next signal, now open
    drive(ahead, 30)
    run(net, trains, state, ahead, 2500, lax)
    const passings = run(net, trains, state, train, 1000, lax)
    expect(passings.map((p) => [p.signalId, p.fault])).toEqual([[signals[2].id, false]])
    expect(train.signalPassed).toBeNull()
  })

  it('standard level: stopping before the signal first changes nothing, every red is a stop', () => {
    const { net, trains, train } = closedBlock()
    const state = createSignallingState()
    updateSignalling(net, trains, state)
    run(net, trains, state, train, 250)
    halt(train)
    tickSignalling(net, trains, state)
    drive(train, 5)
    const passings = run(net, trains, state, train, 100)
    expect(passings.map((p) => p.fault)).toEqual([true])
    expect(train.emergencyBrake).toBe(true)
  })

  it('pro level: a sémaphore passed after a full stop before it is no fault, the train runs on sight', () => {
    const { net, trains, train, closed, signals } = closedBlock()
    const state = createSignallingState()
    updateSignalling(net, trains, state, PRO)
    run(net, trains, state, train, 250, PRO)
    halt(train)
    tickSignalling(net, trains, state, PRO)
    expect(state.trains.get(train.id)!.stoppedBefore).toBe(closed.id)

    drive(train, 5)
    const passings = run(net, trains, state, train, 100, PRO)
    expect(passings).toEqual([{ trainId: train.id, signalId: closed.id, speed: 5, closed: true, fault: false, onSight: true }])
    expect(train.emergencyBrake).toBe(false)
    expect(train.signalPassed ?? null).toBeNull()
    expect(trainSignalView(state, train.id, 0).onSight).toBe(true)
    // It has not been given the block: it holds nothing of it beyond what lies free before the train ahead
    expect(state.trains.get(train.id)!.holdsToNextSignal).toBe(false)
    void signals
  })

  it('pro level: a sémaphore passed without stopping is a fault', () => {
    const { net, trains, train } = closedBlock()
    const state = createSignallingState()
    updateSignalling(net, trains, state, PRO)
    const passings = run(net, trains, state, train, 400, PRO)
    expect(passings.map((p) => [p.fault, p.onSight])).toEqual([[true, false]])
    expect(train.emergencyBrake).toBe(true)
  })

  it('pro level: a carré is never passed, even after a stop', () => {
    const layout = crossoverLayout()
    const { net, pa } = layout
    layout.route('straight')
    // A train stands on the route: it cannot be given
    const blocking = trainAt(net, 1500, 0, 'east')
    const train = drive(trainAt(net, 700, 0, 'east'), 10)
    const trains = [blocking, train]
    const state = createSignallingState()
    updateSignalling(net, trains, state, PRO)
    expect(stateOf(state, pa)).toBe('stop')
    run(net, trains, state, train, 150, PRO)
    halt(train)
    tickSignalling(net, trains, state, PRO)
    drive(train, 5)
    const passings = run(net, trains, state, train, 100, PRO)
    expect(passings.map((p) => [p.signalId, p.fault, p.onSight])).toEqual([[pa.id, true, false]])
    expect(train.emergencyBrake).toBe(true)
  })
})

describe('the two levels read the same signals', () => {
  it('standard: three colours, and no red may be passed', () => {
    const { net, rails } = line(1, 500)
    const block = addSignal(net, { segId: rails[0].id, t: 0.3 }, true, 'spacing')
    const path = addSignal(net, { segId: rails[0].id, t: 0.6 }, true, 'protection')
    if (!block.ok || !path.ok) throw new Error('refused')
    expect(signalAspect(block.signal, 'clear', 'standard')).toMatchObject({ color: 'green', label: 'Voie libre', indication: null, plate: null })
    expect(signalAspect(block.signal, 'caution', 'standard')).toMatchObject({ color: 'yellow', label: 'Attention' })
    for (const signal of [block.signal, path.signal]) {
      expect(signalAspect(signal, 'stop', 'standard')).toMatchObject({ color: 'red', label: 'Arrêt', passableAfterStop: false, onSightSpeed: null })
    }
  })

  it('pro: voie libre, avertissement, sémaphore (plate F, passable on sight) and carré (plate Nf, never)', () => {
    const { net, rails } = line(1, 500)
    const block = addSignal(net, { segId: rails[0].id, t: 0.3 }, true, 'spacing')
    const path = addSignal(net, { segId: rails[0].id, t: 0.6 }, true, 'protection')
    const marker = addSignal(net, { segId: rails[0].id, t: 0.9 }, true, 'spacing', { cabMarker: true })
    if (!block.ok || !path.ok || !marker.ok) throw new Error('refused')
    expect(signalAspect(block.signal, 'clear', 'pro')).toMatchObject({ indication: 'voie-libre', label: 'Voie libre', plate: 'F', lit: true })
    expect(signalAspect(path.signal, 'caution', 'pro')).toMatchObject({ indication: 'avertissement', label: 'Avertissement', plate: 'Nf' })
    expect(signalAspect(block.signal, 'stop', 'pro')).toMatchObject({
      indication: 'semaphore',
      label: 'Sémaphore',
      plate: 'F',
      passableAfterStop: true,
      onSightSpeed: ON_SIGHT_SPEED,
      color: 'red',
    })
    expect(signalAspect(path.signal, 'stop', 'pro')).toMatchObject({ indication: 'carre', label: 'Carré', plate: 'Nf', passableAfterStop: false, onSightSpeed: null })
    // A marker board of a cab-signalled line has no lamp at the pro level, and is an ordinary signal at the standard one
    expect(signalAspect(marker.signal, 'stop', 'pro')).toMatchObject({ lit: false, plate: 'F', indication: 'semaphore' })
    expect(signalAspect(marker.signal, 'stop', 'standard')).toMatchObject({ lit: true, color: 'red' })
  })

  it('switching the level changes nothing to the signals nor to what they show', () => {
    const { net, signals } = blockLine()
    const ahead = trainAt(net, 3500, 0, 'east')
    const before = JSON.stringify([...net.signals.values()])
    const standard = createSignallingState()
    const pro = createSignallingState()
    updateSignalling(net, [ahead], standard, { level: 'standard' })
    updateSignalling(net, [ahead], pro, { level: 'pro' })
    expect([...pro.signals]).toEqual([...standard.signals])
    expect(JSON.stringify([...net.signals.values()])).toBe(before)
    expect(signalAspect(signals[2], stateOf(pro, signals[2])!, 'pro').indication).toBe('semaphore')
    expect(signalAspect(signals[2], stateOf(standard, signals[2])!, 'standard').color).toBe('red')
  })

  it('outside the simulation a block signal reads open and a path signal closed', () => {
    const { net, rails } = line(1, 500)
    const block = addSignal(net, { segId: rails[0].id, t: 0.3 }, true, 'spacing')
    const path = addSignal(net, { segId: rails[0].id, t: 0.6 }, true, 'protection')
    if (!block.ok || !path.ok) throw new Error('refused')
    const state = createSignallingState()
    expect(signalStatus(state, block.signal)).toEqual(defaultSignalStatus(block.signal))
    expect(signalStatus(state, block.signal).state).toBe('clear')
    expect(signalStatus(state, path.signal)).toEqual({ state: 'stop', cause: 'no-route', clearedFor: null })
  })
})

describe('the state follows the network', () => {
  it('is worked out again when a signal is added or removed, and emptied with the last signal', () => {
    const { net, signals } = blockLine()
    const ahead = trainAt(net, 3500, 0, 'east')
    const state = createSignallingState()
    updateSignalling(net, [ahead], state)
    expect(stateOf(state, signals[2])).toBe('stop')

    // A signal laid inside the occupied block, behind the train: the block is cut there
    const extra = signalAt(net, 3200.5, 0, 'east')
    updateSignalling(net, [ahead], state)
    expect(stateOf(state, signals[2])).toBe('caution')
    expect(stateOf(state, extra)).toBe('stop')

    for (const signal of [...net.signals.values()]) removeSignal(net, signal.id)
    updateSignalling(net, [ahead], state)
    expect(state.signals.size).toBe(0)
    expect(state.trains.size).toBe(0)
  })

  it('forgets a train that is gone, with what it held', () => {
    const layout = crossoverLayout()
    const { net } = layout
    layout.route('straight')
    const train = drive(trainAt(net, 700, 0, 'east'), 10)
    const state = createSignallingState()
    updateSignalling(net, [train], state)
    expect(nodeReservedBy(state, layout.forkA.id)).toBe(train.id)
    updateSignalling(net, [], state)
    expect(nodeReservedBy(state, layout.forkA.id)).toBeNull()
    expect(state.railReservations.size).toBe(0)
    expect(state.trains.size).toBe(0)
  })
})

describe('cost', () => {
  /**
   * A line of `count` rails of 50 m with a siding leaving it every 100 rails and joining it again
   * 20 rails further, and `signalCount` block signals spread along it for eastbound trains.
   */
  function bigNetwork(count: number, signalCount: number) {
    const net = createNetwork()
    const main = chain(net, Array.from({ length: count + 1 }, (_, i) => ({ x: i * 50, y: 0 })))
    for (let i = 50; i + 20 < count; i += 100) {
      const side = chain(
        net,
        Array.from({ length: 19 }, (_, k) => ({ x: (i + 1 + k) * 50, y: 8 })),
        main.nodes[i],
      )
      addSegment(net, side.nodes[side.nodes.length - 1].id, main.nodes[i + 20].id)
    }
    syncJunctions(net)
    const signals: Signal[] = []
    for (let k = 0; k < signalCount; k++) {
      const rail = main.rails[Math.floor(((k + 0.5) * count) / signalCount)]
      const laid = addSignal(net, { segId: rail.id, t: 0.5 }, true, k % 4 === 0 ? 'protection' : 'spacing')
      if (laid.ok) signals.push(laid.signal)
    }
    return { net, main, signals }
  }

  it('a few thousand rails and a few dozen signals: nothing is walked again while nothing changes', () => {
    // Timed as the editor runs: without the check of the revisions the tests add
    verifyNetworkRevisions(false)
    onTestFinished(() => verifyNetworkRevisions(true))
    const { net, signals } = bigNetwork(3000, 40)
    expect(net.segments.size).toBeGreaterThan(3500)
    expect(signals).toHaveLength(40)
    const trains = [
      drive(trainAt(net, 1000, 0, 'east'), 60),
      drive(trainAt(net, 60_000, 0, 'east'), 60),
      trainAt(net, 100_000, 0, 'east'),
    ]
    const state = createSignallingState()

    let start = performance.now()
    signalTopology(net)
    const buildMs = performance.now() - start

    start = performance.now()
    updateSignalling(net, trains, state)
    const firstMs = performance.now() - start
    expect(state.signals.size).toBe(40)

    // Nothing moves: the blocks are not built again, no route is walked, the update is skipped
    const builds = signalBlockStats.topologyBuilds
    const blockWalks = signalBlockStats.routeWalks
    const walks = signallingStats.routeWalks
    const updates = signallingStats.updates
    const occupancy = signallingStats.occupancyWalks
    const revision = state.revision
    start = performance.now()
    for (let i = 0; i < 200; i++) updateSignalling(net, trains, state)
    const idleMs = (performance.now() - start) / 200
    expect(signalBlockStats.topologyBuilds).toBe(builds)
    expect(signalBlockStats.routeWalks).toBe(blockWalks)
    expect(signallingStats.routeWalks).toBe(walks)
    expect(signallingStats.updates).toBe(updates)
    expect(signallingStats.occupancyWalks).toBe(occupancy)
    expect(state.revision).toBe(revision)

    // Two trains run 2 m per step for 600 steps: the blocks stay, the routes are walked again only
    // when a train nears the end of what it had looked over
    let moving = 0
    for (let i = 0; i < 600; i++) {
      advanceTrainSet(net, trains[0], 2, trains)
      advanceTrainSet(net, trains[1], 2, trains)
      start = performance.now()
      updateSignalling(net, trains, state)
      moving += performance.now() - start
    }
    const movingMs = moving / 600

    // What the comparison of the network with its last known state costs on its own
    start = performance.now()
    for (let i = 0; i < 200; i++) trackGeometryRevision(net)
    const compareMs = (performance.now() - start) / 200
    expect(signalBlockStats.topologyBuilds).toBe(builds)
    expect(signallingStats.routeWalks - walks).toBeLessThanOrEqual(4)
    expect(signalBlockStats.routeWalks).toBe(blockWalks)
    // The train that does not move is not walked over again
    expect(signallingStats.occupancyWalks - occupancy).toBe(1200)

    console.info(
      `[signalling cost] ${net.segments.size} rails, ${net.signals.size} signals, ${trains.length} trains: ` +
        `blocks ${buildMs.toFixed(2)} ms, first update ${firstMs.toFixed(2)} ms, ` +
        `step with nothing changed ${(idleMs * 1000).toFixed(1)} µs (of which ${(compareMs * 1000).toFixed(1)} µs comparing the track), ` +
        `step with two trains moving ${(movingMs * 1000).toFixed(1)} µs`,
    )
    // Generous ceilings: a frame is 16 ms
    expect(idleMs).toBeLessThan(2)
    expect(movingMs).toBeLessThan(4)
  })
})
