import { bench, describe } from 'vitest'
import { EditorStore } from './editorStore'
import { addNode, addSegment, hitNode, hitSegment } from '@domain/models/network'
import { snapToNearestTrack } from '@domain/models/locomotive'
import { deserializeNetwork, serializeNetwork } from '@infrastructure/persistence/persistence'
import { networkDerived } from '@infrastructure/render/networkDerived'
import { touchNetwork } from '@domain/models/networkWatch'
import { buildStations, STATION_CENTRE, STATION_PITCH } from '@infrastructure/render/benchNetworks'

/**
 * What the editor pays outside the drawing on a large network: one notification, one mouse move,
 * one committed edit, one undo, one load. Run with `npm run bench`; not part of `npm test`.
 *
 * `SCALE_COPIES` sets the size: the network is that many stations squared (3 → 13 527 rails, the
 * default; 9 → about 122 000 rails).
 */

const copies = Number(process.env.SCALE_COPIES ?? 3)
const net = buildStations(copies)
const store = new EditorStore()
store.network = net
store.markDirty()

/** A point on the track of the middle station, and one in the open beside it */
const middle = Math.floor(copies / 2) * STATION_PITCH
const onTrack = [...net.nodes.values()][Math.floor(net.nodes.size / 2)].pos
const inTheOpen = { x: STATION_CENTRE.x + middle + 5000 * copies, y: STATION_CENTRE.y + middle }

/** Few runs: one of these can take seconds */
const few = { time: 0, iterations: 5, warmupTime: 0, warmupIterations: 1 }
const once = { time: 0, iterations: 2, warmupTime: 0, warmupIterations: 0 }

let edits = 0

describe(`${net.segments.size} rails, outside the drawing`, () => {
  bench('notify, nothing changed', () => {
    store.notify()
  }, few)

  bench('derived data asked again, nothing changed', () => {
    networkDerived(store.network, store.sectionMeta)
  }, few)

  bench('mouse move: node and rail under the cursor', () => {
    const p = { x: onTrack.x + 1.3, y: onTrack.y + 0.7 }
    hitNode(store.network, p, 0.5)
    hitSegment(store.network, p, 0.5)
  }, few)

  bench('mouse move: nearest track', () => {
    snapToNearestTrack(store.network, { x: onTrack.x + 1.3, y: onTrack.y + 0.7 }, 5)
  }, few)

  bench('edit committed: one rail laid in the open', () => {
    const y = inTheOpen.y + edits++ * 10
    const a = addNode(store.network, { x: inTheOpen.x, y })
    const b = addNode(store.network, { x: inTheOpen.x + 30, y })
    addSegment(store.network, a.id, b.id)
    store.reconcileNetwork()
    store.markDirty()
  }, once)

  // What that edit is made of. In the browser the write to storage waits for the edits to pause.
  bench('  of which: track checked for crossings and joins', () => {
    const y = inTheOpen.y + edits++ * 10
    const a = addNode(store.network, { x: inTheOpen.x, y })
    const b = addNode(store.network, { x: inTheOpen.x + 30, y })
    addSegment(store.network, a.id, b.id)
    store.reconcileNetwork()
  }, once)

  bench('  of which: sections and diagnostics worked out again', () => {
    touchNetwork(store.network)
    const y = inTheOpen.y + edits++ * 10
    const a = addNode(store.network, { x: inTheOpen.x, y })
    const b = addNode(store.network, { x: inTheOpen.x + 30, y })
    addSegment(store.network, a.id, b.id)
    networkDerived(store.network, store.sectionMeta).kinematicIssues(store.gauge, store.gradientLimits)
  }, once)

  bench('  of which: undo step recorded', () => {
    store.pushHistorySnapshot(true)
  }, once)

  bench('  of which: project written to storage', () => {
    store.flushPersistedState()
  }, once)

  // Between two steps taken, as the editor takes them, from a track checked for crossings and joins
  bench('undo then redo', () => {
    store.undo()
    store.redo()
  }, { ...once, setup: () => {
    for (let i = 0; i < 2; i++) {
      const y = inTheOpen.y + edits++ * 10
      const a = addNode(store.network, { x: inTheOpen.x, y })
      const b = addNode(store.network, { x: inTheOpen.x + 30, y })
      addSegment(store.network, a.id, b.id)
      store.reconcileNetwork()
      store.markDirty()
    }
  } })

  bench('project read back from its saved form', () => {
    deserializeNetwork(serializeNetwork(store.network, 'bench'))
  }, once)
})
