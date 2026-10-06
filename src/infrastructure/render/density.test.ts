import { beforeEach, describe, expect, it } from 'vitest'
import { createCamera } from '@infrastructure/render/camera'
import { addNode, addSegment, createNetwork, resetIdCounter, setNodesLevel } from '@domain/models/network'
import { addSpeedZone } from '@domain/models/speedZones'
import type { Network, SpeedZone } from '@domain/models/types'
import { LabelSpace } from './labelSpace'
import { networkDerived } from './networkDerived'
import { DECK_WIDTH, GAUGE, renderNetwork, type RenderNetworkOptions } from './renderer'
import {
  SPEED_ZONE_ACTIVE_ALPHA,
  SPEED_ZONE_ALPHA,
  SPEED_ZONE_BAND_GAUGES,
  SPEED_ZONE_COLOR,
  SPEED_ZONE_CROWD_BAND_GAUGES,
  SPEED_ZONE_CROWD_REACH,
  crowdedStretches,
  renderSpeedZoneMarkers,
} from './speedZoneRender'

// What keeps a dense station readable: on a yard the tracks come first. The rules are tested on
// small yards drawn by hand; a track alone, or the two tracks of a line, must stay as they were.

/** One canvas call, with the drawing state it was made in */
interface Op {
  name: string
  args: unknown[]
  strokeStyle?: unknown
  fillStyle?: unknown
  lineWidth?: number
  globalAlpha: number
}

