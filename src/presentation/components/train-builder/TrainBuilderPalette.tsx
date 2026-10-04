import type { EditorStore, TrainDebugOptions } from '@application/state/editorStore'

export function TrainBuilderPalette({ store }: { store: EditorStore }) {
  const hasTrains = store.trains.length > 0 || store.locomotive !== null
  const isCoupling = store.tool === 'coupling'

  const handleDragStart = (e: React.DragEvent, itemType: 'tgv_loco' | 'tgv_wagon') => {
    e.dataTransfer.setData('application/open-rails-train', itemType)
    e.dataTransfer.setData('text/plain', itemType)
    e.dataTransfer.effectAllowed = 'copy'
    store.startTrainDrag(itemType, { x: e.clientX, y: e.clientY })
  }

  return (
    <div
      className="train-builder-palette"
      style={{
        pointerEvents: 'auto',
        background: 'rgba(15, 23, 42, 0.92)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: '12px',
        padding: '10px 14px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        minWidth: '300px',
        maxWidth: '400px',
        color: '#f8fafc',
        animation: 'hud-pop 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        paddingBottom: '6px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '12.5px', color: '#38bdf8' }}>
          <span>🚄</span>
          <span>Atelier Train</span>
        </div>
        {hasTrains && (
          <span style={{
            fontSize: '10px',
            padding: '2px 6px',
            borderRadius: '4px',
            background: 'rgba(16, 185, 129, 0.2)',
            color: '#34d399',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            fontWeight: 600,
          }}>
            {store.trains.length > 0
              ? `${store.trains.length} rame${store.trains.length > 1 ? 's' : ''}`
              : 'Train sur voie'}
          </span>
        )}
      </div>

      {/* Drag cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>

        {/* Card 1: Locomotive */}
        <div
          draggable
          onDragStart={(e) => handleDragStart(e, 'tgv_loco')}
          onPointerDown={(e) => {
            if (e.button === 0) store.startTrainDrag('tgv_loco', { x: e.clientX, y: e.clientY })
          }}
          style={{
            background: 'rgba(30, 41, 59, 0.7)',
            border: '1.5px dashed #475569',
            borderRadius: '8px',
            padding: '8px',
            cursor: 'grab',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            transition: 'border-color 0.15s',
            userSelect: 'none',
          }}
          title="Glisser une locomotive sur la voie"
        >
          {/* TGV loco miniature */}
          <svg viewBox="0 0 100 36" width="100" height="36" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' }}>
            <polygon points="4,18 16,10 88,10 88,26 4,26" fill="#1e3a5f" stroke="#0f172a" strokeWidth="1.5" />
            <rect x="16" y="10" width="72" height="16" rx="0" fill="#1d4ed8" />
            <rect x="16" y="14" width="72" height="5" fill="#2563eb" />
            <rect x="20" y="11" width="9" height="4" rx="0.5" fill="#0f172a" />
            <rect x="32" y="11" width="9" height="4" rx="0.5" fill="#0f172a" />
            <rect x="44" y="11" width="9" height="4" rx="0.5" fill="#0f172a" />
            <polygon points="4,18 16,10 16,26" fill="#1e40af" />
            <rect x="20" y="26" width="16" height="5" rx="1.5" fill="#334155" />
            <circle cx="23" cy="31" r="3" fill="#64748b" stroke="#0f172a" strokeWidth="1" />
            <circle cx="33" cy="31" r="3" fill="#64748b" stroke="#0f172a" strokeWidth="1" />
            <rect x="68" y="26" width="16" height="5" rx="1.5" fill="#334155" />
            <circle cx="71" cy="31" r="3" fill="#64748b" stroke="#0f172a" strokeWidth="1" />
            <circle cx="81" cy="31" r="3" fill="#64748b" stroke="#0f172a" strokeWidth="1" />
          </svg>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#f8fafc' }}>Motrice</div>
            <div style={{ fontSize: '9.5px', color: '#94a3b8' }}>Glisser sur la voie</div>
          </div>
        </div>

        {/* Card 2: Wagon */}
        <div
          draggable
          onDragStart={(e) => handleDragStart(e, 'tgv_wagon')}
          onPointerDown={(e) => {
            if (e.button === 0) store.startTrainDrag('tgv_wagon', { x: e.clientX, y: e.clientY })
          }}
          style={{
            background: 'rgba(30, 41, 59, 0.7)',
            border: '1.5px dashed #475569',
            borderRadius: '8px',
            padding: '8px',
            cursor: 'grab',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '6px',
            transition: 'border-color 0.15s',
            userSelect: 'none',
          }}
          title="Glisser un wagon sur la voie, puis toucher une motrice pour coupler"
        >
          {/* Wagon miniature */}
          <svg viewBox="0 0 100 36" width="100" height="36" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' }}>
            <rect x="2" y="12" width="6" height="14" fill="#1e293b" stroke="#475569" strokeWidth="1" />
            <rect x="8" y="10" width="84" height="16" rx="2" fill="#e2e8f0" stroke="#0f172a" strokeWidth="1.5" />
            <rect x="8" y="14" width="84" height="5" fill="#2563eb" />
            <rect x="14" y="12" width="10" height="4" rx="0.5" fill="#0f172a" />
            <rect x="28" y="12" width="10" height="4" rx="0.5" fill="#0f172a" />
            <rect x="42" y="12" width="10" height="4" rx="0.5" fill="#0f172a" />
            <rect x="56" y="12" width="10" height="4" rx="0.5" fill="#0f172a" />
            <rect x="70" y="12" width="10" height="4" rx="0.5" fill="#0f172a" />
            <rect x="92" y="12" width="6" height="14" fill="#1e293b" stroke="#475569" strokeWidth="1" />
            <rect x="16" y="26" width="16" height="5" rx="1.5" fill="#334155" />
            <circle cx="19" cy="31" r="3" fill="#64748b" stroke="#0f172a" strokeWidth="1" />
            <circle cx="29" cy="31" r="3" fill="#64748b" stroke="#0f172a" strokeWidth="1" />
            <rect x="68" y="26" width="16" height="5" rx="1.5" fill="#334155" />
            <circle cx="71" cy="31" r="3" fill="#64748b" stroke="#0f172a" strokeWidth="1" />
            <circle cx="81" cy="31" r="3" fill="#64748b" stroke="#0f172a" strokeWidth="1" />
          </svg>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#f8fafc' }}>Wagon</div>
            <div style={{ fontSize: '9.5px', color: '#94a3b8' }}>Glisser sur la voie</div>
          </div>
        </div>
      </div>

      {/* Action buttons row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        paddingTop: '4px',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        flexWrap: 'wrap',
      }}>

        {/* Coupling mode toggle */}
        <button
          onClick={() => store.toggleCouplingMode()}
          style={{
            flex: 1,
            background: isCoupling ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
            border: `1px solid ${isCoupling ? '#38bdf8' : '#475569'}`,
            borderRadius: '5px',
            color: isCoupling ? '#38bdf8' : '#94a3b8',
            fontSize: '11px',
            fontWeight: isCoupling ? 700 : 400,
            padding: '4px 8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
          title="Mode couplage : toucher deux extrémités pour coupler / cliquer un joint pour découpler"
        >
          🔗 Coupler
        </button>

        {/* Debug skeleton */}
        {hasTrains && (
          <button
            onClick={() => store.toggleTrainDebug()}
            style={{
              background: store.showTrainDebug ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
              border: `1px solid ${store.showTrainDebug ? '#38bdf8' : '#475569'}`,
              borderRadius: '4px',
              color: store.showTrainDebug ? '#38bdf8' : '#94a3b8',
              fontSize: '11px',
              padding: '4px 7px',
              cursor: 'pointer',
            }}
            title="Mode squelette debug (D)"
          >
            ⚙ Debug
          </button>
        )}

        {/* Pilot button */}
        {(store.locomotive !== null || store.trains.length > 0) && (
          <button
            onClick={() => store.togglePlayMode()}
            style={{
              background: store.isPlayMode
                ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              border: `1px solid ${store.isPlayMode ? '#f87171' : '#34d399'}`,
              borderRadius: '5px',
              color: '#fff',
              fontSize: '11.5px',
              fontWeight: 700,
              padding: '4px 10px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
            title="Prendre les commandes (F5)"
          >
            <span>{store.isPlayMode ? '⏹' : '🎮'}</span>
            <span>{store.isPlayMode ? 'Stop' : 'Piloter'}</span>
          </button>
        )}
      </div>

      {/* Train debug sub-layer toggles */}
      {hasTrains && store.showTrainDebug && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '4px',
          padding: '6px',
          background: 'rgba(15, 23, 42, 0.75)',
          borderRadius: '6px',
          border: '1px solid rgba(56, 189, 248, 0.25)',
        }}>
          {[
            { key: 'vectors', label: '↗ Vecteurs', title: 'Vitesse V, accélération a, centrifuge ac, ruban d’arrêt' },
            { key: 'yawAngles', label: '∠ Angles Δθ', title: 'Angles de lacet bogies et articulation inter-caisses' },
            { key: 'gauge', label: '📐 Gabarit', title: 'Gabarit cinématique de libre passage et balayage' },
            { key: 'lookahead', label: '🔭 Trajet 50m', title: 'Projection anticipée et détection heurtoir / fin de voie' },
            { key: 'xray', label: '🩻 Rayons X', title: 'Carrosserie transparente laissant voir les essieux' },
          ].map(({ key, label, title }) => {
            const active = store.trainDebugOptions[key as keyof TrainDebugOptions]
            return (
              <button
                key={key}
                onClick={() => store.toggleTrainDebugOption(key as keyof TrainDebugOptions)}
                style={{
                  background: active ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                  border: `1px solid ${active ? '#38bdf8' : 'rgba(255, 255, 255, 0.08)'}`,
                  borderRadius: '4px',
                  color: active ? '#e0f2fe' : '#64748b',
                  fontSize: '9.5px',
                  fontWeight: active ? 600 : 400,
                  padding: '3px 2px',
                  cursor: 'pointer',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                }}
                title={title}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/* Coupling mode hint */}
      {isCoupling && (
        <div style={{
          fontSize: '10px',
          color: '#38bdf8',
          background: 'rgba(56, 189, 248, 0.08)',
          border: '1px solid rgba(56, 189, 248, 0.2)',
          borderRadius: '6px',
          padding: '5px 8px',
          textAlign: 'center',
        }}>
          🔗 Cliquer deux extrémités proches pour coupler · Cliquer un joint pour découpler
        </div>
      )}
    </div>
  )
}
