/**
 * Adaptive GPS power / polling policy (pure logic).
 * Does not perform geolocation calls — only classifies mode from recent signals.
 */

export type GpsPowerMode = 'active_navigation' | 'stable_tracking' | 'stationary_low'

export type AdaptiveGpsSignals = {
  /** Latest horizontal accuracy (m), if known. */
  accuracyM: number | null
  /** Device-reported speed (m/s), if known. */
  speedMs: number | null
  /** Speed inferred from successive fixes over ground (m/s), if known. */
  inferredSpeedMs: number | null
  /** Consecutive samples where heading/course stayed within tolerance (after first). */
  stableHeadingStreak: number
  /** Milliseconds of sustained low motion while fix is decent. */
  stationaryAccumulatorMs: number
  /** SOS armed or Dead Man in elevated timer states — always demand full polling. */
  emergencyBypass: boolean
}

export function chooseGpsPowerMode(s: AdaptiveGpsSignals): GpsPowerMode {
  if (s.emergencyBypass) return 'active_navigation'
  const acc = s.accuracyM
  const spdDevice = s.speedMs != null && Number.isFinite(s.speedMs) ? s.speedMs : null
  const spdInf = s.inferredSpeedMs != null && Number.isFinite(s.inferredSpeedMs) ? s.inferredSpeedMs : null
  const sp = Math.max(spdDevice ?? 0, spdInf ?? 0)

  if (acc == null || acc > 38 || sp > 1.15) return 'active_navigation'
  if ((acc ?? 99) <= 32 && sp < 0.12 && s.stationaryAccumulatorMs >= 48_000) return 'stationary_low'
  if ((acc ?? 99) <= 30 && sp < 0.42 && s.stableHeadingStreak >= 4) return 'stable_tracking'
  return 'active_navigation'
}

/** Milliseconds between hardware samples in stable tracking mode. */
export const GPS_POLL_STABLE_MS = 14_000

/** Milliseconds between hardware samples in stationary / low-power mode. */
export const GPS_POLL_STATIONARY_MS = 52_000

/** Max time we extrapolate between hardware fixes (seconds). */
export const GPS_DR_MAX_AGE_SEC = 28

/** Accuracy growth (m/s) applied while interpolating between fixes. */
export const GPS_DR_ACCURACY_DRIFT_MPS = 1.25
