import { describe, expect, it } from 'vitest'
import {
  addCurveSegment,
  addNode,
  addSegment,
  createNetwork,
  dist,
  distToSegment,
  generateId,
  getStepPointsAlongSegment,
  hitNode,
  hitSegment,
  pruneOrphanNodes,
  removeNode,
  dissolveNode,
  removeSegment,
  resetIdCounter,
  snapToGrid,
} from './network'

describe('generateId and resetIdCounter', () => {
  it('generates sequential IDs and resets', () => {
    resetIdCounter(0)
    expect(generateId('test')).toBe('test_1')
    expect(generateId('test')).toBe('test_2')
    resetIdCounter(10)
    expect(generateId('test')).toBe('test_11')
  })
})

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

describe('dissolveNode', () => {
  it('dissolves an intermediate aligned straight node and connects the two outer endpoints', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 50, y: 0 })
    const c = addNode(net, { x: 100, y: 0 })
    const s1 = addSegment(net, a.id, b.id)!
    const s2 = addSegment(net, b.id, c.id)!

    const mergedSeg = dissolveNode(net, b.id)

    expect(mergedSeg).not.toBeNull()
    expect(net.nodes.has(b.id)).toBe(false)
    expect(net.segments.has(s1.id)).toBe(false)
    expect(net.segments.has(s2.id)).toBe(false)

    // a and c are preserved and now connected directly
    expect(net.nodes.has(a.id)).toBe(true)
    expect(net.nodes.has(c.id)).toBe(true)
    expect(net.segments.size).toBe(1)
    expect(mergedSeg!.from).toBe(a.id)
    expect(mergedSeg!.to).toBe(c.id)
    expect(net.adjacency.get(a.id)).toEqual([mergedSeg!.id])
    expect(net.adjacency.get(c.id)).toEqual([mergedSeg!.id])
  })

  it('does not dissolve a corner node (non-aligned)', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 50, y: 0 })
    const c = addNode(net, { x: 50, y: 50 })
    addSegment(net, a.id, b.id)
    addSegment(net, b.id, c.id)

    const result = dissolveNode(net, b.id)
    expect(result).toBeNull()
    // Network remains unchanged
    expect(net.nodes.has(b.id)).toBe(true)
    expect(net.segments.size).toBe(2)
  })

  it('does not dissolve a node with degree other than 2', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 50, y: 0 })
    addSegment(net, a.id, b.id)

    // Degree 1 (dead end)
    expect(dissolveNode(net, b.id)).toBeNull()

    // Degree 3 (junction)
    const c = addNode(net, { x: 100, y: 0 })
    const d = addNode(net, { x: 90, y: 25 })
    addSegment(net, b.id, c.id)
    addSegment(net, b.id, d.id)
    expect(dissolveNode(net, b.id)).toBeNull()
  })
})

