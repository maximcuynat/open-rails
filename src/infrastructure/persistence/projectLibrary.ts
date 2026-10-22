import { getStorage, storageKeyList } from './persistence'
import {
  FIRST_PROJECT_ID,
  gameKeyOf,
  LEGACY_NETWORK_KEY,
  networkKeyOf,
  projectIdOfNetworkKey,
} from './storageKeys'

// The projects kept in the browser. An index (`LIBRARY_KEY`) lists them; each project's network
// and game sit under keys of their own (`storageKeys.ts`). The index is a list, never the truth
// about what is stored: it is read again before every write, and at start every stored project
// the index does not list is put back in it, so that a project is never lost from view (a tab
// that wrote an older index, a removal that never finished).
//
//   open-rail:projects              { version, activeId, projects: [{ id, name, … }] }
//   open-rail:network / :game        project p1, the single save of v0.5
//   open-rail:project:<id> / open-rail:game:<id>   every other project

export const LIBRARY_KEY = 'open-rail:projects'

export interface ProjectEntry {
  id: string
  name: string
  /** The name was chosen by hand: it no longer follows the stations (« Gare 1 – Gare 2 ») */
  named: boolean
  /** Last write, ms since the epoch */
  updatedAt: number
  /** Size of the stored network, characters */
  size: number
  /** Where a game project comes from (« sandbox:<station> »…): starting there again opens it again */
  origin?: string
}

interface LibraryIndex {
  version: 1
  activeId: string | null
  projects: ProjectEntry[]
}

/** Name of a project found without an entry, when its stored network gives none */
export const RECOVERED_PROJECT_NAME = 'Projet retrouvé'

function emptyIndex(): LibraryIndex {
  return { version: 1, activeId: null, projects: [] }
}

function readEntry(raw: unknown): ProjectEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  if (typeof e.id !== 'string' || e.id === '' || typeof e.name !== 'string') return null
  return {
    id: e.id,
    name: e.name,
    named: e.named === true,
    updatedAt: typeof e.updatedAt === 'number' && Number.isFinite(e.updatedAt) ? e.updatedAt : 0,
    size: typeof e.size === 'number' && Number.isFinite(e.size) ? e.size : 0,
    ...(typeof e.origin === 'string' ? { origin: e.origin } : {}),
  }
}

/** The index as stored, or null when there is none or it does not read */
function readStoredIndex(): LibraryIndex | null {
  try {
    const raw = getStorage()?.getItem(LIBRARY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || !Array.isArray(parsed.projects)) return null
    const projects: ProjectEntry[] = []
    const seen = new Set<string>()
    for (const raw of parsed.projects) {
      const entry = readEntry(raw)
      if (entry && !seen.has(entry.id)) {
        seen.add(entry.id)
        projects.push(entry)
      }
    }
    const activeId = typeof parsed.activeId === 'string' && seen.has(parsed.activeId) ? parsed.activeId : null
    return { version: 1, activeId, projects }
  } catch {
    return null
  }
}

function writeIndex(index: LibraryIndex): boolean {
  try {
    getStorage()?.setItem(LIBRARY_KEY, JSON.stringify(index))
    return true
  } catch (err) {
    console.warn('Failed to write the project library', err)
    return false
  }
}

/** The name a stored network gives itself, if any */
function storedName(key: string): string | null {
  try {
    const raw = getStorage()?.getItem(key)
    if (!raw) return null
    const name = (JSON.parse(raw) as { name?: unknown }).name
    return typeof name === 'string' && name.trim() !== '' ? name : null
  } catch {
    return null
  }
}

function storedSize(key: string): number {
  try {
    return getStorage()?.getItem(key)?.length ?? 0
  } catch {
    return 0
  }
}

/**
 * Make sure the library exists and lists every stored project. The first time, the save of v0.5
 * becomes project p1 where it is: nothing is copied, so nothing can fail for lack of room. Run
 * again, it changes nothing. Returns the index as it now stands.
 */
export function ensureLibrary(now = Date.now()): LibraryIndex {
  const stored = readStoredIndex()
  const index = stored ?? emptyIndex()
  const listed = new Set(index.projects.map((p) => p.id))
  let changed = stored === null
  for (const key of storageKeyList()) {
    const id = projectIdOfNetworkKey(key)
    if (id === null || listed.has(id)) continue
    listed.add(id)
    index.projects.push({
      id,
      name: storedName(key) ?? RECOVERED_PROJECT_NAME,
      named: false,
      updatedAt: now,
      size: storedSize(key),
    })
    changed = true
  }
  // The save of v0.5 was the project being edited: it opens again at the first start of the library
  if (stored === null && listed.has(FIRST_PROJECT_ID)) {
    index.activeId = FIRST_PROJECT_ID
    changed = true
  }
  if (changed) writeIndex(index)
  return index
}

