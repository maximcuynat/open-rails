/**
 * Level of detail of what is drawn on top of the tracks: section badges, direction arrows and
 * diagnostic markers. Pure helpers, no canvas: `renderNetwork` decides what to draw with them.
 */
import type { TrackLod } from './lod'

/**
 * The thresholds below were tuned as camera scales at 1:1 (px per metre). They are kept as the
 * distance between the two rails on screen at that scale, so that they follow `gaugeOnScreen`
 * like the tiers do. The product is written out so the boundary falls on the very same scale.
 */
const STANDARD_GAUGE = 1.435

/** From this many pixels between the rails every section gets a badge (scale 1.0 at 1:1) */
export const BADGES_ALL_FROM_PX = 1.0 * STANDARD_GAUGE
/** From this many pixels a badge is the full one: type, name, direction and length (scale 3.0 at 1:1) */
export const BADGE_FULL_FROM_PX = 3.0 * STANDARD_GAUGE
/**
 * Short of the detailed drawing, only what is long on screen is named — the main tracks first, as
 * on a map: a section or a speed zone shorter than this many pixels keeps its label for a closer look
 */
export const LABEL_MIN_LENGTH_FAR_PX = 240
/** In the detailed drawing a compact badge still needs this many pixels of track */
export const BADGE_MIN_LENGTH_PX = 45
/** In the detailed drawing the boards of a speed zone need this many pixels of zone */
export const SPEED_BOARDS_MIN_LENGTH_PX = 40

/**
 * A badge stands in a crowd when more than `BADGE_CROWD_LIMIT` other badges would be written
 * within this reach of it (px): about two badges on either side, five tracks up and down at the closest
 * zoom that draws every badge
 */
export const BADGE_CROWD_REACH_X_PX = 240
export const BADGE_CROWD_REACH_Y_PX = 100
export const BADGE_CROWD_LIMIT = 2

/**
 * Shortest section, in pixels on screen, that gets a badge at this zoom (the selected section and
 * the ones the user named are not held to it)
 */
export function sectionBadgeMinLength(lod: TrackLod, gaugePx: number): number {
  if (lod !== 'detail') return LABEL_MIN_LENGTH_FAR_PX
  return gaugePx >= BADGE_FULL_FROM_PX ? 0 : BADGE_MIN_LENGTH_PX
}

/** From this many pixels a diagnostic marker carries its text label (scale 0.9 at 1:1) */
export const DIAGNOSTIC_LABEL_FROM_PX = 0.9 * STANDARD_GAUGE
/** Diagnostic markers closer than this on screen are merged into one in the schematic drawing */
export const DIAGNOSTIC_CLUSTER_RADIUS_PX = 28

/**
 * Whether a section is a candidate for a badge at this zoom, before the checks on its length on
 * screen. Below `BADGES_ALL_FROM_PX` — which covers the whole schematic tier — only the sections
 * the user cares about: the selected one and the ones he named.
 */
export function sectionBadgeWanted(
  gaugePx: number,
  section: { selected: boolean; renamed: boolean },
): boolean {
  return gaugePx >= BADGES_ALL_FROM_PX || section.selected || section.renamed
}

/**
 * Rails of a one-way section that carry a direction arrow.
 * - detail, rails: every rail
 * - line: the middle rail only, one arrow per section
 * - schematic: none
 */
export function sectionArrowSegments<T>(lod: TrackLod, segmentIds: readonly T[]): readonly T[] {
  if (lod === 'detail' || lod === 'rails') return segmentIds
  if (lod === 'schematic' || segmentIds.length === 0) return []
  return [segmentIds[Math.floor(segmentIds.length / 2)]]
}

/** Up to this many plain joints in view, each is drawn at its full size */
export const PLAIN_JOINTS_FULL_SIZE_UP_TO = 150
/** However many there are, the dot of a joint keeps this share of its size */
export const PLAIN_JOINT_MIN_SCALE = 0.5

/**
 * Size of the dot of a plain joint, as a share of the full one, when `count` of them are in view.
 * Beyond `PLAIN_JOINTS_FULL_SIZE_UP_TO` the dots shrink so that together they cover no more of the
 * screen than that many would: a yard of several hundred joints still reads as tracks. The dot
 * stays where it is and can be grabbed all the same.
 */
export function plainJointScale(count: number): number {
  if (count <= PLAIN_JOINTS_FULL_SIZE_UP_TO) return 1
  return Math.max(PLAIN_JOINT_MIN_SCALE, Math.sqrt(PLAIN_JOINTS_FULL_SIZE_UP_TO / count))
}

/** Screen rectangle of a badge (top-left corner) and what ranks it against the others */
export interface BadgeBox {
  x: number
  y: number
  w: number
  h: number
  selected: boolean
  renamed: boolean
  /** Length of the section: the longest wins among equals */
  length: number
}

