import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, resetIdCounter, segmentEndLevels } from '@domain/models/network'
import { analyzeKinematics } from '@domain/services/kinematicDiagnostics'
import { detectCrossings } from '@domain/models/crossing'
import { trainDynamics } from '@domain/models/trainDynamics'
import type { OsmSource } from '@domain/import/osmTypes'
import { getStorage, resetMemoryStorage, STORAGE_KEY } from '@infrastructure/persistence/persistence'
import { networkDerived } from '@infrastructure/render/networkDerived'
import { rampSummary } from '@presentation/components/common/trackLevel'

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
})

const SOURCE: OsmSource = { lat: 45.7603, lon: 4.8594, dataDate: '2026-10-05T22:00:00Z', importedAt: '2026-10-06T09:30:00Z' }

/** A store holding one 1 000 m rail climbing one level (6 m) towards +x: 6 ‰, or 60 ‰ with `length` 100 */
function storeWithRamp(length = 1000) {
  const store = new EditorStore()
  const a = addNode(store.network, { x: 0, y: 0 })
  const b = addNode(store.network, { x: length, y: 0 }, 1)
  const seg = addSegment(store.network, a.id, b.id)!
  store.markDirty()
  return { store, seg }
}

const steep = (store: EditorStore) =>
  analyzeKinematics(store.network, store.gauge, store.gradientLimits).filter((i) => i.kind === 'steep_gradient')

describe('levels without relief', () => {
  it('are off by default, and one undo step when switched', () => {
    const store = new EditorStore()
    expect(store.flatLevels).toBe(false)
    store.setFlatLevels(true)
    store.setFlatLevels(true) // nothing changed: no second step
    expect(store.flatLevels).toBe(true)

    store.undo()
    expect(store.flatLevels).toBe(false)
    expect(store.canUndo).toBe(false)
    store.redo()
    expect(store.flatLevels).toBe(true)
    expect(store.canRedo).toBe(false)
  })

  it('keep the slope settings of the project, which come back when the relief does', () => {
    const store = new EditorStore()
    store.setGradientSettings({ levelHeight: 7.5, maxGradient: 25 })
    store.setFlatLevels(true)
    expect(store.gradientLimits).toEqual({ levelHeight: 0, maxGradient: 25 })
    expect(store.levelHeight).toBe(7.5)
    expect(store.exportProject()).toMatchObject({ levelHeight: 7.5, maxGradient: 25, flatLevels: true })
    store.setFlatLevels(false)
    expect(store.gradientLimits).toEqual({ levelHeight: 7.5, maxGradient: 25 })
  })

  it('a train on a ramp feels no grade force, and the usual one with relief', () => {
    const { store } = storeWithRamp()
    store.camera.scale = 3
    store.setTrainPlacementKind('tgv_loco')
    expect(store.placeTrainItem({ x: 500, y: 0 })).toBe(true)
    const dynamics = () => trainDynamics(store.network, store.trains[0], store.drivingEnvironment)

    const withRelief = dynamics()
    expect(Math.abs(withRelief.gradientPermille)).toBeCloseTo(6, 6)
    expect(Math.abs(withRelief.gradeForce)).toBeGreaterThan(1000)

    store.setFlatLevels(true)
    expect(store.drivingEnvironment.levelHeight).toBe(0)
    expect(dynamics().gradientPermille).toBeCloseTo(0, 12)
    expect(dynamics().gradeForce).toBeCloseTo(0, 12)

    store.setFlatLevels(false)
    expect(dynamics().gradeForce).toBeCloseTo(withRelief.gradeForce, 6)
  })

  it('a steep ramp is reported only with relief, on the plan and in the panel alike', () => {
    const { store, seg } = storeWithRamp(100) // 60 ‰ against 35 ‰
    const derived = () => networkDerived(store.network, store.sectionMeta)
    const summary = () => rampSummary(store.network, seg, { ...store.gradientLimits, unit: store.unit })

    expect(steep(store)).toHaveLength(1)
    expect(derived().ramps(store.gradientLimits.levelHeight).ramps).toHaveLength(1)
    expect(summary()).toMatchObject({ rise: '6.00 m', gradient: '60 ‰ en montée', tooSteep: true })

    store.setFlatLevels(true)
    expect(steep(store)).toHaveLength(0)
    expect(derived().kinematicIssues(store.gauge, store.gradientLimits).filter((i) => i.kind === 'steep_gradient')).toHaveLength(0)
    // No slope marked on the track, none given for the rail: its two levels only
    expect(derived().ramps(store.gradientLimits.levelHeight).ramps).toHaveLength(0)
    expect(summary()).toEqual({ from: 'Sol', to: 'Pont +1', rise: null, gradient: null, tooSteep: false })

    store.setFlatLevels(false)
    expect(steep(store)).toHaveLength(1)
  })

  it('leave the stacking alone: the levels of the rails, and who crosses whom', () => {
    const store = new EditorStore()
    const net = store.network
    addSegment(net, addNode(net, { x: -100, y: 0 }).id, addNode(net, { x: 100, y: 0 }).id)
    const over = addSegment(net, addNode(net, { x: 0, y: -100 }, 1).id, addNode(net, { x: 0, y: 100 }, 1).id)!
    store.reconcileNetwork()
    store.markDirty()
    const picture = () => ({
      rails: net.segments.size,
      nodes: net.nodes.size,
      crossings: detectCrossings(store.network).length,
      bridge: segmentEndLevels(store.network, store.network.segments.get(over.id)!),
    })
    const before = picture()
    expect(before).toMatchObject({ rails: 2, nodes: 4, bridge: { from: 1, to: 1 } })

    store.setFlatLevels(true)
    store.reconcileNetwork()
    expect(picture()).toEqual(before)
  })

  it('are saved with the project and read back: autosave, JSON export and import', () => {
    const store = new EditorStore()
    store.setFlatLevels(true)

    expect(new EditorStore().flatLevels).toBe(true)

    const json = JSON.stringify(store.exportProject())
    expect(JSON.parse(json).flatLevels).toBe(true)
    resetMemoryStorage()
    const fresh = new EditorStore()
    expect(fresh.flatLevels).toBe(false)
    fresh.loadFromData(JSON.parse(json))
    expect(fresh.flatLevels).toBe(true)
    // The autosave follows the import
    expect(new EditorStore().flatLevels).toBe(true)
  })

  it('a project saved without the setting has relief, whatever the session held', () => {
    const data = JSON.parse(JSON.stringify(new EditorStore().exportProject()))
    expect('flatLevels' in data).toBe(false)
    expect('osmSource' in data).toBe(false)

    resetMemoryStorage()
    const fresh = new EditorStore()
    fresh.setFlatLevels(true)
    fresh.loadFromData(data)
    expect(fresh.flatLevels).toBe(false)

    // Found in the autosave of an older version
    resetMemoryStorage()
    getStorage()!.setItem(STORAGE_KEY, JSON.stringify(data))
    const reopened = new EditorStore()
    expect(reopened.flatLevels).toBe(false)
    expect(reopened.osmSource).toBeNull()

    // Anything but `true` counts as absent
    fresh.loadFromData({ ...data, flatLevels: 'yes' })
    expect(fresh.flatLevels).toBe(false)
  })
})

