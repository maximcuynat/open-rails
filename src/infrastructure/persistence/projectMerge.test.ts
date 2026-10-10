import { describe, expect, it } from 'vitest'
import { convertOsm } from '@domain/import/osmImport'
import { options, readFixture } from '@domain/import/osmImport.testkit'
import { syncJunctions } from '@domain/models/junction'
import { findSectionChains } from '@domain/models/sections'
import { resetIdCounter } from '@domain/models/network'
import { splitSpeedZonesBy } from '@domain/models/speedZones'
import type { Network } from '@domain/models/types'
import { segmentLength } from '@domain/services/pathfinding'
import { buildOsmProject } from '@application/import/osmProject'
import { deserializeNetwork, type SerializedProject } from './persistence'
import { highestIdNumber, mergeProjects, renumberProject } from './projectMerge'
import { sliceProject } from './projectSlices'

const TOLERANCE = 0.1
const through = (p: SerializedProject): SerializedProject => JSON.parse(JSON.stringify(p))
const now = new Date('2026-10-10T12:00:00Z')

function totalLength(net: Network): number {
  let sum = 0
  for (const seg of net.segments.values()) sum += segmentLength(net, seg)
  return sum
}

/** What a loaded network amounts to, whatever its ids */
function amounts(project: SerializedProject) {
  const { network } = deserializeNetwork(through(project))
  syncJunctions(network)
  return {
    nodes: network.nodes.size,
    rails: network.segments.size,
    length: Math.round(totalLength(network)),
    signals: network.signals.size,
    stations: network.stations.size,
    stops: [...network.stations.values()].reduce((sum, s) => sum + s.stops.length, 0),
    tables: network.junctions.size,
  }
}

/** A converted area, and two parts of it that share a third of its sections */
function overlapping(name: string) {
  resetIdCounter(0)
  const result = convertOsm(readFixture(name), options({ traceWays: true }))
  const group = new Map<string, number>()
  findSectionChains(result.network).forEach((section, i) => {
    for (const segId of section.segmentIds) group.set(segId, i % 3)
  })
  const groupOf = (segId: string): string => String(group.get(segId) ?? 0)
  splitSpeedZonesBy(result.network, groupOf)
  const whole = buildOsmProject(result, { levels: true, now })
  const first = sliceProject(whole, (id) => groupOf(id) !== '2')
  const second = sliceProject(whole, (id) => groupOf(id) !== '0')
  return { whole, first, second }
}

function converted(name: string, frame?: 'local' | 'lambert93'): SerializedProject {
  resetIdCounter(0)
  return buildOsmProject(convertOsm(readFixture(name), options({ traceWays: true, frame })), { levels: true, now })
}

/** Every reference of a project names something the project holds */
function expectWhole(project: SerializedProject): void {
  const nodes = new Set(project.nodes.map((n) => n.id))
  const rails = new Set(project.segments.map((s) => s.id))
  expect(nodes.size).toBe(project.nodes.length)
  expect(rails.size).toBe(project.segments.length)
  for (const seg of project.segments) expect(nodes.has(seg.from) && nodes.has(seg.to), seg.id).toBe(true)
  for (const junction of project.junctions ?? []) {
    expect(nodes.has(junction.nodeId), junction.id).toBe(true)
    for (const id of (junction.passages ?? []).flat()) expect(rails.has(id), `${junction.id} → ${id}`).toBe(true)
    for (const position of junction.positions ?? []) for (const i of position) expect(i).toBeLessThan(junction.passages!.length)
  }
  for (const signal of project.signals ?? []) expect(rails.has(signal.segId), signal.id).toBe(true)
  for (const zone of project.speedZones ?? []) for (const span of zone.spans) expect(rails.has(span.segId), zone.id).toBe(true)
  for (const station of project.stations ?? []) for (const stop of station.stops) expect(rails.has(stop.segId), station.id).toBe(true)
  for (const key in project.sectionMeta ?? {}) {
    const ids = key.split('-')
    expect(ids.every((id) => rails.has(id)), key).toBe(true)
    expect([...ids].sort()).toEqual(ids)
  }
  const ids = [...project.nodes, ...project.segments, ...(project.junctions ?? []), ...(project.speedZones ?? []), ...(project.signals ?? []), ...(project.stations ?? [])].map((x) => x.id)
  expect(new Set(ids).size).toBe(ids.length)
}

