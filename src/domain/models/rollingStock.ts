/**
 * Rolling stock dimensions and joint rules of articulated TGV trainsets.
 *
 * A trainset is built vehicle by vehicle from two kinds: power cars ('loco', two own bogies)
 * and trailers ('wagon'). The kind of joint between two neighbours follows from the pair:
 *  - trailer – trailer : articulated, both rest on the same (Jacobs) bogie;
 *  - power car – trailer : permanently coupled, each on its own bogie;
 *  - power car – power car : two trainsets coupled together (multiple unit).
 */

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
  }
  trailer: {
    /** Distance between the two pivots of a trailer (shared bogie to shared bogie) */
    pitch: number
    /** Extra body length of an end trailer beyond its own bogie, on the power car side */
    endExtension: number
    width: number
  }
}

/**
 * Lengths over couplers add up to the real trainset: power cars + N trailer pitches + 2 end
 * extensions. Values marked "deduced" or "estimated" do not come from a manufacturer sheet.
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
    },
    trailer: {
      pitch: 18.7,
      endExtension: 3.145, // deduced: (200.19 − 2 × 22.15 − 8 × 18.70) / 2
      width: 2.904,
    },
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
    },
    trailer: {
      pitch: 17.7, // deduced: Duplex trailer shortened by 1 m
      endExtension: 3.35, // deduced: (202 − 2 × 18 − 9 × 17.70) / 2
      width: 2.904, // estimated: same as Duplex
    },
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
