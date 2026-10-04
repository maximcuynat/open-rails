import { describe, it, expect } from 'vitest'
import {
  ROLLING_STOCK,
  UNIT_COUPLING_GAP,
  bogieCount,
  bogieDistance,
  consistLength,
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
