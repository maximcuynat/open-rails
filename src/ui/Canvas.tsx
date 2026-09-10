import { useCallback, useEffect, useRef } from 'react'
import { clampScale, screenToWorld, type Camera } from '../render/camera'
import {
  renderGrid,
  renderNetwork,
  renderScaleBar,
  renderDetailedCurve,
  renderDetailedRail,
  pickSpacing,
  SIMPLIFY_THRESHOLD,
} from '../render/renderer'
import {
  addNode,
  addSegment,
  addCurveSegment,
  hitNode,
  hitSegment,
  snapToGrid,
} from '../core/network'
import type { Point, Selection } from '../core/types'
import { curveLength } from '../core/curve'
import { outgoingTangent } from '../core/tangent'
import {
  CURVE_RADII,
  STRAIGHT_LENGTHS,
  snapStraightLength,
  computeStraightPiece,
  computeCurvePiece,
} from '../core/profiles'
import type { EditorStore } from './store'

/** Render a snap indicator at a world point — a small cross + circle. */
function renderSnapIndicator(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  pos: Point,
): void {
  const accent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
  const sx = (pos.x - cam.x) * cam.scale + vw / 2
  const sy = (pos.y - cam.y) * cam.scale + vh / 2

  ctx.save()
  ctx.strokeStyle = accent
  ctx.fillStyle = accent
  ctx.globalAlpha = 0.8

  // Cross
  ctx.lineWidth = 1.5
  const r = 8
  ctx.beginPath()
  ctx.moveTo(sx - r, sy)
  ctx.lineTo(sx + r, sy)
  ctx.moveTo(sx, sy - r)
  ctx.lineTo(sx, sy + r)
  ctx.stroke()

  // Ring
  ctx.globalAlpha = 0.4
  ctx.beginPath()
  ctx.arc(sx, sy, 5, 0, Math.PI * 2)
  ctx.stroke()

  ctx.restore()
}

/** Render a straight rail preview snapped to a Kato standard length.
 *  Direction comes from cursor, length snaps to nearest standard piece. */
