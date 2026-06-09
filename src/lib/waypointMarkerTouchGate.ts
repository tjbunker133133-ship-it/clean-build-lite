import { setRadialInteractionActive } from './mapInteractionController'

/** True while the operator is touching a map waypoint marker (drag / delete). */
let active = false
/** Grace window so map touchend does not place a pin right after marker release (iOS). */
let suppressUntil = 0
/** True while radial menu is active - blocks map pan/zoom/pointer interactions */
let radialMenuActive = false
/** Grace window after radial action/dismiss — blocks map click → waypoint drop. */
let radialActionSuppressUntil = 0

export function setWaypointMarkerTouchActive(next: boolean): void {
  active = next
  suppressUntil = Date.now() + (next ? 1200 : 500)
}

export function isWaypointMarkerTouchActive(): boolean {
  return active || Date.now() < suppressUntil
}

/** Set radial menu active state - blocks map interactions while menu is open */
export function setRadialMenuActive(next: boolean): void {
  radialMenuActive = next
  setRadialInteractionActive(next)
}

/** Check if radial menu is currently active (blocks map interactions) */
export function isRadialMenuActive(): boolean {
  return radialMenuActive
}

/** Call when radial completes an action or dismisses — suppresses map placement clicks. */
export function markRadialMenuInteractionGrace(ms = 900): void {
  radialActionSuppressUntil = Date.now() + ms
}

export function isRadialMenuInteractionGraceActive(): boolean {
  return Date.now() < radialActionSuppressUntil
}

/** True when map taps/clicks should not place waypoints or fire trail inspect. */
export function shouldSuppressMapTapPlacement(): boolean {
  return isRadialMenuActive() || isRadialMenuInteractionGraceActive()
}

export { shouldBlockWaypointPlacement, shouldBlockLongPress } from './mapInteractionController'
