import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppContext } from '../context/AppContext'
import { useTrailRoute } from '../context/TrailRouteContext'
import { useGPS } from './useGPS'
import { corridorSeverity } from '../lib/corridor'
import { formatDistance, haversineDistance } from '../lib/haversine'
import { GpsConfidenceTracker, gpsConfidenceLabel, type GpsConfidenceState } from '../lib/gpsConfidence'
import { corridorEdgeAlert, detectOffRoute } from '../lib/offRoute'
import {
  checkArrivalCandidate,
  distanceToActiveWaypoint,
  type ArrivalCandidate,
} from '../lib/waypointNavigation'
import { ingestNavigationGpsSample } from '../lib/snapTrack/snapDiagnostics'

export type NavigationMonitorState = {
  activeDistanceMiles: number | null
  activeDistanceLabel: string | null
  activeWaypointLabel: string | null
  arrivalCandidate: ArrivalCandidate | null
  trailDistanceMiles: number | null
  trailDistanceLabel: string | null
  offRouteAdvisory: string | null
  corridorAlert: string | null
  gpsConfidence: GpsConfidenceState
  gpsConfidenceLabel: string
}

const EMPTY_CONFIDENCE: GpsConfidenceState = {
  level: 'unknown',
  unstable: false,
  avgAccuracyM: null,
}

export function useNavigationMonitor(): NavigationMonitorState {
  const gps = useGPS()
  const { state } = useAppContext()
  const { waypoints, snapToTrailEnabled } = state
  const trailRoute = useTrailRoute()

  const trackerRef = useRef(new GpsConfidenceTracker())
  const [gpsConfidence, setGpsConfidence] = useState<GpsConfidenceState>(EMPTY_CONFIDENCE)
  const [arrivalCandidate, setArrivalCandidate] = useState<ArrivalCandidate | null>(null)
  const [offRouteAdvisory, setOffRouteAdvisory] = useState<string | null>(null)
  const [corridorAlert, setCorridorAlert] = useState<string | null>(null)

  const activeNav = useMemo(() => {
    if (gps.lat == null || gps.lng == null) return null
    return distanceToActiveWaypoint(gps.lat, gps.lng, waypoints)
  }, [gps.lat, gps.lng, waypoints])

  const hasTrailGeometry =
    snapToTrailEnabled &&
    trailRoute.legs.some((leg) => leg.mode === 'trail' && leg.points.length >= 3)

  const trailDistance = useMemo(() => {
    if (!hasTrailGeometry || trailRoute.coordinates.length < 2) return null
    if (gps.lat == null || gps.lng == null) return null
    const activeIdx = waypoints.findIndex((w) => w.status === 'active')
    if (activeIdx < 0) return null
    const slice = trailRoute.coordinates.slice(0, activeIdx + 1)
    if (slice.length < 2) return null
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < slice.length; i++) {
      const [lng, lat] = slice[i]
      const { feet } = haversineDistance(gps.lat, gps.lng, lat, lng)
      if (feet < bestDist) {
        bestDist = feet
        bestIdx = i
      }
    }
    let remainM = 0
    for (let i = bestIdx; i < slice.length - 1; i++) {
      const [lngA, latA] = slice[i]
      const [lngB, latB] = slice[i + 1]
      remainM += haversineDistance(latA, lngA, latB, lngB).miles
    }
    const toActive = activeNav
      ? haversineDistance(gps.lat, gps.lng, activeNav.waypoint.lat, activeNav.waypoint.lng).miles
      : 0
    return remainM + toActive
  }, [hasTrailGeometry, trailRoute.coordinates, gps.lat, gps.lng, waypoints, activeNav])

  useEffect(() => {
    if (gps.lat == null || gps.lng == null) {
      setArrivalCandidate(null)
      setOffRouteAdvisory(null)
      setCorridorAlert(null)
      return
    }

    setArrivalCandidate(checkArrivalCandidate(gps.lat, gps.lng, waypoints))

    const pinRoute = waypoints
      .filter((w) => w.status !== 'archived')
      .map((w) => ({ lat: w.lat, lng: w.lng }))
    const hasTrail = hasTrailGeometry
    const routeForOffRoute = hasTrail
      ? trailRoute.coordinates.map(([lng, lat]) => ({ lat, lng }))
      : pinRoute

    const offRoute = detectOffRoute(gps.lat, gps.lng, routeForOffRoute, { hasTrailGeometry: hasTrail })
    setOffRouteAdvisory(offRoute.advisory)

    const distFeet = hasTrail
      ? offRoute.distanceFeet
      : offRoute.distanceFeet
    const severity = corridorSeverity(distFeet)
    setCorridorAlert(corridorEdgeAlert(severity))

    const conf = trackerRef.current.ingest({
      lat: gps.lat,
      lng: gps.lng,
      accuracy: gps.accuracy,
      timestampMs: Date.now(),
    })
    setGpsConfidence(conf)

    ingestNavigationGpsSample({
      lat: gps.lat,
      lng: gps.lng,
      accuracy: gps.accuracy,
      timestampMs: Date.now(),
      source: gps.source,
    })
  }, [gps.lat, gps.lng, gps.accuracy, gps.source, waypoints, hasTrailGeometry, trailRoute.coordinates])

  return {
    activeDistanceMiles: activeNav?.miles ?? null,
    activeDistanceLabel: activeNav ? formatDistance(activeNav.miles) : null,
    activeWaypointLabel: activeNav?.waypoint.label ?? null,
    arrivalCandidate,
    trailDistanceMiles: trailDistance,
    trailDistanceLabel: trailDistance != null ? formatDistance(trailDistance) : null,
    offRouteAdvisory,
    corridorAlert,
    gpsConfidence,
    gpsConfidenceLabel: gpsConfidenceLabel(gpsConfidence),
  }
}
