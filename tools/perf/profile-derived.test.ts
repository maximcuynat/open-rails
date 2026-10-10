import { test } from 'vitest'
import { buildStations } from '@infrastructure/render/benchNetworks'
import { networkDerived } from '@infrastructure/render/networkDerived'
import { verifyNetworkRevisions, touchNetwork } from '@domain/models/networkWatch'
import { addNode, addSegment } from '@domain/models/network'
import { networkChangesSince } from '@domain/geometry/networkFollower'
import { detectDirectionConflicts, findSectionChains, nameSections } from '@domain/models/sections'
import { analyzeKinematics } from '@domain/services/kinematicDiagnostics'
import { trackProfile } from '@domain/models/trackSpeed'
import { addSpeedZone, removeSpeedZone } from '@domain/models/speedZones'

verifyNetworkRevisions(false)

// Run by hand: PROFILE=1 SCALE_COPIES=9 npx vitest run tools/perf/profile-derived.test.ts --silent=false
test.runIf(process.env.PROFILE)('profile', { timeout: 600_000 }, () => {
  const net = buildStations(Number(process.env.SCALE_COPIES ?? 9))
  const meta: Record<string, any> = {}
  const time = (label: string, fn: () => void): void => {
    const t0 = performance.now()
    fn()
    process.stderr.write(`${label}: ${(performance.now() - t0).toFixed(1)} ms\n`)
  }
  time('derived first', () => networkDerived(net, meta).kinematicIssues(1.435, { levelHeight: 6, maxGradient: 0.035 }))
  time('profile first', () => trackProfile(net))
  let y = 0
  const lay = (): void => {
    const a = addNode(net, { x: -500, y: (y += 10) })
    const b = addNode(net, { x: -470, y })
    addSegment(net, a.id, b.id)
  }
  for (let i = 0; i < 3; i++) {
    lay()
    time('feed read', () => networkChangesSince(net, undefined))
    time('derived after a rail laid', () => networkDerived(net, meta))
    time('  kinematics', () => networkDerived(net, meta).kinematicIssues(1.435, { levelHeight: 6, maxGradient: 0.035 }))
    time('  totals', () => networkDerived(net, meta).trackTotals())
    time('  ramps', () => networkDerived(net, meta).ramps(6))
    time('  loops+components+deadEnds', () => { const d = networkDerived(net, meta); d.loops(); d.components(); d.deadEnds() })
    time('  profile', () => trackProfile(net))
  }
  const curved = [...net.segments.values()].find((s) => s.kind === 'curve')!
  const zone = addSpeedZone(net, [{ segId: curved.id, t0: 0, t1: 1 }], 60)!
  time('profile after a zone laid', () => trackProfile(net))
  removeSpeedZone(net, zone.id)
  time('profile after the zone removed', () => trackProfile(net))
  const node = [...net.nodes.values()][1000]
  node.pos = { x: node.pos.x + 0.1, y: node.pos.y }
  touchNetwork(net)
  time('derived after a node moved', () => networkDerived(net, meta))
  time('profile after a node moved', () => trackProfile(net))
  time('  loops+components+deadEnds (kept)', () => { const d = networkDerived(net, meta); d.loops(); d.components(); d.deadEnds() })
  time('full chains', () => findSectionChains(net))
  time('full naming', () => nameSections(net, findSectionChains(net), meta))
  time('full kinematics', () => analyzeKinematics(net, 1.435, { levelHeight: 6, maxGradient: 0.035 }))
  const chains = findSectionChains(net)
  process.stderr.write(`sections: ${chains.length}, meta keys: ${Object.keys(meta).length}\n`)
  time('naming alone', () => nameSections(net, chains, meta))
  time('for-in over meta', () => { let n = 0; for (const k in meta) if (k.includes('-')) n++ })
  time('conflicts', () => detectDirectionConflicts(net, nameSections(net, chains, meta)))
  const sections = nameSections(net, chains, meta)
  time('conflicts alone', () => detectDirectionConflicts(net, sections))
  time('sectionOfSegment', () => { const m = new Map(); for (const sec of sections) for (const sid of sec.segmentIds) if (!m.has(sid)) m.set(sid, sec) })
})
