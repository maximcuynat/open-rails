import { useCallback, useEffect, useRef, useState } from 'react'
import { createCamera, clampScale, type Camera } from '../render/camera'
import { renderGrid } from '../render/renderer'

export function EditorCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camRef = useRef<Camera>(createCamera())
  const [hud, setHud] = useState('')

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cam = camRef.current
    const rect = canvas.getBoundingClientRect()
    renderGrid(ctx, cam, rect.width, rect.height)
    setHud(`${cam.scale.toFixed(2)}x  (${cam.x.toFixed(0)}, ${cam.y.toFixed(0)})`)
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

  // Redraw when camera moves
  useEffect(() => {
    draw()
  }, [draw])

  // Pan + zoom
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let panning = false
    let lastX = 0
    let lastY = 0

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      panning = true
      lastX = e.clientX
      lastY = e.clientY
      canvas.setPointerCapture(e.pointerId)
    }

    const onMove = (e: PointerEvent) => {
      if (!panning) return
      const cam = camRef.current
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      cam.x -= dx / cam.scale
      cam.y -= dy / cam.scale
      draw()
    }

    const onUp = (e: PointerEvent) => {
      panning = false
      canvas.releasePointerCapture(e.pointerId)
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cam = camRef.current
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const vw = rect.width
      const vh = rect.height

      // World point under cursor before zoom
      const worldX = cam.x + (px - vw / 2) / cam.scale
      const worldY = cam.y + (py - vh / 2) / cam.scale

      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      cam.scale = clampScale(cam.scale * factor)

      // Keep cursor-anchored world point stationary
      cam.x = worldX - (px - vw / 2) / cam.scale
      cam.y = worldY - (py - vh / 2) / cam.scale
      draw()
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [draw])

  return (
    <div className="canvas-wrap">
      <canvas ref={canvasRef} />
      {hud && <div className="hud">{hud}</div>}
    </div>
  )
}
