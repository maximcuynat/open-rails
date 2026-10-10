import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { addJunction, syncJunctions } from '@domain/models/junction'
import { createLocomotive } from '@domain/models/locomotive'
import { MAX_NOTCH, MIN_NOTCH } from '@domain/models/train'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { setSignalOptions } from '@domain/models/signals'
import { ON_SIGHT_SPEED } from '@domain/models/signalling'
import { addSpeedZone } from '@domain/models/speedZones'
import { chain, drive, setPoints, signalAt, trainAt } from '@domain/models/signalling.testkit'
import { decodeMessage, encodeMessage } from '@application/remote/protocol'
import { newSignalPassed, signalPassedLabel } from '@presentation/components/console/consoleModel'
import { signalPassedMessage } from '@application/state/editorStore'
import { brakeTone, buildConsoleState, buildDeskConsoleState, buildFleet, buildTrainConsoleState, trainConsoleState } from './consoleState'

function makeStore(): EditorStore {
  const store = new EditorStore()
  const n1 = addNode(store.network, { x: 0, y: 0 })
  const n2 = addNode(store.network, { x: 4000, y: 0 })
  addSegment(store.network, n1.id, n2.id)
  return store
}

function makeDrivingStore(): EditorStore {
  const store = makeStore()
  expect(store.placeTrainLoco({ x: 1000, y: 0 })).toBe(true)
  store.togglePlayMode()
  return store
}

/** Run the simulation for `seconds`, in steps short enough for the physics */
function run(store: EditorStore, seconds: number): void {
  for (let t = 0; t < seconds; t += 0.05) store.tickAllTrains(0.05)
}

