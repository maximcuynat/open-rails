import { beforeEach, describe, expect, it } from 'vitest'
import { addCurveSegment, addNode, addSegment, createNetwork, gradientRamps, resetIdCounter, segmentGradient } from './network'
import type { Network, RailNode, Segment } from './types'
import { networkChanged } from '@domain/models/networkWatch'

beforeEach(() => resetIdCounter(0))

/** Nodes along y = 0 at the given x, with their heights in levels, joined by straight rails */
function line(points: [x: number, level: number][]): { net: Network; nodes: RailNode[]; rails: Segment[] } {
  const net = createNetwork()
  const nodes = points.map(([x, level]) => {
    const node = addNode(net, { x, y: 0 })
    if (level !== 0) node.level = level
    networkChanged()
    return node
  })
  const rails = nodes.slice(1).map((node, i) => addSegment(net, nodes[i].id, node.id)!)
  return { net, nodes, rails }
}

describe('gradientRamps', () => {
  it('a level network has no ramp', () => {
    const { net } = line([[0, 0], [100, 0], [200, 0]])
    expect(gradientRamps(net, 6)).toEqual([])
    const raised = line([[0, 1], [100, 1]])
    expect(gradientRamps(raised.net, 6)).toEqual([])
  })

  it('one rail climbing is one ramp, from its low end to its high end', () => {
    const { net, nodes, rails } = line([[0, 0], [200, 1]])
    const [ramp] = gradientRamps(net, 6)
    expect(ramp.gradient).toBeCloseTo(30, 9)
    expect(ramp.length).toBeCloseTo(200, 9)
    expect(ramp.footNode).toBe(nodes[0].id)
    expect(ramp.topNode).toBe(nodes[1].id)
    expect(ramp.rails).toEqual([{ segId: rails[0].id, climbsForward: true, offset: 0, length: 200 }])
  })

  it('the way up does not depend on the way the rail runs', () => {
    const net = createNetwork()
    const high = addNode(net, { x: 0, y: 0 })
    high.level = 1
    networkChanged()
    const low = addNode(net, { x: 200, y: 0 })
    const rail = addSegment(net, high.id, low.id)!
    expect(segmentGradient(net, rail, 6)).toBeCloseTo(-30, 9)
    const [ramp] = gradientRamps(net, 6)
    expect(ramp.gradient).toBeCloseTo(30, 9)
    expect(ramp.footNode).toBe(low.id)
    expect(ramp.topNode).toBe(high.id)
    expect(ramp.rails[0].climbsForward).toBe(false)
  })

  it('rails that follow each other on the same slope are one ramp, in order from the foot', () => {
    // Laid from the top down, and the middle rail the other way round
    const net = createNetwork()
    const levels = [1.5, 1, 0.5, 0]
    const nodes = levels.map((level, i) => {
      const node = addNode(net, { x: i * 100, y: 0 })
      node.level = level
      networkChanged()
      return node
    })
    const a = addSegment(net, nodes[0].id, nodes[1].id)!
    const b = addSegment(net, nodes[2].id, nodes[1].id)!
    const c = addSegment(net, nodes[2].id, nodes[3].id)!
    const ramps = gradientRamps(net, 6)
    expect(ramps).toHaveLength(1)
    const [ramp] = ramps
    expect(ramp.gradient).toBeCloseTo(30, 9)
    expect(ramp.length).toBeCloseTo(300, 9)
    expect(ramp.footNode).toBe(nodes[3].id)
    expect(ramp.topNode).toBe(nodes[0].id)
    expect(ramp.rails).toEqual([
      { segId: c.id, climbsForward: false, offset: 0, length: 100 },
      { segId: b.id, climbsForward: true, offset: 100, length: 100 },
      { segId: a.id, climbsForward: false, offset: 200, length: 100 },
    ])
  })

  it('a change of slope, a summit and a level rail each end a ramp', () => {
    // 30 ‰ then 60 ‰, a summit, 30 ‰ down, level, 30 ‰ down again
    const { net, rails } = line([[0, 0], [200, 1], [300, 2], [500, 1], [600, 1], [800, 0]])
    const ramps = gradientRamps(net, 6)
    expect(ramps.map((ramp) => ramp.rails.map((rail) => rail.segId))).toEqual([[rails[0].id], [rails[1].id], [rails[2].id], [rails[4].id]])
    expect(ramps.map((ramp) => Math.round(ramp.gradient))).toEqual([30, 60, 30, 30])
    expect(ramps[2].rails[0].climbsForward).toBe(false)
  })

  it('a fork ends a ramp', () => {
    const { net, nodes, rails } = line([[0, 0], [100, 0.5], [200, 1]])
    const side = addNode(net, { x: 200, y: 30 })
    side.level = 1
    networkChanged()
    addSegment(net, nodes[1].id, side.id)
    const ramps = gradientRamps(net, 6)
    expect(ramps).toHaveLength(3)
    expect(ramps.find((ramp) => ramp.rails[0].segId === rails[0].id)!.rails).toHaveLength(1)
  })

  it('a curved rail is measured along its length', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 100 })
    b.level = 1
    networkChanged()
    addCurveSegment(net, a.id, b.id, { x: 100, y: 0 })
    const [ramp] = gradientRamps(net, 6)
    expect(ramp.length).toBeGreaterThan(141.4)
    expect(ramp.length).toBeLessThan(200)
    expect(ramp.gradient).toBeCloseTo((6 / ramp.length) * 1000, 9)
  })

  it('follows the height of one level, whatever the scale of the project', () => {
    const { net } = line([[0, 0], [2, 1]])
    // HO: one level is 6 m / 87
    expect(gradientRamps(net, 6 / 87)[0].gradient).toBeCloseTo((6 / 87 / 2) * 1000, 9)
  })
})