describe('removeSegment', () => {
  it('removes the segment and cleans up orphan nodes by default', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 0 })
    const seg = addSegment(net, a.id, b.id)!

    removeSegment(net, seg.id)

    expect(net.segments.size).toBe(0)
    expect(net.nodes.has(a.id)).toBe(false)
    expect(net.nodes.has(b.id)).toBe(false)
  })

  it('keeps connected nodes and only removes dead-end orphan nodes', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 0 })
    const c = addNode(net, { x: 20, y: 0 })
    const s1 = addSegment(net, a.id, b.id)!
    addSegment(net, b.id, c.id)!

    removeSegment(net, s1.id)

    expect(net.nodes.has(a.id)).toBe(false) // a had only s1 -> removed
    expect(net.nodes.has(b.id)).toBe(true)  // b still connects to c -> kept
    expect(net.nodes.has(c.id)).toBe(true)
  })

  it('keeps nodes if cleanOrphans is explicitly false', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 0 })
    const seg = addSegment(net, a.id, b.id)!

    removeSegment(net, seg.id, false)

    expect(net.segments.size).toBe(0)
    expect(net.nodes.has(a.id)).toBe(true)
    expect(net.nodes.has(b.id)).toBe(true)
  })

  it('pruneOrphanNodes cleans up nodes with degree 0 while preserving whitelisted and connected nodes', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    addSegment(net, n1.id, n2.id)

    const orphan1 = addNode(net, { x: 200, y: 200 })
    const orphan2 = addNode(net, { x: 300, y: 300 })

    // Whitelist orphan2 (active placement node)
    const count = pruneOrphanNodes(net, [orphan2.id])
    expect(count).toBe(1)
    expect(net.nodes.has(orphan1.id)).toBe(false)
    expect(net.nodes.has(orphan2.id)).toBe(true)
    expect(net.nodes.has(n1.id)).toBe(true)
    expect(net.nodes.has(n2.id)).toBe(true)

    // Full prune without whitelist
    const count2 = pruneOrphanNodes(net)
    expect(count2).toBe(1)
    expect(net.nodes.has(orphan2.id)).toBe(false)
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

describe('getStepPointsAlongSegment', () => {
  it('calculates regular grid and integer snap points along a straight segment', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 50, y: 0 })
    const seg = addSegment(net, a.id, b.id)!

    const res = getStepPointsAlongSegment(seg.id, net, 10, { x: 21.2, y: 1.5 })
    expect(res.points.length).toBeGreaterThan(0)
    // Points should contain x = 10, 20, 30, 40 at y = 0
    expect(res.points.some((p) => Math.abs(p.x - 10) < 1e-3 && Math.abs(p.y) < 1e-3)).toBe(true)
    expect(res.points.some((p) => Math.abs(p.x - 20) < 1e-3 && Math.abs(p.y) < 1e-3)).toBe(true)
    expect(res.points.some((p) => Math.abs(p.x - 30) < 1e-3 && Math.abs(p.y) < 1e-3)).toBe(true)
    expect(res.points.some((p) => Math.abs(p.x - 40) < 1e-3 && Math.abs(p.y) < 1e-3)).toBe(true)

    // Nearest point to (21.2, 1.5) should be (20, 0)
    expect(res.nearest).toBeDefined()
    expect(res.nearest?.x).toBe(20)
    expect(res.nearest?.y).toBe(0)
    expect(Math.abs(res.nearestT - 0.4)).toBeLessThan(0.01)
  })

  it('calculates snap points along a diagonal segment intersecting grid lines', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 40, y: 40 })
    const seg = addSegment(net, a.id, b.id)!

    const res = getStepPointsAlongSegment(seg.id, net, 10, { x: 9.8, y: 10.2 })
    expect(res.points.length).toBeGreaterThan(0)
    // Nearest to (9.8, 10.2) should snap to (10, 10)
    expect(res.nearest).toBeDefined()
    expect(res.nearest?.x).toBe(10)
    expect(res.nearest?.y).toBe(10)
  })

  it('calculates step points along a curved segment', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 50, y: 50 })
    const seg = addCurveSegment(net, a.id, b.id, { x: 50, y: 0 })!

    const res = getStepPointsAlongSegment(seg.id, net, 10, { x: 25, y: 5 })
    expect(res.points.length).toBeGreaterThan(0)
    expect(res.nearest).not.toBeNull()
  })

  it('handles invalid segment or zero spacing safely', () => {
    const net = createNetwork()
    const res1 = getStepPointsAlongSegment('invalid_id', net, 10, { x: 0, y: 0 })
    expect(res1.points).toEqual([])
    expect(res1.nearest).toBeNull()

    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 0 })
    const seg = addSegment(net, a.id, b.id)!
    const res2 = getStepPointsAlongSegment(seg.id, net, 0, { x: 0, y: 0 })
    expect(res2.points).toEqual([])
    expect(res2.nearest).toBeNull()
  })
})

