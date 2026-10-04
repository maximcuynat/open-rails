import type { CSSProperties } from 'react'
import type { EditorStore, TrainDebugOptions } from '@application/state/editorStore'
import type { Reverser, TrainSet } from '@domain/models/train'
import { MAX_NOTCH, commandedAcceleration, isTrainStopped, stoppingDistance } from '@domain/models/train'
import { formatDistance } from '@domain/models/units'
import type { ActionId } from '@application/keybindings/keybindings'

interface DrivingHUDProps {
  store: EditorStore
}

const HUD_WIDTH = 220
const HUD_MARGIN = 12
/** Width the console takes at the bottom-right of the canvas: what is drawn there moves left of it. */
export const DRIVING_HUD_FOOTPRINT = HUD_WIDTH + HUD_MARGIN

const GREEN = '#22c55e'
const RED = '#ef4444'
const MUTED = '#64748b'

const REVERSER_ORDER: Reverser[] = ['reverse', 'neutral', 'forward']
const REVERSER_LABEL: Record<Reverser, string> = { forward: '▲ AV', neutral: 'N', reverse: '▼ AR' }

const TRAIN_COMMANDS: [actions: ActionId[], label: string][] = [
  [['drive.notchUp', 'drive.notchDown'], 'Cran'],
  [['drive.reverserForward', 'drive.reverserBackward'], 'Inverseur'],
  [['drive.emergencyBrake'], 'Urgence'],
  [['drive.steerLeft', 'drive.steerRight'], 'Aiguillage'],
  [['train.debug'], 'Debug'],
  [['drive.exit'], 'Quitter'],
]

const LEGACY_COMMANDS: [actions: ActionId[], label: string][] = [
  [['drive.notchUp', 'drive.notchDown'], 'Accél. / frein'],
  [['drive.flipLegacy'], 'Inverser'],
  [['drive.steerLeft', 'drive.steerRight'], 'Aiguillage'],
  [['train.debug'], 'Debug'],
  [['drive.exit'], 'Quitter'],
]

// Speed dial geometry (SVG user units). Angles in degrees, clockwise from +x.
const DIAL_W = 200
const DIAL_H = 122
const DIAL_CX = 100
const DIAL_CY = 92
const DIAL_R = 78
const DIAL_START = 160
const DIAL_SWEEP = 220
const DIAL_TICKS = 5

function dialPoint(ratio: number, radius: number): { x: number; y: number } {
  const a = ((DIAL_START + DIAL_SWEEP * ratio) * Math.PI) / 180
  return { x: DIAL_CX + radius * Math.cos(a), y: DIAL_CY + radius * Math.sin(a) }
}

/** SVG path of the dial arc from 0 up to `ratio` (0..1) of the full scale */
function dialArc(ratio: number): string {
  const from = dialPoint(0, DIAL_R)
  const to = dialPoint(ratio, DIAL_R)
  const largeArc = DIAL_SWEEP * ratio > 180 ? 1 : 0
  return `M ${from.x} ${from.y} A ${DIAL_R} ${DIAL_R} 0 ${largeArc} 1 ${to.x} ${to.y}`
}

const panel: CSSProperties = {
  background: 'rgba(10, 15, 28, 0.92)',
  backdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '10px',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
}

const iconButton: CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: '4px',
  color: '#94a3b8',
  fontSize: '10px',
  lineHeight: 1,
  padding: '3px 5px',
  cursor: 'pointer',
  fontFamily: 'monospace',
}

const kbd: CSSProperties = {
  padding: '0 4px',
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.16)',
  borderRadius: '3px',
  color: '#e2e8f0',
  whiteSpace: 'nowrap',
}

/** Text and colour of the single handle field: P1..P5, N, B1..B5 or URG */
function handleField(train: TrainSet): { label: string; color: string; fill: number } {
  if (train.emergencyBrake) return { label: 'URG', color: RED, fill: 1 }
  const fill = Math.abs(train.notch) / MAX_NOTCH
  if (train.notch > 0) return { label: `P${train.notch}`, color: GREEN, fill }
  if (train.notch < 0) return { label: `B${-train.notch}`, color: RED, fill }
  return { label: 'N', color: '#94a3b8', fill: 0 }
}

/**
 * DrivingHUD — compact piloting panel shown bottom-right in play mode: keyboard
 * commands on top, then a speed dial with the reverser, the handle notch and
 * the emergency brake.
 */
