import React, { useEffect, useRef } from 'react'
import type { Map } from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import { useOverlayContext } from '../context/OverlayContext'
import { ENVIRONMENTAL_OVERLAY_CATALOG, ENVIRONMENTAL_OVERLAY_IDS, overlayDef } from '../lib/environmentalOverlays/catalog'
// Overlay debug API - side-effect import extends __hudDebug for E2E testing
import '../runtime/overlayDebug'
/** Map subsystems mount via ModernMapSubsystems / BalancedMapSubsystems per mode stack. */
import {
  applyGeojsonOverlay,
  applyRasterOverlay,
  environmentalOverlayOnMap,
  mapBboxFromMap,
  mapStyleMutable,
  overlayZoomBlocked,
  reattachEnvironmentalOverlay,
  removeEnvironmentalOverlay,
} from '../lib/environmentalOverlays/mapOverlayRuntime'
import { readCachedOverlayGeo, writeCachedOverlayGeo } from '../lib/environmentalOverlays/overlayCache'
import {
  estimateOverpassLoadingBudgetMs,
  fetchOverpassGeojson,
  getOverpassQueueStats,
} from '../lib/environmentalOverlays/overpass'
import { readEnvKey } from '../lib/environmentalOverlays/sources'
import type { EnvironmentalOverlayId } from '../lib/environmentalOverlays/types'
import {
  clearLoadingTimeout,
  clearOverlaySession,
  createOverlaySession,
  ensureLoadingTimeoutAtLeast,
  getActiveOverlaySession,
  isOverlayFetchInFlight,
  isSessionActive,
  resolveOverlay,
  startLoading,
  stateMachineToLegacy,
  type TerminalState,
} from '../lib/environmentalOverlays/overlayStateMachine'
import { runtimePollIntervalMs } from '../runtime/runtimeActivityPolicy'
import { logWarn } from '../runtime/logger'
import { verifyOverlayRendered } from '../lib/environmentalOverlays/mapOverlayRuntime'
import { traceOverlay } from '../runtime/runtimeForensics'
import {
  logModernGuardrailApplied,
  logModernGuardrailTransition,
  shouldDeferDetailOverlay,
} from '../lib/modernLayerGuardrails'

