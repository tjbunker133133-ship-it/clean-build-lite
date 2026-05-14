import { useEffect, useMemo, useState } from 'react'
import {
  getRuntimeSnapshot,
  markLastKnownGoodSnapshotTime,
  subscribeRuntimeSnapshot,
  updateGpsRecoveryState,
  updatePermission,
} from '../runtime/runtimeSnapshot'
import { refreshOperationalMapResumeFromLocalStorage } from '../lib/operationalMapResume'
import { emitHaptic } from '../runtime/haptics'
import { haversineMeters } from '../lib/haversine'
import {
  chooseGpsPowerMode,
  GPS_DR_ACCURACY_DRIFT_MPS,
  GPS_DR_MAX_AGE_SEC,
  GPS_POLL_STABLE_MS,
  GPS_POLL_STATIONARY_MS,
  type GpsPowerMode,
} from '../lib/gpsAdaptivePolicy'
import { GEO_EXTERNAL_GRANT_EVENT } from '../lib/geoExternalGrant'

// ⚠️ LOCKED SYSTEM — Behavior Freeze Active
// Any change to interaction, layout, display modes, or layers requires explicit approval.

/**
 * Geolocation lifecycle: `requestLocation` drives the browser prompt. When
 * permission is already granted (Permissions API or persisted `gpsPermission`),
 * the first `useGPS` subscriber auto-starts the watch without an extra tap.
 */
export type LocationState = 'idle' | 'requesting' | 'granted' | 'denied' | 'error'

/** Compact UI status derived from `locationState` + fix (HUD panels / status rail). */
export type GPSUiStatus = 'idle' | 'locked' | 'searching' | 'denied' | 'unsupported' | 'error'

export function deriveGpsUiStatus(g: GPSData): GPSUiStatus {
  if (g.locationState === 'denied') return 'denied'
  const msg = (g.error ?? '').toLowerCase()
  if (g.locationState === 'error' && (msg.includes('not supported') || msg.includes('geolocation not'))) {
    return 'unsupported'
  }
  if (g.locationState === 'error') return 'error'
  if (g.locationState === 'requesting') return 'searching'
  if (g.locationState === 'granted' && g.lat != null && g.lng != null) return 'locked'
  if (g.locationState === 'granted') return 'searching'
  return 'idle'
}

export function shouldRunGpsStaleCheck(input: {
  visibilityState: DocumentVisibilityState | 'visible' | 'hidden'
}): boolean {
  return input.visibilityState === 'visible'
}

export type GpsPositionSource = 'gps' | 'interpolated'

export type GPSData = {
  lat: number | null
  lng: number | null
  accuracy: number | null
  /** Meters above ellipsoid from `GeolocationCoordinates.altitude` when the device reports it. */
  elevation: number | null
  locationState: LocationState
  source?: 'gps' | 'ip' | 'cached'
  error?: string
  /** `interpolated` = propagated between hardware fixes (adaptive power); never used for SOS math elsewhere. */
  positionSource?: GpsPositionSource
  /** Adaptive polling / interpolation regime (operator awareness + policy). */
  gpsPowerMode?: GpsPowerMode
}

export type { GpsPowerMode } from '../lib/gpsAdaptivePolicy'

const LAST_GPS_FIX_KEY = 'hud_last_gps_fix_v1'
const LAST_KNOWN_LOCATION_KEY = 'lastKnownLocation'
const GPS_PERMISSION_KEY = 'gpsPermission'

function altitudeMetersFromCoords(coords: GeolocationCoordinates): number | null {
  const a = coords.altitude
  if (a == null || Number.isNaN(a)) return null
  return a
}

function safeLocalStorageSetItem(key: string, value: string, context: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch (error) {
    console.warn(`[localStorage] failed setItem ${context}`, { key, error })
    return false
  }
}

function safeLocalStorageRemoveItem(key: string, context: string): boolean {
  try {
    localStorage.removeItem(key)
    return true
  } catch (error) {
    console.warn(`[localStorage] failed removeItem ${context}`, { key, error })
    return false
  }
}

