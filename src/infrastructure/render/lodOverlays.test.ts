import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCamera } from '@infrastructure/render/camera'
import { addNode, addSegment, createNetwork, resetIdCounter } from '@domain/models/network'
import type { Network } from '@domain/models/types'
import type { SectionMetadata } from '@domain/models/sections'
import { GAUGE, renderNetwork } from './renderer'
import { networkDerived } from './networkDerived'
import { gaugeOnScreen, trackLod } from './lod'
import {
  BADGES_ALL_FROM_PX,
  BADGE_FULL_FROM_PX,
  DIAGNOSTIC_CLUSTER_RADIUS_PX,
  DIAGNOSTIC_LABEL_FROM_PX,
  clusterMarkers,
  placeBadges,
  sectionArrowSegments,
  sectionBadgeWanted,
  type BadgeBox,
} from './lodOverlays'

/** Camera scales at 1:1 that fall in each tier */
const DETAIL = 2.5
const LINE = 1.0
const SCHEMATIC = 0.2

const VW = 800
const VH = 600

/** Mock context that also records every stroke colour, to recognise the red bar of a buffer stop */
function createMockContext(): CanvasRenderingContext2D & { strokeStyles: string[] } {
  const strokeStyles: string[] = []
  const ctx = {
    canvas: { width: VW, height: VH },
    strokeStyles,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    setLineDash: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    closePath: vi.fn(),
    quadraticCurveTo: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 60 }),
    fillText: vi.fn(),
  }
  Object.defineProperty(ctx, 'strokeStyle', {
    set: (v: string) => { strokeStyles.push(v) },
    get: () => strokeStyles[strokeStyles.length - 1],
  })
  return ctx as unknown as CanvasRenderingContext2D & { strokeStyles: string[] }
}

const noSelection = () => ({ nodes: new Set<string>(), segments: new Set<string>() })
const texts = (ctx: CanvasRenderingContext2D): string[] =>
  vi.mocked(ctx.fillText).mock.calls.map((c) => String(c[0]))
/** Radii of the discs drawn at one screen point */
const radiiAt = (ctx: CanvasRenderingContext2D, x: number, y: number): number[] =>
  vi.mocked(ctx.arc).mock.calls
    .filter((c) => Math.abs(c[0] - x) < 1e-6 && Math.abs(c[1] - y) < 1e-6)
    .map((c) => c[2])

const box = (x: number, over: Partial<BadgeBox> = {}): BadgeBox =>
  ({ x, y: 0, w: 50, h: 18, selected: false, renamed: false, length: 100, ...over })

describe('thresholds of the overlays (gauge on screen)', () => {
  it('fall on the camera scales they were tuned for at 1:1', () => {
    expect(gaugeOnScreen(1.0, GAUGE)).toBe(BADGES_ALL_FROM_PX)
    expect(gaugeOnScreen(3.0, GAUGE)).toBe(BADGE_FULL_FROM_PX)
    expect(gaugeOnScreen(0.9, GAUGE)).toBe(DIAGNOSTIC_LABEL_FROM_PX)
  })

  it('the test scales are one per tier', () => {
    expect(trackLod(DETAIL, GAUGE)).toBe('detail')
    expect(trackLod(LINE, GAUGE)).toBe('line')
    expect(trackLod(SCHEMATIC, GAUGE)).toBe('schematic')
  })
})

describe('sectionBadgeWanted', () => {
  it('wants every section from the overview on', () => {
    expect(sectionBadgeWanted(BADGES_ALL_FROM_PX, { selected: false, renamed: false })).toBe(true)
  })

  it('keeps only the selected and the renamed sections further out', () => {
    const px = BADGES_ALL_FROM_PX * 0.99
    expect(sectionBadgeWanted(px, { selected: false, renamed: false })).toBe(false)
    expect(sectionBadgeWanted(px, { selected: true, renamed: false })).toBe(true)
    expect(sectionBadgeWanted(px, { selected: false, renamed: true })).toBe(true)
    expect(sectionBadgeWanted(0.1, { selected: false, renamed: true })).toBe(true)
  })
})

