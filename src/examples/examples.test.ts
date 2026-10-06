import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EXAMPLES } from './index'
import { drive, driveFlatOut, headOf, openExample, readExample, steerPointsTo } from './driving.testkit'
import { EditorStore } from '@application/state/editorStore'
import { deserializeNetwork, resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { findJunctionAtNode } from '@domain/models/junction'
import { positionOnSegment } from '@domain/models/locomotive'
import { resetIdCounter } from '@domain/models/network'
import { referenceConsist } from '@domain/models/rollingStock'
import { nodeReservedBy, signalStatus } from '@domain/models/signalling'
import { signalReport } from '@domain/models/signalReport'
import { turnoutDivergingSpeed } from '@domain/models/trackSpeed'
import type { Junction, Signal } from '@domain/models/types'
import { analyzeKinematics } from '@domain/services/kinematicDiagnostics'
import { signalWorldPosition } from '@domain/services/signalLayout'
import { networkChanged } from '@domain/models/networkWatch'

// The drives simulate minutes of running step by step (three seconds of test on the 1 500 rails of
// Marseille, more when the whole suite runs at once): well over the default five seconds
vi.setConfig({ testTimeout: 30_000 })

/** The one example that is not drawn by hand: it has no camera of its own and opens framed whole */
const IMPORTED = 'marseille-saint-charles'

/** What a player does before the train of an example can be driven off, when F5 is not enough */
const BEFORE_LEAVING: Record<string, (store: EditorStore) => void> = {
  // The train stands nose to the buffer stop: the cab at the other end is taken (Tab)
  terminus: (store) => {
    expect(store.switchSelectedTrainCab()).toBe(true)
  },
}

/** The points at a place of the world */
function pointsAt(store: EditorStore, x: number, y: number): Junction {
  for (const node of store.network.nodes.values()) {
    if (Math.hypot(node.pos.x - x, node.pos.y - y) > 1) continue
    const junction = findJunctionAtNode(store.network, node.id)
    if (junction) return junction
  }
  throw new Error(`no points at ${x}, ${y}`)
}

/** The signal standing at a place of the world */
function signalAt(store: EditorStore, x: number, y: number): Signal {
  for (const signal of store.network.signals.values()) {
    const pos = signalWorldPosition(store.network, signal)
    if (pos && Math.hypot(pos.x - x, pos.y - y) < 1) return signal
  }
  throw new Error(`no signal at ${x}, ${y}`)
}

const stateOf = (store: EditorStore, signal: Signal): string => signalStatus(store.signalling, signal).state

/** F5: take the controls of the first train of the example */
function takeControls(id: string): EditorStore {
  const store = openExample(id)
  store.togglePlayMode()
  expect(store.isPlayMode).toBe(true)
  expect(store.selectedTrain).toBe(store.trains[0])
  return store
}

describe('example networks', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetIdCounter()
  })

  it('names every example once', () => {
    const ids = EXAMPLES.map((example) => example.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const example of EXAMPLES) {
      expect(example.label).not.toBe('')
      expect(example.url).toContain(example.id)
    }
  })

  it('lists the imported station last', () => {
    expect(EXAMPLES[EXAMPLES.length - 1].id).toBe(IMPORTED)
  })

  for (const example of EXAMPLES) {
    describe(example.label, () => {
      it('is read as it is written: nothing to weld, cut or drop', () => {
        const data = readExample(example.id)
        const { network, trains } = deserializeNetwork(data)

        expect([...network.nodes.keys()].sort()).toEqual(data.nodes.map((node) => node.id).sort())
        expect([...network.segments.keys()].sort()).toEqual(data.segments.map((seg) => seg.id).sort())
        // The imported station carries no route table: they are read from its track
        if (data.junctions) expect([...network.junctions.keys()].sort()).toEqual(data.junctions.map((junction) => junction.id).sort())
        expect(network.speedZones.size).toBe(data.speedZones?.length ?? 0)
        expect(network.signals.size).toBe(data.signals?.length ?? 0)
        expect(trains.map((train) => train.vehicles.length)).toEqual((data.trains ?? []).map((train) => train.vehicles.length))
        for (const [nodeId, rails] of network.adjacency) {
          expect(rails.length, `rails at ${nodeId}`).toBeGreaterThan(0)
        }
      })

      it('opens in the editor and comes back out whole', () => {
        const data = readExample(example.id)
        const store = new EditorStore()
        store.loadFromData(data)

        expect(store.projectName).toBe(data.name)
        expect(store.scalePreset).toBe(data.scalePreset)
        expect(store.scalePreset).toBe('1:1')
        const out = store.exportProject()
        expect(out.nodes).toHaveLength(data.nodes.length)
        expect(out.segments).toHaveLength(data.segments.length)
        // A hand-made example is the very file the editor would save
        if (example.id !== IMPORTED) expect(JSON.parse(JSON.stringify(out))).toEqual(data)
      })

      it('has no sharp corner, gap or over-steep ramp', () => {
        const store = openExample(example.id)
        expect(analyzeKinematics(store.network, store.gauge, store.gradientLimits)).toEqual([])
      })

      it('has a signalling the control report finds nothing against', () => {
        const store = openExample(example.id)
        expect(store.signallingLevel).toBe('standard')
        expect(signalReport(store.network, { level: store.signallingLevel, line: store.lineSettings })).toEqual([])
      })

      it('has a complete trainset standing on its track', () => {
        const store = openExample(example.id)
        expect(store.trains.length).toBeGreaterThan(0)
        for (const train of store.trains) {
          expect(train.vehicles.map((veh) => [veh.kind, veh.flipped === true])).toEqual(
            referenceConsist('duplex').map((veh) => [veh.kind, veh.flipped === true]),
          )
          for (const veh of train.vehicles) {
            for (const bogie of [veh.front, veh.rear]) {
              expect(store.network.segments.has(bogie.segId), `${veh.id} on ${bogie.segId}`).toBe(true)
              expect(bogie.t).toBeGreaterThanOrEqual(0)
              expect(bogie.t).toBeLessThanOrEqual(1)
            }
          }
        }
      })

      it('opens on its train', () => {
        const data = readExample(example.id)
        if (example.id === IMPORTED) {
          // Framed whole by the menu: the station is the subject
          expect(data.camera).toBeUndefined()
          return
        }
        // The whole of the first train is in view, even in a small window
        const store = openExample(example.id)
        const view = { w: 1024, h: 600 }
        for (const veh of store.trains[0].vehicles) {
          for (const bogie of [veh.front, veh.rear]) {
            const pos = positionOnSegment(store.network, bogie.segId, bogie.t)!
            const screen = {
              x: view.w / 2 + (pos.x - store.camera.x) * store.camera.scale,
              y: view.h / 2 + (pos.y - store.camera.y) * store.camera.scale,
            }
            expect(screen.x).toBeGreaterThan(40)
            expect(screen.x).toBeLessThan(view.w - 40)
            expect(screen.y).toBeGreaterThan(40)
            expect(screen.y).toBeLessThan(view.h - 40)
          }
        }
      })

      it('lets its train be driven off: brake released, reverser forward, traction', () => {
        const store = takeControls(example.id)
        BEFORE_LEAVING[example.id]?.(store)
        const train = store.selectedTrain!
        // Every train starts at rest with its brakes applied
        expect(train.currentSpeed).toBe(0)
        expect(train.brakeCylinder).toBe(1)

        const log = drive(store, (run) => run.distance >= 300, 300)

        expect(log.faults).toEqual([])
        expect(log.distance).toBeGreaterThanOrEqual(300)
      })
    })
  }

  it('Marseille Saint-Charles has its turnouts and double slips', () => {
    const { network } = deserializeNetwork(readExample('marseille-saint-charles'))
    const kinds = new Map<string, number>()
    for (const junction of network.junctions.values()) kinds.set(junction.kind, (kinds.get(junction.kind) ?? 0) + 1)

    expect(kinds.get('turnout')).toBe(124)
    expect(kinds.get('double_slip')).toBe(20)
  })
})