function loadSeedGps(): GPSData {
  try {
    const raw = localStorage.getItem(LAST_KNOWN_LOCATION_KEY)
    const perm = localStorage.getItem(GPS_PERMISSION_KEY)
    if (!raw) {
      return {
        lat: null,
        lng: null,
        accuracy: null,
        elevation: null,
        locationState: perm === 'granted' ? 'granted' : 'idle',
      }
    }
    const parsed = JSON.parse(raw) as { lat?: number; lng?: number } | null
    const lat = typeof parsed?.lat === 'number' ? parsed.lat : null
    const lng = typeof parsed?.lng === 'number' ? parsed.lng : null
    return {
      lat,
      lng,
      accuracy: null,
      elevation: null,
      source: lat != null && lng != null ? 'cached' : undefined,
      locationState: perm === 'granted' ? 'granted' : 'idle',
    }
  } catch {
    return {
      lat: null,
      lng: null,
      accuracy: null,
      elevation: null,
      locationState: 'idle',
    }
  }
}

let shared: GPSData = loadSeedGps()

let listeners: ((g: GPSData) => void)[] = []
let watcherId: number | null = null
let requestInFlight = false
const requestWaiters: Array<() => void> = []
let hasGPSFix = false
let gpsFallbackTimer: number | null = null
let ipFallbackInFlight = false
let gpsAutoInitAttempted = false
/** Strict Mode / layout churn can drop listeners to 0 briefly; avoid tearing down the watch in that gap. */
let listenerZeroTimer: number | null = null
const LISTENER_ZERO_GRACE_MS = 450
let watchFlushRaf: number | null = null
let watchPending: GeolocationPosition | null = null
let watchRetryTimer: number | null = null
let lastGoodFixAt = Date.now()
let staleRecoveryRaised = false
/** Throttle localStorage writes from high-frequency watch updates (first fix still persists immediately). */
let lastGpsPersistAt = 0
const WATCH_PERSIST_MIN_MS = 12_000

let adaptivePollTimer: number | null = null
let activePollIntervalMs = 0
let drLoopId: number | null = null
let sosArmed = false
let lastSubscribedDeadManState: string | null = null
let lastPolicyTickMs = Date.now()
let stableHeadingStreak = 0
let lastHeadingDeg: number | null = null
let stationaryAccumMs = 0
let prevFixLat: number | null = null
let prevFixLng: number | null = null
let prevFixTime = 0
let lastHardwareFixMs = 0
let lastHardwareLat = 0
let lastHardwareLng = 0
let lastHardwareAcc: number | null = null
let lastHardwareElev: number | null = null
let drSpeedMsSmoothed = 0
let drHeadingDeg: number | null = null
let currentPowerMode: GpsPowerMode = 'active_navigation'

function gpsLoopDebugEnabled(): boolean {
  return (
    typeof window !== 'undefined' &&
    (
      (window as Window & { __HUD_LOOP_DEBUG__?: number }).__HUD_LOOP_DEBUG__ === 1 ||
      (window as Window & { HUD_LOOP_DEBUG?: number }).HUD_LOOP_DEBUG === 1
    )
  )
}

/** High-frequency GPS `console.log` telemetry: DEV only; enable via `localStorage.hud_tier1_debug = '1'` or loop-debug globals. */
function gpsTelemetryVerboseEnabled(): boolean {
  if (!import.meta.env.DEV) return false
  if (gpsLoopDebugEnabled()) return true
  try {
    return localStorage.getItem('hud_tier1_debug') === '1'
  } catch {
    return false
  }
}

function tier1GpsLog(next: GPSData): void {
  if (!import.meta.env.DEV) return
  try {
    if (typeof localStorage === 'undefined' || localStorage.getItem('hud_tier1_debug') !== '1') return
  } catch {
    return
  }
  console.info('[tier1:gps] update', {
    state: next.locationState,
    lat: next.lat,
    lng: next.lng,
    accuracy: next.accuracy,
  })
}

function sameGPS(a: GPSData, b: GPSData): boolean {
  const near = (x: number | null, y: number | null, eps: number) => {
    if (x == null && y == null) return true
    if (x == null || y == null) return false
    return Math.abs(x - y) <= eps
  }
  return (
    near(a.lat, b.lat, 0.000001) &&
    near(a.lng, b.lng, 0.000001) &&
    near(a.accuracy, b.accuracy, 0.25) &&
    near(a.elevation, b.elevation, 0.5) &&
    a.locationState === b.locationState &&
    (a.source ?? '') === (b.source ?? '') &&
    (a.error ?? '') === (b.error ?? '') &&
    (a.positionSource ?? 'gps') === (b.positionSource ?? 'gps') &&
    (a.gpsPowerMode ?? 'active_navigation') === (b.gpsPowerMode ?? 'active_navigation')
  )
}

