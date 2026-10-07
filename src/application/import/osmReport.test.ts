import { describe, expect, it } from 'vitest'
import type { OsmImportIssue, OsmImportReport, OsmSurvey } from '@domain/import/osmTypes'
import { formatBytes, formatDataDate, formatKm, groupIssues, osmSizeWarning, reportFigures, reportNotes, surveyFigures } from './osmReport'

const SURVEY: OsmSurvey = {
  ways: 1192,
  lengthKm: 236.1,
  serviceWays: 735,
  switches: 700,
  bridges: 23,
  tunnels: 319,
  extraKinds: { subway: 99, tram: 57 },
  signals: 256,
  typedMainSignals: 161,
  estimatedRails: 5400,
}

const REPORT: OsmImportReport = {
  nodes: 5100,
  rails: 5412,
  lengthKm: 231.4,
  turnouts: 640,
  doubleSlips: 31,
  fixedCrossings: 12,
  railsOnBridge: 96,
  railsInTunnel: 1340,
  stackedCrossings: 157,
  undecidedCrossings: 9,
  speedZones: 412,
  lengthWithoutSpeedKm: 15.7,
  droppedComponents: 3,
  issues: [],
}

const issue = (kind: OsmImportIssue['kind'], x: number): OsmImportIssue => ({ kind, x, y: 0, osmIds: [x] })

// Narrow no-break spaces of the French number format, written plainly in the expectations
const plain = (text: string) => text.replace(/[  ]/g, ' ')

describe('the count shown before an import', () => {
  it('gives tracks, length, switches, bridges, tunnels and the rails to expect', () => {
    expect(surveyFigures(SURVEY).map((f) => `${plain(f.value)} ${f.label}`)).toEqual([
      '1 192 voies',
      '236 km de voies',
      '700 aiguillages',
      '23 ponts',
      '319 tunnels',
      '≈ 5 400 rails estimés',
    ])
  })

  it('writes one of each in the singular', () => {
    const one = surveyFigures({ ...SURVEY, ways: 1, switches: 1, bridges: 1, tunnels: 0 })
    expect(one.map((f) => f.label)).toEqual(['voie', 'de voies', 'aiguillage', 'pont', 'tunnel', 'rails estimés'])
  })

  it('says nothing up to 2 000 rails', () => {
    expect(osmSizeWarning(0)).toBeNull()
    expect(osmSizeWarning(2000)).toBeNull()
  })

  it('warns above 2 000 rails', () => {
    const warning = osmSizeWarning(2001)
    expect(warning?.level).toBe('warning')
    expect(plain(warning!.text)).toContain('Environ 2 001 rails')
    expect(warning!.text).toContain('plus lentes')
  })

  it('warns strongly above 4 000 rails: slow editing and an autosave that may not fit', () => {
    expect(osmSizeWarning(4000)?.level).toBe('warning')
    const warning = osmSizeWarning(5400)
    expect(warning?.level).toBe('strong')
    expect(warning!.text).toContain('l’édition sera lente')
    expect(warning!.text).toContain('l’enregistrement automatique risque de dépasser')
    expect(warning!.text).toContain('exportez le projet en JSON')
  })
})

describe('the report shown after an import', () => {
  it('gives what was built', () => {
    expect(reportFigures(REPORT).map((f) => `${plain(f.value)} ${f.label}`)).toEqual([
      '5 412 rails',
      '231 km de voies',
      '640 aiguillages',
      '31 traversées-jonctions',
      '12 traversées',
      '412 zones de vitesse',
      '96 rails sur un pont',
      '1 340 rails en tunnel',
    ])
  })

  it('tells the crossings settled by the levels from the undecided ones', () => {
    expect(reportNotes(REPORT)[0]).toBe('157 croisements superposés (une voie passe au-dessus de l’autre), 9 indécis.')
    expect(reportNotes({ ...REPORT, stackedCrossings: 1, undecidedCrossings: 0 })[0]).toBe('1 croisement superposé (une voie passe au-dessus de l’autre), 0 indécis.')
  })

  it('tells what carried no speed and what was left out', () => {
    const notes = reportNotes(REPORT)
    expect(notes[1]).toBe('15,7 km de voie principale sans limite de vitesse dans les données : la vitesse de ligne s’y applique.')
    expect(notes[2]).toBe('3 groupes de voies isolés du réseau principal ont été laissés de côté.')
    expect(reportNotes({ ...REPORT, droppedComponents: 1 })[2]).toBe('Un groupe de voies isolé du réseau principal a été laissé de côté.')
  })

  it('says nothing of what did not happen', () => {
    expect(reportNotes({ ...REPORT, stackedCrossings: 0, undecidedCrossings: 0, lengthWithoutSpeedKm: 0, droppedComponents: 0 })).toEqual([])
  })

  it('groups the issues by kind with their count, what needs a decision first', () => {
    const groups = groupIssues([
      issue('cut-by-area', 1),
      issue('undecided-crossing', 2),
      issue('cut-by-area', 3),
      issue('sharp-angle', 4),
      issue('undecided-crossing', 5),
      issue('uncertain-level', 6),
      issue('unknown-junction', 7),
    ])
    expect(groups.map((g) => [g.title, g.issues.length])).toEqual([
      ['Croisements indécis', 2],
      ['Appareil de voie non reconnu', 1],
      ['Raccord trop anguleux', 1],
      ['Niveau incertain', 1],
      ['Voies coupées par le bord de la zone', 2],
    ])
    expect(groups[0].issues.map((i) => i.x)).toEqual([2, 5])
    expect(groups.every((g) => g.meaning.length > 0)).toBe(true)
  })

  it('keeps a kind of issue it does not know, under its own name', () => {
    const groups = groupIssues([{ ...issue('sharp-angle', 1), kind: 'something-new' as OsmImportIssue['kind'] }])
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('something-new')
  })

  it('has no group when there is no issue', () => {
    expect(groupIssues([])).toEqual([])
  })
})

describe('figures of the import window', () => {
  it('writes lengths with fewer decimals as they grow', () => {
    expect(formatKm(0.6)).toBe('0,60 km')
    expect(formatKm(12.6)).toBe('12,6 km')
    expect(formatKm(236.1)).toBe('236 km')
  })

  it('writes weights in ko and Mo', () => {
    expect(formatBytes(400)).toBe('1 ko')
    expect(formatBytes(88_551)).toBe('89 ko')
    expect(formatBytes(2_521_415)).toBe('2,5 Mo')
    expect(formatBytes(25_000_000)).toBe('25 Mo')
  })

  it('writes the date of the data in full, whatever the time zone of the reader', () => {
    expect(formatDataDate('2026-10-06T23:59:00Z')).toBe('6 octobre 2026')
    expect(formatDataDate('2026-10-06')).toBe('6 octobre 2026')
    expect(formatDataDate('hier')).toBe('hier')
  })
})