describe('what each example is about', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetIdCounter()
  })

  it('Premiers tours de roue: the train reaches the line speed and stops short of the buffer stop', () => {
    const store = takeControls('premiers-tours-de-roue')
    const train = store.selectedTrain!
    let top = 0
    // The driver stops 50 m before the end of the line
    const log = drive(
      store,
      (run) => {
        top = Math.max(top, train.currentSpeed)
        return run.distance > 1000 && train.currentSpeed === 0
      },
      400,
      () => 4950 - headOf(store, train).x,
    )

    expect(log.faults).toEqual([])
    expect(top * 3.6).toBeGreaterThan(150)
    expect(headOf(store, train).x).toBeGreaterThan(4850)
    expect(headOf(store, train).x).toBeLessThan(4990)
  })

  it('Rampe et courbe: the limit of the curve is announced on the ramp, and held through the curve', () => {
    const store = takeControls('rampe-et-courbe')
    const train = store.selectedTrain!
    expect(store.network.speedZones.size).toBe(1)
    const zone = [...store.network.speedZones.values()][0]

    // On the ramp: 35 ‰ under the train, and the curve announced ahead
    drive(store, () => headOf(store, train).x > 2000, 300)
    const onRamp = store.selectedTrainDynamics!
    expect(onRamp.gradientPermille).toBeGreaterThan(34.5)
    expect(onRamp.gradientPermille).toBeLessThanOrEqual(35)
    expect(onRamp.speedLimit * 3.6).toBeCloseTo(120, 6)
    expect(onRamp.nextSpeedLimit?.speed).toBe(zone.speed)
    expect(onRamp.nextSpeedLimit!.distance).toBeGreaterThan(100)

    // Through the curve at its speed, then down the other side
    let fastestInCurve = 0
    const log = drive(store, () => {
      const head = headOf(store, train)
      if (head.y > 1 && head.y < 250) fastestInCurve = Math.max(fastestInCurve, train.currentSpeed)
      return head.y > 600
    }, 300)
    expect(log.faults).toEqual([])
    expect(fastestInCurve * 3.6).toBeGreaterThan(50)
    expect(fastestInCurve * 3.6).toBeLessThanOrEqual(zone.speed)
    expect(store.selectedTrainDynamics!.gradientPermille).toBeLessThan(-30)
  })

  it('Rampe et courbe: driven flat out, the train leaves the rails in the curve', () => {
    const store = takeControls('rampe-et-courbe')
    const train = store.selectedTrain!
    driveFlatOut(store, () => train.derailed !== null, 300)

    expect(train.derailed).not.toBeNull()
    expect(train.derailed!.limit).toBe(70)
    expect(train.derailed!.speed).toBeGreaterThan(110)
    // In the curve, at the summit
    expect(headOf(store, train).level).toBe(4)
    expect(headOf(store, train).y).toBeGreaterThan(0)
  })

  it('Saut-de-mouton: the train climbs to the bridge, crosses the line a level above it and comes back down', () => {
    const store = takeControls('saut-de-mouton')
    const train = store.selectedTrain!
    let steepest = 0
    let crossedAt: number | null = null
    const log = drive(store, () => {
      const head = headOf(store, train)
      steepest = Math.max(steepest, Math.abs(store.selectedTrainDynamics!.gradientPermille))
      // Over the two tracks of the line, at y = ±1.9
      if (crossedAt === null && head.y > 0) crossedAt = head.level
      return head.y > 250 && head.level === 0
    }, 300)

    expect(log.faults).toEqual([])
    expect(crossedAt).toBe(1)
    expect(steepest).toBeGreaterThan(20)
    expect(steepest).toBeLessThanOrEqual(25 + 1e-6)
    expect(steepest).toBeLessThanOrEqual(store.maxGradient)
    expect(headOf(store, train).level).toBe(0)
  })

  it('Bifurcation: with the points thrown, the signal opens for the branch and the train holds the points', () => {
    const store = takeControls('bifurcation')
    const train = store.selectedTrain!
    const points = pointsAt(store, 0, -1.9)
    const pathSignal = signalAt(store, -20, -1.9)
    expect(points.active).toBe(0)
    store.tickAllTrains(0.1)
    expect(stateOf(store, pathSignal)).toBe('stop')

    // The driver throws the points ahead for the branch, then runs up to them
    store.setSelectedTrainReverser('forward')
    expect(steerPointsTo(store, points.id, 1)).toBe(true)
    drive(store, () => headOf(store, train).x > -150, 200)
    expect(stateOf(store, pathSignal)).not.toBe('stop')
    expect(signalStatus(store.signalling, pathSignal).clearedFor).toBe(train.id)
    expect(nodeReservedBy(store.signalling, points.nodeId)).toBe(train.id)
    // Held for the train: a click on the points is refused
    expect(store.toggleActiveJunction(points.id)).toBe(false)
    expect(points.active).toBe(1)

    // …and takes the branch, at the speed of the points
    let fastestOnPoints = 0
    const log = drive(store, () => {
      const head = headOf(store, train)
      if (head.x > 0 && head.x < 300) fastestOnPoints = Math.max(fastestOnPoints, train.currentSpeed)
      return head.y < -200
    }, 300)
    expect(log.faults).toEqual([])
    expect(headOf(store, train).y).toBeLessThan(-200)
    expect(turnoutDivergingSpeed(store.network, points, store.lineSettings)).toBe(90)
    expect(fastestOnPoints * 3.6).toBeLessThanOrEqual(90)
  })

  it('Terminus: after a cab switch the train leaves its platform track for the line', () => {
    const store = takeControls('terminus')
    const before = store.selectedTrain!
    const nose = headOf(store, before).x
    const exit = signalAt(store, 0, 10.9)
    expect(store.switchSelectedTrainCab()).toBe(true)
    const train = store.selectedTrain!
    // The other end of the same rake: its head is now 190 m further from the buffer stop
    expect(train.vehicles).toHaveLength(before.vehicles.length)
    expect(headOf(store, train).x).toBeLessThan(nose - 180)

    let opened = false
    let fastestInStation = 0
    const log = drive(store, () => {
      const head = headOf(store, train)
      if (signalStatus(store.signalling, exit).clearedFor === train.id) opened = true
      if (head.x > -400) fastestInStation = Math.max(fastestInStation, train.currentSpeed)
      return head.x < -1000
    }, 300)

    expect(log.faults).toEqual([])
    expect(opened).toBe(true)
    // Out on the departure track, the southern one
    expect(headOf(store, train).x).toBeLessThan(-1000)
    expect(headOf(store, train).y).toBeCloseTo(1.9, 6)
    expect(fastestInStation * 3.6).toBeLessThanOrEqual(60)
  })

  it('Gare de passage: a high-speed line, its platform tracks at the speed of their points', () => {
    const store = openExample('gare-de-passage')
    expect(store.lineSettings).toMatchObject({ lineSpeed: 300, lineType: 'highSpeed' })
    const speeds = [...store.network.junctions.values()].map((junction) => turnoutDivergingSpeed(store.network, junction, store.lineSettings))
    expect(speeds).toEqual([160, 160, 160, 160])
    expect([...store.network.speedZones.values()].map((zone) => zone.speed)).toEqual([160, 160])
    const roles = [...store.network.signals.values()].map((signal) => signal.role)
    expect(roles.filter((role) => role === 'spacing')).toHaveLength(4)
    expect(roles.filter((role) => role === 'protection')).toHaveLength(6)
  })

  it('Gare de passage: the train at the platform leaves, then the second one runs through on the centre track', () => {
    const store = takeControls('gare-de-passage')
    const [atPlatform, through] = store.trains
    const exitPoints = pointsAt(store, 650, -2.25)
    const platformExit = signalAt(store, 290, -12.25)
    store.tickAllTrains(0.1)
    // Parked, the train has asked for nothing: its exit signal is closed
    expect(stateOf(store, platformExit)).toBe('stop')

    let opened = false
    // It is stopped again beyond the next block signal, out of the way of the second train (a
    // train left to itself keeps its handle where it was)
    const leaving = drive(
      store,
      () => {
        if (signalStatus(store.signalling, platformExit).clearedFor === atPlatform.id) opened = true
        return headOf(store, atPlatform).x > 6100 && atPlatform.currentSpeed === 0
      },
      400,
      () => 6400 - headOf(store, atPlatform).x,
    )
    expect(leaving.faults).toEqual([])
    expect(opened).toBe(true)
    expect(headOf(store, atPlatform).y).toBeCloseTo(-2.25, 6)

    // The second train is taken (a click on it), and runs into the station on the centre track
    store.selectTrainById(through.id)
    expect(store.selectedTrain).toBe(through)
    const arriving = drive(store, () => headOf(store, through).x > 0, 300)
    expect(arriving.faults).toEqual([])
    // The points at the exit are still set for the platform track: its driver puts them back
    expect(steerPointsTo(store, exitPoints.id, 0)).toBe(true)
    let fastest = 0
    const running = drive(store, () => {
      fastest = Math.max(fastest, through.currentSpeed)
      return headOf(store, through).x > 2000
    }, 300)
    expect(running.faults).toEqual([])
    expect(headOf(store, through).y).toBeCloseTo(-2.25, 6)
    // Through the station without stopping, faster than the platform tracks allow
    expect(fastest * 3.6).toBeGreaterThan(160)
  })
})

