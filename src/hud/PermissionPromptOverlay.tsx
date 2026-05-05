import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGPS } from '../hooks/useGPS'
import {
  getPermissionSnapshot,
  requestCameraPermission,
  requestGeolocationPermission,
  requestMicrophonePermission,
  requestMotionPermission,
  requestNotificationPermission,
  requestOrientationPermission,
  type PermissionStateLike,
} from '../lib/devicePermissions'

const KEY = 'hud_permission_overlay_seen_v1'
const APPLE_GPS_STUCK_MS = 10_000

export default function PermissionPromptOverlay() {
  const gps = useGPS()
  const gpsRef = useRef(gps)
  gpsRef.current = gps
  const noLockSinceRef = useRef<number | null>(null)
  const [visible, setVisible] = useState(false)
  const [geo, setGeo] = useState<PermissionStateLike>('unknown')
  const [mic, setMic] = useState<PermissionStateLike>('unknown')
  const [camera, setCamera] = useState<PermissionStateLike>('unknown')
  const [notif, setNotif] = useState<PermissionStateLike>('unknown')
  const [orient, setOrient] = useState<PermissionStateLike>('unknown')
  const [motion, setMotion] = useState<PermissionStateLike>('unknown')
  const [busy, setBusy] = useState(false)
  const isAppleMobile = useMemo(() => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
    return /iPhone|iPad|iPod/i.test(ua)
  }, [])

  const isAndroid = useMemo(() => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
    return /Android/i.test(ua)
  }, [])

  const locationDenied = geo === 'denied' || gps.status === 'denied'

  const platformHint = useMemo(() => {
    const ua = navigator.userAgent || ''
    const isAndroid = /Android/i.test(ua)
    const isWindows = /Windows/i.test(ua)
    const isApple = /iPhone|iPad|iPod|Macintosh/i.test(ua)
    if (isAndroid) {
      return 'Android: allow prompts, then check Chrome site settings if any permission stays blocked.'
    }
    if (isWindows) {
      return 'Windows: allow browser prompts and confirm Location/Microphone are enabled in browser + OS privacy settings.'
    }
    if (isApple) {
      return 'Apple: iOS/Safari requires explicit user taps for each permission prompt.'
    }
    return 'Allow each browser prompt. If blocked, reopen site permissions from your browser address bar.'
  }, [])

  useEffect(() => {
    const seen = localStorage.getItem(KEY) === '1'
    void getPermissionSnapshot().then((s) => {
      setGeo(s.geolocation)
      setMic(s.microphone)
      setNotif(s.notifications)
      if (!seen && (s.geolocation !== 'granted' || s.microphone !== 'granted')) {
        setVisible(true)
      }
    })
  }, [])

  /** Apple: re-open overlay if GPS denied or no fix after prolonged search (user may have dismissed early). */
  useEffect(() => {
    if (!isAppleMobile) return
    const refreshSnapshot = () => {
      void getPermissionSnapshot().then((s) => {
        setGeo(s.geolocation)
        setMic(s.microphone)
        setNotif(s.notifications)
      })
    }
    const id = window.setInterval(() => {
      const g = gpsRef.current
      const locked = g.lat != null && g.lng != null
      if (locked) {
        noLockSinceRef.current = null
        return
      }
      if (g.status === 'denied') {
        noLockSinceRef.current = null
        setVisible(true)
        refreshSnapshot()
        return
      }
      const pending = g.status === 'searching' || g.status === 'idle' || g.status === 'error'
      if (!pending) {
        noLockSinceRef.current = null
        return
      }
      if (noLockSinceRef.current == null) {
        noLockSinceRef.current = Date.now()
      } else if (Date.now() - noLockSinceRef.current >= APPLE_GPS_STUCK_MS) {
        setVisible(true)
        refreshSnapshot()
      }
    }, 1000)
    return () => {
      window.clearInterval(id)
    }
  }, [isAppleMobile])

  useEffect(() => {
    const onShow = () => {
      setVisible(true)
      void getPermissionSnapshot().then((s) => {
        setGeo(s.geolocation)
        setMic(s.microphone)
        setNotif(s.notifications)
      })
    }
    window.addEventListener('hud:show-permissions', onShow)
    return () => window.removeEventListener('hud:show-permissions', onShow)
  }, [])

  const permissionRowStyle: React.CSSProperties = {
    minHeight: 40,
    borderRadius: 8,
    border: '1px solid rgba(199,206,198,0.35)',
    background: 'rgba(199,206,198,0.12)',
    color: '#e2e8e2',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    cursor: 'pointer',
  }

  const allRequested = useMemo(
    () => [geo, mic, camera, notif, orient, motion].every((s) => s === 'granted' || s === 'denied' || s === 'unsupported'),
    [geo, mic, camera, notif, orient, motion],
  )

  const close = useCallback(() => {
    localStorage.setItem(KEY, '1')
    setVisible(false)
  }, [])

  const runOne = useCallback(async (fn: () => Promise<PermissionStateLike>, set: (s: PermissionStateLike) => void) => {
    if (busy) return
    setBusy(true)
    try {
      set(await fn())
    } finally {
      setBusy(false)
    }
  }, [busy])

  const runAll = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      setGeo(await requestGeolocationPermission())
      setMic(await requestMicrophonePermission())
      setCamera(await requestCameraPermission())
      setNotif(await requestNotificationPermission())
      setOrient(await requestOrientationPermission())
      setMotion(await requestMotionPermission())
    } finally {
      setBusy(false)
    }
  }, [busy])

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100002,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: 'min(560px, 100%)',
          borderRadius: 12,
          border: '1px solid rgba(125,255,138,0.45)',
          background: 'rgba(8,12,14,0.92)',
          color: '#d8e3d8',
          padding: 14,
          display: 'grid',
          gap: 8,
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: '0.12em', color: '#7dff8a', fontWeight: 800 }}>
          DEVICE PERMISSIONS REQUIRED
        </div>
        <div style={{ fontSize: 11, color: '#b8c4b8' }}>
          {platformHint}
          {isAppleMobile && (
            <span style={{ display: 'block', marginTop: 6, color: '#9ec4a8' }}>
              If GPS stays on SEARCH or DENIED, tap LOCATION below — Safari only grants location after a direct user
              action.
            </span>
          )}
        </div>
        {locationDenied && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(255,107,135,0.55)',
              background: 'rgba(40,12,20,0.55)',
              fontSize: 11,
              color: '#ffd0d8',
              lineHeight: 1.45,
            }}
          >
            <div style={{ fontWeight: 800, letterSpacing: '0.1em', color: '#ff8a9d', marginBottom: 6 }}>
              LOCATION DENIED — FIX IN SYSTEM SETTINGS
            </div>
            {isAppleMobile ? (
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                <li>
                  Open <strong>Settings</strong> → <strong>Privacy &amp; Security</strong> → <strong>Location Services</strong>{' '}
                  (must be ON).
                </li>
                <li>
                  <strong>Safari</strong> → <strong>Location</strong> → choose <strong>While Using</strong> or{' '}
                  <strong>Ask</strong>. Then return here and tap <strong>LOCATION</strong> again.
                </li>
                <li>
                  If you added this app to the Home Screen, also check <strong>Settings</strong> → your <strong>app name</strong>{' '}
                  → <strong>Location</strong> → <strong>While Using</strong>.
                </li>
                <li>
                  In Safari, tap <strong>aA</strong> (or address bar) → <strong>Website Settings</strong> → set Location to{' '}
                  <strong>Ask</strong> or <strong>Allow</strong>.
                </li>
              </ol>
            ) : isAndroid ? (
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                <li>
                  Chrome: <strong>⋮</strong> → <strong>Settings</strong> → <strong>Site settings</strong> → <strong>Location</strong>{' '}
                  → allow this site, or clear Block for this origin.
                </li>
                <li>
                  System: <strong>Settings</strong> → <strong>Location</strong> ON, and app/browser location allowed.
                </li>
              </ol>
            ) : (
              <p style={{ margin: 0 }}>
                Allow location for this site in your browser&apos;s site permissions (lock icon or address bar), then tap{' '}
                <strong>LOCATION</strong> again.
              </p>
            )}
            <button
              type="button"
              onClick={() => void runOne(requestGeolocationPermission, setGeo)}
              disabled={busy}
              style={{
                ...permissionRowStyle,
                marginTop: 10,
                borderColor: 'rgba(255,138,160,0.65)',
                background: 'rgba(255,80,120,0.2)',
                color: '#ffe8ec',
              }}
            >
              RETRY LOCATION AFTER SETTINGS
            </button>
          </div>
        )}
        <button type="button" onClick={() => void runAll()} disabled={busy} style={permissionRowStyle}>
          {busy ? 'REQUESTING…' : 'REQUEST ALL NOW'}
        </button>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button type="button" onClick={() => void runOne(requestGeolocationPermission, setGeo)} disabled={busy} style={permissionRowStyle}>
            LOCATION ({geo})
          </button>
          <button type="button" onClick={() => void runOne(requestMicrophonePermission, setMic)} disabled={busy} style={permissionRowStyle}>
            MICROPHONE ({mic})
          </button>
          <button type="button" onClick={() => void runOne(requestCameraPermission, setCamera)} disabled={busy} style={permissionRowStyle}>
            CAMERA ({camera})
          </button>
          <button type="button" onClick={() => void runOne(requestNotificationPermission, setNotif)} disabled={busy} style={permissionRowStyle}>
            NOTIFICATIONS ({notif})
          </button>
          <button type="button" onClick={() => void runOne(requestOrientationPermission, setOrient)} disabled={busy} style={permissionRowStyle}>
            ORIENTATION ({orient})
          </button>
          <button type="button" onClick={() => void runOne(requestMotionPermission, setMotion)} disabled={busy} style={permissionRowStyle}>
            MOTION ({motion})
          </button>
        </div>
        <button
          type="button"
          onClick={close}
          disabled={!allRequested}
          style={{
            ...permissionRowStyle,
            borderColor: allRequested ? 'rgba(125,255,138,0.55)' : 'rgba(180,180,180,0.25)',
            color: allRequested ? '#d8ffe0' : '#9da6a0',
          }}
        >
          CONTINUE TO HUD
        </button>
      </div>
    </div>
  )
}

