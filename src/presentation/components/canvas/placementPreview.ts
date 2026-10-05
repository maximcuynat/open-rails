import type { Camera } from '@infrastructure/render/camera'
import { hitSegment } from '@domain/models/network'
import type { Point, Network, RailNode } from '@domain/models/types'
import { getTangentForPlacement, getTrackTangentAt, MAX_TRANSITION_DEFLECTION_DEG } from '@domain/geometry/tangent'
import { computeCurveToolGeometry, checkCurveJoins, MAX_FREEFORM_TURN_DEG, type CurveEndJoin } from '@domain/geometry/curveTool'
import { snapStraightLength, computeStraightPiece } from '@domain/profiles/profiles'
import { computeFreeformParallelTurnout } from '@domain/geometry/constructionTemplates'
import { formatDistance, formatRadius, formatAngle, parseDistance } from '@domain/models/units'
import { findTrackPath, type TrackPath, type TrackPoint } from '@domain/services/trackPath'
import type { EditorStore } from '@application/state/editorStore'

/**
 * Geometry of the placement in progress (straight rail, curve, turnout) for the current
 * editor state. Single source for the canvas preview and the contextual bar, so the text
 * near the cursor and the live values of the bar cannot diverge.
 */

/** Find the nearest node within screen pixel tolerance, capped to at most 0.80m real-world distance. */
export function findNearestNode(net: Network, worldPos: Point, maxScreenPx: number, cam: Camera): RailNode | null {
  // Cap snap radius to 0.80m in world space (half UIC track gauge) so distant nodes never grab the cursor
  const maxDistWorld = Math.min(0.80, maxScreenPx / cam.scale)
  let best: RailNode | null = null
  let bestD = maxDistWorld
  for (const node of net.nodes.values()) {
    const d = Math.hypot(worldPos.x - node.pos.x, worldPos.y - node.pos.y)
    if (d < bestD) {
      bestD = d
      best = node
    }
  }
  return best
}

/** Snap a direction vector to standard angles (0°, 15°, 30°, 45°, 90°...). */
export function snapDirection(dir: Point, stepDeg = 15, tolDeg = 6): Point {
  const angleRad = Math.atan2(dir.y, dir.x)
  let angleDeg = (angleRad * 180) / Math.PI
  if (angleDeg < 0) angleDeg += 360
  const nearest = Math.round(angleDeg / stepDeg) * stepDeg
  const diff = Math.abs(angleDeg - nearest)
  if (diff <= tolDeg || Math.abs(diff - 360) <= tolDeg) {
    const rad = (nearest * Math.PI) / 180
    return { x: Math.cos(rad), y: Math.sin(rad) }
  }
  return dir
}

/** World position the construction tools aim at: the snapped cursor when the magnet is on. */
export function placementCursor(store: EditorStore): Point {
  return store.snap ? store.snappedCursor : store.cursorWorld
}

/** Start node of the placement in progress (place / curve / turnout), if any. */
export function pendingPlacementNodeId(store: EditorStore): string | null {
  if (store.tool === 'place') return store.lastNodeId
  if (store.tool === 'curve') return store.curveState.phase === 1 ? store.curveState.startId : null
  if (store.tool === 'turnout') return store.turnoutStartId
  return null
}

export interface PlacePreview {
  startNode: RailNode
  /** Where the rail would end if the user clicked now */
  end: Point
  /** Length of that rail, in metres */
  length: number
  /** The end lands on an existing node */
  isJoinNode: boolean
  /** The end lands on an existing rail (it would be split there) */
  hitSegId: string | null
}

/** Straight rail the place tool would lay from its start node towards the cursor. */
export function resolvePlaceTool(store: EditorStore): PlacePreview | null {
  if (!store.lastNodeId) return null
  const startNode = store.network.nodes.get(store.lastNodeId)
  if (!startNode) return null
  const cam = store.camera
  const cursor = placementCursor(store)
  const tangent = getTangentForPlacement(store.network, store.lastNodeId, cursor)
  const dx = cursor.x - startNode.pos.x
  const dy = cursor.y - startNode.pos.y
  const minLen = store.getMinTrackLength()

  const typedLen = store.isNumericInputActive ? parseDistance(store.numericInput, store.unit) : NaN
  const hasTypedLen = !isNaN(typedLen) && typedLen > 0

  let length: number
  let end: Point
  if (tangent) {
    const dist = Math.max(minLen, dx * tangent.x + dy * tangent.y)
    if (hasTypedLen) {
      length = typedLen
    } else if (store.trackMode === 'freeform') {
      length = store.snap ? Math.max(minLen, Math.round(dist * 10) / 10) : Math.max(minLen, dist)
    } else if (store.selectedStraightLength !== 'auto') {
      length = store.selectedStraightLength
    } else {
      length = snapStraightLength(dist)
    }
    end = computeStraightPiece(startNode.pos, tangent, length)
  } else if (store.trackMode === 'freeform' && !hasTypedLen) {
    end = cursor
    const rawDist = Math.hypot(dx, dy)
    length = store.snap ? Math.max(minLen, Math.round(rawDist * 10) / 10) : Math.max(minLen, rawDist)
  } else {
    const dist = Math.hypot(dx, dy)
    const dir = dist > 0.01
      ? (store.snap ? snapDirection({ x: dx / dist, y: dy / dist }, 15, 6) : { x: dx / dist, y: dy / dist })
      : { x: 1, y: 0 }
    if (hasTypedLen) {
      length = typedLen
    } else if (store.selectedStraightLength !== 'auto') {
      length = store.selectedStraightLength
    } else {
      length = store.snap ? snapStraightLength(dist) : Math.max(minLen, dist)
    }
    end = computeStraightPiece(startNode.pos, dir, length)
  }

  const closeNode = findNearestNode(store.network, end, 16, cam)
  const isJoinNode = closeNode !== null && closeNode.id !== store.lastNodeId
  const hitSegId = !isJoinNode ? hitSegment(store.network, end, 16 / cam.scale) : null
  return { startNode, end, length, isJoinNode, hitSegId }
}

