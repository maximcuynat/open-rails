import { beforeEach, describe, expect, it } from 'vitest'
import { addCurveChain, addNode, addSegment, createNetwork, resetIdCounter } from './network'
import { tangentArcPieces } from '../geometry/curve'
import type { Network, Segment } from './types'
import { rerailTrain, type LineSettings } from './speedLimits'
import {
  advanceTrainSet,
  canSwitchDrivingCab,
  checkDerailment,
  createVehicle,
  makeTrainSet,
  releaseEmergencyBrake,
  resetTrainControls,
  setNotch,
  setReverser,
  tickTrainSet,
  type TrainSet,
} from './train'
import { BRAKE_PIPE_FULL_SERVICE, BRAKE_PIPE_RELEASED, PHYSICS_STEP, setBrakeCommand, trainDynamics, type DrivingEnvironment } from './trainDynamics'

beforeEach(() => resetIdCounter(0))

const CLASSIC_160: LineSettings = { lineSpeed: 160, lineType: 'classic' }
const ENV: DrivingEnvironment = { levelHeight: 6, line: CLASSIC_160 }

/**
 * The curve of Eckwersheim: 945 m of radius laid with 163 mm of cant, between two straights. With
 * `drop` the track after the curve runs downhill (levels).
 */
function eckwersheim(drop = 0): { net: Network; curve: Segment[]; before: Segment; after: Segment } {
  const net = createNetwork()
  const start = addNode(net, { x: -1000, y: 0 })
  const entry = addNode(net, { x: 0, y: 0 })
  const exit = addNode(net, { x: 945, y: 945 }, 0)
  const end = addNode(net, { x: 945, y: 945 + 5000 }, -drop)
  const before = addSegment(net, start.id, entry.id)!
  const arc = tangentArcPieces(entry.pos, { x: 1, y: 0 }, exit.pos)!
  expect(arc.radius).toBeCloseTo(945, 6)
  const curve = addCurveChain(net, entry.id, exit.id, arc.pieces)!.segments
  for (const seg of curve) seg.cant = 163
  const after = addSegment(net, exit.id, end.id)!
  return { net, curve, before, after }
}

function rakeOn(net: Network, segId: string, t: number): TrainSet {
  const lead = createVehicle(net, segId, t, 'loco', 1)!
  const train = makeTrainSet('T', [lead])
  for (const [i, kind] of (['wagon', 'wagon', 'loco'] as const).entries()) {
    train.vehicles.push({ id: `v${i}`, kind, front: { ...lead.rear }, rear: { ...lead.rear }, ...(kind === 'loco' ? { flipped: true } : {}) })
  }
  expect(advanceTrainSet(net, train, 0)).toBe(true)
  return train
}

function running(train: TrainSet, kmh: number): TrainSet {
  train.currentSpeed = kmh / 3.6
  train.reverser = 'forward'
  train.brakePipe = BRAKE_PIPE_RELEASED
  train.brakeCylinder = 0
  return train
}

function simulate(net: Network, train: TrainSet, seconds: number, env = ENV): void {
  for (let i = 0; i < seconds / PHYSICS_STEP; i++) tickTrainSet(net, train, PHYSICS_STEP, [], undefined, env)
}

