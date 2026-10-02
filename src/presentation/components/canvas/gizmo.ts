import type { Point, Network, Selection, NodeId, SegmentId } from '@domain/models/types'
import { snapToGrid } from '@domain/models/network'
import { bezierPoint } from '@domain/geometry/curve'

export type GizmoAxis = 'x' | 'y' | 'rotate'

export interface GizmoAnchor {
  type: 'node' | 'section'
  worldPos: Point
  nodeIds: Set<NodeId>
  curvedSegments: Map<SegmentId, Point>
  primaryCurveSegId?: SegmentId
  isEndNode?: boolean
  hasCurve?: boolean
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

    // Check if node is connected to any curved segment
    const adj = net.adjacency.get(primaryNodeId) ?? []
    let primaryCurveSegId: SegmentId | undefined
    let isEndNode: boolean | undefined
    for (const sid of adj) {
      const seg = net.segments.get(sid)
      if (seg && seg.kind === 'curve' && seg.via) {
        primaryCurveSegId = sid
        isEndNode = (seg.to === primaryNodeId)
        break
      }
    }

    return {
      type: 'node',
      worldPos: { ...primaryNode.pos },
      nodeIds: new Set(selection.nodes),
      curvedSegments: new Map(),
      primaryCurveSegId,
      isEndNode,
      hasCurve: !!primaryCurveSegId,
    }
  }

  if (selection.segments.size > 0) {
    const nodeIds = new Set<NodeId>()
    const curvedSegments = new Map<SegmentId, Point>()
    for (const sid of selection.segments) {
      const seg = net.segments.get(sid)
      if (seg) {
        nodeIds.add(seg.from)
        nodeIds.add(seg.to)
        if (seg.kind === 'curve' && seg.via) {
          curvedSegments.set(sid, { ...seg.via })
        }
      }
    }

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
export const GIZMO_ROTATE_COLOR = '#38bdf8' // Cyan
export const GIZMO_ROTATE_HOVER = '#7dd3fc' // Light cyan

export const GIZMO_ARC_RADIUS = 32 // pixels from node center
export const GIZMO_ARC_START_RAD = -1.25 // ~ -72 deg (near Y axis)
export const GIZMO_ARC_END_RAD = -0.32 // ~ -18 deg (near X axis)

/**
 * Hit-test to see if screen-space pointer (px, py) is over one of the two gizmo arrows or the rotation arc.
 * Node center is at (sx, sy) in screen-space.
 * X arrow points to the right: from (sx + GIZMO_OFFSET, sy) to (sx + GIZMO_LENGTH, sy).
 * Y arrow points upwards: from (sx, sy - GIZMO_OFFSET) to (sx, sy - GIZMO_LENGTH).
 * Rotation arc lies in quadrant between X and Y at radius GIZMO_ARC_RADIUS.
 */
export function hitTestGizmo(
  pointerScreen: Point,
  nodeScreen: Point,
  tolerance = GIZMO_HIT_TOLERANCE,
  hasCurve = false
): GizmoAxis | null {
  const px = pointerScreen.x
  const py = pointerScreen.y
  const sx = nodeScreen.x
  const sy = nodeScreen.y

  // 1. Hit-test rotation arc between X and Y if node has connected curve
  if (hasCurve) {
    const dx = px - sx
    const dy = py - sy
    const dist = Math.hypot(dx, dy)
    if (Math.abs(dist - GIZMO_ARC_RADIUS) <= 8) {
      const angle = Math.atan2(dy, dx)
      if (angle >= -1.45 && angle <= -0.15) {
        return 'rotate'
      }
    }
  }

  // 2. Hit-test X arrow (Horizontal, towards +X / Right)
  const isWithinXRange = px >= sx + GIZMO_OFFSET - 4 && px <= sx + GIZMO_LENGTH + 6
  const isWithinYForX = Math.abs(py - sy) <= tolerance
  const hitX = isWithinXRange && isWithinYForX

  // 3. Hit-test Y arrow (Vertical, towards -ScreenY / Up)
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

export interface RenderGizmoOptions {
  delta?: Point
  unit?: string
  canvasWidth?: number
  canvasHeight?: number
  hasCurve?: boolean
  rotationAngleDeg?: number
  rotationRadius?: number
  isClamped?: boolean
}

/**
 * Render the 2D orthogonal translation gizmo (two arrows) at node screen position,
 * along with the bidirectional rotation arc when connected to a curved segment.
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

  // 1. If actively dragging an axis, draw infinite dashed guideline through the node
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
    }
    ctx.restore()
  }

  // 2. Draw X Arrow (Red, horizontal right)
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

  // 3. Draw Y Arrow (Green, vertical up)
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

  // 4. Draw bidirectional rotation arc between X and Y if hasCurve is true
  if (options.hasCurve) {
    const isRotateActive = activeAxis === 'rotate'
    const isRotateHovered = hoveredAxis === 'rotate' || isRotateActive
    const colorRotate = isRotateHovered ? GIZMO_ROTATE_HOVER : GIZMO_ROTATE_COLOR
    const lineWidthRotate = isRotateHovered ? 3.5 : 2.5

    ctx.save()
    // Dark outline for contrast
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.65)'
    ctx.lineWidth = lineWidthRotate + 2
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(sx, sy, GIZMO_ARC_RADIUS, GIZMO_ARC_START_RAD, GIZMO_ARC_END_RAD, false)
    ctx.stroke()

    // Main arc
    ctx.strokeStyle = colorRotate
    ctx.lineWidth = lineWidthRotate
    ctx.beginPath()
    ctx.arc(sx, sy, GIZMO_ARC_RADIUS, GIZMO_ARC_START_RAD, GIZMO_ARC_END_RAD, false)
    ctx.stroke()

    // Arrowhead 1 (CCW, near Y axis at GIZMO_ARC_START_RAD)
    const a1 = GIZMO_ARC_START_RAD
    const p1x = sx + GIZMO_ARC_RADIUS * Math.cos(a1)
    const p1y = sy + GIZMO_ARC_RADIUS * Math.sin(a1)
    const tan1x = Math.sin(a1)
    const tan1y = -Math.cos(a1)
    const norm1x = -tan1y
    const norm1y = tan1x

    const headLen = 7
    const headWidth = 6

    ctx.fillStyle = colorRotate
    ctx.beginPath()
    ctx.moveTo(p1x, p1y)
    ctx.lineTo(
      p1x - tan1x * headLen + norm1x * (headWidth / 2),
      p1y - tan1y * headLen + norm1y * (headWidth / 2)
    )
    ctx.lineTo(
      p1x - tan1x * headLen - norm1x * (headWidth / 2),
      p1y - tan1y * headLen - norm1y * (headWidth / 2)
    )
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.5)'
    ctx.lineWidth = 1
    ctx.stroke()

    // Arrowhead 2 (CW, near X axis at GIZMO_ARC_END_RAD)
    const a2 = GIZMO_ARC_END_RAD
    const p2x = sx + GIZMO_ARC_RADIUS * Math.cos(a2)
    const p2y = sy + GIZMO_ARC_RADIUS * Math.sin(a2)
    const tan2x = -Math.sin(a2)
    const tan2y = Math.cos(a2)
    const norm2x = -tan2y
    const norm2y = tan2x

    ctx.fillStyle = colorRotate
    ctx.beginPath()
    ctx.moveTo(p2x, p2y)
    ctx.lineTo(
      p2x - tan2x * headLen + norm2x * (headWidth / 2),
      p2y - tan2y * headLen + norm2y * (headWidth / 2)
    )
    ctx.lineTo(
      p2x - tan2x * headLen - norm2x * (headWidth / 2),
      p2y - tan2y * headLen - norm2y * (headWidth / 2)
    )
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.5)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }

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
    const unit = options.unit ?? 'm'
    let text = ''
    let strokeColor = GIZMO_X_COLOR
    let badgeX = sx + GIZMO_LENGTH + 20
    let badgeY = sy - 11

    if (activeAxis === 'rotate') {
      const angleText = options.rotationAngleDeg !== undefined ? `${options.rotationAngleDeg.toFixed(1)}°` : '0°'
      const rText = options.rotationRadius !== undefined && options.rotationRadius < Infinity && options.rotationRadius > 0
        ? ` | R: ${options.rotationRadius.toFixed(0)}${unit}`
        : ''
      const clampText = options.isClamped ? ' (Max)' : ''
      text = `Angle: ${angleText}${rText}${clampText}`
      strokeColor = options.isClamped ? '#f59e0b' : GIZMO_ROTATE_COLOR
      badgeX = sx + 20
      badgeY = sy - GIZMO_ARC_RADIUS - 24
    } else if (options.delta) {
      const deltaVal = activeAxis === 'x' ? options.delta.x : options.delta.y
      const sign = deltaVal >= 0 ? '+' : ''
      text = `Δ${activeAxis.toUpperCase()}: ${sign}${deltaVal.toFixed(2)} ${unit}`
      strokeColor = activeAxis === 'x' ? GIZMO_X_COLOR : GIZMO_Y_COLOR
      badgeX = activeAxis === 'x' ? sx + GIZMO_LENGTH + 20 : sx + 15
      badgeY = activeAxis === 'x' ? sy - 11 : sy - GIZMO_LENGTH / 2 - 11
    }

    if (text) {
      ctx.save()
      ctx.font = '600 11px Archivo, system-ui, sans-serif'
      const textMetrics = ctx.measureText(text)
      const badgeW = textMetrics.width + 16
      const badgeH = 22

      // Background pill
      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)'
      ctx.strokeStyle = strokeColor
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
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, badgeX + badgeW / 2, badgeY + badgeH / 2)
      ctx.restore()
    }
  }

  ctx.restore()
}

