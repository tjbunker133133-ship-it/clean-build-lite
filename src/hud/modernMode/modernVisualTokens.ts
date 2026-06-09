/**
 * Modern layer visual tokens — environmental coherence, restrained chrome.
 * Single source for floating / atmospheric / sheet surfaces.
 */

import { cssEasing, cssTransition } from '../../perception/motion/motionLanguage'

/** Floating contextual affordances (chips, hints, reactions). */
export const MODERN_FLOATING = {
  background: 'rgba(12, 16, 22, 0.48)',
  backgroundActive: 'rgba(10, 24, 28, 0.44)',
  border: 'rgba(255, 255, 255, 0.04)',
  borderActive: 'rgba(125, 200, 255, 0.14)',
  blur: 'blur(14px) saturate(1.04)',
  radius: 16,
  shadow: '0 2px 18px rgba(0, 0, 0, 0.18)',
  shadowActive: '0 3px 20px rgba(0, 0, 0, 0.16)',
} as const

/** Transient sheets — contextual emergence from environment. */
export const MODERN_SHEET = {
  background: 'linear-gradient(180deg, rgba(14, 18, 24, 0.72) 0%, rgba(10, 14, 20, 0.82) 100%)',
  border: 'rgba(255, 255, 255, 0.04)',
  blur: 'blur(28px) saturate(1.05)',
  radiusTop: 24,
  shadow: '0 -6px 40px rgba(0, 0, 0, 0.28)',
  closeSize: 44,
} as const

/** Modern micro bar — environment-first, minimal chrome. */
export const MODERN_MICRO_BAR = {
  height: 28,
  background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.28) 0%, transparent 100%)',
  border: 'none',
} as const

/** Balanced micro bar — operational workspace strip. */
export const BALANCED_MICRO_BAR = {
  height: 40,
  background: 'rgba(10, 12, 13, 0.94)',
  border: '1px solid rgba(125, 255, 138, 0.12)',
} as const

/** Environmental compass — integrated, not widget-like. */
export const MODERN_COMPASS = {
  ring: 'rgba(255, 255, 255, 0.12)',
  ringActive: 'rgba(125, 200, 255, 0.45)',
  north: 'rgba(255, 95, 90, 0.85)',
  text: 'rgba(255, 255, 255, 0.72)',
  textMuted: 'rgba(255, 255, 255, 0.35)',
} as const

/** Radial hint — map-anchored, low chrome. */
export const MODERN_HINT = {
  background: 'rgba(14, 18, 22, 0.7)',
  border: 'rgba(255, 255, 255, 0.06)',
  accent: 'rgba(125, 200, 255, 0.75)',
  accentRing: 'rgba(125, 200, 255, 0.22)',
  radius: 18,
} as const

export function modernFloatingTransition(reducedMotion = false): string {
  return cssTransition('opacity', 'floating', { layer: 'modern', reducedMotion })
}

export function modernSheetEnterTransition(reducedMotion = false): string {
  if (reducedMotion) return modernFloatingTransition(reducedMotion)
  const easing = cssEasing('organismEaseOut')
  return `opacity 340ms ${easing}, transform 340ms ${easing}`
}