describe('a project given ids of its own', () => {
  for (const name of ['lgv-pasilly', 'clelles-mens']) {
    it(`${name}: every id is new, every reference follows, the network is the same`, () => {
      const whole = converted(name)
      const from = highestIdNumber(whole) + 1
      const renumbered = renumberProject(whole, from)
      expectWhole(renumbered)
      const before = new Set([...whole.nodes, ...whole.segments].map((x) => x.id))
      for (const item of [...renumbered.nodes, ...renumbered.segments, ...(renumbered.junctions ?? []), ...(renumbered.signals ?? []), ...(renumbered.speedZones ?? []), ...(renumbered.stations ?? [])]) {
        expect(before.has(item.id)).toBe(false)
        expect(Number(item.id.slice(item.id.lastIndexOf('_') + 1))).toBeGreaterThanOrEqual(from)
      }
      expect(renumbered.nodes[0].id.startsWith('n_')).toBe(true)
      expect(renumbered.segments[0].id.startsWith('s_')).toBe(true)
      expect(Object.keys(renumbered.sectionMeta ?? {}).length).toBe(Object.keys(whole.sectionMeta ?? {}).length)
      expect(amounts(renumbered)).toEqual(amounts(whole))
      expect(renumbered.sections).toBeUndefined()
      // The file given is left as it was
      expect(whole.nodes[0].id).toBe([...before][0])
    })
  }

  it('renames the parts of a version 1 turnout, the trains, and sorts the keys of the section settings again', () => {
    const project: SerializedProject = {
      version: 1,
      nodes: [{ id: 'n_1', x: 0, y: 0 }, { id: 'n_2', x: 10, y: 0 }, { id: 'n_9', x: 20, y: 0 }, { id: 'n_10', x: 20, y: 5 }],
      segments: [
        { id: 's_3', from: 'n_1', to: 'n_2', kind: 'straight' },
        { id: 's_9', from: 'n_2', to: 'n_9', kind: 'straight' },
        { id: 's_10', from: 'n_2', to: 'n_10', kind: 'straight' },
      ],
      junctions: [{ id: 'j_4', nodeId: 'n_2', stemNodeId: 'n_1', straightNodeId: 'n_9', divergingNodeId: 'n_10', straightSegmentId: 's_9', divergingSegmentId: 's_10', divergingRightSegmentId: 's_77', hand: 'left' }],
      sectionMeta: { 's_10-s_9': { name: 'A' }, 's_3': { name: 'B' }, 's_3-s_404': { name: 'lost' } },
      trains: [
        {
          id: 'train_5',
          direction: 1,
          vehicles: [{ id: 'veh_6', kind: 'loco', front: { segId: 's_3', t: 0.5, forward: true }, rear: { segId: 's_3', t: 0.1, forward: true } }],
        },
      ],
    }
    const out = renumberProject(project, 95)
    const id = (old: string): string => {
      const all = [...project.nodes, ...project.segments].map((x) => x.id)
      const at = all.indexOf(old)
      return at < project.nodes.length ? out.nodes[at].id : out.segments[at - project.nodes.length].id
    }
    expect(out.nodes.map((n) => n.id)).toEqual(['n_95', 'n_96', 'n_97', 'n_98'])
    expect(out.segments.map((s) => s.id)).toEqual(['s_99', 's_100', 's_101'])
    const junction = out.junctions![0]
    expect(junction).toMatchObject({ nodeId: id('n_2'), stemNodeId: id('n_1'), straightNodeId: id('n_9'), divergingNodeId: id('n_10'), straightSegmentId: id('s_9'), divergingSegmentId: id('s_10') })
    // A rail the file does not hold is not named any more: it could be a rail of the other project
    expect(junction.divergingRightSegmentId).toBeUndefined()
    // 's_100' sorts before 's_99' as a string, as the section ids do
    expect(Object.keys(out.sectionMeta!).sort()).toEqual(['s_100-s_101', 's_99'])
    expect(out.trains![0].vehicles[0].front.segId).toBe('s_99')
    expect(out.trains![0].id).not.toBe('train_5')
  })
})

