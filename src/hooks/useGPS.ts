import { useEffect, useState } from 'react'

type GPSData = {
  lat: number | null
  lng: number | null
  accuracy: number | null
}

// 🔒 shared state
let shared: GPSData = {
  lat: null,
  lng: null,
  accuracy: null,
}

let listeners: ((g: GPSData) => void)[] = []
let watcherId: number | null = null

function emit() {
  listeners.forEach((l) => l(shared))
}

function startGPS() {
  if (watcherId !== null) return
  if (!navigator.geolocation) return

  watcherId = navigator.geolocation.watchPosition(
    (pos) => {
      shared = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }
      emit()
    },
    (err) => {
      console.warn('GPS error:', err)
    },
    {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 10000,
    }
  )
}

export function stopGPS() {
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