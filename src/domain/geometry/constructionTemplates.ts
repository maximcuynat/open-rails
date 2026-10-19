import type { Junction, Network, NodeId, PlatformEdge, Point, RailNode, SegmentId, TrackSpan } from '@domain/models/types'
import { addNode, addSegment, addCurveSegment, addArcCurve, hitSegment, nodeLevel, segmentHeightNear, spreadGradient } from '@domain/models/network'
import { splitSegment, declareBranchOff } from '@domain/models/junction'
import { getTangentForPlacement } from '@domain/geometry/tangent'
import { reconcileNetworkIntersections } from '@domain/geometry/reconcile'
import { touchNetwork } from '../models/networkWatch'
import { railsWithin } from './networkFollower'
import { scaleFactor } from './scale'
import { projectOnSegment, tangentOnSegment } from '../models/locomotive'
import { findJunctionAtNode } from '../models/routing'
import { tidyTrackSpans } from '../models/speedZones'
import { edgeLength, PLATFORM_WIDTH, platformDimensions, platformOutline, pointOnEdge, sideNormal } from '../models/platforms'
import { findTrackPathToAny } from '../services/trackPath'
import {
  facingEdge,
  islandReach,
  layPlatformGroup,
  projectOnRails,
  railsAlong,
  sideOf,
  trackAcross,
  type LaidPlatforms,
  type PlacedPoint,
} from '../services/platformLayout'

/**
 * Result of computing an auto-connect preview or application.
 */
export interface AutoConnectResult {
  kind: 'straight' | 'single-curve' | 's-curve'
  segments: Array<{
    from: Point
    to: Point
    via?: Point
    kind: 'straight' | 'curve'
  }>
  intermediateNodes: Point[]
}

/**
 * Compute the smoothest connection between two track endpoints (Node A and Node B).
 * Respects outgoing tangents at both nodes (C1 continuity).
 */
export function computeAutoConnectGeometry(
  net: Network,
  nodeAId: string,
  nodeBId: string,
): AutoConnectResult | null {
  const nodeA = net.nodes.get(nodeAId)
  const nodeB = net.nodes.get(nodeBId)
  if (!nodeA || !nodeB || nodeAId === nodeBId) return null

  const pA = nodeA.pos
  const pB = nodeB.pos
  const dx = pB.x - pA.x
  const dy = pB.y - pA.y
  const chordDist = Math.hypot(dx, dy)
  if (chordDist < 0.2) return null

  const chordDir = { x: dx / chordDist, y: dy / chordDist }

  // Outgoing tangent at A (heading away from track connected to A)
  const tA = getTangentForPlacement(net, nodeAId, pB) ?? chordDir
  // Incoming tangent at B (heading into B from connecting track, pointing away from B's connected track towards A)
  const tBRev = getTangentForPlacement(net, nodeBId, pA) ?? { x: -chordDir.x, y: -chordDir.y }
  // Tangent at B pointing in direction of travel from A to B:
  const tB = { x: -tBRev.x, y: -tBRev.y }

  // Dot product of tangents with chord
  const dotA = tA.x * chordDir.x + tA.y * chordDir.y
  const dotB = tB.x * chordDir.x + tB.y * chordDir.y
  const dotAB = tA.x * tB.x + tA.y * tB.y

  // Case 1: Almost perfectly straight and tangents aligned with chord
  if (dotA > 0.999 && dotB > 0.999) {
    return {
      kind: 'straight',
      segments: [{ from: pA, to: pB, kind: 'straight' }],
      intermediateNodes: [],
    }
  }

  // Case 2: Check if tangents intersect forward to form a single quadratic Bezier
  // Ray 1: pA + s * tA
  // Ray 2: pB - u * tB
  // pA + s * tA = pB - u * tB  =>  s * tA + u * tB = pB - pA
  const det = tA.x * tB.y - tA.y * tB.x
  if (Math.abs(det) > 1e-4) {
    const s = (dx * tB.y - dy * tB.x) / det
    const u = (tA.x * dy - tA.y * dx) / det

    // Single arc is valid if both rays proceed forward (s > 0 and u > 0)
    // and neither is excessively stretched compared to chord length
    if (s > 0.05 && u > 0.05 && s < chordDist * 2.5 && u < chordDist * 2.5 && dotAB > -0.6) {
      const via = { x: pA.x + s * tA.x, y: pA.y + s * tA.y }
      return {
        kind: 'single-curve',
        segments: [{ from: pA, to: pB, via, kind: 'curve' }],
        intermediateNodes: [],
      }
    }
  }

  // Case 3: S-curve (reverse curve) with smooth C1 transition midpoint
  // Place midpoint along chord, tangent at midpoint = chord direction blended with tangents
  const midPoint = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 }
  const tMid = chordDir

  // First curve: pA to midPoint
  const dx1 = midPoint.x - pA.x
  const dy1 = midPoint.y - pA.y
  const det1 = tA.x * tMid.y - tA.y * tMid.x
  let via1: Point
  if (Math.abs(det1) > 1e-4) {
    const s1 = (dx1 * tMid.y - dy1 * tMid.x) / det1
    if (s1 > 0 && s1 < chordDist) {
      via1 = { x: pA.x + s1 * tA.x, y: pA.y + s1 * tA.y }
    } else {
      via1 = { x: (pA.x + midPoint.x) / 2, y: (pA.y + midPoint.y) / 2 }
    }
  } else {
    via1 = { x: (pA.x + midPoint.x) / 2, y: (pA.y + midPoint.y) / 2 }
  }

  // Second curve: midPoint to pB
  const dx2 = pB.x - midPoint.x
  const dy2 = pB.y - midPoint.y
  const det2 = tMid.x * tB.y - tMid.y * tB.x
  let via2: Point
  if (Math.abs(det2) > 1e-4) {
    const s2 = (dx2 * tB.y - dy2 * tB.x) / det2
    if (s2 > 0 && s2 < chordDist) {
      via2 = { x: midPoint.x + s2 * tMid.x, y: midPoint.y + s2 * tMid.y }
    } else {
      via2 = { x: (midPoint.x + pB.x) / 2, y: (midPoint.y + pB.y) / 2 }
    }
  } else {
    via2 = { x: (midPoint.x + pB.x) / 2, y: (midPoint.y + pB.y) / 2 }
  }

  return {
    kind: 's-curve',
    segments: [
      { from: pA, to: midPoint, via: via1, kind: 'curve' },
      { from: midPoint, to: pB, via: via2, kind: 'curve' },
    ],
    intermediateNodes: [midPoint],
  }
}

/**
 * Height of a node created at `pos` on a link between two nodes: on the even slope from one to the
 * other (by straight-line distance), i.e. their own height when they agree.
 */
