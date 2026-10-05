/**
 * Speed limits and cant read from the track: the curves it is made of, the cant each one carries,
 * the limit at a place, under a rake and ahead of it.
 *
 * Everything that only depends on the network and on the line settings (curves, cants, curve
 * speeds) is worked out once and kept until one of them changes, see `trackProfile`: the driving
 * console asks for it at every frame.
 *
 * Speeds are in km/h here, as the limits are written; `trainDynamics` converts.
 * This module must not import `train.ts` (which imports the physics, which imports this one).
 */

import type { Junction, Network, NodeId, Segment, SegmentId, TrackSpan } from './types'
import type { LineSettings, LineType, UpcomingSpeedLimit } from './speedLimits'
import { DEFAULT_LINE_SETTINGS } from './speedLimits'
import type { TrackPosition } from './locomotive'
import { segmentArcLength, segmentPartialLength } from './locomotive'
import { rakeOccupancy, type PlacedVehicle } from './occupancy'
import { endOverhang, ROLLING_STOCK, DEFAULT_ROLLING_STOCK } from './rollingStock'
import { entriesOf, findJunctionAtNode, openExit } from './routing'
import { speedZonesOnRail, speedZonesRevision } from './speedZones'
import { TRACK_T_EPSILON } from './trackObjects'
import { curveDeflection, minCurveRadius } from '../geometry/curve'
import {
  CANT_RANGE,
  STANDARD_GAUGE,
  automaticCant,
  cantForRampLength,
  cantRampLength,
  curveMaxSpeed,
  equilibriumCant,
  layableCant,
} from './cant'

// ─────────────────── Geometry revision ───────────────────

/**
 * Copy of what the curves and their cant are read from (where the nodes are, how the rails join
 * them, the cant set by hand), compared value by value. The network is changed in place from many
 * places, so there is no counter to trust: the comparison is exact and costs one pass over it.
 */
class TrackSnapshot {
  private nums = new Float64Array(0)
  private strs: string[] = []
  revision = 0

  update(net: Network): number {
    const wanted = net.nodes.size * 2 + net.segments.size * 3
    let changed = false
    if (this.nums.length !== wanted) {
      this.nums = new Float64Array(wanted)
      changed = true
    }
    const nums = this.nums
    const strs = this.strs
    let ni = 0
    let si = 0
    // Nodes are known by their place: one that is replaced shows in the rails that name it
    for (const node of net.nodes.values()) {
      const pos = node.pos
      if (nums[ni] !== pos.x) { nums[ni] = pos.x; changed = true }
      if (nums[ni + 1] !== pos.y) { nums[ni + 1] = pos.y; changed = true }
      ni += 2
    }
    for (const seg of net.segments.values()) {
      if (strs[si] !== seg.id) { strs[si] = seg.id; changed = true }
      if (strs[si + 1] !== seg.from) { strs[si + 1] = seg.from; changed = true }
      if (strs[si + 2] !== seg.to) { strs[si + 2] = seg.to; changed = true }
      si += 3
      const via = seg.kind === 'curve' ? seg.via : undefined
      const vx = via ? via.x : Infinity
      const vy = via ? via.y : Infinity
      const cant = seg.cant ?? -1
      if (nums[ni] !== vx) { nums[ni] = vx; changed = true }
      if (nums[ni + 1] !== vy) { nums[ni + 1] = vy; changed = true }
      if (nums[ni + 2] !== cant) { nums[ni + 2] = cant; changed = true }
      ni += 3
    }
    if (strs.length !== si) {
      strs.length = si
      changed = true
    }
    if (changed) this.revision++
    return this.revision
  }
}

const snapshots = new WeakMap<Network, TrackSnapshot>()

/**
 * Counter that changes whenever a node moves, a rail is added, removed or reshaped, or a cant is
 * set by hand: with `speedZonesRevision`, the key of everything computed from the track. Reading it
 * compares the network with its last known state (one pass over nodes and rails).
 */
export function trackGeometryRevision(net: Network): number {
  let snapshot = snapshots.get(net)
  if (!snapshot) {
    snapshot = new TrackSnapshot()
    snapshots.set(net, snapshot)
  }
  return snapshot.update(net)
}

// ─────────────────── Curves ───────────────────

