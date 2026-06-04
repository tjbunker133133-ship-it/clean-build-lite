import type { WearableSignal } from './types'
import { WAL_SIGNAL_BYPASS_THROTTLE, WAL_SIGNAL_THROTTLE_MS } from './walRuntimeConfig'

export type SignalThrottleState = Map<string, number>

export function createSignalThrottleState(): SignalThrottleState {
  return new Map()
}

function throttleKey(signal: WearableSignal): string {
  return `${signal.type}:${signal.sourceDevice}`
}

export function shouldIngestSignal(
  signal: WearableSignal,
  state: SignalThrottleState,
  nowMs: number = Date.now(),
): boolean {
  if (WAL_SIGNAL_BYPASS_THROTTLE.has(signal.type)) return true

  const key = throttleKey(signal)
  const minGap = WAL_SIGNAL_THROTTLE_MS[signal.type] ?? 15_000
  const last = state.get(key)
  if (last != null && nowMs - last < minGap) return false
  state.set(key, nowMs)
  return true
}

/** @internal test helper */
export function _resetSignalThrottleForTests(): void {
  /* state is per-runtime instance */
}
