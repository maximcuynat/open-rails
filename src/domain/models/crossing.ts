import type { Network, NodeId, Point, Segment, SegmentId } from './types'
import { invalidateJunctionIndex } from './routing'
import { addNode, levelsMeet, nodeLevel, segmentHeightAt, setNodesLevel, MAX_LEVEL, MIN_LEVEL } from './network'
import { discretizeCurve } from '../geometry/curve'
import { segmentTangentAt } from '../geometry/tangent'
import { GAUGE } from '../profiles/profiles'

/**
 * Shallowest angle (degrees) at which two tracks crossing each other are reported as a diamond.
 * Reconcile makes a crossing node wherever two tracks intersect, whatever the angle, and trains
 * run straight through it; below this the frog geometry degenerates (the rails are almost parallel).
 */
export const MIN_CROSSING_ANGLE_DEG = 1

const MIN_CROSSING_SIN = Math.sin((MIN_CROSSING_ANGLE_DEG * Math.PI) / 180)

/**
 * The one test for "these two track directions cross" (any lengths): reconcile makes a node when it
 * holds, and a geometric intersection without a node is reported as a crossing only when it holds
 * with `margin` to spare, so that rounding at the limit cannot make the two disagree.
 */
export function isCrossingAngle(d1: Point, d2: Point, margin = 0): boolean {
  const l1 = Math.hypot(d1.x, d1.y)
  const l2 = Math.hypot(d2.x, d2.y)
  if (l1 < 1e-12 || l2 < 1e-12) return false
  return Math.abs(d1.x * d2.y - d1.y * d2.x) / (l1 * l2) >= MIN_CROSSING_SIN * (1 + margin)
}

export interface DiamondCrossing {
  id: string
  center: Point
  angleDeg: number
  angleRad: number
  track1Dir: Point
  track2Dir: Point
  seg1Id: string
  seg2Id: string
  nodeId?: string
  frogs: {
    p1: Point // rail 1A x rail 2A
    p2: Point // rail 1A x rail 2B
    p3: Point // rail 1B x rail 2A
    p4: Point // rail 1B x rail 2B
  }
  radius: number
}

/**
 * Solve 2D line intersection between:
 * P1 + t * D1 and P2 + s * D2
 */
export function lineLineIntersection(p1: Point, d1: Point, p2: Point, d2: Point): Point | null {
  const det = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(det) < 1e-6) return null
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const t = (dx * d2.y - dy * d2.x) / det
  return {
    x: p1.x + t * d1.x,
    y: p1.y + t * d1.y,
  }
}

/**
 * Compute the 4 rail frog intersection points for a crossing of gauge G
 * centered at C with unit directions u1 and u2.
 */
export function computeCrossingFrogs(
  center: Point,
  u1: Point,
  u2: Point,
  gauge: number = GAUGE,
): { p1: Point; p2: Point; p3: Point; p4: Point } | null {
  const hg = gauge / 2
  const n1 = { x: -u1.y, y: u1.x }
  const n2 = { x: -u2.y, y: u2.x }

  // Track 1 rails
  const r1A = { x: center.x + n1.x * hg, y: center.y + n1.y * hg }
  const r1B = { x: center.x - n1.x * hg, y: center.y - n1.y * hg }

  // Track 2 rails
  const r2A = { x: center.x + n2.x * hg, y: center.y + n2.y * hg }
  const r2B = { x: center.x - n2.x * hg, y: center.y - n2.y * hg }

  const p1 = lineLineIntersection(r1A, u1, r2A, u2)
  const p2 = lineLineIntersection(r1A, u1, r2B, u2)
  const p3 = lineLineIntersection(r1B, u1, r2A, u2)
  const p4 = lineLineIntersection(r1B, u1, r2B, u2)

  if (!p1 || !p2 || !p3 || !p4) return null
  return { p1, p2, p3, p4 }
}

/**
 * Test intersection between two line segments (p1 -> p2) and (p3 -> p4).
 * Returns intersection point and parameters (t1, t2) if they cross in interior [0.03, 0.97].
 */