function levelBetween(a: RailNode | undefined, b: RailNode | undefined, pos: Point): number {
  const ha = nodeLevel(a)
  const hb = nodeLevel(b)
  if (!a || !b || ha === hb) return ha
  const da = Math.hypot(pos.x - a.pos.x, pos.y - a.pos.y)
  const db = Math.hypot(pos.x - b.pos.x, pos.y - b.pos.y)
  return da + db > 0 ? ha + ((hb - ha) * da) / (da + db) : ha
}

/**
 * Apply auto-connect to the network between Node A and Node B.
 */
export function applyAutoConnect(net: Network, nodeAId: string, nodeBId: string, tolerance?: number): boolean {
  const geom = computeAutoConnectGeometry(net, nodeAId, nodeBId)
  if (!geom) return false

  if (geom.kind === 'straight') {
    addSegment(net, nodeAId, nodeBId)
  } else if (geom.kind === 'single-curve' && geom.segments[0].via) {
    addCurveSegment(net, nodeAId, nodeBId, geom.segments[0].via)
  } else if (geom.kind === 's-curve' && geom.intermediateNodes.length > 0) {
    // The link climbs from the height of A to the height of B
    const midPos = geom.intermediateNodes[0]
    const midNode = addNode(net, midPos, levelBetween(net.nodes.get(nodeAId), net.nodes.get(nodeBId), midPos))
    const seg1 = geom.segments[0]
    const seg2 = geom.segments[1]
    if (seg1.via) addCurveSegment(net, nodeAId, midNode.id, seg1.via)
    else addSegment(net, nodeAId, midNode.id)

    if (seg2.via) addCurveSegment(net, midNode.id, nodeBId, seg2.via)
    else addSegment(net, midNode.id, nodeBId)
  }

  reconcileNetworkIntersections(net, tolerance)
  return true
}

/**
 * Compute crossover geometry between two parallel segments.
 * Generates a smooth C1 reverse curve (S-curve) connecting both tracks.
 */
export interface CrossoverPreview {
  valid: boolean
  track1Pos: Point
  track2Pos: Point
  midPos: Point
  via1: Point
  via2: Point
  seg1Id: string
  seg2Id: string
  distance: number
  crossoverAngleDeg: number
  radius: number
}

export function computeCrossoverPreview(
  net: Network,
  seg1Id: string,
  seg2Id: string,
  targetPoint: Point,
  crossoverAngleDeg = 12,
): CrossoverPreview | null {
  const s1 = net.segments.get(seg1Id)
  const s2 = net.segments.get(seg2Id)
  if (!s1 || !s2 || seg1Id === seg2Id) return null

  const n1A = net.nodes.get(s1.from)
  const n1B = net.nodes.get(s1.to)
  const n2A = net.nodes.get(s2.from)
  const n2B = net.nodes.get(s2.to)
  if (!n1A || !n1B || !n2A || !n2B) return null

  // Direction of segment 1
  const d1x = n1B.pos.x - n1A.pos.x
  const d1y = n1B.pos.y - n1A.pos.y
  const len1 = Math.hypot(d1x, d1y)
  if (len1 < 1) return null
  const u1 = { x: d1x / len1, y: d1y / len1 }

  // Direction of segment 2
  const d2x = n2B.pos.x - n2A.pos.x
  const d2y = n2B.pos.y - n2A.pos.y
  const len2 = Math.hypot(d2x, d2y)
  if (len2 < 1) return null
  const u2 = { x: d2x / len2, y: d2y / len2 }

  // Must be approximately parallel tracks (|u1 · u2| > 0.95)
  const dot = u1.x * u2.x + u1.y * u2.y
  if (Math.abs(dot) < 0.95) return null

  // Normal to line 1
  const norm1 = { x: -u1.y, y: u1.x }

  // Distance between track 1 and track 2
  const v12x = n2A.pos.x - n1A.pos.x
  const v12y = n2A.pos.y - n1A.pos.y
  const distBetweenTracks = Math.abs(v12x * norm1.x + v12y * norm1.y)
  if (distBetweenTracks < 1.5 || distBetweenTracks > 25) return null

  // Sign of offset from track 1 to track 2
  const sideSign = (v12x * norm1.x + v12y * norm1.y) >= 0 ? 1 : -1
  const norm12 = { x: norm1.x * sideSign, y: norm1.y * sideSign }

  // Project targetPoint onto line 1
  const proj1 = (targetPoint.x - n1A.pos.x) * u1.x + (targetPoint.y - n1A.pos.y) * u1.y
  const clampedProj1 = Math.max(2, Math.min(len1 - 2, proj1))
  const centerTrack1 = { x: n1A.pos.x + u1.x * clampedProj1, y: n1A.pos.y + u1.y * clampedProj1 }

  // Angle theta and smooth circular arc radius:
  // dist = 2 * R * (1 - cos(theta)) => R = dist / (2 * (1 - cos(theta)))
  const thetaRad = (Math.max(6, Math.min(25, crossoverAngleDeg)) * Math.PI) / 180
  const oneMinusCos = Math.max(0.005, 1 - Math.cos(thetaRad))
  const radius = distBetweenTracks / (2 * oneMinusCos)

  // Longitudinal length: L = dist / tan(theta / 2)
  const deltaL = distBetweenTracks / Math.tan(thetaRad / 2)
  const dVia = radius * Math.tan(thetaRad / 2)

  // Start turnout on track 1, End turnout on track 2
  const t1Pos = {
    x: centerTrack1.x - (u1.x * deltaL) / 2,
    y: centerTrack1.y - (u1.y * deltaL) / 2,
  }
  const t2Pos = {
    x: centerTrack1.x + (u1.x * deltaL) / 2 + norm12.x * distBetweenTracks,
    y: centerTrack1.y + (u1.y * deltaL) / 2 + norm12.y * distBetweenTracks,
  }
  const midPos = {
    x: (t1Pos.x + t2Pos.x) / 2,
    y: (t1Pos.y + t2Pos.y) / 2,
  }
  const via1 = {
    x: t1Pos.x + u1.x * dVia,
    y: t1Pos.y + u1.y * dVia,
  }
  const via2 = {
    x: t2Pos.x - u1.x * dVia,
    y: t2Pos.y - u1.y * dVia,
  }

  return {
    valid: true,
    track1Pos: t1Pos,
    track2Pos: t2Pos,
    midPos,
    via1,
    via2,
    seg1Id,
    seg2Id,
    distance: distBetweenTracks,
    crossoverAngleDeg,
    radius,
  }
}

/**
 * Apply crossover to the network as a smooth C1 reverse curve (2 curved segments).
 */
export function applyCrossover(net: Network, preview: CrossoverPreview, tolerance?: number): boolean {
  if (!preview.valid) return false

  // Split segment 1 at track1Pos
  const split1 = splitSegment(net, preview.seg1Id, preview.track1Pos)
  const node1 = split1 ? split1.midNode : addNode(net, preview.track1Pos)

  // Split segment 2 at track2Pos
  const split2 = splitSegment(net, preview.seg2Id, preview.track2Pos)
  const node2 = split2 ? split2.midNode : addNode(net, preview.track2Pos)

  // Add inflection midpoint node
  const nodeM = addNode(net, preview.midPos, levelBetween(node1, node2, preview.midPos))

  // Add the two curved segments forming the smooth C1 S-curve
  addCurveSegment(net, node1.id, nodeM.id, preview.via1)
  addCurveSegment(net, nodeM.id, node2.id, preview.via2)

  reconcileNetworkIntersections(net, tolerance)
  return true
}

