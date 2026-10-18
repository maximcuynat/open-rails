import type { Network, NodeId, Point, Segment, SegmentId } from '../models/types'
import { segmentPartialLength } from '../models/locomotive'
import { runsAgainst, setRunning } from '../models/running'
import { closestParamOnShape, leaveDirectionOnShape, pointOnShape, shapeBounds, segmentEnds, segmentShapeLength, tangentOnShape, type SegmentEnds } from '../geometry/segmentGeometry'
import type { TrackPathOptions } from './trackPath'

// ─────────────────── Running on the normal track ───────────────────
//
// Two uses of `Segment.running` (models/running.ts):
//
// - The path search pays for the track run against it (`runningToll`): each metre counts
//   `RUNNING_TOLL_PER_M` metres more. A way that keeps to its track is then taken over one as
//   short that runs on the other one, and a train put on the wrong track goes back at the first
//   crossover; but it is a cost, not a ban — a train held on its track, or a platform reached
//   only from the other one, still gets there. A single track has no normal direction and costs
//   nothing.
//
// - Where OpenStreetMap says nothing (`railway:preferred_direction` absent), the import works it
//   out from the geometry (`inferKeepLeft`), the French rule « on a double line, keep to the
//   left »: a rail with exactly one other track alongside it, at track spacing, runs the way that
//   leaves that other track on its right. Not on single track (no other track), not where three
//   tracks or more lie side by side (a station, a passing loop with sidings: there the tracks are
//   run both ways). The left of a heading (hx, hy) is (hy, −hx), the y axis growing downwards.
//   Right-hand running (Alsace-Moselle) would take the other side; not done yet.

/** Metres a way counts more for each metre it runs a rail against its normal direction */
export const RUNNING_TOLL_PER_M = 1

/**
 * The toll of the track run against its normal direction (see `TrackPathOptions.toll`): the length
 * of the rail entered, times `RUNNING_TOLL_PER_M`, when it is entered against it. `reversed`: the
 * search walks the way backwards (from where the train goes to where it comes from), and pays for
 * the rails it walks WITH their normal direction.
 */
export function runningToll(net: Network, reversed = false): NonNullable<TrackPathOptions['toll']> {
  return (node, _inSeg, outSeg) => {
    const seg = net.segments.get(outSeg)
    if (!seg?.running) return 0
    // Entered at its `from` end, the rail is run forward
    const against = runsAgainst(seg, seg.from === node) !== reversed
    return against ? RUNNING_TOLL_PER_M * segmentPartialLength(net, outSeg, 0, 1) : 0
  }
}

/** Several tolls paid together; undefined ones are left out */
export function sumTolls(...tolls: (TrackPathOptions['toll'] | undefined)[]): NonNullable<TrackPathOptions['toll']> {
  const present = tolls.filter((toll): toll is NonNullable<TrackPathOptions['toll']> => !!toll)
  if (present.length === 1) return present[0]
  return (node: NodeId, inSeg: SegmentId, outSeg: SegmentId) => {
    let sum = 0
    for (const toll of present) sum += Math.max(0, toll(node, inSeg, outSeg))
    return sum
  }
}

/** Metres of track run against its normal direction along a list of stretches */
export function lengthAgainstRunning(net: Network, spans: readonly { segId: SegmentId; t0: number; t1: number }[]): number {
  let length = 0
  for (const span of spans) {
    const seg = net.segments.get(span.segId)
    if (seg && span.t1 !== span.t0 && runsAgainst(seg, span.t1 > span.t0)) length += segmentPartialLength(net, span.segId, span.t0, span.t1)
  }
  return length
}

export interface KeepLeftOptions {
  /** The other track of a double line lies this far (m) from the rail's axis, between the two */
  spacing?: { min: number; max: number }
  /** Any other parallel track within this (m) makes three tracks side by side: no rule there */
  crowdedWithin?: number
  /** One sample of the rail every this many metres */
  sampleStep?: number
  /** Rails left as they are (a way OSM says is run both ways) */
  skip?: (seg: Segment) => boolean
  /** A double track shorter than this (m) between two single ones is a passing loop, left without direction */
  minDoubleRun?: number
}

