import type { ConsoleCommand, ConsoleState, FleetEntry } from '../console/consoleContract'
import {
  BRAKE_HOLD_TIMEOUT_MS,
  MAX_FLEET_ENTRIES,
  PROTOCOL_VERSION,
  STATE_PERIOD_MS,
  generateClientId,
  generateRoomCode,
  type RemoteMessage,
  type RoomErrorCode,
} from './protocol'
import { systemScheduler, type LinkStatus, type RemoteLink, type Scheduler } from './remoteLink'

/**
 * The PC side of the phone desk. It knows nothing of the store: it is handed a link, two readers
 * and the one function that applies a command, and it
 * - opens a room on the relay (again after every reconnection),
 * - sends the fleet when the desk arrives and whenever it changes,
 * - sends the console state ten times a second and right after each command,
 * - applies the commands of the desk, dropping stale ones,
 * - puts the brake handle back to `hold` when a held brake command stops being repeated.
 */

export interface RemoteHostDeps {
  link: RemoteLink
  /** State of the train driven on the PC, null when the PC drives nothing */
  getState: () => ConsoleState | null
  getFleet: () => FleetEntry[]
  apply: (command: ConsoleCommand) => void
  scheduler?: Scheduler
  /** Room code to open (default: a fresh random one) */
  room?: string
  /** Draws another code when the relay says ours is taken (default: `generateRoomCode`) */
  generateRoom?: () => string
  /** Token that lets this host take its room back after a reconnection (default: random) */
  clientId?: string
}

export interface RemoteHostSnapshot {
  link: LinkStatus
  /** Code of the room, to show and to put in the pairing address */
  room: string
  /** The relay confirmed the room: a phone can join */
  ready: boolean
  deskConnected: boolean
  /** LAN addresses of the relay, for a pairing address a phone can reach */
  hosts: string[]
  /** Set when the relay refused us for good (`version`); the link is then closed */
  error: RoomErrorCode | null
}

export interface RemoteHost {
  /** Same object until something changes: fit for `useSyncExternalStore` */
  getSnapshot(): RemoteHostSnapshot
  subscribe(listener: () => void): () => void
  /** Cuts the link on purpose: tells the desk, closes the room and the link */
  stop(): void
}

/** How many state ticks between two fleet refreshes that only carry new speeds */
const FLEET_SPEED_TICKS = 10

const HOLD: ConsoleCommand = { type: 'brake', command: 'hold' }

