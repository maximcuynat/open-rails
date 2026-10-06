import { beforeEach, describe, expect, it } from 'vitest'
import { createCamera, type Camera } from '@infrastructure/render/camera'
import { addCurveChain, addNode, addSegment, createNetwork, resetIdCounter } from '@domain/models/network'
import { tangentArcPieces } from '@domain/geometry/curve'
import { positionOnSegment, snapToNearestTrack } from '@domain/models/locomotive'
import { createVehicle, makeTrainSet, type TrainSet } from '@domain/models/train'
import type { LineSettings } from '@domain/models/speedLimits'
import { trackProfile, trackSpeedStats } from '@domain/models/trackSpeed'
import type { Network, Point, RailNode, Segment } from '@domain/models/types'
import { GAUGE, TRAIN_FLANK_FILL, TUNNEL_ALPHA, renderNetwork, renderTrainSet, type RenderNetworkOptions } from '@infrastructure/render/renderer'
import { trackLod } from '@infrastructure/render/lod'
import { groupPiecesByLevel } from '@infrastructure/render/levelPieces'
import { networkDerived } from '@infrastructure/render/networkDerived'
import { CANT_MARK_LEVELS, cantMarkLevel, cantMarkStyle, cantRenderStats, cantStretches } from '@infrastructure/render/cantRender'
import { CHEVRON_HALF_PX, CHEVRON_MIN_LINE_PX, CHEVRON_SPACING_PX, chevronMetrics, gradientLabel, renderGradientChevrons } from '@infrastructure/render/gradientRender'
import { networkChanged } from '@domain/models/networkWatch'

beforeEach(() => resetIdCounter(0))

const VW = 800
const VH = 600
const CLASSIC_160: LineSettings = { lineSpeed: 160, lineType: 'classic' }
const NO_SELECTION = { nodes: new Set<string>(), segments: new Set<string>() }
/** Colours the canvas falls back to without a stylesheet */
const ACCENT = '#2563eb'
const INK = '#1a1a1a'
const DANGER = '#dc2626'
/** Fills of a vehicle body and of the flank of a leaning one */
const BODY_FILL = 'rgba(14, 165, 233, 0.09)'
const FLANK_FILL = TRAIN_FLANK_FILL

/** A `stroke`, `fill` or `fillText`, with the style it was made in and the points of its path */
interface Paint {
  kind: 'stroke' | 'fill' | 'fillText'
  strokeStyle?: unknown
  fillStyle?: unknown
  lineWidth: number
  globalAlpha: number
  dash: number[]
  /** Sub-paths, each a list of x, y points (the end points of the curves) */
  path: [number, number][][]
  text?: string
}

/** Canvas that records what is painted; `save` / `restore` keep a real state stack */
function recordingContext(): { ctx: CanvasRenderingContext2D; paints: Paint[]; calls: [string, unknown[]][] } {
  const paints: Paint[] = []
  const calls: [string, unknown[]][] = []
  let state: Record<string, unknown> = { globalAlpha: 1, dash: [], lineWidth: 1 }
  const stack: Record<string, unknown>[] = []
  let path: [number, number][][] = []
  const paint = (kind: Paint['kind'], text?: string): void => {
    paints.push({
      kind,
      strokeStyle: state.strokeStyle,
      fillStyle: state.fillStyle,
      lineWidth: state.lineWidth as number,
      globalAlpha: state.globalAlpha as number,
      dash: state.dash as number[],
      path: path.map((sub) => [...sub]),
      text,
    })
  }
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined
      if (key === 'canvas') return { width: VW, height: VH }
      if (key === 'measureText') return () => ({ width: 30 })
      if (key in state) return state[key]
      return (...args: unknown[]) => {
        calls.push([key, args])
        const n = args as number[]
        if (key === 'save') stack.push({ ...state })
        else if (key === 'restore') state = stack.pop() ?? state
        else if (key === 'beginPath') path = []
        else if (key === 'moveTo') path.push([[n[0], n[1]]])
        else if (key === 'lineTo') path[path.length - 1]?.push([n[0], n[1]])
        else if (key === 'quadraticCurveTo') path[path.length - 1]?.push([n[2], n[3]])
        else if (key === 'setLineDash') state.dash = args[0]
        else if (key === 'stroke') paint('stroke')
        else if (key === 'fill') paint('fill')
        else if (key === 'fillText') paint('fillText', String(args[0]))
      }
    },
    set(_target, key, value) {
      if (typeof key === 'string') state[key] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, paints, calls }
}

/** Lays track piece by piece from the origin, heading +x */
class Layout {
  net = createNetwork()
  node: RailNode
  heading = 0
  pieces: Segment[][] = []

  constructor() {
    this.node = addNode(this.net, { x: 0, y: 0 })
  }