describe('sectionArrowSegments', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']

  it('gives every rail in the detail tier', () => {
    expect(sectionArrowSegments('detail', ids)).toEqual(ids)
  })

  it('gives the middle rail alone in the line tier', () => {
    expect(sectionArrowSegments('line', ids)).toEqual(['c'])
    expect(sectionArrowSegments('line', ['a'])).toEqual(['a'])
    expect(sectionArrowSegments('line', [])).toEqual([])
  })

  it('gives none in the schematic tier', () => {
    expect(sectionArrowSegments('schematic', ids)).toEqual([])
  })
})

describe('placeBadges', () => {
  it('keeps every badge when none overlaps', () => {
    const boxes = [box(0), box(60), box(120)]
    expect(placeBadges(boxes)).toEqual(boxes)
  })

  it('does not count touching edges as an overlap', () => {
    expect(placeBadges([box(0), box(50)])).toHaveLength(2)
  })

  it('drops the shorter of two overlapping badges', () => {
    const short = box(0, { length: 50 })
    const long = box(20, { length: 300 })
    expect(placeBadges([short, long])).toEqual([long])
  })

  it('ranks selected over renamed over length', () => {
    const longest = box(0, { length: 1000 })
    const renamed = box(10, { renamed: true, length: 10 })
    const selected = box(20, { selected: true, length: 1 })
    expect(placeBadges([longest, renamed, selected])).toEqual([selected])
    expect(placeBadges([longest, renamed])).toEqual([renamed])
  })

  it('keeps the first of two equal badges', () => {
    const first = box(0)
    expect(placeBadges([first, box(10)])).toEqual([first])
  })

  it('never keeps two badges that overlap, and tests against the kept ones only', () => {
    // b is hidden by a; c overlaps b but not a, so it is kept
    const a = box(0, { length: 300 })
    const b = box(40, { length: 200 })
    const c = box(80, { length: 100 })
    expect(placeBadges([a, b, c])).toEqual([a, c])
  })

  it('compares both axes', () => {
    expect(placeBadges([box(0), box(0, { y: 18 })])).toHaveLength(2)
    expect(placeBadges([box(0), box(0, { y: 17 })])).toHaveLength(1)
  })

  it('returns the kept badges in the order they came', () => {
    const a = box(0, { length: 1 })
    const b = box(200, { selected: true })
    const c = box(100, { length: 500 })
    expect(placeBadges([a, b, c])).toEqual([a, b, c])
  })
})

describe('clusterMarkers', () => {
  const R = DIAGNOSTIC_CLUSTER_RADIUS_PX

  it('leaves distant markers alone', () => {
    const out = clusterMarkers([
      { x: 0, y: 0, severity: 'warning' },
      { x: 100, y: 0, severity: 'error' },
    ], R)
    expect(out).toEqual([
      { x: 0, y: 0, severity: 'warning', count: 1 },
      { x: 100, y: 0, severity: 'error', count: 1 },
    ])
  })

  it('merges close markers at their mean, with the count', () => {
    const out = clusterMarkers([
      { x: 0, y: 0, severity: 'warning' },
      { x: 20, y: 0, severity: 'warning' },
      { x: 10, y: 15, severity: 'warning' },
    ], R)
    expect(out).toHaveLength(1)
    expect(out[0].count).toBe(3)
    expect(out[0].x).toBeCloseTo(10)
    expect(out[0].y).toBeCloseTo(5)
    expect(out[0].severity).toBe('warning')
  })

  it('takes the worst severity of the group, whatever the order', () => {
    const w = { x: 0, y: 0, severity: 'warning' as const }
    const e = { x: 5, y: 0, severity: 'error' as const }
    expect(clusterMarkers([w, e], R)[0].severity).toBe('error')
    expect(clusterMarkers([e, w], R)[0].severity).toBe('error')
  })

  it('merges at the radius, not beyond', () => {
    expect(clusterMarkers([{ x: 0, y: 0, severity: 'warning' }, { x: R, y: 0, severity: 'warning' }], R)).toHaveLength(1)
    expect(clusterMarkers([{ x: 0, y: 0, severity: 'warning' }, { x: R + 1, y: 0, severity: 'warning' }], R)).toHaveLength(2)
  })

  it('returns nothing for no marker', () => {
    expect(clusterMarkers([], R)).toEqual([])
  })
})

