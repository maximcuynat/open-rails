import { remoteRoute } from '@application/remote/protocol'
import type { RemoteLink } from '@application/remote/remoteLink'
import { DEFAULT_BROKER_URL } from './peerBroker'
import { RtcDeskLink } from './rtcDeskLink'
import { RtcHostLink } from './rtcHostLink'
import { createWebSocketLink } from './webSocketLink'

// The link of this page to the other side, by the way the page can use (`remoteRoute`): the relay
// of the server that serves it, or directly (WebRTC) from the published site.

const route = () => remoteRoute(globalThis.location.href, import.meta.env.BASE_URL)

/** The link of the PC: to the relay, or its own rooms with the desks reaching it directly */
export function createHostLink(): RemoteLink {
  const { transport, broker } = route()
  return transport === 'relay' ? createWebSocketLink() : new RtcHostLink({ brokerUrl: broker ?? DEFAULT_BROKER_URL })
}

/** The link of a phone desk to the PC that holds `room` */
export function createDeskLink(room: string): RemoteLink {
  const { transport, broker } = route()
  return transport === 'relay' ? createWebSocketLink() : new RtcDeskLink({ brokerUrl: broker ?? DEFAULT_BROKER_URL, room })
}

/** True when this page reaches the other side directly */
export const isDirectLink = (): boolean => route().transport === 'direct'
