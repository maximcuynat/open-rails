import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addCurveSegment, addNode, addSegment, createNetwork, resetIdCounter } from '@domain/models/network'
import { touchNetwork } from '@domain/models/networkWatch'
import { addPlatform, platformDimensions, platformOutline, PLATFORM_WIDTH } from '@domain/models/platforms'
import type { Network, Platform, StopMarker } from '@domain/models/types'
import { createCamera } from './camera'
import { LabelSpace } from './labelSpace'
import { renderNetwork } from './renderer'
import {
  PLATFORM_DETAIL_FROM_PX,
  PLATFORM_LABEL_FROM_PX,
  platformLook,
  platformShapes,
  platformsInView,
  platformsOfPass,
  renderPlatformBodies,
  renderStopMarkers,
} from './platformRender'

/** Colours of the light theme, as drawn without a stylesheet */
const BODY = '#d4d6d9'
const EDGE = '#8f96a0'
const LINE = '#eab308'
const ACCENT = '#2563eb'
const RAIL = '#526071'

interface Call {
  op: string
  args: unknown[]
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: unknown
}

/** A canvas double that records every call with the styles in force when it was made */
function recordingContext(): CanvasRenderingContext2D & { calls: Call[] } {
  const calls: Call[] = []
  const ctx: Record<string, unknown> = { canvas: { width: 800, height: 600 }, calls, fillStyle: '', strokeStyle: '', lineWidth: 1 }
  const ops = [
    'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'rect', 'roundRect',
    'fillRect', 'strokeRect', 'setLineDash', 'translate', 'rotate', 'quadraticCurveTo', 'fillText',
  ]
  for (const op of ops) {
    ctx[op] = vi.fn((...args: unknown[]) => {
      calls.push({ op, args, fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth })
    })
  }
  ctx.measureText = vi.fn().mockReturnValue({ width: 30 })
  return ctx as unknown as CanvasRenderingContext2D & { calls: Call[] }
}

const fills = (ctx: { calls: Call[] }, color: string) => ctx.calls.filter((c) => c.op === 'fill' && c.fillStyle === color)
const strokes = (ctx: { calls: Call[] }, color: string) => ctx.calls.filter((c) => c.op === 'stroke' && c.strokeStyle === color)
const texts = (ctx: { calls: Call[] }) => ctx.calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])
const noSelection = () => ({ nodes: new Set<string>(), segments: new Set<string>() })

/** A straight track along y = 0 from x = 0 to x = 200, a platform on its left (y < 0) from x = 50 to 150 */
function sidePlatform(markers: StopMarker[] = []): { net: Network; platform: Platform; rail: string; nodes: string[] } {
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 200, y: 0 })
  const rail = addSegment(net, a.id, b.id)!.id
  const platform = addPlatform(net, {
    stationId: 'st_1',
    edges: [{ track: [{ segId: rail, t0: 0.25, t1: 0.75 }], side: 'left' }],
    width: PLATFORM_WIDTH,
    markers,
  })
  return { net, platform, rail, nodes: [a.id, b.id] }
}

