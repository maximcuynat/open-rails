import { hitNode } from '@domain/models/network'
import type { Network, NodeId, Point, Selection } from '@domain/models/types'
import { nodeMarkerShown, trackLod } from '@infrastructure/render/lod'
import { GAUGE } from '@infrastructure/render/renderer'

/**
 * Node under the cursor for the select tool: only a node whose marker is drawn at this zoom can
 * be grabbed (`nodeMarkerShown`, the very rule the drawing follows), so a click on a hidden node
 * goes to the track under it. A hidden node does not mask a shown one further away within reach.
 * The construction tools do not go through here: they snap onto every node at every zoom.
 */
export function hitShownNode(
  net: Network,
  selection: Selection,
  pos: Point,
  maxDist: number,
  scale: number,
): NodeId | null {
  const lod = trackLod(scale, GAUGE)
  if (lod === 'detail') return hitNode(net, pos, maxDist)
  return hitNode(net, pos, maxDist, (node) =>
    nodeMarkerShown(lod, {
      selected: selection.nodes.has(node.id),
      degree: net.adjacency.get(node.id)?.length ?? 0,
    }),
  )
}
