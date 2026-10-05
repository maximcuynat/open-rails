/**
 * Rolling stock dimensions and joint rules of articulated TGV trainsets.
 *
 * A trainset is built vehicle by vehicle from two kinds: power cars ('loco', two own bogies)
 * and trailers ('wagon'). The kind of joint between two neighbours follows from the pair:
 *  - trailer – trailer : articulated, both rest on the same (Jacobs) bogie;
 *  - power car – trailer : permanently coupled, each on its own bogie;
 *  - power car – power car : two trainsets coupled together (multiple unit).
 */

import type { LineType } from './speedLimits'

export type RollingStockModel = 'duplex' | 'tgvm'

export const DEFAULT_ROLLING_STOCK: RollingStockModel = 'duplex'

/** Gap (meters) left between the two power cars of coupled trainsets. */
export const UNIT_COUPLING_GAP = 0.80

export interface RollingStockSpec {
  label: string
  /** Axle spacing of a bogie */
  bogieWheelbase: number
  powerCar: {
    /** Length over couplers */
    length: number
    /** Distance between the two bogie pivots */
    bogieDistance: number
    /** Body length beyond the bogie pivot on the nose side */
    noseOverhang: number
    /** Body length beyond the bogie pivot on the trailer side */
    rearOverhang: number
    width: number
    /** Mass in working order, kg */
    mass: number
    /** Power at the wheel rims, W */
    power: number
    /** Starting tractive effort, N */
    maxEffort: number
    /** Largest effort of the electric (rheostatic) brake, N */
    electricBrakeEffort: number
    /** Mass carried by the driven axles, kg: what the adhesion limit applies to */
    adhesiveMass: number
  }
  trailer: {
    /** Distance between the two pivots of a trailer (shared bogie to shared bogie) */
    pitch: number
    /** Extra body length of an end trailer beyond its own bogie, on the power car side */
    endExtension: number
    width: number
    /** Mass with a normal load of passengers, kg */
    mass: number
  }
  /** Trailers between the two power cars of the complete trainset */
  trailerCount: number
  /**
   * Running resistance R = a + b·v + c·v² of the complete trainset on level straight track
   * (N, N·s/m, N·s²/m², v in m/s). See `consistResistanceCoefficients` for other rakes.
   */
  resistance: { a: number; b: number; c: number }
  /** Maximum speed in service, m/s */
  maxSpeed: number
  /**
   * Cant deficiency (mm) the stock is allowed in a curve, by line type: each step applies up to
   * its speed `upTo` (km/h), the last one beyond as well
   */
  cantDeficiency: Record<LineType, readonly CantDeficiencyStep[]>
  /** Cant deficiency (mm) at which the stock overturns */
  overturningDeficiency: number
}

export interface CantDeficiencyStep {
  /** km/h */
  upTo: number
  /** mm */
  deficiency: number
}

/**
 * Deficiency admitted for a TGV: category III of the SNCF rules on conventional lines, the 2008
 * high-speed TSI on high-speed lines (the SNCF rules for those are not public).
 */
const TGV_CANT_DEFICIENCY: Record<LineType, readonly CantDeficiencyStep[]> = {
  classic: [{ upTo: 200, deficiency: 160 }, { upTo: Infinity, deficiency: 150 }],
  highSpeed: [{ upTo: 300, deficiency: 130 }, { upTo: Infinity, deficiency: 80 }],
}

/**
 * Deficiency at which a TGV Duplex overturns: fitted on the Eckwersheim derailment (945 m, 163 mm
 * of cant, about 235 km/h) — one accident, one rolling stock.
 */
const TGV_OVERTURNING_DEFICIENCY = 525

/**
 * Lengths over couplers add up to the real trainset: power cars + N trailer pitches + 2 end
 * extensions. Values marked "deduced" or "estimated" do not come from a manufacturer sheet.
 *
 * Physical data (see `tasks/recherche-traction.md` §9): the Duplex figures are published ones and
 * its resistance comes from the SNCF coefficients of the TGV Dasye (same trailers, same nose).
 * Almost nothing is published for the TGV M: every physical value of it is an estimate.
 */