/** Canvas context that records every call in order with its style state (the recorder of `trackLevels.test.ts`) */
function createRecordingContext(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = []
  let state: Record<string, unknown> = { globalAlpha: 1 }
  const stack: Record<string, unknown>[] = []
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
        ops.push({
          name: key,
          args,
          strokeStyle: state.strokeStyle,
          fillStyle: state.fillStyle,
          lineWidth: state.lineWidth as number | undefined,
          globalAlpha: state.globalAlpha as number,
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
const texts = (ops: Op[]): string[] => ops.filter((op) => op.name === 'fillText').map((op) => String(op.args[0]))
const boards = (ops: Op[]): string[] => texts(ops).filter((text) => /^[ZR] \d+$/.test(text))
const badges = (ops: Op[]): string[] => texts(ops).filter((text) => /^(Section|Voie) /.test(text))
/** Reach of the search for limited tracks alongside, m */
const REACH = SPEED_ZONE_CROWD_REACH * SPEED_ZONE_BAND_GAUGES * GAUGE

interface Yard {
  net: Network
  /** One rail per track, in order */
  rails: string[]
  zones: SpeedZone[]
}

/**
 * `tracks` straight tracks side by side, `spacing` metres apart, from x = 0 to x = `length`, the
 * first one along y = 0. Each carries a zone over its whole length when `speed` is given.
 */
function yard(tracks: number, spacing: number, length = 200, speed: number | null = 30): Yard {
  const net = createNetwork()
  const rails: string[] = []
  const zones: SpeedZone[] = []
  for (let i = 0; i < tracks; i++) {
    const a = addNode(net, { x: 0, y: i * spacing })
    const b = addNode(net, { x: length, y: i * spacing })
    const seg = addSegment(net, a.id, b.id)!
    rails.push(seg.id)
    if (speed !== null) zones.push(addSpeedZone(net, [{ segId: seg.id, t0: 0, t1: 1 }], speed)!)
  }
  return { net, rails, zones }
}

function draw(net: Network, scale: number, options: RenderNetworkOptions = {}, at = { x: 100, y: 0 }, selection = noSelection()): Op[] {
  const { ctx, ops } = createRecordingContext()
  renderNetwork(ctx, createCamera(at.x, at.y, scale), VW, VH, net, selection, {}, { tool: 'select', ...options })
  return ops
}

/** The zones in a crowd over one rail at least */
const crowdedZones = (net: Network, reach: number): Set<string> => new Set(crowdedStretches(net, reach).keys())

beforeEach(() => resetIdCounter())

describe('zones in a crowd', () => {
  it('a zone alone and the two tracks of a line are no crowd', () => {
    expect(crowdedZones(yard(1, 4).net, REACH).size).toBe(0)
    expect(crowdedZones(yard(2, 4).net, REACH).size).toBe(0)
  })

  it('from three limited tracks side by side, each of them is in a crowd — the outer ones too', () => {
    const three = yard(3, 4)
    expect(crowdedZones(three.net, REACH)).toEqual(new Set(three.zones.map((zone) => zone.id)))
    const eight = yard(8, 4)
    expect(crowdedZones(eight.net, REACH).size).toBe(8)
    // Platform tracks, further apart: an outer one has a single neighbour within reach, and is of the yard all the same
    expect(crowdedZones(yard(3, 7).net, REACH).size).toBe(3)
  })

  it('tracks too far apart for their bands to meet are no crowd', () => {
    expect(crowdedZones(yard(5, 12).net, REACH).size).toBe(0)
  })

  it('a track without zone does not count', () => {
    const { net, rails } = yard(3, 4, 200, null)
    addSpeedZone(net, [{ segId: rails[0], t0: 0, t1: 1 }], 30)
    addSpeedZone(net, [{ segId: rails[1], t0: 0, t1: 1 }], 30)
    expect(crowdedZones(net, REACH).size).toBe(0)
  })

  it('two zones end to end on the track next door are one track', () => {
    const { net, rails } = yard(2, 4, 200, null)
    const long = addSpeedZone(net, [{ segId: rails[0], t0: 0, t1: 1 }], 30)!
    addSpeedZone(net, [{ segId: rails[1], t0: 0, t1: 0.5 }], 30)
    addSpeedZone(net, [{ segId: rails[1], t0: 0.5, t1: 1 }], 60)
    expect(crowdedZones(net, REACH).has(long.id)).toBe(false)
  })

  it('a track that crosses is not alongside', () => {
    const { net, zones } = yard(2, 4)
    // Two tracks across the yard, at right angles
    for (const x of [90, 94]) {
      const a = addNode(net, { x, y: -50 })
      const b = addNode(net, { x, y: 50 })
      const seg = addSegment(net, a.id, b.id)!
      addSpeedZone(net, [{ segId: seg.id, t0: 0, t1: 1 }], 30)
    }
    expect(crowdedZones(net, REACH).has(zones[0].id)).toBe(false)
  })

  it('a line that runs past a yard is in a crowd along the yard only', () => {
    const net = createNetwork()
    // A line of two rails, x 0 → 200 → 400; two yard tracks beside its second rail only
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 200, y: 0 })
    const c = addNode(net, { x: 400, y: 0 })
    const first = addSegment(net, a.id, b.id)!
    const second = addSegment(net, b.id, c.id)!
    const line = addSpeedZone(net, [{ segId: first.id, t0: 0, t1: 1 }, { segId: second.id, t0: 0, t1: 1 }], 90)!
    for (const y of [4, 8]) {
      const from = addNode(net, { x: 200, y })
      const to = addNode(net, { x: 400, y })
      const seg = addSegment(net, from.id, to.id)!
      addSpeedZone(net, [{ segId: seg.id, t0: 0, t1: 1 }], 30)
    }
    const crowded = crowdedStretches(net, REACH)
    expect([...(crowded.get(line.id) ?? [])]).toEqual([second.id])
  })

  it('a short rail at the end of the yard goes with it: no stub of band is left', () => {
    const net = createNetwork()
    // A line of three rails, x 0 → 200 → 210 → 400; two yard tracks beside the first one only
    const xs = [0, 200, 210, 400]
    const nodes = xs.map((x) => addNode(net, { x, y: 0 }))
    const rails = [0, 1, 2].map((i) => addSegment(net, nodes[i].id, nodes[i + 1].id)!)
    const line = addSpeedZone(net, rails.map((seg) => ({ segId: seg.id, t0: 0, t1: 1 })), 90)!
    for (const y of [4, 8]) {
      const from = addNode(net, { x: 0, y })
      const to = addNode(net, { x: 200, y })
      const seg = addSegment(net, from.id, to.id)!
      addSpeedZone(net, [{ segId: seg.id, t0: 0, t1: 1 }], 30)
    }
    expect([...(crowdedStretches(net, REACH).get(line.id) ?? [])].sort()).toEqual([rails[0].id, rails[1].id].sort())
  })

  it('needs the tracks alongside over half of the rail', () => {
    const { net, rails } = yard(3, 4, 200, null)
    const long = addSpeedZone(net, [{ segId: rails[0], t0: 0, t1: 1 }], 30)!
    // The two other tracks are limited over 20 m only: the long zone is not in a crowd, they are
    const short1 = addSpeedZone(net, [{ segId: rails[1], t0: 0.5, t1: 0.6 }], 30)!
    const short2 = addSpeedZone(net, [{ segId: rails[2], t0: 0.5, t1: 0.6 }], 30)!
    const crowded = crowdedZones(net, REACH)
    expect(crowded.has(long.id)).toBe(false)
    expect(crowded.has(short1.id)).toBe(true)
    expect(crowded.has(short2.id)).toBe(true)
  })
})

describe('bands of the speed zones on a yard', () => {
  const SCALE = 6
  const wide = SPEED_ZONE_BAND_GAUGES * GAUGE * SCALE
  const narrow = SPEED_ZONE_CROWD_BAND_GAUGES * GAUGE * SCALE
  /** Strokes of a band, wide or narrow, at a scale (a section stripe may have the colour of the bands: the width tells them apart) */
  const bandStrokes = (ops: Op[], scale = SCALE) => ops.filter((op) => op.name === 'stroke' && op.strokeStyle === SPEED_ZONE_COLOR &&
    (near(op.lineWidth!, SPEED_ZONE_BAND_GAUGES * GAUGE * scale) || near(op.lineWidth!, SPEED_ZONE_CROWD_BAND_GAUGES * GAUGE * scale) || near(op.lineWidth!, 5)))

  it('one track, or the two tracks of a line: the wide band, as ever', () => {
    for (const tracks of [1, 2]) {
      const bands = bandStrokes(draw(yard(tracks, 4).net, SCALE))
      expect(bands).toHaveLength(1)
      expect(near(bands[0].lineWidth!, wide)).toBe(true)
      expect(bands[0].globalAlpha).toBeCloseTo(SPEED_ZONE_ALPHA)
    }
  })

  it('a yard: no band at all with another tool in hand, nor while driving', () => {
    const { net } = yard(5, 4)
    expect(bandStrokes(draw(net, SCALE))).toEqual([])
    expect(bandStrokes(draw(net, SCALE, { tool: 'place' }))).toEqual([])
    expect(bandStrokes(draw(net, SCALE, { hideConstructionNodes: true, hideSectionBadges: true }))).toEqual([])
  })

  it('a yard under the signalling tool: every zone gets a band that stays between its own rails', () => {
    const { net } = yard(5, 4)
    const bands = bandStrokes(draw(net, SCALE, { speedZones: { selectedId: null, dangerId: null } }))
    // One stroke for all of them
    expect(bands).toHaveLength(1)
    expect(near(bands[0].lineWidth!, narrow)).toBe(true)
    // Narrower than the track it lies on: paper shows between two tracks
    expect(bands[0].lineWidth!).toBeLessThanOrEqual(GAUGE * SCALE)
    expect(bands[0].globalAlpha).toBeCloseTo(SPEED_ZONE_ALPHA)
  })

  it('the zone picked keeps its wide band, whatever the tool', () => {
    const { net, zones } = yard(5, 4)
    const bands = bandStrokes(draw(net, SCALE, { speedZones: { selectedId: zones[2].id, dangerId: null } }))
    expect(bands.map((op) => near(op.lineWidth!, wide))).toEqual([false, true])
    expect(bands[1].globalAlpha).toBeCloseTo(SPEED_ZONE_ACTIVE_ALPHA)
  })

  it('once a track is a single line the narrow band is gone, the tool in hand or not', () => {
    const { net, zones } = yard(5, 4)
    expect(bandStrokes(draw(net, 1, { speedZones: { selectedId: null, dangerId: null } }), 1)).toEqual([])
    // The zone picked is still shown
    expect(bandStrokes(draw(net, 1, { speedZones: { selectedId: zones[0].id, dangerId: null } }), 1)).toHaveLength(1)
  })
})

describe('boards of the speed zones', () => {
  const SCALE = 6

  it('no board where a zone of the same speed carries on: the limit is announced once', () => {
    const { net, rails } = yard(1, 4, 100, null)
    addSpeedZone(net, [{ segId: rails[0], t0: 0.1, t1: 0.5 }], 60)
    addSpeedZone(net, [{ segId: rails[0], t0: 0.5, t1: 0.9 }], 60)
    expect(boards(draw(net, SCALE, {}, { x: 50, y: 0 }))).toEqual(['Z 60', 'R 60'])
  })

  it('a change of speed keeps its two boards', () => {
    const { net, rails } = yard(1, 4, 100, null)
    addSpeedZone(net, [{ segId: rails[0], t0: 0.1, t1: 0.5 }], 60)
    addSpeedZone(net, [{ segId: rails[0], t0: 0.5, t1: 0.9 }], 30)
    // Two boards stand at the change (« R 60 » and « Z 30 »): one of them is written, as a board never covers another
    const shown = boards(draw(net, SCALE, {}, { x: 50, y: 0 }))
    expect(shown).toHaveLength(3)
    expect(shown).toContain('Z 60')
    expect(shown).toContain('R 30')
  })

  it('zones on two tracks that end side by side are not one carrying on from the other', () => {
    const { net } = yard(2, 4, 100, 60)
    expect(boards(draw(net, SCALE, {}, { x: 50, y: 0 })).sort()).toEqual(['R 60', 'R 60', 'Z 60', 'Z 60'])
  })

  it('the zone picked shows its two boards even where the limit carries on', () => {
    const { net, rails } = yard(1, 4, 100, null)
    const first = addSpeedZone(net, [{ segId: rails[0], t0: 0.1, t1: 0.5 }], 60)!
    addSpeedZone(net, [{ segId: rails[0], t0: 0.5, t1: 0.9 }], 60)
    const shown = boards(draw(net, SCALE, { speedZones: { selectedId: first.id, dangerId: null } }, { x: 50, y: 0 }))
    expect(shown.filter((text) => text === 'Z 60')).toHaveLength(1)
    expect(shown.filter((text) => text === 'R 60')).toHaveLength(2)
  })

  it('a yard: the boards come with the signalling tool, like the bands', () => {
    const { net } = yard(5, 6, 100)
    expect(boards(draw(net, SCALE, {}, { x: 50, y: 12 }))).toEqual([])
    expect(boards(draw(net, SCALE, { speedZones: { selectedId: null, dangerId: null } }, { x: 50, y: 12 })).length).toBeGreaterThan(0)
  })

  it('a board gives way to what already stands there; the zone picked keeps its own', () => {
    const { net, zones } = yard(1, 4, 100)
    const cam = createCamera(50, 0, SCALE)
    const key = networkDerived(net, {})
    const shown = (space: LabelSpace | undefined, selectedId: string | null = null): string[] => {
      const { ctx, ops } = createRecordingContext()
      renderSpeedZoneMarkers(ctx, cam, VW, VH, net, key, {
        gauge: GAUGE, showOverlaps: false, space, highlight: selectedId ? { selectedId } : undefined,
      })
      return boards(ops)
    }
    expect(shown(undefined)).toEqual(['Z 30', 'R 30'])
    // Something stands over the start of the zone (world x = 0, screen x = 100), above the track
    const taken = (): LabelSpace => {
      const space = new LabelSpace()
      space.reserve({ x: 60, y: VH / 2 - 60, w: 80, h: 60 })
      return space
    }
    expect(shown(taken())).toEqual(['R 30'])
    expect(shown(taken(), zones[0].id)).toEqual(['Z 30', 'R 30'])
    // The boards drawn take their room: nothing else is written over them afterwards
    const space = new LabelSpace()
    shown(space)
    expect(space.isFree({ x: 95, y: VH / 2 - 25, w: 10, h: 10 })).toBe(false)
  })
})

describe('section badges on a yard', () => {
  const SCALE = 4

  it('one track, two tracks: each section has its badge', () => {
    expect(badges(draw(yard(1, 6, 200, null).net, SCALE))).toHaveLength(1)
    expect(badges(draw(yard(2, 6, 200, null).net, SCALE))).toHaveLength(2)
  })

  it('a crowd of tracks: the badges nobody asked for wait for a closer look', () => {
    const { net } = yard(8, 6, 200, null)
    expect(badges(draw(net, SCALE, {}, { x: 100, y: 21 }))).toEqual([])
    // Closer, the same tracks are further apart on screen: fewer of them around each badge
    expect(badges(draw(net, 40, {}, { x: 100, y: 21 })).length).toBeGreaterThan(0)
  })

  it('the section picked and the ones the user named keep their badge in the crowd', () => {
    const { net, rails } = yard(8, 6, 200, null)
    const sections = networkDerived(net, {}).sections
    const picked = { nodes: new Set<string>(), segments: new Set([rails[3]]) }
    const withPicked = badges(draw(net, SCALE, {}, { x: 100, y: 21 }, picked))
    expect(withPicked).toHaveLength(1)

    const named = sections.find((sec) => sec.segmentIds.includes(rails[5]))!
    const { ctx, ops } = createRecordingContext()
    renderNetwork(ctx, createCamera(100, 21, SCALE), VW, VH, net, noSelection(), { [named.id]: { name: 'Voie 6' } }, { tool: 'select' })
    expect(badges(ops)).toHaveLength(1)
    expect(badges(ops)[0]).toContain('Voie 6')
  })
})

describe('a bridge in the rails drawing', () => {
  /** A track along y = 0 on the ground and one across it along x = 100, one level up */
  function bridge(): Network {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 200, y: 0 })
    addSegment(net, a.id, b.id)
    const c = addNode(net, { x: 100, y: -50 })
    const d = addNode(net, { x: 100, y: 50 })
    addSegment(net, c.id, d.id)
    setNodesLevel(net, [c.id, d.id], 1)
    return net
  }
  const deckStrokes = (ops: Op[], scale: number) =>
    ops.flatMap((op, i) => (op.name === 'stroke' && near(op.lineWidth ?? 0, DECK_WIDTH * scale) ? [i] : []))

  it('gets its deck as soon as the two rails are drawn, laid over the track below', () => {
    // 2.6 px/m: the rails tier
    const ops = draw(bridge(), 2.6)
    const deck = deckStrokes(ops, 2.6)
    expect(deck.length).toBeGreaterThan(0)
    // The ground track is stroked before the deck: it passes under
    const firstStroke = ops.findIndex((op) => op.name === 'stroke')
    expect(firstStroke).toBeLessThan(deck[0])
  })

  it('has none once a track is a single line: the edging of the line stands for it', () => {
    expect(deckStrokes(draw(bridge(), 1), 1)).toEqual([])
  })
})

