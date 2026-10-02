import type { EditorStore } from '@application/state/editorStore'

interface DrivingHUDProps {
  store: EditorStore
}

/**
 * DrivingHUD — compact piloting panel shown bottom-right in play mode.
 * Replaces the StatusBar technical info while driving.
 */
export function DrivingHUD({ store }: DrivingHUDProps) {
  const train = store.selectedTrain
  if (!store.isPlayMode) return null

  const kmh = train
    ? Math.round(train.currentSpeed * 3.6)
    : Math.round(store.locomotiveCurrentSpeed * 3.6)

  const maxKmh = train
    ? Math.round(train.maxSpeed * 3.6)
    : Math.round(store.locomotiveMaxSpeed * 3.6)

  const throttle = train?.throttle ?? store.locomotiveThrottle
  const locoCount = train?.vehicles.filter(v => v.kind === 'loco').length ?? 1
  const wagonCount = train ? train.vehicles.filter(v => v.kind === 'wagon').length : (store.locomotive?.wagonCount ?? 0)

  const speedRatio = Math.min(kmh / Math.max(maxKmh, 1), 1)

  const speedColor = kmh > maxKmh * 0.85
    ? '#ef4444'
    : kmh > maxKmh * 0.6
    ? '#f59e0b'
    : '#22c55e'

  const throttleLabel = throttle === 1 ? '▲ Accélération' : throttle === -1 ? '▼ Freinage' : '— Inertie'
  const throttleColor = throttle === 1 ? '#22c55e' : throttle === -1 ? '#ef4444' : '#64748b'

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        width: '280px',
        background: 'rgba(10, 15, 28, 0.92)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '12px',
        padding: '14px 16px',
        color: '#f8fafc',
        fontFamily: 'monospace',
        zIndex: 1000,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        userSelect: 'none',
      }}
    >
      {/* Header — train identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <span style={{ fontSize: '18px' }}>🚂</span>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: '#f8fafc', letterSpacing: '0.04em' }}>
            {train ? `Train · ${locoCount} motrice${locoCount > 1 ? 's' : ''}` : 'Locomotive'}
          </div>
          <div style={{ fontSize: '10px', color: '#64748b' }}>
            {wagonCount > 0
              ? `${wagonCount} voiture${wagonCount > 1 ? 's' : ''} voyageur`
              : 'sans wagon'}
          </div>
        </div>
        {/* Exit play mode */}
        <button
          onClick={() => store.togglePlayMode()}
          style={{
            marginLeft: 'auto',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '6px',
            color: '#ef4444',
            fontSize: '10px',
            padding: '3px 7px',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
          title="Quitter le mode pilotage (Espace)"
        >
          ✕ Stop
        </button>
      </div>

      {/* Speed bar */}
      <div style={{ marginBottom: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span style={{ fontSize: '10px', color: '#64748b' }}>Vitesse</span>
          <span style={{
            fontSize: '20px',
            fontWeight: 800,
            color: speedColor,
            lineHeight: 1,
            letterSpacing: '-0.02em',
          }}>
            {kmh}
            <span style={{ fontSize: '11px', fontWeight: 400, color: '#94a3b8', marginLeft: '3px' }}>km/h</span>
          </span>
        </div>
        {/* Progress bar */}
        <div style={{
          height: '6px',
          background: 'rgba(255,255,255,0.08)',
          borderRadius: '3px',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${speedRatio * 100}%`,
            background: speedColor,
            borderRadius: '3px',
            transition: 'width 0.1s ease, background 0.2s ease',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
          <span style={{ fontSize: '9px', color: '#475569' }}>max {maxKmh} km/h</span>
        </div>
      </div>

      {/* Throttle state */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '12px',
        padding: '5px 8px',
        background: 'rgba(255,255,255,0.04)',
        borderRadius: '6px',
        border: `1px solid ${throttleColor}33`,
      }}>
        <span style={{ fontSize: '10px', color: throttleColor, fontWeight: 600 }}>
          {throttleLabel}
        </span>
        <span style={{ fontSize: '9px', color: '#475569', marginLeft: 'auto' }}>
          ↑ accél · ↓ frein
        </span>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '6px' }}>
        {/* Reverse */}
        <button
          onClick={() => {
            if (store.locomotive) store.flipLocomotiveDirection()
          }}
          style={{
            flex: 1,
            background: 'rgba(167, 139, 250, 0.1)',
            border: '1px solid rgba(167, 139, 250, 0.3)',
            borderRadius: '6px',
            color: '#a78bfa',
            fontSize: '10px',
            padding: '5px 0',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
          title="Inverser le sens (R)"
        >
          ⇄ Sens
        </button>

        {/* Coupling mode */}
        <button
          onClick={() => {
            store.togglePlayMode()
            store.toggleCouplingMode()
          }}
          style={{
            flex: 1,
            background: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: '6px',
            color: '#38bdf8',
            fontSize: '10px',
            padding: '5px 0',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
          title="Mode couplage"
        >
          🔗 Coupler
        </button>

        {/* Debug skeleton */}
        <button
          onClick={() => store.toggleTrainDebug()}
          style={{
            flex: 1,
            background: store.showTrainDebug ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${store.showTrainDebug ? '#38bdf8' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: '6px',
            color: store.showTrainDebug ? '#38bdf8' : '#64748b',
            fontSize: '10px',
            padding: '5px 0',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
          title="Squelette debug (D)"
        >
          ⚙ Debug
        </button>
      </div>

      {/* Keyboard hints */}
      <div style={{
        marginTop: '8px',
        paddingTop: '6px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        fontSize: '9px',
        color: '#334155',
        textAlign: 'center',
      }}>
        ↑↓ Accélérer/Freiner · R Inverser · Espace Pause
      </div>
    </div>
  )
}
