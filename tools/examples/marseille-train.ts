import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { positionOnSegment, walkForward } from '@domain/models/locomotive'
import { serializeTrains, vehicleFrontEndPos } from '@domain/models/train'
import { ExampleBuilder } from './builder'

/** The file made by `tools/osm-import/osm_to_project.py`: its network is left exactly as it is */
export const MARSEILLE_FILE = fileURLToPath(new URL('../../src/examples/marseille-saint-charles.json', import.meta.url))

/**
 * The buffer stop of the platform track the train stands on (world metres): the one in the middle
 * of the station from which the points, as the import left them, let a train run furthest out
 * (some 650 m) before the driver has to set any
 */
const BUFFER_STOP = { x: -77, y: 10 }
/** The rear of the train stands this far (m) from the buffer stop… */
const CLEARANCE = 10
/** …so its leading bogie is about this far along the track (a 200 m trainset) */
const LEAD_AT = CLEARANCE + 196

const TRAINS_KEY = ',"trains":'

/**
 * Marseille Saint-Charles with one trainset at a platform, nose towards the exit of the station.
 * Only the `trains` entry is added to the file, as its last key: every other byte is the import's.
 */
export function build(): string {
  const file = readFileSync(MARSEILLE_FILE, 'utf8')
  let text = file.trimEnd()
  const ending = file.slice(text.length)
  // A train added by an earlier run is taken out first
  const previous = text.lastIndexOf(TRAINS_KEY)
  if (previous >= 0) text = `${text.slice(0, previous)}}`

  const b = new ExampleBuilder()
  b.store.loadFromData(JSON.parse(text))
  const net = b.net

  const buffer = [...net.nodes.values()]
    .filter((node) => (net.adjacency.get(node.id) ?? []).length === 1)
    .sort((p, q) => Math.hypot(p.pos.x - BUFFER_STOP.x, p.pos.y - BUFFER_STOP.y) - Math.hypot(q.pos.x - BUFFER_STOP.x, q.pos.y - BUFFER_STOP.y))[0]
  const rail = net.segments.get(net.adjacency.get(buffer.id)![0])!
  const leaving = rail.from === buffer.id
  // Walk the platform track away from the buffer stop to where the leading power car stands
  const lead = walkForward(net, rail.id, leaving ? 0 : 1, leaving, LEAD_AT)
  const ahead = lead && walkForward(net, lead.segId, lead.t, lead.forward, 5)
  const leadPos = lead && positionOnSegment(net, lead.segId, lead.t)
  const aheadPos = ahead && positionOnSegment(net, ahead.segId, ahead.t)
  if (!leadPos || !aheadPos) throw new Error('The platform track is too short for a trainset')

  const train = b.trainset(leadPos.x, leadPos.y, { x: aheadPos.x - leadPos.x, y: aheadPos.y - leadPos.y })
  const nose = vehicleFrontEndPos(net, train.vehicles[0])!
  console.log(`marseille-saint-charles: train at the platform ending at ${buffer.id}, nose at ${nose.x.toFixed(0)}, ${nose.y.toFixed(0)}`)

  return `${text.slice(0, -1)}${TRAINS_KEY}${JSON.stringify(serializeTrains(b.store.trains))}}${ending}`
}
