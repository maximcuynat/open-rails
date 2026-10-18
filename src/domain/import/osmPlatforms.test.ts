import { describe, it, expect, beforeEach } from 'vitest'
import { convertOsm } from './osmImport'
import type { OsmImportResult, OverpassElement } from './osmTypes'
import { answer, options, osmNode, osmWay, placeIn, readFixture } from './osmImport.testkit'
import { isPlatformTags, readPlatformOutlines, splitPlatformRef } from './osmPlatforms'
import { readOsm } from './osmRead'
import { positionOnSegment } from '../models/locomotive'
import { resetIdCounter } from '../models/network'
import { edgeLength, pointOnEdge, sideNormal } from '../models/platforms'
import type { Platform, PlatformEdge, Point, Station } from '../models/types'

beforeEach(() => resetIdCounter(0))

/** A straight way along y = `y`, a node every 100 m from x = 0 to 400, from id `first`; `tagged[x]` tags the node at x */
function track(wayId: number, first: number, y: number, tagged: Record<number, Record<string, string>> = {}): OverpassElement[] {
  const ids = [0, 100, 200, 300, 400].map((_, i) => first + i)
  return [...ids.map((id, i) => osmNode(id, i * 100, y, tagged[i * 100])), osmWay(wayId, ids)]
}

/** A platform way through places (metres), closed when the first place is repeated last; nodes from `first` */
function platformWay(wayId: number, first: number, places: [number, number][], tags: Record<string, string> = {}): OverpassElement[] {
  const closed = places.length > 2 && places[0][0] === places[places.length - 1][0] && places[0][1] === places[places.length - 1][1]
  const own = closed ? places.slice(0, -1) : places
  const ids = own.map((_, i) => first + i)
  return [...own.map(([x, y], i) => osmNode(ids[i], x, y)), { type: 'way', id: wayId, nodes: closed ? [...ids, ids[0]] : ids, tags: { railway: 'platform', public_transport: 'platform', ...tags } }]
}

/** A rectangle from x0 to x1, y0 to y1 (metres), closed */
const box = (x0: number, x1: number, y0: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]

const STOP = { railway: 'stop', public_transport: 'stop_position', train: 'yes', name: 'Clelles-Mens', uic_ref: '8774762' }

const only = <T>(items: Map<string, T>): T => {
  expect(items.size).toBe(1)
  return [...items.values()][0]
}

/** The y (metres south of the kit's origin) of a place of the world, measured at x = 200 */
function yOf(result: OsmImportResult, p: Point): number {
  const origin = placeIn(result, 200, 0)
  const south = placeIn(result, 200, 1)
  const unit = { x: south.x - origin.x, y: south.y - origin.y }
  return (p.x - origin.x) * unit.x + (p.y - origin.y) * unit.y
}

/** The y (kit metres) of the track of an edge, and the y its side points to, at its middle */
function edgeAt(result: OsmImportResult, edge: PlatformEdge): { y: number; towards: number } {
  const mid = pointOnEdge(result.network, edge, edgeLength(result.network, edge) / 2)!
  const n = sideNormal(mid.heading, edge.side)
  return { y: yOf(result, mid.point), towards: yOf(result, { x: mid.point.x + n.x, y: mid.point.y + n.y }) - yOf(result, mid.point) }
}

const stopYs = (result: OsmImportResult, station: Station): number[] =>
  station.stops.map((stop) => Math.round(yOf(result, positionOnSegment(result.network, stop.segId, stop.t)!) * 10) / 10 + 0)

