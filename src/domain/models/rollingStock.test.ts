import { describe, it, expect } from 'vitest'
import {
  ROLLING_STOCK,
  UNIT_COUPLING_GAP,
  bogieCount,
  adhesiveMass,
  bogieDistance,
  consistLength,
  consistMass,
  consistElectricBrakeEffort,
  consistMaxEffort,
  consistMaxSpeed,
  consistPower,
  consistResistance,
  consistResistanceCoefficients,
  referenceConsist,
  endOverhang,
  jointKind,
  jointSpacing,
  vehicleEndOverhang,
  type RollingStockModel,
  type StockVehicle,
} from './rollingStock'

/** Complete trainset: power car, n trailers, power car turned nose outwards. */
function trainset(model: RollingStockModel, trailers: number): StockVehicle[] {
  return [
    { kind: 'loco', model },
    ...Array.from({ length: trailers }, (): StockVehicle => ({ kind: 'wagon', model })),
    { kind: 'loco', model, flipped: true },
  ]
}

describe('rolling stock', () => {
  it('power car dimensions add up to its length over couplers', () => {
    for (const spec of Object.values(ROLLING_STOCK)) {
      const { length, bogieDistance: d, noseOverhang, rearOverhang } = spec.powerCar
      expect(noseOverhang + d + rearOverhang).toBeCloseTo(length, 6)
    }
  })

  it('a TGV Duplex of 8 trailers is 200.19 m long on 13 bogies', () => {
    const rake = trainset('duplex', 8)
    expect(consistLength(rake)).toBeCloseTo(200.19, 2)
    expect(bogieCount(rake)).toBe(13)
  })

  it('a TGV M of 9 trailers is 202 m long on 14 bogies', () => {
    const rake = trainset('tgvm', 9)
    expect(consistLength(rake)).toBeCloseTo(202, 2)
    expect(bogieCount(rake)).toBe(14)
  })

  it('defaults to the Duplex when a vehicle has no model', () => {
    expect(bogieDistance({ kind: 'wagon' })).toBe(ROLLING_STOCK.duplex.trailer.pitch)
    expect(bogieDistance({ kind: 'loco' })).toBe(ROLLING_STOCK.duplex.powerCar.bogieDistance)
  })

  it('derives the joint from the two neighbours', () => {
    const loco: StockVehicle = { kind: 'loco' }
    const wagon: StockVehicle = { kind: 'wagon' }
    expect(jointKind(wagon, wagon)).toBe('articulated')
    expect(jointKind(loco, wagon)).toBe('coupled')
    expect(jointKind(wagon, loco)).toBe('coupled')
    expect(jointKind(loco, loco)).toBe('unit')
  })

  it('two trailers share their bogie: no distance between rear and front pivots', () => {
    expect(jointSpacing({ kind: 'wagon' }, { kind: 'wagon' })).toBe(0)
  })

  it('a trailer only overhangs towards a power car', () => {
    const wagon: StockVehicle = { kind: 'wagon' }
    const ext = ROLLING_STOCK.duplex.trailer.endExtension
    expect(vehicleEndOverhang(wagon, 'front', { kind: 'loco' })).toBe(ext)
    expect(vehicleEndOverhang(wagon, 'rear', { kind: 'wagon' })).toBe(0)
    expect(vehicleEndOverhang(wagon, 'rear', null)).toBe(0)
  })

  it('the nose of a power car follows its orientation', () => {
    const { noseOverhang, rearOverhang } = ROLLING_STOCK.duplex.powerCar
    expect(vehicleEndOverhang({ kind: 'loco' }, 'front', null)).toBe(noseOverhang)
    expect(vehicleEndOverhang({ kind: 'loco' }, 'rear', null)).toBe(rearOverhang)
    expect(vehicleEndOverhang({ kind: 'loco', flipped: true }, 'front', null)).toBe(rearOverhang)
    expect(vehicleEndOverhang({ kind: 'loco', flipped: true }, 'rear', null)).toBe(noseOverhang)
  })

  it('power car and end trailer keep their own bogies', () => {
    const { powerCar, trailer } = ROLLING_STOCK.duplex
    expect(jointSpacing({ kind: 'loco' }, { kind: 'wagon' })).toBeCloseTo(powerCar.rearOverhang + trailer.endExtension, 6)
    // Tail power car, nose outwards: its trailer side is its body rear
    expect(jointSpacing({ kind: 'wagon' }, { kind: 'loco', flipped: true })).toBeCloseTo(
      trailer.endExtension + powerCar.rearOverhang,
      6,
    )
  })

  it('two trainsets coupled nose to nose are separated by the coupling gap', () => {
    const nose = ROLLING_STOCK.duplex.powerCar.noseOverhang
    // Tail power car of the first set (nose at the rear), lead power car of the second (nose at the front)
    expect(jointSpacing({ kind: 'loco', flipped: true }, { kind: 'loco' })).toBeCloseTo(2 * nose + UNIT_COUPLING_GAP, 6)

    const double = [...trainset('duplex', 8), ...trainset('duplex', 8)]
    expect(consistLength(double)).toBeCloseTo(2 * 200.19 + UNIT_COUPLING_GAP, 2)
    expect(bogieCount(double)).toBe(26)
  })

  it('a rake under construction: trailers alone end on their pivots', () => {
    const rake: StockVehicle[] = [{ kind: 'wagon' }, { kind: 'wagon' }, { kind: 'wagon' }]
    expect(endOverhang(rake, 0, 'front')).toBe(0)
    expect(endOverhang(rake, 2, 'rear')).toBe(0)
    expect(consistLength(rake)).toBeCloseTo(3 * ROLLING_STOCK.duplex.trailer.pitch, 6)
    expect(bogieCount(rake)).toBe(4)
  })
})

