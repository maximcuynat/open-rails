import { RoomRelay, type RelayConnection } from '../../../tools/remote-relay/rooms'
import { decodeMessage, encodeMessage, type RemoteMessage } from './protocol'
import { systemScheduler, type LinkStatus, type RemoteLink, type Scheduler } from './remoteLink'

/**
 * A room on the real relay with a bad network in front of it, for tests: every frame takes
 * `latencyMs` to reach the relay and as long to leave it, and the frames that carry the drive
 * (`state`, `fleet`, `command`) are lost `loss` of the time. What sets the room up is never lost:
 * the test is about driving through a poor link, not about getting in. The losses are drawn from
 * `seed`: the same every run.
 */
export function createLossyRoom(options: { latencyMs: number; loss: number; seed?: number; scheduler?: Scheduler }) {
  const scheduler = options.scheduler ?? systemScheduler
  const relay = new RoomRelay({ now: () => scheduler.now() })
  let state = (options.seed ?? 1) >>> 0
  // Mulberry32: small, and good enough to decide which frame is lost
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const counts = { sent: 0, lost: 0 }
  const lossy = (message: RemoteMessage): boolean => message.t === 'state' || message.t === 'fleet' || message.t === 'command'
  const carried = (message: RemoteMessage, deliver: () => void): void => {
    counts.sent++
    if (lossy(message) && random() < options.loss) {
      counts.lost++
      return
    }
    scheduler.setTimeout(deliver, options.latencyMs)
  }

  const link = (): RemoteLink => {
    const messageListeners = new Set<(message: RemoteMessage) => void>()
    const statusListeners = new Set<(status: LinkStatus) => void>()
    let status: LinkStatus = 'open'
    const conn: RelayConnection = {
      send(data) {
        const decoded = decodeMessage(data)
        if (!decoded.ok) return
        carried(decoded.message, () => {
          for (const listener of [...messageListeners]) listener(decoded.message)
        })
      },
      close() {
        if (status === 'closed') return
        status = 'closed'
        for (const listener of [...statusListeners]) listener(status)
      },
    }
    relay.connect(conn)
    return {
      get status() {
        return status
      },
      send(message) {
        if (status !== 'open') return false
        carried(message, () => relay.receive(conn, encodeMessage(message)))
        return true
      },
      onMessage(listener) {
        messageListeners.add(listener)
        return () => messageListeners.delete(listener)
      },
      onStatus(listener) {
        statusListeners.add(listener)
        return () => statusListeners.delete(listener)
      },
      close() {
        if (status === 'closed') return
        relay.disconnect(conn)
        conn.close()
      },
    }
  }
  return { relay, link, counts }
}
