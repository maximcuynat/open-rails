import type { EditorStore } from '@application/state/editorStore'
import type { OsmImportIssue, OsmImportResult, OsmSource } from '@domain/import/osmTypes'
import type { SignallingLevel } from '@domain/models/signals'
import { DEFAULT_LINE_SETTINGS, LINE_PRESETS, LINE_SPEED_RANGE, type LineSettings } from '@domain/models/speedLimits'
import { SCALE_PRESETS } from '@domain/models/units'
import { findSectionChains, type SectionMetadata } from '@domain/models/sections'
import type { Network } from '@domain/models/types'
import { serializeNetwork, type SerializedProject } from '@infrastructure/persistence/persistence'

/**
 * From a converted OpenStreetMap area to a project in the editor. The conversion itself is the
 * domain's (`convertOsm`); this only wraps its result the way a project file is written and loads
 * it through the one path that sets the store, the history and the autosave.
 */

export const DEFAULT_OSM_PROJECT_NAME = 'Import OpenStreetMap'

export interface OsmProjectOptions {
  /** The « ponts et tunnels » option of the import: the project then stacks levels without relief */
  levels: boolean
  /** Name of the place, when the user searched for one */
  placeName?: string
  /**
   * Signalling level of the project: how the imported signals are read. The import itself does not
   * depend on it. Standard when absent.
   */
  signallingLevel?: SignallingLevel
  /** Date of the import; today when absent (given by the tests) */
  now?: Date
}

/**
 * Line settings of an imported network: the speed read on the tracks, on a conventional or a
 * high-speed line. When no speed was read, the preset of the settings window for that kind of line.
 */
export function osmLineSettings(result: Pick<OsmImportResult, 'lineSpeed' | 'highSpeed'>): Pick<LineSettings, 'lineSpeed' | 'lineType'> {
  const lineType = result.highSpeed ? 'highSpeed' : 'classic'
  if (typeof result.lineSpeed === 'number' && Number.isFinite(result.lineSpeed) && result.lineSpeed > 0) {
    // Speeds go by tens everywhere in the editor
    const rounded = Math.round(result.lineSpeed / 10) * 10
    return { lineSpeed: Math.max(LINE_SPEED_RANGE.min, Math.min(LINE_SPEED_RANGE.max, rounded)), lineType }
  }
  const preset = result.highSpeed ? LINE_PRESETS.find((p) => p.id === 'lgv300') : LINE_PRESETS.find((p) => p.id === 'classic160')
  return { lineSpeed: preset?.lineSpeed ?? DEFAULT_LINE_SETTINGS.lineSpeed, lineType }
}

/** Where the data comes from, as the project keeps it (the ODbL asks for it) */
export function osmSourceOf(result: Pick<OsmImportResult, 'origin' | 'dataDate' | 'frame'>, now: Date = new Date()): OsmSource {
  const importedAt = now.toISOString()
  const source: OsmSource = {
    lat: result.origin.lat,
    lon: result.origin.lon,
    dataDate: result.dataDate || importedAt.slice(0, 10),
    importedAt,
  }
  if (result.frame === 'lambert93') source.frame = result.frame
  return source
}

export function osmProjectName(placeName?: string): string {
  const name = placeName?.trim()
  return name ? `${name} (OSM)` : DEFAULT_OSM_PROJECT_NAME
}

/**
 * The platform tracks of the stations as sections: each section a stop stands on becomes a
 * « voie à quai » named after its station and platform. One entry under the key of the section and
 * one per rail, as the editor writes them; the names are unique, as `nameSections` keeps a name
 * for one section only.
 */
export function stationSectionMeta(net: Network): Record<string, SectionMetadata> {
  const meta: Record<string, SectionMetadata> = {}
  if (net.stations.size === 0) return meta
  const sections = findSectionChains(net)
  const sectionOf = new Map<string, (typeof sections)[number]>()
  for (const section of sections) for (const segId of section.segmentIds) sectionOf.set(segId, section)
  for (const station of net.stations.values()) {
    /** Platform labels by section: two stops on one section make one « voie A/B » */
    const labels = new Map<(typeof sections)[number], string[]>()
    station.stops.forEach((stop, i) => {
      const section = sectionOf.get(stop.segId)
      if (!section) return
      const list = labels.get(section) ?? []
      list.push(stop.ref ?? String(i + 1))
      labels.set(section, list)
    })
    for (const [section, refs] of labels) {
      const entry: SectionMetadata = { type: 'station_stop', name: `${station.name} · voie ${refs.join('/')}`, isCustomName: true }
      meta[section.sortedSegKey] = entry
      for (const segId of section.segmentIds) meta[segId] = { ...entry }
    }
  }
  return meta
}

/**
 * The project file of an import: full size, in metres, no baseboard, no camera (the view is
 * framed on the network once loaded) and no train. Its sections are the platform tracks.
 */
export function buildOsmProject(result: OsmImportResult, options: OsmProjectOptions): SerializedProject {
  const real = SCALE_PRESETS['1:1']
  return serializeNetwork(
    result.network,
    osmProjectName(options.placeName),
    undefined,
    stationSectionMeta(result.network),
    undefined,
    undefined,
    undefined,
    real.defaultUnit,
    real.id,
    real.defaultGauge,
    real.defaultTrackSpacing,
    false,
    false,
    undefined,
    undefined,
    [],
    undefined,
    osmLineSettings(result),
    options.signallingLevel ? { level: options.signallingLevel } : undefined,
    undefined,
    { flatLevels: options.levels, osmSource: osmSourceOf(result, options.now) },
  )
}

/** Ask the canvas to frame the whole network (`App.tsx` listens: it knows the size of the view) */
function requestFitView(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('rail:fit-view'))
}

/**
 * Replace the current project with an imported one and frame it. One step of the history, like
 * opening an example: undoing brings the previous network back.
 */
export function loadOsmImport(
  store: EditorStore,
  result: OsmImportResult,
  options: OsmProjectOptions,
  fitView: () => void = requestFitView,
): SerializedProject {
  const project = buildOsmProject(result, options)
  store.loadFromData(project)
  fitView()
  return project
}

/** Pixels per metre below which a place of the report is not shown: a yard is read from there */
export const OSM_PLACE_MIN_SCALE = 5

/** Centre the view on a place the report points at, close enough to read the track around it */
export function showOsmPlace(store: EditorStore, place: Pick<OsmImportIssue, 'x' | 'y'>): void {
  store.camera.x = place.x
  store.camera.y = place.y
  if (store.camera.scale < OSM_PLACE_MIN_SCALE) store.camera.scale = OSM_PLACE_MIN_SCALE
  store.notify()
}
