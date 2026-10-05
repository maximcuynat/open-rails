/**
 * Speed limits along the track: the line speed of the project, the speed zones laid on the track
 * and the speed each curve allows for its cant.
 *
 * Shared contract of the speed zones plan (see `tasks/todo.md`): the domain side fills these in,
 * the editor, the panels and the driving console only read them.
 * Figures and formulas come from `tasks/recherche-devers.md` and `tasks/recherche-limites-vitesse.md`.
 */

import type { Network, Segment, SpeedZone, TrackSpan } from './types'
import type { TrainSet } from './train'
import { speedZonesOnRail, speedZonesRevision, tidyTrackSpans } from './speedZones'
import { TRACK_T_EPSILON } from './trackObjects'
import { trackProfile } from './trackSpeed'
import { applyParkedBrake } from './trainDynamics'
import { trackSpansLength } from '../services/trackPath'

/** Rules a line follows for cant: a conventional line or a high-speed line (LGV) */
export type LineType = 'classic' | 'highSpeed'

/** Line settings of the project: every rail without a speed zone runs at the line speed */
export interface LineSettings {
  /** Ceiling speed of the line, km/h */
  lineSpeed: number
  lineType: LineType
  /** Rail gauge in metres, for the cant formulas; standard gauge when absent */
  gauge?: number
  /**
   * False on a model railway scale: cant, curve speeds and derailment are a full-size matter and
   * are left out (the line speed and the zones still apply). Absent = full size.
   */
  realScale?: boolean
}

export const DEFAULT_LINE_SETTINGS: LineSettings = { lineSpeed: 160, lineType: 'classic' }

export const LINE_SPEED_RANGE = { min: 10, max: 360 }

/** Real line types offered as presets in the settings */
export const LINE_PRESETS: readonly (LineSettings & { id: string; label: string })[] = [
  { id: 'lgv320', label: 'LGV 320', lineSpeed: 320, lineType: 'highSpeed' },
  { id: 'lgv300', label: 'LGV 300', lineSpeed: 300, lineType: 'highSpeed' },
  { id: 'classic220', label: 'Ligne classique 220', lineSpeed: 220, lineType: 'classic' },
  { id: 'classic160', label: 'Ligne classique 160', lineSpeed: 160, lineType: 'classic' },
  { id: 'secondary100', label: 'Ligne secondaire 100', lineSpeed: 100, lineType: 'classic' },
  { id: 'service30', label: 'Voie de service 30', lineSpeed: 30, lineType: 'classic' },
]

/** What a curved rail carries and allows */
export interface CurveCant {
  /** Radius of the rail, m */
  radius: number
  /** Cant applied, mm: the one set by hand on the rail, else the automatic one */
  cant: number
  /** False when the cant was set by hand (`Segment.cant`) */
  automatic: boolean
  /** Speed the curve allows with this cant and the cant deficiency the rolling stock admits, km/h */
  maxSpeed: number
  /** Speed limit that applies on the rail apart from its own curve (zone or line speed), km/h */
  appliedSpeed: number
}

/**
 * Cant and speed of a curved rail, null for a straight one and off the real scale. Read from the
 * kept `trackProfile`: asking for every rail of the network at each frame costs one lookup each.
 */
export function curveCant(net: Network, seg: Segment, line: LineSettings = DEFAULT_LINE_SETTINGS): CurveCant | null {
  const rail = trackProfile(net, line).rails.get(seg.id)
  if (!rail) return null
  return {
    radius: rail.radius,
    cant: rail.cant,
    automatic: rail.automatic,
    maxSpeed: rail.maxSpeed,
    appliedSpeed: rail.appliedSpeed,
  }
}

/** Stretch of track two speed zones share: the lower of the two speeds applies there */
export interface SpeedZoneOverlap {
  a: SpeedZone
  b: SpeedZone
  spans: TrackSpan[]
  /** Length of the shared stretch, m */
  length: number
}

