import { describe, expect, it, vi } from 'vitest'
import { addNode, addSegment, createNetwork } from '@domain/models/network'
import { addStation } from '@domain/models/stations'
import { createCamera } from './camera'
import { LabelSpace } from './labelSpace'
import { renderNetwork } from './renderer'
import { renderStations } from './stationRender'

function mockContext(): CanvasRenderingContext2D {
  return {
    canvas: { width: 800, height: 600 },
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    stroke: vi.fn(), fill: vi.fn(), arc: vi.fn(), rect: vi.fn(), roundRect: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
    setLineDash: vi.fn(), translate: vi.fn(), rotate: vi.fn(), quadraticCurveTo: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 60 }), fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

const texts = (ctx: CanvasRenderingContext2D): string[] => vi.mocked(ctx.fillText).mock.calls.map((c) => c[0] as string)

/** A rail along y = 0 with a station in its middle and another one far to the east */
function network() {
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 1000, y: 0 })
  const rail = addSegment(net, a.id, b.id)!
  const near = addStation(net, { name: 'Clelles-Mens', pos: { x: 500, y: 0 }, stops: [{ segId: rail.id, t: 0.5 }] })
  const far = addStation(net, { name: 'Loin', pos: { x: 50000, y: 0 }, stops: [] })
  return { net, near, far }
}

describe('the stations on the canvas', () => {
  it('writes the name of a station in view, and nothing for one out of view', () => {
    const { net } = network()
    const ctx = mockContext()
    renderStations(ctx, createCamera(500, 0, 2), 800, 600, net)
    expect(texts(ctx)).toEqual(['Clelles-Mens'])
    expect(vi.mocked(ctx.rect)).toHaveBeenCalledTimes(1)
  })

  it('is drawn at every zoom, the schematic included', () => {
    const { net } = network()
    for (const scale of [0.01, 0.1, 1, 10]) {
      const ctx = mockContext()
      renderStations(ctx, createCamera(500, 0, scale), 800, 600, net)
      expect(texts(ctx), `${scale} px/m`).toEqual(['Clelles-Mens'])
    }
  })

  it('leaves the name out when something already stands there, the picked station excepted', () => {
    const { net, near } = network()
    const taken = new LabelSpace()
    // The pill of the station stands above its mark, centred on the screen
    taken.reserve({ x: 300, y: 250, w: 200, h: 40 })
    const ctx = mockContext()
    renderStations(ctx, createCamera(500, 0, 2), 800, 600, net, { space: taken })
    expect(texts(ctx)).toEqual([])
    const picked = mockContext()
    const again = new LabelSpace()
    again.reserve({ x: 300, y: 250, w: 200, h: 40 })
    renderStations(picked, createCamera(500, 0, 2), 800, 600, net, { space: again, selectedId: near.id })
    expect(texts(picked)).toEqual(['Clelles-Mens'])
  })

  it('in a crowd only the marks are drawn', () => {
    const net = createNetwork()
    for (let i = 0; i < 6; i++) addStation(net, { name: `Gare ${i}`, pos: { x: i * 10, y: 0 }, stops: [] })
    const ctx = mockContext()
    renderStations(ctx, createCamera(25, 0, 1), 800, 600, net)
    expect(texts(ctx)).toEqual([])
    expect(vi.mocked(ctx.rect)).toHaveBeenCalledTimes(6)
  })

  it('stays in the driving view, where the badges of the sections are hidden', () => {
    const { net } = network()
    const ctx = mockContext()
    const selection = { nodes: new Set<string>(), segments: new Set<string>() }
    renderNetwork(ctx, createCamera(500, 0, 2), 800, 600, net, selection, {}, { hideSectionBadges: true, hideConstructionNodes: true })
    expect(texts(ctx)).toContain('Clelles-Mens')
  })
})
