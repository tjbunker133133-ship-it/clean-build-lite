import { haversineMeters } from './haversine'

export type TravelSpeedSample = {
  speedMps: number
  mph: number
  kph: number
}

const MPS_TO_MPH = 2.23694
const MPS_TO_KPH = 3.6
const STOPPED_MPS = 0.4
const MIN_DT_SEC = 0.35
const MAX_DT_SEC = 25
const MAX_IMPLIED_MPS = 55

export function computeTravelSpeedMps(
  prev: { lat: number; lng: number; atMs: number } | null,
  lat: number,
  lng: number,
  atMs: number,
): number | null {
  if (!prev) return null
  const dtSec = (atMs - prev.atMs) / 1000
  if (dtSec < MIN_DT_SEC || dtSec > MAX_DT_SEC) return null
  const distM = haversineMeters(prev.lat, prev.lng, lat, lng)
  const mps = distM / dtSec
  if (!Number.isFinite(mps) || mps > MAX_IMPLIED_MPS) return null
  return mps
}

export function smoothSpeedMps(prev: number | null, next: number, factor = 0.35): number {
  if (prev == null) return next
  return prev + (next - prev) * factor
}

export function formatTravelSpeed(mps: number | null): {
  primary: string
  secondary: string
  moving: boolean
} {
  if (mps == null || mps < STOPPED_MPS) {
    return { primary: 'STOP', secondary: '0 mph', moving: false }
  }
  const mph = mps * MPS_TO_MPH
  const kph = mps * MPS_TO_KPH
  const mphRounded = mph < 10 ? mph.toFixed(1) : String(Math.round(mph))
  return {
    primary: `${mphRounded} mph`,
    secondary: `${Math.round(kph)} km/h`,
    moving: true,
  }
}
