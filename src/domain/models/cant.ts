/**
 * Cant of a curve and the speed it allows: the formulas and the rules, without any track.
 *
 * Units, as the railway writes them: speeds in km/h, radii in m, cant and cant deficiency in mm
 * measured across the contact points of the two wheels (gauge + 65 mm, 1 500 mm on standard gauge).
 * Figures and formulas come from `tasks/recherche-devers.md` (§1 to §6).
 *
 * This module only imports types and plain data: `trackSpeed.ts` puts it on the track.
 */

import type { CurveState, LineType } from './speedLimits'
import { DEFAULT_ROLLING_STOCK, ROLLING_STOCK, stockSpec, type RollingStockModel, type StockVehicle } from './rollingStock'

/** Standard gauge, m */
export const STANDARD_GAUGE = 1.435
/** Added to the gauge to get the distance between the contact points of the two wheels, m */
const CONTACT_POINT_OFFSET = 0.065
const GRAVITY = 9.81

/** Distance between the contact points of the two wheels, mm: what cant is measured across */
export function contactSpacing(gauge: number = STANDARD_GAUGE): number {
  return (gauge + CONTACT_POINT_OFFSET) * 1000
}

/** Cant (mm) at which a train at `speed` km/h feels no lateral force in a curve of `radius` m: e·v²/(g·R), 11.8·V²/R */
export function equilibriumCant(speed: number, radius: number, gauge: number = STANDARD_GAUGE): number {
  if (!(radius > 0) || !Number.isFinite(radius)) return 0
  const v = speed / 3.6
  return (contactSpacing(gauge) * v * v) / (GRAVITY * radius)
}

/** Cant deficiency (mm) at `speed` km/h in a curve of `radius` m laid with `cant` mm; negative = excess of cant */
export function cantDeficiency(speed: number, radius: number, cant: number, gauge: number = STANDARD_GAUGE): number {
  return equilibriumCant(speed, radius, gauge) - cant
}

/** Lateral acceleration (m/s²) left uncompensated in the plane of the track by a cant deficiency: about I / 153 */
export function uncompensatedAcceleration(deficiency: number, gauge: number = STANDARD_GAUGE): number {
  return (deficiency * GRAVITY) / contactSpacing(gauge)
}

/** Speed (km/h) at which the deficiency reaches `deficiency` mm in a curve of `radius` m laid with `cant` mm */
export function curveMaxSpeed(radius: number, cant: number, deficiency: number, gauge: number = STANDARD_GAUGE): number {
  if (!Number.isFinite(radius)) return Infinity
  if (!(radius > 0)) return 0
  return Math.sqrt((Math.max(0, cant + deficiency) * GRAVITY * radius) / contactSpacing(gauge)) * 3.6
}

/** Smallest radius (m) a curve laid with `cant` mm can have for `speed` km/h and `deficiency` mm */
export function curveMinRadius(speed: number, cant: number, deficiency: number, gauge: number = STANDARD_GAUGE): number {
  const sum = cant + deficiency
  return sum > 0 ? equilibriumCant(speed, 1, gauge) / sum : Infinity
}

/** Rules a line type follows when its curves are given their cant */
export interface LineCantRules {
  /** Largest cant laid, mm */
  maxCant: number
  /** Share of the equilibrium cant at the speed of the line that is laid */
  equilibriumShare: number
}

export const LINE_CANT_RULES: Record<LineType, LineCantRules> = {
  // SNCF rule for conventional lines (IN 0272): d = 6·V²/R, 51 % of the 11.8·V²/R of equilibrium
  classic: { maxCant: 160, equilibriumShare: 6 / 11.8 },
  // "7/10" rule: no primary source, one measured curve of the LGV Sud-Est makes it plausible
  highSpeed: { maxCant: 180, equilibriumShare: 0.7 },
}

/** Hand-set cant is kept within these (mm): none, to the largest cant ever laid on the network */
export const CANT_RANGE = { min: 0, max: 180 }
/** Cant is laid in steps of this (mm)… */
export const CANT_STEP = 5
/** …and not at all below this (mm) */
export const MIN_CANT = 20
/** Cant is not laid on a radius under this (m), and limited to (R − 100) / 2 above it */
const SMALL_RADIUS_BASE = 100

