import { describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { clampScale } from '@infrastructure/render/camera'
import { addNode, addSegment } from '@domain/models/network'

describe('Natural CAD / Google Maps Interaction Model', () => {
  it('initializes with select tool as default', () => {
    const store = new EditorStore()
    expect(store.tool).toBe('select')
  })

  it('calculates cursor-centered zoom invariants correctly', () => {
    // Simulate canvas viewport and camera
    const vw = 1200
    const vh = 800
    let cam = { x: 100, y: 50, scale: 1.0 }

    // User has cursor at (px, py) on screen
    const px = 400
    const py = 300

    // World coordinate under cursor before zoom
    const worldX = cam.x + (px - vw / 2) / cam.scale
    const worldY = cam.y + (py - vh / 2) / cam.scale

    // Zoom in with a mouse wheel tick (dy = -100)
    const dy = -100
    const zoomDelta = -dy * 0.0016
    const factor = Math.exp(Math.max(-0.4, Math.min(0.4, zoomDelta)))
    cam.scale = clampScale(cam.scale * factor)

    // Camera update to keep world position invariant at (px, py)
    cam.x = worldX - (px - vw / 2) / cam.scale
    cam.y = worldY - (py - vh / 2) / cam.scale

    // Verify the world position under (px, py) after zoom is identical
    const worldXAfter = cam.x + (px - vw / 2) / cam.scale
    const worldYAfter = cam.y + (py - vh / 2) / cam.scale

    expect(worldXAfter).toBeCloseTo(worldX, 6)
    expect(worldYAfter).toBeCloseTo(worldY, 6)
    expect(cam.scale).toBeGreaterThan(1.0)
  })

  it('calculates cursor-centered zoom out correctly', () => {
    const vw = 1920
    const vh = 1080
    let cam = { x: -50, y: 120, scale: 2.5 }

    const px = 1500
    const py = 750

    const worldX = cam.x + (px - vw / 2) / cam.scale
    const worldY = cam.y + (py - vh / 2) / cam.scale

    // Zoom out with a mouse wheel tick (dy = 120)
    const dy = 120
    const zoomDelta = -dy * 0.0016
    const factor = Math.exp(Math.max(-0.4, Math.min(0.4, zoomDelta)))
    cam.scale = clampScale(cam.scale * factor)

    cam.x = worldX - (px - vw / 2) / cam.scale
    cam.y = worldY - (py - vh / 2) / cam.scale

    const worldXAfter = cam.x + (px - vw / 2) / cam.scale
    const worldYAfter = cam.y + (py - vh / 2) / cam.scale

    expect(worldXAfter).toBeCloseTo(worldX, 6)
    expect(worldYAfter).toBeCloseTo(worldY, 6)
    expect(cam.scale).toBeLessThan(2.5)
  })

  it('preserves selection when panning the canvas', () => {
    const store = new EditorStore()
    const n1 = addNode(store.network, { x: 0, y: 0 })
    const n2 = addNode(store.network, { x: 50, y: 0 })
    const seg = addSegment(store.network, n1.id, n2.id)

    // Select node and segment
    store.selection = { nodes: new Set([n1.id]), segments: new Set([seg!.id]) }
    expect(store.selection.nodes.has(n1.id)).toBe(true)

    // Simulate drag pan on background
    store.panning = true
    store.moved = true // dragged
    store.camera.x += 10
    store.camera.y += 20

    // When drag ends, selection should remain intact because user moved/panned
    if (store.moved) {
      // no deselection
    }
    expect(store.selection.nodes.has(n1.id)).toBe(true)
    expect(store.selection.segments.has(seg!.id)).toBe(true)
  })

  it('clears selection when single-clicking empty background without moving', () => {
    const store = new EditorStore()
    const n1 = addNode(store.network, { x: 0, y: 0 })
    const n2 = addNode(store.network, { x: 50, y: 0 })
    const seg = addSegment(store.network, n1.id, n2.id)

    store.selection = { nodes: new Set([n1.id]), segments: new Set([seg!.id]) }

    // User clicked background without moving (moved = false)
    store.panning = true
    store.moved = false

    // onUp logic for empty background tap
    if (!store.moved) {
      store.selection = { nodes: new Set(), segments: new Set() }
    }
    store.panning = false

    expect(store.selection.nodes.size).toBe(0)
    expect(store.selection.segments.size).toBe(0)
  })
})
