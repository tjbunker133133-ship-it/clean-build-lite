import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGPS } from '../hooks/useGPS'
import { getPermissionSnapshot, type PermissionStateLike } from '../lib/devicePermissions'
import {
  getPermissionRecoveryPlatform,
  mergePersistedGeolocationState,
  wizardIntroHint,
} from '../lib/permissionRecoveryCopy'
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
  const prevGeoRef = useRef<PermissionStateLike | null>(null)

  const isAppleMobile = useMemo(() => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
    return /iPhone|iPad|iPod/i.test(ua)
  }, [])

  const isAndroid = useMemo(() => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
    return /Android/i.test(ua)
  }, [])

  const locationDenied = geo === 'denied' || gps.status === 'denied'

  const platformHint = useMemo(() => wizardIntroHint(getPermissionRecoveryPlatform()), [])

  const applySnapshot = useCallback((s: Awaited<ReturnType<typeof getPermissionSnapshot>>) => {
    const persisted = safeLocalStorageGet(GPS_PERMISSION_KEY)
    let geolocation = mergePersistedGeolocationState(s.geolocation, persisted)
    if (gpsRef.current.locationState === 'denied') {
      geolocation = 'denied'
      safeLocalStorageSet(GPS_PERMISSION_KEY, 'denied')
    }
    setGeo(geolocation)
    setMic(s.microphone)
    setNotif(s.notifications)
    if (geolocation === 'granted' || geolocation === 'denied') {
      safeLocalStorageSet(GPS_PERMISSION_KEY, geolocation)
    }
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
      applySnapshot(s)
      const shouldShowWizard = !wizardCompleted
      if (shouldShowWizard) {
        setVisible(true)
      }
    })
  }, [applySnapshot])

  useEffect(() => {
    if (!visible) return
    const bump = () => {
      if (document.visibilityState !== 'visible') return
      void getPermissionSnapshot().then(applySnapshot)
    }
    document.addEventListener('visibilitychange', bump)
    window.addEventListener('pageshow', bump)
    return () => {
      document.removeEventListener('visibilitychange', bump)
      window.removeEventListener('pageshow', bump)
    }
  }, [visible, applySnapshot])

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
      void getPermissionSnapshot().then(applySnapshot)
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
  }, [isAppleMobile, applySnapshot])

  useEffect(() => {
    const onShow = () => {
      setVisible(true)
      void getPermissionSnapshot().then(applySnapshot)
    }
    window.addEventListener('hud:show-permissions', onShow)
    return () => window.removeEventListener('hud:show-permissions', onShow)
  }, [applySnapshot])

  /** After dismissal, reopen when geolocation transitions to denied (e.g. OS revoke). */
  useEffect(() => {
    const prev = prevGeoRef.current
    prevGeoRef.current = geo
    if (visible) return
    if (!readWizardCompletedFlag()) return
    if (geo !== 'denied') return
    if (prev !== 'granted' && prev !== 'prompt') return
    setVisible(true)
    void getPermissionSnapshot().then(applySnapshot)
  }, [geo, visible, applySnapshot])

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
