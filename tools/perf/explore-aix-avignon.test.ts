import { test } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EditorStore } from '@application/state/editorStore'
import { addItineraryStop } from '@application/game/itinerary'
import { readDatasetIndex } from '@domain/dataset/datasetIndex'
import { positionOnSegment, tangentOnSegment } from '@domain/models/locomotive'
import { runsAgainst } from '@domain/models/running'
import { railsWithin } from '@domain/geometry/networkFollower'
import { closestParamOnShape, pointOnShape, segmentEnds, tangentOnShape } from '@domain/geometry/segmentGeometry'
import { verifyNetworkRevisions } from '@domain/models/networkWatch'
import type { Network, Point } from '@domain/models/types'
import { resetMemoryStorage, type SerializedProject } from '@infrastructure/persistence/persistence'
import { unionProjects } from '@infrastructure/persistence/projectSlices'

verifyNetworkRevisions(false)

const DIR = fileURLToPath(new URL('../../public/data/lgv/', import.meta.url))
const read = <T>(name: string): T => JSON.parse(readFileSync(`${DIR}${name}`, 'utf8')) as T

const FROM = 'Aix-en-Provence TGV'
const TO = 'Avignon TGV'

/**
 * Which track of a double line a place is on, seen in the direction of travel: « gauche » when
 * the one other track alongside (2.5 – 7.5 m away, parallel) is on the right, « droite » when it
 * is on the left; null on single track or among three tracks or more. Read from the geometry
 * alone, not from `Segment.running`.
 */
function sideOfTravel(net: Network, segId: string, p: Point, heading: Point): 'gauche' | 'droite' | null {
  const laterals: number[] = []
  for (const other of railsWithin(net, p, 12)) {
    if (other.id === segId) continue
    const ends = segmentEnds(net, other)
    if (!ends) continue
    const t = closestParamOnShape(ends, p)
    const q = pointOnShape(ends, t)
    const dx = q.x - p.x
    const dy = q.y - p.y
    if (Math.hypot(dx, dy) > 12 || Math.abs(dx * heading.x + dy * heading.y) > 2) continue
    const dir = tangentOnShape(ends, t)
    if (Math.abs(dir.x * heading.x + dir.y * heading.y) < Math.cos((6 * Math.PI) / 180)) continue
    const lateral = dx * heading.y - dy * heading.x
    if (Math.abs(lateral) < 0.5) continue
    if (!laterals.some((l) => Math.abs(l - lateral) < 1)) laterals.push(lateral)
  }
  if (laterals.length !== 1 || Math.abs(laterals[0]) < 2.5 || Math.abs(laterals[0]) > 7.5) return null
  // The other track on the left of the heading: this one is the right-hand track
  return laterals[0] > 0 ? 'droite' : 'gauche'
}

