import { useEffect, useRef } from 'react'
import type { Map } from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import { useOverlayContext } from '../context/OverlayContext'
import { ENVIRONMENTAL_OVERLAY_CATALOG, overlayDef } from '../lib/environmentalOverlays/catalog'
import {
  applyGeojsonOverlay,
  applyRasterOverlay,
  mapBboxFromMap,
  mapStyleMutable,
  overlayZoomBlocked,
  removeEnvironmentalOverlay,
} from '../lib/environmentalOverlays/mapOverlayRuntime'
import { readCachedOverlayGeo, writeCachedOverlayGeo } from '../lib/environmentalOverlays/overlayCache'
import { fetchOverpassGeojson } from '../lib/environmentalOverlays/overpass'
import { readEnvKey } from '../lib/environmentalOverlays/sources'
import type { EnvironmentalOverlayId } from '../lib/environmentalOverlays/types'
import {
  clearLoadingTimeout,
  clearOverlaySession,
  createOverlaySession,
  isSessionActive,
  resolveOverlay,
  startLoading,
  stateMachineToLegacy,
  type TerminalState,
} from '../lib/environmentalOverlays/overlayStateMachine'
import { runtimePollIntervalMs } from '../runtime/runtimeActivityPolicy'
import { logWarn } from '../runtime/logger'

/**
 * Sync overlay with strict state machine enforcement.
 * GUARANTEE: Loading always resolves to terminal state within 30s.
 * 
 * Every activation gets a unique session ID to prevent race conditions.
 * Every path MUST resolve to a terminal state via resolveOverlay.
 */
function syncOverlay(
  map: Map,
  id: EnvironmentalOverlayId,
  enabled: boolean,
  online: boolean,
  patchStatus: ReturnType<typeof useOverlayContext>['patchStatus'],
): () => void {
  if (!enabled) {
    removeEnvironmentalOverlay(map, id)
    clearLoadingTimeout(id)
    clearOverlaySession(id)
    patchStatus(id, { loading: false, error: null, stale: false, fromCache: false })
    return () => {}
  }

  const def = overlayDef(id)
  
  // Create unique session for this activation to prevent race conditions
  const sessionId = createOverlaySession(id)
  
  let styleWaitCleanup: (() => void) | null = null

  // Central state resolver - ALL paths MUST use this
  const resolveState = (state: TerminalState) => {
    resolveOverlay(id, sessionId, state)
    // Convert to legacy format for React state
    patchStatus(id, stateMachineToLegacy(state))
  }

  // Start loading with automatic 30s timeout enforcement
  // Timeout will automatically call resolveState on expiry
  patchStatus(id, stateMachineToLegacy(startLoading(id, sessionId, resolveState)))

  const run = async () => {
    // Validate session before proceeding
    if (!isSessionActive(id, sessionId)) {
      return // Session invalidated, abort
    }

    // Wait for map style to be ready
    if (!mapStyleMutable(map)) {
      const onReady = () => {
        // Validate session before proceeding
        if (!isSessionActive(id, sessionId) || !mapStyleMutable(map)) {
          if (isSessionActive(id, sessionId)) {
            resolveState({ state: 'ERROR', enabled: true, error: 'Map style not ready' })
          }
          return
        }
        void run()
      }
      map.once('styledata', onReady)
      map.once('idle', onReady)
      styleWaitCleanup = () => {
        try {
          map.off('styledata', onReady)
          map.off('idle', onReady)
        } catch {
          /* ignore */
        }
      }
      // Set up a fallback timeout for style wait (5s max)
      const styleWaitTimeout = window.setTimeout(() => {
        if (isSessionActive(id, sessionId) && !mapStyleMutable(map)) {
          logWarn('OVERLAY', `${id}: Style wait timeout, forcing error state [session: ${sessionId.slice(0, 8)}]`)
          resolveState({ state: 'ERROR', enabled: true, error: 'Map initialization timeout' })
        }
      }, 5000)
      return () => {
        window.clearTimeout(styleWaitTimeout)
        styleWaitCleanup?.()
        styleWaitCleanup = null
      }
    }
    styleWaitCleanup?.()
    styleWaitCleanup = null

    // Validate session before proceeding with zoom check
    if (!isSessionActive(id, sessionId)) {
      return
    }

    // Check zoom gate
    const zoomGate = overlayZoomBlocked(map, id)
    if (zoomGate.blocked) {
      removeEnvironmentalOverlay(map, id)
      resolveState({ state: 'EMPTY', enabled: true, message: zoomGate.message ?? 'Zoom in to load this layer' })
      return
    }

    const bbox = mapBboxFromMap(map)

    // Raster WMS overlays
    if (def.delivery === 'raster-wms') {
      if (!online) {
        removeEnvironmentalOverlay(map, id)
        resolveState({ state: 'ERROR', enabled: true, error: 'Requires network (not cached)' })
        return
      }
      // Config-driven API key check (any overlay can require an env key)
      if (def.envKey && !readEnvKey(def.envKey)) {
        removeEnvironmentalOverlay(map, id)
        resolveState({ state: 'ERROR', enabled: false, error: `${def.label} API key missing — add ${def.envKey} and redeploy` })
        return
      }
      const ok = applyRasterOverlay(map, id)
      if (ok) {
        resolveState({ state: 'READY', enabled: true, featureCount: 0 }) // Raster overlays don't have feature count
      } else {
        resolveState({ state: 'ERROR', enabled: true, error: 'Layer unavailable — retry or check network' })
      }
      return
    }

    // GeoJSON overlays
    if (!online && def.offlineCacheable) {
      const cached = readCachedOverlayGeo(id, bbox)
      if (cached) {
        if (applyGeojsonOverlay(map, id, cached.geojson)) {
          resolveState({
            state: 'OFFLINE_FALLBACK',
            enabled: true,
            cachedAt: cached.fetchedAt,
            message: 'Offline — showing cached data'
          })
        } else {
          resolveState({ state: 'ERROR', enabled: true, error: 'Map still loading — try again' })
        }
        return
      }
      removeEnvironmentalOverlay(map, id)
      resolveState({ state: 'EMPTY', enabled: true, message: 'Offline — pan here online once to cache' })
      return
    }

    if (!online) {
      removeEnvironmentalOverlay(map, id)
      resolveState({ state: 'ERROR', enabled: true, error: 'Requires network' })
      return
    }

    // Fetch online data
    try {
      const geojson = await fetchOverpassGeojson(id, bbox)
      
      // Validate session before applying result
      if (!isSessionActive(id, sessionId)) {
        return // Stale session, abort without state change
      }
      
      if (!applyGeojsonOverlay(map, id, geojson)) {
        resolveState({ state: 'ERROR', enabled: true, error: 'Map still loading — try again' })
        return
      }
      if (def.offlineCacheable) {
        writeCachedOverlayGeo({ overlayId: id, bbox, fetchedAt: Date.now(), geojson })
      }
      if (geojson.features.length === 0) {
        resolveState({ state: 'EMPTY', enabled: true, message: 'No features in this view — zoom in or pan to trail/bike areas' })
      } else {
        resolveState({ state: 'READY', enabled: true, featureCount: geojson.features.length })
      }
    } catch (e) {
      // Validate session before applying error
      if (!isSessionActive(id, sessionId)) {
        return // Stale session, abort without state change
      }
      
      // Try fallback to cached
      const cached = def.offlineCacheable ? readCachedOverlayGeo(id, bbox) : null
      if (cached && applyGeojsonOverlay(map, id, cached.geojson)) {
        resolveState({ state: 'OFFLINE_FALLBACK', enabled: true, cachedAt: cached.fetchedAt })
        return
      }
      removeEnvironmentalOverlay(map, id)
      const errorMsg = e instanceof Error ? e.message : 'Load failed'
      resolveState({ state: 'ERROR', enabled: true, error: errorMsg })
    }
  }

  void run()

  return () => {
    // ALWAYS resolve to IDLE on cleanup - guarantees terminal state
    if (isSessionActive(id, sessionId)) {
      resolveState({ state: 'IDLE', enabled: false })
    }
    clearLoadingTimeout(id)
    clearOverlaySession(id)
    styleWaitCleanup?.()
    styleWaitCleanup = null
  }
}

