import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { addArcCurve, addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { curveCant, DEFAULT_LINE_SETTINGS } from '@domain/models/speedLimits'
import { checkDerailment } from '@domain/models/train'
import type { Segment } from '@domain/models/types'

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
})

/** A store with a committed track: a straight rail, then a curve of 945 m of radius turning by a quarter */
function storeWithCurve(): { store: EditorStore; straight: Segment; curve: Segment[] } {
  const store = new EditorStore()
  const net = store.network
  const a = addNode(net, { x: -1000, y: 0 })
  const b = addNode(net, { x: 0, y: 0 })
  const c = addNode(net, { x: 945, y: 945 })
  const d = addNode(net, { x: 945, y: 3945 })
  const straight = addSegment(net, a.id, b.id)!
  const curve = addArcCurve(net, b.id, c.id, { x: 945, y: 0 })!.segments
  addSegment(net, c.id, d.id)
  store.markDirty()
  return { store, straight, curve }
}

describe('line settings of the project', () => {
  it('a new project is a conventional line at 160 km/h, at full size', () => {
    const store = new EditorStore()
    expect(store.lineSettings).toEqual({ lineSpeed: 160, lineType: 'classic', gauge: 1.435, realScale: true })
    expect(store.drivingEnvironment.line).toEqual(store.lineSettings)
  })

  it('setLineSettings changes one or both, within the range, as one undo step', () => {
    const { store } = storeWithCurve()
    store.setLineSettings({ lineSpeed: 300, lineType: 'highSpeed' })
    expect(store.lineSettings).toMatchObject({ lineSpeed: 300, lineType: 'highSpeed' })
    store.setLineSettings({ lineSpeed: 220.4 })
    expect(store.lineSettings).toMatchObject({ lineSpeed: 220, lineType: 'highSpeed' })
    store.setLineSettings({ lineType: 'classic' })
    expect(store.lineSettings).toMatchObject({ lineSpeed: 220, lineType: 'classic' })

    store.setLineSettings({ lineSpeed: 5000 })
    expect(store.lineSpeed).toBe(360)
    store.setLineSettings({ lineSpeed: 1 })
    expect(store.lineSpeed).toBe(10)

    // Ignored: nothing changes and no undo step is taken
    store.setLineSettings({ lineSpeed: 220 })
    let notified = 0
    const stop = store.subscribe(() => notified++)
    store.setLineSettings({ lineSpeed: NaN })
    store.setLineSettings({ lineType: 'maglev' as never })
    store.setLineSettings({ lineSpeed: 220, lineType: 'classic' })
    store.setLineSettings({})
    stop()
    expect(notified).toBe(0)
    expect(store.lineSettings).toMatchObject({ lineSpeed: 220, lineType: 'classic' })

    store.undo()
    expect(store.lineSpeed).toBe(10)
    store.undo()
    expect(store.lineSpeed).toBe(360)
    store.undo()
    expect(store.lineSettings).toMatchObject({ lineSpeed: 220, lineType: 'classic' })
    store.undo()
    expect(store.lineSettings).toMatchObject({ lineSpeed: 220, lineType: 'highSpeed' })
    store.undo()
    expect(store.lineSettings).toMatchObject({ lineSpeed: 300, lineType: 'highSpeed' })
    store.undo()
    expect(store.lineSettings).toMatchObject({ lineSpeed: 160, lineType: 'classic' })
    store.redo()
    expect(store.lineSettings).toMatchObject({ lineSpeed: 300, lineType: 'highSpeed' })
  })

  it('they are saved with the project: reload, export and import', () => {
    const { store } = storeWithCurve()
    store.setLineSettings({ lineSpeed: 320, lineType: 'highSpeed' })

    const reloaded = new EditorStore()
    expect(reloaded.loadPersistedState()).toBe(true)
    expect(reloaded.lineSettings).toMatchObject({ lineSpeed: 320, lineType: 'highSpeed' })

    const exported = JSON.parse(JSON.stringify(store.exportProject()))
    expect(exported).toMatchObject({ lineSpeed: 320, lineType: 'highSpeed' })
    const imported = new EditorStore()
    imported.loadFromData(exported)
    expect(imported.lineSettings).toMatchObject({ lineSpeed: 320, lineType: 'highSpeed' })

    // A file without them puts the project back on the default line
    delete exported.lineSpeed
    delete exported.lineType
    imported.loadFromData(exported)
    expect(imported.lineSettings).toMatchObject(DEFAULT_LINE_SETTINGS)
    expect('lineSpeed' in JSON.parse(JSON.stringify(imported.exportProject()))).toBe(false)
  })

  it('the curves follow the line settings', () => {
    const { store, curve } = storeWithCurve()
    expect(curveCant(store.network, curve[0], store.lineSettings)).toMatchObject({ cant: 160, maxSpeed: 160 })
    store.setLineSettings({ lineSpeed: 100 })
    // 125 mm of equilibrium at 100 km/h: 51 % of it
    expect(curveCant(store.network, curve[0], store.lineSettings)).toMatchObject({ cant: 65, appliedSpeed: 100 })
  })

  it('off the 1:1 scale the settings say so: no cant, no curve speed', () => {
    const { store, curve } = storeWithCurve()
    expect(curveCant(store.network, curve[0], store.lineSettings)).not.toBeNull()
    store.setScalePreset('HO', false)
    expect(store.lineSettings).toMatchObject({ realScale: false, gauge: 0.0165 })
    expect(store.drivingEnvironment.line!.realScale).toBe(false)
    expect(curveCant(store.network, curve[0], store.lineSettings)).toBeNull()
    store.setScalePreset('1:1', false)
    expect(curveCant(store.network, curve[0], store.lineSettings)).not.toBeNull()
  })
})

