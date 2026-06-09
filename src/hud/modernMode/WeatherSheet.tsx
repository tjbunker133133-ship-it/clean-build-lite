/**
 * WeatherSheet — Modern Mode
 *
 * Immersive, spatial, premium weather experience for the Modern Layer.
 *
 * Data sources:
 *   - Current conditions: PanelDataContext (real Open-Meteo via GPS)
 *   - Hourly forecast: Open-Meteo hourly endpoint (fetched here, isolated)
 *   - Field: read-only intent readout; expression derived via FIM
 *
 * Design: Apple Maps-inspired — large temp, minimal chrome, map-connected feel.
 * No cockpit styling. No dense dashboard layouts. Touch-friendly.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { usePanelData } from '../../context/PanelDataContext'
import { isWeatherSuccess, formatWeatherAge, weatherDescription } from '../../lib/weather'
import { getFieldIntent, subscribeFieldIntent } from '../../lib/fieldIntentStore'
import { computeFieldState, fieldIntentLabel } from '../../lib/fieldIntentModel'
import { useWeatherAtmosphere } from '../../hooks/useWeatherAtmosphere'
import { useSyncExternalStore } from 'react'
import { ModernSheetCloseButton, ModernSheetDragHandle } from './ModernSheetChrome'
import { MODERN_SHEET } from './modernVisualTokens'
import { logModernGuardrailApplied } from '../../lib/modernLayerGuardrails'
import { getDeviceProfile } from '../../runtime/deviceProfile'
import {
  getRadarEnabled,
  getRadarOpacity,
  setRadarEnabled,
  setRadarOpacity,
  subscribeRadar,
} from '../../lib/modernRadarStore'

logModernGuardrailApplied('WeatherSheet')

// ─── Types ─────────────────────────────────────────────────────────────────────

interface HourlyRow {
  timeUnix: number
  temp: number
  precipChance: number
  weatherCode: number
}

// ─── Weather icon from WMO code ────────────────────────────────────────────────

function weatherIcon(code: number): string {
  if (code === 0 || code === 1) return '☀️'
  if (code === 2) return '⛅'
  if (code === 3) return '☁️'
  if (code === 45 || code === 48) return '🌫️'
  if (code >= 51 && code <= 57) return '🌦️'
  if (code >= 61 && code <= 67) return '🌧️'
  if (code >= 71 && code <= 77) return '❄️'
  if (code >= 80 && code <= 82) return '🌦️'
  if (code >= 83 && code <= 86) return '🌨️'
  if (code >= 95) return '⛈️'
  return '🌤️'
}

function formatHour(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  const h = d.getHours()
  if (h === 0) return '12 AM'
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

// ─── Hourly forecast hook ──────────────────────────────────────────────────────

function useForecast(lat: number | null, lng: number | null) {
  const [forecast, setForecast] = useState<HourlyRow[]>([])
  const [loading, setLoading] = useState(false)

  const coordKey = lat != null && lng != null ? `${lat.toFixed(2)},${lng.toFixed(2)}` : null

  useEffect(() => {
    if (!coordKey || lat == null || lng == null) return
    let cancelled = false
    setLoading(true)

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lng}` +
      `&hourly=temperature_2m,precipitation_probability,weathercode` +
      `&forecast_days=1&temperature_unit=fahrenheit&timezone=auto&timeformat=unixtime`

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const times: number[] = data.hourly?.time ?? []
        const temps: number[] = data.hourly?.temperature_2m ?? []
        const precip: number[] = data.hourly?.precipitation_probability ?? []
        const codes: number[] = data.hourly?.weathercode ?? []

        const nowUnix = Math.floor(Date.now() / 1000)
        const rows: HourlyRow[] = []
        for (let i = 0; i < times.length && rows.length < 12; i++) {
          if (times[i] >= nowUnix - 1800) {
            rows.push({
              timeUnix: times[i],
              temp: Math.round(temps[i] ?? 0),
              precipChance: Math.round(precip[i] ?? 0),
              weatherCode: codes[i] ?? 0,
            })
          }
        }
        setForecast(rows)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordKey])

  return { forecast, loading }
}

// ─── Severity helpers ──────────────────────────────────────────────────────────

function severityColor(s: string): string {
  if (s === 'warning') return '#FF3B30'
  if (s === 'watch') return '#FF9500'
  if (s === 'advisory') return '#007AFF'
  return '#8E8E93'
}

// ─── Styles (shared) ───────────────────────────────────────────────────────────

const FONT_DISPLAY = '-apple-system, SF Pro Display, system-ui, sans-serif'
const FONT_TEXT = '-apple-system, SF Pro Text, system-ui, sans-serif'

// ─── Sub-components ────────────────────────────────────────────────────────────

function TabBar({
  active,
  onChange,
}: {
  active: 'current' | 'hourly' | 'radar'
  onChange: (t: 'current' | 'hourly' | 'radar') => void
}) {
  return (
    <div style={{ display: 'flex', padding: '10px 20px', gap: 8 }}>
      {(['current', 'hourly', 'radar'] as const).map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          style={{
            padding: '7px 14px',
            borderRadius: 10,
            border: 'none',
            background:
              active === tab ? 'rgba(0,122,255,0.9)' : 'rgba(255,255,255,0.08)',
            color: active === tab ? 'white' : 'rgba(255,255,255,0.65)',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: FONT_TEXT,
            cursor: 'pointer',
            transition: 'all 150ms ease',
            textTransform: 'capitalize',
            letterSpacing: '0.01em',
          }}
        >
          {tab === 'radar' ? '⛈ Radar' : tab}
        </button>
      ))}
    </div>
  )
}

function CurrentTab({
  weather,
  weatherLoading,
  atmosphere,
  variant = 'modern',
}: {
  weather: ReturnType<typeof usePanelData>['weather']
  weatherLoading: boolean
  atmosphere: ReturnType<typeof useWeatherAtmosphere>
  variant?: 'modern' | 'balanced'
}) {
  if (weatherLoading && !isWeatherSuccess(weather)) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontFamily: FONT_TEXT }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>🌤️</div>
        <div>Fetching conditions…</div>
      </div>
    )
  }

  if (!isWeatherSuccess(weather)) {
    const errMsg = weather && 'error' in weather ? weather.error : 'Location unavailable'
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>⚠️</div>
        <div style={{ color: '#FF3B30', fontFamily: FONT_TEXT, fontSize: 15 }}>Unable to load weather</div>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontFamily: FONT_TEXT, fontSize: 13, marginTop: 6 }}>{errMsg}</div>
      </div>
    )
  }

  const icon = weatherIcon(weather.weatherCode)
  const ageStr = formatWeatherAge(weather.updatedAt)
  const isStale = weather.stale === true

  const details = [
    { label: 'Wind', value: `${Math.round(weather.windSpeed)} ${weather.windUnit}`, icon: '💨' },
    { label: 'Humidity', value: `${weather.humidity}%`, icon: '💧' },
  ]

  const heroGradient =
    atmosphere.tone === 'storm'
      ? 'linear-gradient(135deg, rgba(48,52,120,0.55) 0%, rgba(20,24,48,0.35) 100%)'
      : atmosphere.tone === 'rain' || atmosphere.tone === 'showers'
      ? 'linear-gradient(135deg, rgba(24,72,160,0.45) 0%, rgba(16,32,64,0.3) 100%)'
      : atmosphere.tone === 'snow'
      ? 'linear-gradient(135deg, rgba(140,180,255,0.35) 0%, rgba(32,40,64,0.25) 100%)'
      : atmosphere.tone === 'fog'
      ? 'linear-gradient(135deg, rgba(120,130,150,0.35) 0%, rgba(28,32,40,0.25) 100%)'
      : 'linear-gradient(135deg, rgba(0,122,255,0.28) 0%, rgba(255,159,10,0.12) 55%, rgba(20,24,32,0.2) 100%)'

  return (
    <div style={{ padding: variant === 'balanced' ? '0 16px 20px' : '0 20px 24px' }}>
      {/* Hero: temp + condition */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: variant === 'balanced' ? '22px 18px' : '20px 20px',
          background: variant === 'balanced' ? heroGradient : (
            atmosphere.tone === 'storm'
              ? 'rgba(40,55,130,0.18)'
              : atmosphere.tone === 'rain' || atmosphere.tone === 'showers'
              ? 'rgba(30,70,160,0.14)'
              : atmosphere.tone === 'snow'
              ? 'rgba(180,200,255,0.10)'
              : atmosphere.tone === 'fog'
              ? 'rgba(160,170,190,0.10)'
              : 'rgba(0,122,255,0.08)'
          ),
          borderRadius: variant === 'balanced' ? 22 : 20,
          marginBottom: 16,
          border: variant === 'balanced' ? '1px solid rgba(255,255,255,0.08)' : 'none',
          boxShadow: variant === 'balanced' ? 'inset 0 1px 0 rgba(255,255,255,0.06)' : 'none',
          transition: 'background 3000ms ease',
        }}
      >
        <div>
          <div
            style={{
              fontSize: variant === 'balanced' ? 72 : 64,
              fontWeight: 200,
              color: 'white',
              fontFamily: FONT_DISPLAY,
              letterSpacing: '-0.04em',
              lineHeight: 1,
              textShadow: variant === 'balanced' ? '0 2px 24px rgba(0,0,0,0.35)' : 'none',
            }}
          >
            {weather.temperature}
            <span style={{ fontSize: 36, fontWeight: 300 }}>{weather.unit}</span>
          </div>
          <div
            style={{
              fontSize: 16,
              color: 'rgba(255,255,255,0.75)',
              fontFamily: FONT_TEXT,
              marginTop: 8,
            }}
          >
            {weather.condition}
          </div>
          {weather.location ? (
            <div
              style={{
                fontSize: 13,
                color: 'rgba(255,255,255,0.45)',
                fontFamily: FONT_TEXT,
                marginTop: 4,
              }}
            >
              {weather.location}
            </div>
          ) : null}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 60, lineHeight: 1.1 }}>{icon}</div>
          {isStale && (
            <div
              style={{
                fontSize: 11,
                color: 'rgba(255,200,80,0.8)',
                fontFamily: FONT_TEXT,
                marginTop: 4,
              }}
            >
              cached
            </div>
          )}
        </div>
      </div>

      {/* Field readout — balanced only */}
      {variant === 'balanced' && atmosphere.hasActiveWeather && (
        <div
          style={{
            marginBottom: 14,
            padding: '12px 14px',
            borderRadius: 14,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 22 }}>{weatherIcon(weather.weatherCode)}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.9)', fontFamily: FONT_TEXT }}>
              {atmosphere.label}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: FONT_TEXT, marginTop: 2 }}>
              {weatherDescription(weather.weatherCode)} · field conditions active
            </div>
          </div>
        </div>
      )}

      {/* Detail pills */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
        {details.map((d) => (
          <div
            key={d.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '11px 14px',
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 14,
            }}
          >
            <span style={{ fontSize: 18 }}>{d.icon}</span>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontFamily: FONT_TEXT, marginBottom: 2 }}>
                {d.label}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.9)', fontFamily: FONT_TEXT }}>
                {d.value}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Update age */}
      <div
        style={{
          textAlign: 'center',
          fontSize: 12,
          color: 'rgba(255,255,255,0.3)',
          fontFamily: FONT_TEXT,
        }}
      >
        Updated {ageStr}
      </div>
    </div>
  )
}

