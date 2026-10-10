import { describe, expect, it } from 'vitest'
import { fakeIndex } from './datasetIndex.testkit'
import { EMPTY_PLAN, addStop, formatDownloadSize, formatTrackKm, moveStop, previewJourney, removeStop } from './journeyPlan'

describe('the plan of a journey', () => {
  it('adds, removes and moves stations, never the same one twice', () => {
    let plan = addStop(EMPTY_PLAN, 's1')
    plan = addStop(plan, 's3')
    plan = addStop(plan, 's1')
    expect(plan.stops).toEqual(['s1', 's3'])
    plan = addStop(plan, 's2')
    expect(moveStop(plan, 2, -1).stops).toEqual(['s1', 's2', 's3'])
    expect(moveStop(plan, 0, -1)).toBe(plan)
    expect(moveStop(plan, 2, 1)).toBe(plan)
    expect(removeStop(plan, 1).stops).toEqual(['s1', 's2'])
    expect(removeStop(plan, 7)).toBe(plan)
  })

  it('previews the journey: lines in order, length, size, name', () => {
    const index = fakeIndex()
    expect(previewJourney(index, addStop(EMPTY_PLAN, 's1'))).toBeNull()
    const preview = previewJourney(index, { stops: ['s1', 's2'] })!
    expect(preview.problem).toBeNull()
    expect(preview.lineNames).toEqual(['LGV A', 'LGV B', 'LGV C'])
    expect(preview.lengthLabel).toBe('230 km de voie')
    expect(preview.sizeLabel).toBe('225 ko à télécharger')
    expect(preview.name).toBe('Gare Un → Gare Deux')
    expect(preview.attribution.length).toBe(2)
  })

  it('says why there is no journey', () => {
    const index = fakeIndex()
    expect(previewJourney(index, { stops: ['s1', 'd1'] })!.problem).toBe('Aucun itinéraire sur les lignes à grande vitesse entre Gare Un et Gare Isolée.')
    expect(previewJourney(index, { stops: ['s1', 'zz'] })!.problem).toBe('La gare « zz » n’est pas dans le jeu de données.')
  })

  it('formats lengths and sizes the French way', () => {
    expect(formatTrackKm(1107.6)).toBe('1 108 km de voie')
    expect(formatDownloadSize(500)).toBe('500 o à télécharger')
    expect(formatDownloadSize(2_140_000)).toBe('2,0 Mio à télécharger')
  })
})
