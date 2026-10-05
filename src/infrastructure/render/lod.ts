/**
 * Level of detail of the drawing. It follows the distance between the two rails **on screen**
 * (gauge × camera scale, in pixels), not the raw camera scale: the same thresholds hold at 1:1
 * and at every model scale. All the thresholds of the zoomed-out drawing live here.
 */
export type TrackLod = 'detail' | 'line' | 'schematic'

/** Below this many pixels between the rails they read as one stroke: a rail is drawn as a single line */
export const LOD_LINE_BELOW_PX = 3
/** Below this many pixels between the rails the network is a diagram: one polyline per section */
export const LOD_SCHEMATIC_BELOW_PX = 0.5

/** Pixels between the two rails as drawn. `gauge` is the gauge the rails are drawn with, in metres. */
export function gaugeOnScreen(scale: number, gauge: number): number {
  return gauge * scale
}

export function trackLod(scale: number, gauge: number): TrackLod {
  const px = gaugeOnScreen(scale, gauge)
  if (px >= LOD_LINE_BELOW_PX) return 'detail'
  if (px >= LOD_SCHEMATIC_BELOW_PX) return 'line'
  return 'schematic'
}

/**
 * Whether the marker of a node is drawn — and, since only what is seen can be grabbed, whether
 * the node can be picked. `degree` is the number of rails at the node.
 * - detail: every node
 * - line: the selected ones and the ends of track (where a track is carried on)
 * - schematic: the selected ones only
 */
export function nodeMarkerShown(lod: TrackLod, node: { selected: boolean; degree: number }): boolean {
  if (lod === 'detail' || node.selected) return true
  return lod === 'line' && node.degree === 1
}
