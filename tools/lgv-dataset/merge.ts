import type { OverpassElement, OverpassResponse } from '@domain/import/osmTypes'

/**
 * Several Overpass answers as one: each element once (an element that carries tags wins over its
 * bare copy, as `out body qt` lists tagged nodes twice), the oldest data date of the lot.
 */
export function mergeAnswers(answers: readonly OverpassResponse[]): OverpassResponse {
  const elements = new Map<string, OverpassElement>()
  let date: string | undefined
  for (const answer of answers) {
    for (const element of answer.elements ?? []) {
      if (!element || typeof element.id !== 'number') continue
      const key = `${element.type}/${element.id}`
      const known = elements.get(key)
      if (!known || (!known.tags && element.tags)) elements.set(key, element)
    }
    const stamp = answer.osm3s?.timestamp_osm_base
    if (typeof stamp === 'string' && (date === undefined || stamp < date)) date = stamp
  }
  const merged: OverpassResponse = { elements: [...elements.values()] }
  if (date !== undefined) merged.osm3s = { timestamp_osm_base: date }
  return merged
}

/** The ids of the ways of an answer */
export function wayIdsOf(answer: OverpassResponse): Set<number> {
  const ids = new Set<number>()
  for (const element of answer.elements ?? []) if (element.type === 'way') ids.add(element.id)
  return ids
}
