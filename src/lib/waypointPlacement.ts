import type { WaypointType } from '../types'

/** Map taps may place pins only when undocked and a concrete type is armed. */
export function isWaypointPlacementAllowed(
  docked: boolean,
  pendingType: WaypointType,
): boolean {
  if (docked) return false
  if (pendingType === 'default') return false
  return true
}
