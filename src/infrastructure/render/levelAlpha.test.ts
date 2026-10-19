import { describe, expect, it } from 'vitest'
import { createCamera } from './camera'
import { addNode, addSegment, createNetwork } from '@domain/models/network'
import { createTrainSet, type TrainSet } from '@domain/models/train'
import { addSignal } from '@domain/models/signals'
import type { Network } from '@domain/models/types'
import { isUnderground, levelAlpha, levelDashed, OTHER_SIDE_ALPHA, type ViewDepth } from './levelAlpha'
import { renderNetwork, renderNetworkWithTrains, renderTrainSet, TUNNEL_DASH } from './renderer'

describe('the side of the ground the view looks at', () => {
  it('fades what is on the other side, and dashes a tunnel seen from the surface only', () => {
    expect(OTHER_SIDE_ALPHA).toBe(0.15)
    expect(isUnderground(-1)).toBe(true)
    expect(isUnderground(0)).toBe(false)
    expect(levelAlpha(-1)).toBe(OTHER_SIDE_ALPHA)
    expect(levelAlpha(0)).toBe(1)
    expect(levelAlpha(2)).toBe(1)
    expect(levelAlpha(-2, 'underground')).toBe(1)
    expect(levelAlpha(0, 'underground')).toBe(OTHER_SIDE_ALPHA)
    expect(levelAlpha(1, 'underground')).toBe(OTHER_SIDE_ALPHA)
    expect(levelDashed(-1, 'surface')).toBe(true)
    expect(levelDashed(-1, 'underground')).toBe(false)
    expect(levelDashed(0, 'surface')).toBe(false)
  })
})

// ─── On the canvas: a tunnel (level −1) under a ground track, as `trackLevels.test.ts` draws it ───

interface Op {
  name: string
  args: unknown[]
  strokeStyle?: unknown
  fillStyle?: unknown
  lineWidth?: number
  globalAlpha: number
  dash: number[]
  start?: [number, number]
}

