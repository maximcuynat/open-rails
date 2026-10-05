import type { SerializedProject } from '@infrastructure/persistence/persistence'
import { ExampleBuilder, EAST } from './builder'

/**
 * « Premiers tours de roue »: five kilometres of straight track between two buffer stops and one
 * trainset near the western end, to learn to release the brake, accelerate and stop.
 */
export function build(): SerializedProject {
  const b = new ExampleBuilder()
  b.track([[0, 0], [5000, 0]])
  b.settle()
  b.trainset(260, 0, EAST)
  return b.finish({
    name: 'Premiers tours de roue',
    line: { lineSpeed: 160, lineType: 'classic' },
    camera: { x: 160, y: 0, scale: 4 },
  })
}