describe('console state', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
  })

  it('is null outside driving mode', () => {
    const store = makeStore()
    expect(buildConsoleState(store)).toBeNull()
    store.placeTrainLoco({ x: 1000, y: 0 })
    expect(buildConsoleState(store)).toBeNull()
  })

  it('shows a train that starts at rest with its brake applied', () => {
    const store = makeDrivingStore()
    const state = buildConsoleState(store)!
    expect(state).toMatchObject({
      trainId: store.selectedTrainId,
      speed: 0,
      stopped: true,
      notch: 0,
      minNotch: MIN_NOTCH,
      maxNotch: MAX_NOTCH,
      handleEffort: 0,
      reverser: 'neutral',
      reverserLocked: false,
      emergencyBrake: false,
      emergencyReleasable: false,
      locoCount: 1,
      wagonCount: 0,
      stoppingDistance: 0,
    })
    expect(state.maxSpeed).toBe(store.selectedTrain!.maxSpeed)
    expect(state.brake).toEqual({ command: 'hold', tone: 'applied', pipeBar: 3.5, cylinderBar: 3.8 })
    expect(state.legacyThrottle).toBeUndefined()
  })

  it('shows a train in traction: brake released, effort applied, reverser locked', () => {
    const store = makeDrivingStore()
    store.setSelectedTrainReverser('forward')
    store.setSelectedTrainBrakeCommand('release')
    run(store, 30)
    store.setSelectedTrainBrakeCommand('hold')
    store.setSelectedTrainNotch(3)
    run(store, 10)

    const state = buildConsoleState(store)!
    expect(state.notch).toBe(3)
    expect(state.speed).toBeGreaterThan(0)
    expect(state.stopped).toBe(false)
    expect(state.handleEffort).toBeGreaterThan(0)
    expect(state.handleEffort).toBeLessThanOrEqual(1)
    expect(state.acceleration).toBeGreaterThan(0)
    expect(state.reverser).toBe('forward')
    expect(state.reverserLocked).toBe(true)
    expect(state.brake).toMatchObject({ command: 'hold', tone: 'released' })
    expect(state.brake!.pipeBar).toBeCloseTo(5, 1)
    expect(state.brake!.cylinderBar).toBeCloseTo(0, 1)
    expect(state.stoppingDistance).toBeGreaterThan(0)
  })

  it('reads the electric brake effort on the negative notches', () => {
    const store = makeDrivingStore()
    store.setSelectedTrainReverser('forward')
    store.setSelectedTrainBrakeCommand('release')
    run(store, 30)
    store.setSelectedTrainNotch(MAX_NOTCH)
    run(store, 20)
    store.setSelectedTrainNotch(-4)
    run(store, 3)

    const state = buildConsoleState(store)!
    const dynamics = store.selectedTrainDynamics!
    expect(state.notch).toBe(-4)
    expect(state.handleEffort).toBe(dynamics.electricBrakeEffort)
    expect(state.handleEffort).toBeGreaterThan(0)
    expect(state.acceleration).toBeLessThan(0)
    // The reverser stays locked while the train rolls, even out of traction
    expect(state.reverserLocked).toBe(true)
  })

  it('shows the emergency brake, which can be reset only once stopped', () => {
    const store = makeDrivingStore()
    store.setSelectedTrainReverser('forward')
    store.setSelectedTrainBrakeCommand('release')
    run(store, 30)
    store.setSelectedTrainNotch(MAX_NOTCH)
    run(store, 15)
    store.toggleSelectedTrainEmergencyBrake()
    run(store, 0.5)

    const moving = buildConsoleState(store)!
    expect(moving.stopped).toBe(false)
    expect(moving.emergencyBrake).toBe(true)
    expect(moving.emergencyReleasable).toBe(false)
    expect(moving.brake!.tone).toBe('emergency')
    expect(moving.notch).toBeLessThanOrEqual(0)

    run(store, 60)
    const stopped = buildConsoleState(store)!
    expect(stopped.stopped).toBe(true)
    expect(stopped.emergencyBrake).toBe(true)
    expect(stopped.emergencyReleasable).toBe(true)
  })

  it('carries an infinite stopping distance as null, to stay plain JSON', () => {
    const store = makeDrivingStore()
    const train = store.selectedTrain!
    const dynamics = { ...store.selectedTrainDynamics!, stoppingDistance: Infinity }
    const state = trainConsoleState(train, dynamics)
    expect(state.stoppingDistance).toBeNull()
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  /** A stem along +x from 0 to 2000, then a straight branch and one diverging to +y (the right-hand side) */
  function makeForkStore(): EditorStore {
    const store = new EditorStore()
    const net = store.network
    const nStem = addNode(net, { x: 0, y: 0 })
    const nApex = addNode(net, { x: 2000, y: 0 })
    const nStraight = addNode(net, { x: 4000, y: 0 })
    const nDiv = addNode(net, { x: 4000, y: 300 })
    addSegment(net, nStem.id, nApex.id)
    const sStraight = addSegment(net, nApex.id, nStraight.id)!
    const sDiv = addSegment(net, nApex.id, nDiv.id)!
    addJunction(net, {
      nodeId: nApex.id,
      stemNodeId: nStem.id,
      straightNodeId: nStraight.id,
      divergingNodeId: nDiv.id,
      straightSegmentId: sStraight.id,
      divergingSegmentId: sDiv.id,
      hand: 'right',
      frogNumber: 4,
      activeBranch: 'straight',
    })
    return store
  }

  it('has no turnout ahead on plain track, and no other cab on a lone locomotive', () => {
    const state = buildConsoleState(makeDrivingStore())!
    expect(state.upcomingTurnout).toBeNull()
    expect(state.canSwitchCab).toBe(false)
  })

  it('tells the turnout the steering keys would throw: distance, side of the open route, lock', () => {
    const store = makeForkStore()
    expect(store.placeTrainLoco({ x: 1000, y: 0 })).toBe(true)
    store.togglePlayMode()
    const train = store.selectedTrain!
    // Make sure the nose points to the turnout whichever way the locomotive was laid
    const lead = train.vehicles[0].front
    if (!lead.forward) store.setSelectedTrainReverser('reverse')

    const ahead = buildConsoleState(store)!.upcomingTurnout!
    expect(ahead.distance).toBeGreaterThan(900)
    expect(ahead.distance).toBeLessThan(1100)
    expect(ahead).toMatchObject({ side: 'left', locked: false })

    store.steerUpcomingTurnout('right')
    expect(buildConsoleState(store)!.upcomingTurnout).toMatchObject({ side: 'right', locked: false })

    // Another train over the points: the steering is refused, and the console says so
    store.togglePlayMode()
    expect(store.placeTrainLoco({ x: 2000, y: 0 })).toBe(true)
    store.selectTrainById(train.id)
    store.togglePlayMode()
    if (!lead.forward) store.setSelectedTrainReverser('reverse')
    expect(buildConsoleState(store)!.upcomingTurnout).toMatchObject({ side: 'right', locked: true })
    store.steerUpcomingTurnout('left')
    expect(buildConsoleState(store)!.upcomingTurnout!.side).toBe('right')
    expect(JSON.parse(JSON.stringify(buildConsoleState(store)))).toEqual(buildConsoleState(store))
  })

  it('offers the other cab on a stopped rake with a power car at its tail, as `switchCab` applies it', () => {
    const store = makeDrivingStore()
    const train = store.selectedTrain!
    const loco = train.vehicles[0]
    // A second power car at the tail, as coupling builds it
    train.vehicles.push({ ...loco, id: 'tail', front: { ...loco.front, t: loco.front.t - 0.01 }, rear: { ...loco.rear, t: loco.rear.t - 0.01 } })
    expect(buildConsoleState(store)!.canSwitchCab).toBe(true)
    train.currentSpeed = 5
    expect(buildConsoleState(store)!.canSwitchCab).toBe(false)
    expect(store.switchSelectedTrainCab()).toBe(false)
    train.currentSpeed = 0
    expect(store.switchSelectedTrainCab()).toBe(true)
  })

  it('hands the console the limits, the curve and a derailment as the physics gives them', () => {
    const store = makeDrivingStore()
    const train = store.selectedTrain!
    const dynamics = store.selectedTrainDynamics!
    const state = (over: Partial<typeof dynamics>) => trainConsoleState(train, { ...dynamics, ...over })

    // Limit in m/s from the physics, in km/h on the console
    expect(state({ speedLimit: 160 / 3.6, nextSpeedLimit: null, curveState: 'ok' }).guidance).toEqual({
      speedLimit: 160,
      nextLimit: null,
      curve: 'ok',
      derailed: null,
    })
    expect(
      state({ speedLimit: 320 / 3.6, nextSpeedLimit: { speed: 90, distance: 1250.5 }, curveState: 'danger' }).guidance,
    ).toEqual({ speedLimit: 320, nextLimit: { speed: 90, distance: 1250.5 }, curve: 'danger', derailed: null })

    train.derailed = { speed: 235, limit: 160 }
    const derailed = state({ speedLimit: 160 / 3.6 })
    expect(derailed.guidance!.derailed).toEqual({ speed: 235, limit: 160 })
    // Plain JSON, like the rest of the state: it travels to the phone as it is
    expect(JSON.parse(JSON.stringify(derailed))).toEqual(derailed)
    train.derailed = null

    // The store builds the same thing for the driven train
    expect(buildConsoleState(store)!.guidance).toEqual(trainConsoleState(train, store.selectedTrainDynamics!).guidance)
  })

  it('gives the legacy locomotive no speed limit', () => {
    const store = makeForkStore()
    const stem = [...store.network.segments.keys()][0]
    store.locomotive = createLocomotive(store.network, stem, 0.5, 20, 14, 2)
    store.togglePlayMode()
    expect(buildConsoleState(store)!.guidance).toBeUndefined()
  })

  it('gives the legacy locomotive its turnout too, and no cab button', () => {
    const store = makeForkStore()
    const stem = [...store.network.segments.keys()][0]
    store.locomotive = createLocomotive(store.network, stem, 0.5, 20, 14, 2)
    store.togglePlayMode()
    const state = buildConsoleState(store)!
    expect(state.canSwitchCab).toBe(false)
    expect(state.upcomingTurnout).toMatchObject({ side: 'left', locked: false })
    expect(state.upcomingTurnout!.distance).toBeCloseTo(1000, 0)
    store.steerUpcomingTurnout('right')
    expect(buildConsoleState(store)!.upcomingTurnout!.side).toBe('right')
  })

  it('gives a reduced state for the legacy locomotive: a throttle, no air brake', () => {
    const store = makeStore()
    const segId = [...store.network.segments.keys()][0]
    store.locomotive = createLocomotive(store.network, segId, 0.5, 20, 14, 2)
    store.togglePlayMode()
    expect(store.selectedTrain).toBeNull()

    const idle = buildConsoleState(store)!
    expect(idle).toMatchObject({
      trainId: null,
      speed: 0,
      stopped: true,
      notch: 0,
      minNotch: -1,
      maxNotch: 1,
      brake: null,
      legacyThrottle: 0,
      emergencyBrake: false,
      locoCount: 1,
      wagonCount: 2,
      acceleration: 0,
    })

    store.setLocomotiveThrottle(1)
    store.locomotiveCurrentSpeed = 10
    const pulling = buildConsoleState(store)!
    expect(pulling).toMatchObject({ notch: 1, legacyThrottle: 1, handleEffort: 1, speed: 10, stopped: false })
    expect(pulling.acceleration).toBeGreaterThan(0)
    expect(pulling.stoppingDistance).toBeCloseTo(100 / (2 * store.locomotiveBraking))

    store.setLocomotiveThrottle(-1)
    expect(buildConsoleState(store)!.acceleration).toBeLessThan(0)
  })
})

