import { useEffect } from 'react'
import { useAppContext } from '../context/AppContext'
import { useGPS } from '../hooks/useGPS'
import { haversineMeters } from '../lib/haversine'
import { breadcrumbIntervalMs, breadcrumbMinStepMeters } from '../lib/movement/breadcrumbIntervalMs'
import { appendBreadcrumbPoint, getBreadcrumbSessionSnapshot } from '../lib/movement/breadcrumbSessionStore'
import { WAYPOINT_ARRIVAL_RADIUS_M } from '../lib/waypointInteraction'

/** Distance from pin center before an `arrived` pin is considered left (session movement only). */
const DEPART_COMPLETE_M = Math.round(WAYPOINT_ARRIVAL_RADIUS_M * 1.45)

/**
 * Subscribes to GPS output and maintains breadcrumb session + waypoint departure
 * (`arrived` → `completed`). Does not alter GPS acquisition or waypoint geometry.
 */
export default function MovementIntelligenceBridge() {
  const gps = useGPS()
  const { state, updateWaypoint } = useAppContext()
  const { waypoints } = state

  useEffect(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    if (gps.locationState !== 'granted') return
    if (gps.lat == null || gps.lng == null) return
    if (gps.positionSource === 'interpolated') return

    const mode = gps.gpsPowerMode ?? 'active_navigation'
    const intervalMs = breadcrumbIntervalMs(mode)
    const minStepM = breadcrumbMinStepMeters(mode)
    const now = Date.now()
    const pts = getBreadcrumbSessionSnapshot().points
    const last = pts.length > 0 ? pts[pts.length - 1] : null
    let shouldAppend = true
    if (last) {
      const dt = now - last.t
      const d = haversineMeters(last.lat, last.lng, gps.lat, gps.lng)
      const farEnoughInTime = dt >= intervalMs && d >= 8
      const movedEnough = d >= minStepM
      shouldAppend = farEnoughInTime || movedEnough
    }
    if (shouldAppend) {
      appendBreadcrumbPoint(gps.lat, gps.lng, now)
    }
  }, [gps.lat, gps.lng, gps.locationState, gps.positionSource, gps.gpsPowerMode])

  useEffect(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    if (gps.locationState !== 'granted') return
    if (gps.lat == null || gps.lng == null) return
    if (gps.positionSource === 'interpolated') return

    for (const wp of waypoints) {
      const life = wp.lifecycle ?? 'active'
      if (life !== 'arrived') continue
      const m = haversineMeters(gps.lat, gps.lng, wp.lat, wp.lng)
      if (m > DEPART_COMPLETE_M) {
        updateWaypoint(wp.id, { lifecycle: 'completed' })
      }
    }
  }, [gps.lat, gps.lng, gps.locationState, gps.positionSource, waypoints, updateWaypoint])

  return null
}
