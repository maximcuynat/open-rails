import { describe, it, expect, beforeEach } from 'vitest'
import { convertOsm, surveyOsm } from './osmImport'
import type { OsmImportResult, OverpassElement, OverpassResponse } from './osmTypes'
import { along, answer, levelCounts, nodeNear, nodesWithRails, openInEditor, options, osmNode, osmTrack, osmWay, placeIn } from './osmImport.testkit'
import { segmentShapeLengthBetween } from '../geometry/segmentGeometry'
import { findJunctionAtNode } from '../models/junction'
import { walkForward } from '../models/locomotive'
import { generateId, nodeLevel, resetIdCounter, segmentHeightAt } from '../models/network'
import type { Network, SpeedZone } from '../models/types'
import { analyzeKinematics } from '../services/kinematicDiagnostics'

/** Level of the node of a converted network that stands at a place of the kit; fails when none is within a metre */
function levelAtPlace(result: OsmImportResult, x: number, y: number): number {
  const place = placeIn(result, x, y)
  const found = nodeNear(result.network, place.x, place.y)
  expect(found.distance, `node at ${x}, ${y}`).toBeLessThan(1)
  return nodeLevel(found.node)
}

/** Height of the track of a converted network where it passes a place of the kit */
function heightAtPlace(result: OsmImportResult, x: number, y: number): number {
  const net = result.network
  const place = placeIn(result, x, y)
  let best = { distance: Infinity, height: NaN }
  for (const seg of net.segments.values()) {
    const a = net.nodes.get(seg.from)!.pos
    const b = net.nodes.get(seg.to)!.pos
    for (let i = 0; i <= 40; i++) {
      const t = i / 40
      const p = seg.via
        ? { x: (1 - t) * (1 - t) * a.x + 2 * t * (1 - t) * seg.via.x + t * t * b.x, y: (1 - t) * (1 - t) * a.y + 2 * t * (1 - t) * seg.via.y + t * t * b.y }
        : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      const distance = Math.hypot(p.x - place.x, p.y - place.y)
      if (distance < best.distance) best = { distance, height: segmentHeightAt(net, seg, t) }
    }
  }
  return best.height
}

const zoneLength = (net: Network, zone: SpeedZone): number =>
  zone.spans.reduce((sum, span) => sum + segmentShapeLengthBetween(net, net.segments.get(span.segId)!, Math.min(span.t0, span.t1), Math.max(span.t0, span.t1)), 0)

const issueKinds = (result: OsmImportResult): string[] => result.report.issues.map((issue) => issue.kind).sort()

/** The rail at the track end that lies where `where` says, and whether a train leaving that end runs it forwards */
function railAtEnd(net: Network, where: (x: number, y: number) => boolean): { segId: string; forward: boolean; t: number } {
  for (const node of nodesWithRails(net, 1)) {
    if (!where(node.pos.x, node.pos.y)) continue
    const seg = net.segments.get(net.adjacency.get(node.id)![0])!
    return seg.from === node.id ? { segId: seg.id, forward: true, t: 0 } : { segId: seg.id, forward: false, t: 1 }
  }
  throw new Error('no track end there')
}

/** A track along the x axis from −300 to 300, on nodes 1 to 13 */
const groundTrack = (tags: Record<string, string> = {}): OverpassElement[] => osmTrack(100, 1, along([-300, 0], [300, 0], 50), tags).elements

/**
 * A track along the y axis that passes the x axis on a structure: nodes 21…, the structure between
 * y = −20 and y = 20 on way 201, the track on each side on ways 200 and 202.
 */
function crossingTrack(structure: Record<string, string>, x = 0): OverpassElement[] {
  const north = along([x, -300], [x, -20], 40)
  const south = along([x, 20], [x, 300], 40)
  const nodes = [...north, ...south].map(([px, py], i) => osmNode(21 + i, px, py))
  const northIds = north.map((_, i) => 21 + i)
  const southIds = south.map((_, i) => 21 + north.length + i)
  return [
    ...nodes,
    osmWay(200, northIds),
    osmWay(201, [northIds[northIds.length - 1], southIds[0]], structure),
    osmWay(202, southIds),
  ]
}

beforeEach(() => resetIdCounter())

