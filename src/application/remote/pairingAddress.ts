import { pairingUrl } from './protocol'

/**
 * Which address the phone is given. The page on the PC is usually opened as `localhost`, which
 * means nothing to a phone: the address is rebuilt on a host of the local network — one the relay
 * reported, or the one the user typed when the relay cannot know it (WSL2, containers).
 */

const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i
const DOTTED_DIGITS = /^[\d.]+$/

function isIpv4(host: string): boolean {
  const parts = host.split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * What the user typed as the address of the PC, brought to a bare host: `192.168.1.42`, or a name
 * such as `mon-pc.local`. A pasted scheme, port or path is dropped (the page supplies its own).
 * `null` when it cannot be a host.
 */
export function normalizeHostInput(input: string): string | null {
  const host = input
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d*$/, '')
    .toLowerCase()
  if (host.length === 0 || host.length > 253) return null
  if (DOTTED_DIGITS.test(host)) return isIpv4(host) ? host : null
  return HOST_NAME.test(host) ? host : null
}

/** A host that only means « this machine »: no phone can reach it */
export function isLoopbackHost(host: string): boolean {
  const name = host.toLowerCase()
  return name === 'localhost' || name.endsWith('.localhost') || name.startsWith('127.') || name === '::1' || name === '[::1]'
}

export interface PairingAddressInput {
  /** Address of the page on the PC (`location.href`) */
  pageUrl: string
  /** Base of the application (`import.meta.env.BASE_URL`) */
  baseUrl: string
  room: string
  /** Addresses of its machine the relay reported (`hosts` of the session) */
  relayHosts: readonly string[]
  /** What the user typed as the address of the PC; empty when nothing */
  typedHost: string
}

export interface PairingAddress {
  /** Address the phone opens, and what the QR code holds */
  url: string
  /** Host the address is built on */
  host: string
  /** Hosts to offer: the page's own when a phone could reach it, then the relay's */
  choices: string[]
  /** Something was typed that is not a host: it is ignored */
  typedInvalid: boolean
  /**
   * An address was typed that is none of those the server knows of its machine: right under WSL2
   * without mirroring, wrong when it is a former address of the PC kept from another day
   */
  typedUnknown: boolean
  /** No reachable host is known: the address only works on the PC itself */
  localOnly: boolean
}

export function pairingAddress(input: PairingAddressInput): PairingAddress {
  const pageHost = new URL(input.pageUrl).hostname
  const choices: string[] = []
  for (const host of [pageHost, ...input.relayHosts]) {
    if (!isLoopbackHost(host) && !choices.includes(host)) choices.push(host)
  }
  const typed = normalizeHostInput(input.typedHost)
  const host = typed ?? choices[0] ?? pageHost
  return {
    url: pairingUrl(input.pageUrl, input.baseUrl, input.room, host),
    host,
    choices,
    typedInvalid: typed === null && input.typedHost.trim().length > 0,
    typedUnknown: typed !== null && choices.length > 0 && !choices.includes(typed),
    localOnly: isLoopbackHost(host),
  }
}

/** A page served over HTTPS may not open the `ws://` link to a relay on the local network */
export function isSecurePage(pageUrl: string): boolean {
  return new URL(pageUrl).protocol === 'https:'
}