/**
 * Curve tool geometry for the current editor state and a cursor position.
 * Single source for the preview, the click and the hover snap, so they cannot diverge.
 */
export function resolveCurveTool(store: EditorStore, startId: string, cursor: Point) {
  const startNode = store.network.nodes.get(startId)
  if (!startNode) return null
  const cam = store.camera
  const trackTarget = getTrackTangentAt(store.network, cursor, 24 / cam.scale, startId)
  const startTangent = getTangentForPlacement(store.network, startId, cursor)
  const dx = cursor.x - startNode.pos.x
  const dy = cursor.y - startNode.pos.y
  const len = Math.hypot(dx, dy)
  const fallbackTangent = len > 0.01
    ? (store.snap ? snapDirection({ x: dx / len, y: dy / len }, 15, 6) : { x: dx / len, y: dy / len })
    : { x: 1, y: 0 }
  // Magnetic end: an existing node under the cursor becomes the target
  const closeNode = findNearestNode(store.network, cursor, 16, cam)
  const target = closeNode && closeNode.id !== startId ? closeNode.pos : cursor
  const raw = computeCurveToolGeometry({
    startPos: startNode.pos,
    startTangent,
    fallbackTangent,
    trackTarget,
    cursor: target,
    trackMode: store.trackMode,
    radius: store.selectedCurveRadius,
    angle: store.selectedCurveAngle,
    side: store.autoCurveSide ? 'auto' : store.curveSide,
    limits: store.getPlacementThresholds(),
  })
  // Existing track the end joins: a node (target node, or one under the end), else a segment to split
  let endJoin: CurveEndJoin | null = null
  if (trackTarget?.nodeId && trackTarget.nodeId !== startId) {
    endJoin = { nodeId: trackTarget.nodeId }
  } else {
    const endNode = findNearestNode(store.network, raw.end, 16, cam)
    if (endNode && endNode.id !== startId) {
      endJoin = { nodeId: endNode.id }
    } else {
      const segId = trackTarget?.segId ?? hitSegment(store.network, raw.end, 24 / cam.scale)
      if (segId) endJoin = { segId }
    }
  }
  // Validity covers both joins, so the preview and the click refuse the same curves
  const geom = checkCurveJoins(store.network, startId, raw, endJoin)
  return { startNode, trackTarget, geom, endJoin }
}

export type CurveToolResult = NonNullable<ReturnType<typeof resolveCurveTool>>

export interface CurveReadout {
  /** The click would be refused: `text` is the reason */
  refused: boolean
  /** Full sentence for the label near the cursor */
  text: string
  /** "R 500 m  30° (261 m)": radius, angle and length of the curve */
  dims: string
  /** The curve ends on existing track (node, rail or tangent lock) */
  isJoin: boolean
  /** The curve follows an existing track tangentially (lock / reverse) */
  onTrack: boolean
}