const sharedCache = new WeakMap<Network, { zones: number; shared: Omit<SpeedZoneOverlap, 'length'>[] }>()

/** The stretches each pair of zones shares; only depends on the zones, so kept until one changes */
function sharedStretches(net: Network): Omit<SpeedZoneOverlap, 'length'>[] {
  const zones = speedZonesRevision(net)
  const kept = sharedCache.get(net)
  if (kept && kept.zones === zones) return kept.shared

  const order = new Map<SpeedZone, number>()
  for (const zone of net.speedZones.values()) order.set(zone, order.size)
  const pairs = new Map<SpeedZone, Map<SpeedZone, TrackSpan[]>>()
  for (const a of net.speedZones.values()) {
    for (const span of a.spans) {
      const lo = Math.min(span.t0, span.t1)
      const hi = Math.max(span.t0, span.t1)
      for (const stretch of speedZonesOnRail(net, span.segId)) {
        const b = stretch.zone
        if (order.get(b)! <= order.get(a)!) continue
        const from = Math.max(lo, stretch.lo)
        const to = Math.min(hi, stretch.hi)
        if (to - from < TRACK_T_EPSILON) continue
        let withA = pairs.get(a)
        if (!withA) pairs.set(a, (withA = new Map()))
        let spans = withA.get(b)
        if (!spans) withA.set(b, (spans = []))
        // In the direction zone `a` runs on this rail
        spans.push(span.t0 <= span.t1 ? { segId: span.segId, t0: from, t1: to } : { segId: span.segId, t0: to, t1: from })
      }
    }
  }
  const shared: Omit<SpeedZoneOverlap, 'length'>[] = []
  for (const [a, withA] of pairs) {
    for (const [b, parts] of withA) shared.push({ a, b, spans: tidyTrackSpans(parts) })
  }
  sharedCache.set(net, { zones, shared })
  return shared
}

/**
 * Every pair of speed zones that share a stretch of track, each pair once (`a` laid before `b`),
 * with the shared stretches in the order zone `a` runs and their length as the track is now.
 */
export function speedZoneOverlaps(net: Network): SpeedZoneOverlap[] {
  if (net.speedZones.size < 2) return []
  const overlaps: SpeedZoneOverlap[] = []
  for (const shared of sharedStretches(net)) {
    const length = trackSpansLength(net, shared.spans)
    if (length > 0) overlaps.push({ ...shared, length })
  }
  return overlaps
}

/** Overlaps of one zone with the others (for its panel and the warning when it is laid) */
export function overlapsOfZone(net: Network, zoneId: string): SpeedZoneOverlap[] {
  return speedZoneOverlaps(net).filter((o) => o.a.id === zoneId || o.b.id === zoneId)
}

/** How a train takes the curve it is in, from the cant deficiency under its vehicles */
export type CurveState = 'ok' | 'discomfort' | 'danger'

/** A speed limit ahead of the train, lower than the one it runs under */
export interface UpcomingSpeedLimit {
  /** km/h */
  speed: number
  /** Distance from the head of the train to where the limit starts, m */
  distance: number
}

/** A train that left the rails in a curve: it stays where it stopped until it is put back */
export interface Derailment {
  /** Speed of the train when it overturned, km/h */
  speed: number
  /** Speed limit that applied there, km/h */
  limit: number
}

/**
 * Put a derailed train back on the track where it stands: stopped, brakes applied, handle on N,
 * reverser in neutral, drivable again. Returns false when the train is not derailed.
 */
export function rerailTrain(train: TrainSet): boolean {
  if (!train.derailed) return false
  train.derailed = null
  train.currentSpeed = 0
  train.notch = 0
  train.reverser = 'neutral'
  train.tractionEffort = 0
  train.electricBrakeEffort = 0
  train.impactSpeed = 0
  applyParkedBrake(train)
  return true
}
