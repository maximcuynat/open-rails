import type { Network, NodeId, Point, SegmentId, Junction } from './types'
import { generateId } from './network'
import { bezierPoint, curveRadiusAt, bezierDerivative1, bezierDerivative2 } from '../geometry/curve'
import { segmentLength, isTransitionAllowed } from '../services/pathfinding'
import { setJunctionBranch, findJunctionAtNode } from './junction'

export type LocoId = string

export interface TrackPosition {
  segId: SegmentId
  t: number
  forward: boolean
}

export interface Locomotive {
  id: LocoId
  length: number
  bogieDistance: number
  front: TrackPosition
  rear: TrackPosition
  direction: 1 | -1
  wagonCount?: number
}

export function positionOnSegment(net: Network, segId: SegmentId, t: number): Point | null {
  const seg = net.segments.get(segId)
  if (!seg) return null
  const from = net.nodes.get(seg.from)
  const to = net.nodes.get(seg.to)
  if (!from || !to) return null
  if (seg.kind === 'straight' || !seg.via) {
    return {
      x: from.pos.x + (to.pos.x - from.pos.x) * t,
      y: from.pos.y + (to.pos.y - from.pos.y) * t,
    }
  } else {
    return bezierPoint(t, from.pos, seg.via, to.pos)
  }
}

export function tangentOnSegment(net: Network, segId: SegmentId, t: number): Point | null {
  const seg = net.segments.get(segId)
  if (!seg) return null
  const from = net.nodes.get(seg.from)
  const to = net.nodes.get(seg.to)
  if (!from || !to) return null
  if (seg.kind === 'straight' || !seg.via) {
    const dx = to.pos.x - from.pos.x
    const dy = to.pos.y - from.pos.y
    const len = Math.hypot(dx, dy)
    if (len === 0) return { x: 1, y: 0 }
    return { x: dx / len, y: dy / len }
  } else {
    const dx = 2 * (1 - t) * (seg.via.x - from.pos.x) + 2 * t * (to.pos.x - seg.via.x)
    const dy = 2 * (1 - t) * (seg.via.y - from.pos.y) + 2 * t * (to.pos.y - seg.via.y)
    const len = Math.hypot(dx, dy)
    if (len === 0) return { x: 1, y: 0 }
    return { x: dx / len, y: dy / len }
  }
}

export function segmentArcLength(net: Network, segId: SegmentId): number {
  const seg = net.segments.get(segId)
  if (!seg) return 0
  return segmentLength(net, seg)
}

/** Helper to compute arc length between two parametric positions on a segment. */
function segmentPartialLength(net: Network, segId: SegmentId, tStart: number, tEnd: number): number {
  const seg = net.segments.get(segId)
  if (!seg) return 0
  const fromNode = net.nodes.get(seg.from)
  const toNode = net.nodes.get(seg.to)
  if (!fromNode || !toNode) return 0

  if (seg.kind === 'straight' || !seg.via) {
    const fullLen = Math.hypot(toNode.pos.x - fromNode.pos.x, toNode.pos.y - fromNode.pos.y)
    return Math.abs(tEnd - tStart) * fullLen
  }

  const N = 32
  let length = 0
  const dir = tEnd >= tStart ? 1 : -1
  const step = Math.abs(tEnd - tStart) / N
  let prev: Point | null = null

  for (let i = 0; i <= N; i++) {
    const t = tStart + dir * step * i
    const p = bezierPoint(t, fromNode.pos, seg.via, toNode.pos)
    if (prev) {
      length += Math.hypot(p.x - prev.x, p.y - prev.y)
    }
    prev = p
  }
  return length
}

/** Helper to move parametric t along a segment by a given distance in the backward direction. */
function moveWithinSegmentBackward(
  net: Network,
  segId: SegmentId,
  currentT: number,
  forward: boolean,
  dist: number
): number {
  const seg = net.segments.get(segId)
  if (!seg) return currentT
  const segLen = segmentArcLength(net, segId)
  if (segLen === 0) return currentT

  if (seg.kind === 'straight' || !seg.via) {
    const dt = dist / segLen
    return forward ? currentT - dt : currentT + dt
  }

  // Pour les courbes Bézier, recherche dichotomique pour trouver t tel que partialLength = dist
  let low = forward ? 0 : currentT
  let high = forward ? currentT : 1

  for (let iter = 0; iter < 32; iter++) {
    const mid = (low + high) / 2
    const len = forward
      ? segmentPartialLength(net, segId, mid, currentT)
      : segmentPartialLength(net, segId, currentT, mid)

    if (Math.abs(len - dist) < 1e-6) {
      return mid
    }
    if (forward) {
      if (len > dist) {
        low = mid
      } else {
        high = mid
      }
    } else {
      if (len > dist) {
        high = mid
      } else {
        low = mid
      }
    }
  }

  return (low + high) / 2
}

export function walkBackward(
  net: Network,
  startSeg: SegmentId,
  startT: number,
  startForward: boolean,
  distance: number
): TrackPosition | null {
  let currentSegId = startSeg
  let t = startT
  let forward = startForward
  let distRemaining = distance

  while (distRemaining > 0) {
    const seg = net.segments.get(currentSegId)
    if (!seg) return null

    // Distance disponible sur le segment courant en reculant
    const distAvail = forward
      ? segmentPartialLength(net, currentSegId, 0, t)
      : segmentPartialLength(net, currentSegId, t, 1)

    if (distRemaining <= distAvail + 1e-9) {
      t = moveWithinSegmentBackward(net, currentSegId, t, forward, distRemaining)
      // Borner t entre 0 et 1
      t = Math.max(0, Math.min(1, t))
      return { segId: currentSegId, t, forward }
    }

    distRemaining -= distAvail
    const exitNodeId = forward ? seg.from : seg.to
    const adj = net.adjacency.get(exitNodeId) || []

    let prevSegId: SegmentId | null = null

    // Si le nœud de sortie est l'apex d'un aiguillage et qu'on vient d'une branche divergente ou straight,
    // en reculant on doit retourner sur le stem !
    const juncAtExit = findJunctionAtNode(net, exitNodeId)
    if (juncAtExit && juncAtExit.stemNodeId) {
      const isFromBranch =
        (juncAtExit.straightSegmentId === currentSegId) ||
        (juncAtExit.divergingSegmentId === currentSegId) ||
        (juncAtExit.divergingRightSegmentId === currentSegId)

      if (isFromBranch) {
        // Le segment précédent est celui qui relie exitNodeId à stemNodeId
        for (const sid of adj) {
          if (sid === currentSegId) continue
          const s = net.segments.get(sid)
          if (!s) continue
          if ((s.from === exitNodeId && s.to === juncAtExit.stemNodeId) ||
              (s.to === exitNodeId && s.from === juncAtExit.stemNodeId)) {
            prevSegId = sid
            break
          }
        }
      }
    }

    if (!prevSegId) {
      for (const sid of adj) {
        if (sid === currentSegId) continue
        const s = net.segments.get(sid)
        if (!s) continue

        const nextNodeId = s.from === exitNodeId ? s.to : s.from
        const currentNextNodeId = forward ? seg.to : seg.from

        if (isTransitionAllowed(net, nextNodeId, exitNodeId, currentNextNodeId)) {
          prevSegId = sid
          break
        }
      }
    }

    if (!prevSegId) return null

    const prevSeg = net.segments.get(prevSegId)
    if (!prevSeg) return null

    if (prevSeg.to === exitNodeId) {
      forward = true
      t = 1
    } else if (prevSeg.from === exitNodeId) {
      forward = false
      t = 0
    } else {
      return null
    }
    currentSegId = prevSegId
  }

  return { segId: currentSegId, t, forward }
}

