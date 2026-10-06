import { describe, expect, it } from 'vitest'
import type { FleetEntry } from '@application/console/consoleContract'
import { spectatorRows } from './spectatorModel'

const train = (over: Partial<FleetEntry> & { id: string; rank: number }): FleetEntry => ({
  model: 'TGV Duplex',
  locoCount: 2,
  wagonCount: 8,
  speed: 0,
  driven: false,
  ...over,
})

describe('spectator list', () => {
  const fleet = [
    train({ id: 'a', rank: 1, driven: true, speed: 36.6 }),
    train({ id: 'b', rank: 2, speed: 10 }),
    train({ id: 'c', rank: 3, model: 'TGV M', locoCount: 1, wagonCount: 0 }),
  ]

  it('names every train with its consist and its speed in km/h', () => {
    const rows = spectatorRows(fleet, null, false)
    expect(rows.map((r) => r.title)).toEqual(['T1 · TGV Duplex', 'T2 · TGV Duplex', 'T3 · TGV M'])
    expect(rows[2].consist).toBe('1M · 0V')
    expect(rows.map((r) => r.speed)).toEqual(['132 km/h', '36 km/h', '0 km/h'])
  })

  it('tells the train the phone drives from the ones that run and the ones that stand', () => {
    expect(spectatorRows(fleet, null, false).map((r) => r.status)).toEqual(['driven', 'moving', 'stopped'])
  })

  it('a train rolling backwards is moving, and shows a positive speed', () => {
    const [row] = spectatorRows([train({ id: 'a', rank: 1, speed: -5 })], null, false)
    expect(row.status).toBe('moving')
    expect(row.speed).toBe('18 km/h')
  })

  it('the camera follows the driven train unless another one is picked', () => {
    expect(spectatorRows(fleet, null, false).map((r) => r.followed)).toEqual([true, false, false])
    expect(spectatorRows(fleet, 'c', false).map((r) => r.followed)).toEqual([false, false, true])
  })

  it('a picked train that no longer exists gives the camera back to the driven one', () => {
    expect(spectatorRows(fleet, 'gone', false).map((r) => r.followed)).toEqual([true, false, false])
  })

  it('no train is followed in free view', () => {
    expect(spectatorRows(fleet, 'b', true).some((r) => r.followed)).toBe(false)
  })
})
