import type { ICommand } from './Command'

/**
 * CommandManager manages the Undo / Redo history stacks.
 * Implements the Command Pattern invoker.
 */
export class CommandManager {
  private undoStack: ICommand[] = []
  private redoStack: ICommand[] = []
  private maxHistory: number

  constructor(maxHistory = 60) {
    this.maxHistory = maxHistory
  }

  /**
   * Execute a command and push it onto the undo stack.
   * Clears the redo stack.
   */
  execute(command: ICommand): void {
    command.execute()
    this.undoStack.push(command)
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift()
    }
    this.redoStack = []
  }

  /**
   * Undo the last command if available.
   */
  undo(): boolean {
    const cmd = this.undoStack.pop()
    if (!cmd) return false
    cmd.undo()
    this.redoStack.push(cmd)
    return true
  }

  /**
   * Redo the previously undone command if available.
   */
  redo(): boolean {
    const cmd = this.redoStack.pop()
    if (!cmd) return false
    cmd.execute()
    this.undoStack.push(cmd)
    return true
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
  }
}