export function createLocomotive(
  net: Network,
  segId: SegmentId,
  t: number,
  length = 20,
  bogieDistance = 14,
  wagonCount = 0,
  direction: 1 | -1 = 1
): Locomotive | null {
  const forward = direction === 1
  let front: TrackPosition = { segId, t, forward }
  let rear = walkBackward(net, segId, t, forward, bogieDistance)
  if (!rear) {
    const deadEndT = forward ? 0 : 1
    const fwdPos = walkForward(net, segId, deadEndT, forward, bogieDistance)
    if (fwdPos) {
      front = fwdPos
      rear = { segId, t: deadEndT, forward }
    } else {
      front = { segId, t: forward ? 1 : 0, forward }
      rear = { segId, t: forward ? 0 : 1, forward }
    }
  }

  return {
    id: generateId('loco'),
    length,
    bogieDistance,
    front,
    rear,
    direction: 1,
    wagonCount,
  }
}

/** Helper to move parametric t along a segment by a given distance in the forward direction. */
function moveWithinSegmentForward(
  net: Network,
  segId: SegmentId,
  currentT: number,
  forward: boolean,
  dist: number
): number {
  const seg = net.segments.get(segId)
  if (!seg) return currentT
  const segLen = segmentArcLength(net, segId)
  if (segLen === 0) return currentT

  if (seg.kind === 'straight' || !seg.via) {
    const dt = dist / segLen
    return forward ? currentT + dt : currentT - dt
  }

  // Pour les courbes Bézier, recherche dichotomique
  let low = forward ? currentT : 0
  let high = forward ? 1 : currentT

  for (let iter = 0; iter < 32; iter++) {
    const mid = (low + high) / 2
    const len = forward
      ? segmentPartialLength(net, segId, currentT, mid)
      : segmentPartialLength(net, segId, mid, currentT)

    if (Math.abs(len - dist) < 1e-6) {
      return mid
    }
    if (forward) {
      if (len > dist) {
        high = mid
      } else {
        low = mid
      }
    } else {
      if (len > dist) {
        low = mid
      } else {
        high = mid
      }
    }
  }

  return (low + high) / 2
}

/**
 * Traverse forward along track segments from (startSeg, startT, startForward) by distance.
 * Returns resulting TrackPosition, or null if dead end or impassable switch.
 */
export function walkForward(
  net: Network,
  startSeg: SegmentId,
  startT: number,
  startForward: boolean,
  distance: number
): TrackPosition | null {
  let segId = startSeg
  let t = startT
  let forward = startForward
  let distRemaining = distance

  while (distRemaining > 0) {
    const seg = net.segments.get(segId)
    if (!seg) return null

    const distAvail = forward
      ? segmentPartialLength(net, segId, t, 1)
      : segmentPartialLength(net, segId, 0, t)

    if (distRemaining <= distAvail + 1e-9) {
      t = moveWithinSegmentForward(net, segId, t, forward, distRemaining)
      t = Math.max(0, Math.min(1, t))
      return { segId, t, forward }
    }

    distRemaining -= distAvail

    const exitNodeId = forward ? seg.to : seg.from
    const prevNodeId = forward ? seg.from : seg.to
    const adj = net.adjacency.get(exitNodeId) || []

    let nextSegId: SegmentId | null = null
    for (const sid of adj) {
      if (sid === segId) continue
      const s = net.segments.get(sid)
      if (!s) continue
      const nextNodeId = s.from === exitNodeId ? s.to : s.from

      if (isTransitionAllowed(net, prevNodeId, exitNodeId, nextNodeId)) {
        nextSegId = sid
        break
      }
    }

    if (!nextSegId) return null
    const nextSeg = net.segments.get(nextSegId)
    if (!nextSeg) return null

    if (nextSeg.from === exitNodeId) {
      forward = true
      t = 0
    } else {
      forward = false
      t = 1
    }
    segId = nextSegId
  }

  return { segId, t, forward }
}

export function advanceLocomotive(net: Network, loco: Locomotive, deltaMeters: number): boolean {
  let { segId, t, forward } = loco.front
  let distRemaining = deltaMeters * loco.direction

  if (distRemaining > 0) {
    // move forward
    while (distRemaining > 0) {
      const seg = net.segments.get(segId)
      if (!seg) return false

      const distAvail = forward
        ? segmentPartialLength(net, segId, t, 1)
        : segmentPartialLength(net, segId, 0, t)

      if (distRemaining <= distAvail + 1e-9) {
        t = moveWithinSegmentForward(net, segId, t, forward, distRemaining)
        t = Math.max(0, Math.min(1, t))
        break
      }

      distRemaining -= distAvail

      const exitNodeId = forward ? seg.to : seg.from
      const prevNodeId = forward ? seg.from : seg.to
      const adj = net.adjacency.get(exitNodeId) || []

      let nextSegId: SegmentId | null = null
      for (const sid of adj) {
        if (sid === segId) continue
        const s = net.segments.get(sid)
        if (!s) continue
        const nextNodeId = s.from === exitNodeId ? s.to : s.from

        if (isTransitionAllowed(net, prevNodeId, exitNodeId, nextNodeId)) {
          nextSegId = sid
          break
        }
      }

      if (!nextSegId) return false
      const nextSeg = net.segments.get(nextSegId)
      if (!nextSeg) return false

      if (nextSeg.from === exitNodeId) {
        forward = true
        t = 0
      } else {
        forward = false
        t = 1
      }
      segId = nextSegId
    }
  } else {
    // move backward
    distRemaining = -distRemaining
    while (distRemaining > 0) {
      const seg = net.segments.get(segId)
      if (!seg) return false

      const distAvail = forward
        ? segmentPartialLength(net, segId, 0, t)
        : segmentPartialLength(net, segId, t, 1)

      if (distRemaining <= distAvail + 1e-9) {
        t = moveWithinSegmentBackward(net, segId, t, forward, distRemaining)
        t = Math.max(0, Math.min(1, t))
        break
      }

      distRemaining -= distAvail

      const exitNodeId = forward ? seg.from : seg.to
      const prevNodeId = forward ? seg.to : seg.from
      const adj = net.adjacency.get(exitNodeId) || []

      let prevSegId: SegmentId | null = null
      for (const sid of adj) {
        if (sid === segId) continue
        const s = net.segments.get(sid)
        if (!s) continue
        const nextNodeId = s.from === exitNodeId ? s.to : s.from

        if (isTransitionAllowed(net, nextNodeId, exitNodeId, prevNodeId)) {
          prevSegId = sid
          break
        }
      }

      if (!prevSegId) return false
      const prevSeg = net.segments.get(prevSegId)
      if (!prevSeg) return false

      if (prevSeg.to === exitNodeId) {
        forward = true
        t = 1
      } else {
        forward = false
        t = 0
      }
      segId = prevSegId
    }
  }

  loco.front = { segId, t, forward }

  const rear = walkBackward(net, segId, t, forward, loco.bogieDistance)
  if (!rear) return false
  loco.rear = rear

  return true
}