describe('brake tone', () => {
  const train = (brakeCommand: 'apply' | 'hold' | 'release' = 'hold', emergencyBrake = false) => ({ brakeCommand, emergencyBrake })

  it('reads applied on a train that starts with its brakes applied', () => {
    expect(brakeTone(train(), { brakePipeBar: 3.5, brakeCylinderBar: 3.8 })).toBe('applied')
  })

  it('reads released only once the pipe is full and the cylinders are empty', () => {
    expect(brakeTone(train(), { brakePipeBar: 5, brakeCylinderBar: 0 })).toBe('released')
    // The pipe is back at 5 bar but the cylinders still hold pressure
    expect(brakeTone(train(), { brakePipeBar: 5, brakeCylinderBar: 1.6 })).toBe('releasing')
  })

  it('follows the handle while it is held', () => {
    expect(brakeTone(train('release'), { brakePipeBar: 4.1, brakeCylinderBar: 2.4 })).toBe('releasing')
    expect(brakeTone(train('apply'), { brakePipeBar: 4.6, brakeCylinderBar: 0.3 })).toBe('applying')
    // Full service reached: nothing more to wait for
    expect(brakeTone(train('apply'), { brakePipeBar: 3.5, brakeCylinderBar: 3.8 })).toBe('applied')
    // A light application left where it is
    expect(brakeTone(train('hold'), { brakePipeBar: 4.5, brakeCylinderBar: 1 })).toBe('applied')
  })

  it('shows the emergency brake above everything else', () => {
    expect(brakeTone(train('release', true), { brakePipeBar: 0, brakeCylinderBar: 3.8 })).toBe('emergency')
  })
})

