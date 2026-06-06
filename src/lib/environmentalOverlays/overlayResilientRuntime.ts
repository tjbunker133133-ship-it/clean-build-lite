/**
 * OVERLAY RESILIENT RUNTIME — Network-independent overlay rendering
 *
 * ARCHITECTURE: Local-first hybrid model
 * 1. RENDER IMMEDIATELY from bundled seed data (ALWAYS succeeds)
 * 2. ENHANCE IN BACKGROUND from Overpass (optional, silent failure)
 *
 * STATE MACHINE: IDLE → VISIBLE → [ENHANCED]
 * - No loading states
 * - No timeout errors
 * - No network dependency for visibility
 */

import type { Map } from 'maplibre-gl'
import { traceOverlay } from '../../runtime/runtimeForensics'
import { overlayDef } from './catalog'
import {
  applyGeojsonOverlay,
  envLayerId,
  envSourceId,
  mapStyleMutable,
  removeEnvironmentalOverlay,
} from './mapOverlayRuntime'
import { fetchOverpassGeojson } from './overpass'
import { getOverlaySeedData, hasOverlaySeedData, mergeSeedWithEnhanced } from './seedData'
import type { EnvironmentalOverlayId } from './types'

const LOG_PREFIX = '[overlay]'

// ============================================================================
// SOFT GUARDRAIL: Enhancement Session Tracking
// Prevents stale promise resolutions from updating unmounted/unrelated overlays
// ============================================================================

// Use globalThis.Map to avoid collision with imported Map type from maplibre-gl
const activeEnhancementSessions = new globalThis.Map<EnvironmentalOverlayId, AbortController>()

/** Cancel any in-flight enhancement for this overlay */
export function cancelEnhancementSession(overlayId: EnvironmentalOverlayId): void {
  const session = activeEnhancementSessions.get(overlayId)
  if (session) {
    session.abort()
    activeEnhancementSessions.delete(overlayId)
    traceOverlay('enhance_session_cancelled', { overlayId })
  }
}

/** Track a new enhancement session for potential cancellation */
function trackEnhancementSession(overlayId: EnvironmentalOverlayId): AbortController {
  // Cancel any existing session first
  cancelEnhancementSession(overlayId)

  const controller = new AbortController()
  activeEnhancementSessions.set(overlayId, controller)
  return controller
}

/** Clean up completed session tracking */
function untrackEnhancementSession(overlayId: EnvironmentalOverlayId): void {
  activeEnhancementSessions.delete(overlayId)
}

/** Check if session was aborted (for use in promise handlers) */
function isEnhancementSessionAborted(overlayId: EnvironmentalOverlayId): boolean {
  const session = activeEnhancementSessions.get(overlayId)
  return !session || session.signal.aborted
}

/**
 * Render overlay from local seed data — ALWAYS succeeds, NEVER blocks on network.
 * This is the PRIMARY render path.
 */
export function renderOverlayFromSeed(
  map: Map,
  id: EnvironmentalOverlayId,
): { rendered: boolean; featureCount: number; hasSeedData: boolean } {
  traceOverlay('render_seed_start', { overlayId: id })

  // Check map readiness (fast fail)
  if (!mapStyleMutable(map)) {
    traceOverlay('render_seed_style_not_ready', { overlayId: id })
    return { rendered: false, featureCount: 0, hasSeedData: false }
  }

  const seedData = getOverlaySeedData(id)
  const hasSeed = hasOverlaySeedData(id)

  traceOverlay('render_seed_data_check', { overlayId: id, hasSeed, featureCount: seedData.features.length })

  // Even if seed is empty, we still try to render (layer will exist, just empty)
  const success = applyGeojsonOverlay(map, id, seedData)

  if (success) {
    traceOverlay('render_seed_complete', { overlayId: id, featureCount: seedData.features.length, hasSeed })
  } else {
    traceOverlay('render_seed_failed', { overlayId: id })
  }

  return {
    rendered: success,
    featureCount: seedData.features.length,
    hasSeedData: hasSeed,
  }
}

/**
 * Background enhancement — fetches live data and updates existing layer.
 * SILENT FAILURE: If this fails, overlay stays visible with seed data.
 * No UI feedback, no error states.
 * 
 * GUARDRAIL: Uses AbortController to prevent stale updates after deactivation
 */
