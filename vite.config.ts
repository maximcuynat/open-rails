/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'
import { remoteRelayPlugin } from './tools/remote-relay/vitePlugin'

import path from 'path'

export default defineConfig({
  base: '/open-rails/',
  // The relay of the phone desk rides on the dev and preview servers (WebSocket at <base>__remote)
  plugins: [react(), remoteRelayPlugin()],
  resolve: {
    alias: {
      '@domain': path.resolve(__dirname, './src/domain'),
      '@application': path.resolve(__dirname, './src/application'),
      '@infrastructure': path.resolve(__dirname, './src/infrastructure'),
      '@presentation': path.resolve(__dirname, './src/presentation'),
    },
  },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: { setupFiles: ['./src/testSetup.ts'] },
  // Listening on every interface lets a phone on the local network reach the desk page and the relay
  server: {
    port: 8900,
    host: true,
  },
  preview: {
    port: 8900,
    host: true,
  },
})
