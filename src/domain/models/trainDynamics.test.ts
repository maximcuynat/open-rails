import { describe, it, expect } from 'vitest'
import { createNetwork, addNode, addSegment, addArcCurve, resetIdCounter } from './network'
import type { Network } from './types'
import {
  COUPLING_GAP,
  MAX_NOTCH,
  MIN_NOTCH,
  advanceTrainSet,
  createVehicle,
  makeTrainSet,
  setNotch,
  setReverser,
  tickTrainSet,
  trackLeftAhead,
  triggerEmergencyBrake,
  vehicleFrontEndPos,
  vehicleRearEndPos,
  type TrainSet,
  type Vehicle,
} from './train'
import { positionOnSegment } from './locomotive'
import type { RollingStockModel } from './rollingStock'
import {
  BRAKE_CYLINDER_MAX_BAR,
  BRAKE_PIPE_FIRST_REDUCTION,
  BRAKE_PIPE_FULL_SERVICE,
  BRAKE_PIPE_RELEASED,
  GRAVITY,
  PHYSICS_STEP,
  brakeAdhesion,
  setBrakeCommand,
  tractionAdhesion,
  trainDynamics,
  type DrivingEnvironment,
} from './trainDynamics'

const KMH = 1 / 3.6
const STEP = PHYSICS_STEP

/**
 * A straight line along +x. With `gradient` (‰) it climbs steadily towards +x: the far node is one
 * level up and the returned environment gives that level the height the slope needs.
 */
function line(length: number, gradient = 0): { net: Network; segId: string; env: DrivingEnvironment; length: number } {
  resetIdCounter()
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: length, y: 0 }, gradient === 0 ? 0 : 1)
  const seg = addSegment(net, a.id, b.id)!
  return { net, segId: seg.id, env: { levelHeight: gradient === 0 ? 6 : (gradient / 1000) * length }, length }
}

/** Rake laid out behind a lead power car whose front bogie is at `x`, head towards +x */
function rake(net: Network, segId: string, x: number, length: number, kinds: ('loco' | 'wagon')[], model?: RollingStockModel, id = 'T'): TrainSet {
  const lead = createVehicle(net, segId, x / length, kinds[0], 1, model)!
  const train = makeTrainSet(id, [lead])
  kinds.slice(1).forEach((kind, i) => {
    const veh: Vehicle = { id: `${id}v${i}`, kind, front: { ...lead.rear }, rear: { ...lead.rear } }
    if (model) veh.model = model
    if (kind === 'loco') veh.flipped = true
    train.vehicles.push(veh)
  })
  expect(advanceTrainSet(net, train, 0)).toBe(true)
  return train
}

/** Complete trainset: 424 t for the Duplex */
function trainset(net: Network, segId: string, x: number, length: number, model: RollingStockModel = 'duplex', id = 'T'): TrainSet {
  const trailers = model === 'duplex' ? 8 : 9
  return rake(net, segId, x, length, ['loco', ...Array.from({ length: trailers }, () => 'wagon' as const), 'loco'], model, id)
}

/** Brake fully released, as after holding the release command for a few seconds */
function releaseBrake(train: TrainSet): void {
  train.brakePipe = BRAKE_PIPE_RELEASED
  train.brakeCylinder = 0
}

/** Running at `kmh`, brake released, reverser forward */
function running(train: TrainSet, kmh: number): TrainSet {
  releaseBrake(train)
  setReverser(train, 'forward')
  train.currentSpeed = kmh * KMH
  return train
}

const headX = (net: Network, train: TrainSet) => positionOnSegment(net, train.vehicles[0].front.segId, train.vehicles[0].front.t)!.x

/** Tick until `done`, return the time and the distance covered by the head */
function run(net: Network, train: TrainSet, done: () => boolean, env?: DrivingEnvironment, maxTime = 1000, dt = STEP) {
  const x0 = headX(net, train)
  let time = 0
  while (!done() && time < maxTime) {
    tickTrainSet(net, train, dt, [], undefined, env)
    time += dt
  }
  return { time, distance: Math.abs(headX(net, train) - x0) }
}

function emergencyStop(kmh: number, gradient = 0) {
  // Downhill when the gradient is negative
  const { net, segId, env, length } = line(60_000, gradient)
  const train = running(trainset(net, segId, 1000, length), kmh)
  triggerEmergencyBrake(train)
  const result = run(net, train, () => train.currentSpeed === 0, env)
  return { ...result, train, net, env }
}

