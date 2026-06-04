/**
 * WAL escalation state machine — deterministic reducer (single source of truth).
 * SOS dispatch side effect occurs ONLY via SOS_DISPATCHED event.
 */

import { recordEscalationAudit } from './escalationAudit'
import type {
  EscalationRiskEvent,
  EscalationSnapshot,
  EscalationState,
  EscalationTriggerKind,
} from './types'

export type EscalationTriggerType = 'fall' | 'hr_zero' | 'inactivity' | 'manual'

export interface EscalationTrigger {
  type: EscalationTriggerType
  severity: 'low' | 'medium' | 'high'
  requiresConfirmation: boolean
  cooldownMs: number
}

export interface EscalationEvent {
  type:
    | 'RISK_DETECTED'
    | 'START_ESCALATION'
    | 'CANCEL_ESCALATION'
    | 'CONFIRM_ESCALATION'
    | 'TIMER_EXPIRED'
    | 'RESET'
    | 'SOS_DISPATCHED'
  trigger?: EscalationTrigger
  timestamp: number
  /** Optional audit detail (reason string, source device, etc.) */
  detail?: string
}

export interface EscalationContext {
  state: EscalationState
  /** Active countdown duration in ms (configured before START_ESCALATION) */
  countdownMs?: number
  /** When escalation_pending started */
  startedAt?: number
  lastRisk?: EscalationRiskEvent | null
  /** Audit trail hook */
  audit?: (event: EscalationEvent, nextState: EscalationState) => void
  /** SOS dispatch hook — invoked ONLY on SOS_DISPATCHED; defaults to no-op */
  dispatchSos?: () => void
  /** Prevents multiple dispatches per cycle */
  sosLocked?: boolean
}

export interface EscalationResult {
  state: EscalationState
  countdownMs?: number
  startedAt?: number
  sosLocked?: boolean
  lastRisk?: EscalationRiskEvent | null
  /** True when caller should invoke external async SOS pipeline (after CONFIRM or TIMER_EXPIRED) */
  shouldRequestSosDispatch?: boolean
}

const DEFAULT_COUNTDOWN_MS = 30_000

const BLOCKED_FOR_ADVISORY: EscalationState[] = [
  'escalation_pending',
  'escalation_confirmed',
  'sos_dispatched',
]

function audit(ctx: EscalationContext, event: EscalationEvent, next: EscalationState): void {
  ctx.audit?.(event, next)
  mapEventToRecordAudit(event, next, ctx.lastRisk ?? undefined)
}

function mapEventToRecordAudit(
  event: EscalationEvent,
  state: EscalationState,
  risk?: EscalationRiskEvent,
): void {
  switch (event.type) {
    case 'RISK_DETECTED':
      recordEscalationAudit({
        event: 'risk_qualified',
        state,
        trigger: risk?.trigger,
        sourceDevice: risk?.sourceDevice,
        detail: event.detail ?? 'advisory_only',
      })
      break
    case 'START_ESCALATION':
      recordEscalationAudit({
        event: 'escalation_entered',
        state,
        trigger: risk?.trigger,
        sourceDevice: risk?.sourceDevice,
        detail: event.detail ?? `timer_ms=${DEFAULT_COUNTDOWN_MS}`,
      })
      break
    case 'CANCEL_ESCALATION':
      recordEscalationAudit({ event: 'user_cancel', state, detail: event.detail })
      break
    case 'CONFIRM_ESCALATION':
      recordEscalationAudit({ event: 'user_confirm', state, detail: event.detail })
      recordEscalationAudit({ event: 'sos_dispatch_requested', state })
      break
    case 'TIMER_EXPIRED':
      recordEscalationAudit({ event: 'timer_expired', state })
      recordEscalationAudit({ event: 'sos_dispatch_requested', state })
      break
    case 'SOS_DISPATCHED':
      recordEscalationAudit({ event: 'sos_dispatch_completed', state, detail: event.detail })
      break
    case 'RESET':
      recordEscalationAudit({ event: 'state_reset', state, detail: event.detail })
      break
    default:
      break
  }
}

function unchanged(ctx: EscalationContext): EscalationResult {
  return {
    state: ctx.state,
    countdownMs: ctx.countdownMs,
    startedAt: ctx.startedAt,
    sosLocked: ctx.sosLocked,
    lastRisk: ctx.lastRisk ?? null,
  }
}

/**
 * CORE REDUCER — SINGLE SOURCE OF TRUTH
 */