describe('a curve taken by a train', () => {
  it('Eckwersheim at 160 km/h: 157 mm of deficiency, normal; the curve allows 160', () => {
    const { net, curve } = eckwersheim()
    const train = running(rakeOn(net, curve[3].id, 0.5), 160)
    const dynamics = trainDynamics(net, train, ENV)
    expect(dynamics.cantDeficiency).toBeCloseTo(157, 0)
    expect(dynamics.curveState).toBe('ok')
    expect(dynamics.speedLimit).toBeCloseTo(160 / 3.6, 9)
    simulate(net, train, 2)
    expect(train.derailed).toBeNull()
  })

  it('Eckwersheim at 176 km/h: 224 mm, discomfort, no derailment', () => {
    const { net, curve } = eckwersheim()
    const train = running(rakeOn(net, curve[3].id, 0.5), 176)
    const dynamics = trainDynamics(net, train, ENV)
    expect(dynamics.cantDeficiency).toBeCloseTo(224, 0)
    expect(dynamics.curveState).toBe('discomfort')
    simulate(net, train, 2)
    expect(train.derailed).toBeNull()
  })

  it('beyond 300 mm the curve is taken in danger, still on the rails', () => {
    const { net, curve } = eckwersheim()
    const train = running(rakeOn(net, curve[3].id, 0.5), 200)
    const dynamics = trainDynamics(net, train, ENV)
    expect(dynamics.cantDeficiency).toBeGreaterThan(300)
    expect(dynamics.curveState).toBe('danger')
    expect(checkDerailment(net, train, ENV)).toBe(false)
  })

  it('entering a curve at its speed limit is felt for a moment (cant half run in), without danger', () => {
    const { net, curve, before } = eckwersheim()
    const train = running(rakeOn(net, before.id, 0.9), 160)
    let worst = 0
    const states = new Set<string>()
    for (let i = 0; i < 400; i++) {
      expect(advanceTrainSet(net, train, 2)).toBe(true)
      const dynamics = trainDynamics(net, train, ENV)
      worst = Math.max(worst, dynamics.cantDeficiency)
      states.add(dynamics.curveState)
    }
    expect(train.vehicles[train.vehicles.length - 1].rear.segId).toBe(curve[2].id)
    // Equilibrium 320 mm, half of the 163 mm at the tangent point
    expect(worst).toBeCloseTo(320 - 163 / 2, 0)
    expect([...states].sort()).toEqual(['discomfort', 'ok'])
    expect(trainDynamics(net, train, ENV).cantDeficiency).toBeCloseTo(157, 0)
  })

  it('straight track never shows a deficiency', () => {
    const { net, before } = eckwersheim()
    const train = running(rakeOn(net, before.id, 0.5), 300)
    expect(trainDynamics(net, train, ENV)).toMatchObject({ cantDeficiency: 0, curveState: 'ok' })
  })
})

