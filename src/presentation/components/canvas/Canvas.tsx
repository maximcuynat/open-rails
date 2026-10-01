import { useCallback, useEffect, useRef, useState } from 'react'
import { clampScale, screenToWorld, type Camera } from '@infrastructure/render/camera'
import {
  renderGrid,
  renderBaseboard,
  renderNetwork,
  renderScaleBar,
  renderDetailedCurveRails,
  renderDetailedRailLines,
  renderLocomotive,
  pickSpacing,
  SIMPLIFY_THRESHOLD,
  GAUGE,
} from '@infrastructure/render/renderer'
import {
  addNode,
  addSegment,
  addCurveSegment,
  hitNode,
  hitSegment,
  snapToGrid,
  getStepPointsAlongSegment,
} from '@domain/models/network'
import type { Point, Network, RailNode } from '@domain/models/types'
import { curveLength, bezierPoint, computeParallelCurve } from '@domain/geometry/curve'
import {
  getTangentForPlacement,
  getTrackTangentAt,
  computeTurnoutIntersectionLock,
  computeReverseFreeNodeLock,
} from '@domain/geometry/tangent'
import {
  snapStraightLength,
  computeStraightPiece,
  computeCurvePiece,
  computeFreeformCurve,
  computeReverseFreeformCurve,
} from '@domain/profiles/profiles'
import {
  splitSegment,
  findJunctionAtNode,
  toggleJunction,
} from '@domain/models/junction'
import { reconcileNetworkIntersections } from '@domain/geometry/reconcile'
import { computeTrackSections, findSectionBySegment } from '@domain/models/sections'
import {
  computeFreeformParallelTurnout,
  applyFreeformParallelTurnout,
  performTrackCut,
} from '@domain/geometry/constructionTemplates'
import { formatDistance, formatRadius, formatAngle } from '@domain/models/units'
import {
  renderStraightDimension,
  renderCurveDimension,
  renderParallelSpacingDimension,
} from './dimensionOverlay'
import {
  hitTestGizmo,
  constrainGizmoDrag,
  renderTranslationGizmo,
  getGizmoAnchor,
} from './gizmo'
import type { EditorStore } from '@application/state/editorStore'


/** Find the nearest node within screen pixel tolerance, capped to at most 0.80m real-world distance. */
function findNearestNode(net: Network, worldPos: Point, maxScreenPx: number, cam: Camera): RailNode | null {
  // Cap snap radius to 0.80m in world space (half UIC track gauge) so distant nodes never grab the cursor
  const maxDistWorld = Math.min(0.80, maxScreenPx / cam.scale)
  let best: RailNode | null = null
  let bestD = maxDistWorld
  for (const node of net.nodes.values()) {
    const d = Math.hypot(worldPos.x - node.pos.x, worldPos.y - node.pos.y)
    if (d < bestD) {
      bestD = d
      best = node
    }
  }
  return best
}

/** Snap a direction vector to standard angles (0°, 15°, 30°, 45°, 90°...). */
function snapDirection(dir: Point, stepDeg = 15, tolDeg = 6): Point {
  const angleRad = Math.atan2(dir.y, dir.x)
  let angleDeg = (angleRad * 180) / Math.PI
  if (angleDeg < 0) angleDeg += 360
  const nearest = Math.round(angleDeg / stepDeg) * stepDeg
  const diff = Math.abs(angleDeg - nearest)
  if (diff <= tolDeg || Math.abs(diff - 360) <= tolDeg) {
    const rad = (nearest * Math.PI) / 180
    return { x: Math.cos(rad), y: Math.sin(rad) }
  }
  return dir
}

