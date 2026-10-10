import { setStationIdentity } from './stations'
import type { Network, Point } from './types'

// The official list of the passenger stations (SNCF Gares & Connexions, « gares-de-voyageurs »,
// ODbL): names, three-letter codes, UIC codes and positions. The application loads the file
// (`src/data/stations-fr.json`) and hands the rows over; the domain reads them and matches the
// stations of an import against them, by UIC code first, by distance otherwise.

/** One row of `stations-fr.json`, as `tools/stations/fetch-sncf-stations.mjs` writes it */
export type StationRegistryRow = [name: string, trigram: string, uicCodes: string[], lat: number, lon: number, segment: string]

export interface StationRegistryEntry {
  name: string
  /** Three-letter code (MSC), when the registry has one */
  trigram?: string
  /** Eight-digit UIC codes, the last digit a check digit */
  uicCodes: string[]
  lat: number
  lon: number
  /** DRG class: A national, B regional, C local */
  segment?: 'A' | 'B' | 'C'
}

/** A station of an import is matched to an official one this far away (m) at most, when no code says */
export const REGISTRY_MATCH_REACH = 300

/** The rows of the file read with care: a row that does not hold together is left out */
export function readStationRegistry(file: unknown): StationRegistryEntry[] {
  const rows = file && typeof file === 'object' && Array.isArray((file as { stations?: unknown }).stations) ? ((file as { stations: unknown[] }).stations) : []
  const entries: StationRegistryEntry[] = []
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue
    const [name, trigram, codes, lat, lon, segment] = row as unknown[]
    if (typeof name !== 'string' || name === '' || typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const entry: StationRegistryEntry = {
      name,
      uicCodes: Array.isArray(codes) ? codes.filter((c): c is string => typeof c === 'string' && /^\d{8}$/.test(c)) : [],
      lat,
      lon,
    }
    if (typeof trigram === 'string' && /^[A-Z]{3}$/.test(trigram)) entry.trigram = trigram
    if (segment === 'A' || segment === 'B' || segment === 'C') entry.segment = segment
    entries.push(entry)
  }
  return entries
}

/**
 * The UIC code of a station as the import keys it: the seven digits OpenStreetMap writes. The SNCF
 * writes eight, the last one a check digit, which is dropped. Anything else is no code.
 */
export function uicKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 7) return digits
  if (digits.length === 8) return digits.slice(0, 7)
  return undefined
}

/** A name as the import compares it: lower case, no accents, no punctuation */
export function normalizedName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Give the stations of a network their official name and codes: each one is matched to the entry
 * that carries its UIC code, else to the nearest entry within reach of its place (`project` puts
 * the registry in the frame of the network). A station that matches nothing keeps what the data
 * gave it. Returns how many were matched.
 */
export function matchStationRegistry(net: Network, entries: readonly StationRegistryEntry[], project: (lat: number, lon: number) => Point): number {
  if (net.stations.size === 0 || entries.length === 0) return 0
  const byUic = new Map<string, StationRegistryEntry>()
  for (const entry of entries) {
    for (const code of entry.uicCodes) {
      const key = uicKey(code)
      if (key && !byUic.has(key)) byUic.set(key, entry)
    }
  }
  let places: { entry: StationRegistryEntry; at: Point }[] | null = null
  let matched = 0
  for (const station of [...net.stations.values()]) {
    let entry = station.uic ? byUic.get(station.uic) : undefined
    if (!entry) {
      places ??= entries.map((e) => ({ entry: e, at: project(e.lat, e.lon) }))
      let best = REGISTRY_MATCH_REACH
      for (const place of places) {
        const d = Math.hypot(place.at.x - station.pos.x, place.at.y - station.pos.y)
        if (d <= best) {
          best = d
          entry = place.entry
        }
      }
    }
    if (!entry) continue
    const uic = station.uic ?? (entry.uicCodes.length > 0 ? uicKey(entry.uicCodes[0]) : undefined)
    setStationIdentity(net, station.id, { name: entry.name, ...(entry.trigram ? { code: entry.trigram } : {}), ...(uic ? { uic } : {}) })
    matched++
  }
  return matched
}
