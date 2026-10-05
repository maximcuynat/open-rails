/**
 * Lean of a vehicle body, for the drawing only: the angle it makes with the vertical over each of
 * its bogies, and what that moves when the vehicle is seen from above. Nothing here acts on the
 * train: it reads the cant of the track (`trackCantOn`) and the speed, as the physics does.
 *
 * Real angle and real height, never exaggerated: the roof of a 4.3 m body on 150 mm of cant moves
 * by some 0.4 m. Cant is a full-size matter (see `TrackProfile.rails`), so nothing leans on a
 * model railway scale.
 */

import type { Network, Point } from './types'
import type { PlacedVehicle } from './occupancy'
import type { TrackPosition } from './locomotive'
import { positionOnSegment, tangentOnSegment } from './locomotive'
import { contactSpacing, equilibriumCant } from './cant'
import { stockSpec } from './rollingStock'
import { trackCantOn, type TrackProfile } from './trackSpeed'

/** Lean of a body over one of its bogies */
export interface EndLean {
  /** Angle with the vertical, rad: positive towards `inside`, negative away from it */
  angle: number
  /** Unit vector (world) pointing to the inside of the curve; null on plain straight track */
  inside: Point | null
}

/** Lean of a vehicle: over its front bogie and over its rear one (they differ on a cant ramp) */
export interface VehicleLean {
  front: EndLean
  rear: EndLean
}

const UPRIGHT: EndLean = { angle: 0, inside: null }

/** A roof that moves by less than this (m) is not drawn apart from the footprint */
const LEAN_EPSILON = 1e-4

const asinClamped = (ratio: number): number => Math.asin(Math.max(-1, Math.min(1, ratio)))

/**
 * Angle (rad) of a body with the vertical, positive towards the inside of the curve: the angle of
 * the cant, less the roll of the body on its suspensions — `rollCoefficient` times the angle of
 * the cant deficiency (a negative deficiency, an excess of cant, rolls it further inwards).
 * At the equilibrium speed the deficiency is nil and the body stands square on the canted track.
 */
export function bodyLeanAngle(cant: number, deficiency: number, rollCoefficient: number, gauge?: number): number {
  const spacing = contactSpacing(gauge)
  return asinClamped(cant / spacing) - rollCoefficient * asinClamped(deficiency / spacing)
}

/** Lean over a bogie at `speed` km/h. Upright on plain straight track and off the real scale. */
export function leanAt(net: Network, profile: TrackProfile, pos: TrackPosition, speed: number, rollCoefficient: number): EndLean {
  if (profile.rails.size === 0) return UPRIGHT
  const place = trackCantOn(profile, pos.segId, pos.t)
  if (place.inside === 0) return UPRIGHT
  const tangent = tangentOnSegment(net, pos.segId, pos.t)
  if (!tangent) return UPRIGHT
  const equilibrium = Number.isFinite(place.radius) ? equilibriumCant(speed, place.radius, profile.line.gauge) : 0
  const angle = bodyLeanAngle(place.cant, equilibrium - place.cant, rollCoefficient, profile.line.gauge)
  return { angle, inside: { x: -tangent.y * place.inside, y: tangent.x * place.inside } }
}

/** Lean of a vehicle at `speed` km/h, null when it stands upright at both ends */
export function vehicleLean(net: Network, profile: TrackProfile, veh: PlacedVehicle, speed: number): VehicleLean | null {
  if (profile.rails.size === 0) return null
  const roll = stockSpec(veh).rollCoefficient
  const front = leanAt(net, profile, veh.front, speed, roll)
  const rear = leanAt(net, profile, veh.rear, speed, roll)
  return front.inside || rear.inside ? { front, rear } : null
}

/** Unit vector from the rear bogie of a vehicle to its front one, null when they stand on the same spot */
function vehicleAxis(net: Network, veh: PlacedVehicle): Point | null {
  const front = positionOnSegment(net, veh.front.segId, veh.front.t)
  const rear = positionOnSegment(net, veh.rear.segId, veh.rear.t)
  if (!front || !rear) return null
  const length = Math.hypot(front.x - rear.x, front.y - rear.y)
  return length > 0 ? { x: (front.x - rear.x) / length, y: (front.y - rear.y) / length } : null
}

