import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { selectionSummary, zoomPercent } from './StatusBar'

beforeEach(() => {
  resetIdCounter(0)
  resetMemoryStorage()
})

describe('StatusBar content', () => {
  it('summarises the selection in French, with plurals', () => {
    const store = new EditorStore()
    expect(selectionSummary(store)).toBe('Aucune sélection')
    store.selection = { nodes: new Set(), segments: new Set(['s_1']) }
    expect(selectionSummary(store)).toBe('1 rail sélectionné')
    store.selection = { nodes: new Set(['n_1', 'n_2']), segments: new Set(['s_1']) }
    expect(selectionSummary(store)).toBe('1 rail, 2 nœuds sélectionnés')
  })

  it('shows the zoom relative to the default zoom of the scale', () => {
    const store = new EditorStore()
    store.camera.scale = 2.5
    expect(zoomPercent(store)).toBe(100)
    store.camera.scale = 5
    expect(zoomPercent(store)).toBe(200)
    store.setScalePreset('HO', false)
    store.camera.scale = 350
    expect(zoomPercent(store)).toBe(100)
  })
})
