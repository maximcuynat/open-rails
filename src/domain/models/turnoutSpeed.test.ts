import { beforeEach, describe, expect, it } from 'vitest'
import { addCurveSegment, addNode, addSegment, createNetwork, resetIdCounter } from './network'
import { syncJunctions } from './junction'
import type { LineSettings } from './speedLimits'
import type { Junction, Network, RailNode, Segment } from './types'
import {
  TURNOUT_TANGENT_SPEEDS,
  curveSpeedLimit,
  limitAhead,
  rakeSpeedLimit,
  turnoutDivergingSpeed,
  turnoutPassageSpeed,
  turnoutSpeedForTangent,
} from './trackSpeed'
import { trainDynamics, type DrivingEnvironment } from './trainDynamics'
import { advanceTrainSet } from './train'
import { chain, drive, junctionAt, setPoints, signalAt, trainAt } from './signalling.testkit'

beforeEach(() => resetIdCounter(0))

const CLASSIC: LineSettings = { lineSpeed: 160, lineType: 'classic' }
const PRO_ENV: DrivingEnvironment = { levelHeight: 6, line: CLASSIC, signalling: { level: 'pro' } }
const STANDARD_ENV: DrivingEnvironment = { levelHeight: 6, line: CLASSIC, signalling: { level: 'standard' } }

/**
 * A main line along y = 0 from x = 0 to 3 000 with points at x = 1000, facing for eastbound trains:
 * a straight branch leaves them and reaches (1200, `rise`), then runs on to x = 2000.
 */
function fork(rise: number) {
  const net = createNetwork()
  const main = chain(net, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 3000, y: 0 }])
  const branch = chain(net, [{ x: 1200, y: rise }, { x: 2000, y: rise }], main.nodes[1])
  syncJunctions(net)
  const junction = junctionAt(net, main.nodes[1])
  return {
    net,
    main,
    branch,
    points: main.nodes[1],
    junction,
    route(to: 'straight' | 'diverging') {
      setPoints(net, main.nodes[1], main.rails[0], to === 'straight' ? main.rails[1] : branch.rails[0])
    },
  }
}

/** The same with a curved branch: an arc of `radius` m turning left over 8°, tangent to the main line at the points */
function curvedFork(radius: number): { net: Network; main: { nodes: RailNode[]; rails: Segment[] }; curve: Segment; junction: Junction } {
  const net = createNetwork()
  const main = chain(net, [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 3000, y: 0 }])
  const angle = (8 * Math.PI) / 180
  const end = addNode(net, { x: 1000 + radius * Math.sin(angle), y: radius * (1 - Math.cos(angle)) })
  const curve = addCurveSegment(net, main.nodes[1].id, end.id, { x: 1000 + radius * Math.tan(angle / 2), y: 0 })!
  syncJunctions(net)
  return { net, main, curve, junction: junctionAt(net, main.nodes[1]) }
}

describe('speed of points by the tangent of their crossing', () => {
  it('keeps the lower figure of the two tables: 0.11 → 30, 0.085 → 60, 0.05 → 90, 0.034 → 120, 1/46 → 160, 1/65 → 220', () => {
    expect(TURNOUT_TANGENT_SPEEDS.map((row) => row.speed)).toEqual([30, 60, 90, 120, 160, 220])
    expect([0.13, 0.11, 0.085, 0.05, 0.034, 1 / 46, 1 / 65].map(turnoutSpeedForTangent)).toEqual([30, 30, 60, 90, 120, 160, 220])
  })

  it('a tangent between two rows takes the steeper crossing; flatter than 1/65 nothing limits', () => {
    expect(turnoutSpeedForTangent(0.25)).toBe(30)
    expect(turnoutSpeedForTangent(0.1)).toBe(30)
    expect(turnoutSpeedForTangent(0.0654)).toBe(60)
    expect(turnoutSpeedForTangent(0.04)).toBe(90)
    expect(turnoutSpeedForTangent(0.03)).toBe(120)
    expect(turnoutSpeedForTangent(0.02)).toBe(160)
    expect(turnoutSpeedForTangent(0.01)).toBe(Infinity)
    expect(turnoutSpeedForTangent(0)).toBe(Infinity)
  })
})

