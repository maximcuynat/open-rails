import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCamera } from '@infrastructure/render/camera'
import { createNetwork, addNode, addSegment, resetIdCounter, setNodesLevel } from '@domain/models/network'
import { addSignal, addSignalPair } from '@domain/models/signals'
import { createSignallingState } from '@domain/models/signalling'
import { signalReport } from '@domain/models/signalReport'
import { DEFAULT_LINE_SETTINGS } from '@domain/models/speedLimits'
import { speedSigns, type SpeedSign } from '@domain/models/speedSigns'
import type { Signal } from '@domain/models/types'
import { renderNetwork, type RenderNetworkOptions } from '@infrastructure/render/renderer'
import {
  BLOCK_ALPHA,
  BLOCK_COLORS,
  RESERVATION_ALPHA,
  RESERVATION_COLORS,
  SIGNAL_LAMP_COLORS,
  previewSignalBlocks,
  signalGlyph,
  signalHeadWorld,
  signalSizes,
  type SignalRenderOptions,
} from '@infrastructure/render/signalRender'

// The distant speed signs are worked out by the driving side: the drawing is tested against its contract
vi.mock('@domain/models/speedSigns', () => ({ speedSigns: vi.fn(() => []) }))

/** One canvas call, with the drawing state it was made in and where its path started */
interface Op {
  name: string
  args: unknown[]
  strokeStyle?: unknown
  fillStyle?: unknown
  lineWidth?: number
  globalAlpha: number
  start?: [number, number]
}

/**
 * Canvas context that records every call in order, with the style state at that moment (the
 * recorder of `trackLevels.test.ts`). `save` / `restore` keep a real state stack.
 */
function createRecordingContext(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = []
  let state: Record<string, unknown> = { globalAlpha: 1 }
  const stack: Record<string, unknown>[] = []
  let start: [number, number] | undefined
  const canvas = { width: 800, height: 600 }
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined
      if (key === 'canvas') return canvas
      if (key === 'measureText') return () => ({ width: 60 })
      if (key in state) return state[key]
      return (...args: unknown[]) => {
        if (key === 'save') stack.push({ ...state })
        if (key === 'restore') state = stack.pop() ?? state
        if (key === 'beginPath') start = undefined
        if (key === 'moveTo' && !start) start = [args[0] as number, args[1] as number]
        ops.push({
          name: key,
          args,
          strokeStyle: state.strokeStyle,
          fillStyle: state.fillStyle,
          lineWidth: state.lineWidth as number | undefined,
          globalAlpha: state.globalAlpha as number,
          start,
        })
      }
    },
    set(_target, key, value) {
      state[key as string] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, ops }
}

const VW = 800
const VH = 600
const SCALE = 0.5
const noSelection = () => ({ nodes: new Set<string>(), segments: new Set<string>() })
/** Track along y = 0 from x = 0 to x = 1000, seen whole: world (x, 0) is at screen (150 + x / 2, 300) */
const cam = () => createCamera(500, 0, SCALE)
const screenX = (x: number) => (x - 500) * SCALE + VW / 2
const AXIS_Y = VH / 2

function straightTrack(length = 1000, level = 0) {
  const net = createNetwork()
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: length, y: 0 })
  const seg = addSegment(net, a.id, b.id)!
  if (level !== 0) setNodesLevel(net, [a.id, b.id], level)
  return { net, seg }
}

function lay(net: ReturnType<typeof createNetwork>, segId: string, t: number, forward: boolean, role: Signal['role'] = 'spacing'): Signal {
  const laid = addSignal(net, { segId, t }, forward, role)
  if (!laid.ok) throw new Error(laid.reason)
  return laid.signal
}

function draw(net: ReturnType<typeof createNetwork>, signals?: Partial<SignalRenderOptions>, extra: RenderNetworkOptions = {}): Op[] {
  const { ctx, ops } = createRecordingContext()
  renderNetwork(ctx, cam(), VW, VH, net, noSelection(), {}, {
    tool: 'select',
    ...extra,
    ...(signals ? { signals: { level: 'standard', ...signals } } : {}),
  })
  return ops
}