export function getLocomotiveFrontPos(net: Network, loco: Locomotive): Point | null {
  return positionOnSegment(net, loco.front.segId, loco.front.t)
}

export function getLocomotiveRearPos(net: Network, loco: Locomotive): Point | null {
  return positionOnSegment(net, loco.rear.segId, loco.rear.t)
}

export function getLocomotiveHeading(net: Network, loco: Locomotive): Point | null {
  const pFront = getLocomotiveFrontPos(net, loco)
  const pRear = getLocomotiveRearPos(net, loco)
  if (!pFront || !pRear) return null

  const dx = pFront.x - pRear.x
  const dy = pFront.y - pRear.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return { x: 1, y: 0 }

  const ux = dx / len
  const uy = dy / len

  if (loco.direction === -1) {
    return { x: -ux, y: -uy }
  }
  return { x: ux, y: uy }
}

export interface TGVDetails {
  polygon: Point[]
  windshield: Point[]
  headlights: { left: Point; right: Point }
  pantograph: { center: Point; armStart: Point; armEnd: Point; bowLeft: Point; bowRight: Point }
  gangway: Point[]
  isRearLoco?: boolean
}

export function getLocomotivePolygon(net: Network, loco: Locomotive): Point[] | null {
  const details = getTGVDetails(net, loco)
  return details ? details.polygon : null
}

export function getTGVDetails(net: Network, loco: Locomotive): TGVDetails | null {
  const pFront = getLocomotiveFrontPos(net, loco)
  const pRear = getLocomotiveRearPos(net, loco)
  if (!pFront || !pRear) return null

  const dx = pFront.x - pRear.x
  const dy = pFront.y - pRear.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return null

  // Direction unitaire vers l'avant selon loco.direction
  const forwardDir = loco.direction
  const ux = forwardDir === 1 ? dx / len : -dx / len
  const uy = forwardDir === 1 ? dy / len : -dy / len
  const nx = -uy
  const ny = ux

  const frontPivot = forwardDir === 1 ? pFront : pRear
  const rearPivot = forwardDir === 1 ? pRear : pFront

  const totalLength = Math.max(loco.length, loco.bogieDistance + 4)
  const overhangFront = (totalLength - loco.bogieDistance) * 0.62 // long nez profilé (~3.7m)
  const overhangRear = totalLength - loco.bogieDistance - overhangFront // arrière (~2.3m)

  const w = 1.15 // demi-largeur de caisse profilée TGV (2.30m, silhouette affinée)

  // Points du contour aérodynamique TGV (8 sommets)
  // Museau avant
  const noseTipL = { x: frontPivot.x + ux * overhangFront + nx * 0.32, y: frontPivot.y + uy * overhangFront + ny * 0.32 }
  const noseTipR = { x: frontPivot.x + ux * overhangFront - nx * 0.32, y: frontPivot.y + uy * overhangFront - ny * 0.32 }

  // Épaules aérodynamiques du nez
  const shoulderDist = overhangFront * 0.55
  const shoulderL = { x: frontPivot.x + ux * shoulderDist + nx * 0.90, y: frontPivot.y + uy * shoulderDist + ny * 0.90 }
  const shoulderR = { x: frontPivot.x + ux * shoulderDist - nx * 0.90, y: frontPivot.y + uy * shoulderDist - ny * 0.90 }

  // Base du nez au niveau du bogie avant
  const bodyFrontL = { x: frontPivot.x + nx * w, y: frontPivot.y + ny * w }
  const bodyFrontR = { x: frontPivot.x - nx * w, y: frontPivot.y - ny * w }

  // Flancs droits jusqu'au bogie arrière
  const bodyRearL = { x: rearPivot.x + nx * w, y: rearPivot.y + ny * w }
  const bodyRearR = { x: rearPivot.x - nx * w, y: rearPivot.y - ny * w }

  // Face arrière d'attelage (droite pour les futurs wagons)
  const backL = { x: rearPivot.x - ux * overhangRear + nx * (w - 0.04), y: rearPivot.y - uy * overhangRear + ny * (w - 0.04) }
  const backR = { x: rearPivot.x - ux * overhangRear - nx * (w - 0.04), y: rearPivot.y - uy * overhangRear - ny * (w - 0.04) }

  // Contour complet fermé de la motrice profilée
  const polygon = [
    noseTipL,
    shoulderL,
    bodyFrontL,
    bodyRearL,
    backL,
    backR,
    bodyRearR,
    bodyFrontR,
    shoulderR,
    noseTipR,
  ]

  // Pare-brise profilé de cabine
  const wsDist1 = overhangFront * 0.72
  const wsDist2 = overhangFront * 0.38
  const wsL1 = { x: frontPivot.x + ux * wsDist1 + nx * 0.42, y: frontPivot.y + uy * wsDist1 + ny * 0.42 }
  const wsR1 = { x: frontPivot.x + ux * wsDist1 - nx * 0.42, y: frontPivot.y + uy * wsDist1 - ny * 0.42 }
  const wsR2 = { x: frontPivot.x + ux * wsDist2 - nx * 0.75, y: frontPivot.y + uy * wsDist2 - ny * 0.75 }
  const wsL2 = { x: frontPivot.x + ux * wsDist2 + nx * 0.75, y: frontPivot.y + uy * wsDist2 + ny * 0.75 }
  const windshield = [wsL1, wsR1, wsR2, wsL2]

  // Phares avant (feux de tête)
  const hlDist = overhangFront * 0.88
  const headlights = {
    left: { x: frontPivot.x + ux * hlDist + nx * 0.4, y: frontPivot.y + uy * hlDist + ny * 0.4 },
    right: { x: frontPivot.x + ux * hlDist - nx * 0.4, y: frontPivot.y + uy * hlDist - ny * 0.4 },
  }

  // Pantographe sur le toit (vers le tiers arrière)
  const pantoC = { x: rearPivot.x + ux * 1.5, y: rearPivot.y + uy * 1.5 }
  const pantoArmStart = { x: rearPivot.x + ux * 0.7, y: rearPivot.y + uy * 0.7 }
  const pantoArmEnd = { x: rearPivot.x + ux * 2.3, y: rearPivot.y + uy * 2.3 }
  const pantoBowL = { x: pantoArmEnd.x + nx * 0.8, y: pantoArmEnd.y + ny * 0.8 }
  const pantoBowR = { x: pantoArmEnd.x - nx * 0.8, y: pantoArmEnd.y - ny * 0.8 }
  const pantograph = {
    center: pantoC,
    armStart: pantoArmStart,
    armEnd: pantoArmEnd,
    bowLeft: pantoBowL,
    bowRight: pantoBowR,
  }

  // Soufflet d'intercirculation arrière (gangway pour futurs wagons)
  const gw1 = { x: backL.x - ux * 0.25 + nx * (0.45 - (w - 0.04)), y: backL.y - uy * 0.25 + ny * (0.45 - (w - 0.04)) }
  const gw2 = { x: backR.x - ux * 0.25 - nx * (0.45 - (w - 0.04)), y: backR.y - uy * 0.25 - ny * (0.45 - (w - 0.04)) }
  const gw3 = { x: backR.x - nx * (0.45 - (w - 0.04)), y: backR.y - ny * (0.45 - (w - 0.04)) }
  const gw4 = { x: backL.x + nx * (0.45 - (w - 0.04)), y: backL.y + ny * (0.45 - (w - 0.04)) }
  const gangway = [gw4, gw1, gw2, gw3]

  return {
    polygon,
    windshield,
    headlights,
    pantograph,
    gangway,
  }
}

