import type { Network, NodeId, Point, SegmentId, Junction } from './types'
import { generateId } from './network'
import { bezierPoint } from '../geometry/curve'
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
  wagonCount = 0
): Locomotive | null {
  const front: TrackPosition = { segId, t, forward: true }
  const rear = walkBackward(net, segId, t, true, bogieDistance)
  if (!rear) return null

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

  const w = 1.45 // demi-largeur de caisse standard TGV (2.90m)

  // Points du contour aérodynamique TGV (8 sommets)
  // Museau avant
  const noseTipL = { x: frontPivot.x + ux * overhangFront + nx * 0.45, y: frontPivot.y + uy * overhangFront + ny * 0.45 }
  const noseTipR = { x: frontPivot.x + ux * overhangFront - nx * 0.45, y: frontPivot.y + uy * overhangFront - ny * 0.45 }

  // Épaules aérodynamiques du nez
  const shoulderDist = overhangFront * 0.55
  const shoulderL = { x: frontPivot.x + ux * shoulderDist + nx * 1.15, y: frontPivot.y + uy * shoulderDist + ny * 1.15 }
  const shoulderR = { x: frontPivot.x + ux * shoulderDist - nx * 1.15, y: frontPivot.y + uy * shoulderDist - ny * 1.15 }

  // Base du nez au niveau du bogie avant
  const bodyFrontL = { x: frontPivot.x + nx * w, y: frontPivot.y + ny * w }
  const bodyFrontR = { x: frontPivot.x - nx * w, y: frontPivot.y - ny * w }

  // Flancs droits jusqu'au bogie arrière
  const bodyRearL = { x: rearPivot.x + nx * w, y: rearPivot.y + ny * w }
  const bodyRearR = { x: rearPivot.x - nx * w, y: rearPivot.y - ny * w }

  // Face arrière d'attelage (droite pour les futurs wagons)
  const backL = { x: rearPivot.x - ux * overhangRear + nx * (w - 0.05), y: rearPivot.y - uy * overhangRear + ny * (w - 0.05) }
  const backR = { x: rearPivot.x - ux * overhangRear - nx * (w - 0.05), y: rearPivot.y - uy * overhangRear - ny * (w - 0.05) }

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
  const wsL1 = { x: frontPivot.x + ux * wsDist1 + nx * 0.55, y: frontPivot.y + uy * wsDist1 + ny * 0.55 }
  const wsR1 = { x: frontPivot.x + ux * wsDist1 - nx * 0.55, y: frontPivot.y + uy * wsDist1 - ny * 0.55 }
  const wsR2 = { x: frontPivot.x + ux * wsDist2 - nx * 0.95, y: frontPivot.y + uy * wsDist2 - ny * 0.95 }
  const wsL2 = { x: frontPivot.x + ux * wsDist2 + nx * 0.95, y: frontPivot.y + uy * wsDist2 + ny * 0.95 }
  const windshield = [wsL1, wsR1, wsR2, wsL2]

  // Phares avant (feux de tête)
  const hlDist = overhangFront * 0.88
  const headlights = {
    left: { x: frontPivot.x + ux * hlDist + nx * 0.40, y: frontPivot.y + uy * hlDist + ny * 0.40 },
    right: { x: frontPivot.x + ux * hlDist - nx * 0.40, y: frontPivot.y + uy * hlDist - ny * 0.40 },
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
  const gw1 = { x: backL.x - ux * 0.25 + nx * (0.6 - (w - 0.05)), y: backL.y - uy * 0.25 + ny * (0.6 - (w - 0.05)) }
  const gw2 = { x: backR.x - ux * 0.25 - nx * (0.6 - (w - 0.05)), y: backR.y - uy * 0.25 - ny * (0.6 - (w - 0.05)) }
  const gw3 = { x: backR.x - nx * (0.6 - (w - 0.05)), y: backR.y - ny * (0.6 - (w - 0.05)) }
  const gw4 = { x: backL.x + nx * (0.6 - (w - 0.05)), y: backL.y + ny * (0.6 - (w - 0.05)) }
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
}

/** Compute the geometry for a bogie (châssis orienté + 2 essieux pivotant selon la voie locale) */
export function computeBogieFrame(net: Network, pos: TrackPosition): BogieFrame | null {
  const center = positionOnSegment(net, pos.segId, pos.t)
  const rawTan = tangentOnSegment(net, pos.segId, pos.t)
  if (!center || !rawTan) return null

  const tan: Point = pos.forward ? rawTan : { x: -rawTan.x, y: -rawTan.y }
  const norm: Point = { x: -tan.y, y: tan.x }

  // Dimensions géométriques d'un bogie ferroviaire (en mètres)
  const halfL = 1.6 // Châssis de 3.2m de longueur
  const halfW = 1.05 // Châssis de 2.1m de largeur
  const axleDist = 1.15 // Empattement entre essieux de 2.3m (±1.15m du centre de rotation)
  const axleHalfW = 0.95 // Largeur de l'axe transversal avec boîtes d'essieu
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
  const jacobsPosList: TrackPosition[] = []
  let m2FrontPos: TrackPosition | null = null
  let m2RearPos: TrackPosition | null = null

  const wagonCount = loco.wagonCount ?? 0
  if (wagonCount > 0) {
    let lastPos = loco.rear
    for (let w = 0; w < wagonCount; w++) {
      const dist = w === 0 ? 18.0 : 18.5
      const nextB = walkBackward(net, lastPos.segId, lastPos.t, lastPos.forward, dist)
      if (!nextB) break
      jacobsPosList.push(nextB)
      lastPos = nextB
    }

    if (jacobsPosList.length > 0) {
      const m2f = walkBackward(net, lastPos.segId, lastPos.t, lastPos.forward, 18.0)
      if (m2f) {
        const m2r = walkBackward(net, m2f.segId, m2f.t, m2f.forward, loco.bogieDistance)
        if (m2r) {
          m2FrontPos = m2f
          m2RearPos = m2r
        }
      }
    }
  }

  bogiePosList.push(...jacobsPosList)
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

  const carPivots: { front: Point; rear: Point }[] = []
  for (let i = 0; i < jacobsPosList.length; i++) {
    const prevPos = i === 0 ? loco.rear : jacobsPosList[i - 1]
    const currPos = jacobsPosList[i]
    const pFront = positionOnSegment(net, prevPos.segId, prevPos.t)
    const pRear = positionOnSegment(net, currPos.segId, currPos.t)
    if (pFront && pRear) {
      carPivots.push({ front: pFront, rear: pRear })
    }
  }

  const w = 1.45 // demi-largeur caisse TGV (2.90m)

  // Création des caisses de voitures
  for (let i = 0; i < carPivots.length; i++) {
    const { front: pF, rear: pR } = carPivots[i]
    const dx = pF.x - pR.x
    const dy = pF.y - pR.y
    const len = Math.hypot(dx, dy)
    if (len === 0) continue

    const ux = dx / len
    const uy = dy / len
    const nx = -uy
    const ny = ux

    const overhang = 0.35 // débordement de caisse
    const c1 = { x: pF.x + ux * overhang + nx * w, y: pF.y + uy * overhang + ny * w }
    const c2 = { x: pF.x + ux * overhang - nx * w, y: pF.y + uy * overhang - ny * w }
    const c3 = { x: pR.x - ux * overhang - nx * w, y: pR.y - uy * overhang - ny * w }
    const c4 = { x: pR.x - ux * overhang + nx * w, y: pR.y - uy * overhang + ny * w }

    // Baies vitrées passagers
    const numWindows = 6
    const winSpan = len - 3.0
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

  // Calcul des soufflets accordéons flexibles reliant les véhicules consécutifs
  const createAccordion = (
    tailCenter: Point,
    tailNorm: Point,
    headCenter: Point,
    headNorm: Point,
    bellowHalfW = 1.15
  ): TGVAccordion => {
    const fL = { x: tailCenter.x + tailNorm.x * bellowHalfW, y: tailCenter.y + tailNorm.y * bellowHalfW }
    const fR = { x: tailCenter.x - tailNorm.x * bellowHalfW, y: tailCenter.y - tailNorm.y * bellowHalfW }
    const rL = { x: headCenter.x + headNorm.x * bellowHalfW, y: headCenter.y + headNorm.y * bellowHalfW }
    const rR = { x: headCenter.x - headNorm.x * bellowHalfW, y: headCenter.y - headNorm.y * bellowHalfW }

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

  // Accordéon M1 -> Voiture 0
  if (cars.length > 0) {
    const pRearM1 = positionOnSegment(net, loco.rear.segId, loco.rear.t)
    const pFrontC0 = carPivots[0].front
    const tanM1 = tangentOnSegment(net, loco.rear.segId, loco.rear.t)
    if (pRearM1 && pFrontC0 && tanM1) {
      const dirM1 = loco.direction === 1 ? tanM1 : { x: -tanM1.x, y: -tanM1.y }
      const normM1 = { x: -dirM1.y, y: dirM1.x }
      const { front: pF0, rear: pR0 } = carPivots[0]
      const d0x = pF0.x - pR0.x
      const d0y = pF0.y - pR0.y
      const d0len = Math.hypot(d0x, d0y) || 1
      const normC0 = { x: -d0y / d0len, y: d0x / d0len }

      const tailM1 = { x: pRearM1.x - dirM1.x * 2.3, y: pRearM1.y - dirM1.y * 2.3 }
      const headC0 = { x: pF0.x + (d0x / d0len) * 0.35, y: pF0.y + (d0y / d0len) * 0.35 }
      accordions.push(createAccordion(tailM1, normM1, headC0, normC0))
    }
  }

  // Accordéons entre voitures consécutives
  for (let i = 0; i < cars.length - 1; i++) {
    const pPivotA = carPivots[i]
    const pPivotB = carPivots[i + 1]

    const dxA = pPivotA.front.x - pPivotA.rear.x
    const dyA = pPivotA.front.y - pPivotA.rear.y
    const lenA = Math.hypot(dxA, dyA) || 1
    const normA = { x: -dyA / lenA, y: dxA / lenA }

    const dxB = pPivotB.front.x - pPivotB.rear.x
    const dyB = pPivotB.front.y - pPivotB.rear.y
    const lenB = Math.hypot(dxB, dyB) || 1
    const normB = { x: -dyB / lenB, y: dxB / lenB }

    const tailA = { x: pPivotA.rear.x - (dxA / lenA) * 0.35, y: pPivotA.rear.y - (dyA / lenA) * 0.35 }
    const headB = { x: pPivotB.front.x + (dxB / lenB) * 0.35, y: pPivotB.front.y + (dyB / lenB) * 0.35 }

    accordions.push(createAccordion(tailA, normA, headB, normB))
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

    // Accordéon entre la dernière voiture et M2
    if (cars.length > 0) {
      const lastCarPivot = carPivots[cars.length - 1]
      const dxLast = lastCarPivot.front.x - lastCarPivot.rear.x
      const dyLast = lastCarPivot.front.y - lastCarPivot.rear.y
      const lenLast = Math.hypot(dxLast, dyLast) || 1
      const normLast = { x: -dyLast / lenLast, y: dxLast / lenLast }

      const pFrontM2 = positionOnSegment(net, m2FrontPos.segId, m2FrontPos.t)
      const tanM2 = tangentOnSegment(net, m2FrontPos.segId, m2FrontPos.t)
      if (pFrontM2 && tanM2) {
        const dirM2 = locoM2.direction === 1 ? tanM2 : { x: -tanM2.x, y: -tanM2.y }
        const normM2 = { x: -dirM2.y, y: dirM2.x }
        const tailCar = { x: lastCarPivot.rear.x - (dxLast / lenLast) * 0.35, y: lastCarPivot.rear.y - (dyLast / lenLast) * 0.35 }
        const headM2 = { x: pFrontM2.x + dirM2.x * 2.3, y: pFrontM2.y + dirM2.y * 2.3 }
        accordions.push(createAccordion(tailCar, normLast, headM2, normM2))
      }
    }
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

export function snapToNearestTrack(net: Network, worldPos: Point): { segId: SegmentId; t: number } | null {
  let closestSegId: SegmentId | null = null
  let closestT = 0
  let minDist = Infinity

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
    return { segId: closestSegId, t: closestT }
  }
  return null
}
