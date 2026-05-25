import { distancePointToRouteFeet, HALF_CORRIDOR_FEET } from './corridor'
import { haversineDistance } from './haversine'

/** Fallback deviation threshold when no trail/route geometry exists (~0.5 mile). */
export const OFF_ROUTE_FALLBACK_FEET = 2640

export type OffRouteResult = {
  offRoute: boolean
  distanceFeet: number
  thresholdFeet: number
  advisory: string | null
}

/**
 * Advisory off-route detection — never reroutes or modifies waypoints.
 * Uses trail/route polyline when available; otherwise pin-to-pin path with 0.5 mi fallback.
 */
export function detectOffRoute(
  userLat: number,
  userLng: number,
  route: Array<{ lat: number; lng: number }>,
  options?: {
    hasTrailGeometry?: boolean
    halfCorridorFeet?: number
  },
): OffRouteResult {
  const point = { lat: userLat, lng: userLng }
  const hasTrail = options?.hasTrailGeometry === true && route.length >= 2
  const halfCorridor = options?.halfCorridorFeet ?? HALF_CORRIDOR_FEET

  if (route.length === 0) {
    return {
      offRoute: false,
      distanceFeet: Infinity,
      thresholdFeet: OFF_ROUTE_FALLBACK_FEET,
      advisory: null,
    }
  }

  if (route.length === 1) {
    const { feet } = haversineDistance(userLat, userLng, route[0].lat, route[0].lng)
    const thresholdFeet = OFF_ROUTE_FALLBACK_FEET
    const offRoute = feet > thresholdFeet
    return {
      offRoute,
      distanceFeet: feet,
      thresholdFeet,
      advisory: offRoute ? 'Off route — far from next waypoint path' : null,
    }
  }

  const distanceFeet = distancePointToRouteFeet(point, route)
  const thresholdFeet = hasTrail ? halfCorridor : OFF_ROUTE_FALLBACK_FEET
  const offRoute = distanceFeet > thresholdFeet

  return {
    offRoute,
    distanceFeet,
    thresholdFeet,
    advisory: offRoute
      ? hasTrail
        ? 'Off route — outside corridor band'
        : 'Off route — exceeded path deviation'
      : null,
  }
}

export function corridorEdgeAlert(severity: number): string | null {
  if (severity >= 5) return 'Approaching offline map edge'
  if (severity >= 3) return 'Near corridor edge'
  return null
}
