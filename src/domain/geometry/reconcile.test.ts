import { describe, it, expect } from 'vitest'
import { createNetwork, addNode, addSegment, addCurveSegment, resetIdCounter } from '../models/network'
import { MIN_CROSSING_ANGLE_DEG } from '../models/crossing'
import { createVehicle, makeTrainSet, advanceTrainSet } from '../models/train'
import { positionOnSegment } from '../models/locomotive'
import { reconcileNetworkIntersections } from './reconcile'
import { deserializeNetwork } from '../../infrastructure/persistence/persistence'
import { placeTurnout } from '../models/junction'
import { placementThresholds } from './scale'
import { distToCurve } from './curve'

describe('Network Topology Reconciler', () => {
  it('splits straight segment at an intermediate node and creates a turnout', () => {
    const net = createNetwork()
    // Main straight track: n1 (0, 0) -> n2 (200, 0)
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 200, y: 0 })
    addSegment(net, n1.id, n2.id)

    // Branch track: n3 (100, 0) -> n4 (200, 20), leaving at 11° (within the transition limit)
    // n3 lies exactly on the segment between n1 and n2
    const n3 = addNode(net, { x: 100, y: 0 })
    const n4 = addNode(net, { x: 200, y: 20 })
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

describe('reconcile leaves one rail per stretch of track', () => {
  const straight = (net: ReturnType<typeof createNetwork>, x1: number, x2: number) => {
    const a = addNode(net, { x: x1, y: 0 })
    const b = addNode(net, { x: x2, y: 0 })
    return addSegment(net, a.id, b.id)!
  }

  /** The network must be a plain chain of rails along y=0 covering [from, to] exactly once */
  function expectSingleRun(net: ReturnType<typeof createNetwork>, from: number, to: number, joints: number[]) {
    expect(net.junctions.size).toBe(0)
    const xs = [...net.nodes.values()].map((n) => n.pos.x).sort((p, q) => p - q)
    expect(xs).toHaveLength(joints.length + 2)
    ;[from, ...joints, to].forEach((x, i) => expect(xs[i]).toBeCloseTo(x, 6))
    expect(net.segments.size).toBe(joints.length + 1)
    const lengths = [...net.segments.values()].map((s) => Math.abs(net.nodes.get(s.to)!.pos.x - net.nodes.get(s.from)!.pos.x))
    expect(lengths.reduce((sum, l) => sum + l, 0)).toBeCloseTo(to - from, 6)
    for (const node of net.nodes.values()) {
      const degree = net.adjacency.get(node.id)!.length
      const isEnd = Math.abs(node.pos.x - from) < 1e-6 || Math.abs(node.pos.x - to) < 1e-6
      expect(degree).toBe(isEnd ? 1 : 2)
    }
  }

  it('drops a rail laid a second time on separate nodes, keeping the older one', () => {
    const net = createNetwork()
    const first = straight(net, -100, 100)
    straight(net, -100, 100)

    reconcileNetworkIntersections(net)

    expectSingleRun(net, -100, 100, [])
    expect(net.segments.has(first.id)).toBe(true)
  })

  it('drops an identical curve laid a second time, but keeps a straight and a curve between the same ends', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const first = addCurveSegment(net, a.id, b.id, { x: 50, y: 40 })!
    const a2 = addNode(net, { x: 0, y: 0 })
    const b2 = addNode(net, { x: 100, y: 0 })
    addCurveSegment(net, a2.id, b2.id, { x: 50, y: 40 })
    const a3 = addNode(net, { x: 0, y: 0 })
    const b3 = addNode(net, { x: 100, y: 0 })
    addSegment(net, a3.id, b3.id)

    reconcileNetworkIntersections(net)

    expect(net.nodes.size).toBe(2)
    expect(net.segments.size).toBe(2)
    expect(net.segments.has(first.id)).toBe(true)
    expect([...net.segments.values()].map((s) => s.kind).sort()).toEqual(['curve', 'straight'])
  })

  it('removes duplicates already present between two nodes (e.g. from a saved file)', () => {
    const net = createNetwork()
    const first = straight(net, -100, 100)
    // A second straight forced in behind the back of addSegment
    net.segments.set('s_dup', { id: 's_dup', from: first.to, to: first.from, kind: 'straight' })
    net.adjacency.get(first.from)!.push('s_dup')
    net.adjacency.get(first.to)!.push('s_dup')

    reconcileNetworkIntersections(net)

    expectSingleRun(net, -100, 100, [])
    expect(net.segments.has(first.id)).toBe(true)
  })

  it('absorbs a short rail lying inside a longer one, keeping the short rail that was there', () => {
    const net = createNetwork()
    straight(net, -100, 100)
    const short = straight(net, -20, 20)

    reconcileNetworkIntersections(net)

    expectSingleRun(net, -100, 100, [-20, 20])
    expect(net.segments.has(short.id)).toBe(true)
  })

  it('merges a partial overlap into a single run of segments', () => {
    const net = createNetwork()
    straight(net, -100, 50)
    straight(net, 0, 150)

    reconcileNetworkIntersections(net)

    expectSingleRun(net, -100, 150, [0, 50])
  })

  it('is stable: a second pass changes nothing', () => {
    const net = createNetwork()
    straight(net, -100, 50)
    straight(net, 0, 150)
    straight(net, -20, 20)
    reconcileNetworkIntersections(net)
    const snapshot = JSON.stringify([[...net.nodes.values()], [...net.segments.values()]])

    const res = reconcileNetworkIntersections(net)

    expect(res).toEqual({ splitCount: 0, weldedCount: 0 })
    expect(JSON.stringify([[...net.nodes.values()], [...net.segments.values()]])).toBe(snapshot)
  })

  it('does not fold a turnout branch onto its main line, even with the loose heal tolerance', () => {
    const net = createNetwork()
    const stem = addNode(net, { x: -300, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    addSegment(net, stem.id, apex.id)
    placeTurnout(net, { startPos: apex.pos, direction: { x: 1, y: 0 }, frogNumber: 6, hand: 'left', stemNodeId: apex.id })
    // A short straight branch at 10°, whose end is within the heal tolerance of the main line
    const spur = addNode(net, { x: -300 + 15 * Math.cos(Math.PI / 18), y: 15 * Math.sin(Math.PI / 18) })
    addSegment(net, stem.id, spur.id)
    const before = { nodes: net.nodes.size, segments: net.segments.size }

    const res = reconcileNetworkIntersections(net, placementThresholds().healTolerance)

    expect(res).toEqual({ splitCount: 0, weldedCount: 0 })
    expect({ nodes: net.nodes.size, segments: net.segments.size }).toEqual(before)
  })
})

describe('reconcile handles every intersection of two tracks', () => {
  it('puts a node on both tracks at each of the two crossings of a curve over a straight', () => {
    const net = createNetwork()
    const w = addNode(net, { x: -100, y: 0 })
    const e = addNode(net, { x: 100, y: 0 })
    addSegment(net, w.id, e.id)
    const a = addNode(net, { x: -60, y: -40 })
    const b = addNode(net, { x: 60, y: -40 })
    const via = { x: 0, y: 80 }
    addCurveSegment(net, a.id, b.id, via)

    const res = reconcileNetworkIntersections(net)

    expect(res.splitCount).toBe(4)
    const crossings = [...net.nodes.values()].filter((n) => net.adjacency.get(n.id)!.length === 4)
    expect(crossings).toHaveLength(2)
    // B(t).y = -40 + 240·t·(1-t) = 0  →  t = (1 ± √(1/3)) / 2, x = -60 + 120·t
    const expectedX = 60 * Math.sqrt(1 / 3)
    expect(crossings.map((n) => n.pos.x).sort((p, q) => p - q)[0]).toBeCloseTo(-expectedX, 6)
    expect(crossings.map((n) => n.pos.x).sort((p, q) => p - q)[1]).toBeCloseTo(expectedX, 6)
    for (const node of crossings) {
      // On the straight…
      expect(Math.abs(node.pos.y)).toBeLessThan(1e-6)
      // …and on the original curve
      expect(distToCurve(node.pos, a.pos, via, b.pos, 4096)).toBeLessThan(1e-4)
    }
    // The straight is still straight: all its pieces lie on y=0
    const straights = [...net.segments.values()].filter((s) => s.kind === 'straight')
    expect(straights).toHaveLength(3)
    for (const s of straights) {
      expect(Math.abs(net.nodes.get(s.from)!.pos.y)).toBeLessThan(1e-6)
      expect(Math.abs(net.nodes.get(s.to)!.pos.y)).toBeLessThan(1e-6)
    }
    expect(net.junctions.size).toBe(0)
  })

  it('splits a curve where a rail end really touches it, without dragging the node along the curve', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 100 })
    const b = addNode(net, { x: 100, y: 0 })
    const via = { x: 0, y: 0 }
    addCurveSegment(net, a.id, b.id, via)
    // A point of the curve that falls between two of the coarse samples: B(0.39)
    const t = 0.39
    const on = { x: t * t * 100, y: (1 - t) * (1 - t) * 100 }
    const end = addNode(net, on)
    const far = addNode(net, { x: 90, y: 90 })
    addSegment(net, end.id, far.id)

    const res = reconcileNetworkIntersections(net)

    expect(res.splitCount).toBe(1)
    expect(net.adjacency.get(end.id)).toHaveLength(3)
    expect(net.nodes.get(end.id)!.pos.x).toBeCloseTo(on.x, 4)
    expect(net.nodes.get(end.id)!.pos.y).toBeCloseTo(on.y, 4)
  })
})

