import type { OsmExtraTrackKind, OsmImportOptions, OverpassElement, OverpassResponse } from './osmTypes'
import { MAX_LEVEL, MIN_LEVEL } from '../models/network'
import { MIN_ZONE_SPEED, SPEED_ZONE_STEP } from '../models/speedZones'

// Reading of an Overpass answer: which elements are tracks, and what their tags say. Everything
// here is tolerant: a missing tag, an unknown value or a malformed element is skipped, never thrown.

type Tags = Record<string, string>

export interface OsmNode {
  id: number
  lat: number
  lon: number
  tags?: Tags
}

/** What `bridge`, `tunnel` and `layer` say of a way */
export interface WayLevel {
  /** Stacking level given to the way, within the range of the app */
  level: number
  /** True when `layer` lists several values: the one closest to the ground was taken */
  multiple: boolean
  /** True when the level read was outside the range of the app and brought back into it */
  clamped: boolean
  /** The `layer` tag as written, when it was read */
  layer?: string
  /** What carries the way, when it says so: a passage under a building is not a tunnel */
  structure: 'bridge' | 'tunnel' | null
}

/** A way kept as track: a run of nodes that all exist in the answer */
export interface OsmTrack {
  /** OSM id of the way. A way with nodes missing from the answer gives several runs under the same id. */
  id: number
  nodes: number[]
  tags: Tags
  /** Value of `railway` */
  kind: string
  service: boolean
  level: WayLevel
  /** Zone speed (km/h) read from `maxspeed`, null when the way carries none that can be read */
  speed: number | null
  /** `maxspeed` as a number of km/h before it is brought to a zone speed, null when none */
  rawSpeed: number | null
  highSpeed: boolean
  /** The run stops at a node the answer does not hold: the edge of the area */
  cutAtStart: boolean
  cutAtEnd: boolean
}

export interface OsmRead {
  nodes: Map<number, OsmNode>
  /** Every way that is a track of a known kind, whatever the options */
  allTracks: OsmTrack[]
  /** The tracks the options keep */
  tracks: OsmTrack[]
}

const EXTRA_KINDS: readonly OsmExtraTrackKind[] = ['light_rail', 'subway', 'tram', 'narrow_gauge']
const DISUSED_KINDS: readonly string[] = ['disused', 'abandoned']

export function isExtraKind(kind: string): kind is OsmExtraTrackKind {
  return (EXTRA_KINDS as readonly string[]).includes(kind)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readTags(raw: unknown): Tags | undefined {
  if (!isObject(raw)) return undefined
  const tags: Tags = {}
  let any = false
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      tags[key] = value
      any = true
    } else if (typeof value === 'number') {
      tags[key] = String(value)
      any = true
    }
  }
  return any ? tags : undefined
}

/** A tag that is set to something other than `no` */
function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== 'no'
}

/**
 * Stacking level of a way: its `layer` when it is a whole number; else +1 on a bridge, −1 in a
 * tunnel (a passage under a building is not one); else the ground. `layer` is read on any way, a
 * track in a cutting carries one without being a tunnel. A list (`-1;-2`) gives its value closest
 * to the ground.
 */
export function readWayLevel(tags: Tags): WayLevel {
  let raw = 0
  let multiple = false
  const layer = tags.layer
  const values = (layer ?? '')
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter((part) => /^[+-]?\d+$/.test(part))
    .map((part) => parseInt(part, 10))
  if (values.length > 0) {
    raw = values.reduce((best, value) => (Math.abs(value) < Math.abs(best) ? value : best))
    multiple = new Set(values).size > 1
  } else if (isSet(tags.bridge)) {
    raw = 1
  } else if (isSet(tags.tunnel) && tags.tunnel !== 'building_passage') {
    raw = -1
  }
  const level = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, raw))
  const structure = isSet(tags.bridge) ? 'bridge' : isSet(tags.tunnel) && tags.tunnel !== 'building_passage' ? 'tunnel' : null
  const read: WayLevel = { level, multiple, clamped: level !== raw, structure }
  if (values.length > 0 && layer !== undefined) read.layer = layer
  return read
}

/** Kilometres per hour of a `maxspeed` value (`60`, `60 km/h`, `40 mph`), null when it is not a speed */
export function readSpeed(value: string | undefined): number | null {
  if (value === undefined) return null
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(mph|km\/h|kmh|kph)?\s*$/i.exec(value)
  if (!match) return null
  const figure = parseFloat(match[1].replace(',', '.'))
  if (!Number.isFinite(figure) || figure <= 0) return null
  return match[2]?.toLowerCase() === 'mph' ? figure * 1.609344 : figure
}

