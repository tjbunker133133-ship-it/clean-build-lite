import { useEffect, useState } from 'react'

type GPSData = {
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

function emit() {
  listeners.forEach((l) => l(shared))
}

function clearStartupTimeout() {
  if (startupTimeoutId != null) {
    window.clearTimeout(startupTimeoutId)
    startupTimeoutId = null
  }
}

function loadCachedFix(): GPSData | null {
  try {
    const raw = localStorage.getItem('hud_last_gps_fix_v1')
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

function startGPS() {
  if (watcherId !== null) return
  if (!navigator.geolocation) {
    shared = { ...shared, status: 'unsupported', error: 'Geolocation not supported' }
    emit()
    return
  }
  const cached = loadCachedFix()
  if (cached) {
    shared = { ...cached, status: 'searching', error: undefined }
    emit()
  }
  shared = { ...shared, status: 'searching', error: undefined }
  emit()
  clearStartupTimeout()
  startupTimeoutId = window.setTimeout(() => {
    if (shared.status === 'searching') {
      shared = {
        ...shared,
        status: 'error',
        error: 'GPS timeout: check permissions or signal',
      }
      emit()
    }
  }, 12000)

  // Prime quickly on platforms where watchPosition callbacks are delayed.
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      shared = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        status: 'locked',
      }
      clearStartupTimeout()
      try {
        localStorage.setItem('hud_last_gps_fix_v1', JSON.stringify(shared))
      } catch {}
      emit()
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 8000 },
  )

  watcherId = navigator.geolocation.watchPosition(
    (pos) => {
      shared = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        status: 'locked',
      }
      clearStartupTimeout()
      try {
        localStorage.setItem('hud_last_gps_fix_v1', JSON.stringify(shared))
      } catch {}
      emit()
    },
    (err) => {
      console.warn('GPS error:', err)
      clearStartupTimeout()
      const denied = err?.code === 1
      if (shared.lat == null || shared.lng == null) {
        try {
          const raw = localStorage.getItem('hud_last_gps_fix_v1')
          if (raw) {
            const cached = JSON.parse(raw) as GPSData
            if (typeof cached?.lat === 'number' && typeof cached?.lng === 'number') {
              shared = {
                lat: cached.lat,
                lng: cached.lng,
                accuracy: cached.accuracy ?? null,
                status: denied ? 'denied' : 'error',
                error: denied ? 'Location permission denied' : 'GPS unavailable',
              }
              emit()
              return
            }
          }
        } catch {}
      }
      shared = {
        ...shared,
        status: denied ? 'denied' : 'error',
        error: denied ? 'Location permission denied' : 'GPS unavailable',
      }
      emit()
    },
    {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 10000,
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