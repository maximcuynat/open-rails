import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OverpassResponse } from '@domain/import/osmTypes'
import { OsmError } from '@infrastructure/osm/osmError'
import type { DatasetManifest } from './manifest'
import { mergeAnswers, wayIdsOf } from './merge'
import { approachQuery, tileQuery } from './queries'
import { splitTile, tileKey, tilesOf, type Tile } from './tiles'

export interface FetchOptions {
  /** Read the cache only: a query that is not there is an error */
  offline?: boolean
  /** One query to the servers (the rotation of `askOverpass`); throws an OsmError */
  ask: (query: string) => Promise<OverpassResponse>
  sleep?: (ms: number) => Promise<void>
  log?: (line: string) => void
  /** Pauses (ms) before the whole rotation is tried again on a busy service; the length is the number of extra tries */
  busyPauses?: readonly number[]
}

export interface FetchedData {
  merged: OverpassResponse
  /** The ways each approach brought, by approach id */
  approachWays: Map<string, Set<number>>
  /** How many queries went to the servers (not the cache) */
  asked: number
  tiles: number
}

const DEFAULT_BUSY_PAUSES = [30_000, 60_000, 120_000]

/** Every tile and every approach of the manifest, from the cache when it has them, else from the servers */
export async function fetchAll(manifest: DatasetManifest, cacheDir: string, options: FetchOptions): Promise<FetchedData> {
  mkdirSync(cacheDir, { recursive: true })
  const log = options.log ?? (() => {})
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const pauses = options.busyPauses ?? DEFAULT_BUSY_PAUSES
  let asked = 0

  const cached = async (name: string, query: string): Promise<OverpassResponse> => {
    const file = join(cacheDir, `${name}-${createHash('sha1').update(query).digest('hex').slice(0, 10)}.json`)
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as OverpassResponse
    if (options.offline) throw new Error(`${name}: not in the cache, and offline`)
    for (let attempt = 0; ; attempt++) {
      try {
        log(`${name}: asking${attempt > 0 ? ` (try ${attempt + 1})` : ''}…`)
        asked++
        const answer = await options.ask(query)
        writeFileSync(file, JSON.stringify(answer))
        log(`${name}: ${answer.elements.length} elements`)
        return answer
      } catch (error) {
        if (!(error instanceof OsmError) || error.kind !== 'busy' || attempt >= pauses.length) throw error
        log(`${name}: busy, waiting ${Math.round(pauses[attempt] / 1000)} s`)
        await sleep(pauses[attempt])
      }
    }
  }

  const answers: OverpassResponse[] = []
  let tiles = 0
  const fetchTile = async (tile: Tile): Promise<void> => {
    tiles++
    try {
      answers.push(await cached(tileKey(tile), tileQuery(tile)))
    } catch (error) {
      if (!(error instanceof OsmError) || error.kind !== 'too-large') throw error
      log(`${tileKey(tile)}: too large, split in four`)
      for (const part of splitTile(tile)) await fetchTile(part)
    }
  }
  for (const tile of tilesOf(manifest.bbox, manifest.tileDeg)) await fetchTile(tile)

  const approachWays = new Map<string, Set<number>>()
  for (const approach of manifest.approaches) {
    const answer = await cached(approach.id, approachQuery(approach))
    approachWays.set(approach.id, wayIdsOf(answer))
    answers.push(answer)
  }
  return { merged: mergeAnswers(answers), approachWays, asked, tiles }
}
