export type { Camera } from '@infrastructure/render/camera'
import { isRailClosedAt } from '@domain/models/routing'
import type { Camera } from '@infrastructure/render/camera'
export type { Selection } from '@domain/models/types'
import type { Network, Point, Selection, RailNode, Segment, NodeId } from '@domain/models/types'
import { bezierDerivative1, bezierNormal, bezierPoint, bezierTangent, curveLength, curveSamples, discretizeCurve } from '@domain/geometry/curve'
import { lineLineIntersection, type DiamondCrossing } from '@domain/models/crossing'
import { segmentTangentAt } from '@domain/geometry/tangent'
import { isRenamedSection, type SectionMetadata, type TrackSection } from '@domain/models/sections'
import type { GradientLimits, KinematicIssue } from '@domain/services/kinematicDiagnostics'
import type { LineSettings } from '@domain/models/speedLimits'
import { networkDerived } from './networkDerived'
import { nodesAmongInBox, nodesInBox, railsInBox } from '@domain/geometry/networkFollower'
import { networkCheckToken } from '@domain/models/networkWatch'
import { renderSpeedZoneBands, renderSpeedZoneMarkers, type SpeedZoneHighlight } from './speedZoneRender'
import { renderSignalling, renderSignalStripes, type SignalRenderOptions } from './signalRender'
import { renderDetailRails, renderLineTracks, renderSchematicTracks, renderSectionStripes, type SectionStripeStyle } from './lodTracks'
import { renderCantMarks } from './cantRender'
import { GRADIENT_LABEL_FONT, drawGradientLabels, gradientLabelBoxes, renderGradientChevrons, type GradientColors } from './gradientRender'
import { trackProfile } from '@domain/models/trackSpeed'
import { gaugeOnScreen, nodeMarkerShown, trackLod } from './lod'
import {
  BADGE_FULL_FROM_PX,
  DIAGNOSTIC_CLUSTER_RADIUS_PX,
  DIAGNOSTIC_LABEL_FROM_PX,
  clusterMarkers,
  diagnosticsClustered,
  placeBadges,
  sectionArrowSegments,
  sectionBadgeMinLength,
  sectionBadgeWanted,
  type BadgeBox,
  type MarkerSeverity,
} from './lodOverlays'
import { textWidth } from './textWidth'
import { formatDistance as formatUnitsDistance, type Unit, type ScalePresetId } from '@domain/models/units'
import {
  deckAbutments,
  groupPiecesByLevel,
  nodeJointBand,
  segmentLevelPieces,
  trackPositionBand,
  type TrackPiece,
} from './levelPieces'

/** Choose a grid spacing (in world units) that keeps cells ~40–80 px on screen. */
export function pickSpacing(scale: number): number {
  const target = 60 / scale // desired cell size in world units
  const power = Math.floor(Math.log10(target))
  const base = target / 10 ** power
  let step: number
  if (base < 1.5) step = 1
  else if (base < 3.5) step = 2
  else if (base < 7.5) step = 5
  else step = 10
  return step * 10 ** power
}

function getCanvasStyle(canvas: HTMLCanvasElement | undefined, prop: string, fallback: string): string {
  try {
    if (typeof window !== 'undefined' && window.getComputedStyle && canvas) {
      return window.getComputedStyle(canvas).getPropertyValue(prop).trim() || fallback
    }
  } catch {
    // Fallback for headless environments
  }
  return fallback
}

export function renderGrid(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  customSpacing?: number,
): void {
  ctx.save()

  // Fill background
  const bg = getCanvasStyle(ctx.canvas, '--paper', '#fff')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, vw, vh)

  const minor = getCanvasStyle(ctx.canvas, '--grid', 'rgba(0,0,0,0.06)')
  const major = getCanvasStyle(ctx.canvas, '--grid-major', 'rgba(0,0,0,0.12)')

  const rawSpacing = customSpacing && customSpacing > 0 ? customSpacing : pickSpacing(cam.scale)
  
  // Calculate effective spacing on screen to avoid overdraw / performance drops when zoomed out
  let stepMult = 1
  while (rawSpacing * stepMult * cam.scale < 8) {
    if (stepMult === 1) stepMult = 5
    else if (stepMult === 5) stepMult = 10
    else stepMult *= 5
  }
  const spacing = rawSpacing * stepMult

  const halfW = vw / 2 / cam.scale
  const halfH = vh / 2 / cam.scale

  const left = cam.x - halfW
  const right = cam.x + halfW
  const top = cam.y - halfH
  const bottom = cam.y + halfH

  const startX = Math.floor(left / spacing) * spacing
  const endX = Math.ceil(right / spacing) * spacing
  const startY = Math.floor(top / spacing) * spacing
  const endY = Math.ceil(bottom / spacing) * spacing

  ctx.lineWidth = 1

  // Minor grid lines
  ctx.strokeStyle = minor
  ctx.beginPath()
  for (let wx = startX; wx <= endX; wx += spacing) {
    const sx = (wx - cam.x) * cam.scale + vw / 2
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, vh)
  }
  for (let wy = startY; wy <= endY; wy += spacing) {
    const sy = (wy - cam.y) * cam.scale + vh / 2
    ctx.moveTo(0, sy)
    ctx.lineTo(vw, sy)
  }
  ctx.stroke()

  // Major grid lines (every 5th)
  ctx.strokeStyle = major
  ctx.beginPath()
  const majorSpacing = spacing * 5
  for (let wx = Math.floor(left / majorSpacing) * majorSpacing; wx <= endX; wx += majorSpacing) {
    const sx = (wx - cam.x) * cam.scale + vw / 2
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, vh)
  }
  for (let wy = Math.floor(top / majorSpacing) * majorSpacing; wy <= endY; wy += majorSpacing) {
    const sy = (wy - cam.y) * cam.scale + vh / 2
    ctx.moveTo(0, sy)
    ctx.lineTo(vw, sy)
  }
  ctx.stroke()

  // Origin marker
  const ox = (0 - cam.x) * cam.scale + vw / 2
  const oy = (0 - cam.y) * cam.scale + vh / 2
  if (ox >= -10 && ox <= vw + 10 && oy >= -10 && oy <= vh + 10) {
    ctx.strokeStyle = major
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(ox - 8, oy)
    ctx.lineTo(ox + 8, oy)
    ctx.moveTo(ox, oy - 8)
    ctx.lineTo(ox, oy + 8)
    ctx.stroke()
  }

  ctx.restore()
}

/**
 * Render the model railway layout baseboard ("Tableau / Plateau de réseau").
 * Visualizes the physical boundaries of the table with CAD corner marks, drop shadow,
 * exterior canvas dimming, and edge dimension indicators.
 */
export function renderBaseboard(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  boardWidth: number, // in meters
  boardHeight: number, // in meters
  unit: Unit = 'm',
  scalePreset: ScalePresetId = 'HO',
): void {
  if (boardWidth <= 0 || boardHeight <= 0) return

  const halfW = boardWidth / 2
  const halfH = boardHeight / 2

  const sx1 = (-halfW - cam.x) * cam.scale + vw / 2
  const sy1 = (-halfH - cam.y) * cam.scale + vh / 2
  const sx2 = (halfW - cam.x) * cam.scale + vw / 2
  const sy2 = (halfH - cam.y) * cam.scale + vh / 2

  const bx = Math.min(sx1, sx2)
  const by = Math.min(sy1, sy2)
  const bw = Math.abs(sx2 - sx1)
  const bh = Math.abs(sy2 - sy1)

  ctx.save()

  // 1. Dimming exterior (outside table) so the table clearly pops out
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)'
  if (by > 0) ctx.fillRect(0, 0, vw, Math.min(vh, by))
  if (by + bh < vh) ctx.fillRect(0, Math.max(0, by + bh), vw, vh - Math.max(0, by + bh))
  if (bx > 0) ctx.fillRect(0, Math.max(0, by), Math.min(vw, bx), Math.min(vh, bh))
  if (bx + bw < vw) ctx.fillRect(Math.max(0, bx + bw), Math.max(0, by), vw - Math.max(0, bx + bw), Math.min(vh, bh))

  // 2. Board border & subtle drop shadow
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.22)'
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 3

  const borderColor = getCanvasStyle(ctx.canvas, '--accent', '#2563eb')
  ctx.strokeStyle = borderColor
  ctx.lineWidth = 2
  ctx.strokeRect(bx, by, bw, bh)
  ctx.restore()

  // 3. Technical CAD Corner Brackets
  const bracketLen = Math.min(32, Math.max(10, 16 * (cam.scale / 100)))
  ctx.strokeStyle = borderColor
  ctx.lineWidth = 3
  ctx.beginPath()
  // Top-left
  ctx.moveTo(bx, by + bracketLen)
  ctx.lineTo(bx, by)
  ctx.lineTo(bx + bracketLen, by)
  // Top-right
  ctx.moveTo(bx + bw - bracketLen, by)
  ctx.lineTo(bx + bw, by)
  ctx.lineTo(bx + bw, by + bracketLen)
  // Bottom-right
  ctx.moveTo(bx + bw, by + bh - bracketLen)
  ctx.lineTo(bx + bw, by + bh)
  ctx.lineTo(bx + bw - bracketLen, by + bh)
  // Bottom-left
  ctx.moveTo(bx + bracketLen, by + bh)
  ctx.lineTo(bx, by + bh)
  ctx.lineTo(bx, by + bh - bracketLen)
  ctx.stroke()

  // 4. Dimension Badges along the edges
  if (bw > 60 && bh > 40) {
    ctx.font = '600 11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // Top edge badge (Width)
    const topText = `Largeur : ${formatUnitsDistance(boardWidth, unit)}`
    const topW = ctx.measureText(topText).width + 16
    const topX = Math.max(topW / 2 + 10, Math.min(vw - topW / 2 - 10, bx + bw / 2))
    const topY = Math.max(14, Math.min(vh - 14, by - 12))

    ctx.fillStyle = '#1e293b'
    ctx.beginPath()
    ctx.roundRect(topX - topW / 2, topY - 9, topW, 18, 4)
    ctx.fill()
    ctx.fillStyle = '#f8fafc'
    ctx.fillText(topText, topX, topY)

    // Left edge badge (Height / Depth)
    const leftText = `Profondeur : ${formatUnitsDistance(boardHeight, unit)}`
    const leftW = ctx.measureText(leftText).width + 16
    const leftX = Math.max(leftW / 2 + 10, Math.min(vw - leftW / 2 - 10, bx - 14))
    const leftY = Math.max(20, Math.min(vh - 20, by + bh / 2))

    ctx.fillStyle = '#1e293b'
    ctx.beginPath()
    ctx.roundRect(leftX - leftW / 2, leftY - 9, leftW, 18, 4)
    ctx.fill()
    ctx.fillStyle = '#f8fafc'
    ctx.fillText(leftText, leftX, leftY)

    // Title badge in corner inside board
    const titleText = `Plateau ${scalePreset} (${formatUnitsDistance(boardWidth, unit)} × ${formatUnitsDistance(boardHeight, unit)})`
    const titleW = ctx.measureText(titleText).width + 16
    const titleX = bx + 12 + titleW / 2
    const titleY = by + 18
    if (titleX + titleW / 2 < bx + bw && titleY + 12 < by + bh) {
      ctx.fillStyle = 'rgba(30, 41, 59, 0.85)'
      ctx.beginPath()
      ctx.roundRect(bx + 12, by + 8, titleW, 20, 4)
      ctx.fill()
      ctx.fillStyle = '#f8fafc'
      ctx.fillText(titleText, titleX, titleY)
    }
  }

  ctx.restore()
}

// --- Rail rendering (Real scale UIC / French railway standard: 1 unit = 1 meter) ---

/** Standard UIC gauge: 1.435 m (Voie normale standard: France LGV / TER / Intercités) */
export const GAUGE = 1.435

/** Rail head width UIC 60: ~0.07 m (72 mm) */
export const RAIL_WIDTH = 0.07

/** Sleeper spacing in meters: ~0.60 m (standard 60 cm on SNCF mainline) */
export const SLEEPER_SPACING = 0.60
/** Sleeper length in meters: 2.60 m (standard traverse béton monobloc/bois) */
export const SLEEPER_LENGTH = 2.60
/** Sleeper width in meters: 0.28 m (28 cm) */
export const SLEEPER_WIDTH = 0.28
/** Ballast roadbed width in meters: ~3.20 m */
export const BALLAST_WIDTH = 3.20

/** Minimum curve radius for full-speed classical tracks (meters) */
export const MIN_RADIUS = 150.0

/**
 * Below this scale (pixels per meter) the previews of the drawing tools in `Canvas.tsx` are a plain
 * line. The network itself no longer reads it: its tiers come from `trackLod`.
 */
export const SIMPLIFY_THRESHOLD = 0.05

export interface ViewportBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * Compute the world-coordinate bounding box of the visible viewport,
 * expanded by a safety margin in world units.
 */
export function getViewportBounds(
  cam: Camera,
  vw: number,
  vh: number,
  marginScreenPx = 60,
): ViewportBounds {
  const halfW = vw / 2 / cam.scale
  const halfH = vh / 2 / cam.scale
  const marginWorld = Math.max(marginScreenPx / cam.scale, 60)
  return {
    minX: cam.x - halfW - marginWorld,
    maxX: cam.x + halfW + marginWorld,
    minY: cam.y - halfH - marginWorld,
    maxY: cam.y + halfH + marginWorld,
  }
}

/**
 * Fast AABB check for a 2D point.
 */
export function isPointInBounds(p: Point, b: ViewportBounds): boolean {
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY
}

/**
 * Fast AABB check for a segment (straight or quadratic curve).
 * Uses conservative convex hull bounding box for curves.
 */
export function isSegmentInBounds(
  a: Point,
  b: Point,
  via: Point | undefined,
  bounds: ViewportBounds,
): boolean {
  let minX = a.x < b.x ? a.x : b.x
  let maxX = a.x > b.x ? a.x : b.x
  let minY = a.y < b.y ? a.y : b.y
  let maxY = a.y > b.y ? a.y : b.y

  if (via) {
    if (via.x < minX) minX = via.x
    if (via.x > maxX) maxX = via.x
    if (via.y < minY) minY = via.y
    if (via.y > maxY) maxY = via.y
  }

  // If outside viewport on any axis, it is completely culled
  if (maxX < bounds.minX || minX > bounds.maxX) return false
  if (maxY < bounds.minY || minY > bounds.maxY) return false

  return true
}

/** True when the points at `nodeId` are set against this rail (see `isRailClosedAt`) */
export function isInactiveBranchAtNode(net: Network, segId: string, nodeId: NodeId): boolean {
  return isRailClosedAt(net, segId, nodeId)
}

/** Visual length (in meters) of the turnout mechanism/divergence zone */
export const TURNOUT_ZONE_LENGTH = 25

export interface SegmentSubInterval {
  t0: number
  t1: number
  isTurnout: boolean
}

/**
 * Subdivide a quadratic Bezier curve [p0, via, p2] between parameters t0 and t1.
 * Uses exact de Casteljau / Bezier derivative reparameterization.
 */
export function subdivideCurve(
  p0: Point,
  via: Point,
  p2: Point,
  t0: number,
  t1: number,
): { p0: Point; via: Point; p2: Point } {
  if (t0 <= 0 && t1 >= 1) {
    return { p0, via, p2 }
  }
  const subP0 = bezierPoint(t0, p0, via, p2)
  const subP2 = bezierPoint(t1, p0, via, p2)
  const d0 = bezierDerivative1(t0, p0, via, p2)
  const dt = t1 - t0
  const subVia = {
    x: subP0.x + (dt / 2) * d0.x,
    y: subP0.y + (dt / 2) * d0.y,
  }
  return { p0: subP0, via: subVia, p2: subP2 }
}

/**
 * Subdivide a straight line [p0, p2] between parameters t0 and t1.
 */
export function subdivideStraight(
  p0: Point,
  p2: Point,
  t0: number,
  t1: number,
): { a: Point; b: Point } {
  if (t0 <= 0 && t1 >= 1) {
    return { a: p0, b: p2 }
  }
  const dx = p2.x - p0.x
  const dy = p2.y - p0.y
  return {
    a: { x: p0.x + t0 * dx, y: p0.y + t0 * dy },
    b: { x: p0.x + t1 * dx, y: p0.y + t1 * dy },
  }
}

const intervalsKept = new WeakMap<Network, { token: number; ofRail: Map<string, SegmentSubInterval[]> }>()

/**
 * `getSegmentRenderIntervals` for the rails of a frame: what is worked out for a rail is kept until
 * the network changes (its revision, see `networkWatch`), points thrown included. The intervals
 * returned are shared: not to be modified.
 */
export function segmentRenderIntervals(net: Network): (seg: Segment, a: Point, b: Point) => SegmentSubInterval[] {
  const token = networkCheckToken(net)
  if (token === undefined) return (seg, a, b) => getSegmentRenderIntervals(net, seg, a, b)
  let kept = intervalsKept.get(net)
  if (!kept || kept.token !== token) {
    kept = { token, ofRail: new Map() }
    intervalsKept.set(net, kept)
  }
  const ofRail = kept.ofRail
  return (seg, a, b) => {
    let intervals = ofRail.get(seg.id)
    if (!intervals) {
      intervals = getSegmentRenderIntervals(net, seg, a, b)
      ofRail.set(seg.id, intervals)
    }
    return intervals
  }
}

/**
 * Compute sub-intervals for rendering a segment.
 * If the segment connects to an inactive turnout at seg.from or seg.to,
 * only the TURNOUT_ZONE_LENGTH portion adjacent to the switch apex is marked as isTurnout = true (dimmed),
 * while the rest of the track maintains normal full opacity.
 */
export function getSegmentRenderIntervals(
  net: Network,
  seg: Segment,
  a: Point,
  b: Point,
): SegmentSubInterval[] {
  const fromInactive = isInactiveBranchAtNode(net, seg.id, seg.from)
  const toInactive = isInactiveBranchAtNode(net, seg.id, seg.to)

  if (!fromInactive && !toInactive) {
    return [{ t0: 0, t1: 1, isTurnout: false }]
  }

  const len = seg.kind === 'curve' && seg.via
    ? curveLength(a, seg.via, b)
    : Math.hypot(b.x - a.x, b.y - a.y)

  if (len <= 0.1) {
    return [{ t0: 0, t1: 1, isTurnout: true }]
  }

  const tTurnout = TURNOUT_ZONE_LENGTH / len

  if (fromInactive && toInactive) {
    if (2 * tTurnout >= 0.99) {
      return [{ t0: 0, t1: 1, isTurnout: true }]
    }
    return [
      { t0: 0, t1: tTurnout, isTurnout: true },
      { t0: tTurnout, t1: 1 - tTurnout, isTurnout: false },
      { t0: 1 - tTurnout, t1: 1, isTurnout: true },
    ]
  }

  if (fromInactive) {
    if (tTurnout >= 0.99) {
      return [{ t0: 0, t1: 1, isTurnout: true }]
    }
    return [
      { t0: 0, t1: tTurnout, isTurnout: true },
      { t0: tTurnout, t1: 1, isTurnout: false },
    ]
  }

  // toInactive
  if (tTurnout >= 0.99) {
    return [{ t0: 0, t1: 1, isTurnout: true }]
  }
  return [
    { t0: 0, t1: 1 - tTurnout, isTurnout: false },
    { t0: 1 - tTurnout, t1: 1, isTurnout: true },
  ]
}

export interface RenderNetworkOptions {
  tool?: string
  hideConstructionNodes?: boolean
  hideSectionCenterline?: boolean
  onlyRenamedSectionBadges?: boolean
  /** No band under the rails of the speed zones; their boards stay (plain driving view) */
  hideSpeedZoneBands?: boolean
  /**
   * Never the detailed drawing of the rails, however close the view: the two rails as plain
   * strokes, without their head nor their joints (plain driving view)
   */
  plainRails?: boolean
  /** No section badge at all, selected section included (driving view) */
  hideSectionBadges?: boolean
  /**
   * Screen rectangle kept free of section badges (the gizmo of the selection): a badge that
   * would overlap it is drawn just below instead.
   */
  badgeExclusion?: { x: number; y: number; w: number; h: number }
  /** Nodes that get no diagnostic warning: the start node of the placement in progress */
  quietNodeIds?: ReadonlySet<string>
  /** Rail gauge of the layout: scales the distance thresholds of the diagnostics */
  gauge?: number
  /**
   * Draw only one part of the network: the rails (with their bridge decks), or everything that
   * sits on top of them (badges, signs, nodes, diagnostics). Absent: both, in one call.
   * Used to slip the trains between two track levels (`renderNetworkWithTrains`).
   */
  part?: 'tracks' | 'overlays'
  /** Rails of this level only (see `segmentLevelPieces`). Absent: every level, lowest first. */
  level?: number
  /**
   * Height of one level and steepest slope allowed: with it, a ramp steeper than that is reported
   * by the diagnostic marker. Absent: slopes are not checked.
   */
  gradient?: GradientLimits
  /** Speed zones that stand out (signalling mode). Absent: every zone is drawn plain. */
  speedZones?: SpeedZoneHighlight
  /** Signals, blocks and what goes with them (see `renderSignalling`). Absent: no signal is drawn. */
  signals?: SignalRenderOptions
  /**
   * Cant and slopes marked on the track (`cantRender.ts`, `gradientRender.ts`). Absent: neither is
   * drawn. The cant is read under `line` — full size only — and the slopes need `gradient`.
   */
  inclination?: { line: LineSettings }
}

// ─────────────────── Track levels (bridges and tunnels) ───────────────────

/** Bridge deck width, in metres for a standard-gauge track: wider than the ballast it carries. */
export const DECK_WIDTH = BALLAST_WIDTH * 1.45
/** Width of the parapet drawn along each edge of a bridge deck. */
export const DECK_PARAPET_WIDTH = 0.30
/** Opacity of a rail below ground (tunnel). */
export const TUNNEL_ALPHA = 0.4
/** Dash pattern (screen px) of a rail below ground. */
export const TUNNEL_DASH = [6, 5]
/** Opacity of a vehicle running in a tunnel. */
export const TUNNEL_VEHICLE_ALPHA = 0.35

/** Levels `above` (excluded) to `upTo` (included): what one pass of the layered drawing covers. */
export interface LevelBand {
  above: number
  upTo: number
}

export function inLevelBand(level: number, band?: LevelBand): boolean {
  return !band || (level > band.above && level <= band.upTo)
}

/** Drawing level of the rail under a bogie: its real height there (see `heightBand`). */
export function trackPositionLevel(net: Network, pos: { segId: string; t: number }): number {
  return trackPositionBand(net, pos)
}

/**
 * Level of a vehicle: the height of the rail under its bogies, the higher of the two when it
 * straddles a change of level. At the foot of a ramp it is still on the ground.
 */
export function vehicleLevel(
  net: Network,
  vehicle: { front: { segId: string; t: number }; rear: { segId: string; t: number } },
): number {
  return Math.max(trackPositionLevel(net, vehicle.front), trackPositionLevel(net, vehicle.rear))
}

/** The rails in view (`isSegmentInBounds`), in the order of the network, found on its grid */
function segmentsInBounds(net: Network, bounds: ViewportBounds): Segment[] {
  return railsInBox(net, bounds)
}

/** Whether any node of the network is off the ground, kept until the network changes */
const leveled = new WeakMap<Network, { token: number; any: boolean }>()

function hasLevels(net: Network): boolean {
  const token = networkCheckToken(net)
  const known = leveled.get(net)
  if (token !== undefined && known && known.token === token) return known.any
  let any = false
  for (const node of net.nodes.values()) {
    if (node.level) {
      any = true
      break
    }
  }
  if (token !== undefined) leveled.set(net, { token, any })
  return any
}

/** Levels of the rails in view, lowest first. A network without bridge or tunnel gives `[0]`. */
export function visibleTrackLevels(net: Network, cam: Camera, vw: number, vh: number): number[] {
  if (!hasLevels(net)) return [0]
  const levels = new Set<number>()
  for (const seg of segmentsInBounds(net, getViewportBounds(cam, vw, vh, 80))) {
    for (const piece of segmentLevelPieces(net, seg)) levels.add(piece.band)
  }
  return [...levels].sort((x, y) => x - y)
}

/** Geometry of a piece of rail: the whole rail, or the part of it between `t0` and `t1` */
function pieceGeometry(net: Network, piece: TrackPiece): { a: Point; b: Point; via?: Point } | null {
  const from = net.nodes.get(piece.seg.from)
  const to = net.nodes.get(piece.seg.to)
  if (!from || !to) return null
  if (piece.seg.kind === 'curve' && piece.seg.via) {
    const sub = subdivideCurve(from.pos, piece.seg.via, to.pos, piece.t0, piece.t1)
    return { a: sub.p0, b: sub.p2, via: sub.via }
  }
  return subdivideStraight(from.pos, to.pos, piece.t0, piece.t1)
}

function traceCenterline(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  a: Point,
  b: Point,
  via?: Point,
): void {
  ctx.beginPath()
  ctx.moveTo((a.x - cam.x) * cam.scale + vw / 2, (a.y - cam.y) * cam.scale + vh / 2)
  const bx = (b.x - cam.x) * cam.scale + vw / 2
  const by = (b.y - cam.y) * cam.scale + vh / 2
  if (via) {
    ctx.quadraticCurveTo((via.x - cam.x) * cam.scale + vw / 2, (via.y - cam.y) * cam.scale + vh / 2, bx, by)
  } else {
    ctx.lineTo(bx, by)
  }
}

/**
 * Bridge decks of the pieces of rail of one level above ground: an opaque band wider than the
 * ballast, with a parapet along each edge, that hides whatever runs below. Drawn before the rails
 * it carries. A ramp only has a deck over the part that is more than half a level up; where the
 * deck starts (`deckAbutments`) it gets an abutment: a closing line and two splayed wing walls, the
 * usual map symbol of a bridge end.
 */
