import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import type { Reverser } from '@domain/models/train'
import {
  DISTANCE_BAR_MARKS,
  decimal,
  distanceRatio,
  gaugeRatio,
  speedDialStep,
  speedDialTicks,
  speedMinorTicks,
  type GaugeSpec,
  type NotchStop,
} from './consoleModel'
import { LEVER_TRACK_BOTTOM, LEVER_TRACK_TOP, LEVER_VIEW_HEIGHT, leverRatioAt, leverY } from './leverGeometry'

/**
 * The instruments the three consoles are built from. Each one is driven by values only: no store,
 * no network, so the same instrument runs on the PC and on a phone. Colours and sizes live in
 * `styles.css` (classes `console-*`).
 */

export type InstrumentTone = 'blue' | 'green' | 'amber' | 'red' | 'grey'

const point = (cx: number, cy: number, r: number, deg: number): [number, number] => [
  cx + r * Math.cos((deg * Math.PI) / 180),
  cy + r * Math.sin((deg * Math.PI) / 180),
]

/** Arc from angle `a0` to `a1` (degrees, clockwise from +x) */
function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = point(cx, cy, r, a0)
  const [x1, y1] = point(cx, cy, r, a1)
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

/** Reminder of the key that doubles a control; nothing where there is no keyboard */
export function KeyCap({ label }: { label?: string }) {
  return label ? <span className="console-key">{label}</span> : null
}

/** Half dial of a pressure with its marks, its value in bar and its name */
export function HalfGauge({ value, spec, tone, name, title }: {
  value: number
  spec: GaugeSpec
  tone: InstrumentTone
  name: string
  title?: string
}) {
  const cx = 48
  const cy = 50
  const r = 36
  const at = (v: number) => 180 + 180 * gaugeRatio(v, spec)
  const ratio = gaugeRatio(value, spec)
  return (
    <svg className="console-gauge" viewBox="0 0 96 62" role="img" aria-label={`${name} ${decimal(value, 1)} bar`}>
      {title && <title>{title}</title>}
      <path className="console-track" d={arc(cx, cy, r, 180, 360)} strokeWidth={6} />
      {ratio > 0.005 && <path className={`console-arc tone-${tone}`} d={arc(cx, cy, r, 180, at(value))} strokeWidth={6} />}
      {spec.marks.map((mark) => {
        const [x1, y1] = point(cx, cy, r - 6, at(mark))
        const [x2, y2] = point(cx, cy, r + 5, at(mark))
        return <line key={mark} className="console-mark" x1={x1} y1={y1} x2={x2} y2={y2} />
      })}
      <text className="console-gauge-value" x={cx} y={40} textAnchor="middle">{decimal(value, 1)}</text>
      <text className="console-gauge-name" x={cx} y={54} textAnchor="middle">{name} · bar</text>
    </svg>
  )
}

/** Half-circle speed dial: the arc fills up to the speed, the top speed is marked in red */
export function HalfDial({ ratio, maxKmh }: { ratio: number; maxKmh: number }) {
  const cx = 150
  const cy = 112
  const r = 98
  const scale = Math.max(maxKmh, 1)
  const at = (kmh: number) => 180 + (180 * kmh) / scale
  const labelled = speedDialTicks(maxKmh)
  const minor = speedMinorTicks(maxKmh, speedDialStep(maxKmh) / 2)
  const [mx, my] = point(cx, cy, r, 360)
  return (
    <svg className="console-half-dial" viewBox="0 0 300 118" aria-hidden="true">
      <path className="console-track" d={arc(cx, cy, r, 180, 360)} strokeWidth={10} />
      {ratio > 0.001 && <path className="console-arc tone-blue" d={arc(cx, cy, r, 180, 180 + 180 * ratio)} strokeWidth={10} />}
      {[...new Set([...minor, ...labelled])].map((kmh) => {
        const [x1, y1] = point(cx, cy, r - 12, at(kmh))
        const [x2, y2] = point(cx, cy, r - 6, at(kmh))
        return <line key={kmh} className="console-tick" x1={x1} y1={y1} x2={x2} y2={y2} />
      })}
      {labelled.map((kmh) => {
        const [x, y] = point(cx, cy, r - 24, at(kmh))
        return <text key={kmh} className="console-tick-label" x={x} y={y + 4} textAnchor="middle">{kmh}</text>
      })}
      <circle className="console-dial-max" cx={mx} cy={my} r={5} />
    </svg>
  )
}