export function intersectSegments(
  p1: Point,
  p2: Point,
  p3: Point,
  p4: Point,
): { point: Point; t1: number; t2: number } | null {
  const d1x = p2.x - p1.x
  const d1y = p2.y - p1.y
  const d2x = p4.x - p3.x
  const d2y = p4.y - p3.y

  const det = d1x * d2y - d1y * d2x
  if (Math.abs(det) < 1e-6) return null

  const dx = p3.x - p1.x
  const dy = p3.y - p1.y

  const t1 = (dx * d2y - dy * d2x) / det
  const t2 = (dx * d1y - dy * d1x) / det

  if (t1 >= 0.03 && t1 <= 0.97 && t2 >= 0.03 && t2 <= 0.97) {
    return {
      point: { x: p1.x + t1 * d1x, y: p1.y + t1 * d1y },
      t1,
      t2,
    }
  }
  return null
}

type ThroughTrack = [Segment, Segment]

/**
 * The two through tracks of a degree-4 node: its four rails paired by opposite directions (their
 * tangents at the node, so that a curve pairs with its own continuation and not with its chord).
 * `dirs` is the direction in which the first rail of each track leaves the node.
 * Null when the node is not an X of two tracks running through.
 */
export function throughTracksAtNode(
  net: Network,
  nodeId: NodeId,
): { tracks: [ThroughTrack, ThroughTrack]; dirs: [Point, Point] } | null {
  const adj = net.adjacency.get(nodeId) ?? []
  if (adj.length !== 4) return null
  const segs = adj.map((id) => net.segments.get(id)).filter((s): s is Segment => !!s)
  if (segs.length !== 4) return null

  const dirs: Point[] = []
  for (const s of segs) {
    const tan = segmentTangentAt(net, s, nodeId)
    if (!tan) return null
    dirs.push(s.from === nodeId ? tan : { x: -tan.x, y: -tan.y })
  }

  // Pair directions that are roughly opposite (dot product close to -1)
  let partner = -1
  let minDot = 1
  for (let j = 1; j < 4; j++) {
    const dot = dirs[0].x * dirs[j].x + dirs[0].y * dirs[j].y
    if (dot < minDot) {
      minDot = dot
      partner = j
    }
  }
  if (partner < 0 || minDot >= -0.7) return null
  const [r0, r1] = [1, 2, 3].filter((idx) => idx !== partner)
  if (dirs[r0].x * dirs[r1].x + dirs[r0].y * dirs[r1].y >= -0.7) return null

  return {
    tracks: [
      [segs[0], segs[partner]],
      [segs[r0], segs[r1]],
    ],
    dirs: [dirs[0], dirs[r0]],
  }
}

/**
 * Turn a level crossing into a bridge. `nodeId` is a degree-4 node where two tracks run through;
 * the one that `segmentId` belongs to is given the height `level` there, the other one stays at the
 * height of the node. The two tracks stop sharing a node: the upper one is moved onto a twin node
 * at the same place, which carries its height, and the original node keeps the lower track and its
 * height. The rails keep their ids and their shape (trains on them do not move), and reconcile
 * leaves the two stacked nodes apart for as long as their heights are LEVEL_CLEARANCE apart.
 * Returns the twin node id, or null when nothing was done: the node is not such a crossing,
 * `segmentId` does not end there, or `level` (clamped to MIN_LEVEL…MAX_LEVEL) is still within
 * LEVEL_CLEARANCE of the height of the node — the tracks would still meet.
 */
