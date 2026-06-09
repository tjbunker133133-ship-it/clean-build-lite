/**
 * Field entry gate — brief environmental settle only (no cinematic camera).
 */

export type FieldEntryPhase = 'idle' | 'settling' | 'complete'

let phase: FieldEntryPhase = 'idle'
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((fn) => fn())
}

export function subscribeFieldEntry(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getFieldEntryPhase(): FieldEntryPhase {
  return phase
}

export function isFieldEntryActive(): boolean {
  return phase === 'settling'
}

/** Brief settle — camera may ease once; no long lock. */
export function isFieldEntryLocked(): boolean {
  return phase === 'settling'
}

export function setFieldEntryPhase(next: FieldEntryPhase): void {
  phase = next
  if (typeof document === 'undefined') {
    notify()
    return
  }
  const root = document.documentElement
  if (next === 'idle' || next === 'complete') {
    root.removeAttribute('data-field-entry')
  } else {
    root.setAttribute('data-field-entry', next)
  }
  notify()
}

export function resetFieldEntry(): void {
  phase = 'idle'
  if (typeof document !== 'undefined') {
    document.documentElement.removeAttribute('data-field-entry')
  }
  notify()
}
