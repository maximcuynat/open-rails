import { createServer, type IncomingMessage, type Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  HEARTBEAT_TIMEOUT_MS,
  MAX_ADVERTISED_HOSTS,
  MAX_MESSAGE_BYTES,
  REMOTE_RELAY_PATH,
} from '../../src/application/remote/protocol'
import { RoomRelay, type RelayConnection } from './rooms'

/**
 * The thin `ws` layer over `RoomRelay`: it only answers WebSocket upgrades on its own path and
 * leaves every other upgrade (Vite's HMR socket, for one) untouched. It depends on Node and `ws`
 * only, so the same code runs inside Vite or on its own (`startRelayServer`).
 */

export interface AttachRelayOptions {
  /** Absolute path of the endpoint, e.g. `/open-rails/__remote` */
  path: string
  /** Silence after which a connection is closed (default: the protocol's heartbeat timeout) */
  timeoutMs?: number
  /** Period of the sweep that closes mute connections (default: a third of `timeoutMs`) */
  sweepMs?: number
  /** Addresses told to hosts (default: the IPv4 addresses of this machine on its networks) */
  hosts?: () => string[]
}

export interface AttachedRelay {
  relay: RoomRelay
  /** Detaches from the HTTP server and closes every connection. The HTTP server keeps running. */
  close(): void
}

/** IPv4 addresses of this machine that another device could reach */
export function lanAddresses(): string[] {
  const addresses: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) addresses.push(info.address)
    }
  }
  return addresses.slice(0, MAX_ADVERTISED_HOSTS)
}

export function attachRelay(httpServer: Server, options: AttachRelayOptions): AttachedRelay {
  const timeoutMs = options.timeoutMs ?? HEARTBEAT_TIMEOUT_MS
  const relay = new RoomRelay({ timeoutMs, hosts: options.hosts ?? lanAddresses })
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })
  const sockets = new Set<WebSocket>()

  const accept = (ws: WebSocket) => {
    const conn: RelayConnection = {
      send: (data) => {
        if (ws.readyState === ws.OPEN) ws.send(data)
      },
      // Let the last frame (an error, a `peer-left`) leave before the closing handshake
      close: () => ws.close(1000),
    }
    sockets.add(ws)
    relay.connect(conn)
    ws.on('message', (data, isBinary) => {
      try {
        relay.receive(conn, isBinary ? null : data.toString())
      } catch (error) {
        console.error('[remote-relay]', error)
        ws.terminate()
      }
    })
    ws.on('close', () => {
      sockets.delete(ws)
      relay.disconnect(conn)
    })
    // An oversized frame or a broken socket ends here; `close` follows and cleans up
    ws.on('error', () => ws.terminate())
  }

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname: string
    try {
      pathname = new URL(request.url ?? '', 'http://relay').pathname
    } catch {
      return
    }
    // Not ours: some other listener owns this upgrade
    if (pathname !== options.path) return
    try {
      wss.handleUpgrade(request, socket, head, accept)
    } catch (error) {
      console.error('[remote-relay]', error)
      socket.destroy()
    }
  }

  const sweeper = setInterval(() => relay.sweep(), options.sweepMs ?? Math.ceil(timeoutMs / 3))
  sweeper.unref()

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    clearInterval(sweeper)
    httpServer.off('upgrade', onUpgrade)
    httpServer.off('close', close)
    relay.closeAll()
    for (const ws of sockets) ws.terminate()
    sockets.clear()
    wss.close()
  }

  httpServer.on('upgrade', onUpgrade)
  httpServer.on('close', close)
  return { relay, close }
}

export interface StartRelayOptions {
  /** 0 picks a free port */
  port?: number
  /** Interface to listen on (default: all) */
  host?: string
  path?: string
  timeoutMs?: number
  sweepMs?: number
  hosts?: () => string[]
}

export interface RunningRelay {
  relay: RoomRelay
  port: number
  path: string
  close(): Promise<void>
}

/** The relay on an HTTP server of its own: what the tests use, and what a hosted relay will run */
export function startRelayServer(options: StartRelayOptions = {}): Promise<RunningRelay> {
  const path = options.path ?? `/${REMOTE_RELAY_PATH}`
  const httpServer = createServer((_request, response) => {
    response.writeHead(426, { 'Content-Type': 'text/plain' })
    response.end('WebSocket relay\n')
  })
  // An upgrade on any other path would otherwise hang: nobody else listens on this server
  httpServer.on('upgrade', (request, socket) => {
    let pathname = ''
    try {
      pathname = new URL(request.url ?? '', 'http://relay').pathname
    } catch {
      // Unreadable address: not ours either
    }
    if (pathname !== path) socket.destroy()
  })
  const attached = attachRelay(httpServer, { ...options, path })
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(options.port ?? 0, options.host, () => {
      const address = httpServer.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        relay: attached.relay,
        port,
        path,
        close: () =>
          new Promise<void>((done) => {
            attached.close()
            httpServer.close(() => done())
          }),
      })
    })
  })
}
