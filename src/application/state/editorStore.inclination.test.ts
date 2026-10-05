import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from './editorStore'
import { deserializeNetwork, resetMemoryStorage } from '@infrastructure/persistence/persistence'

beforeEach(() => resetMemoryStorage())

describe('display of cant and slopes (Affichage ▸ Dévers et pentes)', () => {
  it('is on by default and leaves a project as it was written before', () => {
    const store = new EditorStore()
    expect(store.showInclination).toBe(true)
    const project = store.exportProject()
    expect('hideInclination' in JSON.parse(JSON.stringify(project))).toBe(false)
  })

  it('is unticked and ticked again, and notifies the views', () => {
    const store = new EditorStore()
    let notified = 0
    store.subscribe(() => { notified++ })
    store.toggleInclination()
    expect(store.showInclination).toBe(false)
    expect(notified).toBe(1)
    store.toggleInclination()
    expect(store.showInclination).toBe(true)
  })

  it('is saved with the project and read back', () => {
    const store = new EditorStore()
    store.toggleInclination()
    expect(store.exportProject().hideInclination).toBe(true)
    expect(deserializeNetwork(JSON.parse(JSON.stringify(store.exportProject()))).hideInclination).toBe(true)
    // Autosaved on the spot: a new session finds it hidden
    expect(new EditorStore().showInclination).toBe(false)

    const other = new EditorStore()
    other.loadFromData(JSON.parse(JSON.stringify(store.exportProject())))
    expect(other.showInclination).toBe(false)
    // A file that does not say shows the marks; anything but `true` is ignored
    const plain = JSON.parse(JSON.stringify(store.exportProject()))
    delete plain.hideInclination
    other.loadFromData(plain)
    expect(other.showInclination).toBe(true)
    other.loadFromData({ ...plain, hideInclination: 'yes' })
    expect(other.showInclination).toBe(true)
  })

  it('a new project shows the marks again', () => {
    const store = new EditorStore()
    store.toggleInclination()
    store.newProject()
    expect(store.showInclination).toBe(true)
  })

  it('does not take an undo step', () => {
    const store = new EditorStore()
    const before = store.canUndo
    store.toggleInclination()
    expect(store.canUndo).toBe(before)
  })
})
