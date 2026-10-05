import type { CSSProperties } from 'react'
import { HalfDial, HalfGauge, KeyCap, NotchScale } from './instruments'
import { BrakeHoldButton, ConsoleTools, ReverserControl, type ConsolePartProps } from './consoleParts'
import { BRAKE_CYLINDER_GAUGE, BRAKE_PIPE_GAUGE, notchStops } from './consoleModel'

/** Console A — a desk along the bottom of the window: brake on the left, speed in the middle, traction on the right */
export function BandConsole(props: ConsolePartProps) {
  const { state, view, keys, onCommand } = props
  const effort = { '--console-effort': `${view.handlePercent}%` } as CSSProperties
  return (
    <div className="console-stage console-stage-band">
      <ConsoleTools {...props} />
      <div className="console console-band">
        <div className="console-zone">
          <div className="console-zhead">
            <span className="console-lbl">Frein</span>
            {state.brake && <span className={`console-pill tone-${state.brake.tone}`}>{view.brakeLabel}</span>}
          </div>
          {state.brake ? (
            <>
              <div className="console-gauges">
                <HalfGauge value={state.brake.pipeBar} spec={BRAKE_PIPE_GAUGE} tone="blue" name="CG" title="Conduite générale : 5 bar frein desserré, 3,5 bar au serrage maximal, 0 en urgence" />
                <HalfGauge value={state.brake.cylinderBar} spec={BRAKE_CYLINDER_GAUGE} tone="red" name="CF" title="Cylindres de frein : 0 bar frein desserré, 3,8 bar au serrage maximal" />
              </div>
              <div className="console-hold">
                <BrakeHoldButton {...props} command="release" className="console-btn tone-green" />
                <BrakeHoldButton {...props} command="apply" className="console-btn tone-amber" />
              </div>
            </>
          ) : (
            <p className="console-note">Cette locomotive n’a pas de frein à air : sa commande freine directement.</p>
          )}
        </div>

        <div className="console-zone console-mid">
          <div className="console-side is-left">
            Accél.<b>{view.acceleration} m/s²</b>Pente<b>{view.gradient}</b>
          </div>
          <div className="console-side is-right">
            Arrêt en<b>{view.stopping}</b>{view.rank !== null ? `Train ${view.rank}/${view.fleetSize}` : view.model ?? 'Train'}
            <b>{view.composition}</b>
          </div>
          <HalfDial ratio={view.speedRatio} maxKmh={view.maxKmh} />
          <div className="console-speed">{view.kmh}<small>KM/H</small></div>
          <ReverserControl {...props} />
        </div>

        <div className="console-zone">
          <div className="console-zhead">
            <span className="console-lbl">{view.handleTitle}</span>
            <span className="console-handle-value">{view.handleLabel}</span>
          </div>
          <NotchScale stops={notchStops(state)} onSet={(notch) => onCommand({ type: 'notchSet', notch })} />
          <div className={`console-bar side-${view.handleSide}`} style={effort}><i /></div>
          <div className="console-row">
            <button type="button" className="console-step" title="Un cran de moins : moins de traction, puis frein électrique sous N" onClick={() => onCommand({ type: 'notchStep', step: -1 })}>
              <KeyCap label={keys?.notchDown} /> −
            </button>
            <b>cran</b>
            <button type="button" className="console-step" title="Un cran de plus : moins de frein électrique, puis traction au-dessus de N" onClick={() => onCommand({ type: 'notchStep', step: 1 })}>
              + <KeyCap label={keys?.notchUp} />
            </button>
            {!view.legacy && (
              <button
                type="button"
                className={`console-btn tone-red console-emergency${state.emergencyBrake ? ' is-active' : ''}`}
                title="Arrêt d’urgence ; se réarme une fois le train arrêté"
                onClick={() => onCommand({ type: 'emergencyBrake' })}
              >
                {view.emergencyLabel} <KeyCap label={keys?.emergencyBrake} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
