/**
 * WAL escalation pipeline — registry + confidence + presets → state machine actions.
 * Interpretation layer is NOT used here.
 */

import { evaluateConfidenceGate, type SignalConfidenceGateConfig } from './confidenceGate'
import {
  buildRiskEvent,
  createTriggerCooldownState,
  isTriggerOnCooldown,
  markTriggerCooldown,
  resolveTriggersFromSignal,
  type EscalationTriggerDef,
  type TriggerCooldownState,
} from './escalationTriggerRegistry'
import type { EscalationRiskEvent } from './types'
import { presetAllowsAutoEscalation, type WalUserMode } from './userPresets'
import type { WearableSignal } from './types'

export type EscalationPipelineAction =
  | { action: 'ignore'; reason: string }
  | { action: 'advisory'; risk: EscalationRiskEvent; reason: string }
  | { action: 'escalate'; risk: EscalationRiskEvent; trigger: EscalationTriggerDef }

export type EscalationPipelineInput = {
  signal: WearableSignal
  mode: WalUserMode
  confidenceGate?: SignalConfidenceGateConfig
  cooldownState: TriggerCooldownState
  nowMs?: number
}

export type EscalationPipelineOutput = {
  decision: EscalationPipelineAction
  cooldownState: TriggerCooldownState
}

export function evaluateEscalationPipeline(input: EscalationPipelineInput): EscalationPipelineOutput {
  const now = input.nowMs ?? Date.now()
  let cooldownState = input.cooldownState
  const gate = evaluateConfidenceGate(input.signal, input.confidenceGate)

  if (gate.outcome === 'ignore') {
    return { decision: { action: 'ignore', reason: gate.reason }, cooldownState }
  }

  const triggers = resolveTriggersFromSignal(input.signal)
  if (triggers.length === 0) {
    return { decision: { action: 'ignore', reason: 'no_matching_trigger' }, cooldownState }
  }

  const def = triggers.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0]!

  if (isTriggerOnCooldown(def.type, cooldownState, now)) {
    return {
      decision: { action: 'ignore', reason: `cooldown_active:${def.type}` },
      cooldownState,
    }
  }

  const risk = buildRiskEvent(def, input.signal, now)

  if (gate.outcome === 'require_confirmation' || gate.outcome === 'delay') {
    return {
      decision: {
        action: 'advisory',
        risk,
        reason: gate.outcome === 'delay' ? `delayed:${gate.reason}` : gate.reason,
      },
      cooldownState,
    }
  }

  if (!presetAllowsAutoEscalation(def.kind, input.mode)) {
    return {
      decision: { action: 'advisory', risk, reason: 'preset_blocks_auto_escalation' },
      cooldownState,
    }
  }

  cooldownState = markTriggerCooldown(def.type, cooldownState, now)
  return { decision: { action: 'escalate', risk, trigger: def }, cooldownState }
}

function severityRank(s: EscalationTriggerDef['severity']): number {
  if (s === 'high') return 3
  if (s === 'medium') return 2
  return 1
}

export { createTriggerCooldownState }
