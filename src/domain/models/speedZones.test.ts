import { beforeEach, describe, expect, it } from 'vitest'
import {
  addCurveSegment,
  addNode,
  addSegment,
  createNetwork,
  dissolveNode,
  removeDuplicateSegments,
  removeNode,
  removeSegment,
  replaceRail,
  resetIdCounter,
  setNodesLevel,
  syncIdCounter,
  generateId,
} from './network'
import { placeTurnout, splitSegment, weldNodes } from './junction'
import { separateLevelsAtNode } from './crossing'
import { reconcileNetworkIntersections, splitSegmentAtNode } from '../geometry/reconcile'
import { performTrackCut } from '../geometry/constructionTemplates'
import { addSpeedZone, cleanSpeedZones, invalidateSpeedZones, isValidZoneSpeed, normalizeZoneSpeed, removeSpeedZone, restoreSpeedZone, setSpeedZoneSpeed, speedZoneIndex, speedZonesAt, speedZonesOnRail, speedZonesRevision, splitSpeedZonesBy, tidyTrackSpans } from './speedZones'
import {
  duplicateReplacement,
  mergeReplacements,
  onRailReplaced,
  remapTrackPosition,
  remapTrackSpan,
  remapTrackSpanParts,
  removalReplacement,
  splitReplacement,
  type RailReplacement,
} from './trackObjects'
import { addSpeedZoneBetween, speedZoneEnds, speedZoneLength } from '../services/speedZoneLayout'
import { snapToNearestTrack } from './locomotive'
import type { Network, Point, Segment, SpeedZone } from './types'
import { networkChanged } from '@domain/models/networkWatch'

beforeEach(() => resetIdCounter(0))

const seg = (id: string, from: string, to: string): Segment => ({ id, from, to, kind: 'straight' })

/** The place of the track nearest to a world point, as a zone end */
function at(net: Network, x: number, y = 0) {
  const hit = snapToNearestTrack(net, { x, y }, 0.5)
  if (!hit) throw new Error(`no track at ${x}, ${y}`)
  return { segId: hit.segId, t: hit.t }
}

/** A straight track along y = 0 through the given abscissas, one rail between each pair */
function line(net: Network, xs: number[]) {
  const nodes = xs.map((x) => addNode(net, { x, y: 0 }))
  const rails = nodes.slice(1).map((node, i) => addSegment(net, nodes[i].id, node.id)!)
  return { nodes, rails }
}

function expectNear(p: Point, q: Point, tolerance = 0.01): void {
  expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(tolerance)
}

/** The zone still runs from `a` to `b` (within 1 cm) over `length` metres, on rails that exist */
function expectZone(net: Network, zone: SpeedZone, a: Point, b: Point, length: number): void {
  expect(net.speedZones.get(zone.id)).toBe(zone)
  for (const span of zone.spans) expect(net.segments.has(span.segId)).toBe(true)
  const ends = speedZoneEnds(net, zone)!
  expectNear(ends.a, a)
  expectNear(ends.b, b)
  expect(speedZoneLength(net, zone)).toBeCloseTo(length, 6)
}

/** 1000 m of straight track with a 500 m zone at 90 km/h from x = 250 to x = 750 */
function trackWithZone() {
  const net = createNetwork()
  const { nodes, rails } = line(net, [0, 1000])
  const zone = addSpeedZoneBetween(net, at(net, 250), at(net, 750), 90)!
  return { net, nodes, rail: rails[0], zone }
}

const A = { x: 250, y: 0 }
const B = { x: 750, y: 0 }