describe('fleet list', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
  })

  it('lists every train with its rank, model, composition and which one is driven', () => {
    const store = makeStore()
    expect(buildFleet(store)).toEqual([])

    store.placeTrainLoco({ x: 500, y: 0 })
    store.placeTrainLoco({ x: 2500, y: 0 })
    expect(store.trains).toHaveLength(2)
    expect(buildFleet(store).map((f) => f.driven)).toEqual([false, false])
    // Selected in the editor is not driven: nobody drives outside driving mode
    expect(buildFleet(store).map((f) => f.driver)).toEqual([null, null])

    store.selectTrainById(store.trains[1].id)
    store.togglePlayMode()
    expect(buildFleet(store)).toEqual([
      { id: store.trains[0].id, rank: 1, model: 'TGV Duplex', locoCount: 1, wagonCount: 0, speed: 0, driven: false, driver: null },
      { id: store.trains[1].id, rank: 2, model: 'TGV Duplex', locoCount: 1, wagonCount: 0, speed: 0, driven: true, driver: 'host', driverName: 'PC' },
    ])
    store.togglePlayMode()
  })

  it('tells who drives each train, and gets it through the wire', () => {
    const store = makeStore()
    for (const x of [500, 1500, 2500]) expect(store.placeTrainLoco({ x, y: 0 })).toBe(true)
    const [a, b, c] = store.trains
    store.seatDesk(1, ' Léa ')
    store.seatDesk(2)
    expect(store.takeTrain(a.id, 1)).toBe(true)
    expect(store.takeTrain(b.id, 2)).toBe(true)
    const fleet = buildFleet(store)
    expect(fleet.map((f) => [f.id, f.driven, f.driver, f.driverName])).toEqual([
      [a.id, true, 1, 'Léa'],
      [b.id, true, 2, 'Pupitre 2'],
      [c.id, true, 'host', 'PC'],
    ])
    const decoded = decodeMessage(encodeMessage({ t: 'fleet', fleet }))
    expect(decoded).toEqual({ ok: true, message: { t: 'fleet', fleet } })

    // A desk on the train of the PC: the PC drives nothing, one train is nobody's
    expect(store.takeTrain(c.id, 2)).toBe(true)
    const after = buildFleet(store)
    expect(after.map((f) => [f.driven, f.driver, f.driverName])).toEqual([
      [true, 1, 'Léa'],
      [false, null, undefined],
      [true, 2, 'Pupitre 2'],
    ])
    expect(decodeMessage(encodeMessage({ t: 'fleet', fleet: after }))).toEqual({ ok: true, message: { t: 'fleet', fleet: after } })
    store.togglePlayMode()
  })
})