export const ROLLING_STOCK: Record<RollingStockModel, RollingStockSpec> = {
  // TGV Duplex / Euroduplex (Ouigo, inOui): M + 8 R + M = 200.19 m
  duplex: {
    label: 'TGV Duplex',
    bogieWheelbase: 3.0,
    powerCar: {
      length: 22.15,
      bogieDistance: 14.0,
      noseOverhang: 5.005, // estimated split of the 8.15 m of overhang
      rearOverhang: 3.145, // estimated, same as the end trailer extension
      width: 2.814,
      mass: 68_000,
      power: 4_400_000, // 8 800 kW per trainset under 25 kV
      maxEffort: 106_000, // 212 kN per trainset
      electricBrakeEffort: 60_000, // 30 kN per motor bogie, 120 kN per trainset
      adhesiveMass: 68_000, // all four axles driven
    },
    trailer: {
      pitch: 18.7,
      endExtension: 3.145, // deduced: (200.19 − 2 × 22.15 − 8 × 18.70) / 2
      width: 2.904,
      mass: 36_000, // deduced: (424 t loaded − 2 × 68 t) / 8
    },
    trailerCount: 8,
    resistance: { a: 2680, b: 115, c: 6.93 }, // Dasye coefficients scaled to 424 t
    maxSpeed: 320 / 3.6,
    cantDeficiency: TGV_CANT_DEFICIENCY,
    overturningDeficiency: TGV_OVERTURNING_DEFICIENCY,
  },
  // TGV M (Avelia Horizon): M + 9 R + M = 202 m, the end extension is the "greffon" module
  tgvm: {
    label: 'TGV M',
    bogieWheelbase: 3.0,
    powerCar: {
      length: 18.0,
      bogieDistance: 11.38, // estimated: Duplex proportions on an 18 m body
      noseOverhang: 4.07, // estimated
      rearOverhang: 2.55, // estimated
      width: 2.814, // estimated: same as Duplex
      mass: 68_000, // estimated: same as Duplex
      power: 3_880_000, // 7 760 kW per trainset at the rims
      maxEffort: 122_000, // estimated: 244 kN per trainset, unsourced figure
      electricBrakeEffort: 60_000, // estimated: same as Duplex
      adhesiveMass: 68_000, // estimated
    },
    trailer: {
      pitch: 17.7, // deduced: Duplex trailer shortened by 1 m
      endExtension: 3.35, // deduced: (202 − 2 × 18 − 9 × 17.70) / 2
      width: 2.904, // estimated: same as Duplex
      mass: 36_000, // estimated: (460 t loaded, itself estimated − 2 × 68 t) / 9
    },
    trailerCount: 9,
    // estimated: Dasye coefficients scaled to 460 t, aerodynamic term reduced by 13 %
    resistance: { a: 2910, b: 125, c: 6.03 },
    maxSpeed: 320 / 3.6,
    cantDeficiency: TGV_CANT_DEFICIENCY, // estimated: same as Duplex
    overturningDeficiency: TGV_OVERTURNING_DEFICIENCY, // estimated: same as Duplex
  },
}

/** What the joint rules need to know about a vehicle (a `Vehicle` satisfies it). */
export interface StockVehicle {
  kind: 'loco' | 'wagon'
  /** Body turned around: the nose of a power car is on its `rear` bogie side */
  flipped?: boolean
  model?: RollingStockModel
}

export type JointKind = 'articulated' | 'coupled' | 'unit'

/** True for a model of the table (saved data may carry anything). */
export function isRollingStockModel(value: unknown): value is RollingStockModel {
  return typeof value === 'string' && Object.keys(ROLLING_STOCK).includes(value)
}

export function stockSpec(veh: StockVehicle): RollingStockSpec {
  return ROLLING_STOCK[veh.model ?? DEFAULT_ROLLING_STOCK]
}

/** Distance between the front and rear bogie pivots of a vehicle. */
export function bogieDistance(veh: StockVehicle): number {
  const spec = stockSpec(veh)
  return veh.kind === 'loco' ? spec.powerCar.bogieDistance : spec.trailer.pitch
}

export function bodyWidth(veh: StockVehicle): number {
  const spec = stockSpec(veh)
  return veh.kind === 'loco' ? spec.powerCar.width : spec.trailer.width
}

export function jointKind(prev: StockVehicle, next: StockVehicle): JointKind {
  if (prev.kind === 'wagon' && next.kind === 'wagon') return 'articulated'
  if (prev.kind === 'loco' && next.kind === 'loco') return 'unit'
  return 'coupled'
}

/**
 * Body length beyond the bogie pivot at one end of a vehicle, given the vehicle it faces there
 * (null at a free end). A trailer only overhangs towards a power car: next to another trailer,
 * or at a free end, its body stops on the pivot of the shared bogie.
 */
export function vehicleEndOverhang(
  veh: StockVehicle,
  end: 'front' | 'rear',
  neighbour: StockVehicle | null,
): number {
  const spec = stockSpec(veh)
  if (veh.kind === 'loco') {
    const noseAtFront = !veh.flipped
    return (end === 'front') === noseAtFront ? spec.powerCar.noseOverhang : spec.powerCar.rearOverhang
  }
  return neighbour?.kind === 'loco' ? spec.trailer.endExtension : 0
}

/** Overhang at one end of the i-th vehicle of a rake (ordered front to rear). */
export function endOverhang(vehicles: readonly StockVehicle[], i: number, end: 'front' | 'rear'): number {
  const neighbour = end === 'front' ? vehicles[i - 1] : vehicles[i + 1]
  return vehicleEndOverhang(vehicles[i], end, neighbour ?? null)
}

/**
 * Distance along the track from the rear bogie of `prev` to the front bogie of `next`.
 * Zero on an articulated joint: both vehicles rest on the same bogie.
 */
export function jointSpacing(prev: StockVehicle, next: StockVehicle): number {
  const kind = jointKind(prev, next)
  if (kind === 'articulated') return 0
  return (
    vehicleEndOverhang(prev, 'rear', next) +
    vehicleEndOverhang(next, 'front', prev) +
    (kind === 'unit' ? UNIT_COUPLING_GAP : 0)
  )
}

