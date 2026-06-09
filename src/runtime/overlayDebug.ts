/**
 * OVERLAY DEBUG API
 *
 * Extends window.__hudDebug with overlay and map debugging functions.
 * Used by Playwright E2E tests for render mode verification.
 */

import type { EnvironmentalOverlayId } from '../lib/environmentalOverlays/types'
import { overlayDef } from '../lib/environmentalOverlays/catalog'

declare global {
  interface Window {
    __hudDebug?: {
      // Map access
      getMap?: () => any

      // Overlay control
      toggleOverlay?: (overlayId: EnvironmentalOverlayId, enabled: boolean) => void
      getOverlayDef?: (overlayId: EnvironmentalOverlayId) => { id: string; renderMode?: string; minZoom?: number } | null

      // Existing voice debug functions (from voiceRegressionDebug.ts)
      rawSpeak?: (text: string, priority?: string) => void
      disableVoiceAuthority?: boolean
      setDisableVoiceAuthority?: (v: boolean) => void
      disableSrPause?: boolean
      setDisableSrPause?: (v: boolean) => void
      voiceSafeMode?: boolean
      setVoiceSafeMode?: (v: boolean) => void
      useMinimalVoice?: boolean
      setUseMinimalVoice?: (v: boolean) => void
      traceCancelCalls?: boolean
      setTraceCancelCalls?: (v: boolean) => void
      getCancelCallLog?: () => any[]
      clearCancelLog?: () => void
      getDiagnosticReport?: () => any
      captureFieldDiagnostic?: () => any
      exportFieldReport?: () => void
      _config?: any
    }
    __hudMap?: any
    __hudOverlayContext?: {
      toggles?: Record<string, boolean>
      setToggle?: (id: EnvironmentalOverlayId, enabled: boolean) => { applied: boolean; error?: string }
    }
  }
}

const LOG_PREFIX = '[OVERLAY_DEBUG]'

/**
 * Get the map instance from MapContext via window access
 * This relies on the MapCanvas component exposing the map
 */
function getMap(): any {
  // Try multiple sources where map might be accessible
  const w = window as Window & { __hudMap?: any }

  // Check if map is directly exposed
  if (w.__hudMap) return w.__hudMap

  console.warn(`${LOG_PREFIX} Map not available - ensure MapCanvas has mounted`)
  return null
}

/**
 * Toggle an overlay on/off
 * This function triggers overlay state changes that the EnvironmentalOverlaysLayerResilient
 * component will detect via the OverlayContext.
 */
function toggleOverlay(overlayId: EnvironmentalOverlayId, enabled: boolean): void {
  const w = window as Window & { __hudOverlayContext?: { setToggle?: (id: EnvironmentalOverlayId, enabled: boolean) => { applied: boolean; error?: string } } }

  // Try to find the overlay context setter
  // This relies on the OverlayContext being accessible or the layer component responding
  if (w.__hudOverlayContext?.setToggle) {
    w.__hudOverlayContext.setToggle(overlayId, enabled)
    console.log(`${LOG_PREFIX} Toggled ${overlayId} -> ${enabled} via context`)
    return
  }

  // Alternative: Dispatch a custom event that the layer can listen for
  const event = new CustomEvent('hud-overlay-toggle', {
    detail: { overlayId, enabled },
  })
  document.dispatchEvent(event)
  console.log(`${LOG_PREFIX} Dispatched toggle event for ${overlayId} -> ${enabled}`)
}

/**
 * Get overlay definition for inspection
 */
function getOverlayDef(overlayId: EnvironmentalOverlayId): { id: string; renderMode?: string; minZoom?: number } | null {
  try {
    const def = overlayDef(overlayId)
    return {
      id: def.id,
      renderMode: def.renderMode ?? 'detail', // Default to detail for backward compatibility
      minZoom: def.minZoom,
    }
  } catch (e) {
    console.error(`${LOG_PREFIX} Unknown overlay: ${overlayId}`)
    return null
  }
}

/**
 * Extend the existing __hudDebug object with overlay functions
 */
function extendDebugApi(): void {
  if (typeof window === 'undefined') return

  const w = window as any

  // Ensure __hudDebug exists (voice regression debug may not have loaded yet)
  if (!w.__hudDebug) {
    w.__hudDebug = {}
  }

  // Add overlay debug functions
  w.__hudDebug.getMap = getMap
  w.__hudDebug.toggleOverlay = toggleOverlay
  w.__hudDebug.getOverlayDef = getOverlayDef

  console.log(`${LOG_PREFIX} Debug API extended with overlay functions`)
}

// Extend immediately if window is available
if (typeof window !== 'undefined') {
  extendDebugApi()

  // Also extend on DOMContentLoaded to ensure voice debug has initialized first
  document.addEventListener('DOMContentLoaded', () => {
    extendDebugApi()
  })
}

// Export for explicit importing
export { extendDebugApi, getMap, toggleOverlay, getOverlayDef }
