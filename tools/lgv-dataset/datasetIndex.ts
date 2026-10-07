import type { StationRegistryEntry } from '@domain/models/stationRegistry'
import { uicKey } from '@domain/models/stationRegistry'
import type { Network, Point } from '@domain/models/types'
import { segmentShapeLength } from '@domain/geometry/segmentGeometry'
import { LAMBERT93_ORIGIN } from '@domain/import/osmProjection'
import type { SerializedProject } from '@infrastructure/persistence/persistence'
import { DATASET_ATTRIBUTION, type DatasetIndex, type IndexConnection, type IndexLine, type IndexStation, type LineId } from '@domain/dataset/datasetIndex'
import type { LineAssignment } from './lines'

// Builds the index of the dataset (its types live in `@domain/dataset/datasetIndex`, which the
// application reads): the lines (one file each), where lines meet, and the stations.

export function buildIndex(
  net: Network,
  assignment: LineAssignment,
  files: ReadonlyMap<LineId, { file: string; bytes: number; project: SerializedProject }>,
  registry: readonly StationRegistryEntry[],
  dates: { dataDate: string; generatedAt: string },
): DatasetIndex {
  const { lineOf, lines } = assignment
  const byUic = new Map<string, StationRegistryEntry>()
  for (const entry of registry) for (const code of entry.uicCodes) { const key = uicKey(code); if (key && !byUic.has(key)) byUic.set(key, entry) }

  // Lines: size and reach
  const lineStations = new Map<LineId, Set<string>>()
  const stations: IndexStation[] = []
  for (const station of net.stations.values()) {
    const its = new Set<LineId>()
    for (const stop of station.stops) {
      const line = lineOf.get(stop.segId)
      if (line) its.add(line)
    }
    if (its.size === 0) continue
    for (const line of its) {
      const set = lineStations.get(line) ?? new Set()
      set.add(station.id)
      lineStations.set(line, set)
    }
    const entry = station.uic ? byUic.get(station.uic) : undefined
    const row: IndexStation = { id: station.id, name: station.name, x: round(station.pos.x), y: round(station.pos.y), lines: [...its].sort() }
    if (station.uic) row.uic = station.uic
    if (station.code) row.code = station.code
    if (entry) {
      row.lat = entry.lat
      row.lon = entry.lon
    }
    stations.push(row)
  }

  const indexLines: IndexLine[] = []
  for (const [id, info] of lines) {
    const written = files.get(id)
    if (!written) continue
    let lengthKm = 0
    const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    const extend = (p: Point): void => {
      bbox.minX = Math.min(bbox.minX, p.x)
      bbox.minY = Math.min(bbox.minY, p.y)
      bbox.maxX = Math.max(bbox.maxX, p.x)
      bbox.maxY = Math.max(bbox.maxY, p.y)
    }
    let rails = 0
    for (const [segId, line] of lineOf) {
      if (line !== id) continue
      const seg = net.segments.get(segId)
      if (!seg) continue
      rails++
      lengthKm += segmentShapeLength(net, seg) / 1000
      extend(net.nodes.get(seg.from)!.pos)
      extend(net.nodes.get(seg.to)!.pos)
      if (seg.via) extend(seg.via)
    }
    const line: IndexLine = {
      id,
      name: info.name,
      highSpeed: info.highSpeed,
      file: written.file,
      bytes: written.bytes,
      rails,
      lengthKm: Math.round(lengthKm * 100) / 100,
      bbox: { minX: round(bbox.minX), minY: round(bbox.minY), maxX: round(bbox.maxX), maxY: round(bbox.maxY) },
      stations: [...(lineStations.get(id) ?? [])].sort(),
    }
    if (info.ref !== undefined) line.ref = info.ref
    indexLines.push(line)
  }
  indexLines.sort((a, b) => a.id.localeCompare(b.id))

  // Connections: a node whose rails belong to two lines or more
  const connections: IndexConnection[] = []
  for (const [nodeId, segIds] of net.adjacency) {
    const its = new Set<LineId>()
    for (const segId of segIds) {
      const line = lineOf.get(segId)
      if (line) its.add(line)
    }
    if (its.size < 2) continue
    const pos = net.nodes.get(nodeId)!.pos
    connections.push({ nodeId, x: round(pos.x), y: round(pos.y), lines: [...its].sort() })
  }
  connections.sort((a, b) => a.nodeId.localeCompare(b.nodeId, 'en', { numeric: true }))
  stations.sort((a, b) => a.name.localeCompare(b.name, 'fr'))

  return {
    version: 1,
    dataDate: dates.dataDate,
    generatedAt: dates.generatedAt,
    attribution: DATASET_ATTRIBUTION,
    frame: 'lambert93',
    origin: { lat: LAMBERT93_ORIGIN.lat, lon: LAMBERT93_ORIGIN.lon },
    lines: indexLines,
    connections,
    stations,
  }
}

const round = (v: number): number => Math.round(v * 100) / 100
