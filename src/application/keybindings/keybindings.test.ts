import { describe, expect, it } from 'vitest'
import {
  ACTIONS,
  captureChord,
  chordLabel,
  defaultKeybindings,
  findAction,
  findConflict,
  isBindable,
  mergeWithDefaults,
  shortcutLabel,
  withChord,
  withoutInput,
  type ActionId,
  type KeyContext,
  type KeyInput,
} from './keybindings'

const press = (code: string, key: string, shiftKey = false): KeyInput => ({ code, key, shiftKey })

describe('keybindings — matching', () => {
  const bindings = defaultKeybindings()

  it('drives with WASD by key position, whatever letter the layout prints', () => {
    expect(findAction(bindings, 'drive', press('KeyW', 'w'))).toBe('drive.reverserForward')
    // AZERTY: the same physical keys produce z / q
    expect(findAction(bindings, 'drive', press('KeyW', 'z'))).toBe('drive.reverserForward')
    expect(findAction(bindings, 'drive', press('KeyA', 'q'))).toBe('drive.notchUp')
    expect(findAction(bindings, 'drive', press('KeyD', 'd'))).toBe('drive.notchDown')
    expect(findAction(bindings, 'drive', press('KeyS', 's'))).toBe('drive.reverserBackward')
  })

  it('gives the brake its own two keys, by position', () => {
    expect(findAction(bindings, 'drive', press('KeyE', 'e'))).toBe('drive.brakeApply')
    // AZERTY: the key at the Q position prints A, and the one at the A position prints Q
    expect(findAction(bindings, 'drive', press('KeyQ', 'a'))).toBe('drive.brakeRelease')
    expect(findAction(bindings, 'drive', press('KeyA', 'q'))).toBe('drive.notchUp')
    expect(findAction(bindings, 'edit', press('KeyE', 'e'))).toBeNull()
  })

  it('no default key triggers two actions in the same context', () => {
    const actions: { id: ActionId; contexts: readonly KeyContext[] }[] = [...ACTIONS]
    for (const context of ['drive', 'edit'] as const) {
      const seen = new Set<string>()
      for (const action of actions.filter((a) => a.contexts.includes(context))) {
        for (const chord of bindings[action.id]) {
          if (!chord) continue
          const id = JSON.stringify(chord)
          expect(seen.has(id), `${id} twice in ${context}`).toBe(false)
          seen.add(id)
        }
      }
    }
    // A position and a letter cannot be compared as such: the brake keys print E and Q on QWERTY
    // and E and A on AZERTY, none of which is a letter shortcut that stays live while driving
    const liveLetters = actions.filter((a) => a.contexts.includes('drive'))
      .flatMap((a) => bindings[a.id]).flatMap((c) => (c && 'key' in c ? [c.key] : []))
    expect(liveLetters.some((k) => ['e', 'q', 'a'].includes(k))).toBe(false)
  })

  it('keeps the arrows as secondary keys, Shift selecting the reverser', () => {
    expect(findAction(bindings, 'drive', press('ArrowUp', 'ArrowUp'))).toBe('drive.notchUp')
    expect(findAction(bindings, 'drive', press('ArrowUp', 'ArrowUp', true))).toBe('drive.reverserForward')
    expect(findAction(bindings, 'drive', press('ArrowDown', 'ArrowDown', true))).toBe('drive.reverserBackward')
  })

  it('a key without a Shift chord still fires while Shift is held', () => {
    expect(findAction(bindings, 'drive', press('KeyA', 'A', true))).toBe('drive.notchUp')
    expect(findAction(bindings, 'edit', press('KeyV', 'V', true))).toBe('tool.select')
  })

  it('tool keys follow the printed letter, not the position', () => {
    // AZERTY: the letter M sits on the Semicolon position; the KeyM position prints a comma
    expect(findAction(bindings, 'edit', press('Semicolon', 'm'))).toBe('tool.measure')
    expect(findAction(bindings, 'edit', press('KeyM', ','))).toBeNull()
  })

  it('keeps the two contexts apart', () => {
    expect(findAction(bindings, 'edit', press('KeyD', 'd'))).toBe('edit.parallelTrack')
    expect(findAction(bindings, 'drive', press('KeyV', 'v'))).toBeNull()
    expect(findAction(bindings, 'edit', press('ArrowUp', 'ArrowUp'))).toBeNull()
    expect(findAction(bindings, 'drive', press('F3', 'F3'))).toBe('train.debug')
    expect(findAction(bindings, 'edit', press('F3', 'F3'))).toBe('train.debug')
  })
})

