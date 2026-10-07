import { describe, it, expect } from 'vitest'
import { addCurveSegment, addNode, addPathSegment, addSegment, createNetwork, hitNode, hitSegment, removeSegment, resetIdCounter } from '../models/network'
import { pathAt, pathOf, pieceEnd } from './railPath'
import { reconcileNetworkIntersections } from './reconcile'
import { serializeNetwork } from '../../infrastructure/persistence/persistence'
import type { PathPiece } from '../models/types'
import { touchNetwork } from '../models/networkWatch'
import { snapToNearestTrack } from '../models/locomotive'
import { getTrackTangentAt } from './tangent'
import { NetworkFollower, anyChange, dirtyNodesOf, networkChangesSince, networkIndex, nodesInBox, railsInBox } from './networkFollower'
import { railMeasures } from './railMeasures'
import { segmentShapeLength } from './segmentGeometry'
import { declareTurnout, toggleJunction } from '../models/junction'
import type { Network, RailNode } from '../models/types'

/** Deterministic pseudo-random numbers in [0, 1) */
function randomSource(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/** Short rails scattered over a square, one in three curved, some on a bridge */
function scatter(seed: number, rails: number, span: number): Network {
  const random = randomSource(seed)
  const net = createNetwork()
  for (let i = 0; i < rails; i++) {
    const x = random() * span
    const y = random() * span
    const level = random() < 0.1 ? 1 : 0
    const a = addNode(net, { x, y }, level)
    const b = addNode(net, { x: x + (random() - 0.5) * 60, y: y + (random() - 0.5) * 60 }, level)
    if (i % 3 === 0) addCurveSegment(net, a.id, b.id, { x: x + (random() - 0.5) * 40, y: y + (random() - 0.5) * 40 })
    else addSegment(net, a.id, b.id)
  }
  return net
}

/** The same network without its revision: everything that reads it goes from end to end */
const plain = (net: Network): Network => ({ ...net })

describe('NetworkFollower', () => {
  it('tells what changed between two looks: nothing, then a node moved with its rails, then a rail gone', () => {
    resetIdCounter(0)
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const c = addNode(net, { x: 200, y: 0 })
    const ab = addSegment(net, a.id, b.id)!
    const bc = addSegment(net, b.id, c.id)!
    const follower = new NetworkFollower()

    const first = follower.follow(net)
    expect(first.movedNodes).toEqual([a.id, b.id, c.id])
    expect(first.changedRails).toEqual([ab.id, bc.id])
    expect(follower.follow(net)).toEqual({ movedNodes: [], changedRails: [], leftNodes: [], removedNodes: [], removedRails: [], structure: false, reorderedRails: [], changedTables: [] })

    c.pos = { x: 200, y: 50 }
    touchNetwork(net, c.id)
    const moved = follower.follow(net)
    expect(moved.movedNodes).toEqual([c.id])
    expect(moved.changedRails).toEqual([bc.id])
    expect(follower.railGrid.atPoint(200, 50)).toContain(bc.id)
    expect(follower.rails.get(bc.id)!.box).toEqual({ minX: 100, maxX: 200, minY: 0, maxY: 50 })

    removeSegment(net, ab.id)
    const gone = follower.follow(net)
    expect(gone.leftNodes).toEqual(expect.arrayContaining([a.id, b.id]))
    expect(follower.rails.has(ab.id)).toBe(false)
    expect(follower.railGrid.atPoint(50, 0)).not.toContain(ab.id)
  })

  it('keeps finding everything as the network grows past the size its grid was made for', () => {
    resetIdCounter(0)
    const net = createNetwork()
    const follower = new NetworkFollower()
    follower.follow(net)
    const ids: string[] = []
    for (let i = 0; i < 400; i++) {
      const a = addNode(net, { x: i * 10, y: 0 })
      const b = addNode(net, { x: i * 10 + 8, y: 3 })
      ids.push(addSegment(net, a.id, b.id)!.id)
      if (i % 50 === 0) follower.follow(net)
    }
    follower.follow(net)
    for (let i = 0; i < 400; i += 7) expect(follower.railGrid.atPoint(i * 10 + 4, 1)).toContain(ids[i])
    expect(follower.nodeGrid.size).toBe(800)
  })
})

describe('reading a network through its index', () => {
  it('is only done for a network that has a revision', () => {
    const net = scatter(1, 10, 100)
    expect(networkIndex(net)).not.toBeNull()
    expect(networkIndex(plain(net))).toBeNull()
  })

  it('finds what a look at every node and rail finds, in the same order', () => {
    const net = scatter(5, 600, 2000)
    const random = randomSource(9)
    for (let q = 0; q < 60; q++) {
      const x = random() * 2000
      const y = random() * 2000
      const w = random() * 400
      const box = { minX: x, minY: y, maxX: x + w, maxY: y + w * random() }
      expect(railsInBox(net, box)).toEqual(railsInBox(plain(net), box))
      expect(nodesInBox(net, box)).toEqual(nodesInBox(plain(net), box))
    }
    // Most of the network, and all of it
    const wide = { minX: -100, minY: -100, maxX: 1500, maxY: 2500 }
    expect(railsInBox(net, wide)).toEqual(railsInBox(plain(net), wide))
    expect(railsInBox(net, { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 })).toHaveLength(net.segments.size)
  })

  it('gives the same node, rail, nearest track and tangent as without it — before and after edits', () => {
    const net = scatter(11, 800, 1500)
    const random = randomSource(21)
    const check = (): number => {
      let hits = 0
      const nodes = [...net.nodes.values()]
      for (let q = 0; q < 150; q++) {
        // Half the points near a node, where there is something to find
        const near = nodes[Math.floor(random() * nodes.length)].pos
        const p = q % 2 === 0
          ? { x: near.x + (random() - 0.5) * 6, y: near.y + (random() - 0.5) * 6 }
          : { x: random() * 1500, y: random() * 1500 }
        const reach = 0.5 + random() * 8
        const node = hitNode(net, p, reach)
        const rail = hitSegment(net, p, reach)
        expect(node).toBe(hitNode(plain(net), p, reach))
        expect(rail).toBe(hitSegment(plain(net), p, reach))
        expect(snapToNearestTrack(net, p, reach)).toEqual(snapToNearestTrack(plain(net), p, reach))
        expect(getTrackTangentAt(net, p, reach)).toEqual(getTrackTangentAt(plain(net), p, reach))
        if (node || rail) hits++
      }
      // No limit: every rail is looked at either way
      expect(snapToNearestTrack(net, { x: 700, y: 700 })).toEqual(snapToNearestTrack(plain(net), { x: 700, y: 700 }))
      return hits
    }
    expect(check()).toBeGreaterThan(40)

    const nodes = [...net.nodes.values()]
    const segs = [...net.segments.values()]
    for (let i = 0; i < 40; i++) {
      const node = nodes[Math.floor(random() * nodes.length)]
      node.pos.x += (random() - 0.5) * 200
      node.pos.y += (random() - 0.5) * 200
    }
    touchNetwork(net)
    for (let i = 0; i < 40; i++) removeSegment(net, segs[Math.floor(random() * segs.length)].id)
    const a = addNode(net, { x: 10, y: 10 }, 1)
    const b = addNode(net, { x: 1400, y: 1300 }, 1)
    addSegment(net, a.id, b.id)
    expect(check()).toBeGreaterThan(40)
  })
})

/** A long rail from (x, y): 100 m straight, then 300 m of a curve of 150 m radius — far off the line between its two nodes */
function longRailPieces(x: number, y: number): PathPiece[] {
  const first: PathPiece = { x, y, heading: 0, curvature: 0, length: 100 }
  const turn = pieceEnd(first)
  return [first, { x: turn.x, y: turn.y, heading: turn.heading, curvature: 1 / 150, length: 300 }]
}

describe('long rails through the index', () => {
  /** Short rails all around, and a few long rails among them */
  const withLongRails = (): { net: Network; onTheCurve: { x: number; y: number }[] } => {
    const net = scatter(31, 500, 3000)
    const onTheCurve: { x: number; y: number }[] = []
    for (let i = 0; i < 4; i++) {
      const pieces = longRailPieces(400 + i * 600, 5000 + i * 37)
      const end = pieceEnd(pieces[1])
      const a = addNode(net, { x: pieces[0].x, y: pieces[0].y })
      const b = addNode(net, { x: end.x, y: end.y })
      addPathSegment(net, a.id, b.id, pieces)
      const middle = pathAt(pathOf(pieces), 260)
      onTheCurve.push({ x: middle.x, y: middle.y })
    }
    return { net, onTheCurve }
  }

  it('finds a long rail from a point of its curve, far from the line between its nodes', () => {
    const { net, onTheCurve } = withLongRails()
    for (const p of onTheCurve) {
      const near = { x: p.x + 0.3, y: p.y - 0.2 }
      const hit = hitSegment(net, near, 2)
      expect(hit).not.toBeNull()
      expect(net.segments.get(hit!)!.kind).toBe('path')
      expect(hit).toBe(hitSegment(plain(net), near, 2))
      expect(snapToNearestTrack(net, near, 2)).toEqual(snapToNearestTrack(plain(net), near, 2))
      expect(railsInBox(net, { minX: p.x - 1, minY: p.y - 1, maxX: p.x + 1, maxY: p.y + 1 })).toEqual(
        railsInBox(plain(net), { minX: p.x - 1, minY: p.y - 1, maxX: p.x + 1, maxY: p.y + 1 }),
      )
    }
  })

  it('a node laid on the curve of a long rail cuts it, from the kept state as with every pair looked at', () => {
    const build = (): Network => {
      resetIdCounter(0)
      const { net, onTheCurve } = withLongRails()
      reconcileNetworkIntersections(net, 0.1)
      // A track that ends on the curve of the first long rail
      const end = addNode(net, { x: onTheCurve[0].x, y: onTheCurve[0].y })
      const far = addNode(net, { x: onTheCurve[0].x + 40, y: onTheCurve[0].y + 90 })
      addSegment(net, end.id, far.id)
      return net
    }
    const kept = build()
    const keptResult = reconcileNetworkIntersections(kept, 0.1)
    const exhaustive = build()
    // The first pass of `build` was made from the kept state on both: this one tells the two apart
    const exhaustiveResult = reconcileNetworkIntersections(exhaustive, 0.1, true)
    expect(keptResult).toEqual(exhaustiveResult)
    expect(keptResult.splitCount).toBe(1)
    expect(serializeNetwork(kept, 'x')).toEqual(serializeNetwork(exhaustive, 'x'))
  })
})

describe('what the follower tells beyond the geometry', () => {
  /** A stem, a set of points, a straight and a diverging rail */
  function fork() {
    resetIdCounter(0)
    const net = createNetwork()
    const stem = addNode(net, { x: 0, y: 0 })
    const points = addNode(net, { x: 50, y: 0 })
    const straight = addNode(net, { x: 100, y: 0 })
    const branch = addNode(net, { x: 100, y: 6 })
    const s0 = addSegment(net, stem.id, points.id)!
    const s1 = addSegment(net, points.id, straight.id)!
    const s2 = addSegment(net, points.id, branch.id)!
    return { net, stem, points, straight, branch, s0, s1, s2 }
  }

  it('a node moved is not a change of structure; a rail laid, taken out or re-ended is', () => {
    const { net, straight, branch, s1, s2 } = fork()
    const follower = new NetworkFollower()
    expect(follower.follow(net).structure).toBe(true)
    straight.pos = { x: 110, y: 0 }
    touchNetwork(net, straight.id)
    expect(follower.follow(net).structure).toBe(false)
    const more = addSegment(net, straight.id, branch.id)!
    expect(follower.follow(net).structure).toBe(true)
    removeSegment(net, more.id)
    expect(follower.follow(net).structure).toBe(true)
    s1.to = branch.id
    s2.to = straight.id
    touchNetwork(net, s1.id)
    touchNetwork(net, s2.id)
    expect(follower.follow(net).structure).toBe(true)
    expect(follower.follow(net).structure).toBe(false)
  })

  it('tells the rails that are no longer in the order they were', () => {
    const { net, s0, s1 } = fork()
    const follower = new NetworkFollower()
    follower.follow(net)
    // s1 put back at the end: it is out of sequence with s2, which is told with it
    net.segments.delete(s1.id)
    net.segments.set(s1.id, s1)
    const changes = follower.follow(net)
    expect(changes.structure).toBe(true)
    // Read through the journal, the rail put back alone; read whole, the one it passed as well
    expect(changes.reorderedRails).toContain(s1.id)
    expect(changes.changedRails).toEqual([])
    expect(follower.follow(net).reorderedRails).toEqual([])
    // A rail taken out leaves the order of the others as it was
    net.segments.delete(s0.id)
    expect(follower.follow(net).reorderedRails).toEqual([])
  })

  it('tells the nodes whose route table came, was thrown, moved or went', () => {
    const { net, points, straight, s0, s1, s2 } = fork()
    const follower = new NetworkFollower()
    expect(follower.follow(net).changedTables).toEqual([])
    const junction = declareTurnout(net, { nodeId: points.id, stemSegmentId: s0.id, straightSegmentId: s1.id, divergingSegmentId: s2.id })!
    expect(follower.follow(net).changedTables).toEqual([points.id])
    expect(follower.follow(net).changedTables).toEqual([])
    toggleJunction(junction)
    expect(follower.follow(net).changedTables).toEqual([points.id])
    junction.nodeId = straight.id
    expect(follower.follow(net).changedTables.sort()).toEqual([points.id, straight.id].sort())
    net.junctions.delete(junction.id)
    expect(follower.follow(net).changedTables).toEqual([straight.id])
  })
})

describe('the feed of changes of a network', () => {
  it('gives each reader what changed since its own cursor, as one', () => {
    const { net, points, straight, branch, s2 } = (() => {
      resetIdCounter(0)
      const net = createNetwork()
      const stem = addNode(net, { x: 0, y: 0 })
      const points = addNode(net, { x: 50, y: 0 })
      const straight = addNode(net, { x: 100, y: 0 })
      const branch = addNode(net, { x: 100, y: 6 })
      addSegment(net, stem.id, points.id)
      addSegment(net, points.id, straight.id)
      const s2 = addSegment(net, points.id, branch.id)!
      return { net, points, straight, branch, s2 }
    })()
    // A reader without cursor starts from the network
    const first = networkChangesSince(net, undefined)!
    expect(first.changes).toBeNull()
    // Nothing changed: nothing to tell, the cursor stays
    const again = networkChangesSince(net, first.cursor)!
    expect(again.changes).toEqual({ movedNodes: [], changedRails: [], leftNodes: [], removedNodes: [], removedRails: [], structure: false, reorderedRails: [], changedTables: [] })
    expect(again.cursor).toBe(first.cursor)

    straight.pos = { x: 110, y: 0 }
    touchNetwork(net)
    const other = networkChangesSince(net, undefined)!
    const moved = networkChangesSince(net, first.cursor)!
    expect(moved.changes!.movedNodes).toEqual([straight.id])
    expect(moved.changes!.structure).toBe(false)

    // Two passes later, a reader behind gets both as one; the one up to date gets the last
    const rail = addSegment(net, straight.id, branch.id)!
    networkChangesSince(net, moved.cursor)
    branch.pos = { x: 100, y: 10 }
    touchNetwork(net)
    const both = networkChangesSince(net, moved.cursor)!
    expect(both.changes!.changedRails.sort()).toEqual([rail.id, s2.id].sort())
    expect(both.changes!.movedNodes).toEqual([branch.id])
    expect(both.changes!.structure).toBe(true)
    const last = networkChangesSince(net, other.cursor)!
    expect(last.changes!.structure).toBe(true)
    expect(dirtyNodesOf(both.changes!, both.index)).toEqual(new Set([straight.id, branch.id, points.id]))
  })

  it('leaves behind a reader that waited more passes than it keeps, or more entries than the network holds', () => {
    const net = scatter(3, 30, 300)
    const start = networkChangesSince(net, undefined)!
    const nodes = [...net.nodes.values()]
    for (let i = 0; i < 70; i++) {
      const node = nodes[i % nodes.length]
      node.pos = { x: node.pos.x + 1, y: node.pos.y }
      touchNetwork(net)
      networkIndex(net)
    }
    expect(networkChangesSince(net, start.cursor)!.changes).toBeNull()
    // Few passes, but more changed than the network holds
    const fresh = networkChangesSince(net, undefined)!
    for (let i = 0; i < 3; i++) {
      for (const node of net.nodes.values()) node.pos = { x: node.pos.x + 1, y: node.pos.y }
      touchNetwork(net)
      networkIndex(net)
    }
    expect(networkChangesSince(net, fresh.cursor)!.changes).toBeNull()
    // A network without revision is compared at every reading
    const bare = plain(net)
    const once = networkChangesSince(bare, undefined)
    expect(once.changes).toBeNull()
    expect(anyChange(networkChangesSince(bare, once.cursor).changes!)).toBe(false)
    const node = [...bare.nodes.values()][0]
    node.pos = { x: node.pos.x + 1, y: node.pos.y }
    expect(networkChangesSince(bare, once.cursor).changes!.movedNodes).toEqual([node.id])
  })
})

describe('rail measures', () => {
  it('give the length of every rail, measured once, and again when the rail changed', () => {
    const net = scatter(5, 40, 400)
    const measures = railMeasures(net)
    for (const seg of net.segments.values()) expect(measures.shapeLength(seg)).toBe(segmentShapeLength(net, seg))
    const seg = [...net.segments.values()][4]
    const node = net.nodes.get(seg.to)!
    node.pos = { x: node.pos.x + 20, y: node.pos.y + 20 }
    touchNetwork(net)
    expect(railMeasures(net).shapeLength(seg)).toBe(segmentShapeLength(net, seg))
    // Without revision: compared each time, right as well
    const bare = plain(net)
    expect(railMeasures(bare).shapeLength(seg)).toBe(segmentShapeLength(bare, seg))
    node.pos = { x: node.pos.x + 5, y: node.pos.y }
    expect(railMeasures(bare).shapeLength(seg)).toBe(segmentShapeLength(bare, seg))
  })
})

describe('following a network through its journal', () => {
  it('tells the same changes as a look at the whole network, edit after edit, with the records in order', () => {
    const net = scatter(11, 120, 600)
    const random = randomSource(7)
    const byJournal = new NetworkFollower()
    byJournal.follow(net)
    const nodes = (): RailNode[] => [...net.nodes.values()]
    const rails = () => [...net.segments.values()]
    for (let step = 0; step < 80; step++) {
      const whole = new NetworkFollower()
      whole.follow(net)
      const kind = random()
      if (kind < 0.4) {
        const node = nodes()[Math.floor(random() * net.nodes.size)]
        node.pos = { x: node.pos.x + 3, y: node.pos.y - 2 }
        touchNetwork(net, node.id)
      } else if (kind < 0.55) {
        const a = nodes()[Math.floor(random() * net.nodes.size)]
        const b = nodes()[Math.floor(random() * net.nodes.size)]
        if (a !== b) addSegment(net, a.id, b.id)
      } else if (kind < 0.7) {
        removeSegment(net, rails()[Math.floor(random() * net.segments.size)].id)
      } else if (kind < 0.8) {
        // A rail put back at the end of the network
        const seg = rails()[Math.floor(random() * net.segments.size)]
        net.segments.delete(seg.id)
        net.segments.set(seg.id, seg)
      } else if (kind < 0.9) {
        const seg = rails().find((s) => s.via)!
        seg.via = { x: seg.via!.x + 1, y: seg.via!.y }
        touchNetwork(net, seg.id)
      } else {
        const node = nodes()[Math.floor(random() * net.nodes.size)]
        node.level = (node.level ?? 0) + 1
        touchNetwork(net, node.id)
      }
      const told = byJournal.follow(net)
      const seen = whole.follow(net)
      // The same nodes and rails told (a rail put back: the journal names it alone, the whole look names its neighbour too)
      expect([...told.movedNodes].sort()).toEqual([...seen.movedNodes].sort())
      expect([...told.changedRails].sort()).toEqual([...seen.changedRails].sort())
      expect([...told.removedRails].sort()).toEqual([...seen.removedRails].sort())
      expect(told.structure).toBe(seen.structure)
      for (const id of seen.reorderedRails) if (!told.reorderedRails.includes(id)) expect(told.reorderedRails.length).toBeGreaterThan(0)
      // The records read through the journal are those of the network, in its order (checked by the test setup too)
      let ord = -1
      for (const node of net.nodes.values()) {
        const rec = byJournal.nodes.get(node.id)!
        expect(rec.ord).toBeGreaterThan(ord)
        ord = rec.ord
      }
      expect(railsInBox(net, { minX: 100, minY: 100, maxX: 300, maxY: 300 }).map((s) => s.id)).toEqual(
        railsInBox(plain(net), { minX: 100, minY: 100, maxX: 300, maxY: 300 }).map((s) => s.id),
      )
    }
  })
})
