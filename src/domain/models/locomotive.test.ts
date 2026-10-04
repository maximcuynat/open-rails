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
  getLocomotiveRearPos,
  getLocomotiveBogies,
  getTGVDetails,
  getFullTGVTrain,
  reverseTGVTrain,
  hitTestTGVTrain,
  getTrackCurvatureAt,
  sampleForwardTrack,
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
    expect(poly!.length).toBeGreaterThanOrEqual(5)
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

  it('getLocomotiveBogies computes rotating frames and 2 axles per bogie', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 200, y: 0 })
    const seg = addSegment(net, n1.id, n2.id)!

    const loco = createLocomotive(net, seg.id, 0.5, 20, 14)
    expect(loco).not.toBeNull()

    const bogies = getLocomotiveBogies(net, loco!)
    expect(bogies).not.toBeNull()
    expect(bogies!.front).toBeDefined()
    expect(bogies!.rear).toBeDefined()

    // Vérifier le cadre du bogie avant (4 coins du rectangle)
    expect(bogies!.front.polygon.length).toBe(4)
    // Vérifier les 2 essieux du bogie avant
    expect(bogies!.front.axles.length).toBe(2)
    const [axle1, axle2] = bogies!.front.axles

    // L'empattement entre les 2 essieux doit être de 2.3m (±1.15m du centre)
    const axleDist = Math.hypot(axle1.center.x - axle2.center.x, axle1.center.y - axle2.center.y)
    expect(axleDist).toBeCloseTo(2.3, 1)

    // La largeur de chaque essieu entre roues gauche et droite doit être de 1.9m
    const axleWidth1 = Math.hypot(axle1.left.x - axle1.right.x, axle1.left.y - axle1.right.y)
    expect(axleWidth1).toBeCloseTo(1.9, 1)
    const axleWidth2 = Math.hypot(axle2.left.x - axle2.right.x, axle2.left.y - axle2.right.y)
    expect(axleWidth2).toBeCloseTo(1.9, 1)

    // Vérifier le bogie arrière
    expect(bogies!.rear.polygon.length).toBe(4)
    expect(bogies!.rear.axles.length).toBe(2)
  })

  it('getTGVDetails computes streamlined TGV body with windshield, headlights, pantograph and rear gangway', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 200, y: 0 })
    const seg = addSegment(net, n1.id, n2.id)!

    const loco = createLocomotive(net, seg.id, 0.5, 22, 14)
    expect(loco).not.toBeNull()

    const tgv = getTGVDetails(net, loco!)
    expect(tgv).not.toBeNull()

    // 1. Polygone de la motrice profilée TGV (10 sommets avec museau et épaules aérodynamiques)
    expect(tgv!.polygon.length).toBe(10)

    // 2. Pare-brise panoramique de cabine (trapèze à 4 sommets)
    expect(tgv!.windshield.length).toBe(4)

    // 3. Phares avant (deux optiques gauche et droite)
    expect(tgv!.headlights.left).toBeDefined()
    expect(tgv!.headlights.right).toBeDefined()
    const hlDist = Math.hypot(tgv!.headlights.left.x - tgv!.headlights.right.x, tgv!.headlights.left.y - tgv!.headlights.right.y)
    expect(hlDist).toBeCloseTo(0.8, 1)

    // 4. Pantographe (châssis en Z et archet transversal)
    expect(tgv!.pantograph.bowLeft).toBeDefined()
    expect(tgv!.pantograph.bowRight).toBeDefined()
    const bowWidth = Math.hypot(tgv!.pantograph.bowLeft.x - tgv!.pantograph.bowRight.x, tgv!.pantograph.bowLeft.y - tgv!.pantograph.bowRight.y)
    expect(bowWidth).toBeCloseTo(1.6, 1)

    // 5. Soufflet d'intercirculation arrière (face plate pour wagons)
    expect(tgv!.gangway.length).toBe(4)
  })

  it('getFullTGVTrain builds complete reversible articulated TGV train with intermediate cars, Jacobs bogies and rear loco', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 300, y: 0 })
    const seg = addSegment(net, n1.id, n2.id)!

    // Créer une rame TGV avec 2 voitures voyageurs au milieu
    const loco = createLocomotive(net, seg.id, 0.9, 22, 14, 2)
    expect(loco).not.toBeNull()
    expect(loco!.wagonCount).toBe(2)

    const train = getFullTGVTrain(net, loco!)
    expect(train).not.toBeNull()

    // 1. Motrice de tête (M1)
    expect(train!.leadLoco).toBeDefined()
    expect(train!.leadLoco.isRearLoco).toBe(false)
    expect(train!.leadLoco.polygon.length).toBe(10)

    // 2. Voitures voyageur intermédiaires
    expect(train!.cars.length).toBe(2)
    for (const car of train!.cars) {
      expect(car.polygon.length).toBe(4) // Caisse rectangulaire
      expect(car.windowsLeft.length).toBeGreaterThan(0) // Baies vitrées gauche
      expect(car.windowsRight.length).toBeGreaterThan(0) // Baies vitrées droite
    }

    // 3. Soufflets accordéons flexibles (1 entre M1 et C1, 1 entre C1 et C2, 1 entre C2 et M2)
    expect(train!.accordions.length).toBe(3)
    for (const acc of train!.accordions) {
      expect(acc.frontFrame.length).toBe(2)
      expect(acc.rearFrame.length).toBe(2)
      expect(acc.folds.length).toBeGreaterThanOrEqual(2)
    }

    // 4. Motrice de queue (M2) réversible orientée en sens inverse
    expect(train!.rearLoco).toBeDefined()
    expect(train!.rearLoco!.isRearLoco).toBe(true)
    expect(train!.rearLoco!.polygon.length).toBe(10)

    // Le nez de la motrice arrière doit pointer vers l'arrière (x décroissant)
    const noseLead = train!.leadLoco.polygon[0]
    const noseRear = train!.rearLoco!.polygon[0]
    expect(noseRear.x).toBeLessThan(noseLead.x)

    // 5. Bogies : 2 bogies motrice avant + 4 bogies voitures (2 par voiture avec retrait de 3.04m identique à la motrice) + 2 bogies motrice arrière
    // Total = 8 bogies pour 2 voitures
    expect(train!.bogies.length).toBe(8)
    for (const bogie of train!.bogies) {
      expect(bogie.polygon.length).toBe(4)
      expect(bogie.axles.length).toBe(2)
      expect(bogie.center).toBeDefined()
    }

    // 6. Vérifier l'absence totale de trou ou d'espace vide à la fin du train (accordéon compact ~0.70m)
    const rearAccordion = train!.accordions[2]
    const gap = Math.hypot(
      rearAccordion.frontFrame[0].x - rearAccordion.rearFrame[0].x,
      rearAccordion.frontFrame[0].y - rearAccordion.rearFrame[0].y
    )
    // L'écart entre la dernière voiture et M2 doit être compact (~0.7m, bien inférieur aux 15m de l'ancien bug)
    expect(gap).toBeGreaterThan(0.2)
    expect(gap).toBeLessThan(1.5)
  })

  it('reverseTGVTrain swaps control to rear locomotive and reverses forward travel direction', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 300, y: 0 })
    const seg = addSegment(net, n1.id, n2.id)!

    // Créer une rame TGV avec 2 voitures
    const loco = createLocomotive(net, seg.id, 0.9, 22, 14, 2)!
    expect(loco).not.toBeNull()

    const initialFrontPos = getLocomotiveFrontPos(net, loco)!
    expect(initialFrontPos.x).toBeCloseTo(270, 0) // t = 0.9 sur 300m = 270m

    // Inverser le sens : échange de locomotive menante (relève de cabine)
    const reversed = reverseTGVTrain(net, loco)
    expect(reversed).not.toBeNull()

    // La nouvelle motrice de tête est désormais M2 (en x = 197.8m)
    const newFrontPos = getLocomotiveFrontPos(net, reversed!)!
    expect(newFrontPos.x).toBeLessThan(initialFrontPos.x)
    expect(newFrontPos.x).toBeCloseTo(197.8, 1)

    // Vérifier que la nouvelle motrice avance son nez vers x = 0 (direction inverse)
    const moved = advanceLocomotive(net, reversed!, 10) // Avancer de 10 mètres
    expect(moved).toBe(true)

    const advancedFrontPos = getLocomotiveFrontPos(net, reversed!)!
    expect(advancedFrontPos.x).toBeCloseTo(newFrontPos.x - 10, 0.5)
  })

  it('hitTestTGVTrain correctly identifies hover and click on lead loco, passenger cars and rear loco', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 300, y: 0 })
    const seg = addSegment(net, n1.id, n2.id)!

    const loco = createLocomotive(net, seg.id, 0.9, 22, 14, 2)!
    expect(loco).not.toBeNull()

    // 1. Point sur la motrice de tête (proche de x = 270)
    const hitLead = hitTestTGVTrain(net, loco, { x: 270, y: 0.5 }, 2.5)
    expect(hitLead.hit).toBe(true)
    expect(hitLead.part).toBe('lead')
    expect(hitLead.anchorPoint).toBeDefined()

    // 2. Point sur une voiture voyageur intermédiaire (x ~ 230)
    const hitCar = hitTestTGVTrain(net, loco, { x: 235, y: 0.2 }, 2.5)
    expect(hitCar.hit).toBe(true)
    expect(hitCar.part).toBe('car')

    // 3. Point sur la motrice de queue M2 (x ~ 200)
    const hitRear = hitTestTGVTrain(net, loco, { x: 198, y: -0.2 }, 2.5)
    expect(hitRear.hit).toBe(true)
    expect(hitRear.part).toBe('rear')

    // 4. Point hors du train
    const hitNone = hitTestTGVTrain(net, loco, { x: 50, y: 50 }, 2.5)
    expect(hitNone.hit).toBe(false)
    expect(hitNone.part).toBe('none')
  })

  it('getTrackCurvatureAt returns Infinity on straight tracks and finite radius on curves', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 100, y: 0 })
    const straight = addSegment(net, n1.id, n2.id)!

    const straightCurv = getTrackCurvatureAt(net, { segId: straight.id, t: 0.5, forward: true })
    expect(straightCurv.radius).toBe(Infinity)
    expect(straightCurv.side).toBe('straight')

    // Add a curved track: (100, 0) to (200, 100) with via (200, 0)
    const n3 = addNode(net, { x: 200, y: 100 })
    const curve = addCurveSegment(net, n2.id, n3.id, { x: 200, y: 0 })!

    const curveCurv = getTrackCurvatureAt(net, { segId: curve.id, t: 0.5, forward: true })
    expect(Number.isFinite(curveCurv.radius)).toBe(true)
    expect(curveCurv.radius).toBeGreaterThan(0)
    expect(curveCurv.radius).toBeLessThan(1000)
    expect(curveCurv.outwardNormal).toBeDefined()
    expect(Math.hypot(curveCurv.outwardNormal.x, curveCurv.outwardNormal.y)).toBeCloseTo(1, 2)
  })

  it('sampleForwardTrack samples consecutive points forward along segments', () => {
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 50, y: 0 })
    const n3 = addNode(net, { x: 100, y: 0 })
    const s1 = addSegment(net, n1.id, n2.id)!
    addSegment(net, n2.id, n3.id)!

    const pts = sampleForwardTrack(net, { segId: s1.id, t: 0, forward: true }, 1, 60, 5)
    expect(pts.length).toBeGreaterThan(5)
    expect(pts[0].x).toBeCloseTo(0)
    expect(pts[pts.length - 1].x).toBeCloseTo(60, 0.5)
  })
})