/** Two rails follow each other in one curve when their radii differ by no more than this share */
const SAME_CURVE_RADIUS_TOLERANCE = 0.1
/** …and when they meet with no more than this angle between their tangents (degrees) */
const SAME_CURVE_MAX_KINK_DEG = 2
/** Relative difference between the two legs of a curved rail under which it is a circular arc */
const ARC_LEG_TOLERANCE = 0.01
/** A rail of a larger radius than this (m) is straight for the cant */
const MAX_CURVE_RADIUS = 50_000
/** Curve speed limits are multiples of this (km/h), rounded down… */
const CURVE_SPEED_STEP = 5
/** …and never under this (km/h) */
const MIN_CURVE_SPEED = 5

/** A curved rail and what it carries */
export interface RailCurve {
  segId: SegmentId
  /** Radius of the rail, m */
  radius: number
  /** Side the rail turns to when run from its `from` node to its `to` node: 1 or -1 */
  hand: 1 | -1
  /** Length of the rail, m */
  length: number
  /** Index of the curve the rail belongs to, in `TrackProfile.curves` */
  curve: number
  /** Cant of the rail away from the ends of its curve, mm */
  cant: number
  /** False when the cant was set by hand */
  automatic: boolean
  /** Speed limit the rail imposes for its radius and cant, km/h (a multiple of 5) */
  maxSpeed: number
  /** Speed limit that applies on the rail apart from its curve: its lowest zone, else the line speed, km/h */
  appliedSpeed: number
}

/** A curve of the track: curved rails that follow each other, turning the same way on a like radius */
export interface TrackCurve {
  /** The rails in order from one end of the curve to the other; `reversed` when run from `to` to `from` */
  rails: { segId: SegmentId; reversed: boolean }[]
  /** Nodes at the two ends (the tangent points); the same node twice for a closed curve */
  startNode: NodeId
  endNode: NodeId
  /** Length of the curve, m */
  length: number
}

/**
 * Part of a rail over which the cant is run in or out next to the end of a curve: it goes linearly
 * from `cantLo` at parameter `lo` to `cantHi` at parameter `hi` (`lo` < `hi`).
 */
interface CantRamp {
  lo: number
  hi: number
  cantLo: number
  cantHi: number
}

/** Line settings with every optional one filled in */
interface ResolvedLine {
  lineSpeed: number
  lineType: LineType
  gauge: number
  realScale: boolean
}

/** Everything read from the track that the speed limits and the cant need */
export interface TrackProfile {
  line: ResolvedLine
  /** The curved rails, by id. Empty off the real scale: cant and curve speeds are a 1:1 matter */
  rails: ReadonlyMap<SegmentId, RailCurve>
  curves: readonly TrackCurve[]
  /** Cant ramps lying on each rail (curved or straight) */
  ramps: ReadonlyMap<SegmentId, readonly CantRamp[]>
  /** Lengths of the rails, filled as they are asked for */
  lengths: Map<SegmentId, number>
}

function resolveLine(line: LineSettings): ResolvedLine {
  return {
    lineSpeed: line.lineSpeed,
    lineType: line.lineType,
    gauge: typeof line.gauge === 'number' && line.gauge > 0 ? line.gauge : STANDARD_GAUGE,
    realScale: line.realScale !== false,
  }
}

/** Radius and hand of a curved rail, null when it is straight (or as good as) */
function railGeometry(net: Network, seg: Segment): { radius: number; hand: 1 | -1 } | null {
  if (seg.kind !== 'curve' || !seg.via) return null
  const from = net.nodes.get(seg.from)
  const to = net.nodes.get(seg.to)
  if (!from || !to) return null
  const ax = seg.via.x - from.pos.x
  const ay = seg.via.y - from.pos.y
  const bx = to.pos.x - seg.via.x
  const by = to.pos.y - seg.via.y
  const a = Math.hypot(ax, ay)
  const b = Math.hypot(bx, by)
  const cross = ax * by - ay * bx
  if (a < 1e-9 || b < 1e-9 || Math.abs(cross) < 1e-12) return null
  const theta = curveDeflection(from.pos, seg.via, to.pos)
  // A piece of circular arc has two equal legs and R = leg / tan(θ/2); any other curve is taken at
  // its tightest
  const radius = Math.abs(a - b) <= ARC_LEG_TOLERANCE * Math.max(a, b)
    ? (a + b) / 2 / Math.tan(theta / 2)
    : minCurveRadius(from.pos, seg.via, to.pos, 16)
  if (!Number.isFinite(radius) || radius <= 0 || radius > MAX_CURVE_RADIUS) return null
  return { radius, hand: cross > 0 ? 1 : -1 }
}

