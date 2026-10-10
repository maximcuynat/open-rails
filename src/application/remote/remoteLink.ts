import type { RemoteMessage } from './protocol'

/**
 * `connecting` covers the first attempt and every wait before a retry; `closed` is final
 * (someone called `close()`).
 */
export type LinkStatus = 'connecting' | 'open' | 'closed'

/**
 * Transport between a host or a desk and the relay. It carries messages that already went through
 * `decodeMessage`; heartbeats stay inside the transport and are never delivered.
 *
 * A link reconnects by itself, and the relay forgets a connection that dropped: whoever uses a
 * link sends its room request again on every change to `open`.
 */
export interface RemoteLink {
  readonly status: LinkStatus
  /** False when the link is not open: the message is dropped, never queued */
  send(message: RemoteMessage): boolean
  /** Returns the function that unsubscribes */
  onMessage(listener: (message: RemoteMessage) => void): () => void
  onStatus(listener: (status: LinkStatus) => void): () => void
  close(): void
}

/** Timers and clock, injectable so the tests own time */
export interface Scheduler {
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  setInterval(callback: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

/** Reads the globals at call time, so fake timers installed later are honoured */
export const systemScheduler: Scheduler = {
  // A monotonic clock: the wall clock may jump (a laptop waking, a virtual machine), and a jump
  // must not read as fifteen seconds of silence
  now: () => performance.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
}
