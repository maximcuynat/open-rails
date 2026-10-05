import { beforeEach, describe, expect, it } from 'vitest'
import { createNetwork, resetIdCounter } from './network'
import { syncJunctions } from './junction'
import { setSignalOptions, type SignallingSettings } from './signals'
import type { LineSettings } from './speedLimits'
import {
  ON_SIGHT_SPEED,
  createSignallingState,
  estimatedStoppingDistance,
  signalAspect,
  signalSpeedCap,
  slowdownSpeedFor,
  trainSignalView,
  type SignallingState,
} from './signalling'
import { tickSignalling } from './trainSignalling'
import { signalRoute } from './signalBlocks'
import { chain, drive, halt, headX, line, run, setPoints, signalAt, trainAt } from './signalling.testkit'

beforeEach(() => resetIdCounter(0))

const STANDARD: SignallingSettings = { level: 'standard', stopEnforced: true }
const PRO: SignallingSettings = { level: 'pro', stopEnforced: true }
const CLASSIC: LineSettings = { lineSpeed: 160, lineType: 'classic' }
const LINE = { line: CLASSIC }

/**
 * A main line along y = 0 with points at x = 1000, facing for eastbound trains, whose straight
 * branch reaches (1200, `rise`) and runs on. A block signal at x = 700, a path signal at x = 900
 * before the points, a block signal on each branch at x = 1800.
 */
function station(rise: number) {
  const net = createNetwork()
  const main = chain(net, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 3000, y: 0 }])
  const branch = chain(net, [{ x: 1200, y: rise }, { x: 3000, y: rise }], main.nodes[1])
  syncJunctions(net)
  const distant = signalAt(net, 700, 0, 'east')
  const home = signalAt(net, 900, 0, 'east', 'protection')
  const onMain = signalAt(net, 1800, 0, 'east')
  const onBranch = signalAt(net, 1800, rise, 'east')
  return {
    net,
    main,
    branch,
    distant,
    home,
    onMain,
    onBranch,
    route(to: 'straight' | 'diverging') {
      setPoints(net, main.nodes[1], main.rails[0], to === 'straight' ? main.rails[1] : branch.rails[0])
    },
  }
}

/** A train 150 m before the block signal, near enough to have the route past both signals */
function approach(s: ReturnType<typeof station>, settings: SignallingSettings, state: SignallingState = createSignallingState()) {
  const train = drive(trainAt(s.net, 550, 0, 'east'), 10)
  tickSignalling(s.net, [train], state, settings, undefined, LINE)
  return { train, state }
}

