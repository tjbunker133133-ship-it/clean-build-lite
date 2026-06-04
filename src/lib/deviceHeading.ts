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
 * True when the device is rolled hard on edge — heading may jitter; still published.
 * Flat (screen-up) orientations are handled via tilt-compensated fusion instead of blocking.
 */
export function isCompassTiltUnreliable(beta: number | null, gamma: number | null): boolean {
  if (beta == null || gamma == null || !Number.isFinite(beta) || !Number.isFinite(gamma)) {
    return false
  }
  const absGamma = Math.abs(gamma)
  // Rolled hard to either side.
  if (absGamma > 68) return true
  // Upside-down flat.
  if (Math.abs(beta) > 155) return true
  return false
}

/** True when the device is near-horizontal — advisory "level" state only. */
export function isCompassLevelOrientation(beta: number | null, gamma: number | null): boolean {
  if (beta == null || !Number.isFinite(beta)) return false
  return Math.abs(beta) < 25
}

/**
 * Tilt-compensated compass from DeviceOrientation alpha/beta/gamma (W3C rotation matrix).
 * Works in portrait, landscape, and flat orientations when sensors are available.
 */
export function computeTiltCompensatedHeading(
  alpha: number,
  beta: number,
  gamma: number,
): number {
  const degToRad = Math.PI / 180
  const _alpha = alpha * degToRad
  const _beta = beta * degToRad
  const _gamma = gamma * degToRad

  const cA = Math.cos(_alpha)
  const sA = Math.sin(_alpha)
  const cB = Math.cos(_beta)
  const sB = Math.sin(_beta)
  const cG = Math.cos(_gamma)
  const sG = Math.sin(_gamma)

  const Vx = -cA * sG - sA * sB * cG
  const Vy = -sA * sG + cA * sB * cG

  const heading = Math.atan2(Vx, Vy) * (180 / Math.PI)
  return normalizeHeading(heading)
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

export type OrientationHeadingDebug = {
  rawAlpha: number | null
  fusedHeading: number | null
  displayedHeading: number | null
  source: 'webkit' | 'fusion' | 'absolute' | 'relative' | 'none'
  absolute: boolean
  screenAngle: number
  level: boolean
  edgeTilt: boolean
}

let lastHeadingDebug: OrientationHeadingDebug | null = null

export function readLastHeadingDebug(): OrientationHeadingDebug | null {
  return lastHeadingDebug
}

function logHeadingDebug(d: OrientationHeadingDebug): void {
  lastHeadingDebug = d
  try {
    if (
      typeof window !== 'undefined' &&
      (window.localStorage?.getItem('hud_compass_debug') === '1' ||
        window.localStorage?.getItem('hud_tier1_debug') === '1')
    ) {
      console.info('[hud-compass]', d)
    }
  } catch {
    /* ignore */
  }
}

/**
 * Map DeviceOrientation to compass heading (0° = north, clockwise).
 *
 * - iOS: `webkitCompassHeading` (degrees clockwise from north).
 * - Absolute + beta/gamma: tilt-compensated fusion (flat-safe).
 * - Absolute alpha-only: alpha adjusted for screen rotation (no 90° inversion).
 * - Legacy relative `deviceorientation`: inverted alpha (older Android).
 */
export function resolveOrientationHeading(event: DeviceOrientationEvent): number | null {
  const orient = getScreenOrientationAngle()
  const alpha = typeof event.alpha === 'number' && Number.isFinite(event.alpha) ? event.alpha : null
  const beta = typeof event.beta === 'number' && Number.isFinite(event.beta) ? event.beta : null
  const gamma = typeof event.gamma === 'number' && Number.isFinite(event.gamma) ? event.gamma : null
  const level = isCompassLevelOrientation(beta, gamma)
  const edgeTilt = isCompassTiltUnreliable(beta, gamma)

  const webkitHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
    .webkitCompassHeading
  if (typeof webkitHeading === 'number' && Number.isFinite(webkitHeading)) {
    const fused = normalizeHeading(webkitHeading)
    logHeadingDebug({
      rawAlpha: alpha,
      fusedHeading: fused,
      displayedHeading: fused,
      source: 'webkit',
      absolute: event.absolute === true,
      screenAngle: orient,
      level,
      edgeTilt,
    })
    return fused
  }

  if (alpha == null) {
    logHeadingDebug({
      rawAlpha: null,
      fusedHeading: null,
      displayedHeading: null,
      source: 'none',
      absolute: event.absolute === true,
      screenAngle: orient,
      level,
      edgeTilt,
    })
    return null
  }

  let fused: number
  let source: OrientationHeadingDebug['source']
  if (beta != null && gamma != null) {
    fused = computeTiltCompensatedHeading(alpha, beta, gamma)
    source = 'fusion'
  } else if (event.absolute === true) {
    fused = normalizeHeading(alpha - orient)
    source = 'absolute'
  } else {
    fused = normalizeHeading(360 - alpha + orient)
    source = 'relative'
  }

  logHeadingDebug({
    rawAlpha: alpha,
    fusedHeading: fused,
    displayedHeading: fused,
    source,
    absolute: event.absolute === true,
    screenAngle: orient,
    level,
    edgeTilt,
  })
  return fused
}
