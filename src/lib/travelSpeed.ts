import { haversineMeters } from './haversine'

export type TravelSpeedSample = {
  speedMps: number
  mph: number
  kph: number
}

const MPS_TO_MPH = 2.23694
const MPS_TO_KPH = 3.6
/** ~3 mph — hide GPS wander while standing (field phones often report 2–5 mph). */
export const STOPPED_MPS = 1.34
const MIN_DT_SEC = 0.5
const MAX_DT_SEC = 25
const MAX_IMPLIED_MPS = 55
const MIN_DISPLACEMENT_M = 4

export type TravelSpeedSampleInput = {
  prev: { lat: number; lng: number; atMs: number } | null
  lat: number
  lng: number
  atMs: number
  /** When set, ignore jitter moves smaller than a fraction of reported accuracy. */
  accuracyM?: number | null
}

export function computeTravelSpeedMps(input: TravelSpeedSampleInput): number | null {
  const { prev, lat, lng, atMs, accuracyM } = input
  if (!prev) return null
  const dtSec = (atMs - prev.atMs) / 1000
  if (dtSec < MIN_DT_SEC || dtSec > MAX_DT_SEC) return null
  const distM = haversineMeters(prev.lat, prev.lng, lat, lng)
  const minMoveM =
    accuracyM != null && Number.isFinite(accuracyM) && accuracyM > 0
      ? Math.max(MIN_DISPLACEMENT_M, accuracyM * 1.15)
      : MIN_DISPLACEMENT_M
  if (distM < minMoveM) return null
  const mps = distM / dtSec
  if (!Number.isFinite(mps) || mps > MAX_IMPLIED_MPS) return null
  return mps
}

export function smoothSpeedMps(prev: number | null, next: number, factor = 0.35): number {
  if (prev == null) return next
  const f = next < prev ? Math.min(factor, 0.22) : factor
  return prev + (next - prev) * f
}

/** Pull smoothed speed down when fixes stop implying movement (GPS wander). */
export function decaySpeedMps(prev: number | null, factor = 0.18): number | null {
  if (prev == null) return null
  const next = prev * factor
  return next < STOPPED_MPS ? null : next
}

/** Minimum meters between fixes before speed math runs (blocks standing GPS jitter). */
export function minMovementGateM(accuracyM?: number | null): number {
  if (accuracyM != null && Number.isFinite(accuracyM) && accuracyM > 0) {
    return Math.max(MIN_DISPLACEMENT_M, accuracyM * 1.15)
  }
  return MIN_DISPLACEMENT_M
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