describe('control figures: real and regulatory', () => {
  it('emergency stop from 300 km/h on level track: 3 300 m ± 5 % in about 74 s', () => {
    const { time, distance } = emergencyStop(300)
    expect(distance).toBeGreaterThan(3300 * 0.95)
    expect(distance).toBeLessThan(3300 * 1.05)
    expect(time).toBeGreaterThan(70)
    expect(time).toBeLessThan(78)
  })

  it('emergency stops from 200 / 250 / 160 km/h stay within 1 500 / 2 430 / 1 250 m', () => {
    expect(emergencyStop(200).distance).toBeLessThanOrEqual(1500)
    expect(emergencyStop(250).distance).toBeLessThanOrEqual(2430)
    expect(emergencyStop(160).distance).toBeLessThanOrEqual(1250)
    // … and are not absurdly short either: a mean deceleration below 1.3 m/s²
    expect(emergencyStop(200).distance).toBeGreaterThan((200 * KMH) ** 2 / (2 * 1.3))
  })

  it('full service stop from 320 km/h stays within 5 300 m', () => {
    const { net, segId, length } = line(60_000)
    const train = running(trainset(net, segId, 1000, length), 320)
    setBrakeCommand(train, 'apply')
    const { distance } = run(net, train, () => train.currentSpeed === 0)
    expect(distance).toBeLessThanOrEqual(5300)
    expect(distance).toBeGreaterThan(3900) // longer than the emergency stop
  })

  it('emergency brake at 230 km/h down a 35 ‰ slope still stops the train', () => {
    const { time, distance, train, net, env } = emergencyStop(230, -35)
    expect(train.currentSpeed).toBe(0)
    expect(time).toBeLessThan(120)
    expect(distance).toBeLessThan(3000)
    // … and holds it there
    tickTrainSet(net, train, 10, [], undefined, env)
    expect(train.currentSpeed).toBe(0)
  })

  it('mean acceleration from rest to 40 / 120 / 160 km/h is at least 0.40 / 0.32 / 0.17 m/s²', () => {
    const { net, segId, length } = line(60_000)
    const train = running(trainset(net, segId, 1000, length), 0)
    setNotch(train, MAX_NOTCH)
    let time = 0
    for (const [kmh, minimum] of [[40, 0.4], [120, 0.32], [160, 0.17]]) {
      time += run(net, train, () => train.currentSpeed >= kmh * KMH).time
      expect((kmh * KMH) / time).toBeGreaterThanOrEqual(minimum)
    }
  })

  it('keeps at least 0.05 m/s² of acceleration at 320 km/h, and no traction beyond', () => {
    const { net, segId, length } = line(60_000)
    const train = running(trainset(net, segId, 1000, length), 320)
    setNotch(train, MAX_NOTCH)
    train.tractionEffort = 1
    const dynamics = trainDynamics(net, train)
    expect(dynamics.acceleration).toBeGreaterThanOrEqual(0.05)
    expect(dynamics.acceleration).toBeCloseTo(0.071, 2)
    expect(dynamics.tractionForce).toBeCloseTo(99_000, -3) // 8 800 kW at 88.9 m/s

    train.currentSpeed = 322 * KMH
    expect(trainDynamics(net, train).tractionForce).toBe(0)

    // Left at full power the train settles on its maximum speed
    train.currentSpeed = 319 * KMH
    tickTrainSet(net, train, 120)
    expect(train.currentSpeed / KMH).toBeGreaterThan(319.9)
    expect(train.currentSpeed / KMH).toBeLessThan(321)
    expect(Math.abs(trainDynamics(net, train).acceleration)).toBeLessThan(1e-3)
  })

  it('running resistance is about 60 kN at 300 km/h and 12 kN at 100 km/h', () => {
    const { net, segId, length } = line(2000)
    const train = running(trainset(net, segId, 1000, length), 300)
    expect(trainDynamics(net, train).resistanceForce / 1000).toBeCloseTo(60.4, 0)
    train.currentSpeed = 100 * KMH
    const at100 = trainDynamics(net, train).resistanceForce / 1000
    expect(at100).toBeGreaterThan(11)
    expect(at100).toBeLessThan(12.5)
  })

  it('a 35 ‰ ramp weighs 148 kN on a 430 t trainset', () => {
    const { net, segId, env, length } = line(5000, 35)
    const train = running(trainset(net, segId, 2000, length), 100)
    const dynamics = trainDynamics(net, train, env)
    expect(dynamics.mass).toBe(424_000)
    expect(dynamics.gradientPermille).toBeCloseTo(35, 6)
    // Uphill in the direction of motion: the force is negative
    const for430t = (-dynamics.gradeForce / dynamics.mass) * 430_000
    expect(for430t / 1000).toBeCloseTo(148, 0)
    // 35 ‰ take 0.34 m/s² away
    expect(-dynamics.gradeForce / dynamics.mass).toBeCloseTo(0.343, 2)

    // Seen running downhill the signs are reversed
    train.direction = -1
    const down = trainDynamics(net, train, env)
    expect(down.gradientPermille).toBeCloseTo(-35, 6)
    expect(down.gradeForce).toBeCloseTo(-dynamics.gradeForce, 6)
  })
})

describe('control figures: reference model (tasks/recherche-traction-sim.py)', () => {
  it('Duplex from rest to 300 km/h in 289 s over 15.3 km, within 2 %', () => {
    const { net, segId, length } = line(60_000)
    const train = running(trainset(net, segId, 1000, length), 0)
    setNotch(train, MAX_NOTCH)
    const marks: Record<number, { time: number; distance: number }> = {}
    let time = 0
    let distance = 0
    for (const kmh of [100, 200, 300]) {
      const leg = run(net, train, () => train.currentSpeed >= kmh * KMH)
      time += leg.time
      distance += leg.distance
      marks[kmh] = { time, distance }
    }
    // The reference has no build-up of the effort: the 5 s ramp costs 2.5 s, within the tolerance
    expect(Math.abs(marks[300].time - 289) / 289).toBeLessThan(0.02)
    expect(Math.abs(marks[300].distance - 15_270) / 15_270).toBeLessThan(0.02)
    expect(Math.abs(marks[200].time - 130) / 130).toBeLessThan(0.02)
    expect(Math.abs(marks[200].distance - 3850) / 3850).toBeLessThan(0.02)
    expect(Math.abs(marks[100].time - 59 - 2.5) / 59).toBeLessThan(0.02)
  })

  it('accelerations at full power match the reference at 0 / 100 / 200 / 300 km/h', () => {
    const { net, segId, length } = line(2000)
    const train = running(trainset(net, segId, 1000, length), 0)
    setNotch(train, MAX_NOTCH)
    train.tractionEffort = 1
    for (const [kmh, expected] of [[0, 0.475], [100, 0.455], [200, 0.29], [300, 0.102]]) {
      train.currentSpeed = kmh * KMH
      expect(Math.abs(trainDynamics(net, train).acceleration - expected)).toBeLessThan(0.02 * expected + 0.0005)
    }
  })

  it('balances at 184 km/h at full power up a 35 ‰ ramp', () => {
    const { net, segId, env, length } = line(5000, 35)
    const train = running(trainset(net, segId, 2000, length), 184)
    setNotch(train, MAX_NOTCH)
    train.tractionEffort = 1
    const accelerationAt = (kmh: number) => {
      train.currentSpeed = kmh * KMH
      return trainDynamics(net, train, env).acceleration
    }
    // 2 % around 184 km/h
    expect(accelerationAt(184 * 0.98)).toBeGreaterThan(0)
    expect(accelerationAt(184 * 1.02)).toBeLessThan(0)
    expect(Math.abs(accelerationAt(184))).toBeLessThan(0.004)
  })

  it('coasting from 300 km/h: 250 km/h after 119 s and 9 km', () => {
    const { net, segId, length } = line(60_000)
    const train = running(trainset(net, segId, 1000, length), 300)
    const { time, distance } = run(net, train, () => train.currentSpeed <= 250 * KMH)
    expect(Math.abs(time - 119) / 119).toBeLessThan(0.02)
    expect(Math.abs(distance - 9000) / 9000).toBeLessThan(0.02)
  })

  it('TGV M (estimated data): 460 t, 0.50 m/s² at rest, 0.054 m/s² left at 320 km/h', () => {
    const { net, segId, length } = line(2000)
    const train = running(trainset(net, segId, 1000, length, 'tgvm'), 0)
    setNotch(train, MAX_NOTCH)
    train.tractionEffort = 1
    expect(trainDynamics(net, train).mass).toBe(460_000)
    expect(trainDynamics(net, train).acceleration).toBeCloseTo(0.504, 2)
    train.currentSpeed = 320 * KMH
    expect(trainDynamics(net, train).acceleration).toBeCloseTo(0.054, 2)
  })
})

