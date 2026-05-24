/** True while the operator is touching a map waypoint marker (drag / delete). */
let active = false
/** Grace window so map touchend does not place a pin right after marker release (iOS). */
let suppressUntil = 0

export function setWaypointMarkerTouchActive(next: boolean): void {
  active = next
  suppressUntil = Date.now() + (next ? 1200 : 500)
}

export function isWaypointMarkerTouchActive(): boolean {
  return active || Date.now() < suppressUntil
}