/** Real track: the axes of a double line are 3.5 to 5 m apart, OSM drawing them less precisely */
const DEFAULT_SPACING = { min: 2.5, max: 7.5 }
const DEFAULT_CROWDED = 12
const DEFAULT_SAMPLE_STEP = 50
/** The longest passing loops of a single line are 1 to 2 km long */
const DEFAULT_MIN_DOUBLE_RUN = 2500
/** Two rails are parallel when their directions are within this angle */
const PARALLEL_COS = Math.cos((6 * Math.PI) / 180)
/** A rail is alongside a sample when its nearest point is within this (m) of abeam */
const ABEAM = 2
/** Two neighbours this close (m) laterally are the same track (two rails meeting at a joint) */
const SAME_TRACK = 1
/** Share of the samples of a rail that must see a double line, and share of those that must agree */
const MIN_SEEN = 0.6
const MIN_AGREE = 0.9

/**
 * The French rule for the rails without a normal direction: keep to the left on a double line
 * (see the head of this file). Returns how many rails got one.
 */
export function inferKeepLeft(net: Network, options: KeepLeftOptions = {}): number {
  const spacing = options.spacing ?? DEFAULT_SPACING
  const crowded = Math.max(options.crowdedWithin ?? DEFAULT_CROWDED, spacing.max)
  const step = options.sampleStep ?? DEFAULT_SAMPLE_STEP
  const minRun = options.minDoubleRun ?? DEFAULT_MIN_DOUBLE_RUN
  const decided = new Map<SegmentId, 'forward' | 'backward'>()
  /** Rails with no other track alongside: single track */
  const single = new Set<SegmentId>()
  const grid = new RailGrid(net)
  for (const seg of net.segments.values()) {
    const skipped = options.skip?.(seg) ?? false
    if (seg.running) continue
    const ends = grid.ends.get(seg.id)
    if (!ends) continue
    const length = grid.lengths.get(seg.id)!
    if (!(length > 0)) continue
    const samples = Math.max(1, Math.round(length / step))
    let left = 0
    let right = 0
    let alone = 0
    for (let i = 0; i < samples; i++) {
      const side = sideOfOtherTrack(grid, seg, pointOnShape(ends, (i + 0.5) / samples), tangentOnShape(ends, (i + 0.5) / samples), spacing, crowded)
      if (side === 1) left++
      else if (side === -1) right++
      else if (side === 0) alone++
    }
    if (alone >= MIN_SEEN * samples) single.add(seg.id)
    const seen = left + right
    if (skipped || seen < MIN_SEEN * samples) continue
    // The other track on the right of from → to: run forward, keeping to the left
    if (right >= MIN_AGREE * seen) decided.set(seg.id, 'forward')
    else if (left >= MIN_AGREE * seen) decided.set(seg.id, 'backward')
  }
  // A short double track between two single ones is a passing loop: run both ways (see `crossingRules.ts`)
  let laid = 0
  for (const [segId, running] of decided) {
    const seg = net.segments.get(segId)!
    if (doubleRunLength(net, grid, seg, single, minRun) < minRun) continue
    setRunning(net, seg, running)
    laid++
  }
  return laid
}

/** Deflection (rad) up to which a rail carries a track on through a node */
const CARRIES_ON = (15 * Math.PI) / 180

/**
 * Length of the track that `seg` is part of, walked both ways through each node along the
 * straightest rail, until a single track or an end of track, and no further than `enough`.
 */
function doubleRunLength(net: Network, grid: RailGrid, seg: Segment, single: ReadonlySet<SegmentId>, enough: number): number {
  let total = grid.lengths.get(seg.id) ?? 0
  for (const atTo of [true, false]) {
    let current = seg
    let nodeId = atTo ? seg.to : seg.from
    const seen = new Set<SegmentId>([seg.id])
    while (total < enough) {
      const ends = grid.ends.get(current.id)
      if (!ends) break
      // The direction the walk arrives at the node in
      const arrive = leaveDirectionOnShape(ends, current.from === nodeId)
      let next: Segment | null = null
      let bestCos = Math.cos(CARRIES_ON)
      for (const sid of net.adjacency.get(nodeId) ?? []) {
        if (seen.has(sid)) continue
        const other = net.segments.get(sid)
        const otherEnds = other && grid.ends.get(sid)
        if (!other || !otherEnds) continue
        const leave = leaveDirectionOnShape(otherEnds, other.from === nodeId)
        // `arrive` points back into the rail walked: carrying on is the opposite way
        const cos = -(arrive.x * leave.x + arrive.y * leave.y)
        if (cos > bestCos) {
          bestCos = cos
          next = other
        }
      }
      if (!next || single.has(next.id)) break
      seen.add(next.id)
      total += grid.lengths.get(next.id) ?? 0
      nodeId = next.from === nodeId ? next.to : next.from
      current = next
    }
  }
  return total
}

