// ─────────────────── Surface and underground ───────────────────
//
// The canvas looks either at the surface or below ground (`EditorStore.viewDepth`). What is on
// the side looked at is drawn as it is; what is on the other side is faded to `OTHER_SIDE_ALPHA`
// — the tunnels from the surface, the surface (bridges included) from below ground. A rail below
// ground seen from the surface is also dashed. The rule is asked once per level pass, never per
// rail. The SVG export keeps its own, fixed, look (`exportSvg.ts`).

/** Which side of the ground the canvas looks at */
export type ViewDepth = 'surface' | 'underground'

/** Opacity of what is on the other side of the ground than the one looked at */
export const OTHER_SIDE_ALPHA = 0.15

/** True when a drawing level is below ground (a tunnel) */
export function isUnderground(level: number): boolean {
  return level < 0
}

/** Opacity of what stands on `level`, seen from `depth` */
export function levelAlpha(level: number, depth: ViewDepth = 'surface'): number {
  return isUnderground(level) === (depth === 'underground') ? 1 : OTHER_SIDE_ALPHA
}

/** True when the rails of `level` are dashed, seen from `depth`: a tunnel seen from the surface */
export function levelDashed(level: number, depth: ViewDepth = 'surface'): boolean {
  return isUnderground(level) && depth === 'surface'
}
