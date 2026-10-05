import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore, SIGNAL_ROW_NO_PATH } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { SIGNAL_REFUSAL_TEXT } from '@domain/models/signals'
import { formatDistance } from '@domain/models/units'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { showToast } from './Toast'
import {
  SIGNAL_DRIVING_REFUSED,
  commitSignalGesture,
  flipSelectedSignal,
  reportSignalToolResult,
  signalRefusalMessage,
  signalRowSpacingChoices,
  signalTypeLabel,
} from './signalActions'

vi.mock('./Toast', () => ({ showToast: vi.fn() }))

/** Track along y = 0 from x = 0 to x = 5000 with points at its end, and a separate track along y = 500 */
function storeWithTracks(): EditorStore {
  const store = new EditorStore()
  const net = store.network
  const a = addNode(net, { x: 0, y: 0 })
  const b = addNode(net, { x: 5000, y: 0 })
  addSegment(net, a.id, b.id)
  addSegment(net, b.id, addNode(net, { x: 6000, y: 0 }).id)
  addSegment(net, b.id, addNode(net, { x: 6000, y: 200 }).id)
  addSegment(net, addNode(net, { x: 0, y: 500 }).id, addNode(net, { x: 5000, y: 500 }).id)
  store.camera.scale = 3
  store.markDirty()
  return store
}

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
  vi.mocked(showToast).mockClear()
})

describe('signal actions', () => {
  it('names a signal at each level', () => {
    expect(signalTypeLabel({ role: 'spacing' }, 'standard')).toBe('Signal de block')
    expect(signalTypeLabel({ role: 'protection' }, 'standard')).toBe('Signal de trajectoire')
    expect(signalTypeLabel({ role: 'spacing' }, 'pro')).toBe('Sémaphore')
    expect(signalTypeLabel({ role: 'protection' }, 'pro')).toBe('Carré')
    expect(signalTypeLabel({ role: 'spacing', cabMarker: true }, 'pro')).toBe('Repère de LGV (F)')
    expect(signalTypeLabel({ role: 'protection', cabMarker: true }, 'pro')).toBe('Repère de LGV (Nf)')
    // The standard level does not know the marker board: it reads the same signal as a plain one
    expect(signalTypeLabel({ role: 'protection', cabMarker: true }, 'standard')).toBe('Signal de trajectoire')
  })

  it('has a message for every refusal', () => {
    expect(signalRefusalMessage('on-switch')).toBe(SIGNAL_REFUSAL_TEXT['on-switch'])
    expect(signalRefusalMessage('driving')).toBe(SIGNAL_DRIVING_REFUSED)
    expect(signalRefusalMessage('no-path')).toBe(SIGNAL_ROW_NO_PATH)
  })

  it('lists the spacings of a row in the unit of the project', () => {
    const store = storeWithTracks()
    expect(signalRowSpacingChoices(store).map((c) => c.value)).toEqual([250, 500, 1000, 1500, 2000, 2500])
    expect(signalRowSpacingChoices(store)[2].label).toBe(formatDistance(1000, store.unit))
  })

  it('says nothing when a signal is laid, and why when it is not', () => {
    const store = storeWithTracks()
    store.setSignalToolSubMode('blockSignal')
    store.beginSignalGesture({ x: 1000, y: -3 })
    commitSignalGesture(store)
    expect(store.network.signals.size).toBe(1)
    expect(showToast).not.toHaveBeenCalled()

    store.beginSignalGesture({ x: 4999.5, y: -3 })
    commitSignalGesture(store)
    expect(store.network.signals.size).toBe(1)
    expect(showToast).toHaveBeenCalledWith(SIGNAL_REFUSAL_TEXT['on-switch'], 'warning')
  })

  it('refuses a row between two tracks that do not meet', () => {
    const store = storeWithTracks()
    store.setSignalToolSubMode('blockSignal')
    store.beginSignalGesture({ x: 1000, y: -3 })
    store.updateSignalGesture({ x: 3000, y: 500 })
    commitSignalGesture(store)
    expect(store.network.signals.size).toBe(0)
    expect(showToast).toHaveBeenCalledWith(SIGNAL_ROW_NO_PATH, 'warning')
  })

  it('tells how many places of a row were skipped', () => {
    reportSignalToolResult({ ok: true, signals: [], refused: 2 })
    expect(vi.mocked(showToast).mock.calls[0][0]).toMatch(/^2 emplacements sautés/)
    vi.mocked(showToast).mockClear()
    reportSignalToolResult({ ok: true, signals: [], refused: 0 })
    reportSignalToolResult(null)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('turns the picked signal round', () => {
    const store = storeWithTracks()
    store.setSignalToolSubMode('blockSignal')
    store.beginSignalGesture({ x: 1000, y: -3 })
    store.commitSignalGesture()
    store.setSignalToolSubMode('select')
    flipSelectedSignal(store)
    const [signal] = [...store.network.signals.values()]
    expect(signal.forward).toBe(true)
    store.selectSignal(signal.id)
    flipSelectedSignal(store)
    expect(signal.forward).toBe(false)
    expect(showToast).not.toHaveBeenCalled()
  })
})
