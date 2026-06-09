/**
 * Balanced map tool bridge — syncs workspace tool state into mapInteractionController.
 */

import {
  armWaypointDrop,
  getInteractionMode,
  syncBalancedTool,
} from './mapInteractionController'

export type BalancedMapTool = 'inspect' | 'route' | 'waypoint' | 'measure' | 'none'

export function setBalancedActiveTool(tool: BalancedMapTool): void {
  syncBalancedTool(tool)
}

/** Single OSG transition: drop mode + armed type (panel icon pick). */
export function armBalancedWaypointDrop(type: string): void {
  armWaypointDrop('balanced', type)
}

export function getBalancedActiveTool(): BalancedMapTool {
  const mode = getInteractionMode()
  if (mode === 'drop') return 'waypoint'
  if (mode === 'measure' || mode === 'route' || mode === 'inspect') return mode
  return 'none'
}

/** @deprecated Measure taps route through mapInteractionController.routeMapClick */
export function setBalancedMeasureTapHandler(_handler: ((lat: number, lng: number) => void) | null): void {
  /* no-op — geometry owned by mapInteractionController */
}

/** @deprecated */
export function dispatchBalancedMeasureTap(lat: number, lng: number): boolean {
  return false
}
