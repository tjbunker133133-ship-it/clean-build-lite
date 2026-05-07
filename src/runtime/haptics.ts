/**
 * LOW-POWER HAPTIC BROKER — Phase 1.
 *
 * Single runtime-owned service for tactile confirmation of three events:
 *   - wakeWord         → very short subtle tap (~12ms)
 *   - commandSuccess   → tiny confirmation tap (~18ms)  — verified executions only
 *   - commandFailure   → slightly longer single pulse (~40ms) — critical reasons only
 *
 * Design rules:
 *   - No React state, no intervals, no continuous patterns, no Morse / SOS streams.
 *   - Capability-gated: silent no-op on desktop and on devices without `vibrate`.
 *   - Defaults ON for mobile/tablet (interactionMode === 'mobile'), OFF on desktop.
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

export type HapticEventKind = 'wakeWord' | 'commandSuccess' | 'commandFailure'

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

const PULSE_MS: Record<HapticEventKind, number> = {
  wakeWord: 12,
  commandSuccess: 18,
  commandFailure: 40,
}

/** Per-event cooldowns (ms). Prevents re-fire on rapid SR partials or
 *  cascading failures. */
const COOLDOWN_MS: Record<HapticEventKind, number> = {
  wakeWord: 600,
  commandSuccess: 250,
  commandFailure: 600,
}

/** Global minimum spacing between any two pulses. */
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
 */
export function emitHaptic(kind: HapticEventKind, context?: string): boolean {
  attemptCount += 1

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

  if (!enabled) {
    suppressedCount += 1
    lastSuppressedReason = 'disabled'
    logInfo('RUNTIME', `[HAPTIC_SUPPRESSED] kind=${kind} reason=disabled${context ? ` ctx=${context}` : ''}`)
    notifyState()
    return false
  }

  const now = Date.now()
  if (lastPulseAt != null && now - lastPulseAt < GLOBAL_MIN_SPACING_MS) {
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

  const ms = PULSE_MS[kind]
  try {
    navigator.vibrate(ms)
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
  logInfo('RUNTIME', `[HAPTIC] kind=${kind} ms=${ms}${context ? ` ctx=${context}` : ''}`)
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
