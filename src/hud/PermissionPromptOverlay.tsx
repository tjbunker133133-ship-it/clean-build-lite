import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGPS } from '../hooks/useGPS'
import { getPermissionSnapshot, type PermissionStateLike } from '../lib/devicePermissions'
import PermissionWizard from './PermissionWizard'

const KEY = 'hud_permission_overlay_seen_v1'
const APPLE_GPS_STUCK_MS = 10_000
const WIZARD_COMPLETED_KEY = 'wizardCompleted'
const GPS_PERMISSION_KEY = 'gpsPermission'

function sensorApisAvailable() {
  const orient = typeof (DeviceOrientationEvent as any)?.requestPermission === 'function'
  const motion = typeof (DeviceMotionEvent as any)?.requestPermission === 'function'
  return { orient, motion }
}

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
    const isAndroidUa = /Android/i.test(ua)
    const isWindows = /Windows/i.test(ua)
    const isApple = /iPhone|iPad|iPod|Macintosh/i.test(ua)
    if (isAndroidUa) {
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

  const allRequested = useMemo(() => {
    const { orient: needOrient, motion: needMotion } = sensorApisAvailable()
    const list: PermissionStateLike[] = [geo, mic, camera, notif]
    if (needOrient) list.push(orient)
    if (needMotion) list.push(motion)
    return list.every((s) => s === 'granted' || s === 'denied' || s === 'unsupported')
  }, [geo, mic, camera, notif, orient, motion])

  useEffect(() => {
    const { orient: needOrient, motion: needMotion } = sensorApisAvailable()
    if (!needOrient) setOrient('unsupported')
    if (!needMotion) setMotion('unsupported')
  }, [])

  useEffect(() => {
    const seen = localStorage.getItem(KEY) === '1'
    const wizardCompleted = localStorage.getItem(WIZARD_COMPLETED_KEY) === 'true'
    const persistedGpsGranted = localStorage.getItem(GPS_PERMISSION_KEY) === 'granted'
    void getPermissionSnapshot().then((s) => {
      setGeo(s.geolocation)
      setMic(s.microphone)
      setNotif(s.notifications)
      if (s.geolocation === 'granted' || s.geolocation === 'denied') {
        localStorage.setItem(GPS_PERMISSION_KEY, s.geolocation)
      }
      const gpsGranted = s.geolocation === 'granted' || persistedGpsGranted
      const shouldShowWizard = !wizardCompleted || !gpsGranted
      if (!seen && shouldShowWizard) {
        setVisible(true)
      }
    })
  }, [])

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
        if (s.geolocation === 'granted' || s.geolocation === 'denied') {
          localStorage.setItem(GPS_PERMISSION_KEY, s.geolocation)
        }
      })
    }
    window.addEventListener('hud:show-permissions', onShow)
    return () => window.removeEventListener('hud:show-permissions', onShow)
  }, [])

  const close = useCallback(() => {
    localStorage.setItem(KEY, '1')
    localStorage.setItem(WIZARD_COMPLETED_KEY, 'true')
    setVisible(false)
  }, [])

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
      <PermissionWizard
        visible={visible}
        geo={geo}
        mic={mic}
        camera={camera}
        notif={notif}
        orient={orient}
        motion={motion}
        setGeo={setGeo}
        setMic={setMic}
        setCamera={setCamera}
        setNotif={setNotif}
        setOrient={setOrient}
        setMotion={setMotion}
        gps={gps}
        isAppleMobile={isAppleMobile}
        isAndroid={isAndroid}
        platformHint={platformHint}
        locationDenied={locationDenied}
        allRequested={allRequested}
        busy={busy}
        setBusy={setBusy}
        onClose={close}
      />
    </div>
  )
}
