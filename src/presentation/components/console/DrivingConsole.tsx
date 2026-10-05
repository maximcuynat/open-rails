import type { ConsoleLayout } from '@application/console/consolePreference'
import { BandConsole } from './BandConsole'
import { ScreenConsole } from './ScreenConsole'
import { LeversConsole } from './LeversConsole'
import { consoleView } from './consoleModel'
import { DerailmentPanel, type ConsoleProps } from './consoleParts'

const CONSOLES = { band: BandConsole, screen: ScreenConsole, levers: LeversConsole } as const

/**
 * The driving console in one of its three layouts. It fills its positioned parent and scales with
 * the CSS variable `--console-scale`. State in, commands out: it knows nothing of where either goes.
 */
export function DrivingConsole({ layout, ...props }: ConsoleProps & { layout: ConsoleLayout }) {
  const Console = CONSOLES[layout]
  const view = consoleView(props.state, props.fleet)
  return (
    <>
      <Console {...props} view={view} />
      {view.derailment && (
        // A stage of its own over the console: the same panel whatever the layout
        <div className="console-stage console-stage-alert">
          <DerailmentPanel view={view} onCommand={props.onCommand} />
        </div>
      )}
    </>
  )
}
