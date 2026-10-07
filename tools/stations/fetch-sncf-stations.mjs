#!/usr/bin/env node
/**
 * Writes `src/data/stations-fr.json`: the passenger stations of France from the SNCF Gares &
 * Connexions open data « gares-de-voyageurs » (ODbL), in a compact form the application reads to
 * name the stations of an import and, later, to look one up.
 *
 *   node tools/stations/fetch-sncf-stations.mjs [out.json]
 *
 * Each station is one row: [name, trigram, uicCodes, lat, lon, segment], where `uicCodes` lists
 * the eight-digit codes of the dataset (the last digit is a check digit; OpenStreetMap writes the
 * first seven) and `segment` is the DRG class: A national, B regional, C local.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = 'https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/gares-de-voyageurs/exports/json'
const out = process.argv[2] ?? fileURLToPath(new URL('../../src/data/stations-fr.json', import.meta.url))

const response = await fetch(SOURCE)
if (!response.ok) {
  console.error(`${SOURCE}: HTTP ${response.status}`)
  process.exit(1)
}
const records = await response.json()
if (!Array.isArray(records)) {
  console.error('unexpected answer: not a list of records')
  process.exit(1)
}

const round = (v) => Math.round(v * 1e6) / 1e6
const stations = []
let dropped = 0
for (const r of records) {
  const name = typeof r.nom === 'string' ? r.nom.trim() : ''
  const pos = r.position_geographique
  if (!name || !pos || typeof pos.lat !== 'number' || typeof pos.lon !== 'number') {
    dropped++
    continue
  }
  const codes = String(r.codes_uic ?? '')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => /^\d{8}$/.test(c))
  const trigram = typeof r.libellecourt === 'string' && /^[A-Z]{3}$/.test(r.libellecourt.trim()) ? r.libellecourt.trim() : ''
  const segment = typeof r.segment_drg === 'string' ? r.segment_drg.split(';')[0].trim().toUpperCase() : ''
  stations.push([name, trigram, codes, round(pos.lat), round(pos.lon), /^[ABC]$/.test(segment) ? segment : ''])
}
stations.sort((a, b) => a[0].localeCompare(b[0], 'fr'))

const file = {
  source: 'SNCF Gares & Connexions, « Gares de voyageurs », https://ressources.data.sncf.com/explore/dataset/gares-de-voyageurs/',
  licence: 'ODbL 1.0 — https://opendatacommons.org/licenses/odbl/1-0/',
  date: new Date().toISOString().slice(0, 10),
  columns: ['name', 'trigram', 'uicCodes', 'lat', 'lon', 'segment'],
  stations,
}
// One row per line: a diff that reads
const body = `{\n"source":${JSON.stringify(file.source)},\n"licence":${JSON.stringify(file.licence)},\n"date":${JSON.stringify(file.date)},\n"columns":${JSON.stringify(file.columns)},\n"stations":[\n${stations.map((s) => JSON.stringify(s)).join(',\n')}\n]}\n`
writeFileSync(out, body)
console.log(`${out}: ${stations.length} stations (${dropped} records without name or position), ${(body.length / 1024).toFixed(0)} kB`)
