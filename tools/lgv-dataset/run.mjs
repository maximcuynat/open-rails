#!/usr/bin/env node
/**
 * Builds the « LGV France » dataset under `public/data/lgv/` (the pipeline is `build.ts`; this file
 * is named differently so that `import './build'` never resolves to it).
 *
 *   node tools/lgv-dataset/run.mjs [--offline] [--only <lineId>] [--round]
 *
 * The pipeline is the TypeScript of the application (domain import, persistence): it runs here
 * through Vite's module runner, which resolves the `@domain/*` aliases of `vite.config.ts` and
 * strips the types. Nothing to install beyond the project's own dependencies.
 */
import { createServer, createServerModuleRunner } from 'vite'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({
  root,
  configFile: new URL('../../vite.config.ts', import.meta.url).pathname,
  server: { middlewareMode: true, watch: null, hmr: false },
  appType: 'custom',
  logLevel: 'warn',
})
try {
  const runner = createServerModuleRunner(server.environments.ssr, { hmr: false })
  const { main } = await runner.import('/tools/lgv-dataset/build.ts')
  const code = await main(process.argv.slice(2))
  process.exitCode = code ?? 0
} finally {
  await server.close()
}
