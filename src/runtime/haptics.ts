/**
 * LOW-POWER HAPTIC BROKER — Phase 2.
 *
 * Single runtime-owned service for tactile confirmation of:
 *   - wakeWord         → very short subtle tap (~12ms)
 *   - commandSuccess   → tiny confirmation tap (~18ms)  — verified executions only
 *   - commandFailure   → slightly longer single pulse (~40ms) — critical reasons only
 *   - criticalAlert    → multi-pulse pattern (~[120,80,120]ms) — corridor breach,
 *                        SOS arm, rescue protocol, etc. Bypasses mobile-default
 *                        gating because field-critical alerts MUST fire on any
 *                        device that supports vibration.
 *
 * Design rules:
 *   - No React state, no intervals, no continuous patterns, no Morse / SOS streams.
 *   - Capability-gated: silent no-op on devices without `vibrate`.
 *   - Defaults ON for mobile/tablet (interactionMode === 'mobile'), OFF on desktop.
 *     `criticalAlert` ignores the mode-default gate (still respects `setHapticsEnabled(false)`).
 *   - Throttled with a global minimum spacing window AND a per-event cooldown.
 *   - Pure observability via `runtime/logger.ts` and runtime snapshot mirror.
 *
 * Dependency-free: no imports from `runtimeSnapshot.ts` (avoids cycles).
 * The snapshot wires a listener via `setHapticsStateListener` during install
 * and mirrors `getHapticsSnapshot()` reads.
 */

import { getDeviceProfile } from './deviceProfile'
import { logInfo, logWarn } from './logger'

// ---------- public types ----------

export type HapticEventKind = 'wakeWord' | 'commandSuccess' | 'commandFailure' | 'criticalAlert'

export type HapticSuppressedReason =
  | 'throttled'
  | 'cooldown'
  | 'disabled'
  | 'unsupported'
  | null

export interface HapticsSnapshot {
  supported: boolean
  enabled: boolean
  lastEvent: HapticEventKind | null
  lastPulseAt: number | null
  attemptCount: number
  suppressedCount: number
  lastSuppressedReason: HapticSuppressedReason
}

// ---------- pulse contracts ----------

/**
 * Pulse durations / patterns. Single number = one short tap.
 * Pattern array follows the navigator.vibrate convention
 * (vibrate, pause, vibrate, ...) and is used for `criticalAlert` only.
 */
const PULSE_MS: Record<Exclude<HapticEventKind, 'criticalAlert'>, number> = {
  wakeWord: 12,
  commandSuccess: 18,
  commandFailure: 40,
}

/** `criticalAlert` uses a multi-pulse pattern so it is unambiguously
 *  distinguishable from low-noise success/failure taps. */
const CRITICAL_ALERT_PATTERN: ReadonlyArray<number> = [120, 80, 120]

/** Per-event cooldowns (ms). Prevents re-fire on rapid SR partials or
 *  cascading failures. `criticalAlert` has a long cooldown so corridor
 *  breach / SOS / rescue events cannot vibrate-spam. */
const COOLDOWN_MS: Record<HapticEventKind, number> = {
  wakeWord: 600,
  commandSuccess: 250,
  commandFailure: 600,
  criticalAlert: 1500,
}

/** Global minimum spacing between any two pulses. `criticalAlert` is
 *  exempt because field-critical alerts must always reach the user. */
const GLOBAL_MIN_SPACING_MS = 350

// ---------- internal state ----------

const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

let enabled: boolean = (() => {
  try {
    return supported && getDeviceProfile().interactionMode === 'mobile'
  } catch {
    return false
  }
})()

let lastEvent: HapticEventKind | null = null
let lastPulseAt: number | null = null
let attemptCount = 0
let suppressedCount = 0
let lastSuppressedReason: HapticSuppressedReason = null
const lastEventAt: Record<HapticEventKind, number | null> = {
  wakeWord: null,
  commandSuccess: null,
  commandFailure: null,
  criticalAlert: null,
}

// ---------- listener injection (runtimeSnapshot mirror) ----------

let stateListener: ((s: HapticsSnapshot) => void) | null = null

export function setHapticsStateListener(fn: ((s: HapticsSnapshot) => void) | null): void {
  stateListener = fn
  if (fn) fn(getHapticsSnapshot())
}

function notifyState(): void {
  if (!stateListener) return
  try {
    stateListener(getHapticsSnapshot())
  } catch {
    // listener errors must never disturb runtime
  }
}

