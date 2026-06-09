/**
 * Layer separation — Classic / Balanced / Modern field influence.
 */

import type { FieldDampingConfig, FieldLayerMode } from './types'

export function resolveFieldLayerMode(): FieldLayerMode {
  if (typeof window === 'undefined') return 'classic'
  const runtime = window.__HUD_RUNTIME__
  if (!runtime) return 'classic'
  if (runtime.isImmersive) return 'modern'
  if (runtime.isHybrid) return 'balanced'
  return 'classic'
}

/** 0 = no field influence (Classic), 1 = full (Modern). */
export function fieldLayerInfluence(layer: FieldLayerMode): number {
  switch (layer) {
    case 'modern':
      return 1
    case 'balanced':
      return 0.55
    case 'classic':
    default:
      return 0
  }
}

export function dampingForLayer(layer: FieldLayerMode): FieldDampingConfig {
  switch (layer) {
    case 'modern':
      return {
        routeIntensity: 4.2,
        missionFocus: 3.8,
        navigationPull: 5.5,
        radialPressure: 8.0,
        environmentalAwareness: 2.4,
      }
    case 'balanced':
      return {
        routeIntensity: 6.5,
        missionFocus: 5.5,
        navigationPull: 7.0,
        radialPressure: 10.0,
        environmentalAwareness: 4.0,
      }
    case 'classic':
    default:
      return {
        routeIntensity: 0,
        missionFocus: 0,
        navigationPull: 0,
        radialPressure: 0,
        environmentalAwareness: 0,
      }
  }
}

export function fieldEngineActive(layer: FieldLayerMode): boolean {
  return layer !== 'classic'
}

export function cameraPhysicsActive(layer: FieldLayerMode): boolean {
  return layer === 'modern'
}

/** Recursive dynamics gain — 0 = off (Classic), partial (Balanced), full (Modern). */
export function recursiveDynamicsGain(layer: FieldLayerMode): number {
  switch (layer) {
    case 'modern':
      return 1
    case 'balanced':
      return 0.35
    case 'classic':
    default:
      return 0
  }
}

export function recursiveDynamicsActive(layer: FieldLayerMode): boolean {
  return recursiveDynamicsGain(layer) > 0
}
