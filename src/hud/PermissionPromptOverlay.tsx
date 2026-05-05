import { useEffect, useMemo, useState } from 'react'
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

export default function PermissionPromptOverlay() {
  const [visible, setVisible] = useState(false)
  const [geo, setGeo] = useState<PermissionStateLike>('unknown')
  const [mic, setMic] = useState<PermissionStateLike>('unknown')
  const [camera, setCamera] = useState<PermissionStateLike>('unknown')
  const [notif, setNotif] = useState<PermissionStateLike>('unknown')
  const [orient, setOrient] = useState<PermissionStateLike>('unknown')
  const [motion, setMotion] = useState<PermissionStateLike>('unknown')
  const [busy, setBusy] = useState(false)

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

  if (!visible) return null

  const close = () => {
    localStorage.setItem(KEY, '1')
    setVisible(false)
  }

  const runOne = async (fn: () => Promise<PermissionStateLike>, set: (s: PermissionStateLike) => void) => {
    if (busy) return
    setBusy(true)
    try {
      set(await fn())
    } finally {
      setBusy(false)
    }
  }

  const runAll = async () => {
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
  }

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
          Tap each prompt below on Apple devices. iOS requires explicit user actions for these popups.
        </div>
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

