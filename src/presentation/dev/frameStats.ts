import { LOD_LINE_BELOW_PX, LOD_RAILS_BELOW_PX, LOD_SCHEMATIC_BELOW_PX } from '@infrastructure/render/lod'

// The figures of the frame bench (`frameBench.ts`), kept apart from the page so that they are tested.

/** The value under which `share` of the sorted samples fall (nearest rank); NaN without samples */
export function percentile(samples: readonly number[], share: number): number {
  if (samples.length === 0) return NaN
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(share * sorted.length)))
  return sorted[rank - 1]
}

export interface FrameSummary {
  frames: number
  /** Time spent in one paint of the canvas, ms */
  drawP50: number
  drawP95: number
  /** Time between two paints while the view moves without a pause, ms: what the eye sees */
  gapP50: number
  gapP95: number
}

/** `paints` are the times (ms) at which each paint ended, `draws` how long each took */
export function summarise(draws: readonly number[], paints: readonly number[]): FrameSummary {
  const gaps = paints.slice(1).map((t, i) => t - paints[i])
  const round = (ms: number) => Math.round(ms * 100) / 100
  return {
    frames: draws.length,
    drawP50: round(percentile(draws, 0.5)),
    drawP95: round(percentile(draws, 0.95)),
    gapP50: round(percentile(gaps, 0.5)),
    gapP95: round(percentile(gaps, 0.95)),
  }
}

/**
 * Scales (px/m) that put the track at the middle of a level of detail of `lod.ts`, for a track of
 * `gauge` metres: the views the bench measures, whatever the scale of the project.
 */
export function levelScales(gauge: number): { line: number; detail: number } {
  return {
    line: Math.sqrt(LOD_SCHEMATIC_BELOW_PX * LOD_LINE_BELOW_PX) / gauge,
    detail: (LOD_RAILS_BELOW_PX * 1.6) / gauge,
  }
}

/** `steps` scales from `from` to `to`, evenly spaced on a log scale: a zoom at a steady pace */
export function zoomSweep(from: number, to: number, steps: number): number[] {
  if (steps < 2) return [to]
  const ratio = Math.log(to / from) / (steps - 1)
  return Array.from({ length: steps }, (_, i) => from * Math.exp(ratio * i))
}