describe('behaviour on a ramp', () => {
  function onRamp(gradient = 35) {
    const { net, segId, env, length } = line(5000, gradient)
    const train = trainset(net, segId, 2000, length)
    return { net, env, train }
  }

  it('holds on 35 ‰ with the brakes applied, as every train starts', () => {
    const { net, env, train } = onRamp()
    const before = JSON.stringify(train.vehicles)
    expect(tickTrainSet(net, train, 30, [], undefined, env)).toBe(true)
    expect(train.currentSpeed).toBe(0)
    expect(JSON.stringify(train.vehicles)).toBe(before)
    const dynamics = trainDynamics(net, train, env)
    expect(dynamics.acceleration).toBe(0)
    expect(dynamics.brakeForce).toBeGreaterThan(Math.abs(dynamics.gradeForce))
  })

  it('rolls back once the brake is released, the reverser staying where it was', () => {
    const { net, env, train } = onRamp()
    setReverser(train, 'forward')
    const x0 = headX(net, train)

    // Release held for 4 s: the pipe is back at 5 bar, the cylinders are still emptying
    setBrakeCommand(train, 'release')
    tickTrainSet(net, train, 1, [], undefined, env)
    expect(train.currentSpeed).toBe(0) // the cylinders are still nearly full
    tickTrainSet(net, train, 3, [], undefined, env)
    setBrakeCommand(train, 'hold')
    expect(train.brakePipe).toBe(BRAKE_PIPE_RELEASED)
    expect(train.brakeCylinder).toBeGreaterThan(0)

    tickTrainSet(net, train, 16, [], undefined, env)
    expect(train.brakeCylinder).toBe(0)
    expect(train.direction).toBe(-1)
    expect(train.reverser).toBe('forward')
    expect(train.currentSpeed).toBeGreaterThan(1)
    expect(headX(net, train)).toBeLessThan(x0 - 5)

    // Rolling down: the slope now pushes the train, 0.34 m/s² less the resistance
    const dynamics = trainDynamics(net, train, env)
    expect(dynamics.gradientPermille).toBeCloseTo(-35, 6)
    expect(dynamics.gradeForce).toBeGreaterThan(0)
    expect(dynamics.acceleration).toBeCloseTo((0.035 * GRAVITY) / 1.04, 1)
  })

  it('the brake catches a train that rolls back, and it stops exactly', () => {
    const { net, env, train } = onRamp()
    releaseBrake(train)
    tickTrainSet(net, train, 10, [], undefined, env)
    expect(train.direction).toBe(-1)
    expect(train.currentSpeed).toBeGreaterThan(2)

    setBrakeCommand(train, 'apply')
    tickTrainSet(net, train, 30, [], undefined, env)
    expect(train.currentSpeed).toBe(0)
    const before = JSON.stringify(train.vehicles)
    tickTrainSet(net, train, 10, [], undefined, env)
    expect(train.currentSpeed).toBe(0)
    expect(JSON.stringify(train.vehicles)).toBe(before)
  })

  it('P5 starts the train up a 35 ‰ ramp, and brings it back forward after it has rolled back', () => {
    const { net, env, train } = onRamp()
    releaseBrake(train)
    setReverser(train, 'forward')
    setNotch(train, MAX_NOTCH)
    // The effort takes 5 s to build up: the train first gives way…
    tickTrainSet(net, train, 2, [], undefined, env)
    expect(train.direction).toBe(-1)
    const lowest = headX(net, train)
    // … then is stopped and pulled up the ramp
    tickTrainSet(net, train, 60, [], undefined, env)
    expect(train.direction).toBe(1)
    expect(train.reverser).toBe('forward')
    expect(train.currentSpeed).toBeGreaterThan(3)
    expect(headX(net, train)).toBeGreaterThan(lowest + 50)
    // 212 kN − 146 kN of slope − resistance over 441 t of inertia
    train.currentSpeed = 0.01
    expect(trainDynamics(net, train, env).acceleration).toBeCloseTo(0.144, 2)
  })

  it('a rake without a power car does not pull, and rolls away like any other', () => {
    const { net, segId, length } = line(5000)
    const trailers = rake(net, segId, 2000, length, ['wagon', 'wagon', 'wagon'])
    releaseBrake(trailers)
    setReverser(trailers, 'forward')
    setNotch(trailers, MAX_NOTCH)
    tickTrainSet(net, trailers, 20)
    expect(trailers.currentSpeed).toBe(0)
    expect(trailers.tractionEffort).toBe(0)
    expect(trainDynamics(net, trailers).tractionForce).toBe(0)

    const ramp = line(5000, 35)
    const loose = rake(ramp.net, ramp.segId, 2000, ramp.length, ['wagon', 'wagon', 'wagon'])
    releaseBrake(loose)
    tickTrainSet(ramp.net, loose, 10, [], undefined, ramp.env)
    expect(loose.direction).toBe(-1)
    expect(loose.currentSpeed).toBeGreaterThan(2)
  })

  it('light resistances hold a released train on level track, and on a slope too weak to move it', () => {
    // 0.4 ‰ pushes 1.7 kN, less than the 2.7 kN of rolling resistance at rest
    const { net, segId, env, length } = line(5000, 0.4)
    const train = trainset(net, segId, 2000, length)
    releaseBrake(train)
    tickTrainSet(net, train, 30, [], undefined, env)
    expect(train.currentSpeed).toBe(0)
    expect(trainDynamics(net, train, env).acceleration).toBe(0)
  })

  it('averages the slope over the rake across a break in the profile', () => {
    resetIdCounter()
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 1000, y: 0 })
    const c = addNode(net, { x: 2000, y: 0 }, 1)
    const flat = addSegment(net, a.id, b.id)!
    addSegment(net, b.id, c.id)
    const env = { levelHeight: 35 } // 35 ‰ beyond x = 1000
    const train = trainset(net, flat.id, 900, 1000)
    releaseBrake(train)
    expect(trainDynamics(net, train, env).gradientPermille).toBe(0)

    // Half of the rake on the ramp: half of the slope
    const span = headX(net, train) - positionOnSegment(net, train.vehicles[9].rear.segId, train.vehicles[9].rear.t)!.x
    expect(advanceTrainSet(net, train, 100 + span / 2)).toBe(true)
    expect(trainDynamics(net, train, env).gradientPermille).toBeCloseTo(17.5, 6)
    expect(advanceTrainSet(net, train, span)).toBe(true)
    expect(trainDynamics(net, train, env).gradientPermille).toBeCloseTo(35, 6)
  })

  it('stays bounded and stable on an absurd ramp', () => {
    // 60 m up over 100 m: the train slides whatever the brakes do, never faster than free fall
    resetIdCounter()
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 600, y: 0 })
    const c = addNode(net, { x: 700, y: 0 }, 5)
    const flat = addSegment(net, a.id, b.id)!
    addSegment(net, b.id, c.id)
    const env = { levelHeight: 12 }
    const lone = rake(net, flat.id, 590, 600, ['loco'])
    expect(advanceTrainSet(net, lone, 60)).toBe(true) // both bogies on the ramp
    const dynamics = trainDynamics(net, lone, env)
    expect(dynamics.gradientPermille).toBeCloseTo(600, 6)
    expect(Math.abs(dynamics.gradeForce)).toBeLessThan(dynamics.mass * GRAVITY)
    expect(dynamics.acceleration).toBeGreaterThan(0)
    expect(dynamics.acceleration).toBeLessThan(GRAVITY)
    expect(dynamics.stoppingDistance).toBe(0)

    // It slides down to the flat part, where its brakes stop it
    for (let i = 0; i < 600; i++) {
      tickTrainSet(net, lone, 0.1, [], undefined, env)
      expect(Number.isFinite(lone.currentSpeed)).toBe(true)
      expect(lone.currentSpeed).toBeLessThan(40)
    }
    expect(lone.currentSpeed).toBe(0)
    expect(headX(net, lone)).toBeLessThan(600)
    expect(headX(net, lone)).toBeGreaterThan(100)
  })
})