const lampColors = new Set<string>(Object.values(SIGNAL_LAMP_COLORS))
/** The lit lamps drawn: one `arc` each, filled with a signal colour */
function lamps(ops: Op[]): { x: number; y: number; color: string }[] {
  const out: { x: number; y: number; color: string }[] = []
  ops.forEach((op, i) => {
    if (op.name !== 'arc') return
    const fill = ops.slice(i + 1).find((next) => next.name === 'fill' || next.name === 'stroke' || next.name === 'beginPath')
    if (fill?.name === 'fill' && typeof fill.fillStyle === 'string' && lampColors.has(fill.fillStyle)) {
      out.push({ x: op.args[0] as number, y: op.args[1] as number, color: fill.fillStyle })
    }
  })
  return out
}

/** The strokes made with one of the given colours */
const strokesOf = (ops: Op[], colors: readonly string[]) =>
  ops.filter((op) => op.name === 'stroke' && typeof op.strokeStyle === 'string' && colors.includes(op.strokeStyle))

const texts = (ops: Op[]) => ops.filter((op) => op.name === 'fillText').map((op) => op.args[0] as string)

beforeEach(() => {
  resetIdCounter(0)
  vi.mocked(speedSigns).mockReset()
  vi.mocked(speedSigns).mockReturnValue([])
})

