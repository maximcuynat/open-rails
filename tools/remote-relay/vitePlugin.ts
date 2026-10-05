import type { Server } from 'node:http'
import type { Plugin } from 'vite'
import { REMOTE_RELAY_PATH } from '../../src/application/remote/protocol'
import { attachRelay, type AttachedRelay } from './server'

/** Marks the HTTP server we are attached to, so a restart that reuses it never attaches twice */
const ATTACHED = Symbol.for('open-rails.remote-relay')

type Marked = Server & { [ATTACHED]?: AttachedRelay }

/**
 * Serves the phone-desk relay from Vite's own HTTP server (`npm run dev` and `npm run preview`),
 * at `<base>__remote`. It only listens for WebSocket upgrades on that path, so Vite's HMR socket
 * is untouched, and a failure here is logged and never takes the server down.
 */
export function remoteRelayPlugin(): Plugin {
  const attach = (httpServer: unknown, base: string, warn: (message: string) => void) => {
    // No HTTP server in middleware mode (which is how Vitest runs Vite)
    if (!httpServer) return
    try {
      const server = httpServer as Marked
      server[ATTACHED]?.close()
      const root = base.startsWith('/') ? base : '/'
      server[ATTACHED] = attachRelay(server, {
        path: root.replace(/\/?$/, '/') + REMOTE_RELAY_PATH,
      })
    } catch (error) {
      warn(`[remote-relay] relais du pupitre indisponible : ${String(error)}`)
    }
  }
  return {
    name: 'open-rails:remote-relay',
    configureServer(server) {
      attach(server.httpServer, server.config.base, (m) => server.config.logger.warn(m))
    },
    configurePreviewServer(server) {
      attach(server.httpServer, server.config.base, (m) => server.config.logger.warn(m))
    },
  }
}