/** Do the two curved rails meeting at `nodeId` run on with no kink there? */
function meetSmoothly(net: Network, a: Segment, b: Segment, nodeId: NodeId): boolean {
  const node = net.nodes.get(nodeId)
  if (!node || !a.via || !b.via) return false
  const ax = a.via.x - node.pos.x
  const ay = a.via.y - node.pos.y
  const bx = b.via.x - node.pos.x
  const by = b.via.y - node.pos.y
  const la = Math.hypot(ax, ay)
  const lb = Math.hypot(bx, by)
  if (la < 1e-9 || lb < 1e-9) return false
  return -(ax * bx + ay * by) / (la * lb) >= Math.cos((SAME_CURVE_MAX_KINK_DEG * Math.PI) / 180)
}

/** The only other rail at a node that joins exactly two, else null */
function soleNeighbour(net: Network, nodeId: NodeId, segId: SegmentId): Segment | null {
  const rails = net.adjacency.get(nodeId)
  if (!rails || rails.length !== 2) return null
  const otherId = rails[0] === segId ? rails[1] : rails[0]
  return otherId === segId ? null : net.segments.get(otherId) ?? null
}

type DraftRail = Omit<RailCurve, 'cant' | 'automatic' | 'maxSpeed' | 'appliedSpeed'> & Partial<RailCurve>

/** Group the curved rails into curves: runs through nodes joining two rails, same hand, like radius, no kink. */
function recogniseCurves(net: Network, rails: Map<SegmentId, DraftRail>): TrackCurve[] {
  const curves: TrackCurve[] = []
  const taken = new Set<SegmentId>()

  /** Rails that carry the curve on beyond `nodeId`, reached on `seg` with the curve turning to `hand` */
  const extend = (seg: Segment, nodeId: NodeId, hand: number): { segId: SegmentId; entersAtFrom: boolean; exit: NodeId }[] => {
    const run: { segId: SegmentId; entersAtFrom: boolean; exit: NodeId }[] = []
    let current = seg
    let node = nodeId
    for (;;) {
      const next = soleNeighbour(net, node, current.id)
      const geo = next && rails.get(next.id)
      if (!next || !geo || taken.has(next.id)) break
      const entersAtFrom = next.from === node
      if ((entersAtFrom ? geo.hand : -geo.hand) !== hand) break
      const radius = rails.get(current.id)!.radius
      if (Math.abs(geo.radius - radius) > SAME_CURVE_RADIUS_TOLERANCE * Math.max(geo.radius, radius)) break
      if (!meetSmoothly(net, current, next, node)) break
      taken.add(next.id)
      node = entersAtFrom ? next.to : next.from
      run.push({ segId: next.id, entersAtFrom, exit: node })
      current = next
    }
    return run
  }

  for (const [segId, geo] of rails) {
    if (taken.has(segId)) continue
    const seg = net.segments.get(segId)!
    taken.add(segId)
    const after = extend(seg, seg.to, geo.hand)
    // Run the other way from the `from` end, the curve then turns to the other hand
    const before = extend(seg, seg.from, -geo.hand)
    const curve: TrackCurve = {
      rails: [
        ...before.reverse().map((r) => ({ segId: r.segId, reversed: r.entersAtFrom })),
        { segId, reversed: false },
        ...after.map((r) => ({ segId: r.segId, reversed: !r.entersAtFrom })),
      ],
      // `before` is now in curve order: its first rail is the far one
      startNode: before.length > 0 ? before[0].exit : seg.from,
      endNode: after.length > 0 ? after[after.length - 1].exit : seg.to,
      length: 0,
    }
    for (const rail of curve.rails) {
      const draft = rails.get(rail.segId)!
      draft.curve = curves.length
      curve.length += draft.length
    }
    curves.push(curve)
  }
  return curves
}

/**
 * Speed limit (km/h) a curve of `radius` m laid with `cant` mm imposes on a line type: the highest
 * speed at which the deficiency stays within what is admitted at that speed, rounded down to a
 * multiple of 5 km/h as limits are in service.
 */
export function curveSpeedLimit(radius: number, cant: number, lineType: LineType, gauge: number = STANDARD_GAUGE): number {
  let best = 0
  for (const step of ROLLING_STOCK[DEFAULT_ROLLING_STOCK].cantDeficiency[lineType]) {
    best = Math.max(best, Math.min(step.upTo, curveMaxSpeed(radius, cant, step.deficiency, gauge)))
  }
  if (!Number.isFinite(best)) return Infinity
  return Math.max(MIN_CURVE_SPEED, Math.floor(best / CURVE_SPEED_STEP + 1e-6) * CURVE_SPEED_STEP)
}

