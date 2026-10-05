import { beforeEach, describe, expect, it } from 'vitest'
import { addSegment, resetIdCounter } from './network'
import { setSignalOptions, setSignalRole, type SignallingSettings } from './signals'
import { addSpeedZone } from './speedZones'
import type { LineSettings } from './speedLimits'
import { rakeSpeedLimit, trackSpeedStats } from './trackSpeed'
import { signalBlockStats } from './signalBlocks'
import {
  createSignallingState,
  signalSpeedCap,
  signallingStats,
  trainSignalView,
  updateSignalling,
  type SignallingState,
  type TrackClearance,
} from './signalling'
import { tickSignalling, type CabOverspeed, type TickSignallingOptions } from './trainSignalling'
import type { TrainSet } from './train'
import type { Network, Signal } from './types'
import {
  CAB_CLEAR,
  CAB_RED,
  announcedSpeed,
  cabControlSpeed,
  cabIndication,
  cabLineSpeed,
  cabOverspeedThreshold,
  cabSignal,
  isCabSignalled,
  latchCabClearance,
  type CabObstacle,
  type CabSignal,
} from './cabSignalling'
import { chain, drive, halt, headX, line, run, setPoints, signalAt, trainAt } from './signalling.testkit'
import { createNetwork } from './network'
import { syncJunctions } from './junction'

beforeEach(() => resetIdCounter(0))

const PRO: SignallingSettings = { level: 'pro', stopEnforced: true }
const LGV: LineSettings = { lineSpeed: 300, lineType: 'highSpeed' }
const ON_LGV: TickSignallingOptions = { line: LGV }

/** A straight high-speed line of `length` m with a marker board for eastbound trains every 1 500 m */
function lgv(length = 15_000) {
  const { net, rails } = line(1, length)
  const markers: Signal[] = []
  for (let x = 1500; x < length; x += 1500) {
    const marker = signalAt(net, x, 0, 'east')
    setSignalOptions(net, marker.id, { cabMarker: true })
    markers.push(marker)
  }
  return { net, rails, markers }
}

/** The cab of a train as the console reads it after a simulation step */
function cabOf(net: Network, state: SignallingState, train: TrainSet, lineSettings: LineSettings = LGV) {
  return (): CabSignal => {
    const view = trainSignalView(state, train.id, 0)
    const cab = cabSignal(state, train.id, view, rakeSpeedLimit(net, train, lineSettings), cabLineSpeed(lineSettings, train.maxSpeed))
    if (!cab) throw new Error('the engine counted nothing for this train')
    return cab
  }
}

const shown = (cab: Pick<CabSignal, 'indication'>): string => {
  const { kind, speed, flashing } = cab.indication
  const letter = { line: 'V', execute: 'E', announce: 'A', stop: '', sight: 'S' }[kind]
  return `${kind === 'stop' ? '000' : speed}${letter}${flashing ? '*' : ''}`
}

const count = (blocks: number, obstacle: CabObstacle, markerId: string | null = 'sig_1'): TrackClearance => ({ blocks, obstacle, markerId })

describe('cab signalling: where it applies', () => {
  it('is the pro level on a high-speed line, and nothing else', () => {
    expect(isCabSignalled('pro', { lineType: 'highSpeed' })).toBe(true)
    expect(isCabSignalled('pro', { lineType: 'classic' })).toBe(false)
    expect(isCabSignalled('standard', { lineType: 'highSpeed' })).toBe(false)
    expect(isCabSignalled('standard', { lineType: 'classic' })).toBe(false)
  })

  it('shows a train slower than the line its own top speed as the line speed', () => {
    expect(cabLineSpeed({ lineSpeed: 300 }, 320 / 3.6)).toBe(300)
    expect(cabLineSpeed({ lineSpeed: 300 }, 200 / 3.6)).toBe(200)
  })
})

