/**
 * Panel Auto-Minimize - Phase 3D (Surgical Reconciliation)
 *
 * Deterministic panel minimization for hybrid/immersive presentation modes.
 * Uses presentation-aware persistence reconciliation.
 *
 * SAFETY:
 * - Uses useLayoutEffect for synchronous pre-paint execution
 * - Runs AFTER persistence hydration, BEFORE visual paint
 * - No timers, no polling, no race conditions
 * - Respects emergency panels (SOS/DeadMan never minimized)
 * - Respects user restored panels (recorded across sessions)
 * - Uses existing CockpitContext API (no modifications needed)
 * - Additive only — component can be removed without breaking anything
 */

import { useLayoutEffect, useRef, useEffect } from 'react'
import { useCockpit } from '../context/CockpitContext'
import { useHudPresentation } from '../context/HudPresentationContext'
import {
  getPanelsToMinimizeInHybrid,
  hasHybridBeenReconciled,
  hasUserRestoredPanel,
  markHybridReconciled,
  onPresentationModeChange,
  recordUserRestoredPanel,
} from '../lib/presentationPersistence'

/**
 * Panels that should NEVER be auto-minimized (emergency/critical systems)
 */
const NEVER_MINIMIZE = new Set([
  'sos',        // Emergency SOS
  'deadman',    // Dead man switch
])

/**
 * Apply auto-minimization based on presentation mode.
 * Uses useLayoutEffect for deterministic pre-paint execution.
 */
export function PanelAutoMinimize(): null {
  const { panels, updatePanel } = useCockpit()
  const { shouldMinimizePanel, mode } = useHudPresentation()
  const previousModeRef = useRef<string | null>(null)
  const reconciledThisSessionRef = useRef(false)

  // Phase 3D: Track mode changes and manage reconciliation state
  useEffect(() => {
    const prevMode = previousModeRef.current
    const currentMode = mode

    if (prevMode !== currentMode) {
      onPresentationModeChange(
        currentMode,
        prevMode as 'legacy' | 'hybrid' | 'immersive' | null,
      )
      previousModeRef.current = currentMode

      // Reset session reconciliation on mode change to hybrid/immersive
      if (currentMode === 'hybrid' || currentMode === 'immersive') {
        reconciledThisSessionRef.current = false
      }
    }
  }, [mode])

  // Phase 3D: Synchronous layout effect for deterministic minimization
  // This runs AFTER React hydration but BEFORE browser paint
  useLayoutEffect(() => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log(`[GUARD PanelAutoMinimize] useLayoutEffect: ENTERED, mode=${mode}`)
    }
    // Skip legacy mode
    if (mode === 'legacy') {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log(`[GUARD PanelAutoMinimize] mode=legacy, decision=EARLY_RETURN`)
      }
      return
    }

    // IMMERSIVE MODE: No auto-minimization — panels are free-floating overlays
    // Overlapping is expected and allowed in immersive mode
    if (mode === 'immersive') {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log('[GUARD PanelAutoMinimize] mode=immersive, decision=EARLY_RETURN (auto-minimize disabled)')
      }
      return
    }

    // Skip if already reconciled this session AND hybrid already reconciled globally
    if (
      reconciledThisSessionRef.current &&
      hasHybridBeenReconciled()
    ) {
      return
    }

    // Collect eligible panel IDs (excluding emergency panels)
    const eligiblePanelIds: string[] = []
    const currentlyMinimized = new Set<string>()

    for (const [panelId, panel] of Object.entries(panels)) {
      // Skip emergency panels
      if (NEVER_MINIMIZE.has(panelId.toLowerCase())) continue

      // Track currently minimized
      if (panel?.minimized) {
        currentlyMinimized.add(panelId)
        continue
      }

      // Check if should minimize in this mode
      if (shouldMinimizePanel(panelId)) {
        eligiblePanelIds.push(panelId)
      }
    }

    // Get panels to minimize (respects user restores)
    const panelsToMinimize = getPanelsToMinimizeInHybrid(
      eligiblePanelIds,
      currentlyMinimized,
    )

    // Apply minimization immediately (synchronous, before paint)
    if (panelsToMinimize.length > 0) {
      for (const panelId of panelsToMinimize) {
        updatePanel(panelId, { minimized: true })
      }

      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log('[PanelAutoMinimize] Reconciled panels:', panelsToMinimize)
      }
    }

    // Mark as reconciled
    reconciledThisSessionRef.current = true
    if (mode === 'hybrid') {
      markHybridReconciled()
    }
  }, [mode, panels, shouldMinimizePanel, updatePanel])

  // Track panel state changes to record user restores
  useEffect(() => {
    if (mode === 'legacy') return

    for (const [panelId, panel] of Object.entries(panels)) {
      // If a panel was minimized by us but is now expanded, user restored it
      if (
        !panel?.minimized &&
        hasHybridBeenReconciled() &&
        !hasUserRestoredPanel(panelId)
      ) {
        recordUserRestoredPanel(panelId)
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.log('[PanelAutoMinimize] User restored panel:', panelId)
        }
      }
    }
  }, [mode, panels])

  // This component renders nothing
  return null
}

export default PanelAutoMinimize