describe('reading the platforms of an answer', () => {
  it('keeps the platforms of the trains, ways and multipolygons, and their refs', () => {
    const data = answer(
      platformWay(500, 100, box(100, 200, 2, 8), { ref: '1;2', name: 'Quai A' }),
      platformWay(501, 110, [[0, 3], [100, 3]], { railway: 'platform', tram: 'yes' }),
      platformWay(502, 120, [[0, 3], [100, 3]], { railway: '', public_transport: 'platform', train: 'yes', local_ref: 'B' }),
      platformWay(503, 130, box(0, 50, 20, 30)),
      { type: 'relation', id: 900, members: [{ type: 'way', ref: 503, role: 'outer' }], tags: { type: 'multipolygon', railway: 'platform' } },
    )
    const read = readOsm(data, options())
    expect(read.platforms.map((p) => [p.element, p.osmId, p.area, p.ref, p.localRef, p.name])).toEqual([
      ['way', 500, true, '1;2', undefined, 'Quai A'],
      ['way', 502, false, undefined, 'B', undefined],
      ['way', 503, true, undefined, undefined, undefined],
      ['relation', 900, true, undefined, undefined, undefined],
    ])
    // A platform is no track
    expect(read.allTracks).toEqual([])
    expect(readPlatformOutlines([{ type: 'way', id: 1, nodes: [7, 8], tags: { railway: 'platform' } }], read.nodes)).toEqual([])
  })

  it('tells a platform of the trains from the others, and splits the refs', () => {
    expect(isPlatformTags({ railway: 'platform' })).toBe(true)
    expect(isPlatformTags({ public_transport: 'platform', train: 'yes' })).toBe(true)
    expect(isPlatformTags({ public_transport: 'platform', bus: 'yes' })).toBe(false)
    expect(isPlatformTags({ railway: 'platform', subway: 'yes' })).toBe(false)
    expect(isPlatformTags({ railway: 'platform', tram: 'yes', train: 'yes' })).toBe(true)
    expect(splitPlatformRef('1;2')).toEqual(['1', '2'])
    expect(splitPlatformRef(' A / B ')).toEqual(['A', 'B'])
    expect(splitPlatformRef('3, 4')).toEqual(['3', '4'])
    expect(splitPlatformRef('')).toEqual([])
    expect(splitPlatformRef(undefined)).toEqual([])
  })
})

