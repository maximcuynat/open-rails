import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, removeSegment, resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { COUPLING_GAP, setNotch, setReverser, vehicleFrontEndPos, vehicleRearEndPos, createVehicle, makeTrainSet, advanceTrainSet } from '@domain/models/train'
import { placeTurnout, activeBranchOf, turnoutView, splitSegment } from '@domain/models/junction'
import { positionOnSegment } from '@domain/models/locomotive'
import * as trainModel from '@domain/models/train'

/**
 * Stand-in for the driving physics: every train simply runs at the speed it is given. These tests
 * are about what the store does around a drive (saving, undo, obstacles), not about the forces.
 */
function runAtConstantSpeed(): void {
  vi.spyOn(trainModel, 'tickTrainSet').mockImplementation((net, train, dt, others, occupancy) =>
    train.currentSpeed <= 0 || advanceTrainSet(net, train, train.currentSpeed * dt, others, occupancy))
}

/** Store with one straight track from x=0 to x=`length` and the train tool armed in place mode */
function storeWithStraightTrack(length = 1000): { store: EditorStore; segId: string } {
  const store = new EditorStore()
  const a = addNode(store.network, { x: 0, y: 0 })
  const b = addNode(store.network, { x: length, y: 0 })
  const seg = addSegment(store.network, a.id, b.id)!
  store.camera.scale = 3 // magnetic coupler reach = 10 m
  store.markDirty()
  store.setTrainPlacementKind('tgv_loco')
  return { store, segId: seg.id }
}

const vehicleCount = (store: EditorStore) => store.trains.reduce((n, t) => n + t.vehicles.length, 0)

