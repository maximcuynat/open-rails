/** Kato Unitrack HO standard curve radii in model mm.
 *  Ordered from tightest to widest.
 *  All Kato curves are 22.5° segments (except 2-290 at 10°).
 *  4 pieces = quarter circle, 16 pieces = full circle. */
export const CURVE_RADII: number[] = [
  430,  // 2-260
  490,  // 2-270
  550,  // 2-210
  610,  // 2-220
  670,  // 2-230
  730,  // 2-240
  790,  // 2-250
  867,  // 2-290 (10° segments)
  Infinity, // straight
]

/** Standard Kato Unitrack HO straight lengths in mm. */
export const STRAIGHT_LENGTHS: number[] = [
  60,   // 2-105
  94,   // 2-111
  109,  // 2-170 (with buffer)
  114,  // 2-120
  123,  // 2-140
  149,  // 2-193
  174,  // 2-130
  227,  // 2-160
  246,  // 2-150 / 2-151 (feeder)
  369,  // 2-180
]

/** Standard curve segment angles in degrees. */
export const CURVE_ANGLES: number[] = [22.5, 10]

export interface CurveProfile {
  radius: number
  label: string
}

export const CURVE_PROFILES: CurveProfile[] = CURVE_RADII.map((r) => ({
  radius: r,
  label: r === Infinity ? 'Straight' : `R${r}`,
}))

/** Pick the best curve radius for a given chord length and sagitta.
 *  Sagitta = perpendicular distance from chord midpoint to curve apex.
 *  For a circular arc: R = (h² + (L/2)²) / (2h) where h = sagitta, L = chord. */
export function radiusFromSagitta(chord: number, sagitta: number): number {
  if (sagitta === 0 || chord === 0) return Infinity
  const half = chord / 2
  return (sagitta * sagitta + half * half) / (2 * sagitta)
}

/** Snap a raw radius to the closest predefined profile. */
export function snapRadius(rawRadius: number): number {
  if (!isFinite(rawRadius)) return Infinity
  const largest = CURVE_RADII[CURVE_RADII.length - 2] // last finite (2000)
  if (rawRadius > largest * 1.5) return Infinity
  let best = CURVE_RADII[0]
  let bestDiff = Math.abs(rawRadius - best)
  for (const r of CURVE_RADII) {
    if (r === Infinity) continue
    const diff = Math.abs(rawRadius - r)
    if (diff < bestDiff) {
      bestDiff = diff
      best = r
    }
  }
  return best
}

/** Compute the via control point for a quadratic Bezier that approximates
 *  a circular arc with given start, end, and radius.
 *  The via is placed perpendicular to the chord at the midpoint,
 *  offset by the sagitta. */
export function arcToVia(
  start: { x: number; y: number },
  end: { x: number; y: number },
  radius: number,
  side: 1 | -1,
): { x: number; y: number } {
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const chord = Math.hypot(dx, dy)
  if (chord === 0) return mid

  if (radius === Infinity) {
    // Straight: via = midpoint
    return mid
  }

  // Sagitta for a circular arc: h = R - sqrt(R² - (L/2)²)
  const half = chord / 2
  if (half >= radius) {
    // Chord too long for this radius — clamp to maximum sagitta
    return {
      x: mid.x + (-dy / chord) * half * side,
      y: mid.y + (dx / chord) * half * side,
    }
  }

  const sagitta = radius - Math.sqrt(radius * radius - half * half)

  // Perpendicular to chord (normalized), offset by sagitta * side
  const nx = -dy / chord
  const ny = dx / chord

  return {
    x: mid.x + nx * sagitta * side,
    y: mid.y + ny * sagitta * side,
  }
}