function renderPlacePreview(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  start: Point,
  cursor: Point,
  incomingTangent: Point | null,
): void {
  const accent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
  const ink = getComputedStyle(ctx.canvas).getPropertyValue('--ink').trim() || '#1a1a1a'
  const sleeperColor = getComputedStyle(ctx.canvas).getPropertyValue('--sleeper').trim() || '#8a7a6a'
  const paper = getComputedStyle(ctx.canvas).getPropertyValue('--paper').trim() || '#fff'
  const w2sX = (wx: number) => (wx - cam.x) * cam.scale + vw / 2
  const w2sY = (wy: number) => (wy - cam.y) * cam.scale + vh / 2

  ctx.save()

  // Compute direction from start to cursor
  const dx = cursor.x - start.x
  const dy = cursor.y - start.y
  const dist = Math.hypot(dx, dy)
  const dir = dist > 1 ? { x: dx / dist, y: dy / dist } : (incomingTangent ?? { x: 1, y: 0 })

  // Snap length to nearest Kato straight piece
  const snappedLen = snapStraightLength(dist)
  const snappedEnd = computeStraightPiece(start, dir, snappedLen)

  // Start node marker
  ctx.fillStyle = accent
  ctx.globalAlpha = 0.6
  ctx.beginPath()
  ctx.arc(w2sX(start.x), w2sY(start.y), 6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = paper
  ctx.beginPath()
  ctx.arc(w2sX(start.x), w2sY(start.y), 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // Rail preview to snapped end
  if (cam.scale < SIMPLIFY_THRESHOLD) {
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.setLineDash([8, 4])
    ctx.beginPath()
    ctx.moveTo(w2sX(start.x), w2sY(start.y))
    ctx.lineTo(w2sX(snappedEnd.x), w2sY(snappedEnd.y))
    ctx.stroke()
    ctx.setLineDash([])
  } else {
    ctx.globalAlpha = 0.7
    renderDetailedRail(ctx, cam, start, snappedEnd, vw, vh, false, ink, accent, sleeperColor)
    ctx.globalAlpha = 1
  }

  // Ghost line from snapped end to cursor
  if (Math.abs(dist - snappedLen) > 1) {
    ctx.strokeStyle = accent
    ctx.globalAlpha = 0.2
    ctx.lineWidth = 1
    ctx.setLineDash([2, 4])
    ctx.beginPath()
    ctx.moveTo(w2sX(snappedEnd.x), w2sY(snappedEnd.y))
    ctx.lineTo(w2sX(cursor.x), w2sY(cursor.y))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  // Length label near snapped end
  const labelText = `${snappedLen}mm`
  ctx.font = '600 11px Archivo, system-ui, sans-serif'
  const labelW = ctx.measureText(labelText).width
  const lx = w2sX(snappedEnd.x) + 14
  const ly = w2sY(snappedEnd.y) - 10

  ctx.fillStyle = 'rgba(37, 99, 235, 0.85)'
  ctx.beginPath()
  ctx.roundRect(lx - 6, ly - 14, labelW + 12, 20, 4)
  ctx.fill()
  ctx.fillStyle = paper
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(labelText, lx, ly - 4)

  ctx.restore()
}

interface CurvePreviewData {
  start: Point
  incomingTangent: Point
  radius: number
  side: 1 | -1
}

function renderCurvePreview(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  data: CurvePreviewData,
): void {
  const accent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
  const ink = getComputedStyle(ctx.canvas).getPropertyValue('--ink').trim() || '#1a1a1a'
  const sleeperColor = getComputedStyle(ctx.canvas).getPropertyValue('--sleeper').trim() || '#8a7a6a'
  const paper = getComputedStyle(ctx.canvas).getPropertyValue('--paper').trim() || '#fff'
  const w2sX = (wx: number) => (wx - cam.x) * cam.scale + vw / 2
  const w2sY = (wy: number) => (wy - cam.y) * cam.scale + vh / 2

  ctx.save()

  const { end, via, angle } = computeCurvePiece(data.start, data.incomingTangent, data.radius, data.side)
  const len = curveLength(data.start, via, end)
  const profileLabel = `R${data.radius} ${angle}°`

  // Start node marker
  ctx.fillStyle = accent
  ctx.globalAlpha = 0.6
  ctx.beginPath()
  ctx.arc(w2sX(data.start.x), w2sY(data.start.y), 6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = paper
  ctx.beginPath()
  ctx.arc(w2sX(data.start.x), w2sY(data.start.y), 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // Curve preview
  if (cam.scale < SIMPLIFY_THRESHOLD) {
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(w2sX(data.start.x), w2sY(data.start.y))
    ctx.quadraticCurveTo(w2sX(via.x), w2sY(via.y), w2sX(end.x), w2sY(end.y))
    ctx.stroke()
  } else {
    renderDetailedCurve(ctx, cam, data.start, via, end, vw, vh, false, ink, accent, sleeperColor)
  }

  // Label near end
  const labelText = `${profileLabel}  L: ${len.toFixed(0)}mm`
  ctx.font = '600 11px Archivo, system-ui, sans-serif'
  const labelW = ctx.measureText(labelText).width
  const lx = w2sX(end.x) + 14
  const ly = w2sY(end.y) - 10

  ctx.fillStyle = 'rgba(37, 99, 235, 0.85)'
  ctx.beginPath()
  ctx.roundRect(lx - 6, ly - 14, labelW + 12, 20, 4)
  ctx.fill()
  ctx.fillStyle = paper
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(labelText, lx, ly - 4)

  ctx.restore()
}

interface CanvasProps {
  store: EditorStore
  /** Called with viewport dimensions on resize; used by parent for fit-view etc. */
  onViewport?: (w: number, h: number) => void
}

export function Canvas({ store, onViewport }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cam = store.camera
    const rect = canvas.getBoundingClientRect()
    if (store.showGrid) {
      renderGrid(ctx, cam, rect.width, rect.height)
    } else {
      const bg = getComputedStyle(canvas).getPropertyValue('--paper').trim() || '#fff'
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, rect.width, rect.height)
    }
    renderNetwork(ctx, cam, rect.width, rect.height, store.network, store.selection)

    // Snap indicator (Place and Curve tools, when snap is on)
    if (store.snap && (store.tool === 'place' || store.tool === 'curve')) {
      renderSnapIndicator(ctx, cam, rect.width, rect.height, store.snappedCursor)
    }

    // Place tool preview: rail from last node, snapped to Kato length
    if (store.tool === 'place' && store.lastNodeId) {
      const startNode = store.network.nodes.get(store.lastNodeId)
      if (startNode) {
        const incoming = outgoingTangent(store.network, store.lastNodeId)
        renderPlacePreview(ctx, cam, rect.width, rect.height, startNode.pos, store.snappedCursor, incoming)
      }
    }

    // Curve preview — Kato catalog piece
    const cs = store.curveState
    if (cs.phase === 1 && cs.startId) {
      const startNode = store.network.nodes.get(cs.startId)
      if (startNode) {
        const incoming = outgoingTangent(store.network, cs.startId) ?? { x: 1, y: 0 }
        const radius = CURVE_RADII[store.curveProfileIdx]
        if (radius !== Infinity) {
          renderCurvePreview(ctx, cam, rect.width, rect.height, {
            start: startNode.pos,
            incomingTangent: incoming,
            radius,
            side: store.curveSide,
          })
        }
      }
    }

    renderScaleBar(ctx, cam, rect.width, rect.height)
  }, [store])

  const getWorldPos = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current!
      const cam = store.camera
      const rect = canvas.getBoundingClientRect()
      return screenToWorld(cam, clientX - rect.left, clientY - rect.top, rect.width, rect.height)
    },
    [store],
  )

  const getSnapSpacing = useCallback(() => {
    return store.snap ? pickSpacing(store.camera.scale) : 0
  }, [store])

  // Resize handling
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw()
      onViewport?.(rect.width, rect.height)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [draw, onViewport])

  // Redraw trigger (called after mutations)
  const redraw = useCallback(() => {
    draw()
    store.notify()
  }, [draw, store])

  // Pan + zoom + placement
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let lastX = 0
    let lastY = 0

    const onDown = (e: PointerEvent) => {
      if (e.button === 2) {
        // Right click: cancel placement chain or curve
        store.lastNodeId = null
        if (store.tool === 'curve' && store.curveState.phase === 1) {
          store.curveState = { phase: 0, startId: null }
          redraw()
        }
        return
      }

      if (e.button === 1 || (e.button === 0 && (e.shiftKey || store.tool === 'pan'))) {
        // Middle click, shift+click, or pan tool: pan
        store.panning = true
        lastX = e.clientX
        lastY = e.clientY
        store.moved = false
        canvas.setPointerCapture(e.pointerId)
        return
      }

      if (e.button === 0 && store.tool === 'curve') {
        const world = getWorldPos(e.clientX, e.clientY)
        const spacing = getSnapSpacing()
        const snapped = snapToGrid(world, spacing)
        const hitTol = 1.5 / store.camera.scale
        const cs = store.curveState

        if (cs.phase === 0) {
          // Click 1: place/select start node
          const existing = hitNode(store.network, snapped, hitTol)
          const startId = existing ?? addNode(store.network, snapped).id
          store.curveState = { phase: 1, startId }
          store.selection = { nodes: new Set([startId]), segments: new Set() }
          store.markDirty()
          redraw()
        } else if (cs.phase === 1) {
          // Click 2: place standard Kato curve piece from catalog
          const radius = CURVE_RADII[store.curveProfileIdx]
          if (cs.startId && radius !== Infinity) {
            const startNode = store.network.nodes.get(cs.startId)
            if (startNode) {
              const incoming = outgoingTangent(store.network, cs.startId) ?? { x: 1, y: 0 }
              const { end, via } = computeCurvePiece(startNode.pos, incoming, radius, store.curveSide)
              const endId = addNode(store.network, end).id
              addCurveSegment(store.network, cs.startId, endId, via)
              store.markDirty()
              // Chain: end node becomes new start
              store.curveState = { phase: 1, startId: endId }
              store.selection = { nodes: new Set([endId]), segments: new Set() }
            }
          } else if (cs.startId && radius === Infinity) {
            // Straight piece — use place logic with default length
            const startNode = store.network.nodes.get(cs.startId)
            if (startNode) {
              const incoming = outgoingTangent(store.network, cs.startId) ?? { x: 1, y: 0 }
              const snappedLen = STRAIGHT_LENGTHS[8] // 246mm default straight
              const endPos = computeStraightPiece(startNode.pos, incoming, snappedLen)
              const endId = addNode(store.network, endPos).id
              addSegment(store.network, cs.startId, endId)
              store.markDirty()
              store.curveState = { phase: 1, startId: endId }
              store.selection = { nodes: new Set([endId]), segments: new Set() }
            }
          }
          redraw()
        }
        return
      }

      if (e.button === 0 && store.tool === 'place') {
        // Place a node — snapped to Kato standard length
        const world = getWorldPos(e.clientX, e.clientY)
        const spacing = getSnapSpacing()
        const snapped = snapToGrid(world, spacing)

        // Check if clicking on an existing node
        const hitTol = 1.5 / store.camera.scale
        const existing = hitNode(store.network, snapped, hitTol)

        if (existing) {
          if (store.lastNodeId && store.lastNodeId !== existing) {
            addSegment(store.network, store.lastNodeId, existing)
            store.markDirty()
          }
          store.lastNodeId = existing
          store.selection = { nodes: new Set([existing]), segments: new Set() }
        } else if (store.lastNodeId) {
          // Compute direction from last node to cursor, snap length to Kato
          const startNode = store.network.nodes.get(store.lastNodeId)
          if (startNode) {
            const dx = snapped.x - startNode.pos.x
            const dy = snapped.y - startNode.pos.y
            const dist = Math.hypot(dx, dy)
            if (dist > 1) {
              const dir = { x: dx / dist, y: dy / dist }
              const snappedLen = snapStraightLength(dist)
              const endPos = computeStraightPiece(startNode.pos, dir, snappedLen)
              const node = addNode(store.network, endPos)
              addSegment(store.network, store.lastNodeId, node.id)
              store.markDirty()
              store.lastNodeId = node.id
              store.selection = { nodes: new Set([node.id]), segments: new Set() }
            }
          }
        } else {
          // No previous node — place start node at cursor
          const node = addNode(store.network, snapped)
          store.lastNodeId = node.id
          store.selection = { nodes: new Set([node.id]), segments: new Set() }
        }
        redraw()
        return
      }

      if (e.button === 0 && store.tool === 'select') {
        // Select: try hit node, then segment
        const world = getWorldPos(e.clientX, e.clientY)
        const hitTol = 1.5 / store.camera.scale
        const nodeId = hitNode(store.network, world, hitTol)
        if (nodeId) {
          store.selection = { nodes: new Set([nodeId]), segments: new Set() }
          redraw()
          return
        }
        const segId = hitSegment(store.network, world, hitTol)
        if (segId) {
          store.selection = { nodes: new Set(), segments: new Set([segId]) }
          redraw()
          return
        }
        // Empty click: start panning
        store.panning = true
        lastX = e.clientX
        lastY = e.clientY
        store.moved = false
        canvas.setPointerCapture(e.pointerId)
        const empty: Selection = { nodes: new Set(), segments: new Set() }
        store.selection = empty
        redraw()
      }
    }

    const onMove = (e: PointerEvent) => {
      // Track cursor for previews
      const world = getWorldPos(e.clientX, e.clientY)
      store.cursorWorld = world
      const spacing = store.snap ? getSnapSpacing() : 0
      store.snappedCursor = snapToGrid(world, spacing)

      if (!store.panning) {
        // Redraw for preview if in place or curve mode
        if (store.tool === 'place' && store.lastNodeId) {
          draw()
        } else if (store.tool === 'curve' && store.curveState.phase > 0) {
          draw()
        }
        store.notify()
        return
      }

      const cam = store.camera
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) store.moved = true
      lastX = e.clientX
      lastY = e.clientY
      cam.x -= dx / cam.scale
      cam.y -= dy / cam.scale
      draw()
      store.notify()
    }

    const onUp = (e: PointerEvent) => {
      store.panning = false
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId)
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cam = store.camera
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const vw = rect.width
      const vh = rect.height

      const worldX = cam.x + (px - vw / 2) / cam.scale
      const worldY = cam.y + (py - vh / 2) / cam.scale

      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      cam.scale = clampScale(cam.scale * factor)

      cam.x = worldX - (px - vw / 2) / cam.scale
      cam.y = worldY - (py - vh / 2) / cam.scale
      draw()
      store.notify()
    }

    const onContextMenu = (e: Event) => e.preventDefault()

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)
    }
  }, [store, draw, redraw, getWorldPos, getSnapSpacing])

  return (
    <div className="canvas-wrap">
      <canvas ref={canvasRef} className={`tool-${store.tool}`} />
    </div>
  )
}
