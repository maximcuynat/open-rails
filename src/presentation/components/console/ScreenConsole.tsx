import { DistanceBar, ReverserSwitch, RoundDial, VerticalBar } from './instruments'
import { BrakeHoldButton, ConsoleTools, LimitCorners, type ConsolePartProps } from './consoleParts'
import { BRAKE_CYLINDER_GAUGE, BRAKE_PIPE_GAUGE, decimal } from './consoleModel'
import { SignalPanel } from './signalParts'

/** Console B — an on-board screen in the bottom-right corner: needle dial in the middle, fixed zones around it */
export function ScreenConsole(props: ConsolePartProps) {
  const { state, view, keys, onCommand } = props
  const reverserKeys = [keys?.reverserBackward, keys?.reverserForward].filter(Boolean).join(' · ')
  return (
    <div className="console-stage console-stage-screen">
      <div className="console console-screen">
        {/* Out of the grid, on the top edge of the screen */}
        {view.signals && <SignalPanel signals={view.signals} />}
        <div className="console-screen-top">
          <span className="console-screen-name">{[view.model, view.composition].filter(Boolean).join(' · ')}</span>
          <ConsoleTools {...props} className="is-inline" />
        </div>

        <div className="console-screen-dist" title="Distance d’arrêt au serrage maximal de service, sur la pente actuelle">
          <span>ARRÊT</span>
          <DistanceBar metres={state.stoppingDistance} />
          <b>{view.stopping}</b>
        </div>

        <div className="console-screen-dial">
          <RoundDial kmh={view.kmh} ratio={view.speedRatio} maxKmh={view.maxKmh} guide={view} curve={view.curve} />
          <LimitCorners view={view} />
        </div>

        <div className="console-screen-press">
          {state.brake && (
            <>
              <div title="Conduite générale, bar"><span>CG</span><VerticalBar value={state.brake.pipeBar} spec={BRAKE_PIPE_GAUGE} tone="grey" /><b>{decimal(state.brake.pipeBar, 1)}</b></div>
              <div title="Cylindres de frein, bar"><span>CF</span><VerticalBar value={state.brake.cylinderBar} spec={BRAKE_CYLINDER_GAUGE} tone="red" /><b>{decimal(state.brake.cylinderBar, 1)}</b></div>
            </>
          )}
        </div>

        <div className="console-screen-info">
          <div>{view.handleTitle}<b>{view.handleLabel}</b></div>
          <div>Frein<b className={state.brake ? `tone-${state.brake.tone}` : undefined}>{view.brakeLabel ?? '—'}</b></div>
          <div>Accél.<b>{view.acceleration}</b></div>
          <div>Pente<b>{view.gradient}</b></div>
        </div>

        <div className={`console-screen-keys${view.legacy ? ' is-legacy' : ''}`}>
          {view.legacy ? (
            <button type="button" className="console-soft" onClick={() => onCommand({ type: 'switchCab' })}>
              Inverser<small>{keys?.flipLegacy}</small>
            </button>
          ) : (
            <div className="console-soft console-soft-rev">
              <ReverserSwitch
                reverser={state.reverser}
                locked={state.reverserLocked}
                needed={view.reverserNeeded}
                onSet={(reverser) => onCommand({ type: 'reverser', reverser })}
              />
              <small>{reverserKeys}</small>
            </div>
          )}
          <button type="button" className="console-soft" title="Un cran de moins : moins de traction, puis frein électrique sous N" onClick={() => onCommand({ type: 'notchStep', step: -1 })}>
            Cran −<small>{keys?.notchDown}</small>
          </button>
          <button type="button" className="console-soft" title="Un cran de plus : moins de frein électrique, puis traction au-dessus de N" onClick={() => onCommand({ type: 'notchStep', step: 1 })}>
            Cran +<small>{keys?.notchUp}</small>
          </button>
          {state.brake && (
            <>
              <BrakeHoldButton {...props} command="release" className="console-soft is-stacked" />
              <BrakeHoldButton {...props} command="apply" className="console-soft is-stacked" />
              <button
                type="button"
                className={`console-soft is-red${state.emergencyBrake ? ' is-active' : ''}`}
                title="Arrêt d’urgence ; se réarme une fois le train arrêté"
                onClick={() => onCommand({ type: 'emergencyBrake' })}
              >
                {view.emergencyLabel}<small>{keys?.emergencyBrake}</small>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
