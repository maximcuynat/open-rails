// Where each project of the library is written. The first project keeps the keys of the single
// save of v0.5, so that the library is made without copying anything and a v0.5 build still finds
// that project; the others have keys of their own. The project being edited is the active one:
// the network and the game are read and written under its keys.

/** The single save of v0.5, kept by the first project of the library */
export const LEGACY_NETWORK_KEY = 'open-rail:network'
/** What the trains were doing, in v0.5; kept by the first project */
export const LEGACY_GAME_KEY = 'open-rail:game'
/** The project that took over the save of v0.5 */
export const FIRST_PROJECT_ID = 'p1'

const NETWORK_PREFIX = 'open-rail:project:'
const GAME_PREFIX = 'open-rail:game:'

let activeId = FIRST_PROJECT_ID

export function networkKeyOf(id: string): string {
  return id === FIRST_PROJECT_ID ? LEGACY_NETWORK_KEY : NETWORK_PREFIX + id
}

export function gameKeyOf(id: string): string {
  return id === FIRST_PROJECT_ID ? LEGACY_GAME_KEY : GAME_PREFIX + id
}

/** The id of the project a key holds the network of, or null for any other key */
export function projectIdOfNetworkKey(key: string): string | null {
  if (key === LEGACY_NETWORK_KEY) return FIRST_PROJECT_ID
  return key.startsWith(NETWORK_PREFIX) && key.length > NETWORK_PREFIX.length ? key.slice(NETWORK_PREFIX.length) : null
}

export function activeProjectId(): string {
  return activeId
}

/** Read and write under the keys of this project from now on */
export function setActiveProjectId(id: string): void {
  activeId = id
}

export function activeNetworkKey(): string {
  return networkKeyOf(activeId)
}

export function activeGameKey(): string {
  return gameKeyOf(activeId)
}
