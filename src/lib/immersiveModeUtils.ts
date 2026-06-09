/**
 * IMMERSIVE MODE UTILITIES (DEPRECATED - use hudRuntime.ts)
 *
 * These utilities are kept for backward compatibility.
 * All systems should migrate to importing from './hudRuntime' directly.
 *
 * THE SINGLE SOURCE OF TRUTH IS: window.__HUD_RUNTIME__
 */

import {
  getHudMode,
  isImmersiveMode,
  isHybridMode,
  isLegacyMode,
  setUserPreferredMode,
  setAutoModeEnabled,
  setDevForceMode,
  type HudMode,
} from './hudRuntime'

// Re-export for backward compatibility
export {
  getHudMode as getPresentationMode,
  isImmersiveMode,
  isImmersiveMode as isLayoutAuthorityDisabled,
  isImmersiveMode as isMapFirstMode,
  isHybridMode,
  isLegacyMode,
  setUserPreferredMode as setPresentationMode,
  setDevForceMode as clearPresentationMode,
}

// Type alias for compatibility
export type HudPresentationMode = HudMode