/**
 * Where the one other track alongside a place of `seg` lies: 1 on the left of `heading`, -1 on
 * the right; 0 when there is no other track alongside, 2 when there is one off track spacing, or
 * more than one.
 */
function sideOfOtherTrack(grid: RailGrid, seg: Segment, p: Point, heading: Point, spacing: { min: number; max: number }, crowded: number): number {
  const lateralOf: number[] = []
  for (const other of grid.near(p)) {
    if (other.id === seg.id) continue
    const ends = grid.ends.get(other.id)
    if (!ends) continue
    const box = grid.boxes.get(other.id)!
    const reach = crowded + ABEAM
    if (p.x < box.minX - reach || p.x > box.maxX + reach || p.y < box.minY - reach || p.y > box.maxY + reach) continue
    const t = closestParamOnShape(ends, p)
    const q = pointOnShape(ends, t)
    const dx = q.x - p.x
    const dy = q.y - p.y
    if (Math.hypot(dx, dy) > crowded + ABEAM) continue
    if (Math.abs(dx * heading.x + dy * heading.y) > ABEAM) continue
    const dir = tangentOnShape(ends, t)
    if (Math.abs(dir.x * heading.x + dir.y * heading.y) < PARALLEL_COS) continue
    const lateral = dx * heading.y - dy * heading.x
    if (Math.abs(lateral) > crowded) continue
    // The rail before or after on the same track, met near a joint
    const joined = other.from === seg.from || other.from === seg.to || other.to === seg.from || other.to === seg.to
    if (joined && Math.abs(lateral) < SAME_TRACK / 2) continue
    if (!lateralOf.some((known) => Math.abs(known - lateral) < SAME_TRACK)) lateralOf.push(lateral)
  }
  if (lateralOf.length === 0) return 0
  if (lateralOf.length > 1) return 2
  const lateral = lateralOf[0]
  if (Math.abs(lateral) < spacing.min || Math.abs(lateral) > spacing.max) return 2
  return lateral > 0 ? 1 : -1
}

/** Cells of the grid the rails are looked up by, m: a look reaches the cells around the one of the place */
const CELL = 25
/** A rail is noted in the cell of each of its points this far apart, m */
const NOTE_STEP = 10

/** One number per cell (the cells of a network 4 000 km across stay apart) */
function cellKey(cx: number, cy: number): number {
  return (cx + 100_000) * 200_000 + (cy + 100_000)
}

/**
 * The rails by where they pass, made once for the pass of `inferKeepLeft`: the network is not
 * changed meanwhile, and its own index is checked against the whole network at every look in the tests.
 */
class RailGrid {
  readonly ends = new Map<SegmentId, SegmentEnds>()
  readonly lengths = new Map<SegmentId, number>()
  readonly boxes = new Map<SegmentId, ReturnType<typeof shapeBounds>>()
  private readonly cells = new Map<number, Segment[]>()

  constructor(net: Network) {
    for (const seg of net.segments.values()) {
      const ends = segmentEnds(net, seg)
      if (!ends) continue
      const length = segmentShapeLength(net, seg)
      this.ends.set(seg.id, ends)
      this.lengths.set(seg.id, length)
      this.boxes.set(seg.id, shapeBounds(ends))
      const steps = Math.max(1, Math.ceil(length / NOTE_STEP))
      const noted = new Set<number>()
      for (let i = 0; i <= steps; i++) {
        const q = pointOnShape(ends, i / steps)
        const key = cellKey(Math.floor(q.x / CELL), Math.floor(q.y / CELL))
        if (noted.has(key)) continue
        noted.add(key)
        const list = this.cells.get(key)
        if (list) list.push(seg)
        else this.cells.set(key, [seg])
      }
    }
  }

  /** The rails that may pass within a cell of `p` */
  near(p: Point): Set<Segment> {
    const cx = Math.floor(p.x / CELL)
    const cy = Math.floor(p.y / CELL)
    const found = new Set<Segment>()
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const seg of this.cells.get(cellKey(cx + dx, cy + dy)) ?? []) found.add(seg)
      }
    }
    return found
  }
}
