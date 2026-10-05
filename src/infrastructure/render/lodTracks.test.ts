import { describe, expect, it } from 'vitest'
import { createCamera } from '@infrastructure/render/camera'
import { createNetwork, addNode, addSegment, addCurveSegment } from '@domain/models/network'
import type { Network } from '@domain/models/types'
import { groupPiecesByLevel } from '@infrastructure/render/levelPieces'
import { LOD_LINE_BELOW_PX, trackLod } from '@infrastructure/render/lod'
import { networkDerived } from '@infrastructure/render/networkDerived'
import { GAUGE, RAIL_WIDTH, TUNNEL_ALPHA, TUNNEL_DASH, getViewportBounds, renderNetwork } from '@infrastructure/render/renderer'
import {
  CLOSED_BRANCH_ALPHA,
  LINE_HALO_EXTRA,
  LINE_MIN_WIDTH,
  SCHEMATIC_LINE_WIDTH,
  decimatePolyline,
  lineTrackWidth,
  renderLineTracks,
  renderSchematicTracks,
} from '@infrastructure/render/lodTracks'

const VW = 800
const VH = 600
const RAIL = '#526071'
const ACCENT = '#2563eb'
const PAPER = '#ffffff'

interface Stroke {
  strokeStyle: unknown
  lineWidth: number
  globalAlpha: number
  lineCap: unknown
  dash: number[]
  /** Path calls since the last `beginPath` */
  path: { name: string; args: number[] }[]
}

/** Canvas that records each stroke with its style and the path it strokes; `save`/`restore` keep a real stack */
function recorder(): { ctx: CanvasRenderingContext2D; strokes: Stroke[]; calls: Record<string, number> } {
  const strokes: Stroke[] = []
  const calls: Record<string, number> = {}
  let state: Record<string, unknown> = { globalAlpha: 1, dash: [], lineWidth: 1 }
  const stack: Record<string, unknown>[] = []
  let path: Stroke['path'] = []
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined
      if (key === 'canvas') return undefined
      if (key === 'measureText') return () => ({ width: 60 })
      if (key in state) return state[key]
      return (...args: unknown[]) => {
        calls[key] = (calls[key] ?? 0) + 1
        if (key === 'save') stack.push({ ...state })
        else if (key === 'restore') state = stack.pop() ?? state
        else if (key === 'setLineDash') state.dash = args[0]
        else if (key === 'beginPath') path = []
        else if (key === 'moveTo' || key === 'lineTo' || key === 'quadraticCurveTo') path.push({ name: key, args: args as number[] })
        else if (key === 'stroke') {
          strokes.push({
            strokeStyle: state.strokeStyle,
            lineWidth: state.lineWidth as number,
            globalAlpha: state.globalAlpha as number,
            lineCap: state.lineCap,
            dash: state.dash as number[],
            path,
          })
        }
      }
    },
    set(_target, key, value) {
      state[key as string] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, strokes, calls }
}

const noSelection = () => ({ nodes: new Set<string>(), segments: new Set<string>() })

/** `lines` parallel tracks of `perLine` rails of 30 m, one rail in three curved */
function yard(lines: number, perLine: number, level = 0): { net: Network; segIds: string[] } {
  const net = createNetwork()
  const segIds: string[] = []
  for (let l = 0; l < lines; l++) {
    let prev = addNode(net, { x: 0, y: l * 6 }, level)
    for (let i = 1; i <= perLine; i++) {
      const next = addNode(net, { x: i * 30, y: l * 6 }, level)
      const seg = i % 3 === 0
        ? addCurveSegment(net, prev.id, next.id, { x: i * 30 - 15, y: l * 6 + 0.3 })!
        : addSegment(net, prev.id, next.id)!
      segIds.push(seg.id)
      prev = next
    }
  }
  return { net, segIds }
}

function drawLine(net: Network, scale: number, selected: string[] = []) {
  const rec = recorder()
  const cam = createCamera(0, 0, scale)
  for (const group of groupPiecesByLevel(net, net.segments.values())) {
    renderLineTracks(rec.ctx, cam, VW, VH, net, group.pieces, group.level, new Set(selected), { rail: RAIL, accent: ACCENT, paper: PAPER })
  }
  return rec
}

