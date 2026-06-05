/**
 * Unified runtime activity throttle — extends runtimeSnapshot lifecycle.
 * ACTIVE / IDLE / BACKGROUND drives sensor poll cadence (no new subsystems).
 */

import type { AppLifecycleState } from './runtimeSnapshot'

export type RuntimeActivityLevel = 'ACTIVE' | 'IDLE' | 'BACKGROUND'

let level: RuntimeActivityLevel = 'ACTIVE'
let lastUserEngagementMs = Date.now()
const IDLE_AFTER_MS = 45_000

export function markRuntimeUserEngagement(): void {
  lastUserEngagementMs = Date.now()
  if (level === 'IDLE') level = 'ACTIVE'
}

export function deriveRuntimeActivityLevel(lifecycle: AppLifecycleState): RuntimeActivityLevel {
  if (lifecycle === 'background' || lifecycle === 'hidden' || lifecycle === 'suspended') {
    return 'BACKGROUND'
  }
  if (Date.now() - lastUserEngagementMs > IDLE_AFTER_MS) {
    return 'IDLE'
  }
  return 'ACTIVE'
}

export function syncRuntimeActivityFromLifecycle(lifecycle: AppLifecycleState): RuntimeActivityLevel {
  level = deriveRuntimeActivityLevel(lifecycle)
  return level
}

export function getRuntimeActivityLevel(): RuntimeActivityLevel {
  return level
}

/** Poll / refresh interval hints for Tier 2 consumers (ms). Tier 1 GPS unchanged. */
export function runtimePollIntervalMs(kind: 'dcrl_sync' | 'ui_refresh' | 'overlay_debounce'): number {
  const activity = getRuntimeActivityLevel()
  if (activity === 'BACKGROUND') {
    if (kind === 'dcrl_sync') return 120_000
    if (kind === 'ui_refresh') return 60_000
    return 2_000
  }
  if (activity === 'IDLE') {
    if (kind === 'dcrl_sync') return 60_000
    if (kind === 'ui_refresh') return 15_000
    return 650
  }
  if (kind === 'dcrl_sync') return 30_000
  if (kind === 'ui_refresh') return 4_000
  return 650
}

export function _resetRuntimeActivityForTests(): void {
  level = 'ACTIVE'
  lastUserEngagementMs = Date.now()
}
