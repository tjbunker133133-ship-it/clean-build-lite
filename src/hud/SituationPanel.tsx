import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import HudPanel from './HudPanel'
import { useMapContext } from '../context/MapContext'
import { usePanelData } from '../context/PanelDataContext'
import { formatWeatherAge, isWeatherSuccess, type WeatherSuccess } from '../lib/weather'
import { useGPS } from '../hooks/useGPS'
import { tier1Debug } from '../lib/tier1DebugLog'
import { requestCameraIntent } from '../lib/operationalPerception/perceptionEngine'
import { getDeviceProfile, isIosFieldHud } from '../runtime/deviceProfile'
import {
  copyTextToClipboard,
  safariLocationFixClipboardLines,
  tryOpenIosLocationPrivacySettings,
} from '../lib/systemSettingsLinks'
import {
  touchFontSm,
  touchFontMd,
  touchGapMd,
  touchMinTarget,
} from './tokens'

type FollowZoomMode = 'fixed' | 'dynamic'
type Band = 'low' | 'mid' | 'high' | 'na'

function formatClock(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone,
  }).format(now)
}

function formatDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(now)
}

function distMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.7613
  const p = Math.PI / 180
  const a =
    0.5 -
    Math.cos((lat2 - lat1) * p) / 2 +
    (Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p))) / 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(Math.max(0, a))))
}

function bandForFt(ft: number): Band {
  if (ft < 8000) return 'low'
  if (ft <= 10000) return 'mid'
  return 'high'
}

function zoomForAccuracy(accuracy: number | null): number {
  if (accuracy == null || Number.isNaN(accuracy)) return 14.2
  if (accuracy <= 8) return 16.4
  if (accuracy <= 20) return 15.4
  if (accuracy <= 50) return 14.4
  if (accuracy <= 120) return 13.7
  return 13
}