describe('platforms on the canvas', () => {
  beforeEach(() => resetIdCounter())

  it('keep their shape between frames, and work it out again only for the platform that changed', () => {
    const { net, platform, nodes } = sidePlatform()
    const c = addNode(net, { x: 0, y: 50 })
    const d = addNode(net, { x: 200, y: 50 })
    const other = addSegment(net, c.id, d.id)!.id
    addPlatform(net, { stationId: 'st_1', edges: [{ track: [{ segId: other, t0: 0, t1: 1 }], side: 'right' }], width: 4, markers: [] })

    const first = platformShapes(net)
    expect(first).toHaveLength(2)
    expect(platformShapes(net)).toBe(first)

    // The rail of the first platform moves: its shape follows, the other one is the same object
    net.nodes.get(nodes[1])!.pos.y = 20
    touchNetwork(net, nodes[1])
    const again = platformShapes(net)
    expect(again).not.toBe(first)
    expect(again[0]).not.toBe(first[0])
    expect(again[0].platform).toBe(platform)
    expect(again[1]).toBe(first[1])
  })

  it('draw the outline of the domain (`platformOutline`) at 1:1, with a box around it', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const curve = addCurveSegment(net, a.id, b.id, { x: 50, y: 40 })!.id
    const platform = addPlatform(net, { stationId: 'st_1', edges: [{ track: [{ segId: curve, t0: 0.1, t1: 0.9 }], side: 'right' }], width: PLATFORM_WIDTH, markers: [] })
    const [shape] = platformShapes(net)
    const reference = platformOutline(net, platform, platformDimensions())!
    expect(shape.outline).toHaveLength(reference.length)
    shape.outline.forEach((p, i) => {
      expect(p.x).toBeCloseTo(reference[i].x, 6)
      expect(p.y).toBeCloseTo(reference[i].y, 6)
    })
    for (const p of shape.outline) {
      expect(p.x).toBeGreaterThanOrEqual(shape.minX)
      expect(p.x).toBeLessThanOrEqual(shape.maxX)
      expect(p.y).toBeGreaterThanOrEqual(shape.minY)
      expect(p.y).toBeLessThanOrEqual(shape.maxY)
    }
  })

  it('leave out a platform whose track is gone', () => {
    const { net } = sidePlatform()
    addPlatform(net, { stationId: 'st_1', edges: [{ track: [{ segId: 's_missing', t0: 0, t1: 1 }], side: 'left' }], width: 6, markers: [] })
    expect(platformShapes(net)).toHaveLength(1)
  })

  it('are culled by their box', () => {
    const { net } = sidePlatform()
    expect(platformsInView(net, { minX: 0, minY: -20, maxX: 100, maxY: 20 })).toHaveLength(1)
    expect(platformsInView(net, { minX: 160, minY: -20, maxX: 300, maxY: 20 })).toHaveLength(0)
    expect(platformsInView(net, { minX: 0, minY: 10, maxX: 200, maxY: 50 })).toHaveLength(0)

    // Out of view: nothing in their colour, though the track is drawn
    const ctx = recordingContext()
    renderNetwork(ctx, createCamera(500, 0, 10), 800, 600, net, noSelection())
    expect(fills(ctx, BODY)).toHaveLength(0)
  })

  it('go with the level of their track, each in one pass', () => {
    const { net } = sidePlatform()
    const [shape] = platformShapes(net)
    expect(shape.level).toBe(0)
    expect(platformsOfPass([shape], 0, [0])).toEqual([shape])
    expect(platformsOfPass([shape], -1, [-1, 0, 1])).toEqual([])
    expect(platformsOfPass([shape], 0, [-1, 0, 1])).toEqual([shape])
    // No pass at its level: the highest below it, or the lowest of all
    expect(platformsOfPass([shape], -1, [-1, 1])).toEqual([shape])
    expect(platformsOfPass([shape], 1, [1, 2])).toEqual([shape])
  })

  it('draw their body under the rails, and their edge along the track side', () => {
    const { net } = sidePlatform()
    const ctx = recordingContext()
    renderNetwork(ctx, createCamera(100, 0, 10), 800, 600, net, noSelection())
    const body = fills(ctx, BODY)
    expect(body).toHaveLength(1)
    const firstRail = ctx.calls.findIndex((c) => c.op === 'stroke' && c.strokeStyle === RAIL)
    expect(firstRail).toBeGreaterThan(ctx.calls.indexOf(body[0]))
    // The edge, the safety line (60 px wide platform) and the ticks of the ends, all before the rails
    for (const color of [EDGE, LINE]) {
      const [stroke] = strokes(ctx, color)
      expect(stroke, color).toBeDefined()
      expect(ctx.calls.indexOf(stroke)).toBeLessThan(firstRail)
    }
    // The edge runs 1.70 m from the axis, on the left: y = −1.7 → 300 − 17 px on screen
    const edgeIndex = ctx.calls.indexOf(strokes(ctx, EDGE)[0])
    const edgeStart = ctx.calls.slice(0, edgeIndex).reverse().find((c) => c.op === 'moveTo')!
    expect(edgeStart.args[0]).toBeCloseTo(400 - 500, 6)
    expect(edgeStart.args[1]).toBeCloseTo(300 - 17, 6)
  })

  it('leave the drawing of the tracks as it was', () => {
    const { net, rail } = sidePlatform()
    const plain = createNetwork()
    const a = addNode(plain, { x: 0, y: 0 })
    const b = addNode(plain, { x: 200, y: 0 })
    addSegment(plain, a.id, b.id)
    expect(rail).toBeDefined()
    const strokesOf = (n: Network) => {
      const ctx = recordingContext()
      renderNetwork(ctx, createCamera(100, 0, 10), 800, 600, n, noSelection(), undefined, { hideConstructionNodes: true })
      return ctx.calls.filter((c) => c.strokeStyle !== BODY && c.strokeStyle !== EDGE && c.strokeStyle !== LINE && c.op !== 'fill')
        .filter((c) => c.op === 'stroke').map((c) => [c.strokeStyle, c.lineWidth])
    }
    // The strokes of the rails are the same with a platform beside them, minus its own
    const withPlatform = strokesOf(net)
    const withoutPlatform = strokesOf(plain)
    // The ticks of the ends are in the ink of the theme: the only stroke that is the platform's own
    expect(withPlatform.length - withoutPlatform.length).toBe(1)
    expect(withPlatform.slice(-withoutPlatform.length)).toEqual(withoutPlatform)
  })

  it('become a thick line beside the track from the line tier out, and go in the schematic', () => {
    expect(platformLook('detail')).toBe('body')
    expect(platformLook('rails')).toBe('body')
    expect(platformLook('line')).toBe('strip')
    expect(platformLook('schematic')).toBe('hidden')

    const { net } = sidePlatform()
    const line = recordingContext()
    renderNetwork(line, createCamera(100, 0, 1), 800, 600, net, noSelection())
    expect(fills(line, BODY)).toHaveLength(0)
    const [strip] = strokes(line, BODY)
    expect(strip).toBeDefined()
    expect(strip.lineWidth).toBeGreaterThanOrEqual(2)
    // Clear of the track: its middle is at least half its width and half the line of the track away
    const start = line.calls.slice(0, line.calls.indexOf(strip)).reverse().find((c) => c.op === 'moveTo')!
    expect(300 - (start.args[1] as number)).toBeGreaterThan((strip.lineWidth as number) / 2 + 1)

    const far = recordingContext()
    renderNetwork(far, createCamera(100, 0, 0.1), 800, 600, net, noSelection())
    expect(fills(far, BODY)).toHaveLength(0)
    expect(strokes(far, BODY)).toHaveLength(0)
  })

  it('draw an island between its two tracks', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 200, y: 0 })
    const c = addNode(net, { x: 200, y: 10 })
    const d = addNode(net, { x: 0, y: 10 })
    const top = addSegment(net, a.id, b.id)!.id
    // The other track runs the other way
    const bottom = addSegment(net, c.id, d.id)!.id
    addPlatform(net, {
      stationId: 'st_1',
      edges: [
        { track: [{ segId: top, t0: 0.25, t1: 0.75 }], side: 'right' },
        { track: [{ segId: bottom, t0: 0.25, t1: 0.75 }], side: 'right' },
      ],
      width: PLATFORM_WIDTH,
      markers: [],
    })
    const [shape] = platformShapes(net)
    // From one edge to the other: 1.70 m from each axis
    expect(Math.min(...shape.outline.map((p) => p.y))).toBeCloseTo(1.7, 6)
    expect(Math.max(...shape.outline.map((p) => p.y))).toBeCloseTo(8.3, 6)
    const ctx = recordingContext()
    renderNetwork(ctx, createCamera(100, 5, 10), 800, 600, net, noSelection())
    expect(fills(ctx, BODY)).toHaveLength(1)
    // Two edges in one stroke: two lines
    const edgeIndex = ctx.calls.indexOf(strokes(ctx, EDGE)[0])
    const lastPath = ctx.calls.slice(0, edgeIndex).map((c) => c.op).lastIndexOf('beginPath')
    expect(ctx.calls.slice(lastPath, edgeIndex).filter((c) => c.op === 'moveTo')).toHaveLength(2)
  })

  it('mark the ends of each edge once the view is close', () => {
    const { net } = sidePlatform()
    const shapes = platformShapes(net)
    const ticks = (scale: number) => {
      const ctx = recordingContext()
      renderPlatformBodies(ctx, createCamera(100, 0, scale), 800, 600, shapes, { lod: 'detail' })
      const tick = ctx.calls.find((c) => c.op === 'stroke' && c.lineWidth === 2 && c.strokeStyle === '#1a1a1a')
      return tick ? ctx.calls.slice(0, ctx.calls.indexOf(tick)).filter((c) => c.op === 'moveTo').length : 0
    }
    expect(ticks(PLATFORM_DETAIL_FROM_PX / PLATFORM_WIDTH)).toBeGreaterThan(0)
    expect(ticks(PLATFORM_DETAIL_FROM_PX / PLATFORM_WIDTH - 0.1)).toBe(0)
  })

  it('stand out when picked or under the cursor', () => {
    const { net, platform } = sidePlatform()
    const shapes = platformShapes(net)
    const picked = recordingContext()
    renderPlatformBodies(picked, createCamera(100, 0, 10), 800, 600, shapes, { lod: 'detail', selectedId: platform.id })
    expect(fills(picked, ACCENT)).toHaveLength(1)
    expect(strokes(picked, ACCENT).map((c) => c.lineWidth)).toEqual([2.5])

    const hovered = recordingContext()
    renderPlatformBodies(hovered, createCamera(100, 0, 10), 800, 600, shapes, { lod: 'detail', hoveredId: platform.id })
    expect(strokes(hovered, ACCENT).map((c) => c.lineWidth)).toEqual([1.5])
    expect(vi.mocked(hovered.setLineDash)).toHaveBeenCalledWith([5, 4])

    const plain = recordingContext()
    renderPlatformBodies(plain, createCamera(100, 0, 10), 800, 600, shapes, { lod: 'detail', selectedId: 'pl_other' })
    expect(fills(plain, ACCENT)).toHaveLength(0)
    expect(strokes(plain, ACCENT)).toHaveLength(0)

    // From the line tier out the thick line takes the accent colour
    const strip = recordingContext()
    renderPlatformBodies(strip, createCamera(100, 0, 1), 800, 600, shapes, { lod: 'line', selectedId: platform.id })
    expect(strokes(strip, ACCENT)).toHaveLength(1)
  })
})

