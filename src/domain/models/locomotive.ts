import type { Network, NodeId, Point, Segment, SegmentId, Junction, TrackSpan } from './types'
import { generateId, isCloserOrAbove, segmentHeightAt } from './network'
import { curveRadiusAt, bezierDerivative1, bezierDerivative2 } from '../geometry/curve'
import { segmentLength } from '../services/pathfinding'
import { closestParamOnShape, curvatureOnShape, pointOnShape, segmentEnds, segmentShapeLengthBetween, shapeParamAtDistance, tangentOnShape } from '../geometry/segmentGeometry'
import { doubleSlipSideOf, doubleSlipView, findJunctionAtNode, openPassage, turnoutView, type TurnoutBranch } from './junction'
import { openExit, entriesOf, junctionRails } from './routing'

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
  const ends = seg && segmentEnds(net, seg)
  return ends ? pointOnShape(ends, t) : null
}

export function tangentOnSegment(net: Network, segId: SegmentId, t: number): Point | null {
  const seg = net.segments.get(segId)
  const ends = seg && segmentEnds(net, seg)
  return ends ? tangentOnShape(ends, t) : null
}

export function segmentArcLength(net: Network, segId: SegmentId): number {
  const seg = net.segments.get(segId)
  if (!seg) return 0
  return segmentLength(net, seg)
}

export type { TrackSpan }

/** Record of a walk along the track: the stretches covered and the nodes passed, in walk order */
export interface WalkTrace {
  spans: TrackSpan[]
  nodes: NodeId[]
}

export interface WalkOptions {
  /** Receives the track covered by the walk (also when the walk fails part-way) */
  trace?: WalkTrace
  /**
   * Segments a train already stands on. Walking back from the stem of a turnout into its branches,
   * the branch among them is taken whatever the switch says: vehicles that are still on a branch
   * stay on it even if the points have been thrown since they went through.
   */
  stayOn?: ReadonlySet<SegmentId>
}

/** Arc length between two parametric positions on a segment. */
export function segmentPartialLength(net: Network, segId: SegmentId, tStart: number, tEnd: number): number {
  const seg = net.segments.get(segId)
  return seg ? segmentShapeLengthBetween(net, seg, tStart, tEnd) : 0
}

/** Parameter `dist` further back along a segment, for a vehicle heading `forward` (towards `seg.to`) or not */
function moveWithinSegmentBackward(
  net: Network,
  segId: SegmentId,
  currentT: number,
  forward: boolean,
  dist: number
): number {
  const seg = net.segments.get(segId)
  const ends = seg && segmentEnds(net, seg)
  return ends ? shapeParamAtDistance(ends, currentT, forward ? -dist : dist) : currentT
}

/**
 * Traverse backward along track segments from (startSeg, startT, startForward) by distance.
 * Returns the resulting TrackPosition, or null at a dead end or an impassable transition.
 */
export function walkBackward(
  net: Network,
  startSeg: SegmentId,
  startT: number,
  startForward: boolean,
  distance: number,
  options: WalkOptions = {}
): TrackPosition | null {
  const { trace, stayOn } = options
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
      const fromT = t
      t = moveWithinSegmentBackward(net, currentSegId, t, forward, distRemaining)
      // Borner t entre 0 et 1
      t = Math.max(0, Math.min(1, t))
      trace?.spans.push({ segId: currentSegId, t0: fromT, t1: t })
      return { segId: currentSegId, t, forward }
    }

    distRemaining -= distAvail
    const exitNodeId = forward ? seg.from : seg.to
    trace?.spans.push({ segId: currentSegId, t0: t, t1: forward ? 0 : 1 })
    trace?.nodes.push(exitNodeId)

    // The rail the train came by. When the device of the node leaves a single possibility (a
    // branch of a turnout only leads to its stem), that is the one, even with the points set
    // elsewhere. Otherwise the rail the train already occupies, then the one the points are set to.
    const possible = entriesOf(net, exitNodeId, currentSegId, { anyPosition: true })
    const held = stayOn ? possible.filter((sid) => stayOn.has(sid)) : []
    const prevSegId: SegmentId | null =
      possible.length === 1
        ? possible[0]
        : held.length === 1
          ? held[0]
          : entriesOf(net, exitNodeId, currentSegId)[0] ?? null

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

