import { describe, it, expect, beforeEach } from 'vitest'
import {
  createNetwork,
  addNode,
  addSegment,
  resetIdCounter
} from './network'
import { addJunction } from './junction'
import {
  positionOnSegment,
  createLocomotive,
  advanceLocomotive,
  getLocomotivePolygon,
  snapToNearestTrack,
  steerJunction
} from './locomotive'

describe('locomotive', () => {
  beforeEach(() => {
    resetIdCounter()
  })

  it('positionOnSegment returns correct midpoint for straight segment', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    const s1 = addSegment(net, n1.id, n2.id)

    const p = positionOnSegment(net, s1!.id, 0.5)
    expect(p).toEqual({ x: 50, y: 0 })
  })

  it('createLocomotive places both bogies on the track', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    const s1 = addSegment(net, n1.id, n2.id)

    const loco = createLocomotive(net, s1!.id, 0.5, 20, 10)
    expect(loco).not.toBeNull()
    expect(loco!.front.segId).toBe(s1!.id)
    expect(loco!.front.t).toBeCloseTo(0.5)
    expect(loco!.rear.segId).toBe(s1!.id)
    expect(loco!.rear.t).toBeCloseTo(0.4) // 10 / 100 = 0.1, 0.5 - 0.1 = 0.4
  })

  it('advanceLocomotive moves forward along a straight track', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    const s1 = addSegment(net, n1.id, n2.id)

    const loco = createLocomotive(net, s1!.id, 0.5, 20, 10)
    expect(loco).not.toBeNull()

    const moved = advanceLocomotive(net, loco!, 10)
    expect(moved).toBe(true)
    expect(loco!.front.t).toBeCloseTo(0.6)
    expect(loco!.rear.t).toBeCloseTo(0.5)
  })

  it('advanceLocomotive transitions across segment boundaries', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    const n3 = addNode(net, { x: 200, y: 0 })
    const s1 = addSegment(net, n1.id, n2.id)
    const s2 = addSegment(net, n2.id, n3.id)

    const loco = createLocomotive(net, s1!.id, 0.9, 20, 10) // front is at 90
    expect(loco).not.toBeNull()

    const moved = advanceLocomotive(net, loco!, 20) // advance by 20, front goes to s2, t=0.1
    expect(moved).toBe(true)
    expect(loco!.front.segId).toBe(s2!.id)
    expect(loco!.front.t).toBeCloseTo(0.1) // 110/100 on s2
    // rear is at 100m (on boundary n2) - it could be on s1(t=1) or s2(t=0)
    const rearOnS1 = loco!.rear.segId === s1!.id && Math.abs(loco!.rear.t - 1) < 0.01
    const rearOnS2 = loco!.rear.segId === s2!.id && Math.abs(loco!.rear.t - 0) < 0.01
    expect(rearOnS1 || rearOnS2).toBe(true)
  })

  it('advanceLocomotive respects junction active branch', () => {
    const net = createNetwork()
    const nStem = addNode(net, { x: 0, y: 0 })
    const nApex = addNode(net, { x: 100, y: 0 })
    const nStraight = addNode(net, { x: 200, y: 0 })
    const nDiv = addNode(net, { x: 200, y: 100 })

    const sStem = addSegment(net, nStem.id, nApex.id)!
    const sStraight = addSegment(net, nApex.id, nStraight.id)!
    const sDiv = addSegment(net, nApex.id, nDiv.id)!

    addJunction(net, {
      nodeId: nApex.id,
      stemNodeId: nStem.id,
      straightNodeId: nStraight.id,
      divergingNodeId: nDiv.id,
      straightSegmentId: sStraight.id,
      divergingSegmentId: sDiv.id,
      hand: 'right',
      frogNumber: 4,
      activeBranch: 'diverging'
    })

    const loco = createLocomotive(net, sStem.id, 0.9, 20, 10)
    expect(loco).not.toBeNull()

    const moved = advanceLocomotive(net, loco!, 20)
    expect(moved).toBe(true)
    expect(loco!.front.segId).toBe(sDiv.id)
  })

  it('getLocomotivePolygon returns valid polygon', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    const s1 = addSegment(net, n1.id, n2.id)

    const loco = createLocomotive(net, s1!.id, 0.5, 20, 10)
    expect(loco).not.toBeNull()

    const poly = getLocomotivePolygon(net, loco!)
    expect(poly).not.toBeNull()
    expect(poly!.length).toBe(5)
  })

  it('snapToNearestTrack finds closest segment', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    const s1 = addSegment(net, n1.id, n2.id)

    const snap = snapToNearestTrack(net, { x: 25, y: 5 })
    expect(snap).not.toBeNull()
    expect(snap!.segId).toBe(s1!.id)
    expect(snap!.t).toBeCloseTo(0.25)
  })

  it('steerJunction sets correct branch based on loco heading', () => {
    const net = createNetwork()
    const nStem = addNode(net, { x: 0, y: 0 })
    const nApex = addNode(net, { x: 100, y: 0 })
    const nStraight = addNode(net, { x: 200, y: 0 })
    const nDiv = addNode(net, { x: 200, y: 100 })

    const sStem = addSegment(net, nStem.id, nApex.id)!
    const sStraight = addSegment(net, nApex.id, nStraight.id)!
    const sDiv = addSegment(net, nApex.id, nDiv.id)!

    const junc = addJunction(net, {
      nodeId: nApex.id,
      stemNodeId: nStem.id,
      straightNodeId: nStraight.id,
      divergingNodeId: nDiv.id,
      straightSegmentId: sStraight.id,
      divergingSegmentId: sDiv.id,
      hand: 'right', // diverges to +y, so in SVG it's down (right from driver)
      frogNumber: 4,
      activeBranch: 'straight'
    })

    const loco = createLocomotive(net, sStem.id, 0.5, 20, 10)
    
    // Test steer right
    steerJunction(net, loco!, 'right')
    expect(junc.activeBranch).toBe('diverging')

    // Test steer left
    steerJunction(net, loco!, 'left')
    expect(junc.activeBranch).toBe('straight')
  })
})
