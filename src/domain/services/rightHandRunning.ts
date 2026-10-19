import type { Point } from '../models/types'

// ─────────────────── Right-hand running in Alsace-Moselle ───────────────────
//
// French trains keep to the left on a double line, except on the classic lines of Moselle,
// Bas-Rhin and Haut-Rhin (departments 57, 67, 68): laid while they were German (1871–1918), they
// still run on the right. The high-speed lines that cross them (LGV Est européenne) were built
// since and keep to the left like the rest of the country.
//
// The import says which rails are there by their place, not by a tag: OpenStreetMap has no tag
// for the side trains keep to, and the data of a dataset or of an import is projected in a frame
// (local or Lambert-93) whose coordinates are got back through its projection. The outline below
// is coarse, about two kilometres off the borders of the three departments: the points where
// the side changes (flyovers at Lunéville, Montreux-Vieux, Audun-le-Roman…) lie on the main lines
// near those borders, and a double line rarely runs along a border.

/** Outline of the three departments, (lat, lon), clockwise from Audun-le-Tiche */
export const ALSACE_MOSELLE: readonly (readonly [number, number])[] = [
  [49.5, 5.89],
  [49.47, 6.37],
  [49.37, 6.55],
  [49.22, 6.85],
  [49.15, 7.03],
  [49.12, 7.1],
  [49.16, 7.4],
  [49.06, 7.65],
  [49.05, 7.95],
  [48.97, 8.23],
  // The Rhine
  [48.7, 7.95],
  [48.58, 7.8],
  [48.3, 7.7],
  [48.05, 7.58],
  [47.8, 7.53],
  [47.6, 7.58],
  // Switzerland
  [47.5, 7.45],
  [47.42, 7.25],
  [47.5, 7.08],
  // Territoire de Belfort, then the crest of the Vosges
  [47.68, 6.95],
  [47.82, 6.85],
  [48.0, 7.02],
  [48.15, 7.1],
  [48.3, 7.18],
  [48.52, 7.08],
  // Meurthe-et-Moselle
  [48.62, 6.95],
  [48.78, 6.55],
  [48.92, 6.25],
  [49.0, 6.05],
  [49.1, 5.98],
  [49.25, 6.02],
  [49.4, 5.98],
]

/** True when a place is inside a polygon of points (ray casting) */
function insidePolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** True when the place (lat, lon) is in Alsace-Moselle */
export function inAlsaceMoselle(lat: number, lon: number): boolean {
  return insidePolygon({ x: lon, y: lat }, ALSACE_MOSELLE.map(([la, lo]) => ({ x: lo, y: la })))
}

/**
 * Whether a place of the frame of `project` is where trains keep to the right: the outline is
 * projected once, the places are tested in the frame itself.
 */
export function rightHandArea(project: (lat: number, lon: number) => Point): (p: Point) => boolean {
  const outline = ALSACE_MOSELLE.map(([lat, lon]) => project(lat, lon))
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const q of outline) {
    minX = Math.min(minX, q.x)
    minY = Math.min(minY, q.y)
    maxX = Math.max(maxX, q.x)
    maxY = Math.max(maxY, q.y)
  }
  return (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY && insidePolygon(p, outline)
}
