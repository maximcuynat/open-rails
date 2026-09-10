import { useEffect, useRef } from 'react'
import { bezierPoint } from '../core/curve'
import type { EditorStore } from './store'

const MINI_W = 160
const MINI_H = 120

export function MiniMap({ store }: { store: EditorStore }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = MINI_W * dpr
    canvas.height = MINI_H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const draw = () => {
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

      const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#1a1a1a'
      const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#fff'
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2563eb'

      // Background
      ctx.fillStyle = paper
      ctx.fillRect(0, 0, MINI_W, MINI_H)

      // Segments
      ctx.strokeStyle = ink
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.7
      for (const seg of net.segments.values()) {
        const a = net.nodes.get(seg.from)
        const b = net.nodes.get(seg.to)
        if (!a || !b) continue
        ctx.beginPath()
        ctx.moveTo(w2mX(a.pos.x), w2mY(a.pos.y))
        if (seg.kind === 'curve' && seg.via) {
          // Discretize lightly
          for (let i = 1; i <= 8; i++) {
            const t = i / 8
            const pt = bezierPoint(t, a.pos, seg.via, b.pos)
            ctx.lineTo(w2mX(pt.x), w2mY(pt.y))
          }
        } else {
          ctx.lineTo(w2mX(b.pos.x), w2mY(b.pos.y))
        }
        ctx.stroke()
      }

      // Nodes
      ctx.globalAlpha = 1
      ctx.fillStyle = ink
      for (const n of net.nodes.values()) {
        ctx.fillRect(w2mX(n.pos.x) - 1, w2mY(n.pos.y) - 1, 2, 2)
      }

      // Viewport rectangle
      const rect = canvas.getBoundingClientRect()
      const vpWorldW = rect.width / cam.scale
      const vpWorldH = rect.height / cam.scale
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
    const unsub = store.subscribe(draw)
    return unsub
  }, [store])

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
    store.notify()
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
