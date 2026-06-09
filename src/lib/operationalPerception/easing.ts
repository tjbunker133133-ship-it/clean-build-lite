import type { EasingCurve } from './types'

export const MIN_TRANSITION_MS = 250
export const MAX_TRANSITION_MS = 2200
export const MIN_MICRO_DELAY_MS = 120
export const MAX_MICRO_DELAY_MS = 300

export function clampTransitionDuration(ms: number): number {
  return Math.max(MIN_TRANSITION_MS, Math.min(MAX_TRANSITION_MS, Math.round(ms)))
}

export function clampMicroDelay(ms: number): number {
  return Math.max(MIN_MICRO_DELAY_MS, Math.min(MAX_MICRO_DELAY_MS, Math.round(ms)))
}

/** Normalized easing progress t ∈ [0,1] → eased progress. */
export function applyEasing(t: number, curve: EasingCurve): number {
  const x = Math.max(0, Math.min(1, t))
  switch (curve) {
    case 'easeOutCubic':
      return 1 - (1 - x) ** 3
    case 'easeInOutQuad':
      return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2
    case 'springDamped': {
      const c = 1 - Math.exp(-6 * x) * Math.cos(4 * Math.PI * x)
      return Math.max(0, Math.min(1, c))
    }
    case 'linear':
    default:
      return x
  }
}

export function interpolateNumber(from: number, to: number, t: number, curve: EasingCurve): number {
  const p = applyEasing(t, curve)
  return from + (to - from) * p
}
