import { describe, it, expect } from 'vitest'
import type { Point } from '../models/types'
import type { Chain } from './osmGraph'
import { angleDeg, arcPrim, biarc, distance, primDistance, primRails, RAD, rotate, type Prim } from './osmArcs'
import { allowedSpeeds, fitChain, isSinglePiece, type DesignSpeed, type FittedPrim } from './osmFit'

/** A chain through places, as the graph would hand it over */
function chainThrough(pts: Point[]): Chain {
  const stations = [0]
  for (let k = 1; k < pts.length; k++) stations.push(stations[k - 1] + distance(pts[k - 1], pts[k]))
  return { index: 0, nodes: pts.map((_, k) => k + 1), edges: [], forward: [], pts, stations, length: stations[stations.length - 1] }
}

/** The same numbers at every run: the error of the nodes of a track, within ± `size` */
function noise(size: number): () => number {
  let state = 12345
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return (state / 2147483648 - 0.5) * 2 * size
  }
}

/** Places every `step` metres along a track made of straight lines and arcs, each off by up to `error` across the track */
function drawn(parts: { length: number; radius?: number }[], step: number, error = 0): Point[] {
  const jitter = noise(error)
  const pts: Point[] = []
  let p = { x: 0, y: 0 }
  let heading = 0
  let carried = 0
  const put = (): void => {
    const off = jitter()
    pts.push({ x: p.x - Math.sin(heading) * off, y: p.y + Math.cos(heading) * off })
  }
  put()
  for (const part of parts) {
    let left = part.length
    while (left > 1e-9) {
      const d = Math.min(left, step - carried)
      if (part.radius) {
        const turn = d / part.radius
        const chord = 2 * part.radius * Math.sin(turn / 2)
        p = { x: p.x + Math.cos(heading + turn / 2) * chord, y: p.y + Math.sin(heading + turn / 2) * chord }
        heading += turn
      } else {
        p = { x: p.x + Math.cos(heading) * d, y: p.y + Math.sin(heading) * d }
      }
      left -= d
      carried += d
      if (carried >= step - 1e-9) {
        put()
        carried = 0
      }
    }
  }
  if (carried > 1) put()
  return pts
}

/** The primitives meet end to end, each leaving the way the one before arrives */
function expectTangent(prims: FittedPrim[]): void {
  for (let i = 1; i < prims.length; i++) {
    expect(distance(prims[i - 1].p1, prims[i].p0), `gap before piece ${i}`).toBeLessThan(1e-6)
    expect(angleDeg(prims[i - 1].t1, prims[i].t0), `kink before piece ${i}`).toBeLessThan(0.31)
    expect(prims[i].s0).toBeCloseTo(prims[i - 1].s1, 6)
  }
}

const farthest = (prims: Prim[], pts: Point[]): number => Math.max(...pts.map((p) => Math.min(...prims.map((prim) => primDistance(prim, p)))))

describe('arcs', () => {
  it('lays the arc that leaves a place along a direction and reaches another', () => {
    const arc = arcPrim({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })!
    expect(arc.radius).toBeCloseTo(1, 9)
    expect(arc.sweep).toBeCloseTo(Math.PI / 2, 9)
    expect(arc.t1.x).toBeCloseTo(0, 9)
    expect(arc.t1.y).toBeCloseTo(1, 9)
    expect(arc.length).toBeCloseTo(Math.PI / 2, 9)
    // Straight ahead, a line
    expect(arcPrim({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 50, y: 0.05 })).toMatchObject({ sweep: 0, radius: Infinity })
  })

  it('joins two places and two directions with two arcs tangent to both and to each other', () => {
    const t0 = rotate({ x: 1, y: 0 }, 10 * RAD)
    const t1 = rotate({ x: 1, y: 0 }, -25 * RAD)
    const [first, second] = biarc({ x: 0, y: 0 }, t0, { x: 100, y: 5 }, t1)!
    expect(angleDeg(first.t0, t0)).toBeLessThan(1e-9)
    expect(distance(first.p1, second.p0)).toBeLessThan(1e-9)
    expect(angleDeg(first.t1, second.t0)).toBeLessThan(1e-6)
    expect(angleDeg(second.t1, t1)).toBeLessThan(1e-6)
    expect(distance(second.p1, { x: 100, y: 5 })).toBeLessThan(1e-9)
  })

  it('cuts an arc into rails of 15° at most, each with two equal legs', () => {
    const arc = arcPrim({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 100, y: 100 })!
    const rails = primRails(arc)
    expect(rails).toHaveLength(6)
    for (const rail of rails) {
      const a = distance(rail.p0, rail.via!)
      const b = distance(rail.via!, rail.p1)
      expect(Math.abs(a - b) / a).toBeLessThan(1e-9)
      expect(angleDeg({ x: rail.via!.x - rail.p0.x, y: rail.via!.y - rail.p0.y }, { x: rail.p1.x - rail.via!.x, y: rail.p1.y - rail.via!.y })).toBeCloseTo(15, 6)
    }
    expect(distance(rails[5].p1, { x: 100, y: 100 })).toBeLessThan(1e-9)
    expect(primRails(arcPrim({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 100, y: 0 })!)).toEqual([{ p0: { x: 0, y: 0 }, p1: { x: 100, y: 0 }, f0: 0, f1: 1 }])
  })
})