/**
 * Preview data for an automatic parallel turnout with integrated counter-curve.
 */
export interface ParallelTurnoutPreview {
  valid: boolean
  startPos: Point
  midPos: Point
  endPos: Point
  via1: Point
  via2: Point
  segId?: string
  nodeId?: string
  offset: number
  radius: number
  side: 1 | -1
  angleDeg: number
  tangent: Point
}

/**
 * Compute parallel turnout geometry (turnout with integrated counter-curve).
 * Branches off an existing track and ends strictly parallel at the chosen track spacing (offset).
 */
export function computeParallelTurnoutPreview(
  net: Network,
  targetPoint: Point,
  offset = 4.0,
  radius = 40.0,
  side: 1 | -1 = 1,
): ParallelTurnoutPreview | null {
  let startPos: Point | null = null
  let tangent: Point | null = null
  let foundSegId: string | undefined
  let foundNodeId: string | undefined

  let bestDist = Infinity

  for (const seg of net.segments.values()) {
    const na = net.nodes.get(seg.from)
    const nb = net.nodes.get(seg.to)
    if (!na || !nb) continue
    const dx = nb.pos.x - na.pos.x
    const dy = nb.pos.y - na.pos.y
    const len = Math.hypot(dx, dy)
    if (len < 1) continue
    const ux = dx / len
    const uy = dy / len
    const proj = (targetPoint.x - na.pos.x) * ux + (targetPoint.y - na.pos.y) * uy
    const clampedProj = Math.max(0.5, Math.min(len - 0.5, proj))
    const pOnSeg = { x: na.pos.x + ux * clampedProj, y: na.pos.y + uy * clampedProj }
    const d = Math.hypot(targetPoint.x - pOnSeg.x, targetPoint.y - pOnSeg.y)
    if (d < bestDist && d < 20) {
      bestDist = d
      startPos = pOnSeg
      tangent = { x: ux, y: uy }
      foundSegId = seg.id
    }
  }

  if (!startPos || !tangent) {
    for (const node of net.nodes.values()) {
      const d = Math.hypot(targetPoint.x - node.pos.x, targetPoint.y - node.pos.y)
      if (d < bestDist && d < 15) {
        const tan = getTangentForPlacement(net, node.id, targetPoint)
        if (tan) {
          bestDist = d
          startPos = node.pos
          tangent = tan
          foundNodeId = node.id
          foundSegId = undefined
        }
      }
    }
  }

  if (!startPos || !tangent) return null

  // Ensure radius is physically capable of achieving offset
  const minR = offset / 1.8
  const effRadius = Math.max(minR, radius)

  // offset = 2 * R * (1 - cos(theta)) => cos(theta) = 1 - offset / (2 * R)
  const cosTheta = Math.max(0.7, Math.min(0.995, 1 - offset / (2 * effRadius)))
  const thetaRad = Math.acos(cosTheta)
  const angleDeg = (thetaRad * 180) / Math.PI

  // Longitudinal advance along track: L = offset / tan(theta / 2)
  const deltaL = offset / Math.tan(thetaRad / 2)
  const dVia = effRadius * Math.tan(thetaRad / 2)

  // Lateral normal vector (side = +1 for left, -1 for right)
  const norm = { x: -tangent.y * side, y: tangent.x * side }

  const midPos = {
    x: startPos.x + tangent.x * (deltaL / 2) + norm.x * (offset / 2),
    y: startPos.y + tangent.y * (deltaL / 2) + norm.y * (offset / 2),
  }
  const endPos = {
    x: startPos.x + tangent.x * deltaL + norm.x * offset,
    y: startPos.y + tangent.y * deltaL + norm.y * offset,
  }
  const via1 = {
    x: startPos.x + tangent.x * dVia,
    y: startPos.y + tangent.y * dVia,
  }
  const via2 = {
    x: endPos.x - tangent.x * dVia,
    y: endPos.y - tangent.y * dVia,
  }

  return {
    valid: true,
    startPos,
    midPos,
    endPos,
    via1,
    via2,
    segId: foundSegId,
    nodeId: foundNodeId,
    offset,
    radius: effRadius,
    side,
    angleDeg,
    tangent,
  }
}

/**
 * Apply parallel turnout to network.
 */
export function applyParallelTurnout(
  net: Network,
  preview: ParallelTurnoutPreview,
  tolerance?: number,
): { startNode: RailNode; midNode: RailNode; endNode: RailNode } | null {
  if (!preview.valid) return null

  let startNode: RailNode | null = null
  if (preview.segId) {
    const split = splitSegment(net, preview.segId, preview.startPos)
    startNode = split ? split.midNode : addNode(net, preview.startPos)
  } else if (preview.nodeId) {
    startNode = net.nodes.get(preview.nodeId) ?? null
  }
  if (!startNode) {
    startNode = addNode(net, preview.startPos)
  }

  // The branch stays at the height of the track it leaves
  const level = nodeLevel(startNode)
  const midNode = addNode(net, preview.midPos, level)
  const endNode = addNode(net, preview.endPos, level)

  addCurveSegment(net, startNode.id, midNode.id, preview.via1)
  addCurveSegment(net, midNode.id, endNode.id, preview.via2)

  reconcileNetworkIntersections(net, tolerance)
  return { startNode, midNode, endNode }
}

/**
 * Result of computing a freeform parallel turnout to an interactive target cursor.
 */
export interface FreeformParallelTurnoutResult {
  valid: boolean
  startPos: Point
  midPos: Point
  endPos: Point
  via1: Point
  via2: Point
  dx: number // longitudinal advance X
  offset: number // lateral spacing Y
  radius: number // S-curve radius R
  tangent: Point // outgoing parallel unit tangent
}

/** World-space limits of the freeform parallel turnout (metres). Defaults are the 1:1 values. */
export interface TurnoutLimits {
  minTurnoutAdvance?: number
  minTurnoutOffset?: number
  minRadius?: number
}

/**
 * Compute an interactive parallel turnout from startPos along startTangent to targetPoint.
 * Allows complete freedom of positioning the END of the turnout with live spacing and length.
 * Generates a smooth C1 reverse curve (S-curve) that ends strictly parallel to startTangent.
 */
