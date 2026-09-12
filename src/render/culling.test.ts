import { describe, expect, it, vi } from 'vitest'
import { createCamera } from './camera'
import { createNetwork, addNode, addSegment } from '../core/network'
import {
  getViewportBounds,
  isPointInBounds,
  isSegmentInBounds,
  renderNetwork,
} from './renderer'

describe('Viewport culling (optimisation hors-champ)', () => {
  it('computes correct world viewport bounds from camera', () => {
    // Camera centered at (100, 200), scale = 2, canvas 800x600
    // Half-width in world: 400 / 2 = 200 mm
    // Half-height in world: 300 / 2 = 150 mm
    const cam = createCamera(100, 200, 2)
    const bounds = getViewportBounds(cam, 800, 600, 40)

    // marginWorld = max(40 / 2, 60) = 60
    expect(bounds.minX).toBeCloseTo(100 - 200 - 60)
    expect(bounds.maxX).toBeCloseTo(100 + 200 + 60)
    expect(bounds.minY).toBeCloseTo(200 - 150 - 60)
    expect(bounds.maxY).toBeCloseTo(200 + 150 + 60)
  })

  it('correctly classifies points as inside or outside bounds', () => {
    const bounds = { minX: -100, maxX: 100, minY: -50, maxY: 50 }

    expect(isPointInBounds({ x: 0, y: 0 }, bounds)).toBe(true)
    expect(isPointInBounds({ x: 99, y: 49 }, bounds)).toBe(true)
    expect(isPointInBounds({ x: 150, y: 0 }, bounds)).toBe(false)
    expect(isPointInBounds({ x: 0, y: -100 }, bounds)).toBe(false)
  })

  it('correctly culls straight and curved segments outside bounds', () => {
    const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 }

    // Completely inside
    expect(isSegmentInBounds({ x: 10, y: 10 }, { x: 50, y: 50 }, undefined, bounds)).toBe(true)

    // Crossing boundary
    expect(isSegmentInBounds({ x: -20, y: 50 }, { x: 50, y: 50 }, undefined, bounds)).toBe(true)

    // Completely outside to the right
    expect(isSegmentInBounds({ x: 150, y: 10 }, { x: 200, y: 50 }, undefined, bounds)).toBe(false)

    // Completely outside below
    expect(isSegmentInBounds({ x: 10, y: 150 }, { x: 50, y: 200 }, undefined, bounds)).toBe(false)

    // Curve bowing into the bounds
    expect(
      isSegmentInBounds({ x: -20, y: 50 }, { x: -20, y: 80 }, { x: 20, y: 65 }, bounds),
    ).toBe(true)

    // Curve completely far away
    expect(
      isSegmentInBounds({ x: 500, y: 500 }, { x: 600, y: 600 }, { x: 550, y: 550 }, bounds),
    ).toBe(false)
  })

  it('preserves complete network logic and data when rendering culled canvas', () => {
    const net = createNetwork()

    // Place 50 segments in a long line (total length = 50 * 246 = 12,300 mm)
    let lastId = addNode(net, { x: 0, y: 0 }).id
    for (let i = 1; i <= 50; i++) {
      const nextId = addNode(net, { x: i * 246, y: 0 }).id
      addSegment(net, lastId, nextId)
      lastId = nextId
    }

    expect(net.nodes.size).toBe(51)
    expect(net.segments.size).toBe(50)

    // Mock canvas context
    const mockCtx = {
      canvas: {
        width: 800,
        height: 600,
      },
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      setLineDash: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      closePath: vi.fn(),
      quadraticCurveTo: vi.fn(),
    } as unknown as CanvasRenderingContext2D

    // Camera focused only around the origin (x: 0, y: 0, scale: 3)
    // Viewport width = 800 / 3 ≈ 266 mm -> only the first 1-2 segments are visible!
    const cam = createCamera(0, 0, 3)
    const selection = { nodes: new Set<string>(), segments: new Set<string>() }

    const initialNodeIds = new Set(net.nodes.keys())
    expect(initialNodeIds.size).toBe(51)

    // Execute render
    renderNetwork(mockCtx, cam, 800, 600, net, selection)

    // CRUCIAL: Verify that the network data remains 100% intact and complete in storage
    expect(net.nodes.size).toBe(51)
    expect(net.segments.size).toBe(50)
    for (const id of initialNodeIds) {
      expect(net.nodes.has(id)).toBe(true)
    }

    // Now pan camera far away to segment #45 (x: 45 * 246 = 11070)
    cam.x = 45 * 246
    renderNetwork(mockCtx, cam, 800, 600, net, selection)

    // The data is still completely stored and unchanged
    expect(net.nodes.size).toBe(51)
    expect(net.segments.size).toBe(50)
  })
})