describe('signals for points taken on a diverging route (pro level)', () => {
  it('names the two speeds the signals know', () => {
    expect([20, 30, 45, 60, 90, Infinity].map(slowdownSpeedFor)).toEqual([30, 30, 60, 60, null, null])
  })

  it('30 km/h: the path signal shows the reminder, the signal before it the announcement instead of clear', () => {
    const s = station(24)
    s.route('diverging')
    expect(signalRoute(s.net, s.home.id)!.diverging).toHaveLength(1)
    const { train, state } = approach(s, PRO)
    expect(state.signals.get(s.home.id)).toEqual({ state: 'clear', cause: null, clearedFor: train.id, reminder: 30 })
    expect(state.signals.get(s.distant.id)).toEqual({ state: 'clear', cause: null, clearedFor: train.id, slowdown: 30 })
    // The engine still works on its three states: nothing closes for it
    const view = trainSignalView(state, train.id, 0)
    expect(view.nextSignal).toMatchObject({ id: s.distant.id, state: 'clear', slowdown: 30 })
    expect(view.closedSignal).toBeNull()

    const announce = signalAspect(s.distant, 'clear', 'pro', state.signals.get(s.distant.id))
    expect(announce).toMatchObject({ indication: 'ralentissement', slowdown: 30, reminder: null, color: 'yellow', label: 'Ralentissement 30', plate: 'F' })
    const reminder = signalAspect(s.home, 'clear', 'pro', state.signals.get(s.home.id))
    expect(reminder).toMatchObject({ indication: 'rappel', reminder: 30, slowdown: null, color: 'yellow', label: 'Rappel 30', plate: 'Nf' })

    // Past the block signal, the path signal is the next one: the driver reads the reminder
    run(s.net, [train], state, train, 200, PRO, 10, LINE)
    expect(trainSignalView(state, train.id, 0).nextSignal).toMatchObject({ id: s.home.id, reminder: 30 })
  })

  it('60 km/h: the same with 60, which the lamps show flashing', () => {
    const s = station(16)
    s.route('diverging')
    const { state } = approach(s, PRO)
    expect(state.signals.get(s.home.id)).toMatchObject({ state: 'clear', reminder: 60 })
    expect(state.signals.get(s.distant.id)).toMatchObject({ state: 'clear', slowdown: 60 })
    expect(signalAspect(s.distant, 'clear', 'pro', { slowdown: 60 }).label).toBe('Ralentissement 60')
  })

  it('above 60 km/h no lamp says anything: the limit alone applies', () => {
    const s = station(9) // 90 km/h
    s.route('diverging')
    const { train, state } = approach(s, PRO)
    expect(state.signals.get(s.home.id)).toEqual({ state: 'clear', cause: null, clearedFor: train.id })
    expect(state.signals.get(s.distant.id)).toEqual({ state: 'clear', cause: null, clearedFor: train.id })
  })

  it('on the straight route nothing is shown, and throwing the points brings it at once', () => {
    const s = station(24)
    s.route('straight')
    const { train, state } = approach(s, PRO)
    expect(state.signals.get(s.home.id)).toEqual({ state: 'clear', cause: null, clearedFor: train.id })
    expect(state.signals.get(s.distant.id)).toEqual({ state: 'clear', cause: null, clearedFor: train.id })
    s.route('diverging')
    tickSignalling(s.net, [train], state, PRO, undefined, LINE)
    expect(state.signals.get(s.home.id)).toMatchObject({ reminder: 30 })
    expect(state.signals.get(s.distant.id)).toMatchObject({ slowdown: 30 })
  })

  it('a closed path signal is announced as a stop, not as a slowdown', () => {
    const s = station(24)
    s.route('diverging')
    // A train stands on the branch before its signal: the route past the path signal is not free
    const standing = trainAt(s.net, 1500, 24, 'east')
    const train = drive(trainAt(s.net, 550, 0, 'east'), 10)
    const state = createSignallingState()
    tickSignalling(s.net, [train, standing], state, PRO, undefined, LINE)
    expect(state.signals.get(s.home.id)).toEqual({ state: 'stop', cause: 'no-route', clearedFor: null })
    expect(state.signals.get(s.distant.id)).toEqual({ state: 'caution', cause: 'next-stop', clearedFor: train.id })
    expect(signalAspect(s.distant, 'caution', 'pro', state.signals.get(s.distant.id)).indication).toBe('avertissement')
  })

  it('with a stop announced beyond, the path signal shows the avertissement together with the reminder', () => {
    const s = station(24)
    s.route('diverging')
    // A train stands beyond the signal of the branch: that signal is closed, the route to it is free
    const standing = trainAt(s.net, 2000, 24, 'east')
    const train = drive(trainAt(s.net, 550, 0, 'east'), 10)
    const state = createSignallingState()
    tickSignalling(s.net, [train, standing], state, PRO, undefined, LINE)
    expect(state.signals.get(s.onBranch.id)?.state).toBe('stop')
    expect(state.signals.get(s.home.id)).toEqual({ state: 'caution', cause: 'next-stop', clearedFor: train.id, reminder: 30 })
    // The signal before announces the points: its own next signal is not at stop
    expect(state.signals.get(s.distant.id)).toMatchObject({ state: 'clear', slowdown: 30 })
    expect(signalAspect(s.home, 'caution', 'pro', state.signals.get(s.home.id))).toMatchObject({
      indication: 'avertissement',
      reminder: 30,
      slowdown: null,
      color: 'yellow',
      label: 'Avertissement · rappel 30',
    })
  })

  it('the standard level shows none of it, and reads the same signals as it always did', () => {
    const s = station(24)
    s.route('diverging')
    const { train, state } = approach(s, STANDARD)
    expect(state.signals.get(s.home.id)).toEqual({ state: 'clear', cause: null, clearedFor: train.id })
    expect(state.signals.get(s.distant.id)).toEqual({ state: 'clear', cause: null, clearedFor: train.id })
    expect(trainSignalView(state, train.id, 0).nextSignal).toEqual({ id: s.distant.id, distance: expect.any(Number), state: 'clear' })
    // Even handed the extras, the standard aspect is three colours
    expect(signalAspect(s.home, 'clear', 'standard', { reminder: 30 })).toMatchObject({ color: 'green', label: 'Voie libre', reminder: null, slowdown: null })
    // Switching the level on the same state brings them
    tickSignalling(s.net, [train], state, PRO, undefined, LINE)
    expect(state.signals.get(s.home.id)).toMatchObject({ reminder: 30 })
    tickSignalling(s.net, [train], state, STANDARD, undefined, LINE)
    expect(state.signals.get(s.home.id)).toEqual({ state: 'clear', cause: null, clearedFor: train.id })
  })

  it('a marker board has no lamp to show a speed with', () => {
    const s = station(24)
    setSignalOptions(s.net, s.home.id, { cabMarker: true })
    expect(signalAspect(s.home, 'clear', 'pro', { reminder: 30 })).toMatchObject({ lit: false, indication: 'voie-libre', reminder: null })
  })
})

