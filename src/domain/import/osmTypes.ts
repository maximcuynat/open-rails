import type { Network } from '../models/types'
import type { OsmFrame } from './osmProjection'

// Contract of the OpenStreetMap import. The conversion is pure: it takes the JSON an
// Overpass server answers and returns a network, with no DOM and no network call.

/** One element of an Overpass JSON answer (`out body` / `out skel`). */
export interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  /** Node ids of a way, in drawing order. */
  nodes?: number[]
  tags?: Record<string, string>
}

export interface OverpassResponse {
  elements: OverpassElement[]
  osm3s?: { timestamp_osm_base?: string }
}

/** Kinds of track beyond `railway=rail`, which is always imported. */
export type OsmExtraTrackKind = 'light_rail' | 'subway' | 'tram' | 'narrow_gauge'

/**
 * Where the signals of an imported network come from. `none`: no signal. `generated`: laid by the
 * automatic signalling. `real`: the ones OpenStreetMap holds, as they are. `mixed`: the real ones,
 * and the automatic signalling on the plain track that carries none of them.
 */
export type OsmSignalMode = 'none' | 'generated' | 'real' | 'mixed'

export const OSM_SIGNAL_MODES: readonly OsmSignalMode[] = ['none', 'generated', 'real', 'mixed']

export interface OsmImportOptions {
  /** Tracks carrying a `service` tag (yard, siding, spur, crossover). */
  serviceTracks: boolean
  /** `disused` and `abandoned` tracks. Tracks under construction or proposed are never imported. */
  disusedTracks: boolean
  extraKinds: OsmExtraTrackKind[]
  /** Read `bridge`, `tunnel` and `layer` into stacking levels. Off: everything on the ground. */
  levels: boolean
  /** Read `maxspeed` into speed zones. */
  speedLimits: boolean
  /** km/h given to a service track that carries no `maxspeed`. */
  defaultServiceSpeed: number
  /**
   * Parts of the data that do not touch the main network are left out and counted. Set, the ones
   * with at least this many km of track are kept with it: networks that only pass over each other.
   */
  keepDetachedOverKm?: number
  /** The signals to lay. The signalling level of the project plays no part: it only reads them. `generated` when absent. */
  signals?: OsmSignalMode
  /**
   * The frame the network is projected in. `local` when absent: a projection centred on the data.
   * `lambert93`: the national frame, the same for every import, so that two imports line up.
   */
  frame?: OsmFrame
}

export const DEFAULT_OSM_IMPORT_OPTIONS: OsmImportOptions = {
  serviceTracks: true,
  disusedTracks: false,
  extraKinds: [],
  levels: true,
  speedLimits: true,
  defaultServiceSpeed: 30,
  // A line that flies over another without joining it inside the area is still wanted
  keepDetachedOverKm: 0,
  signals: 'generated',
}

/** What an area holds, counted before anything is built, to show ahead of the confirmation. */
export interface OsmSurvey {
  /** Tracks kept by the options, and their total length. */
  ways: number
  lengthKm: number
  serviceWays: number
  switches: number
  bridges: number
  tunnels: number
  /** Tracks of each extra kind present in the data, whether the options keep them or not. */
  extraKinds: Partial<Record<OsmExtraTrackKind, number>>
  /** `railway=signal` nodes, and how many carry a French main signal with a direction. */
  signals: number
  typedMainSignals: number
  /** The `railway=signal` nodes the import can lay as they are: a kind it reads, and a direction */
  usableSignals?: number
  /** Rough number of rails the conversion will lay. */
  estimatedRails: number
  /** Length of the tracks left out because they do not touch the main network (see `keepDetachedOverKm`). */
  detachedKm?: number
}