function emit() {
  const snapshot = shared
  listeners.forEach((l) => {
    try {
      l(snapshot)
    } catch {
      /* ignore subscriber errors */
    }
  })
}

function setShared(next: GPSData) {
  // 🔒 CONTRACT: GPS-derived shared state protections are locked.
  // - Redundant updates must be ignored
  // - Update flow must remain idempotent and loop-safe
  // Do NOT modify without explicit approval
  if (sameGPS(shared, next)) {
    if (import.meta.env.DEV && gpsLoopDebugEnabled()) {
      console.warn('[GUARD] Prevented redundant GPS shared-state update')
    }
    return
  }
  if (gpsTelemetryVerboseEnabled()) {
    console.log('[GPS STATE UPDATE]', { lat: next.lat, lng: next.lng, source: next.source })
  }
  shared = next
  tier1GpsLog(next)
  emit()
}

function persistCurrentFix() {
  lastGpsPersistAt = Date.now()
  safeLocalStorageSetItem(LAST_GPS_FIX_KEY, JSON.stringify(shared), 'GPS persistCurrentFix')
  if (shared.lat != null && shared.lng != null) {
    safeLocalStorageSetItem(
      LAST_KNOWN_LOCATION_KEY,
      JSON.stringify({
        lat: shared.lat,
        lng: shared.lng,
        timestamp: Date.now(),
        source: shared.source ?? 'gps',
      }),
      'GPS persist lastKnownLocation',
    )
    safeLocalStorageSetItem(GPS_PERMISSION_KEY, 'granted', 'GPS persist permission grant')
    updatePermission('geolocation', 'granted')
    markLastKnownGoodSnapshotTime(lastGpsPersistAt)
  }
  refreshOperationalMapResumeFromLocalStorage()
}

function persistWatchFixIfDue() {
  const now = Date.now()
  if (now - lastGpsPersistAt < WATCH_PERSIST_MIN_MS) return
  persistCurrentFix()
}

async function triggerIPFallback() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible' && !emergencyBypass()) {
    return
  }
  if (ipFallbackInFlight || hasGPSFix || shared.source === 'gps') return
  ipFallbackInFlight = true
  try {
    const res = await fetch('https://ipapi.co/json/')
    const data = await res.json()
    const lat = typeof data?.latitude === 'number' ? data.latitude : null
    const lng = typeof data?.longitude === 'number' ? data.longitude : null
    if (lat == null || lng == null) return
    if (hasGPSFix) return
    setShared({
      ...shared,
      lat,
      lng,
      source: 'ip',
      locationState: shared.locationState === 'idle' ? 'granted' : shared.locationState,
      error: shared.error,
    })
    persistCurrentFix()
    if (gpsTelemetryVerboseEnabled()) {
      console.log('[GPS FALLBACK SUCCESS]', { lat, lng, source: 'ip' })
    }
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[GPS FALLBACK FAILED]', e)
  } finally {
    ipFallbackInFlight = false
  }
}

function flushRequestWaiters() {
  requestInFlight = false
  const w = requestWaiters.splice(0, requestWaiters.length)
  w.forEach((fn) => fn())
}

function emergencyBypass(): boolean {
  if (sosArmed) return true
  const dm = getRuntimeSnapshot().deadMan
  return (
    dm.timerState === 'warning' ||
    dm.timerState === 'critical' ||
    dm.timerState === 'expired' ||
    dm.timerState === 'renew_window'
  )
}

function headingDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  const θ = (Math.atan2(y, x) * 180) / Math.PI
  return (θ + 360) % 360
}

function maybeSyncAdaptiveTransport(): void {
  if (listeners.length > 0 && shared.locationState === 'granted') syncAdaptiveTransport()
}

function stopAdaptivePollAndDr(): void {
  if (adaptivePollTimer != null) {
    window.clearInterval(adaptivePollTimer)
    adaptivePollTimer = null
    activePollIntervalMs = 0
  }
  if (drLoopId != null) {
    window.clearInterval(drLoopId)
    drLoopId = null
  }
}

