import type { CSSProperties } from 'react'
import HudPanel from './HudPanel'
import { useCockpit } from '../context/CockpitContext'

export default function PresetPanel() {
  const { setScreenHue, setDisplayTuning, updatePanel, applyDeviceOptimization, devicePreset } = useCockpit()

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

  return (
    <HudPanel
      panelId="presets"
      title="Mission Presets"
      initialPos={{ x: 940, y: 320 }}
      initialWidth={260}
      minHeight={150}
    >
      <div style={{ display: 'grid', gap: 8 }}>
        <button type="button" data-no-drag onClick={applyNightPatrol} style={btnStyle()}>
          NIGHT PATROL
        </button>
        <button type="button" data-no-drag onClick={applyDayNav} style={btnStyle()}>
          DAY NAV
        </button>
        <button type="button" data-no-drag onClick={applyRecon} style={btnStyle()}>
          RECON
        </button>
      </div>
      <div
        style={{
          marginTop: 10,
          paddingTop: 8,
          borderTop: '1px solid rgba(199,206,198,0.2)',
          display: 'grid',
          gap: 8,
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: '0.1em', color: '#a8b2aa' }}>
          DEVICE TUNING
        </div>
        <button type="button" data-no-drag onClick={applyIPhonePreset} style={btnStyle()}>
          IPHONE
        </button>
        <button type="button" data-no-drag onClick={applyAndroidPreset} style={btnStyle()}>
          ANDROID
        </button>
        <button type="button" data-no-drag onClick={applyTabletPreset} style={btnStyle()}>
          TABLET
        </button>
        <button type="button" data-no-drag onClick={applyWindowsPreset} style={btnStyle()}>
          WINDOWS
        </button>
        <button type="button" data-no-drag onClick={applyDeviceOptimization} style={btnStyle()}>
          OPTIMIZE THIS DEVICE ({devicePreset.toUpperCase()})
        </button>
        <div style={{ display: 'grid', gap: 6, marginTop: 4 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.1em', color: '#a8b2aa' }}>
            PANEL SPACING
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" data-no-drag onClick={setEdgeConnectSpacing} style={{ ...btnStyle(), flex: 1 }}>
              EDGE CONNECT
            </button>
            <button type="button" data-no-drag onClick={setComfortSpacing} style={{ ...btnStyle(), flex: 1 }}>
              COMFORT GAP
            </button>
          </div>
        </div>
      </div>
    </HudPanel>
  )
}

function btnStyle(): CSSProperties {
  return {
    minHeight: 38,
    borderRadius: 8,
    border: '1px solid rgba(199,206,198,0.32)',
    background: 'rgba(199,206,198,0.14)',
    color: '#d6ddd6',
    cursor: 'pointer',
    fontSize: 11,
    letterSpacing: '0.08em',
  }
}