export function escalationReducer(ctx: EscalationContext, event: EscalationEvent): EscalationResult {
  const now = event.timestamp

  switch (event.type) {
    case 'RISK_DETECTED': {
      if (BLOCKED_FOR_ADVISORY.includes(ctx.state)) {
        return unchanged(ctx)
      }
      const next = 'risk_detected'
      audit(ctx, event, next)
      return {
        state: next,
        lastRisk: ctx.lastRisk ?? null,
        countdownMs: undefined,
        startedAt: undefined,
      }
    }

    case 'START_ESCALATION': {
      if (BLOCKED_FOR_ADVISORY.includes(ctx.state)) {
        return unchanged(ctx)
      }
      const next = 'escalation_pending'
      const countdownMs = ctx.countdownMs ?? DEFAULT_COUNTDOWN_MS
      audit(ctx, event, next)
      return {
        state: next,
        countdownMs,
        startedAt: now,
        lastRisk: ctx.lastRisk ?? null,
      }
    }

    case 'CANCEL_ESCALATION': {
      if (ctx.state !== 'escalation_pending' && ctx.state !== 'risk_detected') {
        return unchanged(ctx)
      }
      const next = 'user_cancelled'
      audit(ctx, event, next)
      return {
        state: next,
        countdownMs: undefined,
        startedAt: undefined,
        lastRisk: ctx.lastRisk ?? null,
      }
    }

    case 'CONFIRM_ESCALATION': {
      if (ctx.state !== 'escalation_pending') {
        return unchanged(ctx)
      }
      const next = 'escalation_confirmed'
      audit(ctx, event, next)
      return {
        state: next,
        countdownMs: 0,
        startedAt: ctx.startedAt,
        lastRisk: ctx.lastRisk ?? null,
        shouldRequestSosDispatch: true,
      }
    }

    case 'TIMER_EXPIRED': {
      if (ctx.state !== 'escalation_pending') {
        return unchanged(ctx)
      }
      const next = 'escalation_confirmed'
      audit(ctx, event, next)
      return {
        state: next,
        countdownMs: 0,
        startedAt: ctx.startedAt,
        lastRisk: ctx.lastRisk ?? null,
        shouldRequestSosDispatch: true,
      }
    }

    case 'SOS_DISPATCHED': {
      if (ctx.sosLocked || ctx.state !== 'escalation_confirmed') {
        return unchanged(ctx)
      }
      ctx.dispatchSos?.()
      const next = 'sos_dispatched'
      audit(ctx, event, next)
      return {
        state: next,
        sosLocked: true,
        lastRisk: ctx.lastRisk ?? null,
      }
    }

    case 'RESET': {
      const next = 'normal'
      audit(ctx, event, next)
      return {
        state: next,
        countdownMs: undefined,
        startedAt: undefined,
        sosLocked: false,
        lastRisk: null,
      }
    }

    default:
      return unchanged(ctx)
  }
}

export const EscalationActions = {
  riskDetected: (trigger?: EscalationTrigger, detail?: string): EscalationEvent => ({
    type: 'RISK_DETECTED',
    trigger,
    timestamp: Date.now(),
    detail,
  }),

  start: (detail?: string): EscalationEvent => ({
    type: 'START_ESCALATION',
    timestamp: Date.now(),
    detail,
  }),

  cancel: (detail?: string): EscalationEvent => ({
    type: 'CANCEL_ESCALATION',
    timestamp: Date.now(),
    detail,
  }),

  confirm: (detail?: string): EscalationEvent => ({
    type: 'CONFIRM_ESCALATION',
    timestamp: Date.now(),
    detail,
  }),

  timerExpired: (): EscalationEvent => ({
    type: 'TIMER_EXPIRED',
    timestamp: Date.now(),
  }),

  sosDispatched: (detail?: string): EscalationEvent => ({
    type: 'SOS_DISPATCHED',
    timestamp: Date.now(),
    detail,
  }),

  reset: (detail?: string): EscalationEvent => ({
    type: 'RESET',
    timestamp: Date.now(),
    detail,
  }),
} as const

export function createEscalationContext(partial?: Partial<EscalationContext>): EscalationContext {
  return {
    state: 'normal',
    sosLocked: false,
    lastRisk: null,
    ...partial,
  }
}

export function applyEscalationResult(
  ctx: EscalationContext,
  result: EscalationResult,
): EscalationContext {
  return {
    ...ctx,
    state: result.state,
    countdownMs: result.countdownMs !== undefined ? result.countdownMs : ctx.countdownMs,
    startedAt: result.startedAt !== undefined ? result.startedAt : ctx.startedAt,
    sosLocked: result.sosLocked !== undefined ? result.sosLocked : ctx.sosLocked,
    lastRisk: result.lastRisk !== undefined ? result.lastRisk : ctx.lastRisk,
  }
}

/** Remaining ms when escalation_pending; null otherwise. */
export function getCountdownRemainingMs(ctx: EscalationContext, nowMs: number = Date.now()): number | null {
  if (ctx.state !== 'escalation_pending' || ctx.startedAt == null || ctx.countdownMs == null) {
    return null
  }
  return Math.max(0, ctx.countdownMs - (nowMs - ctx.startedAt))
}

/** Tick countdown; returns TIMER_EXPIRED event when elapsed, else null. */
export function tickEscalationCountdown(
  ctx: EscalationContext,
  nowMs: number = Date.now(),
): EscalationEvent | null {
  if (ctx.state !== 'escalation_pending') return null
  const remaining = getCountdownRemainingMs(ctx, nowMs)
  if (remaining == null) return null
  if (remaining === 0) {
    return { ...EscalationActions.timerExpired(), timestamp: nowMs }
  }
  return null
}

