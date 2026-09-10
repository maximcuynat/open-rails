import { useCallback, useEffect, useRef, useState } from 'react'
import { createCamera, clampScale, screenToWorld, type Camera } from '../render/camera'
import { renderGrid, renderNetwork, renderScaleBar } from '../render/renderer'
import {
  addNode,
  addSegment,
  createNetwork,
  hitNode,
  hitSegment,
  removeNode,
  removeSegment,
  snapToGrid,
} from '../core/network'
import type { Network, Selection } from '../core/types'
import { pickSpacing } from '../render/renderer'

type Tool = 'select' | 'place'

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
        // Right click: end placement chain or context menu
        lastNodeIdRef.current = null
        return
      }

      if (e.button === 1 || (e.button === 0 && (e.shiftKey || toolRef.current === 'select'))) {
        // Middle click or shift+click or select tool: pan
        panningRef.current = true
        lastX = e.clientX
        lastY = e.clientY
        movedRef.current = false
        canvas.setPointerCapture(e.pointerId)
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
      if (!panningRef.current) return
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
