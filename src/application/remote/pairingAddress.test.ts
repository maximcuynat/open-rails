import { describe, expect, it } from 'vitest'
import { isLoopbackHost, isSecurePage, normalizeHostInput, pairingAddress } from './pairingAddress'

const PAGE = 'http://localhost:8900/open-rails/?x=1#top'
const base = { pageUrl: PAGE, baseUrl: '/open-rails/', room: 'ABC234', relayHosts: [] as string[], typedHost: '' }

describe('normalizeHostInput', () => {
  it('keeps an IPv4 address or a host name, lower-cased and trimmed', () => {
    expect(normalizeHostInput(' 192.168.1.42 ')).toBe('192.168.1.42')
    expect(normalizeHostInput('Mon-PC.local')).toBe('mon-pc.local')
    expect(normalizeHostInput('pc')).toBe('pc')
  })

  it('drops a pasted scheme, port and path', () => {
    expect(normalizeHostInput('http://192.168.1.42:8900/open-rails/?pupitre=ABC234')).toBe('192.168.1.42')
    expect(normalizeHostInput('192.168.1.42:8900')).toBe('192.168.1.42')
    expect(normalizeHostInput('https://mon-pc.local/')).toBe('mon-pc.local')
  })

  it('refuses what cannot be a host', () => {
    for (const bad of ['', '   ', '192.168.1', '192.168.1.256', '1.2.3.4.5', '192.168..1', 'a b', 'pc_1', '-pc', 'pc-', 'a..b', 'é.local', 'x'.repeat(254)]) {
      expect(normalizeHostInput(bad), bad).toBeNull()
    }
  })
})

describe('pairingAddress', () => {
  it('builds the address on the first host the relay reported when the page is on localhost', () => {
    const address = pairingAddress({ ...base, relayHosts: ['192.168.1.42', '10.0.0.3'] })
    expect(address).toEqual({
      url: 'http://192.168.1.42:8900/open-rails/?pupitre=ABC234',
      host: '192.168.1.42',
      choices: ['192.168.1.42', '10.0.0.3'],
      typedInvalid: false,
      localOnly: false,
    })
  })

  it('prefers what the user typed, and follows it as it changes', () => {
    const typed = (typedHost: string) => pairingAddress({ ...base, relayHosts: ['172.20.0.5'], typedHost })
    expect(typed('192.168.1.7').url).toBe('http://192.168.1.7:8900/open-rails/?pupitre=ABC234')
    expect(typed('192.168.1.77').url).toBe('http://192.168.1.77:8900/open-rails/?pupitre=ABC234')
    expect(typed('192.168.1.7').choices).toEqual(['172.20.0.5'])
    // Half typed: ignored, and said so
    expect(typed('192.168.')).toMatchObject({ host: '172.20.0.5', typedInvalid: true })
    expect(typed('  ')).toMatchObject({ host: '172.20.0.5', typedInvalid: false })
  })

  it('offers the host of the page first when the page is already opened on the network', () => {
    const address = pairingAddress({
      ...base,
      pageUrl: 'http://192.168.1.42:8900/open-rails/',
      relayHosts: ['192.168.1.42', '172.20.0.5'],
    })
    expect(address.choices).toEqual(['192.168.1.42', '172.20.0.5'])
    expect(address.host).toBe('192.168.1.42')
  })

  it('says so when no reachable host is known', () => {
    expect(pairingAddress(base)).toEqual({
      url: 'http://localhost:8900/open-rails/?pupitre=ABC234',
      host: 'localhost',
      choices: [],
      typedInvalid: false,
      localOnly: true,
    })
    expect(pairingAddress({ ...base, relayHosts: ['127.0.0.1'] }).choices).toEqual([])
  })
})

describe('page checks', () => {
  it('tells loopback hosts and secure pages', () => {
    expect(['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.1.2.3', '[::1]'].every(isLoopbackHost)).toBe(true)
    expect(['192.168.1.42', 'mon-pc.local', '12.7.0.1'].some(isLoopbackHost)).toBe(false)
    expect(isSecurePage('https://maximcuynat.github.io/open-rails/')).toBe(true)
    expect(isSecurePage(PAGE)).toBe(false)
  })
})
