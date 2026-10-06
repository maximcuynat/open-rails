/**
 * Speed signs standing along the track, placed automatically from the speed zones (pro signalling
 * level): the distant sign that announces a lower limit ahead of where it starts.
 *
 * Shared contract of the signalling plan (see `tasks/todo.md`): the driving side computes where the
 * signs stand, the canvas only draws them. French rules and shapes: `tasks/recherche-limites-vitesse.md`
 * (§4 for the signs, §10 for the announcement distance).
 *
 * Only the drops a zone brings are announced: a curve that lowers the limit by itself gets no sign.
 */

import { segmentEnds, shapeParamAtDistance } from '../geometry/segmentGeometry'
import type { Network, NodeId, Segment, SegmentId, SpeedZone, SpeedZoneId } from './types'
import type { LineSettings } from './speedLimits'
import { DEFAULT_LINE_SETTINGS } from './speedLimits'
import { segmentPartialLength } from './locomotive'
import { exitsOf } from './routing'
import { speedZonesRevision } from './speedZones'
import { speedLimitAt, trackGeometryRevision } from './trackSpeed'

/** A distant speed sign (« TIV à distance »): black figures on white, read by trains running one way */
export interface SpeedSign {
  /** Zone whose limit the sign announces */
  zoneId: SpeedZoneId
  /** Where the sign stands on the track */
  segId: SegmentId
  t: number
  /** Direction of travel the sign addresses: true for trains running the rail from `from` to `to` */
  forward: boolean
  /** Limit announced, km/h */
  speed: number
  /** Limit the train runs under where the sign stands, km/h */
  fromSpeed: number
  /** Distance from the sign to the start of the zone, m */
  distance: number
  /** True when the drop is 40 km/h or more: the real sign is then a diamond instead of a square */
  diamond: boolean
}

/** Deceleration (m/s²) the announcement distance is worked out for */
export const SPEED_SIGN_DECELERATION = 0.7
/** A sign never stands nearer than this (m) to the zone it announces, track permitting */
export const MIN_SPEED_SIGN_DISTANCE = 300
/** From this drop (km/h) the sign is a diamond */
export const DIAMOND_SIGN_DROP = 40

/** The limit just before a zone is read this far (m) up the track from its end */
const BEFORE_ZONE_DISTANCE = 0.01
/** A sign is not looked for over more rails than this */
const MAX_SIGN_RAILS = 20_000

/** Counter for the tests that check what is kept */
export const speedSignStats = { builds: 0 }

/**
 * Distance (m) ahead of a drop from `fromSpeed` to `toSpeed` (km/h) at which it is announced:
 * `(v₁² − v₂²) / (2 × 0.7 m/s²)`, and never less than 300 m.
 */
export function announcementDistance(fromSpeed: number, toSpeed: number): number {
  const v1 = fromSpeed / 3.6
  const v2 = toSpeed / 3.6
  return Math.max(MIN_SPEED_SIGN_DISTANCE, (v1 * v1 - v2 * v2) / (2 * SPEED_SIGN_DECELERATION))
}

/** Parameter of the place `distance` m from `t` on a rail, towards `endT` */
function parameterAt(net: Network, seg: Segment, t: number, endT: number, distance: number, available: number): number {
  if (!(available > 0)) return endT
  const ends = segmentEnds(net, seg)
  if (!ends) return endT
  const at = shapeParamAtDistance(ends, t, endT >= t ? distance : -distance)
  // Never past the end of the stretch
  return endT >= t ? Math.min(at, endT) : Math.max(at, endT)
}

interface Upstream {
  segId: SegmentId
  t: number
  /** Direction of travel of the trains coming down this way */
  forward: boolean
  /** Distance really gone up the track, m: less than asked for when the track ends first */
  walked: number
}

/**
 * The place `distance` m up the track from `t` on rail `segId`, going towards the `from` node of
 * the rail (`towardFrom`) or towards its `to` node. At points the straightest way on is taken,
 * whatever their position. Where the track ends first, the end of the track.
 */
