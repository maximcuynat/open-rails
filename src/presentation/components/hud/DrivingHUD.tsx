import type { CSSProperties } from 'react'
import type { EditorStore, TrainDebugOptions } from '@application/state/editorStore'
import type { Reverser, TrainSet } from '@domain/models/train'
import { MAX_NOTCH, commandedAcceleration, isTrainStopped } from '@domain/models/train'

interface DrivingHUDProps {
  store: EditorStore
}

const GREEN = '#22c55e'
const RED = '#ef4444'
const AMBER = '#f59e0b'
const MUTED = '#64748b'

const REVERSER_POSITIONS: { value: Reverser; label: string; title: string }[] = [
  { value: 'reverse', label: 'AR', title: 'Marche arrière' },
  { value: 'neutral', label: 'N', title: 'Neutre' },
  { value: 'forward', label: 'AV', title: 'Marche avant' },
]

/** Handle positions from full traction down to full service brake */
const NOTCHES = Array.from({ length: 2 * MAX_NOTCH + 1 }, (_, i) => MAX_NOTCH - i)

const TRAIN_COMMANDS: [keys: string, action: string][] = [
  ['↑ / ↓', 'Cran traction / frein'],
  ['Maj + ↑ / ↓', 'Inverseur AV / AR'],
  ['⌫', 'Arrêt d’urgence'],
  ['← / →', 'Aiguillage gauche / droite'],
  ['D', 'Squelette debug'],
  ['Espace', 'Quitter le pilotage'],
]

const LEGACY_COMMANDS: [keys: string, action: string][] = [
  ['↑ / ↓', 'Accélérer / freiner (maintenir)'],
  ['R', 'Inverser le sens'],
  ['← / →', 'Aiguillage gauche / droite'],
  ['D', 'Squelette debug'],
  ['Espace', 'Quitter le pilotage'],
]

const sectionLabel: CSSProperties = {
  fontSize: '9px',
  color: MUTED,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: '4px',
}

const kbd: CSSProperties = {
  justifySelf: 'start',
  padding: '1px 5px',
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: '4px',
  color: '#e2e8f0',
  fontSize: '10px',
  whiteSpace: 'nowrap',
}

function notchLabel(notch: number): string {
  return notch > 0 ? `P${notch}` : notch < 0 ? `B${-notch}` : 'N'
}

/** What the train is doing right now, for the status line under the speed */
function driveStatus(train: TrainSet): { label: string; color: string } {
  if (train.emergencyBrake) return { label: 'ARRÊT D’URGENCE', color: RED }
  if (train.notch < 0) return { label: `FREINAGE ${notchLabel(train.notch)}`, color: RED }
  if (train.notch > 0) {
    return train.reverser === 'neutral'
      ? { label: 'INVERSEUR AU NEUTRE', color: AMBER }
      : { label: `TRACTION ${notchLabel(train.notch)}`, color: GREEN }
  }
  return isTrainStopped(train) ? { label: 'À L’ARRÊT', color: MUTED } : { label: 'INERTIE', color: '#06b6d4' }
}

