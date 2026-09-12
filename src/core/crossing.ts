import type { Network, Point, Segment } from './types'
import { discretizeCurve } from './curve'
import { GAUGE } from '../render/renderer'

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
      const segs = adj.map((id) => net.segments.get(id)).filter((s): s is Segment => !!s)
      if (segs.length !== 4) continue

      // Compute normalized direction away from node for each segment
      const dirs: Point[] = []
      for (const s of segs) {
        const otherId = s.from === node.id ? s.to : s.from
        const other = net.nodes.get(otherId)
        if (!other) continue
        const dx = other.pos.x - node.pos.x
        const dy = other.pos.y - node.pos.y
        const l = Math.hypot(dx, dy)
        dirs.push(l > 0 ? { x: dx / l, y: dy / l } : { x: 1, y: 0 })
      }
      if (dirs.length !== 4) continue

      // Pair directions that are roughly opposite (dot product close to -1)
      let pairA1 = 0,
        pairA2 = -1,
        minDotA = 1
      for (let j = 1; j < 4; j++) {
        const dot = dirs[0].x * dirs[j].x + dirs[0].y * dirs[j].y
        if (dot < minDotA) {
          minDotA = dot
          pairA2 = j
        }
      }

      if (pairA2 > 0 && minDotA < -0.7) {
        const remaining = [1, 2, 3].filter((idx) => idx !== pairA2)
        const dotB = dirs[remaining[0]].x * dirs[remaining[1]].x + dirs[remaining[0]].y * dirs[remaining[1]].y
        if (dotB < -0.7) {
          // Found two through lines crossing at node.pos!
          const u1 = dirs[pairA1]
          const u2 = dirs[remaining[0]]
          const dot12 = Math.abs(u1.x * u2.x + u1.y * u2.y)
          const angleRad = Math.acos(Math.min(1, Math.max(0, dot12)))
          const angleDeg = (angleRad * 180) / Math.PI

          if (angleDeg >= 8 && angleDeg <= 90) {
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
                seg1Id: segs[pairA1].id,
                seg2Id: segs[remaining[0]].id,
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
          if (res) {
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

        if (angleDeg >= 8 && angleDeg <= 90) {
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
