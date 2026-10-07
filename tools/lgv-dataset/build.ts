import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertOsm } from '@domain/import/osmImport'
import { LAMBERT93_ORIGIN, projectionFor } from '@domain/import/osmProjection'
import type { OverpassResponse } from '@domain/import/osmTypes'
import { reconcileNetworkIntersections } from '@domain/geometry/reconcile'
import { placementThresholds } from '@domain/geometry/scale'
import { resetIdCounter } from '@domain/models/network'
import { splitSpeedZonesBy } from '@domain/models/speedZones'
import { matchStationRegistry, readStationRegistry, type StationRegistryEntry } from '@domain/models/stationRegistry'
import { buildOsmProject } from '@application/import/osmProject'
import { askOverpass, OVERPASS_SERVERS } from '@infrastructure/osm/overpassClient'
import type { SerializedProject } from '@infrastructure/persistence/persistence'
import { sliceProject } from '@infrastructure/persistence/projectSlices'
import { buildIndex, type DatasetIndex } from './datasetIndex'
import { fetchAll } from './fetch'
import { assignLines, groupOfRail, type LineId } from './lines'
import { readManifest, type DatasetManifest } from './manifest'

// The « LGV France » dataset: the whole high-speed network converted once, in the national frame,
// then written as one project file per line plus an index. See `public/data/lgv/README.md`.

export interface BuiltDataset {
  files: Map<LineId, SerializedProject>
  index: DatasetIndex
  report: {
    rails: number
    lengthKm: number
    stations: number
    droppedComponents: number
    reconcile: { splitCount: number; weldedCount: number }
    zonesCut: number
    unlistedHighSpeedWays: number
    convertMs: number
  }
}

/** Standard gauge: the dataset is the real network */
const GAUGE = 1.435

/**
 * From the merged answer to the files, without touching the disk: the one conversion, the
 * official names, one reconcile pass (so that loading a file finds nothing to mend), the lines,
 * the zones cut at their borders, the slices and the index.
 */
export function buildDataset(
  merged: OverpassResponse,
  manifest: DatasetManifest,
  registry: readonly StationRegistryEntry[],
  approachWays: ReadonlyMap<string, ReadonlySet<number>>,
  now: Date,
  fileName: (id: LineId) => string = (id) => `${id}.json`,
): BuiltDataset {
  resetIdCounter(0)
  const t0 = performance.now()
  const result = convertOsm(merged, {
    serviceTracks: true,
    disusedTracks: false,
    extraKinds: [],
    levels: true,
    speedLimits: true,
    defaultServiceSpeed: 30,
    keepDetachedOverKm: manifest.keepDetachedOverKm,
    signals: 'generated',
    stations: true,
    frame: 'lambert93',
    traceWays: true,
  })
  const convertMs = performance.now() - t0
  const net = result.network
  matchStationRegistry(net, registry, projectionFor('lambert93', LAMBERT93_ORIGIN))
  const reconcile = reconcileNetworkIntersections(net, placementThresholds(GAUGE).reconcileTolerance)
  const assignment = assignLines(result, merged, manifest, approachWays)
  const zonesCut = splitSpeedZonesBy(net, groupOfRail(assignment))
  const whole = buildOsmProject(result, { levels: true, now })

  const files = new Map<LineId, SerializedProject>()
  const written = new Map<LineId, { file: string; bytes: number; project: SerializedProject }>()
  for (const id of assignment.lines.keys()) {
    const slice = sliceProject(whole, (segId) => assignment.lineOf.get(segId) === id)
    if (slice.segments.length === 0) continue
    slice.name = assignment.lines.get(id)!.name
    files.set(id, slice)
    written.set(id, { file: fileName(id), bytes: JSON.stringify(slice).length, project: slice })
  }
  const dataDate = result.dataDate ?? now.toISOString().slice(0, 10)
  const index = buildIndex(net, assignment, written, registry, { dataDate, generatedAt: now.toISOString() })
  return {
    files,
    index,
    report: {
      rails: net.segments.size,
      lengthKm: result.report.lengthKm,
      stations: net.stations.size,
      droppedComponents: result.report.droppedComponents,
      reconcile,
      zonesCut,
      unlistedHighSpeedWays: assignment.unlistedHighSpeedWays,
      convertMs,
    },
  }
}

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const OUT_DIR = join(ROOT, 'public', 'data', 'lgv')
const CACHE_DIR = join(ROOT, 'tools', 'lgv-dataset', 'cache')
const REGISTRY_FILE = join(ROOT, 'src', 'data', 'stations-fr.json')

