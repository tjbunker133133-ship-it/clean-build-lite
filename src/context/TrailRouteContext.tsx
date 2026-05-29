import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useMapContext } from './MapContext'
import { useAppContext } from './AppContext'
import { computeTrailRoute, type TrailRouteResult } from '../lib/trailRoute'

const EMPTY_ROUTE: TrailRouteResult = {
  coordinates: [],
  legs: [],
  totalDistance: { miles: 0, feet: 0 },
  allTrail: false,
}

const TrailRouteContext = createContext<TrailRouteResult>(EMPTY_ROUTE)

export function TrailRouteProvider({ children }: { children: ReactNode }) {
  const { map } = useMapContext()
  const { state } = useAppContext()
  const { waypoints, snapToTrailEnabled, trailSnapAssistCapable } = state
  /** Trail-following route line only when operator enabled snap (pin-to-pin otherwise). */
  const trailFollowEnabled = waypoints.length >= 2 && snapToTrailEnabled

  const [route, setRoute] = useState<TrailRouteResult>(EMPTY_ROUTE)
  const waypointsRef = useRef(waypoints)
  waypointsRef.current = waypoints
  const enabledRef = useRef(trailFollowEnabled)
  enabledRef.current = trailFollowEnabled

  useEffect(() => {
    const recompute = () => {
      const wps = waypointsRef.current.filter((w) => w.status !== 'archived')
      if (!enabledRef.current || wps.length < 2) {
        setRoute(computeTrailRoute(null, wps, false))
        return
      }
      if (!map) {
        setRoute(computeTrailRoute(null, wps, false))
        return
      }
      setRoute(computeTrailRoute(map, wps, true))
    }

    recompute()

    if (!map || waypoints.length < 2 || !trailFollowEnabled) return

    let tileRetryId: number | null = null
    const onMapChange = () => {
      window.requestAnimationFrame(recompute)
      if (tileRetryId != null) window.clearTimeout(tileRetryId)
      tileRetryId = window.setTimeout(() => {
        tileRetryId = null
        recompute()
      }, 450)
    }
    map.on('moveend', onMapChange)
    map.on('zoomend', onMapChange)
    map.on('idle', onMapChange)
    return () => {
      if (tileRetryId != null) window.clearTimeout(tileRetryId)
      map.off('moveend', onMapChange)
      map.off('zoomend', onMapChange)
      map.off('idle', onMapChange)
    }
  }, [map, waypoints, trailFollowEnabled, snapToTrailEnabled, trailSnapAssistCapable])

  const value = useMemo(() => route, [route])

  return <TrailRouteContext.Provider value={value}>{children}</TrailRouteContext.Provider>
}

export function useTrailRoute(): TrailRouteResult {
  return useContext(TrailRouteContext)
}
