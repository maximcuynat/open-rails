import type { SignalRole } from '../models/types'
import type { OsmSignalIgnored } from './osmTypes'

// What the values of the French signal tags of OpenStreetMap stand for. Data only: the reading is
// in `osmSignals.ts`. Two generations of values live side by side in the data (the reference page
// was rewritten between 2025 and 2026, see `tasks/recherche-import-osm.md` §5), and more renaming
// is likely: a new spelling is one line here. A value that is in no list is not an error, the
// signal is counted as unknown and left aside.

export const SIGNAL_DIRECTION_KEY = 'railway:signal:direction'

// ─────────────────── Lineside stop signals: `railway:signal:main` ───────────────────

export const MAIN_SIGNAL_KEY = 'railway:signal:main'

/** What a value of `railway:signal:main` is */
export type MainSignalKind =
  | 'carre' // absolute stop: protection
  | 'semaphore' // block signal: spacing, unless its states or its plate make it a carré
  | 'shunting' // carré violet: left aside

export const MAIN_SIGNAL_VALUES: Readonly<Record<string, MainSignalKind>> = {
  'FR:C': 'carre', // current
  'FR:CARRE': 'carre', // 2025 and before
  'FR:GA': 'carre', // guidon d'arrêt, by approximation
  'FR:S': 'semaphore', // unchanged
  'FR:Cv': 'shunting', // current
  'FR:CV': 'shunting', // 2025 and before
}

/** `railway:signal:main:states` lists what the signal can show, `;` between them */
export const MAIN_STATES_KEY = 'railway:signal:main:states'
/** A signal that can show one of these is a carré, whatever its main value says */
export const CARRE_STATES: readonly string[] = ['FR:C', 'FR:CARRE']

/** The identification plate: `:plate` in the old data, `:type` in the current scheme */
export const MAIN_PLATE_KEYS: readonly string[] = ['railway:signal:main:plate', 'railway:signal:main:type']

/** Nf: may not be passed. F, PR, BM: may be passed under conditions */
export const PLATE_ROLES: Readonly<Record<string, SignalRole>> = {
  'FR:NF': 'protection',
  'FR:Nf': 'protection',
  'FR:F': 'spacing',
  'FR:PR': 'spacing',
  'FR:BM': 'spacing',
}

/** `yes` under one of these: the signal is out of use (croix de Saint-André) */
export const DEACTIVATED_KEYS: readonly string[] = ['railway:signal:main:deactivated', 'railway:signal:train_protection:deactivated']

// ─────────────────── Marker boards of a cab-signalled line: `railway:signal:train_protection` ───────────────────

export const CAB_SIGNAL_KEY = 'railway:signal:train_protection'

/** Current scheme: the value says « a marker », these two keys say which one */
export const CAB_MARKER_VALUE = 'FR:marker'
export const CAB_MARKER_KIND_KEY = 'railway:signal:train_protection:main'
export const CAB_STOP_MARKER_KINDS: readonly string[] = ['stop_marker']
/** `FR:NF` / `FR:F` of a marker: read with `PLATE_ROLES` */
export const CAB_MARKER_PLATE_KEYS: readonly string[] = ['railway:signal:train_protection:main:type', 'railway:signal:train_protection:type']

/**
 * Old values that are a stop marker by themselves (several may be listed, `;` between them). They
 * do not say Nf or F: such a marker is a block marker unless points follow it.
 */
export const OLD_CAB_MARKER_VALUES: readonly string[] = [
  'FR:REP_TVM',
  'FR:REP_TGV',
  'FR:TVM',
  'FR:repère_arrêt_TVM',
  'FR:REP_ETCS',
  'FR:repère_arrêt_ETCS',
]

// ─────────────────── Everything else ───────────────────

/**
 * Categories (`railway:signal:<category>`) the import leaves aside, and under which count. A
 * category that is not here is counted as `other`.
 */
export const IGNORED_CATEGORIES: Readonly<Record<string, OsmSignalIgnored>> = {
  distant: 'distant',
  speed_limit: 'speed',
  speed_limit_distant: 'speed',
  speed_limit_reminder: 'speed',
  shunting: 'shunting',
  minor: 'other',
  route: 'other',
  route_distant: 'other',
  departure: 'other',
  stop: 'other',
  stop_distant: 'other',
  electricity: 'other',
  crossing: 'other',
  crossing_hint: 'other',
  whistle: 'other',
}

/** When a node carries several of them, the first of these names it */
export const IGNORED_ORDER: readonly OsmSignalIgnored[] = ['distant', 'speed', 'shunting', 'other']
