import { describe, expect, it } from 'vitest'
import {
  addNode,
  addSegment,
  createNetwork,
  dist,
  distToSegment,
  hitNode,
  hitSegment,
  removeNode,
  removeSegment,
  snapToGrid,
} from './network'

describe('createNetwork', () => {
  it('starts empty', () => {
    const net = createNetwork()
    expect(net.nodes.size).toBe(0)
    expect(net.segments.size).toBe(0)
    expect(net.adjacency.size).toBe(0)
  })
})

describe('addNode', () => {
  it('adds a node with a unique id', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 10, y: 20 })
    expect(net.nodes.size).toBe(1)
    expect(net.nodes.get(a.id)).toEqual({ id: a.id, pos: { x: 10, y: 20 } })
    expect(net.adjacency.get(a.id)).toEqual([])
  })

  it('does not mutate the original position', () => {
    const net = createNetwork()
    const pos = { x: 5, y: 5 }
    const a = addNode(net, pos)
    pos.x = 999
    expect(net.nodes.get(a.id)!.pos.x).toBe(5)
  })
})

describe('addSegment', () => {
  it('connects two nodes', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 0 })
    const seg = addSegment(net, a.id, b.id)
    expect(seg).not.toBeNull()
    expect(net.segments.size).toBe(1)
    expect(net.adjacency.get(a.id)).toContain(seg!.id)
    expect(net.adjacency.get(b.id)).toContain(seg!.id)
  })

  it('rejects self-loops', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    expect(addSegment(net, a.id, a.id)).toBeNull()
    expect(net.segments.size).toBe(0)
  })

  it('rejects unknown node ids', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    expect(addSegment(net, a.id, 'nonexistent')).toBeNull()
  })
})

describe('removeNode', () => {
  it('removes the node and its connected segments', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 0 })
    const c = addNode(net, { x: 20, y: 0 })
    const s1 = addSegment(net, a.id, b.id)!
    const s2 = addSegment(net, b.id, c.id)!

    removeNode(net, b.id)

    expect(net.nodes.has(b.id)).toBe(false)
    expect(net.adjacency.has(b.id)).toBe(false)
    expect(net.segments.has(s1.id)).toBe(false)
    expect(net.segments.has(s2.id)).toBe(false)
    // a and c still exist, but with empty adjacency
    expect(net.nodes.has(a.id)).toBe(true)
    expect(net.nodes.has(c.id)).toBe(true)
    expect(net.adjacency.get(a.id)).toEqual([])
    expect(net.adjacency.get(c.id)).toEqual([])
  })
})

describe('removeSegment', () => {
  it('removes the segment but keeps the nodes', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 0 })
    const seg = addSegment(net, a.id, b.id)!

    removeSegment(net, seg.id)

    expect(net.segments.size).toBe(0)
    expect(net.nodes.has(a.id)).toBe(true)
    expect(net.nodes.has(b.id)).toBe(true)
    expect(net.adjacency.get(a.id)).toEqual([])
    expect(net.adjacency.get(b.id)).toEqual([])
  })
})

describe('snapToGrid', () => {
  it('snaps to nearest grid intersection', () => {
    expect(snapToGrid({ x: 2.3, y: 4.6 }, 1)).toEqual({ x: 2, y: 5 })
    expect(snapToGrid({ x: 12, y: 7 }, 5)).toEqual({ x: 10, y: 5 })
  })

  it('returns the same point when spacing is 0', () => {
    expect(snapToGrid({ x: 3, y: 7 }, 0)).toEqual({ x: 3, y: 7 })
  })
})

describe('dist', () => {
  it('computes euclidean distance', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })
})

describe('distToSegment', () => {
  it('projects perpendicular onto the segment', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 10, y: 0 }
    expect(distToSegment({ x: 5, y: 3 }, a, b)).toBe(3)
  })

  it('clamps to the nearest endpoint', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 10, y: 0 }
    expect(distToSegment({ x: 15, y: 0 }, a, b)).toBe(5)
    expect(distToSegment({ x: -3, y: 4 }, a, b)).toBe(5)
  })

  it('handles zero-length segment', () => {
    expect(distToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5)
  })
})

describe('hitNode', () => {
  it('finds the closest node within range', () => {
    const net = createNetwork()
    addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 5, y: 0 })
    addNode(net, { x: 20, y: 0 })
    expect(hitNode(net, { x: 4.5, y: 0.5 }, 2)).toBe(b.id)
  })

  it('returns null when nothing is in range', () => {
    const net = createNetwork()
    addNode(net, { x: 0, y: 0 })
    expect(hitNode(net, { x: 50, y: 50 }, 2)).toBeNull()
  })
})

describe('hitSegment', () => {
  it('finds the closest segment within range', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 0 })
    const seg = addSegment(net, a.id, b.id)!
    expect(hitSegment(net, { x: 5, y: 0.5 }, 2)).toBe(seg.id)
  })

  it('returns null when nothing is in range', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 0 })
    addSegment(net, a.id, b.id)
    expect(hitSegment(net, { x: 5, y: 20 }, 2)).toBeNull()
  })
})