describe('provenance of imported data', () => {
  /** What an import hands to `loadFromData`: a project with both fields */
  const imported = () => ({ ...JSON.parse(JSON.stringify(new EditorStore().exportProject())), flatLevels: true, osmSource: { ...SOURCE } })

  it('is null for a project drawn by hand, and comes with a loaded project', () => {
    const store = new EditorStore()
    expect(store.osmSource).toBeNull()
    store.loadFromData(imported())
    expect(store.osmSource).toEqual(SOURCE)
    expect(store.flatLevels).toBe(true)
  })

  it('survives the autosave and the JSON export and import', () => {
    const store = new EditorStore()
    store.loadFromData(imported())

    expect(new EditorStore().osmSource).toEqual(SOURCE)

    const json = JSON.stringify(store.exportProject())
    expect(JSON.parse(json).osmSource).toEqual(SOURCE)
    resetMemoryStorage()
    const fresh = new EditorStore()
    fresh.loadFromData(JSON.parse(json))
    expect(fresh.osmSource).toEqual(SOURCE)
  })

  it('follows undo and redo: gone before the import, kept by every later step', () => {
    const store = new EditorStore()
    store.loadFromData(imported())
    // Later edits keep it
    const a = addNode(store.network, { x: 0, y: 0 })
    const b = addNode(store.network, { x: 50, y: 0 })
    addSegment(store.network, a.id, b.id)
    store.markDirty()
    store.setGradientSettings({ maxGradient: 20 })
    expect(store.osmSource).toEqual(SOURCE)

    store.undo()
    expect(store.osmSource).toEqual(SOURCE)
    expect(store.flatLevels).toBe(true)
    store.undo()
    expect(store.osmSource).toEqual(SOURCE)
    // Back before the import: a project drawn by hand again
    store.undo()
    expect(store.osmSource).toBeNull()
    expect(store.flatLevels).toBe(false)
    expect(new EditorStore().osmSource).toBeNull() // and so is the autosave

    store.redo()
    expect(store.osmSource).toEqual(SOURCE)
    expect(store.flatLevels).toBe(true)
  })

  it('does not stay behind when another project is loaded or a new one started', () => {
    const plain = JSON.parse(JSON.stringify(new EditorStore().exportProject()))
    resetMemoryStorage()
    const store = new EditorStore()
    store.loadFromData(imported())
    store.loadFromData(plain)
    expect(store.osmSource).toBeNull()
    expect(store.flatLevels).toBe(false)

    store.loadFromData(imported())
    store.newProject()
    expect(store.osmSource).toBeNull()
    expect(store.flatLevels).toBe(false)
    expect(store.exportProject().osmSource).toBeUndefined()
    store.undo() // nothing to go back to: the import is not behind the new project
    expect(store.osmSource).toBeNull()
  })
})
