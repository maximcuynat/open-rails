import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorStore } from '@application/state/editorStore'
import { addNode, addSegment, resetIdCounter } from '@domain/models/network'
import { positionOnSegment } from '@domain/models/locomotive'
import { resetMemoryStorage } from '@infrastructure/persistence/persistence'
import { applyConsoleCommand } from '../console/consoleCommands'
import type { ConsoleCommand } from '../console/consoleContract'
import { arrangeConsole } from '@presentation/components/console/consoleLayout'
import { FakeLink } from './fakeLink'
import { createRemoteSession } from './remoteSession'

/** A PC with two trains on a straight line and a phone desk session ready to be paired */
function setup() {
  const store = new EditorStore()
  const n1 = addNode(store.network, { x: 0, y: 0 })
  const n2 = addNode(store.network, { x: 4000, y: 0 })
  addSegment(store.network, n1.id, n2.id)
  expect(store.placeTrainLoco({ x: 1000, y: 0 })).toBe(true)
  expect(store.placeTrainLoco({ x: 3000, y: 0 })).toBe(true)
  const links: FakeLink[] = []
  const session = createRemoteSession({
    store,
    createLink: () => {
      const link = new FakeLink()
      links.push(link)
      return link
    },
    generateRoom: () => 'ROOM22',
  })
  let seq = 0
  const fromPhone = (c: ConsoleCommand, trainId: string | null = store.selectedTrainId) =>
    links[links.length - 1].receive({ t: 'command', seq: ++seq, trainId, command: c })
  const pair = () => {
    const link = links[links.length - 1]
    link.receive({ t: 'opened', room: session.getSnapshot()!.room, hosts: ['192.168.1.42'] })
    link.receive({ t: 'peer-joined' })
  }
  const leadX = (index: number) => {
    const lead = store.trains[index].vehicles[0]
    return positionOnSegment(store.network, lead.front.segId, lead.front.t)!.x
  }
  return { store, session, links, fromPhone, pair, leadX }
}

describe('the PC as a spectator while a phone holds the desk', () => {
  beforeEach(() => {
    resetIdCounter(0)
    resetMemoryStorage()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('turns spectator when the phone joins a drive, and gets the desk back when the link is cut', () => {
    const { store, session, pair, fromPhone } = setup()
    session.open()
    expect(store.remoteDeskConnected).toBe(false)
    pair()
    expect(store.remoteDeskConnected).toBe(true)
    // Nobody drives yet: there is nothing to watch, the editor is as usual
    expect(store.isSpectating).toBe(false)

    fromPhone({ type: 'selectTrain', trainId: store.trains[0].id }, null)
    expect(store.isPlayMode).toBe(true)
    expect(store.isSpectating).toBe(true)

    session.close()
    expect(store.remoteDeskConnected).toBe(false)
    expect(store.isSpectating).toBe(false)
    expect(store.isPlayMode).toBe(true)
  })

  it('shows no console on the PC while spectating, and shows it again afterwards', () => {
    const { store, session, pair, fromPhone } = setup()
    const layoutNow = () => arrangeConsole(1440, 900, store.consolePreference, store.isPlayMode && !store.isSpectating, false).layout
    session.open()
    pair()
    fromPhone({ type: 'selectTrain', trainId: store.trains[0].id }, null)
    expect(layoutNow()).toBeNull()
    session.close()
    expect(layoutNow()).not.toBeNull()
  })

  it('the keyboard and the buttons of the PC no longer drive: only the phone does', () => {
    const { store, session, pair, fromPhone } = setup()
    session.open()
    pair()
    const driven = store.trains[0]
    fromPhone({ type: 'selectTrain', trainId: driven.id }, null)

    applyConsoleCommand(store, { type: 'reverser', reverser: 'forward' })
    applyConsoleCommand(store, { type: 'notchStep', step: 1 })
    applyConsoleCommand(store, { type: 'emergencyBrake' })
    applyConsoleCommand(store, { type: 'selectTrain', trainId: store.trains[1].id })
    expect(driven.reverser).toBe('neutral')
    expect(driven.notch).toBe(0)
    expect(driven.emergencyBrake).toBe(false)
    // Picking another train from the PC only moves the camera to it
    expect(store.selectedTrainId).toBe(driven.id)
    expect(store.cameraTrain?.id).toBe(store.trains[1].id)

    fromPhone({ type: 'reverser', reverser: 'forward' })
    fromPhone({ type: 'notchStep', step: 1 })
    expect(driven.reverser).toBe('forward')
    expect(driven.notch).toBe(1)
  })

  it('the PC can still leave the drive', () => {
    const { store, session, pair, fromPhone } = setup()
    session.open()
    pair()
    fromPhone({ type: 'selectTrain', trainId: store.trains[0].id }, null)
    applyConsoleCommand(store, { type: 'releaseControls' })
    expect(store.isPlayMode).toBe(false)
    expect(store.isSpectating).toBe(false)
  })

  it('follows the driven train by default, another one when it is picked, none in free view', () => {
    const { store, session, pair, fromPhone, leadX } = setup()
    session.open()
    pair()
    fromPhone({ type: 'selectTrain', trainId: store.trains[0].id }, null)
    expect(store.cameraTrain?.id).toBe(store.trains[0].id)

    store.spectateTrain(store.trains[1].id)
    // Watching another train does not change the one the phone drives
    expect(store.selectedTrainId).toBe(store.trains[0].id)
    expect(store.cameraTrain?.id).toBe(store.trains[1].id)
    expect(store.camera.x).toBeCloseTo(leadX(1), 6)

    store.camera.x = 0
    store.tickAllTrains(1 / 60)
    expect(store.camera.x).toBeCloseTo(leadX(1), 6)

    store.setSpectatorFreeView()
    store.camera.x = 123
    store.tickAllTrains(1 / 60)
    expect(store.camera.x).toBe(123)

    store.spectateTrain(null)
    expect(store.cameraTrain?.id).toBe(store.trains[0].id)
    expect(store.camera.x).toBeCloseTo(leadX(0), 6)
  })

  it('forgets the watched train when the phone leaves, and ignores a train that does not exist', () => {
    const { store, session, pair, fromPhone, links } = setup()
    session.open()
    pair()
    fromPhone({ type: 'selectTrain', trainId: store.trains[0].id }, null)
    store.spectateTrain('nope')
    expect(store.spectatedTrainId).toBeNull()
    store.spectateTrain(store.trains[1].id)
    links[0].receive({ t: 'peer-left' })
    expect(store.remoteDeskConnected).toBe(false)
    expect(store.spectatedTrainId).toBeNull()
    // Back at the desk: the camera is on the train this PC now drives
    expect(store.cameraTrain?.id).toBe(store.selectedTrainId)
  })
})
