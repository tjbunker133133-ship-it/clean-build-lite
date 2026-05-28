import { useEffect, useRef, useState } from 'react'
import { useMapContext } from '../context/MapContext'
import { useAppContext } from '../context/AppContext'
import { useGPS } from './useGPS'
import {
  buildCorridorCacheRegion,
  extractOutdoorTileUrls,
  loadCorridorCacheRegion,
  prefetchCorridorTiles,
  saveOperationalAreaSeedFromViewport,
  saveCorridorCacheRegion,
  shouldRefreshCorridorPrefetch,
  distanceToCorridorEdgeFeet,
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
    // Preserve recently viewed operational areas for offline revisit hints.
    saveOperationalAreaSeedFromViewport()
  }, [gps.lat, gps.lng])

  useEffect(() => {
    if (!map || typeof navigator !== 'undefined' && !navigator.onLine) return
    if (activeLayer !== 'outdoor') return
    if (gps.lat == null || gps.lng == null) return

    const route = waypoints
      .filter((w) => w.status !== 'archived')
      .map((w) => ({ lat: w.lat, lng: w.lng }))
    if (route.length < 2) return

    if (!shouldRefreshCorridorPrefetch(gps.lat, gps.lng, regionRef.current)) return
    if (prefetchLockRef.current) return
    if (Date.now() < cooldownUntilRef.current) return

    prefetchLockRef.current = true
    setPrefetching(true)

    const run = async () => {
      try {
        const region = buildCorridorCacheRegion(route, gps.lat!, gps.lng!)
        if (!region) return
        const style = map.getStyle()
        const templates = extractOutdoorTileUrls(style)
        await prefetchCorridorTiles(templates, region.bounds, { maxTiles: 40 })
        saveCorridorCacheRegion(region)
        regionRef.current = region
        setLastPrefetchAt(region.updatedAt)
        failureStreakRef.current = 0
        cooldownUntilRef.current = 0
      } catch {
        // Back off when connectivity is unstable to avoid repeated failed network bursts.
        failureStreakRef.current = Math.min(6, failureStreakRef.current + 1)
        const backoffMs = Math.min(15 * 60_000, 20_000 * 2 ** (failureStreakRef.current - 1))
        cooldownUntilRef.current = Date.now() + backoffMs
      } finally {
        prefetchLockRef.current = false
        setPrefetching(false)
      }
    }

    void run()
  }, [map, gps.lat, gps.lng, waypoints, activeLayer])

  const approachingEdge =
    edgeDistanceFeet != null && edgeDistanceFeet > 0 && edgeDistanceFeet < 1500

  return {
    prefetching,
    lastPrefetchAt,
    edgeDistanceFeet,
    approachingEdge,
  }
}