describe('remapping a stretch or a position through a rail replacement', () => {
  const cut = splitReplacement(seg('old', 'a', 'b'), 0.4, seg('s1', 'a', 'm'), seg('s2', 'm', 'b'))

  it('a stretch on another rail comes back as it is', () => {
    const span = { segId: 'other', t0: 0.1, t1: 0.9 }
    expect(remapTrackSpan(span, cut)).toEqual([span])
    expect(remapTrackPosition({ segId: 'other', t: 0.3, forward: true }, cut)).toEqual({ segId: 'other', t: 0.3, forward: true })
  })

  it('a stretch on one side of a cut lands on that piece', () => {
    expect(remapTrackSpan({ segId: 'old', t0: 0.1, t1: 0.2 }, cut)).toEqual([{ segId: 's1', t0: 0.25, t1: 0.5 }])
    const [after] = remapTrackSpan({ segId: 'old', t0: 0.7, t1: 1 }, cut)
    expect(after.segId).toBe('s2')
    expect(after.t0).toBeCloseTo(0.5, 12)
    expect(after.t1).toBe(1)
  })

  it('a stretch that straddles the cut becomes two, in the order it is walked', () => {
    const forward = remapTrackSpan({ segId: 'old', t0: 0.2, t1: 0.7 }, cut)
    expect(forward.map((s) => s.segId)).toEqual(['s1', 's2'])
    expect(forward[0].t0).toBeCloseTo(0.5, 12)
    expect(forward[0].t1).toBe(1)
    expect(forward[1].t0).toBe(0)
    expect(forward[1].t1).toBeCloseTo(0.5, 12)

    const backward = remapTrackSpan({ segId: 'old', t0: 0.7, t1: 0.2 }, cut)
    expect(backward.map((s) => s.segId)).toEqual(['s2', 's1'])
    expect(backward[0].t0).toBeCloseTo(0.5, 12)
    expect(backward[0].t1).toBe(0)
    expect(backward[1].t0).toBe(1)
    expect(backward[1].t1).toBeCloseTo(0.5, 12)
  })

  it('a stretch ending at the cut does not spill onto the other piece', () => {
    expect(remapTrackSpan({ segId: 'old', t0: 0, t1: 0.4 }, cut)).toEqual([{ segId: 's1', t0: 0, t1: 1 }])
    expect(remapTrackSpan({ segId: 'old', t0: 1, t1: 0.4 }, cut)).toEqual([{ segId: 's2', t0: 1, t1: 0 }])
  })

  it('a half that already lay there the other way round is followed in its own direction', () => {
    const reused = splitReplacement(seg('old', 'a', 'b'), 0.4, seg('s1', 'm', 'a'), seg('s2', 'b', 'm'))
    const spans = remapTrackSpan({ segId: 'old', t0: 0, t1: 1 }, reused)
    expect(spans).toEqual([
      { segId: 's1', t0: 1, t1: 0 },
      { segId: 's2', t0: 1, t1: 0 },
    ])
  })

  it('a position follows the cut and keeps facing the same way', () => {
    expect(remapTrackPosition({ segId: 'old', t: 0.2, forward: true }, cut)).toEqual({ segId: 's1', t: 0.5, forward: true })
    const pos = remapTrackPosition({ segId: 'old', t: 0.7, forward: false }, cut)!
    expect(pos.segId).toBe('s2')
    expect(pos.t).toBeCloseTo(0.5, 12)
    expect(pos.forward).toBe(false)
  })

  it('a merge places each rail on its share of the length, whatever the orientations', () => {
    // a —(300 m)— m —(700 m)— b, merged into a rail from a to b
    const merged = seg('new', 'a', 'b')
    const [r1, r2] = mergeReplacements(seg('s1', 'a', 'm'), 300, seg('s2', 'm', 'b'), 700, 'm', merged)
    expect(remapTrackSpan({ segId: 's1', t0: 0, t1: 1 }, r1)).toEqual([{ segId: 'new', t0: 0, t1: 0.3 }])
    expect(remapTrackSpan({ segId: 's2', t0: 0, t1: 1 }, r2)).toEqual([{ segId: 'new', t0: 0.3, t1: 1 }])
    const half = remapTrackSpan({ segId: 's2', t0: 0, t1: 0.5 }, r2)[0]
    expect(half.t1).toBeCloseTo(0.65, 12)

    // Same track, both old rails laid the other way round and the merged rail from b to a
    const [q1, q2] = mergeReplacements(seg('s1', 'm', 'a'), 300, seg('s2', 'b', 'm'), 700, 'm', seg('new', 'b', 'a'))
    const first = remapTrackSpan({ segId: 's1', t0: 0, t1: 1 }, q1)[0] // from m to a
    expect(first.t0).toBeCloseTo(0.7, 12)
    expect(first.t1).toBeCloseTo(1, 12)
    const second = remapTrackSpan({ segId: 's2', t0: 0, t1: 1 }, q2)[0] // from b to m
    expect(second.t0).toBeCloseTo(0, 12)
    expect(second.t1).toBeCloseTo(0.7, 12)
    // A position looking from m towards a on s1 (forward) still looks towards a on the merged rail
    expect(remapTrackPosition({ segId: 's1', t: 0.5, forward: true }, q1)).toEqual({ segId: 'new', t: 0.85, forward: true })
    // On the first layout, s1 reversed against a merged rail a → b flips `forward`
    const [f1] = mergeReplacements(seg('s1', 'm', 'a'), 300, seg('s2', 'm', 'b'), 700, 'm', merged)
    const flipped = remapTrackPosition({ segId: 's1', t: 0.5, forward: true }, f1)!
    expect(flipped.t).toBeCloseTo(0.15, 12)
    expect(flipped.forward).toBe(false)
  })

  it('a dropped duplicate hands over to the survivor, turned round when it runs the other way', () => {
    const same = duplicateReplacement(seg('dup', 'a', 'b'), seg('keep', 'a', 'b'))
    expect(remapTrackSpan({ segId: 'dup', t0: 0.2, t1: 0.6 }, same)).toEqual([{ segId: 'keep', t0: 0.2, t1: 0.6 }])
    const turned = duplicateReplacement(seg('dup', 'a', 'b'), seg('keep', 'b', 'a'))
    expect(remapTrackSpan({ segId: 'dup', t0: 0.2, t1: 0.6 }, turned)).toEqual([{ segId: 'keep', t0: 0.8, t1: 0.4 }])
    expect(remapTrackPosition({ segId: 'dup', t: 0.2, forward: true }, turned)).toEqual({ segId: 'keep', t: 0.8, forward: false })
  })

  it('a removed rail takes its stretches and positions with it', () => {
    const gone = removalReplacement('old')
    expect(remapTrackSpan({ segId: 'old', t0: 0.2, t1: 0.6 }, gone)).toEqual([])
    expect(remapTrackSpanParts({ segId: 'old', t0: 0.2, t1: 0.6 }, gone)).toEqual([null])
    expect(remapTrackPosition({ segId: 'old', t: 0.2, forward: true }, gone)).toBeNull()
  })
})

