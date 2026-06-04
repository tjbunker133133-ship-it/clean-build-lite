import type { EscalationState } from './types'
import { WAL_PROJECTION_DEBOUNCE_MS } from './walRuntimeConfig'

export type ProjectionThrottleState = {
  lastState: EscalationState | null
  lastCountdownBucket: number | null
  lastProjectedAt: number
}

export function createProjectionThrottleState(): ProjectionThrottleState {
  return { lastState: null, lastCountdownBucket: null, lastProjectedAt: 0 }
}

/** Countdown bucket for debouncing watch notifications (e.g. 5s steps). */
function countdownBucket(remainingMs: number | null | undefined): number | null {
  if (remainingMs == null) return null
  return Math.ceil(remainingMs / WAL_PROJECTION_DEBOUNCE_MS)
}

export function shouldProjectEscalation(
  state: EscalationState,
  timerRemainingMs: number | null | undefined,
  throttle: ProjectionThrottleState,
  nowMs: number = Date.now(),
): boolean {
  const bucket = state === 'escalation_pending' ? countdownBucket(timerRemainingMs) : null

  if (throttle.lastState !== state) return true
  if (state === 'escalation_pending' && bucket !== throttle.lastCountdownBucket) return true

  if (state === 'risk_detected' || state === 'normal') {
    return nowMs - throttle.lastProjectedAt >= WAL_PROJECTION_DEBOUNCE_MS * 2
  }

  return nowMs - throttle.lastProjectedAt >= WAL_PROJECTION_DEBOUNCE_MS
}

export function markProjected(
  state: EscalationState,
  timerRemainingMs: number | null | undefined,
  throttle: ProjectionThrottleState,
  nowMs: number = Date.now(),
): ProjectionThrottleState {
  return {
    lastState: state,
    lastCountdownBucket: state === 'escalation_pending' ? countdownBucket(timerRemainingMs) : null,
    lastProjectedAt: nowMs,
  }
}
