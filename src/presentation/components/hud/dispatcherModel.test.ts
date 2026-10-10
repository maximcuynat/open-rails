import { describe, expect, it } from 'vitest'
import type { FleetEntry } from '@application/console/consoleContract'
import type { PointsAhead } from '@application/console/dispatcher'
import { dispatcherPointsRows, dispatcherTrainRows } from './dispatcherModel'

const train = (over: Partial<FleetEntry>): FleetEntry => ({ id: 't_1', rank: 1, model: 'TGV Duplex', locoCount: 2, wagonCount: 8, speed: 0, driven: false, driver: null, ...over })

describe('the trains of the dispatcher’s board', () => {
  it('says who drives each train, and which one the camera follows', () => {
    const fleet = [
      train({ id: 'a', rank: 1, speed: 36.7, driven: true, driver: 'host', driverName: 'PC' }),
      train({ id: 'b', rank: 2, speed: 0.02, driven: true, driver: 2, driverName: 'Léa' }),
      train({ id: 'c', rank: 3, driven: true, driver: 3 }),
      train({ id: 'd', rank: 4 }),
    ]
    const rows = dispatcherTrainRows(fleet, 'b', false)
    expect(rows.map((r) => [r.title, r.speed, r.driver, r.held, r.followed])).toEqual([
      ['T1 · TGV Duplex', '132 km/h', 'PC', 'host', false],
      ['T2 · TGV Duplex', 'À l’arrêt', 'Léa', 'desk', true],
      ['T3 · TGV Duplex', 'À l’arrêt', 'Pupitre 3', 'desk', false],
      ['T4 · TGV Duplex', 'À l’arrêt', 'Libre', 'free', false],
    ])
    expect(rows[0].consist).toBe('2M · 8V')
    expect(dispatcherTrainRows(fleet, 'b', true).some((r) => r.followed)).toBe(false)
  })

  it('reads a fleet that names no driver as free trains', () => {
    const old = train({ driven: true })
    delete old.driver
    expect(dispatcherTrainRows([old], null, false)[0]).toMatchObject({ driver: 'Libre', held: 'free' })
  })
})

describe('the points ahead on the dispatcher’s board', () => {
  const ahead = (over: Partial<PointsAhead>): PointsAhead => ({ junctionId: 'j_1', trainRank: 1, distance: 850, branch: 'straight', lock: null, x: 10, y: 20, ...over })

  it('lists them nearest first, each once, with position and lock', () => {
    const rows = dispatcherPointsRows([
      ahead({ junctionId: 'j_2', distance: 3400, branch: 'diverging', lock: 'reserved' }),
      ahead({ junctionId: 'j_1', distance: 850 }),
      ahead({ junctionId: 'j_1', trainRank: 2, distance: 120 }),
      ahead({ junctionId: 'j_3', distance: 9000, branch: null, lock: 'occupied' }),
    ])
    expect(rows.map((r) => [r.junctionId, r.title, r.position, r.lock, r.canThrow])).toEqual([
      ['j_1', 'T2 · 120 m', 'Directe', '', true],
      ['j_2', 'T1 · 3,4 km', 'Déviée', 'Réservé', false],
      ['j_3', 'T1 · 9,0 km', 'Traversée', 'Occupé', false],
    ])
    expect(rows[0]).toMatchObject({ x: 10, y: 20 })
  })

  it('keeps to the nearest few', () => {
    const many = Array.from({ length: 20 }, (_, i) => ahead({ junctionId: `j_${i}`, distance: 100 * (20 - i) }))
    const rows = dispatcherPointsRows(many, 5)
    expect(rows.length).toBe(5)
    expect(rows[0].junctionId).toBe('j_19')
  })
})
