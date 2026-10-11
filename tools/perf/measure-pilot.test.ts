import { test } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { buildTrainConsoleState } from '@application/console/consoleState'
import { pilotSpeed } from '@application/console/autopilot'
import { addItineraryStop } from '@application/game/itinerary'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { addStation } from '@domain/models/stations'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'

// How the automatic pilot drives, in figures: how close it holds the speed it aims at, how much it
// moves the handle, how it comes to a platform. On a straight line of rails of 500 m, level or
// with a ramp.
//
// Run by hand: PROFILE=1 npx vitest run tools/perf/measure-pilot.test.ts --silent=false

const RAIL = 500

/** A straight line; `climb` gives the kilometres between which it rises one level per rail (12 ‰) */
function line(km: number, stations: Record<string, number>, climb?: [number, number]) {
  resetMemoryStorage()
  resetIdCounter()
  const store = new EditorStore()
  const net = store.network
  const rails: string[] = []
  let level = 0
  let prev = addNode(net, { x: 0, y: 0 }, level)
  for (let x = RAIL; x <= km * 1000; x += RAIL) {
    if (climb && x > climb[0] * 1000 && x <= climb[1] * 1000) level++
    const next = addNode(net, { x, y: 0 }, level)
    rails.push(addSegment(net, prev.id, next.id)!.id)
    prev = next
  }
  const at = (m: number) => ({ segId: rails[Math.min(rails.length - 1, Math.floor(m / RAIL))], t: (m % RAIL) / RAIL })
  addStation(net, { id: 'depart', name: 'Départ', pos: { x: RAIL, y: 0 }, stops: [at(RAIL + 250)] })
  for (const [id, where] of Object.entries(stations)) addStation(net, { id, name: id, pos: { x: where * 1000, y: 0 }, stops: [at(where * 1000)] })
  store.notify()
  if (!store.placeRakeAtStation('depart', 'duplex')) throw new Error('no rake')
  store.togglePlayMode()
  return store
}

const headX = (store: EditorStore): number => {
  const lead = store.trains[0].vehicles[0].front
  const rail = store.network.segments.get(lead.segId)!
  const a = store.network.nodes.get(rail.from)!.pos.x
  const b = store.network.nodes.get(rail.to)!.pos.x
  return a + (b - a) * lead.t
}

interface Sample { t: number; x: number; v: number; aim: number; notch: number; cylinder: number; brake: string; gradient: number }

/** Drive for `seconds` (20 steps a second), one sample per step */
function drive(store: EditorStore, seconds: number, until: () => boolean = () => false): Sample[] {
  const samples: Sample[] = []
  const train = store.trains[0]
  for (let i = 0; i < seconds * 20 && !until(); i++) {
    store.tickAllTrains(0.05)
    const state = buildTrainConsoleState(store, train)
    samples.push({ t: (i + 1) * 0.05, x: headX(store), v: train.currentSpeed, aim: pilotSpeed(state, { stopIn: null }).speed, notch: train.notch, cylinder: train.brakeCylinder, brake: train.brakeCommand, gradient: state.gradientPermille })
  }
  return samples
}

/** How the handle moved over samples */
function handle(samples: Sample[]) {
  let moves = 0
  let crossings = 0
  let largest = 0
  let side = Math.sign(samples[0]?.notch ?? 0)
  for (let i = 1; i < samples.length; i++) {
    const step = Math.abs(samples[i].notch - samples[i - 1].notch)
    if (step > 0) moves++
    largest = Math.max(largest, step)
    const now = Math.sign(samples[i].notch)
    if (now !== 0 && side !== 0 && now !== side) crossings++
    if (now !== 0) side = now
  }
  const brakeMoves = samples.filter((s, i) => i > 0 && s.brake !== samples[i - 1].brake).length
  // Applying after releasing, or the other way round: the brake hunting for its place
  const pushes = samples.map((s) => s.brake).filter((b, i, all) => b !== 'hold' && b !== all[i - 1])
  const reversals = pushes.filter((b, i) => i > 0 && b !== pushes[i - 1]).length
  return { moves, crossings, largest, 'brake handle moves': brakeMoves, 'brake reversals': reversals }
}

const out = (label: string, figures: Record<string, number | string>): void => {
  process.stderr.write(`${label}: ${Object.entries(figures).map(([k, v]) => `${k} ${typeof v === 'number' ? Math.round(v * 100) / 100 : v}`).join(' · ')}\n`)
}

function cruise(label: string, samples: Sample[]): void {
  const errors = samples.map((s) => s.v - s.aim)
  const braked = samples.filter((s) => s.cylinder > 0.05).length / 20
  out(label, {
    'aim m/s': samples[0].aim,
    'under by at most': -Math.min(...errors),
    'over by at most': Math.max(...errors),
    'mean gap': errors.reduce((a, b) => a + b, 0) / errors.length,
    ...handle(samples),
    'traction↔brake': handle(samples).crossings,
    'air brake s': braked,
    notches: `${Math.min(...samples.map((s) => s.notch))}…${Math.max(...samples.map((s) => s.notch))}`,
  })
}

test.runIf(process.env.PROFILE)('measure the automatic pilot', { timeout: 600_000 }, () => {
  // Level track, no itinerary: two minutes at the line speed
  {
    const store = line(40, {})
    store.trains[0].itinerary = undefined
    store.setAutopilot(store.trains[0].id, true)
    const start = drive(store, 200)
    out('level, start', { 'reaches 95 % of the aim after s': start.find((s) => s.v > 0.95 * s.aim)?.t ?? -1, ...handle(start) })
    cruise('level, cruise 120 s', drive(store, 120))
  }
  // A ramp of 12 ‰ from km 16 to km 22, then level again
  {
    const store = line(40, {}, [16, 22])
    store.trains[0].itinerary = undefined
    store.setAutopilot(store.trains[0].id, true)
    drive(store, 3600, () => headX(store) > 15_000)
    cruise('ramp 12 ‰, km 15 to 24', drive(store, 3600, () => headX(store) > 24_000))
  }
  // To a platform 11,5 km away
  {
    const store = line(14, { arrivee: 12 })
    const train = store.trains[0]
    addItineraryStop(store, train, 'arrivee')
    store.setAutopilot(train.id, true)
    const run = drive(store, 1200, () => train.itinerary!.next === 2 && train.currentSpeed === 0)
    const last = run[run.length - 1]
    const top = Math.max(...run.map((s) => s.v))
    const braking = run.map((s) => s.v >= top - 1.5).lastIndexOf(true)
    const slow = run.filter((s) => s.v < 2 && s.x > 11_000).length / 20
    const tail = run.filter((s) => s.x > 12_000 - 200)
    const decel = run.slice(1).map((s, i) => (run[i].v - s.v) / 0.05)
    out('to a platform', {
      'journey s': last.t,
      'stops at m from the mark': last.x - 12_000,
      'brakes from m before': 12_000 - (run[braking]?.x ?? 0),
      'for s': last.t - (run[braking]?.t ?? 0),
      'air brake at most bar': Math.max(...run.map((s) => s.cylinder)),
      'under 2 m/s for s': slow,
      'traction in the last 200 m (samples)': tail.filter((s) => s.notch > 0).length,
      'strongest braking m/s²': Math.max(...decel),
      ...handle(run),
    })
  }
})
