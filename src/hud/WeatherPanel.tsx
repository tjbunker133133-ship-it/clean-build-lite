import HudPanel from './HudPanel'
import { usePanelData } from '../context/PanelDataContext'
import { useGPS } from '../hooks/useGPS'

export default function WeatherPanel() {
  const gps = useGPS()
  const {
    userLocation,
    weather,
    weatherLoading,
    panelsLocationBlocked,
    refreshPanelData,
  } = usePanelData()

  const coordsReady = userLocation != null && !panelsLocationBlocked
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
        {panelsLocationBlocked && (
          <p style={{ margin: 0, fontSize: 12, color: '#f0b4bf', lineHeight: 1.45 }}>
            Enable location to use weather and elevation features
          </p>
        )}
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
            {weatherLoading
              ? 'Updating weather...'
              : hasData
                ? weather.condition
                : coordsReady
                  ? 'Loading…'
                  : 'Waiting for location...'}
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
          disabled={!coordsReady}
          onClick={() => {
            console.log('[WEATHER REQUEST]', {
              lat: gps.lat,
              lng: gps.lng,
            })
            void refreshPanelData()
          }}
          style={{
            minHeight: 36,
            borderRadius: 8,
            border: '1px solid rgba(199,206,198,0.35)',
            background: coordsReady ? 'rgba(199,206,198,0.14)' : 'rgba(199,206,198,0.06)',
            color: coordsReady ? '#d6ddd6' : 'rgba(214,221,214,0.45)',
            cursor: coordsReady ? 'pointer' : 'not-allowed',
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
