import { test } from 'vitest'
import type { EditorStore } from '@application/state/editorStore'
import { bogiePoints, singleTrackLine, type LineSignals } from '@application/game/singleTrack.testkit'
import { buildTrainConsoleState } from '@application/console/consoleState'
import { addItineraryStop } from '@application/game/itinerary'
import { findJunctionAtNode } from '@domain/models/routing'
import type { TrainSet } from '@domain/models/train'

// What two (or three) trains under the automatic pilot do on a single track with passing loops,
// with the signals a layout may have (none, the six of a loop laid by hand, those an import lays).
// An exploration: it prints what happened, it asserts nothing. WHY=1 adds what each train waits
// for at the end, ONLY=<text> keeps the scenarios whose name holds it.
//
// Run by hand: PROFILE=1 npx vitest run tools/perf/explore-single-track.test.ts --silent=false

/** Passing loops: centre (m) of each, 600 m long, on a single track from 0 to `END` */
const LOOPS = { ouest: 600, milieu: 6000, est: 11_400 }
const END = 12_000

const layout = (signals: LineSignals) => ({ store: singleTrackLine(LOOPS, END, signals) })

const span = (store: EditorStore, train: TrainSet) => {
  const points = bogiePoints(store, train)
  return { points, y: points[0].y, head: points[0].x }
}

interface Journey { from: string; to: string[] }

function scenario(label: string, signals: LineSignals, journeys: Journey[], seconds = 1500): void {
  const { store } = layout(signals)
  for (const journey of journeys) if (!store.placeRakeAtStation(journey.from, 'duplex')) throw new Error(`no room at ${journey.from}`)
  store.togglePlayMode()
  store.trains.forEach((train, i) => {
    for (const station of journeys[i].to) {
      const refused = addItineraryStop(store, train, station)
      if (refused) process.stderr.write(`  itinerary refused: ${refused}\n`)
    }
    store.setAutopilot(train.id, true)
  })
  let closest = Infinity
  let hit: number | null = null
  let lastMove = 0
  const log: string[] = []
  const done = () => store.trains.every((t) => t.itinerary && t.itinerary.next >= t.itinerary.stations.length && t.currentSpeed === 0)
  let t = 0
  for (; t < seconds && !done() && hit === null && t - lastMove < 150; t += 0.05) {
    store.tickAllTrains(0.05)
    const spans = store.trains.map((train) => span(store, train))
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        // Bogie to bogie: two trains side by side in a loop are 3,8 m apart, on one track never under a car length
        let gap = Infinity
        for (const a of spans[i].points) for (const b of spans[j].points) gap = Math.min(gap, Math.hypot(a.x - b.x, a.y - b.y))
        if (Math.abs(spans[i].y - spans[j].y) < 2) closest = Math.min(closest, gap)
        if (gap < 2.5 && hit === null) hit = t
      }
    }
    if (store.trains.some((train) => train.currentSpeed > 0.01)) lastMove = t
    if (Math.round(t * 20) % (20 * 60) === 0) {
      log.push(`    t ${Math.round(t)} s: ` + store.trains.map((train, i) => {
        const state = buildTrainConsoleState(store, train)
        const cause = state.signals?.next?.cause ?? (state.signals?.closedDistance != null ? 'closed further' : '')
        return `T${i + 1} x ${Math.round(spans[i].head)} y ${spans[i].y.toFixed(1)} v ${train.currentSpeed.toFixed(1)}${cause ? ` [${cause}]` : ''}${train.emergencyBrake ? ' URGENCE' : ''}${train.derailed ? ' DÉRAILLÉ' : ''}`
      }).join(' | '))
    }
  }
  if (process.env.WHY) {
    store.trains.forEach((train, i) => {
      const guide = store.routeGuides.get(train.id)
      const against = guide?.against
      const junction = against ? findJunctionAtNode(store.network, against.nodeId) : null
      const node = against ? store.network.nodes.get(against.nodeId)!.pos : null
      const ys = [...new Set((guide?.guide?.path.spans ?? []).map((sp) => { const r = store.network.segments.get(sp.segId)!; return ((store.network.nodes.get(r.from)!.pos.y + store.network.nodes.get(r.to)!.pos.y) / 2).toFixed(1) }))].join(' ')
      const sig = buildTrainConsoleState(store, train).signals
      log.push(`    pourquoi T${i + 1} : aiguille contre le trajet ${node ? `en x ${Math.round(node.x)} (${junction ? store.junctionLock(junction, train.id) ?? 'libre' : 'sans table'})` : 'aucune'} ; trajet par y = ${ys} ; signal ${sig?.next ? `${Math.round(sig.next.distance)} m ${sig.next.color} ${sig.next.cause ?? ''}` : '—'}`)
    })
  }
  const arrived = store.trains.map((train) => !!train.itinerary && train.itinerary.next >= train.itinerary.stations.length)
  const verdict = hit !== null ? `COLLISION à ${Math.round(hit)} s` : arrived.every(Boolean) ? `tous arrivés en ${Math.round(t)} s` : `BLOQUÉ (dernier mouvement à ${Math.round(lastMove)} s, arrivés : ${arrived.map((a) => (a ? 'oui' : 'non')).join(', ')})`
  process.stderr.write(`\n${label} — signaux « ${signals} », ${store.network.signals.size} signaux : ${verdict} ; plus près sur la même voie : ${Number.isFinite(closest) ? Math.round(closest) + ' m' : '—'}\n${log.join('\n')}\n`)
}

test.runIf(process.env.PROFILE)('single track under the automatic pilot', { timeout: 900_000 }, () => {
  const journeys: Record<string, Journey[]> = {
    'Deux trains face à face': [{ from: 'ouest', to: ['est'] }, { from: 'est', to: ['ouest'] }],
    'Face à face, arrêt au milieu': [{ from: 'ouest', to: ['milieu', 'est'] }, { from: 'est', to: ['milieu', 'ouest'] }],
    'Trois trains': [{ from: 'ouest', to: ['est'] }, { from: 'est', to: ['ouest'] }, { from: 'milieu', to: ['est'] }],
    'Deux qui se suivent, un en face': [{ from: 'ouest', to: ['est'] }, { from: 'ouest', to: ['est'] }, { from: 'est', to: ['ouest'] }],
    'Deux contre deux': [{ from: 'ouest', to: ['est'] }, { from: 'ouest', to: ['est'] }, { from: 'est', to: ['ouest'] }, { from: 'est', to: ['ouest'] }],
  }
  const only = process.env.ONLY
  for (const [label, trains] of Object.entries(journeys)) {
    for (const signals of ['none', 'six', 'auto'] as const) {
      if (only && !`${label} ${signals}`.includes(only)) continue
      scenario(label, signals, trains)
    }
  }
})