describe('cant set by hand on the selection', () => {
  it('goes on the selected curved rails only, within the range, as one undo step', () => {
    const { store, straight, curve } = storeWithCurve()
    store.setSelection({ nodes: new Set(), segments: new Set([straight.id, curve[0].id, curve[1].id]) })
    expect(store.setSelectionCant(120.4)).toBe(true)
    const seg = (id: string): Segment => store.network.segments.get(id)!
    expect(seg(curve[0].id).cant).toBe(120)
    expect(seg(curve[1].id).cant).toBe(120)
    expect(seg(curve[2].id).cant).toBeUndefined()
    expect(seg(straight.id).cant).toBeUndefined()
    expect(curveCant(store.network, seg(curve[0].id), store.lineSettings)).toMatchObject({ cant: 120, automatic: false })

    // Same value again: nothing to do
    expect(store.setSelectionCant(120)).toBe(false)
    expect(store.setSelectionCant(NaN)).toBe(false)
    expect(store.setSelectionCant(500)).toBe(true)
    expect(seg(curve[0].id).cant).toBe(180)
    expect(store.setSelectionCant(-30)).toBe(true)
    expect(seg(curve[0].id).cant).toBe(0)

    store.undo()
    expect(seg(curve[0].id).cant).toBe(180)
    store.undo()
    expect(seg(curve[0].id).cant).toBe(120)
    store.undo()
    expect(seg(curve[0].id).cant).toBeUndefined()
    store.redo()
    expect(seg(curve[0].id).cant).toBe(120)
  })

  it('null gives the rails back to the automatic rule', () => {
    const { store, curve } = storeWithCurve()
    store.setSelection({ nodes: new Set(), segments: new Set([curve[0].id]) })
    expect(store.setSelectionCant(null)).toBe(false)
    store.setSelectionCant(40)
    expect(store.setSelectionCant(null)).toBe(true)
    expect(store.network.segments.get(curve[0].id)!.cant).toBeUndefined()
    expect(curveCant(store.network, curve[0], store.lineSettings)).toMatchObject({ cant: 160, automatic: true })
  })

  it('nothing happens on a selection without curved rail', () => {
    const { store, straight } = storeWithCurve()
    store.setSelection({ nodes: new Set(), segments: new Set([straight.id]) })
    expect(store.setSelectionCant(100)).toBe(false)
    expect(store.network.segments.get(straight.id)!.cant).toBeUndefined()
  })

  it('survives a reload', () => {
    const { store, curve } = storeWithCurve()
    store.setSelection({ nodes: new Set(), segments: new Set([curve[2].id]) })
    store.setSelectionCant(163)
    const reloaded = new EditorStore()
    expect(reloaded.loadPersistedState()).toBe(true)
    expect(reloaded.network.segments.get(curve[2].id)!.cant).toBe(163)
    expect(reloaded.network.segments.get(curve[1].id)!.cant).toBeUndefined()
  })
})

describe('putting a derailed train back on the track', () => {
  /** The driven train, running at `kmh` in the middle of the curve laid with 163 mm */
  function driving(kmh: number) {
    const { store, curve } = storeWithCurve()
    store.setSelection({ nodes: new Set(), segments: new Set(curve.map((s) => s.id)) })
    store.setSelectionCant(163)
    store.setTrainPlacementKind('tgv_loco')
    store.camera.scale = 3
    const middle = curve[3]
    const from = store.network.nodes.get(middle.from)!.pos
    expect(store.placeTrainItem(from)).toBe(true)
    store.togglePlayMode()
    const train = store.selectedTrain!
    train.currentSpeed = kmh / 3.6
    return { store, train }
  }

  it('the train derails in the curve at 235 km/h, and the dynamics say why', () => {
    const { store, train } = driving(235)
    expect(store.selectedTrainDynamics!.cantDeficiency).toBeGreaterThanOrEqual(525)
    store.tickAllTrains(1 / 60)
    expect(train.derailed).toMatchObject({ limit: 160 })
    expect(train.derailed!.speed).toBeCloseTo(235, 0)
    store.togglePlayMode()
  })

  it('rerailSelectedTrain clears the derailment, once; leaving and entering the drive does not', () => {
    const { store, train } = driving(235)
    expect(store.rerailSelectedTrain()).toBe(false)
    expect(checkDerailment(store.network, train, store.drivingEnvironment)).toBe(true)

    store.togglePlayMode()
    store.togglePlayMode()
    expect(store.selectedTrain!.derailed).not.toBeNull()
    store.setSelectedTrainNotch(3)
    expect(store.selectedTrain!.notch).toBe(0)

    let notified = 0
    const stop = store.subscribe(() => notified++)
    expect(store.rerailSelectedTrain()).toBe(true)
    expect(notified).toBe(1)
    expect(store.rerailSelectedTrain()).toBe(false)
    expect(notified).toBe(1)
    stop()
    expect(store.selectedTrain).toMatchObject({ derailed: null, currentSpeed: 0, emergencyBrake: false })
    store.togglePlayMode()
  })

  it('nothing derails off the 1:1 scale', () => {
    const { store, train } = driving(235)
    store.scalePreset = 'HO'
    store.tickAllTrains(1 / 60)
    expect(train.derailed).toBeNull()
    expect(store.selectedTrainDynamics).toMatchObject({ cantDeficiency: 0, curveState: 'ok' })
    store.togglePlayMode()
  })
})
