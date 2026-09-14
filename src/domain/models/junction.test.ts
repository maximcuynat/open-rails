import { describe, expect, it } from 'vitest'
import { createNetwork, addNode, addSegment, addCurveSegment } from './network'
import {
  TURNOUT_SPECS,
  addJunction,
  removeJunction,
  toggleJunction,
  setJunctionBranch,
  findJunctionAtNode,
  findJunctionBySegment,
  autoDetectJunctions,
  placeTurnout,
  splitSegment,
  weldNodes,
  toggleTurnoutHand,
} from './junction'

describe('TURNOUT_SPECS', () => {
  it('defines #6 and #4 Kato turnout specs', () => {
    expect(TURNOUT_SPECS[6].straightLength).toBe(246)
    expect(TURNOUT_SPECS[6].divergingRadius).toBe(867)
    expect(TURNOUT_SPECS[6].divergingAngle).toBe(10)

    expect(TURNOUT_SPECS[4].straightLength).toBe(123)
    expect(TURNOUT_SPECS[4].divergingRadius).toBe(490)
    expect(TURNOUT_SPECS[4].divergingAngle).toBe(15)
  })
})

describe('addJunction and toggling', () => {
  it('registers and toggles active branch', () => {
    const net = createNetwork()
    const apex = addNode(net, { x: 0, y: 0 })
    const straight = addNode(net, { x: 246, y: 0 })
    const div = addNode(net, { x: 240, y: 40 })
    const s1 = addSegment(net, apex.id, straight.id)!
    const s2 = addSegment(net, apex.id, div.id)!

    const junc = addJunction(net, {
      nodeId: apex.id,
      straightNodeId: straight.id,
      divergingNodeId: div.id,
      straightSegmentId: s1.id,
      divergingSegmentId: s2.id,
      hand: 'right',
      frogNumber: 6,
    })

    expect(net.junctions.size).toBe(1)
    expect(junc.activeBranch).toBe('straight')

    toggleJunction(junc)
    expect(junc.activeBranch).toBe('diverging')

    toggleJunction(junc)
    expect(junc.activeBranch).toBe('straight')

    setJunctionBranch(junc, 'diverging')
    expect(junc.activeBranch).toBe('diverging')

    expect(findJunctionAtNode(net, apex.id)).toBe(junc)
    expect(findJunctionBySegment(net, s1.id)).toBe(junc)
    expect(findJunctionBySegment(net, s2.id)).toBe(junc)

    removeJunction(net, junc.id)
    expect(net.junctions.size).toBe(0)
  })
})

describe('placeTurnout', () => {
  it('places a Kato #6 turnout with straight and curved branches', () => {
    const net = createNetwork()
    const res = placeTurnout(net, {
      startPos: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      frogNumber: 6,
      hand: 'left',
    })

    expect(res.junction).toBeDefined()
    expect(res.straightNode.pos.x).toBeCloseTo(246, 1)
    expect(res.straightNode.pos.y).toBeCloseTo(0, 1)
    // Diverging curve turns left (positive y)
    expect(res.divergingNode.pos.y).toBeGreaterThan(0)
    expect(net.segments.size).toBe(2)
    expect(net.nodes.size).toBe(3)
    expect(net.junctions.size).toBe(1)
  })
})

describe('splitSegment', () => {
  it('splits a straight segment into two sub-segments', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const s = addSegment(net, a.id, b.id)!

    const res = splitSegment(net, s.id, { x: 40, y: 0 })
    expect(res).not.toBeNull()
    expect(net.segments.size).toBe(2)
    expect(net.nodes.size).toBe(3)
    expect(res!.midNode.pos.x).toBe(40)
  })

  it('splits a curved segment using de Casteljau subdivision', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 100 })
    const via = { x: 100, y: 0 }
    const s = addCurveSegment(net, a.id, b.id, via)!

    const res = splitSegment(net, s.id, { x: 50, y: 50 })
    expect(res).not.toBeNull()
    expect(net.segments.size).toBe(2)
    expect(net.nodes.size).toBe(3)
    expect(res!.seg1.kind).toBe('curve')
    expect(res!.seg2.kind).toBe('curve')
    expect(res!.seg1.via).toBeDefined()
    expect(res!.seg2.via).toBeDefined()
  })
})

