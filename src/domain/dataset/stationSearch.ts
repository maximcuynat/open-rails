import { normalizedName } from '../models/stationRegistry'
import type { DatasetIndex, IndexLine, IndexStation } from './datasetIndex'

// Finding a station of the index from what the user types: every word typed must begin a word
// of the station's name (accents and case aside), or the whole query is its SNCF trigram.

export interface StationMatch {
  station: IndexStation
  /** The lines the station is on, as the index describes them */
  lines: IndexLine[]
  /** At least one of its lines is a high-speed line */
  highSpeed: boolean
  /** Another station of the index has the same name: show the UIC code to tell them apart */
  homonym: boolean
}

/**
 * The stations whose name answers `query`, best first: the ones whose name begins with the query,
 * then the ones on most lines, then by name. An empty query gives nothing.
 */
export function searchStations(index: DatasetIndex, query: string, limit = 8): StationMatch[] {
  const wanted = normalizedName(query)
  if (!wanted) return []
  const tokens = wanted.split(' ')
  const linesById = new Map(index.lines.map((line) => [line.id, line]))
  const namesSeen = new Map<string, number>()
  for (const station of index.stations) {
    const key = normalizedName(station.name)
    namesSeen.set(key, (namesSeen.get(key) ?? 0) + 1)
  }

  const matches: { match: StationMatch; starts: boolean; name: string }[] = []
  for (const station of index.stations) {
    const name = normalizedName(station.name)
    const words = name.split(' ')
    const byName = tokens.every((token) => words.some((word) => word.startsWith(token)))
    const byCode = tokens.length === 1 && station.code !== undefined && station.code.toLowerCase() === tokens[0]
    if (!byName && !byCode) continue
    const lines = station.lines.map((id) => linesById.get(id)).filter((line): line is IndexLine => line !== undefined)
    matches.push({
      match: { station, lines, highSpeed: lines.some((line) => line.highSpeed), homonym: (namesSeen.get(name) ?? 0) > 1 },
      starts: name.startsWith(wanted),
      name,
    })
  }
  matches.sort((p, q) => {
    if (p.starts !== q.starts) return p.starts ? -1 : 1
    if (p.match.lines.length !== q.match.lines.length) return q.match.lines.length - p.match.lines.length
    return p.name.localeCompare(q.name, 'fr')
  })
  return matches.slice(0, limit).map((m) => m.match)
}

/** What tells a result apart under its name: its lines, and its codes when another station bears the same name */
export function stationBadge(match: StationMatch): string {
  const parts: string[] = []
  if (match.homonym) {
    const codes = [match.station.uic ? `UIC ${match.station.uic}` : null, match.station.code ?? null].filter((c): c is string => c !== null)
    if (codes.length) parts.push(codes.join(' · '))
  }
  if (match.lines.length) parts.push(match.lines.map((line) => line.name).join(', '))
  return parts.join(' — ')
}
