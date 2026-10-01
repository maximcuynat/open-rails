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
    const len = segmentArcLength(net, currentSegId)
    if (len === 0) return null

    const distAvail = forward ? t * len : (1 - t) * len

    if (distRemaining <= distAvail) {
      const dt = distRemaining / len
      t = forward ? t - dt : t + dt
      return { segId: currentSegId, t, forward }
    }

    distRemaining -= distAvail
    const seg = net.segments.get(currentSegId)
    if (!seg) return null

    const exitNodeId = forward ? seg.from : seg.to
    const adj = net.adjacency.get(exitNodeId) || []
    
    let prevSegId: SegmentId | null = null

    // For simplicity, find a segment that allows transition from the exit node towards it
    // Wait, since we are going backward, we are entering exitNodeId from currentSegId
    // and want to exit via some prevSegId.
    for (const sid of adj) {
      if (sid === currentSegId) continue
      const s = net.segments.get(sid)
      if (!s) continue
      
      const nextNodeId = s.from === exitNodeId ? s.to : s.from
      // We are travelling backwards, so the 'front' of the train entered exitNodeId from some node
      // Actually, if we just check isTransitionAllowed:
      // prevNodeId = nextNodeId (where the rear is coming from)
      // currNodeId = exitNodeId
      // nextNodeId = the node currentSeg goes to
      const currentNextNodeId = forward ? seg.to : seg.from
      
      if (isTransitionAllowed(net, nextNodeId, exitNodeId, currentNextNodeId)) {
        prevSegId = sid
        break
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

export function advanceLocomotive(net: Network, loco: Locomotive, deltaMeters: number): boolean {
  let { segId, t, forward } = loco.front
  let distRemaining = deltaMeters * loco.direction

  if (distRemaining > 0) {
    // move forward
    while (distRemaining > 0) {
      const len = segmentArcLength(net, segId)
      if (len === 0) return false

      const distAvail = forward ? (1 - t) * len : t * len
      if (distRemaining <= distAvail) {
        const dt = distRemaining / len
        t = forward ? t + dt : t - dt
        break
      }

      distRemaining -= distAvail
      const seg = net.segments.get(segId)
      if (!seg) return false

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
      const len = segmentArcLength(net, segId)
      if (len === 0) return false

      const distAvail = forward ? t * len : (1 - t) * len
      if (distRemaining <= distAvail) {
        const dt = distRemaining / len
        t = forward ? t - dt : t + dt
        break
      }

      distRemaining -= distAvail
      const seg = net.segments.get(segId)
      if (!seg) return false

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
    // we must decide between branches
    let leftBranch: 'straight' | 'diverging' | 'left' | 'right' = 'straight'
    let rightBranch: 'straight' | 'diverging' | 'left' | 'right' = 'diverging'

    // determine left/right based on cross product
    const straightSeg = net.segments.get(junction.straightSegmentId)
    const divSeg = net.segments.get(junction.divergingSegmentId)
    
    if (straightSeg && divSeg) {
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
      
      const dirStraight = getDir(junction.straightSegmentId)
      const crossStraight = heading.x * dirStraight.y - heading.y * dirStraight.x
      
      const dirDiv = getDir(junction.divergingSegmentId)
      const crossDiv = heading.x * dirDiv.y - heading.y * dirDiv.x

      if (junction.hand === 'three_way') {
         // for three way, check all branches
         const dirRight = junction.divergingRightSegmentId ? getDir(junction.divergingRightSegmentId) : dirDiv
         const crossRight = heading.x * dirRight.y - heading.y * dirRight.x
         
         const crosses: Array<{ b: 'straight' | 'left' | 'right'; c: number }> = [
           { b: 'straight', c: crossStraight },
           { b: 'left', c: crossDiv },
           { b: 'right', c: crossRight },
         ]
         crosses.sort((a, b) => a.c - b.c)
         
         if (steerDirection === 'left') {
           setJunctionBranch(junction, crosses[0].b)
         } else {
           setJunctionBranch(junction, crosses[2].b)
         }
         return true
      }

      if (crossStraight < crossDiv) { // straight is more 'left'
        leftBranch = 'straight'
        rightBranch = 'diverging'
      } else {
        leftBranch = 'diverging'
        rightBranch = 'straight'
      }

      if (steerDirection === 'left') {
        setJunctionBranch(junction, leftBranch)
      } else {
        setJunctionBranch(junction, rightBranch)
      }
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
