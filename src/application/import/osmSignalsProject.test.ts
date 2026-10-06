import { beforeEach, describe, expect, it } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { convertOsm } from '@domain/import/osmImport'
import { along, answer, options, osmNode, osmWay } from '@domain/import/osmImport.testkit'
import type { OsmSignalMode, OsmSignalReport } from '@domain/import/osmTypes'
import { addNode, addSegment, createNetwork, resetIdCounter } from '@domain/models/network'
import { signalReport } from '@domain/models/signalReport'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { buildOsmProject, loadOsmImport } from './osmProject'
import {
  controlNote,
  defaultSignalMode,
  groupIssues,
  realSignalsInArea,
  signalModeHint,
  signalModeOf,
  signalNotes,
  usesAutomaticSignals,
  usesRealSignals,
} from './osmReport'

// Narrow no-break spaces of the French number format, written plainly in the expectations
const plain = (text: string) => text.replace(/[  ]/g, ' ')

const NOW = new Date('2026-10-06T09:30:00Z')

/** 6 km of plain track with a carré at 1 000 m and a sémaphore at 4 000 m, both for the trains that run the way it is drawn */
function converted(signals: OsmSignalMode) {
  const places = along([0, 0], [6000, 0], 100)
  const tags = (value: string) => ({ railway: 'signal', 'railway:signal:direction': 'forward', 'railway:signal:main': value })
  const nodes = places.map(([x, y], i) => osmNode(1 + i, x, y, x === 1000 ? tags('FR:CARRE') : x === 4000 ? tags('FR:S') : undefined))
  return convertOsm(answer(nodes, osmWay(100, places.map((_, i) => 1 + i), { maxspeed: '160' })), options({ signals }))
}

beforeEach(() => {
  resetMemoryStorage()
  resetIdCounter()
})

describe('the signals of an import in the project', () => {
  it('loads the same signals whatever the level, which only says how they are read', () => {
    const roles = (level: 'standard' | 'pro'): string[] => {
      resetIdCounter()
      const store = new EditorStore()
      loadOsmImport(store, converted('real'), { levels: true, now: NOW, signallingLevel: level }, () => {})
      expect(store.signallingLevel).toBe(level)
      return [...store.network.signals.values()].map((signal) => `${signal.role} ${signal.forward} ${signal.t.toFixed(3)}`).sort()
    }
    const standard = roles('standard')
    expect(standard).toHaveLength(2)
    expect(standard.map((line) => line.split(' ')[0])).toEqual(['protection', 'spacing'])
    expect(roles('pro')).toEqual(standard)
  })

  it('is a standard project when no level is given', () => {
    const store = new EditorStore()
    loadOsmImport(store, converted('generated'), { levels: true, now: NOW }, () => {})
    expect(store.signallingLevel).toBe('standard')
    expect(store.network.signals.size).toBe(6)
    expect(buildOsmProject(converted('generated'), { levels: true, now: NOW }).signallingLevel).toBeUndefined()
  })

  it('writes the level and the signals in the project file', () => {
    const project = buildOsmProject(converted('mixed'), { levels: true, now: NOW, signallingLevel: 'pro' })
    expect(project.signallingLevel).toBe('pro')
    expect(project.signals).toHaveLength(2)
    expect(project.signals!.map((signal) => signal.role).sort()).toEqual(['protection', 'spacing'])
  })

  it('undoing brings the previous level back with the previous project', () => {
    const store = new EditorStore()
    const net = createNetwork()
    addSegment(net, addNode(net, { x: 0, y: 0 }).id, addNode(net, { x: 50, y: 0 }).id)
    store.network = net
    store.pushHistorySnapshot()
    loadOsmImport(store, converted('real'), { levels: true, now: NOW, signallingLevel: 'pro' }, () => {})
    expect(store.signallingLevel).toBe('pro')
    store.undo()
    expect(store.signallingLevel).toBe('standard')
    expect(store.network.signals.size).toBe(0)
    store.redo()
    expect(store.signallingLevel).toBe('pro')
    expect(store.network.signals.size).toBe(2)
  })

  it('gives the control report of the loaded project something to say in pro: a block longer than 2 800 m', () => {
    const store = new EditorStore()
    loadOsmImport(store, converted('real'), { levels: true, now: NOW, signallingLevel: 'pro' }, () => {})
    const entries = signalReport(store.network, { level: store.signallingLevel, line: store.lineSettings })
    expect(entries.map((entry) => entry.type)).toEqual(['block-too-long'])
    expect(plain(controlNote(entries, 'pro', store.network.signals.size)!)).toBe(
      'Rapport de contrôle (niveau pro) : 1 canton trop long. Chaque point est marqué sur le plan.',
    )
  })
})

