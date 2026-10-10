import { describe, expect, it } from 'vitest'
import { mergeReportFigures, mergeReportNotes, type MergeOutcome } from './mergeReport'

const outcome = (over: Partial<MergeOutcome> = {}): MergeOutcome => ({
  nodesAdded: 1200,
  railsAdded: 1500,
  nodesMerged: 3,
  railsDropped: 1,
  stationsAdded: 2,
  stationsMerged: 1,
  junctionsDropped: 0,
  junctionsRebuilt: 0,
  signalsAdded: 0,
  zonesAdded: 0,
  trainsAdded: 0,
  frame: 'same',
  gaugeDiffers: false,
  addedBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  repairs: 0,
  ...over,
})

describe('what a merge says once done', () => {
  it('gives its figures the French way, singular and plural', () => {
    expect(mergeReportFigures(outcome())).toEqual([
      { label: 'rails ajoutés', value: '1 500' },
      { label: 'nœuds communs', value: '3' },
      { label: 'doublon écarté', value: '1' },
      { label: 'gares ajoutées', value: '2' },
    ])
    expect(mergeReportFigures(outcome({ stationsAdded: 0, stationsMerged: 0, repairs: 4 })).map((f) => f.label)).toEqual(['rails ajoutés', 'nœuds communs', 'doublon écarté', 'raccords soudés'])
  })

  it('says what the user should know: no common frame, gauges, stations, tables, and how to go back', () => {
    expect(mergeReportNotes(outcome())).toEqual(['Une gare était déjà dans le projet : ses quais ont été réunis.', 'En cas de conflit, le projet courant est gardé. Ctrl+Z annule la fusion.'])
    const notes = mergeReportNotes(outcome({ frame: 'as-is', gaugeDiffers: true, junctionsRebuilt: 2, trainsAdded: 2, stationsMerged: 0 }))
    expect(notes[0]).toContain('pas de repère géographique commun')
    expect(notes[1]).toContain('écartement')
    expect(notes[2]).toContain('aiguillages')
    expect(notes[3]).toBe('2 trains du fichier ont été ajoutés.')
    expect(mergeReportNotes(outcome({ frame: 'reprojected', stationsMerged: 0 }))[0]).toBe('Le réseau ajouté a été reprojeté dans le repère du projet.')
    expect(mergeReportNotes(outcome({ railsAdded: 0, nodesAdded: 0, stationsMerged: 0 }))[0]).toContain('rien n’a été ajouté')
  })
})
