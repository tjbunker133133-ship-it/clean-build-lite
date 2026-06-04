import { useEffect, useRef } from 'react'
import type { Map } from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import { useOverlayContext } from '../context/OverlayContext'
import { ENVIRONMENTAL_OVERLAY_CATALOG, overlayDef } from '../lib/environmentalOverlays/catalog'
import {
  applyGeojsonOverlay,
  applyRasterOverlay,
  mapBboxFromMap,
  removeEnvironmentalOverlay,
} from '../lib/environmentalOverlays/mapOverlayRuntime'
import { readCachedOverlayGeo, writeCachedOverlayGeo } from '../lib/environmentalOverlays/overlayCache'
import { fetchOverpassGeojson } from '../lib/environmentalOverlays/overpass'
import { readFirmsMapKey } from '../lib/environmentalOverlays/sources'
import type { EnvironmentalOverlayId } from '../lib/environmentalOverlays/types'

const MOVE_DEBOUNCE_MS = 650

function syncOverlay(
  map: Map,
  id: EnvironmentalOverlayId,
  enabled: boolean,
  online: boolean,
  patchStatus: ReturnType<typeof useOverlayContext>['patchStatus'],
): () => void {
  if (!enabled) {
    removeEnvironmentalOverlay(map, id)
    patchStatus(id, { loading: false, error: null, stale: false, fromCache: false })
    return () => {}
  }

  const def = overlayDef(id)
  let cancelled = false

  const run = async () => {
    if (!map.isStyleLoaded()) return
    const bbox = mapBboxFromMap(map)

    if (def.delivery === 'raster-wms') {
      if (!online) {
        removeEnvironmentalOverlay(map, id)
        patchStatus(id, {
          loading: false,
          error: 'Requires network (not cached)',
          stale: false,
          fromCache: false,
        })
        return
      }
      if (id === 'fire_firms' && !readFirmsMapKey()) {
        removeEnvironmentalOverlay(map, id)
        patchStatus(id, { loading: false, error: 'FIRMS MAP_KEY missing', stale: false, fromCache: false })
        return
      }
      const ok = applyRasterOverlay(map, id)
      patchStatus(id, {
        loading: false,
        error: ok ? null : 'Layer unavailable',
        stale: false,
        fromCache: false,
      })
      return
    }

    patchStatus(id, { loading: true, error: null })

    if (!online && def.offlineCacheable) {
      const cached = readCachedOverlayGeo(id, bbox)
      if (cached) {
        applyGeojsonOverlay(map, id, cached.geojson)
        patchStatus(id, {
          loading: false,
          error: null,
          stale: true,
          fromCache: true,
        })
        return
      }
      removeEnvironmentalOverlay(map, id)
      patchStatus(id, {
        loading: false,
        error: 'Offline — pan here online once to cache',
        stale: false,
        fromCache: false,
      })
      return
    }

    if (!online) {
      removeEnvironmentalOverlay(map, id)
      patchStatus(id, { loading: false, error: 'Requires network', stale: false, fromCache: false })
      return
    }

    try {
      const geojson = await fetchOverpassGeojson(id, bbox)
      if (cancelled) return
      applyGeojsonOverlay(map, id, geojson)
      if (def.offlineCacheable) {
        writeCachedOverlayGeo({ overlayId: id, bbox, fetchedAt: Date.now(), geojson })
      }
      patchStatus(id, {
        loading: false,
        error: geojson.features.length === 0 ? 'No features in this view' : null,
        stale: false,
        fromCache: false,
      })
    } catch (e) {
      if (cancelled) return
      const cached = def.offlineCacheable ? readCachedOverlayGeo(id, bbox) : null
      if (cached) {
        applyGeojsonOverlay(map, id, cached.geojson)
        patchStatus(id, {
          loading: false,
          error: null,
          stale: true,
          fromCache: true,
        })
        return
      }
      removeEnvironmentalOverlay(map, id)
      patchStatus(id, {
        loading: false,
        error: e instanceof Error ? e.message : 'Load failed',
        stale: false,
        fromCache: false,
      })
    }
  }

  const onStyle = () => void run()
  if (map.isStyleLoaded()) void run()
  else map.once('styledata', onStyle)

  return () => {
    cancelled = true
    map.off('styledata', onStyle)
  }
}

export default function EnvironmentalOverlaysLayer() {
  const { map } = useMapContext()
  const { toggles, online, patchStatus } = useOverlayContext()
  const patchRef = useRef(patchStatus)
  patchRef.current = patchStatus
  const moveTimerRef = useRef<number | null>(null)
  const cleanupRef = useRef<Partial<Record<EnvironmentalOverlayId, () => void>>>({})

  useEffect(() => {
    if (!map) return

    const refreshAll = () => {
      for (const def of ENVIRONMENTAL_OVERLAY_CATALOG) {
        cleanupRef.current[def.id]?.()
        cleanupRef.current[def.id] = syncOverlay(map, def.id, toggles[def.id], online, patchRef.current)
      }
    }

    refreshAll()

    const onMoveEnd = () => {
      if (moveTimerRef.current != null) window.clearTimeout(moveTimerRef.current)
      moveTimerRef.current = window.setTimeout(() => {
        moveTimerRef.current = null
        for (const def of ENVIRONMENTAL_OVERLAY_CATALOG) {
          if (!toggles[def.id] || def.delivery !== 'geojson-overpass') continue
          cleanupRef.current[def.id]?.()
          cleanupRef.current[def.id] = syncOverlay(map, def.id, true, online, patchRef.current)
        }
      }, MOVE_DEBOUNCE_MS)
    }

    map.on('moveend', onMoveEnd)

    return () => {
      map.off('moveend', onMoveEnd)
      if (moveTimerRef.current != null) {
        window.clearTimeout(moveTimerRef.current)
        moveTimerRef.current = null
      }
      for (const id of Object.keys(cleanupRef.current) as EnvironmentalOverlayId[]) {
        cleanupRef.current[id]?.()
        delete cleanupRef.current[id]
        removeEnvironmentalOverlay(map, id)
      }
    }
  }, [map, toggles, online])

  return null
}
