/**
 * Presentation-Aware Persistence Reconciliation - Phase 3D
 *
 * Manages interaction between presentation modes and persisted panel states.
 *
 * SAFETY:
 * - Additive only — doesn't modify CockpitContext internals
 * - Uses separate localStorage keys for presentation state
 * - Respects user autonomy after explicit interactions
 * - No polling, no timers
 */

import type { HudPresentationMode } from '../types/hudPresentation'

const HYBRID_RECONCILED_KEY = 'hud_presentation_hybrid_reconciled_v1'
const USER_RESTORED_PANELS_KEY = 'hud_user_restored_panels_v1'

/**
 * Check if hybrid mode has been reconciled for this session.
 * Used to prevent overriding user's explicit panel restores.
 */
export function hasHybridBeenReconciled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(HYBRID_RECONCILED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Mark hybrid mode as reconciled.
 * Called after first successful auto-minimization.
 */
export function markHybridReconciled(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(HYBRID_RECONCILED_KEY, '1')
  } catch {
    // Ignore storage errors
  }
}

/**
 * Clear hybrid reconciled flag.
 * Called when switching to legacy mode or resetting presentation.
 */
export function clearHybridReconciled(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(HYBRID_RECONCILED_KEY)
  } catch {
    // Ignore storage errors
  }
}

/**
 * Record that user explicitly restored a panel.
 * Prevents auto-minimize from re-collapsing it.
 */
export function recordUserRestoredPanel(panelId: string): void {
  if (typeof window === 'undefined') return
  try {
    const existing = JSON.parse(localStorage.getItem(USER_RESTORED_PANELS_KEY) ?? '[]') as string[]
    if (!existing.includes(panelId)) {
      existing.push(panelId)
      localStorage.setItem(USER_RESTORED_PANELS_KEY, JSON.stringify(existing))
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * Check if user explicitly restored a panel.
 */
export function hasUserRestoredPanel(panelId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const restored = JSON.parse(localStorage.getItem(USER_RESTORED_PANELS_KEY) ?? '[]') as string[]
    return restored.includes(panelId)
  } catch {
    return false
  }
}

/**
 * Clear user restored panel records.
 * Called when switching modes or resetting.
 */
export function clearUserRestoredPanels(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(USER_RESTORED_PANELS_KEY)
  } catch {
    // Ignore storage errors
  }
}

/**
 * Handle presentation mode change.
 * Manages reconciliation flags appropriately.
 */
export function onPresentationModeChange(
  newMode: HudPresentationMode,
  previousMode: HudPresentationMode | null,
): void {
  // Switching TO hybrid: clear reconciled flag so minimization happens
  if (newMode === 'hybrid' && previousMode !== 'hybrid') {
    clearHybridReconciled()
    // Don't clear user restored panels — respect their choices
  }

  // Switching TO legacy: clear reconciled flag for next hybrid switch
  if (newMode === 'legacy' && previousMode !== 'legacy') {
    clearHybridReconciled()
  }

  // Switching TO immersive: always reconcile (no persistence of immersive)
  if (newMode === 'immersive') {
    clearHybridReconciled()
  }
}

/**
 * Get list of panels that should be minimized in hybrid mode.
 * Respects user restored panels.
 */
export function getPanelsToMinimizeInHybrid(
  panelIds: string[],
  currentlyMinimized: Set<string>,
): string[] {
  // If already reconciled this session, only minimize new panels
  if (hasHybridBeenReconciled()) {
    return panelIds.filter(
      (id) =>
        !currentlyMinimized.has(id) &&
        !hasUserRestoredPanel(id),
    )
  }

  // First reconciliation: minimize all eligible panels
  return panelIds.filter((id) => !currentlyMinimized.has(id))
}
