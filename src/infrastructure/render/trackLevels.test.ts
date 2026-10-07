import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCamera } from '@infrastructure/render/camera'
import { createNetwork, addNode, addSegment, addCurveSegment, setNodesLevel } from '@domain/models/network'
import { createTrainSet, type TrainSet } from '@domain/models/train'
import type { Network } from '@domain/models/types'
import { heightBand, segmentLevelPieces } from '@infrastructure/render/levelPieces'
import {
  renderNetwork,
  renderNetworkWithTrains,
  renderTrainSet,
  visibleTrackLevels,
  vehicleLevel,
  inLevelBand,
  DECK_WIDTH,
  DECK_PARAPET_WIDTH,
  TUNNEL_ALPHA,
  TUNNEL_DASH,
  TUNNEL_VEHICLE_ALPHA,
  diagnosticLabel,
  GAUGE,
  type LevelBand,
  type RenderNetworkOptions,
} from '@infrastructure/render/renderer'
import {
  SPEED_ZONE_ACTIVE_ALPHA,
  SPEED_ZONE_ALPHA,
  SPEED_ZONE_BAND_GAUGES,
  SPEED_ZONE_COLOR,
  overlapLabel,
} from '@infrastructure/render/speedZoneRender'
import { removeSpeedZone, setSpeedZoneSpeed } from '@domain/models/speedZones'
import * as speedLimits from '@domain/models/speedLimits'
import { addSpeedZoneBetween } from '@domain/services/speedZoneLayout'
import { snapToNearestTrack } from '@domain/models/locomotive'
import { networkChanged } from '@domain/models/networkWatch'

/** One canvas call, with the drawing state it was made in and where its path started */
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

/**
 * Canvas context that records every call in order, with the style state at that moment. `save` /
 * `restore` keep a real state stack, so `globalAlpha` and the dash read as on a real canvas.
 */
