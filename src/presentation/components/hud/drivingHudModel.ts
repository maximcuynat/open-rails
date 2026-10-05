import type { TrainSet } from '@domain/models/train'
import {
  BRAKE_CYLINDER_MAX_BAR,
  BRAKE_PIPE_FIRST_REDUCTION,
  BRAKE_PIPE_FULL_SERVICE,
  BRAKE_PIPE_RELEASED,
  type TrainDynamics,
} from '@domain/models/trainDynamics'

/**
 * What the driving console shows, worked out from the train and its dynamics.
 * Pure description: the React component only renders it, the tests read it directly.
 */

/** Pressure difference (bar) under which a gauge is read as being on its mark */
const PRESSURE_TOLERANCE = 0.05

export type BrakeTone = 'released' | 'releasing' | 'applying' | 'applied' | 'emergency'

export interface BrakeStatus {
  label: string
  tone: BrakeTone
}

/** State of the air brake in one word, from the pressures rather than from the handle */
export function brakeStatus(
  train: Pick<TrainSet, 'emergencyBrake' | 'brakeCommand'>,
  dynamics: Pick<TrainDynamics, 'brakePipeBar' | 'brakeCylinderBar'>,
): BrakeStatus {
  if (train.emergencyBrake) return { label: 'Urgence', tone: 'emergency' }
  const pipeFull = dynamics.brakePipeBar >= BRAKE_PIPE_RELEASED - PRESSURE_TOLERANCE
  const cylindersEmpty = dynamics.brakeCylinderBar <= PRESSURE_TOLERANCE
  if (pipeFull && cylindersEmpty) return { label: 'Frein desserré', tone: 'released' }
  // The cylinders empty some seconds after the brake pipe is back to its pressure
  if (pipeFull || train.brakeCommand === 'release') return { label: 'Desserrage…', tone: 'releasing' }
  if (train.brakeCommand === 'apply' && dynamics.brakePipeBar > BRAKE_PIPE_FULL_SERVICE + PRESSURE_TOLERANCE) {
    return { label: 'Serrage…', tone: 'applying' }
  }
  return { label: 'Frein serré', tone: 'applied' }
}

/** Whether the brake holds the train: what the driver has to undo before leaving */
export function isBrakeHolding(status: BrakeStatus): boolean {
  return status.tone === 'applied' || status.tone === 'applying'
}

/** Traction handle position: N, P1 … P5 */
export function notchLabel(notch: number): string {
  return notch > 0 ? `P${notch}` : 'N'
}

/** A number with a French decimal comma */
export function decimal(value: number, digits: number): string {
  const rounded = Number(value.toFixed(digits))
  // No "-0,0"
  return (rounded === 0 ? 0 : rounded).toFixed(digits).replace('.', ',')
}

/** Share of the tractive effort applied, as a whole percentage */
export function effortPercent(tractionEffort: number): number {
  return Math.round(Math.max(0, Math.min(1, tractionEffort)) * 100)
}

/** Signed acceleration: "+0,32 m/s²", "−1,10 m/s²", "0,00 m/s²" */
export function accelerationLabel(acceleration: number): string {
  const text = decimal(Math.abs(acceleration), 2)
  const sign = text === '0,00' ? '' : acceleration > 0 ? '+' : '−'
  return `${sign}${text} m/s²`
}

/** Slope (‰) under which the track is called level */
const LEVEL_GRADIENT = 0.5

/** Slope under the train with its sense: positive ‰ is uphill in the direction of motion */
export function gradientLabel(gradientPermille: number): string {
  const size = Math.abs(gradientPermille)
  if (!(size >= LEVEL_GRADIENT)) return 'palier'
  const text = `${decimal(size, size < 10 ? 1 : 0)} ‰`
  return gradientPermille > 0 ? `↗ montée ${text}` : `↘ descente ${text}`
}

const DIAL_STEPS = [5, 10, 20, 25, 40, 50, 80, 100, 200, 250, 500]
const DIAL_MAX_INTERVALS = 5

/** Graduations (km/h) of the speed dial: round values from 0 up to the top speed, which is always marked */
export function speedDialTicks(maxKmh: number): number[] {
  if (!(maxKmh > 0)) return [0]
  const step = DIAL_STEPS.find((s) => maxKmh / s <= DIAL_MAX_INTERVALS) ?? maxKmh
  const ticks: number[] = []
  for (let v = 0; v < maxKmh - step / 2; v += step) ticks.push(v)
  ticks.push(maxKmh)
  return ticks
}

export interface GaugeSpec {
  /** Full scale, bar */
  max: number
  /** Pressures marked on the dial, bar */
  marks: number[]
}

/** Brake pipe: released at 5 bar, first reduction at 4.5, full service at 3.5 */
export const BRAKE_PIPE_GAUGE: GaugeSpec = {
  max: BRAKE_PIPE_RELEASED,
  marks: [BRAKE_PIPE_FULL_SERVICE, BRAKE_PIPE_FIRST_REDUCTION, BRAKE_PIPE_RELEASED],
}

/** Brake cylinders: empty when released, 3.8 bar when full */
export const BRAKE_CYLINDER_GAUGE: GaugeSpec = {
  max: BRAKE_CYLINDER_MAX_BAR,
  marks: [0, BRAKE_CYLINDER_MAX_BAR],
}

/** Position of a pressure on its gauge, 0 … 1 */
export function gaugeRatio(value: number, spec: GaugeSpec): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value / spec.max))
}

/**
 * Stopping distance as shown in the HUD. Always in metres or kilometres, whatever the display unit
 * of the project: trains keep their real dimensions at every scale, and « 3300000 mm » says nothing.
 */
export function stoppingDistanceLabel(metres: number): string {
  if (!Number.isFinite(metres)) return '∞'
  if (metres >= 1000) return `${(metres / 1000).toFixed(1).replace('.', ',')} km`
  return `${Math.round(metres)} m`
}
