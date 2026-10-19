import { beforeEach, describe, expect, it } from 'vitest'
import { addCurveSegment, addNode, addSegment, createNetwork, resetIdCounter } from '@domain/models/network'
import { addStation } from '@domain/models/stations'
import { edgeLength, platformDimensions, pointOnEdge, settlePlatforms, sideNormal } from '@domain/models/platforms'
import type { Network, PlatformEdge, Point } from '@domain/models/types'
import {
  applyIslandLoop,
  applySidePlatforms,
  applyPassingSiding,
  computeIslandLoopPreview,
  computePassingSidingPreview,
  computeSidePlatformsPreview,
  straightRunThrough,
  TEMPLATE_PLATFORM_LENGTH,
} from './constructionTemplates'

beforeEach(() => resetIdCounter(0))

/** A straight track along y = 0 from x = 0 to `length`, in `pieces` rails */
function straightTrack(net: Network, length: number, pieces = 1, y = 0): void {
  let prev = addNode(net, { x: 0, y })
  for (let i = 1; i <= pieces; i++) {
    const next = addNode(net, { x: (length * i) / pieces, y })
    addSegment(net, prev.id, next.id)
    prev = next
  }
}

/** The point of the edge at its middle, and where its side points to there */
function sideAtMiddle(net: Network, edge: PlatformEdge): { point: Point; normal: Point } {
  const mid = pointOnEdge(net, edge, edgeLength(net, edge) / 2)!
  return { point: mid.point, normal: sideNormal(mid.heading, edge.side) }
}

const reach = 20

describe('island loop template (évitement à quai central)', () => {
  it('parts the line into two tracks set apart for an island, on the side of the cursor (left: y < 0 on screen)', () => {
    const net = createNetwork()
    straightTrack(net, 800)
    const dims = platformDimensions()
    const preview = computeIslandLoopPreview(net, { x: 400, y: -5 }, { reach })!
    expect(preview.valid).toBe(true)
    if (!preview.valid) return
    expect(preview.side).toBe('left')
    expect(preview.spacing).toBeCloseTo(2 * dims.edgeOffset + dims.width, 9)
    expect(preview.spacing).toBeGreaterThanOrEqual(dims.islandMinSpacing)
    expect(preview.loopStart.y).toBeCloseTo(-preview.spacing, 9)
    expect(preview.loopEnd.y).toBeCloseTo(-preview.spacing, 9)
    expect(preview.loopEnd.x - preview.loopStart.x).toBeCloseTo(TEMPLATE_PLATFORM_LENGTH, 9)
    expect(preview.outlines).toHaveLength(1)
    expect(preview.rails).toHaveLength(5)

    const laid = applyIslandLoop(net, preview)!
    expect(laid).not.toBeNull()
    expect(laid.newStation).toBe(true)
    expect(laid.station.name).toBe('Gare 1')
    expect(laid.rails).toHaveLength(5)
    expect(laid.platforms).toHaveLength(1)
    const [island] = laid.platforms
    expect(island.edges).toHaveLength(2)
    expect(island.markers).toHaveLength(4)

    // Each edge looks at the other track: the island is between them
    const [line, loop] = island.edges.map((edge) => sideAtMiddle(net, edge))
    expect(line.point.y).toBeCloseTo(0, 6)
    expect(loop.point.y).toBeCloseTo(-preview.spacing, 6)
    expect(line.normal.y).toBeCloseTo(-1, 6)
    expect(loop.normal.y).toBeCloseTo(1, 6)
    for (const edge of island.edges) expect(edgeLength(net, edge)).toBeCloseTo(TEMPLATE_PLATFORM_LENGTH, 3)
    // The station sits on the island
    expect(laid.station.pos.y).toBeCloseTo(-preview.spacing / 2, 6)

    // The two sets of points: a node of the line with three rails at each end of the loop
    const forks = [...net.nodes.values()].filter((node) => (net.adjacency.get(node.id) ?? []).length === 3)
    expect(forks).toHaveLength(2)
    for (const fork of forks) expect(fork.pos.y).toBeCloseTo(0, 9)

    // The stops of the station come from the markers
    settlePlatforms(net)
    expect(net.stations.get(laid.station.id)!.stops).toHaveLength(4)
  })

  it('goes to the right (y > 0 on screen) with the cursor on that side', () => {
    const net = createNetwork()
    straightTrack(net, 800)
    const preview = computeIslandLoopPreview(net, { x: 400, y: 5 }, { reach })!
    expect(preview.valid && preview.side).toBe('right')
    const laid = applyIslandLoop(net, preview)!
    const [line, loop] = laid.platforms[0].edges.map((edge) => sideAtMiddle(net, edge))
    expect(loop.point.y).toBeGreaterThan(9)
    expect(line.normal.y).toBeCloseTo(1, 6)
    expect(loop.normal.y).toBeCloseTo(-1, 6)
  })

  it('is laid across a straight made of many rails, and slides along it to fit', () => {
    const net = createNetwork()
    straightTrack(net, 800, 16)
    expect(straightRunThrough(net, [...net.segments.keys()][3])!.length).toBeCloseTo(800, 9)
    // The cursor near the end: the loop is slid back onto the straight
    const preview = computeIslandLoopPreview(net, { x: 790, y: -3 }, { reach })!
    expect(preview.valid).toBe(true)
    if (!preview.valid) return
    expect(preview.exit.pos.x).toBeLessThanOrEqual(800)
    const laid = applyIslandLoop(net, preview)!
    expect(laid.platforms[0].edges[0].track.length).toBeGreaterThan(1)
    expect(edgeLength(net, laid.platforms[0].edges[0])).toBeCloseTo(TEMPLATE_PLATFORM_LENGTH, 3)
  })

  it('says what it needs on a straight too short, and refuses a curve', () => {
    const net = createNetwork()
    straightTrack(net, 300)
    const short = computeIslandLoopPreview(net, { x: 150, y: -3 }, { reach })!
    expect(short.valid).toBe(false)
    if (short.valid) return
    expect(short.refusal).toBe('too-short')
    expect(short.needed).toBeGreaterThan(300)
    expect(applyIslandLoop(net, short)).toBeNull()

    const curved = createNetwork()
    const a = addNode(curved, { x: 0, y: 0 })
    const b = addNode(curved, { x: 400, y: 0 })
    addCurveSegment(curved, a.id, b.id, { x: 200, y: 100 })
    const onCurve = computeIslandLoopPreview(curved, { x: 200, y: 50 }, { reach: 50 })!
    expect(!onCurve.valid && onCurve.refusal).toBe('not-straight')
    expect(computeIslandLoopPreview(curved, { x: 200, y: 400 }, { reach })).toBeNull()
  })

  it('keeps to the sizes of the scale (HO)', () => {
    const net = createNetwork()
    straightTrack(net, 10)
    const gauge = 0.0165
    const dims = platformDimensions(gauge)
    const preview = computeIslandLoopPreview(net, { x: 5, y: -0.05 }, { reach: 0.3, gauge })!
    expect(preview.valid).toBe(true)
    if (!preview.valid) return
    expect(preview.spacing).toBeCloseTo(2 * dims.edgeOffset + dims.width, 9)
    const laid = applyIslandLoop(net, preview, { gauge })!
    expect(laid.platforms[0].edges).toHaveLength(2)
  })

  it('joins a station already there', () => {
    const net = createNetwork()
    straightTrack(net, 800)
    const station = addStation(net, { name: 'Ici', pos: { x: 400, y: 30 }, stops: [] })
    const laid = applyIslandLoop(net, computeIslandLoopPreview(net, { x: 400, y: -5 }, { reach })!)!
    expect(laid.newStation).toBe(false)
    expect(laid.station.id).toBe(station.id)
  })
})