describe('air brake', () => {
  function standing() {
    const { net, segId, length } = line(5000)
    const train = trainset(net, segId, 2000, length)
    releaseBrake(train)
    return { net, train }
  }

  it('apply drops to the first reduction at once, then reaches full service in 3.5 s', () => {
    const { net, train } = standing()
    setBrakeCommand(train, 'apply')
    tickTrainSet(net, train, STEP)
    expect(train.brakePipe).toBe(BRAKE_PIPE_FIRST_REDUCTION)
    tickTrainSet(net, train, 1.75)
    expect(train.brakePipe).toBeCloseTo(4.0, 6)
    tickTrainSet(net, train, 1.7)
    expect(train.brakePipe).toBeGreaterThan(BRAKE_PIPE_FULL_SERVICE)
    tickTrainSet(net, train, 0.1)
    expect(train.brakePipe).toBe(BRAKE_PIPE_FULL_SERVICE)
    // Held longer, it goes no lower
    tickTrainSet(net, train, 5)
    expect(train.brakePipe).toBe(BRAKE_PIPE_FULL_SERVICE)
  })

  it('hold keeps the pressure, release brings it back to 5 bar in 4 s', () => {
    const { net, train } = standing()
    setBrakeCommand(train, 'apply')
    tickTrainSet(net, train, STEP)
    tickTrainSet(net, train, 1.75)
    setBrakeCommand(train, 'hold')
    tickTrainSet(net, train, 20)
    expect(train.brakePipe).toBeCloseTo(4.0, 6)
    // Half of the reduction: 20 % for the first reduction + half of the remaining 80 %
    expect(train.brakeCylinder).toBeCloseTo(0.6, 6)
    expect(trainDynamics(net, train).brakePipeBar).toBeCloseTo(4.0, 6)
    expect(trainDynamics(net, train).brakeCylinderBar).toBeCloseTo(0.6 * BRAKE_CYLINDER_MAX_BAR, 6)

    train.brakePipe = BRAKE_PIPE_FULL_SERVICE
    setBrakeCommand(train, 'release')
    tickTrainSet(net, train, 2)
    expect(train.brakePipe).toBeCloseTo(4.25, 6)
    tickTrainSet(net, train, 1.9)
    expect(train.brakePipe).toBeLessThan(BRAKE_PIPE_RELEASED)
    tickTrainSet(net, train, 0.2)
    expect(train.brakePipe).toBe(BRAKE_PIPE_RELEASED)
  })

  it('a release let go above the first reduction completes by itself', () => {
    const { net, train } = standing()
    train.brakePipe = BRAKE_PIPE_FULL_SERVICE
    train.brakeCylinder = 1
    setBrakeCommand(train, 'release')
    tickTrainSet(net, train, 3) // 4.625 bar
    setBrakeCommand(train, 'hold')
    tickTrainSet(net, train, 10)
    expect(train.brakePipe).toBe(BRAKE_PIPE_RELEASED)
    expect(train.brakeCylinder).toBe(0)
    // Below the first reduction the pressure stays where the driver left it
    train.brakePipe = 4.2
    tickTrainSet(net, train, 10)
    expect(train.brakePipe).toBe(4.2)
  })

  it('cylinders follow with a dead time of 0.5 s and fill in 3 s; they empty in 4.5 s', () => {
    const { net, train } = standing()
    setBrakeCommand(train, 'apply')
    tickTrainSet(net, train, 0.4)
    expect(train.brakeCylinder).toBe(0)
    tickTrainSet(net, train, 0.4) // 0.3 s past the dead time
    expect(train.brakeCylinder).toBeCloseTo(0.1, 6)
    tickTrainSet(net, train, 1.2) // equivalent time of 2 s: half of the effort
    expect(train.brakeCylinder).toBeCloseTo(0.5, 6)
    tickTrainSet(net, train, 1.6)
    expect(train.brakeCylinder).toBe(1)

    setBrakeCommand(train, 'release')
    tickTrainSet(net, train, 2.25)
    // The cylinders lag behind the pipe on the way down too
    expect(train.brakeCylinder).toBeCloseTo(0.5, 6)
    tickTrainSet(net, train, 2.3)
    expect(train.brakeCylinder).toBe(0)
  })

  it('the brake cuts the traction at once, which comes back once it is released', () => {
    const { net, train } = standing()
    setReverser(train, 'forward')
    setNotch(train, MAX_NOTCH)
    tickTrainSet(net, train, 6)
    expect(train.tractionEffort).toBe(1)

    setBrakeCommand(train, 'apply')
    tickTrainSet(net, train, STEP)
    expect(train.tractionEffort).toBe(0)
    expect(trainDynamics(net, train).tractionForce).toBe(0)
    expect(train.notch).toBe(MAX_NOTCH)

    setBrakeCommand(train, 'release')
    tickTrainSet(net, train, 0.4)
    expect(train.tractionEffort).toBe(0)
    tickTrainSet(net, train, 1.5)
    expect(train.tractionEffort).toBeGreaterThan(0)
  })

  it('the traction falls back in 1 s when the handle returns to N', () => {
    const { net, train } = standing()
    setReverser(train, 'forward')
    setNotch(train, MAX_NOTCH)
    tickTrainSet(net, train, 6)
    setNotch(train, 0)
    tickTrainSet(net, train, 0.5)
    expect(train.tractionEffort).toBeCloseTo(0.5, 6)
    tickTrainSet(net, train, 0.6)
    expect(train.tractionEffort).toBe(0)
  })

  it('braking effort is capped by the adhesion, and the traction by Curtius-Kniffler', () => {
    expect(brakeAdhesion(100 * KMH)).toBeCloseTo(0.15, 9)
    expect(brakeAdhesion(250 * KMH)).toBeCloseTo(0.15, 9)
    expect(brakeAdhesion(300 * KMH)).toBeCloseTo(0.125, 9)
    expect(brakeAdhesion(350 * KMH)).toBeCloseTo(0.1, 9)
    expect(tractionAdhesion(0)).toBe(0.3)
    expect(tractionAdhesion(100 * KMH)).toBeCloseTo(7.5 / 144 + 0.161, 9)

    // Emergency at any speed: the brake never asks for more than the adhesion gives
    const { net, train } = standing()
    train.emergencyBrake = true
    train.brakePipe = 0
    train.brakeCylinder = 1
    for (const kmh of [10, 100, 200, 300, 320]) {
      train.currentSpeed = kmh * KMH
      const dynamics = trainDynamics(net, train)
      expect(dynamics.brakeForce).toBeLessThanOrEqual(brakeAdhesion(kmh * KMH) * dynamics.mass * GRAVITY)
      expect(dynamics.brakeForce).toBeGreaterThan(0)
    }
    // Total deceleration of the emergency curve: 0.81 m/s² above 310 km/h, 1.30 below 85
    train.currentSpeed = 320 * KMH
    expect(trainDynamics(net, train).acceleration).toBeCloseTo(-0.81, 6)
    train.currentSpeed = 60 * KMH
    expect(trainDynamics(net, train).acceleration).toBeCloseTo(-1.3, 6)
    // Full service: 0.75 and 1.10
    train.emergencyBrake = false
    train.brakePipe = BRAKE_PIPE_FULL_SERVICE
    expect(trainDynamics(net, train).acceleration).toBeCloseTo(-1.1, 6)
    train.currentSpeed = 320 * KMH
    expect(trainDynamics(net, train).acceleration).toBeCloseTo(-0.75, 6)
  })
})