describe('line tier', () => {
  it('lineTrackWidth: the gauge plus one rail, as wide as the two rails were, never under the floor', () => {
    const atThreshold = LOD_LINE_BELOW_PX / GAUGE
    expect(lineTrackWidth(atThreshold)).toBeCloseTo(LOD_LINE_BELOW_PX + Math.max(1.2, RAIL_WIDTH * atThreshold))
    expect(lineTrackWidth(1)).toBeCloseTo(GAUGE + 1.2)
    expect(lineTrackWidth(0.01)).toBe(LINE_MIN_WIDTH)
  })

  it('strokes once whatever the number of rails', () => {
    for (const [lines, perLine] of [[1, 3], [10, 30]] as const) {
      const { net } = yard(lines, perLine)
      const { strokes } = drawLine(net, 1)
      expect(strokes).toHaveLength(1)
      expect(strokes[0]).toMatchObject({ strokeStyle: RAIL, lineWidth: lineTrackWidth(1), globalAlpha: 1, lineCap: 'round', dash: [] })
      // One sub-path per rail, on its centre line: curves stay curves
      const { path } = strokes[0]
      expect(path.filter((c) => c.name === 'moveTo')).toHaveLength(lines * perLine)
      expect(path.filter((c) => c.name === 'quadraticCurveTo')).toHaveLength(lines * Math.floor(perLine / 3))
      expect(path.filter((c) => c.name === 'lineTo')).toHaveLength(lines * (perLine - Math.floor(perLine / 3)))
    }
  })

  it('traces a rail from node to node through the control point of its curve', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 30, y: 0 })
    const c = addNode(net, { x: 60, y: 10 })
    addSegment(net, a.id, b.id)
    addCurveSegment(net, b.id, c.id, { x: 45, y: 0 })
    const { strokes } = drawLine(net, 2)
    expect(strokes[0].path).toEqual([
      { name: 'moveTo', args: [400, 300] },
      { name: 'lineTo', args: [460, 300] },
      { name: 'moveTo', args: [460, 300] },
      { name: 'quadraticCurveTo', args: [490, 300, 520, 320] },
    ])
  })

  it('selected rails: one more stroke in the accent colour, drawn last', () => {
    const { net, segIds } = yard(10, 30)
    const { strokes } = drawLine(net, 1, segIds.slice(0, 40))
    expect(strokes.map((s) => s.strokeStyle)).toEqual([RAIL, ACCENT])
    expect(strokes[1].path.filter((c) => c.name === 'moveTo')).toHaveLength(40)
    expect(strokes[0].path.filter((c) => c.name === 'moveTo')).toHaveLength(260)
  })

  it('closed turnout branch: its first metres in a dimmed stroke, the rest with the open rails', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const c = addNode(net, { x: 200, y: 0 })
    const d = addNode(net, { x: 200, y: 12 })
    const stem = addSegment(net, a.id, b.id)!
    const through = addSegment(net, b.id, c.id)!
    const branch = addSegment(net, b.id, d.id)!
    net.junctions.set('j_test', {
      id: 'j_test',
      nodeId: b.id,
      kind: 'turnout',
      passages: [{ a: stem.id, b: through.id }, { a: stem.id, b: branch.id }],
      positions: [[0], [1]],
      active: 0,
    })
    const { strokes } = drawLine(net, 1)
    expect(strokes.map((s) => s.globalAlpha)).toEqual([CLOSED_BRANCH_ALPHA, 1])
    expect(strokes[0].path.filter((c) => c.name === 'moveTo')).toHaveLength(1)
    // Stem, through rail and the open end of the branch
    expect(strokes[1].path.filter((c) => c.name === 'moveTo')).toHaveLength(3)
    // The dimmed part starts at the points
    expect(strokes[0].path[0].args).toEqual([VW / 2 + 100, VH / 2])
  })

  it('tunnel: dimmed and dashed', () => {
    const { net } = yard(4, 6, -1)
    const { strokes } = drawLine(net, 1)
    expect(strokes).toHaveLength(1)
    expect(strokes[0].globalAlpha).toBe(TUNNEL_ALPHA)
    expect(strokes[0].dash).toEqual(TUNNEL_DASH)
  })

  it('above ground: one edging in the background colour under the rails of the level, then the rails', () => {
    const { net } = yard(4, 6, 1)
    const { strokes } = drawLine(net, 1)
    expect(strokes).toHaveLength(2)
    expect(strokes[0]).toMatchObject({ strokeStyle: PAPER, lineWidth: lineTrackWidth(1) + LINE_HALO_EXTRA, lineCap: 'butt', globalAlpha: 1 })
    expect(strokes[1]).toMatchObject({ strokeStyle: RAIL, lineWidth: lineTrackWidth(1) })
    expect(strokes[0].path).toHaveLength(strokes[1].path.length)
  })

  it('leaves the canvas state as it found it', () => {
    const { net } = yard(2, 3, -1)
    const { ctx, calls } = drawLine(net, 1)
    expect(calls.save).toBe(calls.restore)
    expect(ctx.globalAlpha).toBe(1)
    expect((ctx as unknown as { dash: number[] }).dash).toEqual([])
  })
})

