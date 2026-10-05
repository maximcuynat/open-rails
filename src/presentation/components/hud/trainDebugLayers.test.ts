import { describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { TRAIN_DEBUG_LAYERS } from './trainDebugLayers'

describe('TRAIN_DEBUG_LAYERS', () => {
  it('lists every debug option of the store exactly once', () => {
    const store = new EditorStore()
    const listed = TRAIN_DEBUG_LAYERS.map((layer) => layer.key).sort()
    expect(listed).toEqual(Object.keys(store.trainDebugOptions).sort())
  })

  it('gives every layer a label and a hint', () => {
    for (const layer of TRAIN_DEBUG_LAYERS) {
      expect(layer.label).not.toBe('')
      expect(layer.hint).not.toBe('')
    }
  })
})
