import type { OperationalMode } from '../operationalStateGraph/types'
import type { EnvironmentalTone } from './types'

const NEUTRAL: EnvironmentalTone = {
  intensity: 0.35,
  desaturation: 0,
  contrastBoost: 0,
  pathGlowAccent: 1,
  dimBackground: 0,
  motionTint: 0,
}

/** Mode influences tone — reflection layer only. */
export function environmentalToneForMode(mode: OperationalMode): EnvironmentalTone {
  switch (mode) {
    case 'idle':
      return { ...NEUTRAL, intensity: 0.3 }
    case 'measure':
      return { ...NEUTRAL, intensity: 0.42, desaturation: 0.14 }
    case 'route':
      return { ...NEUTRAL, intensity: 0.48, pathGlowAccent: 1.35 }
    case 'mission':
      return { ...NEUTRAL, intensity: 0.55, contrastBoost: 0.12 }
    case 'navigation':
      return { ...NEUTRAL, intensity: 0.5, motionTint: 0.08 }
    case 'radial':
      return { ...NEUTRAL, intensity: 0.38, dimBackground: 0.45 }
    default:
      return { ...NEUTRAL }
  }
}

/** Additive weather overlay — never overrides mode tone. */
export function blendWeatherTone(base: EnvironmentalTone, weatherIntensity: number): EnvironmentalTone {
  const w = Math.max(0, Math.min(1, weatherIntensity))
  return {
    ...base,
    intensity: Math.min(1, base.intensity + w * 0.12),
    desaturation: Math.min(0.35, base.desaturation + w * 0.06),
  }
}
