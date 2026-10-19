import { useEffect, useRef } from 'react'
import { segmentEnds, shapePolyline } from '@domain/geometry/segmentGeometry'
import type { EditorStore } from '@application/state/editorStore'
import { networkCheckToken } from '@domain/models/networkWatch'
import { lineCategory } from '@domain/dataset/datasetIndex'
import { LINE_CATEGORY_COLORS } from '@infrastructure/render/datasetOverview'

const MINI_W = 160
const MINI_H = 120

interface MiniMapProps {
  store: EditorStore
  viewportW?: number
  viewportH?: number
}

export function MiniMap({ store, viewportW = 800, viewportH = 600 }: MiniMapProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  /** Where the map last drawn puts the world: its centre and its scale (px per metre) */
  const mapFrame = useRef<{ cx: number; cy: number; scale: number } | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = MINI_W * dpr
    canvas.height = MINI_H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // The network itself — background, rails, nodes — is drawn once on a canvas of its own and
    // copied from there at each frame: only the frame of the view is drawn again when the camera
    // moves. It is drawn anew when the network changes (its revision, see `networkWatch`) or the
    // colours of the theme do.
    const map = document.createElement('canvas')
    map.width = canvas.width
    map.height = canvas.height
    const mapCtx = map.getContext('2d')!
    mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    let drawn: { net: unknown; token: number | undefined; lines: number; ink: string; paper: string; cx: number; cy: number; scale: number } | null = null

    const drawMap = (ink: string, paper: string) => {
      const net = store.network
      const cam = store.camera

      // Compute network bounds
      let minX = 0, minY = 0, maxX = 0, maxY = 0
      let hasNodes = false
      for (const n of net.nodes.values()) {
        if (!hasNodes) {
          minX = maxX = n.pos.x
          minY = maxY = n.pos.y
          hasNodes = true
        } else {
          minX = Math.min(minX, n.pos.x)
          minY = Math.min(minY, n.pos.y)
          maxX = Math.max(maxX, n.pos.x)
          maxY = Math.max(maxY, n.pos.y)
        }
      }

      // A project of the dataset: the whole of its lines is the map, those not loaded as outlines
      const index = store.dataset ? store.datasetIndex : null
      const loaded = new Set(store.dataset?.lines ?? [])
      for (const line of index?.lines ?? []) {
        if (!hasNodes) {
          ;({ minX, minY, maxX, maxY } = line.bbox)
          hasNodes = true
        } else {
          minX = Math.min(minX, line.bbox.minX)
          minY = Math.min(minY, line.bbox.minY)
          maxX = Math.max(maxX, line.bbox.maxX)
          maxY = Math.max(maxY, line.bbox.maxY)
        }
      }

      // Use network bounds or camera center
      const cx = hasNodes ? (minX + maxX) / 2 : cam.x
      const cy = hasNodes ? (minY + maxY) / 2 : cam.y
      const span = hasNodes
        ? Math.max(maxX - minX, maxY - minY, 1) * 1.2
        : 200

      const scale = Math.min(MINI_W, MINI_H) / span
      const w2mX = (wx: number) => (wx - cx) * scale + MINI_W / 2
      const w2mY = (wy: number) => (wy - cy) * scale + MINI_H / 2

      // Background
      mapCtx.globalAlpha = 1
      mapCtx.fillStyle = paper
      mapCtx.fillRect(0, 0, MINI_W, MINI_H)

      // Lines not loaded
      mapCtx.lineWidth = 1
      mapCtx.globalAlpha = 0.9
      for (const line of index?.lines ?? []) {
        if (loaded.has(line.id) || !line.outline) continue
        mapCtx.strokeStyle = LINE_CATEGORY_COLORS[lineCategory(line)]
        mapCtx.beginPath()
        for (const stroke of line.outline) {
          mapCtx.moveTo(w2mX(stroke[0]), w2mY(stroke[1]))
          for (let i = 2; i < stroke.length; i += 2) mapCtx.lineTo(w2mX(stroke[i]), w2mY(stroke[i + 1]))
        }
        mapCtx.stroke()
      }

      // Segments
      mapCtx.strokeStyle = ink
      mapCtx.lineWidth = 1
      mapCtx.globalAlpha = 0.7
      for (const seg of net.segments.values()) {
        const ends = segmentEnds(net, seg)
        if (!ends) continue
        // Discretize lightly
        const pts = shapePolyline(ends, 8)
        mapCtx.beginPath()
        mapCtx.moveTo(w2mX(ends.a.x), w2mY(ends.a.y))
        for (let i = 1; i < pts.length; i++) mapCtx.lineTo(w2mX(pts[i].x), w2mY(pts[i].y))
        mapCtx.stroke()
      }

      // Nodes: on the map of a country they would only thicken the lines
      mapCtx.globalAlpha = 1
      mapCtx.fillStyle = ink
      if (!index) {
        for (const n of net.nodes.values()) {
          mapCtx.fillRect(w2mX(n.pos.x) - 1, w2mY(n.pos.y) - 1, 2, 2)
        }
      }

      // An empty network is centred on the camera: its map follows the view, and is not kept
      drawn = { net, token: hasNodes ? networkCheckToken(net) : undefined, lines: loaded.size, ink, paper, cx, cy, scale }
      mapFrame.current = { cx, cy, scale }
    }

    const draw = () => {
      const cam = store.camera
      const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#1a1a1a'
      const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#fff'
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2563eb'

      const token = networkCheckToken(store.network)
      const lines = store.dataset?.lines.length ?? 0
      if (!drawn || drawn.net !== store.network || drawn.token === undefined || drawn.token !== token || drawn.lines !== lines || drawn.ink !== ink || drawn.paper !== paper) {
        drawMap(ink, paper)
      }
      const { cx, cy, scale } = drawn!
      const w2mX = (wx: number) => (wx - cx) * scale + MINI_W / 2
      const w2mY = (wy: number) => (wy - cy) * scale + MINI_H / 2

      // The map, pixel for pixel
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(map, 0, 0, MINI_W, MINI_H)

      // Viewport rectangle
      const vpWorldW = viewportW / cam.scale
      const vpWorldH = viewportH / cam.scale
      ctx.strokeStyle = accent
      ctx.lineWidth = 1.5
      ctx.strokeRect(
        w2mX(cam.x - vpWorldW / 2),
        w2mY(cam.y - vpWorldH / 2),
        vpWorldW * scale,
        vpWorldH * scale,
      )
    }

    draw()
    // The store notifies several times between two frames (a wheel turn, a pointer move, a tick of
    // the simulation): the map is drawn once for all of them, with the frame
    let frame = 0
    const schedule = () => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        draw()
      })
    }
    const unsub = store.subscribe(schedule)
    return () => {
      unsub()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [store, viewportW, viewportH])

  // Click/drag to navigate: through the frame of the map as drawn (a project of the dataset maps its whole index, not only what is loaded)
  const navigate = (e: React.MouseEvent) => {
    const canvas = ref.current
    const frame = mapFrame.current
    if (!canvas || !frame) return
    const rect = canvas.getBoundingClientRect()
    const cam = store.camera
    cam.x = frame.cx + (e.clientX - rect.left - MINI_W / 2) / frame.scale
    cam.y = frame.cy + (e.clientY - rect.top - MINI_H / 2) / frame.scale
    // Only the camera moved: no panel has anything new to show
    store.notifyView()
  }

  return (
    <div className="minimap">
      <canvas
        ref={ref}
        style={{ width: MINI_W, height: MINI_H }}
        onMouseDown={navigate}
      />
    </div>
  )
}