describe('derailment', () => {
  it('Eckwersheim at 235 km/h: the train overturns, with the speed and the limit recorded', () => {
    const { net, curve } = eckwersheim()
    const train = running(rakeOn(net, curve[3].id, 0.5), 235)
    expect(trainDynamics(net, train, ENV).cantDeficiency).toBeGreaterThanOrEqual(525)
    tickTrainSet(net, train, PHYSICS_STEP, [], undefined, ENV)
    expect(train.derailed).not.toBeNull()
    expect(train.derailed!.speed).toBeCloseTo(235, 0)
    expect(train.derailed!.limit).toBe(160)
    expect(train.emergencyBrake).toBe(true)
    expect(train.notch).toBe(0)
  })

  it('a derailed train stops and cannot be set moving again', () => {
    const { net, curve } = eckwersheim(40)
    const train = running(rakeOn(net, curve[3].id, 0.5), 235)
    train.notch = 5
    train.tractionEffort = 1
    simulate(net, train, 1)
    expect(train.derailed).not.toBeNull()
    expect(train.tractionEffort).toBe(0)

    // Locked while it slides to a stop
    expect(setNotch(train, 3)).toBe(false)
    setBrakeCommand(train, 'release')
    simulate(net, train, 120)
    expect(train.currentSpeed).toBe(0)
    expect(train.emergencyBrake).toBe(true)

    // At rest: no traction, no release, no reverser, no change of cab
    expect(setNotch(train, 3)).toBe(false)
    expect(train.notch).toBe(0)
    expect(releaseEmergencyBrake(train)).toBe(false)
    expect(setReverser(train, 'reverse')).toBe(false)
    expect(canSwitchDrivingCab(train)).toBe(false)
    setBrakeCommand(train, 'release')
    expect(train.brakeCommand).toBe('hold')

    // No drift either: brakes emptied by force on the downhill track, it still stays put
    const where = { ...train.vehicles[0].front }
    expect(where.segId).not.toBe(curve[3].id)
    train.emergencyBrake = false
    train.brakePipe = BRAKE_PIPE_RELEASED
    train.brakeCylinder = 0
    expect(trainDynamics(net, train, ENV).gradeForce).not.toBe(0)
    simulate(net, train, 10)
    expect(train.currentSpeed).toBe(0)
    expect(train.vehicles[0].front).toEqual(where)
    expect(trainDynamics(net, train, ENV).acceleration).toBe(0)
  })

  it('stopping the train by other means does not put it back on the track', () => {
    const { net, curve } = eckwersheim()
    const train = running(rakeOn(net, curve[3].id, 0.5), 235)
    tickTrainSet(net, train, PHYSICS_STEP, [], undefined, ENV)
    const derailed = train.derailed
    expect(derailed).not.toBeNull()
    // What entering and leaving the driving mode do to every train
    resetTrainControls(train)
    expect(train.derailed).toBe(derailed)
    expect(train.currentSpeed).toBe(0)
    expect(train.emergencyBrake).toBe(true)
    expect(setNotch(train, 1)).toBe(false)
  })

  it('rerailTrain leaves it where it stopped: at rest, brakes applied, drivable', () => {
    const { net, curve } = eckwersheim()
    const train = running(rakeOn(net, curve[3].id, 0.5), 235)
    simulate(net, train, 120)
    expect(train.derailed).not.toBeNull()
    expect(train.currentSpeed).toBe(0)
    const where = { ...train.vehicles[0].front }

    expect(rerailTrain(train)).toBe(true)
    expect(rerailTrain(train)).toBe(false)
    expect(train.derailed).toBeNull()
    expect(train.vehicles[0].front).toEqual(where)
    expect(train).toMatchObject({
      currentSpeed: 0,
      notch: 0,
      reverser: 'neutral',
      emergencyBrake: false,
      brakePipe: BRAKE_PIPE_FULL_SERVICE,
      brakeCylinder: 1,
      brakeCommand: 'hold',
    })

    // Drivable again
    expect(setReverser(train, 'forward')).toBe(true)
    setBrakeCommand(train, 'release')
    simulate(net, train, 10)
    expect(setNotch(train, 5)).toBe(true)
    simulate(net, train, 20)
    expect(train.currentSpeed).toBeGreaterThan(1)
    expect(train.derailed).toBeNull()
  })

  it('rerailing a moving derailed train stops it there', () => {
    const { net, curve } = eckwersheim()
    const train = running(rakeOn(net, curve[3].id, 0.5), 235)
    simulate(net, train, 1)
    expect(train.currentSpeed).toBeGreaterThan(0)
    expect(rerailTrain(train)).toBe(true)
    expect(train.currentSpeed).toBe(0)
  })

  it('a cant raised by hand saves the train, a cant taken off loses it sooner', () => {
    const { net, curve } = eckwersheim()
    for (const seg of curve) seg.cant = 180
    const saved = running(rakeOn(net, curve[3].id, 0.5), 235)
    expect(checkDerailment(net, saved, ENV)).toBe(false)
    for (const seg of curve) seg.cant = 0
    const lost = running(rakeOn(net, curve[3].id, 0.5), 215)
    expect(checkDerailment(net, lost, ENV)).toBe(true)
  })

  it('nothing derails off the real scale, and no curve is reported', () => {
    const { net, curve } = eckwersheim()
    const env: DrivingEnvironment = { levelHeight: 6, line: { ...CLASSIC_160, realScale: false } }
    const train = running(rakeOn(net, curve[3].id, 0.5), 300)
    simulate(net, train, 2, env)
    expect(train.derailed).toBeNull()
    const dynamics = trainDynamics(net, train, env)
    expect(dynamics).toMatchObject({ cantDeficiency: 0, curveState: 'ok' })
    // The line speed still applies
    expect(dynamics.speedLimit).toBeCloseTo(160 / 3.6, 9)
  })
})
