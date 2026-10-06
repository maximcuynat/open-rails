#!/usr/bin/env node
/**
 * Writes a project made of N × N copies of the Marseille Saint-Charles example, to measure the
 * editor on a large network in a real browser (Fichier ▸ Importer).
 *
 *   node tools/perf/make-stations.mjs 9 /tmp/stations-9.json     # about 122 000 rails
 *
 * Track only: the speed zones and the train of the example are left out.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const copies = Number(process.argv[2] ?? 3)
const out = process.argv[3]
if (!out || !Number.isInteger(copies) || copies < 1) {
  console.error('usage: node tools/perf/make-stations.mjs <copies> <out.json>')
  process.exit(1)
}

/** Distance between two copies, m */
const PITCH = 1400
const example = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../src/examples/marseille-saint-charles.json', import.meta.url)), 'utf8'),
)

const round = (v) => Math.round(v * 1000) / 1000
const nodes = []
const segments = []
let nextId = 1
for (let row = 0; row < copies; row++) {
  for (let col = 0; col < copies; col++) {
    const dx = col * PITCH
    const dy = row * PITCH
    const ids = new Map()
    for (const node of example.nodes) {
      const id = `n_${nextId++}`
      ids.set(node.id, id)
      nodes.push({ ...node, id, x: round(node.x + dx), y: round(node.y + dy) })
    }
    for (const seg of example.segments) {
      const copy = { ...seg, id: `s_${nextId++}`, from: ids.get(seg.from), to: ids.get(seg.to) }
      if (seg.via) copy.via = { x: round(seg.via.x + dx), y: round(seg.via.y + dy) }
      segments.push(copy)
    }
  }
}

const project = {
  ...example,
  name: `${copies * copies} gares (banc de mesure)`,
  nodes,
  segments,
  speedZones: [],
  trains: [],
}
writeFileSync(out, JSON.stringify(project))
console.log(`${out}: ${nodes.length} nodes, ${segments.length} rails`)
