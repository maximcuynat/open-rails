import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { applyConsoleCommand } from '@application/console/consoleCommands'
import { buildTrainConsoleState } from '@application/console/consoleState'
import { PILOT_STOP_TOLERANCE, pilotOrders, pilotSpeed } from '@application/console/autopilot'
import type { ConsoleState } from '@application/console/consoleContract'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { setSignalOptions } from '@domain/models/signals'
import { signalAt, trainAt } from '@domain/models/signalling.testkit'
import { addStation } from '@domain/models/stations'
import { addPlatform, defaultMarkers } from '@domain/models/platforms'
import type { PlatformEdge } from '@domain/models/types'
import { vehicleFrontEndPos } from '@domain/models/train'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { addItineraryStop, refreshRouteGuide } from './itinerary'
import { PILOT_DWELL_S } from './autopilot'

/**
 * A straight line of `km` kilometres in rails of 500 m, with « Départ » at 500 m and the other
 * stations where asked (km). A rake is set down at « Départ » and the driving started. Between
 * the kilometres of `climb` the line rises one level per rail: a ramp of 12 ‰.
 */
function line(km: number, stations: Record<string, number>, climb?: [number, number]) {
  resetMemoryStorage()
  resetIdCounter()
  const store = new EditorStore()
  const net = store.network
  const rails: string[] = []
  let level = 0
  let prev = addNode(net, { x: 0, y: 0 }, level)
  for (let x = 500; x <= km * 1000; x += 500) {
    if (climb && x > climb[0] * 1000 && x <= climb[1] * 1000) level++
    const next = addNode(net, { x, y: 0 }, level)
    rails.push(addSegment(net, prev.id, next.id)!.id)
    prev = next
  }
  const at = (m: number) => ({ segId: rails[Math.min(rails.length - 1, Math.floor(m / 500))], t: (m % 500) / 500 })
  addStation(net, { id: 'depart', name: 'Départ', pos: { x: 500, y: 0 }, stops: [at(500 + 250)] })
  for (const [id, where] of Object.entries(stations)) addStation(net, { id, name: id, pos: { x: where * 1000, y: 0 }, stops: [at(where * 1000)] })
  store.notify()
  expect(store.placeRakeAtStation('depart', 'duplex')).not.toBeNull()
  store.togglePlayMode()
  // The head of the train: its nose, the front end of the lead vehicle — what stops on the mark
  const headX = () => vehicleFrontEndPos(store.network, store.trains[0].vehicles[0])!.x
  /** Run the simulation for `seconds`, 20 steps a second; returns the top speed reached, m/s */
  const run = (seconds: number, until: () => boolean = () => false): number => {
    let top = 0
    for (let i = 0; i < seconds * 20 && !until(); i++) {
      store.tickAllTrains(0.05)
      top = Math.max(top, store.trains[0].currentSpeed)
    }
    return top
  }
  /** Run until `until`, and say how the pilot held the speed it aimed at and how it moved the handle */
  const watch = (until: () => boolean) => {
    const train = store.trains[0]
    const seen = { under: 0, over: 0, moves: 0, largest: 0, steepest: 0 }
    for (let i = 0; i < 20 * 3600 && !until(); i++) {
      const before = train.notch
      store.tickAllTrains(0.05)
      const state = buildTrainConsoleState(store, train)
      const gap = train.currentSpeed - pilotSpeed(state, { stopIn: null }).speed
      seen.under = Math.max(seen.under, -gap)
      seen.over = Math.max(seen.over, gap)
      seen.largest = Math.max(seen.largest, Math.abs(train.notch - before))
      seen.steepest = Math.max(seen.steepest, state.gradientPermille)
      if (train.notch !== before) seen.moves++
    }
    return seen
  }
  return { store, headX, run, watch, train: () => store.trains[0] }
}

/** A console state with only what the pilot reads set */
const state = (over: Partial<ConsoleState>): ConsoleState => ({
  trainId: 't', speed: 0, maxSpeed: 88, stopped: false, notch: 0, minNotch: -10, maxNotch: 10, handleEffort: 0, reverser: 'forward', reverserLocked: false,
  emergencyBrake: false, emergencyReleasable: false, brake: { command: 'hold', tone: 'released', pipeBar: 5, cylinderBar: 0 }, acceleration: 0, gradientPermille: 0,
  stoppingDistance: null, locoCount: 2, wagonCount: 8, upcomingTurnout: null, canSwitchCab: true,
  guidance: { speedLimit: 160, nextLimit: null, curve: 'ok' as never, derailed: null },
  ...over,
})

