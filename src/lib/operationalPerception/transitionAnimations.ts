import type { OperationalMode } from '../operationalStateGraph/types'
import {
  getMotionProfile,
  layerTransitionDuration,
  resolveMotionLayer,
} from '../../perception/motion/motionLanguage'
import { clampMicroDelay, clampTransitionDuration } from './easing'
import type { EasingCurve, TransitionPacket } from './types'

export function buildTransitionPacket(input: {
  fromMode: OperationalMode
  toMode: OperationalMode
  logicalPath: OperationalMode[]
  triggerSource: string
  issuedAt?: number
}): TransitionPacket {
  const spec = animationSpec(input.fromMode, input.toMode)
  return {
    fromMode: input.fromMode,
    toMode: input.toMode,
    logicalPath: input.logicalPath,
    perceptualPath: [input.fromMode, input.toMode],
    durationMs: layerTransitionDuration(clampTransitionDuration(spec.durationMs)),
    intensity: spec.intensity,
    easing: spec.easing,
    triggerSource: input.triggerSource,
    issuedAt: input.issuedAt ?? Date.now(),
  }
}

function animationSpec(
  from: OperationalMode,
  to: OperationalMode,
): { durationMs: number; intensity: number; easing: EasingCurve } {
  if (from === 'radial') {
    return { durationMs: 0, intensity: 0, easing: 'linear' }
  }
  if (to === 'radial') {
    return { durationMs: 0, intensity: 0, easing: 'linear' }
  }
  if (from === 'idle' && to === 'measure') {
    return { durationMs: 420, intensity: 0.55, easing: 'easeOutCubic' }
  }
  if (from === 'route' && to === 'mission') {
    return { durationMs: 880, intensity: 0.75, easing: 'easeInOutQuad' }
  }
  if (from === 'mission' && to === 'idle') {
    return { durationMs: 760, intensity: 0.7, easing: 'easeInOutQuad' }
  }
  if (to === 'navigation' || from === 'navigation') {
    return { durationMs: 1050, intensity: 0.65, easing: 'springDamped' }
  }
  if (to === 'mission' || from === 'mission') {
    return { durationMs: 900, intensity: 0.72, easing: 'easeInOutQuad' }
  }
  return { durationMs: 380, intensity: 0.5, easing: 'easeOutCubic' }
}

export function sheetDelayForTransition(packet: TransitionPacket | null): number {
  if (!packet) return clampMicroDelay(160)
  return clampMicroDelay(Math.round(packet.durationMs * 0.45))
}

export function microDelayForMode(mode: OperationalMode): number {
  const profile = getMotionProfile(resolveMotionLayer())
  if (mode === 'radial') return clampMicroDelay(Math.round(profile.microDelayMs * 0.6))
  return clampMicroDelay(profile.microDelayMs)
}