/** Length over both ends of a rake laid out on straight track. */
export function consistLength(vehicles: readonly StockVehicle[]): number {
  if (vehicles.length === 0) return 0
  let len = endOverhang(vehicles, 0, 'front') + endOverhang(vehicles, vehicles.length - 1, 'rear')
  for (let i = 0; i < vehicles.length; i++) {
    len += bogieDistance(vehicles[i])
    if (i > 0) len += jointSpacing(vehicles[i - 1], vehicles[i])
  }
  return len
}

/** Number of physical bogies under a rake: a shared bogie counts once. */
export function bogieCount(vehicles: readonly StockVehicle[]): number {
  let count = 2 * vehicles.length
  for (let i = 1; i < vehicles.length; i++) {
    if (jointKind(vehicles[i - 1], vehicles[i]) === 'articulated') count--
  }
  return count
}

// ─── Physical data of a rake ──────────────────────────────────────────────────
//
// Everything below is computed on demand from the vehicles: rakes are recomposed (coupling,
// uncoupling, vehicles removed) all over the code, so nothing is cached on the train.

/** The complete trainset of a model: power car, trailers, power car turned nose outwards. */
export function referenceConsist(model: RollingStockModel): StockVehicle[] {
  return [
    { kind: 'loco', model },
    ...Array.from({ length: ROLLING_STOCK[model].trailerCount }, (): StockVehicle => ({ kind: 'wagon', model })),
    { kind: 'loco', model, flipped: true },
  ]
}

/** Mass of a vehicle, kg */
export function vehicleMass(veh: StockVehicle): number {
  const spec = stockSpec(veh)
  return veh.kind === 'loco' ? spec.powerCar.mass : spec.trailer.mass
}

function sumOver(vehicles: readonly StockVehicle[], value: (veh: StockVehicle) => number): number {
  return vehicles.reduce((sum, veh) => sum + value(veh), 0)
}

/** Mass of a rake, kg */
export function consistMass(vehicles: readonly StockVehicle[]): number {
  return sumOver(vehicles, vehicleMass)
}

/** Power at the wheel rims of a rake, W: 0 without a power car */
export function consistPower(vehicles: readonly StockVehicle[]): number {
  return sumOver(vehicles, (veh) => (veh.kind === 'loco' ? stockSpec(veh).powerCar.power : 0))
}

/** Starting tractive effort of a rake, N: 0 without a power car */
export function consistMaxEffort(vehicles: readonly StockVehicle[]): number {
  return sumOver(vehicles, (veh) => (veh.kind === 'loco' ? stockSpec(veh).powerCar.maxEffort : 0))
}

/** Largest effort of the electric brake of a rake, N: 0 without a power car */
export function consistElectricBrakeEffort(vehicles: readonly StockVehicle[]): number {
  return sumOver(vehicles, (veh) => (veh.kind === 'loco' ? stockSpec(veh).powerCar.electricBrakeEffort : 0))
}

/** Mass on the driven axles of a rake, kg */
export function adhesiveMass(vehicles: readonly StockVehicle[]): number {
  return sumOver(vehicles, (veh) => (veh.kind === 'loco' ? stockSpec(veh).powerCar.adhesiveMass : 0))
}

/** Maximum speed of a rake, m/s: that of its slowest vehicle */
export function consistMaxSpeed(vehicles: readonly StockVehicle[]): number {
  if (vehicles.length === 0) return ROLLING_STOCK[DEFAULT_ROLLING_STOCK].maxSpeed
  return Math.min(...vehicles.map((veh) => stockSpec(veh).maxSpeed))
}

/**
 * Coefficients of the running resistance R = a + b·v + c·v² of a rake (N, N·s/m, N·s²/m²).
 * The complete trainset of a model gets the values of the table. For any other rake — estimated
 * rule — `a` and `b` (rolling and mechanical losses) follow the mass and `c` (aerodynamic drag)
 * follows the length, model by model: two coupled trainsets have twice the resistance of one, a
 * lone power car about a tenth of the drag of its trainset.
 */
export function consistResistanceCoefficients(vehicles: readonly StockVehicle[]): { a: number; b: number; c: number } {
  const total = { a: 0, b: 0, c: 0 }
  for (const model of Object.keys(ROLLING_STOCK) as RollingStockModel[]) {
    const own = vehicles.filter((veh) => (veh.model ?? DEFAULT_ROLLING_STOCK) === model)
    if (own.length === 0) continue
    const { resistance } = ROLLING_STOCK[model]
    const reference = referenceConsist(model)
    const massShare = consistMass(own) / consistMass(reference)
    total.a += resistance.a * massShare
    total.b += resistance.b * massShare
    total.c += resistance.c * (consistLength(own) / consistLength(reference))
  }
  return total
}

/** Running resistance (N) of a rake at `speed` (m/s) on level straight track */
export function consistResistance(vehicles: readonly StockVehicle[], speed: number): number {
  const { a, b, c } = consistResistanceCoefficients(vehicles)
  return a + b * speed + c * speed * speed
}