describe('signals on the canvas', () => {
  it('draws nothing more for a network without signal: the very same calls as before', () => {
    const { net } = straightTrack()
    const plain = draw(net)
    for (const level of ['standard', 'pro'] as const) {
      const withLayer = draw(net, { level, showBlocks: true, showReservations: true, report: true, line: DEFAULT_LINE_SETTINGS, state: createSignallingState() })
      expect(withLayer.map((op) => [op.name, op.args])).toEqual(plain.map((op) => [op.name, op.args]))
    }
  })

  it('draws each signal on the left of the direction of travel it speaks to', () => {
    const { net, seg } = straightTrack()
    lay(net, seg.id, 0.25, true)
    lay(net, seg.id, 0.75, false)
    const drawn = lamps(draw(net, {}))
    expect(drawn).toHaveLength(2)
    const offset = signalSizes(SCALE).offset
    // Eastbound (y grows downwards on screen): its left is up
    const east = drawn.find((lamp) => Math.abs(lamp.x - screenX(250)) < 0.01)!
    expect(east.y).toBeCloseTo(AXIS_Y - offset)
    // Westbound: its left is down
    const west = drawn.find((lamp) => Math.abs(lamp.x - screenX(750)) < 0.01)!
    expect(west.y).toBeCloseTo(AXIS_Y + offset)
  })

  it('draws two signals back to back on either side of the track', () => {
    const { net, seg } = straightTrack()
    const pair = addSignalPair(net, { segId: seg.id, t: 0.5 }, 'spacing')
    expect(pair.ok).toBe(true)
    const ys = lamps(draw(net, {})).map((lamp) => lamp.y).sort((a, b) => a - b)
    expect(ys).toHaveLength(2)
    expect(ys[0]).toBeLessThan(AXIS_Y)
    expect(ys[1]).toBeGreaterThan(AXIS_Y)
    expect(ys[0] + ys[1]).toBeCloseTo(2 * AXIS_Y)
  })

  it('agrees with the hit test about where the head is', () => {
    const { net, seg } = straightTrack()
    const signal = lay(net, seg.id, 0.25, true)
    const head = signalHeadWorld(net, signal, SCALE)!
    const [lamp] = lamps(draw(net, {}))
    expect(screenX(head.x)).toBeCloseTo(lamp.x)
    expect(head.y * SCALE + AXIS_Y).toBeCloseTo(lamp.y)
  })

  it('outside driving shows the state at rest: a block signal open, a path signal closed', () => {
    const { net, seg } = straightTrack()
    lay(net, seg.id, 0.25, true, 'spacing')
    lay(net, seg.id, 0.75, true, 'protection')
    const drawn = lamps(draw(net, {})).sort((a, b) => a.x - b.x)
    expect(drawn.map((lamp) => lamp.color)).toEqual([SIGNAL_LAMP_COLORS.green, SIGNAL_LAMP_COLORS.red])
  })

  it('while driving shows what the engine says of each signal', () => {
    const { net, seg } = straightTrack()
    const first = lay(net, seg.id, 0.25, true)
    const second = lay(net, seg.id, 0.75, true)
    const state = createSignallingState()
    state.signals.set(first.id, { state: 'caution', cause: 'next-stop', clearedFor: null })
    state.signals.set(second.id, { state: 'stop', cause: 'occupied', clearedFor: null })
    const drawn = lamps(draw(net, { state })).sort((a, b) => a.x - b.x)
    expect(drawn.map((lamp) => lamp.color)).toEqual([SIGNAL_LAMP_COLORS.yellow, SIGNAL_LAMP_COLORS.red])
  })

  it('tells the shapes apart: round and diamond at the standard level, one lamp and two at the pro level', () => {
    const block: Signal = { id: 'a', segId: 's', t: 0, forward: true, role: 'spacing' }
    const path: Signal = { ...block, role: 'protection' }
    expect(signalGlyph(block, 'clear', 'standard')).toEqual({ shape: 'block', lamps: ['green'], plate: null })
    expect(signalGlyph(path, 'stop', 'standard')).toEqual({ shape: 'path', lamps: ['red'], plate: null })
    expect(signalGlyph(block, 'stop', 'pro')).toEqual({ shape: 'semaphore', lamps: ['red'], plate: 'F' })
    expect(signalGlyph(path, 'stop', 'pro')).toEqual({ shape: 'carre', lamps: ['red', 'red'], plate: 'Nf' })
    expect(signalGlyph(path, 'clear', 'pro')).toEqual({ shape: 'carre', lamps: ['green', null], plate: 'Nf' })
    // A marker board of a cab-signalled line has no lamp at the pro level, and is a plain signal at the standard one
    const marker: Signal = { ...path, cabMarker: true }
    expect(signalGlyph(marker, 'stop', 'pro')).toEqual({ shape: 'marker', lamps: [], plate: 'Nf' })
    expect(signalGlyph(marker, 'stop', 'standard').shape).toBe('path')
  })

  it('a closed carré lights two reds, a marker board none', () => {
    const { net, seg } = straightTrack()
    lay(net, seg.id, 0.25, true, 'protection')
    expect(lamps(draw(net, { level: 'pro' })).map((lamp) => lamp.color)).toEqual([SIGNAL_LAMP_COLORS.red, SIGNAL_LAMP_COLORS.red])
    expect(lamps(draw(net, { level: 'standard' }))).toHaveLength(1)

    const other = straightTrack()
    const laid = addSignal(other.net, { segId: other.seg.id, t: 0.5 }, true, 'spacing', { cabMarker: true })
    expect(laid.ok).toBe(true)
    expect(lamps(draw(other.net, { level: 'pro' }))).toHaveLength(0)
    expect(lamps(draw(other.net, { level: 'standard' }))).toHaveLength(1)
  })

  it('writes the plate of a pro signal once the zoom is close', () => {
    const { net, seg } = straightTrack()
    lay(net, seg.id, 0.5, true, 'protection')
    expect(texts(draw(net, { level: 'pro' }))).not.toContain('Nf')
    const { ctx, ops } = createRecordingContext()
    renderNetwork(ctx, createCamera(500, 0, 10), VW, VH, net, noSelection(), {}, { tool: 'select', signals: { level: 'pro' } })
    expect(texts(ops)).toContain('Nf')
  })

  it('rings the picked signal and the one about to be removed', () => {
    const { net, seg } = straightTrack()
    const signal = lay(net, seg.id, 0.5, true)
    const plain = draw(net, {})
    const picked = draw(net, { selectedId: signal.id })
    const danger = draw(net, { dangerId: signal.id })
    // Counted against the plain drawing: the nodes of the track use the same blue
    const blue = (ops: Op[]) => strokesOf(ops, ['#2563eb']).length
    const red = (ops: Op[]) => strokesOf(ops, ['#ef4444']).length
    // The ring and the arrow of the direction of travel
    expect(blue(picked) - blue(plain)).toBe(2)
    expect(red(picked) - red(plain)).toBe(0)
    expect(red(danger) - red(plain)).toBe(1)
    expect(blue(danger) - blue(plain)).toBe(0)
  })

  it('fades a signal standing in a tunnel', () => {
    const { net, seg } = straightTrack(1000, -1)
    lay(net, seg.id, 0.5, true)
    const ops = draw(net, {})
    const arc = ops.findIndex((op) => op.name === 'arc')
    expect(ops[arc].globalAlpha).toBeCloseTo(0.4)
  })

  it('hides the signals at far zoom and is not drawn with the rails of a level', () => {
    const { net, seg } = straightTrack()
    lay(net, seg.id, 0.5, true)
    const { ctx, ops } = createRecordingContext()
    renderNetwork(ctx, createCamera(500, 0, 0.01), VW, VH, net, noSelection(), {}, { tool: 'select', signals: { level: 'standard' } })
    expect(lamps(ops)).toHaveLength(0)
    expect(lamps(draw(net, {}, { part: 'tracks', level: 0 }))).toHaveLength(0)
    expect(lamps(draw(net, {}, { part: 'overlays' }))).toHaveLength(1)
  })
})