describe('speed of a turnout on its diverging route', () => {
  it('a straight branch gives the tangent itself: the angle it leaves at', () => {
    const steep = fork(24) // tangent 0.12
    expect(steep.junction.passages[0].b).toBe(steep.main.rails[1].id)
    expect(turnoutDivergingSpeed(steep.net, steep.junction, CLASSIC)).toBe(30)
    // 0.09 lies between two rows: the steeper one, 0.11, is taken
    const between = fork(18)
    expect(turnoutDivergingSpeed(between.net, between.junction, CLASSIC)).toBe(30)
    const sixty = fork(16) // 0.08
    expect(turnoutDivergingSpeed(sixty.net, sixty.junction, CLASSIC)).toBe(60)
    const ninety = fork(9) // 0.045
    expect(turnoutDivergingSpeed(ninety.net, ninety.junction, CLASSIC)).toBe(90)
  })

  it('the straight route is not limited, whichever way it is taken', () => {
    const { net, junction, main, branch } = fork(24)
    expect(turnoutPassageSpeed(net, junction, main.rails[0].id, main.rails[1].id, CLASSIC)).toBe(Infinity)
    expect(turnoutPassageSpeed(net, junction, main.rails[1].id, main.rails[0].id, CLASSIC)).toBe(Infinity)
    expect(turnoutPassageSpeed(net, junction, main.rails[0].id, branch.rails[0].id, CLASSIC)).toBe(30)
    expect(turnoutPassageSpeed(net, junction, branch.rails[0].id, main.rails[0].id, CLASSIC)).toBe(30)
    // The two branches are not a way through
    expect(turnoutPassageSpeed(net, junction, main.rails[1].id, branch.rails[0].id, CLASSIC)).toBe(Infinity)
  })

  it('a stored frog number is the tangent', () => {
    const { net, junction } = fork(12)
    junction.frogNumber = 6 // tangent 1/6
    expect(turnoutDivergingSpeed(net, junction, CLASSIC)).toBe(30)
    junction.frogNumber = 20 // 0.05
    expect(turnoutDivergingSpeed(net, junction, CLASSIC)).toBe(90)
    junction.frogNumber = 46
    expect(turnoutDivergingSpeed(net, junction, CLASSIC)).toBe(160)
  })

  it('a curved branch of unknown tangent: the speed of its curve without cant, brought down to a speed points exist for', () => {
    for (const radius of [150, 300, 500, 1200, 3000]) {
      resetIdCounter(0)
      const { net, junction, curve } = curvedFork(radius)
      expect(junction.passages[1].b).toBe(curve.id)
      const free = curveSpeedLimit(radius, 0, 'classic')
      const speed = turnoutDivergingSpeed(net, junction, CLASSIC)
      expect(speed).toBeLessThanOrEqual(free)
      expect([30, 60, 90, 120, 160, 220]).toContain(speed)
      // The next speed up would be too fast for the curve
      const steps = [30, 60, 90, 120, 160, 220]
      const next = steps[steps.indexOf(speed) + 1]
      if (next !== undefined) expect(next).toBeGreaterThan(free)
    }
    // Without cant: lower than what the same curve allows in plain track with its automatic cant
    const tight = curvedFork(300)
    expect(curveSpeedLimit(300, 0, 'classic')).toBeLessThan(curveSpeedLimit(300, 160, 'classic'))
    expect(turnoutDivergingSpeed(tight.net, tight.junction, CLASSIC)).toBe(60)
  })

  it('is a full-size matter, like the curve speeds', () => {
    const { net, junction } = fork(24)
    expect(turnoutDivergingSpeed(net, junction, { ...CLASSIC, realScale: false })).toBe(Infinity)
  })
})

describe('limit of a rake over points taken on their diverging route', () => {
  it('applies from the head reaching the points until the tail has cleared them', () => {
    const f = fork(24)
    f.route('diverging')
    const train = drive(trainAt(f.net, 900, 0, 'east'), 5)
    const limit = () => rakeSpeedLimit(f.net, train, CLASSIC, { turnouts: true })
    expect(limit()).toBe(160)
    // 30 km/h announced ahead, at the points
    const ahead = limitAhead(f.net, train, 160, 2000, CLASSIC, { turnouts: true })
    expect(ahead?.speed).toBe(30)
    expect(ahead!.distance).toBeGreaterThan(80)
    expect(ahead!.distance).toBeLessThan(100)
    // Not counted when not asked for
    expect(limitAhead(f.net, train, 160, 2000, CLASSIC)).toBeNull()

    const seen: number[] = []
    for (let i = 0; i < 40; i++) {
      advanceTrainSet(f.net, train, 5, [train])
      seen.push(limit())
    }
    // One drop to 30, then back to the line speed once the whole power car is past the points
    const first = seen.indexOf(30)
    const last = seen.lastIndexOf(30)
    expect(first).toBeGreaterThan(10)
    expect(seen.slice(first, last + 1).every((value) => value === 30)).toBe(true)
    expect(seen[seen.length - 1]).toBe(160)
    // It held for about the length of the vehicle
    expect((last - first + 1) * 5).toBeGreaterThan(15)
    expect((last - first + 1) * 5).toBeLessThan(40)
    // The same run without the option never drops
    expect(rakeSpeedLimit(f.net, train, CLASSIC)).toBe(160)
  })

  it('does not apply on the straight route', () => {
    const f = fork(24)
    f.route('straight')
    const train = drive(trainAt(f.net, 900, 0, 'east'), 5)
    expect(limitAhead(f.net, train, 160, 2000, CLASSIC, { turnouts: true })).toBeNull()
    for (let i = 0; i < 40; i++) {
      advanceTrainSet(f.net, train, 5, [train])
      expect(rakeSpeedLimit(f.net, train, CLASSIC, { turnouts: true })).toBe(160)
    }
  })

  it('applies to points taken from their heel too', () => {
    const f = fork(24)
    f.route('diverging')
    const train = drive(trainAt(f.net, 1500, 24, 'west'), 5)
    expect(limitAhead(f.net, train, 160, 2000, CLASSIC, { turnouts: true })?.speed).toBe(30)
  })
})

