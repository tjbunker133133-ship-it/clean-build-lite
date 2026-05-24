import type { CSSProperties } from 'react'
import HudPanel from './HudPanel'
import { useAppContext } from '../context/AppContext'
import { useCockpit } from '../context/CockpitContext'
import { useMapContext } from '../context/MapContext'
import type { LayerType } from '../types'
import type { ScreenHueMode } from '../types/cockpit'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchGapMd, touchGapSm, touchMinTarget } from './tokens'

const LAYERS: { id: LayerType; label: string }[] = [
  { id: 'streets', label: 'Streets' },
  { id: 'topo', label: 'Topo' },
  { id: 'outdoor', label: 'Outdoor' },
  { id: 'satellite', label: 'Satellite' },
]

const HUE_BUTTONS: { mode: ScreenHueMode; label: string; hint: string }[] = [
  { mode: 'low_light', label: 'LOW LIGHT', hint: 'near-black battery saver' },
  { mode: 'bright_day', label: 'BRIGHT DAY', hint: 'maximum daylight readability' },
  { mode: 'red_tactical', label: 'RED OPS', hint: 'night-adapted HUD; panels use brighter red text & borders' },
]

const sectionLabelStyle: CSSProperties = {
  fontSize: '0.72rem',
  letterSpacing: '0.14em',
  color: '#a8b2aa',
  margin: 0,
}

