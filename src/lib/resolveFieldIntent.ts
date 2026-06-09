/**
 * Derives fieldIntent from runtime signals — never sets expression values directly.
 */

import type { FieldIntent } from './fieldIntentModel'

export type FieldIntentSignals = {
  zoom: number
  navigating: boolean
  storm: boolean
  emergency: boolean
  systemFailure: boolean
}

/**
 * Priority-ordered intent resolution.
 * Network failure always forces procedural continuity.
 */
export function deriveFieldIntent(signals: FieldIntentSignals): FieldIntent {
  if (signals.systemFailure) return 'SYSTEM_FAILURE_PROCEDURAL'
  if (signals.emergency) return 'EMERGENCY_FOCUS'
  if (signals.storm) return 'STORM_INTENSIVE'
  if (signals.navigating) return 'NAVIGATION_ACTIVE'
  if (signals.zoom <= 7) return 'REGIONAL_OVERVIEW'
  if (signals.zoom >= 12) return 'STREET_AWARE'
  return 'NAVIGATION_ACTIVE'
}
