import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** What `manifest.json` says */
export interface DatasetManifest {
  version: number
  /** south, west, north, east */
  bbox: [number, number, number, number]
  tileDeg: number
  keepDetachedOverKm: number
  /** Names and ids of the line relations, by `ref` */
  lines: Record<string, { id: string; name: string }>
  approaches: Approach[]
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
  return raw
}