export function renderBridgeDecks(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  pieces: TrackPiece[],
  level: number,
  gauge: number = GAUGE,
): void {
  if (level <= 0 || pieces.length === 0) return
  const paper = getCanvasStyle(ctx.canvas, '--paper', '#ffffff')
  const ink = getCanvasStyle(ctx.canvas, '--ink', '#1a1a1a')
  const edge = getCanvasStyle(ctx.canvas, '--rail', '#526071')

  const s = cam.scale
  const ratio = gauge / GAUGE
  const halfDeck = (DECK_WIDTH * ratio) / 2
  const deckPx = DECK_WIDTH * ratio * s
  const parapetPx = Math.max(1, DECK_PARAPET_WIDTH * ratio * s)

  ctx.save()
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'

  // Parapets: the full width in the rail colour, the deck itself is laid over its middle. All the
  // parapets first, so that the deck of one span never gets cut by the edge of the next.
  ctx.strokeStyle = edge
  ctx.lineWidth = deckPx
  for (const piece of pieces) {
    const e = pieceGeometry(net, piece)
    if (!e) continue
    traceCenterline(ctx, cam, vw, vh, e.a, e.b, e.via)
    ctx.stroke()
  }

  // Deck: the background colour (opaque, it hides the lower rails), lightly tinted with the ink
  // so that it reads as a slab in the light theme as in the dark one.
  ctx.lineWidth = Math.max(1, deckPx - 2 * parapetPx)
  for (const piece of pieces) {
    const e = pieceGeometry(net, piece)
    if (!e) continue
    traceCenterline(ctx, cam, vw, vh, e.a, e.b, e.via)
    ctx.strokeStyle = paper
    ctx.globalAlpha = 1
    ctx.stroke()
    ctx.strokeStyle = ink
    ctx.globalAlpha = 0.08
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // Abutments where a deck starts
  ctx.strokeStyle = edge
  ctx.lineWidth = Math.max(1.5, parapetPx * 1.5)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const wing = halfDeck * 0.6
  for (const piece of pieces) {
    // `tangent` points into the deck: the wings splay the other way
    for (const { pos, tangent, normal } of deckAbutments(net, piece)) {
      const corner = (side: 1 | -1): Point => ({
        x: pos.x + normal.x * halfDeck * side,
        y: pos.y + normal.y * halfDeck * side,
      })
      const tip = (side: 1 | -1): Point => {
        const c = corner(side)
        return { x: c.x + (normal.x * side - tangent.x) * wing, y: c.y + (normal.y * side - tangent.y) * wing }
      }
      const pts = [tip(1), corner(1), corner(-1), tip(-1)].map((p) => w2s(p, cam, vw, vh))
      ctx.beginPath()
      ctx.moveTo(pts[0][0], pts[0][1])
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
      ctx.stroke()
    }
  }

  ctx.restore()
}

/**
 * The network and the trains together. On a single visible level this is what it always was:
 * the whole network, `drawOverTracks`, then the trains on top. As soon as two levels are in
 * view the drawing is interleaved, lowest level first — the rails of a level, then the vehicles
 * standing on it — so that a train passing under a bridge is hidden by its deck; the overlays of
 * the network (badges, signs, nodes, diagnostics) and `drawOverTracks` then come once, last.
 */
export function renderNetworkWithTrains(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  selection: Selection,
  sectionMeta: Record<string, SectionMetadata> | undefined,
  options: RenderNetworkOptions | undefined,
  drawTrains: (band?: LevelBand) => void,
  drawOverTracks?: () => void,
): void {
  // The schematic does not layer the levels: one pass, and no sorting of the rails by level
  const levels = trackLod(cam.scale, GAUGE) === 'schematic' ? [] : visibleTrackLevels(net, cam, vw, vh)
  if (levels.length <= 1) {
    renderNetwork(ctx, cam, vw, vh, net, selection, sectionMeta, options)
    drawOverTracks?.()
    drawTrains()
    return
  }
  levels.forEach((level, i) => {
    renderNetwork(ctx, cam, vw, vh, net, selection, sectionMeta, { ...options, part: 'tracks', level })
    // The outer bands are open-ended: a vehicle whose own rail is out of view is still drawn
    drawTrains({
      above: i === 0 ? -Infinity : levels[i - 1],
      upTo: i === levels.length - 1 ? Infinity : level,
    })
  })
  renderNetwork(ctx, cam, vw, vh, net, selection, sectionMeta, { ...options, part: 'overlays' })
  drawOverTracks?.()
}

export function renderNetwork(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  selection: Selection,
  sectionMeta?: Record<string, SectionMetadata>,
  options?: RenderNetworkOptions,
): void {
  const accent = getCanvasStyle(ctx.canvas, '--accent', '#2563eb')
  const railColor = getCanvasStyle(ctx.canvas, '--rail', '#526071')
  const railHeadColor = getCanvasStyle(ctx.canvas, '--rail-head', '#ffffff')

  const isPan = options?.tool === 'pan'
  const hideConstructionNodes = options?.hideConstructionNodes ?? isPan
  const hideSectionCenterline = options?.hideSectionCenterline ?? isPan
  const onlyRenamedSectionBadges = options?.onlyRenamedSectionBadges ?? isPan

  // Level of detail of this frame: the rails are drawn with the constant `GAUGE`, so it reads that one
  const tier = trackLod(cam.scale, GAUGE)
  const lod = options?.plainRails && tier === 'detail' ? 'rails' : tier

  // View-frustum culling: filter to only segments within or intersecting the viewport
  const bounds = getViewportBounds(cam, vw, vh, 80)
  const derived = networkDerived(net, sectionMeta)
  const trackSections = derived.sections
  const selectedSections = new Set<TrackSection>()
  for (const sid of selection.segments) {
    const sec = derived.sectionOfSegment.get(sid)
    if (sec) selectedSections.add(sec)
  }
  // Speed zones and signalling stay readable when the track is no longer drawn in detail: they
  // only go once the whole network is a few pixels wide
  const showsTrackObjects = cam.scale >= SIMPLIFY_THRESHOLD

  // The schematic draws sections, not rails: no rail is sorted for it, nor for the overlays alone —
  // unless a band or a stripe has to be laid along the rails under the diagram
  const drawsRails = options?.part !== 'overlays' && lod !== 'schematic'
  const underlaysOnly = options?.part !== 'overlays' && lod === 'schematic' && showsTrackObjects &&
    (net.speedZones.size > 0 || options?.signals !== undefined)
  const visibleSegments = drawsRails || underlaysOnly ? segmentsInBounds(net, bounds) : []

  // Rails are drawn level by level, lowest first, so that a bridge covers what runs below it.
  // Without bridge or tunnel there is a single group: the whole network, in its own order.
  // A ramp is cut where it crosses a half level: each piece goes with the level it is really at.
  const allGroups = groupPiecesByLevel(net, visibleSegments)
  const levelGroups = options?.level === undefined ? allGroups : allGroups.filter((g) => g.level === options.level)
  // Each rail joint belongs to one level only when several are drawn
  const jointsByLevel = allGroups.length > 1 || options?.level !== undefined

  // Cant and slopes marked on the track. The profile of the track and the ramps are kept from one
  // frame to the next (`trackProfile`, `networkDerived`): only what is in view is traced here.
  const inclination = options?.inclination
  const cantProfile = inclination && drawsRails && (lod === 'detail' || lod === 'rails') && inclination.line.realScale !== false
    ? trackProfile(net, inclination.line)
    : null
  const cantColor = cantProfile && cantProfile.rails.size > 0 ? getCanvasStyle(ctx.canvas, '--accent', '#2563eb') : ''
  const rampIndex = inclination && options?.gradient && lod !== 'schematic' ? derived.ramps(options.gradient.levelHeight) : null
  const ramps = rampIndex && rampIndex.ramps.length > 0 ? rampIndex : null
  const steepRails = ramps ? derived.steepRails(options?.gauge, options?.gradient) : undefined
  const gradientColors: GradientColors | null = ramps
    ? {
        ink: getCanvasStyle(ctx.canvas, '--ink', '#1a1a1a'),
        alert: getCanvasStyle(ctx.canvas, '--danger', '#dc2626'),
        paper: getCanvasStyle(ctx.canvas, '--paper', '#ffffff'),
      }
    : null

  /** What lies under the rails of a level, whatever the tier the rails are drawn in */
  const drawTrackUnderlays = (pieces: TrackPiece[], level: number): void => {
    if (!showsTrackObjects) return
    const alpha = level < 0 ? TUNNEL_ALPHA : 1
    // Speed zones: a band under the rails of the stretch they limit (on the deck of a bridge)
    if (!options?.hideSpeedZoneBands) renderSpeedZoneBands(ctx, cam, vw, vh, net, pieces, GAUGE, alpha, options?.speedZones, lod)
    // Blocks and track held for the trains: stripes beside the rails of this level
    renderSignalStripes(ctx, cam, vw, vh, net, derived, pieces, alpha, options?.signals)
  }

  /** How the stripe of the section of a rail is drawn */
  const stripeOf = (segId: string): SectionStripeStyle => {
    const sec = derived.sectionOfSegment.get(segId)
    return {
      color: sec?.color ?? '#94a3b8',
      station: sec?.type === 'station_stop',
      selected: sec !== undefined && selectedSections.has(sec),
    }
  }

  // Cant and slope marks belong to the tiers that draw the two rails (detail and rails)
  /** Cant: the outer rail of the canted curves, highlighted under the rails */
  const drawCantMarks = (pieces: TrackPiece[], level: number): void => {
    if (!cantProfile || !cantColor) return
    renderCantMarks(ctx, cam, vw, vh, net, pieces, cantProfile, GAUGE, GAUGE, level < 0 ? TUNNEL_ALPHA : 1, cantColor)
  }
  /** Slopes: chevrons between the rails of the ramps, pointing up */
  const drawGradientChevrons = (pieces: TrackPiece[], level: number): void => {
    if (!ramps || !steepRails || !gradientColors) return
    renderGradientChevrons(ctx, cam, vw, vh, net, pieces, ramps, steepRails, GAUGE, level < 0 ? TUNNEL_ALPHA : 1, gradientColors)
  }

  const drawDetailedTracks = (pieces: TrackPiece[], level: number): void => {
    // 0. BRIDGE DECK under the rails of a level above ground
    renderBridgeDecks(ctx, cam, vw, vh, net, pieces, level, GAUGE)
    const tunnel = level < 0

    drawTrackUnderlays(pieces, level)
    drawCantMarks(pieces, level)

    // 1. SECTION CENTERLINE (Ligne d'axe teintée par section / canton)
    // A subtle coloured stripe in the middle of the track tells the sections apart: one stroke per colour
    if (!hideSectionCenterline) renderSectionStripes(ctx, cam, vw, vh, net, pieces, level, stripeOf)

    // 2. PURE RAIL RENDERING: the two rails of every piece, gathered by style
    renderDetailRails(ctx, cam, vw, vh, net, pieces, level, selection.segments, { rail: railColor, accent, head: railHeadColor }, GAUGE)
    // Connect rails and create smooth dynamic miter joints at nodes
    if (tunnel) {
      ctx.save()
      ctx.globalAlpha = TUNNEL_ALPHA
    }
    renderRailJoints(ctx, cam, vw, vh, net, selection, railColor, accent, bounds, GAUGE, jointsByLevel ? level : undefined)
    if (tunnel) ctx.restore()
    drawGradientChevrons(pieces, level)
  }

  if (options?.part !== 'overlays') {
    if (lod === 'schematic') {
      for (const group of levelGroups) drawTrackUnderlays(group.pieces, group.level)
      // Once for the whole network: the levels are not layered in this tier
      renderSchematicTracks(ctx, cam, vw, vh, derived.sectionPolylines(), bounds, selectedSections, { rail: railColor, accent })
    } else if (lod === 'line') {
      const paper = levelGroups.some((g) => g.level > 0) ? getCanvasStyle(ctx.canvas, '--paper', '#ffffff') : ''
      for (const group of levelGroups) {
        drawTrackUnderlays(group.pieces, group.level)
        renderLineTracks(ctx, cam, vw, vh, net, group.pieces, group.level, selection.segments, { rail: railColor, accent, paper }, GAUGE)
      }
    } else if (lod === 'rails') {
      // The two rails of every track in a handful of strokes, then the stripe of the sections
      const paper = getCanvasStyle(ctx.canvas, '--paper', '#ffffff')
      for (const group of levelGroups) {
        drawTrackUnderlays(group.pieces, group.level)
        drawCantMarks(group.pieces, group.level)
        renderLineTracks(ctx, cam, vw, vh, net, group.pieces, group.level, selection.segments, { rail: railColor, accent, paper }, GAUGE, true)
        if (!hideSectionCenterline) renderSectionStripes(ctx, cam, vw, vh, net, group.pieces, group.level, stripeOf)
        drawGradientChevrons(group.pieces, group.level)
      }
    } else {
      for (const group of levelGroups) drawDetailedTracks(group.pieces, group.level)
    }
  }
  if (options?.part === 'tracks') return

  // Pixels between the two rails: what the thresholds of the overlays are measured against
  const gaugePx = gaugeOnScreen(cam.scale, GAUGE)

  /** Screen rectangles the slope labels must keep clear of: section badges, then diagnostic markers */
  const takenBoxes: BadgeBox[] = []
  {
    // 3. SECTION BADGES (LOD: multi-level representation according to the gauge on screen)
    // - Below BADGES_ALL_FROM_PX (macro view, schematic tier included): only the selected section
    //   and the ones the user renamed
    // - Up to BADGE_FULL_FROM_PX (overview): compact badge (name + arrow) only if section is >= 45px on screen
    // - From BADGE_FULL_FROM_PX (detailed view): full badge with type prefix, name, arrow, and exact length
    // A badge never covers another one: they are all measured first, then `placeBadges` keeps
    // the ones that fit, by priority.
    const fullBadges = gaugePx >= BADGE_FULL_FROM_PX
    const badges: (BadgeBox & { sec: TrackSection; text: string; cx: number; cy: number })[] = []
    ctx.save()
    ctx.font = '600 10px Archivo, system-ui, sans-serif'
    // Where each badge stands is kept with the sections: most are out of view and set aside on that alone
    const anchors = options?.hideSectionBadges ? null : derived.sectionBadgeAnchors()
    for (let i = 0; anchors && i < trackSections.length; i++) {
      const midPt = { x: anchors[2 * i], y: anchors[2 * i + 1] }
      // (a badge without a place — NaN — is in no view)
      if (!isPointInBounds(midPt, bounds)) continue
      const sec = trackSections[i]
      const isSecSelected = selectedSections.has(sec)
      const renamed = isRenamedSection(sec)

      if (onlyRenamedSectionBadges) {
        // En mode déplacement / vue épurée : uniquement les voies renommées par l'utilisateur
        if (!renamed) continue
        if (sec.totalLength * cam.scale < 30 && !isSecSelected) continue
      } else {
        if (!sectionBadgeWanted(gaugePx, { selected: isSecSelected, renamed })) continue

        // Not on a track too short on screen for this zoom: tiny fragments up close, all but the
        // long tracks once the drawing is no longer the detailed one
        const secScreenLen = sec.totalLength * cam.scale
        if (!isSecSelected && !renamed && secScreenLen < sectionBadgeMinLength(lod, gaugePx)) continue
      }

      const sx = (midPt.x - cam.x) * cam.scale + vw / 2
      const sy = (midPt.y - cam.y) * cam.scale + vh / 2

      const dirSymbol = sec.direction === 'forward' ? ' →' : sec.direction === 'backward' ? ' ←' : ''
      let text: string
      if (fullBadges || isSecSelected) {
        const typePrefix = sec.type === 'station_stop' ? 'Quai · ' : sec.type === 'siding' ? 'Évit. · ' : ''
        text = `${typePrefix}${sec.name}${dirSymbol} (${sec.totalLength.toFixed(1)} m)`
      } else {
        // Compact LOD
        text = `${sec.name}${dirSymbol}`
      }

      const bgW = textWidth(ctx, text) + 12
      const bgH = 18
      let badgeY = sy - 14
      const keepOut = options?.badgeExclusion
      if (
        keepOut &&
        sx + bgW / 2 > keepOut.x && sx - bgW / 2 < keepOut.x + keepOut.w &&
        badgeY + bgH / 2 > keepOut.y && badgeY - bgH / 2 < keepOut.y + keepOut.h
      ) {
        badgeY = keepOut.y + keepOut.h + bgH / 2 + 2
      }
      badges.push({
        x: sx - bgW / 2, y: badgeY - bgH / 2, w: bgW, h: bgH,
        selected: isSecSelected, renamed, length: sec.totalLength,
        sec, text, cx: sx, cy: badgeY,
      })
    }
    ctx.restore()

    const placedBadges = placeBadges(badges)
    for (const badge of placedBadges) {
      const { sec, text, cx: sx, cy: badgeY, w: bgW, h: bgH, selected: isSecSelected } = badge
      ctx.save()
      ctx.font = '600 10px Archivo, system-ui, sans-serif'

      // Pill background
      ctx.fillStyle = isSecSelected ? sec.color : sec.type === 'station_stop' ? 'rgba(8, 51, 68, 0.92)' : 'rgba(30, 41, 59, 0.85)'
      ctx.beginPath()
      ctx.roundRect(sx - bgW / 2, badgeY - bgH / 2, bgW, bgH, 4)
      ctx.fill()

      // Border with section color
      ctx.strokeStyle = sec.color
      ctx.lineWidth = sec.type === 'station_stop' ? 1.8 : 1.2
      ctx.stroke()

      // Label text
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, sx, badgeY)
      ctx.restore()
    }

    // The slope labels are placed further down, once the diagnostic markers are known
    for (const b of placedBadges) takenBoxes.push({ x: b.x, y: b.y, w: b.w, h: b.h, selected: true, renamed: false, length: b.length })
  }

  // Speed zone boards (part of the track: they stay in driving mode) and overlap warnings. Hidden
  // with the bands at far zoom.
  if (showsTrackObjects) {
    renderSpeedZoneMarkers(ctx, cam, vw, vh, net, derived, {
      highlight: options?.speedZones,
      gauge: GAUGE,
      showOverlaps: !hideConstructionNodes,
    })
    // Signals stand beside the track, above the rails; hidden with the boards at far zoom
    if (options?.signals) renderSignalling(ctx, cam, vw, vh, net, derived, options.signals)
  }

  // 4. END OF TRACK / FIN DE VOIE: a buffer stop, which is where trains stop. Part of the track,
  // so it stays in driving mode. (The no-entry sign is kept for direction conflicts, see 7.)
  // Detail and rails tiers only: further out it is smaller than the stroke of the rail it ends.
  for (const node of lod === 'detail' || lod === 'rails' ? nodesInBox(net, bounds) : []) {
    if ((net.adjacency.get(node.id) ?? []).length === 1) {
      renderBufferStop(ctx, cam, node, net, vw, vh, options?.gauge ?? GAUGE)
    }
  }

  // 5. NODES (Points d'articulation et sélection)
  if (!hideConstructionNodes) {
    // The plain joints are by far the most numerous: they are gathered and drawn in two fills,
    // under the markers that stand out (selection, end of track, crossing)
    const shown: { sx: number; sy: number; selected: boolean; connectionCount: number }[] = []
    const plain: number[] = []
    // Away from the two detailed tiers only the selected nodes show and, in the line tier, the ends
    // of track (`nodeMarkerShown`): those are looked up instead of every node in view
    const few = lod === 'schematic' ? selection.nodes : lod === 'line' ? new Set([...selection.nodes, ...derived.deadEnds()]) : null
    for (const node of (few && nodesAmongInBox(net, few, bounds)) ?? nodesInBox(net, bounds)) {
      const selected = selection.nodes.has(node.id)
      const connectionCount = (net.adjacency.get(node.id) ?? []).length
      if (!nodeMarkerShown(lod, { selected, degree: connectionCount })) continue
      const sx = (node.pos.x - cam.x) * cam.scale + vw / 2
      const sy = (node.pos.y - cam.y) * cam.scale + vh / 2
      if (!selected && connectionCount !== 0 && connectionCount !== 1 && connectionCount !== 4) plain.push(sx, sy)
      else shown.push({ sx, sy, selected, connectionCount })
    }
    if (plain.length > 0) {
      // Intermediate joint or junction: neat white dot
      const discs = (radius: number): void => {
        ctx.beginPath()
        for (let i = 0; i < plain.length; i += 2) {
          ctx.moveTo(plain[i] + radius, plain[i + 1])
          ctx.arc(plain[i], plain[i + 1], radius, 0, Math.PI * 2)
        }
        ctx.fill()
      }
      ctx.fillStyle = '#334155'
      discs(4)
      ctx.fillStyle = '#ffffff'
      discs(2.5)
    }
    for (const { sx, sy, selected, connectionCount } of shown) {

      if (selected) {
        // Selected node: accent ring + central white point
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.arc(sx, sy, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(sx, sy, 4, 0, Math.PI * 2)
        ctx.fill()
      } else if (connectionCount === 1) {
        // End of track: a snap point, where the track can be carried on
        ctx.fillStyle = '#ffffff'
        ctx.strokeStyle = accent
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(sx, sy, 5.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.fillStyle = accent
        ctx.beginPath()
        ctx.arc(sx, sy, 2, 0, Math.PI * 2)
        ctx.fill()
      } else if (connectionCount === 0) {
        // Isolated / orphan node (0 connected tracks): render clear visible indicator so it is never an invisible ghost
        ctx.save()
        ctx.strokeStyle = '#f59e0b'
        ctx.lineWidth = 1.5
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.arc(sx, sy, 6, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = '#f59e0b'
        ctx.beginPath()
        ctx.arc(sx, sy, 2.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      } else if (connectionCount === 4) {
        // Diamond crossing intersection node (zone de cisaillement / conflit logique)
        const dSize = Math.max(3.5, Math.min(6, 1.2 * cam.scale))
        ctx.save()
        ctx.fillStyle = '#0f172a'
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(sx, sy - dSize)
        ctx.lineTo(sx + dSize, sy)
        ctx.lineTo(sx, sy + dSize)
        ctx.lineTo(sx - dSize, sy)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      }
    }
  }

  // 6. CIRCULATION DIRECTION INDICATORS (Discreet directional arrows on one-way sections)
  // One per rail in the detail tier, one per section in the line tier, none in the schematic
  if (!hideConstructionNodes) {
    for (const sec of trackSections) {
      if (sec.direction === 'two_way' || sec.orderedNodeIds.length < 2) continue
      const isForward = sec.direction === 'forward'

      // Draw discreet directional arrow along the segments of the section that carry one
      for (const sid of sectionArrowSegments(lod, sec.segmentIds)) {
        const seg = net.segments.get(sid)
      if (!seg) continue
      const a = net.nodes.get(seg.from)
      const b = net.nodes.get(seg.to)
      if (!a || !b) continue

      // Determine forward direction along the segment based on orderedNodeIds
      const fromIdx = sec.orderedNodeIds.indexOf(seg.from)
      const toIdx = sec.orderedNodeIds.indexOf(seg.to)
      let alongForward = true
      if (fromIdx !== -1 && toIdx !== -1) {
        alongForward = fromIdx < toIdx
      }
      const dirSign = (isForward ? 1 : -1) * (alongForward ? 1 : -1)

      // Center point of segment
      const mid = seg.kind === 'curve' && seg.via
        ? bezierPoint(0.5, a.pos, seg.via, b.pos)
        : { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 }

      if (!isPointInBounds(mid, bounds)) continue

      // Tangent vector
      let tx = b.pos.x - a.pos.x
      let ty = b.pos.y - a.pos.y
      if (seg.kind === 'curve' && seg.via) {
        const tVec = bezierTangent(0.5, a.pos, seg.via, b.pos)
        tx = tVec.x
        ty = tVec.y
      }
      const tLen = Math.hypot(tx, ty)
      if (tLen === 0) continue
      let angle = Math.atan2(ty, tx)
      if (dirSign < 0) angle += Math.PI

      const sx = (mid.x - cam.x) * cam.scale + vw / 2
      const sy = (mid.y - cam.y) * cam.scale + vh / 2

      ctx.save()
      ctx.translate(sx, sy)
      ctx.rotate(angle)
      ctx.fillStyle = sec.color
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1
      ctx.beginPath()
      const arrSize = Math.max(6, Math.min(10, 1.2 * cam.scale))
      ctx.moveTo(arrSize, 0)
      ctx.lineTo(-arrSize * 0.7, -arrSize * 0.6)
      ctx.lineTo(-arrSize * 0.3, 0)
      ctx.lineTo(-arrSize * 0.7, arrSize * 0.6)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
  }
}

  // 7. DIRECTION CONFLICTS / SENS INTERDIT (Panneau sens interdit en cas d'incohérence -> <-)
  if (!hideConstructionNodes) {
    for (const conf of derived.conflicts) {
      if (!isPointInBounds(conf.pos, bounds)) continue
      const sx = (conf.pos.x - cam.x) * cam.scale + vw / 2
      const sy = (conf.pos.y - cam.y) * cam.scale + vh / 2

      ctx.save()
      // Prohibitory sign: Red disc with white horizontal bar (B0 sens interdit)
      const signR = Math.max(10, Math.min(16, 2.2 * cam.scale))
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)'
      ctx.shadowBlur = 6
      ctx.shadowOffsetY = 2

      // Red circle
      ctx.fillStyle = '#dc2626'
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(sx, sy, signR, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      // Reset shadow for inner bar
      ctx.shadowColor = 'transparent'

      // White horizontal rectangle bar
      const barW = signR * 1.4
      const barH = Math.max(2.5, signR * 0.35)
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.roundRect(sx - barW / 2, sy - barH / 2, barW, barH, barH / 2)
      ctx.fill()

      // Pulsing warning text above the sign (the schematic tier keeps the sign alone)
      if (lod !== 'schematic') {
        ctx.font = '700 10px Archivo, system-ui, sans-serif'
        const warnText = 'SENS INTERDIT · CONFLIT'
        const tw = textWidth(ctx, warnText)
        const textY = sy - signR - 12
        ctx.fillStyle = '#dc2626'
        ctx.beginPath()
        ctx.roundRect(sx - tw / 2 - 6, textY - 8, tw + 12, 16, 4)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(warnText, sx, textY)
      }

      ctx.restore()
    }
  }

  // 8. KINEMATIC DIAGNOSTICS (Angles de transition cassés, déraillements, aiguillages incohérents)
  if (!hideConstructionNodes) {
    // One marker per issue, with its label when there is room for it. Once the rails are no
    // longer drawn in detail, the markers that would pile up are merged into one that shows how
    // many it stands for.
    const markers: { x: number; y: number; severity: MarkerSeverity; mark: string; label?: string }[] = []
    for (const issue of derived.kinematicIssues(options?.gauge, options?.gradient)) {
      if (options?.quietNodeIds?.has(issue.nodeId)) continue
      const node = net.nodes.get(issue.nodeId)
      if (!node || !isPointInBounds(node.pos, bounds)) continue
      markers.push({
        x: (node.pos.x - cam.x) * cam.scale + vw / 2,
        y: (node.pos.y - cam.y) * cam.scale + vh / 2,
        severity: issue.severity,
        mark: '!',
        label: gaugePx >= DIAGNOSTIC_LABEL_FROM_PX ? diagnosticLabel(issue) : undefined,
      })
    }
    const drawn = !diagnosticsClustered(lod)
      ? markers
      : clusterMarkers(markers, DIAGNOSTIC_CLUSTER_RADIUS_PX).map((c) => ({
        ...c, mark: c.count > 1 ? String(c.count) : '!',
      }))
    for (const marker of drawn) {
      const { x: sx, y: sy, label } = marker

      ctx.save()
      const isErr = marker.severity === 'error'
      const badgeColor = isErr ? '#ef4444' : '#f59e0b'
      const signR = Math.max(8, Math.min(13, 1.6 * cam.scale))
      // The diamond with its halo
      takenBoxes.push({ x: sx - signR - 4, y: sy - signR - 4, w: 2 * (signR + 4), h: 2 * (signR + 4), selected: true, renamed: false, length: 0 })

      // Pulse halo
      ctx.fillStyle = isErr ? 'rgba(239, 68, 68, 0.25)' : 'rgba(245, 158, 11, 0.25)'
      ctx.beginPath()
      ctx.arc(sx, sy, signR + 4, 0, Math.PI * 2)
      ctx.fill()

      // Diamond badge (shape of a warning diamond / losange de danger ferroviaire)
      ctx.fillStyle = badgeColor
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(sx, sy - signR)
      ctx.lineTo(sx + signR, sy)
      ctx.lineTo(sx, sy + signR)
      ctx.lineTo(sx - signR, sy)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // Exclamation point or angle
      ctx.fillStyle = '#ffffff'
      ctx.font = '900 11px Archivo, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(marker.mark, sx, sy)

      // Label badge above if zoom is reasonable
      if (label !== undefined) {
        ctx.font = '600 10px Archivo, system-ui, sans-serif'
        const tw = textWidth(ctx, label)
        const ty = sy - signR - 10
        takenBoxes.push({ x: sx - tw / 2 - 5, y: ty - 7, w: tw + 10, h: 15, selected: true, renamed: false, length: 0 })

        ctx.fillStyle = badgeColor
        ctx.beginPath()
        ctx.roundRect(sx - tw / 2 - 5, ty - 7, tw + 10, 15, 3)
        ctx.fill()

        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, sx, ty)
      }

      ctx.restore()
    }
  }

  // 9. SLOPE of each ramp (« 35 ‰ »), in the detailed and the line drawing. A label gives way to
  // the section badges, to the diagnostic markers (one of them already says « Pente 60 ‰ » at the
  // foot of a ramp that is too steep) and to the longer ramps: same placement as the badges.
  if (ramps && steepRails && gradientColors) {
    ctx.save()
    ctx.font = GRADIENT_LABEL_FONT
    const labels = gradientLabelBoxes(ctx, cam, vw, vh, net, ramps, steepRails)
    ctx.restore()
    if (labels.length > 0) {
      const kept = new Set<BadgeBox>(placeBadges<BadgeBox>([...takenBoxes, ...labels]))
      drawGradientLabels(ctx, labels.filter((label) => kept.has(label)), gradientColors)
    }
  }
}


/** Short text of the badge above a diagnostic marker */
export function diagnosticLabel(issue: KinematicIssue): string {
  if (issue.kind === 'track_gap') return 'Voie interrompue'
  if (issue.kind === 'steep_gradient') return `Pente ${issue.gradientPermille ?? 0} ‰`
  return issue.angleDeg ? `∠ ${issue.angleDeg}° Cassure` : 'Jonction non franchissable'
}

export function renderDetailedRailBallast(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  a: Point,
  b: Point,
  vw: number,
  vh: number,
  selected: boolean,
  ballastColor?: string,
  ballastEdgeColor?: string,
): void {
  const s = cam.scale
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return

  const ballastW = BALLAST_WIDTH * s

  ctx.save()
  ctx.translate((a.x - cam.x) * s + vw / 2, (a.y - cam.y) * s + vh / 2)
  ctx.rotate(Math.atan2(dy, dx))

  // Ballast roadbed fill
  ctx.fillStyle = selected ? 'rgba(37, 99, 235, 0.15)' : (ballastColor ?? '#dcd6cc')
  ctx.fillRect(0, -ballastW / 2, len * s, ballastW)

  // Ballast edge bevel lines
  ctx.strokeStyle = ballastEdgeColor ?? '#c2b9aa'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, -ballastW / 2)
  ctx.lineTo(len * s, -ballastW / 2)
  ctx.moveTo(0, ballastW / 2)
  ctx.lineTo(len * s, ballastW / 2)
  ctx.stroke()

  ctx.restore()
}

export function renderDetailedRailSleepers(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  a: Point,
  b: Point,
  vw: number,
  vh: number,
  sleeperColor: string,
  crossings?: DiamondCrossing[],
): void {
  const s = cam.scale
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return

  const sleeperLen = SLEEPER_LENGTH * s
  const sleeperW = Math.max(1.5, SLEEPER_WIDTH * s)
  const totalSleepers = Math.max(1, Math.round(len / SLEEPER_SPACING))
  const step = len / totalSleepers

  ctx.save()
  ctx.translate((a.x - cam.x) * s + vw / 2, (a.y - cam.y) * s + vh / 2)
  ctx.rotate(Math.atan2(dy, dx))
  ctx.fillStyle = sleeperColor

  // Half-offset spacing: first and last sleepers are half a step away from ends
  // preventing double sleepers at joint nodes and giving a uniform 7.5mm pitch
  for (let i = 0; i < totalSleepers; i++) {
    const t = (i + 0.5) * step
    // Check if sleeper is inside any crossing diamond
    if (crossings && crossings.length > 0) {
      const wx = a.x + (dx / len) * t
      const wy = a.y + (dy / len) * t
      let insideCrossing = false
      for (const c of crossings) {
        if (Math.hypot(wx - c.center.x, wy - c.center.y) < c.radius * 0.75) {
          insideCrossing = true
          break
        }
      }
      if (insideCrossing) continue
    }
    ctx.fillRect(t * s - sleeperW / 2, -sleeperLen / 2, sleeperW, sleeperLen)

    // Steel tie plates (selles de rail métalliques) & spikes under both rails when zoomed in
    if (s >= 1.2) {
      const hg = (GAUGE / 2) * s
      const plateW = Math.max(2, 2.4 * s)
      const plateH = Math.max(2.8, 3.8 * s)
      ctx.fillStyle = '#475569'
      ctx.fillRect(t * s - plateW / 2, -hg - plateH / 2, plateW, plateH)
      ctx.fillRect(t * s - plateW / 2, hg - plateH / 2, plateW, plateH)

      if (s >= 2.2) {
        ctx.fillStyle = '#0f172a'
        const spR = Math.max(0.6, 0.7 * s)
        ctx.fillRect(t * s - plateW * 0.35, -hg - plateH * 0.35, spR, spR)
        ctx.fillRect(t * s + plateW * 0.35 - spR, -hg + plateH * 0.35 - spR, spR, spR)
        ctx.fillRect(t * s - plateW * 0.35, hg - plateH * 0.35, spR, spR)
        ctx.fillRect(t * s + plateW * 0.35 - spR, hg + plateH * 0.35 - spR, spR, spR)
        ctx.fillStyle = sleeperColor
      }
    }
  }

  ctx.restore()
}

export function renderDetailedRailLines(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  a: Point,
  b: Point,
  vw: number,
  vh: number,
  selected: boolean,
  ink: string,
  accent: string,
  startPullback = 0,
  endPullback = 0,
  railHeadColor = '#ffffff',
  gauge: number = GAUGE,
): void {
  const s = cam.scale
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return
  if (len <= startPullback + endPullback) return

  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  const hg = gauge / 2

  const aStart = { x: a.x + ux * startPullback, y: a.y + uy * startPullback }
  const bEnd = { x: b.x - ux * endPullback, y: b.y - uy * endPullback }

  const r1ax = (aStart.x + nx * hg - cam.x) * s + vw / 2
  const r1ay = (aStart.y + ny * hg - cam.y) * s + vh / 2
  const r1bx = (bEnd.x + nx * hg - cam.x) * s + vw / 2
  const r1by = (bEnd.y + ny * hg - cam.y) * s + vh / 2
  const r2ax = (aStart.x - nx * hg - cam.x) * s + vw / 2
  const r2ay = (aStart.y - ny * hg - cam.y) * s + vh / 2
  const r2bx = (bEnd.x - nx * hg - cam.x) * s + vw / 2
  const r2by = (bEnd.y - ny * hg - cam.y) * s + vh / 2

  const railWidthRatio = Math.max(0.25, Math.min(2.5, gauge / GAUGE))
  const railPx = Math.max(1.2, RAIL_WIDTH * railWidthRatio * s)
  const railColor = selected ? accent : ink

  // Pass 1: Rail base / patin
  ctx.strokeStyle = railColor
  ctx.lineWidth = railPx
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'

  ctx.beginPath()
  ctx.moveTo(r1ax, r1ay)
  ctx.lineTo(r1bx, r1by)
  ctx.moveTo(r2ax, r2ay)
  ctx.lineTo(r2bx, r2by)
  ctx.stroke()

  // Pass 2: Polished steel rail head (le champignon de roulement blanc en acier)
  // Stops crisply with lineCap='butt' leaving a visible mechanical expansion gap at joints
  const headPx = Math.max(0.8, railPx * 0.42)
  ctx.strokeStyle = selected ? '#ffffff' : railHeadColor
  ctx.lineWidth = headPx
  ctx.lineCap = 'butt'

  ctx.beginPath()
  ctx.moveTo(r1ax, r1ay)
  ctx.lineTo(r1bx, r1by)
  ctx.moveTo(r2ax, r2ay)
  ctx.lineTo(r2bx, r2by)
  ctx.stroke()

  if (selected) {
    ctx.strokeStyle = accent
    ctx.globalAlpha = 0.35
    ctx.lineWidth = railPx + 5
    ctx.beginPath()
    ctx.moveTo(r1ax, r1ay)
    ctx.lineTo(r1bx, r1by)
    ctx.moveTo(r2ax, r2ay)
    ctx.lineTo(r2bx, r2by)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

export function renderDetailedRail(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  a: Point,
  b: Point,
  vw: number,
  vh: number,
  selected: boolean,
  ink: string,
  accent: string,
  sleeperColor: string,
  ballastColor?: string,
  ballastEdgeColor?: string,
): void {
  renderDetailedRailBallast(ctx, cam, a, b, vw, vh, selected, ballastColor, ballastEdgeColor)
  renderDetailedRailSleepers(ctx, cam, a, b, vw, vh, sleeperColor)
  renderDetailedRailLines(ctx, cam, a, b, vw, vh, selected, ink, accent)
}

function w2s(p: Point, cam: Camera, vw: number, vh: number): [number, number] {
  return [(p.x - cam.x) * cam.scale + vw / 2, (p.y - cam.y) * cam.scale + vh / 2]
}

export function renderDetailedCurveBallast(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p0: Point,
  via: Point,
  p2: Point,
  vw: number,
  vh: number,
  selected: boolean,
  ballastColor?: string,
  ballastEdgeColor?: string,
): void {
  const s = cam.scale
  const samples = curveSamples(p0, via, p2, s)
  const pts = discretizeCurve(p0, via, p2, samples)
  const hb = BALLAST_WIDTH / 2

  const leftBallast: [number, number][] = []
  const rightBallast: [number, number][] = []

  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const n = bezierNormal(t, p0, via, p2)
    leftBallast.push(w2s({ x: pts[i].x + n.x * hb, y: pts[i].y + n.y * hb }, cam, vw, vh))
    rightBallast.push(w2s({ x: pts[i].x - n.x * hb, y: pts[i].y - n.y * hb }, cam, vw, vh))
  }

  // Ballast roadbed fill
  ctx.fillStyle = selected ? 'rgba(37, 99, 235, 0.15)' : (ballastColor ?? '#dcd6cc')
  ctx.beginPath()
  for (let i = 0; i <= samples; i++) {
    const [sx, sy] = leftBallast[i]
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  for (let i = samples; i >= 0; i--) {
    const [sx, sy] = rightBallast[i]
    ctx.lineTo(sx, sy)
  }
  ctx.closePath()
  ctx.fill()

  // Ballast edge lines
  ctx.strokeStyle = ballastEdgeColor ?? '#c2b9aa'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= samples; i++) {
    const [sx, sy] = leftBallast[i]
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  ctx.stroke()

  ctx.beginPath()
  for (let i = 0; i <= samples; i++) {
    const [sx, sy] = rightBallast[i]
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  ctx.stroke()
}

export function renderDetailedCurveSleepers(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p0: Point,
  via: Point,
  p2: Point,
  vw: number,
  vh: number,
  sleeperColor: string,
  crossings?: DiamondCrossing[],
): void {
  const s = cam.scale
  const samples = curveSamples(p0, via, p2, s)
  const len = curveLength(p0, via, p2, samples)
  const sleeperLen = SLEEPER_LENGTH * s
  const sleeperW = Math.max(1.5, SLEEPER_WIDTH * s)
  const totalSleepers = Math.max(1, Math.round(len / SLEEPER_SPACING))
  const stepT = 1 / totalSleepers

  ctx.fillStyle = sleeperColor
  for (let i = 0; i < totalSleepers; i++) {
    const t = (i + 0.5) * stepT
    const pt = bezierPoint(t, p0, via, p2)

    if (crossings && crossings.length > 0) {
      let insideCrossing = false
      for (const c of crossings) {
        if (Math.hypot(pt.x - c.center.x, pt.y - c.center.y) < c.radius * 0.75) {
          insideCrossing = true
          break
        }
      }
      if (insideCrossing) continue
    }

    const n = bezierNormal(t, p0, via, p2)
    const [sx, sy] = w2s(pt, cam, vw, vh)
    const angle = Math.atan2(n.y, n.x) + Math.PI / 2

    ctx.save()
    ctx.translate(sx, sy)
    ctx.rotate(angle)
    ctx.fillRect(-sleeperW / 2, -sleeperLen / 2, sleeperW, sleeperLen)

    // Steel tie plates (selles de rail métalliques) & spikes under curved rails when zoomed in
    if (s >= 1.2) {
      const hg = (GAUGE / 2) * s
      const plateW = Math.max(2, 2.4 * s)
      const plateH = Math.max(2.8, 3.8 * s)
      ctx.fillStyle = '#475569'
      ctx.fillRect(-plateW / 2, -hg - plateH / 2, plateW, plateH)
      ctx.fillRect(-plateW / 2, hg - plateH / 2, plateW, plateH)

      if (s >= 2.2) {
        ctx.fillStyle = '#0f172a'
        const spR = Math.max(0.6, 0.7 * s)
        ctx.fillRect(-plateW * 0.35, -hg - plateH * 0.35, spR, spR)
        ctx.fillRect(plateW * 0.35 - spR, -hg + plateH * 0.35 - spR, spR, spR)
        ctx.fillRect(-plateW * 0.35, hg - plateH * 0.35, spR, spR)
        ctx.fillRect(plateW * 0.35 - spR, hg + plateH * 0.35 - spR, spR, spR)
      }
    }
    ctx.restore()
  }
}

export function renderDetailedCurveRails(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p0: Point,
  via: Point,
  p2: Point,
  vw: number,
  vh: number,
  selected: boolean,
  ink: string,
  accent: string,
  startPullback = 0,
  endPullback = 0,
  railHeadColor = '#ffffff',
  gauge: number = GAUGE,
): void {
  const s = cam.scale
  const samples = curveSamples(p0, via, p2, s)
  const len = curveLength(p0, via, p2, samples)
  const tStart = len > 0 && startPullback > 0 ? Math.min(0.25, startPullback / len) : 0
  const tEnd = len > 0 && endPullback > 0 ? Math.max(0.75, 1 - endPullback / len) : 1

  const hg = gauge / 2
  const railWidthRatio = Math.max(0.25, Math.min(2.5, gauge / GAUGE))
  const railPx = Math.max(1.2, RAIL_WIDTH * railWidthRatio * s)
  const railColor = selected ? accent : ink

  const leftRail: [number, number][] = []
  const rightRail: [number, number][] = []

  for (let i = 0; i <= samples; i++) {
    const t = tStart + (i / samples) * (tEnd - tStart)
    const pt = bezierPoint(t, p0, via, p2)
    const n = bezierNormal(t, p0, via, p2)
    leftRail.push(w2s({ x: pt.x + n.x * hg, y: pt.y + n.y * hg }, cam, vw, vh))
    rightRail.push(w2s({ x: pt.x - n.x * hg, y: pt.y - n.y * hg }, cam, vw, vh))
  }

  // Pass 1: Rail base
  ctx.strokeStyle = railColor
  ctx.lineWidth = railPx
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'round'

  ctx.beginPath()
  for (let i = 0; i <= samples; i++) {
    const [sx, sy] = leftRail[i]
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  ctx.stroke()

  ctx.beginPath()
  for (let i = 0; i <= samples; i++) {
    const [sx, sy] = rightRail[i]
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  ctx.stroke()

  // Pass 2: Polished steel rail head
  const headPx = Math.max(0.8, railPx * 0.42)
  ctx.strokeStyle = selected ? '#ffffff' : railHeadColor
  ctx.lineWidth = headPx
  ctx.lineCap = 'butt'

  ctx.beginPath()
  for (let i = 0; i <= samples; i++) {
    const [sx, sy] = leftRail[i]
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  ctx.stroke()

  ctx.beginPath()
  for (let i = 0; i <= samples; i++) {
    const [sx, sy] = rightRail[i]
    if (i === 0) ctx.moveTo(sx, sy)
    else ctx.lineTo(sx, sy)
  }
  ctx.stroke()

  if (selected) {
    ctx.strokeStyle = accent
    ctx.globalAlpha = 0.35
    ctx.lineWidth = railPx + 5
    ctx.beginPath()
    for (let i = 0; i <= samples; i++) {
      const [sx, sy] = leftRail[i]
      if (i === 0) ctx.moveTo(sx, sy)
      else ctx.lineTo(sx, sy)
    }
    ctx.stroke()
    ctx.beginPath()
    for (let i = 0; i <= samples; i++) {
      const [sx, sy] = rightRail[i]
      if (i === 0) ctx.moveTo(sx, sy)
      else ctx.lineTo(sx, sy)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }
}

export function renderDetailedCurve(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  p0: Point,
  via: Point,
  p2: Point,
  vw: number,
  vh: number,
  selected: boolean,
  ink: string,
  accent: string,
  sleeperColor: string,
  ballastColor?: string,
  ballastEdgeColor?: string,
): void {
  renderDetailedCurveBallast(ctx, cam, p0, via, p2, vw, vh, selected, ballastColor, ballastEdgeColor)
  renderDetailedCurveSleepers(ctx, cam, p0, via, p2, vw, vh, sleeperColor)
  renderDetailedCurveRails(ctx, cam, p0, via, p2, vw, vh, selected, ink, accent)
}

// --- Scale bar ---

/** Round to a "nice" number (1, 2, 5 × 10^n) closest to `value`. */
function niceNumber(value: number): number {
  const power = Math.floor(Math.log10(value))
  const base = value / 10 ** power
  let step: number
  if (base < 1.5) step = 1
  else if (base < 3.5) step = 2
  else if (base < 7.5) step = 5
  else step = 10
  return step * 10 ** power
}

export function renderScaleBar(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  /** Width in pixels reserved on the right of the canvas (an overlay sits there) */
  rightInset = 0,
  /** Height in pixels reserved at the bottom of the canvas */
  bottomInset = 0,
): void {
  const ink = getCanvasStyle(ctx.canvas, '--ink', '#1a1a1a')
  const panel = getCanvasStyle(ctx.canvas, '--panel', '#f5f5f5')

  const targetWorld = 100 / cam.scale
  const worldDist = niceNumber(targetWorld)
  const barPx = worldDist * cam.scale

  const margin = 16
  const barH = 8
  const right = vw - rightInset
  const x = right - barPx - margin
  const y = vh - bottomInset - margin

  ctx.save()

  ctx.font = '600 11px Archivo, system-ui, sans-serif'
  const label = formatDistance(worldDist)
  const labelW = ctx.measureText(label).width
  const pillW = Math.max(barPx, labelW) + 16
  const pillH = barH + 24
  const pillX = right - pillW - margin / 2
  const pillY = vh - bottomInset - pillH - margin / 2
  ctx.fillStyle = panel
  ctx.globalAlpha = 0.85
  roundRect(ctx, pillX, pillY, pillW, pillH, 6)
  ctx.fill()
  ctx.globalAlpha = 1

  ctx.strokeStyle = ink
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x, y - barH)
  ctx.lineTo(x, y)
  ctx.lineTo(x + barPx, y)
  ctx.lineTo(x + barPx, y - barH)
  ctx.stroke()

  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(label, x + barPx / 2, y + 4)

  ctx.restore()
}

function formatDistance(world: number): string {
  if (world >= 1000) return `${(world / 1000).toFixed(2)} km`
  return `${world.toFixed(2)} m`
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export interface SegmentEndGeom {
  segId: string
  tangent: Point
  normal: Point
  rLeftW: Point
  rRightW: Point
  bLeftW: Point
  bRightW: Point
  rLeftScr: [number, number]
  rRightScr: [number, number]
  bLeftScr: [number, number]
  bRightScr: [number, number]
  selected: boolean
  isInactive: boolean
}

/**
 * For a segment connected to a node, get its unit tangent pointing OUTWARD (away from the node)
 * and its outward-left unit normal (rotated 90° counter-clockwise from tangent).
 */
export function getNodeSegmentEndVector(
  net: Network,
  seg: Segment,
  nodeId: NodeId,
): { tangent: Point; normal: Point } {
  const nodeA = net.nodes.get(seg.from)
  const nodeB = net.nodes.get(seg.to)
  if (!nodeA || !nodeB) {
    return { tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 } }
  }

  let tx = 0
  let ty = 0

  if (seg.kind === 'curve' && seg.via) {
    if (seg.from === nodeId) {
      // Outgoing at t = 0 (direction from nodeA towards nodeB along curve)
      const tan = bezierTangent(0, nodeA.pos, seg.via, nodeB.pos)
      tx = tan.x
      ty = tan.y
    } else {
      // Outgoing at t = 1 (direction away from nodeB back into curve towards nodeA)
      const tan = bezierTangent(1, nodeA.pos, seg.via, nodeB.pos)
      tx = -tan.x
      ty = -tan.y
    }
  } else {
    // Straight segment
    if (seg.from === nodeId) {
      tx = nodeB.pos.x - nodeA.pos.x
      ty = nodeB.pos.y - nodeA.pos.y
    } else {
      tx = nodeA.pos.x - nodeB.pos.x
      ty = nodeA.pos.y - nodeB.pos.y
    }
  }

  const len = Math.hypot(tx, ty)
  const ux = len > 0.0001 ? tx / len : 1
  const uy = len > 0.0001 ? ty / len : 0
  const nx = -uy
  const ny = ux

  return { tangent: { x: ux, y: uy }, normal: { x: nx, y: ny } }
}

export function getNodeSegmentEnds(
  net: Network,
  node: RailNode,
  cam: Camera,
  vw: number,
  vh: number,
  selection: Selection,
  gauge: number = GAUGE,
): SegmentEndGeom[] {
  const adj = net.adjacency.get(node.id) ?? []
  const ends: SegmentEndGeom[] = []
  const hg = gauge / 2
  const hb = (BALLAST_WIDTH * (gauge / GAUGE)) / 2

  for (const sid of adj) {
    const seg = net.segments.get(sid)
    if (!seg) continue

    const { tangent, normal } = getNodeSegmentEndVector(net, seg, node.id)

    const rLeftW = { x: node.pos.x + normal.x * hg, y: node.pos.y + normal.y * hg }
    const rRightW = { x: node.pos.x - normal.x * hg, y: node.pos.y - normal.y * hg }
    const bLeftW = { x: node.pos.x + normal.x * hb, y: node.pos.y + normal.y * hb }
    const bRightW = { x: node.pos.x - normal.x * hb, y: node.pos.y - normal.y * hb }

    ends.push({
      segId: sid,
      tangent,
      normal,
      rLeftW,
      rRightW,
      bLeftW,
      bRightW,
      rLeftScr: w2s(rLeftW, cam, vw, vh),
      rRightScr: w2s(rRightW, cam, vw, vh),
      bLeftScr: w2s(bLeftW, cam, vw, vh),
      bRightScr: w2s(bRightW, cam, vw, vh),
      selected: selection.segments.has(sid) || selection.nodes.has(node.id),
      isInactive: isInactiveBranchAtNode(net, sid, node.id),
    })
  }
  return ends
}

export interface ConnectedEndPair {
  e1: SegmentEndGeom
  e2: SegmentEndGeom
  dot: number
  // World points
  r1LW: Point
  r1RW: Point
  r2LW: Point
  r2RW: Point
  b1LW: Point
  b1RW: Point
  b2LW: Point
  b2RW: Point
  jLeftW: Point
  jRightW: Point
  bLeftW: Point
  bRightW: Point
  // Screen points
  r1LScr: [number, number]
  r1RScr: [number, number]
  r2LScr: [number, number]
  r2RScr: [number, number]
  b1LScr: [number, number]
  b1RScr: [number, number]
  b2LScr: [number, number]
  b2RScr: [number, number]
  jLeftScr: [number, number]
  jRightScr: [number, number]
  bLeftScr: [number, number]
  bRightScr: [number, number]
}

export function getConnectedEndPairs(
  node: RailNode,
  ends: SegmentEndGeom[],
  cam: Camera,
  vw: number,
  vh: number,
  gauge: number = GAUGE,
): ConnectedEndPair[] {
  const pairs: ConnectedEndPair[] = []
  const hg = gauge / 2
  const hb = (BALLAST_WIDTH * (gauge / GAUGE)) / 2

  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const e1 = ends[i]
      const e2 = ends[j]
      const dot = e1.tangent.x * e2.tangent.x + e1.tangent.y * e2.tangent.y

      // For degree-2 joints, allow turns up to 135° (dot < 0.707)
      // For branch / turnout nodes (deg >= 3), branches diverging in same direction have dot > 0
      // Only segments running through in opposite directions (dot < -0.2) continue into each other
      const maxDot = ends.length === 2 ? 0.707 : -0.2
      if (dot >= maxDot) continue

      // Travel flows through node from e1 into e2:
      // Along e1 towards node (direction -e1.tangent), left normal is -e1.normal
      // Along e2 away from node (direction +e2.tangent), left normal is +e2.normal
      const r1LW = { x: node.pos.x - e1.normal.x * hg, y: node.pos.y - e1.normal.y * hg }
      const r1RW = { x: node.pos.x + e1.normal.x * hg, y: node.pos.y + e1.normal.y * hg }
      const r2LW = { x: node.pos.x + e2.normal.x * hg, y: node.pos.y + e2.normal.y * hg }
      const r2RW = { x: node.pos.x - e2.normal.x * hg, y: node.pos.y - e2.normal.y * hg }

      const b1LW = { x: node.pos.x - e1.normal.x * hb, y: node.pos.y - e1.normal.y * hb }
      const b1RW = { x: node.pos.x + e1.normal.x * hb, y: node.pos.y + e1.normal.y * hb }
      const b2LW = { x: node.pos.x + e2.normal.x * hb, y: node.pos.y + e2.normal.y * hb }
      const b2RW = { x: node.pos.x - e2.normal.x * hb, y: node.pos.y - e2.normal.y * hb }

      // Bisector vector D = normalize(e2.tangent - e1.tangent)
      const dx = e2.tangent.x - e1.tangent.x
      const dy = e2.tangent.y - e1.tangent.y
      const dLen = Math.hypot(dx, dy)
      const uDx = dLen > 0.0001 ? dx / dLen : -e1.tangent.x
      const uDy = dLen > 0.0001 ? dy / dLen : -e1.tangent.y

      // Bisector normal (to the left of travel direction D)
      const nBx = -uDy
      const nBy = uDx

      const cosHalf = Math.max(0.35, Math.sqrt(Math.max(0, (1 - dot) / 2)))
      const miterRail = hg / cosHalf
      const miterBallast = hb / cosHalf

      const jLeftW = { x: node.pos.x + nBx * miterRail, y: node.pos.y + nBy * miterRail }
      const jRightW = { x: node.pos.x - nBx * miterRail, y: node.pos.y - nBy * miterRail }
      const bLeftW = { x: node.pos.x + nBx * miterBallast, y: node.pos.y + nBy * miterBallast }
      const bRightW = { x: node.pos.x - nBx * miterBallast, y: node.pos.y - nBy * miterBallast }

      pairs.push({
        e1,
        e2,
        dot,
        r1LW,
        r1RW,
        r2LW,
        r2RW,
        b1LW,
        b1RW,
        b2LW,
        b2RW,
        jLeftW,
        jRightW,
        bLeftW,
        bRightW,
        r1LScr: w2s(r1LW, cam, vw, vh),
        r1RScr: w2s(r1RW, cam, vw, vh),
        r2LScr: w2s(r2LW, cam, vw, vh),
        r2RScr: w2s(r2RW, cam, vw, vh),
        b1LScr: w2s(b1LW, cam, vw, vh),
        b1RScr: w2s(b1RW, cam, vw, vh),
        b2LScr: w2s(b2LW, cam, vw, vh),
        b2RScr: w2s(b2RW, cam, vw, vh),
        jLeftScr: w2s(jLeftW, cam, vw, vh),
        jRightScr: w2s(jRightW, cam, vw, vh),
        bLeftScr: w2s(bLeftW, cam, vw, vh),
        bRightScr: w2s(bRightW, cam, vw, vh),
      })
    }
  }

  return pairs
}

/** Connect ballast seamlessly at nodes where 2 or more segments meet (drawn in Layer 1, under rails). */
export function renderBallastJoints(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  ballastColor?: string,
  ballastEdgeColor?: string,
  bounds?: ViewportBounds,
): void {
  const dummySel: Selection = { nodes: new Set(), segments: new Set() }
  for (const node of bounds ? nodesInBox(net, bounds) : net.nodes.values()) {
    const adj = net.adjacency.get(node.id) ?? []
    if (adj.length < 2) continue

    const nx_scr = (node.pos.x - cam.x) * cam.scale + vw / 2
    const ny_scr = (node.pos.y - cam.y) * cam.scale + vh / 2
    if (nx_scr < -60 || nx_scr > vw + 60 || ny_scr < -60 || ny_scr > vh + 60) continue

    const ends = getNodeSegmentEnds(net, node, cam, vw, vh, dummySel)
    const pairs = getConnectedEndPairs(node, ends, cam, vw, vh)

    for (const p of pairs) {
      ctx.save()
      ctx.fillStyle = ballastColor ?? '#dcd6cc'
      ctx.beginPath()
      ctx.moveTo(p.b1LScr[0], p.b1LScr[1])
      ctx.lineTo(p.bLeftScr[0], p.bLeftScr[1])
      ctx.lineTo(p.b2LScr[0], p.b2LScr[1])
      ctx.lineTo(p.b2RScr[0], p.b2RScr[1])
      ctx.lineTo(p.bRightScr[0], p.bRightScr[1])
      ctx.lineTo(p.b1RScr[0], p.b1RScr[1])
      ctx.closePath()
      ctx.fill()

      // Bevel edge lines along the sides of the ballast junction
      ctx.strokeStyle = ballastEdgeColor ?? '#c2b9aa'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(p.b1LScr[0], p.b1LScr[1])
      ctx.lineTo(p.bLeftScr[0], p.bLeftScr[1])
      ctx.lineTo(p.b2LScr[0], p.b2LScr[1])
      ctx.moveTo(p.b1RScr[0], p.b1RScr[1])
      ctx.lineTo(p.bRightScr[0], p.bRightScr[1])
      ctx.lineTo(p.b2RScr[0], p.b2RScr[1])
      ctx.stroke()

      ctx.restore()
    }
  }
}

/** Connect rail lines seamlessly at nodes where 2 or more segments meet (drawn in Layer 3). */
export function renderRailJoints(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  selection: Selection,
  railColor: string,
  accent: string,
  bounds?: ViewportBounds,
  gauge: number = GAUGE,
  /** Only the joints of this level: the level the two rails are drawn with where they meet */
  level?: number,
): void {
  const s = cam.scale
  const railWidthRatio = Math.max(0.25, Math.min(2.5, gauge / GAUGE))
  const railPx = Math.max(1.2, RAIL_WIDTH * railWidthRatio * s)
  const capRadius = railPx / 2
  type JointPair = ReturnType<typeof getConnectedEndPairs>[number]
  const groups: JointPair[][] = [[], [], [], []]

  for (const node of bounds ? nodesInBox(net, bounds) : net.nodes.values()) {
    const adj = net.adjacency.get(node.id) ?? []
    if (adj.length < 2) continue

    const nx_scr = (node.pos.x - cam.x) * s + vw / 2
    const ny_scr = (node.pos.y - cam.y) * s + vh / 2
    if (nx_scr < -40 || nx_scr > vw + 40 || ny_scr < -40 || ny_scr > vh + 40) continue

    const ends = getNodeSegmentEnds(net, node, cam, vw, vh, selection, gauge)
    const pairs = getConnectedEndPairs(node, ends, cam, vw, vh, gauge)

    for (const p of pairs) {
      if (level !== undefined && nodeJointBand(net, node.id, [p.e1.segId, p.e2.segId]) !== level) continue
      const isSel = p.e1.selected || p.e2.selected
      const isDim = p.e1.isInactive || p.e2.isInactive
      groups[(isSel ? 1 : 0) + (isDim ? 2 : 0)].push(p)
    }
  }

  // The joints are gathered by style — plain, selected, and both again where the points are set
  // against the rail — and each style is drawn in one go: bases, caps, then heads
  const headPx = Math.max(0.8, railPx * 0.42)
  const trace = (joints: JointPair[]): void => {
    ctx.beginPath()
    for (const p of joints) {
      ctx.moveTo(p.r1LScr[0], p.r1LScr[1])
      ctx.lineTo(p.jLeftScr[0], p.jLeftScr[1])
      ctx.lineTo(p.r2LScr[0], p.r2LScr[1])
      ctx.moveTo(p.r1RScr[0], p.r1RScr[1])
      ctx.lineTo(p.jRightScr[0], p.jRightScr[1])
      ctx.lineTo(p.r2RScr[0], p.r2RScr[1])
    }
    ctx.stroke()
  }
  groups.forEach((joints, style) => {
    if (joints.length === 0) return
    const col = style & 1 ? accent : railColor
    ctx.save()
    if (style & 2) ctx.globalAlpha *= 0.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // Pass 1: Rail base / patin
    ctx.strokeStyle = col
    ctx.lineWidth = railPx
    trace(joints)

    // Small anchor caps at vertices to ensure zero subpixel gap
    ctx.fillStyle = col
    ctx.beginPath()
    for (const p of joints) {
      ctx.moveTo(p.jLeftScr[0] + capRadius, p.jLeftScr[1])
      ctx.arc(p.jLeftScr[0], p.jLeftScr[1], capRadius, 0, Math.PI * 2)
      ctx.moveTo(p.jRightScr[0] + capRadius, p.jRightScr[1])
      ctx.arc(p.jRightScr[0], p.jRightScr[1], capRadius, 0, Math.PI * 2)
    }
    ctx.fill()

    // Pass 2: Polished steel rail head
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = headPx
    trace(joints)
    ctx.restore()
  })
}

/**
 * Render realistic steel fishplates (eclisses de joint) with bolt pairs
 * at degree-2 track joints where two rail segments meet end-to-end.
 * In reality, fishplates are steel bars bolted to both sides of each rail
 * across the expansion gap, holding the rail ends in alignment.
 */
export function renderFishplates(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  bounds?: ViewportBounds,
): void {
  const s = cam.scale
  if (s < 1.0) return // Only render when zoomed in enough

  const hg = GAUGE / 2

  for (const node of bounds ? nodesInBox(net, bounds) : net.nodes.values()) {
    const adj = net.adjacency.get(node.id) ?? []
    if (adj.length !== 2) continue

    const nx_scr = (node.pos.x - cam.x) * s + vw / 2
    const ny_scr = (node.pos.y - cam.y) * s + vh / 2
    if (nx_scr < -40 || nx_scr > vw + 40 || ny_scr < -40 || ny_scr > vh + 40) continue

    // Compute average tangent direction at this joint
    const seg0 = net.segments.get(adj[0])
    const seg1 = net.segments.get(adj[1])
    if (!seg0 || !seg1) continue

    const getTan = (seg: typeof seg0): Point => {
      const tan = segmentTangentAt(net, seg, node.id)
      if (tan) {
        // Point away from node
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

    const t0 = getTan(seg0)
    const t1 = getTan(seg1)

    // Average tangent direction (bisector of incoming/outgoing)
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

    // Normal perpendicular to track
    const nX = -tAvgY
    const nY = tAvgX

    // Fishplate dimensions (HO scale)
    const plateHalfLen = 4.5 // 9mm total length in model scale
    const plateThickness = Math.max(1.2, 1.4 * s)
    const boltSpacing = 2.8
    const boltRadius = Math.max(0.5, 0.6 * s)

    // Draw fishplate on each rail (left rail and right rail)
    for (const railSide of [-1, 1]) {
      const railCenterX = node.pos.x + nX * hg * railSide
      const railCenterY = node.pos.y + nY * hg * railSide

      // Steel fishplate bar (thin rectangle along rail)
      const pA = w2s(
        { x: railCenterX - tAvgX * plateHalfLen, y: railCenterY - tAvgY * plateHalfLen },
        cam, vw, vh,
      )
      const pB = w2s(
        { x: railCenterX + tAvgX * plateHalfLen, y: railCenterY + tAvgY * plateHalfLen },
        cam, vw, vh,
      )

      ctx.save()
      ctx.strokeStyle = '#64748b'
      ctx.lineWidth = plateThickness
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(pA[0], pA[1])
      ctx.lineTo(pB[0], pB[1])
      ctx.stroke()

      // Bolt pairs (2 bolts on each side of the joint gap)
      ctx.fillStyle = '#1e293b'
      for (const boltDist of [-boltSpacing, -boltSpacing * 0.35, boltSpacing * 0.35, boltSpacing]) {
        const boltW = {
          x: railCenterX + tAvgX * boltDist,
          y: railCenterY + tAvgY * boltDist,
        }
        const bScr = w2s(boltW, cam, vw, vh)
        ctx.beginPath()
        ctx.arc(bScr[0], bScr[1], boltRadius, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.restore()
    }
  }
}

/**
 * Render unified diamond ballast platform for a crossing (Layer 1).
 */
export function renderDiamondCrossingBallast(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  crossing: DiamondCrossing,
  vw: number,
  vh: number,
  ballastColor?: string,
  ballastEdgeColor?: string,
): void {
  const c = crossing.center
  const u1 = crossing.track1Dir
  const u2 = crossing.track2Dir
  const hb = BALLAST_WIDTH / 2
  const n1 = { x: -u1.y, y: u1.x }
  const n2 = { x: -u2.y, y: u2.x }

  const p1A = { x: c.x + n1.x * hb, y: c.y + n1.y * hb }
  const p1B = { x: c.x - n1.x * hb, y: c.y - n1.y * hb }
  const p2A = { x: c.x + n2.x * hb, y: c.y + n2.y * hb }
  const p2B = { x: c.x - n2.x * hb, y: c.y - n2.y * hb }

  const b1 = lineLineIntersection(p1A, u1, p2A, u2)
  const b2 = lineLineIntersection(p1A, u1, p2B, u2)
  const b3 = lineLineIntersection(p1B, u1, p2B, u2)
  const b4 = lineLineIntersection(p1B, u1, p2A, u2)

  if (!b1 || !b2 || !b3 || !b4) return

  const s1 = w2s(b1, cam, vw, vh)
  const s2 = w2s(b2, cam, vw, vh)
  const s3 = w2s(b3, cam, vw, vh)
  const s4 = w2s(b4, cam, vw, vh)

  ctx.save()
  ctx.fillStyle = ballastColor ?? '#dcd6cc'
  ctx.beginPath()
  ctx.moveTo(s1[0], s1[1])
  ctx.lineTo(s2[0], s2[1])
  ctx.lineTo(s3[0], s3[1])
  ctx.lineTo(s4[0], s4[1])
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = ballastEdgeColor ?? '#c2b9aa'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.restore()
}

/**
 * Render shared long crossing timbers (traverses communes de croisement) across diamond (Layer 2).
 */
export function renderDiamondCrossingSleepers(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  crossing: DiamondCrossing,
  vw: number,
  vh: number,
  sleeperColor: string,
): void {
  const s = cam.scale
  const c = crossing.center
  const u1 = crossing.track1Dir
  const u2 = crossing.track2Dir

  // Bisector direction
  const sumX = u1.x + u2.x
  const sumY = u1.y + u2.y
  const sumL = Math.hypot(sumX, sumY)
  const uBis = sumL > 0.01 ? { x: sumX / sumL, y: sumY / sumL } : { x: -u1.y, y: u1.x }
  const uTie = { x: -uBis.y, y: uBis.x }
  const tieAngle = Math.atan2(uTie.y, uTie.x)

  const sleeperW = Math.max(1.5, SLEEPER_WIDTH * s)
  const maxSpan = Math.min(crossing.radius, 32)
  const numTies = Math.max(3, Math.floor((maxSpan * 2) / SLEEPER_SPACING))
  const step = (maxSpan * 2) / numTies

  ctx.save()
  ctx.fillStyle = sleeperColor

  for (let i = 0; i <= numTies; i++) {
    const dist = -maxSpan + (i + 0.5) * step
    if (dist > maxSpan) break

    const centerW = { x: c.x + uBis.x * dist, y: c.y + uBis.y * dist }
    const [scrX, scrY] = w2s(centerW, cam, vw, vh)

    // Long crossing timber spanning across both tracks
    const tieLen = Math.min(48, Math.max(SLEEPER_LENGTH, SLEEPER_LENGTH + Math.abs(dist) * 0.9)) * s

    ctx.save()
    ctx.translate(scrX, scrY)
    ctx.rotate(tieAngle)
    ctx.fillRect(-sleeperW / 2, -tieLen / 2, sleeperW, tieLen)
    ctx.restore()
  }

  ctx.restore()
}

/**
 * Render diamond crossing mechanical details:
 * - Flangeway cuts (ornières de roulement des boudins) at the 4 frog intersections
 * - Acute frog noses (pointes de cœur aiguës)
 * - Inner flared guard rails (contre-rails intérieurs en diamant)
 */
export function renderDiamondCrossingDetails(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  crossing: DiamondCrossing,
  vw: number,
  vh: number,
  railColor: string,
  _accent: string,
): void {
  const s = cam.scale
  const railPx = Math.max(1.2, RAIL_WIDTH * s)
  const u1 = crossing.track1Dir
  const u2 = crossing.track2Dir
  const frogs = [crossing.frogs.p1, crossing.frogs.p2, crossing.frogs.p3, crossing.frogs.p4]

  ctx.save()

  // 1. Cut flangeways (ornières) at the 4 frog intersections (HO NEM 110 standard)
  const flangewayPx = Math.max(1.4, 1.6 * s)
  const flangewayHalfLen = 3.2
  ctx.strokeStyle = '#1e1e1e' // dark ballast shadow inside frog groove
  ctx.lineWidth = flangewayPx
  ctx.lineCap = 'butt'

  for (const fp of frogs) {
    // Cut along track 1 direction
    const p1A = w2s({ x: fp.x - u1.x * flangewayHalfLen, y: fp.y - u1.y * flangewayHalfLen }, cam, vw, vh)
    const p1B = w2s({ x: fp.x + u1.x * flangewayHalfLen, y: fp.y + u1.y * flangewayHalfLen }, cam, vw, vh)
    ctx.beginPath()
    ctx.moveTo(p1A[0], p1A[1])
    ctx.lineTo(p1B[0], p1B[1])
    ctx.stroke()

    // Cut along track 2 direction
    const p2A = w2s({ x: fp.x - u2.x * flangewayHalfLen, y: fp.y - u2.y * flangewayHalfLen }, cam, vw, vh)
    const p2B = w2s({ x: fp.x + u2.x * flangewayHalfLen, y: fp.y + u2.y * flangewayHalfLen }, cam, vw, vh)
    ctx.beginPath()
    ctx.moveTo(p2A[0], p2A[1])
    ctx.lineTo(p2B[0], p2B[1])
    ctx.stroke()
  }

  // 2. Acute frog V-point noses (Pointes de cœur aiguës) pointing toward crossing center
  ctx.fillStyle = railColor
  for (const fp of frogs) {
    const toCenter = { x: crossing.center.x - fp.x, y: crossing.center.y - fp.y }
    const dCenter = Math.hypot(toCenter.x, toCenter.y)
    if (dCenter > 0.1) {
      const uC = { x: toCenter.x / dCenter, y: toCenter.y / dCenter }
      const perp = { x: -uC.y, y: uC.x }
      const tip = w2s({ x: fp.x + uC.x * 2.5, y: fp.y + uC.y * 2.5 }, cam, vw, vh)
      const base1 = w2s({ x: fp.x - uC.x * 1.5 + perp.x * 1.0, y: fp.y - uC.y * 1.5 + perp.y * 1.0 }, cam, vw, vh)
      const base2 = w2s({ x: fp.x - uC.x * 1.5 - perp.x * 1.0, y: fp.y - uC.y * 1.5 - perp.y * 1.0 }, cam, vw, vh)

      ctx.beginPath()
      ctx.moveTo(tip[0], tip[1])
      ctx.lineTo(base1[0], base1[1])
      ctx.lineTo(base2[0], base2[1])
      ctx.closePath()
      ctx.fill()
    }
  }

  // 3. Inner flared guard rails (Contre-rails intérieurs en diamant avec extrémités évasées)
  if (s >= 0.8) {
    const hg = GAUGE / 2
    const n1 = { x: -u1.y, y: u1.x }
    const n2 = { x: -u2.y, y: u2.x }
    const guardOffset = 2.0 // mm from running rail
    const guardHalfLen = 7.0
    const flareLen = 2.2
    const flareOff = 1.4

    ctx.strokeStyle = '#475569'
    ctx.lineWidth = Math.max(1.2, railPx * 0.85)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const drawGuardRail = (centerPt: Point, dir: Point, normal: Point, side: 1 | -1) => {
      const basePt = { x: centerPt.x + normal.x * (hg - guardOffset) * side, y: centerPt.y + normal.y * (hg - guardOffset) * side }
      const flareNormal = { x: -normal.x * side, y: -normal.y * side }

      const pStart = w2s({ x: basePt.x - dir.x * guardHalfLen + flareNormal.x * flareOff, y: basePt.y - dir.y * guardHalfLen + flareNormal.y * flareOff }, cam, vw, vh)
      const pF1 = w2s({ x: basePt.x - dir.x * (guardHalfLen - flareLen), y: basePt.y - dir.y * (guardHalfLen - flareLen) }, cam, vw, vh)
      const pF2 = w2s({ x: basePt.x + dir.x * (guardHalfLen - flareLen), y: basePt.y + dir.y * (guardHalfLen - flareLen) }, cam, vw, vh)
      const pEnd = w2s({ x: basePt.x + dir.x * guardHalfLen + flareNormal.x * flareOff, y: basePt.y + dir.y * guardHalfLen + flareNormal.y * flareOff }, cam, vw, vh)

      ctx.beginPath()
      ctx.moveTo(pStart[0], pStart[1])
      ctx.lineTo(pF1[0], pF1[1])
      ctx.lineTo(pF2[0], pF2[1])
      ctx.lineTo(pEnd[0], pEnd[1])
      ctx.stroke()
    }

    drawGuardRail(crossing.center, u1, n1, 1)
    drawGuardRail(crossing.center, u1, n1, -1)
    drawGuardRail(crossing.center, u2, n2, 1)
    drawGuardRail(crossing.center, u2, n2, -1)

    // Spacer blocks (cales d'écartement) holding inner guard rails to running rails
    if (s >= 1.2) {
      const blkW = Math.max(1.5, 1.8 * s)
      const blkH = Math.max(1.5, 1.8 * s)
      ctx.fillStyle = '#1e293b'
      const drawSpacers = (centerPt: Point, dir: Point, normal: Point, side: 1 | -1) => {
        const basePt = { x: centerPt.x + normal.x * (hg - guardOffset / 2) * side, y: centerPt.y + normal.y * (hg - guardOffset / 2) * side }
        for (const dist of [-3.5, 3.5]) {
          const sp = w2s({ x: basePt.x + dir.x * dist, y: basePt.y + dir.y * dist }, cam, vw, vh)
          ctx.fillRect(sp[0] - blkW / 2, sp[1] - blkH / 2, blkW, blkH)
        }
      }
      drawSpacers(crossing.center, u1, n1, 1)
      drawSpacers(crossing.center, u1, n1, -1)
      drawSpacers(crossing.center, u2, n2, 1)
      drawSpacers(crossing.center, u2, n2, -1)
    }
  }

  ctx.restore()
}

/**
 * Buffer stop (heurtoir) closing a track at a dead-end node: a red beam across the end of the
 * rails with its two buffers, held by two struts bolted on the rails. Sized from the gauge, with
 * a minimum on screen so the end of a track still shows when zoomed out.
 */
export function renderBufferStop(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  node: RailNode,
  net: Network,
  vw: number,
  vh: number,
  gauge = GAUGE,
): void {
  const segId = net.adjacency.get(node.id)?.[0]
  if (!segId) return
  const seg = net.segments.get(segId)
  if (!seg) return

  // Direction in which the track runs off its end
  let forwardDir: Point | null = null
  if (node.id === seg.to) {
    forwardDir = segmentTangentAt(net, seg, seg.to)
  } else if (node.id === seg.from) {
    const t = segmentTangentAt(net, seg, seg.from)
    if (t) forwardDir = { x: -t.x, y: -t.y }
  }
  if (!forwardDir) return

  const s = cam.scale
  const hg = gauge / 2
  const uF = forwardDir
  const uP = { x: -uF.y, y: uF.x }
  const at = (along: number, across: number): [number, number] =>
    w2s({ x: node.pos.x + uF.x * along + uP.x * across, y: node.pos.y + uF.y * along + uP.y * across }, cam, vw, vh)

  // Half-width of the beam: a little wider than the track, at least 5 px
  const beamHalf = Math.max(hg * 1.45, 5 / s)

  ctx.save()

  // Struts from the rails up to the beam, once there is room to see them
  if (hg * s >= 3) {
    const strutLen = gauge * 1.6
    ctx.strokeStyle = '#334155'
    ctx.lineWidth = Math.max(1.2, 0.12 * s)
    ctx.lineCap = 'round'
    ctx.beginPath()
    for (const side of [1, -1]) {
      const foot = at(-strutLen, side * hg)
      const head = at(0, side * hg)
      ctx.moveTo(foot[0], foot[1])
      ctx.lineTo(head[0], head[1])
    }
    ctx.stroke()
  }

  // Red beam across the end of the track
  const b1 = at(0, beamHalf)
  const b2 = at(0, -beamHalf)
  ctx.strokeStyle = '#dc2626'
  ctx.lineWidth = Math.max(3, 0.3 * s)
  ctx.lineCap = 'butt'
  ctx.beginPath()
  ctx.moveTo(b1[0], b1[1])
  ctx.lineTo(b2[0], b2[1])
  ctx.stroke()

  // Buffers facing the track, one in line with each rail
  if (hg * s >= 3) {
    const padR = Math.max(1.5, 0.16 * s)
    ctx.fillStyle = '#0f172a'
    ctx.strokeStyle = '#f8fafc'
    ctx.lineWidth = 1
    for (const side of [1, -1]) {
      const pad = at(-0.22, side * hg)
      ctx.beginPath()
      ctx.arc(pad[0], pad[1], padR, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }

  ctx.restore()
}


// ─────────────────── Locomotive Rendering ───────────────────

import type { Locomotive, TrackPosition } from '@domain/models/locomotive'
import {
  getFullTGVTrain,
  getTrackCurvatureAt,
  sampleForwardTrack,
  findJunctionAhead,
  type BogieFrame,
  type TGVDetails,
  type TGVAccordion,
  type TGVFullTrain,
} from '@domain/models/locomotive'
import type { TrainSet, CouplerPoint } from '@domain/models/train'
import { getTrainSetVisuals, MAX_COUPLE_DISTANCE } from '@domain/models/train'
import { trainDynamics, type DrivingEnvironment } from '@domain/models/trainDynamics'

import type { TrainDebugOptions } from '@application/state/editorStore'
import { drawTrainMarker, pointsInBounds, vehiclesInBounds } from './lodTrains'

export interface TrainTelemetry {
  speed?: number
  maxSpeed?: number
  /** What the train is doing: 1 = traction, -1 = braking, 0 = neither */
  throttle?: 1 | 0 | -1
  /** Legacy locomotive: acceleration (m/s²) while `throttle` is 1 */
  acceleration?: number
  /** Legacy locomotive: deceleration (m/s²) while `throttle` is -1, also used for its stopping distance */
  braking?: number
  /** Acceleration the physics really gives, m/s², signed along the motion. Replaces the legacy estimate. */
  realAcceleration?: number
  /** Distance (m) the physics needs to stop the train. Replaces the legacy estimate. */
  stoppingDistance?: number
  debugOptions?: Partial<TrainDebugOptions>
}

/** Brake cylinder pressure (bar) from which a train is shown as braking */
const BRAKING_SHOWN_FROM_BAR = 0.05

/** Telemetry of a TrainSet for the debug overlay, read from the physics rather than from the controls */
export function trainSetTelemetry(net: Network, train: TrainSet, env?: DrivingEnvironment): TrainTelemetry {
  const dynamics = trainDynamics(net, train, env)
  return {
    speed: train.currentSpeed,
    maxSpeed: train.maxSpeed,
    throttle: dynamics.brakeCylinderBar > BRAKING_SHOWN_FROM_BAR || dynamics.electricBrakeForce > 0
      ? -1
      : dynamics.tractionEffort > 0 ? 1 : 0,
    realAcceleration: dynamics.acceleration,
    stoppingDistance: dynamics.stoppingDistance,
  }
}

/** Samples along the stopping distance tape (sampleForwardTrack gives up after 150 steps) */
const STOP_TAPE_SAMPLES = 140
/** Longest stopping distance tape drawn, m */
const STOP_TAPE_MAX_LENGTH = 20000

/** Deceleration (m/s²) assumed for the legacy locomotive when it gives none */
const LEGACY_DEFAULT_BRAKING = 10.0

/**
 * Acceleration (m/s², signed along the motion) and stopping distance (m) the overlay shows.
 * A TrainSet brings both from the physics; the legacy locomotive has them rebuilt from its controls.
 */
export function telemetryKinematics(telemetry: TrainTelemetry | undefined): { acceleration: number; stoppingDistance: number } {
  const speed = telemetry?.speed ?? 0
  const throttle = telemetry?.throttle ?? 0
  // `||`, not `??`: a braking of 0 would make the stopping distance infinite
  const braking = telemetry?.braking || LEGACY_DEFAULT_BRAKING
  const acceleration = telemetry?.realAcceleration
    ?? (throttle === 1 ? (telemetry?.acceleration ?? 5.5) : throttle === -1 ? -braking : speed > 0.05 ? -0.5 : 0)
  const stoppingDistance = telemetry?.stoppingDistance ?? (speed * speed) / (2 * braking)
  return {
    acceleration: Number.isFinite(acceleration) ? acceleration : 0,
    // +Infinity is kept: it is the physics saying that the brake does not hold the train on this slope
    stoppingDistance: Number.isNaN(stoppingDistance) ? 0 : Math.max(stoppingDistance, 0),
  }
}

/**
 * Render a locomotive on the canvas.
 * Draws:
 * - 2 rotating bogies following track curvature, each with:
 *   - A rotating frame (carré/rectangle orienté)
 *   - 2 mechanical axles with wheel treads
 *   - A fixed center pivot pin
 * - The rigid locomotive body silhouette (TGV aerodynamic shape)
 * - The forward nose tip indicator
 */
export function renderLocomotive(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  loco: Locomotive,
  isGhost = false,
  isDebugSkeleton = false,
  isSelected = false,
  telemetry?: TrainTelemetry,
  isDeleteHovered = false,
): void {
  const train = getFullTGVTrain(net, loco)
  if (!train) return

  // Nothing of the consist in view: nothing to draw. The debug overlay reaches far beyond the
  // train (stopping distance, vectors), so it is never skipped.
  if (!isDebugSkeleton) {
    const bounds = getViewportBounds(cam, vw, vh)
    const bodies = [train.leadLoco, ...train.cars, ...(train.rearLoco ? [train.rearLoco] : [])]
    if (!bodies.some(body => pointsInBounds(body.polygon, bounds))) return
  }

  ctx.save()

  // Convert world points to screen
  const toSx = (p: Point) => (p.x - cam.x) * cam.scale + vw / 2
  const toSy = (p: Point) => (p.y - cam.y) * cam.scale + vh / 2

  if (isGhost) {
    ctx.globalAlpha = 0.45
  }

  // Schematic drawing: the consist is a marker of constant size (the caller handles its level)
  if (!isDebugSkeleton && trackLod(cam.scale, GAUGE) === 'schematic') {
    drawTrainMarker(
      ctx, toSx, toSy,
      train.bogies.map(b => ({ pos: b.center, level: 0 })),
      trainMarkerStyle(ctx, isSelected && !isGhost, isDeleteHovered && !isGhost),
      (_level, draw) => draw(),
    )
    ctx.restore()
    return
  }

  // Ligne de sélection fine et nette sans aucun effet de glow baveux (désactivé en mode squelette pour clarté)
  if (isSelected && !isGhost && !isDebugSkeleton) {
    ctx.save()
    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    // Contour motrice 1
    ctx.beginPath()
    ctx.moveTo(toSx(train.leadLoco.polygon[0]), toSy(train.leadLoco.polygon[0]))
    for (let pi = 1; pi < train.leadLoco.polygon.length; pi++) {
      ctx.lineTo(toSx(train.leadLoco.polygon[pi]), toSy(train.leadLoco.polygon[pi]))
    }
    ctx.closePath()
    ctx.stroke()
    // Contour voitures
    for (const car of train.cars) {
      ctx.beginPath()
      ctx.moveTo(toSx(car.polygon[0]), toSy(car.polygon[0]))
      for (let pi = 1; pi < car.polygon.length; pi++) {
        ctx.lineTo(toSx(car.polygon[pi]), toSy(car.polygon[pi]))
      }
      ctx.closePath()
      ctx.stroke()
    }
    // Contour motrice 2
    if (train.rearLoco) {
      ctx.beginPath()
      ctx.moveTo(toSx(train.rearLoco.polygon[0]), toSy(train.rearLoco.polygon[0]))
      for (let pi = 1; pi < train.rearLoco.polygon.length; pi++) {
        ctx.lineTo(toSx(train.rearLoco.polygon[pi]), toSy(train.rearLoco.polygon[pi]))
      }
      ctx.closePath()
      ctx.stroke()
    }
    ctx.restore()
  }

  // 1. Dessiner tous les bogies sous les caisses (M1, Jacobs partagés, M2)
  const drawBogie = (bogie: BogieFrame, isLeadBogie: boolean) => {
    // 1.1 Châssis mécanique en H vu de dessus (longerons latéraux + traverse centrale, affinés)
    const halfL = 1.35
    const halfW = 0.90
    const beamW = 0.16

    // Poutre latérale gauche
    const bl1 = { x: bogie.center.x + bogie.tangent.x * halfL + bogie.normal.x * (halfW - beamW), y: bogie.center.y + bogie.tangent.y * halfL + bogie.normal.y * (halfW - beamW) }
    const bl2 = { x: bogie.center.x + bogie.tangent.x * halfL + bogie.normal.x * halfW, y: bogie.center.y + bogie.tangent.y * halfL + bogie.normal.y * halfW }
    const bl3 = { x: bogie.center.x - bogie.tangent.x * halfL + bogie.normal.x * halfW, y: bogie.center.y - bogie.tangent.y * halfL + bogie.normal.y * halfW }
    const bl4 = { x: bogie.center.x - bogie.tangent.x * halfL + bogie.normal.x * (halfW - beamW), y: bogie.center.y - bogie.tangent.y * halfL + bogie.normal.y * (halfW - beamW) }
    ctx.beginPath()
    ctx.moveTo(toSx(bl1), toSy(bl1))
    ctx.lineTo(toSx(bl2), toSy(bl2))
    ctx.lineTo(toSx(bl3), toSy(bl3))
    ctx.lineTo(toSx(bl4), toSy(bl4))
    ctx.closePath()
    ctx.fillStyle = isGhost ? 'rgba(30, 41, 59, 0.4)' : '#1e293b'
    ctx.fill()
    ctx.strokeStyle = isGhost ? 'rgba(100, 116, 139, 0.5)' : '#475569'
    ctx.lineWidth = Math.max(0.8, 1.0 * Math.sqrt(cam.scale))
    ctx.stroke()

    // Poutre latérale droite
    const br1 = { x: bogie.center.x + bogie.tangent.x * halfL - bogie.normal.x * halfW, y: bogie.center.y + bogie.tangent.y * halfL - bogie.normal.y * halfW }
    const br2 = { x: bogie.center.x + bogie.tangent.x * halfL - bogie.normal.x * (halfW - beamW), y: bogie.center.y + bogie.tangent.y * halfL - bogie.normal.y * (halfW - beamW) }
    const br3 = { x: bogie.center.x - bogie.tangent.x * halfL - bogie.normal.x * (halfW - beamW), y: bogie.center.y - bogie.tangent.y * halfL - bogie.normal.y * (halfW - beamW) }
    const br4 = { x: bogie.center.x - bogie.tangent.x * halfL - bogie.normal.x * halfW, y: bogie.center.y - bogie.tangent.y * halfL - bogie.normal.y * halfW }
    ctx.beginPath()
    ctx.moveTo(toSx(br1), toSy(br1))
    ctx.lineTo(toSx(br2), toSy(br2))
    ctx.lineTo(toSx(br3), toSy(br3))
    ctx.lineTo(toSx(br4), toSy(br4))
    ctx.closePath()
    ctx.fillStyle = isGhost ? 'rgba(30, 41, 59, 0.4)' : '#1e293b'
    ctx.fill()
    ctx.strokeStyle = isGhost ? 'rgba(100, 116, 139, 0.5)' : '#475569'
    ctx.lineWidth = Math.max(0.8, 1.0 * Math.sqrt(cam.scale))
    ctx.stroke()

    // Traverse centrale (bolster)
    const bmidW = 0.28
    const bm1 = { x: bogie.center.x + bogie.tangent.x * bmidW + bogie.normal.x * halfW, y: bogie.center.y + bogie.tangent.y * bmidW + bogie.normal.y * halfW }
    const bm2 = { x: bogie.center.x + bogie.tangent.x * bmidW - bogie.normal.x * halfW, y: bogie.center.y + bogie.tangent.y * bmidW - bogie.normal.y * halfW }
    const bm3 = { x: bogie.center.x - bogie.tangent.x * bmidW - bogie.normal.x * halfW, y: bogie.center.y - bogie.tangent.y * bmidW - bogie.normal.y * halfW }
    const bm4 = { x: bogie.center.x - bogie.tangent.x * bmidW + bogie.normal.x * halfW, y: bogie.center.y - bogie.tangent.y * bmidW + bogie.normal.y * halfW }
    ctx.beginPath()
    ctx.moveTo(toSx(bm1), toSy(bm1))
    ctx.lineTo(toSx(bm2), toSy(bm2))
    ctx.lineTo(toSx(bm3), toSy(bm3))
    ctx.lineTo(toSx(bm4), toSy(bm4))
    ctx.closePath()
    ctx.fillStyle = isGhost ? 'rgba(15, 23, 42, 0.5)' : '#0f172a'
    ctx.fill()
    ctx.strokeStyle = isGhost ? 'rgba(100, 116, 139, 0.5)' : '#475569'
    ctx.lineWidth = Math.max(0.8, 1.0 * Math.sqrt(cam.scale))
    ctx.stroke()

    // 1.2 Essieux et roues
    const wheelHalfL = 0.38
    const wheelThickness = 0.07
    for (const axle of bogie.axles) {
      // Barre transversale d'axe
      ctx.beginPath()
      ctx.moveTo(toSx(axle.left), toSy(axle.left))
      ctx.lineTo(toSx(axle.right), toSy(axle.right))
      ctx.strokeStyle = isGhost ? 'rgba(148, 163, 184, 0.5)' : '#94a3b8'
      ctx.lineWidth = Math.max(1.0, 1.6 * Math.sqrt(cam.scale))
      ctx.stroke()

      const drawWheel = (wc: Point) => {
        const w1 = { x: wc.x + bogie.tangent.x * wheelHalfL + bogie.normal.x * wheelThickness, y: wc.y + bogie.tangent.y * wheelHalfL + bogie.normal.y * wheelThickness }
        const w2 = { x: wc.x + bogie.tangent.x * wheelHalfL - bogie.normal.x * wheelThickness, y: wc.y + bogie.tangent.y * wheelHalfL - bogie.normal.y * wheelThickness }
        const w3 = { x: wc.x - bogie.tangent.x * wheelHalfL - bogie.normal.x * wheelThickness, y: wc.y - bogie.tangent.y * wheelHalfL - bogie.normal.y * wheelThickness }
        const w4 = { x: wc.x - bogie.tangent.x * wheelHalfL + bogie.normal.x * wheelThickness, y: wc.y - bogie.tangent.y * wheelHalfL - bogie.normal.y * wheelThickness }
        ctx.beginPath()
        ctx.moveTo(toSx(w1), toSy(w1))
        ctx.lineTo(toSx(w2), toSy(w2))
        ctx.lineTo(toSx(w3), toSy(w3))
        ctx.lineTo(toSx(w4), toSy(w4))
        ctx.closePath()
        ctx.fillStyle = isGhost ? 'rgba(51, 65, 85, 0.7)' : '#334155'
        ctx.fill()
        ctx.strokeStyle = isGhost ? 'rgba(203, 213, 225, 0.8)' : '#e2e8f0'
        ctx.lineWidth = Math.max(0.8, 1.0 * Math.sqrt(cam.scale))
        ctx.stroke()
      }

      drawWheel(axle.leftWheel)
      drawWheel(axle.rightWheel)

      // Boîtes d'essieu
      const boxSize = 0.12
      const drawBox = (pt: Point) => {
        const b1 = { x: pt.x + bogie.tangent.x * boxSize + bogie.normal.x * boxSize, y: pt.y + bogie.tangent.y * boxSize + bogie.normal.y * boxSize }
        const b2 = { x: pt.x + bogie.tangent.x * boxSize - bogie.normal.x * boxSize, y: pt.y + bogie.tangent.y * boxSize - bogie.normal.y * boxSize }
        const b3 = { x: pt.x - bogie.tangent.x * boxSize - bogie.normal.x * boxSize, y: pt.y - bogie.tangent.y * boxSize - bogie.normal.y * boxSize }
        const b4 = { x: pt.x - bogie.tangent.x * boxSize + bogie.normal.x * boxSize, y: pt.y - bogie.tangent.y * boxSize + bogie.normal.y * boxSize }
        ctx.beginPath()
        ctx.moveTo(toSx(b1), toSy(b1))
        ctx.lineTo(toSx(b2), toSy(b2))
        ctx.lineTo(toSx(b3), toSy(b3))
        ctx.lineTo(toSx(b4), toSy(b4))
        ctx.closePath()
        ctx.fillStyle = isGhost ? 'rgba(71, 85, 105, 0.7)' : '#64748b'
        ctx.fill()
        ctx.strokeStyle = '#0f172a'
        ctx.lineWidth = 0.8
        ctx.stroke()
      }
      drawBox(axle.left)
      drawBox(axle.right)
    }

    // 1.3 Pivot central fixé
    const pivotOuterR = Math.max(3, Math.min(6, 3.5 * Math.sqrt(cam.scale)))
    const pivotInnerR = Math.max(1.5, Math.min(3, 1.8 * Math.sqrt(cam.scale)))
    ctx.beginPath()
    ctx.arc(toSx(bogie.center), toSy(bogie.center), pivotOuterR, 0, Math.PI * 2)
    ctx.fillStyle = '#334155'
    ctx.fill()
    ctx.strokeStyle = '#94a3b8'
    ctx.lineWidth = 1.2
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(toSx(bogie.center), toSy(bogie.center), pivotInnerR, 0, Math.PI * 2)
    ctx.fillStyle = isLeadBogie ? '#ef4444' : '#fb923c'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  for (let i = 0; i < train.bogies.length; i++) {
    drawBogie(train.bogies[i], i === 0)
  }

  // 2. Dessiner les soufflets accordéons flexibles reliant les caisses
  for (const acc of train.accordions) {
    ctx.beginPath()
    ctx.moveTo(toSx(acc.frontFrame[0]), toSy(acc.frontFrame[0]))
    ctx.lineTo(toSx(acc.frontFrame[1]), toSy(acc.frontFrame[1]))
    ctx.lineTo(toSx(acc.rearFrame[1]), toSy(acc.rearFrame[1]))
    ctx.lineTo(toSx(acc.rearFrame[0]), toSy(acc.rearFrame[0]))
    ctx.closePath()
    ctx.fillStyle = isGhost ? 'rgba(30, 41, 59, 0.5)' : '#1e293b'
    ctx.fill()
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Plis d'accordéon élastiques (qui s'écartent ou se resserrent selon la courbure)
    for (const fold of acc.folds) {
      ctx.beginPath()
      ctx.moveTo(toSx(fold.left), toSy(fold.left))
      ctx.lineTo(toSx(fold.right), toSy(fold.right))
      ctx.strokeStyle = isGhost ? 'rgba(100, 116, 139, 0.5)' : '#475569'
      ctx.lineWidth = Math.max(1, 1.5 * Math.sqrt(cam.scale))
      ctx.stroke()
    }
  }

  // 3. Dessiner les voitures voyageurs intermédiaires
  for (const car of train.cars) {
    ctx.beginPath()
    ctx.moveTo(toSx(car.polygon[0]), toSy(car.polygon[0]))
    for (let pi = 1; pi < car.polygon.length; pi++) {
      ctx.lineTo(toSx(car.polygon[pi]), toSy(car.polygon[pi]))
    }
    ctx.closePath()

    if (isDebugSkeleton) {
      const isXray = telemetry?.debugOptions?.xray !== false
      if (isXray) {
        // Mode X-Ray : carrosserie semi-transparente "verre teinté" bleu cyan
        ctx.fillStyle = 'rgba(14, 165, 233, 0.07)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.40)'
        ctx.lineWidth = Math.max(1, 1.2 * Math.sqrt(cam.scale))
        ctx.stroke()
      } else {
        // Mode Squelette pur : contour filaire discret et très fin
        ctx.setLineDash([3, 3])
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)'
        ctx.lineWidth = 0.75
        ctx.stroke()
        ctx.setLineDash([])
      }
    } else {
      ctx.fillStyle = isGhost ? 'rgba(241, 245, 249, 0.4)' : 'rgba(248, 250, 252, 0.92)'
      ctx.fill()
      ctx.strokeStyle = isGhost ? 'rgba(51, 65, 85, 0.5)' : '#334155'
      ctx.lineWidth = Math.max(1.0, 1.3 * Math.sqrt(cam.scale))
      ctx.stroke()

      // Bandes latérales bleu roi TGV
      ctx.beginPath()
      ctx.moveTo(toSx(car.polygon[0]), toSy(car.polygon[0]))
      ctx.lineTo(toSx(car.polygon[3]), toSy(car.polygon[3]))
      ctx.strokeStyle = isGhost ? 'rgba(37, 99, 235, 0.4)' : '#2563eb'
      ctx.lineWidth = Math.max(1.3, 1.6 * Math.sqrt(cam.scale))
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(toSx(car.polygon[1]), toSy(car.polygon[1]))
      ctx.lineTo(toSx(car.polygon[2]), toSy(car.polygon[2]))
      ctx.strokeStyle = isGhost ? 'rgba(37, 99, 235, 0.4)' : '#2563eb'
      ctx.lineWidth = Math.max(1.3, 1.6 * Math.sqrt(cam.scale))
      ctx.stroke()

      // Baies vitrées passagers
      const drawWindows = (wins: { p1: Point; p2: Point }[]) => {
        for (const w of wins) {
          ctx.beginPath()
          ctx.moveTo(toSx(w.p1), toSy(w.p1))
          ctx.lineTo(toSx(w.p2), toSy(w.p2))
          ctx.strokeStyle = '#0f172a'
          ctx.lineWidth = Math.max(1.2, 1.8 * Math.sqrt(cam.scale))
          ctx.stroke()
        }
      }
      drawWindows(car.windowsLeft)
      drawWindows(car.windowsRight)
    }
  }

  // 4. Fonction de rendu d'une motrice TGV (tête ou queue)
  const drawLoco = (tgv: TGVDetails, isFrontFacing: boolean) => {
    ctx.beginPath()
    ctx.moveTo(toSx(tgv.polygon[0]), toSy(tgv.polygon[0]))
    for (let i = 1; i < tgv.polygon.length; i++) {
      ctx.lineTo(toSx(tgv.polygon[i]), toSy(tgv.polygon[i]))
    }
    ctx.closePath()

    if (isDebugSkeleton) {
      const isXray = telemetry?.debugOptions?.xray !== false
      if (isXray) {
        // Mode X-Ray : carrosserie motrice aérodynamique semi-transparente bleu cyan
        ctx.fillStyle = 'rgba(14, 165, 233, 0.09)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.50)'
        ctx.lineWidth = Math.max(1, 1.2 * Math.sqrt(cam.scale))
        ctx.stroke()
      } else {
        // Mode Squelette pur : contour filaire discret et très fin
        ctx.setLineDash([3, 3])
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)'
        ctx.lineWidth = 0.75
        ctx.stroke()
        ctx.setLineDash([])
      }
    } else {
      ctx.fillStyle = isGhost ? 'rgba(241, 245, 249, 0.4)' : 'rgba(248, 250, 252, 0.90)'
      ctx.fill()
      ctx.strokeStyle = isGhost ? 'rgba(51, 65, 85, 0.5)' : '#334155'
      ctx.lineWidth = Math.max(1.0, 1.3 * Math.sqrt(cam.scale))
      ctx.stroke()

      // Bandes profilées latérales bleu roi TGV
      ctx.beginPath()
      ctx.moveTo(toSx(tgv.polygon[1]), toSy(tgv.polygon[1]))
      ctx.lineTo(toSx(tgv.polygon[2]), toSy(tgv.polygon[2]))
      ctx.lineTo(toSx(tgv.polygon[3]), toSy(tgv.polygon[3]))
      ctx.lineTo(toSx(tgv.polygon[4]), toSy(tgv.polygon[4]))
      ctx.strokeStyle = isGhost ? 'rgba(37, 99, 235, 0.4)' : '#2563eb'
      ctx.lineWidth = Math.max(1.3, 1.6 * Math.sqrt(cam.scale))
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(toSx(tgv.polygon[5]), toSy(tgv.polygon[5]))
      ctx.lineTo(toSx(tgv.polygon[6]), toSy(tgv.polygon[6]))
      ctx.lineTo(toSx(tgv.polygon[7]), toSy(tgv.polygon[7]))
      ctx.lineTo(toSx(tgv.polygon[8]), toSy(tgv.polygon[8]))
      ctx.strokeStyle = isGhost ? 'rgba(37, 99, 235, 0.4)' : '#2563eb'
      ctx.lineWidth = Math.max(1.3, 1.6 * Math.sqrt(cam.scale))
      ctx.stroke()

      // Pare-brise panoramique de cabine teinté sombre avec reflet
      ctx.beginPath()
      ctx.moveTo(toSx(tgv.windshield[0]), toSy(tgv.windshield[0]))
      for (let i = 1; i < tgv.windshield.length; i++) {
        ctx.lineTo(toSx(tgv.windshield[i]), toSy(tgv.windshield[i]))
      }
      ctx.closePath()
      ctx.fillStyle = isGhost ? 'rgba(15, 23, 42, 0.7)' : '#0f172a'
      ctx.fill()
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = Math.max(1, 1.2 * Math.sqrt(cam.scale))
      ctx.stroke()

      // Phares avant ou feux de queue rouges
      const hlR = Math.max(2, 2.8 * Math.sqrt(cam.scale))
      const isLitWhite = (isFrontFacing && loco.direction === 1) || (!isFrontFacing && loco.direction === -1)
      const hlColor = isLitWhite ? '#fef08a' : '#ef4444'
      const hlBorder = isLitWhite ? '#eab308' : '#991b1b'

      ctx.beginPath()
      ctx.arc(toSx(tgv.headlights.left), toSy(tgv.headlights.left), hlR, 0, Math.PI * 2)
      ctx.fillStyle = hlColor
      ctx.fill()
      ctx.strokeStyle = hlBorder
      ctx.lineWidth = 1
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(toSx(tgv.headlights.right), toSy(tgv.headlights.right), hlR, 0, Math.PI * 2)
      ctx.fillStyle = hlColor
      ctx.fill()
      ctx.strokeStyle = hlBorder
      ctx.lineWidth = 1
      ctx.stroke()

      // Pantographe de toiture
      const panto = tgv.pantograph
      ctx.beginPath()
      ctx.moveTo(toSx(panto.armStart), toSy(panto.armStart))
      ctx.lineTo(toSx(panto.center), toSy(panto.center))
      ctx.lineTo(toSx(panto.armEnd), toSy(panto.armEnd))
      ctx.strokeStyle = isGhost ? 'rgba(71, 85, 105, 0.6)' : '#475569'
      ctx.lineWidth = Math.max(1.5, 2 * Math.sqrt(cam.scale))
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(toSx(panto.bowLeft), toSy(panto.bowLeft))
      ctx.lineTo(toSx(panto.bowRight), toSy(panto.bowRight))
      ctx.strokeStyle = isGhost ? 'rgba(203, 213, 225, 0.8)' : '#e2e8f0'
      ctx.lineWidth = Math.max(2, 3 * Math.sqrt(cam.scale))
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(toSx(panto.bowLeft), toSy(panto.bowLeft), Math.max(1.5, 2 * Math.sqrt(cam.scale)), 0, Math.PI * 2)
      ctx.arc(toSx(panto.bowRight), toSy(panto.bowRight), Math.max(1.5, 2 * Math.sqrt(cam.scale)), 0, Math.PI * 2)
      ctx.fillStyle = '#d97706'
      ctx.fill()
    }
  }

  // Dessin de la motrice avant
  drawLoco(train.leadLoco, true)

  // Dessin de la motrice arrière inversée (si présente)
  if (train.rearLoco) {
    drawLoco(train.rearLoco, false)
  }

  // 5. En mode Debug Squelette : afficher tous les repères, réticules, points logiques d'attache, cotations et vecteurs dynamiques
  if (isDebugSkeleton) {
    renderTrainSkeletonDebug(ctx, cam, toSx, toSy, train, net, loco, telemetry)
  }

  // 6. Delete mode hover highlight (contour rouge vibrant + badge Supprimer)
  if (isDeleteHovered && !isGhost) {
    ctx.save()
    ctx.shadowColor = 'rgba(239, 68, 68, 0.85)'
    ctx.shadowBlur = 10
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    ctx.fillStyle = 'rgba(239, 68, 68, 0.25)'
    ctx.beginPath()
    ctx.moveTo(toSx(train.leadLoco.polygon[0]), toSy(train.leadLoco.polygon[0]))
    for (let pi = 1; pi < train.leadLoco.polygon.length; pi++) {
      ctx.lineTo(toSx(train.leadLoco.polygon[pi]), toSy(train.leadLoco.polygon[pi]))
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    const avgX = train.leadLoco.polygon.reduce((acc, p) => acc + p.x, 0) / train.leadLoco.polygon.length
    const avgY = train.leadLoco.polygon.reduce((acc, p) => acc + p.y, 0) / train.leadLoco.polygon.length
    const badgeSx = toSx({ x: avgX, y: avgY })
    const badgeSy = toSy({ x: avgX, y: avgY }) - 24

    ctx.shadowBlur = 6
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.font = '600 11px Archivo, system-ui, sans-serif'
    const label = '✕ Supprimer'
    const lw = ctx.measureText(label).width
    const padX = 7
    const padY = 4

    ctx.fillStyle = '#ef4444'
    ctx.beginPath()
    ctx.roundRect(badgeSx - lw / 2 - padX, badgeSy - 9 - padY, lw + padX * 2, 18 + padY * 2, 5)
    ctx.fill()

    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, badgeSx, badgeSy)

    ctx.restore()
  }

  ctx.restore()
}

/** Normalise un angle en radians dans l'intervalle [-PI, PI] */
function normalizeAngle(rad: number): number {
  let a = rad % (2 * Math.PI)
  if (a > Math.PI) a -= 2 * Math.PI
  if (a < -Math.PI) a += 2 * Math.PI
  return a
}

/** Badge d'angle et de mesure technique sur le canvas */
function drawYawBadge(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  text: string,
  color: string,
  fs: number,
  bg = 'rgba(15, 23, 42, 0.90)',
): void {
  ctx.save()
  ctx.font = `600 ${fs}px Archivo, system-ui, sans-serif`
  const tw = ctx.measureText(text).width
  const padX = 4
  const padY = 2
  const bh = fs + padY * 2
  ctx.fillStyle = bg
  ctx.fillRect(sx - tw / 2 - padX, sy - bh / 2, tw + padX * 2, bh)
  ctx.strokeStyle = color
  ctx.lineWidth = 0.8
  ctx.strokeRect(sx - tw / 2 - padX, sy - bh / 2, tw + padX * 2, bh)
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, sx, sy)
  ctx.restore()
}

/** Rendu des angles de lacet bogie vs caisse (Δθ) et des angles d'articulation inter-caisses (θ_artic) */
function renderBogieYawAndArticulations(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  toSx: (p: Point) => number,
  toSy: (p: Point) => number,
  train: TGVFullTrain,
  fontSize: number,
): void {
  if (train.bogies.length === 0) return

  // 1. Calcul des orientations angulaires des caisses (headings)
  const b0 = train.bogies[0].center
  const b1 = train.bogies[1]?.center ?? b0
  const m1BodyAngle = Math.atan2(b0.y - b1.y, b0.x - b1.x)

  const carBodyAngles: number[] = []
  for (let ci = 0; ci < train.cars.length; ci++) {
    const fIdx = 2 + ci * 2
    const rIdx = fIdx + 1
    if (rIdx < train.bogies.length) {
      const bF = train.bogies[fIdx].center
      const bR = train.bogies[rIdx].center
      carBodyAngles.push(Math.atan2(bF.y - bR.y, bF.x - bR.x))
    } else {
      carBodyAngles.push(m1BodyAngle)
    }
  }

  const nB = train.bogies.length
  let m2BodyAngle: number | null = null
  if (train.rearLoco && nB >= 2) {
    const bTail = train.bogies[nB - 1].center
    const bInner = train.bogies[nB - 2].center
    m2BodyAngle = Math.atan2(bTail.y - bInner.y, bTail.x - bInner.x)
  }

  // 2. Calcul et dessin des angles de lacet bogie/caisse Δθ
  for (let bi = 0; bi < train.bogies.length; bi++) {
    const bogie = train.bogies[bi]
    let bodyAngle = m1BodyAngle
    if (bi === 0 || bi === 1) {
      bodyAngle = m1BodyAngle
    } else if (train.rearLoco && (bi === nB - 2 || bi === nB - 1)) {
      bodyAngle = m2BodyAngle ?? m1BodyAngle
    } else {
      const carIdx = Math.floor((bi - 2) / 2)
      bodyAngle = carBodyAngles[carIdx] ?? m1BodyAngle
    }

    const bogieAngle = Math.atan2(bogie.tangent.y, bogie.tangent.x)
    const deltaTheta = normalizeAngle(bogieAngle - bodyAngle)
    const deg = (deltaTheta * 180) / Math.PI

    if (Math.abs(deg) >= 0.25) {
      const sx = toSx(bogie.center)
      const sy = toSy(bogie.center)
      const arcR = Math.max(10, 13 * Math.sqrt(cam.scale))

      const absDeg = Math.abs(deg)
      const color = absDeg <= 8 ? '#22c55e' : absDeg <= 12 ? '#f59e0b' : '#ef4444'

      ctx.save()
      ctx.beginPath()
      ctx.arc(sx, sy, arcR, bodyAngle, bogieAngle, deltaTheta < 0)
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(1.0, 1.3 * Math.sqrt(cam.scale))
      ctx.stroke()

      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(sx + Math.cos(bogieAngle) * arcR, sy + Math.sin(bogieAngle) * arcR)
      ctx.strokeStyle = color
      ctx.lineWidth = 0.8
      ctx.stroke()

      const badgeText = `Δθ = ${deg >= 0 ? '+' : ''}${deg.toFixed(1)}°`
      const badgeDist = arcR + 10
      const midAngle = bodyAngle + deltaTheta * 0.5
      const bx = sx + Math.cos(midAngle) * badgeDist
      const by = sy + Math.sin(midAngle) * badgeDist

      drawYawBadge(ctx, bx, by, badgeText, color, fontSize * 0.85)
      ctx.restore()
    }
  }

  // 3. Calcul et affichage des angles d'articulation inter-caisses θ_artic
  if (train.cars.length > 0) {
    const thetaArtic0 = Math.abs(normalizeAngle(carBodyAngles[0] - m1BodyAngle))
    const deg0 = (thetaArtic0 * 180) / Math.PI
    if (deg0 >= 0.25) {
      const m1Tail = {
        x: (train.leadLoco.polygon[4].x + train.leadLoco.polygon[5].x) / 2,
        y: (train.leadLoco.polygon[4].y + train.leadLoco.polygon[5].y) / 2,
      }
      const col0 = deg0 < 10 ? '#38bdf8' : deg0 <= 16 ? '#f59e0b' : '#ef4444'
      drawYawBadge(ctx, toSx(m1Tail), toSy(m1Tail) + 16, `θ artic = ${deg0.toFixed(1)}°`, col0, fontSize * 0.82)
    }

    for (let ci = 0; ci < train.cars.length - 1; ci++) {
      const thetaArtic = Math.abs(normalizeAngle(carBodyAngles[ci + 1] - carBodyAngles[ci]))
      const deg = (thetaArtic * 180) / Math.PI
      if (deg >= 0.25) {
        const carA = train.cars[ci]
        const rearAtt = {
          x: (carA.polygon[2].x + carA.polygon[3].x) / 2,
          y: (carA.polygon[2].y + carA.polygon[3].y) / 2,
        }
        const col = deg < 10 ? '#38bdf8' : deg <= 16 ? '#f59e0b' : '#ef4444'
        drawYawBadge(ctx, toSx(rearAtt), toSy(rearAtt) + 16, `θ artic = ${deg.toFixed(1)}°`, col, fontSize * 0.82)
      }
    }

    if (train.rearLoco && m2BodyAngle !== null) {
      const lastCar = train.cars[train.cars.length - 1]
      const lastCarAngle = carBodyAngles[carBodyAngles.length - 1]
      const m2ForwardAngle = normalizeAngle(m2BodyAngle + Math.PI)
      const thetaArticRear = Math.abs(normalizeAngle(m2ForwardAngle - lastCarAngle))
      const degRear = (thetaArticRear * 180) / Math.PI
      if (degRear >= 0.25) {
        const rearAtt = {
          x: (lastCar.polygon[2].x + lastCar.polygon[3].x) / 2,
          y: (lastCar.polygon[2].y + lastCar.polygon[3].y) / 2,
        }
        const colR = degRear < 10 ? '#38bdf8' : degRear <= 16 ? '#f59e0b' : '#ef4444'
        drawYawBadge(ctx, toSx(rearAtt), toSy(rearAtt) + 16, `θ artic = ${degRear.toFixed(1)}°`, colR, fontSize * 0.82)
      }
    }
  } else if (train.rearLoco && m2BodyAngle !== null) {
    const m2ForwardAngle = normalizeAngle(m2BodyAngle + Math.PI)
    const thetaArtic = Math.abs(normalizeAngle(m2ForwardAngle - m1BodyAngle))
    const deg = (thetaArtic * 180) / Math.PI
    if (deg >= 0.25) {
      const m1Tail = {
        x: (train.leadLoco.polygon[4].x + train.leadLoco.polygon[5].x) / 2,
        y: (train.leadLoco.polygon[4].y + train.leadLoco.polygon[5].y) / 2,
      }
      const col = deg < 10 ? '#38bdf8' : deg <= 16 ? '#f59e0b' : '#ef4444'
      drawYawBadge(ctx, toSx(m1Tail), toSy(m1Tail) + 16, `θ artic = ${deg.toFixed(1)}°`, col, fontSize * 0.82)
    }
  }
}

/** Rendu du gabarit cinématique de libre passage UIC et du balayage dynamique en courbe (flèche f, saillie e) */
function renderKinematicGauge(
  ctx: CanvasRenderingContext2D,
  toSx: (p: Point) => number,
  toSy: (p: Point) => number,
  train: TGVFullTrain,
  net: Network | undefined,
  fontSize: number,
): void {
  const allVehicles: { name: string; polygon: Point[]; bogieA?: BogieFrame; bogieB?: BogieFrame; wheelbase: number; overhang: number }[] = []

  // Motrice M1
  if (train.bogies.length >= 2) {
    const wb = Math.hypot(train.bogies[0].center.x - train.bogies[1].center.x, train.bogies[0].center.y - train.bogies[1].center.y)
    allVehicles.push({
      name: 'M1',
      polygon: train.leadLoco.polygon,
      bogieA: train.bogies[0],
      bogieB: train.bogies[1],
      wheelbase: wb || 14.0,
      overhang: 3.04,
    })
  }

  // Voitures intermédiaires
  for (let ci = 0; ci < train.cars.length; ci++) {
    const fIdx = 2 + ci * 2
    const rIdx = fIdx + 1
    if (rIdx < train.bogies.length) {
      const wb = Math.hypot(train.bogies[fIdx].center.x - train.bogies[rIdx].center.x, train.bogies[fIdx].center.y - train.bogies[rIdx].center.y)
      allVehicles.push({
        name: `V${ci + 1}`,
        polygon: train.cars[ci].polygon,
        bogieA: train.bogies[fIdx],
        bogieB: train.bogies[rIdx],
        wheelbase: wb || 11.92,
        overhang: 3.04,
      })
    }
  }

  // Motrice M2
  const nB = train.bogies.length
  if (train.rearLoco && nB >= 2) {
    const wb = Math.hypot(train.bogies[nB - 1].center.x - train.bogies[nB - 2].center.x, train.bogies[nB - 1].center.y - train.bogies[nB - 2].center.y)
    allVehicles.push({
      name: 'M2',
      polygon: train.rearLoco.polygon,
      bogieA: train.bogies[nB - 2],
      bogieB: train.bogies[nB - 1],
      wheelbase: wb || 14.0,
      overhang: 3.04,
    })
  }

  ctx.save()
  for (const v of allVehicles) {
    if (v.polygon.length < 3) continue

    let minR = Infinity
    let isCurve = false
    if (net) {
      if (v.bogieA?.pos) {
        const cA = getTrackCurvatureAt(net, v.bogieA.pos)
        if (cA.side !== 'straight' && cA.radius > 0 && cA.radius < minR) {
          minR = cA.radius
          isCurve = true
        }
      }
      if (v.bogieB?.pos) {
        const cB = getTrackCurvatureAt(net, v.bogieB.pos)
        if (cB.side !== 'straight' && cB.radius > 0 && cB.radius < minR) {
          minR = cB.radius
          isCurve = true
        }
      }
    }

    const R = isCurve && isFinite(minR) ? minR : 100000
    const f = isCurve ? (v.wheelbase * v.wheelbase) / (8 * R) : 0
    const e = isCurve ? (v.overhang * (v.wheelbase + v.overhang)) / (2 * R) : 0

    let cX = 0
    let cY = 0
    for (const p of v.polygon) {
      cX += p.x
      cY += p.y
    }
    cX /= v.polygon.length
    cY /= v.polygon.length

    const margin = 0.22 + Math.max(f, e)

    ctx.beginPath()
    for (let pi = 0; pi < v.polygon.length; pi++) {
      const pt = v.polygon[pi]
      const dx = pt.x - cX
      const dy = pt.y - cY
      const dist = Math.hypot(dx, dy) || 1
      const expX = pt.x + (dx / dist) * margin
      const expY = pt.y + (dy / dist) * margin
      if (pi === 0) ctx.moveTo(toSx({ x: expX, y: expY }), toSy({ x: expX, y: expY }))
      else ctx.lineTo(toSx({ x: expX, y: expY }), toSy({ x: expX, y: expY }))
    }
    ctx.closePath()

    ctx.fillStyle = 'rgba(234, 179, 8, 0.05)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)'
    ctx.lineWidth = 0.75
    ctx.setLineDash([4, 3])
    ctx.stroke()
    ctx.setLineDash([])

    if (isCurve && (f > 0.015 || e > 0.015)) {
      const sCenterX = toSx({ x: cX, y: cY })
      const sCenterY = toSy({ x: cX, y: cY })
      const gText = `Gabarit ${v.name} : f=${(f * 100).toFixed(0)}cm · e=${(e * 100).toFixed(0)}cm`
      drawYawBadge(ctx, sCenterX, sCenterY, gText, '#fbbf24', fontSize * 0.8)
    }
  }
  ctx.restore()
}

/** Rendu des repères cinématiques, pivots de bogies, attaches de caisses, accordéons et vecteurs dynamiques */
function renderTrainSkeletonDebug(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  toSx: (p: Point) => number,
  toSy: (p: Point) => number,
  train: TGVFullTrain,
  net?: Network,
  loco?: Locomotive,
  telemetry?: TrainTelemetry,
): void {
  ctx.save()
  const fontSize = Math.max(8.5, Math.min(10.5, 9.5 * Math.sqrt(cam.scale)))
  ctx.font = `600 ${fontSize}px Archivo, system-ui, sans-serif`

  // 0. Gabarit cinématique et balayage dynamique en courbe (flèche f, saillie e)
  if (telemetry?.debugOptions?.gauge !== false) {
    renderKinematicGauge(ctx, toSx, toSy, train, net, fontSize)
  }

  // 1. Lignes de cote d'entraxe entre bogies consécutifs (trait fin pointillé)
  for (let bi = 0; bi < train.bogies.length - 1; bi++) {
    const bA = train.bogies[bi].center
    const bB = train.bogies[bi + 1].center
    const dist = Math.hypot(bA.x - bB.x, bA.y - bB.y)

    ctx.beginPath()
    ctx.setLineDash([2, 3])
    ctx.moveTo(toSx(bA), toSy(bA))
    ctx.lineTo(toSx(bB), toSy(bB))
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)'
    ctx.lineWidth = 0.8
    ctx.stroke()
    ctx.setLineDash([])

    // Badge textuel de cotation discret
    const midX = (toSx(bA) + toSx(bB)) / 2
    const midY = (toSy(bA) + toSy(bB)) / 2
    const label = `${dist.toFixed(2)} m`
    const pad = 2.5
    const tw = ctx.measureText(label).width
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)'
    ctx.fillRect(midX - tw / 2 - pad, midY - 6 - pad, tw + pad * 2, 12 + pad)
    ctx.fillStyle = '#38bdf8'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, midX, midY)
  }

  // 2. Points de bogies et réticules de pivots
  for (let bi = 0; bi < train.bogies.length; bi++) {
    const bogie = train.bogies[bi]
    const sx = toSx(bogie.center)
    const sy = toSy(bogie.center)

    // Disque de pivot central fin
    const rOuter = Math.max(3.5, 4.5 * Math.sqrt(cam.scale))
    ctx.beginPath()
    ctx.arc(sx, sy, rOuter, 0, Math.PI * 2)
    ctx.fillStyle = '#0284c7'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    ctx.stroke()

    // 2.2 Axes orientés qui tournent solidairement avec le bogie dans les courbes
    // (Axe longitudinal = tangent, Axe transversal = normal)
    const axisMeters = 2.0 // longueur de l'axe orienté en mètres
    const pFrontAxis = {
      x: bogie.center.x + bogie.tangent.x * axisMeters,
      y: bogie.center.y + bogie.tangent.y * axisMeters,
    }
    const pRearAxis = {
      x: bogie.center.x - bogie.tangent.x * axisMeters,
      y: bogie.center.y - bogie.tangent.y * axisMeters,
    }
    const pLeftAxis = {
      x: bogie.center.x + bogie.normal.x * 1.3,
      y: bogie.center.y + bogie.normal.y * 1.3,
    }
    const pRightAxis = {
      x: bogie.center.x - bogie.normal.x * 1.3,
      y: bogie.center.y - bogie.normal.y * 1.3,
    }

    // Axe transversal orienté (cyan fin - suit la rotation des essieux)
    ctx.beginPath()
    ctx.moveTo(toSx(pLeftAxis), toSy(pLeftAxis))
    ctx.lineTo(toSx(pRightAxis), toSy(pRightAxis))
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)'
    ctx.lineWidth = 1
    ctx.stroke()

    // Axe longitudinal orienté (ambre/orange fin - suit la direction du bogie)
    ctx.beginPath()
    ctx.moveTo(toSx(pRearAxis), toSy(pRearAxis))
    ctx.lineTo(toSx(pFrontAxis), toSy(pFrontAxis))
    ctx.strokeStyle = '#f59e0b'
    ctx.lineWidth = 1.2
    ctx.stroke()

    // Flèche / point d'orientation vers l'avant du bogie
    const sxF = toSx(pFrontAxis)
    const syF = toSy(pFrontAxis)
    ctx.beginPath()
    ctx.arc(sxF, syF, 2.2, 0, Math.PI * 2)
    ctx.fillStyle = '#f59e0b'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 0.8
    ctx.stroke()

    // Nom du bogie clair et précis
    let bName = `B${bi + 1}`
    if (bi === 0) bName = 'B1 (Nez M1)'
    else if (bi === 1) bName = 'B2 (Ar M1)'
    else if (bi === train.bogies.length - 2) bName = `B${bi + 1} (Ar M2)`
    else if (bi === train.bogies.length - 1) bName = `B${bi + 1} (Nez M2)`
    else {
      const carIndex = Math.floor((bi - 2) / 2)
      const isLeadInCar = (bi - 2) % 2 === 0
      bName = `V${carIndex + 1} (${isLeadInCar ? 'Bogie Av' : 'Bogie Ar'})`
    }

    const tw = ctx.measureText(bName).width
    ctx.fillStyle = 'rgba(2, 6, 23, 0.85)'
    ctx.fillRect(sx - tw / 2 - 2.5, sy - rOuter - 15, tw + 5, 12)
    ctx.fillStyle = '#f8fafc'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(bName, sx, sy - rOuter - 9)
  }

  // 2.5 Angles de lacet de bogies (Δθ) et angles d'articulation inter-caisses (θ_artic)
  if (telemetry?.debugOptions?.yawAngles !== false) {
    renderBogieYawAndArticulations(ctx, cam, toSx, toSy, train, fontSize)
  }

  // 3. Points logiques d'attache et de liaison mécanique centrale
  const drawAttachPoint = (p: Point, label: string, color: string) => {
    const sx = toSx(p)
    const sy = toSy(p)
    ctx.beginPath()
    ctx.arc(sx, sy, 3, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    ctx.stroke()

    if (label) {
      const tw = ctx.measureText(label).width
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
      ctx.fillRect(sx - tw / 2 - 2, sy + 5, tw + 4, 11)
      ctx.fillStyle = color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, sx, sy + 10.5)
    }
  }

  // Bielle / liaison mécanique centrale d'attelage (trait fin et net)
  const drawCouplerLink = (pA: Point, pB: Point, label: string) => {
    ctx.beginPath()
    ctx.moveTo(toSx(pA), toSy(pA))
    ctx.lineTo(toSx(pB), toSy(pB))
    ctx.strokeStyle = '#10b981'
    ctx.lineWidth = 1.2
    ctx.stroke()

    const mid = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 }
    drawAttachPoint(mid, label, '#10b981')
  }

  // Motrice M1
  const m1Tail = {
    x: (train.leadLoco.polygon[4].x + train.leadLoco.polygon[5].x) / 2,
    y: (train.leadLoco.polygon[4].y + train.leadLoco.polygon[5].y) / 2,
  }
  drawAttachPoint(train.leadLoco.polygon[0], 'Nez M1', '#ef4444')
  drawAttachPoint(m1Tail, 'Attache M1', '#f59e0b')

  // Voitures intermédiaires et liaisons centrales
  if (train.cars.length > 0) {
    const v0Front = {
      x: (train.cars[0].polygon[0].x + train.cars[0].polygon[1].x) / 2,
      y: (train.cars[0].polygon[0].y + train.cars[0].polygon[1].y) / 2,
    }
    drawCouplerLink(m1Tail, v0Front, 'Attelage M1-V1')

    for (let ci = 0; ci < train.cars.length; ci++) {
      const car = train.cars[ci]
      const pFrontAtt = {
        x: (car.polygon[0].x + car.polygon[1].x) / 2,
        y: (car.polygon[0].y + car.polygon[1].y) / 2,
      }
      const pRearAtt = {
        x: (car.polygon[3].x + car.polygon[2].x) / 2,
        y: (car.polygon[3].y + car.polygon[2].y) / 2,
      }
      drawAttachPoint(pFrontAtt, `V${ci + 1} Av`, '#22c55e')
      drawAttachPoint(pRearAtt, `V${ci + 1} Ar`, '#f59e0b')

      if (ci < train.cars.length - 1) {
        const nextCar = train.cars[ci + 1]
        const nextFrontAtt = {
          x: (nextCar.polygon[0].x + nextCar.polygon[1].x) / 2,
          y: (nextCar.polygon[0].y + nextCar.polygon[1].y) / 2,
        }
        drawCouplerLink(pRearAtt, nextFrontAtt, `Attelage V${ci + 1}-V${ci + 2}`)
      }
    }

    if (train.rearLoco) {
      const vLastRear = {
        x: (train.cars[train.cars.length - 1].polygon[3].x + train.cars[train.cars.length - 1].polygon[2].x) / 2,
        y: (train.cars[train.cars.length - 1].polygon[3].y + train.cars[train.cars.length - 1].polygon[2].y) / 2,
      }
      const m2Tail = {
        x: (train.rearLoco.polygon[4].x + train.rearLoco.polygon[5].x) / 2,
        y: (train.rearLoco.polygon[4].y + train.rearLoco.polygon[5].y) / 2,
      }
      drawCouplerLink(vLastRear, m2Tail, 'Attelage V-M2')
      drawAttachPoint(m2Tail, 'Attache M2', '#f59e0b')
      drawAttachPoint(train.rearLoco.polygon[0], 'Nez M2', '#ef4444')
    }
  } else if (train.rearLoco) {
    const m2Tail = {
      x: (train.rearLoco.polygon[4].x + train.rearLoco.polygon[5].x) / 2,
      y: (train.rearLoco.polygon[4].y + train.rearLoco.polygon[5].y) / 2,
    }
    drawCouplerLink(m1Tail, m2Tail, 'Attelage M1-M2')
    drawAttachPoint(m2Tail, 'Attache M2', '#f59e0b')
    drawAttachPoint(train.rearLoco.polygon[0], 'Nez M2', '#ef4444')
  }

  // 4. Parois latérales d'accordéons (traits fins et nets, distincts de la liaison centrale)
  for (let ai = 0; ai < train.accordions.length; ai++) {
    const acc = train.accordions[ai]
    const [fL, fR] = acc.frontFrame
    const [rL, rR] = acc.rearFrame

    // Ligne de paroi latérale GAUCHE
    ctx.beginPath()
    ctx.moveTo(toSx(fL), toSy(fL))
    ctx.lineTo(toSx(rL), toSy(rL))
    ctx.strokeStyle = '#06b6d4'
    ctx.lineWidth = 1
    ctx.stroke()

    // Ligne de paroi latérale DROITE
    ctx.beginPath()
    ctx.moveTo(toSx(fR), toSy(fR))
    ctx.lineTo(toSx(rR), toSy(rR))
    ctx.strokeStyle = '#06b6d4'
    ctx.lineWidth = 1
    ctx.stroke()

    // 4 points d'ancrage sur les parois latérales extérieures
    drawAttachPoint(fL, 'Paroi G', '#06b6d4')
    drawAttachPoint(fR, 'Paroi D', '#06b6d4')
    drawAttachPoint(rL, 'Paroi G', '#06b6d4')
    drawAttachPoint(rR, 'Paroi D', '#06b6d4')

    // Plis d'accordéons intérieurs reliant les deux parois latérales
    for (const fold of acc.folds) {
      ctx.beginPath()
      ctx.moveTo(toSx(fold.left), toSy(fold.left))
      ctx.lineTo(toSx(fold.right), toSy(fold.right))
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.5)'
      ctx.lineWidth = 0.75
      ctx.stroke()
    }

    // Badge d'écartement soufflet entre parois
    const midF = { x: (fL.x + fR.x) / 2, y: (fL.y + fR.y) / 2 }
    const midR = { x: (rL.x + rR.x) / 2, y: (rL.y + rR.y) / 2 }
    const gapLen = Math.hypot(midF.x - midR.x, midF.y - midR.y)
    const badgeX = (toSx(midF) + toSx(midR)) / 2
    const badgeY = (toSy(midF) + toSy(midR)) / 2 - 14
    const accLabel = `Soufflet latéral: ${gapLen.toFixed(2)} m`
    const tw = ctx.measureText(accLabel).width
    ctx.fillStyle = 'rgba(8, 51, 68, 0.9)'
    ctx.fillRect(badgeX - tw / 2 - 2.5, badgeY - 5, tw + 5, 11)
    ctx.fillStyle = '#22d3ee'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(accLabel, badgeX, badgeY)
  }

  // 5. Vecteurs dynamiques ferroviaires (vitesse, accélération, forces centrifuges, distance d'arrêt)
  const trainDirection = loco?.direction ?? 1
  const leadNosePt = trainDirection === 1
    ? train.leadLoco.polygon[0]
    : (train.rearLoco ? train.rearLoco.polygon[0] : train.leadLoco.polygon[0])
  const leadHeading = train.bogies.length > 0 ? train.bogies[0].tangent : { x: 1, y: 0 }
  const leadPos = loco ? (trainDirection === 1 ? loco.front : loco.rear) : undefined

  renderTrainDynamicVectors(
    ctx,
    cam,
    toSx,
    toSy,
    net,
    train.bogies,
    leadNosePt,
    leadHeading,
    trainDirection,
    telemetry,
    leadPos,
  )

  ctx.restore()
}

/**
 * Rendu des vecteurs dynamiques ferroviaires :
 * - Ruban de distance d'arrêt d'urgence projetée le long de la voie
 * - Vecteur vitesse V à la proue avec vitesse en km/h et m/s, et statut réactif (Traction / Freinage / Inertie / Arrêt)
 * - Vecteur accélération/freinage longitudinal a (m/s²)
 * - Vecteurs d'accélération centrifuge ac = v²/R et courbures de voies par bogie (seuils UIC vert/orange/rouge)
 * - Vecteurs de vitesse tangentielle locale par bogie
 */
export function renderTrainDynamicVectors(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  toSx: (p: Point) => number,
  toSy: (p: Point) => number,
  net: Network | undefined,
  bogies: BogieFrame[],
  leadNosePt: Point,
  leadHeading: Point,
  travelDirection: 1 | -1,
  telemetry?: TrainTelemetry,
  leadPos?: TrackPosition,
): void {
  ctx.save()
  const fontSize = Math.max(8.5, Math.min(10.5, 9.5 * Math.sqrt(cam.scale)))
  ctx.font = `600 ${fontSize}px Archivo, system-ui, sans-serif`

  const speedMs = telemetry?.speed ?? 0
  const speedKmh = speedMs * 3.6
  const throttle = telemetry?.throttle ?? 0

  // Code couleur réactif selon l'état dynamique
  const dynamicColor =
    throttle === 1
      ? '#22c55e'
      : throttle === -1
      ? '#ef4444'
      : speedMs > 0.05
      ? '#06b6d4'
      : '#94a3b8'

  const dynamicLabel =
    throttle === 1
      ? 'TRACTION'
      : throttle === -1
      ? 'FREINAGE'
      : speedMs > 0.05
      ? 'INERTIE'
      : 'ARRÊT'

  const opts = telemetry?.debugOptions
  const showVectors = opts?.vectors !== false
  const showLookahead = opts?.lookahead !== false

  // Helper pour dessiner une flèche vectorielle dans l'espace monde (affinée et profilée)
  const drawWorldArrow = (
    p1: Point,
    p2: Point,
    color: string,
    width = 1.5,
    headMeters = 0.6,
    dashed = false,
  ) => {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-4) return

    const ux = dx / len
    const uy = dy / len
    const nx = -uy
    const ny = ux

    const sx1 = toSx(p1)
    const sy1 = toSy(p1)
    const sx2 = toSx(p2)
    const sy2 = toSy(p2)

    ctx.save()
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = Math.max(0.8, width * Math.sqrt(cam.scale) * 0.55)
    if (dashed) ctx.setLineDash([4, 3])

    ctx.beginPath()
    ctx.moveTo(sx1, sy1)
    ctx.lineTo(sx2, sy2)
    ctx.stroke()
    if (dashed) ctx.setLineDash([])

    // Tête de flèche fine et profilée
    const hLen = Math.min(headMeters, len * 0.30)
    const hWidth = hLen * 0.32
    const a1: Point = {
      x: p2.x - ux * hLen + nx * hWidth,
      y: p2.y - uy * hLen + ny * hWidth,
    }
    const a2: Point = {
      x: p2.x - ux * hLen - nx * hWidth,
      y: p2.y - uy * hLen - ny * hWidth,
    }

    ctx.beginPath()
    ctx.moveTo(sx2, sy2)
    ctx.lineTo(toSx(a1), toSy(a1))
    ctx.lineTo(toSx(a2), toSy(a2))
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  // Helper pour afficher un badge de mesure
  const drawVectorBadge = (
    sx: number,
    sy: number,
    text: string,
    color: string,
    bg = 'rgba(15, 23, 42, 0.90)',
    fontSizeOverride?: number,
  ) => {
    ctx.save()
    const fs = fontSizeOverride ?? fontSize
    ctx.font = `600 ${fs}px Archivo, system-ui, sans-serif`
    const tw = ctx.measureText(text).width
    const padX = 4.5
    const padY = 2.5
    const bh = fs + padY * 2
    ctx.fillStyle = bg
    ctx.fillRect(sx - tw / 2 - padX, sy - bh / 2, tw + padX * 2, bh)
    ctx.strokeStyle = color
    ctx.lineWidth = 0.8
    ctx.strokeRect(sx - tw / 2 - padX, sy - bh / 2, tw + padX * 2, bh)
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, sx, sy)
    ctx.restore()
  }

  const motionDir: Point = travelDirection === 1
    ? leadHeading
    : { x: -leadHeading.x, y: -leadHeading.y }

  const { acceleration: currentAccel, stoppingDistance: dStop } = telemetryKinematics(telemetry)

  // ─── 1 à 4 : Vecteurs physiques dynamiques (activables/désactivables) ───
  if (showVectors) {
    // 1. Ruban de distance d'arrêt de sécurité projetée (Stopping distance tape)
    // A real stopping distance runs to kilometres: the sampling step grows with it so that the
    // tape reaches its end within the number of steps sampleForwardTrack allows
    if (net && leadPos && speedMs > 0.5) {
      if (dStop > 0.8) {
        const tapeLength = Math.min(dStop, STOP_TAPE_MAX_LENGTH)
        const stopPts = sampleForwardTrack(net, leadPos, travelDirection, tapeLength, Math.max(1.0, tapeLength / STOP_TAPE_SAMPLES))
        if (stopPts.length >= 2) {
          ctx.save()
          // Ruban avertisseur projeté sur les rails
          ctx.beginPath()
          ctx.moveTo(toSx(stopPts[0]), toSy(stopPts[0]))
          for (let i = 1; i < stopPts.length; i++) {
            ctx.lineTo(toSx(stopPts[i]), toSy(stopPts[i]))
          }
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)'
          ctx.lineWidth = Math.max(1.5, 1.8 * Math.sqrt(cam.scale))
          ctx.setLineDash([4, 3])
          ctx.stroke()
          ctx.setLineDash([])

          // Filet lumineux central
          ctx.strokeStyle = '#fef08a'
          ctx.lineWidth = Math.max(0.8, 1.0 * Math.sqrt(cam.scale))
          ctx.stroke()

          // Ligne transversale d'arrêt au bout du ruban
          const lastP = stopPts[stopPts.length - 1]
          const prevP = stopPts[stopPts.length - 2]
          const tdx = lastP.x - prevP.x
          const tdy = lastP.y - prevP.y
          const tlen = Math.hypot(tdx, tdy) || 1
          const tNormX = -tdy / tlen
          const tNormY = tdx / tlen
          const barSpan = 1.0
          const b1: Point = { x: lastP.x + tNormX * barSpan, y: lastP.y + tNormY * barSpan }
          const b2: Point = { x: lastP.x - tNormX * barSpan, y: lastP.y - tNormY * barSpan }

          ctx.beginPath()
          ctx.moveTo(toSx(b1), toSy(b1))
          ctx.lineTo(toSx(b2), toSy(b2))
          ctx.strokeStyle = '#ef4444'
          ctx.lineWidth = Math.max(1.5, 2.0 * Math.sqrt(cam.scale))
          ctx.stroke()

          // Badge au point d'arrêt
          const stopBadgeText = `🛑 Distance d'arrêt : ${Number.isFinite(dStop) ? `${dStop.toFixed(1)} m` : '∞'}`
          drawVectorBadge(toSx(lastP), toSy(lastP) - 16, stopBadgeText, '#fca5a5', 'rgba(153, 27, 27, 0.92)', fontSize)
          ctx.restore()
        }
      }
    }

    // 2. Vecteur Vitesse Principal à la proue (Lead Velocity Vector V)
    const vArrowLen = Math.max(2.2, 1.6 + speedMs * 0.2)
    const vTip: Point = {
      x: leadNosePt.x + motionDir.x * vArrowLen,
      y: leadNosePt.y + motionDir.y * vArrowLen,
    }

    drawWorldArrow(leadNosePt, vTip, dynamicColor, 1.3, 0.55)

    const vBadgeText = speedMs > 0.05
      ? `V = ${speedKmh.toFixed(0)} km/h (${speedMs.toFixed(1)} m/s) · [${dynamicLabel}]`
      : `V = 0 km/h · [${dynamicLabel}]`
    const vMidPt: Point = {
      x: leadNosePt.x + motionDir.x * (vArrowLen * 0.5),
      y: leadNosePt.y + motionDir.y * (vArrowLen * 0.5),
    }
    drawVectorBadge(toSx(vMidPt), toSy(vMidPt) - 16, vBadgeText, dynamicColor, 'rgba(15, 23, 42, 0.92)', fontSize)

    // 3. Vecteur Accélération Longitudinal a
    if (Math.abs(currentAccel) > 0.05 && bogies.length > 0) {
      const aDir: Point = currentAccel >= 0 ? motionDir : { x: -motionDir.x, y: -motionDir.y }
      const aLen = Math.min(3.8, 1.2 + Math.abs(currentAccel) * 0.35)
      const leadCenter = bogies[0].center
      const aTip: Point = {
        x: leadCenter.x + aDir.x * aLen,
        y: leadCenter.y + aDir.y * aLen,
      }
      const aColor = currentAccel > 0 ? '#10b981' : '#f43f5e'
      drawWorldArrow(leadCenter, aTip, aColor, 1.1, 0.45)
      const aLabel = `a = ${currentAccel > 0 ? '+' : ''}${currentAccel.toFixed(1)} m/s²`
      drawVectorBadge(toSx(aTip), toSy(aTip) + 12, aLabel, aColor, 'rgba(15, 23, 42, 0.90)', fontSize)
    }

    // 4. Vecteurs d'accélération centrifuge ac = v²/R et courbures par bogie
    for (let bi = 0; bi < bogies.length; bi++) {
      const bogie = bogies[bi]
      const sx = toSx(bogie.center)
      const sy = toSy(bogie.center)
      const rOuter = Math.max(3.5, 4.5 * Math.sqrt(cam.scale))

      if (net && bogie.pos) {
        const curvature = getTrackCurvatureAt(net, bogie.pos)
        const radius = curvature.radius

        if (isFinite(radius) && radius > 0 && radius < 50000) {
          const ac = speedMs > 0 ? (speedMs * speedMs) / radius : 0
          const isCurving = curvature.side !== 'straight'

          if (ac > 0.05 && isCurving) {
            const acLen = Math.min(5.5, Math.max(1.2, ac * 1.0))
            const acTip: Point = {
              x: bogie.center.x + curvature.outwardNormal.x * acLen,
              y: bogie.center.y + curvature.outwardNormal.y * acLen,
            }

            // Seuils dynamiques UIC :
            // ac < 0.65 m/s² : confort optimal (vert)
            // 0.65 <= ac <= 1.20 m/s² : limite confort voyageur standard (ambre)
            // ac > 1.20 m/s² : contrainte centrifuge excessive (alerte rouge)
            const acColor = ac < 0.65 ? '#22c55e' : ac <= 1.2 ? '#f59e0b' : '#ef4444'
            drawWorldArrow(bogie.center, acTip, acColor, 1.1, 0.42)

            const acBadge = `ac = ${ac.toFixed(2)} m/s² (R = ${Math.round(radius)} m)`
            drawVectorBadge(toSx(acTip), toSy(acTip), acBadge, acColor, 'rgba(15, 23, 42, 0.92)', fontSize)
          } else {
            // Arrêt ou courbe douce : affichage du rayon sous le bogie
            const rBadge = `R = ${Math.round(radius)} m`
            drawVectorBadge(sx, sy + rOuter + 14, rBadge, '#38bdf8', 'rgba(15, 23, 42, 0.85)', fontSize * 0.9)
          }
        }
      }

      // Vecteur tangentiel vitesse locale du bogie (montre le braquage individuel)
      if (speedMs > 0.05) {
        const bTanDir = travelDirection === 1 ? bogie.tangent : { x: -bogie.tangent.x, y: -bogie.tangent.y }
        const bSpeedLen = Math.min(2.8, 1.0 + speedMs * 0.08)
        const bTip: Point = {
          x: bogie.center.x + bTanDir.x * bSpeedLen,
          y: bogie.center.y + bTanDir.y * bSpeedLen,
        }
        drawWorldArrow(bogie.center, bTip, dynamicColor, 0.85, 0.32)
      }
    }
  }

  // ─── 5. Faisceau de trajectoire anticipée (50m) et alerte heurtoir / fin de voie ───
  if (showLookahead && net && leadPos) {
    const lookaheadPts = sampleForwardTrack(net, leadPos, travelDirection, 50, 1.2)
    if (lookaheadPts.length >= 2) {
      let totalDist = 0
      for (let i = 1; i < lookaheadPts.length; i++) {
        totalDist += Math.hypot(lookaheadPts[i].x - lookaheadPts[i - 1].x, lookaheadPts[i].y - lookaheadPts[i - 1].y)
      }

      ctx.save()
      // Faisceau lumineux de trajectoire
      ctx.beginPath()
      ctx.moveTo(toSx(lookaheadPts[0]), toSy(lookaheadPts[0]))
      for (let i = 1; i < lookaheadPts.length; i++) {
        ctx.lineTo(toSx(lookaheadPts[i]), toSy(lookaheadPts[i]))
      }
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.35)'
      ctx.lineWidth = Math.max(1.8, 2.5 * Math.sqrt(cam.scale))
      ctx.stroke()

      ctx.strokeStyle = 'rgba(165, 243, 252, 0.85)'
      ctx.lineWidth = Math.max(0.8, 1.1 * Math.sqrt(cam.scale))
      ctx.setLineDash([4, 4])
      ctx.stroke()
      ctx.setLineDash([])

      // Repères métriques le long de la trajectoire (+10m, +20m, +30m, etc.)
      let accumDist = 0
      let nextTick = 10
      for (let i = 1; i < lookaheadPts.length; i++) {
        const segLen = Math.hypot(lookaheadPts[i].x - lookaheadPts[i - 1].x, lookaheadPts[i].y - lookaheadPts[i - 1].y)
        if (accumDist + segLen >= nextTick && nextTick <= 50) {
          const ratio = (nextTick - accumDist) / segLen
          const tickP: Point = {
            x: lookaheadPts[i - 1].x + (lookaheadPts[i].x - lookaheadPts[i - 1].x) * ratio,
            y: lookaheadPts[i - 1].y + (lookaheadPts[i].y - lookaheadPts[i - 1].y) * ratio,
          }
          drawVectorBadge(toSx(tickP), toSy(tickP) - 10, `+${nextTick}m`, '#38bdf8', 'rgba(15, 23, 42, 0.85)', fontSize * 0.85)
          nextTick += 10
        }
        accumDist += segLen
      }

      // Détection de fin de voie / heurtoir si la voie se termine avant 46m
      if (totalDist < 46.0) {
        const lastP = lookaheadPts[lookaheadPts.length - 1]
        const prevP = lookaheadPts[lookaheadPts.length - 2]
        const dx = lastP.x - prevP.x
        const dy = lastP.y - prevP.y
        const len = Math.hypot(dx, dy) || 1
        const nx = -dy / len
        const ny = dx / len
        const barSpan = 1.0
        const b1: Point = { x: lastP.x + nx * barSpan, y: lastP.y + ny * barSpan }
        const b2: Point = { x: lastP.x - nx * barSpan, y: lastP.y - ny * barSpan }

        // Heurtoir rouge
        ctx.beginPath()
        ctx.moveTo(toSx(b1), toSy(b1))
        ctx.lineTo(toSx(b2), toSy(b2))
        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = Math.max(1.8, 2.5 * Math.sqrt(cam.scale))
        ctx.stroke()

        const isCollisionRisk = speedMs > 0.5 && dStop >= totalDist
        const alertText = isCollisionRisk
          ? `🚨 COLLISION HEURTOIR D'ICI ${totalDist.toFixed(1)} m !`
          : `⚠️ Fin de voie / Heurtoir : ${totalDist.toFixed(1)} m`
        const alertBg = isCollisionRisk ? 'rgba(220, 38, 38, 0.95)' : 'rgba(180, 83, 9, 0.92)'
        const alertColor = isCollisionRisk ? '#ffffff' : '#fef08a'
        drawVectorBadge(toSx(lastP), toSy(lastP) - 18, alertText, alertColor, alertBg, fontSize)
      }
      ctx.restore()
    }
  }

  ctx.restore()
}

// ─────────────────── Driving route & next turnout ───────────────────

const ROUTE_STRAIGHT_COLOR = '#22d3ee'
const ROUTE_DIVERTED_COLOR = '#fbbf24'
const ROUTE_CLOSED_COLOR = '#ef4444'
const ROUTE_BADGE_BG = 'rgba(15, 23, 42, 0.92)'
/** The route is shown this many seconds of travel ahead, within these bounds (meters) */
const ROUTE_REACH_SECONDS = 6
const ROUTE_MIN_REACH = 50
const ROUTE_MAX_REACH = 400
/** Angle (degrees) between two neighbouring branches of the turnout pictogram */
const ROUTE_PICTO_SPREAD_DEG = 38

/**
 * Driving aid drawn ahead of the driven train: the route it will follow, and the turnout the
 * steering keys throw.
 * - The route is cyan, and amber past a facing turnout set to a diverging branch.
 * - A facing turnout gets a ring on its points and a pictogram of its branches, laid out from left
 *   to right as the driver meets them, with the routed branch lit and the others barred. The
 *   pictogram has a fixed screen size and spread, so it reads at any zoom and frog angle.
 * - A turnout met by a branch it is not set to ends the route: its ring is red and labelled.
 * `start` is the leading end of the train oriented along its travel direction (`trainRouteStart`).
 */
export function renderDrivingRoute(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  start: TrackPosition,
  speed: number,
  unit: Unit,
): void {
  const toSx = (p: Point) => (p.x - cam.x) * cam.scale + vw / 2
  const toSy = (p: Point) => (p.y - cam.y) * cam.scale + vh / 2

  const ahead = findJunctionAhead(net, start, 1)
  const diverted = ahead !== null && ahead.facing && ahead.activeBranch !== 'straight'
  const reach = Math.min(ROUTE_MAX_REACH, Math.max(ROUTE_MIN_REACH, Math.abs(speed) * ROUTE_REACH_SECONDS))
  const pts = sampleForwardTrack(net, start, 1, reach, Math.max(1, reach / 100))

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // ─── Route: split at the points when the turnout diverts it ───
  let splitIdx = pts.length - 1
  if (diverted) {
    let travelled = 0
    for (let i = 1; i < pts.length; i++) {
      travelled += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
      if (travelled >= ahead.distance - 1e-6) {
        splitIdx = i
        break
      }
    }
  }
  const strokeRoute = (from: number, to: number, color: string) => {
    if (to - from < 1) return
    ctx.beginPath()
    ctx.moveTo(toSx(pts[from]), toSy(pts[from]))
    for (let i = from + 1; i <= to; i++) ctx.lineTo(toSx(pts[i]), toSy(pts[i]))
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.25
    ctx.lineWidth = 7
    ctx.stroke()
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  strokeRoute(0, splitIdx, ROUTE_STRAIGHT_COLOR)
  strokeRoute(splitIdx, pts.length - 1, ROUTE_DIVERTED_COLOR)

  // ─── Turnout the steering keys throw ───
  const apex = ahead ? net.nodes.get(ahead.junction.nodeId) : undefined
  if (ahead && apex) {
    const ax = toSx(apex.pos)
    const ay = toSy(apex.pos)
    const color = !ahead.open ? ROUTE_CLOSED_COLOR : diverted ? ROUTE_DIVERTED_COLOR : ROUTE_STRAIGHT_COLOR
    const distanceLabel = formatUnitsDistance(ahead.distance, unit, unit === 'm' ? 0 : undefined)

    const drawLabel = (text: string, cx: number, cy: number) => {
      ctx.font = '600 11px Archivo, system-ui, sans-serif'
      const tw = ctx.measureText(text).width
      ctx.fillStyle = ROUTE_BADGE_BG
      ctx.fillRect(cx - tw / 2 - 5, cy - 8, tw + 10, 16)
      ctx.fillStyle = color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, cx, cy)
    }

    // Ring on the points
    ctx.beginPath()
    ctx.arc(ax, ay, 8, 0, Math.PI * 2)
    ctx.strokeStyle = ROUTE_BADGE_BG
    ctx.lineWidth = 5
    ctx.stroke()
    ctx.strokeStyle = color
    ctx.lineWidth = 2.5
    ctx.stroke()

    if (!ahead.facing) {
      if (!ahead.open) drawLabel(`Aiguille fermée · ${distanceLabel}`, ax, ay - 22)
    } else {
      const h = ahead.heading
      const right = { x: -h.y, y: h.x }
      // The pictogram sits beside the points, on the side that is up on screen
      const side = right.y < 0 ? 1 : -1
      const discR = 20
      const cx = ax + right.x * side * 46
      const cy = ay + right.y * side * 46

      ctx.beginPath()
      ctx.moveTo(ax + right.x * side * 8, ay + right.y * side * 8)
      ctx.lineTo(cx - right.x * side * discR, cy - right.y * side * discR)
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(cx, cy, discR, 0, Math.PI * 2)
      ctx.fillStyle = ROUTE_BADGE_BG
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.stroke()

      // Fork: stem from behind, then one stroke per branch, fanned out around the straight one
      const ox = cx - h.x * 8
      const oy = cy - h.y * 8
      const straightIdx = ahead.branches.indexOf('straight')
      const branchLen = 17
      const drawBranch = (index: number, active: boolean) => {
        const angle = ((index - straightIdx) * ROUTE_PICTO_SPREAD_DEG * Math.PI) / 180
        const dx = h.x * Math.cos(angle) + right.x * Math.sin(angle)
        const dy = h.y * Math.cos(angle) + right.y * Math.sin(angle)
        const ex = ox + dx * branchLen
        const ey = oy + dy * branchLen
        ctx.beginPath()
        ctx.moveTo(ox, oy)
        ctx.lineTo(ex, ey)
        ctx.strokeStyle = active ? color : '#64748b'
        ctx.lineWidth = active ? 3.5 : 2
        ctx.stroke()
        if (active) {
          // Arrow head
          ctx.beginPath()
          ctx.moveTo(ex + dx * 5, ey + dy * 5)
          ctx.lineTo(ex - dx * 3 - dy * 5, ey - dy * 3 + dx * 5)
          ctx.lineTo(ex - dx * 3 + dy * 5, ey - dy * 3 - dx * 5)
          ctx.closePath()
          ctx.fillStyle = color
          ctx.fill()
        } else {
          // Stop bar across a branch the points are not set to
          ctx.beginPath()
          ctx.moveTo(ex - dy * 4, ey + dx * 4)
          ctx.lineTo(ex + dy * 4, ey - dx * 4)
          ctx.strokeStyle = ROUTE_CLOSED_COLOR
          ctx.lineWidth = 2
          ctx.stroke()
        }
      }
      ctx.beginPath()
      ctx.moveTo(ox - h.x * 9, oy - h.y * 9)
      ctx.lineTo(ox, oy)
      ctx.strokeStyle = color
      ctx.lineWidth = 3.5
      ctx.stroke()
      ahead.branches.forEach((b, i) => { if (b !== ahead.activeBranch) drawBranch(i, false) })
      drawBranch(ahead.branches.indexOf(ahead.activeBranch), true)

      drawLabel(ahead.open ? distanceLabel : `Aiguille fermée · ${distanceLabel}`, cx, cy - discR - 11)
    }
  }

  ctx.restore()
}

// ─────────────────── TrainSet Fleet & Coupler Rendering ───────────────────

function drawTrainSetBogie(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  toSx: (p: Point) => number,
  toSy: (p: Point) => number,
  bogie: BogieFrame,
  isLeadBogie: boolean,
  isGhost = false,
): void {
  const halfL = 1.35
  const halfW = 0.90
  const beamW = 0.16

  const bl1 = { x: bogie.center.x + bogie.tangent.x * halfL + bogie.normal.x * (halfW - beamW), y: bogie.center.y + bogie.tangent.y * halfL + bogie.normal.y * (halfW - beamW) }
  const bl2 = { x: bogie.center.x + bogie.tangent.x * halfL + bogie.normal.x * halfW, y: bogie.center.y + bogie.tangent.y * halfL + bogie.normal.y * halfW }
  const bl3 = { x: bogie.center.x - bogie.tangent.x * halfL + bogie.normal.x * halfW, y: bogie.center.y - bogie.tangent.y * halfL + bogie.normal.y * halfW }
  const bl4 = { x: bogie.center.x - bogie.tangent.x * halfL + bogie.normal.x * (halfW - beamW), y: bogie.center.y - bogie.tangent.y * halfL + bogie.normal.y * (halfW - beamW) }
  ctx.beginPath()
  ctx.moveTo(toSx(bl1), toSy(bl1))
  ctx.lineTo(toSx(bl2), toSy(bl2))
  ctx.lineTo(toSx(bl3), toSy(bl3))
  ctx.lineTo(toSx(bl4), toSy(bl4))
  ctx.closePath()
  ctx.fillStyle = isGhost ? 'rgba(30, 41, 59, 0.4)' : '#1e293b'
  ctx.fill()
  ctx.strokeStyle = isGhost ? 'rgba(100, 116, 139, 0.5)' : '#475569'
  ctx.lineWidth = Math.max(0.8, 1.0 * Math.sqrt(cam.scale))
  ctx.stroke()

  const br1 = { x: bogie.center.x + bogie.tangent.x * halfL - bogie.normal.x * halfW, y: bogie.center.y + bogie.tangent.y * halfL - bogie.normal.y * halfW }
  const br2 = { x: bogie.center.x + bogie.tangent.x * halfL - bogie.normal.x * (halfW - beamW), y: bogie.center.y + bogie.tangent.y * halfL - bogie.normal.y * (halfW - beamW) }
  const br3 = { x: bogie.center.x - bogie.tangent.x * halfL - bogie.normal.x * (halfW - beamW), y: bogie.center.y - bogie.tangent.y * halfL - bogie.normal.y * (halfW - beamW) }
  const br4 = { x: bogie.center.x - bogie.tangent.x * halfL - bogie.normal.x * halfW, y: bogie.center.y - bogie.tangent.y * halfL - bogie.normal.y * halfW }
  ctx.beginPath()
  ctx.moveTo(toSx(br1), toSy(br1))
  ctx.lineTo(toSx(br2), toSy(br2))
  ctx.lineTo(toSx(br3), toSy(br3))
  ctx.lineTo(toSx(br4), toSy(br4))
  ctx.closePath()
  ctx.fillStyle = isGhost ? 'rgba(30, 41, 59, 0.4)' : '#1e293b'
  ctx.fill()
  ctx.strokeStyle = isGhost ? 'rgba(100, 116, 139, 0.5)' : '#475569'
  ctx.lineWidth = Math.max(0.8, 1.0 * Math.sqrt(cam.scale))
  ctx.stroke()

  const bmidW = 0.28
  const bm1 = { x: bogie.center.x + bogie.tangent.x * bmidW + bogie.normal.x * halfW, y: bogie.center.y + bogie.tangent.y * bmidW + bogie.normal.y * halfW }
  const bm2 = { x: bogie.center.x + bogie.tangent.x * bmidW - bogie.normal.x * halfW, y: bogie.center.y + bogie.tangent.y * bmidW - bogie.normal.y * halfW }
  const bm3 = { x: bogie.center.x - bogie.tangent.x * bmidW - bogie.normal.x * halfW, y: bogie.center.y - bogie.tangent.y * bmidW - bogie.normal.y * halfW }
  const bm4 = { x: bogie.center.x - bogie.tangent.x * bmidW + bogie.normal.x * halfW, y: bogie.center.y - bogie.tangent.y * bmidW + bogie.normal.y * halfW }
  ctx.beginPath()
  ctx.moveTo(toSx(bm1), toSy(bm1))
  ctx.lineTo(toSx(bm2), toSy(bm2))
  ctx.lineTo(toSx(bm3), toSy(bm3))
  ctx.lineTo(toSx(bm4), toSy(bm4))
  ctx.closePath()
  ctx.fillStyle = isGhost ? 'rgba(15, 23, 42, 0.5)' : '#0f172a'
  ctx.fill()
  ctx.strokeStyle = isGhost ? 'rgba(100, 116, 139, 0.5)' : '#475569'
  ctx.lineWidth = Math.max(0.8, 1.0 * Math.sqrt(cam.scale))
  ctx.stroke()

  const wheelHalfL = 0.38
  const wheelThickness = 0.07
  for (const axle of bogie.axles) {
    ctx.beginPath()
    ctx.moveTo(toSx(axle.left), toSy(axle.left))
    ctx.lineTo(toSx(axle.right), toSy(axle.right))
    ctx.strokeStyle = isGhost ? 'rgba(148, 163, 184, 0.5)' : '#94a3b8'
    ctx.lineWidth = Math.max(1.0, 1.6 * Math.sqrt(cam.scale))
    ctx.stroke()

    const drawWheel = (wc: Point) => {
      const w1 = { x: wc.x + bogie.tangent.x * wheelHalfL + bogie.normal.x * wheelThickness, y: wc.y + bogie.tangent.y * wheelHalfL + bogie.normal.y * wheelThickness }
      const w2 = { x: wc.x + bogie.tangent.x * wheelHalfL - bogie.normal.x * wheelThickness, y: wc.y + bogie.tangent.y * wheelHalfL - bogie.normal.y * wheelThickness }
      const w3 = { x: wc.x - bogie.tangent.x * wheelHalfL - bogie.normal.x * wheelThickness, y: wc.y - bogie.tangent.y * wheelHalfL - bogie.normal.y * wheelThickness }
      const w4 = { x: wc.x - bogie.tangent.x * wheelHalfL + bogie.normal.x * wheelThickness, y: wc.y - bogie.tangent.y * wheelHalfL + bogie.normal.y * wheelThickness }
      ctx.beginPath()
      ctx.moveTo(toSx(w1), toSy(w1))
      ctx.lineTo(toSx(w2), toSy(w2))
      ctx.lineTo(toSx(w3), toSy(w3))
      ctx.lineTo(toSx(w4), toSy(w4))
      ctx.closePath()
      ctx.fillStyle = isGhost ? 'rgba(51, 65, 85, 0.7)' : '#334155'
      ctx.fill()
      ctx.strokeStyle = isGhost ? 'rgba(203, 213, 225, 0.8)' : '#e2e8f0'
      ctx.lineWidth = Math.max(0.8, 1.0 * Math.sqrt(cam.scale))
      ctx.stroke()
    }

    drawWheel(axle.leftWheel)
    drawWheel(axle.rightWheel)

    const boxSize = 0.12
    const drawBox = (pt: Point) => {
      const b1 = { x: pt.x + bogie.tangent.x * boxSize + bogie.normal.x * boxSize, y: pt.y + bogie.tangent.y * boxSize + bogie.normal.y * boxSize }
      const b2 = { x: pt.x + bogie.tangent.x * boxSize - bogie.normal.x * boxSize, y: pt.y + bogie.tangent.y * boxSize - bogie.normal.y * boxSize }
      const b3 = { x: pt.x - bogie.tangent.x * boxSize - bogie.normal.x * boxSize, y: pt.y - bogie.tangent.y * boxSize - bogie.normal.y * boxSize }
      const b4 = { x: pt.x - bogie.tangent.x * boxSize + bogie.normal.x * boxSize, y: pt.y - bogie.tangent.y * boxSize + bogie.normal.y * boxSize }
      ctx.beginPath()
      ctx.moveTo(toSx(b1), toSy(b1))
      ctx.lineTo(toSx(b2), toSy(b2))
      ctx.lineTo(toSx(b3), toSy(b3))
      ctx.lineTo(toSx(b4), toSy(b4))
      ctx.closePath()
      ctx.fillStyle = isGhost ? 'rgba(71, 85, 105, 0.7)' : '#64748b'
      ctx.fill()
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 0.8
      ctx.stroke()
    }
    drawBox(axle.left)
    drawBox(axle.right)
  }

  const pivotOuterR = Math.max(3, Math.min(6, 3.5 * Math.sqrt(cam.scale)))
  const pivotInnerR = Math.max(1.5, Math.min(3, 1.8 * Math.sqrt(cam.scale)))
  ctx.beginPath()
  ctx.arc(toSx(bogie.center), toSy(bogie.center), pivotOuterR, 0, Math.PI * 2)
  ctx.fillStyle = '#334155'
  ctx.fill()
  ctx.strokeStyle = '#94a3b8'
  ctx.lineWidth = 1.2
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(toSx(bogie.center), toSy(bogie.center), pivotInnerR, 0, Math.PI * 2)
  ctx.fillStyle = isLeadBogie ? '#ef4444' : '#fb923c'
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1
  ctx.stroke()
}

function drawTrainSetAccordion(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  toSx: (p: Point) => number,
  toSy: (p: Point) => number,
  acc: TGVAccordion,
  isGhost = false,
): void {
  ctx.beginPath()
  ctx.moveTo(toSx(acc.frontFrame[0]), toSy(acc.frontFrame[0]))
  ctx.lineTo(toSx(acc.frontFrame[1]), toSy(acc.frontFrame[1]))
  ctx.lineTo(toSx(acc.rearFrame[1]), toSy(acc.rearFrame[1]))
  ctx.lineTo(toSx(acc.rearFrame[0]), toSy(acc.rearFrame[0]))
  ctx.closePath()
  ctx.fillStyle = isGhost ? 'rgba(30, 41, 59, 0.5)' : '#1e293b'
  ctx.fill()
  ctx.strokeStyle = '#0f172a'
  ctx.lineWidth = 1.5
  ctx.stroke()

  for (const fold of acc.folds) {
    ctx.beginPath()
    ctx.moveTo(toSx(fold.left), toSy(fold.left))
    ctx.lineTo(toSx(fold.right), toSy(fold.right))
    ctx.strokeStyle = isGhost ? 'rgba(100, 116, 139, 0.5)' : '#475569'
    ctx.lineWidth = Math.max(1, 1.5 * Math.sqrt(cam.scale))
    ctx.stroke()
  }
}

/** Body of a vehicle as a plain outline (no livery yet): the look of the debug x-ray view */
function drawTrainSetBody(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  toSx: (p: Point) => number,
  toSy: (p: Point) => number,
  polygon: Point[],
  isDebugSkeleton = false,
  telemetry?: TrainTelemetry,
): void {
  if (polygon.length === 0) return
  ctx.beginPath()
  ctx.moveTo(toSx(polygon[0]), toSy(polygon[0]))
  for (let pi = 1; pi < polygon.length; pi++) {
    ctx.lineTo(toSx(polygon[pi]), toSy(polygon[pi]))
  }
  ctx.closePath()

  if (isDebugSkeleton && telemetry?.debugOptions?.xray === false) {
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)'
    ctx.lineWidth = 0.75
    ctx.stroke()
    ctx.setLineDash([])
    return
  }
  ctx.fillStyle = 'rgba(14, 165, 233, 0.09)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.50)'
  ctx.lineWidth = Math.max(1, 1.2 * Math.sqrt(cam.scale))
  ctx.stroke()
}

