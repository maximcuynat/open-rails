import { useCallback, useEffect, useRef, useState } from 'react'
import { clampScale, screenToWorld, type Camera } from '@infrastructure/render/camera'
import {
  renderGrid,
  renderBaseboard,
  renderNetworkWithTrains,
  renderScaleBar,
  renderDetailedCurveRails,
  renderDetailedRailLines,
  renderLocomotive,
  renderTrainSet,
  trainSetTelemetry,
  renderDrivingRoute,
  renderCouplerPoints,
  renderCouplerSnapIndicator,
  pickSpacing,
  SIMPLIFY_THRESHOLD,
  GAUGE,
  TUNNEL_VEHICLE_ALPHA,
  inLevelBand,
  vehicleLevel,
  type LevelBand,
  type RenderNetworkOptions,
} from '@infrastructure/render/renderer'
import {
  addNode,
  addSegment,
  addCurveChain,
  nodeLevel,
  hitNode,
  hitSegment,
  snapToGrid,
  getStepPointsAlongSegment,
} from '@domain/models/network'
import type { Point } from '@domain/models/types'
import { bezierPoint, computeParallelCurve, splitCurveIntoArcPieces, type CurvePiece } from '@domain/geometry/curve'
import { getTangentForPlacement } from '@domain/geometry/tangent'
import { curvePiecesTo } from '@domain/geometry/curveTool'
import { applyNodeTransform, collectAffectedVias } from '@domain/geometry/nodeTransform'
import { snapStraightLength, computeStraightPiece } from '@domain/profiles/profiles'
import {
  splitSegment,
  findJunctionAtNode,
  findJunctionBySegment,
} from '@domain/models/junction'
import { networkDerived } from '@infrastructure/render/networkDerived'
import { findSectionBySegment } from '@domain/models/sections'
import {
  computeFreeformParallelTurnout,
  applyFreeformParallelTurnout,
  performTrackCut,
} from '@domain/geometry/constructionTemplates'
import { formatDistance, formatRadius, parseDistance } from '@domain/models/units'
import { trainRouteStart } from '@domain/models/train'
import {
  renderStraightDimension,
  renderCurveDimension,
} from './dimensionOverlay'
import {
  hitTestGizmo,
  constrainGizmoDrag,
  rotateGizmoDrag,
  renderTranslationGizmo,
  getGizmoAnchor,
  gizmoFootprint,
} from './gizmo'
import { arrangeConsole } from '../console/consoleLayout'
import { wheelIntent } from './wheelIntent'
import {
  findNearestNode,
  snapDirection,
  resolveCurveTool,
  resolvePlaceTool,
  describeCurve,
  pendingPlacementNodeId,
  resolveSpeedZoneTool,
  speedZoneAim,
} from './placementPreview'
import { TRAIN_PLACEMENT_REFUSED, type EditorStore } from '@application/state/editorStore'
import { showToast } from '../common/Toast'
import { clickSpeedZoneTool, zoneSpeedLabel } from '../common/speedZoneActions'
import { positionOnSegment } from '@domain/models/locomotive'
import { SPEED_ZONE_COLOR, traceTrackSpans } from '@infrastructure/render/speedZoneRender'
import { renderSignalToolPreview } from './signalToolPreview'
import { commitSignalGesture } from '../common/signalActions'
import { hitShownNode } from './nodePicking'


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

  // Length label near snapped end (omitted when the dimension line already says it)
  if (labelText) {
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
  }

  ctx.restore()
}

