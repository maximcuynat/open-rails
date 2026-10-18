import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, resetIdCounter } from '../../domain/models/network'
import { addPlatform, edgeLength, pointOnEdge } from '../../domain/models/platforms'
import { addStation } from '../../domain/models/stations'
import type { Network } from '../../domain/models/types'
import { deserializeNetwork, serializeNetwork, type SerializedProject } from './persistence'
import { mergeProjects, renumberProject } from './projectMerge'
import { sliceProject, unionProjects } from './projectSlices'

const through = (p: SerializedProject): SerializedProject => JSON.parse(JSON.stringify(p))

/**
 * Two rails along y = `y`, through x = 0, 300, 600 (or the other way when `reversed`), a station
 * and a platform between x = 100 and x = 500, walked the way the rails run, with a marker 10 m in.
 */
function project(options: { y?: number; name?: string; reversed?: boolean; platform?: boolean } = {}): SerializedProject {
  const { y = 0, name = 'Gare', reversed = false, platform = true } = options
  const net: Network = createNetwork()
  const xs = reversed ? [600, 300, 0] : [0, 300, 600]
  const nodes = xs.map((x) => addNode(net, { x, y }))
  const rails = nodes.slice(1).map((node, i) => addSegment(net, nodes[i].id, node.id)!)
  const station = addStation(net, { name, pos: { x: 300, y: y - 20 }, stops: [] })
  if (platform) {
    // Along the rails: from x = 100 to x = 500, or from x = 500 to x = 100 when they run the other way
    const track = [{ segId: rails[0].id, t0: 1 / 3, t1: 1 }, { segId: rails[1].id, t0: 0, t1: 2 / 3 }]
    addPlatform(net, { stationId: station.id, edges: [{ track, side: reversed ? 'left' : 'right', ref: '1' }], width: 6, markers: [{ edge: 0, at: 10, heading: 'backward' }] })
  }
  return through(serializeNetwork(net, name))
}

beforeEach(() => resetIdCounter(0))

describe('platforms in a merge', () => {
  it('renumbering renames the platform, its station and its rails; one of a station the file lacks goes', () => {
    const source = project()
    const renamed = renumberProject(source, 100)
    const [platform] = renamed.platforms!
    expect(platform.id).not.toBe(source.platforms![0].id)
    expect(platform.stationId).toBe(renamed.stations![0].id)
    const rails = new Set(renamed.segments.map((seg) => seg.id))
    expect(platform.edges[0].track.every((span) => rails.has(span.segId))).toBe(true)

    const orphan = renumberProject({ ...source, stations: undefined }, 100)
    expect(orphan.platforms).toBeUndefined()
  })

  it('a platform elsewhere is added with its station; the merged project loads with it', () => {
    const current = project()
    const { project: merged, report } = mergeProjects(current, project({ y: 200, name: 'Autre' }), { tolerance: 0.1 })
    expect(report.platformsAdded).toBe(1)
    expect(merged.platforms).toHaveLength(2)
    const added = merged.platforms![1]
    expect(merged.stations!.find((s) => s.id === added.stationId)!.name).toBe('Autre')
    const net = deserializeNetwork(through(merged)).network
    expect(net.platforms.size).toBe(2)
    const loaded = net.platforms.get(added.id)!
    expect(edgeLength(net, loaded.edges[0])).toBeCloseTo(400, 6)
    expect(pointOnEdge(net, loaded.edges[0], 10)!.point).toEqual({ x: expect.closeTo(110, 6), y: expect.closeTo(200, 6) })
  })

  it('a platform on the rails of the current project that has one there is left out; on rails drawn the other way it turns round with them', () => {
    const same = mergeProjects(project(), project(), { tolerance: 0.1 })
    expect(same.report.platformsAdded).toBe(0)
    expect(same.project.platforms).toHaveLength(1)

    // The current project has the track, the incoming one the same track drawn from the east, with a platform
    const { project: merged, report } = mergeProjects(project({ platform: false }), project({ reversed: true }), { tolerance: 0.1 })
    expect(report.railsDropped).toBe(2)
    expect(report.platformsAdded).toBe(1)
    // The station is the one of the current project
    expect(merged.platforms![0].stationId).toBe(merged.stations![0].id)
    expect(merged.stations).toHaveLength(1)
    const net = deserializeNetwork(through(merged)).network
    const platform = [...net.platforms.values()][0]
    expect(edgeLength(net, platform.edges[0])).toBeCloseTo(400, 6)
    // Still walked from x = 500 to x = 100: the marker 10 m in stands at x = 490, and the side is kept
    expect(pointOnEdge(net, platform.edges[0], 10)!.point.x).toBeCloseTo(490, 6)
    expect(platform.edges[0].side).toBe('left')
    // The stops of the station come from the marker
    expect([...net.stations.values()][0].stops).toHaveLength(1)
  })
})

describe('platforms in slices', () => {
  it('a platform goes whole to every slice that holds one of its rails, with its station; the union holds it once', () => {
    const whole = project()
    const [first, second] = whole.segments.map((seg) => seg.id)
    const west = sliceProject(whole, (id) => id === first)
    const east = sliceProject(whole, (id) => id === second)
    expect(west.platforms).toEqual(whole.platforms)
    expect(east.platforms).toEqual(whole.platforms)
    expect(west.stations!.map((s) => s.id)).toEqual(whole.stations!.map((s) => s.id))
    expect(sliceProject(whole, () => false).platforms).toBeUndefined()

    const union = unionProjects([through(west), through(east)])
    expect(union.platforms).toEqual(whole.platforms)
    const damaged = through(east)
    damaged.platforms![0].width = 3
    expect(() => unionProjects([west, damaged])).toThrow(/Platform/)

    // Loaded alone, a slice keeps the part of the platform it has the track of
    const net = deserializeNetwork(through(west)).network
    const platform = [...net.platforms.values()][0]
    expect(platform.edges[0].track.map((span) => span.segId)).toEqual([first])
    expect(edgeLength(net, platform.edges[0])).toBeCloseTo(200, 6)
  })
})