describe('two projects merged into one', () => {
  for (const name of ['lgv-pasilly', 'clelles-mens']) {
    it(`${name}: two parts that overlap give the whole, nothing twice`, () => {
      const { whole, first, second } = overlapping(name)
      expect(first.segments.length + second.segments.length).toBeGreaterThan(whole.segments.length)
      // The second part comes as a file of its own would: under ids that clash with the first
      const stranger = renumberProject(through(second), 1)
      const { project, report } = mergeProjects(through(first), stranger, { tolerance: TOLERANCE })
      expectWhole(project)
      expect(report.frame).toBe('same')
      expect(report.railsDropped).toBe(first.segments.length + second.segments.length - whole.segments.length)
      expect(report.railsAdded).toBe(whole.segments.length - first.segments.length)
      expect(report.nodesAdded).toBe(whole.nodes.length - first.nodes.length)
      expect(project.segments.length).toBe(whole.segments.length)
      expect(project.nodes.length).toBe(whole.nodes.length)
      expect((project.signals ?? []).length).toBe((whole.signals ?? []).length)
      expect((project.speedZones ?? []).length).toBe((whole.speedZones ?? []).length)
      expect(Object.keys(project.sectionMeta ?? {}).length).toBe(Object.keys(whole.sectionMeta ?? {}).length)
      expect(amounts(project)).toEqual(amounts(whole))
      expect(project.osmSource).toEqual(whole.osmSource)
    })

    it(`${name}: merged with itself, nothing is added`, () => {
      const whole = converted(name)
      const { project, report } = mergeProjects(through(whole), through(whole), { tolerance: TOLERANCE })
      expect(report).toMatchObject({ nodesAdded: 0, railsAdded: 0, stationsAdded: 0, signalsAdded: 0, zonesAdded: 0, junctionsRebuilt: 0, addedBox: null })
      expect(report.nodesMerged).toBe(whole.nodes.length)
      expect(report.railsDropped).toBe(whole.segments.length)
      expect(report.junctionsDropped).toBe((whole.junctions ?? []).length)
      expect(report.stationsMerged).toBe((whole.stations ?? []).length)
      expect(project).toEqual({ ...whole, sections: undefined })
    })
  }

  it('two projects apart are both there, under ids that do not clash', () => {
    const pasilly = { ...converted('lgv-pasilly'), osmSource: undefined }
    const clelles = { ...converted('clelles-mens'), osmSource: undefined }
    const { project, report } = mergeProjects(through(pasilly), through(clelles), { tolerance: TOLERANCE })
    expectWhole(project)
    expect(report.frame).toBe('as-is')
    const a = amounts(pasilly)
    const b = amounts(clelles)
    const merged = amounts(project)
    // Laid as they are, the two areas lie on each other around (0, 0): what crosses is for the editor to weld
    expect(merged.rails).toBe(a.rails + b.rails - report.railsDropped)
    expect(report.railsDropped).toBe(0)
    expect(merged.signals).toBe(a.signals + b.signals)
    expect(merged.stations).toBe(a.stations + b.stations)
    expect(report.addedBox).not.toBeNull()
  })

  it('the current project wins: its settings, its name, its tables, its station names', () => {
    const { first, second } = overlapping('clelles-mens')
    const current = { ...through(first), name: 'Le mien', lineSpeed: 80, gauge: 1.435 }
    const other = { ...renumberProject(through(second), 1), name: 'L’autre', lineSpeed: 200, gauge: 1.0, camera: { x: 5, y: 5, scale: 3 } }
    other.stations = other.stations?.map((s) => ({ ...s, name: s.name.toUpperCase() }))
    const { project, report } = mergeProjects(current, other, { tolerance: TOLERANCE })
    expect(project.name).toBe('Le mien')
    expect(project.lineSpeed).toBe(80)
    expect(project.gauge).toBe(1.435)
    expect(project.camera).toBeUndefined()
    expect(report.gaugeDiffers).toBe(true)
    for (const station of current.stations ?? []) expect(project.stations!.find((s) => s.id === station.id)!.name).toBe(station.name)
    // Every table of the current project that the other brings no rail to is still the object it was
    const kept = (current.junctions ?? []).filter((j) => project.junctions?.includes(j))
    expect(kept.length + report.junctionsRebuilt).toBeGreaterThanOrEqual((current.junctions ?? []).length)
  })

  it('the same place drawn in a local frame and in Lambert-93 is one place', () => {
    const national = converted('dijon-ville', 'lambert93')
    const local = converted('dijon-ville', 'local')
    expect(local.osmSource!.frame ?? 'local').toBe('local')
    expect(national.osmSource!.frame).toBe('lambert93')
    expect(Math.hypot(national.nodes[0].x - local.nodes[0].x, national.nodes[0].y - local.nodes[0].y)).toBeGreaterThan(10_000)
    const { project, report } = mergeProjects(through(national), through(local), { tolerance: TOLERANCE })
    expect(report.frame).toBe('reprojected')
    // The import fits its curves in the frame it draws in: a few joints of the two drawings lie
    // metres apart, and the rails between them stay twice. All the rest is one network.
    expect(report.nodesMerged).toBeGreaterThan(0.98 * local.nodes.length)
    expect(report.railsDropped).toBeGreaterThan(0.95 * local.segments.length)
    expect(project.osmSource).toEqual(national.osmSource)
  })

  it('an empty project takes everything, and the place on the globe with it', () => {
    const whole = converted('clelles-mens')
    const empty: SerializedProject = { version: 2, nodes: [], segments: [], name: 'Vide' }
    const { project, report } = mergeProjects(empty, through(whole), { tolerance: TOLERANCE })
    expect(report.railsAdded).toBe(whole.segments.length)
    expect(project.osmSource).toEqual(whole.osmSource)
    expect(project.name).toBe('Vide')
    expect(amounts(project)).toEqual(amounts(whole))
  })
})
