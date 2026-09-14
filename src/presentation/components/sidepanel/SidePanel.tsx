import { useEffect, useState, type ReactNode } from 'react'
import { curveLength } from '@domain/geometry/curve'
import { arcRadius, arcDeflectionDeg } from '@domain/geometry/tangent'
import { findJunctionAtNode, findJunctionBySegment, toggleTurnoutHand } from '@domain/models/junction'
import { detectCrossings } from '@domain/models/crossing'
import { detectDeadEnds, detectLoops, detectConnectedComponents } from '@domain/services/pathfinding'
import {
  computeTrackSections,
  findSectionBySegment,
  detectDirectionConflicts,
  type TrackSection,
  type SectionType,
  type SectionDirection,
  SECTION_COLORS,
} from '@domain/models/sections'
import type { EditorStore } from '@application/state/editorStore'

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
        Cliquez sur une section de voie sur le plan pour la renommer, choisir son sens de circulation ou modifier son type.
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
  const [z, setZ] = useState(node.z ?? node.pos.z ?? 0)

  useEffect(() => {
    setX(node.pos.x)
    setY(node.pos.y)
    setZ(node.z ?? node.pos.z ?? 0)
  }, [node.pos.x, node.pos.y, node.z, node.pos.z, nodeId])

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
  const applyZ = (v: number) => {
    setZ(v)
    node.z = v
    node.pos.z = v
    store.markDirty()
    store.notify()
  }

  const selectNode = (id: string) => {
    store.setSelection({ nodes: new Set([id]), segments: new Set() })
  }

  const onDelete = () => {
    store.selection = { nodes: new Set([nodeId]), segments: new Set() }
    store.deleteSelection()
  }

  const isDeadEnd = adj.length === 1

  return (
    <>
      <PanelHeader>{isDeadEnd ? 'Fin de voie (Heurtoir)' : 'Nœud de jonction'}</PanelHeader>
      <div className="sp-section">
        {isDeadEnd && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              marginBottom: '10px',
              backgroundColor: 'rgba(220, 38, 38, 0.12)',
              border: '1px solid #dc2626',
              borderRadius: '6px',
              color: '#dc2626',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" fill="#dc2626" />
              <rect x="5" y="10" width="14" height="4" rx="1.5" fill="#ffffff" />
            </svg>
            <span>Fin de voie — Impasse (sens interdit, aucun prolongement)</span>
          </div>
        )}
        <label className="sp-input-row">
          <span>X (m)</span>
          <input
            type="number"
            step="0.01"
            value={x}
            onChange={(e) => setX(parseFloat(e.target.value) || 0)}
            onBlur={(e) => applyX(parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="sp-input-row">
          <span>Y (m)</span>
          <input
            type="number"
            step="0.01"
            value={y}
            onChange={(e) => setY(parseFloat(e.target.value) || 0)}
            onBlur={(e) => applyY(parseFloat(e.target.value) || 0)}
          />
        </label>
        <label className="sp-input-row">
          <span>Hauteur Z (m)</span>
          <input
            type="number"
            step="0.1"
            value={z}
            onChange={(e) => setZ(parseFloat(e.target.value) || 0)}
            onBlur={(e) => applyZ(parseFloat(e.target.value) || 0)}
          />
        </label>
      </div>

      {junction && (
        <>
          <div className="sp-subheader">Aiguillage #{junction.frogNumber ?? 6}</div>
          <div className="sp-section">
            <Field label="Déviation" value={junction.hand === 'left' ? 'Gauche' : 'Droite'} />
            <Field
              label="Voie active"
              value={junction.activeBranch === 'straight' ? 'Directe' : 'Déviée'}
            />
          </div>
          <div style={{ display: 'flex', gap: '6px', padding: '0 14px 10px' }}>
            <button
              className="sp-btn-compact"
              style={{
                flex: 1,
                padding: '4px 8px',
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: '4px',
                border: '1px solid var(--border)',
                background: 'var(--panel-2)',
                color: 'var(--ink)',
                cursor: 'pointer',
              }}
              onClick={() => store.toggleActiveJunction(junction.id)}
              title="Basculer l'aiguillage (Raccourci T)"
            >
              Aiguiller (T)
            </button>
            <button
              className="sp-btn-compact"
              style={{
                flex: 1,
                padding: '4px 8px',
                fontSize: '11px',
                fontWeight: 500,
                borderRadius: '4px',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--ink)',
                cursor: 'pointer',
              }}
              onClick={() => {
                toggleTurnoutHand(store.network, junction.id)
                store.markDirty()
                store.notify()
              }}
              title="Inverser le côté de déviation"
            >
              Inverser {junction.hand === 'left' ? 'D' : 'G'}
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
              → {other ? `(${other.pos.x.toFixed(2)} m, ${other.pos.y.toFixed(2)} m)` : otherId}
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
  const isStraightBranch = junction?.straightSegmentId === segId
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
    store.selection = { nodes: new Set(), segments: new Set([segId]) }
    store.deleteSelection()
  }

  const allSections = computeTrackSections(store.network, store.sectionMeta)
  const currentSection = findSectionBySegment(allSections, segId)

  return (
    <>
      <PanelHeader>
        {seg.kind === 'curve' ? 'Voie courbe' : 'Voie droite'}
      </PanelHeader>
      <div className="sp-section">
        {currentSection && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 8px',
              marginBottom: '6px',
              background: 'var(--panel-2)',
              borderRadius: '6px',
              border: `1px solid ${currentSection.color}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '9px',
                  height: '9px',
                  borderRadius: '50%',
                  backgroundColor: currentSection.color,
                }}
              />
              <span style={{ fontWeight: 700, fontSize: '12px' }}>{currentSection.name}</span>
            </div>
            <button
              style={{
                fontSize: '10px',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: '4px',
                border: '1px solid var(--border)',
                background: 'var(--paper)',
                color: 'var(--ink)',
                cursor: 'pointer',
              }}
              onClick={() => {
                store.setSelection({
                  nodes: new Set(currentSection.nodeIds),
                  segments: new Set(currentSection.segmentIds),
                })
              }}
              title="Sélectionner tous les rails de cette section"
            >
              Tout le canton ({currentSection.totalLength.toFixed(1)} m)
            </button>
          </div>
        )}
        <Field label="Type" value={seg.kind === 'curve' ? 'Courbe' : 'Ligne droite'} />
        <Field label="Longueur" value={`${len.toFixed(2)} m`} />
        <Field label="Sens de pose" value={`${seg.from} → ${seg.to}`} />
        {(() => {
          const za = a.z ?? a.pos.z ?? 0
          const zb = b.z ?? b.pos.z ?? 0
          const deltaZ = zb - za
          const slopePct = len > 0 ? (deltaZ / len) * 100 : 0
          const slopePermil = len > 0 ? (deltaZ / len) * 1000 : 0
          return (
            <>
              <Field
                label="Dénivelé (ΔZ)"
                value={`${deltaZ >= 0 ? '+' : ''}${deltaZ.toFixed(2)} m (${za.toFixed(1)}m → ${zb.toFixed(1)}m)`}
              />
              <Field
                label="Pente / Rampe"
                value={
                  Math.abs(slopePermil) < 0.1 ? (
                    'Voie de niveau (0 ‰)'
                  ) : (
                    <span style={{ fontWeight: 700, color: Math.abs(slopePermil) > 35 ? '#ef4444' : Math.abs(slopePermil) > 20 ? '#f59e0b' : 'var(--accent)' }}>
                      {slopePermil > 0 ? '▲ Rampe' : '▼ Pente'} {Math.abs(slopePermil).toFixed(1)} ‰ ({Math.abs(slopePct).toFixed(2)} %)
                    </span>
                  )
                }
              />
            </>
          )
        })()}
        {seg.kind === 'curve' && seg.via && (
          <>
            {curveSideLabel && <Field label="Orientation" value={`Déviation ${curveSideLabel}`} />}
            <Field label="Rayon" value={radius === null || radius === Infinity ? '∞' : `R${radius.toFixed(2)} m`} />
            <Field label="Angle" value={deflection === null ? '—' : `${deflection.toFixed(2)}°`} />
            <Field label="Point via" value={`(${seg.via.x.toFixed(2)} m, ${seg.via.y.toFixed(2)} m)`} />
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Étage / Niveau (Z)</div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: (seg.layer ?? (seg.overpass ? 1 : 0)) > 0 ? '#38bdf8' : (seg.layer ?? 0) < 0 ? '#94a3b8' : 'var(--ink)' }}>
              {(seg.layer ?? (seg.overpass ? 1 : 0)) === 0
                ? 'Sol standard (0)'
                : (seg.layer ?? (seg.overpass ? 1 : 0)) > 0
                ? `Pont (+${seg.layer ?? 1})`
                : `Tunnel (${seg.layer})`}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              style={{
                width: '24px',
                height: '24px',
                lineHeight: '1',
                borderRadius: '4px',
                border: '1px solid var(--border)',
                background: 'var(--panel-2)',
                color: 'var(--ink)',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              onClick={() => {
                const cur = seg.layer ?? (seg.overpass ? 1 : 0)
                const next = cur - 1
                seg.layer = next
                seg.overpass = next > 0
                store.markDirty()
                store.notify()
              }}
              title="Descendre d'un étage (-)"
            >
              -
            </button>
            <span style={{ fontSize: '12px', fontWeight: 800, minWidth: '22px', textAlign: 'center' }}>
              {(seg.layer ?? (seg.overpass ? 1 : 0)) > 0 ? `+${seg.layer ?? 1}` : (seg.layer ?? (seg.overpass ? 1 : 0))}
            </span>
            <button
              style={{
                width: '24px',
                height: '24px',
                lineHeight: '1',
                borderRadius: '4px',
                border: '1px solid var(--border)',
                background: 'var(--panel-2)',
                color: 'var(--ink)',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              onClick={() => {
                const cur = seg.layer ?? (seg.overpass ? 1 : 0)
                const next = cur + 1
                seg.layer = next
                seg.overpass = next > 0
                store.markDirty()
                store.notify()
              }}
              title="Monter d'un étage (+)"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {junction && (
        <div style={{ padding: '0 14px 10px' }}>
          <button
            style={{
              width: '100%',
              padding: '4px 8px',
              fontSize: '11px',
              fontWeight: 600,
              borderRadius: '4px',
              border: '1px solid var(--border)',
              background: 'var(--panel-2)',
              color: 'var(--ink)',
              cursor: 'pointer',
            }}
            onClick={() => store.toggleActiveJunction(junction.id)}
            title="Basculer l'aiguillage (Raccourci T)"
          >
            Aiguiller (T)
          </button>
        </div>
      )}

      <div className="sp-subheader">Extrémités</div>
      <div className="sp-list">
        <button className="sp-list-item" onClick={() => selectNode(seg.from)}>
          <span className="sp-tag from">Départ</span>
          ({a.pos.x.toFixed(0)}, {a.pos.y.toFixed(0)}) · Z: {(a.z ?? a.pos.z ?? 0).toFixed(1)}m
        </button>
        <button className="sp-list-item" onClick={() => selectNode(seg.to)}>
          <span className="sp-tag to">Arrivée</span>
          ({b.pos.x.toFixed(0)}, {b.pos.y.toFixed(0)}) · Z: {(b.z ?? b.pos.z ?? 0).toFixed(1)}m
        </button>
      </div>
      <button className="sp-danger" onClick={onDelete}>
        Supprimer le coupon
      </button>
    </>
  )
}

/** Section properties — shown when a canton/section is selected. */
function SectionPanel({ store, section }: { store: EditorStore; section: TrackSection }) {
  const [name, setName] = useState(section.name)
  const [type, setType] = useState<SectionType>(section.type)
  const [direction, setDirection] = useState<SectionDirection>(section.direction)

  useEffect(() => {
    setName(section.name)
    setType(section.type)
    setDirection(section.direction)
  }, [section.id, section.name, section.type, section.direction])

  const applyName = (newName: string) => {
    setName(newName)
    store.setSectionMeta(section.id, { name: newName })
  }

  const applyType = (newType: SectionType) => {
    setType(newType)
    store.setSectionMeta(section.id, { type: newType })
  }

  const applyDirection = (newDir: SectionDirection) => {
    setDirection(newDir)
    store.setSectionMeta(section.id, { direction: newDir })
  }

  const applyColor = (col: string) => {
    store.setSectionMeta(section.id, { color: col })
  }

  const allSections = computeTrackSections(store.network, store.sectionMeta)
  const conflicts = detectDirectionConflicts(store.network, allSections)
  const myConflict = conflicts.find((c) => c.sectionA.id === section.id || c.sectionB.id === section.id)

  return (
    <>
      <PanelHeader>Propriétés de la section</PanelHeader>
      <div className="sp-section">
        {myConflict && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              marginBottom: '10px',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid #ef4444',
              borderRadius: '6px',
              color: '#ef4444',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            <span>
              Sens interdit détecté : collision frontale (&rarr;&larr;) avec la voie adjacente ({myConflict.sectionA.id === section.id ? myConflict.sectionB.name : myConflict.sectionA.name}) !
            </span>
          </div>
        )}

        {section.hasDeadEnd && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 10px',
              marginBottom: '10px',
              backgroundColor: 'rgba(220, 38, 38, 0.12)',
              border: '1px solid #dc2626',
              borderRadius: '6px',
              color: '#dc2626',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" fill="#dc2626" />
              <rect x="5" y="10.2" width="14" height="3.6" rx="1" fill="#ffffff" />
            </svg>
            <span>Fin de voie : voie en impasse (sens interdit)</span>
          </div>
        )}

        <label className="sp-input-row" style={{ marginBottom: '8px' }}>
          <span style={{ width: '45px' }}>Nom</span>
          <input
            type="text"
            value={name}
            placeholder="ex: Voie 1 (Passage)"
            onChange={(e) => {
              setName(e.target.value)
              applyName(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                applyName(e.currentTarget.value)
                e.currentTarget.blur()
              }
            }}
            onBlur={(e) => applyName(e.target.value)}
          />
        </label>

        {/* Sens de circulation */}
        <div style={{ marginBottom: '10px' }}>
          <span className="sp-field-label" style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600 }}>
            Sens de circulation
          </span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              className="sp-btn-compact"
              style={{
                flex: 1,
                padding: '8px 4px',
                borderRadius: '6px',
                border: direction === 'two_way' ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                background: direction === 'two_way' ? 'rgba(37, 99, 235, 0.2)' : 'var(--panel-2)',
                color: direction === 'two_way' ? 'var(--accent)' : 'var(--ink)',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
              onClick={() => applyDirection('two_way')}
              title="Double sens de circulation (<->)"
              aria-label="Double sens"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 16l-4-4m0 0l4-4m-4 4h18m-4-4l4 4m0 0l-4 4" />
              </svg>
            </button>
            <button
              className="sp-btn-compact"
              style={{
                flex: 1,
                padding: '8px 4px',
                borderRadius: '6px',
                border: direction === 'forward' ? '1.5px solid #10b981' : '1px solid var(--border)',
                background: direction === 'forward' ? 'rgba(16, 185, 129, 0.2)' : 'var(--panel-2)',
                color: direction === 'forward' ? '#10b981' : 'var(--ink)',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
              onClick={() => applyDirection('forward')}
              title="Sens unique direct (->)"
              aria-label="Sens direct"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14m-6-6l6 6-6 6" />
              </svg>
            </button>
            <button
              className="sp-btn-compact"
              style={{
                flex: 1,
                padding: '8px 4px',
                borderRadius: '6px',
                border: direction === 'backward' ? '1.5px solid #10b981' : '1px solid var(--border)',
                background: direction === 'backward' ? 'rgba(16, 185, 129, 0.2)' : 'var(--panel-2)',
                color: direction === 'backward' ? '#10b981' : 'var(--ink)',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
              onClick={() => applyDirection('backward')}
              title="Sens unique inverse (<-)"
              aria-label="Sens inverse"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5m6-6l-6 6 6 6" />
              </svg>
            </button>
          </div>
        </div>

        <div style={{ marginBottom: '8px' }}>
          <span className="sp-field-label" style={{ display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 600 }}>
            Type de voie
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              className="sp-btn-compact"
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 4px',
                fontSize: '10px',
                borderRadius: '5px',
                border: type === 'circulation' ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                background: type === 'circulation' ? 'rgba(37, 99, 235, 0.15)' : 'var(--panel-2)',
                color: 'var(--ink)',
                cursor: 'pointer',
                fontWeight: type === 'circulation' ? 700 : 500,
              }}
              onClick={() => applyType('circulation')}
              title="Voie de circulation directe (passage sans arrêt)"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
                <line x1="8" y1="2" x2="8" y2="22" />
                <line x1="16" y1="2" x2="16" y2="22" />
              </svg>
              <span>Circulation</span>
            </button>
            <button
              className="sp-btn-compact"
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 4px',
                fontSize: '10px',
                borderRadius: '5px',
                border: type === 'station_stop' ? '1.5px solid #06b6d4' : '1px solid var(--border)',
                background: type === 'station_stop' ? 'rgba(6, 182, 212, 0.15)' : 'var(--panel-2)',
                color: 'var(--ink)',
                cursor: 'pointer',
                fontWeight: type === 'station_stop' ? 700 : 500,
              }}
              onClick={() => applyType('station_stop')}
              title="Voie à quai / arrêt voyageurs (gare)"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="17" x2="9" y2="21" />
                <line x1="15" y1="17" x2="15" y2="21" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <circle cx="7.5" cy="14.5" r="1.5" />
                <circle cx="16.5" cy="14.5" r="1.5" />
              </svg>
              <span>Gare</span>
            </button>
            <button
              className="sp-btn-compact"
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 4px',
                fontSize: '10px',
                borderRadius: '5px',
                border: type === 'siding' ? '1.5px solid #f59e0b' : '1px solid var(--border)',
                background: type === 'siding' ? 'rgba(245, 158, 11, 0.15)' : 'var(--panel-2)',
                color: 'var(--ink)',
                cursor: 'pointer',
                fontWeight: type === 'siding' ? 700 : 500,
              }}
              onClick={() => applyType('siding')}
              title="Voie d'évitement / garage / arrêt marchandise"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 18h18" />
                <path d="M3 6h7l4 6h7" />
                <circle cx="18" cy="12" r="2" />
              </svg>
              <span>Évitement</span>
            </button>
          </div>
        </div>

        <Field label="Longueur totale" value={`${section.totalLength.toFixed(2)} m`} />
        <Field label="Coupons de rail" value={section.segmentIds.length} />
        <Field label="Nœuds" value={section.nodeIds.length} />
        {(() => {
          if (section.orderedNodeIds.length < 2) return null
          const startN = store.network.nodes.get(section.orderedNodeIds[0])
          const endN = store.network.nodes.get(section.orderedNodeIds[section.orderedNodeIds.length - 1])
          if (!startN || !endN) return null
          const zStart = startN.z ?? startN.pos.z ?? 0
          const zEnd = endN.z ?? endN.pos.z ?? 0
          const deltaZ = zEnd - zStart
          const slopePermil = section.totalLength > 0 ? (deltaZ / section.totalLength) * 1000 : 0
          return (
            <>
              <Field
                label="Dénivelé total (ΔZ)"
                value={`${deltaZ >= 0 ? '+' : ''}${deltaZ.toFixed(2)} m (${zStart.toFixed(1)}m → ${zEnd.toFixed(1)}m)`}
              />
              <Field
                label="Pente moyenne"
                value={
                  Math.abs(slopePermil) < 0.1 ? (
                    'Voie de niveau (0 ‰)'
                  ) : (
                    <span style={{ fontWeight: 700, color: Math.abs(slopePermil) > 35 ? '#ef4444' : Math.abs(slopePermil) > 20 ? '#f59e0b' : 'var(--accent)' }}>
                      {slopePermil > 0 ? '▲ Rampe' : '▼ Pente'} {Math.abs(slopePermil).toFixed(1)} ‰
                    </span>
                  )
                }
              />
            </>
          )
        })()}

        {/* Niveau / Ouvrage d'art (Pont 2D / Tunnels) avec stepper +/- */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', margin: '8px 0' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600 }}>Étage / Niveau de voie</div>
            <div style={{ fontSize: '10px', color: 'var(--muted)' }}>
              {(() => {
                const first = store.network.segments.get(section.segmentIds[0])
                const l = first ? (first.layer ?? (first.overpass ? 1 : 0)) : 0
                return l === 0 ? 'Niveau du sol (0)' : l > 0 ? `Pont aérien (+${l})` : `Tunnel / Tranchée (${l})`
              })()}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              style={{
                width: '26px',
                height: '24px',
                lineHeight: '1',
                borderRadius: '4px',
                border: '1px solid var(--border)',
                background: 'var(--panel-2)',
                color: 'var(--ink)',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              onClick={() => {
                const first = store.network.segments.get(section.segmentIds[0])
                const cur = first ? (first.layer ?? (first.overpass ? 1 : 0)) : 0
                const next = cur - 1
                for (const sid of section.segmentIds) {
                  const s = store.network.segments.get(sid)
                  if (s) {
                    s.layer = next
                    s.overpass = next > 0
                  }
                }
                store.markDirty()
                store.notify()
              }}
              title="Descendre toute la voie d'un étage (-)"
            >
              -
            </button>
            <span style={{ fontSize: '12px', fontWeight: 800, minWidth: '24px', textAlign: 'center' }}>
              {(() => {
                const first = store.network.segments.get(section.segmentIds[0])
                const l = first ? (first.layer ?? (first.overpass ? 1 : 0)) : 0
                return l > 0 ? `+${l}` : l
              })()}
            </span>
            <button
              style={{
                width: '26px',
                height: '24px',
                lineHeight: '1',
                borderRadius: '4px',
                border: '1px solid var(--border)',
                background: 'var(--panel-2)',
                color: 'var(--ink)',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              onClick={() => {
                const first = store.network.segments.get(section.segmentIds[0])
                const cur = first ? (first.layer ?? (first.overpass ? 1 : 0)) : 0
                const next = cur + 1
                for (const sid of section.segmentIds) {
                  const s = store.network.segments.get(sid)
                  if (s) {
                    s.layer = next
                    s.overpass = next > 0
                  }
                }
                store.markDirty()
                store.notify()
              }}
              title="Monter toute la voie d'un étage (+)"
            >
              +
            </button>
          </div>
        </div>

        <div style={{ marginTop: '6px' }}>
          <span className="sp-field-label" style={{ display: 'block', marginBottom: '6px', fontSize: '11px', fontWeight: 600 }}>
            Couleur de canton
          </span>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {SECTION_COLORS.map((col) => (
              <button
                key={col}
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  backgroundColor: col,
                  border: section.color === col ? '2px solid #ffffff' : '1px solid transparent',
                  boxShadow: section.color === col ? '0 0 0 1px var(--ink)' : 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
                onClick={() => applyColor(col)}
                title={`Choisir cette teinte`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="sp-subheader">Sélection des rails du canton</div>
      <div className="sp-list">
        {section.segmentIds.map((sid, idx) => {
          const s = store.network.segments.get(sid)
          return (
            <button
              key={sid}
              className="sp-list-item"
              onClick={() => {
                store.setSelection({ nodes: new Set(), segments: new Set([sid]) })
              }}
            >
              <span className={`sp-tag ${s?.kind || 'straight'}`}>{s?.kind === 'curve' ? 'courbe' : 'droite'}</span>
              <span>Coupon #{idx + 1} ({sid})</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

/** Panneau de contrôle affiché lorsque 2 nœuds sont sélectionnés avec Ctrl/Cmd */
function TwoNodesSelectionPanel({ store, nodeAId, nodeBId }: { store: EditorStore; nodeAId: string; nodeBId: string }) {
  const nodeA = store.network.nodes.get(nodeAId)
  const nodeB = store.network.nodes.get(nodeBId)
  if (!nodeA || !nodeB) return <NetworkPanel store={store} />

  const dx = nodeB.pos.x - nodeA.pos.x
  const dy = nodeB.pos.y - nodeA.pos.y
  const dist = Math.hypot(dx, dy)
  const zA = nodeA.z ?? nodeA.pos.z ?? 0
  const zB = nodeB.z ?? nodeB.pos.z ?? 0
  const deltaZ = zB - zA
  const slopePermil = dist > 0 ? (deltaZ / dist) * 1000 : 0

  // Vérifier s'ils sont déjà reliés par un rail
  const adjA = store.network.adjacency.get(nodeAId) ?? []
  const connectingSeg = adjA
    .map((sid) => store.network.segments.get(sid))
    .find((s) => s && (s.from === nodeBId || s.to === nodeBId))

  return (
    <>
      <PanelHeader>Sélection de 2 nœuds</PanelHeader>
      <div className="sp-section">
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', padding: '6px 8px', background: 'rgba(37,99,235,0.12)', border: '1px solid #3b82f6', borderRadius: '6px' }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <line x1="4" y1="9" x2="20" y2="9" />
            <line x1="4" y1="15" x2="20" y2="15" />
            <circle cx="6" cy="9" r="2" fill="#3b82f6" />
            <circle cx="18" cy="9" r="2" fill="#3b82f6" />
            <circle cx="6" cy="15" r="2" fill="#3b82f6" />
            <circle cx="18" cy="15" r="2" fill="#3b82f6" />
          </svg>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ink)' }}>
            2 nœuds sélectionnés (Ctrl / Cmd)
          </span>
        </div>

        <Field label="Nœud A" value={`(${nodeA.pos.x.toFixed(1)}m, ${nodeA.pos.y.toFixed(1)}m) · Z: ${zA.toFixed(1)}m`} />
        <Field label="Nœud B" value={`(${nodeB.pos.x.toFixed(1)}m, ${nodeB.pos.y.toFixed(1)}m) · Z: ${zB.toFixed(1)}m`} />
        <Field label="Distance" value={`${dist.toFixed(2)} m`} />
        <Field label="Dénivelé (ΔZ)" value={`${deltaZ >= 0 ? '+' : ''}${deltaZ.toFixed(2)} m`} />
        <Field
          label="Pente"
          value={
            Math.abs(slopePermil) < 0.1 ? (
              '0 ‰ (De niveau)'
            ) : (
              <span style={{ fontWeight: 700, color: Math.abs(slopePermil) > 35 ? '#ef4444' : Math.abs(slopePermil) > 20 ? '#f59e0b' : 'var(--accent)' }}>
                {slopePermil > 0 ? '▲ Rampe' : '▼ Pente'} {Math.abs(slopePermil).toFixed(1)} ‰
              </span>
            )
          }
        />
        <Field label="Reliés par voie" value={connectingSeg ? 'Oui (voie existante)' : 'Non (non connectés)'} />
      </div>

      <div className="sp-subheader">Construction voie double</div>
      <div style={{ padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Écartement double voie :</span>
          <input
            type="number"
            min="1.0"
            max="20.0"
            step="0.1"
            value={store.parallelOffset}
            onChange={(e) => {
              const val = parseFloat(e.target.value)
              if (!isNaN(val) && val > 0) store.setParallelOffset(val)
            }}
            style={{
              width: '55px',
              padding: '3px 6px',
              fontSize: '11px',
              borderRadius: '4px',
              border: '1px solid var(--border)',
              background: 'var(--input-bg, #0f172a)',
              color: 'var(--ink)',
              textAlign: 'right',
            }}
          />
          <span style={{ fontSize: '11px' }}>m</span>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            className="sp-btn-compact"
            style={{
              flex: 1,
              padding: '8px 10px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
            onClick={() => store.createParallelTrackFromSelection()}
            title="Génère la voie parallèle à gauche (+écartement). Raccourci : D"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="8" x2="21" y2="8" />
              <line x1="3" y1="16" x2="21" y2="16" />
            </svg>
            Créer voie double (D)
          </button>
          <button
            className="sp-btn-compact"
            style={{
              padding: '8px 10px',
              background: 'var(--panel-2)',
              color: 'var(--ink)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '11px',
              cursor: 'pointer',
            }}
            onClick={() => store.createParallelTrackFromSelection(-store.parallelOffset)}
            title="Créer la voie parallèle du côté opposé (-écartement)"
          >
            Côté opposé
          </button>
        </div>
      </div>

      <div className="sp-subheader">Actions sur les 2 nœuds</div>
      <div style={{ display: 'flex', gap: '6px', padding: '0 14px 10px' }}>
        {!connectingSeg && (
          <button
            className="sp-btn-compact"
            style={{
              flex: 1,
              padding: '6px 8px',
              fontSize: '11px',
              fontWeight: 600,
              borderRadius: '4px',
              border: '1px solid var(--border)',
              background: 'var(--panel-2)',
              color: 'var(--ink)',
              cursor: 'pointer',
            }}
            onClick={() => {
              store.connectSelectedNodes()
            }}
            title="Relier directement ces 2 nœuds par un coupon de voie droite"
          >
            Relier par un rail
          </button>
        )}
        <button
          className="sp-btn-compact"
          style={{
            flex: 1,
            padding: '6px 8px',
            fontSize: '11px',
            fontWeight: 500,
            borderRadius: '4px',
            border: '1px solid #ef4444',
            background: 'rgba(239, 68, 68, 0.1)',
            color: '#ef4444',
            cursor: 'pointer',
          }}
          onClick={() => store.deleteSelection()}
          title="Supprimer les 2 nœuds sélectionnés"
        >
          Supprimer les 2 nœuds
        </button>
      </div>
    </>
  )
}


export function SidePanel({ store }: { store: EditorStore }) {
  const isOpen = store.isSidePanelOpen
  const sel = store.selection
  const allSections = computeTrackSections(store.network, store.sectionMeta)

  // Check if selection matches an entire track section
  const matchingSection = allSections.find((sec) => {
    if (sec.segmentIds.length !== sel.segments.size) return false
    return sec.segmentIds.every((sid) => sel.segments.has(sid))
  })

  // If a single segment is selected, find which section it belongs to
  const singleSegSection = sel.segments.size === 1 && sel.nodes.size === 0
    ? findSectionBySegment(allSections, [...sel.segments][0])
    : null

  let content: ReactNode
  // If 2 nodes are selected: special panel allowing direct double track creation / connection
  if (sel.nodes.size === 2 && sel.segments.size === 0) {
    const [idA, idB] = [...sel.nodes]
    content = <TwoNodesSelectionPanel key={`${idA}-${idB}`} store={store} nodeAId={idA} nodeBId={idB} />
  } else if (sel.segments.size === 1 && sel.nodes.size === 0) {
    const id = [...sel.segments][0]
    content = <SegmentPanel key={id} store={store} segId={id} />
  } else if (matchingSection) {
    content = <SectionPanel key={matchingSection.id} store={store} section={matchingSection} />
  } else if (singleSegSection) {
    content = <SectionPanel key={singleSegSection.id} store={store} section={singleSegSection} />
  } else if (sel.nodes.size === 1 && sel.segments.size === 0) {
    const id = [...sel.nodes][0]
    content = <NodePanel key={id} store={store} nodeId={id} />
  } else {
    content = <NetworkPanel store={store} />
  }


  return (
    <>
      {/* Floating toggle button on the right edge */}
      <button
        className={`sp-toggle-btn ${isOpen ? 'open' : 'closed'}`}
        onClick={() => store.toggleSidePanel()}
        title={isOpen ? 'Replier le volet d’informations (I)' : 'Ouvrir le volet d’informations (I)'}
        aria-label="Toggle side panel"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {isOpen ? (
            <polyline points="9 18 15 12 9 6" />
          ) : (
            <polyline points="15 18 9 12 15 6" />
          )}
        </svg>
      </button>

      {/* Floating drawer side panel */}
      <div className={`side-panel ${isOpen ? 'open' : 'collapsed'}`}>
        <div className="sp-top-bar">
          <span className="sp-top-title">Inspecteur & Propriétés</span>
          <button
            className="sp-close-btn"
            onClick={() => store.setSidePanelOpen(false)}
            title="Fermer le volet"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="sp-content">{content}</div>
      </div>
    </>
  )
}