  /** Straight rail ending at `level` (the height of the layout so far when absent) */
  straight(length: number, level?: number): this {
    const next = addNode(this.net, {
      x: this.node.pos.x + Math.cos(this.heading) * length,
      y: this.node.pos.y + Math.sin(this.heading) * length,
    })
    next.level = level ?? this.node.level
    networkChanged()
    this.pieces.push([addSegment(this.net, this.node.id, next.id)!])
    this.node = next
    return this
  }

  /** Arc turning by `degrees` (positive = towards +y), laid with `cant` mm by hand */
  arc(radius: number, degrees: number, cant: number): this {
    const side = Math.sign(degrees)
    const theta = (Math.abs(degrees) * Math.PI) / 180
    const centre = {
      x: this.node.pos.x - Math.sin(this.heading) * side * radius,
      y: this.node.pos.y + Math.cos(this.heading) * side * radius,
    }
    const endHeading = this.heading + side * theta
    const end = addNode(this.net, {
      x: centre.x + Math.sin(endHeading) * side * radius,
      y: centre.y - Math.cos(endHeading) * side * radius,
    })
    end.level = this.node.level
    networkChanged()
    const arc = tangentArcPieces(this.node.pos, { x: Math.cos(this.heading), y: Math.sin(this.heading) }, end.pos)!
    const rails = addCurveChain(this.net, this.node.id, end.id, arc.pieces)!.segments
    for (const rail of rails) rail.cant = cant
    networkChanged()
    this.pieces.push(rails)
    this.node = end
    this.heading = endHeading
    return this
  }
}

const RADIUS = 500
/** 500 m straight, quarter turn of 500 m radius to `side`, 500 m straight; the centre of the curve is (500, side × 500) */
function curveLayout(side: 1 | -1 = 1, cant = 150): Layout {
  return new Layout().straight(500).arc(RADIUS, 90 * side, cant).straight(500)
}
const centreOf = (side: 1 | -1): Point => ({ x: 500, y: RADIUS * side })
/** Point of the curve after `degrees` of turn */
function onCurve(side: 1 | -1, degrees: number): Point {
  const a = (degrees * Math.PI) / 180
  return { x: 500 + RADIUS * Math.sin(a), y: side * RADIUS * (1 - Math.cos(a)) }
}

function trainAt(net: Network, world: Point, kind: 'loco' | 'wagon' = 'wagon'): TrainSet {
  const hit = snapToNearestTrack(net, world, 1)!
  return makeTrainSet('T', [createVehicle(net, hit.segId, hit.t, kind, 1)!])
}

/** Is `p` inside the polygon, or within `tolerance` of its edge? */
function enclosed(p: [number, number], polygon: [number, number][], tolerance = 0.01): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
    const len2 = (xj - xi) ** 2 + (yj - yi) ** 2
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - xi) * (xj - xi) + (p[1] - yi) * (yj - yi)) / len2)) : 0
    if (Math.hypot(p[0] - (xi + t * (xj - xi)), p[1] - (yi + t * (yj - yi))) <= tolerance) return true
  }
  return inside
}

/** World point of a screen point */
const toWorld = (cam: Camera, p: [number, number]): Point => ({ x: (p[0] - VW / 2) / cam.scale + cam.x, y: (p[1] - VH / 2) / cam.scale + cam.y })
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
const meanDistance = (cam: Camera, paint: Paint, from: Point): number => {
  const points = paint.path.flat()
  return points.reduce((sum, p) => sum + distance(toWorld(cam, p), from), 0) / points.length
}

// ─────────────────── Lot 1: the body of the train leans ───────────────────

