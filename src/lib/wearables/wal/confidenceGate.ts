/**
 * WAL confidence gating — prevents noisy sensor dropouts from escalating.
 */

import type { WearableSignal } from './types'

export type ConfidenceDegradeBehavior = 'ignore' | 'delay' | 'require_confirmation'

export type SignalConfidenceGateConfig = {
  minConfidenceToTrigger: number
  degradeBehavior: ConfidenceDegradeBehavior
}

export const DEFAULT_CONFIDENCE_GATE: SignalConfidenceGateConfig = {
  minConfidenceToTrigger: 0.7,
  degradeBehavior: 'require_confirmation',
}

export type ConfidenceGateResult =
  | { outcome: 'pass' }
  | { outcome: 'ignore'; reason: string }
  | { outcome: 'require_confirmation'; reason: string }
  | { outcome: 'delay'; reason: string }

export function evaluateConfidenceGate(
  signal: WearableSignal,
  config: SignalConfidenceGateConfig = DEFAULT_CONFIDENCE_GATE,
): ConfidenceGateResult {
  if (signal.confidence >= config.minConfidenceToTrigger) {
    return { outcome: 'pass' }
  }

  const reason = `confidence ${signal.confidence.toFixed(2)} < ${config.minConfidenceToTrigger}`

  if (config.degradeBehavior === 'ignore') {
    return { outcome: 'ignore', reason }
  }
  if (config.degradeBehavior === 'delay') {
    return { outcome: 'delay', reason }
  }
  return { outcome: 'require_confirmation', reason }
}
