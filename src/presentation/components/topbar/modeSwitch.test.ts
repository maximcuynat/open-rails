import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { modeSwitchView } from './modeSwitch'

function storeWithTrack(): EditorStore {
  const store = new EditorStore()
  const a = addNode(store.network, { x: 0, y: 0 })
  const b = addNode(store.network, { x: 2000, y: 0 })
  addSegment(store.network, a.id, b.id)
  return store
}

describe('the mode switch of the top bar', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
  })

  it('shows building as the mode, and playing out of reach without a train', () => {
    const view = modeSwitchView(storeWithTrack())
    expect([view.build!.active, view.play.active, view.play.disabled, view.status]).toEqual([true, false, true, null])
    expect(view.build!.label).toBe('Édition')
    expect(view.play.title).toBe('Posez un train pour jouer')
  })

  it('follows the game: running, paused, then held once it is left with a train moving', () => {
    const store = storeWithTrack()
    store.placeTrainItem({ x: 500, y: 0 })
    expect(modeSwitchView(store).play.disabled).toBe(false)

    store.togglePlayMode()
    expect([modeSwitchView(store).play.active, modeSwitchView(store).status]).toEqual([true, 'running'])
    store.setPaused(true)
    expect(modeSwitchView(store).status).toBe('paused')

    store.selectedTrain!.currentSpeed = 10
    store.togglePlayMode()
    const held = modeSwitchView(store)
    expect([held.build!.active, held.status]).toEqual([true, 'held'])
    expect(held.play.title).toContain('Reprendre la simulation')

    store.haltAllTrains()
    expect(modeSwitchView(store).status).toBeNull()
    expect(modeSwitchView(store).play.title).toContain('Prendre les commandes')
  })

  it('has no building side on a real network, whose track is locked', () => {
    const store = storeWithTrack()
    store.dataset = { id: 'lgv', lines: [] } as unknown as EditorStore['dataset']
    expect(modeSwitchView(store).build).toBeNull()
  })
})
