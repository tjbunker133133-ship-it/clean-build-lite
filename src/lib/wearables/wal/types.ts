/**
 * Wearable Abstraction Layer (WAL) — normalized signal model.
 * Pure data types only. No emergency logic in this file.
 */

export type WearableSignalType =
  | 'heart_rate'
  | 'motion'
  | 'fall'
  | 'sleep'
  | 'stress'
  | 'battery'
  | 'notification_ack'
  | 'inactivity'
  | 'user_emergency'

export type WearableSignal = {
  type: WearableSignalType
  value: number | Record<string, unknown>
  timestamp: number
  sourceDevice: string
  confidence: number
}

export type WearableAdapterKind =
  | 'android_health_connect'
  | 'android_notification_mirror'
  | 'ios_healthkit'
  | 'ios_notification_mirror'
  | 'smart_ring'
  | 'smart_glasses'
  | 'generic_fallback'

export type WearableCapability =
  | 'heart_rate'
  | 'steps'
  | 'fall_detection'
  | 'motion'
  | 'sleep'
  | 'battery'
  | 'notification_out'
  | 'notification_ack'
  | 'haptic_out'
  | 'display_out'
  | 'user_emergency_button'

export type WearableAdapterIdentity = {
  adapterId: string
  kind: WearableAdapterKind
  displayName: string
  authenticated: boolean
}

export type WearableAdapterCapabilities = {
  identity: WearableAdapterIdentity
  capabilities: WearableCapability[]
  platformNote?: string
}

/** Raw signal stream — adapters emit here; no business logic in adapters. */
export type WearableSignalHandler = (signal: WearableSignal) => void

export type WearableAdapter = {
  readonly capabilities: WearableAdapterCapabilities
  /** Establish session / permissions. Returns false if unavailable. */
  authenticate(): Promise<boolean>
  /** Start streaming normalized signals. */
  startStreaming(onSignal: WearableSignalHandler): Promise<void>
  /** Stop streaming; must be safe to call multiple times. */
  stopStreaming(): Promise<void>
  /** Optional one-shot poll (e.g. Health Connect refresh). */
  pollSignals?(): Promise<WearableSignal[]>
}

export type EscalationState =
  | 'normal'
  | 'risk_detected'
  | 'escalation_pending'
  | 'user_cancelled'
  | 'escalation_confirmed'
  | 'sos_dispatched'

export type EscalationTriggerKind =
  | 'heart_rate_zero_or_absent'
  | 'fall_detected'
  | 'prolonged_inactivity'
  | 'user_emergency_button'
  | 'manual_operator'

export type EscalationRiskEvent = {
  trigger: EscalationTriggerKind
  at: number
  sourceDevice: string
  signal?: WearableSignal
  detail?: string
}

export type EscalationSnapshot = {
  state: EscalationState
  enteredAt: number
  /** ms remaining when escalation_pending; null otherwise */
  timerRemainingMs: number | null
  timerTotalMs: number | null
  lastRisk: EscalationRiskEvent | null
  lastTransitionReason: string
}

export type ReadinessIndicator = {
  id: string
  label: string
  severity: 'ok' | 'warn' | 'info'
  detail: string
}

export type InterpretationSnapshot = {
  readiness: ReadinessIndicator[]
  /** Non-emergency suggestions — never triggers SOS */
  suggestions: string[]
  affirmations: string[]
}

export type OutputChannelKind = 'phone' | 'watch_notification' | 'glasses_display' | 'ring_passive'

export type EscalationProjection = {
  state: EscalationState
  title: string
  body: string
  urgency: 'info' | 'warn' | 'critical'
  channels: OutputChannelKind[]
}
