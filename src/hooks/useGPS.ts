import { useEffect, useState } from 'react'

export type GPSData = {
  lat: number | null
  lng: number | null
  accuracy: number | null
  status: 'idle' | 'searching' | 'locked' | 'denied' | 'unsupported' | 'error'
  error?: string
}

// 🔒 shared state
let shared: GPSData = {
  lat: null,
  lng: null,
  accuracy: null,
  status: 'idle',
}

let listeners: ((g: GPSData) => void)[] = []
let watcherId: number | null = null
let startupTimeoutId: number | null = null

const LAST_GPS_FIX_KEY = 'hud_last_gps_fix_v1'
const LAST_MAP_CENTER_KEY = 'hud_last_map_center_v1'

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
    a.status === b.status &&
    (a.error ?? '') === (b.error ?? '')
  )
}

function emit() {
  listeners.forEach((l) => l(shared))
}

function setShared(next: GPSData) {
  if (sameGPS(shared, next)) return
  shared = next
  emit()
}

function clearStartupTimeout() {
  if (startupTimeoutId != null) {
    window.clearTimeout(startupTimeoutId)
    startupTimeoutId = null
  }
}

function loadCachedFix(): GPSData | null {
  try {
    const raw = localStorage.getItem(LAST_GPS_FIX_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw) as GPSData
    if (typeof cached?.lat !== 'number' || typeof cached?.lng !== 'number') return null
    return {
      lat: cached.lat,
      lng: cached.lng,
      accuracy: cached.accuracy ?? null,
      status: 'locked',
    }
  } catch {
    return null
  }
}

function loadMapCenterFallback(): GPSData | null {
  try {
    const raw = localStorage.getItem(LAST_MAP_CENTER_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw) as { lat?: number; lng?: number }
    if (typeof cached?.lat !== 'number' || typeof cached?.lng !== 'number') return null
    return {
      lat: cached.lat,
      lng: cached.lng,
      accuracy: null,
      status: 'searching',
    }
  } catch {
    return null
  }
}

function persistCurrentFix() {
  try {
    localStorage.setItem(LAST_GPS_FIX_KEY, JSON.stringify(shared))
  } catch {}
}

function setFallbackFix(status: GPSData['status'], error: string) {
  const gps = loadCachedFix()
  if (gps) {
    setShared({ ...gps, status, error })
    return
  }
  const mapCenter = loadMapCenterFallback()
  if (mapCenter) {
    setShared({ ...mapCenter, status, error })
    return
  }
  setShared({ ...shared, status, error })
}

function startGPS() {
  if (watcherId !== null) return
  if (!navigator.geolocation) {
    setShared({ ...shared, status: 'unsupported', error: 'Geolocation not supported' })
    return
  }
  const cached = loadCachedFix()
  if (cached) {
    setShared({ ...cached, status: 'searching', error: undefined })
  } else {
    const mapCenter = loadMapCenterFallback()
    if (mapCenter) {
      setShared({ ...mapCenter, status: 'searching', error: undefined })
    }
  }
  setShared({ ...shared, status: 'searching', error: undefined })
  clearStartupTimeout()
  startupTimeoutId = window.setTimeout(() => {
    if (shared.status === 'searching') {
      setFallbackFix('error', 'GPS timeout: using last known location')
    }
  }, 12000)

  // Prime quickly on platforms where watchPosition callbacks are delayed.
  const isAppleWebKit =
    typeof navigator !== 'undefined' &&
    /AppleWebKit/i.test(navigator.userAgent || '') &&
    /iPhone|iPad|iPod|Macintosh/i.test(navigator.userAgent || '')
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setShared({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        status: 'locked',
      })
      clearStartupTimeout()
      persistCurrentFix()
    },
    (err) => {
      if (err?.code === 1) setFallbackFix('denied', 'Location permission denied')
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: isAppleWebKit ? 10000 : 8000 },
  )

  watcherId = navigator.geolocation.watchPosition(
    (pos) => {
      setShared({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        status: 'locked',
      })
      clearStartupTimeout()
      persistCurrentFix()
    },
    (err) => {
      console.warn('GPS error:', err)
      clearStartupTimeout()
      const denied = err?.code === 1
      setFallbackFix(denied ? 'denied' : 'error', denied ? 'Location permission denied' : 'GPS unavailable')
    },
    {
      enableHighAccuracy: true,
      maximumAge: isAppleWebKit ? 8000 : 3000,
      timeout: isAppleWebKit ? 15000 : 10000,
    }
  )
}

export function stopGPS() {
  clearStartupTimeout()
  if (watcherId !== null) {
    navigator.geolocation.clearWatch(watcherId)
    watcherId = null
  }
}

export function useGPS(): GPSData {
  const [state, setState] = useState(shared)

  useEffect(() => {
    listeners.push(setState)
    startGPS()

    return () => {
      listeners = listeners.filter((l) => l !== setState)
      // Only stop if no listeners left
      if (listeners.length === 0) {
        stopGPS()
      }
    }
  }, [])

  return state
}