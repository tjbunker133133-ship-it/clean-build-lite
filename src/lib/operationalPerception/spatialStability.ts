import type { PerceptualMovementBand, SmoothedPosition } from './types'

const POSITION_ALPHA = 0.32
const HEADING_ALPHA = 0.22

/** Spec thresholds in km/h — perceptual only, never mutates raw GPS. */
export function perceptualMovementBand(speedMs: number): PerceptualMovementBand {
  const kmh = speedMs * 3.6
  if (kmh < 0.8) return 'stationary'
  if (kmh <= 5) return 'walking'
  return 'dynamic'
}

function shortestHeadingDelta(from: number, to: number): number {
  let d = to - from
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}

export function smoothHeading(prev: number, next: number, alpha = HEADING_ALPHA): number {
  const delta = shortestHeadingDelta(prev, next)
  return ((prev + delta * alpha) + 360) % 360
}

export function smoothPosition(
  prev: SmoothedPosition | null,
  raw: { lat: number; lng: number; headingDeg?: number; speedMs?: number },
): SmoothedPosition {
  const speedMs = raw.speedMs ?? prev?.speedMs ?? 0
  const headingDeg = raw.headingDeg ?? prev?.headingDeg ?? 0

  if (!prev) {
    return {
      lat: raw.lat,
      lng: raw.lng,
      headingDeg,
      speedMs,
      band: perceptualMovementBand(speedMs),
    }
  }

  return {
    lat: POSITION_ALPHA * raw.lat + (1 - POSITION_ALPHA) * prev.lat,
    lng: POSITION_ALPHA * raw.lng + (1 - POSITION_ALPHA) * prev.lng,
    headingDeg: smoothHeading(prev.headingDeg, headingDeg),
    speedMs,
    band: perceptualMovementBand(speedMs),
  }
}