/**
 * Side a derailed rake lies on — 1 to the left of its vehicles seen from rear to front, -1 to
 * their right — kept for as long as the derailment lasts: the rake slides on after it has left the
 * curve that threw it. Keyed by the record of the derailment, which lives until the train is put
 * back on the track.
 */
const tippedSides = new WeakMap<object, 1 | -1>()

/** Outside of the curve under the first bogie of the rake that stands in one, as a side of the rake */
function outsideOfRake(net: Network, profile: TrackProfile, vehicles: readonly PlacedVehicle[]): 1 | -1 | null {
  for (const veh of vehicles) {
    const axis = vehicleAxis(net, veh)
    if (!axis) continue
    for (const pos of [veh.front, veh.rear]) {
      const lean = leanAt(net, profile, pos, 0, 0)
      if (!lean.inside) continue
      // Left of the vehicle is (−axis.y, axis.x): the outside is the other side from `inside`
      const insideLeft = lean.inside.x * -axis.y + lean.inside.y * axis.x
      if (insideLeft !== 0) return insideLeft > 0 ? -1 : 1
    }
  }
  return null
}

/** A rake as the lean needs it (a `TrainSet` satisfies it) */
export interface LeaningRake {
  vehicles: readonly PlacedVehicle[]
  /** Speed, m/s */
  currentSpeed: number
  /** Record of the derailment of the rake, null when it is on the track */
  derailed?: object | null
}

/**
 * Lean of every vehicle of a rake (null for one that stands upright), or null when none leans.
 * A derailed rake lies on its side, tipped over to the outside of the curve it stood in when it was
 * first asked about (see `tippedSides`); one that derailed and was never seen in a curve is left
 * upright, as nothing tells which side it fell to.
 */
export function rakeLean(net: Network, profile: TrackProfile, rake: LeaningRake): (VehicleLean | null)[] | null {
  if (profile.rails.size === 0 || rake.vehicles.length === 0) return null
  if (rake.derailed) {
    let side = tippedSides.get(rake.derailed)
    if (side === undefined) {
      side = outsideOfRake(net, profile, rake.vehicles) ?? undefined
      if (side === undefined) return null
      tippedSides.set(rake.derailed, side)
    }
    const tipped = side
    return rake.vehicles.map((veh) => {
      const axis = vehicleAxis(net, veh)
      if (!axis) return null
      const end: EndLean = { angle: Math.PI / 2, inside: { x: -axis.y * tipped, y: axis.x * tipped } }
      return { front: end, rear: end }
    })
  }
  const speed = rake.currentSpeed * 3.6
  const leans = rake.vehicles.map((veh) => vehicleLean(net, profile, veh, speed))
  return leans.some((lean) => lean !== null) ? leans : null
}

/** How far (m, world vector) the roof of a body `height` m high stands from its footprint */
export function roofOffset(lean: EndLean, height: number): Point {
  if (!lean.inside) return { x: 0, y: 0 }
  const reach = height * Math.sin(lean.angle)
  return { x: lean.inside.x * reach, y: lean.inside.y * reach }
}

/** A leaning body seen from above */
export interface LeanedOutline {
  /** The roof: the footprint, point for point, moved by the lean (and narrowed by its cosine) */
  roof: Point[]
  /** The flank that shows on the side the body leans away from, from the sole bar up to the roof; empty when none shows */
  flank: Point[]
  /** Outline of everything drawn, roof and flank together, point for point as the footprint */
  envelope: Point[]
  /** True for a body lying on its side: `roof` is then its whole silhouette, seen flank up */
  lying: boolean
}

/** From this lean on (rad) a body is lying on its side */
const LYING_FROM = Math.PI / 2 - 1e-6