describe('converting tracks', () => {
  it('lays a straight track as one rail between two nodes', () => {
    const { network, report } = convertOsm(answer(groundTrack()), options())
    expect(report).toMatchObject({ nodes: 2, rails: 1, turnouts: 0, doubleSlips: 0, fixedCrossings: 0, railsOnBridge: 0, railsInTunnel: 0, stackedCrossings: 0, undecidedCrossings: 0, droppedComponents: 0 })
    expect(report.lengthKm).toBeCloseTo(0.6, 2)
    expect(network.nodes.size).toBe(2)
    expect([...network.segments.values()][0].kind).toBe('straight')
    expect(openInEditor(network)).toEqual({ splitCount: 0, weldedCount: 0, unchanged: true })
  })

  it('centres the world on the data, x to the east and y to the south', () => {
    const result = convertOsm(answer(groundTrack(), osmNode(50, 300, 200), osmWay(101, [13, 50])), options())
    expect(result.origin.lat).toBeCloseTo(47 - 100 / 111_170, 5)
    expect(result.origin.lon).toBeCloseTo(5, 5)
    const east = nodeNear(result.network, 300, -100)
    const south = nodeNear(result.network, 300, 100)
    expect(east.distance).toBeLessThan(1)
    expect(south.distance).toBeLessThan(1)
  })

  it('builds each track in the direction its way is drawn', () => {
    const westwards = osmTrack(100, 1, along([300, 0], [-300, 0], 50)).elements
    const { network } = convertOsm(answer(westwards, osmNode(50, -300, 400), osmWay(101, [50, 13])), options())
    for (const seg of network.segments.values()) {
      const from = network.nodes.get(seg.from)!.pos
      const to = network.nodes.get(seg.to)!.pos
      // Way 100 runs west, way 101 runs north up to its last node
      if (Math.abs(from.y - to.y) < 1) expect(to.x).toBeLessThan(from.x)
      else expect(to.y).toBeLessThan(from.y)
    }
  })

  it('takes its ids from the counter of the domain, never from OpenStreetMap', () => {
    resetIdCounter(500)
    const track = osmTrack(123456789, 987654321, along([-300, 0], [300, 0], 50)).elements
    const { network } = convertOsm(answer(track, crossingTrack({ bridge: 'yes' })), options())
    const numbers = [...network.nodes.keys(), ...network.segments.keys(), ...network.junctions.keys(), ...network.speedZones.keys()].map((id) => parseInt(id.split('_')[1], 10))
    expect(Math.min(...numbers)).toBe(501)
    // Ids follow one another: nothing was taken by the attempts that were thrown away
    expect(Math.max(...numbers)).toBe(500 + numbers.length)
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(generateId('n')).toBe(`n_${501 + numbers.length}`)
  })

  it('leaves the counter where it was when nothing is laid', () => {
    resetIdCounter(77)
    expect(convertOsm(answer(), options()).network.nodes.size).toBe(0)
    expect(generateId('n')).toBe('n_78')
  })

  it('gives an empty network for an answer that is not one, without throwing', () => {
    for (const data of [null, {}, { elements: [{ type: 'way', id: 1, nodes: [1, 2], tags: { railway: 'rail' } }] }]) {
      const result = convertOsm(data as unknown as OverpassResponse, options())
      expect(result.network.nodes.size).toBe(0)
      expect(result.report).toMatchObject({ nodes: 0, rails: 0, lengthKm: 0, issues: [] })
      expect(result.lineSpeed).toBeUndefined()
      expect(surveyOsm(data as unknown as OverpassResponse, options())).toMatchObject({ ways: 0, lengthKm: 0, estimatedRails: 0 })
    }
  })

  it('lays the same track once when two ways are drawn over the same nodes', () => {
    const { report } = convertOsm(answer(groundTrack(), osmWay(101, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])), options())
    expect(report).toMatchObject({ nodes: 2, rails: 1 })
  })

  it('keeps the main network and counts what does not touch it', () => {
    const detached = osmTrack(300, 301, along([-100, 200], [100, 200], 50)).elements
    const data = answer(groundTrack(), detached)
    const main = convertOsm(data, options({ keepDetachedOverKm: 1e9 }))
    expect(main.report).toMatchObject({ rails: 1, droppedComponents: 1 })
    expect(main.report.lengthKm).toBeCloseTo(0.6, 2)
    expect(surveyOsm(data, options({ keepDetachedOverKm: 1e9 }))).toMatchObject({ ways: 1, detachedKm: expect.closeTo(0.2, 2) })

    const both = convertOsm(data, options({ keepDetachedOverKm: 0.1 }))
    expect(both.report).toMatchObject({ rails: 2, droppedComponents: 0 })
    expect(convertOsm(data, options({ keepDetachedOverKm: 0.5 })).report).toMatchObject({ rails: 1, droppedComponents: 1 })
  })

  it('follows the options: service tracks, disused tracks, other kinds', () => {
    const siding = [osmNode(40, 100, 6), osmNode(41, 200, 12), osmWay(110, [7, 40, 41], { service: 'siding' })]
    const old = [osmNode(42, -100, -6), osmNode(43, -200, -12), osmWay(111, [7, 42, 43], { railway: 'disused' })]
    const tram = [osmNode(44, 0, 100), osmNode(45, 0, 200), osmWay(112, [7, 44, 45], { railway: 'tram' })]
    const building = [osmNode(46, 0, -100), osmWay(113, [7, 46], { railway: 'construction' })]
    const data = answer(groundTrack(), siding, old, tram, building)
    const rails = (over: Parameters<typeof options>[0]): number => convertOsm(data, options(over)).report.lengthKm
    expect(rails({ serviceTracks: false })).toBeCloseTo(0.6, 2)
    expect(rails({})).toBeCloseTo(0.8, 2)
    expect(rails({ disusedTracks: true })).toBeCloseTo(1.0, 2)
    expect(rails({ disusedTracks: true, extraKinds: ['tram'] })).toBeCloseTo(1.2, 2)
    expect(surveyOsm(data, options())).toMatchObject({ ways: 2, serviceWays: 1, extraKinds: { tram: 1 } })
  })
})