export function DrivingHUD({ store }: DrivingHUDProps) {
  const train = store.selectedTrain
  if (!store.isPlayMode) return null

  const speed = train ? train.currentSpeed : store.locomotiveCurrentSpeed
  const maxSpeed = train ? train.maxSpeed : store.locomotiveMaxSpeed
  const kmh = Math.round(speed * 3.6)
  const maxKmh = Math.round(maxSpeed * 3.6)
  const speedRatio = Math.min(speed / Math.max(maxSpeed, 1e-6), 1)

  const locoCount = train?.vehicles.filter(v => v.kind === 'loco').length ?? 1
  const wagonCount = train ? train.vehicles.filter(v => v.kind === 'wagon').length : (store.locomotive?.wagonCount ?? 0)

  const legacyThrottle = store.locomotiveThrottle
  const field = train
    ? handleField(train)
    : legacyThrottle === 1
    ? { label: 'ACCÉL.', color: GREEN, fill: 1 }
    : legacyThrottle === -1
    ? { label: 'FREIN', color: RED, fill: 1 }
    : { label: 'INERTIE', color: '#94a3b8', fill: 0 }

  const accel = train ? commandedAcceleration(train) : 0
  const reverserLocked = train ? !isTrainStopped(train) || train.notch > 0 : false
  const emergencyReleasable = train ? train.emergencyBrake && isTrainStopped(train) : false
  // Traction asked for with the reverser in neutral: flag the reverser, nothing will move
  const reverserNeeded = train ? train.notch > 0 && train.reverser === 'neutral' : false

  const selectTrainByOffset = (offset: number) => {
    const curIdx = store.trains.findIndex(t => t.id === store.selectedTrainId)
    const nextIdx = (curIdx + offset + store.trains.length) % store.trains.length
    store.selectTrainById(store.trains[nextIdx].id)
  }

  const stepButton: CSSProperties = { ...iconButton, width: '26px', fontSize: '14px', padding: 0 }

  return (
    <div
      style={{
        // Bottom-right corner of the canvas area (its parent), below menus and dialogs
        position: 'absolute',
        bottom: `${HUD_MARGIN}px`,
        right: `${HUD_MARGIN}px`,
        width: `${HUD_WIDTH}px`,
        maxHeight: `calc(100% - ${2 * HUD_MARGIN}px)`,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        color: '#f8fafc',
        fontFamily: 'monospace',
        zIndex: 'var(--z-driving)',
        userSelect: 'none',
      }}
    >
      {/* Keyboard commands */}
      <div style={{
        ...panel,
        padding: '6px 8px',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        columnGap: '8px',
        rowGap: '3px',
        fontSize: '9px',
        color: '#94a3b8',
      }}>
        {(train ? TRAIN_COMMANDS : LEGACY_COMMANDS).map(([actions, label]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
            <span style={kbd}>{actions.map((a) => store.shortcutLabel(a) || '—').join(' ')}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ ...panel, padding: '8px 10px' }}>
        {/* Header — train identity and tools */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span
            style={{ fontSize: '10px', color: '#cbd5e1', marginRight: 'auto', whiteSpace: 'nowrap' }}
            title={`${locoCount} motrice${locoCount > 1 ? 's' : ''}, ${wagonCount} voiture${wagonCount > 1 ? 's' : ''}`}
          >
            🚂 {locoCount}M · {wagonCount}V
          </span>

          {/* Train switcher for multi-train fleet */}
          {store.trains.length > 1 && (
            <>
              <button onClick={() => selectTrainByOffset(-1)} style={iconButton} title="Train précédent">◀</button>
              <span style={{ fontSize: '10px', color: '#38bdf8', fontWeight: 600 }}>
                {store.trains.findIndex(t => t.id === store.selectedTrainId) + 1}/{store.trains.length}
              </span>
              <button onClick={() => selectTrainByOffset(1)} style={iconButton} title="Train suivant">▶</button>
            </>
          )}

          <button
            onClick={() => {
              store.togglePlayMode()
              store.toggleCouplingMode()
            }}
            style={iconButton}
            title="Mode couplage"
          >
            🔗
          </button>
          <button
            onClick={() => store.toggleTrainDebug()}
            style={{
              ...iconButton,
              color: store.showTrainDebug ? '#38bdf8' : '#94a3b8',
              borderColor: store.showTrainDebug ? '#38bdf8' : 'rgba(255,255,255,0.15)',
            }}
            title={`Squelette debug${store.shortcutHint('train.debug')}`}
          >
            ⚙
          </button>
          <button
            onClick={() => store.togglePlayMode()}
            style={{ ...iconButton, color: RED, borderColor: 'rgba(239, 68, 68, 0.4)' }}
            title={`Quitter le mode pilotage${store.shortcutHint('drive.exit')}`}
          >
            ✕
          </button>
        </div>

        {/* Speed dial */}
        <div style={{ position: 'relative', marginTop: '2px' }}>
          <svg viewBox={`0 0 ${DIAL_W} ${DIAL_H}`} style={{ display: 'block', width: '100%' }}>
            <path d={dialArc(1)} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={6} strokeLinecap="round" />
            {speedRatio > 0.001 && (
              <path d={dialArc(speedRatio)} fill="none" stroke="#38bdf8" strokeWidth={6} strokeLinecap="round" />
            )}
            {Array.from({ length: DIAL_TICKS + 1 }, (_, i) => {
              const ratio = i / DIAL_TICKS
              const inner = dialPoint(ratio, DIAL_R - 9)
              const outer = dialPoint(ratio, DIAL_R - 5)
              const label = dialPoint(ratio, DIAL_R - 18)
              return (
                <g key={i}>
                  <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="#64748b" strokeWidth={1} />
                  <text x={label.x} y={label.y} fill="#64748b" fontSize={8} textAnchor="middle" dominantBaseline="middle">
                    {Math.round(maxKmh * ratio)}
                  </text>
                </g>
              )
            })}
            {/* Max speed marker */}
            <circle cx={dialPoint(1, DIAL_R).x} cy={dialPoint(1, DIAL_R).y} r={4} fill={RED} />
          </svg>

          <div style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: '6px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
          }}>
            {train ? (
              <button
                onClick={() => store.setSelectedTrainReverser(
                  REVERSER_ORDER[(REVERSER_ORDER.indexOf(train.reverser) + 1) % REVERSER_ORDER.length]
                )}
                disabled={reverserLocked}
                style={{
                  ...iconButton,
                  color: train.reverser === 'neutral' ? '#94a3b8' : '#ede9fe',
                  borderColor: reverserNeeded ? '#f59e0b' : train.reverser === 'neutral' ? 'rgba(255,255,255,0.15)' : '#a78bfa',
                  background: train.reverser === 'neutral' ? 'rgba(255,255,255,0.06)' : 'rgba(167, 139, 250, 0.25)',
                  fontWeight: 700,
                  minWidth: '44px',
                  cursor: reverserLocked ? 'not-allowed' : 'pointer',
                }}
                title={reverserLocked
                  ? 'Inverseur verrouillé : à l’arrêt, manipulateur hors traction'
                  : `Inverseur (${store.shortcutLabel('drive.reverserForward') || '—'} / ${store.shortcutLabel('drive.reverserBackward') || '—'})`}
              >
                {REVERSER_LABEL[train.reverser]}
              </button>
            ) : (
              <button onClick={() => store.flipLocomotiveDirection()} style={iconButton} title={`Inverser le sens${store.shortcutHint('drive.flipLegacy')}`}>
                ⇄ Sens
              </button>
            )}
            <div style={{ fontSize: '32px', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em' }}>{kmh}</div>
            <div style={{ fontSize: '9px', color: '#94a3b8' }}>km/h</div>
          </div>
        </div>

        {/* Handle notch — single field */}
        <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
          {train && (
            <button onClick={() => store.stepSelectedTrainNotch(-1)} style={stepButton} title={`Un cran vers le frein${store.shortcutHint('drive.notchDown')}`}>
              −
            </button>
          )}
          <div
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: '16px',
              fontWeight: 800,
              padding: '3px 0',
              borderRadius: '6px',
              border: `1px solid ${field.color}`,
              // Tint deepens with the notch
              background: `${field.color}${Math.round(field.fill * 0.6 * 255).toString(16).padStart(2, '0')}`,
              color: field.fill > 0.7 ? '#fff' : field.color,
            }}
            title="Manipulateur traction / frein"
          >
            {field.label}
          </div>
          {train && (
            <button onClick={() => store.stepSelectedTrainNotch(1)} style={stepButton} title={`Un cran vers la traction${store.shortcutHint('drive.notchUp')}`}>
              +
            </button>
          )}
        </div>

        {train && (
          <>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '5px',
              fontSize: '9px',
              color: '#94a3b8',
            }}>
              <span>{accel > 0 ? '+' : ''}{accel.toFixed(1)} m/s²</span>
              <span title="Distance d’arrêt au frein maximal">arrêt {formatDistance(stoppingDistance(train), 'm', 0)}</span>
            </div>

            {/* Emergency brake */}
            <button
              onClick={() => store.toggleSelectedTrainEmergencyBrake()}
              style={{
                width: '100%',
                marginTop: '6px',
                background: train.emergencyBrake ? RED : 'rgba(239, 68, 68, 0.15)',
                border: `1px solid ${RED}`,
                borderRadius: '6px',
                color: train.emergencyBrake ? '#fff' : RED,
                fontSize: '10px',
                fontWeight: 700,
                padding: '5px 0',
                cursor: 'pointer',
                fontFamily: 'monospace',
              }}
              title={`Arrêt d’urgence${store.shortcutHint('drive.emergencyBrake')}`}
            >
              {!train.emergencyBrake ? '⛔ ARRÊT D’URGENCE' : emergencyReleasable ? 'RÉARMER' : 'URGENCE EN COURS…'}
            </button>
          </>
        )}

        {/* Sous-options du mode debug */}
        {store.showTrainDebug && (
          <div style={{
            marginTop: '6px',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '3px',
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
                    color: active ? '#e0f2fe' : MUTED,
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
      </div>
    </div>
  )
}
