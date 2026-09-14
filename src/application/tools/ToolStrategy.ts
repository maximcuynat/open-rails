import type { Point } from '@domain/models/types'

export type ToolType = 'select' | 'place' | 'curve' | 'pan'

export interface ToolPointerEvent {
  world: Point
  snapped: Point
  screenX: number
  screenY: number
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  button: number
}

/**
 * Strategy Pattern for Canvas Interactive Tools.
 * Keeps event handling modular and decoupled from the monolithic store.
 */
export interface IToolStrategy {
  readonly type: ToolType
  readonly cursorStyle: string

  onPointerDown?(e: ToolPointerEvent): void
  onPointerMove?(e: ToolPointerEvent): void
  onPointerUp?(e: ToolPointerEvent): void
  onCancel?(): void
}