/** Lowest speed of the zones lying on a rail, else the line speed */
function appliedSpeedOnRail(net: Network, segId: SegmentId, lineSpeed: number): number {
  let speed = lineSpeed
  for (const stretch of speedZonesOnRail(net, segId)) {
    if (stretch.hi - stretch.lo > TRACK_T_EPSILON) speed = Math.min(speed, stretch.zone.speed)
  }
  return speed
}

function buildProfile(net: Network, line: ResolvedLine): TrackProfile {
  const drafts = new Map<SegmentId, DraftRail>()
  const ramps = new Map<SegmentId, CantRamp[]>()
  const lengths = new Map<SegmentId, number>()
  if (!line.realScale) return { line, rails: new Map(), curves: [], ramps, lengths }

  for (const seg of net.segments.values()) {
    const geo = railGeometry(net, seg)
    if (!geo) continue
    const length = segmentArcLength(net, seg.id)
    lengths.set(seg.id, length)
    drafts.set(seg.id, { segId: seg.id, radius: geo.radius, hand: geo.hand, length, curve: -1 })
  }
  const curves = recogniseCurves(net, drafts)

  for (const draft of drafts.values()) {
    const seg = net.segments.get(draft.segId)!
    const appliedSpeed = appliedSpeedOnRail(net, draft.segId, line.lineSpeed)
    const byHand = typeof seg.cant === 'number' && Number.isFinite(seg.cant)
    let cant: number
    if (byHand) {
      cant = Math.max(CANT_RANGE.min, Math.min(CANT_RANGE.max, seg.cant!))
    } else {
      cant = automaticCant(draft.radius, appliedSpeed, line.lineType, line.gauge)
      // A curve too short for its two half ramps gets the cant that fits
      const fitting = cantForRampLength(curves[draft.curve].length, appliedSpeed)
      if (cant > fitting) cant = layableCant(fitting)
    }
    draft.cant = cant
    draft.automatic = !byHand
    draft.appliedSpeed = appliedSpeed
    draft.maxSpeed = curveSpeedLimit(draft.radius, cant, line.lineType, line.gauge)
  }
  const rails = drafts as Map<SegmentId, RailCurve>

  const addRamp = (segId: SegmentId, ramp: CantRamp): void => {
    if (ramp.hi - ramp.lo < TRACK_T_EPSILON) return
    const list = ramps.get(segId)
    if (list) list.push(ramp)
    else ramps.set(segId, [ramp])
  }
  /** Lay on one rail the part `x0`…`x1` (m from the tangent point) of a ramp worth `value(x)` */
  const layOn = (segId: SegmentId, length: number, entersAtFrom: boolean, offset: number, x0: number, x1: number, value: (x: number) => number): void => {
    if (!(length > 0) || x1 <= x0) return
    const t0 = (x0 - offset) / length
    const t1 = (x1 - offset) / length
    if (entersAtFrom) addRamp(segId, { lo: t0, hi: t1, cantLo: value(x0), cantHi: value(x1) })
    else addRamp(segId, { lo: 1 - t1, hi: 1 - t0, cantLo: value(x1), cantHi: value(x0) })
  }

  for (const curve of curves) {
    if (curve.startNode === curve.endNode) continue // closed curve: no end, no ramp
    for (const atStart of [true, false]) {
      const ordered = atStart ? curve.rails : [...curve.rails].reverse()
      const endRail = rails.get(ordered[0].segId)!
      const endNode = atStart ? curve.startNode : curve.endNode
      if (endRail.cant <= 0) continue
      const neighbour = soleNeighbour(net, endNode, endRail.segId)
      const neighbourCurve = neighbour && rails.get(neighbour.id)
      // Hand of the curve when it is run away from this end, and of the rail next to it run the same way
      const endSeg = net.segments.get(endRail.segId)!
      const handAway = endSeg.from === endNode ? endRail.hand : -endRail.hand
      const neighbourHand = neighbour && neighbourCurve ? (neighbour.to === endNode ? neighbourCurve.hand : -neighbourCurve.hand) : 0
      // Another curve turning the same way carries on from here: the cant steps from one to the other
      if (neighbourHand === handAway) continue

      const half = cantRampLength(endRail.cant, endRail.appliedSpeed) / 2
      const inside = Math.min(half, curve.length / 2)
      if (!(half > 0) || !(inside > 0)) continue
      const share = (x: number): number => (half + x) / (half + inside)

      // Inner half: each rail rises towards its own cant
      let offset = 0
      for (const rail of ordered) {
        if (offset >= inside) break
        const data = rails.get(rail.segId)!
        const entersAtFrom = atStart ? !rail.reversed : rail.reversed
        layOn(rail.segId, data.length, entersAtFrom, offset, offset, Math.min(offset + data.length, inside), (x) => data.cant * share(x))
        offset += data.length
      }

      // Outer half, on the straight track that leads to the curve, as far as it runs plainly
      offset = 0
      let node = endNode
      let previous: Segment = endSeg
      let next = neighbour
      while (next && offset < half && !rails.has(next.id)) {
        const length = segmentArcLength(net, next.id)
        if (!(length > 0)) break
        lengths.set(next.id, length)
        const entersAtFrom = next.from === node
        layOn(next.id, length, entersAtFrom, offset, offset, Math.min(offset + length, half), (x) => endRail.cant * share(-x))
        offset += length
        node = entersAtFrom ? next.to : next.from
        previous = next
        next = soleNeighbour(net, node, previous.id)
      }
    }
  }
  return { line, rails, curves, ramps, lengths }
}

