import { useEffect, type CSSProperties } from 'react'
import { trainImpactMessage, type EditorStore } from '@application/state/editorStore'
import type { Reverser, TrainSet } from '@domain/models/train'
import { MAX_NOTCH, MIN_NOTCH, isTrainStopped } from '@domain/models/train'
import type { BrakeCommand, TrainDynamics } from '@domain/models/trainDynamics'
import type { ActionId } from '@application/keybindings/keybindings'
import { showToast } from '../common/Toast'
import {
  BRAKE_CYLINDER_GAUGE,
  BRAKE_PIPE_GAUGE,
  accelerationLabel,
  brakeStatus,
  decimal,
  effortPercent,
  gaugeRatio,
  gradientLabel,
  handleEffort,
  isBrakeHolding,
  notchLabel,
  speedDialTicks,
  type BrakeTone,
  type GaugeSpec,
  stoppingDistanceLabel,
} from './drivingHudModel'

interface DrivingHUDProps {
  store: EditorStore
}

const HUD_WIDTH = 220
const HUD_MARGIN = 12
/** Width the dock (console, debug panel) takes at the bottom-right of the canvas: what is drawn there moves left of it. */
export const DRIVING_HUD_FOOTPRINT = HUD_WIDTH + HUD_MARGIN

const GREEN = '#22c55e'
const RED = '#ef4444'
const AMBER = '#f59e0b'

const BRAKE_TONE_COLOR: Record<BrakeTone, string> = {
  released: GREEN,
  releasing: AMBER,
  applying: AMBER,
  applied: RED,
  emergency: RED,
}

const REVERSER_ORDER: Reverser[] = ['reverse', 'neutral', 'forward']
const REVERSER_LABEL: Record<Reverser, string> = { forward: '▲ AV', neutral: 'N', reverse: '▼ AR' }

const TRAIN_COMMANDS: [actions: ActionId[], label: string][] = [
  [['drive.notchUp', 'drive.notchDown'], 'Manipulateur'],
  [['drive.brakeRelease', 'drive.brakeApply'], 'Frein −/+'],
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

/** Text and colour of the handle field: B5..B1, N, P1..P5 with the effort really applied */
function handleField(
  train: TrainSet,
  dynamics: Pick<TrainDynamics, 'tractionEffort' | 'electricBrakeEffort'>,
): { label: string; color: string; fill: number } {
  const label = `${notchLabel(train.notch)} · ${effortPercent(handleEffort(train.notch, dynamics))} %`
  if (train.notch > 0) return { label, color: GREEN, fill: train.notch / MAX_NOTCH }
  if (train.notch < 0) return { label, color: AMBER, fill: train.notch / MIN_NOTCH }
  return { label, color: '#94a3b8', fill: 0 }
}

// Pressure gauge geometry (SVG user units): a half dial, 0 on the left
const GAUGE_W = 92
const GAUGE_H = 54
const GAUGE_CX = 46
const GAUGE_CY = 46
const GAUGE_R = 34

function gaugePoint(ratio: number, radius: number): { x: number; y: number } {
  const a = Math.PI * (1 + ratio)
  return { x: GAUGE_CX + radius * Math.cos(a), y: GAUGE_CY + radius * Math.sin(a) }
}

function gaugeArc(ratio: number): string {
  const from = gaugePoint(0, GAUGE_R)
  const to = gaugePoint(ratio, GAUGE_R)
  return `M ${from.x} ${from.y} A ${GAUGE_R} ${GAUGE_R} 0 0 1 ${to.x} ${to.y}`
}

/** A sober pressure gauge: scale with its marks, needle, value in bar and a caption */
function PressureGauge({ value, spec, caption, title, color }: {
  value: number
  spec: GaugeSpec
  caption: string
  title: string
  color: string
}) {
  const ratio = gaugeRatio(value, spec)
  const needle = gaugePoint(ratio, GAUGE_R - 7)
  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }} title={title}>
      <svg viewBox={`0 0 ${GAUGE_W} ${GAUGE_H}`} style={{ display: 'block', width: '100%' }}>
        <path d={gaugeArc(1)} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={4} strokeLinecap="round" />
        {ratio > 0.005 && <path d={gaugeArc(ratio)} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" />}
        {spec.marks.map((mark) => {
          const r = gaugeRatio(mark, spec)
          const inner = gaugePoint(r, GAUGE_R - 6)
          const outer = gaugePoint(r, GAUGE_R + 3)
          const label = gaugePoint(r, GAUGE_R + 9)
          return (
            <g key={mark}>
              <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="#cbd5e1" strokeWidth={1} />
              <text x={label.x} y={label.y} fill="#94a3b8" fontSize={7} textAnchor="middle" dominantBaseline="middle">
                {decimal(mark, Number.isInteger(mark) ? 0 : 1)}
              </text>
            </g>
          )
        })}
        <line x1={GAUGE_CX} y1={GAUGE_CY} x2={needle.x} y2={needle.y} stroke="#f8fafc" strokeWidth={1.5} strokeLinecap="round" />
        <circle cx={GAUGE_CX} cy={GAUGE_CY} r={2.5} fill="#f8fafc" />
        <text x={GAUGE_CX} y={GAUGE_CY - 12} fill="#f8fafc" fontSize={11} fontWeight={700} textAnchor="middle">
          {decimal(value, 1)}
        </text>
      </svg>
      <div style={{ fontSize: '8px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{caption} · bar</div>
    </div>
  )
}

/** A button that acts for as long as it is pressed, like the key it doubles */
function HoldButton({ label, title, color, active, disabled, onHold, onRelease }: {
  label: string
  title: string
  color: string
  active: boolean
  disabled: boolean
  onHold: () => void
  onRelease: () => void
}) {
  return (
    <button
      disabled={disabled}
      // The pointer is captured: sliding off the button does not drop the handle, releasing does
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        onHold()
      }}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onLostPointerCapture={onRelease}
      style={{
        flex: 1,
        background: active ? color : `${color}26`,
        border: `1px solid ${color}`,
        borderRadius: '6px',
        color: active ? '#fff' : color,
        fontSize: '10px',
        fontWeight: 700,
        padding: '5px 0',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'monospace',
        touchAction: 'none',
      }}
      title={title}
    >
      {label}
    </button>
  )
}

