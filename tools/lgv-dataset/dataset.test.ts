import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OverpassResponse } from '@domain/import/osmTypes'
import { convertOsm } from '@domain/import/osmImport'
import { answer, options, osmNode, osmWay, readFixture } from '@domain/import/osmImport.testkit'
import { readStationRegistry } from '@domain/models/stationRegistry'
import { OsmError } from '@infrastructure/osm/osmError'
import { deserializeNetwork } from '@infrastructure/persistence/persistence'
import { unionProjects } from '@infrastructure/persistence/projectSlices'
import { buildDataset } from './build'
import { fetchAll } from './fetch'
import { assignLines, readLineRelations } from './lines'
import type { DatasetManifest } from './manifest'
import { mergeAnswers } from './merge'
import { approachQuery, tileQuery } from './queries'
import { splitTile, tileKey, tilesOf } from './tiles'

const manifest = (over: Partial<DatasetManifest> = {}): DatasetManifest => ({
  version: 1,
  bbox: [41.3, -5.2, 51.1, 9.6],
  tileDeg: 2,
  keepDetachedOverKm: 0,
  lines: { '752000': { id: 'lgv-sud-est', name: 'LGV Sud-Est' } },
  approaches: [{ id: 'racc-test', name: 'Raccordement test', stationUic: '87751008', corridor: [[43.4, 5.37], [43.3, 5.38]], radiusM: 400, stationRadiusM: 1500 }],
  ...over,
})

describe('tiles', () => {
  it('cover the box without a gap, the last row and column clipped to it', () => {
    const tiles = tilesOf([41.3, -5.2, 51.1, 9.6], 2)
    expect(tiles.length).toBe(5 * 8)
    expect(tiles[0]).toEqual({ south: 41.3, west: -5.2, north: 43.3, east: -3.2 })
    const last = tiles[tiles.length - 1]
    expect(last.north).toBe(51.1)
    expect(last.east).toBe(9.6)
    const area = tiles.reduce((sum, t) => sum + (t.north - t.south) * (t.east - t.west), 0)
    expect(area).toBeCloseTo((51.1 - 41.3) * (9.6 + 5.2), 6)
    expect(new Set(tiles.map(tileKey)).size).toBe(tiles.length)
    expect(tileKey(tiles[0])).toBe('tile_41_3_m5_2_43_3_m3_2')
  })

  it('split in four quarters that cover the tile', () => {
    const quarters = splitTile({ south: 40, west: 0, north: 42, east: 2 })
    expect(quarters).toHaveLength(4)
    expect(quarters[0]).toEqual({ south: 40, west: 0, north: 41, east: 1 })
    expect(quarters[3]).toEqual({ south: 41, west: 1, north: 42, east: 2 })
  })
})

describe('queries', () => {
  it('ask a tile for the high-speed ways, their nodes, the stations beside them and their line relations', () => {
    const q = tileQuery({ south: 43.3, west: 5.2, north: 45.3, east: 7.2 })
    expect(q).toContain('[timeout:180]')
    expect(q).toContain('area(3602202162)->.fr;')
    expect(q).toContain('way[railway=rail][highspeed=yes](area.fr)(43.3,5.2,45.3,7.2)')
    expect(q).toContain('way[railway=rail]["railway:tvm"](area.fr)(43.3,5.2,45.3,7.2)')
    expect(q).toContain('node(around.w:400)[railway~"^(station|halt)$"]')
    expect(q).toContain('rel(bw.w)[type=route][route~"^(tracks|railway)$"];\nout body;')
  })

  it('ask an approach for the main tracks along its corridor and every track around its terminal', () => {
    const q = approachQuery(manifest().approaches[0])
    expect(q).toContain('way[railway=rail][usage~"^(main|branch)$"](around:400,43.4,5.37,43.3,5.38)')
    expect(q).toContain('way[railway=rail](around:1500,43.3,5.38)')
    expect(q).not.toContain('rel(')
  })
})