describe('cab signalling: the indication for a number of free blocks', () => {
  it('behind an occupied block: line speed, flashing, 270, 220, 160, 000, then the red of the buffer block', () => {
    const at = (blocks: number) => cabIndication({ blocks, obstacle: 'occupied' }, 300, 300)
    expect(cabIndication({ blocks: CAB_CLEAR, obstacle: null }, 300, 300)).toEqual({ kind: 'line', speed: 300, flashing: false })
    expect(at(7)).toEqual({ kind: 'line', speed: 300, flashing: false })
    // One block before the first announcement the line speed flashes
    expect(at(6)).toEqual({ kind: 'line', speed: 300, flashing: true })
    expect(at(5)).toEqual({ kind: 'announce', speed: 270, flashing: false })
    expect(at(4)).toEqual({ kind: 'announce', speed: 220, flashing: false })
    expect(at(3)).toEqual({ kind: 'announce', speed: 160, flashing: false })
    // The stop is asked for one block before the occupied one: the block in between stays free
    expect(at(2)).toEqual({ kind: 'stop', speed: 0, flashing: false })
    expect(at(1)).toEqual({ kind: 'sight', speed: 30, flashing: false })
    // The block of the train itself is not free
    expect(at(0)).toEqual({ kind: 'sight', speed: 30, flashing: false })
  })

  it('before a closed path signal or an end of track: no buffer block, and the 80 step', () => {
    const at = (blocks: number) => cabIndication({ blocks, obstacle: 'absolute' }, 300, 300)
    expect(at(7)).toEqual({ kind: 'line', speed: 300, flashing: false })
    expect(at(6)).toEqual({ kind: 'line', speed: 300, flashing: true })
    expect(at(5)).toEqual({ kind: 'announce', speed: 270, flashing: false })
    expect(at(4)).toEqual({ kind: 'announce', speed: 220, flashing: false })
    expect(at(3)).toEqual({ kind: 'announce', speed: 160, flashing: false })
    expect(at(2)).toEqual({ kind: 'announce', speed: 80, flashing: false })
    expect(at(1)).toEqual({ kind: 'stop', speed: 0, flashing: false })
    expect(at(0)).toEqual({ kind: 'sight', speed: 30, flashing: false })
  })

  it('names the speeds announced', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((n) => announcedSpeed(n, 'occupied'))).toEqual([CAB_RED, CAB_RED, 0, 160, 220, 270, Infinity, Infinity])
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((n) => announcedSpeed(n, 'absolute'))).toEqual([CAB_RED, 0, 80, 160, 220, 270, Infinity, Infinity])
    expect(announcedSpeed(CAB_CLEAR, null)).toBe(Infinity)
    expect(announcedSpeed(3, null)).toBe(Infinity)
  })

  it('is capped by the speed limit in force: an announcement that is not under it is not shown', () => {
    const at = (blocks: number, limit: number) => cabIndication({ blocks, obstacle: 'occupied' }, limit, 300)
    // Under a zone at 160: 270 and 220 would not be drops, the limit is shown as an execution
    expect(cabIndication({ blocks: CAB_CLEAR, obstacle: null }, 160, 300)).toEqual({ kind: 'execute', speed: 160, flashing: false })
    expect(at(5, 160)).toEqual({ kind: 'execute', speed: 160, flashing: false })
    expect(at(4, 160)).toEqual({ kind: 'execute', speed: 160, flashing: false })
    // 160 announced is no drop either, but the stop comes next: the execution flashes
    expect(at(3, 160)).toEqual({ kind: 'execute', speed: 160, flashing: true })
    expect(at(2, 160)).toEqual({ kind: 'stop', speed: 0, flashing: false })
    // Under 230, 220 is the first drop: 230 flashes one block before it
    expect(at(5, 230)).toEqual({ kind: 'execute', speed: 230, flashing: true })
    expect(at(4, 230)).toEqual({ kind: 'announce', speed: 220, flashing: false })
  })

  it('shows the line speed of a slower line the same way', () => {
    const at = (blocks: number) => cabIndication({ blocks, obstacle: 'occupied' }, 220, 220)
    expect(cabIndication({ blocks: CAB_CLEAR, obstacle: null }, 220, 220)).toEqual({ kind: 'line', speed: 220, flashing: false })
    // 270 and 220 announce nothing on a line at 220; 160 is the first drop
    expect(at(5)).toEqual({ kind: 'line', speed: 220, flashing: false })
    expect(at(4)).toEqual({ kind: 'line', speed: 220, flashing: true })
    expect(at(3)).toEqual({ kind: 'announce', speed: 160, flashing: false })
  })
})