/**
 * Speed of a way in km/h: the lowest of `maxspeed`, `maxspeed:forward` and `maxspeed:backward`,
 * since a speed zone holds for both directions.
 */
export function readWaySpeed(tags: Tags): number | null {
  let speed: number | null = null
  for (const key of ['maxspeed', 'maxspeed:forward', 'maxspeed:backward']) {
    const read = readSpeed(tags[key])
    if (read !== null && (speed === null || read < speed)) speed = read
  }
  return speed
}

/** The zone speed that does not exceed `speed`: zones are multiples of 10 km/h, a limit is never raised */
export function zoneSpeedUnder(speed: number): number {
  return Math.max(MIN_ZONE_SPEED, Math.floor(speed / SPEED_ZONE_STEP + 1e-9) * SPEED_ZONE_STEP)
}

/** True when the options keep a way of this `railway` value and `service` */
function keeps(options: OsmImportOptions, kind: string, service: boolean): boolean {
  if (service && !options.serviceTracks) return false
  if (kind === 'rail') return true
  if (DISUSED_KINDS.includes(kind)) return options.disusedTracks
  return isExtraKind(kind) && options.extraKinds.includes(kind)
}

function isTrackKind(kind: string | undefined): kind is string {
  return kind === 'rail' || (kind !== undefined && (DISUSED_KINDS.includes(kind) || isExtraKind(kind)))
}

/**
 * Nodes and tracks of an Overpass answer. A node listed twice (once with its tags, once bare, which
 * is what `out body` followed by `out skel` gives) keeps its tags. Tracks under construction,
 * proposed or razed are no kind of track here and are never read.
 */
export function readOsm(data: OverpassResponse, options: OsmImportOptions): OsmRead {
  const elements: unknown[] = isObject(data) && Array.isArray(data.elements) ? data.elements : []
  const nodes = new Map<number, OsmNode>()
  const ways: OverpassElement[] = []

  for (const raw of elements) {
    if (!isObject(raw) || typeof raw.id !== 'number') continue
    if (raw.type === 'node') {
      if (typeof raw.lat !== 'number' || typeof raw.lon !== 'number') continue
      if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) continue
      const tags = readTags(raw.tags)
      const known = nodes.get(raw.id)
      if (!known) nodes.set(raw.id, tags ? { id: raw.id, lat: raw.lat, lon: raw.lon, tags } : { id: raw.id, lat: raw.lat, lon: raw.lon })
      else if (!known.tags && tags) known.tags = tags
    } else if (raw.type === 'way' && Array.isArray(raw.nodes)) {
      ways.push(raw as unknown as OverpassElement)
    }
  }

  const allTracks: OsmTrack[] = []
  for (const way of ways) {
    const tags = readTags(way.tags)
    const kind = tags?.railway
    if (!tags || !isTrackKind(kind)) continue
    // An area drawn with a track tag (a turntable pit) is not a track
    if (tags.area === 'yes') continue
    const ids = (way.nodes ?? []).filter((id): id is number => typeof id === 'number')
    const level: WayLevel = options.levels ? readWayLevel(tags) : { level: 0, multiple: false, clamped: false, structure: null }
    const rawSpeed = readWaySpeed(tags)
    const base = {
      id: way.id,
      tags,
      kind,
      service: isSet(tags.service),
      level,
      rawSpeed,
      speed: rawSpeed === null ? null : zoneSpeedUnder(rawSpeed),
      highSpeed: tags.highspeed === 'yes' || isSet(tags['railway:tvm']),
    }

    // Runs of nodes that exist: a node missing from the answer is the edge of the area
    let run: number[] = []
    let cutAtStart = false
    const flush = (cutAtEnd: boolean): void => {
      if (run.length >= 2) allTracks.push({ ...base, nodes: run, cutAtStart, cutAtEnd })
      run = []
    }
    for (const id of ids) {
      if (!nodes.has(id)) {
        flush(true)
        cutAtStart = true
        continue
      }
      // The same node twice in a row is one node
      if (run[run.length - 1] !== id) run.push(id)
    }
    flush(false)
  }

  return { nodes, allTracks, tracks: allTracks.filter((track) => keeps(options, track.kind, track.service)) }
}
