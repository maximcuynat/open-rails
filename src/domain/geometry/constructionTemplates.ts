import type { Junction, Network, Point, RailNode } from '@domain/models/types'
import { addNode, addSegment, addCurveSegment, addArcCurve, hitSegment, nodeLevel, segmentHeightNear, spreadGradient } from '@domain/models/network'
import { splitSegment, declareBranchOff } from '@domain/models/junction'
import { getTangentForPlacement } from '@domain/geometry/tangent'
import { reconcileNetworkIntersections } from '@domain/geometry/reconcile'

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
