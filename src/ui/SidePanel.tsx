import { useEffect, useState, type ReactNode } from 'react'
import { removeNode, removeSegment } from '../core/network'
import { curveLength } from '../core/curve'
import { arcRadius, arcDeflectionDeg } from '../core/tangent'
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

  return (
    <>
      <PanelHeader>Network</PanelHeader>
      <div className="sp-section">
        <Field label="Nodes" value={net.nodes.size} />
        <Field label="Segments" value={net.segments.size} />
        <Field label="Straight" value={straightCount} />
        <Field label="Curves" value={curveCount} />
        <Field label="Total length" value={formattedTotal} />
      </div>
      <div className="sp-hint">
        Select a node or segment to edit its properties.
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
      <PanelHeader>Node</PanelHeader>
      <div className="sp-section">
        <label className="sp-input-row">
          <span>X</span>
          <input
            type="number"
            step="any"
            value={x}
            onChange={(e) => setX(parseFloat(e.target.value) || 0)}
            onBlur={(e) => applyX(parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="sp-input-row">
          <span>Y</span>
          <input
            type="number"
            step="any"
            value={y}
            onChange={(e) => setY(parseFloat(e.target.value) || 0)}
            onBlur={(e) => applyY(parseFloat(e.target.value) || 0)}
          />
        </label>
      </div>
      <div className="sp-subheader">Connected segments ({connectedSegs.length})</div>
      <div className="sp-list">
        {connectedSegs.length === 0 && <div className="sp-empty">No connections</div>}
        {connectedSegs.map((s) => {
          const otherId = s.from === nodeId ? s.to : s.from
          const other = store.network.nodes.get(otherId)
          return (
            <button
              key={s.id}
              className="sp-list-item"
              onClick={() => selectNode(otherId)}
            >
              <span className={`sp-tag ${s.kind}`}>{s.kind === 'curve' ? 'curve' : 'straight'}</span>
              → {other ? `(${other.pos.x.toFixed(0)}, ${other.pos.y.toFixed(0)})` : otherId}
            </button>
          )
        })}
      </div>
      <button className="sp-danger" onClick={onDelete}>
        Delete node
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

  let len = 0
  let radius: number | null = null
  let deflection: number | null = null
  if (seg.kind === 'curve' && seg.via) {
    len = curveLength(a.pos, seg.via, b.pos)
    // Approximate radius via Bezier curvature sampling would need minCurveRadius;
    // use arc-based estimate from tangent for display.
    const incoming = (() => {
      // Use start tangent direction
      const dx = seg.via.x - a.pos.x
      const dy = seg.via.y - a.pos.y
      const l = Math.hypot(dx, dy)
      return l > 0 ? { x: dx / l, y: dy / l } : null
    })()
    if (incoming) {
      radius = arcRadius(a.pos, b.pos, incoming)
      deflection = arcDeflectionDeg(a.pos, b.pos, incoming)
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
        {seg.kind === 'curve' ? 'Curve segment' : 'Straight segment'}
      </PanelHeader>
      <div className="sp-section">
        <Field label="Type" value={seg.kind} />
        <Field label="Length" value={`${len.toFixed(0)} mm`} />
        {seg.kind === 'curve' && seg.via && (
          <>
            <Field label="Radius" value={radius === null || radius === Infinity ? '∞' : `${radius.toFixed(0)} mm`} />
            <Field label="Deflection" value={deflection === null ? '—' : `${deflection.toFixed(1)}°`} />
            <Field label="Via" value={`(${seg.via.x.toFixed(0)}, ${seg.via.y.toFixed(0)})`} />
          </>
        )}
      </div>
      <div className="sp-subheader">Endpoints</div>
      <div className="sp-list">
        <button className="sp-list-item" onClick={() => selectNode(seg.from)}>
          <span className="sp-tag from">from</span>
          ({a.pos.x.toFixed(0)}, {a.pos.y.toFixed(0)})
        </button>
        <button className="sp-list-item" onClick={() => selectNode(seg.to)}>
          <span className="sp-tag to">to</span>
          ({b.pos.x.toFixed(0)}, {b.pos.y.toFixed(0)})
        </button>
      </div>
      <button className="sp-danger" onClick={onDelete}>
        Delete segment
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
