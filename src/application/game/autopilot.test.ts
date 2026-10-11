import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { applyConsoleCommand } from '@application/console/consoleCommands'
import { buildTrainConsoleState } from '@application/console/consoleState'
import { pilotOrders, pilotSpeed } from '@application/console/autopilot'
import type { ConsoleState } from '@application/console/consoleContract'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { addStation } from '@domain/models/stations'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { addItineraryStop } from './itinerary'
import { PILOT_DWELL_S } from './autopilot'

/**
 * A straight line of `km` kilometres in rails of 500 m, with « Départ » at 500 m and the other
 * stations where asked (km). A rake is set down at « Départ » and the driving started.
 */
function line(km: number, stations: Record<string, number>) {
  resetMemoryStorage()
  resetIdCounter()
  const store = new EditorStore()
  const net = store.network
  const rails: string[] = []
  let prev = addNode(net, { x: 0, y: 0 })
  for (let x = 500; x <= km * 1000; x += 500) {
    const next = addNode(net, { x, y: 0 })
    rails.push(addSegment(net, prev.id, next.id)!.id)
    prev = next
  }
  const at = (m: number) => ({ segId: rails[Math.min(rails.length - 1, Math.floor(m / 500))], t: (m % 500) / 500 })
  addStation(net, { id: 'depart', name: 'Départ', pos: { x: 500, y: 0 }, stops: [at(500 + 250)] })
  for (const [id, where] of Object.entries(stations)) addStation(net, { id, name: id, pos: { x: where * 1000, y: 0 }, stops: [at(where * 1000)] })
  store.notify()
  expect(store.placeRakeAtStation('depart', 'duplex')).not.toBeNull()
  store.togglePlayMode()
  const headX = () => {
    const lead = store.trains[0].vehicles[0].front
    const rail = store.network.segments.get(lead.segId)!
    const a = store.network.nodes.get(rail.from)!.pos.x
    const b = store.network.nodes.get(rail.to)!.pos.x
    return a + (b - a) * lead.t
  }
  /** Run the simulation for `seconds`, 20 steps a second; returns the top speed reached, m/s */
  const run = (seconds: number, until: () => boolean = () => false): number => {
    let top = 0
    for (let i = 0; i < seconds * 20 && !until(); i++) {
      store.tickAllTrains(0.05)
      top = Math.max(top, store.trains[0].currentSpeed)
    }
    return top
  }
  return { store, headX, run, train: () => store.trains[0] }
}

/** A console state with only what the pilot reads set */
const state = (over: Partial<ConsoleState>): ConsoleState => ({
  trainId: 't', speed: 0, maxSpeed: 88, stopped: false, notch: 0, minNotch: -5, maxNotch: 5, handleEffort: 0, reverser: 'forward', reverserLocked: false,
  emergencyBrake: false, emergencyReleasable: false, brake: { command: 'hold', tone: 'released', pipeBar: 5, cylinderBar: 0 }, acceleration: 0, gradientPermille: 0,
  stoppingDistance: null, locoCount: 2, wagonCount: 8, upcomingTurnout: null, canSwitchCab: true,
  guidance: { speedLimit: 160, nextLimit: null, curve: 'ok' as never, derailed: null },
  ...over,
})

describe('what the pilot does with the handles', () => {
  it('pulls under the limit, coasts near it, brakes above it', () => {
    expect(pilotOrders(state({ speed: 10 }), { stopIn: null })).toMatchObject({ notch: 5, brake: 'hold' })
    expect(pilotOrders(state({ speed: 42.4 }), { stopIn: null }).notch).toBe(0)
    const over = pilotOrders(state({ speed: 47 }), { stopIn: null })
    expect(over.notch).toBeLessThan(0)
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
    expect(headX()).toBeGreaterThan(12_000 - 60)
    expect(headX()).toBeLessThanOrEqual(12_000 + 3)
    expect(train().emergencyBrake).toBe(false)
    // Arrived: it stays there
    run(60)
    expect(headX()).toBeLessThanOrEqual(12_000 + 3)
  })

  it('calls at a station on the way for a while, then goes on to the last', () => {
    const { store, headX, run, train } = line(14, { etape: 5, arrivee: 12 })
    addItineraryStop(store, train(), 'arrivee')
    addItineraryStop(store, train(), 'etape')
    expect(train().itinerary!.stations).toEqual(['depart', 'etape', 'arrivee'])
    store.setAutopilot(train().id, true)
    run(600, () => train().itinerary!.next === 2 && train().currentSpeed === 0)
    expect(headX()).toBeGreaterThan(5000 - 60)
    expect(headX()).toBeLessThanOrEqual(5000 + 3)
    // Still there half the call later, gone after it
    run(PILOT_DWELL_S / 2)
    expect(train().currentSpeed).toBe(0)
    run(900, () => train().itinerary!.next === 3 && train().currentSpeed === 0)
    expect(train().itinerary!.next).toBe(3)
    expect(headX()).toBeGreaterThan(12_000 - 60)
    expect(headX()).toBeLessThanOrEqual(12_000 + 3)
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
    // And leaving the driving lets every train go
    store.setAutopilot(train().id, true)
    store.togglePlayMode()
    expect(store.autopilots.size).toBe(0)
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
