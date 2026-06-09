/**
 * HUD RUNTIME — UNIFIED CONTEXT-AWARE SYSTEM
 * ==========================================
 *
 * SINGLE SOURCE OF TRUTH: window.__HUD_RUNTIME__
 *
 * RULES:
 * 1. Mode resolved ONCE at boot (before React mounts)
 * 2. DOM tagged immediately (zero flicker)
 * 3. ALL systems read from window.__HUD_RUNTIME__
 * 4. NO React state, NO context, NO props for mode
 * 5. User preference ALWAYS overrides auto (unless autoModeEnabled)
 *
 * ENVIRONMENT CONTRACT:
 * Modes are NOT UI themes. They define:
 * - What UI systems are allowed to exist
 * - What layout systems may initialize
 * - What interaction model is active
 *
 * LAYOUT PERMISSIONS (from runtime.layout):
 * - dock: Dock system initialization allowed?
 * - panels: Persistent panels allowed?
 * - cockpit: Full cockpit shell allowed?
 * - overlays: Floating overlays/transient UI allowed?
 *
 * MODE RESOLUTION:
 * - userPreferredMode: persisted user choice
 * - runtimeModeSource: derived from activity (planning/navigating/setup)
 * - autoModeEnabled: whether to use automatic switching
 *
 * FINAL MODE (when autoModeEnabled):
 *   planning → hybrid
 *   navigating → immersive
 *   setup → legacy
 *
 * FINAL MODE (when autoModeEnabled === false):
 *   always userPreferredMode
 */

export type HudMode = 'legacy' | 'hybrid' | 'immersive'
export type RuntimeModeSource = 'planning' | 'navigating' | 'setup' | 'user_override' | 'default'

/** Layout permission flags - which UI systems may initialize */
export interface HudLayoutPermissions {
  /** Dock system may initialize (false in immersive/hybrid) */
  dock: boolean
  /** Persistent panels may be shown (collapsible in hybrid) */
  panels: boolean
  /** Full cockpit shell layout allowed (true only in legacy) */
  cockpit: boolean
  /** Floating overlays and transient UI allowed */
  overlays: boolean
}

interface HudRuntimeState {
  // Final resolved mode (what the UI should render)
  mode: HudMode

  // User's persisted preference
  userPreferredMode: HudMode

  // Whether automatic mode switching is enabled
  autoModeEnabled: boolean

  // Current activity context that drives runtime mode
  runtimeModeSource: RuntimeModeSource

  // Computed flags for fast checks
  isImmersive: boolean
  isHybrid: boolean
  isLegacy: boolean

  /** Layout permission layer - defines allowed UI systems */
  layout: HudLayoutPermissions

  // Boot metadata
  bootTimestamp: number
  resolvedFrom: 'user_preference' | 'auto_context' | 'url_override' | 'dev_flag' | 'default'
}

declare global {
  interface Window {
    __HUD_RUNTIME__?: HudRuntimeState
    __HUD_MODE__?: HudMode
  }
}

const STORAGE_KEY = 'hud_user_preference_v1'
const AUTO_MODE_KEY = 'hud_auto_mode_v1'
const FORCE_MODE_KEY = 'hud_force_mode'

/** Detect activity context from application state */
function detectRuntimeContext(): RuntimeModeSource {
  // URL-based detection (initial load)
  try {
    const path = window.location.pathname
    const search = window.location.search

    // Planning routes/patterns
    if (
      path.includes('plan') ||
      path.includes('route') ||
      search.includes('planning') ||
      search.includes('edit')
    ) {
      return 'planning'
    }

    // Navigation/active movement
    if (
      path.includes('nav') ||
      search.includes('navigating') ||
      search.includes('active')
    ) {
      return 'navigating'
    }

    // Setup/debug routes
    if (
      path.includes('setup') ||
      path.includes('config') ||
      path.includes('debug') ||
      search.includes('setup')
    ) {
      return 'setup'
    }
  } catch {
    // ignore
  }

  return 'default'
}

