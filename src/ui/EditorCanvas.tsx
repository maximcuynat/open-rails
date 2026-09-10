import { useCallback, useEffect, useRef, useState } from 'react'
import { createCamera, clampScale, screenToWorld, type Camera } from '../render/camera'
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
  createNetwork,
  hitNode,
  hitSegment,
  removeNode,
  removeSegment,
  snapToGrid,
} from '../core/network'
import type { Network, Point, Selection } from '../core/types'
import { curveLength, minCurveRadius } from '../core/curve'
import { CURVE_PROFILES, arcToVia } from '../core/profiles'

type Tool = 'select' | 'place' | 'curve'

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

/** Render a straight rail preview from a start node to the cursor. */
function renderPlacePreview(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  start: Point,
  cursor: Point,
): void {
  const accent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
  const ink = getComputedStyle(ctx.canvas).getPropertyValue('--ink').trim() || '#1a1a1a'
  const sleeperColor = getComputedStyle(ctx.canvas).getPropertyValue('--sleeper').trim() || '#8a7a6a'
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

  // Rail preview
  if (cam.scale < SIMPLIFY_THRESHOLD) {
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.setLineDash([8, 4])
    ctx.beginPath()
    ctx.moveTo(w2sX(start.x), w2sY(start.y))
    ctx.lineTo(w2sX(cursor.x), w2sY(cursor.y))
    ctx.stroke()
    ctx.setLineDash([])
  } else {
    // Render detailed rail but semi-transparent
    ctx.globalAlpha = 0.7
    renderDetailedRail(ctx, cam, start, cursor, vw, vh, false, ink, accent, sleeperColor)
    ctx.globalAlpha = 1
  }

  // Length label near cursor
  const len = Math.hypot(cursor.x - start.x, cursor.y - start.y)
  const labelText = `L: ${len.toFixed(1)}m`
  ctx.font = '600 11px Archivo, system-ui, sans-serif'
  const labelW = ctx.measureText(labelText).width
  const lx = w2sX(cursor.x) + 14
  const ly = w2sY(cursor.y) - 10

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
  cursor: Point
  radius: number
  side: 1 | -1
}