describe('what the pilot does with the handles', () => {
  it('moves the handle one notch at a time towards the acceleration that brings the train onto its speed', () => {
    const free = { stopIn: null }
    // Well under the limit: a notch more, once the effort has caught up with the one it is on
    expect(pilotOrders(state({ speed: 10 }), free)).toMatchObject({ notch: 1, brake: 'hold' })
    expect(pilotOrders(state({ speed: 10, notch: 4, handleEffort: 0.4, acceleration: 0.2 }), free).notch).toBe(5)
    expect(pilotOrders(state({ speed: 10, notch: 4, handleEffort: 0.2, acceleration: 0.1 }), free).notch).toBe(4)
    expect(pilotOrders(state({ speed: 10, notch: 10, handleEffort: 1, acceleration: 0.4 }), free).notch).toBe(10)
    // On its speed and holding it: the handle stays where it is, wherever that is
    const aim = pilotSpeed(state({ speed: 40 }), free).speed
    expect(pilotOrders(state({ speed: aim, notch: 3, handleEffort: 0.3, acceleration: 0 }), free)).toMatchObject({ notch: 3, brake: 'hold' })
    // Still gaining on it: a notch less, at once
    expect(pilotOrders(state({ speed: aim, notch: 3, handleEffort: 0.1, acceleration: 0.2 }), free).notch).toBe(2)
    // Over it: down through N to the electric brake, the air brake when well over
    expect(pilotOrders(state({ speed: aim + 1, acceleration: 0 }), free)).toMatchObject({ notch: -1, brake: 'hold' })
    expect(pilotOrders(state({ speed: aim + 1, notch: -1, handleEffort: 0, acceleration: 0 }), free).notch).toBe(-1)
    expect(pilotOrders(state({ speed: aim + 1, notch: -1, handleEffort: 0.1, acceleration: -0.03 }), free).notch).toBe(-2)
    expect(pilotOrders(state({ speed: aim + 4, acceleration: 0 }), free)).toMatchObject({ notch: -1, brake: 'apply' })
    // No traction against brake cylinders that are still full, no electric brake at a crawl
    const braked = { command: 'hold' as const, tone: 'applied' as const, pipeBar: 4, cylinderBar: 2 }
    expect(pilotOrders(state({ speed: 10, brake: braked }), free)).toMatchObject({ notch: 0, brake: 'release' })
    expect(pilotOrders(state({ speed: 2, guidance: { speedLimit: 5, nextLimit: null, curve: 'ok' as never, derailed: null } }), free).notch).toBe(0)
    // 160 km/h: it runs just under
    expect(pilotSpeed(state({ speed: 40 }), { stopIn: null }).speed).toBeCloseTo((160 / 3.6) * 0.97 - 0.5, 6)
  })

  it('slows in time for a lower limit, a closed signal, a train ahead and a platform', () => {
    const fast = { speed: 44, stoppingDistance: 1100 }
    const free = pilotSpeed(state(fast), { stopIn: null }).speed
    const limit = pilotSpeed(state({ ...fast, guidance: { speedLimit: 160, nextLimit: { speed: 60, distance: 900 }, curve: 'ok' as never, derailed: null } }), { stopIn: null }).speed
    const signal = pilotSpeed(state({ ...fast, signals: { level: 'standard', next: null, closedDistance: 900, brakeAlert: false, waiting: false, onSight: false, onSightSpeed: 30, passed: null, cab: null } }), { stopIn: null }).speed
    const ahead = pilotSpeed(state({ ...fast, ahead: { distance: 900, speed: 5, driver: null } }), { stopIn: null }).speed
    const platform = pilotSpeed(state(fast), { stopIn: 900 }).speed
    for (const slowed of [limit, signal, ahead, platform]) expect(slowed).toBeLessThan(free)
    // Further away, nothing to do yet
    expect(pilotSpeed(state(fast), { stopIn: 20_000 }).speed).toBe(free)
  })

  it('meets a speed announced in the cab at the next marker board, not at once', () => {
    const cabState = (kind: 'announce' | 'execute', markerDistance: number | null) => state({
      speed: 80, stoppingDistance: 3600, maxSpeed: 89,
      guidance: { speedLimit: 300, nextLimit: null, curve: 'ok' as never, derailed: null },
      signals: { level: 'pro', next: null, closedDistance: null, brakeAlert: false, waiting: false, onSight: false, onSightSpeed: 30, passed: null, cab: { kind, speed: 160, flashing: false, markerDistance } },
    })
    const free = { stopIn: null }
    const at160 = (160 / 3.6) * 0.97 - 0.5
    // Six kilometres from the board: nothing to do yet. Nearer: down the braking curve. At it: 160
    expect(pilotSpeed(cabState('announce', 6000), free).speed).toBeCloseTo((300 / 3.6) * 0.97 - 0.5, 6)
    const nearer = pilotSpeed(cabState('announce', 3000), free).speed
    expect(nearer).toBeGreaterThan(at160)
    expect(nearer).toBeLessThan(80)
    expect(pilotSpeed({ ...cabState('announce', 0), speed: 44 }, free).speed).toBeCloseTo(at160, 6)
    // A speed to run at now, or no board in sight: at once
    expect(pilotSpeed(cabState('execute', 3000), free).speed).toBeCloseTo(at160, 6)
    expect(pilotSpeed(cabState('announce', null), free).speed).toBeCloseTo(at160, 6)
  })

  it('stands still with the brakes on at its stopping place, and leaves with the reverser forward first', () => {
    const there = pilotOrders(state({ speed: 0, stopped: true }), { stopIn: 1 })
    expect(there).toMatchObject({ notch: 0, brake: 'apply', forward: false })
    const parked = state({ speed: 0, stopped: true, reverser: 'neutral', brake: { command: 'hold', tone: 'applied', pipeBar: 3.5, cylinderBar: 3.8 } })
    expect(pilotOrders(parked, { stopIn: null })).toMatchObject({ notch: 0, forward: true })
    // Brakes still on: it releases them before pulling
    expect(pilotOrders({ ...parked, reverser: 'forward' }, { stopIn: null })).toMatchObject({ notch: 0, brake: 'release' })
  })

  it('resets an emergency stop once at a stand, and does nothing on a derailed train', () => {
    expect(pilotOrders(state({ emergencyBrake: true, emergencyReleasable: false, speed: 20 }), { stopIn: null })).toMatchObject({ notch: 0, resetEmergency: false })
    expect(pilotOrders(state({ emergencyBrake: true, emergencyReleasable: true, stopped: true }), { stopIn: null }).resetEmergency).toBe(true)
    const derailed = state({ speed: 0, guidance: { speedLimit: 160, nextLimit: null, curve: 'ok' as never, derailed: { speed: 200, limit: 100 } } })
    expect(pilotOrders(derailed, { stopIn: null })).toMatchObject({ notch: 0, brake: 'hold', forward: false })
  })
})