describe('electric brake', () => {
  /** Trainset running at `kmh`, electric brake established on `notch`; downhill when the gradient is negative */
  function braking(kmh: number, notch = MIN_NOTCH, gradient = 0) {
    const { net, segId, env, length } = line(60_000, gradient)
    const train = running(trainset(net, segId, 1000, length), kmh)
    setNotch(train, notch)
    train.electricBrakeEffort = Math.abs(notch / MIN_NOTCH)
    return { net, env, train }
  }

  const force = (kmh: number, notch = MIN_NOTCH) => {
    const { net, train } = braking(kmh, notch)
    return trainDynamics(net, train).electricBrakeForce
  }

  it('gives 120 kN on a Duplex, less above the power limit, and fades out between 30 and 10 km/h', () => {
    expect(force(200)).toBeCloseTo(120_000, 6)
    // 8 800 kW at 300 km/h
    expect(force(300) / 1000).toBeCloseTo(105.6, 1)
    expect(force(30)).toBeCloseTo(120_000, 6)
    expect(force(20)).toBeCloseTo(60_000, 6)
    expect(force(10)).toBe(0)
    expect(force(5)).toBe(0)
  })

  it('each notch is a fifth of the effort', () => {
    expect(force(200, -3)).toBeCloseTo(72_000, 6)
    expect(force(200, -1)).toBeCloseTo(24_000, 6)
    expect(force(200, 0)).toBe(0)
  })

  it('slows a Duplex down by about 0.34 m/s² at 200 km/h on level track', () => {
    const { net, train } = braking(200)
    const dynamics = trainDynamics(net, train)
    expect(dynamics.brakeForce).toBe(0)
    expect(dynamics.acceleration).toBeCloseTo(-0.34, 2)
  })

  it('builds up in 4 s, once the traction is gone, and falls back in 1 s', () => {
    const { net, segId, length } = line(60_000)
    const train = running(trainset(net, segId, 1000, length), 200)
    setNotch(train, MAX_NOTCH)
    train.tractionEffort = 1

    // The motors cannot pull and brake at once
    setNotch(train, MIN_NOTCH)
    tickTrainSet(net, train, 0.5)
    expect(train.tractionEffort).toBeCloseTo(0.5, 6)
    expect(train.electricBrakeEffort).toBe(0)
    tickTrainSet(net, train, 0.6)
    expect(train.tractionEffort).toBe(0)

    tickTrainSet(net, train, 2)
    expect(train.electricBrakeEffort).toBeCloseTo(0.5, 1)
    tickTrainSet(net, train, 2.2)
    expect(train.electricBrakeEffort).toBe(1)

    setNotch(train, 0)
    tickTrainSet(net, train, 0.5)
    expect(train.electricBrakeEffort).toBeCloseTo(0.5, 6)
    tickTrainSet(net, train, 0.6)
    expect(train.electricBrakeEffort).toBe(0)
  })

  it('slows the train down but does not stop it: under 10 km/h it rolls on', () => {
    const { net, train } = braking(100)
    const { time } = run(net, train, () => train.currentSpeed < 10 * KMH)
    expect(time).toBeLessThan(200)
    expect(train.currentSpeed).toBeGreaterThan(0)
    expect(trainDynamics(net, train).electricBrakeForce).toBe(0)
    tickTrainSet(net, train, 5)
    expect(train.currentSpeed).toBeGreaterThan(0)
  })

  it('holds the speed down a 35 ‰ slope, where a coasting train runs away', () => {
    const held = braking(180, MIN_NOTCH, -35)
    run(held.net, held.train, () => false, held.env, 300)
    expect(held.train.currentSpeed / KMH).toBeGreaterThan(170)
    expect(held.train.currentSpeed / KMH).toBeLessThan(190)

    const coasting = braking(180, 0, -35)
    run(coasting.net, coasting.train, () => false, coasting.env, 300)
    expect(coasting.train.currentSpeed / KMH).toBeGreaterThan(250)
  })

  it('does not hold a standing train on a ramp', () => {
    const { net, segId, env, length } = line(5000, 35)
    const train = trainset(net, segId, 2000, length)
    releaseBrake(train)
    setNotch(train, MIN_NOTCH)
    tickTrainSet(net, train, 5, [], undefined, env)
    expect(train.currentSpeed).toBeGreaterThan(0)
    expect(train.direction).toBe(-1)
  })

  it('works whatever the reverser says, and not at all without a power car', () => {
    const { net, train } = braking(200)
    train.reverser = 'neutral'
    tickTrainSet(net, train, 1)
    expect(train.electricBrakeEffort).toBe(1)
    expect(trainDynamics(net, train).electricBrakeForce).toBeCloseTo(120_000, 6)

    const { net: net2, segId, length } = line(5000)
    const trailers = running(rake(net2, segId, 2000, length, ['wagon', 'wagon', 'wagon']), 100)
    setNotch(trailers, MIN_NOTCH)
    tickTrainSet(net2, trailers, 5)
    expect(trailers.electricBrakeEffort).toBe(0)
    expect(trainDynamics(net2, trailers).electricBrakeForce).toBe(0)
  })

  it('adds up with the air brake within the adhesion of the train', () => {
    const { net, train } = braking(200)
    const alone = trainDynamics(net, train)
    train.brakePipe = BRAKE_PIPE_FULL_SERVICE
    train.brakeCylinder = 1
    const both = trainDynamics(net, train)
    expect(both.brakeForce).toBeGreaterThan(0)
    expect(both.electricBrakeForce).toBeCloseTo(120_000, 6)
    expect(both.acceleration).toBeLessThan(alone.acceleration)

    // A lone power car: the two brakes together would ask for more than the rail can give
    const { net: net2, segId, length } = line(5000)
    const car = running(rake(net2, segId, 2000, length, ['loco']), 100)
    setNotch(car, MIN_NOTCH)
    car.electricBrakeEffort = 1
    expect(trainDynamics(net2, car).electricBrakeForce).toBeCloseTo(60_000, 6)
    car.brakePipe = BRAKE_PIPE_FULL_SERVICE
    car.brakeCylinder = 1
    const capped = trainDynamics(net2, car)
    expect(capped.electricBrakeForce).toBeLessThan(60_000)
    expect(capped.brakeForce + capped.electricBrakeForce).toBeCloseTo(brakeAdhesion(100 * KMH) * capped.mass * GRAVITY, 3)
  })

  it('the emergency brake takes it off', () => {
    const { net, train } = braking(200)
    triggerEmergencyBrake(train)
    tickTrainSet(net, train, 1)
    expect(train.notch).toBe(0)
    expect(train.electricBrakeEffort).toBe(0)
    expect(trainDynamics(net, train).electricBrakeForce).toBe(0)
  })

  it('gives the same slowing down within 1 % at 60 frames per second and at 10', () => {
    const slow = (dt: number) => {
      const { net, segId, length } = line(60_000)
      const train = running(trainset(net, segId, 1000, length), 200)
      setNotch(train, MIN_NOTCH)
      for (let i = 0; i < Math.round(60 / dt); i++) tickTrainSet(net, train, dt)
      return train.currentSpeed
    }
    expect(slow(0.1) / slow(1 / 60)).toBeCloseTo(1, 2)
  })
})

