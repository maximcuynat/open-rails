import type { Network, NodeId, RunningDirection, Segment } from './types'
import type { RailReplacement } from './trackObjects'
import { touchNetwork } from './networkWatch'

// ─────────────────── Normal direction of running ───────────────────
//
// On a double line each track is run one way: to the left in France (`Segment.running`, relative
// to the rail's `from` → `to`). It is read from OpenStreetMap (`railway:preferred_direction`) or
// worked out from the geometry (`services/runningDirection.ts`), carried by `replaceRail` when a
// rail is cut or merged, and paid for by the path search (`runningToll`): a cost, never a ban.

/** The other direction */
export function flipRunning(running: RunningDirection): RunningDirection {
  return running === 'forward' ? 'backward' : 'forward'
}

/**
 * True when running `seg` towards its `to` end (`forward`) or its `from` end goes against its
 * normal direction; false on a rail without one.
 */
export function runsAgainst(seg: Segment, forward: boolean): boolean {
  if (!seg.running) return false
  return (seg.running === 'forward') !== forward
}

/** Whether the normal direction of `seg` enters `nodeId` (1), leaves it (-1), or there is none (0) */
function runningAt(seg: Segment, nodeId: NodeId): number {
  if (!seg.running) return 0
  const towardsTo = seg.running === 'forward'
  return (seg.to === nodeId) === towardsTo ? 1 : -1
}

/**
 * True when the two rails meeting at `nodeId` carry the same normal direction on through it
 * (one enters the node where the other leaves it), or both have none.
 */
export function runningCarriesOn(a: Segment, b: Segment, nodeId: NodeId): boolean {
  const ra = runningAt(a, nodeId)
  const rb = runningAt(b, nodeId)
  return ra === 0 ? rb === 0 : ra === -rb
}

/**
 * Hand the normal direction of a replaced rail to its pieces (called by `replaceRail`): a piece
 * laid the other way gets it flipped. A piece that already has one keeps its own (a rail that
 * already lay there, or the first of two merged rails).
 */
export function remapRunning(net: Network, replacement: RailReplacement): void {
  const running = replacement.running
  if (!running) return
  for (const piece of replacement.pieces) {
    const seg = net.segments.get(piece.segId)
    if (!seg || seg.running) continue
    // `start` > `end`: the piece runs against the old rail
    const sameWay = piece.start < piece.end || (piece.start === piece.end && piece.from <= piece.to)
    seg.running = sameWay ? running : flipRunning(running)
    touchNetwork(net, seg.id)
  }
}

/** Set (or clear, with undefined) the normal direction of a rail. Returns true when it changed. */
export function setRunning(net: Network, seg: Segment, running: RunningDirection | undefined): boolean {
  if (seg.running === running) return false
  if (running === undefined) delete seg.running
  else seg.running = running
  touchNetwork(net, seg.id)
  return true
}
