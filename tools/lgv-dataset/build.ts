import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertOsm } from '@domain/import/osmImport'
import { LAMBERT93_ORIGIN, projectionFor } from '@domain/import/osmProjection'
import type { OsmPlatformReport, OsmRunningReport, OverpassResponse } from '@domain/import/osmTypes'
import { reconcileNetworkIntersections } from '@domain/geometry/reconcile'
import { placementThresholds } from '@domain/geometry/scale'
import { resetIdCounter, segmentBand } from '@domain/models/network'
import { segmentShapeLength } from '@domain/geometry/segmentGeometry'
import { rightHandArea } from '@domain/services/rightHandRunning'
import { splitSpeedZonesBy } from '@domain/models/speedZones'
import { matchStationRegistry, readStationRegistry, type StationRegistryEntry } from '@domain/models/stationRegistry'
import { buildOsmProject } from '@application/import/osmProject'
import { askOverpass, OVERPASS_SERVERS } from '@infrastructure/osm/overpassClient'
import type { SerializedProject } from '@infrastructure/persistence/persistence'
import { sliceProject } from '@infrastructure/persistence/projectSlices'
import type { DatasetIndex } from '@domain/dataset/datasetIndex'
import { buildIndex } from './datasetIndex'
import { fetchAll } from './fetch'
import { assignLines, groupOfRail, type LineId } from './lines'
import { absorbSmallLines, cutIntoPieces } from './pieces'
import { speedDips } from './speedDips'
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
    /** Track without `maxspeed`, and track laid slower than its `maxspeed` (see `OsmImportReport`), km */
    lengthWithoutSpeedKm: number
    slowUnderSpeedKm: number
    /** Rails whose limit falls well under that of both their neighbours, over all the files (`speedDips`) */
    speedDips: { dips: number; underZone: number; withoutZone: number }
    /** What the import did about the platforms (`OsmImportReport.platforms`) */
    platforms: OsmPlatformReport | null
    /** Track given a normal direction of running by its tag, by the rule of keeping left, without one (`OsmImportReport.running`) */
    running: OsmRunningReport | null
    /** Stations without a platform, and their names (sorted), the ones the data gave platforms apart */
    stationsWithoutPlatform: string[]
    /** Bytes of the files, and the part of them the platforms take */
    bytes: number
    platformBytes: number
    /** The metro: its lines (before the cut into pieces), rails, length, length under the ground, and bytes of its files */
    subway: { lines: number; rails: number; lengthKm: number; undergroundKm: number; bytes: number }
    /** The railway track in Alsace-Moselle (where classic lines keep right), and the part of it with a direction of running, km */
    alsaceMoselle: { lengthKm: number; withRunningKm: number }
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
  regionWays: ReadonlySet<number> = new Set(),
  subwayWays: ReadonlyMap<string, ReadonlySet<number>> = new Map(),
  fileName: (id: LineId) => string = (id) => `${id}.json`,
): BuiltDataset {
  resetIdCounter(0)
  const t0 = performance.now()
  const result = convertOsm(merged, {
    serviceTracks: true,
    disusedTracks: false,
    // The metros of the cities the dataset reaches (`Segment.railway`): only their own queries bring any
    extraKinds: (manifest.subways ?? []).length > 0 ? ['subway'] : [],
    levels: true,
    speedLimits: true,
    defaultServiceSpeed: 30,
    defaultTrackSpeed: 160,
    keepDetachedOverKm: manifest.keepDetachedOverKm,
    signals: 'generated',
    stations: true,
    frame: 'lambert93',
    traceWays: true,
    checkKeepLeft: true,
  })
  const convertMs = performance.now() - t0
  const net = result.network
  matchStationRegistry(net, registry, projectionFor('lambert93', LAMBERT93_ORIGIN))
  const reconcile = reconcileNetworkIntersections(net, placementThresholds(GAUGE).reconcileTolerance)
  // The lines, then their pieces: what is written, one file each
  const lineAssignment = absorbSmallLines(net, assignLines(result, merged, manifest, approachWays, regionWays, subwayWays))
  const assignment = cutIntoPieces(net, lineAssignment)
  const zonesCut = splitSpeedZonesBy(net, groupOfRail(assignment))
  // A file is dated by its data, not by the run that wrote it: the same data gives the same
  // files, and git sees no change in a piece nothing touched
  const dataDate = result.dataDate ?? now.toISOString().slice(0, 10)
  const dated = new Date(dataDate)
  const whole = buildOsmProject(result, { levels: true, now: Number.isNaN(dated.getTime()) ? now : dated })

  const files = new Map<LineId, SerializedProject>()
  const written = new Map<LineId, { file: string; bytes: number; project: SerializedProject }>()
  for (const id of assignment.lines.keys()) {
    const slice = sliceProject(whole, (segId) => assignment.lineOf.get(segId) === id)
    if (slice.segments.length === 0) continue
    slice.name = assignment.lines.get(id)!.name
    files.set(id, slice)
    written.set(id, { file: fileName(id), bytes: JSON.stringify(slice).length, project: slice })
  }
  const dips = { dips: 0, underZone: 0, withoutZone: 0 }
  let bytes = 0
  let platformBytes = 0
  for (const { bytes: size, project } of written.values()) {
    bytes += size
    if (project.platforms) platformBytes += JSON.stringify(project.platforms).length + ',"platforms":'.length
  }
  const platformed = new Set([...net.platforms.values()].map((platform) => platform.stationId))
  const stationsWithoutPlatform = [...net.stations.values()].filter((station) => !platformed.has(station.id)).map((station) => station.name).sort((a, b) => a.localeCompare(b, 'fr'))
  for (const project of files.values()) {
    const found = speedDips(project)
    dips.dips += found.dips
    dips.underZone += found.underZone
    dips.withoutZone += found.withoutZone
  }
  const index = buildIndex(net, assignment, written, registry, { dataDate, generatedAt: now.toISOString() })
  const subway = { lines: 0, rails: 0, lengthKm: 0, undergroundKm: 0, bytes: 0 }
  for (const info of lineAssignment.lines.values()) if (info.category === 'subway') subway.lines++
  for (const seg of net.segments.values()) {
    if (seg.railway !== 'subway') continue
    const km = segmentShapeLength(net, seg) / 1000
    subway.rails++
    subway.lengthKm += km
    if (segmentBand(net, seg) < 0) subway.undergroundKm += km
  }
  for (const [id, { bytes: size }] of written) if (assignment.lines.get(id)?.category === 'subway') subway.bytes += size
  const inAlsaceMoselle = rightHandArea(projectionFor('lambert93', LAMBERT93_ORIGIN))
  const alsaceMoselle = { lengthKm: 0, withRunningKm: 0 }
  for (const seg of net.segments.values()) {
    const a = net.nodes.get(seg.from)!.pos
    const b = net.nodes.get(seg.to)!.pos
    if (seg.railway || !inAlsaceMoselle({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) continue
    const km = segmentShapeLength(net, seg) / 1000
    alsaceMoselle.lengthKm += km
    if (seg.running) alsaceMoselle.withRunningKm += km
  }
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
      lengthWithoutSpeedKm: result.report.lengthWithoutSpeedKm,
      slowUnderSpeedKm: result.report.slowUnderSpeedKm ?? 0,
      speedDips: dips,
      platforms: result.report.platforms ?? null,
      running: result.report.running ?? null,
      stationsWithoutPlatform,
      bytes,
      platformBytes,
      subway,
      alsaceMoselle,
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
les lignes classiques de Provence-Alpes-Côte d'Azur et le métro de quelques villes (Paris, Lyon, Marseille, Lille),
prêt à être chargé par l'éditeur : un fichier projet par morceau de ligne et un index.

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

/** The index as it is written: one field per line to be read by eye, the strokes of an outline on one line each */
export function indexText(index: DatasetIndex): string {
  const text = JSON.stringify(index, (key, value: unknown) => (key === 'outline' ? JSON.stringify(value) : value), 1)
  // An outline holds numbers only: its text has no quote to escape
  return text.replace(/"outline": "(\[[^"]*\])"/g, '"outline": $1')
}

/**
 * Who asks, told to the Overpass servers: they answer 406 to a request without a User-Agent, which
 * Node's fetch does not send of itself (a browser sends its own; the application leaves it be)
 */
const USER_AGENT = 'open-rails-dataset (github.com/maximcuynat/open-rails)'

const politeFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers)
  headers.set('User-Agent', USER_AGENT)
  return fetch(input, { ...init, headers })
}