describe('a curve meeting a track twice', () => {
  /** Straight along y=0 from x=-300 to 300, and a curve from (-200,-dip) to (200,-dip) rising to y=+dip */
  function lens(dip: number, curveFirst: boolean) {
    resetIdCounter()
    const net = createNetwork()
    const layStraight = () => {
      const a = addNode(net, { x: -300, y: 0 })
      const b = addNode(net, { x: 300, y: 0 })
      addSegment(net, a.id, b.id)
    }
    const layCurve = () => {
      const a = addNode(net, { x: -200, y: -dip })
      const b = addNode(net, { x: 200, y: -dip })
      addCurveSegment(net, a.id, b.id, { x: 0, y: 3 * dip })
    }
    if (curveFirst) { layCurve(); layStraight() } else { layStraight(); layCurve() }
    reconcileNetworkIntersections(net)
    return net
  }
  const curveY = (dip: number, x: number) => -dip + 8 * dip * ((x + 200) / 400) * (1 - (x + 200) / 400)

  it('lets trains run through both crossings on each line, in both directions, whichever was laid first', () => {
    for (const dip of [60, 5]) {
      for (const curveFirst of [false, true]) {
        const net = lens(dip, curveFirst)
        const crossings = [...net.nodes.values()].filter((n) => net.adjacency.get(n.id)!.length === 4)
        expect(crossings).toHaveLength(2)
        // Between the two crossing nodes there are two rails: one of each line
        const between = [...net.segments.values()].filter((s) => crossings.some((c) => c.id === s.from) && crossings.some((c) => c.id === s.to))
        expect(between.map((s) => s.kind).sort()).toEqual(['curve', 'straight'])

        for (const line of ['straight', 'curve'] as const) {
          const endXs = line === 'straight' ? [-300, 300] : [-200, 200]
          for (const fromX of endXs) {
            const startNode = [...net.nodes.values()].find((n) => Math.abs(n.pos.x - fromX) < 1e-6 && net.adjacency.get(n.id)!.length === 1)!
            const seg = net.segments.get(net.adjacency.get(startNode.id)![0])!
            // Parked with its tail on the end of the line, nose towards the crossings
            const lead = createVehicle(net, seg.id, seg.from === startNode.id ? 0 : 1, 'loco', seg.from === startNode.id ? 1 : -1)!
            const train = makeTrainSet('t', [lead])
            let steps = 0
            while (advanceTrainSet(net, train, 0.25) && steps < 4000) {
              steps++
              const p = positionOnSegment(net, train.vehicles[0].front.segId, train.vehicles[0].front.t)!
              expect(Math.abs(p.y - (line === 'straight' ? 0 : curveY(dip, p.x)))).toBeLessThan(1e-6)
            }
            const nose = positionOnSegment(net, train.vehicles[0].front.segId, train.vehicles[0].front.t)!
            expect(Math.abs(nose.x - -fromX)).toBeLessThan(0.3) // reached the far end of its own line
          }
        }
      }
    }
  })

  it('does not connect a curve that only touches a straight', () => {
    const net = createNetwork()
    const a = addNode(net, { x: -300, y: 0 })
    const b = addNode(net, { x: 300, y: 0 })
    addSegment(net, a.id, b.id)
    const c1 = addNode(net, { x: -200, y: 100 })
    const c2 = addNode(net, { x: 200, y: 100 })
    addCurveSegment(net, c1.id, c2.id, { x: 0, y: -100 }) // apex exactly on y=0

    expect(reconcileNetworkIntersections(net)).toEqual({ splitCount: 0, weldedCount: 0 })
    expect(net.nodes.size).toBe(4)
    expect(net.segments.size).toBe(2)
  })

  it('treats a graze consistently: two crossing nodes, or none below the minimum crossing angle', () => {
    for (const shift of [0, 37]) {
      for (const depth of [1e-6, 0.001, 0.01, 0.03, 0.05, 0.2, 1, 5]) {
        const net = createNetwork()
        const a = addNode(net, { x: -300, y: 0 })
        const b = addNode(net, { x: 300, y: 0 })
        addSegment(net, a.id, b.id)
        const c1 = addNode(net, { x: -200 + shift, y: 100 - depth })
        const c2 = addNode(net, { x: 200 + shift, y: 100 - depth })
        addCurveSegment(net, c1.id, c2.id, { x: shift, y: -100 - depth }) // apex `depth` beyond the straight
        reconcileNetworkIntersections(net)

        const joints = [...net.nodes.values()].filter((n) => net.adjacency.get(n.id)!.length > 1)
        // The curve meets the straight at an angle of atan(sqrt(depth/100))
        const angleDeg = (Math.atan(Math.sqrt(depth / 100)) * 180) / Math.PI
        expect(joints.length, `depth ${depth}`).toBe(angleDeg >= MIN_CROSSING_ANGLE_DEG ? 2 : 0)
        for (const j of joints) expect(net.adjacency.get(j.id)).toHaveLength(4)
      }
    }
  })
})
