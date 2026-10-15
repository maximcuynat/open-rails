import { EditorStore } from '@application/state/editorStore'
import { applyPassingSiding, computePassingSidingPreview } from '@domain/geometry/constructionTemplates'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { at, signalAt } from '@domain/models/signalling.testkit'
import { addStation } from '@domain/models/stations'
import type { TrainSet } from '@domain/models/train'
import { layAutomaticSignals } from '@domain/services/signalAutoLayout'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'

// A single track with passing loops, for what trains running towards each other do on it: the
// tests of the game and `tools/perf/explore-single-track.test.ts` lay the same line.

/** The signals of the line: none, the six of each loop laid by hand (`exits`, `entries`: only those), with block signals half-way (`block-mid`), or what an import lays (`auto`) */
export type LineSignals = 'none' | 'six' | 'exits' | 'entries' | 'block-mid' | 'auto'

export const LOOP_OFFSET = 3.8

/**
 * A single track along y = 0 from x = 0 to `end`, with a loop `loopLength` m long centred on each
 * of `loops` (a station of that name, a stop on each of its two tracks: the direct one at y = 0,
 * the other at y = `LOOP_OFFSET`). With `railLength` the single track between the loops is laid
 * in rails that long, as an import lays it, instead of one rail.
 */
export function singleTrackLine(loops: Record<string, number>, end: number, signals: LineSignals, loopLength = 600, railLength = Infinity) {
  resetMemoryStorage()
  resetIdCounter()
  const store = new EditorStore()
  const net = store.network
  const centres = Object.values(loops)
  // One rail per loop, single track between them
  const xs = [0, ...centres.flatMap((c, i) => [i === 0 ? null : c - loopLength, i === centres.length - 1 ? null : c + loopLength]).filter((x): x is number => x !== null), end]
  let prev = addNode(net, { x: xs[0], y: 0 })
  xs.slice(1).forEach((x, i) => {
    // Odd stretches are the single track between two loops
    const from = xs[i]
    if (i % 2 === 1) {
      for (let cut = from + railLength; cut < x - 1; cut += railLength) {
        const mid = addNode(net, { x: cut, y: 0 })
        addSegment(net, prev.id, mid.id)
        prev = mid
      }
    }
    const next = addNode(net, { x, y: 0 })
    addSegment(net, prev.id, next.id)
    prev = next
  })
  for (const centre of centres) {
    const preview = computePassingSidingPreview(net, at(net, centre, 0).segId, { x: centre, y: 0 }, loopLength, LOOP_OFFSET)
    if (!preview || !applyPassingSiding(net, preview)) throw new Error(`no loop at ${centre}`)
  }
  for (const [id, centre] of Object.entries(loops)) {
    addStation(net, { id, name: id, pos: { x: centre, y: 0 }, stops: [at(net, centre, 0), at(net, centre, LOOP_OFFSET)] })
  }
  // The ends of a loop, as laid: where its points are
  const ends = (centre: number) => {
    const nodes = [...net.nodes.values()].filter((n) => [...(net.adjacency.get(n.id) ?? [])].length === 3 && Math.abs(n.pos.x - centre) < loopLength * 1.5).map((n) => n.pos.x).sort((a, b) => a - b)
    return { west: nodes[0], east: nodes[nodes.length - 1] }
  }
  const lay = (x: number, y: number, towards: 'east' | 'west', role: 'protection' | 'spacing' = 'protection') => signalAt(net, x, y, towards, role)
  for (const centre of centres) {
    const { west, east } = ends(centre)
    if (signals === 'six' || signals === 'exits' || signals === 'block-mid') {
      // Exit signals: at the end of each track of the loop, before the points
      for (const y of [0, LOOP_OFFSET]) {
        if (east < end - 100) lay(east - 80, y, 'east')
        if (west > 100) lay(west + 80, y, 'west')
      }
    }
    if (signals === 'six' || signals === 'entries' || signals === 'block-mid') {
      // Entry signals: on the single track, before the points
      if (west > 300) lay(west - 150, 0, 'east')
      if (east < end - 300) lay(east + 150, 0, 'west')
    }
  }
  if (signals === 'block-mid') {
    // Block signals half-way down each single track, a pair back to back
    for (let i = 0; i + 1 < centres.length; i++) {
      const x = (centres[i] + centres[i + 1]) / 2
      lay(x, 0, 'east', 'spacing')
      lay(x + 1, 0, 'west', 'spacing')
    }
  }
  store.notify()
  // What an import lays by itself: a path signal before each set of points, block signals in pairs between
  if (signals === 'auto') layAutomaticSignals(net)
  store.notify()
  store.setSignallingSettings({ level: 'standard' })
  return store
}

/** Where the bogies of a train are in the world, the lead one first */
export function bogiePoints(store: EditorStore, train: TrainSet): { x: number; y: number }[] {
  const net = store.network
  return train.vehicles.flatMap((v) => [v.front, v.rear]).map((p) => {
    const rail = net.segments.get(p.segId)!
    const a = net.nodes.get(rail.from)!.pos
    const b = net.nodes.get(rail.to)!.pos
    return { x: a.x + (b.x - a.x) * p.t, y: a.y + (b.y - a.y) * p.t }
  })
}

/** The least distance between a bogie of one train and a bogie of another: 3,8 m side by side in a loop, a car length on one track */
export function closestBogies(store: EditorStore): number {
  const all = store.trains.map((train) => bogiePoints(store, train))
  let gap = Infinity
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) for (const a of all[i]) for (const b of all[j]) gap = Math.min(gap, Math.hypot(a.x - b.x, a.y - b.y))
  return gap
}

/** True once every train has called at the last station of its itinerary and stands there */
export function allArrived(store: EditorStore): boolean {
  return store.trains.every((t) => !!t.itinerary && t.itinerary.next >= t.itinerary.stations.length && t.currentSpeed === 0)
}
