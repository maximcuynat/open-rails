import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { addJunction } from '@domain/models/junction'
import { createLocomotive } from '@domain/models/locomotive'
import { MAX_NOTCH, MIN_NOTCH } from '@domain/models/train'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { brakeTone, buildConsoleState, buildFleet, trainConsoleState } from './consoleState'

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

    store.selectTrainById(store.trains[1].id)
    store.togglePlayMode()
    expect(buildFleet(store)).toEqual([
      { id: store.trains[0].id, rank: 1, model: 'TGV Duplex', locoCount: 1, wagonCount: 0, speed: 0, driven: false },
      { id: store.trains[1].id, rank: 2, model: 'TGV Duplex', locoCount: 1, wagonCount: 0, speed: 0, driven: true },
    ])
  })
})