/** Parameter `dist` further on along a segment, for a vehicle heading `forward` (towards `seg.to`) or not */
function moveWithinSegmentForward(
  net: Network,
  segId: SegmentId,
  currentT: number,
  forward: boolean,
  dist: number
): number {
  const seg = net.segments.get(segId)
  const ends = seg && segmentEnds(net, seg)
  return ends ? shapeParamAtDistance(ends, currentT, forward ? dist : -dist) : currentT
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
  distance: number,
  options: WalkOptions = {}
): TrackPosition | null {
  const { trace } = options
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
      const fromT = t
      t = moveWithinSegmentForward(net, segId, t, forward, distRemaining)
      t = Math.max(0, Math.min(1, t))
      trace?.spans.push({ segId, t0: fromT, t1: t })
      return { segId, t, forward }
    }

    distRemaining -= distAvail

    const exitNodeId = forward ? seg.to : seg.from
    trace?.spans.push({ segId, t0: t, t1: forward ? 1 : 0 })
    trace?.nodes.push(exitNodeId)

    const nextSegId = openExit(net, exitNodeId, segId)

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

/**
 * Move a locomotive by deltaMeters * direction along the track.
 * All-or-nothing: returns false and leaves the locomotive untouched when the move is not possible.
 * `stayOn` (see WalkOptions) keeps the rear bogie on the turnout branch it already stands on.
 */