interface ProfileEntry {
  geometry: number
  zones: number
  lineKey: string
  profile: TrackProfile
}

const profiles = new WeakMap<Network, ProfileEntry>()

/** Number of times a profile was built, for the tests that check it is kept */
export const trackSpeedStats = { profileBuilds: 0, lookAheadWalks: 0, occupancyWalks: 0 }

/**
 * Curves, cants and curve speeds of the network under these line settings. Kept from one call to
 * the next and built again only when the track (`trackGeometryRevision`), the speed zones
 * (`speedZonesRevision`) or the settings have changed; a call that finds nothing changed costs the
 * comparison of the network with its last known state.
 */
export function trackProfile(net: Network, line: LineSettings = DEFAULT_LINE_SETTINGS): TrackProfile {
  const geometry = trackGeometryRevision(net)
  const zones = speedZonesRevision(net)
  const resolved = resolveLine(line)
  const lineKey = `${resolved.lineSpeed}|${resolved.lineType}|${resolved.gauge}|${resolved.realScale}`
  const entry = profiles.get(net)
  if (entry && entry.geometry === geometry && entry.zones === zones && entry.lineKey === lineKey) return entry.profile
  const profile = buildProfile(net, resolved)
  trackSpeedStats.profileBuilds++
  profiles.set(net, { geometry, zones, lineKey, profile })
  return profile
}

function railLength(net: Network, profile: TrackProfile, segId: SegmentId): number {
  let length = profile.lengths.get(segId)
  if (length === undefined) {
    length = segmentArcLength(net, segId)
    profile.lengths.set(segId, length)
  }
  return length
}

// ─────────────────── Cant at a place ───────────────────

function cantOn(profile: TrackProfile, segId: SegmentId, t: number): number {
  const rail = profile.rails.get(segId)
  let cant = rail ? rail.cant : 0
  const ramps = profile.ramps.get(segId)
  if (!ramps) return cant
  for (const ramp of ramps) {
    if (t < ramp.lo || t > ramp.hi) continue
    const value = ramp.cantLo + ((ramp.cantHi - ramp.cantLo) * (t - ramp.lo)) / (ramp.hi - ramp.lo)
    // In a curve the ramps take away from its cant; on straight track they bring some
    cant = rail ? Math.min(cant, value) : Math.max(cant, value)
  }
  return cant
}

/**
 * Cant (mm) of the track at a place: that of the curve, run in linearly over `cantRampLength`
 * astride each of its two ends (half on the straight track, half in the curve). 0 on plain
 * straight track and off the real scale.
 */
export function localCant(net: Network, segId: SegmentId, t: number, line: LineSettings = DEFAULT_LINE_SETTINGS): number {
  return cantOn(trackProfile(net, line), segId, t)
}

/** Cant deficiency (mm) at `speed` km/h at a place: 0 or less on straight track */
function deficiencyOn(profile: TrackProfile, pos: TrackPosition, speed: number): number {
  const rail = profile.rails.get(pos.segId)
  const equilibrium = rail ? equilibriumCant(speed, rail.radius, profile.line.gauge) : 0
  return equilibrium - cantOn(profile, pos.segId, pos.t)
}

/**
 * Largest cant deficiency (mm) under a bogie of the rake at `speed` km/h, with the cant the track
 * has where each bogie stands. 0 when no bogie is in a curve, and off the real scale.
 */
