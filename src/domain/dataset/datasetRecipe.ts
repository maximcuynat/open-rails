import type { DatasetIndex, LineId } from './datasetIndex'

// A project built from the published dataset is not saved as geometry (the whole of it would
// not fit the browser's storage) but as a recipe: which lines to fetch again, from which release
// of the data, between which stations. The geometry itself is never modified by the user.

export interface DatasetRecipe {
  version: 1
  /** `dataDate` of the index the lines were taken from */
  dataDate: string
  /** The lines loaded: those of the journey first, then the ones added while driving */
  lines: LineId[]
  /** The stations the journey was asked between (ids of the index); [] when unknown */
  stations: string[]
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')

/** A recipe as saved, or nothing when what is there is not one */
export function readDatasetRecipe(raw: unknown): DatasetRecipe | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (r.version !== 1 || typeof r.dataDate !== 'string' || !isStrings(r.lines) || r.lines.length === 0) return undefined
  return { version: 1, dataDate: r.dataDate, lines: [...r.lines], stations: isStrings(r.stations) ? [...r.stations] : [] }
}

/** The name of the project a recipe makes: its first and last station, else its lines */
export function recipeName(index: DatasetIndex, recipe: DatasetRecipe): string {
  const names = recipe.stations.map((id) => index.stations.find((s) => s.id === id)?.name).filter((n): n is string => n !== undefined)
  if (names.length >= 2) return `${names[0]} → ${names[names.length - 1]}`
  if (names.length === 1) return names[0]
  const lines = recipe.lines.map((id) => index.lines.find((l) => l.id === id)?.name ?? id)
  return lines.join(' + ')
}

/** The tools a locked project still accepts: looking, measuring, trains */
export const DATASET_LOCKED_TOOLS: ReadonlySet<string> = new Set(['select', 'pan', 'measure', 'locomotive', 'coupling'])

export const DATASET_LOCKED_MESSAGE = 'Réseau importé, non modifiable'