describe('running on sight is a speed limit (pro level)', () => {
  it('30 km/h from the closed block signal passed at a stand until the next signal', () => {
    // Signals at 1000, 2000, 3000; a train stands at 1500: the signal at 1000 is closed
    const { net } = line(1, 4000)
    for (const x of [1000, 2000, 3000]) signalAt(net, x, 0, 'east')
    const ahead = trainAt(net, 1500, 0, 'east')
    const train = drive(trainAt(net, 900, 0, 'east'), 5)
    const trains = [train, ahead]
    const state = createSignallingState()
    tickSignalling(net, trains, state, PRO)
    expect(signalSpeedCap(state, train.id, 'pro')).toBe(Infinity)
    run(net, trains, state, train, 60, PRO, 10)
    halt(train)
    tickSignalling(net, trains, state, PRO)
    drive(train, 5)
    run(net, trains, state, train, 1000 + 10 - headX(net, train), PRO, 5)
    expect(trainSignalView(state, train.id, 0).onSight).toBe(true)
    expect(signalSpeedCap(state, train.id, 'pro')).toBe(ON_SIGHT_SPEED)
    // The other level reads the same state without that rule
    expect(signalSpeedCap(state, train.id, 'standard')).toBe(Infinity)
    expect(signalSpeedCap(state, 'nobody', 'pro')).toBe(Infinity)
    // The train ahead leaves; the limit holds until the next signal is passed
    trains.splice(1, 1)
    run(net, trains, state, train, 500, PRO, 50)
    expect(signalSpeedCap(state, train.id, 'pro')).toBe(ON_SIGHT_SPEED)
    run(net, trains, state, train, 2000 + 10 - headX(net, train), PRO, 50)
    expect(trainSignalView(state, train.id, 0).onSight).toBe(false)
    expect(signalSpeedCap(state, train.id, 'pro')).toBe(Infinity)
    expect(train.emergencyBrake).toBe(false)
  })
})

describe('simple stopping distance on a slope', () => {
  it('is the same as ever on the level, longer downhill, shorter uphill', () => {
    const level = estimatedStoppingDistance(40)
    expect(level).toBeCloseTo((40 * 40) / 1.4 + 80, 9)
    expect(estimatedStoppingDistance(40, 0)).toBe(level)
    // 20 ‰ downhill: 0.7 − 9.81 × 0.02 = 0.504 m/s²
    expect(estimatedStoppingDistance(40, -0.02)).toBeCloseTo((40 * 40) / (2 * (0.7 - 9.81 * 0.02 / Math.hypot(1, 0.02))) + 80, 6)
    expect(estimatedStoppingDistance(40, -0.02)).toBeGreaterThan(level * 1.3)
    expect(estimatedStoppingDistance(40, 0.02)).toBeLessThan(level)
  })

  it('never counts on less than 0.1 m/s², and takes a slope that is not a number as level', () => {
    expect(estimatedStoppingDistance(40, -0.2)).toBeCloseTo((40 * 40) / 0.2 + 80, 9)
    expect(estimatedStoppingDistance(40, NaN)).toBe(estimatedStoppingDistance(40))
    expect(estimatedStoppingDistance(0, -0.02)).toBe(0)
  })
})