export function rakeCantDeficiency(
  net: Network,
  vehicles: readonly PlacedVehicle[],
  speed: number,
  line: LineSettings = DEFAULT_LINE_SETTINGS,
): number {
  return cantDeficiencyIn(trackProfile(net, line), vehicles, speed)
}

/** `rakeCantDeficiency` on a profile already in hand (one per simulation tick, not one per step) */
export function cantDeficiencyIn(profile: TrackProfile, vehicles: readonly PlacedVehicle[], speed: number): number {
  if (profile.rails.size === 0) return 0
  let worst = 0
  for (const veh of vehicles) {
    worst = Math.max(worst, deficiencyOn(profile, veh.front, speed), deficiencyOn(profile, veh.rear, speed))
  }
  return worst
}

// ─────────────────── Limit at a place and under a rake ───────────────────

/**
 * Speed limit (km/h) at a place of the track: the lowest of the line speed, the zones that cover
 * the place and the speed of the curve there.
 */
export function speedLimitAt(net: Network, segId: SegmentId, t: number, line: LineSettings = DEFAULT_LINE_SETTINGS): number {
  const profile = trackProfile(net, line)
  let limit = profile.rails.get(segId)?.maxSpeed ?? Infinity
  limit = Math.min(limit, profile.line.lineSpeed)
  for (const stretch of speedZonesOnRail(net, segId)) {
    if (t >= stretch.lo - TRACK_T_EPSILON && t <= stretch.hi + TRACK_T_EPSILON) limit = Math.min(limit, stretch.zone.speed)
  }
  return limit
}

/** Lowest limit (km/h) met anywhere on the stretches: line speed, zones and curves */
export function speedLimitOverSpans(net: Network, spans: readonly TrackSpan[], line: LineSettings = DEFAULT_LINE_SETTINGS): number {
  return limitOverSpans(net, trackProfile(net, line), spans)
}

function limitOverSpans(net: Network, profile: TrackProfile, spans: readonly TrackSpan[]): number {
  let limit = profile.line.lineSpeed
  for (const span of spans) {
    const curve = profile.rails.get(span.segId)
    if (curve && curve.maxSpeed < limit) limit = curve.maxSpeed
    const stretches = speedZonesOnRail(net, span.segId)
    if (stretches.length === 0) continue
    const lo = Math.min(span.t0, span.t1)
    const hi = Math.max(span.t0, span.t1)
    for (const stretch of stretches) {
      if (stretch.zone.speed < limit && stretch.lo <= hi + TRACK_T_EPSILON && stretch.hi >= lo - TRACK_T_EPSILON) limit = stretch.zone.speed
    }
  }
  return limit
}

/** A rake as the limits need it (a `TrainSet` satisfies it) */
export interface RakeOnTrack {
  vehicles: readonly PlacedVehicle[]
  /** 1 = towards the head of the rake, -1 = towards its tail */
  direction: 1 | -1
  /** Maximum speed of the rolling stock, m/s */
  maxSpeed: number
}

interface AheadMemo {
  profile: TrackProfile
  direction: 1 | -1
  /** Limit the rake ran under when the route was walked, km/h */
  limit: number
  segId: SegmentId
  t: number
  ascending: boolean
  /** How far ahead of the leading end the route was walked, m */
  walked: number
  /** Route tables met on the way and the position each one was in */
  junctions: { junction: Junction; active: number }[]
  found: UpcomingSpeedLimit | null
}

interface RakeMemo {
  profile: TrackProfile | null
  key: string
  limit: number
  ahead: AheadMemo | null
}

const rakeMemos = new WeakMap<object, RakeMemo>()

function memoOf(rake: RakeOnTrack): RakeMemo {
  let memo = rakeMemos.get(rake)
  if (!memo) {
    memo = { profile: null, key: '', limit: 0, ahead: null }
    rakeMemos.set(rake, memo)
  }
  return memo
}

/**
 * Speed limit (km/h) a rake runs under: the lowest met anywhere under it, from the front end of its
 * lead vehicle to the rear end of its last one — a lower limit applies as soon as the head enters
 * it, a higher one only once the tail has left the lower — and never above the maximum speed of
 * the rolling stock. Worked out again only when the rake has moved or the track has changed.
 */
export function rakeSpeedLimit(net: Network, rake: RakeOnTrack, line: LineSettings = DEFAULT_LINE_SETTINGS): number {
  return rakeSpeedLimitIn(net, trackProfile(net, line), rake)
}