/**
 * « Voie unique avec évitement »: the crossing at the loop, driven the way a player drives it. The
 * train that arrives first is left waiting at its exit signal, reverser forward; nobody is parked.
 */
describe('Voie unique avec évitement: the two trains cross at the loop', () => {
  const ID = 'voie-unique-evitement'
  const LOOP_Y = 4.5

  beforeEach(() => {
    resetMemoryStorage()
    resetIdCounter()
  })

  it('is signalled the French way, with a train on each side', () => {
    const store = openExample(ID)
    // An entry signal before each set of points, an exit signal at each end of each loop track, all path signals
    expect([...store.network.signals.values()].map((signal) => signal.role)).toEqual(Array(6).fill('protection'))
    for (const [x, y] of [[-510, 0], [510, 0], [400, 0], [-400, 0], [400, LOOP_Y], [-400, LOOP_Y]]) signalAt(store, x, y)
    expect(store.trains).toHaveLength(2)
    expect(headOf(store, store.trains[0]).x).toBeLessThan(-1000)
    expect(headOf(store, store.trains[1]).x).toBeGreaterThan(1000)
  })

  /** How the player throws points: a click on them, or the steering keys of the driven train */
  const THROWS = {
    'a click on the points': (store: EditorStore, points: Junction, position: number): boolean =>
      points.active === position || (store.toggleActiveJunction(points.id) && points.active === position),
    'the steering keys': (store: EditorStore, points: Junction, position: number): boolean => steerPointsTo(store, points.id, position),
  }

  for (const order of ['as listed', 'reversed'] as const) {
    for (const [how, throwPoints] of Object.entries(THROWS)) {
      it(`trains ${order} in the list, points thrown with ${how}`, () => {
        const store = openExample(ID)
        const [first, second] = store.trains
        if (order === 'reversed') store.trains = [second, first]
        store.togglePlayMode()
        const eastPoints = pointsAt(store, 500, 0)
        const westPoints = pointsAt(store, -500, 0)
        const exitOfFirst = signalAt(store, 400, 0)
        const entryOfSecond = signalAt(store, 510, 0)
        const exitOfSecond = signalAt(store, -400, LOOP_Y)

        // 1. The first train runs in from the west on the main track and stops at its exit signal,
        // closed: the second train stands on the single track beyond
        store.selectTrainById(first.id)
        const arrival = drive(store, () => headOf(store, first).x > 0 && first.currentSpeed === 0, 300)
        expect(arrival.faults).toEqual([])
        expect(headOf(store, first).x).toBeGreaterThan(300)
        expect(headOf(store, first).x).toBeLessThan(400)
        expect(stateOf(store, exitOfFirst)).toBe('stop')
        // It is left as it is: stopped, reverser forward
        expect(first.reverser).toBe('forward')

        // 2. The second train is taken and the east points are thrown for the loop track: they are
        // against the first train, which neither gets its signal nor takes them
        store.selectTrainById(second.id)
        store.setSelectedTrainReverser('forward')
        store.tickAllTrains(0.1)
        expect(stateOf(store, entryOfSecond)).toBe('stop')
        expect(throwPoints(store, eastPoints, 1)).toBe(true)
        store.tickAllTrains(0.1)
        expect(stateOf(store, exitOfFirst)).toBe('stop')
        expect(nodeReservedBy(store.signalling, eastPoints.nodeId)).not.toBe(first.id)

        // It gets its route into the loop on the way, and stops 30 m short of its own exit signal
        let entryGiven = false
        let exitOfFirstOpened = false
        const entering = drive(
          store,
          () => {
            if (signalStatus(store.signalling, entryOfSecond).clearedFor === second.id) entryGiven = true
            if (stateOf(store, exitOfFirst) !== 'stop') exitOfFirstOpened = true
            return headOf(store, second).x < 0 && second.currentSpeed === 0
          },
          300,
          () => headOf(store, second).x + 370,
        )
        expect(entering.faults).toEqual([])
        expect(entryGiven).toBe(true)
        expect(exitOfFirstOpened).toBe(false)
        expect(headOf(store, second).x).toBeLessThan(-300)
        expect(headOf(store, second).y).toBeCloseTo(LOOP_Y, 6)
        // Its own exit is closed: the west points are set for the main track, against it, and free
        expect(stateOf(store, exitOfSecond)).toBe('stop')
        expect(nodeReservedBy(store.signalling, westPoints.nodeId)).toBeNull()

        // 3. The first train has the east points put back and leaves, past the second one; it is
        // stopped again further on (a train left to itself keeps its handle where it was)
        store.selectTrainById(first.id)
        expect(throwPoints(store, eastPoints, 0)).toBe(true)
        const leavingEast = drive(store, () => headOf(store, first).x > 1500 && first.currentSpeed === 0, 300, () => 1800 - headOf(store, first).x)
        expect(leavingEast.faults).toEqual([])

        // 4. Then the second one, to the west
        store.selectTrainById(second.id)
        expect(throwPoints(store, westPoints, 1)).toBe(true)
        const leavingWest = drive(store, () => headOf(store, second).x < -1500, 300)
        expect(leavingWest.faults).toEqual([])

        expect(headOf(store, first).x).toBeGreaterThan(1500)
        expect(headOf(store, second).x).toBeLessThan(-1500)
      })
    }
  }

  it('a train that runs on past its exit signal while the points are against it is caught at the signal', () => {
    const store = takeControls(ID)
    const [first] = store.trains
    pointsAt(store, 500, 0).active = 1
    networkChanged()
    const log = driveFlatOut(store, () => first.emergencyBrake || headOf(store, first).x > 480, 300)
    // The exit signal is closed, not at caution towards the points: passing it is the fault
    expect(log.faults).toContain(`${first.id}: passed a closed signal`)
    expect(first.signalPassed?.signalId).toBe(signalAt(store, 400, 0).id)
  })
})
