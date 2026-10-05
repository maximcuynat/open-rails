import type { RemoteMessage } from './protocol'
import type { LinkStatus, RemoteLink } from './remoteLink'

/**
 * A `RemoteLink` with no network, for tests (and for trying a console without a relay): what is
 * sent piles up in `sent`, and the test plays the other side with `receive` and `setStatus`.
 */
export class FakeLink implements RemoteLink {
  status: LinkStatus
  sent: RemoteMessage[] = []
  private readonly messageListeners = new Set<(message: RemoteMessage) => void>()
  private readonly statusListeners = new Set<(status: LinkStatus) => void>()

  constructor(status: LinkStatus = 'open') {
    this.status = status
  }

  send(message: RemoteMessage): boolean {
    if (this.status !== 'open') return false
    this.sent.push(message)
    return true
  }

  onMessage(listener: (message: RemoteMessage) => void): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onStatus(listener: (status: LinkStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  close(): void {
    this.setStatus('closed')
  }

  /** A message arrives from the other side */
  receive(message: RemoteMessage): void {
    for (const listener of [...this.messageListeners]) listener(message)
  }

  setStatus(status: LinkStatus): void {
    if (status === this.status) return
    this.status = status
    for (const listener of [...this.statusListeners]) listener(status)
  }

  /** Messages sent since the last call */
  take(): RemoteMessage[] {
    const out = this.sent
    this.sent = []
    return out
  }
}
