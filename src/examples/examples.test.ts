import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EXAMPLES } from './index'
import { EditorStore } from '@application/state/editorStore'
import { deserializeNetwork, resetMemoryStorage, type SerializedProject } from '@infrastructure/persistence/persistence'
import { resetIdCounter } from '@domain/models/network'

/** The project file of an example, read from the folder (the app fetches it by URL) */
function readExample(id: string): SerializedProject {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./${id}.json`, import.meta.url)), 'utf8'))
}

describe('example networks', () => {
  beforeEach(() => {
    resetMemoryStorage()
    resetIdCounter()
  })

  it('names every example once', () => {
    const ids = EXAMPLES.map((example) => example.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const example of EXAMPLES) {
      expect(example.label).not.toBe('')
      expect(example.url).toContain(example.id)
    }
  })

  for (const example of EXAMPLES) {
    describe(example.label, () => {
      it('is read as it is written: nothing to weld, cut or drop', () => {
        const data = readExample(example.id)
        const { network } = deserializeNetwork(data)

        expect([...network.nodes.keys()].sort()).toEqual(data.nodes.map((node) => node.id).sort())
        expect([...network.segments.keys()].sort()).toEqual(data.segments.map((seg) => seg.id).sort())
        expect(network.speedZones.size).toBe(data.speedZones?.length ?? 0)
        for (const [nodeId, rails] of network.adjacency) {
          expect(rails.length, `rails at ${nodeId}`).toBeGreaterThan(0)
        }
      })

      it('opens in the editor and comes back out whole', () => {
        const data = readExample(example.id)
        const store = new EditorStore()
        store.loadFromData(data)

        expect(store.projectName).toBe(data.name)
        expect(store.scalePreset).toBe(data.scalePreset)
        const out = store.exportProject()
        expect(out.nodes).toHaveLength(data.nodes.length)
        expect(out.segments).toHaveLength(data.segments.length)
      })
    })
  }

  it('Marseille Saint-Charles has its turnouts and double slips', () => {
    const { network } = deserializeNetwork(readExample('marseille-saint-charles'))
    const kinds = new Map<string, number>()
    for (const junction of network.junctions.values()) kinds.set(junction.kind, (kinds.get(junction.kind) ?? 0) + 1)

    expect(kinds.get('turnout')).toBe(124)
    expect(kinds.get('double_slip')).toBe(20)
  })
})