describe('levels: which track passes over which', () => {
  // Two tracks that only pass over each other share no node: both are kept
  const apart = (over: Parameters<typeof options>[0] = {}): ReturnType<typeof options> => options({ keepDetachedOverKm: 0, ...over })

  it('lifts a bridge and every node of it, and brings the track back down just outside', () => {
    const result = convertOsm(answer(groundTrack(), crossingTrack({ bridge: 'yes', layer: '1' })), apart())
    const { network, report } = result
    expect(report).toMatchObject({ stackedCrossings: 1, undecidedCrossings: 0, turnouts: 0, fixedCrossings: 0 })
    expect(report.railsOnBridge).toBeGreaterThan(0)
    expect(report.railsInTunnel).toBe(0)
    // The two end nodes of the bridge are on it
    expect(levelAtPlace(result, 0, -20)).toBe(1)
    expect(levelAtPlace(result, 0, 20)).toBe(1)
    // …the whole bridge is level, and the track is on the ground a few metres beyond each end
    for (let y = -20; y <= 20; y += 5) expect(heightAtPlace(result, 0, y), `at ${y}`).toBe(1)
    for (const y of [-27, 27, -100, 100, -300, 300]) expect(heightAtPlace(result, 0, y), `at ${y}`).toBe(0)
    expect(levelCounts(network)).toEqual({ 0: 6, 1: 2 })
    // The track below stays on the ground from end to end
    for (let x = -300; x <= 300; x += 50) expect(heightAtPlace(result, x, 0) === 0 || Math.abs(x) < 1).toBe(true)
    expect(issueKinds(result).filter((kind) => kind !== 'cut-by-area')).toEqual([])
    // Nothing for the editor to make a level crossing of
    expect(openInEditor(network)).toEqual({ splitCount: 0, weldedCount: 0, unchanged: true })
    expect(nodesWithRails(network, 4)).toEqual([])
  })

  it('puts a bridge without layer one level up and a tunnel without layer one level down', () => {
    const bridge = convertOsm(answer(groundTrack(), crossingTrack({ bridge: 'viaduct' })), apart())
    expect(levelAtPlace(bridge, 0, 20)).toBe(1)
    expect(bridge.report).toMatchObject({ stackedCrossings: 1, undecidedCrossings: 0 })

    const tunnel = convertOsm(answer(groundTrack(), crossingTrack({ tunnel: 'yes' })), apart())
    expect(levelAtPlace(tunnel, 0, -20)).toBe(-1)
    expect(levelAtPlace(tunnel, 0, 20)).toBe(-1)
    expect(heightAtPlace(tunnel, 0, 0)).toBe(-1)
    expect(heightAtPlace(tunnel, 0, 60)).toBe(0)
    expect(tunnel.report).toMatchObject({ stackedCrossings: 1, undecidedCrossings: 0, railsOnBridge: 0 })
    expect(tunnel.report.railsInTunnel).toBeGreaterThan(0)
    expect(openInEditor(tunnel.network).unchanged).toBe(true)
  })

  it('reads the layer of a track on the ground: a cutting under a bridge that carries layer 0', () => {
    const cutting = convertOsm(answer(groundTrack({ layer: '-1' }), crossingTrack({ bridge: 'yes', layer: '0' })), apart())
    expect(cutting.report).toMatchObject({ stackedCrossings: 1, undecidedCrossings: 0 })
    expect(heightAtPlace(cutting, 100, 0)).toBe(-1)
    expect(heightAtPlace(cutting, 0, 15)).toBe(0)
  })

  it('takes of a list of layers the one closest to the ground, and reports it', () => {
    const result = convertOsm(answer(groundTrack(), crossingTrack({ tunnel: 'yes', layer: '-2;-3' })), apart())
    expect(levelAtPlace(result, 0, 20)).toBe(-2)
    expect(result.report).toMatchObject({ stackedCrossings: 1, undecidedCrossings: 0 })
    const issue = result.report.issues.find((found) => found.kind === 'uncertain-level')!
    expect(issue.osmIds).toEqual([201])
    expect(issue.detail).toContain('-2;-3')
    const place = placeIn(result, 0, 0)
    expect(Math.hypot(issue.x - place.x, issue.y - place.y)).toBeLessThan(25)
  })

  it('brings a layer out of range back into it, and reports it', () => {
    const result = convertOsm(answer(groundTrack(), crossingTrack({ tunnel: 'yes', layer: '-8' })), apart())
    expect(levelAtPlace(result, 0, 20)).toBe(-5)
    expect(result.report.stackedCrossings).toBe(1)
    expect(result.report.issues.filter((found) => found.kind === 'uncertain-level').map((found) => found.osmIds)).toEqual([[201]])
  })

  it('tells a tunnel from the cutting it passes under at the same layer', () => {
    const result = convertOsm(answer(groundTrack({ layer: '-1' }), crossingTrack({ tunnel: 'yes', layer: '-1' })), apart())
    expect(result.report).toMatchObject({ stackedCrossings: 1, undecidedCrossings: 0 })
    expect(heightAtPlace(result, 100, 0)).toBe(-1)
    expect(heightAtPlace(result, 0, 10)).toBe(-1.5)
    expect(openInEditor(result.network).unchanged).toBe(true)
    // …and a bridge from the track it passes over at the same layer
    const bridge = convertOsm(answer(groundTrack({ layer: '1' }), crossingTrack({ bridge: 'yes', layer: '1' })), apart())
    expect(bridge.report).toMatchObject({ stackedCrossings: 1, undecidedCrossings: 0 })
    expect(heightAtPlace(bridge, 0, 10)).toBe(1.5)
  })

  it('reports two tracks that cross at the same level without a common node, and makes the level crossing itself', () => {
    const result = convertOsm(answer(groundTrack(), crossingTrack({})), apart())
    const { network, report } = result
    expect(report).toMatchObject({ stackedCrossings: 0, undecidedCrossings: 1, fixedCrossings: 1, turnouts: 0 })
    const issue = report.issues.find((found) => found.kind === 'undecided-crossing')!
    expect([...issue.osmIds].sort()).toEqual([100, 201])
    const place = placeIn(result, 0, 0)
    expect(Math.hypot(issue.x - place.x, issue.y - place.y)).toBeLessThan(0.5)
    // The node the editor would have made at the first opening is already there
    const crossing = nodesWithRails(network, 4)
    expect(crossing).toHaveLength(1)
    expect(Math.hypot(crossing[0].pos.x - place.x, crossing[0].pos.y - place.y)).toBeLessThan(0.5)
    expect(openInEditor(network)).toEqual({ splitCount: 0, weldedCount: 0, unchanged: true })
    // Two tunnels at the same layer are no better told apart
    const tunnels = convertOsm(answer(groundTrack({ tunnel: 'yes', layer: '-2' }), crossingTrack({ tunnel: 'yes', layer: '-2' })), apart())
    expect(tunnels.report).toMatchObject({ stackedCrossings: 0, undecidedCrossings: 1 })
  })

  it('puts everything on the ground when levels are not asked for: the bridge becomes a level crossing, reported', () => {
    const result = convertOsm(answer(groundTrack(), crossingTrack({ bridge: 'yes', layer: '1' })), apart({ levels: false }))
    expect(levelCounts(result.network)).toEqual({ 0: result.network.nodes.size })
    expect(result.report).toMatchObject({ stackedCrossings: 0, undecidedCrossings: 1, railsOnBridge: 0, fixedCrossings: 1 })
    expect(openInEditor(result.network).unchanged).toBe(true)
  })

  it('keeps the ramp short of a track that passes over the approach', () => {
    // A second bridge crosses the approach 4 m beyond the end of the first one
    const over = [osmNode(60, -200, 24), osmNode(61, -30, 24), osmNode(62, 30, 24), osmNode(63, 200, 24), osmWay(210, [60, 61]), osmWay(211, [61, 62], { bridge: 'yes', layer: '1' }), osmWay(212, [62, 63])]
    const result = convertOsm(answer(groundTrack(), crossingTrack({ bridge: 'yes', layer: '1' }), over), apart())
    // Three crossings, all decided: the first bridge over the ground track, the second over the
    // approach of the first — which is back on the ground by then
    expect(result.report).toMatchObject({ stackedCrossings: 2, undecidedCrossings: 0 })
    expect(levelAtPlace(result, 0, 20)).toBe(1)
    // Down halfway to the second bridge, instead of the usual six metres
    expect(levelAtPlace(result, 0, 22)).toBe(0)
    expect(heightAtPlace(result, 0, 30)).toBe(0)
    expect(heightAtPlace(result, 10, 24)).toBe(1)
    // …while the other approach, which nothing crosses, takes its six metres
    expect(levelAtPlace(result, 0, -26)).toBe(0)
    expect(openInEditor(result.network).unchanged).toBe(true)
  })

  it('gives a turnout at the end of a bridge the level of the bridge, both its branches coming down beyond it', () => {
    // West to east: ground, a bridge from −60 to the turnout at 0, then two tracks on the ground
    const line = along([-300, 0], [-60, 0], 40).map(([x, y], i) => osmNode(1 + i, x, y))
    const points = osmNode(10, 0, 0, { railway: 'switch' })
    const straight = along([40, 0], [300, 0], 40).map(([x, y], i) => osmNode(11 + i, x, y))
    const branch = [[40, 2.5], [80, 7], [120, 13], [200, 27], [300, 45]].map(([x, y], i) => osmNode(31 + i, x, y))
    const under = osmTrack(300, 41, along([-30, -200], [-30, 200], 50)).elements
    const result = convertOsm(
      answer(
        line, points, straight, branch, under,
        osmWay(100, line.map((node) => node.id)),
        osmWay(101, [line[line.length - 1].id, 10], { bridge: 'yes', layer: '1' }),
        osmWay(102, [10, ...straight.map((node) => node.id)]),
        osmWay(103, [10, ...branch.map((node) => node.id)]),
      ),
      apart(),
    )
    const { network, report } = result
    expect(report).toMatchObject({ turnouts: 1, stackedCrossings: 1, undecidedCrossings: 0 })
    expect(levelAtPlace(result, 0, 0)).toBe(1)
    expect(levelAtPlace(result, -60, 0)).toBe(1)
    // (the track below passes at x = −30)
    for (const x of [-60, -50, -40, -20, -10, 0]) expect(heightAtPlace(result, x, 0), `at ${x}`).toBe(1)
    // Both branches are back on the ground once they are clear of each other, and stay there
    for (const [x, y] of [[80, 0], [300, 0], [120, 13], [300, 45], [-70, 0], [-300, 0]]) expect(heightAtPlace(result, x, y), `at ${x}, ${y}`).toBe(0)
    const junction = [...network.junctions.values()][0]
    expect(junction.kind).toBe('turnout')
    expect(nodeLevel(network.nodes.get(junction.nodeId))).toBe(1)
    expect(report.issues.filter((issue) => issue.kind === 'uncertain-level')).toEqual([])
    expect(analyzeKinematics(network)).toEqual([])
    expect(openInEditor(network)).toEqual({ splitCount: 0, weldedCount: 0, unchanged: true })
  })

  it('gives a node shared by two structures the level furthest from the ground, and reports a bridge that runs into a tunnel', () => {
    const nodes = along([-300, 0], [300, 0], 50).map(([x, y], i) => osmNode(1 + i, x, y))
    const deeper = convertOsm(answer(nodes, osmWay(100, [1, 2, 3, 4, 5], { tunnel: 'yes', layer: '-1' }), osmWay(101, [5, 6, 7, 8, 9], { tunnel: 'yes', layer: '-2' }), osmWay(102, [9, 10, 11, 12, 13])), apart())
    expect(heightAtPlace(deeper, -200, 0)).toBe(-1)
    expect(levelAtPlace(deeper, -100, 0)).toBe(-2)
    expect(heightAtPlace(deeper, 0, 0)).toBe(-2)
    expect(levelAtPlace(deeper, 100, 0)).toBe(-2)
    expect(heightAtPlace(deeper, 200, 0)).toBe(0)
    expect(deeper.report.issues.filter((issue) => issue.kind === 'uncertain-level')).toEqual([])

    const opposite = convertOsm(answer(nodes, osmWay(100, [1, 2, 3, 4, 5, 6, 7], { bridge: 'yes', layer: '1' }), osmWay(101, [7, 8, 9, 10, 11, 12, 13], { tunnel: 'yes', layer: '-1' })), apart())
    // The bridge wins the node, and the place is reported
    expect(levelAtPlace(opposite, 0, 0)).toBe(1)
    expect(heightAtPlace(opposite, -100, 0)).toBe(1)
    expect(heightAtPlace(opposite, 100, 0)).toBe(-1)
    const issues = opposite.report.issues.filter((issue) => issue.kind === 'uncertain-level')
    expect(issues.map((issue) => issue.osmIds)).toEqual([[7]])
    expect(issues[0].detail).toContain('-1, 1')
  })
})