describe('station template with two side platforms (gare à deux quais latéraux)', () => {
  it('lays one platform on the outer side of each track of a double track, in one station', () => {
    const net = createNetwork()
    straightTrack(net, 600)
    straightTrack(net, 600, 1, 4)
    const preview = computeSidePlatformsPreview(net, { x: 300, y: 2.5 }, { reach })!
    expect(preview.valid).toBe(true)
    if (!preview.valid) return
    expect(preview.spacing).toBeCloseTo(4, 9)
    expect(preview.platformLength).toBeCloseTo(TEMPLATE_PLATFORM_LENGTH, 3)
    expect(preview.outlines).toHaveLength(2)

    const laid = applySidePlatforms(net, preview)!
    expect(laid.platforms).toHaveLength(2)
    expect(laid.newStation).toBe(true)
    expect(new Set(laid.platforms.map((p) => p.stationId)).size).toBe(1)
    const sides = laid.platforms.map((p) => sideAtMiddle(net, p.edges[0]))
    const north = sides.find((s) => Math.abs(s.point.y) < 1e-6)!
    const south = sides.find((s) => Math.abs(s.point.y - 4) < 1e-6)!
    // Away from the other track: up (y < 0) from y = 0, down from y = 4
    expect(north.normal.y).toBeCloseTo(-1, 6)
    expect(south.normal.y).toBeCloseTo(1, 6)
    expect(laid.station.pos.y).toBeCloseTo(2, 6)
    for (const p of laid.platforms) expect(p.markers).toHaveLength(2)
  })

  it('finds the other track on the far side when the cursor is outside', () => {
    const net = createNetwork()
    straightTrack(net, 600)
    straightTrack(net, 600, 1, 4)
    const preview = computeSidePlatformsPreview(net, { x: 300, y: -3 }, { reach })!
    expect(preview.valid).toBe(true)
  })

  it('on a passing loop, keeps to the stretch where the two tracks run side by side', () => {
    const net = createNetwork()
    straightTrack(net, 600)
    const siding = computePassingSidingPreview(net, [...net.segments.keys()][0], { x: 300, y: 0 }, 120, 4)!
    expect(applyPassingSiding(net, siding)).toBe(true)
    const preview = computeSidePlatformsPreview(net, { x: 300, y: 2 }, { reach })!
    expect(preview.valid).toBe(true)
    if (!preview.valid) return
    expect(preview.platformLength).toBeLessThanOrEqual(135)
    expect(preview.platformLength).toBeGreaterThan(60)
    const laid = applySidePlatforms(net, preview)!
    expect(laid.platforms).toHaveLength(2)
  })

  it('refuses a single track', () => {
    const net = createNetwork()
    straightTrack(net, 600)
    const preview = computeSidePlatformsPreview(net, { x: 300, y: 2 }, { reach })!
    expect(!preview.valid && preview.refusal).toBe('no-track-across')
    expect(applySidePlatforms(net, preview)).toBeNull()
  })
})