/** Compute the via point and determine if the curve is valid. */
function computeCurveVia(data: CurvePreviewData): { via: Point; valid: boolean } {
  const via = arcToVia(data.start, data.cursor, data.radius, data.side)
  const rMin = minCurveRadius(data.start, via, data.cursor)
  return { via, valid: data.radius === Infinity || rMin >= data.radius * 0.9 }
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

  const { via, valid } = computeCurveVia(data)
  const len = curveLength(data.start, via, data.cursor)
  const profileLabel = data.radius === Infinity ? 'Straight' : `R${data.radius}`

  if (data.radius === Infinity) {
    // Straight rail preview
    if (cam.scale < SIMPLIFY_THRESHOLD) {
      ctx.strokeStyle = accent
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(w2sX(data.start.x), w2sY(data.start.y))
      ctx.lineTo(w2sX(data.cursor.x), w2sY(data.cursor.y))
      ctx.stroke()
    } else {
      renderDetailedRail(ctx, cam, data.start, data.cursor, vw, vh, false, ink, accent, sleeperColor)
    }
  } else {
    // Curved rail preview
    if (cam.scale < SIMPLIFY_THRESHOLD) {
      ctx.strokeStyle = valid ? accent : '#e8590c'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(w2sX(data.start.x), w2sY(data.start.y))
      ctx.quadraticCurveTo(w2sX(via.x), w2sY(via.y), w2sX(data.cursor.x), w2sY(data.cursor.y))
      ctx.stroke()
    } else {
      renderDetailedCurve(ctx, cam, data.start, via, data.cursor, vw, vh, false, ink, accent, sleeperColor)
    }
  }

  // Measurements label near cursor
  const labelText = `${profileLabel}  L: ${len.toFixed(1)}m`
  ctx.font = '600 11px Archivo, system-ui, sans-serif'
  const labelW = ctx.measureText(labelText).width
  const lx = w2sX(data.cursor.x) + 14
  const ly = w2sY(data.cursor.y) - 10

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

export function EditorCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camRef = useRef<Camera>(createCamera())
  const netRef = useRef<Network>(createNetwork())
  const selRef = useRef<Selection>({ nodes: new Set(), segments: new Set() })
  const lastNodeIdRef = useRef<string | null>(null)
  const snapRef = useRef(true)
  const toolRef = useRef<Tool>('place')
  const panningRef = useRef(false)
  const movedRef = useRef(false)
  const cursorWorldRef = useRef<Point>({ x: 0, y: 0 })
  const snappedCursorRef = useRef<Point>({ x: 0, y: 0 })
  // Curve tool: 2-click placement with predefined profiles
  // phase 0 = idle, phase 1 = have start, previewing curve to cursor
  const curveStateRef = useRef<{ phase: 0 | 1; startId: string | null }>({
    phase: 0,
    startId: null,
  })
  const curveProfileIdxRef = useRef(0) // index into CURVE_PROFILES
  const curveSideRef = useRef<1 | -1>(1)

  const [hud, setHud] = useState('')
  const [tool, setTool] = useState<Tool>('place')
  const [snap, setSnap] = useState(true)
  const [, forceRender] = useState(0)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cam = camRef.current
    const rect = canvas.getBoundingClientRect()
    renderGrid(ctx, cam, rect.width, rect.height)
    renderNetwork(ctx, cam, rect.width, rect.height, netRef.current, selRef.current)

    // Snap indicator (Place and Curve tools, when snap is on)
    if (snapRef.current && (toolRef.current === 'place' || toolRef.current === 'curve')) {
      renderSnapIndicator(ctx, cam, rect.width, rect.height, snappedCursorRef.current)
    }

    // Place tool preview: rail from last node to snapped cursor
    if (toolRef.current === 'place' && lastNodeIdRef.current) {
      const startNode = netRef.current.nodes.get(lastNodeIdRef.current)
      if (startNode) {
        renderPlacePreview(ctx, cam, rect.width, rect.height, startNode.pos, snappedCursorRef.current)
      }
    }

    // Curve preview
    const cs = curveStateRef.current
    if (cs.phase === 1 && cs.startId) {
      const startNode = netRef.current.nodes.get(cs.startId)
      if (startNode) {
        const profile = CURVE_PROFILES[curveProfileIdxRef.current]
        renderCurvePreview(ctx, cam, rect.width, rect.height, {
          start: startNode.pos,
          cursor: snappedCursorRef.current,
          radius: profile.radius,
          side: curveSideRef.current,
        })
      }
    }

    renderScaleBar(ctx, cam, rect.width, rect.height)
    setHud(`${cam.scale.toFixed(2)}x  (${cam.x.toFixed(0)}, ${cam.y.toFixed(0)})`)
  }, [])

  const getWorldPos = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current!
    const cam = camRef.current
    const rect = canvas.getBoundingClientRect()
    return screenToWorld(cam, clientX - rect.left, clientY - rect.top, rect.width, rect.height)
  }, [])

  const getSnapSpacing = useCallback(() => {
    return snapRef.current ? pickSpacing(camRef.current.scale) : 0
  }, [])

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
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [draw])

  // Redraw trigger
  const redraw = useCallback(() => {
    draw()
    forceRender((n) => n + 1)
  }, [draw])

  // Pan + zoom + placement
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let lastX = 0
    let lastY = 0

    const onDown = (e: PointerEvent) => {
      if (e.button === 2) {
        // Right click: cancel placement chain or curve
        lastNodeIdRef.current = null
        if (toolRef.current === 'curve' && curveStateRef.current.phase === 1) {
          curveStateRef.current = { phase: 0, startId: null }
          redraw()
        }
        return
      }

      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        // Middle click or shift+click: pan
        panningRef.current = true
        lastX = e.clientX
        lastY = e.clientY
        movedRef.current = false
        canvas.setPointerCapture(e.pointerId)
        return
      }

      if (e.button === 0 && toolRef.current === 'curve') {
        const world = getWorldPos(e.clientX, e.clientY)
        const spacing = getSnapSpacing()
        const snapped = snapToGrid(world, spacing)
        const hitTol = 1.5 / camRef.current.scale
        const cs = curveStateRef.current

        if (cs.phase === 0) {
          // Click 1: place/select start node
          const existing = hitNode(netRef.current, snapped, hitTol)
          const startId = existing ?? addNode(netRef.current, snapped).id
          curveStateRef.current = { phase: 1, startId }
          selRef.current = { nodes: new Set([startId]), segments: new Set() }
          redraw()
        } else if (cs.phase === 1) {
          // Click 2: place/select end node, create curve/straight segment
          const existing = hitNode(netRef.current, snapped, hitTol)
          const endId = existing ?? addNode(netRef.current, snapped).id
          if (cs.startId && cs.startId !== endId) {
            const startNode = netRef.current.nodes.get(cs.startId)
            if (startNode) {
              const radius = CURVE_PROFILES[curveProfileIdxRef.current].radius
              if (radius === Infinity) {
                addSegment(netRef.current, cs.startId, endId)
              } else {
                const via = arcToVia(startNode.pos, snapped, radius, curveSideRef.current)
                addCurveSegment(netRef.current, cs.startId, endId, via)
              }
            }
          }
          // Chain: keep the end node as the new start for the next segment
          curveStateRef.current = { phase: 1, startId: endId }
          selRef.current = { nodes: new Set([endId]), segments: new Set() }
          redraw()
        }
        return
      }

      if (e.button === 0 && toolRef.current === 'place') {
        // Place a node
        const world = getWorldPos(e.clientX, e.clientY)
        const spacing = getSnapSpacing()
        const snapped = snapToGrid(world, spacing)

        // Check if clicking on an existing node
        const hitTol = 1.5 / camRef.current.scale
        const existing = hitNode(netRef.current, snapped, hitTol)

        if (existing) {
          if (lastNodeIdRef.current && lastNodeIdRef.current !== existing) {
            addSegment(netRef.current, lastNodeIdRef.current, existing)
          }
          lastNodeIdRef.current = existing
          // Select it
          selRef.current = { nodes: new Set([existing]), segments: new Set() }
        } else {
          const node = addNode(netRef.current, snapped)
          if (lastNodeIdRef.current) {
            addSegment(netRef.current, lastNodeIdRef.current, node.id)
          }
          lastNodeIdRef.current = node.id
          selRef.current = { nodes: new Set([node.id]), segments: new Set() }
        }
        redraw()
        return
      }

      if (e.button === 0 && toolRef.current === 'select') {
        // Select: try hit node, then segment
        const world = getWorldPos(e.clientX, e.clientY)
        const hitTol = 1.5 / camRef.current.scale
        const nodeId = hitNode(netRef.current, world, hitTol)
        if (nodeId) {
          selRef.current = { nodes: new Set([nodeId]), segments: new Set() }
          redraw()
          return
        }
        const segId = hitSegment(netRef.current, world, hitTol)
        if (segId) {
          selRef.current = { nodes: new Set(), segments: new Set([segId]) }
          redraw()
          return
        }
        // Empty click: start panning
        panningRef.current = true
        lastX = e.clientX
        lastY = e.clientY
        movedRef.current = false
        canvas.setPointerCapture(e.pointerId)
        selRef.current = { nodes: new Set(), segments: new Set() }
        redraw()
      }
    }

    const onMove = (e: PointerEvent) => {
      // Track cursor for previews
      const world = getWorldPos(e.clientX, e.clientY)
      cursorWorldRef.current = world
      const spacing = snapRef.current ? getSnapSpacing() : 0
      snappedCursorRef.current = snapToGrid(world, spacing)

      if (!panningRef.current) {
        // Redraw for preview if in place or curve mode
        if (toolRef.current === 'place' && lastNodeIdRef.current) {
          draw()
        } else if (toolRef.current === 'curve' && curveStateRef.current.phase > 0) {
          draw()
        }
        return
      }

      const cam = camRef.current
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) movedRef.current = true
      lastX = e.clientX
      lastY = e.clientY
      cam.x -= dx / cam.scale
      cam.y -= dy / cam.scale
      draw()
    }

    const onUp = (e: PointerEvent) => {
      panningRef.current = false
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId)
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cam = camRef.current
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
  }, [draw, redraw, getWorldPos, getSnapSpacing])

  // Keyboard: delete, escape, tool switch, snap toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = selRef.current
        for (const sid of sel.segments) removeSegment(netRef.current, sid)
        for (const nid of sel.nodes) removeNode(netRef.current, nid)
        selRef.current = { nodes: new Set(), segments: new Set() }
        redraw()
      } else if (e.key === 'Escape') {
        lastNodeIdRef.current = null
        selRef.current = { nodes: new Set(), segments: new Set() }
        redraw()
      } else if (e.key === 'v' || e.key === 'V') {
        setTool('select')
        toolRef.current = 'select'
      } else if (e.key === 'n' || e.key === 'N') {
        setTool('place')
        toolRef.current = 'place'
      } else if (e.key === 'c' || e.key === 'C') {
        setTool('curve')
        toolRef.current = 'curve'
        curveStateRef.current = { phase: 0, startId: null }
      } else if (e.key === '[') {
        // Previous curve profile
        curveProfileIdxRef.current = Math.max(0, curveProfileIdxRef.current - 1)
        redraw()
      } else if (e.key === ']') {
        // Next curve profile
        curveProfileIdxRef.current = Math.min(CURVE_PROFILES.length - 1, curveProfileIdxRef.current + 1)
        redraw()
      } else if (e.key === 'Tab') {
        // Flip curve side
        e.preventDefault()
        curveSideRef.current = curveSideRef.current === 1 ? -1 : 1
        redraw()
      } else if (e.key === 'g' || e.key === 'G') {
        snapRef.current = !snapRef.current
        setSnap(snapRef.current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [redraw])

  const switchTool = (t: Tool) => {
    setTool(t)
    toolRef.current = t
    if (t === 'select') lastNodeIdRef.current = null
    if (t !== 'curve') curveStateRef.current = { phase: 0, startId: null }
  }

  const currentProfileLabel = CURVE_PROFILES[curveProfileIdxRef.current]?.label ?? 'R150'

  return (
    <div className="canvas-wrap">
      <canvas ref={canvasRef} className={`tool-${tool}`} />
      <div className="toolbar">
        <button
          className={tool === 'place' ? 'active' : ''}
          onClick={() => switchTool('place')}
          title="Place nodes (N)"
        >
          Place
        </button>
        <button
          className={tool === 'curve' ? 'active' : ''}
          onClick={() => switchTool('curve')}
          title="Curve tool (C) — [ ] to cycle profiles, Tab to flip side"
        >
          Curve
        </button>
        {tool === 'curve' && (
          <span className="profile-label" title="Current profile ([ / ] to cycle, Tab to flip)">
            {currentProfileLabel}
            {CURVE_PROFILES[curveProfileIdxRef.current]?.radius !== Infinity && (
              <span className="side-indicator">{curveSideRef.current === 1 ? '↗' : '↘'}</span>
            )}
          </span>
        )}
        <button
          className={tool === 'select' ? 'active' : ''}
          onClick={() => switchTool('select')}
          title="Select (V)"
        >
          Select
        </button>
        <button
          className={snap ? 'active' : ''}
          onClick={() => {
            snapRef.current = !snapRef.current
            setSnap(snapRef.current)
          }}
          title="Toggle grid snap (G)"
        >
          Snap
        </button>
      </div>
      {hud && <div className="hud">{hud}</div>}
    </div>
  )
}
