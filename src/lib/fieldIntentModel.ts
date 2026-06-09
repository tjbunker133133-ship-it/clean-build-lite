/**
 * Field Intention Model (FIM) — Modern Layer environmental contract.
 *
 * Single control input: fieldIntent
 * All expression values are DERIVED via computeFieldState() — never set directly.
 */

export type FieldIntent =
  | 'STREET_AWARE'
  | 'NAVIGATION_ACTIVE'
  | 'REGIONAL_OVERVIEW'
  | 'STORM_INTENSIVE'
  | 'EMERGENCY_FOCUS'
  | 'SYSTEM_FAILURE_PROCEDURAL'

export type FieldState = {
  intent: FieldIntent
  fieldPresence: number
  tileExpression: number
  noiseExpression: number
  motionIntensity: number
  spatialClarity: number
  /** Derived raster opacity = fieldPresence × tileExpression */
  effectiveOpacity: number
  frameIntervalMs: number
  brightnessMin: number
  brightnessMax: number
  contrast: number
  saturation: number
  noisePulse: number
}

export const FIELD_PRESENCE_FLOOR = 0.14

/** Below this, structural tiles are not expressed — procedural field only. */
export const FIELD_TILE_EXPRESSION_MIN = 0.08

const INTENT_TABLE: Record<
  FieldIntent,
  Omit<FieldState, 'intent' | 'effectiveOpacity' | 'frameIntervalMs' | 'brightnessMin' | 'brightnessMax' | 'contrast' | 'saturation' | 'noisePulse'>
> = {
  STREET_AWARE: {
    fieldPresence: 0.4,
    tileExpression: 0.03,
    noiseExpression: 0.84,
    motionIntensity: 2.8,
    spatialClarity: 0.14,
  },
  NAVIGATION_ACTIVE: {
    fieldPresence: 0.44,
    tileExpression: 0.48,
    noiseExpression: 0.36,
    motionIntensity: 1.45,
    spatialClarity: 0.56,
  },
  REGIONAL_OVERVIEW: {
    fieldPresence: 0.52,
    tileExpression: 0.9,
    noiseExpression: 0.12,
    motionIntensity: 0.82,
    spatialClarity: 0.92,
  },
  STORM_INTENSIVE: {
    fieldPresence: 1.0,
    tileExpression: 0.34,
    noiseExpression: 0.94,
    motionIntensity: 3.2,
    spatialClarity: 0.22,
  },
  EMERGENCY_FOCUS: {
    fieldPresence: 0.48,
    tileExpression: 0.58,
    noiseExpression: 0.2,
    motionIntensity: 1.0,
    spatialClarity: 0.96,
  },
  SYSTEM_FAILURE_PROCEDURAL: {
    fieldPresence: 0.42,
    tileExpression: 0,
    noiseExpression: 1.0,
    motionIntensity: 2.2,
    spatialClarity: 0.08,
  },
}

function paintFromIntent(
  intent: FieldIntent,
  spatialClarity: number,
  motionIntensity: number,
): Pick<FieldState, 'frameIntervalMs' | 'brightnessMin' | 'brightnessMax' | 'contrast' | 'saturation' | 'noisePulse'> {
  const baseInterval = 920 / Math.max(0.5, motionIntensity)
  switch (intent) {
    case 'STREET_AWARE':
    case 'SYSTEM_FAILURE_PROCEDURAL':
      return {
        frameIntervalMs: baseInterval * 1.65,
        brightnessMin: 0.2,
        brightnessMax: 0.78,
        contrast: -0.3,
        saturation: -0.58,
        noisePulse: 2.9,
      }
    case 'NAVIGATION_ACTIVE':
      return {
        frameIntervalMs: baseInterval,
        brightnessMin: 0.05,
        brightnessMax: 0.93,
        contrast: 0.08,
        saturation: 0.22,
        noisePulse: 1.3,
      }
    case 'REGIONAL_OVERVIEW':
      return {
        frameIntervalMs: baseInterval * 0.78,
        brightnessMin: 0,
        brightnessMax: 1,
        contrast: 0.24,
        saturation: 0.62,
        noisePulse: 0.85,
      }
    case 'STORM_INTENSIVE':
      return {
        frameIntervalMs: baseInterval * 1.35,
        brightnessMin: 0.12,
        brightnessMax: 0.86,
        contrast: -0.12,
        saturation: -0.2,
        noisePulse: 3.4,
      }
    case 'EMERGENCY_FOCUS':
      return {
        frameIntervalMs: baseInterval * 0.95,
        brightnessMin: 0,
        brightnessMax: 1,
        contrast: 0.38,
        saturation: 0.45,
        noisePulse: 0.7,
      }
    default:
      return {
        frameIntervalMs: baseInterval,
        brightnessMin: 0,
        brightnessMax: 1,
        contrast: 0.1 * spatialClarity,
        saturation: 0.2 * spatialClarity,
        noisePulse: 1,
      }
  }
}

/** Deterministic derivation — the ONLY path to field expression values. */
export function computeFieldState(intent: FieldIntent): FieldState {
  const core = INTENT_TABLE[intent]
  const fieldPresence = Math.max(FIELD_PRESENCE_FLOOR, core.fieldPresence)
  const paint = paintFromIntent(intent, core.spatialClarity, core.motionIntensity)

  return {
    intent,
    fieldPresence,
    tileExpression: core.tileExpression,
    noiseExpression: core.noiseExpression,
    motionIntensity: core.motionIntensity,
    spatialClarity: core.spatialClarity,
    effectiveOpacity: fieldPresence * core.tileExpression,
    ...paint,
  }
}

export function fieldIntentLabel(intent: FieldIntent): string {
  switch (intent) {
    case 'STREET_AWARE':
      return 'Street awareness'
    case 'NAVIGATION_ACTIVE':
      return 'Navigation flow'
    case 'REGIONAL_OVERVIEW':
      return 'Regional overview'
    case 'STORM_INTENSIVE':
      return 'Storm intensive'
    case 'EMERGENCY_FOCUS':
      return 'Emergency focus'
    case 'SYSTEM_FAILURE_PROCEDURAL':
      return 'Procedural continuity'
  }
}
