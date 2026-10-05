import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore, IMPACT_REPORT_SPEED, trainImpactMessage } from './editorStore'
import * as trainModel from '@domain/models/train'
import * as trainDynamicsModel from '@domain/models/trainDynamics'
import { addNode, addSegment, addCurveSegment, resetIdCounter } from '@domain/models/network'
import { applyNodeTransform, collectAffectedVias } from '@domain/geometry/nodeTransform'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'

describe('EditorStore persistence', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
  })

  it('restores placed rails on store re-instantiation (simulating page reload)', () => {
    // 1. Initial page visit: user places rails
    const store1 = new EditorStore()
    expect(store1.network.nodes.size).toBe(0)

    const n1 = addNode(store1.network, { x: 0, y: 0 })
    const n2 = addNode(store1.network, { x: 246, y: 0 })
    addSegment(store1.network, n1.id, n2.id)
    store1.setProjectName('Mon Circuit')
    store1.markDirty()

    // 2. User reloads the page: a new EditorStore is created
    const store2 = new EditorStore()
    expect(store2.projectName).toBe('Mon Circuit')
    expect(store2.network.nodes.size).toBe(2)
    expect(store2.network.segments.size).toBe(1)

    // User can continue placing rails without ID conflict
    const n3 = addNode(store2.network, { x: 492, y: 0 })
    expect(n3.id).not.toBe(n1.id)
    expect(n3.id).not.toBe(n2.id)
    const seg2 = addSegment(store2.network, n2.id, n3.id)
    expect(seg2).not.toBeNull()
    store2.markDirty()

    // 3. User reloads again: both segments and 3 nodes are still there
    const store3 = new EditorStore()
    expect(store3.network.nodes.size).toBe(3)
    expect(store3.network.segments.size).toBe(2)
  })

  it('clears persisted state when starting a new project', () => {
    const store1 = new EditorStore()
    const n1 = addNode(store1.network, { x: 10, y: 10 })
    const n2 = addNode(store1.network, { x: 200, y: 10 })
    addSegment(store1.network, n1.id, n2.id)
    store1.markDirty()

    // User clicks "New"
    store1.newProject()
    expect(store1.network.nodes.size).toBe(0)
    expect(store1.network.segments.size).toBe(0)

    // After reload, should remain empty
    const store2 = new EditorStore()
    expect(store2.network.nodes.size).toBe(0)
    expect(store2.network.segments.size).toBe(0)
  })

  it('persists camera position on save', () => {
    const store1 = new EditorStore()
    store1.camera.x = 150
    store1.camera.y = -80
    store1.camera.scale = 5
    addNode(store1.network, { x: 150, y: -80 })
    store1.markDirty()

    const store2 = new EditorStore()
    expect(store2.camera.x).toBe(150)
    expect(store2.camera.y).toBe(-80)
    expect(store2.camera.scale).toBe(5)
  })

  it('cancelInteraction removes degree 0 placement nodes created on first click', () => {
    const store = new EditorStore()
    // Simulate user clicking once in empty space with place tool
    const n1 = addNode(store.network, { x: 50, y: 50 })
    store.lastNodeId = n1.id
    expect(store.network.nodes.size).toBe(1)

    // User presses Escape or right-clicks
    store.cancelInteraction()

    expect(store.network.nodes.size).toBe(0)
    expect(store.lastNodeId).toBeNull()
  })

  it('setTool cleans up degree 0 node if previous tool was abandoned mid-placement', () => {
    const store = new EditorStore()
    store.setTool('curve')
    const n1 = addNode(store.network, { x: 100, y: 100 })
    store.curveState = { phase: 1, startId: n1.id }
    expect(store.network.nodes.size).toBe(1)

    // User switches to select tool without finishing curve
    store.setTool('select')

    expect(store.network.nodes.size).toBe(0)
    expect(store.curveState.startId).toBeNull()
  })

  it('updates and persists unit, scale preset, gauge, and CAD dimensions', () => {
    const store1 = new EditorStore()
    expect(store1.unit).toBe('m')
    expect(store1.scalePreset).toBe('1:1')
    expect(store1.gauge).toBe(1.435)

    // Switch to HO scale
    store1.setScalePreset('HO')
    expect(store1.scalePreset).toBe('HO')
    expect(store1.unit).toBe('mm')
    expect(store1.gauge).toBe(0.0165)
    expect(store1.trackSpacing).toBe(0.050)
    expect(store1.parallelOffset).toBe(0.050)
    expect(store1.gridSpacing).toBe(0.1)
    expect(store1.boardEnabled).toBe(true)
    expect(store1.boardWidth).toBe(2.40)
    expect(store1.boardHeight).toBe(1.20)
    expect(store1.camera.scale).toBeGreaterThan(100) // camera adapted to board

    // Toggle dimensions
    expect(store1.showDimensions).toBe(true)
    store1.toggleDimensions()
    expect(store1.showDimensions).toBe(false)

    // Simulate page reload
    const store2 = new EditorStore()
    expect(store2.scalePreset).toBe('HO')
    expect(store2.unit).toBe('mm')
    expect(store2.gauge).toBe(0.0165)
    expect(store2.trackSpacing).toBe(0.050)
    expect(store2.showDimensions).toBe(false)
    expect(store2.boardEnabled).toBe(true)
    expect(store2.boardWidth).toBe(2.40)
    expect(store2.boardHeight).toBe(1.20)
  })

  it('manages turnout state, settings and cleanup on interaction cancel', () => {
    const store = new EditorStore()
    store.setTool('turnout')
    expect(store.tool).toBe('turnout')
    expect(store.turnoutSide).toBe(1)

    store.toggleTurnoutSide()
    expect(store.turnoutSide).toBe(-1)

    store.setTurnoutRadius(60)
    expect(store.turnoutRadius).toBe(60)

    store.setTurnoutOffset(5.5)
    expect(store.turnoutOffset).toBe(5.5)

    const n1 = addNode(store.network, { x: 0, y: 0 })
    store.turnoutStartId = n1.id

    store.cancelInteraction()
    expect(store.turnoutStartId).toBeNull()
    expect(store.network.nodes.size).toBe(0)
  })

  it('manages settings modal visibility states (open, close, toggle)', () => {
    const store = new EditorStore()
    expect(store.isSettingsOpen).toBe(false)

    store.openSettings()
    expect(store.isSettingsOpen).toBe(true)

    store.closeSettings()
    expect(store.isSettingsOpen).toBe(false)

    store.toggleSettings()
    expect(store.isSettingsOpen).toBe(true)

    store.toggleSettings()
    expect(store.isSettingsOpen).toBe(false)
  })

  describe('deleteSelection with aligned intermediate nodes', () => {
    it('dissolves an intermediate aligned node and connects the two outer nodes without destroying the track', () => {
      const store = new EditorStore()
      const n1 = addNode(store.network, { x: 0, y: 0 })
      const n2 = addNode(store.network, { x: 50, y: 0 })
      const n3 = addNode(store.network, { x: 100, y: 0 })
      addSegment(store.network, n1.id, n2.id)
      addSegment(store.network, n2.id, n3.id)

      // User selects ONLY the intermediate node n2
      store.selection = { nodes: new Set([n2.id]), segments: new Set() }

      store.deleteSelection()

      // n2 is gone
      expect(store.network.nodes.has(n2.id)).toBe(false)
      // n1 and n3 are preserved and connected directly
      expect(store.network.nodes.has(n1.id)).toBe(true)
      expect(store.network.nodes.has(n3.id)).toBe(true)
      expect(store.network.segments.size).toBe(1)

      const remainingSeg = [...store.network.segments.values()][0]
      expect((remainingSeg.from === n1.id && remainingSeg.to === n3.id) ||
             (remainingSeg.from === n3.id && remainingSeg.to === n1.id)).toBe(true)
    })

    it('preserves section metadata when dissolving an intermediate node', () => {
      const store = new EditorStore()
      const n1 = addNode(store.network, { x: 0, y: 0 })
      const n2 = addNode(store.network, { x: 50, y: 0 })
      const n3 = addNode(store.network, { x: 100, y: 0 })
      const s1 = addSegment(store.network, n1.id, n2.id)!
      const s2 = addSegment(store.network, n2.id, n3.id)!

      // Name section
      store.setSectionMeta(`${s1.id}-${s2.id}`, { name: 'Voie Rapide', color: '#ff5500' })

      // Delete n2
      store.selection = { nodes: new Set([n2.id]), segments: new Set() }
      store.deleteSelection()

      expect(store.network.nodes.size).toBe(2)
      expect(store.network.segments.size).toBe(1)

      const remainingSeg = [...store.network.segments.values()][0]
      expect(store.sectionMeta[remainingSeg.id]?.name).toBe('Voie Rapide')
    })
  })

  describe('Locomotive drive kinematics & inertia', () => {
    it('accelerates with ArrowUp (throttle = 1) and advances along the track', () => {
      const store = new EditorStore()
      const n1 = addNode(store.network, { x: 0, y: 0 })
      const n2 = addNode(store.network, { x: 200, y: 0 })
      addSegment(store.network, n1.id, n2.id)

      // Placer la locomotive à x = 30m (assez d'espace pour le bogie arrière à 14m derrière)
      const placed = store.placeLocomotiveAt({ x: 30, y: 0 })
      expect(placed).toBe(true)
      expect(store.locomotive).not.toBeNull()
      const initialT = store.locomotive!.front.t

      store.togglePlayMode()
      expect(store.isPlayMode).toBe(true)

      // Accélération pendant 1 seconde
      store.setLocomotiveThrottle(1)
      store.tickSimulation(1.0)

      expect(store.locomotiveCurrentSpeed).toBeCloseTo(5.5, 2)
      expect(store.locomotive!.front.t).toBeGreaterThan(initialT)
    })

    it('coasts with inertia when throttle is released (throttle = 0)', () => {
      const store = new EditorStore()
      const n1 = addNode(store.network, { x: 0, y: 0 })
      const n2 = addNode(store.network, { x: 300, y: 0 })
      addSegment(store.network, n1.id, n2.id)

      store.placeLocomotiveAt({ x: 30, y: 0 })
      store.togglePlayMode()

      // Vitesse initiale
      store.locomotiveCurrentSpeed = 10.0
      store.setLocomotiveThrottle(0) // Relâché -> inertie

      const tBefore = store.locomotive!.front.t
      store.tickSimulation(1.0)

      // La vitesse doit diminuer très légèrement en roue libre (frottement de 0.5 m/s²)
      expect(store.locomotiveCurrentSpeed).toBeCloseTo(9.5, 2)
      // Mais le train a quand même bien avancé grâce à son élan
      expect(store.locomotive!.front.t).toBeGreaterThan(tBefore)
    })

    it('decelerates quickly when braking (throttle = -1)', () => {
      const store = new EditorStore()
      const n1 = addNode(store.network, { x: 0, y: 0 })
      const n2 = addNode(store.network, { x: 300, y: 0 })
      addSegment(store.network, n1.id, n2.id)

      store.placeLocomotiveAt({ x: 30, y: 0 })
      store.togglePlayMode()

      store.locomotiveCurrentSpeed = 15.0
      store.setLocomotiveThrottle(-1) // Freinage actif (10.0 m/s²)

      store.tickSimulation(1.0)

      // La vitesse chute fortement avec le freinage (15.0 - 10.0 = 5.0 m/s²)
      expect(store.locomotiveCurrentSpeed).toBeCloseTo(5.0, 2)
    })

    it('clamps speed to 0 when braking stops the locomotive', () => {
      const store = new EditorStore()
      const n1 = addNode(store.network, { x: 0, y: 0 })
      const n2 = addNode(store.network, { x: 300, y: 0 })
      addSegment(store.network, n1.id, n2.id)

      store.placeLocomotiveAt({ x: 30, y: 0 })
      store.togglePlayMode()

      store.locomotiveCurrentSpeed = 2.0
      store.setLocomotiveThrottle(-1)

      store.tickSimulation(1.0)

      // La vitesse s'arrête à 0 et ne devient jamais négative
      expect(store.locomotiveCurrentSpeed).toBe(0)
    })

    it('resets speed to 0 when reaching a dead end', () => {
      const store = new EditorStore()
      const n1 = addNode(store.network, { x: 0, y: 0 })
      const n2 = addNode(store.network, { x: 50, y: 0 }) // voie de 50m seulement
      addSegment(store.network, n1.id, n2.id)

      store.placeLocomotiveAt({ x: 30, y: 0 })
      store.togglePlayMode()

      // Vitesse très élevée pour percuter le bout de voie
      store.locomotiveCurrentSpeed = 100
      store.setLocomotiveThrottle(1)

      store.tickSimulation(1.0)

      // Arrêté net au butoir
      expect(store.locomotiveCurrentSpeed).toBe(0)
    })

    it('flipLocomotiveDirection swaps control cab to opposite locomotive and halts speed', () => {
      const store = new EditorStore()
      const n1 = addNode(store.network, { x: 0, y: 0 })
      const n2 = addNode(store.network, { x: 300, y: 0 })
      addSegment(store.network, n1.id, n2.id)

      store.placeLocomotiveAt({ x: 270, y: 0 })
      store.togglePlayMode()

      store.locomotiveCurrentSpeed = 20.0
      const oldFrontX = store.locomotive!.front.t

      store.flipLocomotiveDirection()

      // 1. La vitesse s'arrête à 0 pour la relève de cabine
      expect(store.locomotiveCurrentSpeed).toBe(0)
      // 2. Le bogie de tête est maintenant celui de la motrice opposée
      expect(store.locomotive!.front.t).not.toBe(oldFrontX)
      // 3. La motrice est prête à avancer vers l'avant dans sa nouvelle direction
      expect(store.locomotive!.direction).toBe(1)
    })

    it('handleDropTrainItem places a TrainSet loco and couples the wagon dropped behind it', () => {
      const store = new EditorStore()
      const n1 = addNode(store.network, { x: 0, y: 0 })
      const n2 = addNode(store.network, { x: 300, y: 0 })
      addSegment(store.network, n1.id, n2.id)

      // 1. Drag & drop d'une motrice : un TrainSet, jamais de locomotive legacy
      const droppedLoco = store.handleDropTrainItem('tgv_loco', { x: 50, y: 0 })
      expect(droppedLoco).toBe(true)
      expect(store.locomotive).toBeNull()
      expect(store.trains).toHaveLength(1)
      expect(store.isTrainSelected).toBe(true)

      // 2. Drag & drop d'un wagon juste derrière → attelé au train en cours
      const droppedWagon = store.handleDropTrainItem('tgv_wagon', { x: 30, y: 0 })
      expect(droppedWagon).toBe(true)
      expect(store.trains).toHaveLength(1)
      expect(store.trains[0].vehicles.map(v => v.kind)).toEqual(['loco', 'wagon'])

      // 3. Vérification de sélection et survol
      const hover = store.checkTrainHover({ x: 50, y: 0 })
      expect(hover.hit).toBe(true)

      store.selectTrain(false)
      expect(store.isTrainSelected).toBe(false)
    })

    it('flipTrainPlacementDirection toggles direction and updates single-vehicle preview orientation', () => {
      const store = new EditorStore()
      const n1 = addNode(store.network, { x: 0, y: 0 })
      const n2 = addNode(store.network, { x: 200, y: 0 })
      addSegment(store.network, n1.id, n2.id)

      store.tool = 'locomotive'
      store.trainToolSubMode = 'place'
      expect(store.trainPlacementDirection).toBe(1)

      // Hover on track at x=100
      store.updateLocomotivePreview({ x: 100, y: 0 })
      expect(store.trainPlacementPreview).not.toBeNull()
      expect(store.trainPlacementPreview!.vehicles).toHaveLength(1)
      const vehForward = store.trainPlacementPreview!.vehicles[0]
      expect(vehForward.front.forward).toBe(true)

      // Flip direction (R key)
      store.flipTrainPlacementDirection()
      expect(store.trainPlacementDirection).toBe(-1)
      expect(store.trainPlacementPreview).not.toBeNull()
      const vehReversed = store.trainPlacementPreview!.vehicles[0]
      expect(vehReversed.front.forward).toBe(false)

      // Placing train retains the flipped orientation
      const placed = store.placeTrainItem({ x: 100, y: 0 })
      expect(placed).toBe(true)
      expect(store.trains).toHaveLength(1)
      expect(store.trains[0].vehicles[0].front.forward).toBe(false)
    })
  })

  describe('TrainSet driving controls', () => {
    function makeDrivingStore(): EditorStore {
      const store = new EditorStore()
      const n1 = addNode(store.network, { x: 0, y: 0 })
      const n2 = addNode(store.network, { x: 2000, y: 0 })
      addSegment(store.network, n1.id, n2.id)
      expect(store.placeTrainLoco({ x: 1000, y: 0 })).toBe(true)
      store.togglePlayMode()
      return store
    }

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('selects the train on entering play mode with its controls at rest', () => {
      const store = makeDrivingStore()
      const train = store.selectedTrain!
      expect(train.reverser).toBe('neutral')
      expect(train.notch).toBe(0)
    })

    it('puts every train at rest, brakes applied, on entering play mode', () => {
      const store = makeDrivingStore()
      store.togglePlayMode()
      expect(store.placeTrainLoco({ x: 400, y: 0 })).toBe(true)
      expect(store.trains).toHaveLength(2)

      // The state a train leaves from is the domain's: the store only has to ask for it
      const reset = vi.spyOn(trainModel, 'resetTrainControls')
      store.togglePlayMode()
      expect(reset.mock.calls.map(([t]) => t.id).sort()).toEqual(store.trains.map((t) => t.id).sort())
    })

    it('steps the traction handle one notch at a time, from N to P5 and no further', () => {
      const store = makeDrivingStore()
      const train = store.selectedTrain!

      store.stepSelectedTrainNotch(1)
      store.stepSelectedTrainNotch(1)
      expect(train.notch).toBe(2)
      store.stepSelectedTrainNotch(-1)
      expect(train.notch).toBe(1)

      // No brake notches below N any more: the brake has its own handle
      for (let i = 0; i < 4; i++) store.stepSelectedTrainNotch(-1)
      expect(train.notch).toBe(0)
      store.setSelectedTrainNotch(-3)
      expect(train.notch).toBe(0)

      for (let i = 0; i < 9; i++) store.stepSelectedTrainNotch(1)
      expect(train.notch).toBe(trainModel.MAX_NOTCH)
      store.setSelectedTrainNotch(12)
      expect(train.notch).toBe(trainModel.MAX_NOTCH)
    })

    it('moves the brake handle of the driven train and tells the interface', () => {
      const store = makeDrivingStore()
      const train = store.selectedTrain!
      const setBrake = vi.spyOn(trainDynamicsModel, 'setBrakeCommand')
      let notified = 0
      store.subscribe(() => { notified++ })

      store.setSelectedTrainBrakeCommand('release')
      expect(setBrake).toHaveBeenLastCalledWith(train, 'release')
      expect(train.brakeCommand).toBe('release')
      store.setSelectedTrainBrakeCommand('apply')
      expect(train.brakeCommand).toBe('apply')
      store.setSelectedTrainBrakeCommand('hold')
      expect(train.brakeCommand).toBe('hold')
      expect(notified).toBe(3)

      // Asking for the position the handle is already in changes nothing
      store.setSelectedTrainBrakeCommand('hold')
      expect(setBrake).toHaveBeenCalledTimes(3)
      expect(notified).toBe(3)
    })

    it('simulates every train on each step, also at rest, with the height of a track level', () => {
      const store = makeDrivingStore()
      store.togglePlayMode()
      expect(store.placeTrainLoco({ x: 400, y: 0 })).toBe(true)
      store.setGradientSettings({ levelHeight: 4.5 })
      store.togglePlayMode()
      const tick = vi.spyOn(trainModel, 'tickTrainSet').mockReturnValue(true)

      // Both trains are stopped with the handle on N: brakes released on a slope, they must be able to roll
      expect(store.trains.every((t) => t.currentSpeed === 0 && t.notch === 0)).toBe(true)
      store.tickAllTrains(0.1)

      expect(tick.mock.calls.map(([, t]) => t.id).sort()).toEqual(store.trains.map((t) => t.id).sort())
      for (const [net, , dt, others, , env] of tick.mock.calls) {
        expect(net).toBe(store.network)
        expect(dt).toBe(0.1)
        expect(others).toBe(store.trains)
        expect(env).toEqual({ levelHeight: 4.5 })
      }
    })

    it('does not simulate outside play mode', () => {
      const store = makeDrivingStore()
      store.togglePlayMode()
      const tick = vi.spyOn(trainModel, 'tickTrainSet').mockReturnValue(true)
      store.tickAllTrains(0.1)
      expect(tick).not.toHaveBeenCalled()
    })

    it('lets go of the brake handle of a train that is no longer driven', () => {
      const store = makeDrivingStore()
      store.togglePlayMode()
      expect(store.placeTrainLoco({ x: 400, y: 0 })).toBe(true)
      store.togglePlayMode()
      vi.spyOn(trainModel, 'tickTrainSet').mockReturnValue(true)
      const first = store.selectedTrain!
      const second = store.trains.find((t) => t !== first)!

      store.setSelectedTrainBrakeCommand('release')
      store.tickAllTrains(0.1)
      expect(first.brakeCommand).toBe('release')

      // The driver takes the other train with the key still down
      store.selectTrainById(second.id)
      store.tickAllTrains(0.1)
      expect(first.brakeCommand).toBe('hold')
    })

    it('reads what it shows of the driven train from the physics', () => {
      const store = makeDrivingStore()
      store.setGradientSettings({ levelHeight: 4.5 })
      const dynamics = vi.spyOn(trainDynamicsModel, 'trainDynamics')

      const shown = store.selectedTrainDynamics
      expect(dynamics).toHaveBeenCalledWith(store.network, store.selectedTrain, { levelHeight: 4.5 })
      expect(shown).toBe(dynamics.mock.results[0].value)

      store.selectTrainById(null)
      expect(store.selectedTrainDynamics).toBeNull()
    })

    it('refuses to throw the reverser while the train is moving', () => {
      const store = makeDrivingStore()
      const train = store.selectedTrain!
      store.setSelectedTrainReverser('forward')
      train.currentSpeed = 10
      store.setSelectedTrainReverser('reverse')
      store.flipLocomotiveDirection()
      expect(train.reverser).toBe('forward')
      expect(train.currentSpeed).toBe(10)
    })

    it('latches the emergency brake until the train has stopped', () => {
      const store = makeDrivingStore()
      const train = store.selectedTrain!
      store.setSelectedTrainReverser('forward')
      store.setSelectedTrainNotch(5)
      train.currentSpeed = 30

      store.toggleSelectedTrainEmergencyBrake()
      expect(train.emergencyBrake).toBe(true)

      // Neither the handle nor a second press releases it while moving
      store.setSelectedTrainNotch(5)
      store.toggleSelectedTrainEmergencyBrake()
      expect(train.emergencyBrake).toBe(true)

      train.currentSpeed = 0
      store.toggleSelectedTrainEmergencyBrake()
      expect(train.emergencyBrake).toBe(false)
    })

    it('leaves a train stopped by an obstacle to the domain: no speed or handle forced by the store', () => {
      const store = makeDrivingStore()
      const train = store.selectedTrain!
      store.setSelectedTrainReverser('forward')
      store.setSelectedTrainNotch(3)
      // The domain reports the obstacle and has already settled the train's speed
      vi.spyOn(trainModel, 'tickTrainSet').mockImplementation((_net, t) => {
        t.currentSpeed = 0.4
        return false
      })

      store.tickAllTrains(0.1)
      expect(train.currentSpeed).toBe(0.4)
      expect(train.notch).toBe(3)
      expect(store.locomotiveCurrentSpeed).toBe(0.4)
    })

    it('reports an impact above 5 km/h once, with its speed', () => {
      const store = makeDrivingStore()
      const train = store.selectedTrain!
      const impacts: number[] = []
      store.onTrainImpact = (t, speed) => {
        expect(t).toBe(train)
        impacts.push(speed)
      }
      let impactSpeed = 0
      vi.spyOn(trainModel, 'tickTrainSet').mockImplementation((_net, t) => {
        t.impactSpeed = impactSpeed
        return impactSpeed === 0
      })

      store.tickAllTrains(0.1)
      expect(impacts).toEqual([])

      // A touch at walking pace is not worth a message
      impactSpeed = IMPACT_REPORT_SPEED * 0.9
      store.tickAllTrains(0.1)
      expect(impacts).toEqual([])

      impactSpeed = 8
      store.tickAllTrains(0.1)
      store.tickAllTrains(0.1)
      expect(impacts).toEqual([8])

      // Once the train has come off the obstacle, the next impact is a new one
      impactSpeed = 0
      store.tickAllTrains(0.1)
      impactSpeed = 3
      store.tickAllTrains(0.1)
      expect(impacts).toEqual([8, 3])
      expect(trainImpactMessage(8)).toBe('Choc à 29 km/h')
    })

    it('puts every control back at rest when leaving play mode', () => {
      const store = makeDrivingStore()
      const train = store.selectedTrain!
      store.setSelectedTrainReverser('reverse')
      store.setSelectedTrainNotch(3)
      store.togglePlayMode()
      expect(train.reverser).toBe('neutral')
      expect(train.notch).toBe(0)
      expect(train.currentSpeed).toBe(0)
    })
  })
})

