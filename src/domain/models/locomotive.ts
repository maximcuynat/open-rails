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
  bogieDistance = 14
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

export function getLocomotivePolygon(net: Network, loco: Locomotive): Point[] | null {
  const pFront = getLocomotiveFrontPos(net, loco)
  const pRear = getLocomotiveRearPos(net, loco)
  if (!pFront || !pRear) return null

  const dx = pFront.x - pRear.x
  const dy = pFront.y - pRear.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return null

  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux

  const w = 1.5

  const fl = { x: pFront.x + nx * w, y: pFront.y + ny * w }
  const fr = { x: pFront.x - nx * w, y: pFront.y - ny * w }
  const rl = { x: pRear.x + nx * w, y: pRear.y + ny * w }
  const rr = { x: pRear.x - nx * w, y: pRear.y - ny * w }

  const extFront = (loco.length - loco.bogieDistance) / 2
  const nose = { x: pFront.x + ux * extFront, y: pFront.y + uy * extFront }

  if (loco.direction === 1) {
    return [nose, fr, rr, rl, fl]
  } else {
    const noseRev = { x: pRear.x - ux * extFront, y: pRear.y - uy * extFront }
    return [noseRev, rl, fl, fr, rr]
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
