import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
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

    it('handleDropTrainItem places loco and appends passenger wagons via drag and drop', () => {
      const store = new EditorStore()
      const n1 = addNode(store.network, { x: 0, y: 0 })
      const n2 = addNode(store.network, { x: 300, y: 0 })
      addSegment(store.network, n1.id, n2.id)

      // 1. Drag & drop d'une motrice
      const droppedLoco = store.handleDropTrainItem('tgv_loco', { x: 50, y: 0 })
      expect(droppedLoco).toBe(true)
      expect(store.locomotive).not.toBeNull()
      expect(store.isTrainSelected).toBe(true)

      // 2. Drag & drop d'un wagon sur la voie → crée un TrainSet wagon indépendant
      const droppedWagon = store.handleDropTrainItem('tgv_wagon', { x: 40, y: 0 })
      expect(droppedWagon).toBe(true)
      // New behavior: wagon creates an independent TrainSet, not added to the loco count
      expect(store.trains.length).toBeGreaterThanOrEqual(1)

      // 3. Vérification de sélection et survol
      const hover = store.checkTrainHover({ x: 50, y: 0 })
      expect(hover.hit).toBe(true)

      store.selectTrain(false)
      expect(store.isTrainSelected).toBe(false)
    })
  })
})