describe('keybindings — rebinding', () => {
  it('reports a conflict only between actions that share a context', () => {
    const bindings = defaultKeybindings()
    // V is a tool key in edit mode only: free for a driving action
    expect(findConflict(bindings, 'drive.emergencyBrake', press('KeyV', 'v'))).toBeNull()
    expect(findConflict(bindings, 'drive.emergencyBrake', press('KeyA', 'a'))).toBe('drive.notchUp')
    // F is live in both contexts
    expect(findConflict(bindings, 'drive.emergencyBrake', press('KeyF', 'f'))).toBe('view.fit')
    expect(findConflict(bindings, 'drive.notchUp', press('KeyA', 'a'))).toBeNull()
    // Shift+↑ and ↑ are distinct chords
    expect(findConflict(bindings, 'drive.exit', press('ArrowUp', 'ArrowUp', true))).toBe('drive.reverserForward')
  })

  it('refuses the keys the editor keeps for itself', () => {
    expect(isBindable('drive.notchUp', press('Escape', 'Escape'))).toBe(false)
    expect(isBindable('drive.notchUp', press('Tab', 'Tab'))).toBe(false)
    expect(isBindable('drive.notchUp', press('ShiftLeft', 'Shift'))).toBe(false)
    expect(isBindable('drive.exit', press('Space', ' '))).toBe(true)
    expect(isBindable('drive.notchUp', press('Digit1', '1'))).toBe(true)
    expect(isBindable('tool.select', press('Space', ' '))).toBe(false)
    expect(isBindable('tool.select', press('Backspace', 'Backspace'))).toBe(false)
    expect(isBindable('tool.select', press('Digit1', '1'))).toBe(false)
    expect(isBindable('tool.select', press('KeyR', 'r'))).toBe(false)
    expect(isBindable('tool.select', press('KeyM', ','))).toBe(false)
    expect(isBindable('tool.select', press('KeyB', 'b'))).toBe(true)
  })

  it('captures a position for driving actions and a letter for tools', () => {
    expect(captureChord('drive.notchUp', press('KeyW', 'z'))).toEqual({ code: 'KeyW' })
    expect(captureChord('drive.notchUp', press('ArrowUp', 'ArrowUp', true))).toEqual({ code: 'ArrowUp', shift: true })
    expect(captureChord('tool.select', press('KeyB', 'B', true))).toEqual({ key: 'b' })
    expect(captureChord('tool.select', press('F2', 'F2'))).toEqual({ code: 'F2' })
  })

  it('assigns, clears a duplicate slot and frees a replaced key', () => {
    let bindings = defaultKeybindings()
    bindings = withChord(bindings, 'drive.notchUp', 0, { code: 'ArrowUp' })
    expect(bindings['drive.notchUp']).toEqual([{ code: 'ArrowUp' }, null])

    bindings = withoutInput(bindings, 'drive.notchDown', press('KeyD', 'd'))
    expect(bindings['drive.notchDown']).toEqual([null, { code: 'ArrowDown' }])
    expect(findAction(bindings, 'drive', press('KeyD', 'd'))).toBeNull()
    // The defaults are left untouched
    expect(defaultKeybindings()['drive.notchUp']).toEqual([{ code: 'KeyA' }, { code: 'ArrowUp' }])
  })

  it('lays saved bindings over the defaults and drops what it does not know', () => {
    const merged = mergeWithDefaults({
      'drive.notchUp': [{ code: 'KeyE' }, null],
      'tool.select': [{ key: 'B' }, { nonsense: 1 }],
      'gone.action': [{ code: 'KeyX' }, null],
    })
    expect(merged['drive.notchUp']).toEqual([{ code: 'KeyE' }, null])
    expect(merged['tool.select']).toEqual([{ key: 'b' }, null])
    expect(merged['drive.notchDown']).toEqual(defaultKeybindings()['drive.notchDown'])
    expect('gone.action' in merged).toBe(false)
    // KeyE was given to the traction before the brake actions existed: the user keeps it,
    // "apply the brake" starts without a key rather than taking it over
    expect(merged['drive.brakeApply']).toEqual([null, null])
    expect(merged['drive.brakeRelease']).toEqual(defaultKeybindings()['drive.brakeRelease'])
    expect(findAction(merged, 'drive', press('KeyE', 'e'))).toBe('drive.notchUp')
    expect(mergeWithDefaults('garbage')).toEqual(defaultKeybindings())
  })
})

describe('keybindings — labels', () => {
  it('prints the letter of the user layout for a key position', () => {
    expect(chordLabel({ code: 'KeyW' })).toBe('W')
    expect(chordLabel({ code: 'KeyW' }, { KeyW: 'z' })).toBe('Z')
    expect(chordLabel({ code: 'ArrowUp', shift: true })).toBe('Maj+↑')
    expect(chordLabel({ code: 'Backspace' })).toBe('Retour arrière')
    expect(chordLabel({ code: 'BracketLeft' })).toBe('[')
    expect(chordLabel({ code: 'BracketLeft' }, { BracketLeft: '^' })).toBe('^')
    expect(chordLabel({ code: 'F3' })).toBe('F3')
    expect(chordLabel({ key: 'v' })).toBe('V')
  })

  it('labels an action by its first assigned key', () => {
    const bindings = withChord(defaultKeybindings(), 'drive.notchUp', 0, null)
    expect(shortcutLabel(bindings, 'drive.notchUp')).toBe('↑')
    expect(shortcutLabel(withChord(bindings, 'drive.notchUp', 1, null), 'drive.notchUp')).toBe('')
  })
})