describe('EditorStore trains', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('single placement path', () => {
    it('click, drop, drag end and context menu all create a TrainSet and never a legacy locomotive', () => {
      const { store } = storeWithStraightTrack()

      expect(store.placeTrainItem({ x: 100, y: 0 })).toBe(true)
      expect(store.handleDropTrainItem('tgv_loco', { x: 300, y: 0 })).toBe(true)
      store.startTrainDrag('tgv_loco', { x: 0, y: 0 })
      expect(store.endTrainDrag({ x: 500, y: 0 })).toBe(true)
      expect(store.placeTrainLoco({ x: 700, y: 0 })).toBe(true)

      expect(store.locomotive).toBeNull()
      expect(store.trains).toHaveLength(4)
      expect(store.trains.every(t => t.vehicles.length === 1 && t.vehicles[0].kind === 'loco')).toBe(true)
    })

    it('a drop clears the drag state and leaves the train tool armed with the dropped kind', () => {
      const { store } = storeWithStraightTrack()
      store.setTool('select')
      store.startTrainDrag('tgv_wagon', { x: 10, y: 10 })

      expect(store.handleDropTrainItem('tgv_wagon', { x: 200, y: 0 })).toBe(true)

      expect(store.draggingTrainItem).toBeNull()
      expect(store.dragCursorScreen).toBeNull()
      expect(store.tool).toBe('locomotive')
      expect(store.trainToolSubMode).toBe('place')
      expect(store.trainPlacementKind).toBe('tgv_wagon')
      expect(store.trains).toHaveLength(1)
      // No drag left behind: a later pointer-up cannot place a second vehicle
      expect(store.endTrainDrag({ x: 600, y: 0 })).toBe(false)
      expect(store.trains).toHaveLength(1)
    })

    it('cancelTrainDrag drops the drag without placing anything', () => {
      const { store } = storeWithStraightTrack()
      store.startTrainDrag('tgv_loco', { x: 0, y: 0 })
      store.updateTrainDrag({ x: 100, y: 0 })
      expect(store.trainPlacementPreview).not.toBeNull()

      store.cancelTrainDrag()

      expect(store.draggingTrainItem).toBeNull()
      expect(store.trainPlacementPreview).toBeNull()
      expect(store.trains).toHaveLength(0)
    })

    it('refuses a placement too far from any rail and changes nothing', () => {
      const { store } = storeWithStraightTrack()
      expect(store.placeTrainItem({ x: 100, y: 500 })).toBe(false)
      expect(store.handleDropTrainItem('tgv_wagon', { x: 100, y: 500 })).toBe(false)
      expect(store.trains).toHaveLength(0)
      expect(store.locomotive).toBeNull()
    })
  })

  describe('train in progress', () => {
    it('appends the next vehicles to the train just placed when clicking along the track near its end', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })
      const trainId = store.trains[0].id
      expect(store.trainChainId).toBe(trainId)

      // 23 m behind the rear end (x = 83): out of the magnetic reach (10 m at this zoom), inside the chain reach
      store.setTrainPlacementKind('tgv_wagon')
      store.updateLocomotivePreview({ x: 60, y: 0 })
      expect(store.couplerSnapTarget?.train.id).toBe(trainId)
      expect(store.placeTrainItem({ x: 60, y: 0 })).toBe(true)
      expect(store.placeTrainItem({ x: 40, y: 0 })).toBe(true)

      expect(store.trains).toHaveLength(1)
      expect(store.trains[0].id).toBe(trainId)
      expect(store.trains[0].vehicles.map(v => v.kind)).toEqual(['loco', 'wagon', 'wagon'])
      expect(store.selectedTrainId).toBe(trainId)
      // The preview already shows the next vehicle coupled to the same train
      expect(store.couplerSnapTarget?.train.id).toBe(trainId)
    })

    it('starts a new train far from the train in progress, and the preview says so', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })
      store.setTrainPlacementKind('tgv_wagon')

      store.updateLocomotivePreview({ x: 600, y: 0 })
      expect(store.trainPlacementPreview).not.toBeNull()
      expect(store.couplerSnapTarget).toBeNull()

      expect(store.placeTrainItem({ x: 600, y: 0 })).toBe(true)
      expect(store.trains).toHaveLength(2)
      expect(store.trainChainId).toBe(store.trains[1].id)
    })

    it('Escape first ends the train in progress (train select mode), then leaves the train tool', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })

      store.cancelInteraction()
      expect(store.tool).toBe('locomotive')
      expect(store.trainToolSubMode).toBe('select')
      expect(store.trainChainId).toBeNull()
      expect(store.trainPlacementPreview).toBeNull()

      store.cancelInteraction()
      expect(store.tool).toBe('select')
      expect(store.trains).toHaveLength(1)
    })

    it('once the chain is ended, the same click starts a separate train', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })
      store.cancelInteraction()

      store.setTrainPlacementKind('tgv_wagon')
      store.updateLocomotivePreview({ x: 60, y: 0 })
      expect(store.couplerSnapTarget).toBeNull()
      store.placeTrainItem({ x: 60, y: 0 })

      expect(store.trains).toHaveLength(2)
    })
  })

  describe('turned-around placement', () => {
    it('flipping the heading couples the next vehicle turned around, ghost and placement alike', () => {
      const { store } = storeWithStraightTrack()
      store.setTool('locomotive')
      expect(store.placeTrainItem({ x: 500, y: 0 })).toBe(true)
      const tail = vehicleRearEndPos(store.network, store.trains[0].vehicles[0])!

      store.updateLocomotivePreview(tail)
      expect(store.trainPlacementPreview!.vehicles[0].flipped).toBeUndefined()

      store.flipTrainPlacementDirection()
      expect(store.couplerSnapTarget).not.toBeNull()
      expect(store.trainPlacementPreview!.vehicles[0].flipped).toBe(true)

      expect(store.placeTrainItem(tail)).toBe(true)
      expect(store.trains).toHaveLength(1)
      expect(store.trains[0].vehicles.map(v => v.flipped === true)).toEqual([false, true])
    })
  })

  describe('rolling stock of the placed vehicles', () => {
    it('places TGV Duplex vehicles by default and the chosen model afterwards, ghost and placement alike', () => {
      const { store } = storeWithStraightTrack()
      expect(store.trainPlacementModel).toBe('duplex')
      store.placeTrainItem({ x: 800, y: 0 })
      expect(store.trains[0].vehicles[0].model).toBe('duplex')

      // Far from the first train: a new one, of the model chosen in between
      store.setTrainPlacementModel('tgvm')
      store.updateLocomotivePreview({ x: 400, y: 0 })
      expect(store.trainPlacementPreview!.vehicles[0].model).toBe('tgvm')
      store.placeTrainItem({ x: 400, y: 0 })
      store.setTrainPlacementKind('tgv_wagon')
      store.placeTrainItem({ x: 380, y: 0 })
      store.updateLocomotivePreview({ x: 360, y: 0 })
      const ghost = store.trainPlacementPreview!.vehicles[0]
      store.placeTrainItem({ x: 360, y: 0 })

      expect(store.trains).toHaveLength(2)
      const [loco, first, second] = store.trains[1].vehicles
      expect(store.trains[1].vehicles.map(v => v.model)).toEqual(['tgvm', 'tgvm', 'tgvm'])
      // TGV M power car: 11.38 m between its bogies; the two trailers share the bogie between them
      const x = (t: number) => t * 1000
      expect(x(loco.front.t) - x(loco.rear.t)).toBeCloseTo(11.38, 6)
      expect(second.front).toEqual(first.rear)
      expect(x(second.front.t) - x(second.rear.t)).toBeCloseTo(17.7, 6)
      // The ghost stood exactly where the trailer was placed
      expect(second.front).toEqual(ghost.front)
      expect(second.rear).toEqual(ghost.rear)
    })
  })

  describe('no editing while driving', () => {
    it('the inspector closes for the drive, cannot be reopened, and comes back as it was on exit', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })
      store.setSidePanelOpen(true)

      store.togglePlayMode()
      expect(store.isSidePanelOpen).toBe(false)
      store.toggleSidePanel()
      expect(store.isSidePanelOpen).toBe(false)

      store.togglePlayMode()
      expect(store.isSidePanelOpen).toBe(true)

      // Closed before the drive: still closed after it
      store.setSidePanelOpen(false)
      store.togglePlayMode()
      store.togglePlayMode()
      expect(store.isSidePanelOpen).toBe(false)
    })

    it('refuses to place, delete or couple vehicles and to undo in play mode', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })
      store.setTrainPlacementKind('tgv_wagon')
      store.placeTrainItem({ x: 60, y: 0 })
      const joint = store.trains[0].vehicles[0].rear
      expect(joint.segId).toBeDefined()

      store.togglePlayMode()
      expect(store.isPlayMode).toBe(true)

      expect(store.placeTrainItem({ x: 600, y: 0 })).toBe(false)
      expect(store.handleDropTrainItem('tgv_loco', { x: 600, y: 0 })).toBe(false)
      expect(store.deleteVehicleAt({ x: 95, y: 0 })).toBe(false)
      store.handleCouplingClick({ x: 82, y: 0 })
      store.deleteSelection()
      store.undo()

      expect(store.trains).toHaveLength(1)
      expect(store.trains[0].vehicles).toHaveLength(2)
      expect(store.locomotive).toBeNull()
      expect(store.isPlayMode).toBe(true)
    })
  })

  describe('turnout steering', () => {
    it('steers the junction ahead of the driven TrainSet', () => {
      const store = new EditorStore()
      const stem = addNode(store.network, { x: 0, y: 0 })
      const apex = addNode(store.network, { x: 300, y: 0 })
      const straight = addNode(store.network, { x: 600, y: 0 })
      const diverging = addNode(store.network, { x: 600, y: 60 })
      addSegment(store.network, stem.id, apex.id)
      addSegment(store.network, apex.id, straight.id)
      const sDiv = addSegment(store.network, apex.id, diverging.id)!
      store.markDirty()
      const junction = [...store.network.junctions.values()][0]
      expect(junction).toBeDefined()

      store.setTrainPlacementKind('tgv_loco')
      store.placeTrainItem({ x: 150, y: 0 })
      store.togglePlayMode()
      expect(store.locomotive).toBeNull()

      const branchTo = (segId: string) =>
        turnoutView(store.network, junction)!.divergingSegmentId === segId ? 'diverging' : 'straight'

      // The diverging rail leaves towards +y: the right-hand side when running towards +x
      store.steerUpcomingTurnout('right')
      expect(activeBranchOf(junction)).toBe(branchTo(sDiv.id))
      store.steerUpcomingTurnout('left')
      expect(activeBranchOf(junction)).not.toBe(branchTo(sDiv.id))
    })
  })

  describe('persistence', () => {
    it('restores the trains, stopped, after a reload', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })
      store.setTrainPlacementKind('tgv_wagon')
      store.placeTrainItem({ x: 60, y: 0 })

      // Drive a little, then leave driving: the new position is what gets saved
      runAtConstantSpeed()
      const parkedT = store.trains[0].vehicles[0].front.t
      store.togglePlayMode()
      store.setSelectedTrainReverser('forward')
      store.setSelectedTrainNotch(5)
      store.trains[0].currentSpeed = 20
      store.tickAllTrains(0.1)
      store.tickAllTrains(0.1)
      const drivenT = store.trains[0].vehicles[0].front.t
      expect(drivenT).toBeGreaterThan(parkedT)
      store.togglePlayMode()

      const reloaded = new EditorStore()
      expect(reloaded.trains).toHaveLength(1)
      expect(reloaded.trains[0].vehicles.map(v => v.kind)).toEqual(['loco', 'wagon'])
      expect(reloaded.trains[0].vehicles[0].front.t).toBeCloseTo(drivenT, 9)
      expect(reloaded.trains[0].currentSpeed).toBe(0)
      expect(reloaded.trains[0].notch).toBe(0)
      expect(reloaded.trains[0].reverser).toBe('neutral')
      expect(reloaded.isPlayMode).toBe(false)
      expect(reloaded.locomotive).toBeNull()
    })

    it('does not restore a train as moving when the page closes while driving', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })
      runAtConstantSpeed()
      store.togglePlayMode()
      store.setSelectedTrainReverser('forward')
      store.setSelectedTrainNotch(5)
      store.trains[0].currentSpeed = 20
      store.tickAllTrains(0.1)
      expect(store.trains[0].currentSpeed).toBe(20)
      store.savePersistedState()

      const reloaded = new EditorStore()
      expect(reloaded.trains[0].currentSpeed).toBe(0)
      expect(reloaded.trains[0].notch).toBe(0)
      expect(reloaded.trains[0].reverser).toBe('neutral')
    })

    it('exports the trains and loads them back, and loads an old file without trains', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })
      const data = JSON.parse(JSON.stringify(store.exportProject()))
      expect(data.trains).toHaveLength(1)

      const other = new EditorStore()
      other.newProject()
      other.loadFromData(data)
      expect(other.trains).toHaveLength(1)
      expect(other.trains[0].vehicles[0].front).toEqual(store.trains[0].vehicles[0].front)

      // Old format: the same file without the `trains` key replaces the trains by none
      delete data.trains
      other.loadFromData(data)
      expect(other.network.segments.size).toBe(1)
      expect(other.trains).toHaveLength(0)
      expect(other.selectedTrainId).toBeNull()
    })

    it('new project removes the trains, including after a reload', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })
      store.togglePlayMode()

      store.newProject()

      expect(store.trains).toHaveLength(0)
      expect(store.locomotive).toBeNull()
      expect(store.isPlayMode).toBe(false)
      expect(store.selectedTrainId).toBeNull()
      expect(new EditorStore().trains).toHaveLength(0)
    })
  })

  describe('undo / redo', () => {
    it('placing a vehicle is one undo step each, redo brings it back', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })
      store.setTrainPlacementKind('tgv_wagon')
      store.placeTrainItem({ x: 60, y: 0 })
      expect(vehicleCount(store)).toBe(2)

      store.undo()
      expect(vehicleCount(store)).toBe(1)
      expect(store.trains[0].vehicles[0].kind).toBe('loco')
      store.undo()
      expect(store.trains).toHaveLength(0)
      expect(store.network.segments.size).toBe(1)

      store.redo()
      expect(vehicleCount(store)).toBe(1)
      store.redo()
      expect(vehicleCount(store)).toBe(2)
      expect(store.trains).toHaveLength(1)
    })

    it('deleting a vehicle is one undo step, by the delete tool and by the selection', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })
      store.setTrainPlacementKind('tgv_wagon')
      store.placeTrainItem({ x: 60, y: 0 })

      expect(store.deleteVehicleAt({ x: 95, y: 0 })).toBe(true)
      expect(vehicleCount(store)).toBe(1)
      store.undo()
      expect(vehicleCount(store)).toBe(2)

      store.selectTrainById(store.trains[0].id, store.trains[0].vehicles[1].id)
      store.deleteSelection()
      expect(store.trains[0].vehicles.map(v => v.kind)).toEqual(['loco'])
      store.undo()
      expect(store.trains[0].vehicles.map(v => v.kind)).toEqual(['loco', 'wagon'])
    })

    it('decoupling and coupling are one undo step each', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })
      // A second power car behind the first: the only kind of joint that can be uncoupled
      store.placeTrainItem({ x: 60, y: 0 })
      expect(store.trains).toHaveLength(1)
      store.toggleCouplingMode()
      const joint = store.couplerPoints.find(cp => cp.coupled)!.pos

      store.handleCouplingClick(joint)
      expect(store.trains).toHaveLength(2)
      store.undo()
      expect(store.trains).toHaveLength(1)
      expect(store.trains[0].vehicles).toHaveLength(2)
      store.redo()
      expect(store.trains).toHaveLength(2)

      store.handleCouplingClick(joint)
      expect(store.trains).toHaveLength(1)
      store.undo()
      expect(store.trains).toHaveLength(2)

      // A click that couples nothing leaves no undo step behind
      store.handleCouplingClick({ x: 900, y: 0 })
      store.undo()
      expect(store.trains).toHaveLength(1)
    })

    it('a drive is one undo step back to where the train stood', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })
      const before = store.trains[0].vehicles[0].front.t

      runAtConstantSpeed()
      store.togglePlayMode()
      store.setSelectedTrainReverser('forward')
      store.trains[0].currentSpeed = 20
      for (let i = 0; i < 5; i++) store.tickAllTrains(0.1)
      store.togglePlayMode()
      expect(store.trains[0].vehicles[0].front.t).toBeGreaterThan(before)

      store.undo()
      expect(store.trains).toHaveLength(1)
      expect(store.trains[0].vehicles[0].front.t).toBeCloseTo(before, 9)
    })
  })

  describe('network changes', () => {
    it('drops a train whose rail is removed and brings it back on undo', () => {
      const { store, segId } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })

      removeSegment(store.network, segId)
      store.markDirty()

      expect(store.trains).toHaveLength(0)
      expect(store.selectedTrainId).toBeNull()
      expect(store.isTrainSelected).toBe(false)
      expect(store.trainChainId).toBeNull()

      while (store.trains.length === 0 && store.canUndo) store.undo()
      expect(store.network.segments.has(segId)).toBe(true)
      expect(store.trains).toHaveLength(1)
    })

    it('keeps the vehicles still on rails when only part of the train loses its track', () => {
      const store = new EditorStore()
      const a = addNode(store.network, { x: 0, y: 0 })
      const b = addNode(store.network, { x: 100, y: 0 })
      const c = addNode(store.network, { x: 400, y: 0 })
      const rearSeg = addSegment(store.network, a.id, b.id)!
      addSegment(store.network, b.id, c.id)
      store.markDirty()
      store.setTrainPlacementKind('tgv_loco')
      store.placeTrainItem({ x: 130, y: 0 })
      store.setTrainPlacementKind('tgv_wagon')
      store.placeTrainItem({ x: 95, y: 0 })
      store.placeTrainItem({ x: 75, y: 0 })
      expect(store.trains[0].vehicles).toHaveLength(3)
      expect(store.trains[0].vehicles[2].rear.segId).toBe(rearSeg.id)

      removeSegment(store.network, rearSeg.id)
      store.markDirty()

      expect(store.trains).toHaveLength(1)
      expect(store.trains[0].vehicles[0].kind).toBe('loco')
      expect(store.trains[0].vehicles.every(v => v.front.segId !== rearSeg.id && v.rear.segId !== rearSeg.id)).toBe(true)
      expect(store.trains[0].vehicles.length).toBeLessThan(3)
    })
  })


  describe('collisions and occupied junctions', () => {
    it('a driven train stops in contact with a stationary one instead of running through it', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 300, y: 0 })
      store.placeTrainItem({ x: 600, y: 0 })
      expect(store.trains).toHaveLength(2)
      const [driven, parked] = store.trains
      const parkedBefore = JSON.stringify(parked.vehicles)
      store.selectTrainById(driven.id)
      runAtConstantSpeed()
      store.togglePlayMode()
      setReverser(driven, 'forward')
      setNotch(driven, 5)
      driven.currentSpeed = 20

      for (let i = 0; i < 60 * 20; i++) store.tickAllTrains(1 / 60)

      const nose = vehicleFrontEndPos(store.network, driven.vehicles[0])!
      const tail = vehicleRearEndPos(store.network, parked.vehicles[parked.vehicles.length - 1])!
      expect(tail.x - nose.x).toBeCloseTo(COUPLING_GAP, 6)
      expect(JSON.stringify(parked.vehicles)).toBe(parkedBefore)
      // Bringing the train to rest against the obstacle is the domain's business: the store forces nothing
      expect(driven.notch).toBe(5)
      store.togglePlayMode()
      expect(driven.currentSpeed).toBe(0)
      expect(driven.notch).toBe(0)
    })

    it('refuses to throw a junction while a train stands over its points', () => {
      const store = new EditorStore()
      const stem = addNode(store.network, { x: 0, y: 0 })
      const apex = addNode(store.network, { x: 300, y: 0 })
      const straight = addNode(store.network, { x: 600, y: 0 })
      const diverging = addNode(store.network, { x: 600, y: 60 })
      addSegment(store.network, stem.id, apex.id)
      addSegment(store.network, apex.id, straight.id)
      addSegment(store.network, apex.id, diverging.id)
      store.markDirty()
      const junction = [...store.network.junctions.values()][0]
      expect(activeBranchOf(junction)).toBe('straight')

      // Free junction: thrown, by id or through the selection
      expect(store.toggleActiveJunction(junction.id)).toBe(true)
      expect(activeBranchOf(junction)).toBe('diverging')
      store.setSelection({ nodes: new Set([apex.id]), segments: new Set() })
      expect(store.toggleActiveJunction()).toBe(true)
      expect(activeBranchOf(junction)).toBe('straight')

      // A loco astride the apex (nose at x=305, rear bogie at x=291)
      store.setTrainPlacementKind('tgv_loco')
      expect(store.placeTrainItem({ x: 305, y: 0 })).toBe(true)
      expect(store.isJunctionOccupied(junction)).toBe(true)

      expect(store.toggleActiveJunction(junction.id)).toBe(false)
      expect(store.toggleActiveJunction()).toBe(false)
      store.steerUpcomingTurnout('right')
      expect(activeBranchOf(junction)).toBe('straight')

      // Mirroring the diverging branch is refused as well, by id or through the selection
      const geometry = () => JSON.stringify([[...store.network.nodes.values()], [...store.network.segments.values()], turnoutView(store.network, junction)!.hand])
      const before = geometry()
      expect(store.toggleTurnoutHandAtSelection(junction.id)).toBe(false)
      expect(store.toggleTurnoutHandAtSelection()).toBe(false)
      expect(geometry()).toBe(before)

      // Once the train is gone both operations go through again
      store.trains = []
      expect(store.toggleTurnoutHandAtSelection(junction.id)).toBe(true)
      expect(geometry()).not.toBe(before)
      expect(store.toggleActiveJunction(junction.id)).toBe(true)
    })
  })

  describe('turnout hand flip under a train', () => {
    /** Stem, #4 or #6 turnout at the origin, both branches extended by 300 m */
    function storeWithTurnout(frogNumber: 4 | 6) {
      const store = new EditorStore()
      const net = store.network
      const stem = addNode(net, { x: -300, y: 0 })
      const apex = addNode(net, { x: 0, y: 0 })
      addSegment(net, stem.id, apex.id)
      const t = placeTurnout(net, { startPos: apex.pos, direction: { x: 1, y: 0 }, frogNumber, hand: 'left', stemNodeId: apex.id })
      const sEnd = addNode(net, { x: t.straightNode.pos.x + 300, y: 0 })
      const straightExt = addSegment(net, t.straightNode.id, sEnd.id)!
      const div = net.segments.get(turnoutView(net, t.junction)!.divergingSegmentId)!
      const dir = { x: t.divergingNode.pos.x - div.via!.x, y: t.divergingNode.pos.y - div.via!.y }
      const len = Math.hypot(dir.x, dir.y)
      const dEnd = addNode(net, { x: t.divergingNode.pos.x + (dir.x / len) * 300, y: t.divergingNode.pos.y + (dir.y / len) * 300 })
      const divergingExt = addSegment(net, t.divergingNode.id, dEnd.id)!
      store.markDirty()
      const junction = [...net.junctions.values()].find((j) => j.nodeId === apex.id)!
      return { store, junction, straightExt, divergingExt, divergingSegId: turnoutView(net, junction)!.divergingSegmentId }
    }
    const bogies = (store: EditorStore) =>
      store.trains.flatMap((t) => t.vehicles.flatMap((v) => [v.front, v.rear].map((p) => positionOnSegment(store.network, p.segId, p.t)!)))
    const park = (store: EditorStore, segId: string, t: number) => {
      const lead = createVehicle(store.network, segId, t, 'loco', 1)!
      const train = makeTrainSet('parked', [lead, { id: 'w', kind: 'wagon', front: { ...lead.rear }, rear: { ...lead.rear } }])
      expect(advanceTrainSet(store.network, train, 0)).toBe(true)
      store.trains = [train]
    }

    it('is refused wherever the train stands on track the flip would move, and never displaces a bogie', () => {
      for (const frogNumber of [4, 6] as const) {
        // On the diverging branch past the points, astride its end, and on its extension
        for (const where of ['branch', 'astride', 'extension'] as const) {
          const { store, junction, divergingExt, divergingSegId } = storeWithTurnout(frogNumber)
          if (where === 'branch') park(store, divergingSegId, 0.95)
          else park(store, divergingExt.id, where === 'astride' ? 0.05 : 0.6)
          expect(store.isJunctionOccupied(junction)).toBe(false)
          const before = bogies(store)

          expect(store.toggleTurnoutHandAtSelection(junction.id)).toBe(false)

          expect(turnoutView(store.network, junction)!.hand).toBe('left')
          bogies(store).forEach((p, i) => expect(Math.hypot(p.x - before[i].x, p.y - before[i].y)).toBe(0))
        }
      }
    })

    it('is allowed when the train stands on track the flip leaves alone', () => {
      const { store, junction, straightExt } = storeWithTurnout(6)
      park(store, straightExt.id, 0.5)
      const before = bogies(store)
      const divergingEnd = store.network.nodes.get(turnoutView(store.network, junction)!.divergingNodeId)!
      const sideBefore = divergingEnd.pos.y

      expect(store.toggleTurnoutHandAtSelection(junction.id)).toBe(true)

      // The diverging branch is mirrored across the straight axis (y=0)
      expect(divergingEnd.pos.y).toBeCloseTo(-sideBefore, 9)
      bogies(store).forEach((p, i) => expect(Math.hypot(p.x - before[i].x, p.y - before[i].y)).toBe(0))
    })
  })
})

