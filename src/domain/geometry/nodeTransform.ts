import type { Network, NodeId, Point, SegmentId } from '../models/types'
import { touchNetwork } from '../models/networkWatch'
import { viaFromArc, viaFromTwoTangents } from './tangent'

export type NodeTransform =
  | { kind: 'translate'; delta: Point }
  | { kind: 'rotate'; center: Point; angleRad: number }

/**
 * Initial control points of every curve a move of `nodeIds` can modify:
 * all curve segments with at least one end in the set.
 */
export function collectAffectedVias(net: Network, nodeIds: Iterable<NodeId>): Map<SegmentId, Point> {
  const vias = new Map<SegmentId, Point>()
  for (const nid of nodeIds) {
    for (const sid of net.adjacency.get(nid) ?? []) {
      const seg = net.segments.get(sid)
      if (seg && seg.kind === 'curve' && seg.via) vias.set(sid, { ...seg.via })
    }
  }
  return vias
}

function rotateAround(p: Point, center: Point, angleRad: number): Point {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  const dx = p.x - center.x
  const dy = p.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

function unit(from: Point, to: Point): Point | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  return len > 1e-12 ? { x: dx / len, y: dy / len } : null
}

/**
 * Apply a move to a set of nodes and keep the curves attached to them coherent.
 * Always computed from the initial snapshot (`initialNodes`, `initialVias`), never incrementally.
 *
 * - Curve with both ends moved: its control point gets the same rigid transform.
 * - Curve with one end moved: the tangent at the fixed end (from the snapshot) is kept and the
 *   control point is refitted as an arc through the moved end.
 * - Rotation of a single node: the node stays in place and the track direction through it is
 *   rotated; each adjacent curve gets the intersection of the rotated tangent with the tangent
 *   preserved at its far end. Straight segments are left untouched.
 *
 * When a refit has no valid solution (parallel tangents, control point behind an endpoint)
 * the segment keeps the last control point written to the network.
 */
export function applyNodeTransform(
  net: Network,
  initialNodes: Map<NodeId, Point>,
  initialVias: Map<SegmentId, Point>,
  transform: NodeTransform,
): void {
  const map = (p: Point): Point =>
    transform.kind === 'translate'
      ? { x: p.x + transform.delta.x, y: p.y + transform.delta.y }
      : rotateAround(p, transform.center, transform.angleRad)

  const pivotOnly = transform.kind === 'rotate' && initialNodes.size === 1

  if (!pivotOnly) {
    for (const [nid, initPos] of initialNodes) {
      const node = net.nodes.get(nid)
      if (!node) continue
      const moved = map(initPos)
      node.pos.x = moved.x
      node.pos.y = moved.y
    }
  }

  for (const [sid, initVia] of initialVias) {
    const seg = net.segments.get(sid)
    if (!seg || !seg.via) continue
    const fromMoved = initialNodes.has(seg.from)
    const toMoved = initialNodes.has(seg.to)
    if (!fromMoved && !toMoved) continue

    if (fromMoved && toMoved) {
      const via = map(initVia)
      seg.via.x = via.x
      seg.via.y = via.y
      continue
    }

    const movedId = fromMoved ? seg.from : seg.to
    const fixedNode = net.nodes.get(fromMoved ? seg.to : seg.from)
    const movedNode = net.nodes.get(movedId)
    const movedInit = initialNodes.get(movedId)
    if (!fixedNode || !movedNode || !movedInit) continue

    // Tangent at the fixed end, heading into the curve, as it was before the move
    const fixedTan = unit(fixedNode.pos, initVia)
    if (!fixedTan) continue

    let via: Point
    if (pivotOnly) {
      const angle = transform.kind === 'rotate' ? transform.angleRad : 0
      const initTan = unit(movedInit, initVia)
      if (!initTan) continue
      const pivotTan = rotateAround(initTan, { x: 0, y: 0 }, angle)
      if (Math.abs(pivotTan.x * fixedTan.y - pivotTan.y * fixedTan.x) < 1e-6) continue
      // via = pivot + a·pivotTan = fixed + b·fixedTan
      via = viaFromTwoTangents(movedNode.pos, fixedNode.pos, pivotTan, { x: -fixedTan.x, y: -fixedTan.y })
      const a = (via.x - movedNode.pos.x) * pivotTan.x + (via.y - movedNode.pos.y) * pivotTan.y
      if (a <= 1e-9) continue
    } else if (Math.hypot(movedNode.pos.x - movedInit.x, movedNode.pos.y - movedInit.y) < 1e-12) {
      via = initVia
    } else {
      via = viaFromArc(fixedNode.pos, movedNode.pos, fixedTan)
    }

    // The control point must stay in front of the fixed end, otherwise the curve folds into a cusp
    const b = (via.x - fixedNode.pos.x) * fixedTan.x + (via.y - fixedNode.pos.y) * fixedTan.y
    if (b <= 1e-9) continue

    seg.via.x = via.x
    seg.via.y = via.y
  }
  if (!pivotOnly) for (const nid of initialNodes.keys()) touchNetwork(net, nid)
  for (const sid of initialVias.keys()) touchNetwork(net, sid)
}