describe('renderNetwork overlays per tier', () => {
  beforeEach(() => resetIdCounter())

  /** A straight track of two rails: ends at x = 0 and x = 200, a plain joint at x = 100 */
  function straightTrack(): { net: Network; ids: string[] } {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 100, y: 0 })
    const c = addNode(net, { x: 200, y: 0 })
    addSegment(net, a.id, b.id)
    addSegment(net, b.id, c.id)
    return { net, ids: [a.id, b.id, c.id] }
  }

  const draw = (
    net: Network,
    scale: number,
    opts: { selection?: ReturnType<typeof noSelection>; meta?: Record<string, SectionMetadata>; cx?: number; cy?: number } = {},
  ) => {
    const ctx = createMockContext()
    const cam = createCamera(opts.cx ?? 100, opts.cy ?? 0, scale)
    renderNetwork(ctx, cam, VW, VH, net, opts.selection ?? noSelection(), opts.meta ?? {}, { tool: 'select' })
    return ctx
  }
  /** Screen x of a world x for a camera centred on x = 100 */
  const sxOf = (worldX: number, scale: number) => (worldX - 100) * scale + VW / 2

  describe('node markers', () => {
    it('detail: every node, as before', () => {
      const { net } = straightTrack()
      const ctx = draw(net, DETAIL)
      expect(radiiAt(ctx, sxOf(100, DETAIL), VH / 2)).toEqual([4, 2.5])
      expect(radiiAt(ctx, sxOf(0, DETAIL), VH / 2)).toEqual(expect.arrayContaining([5.5, 2]))
      expect(radiiAt(ctx, sxOf(200, DETAIL), VH / 2)).toEqual(expect.arrayContaining([5.5, 2]))
    })

    it('line: the ends of track only', () => {
      const { net } = straightTrack()
      const ctx = draw(net, LINE)
      expect(radiiAt(ctx, sxOf(100, LINE), VH / 2)).toEqual([])
      expect(radiiAt(ctx, sxOf(0, LINE), VH / 2)).toEqual([5.5, 2])
      expect(radiiAt(ctx, sxOf(200, LINE), VH / 2)).toEqual([5.5, 2])
    })

    it('line: a selected joint is still drawn', () => {
      const { net, ids } = straightTrack()
      const selection = { nodes: new Set([ids[1]]), segments: new Set<string>() }
      const ctx = draw(net, LINE, { selection })
      expect(radiiAt(ctx, sxOf(100, LINE), VH / 2)).toEqual([7, 4])
    })

    it('schematic: the selected ones only', () => {
      const { net, ids } = straightTrack()
      expect(vi.mocked(draw(net, SCHEMATIC).arc)).not.toHaveBeenCalled()

      const selection = { nodes: new Set([ids[0]]), segments: new Set<string>() }
      const ctx = draw(net, SCHEMATIC, { selection })
      expect(radiiAt(ctx, sxOf(0, SCHEMATIC), VH / 2)).toEqual([7, 4])
      expect(vi.mocked(ctx.arc)).toHaveBeenCalledTimes(2)
    })

    it('stays hidden in pan mode whatever the tier', () => {
      const { net, ids } = straightTrack()
      const selection = { nodes: new Set([ids[0]]), segments: new Set<string>() }
      for (const scale of [DETAIL, LINE, SCHEMATIC]) {
        const ctx = createMockContext()
        renderNetwork(ctx, createCamera(100, 0, scale), VW, VH, net, selection, {}, { tool: 'pan' })
        // The pads of the buffer stops are discs too: only the node markers are looked for
        const radii = vi.mocked(ctx.arc).mock.calls.map((c) => c[2])
        for (const r of [7, 5.5, 4, 2.5, 2]) expect(radii).not.toContain(r)
      }
    })
  })

  describe('buffer stops', () => {
    const BUFFER_RED = '#dc2626'

    it('are drawn in the detail tier only', () => {
      const { net } = straightTrack()
      expect(draw(net, DETAIL).strokeStyles.filter((s) => s === BUFFER_RED)).toHaveLength(2)
      expect(draw(net, LINE).strokeStyles).not.toContain(BUFFER_RED)
      expect(draw(net, SCHEMATIC).strokeStyles).not.toContain(BUFFER_RED)
    })
  })

  describe('direction arrows', () => {
    /** The whole straight track as one one-way section */
    function oneWay(): { net: Network; meta: Record<string, SectionMetadata> } {
      const { net } = straightTrack()
      const sections = networkDerived(net, {}).sections
      expect(sections).toHaveLength(1)
      expect(sections[0].segmentIds).toHaveLength(2)
      return { net, meta: { [sections[0].id]: { name: sections[0].name, direction: 'forward' } } }
    }
    /** Arrows are the only overlay drawn through translate + rotate */
    const arrowsAt = (ctx: CanvasRenderingContext2D) => vi.mocked(ctx.translate).mock.calls.map((c) => c[0])

    it('detail: one per rail, as before', () => {
      const { net, meta } = oneWay()
      const ctx = draw(net, DETAIL, { meta })
      expect(arrowsAt(ctx)).toEqual([sxOf(50, DETAIL), sxOf(150, DETAIL)])
      expect(vi.mocked(ctx.rotate)).toHaveBeenCalledTimes(2)
    })

    it('line: one per section, on its middle rail', () => {
      const { net, meta } = oneWay()
      const ctx = draw(net, LINE, { meta })
      expect(arrowsAt(ctx)).toEqual([sxOf(150, LINE)])
    })

    it('schematic: none', () => {
      const { net, meta } = oneWay()
      expect(arrowsAt(draw(net, SCHEMATIC, { meta }))).toEqual([])
    })

    it('none on a two-way section', () => {
      const { net } = straightTrack()
      expect(arrowsAt(draw(net, DETAIL))).toEqual([])
      expect(arrowsAt(draw(net, LINE))).toEqual([])
    })
  })

  describe('section badges', () => {
    /** Parallel tracks `gap` metres apart, each its own section; the second one is renamed */
    function parallelTracks(count: number, gap: number): { net: Network; meta: Record<string, SectionMetadata>; segIds: string[] } {
      const net = createNetwork()
      const segIds: string[] = []
      for (let i = 0; i < count; i++) {
        const a = addNode(net, { x: 0, y: i * gap })
        const b = addNode(net, { x: 200 + i, y: i * gap })
        segIds.push(addSegment(net, a.id, b.id)!.id)
      }
      return { net, segIds, meta: { [segIds[1]]: { name: 'Voie 2', isCustomName: true } } }
    }
    const badgeTexts = (ctx: CanvasRenderingContext2D) => texts(ctx).filter((t) => t.includes('Section') || t.includes('Voie'))

    it('detail: tracks far enough apart all keep their badge', () => {
      // 20 m apart at 2.5 px/m: 50 px between badges 18 px high
      const { net, meta } = parallelTracks(3, 20)
      const ctx = draw(net, DETAIL, { meta, cy: 20 })
      expect(badgeTexts(ctx)).toHaveLength(3)
      // Compact text below BADGE_FULL_FROM_PX: no length
      expect(badgeTexts(ctx).every((t) => !t.includes(' m)'))).toBe(true)
    })

    it('shows the full badge from BADGE_FULL_FROM_PX on', () => {
      const { net, meta } = parallelTracks(1, 20)
      expect(badgeTexts(draw(net, 3.0, { meta }))[0]).toContain('(200.0 m)')
      expect(badgeTexts(draw(net, 2.99, { meta }))[0]).not.toContain(' m)')
    })

    it('never draws a badge over another: the renamed one wins, then the longest', () => {
      // 4 m apart at 2.5 px/m: 10 px between badges 18 px high, so neighbours overlap
      const { net, meta } = parallelTracks(3, 4)
      const ctx = draw(net, DETAIL, { meta, cy: 4 })
      // Voie 2 (middle) hides both neighbours
      expect(badgeTexts(ctx)).toEqual(['Voie 2'])

      // Without the name, the longest (the last, 202 m) wins and the first no longer touches it
      const plain = draw(net, DETAIL, { cy: 4 })
      expect(badgeTexts(plain)).toHaveLength(2)
      const pills = vi.mocked(plain.roundRect).mock.calls.map((c) => c[1])
      expect(Math.abs(pills[0] - pills[1])).toBeGreaterThanOrEqual(18)
    })

    it('the selected section wins over a renamed one', () => {
      const { net, meta, segIds } = parallelTracks(3, 4)
      const selection = { nodes: new Set<string>(), segments: new Set([segIds[0]]) }
      const ctx = draw(net, DETAIL, { meta, selection, cy: 4 })
      const shown = badgeTexts(ctx)
      expect(shown.some((t) => t.includes('(200.0 m)'))).toBe(true)
      expect(shown).not.toContain('Voie 2')
    })

    it('schematic: renamed and selected sections only', () => {
      // 200 m apart at 0.2 px/m: 40 px, no overlap
      const { net, meta, segIds } = parallelTracks(3, 200)
      const ctx = draw(net, SCHEMATIC, { meta, cy: 200 })
      expect(badgeTexts(ctx)).toEqual(['Voie 2'])

      const selection = { nodes: new Set<string>(), segments: new Set([segIds[2]]) }
      const withSel = badgeTexts(draw(net, SCHEMATIC, { meta, selection, cy: 200 }))
      expect(withSel).toHaveLength(2)
      expect(withSel).toContain('Voie 2')
    })

    it('still moves a badge out of the gizmo keep-out', () => {
      const { net } = parallelTracks(1, 20)
      const ctx = createMockContext()
      const cam = createCamera(100, 0, DETAIL)
      // The badge sits at (400, 286), 72 x 18
      const keepOut = { x: 380, y: 270, w: 40, h: 40 }
      renderNetwork(ctx, cam, VW, VH, net, noSelection(), {}, { tool: 'select', badgeExclusion: keepOut })
      const y = vi.mocked(ctx.fillText).mock.calls.find((c) => String(c[0]).includes('Section'))![2]
      expect(y).toBe(keepOut.y + keepOut.h + 9 + 2)
    })
  })

  describe('diagnostic markers', () => {
    /** `count` pairs of track ends facing each other across a gap: two markers per pair */
    function gaps(count: number, spacing: number): Network {
      const net = createNetwork()
      for (let i = 0; i < count; i++) {
        const y = i * spacing
        const a = addNode(net, { x: 0, y })
        const b = addNode(net, { x: 99.9, y })
        const c = addNode(net, { x: 100.1, y })
        const d = addNode(net, { x: 200, y })
        addSegment(net, a.id, b.id)
        addSegment(net, c.id, d.id)
      }
      return net
    }
    const marks = (ctx: CanvasRenderingContext2D) => texts(ctx).filter((t) => /^(!|\d+)$/.test(t))
    const labels = (ctx: CanvasRenderingContext2D) => texts(ctx).filter((t) => t === 'Voie interrompue')

    it('the fixture reports two issues per gap', () => {
      expect(networkDerived(gaps(2, 500), {}).kinematicIssues()).toHaveLength(4)
    })

    it('detail and line: one marker per issue, with its label', () => {
      for (const scale of [DETAIL, LINE]) {
        const ctx = draw(gaps(1, 500), scale)
        expect(marks(ctx)).toEqual(['!', '!'])
        expect(labels(ctx)).toHaveLength(2)
      }
    })

    it('drops the label below DIAGNOSTIC_LABEL_FROM_PX, still one marker per issue', () => {
      const ctx = draw(gaps(1, 500), 0.89)
      expect(trackLod(0.89, GAUGE)).toBe('line')
      expect(marks(ctx)).toEqual(['!', '!'])
      expect(labels(ctx)).toHaveLength(0)
      expect(labels(draw(gaps(1, 500), 0.9))).toHaveLength(2)
    })

    it('schematic: close markers become one with the count, far ones stay apart, no label', () => {
      // 500 m apart at 0.2 px/m: 100 px between the two gaps
      const ctx = draw(gaps(2, 500), SCHEMATIC, { cy: 250 })
      expect(marks(ctx)).toEqual(['2', '2'])
      expect(labels(ctx)).toHaveLength(0)

      // 50 m apart: 10 px, the four markers are one
      expect(marks(draw(gaps(2, 50), SCHEMATIC, { cy: 25 }))).toEqual(['4'])
    })
  })
})