/** Canvas context recording every call with the state it was made in (`save` / `restore` kept) */
function recordingContext(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = []
  let state: Record<string, unknown> = { globalAlpha: 1, dash: [] }
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
        if (key === 'setLineDash') state.dash = args[0]
        ops.push({ name: key, args, strokeStyle: state.strokeStyle, fillStyle: state.fillStyle, lineWidth: state.lineWidth as number | undefined, globalAlpha: state.globalAlpha as number, dash: state.dash as number[], start })
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
const SCALE = 4
const noSelection = () => ({ nodes: new Set<string>(), segments: new Set<string>() })
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps

/** A tunnel along x = 100 (y −50 → 50, level −1) under a ground track along y = 0 (x 0 → 200) */
function tunnelUnderGround(): { net: Network; tunnel: string } {
  const net = createNetwork()
  const t1 = addNode(net, { x: 100, y: -50 }, -1)
  const t2 = addNode(net, { x: 100, y: 50 }, -1)
  const tunnel = addSegment(net, t1.id, t2.id)!.id
  addSegment(net, addNode(net, { x: 0, y: 0 }).id, addNode(net, { x: 200, y: 0 }).id)
  return { net, tunnel }
}

const GROUND_START_X = VW / 2 - 100 * SCALE
const TUNNEL_START_Y = VH / 2 - 50 * SCALE
const isBuffer = (op: Op) => op.strokeStyle === '#dc2626' || op.strokeStyle === '#334155'
const isGroundRail = (op: Op) => op.name === 'stroke' && !!op.start && near(op.start[0], GROUND_START_X, 4) && !near(op.start[1], VH / 2) && !isBuffer(op)
const isTunnelRail = (op: Op) =>
  op.name === 'stroke' && !!op.start && near(op.start[1], TUNNEL_START_Y, 1) && near(op.start[0], VW / 2, 4) && !near(op.start[0], VW / 2) && (op.lineWidth ?? 0) < 3 && !isBuffer(op)
const isBodyFill = (op: Op) => op.name === 'fill' && op.fillStyle === 'rgba(14, 165, 233, 0.09)'

function draw(net: Network, depth?: ViewDepth, scale = SCALE): Op[] {
  const { ctx, ops } = recordingContext()
  renderNetwork(ctx, createCamera(100, 0, scale), VW, VH, net, noSelection(), {}, { tool: 'select', viewDepth: depth })
  return ops
}

function drawWithTrain(net: Network, train: TrainSet, depth: ViewDepth): Op[] {
  const { ctx, ops } = recordingContext()
  const cam = createCamera(100, 0, SCALE)
  renderNetworkWithTrains(ctx, cam, VW, VH, net, noSelection(), {}, { tool: 'select', viewDepth: depth }, (band) => {
    renderTrainSet(ctx, cam, VW, VH, net, train, false, false, false, undefined, null, null, band, undefined, false, depth)
  })
  return ops
}

describe('the canvas seen from the surface or from below ground', () => {
  it('from the surface: the tunnel faded to 15 % and dashed, the ground as it is', () => {
    const ops = draw(tunnelUnderGround().net)
    const tunnel = ops.filter(isTunnelRail)
    expect(tunnel.length).toBeGreaterThan(0)
    for (const op of tunnel) {
      expect(op.globalAlpha).toBeCloseTo(OTHER_SIDE_ALPHA)
      expect(op.dash).toEqual(TUNNEL_DASH)
    }
    for (const op of ops.filter(isGroundRail)) expect(op.globalAlpha).toBe(1)
  })

  it('from below ground: the tunnel as it is, without its dash, the ground faded to 15 %', () => {
    const ops = draw(tunnelUnderGround().net, 'underground')
    const tunnel = ops.filter(isTunnelRail)
    const ground = ops.filter(isGroundRail)
    expect(tunnel.length).toBeGreaterThan(0)
    expect(ground.length).toBeGreaterThan(0)
    for (const op of tunnel) {
      expect(op.globalAlpha).toBe(1)
      expect(op.dash).toEqual([])
    }
    for (const op of ground) expect(op.globalAlpha).toBeCloseTo(OTHER_SIDE_ALPHA)
  })

  it('in the line and schematic tiers alike', () => {
    for (const scale of [1, 0.02]) {
      const lines = draw(tunnelUnderGround().net, 'underground', scale).filter((op) => op.name === 'stroke' && op.start && !isBuffer(op))
      // The tunnel first (lowest), then the ground over it
      expect(lines.map((op) => op.globalAlpha)).toEqual([1, OTHER_SIDE_ALPHA])
    }
  })

  it('a vehicle and a signal follow the rule of their rail', () => {
    const { net, tunnel } = tunnelUnderGround()
    const train = createTrainSet(net, { x: 100, y: 40 }, 'wagon', 1)!
    expect(train.vehicles[0].front.segId).toBe(tunnel)
    const body = (depth: ViewDepth) => drawWithTrain(net, train, depth).filter(isBodyFill).map((op) => op.globalAlpha)
    expect(body('surface')).toEqual([OTHER_SIDE_ALPHA])
    expect(body('underground')).toEqual([1])

    expect(addSignal(net, { segId: tunnel, t: 0.2 }, true, 'spacing').ok).toBe(true)
    const signalAlphas = (depth: ViewDepth): number[] => {
      const { ctx, ops } = recordingContext()
      renderNetwork(ctx, createCamera(100, -30, SCALE), VW, VH, net, noSelection(), {}, { tool: 'select', viewDepth: depth, signals: { level: 'standard' } })
      return ops.filter((op) => op.name === 'arc').map((op) => op.globalAlpha)
    }
    expect(signalAlphas('surface').some((alpha) => near(alpha, OTHER_SIDE_ALPHA))).toBe(true)
    expect(signalAlphas('underground').some((alpha) => near(alpha, OTHER_SIDE_ALPHA))).toBe(false)
  })
})