describe('physical data of a rake', () => {
  const KMH = 1 / 3.6

  it('a complete Duplex: 424 t, 8 800 kW, 212 kN, 136 t on driven axles, 320 km/h', () => {
    const duplex = trainset('duplex', 8)
    expect(referenceConsist('duplex')).toEqual(duplex)
    expect(consistMass(duplex)).toBe(424_000)
    expect(consistPower(duplex)).toBe(8_800_000)
    expect(consistMaxEffort(duplex)).toBe(212_000)
    // Electric brake: 30 kN per motor bogie, four of them
    expect(consistElectricBrakeEffort(duplex)).toBe(120_000)
    expect(adhesiveMass(duplex)).toBe(136_000)
    expect(consistMaxSpeed(duplex)).toBeCloseTo(320 * KMH, 9)
  })

  it('a complete TGV M (estimated): 460 t, 7 760 kW, 244 kN', () => {
    const tgvm = trainset('tgvm', 9)
    expect(referenceConsist('tgvm')).toEqual(tgvm)
    expect(consistMass(tgvm)).toBe(460_000)
    expect(consistPower(tgvm)).toBe(7_760_000)
    expect(consistMaxEffort(tgvm)).toBe(244_000)
    expect(consistResistanceCoefficients(tgvm)).toEqual({ a: 2910, b: 125, c: 6.03 })
  })

  it('Duplex running resistance: about 60 kN at 300 km/h, 11 kN at 100 km/h, double from 200 to 300', () => {
    const duplex = trainset('duplex', 8)
    const { a, b, c } = consistResistanceCoefficients(duplex)
    expect(a).toBeCloseTo(2680, 9)
    expect(b).toBeCloseTo(115, 9)
    expect(c).toBeCloseTo(6.93, 9)
    expect(consistResistance(duplex, 300 * KMH) / 1000).toBeCloseTo(60.4, 1)
    expect(consistResistance(duplex, 100 * KMH) / 1000).toBeCloseTo(11.2, 1)
    expect(consistResistance(duplex, 0)).toBeCloseTo(2680, 9)
    expect(consistResistance(duplex, 300 * KMH) / consistResistance(duplex, 200 * KMH)).toBeCloseTo(2, 1)
  })

  it('a rake without a power car has no power and no effort', () => {
    const trailers: StockVehicle[] = [{ kind: 'wagon' }, { kind: 'wagon' }]
    expect(consistPower(trailers)).toBe(0)
    expect(consistMaxEffort(trailers)).toBe(0)
    expect(consistElectricBrakeEffort(trailers)).toBe(0)
    expect(adhesiveMass(trailers)).toBe(0)
    expect(consistMass(trailers)).toBe(72_000)
    expect(consistResistance(trailers, 10)).toBeGreaterThan(0)
    expect(consistMass([])).toBe(0)
    expect(consistResistanceCoefficients([])).toEqual({ a: 0, b: 0, c: 0 })
  })

  it('two coupled trainsets add everything up', () => {
    const one = trainset('duplex', 8)
    const two = [...one, ...one]
    expect(consistMass(two)).toBe(848_000)
    expect(consistPower(two)).toBe(17_600_000)
    expect(consistMaxEffort(two)).toBe(424_000)
    const single = consistResistanceCoefficients(one)
    const double = consistResistanceCoefficients(two)
    expect(double.a).toBeCloseTo(2 * single.a, 6)
    expect(double.b).toBeCloseTo(2 * single.b, 6)
    // The drag follows the length: twice a trainset plus the coupling gap
    expect(double.c / single.c).toBeGreaterThan(2)
    expect(double.c / single.c).toBeLessThan(2.01)
  })

  it('a partial rake scales: rolling terms with its mass, drag with its length (estimated rule)', () => {
    const loco: StockVehicle[] = [{ kind: 'loco' }]
    const alone = consistResistanceCoefficients(loco)
    expect(alone.a).toBeCloseTo((2680 * 68) / 424, 6)
    expect(alone.b).toBeCloseTo((115 * 68) / 424, 6)
    expect(alone.c).toBeCloseTo((6.93 * 22.15) / 200.19, 6)

    // A Duplex coupled to a TGV M: each model brings its own share
    const mixed = [...trainset('duplex', 8), ...trainset('tgvm', 9)]
    const sum = consistResistanceCoefficients(mixed)
    expect(sum.a).toBeCloseTo(2680 + 2910, 6)
    expect(sum.c).toBeCloseTo(6.93 + 6.03, 6)
    expect(consistMass(mixed)).toBe(884_000)
  })
})
