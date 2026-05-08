import type { GpsPowerMode } from '../gpsAdaptivePolicy'

/**
 * Minimum time between breadcrumb samples — scales with adaptive GPS mode
 * so logging cadence follows acquisition rate (battery-aware).
 */
export function breadcrumbIntervalMs(mode: GpsPowerMode | undefined): number {
  switch (mode ?? 'active_navigation') {
    case 'active_navigation':
      return 18_000
    case 'stable_tracking':
      return 42_000
    case 'stationary_low':
      return 95_000
    default:
      return 22_000
  }
}

/** Minimum ground distance (m) before a new crumb is allowed (noise gate). */
export function breadcrumbMinStepMeters(mode: GpsPowerMode | undefined): number {
  switch (mode ?? 'active_navigation') {
    case 'active_navigation':
      return 6
    case 'stable_tracking':
      return 10
    case 'stationary_low':
      return 14
    default:
      return 8
  }
}
