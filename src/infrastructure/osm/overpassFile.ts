import type { OverpassElement, OverpassResponse } from '@domain/import/osmTypes'
import { OSM_ERROR_MESSAGES, OsmError } from './osmError'

/**
 * Reading of what an Overpass server writes, whether it comes from the network or from a file the
 * user saved (Overpass Turbo, « Exporter ▸ données brutes »). Nothing here converts anything: the
 * elements are checked for shape and handed to the domain as they are.
 */

function isElement(value: unknown): value is OverpassElement {
  if (typeof value !== 'object' || value === null) return false
  const el = value as Record<string, unknown>
  if (el.type !== 'node' && el.type !== 'way' && el.type !== 'relation') return false
  if (typeof el.id !== 'number' || !Number.isFinite(el.id)) return false
  if (el.type === 'node') return typeof el.lat === 'number' && typeof el.lon === 'number'
  if (el.type === 'way') return Array.isArray(el.nodes)
  return true
}

/** True when the answer holds at least one way carrying a `railway` tag */
export function hasRailwayWay(data: OverpassResponse): boolean {
  return data.elements.some((el) => el.type === 'way' && typeof el.tags?.railway === 'string')
}

/**
 * The elements of a parsed Overpass answer. Elements of an unknown shape are left out rather than
 * refused: the data is written by hand by thousands of people.
 * Throws `OsmError('invalid')` when the value is not an Overpass answer at all.
 */
export function readOverpassAnswer(value: unknown, invalidMessage: string = OSM_ERROR_MESSAGES.invalidAnswer): OverpassResponse {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { elements?: unknown }).elements)) {
    throw new OsmError('invalid', invalidMessage)
  }
  const raw = value as { elements: unknown[]; osm3s?: { timestamp_osm_base?: unknown } }
  const elements = raw.elements.filter(isElement)
  const stamp = raw.osm3s?.timestamp_osm_base
  return {
    elements,
    ...(typeof stamp === 'string' && stamp ? { osm3s: { timestamp_osm_base: stamp } } : {}),
  }
}

/** A file as the browser gives it; only what is read here, so that a test can hand a plain object */
export interface TextFile {
  name: string
  text(): Promise<string>
}

/**
 * Read an Overpass JSON file chosen by the user: the import without network.
 * Throws an `OsmError` whose message says what the file is when it is not the right one.
 */
export async function readOverpassFile(file: TextFile): Promise<OverpassResponse> {
  let value: unknown
  try {
    value = JSON.parse(await file.text())
  } catch {
    throw new OsmError('invalid', `« ${file.name} » n’est pas un fichier JSON lisible.`)
  }
  if (typeof value === 'object' && value !== null && !Array.isArray((value as { elements?: unknown }).elements)) {
    const other = value as { segments?: unknown; nodes?: unknown; type?: unknown }
    if (Array.isArray(other.segments) && Array.isArray(other.nodes)) {
      throw new OsmError('invalid', `« ${file.name} » est un projet Open Rails : ouvrez-le par « Importer JSON… ».`)
    }
    if (other.type === 'FeatureCollection') {
      throw new OsmError('invalid', `« ${file.name} » est un fichier GeoJSON : il faut les données brutes d’Overpass (JSON, avec « elements »).`)
    }
  }
  const data = readOverpassAnswer(value, `« ${file.name} » n’est pas une réponse d’Overpass (JSON avec une liste « elements »).`)
  if (!hasRailwayWay(data)) throw new OsmError('empty', `« ${file.name} » ne contient aucune voie ferrée.`)
  return data
}