describe('one-way signals and diverging routes on the canvas', () => {
  const block: Signal = { id: 'a', segId: 's', t: 0, forward: true, role: 'spacing' }
  const path: Signal = { ...block, role: 'protection' }

  it('marks a one-way path signal, at both levels, and nothing else', () => {
    expect(signalGlyph({ ...path, oneWay: true }, 'stop', 'standard')).toEqual({ shape: 'path', lamps: ['red'], plate: null, oneWay: true })
    expect(signalGlyph({ ...path, oneWay: true }, 'stop', 'pro')).toEqual({ shape: 'carre', lamps: ['red', 'red'], plate: 'Nf', oneWay: true })
    // The option kept on a block signal means nothing there
    expect('oneWay' in signalGlyph({ ...block, oneWay: true }, 'clear', 'standard')).toBe(false)
    expect('oneWay' in signalGlyph(path, 'stop', 'standard')).toBe(false)
  })

  it('draws the mark as a short red bar across the track at the foot of the signal', () => {
    const { net, seg } = straightTrack()
    const plain = draw(net, {})
    const laid = addSignal(net, { segId: seg.id, t: 0.5 }, true, 'protection', { oneWay: true })
    expect(laid.ok).toBe(true)
    const ops = draw(net, {})
    const bars = ops.filter((op, i) => {
      if (op.name !== 'stroke' || op.strokeStyle !== '#ef4444' || op.lineWidth !== 2.5) return false
      // Across the track: its path starts and ends on the same x, astride the axis
      const line = ops.slice(0, i).reverse().find((prev) => prev.name === 'lineTo')!
      return Math.abs((line.args[0] as number) - op.start![0]) < 1e-6 && (op.start![1] - AXIS_Y) * ((line.args[1] as number) - AXIS_Y) < 0
    })
    expect(bars).toHaveLength(1)
    expect(bars[0].start![0]).toBeCloseTo(screenX(500))
    // Without the option, no such stroke
    const other = straightTrack()
    lay(other.net, other.seg.id, 0.5, true, 'protection')
    expect(draw(other.net, {}).filter((op) => op.name === 'stroke' && op.strokeStyle === '#ef4444')).toHaveLength(0)
    expect(plain.filter((op) => op.name === 'stroke' && op.strokeStyle === '#ef4444')).toHaveLength(0)
  })

  it('pro level: the announcement and the reminder are two yellow lamps, with the speed written once the zoom is close', () => {
    expect(signalGlyph(block, 'clear', 'pro', { slowdown: 30 })).toEqual({ shape: 'semaphore', lamps: ['yellow', 'yellow'], plate: 'F', speed: 30 })
    expect(signalGlyph(path, 'clear', 'pro', { reminder: 60 })).toEqual({ shape: 'carre', lamps: ['yellow', 'yellow'], plate: 'Nf', speed: 60 })
    expect(signalGlyph(path, 'caution', 'pro', { reminder: 30 })).toMatchObject({ lamps: ['yellow', 'yellow'], speed: 30 })
    // Closed, or at the standard level, or on a marker board: nothing of it
    expect(signalGlyph(path, 'stop', 'pro', { reminder: 30 })).toEqual({ shape: 'carre', lamps: ['red', 'red'], plate: 'Nf' })
    expect(signalGlyph(path, 'clear', 'standard', { reminder: 30 })).toEqual({ shape: 'path', lamps: ['green'], plate: null })
    expect(signalGlyph({ ...path, cabMarker: true }, 'clear', 'pro', { reminder: 30 })).toEqual({ shape: 'marker', lamps: [], plate: 'Nf' })

    const { net, seg } = straightTrack()
    const signal = lay(net, seg.id, 0.5, true, 'protection')
    const state = createSignallingState()
    state.signals.set(signal.id, { state: 'clear', cause: null, clearedFor: 't', reminder: 60 })
    const far = draw(net, { level: 'pro', state })
    expect(lamps(far).map((lamp) => lamp.color)).toEqual([SIGNAL_LAMP_COLORS.yellow, SIGNAL_LAMP_COLORS.yellow])
    expect(texts(far)).not.toContain('60')
    const { ctx, ops } = createRecordingContext()
    renderNetwork(ctx, createCamera(500, 0, 8), VW, VH, net, noSelection(), {}, { tool: 'select', signals: { level: 'pro', state } })
    expect(texts(ops)).toEqual(expect.arrayContaining(['Nf', '60']))
    // The standard level shows the same signal green, with no figure
    const standard = createRecordingContext()
    renderNetwork(standard.ctx, createCamera(500, 0, 8), VW, VH, net, noSelection(), {}, { tool: 'select', signals: { level: 'standard', state } })
    expect(lamps(standard.ops).map((lamp) => lamp.color)).toEqual([SIGNAL_LAMP_COLORS.green])
    expect(texts(standard.ops)).not.toContain('60')
  })
})

