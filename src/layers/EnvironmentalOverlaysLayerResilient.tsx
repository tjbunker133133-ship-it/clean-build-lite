/**
 * Environmental Overlays Layer — Resilient Network-Independent Version
 *
 * OVERLAY ARCHITECTURE: Local-first hybrid
 * - RENDER: Immediate from bundled seed data (always succeeds)
 * - ENHANCE: Background Overpass fetch (optional, silent failure)
 *
 * NO loading states. NO timeout errors. NO network dependency for visibility.
 */

import { useEffect, useRef } from 'react'
import type { Map } from 'maplibre-gl'
import { useMapContext } from '../context/MapContext'
import { useOverlayContext } from '../context/OverlayContext'
import { ENVIRONMENTAL_OVERLAY_CATALOG } from '../lib/environmentalOverlays/catalog'
import {
  activateOverlayResilient,
  deactivateOverlayResilient,
} from '../lib/environmentalOverlays/overlayResilientRuntime'
import { traceOverlay } from '../runtime/runtimeForensics'

// GUARDRAIL: Cleanup verification counter for diagnostics
let cleanupVerificationCounter = 0

export default function EnvironmentalOverlaysLayerResilient() {
  const { map } = useMapContext()
  const { toggles, online } = useOverlayContext()
  const activeOverlaysRef = useRef<Set<string>>(new Set())
  const zoomRef = useRef<number>(0)
  // GUARDRAIL: Track activations in progress to prevent duplicate requests
  const activationInProgressRef = useRef<Set<string>>(new Set())

  // Track zoom level for overlay gates
  useEffect(() => {
    if (!map) return

    const updateZoom = () => {
      try {
        const z = map.getZoom()
        zoomRef.current = typeof z === 'number' ? z : 0
      } catch {
        zoomRef.current = 0
      }
    }

    updateZoom()
    map.on('zoom', updateZoom)
    map.on('zoomend', updateZoom)

    return () => {
      map.off('zoom', updateZoom)
      map.off('zoomend', updateZoom)
    }
  }, [map])

  // Sync overlays with toggle state
  useEffect(() => {
    if (!map) return

    const currentActive = activeOverlaysRef.current
    const desiredActive = new Set<string>()

    // Determine which overlays should be active
    for (const def of ENVIRONMENTAL_OVERLAY_CATALOG) {
      if (toggles[def.id]) {
        desiredActive.add(def.id)
      }
    }

    // Activate new overlays
    for (const id of desiredActive) {
      if (!currentActive.has(id)) {
        // GUARDRAIL: Skip if activation already in progress (deduplication)
        if (activationInProgressRef.current.has(id)) {
          traceOverlay('resilient_activation_skipped_duplicate', { overlayId: id })
          continue
        }

        activationInProgressRef.current.add(id)
        traceOverlay('resilient_sync_activate', { overlayId: id, zoom: zoomRef.current })

        const result = activateOverlayResilient(
          map,
          id as typeof ENVIRONMENTAL_OVERLAY_CATALOG[number]['id'],
          online,
          zoomRef.current,
        )

        if (result.visible) {
          currentActive.add(id)
          traceOverlay('resilient_sync_visible', { overlayId: id })

          // Fire-and-forget background enhancement
          if (result.backgroundEnhance) {
            result.backgroundEnhance.then((enhanceResult) => {
              // GUARDRAIL: Verify still active before logging completion
              if (!currentActive.has(id)) {
                traceOverlay('resilient_enhance_complete_inactive', {
                  overlayId: id,
                  enhanced: enhanceResult.enhanced,
                  finalCount: enhanceResult.finalFeatureCount,
                })
                return
              }
              traceOverlay('resilient_enhance_complete', {
                overlayId: id,
                enhanced: enhanceResult.enhanced,
                finalCount: enhanceResult.finalFeatureCount,
              })
            })
          }
        } else {
          traceOverlay('resilient_sync_not_visible', { overlayId: id, reason: 'zoom_gate_or_render_fail' })
        }

        // GUARDRAIL: Always clear in-progress flag
        activationInProgressRef.current.delete(id)
      }
    }

    // Deactivate removed overlays
    for (const id of currentActive) {
      if (!desiredActive.has(id)) {
        traceOverlay('resilient_sync_deactivate', { overlayId: id })
        deactivateOverlayResilient(map, id as typeof ENVIRONMENTAL_OVERLAY_CATALOG[number]['id'])
        currentActive.delete(id)
      }
    }
  }, [map, toggles, online])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // GUARDRAIL: Verify cleanup with trace diagnostics
      cleanupVerificationCounter++
      traceOverlay('layer_unmount_cleanup_start', {
        cleanupId: cleanupVerificationCounter,
        activeCount: activeOverlaysRef.current.size,
        inProgressCount: activationInProgressRef.current.size,
      })

      if (!map) {
        traceOverlay('layer_unmount_cleanup_no_map', { cleanupId: cleanupVerificationCounter })
        return
      }

      // Clear any pending activations
      activationInProgressRef.current.clear()

      for (const id of activeOverlaysRef.current) {
        deactivateOverlayResilient(map, id as typeof ENVIRONMENTAL_OVERLAY_CATALOG[number]['id'])
      }
      activeOverlaysRef.current.clear()

      traceOverlay('layer_unmount_cleanup_complete', {
        cleanupId: cleanupVerificationCounter,
        clearedCount: activeOverlaysRef.current.size,
      })
    }
  }, [map])

  // No UI rendered — this is a logic-only component
  return null
}
