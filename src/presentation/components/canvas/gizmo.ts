import type { Point, Network, Selection, NodeId, SegmentId } from '@domain/models/types'
import { snapToGrid } from '@domain/models/network'
import { bezierPoint } from '@domain/geometry/curve'
import { collectAffectedVias } from '@domain/geometry/nodeTransform'

export type GizmoAxis = 'x' | 'y' | 'rotate'

export interface GizmoAnchor {
  type: 'node' | 'section'
  worldPos: Point
  nodeIds: Set<NodeId>
  /** Initial control point of every curve the move can modify (at least one end in nodeIds). */
  curvedSegments: Map<SegmentId, Point>
}

/**
 * Computes the anchor position for the 2D gizmo based on current selection:
 * - If a node is selected: anchor is directly on the node (anchor.type = 'node').
 * - If a section/segments are selected: anchor is at the geometric center of the track (anchor.type = 'section').
 */
export function getGizmoAnchor(
  net: Network,
  selection: Selection
): GizmoAnchor | null {
  if (selection.nodes.size > 0) {
    const primaryNodeId = [...selection.nodes][selection.nodes.size - 1]
    const primaryNode = net.nodes.get(primaryNodeId)
    if (!primaryNode) return null
    return {
      type: 'node',
      worldPos: { ...primaryNode.pos },
      nodeIds: new Set(selection.nodes),
      curvedSegments: collectAffectedVias(net, selection.nodes),
    }
  }

  if (selection.segments.size > 0) {
    const nodeIds = new Set<NodeId>()
    for (const sid of selection.segments) {
      const seg = net.segments.get(sid)
      if (seg) {
        nodeIds.add(seg.from)
        nodeIds.add(seg.to)
      }
    }
    // Curves of the selection plus the curves attached to its end nodes
    const curvedSegments = collectAffectedVias(net, nodeIds)

    const segArray = [...selection.segments]
    const midSegId = segArray[Math.floor(segArray.length / 2)]
    const midSeg = net.segments.get(midSegId)
    if (!midSeg) return null
    const a = net.nodes.get(midSeg.from)
    const b = net.nodes.get(midSeg.to)
    if (!a || !b) return null

    const center = midSeg.kind === 'curve' && midSeg.via
      ? bezierPoint(0.5, a.pos, midSeg.via, b.pos)
      : { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 }

    return {
      type: 'section',
      worldPos: center,
      nodeIds,
      curvedSegments,
    }
  }

  return null
}

export const GIZMO_LENGTH = 52 // pixels
export const GIZMO_OFFSET = 12 // pixels from node center
export const GIZMO_HEAD_LENGTH = 12 // pixels
export const GIZMO_HEAD_WIDTH = 10 // pixels
export const GIZMO_HIT_TOLERANCE = 12 // pixels tolerance around line & head

export const GIZMO_X_COLOR = '#ef4444' // Red
export const GIZMO_X_HOVER = '#f87171' // Light red
export const GIZMO_Y_COLOR = '#10b981' // Green
export const GIZMO_Y_HOVER = '#34d399' // Light green
export const GIZMO_ROT_RADIUS = 58 // pixels
export const GIZMO_ROT_COLOR = '#38bdf8' // Sky blue
export const GIZMO_ROT_HOVER = '#67e8f9' // Bright cyan

/**
 * Screen rectangle the gizmo handles occupy around their anchor (arrows towards +X and up,
 * rotation arc in the top-right quadrant), grab tolerance included. Nothing else should be
 * drawn there while the gizmo is shown.
 */
export function gizmoFootprint(nodeScreen: Point): { x: number; y: number; w: number; h: number } {
  const reach = Math.max(GIZMO_OFFSET + GIZMO_LENGTH, GIZMO_ROT_RADIUS) + GIZMO_HIT_TOLERANCE
  return {
    x: nodeScreen.x - GIZMO_HIT_TOLERANCE,
    y: nodeScreen.y - reach,
    w: reach + GIZMO_HIT_TOLERANCE,
    h: reach + GIZMO_HIT_TOLERANCE,
  }
}

/**
 * Hit-test to see if screen-space pointer (px, py) is over one of the gizmo handles:
 * - 'x' arrow (horizontal right)
 * - 'y' arrow (vertical up)
 * - 'rotate' arc (top-right quadrant arc at radius GIZMO_ROT_RADIUS)
 */
