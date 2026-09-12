import { useEffect, useState, type ReactNode } from 'react'
import { removeNode, removeSegment } from '../core/network'
import { curveLength } from '../core/curve'
import { arcRadius, arcDeflectionDeg } from '../core/tangent'
import { findJunctionAtNode, findJunctionBySegment, toggleTurnoutHand } from '../core/junction'
import { detectCrossings } from '../core/crossing'
import { detectDeadEnds, detectLoops, detectConnectedComponents } from '../core/pathfinding'
import type { EditorStore } from './store'

function PanelHeader({ children }: { children: ReactNode }) {
  return <div className="sp-header">{children}</div>
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="sp-field">
      <span className="sp-field-label">{label}</span>
      <span className="sp-field-value">{value}</span>
    </div>
  )
}

/** Network overview — shown when nothing is selected. */
function NetworkPanel({ store }: { store: EditorStore }) {
  const net = store.network
  let totalLen = 0
  let curveCount = 0
  let straightCount = 0
  for (const seg of net.segments.values()) {
    const a = net.nodes.get(seg.from)
    const b = net.nodes.get(seg.to)
    if (!a || !b) continue
    if (seg.kind === 'curve' && seg.via) {
      totalLen += curveLength(a.pos, seg.via, b.pos)
      curveCount++
    } else {
      totalLen += Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y)
      straightCount++
    }
  }

  const formattedTotal =
    totalLen >= 1000
      ? `${(totalLen / 1000).toFixed(2)} m`
      : `${totalLen.toFixed(0)} mm`

  const deadEnds = detectDeadEnds(net).length
  const loops = detectLoops(net).length
  const components = detectConnectedComponents(net).length

  return (
    <>
      <PanelHeader>Réseau ferroviaire</PanelHeader>
      <div className="sp-section">
        <Field label="Nœuds" value={net.nodes.size} />
        <Field label="Rails" value={net.segments.size} />
        <Field label="Voies droites" value={straightCount} />
        <Field label="Courbes" value={curveCount} />
        <Field label="Aiguillages" value={net.junctions.size} />
        <Field label="Longueur totale" value={formattedTotal} />
      </div>

      <div className="sp-subheader">Topologie & Chemins</div>
      <div className="sp-section">
        <Field label="Impasses / heurtoirs" value={deadEnds} />
        <Field label="Boucles détectées" value={loops} />
        <Field label="Réseaux disjoints" value={components} />
      </div>

      <div className="sp-hint">
        Sélectionnez un coupon de rail ou un nœud pour afficher et modifier ses caractéristiques.
      </div>
    </>
  )
}