describe('platforms laid along the track', () => {
  it('a platform beside one track: its side, its length, its width, its station, a marker each way at the stop', () => {
    const data = answer(track(10, 1, 0, { 200: { ...STOP, local_ref: '1' } }), platformWay(500, 100, box(100, 250, 1.7, 7.7)))
    const result = convertOsm(data, options())
    const platform = only(result.network.platforms)
    const station = only(result.network.stations)
    expect(platform.stationId).toBe(station.id)
    expect(platform.edges).toHaveLength(1)
    const [edge] = platform.edges
    expect(edgeLength(result.network, edge)).toBeGreaterThan(146)
    expect(edgeLength(result.network, edge)).toBeLessThan(154)
    // On the track, its side towards the platform (south of it)
    const at = edgeAt(result, edge)
    expect(at.y).toBeCloseTo(0, 0)
    expect(at.towards).toBeGreaterThan(0.9)
    expect(platform.width).toBeCloseTo(6, 0)
    expect(edge.ref).toBe('1')
    // The stop position gives the markers: one each way, where it stands
    expect(platform.markers.map((m) => m.heading).sort()).toEqual(['backward', 'forward'])
    for (const marker of platform.markers) {
      const p = pointOnEdge(result.network, edge, marker.at)!.point
      const expected = placeIn(result, 200, 0)
      expect(Math.hypot(p.x - expected.x, p.y - expected.y)).toBeLessThan(0.5)
    }
    // The stops of the station are now those of the markers: still at the stop, with its number
    expect(station.stops.length).toBe(2)
    expect(stopYs(result, station)).toEqual([0, 0])
    expect(station.stops.every((stop) => stop.ref === '1')).toBe(true)
    expect(result.report.platforms).toEqual({ found: 1, placed: 1, islands: 0, skipped: {} })
  })

  it('a platform on the other side and walked the other way says so', () => {
    const data = answer(track(10, 1, 0, { 200: STOP }), platformWay(500, 100, box(250, 100, -1.7, -7.7).reverse()))
    const result = convertOsm(data, options())
    const platform = only(result.network.platforms)
    const at = edgeAt(result, platform.edges[0])
    expect(at.towards).toBeLessThan(-0.9)
  })

  it('a long platform on the outside of a curve is still on its side', () => {
    // A curve of 500 m radius centred 500 m north of the kit's origin; the platform 1.7 to 7.7 m outside it
    const arc = (r: number, from: number, to: number, step: number): [number, number][] => {
      const places: [number, number][] = []
      for (let a = from; a <= to + 1e-9; a += step) places.push([r * Math.sin(a), -500 + r * Math.cos(a)])
      return places
    }
    const rail = arc(500, -0.5, 0.5, 0.02)
    const ids = rail.map((_, i) => 1 + i)
    const middle = ids[Math.floor(ids.length / 2)]
    const nodes = rail.map(([x, y], i) => osmNode(ids[i], x, y, ids[i] === middle ? STOP : undefined))
    const outline = [...arc(501.7, -0.3, 0.3, 0.01), ...arc(507.7, -0.3, 0.3, 0.01).reverse()]
    const result = convertOsm(answer(nodes, osmWay(10, ids), platformWay(500, 1000, [...outline, outline[0]])), options())
    const platform = only(result.network.platforms)
    const length = edgeLength(result.network, platform.edges[0])
    expect(Math.abs(length - 0.6 * 500)).toBeLessThan(5)
    // At the middle the outside of the curve is south
    expect(edgeAt(result, platform.edges[0]).towards).toBeGreaterThan(0.9)
  })

  it('an island between two tracks: two edges facing each other, the refs of the platform one per edge', () => {
    const data = answer(
      track(10, 1, 0, { 200: STOP }),
      track(20, 11, 10, { 200: STOP }),
      platformWay(500, 100, box(80, 300, 1.7, 8.3), { ref: '1;2' }),
    )
    const result = convertOsm(data, options())
    const platform = only(result.network.platforms)
    expect(platform.edges).toHaveLength(2)
    const sides = platform.edges.map((edge) => edgeAt(result, edge)).sort((a, b) => a.y - b.y)
    expect(sides[0].y).toBeCloseTo(0, 0)
    expect(sides[0].towards).toBeGreaterThan(0.9)
    expect(sides[1].y).toBeCloseTo(10, 0)
    expect(sides[1].towards).toBeLessThan(-0.9)
    for (const edge of platform.edges) expect(Math.abs(edgeLength(result.network, edge) - 220)).toBeLessThan(4)
    expect(new Set(platform.edges.map((edge) => edge.ref))).toEqual(new Set(['1', '2']))
    expect(result.report.platforms).toMatchObject({ placed: 1, islands: 1 })
    const station = only(result.network.stations)
    expect(stopYs(result, station).sort((a, b) => a - b)).toEqual([0, 0, 10, 10])
  })

  it('the numbers of the stop positions win over the ref of the platform, and take the edge they stand on', () => {
    const data = answer(
      track(10, 1, 0, { 200: { ...STOP, local_ref: '2' } }),
      track(20, 11, 10, { 200: { ...STOP, local_ref: '1' } }),
      platformWay(500, 100, box(80, 300, 1.7, 8.3), { ref: 'A' }),
    )
    const result = convertOsm(data, options())
    const platform = only(result.network.platforms)
    const byY = platform.edges.map((edge) => [Math.round(edgeAt(result, edge).y) + 0, edge.ref])
    expect(byY.sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([[0, '2'], [10, '1']])
  })

  it('a line drawn in the middle of an island serves both tracks; one drawn along an edge only its own', () => {
    const island = convertOsm(answer(track(10, 1, 0, { 200: STOP }), track(20, 11, 10, { 200: STOP }), platformWay(500, 100, [[100, 5], [300, 5]])), options())
    expect(only(island.network.platforms).edges).toHaveLength(2)
    resetIdCounter(0)
    // A line at 1.7 m from one track, the other 8 m away across it: beside the first one only
    const side = convertOsm(answer(track(10, 1, 0, { 200: STOP }), track(20, 11, 9.7), platformWay(500, 100, [[100, 1.7], [300, 1.7]])), options())
    const platform = only(side.network.platforms)
    expect(platform.edges).toHaveLength(1)
    expect(edgeAt(side, platform.edges[0]).y).toBeCloseTo(0, 0)
    expect(edgeAt(side, platform.edges[0]).towards).toBeGreaterThan(0.9)
  })

  it('an edge without stop position gets the markers of a new platform', () => {
    const data = answer(track(10, 1, 0, { 200: STOP }), track(20, 11, 10), platformWay(500, 100, box(100, 300, 1.7, 8.3)))
    const result = convertOsm(data, options())
    const platform = only(result.network.platforms)
    const empty = platform.edges.findIndex((edge) => Math.round(edgeAt(result, edge).y) === 10)
    const markers = platform.markers.filter((m) => m.edge === empty)
    const length = edgeLength(result.network, platform.edges[empty])
    expect(markers.map((m) => Math.round(m.at)).sort((a, b) => a - b)).toEqual([10, Math.round(length - 10)])
  })

  it('the same platform drawn twice is laid once', () => {
    const data = answer(track(10, 1, 0, { 200: STOP }), platformWay(500, 100, box(100, 250, 1.7, 7.7)), platformWay(501, 120, [[100, 4.7], [250, 4.7]]))
    const result = convertOsm(data, options())
    expect(result.network.platforms.size).toBe(1)
    expect(result.report.platforms).toEqual({ found: 2, placed: 1, islands: 0, skipped: { duplicate: 1 } })
  })

  it('a platform with no station near is not laid, and said; one far from the tracks is only counted', () => {
    const data = answer(track(10, 1, 0), platformWay(500, 100, box(100, 250, 1.7, 7.7), { name: 'Quai 1' }), platformWay(501, 120, box(100, 200, 300, 306)))
    const result = convertOsm(data, options())
    expect(result.network.platforms.size).toBe(0)
    expect(result.report.platforms).toEqual({ found: 2, placed: 0, islands: 0, skipped: { 'no-station': 1, 'no-track': 1 } })
    const issue = result.report.issues.find((i) => i.kind === 'platform-not-placed')!
    expect(issue.osmIds).toEqual([500])
    expect(issue.detail).toContain('Quai 1')
  })

  it('a station whose stops the platforms do not all cover keeps them, and gets no platform', () => {
    const data = answer(track(10, 1, 0, { 200: STOP }), track(20, 11, 10, { 200: STOP }), platformWay(500, 100, box(100, 250, -1.7, -7.7)))
    const result = convertOsm(data, options())
    expect(result.network.platforms.size).toBe(0)
    expect(result.report.platforms?.skipped).toEqual({ 'uncovered-stops': 1 })
    const station = only(result.network.stations)
    expect(stopYs(result, station).sort((a, b) => a - b)).toEqual([0, 10])
  })

  it('a platform the station has no stop along joins the nearest station within reach', () => {
    // Station node beside the track, no stop position: its stops are the rails within reach
    const data = answer(track(10, 1, 0), osmNode(900, 200, 40, { railway: 'station', name: 'Halte' }), platformWay(500, 100, box(150, 250, 1.7, 7.7)))
    const result = convertOsm(data, options())
    const platform: Platform = only(result.network.platforms)
    expect(result.network.stations.get(platform.stationId)!.name).toBe('Halte')
  })

  it('leaves the stations of an answer without platforms as they were, on the four samples', () => {
    for (const name of ['clelles-mens', 'dijon-ville', 'lgv-pasilly', 'paris-gare-de-lyon']) {
      const data = readFixture(name)
      resetIdCounter(0)
      const withPlatforms = convertOsm(data, options())
      resetIdCounter(0)
      const without = convertOsm(data, options({ platforms: false }))
      expect(withPlatforms.network.platforms.size).toBe(0)
      expect(JSON.stringify([...withPlatforms.network.stations.values()])).toBe(JSON.stringify([...without.network.stations.values()]))
      expect(withPlatforms.report.platforms).toEqual({ found: 0, placed: 0, islands: 0, skipped: {} })
      expect(without.report.platforms).toBeUndefined()
    }
  })
})
