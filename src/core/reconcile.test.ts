import { describe, it, expect } from 'vitest'
import { createNetwork, addNode, addSegment, addCurveSegment } from './network'
import { reconcileNetworkIntersections } from './reconcile'
import { deserializeNetwork } from './persistence'

describe('Network Topology Reconciler', () => {
  it('splits straight segment at an intermediate node and creates a turnout', () => {
    const net = createNetwork()
    // Main straight track: n1 (0, 0) -> n2 (200, 0)
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 200, y: 0 })
    addSegment(net, n1.id, n2.id)

    // Branch track: n3 (100, 0) -> n4 (150, 50)
    // n3 lies exactly on the segment between n1 and n2
    const n3 = addNode(net, { x: 100, y: 0 })
    const n4 = addNode(net, { x: 150, y: 50 })
    addSegment(net, n3.id, n4.id)

    expect(net.adjacency.get(n3.id)?.length).toBe(1)
    expect(net.junctions.size).toBe(0)

    const res = reconcileNetworkIntersections(net)
    expect(res.splitCount).toBe(1)
    expect(net.adjacency.get(n3.id)?.length).toBe(3)
    expect(net.junctions.size).toBe(1)

    const junc = Array.from(net.junctions.values())[0]
    expect(junc).toBeDefined()
    expect(junc?.nodeId).toBe(n3.id)
  })

  it('splits curve segment at an intermediate node using De Casteljau subdivision', () => {
    const net = createNetwork()
    // 90-degree curve from (0, 100) to (100, 0) with via (0, 0)
    const n1 = addNode(net, { x: 0, y: 100 })
    const n2 = addNode(net, { x: 100, y: 0 })
    const via = { x: 0, y: 0 }
    const curveSeg = addCurveSegment(net, n1.id, n2.id, via)!

    // Midpoint of quadratic bezier at t=0.5:
    // B(0.5) = 0.25*(0,100) + 0.5*(0,0) + 0.25*(100,0) = (25, 25)
    const nMid = addNode(net, { x: 25, y: 25 })
    const nBranch = addNode(net, { x: 80, y: 80 })
    addSegment(net, nMid.id, nBranch.id)

    expect(net.adjacency.get(nMid.id)?.length).toBe(1)

    const res = reconcileNetworkIntersections(net)
    expect(res.splitCount).toBe(1)
    expect(net.adjacency.get(nMid.id)?.length).toBe(3)
    expect(net.segments.has(curveSeg.id)).toBe(false)
  })

  it('welds close nodes together within tolerance', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    addSegment(net, n1.id, n2.id)

    // n3 is 0.5mm away from n2, connected to n4
    const n3 = addNode(net, { x: 100.5, y: 0.2 })
    const n4 = addNode(net, { x: 200, y: 0 })
    addSegment(net, n3.id, n4.id)

    expect(net.nodes.size).toBe(4)

    const res = reconcileNetworkIntersections(net, 2.0)
    expect(res.weldedCount).toBe(1)
    expect(net.nodes.size).toBe(3)
    const keptId = net.nodes.has(n2.id) ? n2.id : n3.id
    expect(net.adjacency.get(keptId)?.length).toBe(2)
  })

  it('reconciles user network without false splits on divergent branches', () => {
    const userJson = {
      version: 1,
      nodes: [
        { id: 'n_29', x: -200, y: 0 },
        { id: 'n_30', x: 169, y: 0 },
        { id: 'n_68', x: -938, y: 0 },
        { id: 'n_70', x: -569, y: 0 },
        { id: 'n_73', x: -600, y: 0 },
        { id: 'n_74', x: -435.45, y: 32.73 },
        { id: 'n_78', x: -106.34, y: 32.73 },
        { id: 'n_80', x: 58.22, y: 0 },
      ],
      segments: [
        { id: 's_31', from: 'n_29', to: 'n_30', kind: 'straight' },
        { id: 's_71', from: 'n_68', to: 'n_70', kind: 'straight' },
        { id: 's_72', from: 'n_70', to: 'n_29', kind: 'straight' },
        { id: 's_75', from: 'n_73', to: 'n_74', kind: 'curve', via: { x: -514.47, y: 0 } },
        { id: 's_81', from: 'n_78', to: 'n_80', kind: 'curve', via: { x: -27.32, y: 0 } },
      ],
    }

    const { network: net } = deserializeNetwork(userJson as any)

    expect(net.adjacency.get('n_73')?.length).toBe(3)
    expect(net.adjacency.get('n_80')?.length).toBe(3)
    expect(net.junctions.size).toBe(2)

    // A second reconciliation pass should be a clean no-op
    const res = reconcileNetworkIntersections(net)
    expect(res.splitCount).toBe(0)
    expect(res.weldedCount).toBe(0)
  })

  it('automatically reconciles two crossing tracks into a degree-4 diamond crossing node', () => {
    const net = createNetwork()
    // Horizontal track: (0, 50) -> (100, 50)
    const h1 = addNode(net, { x: 0, y: 50 })
    const h2 = addNode(net, { x: 100, y: 50 })
    addSegment(net, h1.id, h2.id)

    // Vertical track crossing it: (50, 0) -> (50, 100)
    const v1 = addNode(net, { x: 50, y: 0 })
    const v2 = addNode(net, { x: 50, y: 100 })
    addSegment(net, v1.id, v2.id)

    expect(net.nodes.size).toBe(4)
    expect(net.segments.size).toBe(2)

    const res = reconcileNetworkIntersections(net)
    expect(res.splitCount).toBe(2)
    expect(net.nodes.size).toBe(5)
    expect(net.segments.size).toBe(4)

    // Find the center node
    const centerNode = Array.from(net.nodes.values()).find(
      (n) => Math.hypot(n.pos.x - 50, n.pos.y - 50) < 1e-3,
    )
    expect(centerNode).toBeDefined()
    expect(net.adjacency.get(centerNode!.id)?.length).toBe(4)
  })
})