function stopWatchDeviceOnly(): void {
  if (gpsFallbackTimer != null) {
    window.clearTimeout(gpsFallbackTimer)
    gpsFallbackTimer = null
  }
  if (watchRetryTimer != null) {
    window.clearTimeout(watchRetryTimer)
    watchRetryTimer = null
  }
  if (watchFlushRaf != null) {
    window.cancelAnimationFrame(watchFlushRaf)
    watchFlushRaf = null
  }
  watchPending = null
  if (watcherId != null && navigator.geolocation) {
    try {
      navigator.geolocation.clearWatch(watcherId)
    } catch {
      /* ignore */
    }
    watcherId = null
  }
}

function armAdaptivePoll(ms: number): void {
  if (adaptivePollTimer != null && activePollIntervalMs === ms) return
  if (adaptivePollTimer != null) {
    window.clearInterval(adaptivePollTimer)
    adaptivePollTimer = null
  }
  activePollIntervalMs = ms
  adaptivePollTimer = window.setInterval(() => {
    void pollHardwareFix()
  }, ms)
  void pollHardwareFix()
}

function pollHardwareFix(): void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  if (listeners.length === 0 || shared.locationState !== 'granted') return
  if (watcherId != null) return
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      hasGPSFix = true
      applyHardwarePosition(pos, false)
    },
    (err) => {
      if (import.meta.env.DEV) console.warn('[GPS POLL]', err)
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 22_000 },
  )
}

function ensureDrLoop(): void {
  if (drLoopId != null) return
  drLoopId = window.setInterval(drTick, 950)
}

function drTick(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  if (listeners.length === 0) return
  if (shared.locationState !== 'granted') return
  if (watcherId != null) return
  if (emergencyBypass()) return
  if (currentPowerMode === 'active_navigation') return
  const now = Date.now()
  const ageSec = (now - lastHardwareFixMs) / 1000
  if (lastHardwareFixMs <= 0 || ageSec > GPS_DR_MAX_AGE_SEC) return
  if (drSpeedMsSmoothed < 0.08 || drHeadingDeg == null) return

  const dt = Math.min(GPS_DR_MAX_AGE_SEC, ageSec)
  const h = (drHeadingDeg * Math.PI) / 180
  const v = drSpeedMsSmoothed
  const dNorth = v * dt * Math.cos(h)
  const dEast = v * dt * Math.sin(h)
  const lat0 = lastHardwareLat
  const lng0 = lastHardwareLng
  const latCos = Math.cos((lat0 * Math.PI) / 180)
  const dlat = dNorth / 111_320
  const dlng = dEast / Math.max(1e-6, 111_320 * latCos)
  const nextLat = lat0 + dlat
  const nextLng = lng0 + dlng
  const baseAcc = lastHardwareAcc ?? 22
  const widened = baseAcc + ageSec * GPS_DR_ACCURACY_DRIFT_MPS

  setShared({
    ...shared,
    lat: nextLat,
    lng: nextLng,
    accuracy: widened,
    elevation: lastHardwareElev,
    source: 'gps',
    positionSource: 'interpolated',
    gpsPowerMode: currentPowerMode,
    locationState: 'granted',
    error: undefined,
  })
}

function syncAdaptiveTransport(): void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return
  if (listeners.length === 0) return
  if (shared.locationState !== 'granted') return
  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'hidden' &&
    !emergencyBypass()
  ) {
    stopAdaptivePollAndDr()
    stopWatchDeviceOnly()
    return
  }

  const bypass = emergencyBypass()
  const wantFullWatch = bypass || currentPowerMode === 'active_navigation'

  if (wantFullWatch) {
    stopAdaptivePollAndDr()
    if (watcherId == null) startWatching()
    return
  }

  stopWatchDeviceOnly()
  const interval =
    currentPowerMode === 'stable_tracking' ? GPS_POLL_STABLE_MS : GPS_POLL_STATIONARY_MS
  armAdaptivePoll(interval)
  ensureDrLoop()
}

