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
 * The PC side of the phone desks. It knows nothing of the store: it is handed a link, two readers
 * and the one function that applies a command, and it
 * - opens a room on the relay (again after every reconnection),
 * - sends the fleet when a desk arrives and whenever it changes,
 * - sends each desk the console state of its train ten times a second and right after each command,
 * - applies the commands of each desk, dropping stale ones,
 * - puts the brake handle of a desk back to `hold` when a held brake command stops being repeated.
 *
 * Each desk is known by the number the relay gave it; what it holds — its sequence, its brake —
 * is kept per desk, so that one desk falling silent stops its own train and no other.
 */

export interface RemoteHostDeps {
  link: RemoteLink
  /** State of the train a desk holds, null while it holds none */
  getState: (desk: number) => ConsoleState | null
  getFleet: () => FleetEntry[]
  apply: (desk: number, command: ConsoleCommand) => void
  /** A desk sat down, under the name its driver gave */
  seat?: (desk: number, name: string | undefined, back: boolean) => void
  /** A desk left: what it held is to be let go */
  unseat?: (desk: number) => void
  scheduler?: Scheduler
  /** Room code to open (default: a fresh random one) */
  room?: string
  /** Draws another code when the relay says ours is taken (default: `generateRoomCode`) */
  generateRoom?: () => string
  /** Token that lets this host take its room back after a reconnection (default: random) */
  clientId?: string
}

/** A desk seated in the room */
export interface HostDesk {
  desk: number
  /** The name its driver gave; absent when none */
  name?: string
}

export interface RemoteHostSnapshot {
  link: LinkStatus
  /** Code of the room, to show and to put in the pairing address */
  room: string
  /** The relay confirmed the room: a phone can join */
  ready: boolean
  /** At least one desk is seated */
  deskConnected: boolean
  /** The desks seated, by number */
  desks: HostDesk[]
  /** LAN addresses of the relay, for a pairing address a phone can reach */
  hosts: string[]
  /** Set when the relay refused us for good (`version`); the link is then closed */
  error: RoomErrorCode | null
}

export interface RemoteHost {
  /** Same object until something changes: fit for `useSyncExternalStore` */
  getSnapshot(): RemoteHostSnapshot
  subscribe(listener: () => void): () => void
  /** Cuts the link on purpose: tells the desks, closes the room and the link */
  stop(): void
}

/** How many state ticks between two fleet refreshes that only carry new speeds */
const FLEET_SPEED_TICKS = 10

const HOLD: ConsoleCommand = { type: 'brake', command: 'hold' }

/** What the host keeps of one desk */
interface DeskSeat {
  name: string | undefined
  /** Sequence of the last command received from it */
  lastSeq: number
  brakeHeld: boolean
  brakeTimer: unknown
}

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
    desks: [],
    hosts: [],
    error: null,
  }
  const listeners = new Set<() => void>()
  let stopped = false
  const seats = new Map<number, DeskSeat>()
  let ticker: unknown = null
  let ticks = 0
  let sentFleet = ''
  let sentFleetShape = ''

  const update = (patch: Partial<RemoteHostSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of [...listeners]) listener()
  }

  const publishDesks = () => {
    const desks = [...seats.entries()].sort(([a], [b]) => a - b).map(([desk, seat]) => (seat.name === undefined ? { desk } : { desk, name: seat.name }))
    update({ desks, deskConnected: desks.length > 0 })
  }

  const safely = (run: () => void) => {
    try {
      run()
    } catch (error) {
      console.error('[remote-host]', error)
    }
  }

  /** Safety: a held brake command a desk no longer confirms goes back to `hold` */
  const releaseHeldBrake = (desk: number, seat: DeskSeat) => {
    if (seat.brakeTimer !== null) scheduler.clearTimeout(seat.brakeTimer)
    seat.brakeTimer = null
    if (!seat.brakeHeld) return
    seat.brakeHeld = false
    safely(() => apply(desk, HOLD))
  }

  const sendState = (desk: number, seat: DeskSeat) => {
    link.send({ t: 'state', state: getState(desk), ack: seat.lastSeq, to: desk })
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
    for (const [desk, seat] of seats) sendState(desk, seat)
  }

  const deskGone = (desk: number) => {
    const seat = seats.get(desk)
    if (!seat) return
    releaseHeldBrake(desk, seat)
    seats.delete(desk)
    safely(() => deps.unseat?.(desk))
    if (seats.size === 0 && ticker !== null) {
      scheduler.clearInterval(ticker)
      ticker = null
    }
    publishDesks()
  }

  const everyDeskGone = () => {
    for (const desk of [...seats.keys()]) deskGone(desk)
  }

  const deskArrived = (desk: number, name: string | undefined, back: boolean) => {
    // A desk that comes back is a new desk: its sequence and its picture start afresh
    deskGone(desk)
    const seat: DeskSeat = { name, lastSeq: 0, brakeHeld: false, brakeTimer: null }
    seats.set(desk, seat)
    safely(() => deps.seat?.(desk, name, back))
    publishDesks()
    // The newcomer has no fleet yet: everyone is sent it again
    sentFleet = sentFleetShape = ''
    sendFleet(true)
    sendState(desk, seat)
    if (ticker === null) {
      ticks = 0
      ticker = scheduler.setInterval(tick, STATE_PERIOD_MS)
    }
  }

  const onCommand = (message: Extract<RemoteMessage, { t: 'command' }>) => {
    const desk = message.from
    const seat = desk === undefined ? undefined : seats.get(desk)
    if (desk === undefined || !seat) return
    // Stale or replayed: only ever move forward
    if (message.seq <= seat.lastSeq) return
    seat.lastSeq = message.seq
    const command = message.command
    const state = getState(desk)
    // A command aimed at a train the desk no longer holds is dropped; the state that follows
    // tells it where things stand. Choosing a train is the one command that needs none.
    if (command.type !== 'selectTrain' && command.type !== 'selectTrainByOffset' && (state === null || state.trainId !== message.trainId)) {
      sendState(desk, seat)
      return
    }
    if (command.type === 'brake') {
      if (seat.brakeTimer !== null) scheduler.clearTimeout(seat.brakeTimer)
      seat.brakeTimer = null
      seat.brakeHeld = command.command !== 'hold'
      if (seat.brakeHeld) seat.brakeTimer = scheduler.setTimeout(() => releaseHeldBrake(desk, seat), BRAKE_HOLD_TIMEOUT_MS)
    } else if (
      command.type === 'selectTrain' ||
      command.type === 'selectTrainByOffset' ||
      command.type === 'releaseControls'
    ) {
      // Leaving a train: its brake handle must not stay held behind us
      releaseHeldBrake(desk, seat)
    }
    safely(() => apply(desk, command))
    sendState(desk, seat)
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
        deskArrived(message.desk, message.name, message.back === true)
        return
      case 'peer-left':
        if (message.desk !== undefined) deskGone(message.desk)
        return
      case 'command':
        onCommand(message)
        return
      case 'error':
        if (message.code === 'room-taken') {
          // The relay closes this connection; the next one opens under a new code
          update({ room: generateRoom(), ready: false })
        } else if (message.code === 'version') {
          everyDeskGone()
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
      // The relay closed the room with the connection: the desks are gone too
      everyDeskGone()
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
      if (seats.size > 0) link.send({ t: 'bye' })
      everyDeskGone()
      stopped = true
      offMessage()
      offStatus()
      link.close()
      update({ link: 'closed', ready: false })
    },
  }
}
