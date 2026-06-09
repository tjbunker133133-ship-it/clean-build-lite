/**
 * Field Intent store — single source of truth for Modern environmental state.
 *
 * UI and resolvers may ONLY call setFieldIntent().
 * Expression values are NEVER written here.
 */

import type { FieldIntent } from './fieldIntentModel'
import { logModernGuardrailApplied } from './modernLayerGuardrails'

logModernGuardrailApplied('fieldIntentStore')

type Listener = () => void

let fieldIntent: FieldIntent = 'STREET_AWARE'
const listeners = new Set<Listener>()

function notify(): void {
  listeners.forEach((fn) => fn())
}

export function getFieldIntent(): FieldIntent {
  return fieldIntent
}

export function setFieldIntent(intent: FieldIntent): void {
  if (fieldIntent === intent) return
  fieldIntent = intent
  notify()
}

export function subscribeFieldIntent(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Test-only reset */
export function __resetFieldIntentForTests(intent: FieldIntent = 'STREET_AWARE'): void {
  fieldIntent = intent
  notify()
}
