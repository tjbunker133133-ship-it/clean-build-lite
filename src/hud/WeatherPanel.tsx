import { useCallback, useEffect, useState } from 'react'
import HudPanel from './HudPanel'
import { useGPS } from '../hooks/useGPS'
import { fetchWeather, type WeatherResult } from '../lib/weather'

export default function WeatherPanel() {
  const gps = useGPS()
  const [weather, setWeather] = useState<WeatherResult | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    const result = await fetchWeather(gps.lat, gps.lng)
    setWeather(result)
    setLoading(false)
  }, [gps.lat, gps.lng])

  useEffect(() => {
    if (gps.lat == null || gps.lng == null) return
    void refresh()
  }, [gps.lat, gps.lng, refresh])

  useEffect(() => {
    const id = window.setInterval(() => {
      void refresh()
    }, 120000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    const onRefresh = () => {
      void refresh()
    }
    window.addEventListener('hud:weather-refresh', onRefresh)
    return () => window.removeEventListener('hud:weather-refresh', onRefresh)
  }, [refresh])

  const hasData = !!weather && !('error' in weather)

  return (
    <HudPanel
      panelId="weather"
      title="Current Weather"
      initialPos={{ x: 1240, y: 520 }}
      initialWidth={300}
      minHeight={170}
    >
      <div style={{ display: 'grid', gap: 8 }}>
        <div
          style={{
            border: '1px solid rgba(199,206,198,0.28)',
            borderRadius: 8,
            padding: '8px 10px',
            background: 'rgba(10,12,13,0.55)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 28,
              color: '#d7ddd7',
              lineHeight: 1.2,
            }}
          >
            {hasData ? `${weather.temperature}${weather.unit}` : '--'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--cockpit-panel-subtle)' }}>
            {loading ? 'Updating weather...' : hasData ? weather.condition : 'Waiting for location...'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--cockpit-panel-subtle)', marginTop: 3 }}>
            {hasData ? weather.location : 'Location: --'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--cockpit-panel-subtle)', marginTop: 4 }}>
            Wind:{' '}
            {hasData
              ? `${Math.round(weather.windSpeed)} ${weather.windUnit}`
              : weather && 'error' in weather
                ? weather.error
                : '--'}
          </div>
        </div>
        <button
          type="button"
          data-no-drag
          onClick={() => void refresh()}
          style={{
            minHeight: 36,
            borderRadius: 8,
            border: '1px solid rgba(199,206,198,0.35)',
            background: 'rgba(199,206,198,0.14)',
            color: '#d6ddd6',
            cursor: 'pointer',
            fontSize: 11,
            letterSpacing: '0.08em',
          }}
        >
          UPDATE WEATHER
        </button>
      </div>
    </HudPanel>
  )
}
