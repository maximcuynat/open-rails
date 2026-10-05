import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { trainImpactMessage, type EditorStore } from '@application/state/editorStore'
import type { ActionId } from '@application/keybindings/keybindings'
import type { ConsoleCommand } from '@application/console/consoleContract'
import { applyConsoleCommand } from '@application/console/consoleCommands'
import { buildConsoleState, buildFleet } from '@application/console/consoleState'
import type { RemoteSession } from '@application/remote/remoteSession'
import { showToast } from '../common/Toast'
import { DrivingConsole } from '../console/DrivingConsole'
import { ConsoleIcon, KeyCap } from '../console/instruments'
import { compactKeyLabel, newDerailment } from '../console/consoleModel'
import type { ConsoleArrangement } from '../console/consoleLayout'
import type { ConsoleKeys } from '../console/consoleParts'
import { TrainDebugPanel } from './TrainDebugPanel'

const KEY_ACTIONS: Record<keyof ConsoleKeys, ActionId> = {
  notchUp: 'drive.notchUp',
  notchDown: 'drive.notchDown',
  brakeApply: 'drive.brakeApply',
  brakeRelease: 'drive.brakeRelease',
  reverserForward: 'drive.reverserForward',
  reverserBackward: 'drive.reverserBackward',
  emergencyBrake: 'drive.emergencyBrake',
  steerLeft: 'drive.steerLeft',
  steerRight: 'drive.steerRight',
  exit: 'drive.exit',
  flipLegacy: 'drive.flipLegacy',
}

function consoleKeys(store: EditorStore): ConsoleKeys {
  const keys = {} as ConsoleKeys
  for (const name of Object.keys(KEY_ACTIONS) as (keyof ConsoleKeys)[]) {
    keys[name] = compactKeyLabel(store.shortcutLabel(KEY_ACTIONS[name]))
  }
  return keys
}

interface DrivingDockProps {
  store: EditorStore
  /** The phone desk session, to show when a phone holds the controls too */
  remote: RemoteSession
  /** Console chosen for the canvas area, worked out by the parent (it moves the mini-map too) */
  arrangement: ConsoleArrangement
}

/**
 * DrivingDock — the PC side of the driving console. It is the only place where the console meets
 * the store: it builds the state the console shows and turns its commands into store calls. The
 * debug panel docks next to it, and shows on its own in the editor.
 */
export function DrivingDock({ store, remote, arrangement }: DrivingDockProps) {
  // A train that runs into a buffer stop or another train says so on screen
  useEffect(() => {
    store.onTrainImpact = (_train, speed) => showToast(trainImpactMessage(speed), 'warning')
    return () => {
      store.onTrainImpact = null
    }
  }, [store])

  const onCommand = useCallback((command: ConsoleCommand) => applyConsoleCommand(store, command), [store])

  const state = buildConsoleState(store)
  // A derailment says so on screen once, when it happens; the console then keeps its panel up
  const announcedDerailments = useRef(new Set<string>())
  const drivenId = state?.trainId ?? null
  const isDerailed = !!state?.guidance?.derailed
  useEffect(() => {
    const message = newDerailment(announcedDerailments.current, state)
    if (message) showToast(message, 'error', 6000)
    // Only when the driven train changes or leaves / regains the rails: `state` is new at every frame
  }, [drivenId, isDerailed])

  const phoneConnected = useSyncExternalStore(remote.subscribe, remote.getSnapshot)?.deskConnected ?? false
  const debugKey = store.shortcutLabel('train.debug')

  return (
    <>
      <div className="hud-dock">
        <TrainDebugPanel store={store} />
      </div>
      {state && arrangement.layout && (
        <DrivingConsole
          layout={arrangement.layout}
          state={state}
          fleet={buildFleet(store)}
          keys={consoleKeys(store)}
          onCommand={onCommand}
          extraTools={
            <>
              {phoneConnected && (
                <span className="console-link" title="Un téléphone est connecté comme pupitre">
                  <ConsoleIcon name="phone" />
                  <span className="console-link-text">Téléphone</span>
                  <button
                    type="button"
                    className="console-link-cut"
                    title="Couper la liaison avec le téléphone"
                    aria-label="Couper la liaison avec le téléphone"
                    onClick={() => {
                      remote.close()
                      showToast('Liaison avec le téléphone coupée', 'info')
                    }}
                  >
                    <ConsoleIcon name="close" />
                  </button>
                </span>
              )}
              <button
                type="button"
                className="console-tool"
                title="Mode couplage (quitte la conduite)"
                aria-label="Mode couplage"
                onClick={() => {
                  applyConsoleCommand(store, { type: 'releaseControls' })
                  store.toggleCouplingMode()
                }}
              >
                <ConsoleIcon name="coupling" />
              </button>
              <button
                type="button"
                className={`console-tool${store.showTrainDebug ? ' is-active' : ''}`}
                title={`Squelette debug${store.shortcutHint('train.debug')}`}
                aria-label="Squelette debug des trains"
                aria-pressed={store.showTrainDebug}
                onClick={() => store.toggleTrainDebug()}
              >
                <ConsoleIcon name="debug" />
                <KeyCap label={debugKey} />
              </button>
            </>
          }
        />
      )}
    </>
  )
}