describe('cab signalling: the speed checked', () => {
  it('is the limit in force while nothing lower is announced, then what the block before announced', () => {
    const occupied = (blocks: number) => cabControlSpeed({ blocks, obstacle: 'occupied' }, 300)
    expect(cabControlSpeed({ blocks: CAB_CLEAR, obstacle: null }, 300)).toBe(300)
    expect(occupied(6)).toBe(300) // flashing line speed
    expect(occupied(5)).toBe(300) // 270 announced: the train came in at the line speed
    expect(occupied(4)).toBe(270)
    expect(occupied(3)).toBe(220)
    expect(occupied(2)).toBe(160) // 000: it came in at 160
    expect(occupied(1)).toBe(30) // red
    const absolute = (blocks: number) => cabControlSpeed({ blocks, obstacle: 'absolute' }, 300)
    expect(absolute(3)).toBe(220)
    expect(absolute(2)).toBe(160) // 80 announced
    expect(absolute(1)).toBe(80) // 000 after 80: checked at 90
    // Never above the limit in force
    expect(cabControlSpeed({ blocks: 4, obstacle: 'occupied' }, 160)).toBe(160)
    expect(cabControlSpeed({ blocks: 2, obstacle: 'occupied' }, 100)).toBe(100)
  })

  it('trips 15 km/h over it from 200 km/h up, 10 km/h under that, and at 35 km/h on sight', () => {
    expect([320, 300, 270, 230, 220, 200].map((v) => cabOverspeedThreshold(v))).toEqual([335, 315, 285, 245, 235, 215])
    expect([160, 80].map((v) => cabOverspeedThreshold(v))).toEqual([170, 90])
    expect(cabOverspeedThreshold(30, true)).toBe(35)
  })
})

describe('cab signalling: more restrictive at a marker only', () => {
  it('keeps the count shown until the marker ahead changes, and takes a higher one at once', () => {
    const first = latchCabClearance(null, count(7, 'occupied'))
    expect(first).toEqual({ blocks: 7, obstacle: 'occupied', markerId: 'sig_1' })
    // Fewer free blocks, same marker ahead: not shown yet
    expect(latchCabClearance(first, count(4, 'occupied'))).toBe(first)
    // The marker is passed: the count is taken
    const passed = latchCabClearance(first, count(3, 'occupied', 'sig_2'))
    expect(passed.blocks).toBe(3)
    // More free blocks: shown at once
    expect(latchCabClearance(passed, count(5, 'occupied', 'sig_2')).blocks).toBe(5)
    expect(latchCabClearance(passed, count(3, 'occupied', 'sig_2'))).toBe(passed)
  })

  it('never waits when no marker is ahead, nor when the block of the train itself stops being free', () => {
    const open = latchCabClearance(null, count(CAB_CLEAR, null, null))
    expect(latchCabClearance(open, count(1, 'absolute', null)).blocks).toBe(1)
    const running = latchCabClearance(null, count(7, 'occupied'))
    expect(latchCabClearance(running, count(0, 'occupied')).blocks).toBe(0)
  })

  it('compares what is shown, not the counts: 2 blocks before a path signal is less restrictive than 2 behind a train', () => {
    const behindTrain = latchCabClearance(null, count(2, 'occupied')) // 000
    expect(latchCabClearance(behindTrain, count(2, 'absolute')).obstacle).toBe('absolute') // 80 announced
    const beforeSignal = latchCabClearance(null, count(2, 'absolute'))
    expect(latchCabClearance(beforeSignal, count(2, 'occupied'))).toBe(beforeSignal)
  })
})

