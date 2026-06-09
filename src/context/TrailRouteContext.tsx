import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useMapContext } from './MapContext'
import { useAppContext } from './AppContext'
import { computeTrailRoute, type TrailRouteResult } from '../lib/trailRoute'
import {
  getOsgRouteWaypointsSnapshot,
  subscribeOsgRouteWaypoints,
} from '../lib/osgRouteWaypointCache'

const EMPTY_ROUTE: TrailRouteResult = {
  coordinates: [],
  legs: [],
  totalDistance: { miles: 0, feet: 0 },
  allTrail: false,
}

const TrailRouteContext = createContext<TrailRouteResult>(EMPTY_ROUTE)

/** Pure derived projection — no local geometry authority. */
export function TrailRouteProvider({ children }: { children: ReactNode }) {
  const { map } = useMapContext()
  const { state } = useAppContext()
  const waypoints = useSyncExternalStore(
    subscribeOsgRouteWaypoints,
    getOsgRouteWaypointsSnapshot,
    getOsgRouteWaypointsSnapshot,
  )
  const trailFollowEnabled = waypoints.length >= 2 && state.snapToTrailEnabled

  const [mapRevision, setMapRevision] = useState(0)

  useEffect(() => {
    if (!map || waypoints.length < 2 || !trailFollowEnabled) return
    const bump = () => setMapRevision((n) => n + 1)
    map.on('moveend', bump)
    map.on('zoomend', bump)
    map.on('idle', bump)
    return () => {
      map.off('moveend', bump)
      map.off('zoomend', bump)
      map.off('idle', bump)
    }
  }, [map, waypoints.length, trailFollowEnabled])

  const value = useMemo(() => {
    const wps = waypoints.filter((w) => w.status !== 'archived')
    if (wps.length < 2 || !trailFollowEnabled) {
      return computeTrailRoute(null, wps, false)
    }
    if (!map) return computeTrailRoute(null, wps, false)
    return computeTrailRoute(map, wps, true)
    // mapRevision triggers recompute when tiles load
  }, [map, waypoints, trailFollowEnabled, mapRevision, state.trailSnapAssistCapable])

  return <TrailRouteContext.Provider value={value}>{children}</TrailRouteContext.Provider>
}

export function useTrailRoute(): TrailRouteResult {
  return useContext(TrailRouteContext)
}
