import type { Network, NodeId, SegmentId, Point, Segment } from '../models/types'
import { segmentTangentAt } from '../geometry/tangent'

export type KinematicIssueKind =
  | 'sharp_turn'          // Angle cassé / aigu (> 35°) entre 2 rails sans continuité
  | 'invalid_turnout'     // 3 rails sans structure cohérente (pas de tronc + 2 branches)
  | 'opposing_facing'     // 2 aiguillages face-à-face à contre-sens immédiat
  | 'dead_end_conflict'   // Voie menant à une butée sans transition fluide

export interface KinematicIssue {
  id: string
  nodeId: NodeId
  kind: KinematicIssueKind
  severity: 'warning' | 'error'
  angleDeg?: number
  message: string
  involvedSegmentIds: SegmentId[]
}

/**
 * Normalized outgoing direction vector leaving `nodeId` along `seg`.
 */
export function getOutgoingTangent(net: Network, seg: Segment, nodeId: NodeId): Point | null {
  const tan = segmentTangentAt(net, seg, nodeId)
  if (!tan) return null
  // segmentTangentAt returns the tangent leaving `nodeId` if nodeId === seg.from,
  // or end tangent if nodeId === seg.to.
  // Note: For straight lines, segmentTangentAt returns (to - from).
  // If nodeId === seg.to, it's still (to - from), so leaving `to` going away from the segment would be reversed!
  // Let's verify: at nodeId, what is the vector directed INTO the segment (towards the other node)?
  const otherId = seg.from === nodeId ? seg.to : seg.from
  const otherNode = net.nodes.get(otherId)
  const thisNode = net.nodes.get(nodeId)
  if (!thisNode || !otherNode) return null

  if (seg.kind === 'straight' || !seg.via) {
    const dx = otherNode.pos.x - thisNode.pos.x
    const dy = otherNode.pos.y - thisNode.pos.y
    const len = Math.hypot(dx, dy)
    return len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 }
  }

  // For curve:
  // At from: tangent towards via
  // At to: tangent from to towards via (reversed end tangent)
  if (nodeId === seg.from) {
    const dx = seg.via.x - thisNode.pos.x
    const dy = seg.via.y - thisNode.pos.y
    const len = Math.hypot(dx, dy)
    return len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 }
  } else {
    const dx = seg.via.x - thisNode.pos.x
    const dy = seg.via.y - thisNode.pos.y
    const len = Math.hypot(dx, dy)
    return len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 }
  }
}

/**
 * Angle in degrees between two incoming track vectors at a junction node.
 * 0° means smooth continuation (180° opposite in world space, i.e. straight line through the node).
 * 180° means complete hairpin/fold-back (rails overlap in the same direction).
 */
export function computeTransitionAngleDeg(dir1: Point, dir2: Point): number {
  // dir1 points along seg1 away from node
  // dir2 points along seg2 away from node
  // For smooth continuation, dir1 + dir2 = 0, so dot = -1 => angle = 0°
  // For fold-back (sharp turn), dot = +1 => angle = 180°
  const dot = Math.max(-1, Math.min(1, dir1.x * dir2.x + dir1.y * dir2.y))
  // The deflection angle a train experiences is arccos(-dot):
  // When dot = -1 (straight line), deflection = arccos(1) = 0°
  // When dot = 0 (right angle), deflection = arccos(0) = 90°
  // When dot = 1 (hairpin V), deflection = arccos(-1) = 180°
  const deflectionRad = Math.acos(-dot)
  return (deflectionRad * 180) / Math.PI
}

/**
 * Scan the network and detect all kinematic and directional issues.
 */
