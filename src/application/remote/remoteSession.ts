import type { EditorStore } from '@application/state/editorStore'
import { applyDeskCommand } from '@application/console/consoleCommands'
import { buildDeskConsoleState, buildFleet } from '@application/console/consoleState'
import { createRemoteHost, type RemoteHost, type RemoteHostSnapshot } from './remoteHost'
import { systemScheduler, type RemoteLink, type Scheduler } from './remoteLink'

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

/** How long a desk that lost its link keeps its seat and its train, ms */
export const DESK_RETURN_GRACE_MS = 20000

export function createRemoteSession(deps: RemoteSessionDeps): RemoteSession {
  const { store } = deps
  const listeners = new Set<() => void>()
  let host: RemoteHost | null = null
  let offHost: (() => void) | null = null

  const scheduler = deps.scheduler ?? systemScheduler
  /** The desks gone and not yet given up on, with the timer that will */
  const away = new Map<number, unknown>()
  const forgive = (desk: number) => {
    const timer = away.get(desk)
    if (timer === undefined) return
    scheduler.clearTimeout(timer)
    away.delete(desk)
  }

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
        getState: (desk) => buildDeskConsoleState(store, desk),
        getFleet: () => buildFleet(store),
        // The store methods behind a command notify, so the screen of the PC follows the phone
        apply: (desk, command) => applyDeskCommand(store, desk, command),
        seat: (desk, name, back) => {
          forgive(desk)
          // Another phone under the number of one that left: it does not inherit its train
          if (!back) store.unseatDesk(desk)
          store.seatDesk(desk, name)
        },
        // A desk that leaves stops its train at once, and keeps it for the time a phone takes to
        // find its network again: only then is the train nobody's
        unseat: (desk) => {
          forgive(desk)
          store.restDesk(desk)
          away.set(desk, scheduler.setTimeout(() => {
            away.delete(desk)
            store.unseatDesk(desk)
          }, DESK_RETURN_GRACE_MS))
        },
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
      for (const desk of [...away.keys()]) forgive(desk)
      store.unseatAllDesks()
      emit()
    },
  }
}
