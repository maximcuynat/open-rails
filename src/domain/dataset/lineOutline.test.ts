import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, resetIdCounter } from '../models/network'
import { lineOutline, readOutline, simplifyPolyline } from './lineOutline'

beforeEach(() => resetIdCounter(0))

describe('the course of a line as a few strokes', () => {
  it('draws a double track as one stroke from end to end', () => {
    const net = createNetwork()
    const ids: string[] = []
    for (const y of [0, 4]) {
      let prev = addNode(net, { x: 0, y })
      for (let x = 1000; x <= 10_000; x += 1000) {
        const next = addNode(net, { x, y })
        ids.push(addSegment(net, prev.id, next.id)!.id)
        prev = next
      }
    }
    const strokes = lineOutline(net, ids)
    expect(strokes).toHaveLength(1)
    // Straight: its two ends are enough
    expect(strokes[0]).toHaveLength(4)
    expect([strokes[0][0], strokes[0][2]].sort((a, b) => a - b)).toEqual([0, 10_000])
  })

  it('gives a branch its own stroke, from where it leaves the reach of the trunk', () => {
    const net = createNetwork()
    const ids: string[] = []
    const trunk = [0, 5000, 10_000, 20_000].map((x) => addNode(net, { x, y: 0 }))
    for (let i = 1; i < trunk.length; i++) ids.push(addSegment(net, trunk[i - 1].id, trunk[i].id)!.id)
    let prev = trunk[1]
    for (const [x, y] of [[6000, 1000], [7000, 4000], [8000, 9000]]) {
      const next = addNode(net, { x, y })
      ids.push(addSegment(net, prev.id, next.id)!.id)
      prev = next
    }
    const strokes = lineOutline(net, ids)
    // The longest way takes the branch; what is left of the trunk is the second stroke
    expect(strokes).toHaveLength(2)
    const xs = strokes.flatMap((stroke) => stroke.filter((_, i) => i % 2 === 0))
    const ys = strokes.flatMap((stroke) => stroke.filter((_, i) => i % 2 === 1))
    expect(Math.min(...xs)).toBe(0)
    expect(Math.max(...xs)).toBe(20_000)
    expect(Math.max(...ys)).toBe(9000)
    expect(strokes[0].length).toBeGreaterThan(strokes[1].length)
  })

  it('leaves out what is too short, and rails the network does not have', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 800, y: 0 })
    const rail = addSegment(net, a.id, b.id)!
    expect(lineOutline(net, [rail.id, 's_nope'])).toEqual([])
    const [stroke] = lineOutline(net, [rail.id], { minLength: 500 })
    expect([stroke[0], stroke[2]].sort((p, q) => p - q)).toEqual([0, 800])
  })

  it('simplifies within the tolerance and no further', () => {
    const arc = Array.from({ length: 101 }, (_, i) => ({ x: i * 100, y: 0.02 * (i - 50) * (i - 50) }))
    const kept = simplifyPolyline(arc, 5)
    expect(kept.length).toBeLessThan(20)
    expect(kept.length).toBeGreaterThan(2)
    expect(kept[0]).toBe(arc[0])
    expect(kept[kept.length - 1]).toBe(arc[100])
    // Every point left out is within 5 m of the stroke
    for (const p of arc) {
      let nearest = Infinity
      for (let i = 1; i < kept.length; i++) {
        const dx = kept[i].x - kept[i - 1].x
        const dy = kept[i].y - kept[i - 1].y
        const t = Math.max(0, Math.min(1, ((p.x - kept[i - 1].x) * dx + (p.y - kept[i - 1].y) * dy) / (dx * dx + dy * dy)))
        nearest = Math.min(nearest, Math.hypot(p.x - kept[i - 1].x - t * dx, p.y - kept[i - 1].y - t * dy))
      }
      expect(nearest).toBeLessThanOrEqual(5 + 1e-9)
    }
  })

  it('reads strokes from an index, and nothing from anything else', () => {
    expect(readOutline([[0, 0, 10, 5]])).toEqual([[0, 0, 10, 5]])
    expect(readOutline([[0, 0, 10]])).toBeUndefined()
    expect(readOutline([[0, 0]])).toBeUndefined()
    expect(readOutline([[0, 0, 'a', 1]])).toBeUndefined()
    expect(readOutline('x')).toBeUndefined()
  })
})