function applyHardwarePosition(pos: GeolocationPosition, persistImmediate: boolean): void {
  const c = pos.coords
  const now = Date.now()
  const policyDt = Math.min(30_000, Math.max(0, now - lastPolicyTickMs))
  lastPolicyTickMs = now

  const acc = Number.isFinite(c.accuracy) ? c.accuracy : null
  const spdDev = c.speed != null && Number.isFinite(c.speed) ? c.speed : null

  let inferredMs = 0
  if (prevFixLat != null && prevFixLng != null && prevFixTime > 0) {
    const sec = (now - prevFixTime) / 1000
    if (sec > 0.35) {
      inferredMs = haversineMeters(prevFixLat, prevFixLng, c.latitude, c.longitude) / sec
    }
  }

  let hdeg: number | null = null
  if (
    c.heading != null &&
    Number.isFinite(c.heading) &&
    c.heading >= 0 &&
    spdDev != null &&
    spdDev > 0.35
  ) {
    hdeg = c.heading
  } else if (prevFixLat != null && prevFixLng != null) {
    const d = haversineMeters(prevFixLat, prevFixLng, c.latitude, c.longitude)
    if (d > 0.85) hdeg = bearingDeg(prevFixLat, prevFixLng, c.latitude, c.longitude)
  }

  if (hdeg != null && lastHeadingDeg != null && headingDiffDeg(hdeg, lastHeadingDeg) <= 14) {
    stableHeadingStreak += 1
  } else {
    stableHeadingStreak = 0
  }
  if (hdeg != null) lastHeadingDeg = hdeg

  const sp = Math.max(spdDev ?? 0, inferredMs)
  if (sp < 0.18 && (acc ?? 99) <= 35) stationaryAccumMs += policyDt
  else stationaryAccumMs = 0

  prevFixLat = c.latitude
  prevFixLng = c.longitude
  prevFixTime = now

  const bypass = emergencyBypass()
  currentPowerMode = chooseGpsPowerMode({
    accuracyM: acc,
    speedMs: spdDev,
    inferredSpeedMs: inferredMs,
    stableHeadingStreak,
    stationaryAccumulatorMs: stationaryAccumMs,
    emergencyBypass: bypass,
  })

  const spForDr = Math.max(spdDev ?? 0, inferredMs)
  if (spForDr > 0.05) {
    drSpeedMsSmoothed = drSpeedMsSmoothed * 0.35 + spForDr * 0.65
  } else {
    drSpeedMsSmoothed *= 0.82
  }
  if (hdeg != null) drHeadingDeg = hdeg

  lastHardwareFixMs = now
  lastHardwareLat = c.latitude
  lastHardwareLng = c.longitude
  lastHardwareAcc = acc
  lastHardwareElev = altitudeMetersFromCoords(c)

  lastGoodFixAt = now
  staleRecoveryRaised = false
  updateGpsRecoveryState('healthy')

  setShared({
    lat: c.latitude,
    lng: c.longitude,
    accuracy: acc,
    elevation: lastHardwareElev,
    source: 'gps',
    positionSource: 'gps',
    gpsPowerMode: currentPowerMode,
    locationState: 'granted',
    error: undefined,
  })

  if (persistImmediate) persistCurrentFix()
  else persistWatchFixIfDue()

  syncAdaptiveTransport()
}

function flushWatchPending() {
  watchFlushRaf = null
  const pos = watchPending
  watchPending = null
  if (!pos) return
  hasGPSFix = true
  applyHardwarePosition(pos, false)
}

function scheduleWatchFlush() {
  if (watchFlushRaf != null) return
  watchFlushRaf = window.requestAnimationFrame(flushWatchPending)
}

function startWatching() {
  if (watcherId != null || typeof navigator === 'undefined' || !navigator.geolocation) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && !emergencyBypass()) {
    return
  }
  if (watchRetryTimer != null) {
    window.clearTimeout(watchRetryTimer)
    watchRetryTimer = null
  }
  if (gpsFallbackTimer != null) {
    window.clearTimeout(gpsFallbackTimer)
    gpsFallbackTimer = null
  }
  watcherId = navigator.geolocation.watchPosition(
    (pos) => {
      hasGPSFix = true
      if (gpsTelemetryVerboseEnabled()) {
        console.log('[GPS SUCCESS]', {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })
      }
      watchPending = pos
      scheduleWatchFlush()
    },
    (err) => {
      if (import.meta.env.DEV) {
        console.warn('[GPS ERROR]', {
          code: err?.code,
          message: err?.message,
        })
        console.warn('GPS watch error:', err)
      }
      if (err?.code === 1) {
        stopGPS()
        updateGpsRecoveryState('denied')
        updatePermission('geolocation', 'denied')
        safeLocalStorageSetItem(GPS_PERMISSION_KEY, 'denied', 'GPS watch permission denied')
        setShared({
          ...shared,
          locationState: 'denied',
          error: 'Location permission denied',
        })
      } else if (watchRetryTimer == null) {
        updateGpsRecoveryState('recovering')
        watchRetryTimer = window.setTimeout(() => {
          watchRetryTimer = null
          if (watcherId == null) startWatching()
        }, 5000)
      }
    },
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
  )
  if (gpsTelemetryVerboseEnabled()) {
    console.log('[GPS WATCH STARTED]')
  }
  gpsFallbackTimer = window.setTimeout(() => {
    gpsFallbackTimer = null
    if (!hasGPSFix) {
      if (import.meta.env.DEV) console.warn('[GPS FALLBACK] No GPS fix, using IP fallback')
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible' && !emergencyBypass()) {
        return
      }
      void triggerIPFallback()
    }
  }, 4000)
}

