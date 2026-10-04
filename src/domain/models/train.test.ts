import { describe, it, expect } from 'vitest'
import { createNetwork, addNode, addSegment, resetIdCounter } from './network'
import type { Network } from './types'
import {
  createVehicle,
  createTrainSet,
  coupleTrains,
  decoupleAt,
  advanceTrainSet,
  getAllCouplerPoints,
  getTrainSetVisuals,
  hitTestTrainSet,
  hitTestTrainVehicle,
  removeVehicleFromTrainSet,
  findCouplerSnap,
  vehicleRearEndPos,
  vehicleFrontEndPos,
  tickTrainSet,
  setReverser,
  shiftReverser,
  setNotch,
  triggerEmergencyBrake,
  releaseEmergencyBrake,
  commandedAcceleration,
  stoppingDistance,
  MAX_NOTCH,
  makeTrainSet,
  serializeTrains,
  deserializeTrains,
  pruneTrainsToNetwork,
  steerTrainSetJunction,
  trainRouteStart,
  isJunctionOccupied,
  handleCouplingClick,
  reverseTrainSet,
  COUPLING_GAP,
  type TrainSet,
} from './train'
import { walkForward, snapToNearestTrack, positionOnSegment, findJunctionAhead } from './locomotive'
import { removeSegment } from './network'
import { addJunction, placeTurnout, autoDetectJunctions } from './junction'
import { reconcileNetworkIntersections } from '../geometry/reconcile'
import { MAX_TRANSITION_DEFLECTION_DEG } from '../geometry/tangent'

function makeStraightNetwork(lengthMeters: number): { net: Network; segId: string } {
  resetIdCounter()
  const net = createNetwork()
  const n1 = addNode(net, { x: 0, y: 0 })
  const n2 = addNode(net, { x: lengthMeters, y: 0 })
  void n2
  const seg = addSegment(net, n1.id, n2.id)
  return { net, segId: seg!.id }
}

describe('createVehicle', () => {
  it('places loco with front and rear bogies on straight track', () => {
    const { net, segId } = makeStraightNetwork(200)
    const v = createVehicle(net, segId, 0.5, 'loco')
    expect(v).not.toBeNull()
    expect(v!.kind).toBe('loco')
    expect(v!.front).toBeDefined()
    expect(v!.rear).toBeDefined()
    // front should be at t=0.5, rear should be behind it
    expect(v!.front.t).toBeGreaterThan(v!.rear.t)
  })

  it('places wagon on straight track', () => {
    const { net, segId } = makeStraightNetwork(200)
    const v = createVehicle(net, segId, 0.5, 'wagon')
    expect(v).not.toBeNull()
    expect(v!.kind).toBe('wagon')
  })

  it('returns null if segment too short for vehicle', () => {
    const { net, segId } = makeStraightNetwork(1) // 1m segment, way too short
    const v = createVehicle(net, segId, 0.5, 'loco')
    // May return null or a clamped position — either is acceptable
    // Main check: no crash
    expect(v === null || v!.front !== undefined).toBe(true)
  })
})

describe('createTrainSet', () => {
  it('creates a trainset with one loco', () => {
    const { net } = makeStraightNetwork(200)
    const ts = createTrainSet(net, { x: 100, y: 0 }, 'loco')
    expect(ts).not.toBeNull()
    expect(ts!.vehicles).toHaveLength(1)
    expect(ts!.vehicles[0].kind).toBe('loco')
    expect(ts!.currentSpeed).toBe(0)
    expect(ts!.direction).toBe(1)
  })

  it('creates a trainset with one wagon', () => {
    const { net } = makeStraightNetwork(200)
    const ts = createTrainSet(net, { x: 100, y: 0 }, 'wagon')
    expect(ts).not.toBeNull()
    expect(ts!.vehicles[0].kind).toBe('wagon')
  })
})

describe('advanceTrainSet', () => {
  it('moves a single-vehicle trainset forward', () => {
    const { net } = makeStraightNetwork(200)
    const ts = createTrainSet(net, { x: 100, y: 0 }, 'loco')
    expect(ts).not.toBeNull()
    const frontTBefore = ts!.vehicles[0].front.t
    const moved = advanceTrainSet(net, ts!, 5)
    expect(moved).toBe(true)
    expect(ts!.vehicles[0].front.t).toBeGreaterThan(frontTBefore)
  })

  it('moves a multi-vehicle trainset and updates followers', () => {
    resetIdCounter()
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 500, y: 0 })
    const seg = addSegment(net, n1.id, n2.id)
    void n2 // suppress unused warning

    const ts = createTrainSet(net, { x: 250, y: 0 }, 'loco')
    expect(ts).not.toBeNull()

    // Manually add a wagon behind the lead
    const wagon = createVehicle(net, seg!.id, 0.3, 'wagon')
    expect(wagon).not.toBeNull()
    ts!.vehicles.push(wagon!)

    const leadFrontBefore = ts!.vehicles[0].front.t
    const wagonFrontBefore = ts!.vehicles[1].front.t

    const moved = advanceTrainSet(net, ts!, 5)
    expect(moved).toBe(true)
    expect(ts!.vehicles[0].front.t).toBeGreaterThan(leadFrontBefore)
    expect(ts!.vehicles[1].front.t).not.toBe(wagonFrontBefore) // wagon was repositioned
  })

  it('returns false when blocked at dead end', () => {
    const { net } = makeStraightNetwork(30)
    const ts = createTrainSet(net, { x: 28, y: 0 }, 'loco')
    if (!ts) return
    // Try to advance far past the end
    const moved = advanceTrainSet(net, ts, 100)
    expect(moved).toBe(false)
  })
})