/**
 * DrivingHUD — piloting panel shown bottom-right in play mode: speed, reverser,
 * combined power/brake handle, emergency brake and the keyboard commands.
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

  const locoCount = train?.vehicles.filter(v => v.kind === 'loco').length ?? 1
  const wagonCount = train ? train.vehicles.filter(v => v.kind === 'wagon').length : (store.locomotive?.wagonCount ?? 0)

  const speedRatio = Math.min(kmh / Math.max(maxKmh, 1), 1)

  const speedColor = kmh > maxKmh * 0.85
    ? RED
    : kmh > maxKmh * 0.6
    ? AMBER
    : GREEN

  const legacyThrottle = store.locomotiveThrottle
  const status = train
    ? driveStatus(train)
    : legacyThrottle === 1
    ? { label: 'ACCÉLÉRATION', color: GREEN }
    : legacyThrottle === -1
    ? { label: 'FREINAGE', color: RED }
    : { label: 'INERTIE', color: MUTED }

  const accel = train ? commandedAcceleration(train) : 0
  const reverserLocked = train ? !isTrainStopped(train) || train.notch > 0 : false
  const emergencyReleasable = train ? train.emergencyBrake && isTrainStopped(train) : false

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        right: '16px',
        width: '300px',
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

        {/* Train switcher for multi-train fleet */}
        {store.trains.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto', marginRight: '6px' }}>
            <button
              onClick={() => {
                const curIdx = store.trains.findIndex(t => t.id === store.selectedTrainId)
                const nextIdx = (curIdx - 1 + store.trains.length) % store.trains.length
                store.selectTrainById(store.trains[nextIdx].id)
              }}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '4px',
                color: '#94a3b8',
                fontSize: '10px',
                padding: '2px 5px',
                cursor: 'pointer',
              }}
              title="Train précédent"
            >
              ◀
            </button>
            <span style={{ fontSize: '10px', color: '#38bdf8', fontWeight: 600 }}>
              {(store.trains.findIndex(t => t.id === store.selectedTrainId) + 1)}/{store.trains.length}
            </span>
            <button
              onClick={() => {
                const curIdx = store.trains.findIndex(t => t.id === store.selectedTrainId)
                const nextIdx = (curIdx + 1) % store.trains.length
                store.selectTrainById(store.trains[nextIdx].id)
              }}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '4px',
                color: '#94a3b8',
                fontSize: '10px',
                padding: '2px 5px',
                cursor: 'pointer',
              }}
              title="Train suivant"
            >
              ▶
            </button>
          </div>
        )}

        {/* Exit play mode */}
        <button
          onClick={() => store.togglePlayMode()}
          style={{
            marginLeft: store.trains.length > 1 ? '0' : 'auto',
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

      <div style={{ display: 'flex', gap: '12px', marginBottom: '10px' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Speed */}
          <div>
            <div style={sectionLabel}>Vitesse</div>
            <div style={{ fontSize: '30px', fontWeight: 800, color: speedColor, lineHeight: 1, letterSpacing: '-0.02em' }}>
              {kmh}
              <span style={{ fontSize: '11px', fontWeight: 400, color: '#94a3b8', marginLeft: '4px' }}>km/h</span>
            </div>
            <div style={{
              height: '6px',
              marginTop: '6px',
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
            <div style={{ fontSize: '9px', color: '#475569', marginTop: '2px', textAlign: 'right' }}>max {maxKmh} km/h</div>
          </div>

          {/* Drive status */}
          <div style={{
            padding: '5px 8px',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: '6px',
            border: `1px solid ${status.color}55`,
          }}>
            <div style={{ fontSize: '11px', color: status.color, fontWeight: 700 }}>{status.label}</div>
            {train && (
              <div style={{ fontSize: '9px', color: '#94a3b8', marginTop: '2px' }}>
                a = {accel > 0 ? '+' : ''}{accel.toFixed(1)} m/s²
              </div>
            )}
          </div>

          {/* Reverser */}
          {train && (
            <div>
              <div style={sectionLabel}>Inverseur{reverserLocked ? ' · verrouillé' : ''}</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {REVERSER_POSITIONS.map(({ value, label, title }) => {
                  const active = train.reverser === value
                  return (
                    <button
                      key={value}
                      onClick={() => store.setSelectedTrainReverser(value)}
                      disabled={reverserLocked && !active}
                      style={{
                        flex: 1,
                        background: active ? 'rgba(167, 139, 250, 0.25)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${active ? '#a78bfa' : 'rgba(255,255,255,0.1)'}`,
                        borderRadius: '6px',
                        color: active ? '#ede9fe' : MUTED,
                        fontSize: '11px',
                        fontWeight: active ? 700 : 400,
                        padding: '5px 0',
                        cursor: reverserLocked && !active ? 'not-allowed' : 'pointer',
                        opacity: reverserLocked && !active ? 0.45 : 1,
                        fontFamily: 'monospace',
                      }}
                      title={reverserLocked ? `${title} — à l’arrêt, manipulateur hors traction` : title}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Emergency brake */}
          {train && (
            <button
              onClick={() => store.toggleSelectedTrainEmergencyBrake()}
              style={{
                background: train.emergencyBrake ? RED : 'rgba(239, 68, 68, 0.15)',
                border: `1px solid ${RED}`,
                borderRadius: '6px',
                color: train.emergencyBrake ? '#fff' : RED,
                fontSize: '11px',
                fontWeight: 700,
                padding: '7px 0',
                cursor: 'pointer',
                fontFamily: 'monospace',
              }}
              title="Arrêt d’urgence (Retour arrière)"
            >
              {!train.emergencyBrake ? '⛔ ARRÊT D’URGENCE' : emergencyReleasable ? 'RÉARMER' : 'URGENCE EN COURS…'}
            </button>
          )}
        </div>

        {/* Combined power / brake handle */}
        {train && (
          <div style={{ width: '56px' }}>
            <div style={sectionLabel}>Manip.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {NOTCHES.map(n => {
                const active = train.notch === n
                // Cells between N and the current notch are lit, like a bar graph
                const lit = n !== 0 && Math.sign(n) === Math.sign(train.notch) && Math.abs(n) <= Math.abs(train.notch)
                const color = n > 0 ? GREEN : n < 0 ? RED : '#94a3b8'
                return (
                  <button
                    key={n}
                    onClick={() => store.setSelectedTrainNotch(n)}
                    style={{
                      height: '17px',
                      background: active ? color : lit ? `${color}40` : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${active || lit ? color : 'rgba(255,255,255,0.08)'}`,
                      borderRadius: '3px',
                      color: active ? '#0a0f1c' : color,
                      fontSize: '10px',
                      fontWeight: active ? 800 : 500,
                      lineHeight: 1,
                      padding: 0,
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                    }}
                    title={n > 0 ? `Traction cran ${n}` : n < 0 ? `Frein cran ${-n}` : 'Neutre'}
                  >
                    {notchLabel(n)}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Tools */}
      <div style={{ display: 'flex', gap: '6px' }}>
        {!train && (
          <button
            onClick={() => store.flipLocomotiveDirection()}
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
        )}

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
            color: store.showTrainDebug ? '#38bdf8' : MUTED,
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

      {/* Sous-options du mode debug */}
      {store.showTrainDebug && (
        <div style={{
          marginTop: '6px',
          padding: '5px',
          background: 'rgba(15, 23, 42, 0.75)',
          borderRadius: '6px',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '4px',
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
                  fontSize: '9px',
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

      {/* Keyboard commands */}
      <div style={{
        marginTop: '10px',
        paddingTop: '8px',
        borderTop: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={sectionLabel}>Commandes</div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          columnGap: '8px',
          rowGap: '3px',
          alignItems: 'center',
          fontSize: '10px',
          color: '#94a3b8',
        }}>
          {(train ? TRAIN_COMMANDS : LEGACY_COMMANDS).flatMap(([keys, action]) => [
            <span key={keys} style={kbd}>{keys}</span>,
            <span key={action}>{action}</span>,
          ])}
        </div>
      </div>
    </div>
  )
}
