import type { ConsoleCommand, ConsoleState, FleetEntry } from '../console/consoleContract'
import {
  BRAKE_REPEAT_MS,
  MAX_DRIVER_NAME_LENGTH,
  PROTOCOL_VERSION,
  generateClientId,
  type RoomErrorCode,
} from './protocol'
import { systemScheduler, type LinkStatus, type RemoteLink, type Scheduler } from './remoteLink'

/**
 * The phone side: joins a room, keeps the last fleet and console state it received, and sends
 * numbered commands. No React here — a component subscribes and reads the snapshot.
 */

/** Why the desk gave up. `host-closed`: the PC cut the link on purpose. */
export type DeskEnd = RoomErrorCode | 'host-closed'

export interface RemoteDeskDeps {
  link: RemoteLink
  /** Code of the room to join (see `roomFromPageUrl`) */
  room: string
  /** What the driver wants to be called on the PC and on the other desks; none: « Pupitre N » */
  name?: string
  scheduler?: Scheduler
  /** Token that lets this desk take its seat back after a reconnection (default: random) */
  clientId?: string
  /**
   * After the room was lost (the PC's own connection dropped), how long the desk keeps trying to
   * get back in before it reports `unknown-room`
   */
  rejoinGraceMs?: number
}

export interface RemoteDeskSnapshot {
  link: LinkStatus
  /** Seated in the room, the PC is there */
  joined: boolean
  /** The number this desk sits under in the room; null before it is seated */
  desk: number | null
  fleet: FleetEntry[]
  /** State of the train this desk holds; null while it holds none, or before the first state */
  state: ConsoleState | null
  /** Sequence of the last command the PC took into account */
  ack: number
  /** Set once the desk has given up; the link is then closed and nothing more will happen */
  ended: DeskEnd | null
}

export interface RemoteDesk {
  /** Same object until something changes: fit for `useSyncExternalStore` */
  getSnapshot(): RemoteDeskSnapshot
  subscribe(listener: () => void): () => void
  /**
   * Sends a command about the train currently shown. Returns its sequence number, or 0 when it
   * could not be sent (not joined). A `brake` `apply` / `release` is a held command: it is
   * repeated until a `brake` `hold` is sent.
   */
  send(command: ConsoleCommand): number
  /** Leaves the room and closes the link */
  stop(): void
}

export function createRemoteDesk(deps: RemoteDeskDeps): RemoteDesk {
  const { link, room } = deps
  const scheduler = deps.scheduler ?? systemScheduler
  const clientId = deps.clientId ?? generateClientId()
  const rejoinGraceMs = deps.rejoinGraceMs ?? 20000

  let snapshot: RemoteDeskSnapshot = {
    link: link.status,
    joined: false,
    desk: null,
    fleet: [],
    state: null,
    ack: 0,
    ended: null,
  }
  const listeners = new Set<() => void>()
  let seq = 0
  let everJoined = false
  /** When the room was lost after having been joined; null while seated */
  let lostAt: number | null = null
  let heldBrake: ConsoleCommand | null = null
  let brakeTimer: unknown = null

  const update = (patch: Partial<RemoteDeskSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of [...listeners]) listener()
  }

  const stopRepeating = () => {
    if (brakeTimer !== null) scheduler.clearInterval(brakeTimer)
    brakeTimer = null
    heldBrake = null
  }

  const transmit = (command: ConsoleCommand): number => {
    if (!snapshot.joined) return 0
    const trainId = command.type === 'selectTrain' ? command.trainId : snapshot.state?.trainId ?? null
    const sent = link.send({ t: 'command', seq: seq + 1, trainId, command })
    return sent ? ++seq : 0
  }

  const unseat = () => {
    // Nothing is replayed after a cut: the PC has already put the brake back to `hold`
    stopRepeating()
    if (everJoined && lostAt === null) lostAt = scheduler.now()
    if (snapshot.joined || snapshot.state) update({ joined: false, state: null })
  }

  const end = (reason: DeskEnd) => {
    stopRepeating()
    offMessage()
    offStatus()
    link.close()
    update({ link: 'closed', joined: false, state: null, ended: reason })
  }

  const join = () => {
    const name = deps.name?.trim().slice(0, MAX_DRIVER_NAME_LENGTH)
    link.send(name ? { t: 'join', v: PROTOCOL_VERSION, room, client: clientId, name } : { t: 'join', v: PROTOCOL_VERSION, room, client: clientId })
  }

  const offMessage = link.onMessage((message) => {
    switch (message.t) {
      case 'joined':
        everJoined = true
        lostAt = null
        update({ joined: true, desk: message.desk })
        return
      case 'fleet':
        update({ fleet: message.fleet })
        return
      case 'state':
        update({ state: message.state, ack: message.ack })
        return
      case 'bye':
        end('host-closed')
        return
      case 'peer-left':
        // The room went with the PC's connection; the PC may reopen it under the same code
        unseat()
        return
      case 'error': {
        const retry =
          message.code === 'unknown-room' &&
          lostAt !== null &&
          scheduler.now() - lostAt < rejoinGraceMs
        // While retrying, the link reconnects by itself and `join` goes out again
        if (!retry) end(message.code)
        return
      }
      default:
        return
    }
  })

  const offStatus = link.onStatus((status) => {
    if (status === 'open') {
      update({ link: status })
      join()
    } else {
      unseat()
      update({ link: status })
    }
  })

  if (link.status === 'open') join()

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    send(command) {
      if (snapshot.ended) return 0
      if (command.type === 'brake') {
        stopRepeating()
        if (command.command !== 'hold') {
          heldBrake = command
          brakeTimer = scheduler.setInterval(() => {
            if (heldBrake) transmit(heldBrake)
          }, BRAKE_REPEAT_MS)
        }
      }
      return transmit(command)
    },
    stop() {
      if (snapshot.ended || snapshot.link === 'closed') return
      if (heldBrake) transmit({ type: 'brake', command: 'hold' })
      stopRepeating()
      offMessage()
      offStatus()
      link.close()
      update({ link: 'closed', joined: false, state: null })
    },
  }
}
