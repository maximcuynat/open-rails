import type { Network, NodeId, SegmentId, Point, Segment } from '../models/types'
import { segmentTangentAt, MAX_TRANSITION_DEFLECTION_DEG } from '../geometry/tangent'
import { placementThresholds } from '../geometry/scale'
import { touchingLater } from '../geometry/spatialGrid'
import { segmentEndLevels, segmentGradient } from '../models/network'

export type KinematicIssueKind =
  | 'sharp_turn'          // Angle cassé (> MAX_TRANSITION_DEFLECTION_DEG) entre 2 rails sans continuité
  | 'invalid_turnout'     // 3 rails sans structure cohérente (pas de tronc + 2 branches)
  | 'opposing_facing'     // 2 aiguillages face-à-face à contre-sens immédiat
  | 'dead_end_conflict'   // Voie menant à une butée sans transition fluide
  | 'track_gap'           // 2 extrémités de voie face à face, proches mais non raccordées
  | 'steep_gradient'      // Rampe plus raide que la pente maximale du projet

export interface KinematicIssue {
  id: string
  nodeId: NodeId
  kind: KinematicIssueKind
  severity: 'warning' | 'error'
  angleDeg?: number
  /** For 'track_gap': distance in meters between the two rail ends */
  gapMeters?: number
  /** For 'steep_gradient': slope of the rail in ‰ (always positive) */
  gradientPermille?: number
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
 * Open rail ends that face each other closer than the heal tolerance without being joined:
 * the automatic weld (reconcile tolerance) leaves them apart, so a train stops at the gap.
 * One issue is reported on each of the two ends.
 */
function detectTrackGaps(net: Network, gauge?: number): KinematicIssue[] {
  const issues: KinematicIssue[] = []
  const { healTolerance } = placementThresholds(gauge)
  const minCos = Math.cos((MAX_TRANSITION_DEFLECTION_DEG * Math.PI) / 180)

  // Open ends with the direction in which their rail would carry on
  const ends: { nodeId: NodeId; pos: Point; segId: SegmentId; ahead: Point }[] = []
  for (const node of net.nodes.values()) {
    const segIds = net.adjacency.get(node.id) ?? []
    if (segIds.length !== 1) continue
    const seg = net.segments.get(segIds[0])
    const into = seg && getOutgoingTangent(net, seg, node.id)
    if (!seg || !into) continue
    ends.push({ nodeId: node.id, pos: node.pos, segId: seg.id, ahead: { x: -into.x, y: -into.y } })
  }

  // Only the ends within the heal tolerance of each other can face across a gap: they are found
  // on a grid, in the order a look at every pair would meet them
  const near = touchingLater(ends.map((end) => ({ minX: end.pos.x, maxX: end.pos.x, minY: end.pos.y, maxY: end.pos.y })), healTolerance)
  for (let i = 0; i < ends.length; i++) {
    for (const j of near(i)) {
      const a = ends[i]
      const b = ends[j]
      if (a.segId === b.segId) continue
      const dx = b.pos.x - a.pos.x
      const dy = b.pos.y - a.pos.y
      const gap = Math.hypot(dx, dy)
      if (gap <= 1e-9 || gap > healTolerance) continue
      // Facing: each end points at the other one, within the deflection a train could take
      const facingA = (a.ahead.x * dx + a.ahead.y * dy) / gap
      const facingB = -(b.ahead.x * dx + b.ahead.y * dy) / gap
      if (facingA < minCos || facingB < minCos) continue
      for (const [from, to] of [[a, b], [b, a]]) {
        issues.push({
          id: `gap-${from.nodeId}-${to.nodeId}`,
          nodeId: from.nodeId,
          kind: 'track_gap',
          severity: 'warning',
          gapMeters: gap,
          message: `Voie interrompue : cette extrémité fait face à une autre sans y être raccordée, le train s'arrête ici (touche R pour raccorder)`,
          involvedSegmentIds: [from.segId, to.segId],
        })
      }
    }
  }
  return issues
}

/** A slope in ‰ as shown to the user: one decimal at most, with a decimal comma */
const formatPermille = (permille: number): string => String(Math.round(permille * 10) / 10).replace('.', ',')

/** One issue per ramp steeper than the limit, reported at its lower end */
function detectSteepGradients(net: Network, limits: GradientLimits): KinematicIssue[] {
  const issues: KinematicIssue[] = []
  for (const seg of net.segments.values()) {
    const permille = Math.abs(segmentGradient(net, seg, limits.levelHeight))
    if (permille <= limits.maxGradient + 1e-6) continue
    const ends = segmentEndLevels(net, seg)
    issues.push({
      id: `steep-${seg.id}`,
      nodeId: ends.from <= ends.to ? seg.from : seg.to,
      kind: 'steep_gradient',
      severity: 'warning',
      // One decimal: a slope just over the limit must not read as the limit itself
      gradientPermille: Math.round(permille * 10) / 10,
      message: `Pente de ${formatPermille(permille)} ‰, au-delà du maximum de ${formatPermille(limits.maxGradient)} ‰`,
      involvedSegmentIds: [seg.id],
    })
  }
  return issues
}

/** What a slope is measured against: the height of one level (world metres) and the steepest slope allowed (‰) */
export interface GradientLimits {
  levelHeight: number
  maxGradient: number
}

/**
 * Scan the network and detect all kinematic and directional issues.
 * `gauge` scales the distance under which two facing rail ends are reported as a gap.
 * `gradient` turns on the report of ramps steeper than the project allows.
 */
export function analyzeKinematics(net: Network, gauge?: number, gradient?: GradientLimits): KinematicIssue[] {
  const issues: KinematicIssue[] = detectTrackGaps(net, gauge)
  if (gradient) issues.push(...detectSteepGradients(net, gradient))
  const maxDeflection = MAX_TRANSITION_DEFLECTION_DEG + 1e-6

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

      const dot = Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y))

      // Check if both rails depart on the SAME side of the node (fork / incomplete turnout)
      if (dot > 0.7) {
        // Relative angle between the two departing branches
        const angleBetweenDeg = (Math.acos(dot) * 180) / Math.PI
        if (angleBetweenDeg > 35) {
          issues.push({
            id: `turnout-sharp-${node.id}`,
            nodeId: node.id,
            kind: 'sharp_turn',
            severity: 'warning',
            angleDeg: Math.round(angleBetweenDeg),
            message: `Bifurcation avec angle de déviation excessif (${Math.round(angleBetweenDeg)}°)`,
            involvedSegmentIds: [s1.id, s2.id],
          })
        } else {
          // A fork without a stem (turnout under construction): well-formed, but until the stem
          // is laid no train can pass from one branch to the other — both rails end here.
          issues.push({
            id: `fork-no-stem-${node.id}`,
            nodeId: node.id,
            kind: 'invalid_turnout',
            severity: 'warning',
            message: `Bifurcation sans tronc commun : les deux voies partent du même côté, aucun train ne peut passer de l'une à l'autre`,
            involvedSegmentIds: [s1.id, s2.id],
          })
        }
        continue
      }

      const deflection = computeTransitionAngleDeg(d1, d2)
      // Beyond the transition limit a train cannot pass: it is a corner, not a track joint
      if (deflection > maxDeflection) {
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

      // Check if all 3 rails depart on the same side (fan with no stem or continuous route)
      const dot01 = d0.x * d1.x + d0.y * d1.y
      const dot02 = d0.x * d2.x + d0.y * d2.y
      const dot12 = d1.x * d2.x + d1.y * d2.y
      if (dot01 > 0.5 && dot02 > 0.5 && dot12 > 0.5) {
        issues.push({
          id: `turnout-inval-${node.id}`,
          nodeId: node.id,
          kind: 'invalid_turnout',
          severity: 'error',
          angleDeg: 0,
          message: `Jonction à 3 voies incohérente : aucune voie continue ou tronc commun traversant`,
          involvedSegmentIds: segIds,
        })
        continue
      }

      const def01 = computeTransitionAngleDeg(d0, d1)
      const def02 = computeTransitionAngleDeg(d0, d2)
      const def12 = computeTransitionAngleDeg(d1, d2)

      // In a valid railway turnout:
      // Exactly ONE pair forms a smooth through route
      // Exactly ONE pair forms a diverging branch (both within the transition limit)
      // The remaining pair is the two diverging branches facing each other (deflection between them should be small too)
      const deflections = [
        { pair: [0, 1] as [number, number], def: def01 },
        { pair: [0, 2] as [number, number], def: def02 },
        { pair: [1, 2] as [number, number], def: def12 },
      ].sort((a, b) => a.def - b.def)

      const bestThrough = deflections[0]
      const secondRoute = deflections[1]

      // If even the best through route exceeds the transition limit, no straight/main route exists!
      if (bestThrough.def > maxDeflection) {
        issues.push({
          id: `turnout-inval-${node.id}`,
          nodeId: node.id,
          kind: 'invalid_turnout',
          severity: 'error',
          angleDeg: Math.round(bestThrough.def),
          message: `Jonction à 3 voies incohérente : aucun axe traversant naturel (déviation minimale ${Math.round(bestThrough.def)}°)`,
          involvedSegmentIds: segIds,
        })
      } else if (secondRoute.def > maxDeflection) {
        // The diverging route is a corner no train can take (e.g. a perpendicular T)
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

    // Case 3: 4-rail intersection (croisement / traversée à niveau en X ou aiguillage triple)
    else if (segIds.length === 4) {
      const segs = segIds.map(id => net.segments.get(id)).filter((s): s is Segment => !!s)
      if (segs.length === 4) {
        const dirs = segs.map(s => getOutgoingTangent(net, s, node.id))
        if (!dirs.some(d => !d)) {
          // 1. Check for Diamond Crossing (traversée en X : 2 paires opposées)
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

          // 2. Check for 3-way turnout (aiguillage triple : 1 tronc commun face à 3 branches déviées)
          let stemIdx = -1
          for (let i = 0; i < 4; i++) {
            const otherIndices = [0, 1, 2, 3].filter(k => k !== i)
            const allOpposite = otherIndices.every(k => {
              const dot = dirs[i]!.x * dirs[k]!.x + dirs[i]!.y * dirs[k]!.y
              return dot < -0.65
            })
            if (allOpposite) {
              const [b0, b1, b2] = otherIndices
              const d01 = dirs[b0]!.x * dirs[b1]!.x + dirs[b0]!.y * dirs[b1]!.y
              const d02 = dirs[b0]!.x * dirs[b2]!.x + dirs[b0]!.y * dirs[b2]!.y
              const d12 = dirs[b1]!.x * dirs[b2]!.x + dirs[b1]!.y * dirs[b2]!.y
              if (d01 > 0.5 && d02 > 0.5 && d12 > 0.5) {
                stemIdx = i
                break
              }
            }
          }

          if (stemIdx !== -1) {
            const otherIndices = [0, 1, 2, 3].filter(k => k !== stemIdx)
            const defs = otherIndices
              .map(k => computeTransitionAngleDeg(dirs[stemIdx]!, dirs[k]!))
              .sort((a, b) => a - b)

            const bestThrough = defs[0]
            const maxDeviation = defs[defs.length - 1]

            if (bestThrough > maxDeflection) {
              issues.push({
                id: `turnout-inval-${node.id}`,
                nodeId: node.id,
                kind: 'invalid_turnout',
                severity: 'error',
                angleDeg: Math.round(bestThrough),
                message: `Aiguillage triple incohérent : aucun axe traversant naturel (déviation minimale ${Math.round(bestThrough)}°)`,
                involvedSegmentIds: segIds,
              })
            } else if (maxDeviation > maxDeflection) {
              issues.push({
                id: `turnout-sharp-${node.id}`,
                nodeId: node.id,
                kind: 'sharp_turn',
                severity: 'warning',
                angleDeg: Math.round(maxDeviation),
                message: `Aiguillage triple avec déviation excessive (${Math.round(maxDeviation)}°)`,
                involvedSegmentIds: segIds,
              })
            }
            // Valid 3-way turnout!
            continue
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