export function computeFreeformParallelTurnout(
  startPos: Point,
  startTangent: Point,
  targetPoint: Point,
  limits: TurnoutLimits = {},
): FreeformParallelTurnoutResult | null {
  const { minTurnoutAdvance = 2, minTurnoutOffset = 0.2, minRadius = 15 } = limits
  const tanLen = Math.hypot(startTangent.x, startTangent.y)
  if (tanLen === 0) return null
  const u = { x: startTangent.x / tanLen, y: startTangent.y / tanLen }
  const norm = { x: -u.y, y: u.x }

  const vx = targetPoint.x - startPos.x
  const vy = targetPoint.y - startPos.y

  let X = vx * u.x + vy * u.y
  let Y = vx * norm.x + vy * norm.y

  // Must advance forward along the track
  if (X < minTurnoutAdvance) X = minTurnoutAdvance
  // Prevent zero division when exactly on centerline
  if (Math.abs(Y) < minTurnoutOffset) {
    Y = Y >= 0 ? minTurnoutOffset : -minTurnoutOffset
  }

  const absY = Math.abs(Y)
  // S-curve circular arc radius: R = (X^2 + Y^2) / (4 * |Y|)
  const radius = (X * X + Y * Y) / (4 * absY)

  // Distance from endpoints to quadratic Bezier control points:
  // d_via = (X^2 + Y^2) / (4 * X)
  const dVia = (X * X + Y * Y) / (4 * X)

  const endPos = {
    x: startPos.x + u.x * X + norm.x * Y,
    y: startPos.y + u.y * X + norm.y * Y,
  }
  const midPos = {
    x: (startPos.x + endPos.x) / 2,
    y: (startPos.y + endPos.y) / 2,
  }
  const via1 = {
    x: startPos.x + u.x * dVia,
    y: startPos.y + u.y * dVia,
  }
  const via2 = {
    x: endPos.x - u.x * dVia,
    y: endPos.y - u.y * dVia,
  }

  return {
    valid: radius >= minRadius,
    startPos,
    midPos,
    endPos,
    via1,
    via2,
    dx: X,
    offset: Y,
    radius,
    tangent: u,
  }
}

/**
 * Apply a freeform parallel turnout to the network. Laid out of a node of a through track, it
 * declares the turnout there: the track is the straight route, the new curve the diverging one.
 */
export function applyFreeformParallelTurnout(
  net: Network,
  startNodeId: string,
  geom: FreeformParallelTurnoutResult,
  tolerance?: number,
): { midNode: RailNode; endNode: RailNode; junction: Junction | null } {
  const level = nodeLevel(net.nodes.get(startNodeId))
  const midNode = addNode(net, geom.midPos, level)
  const endNode = addNode(net, geom.endPos, level)

  const railsBefore = [...(net.adjacency.get(startNodeId) ?? [])]
  const first = addArcCurve(net, startNodeId, midNode.id, geom.via1)
  addArcCurve(net, midNode.id, endNode.id, geom.via2)
  const branch = first?.segments.find((seg) => seg.from === startNodeId || seg.to === startNodeId)
  const junction = branch ? declareBranchOff(net, startNodeId, railsBefore, branch.id) : null

  reconcileNetworkIntersections(net, tolerance)
  return { midNode, endNode, junction }
}

/**
 * Compute passing siding (évitement) along a track.
 */
export interface SidingPreview {
  valid: boolean
  segId: string
  entryTurnoutPos: Point
  exitTurnoutPos: Point
  entryMidPos: Point
  entryVia1: Point
  entryVia2: Point
  sidingStartPos: Point
  sidingEndPos: Point
  exitMidPos: Point
  exitVia1: Point
  exitVia2: Point
  length: number
  offset: number
}

export function computePassingSidingPreview(
  net: Network,
  segId: string,
  centerPos: Point,
  sidingLength = 60,
  offset = 3.8,
  side: 1 | -1 = 1,
): SidingPreview | null {
  const seg = net.segments.get(segId)
  if (!seg) return null
  const nodeA = net.nodes.get(seg.from)
  const nodeB = net.nodes.get(seg.to)
  if (!nodeA || !nodeB) return null

  const dx = nodeB.pos.x - nodeA.pos.x
  const dy = nodeB.pos.y - nodeA.pos.y
  const len = Math.hypot(dx, dy)
  if (len < 5) return null

  const ux = dx / len
  const uy = dy / len
  const nx = -uy * side
  const ny = ux * side

  // S-curve transition parameters:
  const transitionRadius = Math.max(30, offset * 10)
  const cosTheta = Math.max(0.7, 1 - offset / (2 * transitionRadius))
  const thetaRad = Math.acos(cosTheta)
  const taperLen = offset / Math.tan(thetaRad / 2)
  const dVia = transitionRadius * Math.tan(thetaRad / 2)

  const totalLen = sidingLength + 2 * taperLen

  // Center position along segment
  const proj = (centerPos.x - nodeA.pos.x) * ux + (centerPos.y - nodeA.pos.y) * uy
  const startProj = proj - totalLen / 2
  const endProj = proj + totalLen / 2

  const entryPos = { x: nodeA.pos.x + ux * startProj, y: nodeA.pos.y + uy * startProj }
  const exitPos = { x: nodeA.pos.x + ux * endProj, y: nodeA.pos.y + uy * endProj }

  const sStart = {
    x: entryPos.x + ux * taperLen + nx * offset,
    y: entryPos.y + uy * taperLen + ny * offset,
  }
  const sEnd = {
    x: exitPos.x - ux * taperLen + nx * offset,
    y: exitPos.y - uy * taperLen + ny * offset,
  }

  const entryMid = {
    x: entryPos.x + ux * (taperLen / 2) + nx * (offset / 2),
    y: entryPos.y + uy * (taperLen / 2) + ny * (offset / 2),
  }
  const entryVia1 = { x: entryPos.x + ux * dVia, y: entryPos.y + uy * dVia }
  const entryVia2 = { x: sStart.x - ux * dVia, y: sStart.y - uy * dVia }

  const exitMid = {
    x: sEnd.x + ux * (taperLen / 2) - nx * (offset / 2),
    y: sEnd.y + uy * (taperLen / 2) - ny * (offset / 2),
  }
  const exitVia1 = { x: sEnd.x + ux * dVia, y: sEnd.y + uy * dVia }
  const exitVia2 = { x: exitPos.x - ux * dVia, y: exitPos.y - uy * dVia }

  return {
    valid: true,
    segId,
    entryTurnoutPos: entryPos,
    exitTurnoutPos: exitPos,
    entryMidPos: entryMid,
    entryVia1,
    entryVia2,
    sidingStartPos: sStart,
    sidingEndPos: sEnd,
    exitMidPos: exitMid,
    exitVia1,
    exitVia2,
    length: sidingLength,
    offset,
  }
}

/**
 * Apply passing siding to network with smooth curved transitions.
 */