describe('renderNetwork by tier', () => {
  /** Strokes of the rails: the overlays are left out with `part: 'tracks'` */
  function tracks(net: Network, scale: number, x = 150, y = 15) {
    const rec = recorder()
    renderNetwork(rec.ctx, createCamera(x, y, scale), VW, VH, net, noSelection(), {}, { tool: 'select', part: 'tracks' })
    return rec
  }

  it('line tier: the number of strokes does not follow the number of rails, and no joint is drawn', () => {
    const small = tracks(yard(2, 5).net, 1)
    const large = tracks(yard(6, 20).net, 1)
    expect(trackLod(1, GAUGE)).toBe('line')
    expect(small.strokes).toHaveLength(1)
    expect(large.strokes).toHaveLength(1)
    expect(large.calls.fill).toBeUndefined()
    expect(large.calls.arc).toBeUndefined()
  })

  it('detail tier: still two rails and their heads per rail, the section stripe and the joints', () => {
    const scale = 8
    expect(trackLod(scale, GAUGE)).toBe('detail')
    const { net } = yard(1, 2)
    const { strokes } = tracks(net, scale, 30, 0)
    const railPx = Math.max(1.2, RAIL_WIDTH * scale)
    // Per rail: the stripe of its section, the two rails, their heads
    expect(strokes.filter((s) => s.strokeStyle === RAIL && s.lineWidth === railPx && s.lineCap === 'butt')).toHaveLength(2)
    // The heads of the rails, and those of the joint between the two
    expect(strokes.filter((s) => s.strokeStyle === '#ffffff').length).toBeGreaterThanOrEqual(2)
    expect(strokes.length).toBeGreaterThan(6)
    // The two rails of a straight: one path, either side of the centre line
    const rails = strokes.find((s) => s.strokeStyle === RAIL && s.lineWidth === railPx)!
    expect(rails.path.map((c) => c.name)).toEqual(['moveTo', 'lineTo', 'moveTo', 'lineTo'])
    expect(rails.path[0].args[1]).toBeCloseTo(VH / 2 + (GAUGE / 2) * scale)
    expect(rails.path[2].args[1]).toBeCloseTo(VH / 2 - (GAUGE / 2) * scale)
  })

  it('schematic tier: one stroke per section colour, whatever the number of rails', () => {
    const scale = 0.1
    expect(trackLod(scale, GAUGE)).toBe('schematic')
    const { net } = yard(20, 30)
    const { strokes } = tracks(net, scale)
    const colors = new Set(networkDerived(net, {}).sections.map((sec) => sec.color))
    expect(strokes).toHaveLength(colors.size)
    expect(strokes.length).toBeLessThanOrEqual(20)
    for (const s of strokes) expect(s.lineWidth).toBe(SCHEMATIC_LINE_WIDTH)
    // Every rail is 3 px long here, so each one keeps its end: a point per node, no more
    const points = strokes.reduce((n, s) => n + s.path.length, 0)
    expect(points).toBe(20 * 31)
  })
})