function createRecordingContext(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
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
        ops.push({
          name: key,
          args,
          strokeStyle: state.strokeStyle,
          fillStyle: state.fillStyle,
          lineWidth: state.lineWidth as number | undefined,
          globalAlpha: state.globalAlpha as number,
          dash: state.dash as number[],
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
const noSelection = () => ({ nodes: new Set<string>(), segments: new Set<string>() })
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps

/**
 * A ground track along y = 0 (x 0 → 200) and a track across it along x = 100 (y −50 → 50) with no
 * common node. The crossing track is added FIRST: only its level (the height of its two nodes) can
 * put it on top.
 */
function crossingTracks(upperLevel: number) {
  const net = createNetwork()
  const u1 = addNode(net, { x: 100, y: -50 }, upperLevel)
  const u2 = addNode(net, { x: 100, y: 50 }, upperLevel)
  const upper = addSegment(net, u1.id, u2.id)!
  const g1 = addNode(net, { x: 0, y: 0 })
  const g2 = addNode(net, { x: 200, y: 0 })
  const ground = addSegment(net, g1.id, g2.id)!
  return { net, upper, ground }
}

/** A wagon on the rail nearest to `at` */
function wagonOn(net: Network, at: { x: number; y: number }): TrainSet {
  const train = createTrainSet(net, at, 'wagon', 1)
  if (!train) throw new Error('no rail under the wagon')
  return train
}

// Camera centred on the crossing: world (100, 0) is at the middle of the screen
const SCALE = 4
const cam = () => createCamera(100, 0, SCALE)
const GROUND_START_X = VW / 2 - 100 * SCALE // screen x of world x = 0
const UPPER_START_Y = VH / 2 - 50 * SCALE // screen y of world y = −50
/** Strokes of the ground track: they all start at its left end (world x = 0) */
/** Buffer stop closing an end of track: its red beam and its struts, drawn with the overlays */
const isBufferStopStroke = (op: Op) => op.name === 'stroke' && (op.strokeStyle === '#dc2626' || op.strokeStyle === '#334155')
const isBufferBeam = (op: Op) => op.name === 'stroke' && !!op.start && op.strokeStyle === '#dc2626'
const isGroundStroke = (op: Op) =>
  op.name === 'stroke' && !!op.start && near(op.start[0], GROUND_START_X, 4) && !isBufferStopStroke(op)
/** Rails of the ground track: its strokes off the centreline */
const isGroundRailStroke = (op: Op) => isGroundStroke(op) && !near(op.start![1], VH / 2)
/** Rails of the crossing track: thin strokes starting at its top end, either side of the centreline */
const isUpperRailStroke = (op: Op) =>
  op.name === 'stroke' && !!op.start && near(op.start[1], UPPER_START_Y, 1) && !isBufferStopStroke(op) &&
  near(op.start[0], VW / 2, 4) && !near(op.start[0], VW / 2) && (op.lineWidth ?? 0) < 3
const isDeckStroke = (op: Op) => op.name === 'stroke' && near(op.lineWidth ?? 0, DECK_WIDTH * SCALE)
/** Body of a TrainSet vehicle (the translucent outline fill of `drawTrainSetBody`) */
const isBodyFill = (op: Op) => op.name === 'fill' && op.fillStyle === 'rgba(14, 165, 233, 0.09)'

const indices = (ops: Op[], pred: (op: Op) => boolean) => ops.flatMap((op, i) => (pred(op) ? [i] : []))

function drawPlain(net: Network, camera = cam()): Op[] {
  const { ctx, ops } = createRecordingContext()
  renderNetwork(ctx, camera, VW, VH, net, noSelection(), {}, { tool: 'select' })
  return ops
}

function drawLayered(net: Network, trains: TrainSet[], camera = cam()) {
  const { ctx, ops } = createRecordingContext()
  const bands: (LevelBand | undefined)[] = []
  renderNetworkWithTrains(ctx, camera, VW, VH, net, noSelection(), {}, { tool: 'select' }, (band) => {
    bands.push(band)
    for (const t of trains) renderTrainSet(ctx, camera, VW, VH, net, t, false, false, false, undefined, null, null, band)
  })
  return { ops, bands }
}

describe('track levels — rails', () => {
  it('draws the rails of level 1 after those of level 0, whatever their order in the network', () => {
    const ops = drawPlain(crossingTracks(1).net)

    const ground = indices(ops, isGroundStroke)
    const upperRails = indices(ops, isUpperRailStroke)
    expect(ground.length).toBeGreaterThan(0)
    expect(upperRails.length).toBeGreaterThan(0)
    expect(Math.min(...upperRails)).toBeGreaterThan(Math.max(...ground))
  })

  it('on the same level the network order is kept: no deck, no reordering', () => {
    const ops = drawPlain(crossingTracks(0).net)

    expect(indices(ops, isDeckStroke)).toEqual([])
    // The crossing track was added first: its rails are drawn before those of the other track
    expect(Math.min(...indices(ops, isUpperRailStroke))).toBeLessThan(Math.min(...indices(ops, isGroundRailStroke)))
  })

  it('level > 0: an opaque deck wider than the ballast, with parapets, between the lower rails and its own', () => {
    const ops = drawPlain(crossingTracks(1).net)

    const parapet = indices(ops, isDeckStroke)
    expect(parapet).toHaveLength(1)
    const slabWidth = (DECK_WIDTH - 2 * DECK_PARAPET_WIDTH) * SCALE
    const slab = indices(ops, (op) => op.name === 'stroke' && near(op.lineWidth ?? 0, slabWidth))
    // Opaque fill in the background colour, then a light tint
    expect(slab).toHaveLength(2)
    expect(ops[slab[0]].strokeStyle).toBe('#ffffff')
    expect(ops[slab[0]].globalAlpha).toBe(1)
    expect(slab[0]).toBeGreaterThan(parapet[0])

    expect(parapet[0]).toBeGreaterThan(Math.max(...indices(ops, isGroundStroke)))
    expect(slab[1]).toBeLessThan(Math.min(...indices(ops, isUpperRailStroke)))
  })

  it('level < 0: the rails are dimmed and dashed, and stay under the ground rails', () => {
    const ops = drawPlain(crossingTracks(-1).net)

    const tunnelRails = indices(ops, isUpperRailStroke)
    expect(tunnelRails.length).toBeGreaterThan(0)
    for (const i of tunnelRails) {
      expect(ops[i].globalAlpha).toBeCloseTo(TUNNEL_ALPHA)
      expect(ops[i].dash).toEqual(TUNNEL_DASH)
    }
    const groundRails = indices(ops, isGroundRailStroke)
    expect(Math.max(...tunnelRails)).toBeLessThan(Math.min(...groundRails))
    for (const i of groundRails) {
      expect(ops[i].globalAlpha).toBe(1)
      expect(ops[i].dash).toEqual([])
    }
    expect(indices(ops, isDeckStroke)).toEqual([])
  })

  it('line tier: one stroke per rail, the upper one over an edging in the background colour, no deck', () => {
    // 1 px/m: 1.4 px between the rails
    const mid = createCamera(100, 0, 1)
    const lines = (ops: Op[]) => ops.filter((op) => op.name === 'stroke' && op.start && !isBufferStopStroke(op))
    const width = 1.435 + 1.2
    const strokes = lines(drawPlain(crossingTracks(1).net, mid))
    // Ground line, then edging + line of the upper rail
    expect(strokes.map((op) => op.lineWidth)).toEqual([width, width + 4, width])
    expect(strokes.map((op) => op.strokeStyle)).toEqual(['#526071', '#ffffff', '#526071'])
    expect(strokes[0].start![0]).toBeCloseTo(VW / 2 - 100)
    expect(strokes[2].start![1]).toBeCloseTo(VH / 2 - 50)

    // Same tracks on one level: both rails in a single stroke
    const flat = lines(drawPlain(crossingTracks(0).net, mid))
    expect(flat.map((op) => op.lineWidth)).toEqual([width])

    // In a tunnel: dimmed and dashed, drawn before the ground
    const tunnel = lines(drawPlain(crossingTracks(-1).net, mid))
    expect(tunnel.map((op) => op.globalAlpha)).toEqual([TUNNEL_ALPHA, 1])
    expect(tunnel.map((op) => op.dash)).toEqual([TUNNEL_DASH, []])
  })

  it('schematic tier: one line per section, all in the colour of the rails, the levels are not layered', () => {
    const far = createCamera(100, 0, 0.02)
    const lines = (ops: Op[]) => ops.filter((op) => op.name === 'stroke' && op.start && !isBufferStopStroke(op))
    const strokes = lines(drawPlain(crossingTracks(1).net, far))
    // The two tracks in one stroke
    expect(strokes.map((op) => op.lineWidth)).toEqual([2])
    expect(strokes.map((op) => op.strokeStyle)).not.toContain('#ffffff')
    expect(strokes[0].start![1]).toBeCloseTo(VH / 2 - 50 * 0.02)

    // A track wholly below ground is dimmed, in a stroke of its own
    const tunnel = lines(drawPlain(crossingTracks(-1).net, far))
    expect(tunnel.map((op) => op.globalAlpha)).toEqual([TUNNEL_ALPHA, 1])
  })

  it('ramp: the abutment is where the deck starts on the ramp, not at the node where the span begins', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 }, 1)
    const c = addNode(net, { x: 200, y: 0 }, 1)
    // a → b climbs from the ground, b → c is the bridge
    addSegment(net, a.id, b.id)
    addSegment(net, b.id, c.id)

    const abutmentWidth = Math.max(1.5, DECK_PARAPET_WIDTH * SCALE * 1.5)
    const abutments = () =>
      drawPlain(net).filter((op) => op.name === 'stroke' && near(op.lineWidth ?? 0, abutmentWidth) && op.strokeStyle === '#526071')

    const drawn = abutments()
    // One abutment, half-way up the ramp (world x = 50): none at b where the deck goes on, none at
    // the free end c, none at the foot a
    expect(drawn).toHaveLength(1)
    const midRamp = VW / 2 - 50 * SCALE
    expect(drawn[0].start![0]).toBeLessThan(midRamp) // the wings splay away from the deck
    expect(drawn[0].start![0]).toBeGreaterThan(midRamp - DECK_WIDTH * SCALE)
    expect(Math.abs(drawn[0].start![1] - VH / 2)).toBeGreaterThan((DECK_WIDTH / 2) * SCALE)

    // Two decks: the upper half of the ramp and the span. None starts at the foot of the ramp
    const decks = drawPlain(net).filter(isDeckStroke)
    expect(decks.map((op) => op.start![0]).sort((x, y) => x - y)).toEqual([midRamp, VW / 2])

    // The whole line on the bridge: no ramp, no abutment
    setNodesLevel(net, [a.id], 1)
    expect(abutments()).toHaveLength(0)

    // A ramp that goes on up from the span is not a bridge end either
    setNodesLevel(net, [a.id], 2)
    expect(abutments()).toHaveLength(0)
  })

  it('a curved rail gets a curved deck', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 }, 2)
    const b = addNode(net, { x: 200, y: 60 }, 2)
    addCurveSegment(net, a.id, b.id, { x: 100, y: 0 })
    const ops = drawPlain(net)

    const deck = indices(ops, isDeckStroke)[0]
    expect(ops[deck - 1].name).toBe('quadraticCurveTo')
  })

  it('part and level options: rails of one level only, or the overlays alone', () => {
    const { net } = crossingTracks(1)
    const tracks = createRecordingContext()
    renderNetwork(tracks.ctx, cam(), VW, VH, net, noSelection(), {}, { tool: 'select', part: 'tracks', level: 0 })
    expect(indices(tracks.ops, isGroundStroke).length).toBeGreaterThan(0)
    expect(indices(tracks.ops, isUpperRailStroke)).toEqual([])
    expect(indices(tracks.ops, isDeckStroke)).toEqual([])
    // No node, sign or badge in the rails pass
    expect(tracks.ops.some((op) => op.name === 'arc' || op.name === 'fillText')).toBe(false)

    const overlays = createRecordingContext()
    renderNetwork(overlays.ctx, cam(), VW, VH, net, noSelection(), {}, { tool: 'select', part: 'overlays' })
    expect(overlays.ops.some((op) => op.name === 'arc')).toBe(true)
    expect(indices(overlays.ops, isGroundStroke)).toEqual([])
    expect(indices(overlays.ops, isDeckStroke)).toEqual([])
  })
})

