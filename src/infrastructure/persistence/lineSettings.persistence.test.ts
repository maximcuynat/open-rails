import { beforeEach, describe, expect, it } from 'vitest'
import { addArcCurve, addNode, addSegment, createNetwork, resetIdCounter } from '../../domain/models/network'
import type { Network, Segment } from '../../domain/models/types'
import { deserializeNetwork, serializeNetwork, type SerializedProject } from './persistence'

beforeEach(() => resetIdCounter(0))

const throughJson = (project: SerializedProject): SerializedProject => JSON.parse(JSON.stringify(project))

/** A straight rail followed by a curve of two pieces */
function track(): { net: Network; straight: Segment; curve: Segment[] } {
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 500, y: 0 })
  const c = addNode(net, { x: 1000, y: 134 })
  const straight = addSegment(net, a.id, b.id)!
  const curve = addArcCurve(net, b.id, c.id, { x: 750, y: 0 })!.segments
  expect(curve.length).toBeGreaterThan(1)
  return { net, straight, curve }
}

function save(net: Network, line?: { lineSpeed?: number; lineType?: 'classic' | 'highSpeed' }): SerializedProject {
  return throughJson(
    serializeNetwork(net, 'P', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, line),
  )
}

describe('line settings and cant in a saved project', () => {
  it('a project on the default line, without cant set by hand, is written without any of the new keys', () => {
    const { net } = track()
    const saved = save(net, { lineSpeed: 160, lineType: 'classic' })
    expect('lineSpeed' in saved).toBe(false)
    expect('lineType' in saved).toBe(false)
    expect(saved.segments.some((s) => 'cant' in s)).toBe(false)
    expect(JSON.stringify(saved)).toBe(JSON.stringify(save(net)))
  })

  it('a file from before these settings loads on the default line and is saved again identically', () => {
    const { net } = track()
    const old = save(net)
    const loaded = deserializeNetwork(old)
    expect(loaded.lineSpeed).toBeUndefined()
    expect(loaded.lineType).toBeUndefined()
    expect([...loaded.network.segments.values()].every((s) => s.cant === undefined)).toBe(true)
    // The store falls back on the default line and hands it to the next save
    const again = save(loaded.network, { lineSpeed: loaded.lineSpeed ?? 160, lineType: loaded.lineType ?? 'classic' })
    expect(JSON.stringify(again)).toBe(JSON.stringify(old))
  })

  it('line speed and line type come back', () => {
    const { net } = track()
    const saved = save(net, { lineSpeed: 300, lineType: 'highSpeed' })
    expect(saved).toMatchObject({ lineSpeed: 300, lineType: 'highSpeed' })
    expect(deserializeNetwork(saved)).toMatchObject({ lineSpeed: 300, lineType: 'highSpeed' })
    // Each is written on its own
    expect(save(net, { lineSpeed: 100, lineType: 'classic' })).toMatchObject({ lineSpeed: 100 })
    expect('lineType' in save(net, { lineSpeed: 100, lineType: 'classic' })).toBe(false)
  })

  it('unusable line settings in a file are ignored', () => {
    const { net } = track()
    const saved = save(net)
    const loaded = deserializeNetwork({ ...saved, lineSpeed: -20, lineType: 'maglev' as never })
    expect(loaded.lineSpeed).toBeUndefined()
    expect(loaded.lineType).toBeUndefined()
    expect(deserializeNetwork({ ...saved, lineSpeed: 'fast' as never }).lineSpeed).toBeUndefined()
    expect(deserializeNetwork({ ...saved, lineSpeed: 5000 }).lineSpeed).toBeUndefined()
  })

  it('a cant set by hand is saved on its rail only, and comes back', () => {
    const { net, straight, curve } = track()
    curve[0].cant = 120
    straight.cant = 50 // never on a straight rail
    const saved = save(net)
    expect(saved.segments.find((s) => s.id === curve[0].id)!.cant).toBe(120)
    expect('cant' in saved.segments.find((s) => s.id === curve[1].id)!).toBe(false)
    expect('cant' in saved.segments.find((s) => s.id === straight.id)!).toBe(false)

    const loaded = deserializeNetwork(saved).network
    expect(loaded.segments.get(curve[0].id)!.cant).toBe(120)
    expect(loaded.segments.get(curve[1].id)!.cant).toBeUndefined()
    expect(JSON.stringify(save(loaded))).toBe(JSON.stringify(saved))
  })

  it('a cant of 0 is a cant set by hand: it is kept', () => {
    const { net, curve } = track()
    curve[1].cant = 0
    const loaded = deserializeNetwork(save(net)).network
    expect(loaded.segments.get(curve[1].id)!.cant).toBe(0)
  })

  it('an unusable cant in a file is dropped', () => {
    const { net, curve } = track()
    const saved = save(net)
    saved.segments.find((s) => s.id === curve[0].id)!.cant = 900
    saved.segments.find((s) => s.id === curve[1].id)!.cant = 'steep' as never
    const loaded = deserializeNetwork(saved).network
    expect(loaded.segments.get(curve[0].id)!.cant).toBeUndefined()
    expect(loaded.segments.get(curve[1].id)!.cant).toBeUndefined()
  })
})