export function separateLevelsAtNode(
  net: Network,
  nodeId: NodeId,
  segmentId: SegmentId,
  level: number,
): NodeId | null {
  const node = net.nodes.get(nodeId)
  const through = node && throughTracksAtNode(net, nodeId)
  if (!node || !through) return null
  const leaving = through.tracks.find((track) => track.some((seg) => seg.id === segmentId))
  if (!leaving) return null
  const staying = through.tracks[0] === leaving ? through.tracks[1] : through.tracks[0]
  const target = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level))
  const current = nodeLevel(node)
  if (levelsMeet(target, current)) return null

  // The twin always carries the upper track, whichever of the two is the one changing height
  const upper = target > current ? leaving : staying
  const twin = addNode(net, node.pos, Math.max(target, current))
  setNodesLevel(net, [nodeId], Math.min(target, current))
  const stay = net.adjacency.get(nodeId)!
  for (const seg of upper) {
    if (seg.from === nodeId) seg.from = twin.id
    if (seg.to === nodeId) seg.to = twin.id
    stay.splice(stay.indexOf(seg.id), 1)
    net.adjacency.get(twin.id)!.push(seg.id)
  }

  // A plain node is left on each track: no points here any more. The tables at the far end of the
  // moved rails name rails, so they need nothing.
  for (const junc of [...net.junctions.values()]) {
    if (junc.nodeId === nodeId) net.junctions.delete(junc.id)
  }
  invalidateJunctionIndex(net)
  return twin.id
}

/**
 * Automatically inspect the network to detect railway crossings (diamond crossings):
 * 1. Geometric intersections between distinct segments that cross each other.
 * 2. Degree-4 nodes that represent an X-crossing of two through tracks.
 */