describe('fitting a chain of OSM nodes', () => {
  it('lays one straight rail on a straight track, whatever the error of its nodes', () => {
    const chain = chainThrough(drawn([{ length: 800 }], 20, 0.1))
    const prims = fitChain(chain, null, null, 10, 10, 0.3)
    expect(prims).toHaveLength(1)
    expect(prims[0].sweep).toBe(0)
    expect(prims[0].length).toBeCloseTo(chain.length, 0)
    // A track end is where the line passes the node, not on the node and its error
    expect(distance(prims[0].p0, chain.pts[0])).toBeLessThan(0.3)
    expect(distance(prims[0].p1, chain.pts[chain.pts.length - 1])).toBeLessThan(0.3)
    expect(farthest(prims, chain.pts)).toBeLessThan(0.3)
  })

  it('finds the radius of a curve under the error of its nodes', () => {
    const chain = chainThrough(drawn([{ length: 600, radius: 500 }], 20, 0.1))
    const prims = fitChain(chain, null, null, 10, 10, 0.3)
    expectTangent(prims)
    // One circle from end to end, but for the last metres brought to the end nodes
    const body = prims.filter((prim) => prim.length > 50)
    expect(body.length).toBeGreaterThan(0)
    expect(body.reduce((sum, prim) => sum + prim.length, 0)).toBeGreaterThan(500)
    for (const prim of body) expect(Math.abs(prim.radius - 500) / 500).toBeLessThan(0.05)
    expect(farthest(prims, chain.pts)).toBeLessThan(0.3)
  })

  it('lays a line, a curve and a line where the track is one, with nothing sharper than the curve', () => {
    const chain = chainThrough(drawn([{ length: 300 }, { length: 250, radius: 300 }, { length: 300 }], 20, 0.1))
    const prims = fitChain(chain, null, null, 10, 10, 0.3)
    expectTangent(prims)
    expect(prims.length).toBeLessThanOrEqual(7)
    expect(farthest(prims, chain.pts)).toBeLessThan(0.4)
    // No bend the track does not have: every arc turns the way of the curve, none tighter than it by much
    for (const prim of prims) {
      if (prim.sweep === 0) continue
      expect(prim.sweep).toBeGreaterThan(0)
      expect(prim.radius).toBeGreaterThan(250)
    }
    const curve = prims.filter((prim) => prim.sweep !== 0).reduce((longest, prim) => (prim.length > longest.length ? prim : longest))
    expect(Math.abs(curve.radius - 300) / 300).toBeLessThan(0.05)
    expect(curve.length).toBeGreaterThan(150)
    // …and the lines are lines
    expect(prims[0].sweep).toBe(0)
    expect(prims[prims.length - 1].sweep).toBe(0)
  })

  it('follows a reverse curve without cutting across it', () => {
    const chain = chainThrough(drawn([{ length: 200, radius: 400 }, { length: 200, radius: -400 }], 15, 0.05))
    const prims = fitChain(chain, null, null, 10, 10, 0.3)
    expectTangent(prims)
    expect(farthest(prims, chain.pts)).toBeLessThan(0.4)
    expect(prims.some((prim) => prim.sweep > 0)).toBe(true)
    expect(prims.some((prim) => prim.sweep < 0)).toBe(true)
  })

  it('leaves each end node in the direction imposed there', () => {
    const chain = chainThrough(drawn([{ length: 400 }], 20))
    const leaveStart = rotate({ x: 1, y: 0 }, 3 * RAD)
    const leaveEnd = rotate({ x: -1, y: 0 }, 2 * RAD)
    const prims = fitChain(chain, leaveStart, leaveEnd, 10, 10, 0.3)
    expectTangent(prims)
    expect(angleDeg(prims[0].t0, leaveStart)).toBeLessThan(1e-6)
    expect(angleDeg(prims[prims.length - 1].t1, { x: -leaveEnd.x, y: -leaveEnd.y })).toBeLessThan(0.31)
    // The track is back on its own line between the two ends
    expect(prims.some((prim) => prim.sweep === 0 && prim.length > 250)).toBe(true)
    expect(farthest(prims, chain.pts.slice(4, -4))).toBeLessThan(0.3)
  })

  it('keeps to a long stretch between two nodes: four nodes far apart are not a curve', () => {
    // A bend, 500 m straight between two nodes only, a bend
    const pts = [{ x: 0, y: 0 }, { x: 40, y: 3 }, { x: 80, y: 3 }, { x: 580, y: 3 }, { x: 620, y: 0 }, { x: 660, y: -6 }]
    const prims = fitChain(chainThrough(pts), null, null, 10, 10, 0.3)
    expectTangent(prims)
    for (let x = 100; x <= 560; x += 20) expect(Math.min(...prims.map((prim) => primDistance(prim, { x, y: 3 }))), `at ${x} m`).toBeLessThan(0.5)
  })

  it('lays a short chain as one piece: a line, an arc, or two arcs between the directions of its ends', () => {
    const chain = chainThrough([{ x: 0, y: 0 }, { x: 12, y: 0.2 }, { x: 25, y: 1 }])
    expect(isSinglePiece(chain, 10, 10)).toBe(true)
    expect(isSinglePiece(chainThrough(drawn([{ length: 31 }], 5)), 10, 10)).toBe(false)

    const chord = { x: 25 / Math.hypot(25, 1), y: 1 / Math.hypot(25, 1) }
    const straight = fitChain(chain, chord, { x: -chord.x, y: -chord.y }, 10, 10, 0.3)
    expect(straight).toHaveLength(1)
    expect(straight[0].sweep).toBe(0)

    const one = fitChain(chain, { x: 1, y: 0 }, null, 10, 10, 0.3)
    expect(one).toHaveLength(1)
    expect(one[0].sweep).not.toBe(0)
    expect(angleDeg(one[0].t0, { x: 1, y: 0 })).toBeLessThan(1e-9)

    const two = fitChain(chain, { x: 1, y: 0 }, { x: -1, y: 0 }, 10, 10, 0.3)
    expect(two).toHaveLength(2)
    expectTangent(two)
    expect(angleDeg(two[1].t1, { x: 1, y: 0 })).toBeLessThan(1e-6)
    expect(distance(two[1].p1, { x: 25, y: 1 })).toBeLessThan(1e-9)
  })
})