describe('EditorStore trains on reshaped rails', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
  })

  /** World position of every bogie of the fleet */
  function bogies(store: EditorStore): { x: number; y: number }[] {
    return store.trains.flatMap((train) =>
      train.vehicles.flatMap((veh) => [veh.front, veh.rear].map((p) => positionOnSegment(store.network, p.segId, p.t)!)),
    )
  }

  function storeWithRake(): { store: EditorStore; segId: string } {
    const { store, segId } = storeWithStraightTrack(400)
    const lead = createVehicle(store.network, segId, 0.9, 'loco')!
    const train = makeTrainSet('t1', [
      lead,
      { ...lead, id: 'w1', kind: 'wagon' },
      { ...lead, id: 'w2', kind: 'wagon' },
    ])
    expect(advanceTrainSet(store.network, train, 0)).toBe(true)
    store.trains = [train]
    return { store, segId }
  }

  it.each([
    ['the far end node is dragged away', 'to', 800],
    ['the far end node is dragged closer', 'to', 380],
    ['the node behind the train is dragged away', 'from', -300],
  ] as const)('the train does not move when %s: only the rail changes', (_label, end, x) => {
    const { store, segId } = storeWithRake()
    const before = bogies(store)

    store.pinTrains()
    const seg = store.network.segments.get(segId)!
    store.network.nodes.get(seg[end])!.pos.x = x
    // Positions are fractions of the segment: without a re-lay the train is carried and stretched
    expect(bogies(store)[0].x).not.toBeCloseTo(before[0].x, 3)

    store.realignTrains()
    store.unpinTrains()
    bogies(store).forEach((p, i) => {
      expect(p.x).toBeCloseTo(before[i].x, 6)
      expect(p.y).toBeCloseTo(before[i].y, 6)
    })
  })

  it('leaves a train untouched when the rail becomes too short for it', () => {
    const { store, segId } = storeWithRake()
    const seg = store.network.segments.get(segId)!
    const fractions = () => store.trains[0].vehicles.map((v) => [v.front.t, v.rear.t])
    const before = fractions()

    store.pinTrains()
    store.network.nodes.get(seg.to)!.pos.x = 20
    store.realignTrains()
    expect(fractions()).toEqual(before)
  })
})

