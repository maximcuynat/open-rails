import { useEffect, useRef } from 'react'
import { bezierPoint } from '@domain/geometry/curve'
import type { EditorStore } from '@application/state/editorStore'
import { networkCheckToken } from '@domain/models/networkWatch'

const MINI_W = 160
const MINI_H = 120

interface MiniMapProps {
  store: EditorStore
  viewportW?: number
  viewportH?: number
}

export function MiniMap({ store, viewportW = 800, viewportH = 600 }: MiniMapProps) {
  const ref = useRef<HTMLCanvasElement>(null)

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
    let drawn: { net: unknown; token: number | undefined; ink: string; paper: string; cx: number; cy: number; scale: number } | null = null

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

      // Segments
      mapCtx.strokeStyle = ink
      mapCtx.lineWidth = 1
      mapCtx.globalAlpha = 0.7
      for (const seg of net.segments.values()) {
        const a = net.nodes.get(seg.from)
        const b = net.nodes.get(seg.to)
        if (!a || !b) continue
        mapCtx.beginPath()
        mapCtx.moveTo(w2mX(a.pos.x), w2mY(a.pos.y))
        if (seg.kind === 'curve' && seg.via) {
          // Discretize lightly
          for (let i = 1; i <= 8; i++) {
            const t = i / 8
            const pt = bezierPoint(t, a.pos, seg.via, b.pos)
            mapCtx.lineTo(w2mX(pt.x), w2mY(pt.y))
          }
        } else {
          mapCtx.lineTo(w2mX(b.pos.x), w2mY(b.pos.y))
        }
        mapCtx.stroke()
      }

      // Nodes
      mapCtx.globalAlpha = 1
      mapCtx.fillStyle = ink
      for (const n of net.nodes.values()) {
        mapCtx.fillRect(w2mX(n.pos.x) - 1, w2mY(n.pos.y) - 1, 2, 2)
      }

      // An empty network is centred on the camera: its map follows the view, and is not kept
      drawn = { net, token: hasNodes ? networkCheckToken(net) : undefined, ink, paper, cx, cy, scale }
    }

    const draw = () => {
      const cam = store.camera
      const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#1a1a1a'
      const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#fff'
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2563eb'

      const token = networkCheckToken(store.network)
      if (!drawn || drawn.net !== store.network || drawn.token === undefined || drawn.token !== token || drawn.ink !== ink || drawn.paper !== paper) {
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

  // Click/drag to navigate
  const navigate = (e: React.MouseEvent) => {
    const canvas = ref.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const net = store.network
    const cam = store.camera

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
    const cx = hasNodes ? (minX + maxX) / 2 : cam.x
    const cy = hasNodes ? (minY + maxY) / 2 : cam.y
    const span = hasNodes ? Math.max(maxX - minX, maxY - minY, 1) * 1.2 : 200
    const scale = Math.min(MINI_W, MINI_H) / span

    cam.x = cx + (mx - MINI_W / 2) / scale
    cam.y = cy + (my - MINI_H / 2) / scale
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