function renderCurvePreview(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vw: number,
  vh: number,
  pieces: CurvePiece[],
  labelText: string,
  isClosedToNode = false,
  colorOverride?: string,
): void {
  if (pieces.length === 0) return
  const start = pieces[0].start
  const end = pieces[pieces.length - 1].end
  const isInvalid = colorOverride === '#ef4444'
  const defaultAccent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
  const accent = colorOverride ?? defaultAccent
  const isGreen = colorOverride === '#10b981' || isClosedToNode
  const railColor = isGreen ? '#10b981' : isInvalid ? '#ef4444' : (getComputedStyle(ctx.canvas).getPropertyValue('--rail').trim() || '#526071')
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
    for (const p of pieces) {
      ctx.quadraticCurveTo(w2sX(p.via.x), w2sY(p.via.y), w2sX(p.end.x), w2sY(p.end.y))
    }
    ctx.stroke()
    ctx.setLineDash([])
  } else {
    ctx.globalAlpha = 0.95
    for (const p of pieces) {
      renderDetailedCurveRails(ctx, cam, p.start, p.via, p.end, vw, vh, isGreen, railColor, accent, 0, 0, '#ffffff', GAUGE)
    }
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

  // Label near end (omitted when the dimension already says it)
  if (labelText) {
    ctx.font = '600 11px Archivo, system-ui, sans-serif'
    const labelW = ctx.measureText(labelText).width
    const lx = w2sX(end.x) + 14
    const ly = w2sY(end.y) - 10

    ctx.fillStyle = isGreen ? 'rgba(16, 185, 129, 0.95)' : isInvalid ? 'rgba(239, 68, 68, 0.9)' : 'rgba(37, 99, 235, 0.85)'
    ctx.beginPath()
    ctx.roundRect(lx - 6, ly - 14, labelW + 12, 20, 4)
    ctx.fill()
    ctx.fillStyle = paper
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText(labelText, lx, ly - 4)
  }

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

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cam = store.camera
    const rect = canvas.getBoundingClientRect()
    // Plain driving view: nothing but the track, its signs and the trains
    const plainView = store.isPlainDrivingView
    if (store.showGrid && !plainView) {
      const customSpacing = store.gridMode === 'fixed' ? store.gridSpacing : undefined
      renderGrid(ctx, cam, rect.width, rect.height, customSpacing)
    } else {
      const bg = getComputedStyle(canvas).getPropertyValue('--paper').trim() || '#fff'
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, rect.width, rect.height)
    }
    if (store.boardEnabled && !plainView && store.boardWidth > 0 && store.boardHeight > 0) {
      renderBaseboard(ctx, cam, rect.width, rect.height, store.boardWidth, store.boardHeight, store.unit, store.scalePreset)
    }

    // The gizmo is drawn last, on the selection anchor: section badges keep clear of it
    const gizmoAnchor = store.tool === 'select' && !store.isPlayMode ? getGizmoAnchor(store.network, store.selection) : null
    const gizmoScreen = gizmoAnchor
      ? {
          x: (gizmoAnchor.worldPos.x - cam.x) * cam.scale + rect.width / 2,
          y: (gizmoAnchor.worldPos.y - cam.y) * cam.scale + rect.height / 2,
        }
      : null
    const pendingNodeId = pendingPlacementNodeId(store)

    const networkOptions: RenderNetworkOptions = {
      tool: store.tool,
      gauge: store.gauge,
      gradient: store.gradientLimits,
      // Cant and slopes marked on the track: part of it, so they stay while driving — but for the plain view
      inclination: store.showInclination && !plainView ? { line: store.lineSettings } : undefined,
      // Driving: clean view, only the track (turnout positions included) and the trains
      ...(store.isPlayMode ? { hideConstructionNodes: true, hideSectionBadges: true } : {}),
      ...(plainView ? { hideSectionCenterline: true, hideSpeedZoneBands: true, plainRails: true } : {}),
      badgeExclusion: gizmoScreen ? gizmoFootprint(gizmoScreen) : undefined,
      quietNodeIds: pendingNodeId ? new Set([pendingNodeId]) : undefined,
      // Zones are only picked in the signalling mode; in its delete sub-mode the hovered one turns red
      speedZones: store.tool === 'signal' && !store.isPlayMode
        ? {
            selectedId: store.selectedSpeedZone?.id ?? null,
            // A signal under the cursor is what the click removes: the zone below it stays plain
            dangerId: store.signalToolSubMode === 'delete' && !store.hoveredSignalId ? store.hoveredSpeedZoneId : null,
          }
        : undefined,
      // Signals show everywhere; they are only picked, moved or removed in the signalling mode
      signals: {
        level: store.signallingLevel,
        gauge: store.gauge,
        line: store.lineSettings,
        state: store.isPlayMode ? store.signalling : null,
        selectedId: store.selectedSignal?.id ?? null,
        dangerId: store.tool === 'signal' && store.signalToolSubMode === 'delete' ? store.hoveredSignalId : null,
        showBlocks: store.signalBlocksVisible,
        showReservations: store.signalReservationsVisible,
        // Construction view only, and not with a signal tool in hand: the preview says enough then
        report: !store.isPlayMode && store.tool !== 'pan' && store.signalPlacementMode === null,
      },
    }

    // Driving aid: route ahead of the driven train and the turnout the steering keys throw
    const drawDrivingRoute = (): void => {
      if (!store.isPlayMode) return
      const driven = store.selectedTrain
      const loco = store.trains.length === 0 ? store.locomotive : null
      if (driven) {
        const routeStart = trainRouteStart(driven)
        if (routeStart) {
          renderDrivingRoute(ctx, cam, rect.width, rect.height, store.network, routeStart, driven.currentSpeed, store.unit)
        }
      } else if (loco) {
        // Same end and direction as the legacy steering (`findUpcomingJunction`)
        const routeStart = loco.direction === 1 ? loco.front : { ...loco.front, forward: !loco.front.forward }
        renderDrivingRoute(ctx, cam, rect.width, rect.height, store.network, routeStart, store.locomotiveCurrentSpeed, store.unit)
      }
    }

    // Trains on top of the track network. With `band` (bridges or tunnels in view): only the
    // vehicles standing on those track levels, so that the next level up can cover them.
    const lineSettings = store.lineSettings
    const drawTrains = (band?: LevelBand): void => {
      if (store.trains.length > 0) {
        for (const t of store.trains) {
          const isSelected = store.isTrainSelected && t.id === store.selectedTrainId
          const deleteVehicleId = (store.tool === 'locomotive' && store.trainToolSubMode === 'delete' && store.hoveredTrainDeleteVehicle?.train.id === t.id)
            ? store.hoveredTrainDeleteVehicle.vehicleId
            : null
          renderTrainSet(
            ctx,
            cam,
            rect.width,
            rect.height,
            store.network,
            t,
            isSelected,
            false,
            store.showTrainDebug,
            // The physics is only asked when its figures are drawn
            store.showTrainDebug
              ? { ...trainSetTelemetry(store.network, t, store.drivingEnvironment), debugOptions: store.trainDebugOptions }
              : { speed: t.currentSpeed, maxSpeed: t.maxSpeed, debugOptions: store.trainDebugOptions },
            isSelected ? store.selectedTrainVehicleId : null,
            deleteVehicleId,
            band,
            // The bodies lean with the cant and the speed (full size only)
            lineSettings,
            plainView,
          )
        }
      } else if (store.locomotive) {
        // The legacy consist is one block: it takes the level of the rail under its power car
        const level = vehicleLevel(store.network, store.locomotive)
        if (!inLevelBand(level, band)) return
        if (level < 0) {
          ctx.save()
          ctx.globalAlpha = TUNNEL_VEHICLE_ALPHA
        }
        const isDeleteHovered = store.tool === 'locomotive' && store.trainToolSubMode === 'delete' && store.hoveredTrainDeleteVehicle !== null
        renderLocomotive(ctx, cam, rect.width, rect.height, store.network, store.locomotive, false, store.showTrainDebug, store.isTrainSelected, {
          speed: store.locomotiveCurrentSpeed,
          maxSpeed: store.locomotiveMaxSpeed,
          throttle: store.locomotiveThrottle,
          acceleration: store.locomotiveAcceleration,
          braking: store.locomotiveBraking,
          debugOptions: store.trainDebugOptions,
        }, isDeleteHovered)
        if (level < 0) ctx.restore()
      }
    }

    // Network, driving route and trains: interleaved level by level when a bridge is in view
    renderNetworkWithTrains(
      ctx, cam, rect.width, rect.height, store.network, store.selection, store.sectionMeta,
      networkOptions, drawTrains, drawDrivingRoute,
    )

    // Render coupler points in coupling mode
    if (store.tool === 'coupling') {
      renderCouplerPoints(ctx, cam, rect.width, rect.height, store.couplerPoints, store.hoveredCouplerPoint)
    }

    // Ghost preview when placing a vehicle (locomotive or wagon)
    if ((store.draggingTrainItem || (store.tool === 'locomotive' && store.trainToolSubMode === 'place')) && !store.isPlayMode) {
      if (store.trainPlacementPreview) {
        renderTrainSet(
          ctx,
          cam,
          rect.width,
          rect.height,
          store.network,
          store.trainPlacementPreview,
          false,
          true, // isGhost
          store.showTrainDebug,
          undefined,
          null,
          null,
          undefined,
          // Leaning as the vehicle will once it is laid there
          store.lineSettings,
        )
      }
      if (store.couplerSnapTarget) {
        renderCouplerSnapIndicator(
          ctx,
          cam,
          rect.width,
          rect.height,
          store.couplerSnapTarget.couplerPos
        )
      }
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
      store.tool === 'measure' ||
      store.isSpeedZoneTool
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
      let distFromStart = 0
      if (nodeA) {
        const dx = nearest.x - nodeA.pos.x
        const dy = nearest.y - nodeA.pos.y
        distFromStart = Math.hypot(dx, dy)
      }
      const isIntCoord = Math.abs(Math.round(nearest.x) - nearest.x) < 1e-3 && Math.abs(Math.round(nearest.y) - nearest.y) < 1e-3
      const coordLabel = isIntCoord ? `[${Math.round(nearest.x)}, ${Math.round(nearest.y)}] ` : ''
      // The label only shows before the first click: once a placement is under way the single
      // text near the cursor is its dimension. Turnout and scissors draw their own hover label.
      if (!store.hasPendingPlacement && !store.speedZoneStart && store.tool !== 'turnout' && store.tool !== 'split') {
        ctx.font = '600 10px Archivo, system-ui, sans-serif'
        ctx.fillStyle = accent
        ctx.globalAlpha = 0.95
        ctx.textBaseline = 'bottom'
        ctx.textAlign = 'center'
        ctx.fillText(`${coordLabel}+${formatDistance(distFromStart, store.unit)}`, w2sX(nearest.x), w2sY(nearest.y) - 12)
      }
      ctx.restore()
    }

    // Place tool preview: rail from last node, snapped to Kato length or freeform
    const place = store.tool === 'place' ? resolvePlaceTool(store) : null
    if (place) {
      const { startNode, end: candidateEnd, length: snappedLen, isJoinNode, hitSegId } = place
      const isJoin = isJoinNode || hitSegId !== null
      // One text near the cursor: the dimension line, or this label when dimensions are off
      const prefix = store.trackMode === 'freeform' ? 'Flex ' : ''
      const joinSuffix = isJoinNode ? '  → Jonction' : hitSegId ? '  → Aiguillage sur voie' : ''
      const labelText = store.showDimensions ? '' : `${prefix}${formatDistance(snappedLen, store.unit)}${joinSuffix}`
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
      // (l'entraxe est affiché dans la barre contextuelle)
      const showParallelPreview = store.isParallelActive || isModifierDownRef.current
      if (showParallelPreview) {
        const dxp = candidateEnd.x - startNode.pos.x
        const dyp = candidateEnd.y - startNode.pos.y
        const lenp = Math.hypot(dxp, dyp)
        if (lenp > store.getMinTrackLength()) {
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
          renderPlacePreview(ctx, cam, rect.width, rect.height, secStart, secEnd, '', false)
          ctx.restore()
        }
      }
    }

    // Curve preview — UIC catalog piece or freeform tangent arc
    const cs = store.curveState
    if (cs.phase === 1 && cs.startId) {
      const cursor = store.snap ? store.snappedCursor : store.cursorWorld
      const res = resolveCurveTool(store, cs.startId, cursor)
      if (res) {
        const { startNode, geom } = res
        const { end, via, radius, angle, pieces } = geom
        const readout = describeCurve(store, cs.startId, res)

        // One text near the cursor: the refusal reason, else the dimension (or the label when
        // dimensions are off). The preview draws the same arc pieces the click will insert.
        const showDimension = store.showDimensions && !readout.refused
        const color = !geom.valid ? '#ef4444' : readout.onTrack ? '#10b981' : undefined
        renderCurvePreview(ctx, cam, rect.width, rect.height, pieces, showDimension ? '' : readout.text, geom.valid && readout.isJoin, color)

        if (showDimension) {
          renderCurveDimension(ctx, cam, rect.width, rect.height, startNode.pos, via, end, radius, angle, geom.length, store.unit)
        }

        if (geom.valid && (store.isParallelActive || isModifierDownRef.current)) {
          const parPieces = pieces.map((p) => computeParallelCurve(p.start, p.via, p.end, store.parallelOffset))
          const secStartNode = store.parallelLastNodeId ? store.network.nodes.get(store.parallelLastNodeId) : null
          if (secStartNode) parPieces[0] = { ...parPieces[0], start: secStartNode.pos }
          ctx.save()
          ctx.globalAlpha = 0.55
          renderCurvePreview(ctx, cam, rect.width, rect.height, parPieces, '', false)
          ctx.restore()
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
          const limits = store.getPlacementThresholds()
          const geom = computeFreeformParallelTurnout(startNode.pos, tangent, cursor, limits)
          if (geom) {
            // Below the minimum radius the turnout is refused on click: show it in red
            const previewRail = geom.valid ? railColor : '#ef4444'
            ctx.save()
            ctx.globalAlpha = 0.85
            // Real double steel rails for the 2 curved halves, drawn as the arc pieces that will be inserted:
            const turnoutPieces = [
              ...splitCurveIntoArcPieces(geom.startPos, geom.via1, geom.midPos),
              ...splitCurveIntoArcPieces(geom.midPos, geom.via2, geom.endPos),
            ]
            for (const p of turnoutPieces) {
              renderDetailedCurveRails(ctx, cam, p.start, p.via, p.end, rect.width, rect.height, false, previewRail, accent, 0, 0, '#ffffff', GAUGE)
            }
            ctx.globalAlpha = 1

            const p0x = (geom.startPos.x - cam.x) * cam.scale + rect.width / 2
            const p0y = (geom.startPos.y - cam.y) * cam.scale + rect.height / 2
            const pex = (geom.endPos.x - cam.x) * cam.scale + rect.width / 2
            const pey = (geom.endPos.y - cam.y) * cam.scale + rect.height / 2

            // Start turnout node & end node markers
            ctx.fillStyle = geom.valid ? '#10b981' : '#ef4444'
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
            const labelTxt = geom.valid
              ? `Espacement: ${formatDistance(Math.abs(geom.offset), store.unit)} · Longueur: ${formatDistance(geom.dx, store.unit)} (${formatRadius(geom.radius, store.unit)})`
              : `Rayon trop serré : ${formatRadius(geom.radius, store.unit)} (min ${formatRadius(limits.minRadius, store.unit)})`
            ctx.font = '600 11px Archivo, system-ui, sans-serif'
            const labelW = ctx.measureText(labelTxt).width
            const lx = pex + 14
            const ly = pey - 10
            ctx.fillStyle = geom.valid ? 'rgba(37, 99, 235, 0.85)' : 'rgba(239, 68, 68, 0.9)'
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

      const labelText = `${formatDistance(dist, store.unit)} · ${angleDeg.toFixed(1)}° (ΔX : ${formatDistance(Math.abs(dx), store.unit)}, ΔY : ${formatDistance(Math.abs(dy), store.unit)})`
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

    // 7. Speed limit tool preview: the start, the way to the cursor and its length (or why not)
    const zonePreview = store.isPlayMode ? null : resolveSpeedZoneTool(store)
    if (zonePreview) {
      const toScreen = (p: Point): Point => ({
        x: (p.x - cam.x) * cam.scale + rect.width / 2,
        y: (p.y - cam.y) * cam.scale + rect.height / 2,
      })
      const startWorld = positionOnSegment(store.network, zonePreview.start.segId, zonePreview.start.t)
      ctx.save()
      if (zonePreview.path) {
        ctx.strokeStyle = SPEED_ZONE_COLOR
        ctx.globalAlpha = 0.75
        ctx.lineWidth = 4
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.setLineDash([8, 6])
        ctx.beginPath()
        traceTrackSpans(ctx, cam, rect.width, rect.height, store.network, zonePreview.path.spans)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
      }
      if (startWorld) {
        const start = toScreen(startWorld)
        ctx.fillStyle = SPEED_ZONE_COLOR
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(start.x, start.y, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
      // One text near the cursor: the zone it would lay, or why the click would be refused
      const at = toScreen(store.hoverNodeId !== null || store.hoverSegSteps?.nearest ? store.snappedCursor : store.cursorWorld)
      const labelText = zonePreview.path
        ? `${zoneSpeedLabel(store.speedZoneToolSpeed)} · ${formatDistance(zonePreview.path.length, store.unit)}`
        : zonePreview.end ? 'Aucun chemin' : 'Hors voie'
      ctx.font = '600 11px Archivo, system-ui, sans-serif'
      const lw = ctx.measureText(labelText).width
      ctx.fillStyle = zonePreview.path ? 'rgba(15, 23, 42, 0.92)' : 'rgba(220, 38, 38, 0.92)'
      ctx.beginPath()
      ctx.roundRect(at.x - lw / 2 - 6, at.y - 34, lw + 12, 18, 4)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(labelText, at.x, at.y - 24)
      ctx.restore()
    }

    // 8. Signal tool preview: the signal under the cursor with its arrow and its two blocks, or the row being drawn
    renderSignalToolPreview(ctx, cam, rect.width, rect.height, store)

    // 2D Orthogonal Translation Gizmo on selected node(s) or selected section/track
    if (gizmoScreen) {
      renderTranslationGizmo(
        ctx,
        gizmoScreen,
        store.gizmoHoverAxis,
        store.gizmoDragAxis,
        {
          delta: store.gizmoDragDelta,
          angleDeg: store.gizmoRotateDelta,
          unit: store.unit,
          canvasWidth: rect.width,
          canvasHeight: rect.height,
        }
      )
    }

    // The scale bar keeps clear of the driving console and of the debug panel
    if (!plainView) {
      const { scaleBar } = arrangeConsole(rect.width, rect.height, store.consolePreference, store.isPlayMode, store.showTrainDebug).placement
      renderScaleBar(ctx, cam, rect.width, rect.height, scaleBar.right, scaleBar.bottom)
    }
  }, [store])

  // Every tool asks for a redraw after each change, often several times for one event (`redraw`
  // draws, then its notification draws again): the requests of a frame are merged into one paint.
  const pendingFrameRef = useRef<number | null>(null)
  const draw = useCallback(() => {
    if (pendingFrameRef.current !== null) return
    pendingFrameRef.current = requestAnimationFrame(() => {
      pendingFrameRef.current = null
      paint()
    })
  }, [paint])
  useEffect(() => {
    return () => {
      if (pendingFrameRef.current !== null) cancelAnimationFrame(pendingFrameRef.current)
      pendingFrameRef.current = null
    }
  }, [])

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
      // Resizing clears the canvas: painted at once, a frame of delay would show as a flash
      paint()
      store.setViewport(rect.width, rect.height)
      onViewport?.(rect.width, rect.height)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [paint, onViewport])

  // Subscribe to store notifications so external changes redraw the canvas
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

    // Free drag of the selected nodes: one rigid translation (snapped on the grabbed node),
    // curve control points follow through applyNodeTransform
    let dragPrimaryNodeId: string | null = null
    const dragSelectedNodes = (rawWorld: Point, dragStart: Point) => {
      const delta = { x: rawWorld.x - dragStart.x, y: rawWorld.y - dragStart.y }
      if (store.snap) {
        const primaryInit = (dragPrimaryNodeId ? store.draggedNodeInitialPositions.get(dragPrimaryNodeId) : undefined)
          ?? store.draggedNodeInitialPositions.values().next().value
        if (primaryInit) {
          const snapped = snapToGrid({ x: primaryInit.x + delta.x, y: primaryInit.y + delta.y }, getSnapSpacing())
          delta.x = snapped.x - primaryInit.x
          delta.y = snapped.y - primaryInit.y
        }
      }
      applyNodeTransform(store.network, store.draggedNodeInitialPositions, store.draggedViaInitialPositions, { kind: 'translate', delta })
      store.realignTrains()
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
          // The anchor follows the drag: subtract the applied delta to get its start position
          const primaryInitPos = anchor
            ? { x: anchor.worldPos.x - store.gizmoDragDelta.x, y: anchor.worldPos.y - store.gizmoDragDelta.y }
            : null
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
            applyNodeTransform(store.network, store.draggedNodeInitialPositions, store.draggedViaInitialPositions, { kind: 'translate', delta })
            store.realignTrains()
          }
        } else if (store.isDraggingNode && store.dragStartWorld) {
          dragSelectedNodes(rawWorld, store.dragStartWorld)
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

    const rightDragStart = { x: 0, y: 0 }
    let isRightDragging = false
    let hasRightMoved = false

    const onDown = (e: PointerEvent) => {
      if (e.button === 2) {
        store.closeContextMenu()
        rightDragStart.x = e.clientX
        rightDragStart.y = e.clientY
        hasRightMoved = false
        isRightDragging = true
        lastX = e.clientX
        lastY = e.clientY
        canvas.setPointerCapture(e.pointerId)
        stopEdgePan()
        return
      }

      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top

      // Priority 0: Check if click hit a 2D Gizmo translation/rotation handle on selected node or section
      if (e.button === 0 && store.tool === 'select') {
        const anchor = getGizmoAnchor(store.network, store.selection)
        if (anchor) {
          const sx = (anchor.worldPos.x - store.camera.x) * store.camera.scale + rect.width / 2
          const sy = (anchor.worldPos.y - store.camera.y) * store.camera.scale + rect.height / 2
          const hitAxis = hitTestGizmo({ x: px, y: py }, { x: sx, y: sy })
          if (hitAxis) {
            store.gizmoDragAxis = hitAxis
            store.gizmoDragDelta = { x: 0, y: 0 }
            store.gizmoRotateDelta = 0
            store.dragStartWorld = getWorldPos(e.clientX, e.clientY)
            store.pinTrains()
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
            canvas.style.cursor = hitAxis === 'x' ? 'ew-resize' : hitAxis === 'y' ? 'ns-resize' : 'crosshair'
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

      if (e.button === 0 && store.tool === 'coupling') {
        const world = getWorldPos(e.clientX, e.clientY)
        store.handleCouplingClick(world)
        redraw()
        return
      }

      if (e.button === 0 && store.tool === 'locomotive') {
        const world = getWorldPos(e.clientX, e.clientY)

        // While driving, a click never edits the trains: it only picks the train to drive
        if (store.isPlayMode) {
          const hitVehicle = store.findVehicleAt(world)
          // A spectator only chooses the train to watch: the phone keeps the one it drives
          if (hitVehicle && store.isSpectating) store.spectateTrain(hitVehicle.train.id)
          else if (hitVehicle) store.selectTrainById(hitVehicle.train.id, hitVehicle.vehicleId)
          redraw()
          return
        }

        // Delete mode: click deletes the hovered vehicle
        if (store.trainToolSubMode === 'delete') {
          const deleted = store.deleteVehicleAt(world)
          if (deleted) {
            store.updateTrainDeleteHover(world)
            canvas.style.cursor = store.hoveredTrainDeleteVehicle ? 'pointer' : 'crosshair'
          }
          redraw()
          return
        }

        // Select mode: click selects vehicle or train, clicking empty space deselects
        if (store.trainToolSubMode === 'select') {
          const hitVehicle = store.trains.length > 0 ? store.findVehicleAt(world) : null
          if (hitVehicle) {
            store.selectTrainById(hitVehicle.train.id, hitVehicle.vehicleId)
            store.selectTrain(true)
          } else {
            store.selectTrainById(null)
            store.selectTrain(false)
          }
          redraw()
          return
        }

        // Place mode:
        // 1. If snapped to the train in progress or to a magnetic coupler, place/couple immediately!
        if (store.couplerSnapTarget) {
          store.placeTrainItem(world)
          redraw()
          return
        }

        // 2. If clicking directly on an existing vehicle, select it
        const hitVehicle = store.trains.length > 0 ? store.findVehicleAt(world) : null
        if (hitVehicle) {
          store.selectTrainById(hitVehicle.train.id, hitVehicle.vehicleId)
          store.selectTrain(true)
          redraw()
          return
        }

        // 3. Place new vehicle on track
        if (!store.placeTrainItem(world)) showToast(TRAIN_PLACEMENT_REFUSED, 'warning')
        redraw()
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
          // No undo step for the start point alone: it is recorded with the curve
          if (!clickedNode) store.notePendingEdit((store.network.adjacency.get(startId)?.length ?? 0) > 0)
          redraw()
        } else if (cs.phase === 1 && cs.startId) {
          const cursor = store.snap ? store.snappedCursor : world
          const res = resolveCurveTool(store, cs.startId, cursor)
          // A curve below the minimum radius is shown as invalid by the preview and refused here
          if (res && res.geom.valid) {
            const { startNode, geom, endJoin } = res
            const endPos = geom.end

            // Auto-snap destination: connect to existing node if close (closes loops!)
            // Or if close to an existing segment, split that segment and connect to midNode!
            let endId: string
            // Only a curve ending in open space is chained; joining existing track ends the pose
            let endsInOpenSpace = false
            if (endJoin?.nodeId) {
              endId = endJoin.nodeId
            } else if (endJoin?.segId) {
              const splitRes = splitSegment(store.network, endJoin.segId, endPos)
              endId = splitRes ? splitRes.midNode.id : addNode(store.network, endPos, nodeLevel(startNode)).id
            } else {
              const endNode = addNode(store.network, endPos, nodeLevel(startNode))
              endId = endNode.id
              endsInOpenSpace = true
            }
            // Insert the curve as arc pieces, fitted to where the end node actually is
            const endNodePos = store.network.nodes.get(endId)?.pos ?? endPos
            const pieces = curvePiecesTo(geom, startNode.pos, endNodePos)
            addCurveChain(store.network, cs.startId, endId, pieces)

            const isParallelKey = e.shiftKey || e.ctrlKey || store.isParallelActive

            if (isParallelKey) {
              // Offset piece by piece: both tracks stay concentric and share their radial joints
              const parPieces = pieces.map((p) => computeParallelCurve(p.start, p.via, p.end, store.parallelOffset))
              let secStartId = store.parallelLastNodeId
              if (!secStartId) {
                const s2 = addNode(store.network, parPieces[0].start, nodeLevel(startNode))
                secStartId = s2.id
              }
              const endNode2 = addNode(store.network, parPieces[parPieces.length - 1].end, nodeLevel(store.network.nodes.get(endId)))

              addCurveChain(store.network, secStartId, endNode2.id, parPieces)

              store.parallelMode = true
              store.parallelLastNodeId = endNode2.id
            }

            store.reconcileNetwork()
            store.markDirty()
            store.clearNumericInput()
            if (endsInOpenSpace && store.network.nodes.has(endId)) {
              // Chain: the end of this curve is the start of the next one
              store.curveState = { phase: 1, startId: endId }
              store.lastNodeId = endId
              store.selection = { nodes: new Set([endId]), segments: new Set() }
            } else {
              store.curveState = { phase: 0, startId: null }
              store.lastNodeId = null
              store.parallelMode = false
              store.parallelLastNodeId = null
              store.selection = { nodes: new Set(), segments: new Set() }
            }
          }
          redraw()
        }
        return
      }

      if (e.button === 0 && store.tool === 'place') {
        const world = getWorldPos(e.clientX, e.clientY)
        const isParallelKey = e.shiftKey || e.ctrlKey || store.isParallelActive

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
                if (len > store.getMinTrackLength()) {
                  const ux = dx / len
                  const uy = dy / len
                  // Vecteur normal perpendiculaire (gauche)
                  const nx = -uy
                  const ny = ux
                  const off = store.parallelOffset

                  // Voie principale : lastNodeId -> snappedWorld
                  const endNode = addNode(store.network, snappedWorld, nodeLevel(startNode))
                  addSegment(store.network, store.lastNodeId, endNode.id)

                  // Voie secondaire : startNode+offset -> snappedWorld+offset
                  const startPos2 = { x: startNode.pos.x + nx * off, y: startNode.pos.y + ny * off }
                  const endPos2 = { x: snappedWorld.x + nx * off, y: snappedWorld.y + ny * off }
                  // Creer ou recuperer le noeud de depart secondaire
                  let startNodeId2 = store.parallelLastNodeId
                  if (!startNodeId2) {
                    const s2 = addNode(store.network, startPos2, nodeLevel(startNode))
                    startNodeId2 = s2.id
                  }
                  const endNode2 = addNode(store.network, endPos2, nodeLevel(startNode))
                  addSegment(store.network, startNodeId2, endNode2.id)

                  store.parallelMode = true
                  store.lastNodeId = endNode.id
                  store.parallelLastNodeId = endNode2.id
                  store.selection = { nodes: new Set([endNode.id, endNode2.id]), segments: new Set() }
                  store.reconcileNetwork()
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
              if (!clickedNode) store.notePendingEdit((store.network.adjacency.get(startNodeId)?.length ?? 0) > 0)
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
                if (len > store.getMinTrackLength()) {
                  const ux = dx / len
                  const uy = dy / len
                  const nx = -uy
                  const ny = ux
                  const off = store.parallelOffset

                  // Voie principale
                  const endNode = addNode(store.network, snappedWorld, nodeLevel(mainStart))
                  addSegment(store.network, store.lastNodeId, endNode.id)

                  // Voie secondaire (meme direction, decalee)
                  const endPos2 = { x: snappedWorld.x + nx * off, y: snappedWorld.y + ny * off }
                  const endNode2 = addNode(store.network, endPos2, nodeLevel(mainStart))
                  addSegment(store.network, store.parallelLastNodeId, endNode2.id)

                  store.lastNodeId = endNode.id
                  store.parallelLastNodeId = endNode2.id
                  store.selection = { nodes: new Set([endNode.id, endNode2.id]), segments: new Set() }
                  store.reconcileNetwork()
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
            store.reconcileNetwork()
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

            const typedLen = store.isNumericInputActive ? parseDistance(store.numericInput, store.unit) : NaN
            const hasTypedLen = !isNaN(typedLen) && typedLen > 0
            const minLen = store.getMinTrackLength()

            if (tangent) {
              dir = tangent
              const proj = dx * dir.x + dy * dir.y
              const dist = Math.max(minLen, proj)
              if (hasTypedLen) {
                snappedLen = typedLen
              } else if (store.trackMode === 'freeform') {
                snappedLen = store.snap ? Math.max(minLen, Math.round(dist * 10) / 10) : Math.max(minLen, dist)
              } else if (store.selectedStraightLength !== 'auto') {
                snappedLen = store.selectedStraightLength
              } else {
                snappedLen = snapStraightLength(dist)
              }
              endPos = computeStraightPiece(startNode.pos, dir, snappedLen)
            } else {
              if (store.trackMode === 'freeform' && !hasTypedLen) {
                const closeTarget = findNearestNode(store.network, snappedWorld, 16, store.camera)
                endPos = closeTarget && closeTarget.id !== store.lastNodeId ? closeTarget.pos : snappedWorld
              } else {
                const rawDist = Math.hypot(dx, dy)
                dir = rawDist > 0.01
                  ? (store.snap ? snapDirection({ x: dx / rawDist, y: dy / rawDist }, 15, 6) : { x: dx / rawDist, y: dy / rawDist })
                  : { x: 1, y: 0 }
                if (hasTypedLen) {
                  snappedLen = typedLen
                } else if (store.selectedStraightLength !== 'auto') {
                  snappedLen = store.selectedStraightLength
                } else {
                  snappedLen = store.snap ? snapStraightLength(rawDist) : Math.max(minLen, rawDist)
                }
                endPos = computeStraightPiece(startNode.pos, dir, snappedLen)
              }
            }

            const closeNode = findNearestNode(store.network, endPos, 16, store.camera)
            let endId: string
            // Only a rail ending in open space is chained; joining existing track ends the pose
            let endsInOpenSpace = false
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
                endId = splitRes ? splitRes.midNode.id : addNode(store.network, targetEnd, nodeLevel(startNode)).id
              } else {
                const endNode = addNode(store.network, endPos, nodeLevel(startNode))
                endId = endNode.id
                endsInOpenSpace = true
              }
            }
            addSegment(store.network, store.lastNodeId, endId)
            store.reconcileNetwork()
            store.clearNumericInput()
            store.markDirty()
            if (endsInOpenSpace && store.network.nodes.has(endId)) {
              // Chain: the end of this rail is the start of the next one
              store.lastNodeId = endId
              store.selection = { nodes: new Set([endId]), segments: new Set() }
            } else {
              store.lastNodeId = null
              store.selection = { nodes: new Set(), segments: new Set() }
            }
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
          // No undo step for the start point alone: it is recorded with the rail
          store.notePendingEdit(hitSegId !== null && (store.network.adjacency.get(startNodeId)?.length ?? 0) > 0)
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
            const limits = store.getPlacementThresholds()
            const geom = computeFreeformParallelTurnout(startNode.pos, tangent, cursor, limits)
            if (geom && geom.valid) {
              applyFreeformParallelTurnout(store.network, startNode.id, geom, limits.reconcileTolerance)
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
                // The cut is recorded with the turnout, so the whole pose is one undo step
                store.notePendingEdit(true)
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
        const success = performTrackCut(store.network, targetPos, 18 / store.camera.scale, store.getPlacementThresholds().detachGap)
        if (success) {
          store.reconcileNetwork()
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

      // Signalling mode: the speed limit tool lays a zone in two clicks; the two other sub-modes
      // pick or remove the zone under the cursor, and a click on nothing drags the view
      if (e.button === 0 && store.tool === 'signal' && !store.isPlayMode) {
        const world = getWorldPos(e.clientX, e.clientY)
        if (store.signalToolSubMode === 'speedZone') {
          store.cursorWorld = world
          clickSpeedZoneTool(store, speedZoneAim(store))
          redraw()
          return
        }
        // A signal tool: the button goes down on the track, a click lays one signal and a drag
        // along the track a row; off the track the drag moves the view
        if (store.signalPlacementMode) {
          store.cursorWorld = world
          if (store.beginSignalGesture(world)) {
            canvas.setPointerCapture(e.pointerId)
            stopEdgePan()
            redraw()
            return
          }
          store.panning = true
          lastX = e.clientX
          lastY = e.clientY
          store.moved = false
          canvas.setPointerCapture(e.pointerId)
          canvas.style.cursor = 'grabbing'
          stopEdgePan()
          redraw()
          return
        }
        // Signals come before the zones they stand on
        const signal = store.signalAt(world)
        if (signal) {
          if (store.signalToolSubMode === 'delete') {
            store.deleteSignal(signal.id)
          } else {
            store.selectSignal(signal.id)
            // Holding the button and moving slides it along the track
            if (store.beginSignalDrag(signal.id)) canvas.setPointerCapture(e.pointerId)
          }
          store.updateSignalHover(world)
          stopEdgePan()
          redraw()
          return
        }
        const zone = store.speedZoneAt(world)
        if (store.signalToolSubMode === 'delete') {
          if (zone) store.deleteSpeedZone(zone.id)
        } else {
          if (!zone) store.selectSignal(null)
          store.selectSpeedZone(zone?.id ?? null)
        }
        store.updateSpeedZoneHover(world)
        if (!zone) {
          store.panning = true
          lastX = e.clientX
          lastY = e.clientY
          store.moved = false
          canvas.setPointerCapture(e.pointerId)
          canvas.style.cursor = 'grabbing'
          stopEdgePan()
        }
        redraw()
        return
      }

      if (e.button === 0 && (store.trains.length > 0 || store.locomotive)) {
        const world = getWorldPos(e.clientX, e.clientY)
        if (store.trains.length > 0) {
          const hitVehicle = store.findVehicleAt(world)
          if (hitVehicle) {
            store.selectTrainById(hitVehicle.train.id, hitVehicle.vehicleId)
            store.selectTrain(true)
            // Clicking a train only selects it: never arm placement from a click on the canvas
            store.setTrainToolSubMode('select')
            redraw()
            return
          }
        } else if (store.locomotive && !store.isPlayMode) {
          const trainHit = store.checkTrainHover(world)
          if (trainHit.hit) {
            store.selectTrain(true)
            redraw()
            return
          }
        }
      }

      if (e.button === 0 && store.tool === 'select') {
        const isMulti = e.shiftKey || e.ctrlKey || e.metaKey
        const world = getWorldPos(e.clientX, e.clientY)
        const hitTol = 14 / store.camera.scale
        const nodeId = hitShownNode(store.network, store.selection, world, hitTol, store.camera.scale)
        if (nodeId) {
          const existingJunc = findJunctionAtNode(store.network, nodeId)
          if (existingJunc && store.selection.nodes.has(nodeId) && !isMulti) {
            if (!store.toggleActiveJunction(existingJunc.id, world)) showToast(store.junctionRefusalMessage, 'warning')
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
          dragPrimaryNodeId = nodeId
          store.pinTrains()
          store.draggedNodeInitialPositions.clear()
          for (const nid of store.selection.nodes) {
            const node = store.network.nodes.get(nid)
            if (node) {
              store.draggedNodeInitialPositions.set(nid, { ...node.pos })
            }
          }
          // Every curve touching a dragged node can be reshaped: snapshot them for the move and for cancel
          store.draggedViaInitialPositions = collectAffectedVias(store.network, store.draggedNodeInitialPositions.keys())
          canvas.setPointerCapture(e.pointerId)
          redraw()
          return
        }

        const segId = hitSegment(store.network, world, 12 / store.camera.scale)
        if (segId) {
          const sections = networkDerived(store.network, store.sectionMeta).sections
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

        // Empty click: Shift/Ctrl/Cmd + drag initiates box selection
        if (isMulti) {
          store.isBoxSelecting = true
          store.boxSelectStart = world
          store.boxSelectEnd = world
          canvas.setPointerCapture(e.pointerId)
          canvas.style.cursor = 'crosshair'
          redraw()
          return
        }

        // Natural Google Maps / CAD background drag: pan the canvas
        store.panning = true
        lastX = e.clientX
        lastY = e.clientY
        store.moved = false
        canvas.setPointerCapture(e.pointerId)
        canvas.style.cursor = 'grabbing'
        stopEdgePan()
        return
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

      // Right-drag universal pan (works across all tools without mode switching)
      if (isRightDragging) {
        const dx = e.clientX - lastX
        const dy = e.clientY - lastY
        if (Math.hypot(e.clientX - rightDragStart.x, e.clientY - rightDragStart.y) > 4) {
          hasRightMoved = true
          canvas.style.cursor = 'grabbing'
        }
        lastX = e.clientX
        lastY = e.clientY
        const cam = store.camera
        cam.x -= dx / cam.scale
        cam.y -= dy / cam.scale
        draw()
        // Only the camera moved: no panel has anything new to show
        store.notifyView()
        return
      }

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

      // Update train hover detection (for pilot button and inspection)
      if ((store.locomotive || store.trains.length > 0) && !store.isPlayMode) {
        store.checkTrainHover(rawWorld)
      }

      // Update coupler hover detection in coupling mode
      if (store.tool === 'coupling') {
        const nearest = store.findNearestCouplerAt(rawWorld)
        canvas.style.cursor = nearest ? 'pointer' : 'crosshair'
        redraw()
      }

      // Update train delete hover detection in delete mode
      if (store.tool === 'locomotive' && store.trainToolSubMode === 'delete') {
        store.updateTrainDeleteHover(rawWorld)
        canvas.style.cursor = store.hoveredTrainDeleteVehicle ? 'pointer' : 'crosshair'
        redraw()
      }

      // Update train ghost preview ONLY if actively dragging a train item
      if (store.draggingTrainItem && !store.isPlayMode) {
        store.updateTrainDrag(rawWorld, { x: e.clientX, y: e.clientY })
      }

      // Dragging along 2D Gizmo rotation
      if (store.gizmoDragAxis === 'rotate' && store.dragStartWorld) {
        const anchor = getGizmoAnchor(store.network, store.selection)
        if (anchor) {
          const snapAngle = store.snap && !e.shiftKey
          const { angleRad, angleDeg } = rotateGizmoDrag(anchor.worldPos, store.dragStartWorld, rawWorld, snapAngle, 15)
          store.gizmoRotateDelta = angleDeg

          // A single selected node pivots its track direction; several nodes rotate rigidly about the anchor
          applyNodeTransform(store.network, store.draggedNodeInitialPositions, store.draggedViaInitialPositions, {
            kind: 'rotate',
            center: anchor.worldPos,
            angleRad,
          })
          store.realignTrains()
        }
        draw()
        store.notify()
        return
      }

      // Dragging along 2D Gizmo axis (orthogonal constraint)
      if ((store.gizmoDragAxis === 'x' || store.gizmoDragAxis === 'y') && store.dragStartWorld) {
        const spacing = getSnapSpacing()
        const anchor = getGizmoAnchor(store.network, store.selection)
        // The anchor follows the drag: subtract the applied delta to get its start position
        const primaryInitPos = anchor
          ? { x: anchor.worldPos.x - store.gizmoDragDelta.x, y: anchor.worldPos.y - store.gizmoDragDelta.y }
          : null

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

          applyNodeTransform(store.network, store.draggedNodeInitialPositions, store.draggedViaInitialPositions, { kind: 'translate', delta })
          store.realignTrains()
        }

        draw()
        store.notify()
        return
      }

      // Gizmo arrow hover detection on selected node or section
      if (store.tool === 'select' && !store.panning && !store.isDraggingNode && !store.gizmoDragAxis) {
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
          } else if (hoveredAxis === 'rotate') {
            canvas.style.cursor = 'crosshair'
            return
          } else if (canvas.style.cursor === 'ew-resize' || canvas.style.cursor === 'ns-resize' || canvas.style.cursor === 'crosshair') {
            canvas.style.cursor = isSpaceDown ? 'grab' : ''
          }
        }
      } else if (store.gizmoHoverAxis !== null) {
        store.gizmoHoverAxis = null
        if (canvas.style.cursor === 'ew-resize' || canvas.style.cursor === 'ns-resize' || canvas.style.cursor === 'crosshair') {
          canvas.style.cursor = isSpaceDown ? 'grab' : ''
        }
        draw()
      }

      // Signalling mode: a row of signals being drawn, or a signal being slid along the track
      if (store.signalRowStart) {
        store.updateSignalGesture(rawWorld)
        draw()
        store.notify()
        return
      }
      if (store.signalDrag) {
        store.dragSignalTo(rawWorld)
        canvas.style.cursor = 'grabbing'
        draw()
        store.notify()
        return
      }

      // Dragging selected nodes in select tool
      if (store.isDraggingNode && store.dragStartWorld) {
        dragSelectedNodes(rawWorld, store.dragStartWorld)
        draw()
        store.notify()
        return
      }

      const isConstructionTool =
        store.tool === 'place' ||
        store.tool === 'curve' ||
        store.tool === 'turnout' ||
        store.tool === 'split' ||
        store.tool === 'measure' ||
        store.isSpeedZoneTool

      if (!isConstructionTool) {
        // En mode sélection (V) ou déplacement de vue (H) : aucun point de pose/snap de construction
        store.hoverSegSteps = null
        store.hoverNodeId = null
        store.snappedCursor = rawWorld

        // Signalling mode, select and delete sub-modes: the zone under the cursor can be clicked
        if (store.tool === 'signal' && !store.isPlayMode && !store.panning) {
          const signalChanged = store.updateSignalHover(rawWorld)
          const changed = store.updateSpeedZoneHover(rawWorld) || signalChanged
          canvas.style.cursor = store.signalPlacementMode
            ? 'crosshair'
            : store.hoveredSignalId
              ? (store.signalToolSubMode === 'select' ? 'grab' : 'pointer')
              : store.hoveredSpeedZoneId ? 'pointer' : isSpaceDown ? 'grab' : ''
          if (changed) draw()
        }

        // Feedback curseur survol sur les éléments sélectionnables
        if (store.tool === 'select' && !store.panning && !store.isDraggingNode && !store.gizmoDragAxis && !store.gizmoHoverAxis) {
          const hitTol = 14 / store.camera.scale
          const hoveredNodeId = hitShownNode(store.network, store.selection, rawWorld, hitTol, store.camera.scale)
          const hoveredSegId = hitSegment(store.network, rawWorld, 12 / store.camera.scale)
          const hoveredVehicle = store.trains.length > 0 ? store.findVehicleAt(rawWorld) : null
          if (hoveredNodeId || hoveredSegId || hoveredVehicle) {
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
            const { points, nearest } = getStepPointsAlongSegment(hitSegId, store.network, spacing, rawWorld, store.getPlacementThresholds().stepMargin)
            store.hoverSegSteps = { segId: hitSegId, points, nearest }
            if (nearest) {
              store.snappedCursor = { ...nearest }
            } else {
              store.snappedCursor = rawWorld
            }
          } else {
            store.hoverSegSteps = null
            if (isCurvePhase1 && store.curveState.startId) {
              const res = resolveCurveTool(store, store.curveState.startId, rawWorld)
              if (res && res.trackTarget) {
                const { geom, trackTarget } = res
                if (geom.kind === 'lock' && geom.valid) {
                  const dLock = Math.hypot(rawWorld.x - geom.end.x, rawWorld.y - geom.end.y) * store.camera.scale
                  if (dLock < 120) {
                    store.snappedCursor = { ...geom.end }
                  } else {
                    store.snappedCursor = { ...trackTarget.pointOnTrack }
                  }
                } else {
                  store.snappedCursor = { ...trackTarget.pointOnTrack }
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
          store.isSpeedZoneTool ||
          store.signalPlacementMode !== null ||
          store.tool === 'locomotive' ||
          store.hoverSegSteps !== null
        ) {
          if (store.tool === 'locomotive') {
            if (store.trainToolSubMode === 'delete') {
              store.updateTrainDeleteHover(rawWorld)
              canvas.style.cursor = store.hoveredTrainDeleteVehicle ? 'pointer' : 'crosshair'
            } else {
              store.updateLocomotivePreview(rawWorld)
            }
          }
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
      // Panning moves the camera alone; a train item dragged over the canvas is followed by the panels
      if (store.draggingTrainItem) store.notify()
      else store.notifyView()
    }

    const onUp = (e: PointerEvent) => {
      // Handle right drag pan / right click
      if (isRightDragging || e.button === 2) {
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId)
        }
        isRightDragging = false
        canvas.style.cursor = isSpaceDown ? 'grab' : ''
        if (!hasRightMoved) {
          // Short right-click -> Open context menu or cancel placement
          const world = getWorldPos(e.clientX, e.clientY)
          const hitTol = 14 / store.camera.scale
          const nodeId = hitNode(store.network, world, hitTol)
          const segId = hitSegment(store.network, world, 12 / store.camera.scale)
          const junc = nodeId ? findJunctionAtNode(store.network, nodeId) : (segId ? findJunctionBySegment(store.network, segId) : null)

          if (junc) {
            store.openContextMenu(e.clientX, e.clientY, { type: 'junction', id: junc.id, worldPos: world })
          } else if (nodeId) {
            store.openContextMenu(e.clientX, e.clientY, { type: 'node', id: nodeId, worldPos: world })
          } else if (segId) {
            store.openContextMenu(e.clientX, e.clientY, { type: 'segment', id: segId, worldPos: world })
          } else {
            if (store.hasPendingPlacement || store.measureStart || store.speedZoneStart || store.signalRowStart || store.signalDrag) {
              store.cancelInteraction()
            } else {
              store.openContextMenu(e.clientX, e.clientY, { type: 'canvas', worldPos: world })
            }
          }
        }
        redraw()
        return
      }

      // Finalize train item drag and drop
      if (store.draggingTrainItem) {
        const rawWorld = getWorldPos(e.clientX, e.clientY)
        store.endTrainDrag(rawWorld)
        redraw()
        return
      }

      // Signalling mode: the button comes up on a signal tool (one signal, or a row) or on a dragged signal
      if (store.signalRowStart || store.signalDrag) {
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
        if (store.signalRowStart) commitSignalGesture(store)
        else store.endSignalDrag()
        canvas.style.cursor = isSpaceDown ? 'grab' : ''
        redraw()
        return
      }

      // Finalize gizmo axis / rotation dragging
      if (store.gizmoDragAxis) {
        const moved =
          Math.abs(store.gizmoDragDelta.x) > 1e-4 ||
          Math.abs(store.gizmoDragDelta.y) > 1e-4 ||
          Math.abs(store.gizmoRotateDelta) > 1e-4
        store.gizmoDragAxis = null
        store.gizmoDragDelta = { x: 0, y: 0 }
        store.gizmoRotateDelta = 0
        store.dragStartWorld = null
        store.unpinTrains()
        store.draggedNodeInitialPositions.clear()
        store.draggedViaInitialPositions.clear()
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId)
        }
        canvas.style.cursor = isSpaceDown ? 'grab' : ''
        if (moved) {
          store.reconcileNetwork()
          store.markDirty()
        }
        redraw()
        return
      }

      // Finalize node dragging
      if (store.isDraggingNode) {
        // A plain click on a node moves nothing: no reconcile and no undo step for it
        let moved = false
        for (const [nid, initPos] of store.draggedNodeInitialPositions) {
          const node = store.network.nodes.get(nid)
          if (node && (node.pos.x !== initPos.x || node.pos.y !== initPos.y)) {
            moved = true
            break
          }
        }
        store.isDraggingNode = false
        store.dragStartWorld = null
        store.unpinTrains()
        store.draggedNodeInitialPositions.clear()
        store.draggedViaInitialPositions.clear()
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId)
        }
        if (moved) {
          store.reconcileNetwork()
          store.markDirty()
        }
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
      const wasPanning = store.panning
      store.panning = false
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId)
      }
      canvas.style.cursor = isSpaceDown ? 'grab' : ''

      if (wasPanning && !store.moved && e.button === 0 && store.tool === 'select') {
        store.selection = { nodes: new Set(), segments: new Set() }
        if (store.isTrainSelected && !store.isPlayMode) {
          store.selectTrain(false)
          store.selectTrainById(null)
        }
        redraw()
      }
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

      // Two-finger trackpad slide pans; mouse wheel and trackpad pinch zoom
      if (wheelIntent(e) === 'pan') {
        cam.x += e.deltaX / cam.scale
        cam.y += e.deltaY / cam.scale
      } else {
        // Natural Google Maps / CAD zoom centered on cursor
        const worldX = cam.x + (px - vw / 2) / cam.scale
        const worldY = cam.y + (py - vh / 2) / cam.scale

        let dy = e.deltaY
        if (e.deltaMode === 1) dy *= 33 // DOM_DELTA_LINE
        else if (e.deltaMode === 2) dy *= 600 // DOM_DELTA_PAGE

        // Normalize zoom factor: ~15% zoom per mouse wheel notch, smooth exponential for trackpad pinch
        const isTrackpadPinch = e.ctrlKey || e.metaKey
        const zoomDelta = -dy * (isTrackpadPinch ? 0.008 : 0.0016)
        const factor = Math.exp(Math.max(-0.4, Math.min(0.4, zoomDelta)))
        cam.scale = clampScale(cam.scale * factor)

        cam.x = worldX - (px - vw / 2) / cam.scale
        cam.y = worldY - (py - vh / 2) / cam.scale
      }

      const world = getWorldPos(e.clientX, e.clientY)
      if (store.snap) {
        const spacing = getSnapSpacing()
        store.snappedCursor = snapToGrid(world, spacing)
      } else {
        store.snappedCursor = world
      }

      if (store.tool === 'locomotive') {
        if (store.trainToolSubMode === 'delete') {
          store.updateTrainDeleteHover(world)
          canvas.style.cursor = store.hoveredTrainDeleteVehicle ? 'pointer' : 'crosshair'
        } else {
          store.updateLocomotivePreview(world)
        }
        draw()
        store.notify()
        return
      }

      // The camera and the snap point under the cursor, which only the canvas draws: no panel has
      // anything new to show
      draw()
      store.notifyView()
    }

    const onContextMenu = (e: Event) => e.preventDefault()

    const onDblClick = (e: MouseEvent) => {
      const world = getWorldPos(e.clientX, e.clientY)
      const hitTol = 14 / store.camera.scale
      const segId = hitSegment(store.network, world, hitTol)
      if (segId) {
        const sections = networkDerived(store.network, store.sectionMeta).sections
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
      if (store.locomotivePreview || store.trainPlacementPreview || store.couplerSnapTarget || store.hoveredTrainDeleteVehicle) {
        store.locomotivePreview = null
        store.trainPlacementPreview = null
        store.couplerSnapTarget = null
        store.hoveredTrainDeleteVehicle = null
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
    const onGlobalPointerMove = (e: PointerEvent) => {
      if (store.draggingTrainItem) {
        const rawWorld = getWorldPos(e.clientX, e.clientY)
        store.updateTrainDrag(rawWorld, { x: e.clientX, y: e.clientY })
        redraw()
      }
    }

    const onGlobalPointerUp = (e: PointerEvent) => {
      if (store.draggingTrainItem) {
        const rawWorld = getWorldPos(e.clientX, e.clientY)
        store.endTrainDrag(rawWorld)
        redraw()
      }
    }

    const onCommitNumeric = () => {
      if (store.tool === 'place' && store.lastNodeId && store.isNumericInputActive) {
        // The length is typed in the display unit
        const val = parseDistance(store.numericInput, store.unit)
        if (val > 0) {
          const startNode = store.network.nodes.get(store.lastNodeId)
          if (startNode) {
            const cursor = store.snap ? store.snappedCursor : store.cursorWorld
            const tangent = getTangentForPlacement(store.network, store.lastNodeId, cursor)
            let dir: Point
            if (tangent) {
              dir = tangent
            } else {
              const dx = cursor.x - startNode.pos.x
              const dy = cursor.y - startNode.pos.y
              const rawDist = Math.hypot(dx, dy)
              dir = rawDist > 0.01 ? { x: dx / rawDist, y: dy / rawDist } : { x: 1, y: 0 }
            }
            const endPos = computeStraightPiece(startNode.pos, dir, val)
            const closeNode = findNearestNode(store.network, endPos, 16, store.camera)
            let endId: string
            let endsInOpenSpace = false
            if (closeNode && closeNode.id !== store.lastNodeId) {
              endId = closeNode.id
            } else {
              const hitTol = 16 / store.camera.scale
              const hitSegId = hitSegment(store.network, endPos, hitTol)
              if (hitSegId) {
                const splitRes = splitSegment(store.network, hitSegId, endPos)
                endId = splitRes ? splitRes.midNode.id : addNode(store.network, endPos, nodeLevel(startNode)).id
              } else {
                const endNode = addNode(store.network, endPos, nodeLevel(startNode))
                endId = endNode.id
                endsInOpenSpace = true
              }
            }
            addSegment(store.network, store.lastNodeId, endId)
            store.reconcileNetwork()
            store.markDirty()
            if (endsInOpenSpace && store.network.nodes.has(endId)) {
              // Chain, like a click: the end of this rail is the start of the next one
              store.lastNodeId = endId
              store.selection = { nodes: new Set([endId]), segments: new Set() }
            } else {
              store.lastNodeId = null
              store.selection = { nodes: new Set(), segments: new Set() }
            }
            store.clearNumericInput()
            redraw()
          }
        }
      } else if (store.tool === 'curve' && store.curveState.startId && store.isNumericInputActive) {
        const val = parseFloat(store.numericInput)
        if (!isNaN(val) && val > 0) {
          store.setSelectedCurveRadius(val)
          store.clearNumericInput()
          redraw()
        }
      }
    }

    window.addEventListener('rail:commit-numeric-placement', onCommitNumeric)
    window.addEventListener('pointermove', onGlobalPointerMove)
    window.addEventListener('pointerup', onGlobalPointerUp)

    return () => {
      stopEdgePan()
      window.removeEventListener('rail:commit-numeric-placement', onCommitNumeric)
      window.removeEventListener('keydown', handleKeyChange)
      window.removeEventListener('keyup', handleKeyChange)
      window.removeEventListener('pointermove', onGlobalPointerMove)
      window.removeEventListener('pointerup', onGlobalPointerUp)
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
      <canvas
        ref={canvasRef}
        className={`tool-${store.tool}${store.tool === 'signal' ? ` signal-${store.signalToolSubMode}` : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          const world = getWorldPos(e.clientX, e.clientY)
          store.cursorWorld = world
          store.updateTrainDrag(world, { x: e.clientX, y: e.clientY })
          redraw()
        }}
        onDrop={(e) => {
          e.preventDefault()
          const itemType = (e.dataTransfer.getData('application/open-rails-train') ||
            e.dataTransfer.getData('text/plain')) as 'tgv_loco' | 'tgv_wagon'
          const world = getWorldPos(e.clientX, e.clientY)
          if (itemType === 'tgv_loco' || itemType === 'tgv_wagon') {
            if (!store.handleDropTrainItem(itemType, world)) showToast(TRAIN_PLACEMENT_REFUSED, 'warning')
            redraw()
          }
        }}
      />

      {renamingSection && (
        <div
          style={{
            position: 'absolute',
            left: `${renamingSection.x}px`,
            top: `${renamingSection.y}px`,
            transform: 'translate(-50%, -120%)',
            background: 'var(--panel)',
            border: '1px solid var(--accent)',
            boxShadow: 'var(--shadow)',
            borderRadius: '6px',
            padding: '8px 10px',
            zIndex: 'var(--z-popover)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            minWidth: '220px',
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ink)', opacity: 0.7 }}>
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
                background: 'var(--paper)',
                color: 'var(--ink)',
                border: '1px solid var(--border)',
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
                  border: '1px solid var(--border)',
                  borderRadius: '3px',
                  color: 'var(--ink)',
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
                  background: 'var(--accent)',
                  border: 'none',
                  borderRadius: '3px',
                  color: 'var(--accent-fg)',
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
