import { describe, it, expect } from 'vitest'
import { addCurveSegment, addNode, addSegment, createNetwork, hitNode, hitSegment, removeSegment, resetIdCounter } from '../models/network'
import { touchNetwork } from '../models/networkWatch'
import { snapToNearestTrack } from '../models/locomotive'
import { getTrackTangentAt } from './tangent'
import { NetworkFollower, networkIndex, nodesInBox, railsInBox } from './networkFollower'
import type { Network } from '../models/types'

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
    expect(follower.follow(net)).toEqual({ movedNodes: [], changedRails: [], leftNodes: [] })

    c.pos = { x: 200, y: 50 }
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