export interface BogieAxle {
  center: Point
  left: Point
  right: Point
  leftWheel: Point
  rightWheel: Point
}

export interface BogieFrame {
  center: Point
  tangent: Point
  normal: Point
  polygon: Point[] // 4 coins du cadre rectangulaire du bogie (qui tourne sur son pivot)
  axles: [BogieAxle, BogieAxle] // Les 2 essieux montés sur le bogie
  pos?: TrackPosition
}

/** Compute the geometry for a bogie (châssis orienté + 2 essieux pivotant selon la voie locale) */
export function computeBogieFrame(net: Network, pos: TrackPosition): BogieFrame | null {
  const center = positionOnSegment(net, pos.segId, pos.t)
  const rawTan = tangentOnSegment(net, pos.segId, pos.t)
  if (!center || !rawTan) return null

  const tan: Point = pos.forward ? rawTan : { x: -rawTan.x, y: -rawTan.y }
  const norm: Point = { x: -tan.y, y: tan.x }

  // Dimensions géométriques d'un bogie ferroviaire (en mètres, silhouette affinée)
  const halfL = 1.35 // Châssis de 2.7m de longueur
  const halfW = 0.90 // Châssis de 1.8m de largeur
  const axleDist = 1.15 // Empattement entre essieux de 2.3m (standard TGV Y230)
  const axleHalfW = 0.95 // Largeur de l'axe transversal avec boîtes d'essieu (1.9m / 2)
  const wheelHalfGauge = 0.7175 // Demi-écartement de voie standard UIC (1.435m / 2)

  // 4 coins du cadre de bogie
  const fl: Point = { x: center.x + tan.x * halfL + norm.x * halfW, y: center.y + tan.y * halfL + norm.y * halfW }
  const fr: Point = { x: center.x + tan.x * halfL - norm.x * halfW, y: center.y + tan.y * halfL - norm.y * halfW }
  const rr: Point = { x: center.x - tan.x * halfL - norm.x * halfW, y: center.y - tan.y * halfL - norm.y * halfW }
  const rl: Point = { x: center.x - tan.x * halfL + norm.x * halfW, y: center.y - tan.y * halfL + norm.y * halfW }

  // Essieu 1 (avant du bogie)
  const c1: Point = { x: center.x + tan.x * axleDist, y: center.y + tan.y * axleDist }
  const axle1: BogieAxle = {
    center: c1,
    left: { x: c1.x + norm.x * axleHalfW, y: c1.y + norm.y * axleHalfW },
    right: { x: c1.x - norm.x * axleHalfW, y: c1.y - norm.y * axleHalfW },
    leftWheel: { x: c1.x + norm.x * wheelHalfGauge, y: c1.y + norm.y * wheelHalfGauge },
    rightWheel: { x: c1.x - norm.x * wheelHalfGauge, y: c1.y - norm.y * wheelHalfGauge },
  }

  // Essieu 2 (arrière du bogie)
  const c2: Point = { x: center.x - tan.x * axleDist, y: center.y - tan.y * axleDist }
  const axle2: BogieAxle = {
    center: c2,
    left: { x: c2.x + norm.x * axleHalfW, y: c2.y + norm.y * axleHalfW },
    right: { x: c2.x - norm.x * axleHalfW, y: c2.y - norm.y * axleHalfW },
    leftWheel: { x: c2.x + norm.x * wheelHalfGauge, y: c2.y + norm.y * wheelHalfGauge },
    rightWheel: { x: c2.x - norm.x * wheelHalfGauge, y: c2.y - norm.y * wheelHalfGauge },
  }

  return {
    center,
    tangent: tan,
    normal: norm,
    polygon: [fl, fr, rr, rl],
    axles: [axle1, axle2],
    pos: { ...pos },
  }
}

/** Get the detailed front and rear bogie geometries with their rotating frame and 2 axles */
export function getLocomotiveBogies(
  net: Network,
  loco: Locomotive
): { front: BogieFrame; rear: BogieFrame } | null {
  const frontFrame = computeBogieFrame(net, loco.front)
  const rearFrame = computeBogieFrame(net, loco.rear)
  if (!frontFrame || !rearFrame) return null
  return { front: frontFrame, rear: rearFrame }
}

export interface TGVPasengerCar {
  index: number
  polygon: Point[]
  windowsLeft: { p1: Point; p2: Point }[]
  windowsRight: { p1: Point; p2: Point }[]
}

export interface TGVAccordion {
  frontFrame: [Point, Point]
  rearFrame: [Point, Point]
  folds: { left: Point; right: Point }[]
}

export interface TGVFullTrain {
  leadLoco: TGVDetails
  rearLoco: TGVDetails | null
  cars: TGVPasengerCar[]
  accordions: TGVAccordion[]
  bogies: BogieFrame[]
}

