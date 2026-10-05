/**
 * Cab signalling of a high-speed line (pro signalling level): the target speed shown in the cab
 * instead of lineside lights, after the French TVM 300, simplified.
 *
 * Nothing new is stored. The marker boards are the signals of the network (one flagged `cabMarker`
 * has no lamp) and a block is the track between two of them. What the cab shows is read from what
 * the signalling engine counts for each train (`TrainSignalling.clearance`, see `TrackClearance`):
 * the blocks free ahead of it as far as the obstacle, the block the train is in being the first,
 * and what that obstacle is. Nothing is walked here: reading the cab costs a few comparisons.
 *
 * Behind an occupied block (a closed marker with plate F) one block is kept free, the buffer block:
 * the stop is asked for one block before it. Behind a closed path signal (plate Nf), the end of the
 * track or a one-way signal met from behind there is no buffer block — the protected point is right
 * beyond — and the sequence has one more step, 80 (`tasks/recherche-signalisation.md` §6, « tampon
 * réduit », and `tasks/recherche-limites-vitesse.md` §6).
 *
 * | free blocks | behind an occupied block            | before a closed path signal or an end of track |
 * |-------------|-------------------------------------|------------------------------------------------|
 * | 0           | red: on sight, 30 km/h (the block of the train itself is not free)                   |
 * | 1           | red: on sight, 30 km/h (buffer)     | 000: stop before the next marker               |
 * | 2           | 000: stop before the next marker    | 80 announced                                   |
 * | 3           | 160 announced                       | 160 announced                                  |
 * | 4           | 220 announced                       | 220 announced                                  |
 * | 5           | 270 announced                       | 270 announced                                  |
 * | 6           | line speed, flashing: an announcement comes next                                     |
 * | 7 and more  | line speed                                                                           |
 *
 * The speed limit in force (line speed, zones, curves, points) is a ceiling: an announcement that
 * is not under it is not shown, the limit is, as an execution when it is lower than the line speed.
 * A more restrictive count only shows when the train passes a marker; a less restrictive one shows
 * at once, and so does the red of a block that stops being free under the train (`latchCabClearance`).
 *
 * Overspeed (the COVIT of the TVM): the emergency brake comes on when the train runs faster than
 * the speed checked (`cabControlSpeed`) by more than 15 km/h from 200 km/h up, 10 km/h under it, and
 * above 35 km/h on sight (`cabOverspeedThreshold`); `tickSignalling` applies it.
 *
 * Left out: announce-then-execute for diverging routes (the limit of the points shows as an
 * execution once the train is on them), the 65 km/h spot check of the shortest buffers.
 *
 * This module only imports types from `train.ts`.
 */

import type { SignalId } from './types'
import type { TrainSetId } from './train'
import type { LineSettings } from './speedLimits'
import type { SignallingLevel } from './signals'
import { ON_SIGHT_SPEED, isSightClearance, type SignallingState, type TrackClearance, type TrainSignalView } from './signalling'

/** Speeds (km/h) announced ahead of the stop, from the nearest block to the farthest */
export const CAB_ANNOUNCED_SPEEDS = [160, 220, 270] as const
/** Speed (km/h) announced in the last block before the stop when there is no buffer block */
export const CAB_REDUCED_SPEED = 80
/** With more free blocks than this ahead, nothing restricts the train */
export const CAB_SEQUENCE_BLOCKS = 6
/** Free blocks counted when nothing is in the way */
export const CAB_CLEAR = Infinity
/** What `announcedSpeed` returns for the red of a block that is not free, or of the buffer block */
export const CAB_RED = -1
/** Overspeed margins (km/h): from `CAB_HIGH_SPEED` up, under it, and on sight */
export const CAB_OVERSPEED_MARGIN = { high: 15, low: 10, sight: 5 } as const
export const CAB_HIGH_SPEED = 200

/** What ends the free blocks ahead (see `TrackClearance.obstacle`) */
export type CabObstacle = TrackClearance['obstacle']

/** True where the cab display stands for the lineside signals: pro level on a high-speed line */
export function isCabSignalled(level: SignallingLevel, line: Pick<LineSettings, 'lineType'>): boolean {
  return level === 'pro' && line.lineType === 'highSpeed'
}

/**
 * The line speed a cab shows (km/h): that of the line, or the top speed of the train (m/s) when it
 * is lower — a train slower than the line runs at its own top speed without being told to.
 */
export function cabLineSpeed(line: Pick<LineSettings, 'lineSpeed'>, maxSpeed: number): number {
  return Math.round(Math.min(line.lineSpeed, maxSpeed * 3.6))
}

/**
 * What the cab shows.
 * - `line`: the line speed, nothing restricts the train;
 * - `execute`: a lower limit in force (speed zone, curve, points), to be kept;
 * - `announce`: a speed not to exceed at the next marker;
 * - `stop`: 000, stop before the next marker;
 * - `sight`: red — running on sight, in a block that is not free or in the buffer block behind it,
 *   or after passing a closed marker.
 */
export type CabIndicationKind = 'line' | 'execute' | 'announce' | 'stop' | 'sight'

export interface CabIndication {
  kind: CabIndicationKind
  /** km/h; 0 for `stop` */
  speed: number
  /** `line` and `execute` only: the next block will show something more restrictive */
  flashing: boolean
}

const SEQUENCES: Record<'occupied' | 'absolute', readonly number[]> = {
  occupied: [CAB_RED, 0, ...CAB_ANNOUNCED_SPEEDS],
  absolute: [0, CAB_REDUCED_SPEED, ...CAB_ANNOUNCED_SPEEDS],
}