function HourlyTab({ forecast, loading }: { forecast: HourlyRow[]; loading: boolean }) {
  if (loading) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontFamily: FONT_TEXT }}>
        Loading forecast…
      </div>
    )
  }
  if (forecast.length === 0) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontFamily: FONT_TEXT }}>
        Forecast unavailable
      </div>
    )
  }

  return (
    <div style={{ padding: '0 20px 24px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {forecast.map((row, i) => {
        const isNow = i === 0
        const icon = weatherIcon(row.weatherCode)
        const hasPrecip = row.precipChance > 20
        return (
          <div
            key={row.timeUnix}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '12px 16px',
              background: isNow ? 'rgba(0,122,255,0.10)' : 'rgba(255,255,255,0.03)',
              borderRadius: 14,
              border: isNow ? '1px solid rgba(0,122,255,0.22)' : 'none',
            }}
          >
            <div
              style={{
                width: 52,
                fontSize: 14,
                fontWeight: 600,
                color: isNow ? 'rgba(100,170,255,0.95)' : 'rgba(255,255,255,0.65)',
                fontFamily: FONT_TEXT,
              }}
            >
              {isNow ? 'Now' : formatHour(row.timeUnix)}
            </div>
            <div style={{ width: 36, textAlign: 'center', fontSize: 22 }}>{icon}</div>
            <div
              style={{
                flex: 1,
                fontSize: 14,
                color: 'rgba(255,255,255,0.7)',
                fontFamily: FONT_TEXT,
                paddingLeft: 8,
              }}
            >
              {weatherDescription(row.weatherCode)}
            </div>
            <div
              style={{
                fontSize: 17,
                fontWeight: 600,
                color: 'white',
                fontFamily: FONT_TEXT,
                width: 46,
                textAlign: 'right',
              }}
            >
              {row.temp}°
            </div>
            <div
              style={{
                width: 46,
                textAlign: 'right',
                fontSize: 13,
                color: hasPrecip ? '#5AC8FA' : 'rgba(255,255,255,0.3)',
                fontFamily: FONT_TEXT,
                fontWeight: hasPrecip ? 600 : 400,
              }}
            >
              {row.precipChance > 0 ? `${row.precipChance}%` : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RadarTab({ variant = 'modern' }: { variant?: 'modern' | 'balanced' }) {
  const fieldIntent = useSyncExternalStore(subscribeFieldIntent, getFieldIntent)
  const fieldState = useMemo(() => computeFieldState(fieldIntent), [fieldIntent])
  const radarEnabled = useSyncExternalStore(subscribeRadar, getRadarEnabled, getRadarEnabled)
  const radarOpacity = useSyncExternalStore(subscribeRadar, getRadarOpacity, getRadarOpacity)
  const isBalanced = variant === 'balanced'

  if (isBalanced) {
    return (
      <div style={{ padding: '16px 20px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            padding: '20px 18px',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 18,
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.92)', fontFamily: FONT_TEXT }}>
            Precipitation radar
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', fontFamily: FONT_TEXT, marginTop: 6, lineHeight: 1.55 }}>
            Live RainViewer tiles on the map. Toggle from Layers or here.
          </div>
        </div>

        <button
          type="button"
          data-testid="balanced-radar-toggle"
          onClick={() => setRadarEnabled(!radarEnabled)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px',
            borderRadius: 14,
            border: `1px solid ${radarEnabled ? 'rgba(10,132,255,0.5)' : 'rgba(255,255,255,0.08)'}`,
            background: radarEnabled ? 'rgba(10,132,255,0.12)' : 'rgba(255,255,255,0.04)',
            color: 'rgba(255,255,255,0.92)',
            cursor: 'pointer',
            fontFamily: FONT_TEXT,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <span>Radar on map</span>
          <span style={{ color: radarEnabled ? '#0a84ff' : 'rgba(255,255,255,0.45)' }}>
            {radarEnabled ? 'On' : 'Off'}
          </span>
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label
            htmlFor="balanced-radar-opacity"
            style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: FONT_TEXT }}
          >
            Radar opacity
          </label>
          <input
            id="balanced-radar-opacity"
            type="range"
            min={0.15}
            max={0.85}
            step={0.05}
            value={radarOpacity}
            disabled={!radarEnabled}
            onChange={(e) => setRadarOpacity(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: FONT_TEXT, lineHeight: 1.5 }}>
          Radar data © RainViewer. Coverage varies by region and refresh interval (~5 min).
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '16px 20px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          padding: '20px 18px',
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 18,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.92)', fontFamily: FONT_TEXT }}>
          Environmental presence
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', fontFamily: FONT_TEXT, marginTop: 6, lineHeight: 1.55 }}>
          The air in the system — motion, pressure, and weather currents woven into the landscape.
          Always felt, never switched off.
        </div>
      </div>

      {/* Hidden from user view; retained for diagnostics */}
      <div data-testid="field-intent-readout" aria-hidden style={{ display: 'none' }}>
        {fieldIntentLabel(fieldIntent)} {Math.round(fieldState.fieldPresence * 100)}
      </div>

      <div
        style={{
          padding: '16px 18px',
          background: 'radial-gradient(ellipse at 50% 0%, rgba(64,108,168,0.14) 0%, rgba(255,255,255,0.03) 70%)',
          borderRadius: 16,
          border: '1px solid rgba(255,255,255,0.04)',
        }}
      >
        <div style={{ fontSize: 13, color: 'rgba(180,210,255,0.75)', fontFamily: FONT_TEXT, lineHeight: 1.6 }}>
          You are inside the field, not viewing a layer on top of a map.
          Density shifts as you move — street fog, mid-range flow bands, regional storm systems.
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

interface WeatherSheetProps {
  onClose: () => void
  variant?: 'modern' | 'balanced'
}

export default function WeatherSheet({ onClose, variant = 'modern' }: WeatherSheetProps) {
  const { weather, weatherLoading, userLocation } = usePanelData()
  const atmosphere = useWeatherAtmosphere()
  const [tab, setTab] = useState<'current' | 'hourly' | 'radar'>('current')
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const isBalanced = variant === 'balanced'
  const sheetMaxWidth = isBalanced && isMobile ? '100%' : 520
  const shellPosition = isBalanced ? 'absolute' as const : 'fixed' as const

  const { forecast, loading: forecastLoading } = useForecast(
    userLocation?.lat ?? null,
    userLocation?.lng ?? null,
  )

  // Accent color shifts with weather
  const accentColor =
    atmosphere.tone === 'storm'
      ? '#5055C0'
      : atmosphere.tone === 'rain' || atmosphere.tone === 'showers'
      ? '#2060C0'
      : atmosphere.tone === 'snow'
      ? '#70A0E0'
      : atmosphere.tone === 'fog'
      ? '#808090'
      : '#007AFF'

  return (
    <div
      className={isBalanced ? 'balanced-weather-sheet' : 'modern-spatial-sheet'}
      data-sheet-layer={variant}
      data-testid="weather-sheet"
      style={{
        position: shellPosition,
        bottom: 0,
        left: 0,
        right: 0,
        top: isBalanced ? 0 : undefined,
        zIndex: isBalanced ? 1 : 5000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        pointerEvents: isBalanced ? 'auto' : 'none',
        padding: isBalanced
          ? `0 ${isMobile ? 0 : 16}px calc(${isMobile ? 8 : 20}px + env(safe-area-inset-bottom))`
          : '0 16px calc(20px + env(safe-area-inset-bottom))',
        background: isBalanced ? 'rgba(0,0,0,0.42)' : 'transparent',
      }}
      onClick={isBalanced ? onClose : undefined}
    >
      <div
        onClick={isBalanced ? (e) => e.stopPropagation() : undefined}
        style={{
          width: '100%',
          maxWidth: sheetMaxWidth,
          maxHeight: isBalanced ? (isMobile ? 'min(88vh, 640px)' : 'min(78vh, 560px)') : undefined,
          overflowY: isBalanced ? 'auto' : undefined,
          background: isBalanced
            ? 'linear-gradient(180deg, rgba(22,24,32,0.97) 0%, rgba(14,16,22,0.98) 100%)'
            : MODERN_SHEET.background,
          borderRadius: isBalanced
            ? `${isMobile ? 20 : MODERN_SHEET.radiusTop}px ${isMobile ? 20 : MODERN_SHEET.radiusTop}px 0 0`
            : `${MODERN_SHEET.radiusTop}px ${MODERN_SHEET.radiusTop}px 32px 32px`,
          border: `1px solid ${isBalanced ? 'rgba(255,255,255,0.1)' : MODERN_SHEET.border}`,
          backdropFilter: MODERN_SHEET.blur,
          WebkitBackdropFilter: MODERN_SHEET.blur,
          boxShadow: `${MODERN_SHEET.shadow}, 0 -8px 40px ${accentColor}22`,
          pointerEvents: 'auto',
          overflow: 'hidden',
          animation: 'weatherSheetEnter 320ms cubic-bezier(0.22, 1, 0.36, 1)',
          transition: 'box-shadow 3000ms ease',
        }}
      >
        {/* ── Drag handle ────────────────────────────────────────────────── */}
        <ModernSheetDragHandle onDismiss={onClose} />

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 20px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            position: 'sticky',
            top: 0,
            zIndex: 3,
            background: 'linear-gradient(180deg, rgba(26,26,32,0.98) 0%, rgba(26,26,32,0.92) 100%)',
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 21,
                fontWeight: 700,
                color: 'rgba(255,255,255,0.94)',
                fontFamily: FONT_DISPLAY,
                letterSpacing: '-0.02em',
              }}
            >
              Weather
            </h2>
            {atmosphere.hasActiveWeather && (
              <div
                style={{
                  marginTop: 3,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '3px 9px',
                  borderRadius: 8,
                  background: `${accentColor}22`,
                  border: `1px solid ${accentColor}40`,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, color: accentColor, fontFamily: FONT_TEXT, letterSpacing: '0.03em' }}>
                  {atmosphere.label.toUpperCase()}
                </span>
              </div>
            )}
          </div>
          <ModernSheetCloseButton onClose={onClose} label="Close weather" />
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────────── */}
        <TabBar active={tab} onChange={setTab} />

        {/* ── Content ────────────────────────────────────────────────────── */}
        {tab === 'current' && (
          <CurrentTab weather={weather} weatherLoading={weatherLoading} atmosphere={atmosphere} variant={variant} />
        )}
        {tab === 'hourly' && (
          <HourlyTab forecast={forecast} loading={forecastLoading} />
        )}
        {tab === 'radar' && <RadarTab variant={variant} />}
      </div>

      <style>{`
        @keyframes weatherSheetEnter {
          from { opacity: 0; transform: translateY(60px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
