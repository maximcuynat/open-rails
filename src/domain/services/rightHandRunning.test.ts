import { beforeEach, describe, expect, it } from 'vitest'
import { inAlsaceMoselle, rightHandArea } from './rightHandRunning'
import { inferKeepLeft } from './runningDirection'
import { addNode, addSegment, createNetwork, resetIdCounter } from '../models/network'
import { runsAgainst } from '../models/running'
import { createLambert93Projection } from '../import/osmProjection'

describe('the area where trains keep to the right', () => {
  it('holds the towns of Moselle, Bas-Rhin and Haut-Rhin, and none of their neighbours', () => {
    const inside: [string, number, number][] = [
      ['Metz', 49.12, 6.18],
      ['Thionville', 49.36, 6.17],
      ['Forbach', 49.19, 6.9],
      ['Sarreguemines', 49.11, 7.07],
      ['Sarrebourg', 48.73, 7.05],
      ['Strasbourg', 48.58, 7.75],
      ['Haguenau', 48.82, 7.79],
      ['Sélestat', 48.26, 7.45],
      ['Colmar', 48.08, 7.36],
      ['Mulhouse', 47.75, 7.34],
    ]
    const outside: [string, number, number][] = [
      ['Nancy', 48.69, 6.18],
      ['Lunéville', 48.59, 6.5],
      ['Saint-Dié', 48.28, 6.95],
      ['Épinal', 48.17, 6.45],
      ['Belfort', 47.64, 6.86],
      ['Longwy', 49.52, 5.76],
      ['Luxembourg', 49.61, 6.13],
      ['Sarrebruck', 49.235, 7.0],
      ['Kehl', 48.57, 7.82],
      ['Bâle', 47.56, 7.59],
      ['Paris', 48.85, 2.35],
    ]
    for (const [name, lat, lon] of inside) expect(inAlsaceMoselle(lat, lon), name).toBe(true)
    for (const [name, lat, lon] of outside) expect(inAlsaceMoselle(lat, lon), name).toBe(false)
  })

  it('is told the same in the frame of a projection', () => {
    const project = createLambert93Projection()
    const area = rightHandArea(project)
    expect(area(project(48.58, 7.75))).toBe(true)
    expect(area(project(48.69, 6.18))).toBe(false)
  })
})

describe('the rule of keeping to one side', () => {
  beforeEach(() => resetIdCounter())

  /** Two parallel tracks 3 km long, 4.5 m apart, both laid eastwards; the north one first */
  function doubleLine() {
    const net = createNetwork()
    const rails = [0, 4.5].map((y) => addSegment(net, addNode(net, { x: 0, y }).id, addNode(net, { x: 3000, y }).id)!)
    return { net, north: rails[0], south: rails[1] }
  }

  it('takes the left track by default and the right one where trains keep right', () => {
    const left = doubleLine()
    inferKeepLeft(left.net)
    // y grows southwards: going east the south track is on the right, so the north one is run east
    expect(runsAgainst(left.north, true)).toBe(false)
    expect(runsAgainst(left.south, true)).toBe(true)

    const right = doubleLine()
    inferKeepLeft(right.net, { keepsRight: () => true })
    expect(runsAgainst(right.north, true)).toBe(true)
    expect(runsAgainst(right.south, true)).toBe(false)
  })
})