describe('cab signalling: on the track', () => {
  it('runs the whole sequence behind a train standing ahead, one step per marker, the buffer block last', () => {
    // Markers at 1500, 3000 … 13500. A train stands at x = 12200: the marker at 12000 is closed
    const { net, markers } = lgv()
    const stopped = trainAt(net, 12_200, 0, 'east')
    const train = drive(trainAt(net, 200, 0, 'east'), 5)
    const trains = [train, stopped]
    const state = createSignallingState()
    tickSignalling(net, trains, state, PRO, undefined, ON_LGV)
    const cab = cabOf(net, state, train)

    // 8 blocks to the closed marker: nothing restricts the train
    expect(shown(cab())).toBe('300V')
    expect(cab().marker?.id).toBe(markers[0].id)

    const seen: string[] = []
    for (const marker of markers.slice(0, 7)) {
      // Just before the marker: still what the block showed; just after: the next step
      const x = marker.t * 15_000
      run(net, trains, state, train, x - 20 - headX(net, train), PRO, 50, ON_LGV)
      const before = shown(cab())
      run(net, trains, state, train, 40, PRO, 50, ON_LGV)
      seen.push(`${before}→${shown(cab())}`)
    }
    expect(seen).toEqual([
      '300V→300V', // past 1500: 7 blocks
      '300V→300V*', // past 3000: 6 blocks, the line speed flashes
      '300V*→270A', // past 4500
      '270A→220A', // past 6000
      '220A→160A', // past 7500
      '160A→000', // past 9000: stop before the marker at 10500
      '000→30S', // past 10500: the buffer block, on sight as far as the closed marker at 12000
    ])
    expect(cab().marker?.id).toBe(markers[7].id)
    expect(cab().blocks).toBe(1)
    expect(cab().obstacle).toBe('occupied')
    // The marker into the buffer block is open for the engine: passing it slowly is no fault
    expect(train.emergencyBrake).toBe(false)
    expect(train.signalPassed ?? null).toBeNull()
    // The red of the buffer block is a limit for the train
    expect(signalSpeedCap(state, train.id, 'pro')).toBe(30)
    expect(signalSpeedCap(state, train.id, 'standard')).toBe(Infinity)
  })

  it('before a closed path signal there is no buffer block: 160, 80, then 000 up to the signal itself', () => {
    // The marker at 6000 is a path signal (plate Nf); a train standing beyond keeps it closed
    const { net, markers } = lgv()
    setSignalRole(net, markers[3].id, 'protection')
    const stopped = trainAt(net, 6200, 0, 'east')
    const train = drive(trainAt(net, 200, 0, 'east'), 5)
    const trains = [train, stopped]
    const state = createSignallingState()
    tickSignalling(net, trains, state, PRO, undefined, ON_LGV)
    const cab = cabOf(net, state, train)
    expect(cab().obstacle).toBe('absolute')
    const seen = [shown(cab())]
    for (const marker of markers.slice(0, 3)) {
      run(net, trains, state, train, marker.t * 15_000 + 20 - headX(net, train), PRO, 50, ON_LGV)
      seen.push(shown(cab()))
    }
    expect(seen).toEqual(['220A', '160A', '80A', '000'])
    expect(state.signals.get(markers[3].id)?.state).toBe('stop')
  })

  it('shows a more restrictive indication only once the next marker is passed, a less restrictive one at once', () => {
    const { net, markers } = lgv()
    const train = drive(trainAt(net, 200, 0, 'east'), 5)
    const state = createSignallingState()
    const trains = [train]
    tickSignalling(net, trains, state, PRO, undefined, ON_LGV)
    const cab = cabOf(net, state, train)
    expect(shown(cab())).toBe('300V')

    // A train appears at x = 5000: the marker at 4500 closes, three blocks ahead
    const intruder = trainAt(net, 5000, 0, 'east')
    trains.push(intruder)
    run(net, trains, state, train, 100, PRO, 50, ON_LGV)
    expect(state.signals.get(markers[2].id)?.state).toBe('stop')
    expect(state.trains.get(train.id)!.clearance).toEqual({ blocks: 3, obstacle: 'occupied', markerId: markers[0].id })
    // Not shown before the marker at 1500
    expect(shown(cab())).toBe('300V')
    run(net, trains, state, train, 1000, PRO, 50, ON_LGV)
    expect(shown(cab())).toBe('300V')
    // Past it, two blocks are left: the stop is asked for before the buffer block
    run(net, trains, state, train, 1500 + 20 - headX(net, train), PRO, 50, ON_LGV)
    expect(shown(cab())).toBe('000')

    // The train ahead is gone: the line speed comes back without waiting for a marker
    trains.splice(trains.indexOf(intruder), 1)
    run(net, trains, state, train, 50, PRO, 50, ON_LGV)
    expect(shown(cab())).toBe('300V')
  })

  it('is capped by a speed zone over the train', () => {
    const { net, rails } = lgv()
    // 160 from x = 0 to x = 3300
    addSpeedZone(net, [{ segId: rails[0].id, t0: 0, t1: 0.22 }], 160)
    const stopped = trainAt(net, 7700, 0, 'east')
    const train = drive(trainAt(net, 200, 0, 'east'), 5)
    const trains = [train, stopped]
    const state = createSignallingState()
    tickSignalling(net, trains, state, PRO, undefined, ON_LGV)
    const cab = cabOf(net, state, train)
    // Markers at 1500 … 6000 and the closed one at 7500: 5 free blocks would announce 270
    expect(cab().blocks).toBe(5)
    expect(shown(cab())).toBe('160E')
    // Past 1500: 220 announced is no drop under 160 either
    run(net, trains, state, train, 1500 + 20 - headX(net, train), PRO, 50, ON_LGV)
    expect(shown(cab())).toBe('160E')
    // Past 3000 the train is still in the zone: 160 announced is no drop, the stop is next
    run(net, trains, state, train, 3000 + 20 - headX(net, train), PRO, 50, ON_LGV)
    expect(shown(cab())).toBe('160E*')
    // Clear of the zone: 160 is announced under the line speed
    run(net, trains, state, train, 400, PRO, 50, ON_LGV)
    expect(shown(cab())).toBe('160A')
  })

  it('stops the train before the end of the track: 80 announced, then 000 in the last block', () => {
    // 6 000 m, markers at 1500, 3000 and 4500, then the buffer stop
    const { net, markers } = lgv(6000)
    const train = drive(trainAt(net, 200, 0, 'east'), 5)
    const trains = [train]
    const state = createSignallingState()
    tickSignalling(net, trains, state, PRO, undefined, ON_LGV)
    const cab = cabOf(net, state, train)
    // Four blocks to the end of the track
    expect(cab().blocks).toBe(4)
    expect(cab().obstacle).toBe('absolute')
    expect(shown(cab())).toBe('220A')
    run(net, trains, state, train, 3000 + 20 - headX(net, train), PRO, 50, ON_LGV)
    expect(shown(cab())).toBe('80A')
    run(net, trains, state, train, 4500 + 20 - headX(net, train), PRO, 50, ON_LGV)
    // No marker ahead any more: the track ends
    expect(trainSignalView(state, train.id, 0).nextSignal).toBeNull()
    expect(cab().marker).toBeNull()
    expect(shown(cab())).toBe('000')
    expect(markers).toHaveLength(3)
  })

  it('gives the next marker with its distance from the nose of the train', () => {
    const { net, markers } = lgv()
    const train = halt(trainAt(net, 200, 0, 'east'))
    const state = createSignallingState()
    tickSignalling(net, [train], state, PRO, undefined, ON_LGV)
    const engine = trainSignalView(state, train.id, 0).nextSignal!
    expect(cabOf(net, state, train)().marker).toEqual({ id: markers[0].id, distance: engine.distance })
  })

  it('shows the red in the buffer block, and after a closed marker passed at a stand', () => {
    const { net, markers } = lgv()
    const stopped = trainAt(net, 3200, 0, 'east')
    const train = drive(trainAt(net, 2800, 0, 'east'), 5)
    const trains = [train, stopped]
    const state = createSignallingState()
    tickSignalling(net, trains, state, PRO, undefined, ON_LGV)
    const cab = cabOf(net, state, train)
    // Between the markers at 1500 and 3000, the latter closed: the buffer block
    expect(shown(cab())).toBe('30S')
    // Stop before the marker at 3000, then pass it: plate F, on sight
    run(net, trains, state, train, 100, PRO, 10, ON_LGV)
    halt(train)
    tickSignalling(net, trains, state, PRO, undefined, ON_LGV)
    drive(train, 5)
    run(net, trains, state, train, 3000 + 5 - headX(net, train), PRO, 5, ON_LGV)
    expect(trainSignalView(state, train.id, 0).onSight).toBe(true)
    expect(cab().indication).toEqual({ kind: 'sight', speed: 30, flashing: false })
    // The train ahead is in the block of the train itself now
    expect(cab().blocks).toBe(0)
    expect(markers[1].cabMarker).toBe(true)
    expect(train.emergencyBrake).toBe(false)
  })

  it('sees at once a train that comes in by points between the train and the next marker', () => {
    // A siding joins the main line at x = 700, before the first marker at 1500
    const net = createNetwork()
    const main = chain(net, [{ x: 0, y: 0 }, { x: 700, y: 0 }, { x: 15_000, y: 0 }])
    const siding = chain(net, [{ x: 100, y: 30 }, { x: 400, y: 30 }])
    const join = addSegment(net, siding.nodes[1].id, main.nodes[1].id)!
    syncJunctions(net)
    for (let x = 1500; x < 15_000; x += 1500) setSignalOptions(net, signalAt(net, x, 0, 'east').id, { cabMarker: true })
    const toMain = () => setPoints(net, main.nodes[1], main.rails[0], main.rails[1])
    const toSiding = () => setPoints(net, main.nodes[1], join, main.rails[1])
    toMain()

    const train = drive(trainAt(net, 200, 0, 'east'), 5)
    const intruder = drive(trainAt(net, 300, 30, 'east'), 5)
    const trains = [train, intruder]
    const state = createSignallingState()
    tickSignalling(net, trains, state, PRO, undefined, ON_LGV)
    const cab = cabOf(net, state, train)
    expect(shown(cab())).toBe('300V')
    expect(state.trains.get(train.id)!.clearance?.blocks).toBe(CAB_CLEAR)

    // The points are thrown for the siding: the track ends there for the train
    toSiding()
    tickSignalling(net, trains, state, PRO, undefined, ON_LGV)
    expect(shown(cab())).toBe('000')

    // The intruder runs onto the main line and the points are set back: it now stands between the
    // train and the marker at 1500
    run(net, trains, state, intruder, 600, PRO, 50, ON_LGV)
    expect(headX(net, intruder)).toBeGreaterThan(700)
    expect(headX(net, intruder)).toBeLessThan(1500)
    halt(intruder)
    intruder.reverser = 'neutral'
    toMain()
    tickSignalling(net, trains, state, PRO, undefined, ON_LGV)
    expect(state.trains.get(train.id)!.clearance).toMatchObject({ blocks: 0, obstacle: 'occupied' })
    // Shown without waiting for a marker
    expect(shown(cab())).toBe('30S')
    expect(cab().controlSpeed).toBe(30)
  })
})