describe('EditorStore driving cab switch', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
  })

  function storeWithTrainset(tailKind: 'loco' | 'wagon' = 'loco'): EditorStore {
    const { store, segId } = storeWithStraightTrack(400)
    const lead = createVehicle(store.network, segId, 0.6, 'loco')!
    const tail = tailKind === 'loco'
      ? { ...lead, id: 'm2', kind: 'loco' as const, flipped: true }
      : { ...lead, id: 'w2', kind: 'wagon' as const }
    const train = makeTrainSet('t1', [lead, { ...lead, id: 'w1', kind: 'wagon' }, tail])
    expect(advanceTrainSet(store.network, train, 0)).toBe(true)
    store.trains = [train]
    store.selectedTrainId = 't1'
    return store
  }

  const bogieXs = (store: EditorStore) =>
    store.trains[0].vehicles
      .flatMap((v) => [v.front, v.rear])
      .map((p) => positionOnSegment(store.network, p.segId, p.t)!.x)
      .sort((a, b) => a - b)

  it('hands the controls to the power car at the other end without moving or turning anything', () => {
    const store = storeWithTrainset()
    const before = bogieXs(store)
    const noseOf = (id: string) => {
      const train = store.trains[0]
      const i = train.vehicles.findIndex((v) => v.id === id)
      return vehicleFrontEndPos(store.network, train.vehicles[i], train.vehicles[i + 1] ?? null)!.x
    }
    const leadId = store.trains[0].vehicles[0].id
    const leadNoseBefore = noseOf(leadId)

    expect(store.switchSelectedTrainCab()).toBe(true)

    const train = store.trains[0]
    expect(train.id).toBe('t1')
    expect(train.vehicles.map((v) => v.id)).toEqual(['m2', 'w1', leadId])
    expect(train.vehicles[0].flipped).toBeFalsy()
    expect(train.reverser).toBe('neutral')
    bogieXs(store).forEach((x, i) => expect(x).toBeCloseTo(before[i], 6))
    // The former lead still points its nose the same way: it is now the flipped tail
    expect(train.vehicles[2].flipped).toBe(true)
    expect(vehicleRearEndPos(store.network, train.vehicles[2], train.vehicles[1])!.x).toBeCloseTo(leadNoseBefore, 6)
  })

  it('forward now heads the other way', () => {
    const store = storeWithTrainset()
    const xOfLead = () => {
      const p = store.trains[0].vehicles[0].front
      return positionOnSegment(store.network, p.segId, p.t)!.x
    }
    const firstCabX = xOfLead()
    store.switchSelectedTrainCab()
    const secondCabX = xOfLead()
    expect(secondCabX).toBeLessThan(firstCabX)

    expect(advanceTrainSet(store.network, store.trains[0], 10)).toBe(true)
    expect(xOfLead()).toBeCloseTo(secondCabX - 10, 6)
  })

  it('is refused while moving, and when the other end is not a power car', () => {
    const moving = storeWithTrainset()
    moving.trains[0].currentSpeed = 3
    expect(moving.switchSelectedTrainCab()).toBe(false)
    expect(moving.trains[0].vehicles[0].kind).toBe('loco')
    expect(moving.trains[0].vehicles[2].id).toBe('m2')

    const noTailCab = storeWithTrainset('wagon')
    expect(noTailCab.switchSelectedTrainCab()).toBe(false)
    expect(noTailCab.trains[0].vehicles[2].id).toBe('w2')
  })
})

