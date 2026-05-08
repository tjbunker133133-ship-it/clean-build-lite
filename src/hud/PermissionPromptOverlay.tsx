import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGPS } from '../hooks/useGPS'
import { getPermissionSnapshot, type PermissionStateLike } from '../lib/devicePermissions'
import PermissionWizard from './PermissionWizard'
import { resetAppState } from '../utils/resetApp'

const KEY = 'hud_permission_overlay_seen_v1'
const APPLE_GPS_STUCK_MS = 10_000
const WIZARD_COMPLETED_KEY = 'wizardCompleted'
const GPS_PERMISSION_KEY = 'gpsPermission'

function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Exported for Vitest. iOS Safari / private mode / quota may throw on any
 * storage touch — bootstrap must not crash.
 */
export function readWizardCompletedFlag(): boolean {
  return safeLocalStorageGet(WIZARD_COMPLETED_KEY) === 'true'
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode / quota — operator dismissed UX still applies */
  }
}

function sensorApisAvailable() {
  const orient = typeof (DeviceOrientationEvent as any)?.requestPermission === 'function'
  const motion = typeof (DeviceMotionEvent as any)?.requestPermission === 'function'
  return { orient, motion }
}

/**
 * CONTRACT-SENSITIVE: pure, side-effect-free predicate for the iOS
 * watchdog. Returning `true` means the overlay is allowed to auto-reopen
 * for the current GPS state. Both gates must be respected:
 *   - `dismissedInMemory`: same-session dismissal (covers private mode
 *     where `localStorage.setItem` silently fails)
 *   - persisted `wizardCompleted`: cross-session dismissal
 * Exported for Vitest only; do not call this from product code paths
 * other than the Apple watchdog interval.
 */
export function shouldAutoReopenWizard(args: {
  dismissedInMemory: boolean
  wizardCompletedPersisted: boolean
}): boolean {
  if (args.dismissedInMemory) return false
  if (args.wizardCompletedPersisted) return false
  return true
}

export default function PermissionPromptOverlay() {
  const gps = useGPS()
  const gpsRef = useRef(gps)
  gpsRef.current = gps
  const noLockSinceRef = useRef<number | null>(null)
  // CONTRACT-SENSITIVE (iOS private-mode loop prevention): mirrors the
  // operator-dismiss decision in memory. iOS Safari Private Browsing /
  // locked enterprise storage can silently reject `localStorage.setItem`,
  // so `WIZARD_COMPLETED_KEY` may not persist after `close()`. The Apple
  // watchdog interval would then re-read `false` and re-open the wizard
  // ~10s later (the original loop). The ref guarantees same-session
  // suppression even when storage is sealed. Survives the entire session
  // (the overlay is single-mounted by `App.tsx`).
  const dismissedRef = useRef(false)
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
    const wizardCompleted = readWizardCompletedFlag()
    void getPermissionSnapshot().then((s) => {
      setGeo(s.geolocation)
      setMic(s.microphone)
      setNotif(s.notifications)
      if (s.geolocation === 'granted' || s.geolocation === 'denied') {
        safeLocalStorageSet(GPS_PERMISSION_KEY, s.geolocation)
      }
      const shouldShowWizard = !wizardCompleted
      if (shouldShowWizard) {
        setVisible(true)
      }
    })
  }, [])

  // CONTRACT-SENSITIVE (iOS / PWA loop prevention): this watchdog exists
  // because Safari often leaves GPS in searching/idle/error briefly after
  // resume-from-background or WebKit suspension. The INITIAL mount effect
  // above already respects `wizardCompleted`. This interval historically did
  // NOT — so any post-dismiss transient denial or 10s "stuck" timer called
  // `setVisible(true)` again and trapped operators in a setup↔HUD loop.
  // After the wizard is dismissed, NEVER auto-reopen from this timer.
  // Operators can still open the overlay via `hud:show-permissions`.
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
      if (
        !shouldAutoReopenWizard({
          dismissedInMemory: dismissedRef.current,
          wizardCompletedPersisted: readWizardCompletedFlag(),
        })
      ) {
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
          safeLocalStorageSet(GPS_PERMISSION_KEY, s.geolocation)
        }
      })
    }
    window.addEventListener('hud:show-permissions', onShow)
    return () => window.removeEventListener('hud:show-permissions', onShow)
  }, [])

  const close = useCallback(() => {
    dismissedRef.current = true
    safeLocalStorageSet(KEY, '1')
    safeLocalStorageSet(WIZARD_COMPLETED_KEY, 'true')
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
        onResetApp={() => void resetAppState()}
      />
    </div>
  )
}