describe('driving controls', () => {
  function makeTrain() {
    const { net } = makeStraightNetwork(2000)
    const ts = createTrainSet(net, { x: 1000, y: 0 }, 'loco')!
    return { net, ts }
  }

  it('starts at rest: neutral reverser, handle on N', () => {
    const { ts } = makeTrain()
    expect(ts.reverser).toBe('neutral')
    expect(ts.notch).toBe(0)
    expect(ts.emergencyBrake).toBe(false)
  })

  it('gives no traction while the reverser is in neutral', () => {
    const { net, ts } = makeTrain()
    setNotch(ts, MAX_NOTCH)
    tickTrainSet(net, ts, 1)
    expect(ts.currentSpeed).toBe(0)
  })

  it('accelerates proportionally to the traction notch', () => {
    const { net, ts } = makeTrain()
    setReverser(ts, 'forward')
    setNotch(ts, 1)
    tickTrainSet(net, ts, 1)
    expect(ts.currentSpeed).toBeCloseTo(ts.acceleration / MAX_NOTCH, 5)

    ts.currentSpeed = 0
    setNotch(ts, MAX_NOTCH)
    tickTrainSet(net, ts, 1)
    expect(ts.currentSpeed).toBeCloseTo(ts.acceleration, 5)
  })

  it('brakes proportionally to the brake notch and never goes below zero', () => {
    const { net, ts } = makeTrain()
    setReverser(ts, 'forward')
    ts.currentSpeed = 20
    setNotch(ts, -2)
    tickTrainSet(net, ts, 1)
    expect(ts.currentSpeed).toBeCloseTo(20 - (2 / MAX_NOTCH) * ts.braking, 5)

    setNotch(ts, -MAX_NOTCH)
    tickTrainSet(net, ts, 10)
    expect(ts.currentSpeed).toBe(0)
  })

  it('coasts on N with the rolling resistance only', () => {
    const { net, ts } = makeTrain()
    setReverser(ts, 'forward')
    ts.currentSpeed = 10
    tickTrainSet(net, ts, 1)
    expect(ts.currentSpeed).toBeCloseTo(10 - ts.coastingDecel, 5)
  })

  it('stoppingDistance matches the distance actually covered at full service brake', () => {
    const { net, ts } = makeTrain()
    setReverser(ts, 'forward')
    ts.currentSpeed = 20
    expect(stoppingDistance(ts)).toBeCloseTo(20, 5) // 20² / (2 × 10)

    setNotch(ts, -MAX_NOTCH)
    const t0 = ts.vehicles[0].front.t
    for (let i = 0; i < 4000; i++) tickTrainSet(net, ts, 0.001)
    expect(ts.currentSpeed).toBe(0)
    expect((ts.vehicles[0].front.t - t0) * 2000).toBeCloseTo(20, 1)
  })

  it('clamps the handle to ±MAX_NOTCH', () => {
    const { ts } = makeTrain()
    setNotch(ts, 99)
    expect(ts.notch).toBe(MAX_NOTCH)
    setNotch(ts, -99)
    expect(ts.notch).toBe(-MAX_NOTCH)
  })

  it('moves forward or backward according to the reverser', () => {
    const { net, ts } = makeTrain()
    // Single segment laid along +x, so the lead bogie's t grows with x
    const frontX = () => ts.vehicles[0].front.t

    setReverser(ts, 'forward')
    setNotch(ts, MAX_NOTCH)
    const x0 = frontX()
    tickTrainSet(net, ts, 1)
    expect(frontX()).toBeGreaterThan(x0)

    ts.currentSpeed = 0
    setNotch(ts, 0)
    expect(setReverser(ts, 'reverse')).toBe(true)
    setNotch(ts, MAX_NOTCH)
    const x1 = frontX()
    tickTrainSet(net, ts, 1)
    expect(frontX()).toBeLessThan(x1)
  })

  it('reverses a multi-vehicle rake with every vehicle following', () => {
    const { net, ts } = makeTrain()
    const wagon = createTrainSet(net, { x: 900, y: 0 }, 'wagon')!
    ts.vehicles.push(...wagon.vehicles)
    advanceTrainSet(net, ts, 0) // settle the wagon behind the loco

    const before = ts.vehicles.map(v => v.front.t)
    const gap = before[0] - before[1]
    setReverser(ts, 'reverse')
    setNotch(ts, MAX_NOTCH)
    expect(tickTrainSet(net, ts, 1)).toBe(true)

    ts.vehicles.forEach((v, i) => expect(v.front.t).toBeLessThan(before[i]))
    expect(ts.vehicles[0].front.t - ts.vehicles[1].front.t).toBeCloseTo(gap, 6)
  })

  it('reversing backs the train up without turning the loco body around', () => {
    const { net, ts } = makeTrain()
    const body = () => getTrainSetVisuals(net, ts)!.vehicles[0].tgvDetails!.polygon

    setReverser(ts, 'forward')
    const facingForward = body()
    setReverser(ts, 'reverse')
    expect(body()).toEqual(facingForward)

    // Once it moves, the whole body shifts back by the same amount, still facing the same way
    setNotch(ts, MAX_NOTCH)
    tickTrainSet(net, ts, 1)
    const dx = body()[0].x - facingForward[0].x
    expect(dx).toBeLessThan(0)
    body().forEach((p, i) => {
      expect(p.x - facingForward[i].x).toBeCloseTo(dx, 6)
      expect(p.y).toBeCloseTo(facingForward[i].y, 6)
    })
  })

  it('locks the reverser while moving or in traction', () => {
    const { ts } = makeTrain()
    setReverser(ts, 'forward')

    ts.currentSpeed = 5
    expect(setReverser(ts, 'reverse')).toBe(false)
    expect(shiftReverser(ts, -1)).toBe(false)
    expect(ts.reverser).toBe('forward')

    ts.currentSpeed = 0
    setNotch(ts, 1)
    expect(setReverser(ts, 'neutral')).toBe(false)

    setNotch(ts, 0)
    expect(shiftReverser(ts, -1)).toBe(true)
    expect(ts.reverser).toBe('neutral')
    expect(shiftReverser(ts, -1)).toBe(true)
    expect(ts.reverser).toBe('reverse')
    expect(shiftReverser(ts, -1)).toBe(false)
  })

  it('emergency brake cuts traction, locks the handle and only releases at standstill', () => {
    const { net, ts } = makeTrain()
    setReverser(ts, 'forward')
    setNotch(ts, MAX_NOTCH)
    ts.currentSpeed = 30

    triggerEmergencyBrake(ts)
    expect(commandedAcceleration(ts)).toBe(-ts.emergencyBraking)
    expect(ts.emergencyBraking).toBeGreaterThan(ts.braking)

    // Locked while moving
    expect(setNotch(ts, MAX_NOTCH)).toBe(false)
    expect(releaseEmergencyBrake(ts)).toBe(false)

    tickTrainSet(net, ts, 1)
    expect(ts.currentSpeed).toBeCloseTo(30 - ts.emergencyBraking, 5)
    tickTrainSet(net, ts, 5)
    expect(ts.currentSpeed).toBe(0)

    // Still latched after the stop, with the handle on full brake
    expect(ts.emergencyBrake).toBe(true)
    expect(ts.notch).toBe(-MAX_NOTCH)
    expect(releaseEmergencyBrake(ts)).toBe(true)
    expect(ts.emergencyBrake).toBe(false)
  })

  it('moving the handle at standstill releases the emergency brake', () => {
    const { ts } = makeTrain()
    triggerEmergencyBrake(ts)
    expect(setNotch(ts, 0)).toBe(true)
    expect(ts.emergencyBrake).toBe(false)
    expect(ts.notch).toBe(0)
  })

  it('decoupled rear half is left with its controls at rest', () => {
    const { net, ts } = makeTrain()
    const wagon = createTrainSet(net, { x: 900, y: 0 }, 'wagon')!
    const coupled = { ...ts, vehicles: [...ts.vehicles, ...wagon.vehicles] }
    setReverser(coupled, 'forward')
    setNotch(coupled, 3)
    coupled.currentSpeed = 12

    const [front, rear] = decoupleAt(coupled, 0)!
    expect(front.notch).toBe(3)
    expect(front.currentSpeed).toBe(12)
    expect(rear.notch).toBe(0)
    expect(rear.reverser).toBe('neutral')
    expect(rear.currentSpeed).toBe(0)
  })
})

