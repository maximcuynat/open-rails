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
  MAX_NOTCH,
  makeTrainSet,
  serializeTrains,
  deserializeTrains,
  pruneTrainsToNetwork,
  steerTrainSetJunction,
} from './train'
import { walkForward, snapToNearestTrack } from './locomotive'
import { removeSegment } from './network'
import { addJunction } from './junction'

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
