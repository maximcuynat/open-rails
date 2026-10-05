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
 * - detail: every rail
 * - line: the middle rail only, one arrow per section
 * - schematic: none
 */
export function sectionArrowSegments<T>(lod: TrackLod, segmentIds: readonly T[]): readonly T[] {
  if (lod === 'detail') return segmentIds
  if (lod === 'schematic' || segmentIds.length === 0) return []
  return [segmentIds[Math.floor(segmentIds.length / 2)]]
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

export type MarkerSeverity = 'warning' | 'error'

export interface ScreenMarker {
  x: number
  y: number
  severity: MarkerSeverity
}

export interface MarkerCluster extends ScreenMarker {
  /** Number of markers merged into this one */
  count: number
}

/**
 * Merges the markers that fall within `radius` pixels of each other. A marker joins the first
 * cluster whose centre is close enough, and the centre moves to the mean of its members; the
 * worst severity of the members is the one of the cluster.
 */
export function clusterMarkers(markers: readonly ScreenMarker[], radius: number): MarkerCluster[] {
  const clusters: MarkerCluster[] = []
  for (const m of markers) {
    const c = clusters.find((k) => Math.hypot(k.x - m.x, k.y - m.y) <= radius)
    if (!c) {
      clusters.push({ x: m.x, y: m.y, severity: m.severity, count: 1 })
      continue
    }
    c.x = (c.x * c.count + m.x) / (c.count + 1)
    c.y = (c.y * c.count + m.y) / (c.count + 1)
    c.count += 1
    if (m.severity === 'error') c.severity = 'error'
  }
  return clusters
}
