/**
 * Tokenized z-index layering for HUD presentation isolation.
 * All new layering MUST resolve through these tokens — no arbitrary escalation.
 */

export const LAYER_Z = {
  /** Map canvas and basemap */
  BASE_MAP: 0,
  /** Map overlays (routes, waypoints, environmental) */
  MAP_OVERLAY: 10,
  /** Mode root shell (Classic / Balanced / Modern) */
  MODE_UI: 50,
  /** Floating HUD panels within a mode */
  FLOATING_PANEL: 100,
  /** Mode-local overlay portal host */
  MODE_OVERLAY: 200,
  /** Top bar, quick actions, status rails */
  CHROME: 150,
  /** Sheets and side panels */
  SHEET: 300,
  /** Modal dialogs (mode-scoped) */
  MODAL: 500,
  /** Global overlay root (confirm, SW update) */
  OVERLAY: 1000,
  /** Critical alerts (SOS hold, deadman) */
  CRITICAL_ALERT: 2000,
} as const

export type LayerZKey = keyof typeof LAYER_Z

export function layerZ(key: LayerZKey): number {
  return LAYER_Z[key]
}