export default function EnvironmentalOverlaysLayer() {
  const { map } = useMapContext()
  const { toggles, online, patchStatus } = useOverlayContext()
  const patchRef = useRef(patchStatus)
  patchRef.current = patchStatus
  const moveTimerRef = useRef<number | null>(null)
  const styleRafRef = useRef<number | null>(null)
  const cleanupRef = useRef<Partial<Record<EnvironmentalOverlayId, () => void>>>({})

  useEffect(() => {
    if (!map) return

    const refreshAll = () => {
      for (const def of ENVIRONMENTAL_OVERLAY_CATALOG) {
        cleanupRef.current[def.id]?.()
        cleanupRef.current[def.id] = syncOverlay(
          map,
          def.id,
          toggles[def.id],
          online,
          patchRef.current,
        )
      }
    }

    const scheduleRefreshAll = () => {
      if (styleRafRef.current != null) window.cancelAnimationFrame(styleRafRef.current)
      styleRafRef.current = window.requestAnimationFrame(() => {
        styleRafRef.current = null
        refreshAll()
      })
    }

    refreshAll()

    /** Basemap setStyle() wipes custom layers — re-apply enabled overlays like RouteLayer does. */
    const onStyleData = () => {
      const anyOn = ENVIRONMENTAL_OVERLAY_CATALOG.some((d) => toggles[d.id])
      if (!anyOn) return
      scheduleRefreshAll()
    }

    map.on('styledata', onStyleData)

    const onMoveEnd = () => {
      if (moveTimerRef.current != null) window.clearTimeout(moveTimerRef.current)
      moveTimerRef.current = window.setTimeout(() => {
        moveTimerRef.current = null
        for (const def of ENVIRONMENTAL_OVERLAY_CATALOG) {
          if (!toggles[def.id] || def.delivery !== 'geojson-overpass') continue
          cleanupRef.current[def.id]?.()
          cleanupRef.current[def.id] = syncOverlay(map, def.id, true, online, patchRef.current)
        }
      }, runtimePollIntervalMs('overlay_debounce'))
    }

    map.on('moveend', onMoveEnd)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        scheduleRefreshAll()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      map.off('styledata', onStyleData)
      map.off('moveend', onMoveEnd)
      if (moveTimerRef.current != null) {
        window.clearTimeout(moveTimerRef.current)
        moveTimerRef.current = null
      }
      if (styleRafRef.current != null) {
        window.cancelAnimationFrame(styleRafRef.current)
        styleRafRef.current = null
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