/** A place the import could not settle, shown in the report and locatable on the plan. */
export interface OsmImportIssue {
  kind:
    | 'undecided-crossing' // two tracks cross without a shared node, at the same level
    | 'uncertain-level' // `layer` with several values, level out of range, clamped
    | 'unknown-junction' // four tracks or more at a node that fits no known device
    | 'sharp-angle' // a joint the trains cannot pass
    | 'cut-by-area' // a track end that is the edge of the imported area, not a buffer stop
    | 'signal-not-placed' // a real signal the import reads but could not lay
  /** World position, metres. */
  x: number
  y: number
  /** OSM ids of the elements involved, for the user to look them up. */
  osmIds: number[]
  detail?: string
}

/** Why a real signal the import reads was not laid */
export type OsmSignalSkip =
  | 'no-direction' // no `railway:signal:direction`, or `both`
  | 'ambiguous-direction' // on the node where two ways drawn in opposite directions meet
  | 'track-not-imported' // its node is on none of the tracks kept
  | 'off-track' // too far from the track once laid
  | 'on-switch' // on points or a crossing, with no room to stand clear of them
  | 'duplicate' // a signal of the same direction already stands there

/** The `railway=signal` nodes the import leaves aside, by what they are */
export type OsmSignalIgnored =
  | 'shunting' // carré violet: signalling of the service tracks
  | 'distant' // avertissement, disque, mirlitons: the announcement is implied
  | 'speed' // TIV, tableaux Z and R, chevrons
  | 'deactivated'
  | 'unknown' // a main or cab signal whose value is not in the table
  | 'untyped' // no key says what the signal is
  | 'other' // departure, route, stop boards…

/** Signals laid, by role; the marker boards of a cab-signalled line are counted in their role too */
export interface OsmSignalCount {
  protection: number
  spacing: number
  cabMarkers: number
}

export interface OsmSignalReport {
  mode: OsmSignalMode
  /** `railway=signal` nodes in the data */
  found: number
  /** Real signals laid, and how many of them had to be moved clear of points */
  real: OsmSignalCount
  realMoved: number
  /** Real signals read but not laid, by reason */
  skipped: Partial<Record<OsmSignalSkip, number>>
  /** Nodes left aside, by kind */
  ignored: Partial<Record<OsmSignalIgnored, number>>
  /** Signals laid by the automatic signalling */
  generated: OsmSignalCount
  /** Stretches of plain track the automatic signalling left alone because they carry a real signal (`mixed`) */
  stretchesLeftToReal: number
}

export interface OsmImportReport {
  nodes: number
  rails: number
  lengthKm: number
  turnouts: number
  doubleSlips: number
  fixedCrossings: number
  /** Rails above the ground, and below it. */
  railsOnBridge: number
  railsInTunnel: number
  /** Crossings without a shared node: settled by the levels, and left undecided. */
  stackedCrossings: number
  undecidedCrossings: number
  speedZones: number
  /** Length of main track that carried no `maxspeed`. */
  lengthWithoutSpeedKm: number
  /** Parts of the data left out because they do not touch the main network. */
  droppedComponents: number
  /** What was done about the signals; absent from a report written before the import laid any */
  signals?: OsmSignalReport
  issues: OsmImportIssue[]
}

/** Where imported data comes from. Stored in the project: the ODbL asks for it. */
export interface OsmSource {
  /** Centre of the projection: world (0, 0). */
  lat: number
  lon: number
  /** The frame the network is projected in; `local` when absent. */
  frame?: OsmFrame
  /** `osm3s.timestamp_osm_base` of the answer when present, else the day of the import (ISO). */
  dataDate: string
  importedAt: string
}

export const OSM_ATTRIBUTION = '© les contributeurs d’OpenStreetMap'
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright'

export interface OsmImportResult {
  network: Network
  /** Highest line speed read, km/h, when `speedLimits` is on and one was found. */
  lineSpeed?: number
  /** True when any `highspeed=yes` or `railway:tvm` track was kept. */
  highSpeed: boolean
  /** Centre used for the projection: world (0, 0). */
  origin: { lat: number; lon: number }
  /** The frame the network is projected in (`projectionFor(frame, origin)` reads it back). */
  frame: OsmFrame
  dataDate?: string
  report: OsmImportReport
}
