import { beforeEach, describe, expect, it } from 'vitest'
import { addNode, addSegment, createNetwork, resetIdCounter } from '@domain/models/network'
import type { Network } from '@domain/models/types'
import type { LineAssignment, LineInfo } from './lines'
import { absorbSmallLines, cutIntoPieces } from './pieces'

beforeEach(() => resetIdCounter(0))

/** A straight of `count` rails of `step` metres from x = `from`, at height y; returns the rail ids */
function straight(net: Network, from: number, count: number, step: number, y = 0, start = addNode(net, { x: from, y })): string[] {
  const ids: string[] = []
  let prev = start
  for (let i = 1; i <= count; i++) {
    const next = addNode(net, { x: from + i * step, y })
    ids.push(addSegment(net, prev.id, next.id)!.id)
    prev = next
  }
  return ids
}

const assignmentOf = (groups: Record<string, { rails: string[]; info?: Partial<LineInfo> }>): LineAssignment => {
  const lineOf = new Map<string, string>()
  const lines = new Map<string, LineInfo>()
  for (const [id, { rails, info }] of Object.entries(groups)) {
    lines.set(id, { id, name: id.toUpperCase(), highSpeed: false, ...info })
    for (const rail of rails) lineOf.set(rail, id)
  }
  return { lineOf, lines, unlistedHighSpeedWays: 0 }
}

describe('a line cut into pieces', () => {
  it('gives each rail whole to the cell its middle is in, the pieces named in the order of the map', () => {
    const net = createNetwork()
    // 300 rails of 1 km: three cells of 100 km
    const rails = straight(net, 0, 300, 1000)
    const cut = cutIntoPieces(net, assignmentOf({ ligne: { rails, info: { ref: '830000', category: 'main' } } }), { cellM: 100_000, minRails: 10 })
    expect([...cut.lines.keys()]).toEqual(['ligne-01', 'ligne-02', 'ligne-03'])
    expect(cut.lines.get('ligne-02')).toEqual({ id: 'ligne-02', name: 'LIGNE', highSpeed: false, ref: '830000', category: 'main', partOf: 'ligne' })
    expect(cut.lineOf.size).toBe(300)
    expect(cut.lineOf.get(rails[0])).toBe('ligne-01')
    expect(cut.lineOf.get(rails[99])).toBe('ligne-01')
    expect(cut.lineOf.get(rails[100])).toBe('ligne-02')
    expect(cut.lineOf.get(rails[299])).toBe('ligne-03')
  })

  it('leaves a line that fits one cell whole, under its own id', () => {
    const net = createNetwork()
    const cut = cutIntoPieces(net, assignmentOf({ courte: { rails: straight(net, 1000, 20, 500) } }), { cellM: 100_000, minRails: 10 })
    expect([...cut.lines.keys()]).toEqual(['courte'])
    expect(cut.lines.get('courte')!.partOf).toBe('courte')
  })

  it('gives the crumbs a line leaves in a cell to the neighbouring piece', () => {
    const net = createNetwork()
    // 104 km: four rails over the border of the first cell
    const rails = straight(net, 0, 104, 1000)
    const cut = cutIntoPieces(net, assignmentOf({ ligne: { rails } }), { cellM: 100_000, minRails: 10 })
    expect([...cut.lines.keys()]).toEqual(['ligne'])
    expect(new Set(cut.lineOf.values())).toEqual(new Set(['ligne']))
  })
})

describe('a classic line of a few rails', () => {
  it('goes to the neighbouring line it touches; one listed by hand, or with no neighbour, stays', () => {
    const net = createNetwork()
    const main = straight(net, 0, 100, 100)
    // A stub of three rails off the far end of the main line
    const stub = straight(net, 10_000, 3, 100, 0, [...net.nodes.values()].find((n) => n.pos.x === 10_000)!)
    const apart = straight(net, 0, 3, 100, 5000)
    const approach = straight(net, 0, 3, 100, 9000)
    const absorbed = absorbSmallLines(
      net,
      assignmentOf({
        main: { rails: main, info: { category: 'main' } },
        stub: { rails: stub, info: { category: 'regional' } },
        apart: { rails: apart, info: { category: 'regional' } },
        approach: { rails: approach },
      }),
      60,
    )
    expect([...absorbed.lines.keys()].sort()).toEqual(['apart', 'approach', 'main'])
    for (const rail of stub) expect(absorbed.lineOf.get(rail)).toBe('main')
    expect(absorbed.lineOf.get(apart[0])).toBe('apart')
    expect(absorbed.lineOf.get(approach[0])).toBe('approach')
  })
})
