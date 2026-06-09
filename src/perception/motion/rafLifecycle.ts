/**
 * rAF lifecycle guard — production hardening for animation loops.
 * Pauses heavy work when backgrounded; tracks loop health for diagnostics.
 */

import { getRuntimeActivityLevel } from '../../runtime/runtimeActivityPolicy'
import { getPowerAdjustedMaxFps } from '../../runtime/fieldPowerProfile'

let activeLoopCount = 0
let skippedBackgroundTicks = 0
let totalTicks = 0

export function isPageVisible(): boolean {
  if (typeof document === 'undefined') return true
  return document.visibilityState === 'visible'
}

export function shouldRunHeavyAnimation(reducedMotion = false): boolean {
  if (reducedMotion) return false
  return isPageVisible()
}

/** Adaptive FPS cap from runtime activity + field power profile — thermal / battery friendly. */
export function getAdaptiveAnimationMaxFps(baseMaxFps: number): number {
  if (!isPageVisible()) return 0
  const activity = getRuntimeActivityLevel()
  if (activity === 'BACKGROUND') return 0
  let cap = getPowerAdjustedMaxFps(baseMaxFps, activity)
  if (activity === 'IDLE') cap = Math.min(cap, 12)
  return cap
}

export function recordBackgroundSkip(): void {
  skippedBackgroundTicks++
}

export function recordRafTick(): void {
  totalTicks++
}

export function getRafLifecycleStats(): {
  activeLoopCount: number
  skippedBackgroundTicks: number
  totalTicks: number
  pageVisible: boolean
} {
  return {
    activeLoopCount,
    skippedBackgroundTicks,
    totalTicks,
    pageVisible: isPageVisible(),
  }
}

export type ManagedRafOptions = {
  /** Cap update rate (e.g. 30 for atmospheric continuity). */
  maxFps?: number
  /** Skip ticks when tab is hidden instead of running heavy work. */
  pauseWhenHidden?: boolean
}

/**
 * Managed rAF loop with visibility guard and optional FPS cap.
 * Returns cancel function — MUST be called on unmount.
 */
export function startManagedRafLoop(
  onTick: (nowMs: number, dtSec: number) => void,
  options: ManagedRafOptions = {},
): () => void {
  const { maxFps = 60, pauseWhenHidden = true } = options
  let rafId: number | null = null
  let lastMs = 0
  let lastTickMs = 0
  let cancelled = false

  activeLoopCount++

  const loop = (now: number) => {
    if (cancelled) return

    if (pauseWhenHidden && !isPageVisible()) {
      recordBackgroundSkip()
      rafId = requestAnimationFrame(loop)
      return
    }

    const effectiveFps = getAdaptiveAnimationMaxFps(maxFps)
    if (effectiveFps <= 0) {
      recordBackgroundSkip()
      rafId = requestAnimationFrame(loop)
      return
    }

    const minIntervalMs = 1000 / effectiveFps
    if (now - lastTickMs < minIntervalMs * 0.9) {
      rafId = requestAnimationFrame(loop)
      return
    }

    const dtSec = lastMs > 0 ? Math.min((now - lastMs) / 1000, 0.1) : 1 / 60
    lastMs = now
    lastTickMs = now
    recordRafTick()
    onTick(now, dtSec)
    rafId = requestAnimationFrame(loop)
  }

  rafId = requestAnimationFrame(loop)

  return () => {
    cancelled = true
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    activeLoopCount = Math.max(0, activeLoopCount - 1)
  }
}

export function __resetRafLifecycleStatsForTests(): void {
  activeLoopCount = 0
  skippedBackgroundTicks = 0
  totalTicks = 0
}