describe('merging answers', () => {
  it('keeps each element once, the tagged copy first, and the oldest date', () => {
    const a: OverpassResponse = { osm3s: { timestamp_osm_base: '2026-10-07T10:00:00Z' }, elements: [osmNode(1, 0, 0), osmNode(2, 10, 0, { railway: 'switch' }), osmWay(10, [1, 2])] }
    const b: OverpassResponse = { osm3s: { timestamp_osm_base: '2026-10-06T10:00:00Z' }, elements: [osmNode(2, 10, 0), osmNode(1, 0, 0, { railway: 'buffer_stop' }), { type: 'relation', id: 5, members: [{ type: 'way', ref: 10 }], tags: { type: 'route', route: 'tracks' } }] }
    const merged = mergeAnswers([a, b])
    expect(merged.osm3s?.timestamp_osm_base).toBe('2026-10-06T10:00:00Z')
    expect(merged.elements).toHaveLength(4)
    expect(merged.elements.find((e) => e.type === 'node' && e.id === 2)!.tags).toEqual({ railway: 'switch' })
    expect(merged.elements.find((e) => e.type === 'node' && e.id === 1)!.tags).toEqual({ railway: 'buffer_stop' })
    expect(merged.elements.find((e) => e.type === 'relation')!.members).toHaveLength(1)
  })
})

describe('fetching through the cache', () => {
  const empty = (): OverpassResponse => ({ osm3s: { timestamp_osm_base: '2026-10-07T10:00:00Z' }, elements: [] })

  it('asks once per tile and per approach, then reads the cache; offline refuses what is not there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lgv-'))
    const ask = vi.fn(async () => empty())
    const m = manifest({ bbox: [40, 0, 44, 4], tileDeg: 2 })
    const first = await fetchAll(m, dir, { ask })
    expect(first.tiles).toBe(4)
    expect(first.asked).toBe(5)
    expect(readdirSync(dir)).toHaveLength(5)
    const again = await fetchAll(m, dir, { ask, offline: true })
    expect(again.asked).toBe(0)
    expect(ask).toHaveBeenCalledTimes(5)
    await expect(fetchAll(manifest({ bbox: [50, 0, 52, 2] }), dir, { ask, offline: true })).rejects.toThrow(/offline/)
  })

  it('splits a tile the server finds too large, and waits on a busy one before asking again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lgv-'))
    let calls = 0
    const ask = vi.fn(async (query: string) => {
      calls++
      if (query.includes('(40,0,42,2)')) throw new OsmError('too-large', 'too large')
      if (calls === 2) throw new OsmError('busy', 'busy')
      return empty()
    })
    const sleep = vi.fn(async () => {})
    const data = await fetchAll(manifest({ bbox: [40, 0, 42, 2], tileDeg: 2, approaches: [] }), dir, { ask, sleep, busyPauses: [1] })
    expect(data.tiles).toBe(5)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(readdirSync(dir)).toHaveLength(4)
  })
})