export function applyPassingSiding(net: Network, preview: SidingPreview, tolerance?: number): boolean {
  if (!preview.valid) return false

  // Height of the main line at the exit turnout, read before the line is cut: on a ramp the exit
  // node must sit on the slope, not at the height of the entry
  const mainSeg = net.segments.get(preview.segId)
  const entryLevel = mainSeg ? segmentHeightNear(net, mainSeg, preview.entryTurnoutPos) : 0
  const exitLevel = mainSeg ? segmentHeightNear(net, mainSeg, preview.exitTurnoutPos) : 0

  // Split at entry and exit
  const split1 = splitSegment(net, preview.segId, preview.entryTurnoutPos)
  const nEntry = split1 ? split1.midNode : addNode(net, preview.entryTurnoutPos, entryLevel)

  const split2 = splitSegment(net, preview.segId, preview.exitTurnoutPos)
  const nExit = split2 ? split2.midNode : addNode(net, preview.exitTurnoutPos, exitLevel)

  // Add siding transition and track nodes
  const nEntryMid = addNode(net, preview.entryMidPos, nodeLevel(nEntry))
  const nSStart = addNode(net, preview.sidingStartPos, nodeLevel(nEntry))
  const nSEnd = addNode(net, preview.sidingEndPos, nodeLevel(nExit))
  const nExitMid = addNode(net, preview.exitMidPos, nodeLevel(nExit))

  const siding = [
    // Entry S-curve (2 curves)
    addCurveSegment(net, nEntry.id, nEntryMid.id, preview.entryVia1),
    addCurveSegment(net, nEntryMid.id, nSStart.id, preview.entryVia2),
    // Siding body (straight)
    addSegment(net, nSStart.id, nSEnd.id),
    // Exit S-curve (2 curves)
    addCurveSegment(net, nSEnd.id, nExitMid.id, preview.exitVia1),
    addCurveSegment(net, nExitMid.id, nExit.id, preview.exitVia2),
  ]
  // On a ramp the siding climbs from one turnout to the other at an even slope, like the main line
  spreadGradient(net, siding.flatMap((seg) => (seg ? [seg.id] : [])))

  reconcileNetworkIntersections(net, tolerance)
  return true
}

/**
 * Compute balloon loop (raquette de retournement) at an end node.
 */
export interface BalloonLoopPreview {
  valid: boolean
  turnoutPos: Point
  loopNodes: Point[]
  radius: number
  side: 1 | -1
  /** Height of the end node the loop starts from (absent = ground) */
  level?: number
}

export function computeBalloonLoopPreview(
  net: Network,
  endNodeId: string,
  radius = 40,
  side: 1 | -1 = 1,
): BalloonLoopPreview | null {
  const node = net.nodes.get(endNodeId)
  if (!node) return null

  // Outgoing tangent pointing forward from end node
  const t = getTangentForPlacement(net, endNodeId, { x: node.pos.x + 1, y: node.pos.y }) ?? { x: 1, y: 0 }
  const norm = { x: -t.y * side, y: t.x * side }

  const p0 = node.pos
  // Loop center is offset to the side by radius R and forward by R * 1.2
  const cx = p0.x + t.x * radius * 1.2 + norm.x * radius
  const cy = p0.y + t.y * radius * 1.2 + norm.y * radius

  // Create loop path points (circle approximating balloon)
  const pts: Point[] = []
  const steps = 8
  for (let i = 0; i <= steps; i++) {
    const angle = (Math.PI * 2 * i) / steps
    pts.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    })
  }

  return {
    valid: true,
    turnoutPos: p0,
    loopNodes: pts,
    radius,
    side,
    level: nodeLevel(node),
  }
}

/**
 * Apply balloon loop to network.
 */
export function applyBalloonLoop(net: Network, preview: BalloonLoopPreview, tolerance?: number): boolean {
  if (!preview.valid || preview.loopNodes.length < 3) return false

  // The whole loop lies at the height of the end node it leaves from, which it is then welded to
  const level = preview.level ?? 0
  let prevNodeId = addNode(net, preview.turnoutPos, level).id
  const startNodeId = prevNodeId

  for (let i = 1; i < preview.loopNodes.length - 1; i++) {
    const pt = preview.loopNodes[i]
    const n = addNode(net, pt, level)
    addSegment(net, prevNodeId, n.id)
    prevNodeId = n.id
  }

  // Close back to start node to form the return junction
  addSegment(net, prevNodeId, startNodeId)

  reconcileNetworkIntersections(net, tolerance)
  return true
}

/**
 * Split a segment or disconnect a node cleanly.
 * `detachGap` is the distance the detached rail end is pulled back along its own segment;
 * it must stay larger than the reconcile tolerance or the next reconcile pass welds it back.
 */
export function performTrackCut(net: Network, worldPos: Point, hitTol = 1.0, detachGap = 0.25): boolean {
  // Check if clicked close to a node
  let bestNode: RailNode | null = null
  let bestNodeDist = hitTol
  for (const n of net.nodes.values()) {
    const d = Math.hypot(worldPos.x - n.pos.x, worldPos.y - n.pos.y)
    if (d < bestNodeDist) {
      bestNodeDist = d
      bestNode = n
    }
  }

  if (bestNode) {
    const adj = net.adjacency.get(bestNode.id) ?? []
    if (adj.length >= 2) {
      // Disconnect one segment from this node by creating a separate duplicate node
      const segIdToDetach = adj[adj.length - 1]
      const seg = net.segments.get(segIdToDetach)
      if (seg) {
        // Pull the detached end back along the segment's own direction (towards its control
        // point for a curve), so the tangent at that end is unchanged and no kink appears
        const otherNode = net.nodes.get(seg.from === bestNode.id ? seg.to : seg.from)
        const towards = seg.kind === 'curve' && seg.via ? seg.via : otherNode?.pos
        let detachedPos = { ...bestNode.pos }
        if (towards) {
          const dx = towards.x - bestNode.pos.x
          const dy = towards.y - bestNode.pos.y
          const len = Math.hypot(dx, dy)
          if (len > 0) {
            const gap = Math.min(detachGap, len / 2)
            detachedPos = { x: bestNode.pos.x + (dx / len) * gap, y: bestNode.pos.y + (dy / len) * gap }
          }
        }
        const detachedNode = addNode(net, detachedPos, nodeLevel(bestNode))
        if (seg.from === bestNode.id) seg.from = detachedNode.id
        else if (seg.to === bestNode.id) seg.to = detachedNode.id
        touchNetwork(net, seg.id)
        // Rebuild adjacency
        net.adjacency.get(bestNode.id)?.splice(adj.indexOf(segIdToDetach), 1)
        net.adjacency.set(detachedNode.id, [segIdToDetach])
        return true
      }
    }
  }

  // Otherwise split the segment under the cursor, if any
  const hitSegId = hitSegment(net, worldPos, hitTol)
  if (!hitSegId) return false
  return splitSegment(net, hitSegId, worldPos) !== null
}

