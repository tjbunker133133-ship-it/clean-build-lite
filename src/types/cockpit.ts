export type HudColorTheme = 'cyan' | 'amber' | 'green' | 'white'

/** COCKPIT_UX_DIRECTIVE v2 — Nightforce screen modes */
export type ScreenHueMode = 'low_light' | 'bright_day' | 'red_tactical'
export type DockSide = 'left' | 'right'

export interface CockpitPanelRect {
  x: number
  y: number
  w: number
  h: number | null
  z: number
  minimized: boolean
  docked?: boolean
  dockSide?: DockSide
}

export interface CockpitPrefs {
  glass_intensity: number
  hud_color: HudColorTheme
  panel_opacity: number
  animations_enabled: boolean
  layout_version: string
  /** Tactical environment hue (filters HUD chrome only; map unfiltered) */
  screen_hue: ScreenHueMode
  /** User-tuned display controls */
  low_hud_brightness: number
  low_map_brightness: number
  red_hue_rotate: number
  red_saturation: number
  red_brightness: number
}

/** Bump key to invalidate stale layouts (fresh start for all clients). */
export const COCKPIT_STORAGE_KEY = 'titanium_cockpit_state_v4'

/** Magnetic grid snap (COCKPIT_UX v2: 16px — tighter, less post-snap overlap) */
export const SNAP_PX = 16

export const EASE = 'cubic-bezier(0.25, 0.1, 0.25, 1)'
export const DURATION_MS = 200
