import { describe, it, expect, beforeEach } from 'vitest'
import {
  createNetwork,
  addNode,
  addSegment,
  addCurveSegment,
  resetIdCounter
} from './network'
import { addJunction } from './junction'
import {
  positionOnSegment,
  createLocomotive,
  advanceLocomotive,
  getLocomotivePolygon,
  snapToNearestTrack,
  steerJunction,
  getLocomotiveFrontPos,
  getLocomotiveRearPos
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

  it('steerJunction steps by 1 on 3-way turnout (left <-> straight <-> right)', () => {
    const net = createNetwork()
    const nStem = addNode(net, { x: 0, y: 0 })
    const nApex = addNode(net, { x: 100, y: 0 })
    const nStraight = addNode(net, { x: 200, y: 0 })
    const nLeft = addNode(net, { x: 200, y: -100 })
    const nRight = addNode(net, { x: 200, y: 100 })

    const sStem = addSegment(net, nStem.id, nApex.id)!
    const sStraight = addSegment(net, nApex.id, nStraight.id)!
    const sLeft = addSegment(net, nApex.id, nLeft.id)!
    const sRight = addSegment(net, nApex.id, nRight.id)!

    const junc = addJunction(net, {
      nodeId: nApex.id,
      stemNodeId: nStem.id,
      straightNodeId: nStraight.id,
      divergingNodeId: nLeft.id,
      divergingRightNodeId: nRight.id,
      straightSegmentId: sStraight.id,
      divergingSegmentId: sLeft.id,
      divergingRightSegmentId: sRight.id,
      hand: 'three_way',
      frogNumber: 6,
      activeBranch: 'straight',
    })

    const loco = createLocomotive(net, sStem.id, 0.5, 20, 10)

    // Initially straight. Steer left shifts to 'left'
    steerJunction(net, loco!, 'left')
    expect(junc.activeBranch).toBe('left')

    // Steer left again stays at left (limit)
    steerJunction(net, loco!, 'left')
    expect(junc.activeBranch).toBe('left')

    // Steer right shifts by 1 -> straight
    steerJunction(net, loco!, 'right')
    expect(junc.activeBranch).toBe('straight')

    // Steer right again shifts by 1 -> right
    steerJunction(net, loco!, 'right')
    expect(junc.activeBranch).toBe('right')

    // Steer right again stays at right (limit)
    steerJunction(net, loco!, 'right')
    expect(junc.activeBranch).toBe('right')

    // Steer left shifts back by 1 -> straight
    steerJunction(net, loco!, 'left')
    expect(junc.activeBranch).toBe('straight')
  })

  it('preserves exact bogie distance along a curved track', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 100 })
    // Segment courbe avec un point de contrôle via
    const s1 = addCurveSegment(net, n1.id, n2.id, { x: 10, y: 90 })!

    const bogieDistance = 14
    // Placer la locomotive au milieu de la courbe
    const loco = createLocomotive(net, s1.id, 0.6, 20, bogieDistance)
    expect(loco).not.toBeNull()

    const pFront0 = getLocomotiveFrontPos(net, loco!)!
    const pRear0 = getLocomotiveRearPos(net, loco!)!
    const chordDist0 = Math.hypot(pFront0.x - pRear0.x, pFront0.y - pRear0.y)
    // La distance de corde sur une courbe douce doit être très proche de bogieDistance (légèrement inférieure à l'arc, sans distorsion excessive)
    expect(chordDist0).toBeGreaterThan(13.0)
    expect(chordDist0).toBeLessThanOrEqual(bogieDistance + 0.01)

    // Avancer par petits pas de 2m sur la courbe et vérifier que la distance reste stable
    for (let step = 0; step < 5; step++) {
      const ok = advanceLocomotive(net, loco!, 2)
      expect(ok).toBe(true)

      const pFront = getLocomotiveFrontPos(net, loco!)!
      const pRear = getLocomotiveRearPos(net, loco!)!
      const chordDist = Math.hypot(pFront.x - pRear.x, pFront.y - pRear.y)

      // Sur une même courbure, la corde reste très proche
      expect(chordDist).toBeGreaterThan(13.0)
      expect(chordDist).toBeLessThanOrEqual(bogieDistance + 0.01)
    }
  })

  it('preserves bogie distance across 3-way turnout', () => {
    const net = createNetwork()
    const nStem = addNode(net, { x: 0, y: 0 })
    const nApex = addNode(net, { x: 100, y: 0 })
    const nStraight = addNode(net, { x: 200, y: 0 })
    const nLeft = addNode(net, { x: 200, y: -50 })
    const nRight = addNode(net, { x: 200, y: 50 })

    const sStem = addSegment(net, nStem.id, nApex.id)!
    const sStraight = addSegment(net, nApex.id, nStraight.id)!
    const sLeft = addCurveSegment(net, nApex.id, nLeft.id, { x: 150, y: -25 })!
    const sRight = addCurveSegment(net, nApex.id, nRight.id, { x: 150, y: 25 })!

    addJunction(net, {
      nodeId: nApex.id,
      stemNodeId: nStem.id,
      straightNodeId: nStraight.id,
      divergingNodeId: nLeft.id,
      divergingRightNodeId: nRight.id,
      straightSegmentId: sStraight.id,
      divergingSegmentId: sLeft.id,
      divergingRightSegmentId: sRight.id,
      hand: 'three_way',
      frogNumber: 6,
      activeBranch: 'left', // branche gauche
    })

    const bogieDistance = 14
    // Placer la loco sur le stem à 5m de l'apex
    // stem longueur = 100m. t = 0.95 -> 95m.
    const loco = createLocomotive(net, sStem.id, 0.95, 20, bogieDistance)
    expect(loco).not.toBeNull()

    // Avancer de 10 mètres : le bogie avant avance de 5m sur sStem, franchit l'apex et avance de 5m sur sLeft.
    // Le bogie arrière (à 14m derrière le bogie avant) se trouve donc encore sur sStem (5m sur sLeft + 9m sur sStem -> t = 0.91).
    const ok = advanceLocomotive(net, loco!, 10)
    expect(ok).toBe(true)
    expect(loco!.front.segId).toBe(sLeft.id)
    expect(loco!.rear.segId).toBe(sStem.id)

    const pFront = getLocomotiveFrontPos(net, loco!)!
    const pRear = getLocomotiveRearPos(net, loco!)!
    const dist = Math.hypot(pFront.x - pRear.x, pFront.y - pRear.y)

    // Entre l'arrière sur le stem et l'avant sur le virage, la distance géométrique reste proche de 14m
    expect(dist).toBeGreaterThan(13.0)
    expect(dist).toBeLessThanOrEqual(bogieDistance + 0.1)

    // Puis avancer de 15m supplémentaires : le bogie arrière franchit l'apex et entre à son tour sur sLeft
    const ok2 = advanceLocomotive(net, loco!, 15)
    expect(ok2).toBe(true)
    expect(loco!.front.segId).toBe(sLeft.id)
    expect(loco!.rear.segId).toBe(sLeft.id)

    const pFront2 = getLocomotiveFrontPos(net, loco!)!
    const pRear2 = getLocomotiveRearPos(net, loco!)!
    const dist2 = Math.hypot(pFront2.x - pRear2.x, pFront2.y - pRear2.y)
    expect(dist2).toBeGreaterThan(13.0)
    expect(dist2).toBeLessThanOrEqual(bogieDistance + 0.1)
  })
})