/**
 * Above this deficiency (mm) the curve is taken beyond anything a train does in service (tilting
 * trains run at 260 to 300 mm): danger. Up to it, past what the stock is admitted, the ride is
 * uncomfortable — which is also what entering a curve at its speed limit gives for a moment, the
 * cant being only half run in at the tangent point.
 */
export const DANGER_DEFICIENCY = 300

/** How a curve is taken with `deficiency` mm when the stock is admitted `admitted` mm */
export function curveStateFor(deficiency: number, admitted: number): CurveState {
  if (deficiency <= admitted + 0.5) return 'ok'
  return deficiency <= DANGER_DEFICIENCY ? 'discomfort' : 'danger'
}

/**
 * Cant deficiency (mm) a rolling stock is allowed on a line type at `speed` km/h (TGV: 160 mm up to
 * 200 km/h and 150 mm beyond on a conventional line, 130 mm up to 300 km/h and 80 mm beyond on a
 * high-speed line).
 */
export function admittedDeficiency(
  lineType: LineType,
  speed: number,
  model: RollingStockModel = DEFAULT_ROLLING_STOCK,
): number {
  const steps = ROLLING_STOCK[model].cantDeficiency[lineType]
  for (const step of steps) {
    if (speed <= step.upTo + 1e-9) return step.deficiency
  }
  return steps[steps.length - 1].deficiency
}

/** Deficiency admitted for a rake: the lowest among its vehicles */
export function consistAdmittedDeficiency(vehicles: readonly StockVehicle[], lineType: LineType, speed: number): number {
  if (vehicles.length === 0) return admittedDeficiency(lineType, speed)
  return Math.min(...vehicles.map((veh) => admittedDeficiency(lineType, speed, veh.model)))
}

/** Deficiency (mm) at which a rake overturns: that of its least stable vehicle */
export function consistOverturningDeficiency(vehicles: readonly StockVehicle[]): number {
  if (vehicles.length === 0) return ROLLING_STOCK[DEFAULT_ROLLING_STOCK].overturningDeficiency
  return Math.min(...vehicles.map((veh) => stockSpec(veh).overturningDeficiency))
}

/** Round a cant down to what is laid: steps of 5 mm, nothing under 20 mm */
export function layableCant(cant: number): number {
  const stepped = Math.floor(cant / CANT_STEP + 1e-9) * CANT_STEP
  return stepped < MIN_CANT ? 0 : stepped
}

/**
 * Cant (mm) a curve of `radius` m is given on a line run at `speed` km/h: a share of the
 * equilibrium cant, raised as far as needed for the line speed to stay within the admitted
 * deficiency, capped by the largest cant of the line type and by (R − 100) / 2 on small radii,
 * rounded to 5 mm; nothing under 20 mm.
 */
export function automaticCant(radius: number, speed: number, lineType: LineType, gauge: number = STANDARD_GAUGE): number {
  if (!(radius > 0) || !Number.isFinite(radius)) return 0
  const rules = LINE_CANT_RULES[lineType]
  const equilibrium = equilibriumCant(speed, radius, gauge)
  // Least cant with which the line speed stays within the admitted deficiency
  const needed = equilibrium - admittedDeficiency(lineType, speed)
  const cap = Math.min(rules.maxCant, Math.max(0, (radius - SMALL_RADIUS_BASE) / 2))
  const cant = Math.min(Math.max(rules.equilibriumShare * equilibrium, needed), cap)
  let rounded = Math.round(cant / CANT_STEP) * CANT_STEP
  // Rounding must neither lose the line speed nor pass a cap
  if (rounded < needed - 1e-9) rounded += CANT_STEP
  if (rounded > cap + 1e-9) rounded = Math.floor(cap / CANT_STEP + 1e-9) * CANT_STEP
  return rounded < MIN_CANT ? 0 : rounded
}

/** Length (m) over which `cant` mm is run in or out on a line run at `speed` km/h: 180 / V mm per metre */
export function cantRampLength(cant: number, speed: number): number {
  return (Math.max(0, cant) * speed) / 180
}

/** Largest cant (mm) whose ramp fits in `length` m at `speed` km/h */
export function cantForRampLength(length: number, speed: number): number {
  return speed > 0 ? (180 * Math.max(0, length)) / speed : Infinity
}
