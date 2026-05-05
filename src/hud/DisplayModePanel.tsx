import HudPanel from './HudPanel'
import { useCockpit } from '../context/CockpitContext'
import type { ScreenHueMode } from '../types/cockpit'

const HUE_BUTTONS: { mode: ScreenHueMode; label: string; hint: string }[] = [
  { mode: 'low_light', label: 'LOW LIGHT', hint: 'near-black battery saver' },
  { mode: 'bright_day', label: 'BRIGHT DAY', hint: 'maximum daylight readability' },
  { mode: 'red_tactical', label: 'RED OPS', hint: 'night vision red dominance' },
]

export default function DisplayModePanel() {
  const { prefs, setScreenHue, setDisplayTuning } = useCockpit()
  const active = prefs.screen_hue
  const resetCurrentMode = () => {
    if (active === 'low_light') {
      setDisplayTuning({ low_hud_brightness: 0.9, low_map_brightness: 0.14 })
      return
    }
    if (active === 'red_tactical') {
      setDisplayTuning({ red_hue_rotate: -58, red_saturation: 0.52, red_brightness: 0.68 })
    }
  }
  const applyNightPreset = () => {
    setDisplayTuning({
      low_hud_brightness: 0.92,
      low_map_brightness: 0.12,
      red_hue_rotate: -62,
      red_saturation: 0.5,
      red_brightness: 0.66,
    })
  }

  return (
    <HudPanel
      panelId="display"
      title="Display Modes"
      initialPos={{ x: 940, y: 60 }}
      initialWidth={280}
      minHeight={150}
    >
      <div style={{ display: 'grid', gap: 8 }}>
        {HUE_BUTTONS.map(({ mode, label, hint }) => {
          const on = active === mode
          return (
            <button
              key={mode}
              type="button"
              data-no-drag
              onClick={() => setScreenHue(mode)}
              style={{
                minHeight: 46,
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
              <div style={{ fontSize: 11, letterSpacing: '0.12em', fontWeight: 700 }}>
                {label}
              </div>
              <div style={{ fontSize: 10, opacity: 0.85 }}>{hint}</div>
            </button>
          )
        })}
      </div>
      <div style={{ marginTop: 10, borderTop: '1px solid rgba(199,206,198,0.2)', paddingTop: 10 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            data-no-drag
            onClick={applyNightPreset}
            style={{
              flex: 1,
              minHeight: 34,
              borderRadius: 6,
              border: '1px solid rgba(199,206,198,0.45)',
              background: 'rgba(199,206,198,0.14)',
              color: '#d8ded8',
              cursor: 'pointer',
              fontSize: 10,
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
              minHeight: 34,
              borderRadius: 6,
              border: '1px solid rgba(199,206,198,0.26)',
              background: 'rgba(10,12,13,0.82)',
              color: 'var(--cockpit-panel-subtle)',
              cursor: 'pointer',
              fontSize: 10,
              letterSpacing: '0.08em',
            }}
          >
            RESET THIS MODE
          </button>
        </div>
        {active === 'low_light' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 10, color: 'var(--cockpit-panel-subtle)', display: 'grid', gap: 4 }}>
              LOW HUD BRIGHTNESS ({prefs.low_hud_brightness.toFixed(2)})
              <input
                type="range"
                min={0.7}
                max={1.2}
                step={0.01}
                value={prefs.low_hud_brightness}
                data-no-drag
                onChange={(e) => setDisplayTuning({ low_hud_brightness: Number(e.target.value) })}
              />
            </label>
            <label style={{ fontSize: 10, color: 'var(--cockpit-panel-subtle)', display: 'grid', gap: 4 }}>
              LOW MAP BRIGHTNESS ({prefs.low_map_brightness.toFixed(2)})
              <input
                type="range"
                min={0.08}
                max={0.35}
                step={0.01}
                value={prefs.low_map_brightness}
                data-no-drag
                onChange={(e) => setDisplayTuning({ low_map_brightness: Number(e.target.value) })}
              />
            </label>
          </div>
        )}
        {active === 'red_tactical' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 10, color: 'var(--cockpit-panel-subtle)', display: 'grid', gap: 4 }}>
              RED HUE SHIFT ({prefs.red_hue_rotate} deg)
              <input
                type="range"
                min={-70}
                max={-20}
                step={1}
                value={prefs.red_hue_rotate}
                data-no-drag
                onChange={(e) => setDisplayTuning({ red_hue_rotate: Number(e.target.value) })}
              />
            </label>
            <label style={{ fontSize: 10, color: 'var(--cockpit-panel-subtle)', display: 'grid', gap: 4 }}>
              RED SATURATION ({prefs.red_saturation.toFixed(2)})
              <input
                type="range"
                min={0.45}
                max={1}
                step={0.01}
                value={prefs.red_saturation}
                data-no-drag
                onChange={(e) => setDisplayTuning({ red_saturation: Number(e.target.value) })}
              />
            </label>
            <label style={{ fontSize: 10, color: 'var(--cockpit-panel-subtle)', display: 'grid', gap: 4 }}>
              RED HUD BRIGHTNESS ({prefs.red_brightness.toFixed(2)})
              <input
                type="range"
                min={0.5}
                max={0.95}
                step={0.01}
                value={prefs.red_brightness}
                data-no-drag
                onChange={(e) => setDisplayTuning({ red_brightness: Number(e.target.value) })}
              />
            </label>
          </div>
        )}
      </div>
    </HudPanel>
  )
}