/** Round dial with a needle, as on an on-board screen; the speed is written on its hub */
export function RoundDial({ kmh, ratio, maxKmh }: { kmh: number; ratio: number; maxKmh: number }) {
  const cx = 150
  const cy = 150
  const r = 130
  const a0 = 126
  const sweep = 288
  const scale = Math.max(maxKmh, 1)
  const at = (v: number) => a0 + (sweep * v) / scale
  const step = speedDialStep(maxKmh, 8)
  const major = speedDialTicks(maxKmh, 8)
  const minor = speedMinorTicks(maxKmh, step / 4).filter((v) => !major.includes(v))
  const needleAngle = a0 + sweep * ratio + 90
  // The needle turns through CSS so that a page fed ten times a second can smooth it with a transition
  const needleStyle: CSSProperties = { transform: `rotate(${needleAngle}deg)` }
  return (
    <svg className="console-round-dial" viewBox="0 0 300 300" role="img" aria-label={`${kmh} km/h`}>
      <path className="console-round-track" d={arc(cx, cy, r + 8, a0, a0 + sweep)} />
      {ratio > 0.001 && <path className="console-round-arc" d={arc(cx, cy, r + 8, a0, a0 + sweep * ratio)} />}
      {minor.map((v) => {
        const [x1, y1] = point(cx, cy, r - 8, at(v))
        const [x2, y2] = point(cx, cy, r, at(v))
        return <line key={v} className="console-round-tick" x1={x1} y1={y1} x2={x2} y2={y2} />
      })}
      {major.map((v) => {
        const [x1, y1] = point(cx, cy, r - 16, at(v))
        const [x2, y2] = point(cx, cy, r, at(v))
        const [tx, ty] = point(cx, cy, r - 32, at(v))
        return (
          <g key={v}>
            <line className="console-round-tick is-major" x1={x1} y1={y1} x2={x2} y2={y2} />
            <text className="console-round-label" x={tx} y={ty + 5} textAnchor="middle">{v}</text>
          </g>
        )
      })}
      <path
        className="console-needle"
        style={needleStyle}
        d={`M ${cx - 4.5} ${cy} L ${cx - 4.5} ${cy - 70} L ${cx - 1.5} ${cy - 78} L ${cx - 1.5} ${cy - 122} L ${cx + 1.5} ${cy - 122} L ${cx + 1.5} ${cy - 78} L ${cx + 4.5} ${cy - 70} L ${cx + 4.5} ${cy} Z`}
      />
      <circle className="console-hub" cx={cx} cy={cy} r={34} />
      <text className="console-hub-value" x={cx} y={cy + 11} textAnchor="middle">{kmh}</text>
      <text className="console-round-unit" x={cx} y={262} textAnchor="middle">km/h</text>
    </svg>
  )
}

/** Vertical bar of a pressure with its marks */
export function VerticalBar({ value, spec, tone }: { value: number; spec: GaugeSpec; tone: InstrumentTone }) {
  const top = 6
  const bottom = 214
  const y = (v: number) => bottom - (bottom - top) * gaugeRatio(v, spec)
  return (
    <svg className="console-vbar" viewBox="0 0 34 220" preserveAspectRatio="none" aria-hidden="true">
      <rect className="console-vbar-frame" x={12} y={top} width={14} height={bottom - top} />
      <rect className={`console-fill tone-${tone}`} x={12} y={y(value)} width={14} height={Math.max(bottom - y(value), 2)} />
      {spec.marks.map((mark) => (
        <line key={mark} className="console-vbar-mark" x1={2} y1={y(mark)} x2={12} y2={y(mark)} />
      ))}
    </svg>
  )
}

/** Stopping distance as a bar: the taller, the further */
export function DistanceBar({ metres }: { metres: number | null }) {
  const top = 6
  const bottom = 244
  const y = (m: number | null) => bottom - (bottom - top) * distanceRatio(m)
  return (
    <svg className="console-distbar" viewBox="0 0 46 250" preserveAspectRatio="none" aria-hidden="true">
      {DISTANCE_BAR_MARKS.map((m) => (
        <line key={m} className="console-distbar-mark" x1={0} y1={y(m)} x2={14} y2={y(m)} />
      ))}
      <rect className="console-fill tone-grey" x={20} y={y(metres)} width={16} height={bottom - y(metres)} />
    </svg>
  )
}