describe('schematic tier', () => {
  it('decimatePolyline: drops the points closer than a pixel to the last one kept, keeps both ends', () => {
    // 0.1 px/m: points 4 m apart are 0.4 px apart
    const world: number[] = []
    for (let i = 0; i <= 100; i++) world.push(i * 4, 0)
    const out: number[] = []
    const kept = decimatePolyline(world, 0.1, 400, 300, out)
    expect(out.length).toBe(kept * 2)
    // 40 px of track: a point every 1.2 px (three steps), and the end
    expect(kept).toBe(35)
    expect(out.slice(0, 2)).toEqual([400, 300])
    expect(out.slice(-2)).toEqual([440, 300])
    for (let i = 1; i < kept - 1; i++) expect(out[2 * i] - out[2 * i - 2]).toBeGreaterThanOrEqual(1)
  })

  it('decimatePolyline: a line shorter than a pixel keeps its two ends', () => {
    const out: number[] = []
    expect(decimatePolyline([0, 0, 1, 0, 2, 0], 0.1, 0, 0, out)).toBe(2)
    expect(out).toEqual([0, 0, 0.2, 0])
  })

  function drawSchematic(net: Network, scale: number, selected: string[] = [], camX = 0) {
    const rec = recorder()
    const cam = createCamera(camX, 0, scale)
    const derived = networkDerived(net)
    const selectedSections = new Set(selected.map((sid) => derived.sectionOfSegment.get(sid)!))
    renderSchematicTracks(rec.ctx, cam, VW, VH, derived.sectionPolylines(), getViewportBounds(cam, VW, VH, 80), selectedSections, { accent: ACCENT })
    return { ...rec, derived }
  }

  it('one path per colour, each section a single run of points', () => {
    const { net } = yard(12, 40)
    const { strokes, derived } = drawSchematic(net, 0.02)
    expect(derived.sections).toHaveLength(12)
    expect(strokes).toHaveLength(new Set(derived.sections.map((s) => s.color)).size)
    expect(strokes.reduce((n, s) => n + s.path.filter((c) => c.name === 'moveTo').length, 0)).toBe(12)
    // 1 200 m of track is 24 px: about a point per pixel, not one per rail end
    for (const s of strokes) {
      const perSection = s.path.length / s.path.filter((c) => c.name === 'moveTo').length
      expect(perSection).toBeLessThanOrEqual(26)
      expect(s.strokeStyle).not.toBe(ACCENT)
    }
  })

  it('a selected section is drawn last, in the accent colour', () => {
    const { net, segIds } = yard(3, 4)
    const { strokes } = drawSchematic(net, 0.1, [segIds[0]])
    const last = strokes[strokes.length - 1]
    expect(last.strokeStyle).toBe(ACCENT)
    expect(last.path.filter((c) => c.name === 'moveTo')).toHaveLength(1)
    expect(strokes.slice(0, -1).map((s) => s.strokeStyle)).not.toContain(ACCENT)
  })

  it('a section out of the viewport is not traced', () => {
    const { net } = yard(3, 4)
    // 120 m of track around x = 60, seen from 100 km away
    const { strokes, calls } = drawSchematic(net, 0.1, [], 100000)
    expect(strokes).toHaveLength(0)
    expect(calls.moveTo).toBeUndefined()
  })

  it('a section below ground is dimmed', () => {
    const { net } = yard(1, 4, -1)
    const { strokes } = drawSchematic(net, 0.1)
    expect(strokes.map((s) => s.globalAlpha)).toEqual([TUNNEL_ALPHA])
  })

  it('straight runs only: no curve is traced, no dash is set', () => {
    const { net } = yard(2, 9)
    const { calls } = drawSchematic(net, 0.1)
    expect(calls.quadraticCurveTo).toBeUndefined()
    expect(calls.setLineDash).toBeUndefined()
    expect(calls.save).toBe(calls.restore)
  })
})