describe('track levels — trains', () => {
  it('visibleTrackLevels: [0] without bridge, the levels in view otherwise, lowest first', () => {
    expect(visibleTrackLevels(crossingTracks(0).net, cam(), VW, VH)).toEqual([0])
    expect(visibleTrackLevels(crossingTracks(2).net, cam(), VW, VH)).toEqual([0, 2])
    expect(visibleTrackLevels(crossingTracks(-1).net, cam(), VW, VH)).toEqual([-1, 0])

    // The bridge exists but is out of view: a single level again
    const { net } = crossingTracks(1)
    const away = addNode(net, { x: 4990, y: 5000 })
    const away2 = addNode(net, { x: 5010, y: 5000 })
    addSegment(net, away.id, away2.id)
    expect(visibleTrackLevels(net, createCamera(5000, 5000, SCALE), VW, VH)).toEqual([0])
  })

  it('a vehicle is on the level of the rail under its bogies: the real height there, not the top of the ramp', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const c = addNode(net, { x: 200, y: 0 }, 1)
    const low = addSegment(net, a.id, b.id)!
    // b → c is a 0 → 1 ramp: on the ground up to half its length, on the upper level beyond
    const ramp = addSegment(net, b.id, c.id)!
    const pos = (segId: string, t = 0.5) => ({ segId, t })
    expect(vehicleLevel(net, { front: pos(low.id), rear: pos(low.id) })).toBe(0)
    expect(vehicleLevel(net, { front: pos(ramp.id, 0.2), rear: pos(low.id) })).toBe(0)
    expect(vehicleLevel(net, { front: pos(ramp.id, 0.5), rear: pos(ramp.id, 0.3) })).toBe(0)
    // Straddling the half level: the higher bogie decides
    expect(vehicleLevel(net, { front: pos(ramp.id, 0.6), rear: pos(ramp.id, 0.4) })).toBe(1)
    expect(vehicleLevel(net, { front: pos(ramp.id, 0.4), rear: pos(ramp.id, 0.6) })).toBe(1)
    expect(vehicleLevel(net, { front: pos('gone'), rear: pos('gone') })).toBe(0)

    expect(inLevelBand(3)).toBe(true)
    expect(inLevelBand(0, { above: -Infinity, upTo: 0 })).toBe(true)
    expect(inLevelBand(1, { above: -Infinity, upTo: 0 })).toBe(false)
    expect(inLevelBand(1, { above: 0, upTo: Infinity })).toBe(true)
  })

  it('a vehicle on level 0 is drawn before the deck of level 1 that passes over it', () => {
    const { net, ground } = crossingTracks(1)
    // Just short of the crossing point, where the pointer could as well pick the bridge
    const train = wagonOn(net, { x: 85, y: 0 })
    expect(train.vehicles[0].front.segId).toBe(ground.id)
    const { ops, bands } = drawLayered(net, [train])

    expect(bands).toEqual([{ above: -Infinity, upTo: 0 }, { above: 0, upTo: Infinity }])
    const body = indices(ops, isBodyFill)
    expect(body).toHaveLength(1) // drawn once, in the pass of its level
    expect(body[0]).toBeGreaterThan(Math.max(...indices(ops, isGroundStroke)))
    expect(body[0]).toBeLessThan(indices(ops, isDeckStroke)[0])
    expect(body[0]).toBeLessThan(Math.min(...indices(ops, isUpperRailStroke)))
  })

  it('a vehicle on the bridge is drawn after its deck and rails', () => {
    const { net, upper } = crossingTracks(1)
    const train = wagonOn(net, { x: 100, y: 40 })
    expect(train.vehicles[0].front.segId).toBe(upper.id)
    const { ops } = drawLayered(net, [train])

    const body = indices(ops, isBodyFill)
    expect(body).toHaveLength(1)
    expect(body[0]).toBeGreaterThan(Math.max(...indices(ops, isUpperRailStroke)))
    expect(ops[body[0]].globalAlpha).toBe(1)
  })

  it('the overlays of the network are drawn once, after every level and every train', () => {
    const { net } = crossingTracks(1)
    const { ops } = drawLayered(net, [wagonOn(net, { x: 85, y: 0 })])

    // Buffer stops: one per open end, as in a plain rendering of the network
    const signs = (list: Op[]) => indices(list, isBufferBeam)
    expect(signs(ops)).toHaveLength(4)
    expect(signs(drawPlain(net))).toHaveLength(4)
    expect(Math.min(...signs(ops))).toBeGreaterThan(indices(ops, isBodyFill)[0])
    expect(Math.min(...signs(ops))).toBeGreaterThan(Math.max(...indices(ops, isUpperRailStroke)))
  })

  it('driving route callback: right after the network on a single level, last when levels are interleaved', () => {
    const run = (net: Network): string[] => {
      const order: string[] = []
      const { ctx } = createRecordingContext()
      renderNetworkWithTrains(
        ctx, cam(), VW, VH, net, noSelection(), {}, { tool: 'select' },
        (band) => { order.push(band ? `trains ${band.above}..${band.upTo}` : 'trains') },
        () => { order.push('route') },
      )
      return order
    }
    expect(run(crossingTracks(0).net)).toEqual(['route', 'trains'])
    expect(run(crossingTracks(1).net)).toEqual(['trains -Infinity..0', 'trains 0..Infinity', 'route'])
  })

  it('a vehicle in a tunnel is dimmed, and drawn before the ground rails that pass over it', () => {
    const { net, upper } = crossingTracks(-1)
    const train = wagonOn(net, { x: 100, y: 40 })
    expect(train.vehicles[0].front.segId).toBe(upper.id)
    const { ops } = drawLayered(net, [train])

    const body = indices(ops, isBodyFill)
    expect(body).toHaveLength(1)
    expect(ops[body[0]].globalAlpha).toBeCloseTo(TUNNEL_VEHICLE_ALPHA)
    expect(body[0]).toBeLessThan(Math.min(...indices(ops, isGroundRailStroke)))
  })

  it('single level: one plain network call then the trains without band — the calls of a flat layout', () => {
    const { net } = crossingTracks(0)
    const train = wagonOn(net, { x: 50, y: 0 })
    const layered = drawLayered(net, [train])
    expect(layered.bands).toEqual([undefined])

    const plain = createRecordingContext()
    renderNetwork(plain.ctx, cam(), VW, VH, net, noSelection(), {}, { tool: 'select' })
    renderTrainSet(plain.ctx, cam(), VW, VH, net, train, false, false, false, undefined, null, null)
    expect(layered.ops).toEqual(plain.ops)
    // Nothing of the level drawing in it
    expect(indices(layered.ops, isDeckStroke)).toEqual([])
    expect(layered.ops.every((op) => op.dash.length === 0 || op.dash.join() !== TUNNEL_DASH.join())).toBe(true)

    // An explicit `level: 0` on the nodes changes nothing either
    for (const node of net.nodes.values()) node.level = 0
    networkChanged()
    expect(drawLayered(net, [train]).ops).toEqual(plain.ops)
  })
})

