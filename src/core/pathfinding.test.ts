import { describe, expect, it } from 'vitest'
import { createNetwork, addNode, addSegment } from './network'
import { placeTurnout, toggleJunction } from './junction'
import {
  findPath,
  reachableFrom,
  detectDeadEnds,
  detectLoops,
  detectConnectedComponents,
  segmentLength,
} from './pathfinding'

describe('segmentLength', () => {
  it('calculates straight segment length', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 300, y: 400 })
    const s = addSegment(net, a.id, b.id)!
    expect(segmentLength(net, s)).toBeCloseTo(500, 1)
  })
})

describe('findPath with junction constraints', () => {
  it('finds path through straight switch when set to straight', () => {
    const net = createNetwork()
    // Stem -> Apex -> Straight and Diverging
    const stem = addNode(net, { x: -100, y: 0 })
    const res = placeTurnout(net, {
      startPos: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      frogNumber: 6,
      hand: 'left',
    })
    addSegment(net, stem.id, res.apexNode.id)
    res.junction.stemNodeId = stem.id

    // Straight branch is active by default
    const straightPath = findPath(net, stem.id, res.straightNode.id)
    expect(straightPath.found).toBe(true)
    expect(straightPath.nodes).toEqual([stem.id, res.apexNode.id, res.straightNode.id])

    // Diverging path should NOT be found while switch is straight
    const divPath = findPath(net, stem.id, res.divergingNode.id)
    expect(divPath.found).toBe(false)

    // Now toggle junction to diverging
    toggleJunction(res.junction)
    const straightPath2 = findPath(net, stem.id, res.straightNode.id)
    expect(straightPath2.found).toBe(false)

    const divPath2 = findPath(net, stem.id, res.divergingNode.id)
    expect(divPath2.found).toBe(true)
    expect(divPath2.nodes).toEqual([stem.id, res.apexNode.id, res.divergingNode.id])
  })

  it('can ignore switch orientation if respectSwitches is false', () => {
    const net = createNetwork()
    const stem = addNode(net, { x: -100, y: 0 })
    const res = placeTurnout(net, {
      startPos: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      frogNumber: 6,
      hand: 'left',
    })
    addSegment(net, stem.id, res.apexNode.id)
    res.junction.stemNodeId = stem.id

    // Switch is set to straight, but we allow traversing diverging
    const divPath = findPath(net, stem.id, res.divergingNode.id, { respectSwitches: false })
    expect(divPath.found).toBe(true)
  })

  it('returns found: false when target is unreachable', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const isolated = addNode(net, { x: 500, y: 500 })
    addSegment(net, a.id, b.id)

    const path = findPath(net, a.id, isolated.id)
    expect(path.found).toBe(false)
  })
})

describe('reachableFrom', () => {
  it('returns reachable nodes and segments according to switch settings', () => {
    const net = createNetwork()
    const stem = addNode(net, { x: -100, y: 0 })
    const res = placeTurnout(net, {
      startPos: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      frogNumber: 6,
      hand: 'left',
    })
    addSegment(net, stem.id, res.apexNode.id)
    res.junction.stemNodeId = stem.id

    const reachable = reachableFrom(net, stem.id)
    expect(reachable.nodes.has(res.straightNode.id)).toBe(true)
    expect(reachable.nodes.has(res.divergingNode.id)).toBe(false)

    // Toggle switch
    toggleJunction(res.junction)
    const reachable2 = reachableFrom(net, stem.id)
    expect(reachable2.nodes.has(res.straightNode.id)).toBe(false)
    expect(reachable2.nodes.has(res.divergingNode.id)).toBe(true)
  })
})

describe('detectDeadEnds', () => {
  it('identifies nodes with degree 1 as dead ends', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    const n3 = addNode(net, { x: 200, y: 0 })
    addSegment(net, n1.id, n2.id)
    addSegment(net, n2.id, n3.id)

    const deadEnds = detectDeadEnds(net)
    expect(deadEnds).toContain(n1.id)
    expect(deadEnds).toContain(n3.id)
    expect(deadEnds).not.toContain(n2.id)
  })
})

describe('detectLoops', () => {
  it('detects a closed triangle / loop in track network', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const c = addNode(net, { x: 50, y: 50 })
    addSegment(net, a.id, b.id)
    addSegment(net, b.id, c.id)
    addSegment(net, c.id, a.id)

    const loops = detectLoops(net)
    expect(loops.length).toBeGreaterThanOrEqual(1)
  })

  it('detects no loops in a tree / line layout', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const c = addNode(net, { x: 200, y: 0 })
    addSegment(net, a.id, b.id)
    addSegment(net, b.id, c.id)

    const loops = detectLoops(net)
    expect(loops.length).toBe(0)
  })
})

describe('detectConnectedComponents', () => {
  it('detects separate connected components (orphan networks)', () => {
    const net = createNetwork()
    // First track
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    addSegment(net, a.id, b.id)

    // Second isolated track
    const c = addNode(net, { x: 500, y: 500 })
    const d = addNode(net, { x: 600, y: 500 })
    addSegment(net, c.id, d.id)

    const comps = detectConnectedComponents(net)
    expect(comps.length).toBe(2)
  })
})