/** Compute the complete articulated TGV train: lead power car, intermediate jacobs cars, flexible accordions, and reversed rear power car */
export function getFullTGVTrain(net: Network, loco: Locomotive): TGVFullTrain | null {
  const leadLoco = getTGVDetails(net, loco)
  if (!leadLoco) return null
  leadLoco.isRearLoco = false

  const bogiePosList: TrackPosition[] = [loco.front, loco.rear]
  const wagonCount = loco.wagonCount ?? 0

  const carBogiePositions: TrackPosition[] = []
  const carEndpoints: { front: TrackPosition; rear: TrackPosition }[] = []
  let m2FrontPos: TrackPosition | null = null
  let m2RearPos: TrackPosition | null = null

  // Position de l'extrémité arrière de la motrice M1 (à 3.04m derrière le bogie arrière loco.rear)
  const OVERHANG_LOCO = 3.04
  const OVERHANG_CAR = 3.04 // Exactement le même espace que pour la locomotive (3.04m d'attache au bogie)
  const ACCORDION_GAP = 0.80 // Largeur d'intercirculation / soufflet d'accordéon
  const CAR_LENGTH = 18.00 // Longueur totale d'une caisse de wagon
  const CAR_BOGIE_DIST = CAR_LENGTH - 2 * OVERHANG_CAR // Entraxe bogies du wagon = 11.92m

  const posM1Tail = walkBackward(net, loco.rear.segId, loco.rear.t, loco.rear.forward, OVERHANG_LOCO)

  if (wagonCount > 0 && posM1Tail) {
    let prevCarRear: TrackPosition | null = null

    for (let w = 0; w < wagonCount; w++) {
      let carFront: TrackPosition | null = null
      if (w === 0) {
        carFront = walkBackward(net, posM1Tail.segId, posM1Tail.t, posM1Tail.forward, ACCORDION_GAP)
      } else if (prevCarRear) {
        carFront = walkBackward(net, prevCarRear.segId, prevCarRear.t, prevCarRear.forward, ACCORDION_GAP)
      }
      if (!carFront) break

      // 1. Bogie avant du wagon (en retrait de 3.04m, même espace que la motrice !)
      const bogieFront = walkBackward(net, carFront.segId, carFront.t, carFront.forward, OVERHANG_CAR)
      // 2. Bogie arrière du wagon
      const bogieRear = bogieFront
        ? walkBackward(net, bogieFront.segId, bogieFront.t, bogieFront.forward, CAR_BOGIE_DIST)
        : null
      // 3. Face arrière du wagon (à 3.04m après le bogie arrière)
      const carRear = bogieRear
        ? walkBackward(net, bogieRear.segId, bogieRear.t, bogieRear.forward, OVERHANG_CAR)
        : null

      if (!bogieFront || !bogieRear || !carRear) break

      carBogiePositions.push(bogieFront, bogieRear)
      carEndpoints.push({ front: carFront, rear: carRear })
      prevCarRear = carRear
    }

    // Motrice M2 placée après l'accordéon de la dernière voiture
    if (prevCarRear) {
      const m2Tail = walkBackward(net, prevCarRear.segId, prevCarRear.t, prevCarRear.forward, ACCORDION_GAP)
      if (m2Tail) {
        const m2f = walkBackward(net, m2Tail.segId, m2Tail.t, m2Tail.forward, OVERHANG_LOCO)
        if (m2f) {
          const m2r = walkBackward(net, m2f.segId, m2f.t, m2f.forward, loco.bogieDistance)
          if (m2r) {
            m2FrontPos = m2f
            m2RearPos = m2r
          }
        }
      }
    }
  } else if (posM1Tail) {
    // 0 voiture : M1 et M2 directement couplées dos-à-dos avec soufflet
    const m2Tail = walkBackward(net, posM1Tail.segId, posM1Tail.t, posM1Tail.forward, ACCORDION_GAP)
    if (m2Tail) {
      const m2f = walkBackward(net, m2Tail.segId, m2Tail.t, m2Tail.forward, OVERHANG_LOCO)
      if (m2f) {
        const m2r = walkBackward(net, m2f.segId, m2f.t, m2f.forward, loco.bogieDistance)
        if (m2r) {
          m2FrontPos = m2f
          m2RearPos = m2r
        }
      }
    }
  }

  // Ajout de tous les bogies au train
  bogiePosList.push(...carBogiePositions)
  if (m2FrontPos && m2RearPos) {
    bogiePosList.push(m2FrontPos, m2RearPos)
  }

  // Calcul de tous les châssis et essieux de bogies
  const bogies: BogieFrame[] = []
  for (const pos of bogiePosList) {
    const frame = computeBogieFrame(net, pos)
    if (frame) bogies.push(frame)
  }

  // Calcul des voitures voyageurs intermédiaires articulées
  const cars: TGVPasengerCar[] = []
  const accordions: TGVAccordion[] = []

  const w = 1.15 // demi-largeur caisse TGV (2.30m, silhouette affinée)

  // Création des caisses de voitures à partir de leurs extrémités nettes (sans chevauchement)
  for (let i = 0; i < carEndpoints.length; i++) {
    const { front: epF, rear: epR } = carEndpoints[i]
    const pF = positionOnSegment(net, epF.segId, epF.t)
    const pR = positionOnSegment(net, epR.segId, epR.t)
    if (!pF || !pR) continue

    const dx = pF.x - pR.x
    const dy = pF.y - pR.y
    const len = Math.hypot(dx, dy)
    if (len === 0) continue

    const ux = dx / len
    const uy = dy / len
    const nx = -uy
    const ny = ux

    const c1 = { x: pF.x + nx * w, y: pF.y + ny * w }
    const c2 = { x: pF.x - nx * w, y: pF.y - ny * w }
    const c3 = { x: pR.x - nx * w, y: pR.y - ny * w }
    const c4 = { x: pR.x + nx * w, y: pR.y + ny * w }

    // Baies vitrées passagers
    const numWindows = 6
    const winSpan = Math.max(2, len - 3.0)
    const winStep = winSpan / numWindows
    const winLen = winStep * 0.7
    const windowsLeft: { p1: Point; p2: Point }[] = []
    const windowsRight: { p1: Point; p2: Point }[] = []

    for (let wi = 0; wi < numWindows; wi++) {
      const d = 1.5 + wi * winStep
      const pStart = { x: pR.x + ux * d, y: pR.y + uy * d }
      const pEnd = { x: pR.x + ux * (d + winLen), y: pR.y + uy * (d + winLen) }
      windowsLeft.push({
        p1: { x: pStart.x + nx * (w - 0.08), y: pStart.y + ny * (w - 0.08) },
        p2: { x: pEnd.x + nx * (w - 0.08), y: pEnd.y + ny * (w - 0.08) },
      })
      windowsRight.push({
        p1: { x: pStart.x - nx * (w - 0.08), y: pStart.y - ny * (w - 0.08) },
        p2: { x: pEnd.x - nx * (w - 0.08), y: pEnd.y - ny * (w - 0.08) },
      })
    }

    cars.push({
      index: i,
      polygon: [c1, c2, c3, c4],
      windowsLeft,
      windowsRight,
    })
  }

  // Calcul des soufflets accordéons reliant les faces de véhicules
  const createAccordionBetweenFrames = (
    fL: Point,
    fR: Point,
    rL: Point,
    rR: Point
  ): TGVAccordion => {
    const numFolds = 3
    const folds: { left: Point; right: Point }[] = []
    for (let fi = 1; fi <= numFolds; fi++) {
      const s = fi / (numFolds + 1)
      folds.push({
        left: { x: fL.x * (1 - s) + rL.x * s, y: fL.y * (1 - s) + rL.y * s },
        right: { x: fR.x * (1 - s) + rR.x * s, y: fR.y * (1 - s) + rR.y * s },
      })
    }

    return {
      frontFrame: [fL, fR],
      rearFrame: [rL, rR],
      folds,
    }
  }

  // Motrice de queue M2 (orientée vers l'arrière)
  let rearLoco: TGVDetails | null = null
  if (m2FrontPos && m2RearPos) {
    const locoM2: Locomotive = {
      id: `${loco.id}_rear`,
      length: loco.length,
      bogieDistance: loco.bogieDistance,
      front: m2FrontPos,
      rear: m2RearPos,
      direction: (loco.direction === 1 ? -1 : 1) as 1 | -1,
    }
    rearLoco = getTGVDetails(net, locoM2)
    if (rearLoco) {
      rearLoco.isRearLoco = true
    }
  }

  // Cadre arrière de motrice M1 (ancré sur les parois latérales gauche et droite)
  const m1BackL = leadLoco.polygon[4]
  const m1BackR = leadLoco.polygon[5]
  const m1CX = (m1BackL.x + m1BackR.x) / 2
  const m1CY = (m1BackL.y + m1BackR.y) / 2
  const m1DirX = m1BackL.x - m1BackR.x
  const m1DirY = m1BackL.y - m1BackR.y
  const m1DirLen = Math.hypot(m1DirX, m1DirY) || 1
  const m1NormX = m1DirX / m1DirLen
  const m1NormY = m1DirY / m1DirLen
  const accordionHalfWidth = 1.38 // Flancs extérieurs latéraux des soufflets
  const m1FrameL: Point = { x: m1CX + m1NormX * accordionHalfWidth, y: m1CY + m1NormY * accordionHalfWidth }
  const m1FrameR: Point = { x: m1CX - m1NormX * accordionHalfWidth, y: m1CY - m1NormY * accordionHalfWidth }

  if (cars.length > 0) {
    // 1. Accordéon M1 -> Première voiture (Voiture 0)
    const c0 = cars[0].polygon
    const c0FrontCX = (c0[0].x + c0[1].x) / 2
    const c0FrontCY = (c0[0].y + c0[1].y) / 2
    const c0DirX = c0[0].x - c0[1].x
    const c0DirY = c0[0].y - c0[1].y
    const c0DirLen = Math.hypot(c0DirX, c0DirY) || 1
    const c0NormX = c0DirX / c0DirLen
    const c0NormY = c0DirY / c0DirLen
    const c0FrameL: Point = { x: c0FrontCX + c0NormX * accordionHalfWidth, y: c0FrontCY + c0NormY * accordionHalfWidth }
    const c0FrameR: Point = { x: c0FrontCX - c0NormX * accordionHalfWidth, y: c0FrontCY - c0NormY * accordionHalfWidth }

    accordions.push(createAccordionBetweenFrames(m1FrameL, m1FrameR, c0FrameL, c0FrameR))

    // 2. Accordéons entre voitures consécutives au-dessus des bogies Jacobs
    for (let i = 0; i < cars.length - 1; i++) {
      const cA = cars[i].polygon // c3-c4 arrière
      const cB = cars[i + 1].polygon // c1-c2 avant

      const cA_rearCX = (cA[3].x + cA[2].x) / 2
      const cA_rearCY = (cA[3].y + cA[2].y) / 2
      const cA_dirX = cA[3].x - cA[2].x
      const cA_dirY = cA[3].y - cA[2].y
      const cA_len = Math.hypot(cA_dirX, cA_dirY) || 1
      const aNormX = cA_dirX / cA_len
      const aNormY = cA_dirY / cA_len
      const aFrameL: Point = { x: cA_rearCX + aNormX * accordionHalfWidth, y: cA_rearCY + aNormY * accordionHalfWidth }
      const aFrameR: Point = { x: cA_rearCX - aNormX * accordionHalfWidth, y: cA_rearCY - aNormY * accordionHalfWidth }

      const cB_frontCX = (cB[0].x + cB[1].x) / 2
      const cB_frontCY = (cB[0].y + cB[1].y) / 2
      const cB_dirX = cB[0].x - cB[1].x
      const cB_dirY = cB[0].y - cB[1].y
      const cB_len = Math.hypot(cB_dirX, cB_dirY) || 1
      const bNormX = cB_dirX / cB_len
      const bNormY = cB_dirY / cB_len
      const bFrameL: Point = { x: cB_frontCX + bNormX * accordionHalfWidth, y: cB_frontCY + bNormY * accordionHalfWidth }
      const bFrameR: Point = { x: cB_frontCX - bNormX * accordionHalfWidth, y: cB_frontCY - bNormY * accordionHalfWidth }

      accordions.push(createAccordionBetweenFrames(aFrameL, aFrameR, bFrameL, bFrameR))
    }

    // 3. Accordéon Dernière voiture -> M2
    if (rearLoco) {
      const cLast = cars[cars.length - 1].polygon
      const cLast_rearCX = (cLast[3].x + cLast[2].x) / 2
      const cLast_rearCY = (cLast[3].y + cLast[2].y) / 2
      const cLast_dirX = cLast[3].x - cLast[2].x
      const cLast_dirY = cLast[3].y - cLast[2].y
      const cLast_len = Math.hypot(cLast_dirX, cLast_dirY) || 1
      const lastNormX = cLast_dirX / cLast_len
      const lastNormY = cLast_dirY / cLast_len
      const lastFrameL: Point = { x: cLast_rearCX + lastNormX * accordionHalfWidth, y: cLast_rearCY + lastNormY * accordionHalfWidth }
      const lastFrameR: Point = { x: cLast_rearCX - lastNormX * accordionHalfWidth, y: cLast_rearCY - lastNormY * accordionHalfWidth }

      const m2BackL = rearLoco.polygon[4]
      const m2BackR = rearLoco.polygon[5]
      const m2CX = (m2BackL.x + m2BackR.x) / 2
      const m2CY = (m2BackL.y + m2BackR.y) / 2
      // Utiliser lastNorm pour aligner les côtés gauche/droite du train sans torsion 180°
      const m2FrameL: Point = { x: m2CX + lastNormX * accordionHalfWidth, y: m2CY + lastNormY * accordionHalfWidth }
      const m2FrameR: Point = { x: m2CX - lastNormX * accordionHalfWidth, y: m2CY - lastNormY * accordionHalfWidth }

      accordions.push(createAccordionBetweenFrames(lastFrameL, lastFrameR, m2FrameL, m2FrameR))
    }
  } else if (rearLoco) {
    // 0 wagon : accordéon direct entre M1 et M2 dos-à-dos
    const m2BackL = rearLoco.polygon[4]
    const m2BackR = rearLoco.polygon[5]
    const m2CX = (m2BackL.x + m2BackR.x) / 2
    const m2CY = (m2BackL.y + m2BackR.y) / 2
    const m2FrameL: Point = { x: m2CX + m1NormX * accordionHalfWidth, y: m2CY + m1NormY * accordionHalfWidth }
    const m2FrameR: Point = { x: m2CX - m1NormX * accordionHalfWidth, y: m2CY - m1NormY * accordionHalfWidth }

    accordions.push(createAccordionBetweenFrames(m1FrameL, m1FrameR, m2FrameL, m2FrameR))
  }

  return {
    leadLoco,
    rearLoco,
    cars,
    accordions,
    bogies,
  }
}

