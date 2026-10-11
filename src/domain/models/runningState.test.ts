import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, resetIdCounter } from './network'
import { applyGame, captureGame } from './runningState'
import { createVehicle, makeTrainSet, type TrainSet } from './train'

function trainOnTrack(id: string, t: number): TrainSet {
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 2000, y: 0 })
  const seg = addSegment(net, a.id, b.id)!
  return makeTrainSet(id, [createVehicle(net, seg.id, t, 'loco')!])
}

/** A train under way: handle at P4, brakes released, 30 m/s */
function running(train: TrainSet): TrainSet {
  Object.assign(train, { currentSpeed: 30, reverser: 'forward', notch: 4, brakeCommand: 'release', brakePipe: 5, brakeCylinder: 0, tractionEffort: 80_000 })
  return train
}

const controls = (t: TrainSet) => [t.currentSpeed, t.reverser, t.notch, t.brakeCommand, t.brakePipe, t.brakeCylinder, t.tractionEffort]

describe('what the trains were doing, written down and given back', () => {
  beforeEach(() => resetIdCounter(0))

  it('gives a train loaded at rest the speed, handles, brakes and pilot it had', () => {
    const saved = JSON.parse(JSON.stringify(captureGame([running(trainOnTrack('train_1', 0.5))], new Set(['train_1']), true)))
    resetIdCounter(0)
    const loaded = trainOnTrack('train_1', 0.5)
    expect(applyGame([loaded], saved)).toEqual({ piloted: ['train_1'], freeView: true, restored: 1 })
    expect(controls(loaded)).toEqual([30, 'forward', 4, 'release', 5, 0, 80_000])
  })

  it('leaves at rest a train that is not where the game left it, or that is another one', () => {
    const saved = captureGame([running(trainOnTrack('train_1', 0.5))], new Set(['train_1']), true)
    resetIdCounter(0)
    const moved = trainOnTrack('train_1', 0.6)
    const rest = controls(moved)
    expect(applyGame([moved], saved)).toEqual({ piloted: [], freeView: false, restored: 0 })
    expect(controls(moved)).toEqual(rest)
    resetIdCounter(0)
    const other = trainOnTrack('train_2', 0.5)
    expect(applyGame([other], saved).restored).toBe(0)
  })

  it('takes nothing from a state that does not read', () => {
    const good = captureGame([running(trainOnTrack('train_1', 0.5))], new Set(), false)!
    const spoilt = (change: Record<string, unknown>) => ({ version: 1, trains: { train_1: { ...good.trains.train_1, ...change } } })
    for (const raw of [null, 'x', { version: 2, trains: good.trains }, { version: 1, trains: null }, spoilt({ speed: -1 }), spoilt({ speed: 1e9 }), spoilt({ speed: Number.NaN }), spoilt({ notch: 2.5 }), spoilt({ notch: 99 }), spoilt({ reverser: 'up' }), spoilt({ brakeCommand: 'slam' }), spoilt({ brakePipe: 12 }), spoilt({ emergencyBrake: 'yes' }), spoilt({ at: null })]) {
      resetIdCounter(0)
      const loaded = trainOnTrack('train_1', 0.5)
      const rest = controls(loaded)
      expect(applyGame([loaded], raw).restored).toBe(0)
      expect(controls(loaded)).toEqual(rest)
    }
  })

  it('has nothing to write without a train, and no free view without a pilot', () => {
    expect(captureGame([], new Set(), false)).toBeNull()
    const saved = captureGame([running(trainOnTrack('train_1', 0.5))], new Set(), true)
    resetIdCounter(0)
    expect(applyGame([trainOnTrack('train_1', 0.5)], saved).freeView).toBe(false)
  })
})
