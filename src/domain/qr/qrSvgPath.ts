/** Light modules a reader needs around a QR code */
export const QR_QUIET_ZONE = 4

export interface QrSvgPath {
  /** Side of the drawing in modules, quiet zone included */
  size: number
  /** SVG path of the dark modules, one unit per module: one rectangle per horizontal run */
  d: string
}

/** Turns the modules of `encodeQr` into one SVG path, shifted by the quiet zone it does not include */
export function qrSvgPath(matrix: readonly (readonly boolean[])[], margin = QR_QUIET_ZONE): QrSvgPath {
  let d = ''
  for (let y = 0; y < matrix.length; y++) {
    const row = matrix[y]
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue
      const start = x
      while (x + 1 < row.length && row[x + 1]) x++
      const width = x - start + 1
      d += `M${start + margin} ${y + margin}h${width}v1h${-width}z`
    }
  }
  return { size: matrix.length + 2 * margin, d }
}
