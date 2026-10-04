import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, removeSegment, resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'

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

  describe('no editing while driving', () => {
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
        junction.divergingSegmentId === segId ? 'diverging' : 'straight'

      // The diverging rail leaves towards +y: the right-hand side when running towards +x
      store.steerUpcomingTurnout('right')
      expect(junction.activeBranch).toBe(branchTo(sDiv.id))
      store.steerUpcomingTurnout('left')
      expect(junction.activeBranch).not.toBe(branchTo(sDiv.id))
    })
  })

  describe('persistence', () => {
    it('restores the trains, stopped, after a reload', () => {
      const { store } = storeWithStraightTrack()
      store.placeTrainItem({ x: 100, y: 0 })
      store.setTrainPlacementKind('tgv_wagon')
      store.placeTrainItem({ x: 60, y: 0 })

      // Drive a little, then leave driving: the new position is what gets saved
      store.togglePlayMode()
      store.setSelectedTrainReverser('forward')
      store.setSelectedTrainNotch(5)
      store.tickAllTrains(0.1)
      store.tickAllTrains(0.1)
      const drivenT = store.trains[0].vehicles[0].front.t
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
      store.togglePlayMode()
      store.setSelectedTrainReverser('forward')
      store.setSelectedTrainNotch(5)
      store.tickAllTrains(0.1)
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
      store.setTrainPlacementKind('tgv_wagon')
      store.placeTrainItem({ x: 60, y: 0 })
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

      store.togglePlayMode()
      store.setSelectedTrainReverser('forward')
      store.setSelectedTrainNotch(5)
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
})
