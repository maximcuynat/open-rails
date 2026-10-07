import { describe, it, expect, vi } from 'vitest'
import { convertOsm, surveyOsm } from './osmImport'
import type { OsmImportIssue, OsmImportOptions, OsmImportResult, OverpassResponse } from './osmTypes'
import { countOsmCrossings, distancesToTrack, openInEditor, options, readFixture } from './osmImport.testkit'
import { projectionFor } from './osmProjection'
import { walkForward, type WalkTrace } from '../models/locomotive'
import { exitsOf } from '../models/routing'
import { MAX_LEVEL, MIN_LEVEL, nodeLevel, resetIdCounter } from '../models/network'
import type { Network } from '../models/types'
import { analyzeKinematics } from '../services/kinematicDiagnostics'

// The four areas of `fixtures/`, as OpenStreetMap had them on 2026-10-06: a station and its
// junctions (Dijon), a single track in the mountains (Clelles), a high-speed line and its flying
// junction (Pasilly), and the tracks out of Paris Gare de Lyon, on the ground and under it.

// Paris is thousands of rails, and the check of the editor compares them all with each other
vi.setConfig({ testTimeout: 120_000 })

const converted = new Map<string, { data: OverpassResponse; options: OsmImportOptions; result: OsmImportResult; milliseconds: number }>()

/** An area converted once for all the tests that look at it */
/** The largest network alone: nothing detached is long enough to be kept with it */
const MAIN_ONLY: Partial<OsmImportOptions> = { keepDetachedOverKm: 1e9 }

function sample(name: string, over: Partial<OsmImportOptions> = {}): { data: OverpassResponse; options: OsmImportOptions; result: OsmImportResult; milliseconds: number } {
  const key = `${name} ${JSON.stringify(over)}`
  let found = converted.get(key)
  if (!found) {
    const data = readFixture(name)
    const opts = options(over)
    resetIdCounter()
    const start = performance.now()
    const result = convertOsm(data, opts)
    found = { data, options: opts, result, milliseconds: performance.now() - start }
    converted.set(key, found)
  }
  return found
}

function issuesByKind(result: OsmImportResult): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const issue of result.report.issues) counts[issue.kind] = (counts[issue.kind] ?? 0) + 1
  return counts
}

/** The rail a train leaves a track end on, the end being the place an issue names */
function railAtIssue(net: Network, issue: OsmImportIssue): { segId: string; t: number; forward: boolean } {
  for (const node of net.nodes.values()) {
    if (Math.hypot(node.pos.x - issue.x, node.pos.y - issue.y) > 1e-6) continue
    const seg = net.segments.get(net.adjacency.get(node.id)![0])!
    return seg.from === node.id ? { segId: seg.id, t: 0, forward: true } : { segId: seg.id, t: 1, forward: false }
  }
  throw new Error('no node at the place of the issue')
}

/** How far (m) a train runs from a track end before the track ends for it, up to `limit` */
function runFrom(net: Network, issue: OsmImportIssue, limit: number): number {
  const start = railAtIssue(net, issue)
  let reached = 0
  for (let step = limit; step >= 1; step /= 2) {
    while (reached + step <= limit && walkForward(net, start.segId, start.t, start.forward, reached + step)) reached += step
  }
  return reached
}

/** The track ends a train can reach from a track end, the points being thrown for it wherever it needs them */
function endsReachedFrom(net: Network, issue: OsmImportIssue): Set<string> {
  const start = railAtIssue(net, issue)
  const reached = new Set<string>()
  const seen = new Set<string>()
  const todo: { segId: string; forward: boolean }[] = [start]
  while (todo.length > 0) {
    const { segId, forward } = todo.pop()!
    if (seen.has(`${segId} ${forward}`)) continue
    seen.add(`${segId} ${forward}`)
    const seg = net.segments.get(segId)!
    const exit = forward ? seg.to : seg.from
    if (net.adjacency.get(exit)!.length === 1) reached.add(exit)
    for (const next of exitsOf(net, exit, segId, { anyPosition: true })) todo.push({ segId: next, forward: net.segments.get(next)!.from === exit })
  }
  return reached
}

/** The node an issue is at */
function nodeAtIssue(net: Network, issue: OsmImportIssue): string {
  return [...net.nodes.values()].find((node) => Math.hypot(node.pos.x - issue.x, node.pos.y - issue.y) < 1e-6)!.id
}