export function advanceLocomotive(
  net: Network,
  loco: Locomotive,
  deltaMeters: number,
  stayOn?: ReadonlySet<SegmentId>,
): boolean {
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

      const nextSegId = openExit(net, exitNodeId, segId)

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

      const prevSegId = entriesOf(net, exitNodeId, segId)[0] ?? null

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

  const rear = walkBackward(net, segId, t, forward, loco.bogieDistance, { stayOn })
  if (!rear) return false
  loco.front = { segId, t, forward }
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

/** Body dimensions of a power car, when they do not follow from `loco.length` (meters) */
export interface TGVBodyShape {
  noseOverhang: number
  rearOverhang: number
  halfWidth: number
}

export function getTGVDetails(net: Network, loco: Locomotive, shape?: TGVBodyShape): TGVDetails | null {
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
  const overhangFront = shape?.noseOverhang ?? (totalLength - loco.bogieDistance) * 0.62 // long nez profilé (~3.7m)
  const overhangRear = shape?.rearOverhang ?? totalLength - loco.bogieDistance - overhangFront // arrière (~2.3m)

  const w = shape?.halfWidth ?? 1.15 // demi-largeur de caisse profilée TGV (2.30m, silhouette affinée)
  const k = w / 1.15 // the nose narrows in proportion to the body width

  // Points du contour aérodynamique TGV (8 sommets)
  // Museau avant
  const noseTipL = { x: frontPivot.x + ux * overhangFront + nx * 0.32 * k, y: frontPivot.y + uy * overhangFront + ny * 0.32 * k }
  const noseTipR = { x: frontPivot.x + ux * overhangFront - nx * 0.32 * k, y: frontPivot.y + uy * overhangFront - ny * 0.32 * k }

  // Épaules aérodynamiques du nez
  const shoulderDist = overhangFront * 0.55
  const shoulderL = { x: frontPivot.x + ux * shoulderDist + nx * 0.90 * k, y: frontPivot.y + uy * shoulderDist + ny * 0.90 * k }
  const shoulderR = { x: frontPivot.x + ux * shoulderDist - nx * 0.90 * k, y: frontPivot.y + uy * shoulderDist - ny * 0.90 * k }

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

/** A branch of a turnout */
export type JunctionBranch = TurnoutBranch

/** The next turnout on the route of a train, i.e. the one the steering keys throw */
export interface JunctionAhead {
  junction: Junction
  /** Track distance (meters) from the start position to the points */
  distance: number
  /** Unit travel direction on reaching the points */
  heading: Point
  /** True when arriving by the stem (the points pick the route), false when arriving by a branch */
  facing: boolean
  /** False when arriving by a branch the points are not set to: the route ends at the points */
  open: boolean
  /** The branches from left to right as seen when reaching the points */
  branches: JunctionBranch[]
  /** The branch of `branches` the points are set to */
  activeBranch: JunctionBranch
  /** The rail the branches are reached from: the stem of a turnout, the rail of arrival on a double slip */
  stemSegmentId: SegmentId
  /** The rail of each branch of `branches` */
  branchRails: SegmentId[]
}

/** Branches of a device ordered from the leftmost to the rightmost for a train travelling along `heading` */
function branchesLeftToRight(
  net: Network,
  nodeId: NodeId,
  heading: Point,
  branches: { branch: JunctionBranch; segId: SegmentId }[],
): { branch: JunctionBranch; segId: SegmentId }[] {
  const apex = net.nodes.get(nodeId)
  const cross = (segId: SegmentId): number => {
    const seg = net.segments.get(segId)
    const other = seg ? net.nodes.get(seg.from === nodeId ? seg.to : seg.from) : undefined
    let dir = { x: 1, y: 0 }
    if (apex && other) {
      const dx = other.pos.x - apex.pos.x
      const dy = other.pos.y - apex.pos.y
      const len = Math.hypot(dx, dy)
      if (len > 0) dir = { x: dx / len, y: dy / len }
    }
    return heading.x * dir.y - heading.y * dir.x
  }
  // Lowest cross product is the leftmost branch
  return branches
    .map((item) => ({ item, c: cross(item.segId) }))
    .sort((a, b) => a.c - b.c)
    .map(({ item }) => item)
}

/**
 * Find the first turnout on the route ahead of a track position (within 10 segments), whether it is
 * met by its points (facing) or by one of its branches (trailing). A double slip is always met by
 * the points of its far side, which pick the rail the train leaves on; it is open when the points
 * of the near side are set to the rail the train arrives on.
 */
export function findJunctionAhead(net: Network, startPos: TrackPosition, travelDirection: 1 | -1): JunctionAhead | null {
  let currentSegId = startPos.segId
  let traverseForward = travelDirection === 1 ? startPos.forward : !startPos.forward
  let distance = traverseForward
    ? segmentPartialLength(net, currentSegId, startPos.t, 1)
    : segmentPartialLength(net, currentSegId, 0, startPos.t)

  for (let i = 0; i < 10; i++) {
    const seg = net.segments.get(currentSegId)
    if (!seg) break

    const exitNodeId = traverseForward ? seg.to : seg.from
    const junction = findJunctionAtNode(net, exitNodeId)
    const view = junction ? turnoutView(net, junction) : null
    const slip = junction ? doubleSlipView(junction) : null
    const nearSide = junction && slip ? doubleSlipSideOf(junction, seg.id) : null
    const headingAtExit = (): Point => {
      const tangent = tangentOnSegment(net, seg.id, traverseForward ? 1 : 0) ?? { x: 1, y: 0 }
      return traverseForward ? tangent : { x: -tangent.x, y: -tangent.y }
    }
    // A track that merely crosses the points of a turnout is not concerned by it
    if (junction && view && junctionRails(junction).includes(seg.id)) {
      const heading = headingAtExit()
      const facing = seg.id === view.stemSegmentId
      const names: JunctionBranch[] = view.hand === 'three_way' ? ['straight', 'left', 'right'] : ['straight', 'diverging']
      const rails = [view.straightSegmentId, view.divergingSegmentId, view.divergingRightSegmentId]
      const branches = branchesLeftToRight(
        net,
        junction.nodeId,
        heading,
        names.map((branch, k) => ({ branch, segId: rails[k]! })),
      )
      return {
        junction,
        distance,
        heading,
        facing,
        open: facing || seg.id === view.activeSegmentId,
        branches: branches.map((item) => item.branch),
        activeBranch: view.activeBranch,
        stemSegmentId: view.stemSegmentId,
        branchRails: branches.map((item) => item.segId),
      }
    }
    if (junction && slip && nearSide !== null) {
      const heading = headingAtExit()
      const farSide = nearSide === 0 ? 1 : 0
      const farRails = slip.sides[farSide]
      const branches = branchesLeftToRight(net, junction.nodeId, heading, [
        { branch: 'straight', segId: farRails[0] },
        { branch: 'diverging', segId: farRails[1] },
      ])
      return {
        junction,
        distance,
        heading,
        facing: true,
        open: slip.sides[nearSide][slip.active[nearSide]] === seg.id,
        branches: branches.map((item) => item.branch),
        activeBranch: slip.active[farSide] === 0 ? 'straight' : 'diverging',
        stemSegmentId: seg.id,
        branchRails: branches.map((item) => item.segId),
      }
    }

    const nextSegId = openExit(net, exitNodeId, currentSegId)

    if (!nextSegId) break
    const nextSeg = net.segments.get(nextSegId)
    if (!nextSeg) break

    traverseForward = nextSeg.from === exitNodeId
    currentSegId = nextSegId
    distance += segmentPartialLength(net, nextSegId, 0, 1)
  }

  return null
}

export function findUpcomingJunction(net: Network, loco: Locomotive): { junction: Junction; approachNodeId: NodeId } | null {
  const ahead = findJunctionAhead(net, loco.front, loco.direction)
  return ahead ? { junction: ahead.junction, approachNodeId: ahead.junction.nodeId } : null
}

/**
 * Throw the upcoming junction one branch to the left or to the right, as seen by a train
 * reaching its points. Returns false when there is no junction ahead.
 */
export function steerJunction(net: Network, loco: Locomotive, steerDirection: 'left' | 'right'): boolean {
  const ahead = findJunctionAhead(net, loco.front, loco.direction)
  if (!ahead) return false

  const { junction, branches } = ahead

  const currentIdx = branches.indexOf(ahead.activeBranch)
  const nextIdx = steerDirection === 'left'
    ? Math.max(0, currentIdx - 1)
    : Math.min(branches.length - 1, currentIdx + 1)
  // On a double slip this also sets the near points to the rail the train arrives on
  return openPassage(junction, ahead.stemSegmentId, ahead.branchRails[nextIdx])
}

/** Closest point of one segment to a world position: its parameter `t` and the point itself. */
export function projectOnSegment(net: Network, seg: Segment, worldPos: Point): { t: number; point: Point } | null {
  const ends = segmentEnds(net, seg)
  if (!ends) return null
  const t = closestParamOnShape(ends, worldPos)
  return { t, point: pointOnShape(ends, t) }
}

export function snapToNearestTrack(
  net: Network,
  worldPos: Point,
  maxDist: number = Infinity
): { segId: SegmentId; t: number; dist: number } | null {
  let closestSegId: SegmentId | null = null
  let closestT = 0
  let minDist = maxDist
  let closestLevel = 0

  for (const seg of net.segments.values()) {
    const proj = projectOnSegment(net, seg, worldPos)
    if (!proj) continue
    const { t, point: p } = proj

    const dist = Math.hypot(p.x - worldPos.x, p.y - worldPos.y)
    if (dist >= maxDist) continue
    // Of two stacked rails, the one that is higher there (the one that is seen) is picked
    const level = segmentHeightAt(net, seg, t)
    if (closestSegId === null || isCloserOrAbove(dist, level, minDist, closestLevel)) {
      minDist = dist
      closestLevel = level
      closestSegId = seg.id
      closestT = t
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
  if (seg?.kind === 'path') {
    // On a long rail the curvature is that of the arc under the bogie
    const ends = segmentEnds(net, seg)
    const curvature = ends ? curvatureOnShape(ends, pos.t) : 0
    if (!ends || Math.abs(curvature) < 1 / 50000) return { radius: Infinity, side: 'straight', outwardNormal: { x: 0, y: 0 } }
    const tangent = tangentOnShape(ends, pos.t)
    // The centre lies to the side the heading turns to; the centrifugal push points away from it
    const towardsCentre = curvature > 0 ? { x: -tangent.y, y: tangent.x } : { x: tangent.y, y: -tangent.x }
    const turnsToIncreasingHeading = pos.forward ? curvature > 0 : curvature < 0
    return {
      radius: 1 / Math.abs(curvature),
      side: turnsToIncreasingHeading ? 'right' : 'left',
      outwardNormal: { x: -towardsCentre.x, y: -towardsCentre.y },
    }
  }
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

      const nextSegId = openExit(net, exitNodeId, segId)

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