export function analyzeKinematics(net: Network): KinematicIssue[] {
  const issues: KinematicIssue[] = []

  for (const node of net.nodes.values()) {
    const segIds = net.adjacency.get(node.id) ?? []
    if (segIds.length === 0) continue

    // Case 1: Simple 2-rail connection
    if (segIds.length === 2) {
      const s1 = net.segments.get(segIds[0])
      const s2 = net.segments.get(segIds[1])
      if (!s1 || !s2) continue

      const d1 = getOutgoingTangent(net, s1, node.id)
      const d2 = getOutgoingTangent(net, s2, node.id)
      if (!d1 || !d2) continue

      const deflection = computeTransitionAngleDeg(d1, d2)
      // If deflection > 30°, this is an impossible railway curve without turnout/diamond crossing
      if (deflection > 30) {
        issues.push({
          id: `sharp-${node.id}`,
          nodeId: node.id,
          kind: 'sharp_turn',
          severity: deflection > 45 ? 'error' : 'warning',
          angleDeg: Math.round(deflection),
          message: `Angle de raccordement cassé (${Math.round(deflection)}°) : risque de déraillement ou rebroussement forcé`,
          involvedSegmentIds: [s1.id, s2.id],
        })
      }
    }

    // Case 2: 3-rail intersection (turnout candidate)
    else if (segIds.length === 3) {
      const segs = segIds.map(id => net.segments.get(id)).filter((s): s is Segment => !!s)
      if (segs.length !== 3) continue

      const dirs = segs.map(s => getOutgoingTangent(net, s, node.id))
      if (dirs.some(d => !d)) continue

      const d0 = dirs[0]!
      const d1 = dirs[1]!
      const d2 = dirs[2]!

      const def01 = computeTransitionAngleDeg(d0, d1)
      const def02 = computeTransitionAngleDeg(d0, d2)
      const def12 = computeTransitionAngleDeg(d1, d2)

      // In a valid railway turnout:
      // Exactly ONE pair forms a smooth through route (deflection <= 20°)
      // Exactly ONE pair forms a diverging branch (deflection <= 30°)
      // The remaining pair is the two diverging branches facing each other (deflection between them should be small too)
      const deflections = [
        { pair: [0, 1] as [number, number], def: def01 },
        { pair: [0, 2] as [number, number], def: def02 },
        { pair: [1, 2] as [number, number], def: def12 },
      ].sort((a, b) => a.def - b.def)

      const bestThrough = deflections[0]
      const secondRoute = deflections[1]

      // If even the best through route has a deflection > 25°, no straight/main route exists!
      if (bestThrough.def > 25) {
        issues.push({
          id: `turnout-inval-${node.id}`,
          nodeId: node.id,
          kind: 'invalid_turnout',
          severity: 'error',
          angleDeg: Math.round(bestThrough.def),
          message: `Jonction à 3 voies incohérente : aucun axe traversant naturel (déviation minimale ${Math.round(bestThrough.def)}°)`,
          involvedSegmentIds: segIds,
        })
      } else if (secondRoute.def > 35) {
        // The diverging route is too sharp for normal railway practice
        issues.push({
          id: `turnout-sharp-${node.id}`,
          nodeId: node.id,
          kind: 'sharp_turn',
          severity: 'warning',
          angleDeg: Math.round(secondRoute.def),
          message: `Aiguillage avec déviation excessive (${Math.round(secondRoute.def)}°)`,
          involvedSegmentIds: segIds,
        })
      }
    }

    // Case 3: 4-rail intersection (croisement / traversée à niveau en X ou convergence)
    else if (segIds.length === 4) {
      const segs = segIds.map(id => net.segments.get(id)).filter((s): s is Segment => !!s)
      if (segs.length === 4) {
        const dirs = segs.map(s => getOutgoingTangent(net, s, node.id))
        if (!dirs.some(d => !d)) {
          let pairA2 = -1, minDotA = 1
          for (let j = 1; j < 4; j++) {
            const dj = dirs[j]!
            const dot = dirs[0]!.x * dj.x + dirs[0]!.y * dj.y
            if (dot < minDotA) {
              minDotA = dot
              pairA2 = j
            }
          }

          if (pairA2 > 0 && minDotA < -0.65) {
            const remaining = [1, 2, 3].filter(idx => idx !== pairA2)
            const dotB = dirs[remaining[0]]!.x * dirs[remaining[1]]!.x + dirs[remaining[0]]!.y * dirs[remaining[1]]!.y
            if (dotB < -0.65) {
              // C'est une vraie traversée oblique ou orthogonale en X :
              // chaque ligne continue tout droit sans changer de voie. C'est parfaitement franchissable !
              continue
            }
          }
        }
      }

      issues.push({
        id: `excess-rails-${node.id}`,
        nodeId: node.id,
        kind: 'invalid_turnout',
        severity: 'warning',
        message: `Convergence anormale de 4 voies sans alignement traversant cohérent`,
        involvedSegmentIds: segIds,
      })
    }

    // Case 4: Plus de 4 rails
    else if (segIds.length > 4) {
      issues.push({
        id: `excess-rails-${node.id}`,
        nodeId: node.id,
        kind: 'invalid_turnout',
        severity: 'warning',
        message: `Convergence anormale de ${segIds.length} voies sur un même nœud`,
        involvedSegmentIds: segIds,
      })
    }
  }

  return issues
}
