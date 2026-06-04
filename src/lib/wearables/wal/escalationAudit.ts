/**
 * WAL escalation audit log — append-only, no PII, no message content.
 */

import type { EscalationRiskEvent, EscalationState, WearableSignalType } from './types'

export type EscalationAuditEntry = {
  ts: number
  event:
    | 'signal_ingested'
    | 'risk_qualified'
    | 'escalation_entered'
    | 'timer_tick'
    | 'user_cancel'
    | 'user_confirm'
    | 'timer_expired'
    | 'sos_dispatch_requested'
    | 'sos_dispatch_completed'
    | 'adapter_disconnect'
    | 'state_reset'
  state: EscalationState
  detail?: string
  trigger?: EscalationRiskEvent['trigger']
  signalType?: WearableSignalType
  sourceDevice?: string
}

const MAX_AUDIT = 50
let auditLog: EscalationAuditEntry[] = []

export function recordEscalationAudit(entry: Omit<EscalationAuditEntry, 'ts'> & { ts?: number }): void {
  auditLog = [
    ...auditLog,
    {
      ...entry,
      ts: entry.ts ?? Date.now(),
    },
  ].slice(-MAX_AUDIT)
  if (import.meta.env.DEV) {
    console.info('[WAL-AUDIT]', entry.event, entry.state, entry.detail ?? '')
  }
}

export function getEscalationAuditLog(): readonly EscalationAuditEntry[] {
  return auditLog
}

export function _resetEscalationAuditForTests(): void {
  auditLog = []
}
