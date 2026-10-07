import type { SerializedProject, SerializedStation } from './persistence'

// A project file cut into parts and put back together, as data: the files of a dataset are the
// slices of one project (one per line), and loading a journey is the union of the files its lines
// come from. Every id is the one the whole project had, so a slice and the union never make one up.
//
// What stands at the border of two slices is in both: a node shared by rails of two lines, the
// route table of that node (whole: loaded alone, the editor trims it to the rails it has), a
// station with platforms on both (each slice holds its own stops). A speed zone is never on both
// sides: `splitSpeedZonesBy` cuts them at the border before the project is written.

/** The part of a project that holds the rails `keepRail` says yes to, with what stands on them */
export function sliceProject(project: SerializedProject, keepRail: (segId: string) => boolean): SerializedProject {
  const segments = project.segments.filter((seg) => keepRail(seg.id))
  const rails = new Set(segments.map((seg) => seg.id))
  const nodeIds = new Set<string>()
  for (const seg of segments) {
    nodeIds.add(seg.from)
    nodeIds.add(seg.to)
  }
  const nodes = project.nodes.filter((node) => nodeIds.has(node.id))
  const junctions = project.junctions?.filter((junction) => nodeIds.has(junction.nodeId))
  const signals = project.signals?.filter((signal) => rails.has(signal.segId))
  const speedZones = project.speedZones?.filter((zone) => {
    const kept = zone.spans.filter((span) => rails.has(span.segId)).length
    if (kept !== 0 && kept !== zone.spans.length) throw new Error(`Speed zone ${zone.id} runs over rails of two slices: cut the zones at the borders first`)
    return kept > 0
  })
  const stations = project.stations
    ?.map((station) => ({ ...station, stops: station.stops.filter((stop) => rails.has(stop.segId)) }))
    .filter((station) => station.stops.length > 0)
  let sectionMeta: Record<string, unknown> | undefined
  if (project.sectionMeta) {
    sectionMeta = {}
    for (const key in project.sectionMeta) {
      // A key is a rail id or the ids of a section's rails joined by '-'
      if (key.split('-').every((id) => rails.has(id))) sectionMeta[key] = project.sectionMeta[key]
    }
  }
  return withoutUndefined({
    ...project,
    nodes,
    segments,
    junctions: junctions && junctions.length > 0 ? junctions : undefined,
    speedZones: speedZones && speedZones.length > 0 ? speedZones : undefined,
    signals: signals && signals.length > 0 ? signals : undefined,
    stations: stations && stations.length > 0 ? stations : undefined,
    sectionMeta: sectionMeta && Object.keys(sectionMeta).length > 0 ? sectionMeta : undefined,
    // What belongs to one view of the whole, not to a part of it
    camera: undefined,
    sections: undefined,
    trains: undefined,
  })
}

/**
 * The project the slices were cut from. Nodes, rails, tables, zones and signals are taken once by
 * id (the same thing in two slices must be the same thing); the stops of a station found in
 * several slices are put together; the section settings are merged. The scalar settings come from
 * the first project, the version is the highest.
 */
export function unionProjects(projects: readonly SerializedProject[]): SerializedProject {
  if (projects.length === 0) throw new Error('nothing to put together')
  const [first] = projects
  const nodes = new Map<string, SerializedProject['nodes'][number]>()
  const segments = new Map<string, SerializedProject['segments'][number]>()
  const junctions = new Map<string, NonNullable<SerializedProject['junctions']>[number]>()
  const speedZones = new Map<string, NonNullable<SerializedProject['speedZones']>[number]>()
  const signals = new Map<string, NonNullable<SerializedProject['signals']>[number]>()
  const stations = new Map<string, SerializedStation>()
  const sectionMeta: Record<string, unknown> = {}
  let version = first.version
  const take = <T extends { id: string }>(into: Map<string, T>, items: readonly T[] | undefined, what: string): void => {
    for (const item of items ?? []) {
      const known = into.get(item.id)
      if (!known) into.set(item.id, item)
      else if (JSON.stringify(known) !== JSON.stringify(item)) throw new Error(`${what} ${item.id} differs between two slices`)
    }
  }
  for (const project of projects) {
    take(nodes, project.nodes, 'Node')
    take(segments, project.segments, 'Rail')
    take(junctions, project.junctions, 'Route table')
    take(speedZones, project.speedZones, 'Speed zone')
    take(signals, project.signals, 'Signal')
    for (const station of project.stations ?? []) {
      const known = stations.get(station.id)
      if (!known) {
        stations.set(station.id, { ...station, stops: [...station.stops] })
        continue
      }
      for (const stop of station.stops) {
        if (!known.stops.some((s) => s.segId === stop.segId && Math.abs(s.t - stop.t) < 1e-9)) known.stops.push(stop)
      }
    }
    Object.assign(sectionMeta, project.sectionMeta)
    if (project.version > version) version = project.version
  }
  return withoutUndefined({
    ...first,
    version,
    nodes: [...nodes.values()],
    segments: [...segments.values()],
    junctions: junctions.size > 0 ? [...junctions.values()] : undefined,
    speedZones: speedZones.size > 0 ? [...speedZones.values()] : undefined,
    signals: signals.size > 0 ? [...signals.values()] : undefined,
    stations: stations.size > 0 ? [...stations.values()] : undefined,
    sectionMeta: Object.keys(sectionMeta).length > 0 ? sectionMeta : undefined,
    camera: undefined,
    sections: undefined,
    trains: undefined,
  })
}

/** The same object without its `undefined` fields: written as JSON it would lose them anyway, compared it must not keep them */
function withoutUndefined(project: SerializedProject): SerializedProject {
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(project)) if (value !== undefined) clean[key] = value
  return clean as unknown as SerializedProject
}
