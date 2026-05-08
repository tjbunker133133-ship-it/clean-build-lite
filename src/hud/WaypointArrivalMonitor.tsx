import { useEffect } from 'react'
import { useAppContext } from '../context/AppContext'
import { useGPS } from '../hooks/useGPS'
import { haversineMeters } from '../lib/haversine'
import { WAYPOINT_ARRIVAL_RADIUS_M } from '../lib/waypointInteraction'

/**
 * Promotes waypoints to arrived when GPS is within threshold.
 * Uses existing haversine distance (read-only); does not alter GPS plumbing.
 */
export default function WaypointArrivalMonitor() {
  const { state, updateWaypoint } = useAppContext()
  const { waypoints } = state
  const gps = useGPS()

  useEffect(() => {
    if (gps.lat == null || gps.lng == null || gps.locationState !== 'granted') return
    if (!waypoints.length) return

    for (const wp of waypoints) {
      const life = wp.lifecycle ?? 'active'
      if (life === 'completed' || life === 'arrived') continue
      const m = haversineMeters(gps.lat, gps.lng, wp.lat, wp.lng)
      if (m <= WAYPOINT_ARRIVAL_RADIUS_M) {
        updateWaypoint(wp.id, { lifecycle: 'arrived' })
      }
    }
  }, [gps.lat, gps.lng, gps.locationState, waypoints, updateWaypoint])

  return null
}
