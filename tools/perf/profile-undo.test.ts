import { test } from 'vitest'
import { buildStations } from '@infrastructure/render/benchNetworks'
import { networkDerived } from '@infrastructure/render/networkDerived'
import { verifyNetworkRevisions } from '@domain/models/networkWatch'
import { addNode, addSegment } from '@domain/models/network'
import { serializeNetwork } from '@infrastructure/persistence/persistence'
import { EditorStore } from '@application/state/editorStore'
import { isNetworkReconciled } from '@domain/geometry/reconcile'
import { placementThresholds } from '@domain/geometry/scale'

verifyNetworkRevisions(false)

// Run by hand: PROFILE=1 SCALE_COPIES=9 npx vitest run tools/perf/profile-undo.test.ts --silent=false
test.runIf(process.env.PROFILE)('profile undo', { timeout: 600_000 }, () => {
  const time = <T,>(label: string, fn: () => T): T => {
    const t0 = performance.now()
    const r = fn()
    process.stderr.write(`${label}: ${(performance.now() - t0).toFixed(1)} ms\n`)
    return r
  }
  const store = new EditorStore()
  store.network = buildStations(Number(process.env.SCALE_COPIES ?? 9))
  const net = store.network
  const tol = placementThresholds(store.gauge).reconcileTolerance
  time('reconcile first', () => store.reconcileNetwork())
  time('derived first', () => networkDerived(net, store.sectionMeta))
  time('markDirty first', () => store.markDirty())
  let y = 0
  const lay = (): void => {
    const a = addNode(net, { x: -500, y: (y += 10) })
    const b = addNode(net, { x: -470, y })
    addSegment(net, a.id, b.id)
  }
  for (let i = 0; i < 2; i++) {
    lay()
    time('reconcile', () => store.reconcileNetwork())
    time('settle+isReconciled', () => isNetworkReconciled(net, tol))
    time('serialize (snapshot)', () => serializeNetwork(net, 'x', undefined, store.sectionMeta))
    time('pushHistorySnapshot', () => store.pushHistorySnapshot(true))
    time('notify', () => store.notify())
    time('derived', () => networkDerived(net, store.sectionMeta))
  }
  // As in the browser: the write to storage waits for the edits to pause
  store.savePersistedState = () => {}
  time('store.undo()', () => store.undo())
  time('store.redo()', () => store.redo())
  time('store.undo() again', () => store.undo())
  time('store.redo() again', () => store.redo())
  time('markDirty (no save)', () => store.markDirty())
  time('derived after undo', () => networkDerived(net, store.sectionMeta))
  time('flushPersistedState', () => store.flushPersistedState())
})
