import { describe, expect, it } from 'vitest'
import { convertOsm } from '@domain/import/osmImport'
import { options, readFixture } from '@domain/import/osmImport.testkit'
import { findSectionChains } from '@domain/models/sections'
import { resetIdCounter } from '@domain/models/network'
import { splitSpeedZonesBy } from '@domain/models/speedZones'
import type { Network } from '@domain/models/types'
import { buildOsmProject } from '@application/import/osmProject'
import { deserializeNetwork, type SerializedProject } from './persistence'
import { sliceProject, unionProjects } from './projectSlices'

/** Everything a network holds, in a form two networks can be compared by */
function parts(net: Network): Record<string, string> {
  const sorted = <T extends { id: string }>(items: Iterable<T>): T[] => [...items].sort((a, b) => (a.id < b.id ? -1 : 1))
  return {
    nodes: JSON.stringify(sorted(net.nodes.values()).map((n) => [n.id, n.pos.x, n.pos.y, n.level ?? 0])),
    rails: JSON.stringify(sorted(net.segments.values()).map((s) => [s.id, s.from, s.to, s.kind, s.via?.x, s.via?.y, s.cant])),
    adjacency: JSON.stringify([...net.adjacency].sort().map(([n, rails]) => [n, [...rails].sort()])),
    tables: JSON.stringify(sorted(net.junctions.values()).map((j) => [j.id, j.nodeId, j.kind, j.passages, j.positions, j.active])),
    zones: JSON.stringify(sorted(net.speedZones.values())),
    signals: JSON.stringify(sorted(net.signals.values())),
    stations: JSON.stringify(sorted(net.stations.values()).map((s) => ({ ...s, stops: [...s.stops].sort((a, b) => (a.segId < b.segId ? -1 : 1)) }))),
  }
}

/** A converted area cut in two by the parity of its sections: the borders fall on junction nodes */
function halves(name: string) {
  resetIdCounter(0)
  const result = convertOsm(readFixture(name), options({ traceWays: true }))
  const net = result.network
  const group = new Map<string, string>()
  findSectionChains(net).forEach((section, i) => {
    for (const segId of section.segmentIds) group.set(segId, i % 2 === 0 ? 'even' : 'odd')
  })
  const groupOf = (segId: string): string => group.get(segId) ?? 'even'
  const cut = splitSpeedZonesBy(net, groupOf)
  const whole = buildOsmProject(result, { levels: true, now: new Date('2026-10-07T12:00:00Z') })
  const even = sliceProject(whole, (id) => groupOf(id) === 'even')
  const odd = sliceProject(whole, (id) => groupOf(id) === 'odd')
  return { result, whole, even, odd, cut }
}

const through = (p: SerializedProject): SerializedProject => JSON.parse(JSON.stringify(p))

describe('a project cut into slices and put back together', () => {
  for (const name of ['lgv-pasilly', 'clelles-mens']) {
    it(`${name}: the union of the slices is the whole, loaded or not`, () => {
      const { whole, even, odd } = halves(name)
      expect(even.segments.length + odd.segments.length).toBe(whole.segments.length)
      expect(even.segments.length).toBeGreaterThan(0)
      expect(odd.segments.length).toBeGreaterThan(0)
      // Every rail of the whole is in exactly one slice; a node may be in both
      const union = unionProjects([through(even), through(odd)])
      expect(union.nodes.map((n) => n.id).sort()).toEqual(whole.nodes.map((n) => n.id).sort())
      expect(union.segments.map((s) => s.id).sort()).toEqual(whole.segments.map((s) => s.id).sort())
      expect((union.stations ?? []).length).toBe((whole.stations ?? []).length)
      expect(union.sectionMeta ?? {}).toEqual(whole.sectionMeta ?? {})
      expect(union.osmSource).toEqual(whole.osmSource)
      expect(union.version).toBe(whole.version)
      // Loaded, the union is the network the whole gives
      const a = deserializeNetwork(through(whole))
      const b = deserializeNetwork(union)
      expect(parts(b.network)).toEqual(parts(a.network))
      expect(b.osmSource).toEqual(a.osmSource)
    })

    it(`${name}: each slice loads on its own`, () => {
      const { even, odd } = halves(name)
      for (const slice of [even, odd]) {
        const loaded = deserializeNetwork(through(slice))
        expect(loaded.network.segments.size).toBe(slice.segments.length)
        for (const seg of loaded.network.segments.values()) expect(loaded.network.nodes.has(seg.from) && loaded.network.nodes.has(seg.to)).toBe(true)
      }
    })
  }

  it('a route table on a node at the border is in both slices, whole; a zone is never on both sides', () => {
    const { whole, even, odd, cut } = halves('lgv-pasilly')
    const evenRails = new Set(even.segments.map((s) => s.id))
    const oddRails = new Set(odd.segments.map((s) => s.id))
    const shared = whole.junctions!.filter((j) => {
      const rails = j.passages!.flat()
      return rails.some((r) => evenRails.has(r)) && rails.some((r) => oddRails.has(r))
    })
    expect(shared.length).toBeGreaterThan(0)
    for (const junction of shared) {
      expect(even.junctions!.find((j) => j.id === junction.id)).toEqual(junction)
      expect(odd.junctions!.find((j) => j.id === junction.id)).toEqual(junction)
    }
    expect(cut).toBeGreaterThan(0)
    expect((even.speedZones?.length ?? 0) + (odd.speedZones?.length ?? 0)).toBe(whole.speedZones!.length)
    // Without the cut, a zone over the border is refused
    const uncut = halves('lgv-pasilly').whole
    const straddling: SerializedProject = { ...uncut, speedZones: [{ id: 'z_x', speed: 100, spans: [{ segId: even.segments[0].id, t0: 0, t1: 1 }, { segId: odd.segments[0].id, t0: 0, t1: 1 }] }] }
    expect(() => sliceProject(straddling, (id) => evenRails.has(id))).toThrow(/two slices/)
  })

  it('a station with platforms on both sides is in both slices with its own stops, and whole again in the union', () => {
    // Cut rail by rail, which the zones do not allow: without them for this test
    const whole = { ...halves('clelles-mens').whole, speedZones: undefined }
    const station = whole.stations![0]
    expect(station.stops.length).toBe(2)
    const first = sliceProject(whole, (id) => id === station.stops[0].segId)
    const second = sliceProject(whole, (id) => id === station.stops[1].segId)
    expect(first.stations![0].stops).toEqual([station.stops[0]])
    expect(second.stations![0].stops).toEqual([station.stops[1]])
    const union = unionProjects([first, second])
    expect(union.stations![0].stops).toEqual(station.stops)
    // The same rail in both slices is taken once; a rail that differs is refused
    expect(unionProjects([first, first]).segments.length).toBe(first.segments.length)
    const changed = { ...first, segments: first.segments.map((s) => ({ ...s, from: 'n_other' })) }
    expect(() => unionProjects([first, changed])).toThrow(/differs/)
    expect(() => unionProjects([])).toThrow()
  })
})