export function hitTestGizmo(
  pointerScreen: Point,
  nodeScreen: Point,
  tolerance = GIZMO_HIT_TOLERANCE
): GizmoAxis | null {
  const px = pointerScreen.x
  const py = pointerScreen.y
  const sx = nodeScreen.x
  const sy = nodeScreen.y

  // 1. Hit-test X arrow (Horizontal, towards +X / Right)
  const isWithinXRange = px >= sx + GIZMO_OFFSET - 4 && px <= sx + GIZMO_LENGTH + 6
  const isWithinYForX = Math.abs(py - sy) <= tolerance
  const hitX = isWithinXRange && isWithinYForX

  // 2. Hit-test Y arrow (Vertical, towards -ScreenY / Up)
  const isWithinYRange = py <= sy - GIZMO_OFFSET + 4 && py >= sy - GIZMO_LENGTH - 6
  const isWithinXForY = Math.abs(px - sx) <= tolerance
  const hitY = isWithinYRange && isWithinXForY

  if (hitX && hitY) {
    // If ambiguous, pick closest to respective axis line
    const distToXAxis = Math.abs(py - sy)
    const distToYAxis = Math.abs(px - sx)
    return distToXAxis <= distToYAxis ? 'x' : 'y'
  }

  if (hitX) return 'x'
  if (hitY) return 'y'

  // 3. Hit-test Rotation arc in top-right quadrant (between +X and -Y)
  const dx = px - sx
  const dy = py - sy
  if (dx > 0 && dy < 0) {
    const dist = Math.hypot(dx, dy)
    if (dist >= GIZMO_ROT_RADIUS - 7 && dist <= GIZMO_ROT_RADIUS + 7) {
      const angle = Math.atan2(-dy, dx) // angle in [0, PI/2]
      if (angle >= (15 * Math.PI) / 180 && angle <= (75 * Math.PI) / 180) {
        return 'rotate'
      }
    }
  }

  return null
}

/**
 * Constrains dragging along a single axis ('x' or 'y') with optional grid snapping.
 */
export function constrainGizmoDrag(
  axis: GizmoAxis,
  startWorld: Point,
  currentWorld: Point,
  snap: boolean,
  gridSpacing: number
): { pos: Point; delta: Point } {
  if (axis === 'x') {
    const rawDx = currentWorld.x - startWorld.x
    let targetX = startWorld.x + rawDx
    if (snap && gridSpacing > 0) {
      targetX = snapToGrid({ x: targetX, y: startWorld.y }, gridSpacing).x
    }
    const finalDx = targetX - startWorld.x
    return {
      pos: { x: targetX, y: startWorld.y },
      delta: { x: finalDx, y: 0 },
    }
  } else {
    const rawDy = currentWorld.y - startWorld.y
    let targetY = startWorld.y + rawDy
    if (snap && gridSpacing > 0) {
      targetY = snapToGrid({ x: startWorld.x, y: targetY }, gridSpacing).y
    }
    const finalDy = targetY - startWorld.y
    return {
      pos: { x: startWorld.x, y: targetY },
      delta: { x: 0, y: finalDy },
    }
  }
}

/**
 * Calculates rotation delta angle around anchor point, with optional angle snapping.
 */
export function rotateGizmoDrag(
  anchorWorld: Point,
  startWorld: Point,
  currentWorld: Point,
  snap: boolean,
  snapStepDeg = 15
): { angleRad: number; angleDeg: number } {
  const startAngle = Math.atan2(startWorld.y - anchorWorld.y, startWorld.x - anchorWorld.x)
  const currentAngle = Math.atan2(currentWorld.y - anchorWorld.y, currentWorld.x - anchorWorld.x)
  let deltaRad = currentAngle - startAngle
  while (deltaRad > Math.PI) deltaRad -= 2 * Math.PI
  while (deltaRad < -Math.PI) deltaRad += 2 * Math.PI

  let deltaDeg = (deltaRad * 180) / Math.PI
  if (snap && snapStepDeg > 0) {
    deltaDeg = Math.round(deltaDeg / snapStepDeg) * snapStepDeg
    deltaRad = (deltaDeg * Math.PI) / 180
  }
  return { angleRad: deltaRad, angleDeg: deltaDeg }
}

