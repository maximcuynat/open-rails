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
import type { Point, Network, RailNode } from '../core/types'
import { curveLength, bezierPoint, bezierTangent } from '../core/curve'
import { getTangentForPlacement } from '../core/tangent'
import {
  snapStraightLength,
  computeStraightPiece,
  computeCurvePiece,
  computeFreeformCurve,
} from '../core/profiles'
import {
  splitSegment,
  findJunctionAtNode,
  toggleJunction,
} from '../core/junction'
import { reconcileNetworkIntersections } from '../core/reconcile'
import type { EditorStore } from './store'

/** Find the nearest node within screen pixel tolerance. */
function findNearestNode(net: Network, worldPos: Point, maxScreenPx: number, cam: Camera): RailNode | null {
  const maxDistWorld = maxScreenPx / cam.scale
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
function snapDirection(dir: Point, stepDeg = 15, tolDeg = 6): Point {
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

/** Render a snap indicator at a world point — a crosshair or magnetic lock ring. */
function renderSnapIndicator(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  pos: Point,
  isNodeSnap: boolean,
): void {
  const accent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
  const sx = (pos.x - cam.x) * cam.scale + vw / 2
  const sy = (pos.y - cam.y) * cam.scale + vh / 2

  ctx.save()
  if (isNodeSnap) {
    // Magnetic lock onto existing track node
    ctx.strokeStyle = '#10b981' // emerald green
    ctx.fillStyle = '#10b981'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(sx, sy, 10, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 0.3
    ctx.beginPath()
    ctx.arc(sx, sy, 5, 0, Math.PI * 2)
    ctx.fill()
  } else {
    // Grid snap crosshair
    ctx.strokeStyle = accent
    ctx.fillStyle = accent
    ctx.lineWidth = 1.5
    ctx.globalAlpha = 0.8
    const r = 7
    ctx.beginPath()
    ctx.moveTo(sx - r, sy)
    ctx.lineTo(sx + r, sy)
    ctx.moveTo(sx, sy - r)
    ctx.lineTo(sx, sy + r)
    ctx.stroke()

    ctx.globalAlpha = 0.3
    ctx.beginPath()
    ctx.arc(sx, sy, 5, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

/** Determine which side of the tangent the cursor is on.
 *  Returns -1 (left / Gauche) or 1 (right / Droite) based on 2D cross product in screen coordinates (Y down). */
function computeSide(tangent: Point, start: Point, cursor: Point): 1 | -1 {
  const dx = cursor.x - start.x
  const dy = cursor.y - start.y
  // Cross product in screen coordinates (+X right, +Y down):
  // tangent.x * dy - tangent.y * dx < 0 means cursor is to the LEFT (side = -1)
  // tangent.x * dy - tangent.y * dx >= 0 means cursor is to the RIGHT (side = 1)
  const cross = tangent.x * dy - tangent.y * dx
  return cross < 0 ? -1 : 1
}

/** Render a straight rail preview to the candidate end. */
function renderPlacePreview(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  start: Point,
  snappedEnd: Point,
  labelText: string,
  isClosedToNode = false,
): void {
  const accent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
  const sleeperColor = getComputedStyle(ctx.canvas).getPropertyValue('--sleeper').trim() || '#443425'
  const ballastColor = getComputedStyle(ctx.canvas).getPropertyValue('--ballast').trim() || '#dcd6cc'
  const ballastEdge = getComputedStyle(ctx.canvas).getPropertyValue('--ballast-edge').trim() || '#c2b9aa'
  const railColor = getComputedStyle(ctx.canvas).getPropertyValue('--rail').trim() || '#526071'
  const paper = getComputedStyle(ctx.canvas).getPropertyValue('--paper').trim() || '#fff'
  const w2sX = (wx: number) => (wx - cam.x) * cam.scale + vw / 2
  const w2sY = (wy: number) => (wy - cam.y) * cam.scale + vh / 2

  ctx.save()

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
    ctx.globalAlpha = 0.75
    renderDetailedRail(ctx, cam, start, snappedEnd, vw, vh, false, railColor, accent, sleeperColor, ballastColor, ballastEdge)
    ctx.globalAlpha = 1
  }

  // Directional chevron at midpoint showing construction direction (start -> end)
  const midX = (start.x + snappedEnd.x) / 2
  const midY = (start.y + snappedEnd.y) / 2
  const pAngle = Math.atan2(snappedEnd.y - start.y, snappedEnd.x - start.x)
  ctx.save()
  ctx.translate(w2sX(midX), w2sY(midY))
  ctx.rotate(pAngle)
  ctx.strokeStyle = accent
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(-6, -5)
  ctx.lineTo(2, 0)
  ctx.lineTo(-6, 5)
  ctx.stroke()
  ctx.restore()

  // End node marker / snap indicator
  if (isClosedToNode) {
    ctx.strokeStyle = '#10b981'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(w2sX(snappedEnd.x), w2sY(snappedEnd.y), 8, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Length label near snapped end
  ctx.font = '600 11px Archivo, system-ui, sans-serif'
  const labelW = ctx.measureText(labelText).width
  const lx = w2sX(snappedEnd.x) + 14
  const ly = w2sY(snappedEnd.y) - 10

  ctx.fillStyle = isClosedToNode ? 'rgba(16, 185, 129, 0.9)' : 'rgba(37, 99, 235, 0.85)'
  ctx.beginPath()
  ctx.roundRect(lx - 6, ly - 14, labelW + 12, 20, 4)
  ctx.fill()
  ctx.fillStyle = paper
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(labelText, lx, ly - 4)

  ctx.restore()
}

function renderCurvePreview(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  start: Point,
  via: Point,
  end: Point,
  labelText: string,
  isClosedToNode = false,
): void {
  const accent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
  const sleeperColor = getComputedStyle(ctx.canvas).getPropertyValue('--sleeper').trim() || '#443425'
  const ballastColor = getComputedStyle(ctx.canvas).getPropertyValue('--ballast').trim() || '#dcd6cc'
  const ballastEdge = getComputedStyle(ctx.canvas).getPropertyValue('--ballast-edge').trim() || '#c2b9aa'
  const railColor = getComputedStyle(ctx.canvas).getPropertyValue('--rail').trim() || '#526071'
  const paper = getComputedStyle(ctx.canvas).getPropertyValue('--paper').trim() || '#fff'
  const w2sX = (wx: number) => (wx - cam.x) * cam.scale + vw / 2
  const w2sY = (wy: number) => (wy - cam.y) * cam.scale + vh / 2

  ctx.save()

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

  // Curve preview
  if (cam.scale < SIMPLIFY_THRESHOLD) {
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(w2sX(start.x), w2sY(start.y))
    ctx.quadraticCurveTo(w2sX(via.x), w2sY(via.y), w2sX(end.x), w2sY(end.y))
    ctx.stroke()
    ctx.setLineDash([])
  } else {
    ctx.globalAlpha = 0.75
    renderDetailedCurve(ctx, cam, start, via, end, vw, vh, false, railColor, accent, sleeperColor, ballastColor, ballastEdge)
    ctx.globalAlpha = 1
  }

  // Directional chevron at t=0.5 along curve tangent showing construction direction
  const midPt = bezierPoint(0.5, start, via, end)
  const midTan = bezierTangent(0.5, start, via, end)
  const cAngle = Math.atan2(midTan.y, midTan.x)
  ctx.save()
  ctx.translate(w2sX(midPt.x), w2sY(midPt.y))
  ctx.rotate(cAngle)
  ctx.strokeStyle = accent
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(-6, -5)
  ctx.lineTo(2, 0)
  ctx.lineTo(-6, 5)
  ctx.stroke()
  ctx.restore()

  // End node marker / snap indicator
  if (isClosedToNode) {
    ctx.strokeStyle = '#10b981'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(w2sX(end.x), w2sY(end.y), 8, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Label near end
  ctx.font = '600 11px Archivo, system-ui, sans-serif'
  const labelW = ctx.measureText(labelText).width
  const lx = w2sX(end.x) + 14
  const ly = w2sY(end.y) - 10

  ctx.fillStyle = isClosedToNode ? 'rgba(16, 185, 129, 0.9)' : 'rgba(37, 99, 235, 0.85)'
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

    // Box selection rectangle
    if (store.isBoxSelecting && store.boxSelectStart && store.boxSelectEnd) {
      const accent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
      const sx1 = (store.boxSelectStart.x - cam.x) * cam.scale + rect.width / 2
      const sy1 = (store.boxSelectStart.y - cam.y) * cam.scale + rect.height / 2
      const sx2 = (store.boxSelectEnd.x - cam.x) * cam.scale + rect.width / 2
      const sy2 = (store.boxSelectEnd.y - cam.y) * cam.scale + rect.height / 2
      const x = Math.min(sx1, sx2)
      const y = Math.min(sy1, sy2)
      const w = Math.abs(sx2 - sx1)
      const h = Math.abs(sy2 - sy1)
      ctx.save()
      ctx.strokeStyle = accent
      ctx.fillStyle = accent
      ctx.globalAlpha = 0.1
      ctx.fillRect(x, y, w, h)
      ctx.globalAlpha = 0.8
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.strokeRect(x, y, w, h)
      ctx.setLineDash([])
      ctx.restore()
    }

    // Snap indicator (Place and Curve tools)
    if (store.tool === 'place' || store.tool === 'curve') {
      const isNode = store.hoverNodeId !== null
      if (isNode || store.snap) {
        renderSnapIndicator(ctx, cam, rect.width, rect.height, store.snappedCursor, isNode)
      }
    }

    // Place tool preview: rail from last node, snapped to Kato length or freeform
    if (store.tool === 'place' && store.lastNodeId) {
      const startNode = store.network.nodes.get(store.lastNodeId)
      if (startNode) {
        const cursor = store.snap ? store.snappedCursor : store.cursorWorld
        const tangent = getTangentForPlacement(store.network, store.lastNodeId, cursor)
        let dir: Point
        let snappedLen: number
        let candidateEnd: Point
        const dx = cursor.x - startNode.pos.x
        const dy = cursor.y - startNode.pos.y

        if (tangent) {
          dir = tangent
          const proj = dx * dir.x + dy * dir.y
          const dist = Math.max(10, proj)
          if (store.trackMode === 'freeform') {
            snappedLen = Math.max(10, Math.round(dist))
          } else if (store.selectedStraightLength !== 'auto') {
            snappedLen = store.selectedStraightLength
          } else {
            snappedLen = snapStraightLength(dist)
          }
          candidateEnd = computeStraightPiece(startNode.pos, dir, snappedLen)
        } else {
          if (store.trackMode === 'freeform') {
            candidateEnd = cursor
            snappedLen = Math.max(10, Math.round(Math.hypot(dx, dy)))
          } else {
            const dist = Math.hypot(dx, dy)
            dir = dist > 1 ? snapDirection({ x: dx / dist, y: dy / dist }, 15, 6) : { x: 1, y: 0 }
            if (store.selectedStraightLength !== 'auto') {
              snappedLen = store.selectedStraightLength
            } else {
              snappedLen = snapStraightLength(dist)
            }
            candidateEnd = computeStraightPiece(startNode.pos, dir, snappedLen)
          }
        }
        const closeNode = findNearestNode(store.network, candidateEnd, 16, cam)
        const isJoinNode = closeNode !== null && closeNode.id !== store.lastNodeId
        const hitSegId = !isJoinNode ? hitSegment(store.network, candidateEnd, 16 / cam.scale) : null
        const isJoin = isJoinNode || hitSegId !== null
        const prefix = store.trackMode === 'freeform' ? 'Flex ' : ''
        const joinSuffix = isJoinNode ? '  → Jonction' : hitSegId ? '  → Aiguillage sur voie' : ''
        const labelText = `${prefix}${snappedLen}mm${joinSuffix}`
        renderPlacePreview(ctx, cam, rect.width, rect.height, startNode.pos, candidateEnd, labelText, isJoin)
      }
    }

    // Curve preview — Kato catalog piece or freeform tangent arc
    const cs = store.curveState
    if (cs.phase === 1 && cs.startId) {
      const startNode = store.network.nodes.get(cs.startId)
      if (startNode) {
        const cursor = store.snap ? store.snappedCursor : store.cursorWorld
        const tangent = getTangentForPlacement(store.network, cs.startId, cursor) ?? (() => {
          const dx = cursor.x - startNode.pos.x
          const dy = cursor.y - startNode.pos.y
          const len = Math.hypot(dx, dy)
          return len > 1 ? snapDirection({ x: dx / len, y: dy / len }, 15, 6) : { x: 1, y: 0 }
        })()

        if (store.trackMode === 'freeform') {
          const closeNode = findNearestNode(store.network, cursor, 16, cam)
          const target = closeNode && closeNode.id !== cs.startId ? closeNode.pos : cursor
          const { end, via, radius, angle } = computeFreeformCurve(startNode.pos, tangent, target)
          const isJoinNode = closeNode !== null && closeNode.id !== cs.startId
          const hitSegId = !isJoinNode ? hitSegment(store.network, end, 16 / cam.scale) : null
          const isJoin = isJoinNode || hitSegId !== null
          const len = curveLength(startNode.pos, via, end)
          const side = computeSide(tangent, startNode.pos, target)
          const sideLabel = side === -1 ? 'Gauche' : 'Droite'
          const joinSuffix = isJoinNode ? '  → Jonction' : hitSegId ? '  → Aiguillage sur voie' : ''
          const labelText = radius === Infinity
            ? `Flex ${len.toFixed(0)}mm${joinSuffix}`
            : `Flex ${sideLabel} R${radius.toFixed(0)} ${angle.toFixed(1)}° (${len.toFixed(0)}mm)${joinSuffix}`
          renderCurvePreview(ctx, cam, rect.width, rect.height, startNode.pos, via, end, labelText, isJoin)
        } else {
          const radius = store.selectedCurveRadius
          const angle = store.selectedCurveAngle
          const side = store.autoCurveSide ? computeSide(tangent, startNode.pos, cursor) : store.curveSide
          const sideLabel = side === -1 ? 'Gauche' : 'Droite'
          const { end, via } = computeCurvePiece(startNode.pos, tangent, radius, side, angle)
          const closeNode = findNearestNode(store.network, end, 16, cam)
          const isJoinNode = closeNode !== null && closeNode.id !== cs.startId
          const hitSegId = !isJoinNode ? hitSegment(store.network, end, 16 / cam.scale) : null
          const isJoin = isJoinNode || hitSegId !== null
          const len = curveLength(startNode.pos, via, end)
          const joinSuffix = isJoinNode ? '  → Jonction' : hitSegId ? '  → Aiguillage sur voie' : ''
          const labelText = `Courbe ${sideLabel} R${radius} ${angle}° (${len.toFixed(0)}mm)${joinSuffix}`
          renderCurvePreview(ctx, cam, rect.width, rect.height, startNode.pos, via, end, labelText, isJoin)
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

  // Subscribe to store notifications so external changes immediately redraw the canvas
  useEffect(() => {
    return store.subscribe(draw)
  }, [store, draw])

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
        store.curveState = { phase: 0, startId: null }
        redraw()
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
        const cs = store.curveState

        if (cs.phase === 0) {
          // Click 1: pick start node (magnetic snap to existing node, or split segment on track, or place new)
          const clickedNode = findNearestNode(store.network, world, 16, store.camera)
          let startId: string
          if (clickedNode) {
            startId = clickedNode.id
          } else {
            const hitTol = 16 / store.camera.scale
            const hitSegId = hitSegment(store.network, world, hitTol)
            if (hitSegId) {
              const splitRes = splitSegment(store.network, hitSegId, world)
              startId = splitRes ? splitRes.midNode.id : addNode(store.network, world).id
            } else {
              const spacing = getSnapSpacing()
              const pos = store.snap ? snapToGrid(world, spacing) : world
              startId = addNode(store.network, pos).id
            }
          }
          store.curveState = { phase: 1, startId }
          store.lastNodeId = startId
          store.selection = { nodes: new Set([startId]), segments: new Set() }
          store.markDirty()
          redraw()
        } else if (cs.phase === 1 && cs.startId) {
          const startNode = store.network.nodes.get(cs.startId)
          if (startNode) {
            const tangent = getTangentForPlacement(store.network, cs.startId, world) ?? (() => {
              const dx = world.x - startNode.pos.x
              const dy = world.y - startNode.pos.y
              const len = Math.hypot(dx, dy)
              return len > 1 ? snapDirection({ x: dx / len, y: dy / len }, 15, 6) : { x: 1, y: 0 }
            })()

            let endPos: Point
            let viaPos: Point

            if (store.trackMode === 'freeform') {
              const spacing = getSnapSpacing()
              const snappedWorld = store.snap ? snapToGrid(world, spacing) : world
              const closeTarget = findNearestNode(store.network, snappedWorld, 16, store.camera)
              const target = closeTarget && closeTarget.id !== cs.startId ? closeTarget.pos : snappedWorld
              const curve = computeFreeformCurve(startNode.pos, tangent, target)
              endPos = curve.end
              viaPos = curve.via
            } else {
              const radius = store.selectedCurveRadius
              const angle = store.selectedCurveAngle
              const side = store.autoCurveSide ? computeSide(tangent, startNode.pos, world) : store.curveSide
              const curve = computeCurvePiece(startNode.pos, tangent, radius, side, angle)
              endPos = curve.end
              viaPos = curve.via
            }

            // Auto-snap destination: connect to existing node if close (closes loops!)
            // Or if close to an existing segment, split that segment and connect to midNode!
            const closeNode = findNearestNode(store.network, endPos, 16, store.camera)
            let endId: string
            if (closeNode && closeNode.id !== cs.startId) {
              endId = closeNode.id
            } else {
              const hitTol = 16 / store.camera.scale
              const hitSegId = hitSegment(store.network, endPos, hitTol)
              if (hitSegId) {
                const splitRes = splitSegment(store.network, hitSegId, endPos)
                endId = splitRes ? splitRes.midNode.id : addNode(store.network, endPos).id
              } else {
                endId = addNode(store.network, endPos).id
              }
            }
            addCurveSegment(store.network, cs.startId, endId, viaPos)
            reconcileNetworkIntersections(store.network)
            store.markDirty()
            store.curveState = { phase: 1, startId: endId }
            store.lastNodeId = endId
            store.selection = { nodes: new Set([endId]), segments: new Set() }
          }
          redraw()
        }
        return
      }

      if (e.button === 0 && store.tool === 'place') {
        const world = getWorldPos(e.clientX, e.clientY)
        const clickedNode = findNearestNode(store.network, world, 16, store.camera)

        if (clickedNode) {
          // Clicked directly on an existing node: connect if coming from another node, and arm it!
          if (store.lastNodeId && store.lastNodeId !== clickedNode.id) {
            addSegment(store.network, store.lastNodeId, clickedNode.id)
            reconcileNetworkIntersections(store.network)
            store.markDirty()
          }
          store.lastNodeId = clickedNode.id
          store.selection = { nodes: new Set([clickedNode.id]), segments: new Set() }
        } else if (store.lastNodeId) {
          // Extending from lastNodeId
          const startNode = store.network.nodes.get(store.lastNodeId)
          if (startNode) {
            const spacing = getSnapSpacing()
            const snappedWorld = store.snap ? snapToGrid(world, spacing) : world
            const tangent = getTangentForPlacement(store.network, store.lastNodeId, snappedWorld)
            let dir: Point
            let snappedLen: number
            let endPos: Point
            const dx = snappedWorld.x - startNode.pos.x
            const dy = snappedWorld.y - startNode.pos.y

            if (tangent) {
              dir = tangent
              const proj = dx * dir.x + dy * dir.y
              const dist = Math.max(10, proj)
              if (store.trackMode === 'freeform') {
                snappedLen = Math.max(10, Math.round(dist))
              } else if (store.selectedStraightLength !== 'auto') {
                snappedLen = store.selectedStraightLength
              } else {
                snappedLen = snapStraightLength(dist)
              }
              endPos = computeStraightPiece(startNode.pos, dir, snappedLen)
            } else {
              if (store.trackMode === 'freeform') {
                const closeTarget = findNearestNode(store.network, snappedWorld, 16, store.camera)
                endPos = closeTarget && closeTarget.id !== store.lastNodeId ? closeTarget.pos : snappedWorld
              } else {
                const rawDist = Math.hypot(dx, dy)
                dir = rawDist > 1 ? snapDirection({ x: dx / rawDist, y: dy / rawDist }, 15, 6) : { x: 1, y: 0 }
                if (store.selectedStraightLength !== 'auto') {
                  snappedLen = store.selectedStraightLength
                } else {
                  snappedLen = snapStraightLength(rawDist)
                }
                endPos = computeStraightPiece(startNode.pos, dir, snappedLen)
              }
            }

            const closeNode = findNearestNode(store.network, endPos, 16, store.camera)
            let endId: string
            if (closeNode && closeNode.id !== store.lastNodeId) {
              endId = closeNode.id
            } else {
              const hitTol = 16 / store.camera.scale
              const hitSegId = hitSegment(store.network, endPos, hitTol)
              if (hitSegId) {
                const splitRes = splitSegment(store.network, hitSegId, endPos)
                endId = splitRes ? splitRes.midNode.id : addNode(store.network, endPos).id
              } else {
                endId = addNode(store.network, endPos).id
              }
            }
            addSegment(store.network, store.lastNodeId, endId)
            reconcileNetworkIntersections(store.network)
            store.markDirty()
            store.lastNodeId = endId
            store.selection = { nodes: new Set([endId]), segments: new Set() }
          }
        } else {
          // First node placement: if clicked on an existing segment, split it to start from it!
          const hitTol = 16 / store.camera.scale
          const hitSegId = hitSegment(store.network, world, hitTol)
          let startNodeId: string
          if (hitSegId) {
            const splitRes = splitSegment(store.network, hitSegId, world)
            startNodeId = splitRes ? splitRes.midNode.id : addNode(store.network, world).id
          } else {
            const spacing = getSnapSpacing()
            const pos = store.snap ? snapToGrid(world, spacing) : world
            startNodeId = addNode(store.network, pos).id
          }
          store.lastNodeId = startNodeId
          store.selection = { nodes: new Set([startNodeId]), segments: new Set() }
          store.markDirty()
        }
        redraw()
        return
      }

      if (e.button === 0 && store.tool === 'select') {
        const world = getWorldPos(e.clientX, e.clientY)
        const hitTol = 14 / store.camera.scale
        const nodeId = hitNode(store.network, world, hitTol)
        if (nodeId) {
          const existingJunc = findJunctionAtNode(store.network, nodeId)
          if (existingJunc && store.selection.nodes.has(nodeId) && !e.shiftKey) {
            toggleJunction(existingJunc)
            store.markDirty()
          }
          if (e.shiftKey) {
            const newNodes = new Set(store.selection.nodes)
            if (newNodes.has(nodeId)) newNodes.delete(nodeId)
            else newNodes.add(nodeId)
            store.selection = { ...store.selection, nodes: newNodes }
          } else {
            if (!store.selection.nodes.has(nodeId)) {
              store.selection = { nodes: new Set([nodeId]), segments: new Set() }
            }
          }
          // Start dragging selected nodes!
          store.isDraggingNode = true
          store.dragStartWorld = world
          store.draggedNodeInitialPositions.clear()
          for (const nid of store.selection.nodes) {
            const node = store.network.nodes.get(nid)
            if (node) {
              store.draggedNodeInitialPositions.set(nid, { ...node.pos })
            }
          }
          canvas.setPointerCapture(e.pointerId)
          redraw()
          return
        }
        const segId = hitSegment(store.network, world, 12 / store.camera.scale)
        if (segId) {
          if (e.shiftKey) {
            const newSegs = new Set(store.selection.segments)
            if (newSegs.has(segId)) newSegs.delete(segId)
            else newSegs.add(segId)
            store.selection = { ...store.selection, segments: newSegs }
          } else {
            store.selection = { nodes: new Set(), segments: new Set([segId]) }
          }
          redraw()
          return
        }
        // Empty click: start box selection (not panning)
        store.isBoxSelecting = true
        store.boxSelectStart = world
        store.boxSelectEnd = world
        if (!e.shiftKey) {
          store.selection = { nodes: new Set(), segments: new Set() }
        }
        canvas.setPointerCapture(e.pointerId)
        redraw()
      }
    }

    const onMove = (e: PointerEvent) => {
      const rawWorld = getWorldPos(e.clientX, e.clientY)
      store.cursorWorld = rawWorld

      // Dragging selected nodes in select tool
      if (store.isDraggingNode && store.dragStartWorld) {
        const dx = rawWorld.x - store.dragStartWorld.x
        const dy = rawWorld.y - store.dragStartWorld.y
        const spacing = getSnapSpacing()
        for (const [nid, initPos] of store.draggedNodeInitialPositions) {
          const node = store.network.nodes.get(nid)
          if (node) {
            let nx = initPos.x + dx
            let ny = initPos.y + dy
            if (store.snap) {
              const snapped = snapToGrid({ x: nx, y: ny }, spacing)
              nx = snapped.x
              ny = snapped.y
            }
            node.pos.x = nx
            node.pos.y = ny
          }
        }
        draw()
        store.notify()
        return
      }

      // Magnetic node snap has priority 1
      const nearNode = findNearestNode(store.network, rawWorld, 16, store.camera)
      if (nearNode) {
        store.snappedCursor = { ...nearNode.pos }
        store.hoverNodeId = nearNode.id
      } else {
        store.hoverNodeId = null
        // Priority 2: Magnetic track snap when using place, curve, turnout, crossing
        const hitTol = 18 / store.camera.scale
        const hitSegId = hitSegment(store.network, rawWorld, hitTol)
        if (hitSegId && (store.tool === 'place' || store.tool === 'curve')) {
          const seg = store.network.segments.get(hitSegId)
          const nodeA = seg ? store.network.nodes.get(seg.from) : null
          const nodeB = seg ? store.network.nodes.get(seg.to) : null
          if (seg && nodeA && nodeB) {
            if (seg.kind === 'straight') {
              const dx = nodeB.pos.x - nodeA.pos.x
              const dy = nodeB.pos.y - nodeA.pos.y
              const lenSq = dx * dx + dy * dy
              if (lenSq > 0) {
                const t = Math.max(0.02, Math.min(0.98, ((rawWorld.x - nodeA.pos.x) * dx + (rawWorld.y - nodeA.pos.y) * dy) / lenSq))
                store.snappedCursor = { x: nodeA.pos.x + t * dx, y: nodeA.pos.y + t * dy }
              } else {
                store.snappedCursor = rawWorld
              }
            } else if (seg.kind === 'curve' && seg.via) {
              const p0 = nodeA.pos
              const p1 = seg.via
              const p2 = nodeB.pos
              let bestT = 0.5
              let bestDistSq = Infinity
              for (let i = 1; i < 32; i++) {
                const s = i / 32
                const pt = bezierPoint(s, p0, p1, p2)
                const dSq = (pt.x - rawWorld.x) ** 2 + (pt.y - rawWorld.y) ** 2
                if (dSq < bestDistSq) {
                  bestDistSq = dSq
                  bestT = s
                }
              }
              store.snappedCursor = bezierPoint(bestT, p0, p1, p2)
            } else {
              store.snappedCursor = rawWorld
            }
          } else {
            store.snappedCursor = rawWorld
          }
        } else if (store.snap) {
          const spacing = getSnapSpacing()
          store.snappedCursor = snapToGrid(rawWorld, spacing)
        } else {
          store.snappedCursor = rawWorld
        }
      }

      if (!store.panning) {
        if (store.tool === 'place' || store.tool === 'curve') {
          draw()
        }
        if (store.isBoxSelecting) {
          store.boxSelectEnd = rawWorld
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
      // Finalize node dragging
      if (store.isDraggingNode) {
        store.isDraggingNode = false
        store.dragStartWorld = null
        store.draggedNodeInitialPositions.clear()
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId)
        }
        reconcileNetworkIntersections(store.network)
        store.markDirty()
        redraw()
        return
      }
      // Finalize box selection
      if (store.isBoxSelecting && store.boxSelectStart && store.boxSelectEnd) {
        const x1 = Math.min(store.boxSelectStart.x, store.boxSelectEnd.x)
        const y1 = Math.min(store.boxSelectStart.y, store.boxSelectEnd.y)
        const x2 = Math.max(store.boxSelectStart.x, store.boxSelectEnd.x)
        const y2 = Math.max(store.boxSelectStart.y, store.boxSelectEnd.y)

        // Select nodes inside the box
        const nodes = new Set(e.shiftKey ? store.selection.nodes : [])
        for (const node of store.network.nodes.values()) {
          if (node.pos.x >= x1 && node.pos.x <= x2 && node.pos.y >= y1 && node.pos.y <= y2) {
            nodes.add(node.id)
          }
        }

        // Select segments that have at least one endpoint inside the box
        const segments = new Set(e.shiftKey ? store.selection.segments : [])
        for (const seg of store.network.segments.values()) {
          const a = store.network.nodes.get(seg.from)
          const b = store.network.nodes.get(seg.to)
          if (!a || !b) continue
          // Segment is selected if both endpoints are inside the box
          const aIn = a.pos.x >= x1 && a.pos.x <= x2 && a.pos.y >= y1 && a.pos.y <= y2
          const bIn = b.pos.x >= x1 && b.pos.x <= x2 && b.pos.y >= y1 && b.pos.y <= y2
          if (aIn && bIn) {
            segments.add(seg.id)
          }
        }

        store.selection = { nodes, segments }
        store.isBoxSelecting = false
        store.boxSelectStart = null
        store.boxSelectEnd = null
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId)
        }
        redraw()
        return
      }

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
