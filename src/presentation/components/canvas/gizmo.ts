import type { Point, Network, Selection, NodeId, SegmentId } from '@domain/models/types'
import { snapToGrid } from '@domain/models/network'
import { bezierPoint } from '@domain/geometry/curve'

export type GizmoAxis = 'x' | 'y'

export interface GizmoAnchor {
  type: 'node' | 'section'
  worldPos: Point
  nodeIds: Set<NodeId>
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
      curvedSegments: new Map(),
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

/**
 * Hit-test to see if screen-space pointer (px, py) is over one of the two gizmo arrows.
 * Node center is at (sx, sy) in screen-space.
 * X arrow points to the right: from (sx + GIZMO_OFFSET, sy) to (sx + GIZMO_LENGTH, sy).
 * Y arrow points upwards: from (sx, sy - GIZMO_OFFSET) to (sx, sy - GIZMO_LENGTH).
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
}

/**
 * Render the 2D orthogonal translation gizmo (two arrows) at node screen position.
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
    } else {
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

  // 4. Center origin pivot indicator (distinct white dot with dark ring)
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(sx, sy, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()

  // 5. Live delta badge if actively dragging
  if (activeAxis && options.delta) {
    const unit = options.unit ?? 'm'
    const deltaVal = activeAxis === 'x' ? options.delta.x : options.delta.y
    const sign = deltaVal >= 0 ? '+' : ''
    const text = `Δ${activeAxis.toUpperCase()}: ${sign}${deltaVal.toFixed(2)} ${unit}`

    ctx.save()
    ctx.font = '600 11px Archivo, system-ui, sans-serif'
    const textMetrics = ctx.measureText(text)
    const badgeW = textMetrics.width + 16
    const badgeH = 22
    const badgeX = activeAxis === 'x' ? sx + GIZMO_LENGTH + 20 : sx + 15
    const badgeY = activeAxis === 'x' ? sy - 11 : sy - GIZMO_LENGTH / 2 - 11

    // Background pill
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)'
    ctx.strokeStyle = activeAxis === 'x' ? GIZMO_X_COLOR : GIZMO_Y_COLOR
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

  ctx.restore()
}