function startWatchSafely() {
  hasGPSFix = false
  updateGpsRecoveryState('recovering')
  if (shared.locationState === 'granted') syncAdaptiveTransport()
  else startWatching()
}

/**
 * Explicit user action only — triggers the browser location prompt (e.g. Safari/iOS).
 * Starts passive watch after first successful fix.
 * @returns Resolved `locationState` after this request finishes (latest `shared`).
 */
export function requestLocation(): Promise<LocationState> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    updateGpsRecoveryState('denied')
    updatePermission('geolocation', 'unsupported')
    setShared({
      lat: null,
      lng: null,
      accuracy: null,
      elevation: null,
      locationState: 'error',
      error: 'Geolocation not supported',
    })
    emitHaptic('commandFailure', 'gps.unsupported')
    return Promise.resolve(shared.locationState)
  }

  return new Promise((resolve) => {
    requestWaiters.push(() => resolve(shared.locationState))

    if (requestInFlight) {
      emitHaptic('wakeWord', 'gps.request.queued')
      return
    }
    requestInFlight = true
    hasGPSFix = false

    setShared({
      ...shared,
      locationState: 'requesting',
      error: undefined,
    })
    emitHaptic('wakeWord', 'gps.request.start')
    updateGpsRecoveryState('recovering')
    if (typeof navigator !== 'undefined' && 'permissions' in navigator) {
      void navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((status) => {
          if (import.meta.env.DEV) console.log('[GPS PERMISSION]', status.state)
        })
        .catch(() => {
          if (import.meta.env.DEV) console.log('[GPS PERMISSION]', 'unknown')
        })
    } else {
      if (import.meta.env.DEV) console.log('[GPS PERMISSION]', 'unsupported')
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        hasGPSFix = true
        applyHardwarePosition(pos, true)
        flushRequestWaiters()
      },
      (err) => {
        const denied = err?.code === 1
        if (denied) {
          updateGpsRecoveryState('denied')
          updatePermission('geolocation', 'denied')
          safeLocalStorageSetItem(GPS_PERMISSION_KEY, 'denied', 'GPS request permission denied')
        } else {
          try {
            if (localStorage.getItem(GPS_PERMISSION_KEY) === 'granted') {
              safeLocalStorageRemoveItem(GPS_PERMISSION_KEY, 'GPS clear denied permission fallback')
            }
          } catch {
            /* ignore */
          }
        }
        const code = (err as GeolocationPositionError | undefined)?.code
        const timeout = code === 3
        setShared({
          ...shared,
          locationState: denied ? 'denied' : 'error',
          error: denied
            ? 'Location permission denied'
            : timeout
              ? 'Location timed out — move to open sky or check Settings, then try again'
              : err?.message || 'Location unavailable',
        })
        flushRequestWaiters()
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 0,
      },
    )
  })
}

export function stopGPS() {
  stopAdaptivePollAndDr()
  stopWatchDeviceOnly()
}

function cancelListenerZeroTimer() {
  if (listenerZeroTimer != null) {
    window.clearTimeout(listenerZeroTimer)
    listenerZeroTimer = null
  }
}

function scheduleStopIfNoListeners() {
  cancelListenerZeroTimer()
  listenerZeroTimer = window.setTimeout(() => {
    listenerZeroTimer = null
    if (listeners.length === 0) stopGPS()
  }, LISTENER_ZERO_GRACE_MS)
}

