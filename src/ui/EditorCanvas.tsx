import { useCallback, useEffect, useRef, useState } from 'react'
import { createCamera, clampScale, screenToWorld, type Camera } from '../render/camera'
import { renderGrid, renderNetwork, renderScaleBar } from '../render/renderer'
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
import { pickSpacing } from '../render/renderer'

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
  const w2sX = (wx: number) => (wx - cam.x) * cam.scale + vw / 2
  const w2sY = (wy: number) => (wy - cam.y) * cam.scale + vh / 2

  ctx.save()
  ctx.strokeStyle = accent
  ctx.lineWidth = 2
  ctx.setLineDash([6, 4])

  if (data.phase === 1 && data.start) {
    // Preview: straight from start to cursor (will become curve once via is set)
    ctx.beginPath()
    ctx.moveTo(w2sX(data.start.x), w2sY(data.start.y))
    ctx.lineTo(w2sX(data.cursor.x), w2sY(data.cursor.y))
    ctx.stroke()
  } else if (data.phase === 2 && data.start && data.via) {
    // Preview: quadratic Bezier from start via control to cursor
    ctx.beginPath()
    ctx.moveTo(w2sX(data.start.x), w2sY(data.start.y))
    ctx.quadraticCurveTo(w2sX(data.via.x), w2sY(data.via.y), w2sX(data.cursor.x), w2sY(data.cursor.y))
    ctx.stroke()

    // Draw via control point marker
    ctx.setLineDash([])
    ctx.fillStyle = accent
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    ctx.arc(w2sX(data.via.x), w2sY(data.via.y), 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1

    // Line from start to via (construction line)
    ctx.setLineDash([3, 3])
    ctx.globalAlpha = 0.3
    ctx.beginPath()
    ctx.moveTo(w2sX(data.start.x), w2sY(data.start.y))
    ctx.lineTo(w2sX(data.via.x), w2sY(data.via.y))
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // Draw start marker
  if (data.start && data.phase >= 1) {
    ctx.setLineDash([])
    ctx.fillStyle = accent
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    ctx.arc(w2sX(data.start.x), w2sY(data.start.y), 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
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
          // Phase 2: place/select end node, create curve segment
          const existing = hitNode(netRef.current, snapped, hitTol)
          const endId = existing ?? addNode(netRef.current, snapped).id
          if (cs.startId && cs.via && cs.startId !== endId) {
            addCurveSegment(netRef.current, cs.startId, endId, cs.via)
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