/** Render a snap indicator at a world point — a crosshair or magnetic lock ring. */
function renderSnapIndicator(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  pos: Point,
  isNodeSnap: boolean,
): void {
  const accent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
  const sx = (pos.x - cam.x) * cam.scale + vw / 2
  const sy = (pos.y - cam.y) * cam.scale + vh / 2

  ctx.save()
  if (isNodeSnap) {
    // Magnetic lock onto existing track node
    ctx.strokeStyle = '#10b981' // emerald green
    ctx.fillStyle = '#10b981'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(sx, sy, 10, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 0.3
    ctx.beginPath()
    ctx.arc(sx, sy, 5, 0, Math.PI * 2)
    ctx.fill()
  } else {
    // Grid snap crosshair
    ctx.strokeStyle = accent
    ctx.fillStyle = accent
    ctx.lineWidth = 1.5
    ctx.globalAlpha = 0.8
    const r = 7
    ctx.beginPath()
    ctx.moveTo(sx - r, sy)
    ctx.lineTo(sx + r, sy)
    ctx.moveTo(sx, sy - r)
    ctx.lineTo(sx, sy + r)
    ctx.stroke()

    ctx.globalAlpha = 0.3
    ctx.beginPath()
    ctx.arc(sx, sy, 5, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

/** Determine which side of the tangent the cursor is on.
 *  Returns -1 (left / Gauche) or 1 (right / Droite) based on 2D cross product in screen coordinates (Y down). */
function computeSide(tangent: Point, start: Point, cursor: Point): 1 | -1 {
  const dx = cursor.x - start.x
  const dy = cursor.y - start.y
  // Cross product in screen coordinates (+X right, +Y down):
  // tangent.x * dy - tangent.y * dx < 0 means cursor is to the LEFT (side = -1)
  // tangent.x * dy - tangent.y * dx >= 0 means cursor is to the RIGHT (side = 1)
  const cross = tangent.x * dy - tangent.y * dx
  return cross < 0 ? -1 : 1
}

/** Render a straight rail preview to the candidate end. */
function renderPlacePreview(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  start: Point,
  snappedEnd: Point,
  labelText: string,
  isClosedToNode = false,
): void {
  const accent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
  const railColor = getComputedStyle(ctx.canvas).getPropertyValue('--rail').trim() || '#526071'
  const paper = getComputedStyle(ctx.canvas).getPropertyValue('--paper').trim() || '#fff'
  const w2sX = (wx: number) => (wx - cam.x) * cam.scale + vw / 2
  const w2sY = (wy: number) => (wy - cam.y) * cam.scale + vh / 2

  ctx.save()

  // Start node marker
  ctx.fillStyle = accent
  ctx.globalAlpha = 0.6
  ctx.beginPath()
  ctx.arc(w2sX(start.x), w2sY(start.y), 6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = paper
  ctx.beginPath()
  ctx.arc(w2sX(start.x), w2sY(start.y), 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // Tangent sightline guide (Axe directeur projeté non intrusif)
  const previewDirX = snappedEnd.x - start.x
  const previewDirY = snappedEnd.y - start.y
  const previewLen = Math.hypot(previewDirX, previewDirY)
  if (previewLen > 1) {
    const uX = previewDirX / previewLen
    const uY = previewDirY / previewLen
    ctx.save()
    ctx.strokeStyle = accent
    ctx.globalAlpha = 0.2
    ctx.lineWidth = 1
    ctx.setLineDash([3, 5])
    ctx.beginPath()
    // Project sightline forward beyond snapped end
    const sightLen = Math.max(150, 400 / cam.scale)
    ctx.moveTo(w2sX(snappedEnd.x), w2sY(snappedEnd.y))
    ctx.lineTo(w2sX(snappedEnd.x + uX * sightLen), w2sY(snappedEnd.y + uY * sightLen))
    ctx.stroke()
    ctx.restore()
  }

  // Rail preview to snapped end
  if (cam.scale < SIMPLIFY_THRESHOLD) {
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.setLineDash([8, 4])
    ctx.beginPath()
    ctx.moveTo(w2sX(start.x), w2sY(start.y))
    ctx.lineTo(w2sX(snappedEnd.x), w2sY(snappedEnd.y))
    ctx.stroke()
    ctx.setLineDash([])
  } else {
    ctx.globalAlpha = 0.85
    renderDetailedRailLines(ctx, cam, start, snappedEnd, vw, vh, false, railColor, accent, 0, 0, '#ffffff', GAUGE)
    ctx.globalAlpha = 1
  }

  // End node marker / snap indicator
  if (isClosedToNode) {
    ctx.strokeStyle = '#10b981'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(w2sX(snappedEnd.x), w2sY(snappedEnd.y), 8, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Length label near snapped end
  ctx.font = '600 11px Archivo, system-ui, sans-serif'
  const labelW = ctx.measureText(labelText).width
  const lx = w2sX(snappedEnd.x) + 14
  const ly = w2sY(snappedEnd.y) - 10

  ctx.fillStyle = isClosedToNode ? 'rgba(16, 185, 129, 0.9)' : 'rgba(37, 99, 235, 0.85)'
  ctx.beginPath()
  ctx.roundRect(lx - 6, ly - 14, labelW + 12, 20, 4)
  ctx.fill()
  ctx.fillStyle = paper
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(labelText, lx, ly - 4)

  ctx.restore()
}

function renderCurvePreview(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  start: Point,
  via: Point,
  end: Point,
  labelText: string,
  isClosedToNode = false,
  colorOverride?: string,
): void {
  const defaultAccent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
  const accent = colorOverride ?? defaultAccent
  const isGreen = colorOverride === '#10b981' || isClosedToNode
  const railColor = isGreen ? '#10b981' : (getComputedStyle(ctx.canvas).getPropertyValue('--rail').trim() || '#526071')
  const paper = getComputedStyle(ctx.canvas).getPropertyValue('--paper').trim() || '#fff'
  const w2sX = (wx: number) => (wx - cam.x) * cam.scale + vw / 2
  const w2sY = (wy: number) => (wy - cam.y) * cam.scale + vh / 2

  ctx.save()

  // Start node marker
  ctx.fillStyle = accent
  ctx.globalAlpha = 0.8
  ctx.beginPath()
  ctx.arc(w2sX(start.x), w2sY(start.y), 6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = paper
  ctx.beginPath()
  ctx.arc(w2sX(start.x), w2sY(start.y), 3, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // Curve preview
  if (cam.scale < SIMPLIFY_THRESHOLD) {
    ctx.strokeStyle = accent
    ctx.lineWidth = 2.5
    ctx.setLineDash(isGreen ? [] : [6, 4])
    ctx.beginPath()
    ctx.moveTo(w2sX(start.x), w2sY(start.y))
    ctx.quadraticCurveTo(w2sX(via.x), w2sY(via.y), w2sX(end.x), w2sY(end.y))
    ctx.stroke()
    ctx.setLineDash([])
  } else {
    ctx.globalAlpha = 0.95
    renderDetailedCurveRails(ctx, cam, start, via, end, vw, vh, isGreen, railColor, accent, 0, 0, '#ffffff', GAUGE)
    ctx.globalAlpha = 1
  }

  // End node marker / snap indicator
  ctx.strokeStyle = accent
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.arc(w2sX(end.x), w2sY(end.y), 8, 0, Math.PI * 2)
  ctx.stroke()
  if (isGreen) {
    ctx.fillStyle = 'rgba(16, 185, 129, 0.4)'
    ctx.fill()
  }

  // Label near end
  ctx.font = '600 11px Archivo, system-ui, sans-serif'
  const labelW = ctx.measureText(labelText).width
  const lx = w2sX(end.x) + 14
  const ly = w2sY(end.y) - 10

  ctx.fillStyle = isGreen ? 'rgba(16, 185, 129, 0.95)' : 'rgba(37, 99, 235, 0.85)'
  ctx.beginPath()
  ctx.roundRect(lx - 6, ly - 14, labelW + 12, 20, 4)
  ctx.fill()
  ctx.fillStyle = paper
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(labelText, lx, ly - 4)

  ctx.restore()
}

interface CanvasProps {
  store: EditorStore
  /** Called with viewport dimensions on resize; used by parent for fit-view etc. */
  onViewport?: (w: number, h: number) => void
}

export function Canvas({ store, onViewport }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isModifierDownRef = useRef(false)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cam = store.camera
    const rect = canvas.getBoundingClientRect()
    if (store.showGrid) {
      const customSpacing = store.gridMode === 'fixed' ? store.gridSpacing : undefined
      renderGrid(ctx, cam, rect.width, rect.height, customSpacing)
    } else {
      const bg = getComputedStyle(canvas).getPropertyValue('--paper').trim() || '#fff'
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, rect.width, rect.height)
    }
    if (store.boardEnabled && store.boardWidth > 0 && store.boardHeight > 0) {
      renderBaseboard(ctx, cam, rect.width, rect.height, store.boardWidth, store.boardHeight, store.unit, store.scalePreset)
    }

    renderNetwork(ctx, cam, rect.width, rect.height, store.network, store.selection, store.sectionMeta, { tool: store.tool })

    // Render locomotive on top of the track network
    if (store.locomotive) {
      renderLocomotive(ctx, cam, rect.width, rect.height, store.network, store.locomotive, false, store.showTrainDebug)
    }

    // Ghost preview when placing a locomotive
    if (store.tool === 'locomotive' && store.locomotivePreview && !store.isPlayMode) {
      renderLocomotive(ctx, cam, rect.width, rect.height, store.network, store.locomotivePreview, true, store.showTrainDebug)
    }

    // Box selection rectangle
    if (store.isBoxSelecting && store.boxSelectStart && store.boxSelectEnd) {
      const accent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
      const sx1 = (store.boxSelectStart.x - cam.x) * cam.scale + rect.width / 2
      const sy1 = (store.boxSelectStart.y - cam.y) * cam.scale + rect.height / 2
      const sx2 = (store.boxSelectEnd.x - cam.x) * cam.scale + rect.width / 2
      const sy2 = (store.boxSelectEnd.y - cam.y) * cam.scale + rect.height / 2
      const x = Math.min(sx1, sx2)
      const y = Math.min(sy1, sy2)
      const w = Math.abs(sx2 - sx1)
      const h = Math.abs(sy2 - sy1)
      ctx.save()
      ctx.strokeStyle = accent
      ctx.fillStyle = accent
      ctx.globalAlpha = 0.1
      ctx.fillRect(x, y, w, h)
      ctx.globalAlpha = 0.8
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.strokeRect(x, y, w, h)
      ctx.setLineDash([])
      ctx.restore()
    }

    // Snap indicator (all construction tools)
    const isSnapTool =
      store.tool === 'place' ||
      store.tool === 'curve' ||
      store.tool === 'turnout' ||
      store.tool === 'split' ||
      store.tool === 'measure'
    if (isSnapTool) {
      const isNode = store.hoverNodeId !== null
      if (isNode || store.snap) {
        renderSnapIndicator(ctx, cam, rect.width, rect.height, store.snappedCursor, isNode)
      }
    }

    // Point de snap sur la voie survolée (outils de construction uniquement)
    if (isSnapTool && store.hoverSegSteps && store.hoverSegSteps.nearest) {
      const nearest = store.hoverSegSteps.nearest
      const accent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
      const w2sX = (wx: number) => (wx - cam.x) * cam.scale + rect.width / 2
      const w2sY = (wy: number) => (wy - cam.y) * cam.scale + rect.height / 2
      ctx.save()

      // Pas le plus proche : cercle plein + anneau
      ctx.globalAlpha = 1
      ctx.fillStyle = accent
      ctx.beginPath()
      ctx.arc(w2sX(nearest.x), w2sY(nearest.y), 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(w2sX(nearest.x), w2sY(nearest.y), 9, 0, Math.PI * 2)
      ctx.stroke()
      // Label distance and coordinates
      const seg = store.network.segments.get(store.hoverSegSteps.segId)
      const nodeA = seg ? store.network.nodes.get(seg.from) : null
      let distFromStart = '0.0'
      if (nodeA) {
        const dx = nearest.x - nodeA.pos.x
        const dy = nearest.y - nodeA.pos.y
        distFromStart = Math.hypot(dx, dy).toFixed(1)
      }
      const isIntCoord = Math.abs(Math.round(nearest.x) - nearest.x) < 1e-3 && Math.abs(Math.round(nearest.y) - nearest.y) < 1e-3
      const coordLabel = isIntCoord ? `[${Math.round(nearest.x)}, ${Math.round(nearest.y)}] ` : ''
      ctx.font = '600 10px Archivo, system-ui, sans-serif'
      ctx.fillStyle = accent
      ctx.globalAlpha = 0.95
      ctx.textBaseline = 'bottom'
      ctx.textAlign = 'center'
      ctx.fillText(`${coordLabel}+${distFromStart} m`, w2sX(nearest.x), w2sY(nearest.y) - 12)
      ctx.restore()
    }

    // Place tool preview: rail from last node, snapped to Kato length or freeform
    if (store.tool === 'place' && store.lastNodeId) {
      const startNode = store.network.nodes.get(store.lastNodeId)
      if (startNode) {
        const cursor = store.snap ? store.snappedCursor : store.cursorWorld
        const tangent = getTangentForPlacement(store.network, store.lastNodeId, cursor)
        let dir: Point
        let snappedLen: number
        let candidateEnd: Point
        const dx = cursor.x - startNode.pos.x
        const dy = cursor.y - startNode.pos.y
        const minLen = store.getMinTrackLength()

        if (tangent) {
          dir = tangent
          const proj = dx * dir.x + dy * dir.y
          const dist = Math.max(minLen, proj)
          if (store.trackMode === 'freeform') {
            snappedLen = store.snap ? Math.max(minLen, Math.round(dist * 10) / 10) : Math.max(minLen, dist)
          } else if (store.selectedStraightLength !== 'auto') {
            snappedLen = store.selectedStraightLength
          } else {
            snappedLen = snapStraightLength(dist)
          }
          candidateEnd = computeStraightPiece(startNode.pos, dir, snappedLen)
        } else {
          if (store.trackMode === 'freeform') {
            candidateEnd = cursor
            const rawDist = Math.hypot(dx, dy)
            snappedLen = store.snap ? Math.max(minLen, Math.round(rawDist * 10) / 10) : Math.max(minLen, rawDist)
          } else {
            const dist = Math.hypot(dx, dy)
            dir = dist > 0.01
              ? (store.snap ? snapDirection({ x: dx / dist, y: dy / dist }, 15, 6) : { x: dx / dist, y: dy / dist })
              : { x: 1, y: 0 }
            if (store.selectedStraightLength !== 'auto') {
              snappedLen = store.selectedStraightLength
            } else {
              snappedLen = store.snap ? snapStraightLength(dist) : Math.max(minLen, dist)
            }
            candidateEnd = computeStraightPiece(startNode.pos, dir, snappedLen)
          }
        }
        const closeNode = findNearestNode(store.network, candidateEnd, 16, cam)
        const isJoinNode = closeNode !== null && closeNode.id !== store.lastNodeId
        const hitSegId = !isJoinNode ? hitSegment(store.network, candidateEnd, 16 / cam.scale) : null
        const isJoin = isJoinNode || hitSegId !== null
        const prefix = store.trackMode === 'freeform' ? 'Flex ' : ''
        const joinSuffix = isJoinNode ? '  → Jonction' : hitSegId ? '  → Aiguillage sur voie' : ''
        const modeLabel = store.parallelMode ? '  | Double voie' : ''
        const formattedDist = formatDistance(snappedLen, store.unit)
        const labelText = `${prefix}${formattedDist}${joinSuffix}${modeLabel}`
        renderPlacePreview(ctx, cam, rect.width, rect.height, startNode.pos, candidateEnd, labelText, isJoin)

        // Live CAD dimensioning overlay
        if (store.showDimensions) {
          renderStraightDimension(
            ctx,
            cam,
            rect.width,
            rect.height,
            startNode.pos,
            candidateEnd,
            snappedLen,
            store.unit,
            { showAngle: true },
          )
        }

        // Preview de la voie secondaire parallele si mode double voie actif ou touche Shift/Ctrl maintenue
        const showParallelPreview = store.parallelMode || isModifierDownRef.current
        if (showParallelPreview) {
          const dxp = candidateEnd.x - startNode.pos.x
          const dyp = candidateEnd.y - startNode.pos.y
          const lenp = Math.hypot(dxp, dyp)
          if (lenp > 0.5) {
            const uxp = dxp / lenp
            const uyp = dyp / lenp
            const nxp = -uyp
            const nyp = uxp
            const off = store.parallelOffset
            // Noeud de depart secondaire (soit parallelLastNodeId, soit decale du startNode)
            const secStartNode = store.parallelLastNodeId
              ? store.network.nodes.get(store.parallelLastNodeId)
              : null
            const secStart = secStartNode
              ? secStartNode.pos
              : { x: startNode.pos.x + nxp * off, y: startNode.pos.y + nyp * off }
            const secEnd = { x: candidateEnd.x + nxp * off, y: candidateEnd.y + nyp * off }
            ctx.save()
            ctx.globalAlpha = 0.55
            renderPlacePreview(ctx, cam, rect.width, rect.height, secStart, secEnd, 'Voie 2', false)
            ctx.restore()

            if (store.showDimensions) {
              renderParallelSpacingDimension(
                ctx,
                cam,
                rect.width,
                rect.height,
                candidateEnd,
                secEnd,
                store.parallelOffset,
                store.unit,
              )
            }
          }
        }
      }
    }

    // Curve preview — UIC catalog piece or freeform tangent arc
    const cs = store.curveState
    if (cs.phase === 1 && cs.startId) {
      const startNode = store.network.nodes.get(cs.startId)
      if (startNode) {
        const cursor = store.snap ? store.snappedCursor : store.cursorWorld
        const hitTol = 24 / cam.scale
        const trackTarget = getTrackTangentAt(store.network, cursor, hitTol, cs.startId)
        const startTan = getTangentForPlacement(store.network, cs.startId, cursor)
        const fallbackTangent = startTan ?? (() => {
          const dx = cursor.x - startNode.pos.x
          const dy = cursor.y - startNode.pos.y
          const len = Math.hypot(dx, dy)
          return len > 0.01
            ? (store.snap ? snapDirection({ x: dx / len, y: dy / len }, 15, 6) : { x: dx / len, y: dy / len })
            : { x: 1, y: 0 }
        })()

        const showParallelPreview = store.parallelMode || isModifierDownRef.current

        if (trackTarget) {
          const targetPoint = trackTarget.pointOnTrack
          const lock = startTan
            ? computeTurnoutIntersectionLock(startNode.pos, startTan, targetPoint, trackTarget.tangent)
            : (store.trackMode === 'catalog'
                ? computeReverseFreeNodeLock(startNode.pos, targetPoint, trackTarget.tangent, store.selectedCurveRadius)
                : null)

          if (lock && lock.valid) {
            const end = lock.lockPoint
            const via = lock.via
            const len = curveLength(startNode.pos, via, end)
            const labelText = `Aiguillage verrouillé (0°)  ${formatRadius(lock.radius, store.unit)}  ${formatAngle(lock.angleDeg)} (${formatDistance(len, store.unit)})  → Jonction tangente`
            renderCurvePreview(ctx, cam, rect.width, rect.height, startNode.pos, via, end, labelText, true, '#10b981')

            if (store.showDimensions) {
              renderCurveDimension(ctx, cam, rect.width, rect.height, startNode.pos, via, end, lock.radius, lock.angleDeg, len, store.unit)
            }

            if (showParallelPreview) {
              const par = computeParallelCurve(startNode.pos, via, end, store.parallelOffset)
              const secStartNode = store.parallelLastNodeId ? store.network.nodes.get(store.parallelLastNodeId) : null
              const secStart = secStartNode ? secStartNode.pos : par.start
              ctx.save()
              ctx.globalAlpha = 0.55
              renderCurvePreview(ctx, cam, rect.width, rect.height, secStart, par.via, par.end, 'Voie 2', false)
              ctx.restore()

              if (store.showDimensions) {
                renderParallelSpacingDimension(ctx, cam, rect.width, rect.height, end, par.end, store.parallelOffset, store.unit)
              }
            }
          } else {
            const { end, via, radius, angle } = computeReverseFreeformCurve(startNode.pos, targetPoint, trackTarget.tangent)
            const isJoinNode = trackTarget.nodeId !== undefined
            const len = curveLength(startNode.pos, via, end)
            const initTan = { x: via.x - startNode.pos.x, y: via.y - startNode.pos.y }
            const side = computeSide(initTan, startNode.pos, end)
            const sideLabel = side === -1 ? 'Gauche' : 'Droite'
            const joinSuffix = isJoinNode ? '  → Jonction tangente' : '  → Raccordement tangent (0°)'
            const labelText = radius === Infinity
              ? `Ligne droite ${formatDistance(len, store.unit)}${joinSuffix}`
              : `Courbe ${sideLabel} ${formatRadius(radius, store.unit)}  ${formatAngle(angle)} (${formatDistance(len, store.unit)})${joinSuffix}`
            renderCurvePreview(ctx, cam, rect.width, rect.height, startNode.pos, via, end, labelText, true, '#10b981')

            if (store.showDimensions) {
              renderCurveDimension(ctx, cam, rect.width, rect.height, startNode.pos, via, end, radius, angle, len, store.unit)
            }

            if (showParallelPreview) {
              const par = computeParallelCurve(startNode.pos, via, end, store.parallelOffset)
              const secStartNode = store.parallelLastNodeId ? store.network.nodes.get(store.parallelLastNodeId) : null
              const secStart = secStartNode ? secStartNode.pos : par.start
              ctx.save()
              ctx.globalAlpha = 0.55
              renderCurvePreview(ctx, cam, rect.width, rect.height, secStart, par.via, par.end, 'Voie 2', false)
              ctx.restore()

              if (store.showDimensions) {
                renderParallelSpacingDimension(ctx, cam, rect.width, rect.height, end, par.end, store.parallelOffset, store.unit)
              }
            }
          }
        } else if (store.trackMode === 'freeform') {
          const tangent = fallbackTangent
          const closeNode = findNearestNode(store.network, cursor, 16, cam)
          const target = closeNode && closeNode.id !== cs.startId ? closeNode.pos : cursor
          const { end, via, radius, angle } = computeFreeformCurve(startNode.pos, tangent, target)
          const isJoinNode = closeNode !== null && closeNode.id !== cs.startId
          const hitSegId = !isJoinNode ? hitSegment(store.network, end, 16 / cam.scale) : null
          const isJoin = isJoinNode || hitSegId !== null
          const len = curveLength(startNode.pos, via, end)
          const side = computeSide(tangent, startNode.pos, target)
          const sideLabel = side === -1 ? 'Gauche' : 'Droite'
          const joinSuffix = isJoinNode ? '  → Jonction' : hitSegId ? '  → Aiguillage sur voie' : ''
          const labelText = radius === Infinity
            ? `Flex ${formatDistance(len, store.unit)}${joinSuffix}`
            : `Flex ${sideLabel} ${formatRadius(radius, store.unit)}  ${formatAngle(angle)} (${formatDistance(len, store.unit)})${joinSuffix}`
          renderCurvePreview(ctx, cam, rect.width, rect.height, startNode.pos, via, end, labelText, isJoin)

          if (store.showDimensions) {
            renderCurveDimension(ctx, cam, rect.width, rect.height, startNode.pos, via, end, radius, angle, len, store.unit)
          }

          if (showParallelPreview) {
            const par = computeParallelCurve(startNode.pos, via, end, store.parallelOffset)
            const secStartNode = store.parallelLastNodeId ? store.network.nodes.get(store.parallelLastNodeId) : null
            const secStart = secStartNode ? secStartNode.pos : par.start
            ctx.save()
            ctx.globalAlpha = 0.55
            renderCurvePreview(ctx, cam, rect.width, rect.height, secStart, par.via, par.end, 'Voie 2', false)
            ctx.restore()

            if (store.showDimensions) {
              renderParallelSpacingDimension(ctx, cam, rect.width, rect.height, end, par.end, store.parallelOffset, store.unit)
            }
          }
        } else {
          const tangent = fallbackTangent
          const radius = store.selectedCurveRadius
          const angle = store.selectedCurveAngle
          const side = store.autoCurveSide ? computeSide(tangent, startNode.pos, cursor) : store.curveSide
          const sideLabel = side === -1 ? 'Gauche' : 'Droite'
          const { end, via } = computeCurvePiece(startNode.pos, tangent, radius, side, angle)
          const closeNode = findNearestNode(store.network, end, 16, cam)
          const isJoinNode = closeNode !== null && closeNode.id !== cs.startId
          const hitSegId = !isJoinNode ? hitSegment(store.network, end, 16 / cam.scale) : null
          const isJoin = isJoinNode || hitSegId !== null
          const len = curveLength(startNode.pos, via, end)
          const joinSuffix = isJoinNode ? '  → Jonction' : hitSegId ? '  → Aiguillage sur voie' : ''
          const labelText = `Courbe ${sideLabel} ${formatRadius(radius, store.unit)}  ${formatAngle(angle)} (${formatDistance(len, store.unit)})${joinSuffix}`
          renderCurvePreview(ctx, cam, rect.width, rect.height, startNode.pos, via, end, labelText, isJoin)

          if (store.showDimensions) {
            renderCurveDimension(ctx, cam, rect.width, rect.height, startNode.pos, via, end, radius, angle, len, store.unit)
          }

          if (showParallelPreview) {
            const par = computeParallelCurve(startNode.pos, via, end, store.parallelOffset)
            const secStartNode = store.parallelLastNodeId ? store.network.nodes.get(store.parallelLastNodeId) : null
            const secStart = secStartNode ? secStartNode.pos : par.start
            ctx.save()
            ctx.globalAlpha = 0.55
            renderCurvePreview(ctx, cam, rect.width, rect.height, secStart, par.via, par.end, 'Voie 2', false)
            ctx.restore()

            if (store.showDimensions) {
              renderParallelSpacingDimension(ctx, cam, rect.width, rect.height, end, par.end, store.parallelOffset, store.unit)
            }
          }
        }
      }
    }

    // Parallel Turnout preview (Branchement avec contre-courbe intégrée - pose libre par la fin)
    if (store.tool === 'turnout') {
      const accent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
      const railColor = getComputedStyle(ctx.canvas).getPropertyValue('--rail').trim() || '#526071'
      const cursor = store.snap ? store.snappedCursor : store.cursorWorld
      if (store.turnoutStartId) {
        const startNode = store.network.nodes.get(store.turnoutStartId)
        if (startNode) {
          const tangent = getTangentForPlacement(store.network, startNode.id, cursor) ?? { x: 1, y: 0 }
          const geom = computeFreeformParallelTurnout(startNode.pos, tangent, cursor)
          if (geom && geom.valid) {
            ctx.save()
            ctx.globalAlpha = 0.85
            // Real double steel rails for the 2 curved segments:
            renderDetailedCurveRails(ctx, cam, geom.startPos, geom.via1, geom.midPos, rect.width, rect.height, false, railColor, accent, 0, 0, '#ffffff', GAUGE)
            renderDetailedCurveRails(ctx, cam, geom.midPos, geom.via2, geom.endPos, rect.width, rect.height, false, railColor, accent, 0, 0, '#ffffff', GAUGE)
            ctx.globalAlpha = 1

            const p0x = (geom.startPos.x - cam.x) * cam.scale + rect.width / 2
            const p0y = (geom.startPos.y - cam.y) * cam.scale + rect.height / 2
            const pex = (geom.endPos.x - cam.x) * cam.scale + rect.width / 2
            const pey = (geom.endPos.y - cam.y) * cam.scale + rect.height / 2

            // Start turnout node & end node markers
            ctx.fillStyle = '#10b981'
            ctx.beginPath()
            ctx.arc(p0x, p0y, 5, 0, Math.PI * 2)
            ctx.arc(pex, pey, 5, 0, Math.PI * 2)
            ctx.fill()

            // Forward sightline along parallel direction
            const sightLen = Math.max(100, 300 / cam.scale)
            ctx.strokeStyle = accent
            ctx.globalAlpha = 0.35
            ctx.lineWidth = 1.5
            ctx.setLineDash([4, 4])
            ctx.beginPath()
            ctx.moveTo(pex, pey)
            ctx.lineTo(
              (geom.endPos.x + geom.tangent.x * sightLen - cam.x) * cam.scale + rect.width / 2,
              (geom.endPos.y + geom.tangent.y * sightLen - cam.y) * cam.scale + rect.height / 2,
            )
            ctx.stroke()
            ctx.setLineDash([])
            ctx.globalAlpha = 1

            // Floating label badge near end
            const labelTxt = `Espacement: ${formatDistance(Math.abs(geom.offset), store.unit)} · Longueur: ${formatDistance(geom.dx, store.unit)} (R${formatRadius(geom.radius, store.unit)})`
            ctx.font = '600 11px Archivo, system-ui, sans-serif'
            const labelW = ctx.measureText(labelTxt).width
            const lx = pex + 14
            const ly = pey - 10
            ctx.fillStyle = 'rgba(37, 99, 235, 0.85)'
            ctx.beginPath()
            ctx.roundRect(lx - 6, ly - 14, labelW + 12, 20, 4)
            ctx.fill()
            ctx.fillStyle = '#fff'
            ctx.textBaseline = 'middle'
            ctx.textAlign = 'left'
            ctx.fillText(labelTxt, lx, ly - 4)
            ctx.restore()
          }
        }
      } else {
        // Phase A: hovering to select start node or start rail
        const nearNode = findNearestNode(store.network, cursor, 20, cam)
        if (nearNode) {
          const nx = (nearNode.pos.x - cam.x) * cam.scale + rect.width / 2
          const ny = (nearNode.pos.y - cam.y) * cam.scale + rect.height / 2
          ctx.save()
          ctx.strokeStyle = '#10b981'
          ctx.lineWidth = 2.5
          ctx.beginPath()
          ctx.arc(nx, ny, 8, 0, Math.PI * 2)
          ctx.stroke()
          ctx.font = '600 11px Archivo, system-ui, sans-serif'
          ctx.fillStyle = '#10b981'
          ctx.fillText('Départ aiguillage', nx + 12, ny - 6)
          ctx.restore()
        } else {
          const hitTol = 18 / cam.scale
          const hitSegId = hitSegment(store.network, cursor, hitTol)
          if (hitSegId) {
            const cx = (cursor.x - cam.x) * cam.scale + rect.width / 2
            const cy = (cursor.y - cam.y) * cam.scale + rect.height / 2
            ctx.save()
            ctx.fillStyle = '#10b981'
            ctx.beginPath()
            ctx.arc(cx, cy, 6, 0, Math.PI * 2)
            ctx.fill()
            ctx.font = '600 11px Archivo, system-ui, sans-serif'
            ctx.fillStyle = '#10b981'
            ctx.fillText('Insérer aiguillage ici', cx + 12, cy - 6)
            ctx.restore()
          }
        }
      }
    }

    // 5. Track Cut / Split preview
    if (store.tool === 'split') {
      const cursor = store.cursorWorld
      const hitTol = 18 / cam.scale
      const segId = hitSegment(store.network, cursor, hitTol)
      const nearNode = findNearestNode(store.network, cursor, 18, cam)
      const targetPos = nearNode ? nearNode.pos : (segId ? store.snappedCursor : null)

      if (targetPos) {
        ctx.save()
        const sx = (targetPos.x - cam.x) * cam.scale + rect.width / 2
        const sy = (targetPos.y - cam.y) * cam.scale + rect.height / 2

        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(sx, sy, 8, 0, Math.PI * 2)
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(sx - 6, sy - 6)
        ctx.lineTo(sx + 6, sy + 6)
        ctx.moveTo(sx + 6, sy - 6)
        ctx.lineTo(sx - 6, sy + 6)
        ctx.stroke()

        ctx.font = '600 11px Archivo, system-ui, sans-serif'
        ctx.fillStyle = '#ef4444'
        ctx.fillText(nearNode ? 'Détacher nœud (Clic)' : 'Couper le rail (Clic)', sx + 12, sy - 8)
        ctx.restore()
      }
    }

    // 6. Measure Tape preview
    if (store.tool === 'measure' && store.measureStart) {
      const cursor = store.snap ? store.snappedCursor : store.cursorWorld
      const endPoint = store.measureEnd ?? cursor
      const start = store.measureStart

      const sX = (start.x - cam.x) * cam.scale + rect.width / 2
      const sY = (start.y - cam.y) * cam.scale + rect.height / 2
      const eX = (endPoint.x - cam.x) * cam.scale + rect.width / 2
      const eY = (endPoint.y - cam.y) * cam.scale + rect.height / 2

      const dist = Math.hypot(endPoint.x - start.x, endPoint.y - start.y)
      const dx = endPoint.x - start.x
      const dy = endPoint.y - start.y
      let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
      if (angleDeg < 0) angleDeg += 360

      ctx.save()
      ctx.strokeStyle = '#f59e0b'
      ctx.lineWidth = 2
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(sX, sY)
      ctx.lineTo(eX, eY)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = '#f59e0b'
      ctx.beginPath()
      ctx.arc(sX, sY, 4, 0, Math.PI * 2)
      ctx.arc(eX, eY, 4, 0, Math.PI * 2)
      ctx.fill()

      const labelText = `${dist.toFixed(2)} m · ${angleDeg.toFixed(1)}° (ΔX: ${Math.abs(dx).toFixed(1)}m, ΔY: ${Math.abs(dy).toFixed(1)}m)`
      ctx.font = '600 11px Archivo, system-ui, sans-serif'
      const lw = ctx.measureText(labelText).width
      const mx = (sX + eX) / 2
      const my = (sY + eY) / 2 - 12

      ctx.fillStyle = 'rgba(245, 158, 11, 0.9)'
      ctx.beginPath()
      ctx.roundRect(mx - lw / 2 - 6, my - 8, lw + 12, 18, 4)
      ctx.fill()

      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(labelText, mx, my + 1)
      ctx.restore()
    }

    // 2D Orthogonal Translation Gizmo on selected node(s) or selected section/track
    const gizmoAnchor = store.tool === 'pan' ? null : getGizmoAnchor(store.network, store.selection)
    if (gizmoAnchor) {
      const sx = (gizmoAnchor.worldPos.x - cam.x) * cam.scale + rect.width / 2
      const sy = (gizmoAnchor.worldPos.y - cam.y) * cam.scale + rect.height / 2
      renderTranslationGizmo(
        ctx,
        { x: sx, y: sy },
        store.gizmoHoverAxis,
        store.gizmoDragAxis,
        {
          delta: store.gizmoDragDelta,
          unit: store.unit,
          canvasWidth: rect.width,
          canvasHeight: rect.height,
        }
      )
    }

    renderScaleBar(ctx, cam, rect.width, rect.height)
  }, [store])

  const getWorldPos = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current!
      const cam = store.camera
      const rect = canvas.getBoundingClientRect()
      return screenToWorld(cam, clientX - rect.left, clientY - rect.top, rect.width, rect.height)
    },
    [store],
  )

  const getSnapSpacing = useCallback(() => {
    if (!store.snap) return 0
    return store.gridMode === 'fixed' ? store.gridSpacing : pickSpacing(store.camera.scale)
  }, [store])

  // Inline rename state for double click on section
  const [renamingSection, setRenamingSection] = useState<{
    sectionId: string
    name: string
    x: number
    y: number
  } | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingSection?.sectionId) {
      setTimeout(() => {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      }, 50)
    }
  }, [renamingSection?.sectionId])

  const commitRename = (overrideName?: string) => {
    if (!renamingSection) return
    const targetName = overrideName !== undefined ? overrideName : (renameInputRef.current?.value ?? renamingSection.name)
    const trimmed = targetName.trim()
    if (trimmed) {
      store.setSectionMeta(renamingSection.sectionId, { name: trimmed })
    }
    setRenamingSection(null)
  }

  // Resize handling
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw()
      store.setViewport(rect.width, rect.height)
      onViewport?.(rect.width, rect.height)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [draw, onViewport])

  // Subscribe to store notifications so external changes immediately redraw the canvas
  useEffect(() => {
    return store.subscribe(draw)
  }, [store, draw])

  // Redraw trigger (called after mutations)
  const redraw = useCallback(() => {
    draw()
    store.notify()
  }, [draw, store])

  // Pan + zoom + placement
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let lastX = 0
    let lastY = 0
    let isSpaceDown = false

    let edgePanRafId: number | null = null
    let lastEdgePanTime = 0
    let edgePanVelocity = { x: 0, y: 0 }
    const lastPointerClient = { x: 0, y: 0 }

    const stopEdgePan = () => {
      edgePanVelocity = { x: 0, y: 0 }
      if (edgePanRafId !== null) {
        cancelAnimationFrame(edgePanRafId)
        edgePanRafId = null
      }
      lastEdgePanTime = 0
    }

    const stepEdgePan = (time: number) => {
      if (lastEdgePanTime === 0) lastEdgePanTime = time
      const dt = Math.min((time - lastEdgePanTime) / 1000, 0.1)
      lastEdgePanTime = time

      if (edgePanVelocity.x !== 0 || edgePanVelocity.y !== 0) {
        const cam = store.camera
        cam.x += (edgePanVelocity.x * dt) / cam.scale
        cam.y += (edgePanVelocity.y * dt) / cam.scale

        const rawWorld = getWorldPos(lastPointerClient.x, lastPointerClient.y)
        store.cursorWorld = rawWorld

        if (store.gizmoDragAxis && store.dragStartWorld) {
          const spacing = getSnapSpacing()
          const anchor = getGizmoAnchor(store.network, store.selection)
          const primaryInitPos = anchor ? anchor.worldPos : null
          if (primaryInitPos) {
            const { delta } = constrainGizmoDrag(
              store.gizmoDragAxis,
              primaryInitPos,
              store.gizmoDragAxis === 'x'
                ? { x: primaryInitPos.x + (rawWorld.x - store.dragStartWorld.x), y: primaryInitPos.y }
                : { x: primaryInitPos.x, y: primaryInitPos.y + (rawWorld.y - store.dragStartWorld.y) },
              store.snap,
              spacing
            )
            store.gizmoDragDelta = delta
            for (const [nid, initPos] of store.draggedNodeInitialPositions) {
              const node = store.network.nodes.get(nid)
              if (node) {
                node.pos.x = initPos.x + delta.x
                node.pos.y = initPos.y + delta.y
              }
            }
            for (const [sid, initVia] of store.draggedViaInitialPositions) {
              const seg = store.network.segments.get(sid)
              if (seg && seg.via) {
                seg.via.x = initVia.x + delta.x
                seg.via.y = initVia.y + delta.y
              }
            }
          }
        } else if (store.isDraggingNode && store.dragStartWorld) {
          const dx = rawWorld.x - store.dragStartWorld.x
          const dy = rawWorld.y - store.dragStartWorld.y
          const spacing = getSnapSpacing()
          for (const [nid, initPos] of store.draggedNodeInitialPositions) {
            const node = store.network.nodes.get(nid)
            if (node) {
              let nx = initPos.x + dx
              let ny = initPos.y + dy
              if (store.snap) {
                const snapped = snapToGrid({ x: nx, y: ny }, spacing)
                nx = snapped.x
                ny = snapped.y
              }
              node.pos.x = nx
              node.pos.y = ny
            }
          }
        } else if (store.snap) {
          const spacing = getSnapSpacing()
          store.snappedCursor = snapToGrid(rawWorld, spacing)
        } else {
          store.snappedCursor = rawWorld
        }

        if (store.isBoxSelecting) {
          store.boxSelectEnd = rawWorld
        }

        draw()
        store.notify()

        edgePanRafId = requestAnimationFrame(stepEdgePan)
      } else {
        edgePanRafId = null
        lastEdgePanTime = 0
      }
    }

    const handleKeyChange = (e: KeyboardEvent) => {
      const active = e.shiftKey || e.ctrlKey || e.metaKey
      if (active !== isModifierDownRef.current) {
        isModifierDownRef.current = active
        draw()
      }

      if (e.code === 'Space') {
        const target = e.target as HTMLElement | null
        if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable)) {
          if (e.type === 'keydown') {
            if (!isSpaceDown) {
              isSpaceDown = true
              if (!store.panning) {
                canvas.style.cursor = 'grab'
              }
            }
          } else if (e.type === 'keyup') {
            isSpaceDown = false
            if (!store.panning) {
              canvas.style.cursor = ''
            }
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyChange)
    window.addEventListener('keyup', handleKeyChange)

    const onDown = (e: PointerEvent) => {
      if (e.button === 2) {
        // Right click: cancel placement chain, curve, or any construction tool and prune orphans
        store.cancelInteraction()
        stopEdgePan()
        redraw()
        return
      }

      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top

      // Priority 0: Check if click hit a 2D Gizmo translation arrow on selected node or section
      if (e.button === 0 && store.tool !== 'pan') {
        const anchor = getGizmoAnchor(store.network, store.selection)
        if (anchor) {
          const sx = (anchor.worldPos.x - store.camera.x) * store.camera.scale + rect.width / 2
          const sy = (anchor.worldPos.y - store.camera.y) * store.camera.scale + rect.height / 2
          const hitAxis = hitTestGizmo({ x: px, y: py }, { x: sx, y: sy })
          if (hitAxis) {
            store.gizmoDragAxis = hitAxis
            store.gizmoDragDelta = { x: 0, y: 0 }
            store.dragStartWorld = getWorldPos(e.clientX, e.clientY)
            store.draggedNodeInitialPositions.clear()
            store.draggedViaInitialPositions.clear()
            for (const nid of anchor.nodeIds) {
              const n = store.network.nodes.get(nid)
              if (n) {
                store.draggedNodeInitialPositions.set(nid, { ...n.pos })
              }
            }
            for (const [sid, initVia] of anchor.curvedSegments) {
              store.draggedViaInitialPositions.set(sid, { ...initVia })
            }
            canvas.setPointerCapture(e.pointerId)
            canvas.style.cursor = hitAxis === 'x' ? 'ew-resize' : 'ns-resize'
            stopEdgePan()
            redraw()
            return
          }
        }
      }

      if (e.button === 1 || (e.button === 0 && (store.tool === 'pan' || isSpaceDown))) {
        // Middle click, pan tool, or spacebar pan: pan
        store.panning = true
        lastX = e.clientX
        lastY = e.clientY
        store.moved = false
        canvas.setPointerCapture(e.pointerId)
        canvas.style.cursor = 'grabbing'
        stopEdgePan()
        return
      }

      if (e.button === 0 && store.tool === 'curve') {
        const world = getWorldPos(e.clientX, e.clientY)
        const cs = store.curveState

        if (cs.phase === 0) {
          // Click 1: pick start node (magnetic snap to existing node, or split segment on track, or place new)
          const clickedNode = findNearestNode(store.network, world, 16, store.camera)
          let startId: string
          if (clickedNode) {
            startId = clickedNode.id
          } else {
            const hitTol = 16 / store.camera.scale
            const hitSegId = store.hoverSegSteps?.segId ?? hitSegment(store.network, world, hitTol)
            if (hitSegId) {
              const targetPos = (store.snap && store.hoverSegSteps?.nearest && store.hoverSegSteps.segId === hitSegId)
                ? store.hoverSegSteps.nearest
                : (store.snap ? store.snappedCursor : world)
              const splitRes = splitSegment(store.network, hitSegId, targetPos)
              startId = splitRes ? splitRes.midNode.id : addNode(store.network, targetPos).id
            } else {
              const spacing = getSnapSpacing()
              const pos = store.snap ? snapToGrid(world, spacing) : world
              const node = addNode(store.network, pos)
              startId = node.id
            }
          }
          store.curveState = { phase: 1, startId }
          store.lastNodeId = startId
          store.selection = { nodes: new Set([startId]), segments: new Set() }
          store.markDirty()
          redraw()
        } else if (cs.phase === 1 && cs.startId) {
          const startNode = store.network.nodes.get(cs.startId)
          if (startNode) {
            const cursor = store.snap ? store.snappedCursor : world
            const hitTol = 24 / store.camera.scale
            const trackTarget = getTrackTangentAt(store.network, cursor, hitTol, cs.startId)
            const startTan = getTangentForPlacement(store.network, cs.startId, cursor)
            const fallbackTangent = startTan ?? (() => {
              const dx = world.x - startNode.pos.x
              const dy = world.y - startNode.pos.y
              const len = Math.hypot(dx, dy)
              return len > 1 ? snapDirection({ x: dx / len, y: dy / len }, 15, 6) : { x: 1, y: 0 }
            })()

            let endPos: Point
            let viaPos: Point

            if (trackTarget) {
              const targetPoint = trackTarget.pointOnTrack
              const lock = startTan
                ? computeTurnoutIntersectionLock(startNode.pos, startTan, targetPoint, trackTarget.tangent)
                : (store.trackMode === 'catalog'
                    ? computeReverseFreeNodeLock(startNode.pos, targetPoint, trackTarget.tangent, store.selectedCurveRadius)
                    : null)

              if (lock && lock.valid) {
                endPos = lock.lockPoint
                viaPos = lock.via
              } else {
                const curve = computeReverseFreeformCurve(startNode.pos, targetPoint, trackTarget.tangent)
                endPos = curve.end
                viaPos = curve.via
              }
            } else if (store.trackMode === 'freeform') {
              const spacing = getSnapSpacing()
              const snappedWorld = store.snap ? snapToGrid(world, spacing) : world
              const closeTarget = findNearestNode(store.network, snappedWorld, 16, store.camera)
              const target = closeTarget && closeTarget.id !== cs.startId ? closeTarget.pos : snappedWorld
              const tangent = fallbackTangent
              const curve = computeFreeformCurve(startNode.pos, tangent, target)
              endPos = curve.end
              viaPos = curve.via
            } else {
              const tangent = fallbackTangent
              const radius = store.selectedCurveRadius
              const angle = store.selectedCurveAngle
              const side = store.autoCurveSide ? computeSide(tangent, startNode.pos, world) : store.curveSide
              const curve = computeCurvePiece(startNode.pos, tangent, radius, side, angle)
              endPos = curve.end
              viaPos = curve.via
            }

            // Auto-snap destination: connect to existing node if close (closes loops!)
            // Or if close to an existing segment, split that segment and connect to midNode!
            let endId: string
            if (trackTarget?.nodeId && trackTarget.nodeId !== cs.startId) {
              endId = trackTarget.nodeId
            } else {
              const closeNode = findNearestNode(store.network, endPos, 16, store.camera)
              if (closeNode && closeNode.id !== cs.startId) {
                endId = closeNode.id
              } else {
                const targetSegId = trackTarget?.segId ?? hitSegment(store.network, endPos, hitTol)
                if (targetSegId) {
                  const splitRes = splitSegment(store.network, targetSegId, endPos)
                  endId = splitRes ? splitRes.midNode.id : addNode(store.network, endPos).id
                } else {
                  const endNode = addNode(store.network, endPos)
                  endId = endNode.id
                }
              }
            }
            addCurveSegment(store.network, cs.startId, endId, viaPos)

            const isParallelKey = e.shiftKey || e.ctrlKey || store.parallelMode

            if (isParallelKey) {
              const par = computeParallelCurve(startNode.pos, viaPos, endPos, store.parallelOffset)
              let secStartId = store.parallelLastNodeId
              if (!secStartId) {
                const s2 = addNode(store.network, par.start)
                secStartId = s2.id
              }
              const endNode2 = addNode(store.network, par.end)

              addCurveSegment(store.network, secStartId, endNode2.id, par.via)

              store.parallelMode = true
              store.parallelLastNodeId = endNode2.id
            }

            reconcileNetworkIntersections(store.network)
            store.markDirty()
            // Finish curve: release cursor so it does not auto-continue
            store.curveState = { phase: 0, startId: null }
            store.lastNodeId = null
            store.selection = { nodes: new Set(), segments: new Set() }
          }
          redraw()
        }
        return
      }

      if (e.button === 0 && store.tool === 'place') {
        const world = getWorldPos(e.clientX, e.clientY)
        const isParallelKey = e.shiftKey || e.ctrlKey || store.parallelMode

        // Shift+Click ou Ctrl+Click ou mode double-voie : pose de voie double continue
        if (isParallelKey) {
          const spacing = getSnapSpacing()
          const snappedWorld = store.snap ? snapToGrid(world, spacing) : world

          if (!store.parallelMode) {
            // Activation du mode double-voie : poser le premier segment principal + secondaire
            if (store.lastNodeId) {
              const startNode = store.network.nodes.get(store.lastNodeId)
              if (startNode) {
                const dx = snappedWorld.x - startNode.pos.x
                const dy = snappedWorld.y - startNode.pos.y
                const len = Math.hypot(dx, dy)
                if (len > 0.5) {
                  const ux = dx / len
                  const uy = dy / len
                  // Vecteur normal perpendiculaire (gauche)
                  const nx = -uy
                  const ny = ux
                  const off = store.parallelOffset

                  // Voie principale : lastNodeId -> snappedWorld
                  const endNode = addNode(store.network, snappedWorld)
                  addSegment(store.network, store.lastNodeId, endNode.id)

                  // Voie secondaire : startNode+offset -> snappedWorld+offset
                  const startPos2 = { x: startNode.pos.x + nx * off, y: startNode.pos.y + ny * off }
                  const endPos2 = { x: snappedWorld.x + nx * off, y: snappedWorld.y + ny * off }
                  // Creer ou recuperer le noeud de depart secondaire
                  let startNodeId2 = store.parallelLastNodeId
                  if (!startNodeId2) {
                    const s2 = addNode(store.network, startPos2)
                    startNodeId2 = s2.id
                  }
                  const endNode2 = addNode(store.network, endPos2)
                  addSegment(store.network, startNodeId2, endNode2.id)

                  store.parallelMode = true
                  store.lastNodeId = endNode.id
                  store.parallelLastNodeId = endNode2.id
                  store.selection = { nodes: new Set([endNode.id, endNode2.id]), segments: new Set() }
                  reconcileNetworkIntersections(store.network)
                  store.markDirty()
                }
              }
            } else {
              // Pas de lastNodeId : poser le premier noeud (ou réutiliser le nœud cliqué)
              const clickedNode = findNearestNode(store.network, world, 16, store.camera)
              let startNodeId: string
              if (clickedNode) {
                startNodeId = clickedNode.id
              } else {
                const targetPos = store.hoverSegSteps?.nearest ?? snappedWorld
                const hitSegId = store.hoverSegSteps?.segId ?? hitSegment(store.network, targetPos, 16 / store.camera.scale)
                if (hitSegId) {
                  const splitRes = splitSegment(store.network, hitSegId, targetPos)
                  startNodeId = splitRes ? splitRes.midNode.id : addNode(store.network, targetPos).id
                } else {
                  const n = addNode(store.network, targetPos)
                  startNodeId = n.id
                }
              }
              store.lastNodeId = startNodeId
              store.parallelMode = false // attend le prochain point pour créer la paire parallèle
              store.selection = { nodes: new Set([startNodeId]), segments: new Set() }
              reconcileNetworkIntersections(store.network)
              store.markDirty()
            }
          } else {
            // Mode double-voie actif : etendre les 2 voies simultanement
            if (store.lastNodeId && store.parallelLastNodeId) {
              const mainStart = store.network.nodes.get(store.lastNodeId)
              const secStart = store.network.nodes.get(store.parallelLastNodeId)
              if (mainStart && secStart) {
                const dx = snappedWorld.x - mainStart.pos.x
                const dy = snappedWorld.y - mainStart.pos.y
                const len = Math.hypot(dx, dy)
                if (len > 0.5) {
                  const ux = dx / len
                  const uy = dy / len
                  const nx = -uy
                  const ny = ux
                  const off = store.parallelOffset

                  // Voie principale
                  const endNode = addNode(store.network, snappedWorld)
                  addSegment(store.network, store.lastNodeId, endNode.id)

                  // Voie secondaire (meme direction, decalee)
                  const endPos2 = { x: snappedWorld.x + nx * off, y: snappedWorld.y + ny * off }
                  const endNode2 = addNode(store.network, endPos2)
                  addSegment(store.network, store.parallelLastNodeId, endNode2.id)

                  store.lastNodeId = endNode.id
                  store.parallelLastNodeId = endNode2.id
                  store.selection = { nodes: new Set([endNode.id, endNode2.id]), segments: new Set() }
                  reconcileNetworkIntersections(store.network)
                  store.markDirty()
                }
              }
            }
          }
          redraw()
          return
        }

        // Click normal : si parallelMode n'est pas activé, nettoyer l'état temporaire
        if (!store.parallelMode) {
          store.parallelLastNodeId = null
        }

        const clickedNode = findNearestNode(store.network, world, 16, store.camera)

        if (clickedNode) {
          // If already extending from another node, clicking this node completes the segment and finishes!
          if (store.lastNodeId && store.lastNodeId !== clickedNode.id) {
            addSegment(store.network, store.lastNodeId, clickedNode.id)
            reconcileNetworkIntersections(store.network)
            store.markDirty()
            store.lastNodeId = null
            store.selection = { nodes: new Set(), segments: new Set() }
          } else {
            // First click on an existing node: set as start node
            store.lastNodeId = clickedNode.id
            store.selection = { nodes: new Set([clickedNode.id]), segments: new Set() }
          }
        } else if (store.lastNodeId) {
          // Extending from lastNodeId
          const startNode = store.network.nodes.get(store.lastNodeId)
          if (startNode) {
            const spacing = getSnapSpacing()
            const snappedWorld = store.snap ? snapToGrid(world, spacing) : world
            const tangent = getTangentForPlacement(store.network, store.lastNodeId, snappedWorld)
            let dir: Point
            let snappedLen: number
            let endPos: Point
            const dx = snappedWorld.x - startNode.pos.x
            const dy = snappedWorld.y - startNode.pos.y

            const minLen = store.getMinTrackLength()
            if (tangent) {
              dir = tangent
              const proj = dx * dir.x + dy * dir.y
              const dist = Math.max(minLen, proj)
              if (store.trackMode === 'freeform') {
                snappedLen = store.snap ? Math.max(minLen, Math.round(dist * 10) / 10) : Math.max(minLen, dist)
              } else if (store.selectedStraightLength !== 'auto') {
                snappedLen = store.selectedStraightLength
              } else {
                snappedLen = snapStraightLength(dist)
              }
              endPos = computeStraightPiece(startNode.pos, dir, snappedLen)
            } else {
              if (store.trackMode === 'freeform') {
                const closeTarget = findNearestNode(store.network, snappedWorld, 16, store.camera)
                endPos = closeTarget && closeTarget.id !== store.lastNodeId ? closeTarget.pos : snappedWorld
              } else {
                const rawDist = Math.hypot(dx, dy)
                dir = rawDist > 0.01
                  ? (store.snap ? snapDirection({ x: dx / rawDist, y: dy / rawDist }, 15, 6) : { x: dx / rawDist, y: dy / rawDist })
                  : { x: 1, y: 0 }
                if (store.selectedStraightLength !== 'auto') {
                  snappedLen = store.selectedStraightLength
                } else {
                  snappedLen = store.snap ? snapStraightLength(rawDist) : Math.max(minLen, rawDist)
                }
                endPos = computeStraightPiece(startNode.pos, dir, snappedLen)
              }
            }

            const closeNode = findNearestNode(store.network, endPos, 16, store.camera)
            let endId: string
            if (closeNode && closeNode.id !== store.lastNodeId) {
              endId = closeNode.id
            } else {
              const hitTol = 16 / store.camera.scale
              const hitSegId = store.hoverSegSteps?.segId ?? hitSegment(store.network, endPos, hitTol)
              if (hitSegId) {
                const targetEnd = (store.snap && store.hoverSegSteps?.nearest && store.hoverSegSteps.segId === hitSegId)
                  ? store.hoverSegSteps.nearest
                  : endPos
                const splitRes = splitSegment(store.network, hitSegId, targetEnd)
                endId = splitRes ? splitRes.midNode.id : addNode(store.network, targetEnd).id
              } else {
                const endNode = addNode(store.network, endPos)
                endId = endNode.id
              }
            }
            addSegment(store.network, store.lastNodeId, endId)
            reconcileNetworkIntersections(store.network)
            store.markDirty()
            // Finish straight segment: release cursor so it does not auto-continue
            store.lastNodeId = null
            store.selection = { nodes: new Set(), segments: new Set() }
          }
        } else {
          // First node placement: if clicked on an existing segment, split it to start from it!
          const hitTol = 16 / store.camera.scale
          const hitSegId = store.hoverSegSteps?.segId ?? hitSegment(store.network, world, hitTol)
          let startNodeId: string
          if (hitSegId) {
            const targetPos = (store.snap && store.hoverSegSteps?.nearest && store.hoverSegSteps.segId === hitSegId)
              ? store.hoverSegSteps.nearest
              : (store.snap ? store.snappedCursor : world)
            const splitRes = splitSegment(store.network, hitSegId, targetPos)
            startNodeId = splitRes ? splitRes.midNode.id : addNode(store.network, targetPos).id
          } else {
            const spacing = getSnapSpacing()
            const pos = store.snap ? snapToGrid(world, spacing) : world
            const n = addNode(store.network, pos)
            startNodeId = n.id
          }
          store.lastNodeId = startNodeId
          store.selection = { nodes: new Set([startNodeId]), segments: new Set() }
          store.markDirty()
        }
        redraw()
        return
      }

      if (e.button === 0 && store.tool === 'turnout') {
        const world = getWorldPos(e.clientX, e.clientY)
        const cursor = store.snap ? store.snappedCursor : world

        if (store.turnoutStartId) {
          const startNode = store.network.nodes.get(store.turnoutStartId)
          if (startNode) {
            const tangent = getTangentForPlacement(store.network, startNode.id, cursor) ?? { x: 1, y: 0 }
            const geom = computeFreeformParallelTurnout(startNode.pos, tangent, cursor)
            if (geom && geom.valid) {
              const res = applyFreeformParallelTurnout(store.network, startNode.id, geom)
              store.lastNodeId = res.endNode.id
              store.turnoutStartId = null
              store.markDirty()
            }
          }
        } else {
          const nearNode = findNearestNode(store.network, cursor, 20, store.camera)
          if (nearNode) {
            store.turnoutStartId = nearNode.id
          } else {
            const hitTol = 18 / store.camera.scale
            const hitSegId = store.hoverSegSteps?.segId ?? hitSegment(store.network, cursor, hitTol)
            if (hitSegId) {
              const targetPos = (store.snap && store.hoverSegSteps?.nearest && store.hoverSegSteps.segId === hitSegId)
                ? store.hoverSegSteps.nearest
                : cursor
              const split = splitSegment(store.network, hitSegId, targetPos)
              if (split) {
                store.turnoutStartId = split.midNode.id
                store.markDirty()
              }
            }
          }
        }
        redraw()
        return
      }

      if (e.button === 0 && store.tool === 'split') {
        const world = getWorldPos(e.clientX, e.clientY)
        const targetPos = (store.snap && store.hoverSegSteps?.nearest)
          ? store.hoverSegSteps.nearest
          : (store.snap ? store.snappedCursor : world)
        const success = performTrackCut(store.network, targetPos, 18 / store.camera.scale)
        if (success) {
          reconcileNetworkIntersections(store.network)
          store.markDirty()
        }
        redraw()
        return
      }

      if (e.button === 0 && store.tool === 'measure') {
        const world = getWorldPos(e.clientX, e.clientY)
        const pt = store.snap ? store.snappedCursor : world
        if (!store.measureStart || (store.measureStart && store.measureEnd)) {
          store.measureStart = pt
          store.measureEnd = null
          store.isMeasuring = true
        } else {
          store.measureEnd = pt
          store.isMeasuring = false
        }
        redraw()
        return
      }

      if (e.button === 0 && store.tool === 'locomotive') {
        const world = getWorldPos(e.clientX, e.clientY)
        store.placeLocomotiveAt(world)
        redraw()
        return
      }

      if (e.button === 0 && store.tool === 'select') {
        const isMulti = e.shiftKey || e.ctrlKey || e.metaKey
        const world = getWorldPos(e.clientX, e.clientY)
        const hitTol = 14 / store.camera.scale
        const nodeId = hitNode(store.network, world, hitTol)
        if (nodeId) {
          const existingJunc = findJunctionAtNode(store.network, nodeId)
          if (existingJunc && store.selection.nodes.has(nodeId) && !isMulti) {
            toggleJunction(existingJunc)
            store.markDirty()
          }
          if (isMulti) {
            const newNodes = new Set(store.selection.nodes)
            if (newNodes.has(nodeId)) newNodes.delete(nodeId)
            else newNodes.add(nodeId)
            store.selection = { ...store.selection, nodes: newNodes }
          } else {
            if (!store.selection.nodes.has(nodeId)) {
              store.selection = { nodes: new Set([nodeId]), segments: new Set() }
            }
          }
          // Start dragging selected nodes!
          store.isDraggingNode = true
          store.dragStartWorld = world
          store.draggedNodeInitialPositions.clear()
          for (const nid of store.selection.nodes) {
            const node = store.network.nodes.get(nid)
            if (node) {
              store.draggedNodeInitialPositions.set(nid, { ...node.pos })
            }
          }
          canvas.setPointerCapture(e.pointerId)
          redraw()
          return
        }

        const segId = hitSegment(store.network, world, 12 / store.camera.scale)
        if (segId) {
          const sections = computeTrackSections(store.network, store.sectionMeta)
          const clickedSection = findSectionBySegment(sections, segId)

          if (clickedSection) {
            if (isMulti) {
              const newSegs = new Set(store.selection.segments)
              const newNodes = new Set(store.selection.nodes)
              const alreadyHas = clickedSection.segmentIds.some((sid) => newSegs.has(sid))
              if (alreadyHas) {
                for (const sid of clickedSection.segmentIds) newSegs.delete(sid)
                for (const nid of clickedSection.nodeIds) newNodes.delete(nid)
              } else {
                for (const sid of clickedSection.segmentIds) newSegs.add(sid)
                for (const nid of clickedSection.nodeIds) newNodes.add(nid)
              }
              store.selection = { nodes: newNodes, segments: newSegs }
            } else {
              store.selection = {
                nodes: new Set(clickedSection.nodeIds),
                segments: new Set(clickedSection.segmentIds),
              }
            }
          } else {
            if (isMulti) {
              const newSegs = new Set(store.selection.segments)
              if (newSegs.has(segId)) newSegs.delete(segId)
              else newSegs.add(segId)
              store.selection = { ...store.selection, segments: newSegs }
            } else {
              store.selection = { nodes: new Set(), segments: new Set([segId]) }
            }
          }
          redraw()
          return
        }
        // Empty click: start box selection (not panning)
        store.isBoxSelecting = true
        store.boxSelectStart = world
        store.boxSelectEnd = world
        if (!isMulti) {
          store.selection = { nodes: new Set(), segments: new Set() }
        }
        canvas.setPointerCapture(e.pointerId)
        redraw()
      }
    }

    const onMove = (e: PointerEvent) => {
      lastPointerClient.x = e.clientX
      lastPointerClient.y = e.clientY

      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const vw = rect.width
      const vh = rect.height

      // Edge auto-panning: smoothly glide when cursor approaches canvas borders during active construction or dragging
      const isInteracting =
        store.lastNodeId !== null ||
        store.curveState.phase !== 0 ||
        store.turnoutStartId !== null ||
        store.isBoxSelecting ||
        store.isDraggingNode ||
        store.gizmoDragAxis !== null ||
        store.tool === 'place' ||
        store.tool === 'curve' ||
        store.tool === 'turnout'

      if (!store.panning && isInteracting && px >= 0 && px <= vw && py >= 0 && py <= vh) {
        const EDGE_MARGIN = 55
        const MAX_PAN_SPEED = 380

        let vx = 0
        let vy = 0

        if (px < EDGE_MARGIN) {
          const t = (EDGE_MARGIN - px) / EDGE_MARGIN
          vx = -t * t * MAX_PAN_SPEED
        } else if (px > vw - EDGE_MARGIN) {
          const t = (px - (vw - EDGE_MARGIN)) / EDGE_MARGIN
          vx = t * t * MAX_PAN_SPEED
        }

        if (py < EDGE_MARGIN) {
          const t = (EDGE_MARGIN - py) / EDGE_MARGIN
          vy = -t * t * MAX_PAN_SPEED
        } else if (py > vh - EDGE_MARGIN) {
          const t = (py - (vh - EDGE_MARGIN)) / EDGE_MARGIN
          vy = t * t * MAX_PAN_SPEED
        }

        edgePanVelocity = { x: vx, y: vy }

        if ((vx !== 0 || vy !== 0) && edgePanRafId === null) {
          lastEdgePanTime = 0
          edgePanRafId = requestAnimationFrame(stepEdgePan)
        } else if (vx === 0 && vy === 0 && edgePanRafId !== null) {
          stopEdgePan()
        }
      } else if (!store.panning) {
        stopEdgePan()
      }

      const rawWorld = getWorldPos(e.clientX, e.clientY)
      store.cursorWorld = rawWorld

      // Update locomotive ghost preview during locomotive placement mode
      if (store.tool === 'locomotive' && !store.isPlayMode) {
        store.updateLocomotivePreview(rawWorld)
      }

      // Dragging along 2D Gizmo axis (orthogonal constraint)
      if (store.gizmoDragAxis && store.dragStartWorld) {
        const spacing = getSnapSpacing()
        const anchor = getGizmoAnchor(store.network, store.selection)
        const primaryInitPos = anchor ? anchor.worldPos : null

        if (primaryInitPos) {
          const { delta } = constrainGizmoDrag(
            store.gizmoDragAxis,
            primaryInitPos,
            store.gizmoDragAxis === 'x'
              ? { x: primaryInitPos.x + (rawWorld.x - store.dragStartWorld.x), y: primaryInitPos.y }
              : { x: primaryInitPos.x, y: primaryInitPos.y + (rawWorld.y - store.dragStartWorld.y) },
            store.snap,
            spacing
          )

          store.gizmoDragDelta = delta

          for (const [nid, initPos] of store.draggedNodeInitialPositions) {
            const node = store.network.nodes.get(nid)
            if (node) {
              node.pos.x = initPos.x + delta.x
              node.pos.y = initPos.y + delta.y
            }
          }

          for (const [sid, initVia] of store.draggedViaInitialPositions) {
            const seg = store.network.segments.get(sid)
            if (seg && seg.via) {
              seg.via.x = initVia.x + delta.x
              seg.via.y = initVia.y + delta.y
            }
          }
        }

        draw()
        store.notify()
        return
      }

      // Gizmo arrow hover detection on selected node or section
      if (store.tool !== 'pan' && !store.panning && !store.isDraggingNode && !store.gizmoDragAxis) {
        const anchor = getGizmoAnchor(store.network, store.selection)
        if (anchor) {
          const sx = (anchor.worldPos.x - store.camera.x) * store.camera.scale + vw / 2
          const sy = (anchor.worldPos.y - store.camera.y) * store.camera.scale + vh / 2
          const hoveredAxis = hitTestGizmo({ x: px, y: py }, { x: sx, y: sy })
          if (hoveredAxis !== store.gizmoHoverAxis) {
            store.gizmoHoverAxis = hoveredAxis
            draw()
          }
          if (hoveredAxis === 'x') {
            canvas.style.cursor = 'ew-resize'
            return
          } else if (hoveredAxis === 'y') {
            canvas.style.cursor = 'ns-resize'
            return
          } else if (canvas.style.cursor === 'ew-resize' || canvas.style.cursor === 'ns-resize') {
            canvas.style.cursor = isSpaceDown ? 'grab' : ''
          }
        }
      } else if (store.gizmoHoverAxis !== null) {
        store.gizmoHoverAxis = null
        if (canvas.style.cursor === 'ew-resize' || canvas.style.cursor === 'ns-resize') {
          canvas.style.cursor = isSpaceDown ? 'grab' : ''
        }
        draw()
      }

      // Dragging selected nodes in select tool
      if (store.isDraggingNode && store.dragStartWorld) {
        const dx = rawWorld.x - store.dragStartWorld.x
        const dy = rawWorld.y - store.dragStartWorld.y
        const spacing = getSnapSpacing()
        for (const [nid, initPos] of store.draggedNodeInitialPositions) {
          const node = store.network.nodes.get(nid)
          if (node) {
            let nx = initPos.x + dx
            let ny = initPos.y + dy
            if (store.snap) {
              const snapped = snapToGrid({ x: nx, y: ny }, spacing)
              nx = snapped.x
              ny = snapped.y
            }
            node.pos.x = nx
            node.pos.y = ny
          }
        }
        draw()
        store.notify()
        return
      }

      const isConstructionTool =
        store.tool === 'place' ||
        store.tool === 'curve' ||
        store.tool === 'turnout' ||
        store.tool === 'split' ||
        store.tool === 'measure'

      if (!isConstructionTool) {
        // En mode sélection (V) ou déplacement de vue (H) : aucun point de pose/snap de construction
        store.hoverSegSteps = null
        store.hoverNodeId = null
        store.snappedCursor = rawWorld

        // Feedback curseur survol sur les éléments sélectionnables
        if (store.tool === 'select' && !store.panning && !store.isDraggingNode && !store.gizmoDragAxis && !store.gizmoHoverAxis) {
          const hitTol = 14 / store.camera.scale
          const hoveredNodeId = hitNode(store.network, rawWorld, hitTol)
          const hoveredSegId = hitSegment(store.network, rawWorld, 12 / store.camera.scale)
          if (hoveredNodeId || hoveredSegId) {
            canvas.style.cursor = 'pointer'
          } else if (canvas.style.cursor === 'pointer') {
            canvas.style.cursor = isSpaceDown ? 'grab' : ''
          }
        }
      } else {
        // Magnetic node snap has priority 1 (outils de construction uniquement)
        const nearNode = findNearestNode(store.network, rawWorld, 16, store.camera)
        if (nearNode) {
          store.snappedCursor = { ...nearNode.pos }
          store.hoverNodeId = nearNode.id
          store.hoverSegSteps = null
        } else {
          store.hoverNodeId = null
          // Priority 2: Magnetic track snap when using place, curve, split, measure
          const hitTol = 18 / store.camera.scale
          const hitSegId = hitSegment(store.network, rawWorld, hitTol)
          const isCurvePhase1 = store.tool === 'curve' && store.curveState.phase === 1
          if (hitSegId) {
          if (!isCurvePhase1 && (store.snap || e.shiftKey)) {
            const spacing = getSnapSpacing()
            const { points, nearest } = getStepPointsAlongSegment(hitSegId, store.network, spacing, rawWorld)
            store.hoverSegSteps = { segId: hitSegId, points, nearest }
            if (nearest) {
              store.snappedCursor = { ...nearest }
            } else {
              store.snappedCursor = rawWorld
            }
          } else {
            store.hoverSegSteps = null
            if (isCurvePhase1 && store.curveState.startId) {
              const csNode = store.network.nodes.get(store.curveState.startId)
              const hitTolTrack = 24 / store.camera.scale
              const trTan = getTrackTangentAt(store.network, rawWorld, hitTolTrack, store.curveState.startId)
              const sTan = csNode ? getTangentForPlacement(store.network, store.curveState.startId, rawWorld) : null
              if (csNode && trTan) {
                const lock = sTan
                  ? computeTurnoutIntersectionLock(csNode.pos, sTan, trTan.pointOnTrack, trTan.tangent)
                  : (store.trackMode === 'catalog'
                      ? computeReverseFreeNodeLock(csNode.pos, trTan.pointOnTrack, trTan.tangent, store.selectedCurveRadius)
                      : null)
                if (lock && lock.valid) {
                  const dLock = Math.hypot(rawWorld.x - lock.lockPoint.x, rawWorld.y - lock.lockPoint.y) * store.camera.scale
                  if (dLock < 120) {
                    store.snappedCursor = { ...lock.lockPoint }
                  } else {
                    store.snappedCursor = { ...trTan.pointOnTrack }
                  }
                } else {
                  store.snappedCursor = { ...trTan.pointOnTrack }
                }
              } else {
                store.snappedCursor = rawWorld
              }
            } else {
              const seg = store.network.segments.get(hitSegId)
              const nodeA = seg ? store.network.nodes.get(seg.from) : null
              const nodeB = seg ? store.network.nodes.get(seg.to) : null
              if (seg && nodeA && nodeB) {
                if (seg.kind === 'straight') {
                  const dx = nodeB.pos.x - nodeA.pos.x
                  const dy = nodeB.pos.y - nodeA.pos.y
                  const lenSq = dx * dx + dy * dy
                  if (lenSq > 0) {
                    const t = Math.max(0.02, Math.min(0.98, ((rawWorld.x - nodeA.pos.x) * dx + (rawWorld.y - nodeA.pos.y) * dy) / lenSq))
                    store.snappedCursor = { x: nodeA.pos.x + t * dx, y: nodeA.pos.y + t * dy }
                  } else {
                    store.snappedCursor = rawWorld
                  }
                } else if (seg.kind === 'curve' && seg.via) {
                  const p0 = nodeA.pos
                  const p1 = seg.via
                  const p2 = nodeB.pos
                  let bestT = 0.5
                  let bestDistSq = Infinity
                  for (let i = 1; i < 32; i++) {
                    const s = i / 32
                    const pt = bezierPoint(s, p0, p1, p2)
                    const dSq = (pt.x - rawWorld.x) ** 2 + (pt.y - rawWorld.y) ** 2
                    if (dSq < bestDistSq) {
                      bestDistSq = dSq
                      bestT = s
                    }
                  }
                  store.snappedCursor = bezierPoint(bestT, p0, p1, p2)
                } else {
                  store.snappedCursor = rawWorld
                }
              } else {
                store.snappedCursor = rawWorld
              }
            }
          }
        } else {
          store.hoverSegSteps = null
          if (store.snap) {
            const spacing = getSnapSpacing()
            store.snappedCursor = snapToGrid(rawWorld, spacing)
          } else {
            store.snappedCursor = rawWorld
          }
        }
      }
    }

      if (!store.panning) {
        if (
          store.tool === 'place' ||
          store.tool === 'curve' ||
          store.tool === 'turnout' ||
          store.tool === 'split' ||
          store.tool === 'measure' ||
          store.tool === 'locomotive' ||
          store.hoverSegSteps !== null
        ) {
          draw()
        }
        if (store.isBoxSelecting) {
          store.boxSelectEnd = rawWorld
          draw()
        }
        store.notify()
        return
      }

      const cam = store.camera
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) store.moved = true
      lastX = e.clientX
      lastY = e.clientY
      cam.x -= dx / cam.scale
      cam.y -= dy / cam.scale
      draw()
      store.notify()
    }

    const onUp = (e: PointerEvent) => {
      // Finalize gizmo axis dragging
      if (store.gizmoDragAxis) {
        const moved = Math.abs(store.gizmoDragDelta.x) > 1e-4 || Math.abs(store.gizmoDragDelta.y) > 1e-4
        store.gizmoDragAxis = null
        store.gizmoDragDelta = { x: 0, y: 0 }
        store.dragStartWorld = null
        store.draggedNodeInitialPositions.clear()
        store.draggedViaInitialPositions.clear()
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId)
        }
        canvas.style.cursor = isSpaceDown ? 'grab' : ''
        if (moved) {
          reconcileNetworkIntersections(store.network)
          store.pushHistorySnapshot()
          store.markDirty()
        }
        redraw()
        return
      }

      // Finalize node dragging
      if (store.isDraggingNode) {
        store.isDraggingNode = false
        store.dragStartWorld = null
        store.draggedNodeInitialPositions.clear()
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId)
        }
        reconcileNetworkIntersections(store.network)
        store.pushHistorySnapshot()
        store.markDirty()
        redraw()
        return
      }
      // Finalize box selection
      if (store.isBoxSelecting && store.boxSelectStart && store.boxSelectEnd) {
        const x1 = Math.min(store.boxSelectStart.x, store.boxSelectEnd.x)
        const y1 = Math.min(store.boxSelectStart.y, store.boxSelectEnd.y)
        const x2 = Math.max(store.boxSelectStart.x, store.boxSelectEnd.x)
        const y2 = Math.max(store.boxSelectStart.y, store.boxSelectEnd.y)

        const isMulti = e.shiftKey || e.ctrlKey || e.metaKey

        // Select nodes inside the box
        const nodes = new Set(isMulti ? store.selection.nodes : [])
        for (const node of store.network.nodes.values()) {
          if (node.pos.x >= x1 && node.pos.x <= x2 && node.pos.y >= y1 && node.pos.y <= y2) {
            nodes.add(node.id)
          }
        }

        // Select segments that have at least one endpoint inside the box
        const segments = new Set(isMulti ? store.selection.segments : [])
        for (const seg of store.network.segments.values()) {
          const a = store.network.nodes.get(seg.from)
          const b = store.network.nodes.get(seg.to)
          if (!a || !b) continue
          // Segment is selected if both endpoints are inside the box
          const aIn = a.pos.x >= x1 && a.pos.x <= x2 && a.pos.y >= y1 && a.pos.y <= y2
          const bIn = b.pos.x >= x1 && b.pos.x <= x2 && b.pos.y >= y1 && b.pos.y <= y2
          if (aIn && bIn) {
            segments.add(seg.id)
          }
        }

        store.selection = { nodes, segments }
        store.isBoxSelecting = false
        store.boxSelectStart = null
        store.boxSelectEnd = null
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId)
        }
        redraw()
        return
      }

      stopEdgePan()
      store.panning = false
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId)
      }
      canvas.style.cursor = isSpaceDown ? 'grab' : ''
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      stopEdgePan()

      const cam = store.camera
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const vw = rect.width
      const vh = rect.height

      // When pinching on a trackpad or holding Ctrl/Cmd, browser triggers wheel with ctrlKey: true
      if (e.ctrlKey || e.metaKey) {
        const worldX = cam.x + (px - vw / 2) / cam.scale
        const worldY = cam.y + (py - vh / 2) / cam.scale

        // Smooth exponential zoom for pinch gesture
        const zoomDelta = -e.deltaY * 0.01
        const factor = Math.exp(Math.max(-0.4, Math.min(0.4, zoomDelta)))
        cam.scale = clampScale(cam.scale * factor)

        cam.x = worldX - (px - vw / 2) / cam.scale
        cam.y = worldY - (py - vh / 2) / cam.scale
      } else {
        // Natural 2-finger scroll on trackpad (or mouse wheel scroll):
        // Horizontal trackpad gesture sets deltaX, vertical sets deltaY
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX
        const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY

        cam.x += dx / cam.scale
        cam.y += dy / cam.scale
      }

      const world = getWorldPos(e.clientX, e.clientY)
      if (store.snap) {
        const spacing = getSnapSpacing()
        store.snappedCursor = snapToGrid(world, spacing)
      } else {
        store.snappedCursor = world
      }

      draw()
      store.notify()
    }

    const onContextMenu = (e: Event) => e.preventDefault()

    const onDblClick = (e: MouseEvent) => {
      const world = getWorldPos(e.clientX, e.clientY)
      const hitTol = 14 / store.camera.scale
      const segId = hitSegment(store.network, world, hitTol)
      if (segId) {
        const sections = computeTrackSections(store.network, store.sectionMeta)
        const clickedSection = findSectionBySegment(sections, segId)
        if (clickedSection) {
          const rect = canvas.getBoundingClientRect()
          setRenamingSection({
            sectionId: clickedSection.id,
            name: clickedSection.name,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          })
          store.selection = {
            nodes: new Set(clickedSection.nodeIds),
            segments: new Set(clickedSection.segmentIds),
          }
          redraw()
        }
      }
    }

    const onLeave = () => {
      stopEdgePan()
      if (store.locomotivePreview) {
        store.locomotivePreview = null
        draw()
      }
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)
    canvas.addEventListener('dblclick', onDblClick)
    return () => {
      stopEdgePan()
      window.removeEventListener('keydown', handleKeyChange)
      window.removeEventListener('keyup', handleKeyChange)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContextMenu)
      canvas.removeEventListener('dblclick', onDblClick)
    }
  }, [store, draw, redraw, getWorldPos, getSnapSpacing])

  return (
    <div className="canvas-wrap" style={{ position: 'relative' }}>
      <canvas ref={canvasRef} className={`tool-${store.tool}`} />

      {renamingSection && (
        <div
          style={{
            position: 'absolute',
            left: `${renamingSection.x}px`,
            top: `${renamingSection.y}px`,
            transform: 'translate(-50%, -120%)',
            background: 'var(--panel-bg, #181c24)',
            border: '1px solid var(--accent, #3b82f6)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
            borderRadius: '6px',
            padding: '8px 10px',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            minWidth: '220px',
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted, #94a3b8)' }}>
            Renommer la section
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              e.stopPropagation()
              commitRename()
            }}
            style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}
          >
            <input
              ref={renameInputRef}
              type="text"
              value={renamingSection.name}
              onChange={(e) => setRenamingSection({ ...renamingSection, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  commitRename(e.currentTarget.value)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  setRenamingSection(null)
                }
              }}
              onBlur={(e) => commitRename(e.target.value)}
              style={{
                padding: '5px 8px',
                fontSize: '12px',
                fontWeight: 600,
                background: 'var(--input-bg, #0f172a)',
                color: 'var(--ink, #f8fafc)',
                border: '1px solid var(--border, #334155)',
                borderRadius: '4px',
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '2px' }}>
              <button
                type="button"
                onClick={() => setRenamingSection(null)}
                style={{
                  fontSize: '10px',
                  padding: '3px 8px',
                  background: 'transparent',
                  border: '1px solid var(--border, #334155)',
                  borderRadius: '3px',
                  color: 'var(--text-muted, #94a3b8)',
                  cursor: 'pointer',
                }}
              >
                Annuler
              </button>
              <button
                type="submit"
                style={{
                  fontSize: '10px',
                  padding: '3px 8px',
                  background: 'var(--accent, #3b82f6)',
                  border: 'none',
                  borderRadius: '3px',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Valider
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