describe('what the physics gives the driver', () => {
  it('pro level on a network with signals: the points weigh on the limit and on the next limit', () => {
    const f = fork(24)
    signalAt(f.net, 500, 0, 'east', 'protection')
    f.route('diverging')
    const train = drive(trainAt(f.net, 900, 0, 'east'), 5)
    const before = trainDynamics(f.net, train, PRO_ENV)
    expect(before.speedLimit * 3.6).toBeCloseTo(160, 6)
    expect(before.nextSpeedLimit?.speed).toBe(30)
    advanceTrainSet(f.net, train, 100, [train])
    expect(trainDynamics(f.net, train, PRO_ENV).speedLimit * 3.6).toBeCloseTo(30, 6)
  })

  it('standard level, no environment, or a network without signal: nothing changes', () => {
    const f = fork(24)
    f.route('diverging')
    const train = drive(trainAt(f.net, 900, 0, 'east'), 5)
    // No signal on the network: the pro level changes nothing either
    expect(trainDynamics(f.net, train, PRO_ENV).nextSpeedLimit).toBeNull()
    signalAt(f.net, 500, 0, 'east', 'protection')
    for (const env of [STANDARD_ENV, { levelHeight: 6, line: CLASSIC }]) {
      expect(trainDynamics(f.net, train, env).nextSpeedLimit).toBeNull()
    }
    advanceTrainSet(f.net, train, 100, [train])
    expect(trainDynamics(f.net, train, STANDARD_ENV).speedLimit * 3.6).toBeCloseTo(160, 6)
    expect(trainDynamics(f.net, train, { levelHeight: 6, line: CLASSIC }).speedLimit * 3.6).toBeCloseTo(160, 6)
    expect(trainDynamics(f.net, train, PRO_ENV).speedLimit * 3.6).toBeCloseTo(30, 6)
  })

  it('pro level: the speed the signals impose (running on sight) is part of the limit, and of what is announced', () => {
    const f = fork(16) // points at 60
    signalAt(f.net, 500, 0, 'east', 'protection')
    f.route('diverging')
    const train = drive(trainAt(f.net, 900, 0, 'east'), 5)
    const onSight: DrivingEnvironment = { levelHeight: 6, line: CLASSIC, signalling: { level: 'pro', speedCapOf: () => 30 } }
    const dynamics = trainDynamics(f.net, train, onSight)
    expect(dynamics.speedLimit * 3.6).toBeCloseTo(30, 6)
    // 60 at the points is no drop under 30
    expect(dynamics.nextSpeedLimit).toBeNull()
    const free: DrivingEnvironment = { levelHeight: 6, line: CLASSIC, signalling: { level: 'pro', speedCapOf: () => Infinity } }
    expect(trainDynamics(f.net, train, free).speedLimit * 3.6).toBeCloseTo(160, 6)
    expect(trainDynamics(f.net, train, free).nextSpeedLimit?.speed).toBe(60)
    // The standard level never asks
    const standard: DrivingEnvironment = { levelHeight: 6, line: CLASSIC, signalling: { level: 'standard', speedCapOf: () => 30 } }
    expect(trainDynamics(f.net, train, standard).speedLimit * 3.6).toBeCloseTo(160, 6)
  })
})

describe('test layout', () => {
  it('the fork is a turnout whose straight branch carries on along the main line', () => {
    const f = fork(24)
    expect(f.junction.kind).toBe('turnout')
    expect(f.junction.passages.map((p) => p.b)).toEqual([f.main.rails[1].id, f.branch.rails[0].id])
    expect(addSegment(f.net, f.main.nodes[0].id, f.main.nodes[1].id)).toBeDefined()
  })
})