logModernGuardrailApplied('EnvironmentalOverlaysLayer')

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
    traceOverlay('overlay_disabled', { overlayId: id })
    removeEnvironmentalOverlay(map, id)
    clearLoadingTimeout(id)
    clearOverlaySession(id)
    patchStatus(id, { loading: false, error: null, stale: false, fromCache: false })
    traceOverlay('cleanup_called', { overlayId: id, reason: 'disabled' })
    return () => {}
  }

  traceOverlay('overlay_enabled', { overlayId: id, online })
  const def = overlayDef(id)

  // Create unique session for this activation to prevent race conditions
  const sessionId = createOverlaySession(id)
  traceOverlay('session_created', { overlayId: id, sessionId: sessionId.slice(0, 8) })

  let styleWaitCleanup: (() => void) | null = null

  // Central state resolver - ALL paths MUST use this
  const resolveState = (state: TerminalState) => {
    // Trace specific terminal state
    switch (state.state) {
      case 'READY':
        traceOverlay('ready_committed', { overlayId: id, sessionId: sessionId.slice(0, 8), featureCount: state.featureCount })
        break
      case 'SYNCING':
        traceOverlay('syncing_committed', { overlayId: id, sessionId: sessionId.slice(0, 8), message: state.message, featureCount: state.featureCount })
        break
      case 'EMPTY':
        traceOverlay('empty_committed', { overlayId: id, sessionId: sessionId.slice(0, 8), message: state.message })
        break
      case 'ERROR':
        traceOverlay('error_committed', { overlayId: id, sessionId: sessionId.slice(0, 8), error: state.error.slice(0, 50) })
        break
      case 'OFFLINE_FALLBACK':
        traceOverlay('offline_fallback_committed', { overlayId: id, sessionId: sessionId.slice(0, 8), cachedAt: state.cachedAt })
        break
      case 'IDLE':
        traceOverlay('idle_committed', { overlayId: id, sessionId: sessionId.slice(0, 8) })
        break
    }
    resolveOverlay(id, sessionId, state)
    // Convert to legacy format for React state
    patchStatus(id, stateMachineToLegacy(state))
  }

  // Start loading with automatic 30s timeout enforcement
  // Timeout will automatically call resolveState on expiry
  patchStatus(id, stateMachineToLegacy(startLoading(id, sessionId, resolveState)))

  // Track if cleanup was called to prevent double-resolution
  let isCleanedUp = false
  const safeResolve = (state: TerminalState) => {
    if (isCleanedUp) {
      traceOverlay('stale_result_ignored', { overlayId: id, sessionId: sessionId.slice(0, 8), attemptedState: state.state })
      return
    }
    isCleanedUp = true
    resolveState(state)
  }

  const run = async () => {
    // Validate session before proceeding
    if (!isSessionActive(id, sessionId)) {
      safeResolve({ state: 'IDLE', enabled: false })
      return // Session invalidated, abort
    }

    // Wait for map style to be ready
    if (!mapStyleMutable(map)) {
      traceOverlay('style_wait_started', { overlayId: id, sessionId: sessionId.slice(0, 8) })
      let styleWaitTimeout: number | null = null
      const onReady = () => {
        traceOverlay('style_wait_resolved', { overlayId: id, sessionId: sessionId.slice(0, 8), event: 'styledata/idle' })
        // Validate session before proceeding
        if (!isSessionActive(id, sessionId) || !mapStyleMutable(map)) {
          if (isSessionActive(id, sessionId)) {
            traceOverlay('session_invalidated', { overlayId: id, sessionId: sessionId.slice(0, 8), reason: 'style_ready_but_session_dead' })
            safeResolve({ state: 'ERROR', enabled: true, error: 'Map style not ready' })
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
        if (styleWaitTimeout !== null) {
          window.clearTimeout(styleWaitTimeout)
          styleWaitTimeout = null
        }
      }
      // Set up a fallback timeout for style wait (5s max)
      styleWaitTimeout = window.setTimeout(() => {
        styleWaitTimeout = null
        if (isSessionActive(id, sessionId) && !mapStyleMutable(map)) {
          traceOverlay('style_wait_timeout', { overlayId: id, sessionId: sessionId.slice(0, 8) })
          logWarn('OVERLAY', `${id}: Style wait timeout, forcing error state [session: ${sessionId.slice(0, 8)}]`)
          safeResolve({ state: 'ERROR', enabled: true, error: 'Map initialization timeout' })
        }
        styleWaitCleanup?.()
        styleWaitCleanup = null
      }, 5000)
      return
    }
    styleWaitCleanup?.()
    styleWaitCleanup = null
    traceOverlay('style_wait_resolved', { overlayId: id, sessionId: sessionId.slice(0, 8), reason: 'already_ready' })

    // Validate session before proceeding with zoom check
    if (!isSessionActive(id, sessionId)) {
      traceOverlay('session_invalidated', { overlayId: id, sessionId: sessionId.slice(0, 8), phase: 'pre_zoom_check' })
      safeResolve({ state: 'IDLE', enabled: false })
      return
    }

    // Check zoom gate
    const zoomGate = overlayZoomBlocked(map, id)
    if (zoomGate.blocked) {
      traceOverlay('zoom_blocked', { overlayId: id, sessionId: sessionId.slice(0, 8), message: zoomGate.message })
      removeEnvironmentalOverlay(map, id)
      safeResolve({ state: 'EMPTY', enabled: true, message: zoomGate.message ?? 'Zoom in to load this layer' })
      return
    }

    const bbox = mapBboxFromMap(map)

    // Raster WMS overlays
    if (def.delivery === 'raster-wms') {
      traceOverlay('fetch_started', { overlayId: id, sessionId: sessionId.slice(0, 8), delivery: 'raster-wms' })
      if (!online) {
        traceOverlay('fetch_threw', { overlayId: id, sessionId: sessionId.slice(0, 8), reason: 'offline_no_cache' })
        removeEnvironmentalOverlay(map, id)
        safeResolve({ state: 'ERROR', enabled: true, error: 'Requires network (not cached)' })
        return
      }
      // Config-driven API key check (any overlay can require an env key)
      if (def.envKey && !readEnvKey(def.envKey)) {
        traceOverlay('fetch_threw', { overlayId: id, sessionId: sessionId.slice(0, 8), reason: 'api_key_missing' })
        removeEnvironmentalOverlay(map, id)
        safeResolve({ state: 'ERROR', enabled: false, error: `${def.label} API key missing — add ${def.envKey} and redeploy` })
        return
      }
      traceOverlay('raster_apply_attempt', { overlayId: id, sessionId: sessionId.slice(0, 8) })
      const ok = applyRasterOverlay(map, id)
      traceOverlay(ok ? 'raster_apply_success' : 'raster_apply_fail', { overlayId: id, sessionId: sessionId.slice(0, 8) })
      if (ok) {
        safeResolve({ state: 'READY', enabled: true, featureCount: 0 }) // Raster overlays don't have feature count
      } else {
        safeResolve({ state: 'ERROR', enabled: true, error: 'Layer unavailable — retry or check network' })
      }
      return
    }

    // GeoJSON overlays
    if (!online && def.offlineCacheable) {
      traceOverlay('fetch_started', { overlayId: id, sessionId: sessionId.slice(0, 8), delivery: 'geojson-cache', online: false })
      const cached = readCachedOverlayGeo(id, bbox)
      if (cached) {
        traceOverlay('fetch_resolved', { overlayId: id, sessionId: sessionId.slice(0, 8), fromCache: true, cachedAt: cached.fetchedAt })
        traceOverlay('geojson_apply_attempt', { overlayId: id, sessionId: sessionId.slice(0, 8), fromCache: true })
        if (applyGeojsonOverlay(map, id, cached.geojson)) {
          safeResolve({
            state: 'OFFLINE_FALLBACK',
            enabled: true,
            cachedAt: cached.fetchedAt,
            message: 'Offline — showing cached data'
          })
        } else {
          traceOverlay('raster_apply_fail', { overlayId: id, sessionId: sessionId.slice(0, 8), reason: 'applyGeojsonOverlay_returned_false' })
          safeResolve({ state: 'ERROR', enabled: true, error: 'Map still loading — try again' })
        }
        return
      }
      traceOverlay('fetch_threw', { overlayId: id, sessionId: sessionId.slice(0, 8), reason: 'no_cache_available' })
      removeEnvironmentalOverlay(map, id)
      safeResolve({ state: 'EMPTY', enabled: true, message: 'Offline — pan here online once to cache' })
      return
    }

    if (!online) {
      traceOverlay('fetch_threw', { overlayId: id, sessionId: sessionId.slice(0, 8), reason: 'offline_not_cacheable' })
      removeEnvironmentalOverlay(map, id)
      safeResolve({ state: 'ERROR', enabled: true, error: 'Requires network' })
      return
    }

    // Fetch online data
    traceOverlay('fetch_started', { overlayId: id, sessionId: sessionId.slice(0, 8), delivery: 'geojson-overpass', bbox })
    try {
      const { pending, inFlight } = getOverpassQueueStats()
      const queueAhead = pending + inFlight
      const budgetMs = estimateOverpassLoadingBudgetMs(queueAhead)
      ensureLoadingTimeoutAtLeast(id, sessionId, budgetMs)
      traceOverlay('overpass_loading_timeout_extended', {
        overlayId: id,
        queueAhead,
        budgetMs,
      })
      const geojson = await fetchOverpassGeojson(id, bbox)
      traceOverlay('fetch_resolved', { overlayId: id, sessionId: sessionId.slice(0, 8), featureCount: geojson.features.length })

      // Validate session before applying result
      if (!isSessionActive(id, sessionId)) {
        traceOverlay('session_invalidated', { overlayId: id, sessionId: sessionId.slice(0, 8), phase: 'post_fetch' })
        safeResolve({ state: 'IDLE', enabled: false })
        return // Stale session, abort
      }

      traceOverlay('geojson_apply_attempt', { overlayId: id, sessionId: sessionId.slice(0, 8) })
      if (!applyGeojsonOverlay(map, id, geojson)) {
        traceOverlay('raster_apply_fail', { overlayId: id, sessionId: sessionId.slice(0, 8), reason: 'applyGeojsonOverlay_returned_false' })
        safeResolve({ state: 'ERROR', enabled: true, error: 'Map still loading — try again' })
        return
      }

      if (def.offlineCacheable) {
        writeCachedOverlayGeo({ overlayId: id, bbox, fetchedAt: Date.now(), geojson })
      }

      // RENDER VERIFICATION FIX: Don't commit to READY until we verify actual rendered features
      // This prevents false-positive READY state when layers attach but don't render
      if (geojson.features.length === 0) {
        safeResolve({ state: 'EMPTY', enabled: true, message: 'No features in this view — zoom in or pan to trail/bike areas' })
      } else {
        // Initial state: SYNCING (not READY yet)
        safeResolve({ state: 'SYNCING', enabled: true, message: 'Rendering features...', featureCount: geojson.features.length })

        // VERIFY ACTUAL RENDER before committing to READY
        window.setTimeout(async () => {
          if (!isSessionActive(id, sessionId)) return
          const renderCheck = await verifyOverlayRendered(map, id)
          traceOverlay('delayed_render_verification', {
            overlayId: id,
            sessionId: sessionId.slice(0, 8),
            renderCount: renderCheck.renderCount,
            sourceFeatureCount: renderCheck.sourceFeatureCount,
            visible: renderCheck.visible,
            issues: renderCheck.issues,
          })

          // Re-check session validity before committing state update
          if (!isSessionActive(id, sessionId)) return

          // State transition based on actual render verification
          if (renderCheck.renderCount > 0) {
            // SUCCESS: Features actually rendered
            traceOverlay('render_confirmed', { overlayId: id, sessionId: sessionId.slice(0, 8), renderCount: renderCheck.renderCount })
            safeResolve({ state: 'READY', enabled: true, featureCount: renderCheck.sourceFeatureCount })
          } else if (renderCheck.sourceFeatureCount > 0) {
            // FAIL: Source has features but none rendered in viewport
            traceOverlay('features_not_rendering', {
              overlayId: id,
              sessionId: sessionId.slice(0, 8),
              possibleCauses: renderCheck.issues,
              zoom: renderCheck.zoom,
              minZoom: renderCheck.minZoom,
            })
            // Stay in SYNCING state with guidance - user may need to zoom/pan
            safeResolve({ state: 'SYNCING', enabled: true, message: `Features loaded but not visible — ${renderCheck.issues.join(', ')}`, featureCount: renderCheck.sourceFeatureCount })
          } else {
            // Source empty (shouldn't happen given earlier check, but handle gracefully)
            safeResolve({ state: 'EMPTY', enabled: true, message: 'No features in this view — zoom in or pan to trail/bike areas' })
          }
        }, 500) // Allow time for MapLibre to render
      }
    } catch (e) {
      traceOverlay('fetch_threw', { overlayId: id, sessionId: sessionId.slice(0, 8), error: (e as Error).message })

      // Prefer cache fallback even after spurious cleanup invalidated the session
      traceOverlay('offline_fallback_attempt', { overlayId: id, sessionId: sessionId.slice(0, 8) })
      const cached = def.offlineCacheable ? readCachedOverlayGeo(id, bbox) : null
      if (cached && applyGeojsonOverlay(map, id, cached.geojson)) {
        const fallback: TerminalState = {
          state: 'OFFLINE_FALLBACK',
          enabled: true,
          cachedAt: cached.fetchedAt,
        }
        if (isSessionActive(id, sessionId) && !isCleanedUp) {
          safeResolve(fallback)
        } else {
          patchStatus(id, stateMachineToLegacy(fallback))
          traceOverlay('offline_fallback_after_cleanup', {
            overlayId: id,
            sessionId: sessionId.slice(0, 8),
            cachedAt: cached.fetchedAt,
          })
        }
        return
      }

      // Validate session before applying error
      if (!isSessionActive(id, sessionId)) {
        traceOverlay('session_invalidated', { overlayId: id, sessionId: sessionId.slice(0, 8), phase: 'post_fetch_error' })
        safeResolve({ state: 'IDLE', enabled: false })
        return // Stale session, abort
      }

      removeEnvironmentalOverlay(map, id)
      const errorMsg = e instanceof Error ? e.message : 'Load failed'
      const isAbort =
        (e instanceof DOMException && e.name === 'AbortError') ||
        errorMsg.toLowerCase().includes('abort') ||
        errorMsg.toLowerCase().includes('cancelled')
      if (isAbort) {
        safeResolve({ state: 'IDLE', enabled: false })
        return
      }
      safeResolve({ state: 'ERROR', enabled: true, error: errorMsg })
    }
  }

  void run()
  traceOverlay('run_started', { overlayId: id, sessionId: sessionId.slice(0, 8) })

  return () => {
    traceOverlay('cleanup_called', { overlayId: id, sessionId: sessionId.slice(0, 8) })
    // ALWAYS resolve to terminal state on cleanup - guarantees no stuck loading
    safeResolve({ state: 'IDLE', enabled: false })
    clearLoadingTimeout(id)
    clearOverlaySession(id)
    styleWaitCleanup?.()
    styleWaitCleanup = null
  }
}

function togglesKey(toggles: Record<EnvironmentalOverlayId, boolean>): string {
  return ENVIRONMENTAL_OVERLAY_IDS.map((id) => (toggles[id] ? '1' : '0')).join('')
}

export default function EnvironmentalOverlaysLayer() {
  const { map } = useMapContext()
  const { toggles, online, patchStatus } = useOverlayContext()
  const patchRef = useRef(patchStatus)
  patchRef.current = patchStatus
  const togglesRef = useRef(toggles)
  togglesRef.current = toggles
  const onlineRef = useRef(online)
  onlineRef.current = online
  const moveTimerRef = useRef<number | null>(null)
  const styleRafRef = useRef<number | null>(null)
  const styleRehydrateTimerRef = useRef<number | null>(null)
  const cleanupRef = useRef<Partial<Record<EnvironmentalOverlayId, () => void>>>({})
  const prevTogglesKeyRef = useRef<string | null>(null)
  const prevOnlineRef = useRef<boolean | null>(null)
  const syncOneRef = useRef<(id: EnvironmentalOverlayId, enabled: boolean, force?: boolean) => void>(() => {})

  const toggleKey = togglesKey(toggles)

  /** Toggle/online sync only — must NOT tear down unchanged overlays on re-run. */
  useEffect(() => {
    if (!map) return

    const syncOne = (id: EnvironmentalOverlayId, enabled: boolean, force = false) => {
      if (enabled) {
        if (!force && environmentalOverlayOnMap(map, id)) return
        if (!force && cleanupRef.current[id]) return
        // In-flight Overpass fetch — reattach only; never abort with a duplicate session
        if (isOverlayFetchInFlight(id) && getActiveOverlaySession(id)) {
          if (reattachEnvironmentalOverlay(map, id)) return
          traceOverlay('sync_skipped_in_flight', { overlayId: id })
          return
        }
        if (force) {
          if (reattachEnvironmentalOverlay(map, id)) return
          if (cleanupRef.current[id]) {
            traceOverlay('sync_skipped_in_flight', { overlayId: id, reason: 'rehydrate_wait' })
            return
          }
        }
      }
      cleanupRef.current[id]?.()
      delete cleanupRef.current[id]
      if (!enabled) {
        logModernGuardrailTransition('overlay-toggle', { overlayId: id, enabled: false })
        removeEnvironmentalOverlay(map, id)
        return
      }

      const def = overlayDef(id)
      const isDetail = (def.renderMode ?? 'detail') === 'detail'
      const activeDetailCount = ENVIRONMENTAL_OVERLAY_IDS.filter((oid) => {
        if (oid === id || !togglesRef.current[oid]) return false
        return (overlayDef(oid).renderMode ?? 'detail') === 'detail'
      }).length
      if (isDetail && shouldDeferDetailOverlay(activeDetailCount)) {
        logModernGuardrailTransition('overlay-toggle-deferred', {
          overlayId: id,
          activeDetailCount,
        })
        patchRef.current(id, {
          loading: false,
          error: 'Too many detail layers — disable one or zoom in',
          stale: false,
          fromCache: false,
        })
        return
      }

      logModernGuardrailTransition('overlay-toggle', { overlayId: id, enabled: true })
      cleanupRef.current[id] = syncOverlay(map, id, true, onlineRef.current, patchRef.current)
    }
    syncOneRef.current = syncOne

    const prevKey = prevTogglesKeyRef.current
    const prevOnline = prevOnlineRef.current
    prevTogglesKeyRef.current = toggleKey
    prevOnlineRef.current = online

    if (prevKey === null) {
      for (const def of ENVIRONMENTAL_OVERLAY_CATALOG) {
        syncOne(def.id, toggles[def.id])
      }
    } else if (prevKey !== toggleKey) {
      for (const def of ENVIRONMENTAL_OVERLAY_CATALOG) {
        const was = prevKey[ENVIRONMENTAL_OVERLAY_IDS.indexOf(def.id)] === '1'
        const now = toggles[def.id]
        if (was !== now) syncOne(def.id, now)
      }
    } else if (prevOnline !== online) {
      for (const def of ENVIRONMENTAL_OVERLAY_CATALOG) {
        if (toggles[def.id]) syncOne(def.id, true)
      }
    }
  }, [map, toggleKey, online])

  /** Map listeners — basemap style changes and pan/zoom refresh. */
  useEffect(() => {
    if (!map) return

    /** Re-attach only overlays missing from the map (after basemap setStyle). */
    const rehydrateMissingOverlays = () => {
      for (const def of ENVIRONMENTAL_OVERLAY_CATALOG) {
        if (!togglesRef.current[def.id]) continue
        if (environmentalOverlayOnMap(map, def.id)) continue
        if (reattachEnvironmentalOverlay(map, def.id)) continue
        if (isOverlayFetchInFlight(def.id) && getActiveOverlaySession(def.id)) {
          traceOverlay('rehydrate_deferred_in_flight', { overlayId: def.id })
          continue
        }
        if (cleanupRef.current[def.id]) continue
        syncOneRef.current(def.id, true)
      }
    }

    const scheduleRehydrate = () => {
      if (styleRafRef.current != null) window.cancelAnimationFrame(styleRafRef.current)
      styleRafRef.current = window.requestAnimationFrame(() => {
        styleRafRef.current = null
        rehydrateMissingOverlays()
      })
    }

    /**
     * Basemap setStyle() wipes custom layers — defer until idle so we do not
     * re-sync while our own addLayer calls are still committing.
     */
    const onStyleLoad = () => {
      const anyOn = ENVIRONMENTAL_OVERLAY_CATALOG.some((d) => togglesRef.current[d.id])
      if (!anyOn) return
      if (styleRehydrateTimerRef.current != null) {
        window.clearTimeout(styleRehydrateTimerRef.current)
      }
      styleRehydrateTimerRef.current = window.setTimeout(() => {
        styleRehydrateTimerRef.current = null
        const run = () => scheduleRehydrate()
        if (map.isStyleLoaded()) {
          map.once('idle', run)
        } else {
          run()
        }
      }, 250)
    }

    map.on('style.load', onStyleLoad)

    const onMoveEnd = () => {
      if (moveTimerRef.current != null) window.clearTimeout(moveTimerRef.current)
      moveTimerRef.current = window.setTimeout(() => {
        moveTimerRef.current = null
        for (const def of ENVIRONMENTAL_OVERLAY_CATALOG) {
          if (!togglesRef.current[def.id] || def.delivery !== 'geojson-overpass') continue
          if (cleanupRef.current[def.id]) continue
          syncOneRef.current(def.id, true)
        }
      }, runtimePollIntervalMs('overlay_debounce'))
    }

    map.on('moveend', onMoveEnd)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        scheduleRehydrate()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      map.off('style.load', onStyleLoad)
      map.off('moveend', onMoveEnd)
      if (moveTimerRef.current != null) {
        window.clearTimeout(moveTimerRef.current)
        moveTimerRef.current = null
      }
      if (styleRafRef.current != null) {
        window.cancelAnimationFrame(styleRafRef.current)
        styleRafRef.current = null
      }
      if (styleRehydrateTimerRef.current != null) {
        window.clearTimeout(styleRehydrateTimerRef.current)
        styleRehydrateTimerRef.current = null
      }
    }
  }, [map])

  /** Full overlay teardown only when map instance unmounts. */
  useEffect(() => {
    if (!map) return
    return () => {
      for (const id of Object.keys(cleanupRef.current) as EnvironmentalOverlayId[]) {
        cleanupRef.current[id]?.()
        delete cleanupRef.current[id]
        removeEnvironmentalOverlay(map, id)
      }
      prevTogglesKeyRef.current = null
      prevOnlineRef.current = null
    }
  }, [map])

  return null
}
