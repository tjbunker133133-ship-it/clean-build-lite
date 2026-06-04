/** Fired when operator deletes a waypoint locally (Mission mesh tombstone). */
export const WAYPOINT_REMOVED_EVENT = 'hud:waypoint-removed'

export type WaypointRemovedDetail = { id: string }

export function emitWaypointRemoved(id: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<WaypointRemovedDetail>(WAYPOINT_REMOVED_EVENT, { detail: { id } }),
  )
}
