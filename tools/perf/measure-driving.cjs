/**
 * What a journey of the « LGV France » dataset costs in a real browser: the dialog is driven as
 * the user does (Fichier ▸ Ligne entre gares…, two stations, Charger), then a train is placed at
 * a station and driven for a while. Reports the load time, the heap, the frames per second and
 * the longest frame while driving (a line fetched on the way shows there), and the time the
 * recipe takes to come back after a reload.
 *
 *   npx vite --port 8901 --strictPort                 # in another terminal
 *   node tools/perf/measure-driving.cjs [url] [from] [to] [placeAt] [seconds]
 *
 * Defaults: http://localhost:8901/open-rails/, « marseille saint » → « lyon part », the train at
 * « aix-en-provence », 30 s. For a line fetched on the way: « marseille saint » « avignon »
 * « valence » (the train starts 2 km from the junction with the LGV Rhône-Alpes, not loaded). Needs Playwright with its Chromium, like measure-project.cjs
 * (PLAYWRIGHT=~/.claude/skills/gstack/node_modules/playwright). Headless Chromium rasterises in
 * software: the frame times are worse than on a real machine, the counts are the same.
 */

const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT ? path.resolve(process.env.PLAYWRIGHT.replace(/^~/, process.env.HOME)) : 'playwright')
const [url = 'http://localhost:8901/open-rails/', from = 'marseille saint', to = 'lyon part', placeAt = 'aix-en-provence', secondsArg = '30'] = process.argv.slice(2)
const seconds = Number(secondsArg)

const heap = (page) => page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null))
const toasts = (page) => page.$$eval('.toast-item', (els) => els.map((e) => e.textContent))

async function pick(page, query) {
  const input = page.locator('#dataset-station')
  await input.fill(query)
  await page.waitForSelector('.osm-result')
  await page.click('.osm-result >> nth=0')
}

async function main() {
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on('pageerror', (e) => console.log('page error:', e.message))
  await page.goto(url)
  await page.waitForSelector('.menu-trigger')
  await page.evaluate(() => { try { localStorage.clear() } catch {} })
  await page.reload()
  await page.waitForSelector('.menu-trigger')
  await page.waitForTimeout(300)
  const heapEmpty = await heap(page)

  // The journey, as the user asks for it
  await page.click('.menu-trigger:has-text("Fichier")')
  await page.click('.menu-item:has-text("Ligne entre gares")')
  await page.waitForSelector('#dataset-station')
  await page.waitForFunction(() => !document.querySelector('#dataset-station').disabled, null, { timeout: 15000 })
  await pick(page, from)
  await pick(page, to)
  await page.waitForSelector('.osm-figures')
  const name = await page.$eval('.settings-section:nth-child(2) .settings-label', (e) => e.firstChild.textContent)
  const lineNames = (await page.$eval('.settings-section:nth-child(2) .settings-hint', (e) => e.textContent)).split(' › ')
  const figures = await page.$$eval('.osm-figure', (els) => els.map((e) => e.textContent))
  const t0 = Date.now()
  await page.click('.modal-footer .modal-btn-primary, .modal-footer .modal-btn-danger')
  await page.waitForSelector('.toast-item:has-text("chargée")', { timeout: 60000 })
  const loadMs = Date.now() - t0
  await page.waitForTimeout(1200)
  const heapLoaded = await heap(page)
  const stored = await page.evaluate(() => (localStorage.getItem('open-rail:network') ?? '').length)

  // The train: placed at the station (its mark is on the track) through the store the dev build
  // exposes, then the controls taken from the Simulation menu, as the user does
  const index = await page.evaluate(async (base) => (await fetch(`${base}data/lgv/index.json`)).json(), new URL(url).pathname)
  const station = index.stations.find((s) => s.name.toLowerCase().includes(placeAt.toLowerCase()))
  if (!station) throw new Error(`station « ${placeAt} » not in the index`)
  const placed = await page.evaluate(
    ({ x, y }) => {
      const store = window.__openRailsStore
      if (!store) throw new Error('the store is not exposed: run against `npm run dev`')
      store.setTool('locomotive')
      return store.placeTrainItem({ x, y })
    },
    { x: station.x, y: station.y },
  )
  if (!placed) throw new Error(`no train could be placed at « ${station.name} »`)
  await page.click('.menu-trigger:has-text("Simulation")')
  await page.click('.menu-item:has-text("Prendre les commandes")')
  await page.waitForTimeout(400)
  if (!(await page.evaluate(() => window.__openRailsStore.isPlayMode))) throw new Error('not driving after « Prendre les commandes »')
  // Reverser forward, brake released, the handle at full power (what the keys A, Q and W do)
  await page.evaluate(() => {
    const store = window.__openRailsStore
    store.shiftSelectedTrainReverser(1)
    store.setSelectedTrainBrakeCommand('release')
    for (let i = 0; i < 12; i++) store.stepSelectedTrainNotch(1)
  })

  // Frames while driving, and the heap now and then
  const frames = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const gaps = []
        const heaps = []
        let last = performance.now()
        const start = last
        let nextHeap = start + 5000
        const loop = (now) => {
          gaps.push(now - last)
          last = now
          if (now >= nextHeap) {
            heaps.push(performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null)
            nextHeap += 5000
          }
          if (now - start < ms) requestAnimationFrame(loop)
          else resolve({ gaps, heaps })
        }
        requestAnimationFrame(loop)
      }),
    seconds * 1000,
  )
  const sorted = [...frames.gaps].sort((a, b) => a - b)
  const p = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  const fps = frames.gaps.length / seconds
  const addedToasts = (await toasts(page)).filter((t) => t.includes('en route'))
  const after = await page.evaluate(() => { const s = window.__openRailsStore; return { speed: Math.round(s.trains[0]?.currentSpeed * 3.6), rails: s.network.segments.size, lines: s.dataset?.lines ?? [], addMs: Math.round(s.datasetLastAddMs) } })
  const storedDriving = await page.evaluate(() => (localStorage.getItem('open-rail:network') ?? '').length)

  // The recipe comes back
  const t1 = Date.now()
  await page.reload()
  await page.waitForSelector('.menu-trigger')
  await page.waitForSelector('.toast-item:has-text("rechargée")', { timeout: 60000 })
  const reloadMs = Date.now() - t1

  console.log(`\n== ${name} (${lineNames.length} lines: ${lineNames.join(' › ')})`)
  console.log(`   preview: ${figures.join(' · ')}`)
  console.log(`   load (Charger → toast): ${loadMs} ms; recipe in storage: ${stored} chars (${storedDriving} while driving)`)
  console.log(`   heap: empty ${heapEmpty} MiB, loaded ${heapLoaded} MiB, driving ${frames.heaps.join(' / ')} MiB`)
  console.log(`   driving ${seconds} s from « ${station.name} » (${after.speed} km/h at the end): ${fps.toFixed(1)} frames/s, frame median ${p(0.5).toFixed(1)} ms, p95 ${p(0.95).toFixed(1)} ms, longest ${sorted[sorted.length - 1].toFixed(0)} ms`)
  console.log(`   lines on the way: ${after.lines.length > lineNames.length ? `${after.lines.length - lineNames.length} added in ${after.addMs} ms (union loaded in place)` : 'none fetched'}${addedToasts.length ? ` — ${addedToasts.join(' | ')}` : ''}; ${after.lines.length} lines, ${after.rails} rails loaded`)
  console.log(`   recipe reload (navigation → toast): ${reloadMs} ms`)
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
