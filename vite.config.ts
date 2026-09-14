import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

import path from 'path'

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@domain': path.resolve(__dirname, './src/domain'),
      '@application': path.resolve(__dirname, './src/application'),
      '@infrastructure': path.resolve(__dirname, './src/infrastructure'),
      '@presentation': path.resolve(__dirname, './src/presentation'),
    },
  },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    port: 8900,
  },
})