/** Map runtime context to suggested mode */
function contextToMode(context: RuntimeModeSource): HudMode {
  switch (context) {
    case 'planning':
      return 'hybrid'
    case 'navigating':
      return 'immersive'
    case 'setup':
      return 'legacy'
    case 'user_override':
      return 'hybrid' // fallback, will be overridden
    case 'default':
      return 'hybrid'
  }
}

/** Load user preference from storage */
function loadUserPreference(): HudMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (isValidMode(parsed.mode)) {
        return parsed.mode
      }
    }
  } catch {
    // ignore
  }
  return 'hybrid' // Default preference is hybrid
}

/** Load auto-mode setting */
function loadAutoModeEnabled(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_MODE_KEY)
    if (raw === null) {
      return true // Default to auto mode enabled
    }
    return raw === 'true'
  } catch {
    return true
  }
}

/** Check if mode is valid */
function isValidMode(m: any): m is HudMode {
  return m === 'legacy' || m === 'hybrid' || m === 'immersive'
}

/**
 * Compute layout permissions from final mode.
 * This is the ENVIRONMENT CONTRACT - defines what UI systems may exist.
 *
 * IMMERSIVE: No dock, no persistent panels, no cockpit shell
 * HYBRID: No dock, collapsible panels, partial cockpit
 * LEGACY: Full system access
 */
function computeLayoutPermissions(mode: HudMode): HudLayoutPermissions {
  switch (mode) {
    case 'immersive':
      return {
        dock: false,     // NEVER initialize dock in immersive
        panels: false,   // No persistent panels (transient only)
        cockpit: false,  // No cockpit shell
        overlays: true,  // Floating overlays + orb allowed
      }

    case 'hybrid':
      return {
        dock: false,     // No persistent dock
        panels: true,    // Collapsible panels allowed
        cockpit: false,  // No full cockpit shell
        overlays: true,  // All overlays allowed
      }

    case 'legacy':
      return {
        dock: true,      // Full dock system
        panels: true,    // All panels
        cockpit: true,   // Full cockpit shell
        overlays: true,  // All overlays
      }
  }
}

/** Resolve final mode based on all inputs */
function resolveRuntimeState(): {
  state: HudRuntimeState
  resolvedFrom: HudRuntimeState['resolvedFrom']
} {
  // 1. Check URL override (dev/debug only, highest priority)
  let urlOverride: HudMode | null = null
  try {
    const params = new URLSearchParams(window.location.search)
    const modeParam = params.get('mode')
    if (isValidMode(modeParam)) {
      urlOverride = modeParam
    }
  } catch {
    // ignore
  }

  // 2. Check dev force flag
  let devOverride: HudMode | null = null
  if (import.meta.env.DEV) {
    try {
      const forced = localStorage.getItem(FORCE_MODE_KEY) as HudMode | null
      if (isValidMode(forced)) {
        devOverride = forced
      }
    } catch {
      // ignore
    }
  }

  // 3. Load user preference and auto-mode setting
  const userPreferredMode = loadUserPreference()
  const autoModeEnabled = loadAutoModeEnabled()

  // 4. Detect runtime context
  const runtimeModeSource = detectRuntimeContext()

  // 5. Resolve final mode
  let finalMode: HudMode
  let resolvedFrom: HudRuntimeState['resolvedFrom']

  if (urlOverride) {
    finalMode = urlOverride
    resolvedFrom = 'url_override'
  } else if (devOverride) {
    finalMode = devOverride
    resolvedFrom = 'dev_flag'
  } else if (!autoModeEnabled) {
    // User has disabled auto mode - always use their preference
    finalMode = userPreferredMode
    resolvedFrom = 'user_preference'
  } else {
    // Auto mode enabled - derive from context
    // BUT: if user has explicitly set a preference, we blend it
    const contextMode = contextToMode(runtimeModeSource)

    // Priority: navigating (immersive) > planning (hybrid) > setup (legacy)
    // User preference acts as minimum level
    if (userPreferredMode === 'immersive') {
      finalMode = 'immersive'
    } else if (userPreferredMode === 'hybrid' && contextMode === 'immersive') {
      finalMode = 'immersive' // Auto-promote to immersive when navigating
    } else if (userPreferredMode === 'legacy') {
      finalMode = userPreferredMode // User wants full control
    } else {
      finalMode = contextMode
    }

    resolvedFrom = 'auto_context'
  }

  const state: HudRuntimeState = {
    mode: finalMode,
    userPreferredMode,
    autoModeEnabled,
    runtimeModeSource,
    isImmersive: finalMode === 'immersive',
    isHybrid: finalMode === 'hybrid',
    isLegacy: finalMode === 'legacy',
    layout: computeLayoutPermissions(finalMode),
    bootTimestamp: Date.now(),
    resolvedFrom,
  }

  return { state, resolvedFrom }
}

