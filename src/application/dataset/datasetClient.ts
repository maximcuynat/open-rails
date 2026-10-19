import { readDatasetIndex, type DatasetIndex, type LineId } from '@domain/dataset/datasetIndex'
import type { SerializedProject } from '@infrastructure/persistence/persistence'

// Fetching the published « LGV France » dataset: the index once, then the project file of each
// line asked for. The files sit beside the application (`public/data/lgv/`), so the address is
// the base of the site plus `data/lgv/`. Every failure is a `DatasetError` with a French message.

export type DatasetErrorKind = 'offline' | 'http' | 'invalid' | 'aborted' | 'missing-line' | 'no-route'

export class DatasetError extends Error {
  readonly kind: DatasetErrorKind
  constructor(kind: DatasetErrorKind, message: string) {
    super(message)
    this.name = 'DatasetError'
    this.kind = kind
  }
}

export const DATASET_ERROR_MESSAGES = {
  offline: 'Impossible de télécharger le jeu de données. Vérifiez la connexion à Internet, puis réessayez.',
  http: (file: string, status: number): string => `Le fichier ${file} n’a pas pu être téléchargé (HTTP ${status}).`,
  invalid: (file: string): string => `Le fichier ${file} du jeu de données n’est pas lisible.`,
  aborted: 'Chargement annulé.',
  missingLine: (id: string): string => `La ligne « ${id} » n’est plus dans le jeu de données publié.`,
  noRoute: (from: string, to: string): string => `Aucun itinéraire sur les lignes à grande vitesse entre ${from} et ${to}.`,
  mismatch: 'Les fichiers du jeu de données ne concordent pas : régénérez-le.',
  unexpected: 'Le chargement a échoué pour une raison inattendue.',
}

/** What to tell the user about a failure of the dataset */
export function datasetErrorMessage(error: unknown): string {
  if (error instanceof DatasetError) return error.message
  return DATASET_ERROR_MESSAGES.unexpected
}

/** Where a file of the dataset is served: beside the application, under `data/lgv/` */
export function datasetUrl(file: string, baseUrl: string = import.meta.env.BASE_URL): string {
  return `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}data/lgv/${file}`
}

export interface DatasetFetch {
  /** The `fetch` to use (the tests give their own) */
  fetch?: typeof fetch
  baseUrl?: string
  signal?: AbortSignal
}

const INDEX_FILE = 'index.json'

/** One file of the dataset, parsed; the failures named */
async function fetchJson(file: string, options: DatasetFetch): Promise<unknown> {
  const doFetch = options.fetch ?? globalThis.fetch
  if (options.signal?.aborted) throw new DatasetError('aborted', DATASET_ERROR_MESSAGES.aborted)
  let response: Response
  try {
    const init: RequestInit = {}
    if (options.signal) init.signal = options.signal
    response = await doFetch(datasetUrl(file, options.baseUrl), init)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new DatasetError('aborted', DATASET_ERROR_MESSAGES.aborted)
    throw new DatasetError('offline', DATASET_ERROR_MESSAGES.offline)
  }
  if (!response.ok) throw new DatasetError('http', DATASET_ERROR_MESSAGES.http(file, response.status))
  try {
    return await response.json()
  } catch {
    throw new DatasetError('invalid', DATASET_ERROR_MESSAGES.invalid(file))
  }
}

let indexPromise: Promise<DatasetIndex> | null = null

/** The index, fetched once; a failure is forgotten so that the next call tries again */
export function loadDatasetIndex(options: DatasetFetch = {}): Promise<DatasetIndex> {
  indexPromise ??= fetchJson(INDEX_FILE, options)
    .then((raw) => {
      try {
        return readDatasetIndex(raw)
      } catch {
        throw new DatasetError('invalid', DATASET_ERROR_MESSAGES.invalid(INDEX_FILE))
      }
    })
    .catch((error: unknown) => {
      indexPromise = null
      throw error
    })
  return indexPromise
}

export function resetDatasetIndexCache(): void {
  indexPromise = null
  lineFileCache.clear()
}

export interface LineFetchProgress {
  done: number
  total: number
}

const isProject = (raw: unknown): raw is SerializedProject =>
  typeof raw === 'object' && raw !== null && Array.isArray((raw as SerializedProject).nodes) && Array.isArray((raw as SerializedProject).segments)

/** How many line files, once read, are kept in memory: a piece the view comes back to is not fetched nor read again */
export const LINE_FILE_CACHE_SIZE = 48

/** The files already read, by release and name, the one used last at the end (never changed once read) */
const lineFileCache = new Map<string, SerializedProject>()

function cachedLineFile(file: string): SerializedProject | undefined {
  const project = lineFileCache.get(file)
  if (project) {
    lineFileCache.delete(file)
    lineFileCache.set(file, project)
  }
  return project
}

function cacheLineFile(file: string, project: SerializedProject): void {
  lineFileCache.delete(file)
  lineFileCache.set(file, project)
  while (lineFileCache.size > LINE_FILE_CACHE_SIZE) lineFileCache.delete(lineFileCache.keys().next().value!)
}

/** Tests: the files read before are forgotten */
export function resetLineFileCache(): void {
  lineFileCache.clear()
}

/**
 * The project files of some lines, fetched together; `onProgress` is told after each one. A line
 * the index does not know fails before anything is asked. A file read before (one of the last
 * `LINE_FILE_CACHE_SIZE`) is given again without being fetched.
 */
export async function fetchLineFiles(
  index: DatasetIndex,
  lines: readonly LineId[],
  onProgress?: (progress: LineFetchProgress) => void,
  options: DatasetFetch = {},
): Promise<Map<LineId, SerializedProject>> {
  const files = new Map(index.lines.map((line) => [line.id, line.file]))
  for (const id of lines) if (!files.has(id)) throw new DatasetError('missing-line', DATASET_ERROR_MESSAGES.missingLine(id))
  let done = 0
  const total = lines.length
  const projects = await Promise.all(
    lines.map(async (id) => {
      const file = files.get(id)!
      // By release of the data: a file of another index under the same name is another file
      const key = `${index.dataDate}|${file}`
      let project = cachedLineFile(key)
      if (!project) {
        const raw = await fetchJson(file, options)
        if (!isProject(raw)) throw new DatasetError('invalid', DATASET_ERROR_MESSAGES.invalid(file))
        cacheLineFile(key, raw)
        project = raw
      }
      done++
      onProgress?.({ done, total })
      return [id, project] as const
    }),
  )
  return new Map(projects)
}