describe('devices', () => {
  /** Four tracks out of node 1 at the origin, two each way, the two lines 8° apart */
  const four = (tags?: Record<string, string>): OverpassElement[] => {
    const lean = Math.tan((4 * Math.PI) / 180)
    const arm = (wayId: number, firstId: number, dx: number, dy: number): OverpassElement[] => {
      const places = along([dx * 40, dy * 40 * lean], [dx * 280, dy * 280 * lean], 40)
      const ids = places.map((_, i) => firstId + i)
      return [...places.map(([x, y], i) => osmNode(ids[i], x, y)), osmWay(wayId, [1, ...ids])]
    }
    return [osmNode(1, 0, 0, tags), ...arm(100, 10, 1, 1), ...arm(101, 20, 1, -1), ...arm(102, 30, -1, 1), ...arm(103, 40, -1, -1)]
  }

  it('reads a turnout where a switch joins three tracks, the main one running through without a kink', () => {
    const branch = [[50, 3], [100, 8], [150, 15], [250, 33]].map(([x, y], i) => osmNode(40 + i, x, y))
    const data = answer(groundTrack().map((el) => (el.id === 7 && el.type === 'node' ? { ...el, tags: { railway: 'switch' } } : el)), branch, osmWay(110, [7, 40, 41, 42, 43]))
    const { network, report } = convertOsm(data, options())
    expect(report).toMatchObject({ turnouts: 1, doubleSlips: 0, fixedCrossings: 0 })
    expect(report.issues.filter((issue) => issue.kind !== 'cut-by-area')).toEqual([])
    expect(analyzeKinematics(network)).toEqual([])
    const junction = [...network.junctions.values()][0]
    const view = junction.passages.map((passage) => network.segments.get(passage.b)!)
    // The straight route is the main track: a straight rail on each side of the points
    expect(network.segments.get(junction.passages[0].a)!.kind).toBe('straight')
    expect(view[0].kind).toBe('straight')
    expect(openInEditor(network)).toEqual({ splitCount: 0, weldedCount: 0, unchanged: true })
    // …and a train runs through it from one end of the line to the other
    const west = railAtEnd(network, (x) => x < -250)
    expect(walkForward(network, west.segId, west.t, west.forward, 599)).not.toBeNull()
    expect(walkForward(network, west.segId, west.t, west.forward, 610)).toBeNull()
  })

  it('reads a double slip where OSM tags one, its four rails bent onto one line', () => {
    const tagged: Record<string, string>[] = [{ railway: 'switch', 'railway:switch': 'double_slip' }, { railway: 'switch', 'railway:switch': 'single_slip' }, { railway: 'switch' }]
    for (const tags of tagged) {
      const { network, report } = convertOsm(answer(four(tags)), options())
      expect(report, JSON.stringify(tags)).toMatchObject({ doubleSlips: 1, turnouts: 0, fixedCrossings: 0 })
      expect(report.issues.filter((issue) => issue.kind !== 'cut-by-area')).toEqual([])
      expect(analyzeKinematics(network)).toEqual([])
      expect(openInEditor(network)).toEqual({ splitCount: 0, weldedCount: 0, unchanged: true })
      const node = nodesWithRails(network, 4)[0]
      expect(findJunctionAtNode(network, node.id)?.kind).toBe('double_slip')
    }
  })

  it('reads a fixed crossing where two tracks share a node that is not a switch', () => {
    for (const tags of [{ railway: 'railway_crossing' }, undefined]) {
      const { network, report } = convertOsm(answer(four(tags)), options())
      expect(report, JSON.stringify(tags)).toMatchObject({ doubleSlips: 0, turnouts: 0, fixedCrossings: 1 })
      expect(report.issues.filter((issue) => issue.kind !== 'cut-by-area')).toEqual([])
      expect(network.junctions.size).toBe(0)
      expect(analyzeKinematics(network)).toEqual([])
      expect(openInEditor(network).unchanged).toBe(true)
      // Each track runs straight through: from the south-west end the train comes out north-east
      const start = railAtEnd(network, (x, y) => x < 0 && y > 0)
      const end = walkForward(network, start.segId, start.t, start.forward, 540)!
      const rail = network.segments.get(end.segId)!
      const there = network.nodes.get(end.forward ? rail.to : rail.from)!.pos
      expect(there.x).toBeGreaterThan(0)
      expect(there.y).toBeLessThan(0)
    }
  })

  it('reports a node OSM tags as a double slip that cannot be one', () => {
    // The two tracks cross at 40°: no train passes from one to the other
    const steep = four({ railway: 'switch', 'railway:switch': 'double_slip' }).map((el) => (el.type === 'node' && el.id !== 1 ? osmNode(el.id, (el.lon! - 5) * 111_320 * Math.cos((47 * Math.PI) / 180), -(el.lat! - 47) * 111_170 * 5.2) : el))
    const { report } = convertOsm(answer(steep), options())
    expect(report).toMatchObject({ doubleSlips: 0, fixedCrossings: 1 })
    const issue = report.issues.find((found) => found.kind === 'unknown-junction')!
    expect(issue.osmIds).toEqual([1])
  })

  it('reports a node where five tracks meet', () => {
    const fifth = [osmNode(60, 0, 100), osmNode(61, 0, 200), osmWay(120, [1, 60, 61])]
    const { report } = convertOsm(answer(four({ railway: 'switch' }), fifth), options())
    const issue = report.issues.find((found) => found.kind === 'unknown-junction')!
    expect(issue.osmIds).toEqual([1])
    expect(issue.detail).toContain('5')
  })

  it('reports a corner no train can take, with the OSM node it is on', () => {
    const corner = [...along([-200, 0], [0, 0], 40), ...along([0, 40], [0, 200], 40)].map(([x, y], i) => osmNode(1 + i, x, y))
    const result = convertOsm(answer(corner, osmWay(100, corner.map((node) => node.id))), options())
    const issues = result.report.issues.filter((issue) => issue.kind === 'sharp-angle')
    expect(issues.map((issue) => issue.osmIds)).toEqual([[6]])
    const place = placeIn(result, 0, 0)
    expect(Math.hypot(issues[0].x - place.x, issues[0].y - place.y)).toBeLessThan(0.5)
    // The corner is left as it is drawn: two straight rails
    expect(result.report.rails).toBe(2)
    expect(analyzeKinematics(result.network)).toHaveLength(1)
  })

  it('tells a track cut by the edge of the area from a track that ends', () => {
    // A cross of two lines that run out of the area, a spur that ends inside it, a buffer stop
    const eastWest = osmTrack(100, 1, along([-600, 0], [600, 0], 100)).elements
    const northSouth = [...along([0, -600], [0, -100], 100), ...along([0, 100], [0, 600], 100)].map(([x, y], i) => osmNode(21 + i, x, y))
    const spur = [osmNode(50, 150, 8), osmNode(51, 200, 20), osmNode(52, 300, 40)]
    const stop = [osmNode(53, -150, 8), osmNode(54, -200, 20), osmNode(55, -300, 40, { railway: 'buffer_stop' })]
    // Whatever else the answer holds reaches into the area asked for: here platforms near its corners
    const corners = [[-400, -400], [400, -400], [-400, 400], [400, 400]].flatMap(([x, y], i) => [osmNode(70 + 2 * i, x, y), osmNode(71 + 2 * i, x + 20, y), osmWay(300 + i, [70 + 2 * i, 71 + 2 * i], { railway: 'platform' })])
    const data = answer(eastWest, northSouth, spur, stop, corners, osmWay(101, [...northSouth.slice(0, 6).map((n) => n.id), 7, ...northSouth.slice(6).map((n) => n.id)]), osmWay(102, [8, 50, 51, 52]), osmWay(103, [6, 53, 54, 55]))
    const result = convertOsm(data, options())
    const cut = result.report.issues.filter((issue) => issue.kind === 'cut-by-area')
    expect(cut.map((issue) => issue.osmIds[0]).sort((a, b) => a - b)).toEqual([1, 13, 21, 32])
    expect(cut.every((issue) => issue.osmIds.length === 2)).toBe(true)
    expect(result.report.droppedComponents).toBe(0)
  })

  it('reports as cut by the area a way that names a node the answer does not hold', () => {
    const data = answer(groundTrack().filter((el) => el.id !== 13 || el.type !== 'node'), osmNode(1, -300, 0, { railway: 'buffer_stop' }))
    const result = convertOsm(data, options())
    expect(result.report.lengthKm).toBeCloseTo(0.55, 2)
    expect(result.report.issues.filter((issue) => issue.kind === 'cut-by-area').map((issue) => issue.osmIds)).toEqual([[12, 100]])
  })
})