// ---------- public API ----------

export function getHapticsSnapshot(): HapticsSnapshot {
  return {
    supported,
    enabled,
    lastEvent,
    lastPulseAt,
    attemptCount,
    suppressedCount,
    lastSuppressedReason,
  }
}

export function isHapticsSupported(): boolean {
  return supported
}

export function isHapticsEnabled(): boolean {
  return enabled
}

/** Toggleable for future settings UI. Architected now; UI optional later. */
export function setHapticsEnabled(next: boolean): void {
  if (enabled === next) return
  enabled = next && supported
  logInfo('RUNTIME', `haptics enabled -> ${enabled}`)
  notifyState()
}

/**
 * Emit a haptic for a known event. Returns `true` if the pulse was
 * actually dispatched, `false` if suppressed. Always returns synchronously
 * and never throws.
 *
 * `criticalAlert` is treated as field-critical: it bypasses the
 * mobile-default `enabled` gate (still respects an explicit
 * `setHapticsEnabled(false)`) and bypasses the global min-spacing
 * window. Per-event cooldown still applies so it cannot vibrate-spam.
 */
export function emitHaptic(kind: HapticEventKind, context?: string): boolean {
  attemptCount += 1
  const isCritical = kind === 'criticalAlert'

  if (!supported) {
    suppressedCount += 1
    lastSuppressedReason = 'unsupported'
    // Single warn at first occurrence is enough; afterwards INFO so PROD console stays quiet.
    if (suppressedCount === 1) {
      logWarn('RUNTIME', '[HAPTIC_UNSUPPORTED] navigator.vibrate not available')
    }
    notifyState()
    return false
  }

  // Critical alerts ignore the mobile-default `enabled` gate so corridor
  // breach / SOS / rescue still fires on tablets that fall back to desktop
  // gating, but explicit user disable via `setHapticsEnabled(false)` is
  // still honored (treated as opt-out).
  if (!enabled && !isCritical) {
    suppressedCount += 1
    lastSuppressedReason = 'disabled'
    logInfo('RUNTIME', `[HAPTIC_SUPPRESSED] kind=${kind} reason=disabled${context ? ` ctx=${context}` : ''}`)
    notifyState()
    return false
  }

  const now = Date.now()
  if (!isCritical && lastPulseAt != null && now - lastPulseAt < GLOBAL_MIN_SPACING_MS) {
    suppressedCount += 1
    lastSuppressedReason = 'throttled'
    logInfo('RUNTIME', `[HAPTIC_SUPPRESSED] kind=${kind} reason=throttled gap=${now - lastPulseAt}ms`)
    notifyState()
    return false
  }

  const eventLast = lastEventAt[kind]
  if (eventLast != null && now - eventLast < COOLDOWN_MS[kind]) {
    suppressedCount += 1
    lastSuppressedReason = 'cooldown'
    logInfo('RUNTIME', `[HAPTIC_SUPPRESSED] kind=${kind} reason=cooldown gap=${now - eventLast}ms`)
    notifyState()
    return false
  }

  try {
    if (isCritical) {
      navigator.vibrate(CRITICAL_ALERT_PATTERN as number[])
    } else {
      navigator.vibrate(PULSE_MS[kind as Exclude<HapticEventKind, 'criticalAlert'>])
    }
  } catch {
    // best-effort; some browsers throw on certain origins or in iframes
    suppressedCount += 1
    lastSuppressedReason = 'unsupported'
    notifyState()
    return false
  }

  lastEvent = kind
  lastPulseAt = now
  lastEventAt[kind] = now
  lastSuppressedReason = null
  const printable = isCritical
    ? `pattern=[${CRITICAL_ALERT_PATTERN.join(',')}]`
    : `ms=${PULSE_MS[kind as Exclude<HapticEventKind, 'criticalAlert'>]}`
  logInfo('RUNTIME', `[HAPTIC] kind=${kind} ${printable}${context ? ` ctx=${context}` : ''}`)
  notifyState()
  return true
}

// ---------- devtools hook (read-only convenience) ----------

if (typeof window !== 'undefined') {
  const w = window as Window & {
    __hudHaptics?: {
      get: () => HapticsSnapshot
      enable: (v: boolean) => void
      test: (k: HapticEventKind) => boolean
    }
  }
  w.__hudHaptics = {
    get: getHapticsSnapshot,
    enable: setHapticsEnabled,
    test: (k) => emitHaptic(k, 'devtools.test'),
  }
}