export function detectCrossings(net: Network, candidateSegments?: Segment[]): DiamondCrossing[] {
  const crossings: DiamondCrossing[] = []
  const crossingCenters: Point[] = []

  const isDuplicate = (pt: Point, tol = 10) => {
    for (const c of crossingCenters) {
      if (Math.hypot(c.x - pt.x, c.y - pt.y) < tol) return true
    }
    return false
  }

  // 1. Check degree-4 nodes
  for (const node of net.nodes.values()) {
    const adj = net.adjacency.get(node.id) ?? []
    if (adj.length === 4) {
      const through = throughTracksAtNode(net, node.id)
      if (through) {
        const { tracks, dirs } = through
        // Found two through lines crossing at node.pos (one node: they are at the same height there)
        const u1 = dirs[0]
        const u2 = dirs[1]
        const dot12 = Math.abs(u1.x * u2.x + u1.y * u2.y)
        const angleRad = Math.acos(Math.min(1, Math.max(0, dot12)))
        const angleDeg = (angleRad * 180) / Math.PI

        // The node exists: reconcile has already judged the angle
        if (angleDeg > 0 && angleDeg <= 90) {
          const frogs = computeCrossingFrogs(node.pos, u1, u2)
          if (frogs) {
            const r = Math.max(
              Math.hypot(frogs.p1.x - node.pos.x, frogs.p1.y - node.pos.y),
              Math.hypot(frogs.p2.x - node.pos.x, frogs.p2.y - node.pos.y),
            )
            crossings.push({
              id: `cross-node-${node.id}`,
              center: node.pos,
              angleDeg,
              angleRad,
              track1Dir: u1,
              track2Dir: u2,
              seg1Id: tracks[0][0].id,
              seg2Id: tracks[1][0].id,
              nodeId: node.id,
              frogs,
              radius: r + 15,
            })
            crossingCenters.push(node.pos)
          }
        }
      }
    }
  }

  // 2. Check geometric intersections between distinct segments
  const segList = candidateSegments ?? Array.from(net.segments.values())
  for (let i = 0; i < segList.length; i++) {
    for (let j = i + 1; j < segList.length; j++) {
      const s1 = segList[i]
      const s2 = segList[j]

      // Skip segments sharing an endpoint
      if (s1.from === s2.from || s1.from === s2.to || s1.to === s2.from || s1.to === s2.to) continue

      const n1A = net.nodes.get(s1.from)
      const n1B = net.nodes.get(s1.to)
      const n2A = net.nodes.get(s2.from)
      const n2B = net.nodes.get(s2.to)
      if (!n1A || !n1B || !n2A || !n2B) continue

      // Fast AABB pre-check before expensive curve discretization
      const s1MinX = Math.min(n1A.pos.x, n1B.pos.x, s1.via ? s1.via.x : Infinity)
      const s1MaxX = Math.max(n1A.pos.x, n1B.pos.x, s1.via ? s1.via.x : -Infinity)
      const s1MinY = Math.min(n1A.pos.y, n1B.pos.y, s1.via ? s1.via.y : Infinity)
      const s1MaxY = Math.max(n1A.pos.y, n1B.pos.y, s1.via ? s1.via.y : -Infinity)

      const s2MinX = Math.min(n2A.pos.x, n2B.pos.x, s2.via ? s2.via.x : Infinity)
      const s2MaxX = Math.max(n2A.pos.x, n2B.pos.x, s2.via ? s2.via.x : -Infinity)
      const s2MinY = Math.min(n2A.pos.y, n2B.pos.y, s2.via ? s2.via.y : Infinity)
      const s2MaxY = Math.max(n2A.pos.y, n2B.pos.y, s2.via ? s2.via.y : -Infinity)

      if (s1MaxX < s2MinX || s1MinX > s2MaxX || s1MaxY < s2MinY || s1MinY > s2MaxY) {
        continue
      }

      // Discretize polyline for s1 and s2
      const pts1 = s1.kind === 'curve' && s1.via ? discretizeCurve(n1A.pos, s1.via, n1B.pos, 16) : [n1A.pos, n1B.pos]
      const pts2 = s2.kind === 'curve' && s2.via ? discretizeCurve(n2A.pos, s2.via, n2B.pos, 16) : [n2A.pos, n2B.pos]

      let foundCrossing: { point: Point; dir1: Point; dir2: Point } | null = null

      for (let a = 0; a < pts1.length - 1; a++) {
        for (let b = 0; b < pts2.length - 1; b++) {
          const res = intersectSegments(pts1[a], pts1[a + 1], pts2[b], pts2[b + 1])
          // One passes over the other where they intersect: a bridge, not a crossing
          if (
            res &&
            levelsMeet(
              segmentHeightAt(net, s1, (a + res.t1) / (pts1.length - 1)),
              segmentHeightAt(net, s2, (b + res.t2) / (pts2.length - 1)),
            )
          ) {
            const d1x = pts1[a + 1].x - pts1[a].x
            const d1y = pts1[a + 1].y - pts1[a].y
            const l1 = Math.hypot(d1x, d1y)
            const d2x = pts2[b + 1].x - pts2[b].x
            const d2y = pts2[b + 1].y - pts2[b].y
            const l2 = Math.hypot(d2x, d2y)

            if (l1 > 0 && l2 > 0) {
              foundCrossing = {
                point: res.point,
                dir1: { x: d1x / l1, y: d1y / l1 },
                dir2: { x: d2x / l2, y: d2y / l2 },
              }
              break
            }
          }
        }
        if (foundCrossing) break
      }

      if (foundCrossing && !isDuplicate(foundCrossing.point)) {
        const u1 = foundCrossing.dir1
        const u2 = foundCrossing.dir2
        const dot = Math.abs(u1.x * u2.x + u1.y * u2.y)
        const angleRad = Math.acos(Math.min(1, Math.max(0, dot)))
        const angleDeg = (angleRad * 180) / Math.PI

        // No node here: only what reconcile would certainly turn into one
        if (isCrossingAngle(u1, u2, 1e-6) && angleDeg <= 90) {
          const frogs = computeCrossingFrogs(foundCrossing.point, u1, u2)
          if (frogs) {
            const r = Math.max(
              Math.hypot(frogs.p1.x - foundCrossing.point.x, frogs.p1.y - foundCrossing.point.y),
              Math.hypot(frogs.p2.x - foundCrossing.point.x, frogs.p2.y - foundCrossing.point.y),
            )
            crossings.push({
              id: `cross-${s1.id}-${s2.id}`,
              center: foundCrossing.point,
              angleDeg,
              angleRad,
              track1Dir: u1,
              track2Dir: u2,
              seg1Id: s1.id,
              seg2Id: s2.id,
              frogs,
              radius: r + 15,
            })
            crossingCenters.push(foundCrossing.point)
          }
        }
      }
    }
  }

  return crossings
}