describe('track levels — ramps', () => {
  // Camera of the other tests: world x = 0 is at screen x = 0, world x = 200 at screen x = 800
  const FOOT_X = 0
  const MID_X = VW / 2
  const TOP_X = VW

  /** A 200 m ramp along y = 0, from the ground (x = 0) to `topLevel` (x = 200) */
  function rampTo(topLevel: number) {
    const net = createNetwork()
    const foot = addNode(net, { x: 0, y: 0 })
    const top = addNode(net, { x: 200, y: 0 }, topLevel)
    const ramp = addSegment(net, foot.id, top.id)!
    return { net, foot, top, ramp }
  }

  /** Rail strokes (thin, either side of the centreline) of the ramp that start at screen x `x` */
  const isRailStrokeFrom = (x: number) => (op: Op) =>
    op.name === 'stroke' && !!op.start && near(op.start[0], x, 0.5) &&
    !near(op.start[1], VH / 2) && Math.abs(op.start[1] - VH / 2) < 10 && (op.lineWidth ?? 0) < 3

  it('heightBand: the nearest level, a half level going to the ground', () => {
    expect([0, 0.3, 0.5, 0.6, 1, 1.5, 1.6, 2].map(heightBand)).toEqual([0, 0, 0, 1, 1, 1, 2, 2])
    expect([-0.3, -0.5, -0.6, -1, -1.5, -1.6].map(heightBand)).toEqual([0, 0, -1, -1, -1, -2])
  })

  it('segmentLevelPieces: a ramp is cut where it crosses a half level, a flat rail is one piece', () => {
    expect(segmentLevelPieces(rampTo(0).net, rampTo(0).ramp)).toEqual([{ t0: 0, t1: 1, band: 0 }])
    const up = rampTo(1)
    expect(segmentLevelPieces(up.net, up.ramp)).toEqual([{ t0: 0, t1: 0.5, band: 0 }, { t0: 0.5, t1: 1, band: 1 }])
    const down = rampTo(-1)
    expect(segmentLevelPieces(down.net, down.ramp)).toEqual([{ t0: 0, t1: 0.5, band: 0 }, { t0: 0.5, t1: 1, band: -1 }])
    const two = rampTo(2)
    expect(segmentLevelPieces(two.net, two.ramp)).toEqual([
      { t0: 0, t1: 0.25, band: 0 }, { t0: 0.25, t1: 0.75, band: 1 }, { t0: 0.75, t1: 1, band: 2 },
    ])
    // A ramp cut in its middle: the lower half stays on the ground, the upper half is all deck
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const m = addNode(net, { x: 100, y: 0 }, 0.5)
    const b = addNode(net, { x: 200, y: 0 }, 1)
    expect(segmentLevelPieces(net, addSegment(net, a.id, m.id)!)).toEqual([{ t0: 0, t1: 1, band: 0 }])
    expect(segmentLevelPieces(net, addSegment(net, m.id, b.id)!)).toEqual([{ t0: 0, t1: 1, band: 1 }])
    // Going down from `from`: the pieces still run from t = 0
    setNodesLevel(net, [a.id], 1)
    setNodesLevel(net, [m.id], 0)
    expect(segmentLevelPieces(net, net.segments.values().next().value!)).toEqual([
      { t0: 0, t1: 0.5, band: 1 }, { t0: 0.5, t1: 1, band: 0 },
    ])
  })

  it('ramp 0 → 1: plain rails on the lower half, the deck under the upper half only', () => {
    const ops = drawPlain(rampTo(1).net)

    // One deck, from the middle of the ramp to its top
    const deck = indices(ops, isDeckStroke)
    expect(deck).toHaveLength(1)
    expect(ops[deck[0]].start![0]).toBeCloseTo(MID_X)
    expect(ops[deck[0] - 1].name).toBe('lineTo')
    expect(ops[deck[0] - 1].args[0]).toBeCloseTo(TOP_X)

    const lower = indices(ops, isRailStrokeFrom(FOOT_X))
    const upper = indices(ops, isRailStrokeFrom(MID_X))
    expect(lower.length).toBeGreaterThan(0)
    expect(upper).toHaveLength(lower.length)
    // Lower half: drawn with the ground, before the deck; upper half: on the deck
    expect(Math.max(...lower)).toBeLessThan(deck[0])
    expect(Math.min(...upper)).toBeGreaterThan(deck[0])
    // Rails only, the same on both halves: nothing dimmed, nothing dashed
    for (const i of [...lower, ...upper]) {
      expect(ops[i].globalAlpha).toBe(1)
      expect(ops[i].dash).toEqual([])
    }
    // The lower rails stop where the upper ones start: no stroke of the ramp runs over the cut
    for (const i of lower) expect(ops[i - 1].args[0] as number).toBeCloseTo(MID_X)
    // One abutment, where the deck starts
    const abutmentWidth = Math.max(1.5, DECK_PARAPET_WIDTH * SCALE * 1.5)
    const abutments = ops.filter((op) => op.name === 'stroke' && near(op.lineWidth ?? 0, abutmentWidth) && op.strokeStyle === '#526071')
    expect(abutments).toHaveLength(1)
    expect(abutments[0].start![0]).toBeLessThan(MID_X)
    expect(abutments[0].start![0]).toBeGreaterThan(MID_X - DECK_WIDTH * SCALE)
  })

  it('ramp 0 → −1: dimmed and dashed on the lower half only, and no deck', () => {
    const ops = drawPlain(rampTo(-1).net)

    const upper = indices(ops, isRailStrokeFrom(FOOT_X)) // near the ground
    const lower = indices(ops, isRailStrokeFrom(MID_X)) // below half a level
    expect(upper.length).toBeGreaterThan(0)
    expect(lower).toHaveLength(upper.length)
    for (const i of upper) {
      expect(ops[i].globalAlpha).toBe(1)
      expect(ops[i].dash).toEqual([])
    }
    for (const i of lower) {
      expect(ops[i].globalAlpha).toBeCloseTo(TUNNEL_ALPHA)
      expect(ops[i].dash).toEqual(TUNNEL_DASH)
    }
    // The tunnel part is drawn first, under whatever is on the ground
    expect(Math.max(...lower)).toBeLessThan(Math.min(...upper))
    expect(indices(ops, isDeckStroke)).toEqual([])
  })

  it('a ramp that stays within half a level of the ground is drawn as a ground rail', () => {
    const flat = drawPlain(rampTo(0).net)
    const gentle = drawPlain(rampTo(0.5).net)
    expect(gentle).toEqual(flat)
  })

  it('a vehicle at the foot of a ramp is drawn with the ground: under a bridge next to it, not dimmed', () => {
    const { net, ramp } = rampTo(1)
    // A bridge on level 1 across the foot of the ramp, with no common node
    const u1 = addNode(net, { x: 30, y: -50 }, 1)
    const u2 = addNode(net, { x: 30, y: 50 }, 1)
    addSegment(net, u1.id, u2.id)
    const train = wagonOn(net, { x: 60, y: 0 })
    expect(train.vehicles[0].front.segId).toBe(ramp.id)
    expect(Math.max(train.vehicles[0].front.t, train.vehicles[0].rear.t)).toBeLessThan(0.5)
    const { ops } = drawLayered(net, [train])

    const body = indices(ops, isBodyFill)
    expect(body).toHaveLength(1)
    expect(ops[body[0]].globalAlpha).toBe(1)
    // After the rails it stands on, before every deck: the bridge's and the ramp's own
    expect(body[0]).toBeGreaterThan(Math.max(...indices(ops, isRailStrokeFrom(FOOT_X))))
    const decks = indices(ops, isDeckStroke)
    expect(decks).toHaveLength(2)
    expect(body[0]).toBeLessThan(Math.min(...decks))

    // Higher up the same ramp it is on the upper level: drawn after the decks
    const high = wagonOn(net, { x: 160, y: 0 })
    const highOps = drawLayered(net, [high]).ops
    expect(indices(highOps, isBodyFill)[0]).toBeGreaterThan(Math.max(...indices(highOps, isDeckStroke)))
  })

  it('a vehicle at the top of a ramp into a tunnel is not dimmed; further down it is', () => {
    const { net } = rampTo(-1)
    const atTop = drawLayered(net, [wagonOn(net, { x: 60, y: 0 })]).ops
    expect(atTop[indices(atTop, isBodyFill)[0]].globalAlpha).toBe(1)

    const below = drawLayered(net, [wagonOn(net, { x: 160, y: 0 })]).ops
    expect(below[indices(below, isBodyFill)[0]].globalAlpha).toBeCloseTo(TUNNEL_VEHICLE_ALPHA)
  })

  it('too steep a ramp: the existing diagnostic marker, with the slope as its text', () => {
    // 1 level of 6 m over 100 m: 60 ‰
    const net = createNetwork()
    const foot = addNode(net, { x: 50, y: 0 })
    const top = addNode(net, { x: 150, y: 0 }, 1)
    addSegment(net, foot.id, top.id)
    const draw = (gradient?: { levelHeight: number; maxGradient: number }): Op[] => {
      const { ctx, ops } = createRecordingContext()
      renderNetwork(ctx, cam(), VW, VH, net, noSelection(), {}, { tool: 'select', gradient })
      return ops
    }
    const texts = (ops: Op[]) => ops.filter((op) => op.name === 'fillText').map((op) => op.args[0])

    const steep = draw({ levelHeight: 6, maxGradient: 35 })
    expect(texts(steep)).toContain('Pente 60 ‰')
    // The marker is the warning one of the other diagnostics, at the foot of the ramp
    const label = steep.find((op) => op.name === 'fillText' && op.args[0] === 'Pente 60 ‰')!
    expect(label.args[1]).toBeCloseTo(VW / 2 - 50 * SCALE)
    expect(steep.some((op) => op.name === 'fill' && op.fillStyle === '#f59e0b')).toBe(true)

    // Within the limit, or without limits: nothing more than the plain network
    expect(texts(draw({ levelHeight: 6, maxGradient: 80 })).some((t) => String(t).startsWith('Pente'))).toBe(false)
    expect(draw({ levelHeight: 6, maxGradient: 80 })).toEqual(draw())

    expect(diagnosticLabel({ id: 'x', nodeId: 'n', kind: 'track_gap', severity: 'warning', message: '', involvedSegmentIds: [] })).toBe('Voie interrompue')
    expect(diagnosticLabel({ id: 'x', nodeId: 'n', kind: 'sharp_turn', severity: 'error', angleDeg: 12, message: '', involvedSegmentIds: [] })).toBe('∠ 12° Cassure')
  })
})