describe('console state of a desk', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
  })

  it('is that of the train the desk holds, whatever the PC looks at, and null while it holds none', () => {
    const store = makeStore()
    for (const x of [500, 1500, 2500]) expect(store.placeTrainLoco({ x, y: 0 })).toBe(true)
    const [a, b, c] = store.trains
    expect(buildDeskConsoleState(store, 1)).toBeNull()
    expect(store.takeTrain(a.id, 1)).toBe(true)
    expect(store.takeTrain(b.id, 2)).toBe(true)
    store.setTrainNotch(a, 3)
    store.setTrainNotch(b, -2)
    store.setSelectedTrainNotch(1)

    expect(buildDeskConsoleState(store, 1)).toMatchObject({ trainId: a.id, notch: 3 })
    expect(buildDeskConsoleState(store, 2)).toMatchObject({ trainId: b.id, notch: -2 })
    expect(buildDeskConsoleState(store, 3)).toBeNull()
    expect(buildConsoleState(store)).toMatchObject({ trainId: c.id, notch: 1 })
    // The same figures as any console of that train
    expect(buildDeskConsoleState(store, 1)).toEqual(buildTrainConsoleState(store, a))

    // After a step of the simulation: each its own speed and pressures, read once
    run(store, 1)
    const one = buildDeskConsoleState(store, 1)!
    expect(one).toEqual(buildTrainConsoleState(store, a))
    expect(one).toMatchObject(trainConsoleState(a, store.dynamicsOf(a), one.upcomingTurnout))
    expect(buildDeskConsoleState(store, 2)!.trainId).toBe(b.id)
    expect(store.dynamicsOf(a)).not.toBe(store.dynamicsOf(b))

    store.releaseTrain(1)
    expect(buildDeskConsoleState(store, 1)).toBeNull()
    expect(buildDeskConsoleState(store, 2)).not.toBeNull()
    // Outside driving mode no desk has a console
    store.togglePlayMode()
    expect(buildDeskConsoleState(store, 2)).toBeNull()
  })
})

