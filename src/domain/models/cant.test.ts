import { describe, expect, it } from 'vitest'
import {
  DANGER_DEFICIENCY,
  admittedDeficiency,
  automaticCant,
  cantDeficiency,
  cantForRampLength,
  cantRampLength,
  consistOverturningDeficiency,
  contactSpacing,
  curveMaxSpeed,
  curveMinRadius,
  curveStateFor,
  equilibriumCant,
  layableCant,
  uncompensatedAcceleration,
} from './cant'
import { ROLLING_STOCK } from './rollingStock'

const OVERTURNING = ROLLING_STOCK.duplex.overturningDeficiency

describe('cant formulas', () => {
  it('cant is measured across the wheel contact points: 1 500 mm on standard gauge', () => {
    expect(contactSpacing()).toBeCloseTo(1500, 6)
    expect(contactSpacing(1.0)).toBeCloseTo(1065, 6)
  })

  it('equilibrium cant is 11.8 · V² / R', () => {
    expect(equilibriumCant(160, 1000)).toBeCloseTo((11.8 * 160 * 160) / 1000, 0)
    expect(equilibriumCant(100, Infinity)).toBe(0)
    // A narrower gauge needs less cant for the same angle
    expect(equilibriumCant(160, 1000, 1.0)).toBeCloseTo((equilibriumCant(160, 1000) * 1065) / 1500, 6)
  })

  it('100 mm of deficiency is about 0.65 m/s², 153 mm is 1 m/s²', () => {
    expect(uncompensatedAcceleration(100)).toBeCloseTo(0.65, 2)
    expect(uncompensatedAcceleration(153)).toBeCloseTo(1.0, 2)
  })

  it('the speed of a curve and its smallest radius are the same relation', () => {
    const speed = curveMaxSpeed(1000, 160, 150)
    expect(speed).toBeCloseTo(162, 0)
    expect(curveMinRadius(speed, 160, 150)).toBeCloseTo(1000, 6)
    expect(curveMaxSpeed(Infinity, 0, 150)).toBe(Infinity)
  })

  it('the ramp of a cant is 180 / V mm per metre', () => {
    expect(cantRampLength(160, 160)).toBeCloseTo(142.2, 1)
    expect(cantForRampLength(cantRampLength(160, 160), 160)).toBeCloseTo(160, 6)
  })

  it('cant is laid in steps of 5 mm and not under 20 mm', () => {
    expect(layableCant(98.2)).toBe(95)
    expect(layableCant(19.9)).toBe(0)
    expect(layableCant(20)).toBe(20)
  })
})

describe('admitted deficiency of a TGV', () => {
  it('conventional line: 160 mm up to 200 km/h, 150 mm beyond', () => {
    expect(admittedDeficiency('classic', 160)).toBe(160)
    expect(admittedDeficiency('classic', 200)).toBe(160)
    expect(admittedDeficiency('classic', 220)).toBe(150)
  })

  it('high-speed line: 130 mm up to 300 km/h, 80 mm beyond', () => {
    expect(admittedDeficiency('highSpeed', 300)).toBe(130)
    expect(admittedDeficiency('highSpeed', 320)).toBe(80)
  })

  it('the TGV M carries the same figures as the Duplex (estimated)', () => {
    expect(admittedDeficiency('classic', 160, 'tgvm')).toBe(160)
    expect(ROLLING_STOCK.tgvm.overturningDeficiency).toBe(OVERTURNING)
    expect(consistOverturningDeficiency([{ kind: 'loco', model: 'tgvm' }, { kind: 'wagon' }])).toBe(525)
  })
})

describe('curve state', () => {
  it('normal up to the admitted deficiency, discomfort up to 300 mm, danger beyond', () => {
    expect(curveStateFor(160, 160)).toBe('ok')
    expect(curveStateFor(161, 160)).toBe('discomfort')
    expect(curveStateFor(230, 160)).toBe('discomfort')
    expect(curveStateFor(DANGER_DEFICIENCY, 160)).toBe('discomfort')
    expect(curveStateFor(DANGER_DEFICIENCY + 1, 160)).toBe('danger')
  })
})

