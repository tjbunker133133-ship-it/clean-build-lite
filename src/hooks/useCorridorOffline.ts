import { useEffect, useMemo, useRef, useState } from 'react'
import { useMapContext } from '../context/MapContext'
import { useAppContext } from '../context/AppContext'
import { useGPS } from './useGPS'
import {
  buildCorridorCacheRegion,
  computeRouteFingerprint,
  getOutdoorCorridorTileTemplates,
  loadCorridorCacheRegion,
  prefetchCorridorTiles,
  saveOperationalAreaSeedFromViewport,
  saveCorridorCacheRegion,
  shouldRefreshCorridorPrefetch,
  distanceToCorridorEdgeFeet,
  PREFETCH_MAX_TILES_PER_RUN,
  type CorridorCacheRegion,
} from '../lib/corridorPrefetch'

export type CorridorOfflineState = {
  prefetching: boolean
  lastPrefetchAt: number | null
  edgeDistanceFeet: number | null
  approachingEdge: boolean
}

export function useCorridorOffline(): CorridorOfflineState {
  const { map } = useMapContext()
  const { state } = useAppContext()
  const gps = useGPS()
  const { waypoints, activeLayer } = state

  const [prefetching, setPrefetching] = useState(false)
  const [lastPrefetchAt, setLastPrefetchAt] = useState<number | null>(null)
  const [edgeDistanceFeet, setEdgeDistanceFeet] = useState<number | null>(null)
  const regionRef = useRef<CorridorCacheRegion | null>(loadCorridorCacheRegion())
  const prefetchLockRef = useRef(false)
  const failureStreakRef = useRef(0)
  const cooldownUntilRef = useRef(0)

  const route = useMemo(
    () =>
      waypoints
        .filter((w) => w.status !== 'archived')
        .map((w) => ({ lat: w.lat, lng: w.lng })),
    [waypoints],
  )

  const routeFingerprint = useMemo(() => computeRouteFingerprint(route), [route])

  useEffect(() => {
    if (gps.lat == null || gps.lng == null) return
    const region = regionRef.current
    if (!region?.bounds) {
      setEdgeDistanceFeet(null)
      return
    }
    const edgeFt = distanceToCorridorEdgeFeet(gps.lat, gps.lng, region.bounds)
    setEdgeDistanceFeet(edgeFt)
  }, [gps.lat, gps.lng])

  useEffect(() => {
    saveOperationalAreaSeedFromViewport()
  }, [gps.lat, gps.lng])

  useEffect(() => {
    if (!map || (typeof navigator !== 'undefined' && !navigator.onLine)) return
    if (activeLayer !== 'outdoor') return
    if (gps.lat == null || gps.lng == null) return
    if (route.length < 2) return

    const templates = getOutdoorCorridorTileTemplates()
    if (templates.length === 0) return

    if (
      !shouldRefreshCorridorPrefetch(
        gps.lat,
        gps.lng,
        regionRef.current,
        routeFingerprint,
      )
    ) {
      return
    }
    if (prefetchLockRef.current) return
    if (Date.now() < cooldownUntilRef.current) return

    prefetchLockRef.current = true
    setPrefetching(true)

    const run = async () => {
      try {
        const regionDraft = buildCorridorCacheRegion(route, gps.lat!, gps.lng!, 0)
        if (!regionDraft) return
        const loaded = await prefetchCorridorTiles(templates, regionDraft.bounds, {
          maxTiles: PREFETCH_MAX_TILES_PER_RUN,
        })
        const priorTiles = regionRef.current?.tilesLoaded ?? 0
        const region: CorridorCacheRegion = {
          ...regionDraft,
          tilesLoaded: priorTiles + loaded,
        }
        saveCorridorCacheRegion(region)
        regionRef.current = region
        setLastPrefetchAt(region.updatedAt)
        failureStreakRef.current = 0
        cooldownUntilRef.current = 0
      } catch {
        failureStreakRef.current = Math.min(6, failureStreakRef.current + 1)
        const backoffMs = Math.min(15 * 60_000, 20_000 * 2 ** (failureStreakRef.current - 1))
        cooldownUntilRef.current = Date.now() + backoffMs
      } finally {
        prefetchLockRef.current = false
        setPrefetching(false)
      }
    }

    void run()
  }, [map, gps.lat, gps.lng, route, routeFingerprint, activeLayer])

  const approachingEdge =
    edgeDistanceFeet != null && edgeDistanceFeet > 0 && edgeDistanceFeet < 1500

  return {
    prefetching,
    lastPrefetchAt,
    edgeDistanceFeet,
    approachingEdge,
  }
}
