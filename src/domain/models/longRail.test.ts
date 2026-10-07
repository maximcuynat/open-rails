import { beforeEach, describe, expect, it } from 'vitest'
import type { Network, PathPiece, Segment } from './types'
import { addNode, addPathSegment, addSegment, createNetwork, hitSegment, resetIdCounter } from './network'
import { pieceEnd } from '../geometry/railPath'
import { getTrackCurvatureAt, positionOnSegment, projectOnSegment, segmentArcLength, segmentPartialLength, tangentOnSegment, walkBackward, walkForward } from './locomotive'
import { leaveDirection } from './routing'
import { splitSegment } from './junction'
import { reconcileNetworkIntersections } from '../geometry/reconcile'
import { trackProfile } from './trackSpeed'
import { segmentEnds, shapePieces, shapePolyline } from '../geometry/segmentGeometry'
import { deserializeNetwork, PROJECT_VERSION, serializeNetwork } from '@infrastructure/persistence/persistence'

/** 100 m straight along +x, a quarter turn of radius 200 m, 50 m straight: one rail from A to B */
function pieces(): PathPiece[] {
  const arc: PathPiece = { x: 100, y: 0, heading: 0, curvature: 1 / 200, length: 100 * Math.PI }
  const end = pieceEnd(arc)
  return [
    { x: 0, y: 0, heading: 0, curvature: 0, length: 100 },
    arc,
    { x: end.x, y: end.y, heading: end.heading, curvature: 0, length: 50 },
  ]
}
const LENGTH = 100 + 100 * Math.PI + 50

function longRail(): { net: Network; rail: Segment } {
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 300, y: 250 })
  return { net, rail: addPathSegment(net, a.id, b.id, pieces())! }
}

