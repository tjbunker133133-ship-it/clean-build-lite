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
  minDeltaDeg = 8,
  minIntervalMs = 420,
): boolean {
  if (last == null) return true
  const elapsed = nowMs - lastPublishMs
  if (elapsed < minIntervalMs) return false
  return Math.abs(headingDelta(last, next)) >= minDeltaDeg
}

/** Display step — reduces flicker on magnetometer noise (field phones). */
export function quantizeHeading(deg: number, step = 3): number {
  if (!Number.isFinite(deg)) return 0
  return normalizeHeading(Math.round(deg / step) * step)
}

/** iOS 13+ requires a user gesture before compass events fire. */
/** Screen rotation offset for alpha-based compass (portrait = 0). */
export function getScreenOrientationAngle(): number {
  if (typeof screen !== 'undefined' && screen.orientation?.angle != null) {
    return screen.orientation.angle
  }
  const legacy = (typeof window !== 'undefined'
    ? (window as Window & { orientation?: number }).orientation
    : undefined) as number | undefined
  if (typeof legacy === 'number' && Number.isFinite(legacy)) return legacy
  return 0
}

export async function requestDeviceOrientationPermission(): Promise<
  'granted' | 'denied' | 'unsupported'
> {
  if (typeof window === 'undefined') return 'unsupported'
  const ctor = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<'granted' | 'denied'>
  }
  if (typeof ctor.requestPermission !== 'function') return 'unsupported'
  try {
    const result = await ctor.requestPermission()
    return result === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}

/**
 * Map DeviceOrientation to compass heading (0° = north, clockwise).
 *
 * - iOS: `webkitCompassHeading` (degrees clockwise from north).
 * - `deviceorientationabsolute`: W3C — alpha 0° = top of device toward north.
 * - Legacy relative `deviceorientation`: use inverted alpha (older Android).
 */
export function resolveOrientationHeading(event: DeviceOrientationEvent): number | null {
  const webkitHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
    .webkitCompassHeading
  if (typeof webkitHeading === 'number' && Number.isFinite(webkitHeading)) {
    return normalizeHeading(webkitHeading)
  }
  if (typeof event.alpha !== 'number' || !Number.isFinite(event.alpha)) {
    return null
  }

  const orient = getScreenOrientationAngle()

  /**
   * Compass heading from alpha (W3C / MDN): 0° = north, clockwise.
   * Same inversion for relative and Android `absolute` — using `alpha` directly
   * misreads ~90° on many Android Chrome builds.
   */
  return normalizeHeading(360 - event.alpha + orient)
}