function badgeRank(b: BadgeBox): number {
  return b.selected ? 0 : b.renamed ? 1 : 2
}

function boxesOverlap(a: BadgeBox, b: BadgeBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * Badges that can be drawn without one covering another. They are taken by priority — selected,
 * then renamed, then longest — and a badge that would overlap one already kept is dropped.
 * The result keeps the order of the input, so the drawing order does not depend on the ranking.
 */
export function placeBadges<T extends BadgeBox>(candidates: readonly T[]): T[] {
  const byPriority = candidates
    .map((box, index) => ({ box, index }))
    .sort((p, q) =>
      badgeRank(p.box) - badgeRank(q.box) || q.box.length - p.box.length || p.index - q.index)
  const kept: { box: T; index: number }[] = []
  for (const cand of byPriority) {
    if (!kept.some((k) => boxesOverlap(k.box, cand.box))) kept.push(cand)
  }
  return kept.sort((p, q) => p.index - q.index).map((k) => k.box)
}

/**
 * Whether the two boards of a speed zone (« Z 30 », « R 30 ») are drawn, for a zone `lengthPx`
 * long on screen. Text is read up close: in the detailed drawing every zone long enough to carry
 * two boards has them; in the rails drawing only the long ones; further out the band alone shows
 * where a limit applies. The zone the user is working on (picked, or about to be removed) always
 * keeps its boards.
 */
export function speedZoneBoardsShown(lod: TrackLod, zone: { highlighted: boolean; lengthPx: number }): boolean {
  if (zone.highlighted) return true
  if (lod === 'detail') return zone.lengthPx >= SPEED_BOARDS_MIN_LENGTH_PX
  return lod === 'rails' && zone.lengthPx >= LABEL_MIN_LENGTH_FAR_PX
}

/**
 * Whether the band of a speed zone is drawn. In the schematic the network is a diagram a few
 * pixels wide, where a band would be wider than the track it lies under: only the zone the user
 * is working on keeps it.
 */
export function speedZoneBandShown(lod: TrackLod, zone: { highlighted: boolean }): boolean {
  return lod !== 'schematic' || zone.highlighted
}

/**
 * Whether the band of a zone in a crowd — one of the limited tracks of a yard — is drawn. Only
 * for the tool that works on zones (`working`): on a yard the bands of every track would hide the
 * rails. It then lies between its own rails, so it needs the tiers that draw the two rails; once
 * a track is a single line the band would be hidden by it, or merge with the one of the next track.
 */
export function speedZoneCrowdBandShown(lod: TrackLod, working: boolean): boolean {
  return working && (lod === 'detail' || lod === 'rails')
}

/** Whether diagnostic markers that pile up on screen are merged: as soon as a track is a single line */
export function diagnosticsClustered(lod: TrackLod): boolean {
  return lod === 'line' || lod === 'schematic'
}

/** Closer than this many half-widths of their diamond, two markers of the signalling report cover each other */
export const REPORT_MARKER_OVERLAP = 1.6

/**
 * Distance (px) under which two markers of the signalling report are merged into one that shows
 * how many it stands for. The signals of a yard stand in a row, one per track, and so do their
 * markers: the ones that would cover each other are merged at every zoom, and all the ones that
 * pile up once a track is a single line, like the other diagnostics. `markerRadius`: half the
 * width of the diamond.
 */
export function reportClusterRadius(lod: TrackLod, markerRadius: number): number {
  return diagnosticsClustered(lod) ? DIAGNOSTIC_CLUSTER_RADIUS_PX : REPORT_MARKER_OVERLAP * markerRadius
}

export type MarkerSeverity = 'warning' | 'error'

export interface ScreenMarker {
  x: number
  y: number
  severity: MarkerSeverity
  /** Text shown above the marker, when there is room for one */
  label?: string
}

export interface MarkerCluster extends ScreenMarker {
  /** Number of markers merged into this one */
  count: number
}

/**
 * Merges the markers that fall within `radius` pixels of each other. A marker joins the first
 * cluster whose centre is close enough, and the centre moves to the mean of its members; the
 * worst severity of the members is the one of the cluster. It keeps a label only when all its
 * members say the same thing.
 */
export function clusterMarkers(markers: readonly ScreenMarker[], radius: number): MarkerCluster[] {
  const clusters: MarkerCluster[] = []
  for (const m of markers) {
    const c = clusters.find((k) => Math.hypot(k.x - m.x, k.y - m.y) <= radius)
    if (!c) {
      clusters.push({ x: m.x, y: m.y, severity: m.severity, label: m.label, count: 1 })
      continue
    }
    if (c.label !== m.label) c.label = undefined
    c.x = (c.x * c.count + m.x) / (c.count + 1)
    c.y = (c.y * c.count + m.y) / (c.count + 1)
    c.count += 1
    if (m.severity === 'error') c.severity = 'error'
  }
  return clusters
}
