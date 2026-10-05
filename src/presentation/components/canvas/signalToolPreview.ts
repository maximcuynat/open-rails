import type { Camera } from '@infrastructure/render/camera'
import type { EditorStore, SignalAim } from '@application/state/editorStore'
import type { Network, Point, Signal, TrackSpan } from '@domain/models/types'
import { positionOnSegment, tangentOnSegment } from '@domain/models/locomotive'
import { checkSignalPlacement, signalsRevision } from '@domain/models/signals'
import { defaultSignalStatus } from '@domain/models/signalling'
import {
  blockColor,
  blockColorOf,
  drawBlockStripe,
  drawSignal,
  previewSignalBlocks,
  signalGlyph,
  signalSizes,
} from '@infrastructure/render/signalRender'
import { SIGNAL_REFUSAL_SHORT } from '../common/signalActions'

/**
 * What a signal tool shows before the button comes up. At most three things at once: the signal
 * under the cursor, the arrow of the direction of travel it speaks to, and the colour of the two
 * blocks it would make. Struck through, with the reason, where it cannot stand. While the button
 * is held and dragged along the track: the signals of the row.
 */

/** Opacity of the blocks a signal would make, over the plain blocks of the display */
const PREVIEW_BLOCK_ALPHA = 0.9
const PREVIEW_ALPHA = 0.85

interface PreviewBlocks {
  ahead: readonly TrackSpan[]
  behind: { color: string; spans: readonly TrackSpan[] }[]
}

let lastBlocks: { net: Network; revision: number; segId: string; t: number; forward: boolean; blocks: PreviewBlocks } | null = null

/** `previewSignalBlocks`, kept while the aim and the signals stay the same: asked at every frame */
function blocksFor(net: Network, aim: SignalAim): PreviewBlocks {
  const revision = signalsRevision(net)
  const last = lastBlocks
  if (
    last && last.net === net && last.revision === revision &&
    last.segId === aim.place.segId && last.t === aim.place.t && last.forward === aim.forward
  ) {
    return last.blocks
  }
  const preview = previewSignalBlocks(net, aim.place, aim.forward)
  const blocks: PreviewBlocks = {
    ahead: preview.ahead,
    behind: preview.behind.map((block) => ({ color: blockColorOf(net, block.signalId), spans: block.spans })),
  }
  lastBlocks = { net, revision, segId: aim.place.segId, t: aim.place.t, forward: aim.forward, blocks }
  return blocks
}

/** The signal the tool in hand would lay, as a throwaway record for the drawing */
function ghost(store: EditorStore, forward: boolean): Signal | null {
  const spec = store.signalToolSpec
  if (!spec) return null
  return { id: '', segId: '', t: 0, forward, role: spec.role, ...(spec.cabMarker ? { cabMarker: true } : {}) }
}

/** What the signal tool in hand would do, for the drawing and the tests: null without such a tool */
export function resolveSignalTool(store: EditorStore):
  | { kind: 'single'; aim: SignalAim }
  | { kind: 'row'; places: { place: { segId: string; t: number }; forward: boolean; refused: boolean }[] }
  | null {
  if (!store.signalPlacementMode) return null
  const start = store.signalRowStart
  if (start && store.signalRowEnd) {
    const options = { gauge: store.gauge }
    return {
      kind: 'row',
      places: store.signalRowPreview.map(({ place, forward }) => ({
        place,
        forward,
        refused:
          checkSignalPlacement(store.network, place, forward, options) !== null ||
          (store.signalToolBothWays && checkSignalPlacement(store.network, place, !forward, options) !== null),
      })),
    }
  }
  const aim = start ?? store.signalAimAt(store.cursorWorld)
  return aim ? { kind: 'single', aim } : null
}

export function renderSignalToolPreview(ctx: CanvasRenderingContext2D, cam: Camera, vw: number, vh: number, store: EditorStore): void {
  const tool = resolveSignalTool(store)
  if (!tool) return
  const net = store.network
  const level = store.signallingLevel
  const sizes = signalSizes(cam.scale, store.gauge)
  const toScreen = (p: Point): Point => ({ x: (p.x - cam.x) * cam.scale + vw / 2, y: (p.y - cam.y) * cam.scale + vh / 2 })

  /** One ghost signal at a place of the track, for one direction of travel */
  const draw = (place: { segId: string; t: number }, forward: boolean, arrow: boolean, crossed: boolean): Point | null => {
    const pos = positionOnSegment(net, place.segId, place.t)
    const tangent = tangentOnSegment(net, place.segId, place.t)
    const signal = ghost(store, forward)
    if (!pos || !tangent || !signal) return null
    const at = toScreen(pos)
    const heading = forward ? tangent : { x: -tangent.x, y: -tangent.y }
    const glyph = signalGlyph(signal, defaultSignalStatus(signal).state, level)
    drawSignal(ctx, at, heading, glyph, sizes, { alpha: PREVIEW_ALPHA, arrow, crossed })
    return at
  }

  if (tool.kind === 'row') {
    for (const { place, forward, refused } of tool.places) {
      draw(place, forward, true, refused)
      if (store.signalToolBothWays) draw(place, !forward, false, refused)
    }
    return
  }

  const { aim } = tool
  if (!aim.refusal) {
    // The two blocks the signal would make: the one it closes keeps its colour, the one it opens takes the next
    const blocks = blocksFor(net, aim)
    for (const block of blocks.behind) drawBlockStripe(ctx, cam, vw, vh, net, block.spans, block.color, store.gauge, PREVIEW_BLOCK_ALPHA)
    drawBlockStripe(ctx, cam, vw, vh, net, blocks.ahead, blockColor(net.signals.size), store.gauge, PREVIEW_BLOCK_ALPHA)
  }
  const at = draw(aim.place, aim.forward, true, aim.refusal !== null)
  if (store.signalToolBothWays) draw(aim.place, !aim.forward, false, aim.refusal !== null)

  if (at && aim.refusal) {
    // The only text near the cursor: why the click would be refused
    const text = SIGNAL_REFUSAL_SHORT[aim.refusal]
    ctx.save()
    ctx.font = '600 11px Archivo, system-ui, sans-serif'
    const width = ctx.measureText(text).width
    ctx.fillStyle = 'rgba(220, 38, 38, 0.92)'
    ctx.beginPath()
    ctx.roundRect(at.x - width / 2 - 6, at.y - sizes.offset - 40, width + 12, 18, 4)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, at.x, at.y - sizes.offset - 30)
    ctx.restore()
  }
}
