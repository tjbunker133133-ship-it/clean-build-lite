import {
  computeFieldEmergence,
  getMotionProfile,
} from '../../perception/motion/motionLanguage'
import type { SpatialFieldValues } from '../types'
import type { RecursiveFieldSnapshot } from './types'

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t)
}

/** Smooth S-curve emergence — no hard thresholds. */
export function sigmoid(x: number, k = 6, midpoint = 0.5): number {
  return 1 / (1 + Math.exp(-k * (x - midpoint)))
}

/** Continuous ramp 0→1 across [edge0, edge1]. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x >= edge1 ? 1 : 0
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export function fieldMagnitude(values: SpatialFieldValues): number {
  return (
    Math.abs(values.routeIntensity) +
    Math.abs(values.missionFocus) +
    Math.abs(values.navigationPull) +
    Math.abs(values.radialPressure) +
    Math.abs(values.environmentalAwareness)
  )
}

export function subtractFields(a: SpatialFieldValues, b: SpatialFieldValues): SpatialFieldValues {
  return {
    routeIntensity: a.routeIntensity - b.routeIntensity,
    missionFocus: a.missionFocus - b.missionFocus,
    navigationPull: a.navigationPull - b.navigationPull,
    radialPressure: a.radialPressure - b.radialPressure,
    environmentalAwareness: a.environmentalAwareness - b.environmentalAwareness,
  }
}

export function scaleFields(values: SpatialFieldValues, factor: number): SpatialFieldValues {
  return {
    routeIntensity: values.routeIntensity * factor,
    missionFocus: values.missionFocus * factor,
    navigationPull: values.navigationPull * factor,
    radialPressure: values.radialPressure * factor,
    environmentalAwareness: values.environmentalAwareness * factor,
  }
}

export function clampFields(values: SpatialFieldValues): SpatialFieldValues {
  return {
    routeIntensity: clamp01(values.routeIntensity),
    missionFocus: clamp01(values.missionFocus),
    navigationPull: clamp01(values.navigationPull),
    radialPressure: clamp01(values.radialPressure),
    environmentalAwareness: clamp01(values.environmentalAwareness),
  }
}

export function addFields(a: SpatialFieldValues, b: SpatialFieldValues): SpatialFieldValues {
  return clampFields({
    routeIntensity: a.routeIntensity + b.routeIntensity,
    missionFocus: a.missionFocus + b.missionFocus,
    navigationPull: a.navigationPull + b.navigationPull,
    radialPressure: a.radialPressure + b.radialPressure,
    environmentalAwareness: a.environmentalAwareness + b.environmentalAwareness,
  })
}

const PREDICT_VEL_MS = 0.3
const PREDICT_ACCEL_MS = 0.12

/** futureField ≈ current + velocity×300ms + acceleration×120ms */
export function predictFields(
  current: SpatialFieldValues,
  velocity: SpatialFieldValues,
  acceleration: SpatialFieldValues,
): SpatialFieldValues {
  return clampFields(
    addFields(
      addFields(current, scaleFields(velocity, PREDICT_VEL_MS)),
      scaleFields(acceleration, PREDICT_ACCEL_MS),
    ),
  )
}

export type SoftEmergenceState = {
  radialOpacity: number
  missionPanelOpacity: number
  navigationHintOpacity: number
  overlayFadeMultiplier: number
}

/** Delegates to global motion language — no inline emergence curves. */
export function computeSoftEmergence(field: RecursiveFieldSnapshot): SoftEmergenceState {
  return computeFieldEmergence(field, getMotionProfile('modern'))
}