const AREAS: { name: string; over?: Partial<OsmImportOptions> }[] = [
  { name: 'clelles-mens' },
  { name: 'lgv-pasilly' },
  { name: 'dijon-ville' },
  { name: 'paris-gare-de-lyon' },
  // The whole of the Paris area: the tracks of the surface and the ones that only pass under them
  { name: 'paris-gare-de-lyon', over: { keepDetachedOverKm: 0 } },
  // …and with the tram, the disused tracks and the metro
  { name: 'dijon-ville', over: { keepDetachedOverKm: 0, extraKinds: ['tram'], disusedTracks: true } },
  { name: 'paris-gare-de-lyon', over: { keepDetachedOverKm: 0, extraKinds: ['subway'] } },
]

describe('sample areas', () => {
  for (const { name, over } of AREAS) {
    describe(`${name}${over ? ` ${JSON.stringify(over)}` : ''}`, () => {
      it('is laid as the editor will keep it: nothing to weld, cut or drop when it is opened', () => {
        const { result } = sample(name, over)
        const { report, network } = result
        expect(report.nodes).toBe(network.nodes.size)
        expect(report.rails).toBe(network.segments.size)
        expect(report.speedZones).toBe(network.speedZones.size)
        expect(report.turnouts + report.doubleSlips).toBe(network.junctions.size)
        for (const rails of network.adjacency.values()) expect(rails.length).toBeGreaterThan(0)
        expect(openInEditor(network)).toEqual({ splitCount: 0, weldedCount: 0, unchanged: true })
      })

      it('reports every place a train cannot pass, and has no other', () => {
        const { result } = sample(name, over)
        const found = analyzeKinematics(result.network)
        const reported = result.report.issues.filter((issue) => issue.kind === 'sharp-angle' || issue.kind === 'unknown-junction')
        for (const fault of found) {
          const at = result.network.nodes.get(fault.nodeId)!.pos
          expect(reported.some((issue) => Math.hypot(issue.x - at.x, issue.y - at.y) < 1e-6), `${fault.kind} at ${at.x.toFixed(1)}, ${at.y.toFixed(1)}`).toBe(true)
        }
        // No bend in the middle of a track: what is found is at nodes OSM itself joins tracks on
        for (const issue of reported) expect(issue.osmIds.length).toBe(1)
      })

      // The two that follow compare the network with every track of the answer: they need the
      // whole of it, which the first Paris entry is not
      const whole = over?.keepDetachedOverKm === 0 || name !== 'paris-gare-de-lyon'

      it.runIf(whole)('stays on the tracks OpenStreetMap draws', () => {
        const { data, options: opts, result } = sample(name, over)
        expect(result.report.droppedComponents).toBe(0)
        const project = projectionFor(result.frame, result.origin)
        const kinds = ['rail', ...opts.extraKinds, ...(opts.disusedTracks ? ['disused', 'abandoned'] : [])]
        const used = new Set<number>()
        for (const el of data.elements) if (el.type === 'way' && kinds.includes(el.tags?.railway ?? '')) for (const id of el.nodes!) used.add(id)
        const places = data.elements.filter((el) => el.type === 'node' && used.has(el.id)).map((el) => project(el.lat!, el.lon!))
        const off = distancesToTrack(result.network, places).sort((a, b) => a - b)
        expect(off.length).toBeGreaterThan(400)
        // Half of the nodes within 15 cm, nearly all within the tolerance of the fitting, and the
        // few that are not — nodes off their own track, tracks bent onto a double slip — within 3 m
        expect(off[off.length >> 1]).toBeLessThan(0.15)
        // Clelles is a mountain line drawn with a node every 30 to 45 m in curves of 250 m of radius:
        // laid within 30 cm of each, it was straight lines and bends of 40 to 60 m of radius, 20 to
        // 40 km/h under a zone of 70. The nodes of those curves are left by up to 90 cm (8 % of them
        // by more than 35 cm) for a track that can be run at the speed of its zone, or near it
        expect(off[Math.floor(off.length * 0.95)]).toBeLessThan(name === 'clelles-mens' ? 0.45 : 0.35)
        expect(off[Math.floor(off.length * 0.99)]).toBeLessThan(1)
        expect(off[off.length - 1]).toBeLessThan(3)
      })

      it.runIf(whole)('keeps every level within the range of the editor, and decides every crossing of two tracks OSM tells apart', () => {
        const { data, options: opts, result } = sample(name, over)
        for (const node of result.network.nodes.values()) {
          expect(nodeLevel(node)).toBeGreaterThanOrEqual(MIN_LEVEL)
          expect(nodeLevel(node)).toBeLessThanOrEqual(MAX_LEVEL)
        }
        const kinds = ['rail', ...opts.extraKinds, ...(opts.disusedTracks ? ['disused', 'abandoned'] : [])]
        const drawn = countOsmCrossings(data, kinds)
        const { stackedCrossings, undecidedCrossings } = result.report
        // Two tracks drawn on top of each other (one in a tunnel under the other) cut each other at
        // angles the editor does not take for a crossing: a few of those in Paris, none elsewhere
        expect(Math.abs(stackedCrossings + undecidedCrossings - drawn)).toBeLessThanOrEqual(name.startsWith('paris') ? 3 : 0)
        expect(undecidedCrossings).toBe(result.report.issues.filter((issue) => issue.kind === 'undecided-crossing').length)
      })

      it('is counted beforehand within 30 % of what is laid', () => {
        const { data, options: opts, result } = sample(name, over)
        const survey = surveyOsm(data, opts)
        expect(Math.abs(survey.estimatedRails - result.report.rails) / result.report.rails).toBeLessThan(0.3)
        expect(survey.lengthKm).toBeCloseTo(result.report.lengthKm, 0)
      })
    })
  }

  it('Clelles-Mens: a single track a train runs from one edge of the area to the other', () => {
    const { result, milliseconds } = sample('clelles-mens')
    const { report, network } = result
    expect(report).toMatchObject({ turnouts: 5, doubleSlips: 1, fixedCrossings: 0, stackedCrossings: 0, undecidedCrossings: 0, droppedComponents: 0, lengthWithoutSpeedKm: 0 })
    expect(issuesByKind(result)).toEqual({ 'cut-by-area': 2 })
    expect(report.lengthKm).toBeCloseTo(12.58, 1)
    expect(report.rails).toBeGreaterThan(300)
    expect(report.rails).toBeLessThan(450)
    expect(report.railsOnBridge).toBeGreaterThan(10)
    expect(report.railsInTunnel).toBeGreaterThan(4)
    expect(result).toMatchObject({ lineSpeed: 70, highSpeed: false, dataDate: '2026-10-06T07:27:36Z' })
    // 55 km/h is read as a zone of 50, never 60; the sidings take the default of the service tracks
    expect(new Set([...network.speedZones.values()].map((zone) => zone.speed))).toEqual(new Set([30, 40, 50, 70]))
    // From each edge of the area a train runs to the station as the points are set (6 km, where a
    // set of points is against it), and to the other edge once they are thrown for it
    const [one, other] = report.issues.filter((issue) => issue.kind === 'cut-by-area')
    for (const edge of [one, other]) expect(runFrom(network, edge, 13_000)).toBeGreaterThan(5_000)
    expect(endsReachedFrom(network, one).has(nodeAtIssue(network, other))).toBe(true)
    expect(endsReachedFrom(network, other).has(nodeAtIssue(network, one))).toBe(true)
    expect(milliseconds).toBeLessThan(20_000)
  })

  it('LGV at Pasilly: a high-speed line whose flying junction passes over the line', () => {
    const { result } = sample('lgv-pasilly')
    const { report, network } = result
    expect(report).toMatchObject({ turnouts: 11, doubleSlips: 0, fixedCrossings: 0, stackedCrossings: 2, undecidedCrossings: 0, droppedComponents: 0 })
    expect(issuesByKind(result)).toEqual({ 'cut-by-area': 6 })
    expect(result).toMatchObject({ lineSpeed: 300, highSpeed: true })
    expect(report.lengthKm).toBeCloseTo(54.0, 0)
    expect(report.rails).toBeGreaterThan(220)
    expect(report.rails).toBeLessThan(350)
    expect(new Set([...network.speedZones.values()].map((zone) => zone.speed))).toEqual(new Set([30, 160, 220, 270, 300]))
    // A train runs 9 km of it from an edge of the area, and one of the runs climbs over the line
    const edges = report.issues.filter((issue) => issue.kind === 'cut-by-area')
    expect(Math.max(...edges.map((edge) => runFrom(network, edge, 10_000)))).toBeGreaterThan(9_000)
    let highest = 0
    for (const edge of edges) {
      const start = railAtIssue(network, edge)
      const trace: WalkTrace = { spans: [], nodes: [] }
      walkForward(network, start.segId, start.t, start.forward, runFrom(network, edge, 12_000), { trace })
      for (const nodeId of trace.nodes) highest = Math.max(highest, nodeLevel(network.nodes.get(nodeId)))
    }
    expect(highest).toBe(1)
  })

  it('Dijon-Ville: a station, its turnouts and double slips, its bridges', () => {
    const { result } = sample('dijon-ville', MAIN_ONLY)
    const { report } = result
    expect(report).toMatchObject({ turnouts: 116, doubleSlips: 19, fixedCrossings: 6, stackedCrossings: 3, undecidedCrossings: 0, droppedComponents: 0 })
    // Two tracks that end on the same node with nothing beyond: a fork without a way through, in OSM itself
    expect(issuesByKind(result)).toEqual({ 'sharp-angle': 1, 'cut-by-area': 13 })
    expect(result.report.issues.find((issue) => issue.kind === 'sharp-angle')!.osmIds).toEqual([1821382641])
    expect(result).toMatchObject({ lineSpeed: 160, highSpeed: false })
    expect(report.lengthKm).toBeCloseTo(52.0, 0)
    expect(report.rails).toBeGreaterThan(1300)
    expect(report.rails).toBeLessThan(1900)
    expect(report.speedZones).toBeGreaterThan(100)
    expect(report.lengthWithoutSpeedKm).toBeCloseTo(7.4, 1)

    // Without the service tracks: the lines alone
    const lines = sample('dijon-ville', { ...MAIN_ONLY, serviceTracks: false }).result.report
    expect(lines.lengthKm).toBeCloseTo(29.2, 0)
    expect(lines.rails).toBeLessThan(800)
    // With the tram, which passes over and under the station: 20 more crossings, all decided
    const tram = sample('dijon-ville', { keepDetachedOverKm: 0, extraKinds: ['tram'], disusedTracks: true }).result.report
    expect(tram).toMatchObject({ stackedCrossings: 23, undecidedCrossings: 0 })
  })

  it('Paris Gare de Lyon: the main network alone', () => {
    const { result, milliseconds } = sample('paris-gare-de-lyon', MAIN_ONLY)
    const { report } = result
    expect(report).toMatchObject({ turnouts: 383, doubleSlips: 64, fixedCrossings: 34, stackedCrossings: 86, undecidedCrossings: 0, droppedComponents: 25 })
    // A switch with four tracks and no type, whose tracks cross too steeply for a double slip
    expect(issuesByKind(result)).toEqual({ 'uncertain-level': 28, 'unknown-junction': 1, 'cut-by-area': 12 })
    expect(result.report.issues.find((issue) => issue.kind === 'unknown-junction')!.osmIds).toEqual([4395677722])
    expect(result).toMatchObject({ lineSpeed: 140, highSpeed: false })
    expect(report.lengthKm).toBeCloseTo(138.8, 0)
    expect(report.rails).toBeGreaterThan(3500)
    expect(report.rails).toBeLessThan(4600)
    expect(report.railsInTunnel).toBeGreaterThan(400)
    expect(surveyOsm(readFixture('paris-gare-de-lyon'), options(MAIN_ONLY)).detachedKm).toBeCloseTo(97.6, 0)
    expect(milliseconds).toBeLessThan(60_000)
  })

  it('Paris Gare de Lyon: every track of the area, 156 crossings stacked out of the 157 OSM draws, none left undecided', () => {
    const { result } = sample('paris-gare-de-lyon', { keepDetachedOverKm: 0 })
    const { report } = result
    expect(countOsmCrossings(readFixture('paris-gare-de-lyon'))).toBe(157)
    expect(report).toMatchObject({ stackedCrossings: 156, undecidedCrossings: 0, droppedComponents: 0 })
    expect(report.lengthKm).toBeCloseTo(236.4, 0)
    expect(report.rails).toBeGreaterThan(6000)
    expect(report.rails).toBeLessThan(8000)
    expect(report.railsInTunnel).toBeGreaterThan(2000)
    // The forks without a way through are in OSM: tracks that end on a node shared with no other kept track
    expect(issuesByKind(result)).toMatchObject({ 'uncertain-level': 29, 'unknown-junction': 1, 'sharp-angle': 2 })
  })

  it('Paris with the metro: tunnels at the same layer that cross are left as level crossings, and reported', () => {
    const { result } = sample('paris-gare-de-lyon', { keepDetachedOverKm: 0, extraKinds: ['subway'] })
    const { report } = result
    expect(countOsmCrossings(readFixture('paris-gare-de-lyon'), ['rail', 'subway'])).toBe(338)
    expect(report.stackedCrossings).toBe(328)
    expect(report.undecidedCrossings).toBe(7)
    const undecided = report.issues.filter((issue) => issue.kind === 'undecided-crossing')
    expect(undecided).toHaveLength(7)
    for (const issue of undecided) expect(issue.osmIds).toHaveLength(2)
  })
})