// ─────────────────── Station templates ───────────────────
//
// Two templates lay a small station in one click, previewed while hovering:
// - the island loop (« évitement à quai central »): a straight track parts into two tracks far
//   enough apart for an island platform between them, which is laid with them;
// - the station with two side platforms (« gare à deux quais latéraux »): on a double track (or a
//   passing loop), one platform on the outer side of each track.
// Both put their platforms in the station beside them, or in a new one (`layPlatformGroup`), with
// their stop markers laid by default. Sides are seen on screen (see `models/platforms.ts`).

/** Length of the platforms the station templates lay, metres at 1:1 */
export const TEMPLATE_PLATFORM_LENGTH = 220
/** Radius of the curves by which the island loop parts from the line, metres at 1:1 */
export const ISLAND_LOOP_RADIUS = 190
/** Shortest stretch the side platforms are cut down to where the tracks part, metres at 1:1 */
export const TEMPLATE_MIN_PLATFORM_LENGTH = 20
/** Track left before and after the loop on the straight it is laid on, metres at 1:1 */
const LOOP_END_MARGIN = 1
/** A cut this close to a node of the straight is made at the node, metres at 1:1 */
const CUT_SNAP = 0.25

/** Why a template lays nothing where the cursor is */
export type StationTemplateRefusal = 'not-straight' | 'too-short' | 'no-track-across' | 'not-alongside'

/** A rail the template would lay, as drawn by the preview */
export interface TemplateRail {
  from: Point
  to: Point
  via?: Point
}

/** Common to the two templates: where it stands, and what is drawn */
interface StationTemplateBase {
  /** The place of the track the template is laid around */
  at: Point
  /** The rails it would lay (none for the side platforms) */
  rails: TemplateRail[]
  /** The outline of each platform it would lay */
  outlines: Point[][]
}

export type StationTemplateRefused = StationTemplateBase & {
  valid: false
  refusal: StationTemplateRefusal
  /** Length of straight track the island loop needs (`too-short`), m */
  needed?: number
}

const sideAway = (side: 'left' | 'right'): 'left' | 'right' => (side === 'left' ? 'right' : 'left')
const distanceTo = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
const along = (o: Point, u: Point, s: number, n: Point = { x: 0, y: 0 }, d = 0): Point => ({
  x: o.x + u.x * s + n.x * d,
  y: o.y + u.y * s + n.y * d,
})

/** The point of the network nearest to `p` within `reach`, on any rail */
function nearestTrackPoint(net: Network, p: Point, reach: number): PlacedPoint | null {
  let best: PlacedPoint | null = null
  let bestDist = reach
  for (const seg of railsWithin(net, p, reach)) {
    const proj = projectOnSegment(net, seg, p)
    if (!proj) continue
    const d = distanceTo(proj.point, p)
    if (d <= bestDist) {
      bestDist = d
      best = { segId: seg.id, t: proj.t, at: proj.point }
    }
  }
  return best
}

/** A straight rail of a straight run: where its two ends are along the run (`s0` < `s1`) */
interface RunRail {
  segId: SegmentId
  s0: number
  s1: number
  node0: NodeId
  node1: NodeId
}

/** A line of straight rails end to end, through plain joints (no points): origin, heading, rails */
export interface StraightRun {
  origin: Point
  u: Point
  length: number
  rails: RunRail[]
}

/**
 * The straight track a straight rail belongs to: the rails that continue it in line through
 * plain joints, up to the first set of points, end of track or bend. Null for a rail that is not straight.
 */
export function straightRunThrough(net: Network, segId: SegmentId): StraightRun | null {
  const seg = net.segments.get(segId)
  if (!seg || seg.kind !== 'straight') return null
  const a = net.nodes.get(seg.from)
  const b = net.nodes.get(seg.to)
  if (!a || !b) return null
  const length = distanceTo(a.pos, b.pos)
  if (length < 1e-6) return null
  const u = { x: (b.pos.x - a.pos.x) / length, y: (b.pos.y - a.pos.y) / length }
  const offLine = (p: Point): number => Math.abs((p.x - a.pos.x) * u.y - (p.y - a.pos.y) * u.x)
  const sOf = (p: Point): number => (p.x - a.pos.x) * u.x + (p.y - a.pos.y) * u.y

  const rails: RunRail[] = [{ segId, s0: 0, s1: length, node0: a.id, node1: b.id }]
  const seen = new Set<SegmentId>([segId])
  // Walk on from each end while the next rail is straight and in line
  for (const forward of [true, false]) {
    let node = forward ? b.id : a.id
    let rail: SegmentId = segId
    for (;;) {
      const adjacent = net.adjacency.get(node) ?? []
      if (adjacent.length !== 2 || findJunctionAtNode(net, node)) break
      const nextId = adjacent[0] === rail ? adjacent[1] : adjacent[0]
      const next = net.segments.get(nextId)
      if (!next || next.kind !== 'straight' || seen.has(nextId)) break
      const farId = next.from === node ? next.to : next.from
      const far = net.nodes.get(farId)
      const here = net.nodes.get(node)
      if (!far || !here) break
      const s = sOf(far.pos)
      const sHere = sOf(here.pos)
      if (offLine(far.pos) > 1e-3 || (forward ? s <= sHere + 1e-6 : s >= sHere - 1e-6)) break
      seen.add(nextId)
      rails.push(forward ? { segId: nextId, s0: sHere, s1: s, node0: node, node1: farId } : { segId: nextId, s0: s, s1: sHere, node0: farId, node1: node })
      node = farId
      rail = nextId
    }
  }
  rails.sort((p, q) => p.s0 - q.s0)
  const start = rails[0].s0
  for (const rail of rails) {
    rail.s0 -= start
    rail.s1 -= start
  }
  return { origin: along(a.pos, u, start), u, length: rails[rails.length - 1].s1, rails }
}

/** Where the loop leaves or rejoins the line: a node of it, or a place of a rail to cut */
export interface TemplateCut {
  pos: Point
  segId: SegmentId
  /** An existing node of the line, when the cut falls on one */
  nodeId: NodeId | null
}

function cutOnRun(run: StraightRun, s: number, snap: number): TemplateCut {
  const rail = run.rails.find((r) => s <= r.s1 + 1e-9) ?? run.rails[run.rails.length - 1]
  if (Math.abs(s - rail.s0) <= snap) return { pos: along(run.origin, run.u, rail.s0), segId: rail.segId, nodeId: rail.node0 }
  if (Math.abs(s - rail.s1) <= snap) return { pos: along(run.origin, run.u, rail.s1), segId: rail.segId, nodeId: rail.node1 }
  return { pos: along(run.origin, run.u, s), segId: rail.segId, nodeId: null }
}

export type IslandLoopPreview =
  | StationTemplateRefused
  | (StationTemplateBase & {
      valid: true
      /** Side of the line the loop goes to, walking the line along `heading` */
      side: 'left' | 'right'
      heading: Point
      /** Axis to axis of the two tracks along the platform, m */
      spacing: number
      platformLength: number
      radius: number
      entry: TemplateCut
      exit: TemplateCut
      entryMid: Point
      entryVia1: Point
      entryVia2: Point
      loopStart: Point
      loopEnd: Point
      exitMid: Point
      exitVia1: Point
      exitVia2: Point
      /** The platform along the line, from start to end (the edge of the island on the line) */
      lineEdge: [Point, Point]
    })

