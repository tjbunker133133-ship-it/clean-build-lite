/**
 * Global easing curves — single organism motion philosophy.
 * All HUD motion must reference these curves.
 */

export type MotionEasingId =
  | 'organismEaseOut'
  | 'organismEaseInOut'
  | 'organismSettle'
  | 'organismLinear'
  | 'organismSpring'

/** CSS timing-function strings. */
export const CSS_EASING: Record<MotionEasingId, string> = {
  organismEaseOut: 'cubic-bezier(0.22, 0.68, 0.18, 1)',
  organismEaseInOut: 'cubic-bezier(0.45, 0.05, 0.35, 0.95)',
  organismSettle: 'cubic-bezier(0.33, 0.82, 0.25, 1)',
  organismLinear: 'linear',
  organismSpring: 'cubic-bezier(0.34, 1.18, 0.42, 1)',
}

export function cssEasing(id: MotionEasingId): string {
  return CSS_EASING[id]
}

/** Normalized progress t ∈ [0,1] → eased progress. */
export function applyMotionEasing(t: number, id: MotionEasingId): number {
  const x = Math.max(0, Math.min(1, t))
  switch (id) {
    case 'organismEaseOut':
      return 1 - (1 - x) ** 3
    case 'organismEaseInOut':
      return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2
    case 'organismSettle': {
      const c = 1 - Math.exp(-5.5 * x) * Math.cos(3.5 * Math.PI * x)
      return Math.max(0, Math.min(1, c))
    }
    case 'organismSpring': {
      const c = 1 - Math.exp(-6 * x) * Math.cos(4 * Math.PI * x)
      return Math.max(0, Math.min(1, c))
    }
    case 'organismLinear':
    default:
      return x
  }
}

export function interpolateWithEasing(
  from: number,
  to: number,
  t: number,
  id: MotionEasingId,
): number {
  return from + (to - from) * applyMotionEasing(t, id)
}