/** Node properties — shown when a single node is selected. */
function NodePanel({ store, nodeId }: { store: EditorStore; nodeId: string }) {
  const node = store.network.nodes.get(nodeId)
  if (!node) return <NetworkPanel store={store} />

  const adj = store.network.adjacency.get(nodeId) ?? []
  const connectedSegs = adj
    .map((sid) => store.network.segments.get(sid))
    .filter((s): s is NonNullable<typeof s> => !!s)

  const junction = findJunctionAtNode(store.network, nodeId)
  const crossing = detectCrossings(store.network).find((c) => c.nodeId === nodeId)

  const [x, setX] = useState(node.pos.x)
  const [y, setY] = useState(node.pos.y)

  useEffect(() => {
    setX(node.pos.x)
    setY(node.pos.y)
  }, [node.pos.x, node.pos.y, nodeId])

  const applyX = (v: number) => {
    setX(v)
    node.pos.x = v
    store.markDirty()
    store.notify()
  }
  const applyY = (v: number) => {
    setY(v)
    node.pos.y = v
    store.markDirty()
    store.notify()
  }

  const selectNode = (id: string) => {
    store.setSelection({ nodes: new Set([id]), segments: new Set() })
  }

  const onDelete = () => {
    removeNode(store.network, nodeId)
    if (store.lastNodeId === nodeId) store.lastNodeId = null
    if (store.curveState.startId === nodeId) {
      store.curveState = { phase: 0, startId: null }
    }
    store.clearSelection()
    store.markDirty()
    store.notify()
  }

  return (
    <>
      <PanelHeader>Nœud de jonction</PanelHeader>
      <div className="sp-section">
        <label className="sp-input-row">
          <span>X (mm)</span>
          <input
            type="number"
            step="any"
            value={x}
            onChange={(e) => setX(parseFloat(e.target.value) || 0)}
            onBlur={(e) => applyX(parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="sp-input-row">
          <span>Y (mm)</span>
          <input
            type="number"
            step="any"
            value={y}
            onChange={(e) => setY(parseFloat(e.target.value) || 0)}
            onBlur={(e) => applyY(parseFloat(e.target.value) || 0)}
          />
        </label>
      </div>

      {junction && (
        <>
          <div className="sp-subheader">Aiguillage Kato #{junction.frogNumber ?? 6}</div>
          <div className="sp-section">
            <Field label="Déviation" value={junction.hand === 'left' ? 'Gauche' : 'Droite'} />
            <Field
              label="Voie active"
              value={junction.activeBranch === 'straight' ? 'Directe' : 'Déviée'}
            />
          </div>
          <div className="sp-list" style={{ gap: '6px', marginBottom: '12px' }}>
            <button
              className="sp-list-item"
              style={{ justifyContent: 'center', fontWeight: 600 }}
              onClick={() => store.toggleActiveJunction(junction.id)}
            >
              Basculer la voie (T)
            </button>
            <button
              className="sp-list-item"
              style={{ justifyContent: 'center' }}
              onClick={() => {
                toggleTurnoutHand(store.network, junction.id)
                store.markDirty()
                store.notify()
              }}
            >
              Inverser côté ({junction.hand === 'left' ? 'Passer Droite' : 'Passer Gauche'})
            </button>
          </div>
        </>
      )}
      {crossing && (
        <>
          <div className="sp-subheader">Croisement à niveau (Diamond Crossing)</div>
          <div className="sp-section">
            <Field label="Angle" value={`${crossing.angleDeg.toFixed(1)}° (${crossing.angleRad.toFixed(3)} rad)`} />
            <Field label="Type" value={crossing.angleDeg === 15 ? 'Traversée Kato #4' : crossing.angleDeg === 90 ? 'Croisement orthogonal' : 'Croisement oblique'} />
            <Field label="Ornières" value="1.6 mm (NEM 110)" />
          </div>
          <div className="sp-subheader">Pointes de cœur (Frogs)</div>
          <div className="sp-section" style={{ fontSize: '11px' }}>
            <Field label="P1 (Nord)" value={`(${crossing.frogs.p1.x.toFixed(1)}, ${crossing.frogs.p1.y.toFixed(1)})`} />
            <Field label="P2 (Est)" value={`(${crossing.frogs.p2.x.toFixed(1)}, ${crossing.frogs.p2.y.toFixed(1)})`} />
            <Field label="P3 (Sud)" value={`(${crossing.frogs.p3.x.toFixed(1)}, ${crossing.frogs.p3.y.toFixed(1)})`} />
            <Field label="P4 (Ouest)" value={`(${crossing.frogs.p4.x.toFixed(1)}, ${crossing.frogs.p4.y.toFixed(1)})`} />
          </div>
        </>
      )}

      <div className="sp-subheader">Voies connectées ({connectedSegs.length})</div>
      <div className="sp-list">
        {connectedSegs.length === 0 && <div className="sp-empty">Aucune connexion</div>}
        {connectedSegs.map((s) => {
          const otherId = s.from === nodeId ? s.to : s.from
          const other = store.network.nodes.get(otherId)
          return (
            <button
              key={s.id}
              className="sp-list-item"
              onClick={() => selectNode(otherId)}
            >
              <span className={`sp-tag ${s.kind}`}>{s.kind === 'curve' ? 'courbe' : 'droite'}</span>
              → {other ? `(${other.pos.x.toFixed(0)}, ${other.pos.y.toFixed(0)})` : otherId}
            </button>
          )
        })}
      </div>
      <button className="sp-danger" onClick={onDelete}>
        Supprimer le nœud
      </button>
    </>
  )
}

/** Segment properties — shown when a single segment is selected. */
function SegmentPanel({ store, segId }: { store: EditorStore; segId: string }) {
  const seg = store.network.segments.get(segId)
  if (!seg) return <NetworkPanel store={store} />

  const a = store.network.nodes.get(seg.from)
  const b = store.network.nodes.get(seg.to)
  if (!a || !b) return <NetworkPanel store={store} />

  const junction = findJunctionBySegment(store.network, segId)
  const isStraightBranch = junction ? segId === junction.straightSegmentId : false
  const isBranchActive = junction
    ? (isStraightBranch && junction.activeBranch === 'straight') ||
      (!isStraightBranch && junction.activeBranch === 'diverging')
    : true

  let len = 0
  let radius: number | null = null
  let deflection: number | null = null
  let curveSideLabel: string | null = null
  if (seg.kind === 'curve' && seg.via) {
    len = curveLength(a.pos, seg.via, b.pos)
    const incoming = (() => {
      const dx = seg.via.x - a.pos.x
      const dy = seg.via.y - a.pos.y
      const l = Math.hypot(dx, dy)
      return l > 0 ? { x: dx / l, y: dy / l } : null
    })()
    if (incoming) {
      radius = arcRadius(a.pos, b.pos, incoming)
      deflection = arcDeflectionDeg(a.pos, b.pos, incoming)
      const bdx = b.pos.x - a.pos.x
      const bdy = b.pos.y - a.pos.y
      const cross = incoming.x * bdy - incoming.y * bdx
      curveSideLabel = cross < 0 ? 'Gauche' : 'Droite'
    }
  } else {
    len = Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y)
  }

  const selectNode = (id: string) => {
    store.setSelection({ nodes: new Set([id]), segments: new Set() })
  }

  const onDelete = () => {
    removeSegment(store.network, segId, true)
    if (store.lastNodeId && !store.network.nodes.has(store.lastNodeId)) {
      store.lastNodeId = null
    }
    if (store.curveState.startId && !store.network.nodes.has(store.curveState.startId)) {
      store.curveState = { phase: 0, startId: null }
    }
    store.clearSelection()
    store.markDirty()
    store.notify()
  }

  return (
    <>
      <PanelHeader>
        {seg.kind === 'curve' ? 'Coupon de courbe' : 'Coupon de voie droite'}
      </PanelHeader>
      <div className="sp-section">
        <Field label="Type" value={seg.kind === 'curve' ? 'Courbe' : 'Ligne droite'} />
        <Field label="Longueur" value={`${len.toFixed(0)} mm`} />
        <Field label="Sens de pose" value={`${seg.from} → ${seg.to}`} />
        {seg.kind === 'curve' && seg.via && (
          <>
            {curveSideLabel && <Field label="Orientation" value={`Déviation ${curveSideLabel}`} />}
            <Field label="Rayon" value={radius === null || radius === Infinity ? '∞' : `R${radius.toFixed(0)} mm`} />
            <Field label="Angle" value={deflection === null ? '—' : `${deflection.toFixed(1)}°`} />
            <Field label="Point via" value={`(${seg.via.x.toFixed(0)}, ${seg.via.y.toFixed(0)})`} />
          </>
        )}
        {junction && (
          <>
            <Field
              label="Aiguillage"
              value={isStraightBranch ? 'Branche directe' : 'Branche déviée'}
            />
            <Field
              label="Position de voie"
              value={isBranchActive ? 'Active (ouverte)' : 'Inactive (fermée)'}
            />
          </>
        )}
      </div>

      {junction && (
        <div className="sp-list" style={{ marginBottom: '12px' }}>
          <button
            className="sp-list-item"
            style={{ justifyContent: 'center', fontWeight: 600 }}
            onClick={() => store.toggleActiveJunction(junction.id)}
          >
            Basculer l'aiguillage (T)
          </button>
        </div>
      )}

      <div className="sp-subheader">Extrémités</div>
      <div className="sp-list">
        <button className="sp-list-item" onClick={() => selectNode(seg.from)}>
          <span className="sp-tag from">Départ</span>
          ({a.pos.x.toFixed(0)}, {a.pos.y.toFixed(0)})
        </button>
        <button className="sp-list-item" onClick={() => selectNode(seg.to)}>
          <span className="sp-tag to">Arrivée</span>
          ({b.pos.x.toFixed(0)}, {b.pos.y.toFixed(0)})
        </button>
      </div>
      <button className="sp-danger" onClick={onDelete}>
        Supprimer le coupon
      </button>
    </>
  )
}

export function SidePanel({ store }: { store: EditorStore }) {
  const sel = store.selection
  let content: ReactNode
  if (sel.nodes.size === 1 && sel.segments.size === 0) {
    const id = [...sel.nodes][0]
    content = <NodePanel key={id} store={store} nodeId={id} />
  } else if (sel.segments.size === 1 && sel.nodes.size === 0) {
    const id = [...sel.segments][0]
    content = <SegmentPanel key={id} store={store} segId={id} />
  } else {
    content = <NetworkPanel store={store} />
  }

  return <div className="side-panel">{content}</div>
}