describe('blocks and reservations on the canvas', () => {
  it('strokes each block in its own colour, on the side of its direction of travel', () => {
    const { net, seg } = straightTrack()
    lay(net, seg.id, 0.2, true)
    lay(net, seg.id, 0.6, true)
    lay(net, seg.id, 0.8, false)
    expect(strokesOf(draw(net, {}), BLOCK_COLORS)).toHaveLength(0)

    const strokes = strokesOf(draw(net, { showBlocks: true }), BLOCK_COLORS)
    expect(strokes.map((op) => op.strokeStyle)).toEqual([BLOCK_COLORS[0], BLOCK_COLORS[1], BLOCK_COLORS[2]])
    expect(strokes.every((op) => Math.abs(op.globalAlpha - BLOCK_ALPHA) < 1e-9)).toBe(true)
    // The first block runs from its signal to the next one, above the axis (eastbound)
    expect(strokes[0].start![0]).toBeCloseTo(screenX(200))
    expect(strokes[0].start![1]).toBeLessThan(AXIS_Y)
    expect(strokes[1].start![0]).toBeCloseTo(screenX(600))
    // The westbound block shows on the other side of the rails
    expect(strokes[2].start![0]).toBeCloseTo(screenX(800))
    expect(strokes[2].start![1]).toBeGreaterThan(AXIS_Y)
  })

  it('draws the blocks under the signals', () => {
    const { net, seg } = straightTrack()
    lay(net, seg.id, 0.2, true)
    const ops = draw(net, { showBlocks: true })
    const block = ops.findIndex((op) => op.name === 'stroke' && op.strokeStyle === BLOCK_COLORS[0])
    const lamp = ops.findIndex((op) => op.name === 'fill' && op.fillStyle === SIGNAL_LAMP_COLORS.green)
    expect(block).toBeGreaterThan(-1)
    expect(lamp).toBeGreaterThan(block)
  })

  it('strokes the track held for each train while driving, one colour per train', () => {
    const { net, seg } = straightTrack()
    lay(net, seg.id, 0.2, true)
    const state = createSignallingState()
    state.railReservations.set(seg.id, [
      { segId: seg.id, t0: 0.3, t1: 0.5, trainId: 't1' },
      { segId: seg.id, t0: 0.9, t1: 0.7, trainId: 't2' },
    ])
    expect(strokesOf(draw(net, { state }), RESERVATION_COLORS)).toHaveLength(0)
    const strokes = strokesOf(draw(net, { state, showReservations: true }), RESERVATION_COLORS)
    expect(strokes.map((op) => op.strokeStyle)).toEqual([RESERVATION_COLORS[0], RESERVATION_COLORS[1]])
    expect(strokes[0].globalAlpha).toBeCloseTo(RESERVATION_ALPHA)
    expect(strokes[0].start![0]).toBeCloseTo(screenX(300))
    expect(strokes[0].start![1]).toBeLessThan(AXIS_Y)
    expect(strokes[1].start![0]).toBeCloseTo(screenX(900))
    expect(strokes[1].start![1]).toBeGreaterThan(AXIS_Y)
    // Nothing without the state of the simulation
    expect(strokesOf(draw(net, { showReservations: true }), RESERVATION_COLORS)).toHaveLength(0)
  })

  it('are drawn with the rails of their level, not with the overlays: a bridge above covers them', () => {
    // A track on the ground with a block, and a bridge over it carrying another
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 1000, y: 0 })
    const ground = addSegment(net, a.id, b.id)!
    const c = addNode(net, { x: 500, y: -200 })
    const d = addNode(net, { x: 500, y: 200 })
    const bridge = addSegment(net, c.id, d.id)!
    setNodesLevel(net, [c.id, d.id], 1)
    lay(net, ground.id, 0.2, true)
    lay(net, bridge.id, 0.2, true)
    const state = createSignallingState()
    state.railReservations.set(ground.id, [{ segId: ground.id, t0: 0.3, t1: 0.9, trainId: 't1' }])
    const options = { showBlocks: true, showReservations: true, state }

    // Nothing of them with the overlays; each level draws its own
    expect(strokesOf(draw(net, options, { part: 'overlays' }), [...BLOCK_COLORS, ...RESERVATION_COLORS])).toHaveLength(0)
    const level0 = draw(net, options, { part: 'tracks', level: 0 })
    expect(strokesOf(level0, BLOCK_COLORS).map((op) => op.strokeStyle)).toEqual([BLOCK_COLORS[0]])
    expect(strokesOf(level0, RESERVATION_COLORS)).toHaveLength(1)
    const level1 = draw(net, options, { part: 'tracks', level: 1 })
    expect(strokesOf(level1, BLOCK_COLORS).map((op) => op.strokeStyle)).toEqual([BLOCK_COLORS[1]])
    expect(strokesOf(level1, RESERVATION_COLORS)).toHaveLength(0)

    // In one pass, lowest level first: the stripes of the ground come before the deck of the bridge is filled
    const all = draw(net, options)
    const groundStripe = all.findIndex((op) => op.name === 'stroke' && op.strokeStyle === BLOCK_COLORS[0])
    const held = all.findIndex((op) => op.name === 'stroke' && op.strokeStyle === RESERVATION_COLORS[0])
    const bridgeStripe = all.findIndex((op) => op.name === 'stroke' && op.strokeStyle === BLOCK_COLORS[1])
    const firstOfLevel1 = all.length - draw(net, options, { part: 'overlays' }).length - level1.length
    expect(groundStripe).toBeGreaterThan(-1)
    expect(held).toBeGreaterThan(groundStripe)
    expect(groundStripe).toBeLessThan(firstOfLevel1)
    expect(held).toBeLessThan(firstOfLevel1)
    expect(bridgeStripe).toBeGreaterThanOrEqual(firstOfLevel1)
  })

  it('fades in a tunnel, like the rails', () => {
    const { net, seg } = straightTrack(1000, -1)
    lay(net, seg.id, 0.2, true)
    const state = createSignallingState()
    state.railReservations.set(seg.id, [{ segId: seg.id, t0: 0.3, t1: 0.5, trainId: 't1' }])
    const ops = draw(net, { showBlocks: true, showReservations: true, state })
    expect(strokesOf(ops, BLOCK_COLORS)[0].globalAlpha).toBeCloseTo(BLOCK_ALPHA * 0.4)
    expect(strokesOf(ops, RESERVATION_COLORS)[0].globalAlpha).toBeCloseTo(RESERVATION_ALPHA * 0.4)
  })

  it('a block on a ramp is cut where the level changes: each piece with its level', () => {
    // From the ground up to level 1: the rail is drawn with level 0 up to half a level, then with level 1
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 1000, y: 0 })
    const seg = addSegment(net, a.id, b.id)!
    setNodesLevel(net, [b.id], 1)
    lay(net, seg.id, 0.2, true)
    const low = strokesOf(draw(net, { showBlocks: true }, { part: 'tracks', level: 0 }), BLOCK_COLORS)
    const high = strokesOf(draw(net, { showBlocks: true }, { part: 'tracks', level: 1 }), BLOCK_COLORS)
    expect(low).toHaveLength(1)
    expect(high).toHaveLength(1)
    expect(low[0].start![0]).toBeCloseTo(screenX(200))
    expect(high[0].start![0]).toBeCloseTo(screenX(500))
  })

  it('works out the two blocks a new signal would make without touching the network', () => {
    const { net, seg } = straightTrack()
    const first = lay(net, seg.id, 0.2, true)
    const preview = previewSignalBlocks(net, { segId: seg.id, t: 0.6 }, true)
    expect(preview.ahead).toEqual([{ segId: seg.id, t0: 0.6, t1: 1 }])
    expect(preview.behind).toHaveLength(1)
    expect(preview.behind[0].signalId).toBe(first.id)
    expect(preview.behind[0].spans).toEqual([{ segId: seg.id, t0: 0.2, t1: 0.6 }])
    expect(net.signals.size).toBe(1)
    // For the other direction the signal before it is not concerned
    expect(previewSignalBlocks(net, { segId: seg.id, t: 0.6 }, false).behind).toHaveLength(0)
  })
})

