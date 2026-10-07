/**
 * What a project file costs in a real browser: time to import it through « Fichier ▸ Importer
 * JSON… », whether the autosave fits in localStorage, and the frame time at several zooms, from
 * the whole network inwards, with the canvas calls of one frame and the functions that cost the
 * most at the last zoom.
 *
 *   npm run dev                                     # in another terminal
 *   node tools/perf/measure-project.cjs <project.json> [url]
 *
 * Needs Playwright with its Chromium, like measure-canvas.cjs: point PLAYWRIGHT at an install when
 * `require('playwright')` does not find one. Headless Chromium rasterises in software: the frame
 * times are worse than on a real machine (about 15 ms even for an empty view), the call counts
 * and the CPU profile are the same.
 */

const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT ? path.resolve(process.env.PLAYWRIGHT.replace(/^~/, process.env.HOME)) : 'playwright')
const file = process.argv[2]
if (!file) { console.error('usage: node tools/perf/measure-project.cjs <project.json> [url]'); process.exit(1) }
const url = process.argv[3] ?? 'http://localhost:8900/open-rails/'
const COUNTED = ['stroke', 'fill', 'fillText', 'beginPath', 'lineTo', 'moveTo', 'quadraticCurveTo', 'arc', 'fillRect']

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on('pageerror', (e) => console.log('page error:', e.message))
  await page.goto(url)
  await page.waitForSelector('.menu-trigger')
  await page.waitForTimeout(500)
  await page.evaluate(() => { try { localStorage.clear() } catch {} })

  // Import the file through the menu, as the user does
  await page.click('.menu-trigger:has-text("Fichier")')
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.menu-item:has-text("Importer JSON")')])
  const t0 = Date.now()
  await chooser.setFiles(file)
  await page.waitForSelector('text=Réseau importé', { timeout: 120000 })
  const imported = Date.now() - t0
  // Autosave is written 400 ms after the load
  await page.waitForTimeout(1500)
  const autosave = await page.evaluate(() => {
    const unsaved = !!document.querySelector('.tb-dirty-unsaved')
    let stored = 0
    try { stored = (localStorage.getItem('open-rail:network') ?? '').length } catch {}
    return { unsaved, storedMiB: (stored / 1048576).toFixed(2) }
  })
  console.log(`\n== ${path.basename(file)}: imported in ${imported} ms (file read + parse + load + first frame); autosave failed: ${autosave.unsaved}; stored ${autosave.storedMiB} MiB`)

  await page.evaluate((counted) => {
    const proto = CanvasRenderingContext2D.prototype
    window.__calls = {}
    for (const name of counted) {
      const original = proto[name]
      proto[name] = function (...args) {
        if (this.canvas.width > 600) window.__calls[name] = (window.__calls[name] ?? 0) + 1
        return original.apply(this, args)
      }
    }
    const canvas = () => document.querySelector('.canvas-wrap canvas')
    const wheel = (deltaY) => canvas().dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 800, clientY: 500, deltaY, ctrlKey: true }))
    let direction = 1
    window.__frame = () => new Promise((resolve) => {
      window.__calls = {}
      direction = -direction
      requestAnimationFrame(() => {
        const before = performance.now()
        requestAnimationFrame(() => {
          const calls = { ...window.__calls }
          resolve({ ms: performance.now() - before, calls, total: Object.values(calls).reduce((a, b) => a + b, 0) })
        })
      })
      wheel(direction)
    })
    window.__zoomIn = (steps) => new Promise((resolve) => {
      let done = 0
      const next = () => {
        if (done++ >= steps) return resolve()
        wheel(-240)
        requestAnimationFrame(() => requestAnimationFrame(next))
      }
      next()
    })
  }, COUNTED)

  const measure = async (label) => {
    const frames = []
    for (let i = 0; i < 8; i++) frames.push(await page.evaluate(() => window.__frame()))
    const last = frames[frames.length - 1]
    const times = frames.map((f) => f.ms).sort((a, b) => a - b)
    console.log(`   ${label}: frame median ${times[times.length >> 1].toFixed(1)} ms (min ${times[0].toFixed(1)}, max ${times[times.length - 1].toFixed(1)}); canvas calls ${last.total} (${Object.entries(last.calls).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ')})`)
  }

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('rail:fit-view')))
  await page.waitForTimeout(500)
  await measure('whole network')
  for (const steps of [3, 3, 3, 3, 3]) {
    await page.evaluate((s) => window.__zoomIn(s), steps)
    await page.waitForTimeout(100)
    await measure(`zoomed in ${steps} more steps`)
  }

  // Where the script time goes at this zoom
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
  await cdp.send('Profiler.start')
  const redraws = 40
  for (let i = 0; i < redraws; i++) await page.evaluate(() => window.__frame())
  const { profile } = await cdp.send('Profiler.stop')
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const self = new Map()
  profile.samples.forEach((id, i) => {
    const frame = nodes.get(id).callFrame
    if (['(idle)', '(program)', '(garbage collector)'].includes(frame.functionName)) return
    const key = `${frame.functionName || '(anonymous)'}  ${frame.url.split('/').pop().split('?')[0]}:${frame.lineNumber + 1}`
    self.set(key, (self.get(key) ?? 0) + profile.timeDeltas[i] / 1000)
  })
  const total = [...self.values()].reduce((a, b) => a + b, 0)
  console.log(`   CPU per redraw at this zoom: ${(total / redraws).toFixed(1)} ms of script; top functions (self time):`)
  for (const [key, ms] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`   ${(ms / redraws).toFixed(2).padStart(7)} ms  ${key}`)
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