describe('stop markers', () => {
  beforeEach(() => resetIdCounter())

  const markers: StopMarker[] = [
    { edge: 0, at: 90, heading: 'forward', maxLength: 200 },
    { edge: 0, at: 10, heading: 'backward' },
  ]

  it('are boards turned the way of their trains, written with their train length up close', () => {
    const { net } = sidePlatform(markers)
    const shapes = platformShapes(net)
    const ctx = recordingContext()
    renderStopMarkers(ctx, createCamera(100, 0, 10), 800, 600, shapes, { lod: 'detail' })
    expect(ctx.calls.filter((c) => c.op === 'rect')).toHaveLength(2)
    const angles = ctx.calls.filter((c) => c.op === 'rotate').map((c) => c.args[0] as number)
    expect(angles[0]).toBeCloseTo(0, 6)
    expect(Math.abs(angles[1])).toBeCloseTo(Math.PI, 6)
    expect(texts(ctx)).toEqual(['200 m'])
    // On the platform side of the edge (above the track on screen), at x = 50 + 90 m
    const [board] = ctx.calls.filter((c) => c.op === 'translate')
    expect(board.args[0]).toBeCloseTo(400 + 40 * 10, 6)
    expect(board.args[1] as number).toBeLessThan(300 - 17)
  })

  it('write their lengths in the unit of the layout', () => {
    const { net } = sidePlatform([{ edge: 0, at: 50, heading: 'forward', maxLength: 2.4 }])
    const ctx = recordingContext()
    renderStopMarkers(ctx, createCamera(100, 0, 10), 800, 600, platformShapes(net), { lod: 'detail', unit: 'cm' })
    expect(texts(ctx)).toEqual(['240.0 cm'])
  })

  it('lose their label, then their board, as the view moves away', () => {
    const { net } = sidePlatform(markers)
    const shapes = platformShapes(net)
    const at = (scale: number, lod: 'detail' | 'rails' | 'line') => {
      const ctx = recordingContext()
      renderStopMarkers(ctx, createCamera(100, 0, scale), 800, 600, shapes, { lod })
      return { boards: ctx.calls.filter((c) => c.op === 'rect').length, labels: texts(ctx).length }
    }
    expect(at(PLATFORM_LABEL_FROM_PX / PLATFORM_WIDTH, 'detail')).toEqual({ boards: 2, labels: 1 })
    expect(at(PLATFORM_LABEL_FROM_PX / PLATFORM_WIDTH - 0.1, 'detail')).toEqual({ boards: 2, labels: 0 })
    expect(at(PLATFORM_DETAIL_FROM_PX / PLATFORM_WIDTH - 0.1, 'rails')).toEqual({ boards: 0, labels: 0 })
    expect(at(1, 'line')).toEqual({ boards: 0, labels: 0 })
  })

  it('give way with their label to what already stands there, never with their board', () => {
    const { net } = sidePlatform(markers)
    const space = new LabelSpace()
    space.reserve({ x: 0, y: 0, w: 800, h: 600 })
    const ctx = recordingContext()
    renderStopMarkers(ctx, createCamera(100, 0, 10), 800, 600, platformShapes(net), { lod: 'detail', space })
    expect(ctx.calls.filter((c) => c.op === 'rect')).toHaveLength(2)
    expect(texts(ctx)).toEqual([])
  })

  it('are drawn among the overlays of the network', () => {
    const { net } = sidePlatform(markers)
    const ctx = recordingContext()
    renderNetwork(ctx, createCamera(100, 0, 10), 800, 600, net, noSelection(), undefined, { platforms: { unit: 'm' } })
    expect(texts(ctx)).toContain('200 m')
    const tracksOnly = recordingContext()
    renderNetwork(tracksOnly, createCamera(100, 0, 10), 800, 600, net, noSelection(), undefined, { part: 'tracks' })
    expect(texts(tracksOnly)).toEqual([])
    expect(fills(tracksOnly, BODY)).toHaveLength(1)
  })
})
