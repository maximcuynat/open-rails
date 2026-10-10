import { describe, expect, it } from 'vitest'
import { fakeIndex } from './datasetIndex.testkit'
import { buildLineGraph, connectionsToward, routeBbox, routeThroughStations, shortestLineRoute } from './lineRoute'

describe('the route over the index', () => {
  const index = fakeIndex()
  const graph = buildLineGraph(index)

  it('links the lines through their connections', () => {
    expect([...graph.neighbours.get('a')!].sort()).toEqual(['b', 'e'])
    expect([...graph.neighbours.get('c')!].sort()).toEqual(['b', 'e'])
    expect(graph.neighbours.get('d')!.size).toBe(0)
  })

  it('takes the shortest track from A to C, through B rather than the long link E', () => {
    expect(shortestLineRoute(graph, new Set(['a']), new Set(['c']))).toEqual(['a', 'b', 'c'])
    // With another weight (classic lines nearly free), E is the cheaper way
    expect(shortestLineRoute(graph, new Set(['a']), new Set(['c']), (line) => (line.highSpeed ? 10 : 1))).toEqual(['a', 'e', 'c'])
  })

  it('gives a line in both sets as the whole route, and null when nothing joins them', () => {
    expect(shortestLineRoute(graph, new Set(['a', 'b']), new Set(['b']))).toEqual(['b'])
    expect(shortestLineRoute(graph, new Set(['a']), new Set(['d']))).toBeNull()
    expect(shortestLineRoute(graph, new Set(['zz']), new Set(['a']))).toBeNull()
  })

  it('chains the stations in order and names every line once', () => {
    const route = routeThroughStations(index, ['s1', 's3', 's2'])
    if ('error' in route) throw new Error(route.error)
    expect(route.legs.map((leg) => leg.lines)).toEqual([['a'], ['b', 'c']])
    expect(route.lines).toEqual(['a', 'b', 'c'])
    expect(route.lengthKm).toBe(230)
    expect(route.bytes).toBe(230_000)
    expect(route.bbox).toEqual({ minX: 0, minY: 0, maxX: 23_000, maxY: 1_000 })
  })

  it('says which station is unknown, or where the route breaks', () => {
    expect(routeThroughStations(index, ['s1', 'nowhere'])).toEqual({ error: 'unknown-station', at: 1 })
    expect(routeThroughStations(index, ['s1', 'd1'])).toEqual({ error: 'no-route', at: 1 })
    expect(routeThroughStations(index, ['s1'])).toEqual({ error: 'no-route', at: 1 })
  })

  it('boxes a set of lines', () => {
    expect(routeBbox(index, ['a', 'd'])).toEqual({ minX: 0, minY: 0, maxX: 10_000, maxY: 51_000 })
  })

  it('finds the connections that lead out of the loaded lines', () => {
    expect(connectionsToward(index, new Set(['a']))).toEqual([
      { x: 10_000, y: 500, lines: ['b'] },
      { x: 0, y: 0, lines: ['e'] },
    ])
    expect(connectionsToward(index, new Set(['a', 'b', 'c', 'e']))).toEqual([])
    expect(connectionsToward(index, new Set(['d']))).toEqual([])
  })
})
