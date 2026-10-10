import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerBroker, brokerSocketUrl, type BrokerSignal } from './peerBroker'
import { fakeBroker } from './rtc.testkit'
import { candidatePayload, offerPayload } from './rtcPeer'

const URL = 'wss://broker.example/peerjs'
// Messages in the dress the broker asks for (see `rtcPeer.ts`)
const OFFER = offerPayload({ type: 'offer', sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n' }, 'dc_test')
const CANDIDATE = candidatePayload({ candidate: 'candidate:1 1 udp 1 x.local 1 typ host' }, 'dc_test')

describe('the client of the broker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens the address of the broker with its key, its id and its token', () => {
    expect(brokerSocketUrl(URL, 'openrails-ABC234', 'secret')).toBe('wss://broker.example/peerjs?key=peerjs&id=openrails-ABC234&token=secret')
    expect(brokerSocketUrl('ws://localhost:9100/peerjs?x=1', 'a', 'b')).toBe('ws://localhost:9100/peerjs?x=1&key=peerjs&id=a&token=b')
  })

  it('holds an id, and carries a message to another peer with who it comes from', async () => {
    const { createSocket, state } = fakeBroker()
    const a = new PeerBroker({ url: URL, id: 'a', token: 'ta', createSocket })
    const b = new PeerBroker({ url: URL, id: 'b', token: 'tb', createSocket })
    expect(a.status).toBe('connecting')
    expect(a.send('OFFER', 'b', {})).toBe(false)
    await vi.advanceTimersByTimeAsync(0)
    expect([a.status, b.status]).toEqual(['open', 'open'])
    expect(state.opened[0]).toContain('id=a')
    const heard: BrokerSignal[] = []
    b.onSignal((signal) => heard.push(signal))
    expect(a.send('OFFER', 'b', OFFER)).toBe(true)
    a.send('CANDIDATE', 'b', CANDIDATE)
    expect(heard).toEqual([
      { type: 'OFFER', src: 'a', payload: OFFER },
      { type: 'CANDIDATE', src: 'a', payload: CANDIDATE },
    ])
  })

  it('is told when nobody answers under an id', async () => {
    const { createSocket } = fakeBroker({ expireMs: 5000 })
    const a = new PeerBroker({ url: URL, id: 'a', token: 'ta', createSocket })
    await vi.advanceTimersByTimeAsync(0)
    const heard: BrokerSignal[] = []
    a.onSignal((signal) => heard.push(signal))
    a.send('OFFER', 'nobody', OFFER)
    await vi.advanceTimersByTimeAsync(4999)
    expect(heard).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(heard).toEqual([{ type: 'EXPIRE', src: 'nobody', payload: undefined }])
  })

  it('a message sent a moment before its peer arrives is waiting for it', async () => {
    const { createSocket } = fakeBroker()
    const a = new PeerBroker({ url: URL, id: 'a', token: 'ta', createSocket })
    await vi.advanceTimersByTimeAsync(0)
    a.send('OFFER', 'late', OFFER)
    const late = new PeerBroker({ url: URL, id: 'late', token: 'tl', createSocket })
    const heard: BrokerSignal[] = []
    late.onSignal((signal) => heard.push(signal))
    await vi.advanceTimersByTimeAsync(0)
    expect(heard).toEqual([{ type: 'OFFER', src: 'a', payload: OFFER }])
  })

  it('is hung up on for a message that is not in the dress the broker asks for, and comes back', async () => {
    const { createSocket } = fakeBroker()
    const a = new PeerBroker({ url: URL, id: 'a', token: 'ta', createSocket, minRetryMs: 1000 })
    const b = new PeerBroker({ url: URL, id: 'b', token: 'tb', createSocket })
    await vi.advanceTimersByTimeAsync(0)
    const heard: BrokerSignal[] = []
    b.onSignal((signal) => heard.push(signal))
    // As the public broker does with a bare description
    a.send('OFFER', 'b', { sdp: { type: 'offer', sdp: 'v=0' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(heard).toEqual([])
    expect(a.status).toBe('connecting')
    await vi.advanceTimersByTimeAsync(1000)
    expect(a.status).toBe('open')
  })

  it('says so when the id is taken, and does not ask again', async () => {
    const { createSocket, state } = fakeBroker()
    const first = new PeerBroker({ url: URL, id: 'room', token: 'mine', createSocket })
    await vi.advanceTimersByTimeAsync(0)
    const second = new PeerBroker({ url: URL, id: 'room', token: 'other', createSocket })
    await vi.advanceTimersByTimeAsync(0)
    expect(first.status).toBe('open')
    expect(second.status).toBe('taken')
    const asked = state.opened.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(state.opened.length).toBe(asked)
  })

  it('beats, and comes back by itself with a growing delay when the broker is lost', async () => {
    const { createSocket, state, dropAll, hub } = fakeBroker()
    const a = new PeerBroker({ url: URL, id: 'a', token: 'ta', createSocket, minRetryMs: 1000, maxRetryMs: 4000 })
    const statuses: string[] = []
    a.onStatus((status) => statuses.push(status))
    await vi.advanceTimersByTimeAsync(0)
    expect(statuses).toEqual(['open'])
    const received = vi.spyOn(hub, 'receive')
    await vi.advanceTimersByTimeAsync(5000)
    expect(received).toHaveBeenCalledWith(expect.anything(), JSON.stringify({ type: 'HEARTBEAT' }))

    state.down = true
    dropAll()
    await vi.advanceTimersByTimeAsync(0)
    expect(a.status).toBe('connecting')
    expect(a.send('OFFER', 'b', {})).toBe(false)
    // 1 s, 2 s, 4 s, 4 s: four more attempts in eleven seconds
    const before = state.opened.length
    await vi.advanceTimersByTimeAsync(11_000)
    expect(state.opened.length - before).toBe(4)
    state.down = false
    await vi.advanceTimersByTimeAsync(4000)
    expect(a.status).toBe('open')
    // The same id, the same token: the broker gives the place back
    expect(state.opened.at(-1)).toBe(state.opened[0])
    a.close()
    expect(a.status).toBe('closed')
    expect(hub.clientCount).toBe(0)
  })

  it('ignores what it cannot read', async () => {
    const { createSocket, hub } = fakeBroker()
    const a = new PeerBroker({ url: URL, id: 'a', token: 'ta', createSocket })
    await vi.advanceTimersByTimeAsync(0)
    const heard: BrokerSignal[] = []
    a.onSignal((signal) => heard.push(signal))
    const conn = [...(hub as unknown as { clients: Map<string, { conn: { send(data: string): void } }> }).clients.values()][0].conn
    for (const frame of ['not json', '42', '{}', '{"type":"OFFER"}', '{"type":"WHATEVER","src":"x"}', JSON.stringify({ type: 'OFFER', src: 'x', payload: 'y'.repeat(70_000) })]) conn.send(frame)
    expect(heard).toEqual([])
    expect(a.status).toBe('open')
  })
})
