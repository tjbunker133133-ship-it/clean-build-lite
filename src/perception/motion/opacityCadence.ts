/**
 * Depth hierarchy + opacity cadence — unified visual layering.
 */

import type { MotionLayerId } from './motionProfiles'

export type DepthTier = 'grounded' | 'floating' | 'atmospheric' | 'system'

export type DepthSpec = {
  opacityMin: number
  opacityMax: number
  motionScale: number
  blurPx: number
  parallaxFactor: number
  fadeMsKey: 'fast' | 'medium' | 'slow' | 'atmospheric'
}

const DEPTH_BASE: Record<DepthTier, DepthSpec> = {
  grounded: {
    opacityMin: 0.72,
    opacityMax: 1,
    motionScale: 0.35,
    blurPx: 0,
    parallaxFactor: 0,
    fadeMsKey: 'slow',
  },
  floating: {
    opacityMin: 0.08,
    opacityMax: 0.92,
    motionScale: 0.85,
    blurPx: 4,
    parallaxFactor: 0.12,
    fadeMsKey: 'medium',
  },
  atmospheric: {
    opacityMin: 0.04,
    opacityMax: 0.22,
    motionScale: 0.25,
    blurPx: 0,
    parallaxFactor: 0.06,
    fadeMsKey: 'atmospheric',
  },
  system: {
    opacityMin: 0.55,
    opacityMax: 1,
    motionScale: 0.5,
    blurPx: 2,
    parallaxFactor: 0,
    fadeMsKey: 'fast',
  },
}

const LAYER_DEPTH_SCALE: Record<MotionLayerId, number> = {
  classic: 1,
  balanced: 0.92,
  modern: 0.78,
}

export function depthSpec(tier: DepthTier, layer: MotionLayerId = 'modern'): DepthSpec {
  const base = DEPTH_BASE[tier]
  const scale = LAYER_DEPTH_SCALE[layer]
  return {
    ...base,
    opacityMax: base.opacityMax * (tier === 'atmospheric' ? scale : 1),
    motionScale: base.motionScale * scale,
  }
}

/** Map raw 0–1 signal into depth-appropriate opacity. */
export function opacityInTier(
  signal: number,
  tier: DepthTier,
  layer: MotionLayerId = 'modern',
): number {
  const spec = depthSpec(tier, layer)
  const t = Math.max(0, Math.min(1, signal))
  return spec.opacityMin + (spec.opacityMax - spec.opacityMin) * t
}