/** What the curve tool says about the curve it would lay: its dimensions, or why it is refused. */
export function describeCurve(store: EditorStore, startId: string, res: CurveToolResult): CurveReadout {
  const { trackTarget, geom } = res
  const { end, radius, angle } = geom
  const cam = store.camera
  const len = geom.length
  const sideLabel = geom.side === -1 ? 'Gauche' : 'Droite'
  const onTrack = geom.kind === 'lock' || geom.kind === 'reverse'
  const closeNode = onTrack ? null : findNearestNode(store.network, end, 16, cam)
  const isJoinNode = onTrack ? trackTarget?.nodeId !== undefined : closeNode !== null && closeNode.id !== startId
  const hitSegId = !onTrack && !isJoinNode ? hitSegment(store.network, end, 16 / cam.scale) : null
  const isJoin = onTrack || isJoinNode || hitSegId !== null
  const dims = `${formatRadius(radius, store.unit)}  ${formatAngle(angle)} (${formatDistance(len, store.unit)})`

  let text: string
  let refused = true
  if (geom.startDeflection > MAX_TRANSITION_DEFLECTION_DEG + 1e-6) {
    text = geom.startDeflection > 165
      ? 'Départ en rebroussement sur la voie existante : visez de l\'autre côté du nœud'
      : `Départ non tangent (${formatAngle(geom.startDeflection)}) : raccord infranchissable, déplacez l'arrivée`
  } else if (geom.endDeflection > MAX_TRANSITION_DEFLECTION_DEG + 1e-6) {
    text = `Arrivée non tangente (${formatAngle(geom.endDeflection)}) : raccord infranchissable`
  } else if (angle > MAX_FREEFORM_TURN_DEG + 1e-6) {
    text = `Tour presque complet (${formatAngle(angle)}) : écartez l'arrivée de l'axe de départ`
  } else if (!geom.valid) {
    text = `Rayon trop serré : ${formatRadius(radius, store.unit)} (min ${formatRadius(store.getPlacementThresholds().minRadius, store.unit)})`
  } else {
    refused = false
    if (geom.kind === 'lock') {
      text = `Aiguillage verrouillé (0°)  ${dims}  → Jonction tangente`
    } else if (geom.kind === 'reverse') {
      const joinSuffix = isJoinNode ? '  → Jonction tangente' : '  → Raccordement tangent (0°)'
      text = radius === Infinity
        ? `Ligne droite ${formatDistance(len, store.unit)}${joinSuffix}`
        : `Courbe ${sideLabel} ${dims}${joinSuffix}`
    } else {
      const joinSuffix = isJoinNode ? '  → Jonction' : hitSegId ? '  → Aiguillage sur voie' : ''
      text = geom.kind === 'freeform'
        ? (radius === Infinity
            ? `Flex ${formatDistance(len, store.unit)}${joinSuffix}`
            : `Flex ${sideLabel} ${dims}${joinSuffix}`)
        : `Courbe ${sideLabel} ${dims}${joinSuffix}`
    }
  }
  return { refused, text, dims, isJoin, onTrack }
}

/** Parallel turnout the turnout tool would lay from its start node towards the cursor. */
export function resolveTurnoutTool(store: EditorStore) {
  if (!store.turnoutStartId) return null
  const startNode = store.network.nodes.get(store.turnoutStartId)
  if (!startNode) return null
  const cursor = placementCursor(store)
  const tangent = getTangentForPlacement(store.network, startNode.id, cursor) ?? { x: 1, y: 0 }
  const limits = store.getPlacementThresholds()
  const geom = computeFreeformParallelTurnout(startNode.pos, tangent, cursor, limits)
  if (!geom) return null
  const text = geom.valid
    ? `Espacement: ${formatDistance(Math.abs(geom.offset), store.unit)} · Longueur: ${formatDistance(geom.dx, store.unit)} (${formatRadius(geom.radius, store.unit)})`
    : `Rayon trop serré : ${formatRadius(geom.radius, store.unit)} (min ${formatRadius(limits.minRadius, store.unit)})`
  return { startNode, geom, text }
}

// ─────────────────── Speed limit tool ───────────────────

/**
 * Place of the track the speed limit tool aims at: the node or the step point the magnet caught,
 * else the rail under the cursor. Null off the track.
 */
export function speedZoneAim(store: EditorStore): TrackPoint | null {
  const magnetised = store.hoverNodeId !== null || !!store.hoverSegSteps?.nearest
  return store.trackPointAt(magnetised ? store.snappedCursor : store.cursorWorld)
}

export interface SpeedZonePreview {
  start: TrackPoint
  /** Where the zone would end; null when the cursor is off the track */
  end: TrackPoint | null
  /** Way the zone would cover; null off the track, or when no track joins the two points */
  path: TrackPath | null
}

let lastZonePath: { net: Network; a: TrackPoint; b: TrackPoint; path: TrackPath | null } | null = null

/** `findTrackPath`, kept while the two points stay the same: the canvas and the bar both ask at every mouse move */
function zonePath(net: Network, a: TrackPoint, b: TrackPoint): TrackPath | null {
  const last = lastZonePath
  if (last && last.net === net && last.a.segId === a.segId && last.a.t === a.t && last.b.segId === b.segId && last.b.t === b.t) {
    return last.path
  }
  const path = findTrackPath(net, a, b)
  lastZonePath = { net, a: { ...a }, b: { ...b }, path }
  return path
}

/** The zone the next click of the speed limit tool would lay, once its start is set. */
export function resolveSpeedZoneTool(store: EditorStore): SpeedZonePreview | null {
  const start = store.speedZoneStart
  if (!store.isSpeedZoneTool || !start) return null
  const end = speedZoneAim(store)
  return { start, end, path: end ? zonePath(store.network, start, end) : null }
}