describe('speed zones on the canvas', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Place of the track nearest to a world point */
  const at = (net: Network, x: number, y = 0) => {
    const hit = snapToNearestTrack(net, { x, y }, 0.5)!
    return { segId: hit.segId, t: hit.t }
  }
  /** A 90 km/h zone from x = 60 to x = 140 on the ground track (world x 0 → 200, y = 0) */
  function tracksWithZone(upperLevel = 1) {
    const tracks = crossingTracks(upperLevel)
    const zone = addSpeedZoneBetween(tracks.net, at(tracks.net, 60), at(tracks.net, 140), 90)!
    return { ...tracks, zone }
  }
  const draw = (net: Network, options: RenderNetworkOptions = {}, camera = cam()): Op[] => {
    const { ctx, ops } = createRecordingContext()
    renderNetwork(ctx, camera, VW, VH, net, noSelection(), {}, { tool: 'select', ...options })
    return ops
  }
  const BAND_WIDTH = SPEED_ZONE_BAND_GAUGES * GAUGE * SCALE
  const isBandStroke = (op: Op) => op.name === 'stroke' && near(op.lineWidth ?? 0, BAND_WIDTH)
  const texts = (ops: Op[]) => ops.filter((op) => op.name === 'fillText').map((op) => String(op.args[0]))
  const isBoardText = (op: Op) => op.name === 'fillText' && /^[ZR] \d+$/.test(String(op.args[0]))
  /** Path calls (moveTo, lineTo, quadraticCurveTo) of the path a stroke closes */
  const pathOf = (ops: Op[], strokeIndex: number): Op[] => {
    let begin = strokeIndex
    while (begin > 0 && ops[begin].name !== 'beginPath') begin--
    return ops.slice(begin + 1, strokeIndex)
  }
  const screenX = (x: number) => VW / 2 + (x - 100) * SCALE

  it('draws nothing more for a network without zone: the same calls as before', () => {
    const { net } = crossingTracks(0)
    const plain = draw(net)
    expect(plain.some(isBandStroke)).toBe(false)
    expect(plain.some(isBoardText)).toBe(false)
    // Asking for a highlight changes nothing when there is no zone
    expect(draw(net, { speedZones: { selectedId: 'z_1', dangerId: 'z_2' } })).toEqual(plain)

    // A zone adds calls; once it is removed the drawing is back to exactly what it was
    const zone = addSpeedZoneBetween(net, at(net, 60), at(net, 140), 90)!
    expect(draw(net).length).toBeGreaterThan(plain.length)
    removeSpeedZone(net, zone.id)
    expect(draw(net)).toEqual(plain)
  })

  it('lays a band along the limited stretch only, under the rails', () => {
    const { net } = tracksWithZone(0)
    const ops = draw(net)
    const bands = indices(ops, isBandStroke)
    expect(bands).toHaveLength(1)
    const band = ops[bands[0]]
    expect(band.strokeStyle).toBe(SPEED_ZONE_COLOR)
    expect(band.globalAlpha).toBeCloseTo(SPEED_ZONE_ALPHA)

    // One stretch, from world x = 60 to world x = 140 on the axis of the track
    const path = pathOf(ops, bands[0])
    expect(path.map((op) => op.name)).toEqual(['moveTo', 'lineTo'])
    expect(path[0].args[0]).toBeCloseTo(screenX(60))
    expect(path[0].args[1]).toBeCloseTo(VH / 2)
    expect(path[1].args[0]).toBeCloseTo(screenX(140))
    expect(path[1].args[1]).toBeCloseTo(VH / 2)

    // Before the rails of the track it lies on: they are drawn over it
    expect(bands[0]).toBeLessThan(Math.min(...indices(ops, isGroundRailStroke)))
  })

  it('follows a curved rail as a curve', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 60, y: 0 })
    const b = addNode(net, { x: 140, y: 30 })
    const seg = addCurveSegment(net, a.id, b.id, { x: 100, y: 0 })!
    addSpeedZoneBetween(net, { segId: seg.id, t: 0.25 }, { segId: seg.id, t: 0.75 }, 60)
    const ops = draw(net)
    const bands = indices(ops, isBandStroke)
    expect(bands).toHaveLength(1)
    const path = pathOf(ops, bands[0])
    expect(path.map((op) => op.name)).toEqual(['moveTo', 'quadraticCurveTo'])
    // Ends on the curve at t = 0.25 and t = 0.75
    const point = (t: number) => ({
      x: (1 - t) * (1 - t) * 60 + 2 * (1 - t) * t * 100 + t * t * 140,
      y: t * t * 30,
    })
    expect(path[0].args[0]).toBeCloseTo(screenX(point(0.25).x))
    expect(path[0].args[1]).toBeCloseTo(VH / 2 + point(0.25).y * SCALE)
    expect(path[1].args[2]).toBeCloseTo(screenX(point(0.75).x))
    expect(path[1].args[3]).toBeCloseTo(VH / 2 + point(0.75).y * SCALE)
  })

  it('stands a board at each end: Z and the speed where the zone starts, R where it ends', () => {
    const { net, zone } = tracksWithZone(0)
    const ops = draw(net)
    const boards = ops.filter(isBoardText)
    expect(boards.map((op) => op.args[0])).toEqual(['Z 90', 'R 90'])
    // Beside the track at world x = 60 and x = 140, above it on screen, white figures
    expect(boards[0].args[1]).toBeCloseTo(screenX(60))
    expect(boards[1].args[1]).toBeCloseTo(screenX(140))
    for (const board of boards) {
      expect(board.args[2] as number).toBeLessThan(VH / 2 - 10)
      expect(board.fillStyle).toBe('#ffffff')
    }
    // …on a black board
    expect(ops.some((op) => op.name === 'fill' && op.fillStyle === '#111827')).toBe(true)
    // After the rails: the boards come with the overlays
    expect(ops.indexOf(boards[0])).toBeGreaterThan(Math.max(...indices(ops, isGroundRailStroke)))

    // The boards follow the speed of the zone (the drawing is kept on the zones revision)
    setSpeedZoneSpeed(net, zone.id, 60)
    expect(draw(net).filter(isBoardText).map((op) => op.args[0])).toEqual(['Z 60', 'R 60'])
  })

  it('moves the boards with the track when a rail is reshaped', () => {
    const { net, ground } = tracksWithZone(0)
    draw(net)
    net.nodes.get(ground.to)!.pos.x = 300
    networkChanged()
    // The zone covers the same share of the rail: 30 % → 70 % of 0 → 300
    const boards = draw(net).filter(isBoardText)
    expect(boards[0].args[1]).toBeCloseTo(screenX(90))
    expect(boards[1].args[1]).toBeCloseTo(screenX(210))
  })

  it('makes the picked zone stand out, and the one about to be removed turn red', () => {
    const { net, zone } = tracksWithZone(0)
    const other = addSpeedZoneBetween(net, at(net, 150), at(net, 190), 60)!
    const picked = draw(net, { speedZones: { selectedId: zone.id } })
    const bands = picked.filter(isBandStroke)
    // The plain zone, then the picked one, in its own stroke
    expect(bands.map((op) => op.globalAlpha)).toEqual([SPEED_ZONE_ALPHA, SPEED_ZONE_ACTIVE_ALPHA])
    expect(bands.every((op) => op.strokeStyle === SPEED_ZONE_COLOR)).toBe(true)

    const doomed = draw(net, { speedZones: { dangerId: other.id } })
    const red = doomed.filter(isBandStroke).find((op) => op.strokeStyle === '#ef4444')!
    expect(red.globalAlpha).toBeCloseTo(SPEED_ZONE_ACTIVE_ALPHA)
    expect(red.start![0]).toBeCloseTo(screenX(150))
  })

  it('goes over a bridge with its rails: after the deck, before the rails it carries', () => {
    const { net } = crossingTracks(1)
    // Zone on the upper track (x = 100, y −50 → 50), from y = −30 to y = 30
    addSpeedZoneBetween(net, at(net, 100, -30), at(net, 100, 30), 60)
    const ops = draw(net)
    const band = indices(ops, isBandStroke)
    expect(band).toHaveLength(1)
    expect(band[0]).toBeGreaterThan(Math.max(...indices(ops, isDeckStroke)))
    expect(band[0]).toBeGreaterThan(Math.max(...indices(ops, isGroundRailStroke)))
    expect(band[0]).toBeLessThan(Math.min(...indices(ops, isUpperRailStroke)))
    expect(ops[band[0]].globalAlpha).toBeCloseTo(SPEED_ZONE_ALPHA)
  })

  it('is dimmed with its rails in a tunnel', () => {
    const { net } = crossingTracks(-1)
    addSpeedZoneBetween(net, at(net, 100, -30), at(net, 100, 30), 60)
    const band = draw(net).filter(isBandStroke)
    expect(band).toHaveLength(1)
    expect(band[0].globalAlpha).toBeCloseTo(SPEED_ZONE_ALPHA * TUNNEL_ALPHA)
  })

  it('in the layered drawing, each level draws the bands of its own rails only', () => {
    const { net } = tracksWithZone(1)
    addSpeedZoneBetween(net, at(net, 100, -30), at(net, 100, 30), 60)
    const { ctx, ops } = createRecordingContext()
    renderNetwork(ctx, cam(), VW, VH, net, noSelection(), {}, { tool: 'select', part: 'tracks', level: 0 })
    const ground = ops.filter(isBandStroke)
    expect(ground).toHaveLength(1)
    expect(ground[0].start![0]).toBeCloseTo(screenX(60))
    // No board in the rail pass
    expect(ops.some(isBoardText)).toBe(false)

    const upper = createRecordingContext()
    renderNetwork(upper.ctx, cam(), VW, VH, net, noSelection(), {}, { tool: 'select', part: 'tracks', level: 1 })
    expect(upper.ops.filter(isBandStroke)).toHaveLength(1)
    expect(upper.ops.filter(isBandStroke)[0].start![0]).toBeCloseTo(VW / 2)

    const overlays = createRecordingContext()
    renderNetwork(overlays.ctx, cam(), VW, VH, net, noSelection(), {}, { tool: 'select', part: 'overlays' })
    expect(overlays.ops.some(isBandStroke)).toBe(false)
    expect(overlays.ops.filter(isBoardText)).toHaveLength(4)
  })

  it('hides the zones at far zoom, and the boards of a zone too short on screen unless it is picked', () => {
    const { net, zone } = tracksWithZone(0)
    // Simplified drawing: neither band nor board
    const far = draw(net, {}, createCamera(100, 0, 0.04))
    expect(far.some((op) => op.strokeStyle === SPEED_ZONE_COLOR)).toBe(false)
    expect(far.some(isBoardText)).toBe(false)

    // Up close (4 px/m): band and boards
    const isBand = (op: Op) => op.name === 'stroke' && op.strokeStyle === SPEED_ZONE_COLOR
    const close = draw(net, { hideSectionBadges: true })
    expect(close.some(isBand)).toBe(true)
    expect(close.filter(isBoardText)).toHaveLength(2)

    // At the edge of the detailed drawing (2.2 px/m) a whole station is still in view: no board yet
    const detailed = draw(net, {}, createCamera(100, 0, 2.2))
    expect(detailed.some(isBand)).toBe(true)
    expect(detailed.some(isBoardText)).toBe(false)

    // Line drawing (1 px/m, 80 px on screen): the band stays, the boards go unless the zone is picked
    const line = draw(net, {}, createCamera(100, 0, 1))
    expect(line.some(isBand)).toBe(true)
    expect(line.some(isBoardText)).toBe(false)
    const pickedLine = draw(net, { speedZones: { selectedId: zone.id } }, createCamera(100, 0, 1))
    expect(pickedLine.filter(isBoardText)).toHaveLength(2)

    // Schematic (0.3 px/m): neither band nor board, unless the zone is picked
    const schematic = draw(net, {}, createCamera(100, 0, 0.3))
    expect(schematic.some(isBand)).toBe(false)
    expect(schematic.some(isBoardText)).toBe(false)
    const picked = draw(net, { speedZones: { selectedId: zone.id } }, createCamera(100, 0, 0.3))
    expect(picked.some(isBand)).toBe(true)
    // 24 px between its two boards: they would cover each other, one is kept
    expect(picked.filter(isBoardText)).toHaveLength(1)
  })

  it('never draws a board over another one: the longest zone keeps its own', () => {
    const { net } = tracksWithZone(0)
    // A second zone that starts where the first one ends: its « Z » board would cover the « R » one
    addSpeedZoneBetween(net, at(net, 140), at(net, 170), 60)
    const boards = texts(draw(net)).filter((text) => /^[ZR] \d+$/.test(text))
    expect(boards).toContain('Z 90')
    expect(boards).toContain('R 90')
    expect(boards).not.toContain('Z 60')
    expect(boards).toContain('R 60')
  })

  it('keeps bands and boards in the driving view', () => {
    const { net } = tracksWithZone(0)
    const ops = draw(net, { hideConstructionNodes: true, hideSectionBadges: true })
    expect(ops.filter(isBandStroke)).toHaveLength(1)
    expect(ops.filter(isBoardText)).toHaveLength(2)
  })

  it('plain driving view: the boards stay, the band goes', () => {
    const { net } = tracksWithZone(0)
    const ops = draw(net, { hideConstructionNodes: true, hideSectionBadges: true, hideSpeedZoneBands: true })
    expect(ops.filter(isBandStroke)).toHaveLength(0)
    expect(ops.filter(isBoardText)).toHaveLength(2)
  })

  it('marks the stretch two zones share with the diagnostic marker, in the construction view only', () => {
    const { net, zone } = tracksWithZone(0)
    const other = addSpeedZoneBetween(net, at(net, 110), at(net, 180), 60)!
    const overlaps = vi.spyOn(speedLimits, 'speedZoneOverlaps')
    // World x = 110 → 140 of the ground track
    overlaps.mockReturnValue([{ a: zone, b: other, spans: [{ segId: at(net, 110).segId, t0: 0.55, t1: 0.7 }], length: 30 }])

    const ops = draw(net)
    // The lower of the two speeds, on the warning marker of the other diagnostics, halfway along the shared stretch
    const label = ops.find((op) => op.name === 'fillText' && op.args[0] === overlapLabel(60))!
    expect(label).toBeDefined()
    expect(overlapLabel(60)).toBe('Chevauchement · 60 km/h')
    expect(label.args[1]).toBeCloseTo(screenX(125))
    expect(ops.some((op) => op.name === 'fill' && op.fillStyle === '#f59e0b')).toBe(true)

    // Driving view: no diagnostic
    expect(texts(draw(net, { hideConstructionNodes: true }))).not.toContain(overlapLabel(60))

    // No overlap: no marker
    overlaps.mockReturnValue([])
    setSpeedZoneSpeed(net, other.id, 70) // a change of the zones: the kept drawing is rebuilt
    expect(texts(draw(net)).some((t) => t.startsWith('Chevauchement'))).toBe(false)
  })
})