describe('EditorStore route tables', () => {
  it('keeps the turnout the way it was thrown through an edit next to it, undo and redo', () => {
    const store = new EditorStore()
    const net = () => store.network
    const stem = addNode(net(), { x: -300, y: 0 })
    const apex = addNode(net(), { x: 0, y: 0 })
    addSegment(net(), stem.id, apex.id)
    const t = placeTurnout(net(), { startPos: apex.pos, direction: { x: 1, y: 0 }, frogNumber: 6, hand: 'left', stemNodeId: apex.id })
    store.markDirty()
    const state = () => {
      const junction = [...net().junctions.values()].find((j) => j.nodeId === apex.id)
      const view = turnoutView(net(), junction)!
      const far = (nodeId: string) => net().nodes.get(nodeId)!.pos
      // The rail ids change when a rail is cut: compare where the branches lead
      return { count: net().junctions.size, active: view.activeBranch, hand: view.hand, divergingUp: far(view.divergingNodeId).y > 1e-3, straightOnAxis: Math.abs(far(view.straightNodeId).y) < 1e-9 }
    }
    const thrown = { count: 1, active: 'diverging', hand: 'left', divergingUp: true, straightOnAxis: true }

    expect(store.toggleActiveJunction(t.junction!.id)).toBe(true)
    expect(state()).toEqual(thrown)

    // Cut the straight branch 100 m after the points
    const straightId = turnoutView(net(), [...net().junctions.values()][0])!.straightSegmentId
    splitSegment(net(), straightId, { x: 100, y: 0 })
    store.markDirty()
    store.notify()
    expect(state()).toEqual(thrown)

    store.undo()
    expect(state()).toEqual(thrown)
    store.undo()
    expect(state()).toEqual({ ...thrown, active: 'straight' })
    store.redo()
    store.redo()
    expect(state()).toEqual(thrown)
  })
})

describe('EditorStore train tool default sub-mode', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetIdCounter()
  })

  it('opens the train tool on selection, so a click on the canvas never places a vehicle by accident', () => {
    const store = new EditorStore()
    expect(store.trainToolSubMode).toBe('select')
    store.setTool('locomotive')
    expect(store.trainToolSubMode).toBe('select')
  })

  it('arms placement only when a vehicle kind is chosen, and comes back to selection after leaving', () => {
    const store = new EditorStore()
    store.setTrainPlacementKind('tgv_loco')
    expect(store.tool).toBe('locomotive')
    expect(store.trainToolSubMode).toBe('place')

    store.exitTrainMode()
    expect(store.tool).toBe('select')
    store.setTool('locomotive')
    expect(store.trainToolSubMode).toBe('select')

    store.setTrainPlacementKind('tgv_wagon')
    store.cancelInteraction() // placement → train selection
    store.cancelInteraction() // train selection → select tool
    expect(store.tool).toBe('select')
    store.setTool('locomotive')
    expect(store.trainToolSubMode).toBe('select')
  })
})