function readme(index: DatasetIndex): string {
  const lines = index.lines.map((l) => `| ${l.name} | \`${l.file}\` | ${l.rails} | ${l.lengthKm.toFixed(1)} km | ${(l.bytes / 1024).toFixed(0)} ko |`).join('\n')
  return `# Jeu de données « LGV France »

Le réseau ferré à grande vitesse de France, avec les raccordements vers quelques gares de centre-ville,
prêt à être chargé par l'éditeur : un fichier projet par ligne et un index.

- Données OpenStreetMap du ${index.dataDate}, générées le ${index.generatedAt.slice(0, 10)}.
- ${index.attribution[0]}
- ${index.attribution[1]}
- Repère : Lambert-93 (EPSG:2154), origine (46,5° N, 3° E) au monde (0, 0), y vers le sud.

Régénérer : \`node tools/lgv-dataset/run.mjs\` (voir \`tools/lgv-dataset/manifest.json\` ; \`--offline\` relit le cache).

## Fichiers

\`index.json\` : les lignes (fichier, longueur, boîte, gares), les raccords entre lignes (nœuds communs) et les gares
(nom, code UIC, trigramme, position, lignes). Chaque fichier de ligne est un projet complet de l'éditeur ; les
fichiers partagent leurs ids et se réunissent par union (\`unionProjects\`).

| Ligne | Fichier | Rails | Longueur | Taille |
|---|---|---|---|---|
${lines}
`
}

/** The command: fetch (or read the cache), build, write */
export async function main(argv: string[]): Promise<number> {
  const offline = argv.includes('--offline')
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined
  const log = (line: string): void => console.log(line)
  const manifest = readManifest()
  const registry = readStationRegistry(JSON.parse(readFileSync(REGISTRY_FILE, 'utf8')))
  const servers = [...OVERPASS_SERVERS, 'https://overpass.kumi.systems/api/interpreter']
  const fetched = await fetchAll(manifest, CACHE_DIR, {
    offline,
    log,
    ask: (query) => askOverpass(query, { servers, rounds: 2, pauseMs: 20_000, timeoutMs: 240_000 }),
  })
  log(`${fetched.tiles} tiles, ${fetched.asked} queries sent, ${fetched.merged.elements.length} elements merged`)

  const built = buildDataset(fetched.merged, manifest, registry, fetched.approachWays, new Date())
  const r = built.report
  log(`converted in ${(r.convertMs / 1000).toFixed(1)} s: ${r.rails} rails, ${r.lengthKm.toFixed(0)} km of track, ${r.stations} stations, ${r.droppedComponents} detached parts dropped`)
  log(`reconcile: ${r.reconcile.splitCount} split, ${r.reconcile.weldedCount} welded; ${r.zonesCut} speed zones cut at line borders`)
  log(`${r.unlistedHighSpeedWays} high-speed ways in no listed relation (taken from a neighbour, else « autres »)`)

  mkdirSync(OUT_DIR, { recursive: true })
  let total = 0
  for (const line of built.index.lines) {
    if (only && line.id !== only) continue
    const text = JSON.stringify(built.files.get(line.id))
    writeFileSync(join(OUT_DIR, line.file), text)
    total += text.length
    log(`  ${line.file}: ${line.rails} rails, ${line.lengthKm.toFixed(1)} km, ${(text.length / 1024).toFixed(0)} ko`)
  }
  writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(built.index, null, 1))
  writeFileSync(join(OUT_DIR, 'README.md'), readme(built.index))
  log(`${built.index.lines.length} lines, ${built.index.stations.length} stations, ${built.index.connections.length} connections; ${(total / 1048576).toFixed(2)} MiB of line files`)
  return 0
}
