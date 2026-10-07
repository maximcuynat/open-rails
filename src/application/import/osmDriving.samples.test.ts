import { describe, expect, it, vi } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { convertOsm } from '@domain/import/osmImport'
import { options, readFixture } from '@domain/import/osmImport.testkit'
import { findJunctionAtNode, openPassage } from '@domain/models/junction'
import { positionOnSegment, segmentPartialLength } from '@domain/models/locomotive'
import { resetIdCounter } from '@domain/models/network'
import type { Network, NodeId, Point } from '@domain/models/types'
import { findTrackPath, type TrackPath, type TrackPoint } from '@domain/services/trackPath'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { drive } from '../../examples/driving.testkit'
import { buildOsmProject } from './osmProject'

// A train driven across an imported area by a driver who reads nothing but the console (the
// careful driver of the example tests): limit in force, lower limit announced, stopping place.

// Converting Dijon and driving 4 km of it
vi.setConfig({ testTimeout: 60_000 })

/** The fixture as the import dialog loads it: full size, levels without relief */
function openSample(name: string): { store: EditorStore; edges: NodeId[] } {
  resetMemoryStorage()
  resetIdCounter()
  const result = convertOsm(readFixture(name), options())
  const store = new EditorStore()
  store.loadFromData(buildOsmProject(result, { levels: true, now: new Date('2026-10-06T12:00:00Z') }))
  const net = store.network
  // Track ends that are the edge of the area, not buffer stops
  const cuts = result.report.issues.filter((issue) => issue.kind === 'cut-by-area')
  const edges = [...net.nodes.values()]
    .filter((node) => (net.adjacency.get(node.id) ?? []).length === 1)
    .filter((node) => cuts.some((cut) => Math.hypot(cut.x - node.pos.x, cut.y - node.pos.y) < 1e-6))
    .map((node) => node.id)
  return { store, edges }
}

function trackEnd(net: Network, nodeId: NodeId): TrackPoint {
  const seg = net.segments.get(net.adjacency.get(nodeId)![0])!
  return { segId: seg.id, t: seg.from === nodeId ? 0 : 1 }
}

/** The longest of the shortest ways from one edge of the area to another */
function longestRoute(net: Network, edges: NodeId[]): { from: NodeId; to: NodeId; path: TrackPath } {
  let longest: { from: NodeId; to: NodeId; path: TrackPath } | null = null
  for (const from of edges) {
    for (const to of edges) {
      const path = from === to ? null : findTrackPath(net, trackEnd(net, from), trackEnd(net, to))
      if (path && path.spans.length > 0 && (!longest || path.length > longest.path.length)) longest = { from, to, path }
    }
  }
  return longest!
}

/** Throw the points of a route for it */
function setRoute(net: Network, path: TrackPath): void {
  for (let i = 0; i + 1 < path.spans.length; i++) {
    const one = net.segments.get(path.spans[i].segId)!
    const two = net.segments.get(path.spans[i + 1].segId)!
    if (one.id === two.id) continue
    const junction = findJunctionAtNode(net, path.spans[i].t1 > path.spans[i].t0 ? one.to : one.from)
    if (junction) expect(openPassage(junction, one.id, two.id)).toBe(true)
  }
}

/** The place `distance` m along a route, and whether the route runs its rail from `from` to `to` there */
function placeAlong(net: Network, path: TrackPath, distance: number): { pos: Point; ascending: boolean } {
  let left = distance
  for (const span of path.spans) {
    const length = segmentPartialLength(net, span.segId, span.t0, span.t1)
    if (left <= length) {
      const t = span.t0 + (span.t1 - span.t0) * (left / Math.max(length, 1e-9))
      return { pos: positionOnSegment(net, span.segId, t)!, ascending: span.t1 > span.t0 }
    }
    left -= length
  }
  throw new Error('route shorter than asked')
}

describe('driving an imported area by the console', () => {
  it('Dijon, 4 km in from an edge: no derailment, never over the limit', () => {
    const { store, edges } = openSample('dijon-ville')
    const net = store.network
    // The way back along the longest route: the one with a 60 km/h zone right behind a short curve at 150
    const out = longestRoute(net, edges)
    const path = findTrackPath(net, trackEnd(net, out.to), trackEnd(net, out.from))!
    expect(path.length).toBeGreaterThan(8000)
    setRoute(net, path)

    // A locomotive and three coaches, 160 m from the edge
    const from = 160
    const start = placeAlong(net, path, from)
    store.trainPlacementDirection = start.ascending ? 1 : -1
    expect(store.placeTrainLoco(start.pos)).toBe(true)
    for (let i = 1; i <= 3; i++) expect(store.placeTrainItem(placeAlong(net, path, from - 22 * i).pos, 'tgv_wagon')).toBe(true)
    expect(store.trains).toHaveLength(1)
    store.togglePlayMode()

    // To a stop 4 km along: past the zone, 2.4 km in, and half the time the whole route takes
    const toRun = 4000 - from
    let run = 0
    let top = 0
    let over = 0
    const log = drive(
      store,
      (so) => {
        run = so.distance
        const train = store.selectedTrain!
        const speed = train.currentSpeed * 3.6
        top = Math.max(top, speed)
        over = Math.max(over, speed - store.selectedTrainDynamics!.speedLimit * 3.6)
        return !!train.derailed || (toRun - run <= 40 && train.currentSpeed < 0.05)
      },
      1500,
      () => toRun - run,
    )

    expect(log.faults).toEqual([])
    expect(over).toBeLessThanOrEqual(0)
    // It did run, and got there
    expect(top).toBeGreaterThan(100)
    expect(toRun - log.distance).toBeLessThanOrEqual(40)
  })
})