export function createRemoteHost(deps: RemoteHostDeps): RemoteHost {
  const { link, getState, getFleet, apply } = deps
  const scheduler = deps.scheduler ?? systemScheduler
  const generateRoom = deps.generateRoom ?? generateRoomCode
  const clientId = deps.clientId ?? generateClientId()

  let snapshot: RemoteHostSnapshot = {
    link: link.status,
    room: deps.room ?? generateRoom(),
    ready: false,
    deskConnected: false,
    hosts: [],
    error: null,
  }
  const listeners = new Set<() => void>()
  let stopped = false
  /** Sequence of the last command received from the current desk */
  let lastSeq = 0
  let brakeHeld = false
  let brakeTimer: unknown = null
  let ticker: unknown = null
  let ticks = 0
  let sentFleet = ''
  let sentFleetShape = ''

  const update = (patch: Partial<RemoteHostSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of [...listeners]) listener()
  }

  const applySafely = (command: ConsoleCommand) => {
    try {
      apply(command)
    } catch (error) {
      console.error('[remote-host]', error)
    }
  }

  /** Safety: a held brake command nobody confirms any more goes back to `hold` */
  const releaseHeldBrake = () => {
    if (brakeTimer !== null) scheduler.clearTimeout(brakeTimer)
    brakeTimer = null
    if (!brakeHeld) return
    brakeHeld = false
    applySafely(HOLD)
  }

  const sendState = () => {
    link.send({ t: 'state', state: getState(), ack: lastSeq })
  }

  /** `force`: send whatever changed; otherwise only a change of anything but the speeds */
  const sendFleet = (force: boolean) => {
    const fleet = getFleet().slice(0, MAX_FLEET_ENTRIES)
    const shape = JSON.stringify(fleet.map((entry) => ({ ...entry, speed: 0 })))
    const full = JSON.stringify(fleet)
    if (shape === sentFleetShape && (!force || full === sentFleet)) return
    if (!link.send({ t: 'fleet', fleet })) return
    sentFleet = full
    sentFleetShape = shape
  }

  const tick = () => {
    ticks++
    sendFleet(ticks % FLEET_SPEED_TICKS === 0)
    sendState()
  }

  const deskArrived = () => {
    lastSeq = 0
    ticks = 0
    sentFleet = sentFleetShape = ''
    update({ deskConnected: true })
    sendFleet(true)
    sendState()
    if (ticker === null) ticker = scheduler.setInterval(tick, STATE_PERIOD_MS)
  }

  const deskGone = () => {
    if (ticker !== null) scheduler.clearInterval(ticker)
    ticker = null
    releaseHeldBrake()
    if (snapshot.deskConnected) update({ deskConnected: false })
  }

  const onCommand = (message: Extract<RemoteMessage, { t: 'command' }>) => {
    if (!snapshot.deskConnected) return
    // Stale or replayed: only ever move forward
    if (message.seq <= lastSeq) return
    lastSeq = message.seq
    const command = message.command
    const state = getState()
    // A command aimed at a train the PC no longer drives is dropped; the state that follows
    // tells the desk where things stand. Choosing a train is the one command that needs none.
    if (command.type !== 'selectTrain' && (state === null || state.trainId !== message.trainId)) {
      sendState()
      return
    }
    if (command.type === 'brake') {
      if (brakeTimer !== null) scheduler.clearTimeout(brakeTimer)
      brakeTimer = null
      brakeHeld = command.command !== 'hold'
      if (brakeHeld) brakeTimer = scheduler.setTimeout(releaseHeldBrake, BRAKE_HOLD_TIMEOUT_MS)
    } else if (
      command.type === 'selectTrain' ||
      command.type === 'selectTrainByOffset' ||
      command.type === 'releaseControls'
    ) {
      // Leaving a train: its brake handle must not stay held behind us
      releaseHeldBrake()
    }
    applySafely(command)
    sendState()
  }

  const openRoom = () => {
    link.send({ t: 'host', v: PROTOCOL_VERSION, room: snapshot.room, client: clientId })
  }

  const offMessage = link.onMessage((message) => {
    if (stopped) return
    switch (message.t) {
      case 'opened':
        update({ ready: true, room: message.room, hosts: message.hosts })
        return
      case 'peer-joined':
        // A desk that comes back is a new desk: start its sequence and its picture afresh
        deskGone()
        deskArrived()
        return
      case 'peer-left':
        deskGone()
        return
      case 'command':
        onCommand(message)
        return
      case 'error':
        if (message.code === 'room-taken') {
          // The relay closes this connection; the next one opens under a new code
          update({ room: generateRoom(), ready: false })
        } else if (message.code === 'version') {
          deskGone()
          update({ error: 'version', ready: false })
          link.close()
        }
        return
      default:
        return
    }
  })

  const offStatus = link.onStatus((status) => {
    if (stopped) return
    if (status === 'open') {
      update({ link: status })
      openRoom()
    } else {
      // The relay closed the room with the connection: the desk is gone too
      deskGone()
      update({ link: status, ready: false })
    }
  })

  if (link.status === 'open') openRoom()

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    stop() {
      if (stopped) return
      if (snapshot.deskConnected) link.send({ t: 'bye' })
      deskGone()
      stopped = true
      offMessage()
      offStatus()
      link.close()
      update({ link: 'closed', ready: false })
    },
  }
}