/**
 * BOOT EXECUTION — RUNS IMMEDIATELY ON IMPORT
 * Must be imported before React in main.tsx
 */
export const HUD_RUNTIME: HudRuntimeState = (() => {
  // SSR guard
  if (typeof window === 'undefined') {
    return {
      mode: 'hybrid',
      userPreferredMode: 'hybrid',
      autoModeEnabled: true,
      runtimeModeSource: 'default',
      isImmersive: false,
      isHybrid: true,
      isLegacy: false,
      layout: {
        dock: false,     // Safe default for SSR
        panels: true,
        cockpit: false,
        overlays: true,
      },
      bootTimestamp: 0,
      resolvedFrom: 'default',
    }
  }

  // Already booted? Return existing (idempotent)
  if (window.__HUD_RUNTIME__) {
    return window.__HUD_RUNTIME__
  }

  const { state } = resolveRuntimeState()

  // HARD DOM CONTRACT — Set before React mounts
  document.documentElement.setAttribute('data-hud-mode', state.mode)
  document.documentElement.setAttribute('data-hud-auto', String(state.autoModeEnabled))

  // GLOBAL IMMUTABLE CONTRACT
  Object.defineProperty(window, '__HUD_RUNTIME__', {
    value: state,
    writable: false,
    configurable: false,
  })

  // Debug alias
  window.__HUD_MODE__ = state.mode

  // Boot log
  console.log('[HUD RUNTIME] ═══════════════════════════════════════')
  console.log('[HUD RUNTIME] MODE:', state.mode.toUpperCase())
  console.log('[HUD RUNTIME] User Preference:', state.userPreferredMode)
  console.log('[HUD RUNTIME] Auto Mode:', state.autoModeEnabled ? 'ENABLED' : 'DISABLED')
  console.log('[HUD RUNTIME] Context:', state.runtimeModeSource)
  console.log('[HUD RUNTIME] Resolved From:', state.resolvedFrom)
  console.log('[HUD RUNTIME] Layout Permissions:')
  console.log('  - dock:', state.layout.dock ? '✓' : '✗ HARD EXIT')
  console.log('  - panels:', state.layout.panels ? '✓' : '✗ HARD EXIT')
  console.log('  - cockpit:', state.layout.cockpit ? '✓' : '✗ HARD EXIT')
  console.log('  - overlays:', state.layout.overlays ? '✓' : '✗')
  console.log('[HUD RUNTIME] DOM Tagged:', document.documentElement.getAttribute('data-hud-mode'))
  console.log('[HUD RUNTIME] ═══════════════════════════════════════')

  if (state.isImmersive) {
    console.log('%c[HUD RUNTIME] IMMERSIVE MODE — ALL LAYOUT SYSTEMS HARD EXIT', 'color: #ff6b6b; font-weight: bold')
    console.log('%c[HUD RUNTIME] dock=false, panels=false, cockpit=false', 'color: #ff6b6b')
  } else if (state.isHybrid) {
    console.log('%c[HUD RUNTIME] HYBRID MODE — No dock, collapsible panels', 'color: #ffd93d; font-weight: bold')
  }

  return state
})()

