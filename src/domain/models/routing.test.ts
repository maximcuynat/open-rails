import { describe, expect, it } from 'vitest'
import { createNetwork, addNode, addSegment, addCurveSegment, removeNode, removeSegment } from './network'
import {
  activeBranchOf,
  addJunction,
  declareTurnout,
  placeTurnout,
  removeJunction,
  setJunctionBranch,
  splitSegment,
  syncJunctions,
  toggleJunction,
  turnoutView,
  weldNodes,
} from './junction'
import { exitsOf, findJunctionAtNode, invalidateJunctionIndex, isPassageOpen, isRailClosedAt, openExit } from './routing'
import { advanceTrainSet, createVehicle, makeTrainSet, setReverser } from './train'
import { positionOnSegment } from './locomotive'
import { reconcileNetworkIntersections } from '../geometry/reconcile'
import type { Network } from './types'

/** Stem from the west to the apex at the origin, then a catalog #6 turnout: straight on east, diverging to +y */
function tangentTurnout() {
  const net = createNetwork()
  const west = addNode(net, { x: -400, y: 0 })
  const apex = addNode(net, { x: 0, y: 0 })
  const stem = addSegment(net, west.id, apex.id)!
  const t = placeTurnout(net, { startPos: apex.pos, direction: { x: 1, y: 0 }, frogNumber: 6, hand: 'left', stemNodeId: apex.id })
  const junction = t.junction!
  const view = turnoutView(net, junction)!
  return { net, west, apex, stem, t, junction, straightId: view.straightSegmentId, divergingId: view.divergingSegmentId }
}

/** Everything the tables hold, to compare two states */
function tables(net: Network) {
  return JSON.stringify([...net.junctions.values()])
}