describe('cab signalling: overspeed', () => {
  /** A lone train on the line at `kmh`, one simulation step run */
  function alone(kmh: number, settings: SignallingSettings = PRO, options: TickSignallingOptions = ON_LGV) {
    const { net } = lgv()
    const train = drive(trainAt(net, 200, 0, 'east'), kmh / 3.6)
    const state = createSignallingState()
    const caught: CabOverspeed[] = []
    const tick = () => tickSignalling(net, [train], state, settings, undefined, { ...options, onOverspeed: (_, o) => caught.push(o) })
    tick()
    return { net, train, state, caught, tick }
  }

  it('applies the emergency brake 15 km/h over the line speed, leaves a trace and says so once', () => {
    const under = alone(314)
    expect(under.train.emergencyBrake).toBe(false)
    expect(under.train.overspeed ?? null).toBeNull()
    expect(under.caught).toEqual([])

    const over = alone(316)
    expect(over.train.emergencyBrake).toBe(true)
    expect(over.train.overspeed).toMatchObject({ limit: 300, braked: true })
    expect(over.train.overspeed!.speed).toBeCloseTo(316, 6)
    expect(over.caught).toHaveLength(1)
    // Still too fast at the next steps: nothing new is said
    over.tick()
    over.tick()
    expect(over.caught).toHaveLength(1)
    // Slower, but braked: the trace stays until the train stands
    over.train.currentSpeed = 100 / 3.6
    over.tick()
    expect(over.train.overspeed).not.toBeNull()
    over.train.currentSpeed = 0
    over.tick()
    expect(over.train.overspeed).toBeNull()
  })

  it('10 km/h over a limit under 200 km/h', () => {
    const { net, rails } = lgv()
    addSpeedZone(net, [{ segId: rails[0].id, t0: 0, t1: 0.1 }], 160)
    const run160 = (kmh: number) => {
      const train = drive(trainAt(net, 200, 0, 'east', `t_${kmh}`), kmh / 3.6)
      tickSignalling(net, [train], createSignallingState(), PRO, undefined, ON_LGV)
      return train
    }
    expect(run160(169).emergencyBrake).toBe(false)
    expect(run160(171).emergencyBrake).toBe(true)
    expect(run160(171).overspeed).toMatchObject({ limit: 160 })
  })

  it('35 km/h in the buffer block, and what the block before announced under an announcement', () => {
    const { net } = lgv()
    const stopped = trainAt(net, 6200, 0, 'east')
    const at = (x: number, kmh: number) => {
      const train = drive(trainAt(net, x, 0, 'east', `t_${x}_${kmh}`), kmh / 3.6)
      tickSignalling(net, [train, stopped], createSignallingState(), PRO, undefined, ON_LGV)
      return train
    }
    // Markers at 1500, 3000, 4500 and the closed one at 6000. From x = 200: 4 blocks, 220 announced, checked at 270
    expect(at(200, 284).emergencyBrake).toBe(false)
    expect(at(200, 286).overspeed).toMatchObject({ limit: 270, braked: true })
    // From x = 3200: 2 blocks, 000, the train came in at 160
    expect(at(3200, 169).emergencyBrake).toBe(false)
    expect(at(3200, 171).emergencyBrake).toBe(true)
    // From x = 4700: the buffer block
    expect(at(4700, 34).emergencyBrake).toBe(false)
    expect(at(4700, 36).overspeed).toMatchObject({ limit: 30, braked: true })
  })

  it('leaves the trace without braking when the setting is off, and drops it once back under the speed checked', () => {
    const lone = alone(320, { level: 'pro', stopEnforced: false })
    expect(lone.train.emergencyBrake).toBe(false)
    expect(lone.train.overspeed).toMatchObject({ limit: 300, braked: false })
    expect(lone.caught).toHaveLength(1)
    lone.train.currentSpeed = 305 / 3.6
    lone.tick()
    expect(lone.train.overspeed).not.toBeNull()
    lone.train.currentSpeed = 299 / 3.6
    lone.tick()
    expect(lone.train.overspeed).toBeNull()
    // A second overspeed is a new one
    lone.train.currentSpeed = 320 / 3.6
    lone.tick()
    expect(lone.caught).toHaveLength(2)
  })

  it('takes the limit the caller already has rather than working it out', () => {
    const lone = alone(250, PRO, { line: LGV, speedLimitOf: () => 200 })
    expect(lone.train.overspeed).toMatchObject({ limit: 200, braked: true })
  })

  it('does nothing at the standard level, on a conventional line, nor without line settings', () => {
    for (const [settings, options] of [
      [{ level: 'standard', stopEnforced: true }, ON_LGV],
      [PRO, { line: { lineSpeed: 300, lineType: 'classic' } }],
      [PRO, {}],
    ] as [SignallingSettings, TickSignallingOptions][]) {
      const lone = alone(350, settings, options)
      expect(lone.train.emergencyBrake).toBe(false)
      expect(lone.train.overspeed ?? null).toBeNull()
      expect(lone.state.trains.get(lone.train.id)!.cab).toBeNull()
      expect(lone.state.trains.get(lone.train.id)!.clearance).toBeNull()
    }
  })
})