export interface StationTemplateOptions {
  /** How far from the cursor the track is looked for, m */
  reach: number
  /** Rail gauge of the layout (1:1 when left out): every size follows it */
  gauge?: number
  /** Length of the platforms, m (`TEMPLATE_PLATFORM_LENGTH` at the scale when left out) */
  platformLength?: number
}

/**
 * The island loop the cursor points at: on the straight track nearest to it, centred on the
 * cursor (slid along the straight to fit it), on the side of the track the cursor is on. The two
 * tracks are set apart by two platform edges and an island (`2 × edgeOffset + width`); the
 * platform runs the length of the stretch where they are parallel. Null away from the track.
 */
export function computeIslandLoopPreview(net: Network, cursor: Point, options: StationTemplateOptions): IslandLoopPreview | null {
  const k = scaleFactor(options.gauge)
  const dims = platformDimensions(options.gauge)
  const hit = nearestTrackPoint(net, cursor, options.reach)
  if (!hit) return null
  const refused = (refusal: StationTemplateRefusal, needed?: number): StationTemplateRefused => ({
    valid: false, refusal, at: hit.at, rails: [], outlines: [], ...(needed !== undefined ? { needed } : {}),
  })
  const run = straightRunThrough(net, hit.segId)
  if (!run) return refused('not-straight')
  const { origin, u } = run
  const side = sideOf(cursor, hit.at, u)
  const n = sideNormal(u, side)

  const spacing = 2 * dims.edgeOffset + dims.width
  const platformLength = options.platformLength ?? TEMPLATE_PLATFORM_LENGTH * k
  const radius = Math.max(ISLAND_LOOP_RADIUS * k, spacing * 10)
  // Two arcs of the same radius turned opposite ways set the track `spacing` aside over `taper`
  const theta = Math.acos(1 - spacing / (2 * radius))
  const taper = spacing / Math.tan(theta / 2)
  const dVia = radius * Math.tan(theta / 2)
  const total = platformLength + 2 * taper
  const margin = LOOP_END_MARGIN * k
  if (run.length < total + 2 * margin) return refused('too-short', total + 2 * margin)

  const sCursor = (hit.at.x - origin.x) * u.x + (hit.at.y - origin.y) * u.y
  const sCentre = Math.max(total / 2 + margin, Math.min(run.length - total / 2 - margin, sCursor))
  const entry = cutOnRun(run, sCentre - total / 2, CUT_SNAP * k)
  const exit = cutOnRun(run, sCentre + total / 2, CUT_SNAP * k)
  const s0 = sCentre - platformLength / 2
  const s1 = sCentre + platformLength / 2

  const loopStart = along(origin, u, s0, n, spacing)
  const loopEnd = along(origin, u, s1, n, spacing)
  const entryMid = along(origin, u, s0 - taper / 2, n, spacing / 2)
  const exitMid = along(origin, u, s1 + taper / 2, n, spacing / 2)
  const entryVia1 = along(entry.pos, u, dVia)
  const entryVia2 = along(loopStart, u, -dVia)
  const exitVia1 = along(loopEnd, u, dVia)
  const exitVia2 = along(exit.pos, u, -dVia)
  const outline = [
    along(origin, u, s0, n, dims.edgeOffset),
    along(origin, u, s1, n, dims.edgeOffset),
    along(origin, u, s1, n, spacing - dims.edgeOffset),
    along(origin, u, s0, n, spacing - dims.edgeOffset),
  ]
  return {
    valid: true,
    at: hit.at,
    side,
    heading: u,
    spacing,
    platformLength,
    radius,
    entry,
    exit,
    entryMid,
    entryVia1,
    entryVia2,
    loopStart,
    loopEnd,
    exitMid,
    exitVia1,
    exitVia2,
    lineEdge: [along(origin, u, s0), along(origin, u, s1)],
    rails: [
      { from: entry.pos, to: entryMid, via: entryVia1 },
      { from: entryMid, to: loopStart, via: entryVia2 },
      { from: loopStart, to: loopEnd },
      { from: loopEnd, to: exitMid, via: exitVia1 },
      { from: exitMid, to: exit.pos, via: exitVia2 },
    ],
    outlines: [outline],
  }
}

/** The node of the line at a cut: the node it falls on, or a new one cutting its rail (or one of `pieces`) */
function nodeAtCut(net: Network, cut: TemplateCut, pieces: readonly SegmentId[]): { node: RailNode; pieces: SegmentId[] } | null {
  const existing = cut.nodeId ? net.nodes.get(cut.nodeId) : undefined
  if (existing) return { node: existing, pieces: [] }
  const candidates = net.segments.has(cut.segId) ? [cut.segId] : pieces
  let best: { segId: SegmentId; d: number } | null = null
  for (const sid of candidates) {
    const seg = net.segments.get(sid)
    const proj = seg && projectOnSegment(net, seg, cut.pos)
    if (!proj) continue
    const d = distanceTo(proj.point, cut.pos)
    if (!best || d < best.d) best = { segId: sid, d }
  }
  if (!best) return null
  const split = splitSegment(net, best.segId, cut.pos)
  return split ? { node: split.midNode, pieces: [split.seg1.id, split.seg2.id] } : null
}

/**
 * The edge of a platform along the track from `a` to `b` (two places on the track), on the side
 * of `toward`. Null when the track does not join them.
 */
function edgeBetween(net: Network, a: Point, b: Point, toward: Point, reach: number): PlatformEdge | null {
  const from = nearestTrackPoint(net, a, reach)
  const to = nearestTrackPoint(net, b, reach)
  if (!from || !to) return null
  const path = findTrackPathToAny(net, from, [to])
  const track = path ? tidyTrackSpans(path.spans) : []
  if (track.length === 0) return null
  const edge: PlatformEdge = { track, side: 'left' }
  const start = pointOnEdge(net, edge, 0)
  if (!start) return null
  edge.side = sideOf(toward, start.point, start.heading)
  return edge
}

/** What a station template laid: the platforms and their station, and the rails of the loop */
export interface LaidStationTemplate extends LaidPlatforms {
  rails: SegmentId[]
}

/**
 * Lay the island loop of a preview: the two cuts of the line, the loop (two curves, the straight
 * along the platform, two curves), then the island between the line and the loop, in the station
 * beside it or a new one. Null when the preview lays nothing.
 */
