import { useCallback, useEffect, useRef, useState } from 'react'
import { createCamera, clampScale, screenToWorld, type Camera } from '../render/camera'
import {
  renderGrid,
  renderNetwork,
  renderScaleBar,
  renderDetailedCurve,
  pickSpacing,
  SIMPLIFY_THRESHOLD,
  MIN_RADIUS,
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
import { clampVia, curveLength, minCurveRadius } from '../core/curve'

type Tool = 'select' | 'place' | 'curve'

interface CurvePreviewData {
  phase: 0 | 1 | 2
  start: Point | null
  via: Point | null
  cursor: Point
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
  const warning = '#e8590c'

  ctx.save()

  // Draw start node marker
  if (data.start && data.phase >= 1) {
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
  }

  if (data.phase === 1 && data.start) {
    // Phase 1: straight preview from start to cursor (snapped)
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(w2sX(data.start.x), w2sY(data.start.y))
    ctx.lineTo(w2sX(data.cursor.x), w2sY(data.cursor.y))
    ctx.stroke()
    ctx.setLineDash([])
  } else if (data.phase === 2 && data.start && data.via) {
    // Phase 2: full rail preview with constraints
    const viaClamped = clampVia(data.start, data.via, data.cursor, MIN_RADIUS)
    const rMin = minCurveRadius(data.start, viaClamped, data.cursor)
    const len = curveLength(data.start, viaClamped, data.cursor)
    const violates = rMin < MIN_RADIUS

    // Render the actual rail (detail or simplified depending on zoom)
    if (cam.scale < SIMPLIFY_THRESHOLD) {
      // Simplified: just a line, colored by violation
      ctx.strokeStyle = violates ? warning : accent
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(w2sX(data.start.x), w2sY(data.start.y))
      ctx.quadraticCurveTo(w2sX(viaClamped.x), w2sY(viaClamped.y), w2sX(data.cursor.x), w2sY(data.cursor.y))
      ctx.stroke()
    } else {
      // Detailed rail rendering with warning color if violating
      renderDetailedCurve(
        ctx, cam, data.start, viaClamped, data.cursor, vw, vh,
        false, // not selected
        violates ? warning : ink,
        accent,
        sleeperColor,
      )
    }

    // Draw via control point marker (actual via, not clamped)
    ctx.fillStyle = accent
    ctx.globalAlpha = 0.4
    ctx.beginPath()
    ctx.arc(w2sX(data.via.x), w2sY(data.via.y), 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1

    // Construction line from start to via (dashed)
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = accent
    ctx.globalAlpha = 0.3
    ctx.beginPath()
    ctx.moveTo(w2sX(data.start.x), w2sY(data.start.y))
    ctx.lineTo(w2sX(data.via.x), w2sY(data.via.y))
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.setLineDash([])

    // If via was clamped, show the clamped position too
    if (viaClamped.x !== data.via.x || viaClamped.y !== data.via.y) {
      ctx.fillStyle = warning
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.arc(w2sX(viaClamped.x), w2sY(viaClamped.y), 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    // Measurements label near cursor
    const labelText = `R${rMin === Infinity ? '∞' : ': ' + rMin.toFixed(0)}m  L: ${len.toFixed(1)}m`
    ctx.font = '600 11px Archivo, system-ui, sans-serif'
    const labelW = ctx.measureText(labelText).width
    const lx = w2sX(data.cursor.x) + 14
    const ly = w2sY(data.cursor.y) - 10

    ctx.fillStyle = violates ? 'rgba(232, 89, 12, 0.9)' : 'rgba(37, 99, 235, 0.85)'
    ctx.beginPath()
    ctx.roundRect(lx - 6, ly - 14, labelW + 12, 20, 4)
    ctx.fill()
    ctx.fillStyle = paper
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText(labelText, lx, ly - 4)
  }

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
  // Curve tool state: 0 = waiting for start, 1 = have start, placing via, 2 = have via, placing end
  const curveStateRef = useRef<{ phase: 0 | 1 | 2; startId: string | null; via: Point | null }>({
    phase: 0,
    startId: null,
    via: null,
  })

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

    // Curve preview
    const cs = curveStateRef.current
    const startNode = cs.startId ? netRef.current.nodes.get(cs.startId) : null
    if (cs.phase > 0) {
      renderCurvePreview(ctx, cam, rect.width, rect.height, {
        phase: cs.phase,
        start: startNode ? startNode.pos : null,
        via: cs.via,
        cursor: cursorWorldRef.current,
      })
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
        if (toolRef.current === 'curve') {
          curveStateRef.current = { phase: 0, startId: null, via: null }
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
          // Phase 0: place/select start node
          const existing = hitNode(netRef.current, snapped, hitTol)
          const startId = existing ?? addNode(netRef.current, snapped).id
          curveStateRef.current = { phase: 1, startId, via: null }
          selRef.current = { nodes: new Set([startId]), segments: new Set() }
          redraw()
        } else if (cs.phase === 1) {
          // Phase 1: set via control point
          curveStateRef.current = { phase: 2, startId: cs.startId, via: snapped }
          redraw()
        } else if (cs.phase === 2) {
          // Phase 2: place/select end node, create curve segment (with clamped via)
          const existing = hitNode(netRef.current, snapped, hitTol)
          const endId = existing ?? addNode(netRef.current, snapped).id
          if (cs.startId && cs.via && cs.startId !== endId) {
            const startNode = netRef.current.nodes.get(cs.startId)
            if (startNode) {
              const viaClamped = clampVia(startNode.pos, cs.via, snapped, MIN_RADIUS)
              addCurveSegment(netRef.current, cs.startId, endId, viaClamped)
            }
          }
          curveStateRef.current = { phase: 0, startId: null, via: null }
          selRef.current = { nodes: new Set(), segments: new Set() }
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
      // Track cursor for curve preview
      const world = getWorldPos(e.clientX, e.clientY)
      cursorWorldRef.current = world

      if (!panningRef.current) {
        // Redraw for curve preview if in curve mode
        if (toolRef.current === 'curve' && curveStateRef.current.phase > 0) {
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
        curveStateRef.current = { phase: 0, startId: null, via: null }
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
    if (t !== 'curve') curveStateRef.current = { phase: 0, startId: null, via: null }
  }

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
          title="Curve tool (C)"
        >
          Curve
        </button>
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
