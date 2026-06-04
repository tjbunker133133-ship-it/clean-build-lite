import { useEffect, useRef, useState } from 'react'
import {
  computeTravelSpeedMps,
  formatTravelSpeed,
  smoothSpeedMps,
  type TravelSpeedSample,
} from '../lib/travelSpeed'

/**
 * Tier 2 travel speed from successive GPS fixes (does not modify Tier 1 useGPS).
 */
export function useTravelSpeed(lat: number | null, lng: number | null, gpsLocked: boolean) {
  const [sample, setSample] = useState<TravelSpeedSample | null>(null)
  const prevRef = useRef<{ lat: number; lng: number; atMs: number } | null>(null)
  const smoothRef = useRef<number | null>(null)

  useEffect(() => {
    if (!gpsLocked || lat == null || lng == null) {
      prevRef.current = null
      smoothRef.current = null
      setSample(null)
      return
    }
    const atMs = Date.now()
    const raw = computeTravelSpeedMps(prevRef.current, lat, lng, atMs)
    prevRef.current = { lat, lng, atMs }
    if (raw == null) return
    smoothRef.current = smoothSpeedMps(smoothRef.current, raw)
    const mps = smoothRef.current
    setSample({
      speedMps: mps,
      mph: mps * 2.23694,
      kph: mps * 3.6,
    })
  }, [lat, lng, gpsLocked])

  const display = formatTravelSpeed(sample?.speedMps ?? null)
  return { sample, display }
}