describe('signalling report on the canvas', () => {
  it('marks each entry of the report with its message, in the construction view only', () => {
    const { net, seg } = straightTrack()
    lay(net, seg.id, 0.5, true)
    const report = signalReport(net, { level: 'standard', line: DEFAULT_LINE_SETTINGS })
    expect(report.length).toBeGreaterThan(0)

    const { ctx, ops } = createRecordingContext()
    renderNetwork(ctx, createCamera(500, 0, 1), VW, VH, net, noSelection(), {}, {
      tool: 'select',
      signals: { level: 'standard', report: true, line: DEFAULT_LINE_SETTINGS },
    })
    for (const entry of report) expect(texts(ops)).toContain(entry.message)
    expect(texts(ops).filter((text) => text === '!')).toHaveLength(report.length)

    const quiet = createRecordingContext()
    renderNetwork(quiet.ctx, createCamera(500, 0, 1), VW, VH, net, noSelection(), {}, {
      tool: 'select',
      signals: { level: 'standard', report: false, line: DEFAULT_LINE_SETTINGS },
    })
    expect(texts(quiet.ops)).not.toContain('!')
  })

  it('follows the level and the line settings', () => {
    const { net, seg } = straightTrack(4000)
    lay(net, seg.id, 0.05, true)
    const messages = (level: 'standard' | 'pro', lineSpeed: number): string[] => {
      const { ctx, ops } = createRecordingContext()
      renderNetwork(ctx, createCamera(200, 0, 1), VW, VH, net, noSelection(), {}, {
        tool: 'select',
        signals: { level, report: true, line: { ...DEFAULT_LINE_SETTINGS, lineSpeed } },
      })
      return texts(ops).filter((text) => text.startsWith('Canton'))
    }
    // 3 800 m of block: long enough to stop from 160 km/h, too long for a French block
    expect(messages('standard', 160)).toEqual([])
    expect(messages('pro', 160).some((text) => text.startsWith('Canton trop long'))).toBe(true)
    expect(messages('standard', 320).some((text) => text.startsWith('Canton trop court'))).toBe(true)
  })
})

