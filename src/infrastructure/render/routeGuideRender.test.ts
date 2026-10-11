import { describe, expect, it, vi } from 'vitest'
import { addNode, addSegment, createNetwork } from '@domain/models/network'
import { renderRouteGuide, routeGuideReach, ROUTE_GUIDE_COLOR } from './routeGuideRender'

function mockContext() {
  return { beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), save: vi.fn(), restore: vi.fn(), strokeStyle: '', lineWidth: 0, globalAlpha: 1, lineCap: '', lineJoin: '' } as unknown as CanvasRenderingContext2D
}

/** Three rails end to end along x, 0 → 300 → 600 → 900 */
function line() {
  const net = createNetwork()
  const n = [0, 300, 600, 900].map((x) => addNode(net, { x, y: 0 }))
  return { net, rails: [0, 1, 2].map((i) => addSegment(net, n[i].id, n[i + 1].id)!) }
}

describe('the way drawn on the track', () => {
  it('draws the stretches in view as one line, band then line, and nothing of those out of view', () => {
    const { net, rails } = line()
    const spans = rails.map((rail) => ({ segId: rail.id, t0: 0, t1: 1 }))
    const ctx = mockContext()
    // 1 px per metre, the view 400 px wide centred on x = 150 (world -50 … 350, screen = world + 50):
    // the second rail leaves the view and is drawn whole, the third (600 → 900) is out
    renderRouteGuide(ctx, { x: 150, y: 0, scale: 1 }, 400, 300, net, spans)
    expect(vi.mocked(ctx.moveTo).mock.calls).toEqual([[50, 150]])
    const xs = vi.mocked(ctx.lineTo).mock.calls.map((c) => c[0])
    expect(Math.max(...xs)).toBe(650)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
    expect(ctx.stroke).toHaveBeenCalledTimes(2)
    expect(ctx.strokeStyle).toBe(ROUTE_GUIDE_COLOR)
  })

  it('draws nothing without a way, or with none of it in view', () => {
    const { net, rails } = line()
    const ctx = mockContext()
    renderRouteGuide(ctx, { x: 150, y: 0, scale: 1 }, 400, 300, net, [])
    renderRouteGuide(ctx, { x: 5000, y: 0, scale: 1 }, 400, 300, net, [{ segId: rails[0].id, t0: 0, t1: 1 }])
    expect(ctx.stroke).not.toHaveBeenCalled()
  })

  it('reaches twice the diagonal of the view, two kilometres at least', () => {
    expect(routeGuideReach({ x: 0, y: 0, scale: 4 }, 800, 600)).toBe(2000)
    expect(routeGuideReach({ x: 0, y: 0, scale: 0.1 }, 800, 600)).toBeCloseTo(20_000, 6)
  })
})