describe('the line of each rail', () => {
  /**
   * Two tracks end to end along y = 0 that meet at a junction (a branch leaves there: two ways
   * meeting at a plain joint would be one section, hence one line), a third track beside them.
   */
  function data(relationTags: Record<string, string>[] = [{ type: 'route', route: 'tracks', ref: '752000' }, { type: 'route', route: 'tracks', name: 'Ligne de Test à Essai' }]) {
    const first = [1, 2, 3, 4].map((id, i) => osmNode(id, i * 100, 0))
    const second = [4, 5, 6, 7].map((id, i) => osmNode(id, 300 + i * 100, 0))
    const branch = [21, 22].map((id, i) => osmNode(id, 400 + i * 100, 6 + i * 20))
    const beside = [11, 12, 13].map((id, i) => osmNode(id, 100 + i * 100, 60))
    const elements = [
      ...first,
      ...second.slice(1),
      ...branch,
      ...beside,
      osmWay(100, [1, 2, 3, 4], { highspeed: 'yes' }),
      osmWay(200, [4, 5, 6, 7], { highspeed: 'yes' }),
      osmWay(400, [4, 21, 22], { highspeed: 'yes' }),
      osmWay(300, [11, 12, 13], { name: 'Voie de service' }),
    ]
    const relations = relationTags.map((tags, i) => ({ type: 'relation' as const, id: 900 + i, members: [{ type: 'way' as const, ref: i === 0 ? 100 : 200 }], tags }))
    return answer(elements, relations)
  }

  it('reads the line relations and their ways', () => {
    const relations = readLineRelations(data())
    expect(relations.map((r) => [r.ref, r.name, [...r.ways]])).toEqual([['752000', undefined, [100]], [undefined, 'Ligne de Test à Essai', [200]]])
  })

  it('names a rail after the relation of its way, with the manifest word for it, and after the way itself otherwise', () => {
    const d = data()
    const result = convertOsm(d, options({ traceWays: true }))
    const { lineOf, lines } = assignLines(result, d, manifest({ approaches: [] }), new Map())
    const byLine = new Map<string, number>()
    for (const line of lineOf.values()) byLine.set(line, (byLine.get(line) ?? 0) + 1)
    expect([...byLine.keys()].sort()).toEqual(['lgv-sud-est', 'ligne-de-test-a-essai', 'voie-de-service'])
    expect(lines.get('lgv-sud-est')).toEqual({ id: 'lgv-sud-est', name: 'LGV Sud-Est', ref: '752000', highSpeed: true })
    expect(lines.get('ligne-de-test-a-essai')!.highSpeed).toBe(false)
    expect(lines.get('voie-de-service')!.highSpeed).toBe(false)
    expect(lineOf.size).toBe(result.network.segments.size)
  })

  it('gives a way of an approach to the approach, unless it is a high-speed way; what nobody names is « autres »', () => {
    const d = data([])
    const result = convertOsm(d, options({ traceWays: true }))
    const m = manifest()
    const { lineOf, lines } = assignLines(result, d, m, new Map([['racc-test', new Set([200, 300])]]))
    const groups = new Set(lineOf.values())
    // Way 100: high-speed without relation or name → nothing → propagated from a neighbour or « autres »
    expect(groups.has('racc-test')).toBe(true)
    expect(lines.get('racc-test')!.name).toBe('Raccordement test')
    // Way 300 is not connected to the others: the approach names it
    const beside = [...result.network.segments.values()].find((seg) => result.network.nodes.get(seg.from)!.pos.y !== result.network.nodes.get(seg.to)!.pos.y || Math.abs(result.network.nodes.get(seg.from)!.pos.y) > 1)
    expect(beside && lineOf.get(beside.id)).toBe('racc-test')
  })
})

describe('the dataset built from an answer', () => {
  const registry = readStationRegistry({ stations: [['Clelles - Mens', 'CMS', ['87747626'], 44.827244, 5.605062, 'C']] })

  it('Clelles: one file per line, each loadable, their union the whole; the index names the station with its official name', () => {
    const d = readFixture('clelles-mens')
    const built = buildDataset(d, manifest({ approaches: [] }), registry, new Map(), new Date('2026-10-07T12:00:00Z'))
    expect(built.files.size).toBeGreaterThan(0)
    expect(built.report.rails).toBeGreaterThan(300)
    let rails = 0
    for (const [id, file] of built.files) {
      const loaded = deserializeNetwork(JSON.parse(JSON.stringify(file)))
      expect(loaded.network.segments.size, id).toBe(file.segments.length)
      rails += file.segments.length
    }
    expect(rails).toBe(built.report.rails)
    const union = deserializeNetwork(unionProjects([...built.files.values()]))
    expect(union.network.segments.size).toBe(built.report.rails)
    expect(union.network.stations.size).toBe(1)
    const station = built.index.stations[0]
    expect(station).toMatchObject({ name: 'Clelles - Mens', code: 'CMS', uic: '8774762', lat: 44.827244, lon: 5.605062 })
    expect(station.lines.length).toBeGreaterThan(0)
    for (const line of built.index.lines) {
      expect(built.files.has(line.id)).toBe(true)
      expect(line.rails).toBe(built.files.get(line.id)!.segments.length)
      expect(line.file).toBe(`${line.id}.json`)
      for (const s of line.stations) expect(built.index.stations.some((st) => st.id === s)).toBe(true)
    }
    for (const connection of built.index.connections) {
      expect(connection.lines.length).toBeGreaterThan(1)
      for (const id of connection.lines) expect(built.files.get(id)!.nodes.some((n) => n.id === connection.nodeId)).toBe(true)
    }
    expect(built.index.dataDate).toBe('2026-10-06T07:27:36Z')
    expect(built.index.frame).toBe('lambert93')
    expect(built.files.values().next().value!.osmSource!.frame).toBe('lambert93')
  })
})