/** Shade of the flank of a body: its side wall in shadow, apart from the sky blue of the roof and from the accent of the cant mark */
export const TRAIN_FLANK_FILL = 'rgba(71, 85, 105, 0.78)'
const TRAIN_FLANK_GHOST_FILL = 'rgba(71, 85, 105, 0.4)'
const TRAIN_FLANK_EDGE = 'rgba(100, 116, 139, 0.95)'

/** Flank of a leaning body, seen from above beside its roof: a side wall in shadow */
function drawTrainSetFlank(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  toSx: (p: Point) => number,
  toSy: (p: Point) => number,
  flank: Point[],
  isGhost = false,
): void {
  ctx.beginPath()
  ctx.moveTo(toSx(flank[0]), toSy(flank[0]))
  for (let pi = 1; pi < flank.length; pi++) ctx.lineTo(toSx(flank[pi]), toSy(flank[pi]))
  ctx.closePath()
  ctx.fillStyle = isGhost ? TRAIN_FLANK_GHOST_FILL : TRAIN_FLANK_FILL
  ctx.fill()
  ctx.strokeStyle = TRAIN_FLANK_EDGE
  ctx.lineWidth = Math.max(1, 1.2 * Math.sqrt(cam.scale))
  ctx.stroke()
}

/** Colours of the marker a train is in the schematic drawing: ink, accent when selected, red under the delete tool */
function trainMarkerStyle(ctx: CanvasRenderingContext2D, selected: boolean, deleting: boolean): { color: string; halo: string } {
  const color = deleting
    ? '#ef4444'
    : selected ? getCanvasStyle(ctx.canvas, '--accent', '#2563eb') : getCanvasStyle(ctx.canvas, '--ink', '#1a1a1a')
  return { color, halo: getCanvasStyle(ctx.canvas, '--paper', '#ffffff') }
}