describe('routing through a node', () => {
  it('joins the two rails of a plain node, and ends the track at a corner', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const c = addNode(net, { x: 200, y: 0 })
    const up = addNode(net, { x: 200, y: 100 })
    const ab = addSegment(net, a.id, b.id)!
    const bc = addSegment(net, b.id, c.id)!
    const corner = addSegment(net, c.id, up.id)!

    expect(openExit(net, b.id, ab.id)).toBe(bc.id)
    expect(openExit(net, b.id, bc.id)).toBe(ab.id)
    expect(openExit(net, c.id, bc.id)).toBeNull()
    expect(isPassageOpen(net, c.id, bc.id, corner.id)).toBe(false)
  })

  it('keeps each track of a crossing on its own line, down to a shallow angle', () => {
    for (const angleDeg of [90, 30, 10]) {
      const net = createNetwork()
      const centre = addNode(net, { x: 0, y: 0 })
      const r = (angleDeg * Math.PI) / 180
      const arm = (x: number, y: number) => addSegment(net, centre.id, addNode(net, { x, y }).id)!
      const w = arm(-100, 0)
      const e = arm(100, 0)
      const p = arm(100 * Math.cos(r), 100 * Math.sin(r))
      const q = arm(-100 * Math.cos(r), -100 * Math.sin(r))
      syncJunctions(net)

      expect(net.junctions.size).toBe(0)
      expect(openExit(net, centre.id, w.id)).toBe(e.id)
      expect(openExit(net, centre.id, e.id)).toBe(w.id)
      expect(openExit(net, centre.id, p.id)).toBe(q.id)
      expect(openExit(net, centre.id, q.id)).toBe(p.id)
    }
  })

  it('opens exactly the passage a turnout is set to, in both directions', () => {
    const { net, apex, stem, junction, straightId, divergingId } = tangentTurnout()

    expect(openExit(net, apex.id, stem.id)).toBe(straightId)
    expect(openExit(net, apex.id, straightId)).toBe(stem.id)
    expect(openExit(net, apex.id, divergingId)).toBeNull()
    expect(isRailClosedAt(net, divergingId, apex.id)).toBe(true)
    expect(isRailClosedAt(net, straightId, apex.id)).toBe(false)
    expect(isRailClosedAt(net, stem.id, apex.id)).toBe(false)
    // Whatever the position, both branches are possible from the stem and never from each other
    expect(exitsOf(net, apex.id, stem.id, { anyPosition: true }).sort()).toEqual([straightId, divergingId].sort())
    expect(isPassageOpen(net, apex.id, straightId, divergingId, { anyPosition: true })).toBe(false)

    toggleJunction(junction)
    expect(openExit(net, apex.id, stem.id)).toBe(divergingId)
    expect(openExit(net, apex.id, divergingId)).toBe(stem.id)
    expect(openExit(net, apex.id, straightId)).toBeNull()
    expect(isRailClosedAt(net, straightId, apex.id)).toBe(true)
  })

  it('routes through a turnout whose two branches end on the same node', () => {
    const net = createNetwork()
    const west = addNode(net, { x: -100, y: 0 })
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const stem = addSegment(net, west.id, a.id)!
    const main = addSegment(net, a.id, b.id)!
    // A loop leaving tangent to the main line and coming back on the same node
    const loop = addCurveSegment(net, a.id, b.id, { x: 50, y: 6 })!
    const [junction] = syncJunctions(net)
    const view = turnoutView(net, junction)!

    expect(view.straightSegmentId).toBe(main.id)
    expect(view.divergingSegmentId).toBe(loop.id)
    expect(openExit(net, a.id, stem.id)).toBe(main.id)
    setJunctionBranch(junction, 'diverging')
    expect(openExit(net, a.id, stem.id)).toBe(loop.id)
    expect(openExit(net, a.id, loop.id)).toBe(stem.id)
  })

  it('takes the straightest rail at a node with many rails and no table, whatever their order', () => {
    const build = (order: number[]) => {
      const net = createNetwork()
      const centre = addNode(net, { x: 0, y: 0 })
      // Two tracks crossing at 30° and a spur at right angles: no rail has two continuations
      const ends = [[-100, 0], [100, 0], [87, 50], [-87, -50], [0, 100]].map(([x, y]) => addNode(net, { x, y }))
      const segs = new Map<number, string>()
      for (const i of order) segs.set(i, addSegment(net, centre.id, ends[i].id)!.id)
      syncJunctions(net)
      return { net, centre, segs }
    }
    for (const order of [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [2, 0, 4, 1, 3]]) {
      const { net, centre, segs } = build(order)
      expect(net.junctions.size).toBe(0)
      expect(openExit(net, centre.id, segs.get(0)!)).toBe(segs.get(1))
      expect(openExit(net, centre.id, segs.get(2)!)).toBe(segs.get(3))
      expect(openExit(net, centre.id, segs.get(3)!)).toBe(segs.get(2))
      expect(openExit(net, centre.id, segs.get(4)!)).toBeNull()
    }
  })
})

describe('proposing a table from the geometry', () => {
  it('reads the same turnout whether the track crossing its points was laid before or after it', () => {
    const build = (crossingFirst: boolean) => {
      const net = createNetwork()
      const apex = addNode(net, { x: 0, y: 0 })
      const arm = (x: number, y: number) => addSegment(net, apex.id, addNode(net, { x, y }).id)!
      const crossing = () => [arm(0, 100), arm(0, -100)]
      const early = crossingFirst ? crossing() : []
      const w = arm(-100, 0)
      const e = arm(100, 0)
      const p = arm(100, 17)
      if (!crossingFirst) syncJunctions(net)
      const [n, s] = crossingFirst ? early : crossing()
      syncJunctions(net)
      const view = turnoutView(net, [...net.junctions.values()][0])!
      return {
        tables: net.junctions.size,
        roles: [view.stemSegmentId === w.id, view.straightSegmentId === e.id, view.divergingSegmentId === p.id],
        through: [openExit(net, apex.id, n.id) === s.id, openExit(net, apex.id, w.id) === e.id],
      }
    }
    expect(build(true)).toEqual(build(false))
    expect(build(true)).toEqual({ tables: 1, roles: [true, true, true], through: [true, true] })
  })

  it('settles a straight rail and a curve leaving tangent to it without looking at their order', () => {
    for (const curveFirst of [false, true]) {
      const net = createNetwork()
      const west = addNode(net, { x: -100, y: 0 })
      const a = addNode(net, { x: 0, y: 0 })
      const b = addNode(net, { x: 100, y: 0 })
      const c = addNode(net, { x: 100, y: 10 })
      const stem = addSegment(net, west.id, a.id)!
      const lay = [
        () => addSegment(net, a.id, b.id)!,
        () => addCurveSegment(net, a.id, c.id, { x: 50, y: 0 })!,
      ]
      const [first, second] = curveFirst ? [lay[1](), lay[0]()] : [lay[0](), lay[1]()]
      const straight = curveFirst ? second : first

      // Before any table exists, the default rule already takes the straight rail
      expect(openExit(net, a.id, stem.id)).toBe(straight.id)
      const [junction] = syncJunctions(net)
      expect(turnoutView(net, junction)!.straightSegmentId).toBe(straight.id)
    }
  })
})

