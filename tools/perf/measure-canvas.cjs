#!/usr/bin/env node
/**
 * What one redraw of the canvas costs in a real browser, on the Marseille Saint-Charles example.
 *
 *   npm run dev                                     # in another terminal
 *   node tools/perf/measure-canvas.cjs [url] [out-dir]
 *
 * Needs Playwright with its Chromium; it is not a dependency of the project. Point PLAYWRIGHT at an
 * install when `require('playwright')` does not find one:
 *   PLAYWRIGHT=~/.claude/skills/gstack/node_modules/playwright node tools/perf/measure-canvas.cjs
 *
 * For each view (whole station, then zoomed in twice) it prints the canvas calls of one frame, by
 * kind, and the time between two animation frames around it. Then a CPU profile of 60 redraws of
 * the whole station: the functions that cost the most per redraw, canvas or not. Screenshots of
 * the three views are written to `out-dir` when given.
 *
 * Headless Chromium rasterises in software: the frame times are worse than on a real machine, the
 * call counts and the CPU profile are the same.
 */
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT ? path.resolve(process.env.PLAYWRIGHT.replace(/^~/, process.env.HOME)) : 'playwright')

const url = process.argv[2] ?? 'http://localhost:8900/'
const outDir = process.argv[3]
const COUNTED = ['stroke', 'fill', 'fillText', 'measureText', 'beginPath', 'save', 'restore', 'setLineDash', 'arc', 'lineTo', 'moveTo', 'quadraticCurveTo', 'fillRect', 'drawImage', 'roundRect']

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await page.goto(url)
  await page.click('.menu-trigger:has-text("Fichier")')
  await page.hover('.menu-item:has-text("Exemples")')
  await page.click('.menu-item:has-text("Marseille")')
  await page.waitForFunction(() => document.querySelector('.tb-name')?.textContent.includes('Marseille'))
  await page.waitForTimeout(800)

  await page.evaluate((counted) => {
    const proto = CanvasRenderingContext2D.prototype
    window.__calls = {}
    for (const name of counted) {
      const original = proto[name]
      proto[name] = function (...args) {
        // The main canvas only: the minimap is a small one
        if (this.canvas.width > 600) window.__calls[name] = (window.__calls[name] ?? 0) + 1
        return original.apply(this, args)
      }
    }
    const canvas = () => document.querySelector('.canvas-wrap canvas')
    const wheel = (deltaY) => canvas().dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 800, clientY: 590, deltaY, ctrlKey: true }))
    let direction = 1
    /** One redraw: a zoom of a hair in, then out the next time, so the view does not drift */
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
    console.log(`\n== ${label}`)
    console.log(`   frame: median ${times[times.length >> 1].toFixed(1)} ms (min ${times[0].toFixed(1)}, max ${times[times.length - 1].toFixed(1)})`)
    console.log(`   canvas calls: ${last.total}  ` + Object.entries(last.calls).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '))
    if (outDir) await page.screenshot({ path: path.join(outDir, `${label.replace(/\W+/g, '-')}.png`) })
  }

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('rail:fit-view')))
  await page.waitForTimeout(500)
  await measure('whole station')

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
  await cdp.send('Profiler.start')
  const redraws = 60
  for (let i = 0; i < redraws; i++) await page.evaluate(() => window.__frame())
  const { profile } = await cdp.send('Profiler.stop')
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const self = new Map()
  profile.samples.forEach((id, i) => {
    const frame = nodes.get(id).callFrame
    if (['(idle)', '(program)'].includes(frame.functionName)) return
    const key = `${frame.functionName || '(anonymous)'}  ${frame.url.split('/').pop().split('?')[0]}:${frame.lineNumber + 1}`
    self.set(key, (self.get(key) ?? 0) + profile.timeDeltas[i] / 1000)
  })
  const total = [...self.values()].reduce((a, b) => a + b, 0)
  console.log(`\n== CPU per redraw of the whole station: ${(total / redraws).toFixed(1)} ms of script, top functions (self time)`)
  for (const [key, ms] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`${(ms / redraws).toFixed(2).padStart(8)} ms  ${key}`)
  }

  await page.evaluate(() => window.__zoomIn(3))
  await measure('zoomed in 3 steps')
  await page.evaluate(() => window.__zoomIn(4))
  await measure('zoomed in 7 steps')
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