/** Straight speed scale, for the console that shows the speed as a number */
export function SpeedTape({ ratio, maxKmh }: { ratio: number; maxKmh: number }) {
  const scale = Math.max(maxKmh, 1)
  const x = (kmh: number) => 4 + (242 * kmh) / scale
  const ticks = speedDialTicks(maxKmh)
  return (
    <svg className="console-tape" viewBox="0 0 250 34" aria-hidden="true">
      <rect className="console-fill tone-track" x={4} y={4} width={242} height={8} rx={4} />
      {ratio > 0.001 && <rect className="console-fill tone-blue" x={4} y={4} width={242 * ratio} height={8} rx={4} />}
      {ticks.map((kmh, i) => (
        <g key={kmh}>
          <line className="console-tick is-thin" x1={x(kmh)} y1={15} x2={x(kmh)} y2={20} />
          <text
            className="console-tape-label"
            x={x(kmh)}
            y={32}
            textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
          >
            {kmh}
          </text>
        </g>
      ))}
    </svg>
  )
}

/** The stops of the handle side by side: the current one is lit, a click puts the handle on a stop */
export function NotchScale({ stops, onSet }: { stops: NotchStop[]; onSet: (notch: number) => void }) {
  const columns: CSSProperties = { gridTemplateColumns: `repeat(${stops.length}, 1fr)` }
  return (
    <div className="console-notches" style={columns} role="group" aria-label="Crans du manipulateur">
      {stops.map((stop) => (
        <button
          key={stop.notch}
          type="button"
          className={`console-notch side-${stop.side}${stop.current ? ' is-on' : stop.passed ? ' is-fill' : ''}`}
          aria-pressed={stop.current}
          onClick={() => onSet(stop.notch)}
        >
          {stop.label}
        </button>
      ))}
    </div>
  )
}

export interface LeverStop {
  /** Position along the travel, 0 (bottom) … 1 (top) */
  ratio: number
  /** Empty: a bare graduation */
  label: string
  active: boolean
}

/**
 * A lever dragged with the mouse or a finger. The pointer is captured, so the drag carries on
 * outside the lever; `onMove` gets the position along the travel (0 bottom … 1 top) and `onEnd`
 * fires once when the lever is let go. Where the knob is drawn is up to the caller (`ratio`).
 */
export function Lever({ stops, ratio, tone, fillFrom, wide, springBack, disabled, label, valueText, onMove, onEnd }: {
  stops: LeverStop[]
  ratio: number
  tone: InstrumentTone
  /** Draw a filled bar from this position to the knob */
  fillFrom?: number
  /** Leave room on the left for long stop names */
  wide?: boolean
  /** Ease the knob back when it is let go */
  springBack?: boolean
  disabled?: boolean
  label: string
  valueText: string
  onMove: (ratio: number) => void
  onEnd: () => void
}) {
  const dragging = useRef(false)
  const ratioAt = (e: PointerEvent<SVGSVGElement>): number => {
    const box = e.currentTarget.getBoundingClientRect()
    return leverRatioAt(e.clientY, box.top, box.height)
  }
  const end = () => {
    if (!dragging.current) return
    dragging.current = false
    onEnd()
  }
  const y = leverY(ratio)
  const knobStyle: CSSProperties = { transform: `translateY(${y}px)` }
  const fillY = fillFrom === undefined ? y : leverY(fillFrom)
  return (
    <svg
      className={`console-lever${wide ? ' is-wide' : ''}${springBack ? ' is-spring' : ''}${disabled ? ' is-disabled' : ''}`}
      viewBox={`${wide ? -40 : 0} 0 ${wide ? 120 : 80} ${LEVER_VIEW_HEIGHT}`}
      role="slider"
      aria-label={label}
      aria-valuetext={valueText}
      aria-valuenow={Math.round(ratio * 100)}
      aria-disabled={disabled}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        dragging.current = true
        onMove(ratioAt(e))
      }}
      onPointerMove={(e) => {
        if (dragging.current) onMove(ratioAt(e))
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <rect className="console-lever-slot" x={46} y={LEVER_TRACK_TOP - 8} width={12} height={LEVER_TRACK_BOTTOM - LEVER_TRACK_TOP + 16} rx={6} />
      {stops.map((stop) => (
        <g key={stop.ratio}>
          <line className="console-tick" x1={34} y1={leverY(stop.ratio)} x2={44} y2={leverY(stop.ratio)} />
          {stop.label && (
            <text className={`console-lever-label${stop.active ? ' is-on' : ''}`} x={30} y={leverY(stop.ratio) + 4} textAnchor="end">
              {stop.label}
            </text>
          )}
        </g>
      ))}
      {fillFrom !== undefined && Math.abs(fillY - y) > 0.5 && (
        <rect className={`console-fill tone-${tone}`} x={48} y={Math.min(y, fillY)} width={8} height={Math.abs(fillY - y)} rx={4} />
      )}
      <g className="console-knob" style={knobStyle}>
        <rect className={`console-knob-body tone-${tone}`} x={36} y={-13} width={32} height={26} rx={8} />
        {[-4, 0, 4].map((d) => (
          <line key={d} className="console-knob-grip" x1={44} y1={d} x2={60} y2={d} />
        ))}
      </g>
    </svg>
  )
}