describe('the rail replacement passage', () => {
  it('splitSegment reports the parameter it cut at and tells the listeners', () => {
    const net = createNetwork()
    const { rails } = line(net, [0, 1000])
    const seen: RailReplacement[] = []
    const stop = onRailReplaced(net, (_net, replacement) => seen.push(replacement))

    const res = splitSegment(net, rails[0].id, { x: 300, y: 7 })!
    expect(res.t).toBeCloseTo(0.3, 12)
    expect(seen).toHaveLength(1)
    expect(seen[0].oldId).toBe(rails[0].id)
    expect(seen[0].pieces).toEqual([
      { segId: res.seg1.id, from: 0, to: res.t, start: 0, end: 1 },
      { segId: res.seg2.id, from: res.t, to: 1, start: 0, end: 1 },
    ])

    stop()
    splitSegment(net, res.seg1.id, { x: 100, y: 0 })
    expect(seen).toHaveLength(1)
  })

  it('reports the real cut of a curve, where the split point is projected', () => {
    const net = createNetwork()
    const a = addNode(net, { x: 0, y: 0 })
    const b = addNode(net, { x: 200, y: 200 })
    const curve = addCurveSegment(net, a.id, b.id, { x: 200, y: 0 })!
    const res = splitSegment(net, curve.id, { x: 150, y: 50 })!
    expect(res.t).toBe(0.5)
    expectNear(res.midNode.pos, { x: 150, y: 50 }, 1e-9)
  })

  it('every way a rail disappears goes through it', () => {
    const net = createNetwork()
    const { nodes, rails } = line(net, [0, 100, 200, 300, 400])
    const seen: string[] = []
    onRailReplaced(net, (_net, r) => seen.push(`${r.oldId}:${r.pieces.length}`))

    const lone = addNode(net, { x: 50, y: 0 })
    splitSegmentAtNode(net, rails[0].id, lone.id)
    expect(seen).toEqual([`${rails[0].id}:2`])

    seen.length = 0
    dissolveNode(net, nodes[2].id)
    expect(seen).toEqual([`${rails[1].id}:1`, `${rails[2].id}:1`])

    seen.length = 0
    removeSegment(net, rails[3].id)
    expect(seen).toEqual([`${rails[3].id}:0`])

    seen.length = 0
    const doomed = [...(net.adjacency.get(lone.id) ?? [])]
    removeNode(net, lone.id)
    expect(seen).toEqual(doomed.map((id) => `${id}:0`))
  })

  it('the route tables still follow a cut rail', () => {
    const net = createNetwork()
    const { nodes, rails } = line(net, [0, 100])
    const turnout = placeTurnout(net, { startPos: { x: 100, y: 0 }, direction: { x: 1, y: 0 }, frogNumber: 6, hand: 'left', stemNodeId: nodes[1].id })
    const junction = turnout.junction!
    expect(junction.passages[0].a).toBe(rails[0].id)
    const res = splitSegment(net, rails[0].id, { x: 40, y: 0 })!
    // The table names the piece that touches its node
    expect(junction.passages.map((p) => p.a)).toEqual([res.seg2.id, res.seg2.id])
  })
})

