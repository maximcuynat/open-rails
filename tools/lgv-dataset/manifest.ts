import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** What `manifest.json` says */
export interface DatasetManifest {
  version: number
  /** south, west, north, east */
  bbox: [number, number, number, number]
  tileDeg: number
  keepDetachedOverKm: number
  /** The lines to publish, in order of precedence: a way in two of them goes to the first */
  lines: LineSpec[]
  approaches: Approach[]
}

/** A published line: the OSM relations whose member ways make it */
export interface LineSpec {
  id: string
  name: string
  /** RFN line code, for the index */
  ref?: string
  /** Ids of the relations (`type=route`, `route=railway|tracks`); refs and names are too unsteady to go by */
  relations: number[]
}

/** A classic line from the end of a high-speed line into a city-centre terminal */
export interface Approach {
  id: string
  name: string
  stationUic: string
  /** [lat, lon] waypoints */
  corridor: [number, number][]
  radiusM: number
  stationRadiusM: number
}

export function readManifest(path = fileURLToPath(new URL('./manifest.json', import.meta.url))): DatasetManifest {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as DatasetManifest
  if (!Array.isArray(raw.bbox) || raw.bbox.length !== 4) throw new Error('manifest: bbox must be [south, west, north, east]')
  if (!(raw.tileDeg > 0)) throw new Error('manifest: tileDeg must be positive')
  if (!Array.isArray(raw.lines) || raw.lines.some((l) => !l.id || !l.name || !Array.isArray(l.relations))) throw new Error('manifest: lines must be [{ id, name, relations }]')
  return raw
}
