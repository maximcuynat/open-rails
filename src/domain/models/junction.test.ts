import { describe, expect, it } from 'vitest'
import { createNetwork, addNode, addSegment, addCurveSegment } from './network'
import { MAX_TRANSITION_DEFLECTION_DEG } from '../geometry/tangent'
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
  turnoutHandFlipSegments,
  activeBranchOf,
  turnoutView,
} from './junction'
import { openExit } from './routing'

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
    const stem = addNode(net, { x: -100, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    const straight = addNode(net, { x: 246, y: 0 })
    const div = addNode(net, { x: 240, y: 40 })
    addSegment(net, stem.id, apex.id)
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
    expect(activeBranchOf(junc)).toBe('straight')

    toggleJunction(junc)
    expect(activeBranchOf(junc)).toBe('diverging')

    toggleJunction(junc)
    expect(activeBranchOf(junc)).toBe('straight')

    setJunctionBranch(junc, 'diverging')
    expect(activeBranchOf(junc)).toBe('diverging')

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
    const stem = addNode(net, { x: -100, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    const stemSeg = addSegment(net, stem.id, apex.id)!
    const res = placeTurnout(net, {
      startPos: apex.pos,
      direction: { x: 1, y: 0 },
      frogNumber: 6,
      hand: 'left',
      stemNodeId: apex.id,
    })

    expect(res.straightNode.pos.x).toBeCloseTo(246, 1)
    expect(res.straightNode.pos.y).toBeCloseTo(0, 1)
    // Diverging curve turns left (positive y)
    expect(res.divergingNode.pos.y).toBeGreaterThan(0)
    expect(net.segments.size).toBe(3)
    expect(net.nodes.size).toBe(4)
    expect(net.junctions.size).toBe(1)
    const view = turnoutView(net, res.junction)!
    expect(view.stemSegmentId).toBe(stemSeg.id)
    expect(view.straightNodeId).toBe(res.straightNode.id)
    expect(view.divergingNodeId).toBe(res.divergingNode.id)
    expect(view.hand).toBe('left')
    expect(view.frogNumber).toBe(6)
  })

  it('declares nothing when the apex has no rail to be the stem', () => {
    const net = createNetwork()
    const res = placeTurnout(net, { startPos: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, frogNumber: 6, hand: 'left' })
    expect(res.junction).toBeNull()
    expect(net.segments.size).toBe(2)
    expect(net.junctions.size).toBe(0)
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
    const stem = addNode(net, { x: -100, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    addSegment(net, stem.id, apex.id)
    const res = placeTurnout(net, {
      startPos: apex.pos,
      direction: { x: 1, y: 0 },
      frogNumber: 6,
      hand: 'left',
      stemNodeId: apex.id,
    })
    const junction = res.junction!

    const initialY = res.divergingNode.pos.y
    expect(initialY).toBeGreaterThan(0) // left side (positive y in our math)
    expect(turnoutView(net, junction)!.hand).toBe('left')

    toggleTurnoutHand(net, junction.id)
    expect(turnoutView(net, junction)!.hand).toBe('right')
    expect(res.divergingNode.pos.y).toBeCloseTo(-initialY, 1)

    toggleTurnoutHand(net, junction.id)
    expect(turnoutView(net, junction)!.hand).toBe('left')
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
    expect(turnoutView(net, junc)!.stemNodeId).toBe(stem.id)
    expect(turnoutView(net, junc)!.straightNodeId).toBe(straight.id)
    expect(turnoutView(net, junc)!.divergingNodeId).toBe(div.id)
    expect(turnoutView(net, junc)!.hand).toBe('left')
    expect(activeBranchOf(junc)).toBe('straight')
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
    expect(turnoutView(net, detected[0])!.hand).toBe('right')
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

  it('gives no table to two rails forking without a stem, and a turnout once the stem is laid', () => {
    const net = createNetwork()
    const apex = addNode(net, { x: 0, y: 0 })
    const straight = addNode(net, { x: 246, y: 0 })
    const div = addNode(net, { x: 240, y: 40 })

    addSegment(net, apex.id, straight.id)
    addSegment(net, apex.id, div.id)

    // 1. No stem: no train can pass from one branch to the other, there is nothing to choose
    expect(autoDetectJunctions(net)).toHaveLength(0)

    // 2. Add stem from left
    const stem = addNode(net, { x: -100, y: 0 })
    addSegment(net, stem.id, apex.id)

    const upgraded = autoDetectJunctions(net)
    expect(upgraded.length).toBe(1)
    expect(turnoutView(net, upgraded[0])!.stemNodeId).toBe(stem.id)
    expect(turnoutView(net, upgraded[0])!.straightNodeId).toBe(straight.id)
    expect(turnoutView(net, upgraded[0])!.hand).toBe('left')
  })

  it('detects a 3-way turnout with 1 stem and 3 diverging branches and cycles branches', () => {
    const net = createNetwork()
    const stem = addNode(net, { x: -100, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    const straight = addNode(net, { x: 100, y: 0 })
    const left = addNode(net, { x: 98, y: 17 })
    const right = addNode(net, { x: 98, y: -17 })

    addSegment(net, stem.id, apex.id)
    const sStraight = addSegment(net, apex.id, straight.id)!
    const sLeft = addSegment(net, apex.id, left.id)!
    const sRight = addSegment(net, apex.id, right.id)!

    const detected = autoDetectJunctions(net)
    expect(detected.length).toBe(1)
    const junc = detected[0]
    expect(turnoutView(net, junc)!.hand).toBe('three_way')
    expect(junc.nodeId).toBe(apex.id)
    expect(turnoutView(net, junc)!.stemNodeId).toBe(stem.id)
    expect(turnoutView(net, junc)!.straightNodeId).toBe(straight.id)
    expect(turnoutView(net, junc)!.divergingNodeId).toBe(left.id)
    expect(turnoutView(net, junc)!.divergingRightNodeId).toBe(right.id)

    // findJunctionBySegment works for all 3 branches
    expect(findJunctionBySegment(net, sStraight.id)?.id).toBe(junc.id)
    expect(findJunctionBySegment(net, sLeft.id)?.id).toBe(junc.id)
    expect(findJunctionBySegment(net, sRight.id)?.id).toBe(junc.id)

    // Branch toggling cycles: straight -> left -> right -> straight
    expect(activeBranchOf(junc)).toBe('straight')
    expect(toggleJunction(junc)).toBe('left')
    expect(activeBranchOf(junc)).toBe('left')
    expect(toggleJunction(junc)).toBe('right')
    expect(activeBranchOf(junc)).toBe('right')
    expect(toggleJunction(junc)).toBe('straight')
    expect(activeBranchOf(junc)).toBe('straight')
  })

  it('gives no table to three rails fanning out without a stem, and a 3-way once the stem is laid', () => {
    const net = createNetwork()
    const apex = addNode(net, { x: 0, y: 0 })
    const straight = addNode(net, { x: 100, y: 0 })
    const left = addNode(net, { x: 98, y: 17 })
    const right = addNode(net, { x: 98, y: -17 })

    addSegment(net, apex.id, straight.id)
    addSegment(net, apex.id, left.id)
    addSegment(net, apex.id, right.id)

    expect(autoDetectJunctions(net)).toHaveLength(0)

    const stem = addNode(net, { x: -100, y: 0 })
    addSegment(net, stem.id, apex.id)

    const upgraded = autoDetectJunctions(net)
    expect(upgraded.length).toBe(1)
    const view = turnoutView(net, upgraded[0])!
    expect(view.hand).toBe('three_way')
    expect(view.stemNodeId).toBe(stem.id)
    expect(view.straightNodeId).toBe(straight.id)
    expect(view.divergingNodeId).toBe(left.id)
    expect(view.divergingRightNodeId).toBe(right.id)
  })
})

describe('autoDetectJunctions and the transition deflection limit', () => {
  /** Main line west–east through the origin, plus a rail leaving the origin at `angleDeg` */
  function mainLineWithBranch(angleDeg: number) {
    const net = createNetwork()
    const west = addNode(net, { x: -200, y: 0 })
    const mid = addNode(net, { x: 0, y: 0 })
    const east = addNode(net, { x: 200, y: 0 })
    const r = (angleDeg * Math.PI) / 180
    const end = addNode(net, { x: 200 * Math.cos(r), y: 200 * Math.sin(r) })
    addSegment(net, west.id, mid.id)
    addSegment(net, mid.id, east.id)
    addSegment(net, mid.id, end.id)
    return net
  }

  it('does not register a turnout on a perpendicular T', () => {
    const net = mainLineWithBranch(90)
    expect(autoDetectJunctions(net)).toHaveLength(0)
    expect(net.junctions.size).toBe(0)
  })

  it('registers a branch up to the limit and none beyond it', () => {
    expect(autoDetectJunctions(mainLineWithBranch(10))).toHaveLength(1)
    expect(autoDetectJunctions(mainLineWithBranch(MAX_TRANSITION_DEFLECTION_DEG))).toHaveLength(1)
    expect(autoDetectJunctions(mainLineWithBranch(MAX_TRANSITION_DEFLECTION_DEG + 1))).toHaveLength(0)
    expect(autoDetectJunctions(mainLineWithBranch(45))).toHaveLength(0)
  })

  it('drops a junction whose branch is bent into a corner, whatever it was set to', () => {
    const net = mainLineWithBranch(10)
    const [junc] = autoDetectJunctions(net)
    setJunctionBranch(junc, 'diverging')
    const view = turnoutView(net, junc)!
    const branchEnd = [...net.nodes.values()][3]
    branchEnd.pos = { x: 0, y: 200 }
    autoDetectJunctions(net)
    expect(net.junctions.size).toBe(0)
    // The main line is a plain track again
    expect(openExit(net, junc.nodeId, view.stemSegmentId)).toBe(view.straightSegmentId)
  })

  it('still detects the catalog turnouts, whose diverging branch leaves tangent to the stem', () => {
    for (const frogNumber of [4, 6] as const) {
      for (const hand of ['left', 'right'] as const) {
        const net = createNetwork()
        const stem = addNode(net, { x: -300, y: 0 })
        const apex = addNode(net, { x: 0, y: 0 })
        addSegment(net, stem.id, apex.id)
        const t = placeTurnout(net, { startPos: apex.pos, direction: { x: 1, y: 0 }, frogNumber, hand, stemNodeId: apex.id })
        net.junctions.clear()

        const detected = autoDetectJunctions(net)
        expect(detected).toHaveLength(1)
        expect(detected[0].nodeId).toBe(apex.id)
        expect(turnoutView(net, detected[0])!.stemNodeId).toBe(stem.id)
        expect(turnoutView(net, detected[0])!.divergingNodeId).toBe(t.divergingNode.id)
        expect(turnoutView(net, detected[0])!.straightNodeId).toBe(t.straightNode.id)
      }
    }
  })
})

describe('turnoutHandFlipSegments', () => {
  it('names exactly the rails whose geometry toggleTurnoutHand changes', () => {
    for (const frogNumber of [4, 6] as const) {
      const net = createNetwork()
      const stem = addNode(net, { x: -300, y: 0 })
      const apex = addNode(net, { x: 0, y: 0 })
      addSegment(net, stem.id, apex.id)
      const t = placeTurnout(net, { startPos: apex.pos, direction: { x: 1, y: 0 }, frogNumber, hand: 'left', stemNodeId: apex.id })
      // Extensions of both branches, a spur off the end of the diverging one, and a rail further on
      const sEnd = addNode(net, { x: t.straightNode.pos.x + 200, y: 0 })
      addSegment(net, t.straightNode.id, sEnd.id)
      const dEnd = addNode(net, { x: t.divergingNode.pos.x + 200, y: t.divergingNode.pos.y + 60 })
      addCurveSegment(net, t.divergingNode.id, dEnd.id, { x: t.divergingNode.pos.x + 100, y: t.divergingNode.pos.y + 20 })
      const spur = addNode(net, { x: t.divergingNode.pos.x + 150, y: t.divergingNode.pos.y + 90 })
      addSegment(net, t.divergingNode.id, spur.id)
      const beyond = addNode(net, { x: dEnd.pos.x + 200, y: dEnd.pos.y + 80 })
      addSegment(net, dEnd.id, beyond.id)

      const shape = () =>
        new Map([...net.segments.values()].map((s) => [s.id, JSON.stringify([net.nodes.get(s.from)!.pos, s.via ?? null, net.nodes.get(s.to)!.pos])]))
      const before = shape()
      const named = turnoutHandFlipSegments(net, t.junction!)

      expect(toggleTurnoutHand(net, t.junction!.id)).toBe(true)

      const after = shape()
      const changed = [...before.keys()].filter((id) => before.get(id) !== after.get(id))
      expect([...named].sort()).toEqual(changed.sort())
      expect(changed).toHaveLength(3)
    }
  })
})
