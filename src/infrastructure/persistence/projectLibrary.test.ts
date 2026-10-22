import { beforeEach, describe, expect, it } from 'vitest'
import { getStorage, resetMemoryStorage } from './persistence'
import {
  createProject,
  duplicateProject,
  ensureLibrary,
  findProjectByOrigin,
  getProject,
  lastProjectId,
  LIBRARY_KEY,
  listProjects,
  noteProjectSaved,
  RECOVERED_PROJECT_NAME,
  rememberActiveProject,
  removeProject,
  renameProject,
} from './projectLibrary'
import { FIRST_PROJECT_ID, gameKeyOf, LEGACY_GAME_KEY, LEGACY_NETWORK_KEY, networkKeyOf } from './storageKeys'

const storage = () => getStorage()!

describe('the project library', () => {
  beforeEach(() => resetMemoryStorage())

  it('is empty in a browser that never saved anything', () => {
    expect(listProjects()).toEqual([])
    expect(lastProjectId()).toBeNull()
  })

  it('turns the save of v0.5 into project p1 where it is, without copying it', () => {
    storage().setItem(LEGACY_NETWORK_KEY, JSON.stringify({ version: 1, name: 'Ma ligne de Provence', nodes: [], segments: [] }))
    storage().setItem(LEGACY_GAME_KEY, '{"trains":[]}')
    const projects = listProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({ id: FIRST_PROJECT_ID, name: 'Ma ligne de Provence', named: false })
    expect(lastProjectId()).toBe(FIRST_PROJECT_ID)
    // Nothing moved: a v0.5 build still finds its save
    expect(storage().getItem(LEGACY_NETWORK_KEY)).toContain('Ma ligne de Provence')
    expect(storage().getItem(LEGACY_GAME_KEY)).toBe('{"trains":[]}')
    expect(networkKeyOf(FIRST_PROJECT_ID)).toBe(LEGACY_NETWORK_KEY)
    expect(gameKeyOf(FIRST_PROJECT_ID)).toBe(LEGACY_GAME_KEY)
  })

  it('changes nothing when it is made again', () => {
    storage().setItem(LEGACY_NETWORK_KEY, JSON.stringify({ name: 'A' }))
    const first = JSON.stringify(ensureLibrary(1000))
    const second = JSON.stringify(ensureLibrary(2000))
    expect(second).toBe(first)
    expect(storage().getItem(LIBRARY_KEY)).toBe(first)
  })

  it('does not stop on a save of v0.5 that does not read', () => {
    storage().setItem(LEGACY_NETWORK_KEY, 'corrupted{json')
    const projects = listProjects()
    expect(projects.map((p) => p.name)).toEqual([RECOVERED_PROJECT_NAME])
    expect(storage().getItem(LEGACY_NETWORK_KEY)).toBe('corrupted{json')
  })

  it('lists again a stored project the index forgot (an older index written by another tab)', () => {
    const a = createProject('A')
    const b = createProject('B')
    storage().setItem(networkKeyOf(b.id), JSON.stringify({ name: 'B' }))
    // Another tab writes the index it read before B existed
    storage().setItem(LIBRARY_KEY, JSON.stringify({ version: 1, activeId: a.id, projects: [{ id: a.id, name: 'A', named: false, updatedAt: 1, size: 0 }] }))
    expect(listProjects().map((p) => p.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('gives the first project of an empty browser the keys of v0.5, and new ids to the next', () => {
    const first = createProject('Ma ligne')
    const second = createProject('Bac à sable – Avignon TGV', { origin: 'sandbox:avignon' })
    expect(first.id).toBe(FIRST_PROJECT_ID)
    expect(second.id).not.toBe(FIRST_PROJECT_ID)
    expect(networkKeyOf(second.id)).toBe(`open-rail:project:${second.id}`)
    expect(gameKeyOf(second.id)).toBe(`open-rail:game:${second.id}`)
    expect(findProjectByOrigin('sandbox:avignon')?.id).toBe(second.id)
    expect(findProjectByOrigin('sandbox:marseille')).toBeNull()
  })

  it('lists the most recently written first', () => {
    const a = createProject('A', { now: 1 })
    const b = createProject('B', { now: 2 })
    expect(listProjects().map((p) => p.id)).toEqual([b.id, a.id])
    noteProjectSaved(a.id, 120, undefined, 3)
    expect(listProjects().map((p) => p.id)).toEqual([a.id, b.id])
    expect(getProject(a.id)?.size).toBe(120)
  })

  it('lets the name follow the stations until it is chosen by hand', () => {
    const p = createProject('Ma ligne')
    noteProjectSaved(p.id, 10, 'Gare 1 – Gare 2')
    expect(getProject(p.id)?.name).toBe('Gare 1 – Gare 2')
    expect(renameProject(p.id, '  Ligne de la vallée ')).toBe(true)
    noteProjectSaved(p.id, 10, 'Gare 1 – Gare 3')
    expect(getProject(p.id)).toMatchObject({ name: 'Ligne de la vallée', named: true })
    expect(renameProject(p.id, '   ')).toBe(false)
  })

  it('duplicates the network and the game under a new id', () => {
    const p = createProject('A')
    storage().setItem(networkKeyOf(p.id), '{"name":"A"}')
    storage().setItem(gameKeyOf(p.id), '{"trains":[1]}')
    const copy = duplicateProject(p.id)!
    expect(copy.id).not.toBe(p.id)
    expect(copy.name).toBe('A (copie)')
    expect(storage().getItem(networkKeyOf(copy.id))).toBe('{"name":"A"}')
    expect(storage().getItem(gameKeyOf(copy.id))).toBe('{"trains":[1]}')
    expect(duplicateProject('absent')).toBeNull()
  })

  it('removes a project with its network and its game, and forgets it as the last one', () => {
    const p = createProject('A')
    const q = createProject('B')
    storage().setItem(networkKeyOf(q.id), '{"name":"B"}')
    storage().setItem(gameKeyOf(q.id), '{}')
    rememberActiveProject(q.id)
    removeProject(q.id)
    expect(storage().getItem(networkKeyOf(q.id))).toBeNull()
    expect(storage().getItem(gameKeyOf(q.id))).toBeNull()
    expect(listProjects().map((e) => e.id)).toEqual([p.id])
    expect(lastProjectId()).toBeNull()
  })

  it('reads an index with broken entries without losing the good ones', () => {
    storage().setItem(LIBRARY_KEY, JSON.stringify({ version: 1, activeId: 'x', projects: [{ id: 'x', name: 'X' }, { id: 3 }, null, { id: 'x', name: 'doublon' }] }))
    expect(listProjects().map((p) => p.name)).toEqual(['X'])
    expect(lastProjectId()).toBe('x')
  })
})