/** Every project, the most recently written first */
export function listProjects(): ProjectEntry[] {
  return [...ensureLibrary().projects].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getProject(id: string): ProjectEntry | null {
  return ensureLibrary().projects.find((p) => p.id === id) ?? null
}

/** The project opened last, if it is still there */
export function lastProjectId(): string | null {
  return ensureLibrary().activeId
}

/** Change the index as it is stored now (never an older copy), and write it */
function updateIndex(change: (index: LibraryIndex) => void): LibraryIndex {
  const index = ensureLibrary()
  change(index)
  writeIndex(index)
  return index
}

/** Remember the project being edited, for the next start */
export function rememberActiveProject(id: string | null): void {
  updateIndex((index) => {
    index.activeId = id !== null && index.projects.some((p) => p.id === id) ? id : null
  })
}

function newProjectId(index: LibraryIndex): string {
  const taken = new Set(index.projects.map((p) => p.id))
  let id: string
  do {
    id = 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36)
  } while (taken.has(id) || id === FIRST_PROJECT_ID)
  return id
}

/** A new, empty entry; its network is written by the first save */
export function createProject(name: string, options: { origin?: string; named?: boolean; now?: number } = {}): ProjectEntry {
  const now = options.now ?? Date.now()
  let created: ProjectEntry | null = null
  updateIndex((index) => {
    created = {
      id: index.projects.length === 0 && storedSize(LEGACY_NETWORK_KEY) === 0 ? FIRST_PROJECT_ID : newProjectId(index),
      name,
      named: options.named ?? false,
      updatedAt: now,
      size: 0,
      ...(options.origin !== undefined ? { origin: options.origin } : {}),
    }
    index.projects.push(created)
  })
  return created!
}

/** The game project already made from this starting point, if any */
export function findProjectByOrigin(origin: string): ProjectEntry | null {
  return ensureLibrary().projects.find((p) => p.origin === origin) ?? null
}

/** After a successful write of the project: its date, its size and, unless chosen by hand, its name */
export function noteProjectSaved(id: string, size: number, name?: string, now = Date.now()): void {
  updateIndex((index) => {
    const entry = index.projects.find((p) => p.id === id)
    if (!entry) return
    entry.updatedAt = now
    entry.size = size
    if (name !== undefined && !entry.named) entry.name = name
  })
}

/** A name chosen by hand: the project keeps it from now on */
export function renameProject(id: string, name: string): boolean {
  const trimmed = name.trim()
  if (trimmed === '') return false
  let found = false
  updateIndex((index) => {
    const entry = index.projects.find((p) => p.id === id)
    if (!entry) return
    entry.name = trimmed
    entry.named = true
    found = true
  })
  return found
}

/** A copy of a project, network and game, under a new id. Null when there is no such project or no room */
export function duplicateProject(id: string, now = Date.now()): ProjectEntry | null {
  const source = getProject(id)
  if (!source) return null
  const storage = getStorage()
  if (!storage) return null
  let copy: ProjectEntry | null = null
  try {
    const network = storage.getItem(networkKeyOf(id))
    const game = storage.getItem(gameKeyOf(id))
    const index = ensureLibrary()
    const newId = newProjectId(index)
    if (network !== null) storage.setItem(networkKeyOf(newId), network)
    if (game !== null) storage.setItem(gameKeyOf(newId), game)
    copy = { id: newId, name: `${source.name} (copie)`, named: true, updatedAt: now, size: network?.length ?? 0 }
    index.projects.push(copy)
    writeIndex(index)
  } catch (err) {
    console.warn('Failed to duplicate a project', err)
    return null
  }
  return copy
}

/** Remove a project for good: its entry, its network and its game */
export function removeProject(id: string): void {
  const storage = getStorage()
  try {
    storage?.removeItem(networkKeyOf(id))
    storage?.removeItem(gameKeyOf(id))
  } catch (err) {
    console.warn('Failed to remove a project', err)
  }
  updateIndex((index) => {
    index.projects = index.projects.filter((p) => p.id !== id)
    if (index.activeId === id) index.activeId = null
  })
}