describe('stopping distance', () => {
  it('is what a full service application started now really takes, delay included', () => {
    for (const kmh of [80, 200, 300]) {
      const { net, segId, length } = line(60_000)
      const train = running(trainset(net, segId, 1000, length), kmh)
      const predicted = trainDynamics(net, train).stoppingDistance
      setBrakeCommand(train, 'apply')
      const { distance } = run(net, train, () => train.currentSpeed === 0)
      expect(Math.abs(distance - predicted) / predicted).toBeLessThan(0.005)
    }
  })

  it('is finite while coasting or pulling, and follows the slope', () => {
    const level = line(60_000)
    const coasting = running(trainset(level.net, level.segId, 1000, level.length), 200)
    const flat = trainDynamics(level.net, coasting).stoppingDistance
    expect(flat).toBeGreaterThan(1500)
    expect(flat).toBeLessThan(2000)

    const down = line(60_000, -35)
    const descending = running(trainset(down.net, down.segId, 1000, down.length), 200)
    const downhill = trainDynamics(down.net, descending, down.env).stoppingDistance
    const up = line(60_000, 35)
    const climbing = running(trainset(up.net, up.segId, 1000, up.length), 200)
    const uphill = trainDynamics(up.net, climbing, up.env).stoppingDistance
    expect(downhill).toBeGreaterThan(flat * 1.3)
    expect(uphill).toBeLessThan(flat * 0.85)
    expect(Number.isFinite(downhill)).toBe(true)
  })

  it('uses the emergency curve while the emergency brake is latched', () => {
    const { net, segId, length } = line(60_000)
    const train = running(trainset(net, segId, 1000, length), 300)
    const service = trainDynamics(net, train).stoppingDistance
    triggerEmergencyBrake(train)
    const emergency = trainDynamics(net, train).stoppingDistance
    expect(emergency).toBeLessThan(service)
    const { distance } = run(net, train, () => train.currentSpeed === 0)
    expect(Math.abs(distance - emergency) / emergency).toBeLessThan(0.005)
  })

  it('is infinite where the brake cannot hold the train', () => {
    const { net, segId, env, length } = line(60_000, -200)
    const train = running(trainset(net, segId, 1000, length), 100)
    expect(trainDynamics(net, train, env).stoppingDistance).toBe(Infinity)
  })
})