describe('speed zones', () => {
  it('accepts multiples of 10 km/h from 10 up, and rounds what it is given', () => {
    expect(isValidZoneSpeed(10)).toBe(true)
    expect(isValidZoneSpeed(320)).toBe(true)
    expect(isValidZoneSpeed(0)).toBe(false)
    expect(isValidZoneSpeed(95)).toBe(false)
    expect(isValidZoneSpeed('90')).toBe(false)
    expect(isValidZoneSpeed(NaN)).toBe(false)
    expect(normalizeZoneSpeed(94)).toBe(90)
    expect(normalizeZoneSpeed(96)).toBe(100)
    expect(normalizeZoneSpeed(3)).toBe(10)
    expect(normalizeZoneSpeed(-50)).toBe(10)
  })

  it('creates, changes and removes a zone', () => {
    const { net, rail, zone } = trackWithZone()
    expect(zone.id).toMatch(/^z_\d+$/)
    expect(zone.speed).toBe(90)
    expect(zone.spans).toEqual([{ segId: rail.id, t0: 0.25, t1: 0.75 }])
    expect(speedZoneLength(net, zone)).toBeCloseTo(500, 9)

    expect(setSpeedZoneSpeed(net, zone.id, 124)).toBe(true)
    expect(zone.speed).toBe(120)
    expect(setSpeedZoneSpeed(net, 'z_nope', 60)).toBe(false)

    expect(removeSpeedZone(net, zone.id)).toBe(true)
    expect(net.speedZones.size).toBe(0)
    expect(removeSpeedZone(net, zone.id)).toBe(false)
  })

  it('refuses a zone that covers nothing or is not on the track', () => {
    const { net, rail } = trackWithZone()
    expect(addSpeedZone(net, [], 90)).toBeNull()
    expect(addSpeedZone(net, [{ segId: rail.id, t0: 0.5, t1: 0.5 }], 90)).toBeNull()
    expect(addSpeedZone(net, [{ segId: 's_nope', t0: 0, t1: 1 }], 90)).toBeNull()
    expect(addSpeedZone(net, [{ segId: rail.id, t0: 0, t1: 1.5 }], 90)).toBeNull()
    expect(addSpeedZoneBetween(net, at(net, 400), at(net, 400), 90)).toBeNull()
    expect(net.speedZones.size).toBe(1)
  })

  it('keeps the A → B order when the zone is laid against the direction of the rail', () => {
    const { net, rail } = trackWithZone()
    const back = addSpeedZoneBetween(net, at(net, 600), at(net, 100), 60)!
    expect(back.spans).toEqual([{ segId: rail.id, t0: 0.6, t1: 0.1 }])
    expectNear(speedZoneEnds(net, back)!.a, { x: 600, y: 0 })
    expectNear(speedZoneEnds(net, back)!.b, { x: 100, y: 0 })
  })

  it('tidies stretches: none of no length, neighbours on one rail made one', () => {
    expect(
      tidyTrackSpans([
        { segId: 'a', t0: 0.2, t1: 1 },
        { segId: 'b', t0: 0, t1: 0 },
        { segId: 'b', t0: 0, t1: 0.4 },
        { segId: 'b', t0: 0.4, t1: 1 },
        { segId: 'c', t0: 1, t1: 0.5 },
        { segId: 'c', t0: 0.5, t1: 0.1 },
        // Not a continuation: it turns back on the same rail
        { segId: 'c', t0: 0.1, t1: 0.3 },
      ]),
    ).toEqual([
      { segId: 'a', t0: 0.2, t1: 1 },
      { segId: 'b', t0: 0, t1: 1 },
      { segId: 'c', t0: 1, t1: 0.1 },
      { segId: 'c', t0: 0.1, t1: 0.3 },
    ])
  })

  describe('index rail → zones', () => {
    it('answers which zones cover a place, overlapping zones included', () => {
      const { net, rail, zone } = trackWithZone()
      const other = addSpeedZoneBetween(net, at(net, 700), at(net, 900), 60)!
      expect(speedZonesAt(net, rail.id, 0.5)).toEqual([zone])
      expect(speedZonesAt(net, rail.id, 0.72)).toEqual([zone, other])
      expect(speedZonesAt(net, rail.id, 0.85)).toEqual([other])
      expect(speedZonesAt(net, rail.id, 0.1)).toEqual([])
      expect(speedZonesAt(net, 's_nope', 0.5)).toEqual([])
      expect(speedZonesOnRail(net, rail.id)).toEqual([
        { zone, lo: 0.25, hi: 0.75 },
        { zone: other, lo: 0.7, hi: 0.9 },
      ])
    })

    it('is kept between reads and rebuilt when a zone or its rails change', () => {
      const { net, rail, zone } = trackWithZone()
      const index = speedZoneIndex(net)
      const revision = speedZonesRevision(net)
      expect(speedZoneIndex(net)).toBe(index)

      setSpeedZoneSpeed(net, zone.id, 90) // same speed: nothing changed
      expect(speedZonesRevision(net)).toBe(revision)
      setSpeedZoneSpeed(net, zone.id, 60)
      expect(speedZonesRevision(net)).toBeGreaterThan(revision)

      const res = splitSegment(net, rail.id, { x: 500, y: 0 })!
      expect(speedZoneIndex(net)).not.toBe(index)
      expect(speedZonesOnRail(net, rail.id)).toEqual([])
      expect(speedZonesAt(net, res.seg1.id, 0.9)).toEqual([zone])
      expect(speedZonesAt(net, res.seg2.id, 0.1)).toEqual([zone])
      expect(speedZonesAt(net, res.seg2.id, 0.9)).toEqual([])

      // A cut elsewhere leaves the zones, and what was computed from them, alone
      const quiet = speedZonesRevision(net)
      const { rails } = line(net, [0, 10].map((x) => x + 5000))
      splitSegment(net, rails[0].id, { x: 5005, y: 0 })
      expect(speedZonesRevision(net)).toBe(quiet)

      zone.spans = [{ segId: res.seg1.id, t0: 0, t1: 1 }]
      invalidateSpeedZones(net)
      expect(speedZonesAt(net, res.seg1.id, 0.1)).toEqual([zone])
    })
  })

  describe('a zone stays at the same place of the world', () => {
    it('when the scissors cut the rail in the middle of it', () => {
      const { net, zone } = trackWithZone()
      expect(performTrackCut(net, { x: 500, y: 0 })).toBe(true)
      expect(net.segments.size).toBe(2)
      expect(net.speedZones.size).toBe(1)
      expect(zone.spans).toHaveLength(2)
      expectZone(net, zone, A, B, 500)
    })

    it('when the rail is cut outside of it, on either side', () => {
      const { net, zone } = trackWithZone()
      performTrackCut(net, { x: 100, y: 0 })
      performTrackCut(net, { x: 900, y: 0 })
      expect(zone.spans).toHaveLength(1)
      expectZone(net, zone, A, B, 500)
    })

    it('when the rail is cut exactly at one of its ends', () => {
      const { net, zone } = trackWithZone()
      performTrackCut(net, { x: 250, y: 0 })
      expect(zone.spans).toHaveLength(1)
      expectZone(net, zone, A, B, 500)
    })

    it('when it runs against the rail and the rail is cut', () => {
      const net = createNetwork()
      line(net, [0, 1000])
      const zone = addSpeedZoneBetween(net, at(net, 750), at(net, 250), 90)!
      performTrackCut(net, { x: 500, y: 0 })
      performTrackCut(net, { x: 600, y: 0 })
      expect(zone.spans).toHaveLength(3)
      expectZone(net, zone, B, A, 500)
    })

    it('when a turnout is laid in it; the diverging branch is not in the zone', () => {
      const { net, rail, zone } = trackWithZone()
      const { midNode } = splitSegment(net, rail.id, { x: 400, y: 0 })!
      const turnout = placeTurnout(net, { startPos: midNode.pos, direction: { x: 1, y: 0 }, frogNumber: 6, hand: 'left', stemNodeId: midNode.id })
      reconcileNetworkIntersections(net)
      cleanSpeedZones(net)

      expect(net.junctions.size).toBe(1)
      expect(net.speedZones.size).toBe(1)
      expectZone(net, zone, A, B, 500)
      // Every rail that leaves the main line is outside the zone
      const offLine = [...net.segments.values()].filter((s) => Math.abs(net.nodes.get(s.from)!.pos.y) > 1e-6 || Math.abs(net.nodes.get(s.to)!.pos.y) > 1e-6)
      expect(offLine.length).toBeGreaterThan(0)
      expect(offLine.some((s) => s.to === turnout.divergingNode.id || s.from === turnout.divergingNode.id)).toBe(true)
      for (const s of offLine) expect(speedZonesOnRail(net, s.id)).toEqual([])
      // …and every rail of the main line between A and B is in it
      for (const x of [260, 399, 401, 500, 740]) {
        const place = at(net, x)
        expect(speedZonesAt(net, place.segId, place.t)).toEqual([zone])
      }
    })

    it('when another track is laid across it and a crossing is made', () => {
      const { net, zone } = trackWithZone()
      const s = addNode(net, { x: 500, y: -100 })
      const n = addNode(net, { x: 500, y: 100 })
      const across = addSegment(net, s.id, n.id)!
      const res = reconcileNetworkIntersections(net)
      expect(res.splitCount).toBe(2)
      expect(net.segments.has(across.id)).toBe(false)

      expect(net.speedZones.size).toBe(1)
      expect(zone.spans).toHaveLength(2)
      expectZone(net, zone, A, B, 500)
      // The crossing track is not in the zone
      for (const y of [-50, 50]) {
        const place = at(net, 500, y)
        expect(speedZonesAt(net, place.segId, place.t)).toEqual([])
      }
    })

    it('when a node of its track is dissolved, whatever the direction of the rails', () => {
      for (const flipFirst of [false, true]) {
        for (const flipSecond of [false, true]) {
          resetIdCounter(0)
          const net = createNetwork()
          const a = addNode(net, { x: 0, y: 0 })
          const m = addNode(net, { x: 300, y: 0 })
          const b = addNode(net, { x: 1000, y: 0 })
          if (flipFirst) addSegment(net, m.id, a.id)
          else addSegment(net, a.id, m.id)
          if (flipSecond) addSegment(net, b.id, m.id)
          else addSegment(net, m.id, b.id)
          const zone = addSpeedZoneBetween(net, at(net, 250), at(net, 750), 90)!
          expect(zone.spans).toHaveLength(2)
          const reverse = addSpeedZoneBetween(net, at(net, 900), at(net, 100), 60)!

          const merged = dissolveNode(net, m.id)!
          expect(net.segments.size).toBe(1)
          expect(zone.spans).toHaveLength(1)
          expect(zone.spans[0].segId).toBe(merged.id)
          expectZone(net, zone, A, B, 500)
          expectZone(net, reverse, { x: 900, y: 0 }, { x: 100, y: 0 }, 800)
        }
      }
    })

    it('when a duplicate of its rail is dropped, the survivor running the other way', () => {
      const net = createNetwork()
      const a = addNode(net, { x: 0, y: 0 })
      const b = addNode(net, { x: 1000, y: 0 })
      const c = addNode(net, { x: 0, y: 0 })
      const older = addSegment(net, a.id, b.id)!
      const newer = addSegment(net, b.id, c.id)!
      const zone = addSpeedZone(net, [{ segId: newer.id, t0: 0.75, t1: 0.25 }], 90)!
      expectZone(net, zone, A, B, 500)

      weldNodes(net, a.id, c.id)
      expect(removeDuplicateSegments(net, 0.1)).toBe(1)
      expect(net.segments.has(newer.id)).toBe(false)
      expect(zone.spans).toEqual([{ segId: older.id, t0: 0.25, t1: 0.75 }])
      expectZone(net, zone, A, B, 500)
    })

    it('relative to its track when the track is moved: the zone goes with it', () => {
      const { net, nodes, zone } = trackWithZone()
      for (const node of nodes) node.pos = { x: node.pos.x + 30, y: node.pos.y + 50 }
      networkChanged()
      expectZone(net, zone, { x: 280, y: 50 }, { x: 780, y: 50 }, 500)
    })

    it('when its track changes level', () => {
      const { net, nodes, zone } = trackWithZone()
      performTrackCut(net, { x: 500, y: 0 })
      setNodesLevel(net, nodes.map((n) => n.id), 1)
      expectZone(net, zone, A, B, 500)
    })

    it('when a level crossing in it becomes a bridge', () => {
      const { net, zone } = trackWithZone()
      const s = addNode(net, { x: 500, y: -100 })
      const n = addNode(net, { x: 500, y: 100 })
      addSegment(net, s.id, n.id)
      reconcileNetworkIntersections(net)
      const cross = [...net.nodes.values()].find((node) => net.adjacency.get(node.id)!.length === 4)!
      const mainRail = zone.spans[0].segId

      expect(separateLevelsAtNode(net, cross.id, mainRail, 1)).not.toBeNull()
      reconcileNetworkIntersections(net)
      expect(net.speedZones.size).toBe(1)
      expectZone(net, zone, A, B, 500)
    })

    it('on a curve that is cut', () => {
      const net = createNetwork()
      const a = addNode(net, { x: 0, y: 0 })
      const b = addNode(net, { x: 400, y: 400 })
      const curve = addCurveSegment(net, a.id, b.id, { x: 400, y: 0 })!
      const zone = addSpeedZone(net, [{ segId: curve.id, t0: 0.2, t1: 0.9 }], 90)!
      const before = speedZoneEnds(net, zone)!
      const length = speedZoneLength(net, zone)

      splitSegment(net, curve.id, { x: 300, y: 100 })
      expect(zone.spans).toHaveLength(2)
      const after = speedZoneEnds(net, zone)!
      expectNear(after.a, before.a)
      expectNear(after.b, before.b)
      // Same track, but `segmentPartialLength` sums 32 chords per stretch: on this 90° curve of
      // 400 m radius the two halves are measured finer than the whole was (about 2 cm in 480 m)
      expect(length).toBeGreaterThan(400)
      expect(Math.abs(speedZoneLength(net, zone) - length)).toBeLessThan(length * 1e-4)
    })
  })

  describe('when a rail under it is removed', () => {
    function threeRails() {
      const net = createNetwork()
      const { nodes, rails } = line(net, [0, 300, 600, 1000])
      const zone = addSpeedZoneBetween(net, at(net, 100), at(net, 900), 90)!
      expect(zone.spans).toHaveLength(3)
      return { net, nodes, rails, zone }
    }

    it('in the middle: two zones with the same speed, one on each side', () => {
      const { net, rails, zone } = threeRails()
      removeSegment(net, rails[1].id, false)

      expect(net.speedZones.size).toBe(2)
      const [first, second] = [...net.speedZones.values()]
      expect(first).toBe(zone)
      expect(second.id).not.toBe(zone.id)
      expect(second.speed).toBe(90)
      expectZone(net, first, { x: 100, y: 0 }, { x: 300, y: 0 }, 200)
      expectZone(net, second, { x: 600, y: 0 }, { x: 900, y: 0 }, 300)
      expect(speedZonesAt(net, rails[2].id, 0.5)).toEqual([second])
    })

    it('at one end: the zone is shortened', () => {
      const { net, rails, zone } = threeRails()
      removeSegment(net, rails[2].id, false)
      expect(net.speedZones.size).toBe(1)
      expectZone(net, zone, { x: 100, y: 0 }, { x: 600, y: 0 }, 500)

      removeSegment(net, rails[0].id)
      expect(net.speedZones.size).toBe(1)
      expectZone(net, zone, { x: 300, y: 0 }, { x: 600, y: 0 }, 300)
    })

    it('the last one: the zone is removed', () => {
      const { net, rail } = trackWithZone()
      removeSegment(net, rail.id)
      expect(net.speedZones.size).toBe(0)
      expect(speedZoneIndex(net).size).toBe(0)
    })

    it('with its node: the zone loses both rails of that node', () => {
      const { net, nodes, zone } = threeRails()
      removeNode(net, nodes[1].id)
      expect(net.speedZones.size).toBe(1)
      expectZone(net, zone, { x: 600, y: 0 }, { x: 900, y: 0 }, 300)
    })

    it('by a weld that closes it up: the zone keeps the rest', () => {
      const { net, nodes, zone } = threeRails()
      weldNodes(net, nodes[1].id, nodes[2].id)
      expect(net.segments.size).toBe(2)
      expect(net.speedZones.size).toBe(2)
      expect(speedZoneLength(net, zone)).toBeCloseTo(200, 6)
    })

    it('without a word (rail taken out of the graph by hand): cleanSpeedZones cuts the zone there', () => {
      const { net, rails, zone } = threeRails()
      expect(cleanSpeedZones(net)).toBe(false)
      net.segments.delete(rails[1].id)
      expect(cleanSpeedZones(net)).toBe(true)
      expect(net.speedZones.size).toBe(2)
      expectZone(net, zone, { x: 100, y: 0 }, { x: 300, y: 0 }, 200)
      expect(cleanSpeedZones(net)).toBe(false)
    })
  })

  it('a zone does not move when a rail it is not on is replaced', () => {
    const { net, rail, zone } = trackWithZone()
    const before = JSON.stringify(zone)
    replaceRail(net, removalReplacement('s_other'))
    expect(JSON.stringify(zone)).toBe(before)
    expect(speedZonesAt(net, rail.id, 0.5)).toEqual([zone])
  })

  it('restores saved zones under their ids; the clean-up then cuts them where a stretch cannot be kept', () => {
    const net = createNetwork()
    const { rails } = line(net, [0, 300, 600, 1000])
    expect(
      restoreSpeedZone(net, 'z_70', 60, [
        { segId: rails[0].id, t0: 0.5, t1: 1 },
        { segId: 's_gone', t0: 0, t1: 1 },
        { segId: rails[2].id, t0: 0, t1: 0.5 },
      ]),
    ).toBe(true)
    expect(restoreSpeedZone(net, 'z_70', 60, [{ segId: rails[0].id, t0: 0, t1: 1 }])).toBe(false)
    expect(restoreSpeedZone(net, 'z_71', 65, [{ segId: rails[0].id, t0: 0, t1: 1 }])).toBe(false)
    expect(restoreSpeedZone(net, 'z_72', 60, [null, { segId: rails[0].id, t0: 2, t1: 1 }])).toBe(true)
    // The piece cut off z_70 must not take the id of a zone read after it
    expect(restoreSpeedZone(net, 'z_73', 30, [{ segId: rails[1].id, t0: 0, t1: 1 }])).toBe(true)
    // Until the clean-up the index only answers for what is on the track
    expect(speedZonesAt(net, rails[2].id, 0.25).map((z) => z.id)).toEqual(['z_70'])

    syncIdCounter(net)
    expect(cleanSpeedZones(net)).toBe(true)
    expect([...net.speedZones.keys()]).toEqual(['z_70', 'z_73', 'z_74'])
    expect(net.speedZones.get('z_70')!.spans).toEqual([{ segId: rails[0].id, t0: 0.5, t1: 1 }])
    expect(net.speedZones.get('z_74')).toEqual({ id: 'z_74', speed: 60, spans: [{ segId: rails[2].id, t0: 0, t1: 0.5 }] })
  })

  it('zone ids count for the id counter', () => {
    const net = createNetwork()
    const { rails } = line(net, [0, 100])
    restoreSpeedZone(net, 'z_500', 60, [{ segId: rails[0].id, t0: 0, t1: 1 }])
    syncIdCounter(net)
    expect(generateId('n')).toBe('n_501')
  })
})

