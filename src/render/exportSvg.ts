import { bezierNormal, bezierPoint, curveLength, discretizeCurve } from '../core/curve'
import type { EditorStore } from '../ui/store'
import type { Network, Point, Selection } from '../core/types'
import type { Camera } from './camera'
import { detectCrossings, lineLineIntersection } from '../core/crossing'
import { segmentTangentAt } from '../core/tangent'
import {
  GAUGE,
  SLEEPER_SPACING,
  SLEEPER_LENGTH,
  SLEEPER_WIDTH,
  BALLAST_WIDTH,
  RAIL_WIDTH,
  getNodeSegmentEnds,
  getConnectedEndPairs,
} from './renderer'

/**
 * Generate a complete, high-fidelity HO 1:87 scale SVG drawing of the rail network.
 * Accurately models:
 * - Ballast roadbed with seamless joint bevels
 * - Wooden/concrete sleepers (traverses) spaced at 7.5mm
 * - Double rails (Code 83, gauge 16.5mm)
 * - Steel fishplates (éclisses) with bolts at 2-way track joints
 * - Turnouts with flared guard rails (contre-rails), frog point & wing rails,
 *   movable switch blades, stretcher bar, and switch machine.
 */
export function generateRealisticSVG(net: Network, projectName = 'OpenRail'): string {
  if (net.nodes.size === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"></svg>`
  }

  // 1. Calculate network bounding box including ballast & sleepers margins
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of net.nodes.values()) {
    minX = Math.min(minX, n.pos.x)
    minY = Math.min(minY, n.pos.y)
    maxX = Math.max(maxX, n.pos.x)
    maxY = Math.max(maxY, n.pos.y)
  }
  for (const s of net.segments.values()) {
    if (s.kind === 'curve' && s.via) {
      minX = Math.min(minX, s.via.x)
      minY = Math.min(minY, s.via.y)
      maxX = Math.max(maxX, s.via.x)
      maxY = Math.max(maxY, s.via.y)
    }
  }

  const pad = BALLAST_WIDTH + 20
  const vbX = Math.round(minX - pad)
  const vbY = Math.round(minY - pad)
  const vbW = Math.max(10, Math.round(maxX - minX + pad * 2))
  const vbH = Math.max(10, Math.round(maxY - minY + pad * 2))

  const hg = GAUGE / 2
  const hb = BALLAST_WIDTH / 2
  const hsl = SLEEPER_LENGTH / 2
  const hsw = SLEEPER_WIDTH / 2

  const ballastPaths: string[] = []
  const sleeperRects: string[] = []
  const railPaths: string[] = []
  const turnoutElements: string[] = []
  const crossingElements: string[] = []

  // Helper to format float with 2 decimal places
  const f = (n: number) => Number(n.toFixed(2))

  /** Generate an exact SVG quadratic Bézier curve path offset by distance offset */
  const generateOffsetBezierPath = (
    p0: Point,
    via: Point,
    p2: Point,
    offset: number,
    tStart = 0,
    tEnd = 1,
  ): string => {
    const numSegs = 2
    let path = ''
    for (let i = 0; i < numSegs; i++) {
      const tA = tStart + (i / numSegs) * (tEnd - tStart)
      const tB = tStart + ((i + 1) / numSegs) * (tEnd - tStart)
      const tM = (tA + tB) / 2

      const ptA = bezierPoint(tA, p0, via, p2)
      const nA = bezierNormal(tA, p0, via, p2)
      const rA = { x: ptA.x + nA.x * offset, y: ptA.y + nA.y * offset }

      const ptB = bezierPoint(tB, p0, via, p2)
      const nB = bezierNormal(tB, p0, via, p2)
      const rB = { x: ptB.x + nB.x * offset, y: ptB.y + nB.y * offset }

      const ptM = bezierPoint(tM, p0, via, p2)
      const nM = bezierNormal(tM, p0, via, p2)
      const rM = { x: ptM.x + nM.x * offset, y: ptM.y + nM.y * offset }

      const v = {
        x: 2 * rM.x - 0.5 * (rA.x + rB.x),
        y: 2 * rM.y - 0.5 * (rA.y + rB.y),
      }

      if (i === 0) {
        path += `M ${f(rA.x)} ${f(rA.y)}`
      }
      path += ` Q ${f(v.x)} ${f(v.y)} ${f(rB.x)} ${f(rB.y)}`
    }
    return path
  }

  // Detect diamond crossings across the network
  const crossings = detectCrossings(net)

  // 2. Generate Ballast, Sleepers, and Rails for each segment
  for (const seg of net.segments.values()) {
    const nodeA = net.nodes.get(seg.from)
    const nodeB = net.nodes.get(seg.to)
    if (!nodeA || !nodeB) continue

    if (seg.kind === 'curve' && seg.via) {
      // --- Curved segment ---
      const p0 = nodeA.pos
      const via = seg.via
      const p2 = nodeB.pos
      const len = curveLength(p0, via, p2, 24)
      const samples = Math.max(16, Math.round(len / 4))
      const pts = discretizeCurve(p0, via, p2, samples)

      const leftB: Point[] = []
      const rightB: Point[] = []

      for (let i = 0; i <= samples; i++) {
        const t = i / samples
        const n = bezierNormal(t, p0, via, p2)
        leftB.push({ x: pts[i].x + n.x * hb, y: pts[i].y + n.y * hb })
        rightB.push({ x: pts[i].x - n.x * hb, y: pts[i].y - n.y * hb })
      }

      // Ballast polygon
      let bD = `M ${f(leftB[0].x)} ${f(leftB[0].y)}`
      for (let i = 1; i <= samples; i++) bD += ` L ${f(leftB[i].x)} ${f(leftB[i].y)}`
      for (let i = samples; i >= 0; i--) bD += ` L ${f(rightB[i].x)} ${f(rightB[i].y)}`
      bD += ' Z'
      ballastPaths.push(`<path d="${bD}" class="ballast" />`)

      // Sleepers — half-offset spacing, skipping crossing diamond interiors
      const totalSleepers = Math.max(1, Math.round(len / SLEEPER_SPACING))
      const stepT = 1 / totalSleepers
      for (let i = 0; i < totalSleepers; i++) {
        const t = (i + 0.5) * stepT
        const pt = bezierPoint(t, p0, via, p2)

        let insideCrossing = false
        for (const c of crossings) {
          if (Math.hypot(pt.x - c.center.x, pt.y - c.center.y) < c.radius * 0.75) {
            insideCrossing = true
            break
          }
        }
        if (insideCrossing) continue

        const n = bezierNormal(t, p0, via, p2)
        const angleDeg = f((Math.atan2(n.y, n.x) * 180) / Math.PI)
        sleeperRects.push(
          `<rect x="${f(-hsl)}" y="${f(-hsw)}" width="${SLEEPER_LENGTH}" height="${SLEEPER_WIDTH}" rx="0.4" class="sleeper" transform="translate(${f(pt.x)}, ${f(pt.y)}) rotate(${angleDeg})" />`,
        )
      }

      // Rails: exact mathematical Bézier curves from node to node
      const rL = generateOffsetBezierPath(p0, via, p2, hg, 0, 1)
      const rR = generateOffsetBezierPath(p0, via, p2, -hg, 0, 1)

      // Base rail
      railPaths.push(`<path d="${rL}" class="rail" />`)
      railPaths.push(`<path d="${rR}" class="rail" />`)
      // Polished white rail head
      railPaths.push(`<path d="${rL}" class="rail-head" />`)
      railPaths.push(`<path d="${rR}" class="rail-head" />`)
    } else {
      // --- Straight segment ---
      const a = nodeA.pos
      const b = nodeB.pos
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      if (len < 0.001) continue

      const ux = dx / len
      const uy = dy / len
      const nx = -uy
      const ny = ux
      const angleDeg = f((Math.atan2(dy, dx) * 180) / Math.PI)

      // Ballast polygon
      const b1 = { x: a.x + nx * hb, y: a.y + ny * hb }
      const b2 = { x: b.x + nx * hb, y: b.y + ny * hb }
      const b3 = { x: b.x - nx * hb, y: b.y - ny * hb }
      const b4 = { x: a.x - nx * hb, y: a.y - ny * hb }
      ballastPaths.push(
        `<polygon points="${f(b1.x)},${f(b1.y)} ${f(b2.x)},${f(b2.y)} ${f(b3.x)},${f(b3.y)} ${f(b4.x)},${f(b4.y)}" class="ballast" />`,
      )

      // Sleepers — half-offset spacing, skipping crossing diamond interiors
      const totalSleepers = Math.max(1, Math.round(len / SLEEPER_SPACING))
      const step = len / totalSleepers
      for (let i = 0; i < totalSleepers; i++) {
        const dist = (i + 0.5) * step
        const sx = a.x + ux * dist
        const sy = a.y + uy * dist

        let insideCrossing = false
        for (const c of crossings) {
          if (Math.hypot(sx - c.center.x, sy - c.center.y) < c.radius * 0.75) {
            insideCrossing = true
            break
          }
        }
        if (insideCrossing) continue

        sleeperRects.push(
          `<rect x="${f(-hsw)}" y="${f(-hsl)}" width="${SLEEPER_WIDTH}" height="${SLEEPER_LENGTH}" rx="0.4" class="sleeper" transform="translate(${f(sx)}, ${f(sy)}) rotate(${angleDeg})" />`,
        )
      }

      // Rails: continuous exact rail lines from node to node
      const r1a = { x: a.x + nx * hg, y: a.y + ny * hg }
      const r1b = { x: b.x + nx * hg, y: b.y + ny * hg }
      const r2a = { x: a.x - nx * hg, y: a.y - ny * hg }
      const r2b = { x: b.x - nx * hg, y: b.y - ny * hg }

      // Base rails
      railPaths.push(`<line x1="${f(r1a.x)}" y1="${f(r1a.y)}" x2="${f(r1b.x)}" y2="${f(r1b.y)}" class="rail" />`)
      railPaths.push(`<line x1="${f(r2a.x)}" y1="${f(r2a.y)}" x2="${f(r2b.x)}" y2="${f(r2b.y)}" class="rail" />`)
      // Polished white rail head
      railPaths.push(`<line x1="${f(r1a.x)}" y1="${f(r1a.y)}" x2="${f(r1b.x)}" y2="${f(r1b.y)}" class="rail-head" />`)
      railPaths.push(`<line x1="${f(r2a.x)}" y1="${f(r2a.y)}" x2="${f(r2b.x)}" y2="${f(r2b.y)}" class="rail-head" />`)
    }
  }

  // 3. Connect ballast and rails at nodes (smooth dynamic seamless joints)
  const dummyCam: Camera = { x: 0, y: 0, scale: 1 }
  const dummySel: Selection = { nodes: new Set(), segments: new Set() }

  for (const node of net.nodes.values()) {
    const adj = net.adjacency.get(node.id) ?? []
    if (adj.length < 2) continue

    const ends = getNodeSegmentEnds(net, node, dummyCam, 0, 0, dummySel)
    const pairs = getConnectedEndPairs(node, ends, dummyCam, 0, 0)

    for (const p of pairs) {
      // Seamless ballast quad / polygon
      ballastPaths.push(
        `<polygon points="${f(p.b1LW.x)},${f(p.b1LW.y)} ${f(p.bLeftW.x)},${f(p.bLeftW.y)} ${f(p.b2LW.x)},${f(p.b2LW.y)} ${f(p.b2RW.x)},${f(p.b2RW.y)} ${f(p.bRightW.x)},${f(p.bRightW.y)} ${f(p.b1RW.x)},${f(p.b1RW.y)}" class="joint-fill" />`,
      )

      // Rails bridge lines through exact miter intersection points
      const distL = Math.hypot(p.r1LW.x - p.r2LW.x, p.r1LW.y - p.r2LW.y)
      const distR = Math.hypot(p.r1RW.x - p.r2RW.x, p.r1RW.y - p.r2RW.y)

      if (distL > 0.01 || distR > 0.01 || adj.length >= 3) {
        railPaths.push(
          `<path d="M ${f(p.r1LW.x)} ${f(p.r1LW.y)} L ${f(p.jLeftW.x)} ${f(p.jLeftW.y)} L ${f(p.r2LW.x)} ${f(p.r2LW.y)}" class="rail" />`,
        )
        railPaths.push(
          `<path d="M ${f(p.r1RW.x)} ${f(p.r1RW.y)} L ${f(p.jRightW.x)} ${f(p.jRightW.y)} L ${f(p.r2RW.x)} ${f(p.r2RW.y)}" class="rail" />`,
        )
        // Polished rail head
        railPaths.push(
          `<path d="M ${f(p.r1LW.x)} ${f(p.r1LW.y)} L ${f(p.jLeftW.x)} ${f(p.jLeftW.y)} L ${f(p.r2LW.x)} ${f(p.r2LW.y)}" class="rail-head" />`,
        )
        railPaths.push(
          `<path d="M ${f(p.r1RW.x)} ${f(p.r1RW.y)} L ${f(p.jRightW.x)} ${f(p.jRightW.y)} L ${f(p.r2RW.x)} ${f(p.r2RW.y)}" class="rail-head" />`,
        )
      }
    }
  }

  // 4. Turnout dynamic mechanical details (guard rails, frog, blades, motor)
  for (const junc of net.junctions.values()) {
    const apex = net.nodes.get(junc.nodeId)
    const straightNode = net.nodes.get(junc.straightNodeId)
    const divNode = net.nodes.get(junc.divergingNodeId)
    if (!apex || !straightNode || !divNode) continue

    const dx = straightNode.pos.x - apex.pos.x
    const dy = straightNode.pos.y - apex.pos.y
    const straightLen = Math.hypot(dx, dy)
    if (straightLen < 10) continue

    const ux = dx / straightLen
    const uy = dy / straightLen
    const nx = -uy
    const ny = ux
    const side: 1 | -1 = junc.hand === 'left' ? 1 : -1

    const specAngle = junc.frogNumber === 4 ? 15 : 10
    const thetaRad = (specAngle * Math.PI) / 180
    const frogDist = Math.min(straightLen * 0.75, GAUGE / Math.sin(thetaRad))

    const w2p = (t: number, d: number): Point => ({
      x: apex.pos.x + t * ux + d * nx,
      y: apex.pos.y + t * uy + d * ny,
    })

    // Contre-rail droit (straight guard rail with flared ends)
    const straightGuardOffset = -side * (hg - 2.2)
    const guardHalfLen = 16
    const flareLen = 5
    const flareOffset = side * 1.8

    const g1 = w2p(frogDist - guardHalfLen, straightGuardOffset + flareOffset)
    const g2 = w2p(frogDist - guardHalfLen + flareLen, straightGuardOffset)
    const g3 = w2p(frogDist + guardHalfLen - flareLen, straightGuardOffset)
    const g4 = w2p(frogDist + guardHalfLen, straightGuardOffset + flareOffset)

    turnoutElements.push(
      `<path d="M ${f(g1.x)} ${f(g1.y)} L ${f(g2.x)} ${f(g2.y)} L ${f(g3.x)} ${f(g3.y)} L ${f(g4.x)} ${f(g4.y)}" class="guard-rail" />`,
    )

    // Contre-rail dévié (curved guard rail with flared straight ends and curved body Q)
    const divCurveOffset = (dist: number) => side * (hg - 2.2 + dist * Math.sin(thetaRad) * 0.8)
    const dg1 = w2p(frogDist - guardHalfLen, divCurveOffset(frogDist - guardHalfLen) - flareOffset)
    const dg2 = w2p(frogDist - guardHalfLen + flareLen, divCurveOffset(frogDist - guardHalfLen + flareLen))
    const dg3 = w2p(frogDist + guardHalfLen - flareLen, divCurveOffset(frogDist + guardHalfLen - flareLen))
    const dg4 = w2p(frogDist + guardHalfLen, divCurveOffset(frogDist + guardHalfLen) - flareOffset)
    const dgMid = w2p(frogDist, divCurveOffset(frogDist))
    const dgVia = {
      x: 2 * dgMid.x - 0.5 * (dg2.x + dg3.x),
      y: 2 * dgMid.y - 0.5 * (dg2.y + dg3.y),
    }

    turnoutElements.push(
      `<path d="M ${f(dg1.x)} ${f(dg1.y)} L ${f(dg2.x)} ${f(dg2.y)} Q ${f(dgVia.x)} ${f(dgVia.y)} ${f(dg3.x)} ${f(dg3.y)} L ${f(dg4.x)} ${f(dg4.y)}" class="guard-rail" />`,
    )

    // Cœur d'aiguille (frog crossing point V & wing rails)
    const frogPt = w2p(frogDist, side * hg)
    const frogToeStraight = w2p(frogDist + 14, side * hg)
    const frogToeDiv = w2p(frogDist + 14, side * (hg + 14 * Math.sin(thetaRad)))

    turnoutElements.push(
      `<path d="M ${f(frogToeStraight.x)} ${f(frogToeStraight.y)} L ${f(frogPt.x)} ${f(frogPt.y)} L ${f(frogToeDiv.x)} ${f(frogToeDiv.y)}" class="guard-rail" />`,
    )

    // Wing rail
    const wp1 = w2p(frogDist - 16, side * (hg - 4.0))
    const wp2 = w2p(frogDist - 12, side * (hg - 2.0))
    const wp3 = w2p(frogDist + 4, side * (hg - 2.0))
    turnoutElements.push(
      `<path d="M ${f(wp1.x)} ${f(wp1.y)} L ${f(wp2.x)} ${f(wp2.y)} L ${f(wp3.x)} ${f(wp3.y)}" class="guard-rail" />`,
    )

    // Spacer blocks holding guard rails to stock rails
    for (const dist of [frogDist - 6, frogDist + 6]) {
      const sb1 = w2p(dist, -side * (hg - 1.1))
      const sb2 = w2p(dist, side * (hg - 1.1 + dist * Math.sin(thetaRad) * 0.8))
      turnoutElements.push(
        `<rect x="${f(sb1.x - 0.9)}" y="${f(sb1.y - 0.9)}" width="1.8" height="1.8" class="spacer-block" />`,
        `<rect x="${f(sb2.x - 0.9)}" y="${f(sb2.y - 0.9)}" width="1.8" height="1.8" class="spacer-block" />`,
      )
    }

    // Slide chairs (coussinets de glissement polis)
    for (const cx of [8, 14, 20, 26]) {
      const cpStraight = w2p(cx, side * (hg - 1.2))
      const cpDiv = w2p(cx, -side * (hg - 1.2) + cx * Math.sin(thetaRad) * 0.2)
      turnoutElements.push(
        `<rect x="${f(cpStraight.x - 1.1)}" y="${f(cpStraight.y - 1.8)}" width="2.2" height="3.6" class="slide-chair" />`,
        `<rect x="${f(cpDiv.x - 1.1)}" y="${f(cpDiv.y - 1.8)}" width="2.2" height="3.6" class="slide-chair" />`,
      )
    }

    // Lames d'aiguilles mobiles effilees (tapered switch blades)
    // Blade tapers from ~0.15mm at toe (knife edge) to full RAIL_WIDTH at heel
    const bladeLen = 32
    const toeX = 6
    const isStraight = junc.activeBranch === 'straight'
    const bladeTipHalf = 0.15 // Knife-edge half-width at toe
    const bladeHeelHalf = RAIL_WIDTH / 2 // Full rail width at heel

    // Straight blade (against side*hg stock rail)
    const straightBladeGap = isStraight ? 0 : side * 2.8
    const straightStockY = side * (hg - 0.8)
    const sToeY = straightStockY - straightBladeGap
    const sHeelY = straightStockY

    // Polygon: 4 corners of tapered blade
    const sToeInner = w2p(toeX, sToeY - bladeTipHalf)
    const sToeOuter = w2p(toeX, sToeY + bladeTipHalf)
    const sHeelInner = w2p(bladeLen, sHeelY - bladeHeelHalf)
    const sHeelOuter = w2p(bladeLen, sHeelY + bladeHeelHalf)

    turnoutElements.push(
      `<polygon points="${f(sToeOuter.x)},${f(sToeOuter.y)} ${f(sToeInner.x)},${f(sToeInner.y)} ${f(sHeelInner.x)},${f(sHeelInner.y)} ${f(sHeelOuter.x)},${f(sHeelOuter.y)}" class="switch-blade-fill" />`,
    )

    // Diverging blade
    const divBladeGap = isStraight ? side * 2.8 : 0
    const divStockY = -side * (hg - 0.8)
    const dToeY = divStockY + divBladeGap
    const dHeelY = divStockY + bladeLen * Math.sin(thetaRad) * 0.4

    const dToeInner = w2p(toeX, dToeY - bladeTipHalf)
    const dToeOuter = w2p(toeX, dToeY + bladeTipHalf)
    const dHeelInner = w2p(bladeLen, dHeelY - bladeHeelHalf)
    const dHeelOuter = w2p(bladeLen, dHeelY + bladeHeelHalf)

    // Use straight polygon approximation for SVG (the real curve is subtle at this scale)
    turnoutElements.push(
      `<polygon points="${f(dToeOuter.x)},${f(dToeOuter.y)} ${f(dToeInner.x)},${f(dToeInner.y)} ${f(dHeelInner.x)},${f(dHeelInner.y)} ${f(dHeelOuter.x)},${f(dHeelOuter.y)}" class="switch-blade-fill" />`,
    )

    // Tringle de manoeuvre (stretcher bar) connecting the toes of both blades
    const sToeCenter = w2p(toeX, sToeY)
    const dToeCenter = w2p(toeX, dToeY)
    turnoutElements.push(
      `<line x1="${f(sToeCenter.x)}" y1="${f(sToeCenter.y)}" x2="${f(dToeCenter.x)}" y2="${f(dToeCenter.y)}" class="stretcher-bar" />`,
    )

    // Moteur d'aiguille lateral (switch machine)
    const motorPos = w2p(toeX, side * (hg + 7))
    turnoutElements.push(
      `<rect x="${f(motorPos.x - 5)}" y="${f(motorPos.y - 3)}" width="10" height="6" rx="1" class="switch-motor" />`,
    )

    // Biellette de commande (operating rod)
    turnoutElements.push(
      `<line x1="${f(motorPos.x)}" y1="${f(motorPos.y)}" x2="${f(sToeCenter.x)}" y2="${f(sToeCenter.y)}" class="operating-rod" />`,
    )
  }

  // 5. Diamond Crossings (Croisements à niveau sans superposition)
  for (const c of crossings) {
    const u1 = c.track1Dir
    const u2 = c.track2Dir
    const n1 = { x: -u1.y, y: u1.x }
    const n2 = { x: -u2.y, y: u2.x }

    // Unified ballast platform
    const p1A = { x: c.center.x + n1.x * hb, y: c.center.y + n1.y * hb }
    const p1B = { x: c.center.x - n1.x * hb, y: c.center.y - n1.y * hb }
    const p2A = { x: c.center.x + n2.x * hb, y: c.center.y + n2.y * hb }
    const p2B = { x: c.center.x - n2.x * hb, y: c.center.y - n2.y * hb }

    const b1 = lineLineIntersection(p1A, u1, p2A, u2)
    const b2 = lineLineIntersection(p1A, u1, p2B, u2)
    const b3 = lineLineIntersection(p1B, u1, p2B, u2)
    const b4 = lineLineIntersection(p1B, u1, p2A, u2)

    if (b1 && b2 && b3 && b4) {
      ballastPaths.push(
        `<polygon points="${f(b1.x)},${f(b1.y)} ${f(b2.x)},${f(b2.y)} ${f(b3.x)},${f(b3.y)} ${f(b4.x)},${f(b4.y)}" class="ballast" />`,
      )
    }

    // Shared long crossing timbers (traverses communes de croisement)
    const sumX = u1.x + u2.x
    const sumY = u1.y + u2.y
    const sumL = Math.hypot(sumX, sumY)
    const uBis = sumL > 0.01 ? { x: sumX / sumL, y: sumY / sumL } : { x: -u1.y, y: u1.x }
    const uTie = { x: -uBis.y, y: uBis.x }
    const tieAngle = f((Math.atan2(uTie.y, uTie.x) * 180) / Math.PI)

    const maxSpan = Math.min(c.radius, 32)
    const numTies = Math.max(3, Math.floor((maxSpan * 2) / SLEEPER_SPACING))
    const stepTies = (maxSpan * 2) / numTies

    for (let i = 0; i <= numTies; i++) {
      const dist = -maxSpan + (i + 0.5) * stepTies
      if (dist > maxSpan) break
      const centerW = { x: c.center.x + uBis.x * dist, y: c.center.y + uBis.y * dist }
      const tieLen = f(Math.min(48, Math.max(SLEEPER_LENGTH, SLEEPER_LENGTH + Math.abs(dist) * 0.9)))
      sleeperRects.push(
        `<rect x="${f(-SLEEPER_WIDTH / 2)}" y="${f(-tieLen / 2)}" width="${SLEEPER_WIDTH}" height="${tieLen}" rx="0.4" class="sleeper" transform="translate(${f(centerW.x)}, ${f(centerW.y)}) rotate(${tieAngle})" />`,
      )
    }

    // Flangeway cuts & frogs
    const frogs = [c.frogs.p1, c.frogs.p2, c.frogs.p3, c.frogs.p4]
    const flangewayHalfLen = 3.2
    for (const fp of frogs) {
      // Cut line 1
      crossingElements.push(
        `<line x1="${f(fp.x - u1.x * flangewayHalfLen)}" y1="${f(fp.y - u1.y * flangewayHalfLen)}" x2="${f(fp.x + u1.x * flangewayHalfLen)}" y2="${f(fp.y + u1.y * flangewayHalfLen)}" class="flangeway" />`,
      )
      // Cut line 2
      crossingElements.push(
        `<line x1="${f(fp.x - u2.x * flangewayHalfLen)}" y1="${f(fp.y - u2.y * flangewayHalfLen)}" x2="${f(fp.x + u2.x * flangewayHalfLen)}" y2="${f(fp.y + u2.y * flangewayHalfLen)}" class="flangeway" />`,
      )

      // Acute frog nose
      const toCenter = { x: c.center.x - fp.x, y: c.center.y - fp.y }
      const dCenter = Math.hypot(toCenter.x, toCenter.y)
      if (dCenter > 0.1) {
        const uC = { x: toCenter.x / dCenter, y: toCenter.y / dCenter }
        const perp = { x: -uC.y, y: uC.x }
        const tip = { x: fp.x + uC.x * 2.5, y: fp.y + uC.y * 2.5 }
        const base1 = { x: fp.x - uC.x * 1.5 + perp.x * 1.0, y: fp.y - uC.y * 1.5 + perp.y * 1.0 }
        const base2 = { x: fp.x - uC.x * 1.5 - perp.x * 1.0, y: fp.y - uC.y * 1.5 - perp.y * 1.0 }
        crossingElements.push(
          `<polygon points="${f(tip.x)},${f(tip.y)} ${f(base1.x)},${f(base1.y)} ${f(base2.x)},${f(base2.y)}" class="frog-point" />`,
        )
      }
    }

    // Inner flared guard rails
    const guardOffset = 2.0
    const guardHalfLen = 7.0
    const flareLen = 2.2
    const flareOff = 1.4
    const addGuardRail = (centerPt: Point, dir: Point, normal: Point, side: 1 | -1) => {
      const basePt = { x: centerPt.x + normal.x * (hg - guardOffset) * side, y: centerPt.y + normal.y * (hg - guardOffset) * side }
      const flareNormal = { x: -normal.x * side, y: -normal.y * side }
      const pStart = { x: basePt.x - dir.x * guardHalfLen + flareNormal.x * flareOff, y: basePt.y - dir.y * guardHalfLen + flareNormal.y * flareOff }
      const pF1 = { x: basePt.x - dir.x * (guardHalfLen - flareLen), y: basePt.y - dir.y * (guardHalfLen - flareLen) }
      const pF2 = { x: basePt.x + dir.x * (guardHalfLen - flareLen), y: basePt.y + dir.y * (guardHalfLen - flareLen) }
      const pEnd = { x: basePt.x + dir.x * guardHalfLen + flareNormal.x * flareOff, y: basePt.y + dir.y * guardHalfLen + flareNormal.y * flareOff }

      crossingElements.push(
        `<path d="M ${f(pStart.x)} ${f(pStart.y)} L ${f(pF1.x)} ${f(pF1.y)} L ${f(pF2.x)} ${f(pF2.y)} L ${f(pEnd.x)} ${f(pEnd.y)}" class="guard-rail" />`,
      )
    }

    addGuardRail(c.center, u1, n1, 1)
    addGuardRail(c.center, u1, n1, -1)
    addGuardRail(c.center, u2, n2, 1)
    addGuardRail(c.center, u2, n2, -1)

    // Spacer blocks holding inner guard rails to running rails
    const addCrossingSpacers = (centerPt: Point, dir: Point, normal: Point, s: 1 | -1) => {
      const basePt = { x: centerPt.x + normal.x * (hg - guardOffset / 2) * s, y: centerPt.y + normal.y * (hg - guardOffset / 2) * s }
      for (const dist of [-3.5, 3.5]) {
        const sp = { x: basePt.x + dir.x * dist, y: basePt.y + dir.y * dist }
        crossingElements.push(
          `<rect x="${f(sp.x - 0.9)}" y="${f(sp.y - 0.9)}" width="1.8" height="1.8" class="spacer-block" />`,
        )
      }
    }
    addCrossingSpacers(c.center, u1, n1, 1)
    addCrossingSpacers(c.center, u1, n1, -1)
    addCrossingSpacers(c.center, u2, n2, 1)
    addCrossingSpacers(c.center, u2, n2, -1)
  }

  // 6. Buffer stops on dead ends (arrêts de voie sur heurtoirs de type SNCF/UIC)
  const bufferElements: string[] = []
  for (const node of net.nodes.values()) {
    const adj = net.adjacency.get(node.id) ?? []
    if (adj.length === 1) {
      const seg = net.segments.get(adj[0])
      if (!seg) continue
      let forwardDir: Point | null = null
      if (node.id === seg.to) {
        forwardDir = segmentTangentAt(net, seg, seg.to)
      } else if (node.id === seg.from) {
        const t = segmentTangentAt(net, seg, seg.from)
        if (t) forwardDir = { x: -t.x, y: -t.y }
      }
      if (!forwardDir) continue

      const uF = forwardDir
      const uP = { x: -uF.y, y: uF.x }
      const beamHalfW = hg + 3.8
      const beamCenter = { x: node.pos.x + uF.x * 2.0, y: node.pos.y + uF.y * 2.0 }
      const b1 = { x: beamCenter.x + uP.x * beamHalfW, y: beamCenter.y + uP.y * beamHalfW }
      const b2 = { x: beamCenter.x - uP.x * beamHalfW, y: beamCenter.y - uP.y * beamHalfW }

      const strutLen = 14
      const strutRailLeft = { x: node.pos.x - uF.x * strutLen + uP.x * hg, y: node.pos.y - uF.y * strutLen + uP.y * hg }
      const strutRailRight = { x: node.pos.x - uF.x * strutLen - uP.x * hg, y: node.pos.y - uF.y * strutLen - uP.y * hg }
      const strutHeadLeft = { x: node.pos.x + uF.x * 1.5 + uP.x * hg, y: node.pos.y + uF.y * 1.5 + uP.x * hg }
      const strutHeadRight = { x: node.pos.x + uF.x * 1.5 - uP.x * hg, y: node.pos.y + uF.y * 1.5 - uP.x * hg }

      bufferElements.push(
        `<line x1="${f(strutRailLeft.x)}" y1="${f(strutRailLeft.y)}" x2="${f(strutHeadLeft.x)}" y2="${f(strutHeadLeft.y)}" class="buffer-strut" />`,
        `<line x1="${f(strutRailRight.x)}" y1="${f(strutRailRight.y)}" x2="${f(strutHeadRight.x)}" y2="${f(strutHeadRight.y)}" class="buffer-strut" />`,
        `<line x1="${f(strutRailLeft.x)}" y1="${f(strutRailLeft.y)}" x2="${f(strutHeadRight.x)}" y2="${f(strutHeadRight.y)}" class="buffer-strut" />`,
        `<line x1="${f(b1.x)}" y1="${f(b1.y)}" x2="${f(b2.x)}" y2="${f(b2.y)}" class="buffer-beam" />`,
        `<circle cx="${f(beamCenter.x)}" cy="${f(beamCenter.y)}" r="2.2" class="buffer-target" />`,
        `<circle cx="${f(beamCenter.x + uP.x * hg)}" cy="${f(beamCenter.y + uP.y * hg)}" r="1.8" class="buffer-pad" />`,
        `<circle cx="${f(beamCenter.x - uP.x * hg)}" cy="${f(beamCenter.y - uP.y * hg)}" r="1.8" class="buffer-pad" />`,
      )
    }
  }

  // 7. Fishplates (eclisses de joint) at degree-2 track joints
  const fishplateElements: string[] = []
  for (const node of net.nodes.values()) {
    const adj = net.adjacency.get(node.id) ?? []
    if (adj.length !== 2) continue

    const seg0 = net.segments.get(adj[0])
    const seg1 = net.segments.get(adj[1])
    if (!seg0 || !seg1) continue

    const getTanSvg = (seg: typeof seg0): Point => {
      const tan = segmentTangentAt(net, seg, node.id)
      if (tan) {
        return seg.to === node.id ? tan : { x: -tan.x, y: -tan.y }
      }
      const otherId = seg.from === node.id ? seg.to : seg.from
      const other = net.nodes.get(otherId)
      if (other) {
        const dx = other.pos.x - node.pos.x
        const dy = other.pos.y - node.pos.y
        const l = Math.hypot(dx, dy)
        return l > 0 ? { x: dx / l, y: dy / l } : { x: 1, y: 0 }
      }
      return { x: 1, y: 0 }
    }

    const t0 = getTanSvg(seg0)
    const t1 = getTanSvg(seg1)

    let tAvgX = t0.x - t1.x
    let tAvgY = t0.y - t1.y
    const tLen = Math.hypot(tAvgX, tAvgY)
    if (tLen < 0.001) {
      tAvgX = t0.x
      tAvgY = t0.y
    } else {
      tAvgX /= tLen
      tAvgY /= tLen
    }

    const nFX = -tAvgY
    const nFY = tAvgX
    const plateHalfLen = 4.5
    const boltSpacing = 2.8

    for (const railSide of [-1, 1]) {
      const rcx = node.pos.x + nFX * hg * railSide
      const rcy = node.pos.y + nFY * hg * railSide

      const pA = { x: rcx - tAvgX * plateHalfLen, y: rcy - tAvgY * plateHalfLen }
      const pB = { x: rcx + tAvgX * plateHalfLen, y: rcy + tAvgY * plateHalfLen }

      fishplateElements.push(
        `<line x1="${f(pA.x)}" y1="${f(pA.y)}" x2="${f(pB.x)}" y2="${f(pB.y)}" class="fishplate" />`,
      )

      for (const boltDist of [-boltSpacing, -boltSpacing * 0.35, boltSpacing * 0.35, boltSpacing]) {
        const bx = rcx + tAvgX * boltDist
        const by = rcy + tAvgY * boltDist
        fishplateElements.push(
          `<circle cx="${f(bx)}" cy="${f(by)}" r="0.5" class="fishplate-bolt" />`,
        )
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}mm" height="${vbH}mm">
  <title>${projectName}</title>
  <defs>
    <style>
      .ballast { fill: #dcd6cc; stroke: #c2b9aa; stroke-width: 0.8; stroke-linejoin: round; }
      .joint-fill { fill: #dcd6cc; stroke: none; }
      .sleeper { fill: #443425; }
      .rail { stroke: #526071; stroke-width: ${RAIL_WIDTH}; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .rail-head { stroke: #ffffff; stroke-width: 0.42; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .flangeway { stroke: #1e1e1e; stroke-width: 1.6; stroke-linecap: butt; fill: none; }
      .frog-point { fill: #526071; }
      .guard-rail { stroke: #334155; stroke-width: 1.1; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .switch-blade { stroke: #64748b; stroke-width: 0.95; fill: none; stroke-linecap: round; }
      .switch-blade-fill { fill: #64748b; stroke: #475569; stroke-width: 0.3; }
      .stretcher-bar { stroke: #1e293b; stroke-width: 1.2; stroke-linecap: square; fill: none; }
      .switch-motor { fill: #1e293b; stroke: #475569; stroke-width: 0.8; }
      .operating-rod { stroke: #334155; stroke-width: 1.0; fill: none; }
      .slide-chair { fill: #94a3b8; stroke: #64748b; stroke-width: 0.3; }
      .spacer-block { fill: #1e293b; }
      .fishplate { stroke: #64748b; stroke-width: 1.4; stroke-linecap: round; fill: none; }
      .fishplate-bolt { fill: #1e293b; }
      .buffer-strut { stroke: #334155; stroke-width: 1.8; stroke-linecap: square; fill: none; }
      .buffer-beam { stroke: #dc2626; stroke-width: 3.5; stroke-linecap: butt; fill: none; }
      .buffer-target { fill: #ffffff; stroke: #dc2626; stroke-width: 0.8; }
      .buffer-pad { fill: #0f172a; stroke: #475569; stroke-width: 0.6; }
    </style>
  </defs>
  <g id="ballast">
    ${ballastPaths.join('\n    ')}
  </g>
  <g id="sleepers">
    ${sleeperRects.join('\n    ')}
  </g>
  <g id="rails">
    ${railPaths.join('\n    ')}
  </g>
  <g id="crossings">
    ${crossingElements.join('\n    ')}
  </g>
  <g id="turnouts">
    ${turnoutElements.join('\n    ')}
  </g>
  <g id="fishplates">
    ${fishplateElements.join('\n    ')}
  </g>
  <g id="buffer-stops">
    ${bufferElements.join('\n    ')}
  </g>
</svg>`
}

/**
 * Trigger SVG download in the browser.
 */
export function exportSVG(store: EditorStore): void {
  const svg = generateRealisticSVG(store.network, store.projectName)
  download(svg, `${store.projectName.replace(/\s+/g, '-').toLowerCase()}.svg`, 'image/svg+xml')
}

function download(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
