import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useMapContext } from '../context/MapContext'
import { usePanelData } from '../context/PanelDataContext'
import { useGPS } from '../hooks/useGPS'
import { getDeviceProfile } from '../runtime/deviceProfile'
import {
  touchFontSm,
  touchFontMd,
  touchGapMd,
  touchGapSm,
  touchMinTarget,
} from './tokens'
import {
  getPermissionRecoveryPlatform,
  locationBlockedPrimaryLine,
  locationBlockedSecondaryLine,
  locationErrorShortLine,
  locationNotRequestedLine,
  locationRequestingShortLine,
} from '../lib/permissionRecoveryCopy'
import {
  tryOpenAndroidLocationSettings,
  tryOpenIosLocationPrivacySettings,
} from '../lib/systemSettingsLinks'
import { emitHaptic } from '../runtime/haptics'

type FollowZoomMode = 'fixed' | 'dynamic'

function zoomForAccuracy(accuracy: number | null): number {
  if (accuracy == null || Number.isNaN(accuracy)) return 14.2
  if (accuracy <= 8) return 16.4
  if (accuracy <= 20) return 15.4
  if (accuracy <= 50) return 14.4
  if (accuracy <= 120) return 13.7
  return 13
}

export function LocationNavBody() {
  const { map } = useMapContext()
  const { userLocation } = usePanelData()
  const gps = useGPS()
  const { requestLocation } = gps
  const [followLock, setFollowLock] = useState(() => {
    try {
      const v = localStorage.getItem('hud_follow_lock_v1')
      if (v === '1') return true
      if (v === '0') return false
      const mobile = getDeviceProfile().interactionMode === 'mobile'
      if (mobile && localStorage.getItem('gpsPermission') === 'granted') return true
      return false
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
  const [recoveryMoreHelp, setRecoveryMoreHelp] = useState(false)
  const [settingsNavHint, setSettingsNavHint] = useState<string | null>(null)
  const [jumpHint, setJumpHint] = useState<string | null>(null)
  const lastFollowCenterRef = useRef<{ lat: number; lng: number } | null>(null)
  const jumpHintTimerRef = useRef<number | null>(null)

  const isIOS = useMemo(() => getDeviceProfile().isIOS, [])
  const recoveryPlatform = useMemo(() => getPermissionRecoveryPlatform(), [])
  const settingsNavFallback = useCallback((message: string) => {
    setSettingsNavHint(message)
  }, [])

  useEffect(() => {
    if (!settingsNavHint) return
    const t = window.setTimeout(() => setSettingsNavHint(null), 9000)
    return () => window.clearTimeout(t)
  }, [settingsNavHint])

  useEffect(() => {
    if (!jumpHint) return
    if (jumpHintTimerRef.current != null) window.clearTimeout(jumpHintTimerRef.current)
    jumpHintTimerRef.current = window.setTimeout(() => {
      jumpHintTimerRef.current = null
      setJumpHint(null)
    }, 5000)
    return () => {
      if (jumpHintTimerRef.current != null) window.clearTimeout(jumpHintTimerRef.current)
    }
  }, [jumpHint])

  useEffect(() => {
    setRecoveryMoreHelp(false)
  }, [gps.locationState])
  const isMobile = getDeviceProfile().interactionMode === 'mobile'
  const fontSm = touchFontSm(isMobile)
  const fontMd = touchFontMd(isMobile)
  const gapMd = touchGapMd(isMobile)
  const gapSm = touchGapSm(isMobile)
  const tapMin = Math.max(touchMinTarget(isMobile), 48)

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

  useEffect(() => {
    try {
      localStorage.setItem('hud_follow_lock_v1', followLock ? '1' : '0')
      localStorage.setItem('hud_follow_zoom_v1', zoomMode)
    } catch {
      /* ignore */
    }
  }, [followLock, zoomMode])

  const jumpToMe = () => {
    if (import.meta.env.DEV) {
      console.log('[LOCATE CLICK]', { lat: gps.lat, lng: gps.lng, source: gps.source })
    }
    if (!map) {
      setJumpHint('Map not ready yet.')
      emitHaptic('commandFailure', 'jump.no-map')
      return
    }
    const pendingFix =
      gps.locationState === 'requesting' ||
      (gps.locationState === 'granted' && (gps.lat == null || gps.lng == null))
    if (pendingFix) {
      setJumpHint('Waiting for GPS fix…')
      emitHaptic('wakeWord', 'jump.pending-fix')
      return
    }
    if (gps.lat == null || gps.lng == null || gps.locationState !== 'granted') {
      setJumpHint('Enable location and wait for a fix, then try again.')
      emitHaptic('commandFailure', 'jump.no-fix')
      return
    }
    setJumpHint(null)
    lastFollowCenterRef.current = { lat: gps.lat, lng: gps.lng }
    const zoom = zoomMode === 'dynamic' ? zoomForAccuracy(gps.accuracy) : Math.max(14, map.getZoom())
    emitHaptic('wakeWord', 'jump.center')
    map.flyTo({
      center: [gps.lng, gps.lat],
      zoom,
      essential: true,
    })
  }

  const hasFix = gps.lat != null && gps.lng != null && gps.locationState === 'granted'

  const gpsStatusText =
    gps.locationState === 'granted' && (gps.lat == null || gps.lng == null)
      ? 'ACQUIRING FIX…'
      : gps.locationState === 'granted'
      ? 'LOCATION ON'
      : gps.locationState === 'requesting'
        ? 'REQUESTING…'
        : gps.locationState === 'denied'
          ? 'DENIED'
          : gps.locationState === 'error'
            ? 'ERROR'
            : 'OFF'

  const btnBase: CSSProperties = {
    minHeight: Math.max(tapMin, 48),
    borderRadius: 8,
    border: '1px solid rgba(199,206,198,0.35)',
    fontSize: fontSm,
    letterSpacing: '0.08em',
    fontWeight: 700,
    cursor: 'pointer',
  }

  const requestLocationTap = () => {
    emitHaptic('wakeWord', 'location.panel.request')
    void requestLocation()
  }

  return (
    <div style={{ display: 'grid', gap: Math.max(gapMd, 10) }}>
        {settingsNavHint && (
          <div
            role="status"
            style={{
              margin: 0,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid rgba(255,200,120,0.45)',
              background: 'rgba(40,28,10,0.55)',
              color: '#ffe8cc',
              fontSize: fontSm,
              lineHeight: 1.45,
            }}
          >
            {settingsNavHint}
          </div>
        )}
        {jumpHint && (
          <div
            role="status"
            style={{
              margin: 0,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid rgba(125,200,255,0.4)',
              background: 'rgba(10,20,40,0.55)',
              color: '#d4e8ff',
              fontSize: fontSm,
              lineHeight: 1.45,
            }}
          >
            {jumpHint}
          </div>
        )}
        {gps.locationState === 'idle' && (
          <div style={{ display: 'grid', gap: gapMd }}>
            <p style={{ margin: 0, fontSize: fontMd, color: '#9fb0c7', lineHeight: 1.45 }}>{locationNotRequestedLine()}</p>
            <button
              type="button"
              data-no-drag
              onClick={requestLocationTap}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: gapSm }}>
            <span
              aria-hidden
              style={{
                width: 14,
                height: 14,
                border: '2px solid rgba(199,206,198,0.35)',
                borderTopColor: '#7dff8a',
                borderRadius: '50%',
                animation: 'hud-spin 0.85s linear infinite',
              }}
            />
            <p style={{ margin: 0, fontSize: fontMd, color: '#c7cec6' }}>{locationRequestingShortLine()}</p>
          </div>
        )}

        {gps.locationState === 'denied' && (
          <div
            style={{
              display: 'grid',
              gap: gapMd,
              padding: '12px 12px',
              borderRadius: 10,
              border: '1px solid rgba(255,107,135,0.4)',
              background: 'rgba(28,10,14,0.55)',
            }}
          >
            <p style={{ margin: 0, fontSize: fontMd, color: '#f5dee2', lineHeight: 1.45 }}>
              {locationBlockedPrimaryLine()} {locationBlockedSecondaryLine(recoveryPlatform)}
            </p>
            <button
              type="button"
              data-no-drag
              onClick={requestLocationTap}
              style={{
                ...btnBase,
                background: 'rgba(125,255,138,0.16)',
                borderColor: 'rgba(125,255,138,0.5)',
                color: '#e8fff0',
              }}
            >
              TRY AGAIN
            </button>
            <button
              type="button"
              data-no-drag
              onClick={() => setRecoveryMoreHelp((v) => !v)}
              style={{
                ...btnBase,
                background: 'rgba(10,12,13,0.75)',
                color: '#b8c4c4',
                borderColor: 'rgba(199,206,198,0.25)',
              }}
            >
              {recoveryMoreHelp ? 'Hide more help' : 'More help'}
            </button>
            {recoveryMoreHelp && (
              <div style={{ fontSize: fontSm, color: '#d8ccd0', lineHeight: 1.5 }}>
                {isIOS ? (
                  <>
                    <p style={{ margin: '0 0 8px' }}>iPhone / iPad (Safari):</p>
                    <ol style={{ margin: 0, paddingLeft: 18 }}>
                      <li>Settings → Safari → Location (set to Ask or Allow for this site)</li>
                      <li>Or Settings → Privacy and Security → Location Services → Safari Websites</li>
                    </ol>
                    <div style={{ marginTop: gapMd, display: 'flex', flexWrap: 'wrap', gap: gapSm }}>
                      <button
                        type="button"
                        data-no-drag
                        onClick={() => tryOpenIosLocationPrivacySettings(settingsNavFallback)}
                        style={{ ...btnBase, flex: '1 1 140px' }}
                      >
                        OPEN SETTINGS
                      </button>
                    </div>
                  </>
                ) : recoveryPlatform === 'android' ? (
                  <>
                    <p style={{ margin: '0 0 8px' }}>Android (Chrome): allow location for this site in Chrome site settings.</p>
                    <button
                      type="button"
                      data-no-drag
                      onClick={() => tryOpenAndroidLocationSettings(settingsNavFallback)}
                      style={{ ...btnBase }}
                    >
                      OPEN LOCATION SETTINGS
                    </button>
                  </>
                ) : (
                  <p style={{ margin: 0 }}>Use the site lock or menu in the address bar and allow location for this page.</p>
                )}
              </div>
            )}
          </div>
        )}

        {gps.locationState === 'error' && (
          <div
            style={{
              display: 'grid',
              gap: gapMd,
              padding: '12px 12px',
              borderRadius: 10,
              border: '1px solid rgba(255,180,120,0.45)',
              background: 'rgba(36,22,10,0.45)',
            }}
          >
            <p style={{ margin: 0, fontSize: fontMd, color: '#ffe8d8', lineHeight: 1.45 }}>{locationErrorShortLine()}</p>
            <button
              type="button"
              data-no-drag
              onClick={requestLocationTap}
              style={{
                ...btnBase,
                background: 'rgba(199,206,198,0.14)',
                color: '#d6ddd6',
              }}
            >
              TRY AGAIN
            </button>
            {gps.error && (
              <button
                type="button"
                data-no-drag
                onClick={() => setRecoveryMoreHelp((v) => !v)}
                style={{
                  ...btnBase,
                  background: 'rgba(10,12,13,0.75)',
                  color: '#b8c4c4',
                  borderColor: 'rgba(199,206,198,0.25)',
                }}
              >
                {recoveryMoreHelp ? 'Hide details' : 'Details'}
              </button>
            )}
            {recoveryMoreHelp && gps.error ? (
              <p style={{ margin: 0, fontSize: fontSm, color: '#cbb6a8', fontFamily: 'var(--font-mono, monospace)' }}>
                {gps.error}
              </p>
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
                  Elevation: {Math.round(gps.elevation * 3.28084).toLocaleString('en-US')} ft
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
            onClick={requestLocationTap}
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
            title={hasFix ? 'Center map on your GPS position' : 'Tap for status if fix is still pending'}
            style={{
              flex: 1,
              minHeight: Math.max(tapMin, 48),
              borderRadius: 8,
              border: '1px solid rgba(199,206,198,0.35)',
              background: hasFix ? 'rgba(199,206,198,0.14)' : 'rgba(70,75,73,0.22)',
              color: hasFix ? '#d6ddd6' : '#7d8680',
              cursor: 'pointer',
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
              minHeight: Math.max(tapMin, 48),
              borderRadius: 8,
              border: followLock
                ? '1px solid rgba(125,255,138,0.7)'
                : '1px solid rgba(199,206,198,0.3)',
              background: followLock ? 'rgba(125,255,138,0.16)' : 'rgba(10,12,13,0.8)',
              color: followLock ? '#7dff8a' : 'var(--cockpit-panel-subtle)',
              cursor: hasFix ? 'pointer' : 'not-allowed',
              fontSize: fontSm,
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
  )
}
