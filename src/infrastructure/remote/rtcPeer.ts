// The parts of the browser's WebRTC the links use, so that a test can hand them a pair of fakes
// (there is no WebRTC under Node), and the one place where a real connection is made.

/** A session description or an ICE candidate, as plain data fit for the broker */
export type RtcPlain = Record<string, unknown>

export interface RtcChannelLike {
  readonly readyState: string
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
}

export interface RtcPeerLike {
  readonly connectionState: string
  createDataChannel(label: string): RtcChannelLike
  createOffer(): Promise<RtcPlain>
  createAnswer(): Promise<RtcPlain>
  setLocalDescription(description: RtcPlain): Promise<void>
  setRemoteDescription(description: RtcPlain): Promise<void>
  addIceCandidate(candidate: RtcPlain): Promise<void>
  close(): void
  onicecandidate: ((event: { candidate: unknown }) => void) | null
  ondatachannel: ((event: { channel: RtcChannelLike }) => void) | null
  onconnectionstatechange: (() => void) | null
}

export type RtcPeerFactory = () => RtcPeerLike

/**
 * Public STUN servers: they only tell each browser the address the Internet sees it under. There
 * is no TURN relay: two networks that both hide their ports (a phone on 4G behind its operator's
 * NAT, some company Wi-Fi) will not reach each other.
 */
export const STUN_SERVERS = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']

/** A real peer connection of the browser */
export const createBrowserPeer: RtcPeerFactory = () =>
  new RTCPeerConnection({ iceServers: [{ urls: STUN_SERVERS }] }) as unknown as RtcPeerLike

/** A description or a candidate as plain data: what `toJSON` gives when there is one */
export function plain(value: unknown): RtcPlain {
  const json = (value as { toJSON?: () => unknown } | null)?.toJSON?.()
  return (json ?? value ?? {}) as RtcPlain
}

/** The id of the PC of a room on the broker, and of a desk of that room */
export const hostPeerId = (room: string): string => `openrails-${room}`
export const deskPeerId = (room: string, client: string): string => `openrails-${room}-${client}`