describe('splitSpeedZonesBy', () => {
  it('cuts a zone where the group of its rails changes, same speed, stretches in order, and leaves the others alone', () => {
    const net = createNetwork()
    const nodes = [0, 100, 200, 300, 400].map((x) => addNode(net, { x, y: 0 }))
    const rails = nodes.slice(1).map((n, i) => addSegment(net, nodes[i].id, n.id)!)
    const across = addSpeedZone(net, rails.map((r) => ({ segId: r.id, t0: 0, t1: 1 })), 160)!
    const within = addSpeedZone(net, [{ segId: rails[0].id, t0: 0.2, t1: 0.4 }], 60)!
    const group = (segId: string): string => (rails.slice(0, 2).some((r) => r.id === segId) ? 'a' : 'b')
    expect(splitSpeedZonesBy(net, group)).toBe(1)
    expect(net.speedZones.has(across.id)).toBe(false)
    expect(net.speedZones.get(within.id)).toBe(within)
    const pieces = [...net.speedZones.values()].filter((z) => z.id !== within.id).sort((x, y) => x.spans[0].segId.localeCompare(y.spans[0].segId, 'en', { numeric: true }))
    expect(pieces.map((z) => z.speed)).toEqual([160, 160])
    expect(pieces.map((z) => z.spans.map((s) => s.segId))).toEqual([[rails[0].id, rails[1].id], [rails[2].id, rails[3].id]])
    expect(splitSpeedZonesBy(net, group)).toBe(0)
  })
})
