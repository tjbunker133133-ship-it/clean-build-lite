/**
 * Camera Authority Guard — single-writer stabilization (debug + recovery pass).
 *
 * Ensures automated camera systems defer to user override and debounces intent spam.
 * Does NOT replace ModernCameraController — gates automated writes only.
 */

import type { CameraIntent } from './operationalPerception/types'

const USER_OVERRIDE_TTL_MS = 45_000
const INTENT_DEBOUNCE_MS = 450
const FOLLOW_MIN_DISTANCE_M = 8

let userOverrideUntil = 0
let lastIntentKey: string | null = null
let lastIntentAt = 0
let lastAutomatedSource: string | null = null
let lastAutomatedWriteAt = 0
let intentQueueDepth = 0
let lastFollowCenter: { lng: number; lat: number } | null = null
let stabilizedZoomOffset = 0

function intentKey(intent: CameraIntent): string {
  if (intent.kind === 'ease_to') {
    const c = intent.center
    return `ease:${c?.[0]?.toFixed(5) ?? 'x'}:${c?.[1]?.toFixed(5) ?? 'x'}:${intent.zoom ?? 'z'}:${intent.bearing ?? 'b'}`
  }
  return `zoom_by:${intent.delta}`
}

function debugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  if (import.meta.env.DEV) return true
  try {
    return window.location.search.includes('e2e=1')
  } catch {
    return false
  }
}

function trace(event: string, detail?: Record<string, unknown>): void {
  if (!debugEnabled()) return
  console.debug(`[CAMERA-AUTHORITY] ${event}`, detail)
}

/** User panned/zoomed — block automated follow for a cooldown window. */
export function activateUserCameraOverride(): void {
  userOverrideUntil = Date.now() + USER_OVERRIDE_TTL_MS
  trace('user_override_active', { until: userOverrideUntil })
}

export function isUserCameraOverrideActive(): boolean {
  return Date.now() < userOverrideUntil
}

/** Automated GPS follow / physics may run only when user has not taken control. */
export function shouldAllowAutomatedCamera(): boolean {
  const allowed = !isUserCameraOverrideActive()
  if (!allowed) {
    trace('automated_blocked', { reason: 'user_override' })
  }
  return allowed
}

/** Debounce identical camera intents within a short window. */
export function shouldAcceptCameraIntent(intent: CameraIntent): boolean {
  const key = intentKey(intent)
  const now = Date.now()
  if (lastIntentKey === key && now - lastIntentAt < INTENT_DEBOUNCE_MS) {
    trace('intent_debounced', { key })
    return false
  }
  lastIntentKey = key
  lastIntentAt = now
  intentQueueDepth += 1
  trace('intent_accepted', { key, queueDepth: intentQueueDepth })
  return true
}

export function recordIntentConsumed(): void {
  intentQueueDepth = Math.max(0, intentQueueDepth - 1)
}

export function recordAutomatedCameraWrite(source: string): void {
  lastAutomatedSource = source
  lastAutomatedWriteAt = Date.now()
  trace('automated_write', { source })
}

/**
 * GPS follow distance gate — skip micro-jitter recentering.
 * Returns true when follow should proceed.
 */
export function shouldFollowGpsTo(lng: number, lat: number): boolean {
  if (!shouldAllowAutomatedCamera()) return false
  const prev = lastFollowCenter
  if (prev) {
    const dLng = (lng - prev.lng) * 111_320 * Math.cos((lat * Math.PI) / 180)
    const dLat = (lat - prev.lat) * 110_540
    const distM = Math.hypot(dLng, dLat)
    if (distM < FOLLOW_MIN_DISTANCE_M) return false
  }
  lastFollowCenter = { lng, lat }
  return true
}

/**
 * Stabilize speed-based zoom offset to prevent threshold oscillation.
 */
export function stabilizedNavigationZoomOffset(speedMs: number): number {
  const kmh = speedMs * 3.6
  let raw = 0
  if (kmh >= 1.0) raw = 0.25
  if (kmh >= 6.0) raw = -0.15
  // Hysteresis: require meaningful change before flipping
  if (Math.abs(raw - stabilizedZoomOffset) < 0.12) return stabilizedZoomOffset
  stabilizedZoomOffset = raw
  return raw
}

/** Cancel animations, flush intents, reset follow state (mode switch / overlay safety). */
export function flushCameraAuthority(): void {
  userOverrideUntil = 0
  lastIntentKey = null
  lastIntentAt = 0
  lastAutomatedSource = null
  lastAutomatedWriteAt = 0
  intentQueueDepth = 0
  lastFollowCenter = null
  stabilizedZoomOffset = 0
  trace('flush')
}

export function getCameraAuthorityDebug(): {
  activeAuthority: string
  intentQueueDepth: number
  gpsFollowAllowed: boolean
  lastWriteSource: string | null
  lastWriteAt: number
  userOverrideActive: boolean
  userOverrideUntil: number
} {
  return {
    activeAuthority: 'ModernCameraController',
    intentQueueDepth,
    gpsFollowAllowed: shouldAllowAutomatedCamera(),
    lastWriteSource: lastAutomatedSource,
    lastWriteAt: lastAutomatedWriteAt,
    userOverrideActive: isUserCameraOverrideActive(),
    userOverrideUntil,
  }
}

export function publishCameraAuthorityDebug(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & { __CAMERA_AUTHORITY_DEBUG__?: () => ReturnType<typeof getCameraAuthorityDebug> }
  w.__CAMERA_AUTHORITY_DEBUG__ = () => getCameraAuthorityDebug()
}

publishCameraAuthorityDebug()
