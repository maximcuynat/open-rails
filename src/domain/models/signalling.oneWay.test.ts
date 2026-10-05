import { beforeEach, describe, expect, it } from 'vitest'
import { resetIdCounter } from './network'
import { setSignalOptions, type SignallingSettings } from './signals'
import { signalRoute } from './signalBlocks'
import { AGAINST_LABEL, createSignallingState, signalAspect, trainSignalView } from './signalling'
import { tickSignalling } from './trainSignalling'
import { drive, halt, headX, line, run, signalAt, trainAt } from './signalling.testkit'

beforeEach(() => resetIdCounter(0))

const STANDARD: SignallingSettings = { level: 'standard', stopEnforced: true }
const PRO: SignallingSettings = { level: 'pro', stopEnforced: true }

/** 3 000 m of line with a path signal for westbound trains at x = 1500 */
function layout(oneWay: boolean) {
  const { net, rails } = line(1, 3000)
  const wall = signalAt(net, 1500, 0, 'west', 'protection')
  if (oneWay) setSignalOptions(net, wall.id, { oneWay: true })
  return { net, rails, wall }
}

describe('one-way path signal', () => {
  it('is a closed signal for a train that meets it from behind: nothing is held beyond it', () => {
    const { net, wall } = layout(true)
    const train = drive(trainAt(net, 1300, 0, 'east'), 20)
    const state = createSignallingState()
    tickSignalling(net, [train], state, STANDARD)
    const view = trainSignalView(state, train.id, 0)
    expect(view.nextSignal).toMatchObject({ id: wall.id, state: 'stop', against: true })
    expect(view.nextSignal!.distance).toBeGreaterThan(150)
    expect(view.nextSignal!.distance).toBeLessThan(200)
    expect(view.closedSignal).toEqual({ id: wall.id, distance: view.nextSignal!.distance })
    // A stopping distance of 326 m would hold 540 m of track: it stops at the signal
    const record = state.trains.get(train.id)!
    const farthest = Math.max(...record.reservation.spans.map((span) => Math.max(span.t0, span.t1) * 3000))
    expect(farthest).toBeCloseTo(1500, 6)
    expect(record.grants.size).toBe(0)
    // It is not a route the train waits for: none will ever come
    expect(view.waitingAt).toBeNull()
    // The brake alert works as for any closed signal
    expect(trainSignalView(state, train.id, 300).brakeAlert).toBe(true)
  })

  it('running past it is a fault at both levels, even after a stop before it', () => {
    for (const settings of [STANDARD, PRO]) {
      resetIdCounter(0)
      const { net, wall } = layout(true)
      const train = drive(trainAt(net, 1400, 0, 'east'), 5)
      const state = createSignallingState()
      tickSignalling(net, [train], state, settings)
      // Come to a stand right before it, as before a block signal that may be passed on sight
      run(net, [train], state, train, 50, settings, 5)
      halt(train)
      tickSignalling(net, [train], state, settings)
      drive(train, 5)
      const passings = run(net, [train], state, train, 200, settings, 5)
      expect(passings).toEqual([{ trainId: train.id, signalId: wall.id, speed: 5, closed: true, fault: true, onSight: false, against: true }])
      expect(train.emergencyBrake).toBe(true)
      expect(train.signalPassed).toMatchObject({ signalId: wall.id, braked: true })
      expect(trainSignalView(state, train.id, 0).onSight).toBe(false)
      expect(headX(net, train)).toBeGreaterThan(1500 - 25)
    }
  })

  it('leaves the trace without braking when the setting is off', () => {
    const { net, wall } = layout(true)
    const train = drive(trainAt(net, 1400, 0, 'east'), 5)
    const state = createSignallingState()
    const off: SignallingSettings = { level: 'standard', stopEnforced: false }
    tickSignalling(net, [train], state, off)
    run(net, [train], state, train, 200, off, 5)
    expect(train.emergencyBrake).toBe(false)
    expect(train.signalPassed).toMatchObject({ signalId: wall.id, braked: false })
  })

  it('without the option a signal seen from behind is ignored, and a block signal never is a wall', () => {
    const plain = layout(false)
    const train = drive(trainAt(plain.net, 1300, 0, 'east'), 20)
    const state = createSignallingState()
    tickSignalling(plain.net, [train], state, STANDARD)
    expect(trainSignalView(state, train.id, 0).nextSignal).toBeNull()
    expect(run(plain.net, [train], state, train, 400, STANDARD, 20)).toEqual([])

    resetIdCounter(0)
    const { net } = line(1, 3000)
    const block = signalAt(net, 1500, 0, 'west', 'spacing')
    setSignalOptions(net, block.id, { oneWay: true })
    const other = drive(trainAt(net, 1300, 0, 'east'), 20)
    const blockState = createSignallingState()
    tickSignalling(net, [other], blockState, STANDARD)
    expect(trainSignalView(blockState, other.id, 0).nextSignal).toBeNull()
  })

  it('speaks to its own direction as any path signal: it opens for a train that comes the right way', () => {
    const { net, wall } = layout(true)
    const train = drive(trainAt(net, 1700, 0, 'west'), 10)
    const state = createSignallingState()
    tickSignalling(net, [train], state, STANDARD)
    expect(trainSignalView(state, train.id, 0).nextSignal).toEqual({ id: wall.id, distance: expect.any(Number), state: 'caution' })
    expect(state.signals.get(wall.id)).toMatchObject({ clearedFor: train.id })
    const passings = run(net, [train], state, train, 400, STANDARD, 20)
    expect(passings).toEqual([{ trainId: train.id, signalId: wall.id, speed: 10, closed: false, fault: false, onSight: false }])
    expect(train.emergencyBrake).toBe(false)
  })

  it('ends the route from a signal before it as an end of track would: that signal shows caution', () => {
    const { net, wall } = layout(true)
    const before = signalAt(net, 500, 0, 'east')
    const beyond = signalAt(net, 2500, 0, 'east')
    const route = signalRoute(net, before.id)!
    expect(route.wall).toBe(wall.id)
    expect(route.next).toBeNull()
    expect(route.endsOnTrackEnd).toBe(true)
    expect(route.length).toBeCloseTo(1000, 6)
    const train = drive(trainAt(net, 100, 0, 'east'), 5)
    const state = createSignallingState()
    tickSignalling(net, [train], state, STANDARD)
    expect(state.signals.get(before.id)).toMatchObject({ state: 'caution', cause: 'track-end' })
    // Without the option the route runs on to the next signal of its direction
    setSignalOptions(net, wall.id, { oneWay: false })
    expect(signalRoute(net, before.id)).toMatchObject({ wall: null, next: beyond.id })
  })

  it('two signals back to back, the one-way one seen from behind first: the train is stopped there', () => {
    const { net, wall } = layout(true)
    const twin = signalAt(net, 1500, 0, 'east')
    const train = drive(trainAt(net, 1300, 0, 'east'), 5)
    const state = createSignallingState()
    tickSignalling(net, [train], state, STANDARD)
    expect(trainSignalView(state, train.id, 0).nextSignal).toMatchObject({ id: wall.id, against: true, state: 'stop' })
    expect(signalRoute(net, twin.id)).toMatchObject({ wall: wall.id, length: 0 })
  })

  it('reads as a stop that is never passed at both levels', () => {
    const { wall } = layout(true)
    expect(signalAspect(wall, 'clear', 'standard', { against: true })).toMatchObject({ state: 'stop', color: 'red', label: AGAINST_LABEL, passableAfterStop: false })
    expect(signalAspect(wall, 'clear', 'pro', { against: true })).toMatchObject({
      state: 'stop',
      indication: 'carre',
      plate: 'Nf',
      label: 'Sens interdit',
      passableAfterStop: false,
      onSightSpeed: null,
    })
  })
})
