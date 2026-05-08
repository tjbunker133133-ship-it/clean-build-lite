import type { CSSProperties } from 'react'
import HudPanel from './HudPanel'
import { useCockpit } from '../context/CockpitContext'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchGapMd, touchGapSm, touchMinTarget } from './tokens'

export default function PresetPanel() {
  const { setScreenHue, setDisplayTuning, updatePanel, applyDeviceOptimization, devicePreset } = useCockpit()
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const gapMd = touchGapMd(isMobile)
  const gapSm = touchGapSm(isMobile)
  const tapMin = touchMinTarget(isMobile)

  const applyNightPatrol = () => {
    setScreenHue('low_light')
    setDisplayTuning({
      low_hud_brightness: 0.95,
      low_map_brightness: 0.12,
      panel_gap_px: 0,
      red_hue_rotate: -62,
      red_saturation: 0.5,
      red_brightness: 0.66,
    })
    updatePanel('location', { x: 980, y: 60, docked: false })
    updatePanel('weather', { x: 980, y: 280, docked: false })
  }

  const applyDayNav = () => {
    setScreenHue('bright_day')
    setDisplayTuning({ low_hud_brightness: 0.9, low_map_brightness: 0.16, panel_gap_px: 0 })
    updatePanel('layers', { x: 16, y: 60, docked: false })
    updatePanel('waypoints', { x: 20, y: 420, docked: false })
  }

  const applyRecon = () => {
    setScreenHue('red_tactical')
    setDisplayTuning({ red_hue_rotate: -64, red_saturation: 0.52, red_brightness: 0.64, panel_gap_px: 0 })
    updatePanel('voice', { x: 1240, y: 280, docked: false })
    updatePanel('location', { x: 1240, y: 60, docked: false })
  }

  const applyIPhonePreset = () => {
    setScreenHue('low_light')
    setDisplayTuning({
      glass_intensity: 0.34,
      panel_opacity: 0.48,
      panel_gap_px: 0,
      low_hud_brightness: 0.92,
      low_map_brightness: 0.16,
      red_hue_rotate: -60,
      red_saturation: 0.5,
      red_brightness: 0.66,
    })
    updatePanel('location', { x: 940, y: 60, docked: false, minimized: false })
    updatePanel('voice', { x: 940, y: 260, docked: false, minimized: false })
    updatePanel('sos', { x: 940, y: 470, docked: false, minimized: false })
  }

  const applyAndroidPreset = () => {
    setScreenHue('low_light')
    setDisplayTuning({
      glass_intensity: 0.42,
      panel_opacity: 0.52,
      panel_gap_px: 0,
      low_hud_brightness: 0.96,
      low_map_brightness: 0.14,
      red_hue_rotate: -62,
      red_saturation: 0.54,
      red_brightness: 0.68,
    })
    updatePanel('location', { x: 980, y: 60, docked: false, minimized: false })
    updatePanel('voice', { x: 980, y: 280, docked: false, minimized: false })
    updatePanel('sos', { x: 980, y: 500, docked: false, minimized: false })
  }

  const applyTabletPreset = () => {
    setScreenHue('bright_day')
    setDisplayTuning({
      glass_intensity: 0.5,
      panel_opacity: 0.5,
      panel_gap_px: 0,
      low_hud_brightness: 0.9,
      low_map_brightness: 0.16,
      red_hue_rotate: -62,
      red_saturation: 0.52,
      red_brightness: 0.66,
    })
    updatePanel('layers', { x: 16, y: 60, docked: false, minimized: false })
    updatePanel('waypoints', { x: 20, y: 420, docked: false, minimized: false })
    updatePanel('voice', { x: 1180, y: 280, docked: false, minimized: false })
    updatePanel('sos', { x: 1180, y: 520, docked: false, minimized: false })
  }

  const applyWindowsPreset = () => {
    setScreenHue('bright_day')
    setDisplayTuning({
      glass_intensity: 0.46,
      panel_opacity: 0.5,
      panel_gap_px: 0,
      low_hud_brightness: 0.92,
      low_map_brightness: 0.15,
      red_hue_rotate: -62,
      red_saturation: 0.52,
      red_brightness: 0.66,
    })
    updatePanel('layers', { x: 16, y: 60, w: 180, docked: false, minimized: false })
    updatePanel('waypoints', { x: 20, y: 420, w: 340, docked: false, minimized: false })
    updatePanel('display', { x: 980, y: 60, w: 300, docked: false, minimized: false })
    updatePanel('location', { x: 980, y: 260, w: 320, docked: false, minimized: false })
    updatePanel('voice', { x: 980, y: 500, w: 340, docked: false, minimized: false })
  }

  const setEdgeConnectSpacing = () => {
    setDisplayTuning({ panel_gap_px: 0 })
  }

  const setComfortSpacing = () => {
    setDisplayTuning({ panel_gap_px: 10 })
  }

  const btn: CSSProperties = {
    minHeight: tapMin,
    borderRadius: 8,
    border: '1px solid rgba(199,206,198,0.32)',
    background: 'rgba(199,206,198,0.14)',
    color: '#d6ddd6',
    cursor: 'pointer',
    fontSize: fontSm,
    letterSpacing: '0.08em',
  }

  return (
    <HudPanel
      panelId="presets"
      title="Mission Presets"
      initialPos={{ x: 940, y: 320 }}
      initialWidth={260}
      minHeight={150}
    >
      <div style={{ display: 'grid', gap: gapMd }}>
        <button type="button" data-no-drag onClick={applyNightPatrol} style={btn}>
          NIGHT PATROL
        </button>
        <button type="button" data-no-drag onClick={applyDayNav} style={btn}>
          DAY NAV
        </button>
        <button type="button" data-no-drag onClick={applyRecon} style={btn}>
          RECON
        </button>
      </div>
      <div
        style={{
          marginTop: 10,
          paddingTop: gapMd,
          borderTop: '1px solid rgba(199,206,198,0.2)',
          display: 'grid',
          gap: gapMd,
        }}
      >
        <div style={{ fontSize: fontSm, letterSpacing: '0.1em', color: '#a8b2aa' }}>
          DEVICE TUNING
        </div>
        <button type="button" data-no-drag onClick={applyIPhonePreset} style={btn}>
          IPHONE
        </button>
        <button type="button" data-no-drag onClick={applyAndroidPreset} style={btn}>
          ANDROID
        </button>
        <button type="button" data-no-drag onClick={applyTabletPreset} style={btn}>
          TABLET
        </button>
        <button type="button" data-no-drag onClick={applyWindowsPreset} style={btn}>
          WINDOWS
        </button>
        <button type="button" data-no-drag onClick={applyDeviceOptimization} style={btn}>
          OPTIMIZE THIS DEVICE ({devicePreset.toUpperCase()})
        </button>
        <div style={{ display: 'grid', gap: gapSm, marginTop: 4 }}>
          <div style={{ fontSize: fontSm, letterSpacing: '0.1em', color: '#a8b2aa' }}>
            PANEL SPACING
          </div>
          <div style={{ display: 'flex', gap: gapMd }}>
            <button type="button" data-no-drag onClick={setEdgeConnectSpacing} style={{ ...btn, flex: 1 }}>
              EDGE CONNECT
            </button>
            <button type="button" data-no-drag onClick={setComfortSpacing} style={{ ...btn, flex: 1 }}>
              COMFORT GAP
            </button>
          </div>
        </div>
      </div>
    </HudPanel>
  )
}