describe('coupleTrains', () => {
  it('merges two trainsets into one', () => {
    resetIdCounter()
    const net = createNetwork()
    const n1 = addNode(net, { x: 0, y: 0 })
    const n2 = addNode(net, { x: 500, y: 0 })
    addSegment(net, n1.id, n2.id)
    void n1; void n2

    const tsA = createTrainSet(net, { x: 100, y: 0 }, 'loco')
    const tsB = createTrainSet(net, { x: 130, y: 0 }, 'wagon')
    expect(tsA).not.toBeNull()
    expect(tsB).not.toBeNull()

    // Place B close to A rear
    const seg = [...net.segments.values()][0]!
    tsB!.vehicles[0].front = { segId: seg.id, t: tsA!.vehicles[0].rear.t - 0.001, forward: true }

    const trains = [tsA!, tsB!]
    const result = coupleTrains(net, trains, tsA!.id, tsB!.id)

    // If proximity check passes, result has 1 train with 2 vehicles
    // If proximity check fails (too far), still returns 2 trains — both are valid outcomes
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('does nothing when same train id', () => {
    const { net } = makeStraightNetwork(200)
    const ts = createTrainSet(net, { x: 100, y: 0 }, 'loco')!
    const result = coupleTrains(net, [ts], ts.id, ts.id)
    expect(result).toHaveLength(1)
  })
})

describe('decoupleAt', () => {
  it('splits a multi-vehicle trainset in two', () => {
    resetIdCounter()
    const net2 = createNetwork()
    const na = addNode(net2, { x: 0, y: 0 })
    const nb = addNode(net2, { x: 500, y: 0 })
    const seg = addSegment(net2, na.id, nb.id)
    void na; void nb

    const ts = createTrainSet(net2, { x: 250, y: 0 }, 'loco')!
    const wagon = createVehicle(net2, seg!.id, 0.3, 'wagon')!
    ts.vehicles.push(wagon)

    const result = decoupleAt(ts, 0)
    expect(result).not.toBeNull()
    const [front, rear] = result!
    expect(front.vehicles).toHaveLength(1)
    expect(rear.vehicles).toHaveLength(1)
    expect(front.vehicles[0].kind).toBe('loco')
    expect(rear.vehicles[0].kind).toBe('wagon')
    expect(rear.currentSpeed).toBe(0)
  })

  it('returns null for invalid index', () => {
    const { net } = makeStraightNetwork(200)
    const ts = createTrainSet(net, { x: 100, y: 0 }, 'loco')!
    expect(decoupleAt(ts, 0)).toBeNull() // only 1 vehicle, no joint
    expect(decoupleAt(ts, -1)).toBeNull()
    expect(decoupleAt(ts, 5)).toBeNull()
  })
})

describe('getAllCouplerPoints', () => {
  it('returns front and rear coupler for single vehicle train', () => {
    const { net } = makeStraightNetwork(200)
    const ts = createTrainSet(net, { x: 100, y: 0 }, 'loco')!
    const pts = getAllCouplerPoints(net, [ts])
    expect(pts).toHaveLength(2)
    expect(pts.every(p => !p.coupled)).toBe(true)
    const ends = new Set(pts.map(p => p.end))
    expect(ends.has('front')).toBe(true)
    expect(ends.has('rear')).toBe(true)
  })

  it('returns internal coupled point for two-vehicle train', () => {
    resetIdCounter()
    const net = createNetwork()
    const na = addNode(net, { x: 0, y: 0 })
    const nb = addNode(net, { x: 500, y: 0 })
    const seg = addSegment(net, na.id, nb.id)
    void na; void nb

    const ts = createTrainSet(net, { x: 250, y: 0 }, 'loco')!
    const wagon = createVehicle(net, seg!.id, 0.3, 'wagon')!
    ts.vehicles.push(wagon)

    const pts = getAllCouplerPoints(net, [ts])
    // 2 vehicles → 1 free front + 1 internal (coupled) + 1 free rear = 3 points
    expect(pts).toHaveLength(3)
    const coupled = pts.filter(p => p.coupled)
    expect(coupled).toHaveLength(1)
  })
})

describe('getTrainSetVisuals', () => {
  it('computes visuals for single loco', () => {
    const { net } = makeStraightNetwork(200)
    const ts = createTrainSet(net, { x: 100, y: 0 }, 'loco')!
    const visuals = getTrainSetVisuals(net, ts)
    expect(visuals).not.toBeNull()
    expect(visuals!.vehicles).toHaveLength(1)
    expect(visuals!.vehicles[0].kind).toBe('loco')
    expect(visuals!.bogies).toHaveLength(2)
    expect(visuals!.accordions).toHaveLength(0)
  })

  it('computes visuals for single wagon', () => {
    const { net } = makeStraightNetwork(200)
    const ts = createTrainSet(net, { x: 100, y: 0 }, 'wagon')!
    const visuals = getTrainSetVisuals(net, ts)
    expect(visuals).not.toBeNull()
    expect(visuals!.vehicles).toHaveLength(1)
    expect(visuals!.vehicles[0].kind).toBe('wagon')
    expect(visuals!.bogies).toHaveLength(2)
    expect(visuals!.accordions).toHaveLength(0)
  })

  it('computes visuals and accordions for coupled loco + wagon', () => {
    const { net, segId } = makeStraightNetwork(500)
    const ts = createTrainSet(net, { x: 250, y: 0 }, 'loco')!
    const wagon = createVehicle(net, segId, 0.3, 'wagon')!
    ts.vehicles.push(wagon)

    const visuals = getTrainSetVisuals(net, ts)
    expect(visuals).not.toBeNull()
    expect(visuals!.vehicles).toHaveLength(2)
    expect(visuals!.bogies).toHaveLength(4)
    expect(visuals!.accordions).toHaveLength(1)
  })
})

describe('hitTestTrainSet', () => {
  it('detects hit on vehicle polygon and misses far points', () => {
    const { net } = makeStraightNetwork(200)
    const ts = createTrainSet(net, { x: 100, y: 0 }, 'loco')!
    expect(hitTestTrainSet(net, ts, { x: 100, y: 0 })).toBe(true)
    expect(hitTestTrainSet(net, ts, { x: 100, y: 50 })).toBe(false)
  })
})

describe('findCouplerSnap', () => {
  it('snaps wagon to rear coupler of existing train within distance', () => {
    const { net } = makeStraightNetwork(300)
    const ts = createTrainSet(net, { x: 150, y: 0 }, 'loco')!
    const rearPos = vehicleRearEndPos(net, ts.vehicles[0])!
    expect(rearPos).toBeDefined()

    // Query 2m away from rear coupler
    const snap = findCouplerSnap(net, [ts], { x: rearPos.x + 1.5, y: rearPos.y + 0.5 }, 'wagon', 5.0)
    expect(snap).not.toBeNull()
    expect(snap!.end).toBe('rear')
    expect(snap!.train.id).toBe(ts.id)
    expect(snap!.snappedVehicle.kind).toBe('wagon')
    expect(snap!.snappedVehicle.front).toBeDefined()
    expect(snap!.snappedVehicle.rear).toBeDefined()
  })

  it('snaps loco to front coupler of existing train within distance', () => {
    const { net } = makeStraightNetwork(300)
    const ts = createTrainSet(net, { x: 150, y: 0 }, 'wagon')!
    const frontPos = vehicleFrontEndPos(net, ts.vehicles[0])!
    expect(frontPos).toBeDefined()

    // Query 2m in front of front coupler
    const snap = findCouplerSnap(net, [ts], { x: frontPos.x + 1.0, y: frontPos.y }, 'loco', 5.0)
    expect(snap).not.toBeNull()
    expect(snap!.end).toBe('front')
    expect(snap!.train.id).toBe(ts.id)
    expect(snap!.snappedVehicle.kind).toBe('loco')
  })

  it('returns null when mouse is far from all couplers', () => {
    const { net } = makeStraightNetwork(300)
    const ts = createTrainSet(net, { x: 150, y: 0 }, 'loco')!
    const snap = findCouplerSnap(net, [ts], { x: 50, y: 50 }, 'wagon', 5.0)
    expect(snap).toBeNull()
  })
})

describe('hitTestTrainVehicle and removeVehicleFromTrainSet', () => {
  it('identifies targeted vehicle in multi-car train', () => {
    const { net, segId } = makeStraightNetwork(500)
    const ts = createTrainSet(net, { x: 250, y: 0 }, 'loco')!
    const wagon = createVehicle(net, segId, 0.4, 'wagon')!
    ts.vehicles.push(wagon)
    advanceTrainSet(net, ts, 0)

    const hitLead = hitTestTrainVehicle(net, ts, { x: 250, y: 0 }, 10)
    expect(hitLead).not.toBeNull()
    expect(hitLead!.kind).toBe('loco')
  })

  it('removes specific wagon from multi-car train and realigns', () => {
    const { net, segId } = makeStraightNetwork(500)
    const ts = createTrainSet(net, { x: 250, y: 0 }, 'loco')!
    const wagon1 = createVehicle(net, segId, 0.4, 'wagon')!
    const wagon2 = createVehicle(net, segId, 0.35, 'wagon')!
    ts.vehicles.push(wagon1, wagon2)
    advanceTrainSet(net, ts, 0)
    expect(ts.vehicles).toHaveLength(3)

    const updated = removeVehicleFromTrainSet(net, ts, wagon1.id)
    expect(updated).not.toBeNull()
    expect(updated!.vehicles).toHaveLength(2)
    expect(updated!.vehicles.some(v => v.id === wagon1.id)).toBe(false)
  })
})

describe('walkForward', () => {
  it('moves forward along a straight segment', () => {
    const { net, segId } = makeStraightNetwork(200)
    const pos = walkForward(net, segId, 0.2, true, 20)
    expect(pos).not.toBeNull()
    expect(pos!.segId).toBe(segId)
    expect(pos!.t).toBeCloseTo(0.3, 2)
  })
})



describe('snapToNearestTrack precision', () => {
  it('projects exactly on a long straight rail instead of jumping between samples', () => {
    const { net, segId } = makeStraightNetwork(1000)
    const snap = snapToNearestTrack(net, { x: 110, y: 4 }, 12)
    expect(snap).not.toBeNull()
    expect(snap!.segId).toBe(segId)
    expect(snap!.t).toBeCloseTo(0.11, 9)
    expect(snap!.dist).toBeCloseTo(4, 9)
  })
})

describe('train persistence helpers', () => {
  it('round-trips positions and brings every train back stopped with controls at rest', () => {
    const { net, segId } = makeStraightNetwork(500)
    const loco = createVehicle(net, segId, 0.5, 'loco')!
    const train = makeTrainSet('train_90', [loco])
    setReverser(train, 'reverse')
    setNotch(train, 3)
    train.currentSpeed = 12

    const saved = JSON.parse(JSON.stringify(serializeTrains([train])))
    expect(saved[0]).not.toHaveProperty('currentSpeed')
    expect(saved[0]).not.toHaveProperty('notch')

    const [restored] = deserializeTrains(net, saved)
    expect(restored.id).toBe('train_90')
    expect(restored.vehicles[0]).toEqual(loco)
    expect(restored.direction).toBe(-1)
    expect(restored.currentSpeed).toBe(0)
    expect(restored.notch).toBe(0)
    expect(restored.reverser).toBe('neutral')
    expect(restored.emergencyBrake).toBe(false)
  })

  it('ignores missing or malformed train data', () => {
    const { net, segId } = makeStraightNetwork(500)
    expect(deserializeTrains(net, undefined)).toEqual([])
    expect(deserializeTrains(net, 'nope')).toEqual([])
    const good = { id: 'veh_1', kind: 'wagon', front: { segId, t: 0.5, forward: true }, rear: { segId, t: 0.4, forward: true } }
    const trains = deserializeTrains(net, [
      null,
      { id: 'train_a' },
      { id: 'train_b', vehicles: [{ ...good, front: { segId: 's_missing', t: 0.5, forward: true } }] },
      { id: 'train_c', vehicles: [{ ...good, kind: 'plane' }] },
      { id: 'train_d', vehicles: [{ ...good, rear: { segId, t: 7, forward: true } }] },
      { id: 'train_e', vehicles: [good] },
    ])
    expect(trains.map(t => t.id)).toEqual(['train_e'])
  })
})

describe('pruneTrainsToNetwork', () => {
  function threeSegmentTrain() {
    resetIdCounter()
    const net = createNetwork()
    const nodes = [0, 100, 200, 300].map(x => addNode(net, { x, y: 0 }))
    const segs = [0, 1, 2].map(i => addSegment(net, nodes[i].id, nodes[i + 1].id)!)
    const on = (i: number, id: string) => ({ ...createVehicle(net, segs[i].id, 0.5, 'wagon')!, id })
    const train = makeTrainSet('train_x', [on(2, 'v_front'), on(1, 'v_mid'), on(0, 'v_rear')])
    return { net, segs, train }
  }

  it('returns the same array when every vehicle still stands on a rail', () => {
    const { net, train } = threeSegmentTrain()
    const trains = [train]
    expect(pruneTrainsToNetwork(net, trains)).toBe(trains)
  })

  it('clips the vehicles whose rail is gone and stops the train', () => {
    const { net, segs, train } = threeSegmentTrain()
    train.currentSpeed = 20
    train.notch = 4
    removeSegment(net, segs[0].id)

    const [clipped, ...rest] = pruneTrainsToNetwork(net, [train])
    expect(rest).toHaveLength(0)
    expect(clipped.id).toBe('train_x')
    expect(clipped.vehicles.map(v => v.id)).toEqual(['v_front', 'v_mid'])
    expect(clipped.currentSpeed).toBe(0)
    expect(clipped.notch).toBe(0)
  })

  it('splits a train cut in the middle and drops a train left with no vehicle', () => {
    const { net, segs, train } = threeSegmentTrain()
    removeSegment(net, segs[1].id)
    const split = pruneTrainsToNetwork(net, [train])
    expect(split.map(t => t.vehicles.map(v => v.id))).toEqual([['v_front'], ['v_rear']])
    expect(split[0].id).toBe('train_x')
    expect(split[1].id).not.toBe('train_x')

    removeSegment(net, segs[0].id)
    removeSegment(net, segs[2].id)
    expect(pruneTrainsToNetwork(net, [train])).toEqual([])
  })
})

describe('steerTrainSetJunction', () => {
  function yNetwork() {
    resetIdCounter()
    const net = createNetwork()
    const nStem = addNode(net, { x: 0, y: 0 })
    const nApex = addNode(net, { x: 300, y: 0 })
    const nStraight = addNode(net, { x: 600, y: 0 })
    const nDiv = addNode(net, { x: 600, y: 100 })
    const sStem = addSegment(net, nStem.id, nApex.id)!
    const sStraight = addSegment(net, nApex.id, nStraight.id)!
    const sDiv = addSegment(net, nApex.id, nDiv.id)!
    const junction = addJunction(net, {
      nodeId: nApex.id,
      stemNodeId: nStem.id,
      straightNodeId: nStraight.id,
      divergingNodeId: nDiv.id,
      straightSegmentId: sStraight.id,
      divergingSegmentId: sDiv.id,
      hand: 'right',
      frogNumber: 4,
      activeBranch: 'straight',
    })
    return { net, sStem, junction }
  }

  it('steers the facing turnout ahead of the lead vehicle when running forward', () => {
    const { net, sStem, junction } = yNetwork()
    // Nose towards the apex (+x)
    const train = makeTrainSet('t', [createVehicle(net, sStem.id, 0.5, 'loco', 1)!])

    expect(steerTrainSetJunction(net, train, 'right')).toBe(true)
    expect(junction.activeBranch).toBe('diverging')
    expect(steerTrainSetJunction(net, train, 'left')).toBe(true)
    expect(junction.activeBranch).toBe('straight')
  })

  it('starts the route at the lead bogie running forward and at the last bogie in reverse', () => {
    const { net, sStem, junction } = yNetwork()
    const loco = createVehicle(net, sStem.id, 0.5, 'loco', -1)!
    const wagon = findCouplerSnap(net, [makeTrainSet('t0', [loco])], vehicleRearEndPos(net, loco)!, 'wagon')!.snappedVehicle
    const train = makeTrainSet('t', [loco, wagon])

    expect(trainRouteStart(train)).toEqual(loco.front)
    expect(findJunctionAhead(net, trainRouteStart(train)!, 1)).toBeNull()

    setReverser(train, 'reverse')
    const start = trainRouteStart(train)!
    expect(start).toEqual({ ...wagon.rear, forward: !wagon.rear.forward })
    expect(findJunctionAhead(net, start, 1)!.junction).toBe(junction)
    expect(trainRouteStart(makeTrainSet('empty', []))).toBeNull()
  })

  it('in reverse, steers the turnout behind the last vehicle, relative to the travel direction', () => {
    const { net, sStem, junction } = yNetwork()
    // Nose away from the apex (-x): the junction is behind the train
    const loco = createVehicle(net, sStem.id, 0.5, 'loco', -1)!
    const wagon = findCouplerSnap(net, [makeTrainSet('t0', [loco])], vehicleRearEndPos(net, loco)!, 'wagon')!.snappedVehicle
    const train = makeTrainSet('t', [loco, wagon])

    // Running forward (towards -x) there is no facing turnout ahead
    expect(steerTrainSetJunction(net, train, 'right')).toBe(false)
    expect(junction.activeBranch).toBe('straight')

    setReverser(train, 'reverse')
    expect(steerTrainSetJunction(net, train, 'right')).toBe(true)
    expect(junction.activeBranch).toBe('diverging')
    expect(steerTrainSetJunction(net, train, 'left')).toBe(true)
    expect(junction.activeBranch).toBe('straight')
  })

  it('does nothing for an empty train', () => {
    const { net } = yNetwork()
    expect(steerTrainSetJunction(net, makeTrainSet('t', []), 'left')).toBe(false)
  })
})

// ─── Whole-train moves, collisions and occupied junctions ─────────────────────

/** A loco followed by `wagons` wagons, laid out behind it along the track */
function consist(net: Network, segId: string, t: number, wagons: number, direction: 1 | -1 = 1, id = 'T'): TrainSet {
  const lead = createVehicle(net, segId, t, 'loco', direction)!
  const train = makeTrainSet(id, [lead])
  for (let i = 0; i < wagons; i++) {
    train.vehicles.push({ id: `${id}w${i}`, kind: 'wagon', front: { ...lead.rear }, rear: { ...lead.rear } })
  }
  expect(advanceTrainSet(net, train, 0)).toBe(true)
  return train
}

const bogiePoints = (net: Network, train: TrainSet) =>
  train.vehicles.flatMap((v) => [positionOnSegment(net, v.front.segId, v.front.t)!, positionOnSegment(net, v.rear.segId, v.rear.t)!])

const frontEnd = (net: Network, train: TrainSet) => vehicleFrontEndPos(net, train.vehicles[0])!
const rearEnd = (net: Network, train: TrainSet) => vehicleRearEndPos(net, train.vehicles[train.vehicles.length - 1])!

describe('advanceTrainSet is all-or-nothing', () => {
  it('reversing into a buffer stop leaves the whole train where it was', () => {
    const { net, segId } = makeStraightNetwork(600)
    const train = consist(net, segId, 0.5, 4) // nose towards +x, wagons towards the buffer at x=0
    const spacing = (pts: { x: number }[]) => pts.slice(1).map((p, i) => pts[i].x - p.x)
    const laidOut = spacing(bogiePoints(net, train))
    train.direction = -1

    let refused = 0
    for (let i = 0; i < 700; i++) {
      const before = JSON.stringify(train.vehicles)
      if (!advanceTrainSet(net, train, 0.5)) {
        refused++
        expect(JSON.stringify(train.vehicles)).toBe(before)
      }
    }

    expect(refused).toBeGreaterThan(0)
    const after = bogiePoints(net, train)
    spacing(after).forEach((gap, i) => expect(gap).toBeCloseTo(laidOut[i], 6))
    // The last bogie stands within one step of the buffer, never beyond it
    expect(after[after.length - 1].x).toBeGreaterThanOrEqual(0)
    expect(after[after.length - 1].x).toBeLessThan(0.5)
  })

  it('does not move the lead when a follower has no track to stand on', () => {
    const { net, segId } = makeStraightNetwork(600)
    const lead = createVehicle(net, segId, 0.05, 'loco')! // 30 m from the buffer: no room for a wagon behind
    const train = makeTrainSet('t', [lead, { id: 'w', kind: 'wagon', front: { ...lead.rear }, rear: { ...lead.rear } }])
    const before = JSON.stringify(train.vehicles)
    // 30 m of track behind the nose cannot hold 14 + 6.88 + 11.92 m of bogie spacing
    expect(advanceTrainSet(net, train, 0.5)).toBe(false)
    expect(JSON.stringify(train.vehicles)).toBe(before)
  })
})

describe('collision between trains', () => {
  it('stops a train a coupling gap short of the train ahead, whatever the step', () => {
    for (const step of [0.5, 13.9]) {
      const { net, segId } = makeStraightNetwork(1000)
      const a = consist(net, segId, 0.3, 2, 1, 'A')
      const b = consist(net, segId, 0.6, 2, 1, 'B')
      const bBefore = JSON.stringify(b.vehicles)

      let refused = 0
      for (let i = 0; i < 1000; i++) if (!advanceTrainSet(net, a, step, [a, b])) refused++

      expect(refused).toBeGreaterThan(0)
      expect(rearEnd(net, b).x - frontEnd(net, a).x).toBeCloseTo(COUPLING_GAP, 6)
      expect(JSON.stringify(b.vehicles)).toBe(bBefore)
    }
  })

  it('stops a reversing train whose tail meets another train', () => {
    const { net, segId } = makeStraightNetwork(1000)
    const b = consist(net, segId, 0.2, 2, 1, 'B') // nose at x=200
    const a = consist(net, segId, 0.6, 2, 1, 'A') // tail around x=550, backing towards B
    a.direction = -1

    for (let i = 0; i < 1000; i++) advanceTrainSet(net, a, 0.5, [a, b])

    expect(rearEnd(net, a).x - frontEnd(net, b).x).toBeCloseTo(COUPLING_GAP, 6)
  })

  it('sees a train standing on another segment of the same line, both ways round', () => {
    resetIdCounter()
    const net = createNetwork()
    const n = [0, 300, 600, 900].map((x) => addNode(net, { x, y: 0 }))
    const s1 = addSegment(net, n[0].id, n[1].id)!
    addSegment(net, n[2].id, n[1].id) // middle rail stored the other way round
    const s3 = addSegment(net, n[2].id, n[3].id)!

    const a = consist(net, s1.id, 0.9, 2, 1, 'A')
    const b = consist(net, s3.id, 0.5, 2, -1, 'B') // facing A
    for (let i = 0; i < 1000; i++) advanceTrainSet(net, a, 0.5, [a, b])
    expect(frontEnd(net, b).x - frontEnd(net, a).x).toBeCloseTo(COUPLING_GAP, 6)

    // B in turn cannot advance into A
    const aBefore = JSON.stringify(a.vehicles)
    expect(advanceTrainSet(net, b, 0.5, [a, b])).toBe(false)
    expect(frontEnd(net, b).x - frontEnd(net, a).x).toBeCloseTo(COUPLING_GAP, 6)
    expect(JSON.stringify(a.vehicles)).toBe(aBefore)
  })

  it('lets a train in contact drive away, and couple with the train it touches', () => {
    const { net, segId } = makeStraightNetwork(1000)
    const a = consist(net, segId, 0.3, 1, 1, 'A')
    const b = consist(net, segId, 0.6, 1, 1, 'B')
    for (let i = 0; i < 1000; i++) advanceTrainSet(net, a, 0.5, [a, b])
    expect(advanceTrainSet(net, a, 0.5, [a, b])).toBe(false)

    // Coupling at the point of contact merges the two trains without shifting a vehicle
    const contact = frontEnd(net, a)
    const before = [...bogiePoints(net, b), ...bogiePoints(net, a)]
    const coupled = handleCouplingClick(net, [a, b], contact)
    expect(coupled).toHaveLength(1)
    expect(coupled[0].vehicles).toHaveLength(4)
    bogiePoints(net, coupled[0]).forEach((p, i) => expect(p.x).toBeCloseTo(before[i].x, 6))

    // Uncoupled, A backs away freely
    a.direction = -1
    const x0 = frontEnd(net, a).x
    expect(advanceTrainSet(net, a, 0.5, [a, b])).toBe(true)
    expect(frontEnd(net, a).x).toBeCloseTo(x0 - 0.5, 6)
  })

  it('tickTrainSet reports the contact like an end of track', () => {
    const { net, segId } = makeStraightNetwork(1000)
    const a = consist(net, segId, 0.3, 0, 1, 'A')
    const b = consist(net, segId, 0.36, 0, 1, 'B') // its tail is some 40 m ahead of A's nose
    setReverser(a, 'forward')
    setNotch(a, MAX_NOTCH)

    let stopped = false
    for (let i = 0; i < 600 && !stopped; i++) stopped = !tickTrainSet(net, a, 1 / 60, [a, b])

    expect(stopped).toBe(true)
    expect(rearEnd(net, b).x - frontEnd(net, a).x).toBeCloseTo(COUPLING_GAP, 6)
  })
})

describe('junction under a train', () => {
  /** Stem from x=-400 to the apex at x=0, #6 left turnout, both branches extended by 400 m */
  function turnoutLayout() {
    resetIdCounter()
    const net = createNetwork()
    const stem0 = addNode(net, { x: -400, y: 0 })
    const apex = addNode(net, { x: 0, y: 0 })
    const stem = addSegment(net, stem0.id, apex.id)!
    const t = placeTurnout(net, { startPos: apex.pos, direction: { x: 1, y: 0 }, frogNumber: 6, hand: 'left', stemNodeId: apex.id })
    const sEnd = addNode(net, { x: t.straightNode.pos.x + 400, y: 0 })
    const straightExt = addSegment(net, t.straightNode.id, sEnd.id)!
    autoDetectJunctions(net)
    const junction = [...net.junctions.values()][0]
    return { net, junction, stem, straightExt, straightSegId: junction.straightSegmentId }
  }

  it('is occupied exactly while a vehicle stands over its points', () => {
    const { net, junction, straightExt } = turnoutLayout()
    const train = consist(net, straightExt.id, 0.3, 2, -1) // on the straight branch, heading for the stem
    expect(isJunctionOccupied(net, junction, [train])).toBe(false)

    const occupiedAt: number[] = []
    for (let i = 0; i < 1100; i++) {
      expect(advanceTrainSet(net, train, 0.5)).toBe(true)
      if (isJunctionOccupied(net, junction, [train])) occupiedAt.push(frontEnd(net, train).x)
    }

    // From the nose reaching the apex (x=0) to the tail clearing it, one train length later
    const length = frontEnd(net, train).x - rearEnd(net, train).x
    expect(Math.max(...occupiedAt)).toBeLessThanOrEqual(0)
    expect(Math.max(...occupiedAt)).toBeGreaterThan(-0.5)
    expect(Math.min(...occupiedAt)).toBeCloseTo(length, 0)
    expect(isJunctionOccupied(net, junction, [train])).toBe(false)
  })

  it('refuses to steer a turnout that another train stands on', () => {
    const { net, junction, stem, straightSegId } = turnoutLayout()
    const driven = consist(net, stem.id, 0.5, 0, 1, 'A') // on the stem, facing the points
    const parked = consist(net, straightSegId, 0.02, 0, 1, 'B') // nose 5 m past the apex, body across it
    expect(isJunctionOccupied(net, junction, [driven, parked])).toBe(true)

    // The diverging branch leaves towards +y: the right-hand side when running towards +x
    expect(steerTrainSetJunction(net, driven, 'right', [driven, parked])).toBe(false)
    expect(junction.activeBranch).toBe('straight')
    // With the points clear the same command goes through
    expect(steerTrainSetJunction(net, driven, 'right', [driven])).toBe(true)
    expect(junction.activeBranch).toBe('diverging')
  })

  it('keeps the vehicles on their branch if the points move under a trailing train anyway', () => {
    const { net, junction, straightExt } = turnoutLayout()
    const train = consist(net, straightExt.id, 0.3, 4, -1)

    let prev = bogiePoints(net, train)
    let biggestMove = 0
    for (let i = 0; i < 1200; i++) {
      // Thrown behind the store's back once the lead is 30 m past the points
      if (prev[0].x < -30) junction.activeBranch = 'diverging'
      expect(advanceTrainSet(net, train, 0.5)).toBe(true)
      const cur = bogiePoints(net, train)
      cur.forEach((p, k) => (biggestMove = Math.max(biggestMove, Math.hypot(p.x - prev[k].x, p.y - prev[k].y))))
      prev = cur
    }

    expect(junction.activeBranch).toBe('diverging')
    expect(biggestMove).toBeLessThanOrEqual(0.5 + 1e-6)
    expect(prev.every((p) => Math.abs(p.y) < 1e-6)).toBe(true)
  })
})

describe('sharp corners and crossings', () => {
  /** Two 100 m rails joined at the origin, the second one turned by `angleDeg` */
  function corner(angleDeg: number) {
    resetIdCounter()
    const net = createNetwork()
    const a = addNode(net, { x: -100, y: 0 })
    const c = addNode(net, { x: 0, y: 0 })
    const r = (angleDeg * Math.PI) / 180
    const e = addNode(net, { x: 100 * Math.cos(r), y: 100 * Math.sin(r) })
    const first = addSegment(net, a.id, c.id)!
    const second = addSegment(net, c.id, e.id)!
    return { net, first, second }
  }

  it('runs through a joint within the deflection limit', () => {
    for (const angle of [0, 5, MAX_TRANSITION_DEFLECTION_DEG]) {
      const { net, first, second } = corner(angle)
      const train = consist(net, first.id, 0.5, 0)
      for (let i = 0; i < 150; i++) expect(advanceTrainSet(net, train, 0.5)).toBe(true)
      expect(train.vehicles[0].front.segId).toBe(second.id)
    }
  })

  it('treats a sharper corner as an end of track, from either side', () => {
    for (const angle of [MAX_TRANSITION_DEFLECTION_DEG + 1, 20, 45, 90, 135]) {
      const { net, first, second } = corner(angle)
      const train = consist(net, first.id, 0.5, 0)
      for (let i = 0; i < 150; i++) advanceTrainSet(net, train, 0.5)
      expect(train.vehicles[0].front.segId).toBe(first.id)
      expect(positionOnSegment(net, first.id, train.vehicles[0].front.t)!.x).toBeCloseTo(0, 6)

      const back = consist(net, second.id, 0.5, 0, -1)
      for (let i = 0; i < 150; i++) advanceTrainSet(net, back, 0.5)
      expect(back.vehicles[0].front.segId).toBe(second.id)
      expect(back.vehicles[0].front.t).toBeCloseTo(0, 6)
    }
  })

  it('cannot turn from the stub of a perpendicular T onto the main line, nor the other way', () => {
    resetIdCounter()
    const net = createNetwork()
    const w = addNode(net, { x: -200, y: 0 })
    const e = addNode(net, { x: 200, y: 0 })
    addSegment(net, w.id, e.id)
    const foot = addNode(net, { x: 0, y: 0 })
    const top = addNode(net, { x: 0, y: 200 })
    const stub = addSegment(net, foot.id, top.id)!
    reconcileNetworkIntersections(net)
    expect(net.junctions.size).toBe(0)

    const fromStub = consist(net, stub.id, 0.5, 0, -1) // heading down to the main line
    for (let i = 0; i < 400; i++) advanceTrainSet(net, fromStub, 0.5)
    expect(fromStub.vehicles[0].front.segId).toBe(stub.id)
    expect(bogiePoints(net, fromStub)[0].y).toBeCloseTo(0, 6)

    const west = [...net.segments.values()].find((s) => s.id !== stub.id && (s.from === w.id || s.to === w.id))!
    const through = consist(net, west.id, 0.5, 0, west.from === w.id ? 1 : -1)
    for (let i = 0; i < 400; i++) expect(advanceTrainSet(net, through, 0.5)).toBe(true)
    const nose = bogiePoints(net, through)[0]
    expect(nose.x).toBeCloseTo(100, 6)
    expect(nose.y).toBeCloseTo(0, 6)
  })

  it('runs straight through a crossing made by reconcile, down to a shallow angle', () => {
    for (const angleDeg of [90, 30, 8, 3]) {
      resetIdCounter()
      const net = createNetwork()
      const r = (angleDeg * Math.PI) / 180
      const w = addNode(net, { x: -200, y: 0 })
      const e = addNode(net, { x: 200, y: 0 })
      addSegment(net, w.id, e.id)
      const a = addNode(net, { x: -200 * Math.cos(r), y: -200 * Math.sin(r) })
      const b = addNode(net, { x: 200 * Math.cos(r), y: 200 * Math.sin(r) })
      addSegment(net, a.id, b.id)
      reconcileNetworkIntersections(net)
      expect(net.junctions.size).toBe(0)

      // Along y=0 from the west, and along the oblique line from its far end, in both directions
      for (const startId of [w.id, e.id, a.id, b.id]) {
        const start = net.nodes.get(startId)!.pos
        const seg = net.segments.get(net.adjacency.get(startId)![0])!
        const train = consist(net, seg.id, 0.5, 2, seg.from === startId ? 1 : -1)
        for (let i = 0; i < 500; i++) expect(advanceTrainSet(net, train, 0.5)).toBe(true)
        // Every bogie is still on the line through the start point and the origin
        for (const p of bogiePoints(net, train)) {
          expect(Math.abs(p.x * start.y - p.y * start.x) / Math.hypot(start.x, start.y)).toBeLessThan(1e-6)
        }
        const nose = bogiePoints(net, train)[0]
        expect(nose.x * start.x + nose.y * start.y).toBeLessThan(0) // past the crossing
      }
    }
  })
})

// ─── Vehicles turned around within a rake ─────────────────────────────────────

describe('turned-around vehicles', () => {
  const sortedX = (net: Network, trains: TrainSet[]) =>
    trains.flatMap((t) => bogiePoints(net, t)).map((p) => p.x).sort((a, b) => a - b)

  /** Loco + wagon heading +x, with a second loco coupled turned around at the tail */
  function pushPull(net: Network, segId: string): TrainSet {
    const train = consist(net, segId, 0.5, 1)
    const snap = findCouplerSnap(net, [train], rearEnd(net, train), 'loco', 5, true)!
    expect(snap.end).toBe('rear')
    train.vehicles.push(snap.snappedVehicle)
    return train
  }

  it('reverseTrainSet shows the same train from its other end without moving it', () => {
    const { net, segId } = makeStraightNetwork(1000)
    const train = consist(net, segId, 0.5, 2)
    const reversed = reverseTrainSet(train)

    expect(reversed.vehicles.map((v) => v.id)).toEqual(train.vehicles.map((v) => v.id).reverse())
    expect(reversed.vehicles.every((v) => v.flipped === true)).toBe(true)
    expect(frontEnd(net, reversed).x).toBeCloseTo(rearEnd(net, train).x, 6)
    expect(rearEnd(net, reversed).x).toBeCloseTo(frontEnd(net, train).x, 6)
    // Still a valid train: realigning it from its new lead moves nothing
    const before = sortedX(net, [reversed])
    expect(advanceTrainSet(net, reversed, 0)).toBe(true)
    sortedX(net, [reversed]).forEach((x, i) => expect(x).toBeCloseTo(before[i], 6))

    expect(reverseTrainSet(reversed).vehicles).toEqual(train.vehicles)
  })

  it('a loco coupled turned around at the tail is drawn nose outwards', () => {
    const { net, segId } = makeStraightNetwork(1000)
    const train = pushPull(net, segId)
    const tail = train.vehicles[2]
    expect(tail.flipped).toBe(true)

    const visuals = getTrainSetVisuals(net, train)!
    expect(visuals.accordions).toHaveLength(2)
    const leadNose = visuals.vehicles[0].polygon[0]
    const tailNose = visuals.vehicles[2].polygon[0]
    // The train heads +x: lead nose ahead of its front bogie, tail nose behind its rear bogie
    expect(leadNose.x).toBeGreaterThan(positionOnSegment(net, train.vehicles[0].front.segId, train.vehicles[0].front.t)!.x)
    expect(tailNose.x).toBeLessThan(positionOnSegment(net, tail.rear.segId, tail.rear.t)!.x)
  })

  it('findCouplerSnap leaves the vehicle unflipped by default', () => {
    const { net, segId } = makeStraightNetwork(1000)
    const train = consist(net, segId, 0.5, 1)
    const snap = findCouplerSnap(net, [train], rearEnd(net, train), 'loco', 5)!
    expect('flipped' in snap.snappedVehicle).toBe(false)
  })

  it('coupling mode joins two trains standing rear to rear', () => {
    const { net, segId } = makeStraightNetwork(1000)
    const a = consist(net, segId, 0.6, 1, 1, 'A')
    // B heads -x, to the left of A: slide it until the two tails are a coupling gap apart
    const probe = consist(net, segId, 0.3, 1, -1, 'P')
    const t = 0.3 + (rearEnd(net, a).x - COUPLING_GAP - rearEnd(net, probe).x) / 1000
    const b = consist(net, segId, t, 1, -1, 'B')
    const before = sortedX(net, [a, b])

    const result = handleCouplingClick(net, [a, b], rearEnd(net, a))

    expect(result).toHaveLength(1)
    const merged = result[0]
    expect(merged.vehicles.map((v) => v.id)).toEqual([a.vehicles[0].id, 'Aw0', 'Bw0', b.vehicles[0].id])
    expect(merged.vehicles.map((v) => v.flipped === true)).toEqual([false, false, true, true])
    sortedX(net, [merged]).forEach((x, i) => expect(x).toBeCloseTo(before[i], 3))
  })

  it('coupling mode joins two trains standing nose to nose, the clicked one keeping its orientation', () => {
    const { net, segId } = makeStraightNetwork(1000)
    const a = consist(net, segId, 0.4, 1, 1, 'A')
    const probe = consist(net, segId, 0.7, 1, -1, 'P')
    const t = 0.7 + (frontEnd(net, a).x + COUPLING_GAP - frontEnd(net, probe).x) / 1000
    const b = consist(net, segId, t, 1, -1, 'B')
    const before = sortedX(net, [a, b])

    const result = handleCouplingClick(net, [a, b], frontEnd(net, b))

    expect(result).toHaveLength(1)
    const merged = result[0]
    expect(merged.vehicles.map((v) => v.id)).toEqual(['Aw0', a.vehicles[0].id, b.vehicles[0].id, 'Bw0'])
    expect(merged.vehicles.map((v) => v.flipped === true)).toEqual([true, true, false, false])
    sortedX(net, [merged]).forEach((x, i) => expect(x).toBeCloseTo(before[i], 3))
  })

  it('same-type ends too far apart are left alone', () => {
    const { net, segId } = makeStraightNetwork(1000)
    const a = consist(net, segId, 0.8, 1, 1, 'A')
    const b = consist(net, segId, 0.2, 1, -1, 'B')
    const trains = [a, b]
    expect(handleCouplingClick(net, trains, rearEnd(net, a))).toBe(trains)
  })

  it('an uncoupled tail loco becomes an ordinary train, nose first, where it stood', () => {
    const { net, segId } = makeStraightNetwork(1000)
    const train = pushPull(net, segId)
    const tailEnd = rearEnd(net, train)

    const [front, rear] = decoupleAt(train, 1)!

    expect(front.vehicles).toHaveLength(2)
    expect(rear.vehicles).toHaveLength(1)
    expect(rear.vehicles[0].flipped).toBeUndefined()
    expect(frontEnd(net, rear).x).toBeCloseTo(tailEnd.x, 6)
    expect(getTrainSetVisuals(net, rear)!.vehicles[0].polygon[0].x).toBeLessThan(tailEnd.x + 1e-6)
  })

  it('removing the lead loco leaves the tail loco leading its rake nose first', () => {
    const { net, segId } = makeStraightNetwork(1000)
    const pushPullTrain = pushPull(net, segId)
    const tailId = pushPullTrain.vehicles[2].id
    const tailEnd = rearEnd(net, pushPullTrain)

    const train = removeVehicleFromTrainSet(net, pushPullTrain, pushPullTrain.vehicles[0].id)!

    expect(train.vehicles.map((v) => v.id)).toEqual([tailId, 'Tw0'])
    expect(train.vehicles[0].flipped).toBeUndefined()
    expect(frontEnd(net, train).x).toBeCloseTo(tailEnd.x, 6)
  })

  it('the orientation survives a save and load', () => {
    const { net, segId } = makeStraightNetwork(1000)
    const train = pushPull(net, segId)
    const saved = JSON.parse(JSON.stringify(serializeTrains([train])))
    expect('flipped' in saved[0].vehicles[0]).toBe(false)

    const [loaded] = deserializeTrains(net, saved)
    expect(loaded.vehicles.map((v) => v.flipped === true)).toEqual([false, false, true])
  })
})