export function findUpcomingJunction(net: Network, loco: Locomotive): { junction: Junction; approachNodeId: NodeId } | null {
  const { segId, forward } = loco.front
  const dir = loco.direction
  // we look in direction of travel
  let traverseForward = dir === 1 ? forward : !forward

  // walk up to 10 segments to find a junction
  let currentSegId = segId
  for (let i = 0; i < 10; i++) {
    const seg = net.segments.get(currentSegId)
    if (!seg) break

    const exitNodeId = traverseForward ? seg.to : seg.from
    const junc = findJunctionAtNode(net, exitNodeId)
    if (junc) {
      return { junction: junc, approachNodeId: exitNodeId }
    }

    const prevNodeId = traverseForward ? seg.from : seg.to
    const adj = net.adjacency.get(exitNodeId) || []
    
    let nextSegId: SegmentId | null = null
    for (const sid of adj) {
      if (sid === currentSegId) continue
      const s = net.segments.get(sid)
      if (!s) continue
      const nextNodeId = s.from === exitNodeId ? s.to : s.from

      if (isTransitionAllowed(net, prevNodeId, exitNodeId, nextNodeId)) {
        nextSegId = sid
        break
      }
    }

    if (!nextSegId) break
    const nextSeg = net.segments.get(nextSegId)
    if (!nextSeg) break

    if (nextSeg.from === exitNodeId) {
      traverseForward = true
    } else {
      traverseForward = false
    }
    currentSegId = nextSegId
  }

  return null
}