describe('distant speed signs on the canvas', () => {
  const sign = (segId: string, patch: Partial<SpeedSign>): SpeedSign => ({
    zoneId: 'z', segId, t: 0.5, forward: true, speed: 60, fromSpeed: 160, distance: 500, diamond: false, ...patch,
  })

  /** The filled white shapes: one per sign */
  const boards = (ops: Op[]) => ops.filter((op) => op.name === 'fill' && op.fillStyle === '#ffffff')

  it('draws what the domain places, at the pro level only', () => {
    const { net, seg } = straightTrack()
    vi.mocked(speedSigns).mockReturnValue([sign(seg.id, { t: 0.25, speed: 60 }), sign(seg.id, { t: 0.75, forward: false, speed: 90 })])

    const standard = draw(net, { level: 'standard', line: DEFAULT_LINE_SETTINGS })
    expect(speedSigns).not.toHaveBeenCalled()
    // Counted against the plain drawing: the buffer stops are white too
    expect(boards(standard)).toHaveLength(boards(draw(net)).length)

    const pro = draw(net, { level: 'pro', line: DEFAULT_LINE_SETTINGS })
    expect(speedSigns).toHaveBeenCalledWith(net, DEFAULT_LINE_SETTINGS)
    expect(texts(pro)).toEqual(expect.arrayContaining(['60', '90']))
    expect(boards(pro)).toHaveLength(boards(standard).length + 2)
  })

  it('stands each sign on the left of the direction it addresses, black figures on white', () => {
    const { net, seg } = straightTrack()
    vi.mocked(speedSigns).mockReturnValue([sign(seg.id, { t: 0.25, speed: 60 }), sign(seg.id, { t: 0.75, forward: false, speed: 90 })])
    const ops = draw(net, { level: 'pro' })
    const figure = (text: string) => ops.find((op) => op.name === 'fillText' && op.args[0] === text)!
    expect(figure('60').args[1]).toBeCloseTo(screenX(250))
    expect(figure('60').args[2] as number).toBeLessThan(AXIS_Y)
    expect(figure('90').args[1]).toBeCloseTo(screenX(750))
    expect(figure('90').args[2] as number).toBeGreaterThan(AXIS_Y)
    expect(figure('60').fillStyle).toBe('#111827')
  })

  it('draws a square, or a diamond for a large drop', () => {
    const { net, seg } = straightTrack()
    const shapeOf = (diamond: boolean): string[] => {
      vi.mocked(speedSigns).mockReturnValue([sign(seg.id, { diamond })])
      const ops = draw(net, { level: 'pro' })
      // The board is the white shape filled right before the figures
      const figures = ops.findIndex((op) => op.name === 'fillText' && op.args[0] === '60')
      const fill = ops.slice(0, figures).map((op) => op.name === 'fill' && op.fillStyle === '#ffffff').lastIndexOf(true)
      const begin = ops.slice(0, fill).map((op) => op.name).lastIndexOf('beginPath')
      return ops.slice(begin + 1, fill).map((op) => op.name)
    }
    expect(shapeOf(false)).toEqual(['rect'])
    expect(shapeOf(true)).toEqual(['moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath'])
  })
})
