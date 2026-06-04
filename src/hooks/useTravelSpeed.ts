import { useEffect, useRef, useState } from 'react'
import { haversineMeters } from '../lib/haversine'
import {
  computeTravelSpeedMps,
  decaySpeedMps,
  formatTravelSpeed,
  minMovementGateM,
  smoothSpeedMps,
  type TravelSpeedSample,
} from '../lib/travelSpeed'

/**
 * Tier 2 travel speed from successive GPS fixes (does not modify Tier 1 useGPS).
 */
export function useTravelSpeed(
  lat: number | null,
  lng: number | null,
  gpsLocked: boolean,
  accuracyM: number | null = null,
) {
  const [sample, setSample] = useState<TravelSpeedSample | null>(null)
  const prevRef = useRef<{ lat: number; lng: number; atMs: number } | null>(null)
  const smoothRef = useRef<number | null>(null)
  const jitterStreakRef = useRef(0)

  useEffect(() => {
    if (!gpsLocked || lat == null || lng == null) {
      prevRef.current = null
      smoothRef.current = null
      jitterStreakRef.current = 0
      setSample(null)
      return
    }

    const atMs = Date.now()
    const gateM = minMovementGateM(accuracyM)
    const prev = prevRef.current

    if (prev) {
      const distM = haversineMeters(prev.lat, prev.lng, lat, lng)
      if (distM < gateM) {
        jitterStreakRef.current += 1
        if (jitterStreakRef.current >= 2) {
          smoothRef.current = decaySpeedMps(smoothRef.current)
        }
        const mps = smoothRef.current
        if (mps == null) {
          setSample(null)
          return
        }
        setSample({
          speedMps: mps,
          mph: mps * 2.23694,
          kph: mps * 3.6,
        })
        return
      }
    }

    jitterStreakRef.current = 0
    const raw = computeTravelSpeedMps({
      prev,
      lat,
      lng,
      atMs,
      accuracyM,
    })

    if (raw != null) {
      prevRef.current = { lat, lng, atMs }
      smoothRef.current = smoothSpeedMps(smoothRef.current, raw)
      const mps = smoothRef.current
      setSample({
        speedMps: mps,
        mph: mps * 2.23694,
        kph: mps * 3.6,
      })
      return
    }

    prevRef.current = { lat, lng, atMs }
    smoothRef.current = decaySpeedMps(smoothRef.current)
    const mps = smoothRef.current
    if (mps == null) {
      setSample(null)
      return
    }
    setSample({
      speedMps: mps,
      mph: mps * 2.23694,
      kph: mps * 3.6,
    })
  }, [lat, lng, gpsLocked, accuracyM])

  const display = formatTravelSpeed(sample?.speedMps ?? null)
  return { sample, display }
}