/**
 * A body lying on its side, seen from above: its silhouette kept point for point (the nose of a
 * power car included), as wide as the body is high, from the axis of the track out to the side it
 * fell to.
 */
function lyingOutline(polygon: readonly Point[], rear: Point, ux: number, uy: number, fallen: Point, height: number): LeanedOutline {
  const nx = -uy
  const ny = ux
  const laterals = polygon.map((p) => (p.x - rear.x) * nx + (p.y - rear.y) * ny)
  const halfWidth = Math.max(...laterals.map(Math.abs))
  // Side of the vehicle the body fell to: 1 = its left
  const side = fallen.x * nx + fallen.y * ny >= 0 ? 1 : -1
  const roof = polygon.map((p, i) => {
    // The side wall that was on the far side now lies on the track axis, the other one `height` out
    const out = halfWidth > 0 ? ((laterals[i] * side + halfWidth) / (2 * halfWidth)) * height : 0
    const shift = out * side - laterals[i]
    return { x: p.x + nx * shift, y: p.y + ny * shift }
  })
  return { roof, flank: [], envelope: roof, lying: true }
}

/**
 * What a leaning body shows from above, from its footprint on level track: `polygon`, around the
 * axis from the `rear` bogie to the `front` one. Each end takes its own lean and the body twists
 * evenly in between. Null when the roof stays over the footprint.
 */
export function leanedOutline(polygon: readonly Point[], rear: Point, front: Point, lean: VehicleLean, height: number): LeanedOutline | null {
  const dx = front.x - rear.x
  const dy = front.y - rear.y
  const length = Math.hypot(dx, dy)
  if (!(length > 0) || polygon.length === 0) return null
  const ux = dx / length
  const uy = dy / length
  const nx = -uy
  const ny = ux
  const offRear = roofOffset(lean.rear, height)
  const offFront = roofOffset(lean.front, height)
  if (Math.hypot(offRear.x, offRear.y) < LEAN_EPSILON && Math.hypot(offFront.x, offFront.y) < LEAN_EPSILON) return null
  if (Math.abs(lean.front.angle) >= LYING_FROM && Math.abs(lean.rear.angle) >= LYING_FROM) {
    return lyingOutline(polygon, rear, ux, uy, offFront, height)
  }
  const cosRear = Math.cos(lean.rear.angle)
  const cosFront = Math.cos(lean.front.angle)

  const roof: Point[] = []
  const sole: Point[] = []
  const lateral: number[] = []
  for (const p of polygon) {
    const along = Math.max(0, Math.min(1, ((p.x - rear.x) * ux + (p.y - rear.y) * uy) / length))
    const side = (p.x - rear.x) * nx + (p.y - rear.y) * ny
    // Seen from above a leaning body is narrower by the cosine of its lean
    const narrowing = side * (cosRear + (cosFront - cosRear) * along - 1)
    const base = { x: p.x + nx * narrowing, y: p.y + ny * narrowing }
    sole.push(base)
    roof.push({
      x: base.x + offRear.x + (offFront.x - offRear.x) * along,
      y: base.y + offRear.y + (offFront.y - offRear.y) * along,
    })
    lateral.push(side)
  }

  // The flank shows on the side the roof moves away from: the points of the outline on that side
  const shift = (offRear.x + offFront.x) * nx + (offRear.y + offFront.y) * ny
  const far = lateral.map((side) => side * shift < 0)
  const count = polygon.length
  const start = far.findIndex((isFar, i) => isFar && !far[(i + count - 1) % count])
  const flank: Point[] = []
  if (start >= 0) {
    const run: number[] = []
    for (let k = 0; k < count && far[(start + k) % count]; k++) run.push((start + k) % count)
    for (const i of run) flank.push(sole[i])
    for (let k = run.length - 1; k >= 0; k--) flank.push(roof[run[k]])
  }
  // What is drawn in all: the sole bar on the side of the flank, the roof on the other
  const envelope = start >= 0 ? polygon.map((_, i) => (far[i] ? sole[i] : roof[i])) : roof
  return { roof, flank, envelope, lying: false }
}