/** `rakeSpeedLimit` on a profile already in hand */
export function rakeSpeedLimitIn(net: Network, profile: TrackProfile, rake: RakeOnTrack): number {
  const stockLimit = rake.maxSpeed * 3.6
  if (rake.vehicles.length === 0) return Math.min(stockLimit, profile.line.lineSpeed)
  const head = rake.vehicles[0].front
  const tail = rake.vehicles[rake.vehicles.length - 1].rear
  const key = `${rake.vehicles.length}|${head.segId}|${head.t}|${tail.segId}|${tail.t}`
  const memo = memoOf(rake)
  if (memo.profile !== profile || memo.key !== key) {
    trackSpeedStats.occupancyWalks++
    memo.profile = profile
    memo.key = key
    memo.limit = limitOverSpans(net, profile, rakeOccupancy(net, rake.vehicles).spans)
  }
  return Math.min(stockLimit, memo.limit)
}

// ─────────────────── Limit ahead ───────────────────

/** The route is looked over at least this far ahead of a rake (m) */
export const MIN_LOOK_AHEAD = 2000
/** The look-ahead reaches this many times the stopping distance */
export const LOOK_AHEAD_STOPPING_FACTOR = 1.5
/** …and never further than this (m), whatever the stopping distance */
const MAX_LOOK_AHEAD = 30_000
/** Each walk goes this much further than asked, so that the next frames can reuse it */
const LOOK_AHEAD_MARGIN = 1.25
/** A route is not followed over more rails than this */
const MAX_LOOK_AHEAD_RAILS = 20_000

/** Distance (m) the route ahead of a rake is looked over for its stopping distance (m) */
export function lookAheadReach(stoppingDistance: number): number {
  const wanted = Number.isFinite(stoppingDistance) ? stoppingDistance * LOOK_AHEAD_STOPPING_FACTOR : MAX_LOOK_AHEAD
  return Math.max(MIN_LOOK_AHEAD, Math.min(MAX_LOOK_AHEAD, wanted))
}

/** Where the route starts: the bogie under the leading end, the way it runs on its rail, and the overhang beyond it */
function routeStart(rake: RakeOnTrack): { segId: SegmentId; t: number; ascending: boolean; overhang: number } | null {
  const lastIdx = rake.vehicles.length - 1
  if (lastIdx < 0) return null
  if (rake.direction === 1) {
    const front = rake.vehicles[0].front
    return { segId: front.segId, t: front.t, ascending: front.forward, overhang: endOverhang(rake.vehicles, 0, 'front') }
  }
  const rear = rake.vehicles[lastIdx].rear
  return { segId: rear.segId, t: rear.t, ascending: !rear.forward, overhang: endOverhang(rake.vehicles, lastIdx, 'rear') }
}

/** The rail the route goes on by beyond `nodeId`, as `walkForward` (head first) and `walkBackward` (tail first) take it */
function nextRail(net: Network, nodeId: NodeId, segId: SegmentId, direction: 1 | -1): SegmentId | null {
  if (direction === 1) return openExit(net, nodeId, segId)
  const possible = entriesOf(net, nodeId, segId, { anyPosition: true })
  return possible.length === 1 ? possible[0] : entriesOf(net, nodeId, segId)[0] ?? null
}

function walkAhead(
  net: Network,
  profile: TrackProfile,
  rake: RakeOnTrack,
  limit: number,
  reach: number,
): AheadMemo | null {
  const start = routeStart(rake)
  if (!start) return null
  trackSpeedStats.lookAheadWalks++
  const memo: AheadMemo = {
    profile,
    direction: rake.direction,
    limit,
    segId: start.segId,
    t: start.t,
    ascending: start.ascending,
    walked: reach,
    junctions: [],
    found: null,
  }
  let segId = start.segId
  let t = start.t
  let ascending = start.ascending
  /** Distance from the bogie to the place `t` of the current rail */
  let travelled = 0
  const end = start.overhang + reach

  for (let i = 0; i < MAX_LOOK_AHEAD_RAILS && travelled <= end; i++) {
    const seg = net.segments.get(segId)
    if (!seg) break
    const exitT = ascending ? 1 : 0
    let nearest = Infinity
    let speed = Infinity
    const meet = (distance: number, lower: number): void => {
      if (distance < nearest - 1e-6) {
        nearest = distance
        speed = lower
      } else if (distance <= nearest + 1e-6) {
        speed = Math.min(speed, lower)
      }
    }
    // The rail the rake stands on is already part of the limit it runs under
    const curveLimit = i > 0 ? profile.rails.get(segId)?.maxSpeed ?? Infinity : Infinity
    if (curveLimit < limit) meet(travelled, curveLimit)
    for (const stretch of speedZonesOnRail(net, segId)) {
      if (stretch.zone.speed >= limit) continue
      // Where the route enters the stretch, if it still lies ahead on this rail
      if (ascending ? stretch.hi <= t + TRACK_T_EPSILON : stretch.lo >= t - TRACK_T_EPSILON) continue
      const enter = ascending ? Math.max(stretch.lo, t) : Math.min(stretch.hi, t)
      meet(travelled + (enter === t ? 0 : segmentPartialLength(net, segId, t, enter)), stretch.zone.speed)
    }
    if (nearest <= end) {
      memo.found = { speed, distance: Math.max(0, nearest - start.overhang) }
      return memo
    }

    travelled += i === 0 ? segmentPartialLength(net, segId, t, exitT) : railLength(net, profile, segId)
    const exitNode = ascending ? seg.to : seg.from
    const junction = findJunctionAtNode(net, exitNode)
    if (junction) memo.junctions.push({ junction, active: junction.active })
    const nextId = nextRail(net, exitNode, segId, rake.direction)
    const next = nextId ? net.segments.get(nextId) : undefined
    if (!next) break
    segId = next.id
    ascending = next.from === exitNode
    t = ascending ? 0 : 1
  }
  return memo
}

