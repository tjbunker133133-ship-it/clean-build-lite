/**
 * Modern Layer soft guardrails — validation, fallbacks, and transition logging.
 * Additive only; does not change core architecture.
 */

import type { Waypoint } from '../types'

/** Debounce window for route distance recalculation (prevents jitter while dragging). */
export const ROUTE_METRICS_DEBOUNCE_MS = 300

/** Max detail overlays loading concurrently before deferring additional activations. */
export const MAX_CONCURRENT_DETAIL_OVERLAYS = 6

const appliedModules = new Set<string>()

export type RouteStartValidation =
  | { ok: true; waypoints: Waypoint[] }
  | { ok: false; reason: string }

export function logModernGuardrailApplied(module: string): void {
  if (appliedModules.has(module)) return
  appliedModules.add(module)
  if (import.meta.env.DEV) {
    console.info(`modern-layer-guardrail: applied [${module}]`)
  }
}

/** Key state transitions only — avoid log spam. */
export function logModernGuardrailTransition(
  event: string,
  detail?: Record<string, unknown>,
): void {
  if (import.meta.env.DEV) {
    console.info(`modern-layer-guardrail: ${event}`, detail ?? '')
  }
}

export function validateRouteForNavigation(waypoints: Waypoint[]): RouteStartValidation {
  const active = waypoints.filter((w) => w.status !== 'archived')
  if (active.length < 2) {
    return { ok: false, reason: 'Add at least 2 waypoints to navigate' }
  }
  const invalid = active.find(
    (wp) => !Number.isFinite(wp.lat) || !Number.isFinite(wp.lng),
  )
  if (invalid) {
    return { ok: false, reason: 'Route has invalid waypoint coordinates' }
  }
  return { ok: true, waypoints: active }
}

export function shouldDeferDetailOverlay(activeDetailCount: number): boolean {
  return activeDetailCount >= MAX_CONCURRENT_DETAIL_OVERLAYS
}

export function trailInfoStub(lat: number, lng: number): {
  name: string
  detail: string
  disclaimer: string
} {
  return {
    name: 'Unnamed trail',
    detail: `Trail segment near ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    disclaimer: 'Map trail data is for planning only. Verify conditions locally.',
  }
}