describe('console state: signals', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
  })

  /** What the phone receives of a state: through the wire and back */
  const overTheWire = (state: unknown) => {
    const decoded = decodeMessage(encodeMessage({ t: 'state', state: state as never, ack: 1 }))
    if (!decoded.ok || decoded.message.t !== 'state') throw new Error('state refused by the protocol')
    return decoded.message.state
  }

  /** A line of 4 000 m with block signals for eastbound trains, a driven train at x = 1900 and maybe one standing ahead */
  function signalledStore(options: { ahead?: number; signalsAt?: number[] } = {}) {
    const store = new EditorStore()
    chain(store.network, Array.from({ length: 9 }, (_, i) => ({ x: i * 500, y: 0 })))
    const signals = (options.signalsAt ?? [2000.5, 3000.5]).map((x) => signalAt(store.network, x, 0, 'east'))
    store.trains = [trainAt(store.network, 1900, 0, 'east')]
    if (options.ahead !== undefined) store.trains.push(trainAt(store.network, options.ahead, 0, 'east'))
    store.markDirty()
    const train = store.trains[0]
    store.selectTrainById(train.id)
    store.togglePlayMode()
    return { store, train, signals }
  }

  it('has no `signals` at all on a network without signal: the state is what it always was', () => {
    const store = makeDrivingStore()
    run(store, 0.2)
    const state = buildConsoleState(store)!
    expect('signals' in state).toBe(false)
    expect(Object.keys(state).sort()).toEqual([
      'acceleration', 'brake', 'canSwitchCab', 'emergencyBrake', 'emergencyReleasable', 'gradientPermille', 'guidance',
      'handleEffort', 'locoCount', 'maxNotch', 'maxSpeed', 'minNotch', 'notch', 'reverser', 'reverserLocked', 'speed',
      'stopped', 'stoppingDistance', 'trainId', 'upcomingTurnout', 'wagonCount',
    ])
    // The pro level and a high-speed line change nothing to that
    store.setSignallingSettings({ level: 'pro' })
    store.setLineSettings({ lineType: 'highSpeed', lineSpeed: 300 })
    expect('signals' in buildConsoleState(store)!).toBe(false)
    expect(overTheWire(state)).toEqual(state)
  })

  it('has none for the legacy locomotive', () => {
    const store = makeStore()
    signalAt(store.network, 2000, 0, 'east')
    store.locomotive = createLocomotive(store.network, store.network.segments.keys().next().value!, 0.25)
    store.togglePlayMode()
    const state = buildConsoleState(store)
    if (state) expect('signals' in state).toBe(false)
  })

  it('tells the next signal with its state and its distance from the head of the train', () => {
    const { store, train } = signalledStore()
    drive(train, 5)
    store.tickAllTrains(0.05)
    const state = buildConsoleState(store)!
    const view = store.selectedTrainSignals!
    expect(state.signals).toEqual({
      level: 'standard',
      next: { distance: view.nextSignal!.distance, color: 'green', indication: null, plate: null, lit: true, label: 'Voie libre' },
      closedDistance: null,
      brakeAlert: false,
      waiting: false,
      onSight: false,
      onSightSpeed: ON_SIGHT_SPEED,
      passed: null,
      cab: null,
    })
    expect(state.signals!.next!.distance).toBeGreaterThan(80)
    expect(state.signals!.next!.distance).toBeLessThan(100)
    // The phone gets the same thing
    expect(overTheWire(state)).toEqual(state)
  })

  it('tells the first closed signal when it is further than the next one, and the brake alert when it comes close', () => {
    // A train stands at x = 3200: the signal at 3000 is closed, the one at 2000 shows caution
    const { store, train } = signalledStore({ ahead: 3200 })
    drive(train, 5)
    store.tickAllTrains(0.05)
    const far = buildConsoleState(store)!.signals!
    expect(far.next).toMatchObject({ color: 'yellow', label: 'Attention' })
    expect(far.closedDistance).toBeGreaterThan(1050)
    expect(far.closedDistance).toBeLessThan(1150)
    expect(far.brakeAlert).toBe(false)

    // Much faster: the closed signal is within the stopping distance and its margin
    drive(train, 60)
    store.tickAllTrains(0.05)
    const fast = buildConsoleState(store)!
    expect(fast.signals!.brakeAlert).toBe(true)
    expect(fast.signals!.closedDistance).not.toBeNull()
    expect(overTheWire(fast)).toEqual(fast)
  })

  it('does not repeat the closed signal when it is the next one', () => {
    const { store, train } = signalledStore({ ahead: 2500 })
    drive(train, 5)
    store.tickAllTrains(0.05)
    const signals = buildConsoleState(store)!.signals!
    expect(signals.next).toMatchObject({ color: 'red', label: 'Arrêt' })
    expect(signals.closedDistance).toBeNull()
  })

  it('reads the signals the way the level of the project does', () => {
    const { store, train } = signalledStore({ ahead: 2500 })
    store.setSignallingSettings({ level: 'pro' })
    drive(train, 5)
    store.tickAllTrains(0.05)
    const state = buildConsoleState(store)!
    expect(state.signals).toMatchObject({
      level: 'pro',
      next: { color: 'red', indication: 'semaphore', plate: 'F', lit: true, label: 'Sémaphore' },
      cab: null,
    })
    expect(overTheWire(state)).toEqual(state)
  })

  it('reports a closed signal passed once — to the PC by its callback, to the phone by its states', () => {
    const { store, train } = signalledStore({ ahead: 2500 })
    const toasts: string[] = []
    store.onSignalPassed = (t) => toasts.push(signalPassedMessage(t.signalPassed?.braked ?? false))
    const announced = new Set<string>()
    const phone: string[] = []
    drive(train, 20)
    for (let i = 0; i < 300; i++) {
      store.tickAllTrains(0.1)
      const message = newSignalPassed(announced, overTheWire(buildConsoleState(store)))
      if (message) phone.push(message)
    }
    expect(toasts).toEqual(['Signal fermé franchi : freinage d’urgence'])
    expect(phone).toEqual(toasts)
    expect(phone[0]).toBe(signalPassedLabel(true))
    // The trace stays on the state while the train stands past the signal
    expect(buildConsoleState(store)!.signals!.passed).toEqual({ braked: true })
    expect(train.emergencyBrake).toBe(true)
  })

  it('tells the running on sight after a closed block signal passed at the pro level', () => {
    const { store, train } = signalledStore({ ahead: 2500 })
    store.setSignallingSettings({ level: 'pro' })
    // Come to a stand before the signal at 2000, then pass it
    store.tickAllTrains(0.05)
    expect(buildConsoleState(store)!.signals).toMatchObject({ onSight: false })
    train.reverser = 'forward'
    store.tickAllTrains(0.05)
    drive(train, 3)
    let passed = 0
    store.onSignalPassed = () => passed++
    for (let i = 0; i < 2000 && !buildConsoleState(store)!.signals!.onSight; i++) {
      train.currentSpeed = 3
      store.tickAllTrains(0.05)
    }
    const state = buildConsoleState(store)!
    expect(state.signals).toMatchObject({ onSight: true, onSightSpeed: 30, passed: null })
    // The 30 km/h are in the limit the physics gives, the one every console reads
    expect(state.guidance!.speedLimit).toBe(30)
    expect(store.selectedTrainDynamics!.speedLimit * 3.6).toBeCloseTo(30, 6)
    // Passed by the rules: no fault reported, no emergency brake
    expect(passed).toBe(0)
    expect(train.emergencyBrake).toBe(false)
    expect(overTheWire(state)).toEqual(state)
  })

  it('pro level: tells the announcement and the reminder of points to take on their diverging route, and their limit', () => {
    // Points at x = 1000 whose branch leaves at a tangent of 0.12 (30 km/h); a block signal at 700, a path signal at 900
    const store = new EditorStore()
    const main = chain(store.network, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 3000, y: 0 }])
    const branch = chain(store.network, [{ x: 1200, y: 24 }, { x: 3000, y: 24 }], main.nodes[1])
    syncJunctions(store.network)
    signalAt(store.network, 700, 0, 'east')
    signalAt(store.network, 900, 0, 'east', 'protection')
    signalAt(store.network, 1800, 24, 'east')
    setPoints(store.network, main.nodes[1], main.rails[0], branch.rails[0])
    store.trains = [trainAt(store.network, 550, 0, 'east')]
    store.markDirty()
    store.setSignallingSettings({ level: 'pro' })
    const train = store.trains[0]
    store.selectTrainById(train.id)
    store.togglePlayMode()
    drive(train, 10)
    store.tickAllTrains(0.02)

    const before = buildConsoleState(store)!
    expect(before.signals!.next).toMatchObject({ indication: 'ralentissement', label: 'Ralentissement 30', color: 'yellow', slowdown: 30, plate: 'F' })
    expect('reminder' in before.signals!.next!).toBe(false)
    // The limit of the points is announced like any other
    expect(before.guidance!.speedLimit).toBe(160)
    expect(before.guidance!.nextLimit).toMatchObject({ speed: 30 })
    expect(overTheWire(before)).toEqual(before)

    // Past the block signal: the path signal reminds of it
    for (let i = 0; i < 400 && buildConsoleState(store)!.signals!.next?.plate !== 'Nf'; i++) {
      train.currentSpeed = 10
      store.tickAllTrains(0.05)
    }
    const after = buildConsoleState(store)!
    expect(after.signals!.next).toMatchObject({ indication: 'rappel', label: 'Rappel 30', reminder: 30, plate: 'Nf' })
    expect(overTheWire(after)).toEqual(after)

    // On the points: 30 km/h is the limit in force
    for (let i = 0; i < 3000 && buildConsoleState(store)!.guidance!.speedLimit !== 30; i++) {
      train.currentSpeed = 5
      store.tickAllTrains(0.05)
    }
    expect(buildConsoleState(store)!.guidance!.speedLimit).toBe(30)
    expect(train.emergencyBrake).toBe(false)

    // The standard level reads the same layout with three colours and no limit at the points
    store.setSignallingSettings({ level: 'standard' })
    train.currentSpeed = 5
    store.tickAllTrains(0.05)
    const standard = buildConsoleState(store)!
    expect(standard.guidance!.speedLimit).toBe(160)
    expect(standard.signals!.next ? 'slowdown' in standard.signals!.next || 'reminder' in standard.signals!.next : false).toBe(false)
  })

  describe('cab display', () => {
    /** 9 km of high-speed line, markers every 1 500 m, the driven train at x = 200 and one standing at x = 6200 */
    function lgvStore() {
      const store = new EditorStore()
      chain(store.network, [{ x: 0, y: 0 }, { x: 9000, y: 0 }])
      for (let x = 1500; x < 9000; x += 1500) {
        setSignalOptions(store.network, signalAt(store.network, x, 0, 'east').id, { cabMarker: true })
      }
      store.trains = [trainAt(store.network, 200, 0, 'east'), trainAt(store.network, 6200, 0, 'east')]
      store.markDirty()
      store.setSignallingSettings({ level: 'pro' })
      store.setLineSettings({ lineType: 'highSpeed', lineSpeed: 300 })
      const train = store.trains[0]
      store.selectTrainById(train.id)
      store.togglePlayMode()
      return { store, train }
    }

    it('is shown at the pro level on a high-speed line, with the distance to the next marker', () => {
      const { store, train } = lgvStore()
      drive(train, 5)
      store.tickAllTrains(0.05)
      const state = buildConsoleState(store)!
      // Markers at 1500, 3000, 4500 and the closed one at 6000: four free blocks, the last one the
      // buffer block kept free behind the train ahead — 220 announced
      expect(state.signals!.cab).toMatchObject({ kind: 'announce', speed: 220, flashing: false })
      expect(state.signals!.cab!.markerDistance).toBeCloseTo(state.signals!.next!.distance, 6)
      // The marker itself has no lamp
      expect(state.signals!.next).toMatchObject({ lit: false, plate: 'F' })
      expect(overTheWire(state)).toEqual(state)
    })

    it('is not shown at the standard level, nor on a conventional line', () => {
      const { store, train } = lgvStore()
      drive(train, 5)
      store.tickAllTrains(0.05)
      store.setSignallingSettings({ level: 'standard' })
      expect(buildConsoleState(store)!.signals).toMatchObject({ level: 'standard', cab: null })
      store.setSignallingSettings({ level: 'pro' })
      store.setLineSettings({ lineType: 'classic', lineSpeed: 160 })
      expect(buildConsoleState(store)!.signals).toMatchObject({ level: 'pro', cab: null })
    })

    it('is capped by a speed zone over the train', () => {
      const { store, train } = lgvStore()
      const rail = store.network.segments.keys().next().value!
      addSpeedZone(store.network, [{ segId: rail, t0: 0, t1: 0.1 }], 160)
      drive(train, 5)
      store.tickAllTrains(0.05)
      expect(buildConsoleState(store)!.signals!.cab).toMatchObject({ kind: 'execute', speed: 160, flashing: false })
    })

    it('reads the same twice, and keeps what it shows until the next marker when the track ahead gets worse', () => {
      const { store, train } = lgvStore()
      drive(train, 5)
      store.tickAllTrains(0.05)
      expect(buildConsoleState(store)!.signals!.cab).toMatchObject({ kind: 'announce', speed: 220 })
      // A train appears two blocks ahead: nothing changes in the cab before the next marker
      store.trains.push(trainAt(store.network, 3200, 0, 'east'))
      train.currentSpeed = 5
      store.tickAllTrains(0.05)
      expect(buildConsoleState(store)!.signals!.cab).toMatchObject({ kind: 'announce', speed: 220 })
      expect(buildConsoleState(store)!.signals!.cab).toMatchObject({ kind: 'announce', speed: 220 })
      // It leaves again: nothing was ever shown of it
      store.trains.pop()
      train.currentSpeed = 5
      store.tickAllTrains(0.05)
      expect(buildConsoleState(store)!.signals!.cab).toMatchObject({ kind: 'announce', speed: 220 })
    })

    it('shows the line speed of a train that is slower than the line as its own', () => {
      const { store, train } = lgvStore()
      store.trains.pop()
      train.maxSpeed = 200 / 3.6
      drive(train, 5)
      store.tickAllTrains(0.05)
      // Five markers then the end of the track: six blocks, nothing announced
      expect(buildConsoleState(store)!.signals!.cab).toMatchObject({ kind: 'line', speed: 200 })
    })
  })
})
