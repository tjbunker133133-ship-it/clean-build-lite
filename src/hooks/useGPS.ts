import { useEffect, useMemo, useState } from 'react'

// ⚠️ LOCKED SYSTEM — Behavior Freeze Active
// Any change to interaction, layout, display modes, or layers requires explicit approval.

/** User-driven geolocation lifecycle (no silent / on-load requests). */
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

export type GPSData = {
  lat: number | null
  lng: number | null
  accuracy: number | null
  /** Meters above ellipsoid from `GeolocationCoordinates.altitude` when the device reports it. */
  elevation: number | null
  locationState: LocationState
  source?: 'gps' | 'ip' | 'cached'
  error?: string
}

const LAST_GPS_FIX_KEY = 'hud_last_gps_fix_v1'
const LAST_KNOWN_LOCATION_KEY = 'lastKnownLocation'
const GPS_PERMISSION_KEY = 'gpsPermission'

function altitudeMetersFromCoords(coords: GeolocationCoordinates): number | null {
  const a = coords.altitude
  if (a == null || Number.isNaN(a)) return null
  return a
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
        locationState: 'idle',
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
      locationState: lat != null && lng != null && perm === 'granted' ? 'granted' : 'idle',
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
/** Throttle localStorage writes from high-frequency watch updates (first fix still persists immediately). */
let lastGpsPersistAt = 0
const WATCH_PERSIST_MIN_MS = 12_000
function gpsLoopDebugEnabled(): boolean {
  return (
    typeof window !== 'undefined' &&
    (
      (window as Window & { __HUD_LOOP_DEBUG__?: number }).__HUD_LOOP_DEBUG__ === 1 ||
      (window as Window & { HUD_LOOP_DEBUG?: number }).HUD_LOOP_DEBUG === 1
    )
  )
}

function tier1GpsLog(next: GPSData): void {
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
    (a.error ?? '') === (b.error ?? '')
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
  console.log('[GPS STATE UPDATE]', { lat: next.lat, lng: next.lng, source: next.source })
  shared = next
  tier1GpsLog(next)
  emit()
}

function persistCurrentFix() {
  lastGpsPersistAt = Date.now()
  try {
    localStorage.setItem(LAST_GPS_FIX_KEY, JSON.stringify(shared))
  } catch {
    /* ignore */
  }
  try {
    if (shared.lat != null && shared.lng != null) {
      localStorage.setItem(
        LAST_KNOWN_LOCATION_KEY,
        JSON.stringify({
          lat: shared.lat,
          lng: shared.lng,
          timestamp: Date.now(),
          source: shared.source ?? 'gps',
        }),
      )
      localStorage.setItem(GPS_PERMISSION_KEY, 'granted')
    }
  } catch {
    /* ignore */
  }
}

function persistWatchFixIfDue() {
  const now = Date.now()
  if (now - lastGpsPersistAt < WATCH_PERSIST_MIN_MS) return
  persistCurrentFix()
}

async function triggerIPFallback() {
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
    console.log('[GPS FALLBACK SUCCESS]', { lat, lng, source: 'ip' })
  } catch (e) {
    console.warn('[GPS FALLBACK FAILED]', e)
  } finally {
    ipFallbackInFlight = false
  }
}

function flushRequestWaiters() {
  requestInFlight = false
  const w = requestWaiters.splice(0, requestWaiters.length)
  w.forEach((fn) => fn())
}

function flushWatchPending() {
  watchFlushRaf = null
  const pos = watchPending
  watchPending = null
  if (!pos) return
  setShared({
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    elevation: altitudeMetersFromCoords(pos.coords),
    source: 'gps',
    locationState: 'granted',
    error: undefined,
  })
  persistWatchFixIfDue()
}

function scheduleWatchFlush() {
  if (watchFlushRaf != null) return
  watchFlushRaf = window.requestAnimationFrame(flushWatchPending)
}