describe('EditorStore scale-aware reconcile and drag restore', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
  })

  const addParallelTracks = (store: EditorStore, spacing: number) => {
    const a1 = addNode(store.network, { x: 0, y: 0 })
    const a2 = addNode(store.network, { x: 1, y: 0 })
    addSegment(store.network, a1.id, a2.id)
    const b1 = addNode(store.network, { x: 0.3, y: spacing })
    const b2 = addNode(store.network, { x: 0.7, y: spacing })
    addSegment(store.network, b1.id, b2.id)
  }

  it('derives the placement thresholds from the gauge of the scale preset', () => {
    const store = new EditorStore()
    expect(store.getPlacementThresholds().reconcileTolerance).toBeCloseTo(0.1)
    store.setScalePreset('HO', false)
    const th = store.getPlacementThresholds()
    expect(th.k).toBeCloseTo(0.0165 / 1.435)
    expect(th.reconcileTolerance).toBeLessThan(0.002)
    expect(th.minRadius).toBeCloseTo(0.1725, 3)
  })

  it('reconcileNetwork leaves HO parallel tracks 5 cm apart untouched', () => {
    const store = new EditorStore()
    store.setScalePreset('HO', false)
    addParallelTracks(store, 0.05)
    expect(store.reconcileNetwork()).toEqual({ splitCount: 0, weldedCount: 0 })
    expect(store.network.segments.size).toBe(2)
    // The manual heal pass (R key) is scaled as well
    expect(store.reconcileTopology()).toEqual({ splitCount: 0, weldedCount: 0 })
    expect(store.network.segments.size).toBe(2)
  })

  it('undo / redo and reload at HO scale do not re-split parallel tracks', () => {
    const store = new EditorStore()
    store.setScalePreset('HO', false)
    addParallelTracks(store, 0.05)
    store.markDirty()
    const extra = addNode(store.network, { x: 2, y: 1 })
    const extra2 = addNode(store.network, { x: 2.2, y: 1 })
    addSegment(store.network, extra.id, extra2.id)
    store.markDirty()
    expect(store.network.segments.size).toBe(3)

    store.undo()
    expect(store.network.segments.size).toBe(2)
    expect(store.network.nodes.size).toBe(4)
    store.redo()
    expect(store.network.segments.size).toBe(3)

    const reloaded = new EditorStore()
    expect(reloaded.network.segments.size).toBe(3)
    expect(reloaded.network.nodes.size).toBe(6)
  })

  it('cancelInteraction restores the control points reshaped by a node drag', () => {
    const store = new EditorStore()
    const a = addNode(store.network, { x: 0, y: 0 })
    const b = addNode(store.network, { x: 50, y: 50 })
    const curve = addCurveSegment(store.network, a.id, b.id, { x: 50, y: 0 })!

    // Same bookkeeping as the select-tool drag in Canvas: only node b is dragged, the curve is not selected
    store.selection = { nodes: new Set([b.id]), segments: new Set() }
    store.isDraggingNode = true
    store.draggedNodeInitialPositions.set(b.id, { ...b.pos })
    store.draggedViaInitialPositions = collectAffectedVias(store.network, [b.id])
    applyNodeTransform(store.network, store.draggedNodeInitialPositions, store.draggedViaInitialPositions, {
      kind: 'translate',
      delta: { x: 20, y: 20 },
    })
    expect(store.network.segments.get(curve.id)!.via).not.toEqual({ x: 50, y: 0 })

    store.cancelInteraction()
    expect(store.network.nodes.get(b.id)!.pos).toEqual({ x: 50, y: 50 })
    expect(store.network.segments.get(curve.id)!.via).toEqual({ x: 50, y: 0 })
    expect(store.draggedViaInitialPositions.size).toBe(0)
  })
})

describe('EditorStore tool switching', () => {
  it('drops the working-node selection of a construction tool when the tool is left', () => {
    const store = new EditorStore()
    const a = addNode(store.network, { x: 0, y: 0 })
    const b = addNode(store.network, { x: 50, y: 0 })
    addSegment(store.network, a.id, b.id)

    store.setTool('place')
    store.lastNodeId = b.id
    store.selection = { nodes: new Set([b.id]), segments: new Set() }
    store.setTool('select')
    expect(store.selection.nodes.size).toBe(0)

    // A selection made with the select tool is kept when switching away
    store.selection = { nodes: new Set([a.id]), segments: new Set() }
    store.setTool('place')
    expect(store.selection.nodes.has(a.id)).toBe(true)
  })
})