describe('route tables stay as declared', () => {
  it('keeps roles, position and route when a rail next to a tangent turnout is cut', () => {
    for (const cut of ['straight', 'diverging', 'stem'] as const) {
      const { net, apex, stem, t, junction, straightId, divergingId } = tangentTurnout()
      setJunctionBranch(junction, 'diverging')
      const target = cut === 'straight' ? straightId : cut === 'diverging' ? divergingId : stem.id
      const far = cut === 'stem' ? { x: -200, y: 0 } : cut === 'straight' ? { x: 100, y: 0 } : t.divergingNode.pos
      const at = cut === 'diverging' ? positionOnSegment(net, divergingId, 0.5)! : far

      const pieces = splitSegment(net, target, at)!
      syncJunctions(net)

      const touching = [pieces.seg1, pieces.seg2].find((seg) => seg.from === apex.id || seg.to === apex.id)!
      const view = turnoutView(net, junction)!
      expect(net.junctions.size).toBe(1)
      expect(view.activeBranch).toBe('diverging')
      expect(view.hand).toBe('left')
      expect(view.stemSegmentId).toBe(cut === 'stem' ? touching.id : stem.id)
      expect(view.straightSegmentId).toBe(cut === 'straight' ? touching.id : straightId)
      expect(view.divergingSegmentId).toBe(cut === 'diverging' ? touching.id : divergingId)
      expect(openExit(net, apex.id, view.stemSegmentId)).toBe(view.divergingSegmentId)
    }
  })

  it('reads the same roles on a symmetric Y whatever the order of the rails at its node', () => {
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
    const roles = orders.map((order) => {
      const net = createNetwork()
      const apex = addNode(net, { x: 0, y: 0 })
      const ends = [[-100, 0], [100, 12], [100, -12]].map(([x, y]) => addNode(net, { x, y }))
      for (const i of order) addSegment(net, apex.id, ends[i].id)
      const [junction] = syncJunctions(net)
      const view = turnoutView(net, junction)!
      return [view.stemNodeId === ends[0].id, view.straightNodeId === ends[1].id ? 'up' : 'down', view.hand]
    })
    for (const r of roles) expect(r).toEqual(roles[0])
    expect(roles[0][0]).toBe(true)
  })

  it('turns a turnout into a 3-way, open on the same rail, when its stem gets a third branch', () => {
    const { net, apex, stem, junction, divergingId } = tangentTurnout()
    setJunctionBranch(junction, 'diverging')
    const third = addSegment(net, apex.id, addNode(net, { x: 200, y: -30 }).id)!

    syncJunctions(net)

    expect(net.junctions.size).toBe(1)
    const view = turnoutView(net, junction)!
    expect(view.hand).toBe('three_way')
    expect(view.divergingSegmentId).toBe(divergingId)
    expect(view.divergingRightSegmentId).toBe(third.id)
    expect(view.activeBranch).toBe('left')
    expect(openExit(net, apex.id, stem.id)).toBe(divergingId)
  })

  it('leaves a turnout alone when another track crosses its points', () => {
    const { net, apex, stem, junction, straightId, divergingId } = tangentTurnout()
    setJunctionBranch(junction, 'diverging')
    const before = tables(net)
    const north = addSegment(net, apex.id, addNode(net, { x: 0, y: 100 }).id)!
    const south = addSegment(net, apex.id, addNode(net, { x: 0, y: -100 }).id)!

    syncJunctions(net)

    expect(tables(net)).toBe(before)
    expect(openExit(net, apex.id, stem.id)).toBe(divergingId)
    expect(openExit(net, apex.id, straightId)).toBeNull()
    // The crossing track runs straight through, without access to the turnout
    expect(openExit(net, apex.id, north.id)).toBe(south.id)
    expect(openExit(net, apex.id, south.id)).toBe(north.id)
  })

  it('makes a crossing of a turnout whose diverging branch is prolonged back through the points', () => {
    const net = createNetwork()
    const apex = addNode(net, { x: 0, y: 0 })
    const arm = (x: number, y: number) => addSegment(net, apex.id, addNode(net, { x, y }).id)!
    const w = arm(-100, 0)
    const e = arm(100, 0)
    const p = arm(100, 17)
    const [junction] = syncJunctions(net)
    setJunctionBranch(junction, 'diverging')
    expect(openExit(net, apex.id, w.id)).toBe(p.id)

    const q = arm(-100, -17)
    syncJunctions(net)

    expect(net.junctions.size).toBe(0)
    expect(openExit(net, apex.id, w.id)).toBe(e.id)
    expect(openExit(net, apex.id, e.id)).toBe(w.id)
    expect(openExit(net, apex.id, q.id)).toBe(p.id)
    expect(openExit(net, apex.id, p.id)).toBe(q.id)
  })

  it('stays open on the same rail when a branch is added and then removed', () => {
    const { net, apex, stem, junction, straightId, divergingId } = tangentTurnout()
    setJunctionBranch(junction, 'diverging')
    const third = addSegment(net, apex.id, addNode(net, { x: 200, y: -30 }).id)!
    syncJunctions(net)

    removeSegment(net, third.id)
    syncJunctions(net)
    const view = turnoutView(net, junction)!
    expect(junction.kind).toBe('turnout')
    expect(view.straightSegmentId).toBe(straightId)
    expect(view.activeBranch).toBe('diverging')
    expect(openExit(net, apex.id, stem.id)).toBe(divergingId)

    // Removing the rail it is set to leaves a plain track: no device any more
    removeSegment(net, divergingId)
    syncJunctions(net)
    expect(net.junctions.size).toBe(0)
    expect(openExit(net, apex.id, stem.id)).toBe(straightId)
  })

  it('falls back to the first position when the rail a 3-way is set to is removed', () => {
    const net = createNetwork()
    const apex = addNode(net, { x: 0, y: 0 })
    const arm = (x: number, y: number) => addSegment(net, apex.id, addNode(net, { x, y }).id)!
    arm(-100, 0)
    const straight = arm(100, 0)
    const left = arm(98, 17)
    const right = arm(98, -17)
    const [junction] = syncJunctions(net)
    setJunctionBranch(junction, 'left')
    expect(turnoutView(net, junction)!.activeSegmentId).toBe(left.id)

    removeSegment(net, left.id)
    syncJunctions(net)

    const view = turnoutView(net, junction)!
    expect(view.hand).not.toBe('three_way')
    expect(view.straightSegmentId).toBe(straight.id)
    expect(view.divergingSegmentId).toBe(right.id)
    expect(view.activeBranch).toBe('straight')
  })

  it('removes the table of a node that is deleted, and never leaves two tables on one node', () => {
    const one = tangentTurnout()
    removeNode(one.net, one.apex.id)
    syncJunctions(one.net)
    expect(one.net.junctions.size).toBe(0)

    const { net, apex, stem, junction } = tangentTurnout()
    // A second turnout whose apex is then welded onto the first
    const west2 = addNode(net, { x: -400, y: 5 })
    const apex2 = addNode(net, { x: 0, y: 5 })
    const stem2 = addSegment(net, west2.id, apex2.id)!
    const s2 = addSegment(net, apex2.id, addNode(net, { x: 200, y: 5 }).id)!
    const d2 = addSegment(net, apex2.id, addNode(net, { x: 200, y: 30 }).id)!
    addJunction(net, { nodeId: apex2.id, straightSegmentId: s2.id, divergingSegmentId: d2.id })
    expect(net.junctions.size).toBe(2)

    weldNodes(net, apex.id, apex2.id)

    // The node that stays keeps its own table; the other one does not come along as a second one
    expect([...net.junctions.values()]).toEqual([junction])
    expect(turnoutView(net, junction)!.stemSegmentId).toBe(stem.id)
    expect(net.segments.has(stem2.id)).toBe(true)

    // What is left is two tracks through one node, each with a fork: no longer a turnout
    syncJunctions(net)
    expect(net.junctions.size).toBe(0)
  })

  it('removes the table when its two branches become one rail', () => {
    const net = createNetwork()
    const apex = addNode(net, { x: 0, y: 0 })
    const west = addNode(net, { x: -100, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const c = addNode(net, { x: 100, y: 12 })
    const stem = addSegment(net, west.id, apex.id)!
    const main = addSegment(net, apex.id, b.id)!
    addSegment(net, apex.id, c.id)
    const [junction] = syncJunctions(net)
    setJunctionBranch(junction, 'diverging')

    // The end of the branch is dropped onto the end of the main line
    c.pos = { ...b.pos }
    reconcileNetworkIntersections(net)

    expect(net.adjacency.get(apex.id)).toHaveLength(2)
    expect(net.junctions.size).toBe(0)
    expect(openExit(net, apex.id, stem.id)).toBe(main.id)
  })

  it('leaves no turnout on a T whose spur was swung through the main line and back', () => {
    const net = createNetwork()
    const apex = addNode(net, { x: 0, y: 0 })
    const arm = (x: number, y: number) => addSegment(net, apex.id, addNode(net, { x, y }).id)!
    const w = arm(-100, 0)
    const e = arm(100, 0)
    const spur = arm(0, 100)
    const spurEnd = net.nodes.get(spur.to)!
    syncJunctions(net)
    expect(net.junctions.size).toBe(0)

    spurEnd.pos = { x: 100, y: 10 }
    const [junction] = syncJunctions(net)
    setJunctionBranch(junction, 'diverging')
    spurEnd.pos = { x: 0, y: 100 }
    syncJunctions(net)

    expect(net.junctions.size).toBe(0)
    expect(openExit(net, apex.id, w.id)).toBe(e.id)
    expect(openExit(net, apex.id, e.id)).toBe(w.id)
  })

  it('reads the roles again when a 3-way loses its middle branch', () => {
    const net = createNetwork()
    const apex = addNode(net, { x: 0, y: 0 })
    const arm = (x: number, y: number) => addSegment(net, apex.id, addNode(net, { x, y }).id)!
    arm(-100, 0)
    const middle = arm(100, 0)
    const left = arm(98, 17)
    const right = arm(98, -8)
    const [junction] = syncJunctions(net)
    setJunctionBranch(junction, 'left')

    removeSegment(net, middle.id)
    syncJunctions(net)

    const view = turnoutView(net, junction)!
    // The branch closer to the axis is the straight one; the points still lead to the same rail
    expect(view.straightSegmentId).toBe(right.id)
    expect(view.divergingSegmentId).toBe(left.id)
    expect(view.hand).toBe('left')
    expect(view.activeSegmentId).toBe(left.id)
  })

  it('changes nothing when it runs again', () => {
    const { net, apex, junction } = tangentTurnout()
    setJunctionBranch(junction, 'diverging')
    addSegment(net, apex.id, addNode(net, { x: 200, y: -30 }).id)
    syncJunctions(net)
    const once = tables(net)
    syncJunctions(net)
    syncJunctions(net)
    expect(tables(net)).toBe(once)
    expect(activeBranchOf(junction)).toBe('left')
  })

  it('does not move a train standing across a turnout when a rail next to it is cut', () => {
    const { net, stem, junction, straightId } = tangentTurnout()
    setJunctionBranch(junction, 'diverging')
    // Lead bogie on the stem 12 m before the points, nose to the west: the rest of the train lies
    // behind it, through the points and onto the diverging branch
    const lead = createVehicle(net, stem.id, 0.97, 'loco', -1)!
    const train = makeTrainSet('T', [lead])
    for (let i = 0; i < 3; i++) {
      train.vehicles.push({ id: `w${i}`, kind: 'wagon', front: { ...lead.rear }, rear: { ...lead.rear } })
    }
    expect(advanceTrainSet(net, train, 0)).toBe(true)
    const bogies = () =>
      train.vehicles.flatMap((v) => [positionOnSegment(net, v.front.segId, v.front.t)!, positionOnSegment(net, v.rear.segId, v.rear.t)!])
    const before = bogies()
    expect(before.some((p) => p.y > 0.5)).toBe(true)

    splitSegment(net, straightId, { x: 100, y: 0 })
    syncJunctions(net)
    expect(advanceTrainSet(net, train, 0)).toBe(true)
    bogies().forEach((p, i) => expect(Math.hypot(p.x - before[i].x, p.y - before[i].y)).toBeLessThan(1e-6))

    // Backing up 3 m takes it 3 m further along the branch it is on, not onto the other one
    expect(setReverser(train, 'reverse')).toBe(true)
    expect(advanceTrainSet(net, train, 3)).toBe(true)
    bogies().forEach((p, i) => expect(Math.hypot(p.x - before[i].x, p.y - before[i].y)).toBeLessThan(3.1))
  })
})

describe('finding the table of a node', () => {
  /** The answer of a plain reading of the tables, in order */
  const scan = (net: Network, nodeId: string) => [...net.junctions.values()].find((j) => j.nodeId === nodeId)

  const expectSameAsScan = (net: Network) => {
    for (const nodeId of net.nodes.keys()) expect(findJunctionAtNode(net, nodeId)).toBe(scan(net, nodeId))
  }

  /** Two turnouts along a line: a ─ b ─ c ─ d, a branch leaving b and another leaving c */
  function twoTurnouts() {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 30, y: 0 })
    const c = addNode(net, { x: 60, y: 0 })
    const d = addNode(net, { x: 90, y: 0 })
    const ab = addSegment(net, a.id, b.id)!
    const bc = addSegment(net, b.id, c.id)!
    const cd = addSegment(net, c.id, d.id)!
    const e = addNode(net, { x: 60, y: 3 })
    const f = addNode(net, { x: 90, y: 3 })
    const be = addSegment(net, b.id, e.id)!
    const cf = addSegment(net, c.id, f.id)!
    const atB = declareTurnout(net, { nodeId: b.id, stemSegmentId: ab.id, straightSegmentId: bc.id, divergingSegmentId: be.id })
    const atC = declareTurnout(net, { nodeId: c.id, stemSegmentId: bc.id, straightSegmentId: cd.id, divergingSegmentId: cf.id })
    return { net, a, b, c, d, e, f, ab, bc, cd, be, cf, atB, atC }
  }

  it('gives the table of each node, and nothing for the others', () => {
    const { net, a, b, c, atB, atC } = twoTurnouts()
    expect(findJunctionAtNode(net, b.id)).toBe(atB)
    expect(findJunctionAtNode(net, c.id)).toBe(atC)
    expect(findJunctionAtNode(net, a.id)).toBeUndefined()
    expect(findJunctionAtNode(net, 'n_missing')).toBeUndefined()
    expectSameAsScan(net)
  })

  it('follows a table declared, declared again and removed', () => {
    const { net, b, c, ab, bc, be, atB } = twoTurnouts()
    expect(findJunctionAtNode(net, b.id)).toBe(atB)

    removeJunction(net, atB.id)
    expect(findJunctionAtNode(net, b.id)).toBeUndefined()
    expectSameAsScan(net)

    const again = declareTurnout(net, { nodeId: b.id, stemSegmentId: ab.id, straightSegmentId: bc.id, divergingSegmentId: be.id })
    expect(findJunctionAtNode(net, b.id)).toBe(again)

    // Declared a second time on the same node: the new table replaces the old one under the same id
    const replaced = declareTurnout(net, { nodeId: b.id, stemSegmentId: ab.id, straightSegmentId: be.id, divergingSegmentId: bc.id })
    expect(replaced.id).toBe(again.id)
    expect(findJunctionAtNode(net, b.id)).toBe(replaced)
    expect(findJunctionAtNode(net, c.id)).toBe(scan(net, c.id))
  })

  it('follows the tables through syncJunctions', () => {
    const { net, b, c, be } = twoTurnouts()
    expect(findJunctionAtNode(net, b.id)).toBeDefined()

    // The branch of the first turnout goes: its table goes with it
    removeSegment(net, be.id)
    syncJunctions(net)
    expect(findJunctionAtNode(net, b.id)).toBeUndefined()
    expect(findJunctionAtNode(net, c.id)).toBeDefined()
    expectSameAsScan(net)

    // A new fork gets a table
    const g = addNode(net, { x: 60, y: -3 })
    addSegment(net, b.id, g.id)
    syncJunctions(net)
    expect(findJunctionAtNode(net, b.id)).toBeDefined()
    expectSameAsScan(net)
  })

  it('sees a table written or removed straight in the map', () => {
    const { net, a, b, c, ab, atB, atC } = twoTurnouts()
    expect(findJunctionAtNode(net, a.id)).toBeUndefined()

    net.junctions.delete(atB.id)
    expect(findJunctionAtNode(net, b.id)).toBeUndefined()

    net.junctions.set('j_direct', { id: 'j_direct', nodeId: a.id, kind: 'turnout', passages: [{ a: ab.id, b: ab.id }], positions: [[0]], active: 0 })
    expect(findJunctionAtNode(net, a.id)).toBe(net.junctions.get('j_direct'))

    // Replaced under the same id: the number of tables does not change, the table does
    const other = { ...atC, passages: [...atC.passages] }
    net.junctions.set(atC.id, other)
    expect(findJunctionAtNode(net, c.id)).toBe(other)

    net.junctions.clear()
    expectSameAsScan(net)
  })

  it('sees a table moved to another node in place', () => {
    const { net, a, b, atB } = twoTurnouts()
    expect(findJunctionAtNode(net, b.id)).toBe(atB)
    expect(findJunctionAtNode(net, a.id)).toBeUndefined()

    atB.nodeId = a.id
    // Found gone from the node it was on without being told
    expect(findJunctionAtNode(net, b.id)).toBeUndefined()
    expect(findJunctionAtNode(net, a.id)).toBe(atB)

    // One table goes while another appears elsewhere: only a call tells the index
    net.junctions.delete(atB.id)
    net.junctions.set('j_other', { ...atB, id: 'j_other', nodeId: b.id })
    invalidateJunctionIndex(net)
    expectSameAsScan(net)
  })

  it('gives the first table when a node has two', () => {
    const { net, b, atB } = twoTurnouts()
    net.junctions.set('j_twin', { ...atB, id: 'j_twin' })
    expect(findJunctionAtNode(net, b.id)).toBe(atB)
    net.junctions.delete(atB.id)
    expect(findJunctionAtNode(net, b.id)).toBe(net.junctions.get('j_twin'))
  })

  it('follows the table of a node merged into another', () => {
    const { net, b, e, atB } = twoTurnouts()
    expect(findJunctionAtNode(net, b.id)).toBe(atB)
    // A node apart, then b is merged into it: the table follows its rails there
    const keep = addNode(net, { x: 30, y: 0.01 })
    expect(findJunctionAtNode(net, keep.id)).toBeUndefined()
    weldNodes(net, keep.id, b.id)
    expect(findJunctionAtNode(net, keep.id)).toBe(atB)
    expect(findJunctionAtNode(net, b.id)).toBeUndefined()
    expect(findJunctionAtNode(net, e.id)).toBeUndefined()
    expectSameAsScan(net)
  })

  it('keeps separate networks apart', () => {
    const one = twoTurnouts()
    const two = twoTurnouts()
    expect(findJunctionAtNode(one.net, one.b.id)).toBe(one.atB)
    expect(findJunctionAtNode(two.net, two.b.id)).toBe(two.atB)
    expect(findJunctionAtNode(two.net, one.b.id)).toBeUndefined()
  })
})
