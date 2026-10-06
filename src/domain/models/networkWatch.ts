import type { Network } from './types'

// ─────────────────── A network that is being driven on, not edited ───────────────────
//
// The track is changed in place from many places, so what is computed from it (speed profile,
// blocks, sections) is kept behind a comparison of the whole network with its last known state:
// exact, but one pass over every node and rail each time it is asked — several times per frame
// while trains run. A network that is only being driven on does not change between two frames.
// While it is *held*, those comparisons are made once and then trusted until something says the
// network may have changed (`networkChanged`): every notification of the editor does, and so does
// every set of points thrown. A network that is not held is compared every time, as before.

const held = new WeakSet<Network>()
let epoch = 0

/** Start trusting the comparisons of this network between two `networkChanged` */
export function holdNetwork(net: Network): void {
  held.add(net)
}

/** Back to comparing the network every time it is asked */
export function releaseNetwork(net: Network): void {
  held.delete(net)
}

/** Something may have changed in a network: the next comparison of a held one is made again */
export function networkChanged(): void {
  epoch++
}

/**
 * What a kept comparison of `net` is good for: the same token as when it was made means the
 * network was not touched since. `undefined` for a network that is not held — compare.
 */
export function networkCheckToken(net: Network): number | undefined {
  return held.has(net) ? epoch : undefined
}
