/**
 * Centralized escalation trigger registry — not embedded in adapters.
 * Adapters emit WearableSignal only; this module decides trigger eligibility.
 */

import type { EscalationRiskEvent, EscalationTriggerKind, WearableSignal, WearableSignalType } from './types'

export type EscalationTriggerType = 'fall' | 'hr_zero' | 'inactivity' | 'manual'

export type EscalationTriggerSeverity = 'low' | 'medium' | 'high'

export type EscalationTriggerDef = {
  type: EscalationTriggerType
  severity: EscalationTriggerSeverity
  /** Human-in-the-loop: timer + confirm always required before SOS hook */
  requiresConfirmation: boolean
  cooldownMs: number
  kind: EscalationTriggerKind
  signalTypes: WearableSignalType[]
  minConfidence: number
}

export const ESCALATION_TRIGGER_REGISTRY: readonly EscalationTriggerDef[] = [
  {
    type: 'fall',
    severity: 'high',
    requiresConfirmation: true,
    cooldownMs: 120_000,
    kind: 'fall_detected',
    signalTypes: ['fall'],
    minConfidence: 0.7,
  },
  {
    type: 'hr_zero',
    severity: 'high',
    requiresConfirmation: true,
    cooldownMs: 180_000,
    kind: 'heart_rate_zero_or_absent',
    signalTypes: ['heart_rate'],
    minConfidence: 0.7,
  },
  {
    type: 'inactivity',
    severity: 'medium',
    requiresConfirmation: true,
    cooldownMs: 300_000,
    kind: 'prolonged_inactivity',
    signalTypes: ['inactivity'],
    minConfidence: 0.7,
  },
  {
    type: 'manual',
    severity: 'high',
    requiresConfirmation: true,
    cooldownMs: 30_000,
    kind: 'user_emergency_button',
    signalTypes: ['user_emergency'],
    minConfidence: 0.9,
  },
  {
    type: 'manual',
    severity: 'high',
    requiresConfirmation: true,
    cooldownMs: 15_000,
    kind: 'manual_operator',
    signalTypes: ['user_emergency'],
    minConfidence: 1,
  },
] as const

export type TriggerCooldownState = Record<EscalationTriggerType, number>

export function createTriggerCooldownState(): TriggerCooldownState {
  return { fall: 0, hr_zero: 0, inactivity: 0, manual: 0 }
}

export function isTriggerOnCooldown(
  type: EscalationTriggerType,
  state: TriggerCooldownState,
  nowMs: number = Date.now(),
): boolean {
  const def = ESCALATION_TRIGGER_REGISTRY.find((d) => d.type === type)
  if (!def) return false
  return nowMs - state[type] < def.cooldownMs
}

export function markTriggerCooldown(
  type: EscalationTriggerType,
  state: TriggerCooldownState,
  nowMs: number = Date.now(),
): TriggerCooldownState {
  return { ...state, [type]: nowMs }
}

/** Signal matches trigger semantics (value checks — not interpretation). */
export function signalMatchesTrigger(signal: WearableSignal, def: EscalationTriggerDef): boolean {
  if (!def.signalTypes.includes(signal.type)) return false
  if (def.kind === 'manual_operator') {
    return (
      signal.type === 'user_emergency' &&
      (signal.sourceDevice.includes('manual') || signal.sourceDevice.includes('operator'))
    )
  }
  if (def.kind === 'user_emergency_button') {
    return signal.type === 'user_emergency' && !signal.sourceDevice.includes('manual')
  }
  if (def.type === 'hr_zero') {
    const bpm = typeof signal.value === 'number' ? signal.value : null
    return bpm === 0 || bpm == null
  }
  if (def.type === 'fall' || def.type === 'inactivity') return true
  return false
}

export function resolveTriggersFromSignal(signal: WearableSignal): EscalationTriggerDef[] {
  return ESCALATION_TRIGGER_REGISTRY.filter(
    (def) => signalMatchesTrigger(signal, def) && signal.confidence >= def.minConfidence,
  )
}

export function getTriggerDefByKind(kind: EscalationTriggerKind): EscalationTriggerDef | undefined {
  return ESCALATION_TRIGGER_REGISTRY.find((d) => d.kind === kind)
}

export function buildRiskEvent(
  def: EscalationTriggerDef,
  signal: WearableSignal,
  nowMs: number = Date.now(),
): EscalationRiskEvent {
  return {
    trigger: def.kind,
    at: signal.timestamp || nowMs,
    sourceDevice: signal.sourceDevice,
    signal,
    detail: `trigger=${def.type};severity=${def.severity}`,
  }
}
