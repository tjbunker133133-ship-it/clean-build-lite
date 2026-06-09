/**
 * Global Motion Language — unified spatial motion + visual identity.
 *
 * All UI, camera, overlays, atmospherics, hints, and transitions
 * must derive timing and easing from this module.
 */

import type { CameraPhysicsConfig } from '../../field/cameraPhysicsSolver'
import { MODERN_CAMERA_PHYSICS_CONFIG } from '../../field/cameraPhysicsSolver'
import type { RecursiveFieldSnapshot } from '../../field/recursive/types'
import { cssEasing, type MotionEasingId } from './easingCurves'
import { depthSpec, opacityInTier, type DepthTier } from './opacityCadence'
import {
  degradeMotionProfile,
  motionProfileForLayer,
  type MotionLayerId,
  type MotionProfile,
} from './motionProfiles'

export type { MotionLayerId, MotionProfile, DepthTier }
export { cssEasing, applyMotionEasing } from './easingCurves'
export { depthSpec, opacityInTier } from './opacityCadence'
export { motionProfileForLayer, MOTION_PROFILES } from './motionProfiles'

export type FieldEmergenceMotion = {
  radialOpacity: number
  missionPanelOpacity: number
  navigationHintOpacity: number
  overlayFadeMultiplier: number
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/** Resolve HUD motion layer from runtime. */
export function resolveMotionLayer(): MotionLayerId {
  if (typeof window === 'undefined') return 'classic'
  const runtime = window.__HUD_RUNTIME__
  if (!runtime) return 'classic'
  if (runtime.isImmersive) return 'modern'
  if (runtime.isHybrid) return 'balanced'
  return 'classic'
}

export function getMotionProfile(
  layer: MotionLayerId = resolveMotionLayer(),
  reducedMotion = false,
  backgrounded = false,
): MotionProfile {
  let profile = motionProfileForLayer(layer)
  if (reducedMotion || backgrounded) {
    profile = degradeMotionProfile(profile)
  }
  return profile
}

function fadeMsForTier(profile: MotionProfile, tier: DepthTier): number {
  const spec = depthSpec(tier, profile.layer)
  switch (spec.fadeMsKey) {
    case 'fast':
      return profile.fadeFastMs
    case 'medium':
      return profile.fadeMediumMs
    case 'slow':
      return profile.fadeSlowMs
    case 'atmospheric':
      return profile.fadeAtmosphericMs
    default:
      return profile.fadeMediumMs
  }
}

/** Standard CSS transition string for a property + depth tier. */
export function cssTransition(
  property: string,
  tier: DepthTier,
  options?: {
    layer?: MotionLayerId
    reducedMotion?: boolean
    easing?: MotionEasingId
  },
): string {
  const layer = options?.layer ?? resolveMotionLayer()
  const profile = getMotionProfile(layer, options?.reducedMotion ?? false)
  const ms = fadeMsForTier(profile, tier)
  const easing = options?.easing ?? (tier === 'atmospheric' ? 'organismEaseInOut' : 'organismSettle')
  return `${property} ${ms}ms ${cssEasing(easing)}`
}

export function emergenceTransition(
  layer: MotionLayerId = resolveMotionLayer(),
  reducedMotion = false,
): string {
  const profile = getMotionProfile(layer, reducedMotion)
  return cssTransition('opacity', 'floating', {
    layer,
    reducedMotion,
    easing: 'organismEaseOut',
  }).replace(/opacity \d+ms/, `opacity ${profile.emergenceMs}ms`)
}

function sigmoid(x: number, k: number, midpoint = 0.5): number {
  return 1 / (1 + Math.exp(-k * (x - midpoint)))
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x >= edge1 ? 1 : 0
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/** Continuous field-driven emergence — motion-profile weighted. */
export function computeFieldEmergence(
  field: RecursiveFieldSnapshot,
  profile: MotionProfile = getMotionProfile('modern'),
): FieldEmergenceMotion {
  const softness = profile.emergenceSoftness
  if (softness <= 0) {
    return {
      radialOpacity: field.radialPressure,
      missionPanelOpacity: field.missionFocus,
      navigationHintOpacity: field.navigationPull * 0.6,
      overlayFadeMultiplier: 0.55 + field.cameraStability * 0.45,
    }
  }

  const coherenceFactor =
    0.5 +
    field.coherence * profile.emergenceCoherenceWeight * 0.5
  const camDamp = clamp01(1 - field.inertiaBias * 0.35 * softness)
  const k1 = 4.5 + softness * 1.2

  const radialOpacity =
    sigmoid(field.radialPressure, k1) * camDamp * coherenceFactor

  const lagAdjustedNav =
    field.navigationPull * (1 - field.perceptualLag * 0.38 * softness)
  const navigationHintOpacity =
    smoothstep(0.06, 0.94, lagAdjustedNav) *
    coherenceFactor *
    opacityInTier(1, 'floating', 'modern') /
    depthSpec('floating', 'modern').opacityMax

  const missionPanelOpacity =
    smoothstep(0.04, 0.96, field.missionFocus) * coherenceFactor

  const predictedFade =
    0.42 +
    field.cameraStability * 0.32 +
    field.coherence * 0.26 * profile.atmosphericPulseCoherenceWeight

  return {
    radialOpacity: clamp01(opacityInTier(radialOpacity, 'floating', 'modern')),
    missionPanelOpacity: clamp01(
      opacityInTier(missionPanelOpacity, 'floating', 'modern'),
    ),
    navigationHintOpacity: clamp01(navigationHintOpacity),
    overlayFadeMultiplier: clamp01(predictedFade),
  }
}

/** Low-frequency atmospheric breath — coherence-weighted. */
export function atmosphericBreathFactor(
  coherence: number,
  timestampMs: number,
  profile: MotionProfile = getMotionProfile('modern'),
): number {
  if (profile.atmosphericBreathHz <= 0) return 1
  const phase = timestampMs * 0.001 * profile.atmosphericBreathHz * Math.PI * 2
  const amp = profile.atmosphericDriftAmp * (0.55 + coherence * profile.atmosphericPulseCoherenceWeight)
  return 1 + Math.sin(phase) * amp
}

/** Subtle environmental drift offset for parallax layers. */
export function atmosphericDriftOffset(
  coherence: number,
  timestampMs: number,
  profile: MotionProfile = getMotionProfile('modern'),
): { x: number; y: number } {
  if (profile.atmosphericDriftAmp <= 0) return { x: 0, y: 0 }
  const t = timestampMs * 0.001
  const amp = profile.atmosphericDriftAmp * 12 * (0.4 + coherence * 0.6)
  return {
    x: Math.sin(t * 0.31) * amp,
    y: Math.cos(t * 0.23) * amp * 0.7,
  }
}

export type CameraMotionContext = {
  coherence: number
  speedMs: number
  bearingDelta: number
  reducedMotion: boolean
}

/** Refine physics config — micro-sway damping, turn anticipation, coherence stabilization. */
export function refineCameraPhysicsConfig(
  base: CameraPhysicsConfig = MODERN_CAMERA_PHYSICS_CONFIG,
  ctx: CameraMotionContext,
  profile: MotionProfile = getMotionProfile('modern'),
): CameraPhysicsConfig {
  if (profile.layer !== 'modern' || ctx.reducedMotion) {
    return {
      ...base,
      positionD: base.positionD * profile.dampingScale,
      bearingD: base.bearingD * profile.dampingScale,
    }
  }

  const coherenceBoost = 1 + ctx.coherence * profile.cameraCoherenceStabilization * 0.35
  const speedFactor = clamp01(ctx.speedMs / 3.5)
  const lowSpeedDrift = (1 - speedFactor) * profile.cameraLowSpeedDrift
  const turnAnticipation = clamp01(Math.abs(ctx.bearingDelta) / 45) * profile.cameraTurnAnticipation
  const swayDamp = profile.cameraSwayDamp

  const positionD = base.positionD * swayDamp * coherenceBoost * (1 + lowSpeedDrift * 0.4)
  const bearingK = base.bearingK * (1 + turnAnticipation * 0.25)
  const bearingD = base.bearingD * swayDamp * coherenceBoost

  return {
    ...base,
    positionK: base.positionK * (1 - lowSpeedDrift * 0.08),
    positionD,
    bearingK,
    bearingD,
    zoomD: base.zoomD * coherenceBoost,
    maxCenterVel: base.maxCenterVel * (1 + turnAnticipation * 0.05),
  }
}

/** Interaction cadence — micro-delay before UI reaction. */
export function interactionMicroDelay(profile: MotionProfile = getMotionProfile()): number {
  return profile.interactionMicroDelayMs
}

export function interactionSettleWindow(profile: MotionProfile = getMotionProfile()): number {
  return profile.interactionSettleMs
}

/** Scale OSG transition duration by layer personality. */
export function layerTransitionDuration(
  baseMs: number,
  layer: MotionLayerId = resolveMotionLayer(),
): number {
  const profile = motionProfileForLayer(layer)
  const scale =
    layer === 'classic' ? 0.75 : layer === 'balanced' ? 0.9 : 1.05
  return Math.round(baseMs * scale + profile.stabilizationDelayMs * 0.15)
}
