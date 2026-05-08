import type { CSSProperties } from 'react'
import { useCockpit } from '../context/CockpitContext'
import type { CockpitPrefs, ScreenHueMode } from '../types/cockpit'
import { getDeviceProfile } from '../runtime/deviceProfile'
import { touchFontSm, touchGapMd, touchMinTarget } from './tokens'

// ⚠️ LOCKED SYSTEM — Behavior Freeze Active
// Any change to interaction, layout, display modes, or layers requires explicit approval.

const HUE_BUTTONS: { mode: ScreenHueMode; label: string; hint: string }[] = [
  { mode: 'low_light', label: 'LOW LIGHT', hint: 'near-black battery saver' },
  { mode: 'bright_day', label: 'BRIGHT DAY', hint: 'maximum daylight readability' },
  { mode: 'red_tactical', label: 'RED OPS', hint: 'night-adapted HUD; panels use brighter red text & borders' },
]

type DisplayBodyProps = {
  active: ScreenHueMode
  fontSm: number
  gapMd: number
  tapMin: number
  sliderStyle: CSSProperties
  prefs: CockpitPrefs
  setScreenHue: (m: ScreenHueMode) => void
  setDisplayTuning: ReturnType<typeof useCockpit>['setDisplayTuning']
  applyNightPreset: () => void
  resetCurrentMode: () => void
}

/** Shared display-mode UI (Positional Awareness suite). */
export function DisplayModePanelBodyInner({
  active,
  fontSm,
  gapMd,
  tapMin,
  sliderStyle,
  prefs,
  setScreenHue,
  setDisplayTuning,
  applyNightPreset,
  resetCurrentMode,
}: DisplayBodyProps) {
  return (
    <>
      <div style={{ display: 'grid', gap: gapMd }}>
        {HUE_BUTTONS.map(({ mode, label, hint }) => {
          const on = active === mode
          return (
            <button
              key={mode}
              type="button"
              data-no-drag
              onClick={() => setScreenHue(mode)}
              style={{
                minHeight: tapMin,
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
              <div style={{ fontSize: fontSm, letterSpacing: '0.12em', fontWeight: 700 }}>
                {label}
              </div>
              <div style={{ fontSize: fontSm, opacity: 0.85 }}>{hint}</div>
            </button>
          )
        })}
      </div>
      <div style={{ marginTop: 10, borderTop: '1px solid rgba(199,206,198,0.2)', paddingTop: 10 }}>
        <div style={{ display: 'flex', gap: gapMd, marginBottom: gapMd }}>
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
        {active === 'low_light' && (
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
        {active === 'bright_day' && (
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
        {active === 'red_tactical' && (
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
      </div>
    </>
  )
}

export function DisplayModePanelBody() {
  const { prefs, setScreenHue, setDisplayTuning } = useCockpit()
  const active = prefs.screen_hue
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const gapMd = touchGapMd(isMobile)
  const tapMin = Math.max(touchMinTarget(isMobile), 48)
  const sliderStyle: CSSProperties = {
    width: '100%',
    accentColor: active === 'red_tactical' ? '#ff5c7a' : '#9fe4ad',
  }
  const resetCurrentMode = () => {
    if (active === 'low_light') {
      setDisplayTuning({ low_hud_brightness: 0.96, low_map_brightness: 0.2 })
      return
    }
    if (active === 'bright_day') {
      setDisplayTuning({ bright_hud_brightness: 1.32, bright_map_brightness: 1.18 })
      return
    }
    if (active === 'red_tactical') {
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
    <DisplayModePanelBodyInner
      active={active}
      fontSm={fontSm}
      gapMd={gapMd}
      tapMin={tapMin}
      sliderStyle={sliderStyle}
      prefs={prefs}
      setScreenHue={setScreenHue}
      setDisplayTuning={setDisplayTuning}
      applyNightPreset={applyNightPreset}
      resetCurrentMode={resetCurrentMode}
    />
  )
}
