import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { BLOCK_COLORS, signalSizes } from '@infrastructure/render/signalRender'
import { SIGNAL_REFUSAL_SHORT } from '../common/signalActions'
import { renderSignalToolPreview, resolveSignalTool } from './signalToolPreview'

/** A hand-rolled canvas context: every call is a spy, the styles are plain fields */
function mockContext() {
  const calls: { name: string; args: unknown[]; strokeStyle: unknown }[] = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, key) {
      if (typeof key !== 'string') return undefined
      if (key === 'measureText') return () => ({ width: 50 })
      if (key in state) return state[key]
      return (...args: unknown[]) => { calls.push({ name: key, args, strokeStyle: state.strokeStyle }) }
    },
    set(_t, key, value) {
      state[key as string] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

const VW = 800
const VH = 600

/** Track along y = 0 from x = 0 to x = 5000, with points at x = 5000; the camera looks at x = 1000 */
function storeWithTrack(): EditorStore {
  const store = new EditorStore()
  const net = store.network
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 5000, y: 0 })
  addSegment(net, a.id, b.id)
  const c = addNode(net, { x: 6000, y: 0 })
  addSegment(net, b.id, c.id)
  const d = addNode(net, { x: 6000, y: 200 })
  addSegment(net, b.id, d.id)
  store.camera.x = 1000
  store.camera.y = 0
  store.camera.scale = 3
  store.markDirty()
  return store
}

const paint = (store: EditorStore) => {
  const { ctx, calls } = mockContext()
  renderSignalToolPreview(ctx, store.camera, VW, VH, store)
  return calls
}
const arcs = (calls: ReturnType<typeof paint>) => calls.filter((c) => c.name === 'arc')
const texts = (calls: ReturnType<typeof paint>) => calls.filter((c) => c.name === 'fillText').map((c) => c.args[0])

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
  vi.restoreAllMocks()
})

describe('signal tool preview', () => {
  it('draws nothing without a signal tool, off the track, or while driving', () => {
    const store = storeWithTrack()
    store.cursorWorld = { x: 1000, y: -3 }
    expect(resolveSignalTool(store)).toBeNull()
    expect(paint(store)).toHaveLength(0)
    store.setSignalToolSubMode('speedZone')
    expect(paint(store)).toHaveLength(0)
    store.setSignalToolSubMode('blockSignal')
    store.cursorWorld = { x: 1000, y: 400 }
    expect(paint(store)).toHaveLength(0)
  })

  it('shows the signal on the side of the cursor, its arrow and the block it opens', () => {
    const store = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    store.cursorWorld = { x: 1000, y: -3 }
    expect(resolveSignalTool(store)).toMatchObject({ kind: 'single', aim: { forward: true, refusal: null } })
    const calls = paint(store)
    const offset = signalSizes(3, store.gauge).offset
    // Backing disc and lamp, both above the axis (the cursor is north of the track)
    expect(arcs(calls).length).toBeGreaterThanOrEqual(2)
    for (const arc of arcs(calls)) {
      expect(arc.args[0]).toBeCloseTo(VW / 2)
      expect(arc.args[1]).toBeCloseTo(VH / 2 - offset)
    }
    // The block it would open, in the colour of the next signal; no text at all
    expect(calls.some((c) => c.name === 'stroke' && c.strokeStyle === BLOCK_COLORS[0])).toBe(true)
    expect(texts(calls)).toEqual([])

    store.cursorWorld = { x: 1000, y: 3 }
    for (const arc of arcs(paint(store))) expect(arc.args[1]).toBeCloseTo(VH / 2 + offset)
  })

  it('colours the two blocks a signal would make between two others', () => {
    const store = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    store.beginSignalGesture({ x: 500, y: -3 })
    store.commitSignalGesture()
    store.cursorWorld = { x: 1000, y: -3 }
    const strokes = paint(store).filter((c) => c.name === 'stroke').map((c) => c.strokeStyle)
    // The block of the signal before it keeps its colour, the new one takes the next
    expect(strokes).toContain(BLOCK_COLORS[0])
    expect(strokes).toContain(BLOCK_COLORS[1])
  })

  it('with « double sens » shows a second signal across the track', () => {
    const store = storeWithTrack()
    store.setSignalToolSubMode('blockSignal')
    store.setSignalToolBothWays(true)
    store.cursorWorld = { x: 1000, y: -3 }
    const ys = new Set(arcs(paint(store)).map((arc) => Math.sign((arc.args[1] as number) - VH / 2)))
    expect(ys).toEqual(new Set([-1, 1]))
  })

  it('strikes the signal through and says why where it cannot stand', () => {
    const store = storeWithTrack()
    store.camera.x = 5000
    store.setSignalToolSubMode('blockSignal')
    store.cursorWorld = { x: 4999.5, y: -3 }
    expect(resolveSignalTool(store)).toMatchObject({ kind: 'single', aim: { refusal: 'on-switch' } })
    const calls = paint(store)
    expect(texts(calls)).toEqual([SIGNAL_REFUSAL_SHORT['on-switch']])
    expect(calls.some((c) => c.name === 'stroke' && c.strokeStyle === '#ef4444')).toBe(true)
    // No block is promised for a signal that will not be laid
    expect(calls.some((c) => c.name === 'stroke' && c.strokeStyle === BLOCK_COLORS[0])).toBe(false)
  })

  it('shows every signal of the row being drawn', () => {
    const store = storeWithTrack()
    store.camera.x = 2000
    store.camera.scale = 0.2
    store.setSignalToolSubMode('pathSignal')
    store.setSignalToolSpacing(1000)
    store.beginSignalGesture({ x: 500, y: -30 })
    store.updateSignalGesture({ x: 3600, y: -30 })
    const tool = resolveSignalTool(store)
    expect(tool?.kind).toBe('row')
    expect(tool?.kind === 'row' && tool.places.map((p) => p.refused)).toEqual([false, false, false, false])
    // One lamp per signal of the row (a path signal has a diamond head: its only arc is the lamp)
    expect(arcs(paint(store))).toHaveLength(4)
    store.setSignalToolBothWays(true)
    expect(arcs(paint(store))).toHaveLength(8)
  })
})