describe('fitting a track whose speed is known', () => {
  /** A track built for one speed from end to end */
  const builtFor = (speed: number, lineType: DesignSpeed['lineType'] = 'classic'): DesignSpeed => ({ lineType, over: () => speed })
  const slowest = (prims: FittedPrim[], design: DesignSpeed): number => Math.min(...allowedSpeeds(prims, design).map((speed) => speed.allowed))
  const tightest = (prims: FittedPrim[]): number => Math.min(...prims.map((prim) => prim.radius))

  it('tells the speed the editor will allow on each piece: that of its radius, less on a curve too short for its cant', () => {
    const arc = (radius: number, length: number, s0: number): FittedPrim => {
      const prim = arcPrim({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: radius * Math.sin(length / radius), y: radius * (1 - Math.cos(length / radius)) })!
      return { ...prim, s0, s1: s0 + length }
    }
    const line: FittedPrim = { ...arcPrim({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 100, y: 0 })!, s0: 0, s1: 100 }
    const design = builtFor(160)
    // 1 000 m of radius carry 160 km/h with their cant, over a length that leaves room for its ramps
    expect(allowedSpeeds([line, arc(1000, 400, 100)], design)).toEqual([{ allowed: Infinity, wanted: 160 }, { allowed: 160, wanted: 160 }])
    // The same radius over 20 m gets next to no cant, and a joint of 200 m of radius is a crawl
    expect(allowedSpeeds([arc(1000, 20, 0)], design)[0].allowed).toBeLessThan(130)
    expect(allowedSpeeds([arc(200, 20, 0)], design)[0].allowed).toBeLessThanOrEqual(55)
    // Arcs of like radius that follow each other are one curve; a track without a speed is not judged
    expect(allowedSpeeds([arc(1000, 60, 0)], design)[0].allowed).toBeLessThan(160)
    expect(allowedSpeeds([arc(1000, 60, 0), arc(1050, 340, 60)], design).map((speed) => speed.allowed)).toEqual([160, 160])
    expect(allowedSpeeds([arc(200, 20, 0)], { lineType: 'classic', over: () => null })).toEqual([{ allowed: Infinity, wanted: null }])
  })

  it('rounds a curve OSM draws as a broken line, instead of laying its sides and a sharp bend at each node', () => {
    // The line of the Alps south of Clelles (way 180680625), 70 km/h: a curve of some 250 m of
    // radius drawn with a node every 30 to 45 m, turning by 1° at one and by 13° at the next
    const pts = [
      [-405.2, -1830.6], [-468.5, -1713.3], [-531.9, -1597.0], [-545.5, -1569.3], [-561.9, -1541.8], [-580.2, -1514.4], [-600.0, -1490.5], [-622.4, -1472.2],
      [-646.2, -1453.5], [-684.2, -1435.5], [-718.7, -1425.7], [-764.1, -1416.5], [-836.3, -1402.2], [-934.4, -1382.8],
    ].map(([x, y]) => ({ x, y }))
    const chain = chainThrough(pts)
    const design = builtFor(70)

    // Fitted within 30 cm of every node, without a speed: bends of 40 to 60 m of radius
    const tight = fitChain(chain, null, null, 10, 10, 0.3)
    expect(farthest(tight, pts)).toBeLessThan(0.31)
    expect(tightest(tight)).toBeLessThan(80)
    expect(slowest(tight, design)).toBeLessThanOrEqual(25)

    // Built for 70 km/h: a curve, that leaves the nodes it has to by less than a metre
    const round = fitChain(chain, null, null, 10, 10, 0.3, design)
    expectTangent(round)
    expect(tightest(round)).toBeGreaterThan(150)
    expect(slowest(round, design)).toBeGreaterThanOrEqual(55)
    expect(farthest(round, pts)).toBeLessThan(0.9 + 1e-6)
  })

  it('does not lay a jog where two straight stretches of a high-speed line miss each other by decimetres', () => {
    // 300 km/h: a stretch, then another 70 cm to the side from the same node on
    const pts = [[0, 0], [200, 0], [400, 0], [600, 0], [755, 0.3], [930, 0.7], [1100, 0.7], [1300, 0.7], [1500, 0.7]].map(([x, y]) => ({ x, y }))
    const chain = chainThrough(pts)
    const design = builtFor(300, 'highSpeed')
    // Speed known or not, the two are joined over their length and not over 5 m at the node
    expect(tightest(fitChain(chain, null, null, 10, 10, 0.3))).toBeGreaterThan(5000)
    const prims = fitChain(chain, null, null, 10, 10, 0.3, design)
    expectTangent(prims)
    expect(slowest(prims, design)).toBeGreaterThanOrEqual(300)
    expect(farthest(prims, pts)).toBeLessThan(0.5)
  })

  it('leaves a turnout of a fast line by a long gentle piece rather than a short sharp one', () => {
    // 160 km/h, the node asks for a direction 0.6° off the track: the piece that takes it up
    const chain = chainThrough(drawn([{ length: 1200 }], 40, 0.05))
    const leave = rotate({ x: 1, y: 0 }, 0.6 * RAD)
    const design = builtFor(160)
    const prims = fitChain(chain, leave, null, 10, 10, 0.3, design)
    expectTangent(prims)
    expect(angleDeg(prims[0].t0, leave)).toBeLessThan(1e-6)
    expect(slowest(prims, design)).toBeGreaterThanOrEqual(160)
    // Without a speed the same track is laid as before
    expect(slowest(fitChain(chain, leave, null, 10, 10, 0.3), design)).toBeLessThan(160)
  })
})