describe('cab signalling: cost', () => {
  it('reading the cab walks nothing and builds nothing', () => {
    const { net } = lgv()
    const stopped = trainAt(net, 12_200, 0, 'east')
    const train = drive(trainAt(net, 200, 0, 'east'), 5)
    const state = createSignallingState()
    tickSignalling(net, [train, stopped], state, PRO, undefined, ON_LGV)
    const view = trainSignalView(state, train.id, 0)
    const before = JSON.stringify([signallingStats, signalBlockStats, trackSpeedStats])
    let last: CabSignal | null = null
    for (let i = 0; i < 100; i++) last = cabSignal(state, train.id, view, 300, 300)
    expect(shown(last!)).toBe('300V')
    expect(JSON.stringify([signallingStats, signalBlockStats, trackSpeedStats])).toBe(before)
  })

  it('outside the simulation the count of the engine is read as it is', () => {
    const { net } = lgv()
    const stopped = trainAt(net, 6200, 0, 'east')
    const train = drive(trainAt(net, 200, 0, 'east'), 5)
    const state = createSignallingState()
    updateSignalling(net, [train, stopped], state, PRO, undefined, { line: LGV, clearance: true })
    expect(state.trains.get(train.id)!.cab).toBeNull()
    expect(shown(cabSignal(state, train.id, trainSignalView(state, train.id, 0), 300, 300)!)).toBe('220A')
    // Without the clearance asked for, the engine counts nothing and the cab has nothing to show
    const plain = createSignallingState()
    updateSignalling(net, [train, stopped], plain, PRO)
    expect(cabSignal(plain, train.id, trainSignalView(plain, train.id, 0), 300, 300)).toBeNull()
  })
})