export async function enhanceOverlayFromNetwork(
  map: Map,
  id: EnvironmentalOverlayId,
  bbox: { south: number; north: number; east: number; west: number },
  online: boolean,
): Promise<{ enhanced: boolean; finalFeatureCount: number }> {
  // Skip if offline or map not ready
  if (!online) {
    traceOverlay('enhance_skipped_offline', { overlayId: id })
    return { enhanced: false, finalFeatureCount: 0 }
  }

  if (!mapStyleMutable(map)) {
    traceOverlay('enhance_skipped_map_not_ready', { overlayId: id })
    return { enhanced: false, finalFeatureCount: 0 }
  }

  // Skip if no layer exists (seed render failed)
  const layerId = envLayerId(id)
  if (!map.getLayer(layerId)) {
    traceOverlay('enhance_skipped_no_layer', { overlayId: id })
    return { enhanced: false, finalFeatureCount: 0 }
  }

  // GUARDRAIL: Track this session for potential cancellation
  const abortController = trackEnhancementSession(id)

  traceOverlay('enhance_fetch_start', { overlayId: id, bbox })

  try {
    const enhanced = await fetchOverpassGeojson(id, bbox, abortController.signal)

    // GUARDRAIL: Check if aborted before proceeding with state update
    if (isEnhancementSessionAborted(id)) {
      traceOverlay('enhance_aborted_after_fetch', { overlayId: id })
      untrackEnhancementSession(id)
      return { enhanced: false, finalFeatureCount: 0 }
    }

    // Validate we got meaningful data
    if (!enhanced.features || enhanced.features.length === 0) {
      traceOverlay('enhance_empty_response', { overlayId: id })
      untrackEnhancementSession(id)
      return { enhanced: false, finalFeatureCount: 0 }
    }

    traceOverlay('enhance_fetch_success', { overlayId: id, featureCount: enhanced.features.length })

    // Merge with existing seed data
    const seedData = getOverlaySeedData(id)
    const merged = mergeSeedWithEnhanced(seedData, enhanced)

    // GUARDRAIL: Double-check aborted before map state mutation
    if (isEnhancementSessionAborted(id)) {
      traceOverlay('enhance_aborted_before_update', { overlayId: id })
      untrackEnhancementSession(id)
      return { enhanced: false, finalFeatureCount: 0 }
    }

    // Update the source with merged data
    const sourceId = envSourceId(id)
    const source = map.getSource(sourceId) as { setData?: (data: GeoJSON.FeatureCollection) => void } | undefined

    if (source && typeof source.setData === 'function') {
      source.setData(merged)
      traceOverlay('enhance_source_updated', { overlayId: id, mergedFeatureCount: merged.features.length })
    } else {
      traceOverlay('enhance_source_not_found', { overlayId: id })
    }

    untrackEnhancementSession(id)
    return { enhanced: true, finalFeatureCount: merged.features.length }
  } catch (err) {
    // Check if this was an abort (expected during deactivation)
    if (abortController.signal.aborted) {
      traceOverlay('enhance_cancelled_expected', { overlayId: id })
      untrackEnhancementSession(id)
      return { enhanced: false, finalFeatureCount: 0 }
    }

    // SILENT FAILURE: Log but don't break UI
    const errorMsg = err instanceof Error ? err.message : String(err)
    traceOverlay('enhance_failed_silent', { overlayId: id, error: errorMsg.slice(0, 100) })
    untrackEnhancementSession(id)
    // Overlay remains visible with seed data
    return { enhanced: false, finalFeatureCount: 0 }
  }
}

/**
 * Simplified overlay activation — deterministic, no blocking states.
 *
 * Flow:
 * 1. Render from seed (immediate)
 * 2. If online and zoom appropriate, enhance in background (optional)
 */
export function activateOverlayResilient(
  map: Map,
  id: EnvironmentalOverlayId,
  online: boolean,
  zoom: number,
): { visible: boolean; backgroundEnhance: Promise<{ enhanced: boolean; finalFeatureCount: number }> | null } {
  const def = overlayDef(id)

  // Check zoom gate (deterministic, fast)
  const minZoom = def.minZoom ?? 0
  if (zoom + 0.05 < minZoom) {
    traceOverlay('resilient_zoom_blocked', { overlayId: id, zoom, minZoom })
    return { visible: false, backgroundEnhance: null }
  }

  // STEP 1: Render from seed (ALWAYS happens)
  const seedResult = renderOverlayFromSeed(map, id)

  // STEP 2: Schedule background enhancement (NEVER blocks visibility)
  let enhancePromise: Promise<{ enhanced: boolean; finalFeatureCount: number }> | null = null

  if (online && seedResult.rendered) {
    // Get current bbox for enhancement query
    try {
      const bounds = map.getBounds()
      const bbox = {
        south: bounds.getSouth(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
      }

      // Fire-and-forget enhancement
      enhancePromise = enhanceOverlayFromNetwork(map, id, bbox, online)
    } catch {
      traceOverlay('resilient_enhance_bypassed', { overlayId: id, reason: 'bbox_error' })
    }
  }

  traceOverlay('resilient_activated', {
    overlayId: id,
    visible: seedResult.rendered,
    seedFeatures: seedResult.featureCount,
    hasEnhancement: enhancePromise != null,
  })

  return {
    visible: seedResult.rendered,
    backgroundEnhance: enhancePromise,
  }
}

/**
 * Clean removal of overlay.
 * GUARDRAIL: Also cancels any in-flight enhancement session.
 */
export function deactivateOverlayResilient(map: Map, id: EnvironmentalOverlayId): void {
  traceOverlay('resilient_deactivated', { overlayId: id })
  // GUARDRAIL: Cancel any pending enhancement before removal
  cancelEnhancementSession(id)
  removeEnvironmentalOverlay(map, id)
}