describe('integration', () => {
  it('gives the same run within 1 % at 60 frames per second and at 10', () => {
    const drive = (dt: number) => {
      const { net, segId, env, length } = line(20_000, 10)
      const train = running(trainset(net, segId, 1000, length), 0)
      const ticks = (seconds: number) => {
        for (let i = 0; i < Math.round(seconds / dt); i++) tickTrainSet(net, train, dt, [], undefined, env)
      }
      const x0 = headX(net, train)
      setNotch(train, MAX_NOTCH)
      ticks(60)
      const speedAfterTraction = train.currentSpeed
      setNotch(train, 2)
      ticks(20)
      setBrakeCommand(train, 'apply')
      ticks(1)
      setBrakeCommand(train, 'hold')
      ticks(10)
      const speedAfterLightBrake = train.currentSpeed
      setBrakeCommand(train, 'apply')
      ticks(60)
      return { speedAfterTraction, speedAfterLightBrake, distance: headX(net, train) - x0, stopped: train.currentSpeed }
    }
    const fine = drive(1 / 60)
    const coarse = drive(0.1)
    expect(fine.stopped).toBe(0)
    expect(coarse.stopped).toBe(0)
    expect(fine.speedAfterTraction).toBeGreaterThan(15)
    expect(fine.distance).toBeGreaterThan(1000)
    for (const key of ['speedAfterTraction', 'speedAfterLightBrake', 'distance'] as const) {
      expect(Math.abs(coarse[key] - fine[key]) / fine[key]).toBeLessThan(0.01)
    }
  })

  it('one long tick equals the same time in small ones', () => {
    const drive = (dt: number, count: number) => {
      const { net, segId, length } = line(20_000)
      const train = running(trainset(net, segId, 1000, length), 0)
      setNotch(train, MAX_NOTCH)
      for (let i = 0; i < count; i++) tickTrainSet(net, train, dt)
      return { speed: train.currentSpeed, x: headX(net, train) }
    }
    const long = drive(10, 1)
    const short = drive(1 / 30, 300)
    expect(long.speed).toBeCloseTo(short.speed, 6)
    expect(long.x).toBeCloseTo(short.x, 5)
  })

  it('does nothing on a zero or negative tick', () => {
    const { net, segId, length } = line(2000)
    const train = running(trainset(net, segId, 1000, length), 10)
    const x0 = headX(net, train)
    expect(tickTrainSet(net, train, 0)).toBe(true)
    expect(tickTrainSet(net, train, -1)).toBe(true)
    expect(train.currentSpeed).toBe(10 * KMH)
    expect(headX(net, train)).toBe(x0)
  })
})