export function applyIslandLoop(net: Network, preview: IslandLoopPreview, options: { gauge?: number; tolerance?: number } = {}): LaidStationTemplate | null {
  if (!preview.valid) return null
  // Heights of the line where the loop leaves and rejoins it, read before it is cut
  const levelAt = (cut: TemplateCut): number => {
    const node = cut.nodeId ? net.nodes.get(cut.nodeId) : undefined
    if (node) return nodeLevel(node)
    const seg = net.segments.get(cut.segId)
    return seg ? segmentHeightNear(net, seg, cut.pos) : 0
  }
  const entryLevel = levelAt(preview.entry)
  const exitLevel = levelAt(preview.exit)
  const entry = nodeAtCut(net, preview.entry, [])
  const exit = entry && nodeAtCut(net, preview.exit, entry.pieces)
  if (!entry || !exit) return null

  const nEntryMid = addNode(net, preview.entryMid, entryLevel)
  const nStart = addNode(net, preview.loopStart, entryLevel)
  const nEnd = addNode(net, preview.loopEnd, exitLevel)
  const nExitMid = addNode(net, preview.exitMid, exitLevel)
  const loop = [
    addCurveSegment(net, entry.node.id, nEntryMid.id, preview.entryVia1),
    addCurveSegment(net, nEntryMid.id, nStart.id, preview.entryVia2),
    addSegment(net, nStart.id, nEnd.id),
    addCurveSegment(net, nEnd.id, nExitMid.id, preview.exitVia1),
    addCurveSegment(net, nExitMid.id, exit.node.id, preview.exitVia2),
  ].flatMap((seg) => (seg ? [seg.id] : []))
  // On a ramp the loop climbs from one set of points to the other, like the line
  spreadGradient(net, loop)
  reconcileNetworkIntersections(net, options.tolerance)

  // The island, from its two edges found again on the track as it now is
  const reach = 0.05 * scaleFactor(options.gauge)
  const [lineA, lineB] = preview.lineEdge
  const lineEdge = edgeBetween(net, lineA, lineB, preview.loopStart, reach)
  const loopEdge = edgeBetween(net, preview.loopStart, preview.loopEnd, lineA, reach)
  if (!lineEdge || !loopEdge) return null
  const laid = layPlatformGroup(net, [[lineEdge, loopEdge]], options.gauge)
  return laid ? { ...laid, rails: loop } : null
}

export type SidePlatformsPreview =
  | StationTemplateRefused
  | (StationTemplateBase & {
      valid: true
      /** Axis to axis of the two tracks where the cursor is, m */
      spacing: number
      platformLength: number
      /** One edge each: the platform of the track under the cursor, then the one across */
      edges: [PlatformEdge, PlatformEdge]
    })

/** The track from `centre` `half` metres either way along `heading`: the stretch of a platform */
function stretchAround(net: Network, centre: PlacedPoint, heading: Point, half: number): TrackSpan[] | null {
  const rails = railsAlong(net, centre, half * 2)
  const a = projectOnRails(net, rails, along(centre.at, heading, -half))
  const b = projectOnRails(net, rails, along(centre.at, heading, half))
  if (!a || !b) return null
  const path = findTrackPathToAny(net, a, [b], { blocked: (sid) => !rails.has(sid) })
  return path ? tidyTrackSpans(path.spans) : null
}

/** The track across the side of `edge` keeps within 15 % of `spacing` of it all along (OSM data wanders a little) */
function runsAlongside(net: Network, edge: PlatformEdge, spacing: number, reach: number): boolean {
  const own = new Set(edge.track.map((span) => span.segId))
  const length = edgeLength(net, edge)
  for (let i = 0; i <= 10; i++) {
    const p = pointOnEdge(net, edge, (length * i) / 10)
    if (!p) return false
    const across = trackAcross(net, own, p.point, p.heading, sideNormal(p.heading, edge.side), reach)
    if (!across || Math.abs(across.spacing - spacing) > spacing * 0.15) return false
  }
  return true
}

/**
 * The two side platforms the cursor points at: on the track nearest to it and the track
 * alongside (on the side of the cursor first, else the other), one platform on the outer side of
 * each, centred on the cursor and cut down to where the two tracks run side by side. Null away from the track.
 */
export function computeSidePlatformsPreview(net: Network, cursor: Point, options: StationTemplateOptions): SidePlatformsPreview | null {
  const k = scaleFactor(options.gauge)
  const dims = platformDimensions(options.gauge)
  const hit = nearestTrackPoint(net, cursor, options.reach)
  if (!hit) return null
  const refused = (refusal: StationTemplateRefusal): StationTemplateRefused => ({ valid: false, refusal, at: hit.at, rails: [], outlines: [] })
  const heading = tangentOnSegment(net, hit.segId, hit.t)
  if (!heading) return null
  const cursorSide = sideOf(cursor, hit.at, heading)
  const reach = islandReach(dims)
  const own = new Set([hit.segId])
  const towardCursor = trackAcross(net, own, hit.at, heading, sideNormal(heading, cursorSide), reach)
  const acrossSide = towardCursor ? cursorSide : sideAway(cursorSide)
  const across = towardCursor ?? trackAcross(net, own, hit.at, heading, sideNormal(heading, acrossSide), reach)
  if (!across) return refused('no-track-across')

  const wanted = options.platformLength ?? TEMPLATE_PLATFORM_LENGTH * k
  const shortest = TEMPLATE_MIN_PLATFORM_LENGTH * k
  // The longest platform, down from the length asked, along which the two tracks run side by side
  for (let length = wanted; length >= shortest - 1e-9; length -= wanted / 10) {
    const track = stretchAround(net, hit, heading, length / 2)
    if (!track || track.length === 0) continue
    const inner: PlatformEdge = { track, side: 'left' }
    const middle = pointOnEdge(net, inner, edgeLength(net, inner) / 2)
    if (!middle) continue
    inner.side = sideOf(across.at, middle.point, middle.heading)
    if (!runsAlongside(net, inner, across.spacing, reach)) continue
    const facing = facingEdge(net, inner, across, length * 2, across.spacing * 1.5)
    if (!facing) continue
    const edges: [PlatformEdge, PlatformEdge] = [
      { track: inner.track, side: sideAway(inner.side) },
      { track: facing.track, side: sideAway(facing.side) },
    ]
    const outlines = edges.flatMap((edge) => {
      const outline = platformOutline(net, { id: 'preview', stationId: '', edges: [edge], width: PLATFORM_WIDTH, markers: [] }, dims)
      return outline ? [outline] : []
    })
    return { valid: true, at: hit.at, spacing: across.spacing, platformLength: edgeLength(net, inner), edges, rails: [], outlines }
  }
  return refused('not-alongside')
}

/** Lay the two side platforms of a preview, in the station beside them or a new one */
export function applySidePlatforms(net: Network, preview: SidePlatformsPreview, gauge?: number): LaidStationTemplate | null {
  if (!preview.valid) return null
  if (preview.edges.some((edge) => edge.track.some((span) => !net.segments.has(span.segId)))) return null
  const laid = layPlatformGroup(net, preview.edges.map((edge): [PlatformEdge] => [edge]), gauge)
  return laid ? { ...laid, rails: [] } : null
}
