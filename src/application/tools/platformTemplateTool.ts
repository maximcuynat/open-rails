import type { EditorStore, PlatformTemplate } from '@application/state/editorStore'
import type { Network, Point } from '@domain/models/types'
import { networkCheckToken } from '@domain/models/networkWatch'
import { islandReach } from '@domain/services/platformLayout'
import {
  applyIslandLoop,
  applySidePlatforms,
  computeIslandLoopPreview,
  computeSidePlatformsPreview,
  type IslandLoopPreview,
  type LaidStationTemplate,
  type SidePlatformsPreview,
  type StationTemplateRefused,
} from '@domain/geometry/constructionTemplates'
import { formatDistance } from '@domain/models/units'
import type { PlatformTemplateDrawing } from '@infrastructure/render/platformPreviewRender'
import { isPlatformToolActive, platformToolDims } from './platformTool'

// ─────────────────── Station templates of the platform tool ───────────────────
//
// With a template picked in the bar of the platform tool (`store.platformTemplate`), the tool lays
// a whole small station in one click: the preview follows the cursor, the click lays what it shows
// (`domain/geometry/constructionTemplates.ts`) as one undo step.

/** Reach of the cursor around the track, pixels */
const REACH_PX = 20

export const PLATFORM_TEMPLATE_LABEL: Record<PlatformTemplate, string> = {
  islandLoop: 'Évitement à quai central',
  sidePlatforms: 'Gare à deux quais latéraux',
}

export const PLATFORM_TEMPLATE_OFF_TRACK = 'Gabarit : survolez une voie'

export type PlatformTemplatePreview =
  | { template: 'islandLoop'; preview: IslandLoopPreview }
  | { template: 'sidePlatforms'; preview: SidePlatformsPreview }

let last: { net: Network; key: string; preview: PlatformTemplatePreview | null } | null = null

/** What the template in hand would lay with the cursor where it is; null without a template or off the track */
export function resolvePlatformTemplate(store: EditorStore, cursor: Point = store.cursorWorld): PlatformTemplatePreview | null {
  const template = store.platformTemplate
  if (!template || !isPlatformToolActive(store)) return null
  const token = networkCheckToken(store.network)
  const key = [token, template, store.camera.scale, store.gauge, cursor.x, cursor.y].join('|')
  if (token !== undefined && last && last.net === store.network && last.key === key) return last.preview
  const options = { reach: Math.max(REACH_PX / store.camera.scale, islandReach(platformToolDims(store))), gauge: store.gauge }
  let preview: PlatformTemplatePreview | null = null
  if (template === 'islandLoop') {
    const loop = computeIslandLoopPreview(store.network, cursor, options)
    if (loop) preview = { template, preview: loop }
  } else {
    const sides = computeSidePlatformsPreview(store.network, cursor, options)
    if (sides) preview = { template, preview: sides }
  }
  last = { net: store.network, key, preview }
  return preview
}

export type PlatformTemplateClick = 'refused' | 'off-track' | 'invalid' | 'placed'

/** A click with a template in hand: lays what the preview shows, track, platforms and station, as one undo step */
export function clickPlatformTemplate(store: EditorStore, world: Point): { result: PlatformTemplateClick; laid?: LaidStationTemplate } {
  if (!store.platformTemplate || !isPlatformToolActive(store)) return { result: 'refused' }
  const resolved = resolvePlatformTemplate(store, world)
  if (!resolved) return { result: 'off-track' }
  if (!resolved.preview.valid) return { result: 'invalid' }
  const laid = resolved.template === 'islandLoop'
    ? applyIslandLoop(store.network, resolved.preview, { gauge: store.gauge, tolerance: store.getPlacementThresholds().reconcileTolerance })
    : applySidePlatforms(store.network, resolved.preview, store.gauge)
  if (!laid) {
    // The loop may have been laid without its island: the step is recorded all the same
    if (resolved.template === 'islandLoop') store.markDirty()
    return { result: 'invalid' }
  }
  store.markDirty()
  return { result: 'placed', laid }
}

// ─────────────────── Wording ───────────────────

/** Why the click would lay nothing */
export function platformTemplateRefusalText(refused: StationTemplateRefused, store: EditorStore): string {
  switch (refused.refusal) {
    case 'not-straight':
      return 'Il faut une voie droite'
    case 'too-short':
      return `Voie droite trop courte (il faut ${formatDistance(refused.needed ?? 0, store.unit)})`
    case 'no-track-across':
      return 'Pas de seconde voie à côté (double voie ou évitement)'
    case 'not-alongside':
      return 'Les deux voies ne courent pas côte à côte ici'
  }
}

/** « Évitement à quai central · 220.00 m · entraxe 9.40 m », or why not */
export function platformTemplateText(resolved: PlatformTemplatePreview, store: EditorStore): string {
  const { preview } = resolved
  if (!preview.valid) return platformTemplateRefusalText(preview, store)
  return `${PLATFORM_TEMPLATE_LABEL[resolved.template]} · ${formatDistance(preview.platformLength, store.unit)} · entraxe ${formatDistance(preview.spacing, store.unit)}`
}

// ─────────────────── Preview ───────────────────

/** What the canvas draws for the template in hand, or null */
export function platformTemplateDrawing(store: EditorStore): PlatformTemplateDrawing | null {
  const resolved = resolvePlatformTemplate(store)
  if (!resolved) return null
  const { preview } = resolved
  return {
    at: preview.at,
    rails: preview.rails,
    outlines: preview.outlines,
    refused: !preview.valid,
    label: platformTemplateText(resolved, store),
    labelAt: store.cursorWorld,
  }
}
