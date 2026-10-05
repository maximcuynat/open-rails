import type { EditorStore } from '@application/state/editorStore'
import { applyConsoleCommand } from '@application/console/consoleCommands'
import { buildConsoleState, buildFleet } from '@application/console/consoleState'
import { createRemoteHost, type RemoteHost, type RemoteHostSnapshot } from './remoteHost'
import type { RemoteLink, Scheduler } from './remoteLink'

/**
 * The phone desk as the PC sees it: one session at most, opened and cut by the user. It belongs to
 * this page and to nothing else — nothing is saved, and every opening draws a new room code.
 */

export interface RemoteSessionDeps {
  store: EditorStore
  /** Builds the transport of a new session (the WebSocket link in the app, a fake one in tests) */
  createLink: () => RemoteLink
  scheduler?: Scheduler
  /** Room code source, for tests (default: random) */
  generateRoom?: () => string
}

export interface RemoteSession {
  /** `null` while no session is open. Same object until something changes: fit for `useSyncExternalStore`. */
  getSnapshot(): RemoteHostSnapshot | null
  subscribe(listener: () => void): () => void
  /** Opens a room on the relay; does nothing when a session is already open */
  open(): void
  /** Tells the phone, closes the room and the link; does nothing when no session is open */
  close(): void
}

export function createRemoteSession(deps: RemoteSessionDeps): RemoteSession {
  const { store } = deps
  const listeners = new Set<() => void>()
  let host: RemoteHost | null = null
  let offHost: (() => void) | null = null

  const emit = () => {
    for (const listener of [...listeners]) listener()
  }

  return {
    getSnapshot: () => host?.getSnapshot() ?? null,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    open() {
      if (host) return
      host = createRemoteHost({
        link: deps.createLink(),
        getState: () => buildConsoleState(store),
        getFleet: () => buildFleet(store),
        // The store methods behind a command notify, so the screen of the PC follows the phone
        apply: (command) => applyConsoleCommand(store, command, 'remote'),
        scheduler: deps.scheduler,
        generateRoom: deps.generateRoom,
      })
      offHost = host.subscribe(emit)
      emit()
    },
    close() {
      if (!host) return
      const closing = host
      offHost?.()
      offHost = null
      host = null
      // Puts back a brake the phone was holding, then closes the room and the link
      closing.stop()
      emit()
    },
  }
}