// A TGV from Aix-en-Provence TGV to Avignon TGV on the LGV Méditerranée of the dataset, under the
// automatic pilot and the full driving aid: which track of the double line it runs on.
//
// Run by hand: PROFILE=1 npx vitest run tools/perf/explore-aix-avignon.test.ts --silent=false
test.runIf(process.env.PROFILE && existsSync(`${DIR}index.json`))('Aix-en-Provence TGV → Avignon TGV under the pilot', { timeout: 900_000 }, () => {
  const index = readDatasetIndex(read<unknown>('index.json'))
  const from = index.stations.find((s) => s.name === FROM)!
  const to = index.stations.find((s) => s.name === TO)!
  const margin = 5000
  const box = { minX: Math.min(from.x, to.x) - margin, maxX: Math.max(from.x, to.x) + margin, minY: Math.min(from.y, to.y) - margin, maxY: Math.max(from.y, to.y) + margin }
  // The high-speed pieces between the two stations
  const pieces = index.lines.filter((line) => line.highSpeed && line.bbox.minX <= box.maxX && line.bbox.maxX >= box.minX && line.bbox.minY <= box.maxY && line.bbox.maxY >= box.minY)
  resetMemoryStorage()
  const store = new EditorStore()
  store.loadFromData(unionProjects(pieces.map((line) => read<SerializedProject>(line.file))))
  const net = store.network
  const stationId = (name: string) => [...net.stations.values()].find((s) => s.name === name)!.id
  let tagged = 0
  for (const seg of net.segments.values()) if (seg.running) tagged++
  process.stderr.write(`\n${pieces.map((p) => p.id).join(', ')} : ${net.segments.size} rails, ${tagged} avec un sens normal\n`)

  const stop = store.placeRakeAtStation(stationId(FROM), 'duplex')
  if (!stop) throw new Error(`no room at ${FROM}`)
  const train = store.trains[0]
  const start = train.vehicles[0].front
  const startRail = net.segments.get(start.segId)!
  process.stderr.write(`  posé voie ${stop.ref ?? '?'} sur ${start.segId}, ${startRail.running ? (runsAgainst(startRail, start.forward) ? 'à contre-sens' : 'dans le sens normal') : 'voie sans sens'}\n`)
  store.togglePlayMode()
  const refused = addItineraryStop(store, train, stationId(TO))
  if (refused) throw new Error(`itinerary refused: ${refused}`)
  store.setAutopilot(train.id, true)

  const metres = { gauche: 0, droite: 0, unknown: 0, against: 0, normal: 0, none: 0 }
  const rightStretches: string[] = []
  let rightSince: number | null = null
  let travelled = 0
  let t = 0
  const arrived = () => !!train.itinerary && train.itinerary.next >= train.itinerary.stations.length && train.currentSpeed === 0
  for (; t < 5400 && !arrived(); t += 0.05) {
    store.tickAllTrains(0.05)
    const step = train.currentSpeed * 0.05
    travelled += step
    if (step <= 0) continue
    const lead = train.vehicles[0].front
    const rail = net.segments.get(lead.segId)
    const p = positionOnSegment(net, lead.segId, lead.t)
    const tan = tangentOnSegment(net, lead.segId, lead.t)
    if (!rail || !p || !tan) continue
    const sign = (lead.forward ? 1 : -1) * train.direction
    const heading = { x: tan.x * sign, y: tan.y * sign }
    const side = sideOfTravel(net, rail.id, p, heading)
    if (side === 'gauche') metres.gauche += step
    else if (side === 'droite') metres.droite += step
    else metres.unknown += step
    const movingForward = sign > 0
    if (!rail.running) metres.none += step
    else if (runsAgainst(rail, movingForward)) metres.against += step
    else metres.normal += step
    if (side === 'droite' && rightSince === null) rightSince = travelled
    if (side !== 'droite' && rightSince !== null) {
      if (travelled - rightSince > 50) rightStretches.push(`${(rightSince / 1000).toFixed(1)}–${(travelled / 1000).toFixed(1)} km`)
      rightSince = null
    }
  }
  const km = (m: number) => `${(m / 1000).toFixed(1)} km`
  process.stderr.write(`  ${arrived() ? `arrivé en ${Math.round(t)} s` : `PAS ARRIVÉ après ${Math.round(t)} s`}, ${km(travelled)} parcourus ; urgence ou déraillement : ${train.emergencyBrake || train.derailed ? 'OUI' : 'non'}\n`)
  process.stderr.write(`  par la géométrie : voie de gauche ${km(metres.gauche)}, voie de droite ${km(metres.droite)}, ni l'une ni l'autre (voie unique, gare, aiguilles) ${km(metres.unknown)}\n`)
  process.stderr.write(`  par le sens des rails : sens normal ${km(metres.normal)}, contre-sens ${km(metres.against)}, rails sans sens ${km(metres.none)}\n`)
  process.stderr.write(`  passages sur la voie de droite (> 50 m) : ${rightStretches.join(', ') || 'aucun'}\n`)
})