function pauseGpsTransportForBackground(): void {
  if (requestInFlight) return
  if (emergencyBypass()) return
  if (shared.locationState !== 'granted') return
  stopAdaptivePollAndDr()
  stopWatchDeviceOnly()
}

function resumeGpsTransportAfterForeground(): void {
  if (listeners.length === 0) return
  if (shared.locationState !== 'granted') return
  staleRecoveryRaised = false
  lastGoodFixAt = Date.now()
  maybeSyncAdaptiveTransport()
}

function onExternalGeolocationGrant(): void {
  if (requestInFlight) return
  if (shared.locationState === 'denied') return
  let persisted = false
  try {
    persisted = localStorage.getItem(GPS_PERMISSION_KEY) === 'granted'
  } catch {
    return
  }
  if (!persisted) return
  updatePermission('geolocation', 'granted')
  if (shared.locationState === 'idle' || shared.locationState === 'error') {
    setShared({
      ...shared,
      locationState: 'granted',
      error: undefined,
    })
  }
  maybeSyncAdaptiveTransport()
}

function initGpsAdaptiveHooks(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('hud:sos-arm', () => {
    sosArmed = true
    maybeSyncAdaptiveTransport()
  })
  window.addEventListener('hud:sos-disarm', () => {
    sosArmed = false
    maybeSyncAdaptiveTransport()
  })
  window.addEventListener(GEO_EXTERNAL_GRANT_EVENT, onExternalGeolocationGrant)
  subscribeRuntimeSnapshot((snap) => {
    const dm = snap.deadMan.timerState
    if (dm === lastSubscribedDeadManState) return
    lastSubscribedDeadManState = dm
    maybeSyncAdaptiveTransport()
  })
  lastSubscribedDeadManState = getRuntimeSnapshot().deadMan.timerState

  if (typeof document !== 'undefined') {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        pauseGpsTransportForBackground()
      } else {
        resumeGpsTransportAfterForeground()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
  }
  window.addEventListener('online', () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    resumeGpsTransportAfterForeground()
  })
}

initGpsAdaptiveHooks()

export function useGPS(): GPSData & { requestLocation: typeof requestLocation; status: GPSUiStatus } {
  const [state, setState] = useState(shared)

  useEffect(() => {
    const t = window.setInterval(() => {
      if (!shouldRunGpsStaleCheck({ visibilityState: document.visibilityState })) {
        if (import.meta.env.DEV && gpsLoopDebugEnabled()) {
          console.info('[HUD DEV] gps-stale-check-suppressed hidden-page')
        }
        return
      }
      if (shared.locationState !== 'granted') return
      if (Date.now() - lastGoodFixAt > 45_000) {
        if (staleRecoveryRaised) return
        staleRecoveryRaised = true
        updateGpsRecoveryState('stale')
      }
    }, 5000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    cancelListenerZeroTimer()
    listeners.push(setState)

    if (!gpsAutoInitAttempted) {
      gpsAutoInitAttempted = true
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        if (!('permissions' in navigator) || typeof navigator.permissions?.query !== 'function') {
          if (import.meta.env.DEV) console.log('[GPS AUTO START FALLBACK]')
          startWatchSafely()
        } else {
          void navigator.permissions
            .query({ name: 'geolocation' as PermissionName })
            .then((result) => {
              if (import.meta.env.DEV) console.log('[GPS PERMISSION AUTO CHECK]', result.state)
              let persistedGrant = false
              try {
                persistedGrant = localStorage.getItem(GPS_PERMISSION_KEY) === 'granted'
              } catch {
                /* ignore */
              }
              const trustPersistedGrant =
                persistedGrant && (result.state === 'prompt' || result.state === 'granted')
              if (result.state === 'granted' || trustPersistedGrant) {
                if (import.meta.env.DEV) console.log('[GPS AUTO START]')
                startWatchSafely()
              }
            })
            .catch(() => {
              if (import.meta.env.DEV) console.log('[GPS AUTO START FALLBACK]')
              startWatchSafely()
            })
        }
      }
    }

    return () => {
      listeners = listeners.filter((l) => l !== setState)
      if (listeners.length === 0) scheduleStopIfNoListeners()
    }
  }, [])

  return useMemo(
    () => ({ ...state, requestLocation, status: deriveGpsUiStatus(state) }),
    [state],
  )
}
