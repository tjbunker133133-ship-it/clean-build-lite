import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import HudPanel from './HudPanel'
import { useMapContext } from '../context/MapContext'
import { usePanelData } from '../context/PanelDataContext'
import { useGPS } from '../hooks/useGPS'

type FollowZoomMode = 'fixed' | 'dynamic'

function zoomForAccuracy(accuracy: number | null): number {
  if (accuracy == null || Number.isNaN(accuracy)) return 14.2
  if (accuracy <= 8) return 16.4
  if (accuracy <= 20) return 15.4
  if (accuracy <= 50) return 14.4
  if (accuracy <= 120) return 13.7
  return 13
}

export default function LocationPanel() {
  const { map } = useMapContext()
  const { userLocation } = usePanelData()
  const gps = useGPS()
  const { requestLocation } = gps
  const [followLock, setFollowLock] = useState(false)
  const [zoomMode, setZoomMode] = useState<FollowZoomMode>('fixed')
  const lastFollowCenterRef = useRef<{ lat: number; lng: number } | null>(null)

  const isIOS = useMemo(
    () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent || ''),
    [],
  )

  useEffect(() => {
    if (!followLock) return
    if (!map) return
    if (gps.lat == null || gps.lng == null) return
    if (gps.locationState !== 'granted') return
    const prev = lastFollowCenterRef.current
    if (
      prev &&
      Math.abs(prev.lat - gps.lat) < 1e-7 &&
      Math.abs(prev.lng - gps.lng) < 1e-7
    ) {
      return
    }
    lastFollowCenterRef.current = { lat: gps.lat, lng: gps.lng }
    const zoom = zoomMode === 'dynamic' ? zoomForAccuracy(gps.accuracy) : map.getZoom()
    map.flyTo({
      center: [gps.lng, gps.lat],
      zoom,
      essential: true,
    })
  }, [followLock, gps.lat, gps.lng, gps.accuracy, gps.locationState, map, zoomMode])

  const jumpToMe = () => {
    console.log('[LOCATE CLICK]', { lat: gps.lat, lng: gps.lng, source: gps.source })
    if (!map) return
    if (gps.lat == null || gps.lng == null) return
    if (gps.locationState !== 'granted') return
    lastFollowCenterRef.current = { lat: gps.lat, lng: gps.lng }
    const zoom = zoomMode === 'dynamic' ? zoomForAccuracy(gps.accuracy) : Math.max(14, map.getZoom())
    map.flyTo({
      center: [gps.lng, gps.lat],
      zoom,
      essential: true,
    })
  }

  const hasFix = gps.lat != null && gps.lng != null && gps.locationState === 'granted'

  const gpsStatusText =
    gps.locationState === 'granted'
      ? 'LOCATION ON'
      : gps.locationState === 'requesting'
        ? 'REQUESTING…'
        : gps.locationState === 'denied'
          ? 'DENIED'
          : gps.locationState === 'error'
            ? 'ERROR'
            : 'OFF'

  const btnBase: CSSProperties = {
    minHeight: 44,
    borderRadius: 8,
    border: '1px solid rgba(199,206,198,0.35)',
    fontSize: 11,
    letterSpacing: '0.08em',
    fontWeight: 700,
    cursor: 'pointer',
  }

  return (
    <HudPanel
      panelId="location"
      title="Location"
      initialPos={{ x: 1220, y: 60 }}
      initialWidth={300}
      minHeight={170}
    >
      <div style={{ display: 'grid', gap: 10 }}>
        {gps.locationState === 'idle' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 12, color: '#9fb0c7', lineHeight: 1.45 }}>
              Location is off. Enable it when you need GPS for weather, follow mode, and coordinates. Nothing is requested
              until you tap below.
            </p>
            <button
              type="button"
              data-no-drag
              onClick={() => void requestLocation()}
              style={{
                ...btnBase,
                background: 'rgba(125,255,138,0.18)',
                borderColor: 'rgba(125,255,138,0.55)',
                color: '#d8f6de',
              }}
            >
              ENABLE LOCATION
            </button>
          </div>
        )}

        {gps.locationState === 'requesting' && (
          <p style={{ margin: 0, fontSize: 12, color: '#c7cec6' }}>Waiting for browser location prompt…</p>
        )}

        {(gps.locationState === 'denied' || gps.locationState === 'error') && (
          <div
            style={{
              display: 'grid',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid rgba(255,107,135,0.45)',
              background: 'rgba(40,12,20,0.4)',
            }}
          >
            <p style={{ margin: 0, fontSize: 12, color: '#ffd0d8' }}>Location access is blocked or failed.</p>
            {isIOS && gps.locationState === 'denied' ? (
              <div style={{ fontSize: 11, color: '#e2c2c8', lineHeight: 1.5 }}>
                <p style={{ margin: '0 0 6px' }}>On iPhone / iPad (Safari):</p>
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  <li>Open Settings</li>
                  <li>Go to Safari</li>
                  <li>Enable Location Access for this site (or set to Ask / Allow)</li>
                </ol>
                <p style={{ margin: '8px 0 0', fontSize: 10, color: '#b89da3' }}>
                  You can also try: Settings → Privacy & Security → Location Services → Safari Websites.
                </p>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 11, color: '#e2c2c8', lineHeight: 1.45 }}>
                To enable: use your browser site settings and allow location for this app. On desktop: check the lock icon
                in the address bar.
              </p>
            )}
            {gps.error && (
              <p style={{ margin: 0, fontSize: 10, color: '#b89da3', fontFamily: 'var(--font-mono, monospace)' }}>
                {gps.error}
              </p>
            )}
            <button
              type="button"
              data-no-drag
              onClick={() => void requestLocation()}
              style={{
                ...btnBase,
                background: 'rgba(199,206,198,0.14)',
                color: '#d6ddd6',
              }}
            >
              TRY AGAIN
            </button>
          </div>
        )}

        <div
          style={{
            border: '1px solid rgba(199,206,198,0.28)',
            borderRadius: 8,
            padding: '8px 10px',
            background: 'rgba(10,12,13,0.55)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 12,
            color: '#c7cec6',
            lineHeight: 1.5,
          }}
        >
          {hasFix ? (
            <>
              <div>
                LAT{' '}
                {(userLocation?.lat ?? gps.lat) != null
                  ? (userLocation?.lat ?? gps.lat)!.toFixed(6)
                  : '—'}
              </div>
              <div>
                LNG{' '}
                {(userLocation?.lng ?? gps.lng) != null
                  ? (userLocation?.lng ?? gps.lng)!.toFixed(6)
                  : '—'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--cockpit-panel-subtle)' }}>
                {gpsStatusText} · ACC {gps.accuracy != null ? `${Math.round(gps.accuracy)} m` : '—'}
              </div>
              {gps.elevation != null && Number.isFinite(gps.elevation) && (
                <div className="hud-readout">Elevation: {Math.round(gps.elevation)} m</div>
              )}
            </>
          ) : (
            <div style={{ color: 'var(--cockpit-panel-subtle)' }}>
              {gpsStatusText}
              {gps.locationState === 'idle' ? ' · Tap Enable Location to start' : ''}
            </div>
          )}
        </div>

        {gps.locationState === 'granted' && (
          <button
            type="button"
            data-no-drag
            onClick={() => void requestLocation()}
            style={{
              ...btnBase,
              minHeight: 36,
              background: 'rgba(10,12,13,0.8)',
              color: 'var(--cockpit-panel-subtle)',
            }}
          >
            REFRESH FIX
          </button>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            data-no-drag
            onClick={jumpToMe}
            disabled={!hasFix}
            style={{
              flex: 1,
              minHeight: 38,
              borderRadius: 8,
              border: '1px solid rgba(199,206,198,0.35)',
              background: hasFix ? 'rgba(199,206,198,0.14)' : 'rgba(70,75,73,0.22)',
              color: hasFix ? '#d6ddd6' : '#7d8680',
              cursor: hasFix ? 'pointer' : 'not-allowed',
              fontSize: 11,
              letterSpacing: '0.08em',
            }}
          >
            JUMP TO ME
          </button>
          <button
            type="button"
            data-no-drag
            onClick={() => setFollowLock((v) => !v)}
            disabled={!hasFix}
            style={{
              flex: 1,
              minHeight: 38,
              borderRadius: 8,
              border: followLock
                ? '1px solid rgba(125,255,138,0.7)'
                : '1px solid rgba(199,206,198,0.3)',
              background: followLock ? 'rgba(125,255,138,0.16)' : 'rgba(10,12,13,0.8)',
              color: followLock ? '#7dff8a' : 'var(--cockpit-panel-subtle)',
              cursor: hasFix ? 'pointer' : 'not-allowed',
              fontSize: 11,
              letterSpacing: '0.08em',
              boxShadow: followLock ? '0 0 12px rgba(125,255,138,0.3)' : 'none',
              opacity: hasFix ? 1 : 0.5,
            }}
          >
            {followLock ? 'LOCK: FOLLOW' : 'FLOAT: FREE MAP'}
          </button>
        </div>
        <button
          type="button"
          data-no-drag
          onClick={() => setZoomMode((m) => (m === 'fixed' ? 'dynamic' : 'fixed'))}
          style={{
            minHeight: 34,
            borderRadius: 8,
            border: '1px solid rgba(199,206,198,0.3)',
            background: zoomMode === 'dynamic' ? 'rgba(199,206,198,0.14)' : 'rgba(10,12,13,0.8)',
            color: zoomMode === 'dynamic' ? '#d6ddd6' : 'var(--cockpit-panel-subtle)',
            cursor: 'pointer',
            fontSize: 10,
            letterSpacing: '0.08em',
          }}
        >
          FOLLOW ZOOM: {zoomMode === 'dynamic' ? 'DYNAMIC' : 'FIXED'}
        </button>
      </div>
    </HudPanel>
  )
}
