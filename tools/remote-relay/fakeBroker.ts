import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { BrokerHub, type BrokerConnection } from './brokerHub'

/**
 * A broker that speaks like the public PeerJS one, served by the dev server itself: WebRTC can be
 * tried on one machine, or on a local network, with no Internet (`?liaison=webrtc&courtier=local`).
 * It answers WebSocket upgrades on `path` and nothing else.
 */
export function attachBroker(httpServer: Server, path: string): { hub: BrokerHub; close(): void } {
  const hub = new BrokerHub()
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
  const sockets = new Set<WebSocket>()
  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname: string
    try {
      pathname = new URL(request.url ?? '', 'http://broker').pathname
    } catch {
      return
    }
    // Not ours: some other listener owns this upgrade
    if (pathname !== path) return
    wss.handleUpgrade(request, socket, head, (ws) => {
      const conn: BrokerConnection = {
        send: (data) => {
          if (ws.readyState === ws.OPEN) ws.send(data)
        },
        close: () => ws.close(1000),
      }
      sockets.add(ws)
      hub.connect(conn, request.url ?? '')
      ws.on('message', (data, isBinary) => {
        if (!isBinary) hub.receive(conn, data.toString())
      })
      ws.on('close', () => {
        sockets.delete(ws)
        hub.disconnect(conn)
      })
      ws.on('error', () => ws.terminate())
    })
  }
  httpServer.on('upgrade', onUpgrade)
  return {
    hub,
    close() {
      httpServer.off('upgrade', onUpgrade)
      for (const ws of sockets) ws.terminate()
      wss.close()
    },
  }
}