// Minutes of simulated driving each: seconds of work, more when the whole suite runs beside
describe('the automatic pilot on a train of the game', { timeout: 30_000 }, () => {
  beforeEach(() => resetMemoryStorage())

  it('takes a train from one station to the platform of the next and stops there', () => {
    const { store, headX, run, train } = line(14, { arrivee: 12 })
    expect(addItineraryStop(store, train(), 'arrivee')).toBeNull()
    store.setAutopilot(train().id, true)
    const limit = buildTrainConsoleState(store, train()).guidance!.speedLimit / 3.6
    const top = run(900, () => train().itinerary!.next === 2 && train().currentSpeed === 0)
    // It got going, never over the limit, and stands at the platform: not short of it, not past it
    expect(top).toBeGreaterThan(30)
    expect(top).toBeLessThanOrEqual(limit + 0.5)
    expect(train().currentSpeed).toBe(0)
    expect(train().itinerary).toEqual({ stations: ['depart', 'arrivee'], next: 2 })
    expect(headX()).toBeGreaterThan(12_000 - 3)
    expect(headX()).toBeLessThanOrEqual(12_000 + 1)
    expect(train().emergencyBrake).toBe(false)
    // Arrived: it stays there
    run(60)
    expect(headX()).toBeLessThanOrEqual(12_000 + 1)
  })

  it('stops the nose on the stop marker of a platform, and tells the console how far that marker is', () => {
    const { store, headX, run, train } = line(6, { arrivee: 4 })
    // A platform of 220 m ending at km 4, on the rail from 3500 to 4000: its marker for eastbound trains at 3990
    const rail = [...store.network.segments.values()].find((seg) => store.network.nodes.get(seg.to)!.pos.x === 4000)!
    const edges: [PlatformEdge] = [{ track: [{ segId: rail.id, t0: (3780 - 3500) / 500, t1: 1 }], side: 'left', ref: 'B' }]
    addPlatform(store.network, { stationId: 'arrivee', edges, width: 6, markers: defaultMarkers(store.network, edges, 10) })
    store.notify()
    expect(addItineraryStop(store, train(), 'arrivee')).toBeNull()
    // « Prochain arrêt »: from the nose to the marker, along the track
    expect(buildTrainConsoleState(store, train()).route!.distance).toBeCloseTo(3990 - headX(), 3)
    store.setAutopilot(train().id, true)
    run(300, () => headX() > 3000)
    // The way is measured once a second: measured again now
    refreshRouteGuide(store, train())
    expect(buildTrainConsoleState(store, train()).route!.distance).toBeCloseTo(3990 - headX(), 3)
    run(600, () => train().itinerary!.next === 2 && train().currentSpeed === 0)
    expect(train().itinerary!.next).toBe(2)
    expect(headX()).toBeGreaterThan(3990 - PILOT_STOP_TOLERANCE)
    expect(headX()).toBeLessThanOrEqual(3990 + 1)
  })

  it('comes to a platform in one steady braking: no speeding up again, no crawling, the brake not hunting', () => {
    const { store, headX, train } = line(14, { arrivee: 12 })
    addItineraryStop(store, train(), 'arrivee')
    store.setAutopilot(train().id, true)
    const seen = { sped: 0, slow: 0, strongest: 0, pulled: false, reversals: 0 }
    let push: string | null = null
    for (let i = 0; i < 20 * 900 && !(train().itinerary!.next === 2 && train().currentSpeed === 0); i++) {
      const before = train().currentSpeed
      store.tickAllTrains(0.05)
      if (headX() < 12_000 - 1500) continue
      const gained = train().currentSpeed - before
      seen.sped = Math.max(seen.sped, gained)
      seen.strongest = Math.max(seen.strongest, -gained / 0.05)
      if (train().currentSpeed < 2) seen.slow += 0.05
      if (train().notch > 0) seen.pulled = true
      const command = train().brakeCommand
      if (command !== 'hold' && command !== push) {
        if (push !== null) seen.reversals++
        push = command
      }
    }
    expect(train().currentSpeed).toBe(0)
    expect(seen.pulled).toBe(false)
    expect(seen.sped).toBeLessThan(1e-3)
    // Comfortable all the way, the last metres included
    expect(seen.strongest).toBeLessThan(0.8)
    expect(seen.slow).toBeLessThan(9)
    expect(seen.reversals).toBeLessThan(10)
  })

  it('calls at a station on the way for a while, then goes on to the last', () => {
    const { store, headX, run, train } = line(14, { etape: 5, arrivee: 12 })
    addItineraryStop(store, train(), 'arrivee')
    addItineraryStop(store, train(), 'etape')
    expect(train().itinerary!.stations).toEqual(['depart', 'etape', 'arrivee'])
    store.setAutopilot(train().id, true)
    run(600, () => train().itinerary!.next === 2 && train().currentSpeed === 0)
    expect(headX()).toBeGreaterThan(5000 - 3)
    expect(headX()).toBeLessThanOrEqual(5000 + 1)
    // Still there half the call later, gone after it
    run(PILOT_DWELL_S / 2)
    expect(train().currentSpeed).toBe(0)
    run(900, () => train().itinerary!.next === 3 && train().currentSpeed === 0)
    expect(train().itinerary!.next).toBe(3)
    expect(headX()).toBeGreaterThan(12_000 - 3)
    expect(headX()).toBeLessThanOrEqual(12_000 + 1)
  })

  it('sent the way it does not face, changes ends once and leaves', () => {
    // « Départ » is at 500 m of a 14 km line: the rake is set down facing the long way, east
    const { store, headX, run, train } = line(14, {})
    addStation(store.network, { id: 'ouest', name: 'Ouest', pos: { x: 0, y: 0 }, stops: [{ segId: [...store.network.segments.keys()][0], t: 0.1 }] })
    // No aid: nothing turns the train when its itinerary is set
    store.setDrivingAid('none')
    const first = headX()
    expect(addItineraryStop(store, train(), 'ouest')).toBeNull()
    expect(headX()).toBe(first)
    store.setAutopilot(train().id, true)
    run(60)
    // It is on its way west, reverser forward, not standing with its controls reset over and over
    expect(train().reverser).toBe('forward')
    expect(headX()).toBeLessThan(first)
    expect(train().currentSpeed).toBeGreaterThan(0)
  })

  it('gives the train back as soon as the driver touches a handle', () => {
    const { store, run, train } = line(14, { arrivee: 12 })
    addItineraryStop(store, train(), 'arrivee')
    store.setAutopilot(train().id, true)
    run(20)
    expect(buildTrainConsoleState(store, train()).autopilot).toBe(true)
    applyConsoleCommand(store, { type: 'notchSet', notch: 0 })
    expect(store.autopilots.has(train().id)).toBe(false)
    expect(buildTrainConsoleState(store, train()).autopilot).toBeUndefined()
    // Leaving the driving keeps the pilot on its train; putting every train at rest lets it go
    store.setAutopilot(train().id, true)
    store.togglePlayMode()
    expect(store.autopilots.has(train().id)).toBe(true)
    expect(store.isSimulationHeld).toBe(true)
    store.haltAllTrains()
    expect(store.autopilots.size).toBe(0)
    expect(store.isSimulationHeld).toBe(false)
  })

  it('holds its speed on level track hardly touching the handle, and up a ramp within a few notches', () => {
    const { store, headX, watch, train } = line(40, {}, [16, 22])
    train().itinerary = undefined
    store.setAutopilot(train().id, true)
    // Getting up to speed: never more than a notch at a time
    const start = watch(() => headX() > 8000)
    expect(start.largest).toBe(1)
    const level = watch(() => headX() > 15_000)
    // Seven kilometres of level track: the handle settles and stays
    expect(level.steepest).toBe(0)
    expect(level.moves).toBeLessThanOrEqual(3)
    expect(level.under).toBeLessThan(0.3)
    expect(level.over).toBeLessThan(0.3)
    const ramp = watch(() => headX() > 24_000)
    expect(ramp.steepest).toBeCloseTo(12, 6)
    expect(ramp.under).toBeLessThan(0.5)
    expect(ramp.over).toBeLessThan(0.5)
    expect(ramp.largest).toBe(1)
    expect(ramp.moves).toBeLessThan(20)
  })

  it('comes down the cab sequence of a high-speed line behind a train, block by block, and stops at the marker board', { timeout: 30_000 }, () => {
    const { store, headX, train } = line(40, {})
    // Marker boards every 1 500 m, a train standing 35 km down the line
    const boards: number[] = []
    for (let x = 3250; x < 40_000; x += 1500) {
      setSignalOptions(store.network, signalAt(store.network, x, 0, 'east').id, { cabMarker: true })
      boards.push(x)
    }
    store.trains.push(trainAt(store.network, 35_500, 0, 'east'))
    store.markDirty()
    store.setSignallingSettings({ level: 'pro' })
    store.setLineSettings({ lineType: 'highSpeed', lineSpeed: 300 })
    train().itinerary = undefined
    store.setAutopilot(train().id, true)
    let top = 0
    let tripped = false
    /** Speed (km/h) half-way down the first block that announces a speed */
    let midBlock: { announced: number; speed: number } | null = null
    for (let i = 0; i < 20 * 1500; i++) {
      store.tickAllTrains(0.05)
      top = Math.max(top, train().currentSpeed)
      tripped ||= train().emergencyBrake
      const cab = buildTrainConsoleState(store, train()).signals?.cab
      if (!midBlock && cab?.kind === 'announce' && cab.markerDistance !== null && cab.markerDistance < 750) midBlock = { announced: cab.speed, speed: train().currentSpeed * 3.6 }
      if (train().currentSpeed === 0 && headX() > 20_000) break
    }
    expect(top * 3.6).toBeGreaterThan(280)
    // The control of the cab never had to stop it
    expect(tripped).toBe(false)
    // Half-way down the block it is still on its way down to the speed announced
    expect(midBlock).not.toBeNull()
    expect(midBlock!.speed).toBeGreaterThan(midBlock!.announced + 5)
    // Stopped before the board that closes the buffer block behind the train ahead
    const closed = boards.filter((x) => x < 35_500 - 200).at(-2)!
    expect(train().currentSpeed).toBe(0)
    expect(headX()).toBeLessThan(closed)
    expect(headX()).toBeGreaterThan(closed - 60)
  })

  it('holds the line speed and nothing else on a train without an itinerary', () => {
    const { store, run, train } = line(30, {})
    train().itinerary = undefined
    store.setAutopilot(train().id, true)
    const limit = buildTrainConsoleState(store, train()).guidance!.speedLimit / 3.6
    const top = run(240)
    expect(top).toBeGreaterThan(limit * 0.9)
    expect(top).toBeLessThanOrEqual(limit + 0.5)
  })
})