export function steerJunction(net: Network, loco: Locomotive, steerDirection: 'left' | 'right'): boolean {
  const upcoming = findUpcomingJunction(net, loco)
  if (!upcoming) return false

  const { junction, approachNodeId } = upcoming
  const heading = getLocomotiveHeading(net, loco)
  if (!heading) return false

  // check if we are approaching the apex
  if (junction.nodeId === approachNodeId) {
    const getDir = (segId: SegmentId) => {
      const s = net.segments.get(segId)
      if (!s) return { x: 1, y: 0 }
      const other = s.from === junction.nodeId ? s.to : s.from
      const pOther = net.nodes.get(other)
      const pApex = net.nodes.get(junction.nodeId)
      if (!pOther || !pApex) return { x: 1, y: 0 }
      const dx = pOther.pos.x - pApex.pos.x
      const dy = pOther.pos.y - pApex.pos.y
      const len = Math.hypot(dx, dy)
      if (len === 0) return { x: 1, y: 0 }
      return { x: dx / len, y: dy / len }
    }

    if (junction.hand === 'three_way') {
      const dirStraight = getDir(junction.straightSegmentId)
      const dirLeft = getDir(junction.divergingSegmentId)
      const dirRight = junction.divergingRightSegmentId ? getDir(junction.divergingRightSegmentId) : dirLeft

      const crossStraight = heading.x * dirStraight.y - heading.y * dirStraight.x
      const crossLeft = heading.x * dirLeft.y - heading.y * dirLeft.x
      const crossRight = heading.x * dirRight.y - heading.y * dirRight.x

      // Ordered from most left (lowest cross) to most right (highest cross)
      const branches: Array<{ b: 'straight' | 'left' | 'right'; c: number }> = [
        { b: 'straight', c: crossStraight },
        { b: 'left', c: crossLeft },
        { b: 'right', c: crossRight },
      ]
      branches.sort((a, b) => a.c - b.c)

      // Find current branch index
      let currentIdx = branches.findIndex((item) => item.b === junction.activeBranch)
      if (currentIdx === -1) {
        if (junction.activeBranch === 'diverging') {
          currentIdx = branches.findIndex((item) => item.b === 'left')
        }
        if (currentIdx === -1) currentIdx = 0
      }

      // Step by 1 in desired direction
      let nextIdx = currentIdx
      if (steerDirection === 'left') {
        nextIdx = Math.max(0, currentIdx - 1)
      } else {
        nextIdx = Math.min(branches.length - 1, currentIdx + 1)
      }

      setJunctionBranch(junction, branches[nextIdx].b)
      return true
    } else {
      // Standard 2-way turnout (straight & diverging)
      const straightSeg = net.segments.get(junction.straightSegmentId)
      const divSeg = net.segments.get(junction.divergingSegmentId)
      if (!straightSeg || !divSeg) return false

      const dirStraight = getDir(junction.straightSegmentId)
      const dirDiv = getDir(junction.divergingSegmentId)
      const crossStraight = heading.x * dirStraight.y - heading.y * dirStraight.x
      const crossDiv = heading.x * dirDiv.y - heading.y * dirDiv.x

      const branches: Array<{ b: 'straight' | 'diverging'; c: number }> = [
        { b: 'straight', c: crossStraight },
        { b: 'diverging', c: crossDiv },
      ]
      branches.sort((a, b) => a.c - b.c) // 0: left, 1: right

      let currentIdx = branches.findIndex((item) => item.b === junction.activeBranch)
      if (currentIdx === -1) currentIdx = 0

      let nextIdx = currentIdx
      if (steerDirection === 'left') {
        nextIdx = Math.max(0, currentIdx - 1)
      } else {
        nextIdx = Math.min(branches.length - 1, currentIdx + 1)
      }

      setJunctionBranch(junction, branches[nextIdx].b)
      return true
    }
  }

  return false
}

export function snapToNearestTrack(
  net: Network,
  worldPos: Point,
  maxDist: number = Infinity
): { segId: SegmentId; t: number; dist: number } | null {
  let closestSegId: SegmentId | null = null
  let closestT = 0
  let minDist = maxDist

  for (const seg of net.segments.values()) {
    const from = net.nodes.get(seg.from)
    const to = net.nodes.get(seg.to)
    if (!from || !to) continue

    const N = 32
    for (let i = 0; i <= N; i++) {
      const t = i / N
      let p: Point
      if (seg.kind === 'straight' || !seg.via) {
        p = {
          x: from.pos.x + (to.pos.x - from.pos.x) * t,
          y: from.pos.y + (to.pos.y - from.pos.y) * t,
        }
      } else {
        p = bezierPoint(t, from.pos, seg.via, to.pos)
      }

      const dist = Math.hypot(p.x - worldPos.x, p.y - worldPos.y)
      if (dist < minDist) {
        minDist = dist
        closestSegId = seg.id
        closestT = t
      }
    }
  }

  if (closestSegId) {
    return { segId: closestSegId, t: closestT, dist: minDist }
  }
  return null
}

/**
 * Reverse the TGV trainset by swapping the active control cab to the opposite locomotive.
 * The rear power car (M2) becomes the new active leading locomotive (M1),
 * while the former leading locomotive becomes the rear power car.
 * This guarantees the train always travels forward with its aerodynamic nose leading.
 */
export function reverseTGVTrain(net: Network, loco: Locomotive): Locomotive | null {
  const wagonCount = loco.wagonCount ?? 0
  let m2FrontPos: TrackPosition | null = null
  let m2RearPos: TrackPosition | null = null

  if (wagonCount > 0) {
    let curBogie = walkBackward(net, loco.rear.segId, loco.rear.t, loco.rear.forward, 4.10)
    if (curBogie) {
      for (let w = 0; w < wagonCount; w++) {
        const nextB = walkBackward(net, curBogie.segId, curBogie.t, curBogie.forward, 18.0)
        if (!nextB) break
        curBogie = nextB
      }
      const m2f = walkBackward(net, curBogie.segId, curBogie.t, curBogie.forward, 4.10)
      if (m2f) {
        const m2r = walkBackward(net, m2f.segId, m2f.t, m2f.forward, loco.bogieDistance)
        if (m2r) {
          m2FrontPos = m2f
          m2RearPos = m2r
        }
      }
    }
  } else {
    const m2f = walkBackward(net, loco.rear.segId, loco.rear.t, loco.rear.forward, 6.80)
    if (m2f) {
      const m2r = walkBackward(net, m2f.segId, m2f.t, m2f.forward, loco.bogieDistance)
      if (m2r) {
        m2FrontPos = m2f
        m2RearPos = m2r
      }
    }
  }

  if (!m2FrontPos || !m2RearPos) {
    loco.direction = loco.direction === 1 ? -1 : 1
    return loco
  }

  // La nouvelle motrice de tête est M2 : son bogie de nez devient le nouveau front,
  // et son orientation de progression s'inverse pour avancer vers son nez
  const newFront: TrackPosition = {
    segId: m2RearPos.segId,
    t: m2RearPos.t,
    forward: !m2RearPos.forward,
  }

  const newRear = walkBackward(net, newFront.segId, newFront.t, newFront.forward, loco.bogieDistance)
  if (!newRear) {
    loco.direction = loco.direction === 1 ? -1 : 1
    return loco
  }

  loco.front = newFront
  loco.rear = newRear
  loco.direction = 1 // Toujours marche avant depuis la nouvelle cabine active

  return loco
}

