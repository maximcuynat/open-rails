import { describe, expect, it } from 'vitest'
import { ACTIONS } from '@application/keybindings/keybindings'
import { signalPalette } from './signalPalette'

describe('palette of the signalling mode', () => {
  it('standard level: selection, block signal, path signal, speed limit, deletion', () => {
    const palette = signalPalette('standard')
    expect(palette.badge).toBeNull()
    expect(palette.tools.map((tool) => tool.mode)).toEqual(['select', 'blockSignal', 'pathSignal', 'speedZone', 'delete'])
    expect(palette.tools.map((tool) => tool.label)).toEqual([
      'Sélectionner un signal ou une limite de vitesse',
      'Signal de block',
      'Signal de trajectoire',
      'Limite de vitesse',
      'Supprimer un signal ou une limite de vitesse',
    ])
  })

  it('pro level: a panel of its own, with the French signals and the marker board', () => {
    const palette = signalPalette('pro')
    expect(palette.badge).toBe('PRO')
    expect(palette.title).not.toBe(signalPalette('standard').title)
    expect(palette.tools.map((tool) => tool.mode)).toEqual(['select', 'blockSignal', 'pathSignal', 'cabMarker', 'speedZone', 'delete'])
    const labels = palette.tools.map((tool) => tool.label)
    expect(labels[1]).toMatch(/^Sémaphore/)
    expect(labels[2]).toMatch(/^Carré/)
    expect(labels[3]).toBe('Repère de LGV')
    expect(labels[4]).toBe('Limite de vitesse')
  })

  it('only the deletion is a danger, and every shortcut is a known action', () => {
    const known = new Set<string>(ACTIONS.map((action) => action.id))
    for (const level of ['standard', 'pro'] as const) {
      const { tools } = signalPalette(level)
      expect(tools.filter((tool) => tool.danger).map((tool) => tool.mode)).toEqual(['delete'])
      for (const tool of tools) {
        expect(tool.hint.length).toBeGreaterThan(0)
        if (tool.shortcut) expect(known.has(tool.shortcut)).toBe(true)
      }
      expect(tools.find((tool) => tool.mode === 'blockSignal')?.shortcut).toBe('tool.signalBlock')
      expect(tools.find((tool) => tool.mode === 'pathSignal')?.shortcut).toBe('tool.signalPath')
      expect(tools.find((tool) => tool.mode === 'speedZone')?.shortcut).toBe('tool.speedZone')
    }
  })
})
