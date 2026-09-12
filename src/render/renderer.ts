export type { Camera } from './camera'
import type { Camera } from './camera'
export type { Selection } from '../core/types'
import type { Network, Point, Selection, RailNode, Segment, NodeId } from '../core/types'
import { bezierNormal, bezierPoint, bezierTangent, curveLength, curveSamples, discretizeCurve } from '../core/curve'
import { detectCrossings, lineLineIntersection, type DiamondCrossing } from '../core/crossing'
import { segmentTangentAt } from '../core/tangent'

/** Choose a grid spacing (in world units) that keeps cells ~40–80 px on screen. */
export function pickSpacing(scale: number): number {
  const target = 60 / scale // desired cell size in world units
  const power = Math.floor(Math.log10(target))
  const base = target / 10 ** power
  let step: number
  if (base < 1.5) step = 1
  else if (base < 3.5) step = 2
  else if (base < 7.5) step = 5
  else step = 10
  return step * 10 ** power
}

function getCanvasStyle(canvas: HTMLCanvasElement | undefined, prop: string, fallback: string): string {
  try {
    if (typeof window !== 'undefined' && window.getComputedStyle && canvas) {
      return window.getComputedStyle(canvas).getPropertyValue(prop).trim() || fallback
    }
  } catch {
    // Fallback for headless environments
  }
  return fallback
}

export function renderGrid(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
): void {
  ctx.save()

  // Fill background
  const bg = getCanvasStyle(ctx.canvas, '--paper', '#fff')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, vw, vh)

  const minor = getCanvasStyle(ctx.canvas, '--grid', 'rgba(0,0,0,0.06)')
  const major = getCanvasStyle(ctx.canvas, '--grid-major', 'rgba(0,0,0,0.12)')

  const spacing = pickSpacing(cam.scale)
  const halfW = vw / 2 / cam.scale
  const halfH = vh / 2 / cam.scale

  const left = cam.x - halfW
  const right = cam.x + halfW
  const top = cam.y - halfH
  const bottom = cam.y + halfH

  const startX = Math.floor(left / spacing) * spacing
  const endX = Math.ceil(right / spacing) * spacing
  const startY = Math.floor(top / spacing) * spacing
  const endY = Math.ceil(bottom / spacing) * spacing

  ctx.lineWidth = 1

  // Minor grid lines
  ctx.strokeStyle = minor
  ctx.beginPath()
  for (let wx = startX; wx <= endX; wx += spacing) {
    const sx = (wx - cam.x) * cam.scale + vw / 2
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, vh)
  }
  for (let wy = startY; wy <= endY; wy += spacing) {
    const sy = (wy - cam.y) * cam.scale + vh / 2
    ctx.moveTo(0, sy)
    ctx.lineTo(vw, sy)
  }
  ctx.stroke()

  // Major grid lines (every 5th)
  ctx.strokeStyle = major
  ctx.beginPath()
  const majorSpacing = spacing * 5
  for (let wx = Math.floor(left / majorSpacing) * majorSpacing; wx <= endX; wx += majorSpacing) {
    const sx = (wx - cam.x) * cam.scale + vw / 2
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, vh)
  }
  for (let wy = Math.floor(top / majorSpacing) * majorSpacing; wy <= endY; wy += majorSpacing) {
    const sy = (wy - cam.y) * cam.scale + vh / 2
    ctx.moveTo(0, sy)
    ctx.lineTo(vw, sy)
  }
  ctx.stroke()

  // Origin marker
  const ox = (0 - cam.x) * cam.scale + vw / 2
  const oy = (0 - cam.y) * cam.scale + vh / 2
  if (ox >= -10 && ox <= vw + 10 && oy >= -10 && oy <= vh + 10) {
    ctx.strokeStyle = major
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(ox - 8, oy)
    ctx.lineTo(ox + 8, oy)
    ctx.moveTo(ox, oy - 8)
    ctx.lineTo(ox, oy + 8)
    ctx.stroke()
  }

  ctx.restore()
}

// --- Rail rendering (HO scale, world units = model mm) ---

/** HO gauge: 16.5 mm (NEM 010 / NMRA S-1.2) */
export const GAUGE = 16.5
/** Sleeper spacing in HO: ~7.5 mm (accurate HO scale, ~33 sleepers per 246mm track) */
export const SLEEPER_SPACING = 7.5
/** Sleeper length: 26 mm (gauge 16.5 mm + ~4.75 mm each side) */
export const SLEEPER_LENGTH = 26
/** Sleeper width in HO: ~2.8 mm */
export const SLEEPER_WIDTH = 2.8
/** Ballast roadbed width: 32 mm (standard Kato HO Unitrack roadbed) */
export const BALLAST_WIDTH = 32
/** Rail head width (Code 83 ≈ 1.0 mm) */
export const RAIL_WIDTH = 1.0

/** Below this scale (px/mm), render as a single simplified line. */
export const SIMPLIFY_THRESHOLD = 2

/** Minimum curve radius for HO (380 mm, 15 inches) */
export const MIN_RADIUS = 380

export interface ViewportBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * Compute the world-coordinate bounding box of the visible viewport,
 * expanded by a safety margin in world units.
 */
export function getViewportBounds(
  cam: Camera,
  vw: number,
  vh: number,
  marginScreenPx = 60,
): ViewportBounds {
  const halfW = vw / 2 / cam.scale
  const halfH = vh / 2 / cam.scale
  const marginWorld = Math.max(marginScreenPx / cam.scale, 60)
  return {
    minX: cam.x - halfW - marginWorld,
    maxX: cam.x + halfW + marginWorld,
    minY: cam.y - halfH - marginWorld,
    maxY: cam.y + halfH + marginWorld,
  }
}

/**
 * Fast AABB check for a 2D point.
 */
export function isPointInBounds(p: Point, b: ViewportBounds): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY
}

/**
 * Fast AABB check for a segment (straight or quadratic curve).
 * Uses conservative convex hull bounding box for curves.
 */
export function isSegmentInBounds(
  a: Point,
  b: Point,
  via: Point | undefined,
  bounds: ViewportBounds,
): boolean {
  let minX = a.x < b.x ? a.x : b.x
  let maxX = a.x > b.x ? a.x : b.x
  let minY = a.y < b.y ? a.y : b.y
  let maxY = a.y > b.y ? a.y : b.y

  if (via) {
    if (via.x < minX) minX = via.x
    if (via.x > maxX) maxX = via.x
    if (via.y < minY) minY = via.y
    if (via.y > maxY) maxY = via.y
  }

  // If outside viewport on any axis, it is completely culled
  if (maxX < bounds.minX || minX > bounds.maxX) return false
  if (maxY < bounds.minY || minY > bounds.maxY) return false

  return true
}

