import { useEffect, useState } from 'react'
import HudPanel from './HudPanel'
import { useMapContext } from '../context/MapContext'
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
  const gps = useGPS()
  const [followLock, setFollowLock] = useState(false)
  const [zoomMode, setZoomMode] = useState<FollowZoomMode>('fixed')

  useEffect(() => {
    if (!followLock) return
    if (!map) return
    if (gps.lat == null || gps.lng == null) return
    const zoom = zoomMode === 'dynamic' ? zoomForAccuracy(gps.accuracy) : map.getZoom()
    map.easeTo({
      center: [gps.lng, gps.lat],
      zoom,
      duration: 650,
      essential: true,
    })
  }, [followLock, gps.lat, gps.lng, gps.accuracy, map, zoomMode])

  const jumpToMe = () => {
    if (!map) return
    if (gps.lat == null || gps.lng == null) return
    const zoom = zoomMode === 'dynamic' ? zoomForAccuracy(gps.accuracy) : Math.max(14, map.getZoom())
    map.easeTo({
      center: [gps.lng, gps.lat],
      zoom,
      duration: 850,
      essential: true,
    })
  }

  const hasFix = gps.lat != null && gps.lng != null
  const gpsStatusText =
    gps.status === 'locked'
      ? 'GPS LOCKED'
      : gps.status === 'searching'
        ? 'GPS SEARCHING'
        : gps.status === 'denied'
          ? 'GPS DENIED'
          : gps.status === 'unsupported'
            ? 'GPS UNSUPPORTED'
            : gps.status === 'error'
              ? 'GPS ERROR'
              : 'GPS IDLE'

  return (
    <HudPanel
      panelId="location"
      title="Location"
      initialPos={{ x: 1220, y: 60 }}
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
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 12,
            color: '#c7cec6',
            lineHeight: 1.5,
          }}
        >
          {hasFix ? (
            <>
              <div>LAT {gps.lat!.toFixed(6)}</div>
              <div>LNG {gps.lng!.toFixed(6)}</div>
              <div style={{ fontSize: 10, color: 'var(--cockpit-panel-subtle)' }}>
                {gpsStatusText} · ACC {gps.accuracy != null ? `${Math.round(gps.accuracy)} m` : '—'}
              </div>
            </>
          ) : (
            <div style={{ color: 'var(--cockpit-panel-subtle)' }}>
              {gpsStatusText}
              {gps.error ? ` · ${gps.error}` : ' · Awaiting GPS fix...'}
            </div>
          )}
        </div>

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
            style={{
              flex: 1,
              minHeight: 38,
              borderRadius: 8,
              border: followLock
                ? '1px solid rgba(125,255,138,0.7)'
                : '1px solid rgba(199,206,198,0.3)',
              background: followLock ? 'rgba(125,255,138,0.16)' : 'rgba(10,12,13,0.8)',
              color: followLock ? '#7dff8a' : 'var(--cockpit-panel-subtle)',
              cursor: 'pointer',
              fontSize: 11,
              letterSpacing: '0.08em',
              boxShadow: followLock ? '0 0 12px rgba(125,255,138,0.3)' : 'none',
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
