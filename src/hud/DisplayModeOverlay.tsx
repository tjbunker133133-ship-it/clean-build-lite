import { useMemo } from 'react'
import { useCockpit } from '../context/CockpitContext'
import type { ScreenHueMode } from '../types/cockpit'
import { mapScreenFilter } from '../lib/cockpitScreenHue'

function overlayModeClass(hue: ScreenHueMode): string {
  switch (hue) {
    case 'bright_day':
      return 'mode-bright'
    case 'low_light':
      return 'mode-lowlight'
    case 'red_tactical':
      return 'mode-red'
    default:
      return 'mode-bright'
  }
}

/**
 * Full-screen tint above map + HUD (pointer-events: none).
 * MapLibre canvas is never CSS-filtered; this overlay uses backdrop-filter only.
 */
export default function DisplayModeOverlay() {
  const { prefs } = useCockpit()
  const modeClass = useMemo(() => overlayModeClass(prefs.screen_hue), [prefs.screen_hue])
  const overlayStyle = useMemo(() => mapScreenFilter(prefs.screen_hue, prefs), [prefs.screen_hue, prefs])

  return <div id="display-mode-overlay" className={modeClass} style={overlayStyle} aria-hidden />
}