/**
 * The next speed limit lower than `limit` (km/h, the one the rake runs under) along the route
 * ahead of it — points as they are set, the way the rake is moving, tail first in reverse — and
 * its distance from the leading end of the rake. Null when there is none within `reach` metres.
 *
 * The route is walked once and kept: as long as the leading bogie stays on the same rail, the
 * points met are as they were, the limit under the rake is the same and the track has not changed,
 * the answer is the kept one, the distance run since taken off.
 */
export function limitAhead(
  net: Network,
  rake: RakeOnTrack,
  limit: number,
  reach: number = MIN_LOOK_AHEAD,
  line: LineSettings = DEFAULT_LINE_SETTINGS,
): UpcomingSpeedLimit | null {
  return limitAheadIn(net, trackProfile(net, line), rake, limit, reach)
}

function limitAheadIn(net: Network, profile: TrackProfile, rake: RakeOnTrack, limit: number, reach: number): UpcomingSpeedLimit | null {
  const start = routeStart(rake)
  if (!start) return null
  const memo = memoOf(rake)
  const kept = memo.ahead
  if (
    kept &&
    kept.profile === profile &&
    kept.direction === rake.direction &&
    kept.limit === limit &&
    kept.segId === start.segId &&
    kept.ascending === start.ascending &&
    (start.ascending ? start.t >= kept.t : start.t <= kept.t) &&
    kept.junctions.every((met) => met.junction.active === met.active)
  ) {
    const moved = start.t === kept.t ? 0 : segmentPartialLength(net, start.segId, kept.t, start.t)
    if (kept.found) {
      const distance = kept.found.distance - moved
      if (distance <= reach) return { speed: kept.found.speed, distance: Math.max(0, distance) }
      return null
    }
    if (kept.walked - moved >= reach) return null
  }
  const walked = walkAhead(net, profile, rake, limit, reach * LOOK_AHEAD_MARGIN)
  memo.ahead = walked
  if (!walked?.found || walked.found.distance > reach) return null
  return { ...walked.found }
}

/** What the track says to a rake where it stands, for the driving console */
export interface RakeSpeedState {
  /** Limit the rake runs under, km/h (see `rakeSpeedLimit`) */
  limit: number
  /** Next lower limit ahead (see `limitAhead`) */
  next: UpcomingSpeedLimit | null
  /** Largest cant deficiency under a bogie, mm (see `rakeCantDeficiency`) */
  cantDeficiency: number
}

/**
 * Limit under a rake running at `speed` km/h, next lower limit within `lookAheadReach` of its
 * stopping distance and cant deficiency, read in one go: the network is compared with its last
 * known state once, where calling the three functions would do it three times.
 */
export function rakeSpeedState(
  net: Network,
  rake: RakeOnTrack,
  speed: number,
  stoppingDistance: number,
  line: LineSettings = DEFAULT_LINE_SETTINGS,
): RakeSpeedState {
  const profile = trackProfile(net, line)
  const limit = rakeSpeedLimitIn(net, profile, rake)
  return {
    limit,
    next: limitAheadIn(net, profile, rake, limit, lookAheadReach(stoppingDistance)),
    cantDeficiency: cantDeficiencyIn(profile, rake.vehicles, speed),
  }
}
