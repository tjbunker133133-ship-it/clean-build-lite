import type { CSSProperties } from 'react'
import type { CockpitPrefs, ScreenHueMode } from '../types/cockpit'

const MIN_BRIGHTNESS = 0.65

function mapSliderBrightness(value: number, inputMin: number, inputMax: number, outputMax: number): number {
  const clamped = Math.max(inputMin, Math.min(inputMax, value))
  const normalized = (clamped - inputMin) / Math.max(0.0001, inputMax - inputMin)
  return MIN_BRIGHTNESS + normalized * (outputMax - MIN_BRIGHTNESS)
}

/** HUD-only CSS filter stack — map layer stays unfiltered (wrapper excludes MapCanvas). */
export function screenHueFilter(mode: ScreenHueMode, prefs?: Partial<CockpitPrefs>): CSSProperties {
  switch (mode) {
    case 'low_light': {
      // Keep HUD readable in the dark while map handles most dimming.
      const lowHud = mapSliderBrightness(prefs?.low_hud_brightness ?? 0.96, 0.7, 1.2, 1.25)
      return { filter: `brightness(${lowHud.toFixed(3)}) contrast(1.1) saturate(0.9)` }
    }
    case 'bright_day':
      const brightHud = mapSliderBrightness(prefs?.bright_hud_brightness ?? 1.32, 1.0, 1.6, 1.45)
      return {
        filter: `brightness(${brightHud.toFixed(3)}) contrast(1.1) saturate(1.05)`,
      }
    case 'red_tactical':
      // Clamp to a strict red-only hue window so tuning cannot drift into cyan.
      const hue = Math.max(-60, Math.min(-42, prefs?.red_hue_rotate ?? -50))
      const sat = Math.max(0.45, Math.min(0.95, prefs?.red_saturation ?? 0.52))
      const bri = mapSliderBrightness(prefs?.red_brightness ?? 0.68, 0.5, 0.95, 1.35)
      return {
        // True-red output with guarded tuning.
        filter: `grayscale(1) sepia(1) hue-rotate(${hue}deg) saturate(${(sat * 12).toFixed(2)}) brightness(${bri.toFixed(3)}) contrast(1.25)`,
      }
    default:
      return {}
  }
}

/**
 * Map tint presets — avoid applying to the MapLibre container ancestor:
 * CSS `filter` there can desync rendered tiles vs input coordinates.
 */
export function mapScreenFilter(mode: ScreenHueMode, prefs?: Partial<CockpitPrefs>): CSSProperties {
  switch (mode) {
    case 'low_light': {
      // Keep low-light readable on mobile OLED panels; avoid over-dimming maps.
      const b = mapSliderBrightness(prefs?.low_map_brightness ?? 0.2, 0.2, 0.55, 1.15)
      return { filter: `brightness(${b.toFixed(3)}) contrast(0.98) saturate(0.8)` }
    }
    case 'bright_day': {
      const b = mapSliderBrightness(prefs?.bright_map_brightness ?? 1.18, 1.0, 1.4, 1.4)
      return { filter: `brightness(${b.toFixed(3)}) contrast(1.08) saturate(1.04)` }
    }
    case 'red_tactical':
      // Stronger red monochrome for map layer with guarded tuning.
      const hue = Math.max(-60, Math.min(-42, prefs?.red_hue_rotate ?? -50))
      const sat = Math.max(0.45, Math.min(0.95, prefs?.red_saturation ?? 0.52))
      const bri = mapSliderBrightness(prefs?.red_brightness ?? 0.68, 0.5, 0.95, 1.3)
      const mapSat = 6 + sat * 7
      return {
        filter: `grayscale(1) sepia(1) hue-rotate(${hue}deg) saturate(${mapSat.toFixed(2)}) brightness(${Math.max(MIN_BRIGHTNESS, bri - 0.12).toFixed(3)}) contrast(1.28)`,
      }
    default:
      return {}
  }
}
