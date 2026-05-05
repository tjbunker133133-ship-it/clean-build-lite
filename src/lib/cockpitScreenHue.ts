import type { CSSProperties } from 'react'
import type { CockpitPrefs, ScreenHueMode } from '../types/cockpit'

/** HUD-only CSS filter stack — map layer stays unfiltered (wrapper excludes MapCanvas). */
export function screenHueFilter(mode: ScreenHueMode, prefs?: Partial<CockpitPrefs>): CSSProperties {
  switch (mode) {
    case 'low_light':
      // Keep HUD readable in the dark while map handles most dimming.
      return { filter: `brightness(${prefs?.low_hud_brightness ?? 0.86}) contrast(1.1) saturate(0.9)` }
    case 'bright_day':
      return { filter: 'brightness(1.35) contrast(1.12) saturate(1.05)' }
    case 'red_tactical':
      return {
        // Force true red monochrome conversion to avoid orange/cyan carryover.
        // grayscale+sepia establishes a single tone before hue shift to red.
        filter: `grayscale(1) sepia(1) hue-rotate(${prefs?.red_hue_rotate ?? -62}deg) saturate(${(prefs?.red_saturation ?? 0.52) * 10}) brightness(${prefs?.red_brightness ?? 0.68}) contrast(1.25)`,
      }
    default:
      return {}
  }
}

/** Map-specific tuning so whole screen shifts as a single tactical mode. */
export function mapScreenFilter(mode: ScreenHueMode, prefs?: Partial<CockpitPrefs>): CSSProperties {
  switch (mode) {
    case 'low_light':
      return { filter: `brightness(${prefs?.low_map_brightness ?? 0.16}) contrast(0.94) saturate(0.6)` }
    case 'bright_day':
      return { filter: 'brightness(1.2) contrast(1.08) saturate(1.04)' }
    case 'red_tactical':
      // Stronger red monochrome for map layer.
      const mapSat = 4 + (prefs?.red_saturation ?? 0.52) * 8
      return {
        filter: `grayscale(1) sepia(1) hue-rotate(${prefs?.red_hue_rotate ?? -62}deg) saturate(${mapSat.toFixed(2)}) brightness(0.38) contrast(1.28)`,
      }
    default:
      return {}
  }
}