export function renderNetwork(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  selection: Selection,
): void {
  const ink = getCanvasStyle(ctx.canvas, '--ink', '#1a1a1a')
  const accent = getCanvasStyle(ctx.canvas, '--accent', '#2563eb')
  const sleeperColor = getCanvasStyle(ctx.canvas, '--sleeper', '#443425')
  const ballastColor = getCanvasStyle(ctx.canvas, '--ballast', '#dcd6cc')
  const ballastEdge = getCanvasStyle(ctx.canvas, '--ballast-edge', '#c2b9aa')
  const railColor = getCanvasStyle(ctx.canvas, '--rail', '#526071')
  const railHeadColor = getCanvasStyle(ctx.canvas, '--rail-head', '#ffffff')
  const paper = getCanvasStyle(ctx.canvas, '--paper', '#ffffff')

  const simplified = cam.scale < SIMPLIFY_THRESHOLD

  // View-frustum culling: filter to only segments within or intersecting the viewport
  const bounds = getViewportBounds(cam, vw, vh, 80)
  const visibleSegments: Segment[] = []
  for (const seg of net.segments.values()) {
    const a = net.nodes.get(seg.from)
    const b = net.nodes.get(seg.to)
    if (!a || !b) continue
    if (isSegmentInBounds(a.pos, b.pos, seg.via, bounds)) {
      visibleSegments.push(seg)
    }
  }

  if (simplified) {
    // Draw simplified single-line representation for low zoom levels
    for (const seg of visibleSegments) {
      const a = net.nodes.get(seg.from)
      const b = net.nodes.get(seg.to)
      if (!a || !b) continue

      const selected = selection.segments.has(seg.id)
      const isInactive = isInactiveBranch(net, seg.id)

      ctx.save()
      if (isInactive) ctx.globalAlpha = 0.4

      const ax = (a.pos.x - cam.x) * cam.scale + vw / 2
      const ay = (a.pos.y - cam.y) * cam.scale + vh / 2
      const bx = (b.pos.x - cam.x) * cam.scale + vw / 2
      const by = (b.pos.y - cam.y) * cam.scale + vh / 2

      ctx.strokeStyle = selected ? accent : ink
      ctx.lineWidth = Math.max(2, 0.8 * cam.scale)
      ctx.lineCap = 'round'
      if (isInactive) ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      if (seg.kind === 'curve' && seg.via) {
        const vx = (seg.via.x - cam.x) * cam.scale + vw / 2
        const vy = (seg.via.y - cam.y) * cam.scale + vh / 2
        ctx.quadraticCurveTo(vx, vy, bx, by)
      } else {
        ctx.lineTo(bx, by)
      }
      ctx.stroke()
      if (isInactive) ctx.setLineDash([])

      // Direction arrow along skeleton showing construction direction (A -> B)
      const midPt = seg.kind === 'curve' && seg.via
        ? bezierPoint(0.5, a.pos, seg.via, b.pos)
        : { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 }
      const midTan = seg.kind === 'curve' && seg.via
        ? bezierTangent(0.5, a.pos, seg.via, b.pos)
        : { x: b.pos.x - a.pos.x, y: b.pos.y - a.pos.y }
      const sMidX = (midPt.x - cam.x) * cam.scale + vw / 2
      const sMidY = (midPt.y - cam.y) * cam.scale + vh / 2
      const angle = Math.atan2(midTan.y, midTan.x)

      ctx.save()
      ctx.translate(sMidX, sMidY)
      ctx.rotate(angle)
      ctx.fillStyle = selected ? accent : ink
      ctx.beginPath()
      ctx.moveTo(4, 0)
      ctx.lineTo(-3, -2.5)
      ctx.lineTo(-3, 2.5)
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      ctx.restore()
    }
  } else {
    // Detect diamond crossings only amongst visible segments in the viewport
    const crossings = detectCrossings(net, visibleSegments)
    const visibleCrossings = crossings.filter((c) => isPointInBounds(c.center, bounds))

    // LAYER 1: BALLAST ROADBED
    // Draw ballast roadbed for visible segments
    for (const seg of visibleSegments) {
      const a = net.nodes.get(seg.from)
      const b = net.nodes.get(seg.to)
      if (!a || !b) continue

      const selected = selection.segments.has(seg.id)
      const isInactive = isInactiveBranch(net, seg.id)

      ctx.save()
      if (isInactive) ctx.globalAlpha = 0.4
      if (seg.kind === 'curve' && seg.via) {
        renderDetailedCurveBallast(ctx, cam, a.pos, seg.via, b.pos, vw, vh, selected, ballastColor, ballastEdge)
      } else {
        renderDetailedRailBallast(ctx, cam, a.pos, b.pos, vw, vh, selected, ballastColor, ballastEdge)
      }
      ctx.restore()
    }
    // Connect ballast seamlessly at nodes with degree >= 2 (drawn under all rails and sleepers)
    renderBallastJoints(ctx, cam, vw, vh, net, ballastColor, ballastEdge, bounds)
    // Draw unified diamond ballast platform for visible crossings
    for (const c of visibleCrossings) {
      renderDiamondCrossingBallast(ctx, cam, c, vw, vh, ballastColor, ballastEdge)
    }

    // LAYER 2: SLEEPERS (TRAVERSES)
    // Draw sleepers with half-offset spacing across visible segments (skipping crossing diamond interiors)
    for (const seg of visibleSegments) {
      const a = net.nodes.get(seg.from)
      const b = net.nodes.get(seg.to)
      if (!a || !b) continue

      const isInactive = isInactiveBranch(net, seg.id)
      ctx.save()
      if (isInactive) ctx.globalAlpha = 0.4
      if (seg.kind === 'curve' && seg.via) {
        renderDetailedCurveSleepers(ctx, cam, a.pos, seg.via, b.pos, vw, vh, sleeperColor, visibleCrossings)
      } else {
        renderDetailedRailSleepers(ctx, cam, a.pos, b.pos, vw, vh, sleeperColor, visibleCrossings)
      }
      ctx.restore()
    }
    // Draw unified shared crossing timbers across visible diamonds
    for (const c of visibleCrossings) {
      renderDiamondCrossingSleepers(ctx, cam, c, vw, vh, sleeperColor)
    }

    // LAYER 3: RAILS
    // Draw steel rails with polished gleaming white rail head for visible segments.
    for (const seg of visibleSegments) {
      const a = net.nodes.get(seg.from)
      const b = net.nodes.get(seg.to)
      if (!a || !b) continue

      const selected = selection.segments.has(seg.id)
      const isInactive = isInactiveBranch(net, seg.id)

      ctx.save()
      if (isInactive) ctx.globalAlpha = 0.4
      if (seg.kind === 'curve' && seg.via) {
        renderDetailedCurveRails(ctx, cam, a.pos, seg.via, b.pos, vw, vh, selected, railColor, accent, 0, 0, railHeadColor)
      } else {
        renderDetailedRailLines(ctx, cam, a.pos, b.pos, vw, vh, selected, railColor, accent, 0, 0, railHeadColor)
      }
      ctx.restore()
    }
    // Connect rails and create smooth dynamic miter joints at nodes
    renderRailJoints(ctx, cam, vw, vh, net, selection, railColor, accent, bounds)

    // LAYER 4: TURNOUT & DIAMOND CROSSING MECHANICAL DETAILS + FISHPLATES
    renderTurnoutMechanicalDetails(ctx, cam, vw, vh, net, bounds)
    renderFishplates(ctx, cam, vw, vh, net, bounds)
    for (const c of visibleCrossings) {
      renderDiamondCrossingDetails(ctx, cam, c, vw, vh, railColor, accent)
    }

    // For selected segments, draw a prominent directional arrow along track center showing construction direction
    for (const seg of visibleSegments) {
      if (!selection.segments.has(seg.id)) continue
      const a = net.nodes.get(seg.from)
      const b = net.nodes.get(seg.to)
      if (!a || !b) continue
      const midPt = seg.kind === 'curve' && seg.via
        ? bezierPoint(0.5, a.pos, seg.via, b.pos)
        : { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 }
      const midTan = seg.kind === 'curve' && seg.via
        ? bezierTangent(0.5, a.pos, seg.via, b.pos)
        : { x: b.pos.x - a.pos.x, y: b.pos.y - a.pos.y }
      const sMidX = (midPt.x - cam.x) * cam.scale + vw / 2
      const sMidY = (midPt.y - cam.y) * cam.scale + vh / 2
      const angle = Math.atan2(midTan.y, midTan.x)

      ctx.save()
      ctx.translate(sMidX, sMidY)
      ctx.rotate(angle)
      ctx.fillStyle = accent
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(8, 0)
      ctx.lineTo(-5, -6)
      ctx.lineTo(-2, 0)
      ctx.lineTo(-5, 6)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
  }

  // Draw nodes on top: open endpoints stand out, continuous joints blend cleanly without any extra marks
  for (const node of net.nodes.values()) {
    if (!isPointInBounds(node.pos, bounds)) continue

    const sx = (node.pos.x - cam.x) * cam.scale + vw / 2
    const sy = (node.pos.y - cam.y) * cam.scale + vh / 2
    const selected = selection.nodes.has(node.id)
    const adj = net.adjacency.get(node.id) ?? []
    const connectionCount = adj.length

    if (selected) {
      // Selected node: prominent accent ring + glow
      ctx.fillStyle = accent
      ctx.beginPath()
      ctx.arc(sx, sy, Math.max(6, 1.2 * cam.scale), 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = paper
      ctx.beginPath()
      ctx.arc(sx, sy, Math.max(3, 0.6 * cam.scale), 0, Math.PI * 2)
      ctx.fill()
    } else if (connectionCount <= 1) {
      // Open endpoint: clean connection point indicating an open rail end
      const r = Math.max(4, 0.9 * cam.scale)
      ctx.fillStyle = ink
      ctx.globalAlpha = 0.8
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = paper
      ctx.beginPath()
      ctx.arc(sx, sy, r * 0.45, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1

      // Realistic buffer stop (heurtoir de voie) on dead ends when unselected
      if (connectionCount === 1 && !selected && cam.scale >= 0.8) {
        renderBufferStop(ctx, cam, node, net, vw, vh)
      }
    } else {
      // Continuous joint (2+ connections): pure clean rails without any extra overlay
    }
  }

  // Draw switch stand / junction frog indicators on top
  for (const junc of net.junctions.values()) {
    const apex = net.nodes.get(junc.nodeId)
    if (!apex || !isPointInBounds(apex.pos, bounds)) continue
    const sx = (apex.pos.x - cam.x) * cam.scale + vw / 2
    const sy = (apex.pos.y - cam.y) * cam.scale + vh / 2

    const activeNodeId = junc.activeBranch === 'straight' ? junc.straightNodeId : junc.divergingNodeId
    const activeNode = net.nodes.get(activeNodeId)

    ctx.save()
    const r = Math.max(5, 1.2 * cam.scale)
    // Emerald green for straight route, amber for diverging route
    ctx.fillStyle = junc.activeBranch === 'straight' ? '#10b981' : '#f59e0b'
    ctx.strokeStyle = ink
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(sx, sy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    // Direction arrow inside indicator
    if (activeNode) {
      const dx = activeNode.pos.x - apex.pos.x
      const dy = activeNode.pos.y - apex.pos.y
      const len = Math.hypot(dx, dy)
      if (len > 0) {
        const angle = Math.atan2(dy, dx)
        ctx.save()
        ctx.translate(sx, sy)
        ctx.rotate(angle)
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.moveTo(r * 0.65, 0)
        ctx.lineTo(-r * 0.35, -r * 0.45)
        ctx.lineTo(-r * 0.35, r * 0.45)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }
    }
    ctx.restore()
  }
}

export function renderDetailedRailBallast(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  a: Point,
  b: Point,
  vw: number,
  vh: number,
  selected: boolean,
  ballastColor?: string,
  ballastEdgeColor?: string,
): void {
  const s = cam.scale
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return

  const ballastW = BALLAST_WIDTH * s

  ctx.save()
  ctx.translate((a.x - cam.x) * s + vw / 2, (a.y - cam.y) * s + vh / 2)
  ctx.rotate(Math.atan2(dy, dx))

  // Ballast roadbed fill
  ctx.fillStyle = selected ? 'rgba(37, 99, 235, 0.15)' : (ballastColor ?? '#dcd6cc')
  ctx.fillRect(0, -ballastW / 2, len * s, ballastW)

  // Ballast edge bevel lines
  ctx.strokeStyle = ballastEdgeColor ?? '#c2b9aa'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, -ballastW / 2)
  ctx.lineTo(len * s, -ballastW / 2)
  ctx.moveTo(0, ballastW / 2)
  ctx.lineTo(len * s, ballastW / 2)
  ctx.stroke()

  ctx.restore()
}

export function renderDetailedRailSleepers(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  a: Point,
  b: Point,
  vw: number,
  vh: number,
  sleeperColor: string,
  crossings?: DiamondCrossing[],
): void {
  const s = cam.scale
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return

  const sleeperLen = SLEEPER_LENGTH * s
  const sleeperW = Math.max(1.5, SLEEPER_WIDTH * s)
  const totalSleepers = Math.max(1, Math.round(len / SLEEPER_SPACING))
  const step = len / totalSleepers

  ctx.save()
  ctx.translate((a.x - cam.x) * s + vw / 2, (a.y - cam.y) * s + vh / 2)
  ctx.rotate(Math.atan2(dy, dx))
  ctx.fillStyle = sleeperColor

  // Half-offset spacing: first and last sleepers are half a step away from ends
  // preventing double sleepers at joint nodes and giving a uniform 7.5mm pitch
  for (let i = 0; i < totalSleepers; i++) {
    const t = (i + 0.5) * step
    // Check if sleeper is inside any crossing diamond
    if (crossings && crossings.length > 0) {
      const wx = a.x + (dx / len) * t
      const wy = a.y + (dy / len) * t
      let insideCrossing = false
      for (const c of crossings) {
        if (Math.hypot(wx - c.center.x, wy - c.center.y) < c.radius * 0.75) {
          insideCrossing = true
          break
        }
      }
      if (insideCrossing) continue
    }
    ctx.fillRect(t * s - sleeperW / 2, -sleeperLen / 2, sleeperW, sleeperLen)

    // Steel tie plates (selles de rail métalliques) & spikes under both rails when zoomed in
    if (s >= 1.2) {
      const hg = (GAUGE / 2) * s
      const plateW = Math.max(2, 2.4 * s)
      const plateH = Math.max(2.8, 3.8 * s)
      ctx.fillStyle = '#475569'
      ctx.fillRect(t * s - plateW / 2, -hg - plateH / 2, plateW, plateH)
      ctx.fillRect(t * s - plateW / 2, hg - plateH / 2, plateW, plateH)

      if (s >= 2.2) {
        ctx.fillStyle = '#0f172a'
        const spR = Math.max(0.6, 0.7 * s)
        ctx.fillRect(t * s - plateW * 0.35, -hg - plateH * 0.35, spR, spR)
        ctx.fillRect(t * s + plateW * 0.35 - spR, -hg + plateH * 0.35 - spR, spR, spR)
        ctx.fillRect(t * s - plateW * 0.35, hg - plateH * 0.35, spR, spR)
        ctx.fillRect(t * s + plateW * 0.35 - spR, hg + plateH * 0.35 - spR, spR, spR)
        ctx.fillStyle = sleeperColor
      }
    }
  }

  ctx.restore()
}

export function renderDetailedRailLines(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  a: Point,
  b: Point,
  vw: number,
  vh: number,
  selected: boolean,
  ink: string,
  accent: string,
  startPullback = 0,
  endPullback = 0,
  railHeadColor = '#ffffff',
): void {
  const s = cam.scale
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return
  if (len <= startPullback + endPullback) return

  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const hg = GAUGE / 2

  const aStart = { x: a.x + ux * startPullback, y: a.y + uy * startPullback }
  const bEnd = { x: b.x - ux * endPullback, y: b.y - uy * endPullback }

  const r1ax = (aStart.x + nx * hg - cam.x) * s + vw / 2
  const r1ay = (aStart.y + ny * hg - cam.y) * s + vh / 2
  const r1bx = (bEnd.x + nx * hg - cam.x) * s + vw / 2
  const r1by = (bEnd.y + ny * hg - cam.y) * s + vh / 2
  const r2ax = (aStart.x - nx * hg - cam.x) * s + vw / 2
  const r2ay = (aStart.y - ny * hg - cam.y) * s + vh / 2
  const r2bx = (bEnd.x - nx * hg - cam.x) * s + vw / 2
  const r2by = (bEnd.y - ny * hg - cam.y) * s + vh / 2

  const railPx = Math.max(1.2, RAIL_WIDTH * s)
  const railColor = selected ? accent : ink

  // Pass 1: Rail base / patin
  ctx.strokeStyle = railColor
  ctx.lineWidth = railPx
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'

  ctx.beginPath()
  ctx.moveTo(r1ax, r1ay)
  ctx.lineTo(r1bx, r1by)
  ctx.moveTo(r2ax, r2ay)
  ctx.lineTo(r2bx, r2by)
  ctx.stroke()

  // Pass 2: Polished steel rail head (le champignon de roulement blanc en acier)
  // Stops crisply with lineCap='butt' leaving a visible mechanical expansion gap at joints
  const headPx = Math.max(0.8, railPx * 0.42)
  ctx.strokeStyle = selected ? '#ffffff' : railHeadColor
  ctx.lineWidth = headPx
  ctx.lineCap = 'butt'

  ctx.beginPath()
  ctx.moveTo(r1ax, r1ay)
  ctx.lineTo(r1bx, r1by)
  ctx.moveTo(r2ax, r2ay)
  ctx.lineTo(r2bx, r2by)
  ctx.stroke()

  if (selected) {
    ctx.strokeStyle = accent
    ctx.globalAlpha = 0.35
    ctx.lineWidth = railPx + 5
    ctx.beginPath()
    ctx.moveTo(r1ax, r1ay)
    ctx.lineTo(r1bx, r1by)
    ctx.moveTo(r2ax, r2ay)
    ctx.lineTo(r2bx, r2by)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

export function renderDetailedRail(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  a: Point,
  b: Point,
  vw: number,
  vh: number,
  selected: boolean,
  ink: string,
  accent: string,
  sleeperColor: string,
  ballastColor?: string,
  ballastEdgeColor?: string,
): void {
  renderDetailedRailBallast(ctx, cam, a, b, vw, vh, selected, ballastColor, ballastEdgeColor)
  renderDetailedRailSleepers(ctx, cam, a, b, vw, vh, sleeperColor)
  renderDetailedRailLines(ctx, cam, a, b, vw, vh, selected, ink, accent)
}

function w2s(p: Point, cam: Camera, vw: number, vh: number): [number, number] {
  return [(p.x - cam.x) * cam.scale + vw / 2, (p.y - cam.y) * cam.scale + vh / 2]
}

export function renderDetailedCurveBallast(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p0: Point,
  via: Point,
  p2: Point,
  vw: number,
  vh: number,
  selected: boolean,
  ballastColor?: string,
  ballastEdgeColor?: string,
): void {
  const s = cam.scale
  const samples = curveSamples(p0, via, p2, s)
  const pts = discretizeCurve(p0, via, p2, samples)
  const hb = BALLAST_WIDTH / 2

  const leftBallast: [number, number][] = []
  const rightBallast: [number, number][] = []

  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const n = bezierNormal(t, p0, via, p2)
    leftBallast.push(w2s({ x: pts[i].x + n.x * hb, y: pts[i].y + n.y * hb }, cam, vw, vh))
    rightBallast.push(w2s({ x: pts[i].x - n.x * hb, y: pts[i].y - n.y * hb }, cam, vw, vh))
  }

  // Ballast roadbed fill
  ctx.fillStyle = selected ? 'rgba(37, 99, 235, 0.15)' : (ballastColor ?? '#dcd6cc')
  ctx.beginPath()
  for (let i = 0; i <= samples; i++) {
    const [sx, sy] = leftBallast[i]
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  for (let i = samples; i >= 0; i--) {
    const [sx, sy] = rightBallast[i]
    ctx.lineTo(sx, sy)
  }
  ctx.closePath()
  ctx.fill()

  // Ballast edge lines
  ctx.strokeStyle = ballastEdgeColor ?? '#c2b9aa'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= samples; i++) {
    const [sx, sy] = leftBallast[i]
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  ctx.stroke()

  ctx.beginPath()
  for (let i = 0; i <= samples; i++) {
    const [sx, sy] = rightBallast[i]
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  ctx.stroke()
}

export function renderDetailedCurveSleepers(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p0: Point,
  via: Point,
  p2: Point,
  vw: number,
  vh: number,
  sleeperColor: string,
  crossings?: DiamondCrossing[],
): void {
  const s = cam.scale
  const samples = curveSamples(p0, via, p2, s)
  const len = curveLength(p0, via, p2, samples)
  const sleeperLen = SLEEPER_LENGTH * s
  const sleeperW = Math.max(1.5, SLEEPER_WIDTH * s)
  const totalSleepers = Math.max(1, Math.round(len / SLEEPER_SPACING))
  const stepT = 1 / totalSleepers

  ctx.fillStyle = sleeperColor
  for (let i = 0; i < totalSleepers; i++) {
    const t = (i + 0.5) * stepT
    const pt = bezierPoint(t, p0, via, p2)

    if (crossings && crossings.length > 0) {
      let insideCrossing = false
      for (const c of crossings) {
        if (Math.hypot(pt.x - c.center.x, pt.y - c.center.y) < c.radius * 0.75) {
          insideCrossing = true
          break
        }
      }
      if (insideCrossing) continue
    }

    const n = bezierNormal(t, p0, via, p2)
    const [sx, sy] = w2s(pt, cam, vw, vh)
    const angle = Math.atan2(n.y, n.x) + Math.PI / 2

    ctx.save()
    ctx.translate(sx, sy)
    ctx.rotate(angle)
    ctx.fillRect(-sleeperW / 2, -sleeperLen / 2, sleeperW, sleeperLen)

    // Steel tie plates (selles de rail métalliques) & spikes under curved rails when zoomed in
    if (s >= 1.2) {
      const hg = (GAUGE / 2) * s
      const plateW = Math.max(2, 2.4 * s)
      const plateH = Math.max(2.8, 3.8 * s)
      ctx.fillStyle = '#475569'
      ctx.fillRect(-plateW / 2, -hg - plateH / 2, plateW, plateH)
      ctx.fillRect(-plateW / 2, hg - plateH / 2, plateW, plateH)

      if (s >= 2.2) {
        ctx.fillStyle = '#0f172a'
        const spR = Math.max(0.6, 0.7 * s)
        ctx.fillRect(-plateW * 0.35, -hg - plateH * 0.35, spR, spR)
        ctx.fillRect(plateW * 0.35 - spR, -hg + plateH * 0.35 - spR, spR, spR)
        ctx.fillRect(-plateW * 0.35, hg - plateH * 0.35, spR, spR)
        ctx.fillRect(plateW * 0.35 - spR, hg + plateH * 0.35 - spR, spR, spR)
      }
    }
    ctx.restore()
  }
}

export function renderDetailedCurveRails(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p0: Point,
  via: Point,
  p2: Point,
  vw: number,
  vh: number,
  selected: boolean,
  ink: string,
  accent: string,
  startPullback = 0,
  endPullback = 0,
  railHeadColor = '#ffffff',
): void {
  const s = cam.scale
  const samples = curveSamples(p0, via, p2, s)
  const len = curveLength(p0, via, p2, samples)
  const tStart = len > 0 && startPullback > 0 ? Math.min(0.25, startPullback / len) : 0
  const tEnd = len > 0 && endPullback > 0 ? Math.max(0.75, 1 - endPullback / len) : 1

  const hg = GAUGE / 2
  const railPx = Math.max(1.2, RAIL_WIDTH * s)
  const railColor = selected ? accent : ink

  const leftRail: [number, number][] = []
  const rightRail: [number, number][] = []

  for (let i = 0; i <= samples; i++) {
    const t = tStart + (i / samples) * (tEnd - tStart)
    const pt = bezierPoint(t, p0, via, p2)
    const n = bezierNormal(t, p0, via, p2)
    leftRail.push(w2s({ x: pt.x + n.x * hg, y: pt.y + n.y * hg }, cam, vw, vh))
    rightRail.push(w2s({ x: pt.x - n.x * hg, y: pt.y - n.y * hg }, cam, vw, vh))
  }

  // Pass 1: Rail base
  ctx.strokeStyle = railColor
  ctx.lineWidth = railPx
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'

  ctx.beginPath()
  for (let i = 0; i <= samples; i++) {
    const [sx, sy] = leftRail[i]
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  ctx.stroke()

  ctx.beginPath()
  for (let i = 0; i <= samples; i++) {
    const [sx, sy] = rightRail[i]
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  ctx.stroke()

  // Pass 2: Polished steel rail head
  const headPx = Math.max(0.8, railPx * 0.42)
  ctx.strokeStyle = selected ? '#ffffff' : railHeadColor
  ctx.lineWidth = headPx
  ctx.lineCap = 'butt'

  ctx.beginPath()
  for (let i = 0; i <= samples; i++) {
    const [sx, sy] = leftRail[i]
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  ctx.stroke()

  ctx.beginPath()
  for (let i = 0; i <= samples; i++) {
    const [sx, sy] = rightRail[i]
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  ctx.stroke()

  if (selected) {
    ctx.strokeStyle = accent
    ctx.globalAlpha = 0.35
    ctx.lineWidth = railPx + 5
    ctx.beginPath()
    for (let i = 0; i <= samples; i++) {
      const [sx, sy] = leftRail[i]
      if (i === 0) ctx.moveTo(sx, sy)
      else ctx.lineTo(sx, sy)
    }
    ctx.stroke()
    ctx.beginPath()
    for (let i = 0; i <= samples; i++) {
      const [sx, sy] = rightRail[i]
      if (i === 0) ctx.moveTo(sx, sy)
      else ctx.lineTo(sx, sy)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

export function renderDetailedCurve(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p0: Point,
  via: Point,
  p2: Point,
  vw: number,
  vh: number,
  selected: boolean,
  ink: string,
  accent: string,
  sleeperColor: string,
  ballastColor?: string,
  ballastEdgeColor?: string,
): void {
  renderDetailedCurveBallast(ctx, cam, p0, via, p2, vw, vh, selected, ballastColor, ballastEdgeColor)
  renderDetailedCurveSleepers(ctx, cam, p0, via, p2, vw, vh, sleeperColor)
  renderDetailedCurveRails(ctx, cam, p0, via, p2, vw, vh, selected, ink, accent)
}

// --- Scale bar ---

/** Round to a "nice" number (1, 2, 5 × 10^n) closest to `value`. */
function niceNumber(value: number): number {
  const power = Math.floor(Math.log10(value))
  const base = value / 10 ** power
  let step: number
  if (base < 1.5) step = 1
  else if (base < 3.5) step = 2
  else if (base < 7.5) step = 5
  else step = 10
  return step * 10 ** power
}

export function renderScaleBar(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
): void {
  const ink = getCanvasStyle(ctx.canvas, '--ink', '#1a1a1a')
  const panel = getCanvasStyle(ctx.canvas, '--panel', '#f5f5f5')

  const targetWorld = 100 / cam.scale
  const worldDist = niceNumber(targetWorld)
  const barPx = worldDist * cam.scale

  const margin = 16
  const barH = 8
  const x = vw - barPx - margin
  const y = vh - margin

  ctx.save()

  ctx.font = '600 11px Archivo, system-ui, sans-serif'
  const label = formatDistance(worldDist)
  const labelW = ctx.measureText(label).width
  const pillW = Math.max(barPx, labelW) + 16
  const pillH = barH + 24
  const pillX = vw - pillW - margin / 2
  const pillY = vh - pillH - margin / 2
  ctx.fillStyle = panel
  ctx.globalAlpha = 0.85
  roundRect(ctx, pillX, pillY, pillW, pillH, 6)
  ctx.fill()
  ctx.globalAlpha = 1

  ctx.strokeStyle = ink
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x, y - barH)
  ctx.lineTo(x, y)
  ctx.lineTo(x + barPx, y)
  ctx.lineTo(x + barPx, y - barH)
  ctx.stroke()

  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(label, x + barPx / 2, y + 4)

  ctx.restore()
}

function formatDistance(world: number): string {
  if (world >= 1000) return `${world / 1000}k`
  if (Number.isInteger(world)) return `${world}`
  return `${world.toFixed(world < 1 ? 2 : 1)}`
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Connect rail lines and ballast seamlessly at nodes where 2 or more segments meet. */
export function isInactiveBranch(net: Network, segId: string): boolean {
  for (const junc of net.junctions.values()) {
    if (
      (junc.activeBranch === 'straight' && segId === junc.divergingSegmentId) ||
      (junc.activeBranch === 'diverging' && segId === junc.straightSegmentId)
    ) {
      return true
    }
  }
  return false
}

export interface SegmentEndGeom {
  segId: string
  tangent: Point
  normal: Point
  rLeftW: Point
  rRightW: Point
  bLeftW: Point
  bRightW: Point
  rLeftScr: [number, number]
  rRightScr: [number, number]
  bLeftScr: [number, number]
  bRightScr: [number, number]
  selected: boolean
  isInactive: boolean
}

/**
 * For a segment connected to a node, get its unit tangent pointing OUTWARD (away from the node)
 * and its outward-left unit normal (rotated 90° counter-clockwise from tangent).
 */
export function getNodeSegmentEndVector(
  net: Network,
  seg: Segment,
  nodeId: NodeId,
): { tangent: Point; normal: Point } {
  const nodeA = net.nodes.get(seg.from)
  const nodeB = net.nodes.get(seg.to)
  if (!nodeA || !nodeB) {
    return { tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 } }
  }

  let tx = 0
  let ty = 0

  if (seg.kind === 'curve' && seg.via) {
    if (seg.from === nodeId) {
      // Outgoing at t = 0 (direction from nodeA towards nodeB along curve)
      const tan = bezierTangent(0, nodeA.pos, seg.via, nodeB.pos)
      tx = tan.x
      ty = tan.y
    } else {
      // Outgoing at t = 1 (direction away from nodeB back into curve towards nodeA)
      const tan = bezierTangent(1, nodeA.pos, seg.via, nodeB.pos)
      tx = -tan.x
      ty = -tan.y
    }
  } else {
    // Straight segment
    if (seg.from === nodeId) {
      tx = nodeB.pos.x - nodeA.pos.x
      ty = nodeB.pos.y - nodeA.pos.y
    } else {
      tx = nodeA.pos.x - nodeB.pos.x
      ty = nodeA.pos.y - nodeB.pos.y
    }
  }

  const len = Math.hypot(tx, ty)
  const ux = len > 0.0001 ? tx / len : 1
  const uy = len > 0.0001 ? ty / len : 0
  const nx = -uy
  const ny = ux

  return { tangent: { x: ux, y: uy }, normal: { x: nx, y: ny } }
}

export function getNodeSegmentEnds(
  net: Network,
  node: RailNode,
  cam: Camera,
  vw: number,
  vh: number,
  selection: Selection,
): SegmentEndGeom[] {
  const adj = net.adjacency.get(node.id) ?? []
  const ends: SegmentEndGeom[] = []
  const hg = GAUGE / 2
  const hb = BALLAST_WIDTH / 2

  for (const sid of adj) {
    const seg = net.segments.get(sid)
    if (!seg) continue

    const { tangent, normal } = getNodeSegmentEndVector(net, seg, node.id)

    const rLeftW = { x: node.pos.x + normal.x * hg, y: node.pos.y + normal.y * hg }
    const rRightW = { x: node.pos.x - normal.x * hg, y: node.pos.y - normal.y * hg }
    const bLeftW = { x: node.pos.x + normal.x * hb, y: node.pos.y + normal.y * hb }
    const bRightW = { x: node.pos.x - normal.x * hb, y: node.pos.y - normal.y * hb }

    ends.push({
      segId: sid,
      tangent,
      normal,
      rLeftW,
      rRightW,
      bLeftW,
      bRightW,
      rLeftScr: w2s(rLeftW, cam, vw, vh),
      rRightScr: w2s(rRightW, cam, vw, vh),
      bLeftScr: w2s(bLeftW, cam, vw, vh),
      bRightScr: w2s(bRightW, cam, vw, vh),
      selected: selection.segments.has(sid) || selection.nodes.has(node.id),
      isInactive: isInactiveBranch(net, sid),
    })
  }
  return ends
}

export interface ConnectedEndPair {
  e1: SegmentEndGeom
  e2: SegmentEndGeom
  dot: number
  // World points
  r1LW: Point
  r1RW: Point
  r2LW: Point
  r2RW: Point
  b1LW: Point
  b1RW: Point
  b2LW: Point
  b2RW: Point
  jLeftW: Point
  jRightW: Point
  bLeftW: Point
  bRightW: Point
  // Screen points
  r1LScr: [number, number]
  r1RScr: [number, number]
  r2LScr: [number, number]
  r2RScr: [number, number]
  b1LScr: [number, number]
  b1RScr: [number, number]
  b2LScr: [number, number]
  b2RScr: [number, number]
  jLeftScr: [number, number]
  jRightScr: [number, number]
  bLeftScr: [number, number]
  bRightScr: [number, number]
}

export function getConnectedEndPairs(
  node: RailNode,
  ends: SegmentEndGeom[],
  cam: Camera,
  vw: number,
  vh: number,
): ConnectedEndPair[] {
  const pairs: ConnectedEndPair[] = []
  const hg = GAUGE / 2
  const hb = BALLAST_WIDTH / 2

  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const e1 = ends[i]
      const e2 = ends[j]
      const dot = e1.tangent.x * e2.tangent.x + e1.tangent.y * e2.tangent.y

      // For degree-2 joints, allow turns up to 135° (dot < 0.707)
      // For branch / turnout nodes (deg >= 3), branches diverging in same direction have dot > 0
      // Only segments running through in opposite directions (dot < -0.2) continue into each other
      const maxDot = ends.length === 2 ? 0.707 : -0.2
      if (dot >= maxDot) continue

      // Travel flows through node from e1 into e2:
      // Along e1 towards node (direction -e1.tangent), left normal is -e1.normal
      // Along e2 away from node (direction +e2.tangent), left normal is +e2.normal
      const r1LW = { x: node.pos.x - e1.normal.x * hg, y: node.pos.y - e1.normal.y * hg }
      const r1RW = { x: node.pos.x + e1.normal.x * hg, y: node.pos.y + e1.normal.y * hg }
      const r2LW = { x: node.pos.x + e2.normal.x * hg, y: node.pos.y + e2.normal.y * hg }
      const r2RW = { x: node.pos.x - e2.normal.x * hg, y: node.pos.y - e2.normal.y * hg }

      const b1LW = { x: node.pos.x - e1.normal.x * hb, y: node.pos.y - e1.normal.y * hb }
      const b1RW = { x: node.pos.x + e1.normal.x * hb, y: node.pos.y + e1.normal.y * hb }
      const b2LW = { x: node.pos.x + e2.normal.x * hb, y: node.pos.y + e2.normal.y * hb }
      const b2RW = { x: node.pos.x - e2.normal.x * hb, y: node.pos.y - e2.normal.y * hb }

      // Bisector vector D = normalize(e2.tangent - e1.tangent)
      const dx = e2.tangent.x - e1.tangent.x
      const dy = e2.tangent.y - e1.tangent.y
      const dLen = Math.hypot(dx, dy)
      const uDx = dLen > 0.0001 ? dx / dLen : -e1.tangent.x
      const uDy = dLen > 0.0001 ? dy / dLen : -e1.tangent.y

      // Bisector normal (to the left of travel direction D)
      const nBx = -uDy
      const nBy = uDx

      const cosHalf = Math.max(0.35, Math.sqrt(Math.max(0, (1 - dot) / 2)))
      const miterRail = hg / cosHalf
      const miterBallast = hb / cosHalf

      const jLeftW = { x: node.pos.x + nBx * miterRail, y: node.pos.y + nBy * miterRail }
      const jRightW = { x: node.pos.x - nBx * miterRail, y: node.pos.y - nBy * miterRail }
      const bLeftW = { x: node.pos.x + nBx * miterBallast, y: node.pos.y + nBy * miterBallast }
      const bRightW = { x: node.pos.x - nBx * miterBallast, y: node.pos.y - nBy * miterBallast }

      pairs.push({
        e1,
        e2,
        dot,
        r1LW,
        r1RW,
        r2LW,
        r2RW,
        b1LW,
        b1RW,
        b2LW,
        b2RW,
        jLeftW,
        jRightW,
        bLeftW,
        bRightW,
        r1LScr: w2s(r1LW, cam, vw, vh),
        r1RScr: w2s(r1RW, cam, vw, vh),
        r2LScr: w2s(r2LW, cam, vw, vh),
        r2RScr: w2s(r2RW, cam, vw, vh),
        b1LScr: w2s(b1LW, cam, vw, vh),
        b1RScr: w2s(b1RW, cam, vw, vh),
        b2LScr: w2s(b2LW, cam, vw, vh),
        b2RScr: w2s(b2RW, cam, vw, vh),
        jLeftScr: w2s(jLeftW, cam, vw, vh),
        jRightScr: w2s(jRightW, cam, vw, vh),
        bLeftScr: w2s(bLeftW, cam, vw, vh),
        bRightScr: w2s(bRightW, cam, vw, vh),
      })
    }
  }

  return pairs
}

/** Connect ballast seamlessly at nodes where 2 or more segments meet (drawn in Layer 1, under rails). */
export function renderBallastJoints(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  ballastColor?: string,
  ballastEdgeColor?: string,
  bounds?: ViewportBounds,
): void {
  const dummySel: Selection = { nodes: new Set(), segments: new Set() }
  for (const node of net.nodes.values()) {
    const adj = net.adjacency.get(node.id) ?? []
    if (adj.length < 2) continue

    if (bounds && !isPointInBounds(node.pos, bounds)) continue

    const nx_scr = (node.pos.x - cam.x) * cam.scale + vw / 2
    const ny_scr = (node.pos.y - cam.y) * cam.scale + vh / 2
    if (nx_scr < -60 || nx_scr > vw + 60 || ny_scr < -60 || ny_scr > vh + 60) continue

    const ends = getNodeSegmentEnds(net, node, cam, vw, vh, dummySel)
    const pairs = getConnectedEndPairs(node, ends, cam, vw, vh)

    for (const p of pairs) {
      ctx.save()
      ctx.fillStyle = ballastColor ?? '#dcd6cc'
      ctx.beginPath()
      ctx.moveTo(p.b1LScr[0], p.b1LScr[1])
      ctx.lineTo(p.bLeftScr[0], p.bLeftScr[1])
      ctx.lineTo(p.b2LScr[0], p.b2LScr[1])
      ctx.lineTo(p.b2RScr[0], p.b2RScr[1])
      ctx.lineTo(p.bRightScr[0], p.bRightScr[1])
      ctx.lineTo(p.b1RScr[0], p.b1RScr[1])
      ctx.closePath()
      ctx.fill()

      // Bevel edge lines along the sides of the ballast junction
      ctx.strokeStyle = ballastEdgeColor ?? '#c2b9aa'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(p.b1LScr[0], p.b1LScr[1])
      ctx.lineTo(p.bLeftScr[0], p.bLeftScr[1])
      ctx.lineTo(p.b2LScr[0], p.b2LScr[1])
      ctx.moveTo(p.b1RScr[0], p.b1RScr[1])
      ctx.lineTo(p.bRightScr[0], p.bRightScr[1])
      ctx.lineTo(p.b2RScr[0], p.b2RScr[1])
      ctx.stroke()

      ctx.restore()
    }
  }
}

/** Connect rail lines seamlessly at nodes where 2 or more segments meet (drawn in Layer 3). */
export function renderRailJoints(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  selection: Selection,
  railColor: string,
  accent: string,
  bounds?: ViewportBounds,
): void {
  const s = cam.scale
  const railPx = Math.max(1.2, RAIL_WIDTH * s)
  const capRadius = railPx / 2

  for (const node of net.nodes.values()) {
    const adj = net.adjacency.get(node.id) ?? []
    if (adj.length < 2) continue

    if (bounds && !isPointInBounds(node.pos, bounds)) continue

    const nx_scr = (node.pos.x - cam.x) * s + vw / 2
    const ny_scr = (node.pos.y - cam.y) * s + vh / 2
    if (nx_scr < -40 || nx_scr > vw + 40 || ny_scr < -40 || ny_scr > vh + 40) continue

    const ends = getNodeSegmentEnds(net, node, cam, vw, vh, selection)
    const pairs = getConnectedEndPairs(node, ends, cam, vw, vh)

    for (const p of pairs) {
      const isSel = p.e1.selected || p.e2.selected
      const isDim = p.e1.isInactive || p.e2.isInactive
      const col = isSel ? accent : railColor

      ctx.save()
      if (isDim) ctx.globalAlpha = 0.4

      // Pass 1: Rail base / patin
      ctx.strokeStyle = col
      ctx.lineWidth = railPx
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      ctx.beginPath()
      ctx.moveTo(p.r1LScr[0], p.r1LScr[1])
      ctx.lineTo(p.jLeftScr[0], p.jLeftScr[1])
      ctx.lineTo(p.r2LScr[0], p.r2LScr[1])
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(p.r1RScr[0], p.r1RScr[1])
      ctx.lineTo(p.jRightScr[0], p.jRightScr[1])
      ctx.lineTo(p.r2RScr[0], p.r2RScr[1])
      ctx.stroke()

      // Small anchor caps at vertices to ensure zero subpixel gap
      ctx.fillStyle = col
      ctx.beginPath()
      ctx.arc(p.jLeftScr[0], p.jLeftScr[1], capRadius, 0, Math.PI * 2)
      ctx.arc(p.jRightScr[0], p.jRightScr[1], capRadius, 0, Math.PI * 2)
      ctx.fill()

      // Pass 2: Polished steel rail head
      const headPx = Math.max(0.8, railPx * 0.42)
      ctx.strokeStyle = isSel ? '#ffffff' : '#ffffff'
      ctx.lineWidth = headPx

      ctx.beginPath()
      ctx.moveTo(p.r1LScr[0], p.r1LScr[1])
      ctx.lineTo(p.jLeftScr[0], p.jLeftScr[1])
      ctx.lineTo(p.r2LScr[0], p.r2LScr[1])
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(p.r1RScr[0], p.r1RScr[1])
      ctx.lineTo(p.jRightScr[0], p.jRightScr[1])
      ctx.lineTo(p.r2RScr[0], p.r2RScr[1])
      ctx.stroke()

      ctx.restore()
    }
  }
}

/**
 * Render realistic steel fishplates (eclisses de joint) with bolt pairs
 * at degree-2 track joints where two rail segments meet end-to-end.
 * In reality, fishplates are steel bars bolted to both sides of each rail
 * across the expansion gap, holding the rail ends in alignment.
 */
export function renderFishplates(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  bounds?: ViewportBounds,
): void {
  const s = cam.scale
  if (s < 1.0) return // Only render when zoomed in enough

  const hg = GAUGE / 2

  for (const node of net.nodes.values()) {
    const adj = net.adjacency.get(node.id) ?? []
    if (adj.length !== 2) continue

    if (bounds && !isPointInBounds(node.pos, bounds)) continue

    const nx_scr = (node.pos.x - cam.x) * s + vw / 2
    const ny_scr = (node.pos.y - cam.y) * s + vh / 2
    if (nx_scr < -40 || nx_scr > vw + 40 || ny_scr < -40 || ny_scr > vh + 40) continue

    // Compute average tangent direction at this joint
    const seg0 = net.segments.get(adj[0])
    const seg1 = net.segments.get(adj[1])
    if (!seg0 || !seg1) continue

    const getTan = (seg: typeof seg0): Point => {
      const tan = segmentTangentAt(net, seg, node.id)
      if (tan) {
        // Point away from node
        return seg.to === node.id ? tan : { x: -tan.x, y: -tan.y }
      }
      const otherId = seg.from === node.id ? seg.to : seg.from
      const other = net.nodes.get(otherId)
      if (other) {
        const dx = other.pos.x - node.pos.x
        const dy = other.pos.y - node.pos.y
        const l = Math.hypot(dx, dy)
        return l > 0 ? { x: dx / l, y: dy / l } : { x: 1, y: 0 }
      }
      return { x: 1, y: 0 }
    }

    const t0 = getTan(seg0)
    const t1 = getTan(seg1)

    // Average tangent direction (bisector of incoming/outgoing)
    let tAvgX = t0.x - t1.x
    let tAvgY = t0.y - t1.y
    const tLen = Math.hypot(tAvgX, tAvgY)
    if (tLen < 0.001) {
      tAvgX = t0.x
      tAvgY = t0.y
    } else {
      tAvgX /= tLen
      tAvgY /= tLen
    }

    // Normal perpendicular to track
    const nX = -tAvgY
    const nY = tAvgX

    // Fishplate dimensions (HO scale)
    const plateHalfLen = 4.5 // 9mm total length in model scale
    const plateThickness = Math.max(1.2, 1.4 * s)
    const boltSpacing = 2.8
    const boltRadius = Math.max(0.5, 0.6 * s)

    // Draw fishplate on each rail (left rail and right rail)
    for (const railSide of [-1, 1]) {
      const railCenterX = node.pos.x + nX * hg * railSide
      const railCenterY = node.pos.y + nY * hg * railSide

      // Steel fishplate bar (thin rectangle along rail)
      const pA = w2s(
        { x: railCenterX - tAvgX * plateHalfLen, y: railCenterY - tAvgY * plateHalfLen },
        cam, vw, vh,
      )
      const pB = w2s(
        { x: railCenterX + tAvgX * plateHalfLen, y: railCenterY + tAvgY * plateHalfLen },
        cam, vw, vh,
      )

      ctx.save()
      ctx.strokeStyle = '#64748b'
      ctx.lineWidth = plateThickness
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(pA[0], pA[1])
      ctx.lineTo(pB[0], pB[1])
      ctx.stroke()

      // Bolt pairs (2 bolts on each side of the joint gap)
      ctx.fillStyle = '#1e293b'
      for (const boltDist of [-boltSpacing, -boltSpacing * 0.35, boltSpacing * 0.35, boltSpacing]) {
        const boltW = {
          x: railCenterX + tAvgX * boltDist,
          y: railCenterY + tAvgY * boltDist,
        }
        const bScr = w2s(boltW, cam, vw, vh)
        ctx.beginPath()
        ctx.arc(bScr[0], bScr[1], boltRadius, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.restore()
    }
  }
}

/**
 * Render realistic railway turnout mechanical parts:
 * - Tapered switch blades (lames d'aiguilles effilees)
 * - Frog V (coeur d'aiguille) with angle matching deviation
 * - Guard rails (contre-rails) with flared ends opposite the frog
 * - Extended turnout sleepers (traverses longues)
 * - Switch motor (moteur d'aiguille) lateral
 */
export function renderTurnoutMechanicalDetails(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  bounds?: ViewportBounds,
): void {
  const s = cam.scale
  if (s < 0.7) return

  const hg = GAUGE / 2
  const railPx = Math.max(1.5, RAIL_WIDTH * s)
  const steelDark = '#334155'
  const steelMid = '#64748b'
  const steelBright = '#94a3b8'

  for (const junc of net.junctions.values()) {
    const apex = net.nodes.get(junc.nodeId)
    const straightNode = net.nodes.get(junc.straightNodeId)
    const divNode = net.nodes.get(junc.divergingNodeId)
    if (!apex || !straightNode || !divNode) continue

    if (bounds && !isPointInBounds(apex.pos, bounds)) continue

    const ax_scr = (apex.pos.x - cam.x) * s + vw / 2
    const ay_scr = (apex.pos.y - cam.y) * s + vh / 2
    if (ax_scr < -150 || ax_scr > vw + 150 || ay_scr < -150 || ay_scr > vh + 150) continue

    const ddx = straightNode.pos.x - apex.pos.x
    const ddy = straightNode.pos.y - apex.pos.y
    const straightLen = Math.hypot(ddx, ddy)
    if (straightLen < 10) continue

    const ux = ddx / straightLen
    const uy = ddy / straightLen
    const nx = -uy
    const ny = ux
    const side: 1 | -1 = junc.hand === 'left' ? 1 : -1

    const specAngle = junc.frogNumber === 4 ? 15 : 10
    const thetaRad = (specAngle * Math.PI) / 180
    const frogDist = Math.min(straightLen * 0.75, GAUGE / Math.sin(thetaRad))

    // Convert (t, d) coordinates to screen pixels.
    // t = distance along straight track from apex, d = lateral offset (perpendicular)
    const worldToScreen = (t: number, d: number): [number, number] => {
      const wx = apex.pos.x + t * ux + d * nx
      const wy = apex.pos.y + t * uy + d * ny
      return [(wx - cam.x) * s + vw / 2, (wy - cam.y) * s + vh / 2]
    }


    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // ------------------------------------------------------------------
    // 1. EXTENDED TURNOUT SLEEPERS (Traverses longues d'aiguillage)
    // ------------------------------------------------------------------
    // Turnout sleepers span the full width including both straight and diverging tracks.
    if (s >= 0.8) {
      const sleeperW = Math.max(1.5, SLEEPER_WIDTH * s)
      const numSleepers = Math.max(4, Math.floor((frogDist + 20) / SLEEPER_SPACING))
      ctx.fillStyle = '#8B7355'
      ctx.strokeStyle = '#6B5335'
      ctx.lineWidth = 0.5

      for (let i = 0; i < numSleepers; i++) {
        const t = 2 + i * SLEEPER_SPACING
        if (t > frogDist + 20) break

        // Compute lateral extent: outer edge of straight track on both sides,
        // plus the diverging track offset if t is in the blade/frog region
        const straightOuterD = hg + 5
        const divOffset = t * Math.sin(thetaRad)

        // Pick the wider extent on the diverging side
        const sideExtent = side > 0
          ? Math.max(straightOuterD, hg + 5 + divOffset)
          : Math.max(straightOuterD, hg + 5 + divOffset)

        const leftD = side > 0 ? sideExtent : (hg + 5)
        const rightD = side > 0 ? (hg + 5) : sideExtent

        const p1 = worldToScreen(t, leftD)
        const p2 = worldToScreen(t, -rightD)

        ctx.beginPath()
        // Draw a rotated rectangle (sleeper aligned perpendicular to track)
        const halfW = sleeperW / 2
        // The sleeper is along the normal direction, so its length goes from p1 to p2
        // and its width is perpendicular to that (along track direction)
        const sdx = p2[0] - p1[0]
        const sdy = p2[1] - p1[1]
        const sLen = Math.hypot(sdx, sdy)
        if (sLen < 1) continue
        const snx = sdx / sLen
        const sny = sdy / sLen
        // perpendicular to sleeper direction = along track direction in screen space
        const spx = -sny
        const spy = snx

        ctx.moveTo(p1[0] + spx * halfW, p1[1] + spy * halfW)
        ctx.lineTo(p2[0] + spx * halfW, p2[1] + spy * halfW)
        ctx.lineTo(p2[0] - spx * halfW, p2[1] - spy * halfW)
        ctx.lineTo(p1[0] - spx * halfW, p1[1] - spy * halfW)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
    }

    // ------------------------------------------------------------------
    // 2. TAPERED SWITCH BLADES (Lames d'aiguilles effilees)
    // ------------------------------------------------------------------
    // Each blade is a filled polygon that tapers from BLADE_TOE_WIDTH (0.3mm)
    // at the toe (point) to RAIL_WIDTH (1.0mm) at the heel (full rail width).
    // The active (closed) blade sits against the stock rail (gap = 0).
    // The inactive (open) blade progressively opens from 0 at heel to ~3mm at toe.
    const bladeLen = 32
    const toeX = 6

    const isStraight = junc.activeBranch === 'straight'

    const BLADE_TOE_WIDTH = 0.3  // mm, very thin at the point
    const BLADE_HEEL_WIDTH = RAIL_WIDTH  // full rail width at heel
    const BLADE_OPEN_GAP = 3.0   // mm, max opening gap at toe when blade is open
    const BLADE_STEPS = 16       // number of segments for smooth taper

    // -- Straight blade (on the side*hg rail) --
    {
      const stockRailD = side * hg  // stock rail position (center of rail)
      const closedDir = -side       // blade is on the inner side of the stock rail
      const isActive = isStraight
      // When active: blade against stock rail (gap=0 along full length)
      // When inactive: heel is still at stock rail, toe opens away by BLADE_OPEN_GAP

      // Build polygon: top edge (outer, against stock rail) then bottom edge (inner)
      const topPts: [number, number][] = []
      const botPts: [number, number][] = []

      for (let i = 0; i <= BLADE_STEPS; i++) {
        const frac = i / BLADE_STEPS
        const t = toeX + frac * bladeLen
        // Width at this point (linear taper)
        const halfW = (BLADE_TOE_WIDTH + frac * (BLADE_HEEL_WIDTH - BLADE_TOE_WIDTH)) / 2

        // Gap from stock rail: when closed = 0, when open = linearly from BLADE_OPEN_GAP at toe to 0 at heel
        const gap = isActive ? 0 : BLADE_OPEN_GAP * (1 - frac)

        // Outer edge (toward stock rail): stock rail center + closedDir * gap
        const outerD = stockRailD + closedDir * gap
        // Inner edge (away from stock rail): outer + closedDir * 2*halfW
        const innerD = outerD + closedDir * 2 * halfW

        topPts.push(worldToScreen(t, outerD))
        botPts.push(worldToScreen(t, innerD))
      }

      // Draw filled polygon
      ctx.fillStyle = isActive ? steelDark : steelMid
      ctx.strokeStyle = steelDark
      ctx.lineWidth = Math.max(0.5, 0.5 * s)
      ctx.beginPath()
      ctx.moveTo(topPts[0][0], topPts[0][1])
      for (let i = 1; i < topPts.length; i++) {
        ctx.lineTo(topPts[i][0], topPts[i][1])
      }
      for (let i = botPts.length - 1; i >= 0; i--) {
        ctx.lineTo(botPts[i][0], botPts[i][1])
      }
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // Steel highlight on the top surface (rail head)
      if (s >= 1.5) {
        const headPx = Math.max(0.5, railPx * 0.3)
        ctx.strokeStyle = '#e2e8f0'
        ctx.lineWidth = headPx
        ctx.beginPath()
        ctx.moveTo(topPts[0][0], topPts[0][1])
        for (let i = 1; i < topPts.length; i++) {
          ctx.lineTo(topPts[i][0], topPts[i][1])
        }
        ctx.stroke()
      }
    }

    // -- Diverging blade (on the -side*hg rail, follows the diverging curve) --
    {
      const stockRailD = -side * hg  // diverging-side stock rail
      const closedDir = side         // blade is on the inner side of this stock rail
      const isActive = !isStraight

      const topPts: [number, number][] = []
      const botPts: [number, number][] = []

      for (let i = 0; i <= BLADE_STEPS; i++) {
        const frac = i / BLADE_STEPS
        const t = toeX + frac * bladeLen
        const halfW = (BLADE_TOE_WIDTH + frac * (BLADE_HEEL_WIDTH - BLADE_TOE_WIDTH)) / 2

        const gap = isActive ? 0 : BLADE_OPEN_GAP * (1 - frac)

        // The diverging blade curves away: at position t along the track,
        // the diverging rail has moved by t * sin(thetaRad) laterally
        const divCurveOffset = side * t * Math.sin(thetaRad) * 0.4

        const outerD = stockRailD + closedDir * gap + divCurveOffset
        const innerD = outerD + closedDir * 2 * halfW

        topPts.push(worldToScreen(t, outerD))
        botPts.push(worldToScreen(t, innerD))
      }

      ctx.fillStyle = isActive ? steelDark : steelMid
      ctx.strokeStyle = steelDark
      ctx.lineWidth = Math.max(0.5, 0.5 * s)
      ctx.beginPath()
      ctx.moveTo(topPts[0][0], topPts[0][1])
      for (let i = 1; i < topPts.length; i++) {
        ctx.lineTo(topPts[i][0], topPts[i][1])
      }
      for (let i = botPts.length - 1; i >= 0; i--) {
        ctx.lineTo(botPts[i][0], botPts[i][1])
      }
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // Steel highlight
      if (s >= 1.5) {
        const headPx = Math.max(0.5, railPx * 0.3)
        ctx.strokeStyle = '#e2e8f0'
        ctx.lineWidth = headPx
        ctx.beginPath()
        ctx.moveTo(topPts[0][0], topPts[0][1])
        for (let i = 1; i < topPts.length; i++) {
          ctx.lineTo(topPts[i][0], topPts[i][1])
        }
        ctx.stroke()
      }
    }

    // Stretcher bar (tringle de manoeuvre) connecting both blade toes
    {
      const straightToeD = side * hg + (isStraight ? 0 : -side * BLADE_OPEN_GAP)
      const divToeD = -side * hg + (!isStraight ? 0 : side * BLADE_OPEN_GAP)
        + side * toeX * Math.sin(thetaRad) * 0.4
      const barP1 = worldToScreen(toeX, straightToeD)
      const barP2 = worldToScreen(toeX, divToeD)

      ctx.strokeStyle = '#1e293b'
      ctx.lineWidth = Math.max(1.2, 1.3 * s)
      ctx.beginPath()
      ctx.moveTo(barP1[0], barP1[1])
      ctx.lineTo(barP2[0], barP2[1])
      ctx.stroke()
    }

    // ------------------------------------------------------------------
    // 3. SLIDE CHAIRS (Coussinets de glissement sous les lames)
    // ------------------------------------------------------------------
    if (s >= 1.0) {
      const chairW = Math.max(1.8, 2.2 * s)
      const chairH = Math.max(2.8, 3.6 * s)
      ctx.fillStyle = steelBright
      for (const cx of [8, 14, 20, 26]) {
        const cpStraight = worldToScreen(cx, side * (hg - 1.2))
        const cpDiv = worldToScreen(cx, -side * (hg - 1.2) + side * cx * Math.sin(thetaRad) * 0.2)
        ctx.fillRect(cpStraight[0] - chairW / 2, cpStraight[1] - chairH / 2, chairW, chairH)
        ctx.fillRect(cpDiv[0] - chairW / 2, cpDiv[1] - chairH / 2, chairW, chairH)
      }
    }

    // ------------------------------------------------------------------
    // 4. FROG V (Coeur d'aiguille)
    // ------------------------------------------------------------------
    // The frog is a V-shaped casting at frogDist along the straight track,
    // on the diverging-side rail (side * hg). The point of the V faces
    // toward the apex (incoming trains). The two branches follow the
    // straight and diverging rails downstream.
    {
      const frogLen = 14           // length of the frog V branches
      const frogHalfBase = RAIL_WIDTH * 0.5  // half-width at each branch end

      // Point of the V (sharp nose, facing the apex)
      const vPoint = worldToScreen(frogDist, side * hg)

      // End of straight branch
      const strEndT = frogDist + frogLen
      const strEndD = side * hg
      const strEnd = worldToScreen(strEndT, strEndD)
      // Perpendicular offsets at the end of the straight branch
      const strEndOuter = worldToScreen(strEndT, strEndD + side * frogHalfBase)
      const strEndInner = worldToScreen(strEndT, strEndD - side * frogHalfBase)

      // End of diverging branch: follows the deviation angle
      const divEndT = frogDist + frogLen
      const divEndD = side * (hg + frogLen * Math.sin(thetaRad))
      const divEnd = worldToScreen(divEndT, divEndD)
      const divEndOuter = worldToScreen(divEndT, divEndD + side * frogHalfBase)
      const divEndInner = worldToScreen(divEndT, divEndD - side * frogHalfBase)

      // Draw the frog V as a filled shape:
      // Point -> straight branch outer edge -> straight branch inner edge -> back to point
      // -> diverging branch inner edge -> diverging branch outer edge -> back to point
      ctx.fillStyle = steelDark
      ctx.strokeStyle = '#1e293b'
      ctx.lineWidth = Math.max(0.5, 0.6 * s)

      // Straight branch of V
      ctx.beginPath()
      ctx.moveTo(vPoint[0], vPoint[1])
      ctx.lineTo(strEndOuter[0], strEndOuter[1])
      ctx.lineTo(strEndInner[0], strEndInner[1])
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // Diverging branch of V
      ctx.beginPath()
      ctx.moveTo(vPoint[0], vPoint[1])
      ctx.lineTo(divEndOuter[0], divEndOuter[1])
      ctx.lineTo(divEndInner[0], divEndInner[1])
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // Polished rail head highlight on frog V
      if (s >= 1.5) {
        ctx.strokeStyle = '#e2e8f0'
        ctx.lineWidth = Math.max(0.5, railPx * 0.25)
        ctx.beginPath()
        ctx.moveTo(strEnd[0], strEnd[1])
        ctx.lineTo(vPoint[0], vPoint[1])
        ctx.lineTo(divEnd[0], divEnd[1])
        ctx.stroke()
      }
    }

    // ------------------------------------------------------------------
    // 5. GUARD RAILS (Contre-rails) with flared ends
    // ------------------------------------------------------------------
    // Guard rails sit on the rail OPPOSITE the frog, guiding wheel flanges.
    // They are positioned at the same longitudinal range as the frog,
    // approximately 2x the frog length, with flared (evase) ends.
    {
      const guardLen = 28         // total guard rail length (~2x frog length)
      const guardHalf = guardLen / 2
      const flareLen = 5          // length of flared section at each end
      const flareGap = 1.8        // flare opening (mm)
      const guardGap = 2.2        // gap between guard rail and stock rail center (mm)
      const guardCenterT = frogDist + 7  // centered longitudinally on the frog region

      // Guard rail on the straight-side rail (opposite to the frog which is on side*hg)
      const straightGuardD = -side * (hg - guardGap)
      const flareDirStr = side * flareGap  // flare direction (away from stock rail)

      const sgStart = worldToScreen(guardCenterT - guardHalf, straightGuardD + flareDirStr)
      const sgFlare1 = worldToScreen(guardCenterT - guardHalf + flareLen, straightGuardD)
      const sgFlare2 = worldToScreen(guardCenterT + guardHalf - flareLen, straightGuardD)
      const sgEnd = worldToScreen(guardCenterT + guardHalf, straightGuardD + flareDirStr)

      ctx.strokeStyle = steelDark
      ctx.lineWidth = railPx
      ctx.beginPath()
      ctx.moveTo(sgStart[0], sgStart[1])
      ctx.lineTo(sgFlare1[0], sgFlare1[1])
      ctx.lineTo(sgFlare2[0], sgFlare2[1])
      ctx.lineTo(sgEnd[0], sgEnd[1])
      ctx.stroke()

      // Guard rail on the diverging-side rail (opposite frog, follows diverging curve)
      // This rail is on the outer side of the diverging track
      const divGuardSteps = 12
      const divGuardPtsOuter: [number, number][] = []
      for (let i = 0; i <= divGuardSteps; i++) {
        const frac = i / divGuardSteps
        const t = guardCenterT - guardHalf + frac * guardLen
        // Diverging track lateral offset at distance t from apex
        const divLateralOffset = side * t * Math.sin(thetaRad)
        const baseD = side * (hg - guardGap) + divLateralOffset * 0.8
        // Add flare at the ends
        let flareD = 0
        if (frac < flareLen / guardLen) {
          const flareFrac = 1 - frac / (flareLen / guardLen)
          flareD = -side * flareGap * flareFrac
        } else if (frac > 1 - flareLen / guardLen) {
          const flareFrac = (frac - (1 - flareLen / guardLen)) / (flareLen / guardLen)
          flareD = -side * flareGap * flareFrac
        }
        divGuardPtsOuter.push(worldToScreen(t, baseD + flareD))
      }

      ctx.strokeStyle = steelDark
      ctx.lineWidth = railPx
      ctx.beginPath()
      ctx.moveTo(divGuardPtsOuter[0][0], divGuardPtsOuter[0][1])
      for (let i = 1; i < divGuardPtsOuter.length; i++) {
        ctx.lineTo(divGuardPtsOuter[i][0], divGuardPtsOuter[i][1])
      }
      ctx.stroke()

      // Spacer blocks (cales d'ecartement) holding guard rails to stock rails
      if (s >= 1.2) {
        const blkW = Math.max(1.5, 1.8 * s)
        const blkH = Math.max(1.5, 1.8 * s)
        ctx.fillStyle = '#1e293b'
        for (const dt of [-8, -2, 4, 10]) {
          const dist = guardCenterT + dt
          const sb1 = worldToScreen(dist, -side * (hg - 1.1))
          ctx.fillRect(sb1[0] - blkW / 2, sb1[1] - blkH / 2, blkW, blkH)
          const divOffset = side * dist * Math.sin(thetaRad) * 0.8
          const sb2 = worldToScreen(dist, side * (hg - 1.1) + divOffset)
          ctx.fillRect(sb2[0] - blkW / 2, sb2[1] - blkH / 2, blkW, blkH)
        }
      }
    }

    // ------------------------------------------------------------------
    // 6. SWITCH MOTOR (Moteur d'aiguille lateral)
    // ------------------------------------------------------------------
    {
      const motorW = 10 * s
      const motorH = 6 * s
      const motorPos = worldToScreen(toeX, side * (hg + 7))
      ctx.fillStyle = '#1e293b'
      ctx.strokeStyle = '#475569'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.rect(motorPos[0] - motorW / 2, motorPos[1] - motorH / 2, motorW, motorH)
      ctx.fill()
      ctx.stroke()

      // Operating rod (biellette de commande) to the closest blade
      const rodTarget = worldToScreen(toeX, side * hg + (isStraight ? 0 : -side * BLADE_OPEN_GAP))
      ctx.strokeStyle = steelDark
      ctx.lineWidth = Math.max(1.0, 1.2 * s)
      ctx.beginPath()
      ctx.moveTo(motorPos[0], motorPos[1])
      ctx.lineTo(rodTarget[0], rodTarget[1])
      ctx.stroke()
    }

    ctx.restore()
  }
}

/**
 * Render unified diamond ballast platform for a crossing (Layer 1).
 */
export function renderDiamondCrossingBallast(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  crossing: DiamondCrossing,
  vw: number,
  vh: number,
  ballastColor?: string,
  ballastEdgeColor?: string,
): void {
  const c = crossing.center
  const u1 = crossing.track1Dir
  const u2 = crossing.track2Dir
  const hb = BALLAST_WIDTH / 2
  const n1 = { x: -u1.y, y: u1.x }
  const n2 = { x: -u2.y, y: u2.x }

  const p1A = { x: c.x + n1.x * hb, y: c.y + n1.y * hb }
  const p1B = { x: c.x - n1.x * hb, y: c.y - n1.y * hb }
  const p2A = { x: c.x + n2.x * hb, y: c.y + n2.y * hb }
  const p2B = { x: c.x - n2.x * hb, y: c.y - n2.y * hb }

  const b1 = lineLineIntersection(p1A, u1, p2A, u2)
  const b2 = lineLineIntersection(p1A, u1, p2B, u2)
  const b3 = lineLineIntersection(p1B, u1, p2B, u2)
  const b4 = lineLineIntersection(p1B, u1, p2A, u2)

  if (!b1 || !b2 || !b3 || !b4) return

  const s1 = w2s(b1, cam, vw, vh)
  const s2 = w2s(b2, cam, vw, vh)
  const s3 = w2s(b3, cam, vw, vh)
  const s4 = w2s(b4, cam, vw, vh)

  ctx.save()
  ctx.fillStyle = ballastColor ?? '#dcd6cc'
  ctx.beginPath()
  ctx.moveTo(s1[0], s1[1])
  ctx.lineTo(s2[0], s2[1])
  ctx.lineTo(s3[0], s3[1])
  ctx.lineTo(s4[0], s4[1])
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = ballastEdgeColor ?? '#c2b9aa'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}

/**
 * Render shared long crossing timbers (traverses communes de croisement) across diamond (Layer 2).
 */
export function renderDiamondCrossingSleepers(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  crossing: DiamondCrossing,
  vw: number,
  vh: number,
  sleeperColor: string,
): void {
  const s = cam.scale
  const c = crossing.center
  const u1 = crossing.track1Dir
  const u2 = crossing.track2Dir

  // Bisector direction
  const sumX = u1.x + u2.x
  const sumY = u1.y + u2.y
  const sumL = Math.hypot(sumX, sumY)
  const uBis = sumL > 0.01 ? { x: sumX / sumL, y: sumY / sumL } : { x: -u1.y, y: u1.x }
  const uTie = { x: -uBis.y, y: uBis.x }
  const tieAngle = Math.atan2(uTie.y, uTie.x)

  const sleeperW = Math.max(1.5, SLEEPER_WIDTH * s)
  const maxSpan = Math.min(crossing.radius, 32)
  const numTies = Math.max(3, Math.floor((maxSpan * 2) / SLEEPER_SPACING))
  const step = (maxSpan * 2) / numTies

  ctx.save()
  ctx.fillStyle = sleeperColor

  for (let i = 0; i <= numTies; i++) {
    const dist = -maxSpan + (i + 0.5) * step
    if (dist > maxSpan) break

    const centerW = { x: c.x + uBis.x * dist, y: c.y + uBis.y * dist }
    const [scrX, scrY] = w2s(centerW, cam, vw, vh)

    // Long crossing timber spanning across both tracks
    const tieLen = Math.min(48, Math.max(SLEEPER_LENGTH, SLEEPER_LENGTH + Math.abs(dist) * 0.9)) * s

    ctx.save()
    ctx.translate(scrX, scrY)
    ctx.rotate(tieAngle)
    ctx.fillRect(-sleeperW / 2, -tieLen / 2, sleeperW, tieLen)
    ctx.restore()
  }

  ctx.restore()
}

/**
 * Render diamond crossing mechanical details:
 * - Flangeway cuts (ornières de roulement des boudins) at the 4 frog intersections
 * - Acute frog noses (pointes de cœur aiguës)
 * - Inner flared guard rails (contre-rails intérieurs en diamant)
 */
export function renderDiamondCrossingDetails(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  crossing: DiamondCrossing,
  vw: number,
  vh: number,
  railColor: string,
  _accent: string,
): void {
  const s = cam.scale
  const railPx = Math.max(1.2, RAIL_WIDTH * s)
  const u1 = crossing.track1Dir
  const u2 = crossing.track2Dir
  const frogs = [crossing.frogs.p1, crossing.frogs.p2, crossing.frogs.p3, crossing.frogs.p4]

  ctx.save()

  // 1. Cut flangeways (ornières) at the 4 frog intersections (HO NEM 110 standard)
  const flangewayPx = Math.max(1.4, 1.6 * s)
  const flangewayHalfLen = 3.2
  ctx.strokeStyle = '#1e1e1e' // dark ballast shadow inside frog groove
  ctx.lineWidth = flangewayPx
  ctx.lineCap = 'butt'

  for (const fp of frogs) {
    // Cut along track 1 direction
    const p1A = w2s({ x: fp.x - u1.x * flangewayHalfLen, y: fp.y - u1.y * flangewayHalfLen }, cam, vw, vh)
    const p1B = w2s({ x: fp.x + u1.x * flangewayHalfLen, y: fp.y + u1.y * flangewayHalfLen }, cam, vw, vh)
    ctx.beginPath()
    ctx.moveTo(p1A[0], p1A[1])
    ctx.lineTo(p1B[0], p1B[1])
    ctx.stroke()

    // Cut along track 2 direction
    const p2A = w2s({ x: fp.x - u2.x * flangewayHalfLen, y: fp.y - u2.y * flangewayHalfLen }, cam, vw, vh)
    const p2B = w2s({ x: fp.x + u2.x * flangewayHalfLen, y: fp.y + u2.y * flangewayHalfLen }, cam, vw, vh)
    ctx.beginPath()
    ctx.moveTo(p2A[0], p2A[1])
    ctx.lineTo(p2B[0], p2B[1])
    ctx.stroke()
  }

  // 2. Acute frog V-point noses (Pointes de cœur aiguës) pointing toward crossing center
  ctx.fillStyle = railColor
  for (const fp of frogs) {
    const toCenter = { x: crossing.center.x - fp.x, y: crossing.center.y - fp.y }
    const dCenter = Math.hypot(toCenter.x, toCenter.y)
    if (dCenter > 0.1) {
      const uC = { x: toCenter.x / dCenter, y: toCenter.y / dCenter }
      const perp = { x: -uC.y, y: uC.x }
      const tip = w2s({ x: fp.x + uC.x * 2.5, y: fp.y + uC.y * 2.5 }, cam, vw, vh)
      const base1 = w2s({ x: fp.x - uC.x * 1.5 + perp.x * 1.0, y: fp.y - uC.y * 1.5 + perp.y * 1.0 }, cam, vw, vh)
      const base2 = w2s({ x: fp.x - uC.x * 1.5 - perp.x * 1.0, y: fp.y - uC.y * 1.5 - perp.y * 1.0 }, cam, vw, vh)

      ctx.beginPath()
      ctx.moveTo(tip[0], tip[1])
      ctx.lineTo(base1[0], base1[1])
      ctx.lineTo(base2[0], base2[1])
      ctx.closePath()
      ctx.fill()
    }
  }

  // 3. Inner flared guard rails (Contre-rails intérieurs en diamant avec extrémités évasées)
  if (s >= 0.8) {
    const hg = GAUGE / 2
    const n1 = { x: -u1.y, y: u1.x }
    const n2 = { x: -u2.y, y: u2.x }
    const guardOffset = 2.0 // mm from running rail
    const guardHalfLen = 7.0
    const flareLen = 2.2
    const flareOff = 1.4

    ctx.strokeStyle = '#475569'
    ctx.lineWidth = Math.max(1.2, railPx * 0.85)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const drawGuardRail = (centerPt: Point, dir: Point, normal: Point, side: 1 | -1) => {
      const basePt = { x: centerPt.x + normal.x * (hg - guardOffset) * side, y: centerPt.y + normal.y * (hg - guardOffset) * side }
      const flareNormal = { x: -normal.x * side, y: -normal.y * side }

      const pStart = w2s({ x: basePt.x - dir.x * guardHalfLen + flareNormal.x * flareOff, y: basePt.y - dir.y * guardHalfLen + flareNormal.y * flareOff }, cam, vw, vh)
      const pF1 = w2s({ x: basePt.x - dir.x * (guardHalfLen - flareLen), y: basePt.y - dir.y * (guardHalfLen - flareLen) }, cam, vw, vh)
      const pF2 = w2s({ x: basePt.x + dir.x * (guardHalfLen - flareLen), y: basePt.y + dir.y * (guardHalfLen - flareLen) }, cam, vw, vh)
      const pEnd = w2s({ x: basePt.x + dir.x * guardHalfLen + flareNormal.x * flareOff, y: basePt.y + dir.y * guardHalfLen + flareNormal.y * flareOff }, cam, vw, vh)

      ctx.beginPath()
      ctx.moveTo(pStart[0], pStart[1])
      ctx.lineTo(pF1[0], pF1[1])
      ctx.lineTo(pF2[0], pF2[1])
      ctx.lineTo(pEnd[0], pEnd[1])
      ctx.stroke()
    }

    drawGuardRail(crossing.center, u1, n1, 1)
    drawGuardRail(crossing.center, u1, n1, -1)
    drawGuardRail(crossing.center, u2, n2, 1)
    drawGuardRail(crossing.center, u2, n2, -1)

    // Spacer blocks (cales d'écartement) holding inner guard rails to running rails
    if (s >= 1.2) {
      const blkW = Math.max(1.5, 1.8 * s)
      const blkH = Math.max(1.5, 1.8 * s)
      ctx.fillStyle = '#1e293b'
      const drawSpacers = (centerPt: Point, dir: Point, normal: Point, side: 1 | -1) => {
        const basePt = { x: centerPt.x + normal.x * (hg - guardOffset / 2) * side, y: centerPt.y + normal.y * (hg - guardOffset / 2) * side }
        for (const dist of [-3.5, 3.5]) {
          const sp = w2s({ x: basePt.x + dir.x * dist, y: basePt.y + dir.y * dist }, cam, vw, vh)
          ctx.fillRect(sp[0] - blkW / 2, sp[1] - blkH / 2, blkW, blkH)
        }
      }
      drawSpacers(crossing.center, u1, n1, 1)
      drawSpacers(crossing.center, u1, n1, -1)
      drawSpacers(crossing.center, u2, n2, 1)
      drawSpacers(crossing.center, u2, n2, -1)
    }
  }

  ctx.restore()
}

/**
 * Render authentic railway buffer stop (heurtoir de voie à poutre rouge et tampons)
 * on dead-end track endpoints (Layer 4 mechanical details).
 */
export function renderBufferStop(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  node: RailNode,
  net: Network,
  vw: number,
  vh: number,
): void {
  const segId = net.adjacency.get(node.id)?.[0]
  if (!segId) return
  const seg = net.segments.get(segId)
  if (!seg) return

  let forwardDir: Point | null = null
  if (node.id === seg.to) {
    forwardDir = segmentTangentAt(net, seg, seg.to)
  } else if (node.id === seg.from) {
    const t = segmentTangentAt(net, seg, seg.from)
    if (t) forwardDir = { x: -t.x, y: -t.y }
  }

  if (!forwardDir) return

  const s = cam.scale
  const hg = GAUGE / 2
  const uF = forwardDir
  const uP = { x: -uF.y, y: uF.x }

  ctx.save()

  // 1. Concrete / ballast anchor foundation behind the stop
  if (s >= 1.0) {
    const moundCenter = { x: node.pos.x + uF.x * 6, y: node.pos.y + uF.y * 6 }
    const m1 = w2s({ x: moundCenter.x + uP.x * (hg + 3.5), y: moundCenter.y + uP.y * (hg + 3.5) }, cam, vw, vh)
    const m2 = w2s({ x: moundCenter.x - uP.x * (hg + 3.5), y: moundCenter.y - uP.y * (hg + 3.5) }, cam, vw, vh)
    const m3 = w2s({ x: moundCenter.x - uP.x * (hg + 2) + uF.x * 5, y: moundCenter.y - uP.y * (hg + 2) + uF.y * 5 }, cam, vw, vh)
    const m4 = w2s({ x: moundCenter.x + uP.x * (hg + 2) + uF.x * 5, y: moundCenter.y + uP.y * (hg + 2) + uF.y * 5 }, cam, vw, vh)

    ctx.fillStyle = '#94a3b8'
    ctx.beginPath()
    ctx.moveTo(m1[0], m1[1])
    ctx.lineTo(m2[0], m2[1])
    ctx.lineTo(m3[0], m3[1])
    ctx.lineTo(m4[0], m4[1])
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = '#64748b'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // 2. Heavy diagonal steel brace struts (jambes de force) bolted onto the rails
  const strutLen = 14
  const strutRailLeft = w2s({ x: node.pos.x - uF.x * strutLen + uP.x * hg, y: node.pos.y - uF.y * strutLen + uP.y * hg }, cam, vw, vh)
  const strutRailRight = w2s({ x: node.pos.x - uF.x * strutLen - uP.x * hg, y: node.pos.y - uF.y * strutLen - uP.y * hg }, cam, vw, vh)
  const strutHeadLeft = w2s({ x: node.pos.x + uF.x * 1.5 + uP.x * hg, y: node.pos.y + uF.y * 1.5 + uP.y * hg }, cam, vw, vh)
  const strutHeadRight = w2s({ x: node.pos.x + uF.x * 1.5 - uP.x * hg, y: node.pos.y + uF.y * 1.5 - uP.y * hg }, cam, vw, vh)

  ctx.strokeStyle = '#334155'
  ctx.lineWidth = Math.max(1.8, 2.2 * s)
  ctx.lineCap = 'square'

  ctx.beginPath()
  ctx.moveTo(strutRailLeft[0], strutRailLeft[1])
  ctx.lineTo(strutHeadLeft[0], strutHeadLeft[1])
  ctx.moveTo(strutRailRight[0], strutRailRight[1])
  ctx.lineTo(strutHeadRight[0], strutHeadRight[1])
  // Cross diagonal brace
  ctx.moveTo(strutRailLeft[0], strutRailLeft[1])
  ctx.lineTo(strutHeadRight[0], strutHeadRight[1])
  ctx.stroke()

  // 3. Heavy red buffer crossbeam (traverse rouge de butoir)
  const beamHalfW = hg + 3.8
  const beamCenter = { x: node.pos.x + uF.x * 2.0, y: node.pos.y + uF.y * 2.0 }
  const b1 = w2s({ x: beamCenter.x + uP.x * beamHalfW, y: beamCenter.y + uP.y * beamHalfW }, cam, vw, vh)
  const b2 = w2s({ x: beamCenter.x - uP.x * beamHalfW, y: beamCenter.y - uP.y * beamHalfW }, cam, vw, vh)

  ctx.strokeStyle = '#dc2626'
  ctx.lineWidth = Math.max(3.0, 4.0 * s)
  ctx.lineCap = 'butt'
  ctx.beginPath()
  ctx.moveTo(b1[0], b1[1])
  ctx.lineTo(b2[0], b2[1])
  ctx.stroke()

  // 4. White reflective center target (cible blanche réglementaire)
  const centerScr = w2s(beamCenter, cam, vw, vh)
  const targetR = Math.max(1.8, 2.4 * s)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(centerScr[0], centerScr[1], targetR, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#dc2626'
  ctx.lineWidth = 1
  ctx.stroke()

  // 5. Dual circular buffer pads (tampons de butoir) aligned with each rail
  const bufLeft = w2s({ x: beamCenter.x + uP.x * hg, y: beamCenter.y + uP.y * hg }, cam, vw, vh)
  const bufRight = w2s({ x: beamCenter.x - uP.x * hg, y: beamCenter.y - uP.y * hg }, cam, vw, vh)
  const padR = Math.max(1.5, 2.0 * s)

  ctx.fillStyle = '#0f172a'
  ctx.strokeStyle = '#475569'
  ctx.lineWidth = 1

  ctx.beginPath()
  ctx.arc(bufLeft[0], bufLeft[1], padR, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(bufRight[0], bufRight[1], padR, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  ctx.restore()
}