// The table "Tests de contrôle / Dévers" of the plan
describe('control cases', () => {
  it('Eckwersheim at its nominal speed: 157 mm, at the admitted limit', () => {
    const deficiency = cantDeficiency(160, 945, 163)
    expect(deficiency).toBeCloseTo(157, 0)
    expect(curveStateFor(deficiency, admittedDeficiency('classic', 160))).toBe('ok')
  })

  it('Eckwersheim at the test speed: 224 mm, discomfort, no overturning', () => {
    const deficiency = cantDeficiency(176, 945, 163)
    expect(deficiency).toBeCloseTo(224, 0)
    expect(curveStateFor(deficiency, admittedDeficiency('classic', 176))).toBe('discomfort')
    expect(deficiency).toBeLessThan(OVERTURNING)
  })

  it('Eckwersheim at the speed of the accident: overturning', () => {
    expect(cantDeficiency(235, 945, 163)).toBeGreaterThanOrEqual(OVERTURNING)
    expect(cantDeficiency(235, 945, 163)).toBeCloseTo(527, -1)
  })

  it('LGV Sud-Est, smallest radius: 86 mm, admitted', () => {
    const deficiency = cantDeficiency(300, 4000, 180)
    expect(deficiency).toBeCloseTo(86, -0.5)
    expect(deficiency).toBeLessThanOrEqual(admittedDeficiency('highSpeed', 300))
  })

  it('LGV Sud-Est, measured curve of 9 000 m: 40 mm', () => {
    expect(cantDeficiency(300, 9000, 78)).toBeCloseTo(40, 0)
  })

  it('conventional line at 160 on 1 000 m with 160 mm: 142 mm, admitted; smallest radius about 947 m', () => {
    const deficiency = cantDeficiency(160, 1000, 160)
    expect(deficiency).toBeCloseTo(142, 0)
    expect(deficiency).toBeLessThanOrEqual(admittedDeficiency('classic', 160))
    expect(Math.abs(curveMinRadius(160, 160, 160) - 947)).toBeLessThan(5)
  })

  it('automatic cant on 1 000 m, conventional line at 160: 155 mm', () => {
    expect(automaticCant(1000, 160, 'classic')).toBe(155)
  })

  it('track without cant, 500 m, 150 mm of deficiency: 80 km/h', () => {
    expect(curveMaxSpeed(500, 0, 150)).toBeCloseTo(80, 0)
  })

  it('overturning comes at about 1.5 times the limit on a conventional line, 1.65 on a high-speed line', () => {
    expect(curveMaxSpeed(1000, 160, OVERTURNING) / curveMaxSpeed(1000, 160, 150)).toBeCloseTo(1.5, 1)
    expect(curveMaxSpeed(4000, 180, OVERTURNING) / curveMaxSpeed(4000, 180, 80)).toBeCloseTo(1.65, 2)
  })
})

describe('automatic cant', () => {
  it('none on straight track, none under 20 mm', () => {
    expect(automaticCant(Infinity, 160, 'classic')).toBe(0)
    expect(automaticCant(20000, 100, 'classic')).toBe(0)
  })

  it('is raised to hold the line speed when the share of the equilibrium is not enough', () => {
    // 950 m at 160: 318 mm of equilibrium, 160 mm admitted, so 158 mm needed: rounded up, not down
    expect(automaticCant(950, 160, 'classic')).toBe(160)
    expect(cantDeficiency(160, 950, 160)).toBeLessThanOrEqual(160)
  })

  it('is capped by the line type: 160 mm on a conventional line, 180 mm on a high-speed line', () => {
    expect(automaticCant(500, 160, 'classic')).toBe(160)
    expect(automaticCant(4000, 300, 'highSpeed')).toBe(180)
  })

  it('is capped by (R − 100) / 2 on a small radius', () => {
    expect(automaticCant(300, 160, 'classic')).toBe(100)
    expect(automaticCant(100, 160, 'classic')).toBe(0)
  })

  it('follows the 7/10 rule on a high-speed line: about 120 mm on 7 143 m at 320', () => {
    expect(automaticCant(7143, 320, 'highSpeed')).toBe(120)
  })
})
