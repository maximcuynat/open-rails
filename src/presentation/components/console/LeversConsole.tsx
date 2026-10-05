import { KeyCap, SpeedTape } from './instruments'
import { BrakeLever, LimitBoard, NextLimitBoard, ReverserControl, SpeedCaption, ThrottleLever, type ConsolePartProps } from './consoleParts'
import { decimal, notchStops } from './consoleModel'
import { ConsoleToolRow } from './signalParts'

/** Console C — two levers on the right and the speed as a number along the bottom */
export function LeversConsole(props: ConsolePartProps) {
  const { state, view, keys, onCommand } = props
  return (
    <div className="console-stage console-stage-levers">
      <div className="console-levers-main">
        <ConsoleToolRow {...props} />
        <div className="console console-speedblock">
          <div className="console-speedblock-num">
            <div className={`console-speedblock-value speed-${view.speedTone}`}>{view.kmh}</div>
            <div className="console-speedblock-unit"><SpeedCaption view={view} unit={`KM/H · MAX ${view.maxKmh}`} /></div>
          </div>
          <div className="console-speedblock-tape">
            <SpeedTape ratio={view.speedRatio} maxKmh={view.maxKmh} guide={view} />
            <ReverserControl {...props} />
          </div>
          <div className="console-stats">
            <span>Accél.</span><b>{view.acceleration} m/s²</b>
            <span>Pente</span><b>{view.gradient}</b>
            <span>Arrêt</span><b>{view.stopping}</b>
            <span>Limite</span><b><LimitBoard view={view} /></b>
            <span>Proch.</span><b><NextLimitBoard view={view} /></b>
          </div>
        </div>
      </div>

      <div className="console-levers">
        {state.brake && (
          <>
            <button
              type="button"
              className={`console-estop${state.emergencyBrake ? ' is-active' : ''}`}
              title="Arrêt d’urgence ; se réarme une fois le train arrêté"
              onClick={() => onCommand({ type: 'emergencyBrake' })}
            >
              {state.emergencyBrake ? view.emergencyLabel : <>ARRÊT<br />URGENCE</>}
              <KeyCap label={keys?.emergencyBrake} />
            </button>
            <div className="console console-lever-box is-wide">
              <span className="console-lbl">Frein</span>
              <BrakeLever command={state.brake.command} disabled={state.emergencyBrake} onCommand={onCommand} />
              <span className={`console-lever-value is-small tone-${state.brake.tone}`}>{view.brakeLabel}</span>
              <span className="console-lever-pressures">CG {decimal(state.brake.pipeBar, 1)} · CF {decimal(state.brake.cylinderBar, 1)}</span>
              <span className="console-lever-keys"><KeyCap label={keys?.brakeApply} /><KeyCap label={keys?.brakeRelease} /></span>
            </div>
          </>
        )}
        <div className={`console console-lever-box${view.legacy ? ' is-wide' : ''}`}>
          <span className="console-lbl">{view.handleTitle}</span>
          <ThrottleLever state={state} stops={notchStops(state)} onCommand={onCommand} />
          <span className="console-lever-value">{view.handleLabel}</span>
          <span className="console-lever-keys"><KeyCap label={keys?.notchDown} /><KeyCap label={keys?.notchUp} /></span>
        </div>
      </div>
    </div>
  )
}