/**
 * DrivingHUD — compact piloting panel shown bottom-right in play mode: keyboard
 * commands on top, then a speed dial with the reverser, the traction handle, the
 * air brake with its two gauges, what the physics does to the train and the
 * emergency brake.
 */
export function DrivingHUD({ store }: DrivingHUDProps) {
  // A train that runs into a buffer stop or another train says so on screen
  useEffect(() => {
    store.onTrainImpact = (_train, speed) => showToast(trainImpactMessage(speed), 'warning')
    return () => {
      store.onTrainImpact = null
    }
  }, [store])

  const train = store.selectedTrain
  if (!store.isPlayMode) return null

  const speed = train ? train.currentSpeed : store.locomotiveCurrentSpeed
  const maxSpeed = train ? train.maxSpeed : store.locomotiveMaxSpeed
  const kmh = Math.round(speed * 3.6)
  const maxKmh = Math.round(maxSpeed * 3.6)
  const speedRatio = Math.min(speed / Math.max(maxSpeed, 1e-6), 1)
  const dynamics = train ? store.selectedTrainDynamics : null
  const brake = train && dynamics ? brakeStatus(train, dynamics) : null

  const locoCount = train?.vehicles.filter(v => v.kind === 'loco').length ?? 1
  const wagonCount = train ? train.vehicles.filter(v => v.kind === 'wagon').length : (store.locomotive?.wagonCount ?? 0)

  const legacyThrottle = store.locomotiveThrottle
  const field = train
    ? handleField(train, dynamics ?? { tractionEffort: 0, electricBrakeEffort: 0 })
    : legacyThrottle === 1
    ? { label: 'ACCÉL.', color: GREEN, fill: 1 }
    : legacyThrottle === -1
    ? { label: 'FREIN', color: RED, fill: 1 }
    : { label: 'INERTIE', color: '#94a3b8', fill: 0 }

  /** Let go of a brake button: the handle only comes back if this button still holds it */
  const releaseBrakeButton = (held: BrakeCommand) => {
    if (store.selectedTrain?.brakeCommand === held) store.setSelectedTrainBrakeCommand('hold')
  }
  const reverserLocked = train ? !isTrainStopped(train) || train.notch !== 0 : false
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
        // Placed by the `.hud-dock` it sits in (bottom-right corner of the canvas area)
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        color: '#f8fafc',
        fontFamily: 'monospace',
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
            {speedDialTicks(maxKmh).map((tickKmh) => {
              const ratio = tickKmh / Math.max(maxKmh, 1)
              const inner = dialPoint(ratio, DIAL_R - 9)
              const outer = dialPoint(ratio, DIAL_R - 5)
              const label = dialPoint(ratio, DIAL_R - 18)
              return (
                <g key={tickKmh}>
                  <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="#64748b" strokeWidth={1} />
                  <text x={label.x} y={label.y} fill="#64748b" fontSize={8} textAnchor="middle" dominantBaseline="middle">
                    {tickKmh}
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

        {/* Traction and electric brake handle (legacy locomotive: throttle state) */}
        <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
          {train && (
            <button onClick={() => store.stepSelectedTrainNotch(-1)} style={stepButton} title={`Un cran de moins : moins de traction, puis frein électrique sous N${store.shortcutHint('drive.notchDown')}`}>
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
            title={train ? 'Cran du manipulateur (P : traction, B : frein électrique) et effort réellement appliqué' : 'Commande de la locomotive'}
          >
            {field.label}
          </div>
          {train && (
            <button onClick={() => store.stepSelectedTrainNotch(1)} style={stepButton} title={`Un cran de plus : moins de frein électrique, puis traction au-dessus de N${store.shortcutHint('drive.notchUp')}`}>
              +
            </button>
          )}
        </div>

        {train && dynamics && brake && (
          <>
            {/* Air brake: state at a glance, brake pipe and brake cylinder gauges, held handle */}
            <div
              style={{
                marginTop: '6px',
                textAlign: 'center',
                fontSize: '11px',
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                padding: '3px 0',
                borderRadius: '6px',
                border: `1px solid ${BRAKE_TONE_COLOR[brake.tone]}`,
                background: `${BRAKE_TONE_COLOR[brake.tone]}${isBrakeHolding(brake) || brake.tone === 'emergency' ? '59' : '1f'}`,
                color: isBrakeHolding(brake) || brake.tone === 'emergency' ? '#fff' : BRAKE_TONE_COLOR[brake.tone],
              }}
              title="État du frein à air"
            >
              {brake.label}
            </div>
            {isBrakeHolding(brake) && isTrainStopped(train) && (
              <div style={{ marginTop: '3px', fontSize: '9px', color: AMBER, textAlign: 'center' }}>
                Maintenir <span style={kbd}>{store.shortcutLabel('drive.brakeRelease') || 'Desserrer'}</span> pour desserrer et partir
              </div>
            )}
            <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
              <PressureGauge
                value={dynamics.brakePipeBar}
                spec={BRAKE_PIPE_GAUGE}
                caption="Cond. générale"
                title="Conduite générale : 5 bar frein desserré, 4,5 bar à la première dépression, 3,5 bar au serrage maximal, 0 en urgence"
                color="#38bdf8"
              />
              <PressureGauge
                value={dynamics.brakeCylinderBar}
                spec={BRAKE_CYLINDER_GAUGE}
                caption="Cyl. de frein"
                title="Cylindres de frein : 0 bar frein desserré, 3,8 bar au serrage maximal"
                color={RED}
              />
            </div>
            <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
              <HoldButton
                label="◀ Desserrer"
                title={`Desserrer le frein, tant que le bouton est maintenu${store.shortcutHint('drive.brakeRelease')}`}
                color={GREEN}
                active={train.brakeCommand === 'release'}
                disabled={train.emergencyBrake}
                onHold={() => store.setSelectedTrainBrakeCommand('release')}
                onRelease={() => releaseBrakeButton('release')}
              />
              <HoldButton
                label="Serrer ▶"
                title={`Serrer le frein, tant que le bouton est maintenu${store.shortcutHint('drive.brakeApply')}`}
                color={AMBER}
                active={train.brakeCommand === 'apply'}
                disabled={train.emergencyBrake}
                onHold={() => store.setSelectedTrainBrakeCommand('apply')}
                onRelease={() => releaseBrakeButton('apply')}
              />
            </div>

            {/* What the physics does to the train */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              columnGap: '6px',
              rowGap: '1px',
              marginTop: '6px',
              fontSize: '9px',
              color: '#94a3b8',
            }}>
              <span>accél.</span>
              <span style={{ textAlign: 'right', color: '#e2e8f0' }} title="Accélération réelle de la rame (négative : elle ralentit)">
                {accelerationLabel(dynamics.acceleration)}
              </span>
              <span>pente</span>
              <span style={{ textAlign: 'right', color: '#e2e8f0' }} title="Pente moyenne sous la rame, dans le sens de la marche">
                {gradientLabel(dynamics.gradientPermille)}
              </span>
              <span>arrêt</span>
              <span style={{ textAlign: 'right', color: '#e2e8f0' }} title="Distance d’arrêt au serrage maximal de service, sur la pente actuelle">
                {stoppingDistanceLabel(dynamics.stoppingDistance)}
              </span>
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
      </div>
    </div>
  )
}