describe('joints on a yard', () => {
  /** A track of `rails` rails from x = 0 to x = 100: `rails − 1` plain joints, all in view, one of them at x = 50 */
  function manyJoints(rails: number): Network {
    const net = createNetwork()
    let prev = addNode(net, { x: 0, y: 0 })
    for (let i = 1; i <= rails; i++) {
      const next = addNode(net, { x: (i * 100) / rails, y: 0 })
      addSegment(net, prev.id, next.id)
      prev = next
    }
    return net
  }
  /** Radius of the outer disc of the joint at world x = `x` (camera on x = 50, 6 px/m) */
  const jointRadius = (ops: Op[], x: number): number => {
    const sx = (x - 50) * 6 + VW / 2
    const arcs = ops.filter((op) => op.name === 'arc' && near(op.args[0] as number, sx) && near(op.args[1] as number, VH / 2))
    return Math.max(...arcs.map((op) => op.args[2] as number))
  }

  it('a few joints: the dot at its full size', () => {
    expect(jointRadius(draw(manyJoints(100), 6, {}, { x: 50, y: 0 }), 50)).toBe(4)
  })

  it('several hundred in view: smaller dots, never under half the size', () => {
    const some = jointRadius(draw(manyJoints(400), 6, {}, { x: 50, y: 0 }), 50)
    expect(some).toBeLessThan(4)
    expect(some).toBeGreaterThan(2)
    expect(jointRadius(draw(manyJoints(3000), 6, {}, { x: 50, y: 0 }), 50)).toBe(2)
  })
})
