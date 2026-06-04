import type { RawGpsPoint } from './types'

export type GpsRejectReason =
  | 'accuracy_poor'
  | 'stale_timestamp'
  | 'impossible_speed'
  | 'heading_unstable'
  | 'excessive_jump'
  | 'duplicate_point'
  | 'below_movement_threshold'
  | 'provider_degraded'

export type GpsQualityGateConfig = {
  /** Reject when accuracy exceeds this (meters). */
  maxAccuracyM: number
  /** Reject when fix age exceeds this (ms). */
  maxAgeMs: number
  /** Ignore snaps when movement since last accepted raw is below this (m). */
  minMoveM: number
  /** Reject implied speed above this (m/s). */
  maxSpeedMps: number
  /** Reject single-step jump above this (m). */
  maxJumpM: number
  /** Treat as duplicate when within this distance (m). */
  duplicateEpsilonM: number
  /** Heading delta (deg) above which fix is unstable. */
  maxHeadingDeltaDeg: number
}

export const DEFAULT_GPS_QUALITY_GATE: GpsQualityGateConfig = {
  maxAccuracyM: 30,
  maxAgeMs: 15_000,
  minMoveM: 2,
  maxSpeedMps: 55,
  maxJumpM: 80,
  duplicateEpsilonM: 0.75,
  maxHeadingDeltaDeg: 95,
}

export type GpsQualityVerdict =
  | { accept: true; reasons: [] }
  | { accept: false; defer: boolean; reasons: GpsRejectReason[] }

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const la1 = toRad(lat1)
  const la2 = toRad(lat2)
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function headingDeltaDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

export type GpsQualityGateState = {
  lastAccepted: RawGpsPoint | null
}

export function createGpsQualityGateState(): GpsQualityGateState {
  return { lastAccepted: null }
}

/**
 * Pre-snap GPS validation. Logs reasons explicitly; never mutates the input point.
 */
export function evaluateGpsQuality(
  point: RawGpsPoint,
  state: GpsQualityGateState,
  config: GpsQualityGateConfig = DEFAULT_GPS_QUALITY_GATE,
  nowMs: number = Date.now(),
): GpsQualityVerdict {
  const reasons: GpsRejectReason[] = []

  if (point.source === 'ip' || point.source === 'cached') {
    reasons.push('provider_degraded')
  }

  if (point.accuracy != null && point.accuracy > config.maxAccuracyM) {
    reasons.push('accuracy_poor')
  }

  const ageMs = nowMs - point.timestampMs
  if (!Number.isFinite(ageMs) || ageMs > config.maxAgeMs) {
    reasons.push('stale_timestamp')
  }

  const prev = state.lastAccepted
  if (prev) {
    const distM = haversineMeters(prev.lat, prev.lng, point.lat, point.lng)
    const dtSec = Math.max(0.001, (point.timestampMs - prev.timestampMs) / 1000)
    const impliedSpeed = distM / dtSec

    if (distM < config.duplicateEpsilonM) {
      reasons.push('duplicate_point')
    } else if (distM < config.minMoveM) {
      reasons.push('below_movement_threshold')
    }

    if (distM > config.maxJumpM) {
      reasons.push('excessive_jump')
    }

    if (impliedSpeed > config.maxSpeedMps) {
      reasons.push('impossible_speed')
    }

    if (
      point.heading != null &&
      prev.heading != null &&
      Number.isFinite(point.heading) &&
      Number.isFinite(prev.heading) &&
      headingDeltaDeg(point.heading, prev.heading) > config.maxHeadingDeltaDeg &&
      distM > config.minMoveM
    ) {
      reasons.push('heading_unstable')
    }
  }

  if (reasons.length === 0) {
    state.lastAccepted = point
    return { accept: true, reasons: [] }
  }

  const defer =
    reasons.includes('accuracy_poor') ||
    reasons.includes('heading_unstable') ||
    reasons.includes('provider_degraded')

  return { accept: false, defer, reasons }
}