/** Get current runtime state (fast accessor) */
export function getHudRuntime(): HudRuntimeState {
  return window.__HUD_RUNTIME__ ?? HUD_RUNTIME
}

/** Mode check helpers (for guards) */
export function isImmersiveMode(): boolean {
  return window.__HUD_RUNTIME__?.isImmersive ?? false
}

export function isHybridMode(): boolean {
  return window.__HUD_RUNTIME__?.isHybrid ?? true
}

export function isLegacyMode(): boolean {
  return window.__HUD_RUNTIME__?.isLegacy ?? false
}

export function getHudMode(): HudMode {
  return window.__HUD_RUNTIME__?.mode ?? 'hybrid'
}

/** Layout permission checkers — use these for HARD_EXIT guards */
export function getLayoutPermissions(): HudLayoutPermissions {
  return (
    window.__HUD_RUNTIME__?.layout ?? {
      dock: false,
      panels: true,
      cockpit: false,
      overlays: true,
    }
  )
}

/** Returns true if dock system MAY initialize (false = HARD_EXIT) */
export function isDockAllowed(): boolean {
  return window.__HUD_RUNTIME__?.layout.dock ?? false
}

/** Returns true if panels MAY be shown (false = transient only) */
export function arePanelsAllowed(): boolean {
  return window.__HUD_RUNTIME__?.layout.panels ?? true
}

/** Returns true if cockpit shell MAY initialize */
export function isCockpitAllowed(): boolean {
  return window.__HUD_RUNTIME__?.layout.cockpit ?? false
}

/** Returns true if overlays are allowed (always true in all modes) */
export function areOverlaysAllowed(): boolean {
  return window.__HUD_RUNTIME__?.layout.overlays ?? true
}

/**
 * HARD_EXIT guard for dock initialization.
 * Call this at the START of any dock system initialization.
 * Returns true if initialization should proceed.
 * Returns false if dock MUST NOT initialize (hard exit required).
 */
export function guardDockInit(_context: string): boolean {
  return isDockAllowed()
}

/**
 * HARD_EXIT guard for panel mounting.
 * Call this before rendering persistent panels.
 * Returns true if panels may be mounted.
 */
export function guardPanelMount(_context: string): boolean {
  return arePanelsAllowed()
}

/**
 * HARD_EXIT guard for cockpit shell initialization.
 * Call this at the START of CockpitHudShell rendering.
 * Returns true if cockpit shell may initialize.
 */
export function guardCockpitInit(_context: string): boolean {
  return isCockpitAllowed()
}

/** User preference management */
export function setUserPreferredMode(mode: HudMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, setAt: Date.now() }))
    if (import.meta.env.DEV) {
      console.log('[HUD RUNTIME] User preference set:', mode, '(reload to apply)')
    }
  } catch {
    // ignore
  }
}

export function setAutoModeEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_MODE_KEY, String(enabled))
    if (import.meta.env.DEV) {
      console.log('[HUD RUNTIME] Auto mode:', enabled ? 'ENABLED' : 'DISABLED', '(reload to apply)')
    }
  } catch {
    // ignore
  }
}

/** Runtime context update (for in-session activity changes) */
export function updateRuntimeContext(context: RuntimeModeSource): void {
  if (!window.__HUD_RUNTIME__) return

  // This does NOT change the mode - it only updates the context for next reload
  // (or for systems that want to react to context without changing mode)

  if (import.meta.env.DEV) {
    console.log('[HUD RUNTIME] Context updated:', context, '(mode unchanged until reload)')
  }
}

/** Dev force mode (for testing) */
export function setDevForceMode(mode: HudMode | null): void {
  try {
    if (mode) {
      localStorage.setItem(FORCE_MODE_KEY, mode)
    } else {
      localStorage.removeItem(FORCE_MODE_KEY)
    }
    if (import.meta.env.DEV) {
      console.log('[HUD RUNTIME] Dev force mode:', mode ?? 'CLEARED', '(reload to apply)')
    }
  } catch {
    // ignore
  }
}

// Re-export for external modules
export type { HudRuntimeState }