describe('curves', () => {
  /** A straight, then a quarter circle of the given radius turning left */
  function curved(radius: number) {
    resetIdCounter()
    const net = createNetwork()
    const a = addNode(net, { x: -1000, y: 0 })
    const b = addNode(net, { x: 0, y: 0 })
    const straight = addSegment(net, a.id, b.id)!
    const end = addNode(net, { x: radius, y: radius })
    // Control point at the meeting of the two end tangents; the arc is cut into short pieces
    expect(addArcCurve(net, b.id, end.id, { x: radius, y: 0 })).not.toBeNull()
    return { net, straight }
  }

  it('curve resistance is m·g·0.8/R and the lateral acceleration v²/R', () => {
    const radius = 400
    const { net, straight } = curved(radius)
    const train = running(trainset(net, straight.id, 900, 1000), 72)
    expect(trainDynamics(net, train).curveForce).toBe(0)
    expect(trainDynamics(net, train).lateralAcceleration).toBe(0)

    // Whole rake in the curve
    for (let i = 0; i < 35; i++) expect(advanceTrainSet(net, train, 10)).toBe(true)
    const inCurve = trainDynamics(net, train)
    const expected = (inCurve.mass * GRAVITY * 0.8) / radius // 8.3 kN, 2 ‰
    expect(Math.abs(inCurve.curveForce - expected) / expected).toBeLessThan(0.03)
    expect(Math.abs(inCurve.lateralAcceleration - 20 * 20 / radius)).toBeLessThan(0.05)

    // It slows the train down a little more than the straight does
    releaseBrake(train)
    const straightRun = line(2000)
    const onStraight = running(trainset(straightRun.net, straightRun.segId, 1000, straightRun.length), 72)
    expect(inCurve.acceleration).toBeLessThan(trainDynamics(straightRun.net, onStraight).acceleration)
  })
})

describe('obstacles', () => {
  const tailX = (net: Network, train: TrainSet) => vehicleRearEndPos(net, train.vehicles[train.vehicles.length - 1])!.x

  it('a train rolling back into the buffer stop hits it, then rests against it without moving', () => {
    const { net, segId, env, length } = line(5000, 35)
    const train = trainset(net, segId, 260, length) // tail some 70 m from the buffer at x = 0
    releaseBrake(train)

    let impact = 0
    let ticks = 0
    while (impact === 0 && ticks < 3000) {
      const free = tickTrainSet(net, train, 1 / 60, [], undefined, env)
      ticks++
      if (!free) impact = train.impactSpeed
      else expect(train.impactSpeed).toBe(0)
    }
    // √(2 × 0.33 m/s² × 70 m): the speed of the impact is reported, the train is stopped dead
    expect(impact).toBeGreaterThan(5)
    expect(impact).toBeLessThan(9)
    expect(train.currentSpeed).toBe(0)
    expect(tailX(net, train)).toBeCloseTo(0, 5)
    expect(trackLeftAhead(net, train, 50)).toBeCloseTo(0, 5)

    // Gravity keeps pushing it onto the buffer: no bounce, no new impact, not a micron of movement
    const before = JSON.stringify(train.vehicles)
    for (let i = 0; i < 300; i++) {
      expect(tickTrainSet(net, train, 1 / 60, [], undefined, env)).toBe(false)
      expect(train.currentSpeed).toBe(0)
      expect(train.impactSpeed).toBe(0)
    }
    expect(JSON.stringify(train.vehicles)).toBe(before)

    // It can still pull away from it
    setReverser(train, 'forward')
    setNotch(train, MAX_NOTCH)
    let free = false
    for (let i = 0; i < 1200; i++) free = tickTrainSet(net, train, 1 / 60, [], undefined, env)
    expect(free).toBe(true)
    expect(train.direction).toBe(1)
    expect(tailX(net, train)).toBeGreaterThan(10)
  })

  it('a train driven into the buffer stop at speed reports the speed of the impact', () => {
    const { net, segId, length } = line(2000)
    const train = running(rake(net, segId, 1900, length, ['loco']), 36)
    let free = true
    for (let i = 0; i < 1200 && free; i++) free = tickTrainSet(net, train, 1 / 60)
    expect(free).toBe(false)
    expect(train.impactSpeed).toBeCloseTo(10, 0)
    expect(train.currentSpeed).toBe(0)
    expect(vehicleFrontEndPos(net, train.vehicles[0])!.x).toBeCloseTo(2000, 5)
    expect(tickTrainSet(net, train, 1 / 60)).toBe(true) // nothing pushes it any more
    expect(train.impactSpeed).toBe(0)
  })

  it('a train rolling back stops a coupling gap short of the train standing behind it', () => {
    const { net, segId, env, length } = line(5000, 35)
    const parked = trainset(net, segId, 600, length, 'duplex', 'P') // brakes applied
    const loose = trainset(net, segId, 900, length, 'duplex', 'L')
    releaseBrake(loose)
    const parkedBefore = JSON.stringify(parked.vehicles)

    let impact = 0
    for (let i = 0; i < 3000 && impact === 0; i++) {
      if (!tickTrainSet(net, loose, 1 / 60, [loose, parked], undefined, env)) impact = loose.impactSpeed
    }
    expect(impact).toBeGreaterThan(3)
    expect(loose.direction).toBe(-1)
    expect(tailX(net, loose) - vehicleFrontEndPos(net, parked.vehicles[0])!.x).toBeCloseTo(COUPLING_GAP, 5)

    const before = JSON.stringify(loose.vehicles)
    for (let i = 0; i < 120; i++) {
      expect(tickTrainSet(net, loose, 1 / 60, [loose, parked], undefined, env)).toBe(false)
      expect(loose.currentSpeed).toBe(0)
      expect(loose.impactSpeed).toBe(0)
    }
    expect(JSON.stringify(loose.vehicles)).toBe(before)
    expect(JSON.stringify(parked.vehicles)).toBe(parkedBefore)
  })
})