function SectionLabel({ children }: { children: string }) {
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  return (
    <div
      style={{
        fontSize: touchFontSm(isMobile),
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--cockpit-panel-subtle)',
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  )
}

function sectionDivider(): CSSProperties {
  return {
    borderTop: '1px solid rgba(199,206,198,0.18)',
    margin: '12px 0',
    paddingTop: 12,
  }
}

function SituationWeatherSection({
  panelsLocationBlocked,
  fontSm,
  fontMd,
  gapMd,
  tapMin,
  btnBase,
}: {
  panelsLocationBlocked: boolean
  fontSm: number
  fontMd: number
  gapMd: number
  tapMin: number
  btnBase: CSSProperties
}) {
  const { weather, weatherLoading, weatherRefreshNote, refreshPanelData } = usePanelData()
  const hasData = isWeatherSuccess(weather)
  const wx: WeatherSuccess | null = hasData ? weather : null

  return (
    <div style={sectionDivider()}>
      <SectionLabel>Weather</SectionLabel>
      <div
        style={{
          border: '1px solid rgba(199,206,198,0.28)',
          borderRadius: 8,
          padding: '8px 10px',
          background: 'rgba(10,12,13,0.55)',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: fontMd,
          color: '#c7cec6',
          lineHeight: 1.5,
          display: 'grid',
          gap: 4,
        }}
      >
        <div>
          Temp:{' '}
          {hasData && wx ? `${wx.temperature}${wx.unit}` : weatherLoading ? '…' : '—'}
        </div>
        <div>
          Humidity:{' '}
          {hasData && wx ? `${wx.humidity}%` : weatherLoading ? '…' : '—'}
        </div>
        <div>
          Wind:{' '}
          {hasData && wx
            ? `${Math.round(wx.windSpeed)} ${wx.windUnit}`
            : weather && 'error' in weather
              ? weather.error
              : '—'}
        </div>
        {hasData && wx ? (
          <div style={{ fontSize: fontSm, color: 'var(--cockpit-panel-subtle)' }}>
            {wx.condition}
            {wx.stale ? ` · cached ${formatWeatherAge(wx.updatedAt)}` : ''}
          </div>
        ) : null}
        {!hasData && weather && 'error' in weather ? (
          <div style={{ fontSize: fontSm, color: '#e7c29a' }}>{weather.error}</div>
        ) : null}
      </div>
      {weatherRefreshNote ? (
        <div style={{ fontSize: fontSm, color: '#e7c29a', marginTop: 6 }}>{weatherRefreshNote}</div>
      ) : null}
      <button
        type="button"
        data-no-drag
        disabled={panelsLocationBlocked}
        onClick={() => void refreshPanelData()}
        style={{
          ...btnBase,
          marginTop: gapMd,
          width: '100%',
          background: panelsLocationBlocked ? 'rgba(70,75,73,0.22)' : 'rgba(199,206,198,0.14)',
          color: panelsLocationBlocked ? '#7d8680' : '#d6ddd6',
          cursor: panelsLocationBlocked ? 'not-allowed' : 'pointer',
          minHeight: tapMin,
        }}
      >
        UPDATE WEATHER
      </button>
    </div>
  )
}

export default function SituationPanel() {
  const { map } = useMapContext()
  const panel = usePanelData()
  const { userLocation, locationTimeZone, panelsLocationBlocked } = panel
  const gps = useGPS()
  const { requestLocation } = gps

  const fallbackTz =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC' : 'UTC'
  const activeTz = locationTimeZone ?? fallbackTz

  const [, setClockTick] = useState(0)
  const [mainElev, setMainElev] = useState('— ft')
  const [trend, setTrend] = useState('—')
  const [grade, setGrade] = useState('grade —')
  const [band, setBand] = useState<Band>('na')
  const elevPrev = useRef<{ ft: number; lat: number; lng: number } | null>(null)

  const [followLock, setFollowLock] = useState(() => {
    try {
      return localStorage.getItem('hud_follow_lock_v1') === '1'
    } catch {
      return false
    }
  })
  const [zoomMode, setZoomMode] = useState<FollowZoomMode>(() => {
    try {
      return localStorage.getItem('hud_follow_zoom_v1') === 'dynamic' ? 'dynamic' : 'fixed'
    } catch {
      return 'fixed'
    }
  })
  const lastFollowCenterRef = useRef<{ lat: number; lng: number } | null>(null)

  const isIOS = useMemo(() => getDeviceProfile().isIOS, [])
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const iosFieldHud = isIosFieldHud()
  /** Skip micro-GPS jitter recentering on touch field HUD (Safari flyTo stacking feels clunky). */
  const followRecenterMinMi = iosFieldHud ? 0.006 : 0
  const [locationHelpHint, setLocationHelpHint] = useState<string | null>(null)
  const fontSm = touchFontSm(isMobile)
  const fontMd = touchFontMd(isMobile)
  const gapMd = touchGapMd(isMobile)
  const tapMin = touchMinTarget(isMobile)

  useEffect(() => {
    const t = window.setInterval(() => setClockTick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (panelsLocationBlocked) {
      setMainElev('— ft')
      setBand('na')
      setTrend('—')
      setGrade('grade —')
      elevPrev.current = null
      return
    }
    if (panel.elevationLoading && panel.elevationMeters == null) {
      setMainElev('…')
      setBand('na')
      return
    }
    if (panel.elevationMeters != null) {
      const ft = panel.elevationMeters * 3.28084
      const rounded = Math.round(ft)
      setMainElev(`${rounded.toLocaleString('en-US')} ft`)
      setBand(bandForFt(ft))
      return
    }
    setMainElev('— ft')
    setBand('na')
  }, [panel.elevationMeters, panel.elevationLoading, panelsLocationBlocked])

  useEffect(() => {
    if (!map) return

    const sample = () => {
      const c = map.getCenter()

      let terrainMeters: number | null = null
      try {
        const m = (map as unknown as {
          queryTerrainElevation?: (c: unknown) => number | null
        }).queryTerrainElevation?.(c)
        if (m != null && Number.isFinite(m)) terrainMeters = m
      } catch {
        /* optional API */
      }

      if (!panelsLocationBlocked && panel.elevationMeters == null && terrainMeters != null) {
        const ft = terrainMeters * 3.28084
        const rounded = Math.round(ft)
        setMainElev(`${rounded.toLocaleString('en-US')} ft`)
        setBand(bandForFt(ft))
      }

      const baseFt =
        panel.elevationMeters != null
          ? Math.round(panel.elevationMeters * 3.28084)
          : terrainMeters != null
            ? Math.round(terrainMeters * 3.28084)
            : Math.round(
                (1200 +
                  Math.sin(c.lat * 0.12) * 400 +
                  Math.cos(c.lng * 0.1) * 300 +
                  (c.lat + c.lng) * 3) *
                  3.28084,
              )

      const p = elevPrev.current
      if (p) {
        const dMi = distMi(p.lat, p.lng, c.lat, c.lng)
        const dFt = baseFt - p.ft
        if (dMi > 0.02) {
          const arrow = dFt >= 0 ? '▲' : '▼'
          setTrend(`${arrow} ${dFt >= 0 ? '+' : ''}${Math.round(dFt)} ft / ${dMi.toFixed(2)} mi`)
          const runFt = dMi * 5280
          if (runFt > 1) {
            const ang = (Math.atan2(Math.abs(dFt), runFt) * 180) / Math.PI
            setGrade(`grade ${ang.toFixed(1)}°`)
          } else setGrade('grade —')
        } else {
          setTrend('—')
          setGrade('grade —')
        }
      } else {
        setTrend('—')
        setGrade('grade —')
      }
      elevPrev.current = { ft: baseFt, lat: c.lat, lng: c.lng }
    }

    let sampleRaf: number | null = null
    const scheduleSample = () => {
      if (sampleRaf != null) return
      sampleRaf = requestAnimationFrame(() => {
        sampleRaf = null
        sample()
      })
    }
    map.on('moveend', scheduleSample)
    map.on('idle', scheduleSample)
    void sample()
    return () => {
      if (sampleRaf != null) cancelAnimationFrame(sampleRaf)
      map.off('moveend', scheduleSample)
      map.off('idle', scheduleSample)
    }
  }, [map, panel.elevationMeters, panelsLocationBlocked])

  const centerMapOnFix = useCallback(
    (lat: number, lng: number, zoom: number) => {
      requestCameraIntent({
        kind: 'ease_to',
        center: [lng, lat],
        zoom,
        durationMs: iosFieldHud ? 420 : 680,
      })
    },
    [iosFieldHud],
  )

  useEffect(() => {
    if (!followLock) return
    if (!map) return
    if (gps.lat == null || gps.lng == null) return
    if (gps.locationState !== 'granted') return
    const prev = lastFollowCenterRef.current
    if (prev) {
      const movedMi = distMi(prev.lat, prev.lng, gps.lat, gps.lng)
      if (movedMi < followRecenterMinMi) return
    }
    lastFollowCenterRef.current = { lat: gps.lat, lng: gps.lng }
    const zoom = zoomMode === 'dynamic' ? zoomForAccuracy(gps.accuracy) : map.getZoom()
    centerMapOnFix(gps.lat, gps.lng, zoom)
  }, [
    followLock,
    gps.lat,
    gps.lng,
    gps.accuracy,
    gps.locationState,
    map,
    zoomMode,
    followRecenterMinMi,
    centerMapOnFix,
  ])

  useEffect(() => {
    try {
      localStorage.setItem('hud_follow_lock_v1', followLock ? '1' : '0')
      localStorage.setItem('hud_follow_zoom_v1', zoomMode)
    } catch {
      /* ignore */
    }
  }, [followLock, zoomMode])

  const jumpToMe = () => {
    tier1Debug('locate', 'click', { lat: gps.lat, lng: gps.lng, source: gps.source })
    if (!map) return
    if (gps.lat == null || gps.lng == null) return
    if (gps.locationState !== 'granted') return
    lastFollowCenterRef.current = { lat: gps.lat, lng: gps.lng }
    const zoom = zoomMode === 'dynamic' ? zoomForAccuracy(gps.accuracy) : Math.max(14, map.getZoom())
    centerMapOnFix(gps.lat, gps.lng, zoom)
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

  const elevColor =
    band === 'low'
      ? '#b7c8b1'
      : band === 'mid'
        ? '#b8c2bf'
        : band === 'high'
          ? '#c6b79d'
          : '#9fa9a7'

  const btnBase: CSSProperties = {
    minHeight: Math.max(tapMin, 44),
    borderRadius: 8,
    border: '1px solid rgba(199,206,198,0.35)',
    fontSize: fontSm,
    letterSpacing: '0.08em',
    fontWeight: 700,
    cursor: 'pointer',
  }

  const now = new Date()

  return (
    <HudPanel
      panelId="situation"
      title="Situation"
      initialPos={{ x: 1220, y: 60 }}
      initialWidth={320}
      minHeight={280}
      accent={elevColor}
    >
      {panelsLocationBlocked && (
        <div
          style={{
            fontSize: fontSm,
            color: '#f0b4bf',
            textAlign: 'center',
            marginBottom: 8,
            lineHeight: 1.35,
          }}
        >
          Enable location to use weather and elevation features
        </div>
      )}

      <SectionLabel>Time</SectionLabel>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: isMobile ? 20 : 18,
          letterSpacing: '0.06em',
          color: '#c7cec6',
          textAlign: 'center',
          fontWeight: 700,
          textShadow: '0 0 12px rgba(199,206,198,0.25)',
        }}
      >
        {formatClock(now, activeTz)}
      </div>
      <div
        style={{
          textAlign: 'center',
          fontFamily: 'var(--font-ui, system-ui)',
          fontSize: fontSm,
          letterSpacing: '0.12em',
          color: 'var(--cockpit-panel-subtle)',
          textTransform: 'uppercase',
        }}
      >
        {formatDate(now, activeTz)}
        {' · '}
        {locationTimeZone ? 'Location solar time' : 'Device timezone'}
      </div>

      <SituationWeatherSection
        panelsLocationBlocked={panelsLocationBlocked}
        fontSm={fontSm}
        fontMd={fontMd}
        gapMd={gapMd}
        tapMin={tapMin}
        btnBase={btnBase}
      />

      <div style={sectionDivider()}>
        <SectionLabel>Elevation</SectionLabel>
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: '6px 8px',
            borderRadius: 10,
            border: `1px solid ${elevColor}55`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            fontWeight: 700,
            fontSize: fontMd,
            color: elevColor,
          }}
        >
          <div style={{ fontSize: isMobile ? 18 : 16 }}>{mainElev}</div>
          <div style={{ fontSize: fontSm, opacity: 0.95, whiteSpace: 'nowrap' }}>
            {trend} · {grade}
          </div>
          {panel.elevationError && !panelsLocationBlocked && (
            <div style={{ fontSize: fontSm, opacity: 0.85, color: '#e7c29a' }}>{panel.elevationError}</div>
          )}
        </div>
      </div>

      <div style={sectionDivider()}>
        <SectionLabel>GPS</SectionLabel>
        <div style={{ display: 'grid', gap: Math.max(gapMd, 8) }}>
          {gps.locationState === 'idle' && (
            <div style={{ display: 'grid', gap: gapMd }}>
              <p style={{ margin: 0, fontSize: fontMd, color: '#9fb0c7', lineHeight: 1.45 }}>
                Location is off. Enable it for GPS fix, follow mode, and weather. Nothing is requested until you tap
                below.
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
            <p style={{ margin: 0, fontSize: fontMd, color: '#c7cec6' }}>Waiting for browser location prompt…</p>
          )}

          {(gps.locationState === 'denied' || gps.locationState === 'error') && (
            <div
              style={{
                display: 'grid',
                gap: Math.max(gapMd, 8),
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid rgba(255,107,135,0.45)',
                background: 'rgba(40,12,20,0.4)',
              }}
            >
              <p style={{ margin: 0, fontSize: fontMd, color: '#ffd0d8' }}>Location access is blocked or failed.</p>
              {isIOS && gps.locationState === 'denied' ? (
                <div style={{ fontSize: fontSm, color: '#e2c2c8', lineHeight: 1.5 }}>
                  <p style={{ margin: '0 0 6px' }}>On iPhone / iPad (Safari):</p>
                  <ol style={{ margin: 0, paddingLeft: 18 }}>
                    <li>Open Settings</li>
                    <li>Go to Safari</li>
                    <li>Enable Location Access for this site</li>
                  </ol>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: fontSm, color: '#e2c2c8', lineHeight: 1.45 }}>
                  Allow location in your browser site settings (lock icon in the address bar on desktop).
                </p>
              )}
              {gps.error && (
                <p style={{ margin: 0, fontSize: fontSm, color: '#b89da3', fontFamily: 'var(--font-mono, monospace)' }}>
                  {gps.error}
                </p>
              )}
              <button
                type="button"
                data-no-drag
                onClick={() => void requestLocation()}
                style={{ ...btnBase, background: 'rgba(199,206,198,0.14)', color: '#d6ddd6' }}
              >
                TRY AGAIN
              </button>
              {isIOS && gps.locationState === 'denied' ? (
                <>
                  <button
                    type="button"
                    data-no-drag
                    onClick={() => tryOpenIosLocationPrivacySettings(setLocationHelpHint)}
                    style={{
                      ...btnBase,
                      background: 'rgba(125,255,138,0.16)',
                      borderColor: 'rgba(125,255,138,0.55)',
                      color: '#d8f6de',
                    }}
                  >
                    OPEN SYSTEM LOCATION
                  </button>
                  <button
                    type="button"
                    data-no-drag
                    onClick={() =>
                      void copyTextToClipboard(safariLocationFixClipboardLines()).then((ok) =>
                        setLocationHelpHint(
                          ok ? 'Copied Safari location steps to clipboard.' : 'Could not copy — use steps above.',
                        ),
                      )
                    }
                    style={{ ...btnBase, background: 'rgba(199,206,198,0.12)', color: '#d6ddd6' }}
                  >
                    COPY FIX STEPS
                  </button>
                  {locationHelpHint ? (
                    <p style={{ margin: 0, fontSize: fontSm, color: '#b8c4b8' }}>{locationHelpHint}</p>
                  ) : null}
                </>
              ) : null}
            </div>
          )}

          <div
            style={{
              border: '1px solid rgba(199,206,198,0.28)',
              borderRadius: 8,
              padding: '8px 10px',
              background: 'rgba(10,12,13,0.55)',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: fontMd,
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
                <div style={{ fontSize: fontSm, color: 'var(--cockpit-panel-subtle)' }}>
                  {gpsStatusText} · ACC {gps.accuracy != null ? `${Math.round(gps.accuracy)} m` : '—'}
                </div>
                {gps.elevation != null && Number.isFinite(gps.elevation) && (
                  <div className="hud-readout">
                    GPS altitude: {Math.round(gps.elevation * 3.28084).toLocaleString('en-US')} ft
                  </div>
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
                minHeight: tapMin,
                background: 'rgba(10,12,13,0.8)',
                color: 'var(--cockpit-panel-subtle)',
              }}
            >
              REFRESH FIX
            </button>
          )}

          <div style={{ display: 'flex', gap: gapMd }}>
            <button
              type="button"
              data-no-drag
              onClick={jumpToMe}
              disabled={!hasFix}
              style={{
                flex: 1,
                minHeight: tapMin,
                borderRadius: 8,
                border: '1px solid rgba(199,206,198,0.35)',
                background: hasFix ? 'rgba(199,206,198,0.14)' : 'rgba(70,75,73,0.22)',
                color: hasFix ? '#d6ddd6' : '#7d8680',
                cursor: hasFix ? 'pointer' : 'not-allowed',
                fontSize: fontSm,
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
                minHeight: tapMin,
                borderRadius: 8,
                border: followLock
                  ? '1px solid rgba(125,255,138,0.7)'
                  : '1px solid rgba(199,206,198,0.3)',
                background: followLock ? 'rgba(125,255,138,0.16)' : 'rgba(10,12,13,0.8)',
                color: followLock ? '#7dff8a' : 'var(--cockpit-panel-subtle)',
                cursor: hasFix ? 'pointer' : 'not-allowed',
                fontSize: fontSm,
                letterSpacing: '0.08em',
                opacity: hasFix ? 1 : 0.5,
              }}
            >
              {followLock ? 'LOCK: FOLLOW' : 'FLOAT: FREE'}
            </button>
          </div>
          <button
            type="button"
            data-no-drag
            onClick={() => setZoomMode((m) => (m === 'fixed' ? 'dynamic' : 'fixed'))}
            style={{
              minHeight: tapMin,
              borderRadius: 8,
              border: '1px solid rgba(199,206,198,0.3)',
              background: zoomMode === 'dynamic' ? 'rgba(199,206,198,0.14)' : 'rgba(10,12,13,0.8)',
              color: zoomMode === 'dynamic' ? '#d6ddd6' : 'var(--cockpit-panel-subtle)',
              cursor: 'pointer',
              fontSize: fontSm,
              letterSpacing: '0.08em',
            }}
          >
            FOLLOW ZOOM: {zoomMode === 'dynamic' ? 'DYNAMIC' : 'FIXED'}
          </button>
        </div>
      </div>

    </HudPanel>
  )
}