export function contextToSnapshot(ctx: EscalationContext, nowMs: number = Date.now()): EscalationSnapshot {
  const remaining = getCountdownRemainingMs(ctx, nowMs)
  return {
    state: ctx.state,
    enteredAt: ctx.startedAt ?? nowMs,
    timerRemainingMs: remaining,
    timerTotalMs: ctx.state === 'escalation_pending' ? (ctx.countdownMs ?? null) : null,
    lastRisk: ctx.lastRisk ?? null,
    lastTransitionReason: ctx.state,
  }
}

export function createEscalationSnapshot(
  partial?: Partial<EscalationSnapshot>,
  nowMs: number = Date.now(),
): EscalationSnapshot {
  return contextToSnapshot(
    createEscalationContext({
      state: partial?.state ?? 'normal',
      startedAt: partial?.enteredAt,
      countdownMs: partial?.timerTotalMs ?? undefined,
      lastRisk: partial?.lastRisk ?? null,
    }),
    nowMs,
  )
}

export function mapTriggerKindToType(kind: EscalationTriggerKind): EscalationTriggerType {
  switch (kind) {
    case 'fall_detected':
      return 'fall'
    case 'heart_rate_zero_or_absent':
      return 'hr_zero'
    case 'prolonged_inactivity':
      return 'inactivity'
    default:
      return 'manual'
  }
}

export function mapSignalToTrigger(signalType: string): EscalationTriggerKind | null {
  switch (signalType) {
    case 'heart_rate':
      return 'heart_rate_zero_or_absent'
    case 'fall':
      return 'fall_detected'
    case 'inactivity':
      return 'prolonged_inactivity'
    case 'user_emergency':
      return 'user_emergency_button'
    default:
      return null
  }
}

/** @deprecated Use escalationReducer + EscalationActions */
export type EscalationMachineConfig = { timerMs: number; nowMs?: number }

/** @deprecated Use EscalationEvent */
export type EscalationMachineAction =
  | { type: 'RISK_QUALIFIED'; risk: EscalationRiskEvent }
  | { type: 'ADVISORY_RISK'; risk: EscalationRiskEvent }
  | { type: 'USER_CANCEL'; reason?: string }
  | { type: 'USER_CONFIRM'; reason?: string }
  | { type: 'TIMER_EXPIRED' }
  | { type: 'SOS_DISPATCH_ACK'; reason?: string }
  | { type: 'RESET'; reason?: string }
  | { type: 'TICK'; nowMs: number }

/** @deprecated Use EscalationResult.shouldRequestSosDispatch */
export type EscalationMachineResult = {
  snapshot: EscalationSnapshot
  shouldRequestSosDispatch: boolean
}

function snapshotToContext(snapshot: EscalationSnapshot, timerMs: number): EscalationContext {
  return createEscalationContext({
    state: snapshot.state,
    countdownMs: snapshot.timerTotalMs ?? timerMs,
    startedAt: snapshot.enteredAt,
    lastRisk: snapshot.lastRisk,
  })
}

/** Compatibility shim — maps legacy actions to escalationReducer. */
export function reduceEscalationMachine(
  snapshot: EscalationSnapshot,
  action: EscalationMachineAction,
  config: EscalationMachineConfig,
): EscalationMachineResult {
  let ctx = snapshotToContext(snapshot, config.timerMs)
  ctx.countdownMs = config.timerMs

  const now = config.nowMs ?? Date.now()

  const run = (event: EscalationEvent): EscalationMachineResult => {
    const result = escalationReducer(ctx, event)
    ctx = applyEscalationResult(ctx, result)
    return {
      snapshot: contextToSnapshot(ctx, event.timestamp),
      shouldRequestSosDispatch: result.shouldRequestSosDispatch ?? false,
    }
  }

  switch (action.type) {
    case 'ADVISORY_RISK':
      ctx.lastRisk = action.risk
      return run({ ...EscalationActions.riskDetected(undefined, 'advisory_risk'), timestamp: now })

    case 'RISK_QUALIFIED':
      ctx.lastRisk = action.risk
      return run({ ...EscalationActions.start(`timer_ms=${config.timerMs}`), timestamp: now })

    case 'USER_CANCEL': {
      const cancelled = run(EscalationActions.cancel(action.reason))
      return run(EscalationActions.reset('cancelled_to_normal'))
    }

    case 'USER_CONFIRM':
      return run(EscalationActions.confirm(action.reason))

    case 'TIMER_EXPIRED':
      return run(EscalationActions.timerExpired())

    case 'TICK': {
      const expired = tickEscalationCountdown(ctx, action.nowMs)
      if (expired) return run(expired)
      return { snapshot: contextToSnapshot(ctx, action.nowMs), shouldRequestSosDispatch: false }
    }

    case 'SOS_DISPATCH_ACK': {
      const dispatched = run(EscalationActions.sosDispatched(action.reason))
      return run(EscalationActions.reset('post_dispatch_reset'))
    }

    case 'RESET':
      return run(EscalationActions.reset(action.reason))

    default:
      return { snapshot, shouldRequestSosDispatch: false }
  }
}
