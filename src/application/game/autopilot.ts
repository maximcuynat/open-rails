import { pilotOrders, type PilotTarget } from '@application/console/autopilot'
import { buildTrainConsoleState } from '@application/console/consoleState'
import type { EditorStore } from '@application/state/editorStore'
import { releaseEmergencyBrake, setNotch, setReverser, type TrainSet } from '@domain/models/train'
import { setBrakeCommand } from '@domain/models/trainDynamics'
import { nextStop } from '@domain/services/itinerary'
import { guideLeft } from '@domain/services/routeGuide'
import { ARRIVAL_DISTANCE, refreshRouteGuide } from './itinerary'

// The automatic pilot at the controls of a train of the game: several times a second it reads
// what a console would show of that train, works out where it has to stop — the platform of the
// next station of its itinerary — and sets the handles (`pilotOrders`). It calls at each station
// for a while, changes ends where the way on starts behind it, and stands still once arrived.
// Without an itinerary it holds the line speed and obeys the signals, nothing more. The points
// are not its business: the driving aid sets them, or the driver does.

/** How often the pilot looks and acts, s of simulated time */
export const PILOT_PERIOD_S = 0.1
/** How long it stands at a station it calls at, s of simulated time */
export const PILOT_DWELL_S = 30

/** What the pilot remembers of a train between two looks */
export interface PilotMemory {
  /** Simulated time since its last look, s */
  elapsed: number
  /** Time left to stand at the station it is calling at, s */
  dwell: number
  /** The station that call was for: one call per station */
  calledAt: string | null
}

export const newPilotMemory = (): PilotMemory => ({ elapsed: PILOT_PERIOD_S, dwell: 0, calledAt: null })

/** Where the train has to stand still, as its itinerary and the way found for it say */
function stopTarget(store: EditorStore, train: TrainSet): PilotTarget & { behind: boolean } {
  const itinerary = train.itinerary
  if (!itinerary) return { stopIn: null, behind: false }
  const station = nextStop(itinerary)
  // Arrived at the last station: it stays there. Nothing ahead yet (just set down): free to run
  if (!station) return { stopIn: itinerary.stations.length > 1 ? 0 : null, behind: false }
  const guide = store.routeGuides.get(train.id)?.guide
  const lead = train.vehicles[0]?.front
  if (!guide || !lead || guide.target !== 'platform') return { stopIn: null, behind: !!guide?.behind }
  // A few metres past the stop is at the stop: the call is there, no change of ends for that
  if (guide.behind) return guide.path.length <= ARRIVAL_DISTANCE ? { stopIn: 0, behind: false } : { stopIn: null, behind: true }
  return { stopIn: guideLeft(store.network, guide, lead), behind: false }
}

/** One look of the pilot at one train: the handles set for the time until the next */
function pilotTrain(store: EditorStore, train: TrainSet, memory: PilotMemory, elapsed: number): void {
  const state = buildTrainConsoleState(store, train)
  const target = stopTarget(store, train)
  const station = nextStop(train.itinerary)

  // Stopped at the platform it was heading for: the call begins, once per station
  if (state.stopped && station && target.stopIn !== null && target.stopIn <= ARRIVAL_DISTANCE && memory.calledAt !== station) {
    memory.calledAt = station
    memory.dwell = PILOT_DWELL_S
  }
  let stopIn = target.stopIn
  if (memory.dwell > 0) {
    memory.dwell = Math.max(0, memory.dwell - elapsed)
    stopIn = 0
  } else if (target.behind && state.stopped) {
    // The way on starts behind: from the other cab. The way is found again at once from there —
    // kept until the itineraries are next looked at, it would still say « behind », the pilot
    // would change ends again at its next look, and so on without ever leaving
    if (state.canSwitchCab && store.switchTrainCab(train)) {
      const turned = store.trains.find((t) => t.id === train.id)
      store.routeGuides.delete(train.id)
      if (turned) refreshRouteGuide(store, turned)
      return
    }
    stopIn = 0
  } else if (target.behind) {
    stopIn = 0
  }

  const orders = pilotOrders(state, { stopIn })
  if (orders.resetEmergency) releaseEmergencyBrake(train)
  if (orders.forward) {
    setNotch(train, 0)
    setReverser(train, 'forward')
  }
  if (train.notch !== orders.notch) setNotch(train, orders.notch)
  if (train.brakeCommand !== orders.brake) setBrakeCommand(train, orders.brake)
}

/** Let the pilot act on every train it holds, each at its own pace; called at every step of the simulation */
export function runAutopilots(store: EditorStore, dt: number): void {
  if (store.autopilots.size === 0) return
  for (const [trainId, memory] of store.autopilots) {
    const train = store.trains.find((t) => t.id === trainId)
    if (!train) {
      store.autopilots.delete(trainId)
      continue
    }
    memory.elapsed += dt
    if (memory.elapsed < PILOT_PERIOD_S) continue
    const elapsed = memory.elapsed
    memory.elapsed = 0
    pilotTrain(store, train, memory, elapsed)
  }
}
