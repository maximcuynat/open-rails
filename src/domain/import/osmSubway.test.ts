import { beforeEach, describe, expect, it } from 'vitest'
import { convertOsm } from './osmImport'
import { along, answer, options, osmTrack } from './osmImport.testkit'
import { nodeLevel, resetIdCounter, segmentBand } from '../models/network'

beforeEach(() => resetIdCounter(0))

describe('a metro at import', () => {
  it('lays railway=subway when asked, its rails known as metro, under the ground when in a tunnel', () => {
    const data = answer(
      osmTrack(1, 100, along([0, 0], [3000, 0], 100)).elements,
      osmTrack(2, 200, along([0, 500], [3000, 500], 100), { railway: 'subway', tunnel: 'yes', layer: '-1' }).elements,
    )
    expect([...convertOsm(data, options()).network.segments.values()].some((seg) => seg.railway)).toBe(false)
    resetIdCounter(0)
    const net = convertOsm(data, options({ extraKinds: ['subway'] })).network
    const metro = [...net.segments.values()].filter((seg) => seg.railway === 'subway')
    const train = [...net.segments.values()].filter((seg) => !seg.railway)
    expect(metro.length).toBeGreaterThan(0)
    expect(train.length).toBeGreaterThan(0)
    for (const seg of metro) {
      expect(net.nodes.get(seg.from)!.pos.y).toBeGreaterThan(200)
      expect(segmentBand(net, seg)).toBeLessThan(0)
      expect(nodeLevel(net.nodes.get(seg.from)!)).toBeLessThan(0)
    }
    for (const seg of train) expect(net.nodes.get(seg.from)!.pos.y).toBeLessThan(-200)
  })

  it('keeps right on a metro double line, and makes no station of its stops', () => {
    const subway = { railway: 'subway' }
    const north = osmTrack(1, 100, along([0, 0], [3000, 0], 100), subway)
    const south = osmTrack(2, 200, along([0, 4.5], [3000, 4.5], 100), subway)
    // A stop position of the metro, named but saying nothing of its mode
    const stop = north.elements.find((e) => e.type === 'node' && e.id === 115)!
    stop.tags = { railway: 'stop', public_transport: 'stop_position', name: 'Porte de Test' }
    const result = convertOsm(answer(north.elements, south.elements), options({ extraKinds: ['subway'], stations: true }))
    const net = result.network
    expect(net.stations.size).toBe(0)
    const northY = Math.min(...[...net.nodes.values()].map((n) => n.pos.y))
    for (const seg of net.segments.values()) {
      const a = net.nodes.get(seg.from)!.pos
      const b = net.nodes.get(seg.to)!.pos
      expect(seg.running).toBeDefined()
      const eastward = (seg.running === 'forward') === b.x > a.x
      // y grows southwards: going east the north track is on the left, so keeping right the south one is run east
      expect(eastward).toBe((a.y + b.y) / 2 > northY + 2)
    }
  })

  it('keeps a tram and a light rail apart from the metro and from the railway, each with its own kind', () => {
    const data = answer(
      osmTrack(1, 100, along([0, 0], [3000, 0], 100)).elements,
      osmTrack(2, 200, along([0, 500], [3000, 500], 100), { railway: 'subway' }).elements,
      osmTrack(3, 300, along([0, 1000], [3000, 1000], 100), { railway: 'tram' }).elements,
      osmTrack(4, 400, along([0, 1500], [3000, 1500], 100), { railway: 'light_rail' }).elements,
    )
    const net = convertOsm(data, options({ extraKinds: ['subway', 'tram', 'light_rail'] })).network
    // Each kind on its own way, never mixed
    const meanY = new Map<string, number[]>()
    for (const seg of net.segments.values()) {
      const kind = seg.railway ?? 'railway'
      meanY.set(kind, [...(meanY.get(kind) ?? []), net.nodes.get(seg.from)!.pos.y])
    }
    const spread = (kind: string) => {
      const ys = meanY.get(kind)!
      return { mid: ys.reduce((a, b) => a + b, 0) / ys.length, width: Math.max(...ys) - Math.min(...ys) }
    }
    const order = ['railway', 'subway', 'tram', 'light_rail']
    expect([...meanY.keys()].sort()).toEqual([...order].sort())
    for (const kind of order) expect(spread(kind).width).toBeLessThan(1)
    // In the order the ways were laid, 500 m apart
    const mids = order.map((kind) => spread(kind).mid)
    for (let k = 1; k < mids.length; k++) expect(mids[k] - mids[k - 1]).toBeCloseTo(500, -1)
  })
})
