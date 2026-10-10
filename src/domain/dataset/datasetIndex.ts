// The index of the published « LGV France » dataset (`public/data/lgv/index.json`): what the
// application reads first, before any geometry. Light enough to be fetched on every start: the
// lines (one project file each), where lines meet, and the stations. Written by
// `tools/lgv-dataset/` (which imports these types), read by `readDatasetIndex` below.

export type LineId = string

export interface DatasetIndex {
  version: 1
  /** `timestamp_osm_base` of the data */
  dataDate: string
  generatedAt: string
  attribution: string[]
  frame: 'lambert93'
  /** World (0, 0) */
  origin: { lat: number; lon: number }
  lines: IndexLine[]
  /** Nodes where rails of two lines or more meet: the way from one line to another */
  connections: IndexConnection[]
  stations: IndexStation[]
}

export interface IndexLine {
  id: LineId
  name: string
  ref?: string
  highSpeed: boolean
  file: string
  bytes: number
  rails: number
  /** Length of track (every rail), not of line */
  lengthKm: number
  bbox: BBox
  /** Ids of the stations with a platform on this line */
  stations: string[]
}

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface IndexConnection {
  nodeId: string
  x: number
  y: number
  lines: LineId[]
}

export interface IndexStation {
  id: string
  name: string
  uic?: string
  code?: string
  x: number
  y: number
  /** From the SNCF registry when the station matched it: the projection has no inverse */
  lat?: number
  lon?: number
  lines: LineId[]
}

export const DATASET_ATTRIBUTION = [
  'Voies, gares et signaux : © les contributeurs d’OpenStreetMap, licence ODbL 1.0 — https://www.openstreetmap.org/copyright',
  'Noms et codes des gares : SNCF Gares & Connexions, « Gares de voyageurs », licence ODbL 1.0 — https://ressources.data.sncf.com/explore/dataset/gares-de-voyageurs/',
]

export const DATASET_INDEX_UNREADABLE = 'Index du jeu de données illisible'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString)

function isBBox(v: unknown): v is BBox {
  return isRecord(v) && isNumber(v.minX) && isNumber(v.minY) && isNumber(v.maxX) && isNumber(v.maxY)
}

function isLine(v: unknown): v is IndexLine {
  return (
    isRecord(v) &&
    isString(v.id) &&
    isString(v.name) &&
    typeof v.highSpeed === 'boolean' &&
    isString(v.file) &&
    isNumber(v.bytes) &&
    isNumber(v.rails) &&
    isNumber(v.lengthKm) &&
    isBBox(v.bbox) &&
    isStrings(v.stations)
  )
}

function isConnection(v: unknown): v is IndexConnection {
  return isRecord(v) && isString(v.nodeId) && isNumber(v.x) && isNumber(v.y) && isStrings(v.lines)
}

function isStation(v: unknown): v is IndexStation {
  return isRecord(v) && isString(v.id) && isString(v.name) && isNumber(v.x) && isNumber(v.y) && isStrings(v.lines)
}

/**
 * The index as parsed from JSON, checked: the fields the application relies on must be there and
 * of the right kind, anything else is kept as it comes. Throws `DATASET_INDEX_UNREADABLE` otherwise.
 */
export function readDatasetIndex(raw: unknown): DatasetIndex {
  if (
    !isRecord(raw) ||
    raw.version !== 1 ||
    raw.frame !== 'lambert93' ||
    !isString(raw.dataDate) ||
    !isStrings(raw.attribution) ||
    !Array.isArray(raw.lines) ||
    !raw.lines.every(isLine) ||
    !Array.isArray(raw.connections) ||
    !raw.connections.every(isConnection) ||
    !Array.isArray(raw.stations) ||
    !raw.stations.every(isStation)
  ) {
    throw new Error(DATASET_INDEX_UNREADABLE)
  }
  return raw as unknown as DatasetIndex
}
