import { useCallback, useEffect, useRef, useState } from 'react'
import { clampScale, screenToWorld, type Camera } from '../render/camera'
import {
  renderGrid,
  renderNetwork,
  renderScaleBar,
  renderDetailedCurveRails,
  renderDetailedRailLines,
  pickSpacing,
  SIMPLIFY_THRESHOLD,
} from '../render/renderer'
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
import { curveLength, bezierPoint } from '@domain/geometry/curve'
import { getTangentForPlacement } from '@domain/geometry/tangent'
import {
  snapStraightLength,
  computeStraightPiece,
  computeCurvePiece,
  computeFreeformCurve,
} from '@domain/profiles/profiles'
import {
  splitSegment,
  findJunctionAtNode,
  toggleJunction,
} from '@domain/models/junction'
import { reconcileNetworkIntersections } from '@domain/geometry/reconcile'
import { computeTrackSections, findSectionBySegment } from '@domain/models/sections'
import type { EditorStore } from './store'

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
    renderDetailedRailLines(ctx, cam, start, snappedEnd, vw, vh, false, railColor, accent)
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

  // Curve preview
  if (cam.scale < SIMPLIFY_THRESHOLD) {
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.moveTo(w2sX(start.x), w2sY(start.y))
    ctx.quadraticCurveTo(w2sX(via.x), w2sY(via.y), w2sX(end.x), w2sY(end.y))
    ctx.stroke()
    ctx.setLineDash([])
  } else {
    ctx.globalAlpha = 0.85
    renderDetailedCurveRails(ctx, cam, start, via, end, vw, vh, false, railColor, accent)
    ctx.globalAlpha = 1
  }

  // End node marker / snap indicator
  if (isClosedToNode) {
    ctx.strokeStyle = '#10b981'
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.arc(w2sX(end.x), w2sY(end.y), 8, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Label near end
  ctx.font = '600 11px Archivo, system-ui, sans-serif'
  const labelW = ctx.measureText(labelText).width
  const lx = w2sX(end.x) + 14
  const ly = w2sY(end.y) - 10

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

interface CanvasProps {
  store: EditorStore
  /** Called with viewport dimensions on resize; used by parent for fit-view etc. */
  onViewport?: (w: number, h: number) => void
}

export function Canvas({ store, onViewport }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

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
    renderNetwork(ctx, cam, rect.width, rect.height, store.network, store.selection, store.sectionMeta)

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

    // Snap indicator (Place and Curve tools)
    if (store.tool === 'place' || store.tool === 'curve') {
      const isNode = store.hoverNodeId !== null
      if (isNode || store.snap) {
        renderSnapIndicator(ctx, cam, rect.width, rect.height, store.snappedCursor, isNode)
      }
    }

    // Shift+Survol : affichage des pas de grille sur la voie survole
    if (store.hoverSegSteps) {
      const { points, nearest } = store.hoverSegSteps
      const accent = getComputedStyle(ctx.canvas).getPropertyValue('--accent').trim() || '#2563eb'
      const w2sX = (wx: number) => (wx - cam.x) * cam.scale + rect.width / 2
      const w2sY = (wy: number) => (wy - cam.y) * cam.scale + rect.height / 2
      ctx.save()
      // Tous les pas : petits cercles bleus semi-transparents
      ctx.fillStyle = accent
      ctx.globalAlpha = 0.35
      for (const p of points) {
        const r = Math.max(3, Math.min(7, cam.scale * 0.8))
        ctx.beginPath()
        ctx.arc(w2sX(p.x), w2sY(p.y), r, 0, Math.PI * 2)
        ctx.fill()
      }
      // Pas le plus proche : cercle plein + anneau
      if (nearest) {
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
        // Label distance
        const dx = nearest.x - (store.network.nodes.get(store.network.segments.get(store.hoverSegSteps.segId)?.from ?? '')?.pos.x ?? 0)
        const dy = nearest.y - (store.network.nodes.get(store.network.segments.get(store.hoverSegSteps.segId)?.from ?? '')?.pos.y ?? 0)
        const distFromStart = Math.hypot(dx, dy).toFixed(1)
        ctx.font = '600 10px Archivo, system-ui, sans-serif'
        ctx.fillStyle = accent
        ctx.globalAlpha = 0.9
        ctx.textBaseline = 'bottom'
        ctx.textAlign = 'center'
        ctx.fillText(`+${distFromStart} m`, w2sX(nearest.x), w2sY(nearest.y) - 12)
      }
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

        if (tangent) {
          dir = tangent
          const proj = dx * dir.x + dy * dir.y
          const dist = Math.max(10, proj)
          if (store.trackMode === 'freeform') {
            snappedLen = Math.max(10, Math.round(dist))
          } else if (store.selectedStraightLength !== 'auto') {
            snappedLen = store.selectedStraightLength
          } else {
            snappedLen = snapStraightLength(dist)
          }
          candidateEnd = computeStraightPiece(startNode.pos, dir, snappedLen)
        } else {
          if (store.trackMode === 'freeform') {
            candidateEnd = cursor
            snappedLen = Math.max(10, Math.round(Math.hypot(dx, dy)))
          } else {
            const dist = Math.hypot(dx, dy)
            dir = dist > 1 ? snapDirection({ x: dx / dist, y: dy / dist }, 15, 6) : { x: 1, y: 0 }
            if (store.selectedStraightLength !== 'auto') {
              snappedLen = store.selectedStraightLength
            } else {
              snappedLen = snapStraightLength(dist)
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
        const layerLabel = store.activePlacementLayer !== 0
          ? `  | ${store.activePlacementLayer > 0 ? `Pont (+${store.activePlacementLayer})` : `Tunnel (${store.activePlacementLayer})`}`
          : ''
        const startZ = startNode.z ?? startNode.pos.z ?? 0
        const endZ = closeNode ? (closeNode.z ?? closeNode.pos.z ?? 0) : store.activePlacementAltitude
        const deltaZ = endZ - startZ
        const slopePermil = snappedLen > 0 ? (deltaZ / snappedLen) * 1000 : 0
        const slopeLabel = Math.abs(slopePermil) >= 0.5
          ? `  | ${slopePermil > 0 ? '▲' : '▼'} ${Math.abs(slopePermil).toFixed(1)}‰ (ΔZ ${deltaZ > 0 ? '+' : ''}${deltaZ.toFixed(1)}m)`
          : ''
        const labelText = `${prefix}${snappedLen.toFixed(2)} m${joinSuffix}${modeLabel}${layerLabel}${slopeLabel}`
        renderPlacePreview(ctx, cam, rect.width, rect.height, startNode.pos, candidateEnd, labelText, isJoin)

        // Preview de la voie secondaire parallele si mode double voie actif
        if (store.parallelMode) {
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
            renderPlacePreview(ctx, cam, rect.width, rect.height, secStart, secEnd, '', false)
            ctx.restore()
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
        const tangent = getTangentForPlacement(store.network, cs.startId, cursor) ?? (() => {
          const dx = cursor.x - startNode.pos.x
          const dy = cursor.y - startNode.pos.y
          const len = Math.hypot(dx, dy)
          return len > 1 ? snapDirection({ x: dx / len, y: dy / len }, 15, 6) : { x: 1, y: 0 }
        })()

        if (store.trackMode === 'freeform') {
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
          const startZ = startNode.z ?? startNode.pos.z ?? 0
          const endZ = closeNode ? (closeNode.z ?? closeNode.pos.z ?? 0) : store.activePlacementAltitude
          const deltaZ = endZ - startZ
          const slopePermil = len > 0 ? (deltaZ / len) * 1000 : 0
          const slopeLabel = Math.abs(slopePermil) >= 0.5
            ? `  | ${slopePermil > 0 ? '▲' : '▼'} ${Math.abs(slopePermil).toFixed(1)}‰ (ΔZ ${deltaZ > 0 ? '+' : ''}${deltaZ.toFixed(1)}m)`
            : ''
          const labelText = radius === Infinity
            ? `Flex ${len.toFixed(2)} m${joinSuffix}${slopeLabel}`
            : `Flex ${sideLabel} R${radius.toFixed(2)} m  ${angle.toFixed(2)}° (${len.toFixed(2)} m)${joinSuffix}${slopeLabel}`
          renderCurvePreview(ctx, cam, rect.width, rect.height, startNode.pos, via, end, labelText, isJoin)
        } else {
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
          const startZ = startNode.z ?? startNode.pos.z ?? 0
          const endZ = closeNode ? (closeNode.z ?? closeNode.pos.z ?? 0) : store.activePlacementAltitude
          const deltaZ = endZ - startZ
          const slopePermil = len > 0 ? (deltaZ / len) * 1000 : 0
          const slopeLabel = Math.abs(slopePermil) >= 0.5
            ? `  | ${slopePermil > 0 ? '▲' : '▼'} ${Math.abs(slopePermil).toFixed(1)}‰ (ΔZ ${deltaZ > 0 ? '+' : ''}${deltaZ.toFixed(1)}m)`
            : ''
          const labelText = `Courbe ${sideLabel} R${radius.toFixed(2)} m  ${angle.toFixed(2)}° (${len.toFixed(2)} m)${joinSuffix}${slopeLabel}`
          renderCurvePreview(ctx, cam, rect.width, rect.height, startNode.pos, via, end, labelText, isJoin)
        }
      }
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

    const onDown = (e: PointerEvent) => {
      if (e.button === 2) {
        // Right click: cancel placement chain or curve
        store.lastNodeId = null
        store.curveState = { phase: 0, startId: null }
        redraw()
        return
      }

      if (e.button === 1 || (e.button === 0 && (e.shiftKey || store.tool === 'pan'))) {
        // Middle click, shift+click, or pan tool: pan
        store.panning = true
        lastX = e.clientX
        lastY = e.clientY
        store.moved = false
        canvas.setPointerCapture(e.pointerId)
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
            const hitSegId = hitSegment(store.network, world, hitTol)
            if (hitSegId) {
              const splitRes = splitSegment(store.network, hitSegId, world)
              startId = splitRes ? splitRes.midNode.id : addNode(store.network, world).id
            } else {
              const spacing = getSnapSpacing()
              const pos = store.snap ? snapToGrid(world, spacing) : world
              const node = addNode(store.network, pos)
              node.z = store.activePlacementAltitude
              node.pos.z = store.activePlacementAltitude
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
            const tangent = getTangentForPlacement(store.network, cs.startId, world) ?? (() => {
              const dx = world.x - startNode.pos.x
              const dy = world.y - startNode.pos.y
              const len = Math.hypot(dx, dy)
              return len > 1 ? snapDirection({ x: dx / len, y: dy / len }, 15, 6) : { x: 1, y: 0 }
            })()

            let endPos: Point
            let viaPos: Point

            if (store.trackMode === 'freeform') {
              const spacing = getSnapSpacing()
              const snappedWorld = store.snap ? snapToGrid(world, spacing) : world
              const closeTarget = findNearestNode(store.network, snappedWorld, 16, store.camera)
              const target = closeTarget && closeTarget.id !== cs.startId ? closeTarget.pos : snappedWorld
              const curve = computeFreeformCurve(startNode.pos, tangent, target)
              endPos = curve.end
              viaPos = curve.via
            } else {
              const radius = store.selectedCurveRadius
              const angle = store.selectedCurveAngle
              const side = store.autoCurveSide ? computeSide(tangent, startNode.pos, world) : store.curveSide
              const curve = computeCurvePiece(startNode.pos, tangent, radius, side, angle)
              endPos = curve.end
              viaPos = curve.via
            }

            // Auto-snap destination: connect to existing node if close (closes loops!)
            // Or if close to an existing segment, split that segment and connect to midNode!
            const closeNode = findNearestNode(store.network, endPos, 16, store.camera)
            let endId: string
            if (closeNode && closeNode.id !== cs.startId) {
              endId = closeNode.id
            } else {
              const hitTol = 16 / store.camera.scale
              const hitSegId = hitSegment(store.network, endPos, hitTol)
              if (hitSegId) {
                const splitRes = splitSegment(store.network, hitSegId, endPos)
                endId = splitRes ? splitRes.midNode.id : addNode(store.network, endPos).id
              } else {
                const endNode = addNode(store.network, endPos)
                endNode.z = store.activePlacementAltitude
                endNode.pos.z = store.activePlacementAltitude
                endId = endNode.id
              }
            }
            const newCurveSeg = addCurveSegment(store.network, cs.startId, endId, viaPos)
            if (newCurveSeg && store.activePlacementLayer !== 0) {
              newCurveSeg.layer = store.activePlacementLayer
              if (store.activePlacementLayer > 0) newCurveSeg.overpass = true
            }
            reconcileNetworkIntersections(store.network)
            store.markDirty()
            // Finish curve: release cursor so it does not auto-continue
            store.curveState = { phase: 0, startId: null }
            store.lastNodeId = null
            store.selection = { nodes: new Set([endId]), segments: new Set() }
          }
          redraw()
        }
        return
      }

      if (e.button === 0 && store.tool === 'place') {
        const world = getWorldPos(e.clientX, e.clientY)

        // Shift+Click: mode double-voie parallele
        if (e.shiftKey) {
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
                  endNode.z = store.activePlacementAltitude
                  endNode.pos.z = store.activePlacementAltitude
                  const sMain = addSegment(store.network, store.lastNodeId, endNode.id)
                  if (sMain && store.activePlacementLayer !== 0) {
                    sMain.layer = store.activePlacementLayer
                    if (store.activePlacementLayer > 0) sMain.overpass = true
                  }

                  // Voie secondaire : startNode+offset -> snappedWorld+offset
                  const startPos2 = { x: startNode.pos.x + nx * off, y: startNode.pos.y + ny * off }
                  const endPos2 = { x: snappedWorld.x + nx * off, y: snappedWorld.y + ny * off }
                  // Creer ou recuperer le noeud de depart secondaire
                  let startNodeId2 = store.parallelLastNodeId
                  if (!startNodeId2) {
                    const s2 = addNode(store.network, startPos2)
                    s2.z = store.activePlacementAltitude
                    s2.pos.z = store.activePlacementAltitude
                    startNodeId2 = s2.id
                  }
                  const endNode2 = addNode(store.network, endPos2)
                  endNode2.z = store.activePlacementAltitude
                  endNode2.pos.z = store.activePlacementAltitude
                  const sSec = addSegment(store.network, startNodeId2, endNode2.id)
                  if (sSec && store.activePlacementLayer !== 0) {
                    sSec.layer = store.activePlacementLayer
                    if (store.activePlacementLayer > 0) sSec.overpass = true
                  }

                  store.parallelMode = true
                  store.lastNodeId = endNode.id
                  store.parallelLastNodeId = endNode2.id
                  store.selection = { nodes: new Set([endNode.id, endNode2.id]), segments: new Set() }
                  reconcileNetworkIntersections(store.network)
                  store.markDirty()
                }
              }
            } else {
              // Pas de lastNodeId : poser le premier noeud (ou splitter la voie si on clique sur un pas de voie)
              let startNodeId: string
              const targetPos = store.hoverSegSteps?.nearest ?? snappedWorld
              const hitSegId = store.hoverSegSteps?.segId ?? hitSegment(store.network, targetPos, 16 / store.camera.scale)
              if (hitSegId) {
                const splitRes = splitSegment(store.network, hitSegId, targetPos)
                startNodeId = splitRes ? splitRes.midNode.id : addNode(store.network, targetPos).id
              } else {
                const n = addNode(store.network, targetPos)
                n.z = store.activePlacementAltitude
                n.pos.z = store.activePlacementAltitude
                startNodeId = n.id
              }
              store.lastNodeId = startNodeId
              store.parallelMode = false // attend le prochain shift+click pour creer le 2e noeud
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
                  endNode.z = store.activePlacementAltitude
                  endNode.pos.z = store.activePlacementAltitude
                  const sMain = addSegment(store.network, store.lastNodeId, endNode.id)
                  if (sMain && store.activePlacementLayer !== 0) {
                    sMain.layer = store.activePlacementLayer
                    if (store.activePlacementLayer > 0) sMain.overpass = true
                  }

                  // Voie secondaire (meme direction, decalee)
                  const endPos2 = { x: snappedWorld.x + nx * off, y: snappedWorld.y + ny * off }
                  const endNode2 = addNode(store.network, endPos2)
                  endNode2.z = store.activePlacementAltitude
                  endNode2.pos.z = store.activePlacementAltitude
                  const sSec = addSegment(store.network, store.parallelLastNodeId, endNode2.id)
                  if (sSec && store.activePlacementLayer !== 0) {
                    sSec.layer = store.activePlacementLayer
                    if (store.activePlacementLayer > 0) sSec.overpass = true
                  }

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

        // Click normal (sans shift) : quitter le mode double-voie si actif
        if (store.parallelMode) {
          store.parallelMode = false
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
            store.selection = { nodes: new Set([clickedNode.id]), segments: new Set() }
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

            if (tangent) {
              dir = tangent
              const proj = dx * dir.x + dy * dir.y
              const dist = Math.max(10, proj)
              if (store.trackMode === 'freeform') {
                snappedLen = Math.max(10, Math.round(dist))
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
                dir = rawDist > 1 ? snapDirection({ x: dx / rawDist, y: dy / rawDist }, 15, 6) : { x: 1, y: 0 }
                if (store.selectedStraightLength !== 'auto') {
                  snappedLen = store.selectedStraightLength
                } else {
                  snappedLen = snapStraightLength(rawDist)
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
              const hitSegId = hitSegment(store.network, endPos, hitTol)
              if (hitSegId) {
                const splitRes = splitSegment(store.network, hitSegId, endPos)
                endId = splitRes ? splitRes.midNode.id : addNode(store.network, endPos).id
              } else {
                const endNode = addNode(store.network, endPos)
                endNode.z = store.activePlacementAltitude
                endNode.pos.z = store.activePlacementAltitude
                endId = endNode.id
              }
            }
            const newSeg = addSegment(store.network, store.lastNodeId, endId)
            if (newSeg && store.activePlacementLayer !== 0) {
              newSeg.layer = store.activePlacementLayer
              if (store.activePlacementLayer > 0) newSeg.overpass = true
            }
            reconcileNetworkIntersections(store.network)
            store.markDirty()
            // Finish straight segment: release cursor so it does not auto-continue
            store.lastNodeId = null
            store.selection = { nodes: new Set([endId]), segments: new Set() }
          }
        } else {
          // First node placement: if clicked on an existing segment, split it to start from it!
          const hitTol = 16 / store.camera.scale
          const hitSegId = hitSegment(store.network, world, hitTol)
          let startNodeId: string
          if (hitSegId) {
            const splitRes = splitSegment(store.network, hitSegId, world)
            startNodeId = splitRes ? splitRes.midNode.id : addNode(store.network, world).id
          } else {
            const spacing = getSnapSpacing()
            const pos = store.snap ? snapToGrid(world, spacing) : world
            const n = addNode(store.network, pos)
            n.z = store.activePlacementAltitude
            n.pos.z = store.activePlacementAltitude
            startNodeId = n.id
          }
          store.lastNodeId = startNodeId
          store.selection = { nodes: new Set([startNodeId]), segments: new Set() }
          store.markDirty()
        }
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
        // Si on est en Shift-clic sur un pas de voie prévisualisé, poser un noeud (splitter le segment)
        if (e.shiftKey && store.hoverSegSteps?.nearest && store.hoverSegSteps?.segId) {
          const splitPt = store.hoverSegSteps.nearest
          const splitSegId = store.hoverSegSteps.segId
          const splitRes = splitSegment(store.network, splitSegId, splitPt)
          const newNodeId = splitRes ? splitRes.midNode.id : addNode(store.network, splitPt).id
          store.selection = { nodes: new Set([newNodeId]), segments: new Set() }
          reconcileNetworkIntersections(store.network)
          store.markDirty()
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
      const rawWorld = getWorldPos(e.clientX, e.clientY)
      store.cursorWorld = rawWorld

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

      // Magnetic node snap has priority 1
      const nearNode = findNearestNode(store.network, rawWorld, 16, store.camera)
      if (nearNode) {
        store.snappedCursor = { ...nearNode.pos }
        store.hoverNodeId = nearNode.id
      } else {
        store.hoverNodeId = null
        // Priority 2: Magnetic track snap when using place, curve, turnout, crossing
        const hitTol = 18 / store.camera.scale
        const hitSegId = hitSegment(store.network, rawWorld, hitTol)
        if (hitSegId && (store.tool === 'place' || store.tool === 'curve')) {
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
        } else if (store.snap) {
          const spacing = getSnapSpacing()
          store.snappedCursor = snapToGrid(rawWorld, spacing)
        } else {
          store.snappedCursor = rawWorld
        }
      }

      // Shift+survol : calcul des points de pas sur la voie
      if (e.shiftKey && (store.tool === 'place' || store.tool === 'select')) {
        const hitTol2 = 20 / store.camera.scale
        const nearSeg = hitSegment(store.network, rawWorld, hitTol2)
        if (nearSeg) {
          const spacing = getSnapSpacing()
          const { points, nearest } = getStepPointsAlongSegment(nearSeg, store.network, spacing, rawWorld)
          store.hoverSegSteps = { segId: nearSeg, points, nearest }
          // Snapper le curseur sur le point le plus proche
          if (nearest) {
            store.snappedCursor = { ...nearest }
          }
        } else {
          store.hoverSegSteps = null
        }
      } else {
        store.hoverSegSteps = null
      }

      if (!store.panning) {
        if (store.tool === 'place' || store.tool === 'curve' || store.hoverSegSteps !== null) {
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
      // Finalize node dragging
      if (store.isDraggingNode) {
        store.isDraggingNode = false
        store.dragStartWorld = null
        store.draggedNodeInitialPositions.clear()
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId)
        }
        reconcileNetworkIntersections(store.network)
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

      store.panning = false
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId)
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cam = store.camera
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const vw = rect.width
      const vh = rect.height

      const worldX = cam.x + (px - vw / 2) / cam.scale
      const worldY = cam.y + (py - vh / 2) / cam.scale

      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      cam.scale = clampScale(cam.scale * factor)

      cam.x = worldX - (px - vw / 2) / cam.scale
      cam.y = worldY - (py - vh / 2) / cam.scale
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

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)
    canvas.addEventListener('dblclick', onDblClick)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
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