describe('renderTrainSet: lean of the bodies', () => {
  const draw = (net: Network, train: TrainSet, cam: Camera, line?: LineSettings) => {
    const rec = recordingContext()
    renderTrainSet(rec.ctx, cam, VW, VH, net, train, false, false, false, undefined, null, null, undefined, line)
    return rec
  }

  it('on straight track the drawing is what it was', () => {
    const { net } = curveLayout()
    const train = trainAt(net, { x: 200, y: 0 })
    const cam = createCamera(200, 0, 10)
    expect(trackLod(cam.scale, GAUGE)).toBe('detail')
    const plain = draw(net, train, cam)
    expect(plain.calls.length).toBeGreaterThan(0)
    expect(draw(net, train, cam, CLASSIC_160).calls).toEqual(plain.calls)
  })

  it('in a curve the roof is drawn off the footprint, towards the inside when stopped, and a flank shows', () => {
    for (const side of [1, -1] as const) {
      const { net } = curveLayout(side)
      const world = onCurve(side, 45)
      const train = trainAt(net, world)
      const cam = createCamera(world.x, world.y, 10)
      const plain = draw(net, train, cam)
      const leaning = draw(net, train, cam, CLASSIC_160)
      const body = (paints: Paint[]): Paint => paints.find((p) => p.kind === 'fill' && p.fillStyle === BODY_FILL)!
      expect(plain.paints.some((p) => p.fillStyle === FLANK_FILL)).toBe(false)
      const shift = meanDistance(cam, body(plain.paints), centreOf(side)) - meanDistance(cam, body(leaning.paints), centreOf(side))
      // 4.32 m of body on 150 mm of cant, stopped: about half a metre, the real figure
      expect(shift).toBeGreaterThan(0.4)
      expect(shift).toBeLessThan(0.6)
      const flanks = leaning.paints.filter((p) => p.kind === 'fill' && p.fillStyle === FLANK_FILL)
      expect(flanks).toHaveLength(1)
      // The flank is on the outside: further from the centre than the roof
      expect(meanDistance(cam, flanks[0], centreOf(side))).toBeGreaterThan(meanDistance(cam, body(leaning.paints), centreOf(side)))
      // One fill and one stroke more than upright, nothing else
      expect(leaning.paints.length).toBe(plain.paints.length + 2)
    }
  })

  it('the flank is a shade of its own: neither the roof nor the accent of the cant mark', () => {
    const { net } = curveLayout()
    const world = onCurve(1, 45)
    const cam = createCamera(world.x, world.y, 10)
    const fills = draw(net, trainAt(net, world), cam, CLASSIC_160).paints.filter((p) => p.kind === 'fill').map((p) => p.fillStyle)
    expect(fills).toContain(TRAIN_FLANK_FILL)
    expect(TRAIN_FLANK_FILL).not.toBe(BODY_FILL)
    // The cant mark is stroked in the accent colour (see below): a blue, where the flank is a slate grey
    const rgb = /rgba\((\d+), (\d+), (\d+)/.exec(TRAIN_FLANK_FILL)!.slice(1).map(Number)
    expect(rgb[2] - rgb[0]).toBeLessThan(60)
    const accent = [0x25, 0x63, 0xeb]
    expect(accent[2] - accent[0]).toBeGreaterThan(150)
  })

  it('the outline of a selected vehicle goes round what is drawn: the roof and the flank', () => {
    const SELECTION = '#38bdf8'
    const TARGET = '#f59e0b'
    const select = (net: Network, train: TrainSet, cam: Camera, line?: LineSettings) => {
      const rec = recordingContext()
      renderTrainSet(rec.ctx, cam, VW, VH, net, train, true, false, false, undefined, train.vehicles[0].id, null, undefined, line)
      return rec.paints
    }
    for (const kind of ['wagon', 'loco'] as const) {
      const { net } = curveLayout()
      const world = onCurve(1, 45)
      const train = trainAt(net, world, kind)
      const cam = createCamera(world.x, world.y, 10)
      const paints = select(net, train, cam, CLASSIC_160)
      const roof = paints.find((p) => p.kind === 'fill' && p.fillStyle === BODY_FILL)!.path[0]
      const flank = paints.find((p) => p.kind === 'fill' && p.fillStyle === FLANK_FILL)!.path[0]
      const footprint = select(net, train, cam).find((p) => p.kind === 'stroke' && p.strokeStyle === SELECTION)!.path[0]
      for (const color of [SELECTION, TARGET]) {
        const outline = paints.find((p) => p.kind === 'stroke' && p.strokeStyle === color)!.path[0]
        for (const p of [...roof, ...flank]) expect(enclosed(p, outline)).toBe(true)
        // …and is drawn over the body, where the flank does not hide it
        const at = (match: (p: Paint) => boolean): number => paints.findIndex(match)
        expect(at((p) => p.kind === 'stroke' && p.strokeStyle === color)).toBeGreaterThan(at((p) => p.kind === 'fill' && p.fillStyle === BODY_FILL))
        // The footprint did not enclose the roof: it stands half a metre (5 px) off
        expect(roof.every((p) => enclosed(p, footprint))).toBe(false)
        expect(outline).not.toEqual(footprint)
      }
    }
    // Upright, the outline is the footprint as before
    const { net } = curveLayout()
    const train = trainAt(net, { x: 200, y: 0 })
    const cam = createCamera(200, 0, 10)
    expect(select(net, train, cam, CLASSIC_160)).toEqual(select(net, train, cam))
  })

  it('a derailed power car lies on its side with its nose', () => {
    const { net } = curveLayout()
    const world = onCurve(1, 45)
    const train = trainAt(net, world, 'loco')
    const cam = createCamera(world.x, world.y, 10)
    const upright = draw(net, train, cam).paints.find((p) => p.kind === 'fill' && p.fillStyle === BODY_FILL)!.path[0]
    train.derailed = { speed: 200, limit: 110 }
    const paints = draw(net, train, cam, CLASSIC_160).paints
    // Nothing but the flank shows: the whole silhouette in its shade, no roof
    expect(paints.some((p) => p.kind === 'fill' && p.fillStyle === BODY_FILL)).toBe(false)
    const lying = paints.find((p) => p.kind === 'fill' && p.fillStyle === FLANK_FILL)!.path[0]
    expect(lying).toHaveLength(upright.length)
    expect(lying.length).toBeGreaterThan(4)
    // Point for point the footprint, moved across the track only: the nose is still a nose
    const veh = train.vehicles[0]
    const front = positionOnSegment(net, veh.front.segId, veh.front.t)!
    const rear = positionOnSegment(net, veh.rear.segId, veh.rear.t)!
    const length = distance(front, rear)
    const axis = { x: (front.x - rear.x) / length, y: (front.y - rear.y) / length }
    const along = (p: [number, number]): number => p[0] * axis.x + p[1] * axis.y
    const across = (p: [number, number]): number => -p[0] * axis.y + p[1] * axis.x
    const spread = (points: [number, number][]): number => Math.max(...points.map(across)) - Math.min(...points.map(across))
    lying.forEach((p, i) => expect(along(p)).toBeCloseTo(along(upright[i]), 6))
    // As wide as the power car is high (4.1 m at 10 px/m), tapering to the tip like the footprint
    expect(spread(lying)).toBeCloseTo(41, 6)
    const tip = (points: [number, number][]): number => spread([points[0], points[points.length - 1]])
    expect(tip(lying) / spread(lying)).toBeCloseTo(tip(upright) / spread(upright), 6)
    expect(tip(lying)).toBeLessThan(spread(lying) / 2)
    // To the outside of the curve, from the axis of the track
    const reach = lying.map((p) => distance(toWorld(cam, p), centreOf(1)) - RADIUS)
    expect(Math.min(...reach)).toBeGreaterThan(-0.3)
    expect(Math.max(...reach)).toBeGreaterThan(3.8)
  })

  it('a derailed train is drawn lying towards the outside of the curve', () => {
    const { net } = curveLayout()
    const world = onCurve(1, 45)
    const train = trainAt(net, world)
    train.derailed = { speed: 200, limit: 110 }
    const cam = createCamera(world.x, world.y, 10)
    const rec = draw(net, train, cam, CLASSIC_160)
    const flank = rec.paints.find((p) => p.kind === 'fill' && p.fillStyle === FLANK_FILL)!
    const far = Math.max(...flank.path.flat().map((p) => distance(toWorld(cam, p), centreOf(1))))
    // From the axis of the track out to the height of the body
    expect(far - RADIUS).toBeGreaterThan(4)
    expect(far - RADIUS).toBeLessThan(4.6)
  })

  it('nothing more is drawn, nor read from the track, in the zoomed-out tiers and out of view', () => {
    const { net } = curveLayout()
    const world = onCurve(1, 45)
    const train = trainAt(net, world)
    trackProfile(net, CLASSIC_160)
    for (const scale of [1, 0.2]) {
      const cam = createCamera(world.x, world.y, scale)
      expect(trackLod(scale, GAUGE)).not.toBe('detail')
      const plain = draw(net, train, cam)
      const builds = trackSpeedStats.profileBuilds
      const withLine = draw(net, train, cam, { ...CLASSIC_160, lineSpeed: 100 + scale })
      expect(withLine.calls).toEqual(plain.calls)
      // A line setting never seen before: the profile would have been built had it been asked for
      expect(trackSpeedStats.profileBuilds).toBe(builds)
    }
    const away = createCamera(world.x + 5000, world.y, 10)
    const builds = trackSpeedStats.profileBuilds
    expect(draw(net, train, away, { ...CLASSIC_160, lineSpeed: 90 }).calls).toEqual([])
    expect(trackSpeedStats.profileBuilds).toBe(builds)
  })

  it('nothing leans off the real scale', () => {
    const { net } = curveLayout()
    const world = onCurve(1, 45)
    const train = trainAt(net, world)
    const cam = createCamera(world.x, world.y, 10)
    expect(draw(net, train, cam, { ...CLASSIC_160, realScale: false }).calls).toEqual(draw(net, train, cam).calls)
  })
})

// ─────────────────── Lot 2: the cant marked on the track ───────────────────

describe('cant marks', () => {
  const options = (line: LineSettings = CLASSIC_160, extra: RenderNetworkOptions = {}): RenderNetworkOptions =>
    ({ hideConstructionNodes: true, hideSectionBadges: true, inclination: { line }, ...extra })
  const drawTracks = (net: Network, cam: Camera, opts: RenderNetworkOptions | undefined) => {
    const rec = recordingContext()
    renderNetwork(rec.ctx, cam, VW, VH, net, NO_SELECTION, undefined, opts)
    return rec
  }
  /** Nothing is selected, so the accent colour is only stroked by the cant marks */
  const marks = (paints: Paint[]): Paint[] => paints.filter((p) => p.kind === 'stroke' && p.strokeStyle === ACCENT)

  it('nothing on straight track', () => {
    const { net } = new Layout().straight(300).straight(300)
    expect(marks(drawTracks(net, createCamera(300, 0, 8), options()).paints)).toEqual([])
  })

  it('the outer rail of a canted curve is highlighted, to the left as to the right', () => {
    for (const side of [1, -1] as const) {
      const { net } = curveLayout(side)
      const world = onCurve(side, 45)
      const cam = createCamera(world.x, world.y, 8)
      const found = marks(drawTracks(net, cam, options()).paints)
      expect(found).toHaveLength(1)
      // Every point of the mark lies on the rail away from the centre: R + half the gauge
      for (const p of found[0].path.flat()) {
        expect(distance(toWorld(cam, p), centreOf(side))).toBeCloseTo(RADIUS + GAUGE / 2, 2)
      }
      expect(found[0].globalAlpha).toBeLessThan(1)
    }
  })

  it('is not drawn when the display is off, nor off the real scale', () => {
    const { net } = curveLayout()
    const world = onCurve(1, 45)
    const cam = createCamera(world.x, world.y, 8)
    expect(marks(drawTracks(net, cam, { hideConstructionNodes: true }).paints)).toEqual([])
    expect(marks(drawTracks(net, cam, options({ ...CLASSIC_160, realScale: false })).paints)).toEqual([])
    // …and the drawing without the marks is the drawing of before, call for call
    const off = drawTracks(net, cam, { hideConstructionNodes: true, hideSectionBadges: true })
    const on = drawTracks(net, cam, options())
    expect(on.paints.filter((p) => p.strokeStyle !== ACCENT)).toEqual(off.paints)
  })

  it('grows with the cant: wider and denser', () => {
    const drawn = [40, 100, 150, 180].map((cant) => {
      const { net } = curveLayout(1, cant)
      const world = onCurve(1, 45)
      const [mark] = marks(drawTracks(net, createCamera(world.x, world.y, 8), options()).paints)
      return mark
    })
    for (let i = 1; i < drawn.length; i++) {
      expect(drawn[i].lineWidth).toBeGreaterThan(drawn[i - 1].lineWidth)
      expect(drawn[i].globalAlpha).toBeGreaterThan(drawn[i - 1].globalAlpha)
    }
    expect(cantMarkLevel(5)).toBe(1)
    expect(cantMarkLevel(180)).toBe(CANT_MARK_LEVELS)
    expect(cantMarkLevel(400)).toBe(CANT_MARK_LEVELS)
    // Still a visible stroke at the edge of the detailed drawing, and never wider than the track
    const thin = cantMarkStyle(1, 2.2, GAUGE, GAUGE)
    const wide = cantMarkStyle(CANT_MARK_LEVELS, 2.2, GAUGE, GAUGE)
    expect(thin.width).toBeGreaterThanOrEqual(2)
    expect(wide.width).toBeLessThanOrEqual(GAUGE * 2.2 * 1.2)
  })

  it('fades in along the cant ramp at the end of the curve, straight track included', () => {
    const { net, pieces } = curveLayout()
    // Around the tangent point: the ramp runs from the straight track into the curve
    const cam = createCamera(500, 0, 8)
    const found = marks(drawTracks(net, cam, options()).paints)
    expect(found.length).toBeGreaterThan(2)
    const widths = found.map((p) => p.lineWidth)
    expect([...widths].sort((a, b) => a - b)).toEqual(widths)
    expect(new Set(widths).size).toBe(widths.length)
    // The weakest steps are on the straight rail, the strongest in the curve
    expect(found[0].path.flat().every((p) => toWorld(cam, p).x < 500.01)).toBe(true)
    expect(found[found.length - 1].path.flat().every((p) => toWorld(cam, p).x > 500)).toBe(true)
    // …on the side of the high rail there too: away from the centre of the curve
    for (const p of found[0].path.flat()) expect(toWorld(cam, p).y).toBeCloseTo(-GAUGE / 2, 6)
    const stretches = cantStretches(trackProfile(net, CLASSIC_160))
    const onStraight = stretches.get(pieces[0][0].id)!
    expect(onStraight.every((s, i) => i === 0 || s.cant > onStraight[i - 1].cant)).toBe(true)
    expect(onStraight[0].t0).toBeGreaterThan(0.5)
  })

  it('is not drawn in the zoomed-out tiers', () => {
    const { net } = curveLayout()
    const world = onCurve(1, 45)
    for (const scale of [1, 0.2]) {
      expect(trackLod(scale, GAUGE)).not.toBe('detail')
      expect(marks(drawTracks(net, createCamera(world.x, world.y, scale), options()).paints)).toEqual([])
    }
  })

  it('goes with the rails of its level: dimmed in a tunnel, left out of the pass of another level', () => {
    const ground = curveLayout()
    const world = onCurve(1, 45)
    const cam = createCamera(world.x, world.y, 8)
    const [open] = marks(drawTracks(ground.net, cam, options()).paints)

    const below = curveLayout()
    for (const node of below.net.nodes.values()) node.level = -1
    networkChanged()
    const [tunnel] = marks(drawTracks(below.net, cam, options()).paints)
    expect(tunnel.globalAlpha).toBeCloseTo(open.globalAlpha * TUNNEL_ALPHA, 9)

    const above = curveLayout()
    for (const node of above.net.nodes.values()) node.level = 1
    networkChanged()
    expect(marks(drawTracks(above.net, cam, options(CLASSIC_160, { part: 'tracks', level: 0 })).paints)).toEqual([])
    const onDeck = drawTracks(above.net, cam, options(CLASSIC_160, { part: 'tracks', level: 1 }))
    expect(marks(onDeck.paints)).toHaveLength(1)
    // Over the deck of the bridge, under the rails
    const order = onDeck.paints.map((p) => p.strokeStyle)
    expect(order.indexOf(ACCENT)).toBeGreaterThan(0)
    expect(order.lastIndexOf('#526071')).toBeGreaterThan(order.indexOf(ACCENT))
  })

  it('the stretches are worked out once and kept until the track changes', () => {
    const { net, pieces } = curveLayout()
    const world = onCurve(1, 45)
    const cam = createCamera(world.x, world.y, 8)
    drawTracks(net, cam, options())
    const builds = cantRenderStats.builds
    const profiles = trackSpeedStats.profileBuilds
    for (let i = 0; i < 5; i++) drawTracks(net, cam, options({ ...CLASSIC_160 }))
    expect(cantRenderStats.builds).toBe(builds)
    expect(trackSpeedStats.profileBuilds).toBe(profiles)
    pieces[1][0].cant = 80
    networkChanged()
    drawTracks(net, cam, options())
    expect(cantRenderStats.builds).toBe(builds + 1)
  })
})

// ─────────────────── Lot 3: the slopes marked on the track ───────────────────

describe('slope marks', () => {
  const LEVEL_HEIGHT = 6
  const gradient = { levelHeight: LEVEL_HEIGHT, maxGradient: 35 }
  const options = (extra: RenderNetworkOptions = {}): RenderNetworkOptions =>
    ({ hideConstructionNodes: true, hideSectionBadges: true, gradient, inclination: { line: CLASSIC_160 }, ...extra })
  const draw = (net: Network, cam: Camera, opts: RenderNetworkOptions | undefined) => {
    const rec = recordingContext()
    renderNetwork(rec.ctx, cam, VW, VH, net, NO_SELECTION, undefined, opts)
    return rec
  }
  /**
   * A chevron is a sub-path of three points; they come in strokes that hold nothing else — one per
   * level the ramp is drawn with (a ramp is cut where it crosses half a level) and per colour
   */
  const chevronStrokes = (paints: Paint[]): Paint[] =>
    paints.filter((p) => p.kind === 'stroke' && p.path.length > 0 && p.path.every((sub) => sub.length === 3) && (p.strokeStyle === INK || p.strokeStyle === DANGER))
  const labels = (paints: Paint[]): Paint[] => paints.filter((p) => p.kind === 'fillText' && /‰$/.test(p.text ?? '') && !p.text!.startsWith('Pente'))

  /** 100 m level, then 200 m climbing to one level (30 ‰) in two rails, then 100 m level, along +x */
  const ramp = (): Layout => new Layout().straight(100).straight(100, 0.5).straight(100, 1).straight(100)

  it('a level track carries no sign', () => {
    const { net } = new Layout().straight(200).straight(200)
    const rec = draw(net, createCamera(200, 0, 8), options())
    expect(chevronStrokes(rec.paints)).toEqual([])
    expect(labels(rec.paints)).toEqual([])
    // …and is drawn as it was without the display
    expect(rec.calls).toEqual(draw(net, createCamera(200, 0, 8), { hideConstructionNodes: true, hideSectionBadges: true, gradient }).calls)
  })

  it('chevrons point to the top of the ramp, at a constant pitch on screen', () => {
    const { net } = ramp()
    for (const scale of [4, 8]) {
      const cam = createCamera(200, 0, scale)
      const strokes = chevronStrokes(draw(net, cam, options()).paints)
      // The ramp climbs to a bridge: its lower half goes with the ground, its upper half with the deck
      expect(strokes).toHaveLength(2)
      expect(new Set(strokes.map((p) => p.strokeStyle))).toEqual(new Set([INK]))
      const chevrons = strokes.flatMap((p) => p.path)
      const tips = chevrons.map((sub) => sub[1])
      for (const sub of chevrons) {
        // The point is further up the ramp (+x) than the two arms, which are on either side of the axis
        expect(sub[1][0]).toBeGreaterThan(sub[0][0])
        expect(sub[1][0]).toBeGreaterThan(sub[2][0])
        expect(sub[0][1] * 1 - VH / 2).toBeCloseTo(-(sub[2][1] - VH / 2), 9)
      }
      // Only on the ramp (x from 100 to 300 m)
      for (const tip of tips) {
        const x = toWorld(cam, tip).x
        expect(x).toBeGreaterThan(100)
        expect(x).toBeLessThan(301)
      }
      const xs = tips.map((tip) => tip[0]).sort((a, b) => a - b)
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeCloseTo(chevronMetrics(scale, GAUGE).spacing, 6)
      expect(xs.length).toBeGreaterThan(5)
    }
  })

  it('chevrons stay readable down to the bottom of the detailed drawing, and do not crowd the close view', () => {
    const { net } = ramp()
    const measure = (scale: number) => {
      const cam = createCamera(200, 0, scale)
      // The marks are drawn wherever the two rails are: the detail tier and the rails tier below it
      expect(['detail', 'rails']).toContain(trackLod(scale, GAUGE))
      const strokes = chevronStrokes(draw(net, cam, options()).paints)
      const chevrons = strokes.flatMap((p) => p.path)
      const xs = chevrons.map((sub) => sub[1][0]).sort((a, b) => a - b)
      return {
        // Distance from one arm end to the other, across the track
        width: Math.abs(chevrons[0][0][1] - chevrons[0][2][1]),
        pitch: xs[1] - xs[0],
        line: Math.min(...strokes.map((p) => p.lineWidth)),
        paints: draw(net, cam, options()).paints,
      }
    }
    // 2.1 px/m: the two rails are 3 px apart, the least the detailed drawing shows
    const far = measure(2.1)
    expect(GAUGE * 2.1).toBeLessThan(3.1)
    expect(far.width).toBeCloseTo(2 * CHEVRON_HALF_PX.min, 6)
    expect(far.width).toBeGreaterThanOrEqual(9)
    expect(far.line).toBeGreaterThanOrEqual(CHEVRON_MIN_LINE_PX)
    expect(far.pitch).toBeCloseTo(CHEVRON_SPACING_PX.min, 6)
    // Room between two chevrons: more than three times their length along the track
    expect(far.pitch).toBeGreaterThan(3 * CHEVRON_HALF_PX.min * 1.6)
    // Each chevron is rimmed in the background colour, under it
    const ink = far.paints.findIndex((p) => p.kind === 'stroke' && p.strokeStyle === INK && p.path.every((sub) => sub.length === 3) && p.path.length > 0)
    const rim = far.paints[ink - 1]
    expect(rim.kind).toBe('stroke')
    expect(rim.strokeStyle).toBe('#ffffff')
    expect(rim.path).toEqual(far.paints[ink].path)
    expect(rim.lineWidth).toBeGreaterThan(far.paints[ink].lineWidth + 2)
    // Close up: no bigger than the track allows, and further apart
    const close = measure(20)
    expect(close.width).toBeCloseTo(2 * CHEVRON_HALF_PX.max, 6)
    expect(close.width).toBeLessThan(GAUGE * 20)
    expect(close.pitch).toBeCloseTo(CHEVRON_SPACING_PX.max, 6)
  })

  it('a slope label never stands on a diagnostic marker: the marker already gives the slope there', () => {
    // 3 m in 50 m: 60 ‰, reported at the foot of the ramp
    const { net } = new Layout().straight(100).straight(50, 0.5).straight(100)
    const shown = { gradient, inclination: { line: CLASSIC_160 }, hideSectionBadges: true }
    for (const scale of [0.9, 1]) {
      const cam = createCamera(125, 0, scale)
      // Without the diagnostics (driving view) the label is there
      expect(labels(draw(net, cam, { ...shown, hideConstructionNodes: true }).paints).map((p) => p.text)).toEqual(['60 ‰'])
      const paints = draw(net, cam, shown).paints
      expect(paints.filter((p) => p.kind === 'fillText').map((p) => p.text)).toContain('Pente 60 ‰')
      expect(labels(paints)).toEqual([])
    }
    // A long ramp: its label stands in the middle, clear of the marker at its foot — both are drawn
    const long = new Layout().straight(100).straight(200, 2).straight(100)
    const cam = createCamera(200, 0, 3)
    const paints = draw(long.net, cam, shown).paints
    const texts = paints.filter((p) => p.kind === 'fillText')
    const marker = texts.find((p) => p.text === 'Pente 60 ‰')!
    const label = labels(paints)
    expect(label.map((p) => p.text)).toEqual(['60 ‰'])
    expect(marker).toBeDefined()
  })

  it('the chevrons follow the way up, not the way the rail was laid', () => {
    // The same ramp laid from its top: every rail runs downhill
    const net = createNetwork()
    const top = addNode(net, { x: 300, y: 0 })
    top.level = 1
    networkChanged()
    const foot = addNode(net, { x: 100, y: 0 })
    addSegment(net, top.id, foot.id)
    const cam = createCamera(200, 0, 8)
    const rec = recordingContext()
    const pieces = groupPiecesByLevel(net, net.segments.values()).flatMap((group) => group.pieces)
    renderGradientChevrons(rec.ctx, cam, VW, VH, net, pieces, networkDerived(net).ramps(LEVEL_HEIGHT), new Set(), GAUGE, 1, { ink: INK, alert: DANGER, paper: '#fff' })
    const [stroke] = chevronStrokes(rec.paints)
    expect(stroke.path.length).toBeGreaterThan(5)
    for (const sub of stroke.path) {
      expect(sub[1][0]).toBeGreaterThan(sub[0][0])
      expect(sub[1][0]).toBeGreaterThan(sub[2][0])
    }
  })

  it('a ramp of several rails gets one label, with its slope', () => {
    const { net } = ramp()
    const found = labels(draw(net, createCamera(200, 0, 4), options()).paints)
    expect(found.map((p) => p.text)).toEqual(['30 ‰'])
    expect(found[0].fillStyle).toBe(INK)
    expect(gradientLabel(12.54)).toBe('12,5 ‰')
    expect(gradientLabel(-30)).toBe('30 ‰')
  })

  it('a ramp beyond the limit of the project is drawn in the alert colour', () => {
    // 6 m in 100 m: 60 ‰ against a limit of 35 ‰
    const { net } = new Layout().straight(100).straight(100, 1).straight(100)
    const cam = createCamera(150, 0, 8)
    const rec = draw(net, cam, options())
    expect(new Set(chevronStrokes(rec.paints).map((p) => p.strokeStyle))).toEqual(new Set([DANGER]))
    expect(labels(rec.paints).map((p) => [p.text, p.fillStyle])).toEqual([['60 ‰', DANGER]])
    // The limit is the one of the diagnostics: raised above the slope, the alert goes
    const relaxed = draw(net, cam, options({ gradient: { levelHeight: LEVEL_HEIGHT, maxGradient: 70 } }))
    expect(new Set(chevronStrokes(relaxed.paints).map((p) => p.strokeStyle))).toEqual(new Set([INK]))
    expect(labels(relaxed.paints).map((p) => p.fillStyle)).toEqual([INK])
    expect(networkDerived(net).steepRails(undefined, gradient).size).toBe(1)
    expect(networkDerived(net).steepRails(undefined, { levelHeight: LEVEL_HEIGHT, maxGradient: 70 }).size).toBe(0)
  })

  it('tiers: chevrons and label in detail, the label alone in the line drawing, nothing in the schematic', () => {
    const { net } = ramp()
    const at = (scale: number) => draw(net, createCamera(200, 0, scale), options())
    expect(trackLod(8, GAUGE)).toBe('detail')
    expect(chevronStrokes(at(8).paints).length).toBeGreaterThan(0)
    expect(labels(at(8).paints)).toHaveLength(1)
    expect(trackLod(1, GAUGE)).toBe('line')
    expect(chevronStrokes(at(1).paints)).toEqual([])
    expect(labels(at(1).paints)).toHaveLength(1)
    expect(trackLod(0.3, GAUGE)).toBe('schematic')
    expect(chevronStrokes(at(0.3).paints)).toEqual([])
    expect(labels(at(0.3).paints)).toEqual([])
  })

  it('is not drawn when the display is off, and shows at every scale', () => {
    const { net } = ramp()
    const cam = createCamera(200, 0, 8)
    const off = draw(net, cam, { hideConstructionNodes: true, hideSectionBadges: true, gradient })
    expect(chevronStrokes(off.paints)).toEqual([])
    expect(labels(off.paints)).toEqual([])
    // A model railway scale: no cant, but the slopes are there
    const model = draw(net, cam, options({ inclination: { line: { ...CLASSIC_160, realScale: false } } }))
    expect(chevronStrokes(model.paints).flatMap((p) => p.path).length).toBeGreaterThan(5)
    expect(labels(model.paints).map((p) => p.text)).toEqual(['30 ‰'])
  })

  it('the chevrons go with the rails of their level, dimmed in a tunnel', () => {
    // Down to one level below ground and along it
    const { net } = new Layout().straight(100).straight(200, -1).straight(100)
    const cam = createCamera(200, 0, 8)
    const strokes = chevronStrokes(draw(net, cam, options({ gradient: { levelHeight: LEVEL_HEIGHT, maxGradient: 70 } })).paints)
    // The ramp is cut where it goes below half a level: one stroke on the ground, one in the tunnel
    expect(strokes).toHaveLength(2)
    const alphas = strokes.map((p) => p.globalAlpha).sort((a, b) => a - b)
    expect(alphas[0]).toBeCloseTo(alphas[1] * TUNNEL_ALPHA, 9)
    // All pointing up: towards −x here
    for (const sub of strokes.flatMap((p) => p.path)) expect(sub[1][0]).toBeLessThan(sub[0][0])
  })

  it('a label gives way to a section badge', () => {
    // One rail, one section: the badge stands above the middle of the rail, the label below it
    const { net } = new Layout().straight(200, 1)
    const cam = createCamera(100, 0, 4)
    const badges = { hideConstructionNodes: true, gradient, inclination: { line: CLASSIC_160 } }
    expect(labels(draw(net, cam, badges).paints).map((p) => p.text)).toEqual(['30 ‰'])
    // The badge is pushed below the track (as the gizmo of the selection does): onto the label
    const pushed = draw(net, cam, { ...badges, badgeExclusion: { x: VW / 2 - 5, y: VH / 2 - 20, w: 10, h: 20 } })
    expect(pushed.paints.some((p) => p.kind === 'fillText' && p.text!.includes('Section'))).toBe(true)
    expect(labels(pushed.paints)).toEqual([])
  })
})
