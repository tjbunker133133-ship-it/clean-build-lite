import type { RawGpsPoint, SnappedTrackPoint } from './types'

export type SnapRejectReason =
  | 'snap_distance_exceeded'
  | 'confidence_low'
  | 'heading_mismatch'
  | 'impossible_geometry'
  | 'provider_empty'

export type SnapValidationConfig = {
  maxSnapDistanceM: number
  minConfidence: number
  maxHeadingMismatchDeg: number
}

export const DEFAULT_SNAP_VALIDATION: SnapValidationConfig = {
  maxSnapDistanceM: 30,
  minConfidence: 0.35,
  maxHeadingMismatchDeg: 110,
}

function headingDeltaDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

export type SnapValidationVerdict =
  | { accept: true; snapped: SnappedTrackPoint }
  | { accept: false; reasons: SnapRejectReason[] }

export function validateSnapResult(
  raw: RawGpsPoint,
  candidate: SnappedTrackPoint | null,
  config: SnapValidationConfig = DEFAULT_SNAP_VALIDATION,
): SnapValidationVerdict {
  if (!candidate) {
    return { accept: false, reasons: ['provider_empty'] }
  }

  const reasons: SnapRejectReason[] = []

  if (candidate.snapDistanceMeters > config.maxSnapDistanceM) {
    reasons.push('snap_distance_exceeded')
  }

  if (candidate.confidenceScore < config.minConfidence) {
    reasons.push('confidence_low')
  }

  if (!Number.isFinite(candidate.snappedLat) || !Number.isFinite(candidate.snappedLng)) {
    reasons.push('impossible_geometry')
  }

  if (
    raw.heading != null &&
    Number.isFinite(raw.heading) &&
    candidate.snapDistanceMeters > 3
  ) {
    const snapBearing = bearingDeg(raw.lat, raw.lng, candidate.snappedLat, candidate.snappedLng)
    if (headingDeltaDeg(raw.heading, snapBearing) > config.maxHeadingMismatchDeg) {
      reasons.push('heading_mismatch')
    }
  }

  if (reasons.length > 0) {
    return { accept: false, reasons }
  }

  return { accept: true, snapped: candidate }
}