/** The command: fetch (or read the cache), build, write */
export async function main(argv: string[]): Promise<number> {
  const offline = argv.includes('--offline')
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined
  const log = (line: string): void => console.log(line)
  const manifest = readManifest()
  const registry = readStationRegistry(JSON.parse(readFileSync(REGISTRY_FILE, 'utf8')))
  const servers = [...OVERPASS_SERVERS, 'https://overpass.kumi.systems/api/interpreter']
  const fetched = await fetchAll(manifest, process.env.LGV_CACHE_DIR ?? CACHE_DIR, {
    offline,
    // `--no-platforms`: without them, a cache made before them serves whole
    platforms: !argv.includes('--no-platforms'),
    log,
    ask: (query) => askOverpass(query, { servers, rounds: 2, pauseMs: 20_000, timeoutMs: 240_000, fetch: politeFetch }),
  })
  log(`${fetched.tiles} tiles, ${fetched.platformTiles} tiles of platforms, ${fetched.asked} queries sent, ${fetched.merged.elements.length} elements merged`)

  const built = buildDataset(fetched.merged, manifest, registry, fetched.approachWays, new Date(), fetched.regionWays, fetched.subwayWays)
  const r = built.report
  log(`converted in ${(r.convertMs / 1000).toFixed(1)} s: ${r.rails} rails, ${r.lengthKm.toFixed(0)} km of track, ${r.stations} stations, ${r.droppedComponents} detached parts dropped`)
  log(`reconcile: ${r.reconcile.splitCount} split, ${r.reconcile.weldedCount} welded; ${r.zonesCut} speed zones cut at line borders`)
  log(`${r.unlistedHighSpeedWays} high-speed ways in no listed relation (taken from a neighbour, else « autres »)`)

  log(`speeds: ${r.lengthWithoutSpeedKm.toFixed(1)} km of main track without maxspeed, ${r.slowUnderSpeedKm.toFixed(2)} km laid slower than its maxspeed; ${r.speedDips.dips} rails well under both their neighbours (${r.speedDips.underZone} under a zone, ${r.speedDips.withoutZone} under none)`)
  if (r.platforms) {
    const p = r.platforms
    const skipped = Object.entries(p.skipped).map(([why, count]) => `${count} ${why}`).join(', ')
    log(`platforms: ${p.found} read, ${p.placed} laid (${p.islands} islands)${skipped ? `, left out: ${skipped}` : ''}; ${(r.platformBytes / 1024).toFixed(0)} KiB of ${(r.bytes / 1048576).toFixed(2)} MiB of line files`)
  }
  if (r.running) {
    const g = r.running
    const check = g.check ? `; the rule held against the tags: agrees on ${g.check.agreeKm.toFixed(1)} km, disagrees on ${g.check.disagreeKm.toFixed(1)} km` : ''
    log(`running: ${g.taggedKm.toFixed(0)} km by tag, ${g.inferredKm.toFixed(0)} km by the rule (${(g.rightHandKm ?? 0).toFixed(0)} of them keeping right), ${g.noneKm.toFixed(0)} km without${check}`)
  }
  log(`Alsace-Moselle: ${r.alsaceMoselle.lengthKm.toFixed(0)} km of railway track, ${r.alsaceMoselle.withRunningKm.toFixed(0)} km of it with a direction of running`)
  const m = r.subway
  log(`subway: ${m.lines} lines, ${m.rails} rails, ${m.lengthKm.toFixed(0)} km of track (${m.undergroundKm.toFixed(0)} km under the ground), ${(m.bytes / 1048576).toFixed(2)} MiB of ${(r.bytes / 1048576).toFixed(2)} MiB of line files`)
  log(`${r.stationsWithoutPlatform.length} of ${r.stations} stations without a platform${r.stationsWithoutPlatform.length > 0 ? `: ${r.stationsWithoutPlatform.slice(0, 40).join(', ')}${r.stationsWithoutPlatform.length > 40 ? '…' : ''}` : ''}`)
  // `--dry`: the figures only, nothing written
  if (argv.includes('--dry')) return 0

  mkdirSync(OUT_DIR, { recursive: true })
  let total = 0
  for (const line of built.index.lines) {
    if (only && line.id !== only) continue
    const text = JSON.stringify(built.files.get(line.id))
    writeFileSync(join(OUT_DIR, line.file), text)
    total += text.length
    log(`  ${line.file}: ${line.rails} rails, ${line.lengthKm.toFixed(1)} km, ${(text.length / 1024).toFixed(0)} ko`)
  }
  // The files of a previous run that the index no longer names (lines since cut otherwise) go
  if (!only) {
    const kept = new Set(['index.json', 'README.md', ...built.index.lines.map((line) => line.file)])
    for (const name of readdirSync(OUT_DIR)) {
      if (name.endsWith('.json') && !kept.has(name)) {
        unlinkSync(join(OUT_DIR, name))
        log(`  ${name}: removed (no longer in the index)`)
      }
    }
  }
  writeFileSync(join(OUT_DIR, 'index.json'), indexText(built.index))
  writeFileSync(join(OUT_DIR, 'README.md'), readme(built.index))
  log(`${built.index.lines.length} lines, ${built.index.stations.length} stations, ${built.index.connections.length} connections; ${(total / 1048576).toFixed(2)} MiB of line files`)
  return 0
}