describe('speed zones', () => {
  /** A line of five ways on nodes 1 to 25, 300 m each, with a service siding off node 7 */
  const line = (): OverpassElement[] => {
    const nodes = along([0, 0], [1200, 0], 50).map(([x, y], i) => osmNode(1 + i, x, y, i === 6 ? { railway: 'switch' } : undefined))
    const ids = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)
    const siding = [[350, 3], [400, 8], [450, 14], [550, 30], [700, 55]].map(([x, y], i) => osmNode(40 + i, x, y))
    return [
      ...nodes,
      ...siding,
      osmWay(100, ids(1, 4), { maxspeed: '120' }),
      osmWay(101, ids(4, 7), { maxspeed: '120' }),
      osmWay(102, ids(7, 13), { maxspeed: '120' }),
      osmWay(103, ids(13, 19), { 'maxspeed:forward': '90', 'maxspeed:backward': '55' }),
      osmWay(104, ids(19, 25)),
      osmWay(110, [7, 40, 41, 42, 43, 44], { service: 'siding' }),
    ]
  }

  it('lays one zone over the ways that follow each other at the same speed, through the turnout', () => {
    const { network, report, lineSpeed } = convertOsm(answer(line()), options())
    const zones = [...network.speedZones.values()].sort((a, b) => b.speed - a.speed)
    expect(zones.map((zone) => zone.speed)).toEqual([120, 50, 30])
    expect(report.speedZones).toBe(3)
    // 120 from the start to node 13, across three ways and the points at node 7
    expect(Math.abs(zoneLength(network, zones[0]) - 600)).toBeLessThan(3)
    // The lower of the two directions, brought down to a zone speed, never up
    expect(Math.abs(zoneLength(network, zones[1]) - 300)).toBeLessThan(3)
    // The service track takes the default
    expect(zoneLength(network, zones[2])).toBeGreaterThan(350)
    expect(lineSpeed).toBe(120)
    expect(report.lengthWithoutSpeedKm).toBeCloseTo(0.3, 2)
    expect(openInEditor(network)).toEqual({ splitCount: 0, weldedCount: 0, unchanged: true })
  })

  it('names the track in order from one end of the zone to the other', () => {
    const { network } = convertOsm(answer(line()), options())
    for (const zone of network.speedZones.values()) {
      for (let i = 1; i < zone.spans.length; i++) {
        const before = zone.spans[i - 1]
        const after = zone.spans[i]
        const leftAt = before.t1 > before.t0 ? network.segments.get(before.segId)!.to : network.segments.get(before.segId)!.from
        const entersAt = after.t1 > after.t0 ? network.segments.get(after.segId)!.from : network.segments.get(after.segId)!.to
        expect(entersAt, `zone ${zone.speed}, stretch ${i}`).toBe(leftAt)
      }
    }
  })

  it('gives service tracks the speed asked for, and none when it is zero', () => {
    const speeds = (over: Parameters<typeof options>[0]): number[] => [...convertOsm(answer(line()), options(over)).network.speedZones.values()].map((zone) => zone.speed).sort((a, b) => a - b)
    expect(speeds({ defaultServiceSpeed: 40 })).toEqual([40, 50, 120])
    expect(speeds({ defaultServiceSpeed: 45 })).toEqual([40, 50, 120])
    expect(speeds({ defaultServiceSpeed: 0 })).toEqual([50, 120])
  })

  it('lays no zone and reads no line speed when speed limits are not asked for', () => {
    const result = convertOsm(answer(line()), options({ speedLimits: false }))
    expect(result.network.speedZones.size).toBe(0)
    expect(result.report.speedZones).toBe(0)
    expect(result.lineSpeed).toBeUndefined()
  })

  it('reads a high-speed line from its tracks', () => {
    const fast = convertOsm(answer(groundTrack({ maxspeed: '300', highspeed: 'yes' })), options())
    expect(fast).toMatchObject({ highSpeed: true, lineSpeed: 300 })
    expect(convertOsm(answer(groundTrack({ 'railway:tvm': '430' })), options()).highSpeed).toBe(true)
    expect(convertOsm(answer(groundTrack({ 'railway:tvm': 'no', maxspeed: '160' })), options()).highSpeed).toBe(false)
  })
})

describe('survey before the import', () => {
  it('counts what the options keep', () => {
    const data: OverpassResponse = {
      osm3s: { timestamp_osm_base: '2026-10-06T07:14:21Z' },
      elements: [
        ...groundTrack().map((el) => (el.type === 'node' && el.id === 4 ? { ...el, tags: { railway: 'signal', 'railway:signal:main': 'FR:CARRE', 'railway:signal:direction': 'forward' } } : el.type === 'node' && el.id === 5 ? { ...el, tags: { railway: 'signal' } } : el)),
        ...crossingTrack({ bridge: 'yes', layer: '1' }),
        osmNode(90, 0, 0, { railway: 'signal', 'railway:signal:main': 'FR:S', 'railway:signal:direction': 'backward' }),
      ],
    }
    const survey = surveyOsm(data, options({ keepDetachedOverKm: 0 }))
    expect(survey).toMatchObject({ ways: 4, serviceWays: 0, switches: 0, bridges: 1, tunnels: 0, signals: 2, typedMainSignals: 1, extraKinds: {}, detachedKm: 0 })
    expect(survey.lengthKm).toBeCloseTo(1.2, 2)
    expect(convertOsm(data, options()).dataDate).toBe('2026-10-06T07:14:21Z')
  })
})