function walkUpstream(net: Network, segId: SegmentId, t: number, towardFrom: boolean, distance: number): Upstream | null {
  const start = net.segments.get(segId)
  if (!start) return null
  let seg: Segment = start
  let remaining = distance
  const seen = new Set<string>()
  for (let i = 0; i < MAX_SIGN_RAILS; i++) {
    const endT = towardFrom ? 0 : 1
    const available = segmentPartialLength(net, seg.id, t, endT)
    if (available >= remaining) {
      return { segId: seg.id, t: parameterAt(net, seg, t, endT, remaining, available), forward: towardFrom, walked: distance }
    }
    remaining -= available
    const nodeId: NodeId = towardFrom ? seg.from : seg.to
    const nextId: SegmentId | undefined = exitsOf(net, nodeId, seg.id, { anyPosition: true })[0]
    const next: Segment | undefined = nextId ? net.segments.get(nextId) : undefined
    const key = next ? next.id + (next.to === nodeId ? '<' : '>') : ''
    if (!next || seen.has(key)) return { segId: seg.id, t: endT, forward: towardFrom, walked: distance - remaining }
    seen.add(key)
    seg = next
    towardFrom = next.to === nodeId
    t = towardFrom ? 1 : 0
  }
  return { segId: seg.id, t: towardFrom ? 0 : 1, forward: towardFrom, walked: distance - remaining }
}

/** The sign announcing the zone to the trains that enter it at `t` of rail `segId`, coming from the `towardFrom` side */
function signFor(net: Network, line: LineSettings, zone: SpeedZone, segId: SegmentId, t: number, towardFrom: boolean): SpeedSign | null {
  const before = walkUpstream(net, segId, t, towardFrom, BEFORE_ZONE_DISTANCE)
  // A zone that starts where the track does is entered by nobody
  if (!before || !(before.walked > 0)) return null
  const fromSpeed = speedLimitAt(net, before.segId, before.t, line)
  if (!(zone.speed < fromSpeed)) return null
  const place = walkUpstream(net, segId, t, towardFrom, announcementDistance(fromSpeed, zone.speed))
  if (!place) return null
  return {
    zoneId: zone.id,
    segId: place.segId,
    t: place.t,
    forward: place.forward,
    speed: zone.speed,
    fromSpeed,
    distance: place.walked,
    diamond: fromSpeed - zone.speed >= DIAMOND_SIGN_DROP,
  }
}

function buildSigns(net: Network, line: LineSettings): SpeedSign[] {
  const signs: SpeedSign[] = []
  for (const zone of net.speedZones.values()) {
    const first = zone.spans[0]
    const last = zone.spans[zone.spans.length - 1]
    if (!first || !last) continue
    // End A is entered running the first stretch from `t0` to `t1`, end B running the last one from `t1` to `t0`
    const atA = signFor(net, line, zone, first.segId, first.t0, first.t1 > first.t0)
    if (atA) signs.push(atA)
    const atB = signFor(net, line, zone, last.segId, last.t1, last.t0 > last.t1)
    if (atB) signs.push(atB)
  }
  return signs
}

/** What the way up the track through the points is read from: the pairs of rails each table joins */
function routeTablesKey(net: Network): string {
  if (net.junctions.size === 0) return ''
  let key = ''
  for (const junction of net.junctions.values()) {
    key += `${junction.id}@${junction.nodeId}:`
    for (const passage of junction.passages) key += `${passage.a}-${passage.b},`
    key += ';'
  }
  return key
}

interface SignsEntry {
  geometry: number
  zones: number
  lineKey: string
  tables: string
  signs: SpeedSign[]
}

const kept = new WeakMap<Network, SignsEntry>()
const NO_SIGN: SpeedSign[] = []

/**
 * Every distant sign of the network, one per zone end and per direction of travel in which the limit
 * drops there. Cached as long as the track, the zones and the line settings do not change.
 *
 * A zone end is entered one way. When the limit just before it (line speed, other zones, curve) is
 * higher than the speed of the zone, a sign stands `announcementDistance` up the track from the
 * end, for the trains running towards it; through points the straightest way up is taken, and where
 * the track ends first the sign stands at its end, `distance` telling how far it really is. A rise
 * is never announced.
 */
export function speedSigns(net: Network, line: LineSettings = DEFAULT_LINE_SETTINGS): SpeedSign[] {
  if (net.speedZones.size === 0) return NO_SIGN
  const geometry = trackGeometryRevision(net)
  const zones = speedZonesRevision(net)
  const lineKey = `${line.lineSpeed}|${line.lineType}|${line.gauge ?? ''}|${line.realScale ?? ''}`
  const tables = routeTablesKey(net)
  const entry = kept.get(net)
  if (entry && entry.geometry === geometry && entry.zones === zones && entry.lineKey === lineKey && entry.tables === tables) {
    return entry.signs
  }
  const signs = buildSigns(net, line)
  speedSignStats.builds++
  kept.set(net, { geometry, zones, lineKey, tables, signs })
  return signs
}