describe('weldNodes and toggleTurnoutHand', () => {
  it('welds two nodes into one and rewires segments and junctions', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 50, y: 0 })
    const n3 = addNode(net, { x: 100, y: 0 })
    addSegment(net, n1.id, n2.id)
    addSegment(net, n2.id, n3.id)

    expect(net.nodes.size).toBe(3)
    const welded = weldNodes(net, n1.id, n2.id)
    expect(welded).toBe(true)
    expect(net.nodes.size).toBe(2)
    expect(net.nodes.has(n2.id)).toBe(false)
    // The segment between n1 and n2 was deleted, leaving segment n1 to n3
    expect(net.segments.size).toBe(1)
    const remainingSeg = Array.from(net.segments.values())[0]
    expect(remainingSeg.from).toBe(n1.id)
    expect(remainingSeg.to).toBe(n3.id)
  })

  it('toggles turnout hand left to right by mirroring diverging branch', () => {
    const net = createNetwork()
    const res = placeTurnout(net, {
      startPos: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      frogNumber: 6,
      hand: 'left',
    })

    const initialY = res.divergingNode.pos.y
    expect(initialY).toBeGreaterThan(0) // left side (positive y in our math)

    toggleTurnoutHand(net, res.junction.id)
    expect(res.junction.hand).toBe('right')
    expect(res.divergingNode.pos.y).toBeCloseTo(-initialY, 1)

    toggleTurnoutHand(net, res.junction.id)
    expect(res.junction.hand).toBe('left')
    expect(res.divergingNode.pos.y).toBeCloseTo(initialY, 1)
  })
})

describe('autoDetectJunctions', () => {
  it('automatically detects a 3-way node as a left-hand turnout', () => {
    const net = createNetwork()
    const stem = addNode(net, { x: -100, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    const straight = addNode(net, { x: 246, y: 0 })
    const div = addNode(net, { x: 240, y: 40 })

    addSegment(net, stem.id, apex.id)
    addSegment(net, apex.id, straight.id)
    addSegment(net, apex.id, div.id)

    expect(net.junctions.size).toBe(0)

    const detected = autoDetectJunctions(net)
    expect(detected.length).toBe(1)
    expect(net.junctions.size).toBe(1)

    const junc = detected[0]
    expect(junc.nodeId).toBe(apex.id)
    expect(junc.stemNodeId).toBe(stem.id)
    expect(junc.straightNodeId).toBe(straight.id)
    expect(junc.divergingNodeId).toBe(div.id)
    expect(junc.hand).toBe('left')
    expect(junc.activeBranch).toBe('straight')
  })

  it('detects a right-hand turnout correctly', () => {
    const net = createNetwork()
    const stem = addNode(net, { x: -100, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    const straight = addNode(net, { x: 246, y: 0 })
    const div = addNode(net, { x: 240, y: -40 })

    addSegment(net, stem.id, apex.id)
    addSegment(net, apex.id, straight.id)
    addSegment(net, apex.id, div.id)

    const detected = autoDetectJunctions(net)
    expect(detected.length).toBe(1)
    expect(detected[0].hand).toBe('right')
  })

  it('removes the junction when degree drops below 3', () => {
    const net = createNetwork()
    const stem = addNode(net, { x: -100, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    const straight = addNode(net, { x: 246, y: 0 })
    const div = addNode(net, { x: 240, y: 40 })

    addSegment(net, stem.id, apex.id)
    addSegment(net, apex.id, straight.id)
    const s3 = addSegment(net, apex.id, div.id)!

    autoDetectJunctions(net)
    expect(net.junctions.size).toBe(1)

    // Remove the diverging segment
    net.segments.delete(s3.id)
    const adj = net.adjacency.get(apex.id)!
    const idx = adj.indexOf(s3.id)
    if (idx >= 0) adj.splice(idx, 1)

    const detected = autoDetectJunctions(net)
    expect(detected.length).toBe(0)
    expect(net.junctions.size).toBe(0)
  })
})

