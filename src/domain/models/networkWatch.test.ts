import { describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork } from './network'
import { holdNetwork, networkChanged, networkCheckToken, releaseNetwork } from './networkWatch'
import { trackGeometryRevision } from './trackSpeed'
import { networkDerived } from '@infrastructure/render/networkDerived'
import { declareTurnout, toggleJunction } from './junction'

function line() {
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 100, y: 0 })
  addSegment(net, a.id, b.id)
  return { net, a, b }
}

describe('a network held while it is driven on', () => {
  it('is compared every time while it is not held', () => {
    const { net, b } = line()
    expect(networkCheckToken(net)).toBeUndefined()
    const before = trackGeometryRevision(net)
    b.pos.x = 120
    expect(trackGeometryRevision(net)).toBe(before + 1)
  })

  it('held: the comparison is trusted until the network is said to have changed', () => {
    const { net, b } = line()
    holdNetwork(net)
    const before = trackGeometryRevision(net)
    const derived = networkDerived(net)

    // Moved behind its back: not seen, which is the point — nothing moves a node while driving
    b.pos.x = 120
    expect(trackGeometryRevision(net)).toBe(before)
    expect(networkDerived(net)).toBe(derived)

    // Any notification of the editor says so, and the change is found
    networkChanged()
    expect(trackGeometryRevision(net)).toBe(before + 1)
    expect(networkDerived(net)).not.toBe(derived)
  })

  it('released: compared every time again', () => {
    const { net, b } = line()
    holdNetwork(net)
    const before = trackGeometryRevision(net)
    releaseNetwork(net)
    b.pos.x = 130
    expect(trackGeometryRevision(net)).toBe(before + 1)
  })

  it('points thrown are seen at once, without a notification', () => {
    const net = createNetwork()
    const stem = addNode(net, { x: 0, y: 0 })
    const points = addNode(net, { x: 50, y: 0 })
    const straight = addNode(net, { x: 100, y: 0 })
    const branch = addNode(net, { x: 100, y: 6 })
    const s0 = addSegment(net, stem.id, points.id)!
    const s1 = addSegment(net, points.id, straight.id)!
    const s2 = addSegment(net, points.id, branch.id)!
    const junction = declareTurnout(net, { nodeId: points.id, stemSegmentId: s0.id, straightSegmentId: s1.id, divergingSegmentId: s2.id })!
    holdNetwork(net)
    const derived = networkDerived(net)
    expect(networkDerived(net)).toBe(derived)

    toggleJunction(junction)
    expect(networkDerived(net)).not.toBe(derived)
  })
})
