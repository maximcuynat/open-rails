import { test } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EditorStore } from '@application/state/editorStore'
import { buildTrainConsoleState } from '@application/console/consoleState'
import { addItineraryStop } from '@application/game/itinerary'
import { bogiePoints, closestBogies } from '@application/game/singleTrack.testkit'
import { readDatasetIndex } from '@domain/dataset/datasetIndex'
import { positionOnSegment, segmentPartialLength } from '@domain/models/locomotive'
import { guideAhead } from '@domain/services/routeGuide'
import { verifyNetworkRevisions } from '@domain/models/networkWatch'
import { resetMemoryStorage, type SerializedProject } from '@infrastructure/persistence/persistence'
import { unionProjects } from '@infrastructure/persistence/projectSlices'

verifyNetworkRevisions(false)

const DIR = fileURLToPath(new URL('../../public/data/lgv/', import.meta.url))
const read = <T>(name: string): T => JSON.parse(readFileSync(`${DIR}${name}`, 'utf8')) as T

// Trains under the automatic pilot on a real single line of the dataset: the Ligne des Alpes
// between Château-Arnoux, Sisteron, Laragne-Montéglin and Serres. It prints what happened.
//
// Run by hand: PROFILE=1 npx vitest run tools/perf/explore-ligne-des-alpes.test.ts --silent=false
// JOURNEYS="Sisteron>Laragne-Montéglin|Laragne-Montéglin>Sisteron" for other trains (one per « | » ; « ! » before one that stands waiting)
test.runIf(process.env.PROFILE && existsSync(`${DIR}index.json`))('the Ligne des Alpes under the pilot', { timeout: 900_000 }, () => {
  const index = readDatasetIndex(read<unknown>('index.json'))
  const pieces = index.lines.filter((line) => ['ligne-905000-01', 'ligne-905000-02'].includes(line.id))
  const sets = (process.env.JOURNEYS ? [process.env.JOURNEYS] : [
    'Sisteron>Laragne-Montéglin',
    'Sisteron>Laragne-Montéglin|Laragne-Montéglin>Sisteron',
    'Château-Arnoux-Saint-Auban>Sisteron>Laragne-Montéglin>Serres|Serres>Laragne-Montéglin>Sisteron>Château-Arnoux-Saint-Auban',
    'Sisteron>Laragne-Montéglin|Sisteron>Laragne-Montéglin|Laragne-Montéglin>Sisteron',
    'Sisteron>Laragne-Montéglin|!Laragne-Montéglin>Sisteron',
    'Laragne-Montéglin>Sisteron|!Sisteron>Laragne-Montéglin',
  ])
  for (const set of sets) {
    resetMemoryStorage()
    const store = new EditorStore()
    store.loadFromData(unionProjects(pieces.map((line) => read<SerializedProject>(line.file))))
    const net = store.network
    const id = (name: string) => [...net.stations.values()].find((s) => s.name === name)!.id
    // A journey that starts with « ! » is a train that stands where it is set down, its itinerary given: it waits to leave
    const standing = set.split('|').map((j) => j.startsWith('!'))
    const journeys = set.split('|').map((j) => j.replace(/^!/, '').split('>'))
    for (const [from] of journeys) if (!store.placeRakeAtStation(id(from), 'regiolis')) throw new Error(`no room at ${from}`)
    store.togglePlayMode()
    store.trains.forEach((train, i) => {
      for (const name of journeys[i].slice(1)) {
        const refused = addItineraryStop(store, train, id(name))
        if (refused) process.stderr.write(`  T${i + 1}, étape ${name} refusée : ${refused}\n`)
      }
      if (!standing[i]) store.setAutopilot(train.id, true)
    })
    if (process.env.TRACE) store.trains.forEach((train, i) => process.stderr.write(`  T${i + 1} itinéraire : ${train.itinerary?.stations.map((st) => net.stations.get(st)?.name ?? st).join(' → ')} (prochaine ${train.itinerary?.next})\n`))
    const ways = store.trains.map((train) => store.routeGuides.get(train.id)?.guide?.path.length ?? null)
    const roles = [...net.signals.values()].reduce((count, s) => ({ ...count, [s.role]: (count[s.role] ?? 0) + 1 }), {} as Record<string, number>)
    process.stderr.write(`\n${set}\n  ${net.segments.size} rails, signaux ${JSON.stringify(roles)}, niveau ${store.signallingLevel} ; première étape : ${ways.map((w) => (w === null ? '?' : `${(w / 1000).toFixed(1)} km`)).join(', ')}\n`)
    if (process.env.TRACE) {
      // The points and the signals along the way of the first train
      const guide = store.routeGuides.get(store.trains[0].id)!.guide!
      let run = 0
      const marks: string[] = []
      for (const span of guide.path.spans) {
        const rail = net.segments.get(span.segId)!
        const length = segmentPartialLength(net, span.segId, span.t0, span.t1)
        const end = span.t1 >= span.t0 ? rail.to : rail.from
        for (const signal of net.signals.values()) if (signal.segId === span.segId) marks.push(`${((run + segmentPartialLength(net, span.segId, span.t0, signal.t)) / 1000).toFixed(2)}${signal.forward === span.t1 >= span.t0 ? '>' : '<'}${signal.role === 'protection' ? 'C' : 's'}`)
        run += length
        if ([...(net.adjacency.get(end) ?? [])].length >= 3) marks.push(`${(run / 1000).toFixed(2)} AIGUILLE`)
      }
      // Every rail within 400 m of the loop met between 11 and 12,5 km, with its signals
      let at = 0
      const near: { x: number; y: number }[] = []
      for (const span of guide.path.spans) {
        const rail = net.segments.get(span.segId)!
        at += segmentPartialLength(net, span.segId, span.t0, span.t1)
        if (at > 11_300 && at < 12_300) near.push(net.nodes.get(span.t1 >= span.t0 ? rail.to : rail.from)!.pos)
      }
      const onWay = new Set(guide.path.spans.map((sp) => sp.segId))
      for (const rail of net.segments.values()) {
        const a = net.nodes.get(rail.from)!.pos
        const b = net.nodes.get(rail.to)!.pos
        if (!near.some((p) => Math.hypot(p.x - a.x, p.y - a.y) < 30 || Math.hypot(p.x - b.x, p.y - b.y) < 30)) continue
        const signals = [...net.signals.values()].filter((sg) => sg.segId === rail.id).map((sg) => `${sg.role === 'protection' ? 'C' : 's'}@${sg.t.toFixed(2)}${sg.forward ? '→to' : '→from'}`)
        process.stderr.write(`    rail ${rail.id} ${onWay.has(rail.id) ? '(trajet T1)' : '(autre voie)'} ${Math.round(segmentPartialLength(net, rail.id, 0, 1))} m, nœuds ${rail.from}[${[...(net.adjacency.get(rail.from) ?? [])].length}] ${rail.to}[${[...(net.adjacency.get(rail.to) ?? [])].length}], signaux ${signals.join(' ') || 'aucun'}\n`)
      }
      process.stderr.write(`  le long du trajet de T1 (km, > son sens, < sens contraire, C carré, s cantonnement) :\n  ${marks.join('  ')}\n`)
    }
    const arrived = () => store.trains.every((t, i) => standing[i] || !!t.itinerary && t.itinerary.next >= t.itinerary.stations.length && t.currentSpeed === 0)
    let closest = Infinity
    let lastMove = 0
    let t = 0
    const waits = store.trains.map(() => new Map<string, number>())
    for (; t < 3600 && !arrived() && t - lastMove < 200; t += 0.05) {
      store.tickAllTrains(0.05)
      if (store.trains.length > 1 && Math.round(t * 20) % 10 === 0) closest = Math.min(closest, closestBogies(store))
      if (store.trains.some((train) => train.currentSpeed > 0.01)) lastMove = t
      if (process.env.TRACE && Math.round(t * 20) % (20 * 30) === 0) {
        process.stderr.write(`    t ${Math.round(t)} : ` + store.trains.map((train, i) => {
          const left = store.routeGuides.get(train.id)?.left
          const signals = buildTrainConsoleState(store, train).signals
          return `T${i + 1} reste ${left == null ? '?' : (left / 1000).toFixed(2)} km v ${train.currentSpeed.toFixed(1)} ${signals?.next ? `signal ${Math.round(signals.next.distance)} m ${signals.next.color} ${signals.next.cause ?? ''}` : ''}`
        }).join(' | ') + '\n')
      }
      if (Math.round(t * 20) % 20 === 0) {
        store.trains.forEach((train, i) => {
          if (train.currentSpeed > 0.01) return
          const signals = buildTrainConsoleState(store, train).signals
          const why = train.itinerary && train.itinerary.next >= train.itinerary.stations.length ? 'arrivé' : store.autopilots.get(train.id)?.dwell ? 'arrêt en gare' : signals?.next?.cause ?? (signals?.next?.color === 'red' ? 'signal fermé' : 'autre')
          waits[i].set(why, (waits[i].get(why) ?? 0) + 1)
        })
      }
    }
    if (process.env.TRACE) store.trains.forEach((train, i) => {
      const state = store.routeGuides.get(train.id)
      const lead = train.vehicles[0].front
      const spans = state?.guide ? guideAhead(net, state.guide, lead, 1500) : []
      process.stderr.write(`    T${i + 1} sur ${lead.segId}, trajet devant : ${spans.map((sp) => sp.segId).join(' ')} ; aiguille contre : ${state?.against ? `${state.against.nodeId} ${state.against.inSeg}→${state.against.outSeg}` : 'aucune'}\n`)
    })
    const verdict = arrived() ? `tous arrivés en ${Math.round(t)} s` : `BLOQUÉ après ${Math.round(lastMove)} s`
    process.stderr.write(`  ${verdict} ; plus près : ${Number.isFinite(closest) ? `${closest.toFixed(1)} m` : '—'} ; urgence ou déraillement : ${store.trains.some((tr) => tr.emergencyBrake || tr.derailed) ? 'OUI' : 'non'}\n`)
    store.trains.forEach((train, i) => {
      const station = train.itinerary ? net.stations.get(train.itinerary.stations[Math.min(train.itinerary.next, train.itinerary.stations.length - 1)])?.name : '?'
      const where = bogiePoints(store, train)[0]
      const stop = [...net.stations.values()].flatMap((st) => st.stops.map((sp) => ({ st, sp, p: positionOnSegment(net, sp.segId, sp.t)! }))).sort((a, b) => Math.hypot(a.p.x - where.x, a.p.y - where.y) - Math.hypot(b.p.x - where.x, b.p.y - where.y))[0]
      process.stderr.write(`  T${i + 1}${standing[i] ? ' (à l\'arrêt)' : ''} est à ${Math.round(Math.hypot(stop.p.x - where.x, stop.p.y - where.y))} m de ${stop.st.name} voie ${stop.sp.ref ?? '?'}\n`)
      process.stderr.write(`  T${i + 1} ${journeys[i].join(' → ')} : ${train.itinerary && train.itinerary.next >= train.itinerary.stations.length ? 'arrivé' : `en route vers ${station}`} ; à l'arrêt (s) : ${[...waits[i]].map(([why, s]) => `${why} ${s}`).join(', ') || '—'}\n`)
    })
  }
})
