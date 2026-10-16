#!/usr/bin/env node
/**
 * The frame bench of the renderer (`src/presentation/dev/frameBench.ts`) run by Playwright.
 *
 *   npm run dev                                     # in another terminal
 *   PLAYWRIGHT=~/.claude/skills/gstack/node_modules/playwright node tools/perf/measure-frame.cjs [url] [scenarios]
 *
 * `scenarios` is a comma-separated list among gares-9, gares-81, reseau-reel (all by default).
 * Headless Chromium rasterises in software: the paint times say whether the bench works and how
 * the cost moves between two versions, not what a player's machine does. The figures of the lot
 * W0 come from `await __frameBench()` typed in the console of an ordinary browser window.
 */
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT ? path.resolve(process.env.PLAYWRIGHT.replace(/^~/, process.env.HOME)) : 'playwright')

const url = process.argv[2] ?? 'http://localhost:8900/open-rails/'
const scenarios = process.argv[3]?.split(',')

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await page.goto(url)
  await page.waitForFunction(() => typeof window.__frameBench === 'function')
  // The sandbox window opens on a blank page: out of the way
  await page.keyboard.press('Escape')
  const rows = await page.evaluate((list) => window.__frameBench(list ? { scenarios: list } : {}), scenarios)
  console.table(rows)
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
