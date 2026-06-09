/**
 * HUD Presentation Mode System - Phase 3C
 *
 * Safe presentation-layer migration for map-first UX.
 *
 * SAFETY:
 * - Additive only — does not modify CockpitContext, dock engine, or Tier 1
 * - Isolated state — separate from operational systems
 * - Reversible — mode can be switched at any time
 * - No timers, no polling, no runtime hooks
 * 
 * RECOMMENDED MODE (immersive):
 * - Map is the ENTIRE application surface (100% viewport, edge-to-edge)
 * - ZERO layout shift when UI opens/closes
 * - NO dock system (completely disabled)
 * - NO persistent panels (transient overlays only)
 * - NO cockpit shell layout
 * - Radial menu is PRIMARY interaction method
 * - SOS is ONLY persistent UI element
 * - Voice is ambient/always-available
 * - All other UI is contextual and auto-dismisses
 * - Visual aesthetic: calm, modern, field-safe (NOT sci-fi)
 */

export type HudPresentationMode = 'legacy' | 'hybrid' | 'immersive'

export interface HudPresentationState {
  mode: HudPresentationMode
  /** Whether user has explicitly set a mode (vs auto-default) */
  userConfigured: boolean
}

/** Panel visibility rules per mode — maps panel IDs to default minimized state */
export interface PanelVisibilityRules {
  /** Panels that should be minimized by default in this mode */
  minimizedByDefault: string[]
  /** Panels that must never be auto-minimized (emergency, critical) */
  neverMinimize: string[]
  /** Panels that should NOT exist as persistent UI (overlay/transient only) */
  transientOnly: string[]
}

/** 
 * Layout behavior per mode — defines structural UI characteristics 
 * These affect how the layout engine behaves, not just visual styling
 */
export interface LayoutBehaviorRules {
  /** Map occupies 100% viewport with no layout constraints */
  mapFullscreen: boolean
  /** Dock system is completely disabled (not just hidden) */
  dockDisabled: boolean
  /** Cockpit shell layout is disabled */
  cockpitShellDisabled: boolean
  /** Panels must be transient overlays (no persistence) */
  panelsTransientOnly: boolean
  /** TopBar renders as micro status strip only */
  microStatusOnly: boolean
  /** Radial menu is primary interaction method */
  radialPrimary: boolean
  /** SOS has persistent visual presence */
  sosPersistent: boolean
  /** Zero layout shift when UI opens/closes */
  zeroLayoutShift: boolean
}

/** Presentation mode definitions — pure configuration, no runtime logic */
export const PRESENTATION_MODES: Record<HudPresentationMode, {
  name: string
  description: string
  topBarCollapsed: boolean
  dockCollapsed: boolean
  mapDominant: boolean
  radialEmphasized: boolean
  emergencyFloating: boolean
  panelRules: PanelVisibilityRules
  layoutRules: LayoutBehaviorRules
}> = {
  legacy: {
    name: 'Legacy Cockpit',
    description: 'Full dock and panel visibility — original HUD experience',
    topBarCollapsed: false,
    dockCollapsed: false,
    mapDominant: false,
    radialEmphasized: false,
    emergencyFloating: false,
    panelRules: {
      minimizedByDefault: ['wearables'],
      neverMinimize: ['sos', 'deadman', 'voice'],
      transientOnly: [],
    },
    layoutRules: {
      mapFullscreen: false,
      dockDisabled: false,
      cockpitShellDisabled: false,
      panelsTransientOnly: false,
      microStatusOnly: false,
      radialPrimary: false,
      sosPersistent: false,
      zeroLayoutShift: false,
    },
  },
  hybrid: {
    name: 'Hybrid Field',
    description: 'Map-dominant with collapsible panels — transitional mode',
    topBarCollapsed: true,
    dockCollapsed: true,
    mapDominant: true,
    radialEmphasized: true,
    emergencyFloating: true,
    panelRules: {
      minimizedByDefault: [
        'presets',      // Developer tuning
        'checkin',      // Admin/team feature
        'missionLink',  // Team coordination
        'waypoints',    // Use radial + voice instead
        'weather',      // Contextual access
        'situation',    // Contextual access
        'layers',       // Contextual access
        'voice',        // Voice is always available, panel secondary
      ],
      neverMinimize: ['sos', 'deadman'],
      transientOnly: [],
    },
    layoutRules: {
      mapFullscreen: false,  // Still has layout constraints in hybrid
      dockDisabled: true,      // No dock in hybrid
      cockpitShellDisabled: true,
      panelsTransientOnly: false,  // Panels still exist
      microStatusOnly: true,
      radialPrimary: true,
      sosPersistent: true,
      zeroLayoutShift: false,
    },
  },
  immersive: {
    name: 'Modern',
    description: 'Map-first field OS — clean, calm, spatial',
    topBarCollapsed: true,
    dockCollapsed: true,
    mapDominant: true,
    radialEmphasized: true,
    emergencyFloating: true,
    panelRules: {
      minimizedByDefault: [
        'presets',
        'checkin',
        'missionLink',
        'waypoints',
        'weather',
        'situation',
        'layers',
        'voice',
        'preflight',
      ],
      neverMinimize: ['sos', 'deadman'],
      // In recommended mode, these panels ONLY exist as transient overlays
      transientOnly: ['waypoints', 'weather', 'situation', 'layers', 'voice', 'presets', 'checkin', 'missionLink', 'preflight'],
    },
    layoutRules: {
      mapFullscreen: true,       // 100% viewport, no constraints
      dockDisabled: true,        // NO dock system at all
      cockpitShellDisabled: true,  // NO cockpit shell
      panelsTransientOnly: true,   // ONLY transient overlays
      microStatusOnly: true,       // Minimal top bar
      radialPrimary: true,         // Radial is main interaction
      sosPersistent: true,         // SOS always visible
      zeroLayoutShift: true,       // Map never moves
    },
  },
}