/**
 * Speed (km/h) announced with this many free blocks ahead of that obstacle (see the table at the
 * top of the file): 0 for a stop, `CAB_RED` for the red, `Infinity` when nothing is announced.
 */
export function announcedSpeed(blocks: number, obstacle: CabObstacle): number {
  if (!(blocks >= 1)) return CAB_RED
  if (obstacle === null) return Infinity
  const sequence = SEQUENCES[obstacle]
  return blocks - 1 < sequence.length ? sequence[blocks - 1] : Infinity
}

/**
 * The indication for a count of free blocks under the speed limit in force (km/h) on a line of
 * `lineSpeed` km/h. See the table at the top of the file.
 */
export function cabIndication(clearance: Pick<TrackClearance, 'blocks' | 'obstacle'>, speedLimit: number, lineSpeed: number): CabIndication {
  const target = announcedSpeed(clearance.blocks, clearance.obstacle)
  if (target === CAB_RED) return { kind: 'sight', speed: ON_SIGHT_SPEED, flashing: false }
  if (target === 0) return { kind: 'stop', speed: 0, flashing: false }
  if (target < speedLimit) return { kind: 'announce', speed: target, flashing: false }
  return {
    kind: speedLimit >= lineSpeed ? 'line' : 'execute',
    speed: speedLimit,
    flashing: announcedSpeed(clearance.blocks - 1, clearance.obstacle) < speedLimit,
  }
}

/**
 * The speed (km/h) the cab checks the train against for a count of free blocks, under the speed
 * limit in force: the limit itself while nothing lower is announced; in a block that announces a
 * speed or a stop, what the block before announced — the train came in at that speed and has the
 * whole block to come down; 30 km/h under a red. ESTIMATED: the sources give the trigger speed of
 * each step (`tasks/recherche-signalisation.md` §10 d), not the block it is checked in.
 */
export function cabControlSpeed(clearance: Pick<TrackClearance, 'blocks' | 'obstacle'>, speedLimit: number): number {
  const target = announcedSpeed(clearance.blocks, clearance.obstacle)
  if (target === CAB_RED) return ON_SIGHT_SPEED
  if (target >= speedLimit) return speedLimit
  return Math.min(speedLimit, announcedSpeed(clearance.blocks + 1, clearance.obstacle))
}

/**
 * Speed (km/h) above which the emergency brake comes on for a speed checked: 15 km/h over it from
 * 200 km/h up, 10 km/h under that, 35 km/h on sight.
 */
export function cabOverspeedThreshold(controlSpeed: number, onSight: boolean = false): number {
  if (onSight) return ON_SIGHT_SPEED + CAB_OVERSPEED_MARGIN.sight
  return controlSpeed + (controlSpeed >= CAB_HIGH_SPEED ? CAB_OVERSPEED_MARGIN.high : CAB_OVERSPEED_MARGIN.low)
}

/**
 * The count the cab shows, from the one it showed and the one counted now: a more restrictive one
 * waits for the train to pass a marker — the marker ahead is then another one — while a less
 * restrictive one is taken at once. With no marker ahead there is nothing to wait for, and a block
 * that is no longer free under the train (`blocks` 0) shows at once. Pure: returns `shown` itself
 * when it stands.
 */
export function latchCabClearance(shown: TrackClearance | null, counted: TrackClearance): TrackClearance {
  if (!shown || counted.markerId === null || shown.markerId !== counted.markerId || counted.blocks <= 0) return counted
  const before = announcedSpeed(shown.blocks, shown.obstacle)
  const now = announcedSpeed(counted.blocks, counted.obstacle)
  return now > before ? counted : shown
}

/** A marker ahead of a train */
export interface MarkerAhead {
  id: SignalId
  /** Distance from the leading end of the train, m */
  distance: number
}

/** The cab signalling of a train at one moment */
export interface CabSignal {
  indication: CabIndication
  /** Free blocks ahead the indication is shown for (latched, see `latchCabClearance`) */
  blocks: number
  obstacle: CabObstacle
  /** The next marker, null when there is none ahead */
  marker: MarkerAhead | null
  /** The speed the train is checked against, km/h (`cabControlSpeed`) */
  controlSpeed: number
}

/**
 * What the cab of a train shows, as of the last signalling update: read from the count the engine
 * keeps for it (`TrainSignalling.cab`, else the raw `clearance` outside the simulation), with no
 * walk over the network. `view` is what the signals say to its driver (`trainSignalView`),
 * `speedLimit` the limit in force over the train in km/h and `lineSpeed` the line speed its cab
 * shows (`cabLineSpeed`). Null when the engine counted nothing for this train (the update was not
 * asked for the clearance, or the train is unknown to it).
 */
export function cabSignal(
  state: SignallingState,
  trainId: TrainSetId,
  view: Pick<TrainSignalView, 'nextSignal' | 'onSight'>,
  speedLimit: number,
  lineSpeed: number,
): CabSignal | null {
  const record = state.trains.get(trainId)
  const clearance = record ? record.cab ?? record.clearance : null
  if (!clearance) return null
  const sight = view.onSight || isSightClearance(clearance)
  const indication: CabIndication = sight
    ? { kind: 'sight', speed: ON_SIGHT_SPEED, flashing: false }
    : cabIndication(clearance, speedLimit, lineSpeed)
  return {
    indication,
    blocks: clearance.blocks,
    obstacle: clearance.obstacle,
    marker: view.nextSignal ? { id: view.nextSignal.id, distance: view.nextSignal.distance } : null,
    controlSpeed: sight ? ON_SIGHT_SPEED : cabControlSpeed(clearance, speedLimit),
  }
}