describe('the signal boxes of the import window', () => {
  it('makes one choice of the two boxes', () => {
    expect(signalModeOf(false, false)).toBe('none')
    expect(signalModeOf(false, true)).toBe('generated')
    expect(signalModeOf(true, false)).toBe('real')
    expect(signalModeOf(true, true)).toBe('mixed')
    for (const mode of ['none', 'generated', 'real', 'mixed'] as const) {
      expect(signalModeOf(usesRealSignals(mode), usesAutomaticSignals(mode))).toBe(mode)
    }
  })

  it('proposes the automatic signalling at the standard level, the real signals alone in pro', () => {
    expect(defaultSignalMode('standard')).toBe('generated')
    expect(defaultSignalMode('pro')).toBe('real')
  })

  it('says how many real signals the area holds', () => {
    expect(realSignalsInArea({ usableSignals: 125, typedMainSignals: 160 })).toBe('125 signaux réels dans la zone')
    expect(realSignalsInArea({ usableSignals: 1, typedMainSignals: 1 })).toBe('1 signal réel dans la zone')
    expect(realSignalsInArea({ usableSignals: 0, typedMainSignals: 3 })).toBe('aucun signal réel dans la zone')
    // A count made before the import knew how to read them
    expect(realSignalsInArea({ typedMainSignals: 161 })).toBe('161 signaux réels dans la zone')
  })

  it('warns that real signals alone give nothing where the area holds none', () => {
    const empty = { usableSignals: 0, typedMainSignals: 0 }
    expect(signalModeHint('real', empty)).toContain('sans signal')
    expect(signalModeHint('mixed', empty)).toContain('seule la signalisation automatique')
    expect(signalModeHint('real', { usableSignals: 125, typedMainSignals: 160 })).toContain('rapport de contrôle')
    expect(signalModeHint('real', null)).toContain('rapport de contrôle')
    expect(signalModeHint('none', null)).toContain('sans signal')
    expect(signalModeHint('generated', null)).toContain('avant chaque aiguillage')
  })
})

describe('the signal lines of the report', () => {
  const PARIS: OsmSignalReport = {
    mode: 'mixed',
    found: 252,
    real: { protection: 106, spacing: 19, cabMarkers: 0 },
    realMoved: 6,
    skipped: { 'track-not-imported': 1, 'no-direction': 2 },
    ignored: { speed: 61, shunting: 42, untyped: 12, other: 10, unknown: 1 },
    generated: { protection: 641, spacing: 2, cabMarkers: 0 },
    stretchesLeftToReal: 90,
  }

  it('tells the real signals laid by role, the ones not laid and why, the ones left aside, then the generated ones', () => {
    expect(signalNotes(PARIS).map(plain)).toEqual([
      '125 signaux réels posés : 106 de protection, 19 d’espacement. 6 ont été écartés de deux mètres d’un aiguillage.',
      '3 signaux réels non posés : 2 sans sens de circulation, 1 sur une voie non importée.',
      '126 autres signaux laissés de côté : 61 de vitesse, 42 de manœuvre, 12 sans type, 10 d’un autre genre, 1 de type inconnu.',
      '643 signaux posés par la signalisation automatique : 641 de protection, 2 d’espacement.',
      '90 portions de voie laissées aux signaux réels qu’elle porte.',
    ])
  })

  it('says so when the area holds no usable real signal', () => {
    const none: OsmSignalReport = { ...PARIS, mode: 'real', real: { protection: 0, spacing: 0, cabMarkers: 0 }, realMoved: 0, skipped: {}, ignored: { untyped: 9 } }
    expect(signalNotes(none).map(plain)).toEqual(['Aucun signal réel utilisable dans les données de cette zone.', '9 autres signaux laissés de côté : 9 sans type.'])
  })

  it('counts the marker boards of a high-speed line among the generated signals', () => {
    const lgv: OsmSignalReport = { mode: 'generated', found: 0, real: { protection: 0, spacing: 0, cabMarkers: 0 }, realMoved: 0, skipped: {}, ignored: {}, generated: { protection: 29, spacing: 44, cabMarkers: 66 }, stretchesLeftToReal: 0 }
    expect(signalNotes(lgv).map(plain)).toEqual(['73 signaux posés par la signalisation automatique : 29 de protection, 44 d’espacement, dont 66 repères de ligne à grande vitesse.'])
  })

  it('says nothing was asked with `none`, and nothing at all of a report without signals', () => {
    expect(signalNotes({ ...PARIS, mode: 'none' })).toEqual(['Aucun signal posé : la signalisation n’était pas demandée.'])
    expect(signalNotes(undefined)).toEqual([])
  })

  it('sums up the control report, the most frequent first', () => {
    const entries = [{ type: 'block-too-short' as const }, { type: 'block-too-long' as const }, { type: 'block-too-long' as const }, { type: 'unprotected-switch' as const }]
    expect(plain(controlNote(entries, 'pro', 125)!)).toBe(
      'Rapport de contrôle (niveau pro) : 2 cantons trop longs, 1 canton trop court pour s’arrêter, 1 aiguillage sans signal de protection. Chaque point est marqué sur le plan.',
    )
    expect(controlNote([], 'standard', 10)).toBe('Rapport de contrôle (niveau standard) : rien à signaler.')
    expect(controlNote([], 'standard', 0)).toBeNull()
  })

  it('lists the real signals that could not be laid among the places to check', () => {
    const groups = groupIssues([
      { kind: 'cut-by-area', x: 0, y: 0, osmIds: [1] },
      { kind: 'signal-not-placed', x: 0, y: 0, osmIds: [2] },
      { kind: 'signal-not-placed', x: 0, y: 0, osmIds: [3] },
    ])
    expect(groups.map((group) => [group.title, group.issues.length])).toEqual([
      ['Signaux réels non posés', 2],
      ['Voie coupée par le bord de la zone', 1],
    ])
  })
})