/** Test if a 2D point is inside a polygon */
export function isPointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    const intersect = ((yi > p.y) !== (yj > p.y)) && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/** Distance between point p and segment [a, b] */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Test if a 2D point is inside or within tolerance of a polygon */
export function isPointNearPolygon(p: Point, poly: Point[], tolerance = 2.0): boolean {
  if (isPointInPolygon(p, poly)) return true
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (distToSegment(p, poly[i], poly[j]) <= tolerance) return true
  }
  return false
}

export interface TrainHitResult {
  hit: boolean
  part: 'lead' | 'rear' | 'car' | 'none'
  carIndex?: number
  anchorPoint?: Point
}

/** Detect if a world point touches the TGV train (lead engine, cars, or rear engine) */
export function hitTestTGVTrain(
  net: Network,
  loco: Locomotive,
  worldPt: Point,
  tolerance = 2.5
): TrainHitResult {
  const train = getFullTGVTrain(net, loco)
  if (!train) return { hit: false, part: 'none' }

  // 1. Motrice de tête (lead loco)
  if (isPointNearPolygon(worldPt, train.leadLoco.polygon, tolerance)) {
    return { hit: true, part: 'lead', anchorPoint: train.leadLoco.polygon[0] }
  }

  // 2. Motrice de queue (rear loco)
  if (train.rearLoco && isPointNearPolygon(worldPt, train.rearLoco.polygon, tolerance)) {
    return { hit: true, part: 'rear', anchorPoint: train.rearLoco.polygon[0] }
  }

  // 3. Voitures voyageurs
  for (let i = 0; i < train.cars.length; i++) {
    const car = train.cars[i]
    if (isPointNearPolygon(worldPt, car.polygon, tolerance)) {
      const cCenter = {
        x: (car.polygon[0].x + car.polygon[2].x) / 2,
        y: (car.polygon[0].y + car.polygon[2].y) / 2,
      }
      return { hit: true, part: 'car', carIndex: i, anchorPoint: cCenter }
    }
  }

  return { hit: false, part: 'none' }
}

export interface TrackCurvature {
  radius: number // in meters (Infinity if straight)
  side: 'left' | 'right' | 'straight'
  outwardNormal: Point // unit vector pointing towards OUTSIDE of curve (centrifugal acceleration direction)
}

/** Compute curvature radius and outward (centrifugal) normal at a given track position */
export function getTrackCurvatureAt(net: Network, pos: TrackPosition): TrackCurvature {
  const seg = net.segments.get(pos.segId)
  if (!seg || seg.kind === 'straight' || !seg.via) {
    return { radius: Infinity, side: 'straight', outwardNormal: { x: 0, y: 0 } }
  }
  const from = net.nodes.get(seg.from)
  const to = net.nodes.get(seg.to)
  if (!from || !to) {
    return { radius: Infinity, side: 'straight', outwardNormal: { x: 0, y: 0 } }
  }
  const radius = curveRadiusAt(pos.t, from.pos, seg.via, to.pos)
  if (!isFinite(radius) || radius > 50000) {
    return { radius: Infinity, side: 'straight', outwardNormal: { x: 0, y: 0 } }
  }

  // Tangent and second derivative along curve parameter t
  const d1 = bezierDerivative1(pos.t, from.pos, seg.via, to.pos)
  const d2 = bezierDerivative2(from.pos, seg.via, to.pos)
  const d2Len = Math.hypot(d2.x, d2.y)
  if (d2Len < 1e-9) {
    return { radius: Infinity, side: 'straight', outwardNormal: { x: 0, y: 0 } }
  }

  // Centrifugal force points away from the center of curvature (opposite to d2)
  const outwardNormal: Point = { x: -d2.x / d2Len, y: -d2.y / d2Len }

  // Determine whether it bends left or right relative to bogie heading
  const bogieTan = pos.forward ? d1 : { x: -d1.x, y: -d1.y }
  const cross = bogieTan.x * d2.y - bogieTan.y * d2.x
  const side = cross > 0 ? 'right' : 'left'

  return {
    radius,
    side,
    outwardNormal,
  }
}

/**
 * Sample consecutive points along the track forward from a position for a specified distance.
 * Useful for stopping distance projection, trajectory previews, and lookahead.
 */
export function sampleForwardTrack(
  net: Network,
  startPos: TrackPosition,
  travelDirection: 1 | -1,
  distanceMeters: number,
  stepMeters = 1.0,
): Point[] {
  const points: Point[] = []
  if (distanceMeters <= 0) return points

  let segId = startPos.segId
  let t = startPos.t
  let forward = travelDirection === 1 ? startPos.forward : !startPos.forward

  const initialPt = positionOnSegment(net, segId, t)
  if (initialPt) points.push(initialPt)

  let distRemaining = distanceMeters
  const maxSteps = 150

  for (let step = 0; step < maxSteps && distRemaining > 0; step++) {
    const dStep = Math.min(stepMeters, distRemaining)
    const seg = net.segments.get(segId)
    if (!seg) break

    const distAvail = forward
      ? segmentPartialLength(net, segId, t, 1)
      : segmentPartialLength(net, segId, 0, t)

    if (dStep <= distAvail + 1e-9) {
      t = moveWithinSegmentForward(net, segId, t, forward, dStep)
      t = Math.max(0, Math.min(1, t))
      distRemaining -= dStep
      const p = positionOnSegment(net, segId, t)
      if (p) points.push(p)
    } else {
      distRemaining -= distAvail
      const exitNodeId = forward ? seg.to : seg.from
      const prevNodeId = forward ? seg.from : seg.to
      const adj = net.adjacency.get(exitNodeId) || []

      let nextSegId: SegmentId | null = null
      for (const sid of adj) {
        if (sid === segId) continue
        const s = net.segments.get(sid)
        if (!s) continue
        const nextNodeId = s.from === exitNodeId ? s.to : s.from
        if (isTransitionAllowed(net, prevNodeId, exitNodeId, nextNodeId)) {
          nextSegId = sid
          break
        }
      }

      if (!nextSegId) break
      const nextSeg = net.segments.get(nextSegId)
      if (!nextSeg) break

      segId = nextSegId
      if (nextSeg.from === exitNodeId) {
        forward = true
        t = 0
      } else {
        forward = false
        t = 1
      }
      const p = positionOnSegment(net, segId, t)
      if (p) points.push(p)
    }
  }

  return points
}


