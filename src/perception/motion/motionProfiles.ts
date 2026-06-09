/**
 * Layer personality profiles — Classic / Balanced / Modern motion identity.
 */

export type MotionLayerId = 'classic' | 'balanced' | 'modern'

export type MotionProfile = {
  layer: MotionLayerId
  /** Spring/damping multiplier. */
  dampingScale: number
  inertiaScale: number
  /** Standardized fade durations (ms). */
  fadeFastMs: number
  fadeMediumMs: number
  fadeSlowMs: number
  fadeAtmosphericMs: number
  emergenceMs: number
  transitionCadenceMs: number
  microDelayMs: number
  settleWindowMs: number
  stabilizationDelayMs: number
  /** Atmospheric continuity (Modern). */
  atmosphericBreathHz: number
  atmosphericDriftAmp: number
  atmosphericPulseCoherenceWeight: number
  /** Camera refinement. */
  cameraSwayDamp: number
  cameraTurnAnticipation: number
  cameraLowSpeedDrift: number
  cameraCoherenceStabilization: number
  /** Emergence softness (sigmoid/smoothstep gain). */
  emergenceSoftness: number
  emergenceCoherenceWeight: number
  /** Interaction rhythm. */
  interactionMicroDelayMs: number
  interactionSettleMs: number
}

const CLASSIC_PROFILE: MotionProfile = {
  layer: 'classic',
  dampingScale: 1.35,
  inertiaScale: 0.25,
  fadeFastMs: 120,
  fadeMediumMs: 180,
  fadeSlowMs: 240,
  fadeAtmosphericMs: 0,
  emergenceMs: 0,
  transitionCadenceMs: 280,
  microDelayMs: 80,
  settleWindowMs: 120,
  stabilizationDelayMs: 60,
  atmosphericBreathHz: 0,
  atmosphericDriftAmp: 0,
  atmosphericPulseCoherenceWeight: 0,
  cameraSwayDamp: 1.2,
  cameraTurnAnticipation: 0,
  cameraLowSpeedDrift: 0,
  cameraCoherenceStabilization: 0.2,
  emergenceSoftness: 0,
  emergenceCoherenceWeight: 0,
  interactionMicroDelayMs: 40,
  interactionSettleMs: 80,
}

const BALANCED_PROFILE: MotionProfile = {
  layer: 'balanced',
  dampingScale: 1.05,
  inertiaScale: 0.55,
  fadeFastMs: 160,
  fadeMediumMs: 280,
  fadeSlowMs: 420,
  fadeAtmosphericMs: 2800,
  emergenceMs: 220,
  transitionCadenceMs: 480,
  microDelayMs: 140,
  settleWindowMs: 280,
  stabilizationDelayMs: 160,
  atmosphericBreathHz: 0.04,
  atmosphericDriftAmp: 0.012,
  atmosphericPulseCoherenceWeight: 0.35,
  cameraSwayDamp: 1.05,
  cameraTurnAnticipation: 0.15,
  cameraLowSpeedDrift: 0.08,
  cameraCoherenceStabilization: 0.45,
  emergenceSoftness: 0.45,
  emergenceCoherenceWeight: 0.5,
  interactionMicroDelayMs: 90,
  interactionSettleMs: 200,
}

const MODERN_PROFILE: MotionProfile = {
  layer: 'modern',
  dampingScale: 0.92,
  inertiaScale: 1,
  fadeFastMs: 200,
  fadeMediumMs: 320,
  fadeSlowMs: 520,
  fadeAtmosphericMs: 5000,
  emergenceMs: 340,
  transitionCadenceMs: 680,
  microDelayMs: 200,
  settleWindowMs: 420,
  stabilizationDelayMs: 280,
  atmosphericBreathHz: 0.055,
  atmosphericDriftAmp: 0.022,
  atmosphericPulseCoherenceWeight: 0.65,
  cameraSwayDamp: 0.88,
  cameraTurnAnticipation: 0.28,
  cameraLowSpeedDrift: 0.14,
  cameraCoherenceStabilization: 0.72,
  emergenceSoftness: 1,
  emergenceCoherenceWeight: 0.85,
  interactionMicroDelayMs: 120,
  interactionSettleMs: 320,
}

export const MOTION_PROFILES: Record<MotionLayerId, MotionProfile> = {
  classic: CLASSIC_PROFILE,
  balanced: BALANCED_PROFILE,
  modern: MODERN_PROFILE,
}

export function motionProfileForLayer(layer: MotionLayerId): MotionProfile {
  return MOTION_PROFILES[layer]
}

/** Reduced-motion / backgrounded degradation profile. */
export function degradeMotionProfile(profile: MotionProfile): MotionProfile {
  return {
    ...profile,
    atmosphericBreathHz: 0,
    atmosphericDriftAmp: 0,
    fadeAtmosphericMs: Math.min(profile.fadeAtmosphericMs, 400),
    fadeSlowMs: Math.min(profile.fadeSlowMs, 400),
    fadeMediumMs: Math.min(profile.fadeMediumMs, 280),
    emergenceMs: Math.min(profile.emergenceMs, 200),
    transitionCadenceMs: Math.min(profile.transitionCadenceMs, 320),
    cameraTurnAnticipation: 0,
    cameraLowSpeedDrift: 0,
  }
}
