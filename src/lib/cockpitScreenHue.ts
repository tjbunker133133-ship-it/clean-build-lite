import type { CSSProperties } from 'react'
import type { CockpitPrefs, ScreenHueMode } from '../types/cockpit'

/** HUD-only CSS filter stack — map layer stays unfiltered (wrapper excludes MapCanvas). */
export function screenHueFilter(mode: ScreenHueMode, prefs?: Partial<CockpitPrefs>): CSSProperties {
  switch (mode) {
    case 'low_light':
      // Keep HUD readable in the dark while map handles most dimming.
      return { filter: `brightness(${prefs?.low_hud_brightness ?? 0.86}) contrast(1.1) saturate(0.9)` }
    case 'bright_day':
      return {
        filter: `brightness(${prefs?.bright_hud_brightness ?? 1.32}) contrast(1.1) saturate(1.05)`,
      }
    case 'red_tactical':
      // Clamp to a strict red-only hue window so tuning cannot drift into cyan.
      const hue = Math.max(-60, Math.min(-42, prefs?.red_hue_rotate ?? -50))
      const sat = Math.max(0.45, Math.min(0.95, prefs?.red_saturation ?? 0.52))
      const bri = Math.max(0.52, Math.min(0.82, prefs?.red_brightness ?? 0.68))
      return {
        // True-red output with guarded tuning.
        filter: `grayscale(1) sepia(1) hue-rotate(${hue}deg) saturate(${(sat * 12).toFixed(2)}) brightness(${bri}) contrast(1.25)`,
      }
    default:
      return {}
  }
}

/** Map-specific tuning so whole screen shifts as a single tactical mode. */
export function mapScreenFilter(mode: ScreenHueMode, prefs?: Partial<CockpitPrefs>): CSSProperties {
  switch (mode) {
    case 'low_light': {
      // Keep low-light readable on mobile OLED panels; avoid over-dimming maps.
      const b = Math.max(0.3, prefs?.low_map_brightness ?? 0.32)
      return { filter: `brightness(${b}) contrast(0.98) saturate(0.8)` }
    }
    case 'bright_day': {
      const b = Math.max(1.0, Math.min(1.4, prefs?.bright_map_brightness ?? 1.18))
      return { filter: `brightness(${b}) contrast(1.08) saturate(1.04)` }
    }
    case 'red_tactical':
      // Stronger red monochrome for map layer with guarded tuning.
      const hue = Math.max(-60, Math.min(-42, prefs?.red_hue_rotate ?? -50))
      const sat = Math.max(0.45, Math.min(0.95, prefs?.red_saturation ?? 0.52))
      const bri = Math.max(0.52, Math.min(0.82, prefs?.red_brightness ?? 0.68))
      const mapSat = 6 + sat * 7
      return {
        filter: `grayscale(1) sepia(1) hue-rotate(${hue}deg) saturate(${mapSat.toFixed(2)}) brightness(${Math.max(0.4, bri - 0.18).toFixed(2)}) contrast(1.28)`,
      }
    default:
      return {}
  }
}