/** LocalStorage key for persistence */
export const PRESENTATION_STORAGE_KEY = 'hud_presentation_mode_v1'

/** Default mode for new users */
export const DEFAULT_PRESENTATION_MODE: HudPresentationMode = 'hybrid'

/**
 * Check if a panel should be minimized by default in the given mode.
 * Emergency panels (SOS, DeadMan) are never auto-minimized.
 */
export function shouldMinimizeByDefault(
  panelId: string,
  mode: HudPresentationMode,
): boolean {
  const rules = PRESENTATION_MODES[mode].panelRules
  // Never minimize emergency/critical panels
  if (rules.neverMinimize.includes(panelId.toLowerCase())) {
    return false
  }
  return rules.minimizedByDefault.includes(panelId.toLowerCase())
}

/**
 * Check if a panel should ONLY exist as transient overlay in this mode.
 * In recommended mode, most panels are transient-only.
 */
export function isPanelTransientOnly(
  panelId: string,
  mode: HudPresentationMode,
): boolean {
  const rules = PRESENTATION_MODES[mode].panelRules
  return rules.transientOnly.includes(panelId.toLowerCase())
}

/**
 * Determine if TopBar should render in micro status mode.
 */
export function useMicroStatusBar(mode: HudPresentationMode): boolean {
  return PRESENTATION_MODES[mode].layoutRules.microStatusOnly
}

/**
 * Check if emergency systems should render as floating (always accessible).
 */
export function useFloatingEmergency(mode: HudPresentationMode): boolean {
  return PRESENTATION_MODES[mode].emergencyFloating
}

/**
 * Check if map should be truly fullscreen (100% viewport, no constraints).
 * Only true in recommended (immersive) mode.
 */
export function isMapFullscreen(mode: HudPresentationMode): boolean {
  return PRESENTATION_MODES[mode].layoutRules.mapFullscreen
}

/**
 * Check if dock system should be completely disabled.
 * True in hybrid and recommended modes.
 */
export function isDockDisabled(mode: HudPresentationMode): boolean {
  return PRESENTATION_MODES[mode].layoutRules.dockDisabled
}

/**
 * Check if cockpit shell should be disabled.
 * True in hybrid and recommended modes.
 */
export function isCockpitShellDisabled(mode: HudPresentationMode): boolean {
  return PRESENTATION_MODES[mode].layoutRules.cockpitShellDisabled
}

/**
 * Check if panels should only exist as transient overlays.
 * True only in recommended (immersive) mode.
 */
export function isPanelsTransientOnly(mode: HudPresentationMode): boolean {
  return PRESENTATION_MODES[mode].layoutRules.panelsTransientOnly
}

/**
 * Check if radial menu should be primary interaction method.
 * True in hybrid and recommended modes.
 */
export function isRadialPrimary(mode: HudPresentationMode): boolean {
  return PRESENTATION_MODES[mode].layoutRules.radialPrimary
}

/**
 * Check if SOS should have persistent visual presence.
 * True in hybrid and recommended modes.
 */
export function isSosPersistent(mode: HudPresentationMode): boolean {
  return PRESENTATION_MODES[mode].layoutRules.sosPersistent
}