const REVERSER_POSITIONS: [Reverser, string, string][] = [
  ['reverse', 'AR', 'Marche arrière'],
  ['neutral', 'N', 'Neutre'],
  ['forward', 'AV', 'Marche avant'],
]

/** Three-position reverser; it only moves at rest with the handle out of traction */
export function ReverserSwitch({ reverser, locked, needed, className, onSet }: {
  reverser: Reverser
  locked: boolean
  /** Traction is asked for in neutral: draw the eye to the reverser */
  needed: boolean
  className?: string
  onSet: (reverser: Reverser) => void
}) {
  return (
    <div
      className={`console-rev${needed ? ' is-needed' : ''}${className ? ` ${className}` : ''}`}
      role="group"
      aria-label="Inverseur"
      title={locked ? 'Inverseur verrouillé : à l’arrêt, manipulateur hors traction' : 'Inverseur'}
    >
      {REVERSER_POSITIONS.map(([position, label, name]) => (
        <button
          key={position}
          type="button"
          className={position === reverser ? 'is-on' : undefined}
          aria-pressed={position === reverser}
          aria-label={name}
          disabled={locked && position !== reverser}
          onClick={() => onSet(position)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** A button that acts for as long as it is pressed, like the key it doubles */
export function HoldButton({ className, active, disabled, title, onHold, onRelease, children }: {
  className: string
  active: boolean
  disabled?: boolean
  title?: string
  onHold: () => void
  onRelease: () => void
  children: ReactNode
}) {
  const held = useRef(false)
  const release = () => {
    if (!held.current) return
    held.current = false
    onRelease()
  }
  return (
    <button
      type="button"
      className={`${className} console-hold-button${active ? ' is-active' : ''}`}
      disabled={disabled}
      title={title}
      // The pointer is captured: sliding off the button does not drop the handle, releasing does
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        held.current = true
        onHold()
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      {children}
    </button>
  )
}

const ICON_PATHS = {
  previous: 'M10 3 L5 8 L10 13',
  next: 'M6 3 L11 8 L6 13',
  steerLeft: 'M11 14 V9 M11 9 L4 3 M4 3 H8 M4 3 V7',
  steerRight: 'M5 14 V9 M5 9 L12 3 M12 3 H8 M12 3 V7',
  coupling: 'M2 8 H6 M10 8 H14 M6 5 V11 M10 5 V11 M6 8 H10',
  debug: 'M3 4 H13 M3 8 H13 M3 12 H13 M6 2.5 V5.5 M10 6.5 V9.5 M5 10.5 V13.5',
  close: 'M4 4 L12 12 M12 4 L4 12',
  cab: 'M3 5 H13 M13 5 L10.5 2.5 M13 5 L10.5 7.5 M13 11 H3 M3 11 L5.5 8.5 M3 11 L5.5 13.5',
  phone: 'M5 2 H11 V14 H5 Z M7.3 11.8 H8.7',
} as const

export function ConsoleIcon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg className="console-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  )
}
