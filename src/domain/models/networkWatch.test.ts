import { afterEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, removeSegment } from './network'
import { networkChanged, networkCheckToken, networkJournal, touchNetwork, verifyNetworkRevisions } from './networkWatch'
import { trackGeometryRevision } from './trackSpeed'
import { networkDerived } from '@infrastructure/render/networkDerived'
import { declareTurnout, toggleJunction } from './junction'
import type { Network } from './types'

function line() {
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 100, y: 0 })
  const seg = addSegment(net, a.id, b.id)!
  return { net, a, b, seg }
}

// The suite runs with the revisions checked (see `src/testSetup.ts`); some tests here turn the check off
afterEach(() => verifyNetworkRevisions(true))

describe('the revision of a network', () => {
  it('moves when a node or a rail is added or removed', () => {
    const { net, seg } = line()
    const first = networkCheckToken(net)!
    expect(networkCheckToken(net)).toBe(first)
    const c = addNode(net, { x: 200, y: 0 })
    const second = networkCheckToken(net)!
    expect(second).toBeGreaterThan(first)
    removeSegment(net, seg.id)
    expect(networkCheckToken(net)).toBeGreaterThan(second)
    expect(net.nodes.has(c.id)).toBe(true)
  })

  it('moves when a change made in place is told', () => {
    const { net, b } = line()
    const before = networkCheckToken(net)!
    b.pos.x = 120
    touchNetwork(net)
    expect(networkCheckToken(net)).toBeGreaterThan(before)
    const then = networkCheckToken(net)!
    networkChanged()
    expect(networkCheckToken(net)).toBeGreaterThan(then)
  })

  it('is not known for a network put together by hand: compared every time', () => {
    const { net: made, b } = line()
    const net: Network = { ...made }
    expect(networkCheckToken(net)).toBeUndefined()
    const before = trackGeometryRevision(net)
    b.pos.x = 120
    expect(trackGeometryRevision(net)).toBe(before + 1)
  })

  it('unchanged: what is kept of the network is not compared again', () => {
    verifyNetworkRevisions(false)
    const { net, b } = line()
    const before = trackGeometryRevision(net)
    const derived = networkDerived(net)

    // Moved without a word: not seen, which is what the revision is trusted for
    b.pos.x = 120
    expect(trackGeometryRevision(net)).toBe(before)
    expect(networkDerived(net)).toBe(derived)

    touchNetwork(net)
    expect(trackGeometryRevision(net)).toBe(before + 1)
    expect(networkDerived(net)).not.toBe(derived)
  })

  it('checked in the tests: a change made in place without a word throws', () => {
    const { net, b } = line()
    networkCheckToken(net)
    b.pos.x = 120
    expect(() => networkCheckToken(net)).toThrow(/without touchNetwork/)
  })

  it('a revision that moved without a change leaves what is kept alone', () => {
    const { net } = line()
    const before = trackGeometryRevision(net)
    const derived = networkDerived(net)
    touchNetwork(net)
    expect(trackGeometryRevision(net)).toBe(before)
    expect(networkDerived(net)).toBe(derived)
  })

  it('points thrown are seen at once', () => {
    const net = createNetwork()
    const stem = addNode(net, { x: 0, y: 0 })
    const points = addNode(net, { x: 50, y: 0 })
    const straight = addNode(net, { x: 100, y: 0 })
    const branch = addNode(net, { x: 100, y: 6 })
    const s0 = addSegment(net, stem.id, points.id)!
    const s1 = addSegment(net, points.id, straight.id)!
    const s2 = addSegment(net, points.id, branch.id)!
    const junction = declareTurnout(net, { nodeId: points.id, stemSegmentId: s0.id, straightSegmentId: s1.id, divergingSegmentId: s2.id })!
    const derived = networkDerived(net)
    expect(networkDerived(net)).toBe(derived)

    toggleJunction(junction)
    expect(networkDerived(net)).not.toBe(derived)
  })
})

describe('the journal of a network', () => {
  it('says what moved the revision: the key put or taken out of which map, the id touched, or nothing known', () => {
    const net = createNetwork()
    const start = networkJournal(net, 0)!
    expect(start.entries).toEqual([])
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 10, y: 0 })
    const rail = addSegment(net, a.id, b.id)!
    const since = networkJournal(net, 0)!
    expect(since.entries!.map((e) => `${e.op} ${e.map} ${e.id}`)).toEqual([
      `set nodes ${a.id}`, `set adjacency ${a.id}`,
      `set nodes ${b.id}`, `set adjacency ${b.id}`,
      `set segments ${rail.id}`,
    ])
    a.pos = { x: 1, y: 0 }
    touchNetwork(net, a.id)
    touchNetwork(net, null)
    touchNetwork(net)
    const touched = networkJournal(net, since.value)!
    expect(touched.entries).toEqual([
      { op: 'touch', map: null, id: a.id },
      { op: 'touch', map: 'junctions', id: null },
      { op: 'touch', map: null, id: null },
    ])
    // A count ahead of the network, or from before what is kept, has no entries to give
    expect(networkJournal(net, touched.value + 1)!.entries).toBeNull()
    expect(networkJournal(net, touched.value)!.entries).toEqual([])
    // A network without revision has no journal
    expect(networkJournal({ ...net }, 0)).toBeNull()
  })

  it('drops its oldest half past its size: a reader that far behind reads the whole network', () => {
    const net = createNetwork()
    const node = addNode(net, { x: 0, y: 0 })
    const first = networkJournal(net, 0)!.value
    for (let i = 0; i < 5000; i++) touchNetwork(net, node.id)
    const now = networkJournal(net, first)!
    expect(now.entries).toBeNull()
    expect(networkJournal(net, now.value - 100)!.entries).toHaveLength(100)
  })
})