export default function LayerPanel() {
  const { state, setLayer } = useAppContext()
  const { activeLayer } = state
  const { status: mapStatus } = useMapContext()
  const { prefs, setScreenHue, setDisplayTuning } = useCockpit()
  const activeHue = prefs.screen_hue
  const mapBusy = mapStatus === 'initial'
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const gapSm = touchGapSm(isMobile)
  const gapMd = touchGapMd(isMobile)
  const tapMin = touchMinTarget(isMobile)

  const sliderStyle: CSSProperties = {
    width: '100%',
    accentColor: activeHue === 'red_tactical' ? '#ff5c7a' : '#9fe4ad',
  }

  const resetCurrentMode = () => {
    if (activeHue === 'low_light') {
      setDisplayTuning({ low_hud_brightness: 0.96, low_map_brightness: 0.2 })
      return
    }
    if (activeHue === 'bright_day') {
      setDisplayTuning({ bright_hud_brightness: 1.32, bright_map_brightness: 1.18 })
      return
    }
    if (activeHue === 'red_tactical') {
      setDisplayTuning({ red_hue_rotate: -50, red_saturation: 0.6, red_brightness: 0.68 })
    }
  }

  const applyNightPreset = () => {
    setDisplayTuning({
      low_hud_brightness: 0.98,
      low_map_brightness: 0.34,
      bright_hud_brightness: 1.32,
      bright_map_brightness: 1.18,
      red_hue_rotate: -50,
      red_saturation: 0.6,
      red_brightness: 0.66,
    })
  }

  return (
    <HudPanel
      panelId="layers"
      title="Map & display"
      initialPos={{ x: 16, y: 60 }}
      initialWidth={280}
      minHeight={280}
    >
      <div style={{ display: 'grid', gap: gapMd }}>
        <section style={{ display: 'grid', gap: gapSm }}>
          <p style={sectionLabelStyle}>BASE LAYERS</p>
          <div
            role="group"
            aria-label="Basemap preset"
            aria-busy={mapBusy}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: gapSm,
              opacity: mapBusy ? 0.92 : 1,
              transition: 'opacity 160ms ease',
            }}
          >
            {LAYERS.map((layer) => {
              const active = activeLayer === layer.id
              const title =
                active && mapBusy
                  ? `${layer.label} — loading map…`
                  : `${layer.label} basemap`

              return (
                <button
                  key={layer.id}
                  type="button"
                  data-no-drag
                  aria-pressed={active}
                  title={title}
                  onClick={() =>
                    setLayer(layer.id, {
                      force: active && mapBusy,
                    })
                  }
                  style={{
                    padding: '8px 10px',
                    fontSize: fontSm,
                    cursor: 'pointer',
                    borderRadius: 4,
                    border: active
                      ? '1px solid rgba(199,206,198,0.65)'
                      : '1px solid rgba(255,255,255,0.16)',
                    background: active ? 'rgba(199,206,198,0.14)' : 'rgba(6,6,6,0.6)',
                    color: active ? '#c7cec6' : '#aeb4ad',
                    fontFamily: 'var(--font-mono)',
                    letterSpacing: '0.05em',
                    textAlign: 'left',
                    minHeight: tapMin,
                  }}
                >
                  {layer.label.toUpperCase()}
                </button>
              )
            })}
          </div>
        </section>

        <section
          style={{
            display: 'grid',
            gap: gapMd,
            borderTop: '1px solid rgba(199,206,198,0.2)',
            paddingTop: gapMd,
          }}
        >
          <p style={sectionLabelStyle}>DISPLAY MODES</p>
          {HUE_BUTTONS.map(({ mode, label, hint }) => {
            const on = activeHue === mode
            return (
              <button
                key={mode}
                type="button"
                data-no-drag
                onClick={() => setScreenHue(mode)}
                style={{
                  minHeight: Math.max(tapMin, 46),
                  borderRadius: 8,
                  border: on
                    ? '1px solid rgba(199,206,198,0.72)'
                    : '1px solid rgba(199,206,198,0.22)',
                  background: on ? 'rgba(199,206,198,0.16)' : 'rgba(10,12,13,0.8)',
                  color: on ? '#d4dbd4' : 'var(--cockpit-panel-subtle)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  padding: '8px 10px',
                  boxShadow: on ? '0 0 10px rgba(199,206,198,0.2)' : 'none',
                }}
              >
                <div style={{ fontSize: fontSm, letterSpacing: '0.12em', fontWeight: 700 }}>{label}</div>
                <div style={{ fontSize: fontSm, opacity: 0.85 }}>{hint}</div>
              </button>
            )
          })}
          <div style={{ display: 'flex', gap: gapMd }}>
            <button
              type="button"
              data-no-drag
              onClick={applyNightPreset}
              style={{
                flex: 1,
                minHeight: tapMin,
                borderRadius: 6,
                border: '1px solid rgba(199,206,198,0.45)',
                background: 'rgba(199,206,198,0.14)',
                color: '#d8ded8',
                cursor: 'pointer',
                fontSize: fontSm,
                letterSpacing: '0.08em',
              }}
            >
              NIGHT PRESET
            </button>
            <button
              type="button"
              data-no-drag
              onClick={resetCurrentMode}
              style={{
                flex: 1,
                minHeight: tapMin,
                borderRadius: 6,
                border: '1px solid rgba(199,206,198,0.26)',
                background: 'rgba(10,12,13,0.82)',
                color: 'var(--cockpit-panel-subtle)',
                cursor: 'pointer',
                fontSize: fontSm,
                letterSpacing: '0.08em',
              }}
            >
              RESET THIS MODE
            </button>
          </div>
          {activeHue === 'low_light' && (
            <div style={{ display: 'grid', gap: gapMd }}>
              <label style={{ fontSize: fontSm, color: 'var(--cockpit-panel-subtle)', display: 'grid', gap: 4 }}>
                LOW HUD BRIGHTNESS ({prefs.low_hud_brightness.toFixed(2)})
                <input
                  type="range"
                  min={0.7}
                  max={1.2}
                  step={0.01}
                  value={prefs.low_hud_brightness}
                  data-no-drag
                  onChange={(e) => setDisplayTuning({ low_hud_brightness: Number(e.target.value) })}
                  style={sliderStyle}
                />
              </label>
              <label style={{ fontSize: fontSm, color: 'var(--cockpit-panel-subtle)', display: 'grid', gap: 4 }}>
                LOW MAP BRIGHTNESS ({prefs.low_map_brightness.toFixed(2)})
                <input
                  type="range"
                  min={0.2}
                  max={0.55}
                  step={0.01}
                  value={prefs.low_map_brightness}
                  data-no-drag
                  onChange={(e) => setDisplayTuning({ low_map_brightness: Number(e.target.value) })}
                  style={sliderStyle}
                />
              </label>
            </div>
          )}
          {activeHue === 'bright_day' && (
            <div style={{ display: 'grid', gap: gapMd }}>
              <label style={{ fontSize: fontSm, color: 'var(--cockpit-panel-subtle)', display: 'grid', gap: 4 }}>
                BRIGHT HUD BRIGHTNESS ({prefs.bright_hud_brightness.toFixed(2)})
                <input
                  type="range"
                  min={1.0}
                  max={1.6}
                  step={0.01}
                  value={prefs.bright_hud_brightness}
                  data-no-drag
                  onChange={(e) => setDisplayTuning({ bright_hud_brightness: Number(e.target.value) })}
                  style={sliderStyle}
                />
              </label>
              <label style={{ fontSize: fontSm, color: 'var(--cockpit-panel-subtle)', display: 'grid', gap: 4 }}>
                BRIGHT MAP BRIGHTNESS ({prefs.bright_map_brightness.toFixed(2)})
                <input
                  type="range"
                  min={1.0}
                  max={1.4}
                  step={0.01}
                  value={prefs.bright_map_brightness}
                  data-no-drag
                  onChange={(e) => setDisplayTuning({ bright_map_brightness: Number(e.target.value) })}
                  style={sliderStyle}
                />
              </label>
            </div>
          )}
          {activeHue === 'red_tactical' && (
            <div style={{ display: 'grid', gap: gapMd }}>
              <label style={{ fontSize: fontSm, color: 'var(--cockpit-panel-subtle)', display: 'grid', gap: 4 }}>
                RED HUE SHIFT ({prefs.red_hue_rotate} deg)
                <input
                  type="range"
                  min={-60}
                  max={-42}
                  step={1}
                  value={prefs.red_hue_rotate}
                  data-no-drag
                  onChange={(e) => setDisplayTuning({ red_hue_rotate: Number(e.target.value) })}
                  style={sliderStyle}
                />
              </label>
              <label style={{ fontSize: fontSm, color: 'var(--cockpit-panel-subtle)', display: 'grid', gap: 4 }}>
                RED SATURATION ({prefs.red_saturation.toFixed(2)})
                <input
                  type="range"
                  min={0.45}
                  max={0.95}
                  step={0.01}
                  value={prefs.red_saturation}
                  data-no-drag
                  onChange={(e) => setDisplayTuning({ red_saturation: Number(e.target.value) })}
                  style={sliderStyle}
                />
              </label>
              <label style={{ fontSize: fontSm, color: 'var(--cockpit-panel-subtle)', display: 'grid', gap: 4 }}>
                RED HUD BRIGHTNESS ({prefs.red_brightness.toFixed(2)})
                <input
                  type="range"
                  min={0.5}
                  max={0.95}
                  step={0.01}
                  value={prefs.red_brightness}
                  data-no-drag
                  onChange={(e) => setDisplayTuning({ red_brightness: Number(e.target.value) })}
                  style={sliderStyle}
                />
              </label>
            </div>
          )}
        </section>
      </div>
    </HudPanel>
  )
}