describe('a long rail: one rail that carries its whole path', () => {
  beforeEach(() => resetIdCounter())

  it('runs from its first node to its second along its pieces', () => {
    const { net, rail } = longRail()
    expect(rail.kind).toBe('path')
    expect(segmentArcLength(net, rail.id)).toBeCloseTo(LENGTH)
    expect(positionOnSegment(net, rail.id, 0)).toEqual({ x: 0, y: 0 })
    expect(positionOnSegment(net, rail.id, 1)!.x).toBeCloseTo(300)
    expect(positionOnSegment(net, rail.id, 1)!.y).toBeCloseTo(250)
    // Its parameter is the share of its length: half-way along is in the turn
    const half = positionOnSegment(net, rail.id, 0.5)!
    expect(Math.hypot(half.x - 100, half.y - 200)).toBeCloseTo(200)
    expect(segmentPartialLength(net, rail.id, 0.25, 0.75)).toBeCloseTo(LENGTH / 2)
  })

  it('leaves each node along its end pieces, which is what the points read', () => {
    const { net, rail } = longRail()
    expect(tangentOnSegment(net, rail.id, 0)!.x).toBeCloseTo(1)
    expect(tangentOnSegment(net, rail.id, 1)!.y).toBeCloseTo(1)
    const fromA = leaveDirection(net, rail, rail.from)
    const fromB = leaveDirection(net, rail, rail.to)
    expect(fromA.x).toBeCloseTo(1)
    expect(fromA.y).toBeCloseTo(0)
    expect(fromB.x).toBeCloseTo(0)
    expect(fromB.y).toBeCloseTo(-1)
  })

  it('a train walks it by the metre, both ways', () => {
    const { net, rail } = longRail()
    const ahead = walkForward(net, rail.id, 0, true, 250)!
    expect(ahead.segId).toBe(rail.id)
    expect(ahead.t * LENGTH).toBeCloseTo(250)
    const back = walkBackward(net, rail.id, ahead.t, true, 180)!
    expect(back.t * LENGTH).toBeCloseTo(70)
    // Past its end there is no track: the walk fails as on any dead end
    expect(walkForward(net, rail.id, 0.9, true, 500)).toBeNull()
  })

  it('carries on into the next rail at its end', () => {
    const { net, rail } = longRail()
    const c = addNode(net, { x: 300, y: 350 })
    const next = addSegment(net, rail.to, c.id)!
    const at = walkForward(net, rail.id, 0, true, LENGTH + 40)!
    expect(at.segId).toBe(next.id)
    expect(at.t).toBeCloseTo(0.4)
  })

  it('knows the curve under a bogie: none on its straights, its radius in the turn', () => {
    const { net, rail } = longRail()
    expect(getTrackCurvatureAt(net, { segId: rail.id, t: 0.1, forward: true }).radius).toBe(Infinity)
    const turn = getTrackCurvatureAt(net, { segId: rail.id, t: 0.5, forward: true })
    expect(turn.radius).toBeCloseTo(200)
    expect(turn.side).toBe('right')
    expect(getTrackCurvatureAt(net, { segId: rail.id, t: 0.5, forward: false }).side).toBe('left')
    // The push is away from the centre of the turn (100, 200)
    const at = positionOnSegment(net, rail.id, 0.5)!
    expect(turn.outwardNormal.x * (at.x - 100) + turn.outwardNormal.y * (at.y - 200)).toBeCloseTo(200)
  })

  it('its speed is that of its tightest curve', () => {
    const { net, rail } = longRail()
    const curve = trackProfile(net).rails.get(rail.id)!
    expect(curve.radius).toBeCloseTo(200)
    expect(curve.hand).toBe(1)
  })

  it('is found under the cursor, and a point is brought onto it', () => {
    const { net, rail } = longRail()
    const inTurn = { x: 100 + 195 * Math.SQRT1_2, y: 200 - 195 * Math.SQRT1_2 }
    expect(hitSegment(net, inTurn, 6)).toBe(rail.id)
    expect(hitSegment(net, { x: 150, y: 120 }, 6)).toBeNull()
    const onRail = projectOnSegment(net, rail, inTurn)!
    expect(Math.hypot(onRail.point.x - 100, onRail.point.y - 200)).toBeCloseTo(200)
    expect(onRail.t * LENGTH).toBeCloseTo(100 + 50 * Math.PI)
  })

  it('is drawn piece by piece, and flattened along its turn', () => {
    const { net, rail } = longRail()
    const ends = segmentEnds(net, rail)!
    const drawn = shapePieces(ends)
    expect(drawn.length).toBeGreaterThan(3)
    expect(drawn[0].via).toBeUndefined()
    expect(drawn.some((piece) => piece.via)).toBe(true)
    const pts = shapePolyline(ends, 16)
    for (const p of pts.slice(2, -1)) expect(Math.abs(Math.hypot(p.x - 100, p.y - 200) - 200)).toBeLessThan(0.01)
  })

  it('follows a node that is moved', () => {
    const { net, rail } = longRail()
    net.nodes.get(rail.to)!.pos = { x: 320, y: 240 }
    const end = positionOnSegment(net, rail.id, 1)!
    expect(end.x).toBeCloseTo(320)
    expect(end.y).toBeCloseTo(240)
    expect(positionOnSegment(net, rail.id, 0)).toEqual({ x: 0, y: 0 })
  })

  it('cut in two, each half keeps its share of the path and the whole keeps its length', () => {
    const { net, rail } = longRail()
    const inTurn = { x: 100 + 200 * Math.SQRT1_2, y: 200 - 200 * Math.SQRT1_2 }
    const cut = splitSegment(net, rail.id, inTurn)!
    expect(net.segments.has(rail.id)).toBe(false)
    expect(cut.seg1.kind).toBe('path')
    expect(cut.seg2.kind).toBe('path')
    expect(cut.t * LENGTH).toBeCloseTo(100 + 50 * Math.PI)
    expect(cut.midNode.pos.x).toBeCloseTo(inTurn.x)
    expect(cut.midNode.pos.y).toBeCloseTo(inTurn.y)
    expect(segmentArcLength(net, cut.seg1.id) + segmentArcLength(net, cut.seg2.id)).toBeCloseTo(LENGTH)
    // The two halves meet tangent to tangent: a train runs through
    const through = walkForward(net, cut.seg1.id, 0, true, LENGTH - 10)!
    expect(through.segId).toBe(cut.seg2.id)
    const where = positionOnSegment(net, through.segId, through.t)!
    expect(where.x).toBeCloseTo(300)
    expect(where.y).toBeCloseTo(240)
  })

  it('a track that ends on it is joined to it there', () => {
    const { net, rail } = longRail()
    // A siding that comes to the first straight of the long rail, 60 m along
    const far = addNode(net, { x: 60, y: -80 })
    const foot = addNode(net, { x: 60, y: 0.02 })
    addSegment(net, far.id, foot.id)
    reconcileNetworkIntersections(net, 0.1)
    expect(net.segments.has(rail.id)).toBe(false)
    expect((net.adjacency.get(foot.id) ?? []).length).toBe(3)
    const halves = [...net.segments.values()].filter((seg) => seg.kind === 'path')
    expect(halves).toHaveLength(2)
    expect(halves.reduce((sum, seg) => sum + segmentArcLength(net, seg.id), 0)).toBeCloseTo(LENGTH, 1)
  })

  it('is saved and read back as it is, in a file older builds refuse', () => {
    const { net, rail } = longRail()
    const saved = serializeNetwork(net, 'Long rail')
    expect(saved.version).toBe(3)
    expect(saved.segments[0].kind).toBe('path')
    expect(saved.segments[0].path).toHaveLength(3)

    const back = deserializeNetwork(JSON.parse(JSON.stringify(saved))).network
    const read = back.segments.get(rail.id)!
    expect(read.kind).toBe('path')
    expect(segmentArcLength(back, read.id)).toBeCloseTo(LENGTH)
    expect(positionOnSegment(back, read.id, 0.5)!.x).toBeCloseTo(positionOnSegment(net, rail.id, 0.5)!.x)

    expect(PROJECT_VERSION).toBe(4)
    expect(() => deserializeNetwork({ ...saved, version: 5 as 4 })).toThrow()
    // A project without long rail is still written as before
    const plain = createNetwork()
    addSegment(plain, addNode(plain, { x: 0, y: 0 }).id, addNode(plain, { x: 10, y: 0 }).id)
    expect(serializeNetwork(plain, 'Plain').version).toBe(2)
  })

  it('a saved path that does not hold together is read as the straight line between its nodes', () => {
    const { net } = longRail()
    const saved = serializeNetwork(net, 'Broken')
    // The saved form is shared with the network it was taken from: a change to it is a copy
    saved.segments[0] = { ...saved.segments[0], path: [[0, 0, 0, 0, -5]] }
    const read = [...deserializeNetwork(saved).network.segments.values()][0]
    expect(read.kind).toBe('straight')
  })
})
