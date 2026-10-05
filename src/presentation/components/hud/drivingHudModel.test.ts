import { describe, expect, it } from 'vitest'
import {
  BRAKE_CYLINDER_GAUGE,
  BRAKE_PIPE_GAUGE,
  accelerationLabel,
  brakeStatus,
  effortPercent,
  gaugeRatio,
  gradientLabel,
  handleEffort,
  isBrakeHolding,
  notchLabel,
  speedDialTicks,
  stoppingDistanceLabel,
} from './drivingHudModel'

describe('driving console model', () => {
  describe('brake state', () => {
    const train = (brakeCommand: 'apply' | 'hold' | 'release' = 'hold', emergencyBrake = false) => ({ brakeCommand, emergencyBrake })

    it('reads "Frein serré" on a train that starts with its brakes applied', () => {
      const status = brakeStatus(train(), { brakePipeBar: 3.5, brakeCylinderBar: 3.8 })
      expect(status).toEqual({ label: 'Frein serré', tone: 'applied' })
      expect(isBrakeHolding(status)).toBe(true)
    })

    it('reads "Frein desserré" only once the pipe is full and the cylinders are empty', () => {
      expect(brakeStatus(train(), { brakePipeBar: 5, brakeCylinderBar: 0 })).toEqual({ label: 'Frein desserré', tone: 'released' })
      // The pipe is back at 5 bar but the cylinders still hold pressure
      const emptying = brakeStatus(train(), { brakePipeBar: 5, brakeCylinderBar: 1.6 })
      expect(emptying).toEqual({ label: 'Desserrage…', tone: 'releasing' })
      expect(isBrakeHolding(emptying)).toBe(false)
    })

    it('follows the handle while it is held', () => {
      expect(brakeStatus(train('release'), { brakePipeBar: 4.1, brakeCylinderBar: 2.4 }).label).toBe('Desserrage…')
      expect(brakeStatus(train('apply'), { brakePipeBar: 4.6, brakeCylinderBar: 0.3 }).label).toBe('Serrage…')
      // Full service reached: nothing more to wait for
      expect(brakeStatus(train('apply'), { brakePipeBar: 3.5, brakeCylinderBar: 3.8 }).label).toBe('Frein serré')
      // A light application left where it is
      expect(brakeStatus(train('hold'), { brakePipeBar: 4.5, brakeCylinderBar: 1 }).label).toBe('Frein serré')
    })

    it('shows the emergency brake above everything else', () => {
      expect(brakeStatus(train('release', true), { brakePipeBar: 0, brakeCylinderBar: 3.8 })).toEqual({ label: 'Urgence', tone: 'emergency' })
    })
  })

  it('names the notches B5 … B1, N, P1 … P5', () => {
    expect([-5, -1, 0, 1, 5].map(notchLabel)).toEqual(['B5', 'B1', 'N', 'P1', 'P5'])
  })

  it('reads the effort of the side the handle is on: electric brake under N, traction otherwise', () => {
    const dynamics = { tractionEffort: 0.4, electricBrakeEffort: 0.6 }
    expect(handleEffort(-3, dynamics)).toBe(0.6)
    expect(handleEffort(0, dynamics)).toBe(0.4)
    expect(handleEffort(2, dynamics)).toBe(0.4)
  })

  it('gives the applied effort as a percentage', () => {
    expect(effortPercent(0)).toBe(0)
    expect(effortPercent(0.604)).toBe(60)
    expect(effortPercent(1.2)).toBe(100)
  })

  it('signs the real acceleration and never prints a negative zero', () => {
    expect(accelerationLabel(0.318)).toBe('+0,32 m/s²')
    expect(accelerationLabel(-1.1)).toBe('−1,10 m/s²')
    expect(accelerationLabel(0)).toBe('0,00 m/s²')
    expect(accelerationLabel(-0.001)).toBe('0,00 m/s²')
  })

  it('gives the slope with its sense', () => {
    expect(gradientLabel(35)).toBe('↗ montée 35 ‰')
    expect(gradientLabel(-35)).toBe('↘ descente 35 ‰')
    expect(gradientLabel(4.26)).toBe('↗ montée 4,3 ‰')
    expect(gradientLabel(0)).toBe('palier')
    expect(gradientLabel(-0.2)).toBe('palier')
    expect(gradientLabel(NaN)).toBe('palier')
  })

  it('graduates the speed dial in round steps up to the top speed', () => {
    expect(speedDialTicks(320)).toEqual([0, 80, 160, 240, 320])
    expect(speedDialTicks(300)).toEqual([0, 80, 160, 240, 300])
    expect(speedDialTicks(160)).toEqual([0, 40, 80, 120, 160])
    expect(speedDialTicks(0)).toEqual([0])
  })

  it('scales the gauges on the brake pressures', () => {
    expect(BRAKE_PIPE_GAUGE).toEqual({ max: 5, marks: [3.5, 4.5, 5] })
    expect(BRAKE_CYLINDER_GAUGE).toEqual({ max: 3.8, marks: [0, 3.8] })
    expect(gaugeRatio(3.5, BRAKE_PIPE_GAUGE)).toBeCloseTo(0.7)
    expect(gaugeRatio(0, BRAKE_PIPE_GAUGE)).toBe(0)
    expect(gaugeRatio(4.2, BRAKE_CYLINDER_GAUGE)).toBe(1)
    expect(gaugeRatio(NaN, BRAKE_CYLINDER_GAUGE)).toBe(0)
  })
})

describe('stoppingDistanceLabel', () => {
  it('is in metres, then in kilometres, whatever the unit of the project', () => {
    expect(stoppingDistanceLabel(0)).toBe('0 m')
    expect(stoppingDistanceLabel(29.6)).toBe('30 m')
    expect(stoppingDistanceLabel(999.4)).toBe('999 m')
    expect(stoppingDistanceLabel(3344)).toBe('3,3 km')
  })

  it('shows ∞ when the brake cannot hold the train', () => {
    expect(stoppingDistanceLabel(Infinity)).toBe('∞')
  })
})
