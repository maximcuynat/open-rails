import type { Network, NodeId, SegmentId } from '@domain/models/types'
import type { LineAssignment, LineId, LineInfo } from './lines'

// A line is hundreds of kilometres long: too much to load for a train that is on forty of them,
// and too much to keep once it has left. Each line is cut into pieces on a grid of the map — a
// rail goes whole to the cell its middle is in, so nothing is cut and a border always falls on a
// node, as between two lines. A piece is to the application what a line was: one file, loaded
// when a train nears it and dropped when every train is far (the index says which line it is a
// piece of). Crumbs — the few rails a line leaves in the corner of a cell — go to a neighbour.

export interface PieceOptions {
  /** Side of a cell of the grid, m */
  cellM: number
  /** A piece of fewer rails than this is merged into a neighbouring piece of its line */
  minRails: number
}

export const DEFAULT_PIECES: PieceOptions = { cellM: 40_000, minRails: 120 }

/**
 * The assignment of the rails to pieces of their lines: the same shape as the assignment to
 * lines, each piece named after its line and saying which (`partOf`). A line that fits one cell
 * is its own single piece, under its own id.
 */
export function cutIntoPieces(net: Network, assignment: LineAssignment, options: PieceOptions = DEFAULT_PIECES): LineAssignment {
  const { cellM, minRails } = options
  // 1. The rails of each line by cell
  const groupsOfLine = new Map<LineId, Map<string, { cx: number; cy: number; rails: SegmentId[] }>>()
  for (const [segId, line] of assignment.lineOf) {
    const seg = net.segments.get(segId)
    const a = seg && net.nodes.get(seg.from)?.pos
    const b = seg && net.nodes.get(seg.to)?.pos
    if (!a || !b) continue
    const cx = Math.floor((a.x + b.x) / 2 / cellM)
    const cy = Math.floor((a.y + b.y) / 2 / cellM)
    let groups = groupsOfLine.get(line)
    if (!groups) groupsOfLine.set(line, (groups = new Map()))
    const key = `${cx},${cy}`
    const group = groups.get(key)
    if (group) group.rails.push(segId)
    else groups.set(key, { cx, cy, rails: [segId] })
  }

  const lineOf = new Map<SegmentId, LineId>()
  const lines = new Map<LineId, LineInfo>()
  for (const [line, info] of assignment.lines) {
    const groups = [...(groupsOfLine.get(line)?.values() ?? [])]
    if (groups.length === 0) continue

    // 2. Crumbs go to the neighbour they share most nodes with, the smallest first
    const nodesOf = (rails: readonly SegmentId[]): Set<NodeId> => {
      const nodes = new Set<NodeId>()
      for (const segId of rails) {
        const seg = net.segments.get(segId)!
        nodes.add(seg.from).add(seg.to)
      }
      return nodes
    }
    for (;;) {
      groups.sort((p, q) => p.rails.length - q.rails.length || p.cx - q.cx || p.cy - q.cy)
      let merged = false
      for (let i = 0; i < groups.length && groups[i].rails.length < minRails; i++) {
        const mine = nodesOf(groups[i].rails)
        let best = -1
        let bestShared = 0
        for (let j = 0; j < groups.length; j++) {
          if (j === i) continue
          let shared = 0
          for (const node of nodesOf(groups[j].rails)) if (mine.has(node)) shared++
          if (shared > bestShared) {
            best = j
            bestShared = shared
          }
        }
        if (best < 0) continue
        groups[best].rails.push(...groups[i].rails)
        groups.splice(i, 1)
        merged = true
        break
      }
      if (!merged) break
    }

    // 3. Named in the order of the map, north to south then west to east (y grows southwards)
    groups.sort((p, q) => p.cy - q.cy || p.cx - q.cx)
    groups.forEach((group, n) => {
      const id = groups.length === 1 ? line : `${line}-${String(n + 1).padStart(2, '0')}`
      lines.set(id, { ...info, id, partOf: line })
      for (const segId of group.rails) lineOf.set(segId, id)
    })
  }
  return { lineOf, lines, unlistedHighSpeedWays: assignment.unlistedHighSpeedWays }
}