/**
 * Rotates a 2D point around a center origin by an angle in radians.
 */
export function rotatePoint(p: Point, center: Point, angleRad: number): Point {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  const dx = p.x - center.x
  const dy = p.y - center.y
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  }
}

export interface RenderGizmoOptions {
  delta?: Point
  angleDeg?: number
  unit?: string
  canvasWidth?: number
  canvasHeight?: number
}

/**
 * Render the 2D orthogonal translation and rotation gizmo at node screen position.
 */
export function renderTranslationGizmo(
  ctx: CanvasRenderingContext2D,
  nodeScreen: Point,
  hoveredAxis: GizmoAxis | null,
  activeAxis: GizmoAxis | null,
  options: RenderGizmoOptions = {}
): void {
  const sx = nodeScreen.x
  const sy = nodeScreen.y

  ctx.save()

  // 1. If actively dragging an axis, draw infinite guideline through the node
  if (activeAxis) {
    ctx.save()
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1.5
    if (activeAxis === 'x') {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)'
      ctx.beginPath()
      ctx.moveTo(0, sy)
      ctx.lineTo(options.canvasWidth ?? 4000, sy)
      ctx.stroke()
    } else if (activeAxis === 'y') {
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)'
      ctx.beginPath()
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, options.canvasHeight ?? 4000)
      ctx.stroke()
    } else if (activeAxis === 'rotate') {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)'
      ctx.beginPath()
      ctx.arc(sx, sy, GIZMO_ROT_RADIUS, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  // 2. Draw Rotation Arc (top-right quadrant between +X and -Y)
  const isRotActive = activeAxis === 'rotate'
  const isRotHovered = hoveredAxis === 'rotate' || isRotActive
  const colorRot = isRotHovered ? GIZMO_ROT_HOVER : GIZMO_ROT_COLOR
  const lineWidthRot = isRotHovered ? 3 : 2

  ctx.save()
  // Subtle dark shadow outline
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.65)'
  ctx.lineWidth = lineWidthRot + 2
  ctx.beginPath()
  ctx.arc(sx, sy, GIZMO_ROT_RADIUS, -Math.PI * 0.42, -Math.PI * 0.08)
  ctx.stroke()

  ctx.strokeStyle = colorRot
  ctx.lineWidth = lineWidthRot
  ctx.beginPath()
  ctx.arc(sx, sy, GIZMO_ROT_RADIUS, -Math.PI * 0.42, -Math.PI * 0.08)
  ctx.stroke()

  // Pivot handle on arc at -45 deg
  const midAngle = -Math.PI / 4
  const hx = sx + GIZMO_ROT_RADIUS * Math.cos(midAngle)
  const hy = sy + GIZMO_ROT_RADIUS * Math.sin(midAngle)
  ctx.fillStyle = colorRot
  ctx.beginPath()
  ctx.arc(hx, hy, isRotHovered ? 4.5 : 3.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()

  // 3. Draw X Arrow (Red, horizontal right)
  const isXActive = activeAxis === 'x'
  const isXHovered = hoveredAxis === 'x' || isXActive
  const colorX = isXHovered ? GIZMO_X_HOVER : GIZMO_X_COLOR
  const lineWidthX = isXHovered ? 3.5 : 2.5

  ctx.save()
  // Subtle dark outline/shadow for contrast on any background
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.65)'
  ctx.lineWidth = lineWidthX + 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(sx + GIZMO_OFFSET, sy)
  ctx.lineTo(sx + GIZMO_LENGTH - GIZMO_HEAD_LENGTH + 2, sy)
  ctx.stroke()

  // Main shaft
  ctx.strokeStyle = colorX
  ctx.lineWidth = lineWidthX
  ctx.beginPath()
  ctx.moveTo(sx + GIZMO_OFFSET, sy)
  ctx.lineTo(sx + GIZMO_LENGTH - GIZMO_HEAD_LENGTH + 2, sy)
  ctx.stroke()

  // Arrowhead triangle
  ctx.fillStyle = colorX
  ctx.beginPath()
  ctx.moveTo(sx + GIZMO_LENGTH, sy)
  ctx.lineTo(sx + GIZMO_LENGTH - GIZMO_HEAD_LENGTH, sy - GIZMO_HEAD_WIDTH / 2)
  ctx.lineTo(sx + GIZMO_LENGTH - GIZMO_HEAD_LENGTH, sy + GIZMO_HEAD_WIDTH / 2)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.5)'
  ctx.lineWidth = 1
  ctx.stroke()

  // Label "X"
  ctx.font = 'bold 11px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = colorX
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText('X', sx + GIZMO_LENGTH + 5, sy)
  ctx.restore()

  // 4. Draw Y Arrow (Green, vertical up)
  const isYActive = activeAxis === 'y'
  const isYHovered = hoveredAxis === 'y' || isYActive
  const colorY = isYHovered ? GIZMO_Y_HOVER : GIZMO_Y_COLOR
  const lineWidthY = isYHovered ? 3.5 : 2.5

  ctx.save()
  // Dark outline
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.65)'
  ctx.lineWidth = lineWidthY + 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(sx, sy - GIZMO_OFFSET)
  ctx.lineTo(sx, sy - GIZMO_LENGTH + GIZMO_HEAD_LENGTH - 2)
  ctx.stroke()

  // Main shaft
  ctx.strokeStyle = colorY
  ctx.lineWidth = lineWidthY
  ctx.beginPath()
  ctx.moveTo(sx, sy - GIZMO_OFFSET)
  ctx.lineTo(sx, sy - GIZMO_LENGTH + GIZMO_HEAD_LENGTH - 2)
  ctx.stroke()

  // Arrowhead triangle
  ctx.fillStyle = colorY
  ctx.beginPath()
  ctx.moveTo(sx, sy - GIZMO_LENGTH)
  ctx.lineTo(sx - GIZMO_HEAD_WIDTH / 2, sy - GIZMO_LENGTH + GIZMO_HEAD_LENGTH)
  ctx.lineTo(sx + GIZMO_HEAD_WIDTH / 2, sy - GIZMO_LENGTH + GIZMO_HEAD_LENGTH)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.5)'
  ctx.lineWidth = 1
  ctx.stroke()

  // Label "Y"
  ctx.font = 'bold 11px system-ui, -apple-system, sans-serif'
  ctx.fillStyle = colorY
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('Y', sx, sy - GIZMO_LENGTH - 4)
  ctx.restore()

  // 5. Center origin pivot indicator (distinct white dot with dark ring)
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(sx, sy, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()

  // 6. Live delta badge if actively dragging
  if (activeAxis) {
    let text = ''
    let badgeColor = '#ffffff'
    let badgeBorder = colorX

    if (activeAxis === 'rotate' && options.angleDeg !== undefined) {
      const sign = options.angleDeg >= 0 ? '+' : ''
      text = `Δθ: ${sign}${options.angleDeg.toFixed(1)}°`
      badgeBorder = GIZMO_ROT_COLOR
    } else if (options.delta && (activeAxis === 'x' || activeAxis === 'y')) {
      const unit = options.unit ?? 'm'
      const deltaVal = activeAxis === 'x' ? options.delta.x : options.delta.y
      const sign = deltaVal >= 0 ? '+' : ''
      text = `Δ${activeAxis.toUpperCase()}: ${sign}${deltaVal.toFixed(2)} ${unit}`
      badgeBorder = activeAxis === 'x' ? GIZMO_X_COLOR : GIZMO_Y_COLOR
    }

    if (text) {
      ctx.save()
      ctx.font = '600 11px Archivo, system-ui, sans-serif'
      const textMetrics = ctx.measureText(text)
      const badgeW = textMetrics.width + 16
      const badgeH = 22
      const badgeX = activeAxis === 'x' ? sx + GIZMO_LENGTH + 20 : activeAxis === 'y' ? sx + 15 : hx + 12
      const badgeY = activeAxis === 'x' ? sy - 11 : activeAxis === 'y' ? sy - GIZMO_LENGTH / 2 - 11 : hy - 11

      // Background pill
      ctx.fillStyle = 'rgba(15, 23, 42, 0.90)'
      ctx.strokeStyle = badgeBorder
      ctx.lineWidth = 1.5
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6)
      } else {
        ctx.rect(badgeX, badgeY, badgeW, badgeH)
      }
      ctx.fill()
      ctx.stroke()

      // Text
      ctx.fillStyle = badgeColor
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, badgeX + badgeW / 2, badgeY + badgeH / 2)
      ctx.restore()
    }
  }

  ctx.restore()
}
