export type CompassStatus = 'active' | 'level' | 'unavailable'

export function normalizeHeading(value: number): number {
  const n = value % 360
  return n < 0 ? n + 360 : n
}

export function headingToCardinal(heading: number): string {
  const idx = Math.round(heading / 45) % 8
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][idx]
}

/** Shortest signed delta between two headings in degrees. */
export function headingDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}

/** Exponential smoothing on a circle. */
export function smoothHeading(prev: number, next: number, factor: number): number {
  const delta = headingDelta(prev, next)
  return normalizeHeading(prev + delta * factor)
}

/**
 * Compass readouts degrade when the device is too flat or rolled on edge.
 * beta/gamma are null on some browsers until permission is granted.
 */
export function isCompassTiltUnreliable(beta: number | null, gamma: number | null): boolean {
  if (beta == null || gamma == null || !Number.isFinite(beta) || !Number.isFinite(gamma)) {
    return false
  }
  const absBeta = Math.abs(beta)
  const absGamma = Math.abs(gamma)
  // Screen parallel to ground — alpha spins and magnetometer geometry is poor.
  if (absBeta < 25) return true
  // Rolled hard to either side.
  if (absGamma > 68) return true
  // Upside-down flat.
  if (absBeta > 155) return true
  return false
}

export function shouldPublishHeading(
  last: number | null,
  next: number,
  nowMs: number,
  lastPublishMs: number,
  minDeltaDeg = 6,
  minIntervalMs = 320,
): boolean {
  if (last == null) return true
  const elapsed = nowMs - lastPublishMs
  if (elapsed < minIntervalMs) return false
  return Math.abs(headingDelta(last, next)) >= minDeltaDeg
}

export function resolveOrientationHeading(event: DeviceOrientationEvent): number | null {
  const webkitHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
    .webkitCompassHeading
  if (typeof webkitHeading === 'number' && Number.isFinite(webkitHeading)) {
    return normalizeHeading(webkitHeading)
  }
  if (typeof event.alpha === 'number' && Number.isFinite(event.alpha)) {
    return normalizeHeading(360 - event.alpha)
  }
  return null
}
