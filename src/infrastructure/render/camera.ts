export interface Camera {
  /** World coordinates at the center of the viewport. */
  x: number
  y: number
  /** Pixels per world unit. */
  scale: number
}

export function createCamera(x = 0, y = 0, scale = 1): Camera {
  return { x, y, scale }
}

export function clampScale(scale: number): number {
  return Math.min(64, Math.max(0.02, scale))
}

/** World coordinate span visible across the viewport width. */
export function viewSpan(cam: Camera, viewportWidth: number): number {
  return viewportWidth / cam.scale
}

/** Convert screen pixel coordinates to world coordinates. */
export function screenToWorld(
  cam: Camera,
  px: number,
  py: number,
  vw: number,
  vh: number,
): { x: number; y: number } {
  return {
    x: cam.x + (px - vw / 2) / cam.scale,
    y: cam.y + (py - vh / 2) / cam.scale,
  }
}