/**
 * Render a complete TrainSet from the fleet on the canvas.
 * With `band`, only what stands on those track levels is drawn (one pass of the layered drawing,
 * see `renderNetworkWithTrains`); the debug overlay comes with the highest vehicle of the train.
 * A vehicle below ground (tunnel) is dimmed.
 */
export function renderTrainSet(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  net: Network,
  train: TrainSet,
  isSelected = false,
  isGhost = false,
  isDebugSkeleton = false,
  telemetry?: TrainTelemetry,
  selectedVehicleId?: string | null,
  deleteVehicleId?: string | null,
  band?: LevelBand,
  line?: LineSettings,
  /** Plain driving view: bodies only, never the bogies nor the gangways, however close the view */
  plain = false,
): void {
  // Nothing of the train in view: nothing to compute nor to draw. The debug overlay reaches far
  // beyond the train (stopping distance, vectors), so it is never skipped.
  const bounds = getViewportBounds(cam, vw, vh)
  if (!isDebugSkeleton && !vehiclesInBounds(net, train.vehicles, bounds)) return
  const inView = (points: Point[]): boolean => pointsInBounds(points, bounds)
  const tier = trackLod(cam.scale, GAUGE)
  const lod = plain && tier === 'detail' ? 'rails' : tier

  // The lean of the bodies only shows close up: further out it is under a pixel, and not asked for
  const visuals = getTrainSetVisuals(net, train, lod === 'detail' ? line : undefined)
  if (!visuals) return

  ctx.save()
  const toSx = (p: Point) => (p.x - cam.x) * cam.scale + vw / 2
  const toSy = (p: Point) => (p.y - cam.y) * cam.scale + vh / 2

  if (isGhost) {
    ctx.globalAlpha = 0.45
  }

  // Track level of each vehicle, and of the train as a whole (its highest vehicle)
  const levelById = new Map<string, number>()
  let topLevel = -Infinity
  for (const veh of train.vehicles) {
    const level = vehicleLevel(net, veh)
    levelById.set(veh.id, level)
    if (level > topLevel) topLevel = level
  }
  const levelOf = (vehicleId: string): number => levelById.get(vehicleId) ?? 0
  // A gangway hangs between two vehicles: it follows the higher one
  const gangwayLevel = (index: number): number =>
    visuals.accordions.length === train.vehicles.length - 1
      ? Math.max(levelOf(train.vehicles[index].id), levelOf(train.vehicles[index + 1].id))
      : topLevel
  /** Draw a part standing on `level`: skipped outside the band of this pass, dimmed in a tunnel */
  const atLevel = (level: number, draw: () => void): void => {
    if (!inLevelBand(level, band)) return
    if (level >= 0) {
      draw()
      return
    }
    ctx.save()
    ctx.globalAlpha = (isGhost ? 0.45 : 1) * TUNNEL_VEHICLE_ALPHA
    draw()
    ctx.restore()
  }

  // Schematic drawing: the whole train is a marker of constant size, along its bogies
  if (lod === 'schematic') {
    drawTrainMarker(
      ctx, toSx, toSy,
      visuals.bogies.map(b => ({ pos: b.center, level: b.pos ? trackPositionLevel(net, b.pos) : topLevel })),
      trainMarkerStyle(ctx, isSelected && !isGhost, !!deleteVehicleId && !isGhost),
      atLevel,
    )
  }

  /**
   * Highlights of the leaning vehicles, drawn once the bodies are: under them, as the highlight of
   * an upright vehicle is, they would be hidden by the flank
   */
  const overBodies: (() => void)[] = []
  const strokeOutline = (outline: Point[], color: string, width: number): void => {
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(toSx(outline[0]), toSy(outline[0]))
    for (let pi = 1; pi < outline.length; pi++) {
      ctx.lineTo(toSx(outline[pi]), toSy(outline[pi]))
    }
    ctx.closePath()
    ctx.stroke()
    ctx.restore()
  }

  // Selection outline for entire train
  if (isSelected && !isGhost && !isDebugSkeleton && lod !== 'schematic') {
    ctx.save()
    ctx.strokeStyle = '#38bdf8'
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    for (const v of visuals.vehicles) {
      if (inView(v.polygon) && inLevelBand(levelOf(v.id), band)) {
        // Round what is drawn: the roof and the flank of a leaning body, else the footprint
        const drawn = v.drawn
        if (drawn) {
          overBodies.push(() => strokeOutline(drawn, '#38bdf8', 1.5))
          continue
        }
        ctx.beginPath()
        ctx.moveTo(toSx(v.polygon[0]), toSy(v.polygon[0]))
        for (let pi = 1; pi < v.polygon.length; pi++) {
          ctx.lineTo(toSx(v.polygon[pi]), toSy(v.polygon[pi]))
        }
        ctx.closePath()
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  // Targeted vehicle highlight (when a specific car or loco in the train is selected)
  if (selectedVehicleId && !isGhost && lod !== 'schematic') {
    const selV = visuals.vehicles.find(v => v.id === selectedVehicleId)
    const drawn = selV?.drawn
    if (selV && drawn && inView(selV.polygon) && inLevelBand(levelOf(selV.id), band)) {
      overBodies.push(() => strokeOutline(drawn, '#f59e0b', 2.5))
    } else if (selV && inView(selV.polygon) && inLevelBand(levelOf(selV.id), band)) {
      ctx.save()
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 2.5
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(toSx(selV.polygon[0]), toSy(selV.polygon[0]))
      for (let pi = 1; pi < selV.polygon.length; pi++) {
        ctx.lineTo(toSx(selV.polygon[pi]), toSy(selV.polygon[pi]))
      }
      ctx.closePath()
      ctx.stroke()
      ctx.restore()
    }
  }

  // 1. Bogies: each physical bogie once (two trailers share one), the first is the lead bogie
  // A bogie is at the level of its own rail
  // Bogies and gangways are close-up detail: below it a vehicle is its plain silhouette
  for (let i = 0; i < visuals.bogies.length; i++) {
    const bogie = visuals.bogies[i]
    if (lod !== 'detail' || !inView(bogie.polygon)) continue
    atLevel(bogie.pos ? trackPositionLevel(net, bogie.pos) : topLevel, () => {
      drawTrainSetBogie(ctx, cam, toSx, toSy, bogie, i === 0, isGhost)
    })
  }

  // 2. Accordions
  for (let i = 0; i < visuals.accordions.length; i++) {
    const acc = visuals.accordions[i]
    if (lod !== 'detail' || !inView([...acc.frontFrame, ...acc.rearFrame])) continue
    atLevel(gangwayLevel(i), () => {
      drawTrainSetAccordion(ctx, cam, toSx, toSy, visuals.accordions[i], isGhost)
    })
  }

  // 3. Vehicles
  for (const v of visuals.vehicles) {
    if (lod === 'schematic' || !inView(v.polygon)) continue
    atLevel(levelOf(v.id), () => {
      // A leaning body: the flank it shows first, then its roof in place of the footprint
      // A body lying on its side shows nothing but its flank: its whole silhouette in that shade
      if (v.roof && v.lying) drawTrainSetFlank(ctx, cam, toSx, toSy, v.roof, isGhost)
      else if (v.roof && v.flank && v.flank.length > 0) drawTrainSetFlank(ctx, cam, toSx, toSy, v.flank, isGhost)
      if (!v.lying) drawTrainSetBody(ctx, cam, toSx, toSy, v.roof ?? v.polygon, isDebugSkeleton, telemetry)
    })
  }

  // The whole train first, the picked vehicle over it: the order they have under upright bodies
  for (const draw of overBodies) draw()

  // 3.5 Delete mode hover highlight (contour rouge vibrant + badge Supprimer)
  if (deleteVehicleId && !isGhost && lod !== 'schematic') {
    const delV = visuals.vehicles.find(v => v.id === deleteVehicleId)
    if (delV && inView(delV.polygon) && inLevelBand(levelOf(delV.id), band)) {
      ctx.save()
      ctx.shadowColor = 'rgba(239, 68, 68, 0.85)'
      ctx.shadowBlur = 10
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 3
      ctx.lineJoin = 'round'
      ctx.fillStyle = 'rgba(239, 68, 68, 0.25)'
      const outline = delV.drawn ?? delV.polygon
      ctx.beginPath()
      ctx.moveTo(toSx(outline[0]), toSy(outline[0]))
      for (let pi = 1; pi < outline.length; pi++) {
        ctx.lineTo(toSx(outline[pi]), toSy(outline[pi]))
      }
      ctx.closePath()
      ctx.fill()
      ctx.stroke()

      // Floating delete badge above vehicle center
      const avgX = delV.polygon.reduce((acc, p) => acc + p.x, 0) / delV.polygon.length
      const avgY = delV.polygon.reduce((acc, p) => acc + p.y, 0) / delV.polygon.length
      const badgeSx = toSx({ x: avgX, y: avgY })
      const badgeSy = toSy({ x: avgX, y: avgY }) - 24

      ctx.shadowBlur = 6
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
      ctx.font = '600 11px Archivo, system-ui, sans-serif'
      const label = '✕ Supprimer'
      const lw = ctx.measureText(label).width
      const padX = 7
      const padY = 4

      ctx.fillStyle = '#ef4444'
      ctx.beginPath()
      ctx.roundRect(badgeSx - lw / 2 - padX, badgeSy - 9 - padY, lw + padX * 2, 18 + padY * 2, 5)
      ctx.fill()

      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, badgeSx, badgeSy)

      ctx.restore()
    }
  }

  // 4. Debug skeleton
  if (isDebugSkeleton && inLevelBand(topLevel, band)) {
    ctx.save()
    const fontSize = Math.max(8.5, Math.min(10.5, 9.5 * Math.sqrt(cam.scale)))
    ctx.font = `600 ${fontSize}px Archivo, system-ui, sans-serif`

    // Distance between consecutive bogies along the rake: the pivots of a vehicle, or the spacing
    // of a joint between two vehicles that each have their own bogie
    for (let bi = 0; bi < visuals.bogies.length - 1; bi++) {
      const bA = visuals.bogies[bi].center
      const bB = visuals.bogies[bi + 1].center
      const dist = Math.hypot(bA.x - bB.x, bA.y - bB.y)

      ctx.beginPath()
      ctx.setLineDash([2, 3])
      ctx.moveTo(toSx(bA), toSy(bA))
      ctx.lineTo(toSx(bB), toSy(bB))
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)'
      ctx.lineWidth = 0.8
      ctx.stroke()
      ctx.setLineDash([])

      const midX = (toSx(bA) + toSx(bB)) / 2
      const midY = (toSy(bA) + toSy(bB)) / 2
      const label = `${dist.toFixed(2)} m`
      const pad = 2.5
      const tw = ctx.measureText(label).width
      ctx.fillStyle = 'rgba(15, 23, 42, 0.8)'
      ctx.fillRect(midX - tw / 2 - pad, midY - 6 - pad, tw + pad * 2, 12 + pad)
      ctx.fillStyle = '#38bdf8'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, midX, midY)
    }

    for (let bi = 0; bi < visuals.bogies.length; bi++) {
      const bogie = visuals.bogies[bi]
      const sx = toSx(bogie.center)
      const sy = toSy(bogie.center)
      const rOuter = Math.max(3.5, 4.5 * Math.sqrt(cam.scale))
      ctx.beginPath()
      ctx.arc(sx, sy, rOuter, 0, Math.PI * 2)
      ctx.fillStyle = '#0284c7'
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ctx.restore()

    // 5. Vecteurs dynamiques ferroviaires
    const leadNosePt = visuals.vehicles.length > 0 && visuals.vehicles[0].polygon.length > 0
      ? visuals.vehicles[0].polygon[0]
      : (visuals.bogies.length > 0 ? visuals.bogies[0].center : { x: 0, y: 0 })
    const leadHeading = visuals.bogies.length > 0 ? visuals.bogies[0].tangent : { x: 1, y: 0 }
    const leadPos = train.vehicles.length > 0
      ? (train.direction === 1 ? train.vehicles[0].front : train.vehicles[0].rear)
      : undefined

    renderTrainDynamicVectors(
      ctx,
      cam,
      toSx,
      toSy,
      net,
      visuals.bogies,
      leadNosePt,
      leadHeading,
      train.direction,
      telemetry ?? trainSetTelemetry(net, train),
      leadPos,
    )
  }

  ctx.restore()
}

/**
 * Render coupler endpoints and internal joints across the layout in coupling mode.
 */
export function renderCouplerPoints(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  couplerPoints: CouplerPoint[],
  hoveredPoint: CouplerPoint | null,
): void {
  if (couplerPoints.length === 0) return

  ctx.save()
  const toSx = (p: Point) => (p.x - cam.x) * cam.scale + vw / 2
  const toSy = (p: Point) => (p.y - cam.y) * cam.scale + vh / 2

  // 1. Draw dashed proximity links between nearby free couplers
  const freePoints = couplerPoints.filter(cp => !cp.coupled)
  for (let i = 0; i < freePoints.length; i++) {
    for (let j = i + 1; j < freePoints.length; j++) {
      const pA = freePoints[i]
      const pB = freePoints[j]
      if (pA.trainId === pB.trainId) continue
      const dist = Math.hypot(pA.pos.x - pB.pos.x, pA.pos.y - pB.pos.y)
      if (dist <= MAX_COUPLE_DISTANCE) {
        ctx.beginPath()
        ctx.setLineDash([4, 4])
        ctx.moveTo(toSx(pA.pos), toSy(pA.pos))
        ctx.lineTo(toSx(pB.pos), toSy(pB.pos))
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
  }

  // 2. Draw each coupler point badge
  for (const cp of couplerPoints) {
    const sx = toSx(cp.pos)
    const sy = toSy(cp.pos)
    const isHovered = hoveredPoint !== null &&
      hoveredPoint.trainId === cp.trainId &&
      hoveredPoint.vehicleIndex === cp.vehicleIndex &&
      hoveredPoint.end === cp.end

    if (cp.coupled) {
      // Internal articulation joint: click to decouple
      const r = isHovered ? 8 : 6
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fillStyle = isHovered ? '#ea580c' : '#f97316'
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Small dash inside
      ctx.beginPath()
      ctx.moveTo(sx - r * 0.45, sy)
      ctx.lineTo(sx + r * 0.45, sy)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.5
      ctx.stroke()
    } else {
      // Free coupler end: click to couple
      const r = isHovered ? 9 : 7
      if (isHovered) {
        ctx.beginPath()
        ctx.arc(sx, sy, r + 4, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(56, 189, 248, 0.3)'
        ctx.fill()
      }

      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fillStyle = isHovered ? '#0284c7' : '#0ea5e9'
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.stroke()

      // Inner white pin
      ctx.beginPath()
      ctx.arc(sx, sy, r * 0.35, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
    }

    if (isHovered) {
      const label = cp.coupled ? '✂ Découpler' : '🔗 Coupler'
      ctx.font = '600 11px system-ui, sans-serif'
      const metrics = ctx.measureText(label)
      const tw = metrics.width + 12
      const th = 18
      const tx = sx - tw / 2
      const ty = sy - 24

      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(tx, ty, tw, th, 4)
      } else {
        ctx.rect(tx, ty, tw, th)
      }
      ctx.fill()
      ctx.strokeStyle = cp.coupled ? '#f97316' : '#38bdf8'
      ctx.lineWidth = 1
      ctx.stroke()

      ctx.fillStyle = '#f8fafc'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, sx, ty + th / 2)
    }
  }

  ctx.restore()
}

/**
 * Render a magnetic coupler snap indicator when placing a vehicle near an existing train's coupler.
 */
export function renderCouplerSnapIndicator(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  pos: Point
): void {
  const sx = (pos.x - cam.x) * cam.scale + vw / 2
  const sy = (pos.y - cam.y) * cam.scale + vh / 2

  ctx.save()

  // Outer glowing pulse ring
  ctx.beginPath()
  ctx.arc(sx, sy, 14, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(16, 185, 129, 0.22)'
  ctx.fill()
  ctx.strokeStyle = '#10b981'
  ctx.lineWidth = 2.2
  ctx.setLineDash([4, 3])
  ctx.stroke()
  ctx.setLineDash([])

  // Inner solid core
  ctx.beginPath()
  ctx.arc(sx, sy, 5.5, 0, Math.PI * 2)
  ctx.fillStyle = '#10b981'
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Floating label badge
  const label = '🔗 Atteler au convoi'
  ctx.font = 'bold 11px system-ui, sans-serif'
  const metrics = ctx.measureText(label)
  const tw = metrics.width + 12
  const th = 20
  const tx = sx - tw / 2
  const ty = sy - 28

  ctx.fillStyle = 'rgba(15, 23, 42, 0.92)'
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(tx, ty, tw, th, 4)
  } else {
    ctx.rect(tx, ty, tw, th)
  }
  ctx.fill()
  ctx.strokeStyle = '#10b981'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.fillStyle = '#34d399'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, sx, ty + th / 2)

  ctx.restore()
}