function startWatching() {
  if (watcherId != null || typeof navigator === 'undefined' || !navigator.geolocation) return
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
      console.log('[GPS SUCCESS]', {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      })
      watchPending = pos
      scheduleWatchFlush()
    },
    (err) => {
      console.warn('[GPS ERROR]', {
        code: err?.code,
        message: err?.message,
      })
      console.warn('GPS watch error:', err)
      if (err?.code === 1) {
        stopWatching()
        try {
          localStorage.setItem(GPS_PERMISSION_KEY, 'denied')
        } catch {
          /* ignore */
        }
        setShared({
          ...shared,
          locationState: 'denied',
          error: 'Location permission denied',
        })
      } else if (watchRetryTimer == null) {
        watchRetryTimer = window.setTimeout(() => {
          watchRetryTimer = null
          if (watcherId == null) startWatching()
        }, 5000)
      }
    },
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
  )
  console.log('[GPS WATCH STARTED]')
  gpsFallbackTimer = window.setTimeout(() => {
    gpsFallbackTimer = null
    if (!hasGPSFix) {
      console.warn('[GPS FALLBACK] No GPS fix, using IP fallback')
      void triggerIPFallback()
    }
  }, 4000)
}

function startWatchSafely() {
  if (watcherId != null) return
  hasGPSFix = false
  startWatching()
}

function stopWatching() {
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

/**
 * Explicit user action only — triggers the browser location prompt (e.g. Safari/iOS).
 * Starts passive watch after first successful fix.
 * @returns Resolved `locationState` after this request finishes (latest `shared`).
 */
export function requestLocation(): Promise<LocationState> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    setShared({
      lat: null,
      lng: null,
      accuracy: null,
      elevation: null,
      locationState: 'error',
      error: 'Geolocation not supported',
    })
    return Promise.resolve(shared.locationState)
  }

  return new Promise((resolve) => {
    requestWaiters.push(() => resolve(shared.locationState))

    if (requestInFlight) return
    requestInFlight = true
    hasGPSFix = false

    setShared({
      ...shared,
      locationState: 'requesting',
      error: undefined,
    })
    if (typeof navigator !== 'undefined' && 'permissions' in navigator) {
      void navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((status) => {
          console.log('[GPS PERMISSION]', status.state)
        })
        .catch(() => {
          console.log('[GPS PERMISSION]', 'unknown')
        })
    } else {
      console.log('[GPS PERMISSION]', 'unsupported')
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        hasGPSFix = true
        setShared({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          elevation: altitudeMetersFromCoords(pos.coords),
          source: 'gps',
          locationState: 'granted',
          error: undefined,
        })
        persistCurrentFix()
        startWatching()
        flushRequestWaiters()
      },
      (err) => {
        const denied = err?.code === 1
        if (denied) {
          try {
            localStorage.setItem(GPS_PERMISSION_KEY, 'denied')
          } catch {
            /* ignore */
          }
        }
        setShared({
          ...shared,
          locationState: denied ? 'denied' : 'error',
          error: denied
            ? 'Location permission denied'
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
  stopWatching()
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

export function useGPS(): GPSData & { requestLocation: typeof requestLocation; status: GPSUiStatus } {
  const [state, setState] = useState(shared)

  useEffect(() => {
    if (gpsAutoInitAttempted) return
    gpsAutoInitAttempted = true
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    if (!('permissions' in navigator) || typeof navigator.permissions?.query !== 'function') {
      console.log('[GPS AUTO START FALLBACK]')
      startWatchSafely()
      return
    }
    void navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((result) => {
        console.log('[GPS PERMISSION AUTO CHECK]', result.state)
        if (result.state === 'granted') {
          console.log('[GPS AUTO START]')
          startWatchSafely()
        }
      })
      .catch(() => {
        console.log('[GPS AUTO START FALLBACK]')
        startWatchSafely()
      })
  }, [])

  useEffect(() => {
    cancelListenerZeroTimer()
    listeners.push(setState)
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
